/**
 * Dispatch, lifecycle, world generation and the simulation loop.
 *
 * These are the tests that would have caught the defects found by hand while
 * building the surfaces: offers expiring before they could be decided, courier
 * assignment stalling a merchant's prep clock, and a seeded RNG that produced
 * identical entities.
 */
import { describe, expect, it } from 'vitest';
import { appConfig, defaultMarketId, getMarket, getProductsForMarket } from '@config';
import { evaluateEligibility, scoreCandidates, dispatch, type DispatchContext } from '@core/dispatch';
import {
  canTransitionTrip,
  orderTransitionsFrom,
  tripTransitionsFrom,
  ORDER_TERMINAL,
  TRIP_TERMINAL,
} from '@core/lifecycle';
import { graphFor } from '@core/routing';
import { tick } from '@core/sim';
import { createRng } from '@core/util';
import { seedWorld } from '@data/seed';
import type { WorldState } from '@data/ports';

const MARKET = defaultMarketId;
const NOON = new Date(2026, 4, 20, 12, 40, 0).getTime();

const world = (): WorldState => seedWorld(MARKET, NOON);

const advance = (state: WorldState, ticks: number, deltaSec = 30): WorldState => {
  let current = state;
  for (let i = 0; i < ticks; i++) current = tick(current, deltaSec).state;
  return current;
};

describe('seeded randomness', () => {
  it('produces different streams from repeated forks with the same salt', () => {
    const rng = createRng('parent');
    const a = rng.fork('child').next();
    const b = rng.fork('child').next();
    expect(a).not.toBe(b);
  });

  it('is reproducible for the same seed', () => {
    expect(createRng(42).next()).toBe(createRng(42).next());
  });

  it('respects weights', () => {
    const rng = createRng('weights');
    const items = ['a', 'b'];
    const picks = Array.from({ length: 400 }, () => rng.pickWeighted(items, (i) => (i === 'a' ? 9 : 1)));
    expect(picks.filter((p) => p === 'a').length).toBeGreaterThan(300);
  });
});

describe('world generation', () => {
  const state = world();

  it('generates a distinct population rather than clones', () => {
    const drivers = Object.values(state.drivers);
    expect(drivers.length).toBeGreaterThan(20);
    expect(new Set(drivers.map((d) => d.vehicle.plate)).size).toBeGreaterThan(drivers.length * 0.9);
    expect(new Set(drivers.map((d) => `${d.at.lat},${d.at.lng}`)).size).toBe(drivers.length);
    expect(new Set(Object.values(state.merchants).map((m) => m.name)).size).toBe(
      Object.keys(state.merchants).length,
    );
  });

  it('is deterministic for a given seed and market', () => {
    const a = seedWorld(MARKET, NOON);
    const b = seedWorld(MARKET, NOON);
    expect(Object.keys(a.drivers).length).toBe(Object.keys(b.drivers).length);
    expect(Object.values(a.drivers)[5].displayName).toBe(Object.values(b.drivers)[5].displayName);
  });

  it('never dates a completed job in the future', () => {
    for (const trip of Object.values(state.trips)) {
      if (trip.completedAt) expect(trip.completedAt).toBeLessThanOrEqual(state.now);
      expect(trip.requestedAt).toBeLessThanOrEqual(state.now);
    }
    for (const order of Object.values(state.orders)) {
      if (order.deliveredAt) expect(order.deliveredAt).toBeLessThanOrEqual(state.now);
      expect(order.placedAt).toBeLessThanOrEqual(state.now);
    }
  });

  it('never lists the same item twice on one order', () => {
    for (const order of Object.values(state.orders)) {
      const signatures = order.lines.map(
        (l) => `${l.itemId}|${l.selections.map((s) => s.optionIds.join(',')).join('|')}`,
      );
      expect(new Set(signatures).size).toBe(signatures.length);
    }
  });

  it('gives every enabled product some eligible supply', () => {
    for (const product of getProductsForMarket(MARKET)) {
      const eligible = Object.values(state.drivers).filter(
        (d) =>
          d.optedProductIds.includes(product.id) &&
          product.eligibleVehicleClasses.includes(d.vehicle.classId),
      );
      expect(eligible.length, `no supply for ${product.id}`).toBeGreaterThan(0);
    }
  });

  it('reconciles the session pointers with the generated world', () => {
    expect(state.riders[state.session.riderId]).toBeDefined();
    expect(state.drivers[state.session.driverId]).toBeDefined();
    expect(state.merchants[state.session.merchantId]).toBeDefined();
    expect(state.orgs[state.session.orgId]).toBeDefined();
  });
});

