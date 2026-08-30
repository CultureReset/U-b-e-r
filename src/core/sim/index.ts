/**
 * World simulation.
 *
 * This is what makes the prototype a *system* rather than six disconnected
 * screens: one clock advances vehicles along real routes, ages merchant
 * queues, expires dispatch offers, generates ambient demand and settles jobs.
 * A ride requested in the rider surface becomes an offer in the driver surface
 * within the same tick, and both watch the same vehicle move.
 *
 * The simulator is a pure reducer over `WorldState` — it never touches React —
 * so the same logic could run on a server unchanged.
 */
import {
  appConfig,
  getMarket,
  getProduct,
  getProductsForMarket,
  getVehicleClass,
  incentives,
  driverPayConfig,
} from '@config';
import { bus } from '@core/events';
import { haversineKm } from '@core/geo';
import { dispatch, type DispatchContext } from '@core/dispatch';
import { buildQuote } from '@core/pricing';
import { findRoute, graphFor, positionAlong, remainingAlong } from '@core/routing';
import type {
  DispatchOffer,
  DriverProfile,
  ID,
  LedgerEntry,
  Merchant,
  Order,
  OrderStatus,
  Timestamp,
  Trip,
} from '@core/types';
import { clamp, createRng, nextId, referenceCode, round2, type Rng } from '@core/util';
import type { WorldState } from '@data/ports';
import { computeZoneSnapshots, surchargesAt, surgeAt } from '@data/seed/zones';
import { makePlace, randomDemandPoint } from '@data/seed/places';
import { menuIndex, recomputePrepMinutes } from '@data/seed/merchants';

/** Arrival threshold — a vehicle within this distance counts as "here". */
const ARRIVAL_M = 45;

export interface TickResult {
  state: WorldState;
  /** Ids of entities that changed, so the UI can be surgical if it wants. */
  touched: { drivers: ID[]; trips: ID[]; orders: ID[]; offers: ID[] };
}

interface TickCtx {
  state: WorldState;
  now: Timestamp;
  deltaSec: number;
  hourOfDay: number;
  rng: Rng;
  dispatchCtx: DispatchContext;
  touched: TickResult['touched'];
  ledger: LedgerEntry[];
}

const ledgerEntry = (
  ctx: TickCtx,
  accountId: ID,
  accountKind: LedgerEntry['accountKind'],
  kind: LedgerEntry['kind'],
  label: string,
  amount: number,
  job?: { id: ID; code: string },
): void => {
  ctx.ledger.push({
    id: nextId('led'),
    at: ctx.now,
    jobId: job?.id,
    jobCode: job?.code,
    accountId,
    accountKind,
    kind,
    label,
    amount: round2(amount),
  });
};

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

function routeOptionsFor(driver: DriverProfile, hourOfDay: number) {
  const vehicleClass = getVehicleClass(driver.vehicle.classId);
  return {
    hourOfDay,
    speedFactor: vehicleClass?.speedFactor ?? 1,
    congestionFactor: vehicleClass?.congestionFactor ?? 1,
  };
}

/** Advance one vehicle along its active route. Returns whether it arrived. */
function advanceDriver(driver: DriverProfile, ctx: TickCtx): { driver: DriverProfile; arrived: boolean } {
  if (!driver.activeRoute) return { driver, arrived: false };

  const route = driver.activeRoute;
  const pace = route.distanceM > 0 ? route.distanceM / Math.max(1, route.durationSec) : 0;
  const advanceM = pace * ctx.deltaSec;
  const progress = driver.routeProgressM + advanceM;
  const arrived = progress >= route.distanceM - ARRIVAL_M;
  const clamped = Math.min(progress, route.distanceM);
  const { at, heading } = positionAlong(route, clamped);

  return {
    driver: {
      ...driver,
      at,
      heading,
      speedKph: round2(pace * 3.6),
      routeProgressM: clamped,
      session: {
        ...driver.session,
        distanceKm: round2(driver.session.distanceKm + advanceM / 1000),
        onlineSec: driver.session.onlineSec + ctx.deltaSec,
      },
    },
    arrived,
  };
}

