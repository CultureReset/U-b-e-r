/**
 * Earner actions. Going online, responding to offers, and driving each stage
 * of a job to completion — the same transitions the simulator applies to AI
 * drivers, so the human earner is not a special case.
 */
import {
  appConfig,
  driverTiers,
  getMarket,
  getProductsForMarket,
  getTierForPoints,
  incentives,
  payoutConfig,
} from '@config';
import { bus } from '@core/events';
import { findRoute } from '@core/routing';
import type { ID, RatingRecord } from '@core/types';
import { nextId, round2 } from '@core/util';
import type { WorldState } from '@data';
import {
  acceptOfferInternal,
  completeTripInternal,
  deliverOrderInternal,
  pickUpOrderInternal,
  startTripInternal,
  routeOptionsFor,
  type TickCtx,
} from '@core/sim';

export function goOnline(driverId: ID) {
  return (state: WorldState): void => {
    const driver = state.drivers[driverId];
    if (!driver || driver.status === 'online') return;
    state.drivers[driverId] = {
      ...driver,
      status: 'online',
      onlineSince: state.now,
      session: { earnings: 0, jobs: 0, onlineSec: 0, distanceKm: 0, tips: 0, promotions: 0 },
      streakCount: 0,
    };
    bus.emit('driver.online', driver.displayName, { driverId }, driverId, state.now);
  };
}

export function goOffline(driverId: ID) {
  return (state: WorldState): void => {
    const driver = state.drivers[driverId];
    if (!driver || driver.status === 'offline') return;
    // An earner mid-job stays on the job; going offline takes effect after it.
    if (driver.activeJobId) {
      state.drivers[driverId] = { ...driver, status: 'paused' };
      bus.emit('driver.paused', driver.displayName, { driverId }, driverId, state.now);
      return;
    }
    state.drivers[driverId] = {
      ...driver,
      status: 'offline',
      onlineSince: undefined,
      activeRoute: undefined,
      speedKph: 0,
    };
    // Withdraw any offers they were still holding.
    for (const offer of Object.values(state.offers)) {
      if (offer.driverId === driverId && offer.status === 'pending') {
        state.offers[offer.id] = { ...offer, status: 'cancelled', respondedAt: state.now };
      }
    }
    bus.emit('driver.offline', driver.displayName, { driverId, earnings: driver.session.earnings }, driverId, state.now);
  };
}

export function acceptOffer(offerId: ID) {
  return (state: WorldState, ctx: TickCtx): void => {
    acceptOfferInternal(offerId, { ...ctx, state });
  };
}

export function declineOffer(offerId: ID) {
  return (state: WorldState): void => {
    const offer = state.offers[offerId];
    if (!offer || offer.status !== 'pending') return;
    state.offers[offerId] = { ...offer, status: 'declined', respondedAt: state.now };

    const driver = state.drivers[offer.driverId];
    if (driver) {
      // Declining moves the earner's acceptance rate, which feeds dispatch.
      state.drivers[driver.id] = {
        ...driver,
        acceptanceRate: round2(Math.max(0, driver.acceptanceRate * 0.97)),
        streakCount: 0,
      };
    }
    bus.emit('offer.declined', driver?.displayName ?? 'driver', { jobId: offer.jobId }, offerId, state.now);
  };
}

/** The earner taps "I've arrived" at the pickup. */
export function confirmArrival(driverId: ID) {
  return (state: WorldState): void => {
    const driver = state.drivers[driverId];
    if (!driver?.activeJobId) return;

    const trip = state.trips[driver.activeJobId];
    if (trip && ['assigned', 'arriving'].includes(trip.status)) {
      state.trips[trip.id] = {
        ...trip,
        status: 'waiting',
        arrivedAt: state.now,
        timeline: [...trip.timeline, { status: 'waiting', at: state.now, actor: driver.displayName }],
      };
      state.drivers[driverId] = {
        ...driver,
        at: trip.stops[0].place.at,
        activeRoute: undefined,
        routeProgressM: 0,
        speedKph: 0,
      };
      bus.emit('trip.driver_arrived', driver.displayName, { tripId: trip.id }, trip.id, state.now);
      return;
    }

    const order = state.orders[driver.activeJobId];
    if (order && ['courier_assigned', 'ready', 'preparing'].includes(order.status)) {
      state.orders[order.id] = {
        ...order,
        status: 'courier_at_merchant',
        timeline: [...order.timeline, { status: 'courier_at_merchant', at: state.now, actor: driver.displayName }],
      };
      state.drivers[driverId] = {
        ...driver,
        at: order.stops[0].place.at,
        activeRoute: undefined,
        routeProgressM: 0,
        speedKph: 0,
      };
      bus.emit('order.courier_arrived', driver.displayName, { orderId: order.id }, order.id, state.now);
    }
  };
}