describe('dispatch', () => {
  const state = world();
  const ctx: DispatchContext = {
    graph: graphFor(MARKET),
    market: getMarket(MARKET),
    now: state.now,
    hourOfDay: 12,
  };

  const anyTrip = Object.values(state.trips)[0];

  it('rejects an offline earner with a stated reason', () => {
    const offline = Object.values(state.drivers).find((d) => d.status === 'offline')!;
    const result = evaluateEligibility(offline, anyTrip, ctx);
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/offline/);
  });

  it('rejects an earner who has not opted into the product', () => {
    const driver = Object.values(state.drivers).find(
      (d) => d.status === 'online' && !d.optedProductIds.includes(anyTrip.productId),
    );
    if (!driver) return;
    expect(evaluateEligibility(driver, anyTrip, ctx).reasons).toContain('Not opted into product');
  });

  it('ranks candidates highest-score first and stays within bounds', () => {
    const drivers = Object.values(state.drivers);
    const evaluations = drivers.map((d) => evaluateEligibility(d, anyTrip, ctx));
    const ranked = scoreCandidates(evaluations, anyTrip, ctx);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score.total).toBeGreaterThanOrEqual(ranked[i].score.total);
    }
    for (const candidate of ranked) {
      for (const component of ['proximity', 'rating', 'idleTime', 'acceptance', 'fairness'] as const) {
        expect(candidate.score[component]).toBeGreaterThanOrEqual(0);
        expect(candidate.score[component]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never fans out beyond the configured offer limit', () => {
    const { offers } = dispatch(anyTrip, Object.values(state.drivers), ctx, {
      payout: anyTrip.quote.earnerPayout,
      riderRating: 5,
    });
    expect(offers.length).toBeLessThanOrEqual(appConfig.limits.maxOffersPerRequest);
    for (const offer of offers) {
      expect(offer.expiresAt - offer.createdAt).toBe(appConfig.limits.offerTimeoutSec * 1000);
    }
  });

  it('does not re-offer to an earner already excluded', () => {
    const drivers = Object.values(state.drivers);
    const first = dispatch(anyTrip, drivers, ctx, { payout: 10, riderRating: 5 });
    const excluded = first.offers.map((o) => o.driverId);
    const second = dispatch(anyTrip, drivers, { ...ctx, excludeDriverIds: excluded }, { payout: 10, riderRating: 5 });
    for (const offer of second.offers) expect(excluded).not.toContain(offer.driverId);
  });
});

describe('lifecycle', () => {
  it('permits only the declared actors on a transition', () => {
    expect(canTransitionTrip('waiting', 'in_progress', 'driver')).toBe(true);
    expect(canTransitionTrip('waiting', 'in_progress', 'rider')).toBe(false);
    expect(canTransitionTrip('completed', 'in_progress', 'driver')).toBe(false);
  });

  it('leaves no transitions out of a terminal state', () => {
    for (const status of TRIP_TERMINAL) expect(tripTransitionsFrom(status)).toHaveLength(0);
    for (const status of ORDER_TERMINAL) expect(orderTransitionsFrom(status)).toHaveLength(0);
  });

  it('offers a way forward from every non-terminal state', () => {
    const tripStates = ['draft', 'scheduled', 'requested', 'searching', 'assigned', 'arriving', 'waiting', 'in_progress'] as const;
    for (const status of tripStates) expect(tripTransitionsFrom(status).length).toBeGreaterThan(0);
  });
});

