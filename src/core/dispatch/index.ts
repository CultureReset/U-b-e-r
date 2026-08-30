/**
 * Dispatch: eligibility filtering, scoring and offer generation.
 *
 * The matcher is a scored ranking rather than nearest-driver-wins, because
 * that is what actually happens in production systems: proximity dominates,
 * but rating, idle time, acceptance rate and fairness all move the needle.
 * Every weight below is a knob — tune them in one place and the whole
 * marketplace behaves differently.
 */
import { appConfig, getProduct, getVehicleClass, type MarketConfig } from '@config';
import type { DispatchOffer, DriverProfile, ID, Job, Order, Timestamp, Trip } from '@core/types';
import { haversineKm } from '@core/geo';
import { findRoute, type RoadGraph } from '@core/routing';
import { clamp, nextId, round2, sortBy } from '@core/util';

export interface DispatchWeights {
  proximity: number;
  rating: number;
  idleTime: number;
  acceptance: number;
  /** Boosts earners who have been passed over recently — keeps supply engaged. */
  fairness: number;
  /** Penalty per job already queued, for batching decisions. */
  queuePenalty: number;
}

export const defaultDispatchWeights: DispatchWeights = {
  proximity: 0.45,
  rating: 0.15,
  idleTime: 0.18,
  acceptance: 0.12,
  fairness: 0.1,
  queuePenalty: 0.35,
};

export interface DispatchContext {
  graph: RoadGraph;
  market: MarketConfig;
  now: Timestamp;
  hourOfDay: number;
  weights?: DispatchWeights;
  /** Drivers already offered this job, so we never re-offer to a decliner. */
  excludeDriverIds?: ID[];
}

export interface EligibilityResult {
  driver: DriverProfile;
  eligible: boolean;
  reasons: string[];
  approachKm: number;
}

/** Hard filters. A driver failing any of these can never receive the offer. */
export function evaluateEligibility(
  driver: DriverProfile,
  job: Job,
  ctx: DispatchContext,
): EligibilityResult {
  const reasons: string[] = [];
  const product = getProduct(job.productId);
  const pickup = job.stops[0]?.place.at ?? driver.at;
  const approachKm = haversineKm(driver.at, pickup);

  if (!product) reasons.push('Unknown product');
  if (driver.marketId !== job.marketId) reasons.push('Different market');
  if (driver.status !== 'online') reasons.push(`Driver is ${driver.status}`);
  if (driver.activeJobId && !appConfig.features.batchedDeliveries) reasons.push('Already on a job');
  if (product && !driver.optedProductIds.includes(product.id)) reasons.push('Not opted into product');
  if (product && !product.eligibleVehicleClasses.includes(driver.vehicle.classId)) {
    reasons.push('Vehicle class not eligible');
  }
  if (product) {
    const missingTags = product.dispatch.requiredDriverTags.filter((t) => !driver.tags.includes(t));
    if (missingTags.length) reasons.push(`Missing certification: ${missingTags.join(', ')}`);
    if (driver.rating < product.dispatch.minDriverRating) reasons.push('Rating below product threshold');
  }
  const radius = Math.min(product?.dispatch.preferredRadiusKm ?? 5, appConfig.limits.maxDispatchRadiusKm);
  if (approachKm > radius) reasons.push(`Outside ${radius}km radius`);
  if (driver.documents.some((d) => d.status === 'expired')) reasons.push('Expired document');
  if (ctx.excludeDriverIds?.includes(driver.id)) reasons.push('Already offered');

  // Batching: a courier may hold a second delivery if capacity allows.
  if (driver.activeJobId && appConfig.features.batchedDeliveries) {
    const vehicleClass = getVehicleClass(driver.vehicle.classId);
    const capacity = vehicleClass?.cargoUnits ?? 0;
    if (job.kind !== 'order') reasons.push('Cannot batch a ride onto an active job');
    else if (driver.stopQueue.length >= 4) reasons.push('Stop queue full');
    else if (capacity < 4) reasons.push('Insufficient cargo capacity to batch');
  }

  return { driver, eligible: reasons.length === 0, reasons, approachKm };
}

export interface ScoredCandidate {
  driver: DriverProfile;
  approachKm: number;
  approachMinutes: number;
  score: DispatchOffer['score'];
}

/** Score eligible candidates. Higher is better; components are all 0–1. */
export function scoreCandidates(
  candidates: EligibilityResult[],
  job: Job,
  ctx: DispatchContext,
): ScoredCandidate[] {
  const weights = ctx.weights ?? defaultDispatchWeights;
  const product = getProduct(job.productId);
  const radius = Math.min(product?.dispatch.preferredRadiusKm ?? 5, appConfig.limits.maxDispatchRadiusKm);
  const pickup = job.stops[0]?.place.at;

  return candidates
    .filter((c) => c.eligible)
    .map((c) => {
      const vehicleClass = getVehicleClass(c.driver.vehicle.classId);
      const approachRoute = pickup
        ? findRoute(ctx.graph, ctx.market, c.driver.at, pickup, {
            hourOfDay: ctx.hourOfDay,
            speedFactor: vehicleClass?.speedFactor ?? 1,
            congestionFactor: vehicleClass?.congestionFactor ?? 1,
          })
        : undefined;

      const approachMinutes = approachRoute ? approachRoute.durationSec / 60 : c.approachKm * 3;
      const proximity = clamp(1 - c.approachKm / radius, 0, 1);
      const rating = clamp((c.driver.rating - 4) / 1, 0, 1);
      const idleSec = c.driver.onlineSince ? (ctx.now - c.driver.onlineSince) / 1000 : 0;
      const idleTime = clamp(idleSec / (30 * 60), 0, 1);
      const acceptance = clamp(c.driver.acceptanceRate, 0, 1);
      // Fairness rewards earners with the fewest jobs this session.
      const fairness = clamp(1 - c.driver.session.jobs / 12, 0, 1);
      const queuePenalty = c.driver.stopQueue.length * weights.queuePenalty * 0.1;

      const total = round2(
        proximity * weights.proximity +
          rating * weights.rating +
          idleTime * weights.idleTime +
          acceptance * weights.acceptance +
          fairness * weights.fairness -
          queuePenalty,
      );

      return {
        driver: c.driver,
        approachKm: round2(approachRoute ? approachRoute.distanceM / 1000 : c.approachKm),
        approachMinutes: Math.max(1, Math.round(approachMinutes)),
        score: {
          total,
          proximity: round2(proximity),
          rating: round2(rating),
          idleTime: round2(idleTime),
          acceptance: round2(acceptance),
          fairness: round2(fairness),
        },
      };
    })
    .sort((a, b) => b.score.total - a.score.total);
}