export function startTrip(tripId: ID) {
  return (state: WorldState, ctx: TickCtx): void => {
    startTripInternal(tripId, { ...ctx, state });
  };
}

export function completeTrip(tripId: ID) {
  return (state: WorldState, ctx: TickCtx): void => {
    const trip = state.trips[tripId];
    const driver = trip?.driverId ? state.drivers[trip.driverId] : undefined;
    // Snap the vehicle to the dropoff so the map and the receipt agree.
    if (trip && driver) {
      const last = trip.stops[trip.stops.length - 1];
      state.drivers[driver.id] = { ...driver, at: last.place.at };
    }
    completeTripInternal(tripId, { ...ctx, state });
  };
}

export function confirmPickup(orderId: ID) {
  return (state: WorldState, ctx: TickCtx): void => {
    pickUpOrderInternal(orderId, { ...ctx, state });
  };
}

export function completeDelivery(orderId: ID, proof?: { kind: 'photo' | 'pin' | 'signature'; value?: string }) {
  return (state: WorldState, ctx: TickCtx): void => {
    const order = state.orders[orderId];
    if (order && proof) {
      state.orders[orderId] = {
        ...order,
        stops: order.stops.map((s, i) =>
          i === order.stops.length - 1
            ? { ...s, verification: { kind: proof.kind, value: proof.value, satisfied: true } }
            : s,
        ),
      };
    }
    const courier = order?.courierId ? state.drivers[order.courierId] : undefined;
    if (order && courier) {
      const last = order.stops[order.stops.length - 1];
      state.drivers[courier.id] = { ...courier, at: last.place.at };
    }
    deliverOrderInternal(orderId, { ...ctx, state });
  };
}

/** Earner declines the job after accepting it. */
export function abandonJob(driverId: ID, reason: string) {
  return (state: WorldState): void => {
    const driver = state.drivers[driverId];
    if (!driver?.activeJobId) return;
    const jobId = driver.activeJobId;

    const trip = state.trips[jobId];
    if (trip) {
      state.trips[jobId] = {
        ...trip,
        status: 'searching',
        driverId: undefined,
        assignedAt: undefined,
        arrivedAt: undefined,
        approachRoute: undefined,
        timeline: [...trip.timeline, { status: 'searching', at: state.now, actor: driver.displayName, note: reason }],
      };
    }
    const order = state.orders[jobId];
    if (order) {
      state.orders[jobId] = {
        ...order,
        status: order.readyAt ? 'ready' : 'preparing',
        courierId: undefined,
        courierAssignedAt: undefined,
        approachRoute: undefined,
        timeline: [...order.timeline, { status: 'reassigning', at: state.now, actor: driver.displayName, note: reason }],
      };
    }

    state.drivers[driverId] = {
      ...driver,
      status: 'online',
      activeJobId: undefined,
      activeRoute: undefined,
      routeProgressM: 0,
      stopQueue: [],
      speedKph: 0,
      cancellationRate: round2(Math.min(1, driver.cancellationRate + 0.01)),
      streakCount: 0,
    };
  };
}

export function setOptedProducts(driverId: ID, productIds: ID[]) {
  return (state: WorldState): void => {
    const driver = state.drivers[driverId];
    if (!driver) return;
    state.drivers[driverId] = { ...driver, optedProductIds: productIds };
  };
}

