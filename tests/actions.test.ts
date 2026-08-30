/**
 * The action layer — the business logic the surfaces actually call. These
 * exercise the same functions the UI does, against a real generated world.
 */
import { describe, expect, it } from 'vitest';
import { defaultMarketId, orgConfig } from '@config';
import { actionContext } from '@core/sim';
import type { TickCtx } from '@core/sim';
import { seedWorld } from '@data/seed';
import type { WorldState } from '@data/ports';
import * as riderActions from '@platform/actions/rider';
import * as eatsActions from '@platform/actions/eats';
import * as driverActions from '@platform/actions/driver';
import * as merchantActions from '@platform/actions/merchant';
import * as businessActions from '@platform/actions/business';
import * as adminActions from '@platform/actions/admin';

const MARKET = defaultMarketId;
const NOON = new Date(2026, 4, 20, 12, 40, 0).getTime();

/** Mirrors the store's mutate(): clone the collections, run the action. */
function apply<T>(state: WorldState, mutator: (draft: WorldState, ctx: TickCtx) => T): { state: WorldState; result: T } {
  const draft: WorldState = {
    ...state,
    riders: { ...state.riders },
    drivers: { ...state.drivers },
    merchants: { ...state.merchants },
    orgs: { ...state.orgs },
    trips: { ...state.trips },
    orders: { ...state.orders },
    offers: { ...state.offers },
    ledger: [...state.ledger],
    session: { ...state.session },
  };
  const ctx = actionContext(draft);
  const result = mutator(draft, ctx);
  draft.ledger = [...draft.ledger, ...ctx.ledger];
  return { state: draft, result };
}

const world = () => seedWorld(MARKET, NOON);