export interface OfferBuildInput {
  job: Job;
  candidates: ScoredCandidate[];
  ctx: DispatchContext;
  /** Payout the earner is promised, from the quote. */
  payout: number;
  merchantName?: string;
  itemCount?: number;
  riderRating: number;
}

/**
 * Build the offer wave. We fan out to the top N rather than a single driver so
 * the first to accept wins — matching real-world "offer to the best few".
 */
export function buildOffers(input: OfferBuildInput): DispatchOffer[] {
  const { job, candidates, ctx, payout } = input;
  const product = getProduct(job.productId);
  const take = Math.min(appConfig.limits.maxOffersPerRequest, candidates.length);
  const pickupLabel = job.stops[0]?.place.label ?? '—';
  const dropoffLabel = job.stops[job.stops.length - 1]?.place.label ?? '—';
  const tripKm = job.quote.distanceKm;

  return candidates.slice(0, take).map((candidate) => ({
    id: nextId('ofr'),
    jobId: job.id,
    jobKind: job.kind === 'trip' ? ('trip' as const) : ('order' as const),
    driverId: candidate.driver.id,
    status: 'pending' as const,
    createdAt: ctx.now,
    expiresAt: ctx.now + appConfig.limits.offerTimeoutSec * 1000,
    preview: {
      productName: product?.name ?? job.productId,
      payout: round2(payout),
      tripDistanceKm: tripKm,
      approachDistanceKm: candidate.approachKm,
      approachMinutes: candidate.approachMinutes,
      totalMinutes: candidate.approachMinutes + job.quote.durationMin,
      pickupLabel,
      dropoffLabel,
      riderRating: input.riderRating,
      surgeMultiplier: job.quote.surgeMultiplier,
      includesTipEstimate: job.kind === 'order',
      merchantName: input.merchantName,
      itemCount: input.itemCount,
    },
    score: candidate.score,
  }));
}

/** Convenience: full pipeline from driver pool to ranked offers. */
export function dispatch(
  job: Job,
  drivers: DriverProfile[],
  ctx: DispatchContext,
  meta: { payout: number; riderRating: number; merchantName?: string; itemCount?: number },
): { offers: DispatchOffer[]; evaluations: EligibilityResult[]; candidates: ScoredCandidate[] } {
  const evaluations = drivers.map((d) => evaluateEligibility(d, job, ctx));
  const candidates = scoreCandidates(evaluations, job, ctx);
  const offers = buildOffers({ job, candidates, ctx, ...meta });
  return { offers, evaluations, candidates };
}

/**
 * Stop-queue ordering for a courier holding multiple deliveries.
 * Greedy nearest-next with a hard constraint that a merchant pickup always
 * precedes its own dropoff.
 */
export function sequenceStops(driverAt: { lat: number; lng: number }, orders: Order[]): Order['stops'] {
  const pending = orders.flatMap((o) => o.stops.filter((s) => !s.completedAt));
  const completedPickups = new Set(
    orders.flatMap((o) => o.stops.filter((s) => s.completedAt && s.kind === 'merchant').map((s) => s.jobId)),
  );

  const ordered: Order['stops'] = [];
  let cursor = driverAt;
  const remaining = [...pending];

  while (remaining.length > 0) {
    const servable = remaining.filter(
      (s) => s.kind !== 'dropoff' || completedPickups.has(s.jobId) || ordered.some((o) => o.jobId === s.jobId && o.kind === 'merchant'),
    );
    const pool = servable.length > 0 ? servable : remaining;
    const next = sortBy(pool, (s) => haversineKm(cursor, s.place.at))[0];
    ordered.push({ ...next, sequence: ordered.length });
    remaining.splice(remaining.indexOf(next), 1);
    cursor = next.place.at;
  }

  return ordered;
}

/** Estimated time-to-pickup for the consumer's "driver is N minutes away". */
export function etaMinutes(driver: DriverProfile, target: { lat: number; lng: number }, ctx: DispatchContext): number {
  const vehicleClass = getVehicleClass(driver.vehicle.classId);
  const route = findRoute(ctx.graph, ctx.market, driver.at, target, {
    hourOfDay: ctx.hourOfDay,
    speedFactor: vehicleClass?.speedFactor ?? 1,
    congestionFactor: vehicleClass?.congestionFactor ?? 1,
  });
  return Math.max(1, Math.round(route.durationSec / 60));
}

/** Which trips a driver is *shown* as a candidate for — used by the ops console. */
export function explainRejection(result: EligibilityResult): string {
  return result.reasons[0] ?? 'Eligible';
}

export type { Trip };
