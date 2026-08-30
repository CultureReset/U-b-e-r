/**
 * Operations console actions and marketplace analytics.
 * Everything here reads or nudges the same world the products run on.
 */
import { getMarket, getProduct } from '@config';
import { bus } from '@core/events';
import { evaluateEligibility, scoreCandidates, type DispatchContext } from '@core/dispatch';
import { graphFor } from '@core/routing';
import type { DispatchOffer, ID, Order, Trip } from '@core/types';
import { groupBy, round2, sortBy, sum } from '@core/util';
import type { WorldState } from '@data';
import { offerJob, type TickCtx } from '@core/sim';

export interface MarketplaceSnapshot {
  onlineDrivers: number;
  busyDrivers: number;
  idleDrivers: number;
  offlineDrivers: number;
  openTrips: number;
  openOrders: number;
  activeTrips: number;
  activeOrders: number;
  merchantsOpen: number;
  merchantsTotal: number;
  averageSurge: number;
  pendingOffers: number;
  utilisation: number;
  grossBookings: number;
  earnerPayouts: number;
  platformRevenue: number;
  completedToday: number;
  cancelRate: number;
}

export function marketplaceSnapshot(state: WorldState): MarketplaceSnapshot {
  const drivers = Object.values(state.drivers).filter((d) => d.marketId === state.marketId);
  const online = drivers.filter((d) => d.status !== 'offline');
  const busy = online.filter((d) => Boolean(d.activeJobId));
  const merchants = Object.values(state.merchants).filter((m) => m.marketId === state.marketId);

  const trips = Object.values(state.trips);
  const orders = Object.values(state.orders);
  const openTrips = trips.filter((t) => ['requested', 'searching', 'no_drivers'].includes(t.status));
  const openOrders = orders.filter((o) => ['placed', 'merchant_review', 'ready'].includes(o.status));
  const activeTrips = trips.filter((t) => ['assigned', 'arriving', 'waiting', 'in_progress'].includes(t.status));
  const activeOrders = orders.filter((o) =>
    ['preparing', 'courier_assigned', 'courier_at_merchant', 'picked_up', 'delivering'].includes(o.status),
  );

  const todayStart = new Date(state.now);
  todayStart.setHours(0, 0, 0, 0);
  const settledToday = [
    ...trips.filter((t) => t.status === 'completed' && (t.completedAt ?? 0) >= todayStart.getTime()),
    ...orders.filter((o) => o.status === 'delivered' && (o.deliveredAt ?? 0) >= todayStart.getTime()),
  ];
  const cancelledToday = [
    ...trips.filter((t) => t.status === 'cancelled' && (t.cancelledAt ?? 0) >= todayStart.getTime()),
    ...orders.filter((o) => o.status === 'cancelled' && (o.cancelledAt ?? 0) >= todayStart.getTime()),
  ];

  const snapshots = Object.values(state.zoneSnapshots);

  return {
    onlineDrivers: online.length,
    busyDrivers: busy.length,
    idleDrivers: online.length - busy.length,
    offlineDrivers: drivers.length - online.length,
    openTrips: openTrips.length,
    openOrders: openOrders.length,
    activeTrips: activeTrips.length,
    activeOrders: activeOrders.length,
    merchantsOpen: merchants.filter((m) => m.isOpen).length,
    merchantsTotal: merchants.length,
    averageSurge: snapshots.length ? round2(sum(snapshots.map((s) => s.surgeMultiplier)) / snapshots.length) : 1,
    pendingOffers: Object.values(state.offers).filter((o) => o.status === 'pending').length,
    utilisation: online.length ? round2(busy.length / online.length) : 0,
    grossBookings: round2(sum(settledToday.map((j) => (j.settlement ?? j.quote).total))),
    earnerPayouts: round2(sum(settledToday.map((j) => (j.settlement ?? j.quote).earnerPayout))),
    platformRevenue: round2(sum(settledToday.map((j) => (j.settlement ?? j.quote).platformRevenue))),
    completedToday: settledToday.length,
    cancelRate: settledToday.length + cancelledToday.length
      ? round2(cancelledToday.length / (settledToday.length + cancelledToday.length))
      : 0,
  };
}

/** Hour-by-hour completed volume, for the ops chart. */
export function hourlyVolume(state: WorldState, hours = 24): { hour: number; trips: number; orders: number; gross: number }[] {
  const end = state.now;
  const start = end - hours * 3_600_000;
  const buckets = Array.from({ length: hours }, (_, i) => ({
    hour: new Date(start + i * 3_600_000).getHours(),
    trips: 0,
    orders: 0,
    gross: 0,
  }));

  const place = (ts: number, amount: number, kind: 'trips' | 'orders') => {
    if (ts < start || ts > end) return;
    const index = Math.min(hours - 1, Math.floor((ts - start) / 3_600_000));
    buckets[index][kind] += 1;
    buckets[index].gross = round2(buckets[index].gross + amount);
  };

  for (const trip of Object.values(state.trips)) {
    if (trip.status === 'completed' && trip.completedAt) place(trip.completedAt, (trip.settlement ?? trip.quote).total, 'trips');
  }
  for (const order of Object.values(state.orders)) {
    if (order.status === 'delivered' && order.deliveredAt) place(order.deliveredAt, (order.settlement ?? order.quote).total, 'orders');
  }
  return buckets;
}