describe('simulation', () => {
  it('advances the clock by exactly the requested amount', () => {
    const start = world();
    const next = tick(start, 60).state;
    expect(next.now - start.now).toBe(60_000);
  });

  it('does not mutate the state it was given', () => {
    const start = world();
    const before = JSON.stringify(start.drivers[Object.keys(start.drivers)[0]].at);
    advance(start, 20);
    expect(JSON.stringify(start.drivers[Object.keys(start.drivers)[0]].at)).toBe(before);
  });

  it('matches requests to earners rather than expiring every offer', () => {
    // The defect this guards against: at larger tick sizes an offer's expiry was
    // evaluated before the earner's decision, so nothing was ever accepted.
    const end = advance(world(), 60, 30);
    const offers = Object.values(end.offers);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.filter((o) => o.status === 'accepted').length).toBeGreaterThan(0);
  });

  it('matches requests even when one tick spans the whole offer window', () => {
    const end = advance(world(), 25, appConfig.limits.offerTimeoutSec * 4);
    expect(Object.values(end.offers).filter((o) => o.status === 'accepted').length).toBeGreaterThan(0);
  });

  it('carries orders through preparation to a courier pickup', () => {
    const end = advance(world(), 90, 30);
    const orders = Object.values(end.orders);
    // A courier must never be stuck at a merchant whose kitchen clock stopped.
    const strandedAtMerchant = orders.filter(
      (o) => o.status === 'courier_at_merchant' && !o.readyAt && end.now - (o.merchantAcceptedAt ?? o.placedAt) > 60 * 60_000,
    );
    expect(strandedAtMerchant).toHaveLength(0);
    expect(orders.some((o) => ['picked_up', 'delivering', 'delivered'].includes(o.status))).toBe(true);
  });

  it('moves assigned vehicles', () => {
    const start = world();
    const end = advance(start, 40, 30);
    const moved = Object.values(end.drivers).filter((driver) => {
      const before = start.drivers[driver.id];
      return before && (before.at.lat !== driver.at.lat || before.at.lng !== driver.at.lng);
    });
    expect(moved.length).toBeGreaterThan(0);
  });

  it('keeps surge inside its band and recomputes every zone', () => {
    const end = advance(world(), 30, 30);
    const zones = getMarket(MARKET).zones;
    expect(Object.keys(end.zoneSnapshots)).toHaveLength(zones.length);
    for (const snapshot of Object.values(end.zoneSnapshots)) {
      expect(snapshot.surgeMultiplier).toBeGreaterThanOrEqual(1);
      expect(snapshot.surgeMultiplier).toBeLessThanOrEqual(3.5);
    }
  });

  it('settles completed work into the ledger', () => {
    const start = world();
    const end = advance(start, 120, 30);
    expect(end.ledger.length).toBeGreaterThan(start.ledger.length);
    const settled = Object.values(end.trips).filter((t) => t.status === 'completed' && t.settlement);
    for (const trip of settled.slice(0, 20)) {
      expect(trip.settlement!.total).toBeGreaterThan(0);
      expect(trip.settlement!.earnerPayout).toBeGreaterThan(0);
      expect(trip.settlement!.earnerPayout).toBeLessThanOrEqual(trip.settlement!.total);
    }
  });

  it('does not leave requests searching forever', () => {
    const end = advance(world(), 200, 30);
    const stuck = Object.values(end.trips).filter(
      (t) => ['searching', 'requested'].includes(t.status) && end.now - t.requestedAt > 60 * 60_000,
    );
    expect(stuck).toHaveLength(0);
  });

  it('never assigns one earner to two jobs at once', () => {
    const end = advance(world(), 120, 30);
    const assignments = new Map<string, string[]>();
    for (const trip of Object.values(end.trips)) {
      if (trip.driverId && !TRIP_TERMINAL.includes(trip.status)) {
        assignments.set(trip.driverId, [...(assignments.get(trip.driverId) ?? []), trip.id]);
      }
    }
    for (const order of Object.values(end.orders)) {
      if (order.courierId && !ORDER_TERMINAL.includes(order.status)) {
        assignments.set(order.courierId, [...(assignments.get(order.courierId) ?? []), order.id]);
      }
    }
    for (const [driverId, jobs] of assignments) {
      expect(jobs.length, `${driverId} holds ${jobs.length} live jobs`).toBe(1);
    }
  });
});