describe('rider actions', () => {
  it('quotes every product against one route so prices are comparable', () => {
    const state = world();
    const rider = state.riders[state.session.riderId];
    const stops = [rider.savedPlaces[0].at, rider.savedPlaces[1].at];
    const quotes = riderActions.quoteProducts(state, ['go', 'comfort', 'xl'], stops, undefined, rider.id);

    const distances = Object.values(quotes).map((q) => q.distanceKm);
    for (const d of distances) expect(d).toBeCloseTo(distances[0], 2);
    expect(quotes.comfort.quote.total).toBeGreaterThan(quotes.go.quote.total);
  });

  it('creates a request with stops, a quote and a timeline', () => {
    const state = world();
    const rider = state.riders[state.session.riderId];
    const { state: next, result: tripId } = apply(state, (draft, ctx) =>
      riderActions.requestTrip(
        {
          productId: 'go',
          stops: [rider.savedPlaces[0], rider.savedPlaces[1]],
          paymentMethodId: rider.defaultPaymentMethodId,
        },
        rider.id,
      )(draft, ctx),
    );

    expect(tripId).toBeDefined();
    const trip = next.trips[tripId!];
    expect(trip.status).toBe('requested');
    expect(trip.stops).toHaveLength(2);
    expect(trip.stops[0].kind).toBe('pickup');
    expect(trip.stops[1].kind).toBe('dropoff');
    expect(trip.quote.total).toBeGreaterThan(0);
    expect(trip.timeline).toHaveLength(1);
  });

  it('books for later as a scheduled trip', () => {
    const state = world();
    const rider = state.riders[state.session.riderId];
    const { state: next, result: tripId } = apply(state, (draft, ctx) =>
      riderActions.requestTrip(
        {
          productId: 'go',
          stops: [rider.savedPlaces[0], rider.savedPlaces[1]],
          paymentMethodId: rider.defaultPaymentMethodId,
          scheduledFor: state.now + 45 * 60_000,
        },
        rider.id,
      )(draft, ctx),
    );
    expect(next.trips[tripId!].status).toBe('scheduled');
  });

  it('records a promotion redemption when one is applied', () => {
    const state = world();
    const rider = Object.values(state.riders).find((r) => state.now - r.createdAt < 20 * 86_400_000);
    if (!rider) return;
    const { state: next, result: tripId } = apply(state, (draft, ctx) =>
      riderActions.requestTrip(
        {
          productId: 'go',
          stops: [rider.savedPlaces[0], rider.savedPlaces[1]],
          paymentMethodId: rider.defaultPaymentMethodId,
          promotionCode: 'WELCOME50',
        },
        rider.id,
      )(draft, ctx),
    );
    const trip = next.trips[tripId!];
    if (trip.quote.promotionId) {
      expect(next.riders[rider.id].promoRedemptions[trip.quote.promotionId]).toBe(1);
      expect(trip.quote.discount).toBeGreaterThan(0);
    }
  });

  it('cancels inside the grace window without charging', () => {
    const state = world();
    const rider = state.riders[state.session.riderId];
    const created = apply(state, (draft, ctx) =>
      riderActions.requestTrip(
        { productId: 'go', stops: [rider.savedPlaces[0], rider.savedPlaces[1]], paymentMethodId: 'card' },
        rider.id,
      )(draft, ctx),
    );
    const ledgerBefore = created.state.ledger.length;
    const cancelled = apply(created.state, (draft, ctx) =>
      riderActions.cancelTrip(created.result!, 'rider', 'plans-changed')(draft, ctx),
    );
    expect(cancelled.state.trips[created.result!].status).toBe('cancelled');
    expect(cancelled.state.ledger.length).toBe(ledgerBefore);
  });

  it('moves the counterparty rating when a trip is rated', () => {
    const state = world();
    const trip = Object.values(state.trips).find((t) => t.status === 'completed' && t.driverId && !t.riderRating)!;
    const before = state.drivers[trip.driverId!].ratingCount;
    const { state: next } = apply(state, (draft, ctx) =>
      riderActions.rateTrip(trip.id, { stars: 5, tags: [], tip: 3, at: state.now }, 'rider')(draft, ctx),
    );
    expect(next.drivers[trip.driverId!].ratingCount).toBe(before + 1);
    expect(next.ledger.some((e) => e.kind === 'tip' && e.amount === 3)).toBe(true);
  });

  it('blocks a booking that breaches a blocking policy rule', () => {
    const state = world();
    const rider = Object.values(state.riders).find((r) => r.orgMembership)!;
    const org = state.orgs[rider.orgMembership!.orgId];
    const banned = ['go', 'comfort', 'share', 'xl', 'black', 'assist', 'moto'].find(
      (id) => !org.allowedProductIds.includes(id),
    );
    const hasAllowlist = org.policyRuleIds.includes('pol-products');
    if (!banned || !hasAllowlist) return;

    const policy = riderActions.evaluatePolicy(state, org.id, banned, 20, rider.id);
    expect(policy.blocked).toBe(true);

    const { result } = apply(state, (draft, ctx) =>
      riderActions.requestTrip(
        {
          productId: banned,
          stops: [rider.savedPlaces[0], rider.savedPlaces[1]],
          paymentMethodId: 'corporate',
          orgContext: { orgId: org.id, expenseCodeId: orgConfig.expenseCodes[0].id },
        },
        rider.id,
      )(draft, ctx),
    );
    expect(result).toBeUndefined();
  });

  it('flags an over-cap booking for approval rather than blocking it', () => {
    const state = world();
    const rider = Object.values(state.riders).find(
      (r) => r.orgMembership && state.orgs[r.orgMembership.orgId].policyRuleIds.includes('pol-cap'),
    );
    if (!rider) return;
    const org = state.orgs[rider.orgMembership!.orgId];
    const policy = riderActions.evaluatePolicy(state, org.id, org.allowedProductIds[0], 5000, rider.id);
    expect(policy.requiresApproval).toBe(true);
    expect(policy.blocked).toBe(false);
  });
});