/** Product mix over the whole history — what people actually book. */
export function productMix(state: WorldState) {
  const jobs: (Trip | Order)[] = [
    ...Object.values(state.trips).filter((t) => t.status === 'completed'),
    ...Object.values(state.orders).filter((o) => o.status === 'delivered'),
  ];
  const grouped = groupBy(jobs, (j) => j.productId);
  const total = jobs.length || 1;
  return sortBy(
    Object.entries(grouped).map(([productId, items]) => ({
      productId,
      name: getProduct(productId)?.name ?? productId,
      count: items.length,
      share: round2(items.length / total),
      gross: round2(sum(items.map((j) => (j.settlement ?? j.quote).total))),
    })),
    (r) => r.count,
    'desc',
  );
}

/** Explains, driver by driver, why a job did or did not reach them. */
export function dispatchExplain(state: WorldState, jobId: ID) {
  const job = state.trips[jobId] ?? state.orders[jobId];
  if (!job) return undefined;
  const market = getMarket(state.marketId);
  const ctx: DispatchContext = {
    graph: graphFor(state.marketId),
    market,
    now: state.now,
    hourOfDay: new Date(state.now).getHours(),
  };
  const drivers = Object.values(state.drivers).filter((d) => d.marketId === state.marketId);
  const evaluations = drivers.map((d) => evaluateEligibility(d, job, ctx));
  const candidates = scoreCandidates(evaluations, job, ctx);
  const offers = Object.values(state.offers).filter((o) => o.jobId === jobId);

  return {
    job,
    eligible: candidates,
    rejected: sortBy(
      evaluations.filter((e) => !e.eligible),
      (e) => e.approachKm,
    ).slice(0, 25),
    offers: sortBy(offers, (o) => o.createdAt, 'desc'),
  };
}

/** Force a fresh offer wave for a stuck job. */
export function forceDispatch(jobId: ID) {
  return (state: WorldState, ctx: TickCtx): void => {
    const job = state.trips[jobId] ?? state.orders[jobId];
    if (!job) return;
    offerJob(job, { ...ctx, state });
  };
}

export function cancelOffer(offerId: ID) {
  return (state: WorldState): void => {
    const offer: DispatchOffer | undefined = state.offers[offerId];
    if (!offer || offer.status !== 'pending') return;
    state.offers[offerId] = { ...offer, status: 'cancelled', respondedAt: state.now };
  };
}

/** Put a driver online/offline from the console — supply levers for demos. */
export function setDriverStatus(driverId: ID, status: 'online' | 'offline') {
  return (state: WorldState): void => {
    const driver = state.drivers[driverId];
    if (!driver) return;
    state.drivers[driverId] = {
      ...driver,
      status,
      onlineSince: status === 'online' ? state.now : undefined,
      activeRoute: status === 'offline' ? undefined : driver.activeRoute,
      speedKph: status === 'offline' ? 0 : driver.speedKph,
    };
    bus.emit(status === 'online' ? 'driver.online' : 'driver.offline', 'ops', { driverId }, driverId, state.now);
  };
}

/** Bulk supply lever: bring N idle drivers online or take them offline. */
export function adjustSupply(delta: number) {
  return (state: WorldState): void => {
    const drivers = Object.values(state.drivers).filter((d) => d.marketId === state.marketId);
    if (delta > 0) {
      const offline = drivers.filter((d) => d.status === 'offline' && d.optedProductIds.length > 0).slice(0, delta);
      for (const d of offline) {
        state.drivers[d.id] = { ...d, status: 'online', onlineSince: state.now };
      }
    } else {
      const idle = drivers.filter((d) => d.status === 'online' && !d.activeJobId).slice(0, -delta);
      for (const d of idle) {
        state.drivers[d.id] = { ...d, status: 'offline', onlineSince: undefined, activeRoute: undefined, speedKph: 0 };
      }
    }
  };
}

/** Zone table for the heat layer and the surge inspector. */
export function zoneTable(state: WorldState) {
  const market = getMarket(state.marketId);
  return market.zones.map((zone) => {
    const snapshot = state.zoneSnapshots[zone.id];
    return {
      zone,
      openRequests: snapshot?.openRequests ?? 0,
      availableDrivers: snapshot?.availableDrivers ?? 0,
      ratio: snapshot?.ratio ?? 0,
      surge: snapshot?.surgeMultiplier ?? 1,
    };
  });
}

export function liveJobs(state: WorldState): (Trip | Order)[] {
  const trips = Object.values(state.trips).filter((t) => !['completed', 'cancelled'].includes(t.status));
  const orders = Object.values(state.orders).filter((o) => !['delivered', 'cancelled'].includes(o.status));
  return sortBy([...trips, ...orders], (j) => (j.kind === 'trip' ? j.requestedAt : j.placedAt), 'desc');
}