/** Idle online drivers drift toward high-demand zones so supply repositions. */
function repositionIdleDriver(driver: DriverProfile, ctx: TickCtx): DriverProfile {
  if (driver.status !== 'online' || driver.activeJobId) return driver;
  if (driver.activeRoute && driver.routeProgressM < driver.activeRoute.distanceM - ARRIVAL_M) {
    return advanceDriver(driver, ctx).driver;
  }
  // Only a fraction re-target per tick, so the fleet doesn't move in lockstep.
  if (!ctx.rng.bool(0.04)) {
    return {
      ...driver,
      speedKph: 0,
      session: { ...driver.session, onlineSec: driver.session.onlineSec + ctx.deltaSec },
    };
  }
  const market = getMarket(ctx.state.marketId);
  const target = randomDemandPoint(market, ctx.rng);
  const route = findRoute(ctx.dispatchCtx.graph, market, driver.at, target, routeOptionsFor(driver, ctx.hourOfDay));
  return { ...driver, activeRoute: route, routeProgressM: 0 };
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

function offerJob(job: Trip | Order, ctx: TickCtx): DispatchOffer[] {
  const already = Object.values(ctx.state.offers)
    .filter((o) => o.jobId === job.id)
    .map((o) => o.driverId);

  const drivers = Object.values(ctx.state.drivers).filter((d) => d.marketId === ctx.state.marketId);
  const riderId = job.kind === 'trip' ? job.riderId : job.customerId;
  const rider = ctx.state.riders[riderId];
  const merchant = job.kind === 'order' ? ctx.state.merchants[job.merchantId] : undefined;

  const { offers } = dispatch(
    job,
    drivers,
    { ...ctx.dispatchCtx, now: ctx.now, excludeDriverIds: already },
    {
      payout: job.quote.earnerPayout,
      riderRating: rider?.rating ?? 5,
      merchantName: merchant?.name,
      itemCount: job.kind === 'order' ? job.lines.reduce((acc, l) => acc + l.quantity, 0) : undefined,
    },
  );

  for (const offer of offers) {
    ctx.state.offers[offer.id] = offer;
    ctx.touched.offers.push(offer.id);
    bus.emit('offer.created', 'dispatch', { jobId: job.id, driverId: offer.driverId, score: offer.score.total }, offer.id, ctx.now);
  }
  return offers;
}

/**
 * AI drivers respond to offers on their own. The player-controlled driver
 * (session.driverId) is always left alone so the human decides.
 */
function resolveAutoOffers(ctx: TickCtx): void {
  const autoAfterMs = appConfig.simulation.autoDriverAcceptAfterSec * 1000;

  for (const offer of Object.values(ctx.state.offers)) {
    if (offer.status !== 'pending') continue;

    const isPlayer = offer.driverId === ctx.state.session.driverId;

    // An AI earner decides at its own decision time. That check has to come
    // before expiry: one tick can advance the clock past the whole offer
    // window at high simulation speeds, and expiring first would mean no
    // offer is ever accepted.
    const decided = !isPlayer && ctx.now - offer.createdAt >= autoAfterMs;

    if (!decided) {
      if (ctx.now >= offer.expiresAt) {
        ctx.state.offers[offer.id] = { ...offer, status: 'expired', respondedAt: ctx.now };
        ctx.touched.offers.push(offer.id);
        bus.emit('offer.expired', 'dispatch', { jobId: offer.jobId, driverId: offer.driverId }, offer.id, ctx.now);
      }
      continue;
    }

    const driver = ctx.state.drivers[offer.driverId];
    if (!driver || driver.status !== 'online') {
      ctx.state.offers[offer.id] = { ...offer, status: 'cancelled', respondedAt: ctx.now };
      continue;
    }

    // Accept probability tracks the earner's own acceptance rate and the payout.
    const payoutAppeal = clamp(offer.preview.payout / 12, 0.2, 1.4);
    const accepts = ctx.rng.bool(clamp(driver.acceptanceRate * payoutAppeal, 0.05, 0.97));
    if (accepts) acceptOfferInternal(offer.id, ctx);
    else {
      ctx.state.offers[offer.id] = { ...offer, status: 'declined', respondedAt: ctx.now };
      ctx.touched.offers.push(offer.id);
      bus.emit('offer.declined', driver.displayName, { jobId: offer.jobId }, offer.id, ctx.now);
    }
  }
}

/** Shared accept path — used by both the AI and the human driver surface. */
export function acceptOfferInternal(offerId: ID, ctx: TickCtx): boolean {
  const offer = ctx.state.offers[offerId];
  if (!offer || offer.status !== 'pending') return false;
  const driver = ctx.state.drivers[offer.driverId];
  if (!driver) return false;

  const trip = ctx.state.trips[offer.jobId];
  const order = ctx.state.orders[offer.jobId];
  const job = trip ?? order;
  if (!job) return false;

  // Another earner may have taken it in the same tick.
  const alreadyTaken = trip ? Boolean(trip.driverId) : Boolean(order?.courierId);
  if (alreadyTaken) {
    ctx.state.offers[offerId] = { ...offer, status: 'superseded', respondedAt: ctx.now };
    return false;
  }

  ctx.state.offers[offerId] = { ...offer, status: 'accepted', respondedAt: ctx.now };
  ctx.touched.offers.push(offerId);

  // Every sibling offer for this job is now moot.
  for (const sibling of Object.values(ctx.state.offers)) {
    if (sibling.jobId === job.id && sibling.id !== offerId && sibling.status === 'pending') {
      ctx.state.offers[sibling.id] = { ...sibling, status: 'superseded', respondedAt: ctx.now };
    }
  }

  const market = getMarket(ctx.state.marketId);
  const firstStop = job.stops[0];
  const approachRoute = findRoute(
    ctx.dispatchCtx.graph,
    market,
    driver.at,
    firstStop.place.at,
    routeOptionsFor(driver, ctx.hourOfDay),
  );

  ctx.state.drivers[driver.id] = {
    ...driver,
    status: 'assigned',
    activeJobId: job.id,
    activeRoute: approachRoute,
    routeProgressM: 0,
    stopQueue: job.stops.map((s) => ({ ...s })),
    streakCount: driver.streakCount + 1,
  };
  ctx.touched.drivers.push(driver.id);

  if (trip) {
    ctx.state.trips[trip.id] = {
      ...trip,
      status: 'assigned',
      driverId: driver.id,
      assignedAt: ctx.now,
      approachRoute,
      timeline: [...trip.timeline, { status: 'assigned', at: ctx.now, actor: driver.displayName }],
    };
    ctx.touched.trips.push(trip.id);
    bus.emit('trip.assigned', driver.displayName, { tripId: trip.id, eta: offer.preview.approachMinutes }, trip.id, ctx.now);
  } else if (order) {
    // Courier assignment and food preparation are independent. Overwriting a
    // still-preparing order with 'courier_assigned' would strand it: the
    // merchant's ready timer only runs while the order is preparing.
    const status = order.status === 'preparing' ? 'preparing' : 'courier_assigned';
    ctx.state.orders[order.id] = {
      ...order,
      status,
      courierId: driver.id,
      courierAssignedAt: ctx.now,
      approachRoute,
      timeline: [...order.timeline, { status: 'courier_assigned', at: ctx.now, actor: driver.displayName }],
    };
    ctx.touched.orders.push(order.id);
    bus.emit('order.courier_assigned', driver.displayName, { orderId: order.id }, order.id, ctx.now);
  }

  bus.emit('offer.accepted', driver.displayName, { jobId: job.id, payout: offer.preview.payout }, offerId, ctx.now);
  return true;
}

/* ------------------------------------------------------------------ */
/* Trip progression                                                    */
/* ------------------------------------------------------------------ */

function progressTrips(ctx: TickCtx): void {
  const market = getMarket(ctx.state.marketId);

  for (const trip of Object.values(ctx.state.trips)) {
    switch (trip.status) {
      case 'scheduled': {
        // Release a scheduled ride into dispatch shortly before its window.
        if (trip.scheduledFor && ctx.now >= trip.scheduledFor - 8 * 60_000) {
          ctx.state.trips[trip.id] = {
            ...trip,
            status: 'searching',
            requestedAt: ctx.now,
            timeline: [...trip.timeline, { status: 'searching', at: ctx.now, actor: 'system' }],
          };
          ctx.touched.trips.push(trip.id);
          offerJob(ctx.state.trips[trip.id], ctx);
        }
        break;
      }
      case 'requested': {
        ctx.state.trips[trip.id] = {
          ...trip,
          status: 'searching',
          timeline: [...trip.timeline, { status: 'searching', at: ctx.now, actor: 'system' }],
        };
        ctx.touched.trips.push(trip.id);
        bus.emit('trip.searching', 'system', { tripId: trip.id }, trip.id, ctx.now);
        offerJob(ctx.state.trips[trip.id], ctx);
        break;
      }
      case 'no_drivers': {
        // The rider's own request stays put so they can retry by hand; ambient
        // requests give up rather than piling into the world forever.
        if (trip.riderId === ctx.state.session.riderId) break;
        const strandedSec = (ctx.now - trip.requestedAt) / 1000;
        if (strandedSec > 180) {
          ctx.state.trips[trip.id] = {
            ...trip,
            status: 'cancelled',
            cancelledAt: ctx.now,
            cancelledBy: 'system',
            cancellationReason: 'no-drivers',
            timeline: [...trip.timeline, { status: 'cancelled', at: ctx.now, actor: 'system', note: 'no-drivers' }],
          };
          ctx.touched.trips.push(trip.id);
        }
        break;
      }
      case 'searching': {
        const outstanding = Object.values(ctx.state.offers).filter(
          (o) => o.jobId === trip.id && o.status === 'pending',
        );
        if (outstanding.length > 0) break;

        const elapsedSec = (ctx.now - trip.requestedAt) / 1000;
        if (elapsedSec > appConfig.limits.offerTimeoutSec * 3) {
          ctx.state.trips[trip.id] = {
            ...trip,
            status: 'no_drivers',
            timeline: [...trip.timeline, { status: 'no_drivers', at: ctx.now, actor: 'system' }],
          };
          ctx.touched.trips.push(trip.id);
          bus.emit('trip.no_drivers', 'system', { tripId: trip.id }, trip.id, ctx.now);
        } else {
          offerJob(trip, ctx);
        }
        break;
      }
      case 'assigned':
      case 'arriving': {
        const driver = trip.driverId ? ctx.state.drivers[trip.driverId] : undefined;
        if (!driver) break;
        const remaining = driver.activeRoute
          ? remainingAlong(driver.activeRoute, driver.routeProgressM).distanceM
          : 0;

        if (trip.status === 'assigned' && remaining < 400) {
          ctx.state.trips[trip.id] = {
            ...trip,
            status: 'arriving',
            timeline: [...trip.timeline, { status: 'arriving', at: ctx.now, actor: 'system' }],
          };
          ctx.touched.trips.push(trip.id);
        }

        if (remaining <= ARRIVAL_M) {
          ctx.state.trips[trip.id] = {
            ...ctx.state.trips[trip.id],
            status: 'waiting',
            arrivedAt: ctx.now,
            timeline: [
              ...ctx.state.trips[trip.id].timeline,
              { status: 'waiting', at: ctx.now, actor: driver.displayName },
            ],
          };
          ctx.state.drivers[driver.id] = { ...driver, activeRoute: undefined, speedKph: 0, routeProgressM: 0 };
          ctx.touched.trips.push(trip.id);
          ctx.touched.drivers.push(driver.id);
          bus.emit('trip.driver_arrived', driver.displayName, { tripId: trip.id }, trip.id, ctx.now);
        }
        break;
      }
      case 'waiting': {
        // The human driver starts the trip themself; AI drivers board the rider.
        if (trip.driverId === ctx.state.session.driverId) break;
        const waitedSec = trip.arrivedAt ? (ctx.now - trip.arrivedAt) / 1000 : 0;
        if (waitedSec < 25) break;
        startTripInternal(trip.id, ctx);
        break;
      }
      case 'in_progress': {
        const driver = trip.driverId ? ctx.state.drivers[trip.driverId] : undefined;
        if (!driver?.activeRoute) break;
        const remaining = remainingAlong(driver.activeRoute, driver.routeProgressM).distanceM;
        if (remaining <= ARRIVAL_M) {
          if (trip.driverId === ctx.state.session.driverId) break; // human confirms arrival
          completeTripInternal(trip.id, ctx);
        }
        break;
      }
      default:
        break;
    }
  }

  void market;
}

export function startTripInternal(tripId: ID, ctx: TickCtx): boolean {
  const trip = ctx.state.trips[tripId];
  if (!trip || trip.status !== 'waiting' || !trip.driverId) return false;
  const driver = ctx.state.drivers[trip.driverId];
  if (!driver) return false;

  const market = getMarket(ctx.state.marketId);
  const stops = trip.stops.slice(1);
  const legs = [];
  let cursor = driver.at;
  for (const stop of stops) {
    legs.push(findRoute(ctx.dispatchCtx.graph, market, cursor, stop.place.at, routeOptionsFor(driver, ctx.hourOfDay)));
    cursor = stop.place.at;
  }
  const route = legs.length === 1 ? legs[0] : legs.reduce((acc, leg) => concat(acc, leg));

  ctx.state.trips[tripId] = {
    ...trip,
    status: 'in_progress',
    startedAt: ctx.now,
    route,
    stops: trip.stops.map((s, i) => (i === 0 ? { ...s, completedAt: ctx.now } : s)),
    timeline: [...trip.timeline, { status: 'in_progress', at: ctx.now, actor: driver.displayName }],
  };
  ctx.state.drivers[driver.id] = {
    ...driver,
    status: 'on_trip',
    activeRoute: route,
    routeProgressM: 0,
  };
  ctx.touched.trips.push(tripId);
  ctx.touched.drivers.push(driver.id);
  bus.emit('trip.started', driver.displayName, { tripId }, tripId, ctx.now);
  return true;
}

const concat = (a: NonNullable<Trip['route']>, b: NonNullable<Trip['route']>): NonNullable<Trip['route']> => ({
  points: [...a.points, ...b.points.slice(1)],
  cumulativeM: [...a.cumulativeM, ...b.cumulativeM.slice(1).map((m) => m + a.distanceM)],
  distanceM: a.distanceM + b.distanceM,
  durationSec: a.durationSec + b.durationSec,
  nodeIds: [...a.nodeIds, ...b.nodeIds],
});

export function completeTripInternal(tripId: ID, ctx: TickCtx): boolean {
  const trip = ctx.state.trips[tripId];
  if (!trip || trip.status !== 'in_progress' || !trip.driverId) return false;
  const driver = ctx.state.drivers[trip.driverId];
  const rider = ctx.state.riders[trip.riderId];
  if (!driver) return false;

  // Settle against what was actually driven, not the original estimate.
  const actualKm = trip.route ? trip.route.distanceM / 1000 : trip.quote.distanceKm;
  const actualMin = trip.startedAt ? (ctx.now - trip.startedAt) / 60_000 : trip.quote.durationMin;
  const waitedMin = trip.arrivedAt && trip.startedAt ? Math.max(0, (trip.startedAt - trip.arrivedAt) / 60_000 - 2) : 0;

  const settlement = buildQuote({
    productId: trip.productId,
    marketId: trip.marketId,
    distanceKm: actualKm,
    durationMin: actualMin,
    surgeMultiplier: trip.quote.surgeMultiplier,
    surcharges: surchargesAt(getMarket(trip.marketId), trip.stops[0].place.at),
    waitingMin: waitedMin,
    driverTierId: driver.tierId,
    promotionCode: trip.quote.promotionId
      ? undefined // promo already consumed at quote time
      : undefined,
    now: ctx.now,
  });

  ctx.state.trips[tripId] = {
    ...trip,
    status: 'completed',
    completedAt: ctx.now,
    settlement,
    stops: trip.stops.map((s) => (s.completedAt ? s : { ...s, completedAt: ctx.now })),
    timeline: [...trip.timeline, { status: 'completed', at: ctx.now, actor: driver.displayName }],
  };

  const product = getProduct(trip.productId);
  ctx.state.drivers[driver.id] = {
    ...driver,
    status: 'online',
    activeJobId: undefined,
    activeRoute: undefined,
    routeProgressM: 0,
    stopQueue: [],
    speedKph: 0,
    session: {
      ...driver.session,
      earnings: round2(driver.session.earnings + settlement.earnerPayout),
      jobs: driver.session.jobs + 1,
    },
    lifetime: {
      earnings: round2(driver.lifetime.earnings + settlement.earnerPayout),
      jobs: driver.lifetime.jobs + 1,
      distanceKm: round2(driver.lifetime.distanceKm + actualKm),
    },
    tierPoints: driver.tierPoints + 10,
    questProgress: bumpQuests(driver, ctx),
  };

  if (rider) {
    ctx.state.riders[rider.id] = { ...rider, lifetimeTrips: rider.lifetimeTrips + 1 };
  }

  ledgerEntry(ctx, trip.riderId, 'rider', 'fare', `${product?.name ?? 'Trip'} · ${trip.stops.at(-1)?.place.label ?? ''}`, -settlement.total, trip);
  ledgerEntry(ctx, driver.id, 'driver', 'payout', `${product?.name ?? 'Trip'} fare`, settlement.earnerPayout, trip);

  ctx.touched.trips.push(tripId);
  ctx.touched.drivers.push(driver.id);
  bus.emit('trip.completed', driver.displayName, { tripId, total: settlement.total }, tripId, ctx.now);
  bus.emit('payment.captured', 'payments', { tripId, amount: settlement.total }, tripId, ctx.now);
  return true;
}

function bumpQuests(driver: DriverProfile, ctx: TickCtx): Record<ID, number> {
  if (!appConfig.features.driverQuests) return driver.questProgress;
  const progress = { ...driver.questProgress };
  for (const quest of incentives) {
    if (!quest.enabled || quest.kind === 'boost') continue;
    const inWindow = ctx.hourOfDay >= quest.window.startHour && ctx.hourOfDay < quest.window.endHour;
    if (!inWindow) continue;
    progress[quest.id] = (progress[quest.id] ?? 0) + 1;
  }
  return progress;
}

/* ------------------------------------------------------------------ */
/* Order progression                                                   */
/* ------------------------------------------------------------------ */

/** Has the kitchen finished? Runs for every order still awaiting its ready time. */
function readyDeadline(order: Order, merchant: Merchant | undefined): Timestamp {
  const prepMs = (merchant?.currentPrepMinutes ?? 15) * 60_000;
  return (order.merchantAcceptedAt ?? order.placedAt) + prepMs;
}

const AWAITING_PREP: OrderStatus[] = ['preparing', 'courier_assigned', 'courier_at_merchant'];

function progressOrders(ctx: TickCtx): void {
  const market = getMarket(ctx.state.marketId);

  for (const order of Object.values(ctx.state.orders)) {
    const merchant = ctx.state.merchants[order.merchantId];

    // The ready time has to be evaluated independently of the courier's
    // progress — a courier who arrives early must not stop the kitchen clock.
    if (!order.readyAt && AWAITING_PREP.includes(order.status)) {
      if (ctx.now >= readyDeadline(order, merchant)) {
        setOrder(
          ctx,
          order.id,
          { readyAt: ctx.now, status: order.status === 'preparing' && !order.courierId ? 'ready' : order.status },
          merchant?.name ?? 'merchant',
        );
        bus.emit('order.ready', merchant?.name ?? 'merchant', { orderId: order.id }, order.id, ctx.now);
      }
    }

    switch (ctx.state.orders[order.id].status) {
      case 'scheduled': {
        if (order.scheduledFor && ctx.now >= order.scheduledFor - (merchant?.currentPrepMinutes ?? 15) * 60_000) {
          setOrder(ctx, order.id, { status: 'placed', placedAt: ctx.now }, 'system');
        }
        break;
      }
      case 'placed': {
        setOrder(ctx, order.id, { status: 'merchant_review' }, 'system');
        bus.emit('order.placed', 'customer', { orderId: order.id }, order.id, ctx.now);
        break;
      }
      case 'merchant_review': {
        // The merchant the user is operating decides for themself.
        if (order.merchantId === ctx.state.session.merchantId) break;
        const elapsed = (ctx.now - order.placedAt) / 1000;
        if (!merchant?.settings.autoAcceptOrders && elapsed < 45) break;
        if (elapsed < 12) break;
        setOrder(ctx, order.id, { status: 'preparing', merchantAcceptedAt: ctx.now }, merchant?.name ?? 'merchant');
        bus.emit('order.accepted', merchant?.name ?? 'merchant', { orderId: order.id }, order.id, ctx.now);
        break;
      }
      case 'preparing': {
        // Dispatch a courier so they arrive around the time the food is ready.
        if (!order.courierId) {
          const outstanding = Object.values(ctx.state.offers).filter(
            (o) => o.jobId === order.id && o.status === 'pending',
          );
          if (outstanding.length === 0 && ctx.now >= readyDeadline(order, merchant) - 6 * 60_000) {
            offerJob(order, ctx);
          }
        } else if (ctx.state.orders[order.id].readyAt) {
          setOrder(ctx, order.id, { status: 'courier_assigned' }, merchant?.name ?? 'merchant');
        }
        break;
      }
      case 'ready': {
        const outstanding = Object.values(ctx.state.offers).filter(
          (o) => o.jobId === order.id && o.status === 'pending',
        );
        if (!order.courierId && outstanding.length === 0) offerJob(order, ctx);
        break;
      }
      case 'courier_assigned': {
        const courier = order.courierId ? ctx.state.drivers[order.courierId] : undefined;
        if (!courier?.activeRoute) break;
        const remaining = remainingAlong(courier.activeRoute, courier.routeProgressM).distanceM;
        if (remaining <= ARRIVAL_M) {
          setOrder(ctx, order.id, { status: 'courier_at_merchant' }, courier.displayName);
          ctx.state.drivers[courier.id] = { ...courier, activeRoute: undefined, routeProgressM: 0, speedKph: 0 };
          ctx.touched.drivers.push(courier.id);
          bus.emit('order.courier_arrived', courier.displayName, { orderId: order.id }, order.id, ctx.now);
        }
        break;
      }
      case 'courier_at_merchant': {
        if (order.courierId === ctx.state.session.driverId) break; // human confirms pickup
        const readyEnough = order.readyAt !== undefined && ctx.now >= order.readyAt;
        if (readyEnough) pickUpOrderInternal(order.id, ctx);
        break;
      }
      case 'picked_up': {
        setOrder(ctx, order.id, { status: 'delivering' }, 'system');
        break;
      }
      case 'delivering': {
        const courier = order.courierId ? ctx.state.drivers[order.courierId] : undefined;
        if (!courier?.activeRoute) break;
        const remaining = remainingAlong(courier.activeRoute, courier.routeProgressM).distanceM;
        if (remaining <= ARRIVAL_M) {
          if (order.courierId === ctx.state.session.driverId) break; // human confirms delivery
          deliverOrderInternal(order.id, ctx);
        }
        break;
      }
      default:
        break;
    }
  }

  void market;
}

function setOrder(ctx: TickCtx, orderId: ID, patch: Partial<Order>, actor: string): void {
  const order = ctx.state.orders[orderId];
  if (!order) return;
  const status = patch.status ?? order.status;
  ctx.state.orders[orderId] = {
    ...order,
    ...patch,
    timeline:
      patch.status && patch.status !== order.status
        ? [...order.timeline, { status, at: ctx.now, actor }]
        : order.timeline,
  };
  ctx.touched.orders.push(orderId);
}

export function pickUpOrderInternal(orderId: ID, ctx: TickCtx): boolean {
  const order = ctx.state.orders[orderId];
  if (!order || order.status !== 'courier_at_merchant' || !order.courierId) return false;
  const courier = ctx.state.drivers[order.courierId];
  if (!courier) return false;

  const market = getMarket(ctx.state.marketId);
  const dropoff = order.stops[order.stops.length - 1];
  const route = findRoute(
    ctx.dispatchCtx.graph,
    market,
    courier.at,
    dropoff.place.at,
    routeOptionsFor(courier, ctx.hourOfDay),
  );

  setOrder(
    ctx,
    orderId,
    {
      status: 'picked_up',
      pickedUpAt: ctx.now,
      route,
      stops: order.stops.map((s, i) => (i === 0 ? { ...s, completedAt: ctx.now } : s)),
    },
    courier.displayName,
  );
  ctx.state.drivers[courier.id] = { ...courier, status: 'on_trip', activeRoute: route, routeProgressM: 0 };
  ctx.touched.drivers.push(courier.id);
  bus.emit('order.picked_up', courier.displayName, { orderId }, orderId, ctx.now);
  return true;
}

export function deliverOrderInternal(orderId: ID, ctx: TickCtx): boolean {
  const order = ctx.state.orders[orderId];
  if (!order || !['delivering', 'picked_up'].includes(order.status) || !order.courierId) return false;
  const courier = ctx.state.drivers[order.courierId];
  const merchant = ctx.state.merchants[order.merchantId];
  const customer = ctx.state.riders[order.customerId];
  if (!courier) return false;

  const settlement = order.quote;
  setOrder(
    ctx,
    orderId,
    {
      status: 'delivered',
      deliveredAt: ctx.now,
      settlement,
      stops: order.stops.map((s) => (s.completedAt ? s : { ...s, completedAt: ctx.now })),
    },
    courier.displayName,
  );

  ctx.state.drivers[courier.id] = {
    ...courier,
    status: 'online',
    activeJobId: undefined,
    activeRoute: undefined,
    routeProgressM: 0,
    stopQueue: [],
    speedKph: 0,
    session: {
      ...courier.session,
      earnings: round2(courier.session.earnings + settlement.earnerPayout),
      jobs: courier.session.jobs + 1,
    },
    lifetime: {
      earnings: round2(courier.lifetime.earnings + settlement.earnerPayout),
      jobs: courier.lifetime.jobs + 1,
      distanceKm: round2(courier.lifetime.distanceKm + settlement.distanceKm),
    },
    tierPoints: courier.tierPoints + 8,
    questProgress: bumpQuests(courier, ctx),
  };

  if (customer) ctx.state.riders[customer.id] = { ...customer, lifetimeOrders: customer.lifetimeOrders + 1 };

  const goods = round2(order.lines.reduce((acc, l) => acc + l.lineTotal, 0));
  const commission = round2(goods * 0.3);
  ledgerEntry(ctx, order.customerId, 'rider', 'fare', `${merchant?.name ?? 'Order'}`, -settlement.total, order);
  ledgerEntry(ctx, courier.id, 'driver', 'payout', `Delivery · ${merchant?.name ?? ''}`, settlement.earnerPayout, order);
  if (merchant) {
    ledgerEntry(ctx, merchant.id, 'merchant', 'fare', `Order ${order.code}`, goods, order);
    ledgerEntry(ctx, merchant.id, 'merchant', 'commission', 'Platform commission', -commission, order);
    ctx.state.merchants[merchant.id] = {
      ...merchant,
      stats: {
        ...merchant.stats,
        ordersToday: merchant.stats.ordersToday + 1,
        revenueToday: round2(merchant.stats.revenueToday + goods),
      },
    };
  }

  ctx.touched.drivers.push(courier.id);
  bus.emit('order.delivered', courier.displayName, { orderId, total: settlement.total }, orderId, ctx.now);
  return true;
}

/* ------------------------------------------------------------------ */
/* Ambient demand                                                      */
/* ------------------------------------------------------------------ */

function generateAmbientDemand(ctx: TickCtx): void {
  const cfg = appConfig.simulation.ambientDemand;
  if (!cfg.enabled) return;

  const market = getMarket(ctx.state.marketId);
  const perTick = (rate: number) => (rate / 3600) * ctx.deltaSec;

  // Rides
  if (ctx.rng.next() < perTick(cfg.ridesPerHour)) {
    const riders = Object.values(ctx.state.riders).filter((r) => r.marketId === ctx.state.marketId);
    const products = getProductsForMarket(ctx.state.marketId, 'ride');
    if (riders.length && products.length) {
      const rider = ctx.rng.pick(riders.filter((r) => r.id !== ctx.state.session.riderId) ?? riders);
      const product = ctx.rng.pickWeighted(products, (p) => (p.id === 'go' ? 5 : 1.4));
      const from = ctx.rng.bool(0.35) ? rider.savedPlaces[0].at : randomDemandPoint(market, ctx.rng);
      const to = randomDemandPoint(market, ctx.rng);
      createTripInternal(ctx, { riderId: rider.id, productId: product.id, from, to });
    }
  }

  // Orders
  if (ctx.rng.next() < perTick(cfg.ordersPerHour)) {
    const customers = Object.values(ctx.state.riders).filter((r) => r.marketId === ctx.state.marketId);
    const merchants = Object.values(ctx.state.merchants).filter(
      (m) => m.marketId === ctx.state.marketId && m.isOpen && !m.settings.paused && m.id !== ctx.state.session.merchantId,
    );
    const products = getProductsForMarket(ctx.state.marketId, 'delivery');
    if (customers.length && merchants.length && products.length) {
      const customer = ctx.rng.pick(customers.filter((c) => c.id !== ctx.state.session.riderId) ?? customers);
      const merchant = ctx.rng.pick(merchants);
      const product = ctx.rng.pickWeighted(products, (p) => (p.id === 'eats-standard' ? 5 : 1.2));
      createOrderInternal(ctx, { customerId: customer.id, merchantId: merchant.id, productId: product.id });
    }
  }
}

interface CreateTripInput {
  riderId: ID;
  productId: ID;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}

function createTripInternal(ctx: TickCtx, input: CreateTripInput): Trip | undefined {
  const market = getMarket(ctx.state.marketId);
  const rider = ctx.state.riders[input.riderId];
  const product = getProduct(input.productId);
  if (!rider || !product) return undefined;

  const route = findRoute(ctx.dispatchCtx.graph, market, input.from, input.to, {
    hourOfDay: ctx.hourOfDay,
    speedFactor: 1,
    congestionFactor: 1,
  });

  const quote = buildQuote({
    productId: input.productId,
    marketId: ctx.state.marketId,
    distanceKm: route.distanceM / 1000,
    durationMin: route.durationSec / 60,
    surgeMultiplier: surgeAt(ctx.state, market, input.from),
    surcharges: surchargesAt(market, input.from),
    now: ctx.now,
  });

  const id = nextId('trp');
  const trip: Trip = {
    id,
    code: referenceCode('TRP', ctx.now + Object.keys(ctx.state.trips).length),
    kind: 'trip',
    marketId: ctx.state.marketId,
    productId: input.productId,
    riderId: rider.id,
    status: 'requested',
    stops: [
      { id: nextId('stp'), jobId: id, kind: 'pickup', place: makePlace(ctx.state.marketId, input.from), sequence: 0 },
      { id: nextId('stp'), jobId: id, kind: 'dropoff', place: makePlace(ctx.state.marketId, input.to), sequence: 1 },
    ],
    quote,
    requestedAt: ctx.now,
    paymentMethodId: rider.defaultPaymentMethodId,
    timeline: [{ status: 'requested', at: ctx.now, actor: rider.displayName }],
    messages: [],
    safety: { emergencyContacted: false, checksRun: 0 },
  };

  ctx.state.trips[id] = trip;
  ctx.touched.trips.push(id);
  bus.emit('trip.requested', rider.displayName, { tripId: id, productId: input.productId }, id, ctx.now);
  return trip;
}

function createOrderInternal(
  ctx: TickCtx,
  input: { customerId: ID; merchantId: ID; productId: ID },
): Order | undefined {
  const market = getMarket(ctx.state.marketId);
  const customer = ctx.state.riders[input.customerId];
  const merchant = ctx.state.merchants[input.merchantId];
  if (!customer || !merchant) return undefined;

  const items = [...menuIndex(merchant).values()].filter((i) => i.available);
  if (items.length === 0) return undefined;

  const lines = Array.from({ length: ctx.rng.int(1, 4) }, () => {
    const item = ctx.rng.pickWeighted(items, (i) => (i.popular ? 3 : 1));
    const quantity = ctx.rng.pickWeighted([1, 1, 2], (q) => 3 - q);
    const selections = item.modifierGroups
      .filter((g) => g.required)
      .map((g) => {
        const opts = g.options.filter((o) => o.available);
        const chosen = opts.length ? [ctx.rng.pick(opts)] : [];
        return {
          groupId: g.id,
          groupName: g.name,
          optionIds: chosen.map((o) => o.id),
          optionNames: chosen.map((o) => o.name),
          priceDelta: round2(chosen.reduce((a, o) => a + o.priceDelta, 0)),
        };
      });
    const unitPrice = round2(item.price + selections.reduce((a, s) => a + s.priceDelta, 0));
    return {
      id: nextId('oln'),
      itemId: item.id,
      name: item.name,
      unitPrice,
      quantity,
      selections,
      lineTotal: round2(unitPrice * quantity),
      fulfilment: 'pending' as const,
    };
  });

  const goodsSubtotal = round2(lines.reduce((a, l) => a + l.lineTotal, 0));
  const dropAt = ctx.rng.bool(0.7) ? customer.savedPlaces[0].at : randomDemandPoint(market, ctx.rng);
  const route = findRoute(ctx.dispatchCtx.graph, market, merchant.at, dropAt, {
    hourOfDay: ctx.hourOfDay,
    speedFactor: 1,
    congestionFactor: 1,
  });

  const quote = buildQuote({
    productId: input.productId,
    marketId: ctx.state.marketId,
    distanceKm: route.distanceM / 1000,
    durationMin: route.durationSec / 60,
    goodsSubtotal,
    packagingFee: merchant.settings.packagingFee,
    surgeMultiplier: surgeAt(ctx.state, market, merchant.at),
    now: ctx.now,
  });

  const id = nextId('ord');
  const order: Order = {
    id,
    code: referenceCode('ORD', ctx.now + Object.keys(ctx.state.orders).length),
    kind: 'order',
    marketId: ctx.state.marketId,
    productId: input.productId,
    customerId: customer.id,
    merchantId: merchant.id,
    status: 'placed',
    lines,
    stops: [
      {
        id: nextId('stp'),
        jobId: id,
        kind: 'merchant',
        place: makePlace(ctx.state.marketId, merchant.at, merchant.name, 'merchant'),
        sequence: 0,
      },
      { id: nextId('stp'), jobId: id, kind: 'dropoff', place: makePlace(ctx.state.marketId, dropAt), sequence: 1 },
    ],
    quote,
    placedAt: ctx.now,
    paymentMethodId: customer.defaultPaymentMethodId,
    dropoffPreference: ctx.rng.pick(['hand_it_to_me', 'leave_at_door', 'meet_outside'] as const),
    utensils: ctx.rng.bool(0.5),
    timeline: [{ status: 'placed', at: ctx.now, actor: customer.displayName }],
    messages: [],
  };

  ctx.state.orders[id] = order;
  ctx.touched.orders.push(id);
  return order;
}

/* ------------------------------------------------------------------ */
/* Merchants                                                           */
/* ------------------------------------------------------------------ */

function updateMerchants(ctx: TickCtx): void {
  const openOrders = new Map<ID, number>();
  for (const order of Object.values(ctx.state.orders)) {
    if (['merchant_review', 'preparing'].includes(order.status)) {
      openOrders.set(order.merchantId, (openOrders.get(order.merchantId) ?? 0) + 1);
    }
  }

  for (const merchant of Object.values(ctx.state.merchants) as Merchant[]) {
    if (merchant.marketId !== ctx.state.marketId) continue;
    const shouldBeOpen = isOpenNow(merchant, ctx.hourOfDay) && !merchant.settings.paused;
    const prep = recomputePrepMinutes(merchant, openOrders.get(merchant.id) ?? 0);
    if (merchant.isOpen === shouldBeOpen && merchant.currentPrepMinutes === prep) continue;

    if (merchant.isOpen !== shouldBeOpen) {
      bus.emit(shouldBeOpen ? 'merchant.opened' : 'merchant.closed', merchant.name, { merchantId: merchant.id }, merchant.id, ctx.now);
    }
    ctx.state.merchants[merchant.id] = { ...merchant, isOpen: shouldBeOpen, currentPrepMinutes: prep };
  }
}

const isOpenNow = (merchant: Merchant, hour: number): boolean =>
  merchant.hours.close > 24
    ? hour >= merchant.hours.open || hour < merchant.hours.close - 24
    : hour >= merchant.hours.open && hour < merchant.hours.close;

/* ------------------------------------------------------------------ */
/* The tick                                                            */
/* ------------------------------------------------------------------ */

let tickCounter = 0;

/**
 * Advance the world by `deltaSec` simulated seconds. Returns a new state —
 * callers should treat the input as immutable even though the internals
 * mutate a working copy for speed.
 */
export function tick(input: WorldState, deltaSec = appConfig.simulation.secondsPerTick): TickResult {
  const now = input.now + deltaSec * 1000;
  const market = getMarket(input.marketId);
  const hourOfDay = new Date(now).getHours();

  // Shallow-clone the collections we mutate; entities themselves stay immutable.
  const state: WorldState = {
    ...input,
    now,
    drivers: { ...input.drivers },
    trips: { ...input.trips },
    orders: { ...input.orders },
    offers: { ...input.offers },
    merchants: { ...input.merchants },
    riders: { ...input.riders },
  };

  const ctx: TickCtx = {
    state,
    now,
    deltaSec,
    hourOfDay,
    rng: createRng(appConfig.simulation.seed + tickCounter++),
    dispatchCtx: { graph: graphFor(input.marketId), market, now, hourOfDay },
    touched: { drivers: [], trips: [], orders: [], offers: [] },
    ledger: [],
  };

  // 1. Move every vehicle that has somewhere to be.
  for (const driver of Object.values(state.drivers)) {
    if (driver.marketId !== state.marketId) continue;
    if (driver.status === 'offline') continue;

    if (driver.activeJobId && driver.activeRoute) {
      const { driver: moved } = advanceDriver(driver, ctx);
      state.drivers[driver.id] = moved;
      ctx.touched.drivers.push(driver.id);
    } else if (!driver.activeJobId) {
      state.drivers[driver.id] = repositionIdleDriver(driver, ctx);
    }
  }

  // 2. Resolve outstanding offers.
  resolveAutoOffers(ctx);

  // 3. Advance job lifecycles.
  progressTrips(ctx);
  progressOrders(ctx);

  // 4. Merchant state and ambient demand.
  updateMerchants(ctx);
  generateAmbientDemand(ctx);

  // 5. Recompute market signals.
  state.zoneSnapshots = computeZoneSnapshots(state, market, now);

  if (ctx.ledger.length > 0) {
    state.ledger = [...state.ledger, ...ctx.ledger];
    // Keep the ledger bounded — the ops console only ever shows a window.
    if (state.ledger.length > 4000) state.ledger = state.ledger.slice(-4000);
  }

  return { state, touched: ctx.touched };
}

/**
 * Build a TickCtx for one-off imperative actions issued by a surface (a human
 * driver accepting an offer, for example) so those paths reuse the exact same
 * code the simulator runs.
 */
export function actionContext(state: WorldState, now = state.now): TickCtx {
  const market = getMarket(state.marketId);
  const hourOfDay = new Date(now).getHours();
  return {
    state,
    now,
    deltaSec: 0,
    hourOfDay,
    rng: createRng(appConfig.simulation.seed + tickCounter++),
    dispatchCtx: { graph: graphFor(state.marketId), market, now, hourOfDay },
    touched: { drivers: [], trips: [], orders: [], offers: [] },
    ledger: [],
  };
}

export type { TickCtx };
export { offerJob, createTripInternal, createOrderInternal, routeOptionsFor };
export { driverPayConfig, haversineKm };