describe('cart and ordering', () => {
  const state = world();
  const merchant = Object.values(state.merchants).find((m) => m.menu.some((s) => s.items.length > 0))!;
  const item = merchant.menu.flatMap((s) => s.items)[0];

  it('merges an identical repeat pick into one line', () => {
    let cart = eatsActions.emptyCart();
    cart = eatsActions.addToCart(cart, merchant.id, item, [], 1);
    cart = eatsActions.addToCart(cart, merchant.id, item, [], 2);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(3);
  });

  it('keeps different modifier selections as separate lines', () => {
    const withMods = merchant.menu.flatMap((s) => s.items).find((i) => i.modifierGroups.length > 0);
    if (!withMods) return;
    const group = withMods.modifierGroups[0];
    let cart = eatsActions.emptyCart();
    cart = eatsActions.addToCart(cart, merchant.id, withMods, [], 1);
    cart = eatsActions.addToCart(
      cart,
      merchant.id,
      withMods,
      [
        {
          groupId: group.id,
          groupName: group.name,
          optionIds: [group.options[0].id],
          optionNames: [group.options[0].name],
          priceDelta: group.options[0].priceDelta,
        },
      ],
      1,
    );
    expect(cart.lines).toHaveLength(2);
  });

  it('empties the cart when a line is reduced to zero', () => {
    let cart = eatsActions.addToCart(eatsActions.emptyCart(), merchant.id, item, [], 1);
    cart = eatsActions.setLineQuantity(cart, cart.lines[0].id, 0);
    expect(cart.lines).toHaveLength(0);
    expect(cart.merchantId).toBeUndefined();
  });

  it('replaces the cart when the shopper switches merchant', () => {
    const other = Object.values(state.merchants).find(
      (m) => m.id !== merchant.id && m.menu.some((s) => s.items.length > 0),
    )!;
    const otherItem = other.menu.flatMap((s) => s.items)[0];
    let cart = eatsActions.addToCart(eatsActions.emptyCart(), merchant.id, item, [], 2);
    cart = eatsActions.addToCart(cart, other.id, otherItem, [], 1);
    expect(cart.merchantId).toBe(other.id);
    expect(cart.lines).toHaveLength(1);
  });

  it('places an order carrying the cart, stops and a priced quote', () => {
    const customer = state.riders[state.session.riderId];
    const cart = eatsActions.addToCart(eatsActions.emptyCart(), merchant.id, item, [], 2);
    const { state: next, result: orderId } = apply(state, (draft, ctx) =>
      eatsActions.placeOrder(cart, customer.id, customer.savedPlaces[0], customer.defaultPaymentMethodId)(draft, ctx),
    );
    const order = next.orders[orderId!];
    expect(order.status).toBe('placed');
    expect(order.lines).toHaveLength(1);
    expect(order.stops[0].kind).toBe('merchant');
    expect(order.quote.total).toBeGreaterThan(eatsActions.cartGoodsSubtotal(cart));
  });
});

describe('earner actions', () => {
  it('resets the session when going online and preserves lifetime totals', () => {
    const state = world();
    const driver = Object.values(state.drivers).find((d) => d.status === 'offline' && d.optedProductIds.length > 0)!;
    const { state: next } = apply(state, (draft) => driverActions.goOnline(driver.id)(draft));
    expect(next.drivers[driver.id].status).toBe('online');
    expect(next.drivers[driver.id].session.earnings).toBe(0);
    expect(next.drivers[driver.id].lifetime.jobs).toBe(driver.lifetime.jobs);
  });

  it('defers going offline until the current job is finished', () => {
    const state = world();
    const busy = Object.values(state.drivers).find((d) => d.activeJobId);
    if (!busy) return;
    const { state: next } = apply(state, (draft) => driverActions.goOffline(busy.id)(draft));
    expect(next.drivers[busy.id].status).toBe('paused');
    expect(next.drivers[busy.id].activeJobId).toBe(busy.activeJobId);
  });

  it('lowers the acceptance rate when an offer is declined', () => {
    const state = world();
    const driver = Object.values(state.drivers).find((d) => d.status === 'online')!;
    const withOffer: WorldState = {
      ...state,
      offers: {
        ofr_test: {
          id: 'ofr_test',
          jobId: Object.keys(state.trips)[0],
          jobKind: 'trip',
          driverId: driver.id,
          status: 'pending',
          createdAt: state.now,
          expiresAt: state.now + 25_000,
          preview: {
            productName: 'Go',
            payout: 8,
            tripDistanceKm: 4,
            approachDistanceKm: 1,
            approachMinutes: 3,
            totalMinutes: 14,
            pickupLabel: 'A',
            dropoffLabel: 'B',
            riderRating: 4.9,
            surgeMultiplier: 1,
            includesTipEstimate: false,
          },
          score: { total: 0.7, proximity: 0.8, rating: 0.8, idleTime: 0.3, acceptance: 0.8, fairness: 1 },
        },
      },
    };
    const { state: next } = apply(withOffer, (draft) => driverActions.declineOffer('ofr_test')(draft));
    expect(next.offers.ofr_test.status).toBe('declined');
    expect(next.drivers[driver.id].acceptanceRate).toBeLessThan(driver.acceptanceRate);
  });

  it('only offers products the vehicle and certifications allow', () => {
    const state = world();
    const driver = Object.values(state.drivers)[0];
    for (const product of driverActions.availableProductsFor(state, driver.id)) {
      expect(product.eligibleVehicleClasses).toContain(driver.vehicle.classId);
      for (const tag of product.dispatch.requiredDriverTags) expect(driver.tags).toContain(tag);
    }
  });

  it('writes an instant cash out and its fee to the ledger', () => {
    const state = world();
    const driver = Object.values(state.drivers)[0];
    const { state: next } = apply(state, (draft, ctx) => driverActions.cashOut(driver.id, 50)(draft, ctx));
    const added = next.ledger.slice(state.ledger.length);
    expect(added).toHaveLength(2);
    expect(added.every((e) => e.amount < 0)).toBe(true);
  });
});