export function toggleProductOptIn(driverId: ID, productId: ID) {
  return (state: WorldState): void => {
    const driver = state.drivers[driverId];
    if (!driver) return;
    const next = driver.optedProductIds.includes(productId)
      ? driver.optedProductIds.filter((p) => p !== productId)
      : [...driver.optedProductIds, productId];
    state.drivers[driverId] = { ...driver, optedProductIds: next };
  };
}

/** Which products this earner is *allowed* to opt into, given vehicle and tags. */
export function availableProductsFor(state: WorldState, driverId: ID) {
  const driver = state.drivers[driverId];
  if (!driver) return [];
  return getProductsForMarket(state.marketId).filter(
    (p) =>
      p.eligibleVehicleClasses.includes(driver.vehicle.classId) &&
      p.dispatch.requiredDriverTags.every((t) => driver.tags.includes(t)),
  );
}

/** Instant cash-out against the session balance. */
export function cashOut(driverId: ID, amount: number) {
  return (state: WorldState, ctx: TickCtx): void => {
    const driver = state.drivers[driverId];
    const cfg = payoutConfig.instantPayout;
    if (!driver || !cfg.enabled || amount < cfg.minAmount) return;

    const fee = round2(cfg.feeFlat + amount * cfg.feePercent);
    ctx.ledger.push(
      {
        id: nextId('led'),
        at: state.now,
        accountId: driverId,
        accountKind: 'driver',
        kind: 'payout_transfer',
        label: 'Instant cash out',
        amount: -round2(amount),
      },
      {
        id: nextId('led'),
        at: state.now,
        accountId: driverId,
        accountKind: 'driver',
        kind: 'fee',
        label: 'Instant payout fee',
        amount: -fee,
      },
    );
    bus.emit('payout.issued', driver.displayName, { driverId, amount, fee }, driverId, state.now);
  };
}

export function rateRider(tripId: ID, record: RatingRecord) {
  return (state: WorldState): void => {
    const trip = state.trips[tripId];
    if (!trip) return;
    state.trips[tripId] = { ...trip, driverRating: record };
    const rider = state.riders[trip.riderId];
    if (rider) {
      const total = rider.rating * rider.ratingCount + record.stars;
      state.riders[rider.id] = {
        ...rider,
        ratingCount: rider.ratingCount + 1,
        rating: round2(total / (rider.ratingCount + 1)),
      };
    }
  };
}

/** Send an idle earner toward a hotspot — the "go here" nudge. */
export function navigateTo(driverId: ID, target: { lat: number; lng: number }) {
  return (state: WorldState, ctx: TickCtx): void => {
    const driver = state.drivers[driverId];
    if (!driver) return;
    const route = findRoute(
      ctx.dispatchCtx.graph,
      getMarket(state.marketId),
      driver.at,
      target,
      routeOptionsFor(driver, ctx.hourOfDay),
    );
    state.drivers[driverId] = { ...driver, activeRoute: route, routeProgressM: 0 };
  };
}

/** Quest/streak state for the earner's incentives panel. */
export function incentiveProgress(state: WorldState, driverId: ID) {
  if (!appConfig.features.driverQuests) return [];
  const driver = state.drivers[driverId];
  if (!driver) return [];
  const hour = new Date(state.now).getHours();

  return incentives
    .filter((q) => q.enabled)
    .map((quest) => {
      const progress = quest.kind === 'streak' ? driver.streakCount : (driver.questProgress[quest.id] ?? 0);
      const active = hour >= quest.window.startHour && hour < quest.window.endHour;
      return {
        quest,
        progress,
        target: quest.target,
        complete: quest.kind !== 'boost' && progress >= quest.target,
        active,
        ratio: quest.kind === 'boost' ? (active ? 1 : 0) : Math.min(1, progress / quest.target),
      };
    });
}

export function tierProgress(state: WorldState, driverId: ID) {
  const driver = state.drivers[driverId];
  if (!driver) return undefined;
  const current = getTierForPoints(driver.tierPoints);
  const nextTier = driverTiers.find((t) => t.pointsRequired > driver.tierPoints);
  return {
    current,
    next: nextTier,
    points: driver.tierPoints,
    ratio: nextTier
      ? (driver.tierPoints - current.pointsRequired) / (nextTier.pointsRequired - current.pointsRequired)
      : 1,
  };
}