describe('merchant actions', () => {
  it('buckets the queue by what needs attention', () => {
    const state = world();
    const merchantId = state.session.merchantId;
    const queue = merchantActions.merchantQueue(state, merchantId);
    expect(Object.keys(queue)).toEqual(['incoming', 'preparing', 'ready', 'inTransit', 'completed']);
    for (const order of queue.incoming) expect(order.status).toBe('merchant_review');
  });

  it('removes an unavailable item from what can be sold', () => {
    const state = world();
    const merchant = state.merchants[state.session.merchantId];
    const item = merchant.menu.flatMap((s) => s.items).find((i) => i.available)!;
    const { state: next } = apply(state, (draft) =>
      merchantActions.setItemAvailability(merchant.id, item.id, false)(draft),
    );
    const updated = next.merchants[merchant.id].menu.flatMap((s) => s.items).find((i) => i.id === item.id)!;
    expect(updated.available).toBe(false);
  });

  it('closes the storefront when it is paused', () => {
    const state = world();
    const merchant = state.merchants[state.session.merchantId];
    const { state: next } = apply(state, (draft) => merchantActions.pauseStore(merchant.id, 30)(draft));
    expect(next.merchants[merchant.id].settings.paused).toBe(true);
    expect(next.merchants[merchant.id].isOpen).toBe(false);
  });

  it("derives today's figures from the orders themselves", () => {
    const state = world();
    const merchantId = state.session.merchantId;
    const today = merchantActions.merchantToday(state, merchantId);
    const dayStart = new Date(state.now);
    dayStart.setHours(0, 0, 0, 0);
    const expected = Object.values(state.orders).filter(
      (o) => o.merchantId === merchantId && o.placedAt >= dayStart.getTime(),
    ).length;
    expect(today.orders).toBe(expected);
  });

  it('nets commission out of the payout summary', () => {
    const state = world();
    const summary = merchantActions.merchantPayoutSummary(state, state.session.merchantId);
    expect(summary.net).toBeCloseTo(summary.gross - summary.commission, 2);
  });
});

describe('business and ops reporting', () => {
  it('reconciles every report against the same total', () => {
    const state = world();
    const orgId = state.session.orgId;
    const totals = orgConfig.reports.map((report) =>
      Math.round(businessActions.buildReport(state, orgId, report.id).reduce((acc, r) => acc + r.amount, 0) * 100) / 100,
    );
    for (const total of totals) expect(total).toBeCloseTo(totals[0], 0);
  });

  it('returns the daily series in chronological order', () => {
    const state = world();
    const rows = businessActions.buildReport(state, state.session.orgId, 'rep-day');
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('resolves an approval on the underlying journey', () => {
    const state = world();
    const pending = businessActions.pendingApprovals(state, state.session.orgId)[0];
    if (!pending) return;
    const { state: next } = apply(state, (draft) =>
      businessActions.resolveApproval(pending.id, true)(draft),
    );
    const updated = next.trips[pending.id] ?? next.orders[pending.id];
    expect(updated.orgContext?.approvalStatus).toBe('approved');
  });

  it('summarises the marketplace consistently with the world', () => {
    const state = world();
    const snapshot = adminActions.marketplaceSnapshot(state);
    const online = Object.values(state.drivers).filter(
      (d) => d.marketId === state.marketId && d.status !== 'offline',
    ).length;
    expect(snapshot.onlineDrivers).toBe(online);
    expect(snapshot.busyDrivers + snapshot.idleDrivers).toBe(snapshot.onlineDrivers);
    expect(snapshot.utilisation).toBeGreaterThanOrEqual(0);
    expect(snapshot.utilisation).toBeLessThanOrEqual(1);
  });

  it('explains a dispatch decision for every driver in the market', () => {
    const state = world();
    const job = Object.values(state.trips)[0];
    const explained = adminActions.dispatchExplain(state, job.id)!;
    for (const rejection of explained.rejected) expect(rejection.reasons.length).toBeGreaterThan(0);
    expect(explained.eligible.length + explained.rejected.length).toBeGreaterThan(0);
  });

  it('reports a product mix whose shares sum to one', () => {
    const state = world();
    const mix = adminActions.productMix(state);
    const total = mix.reduce((acc, row) => acc + row.share, 0);
    if (mix.length > 0) expect(total).toBeCloseTo(1, 1);
  });
});
