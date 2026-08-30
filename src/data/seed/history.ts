/**
 * Historical job generation.
 *
 * The analytics, earnings and receipt screens are only meaningful with a past,
 * so the seeder replays a window of completed work through the *same* pricing
 * engine the live product uses. Nothing here is a fabricated total — every
 * historical fare is a real quote against a real route.
 */
import {
  appConfig,
  getMarket,
  getProductsForMarket,
  getPaymentMethodsForMarket,
  orgConfig,
  seedConfig,
} from '@config';
import { buildQuote, tipSuggestions } from '@core/pricing';
import { findRoute, graphFor } from '@core/routing';
import { getVehicleClass } from '@config';
import type {
  DriverProfile,
  LedgerEntry,
  Merchant,
  Order,
  OrderLine,
  Org,
  RiderProfile,
  Timestamp,
  Trip,
} from '@core/types';
import { clamp, nextId, referenceCode, round2, type Rng } from '@core/util';
import { makePlace, randomDemandPoint } from './places';
import { menuIndex } from './merchants';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Weighted hour-of-day picker so history clusters at commute and meal times. */
function pickHour(rng: Rng, kind: 'ride' | 'order'): number {
  const rideWeights = [1, 0.6, 0.4, 0.4, 0.8, 2, 4, 7, 8, 5, 3, 3, 4, 4, 3, 3.5, 5, 8, 8.5, 6, 4, 3, 2.5, 1.6];
  const orderWeights = [0.6, 0.3, 0.2, 0.2, 0.3, 0.6, 1.4, 2, 2.4, 2, 2.2, 5, 8, 7, 3.4, 2.6, 3, 5, 8, 9, 6.5, 4, 2.4, 1.2];
  const weights = kind === 'ride' ? rideWeights : orderWeights;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return rng.pickWeighted(hours, (h) => weights[h]);
}

function pastTimestamp(rng: Rng, now: Timestamp, kind: 'ride' | 'order'): Timestamp {
  const daysAgo = Math.floor(rng.float(0, seedConfig.historyWindowDays));
  const hour = pickHour(rng, kind);
  const dayStart = now - daysAgo * DAY_MS;
  const midnight = new Date(dayStart);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() + hour * HOUR_MS + rng.int(0, 59) * 60_000;
}

function orgContextFor(rider: RiderProfile, orgs: Org[], rng: Rng, amount: number): Trip['orgContext'] {
  if (!rider.orgMembership || !appConfig.features.businessProfiles) return undefined;
  const org = orgs.find((o) => o.id === rider.orgMembership!.orgId);
  if (!org) return undefined;
  const code = rng.pick(orgConfig.expenseCodes);
  const capRule = orgConfig.policyRules.find((r) => r.kind === 'spend_cap_per_trip');
  const cap = typeof capRule?.value === 'number' ? capRule.value : Infinity;
  const violations = amount > cap ? [capRule!.id] : [];
  return {
    orgId: org.id,
    expenseCodeId: code.id,
    memo: code.requiresMemo ? rng.pick(['Client visit', 'Site inspection', 'Team offsite', 'Airport transfer']) : undefined,
    approvalStatus: violations.length > 0 ? (rng.bool(0.75) ? 'approved' : 'pending') : 'not_required',
    violations,
  };
}

export interface HistoryResult {
  trips: Trip[];
  orders: Order[];
  ledger: LedgerEntry[];
  /** Driver session/lifetime deltas keyed by driver id. */
  driverStats: Record<string, { earnings: number; jobs: number; distanceKm: number; tips: number }>;
}

export function generateHistory(
  marketId: string,
  riders: RiderProfile[],
  drivers: DriverProfile[],
  merchants: Merchant[],
  orgs: Org[],
  rng: Rng,
  now: Timestamp,
): HistoryResult {
  const market = getMarket(marketId);
  const graph = graphFor(marketId);
  const trips: Trip[] = [];
  const orders: Order[] = [];
  const ledger: LedgerEntry[] = [];
  const driverStats: HistoryResult['driverStats'] = {};

  const rideProducts = getProductsForMarket(marketId, 'ride');
  const deliveryProducts = getProductsForMarket(marketId, 'delivery');
  const rideDrivers = drivers.filter((d) => d.optedProductIds.some((p) => rideProducts.some((rp) => rp.id === p)));
  const deliveryDrivers = drivers.filter((d) =>
    d.optedProductIds.some((p) => deliveryProducts.some((dp) => dp.id === p)),
  );

  const bump = (driverId: string, earnings: number, distanceKm: number, tips: number) => {
    const entry = (driverStats[driverId] ||= { earnings: 0, jobs: 0, distanceKm: 0, tips: 0 });
    entry.earnings = round2(entry.earnings + earnings);
    entry.jobs += 1;
    entry.distanceKm = round2(entry.distanceKm + distanceKm);
    entry.tips = round2(entry.tips + tips);
  };

  /* ------------------------------- Trips -------------------------------- */
  for (let i = 0; i < seedConfig.perMarket.historicalTrips; i++) {
    const rider = rng.pick(riders);
    const product = rng.pickWeighted(rideProducts, (p) => (p.id === 'go' ? 5 : p.id === 'share' ? 2 : 1.2));
    const eligibleDrivers = rideDrivers.filter(
      (d) => d.optedProductIds.includes(product.id) && product.eligibleVehicleClasses.includes(d.vehicle.classId),
    );
    if (eligibleDrivers.length === 0) continue;
    const driver = rng.pick(eligibleDrivers);

    const requestedAt = pastTimestamp(rng, now, 'ride');
    const hourOfDay = new Date(requestedAt).getHours();
    const originAt = rng.bool(0.35) ? rider.savedPlaces[0].at : randomDemandPoint(market, rng);
    const destAt = rng.bool(0.3) ? rider.savedPlaces[1].at : randomDemandPoint(market, rng);
    const pickup = makePlace(marketId, originAt);
    const dropoff = makePlace(marketId, destAt);

    const vehicleClass = getVehicleClass(driver.vehicle.classId);
    const route = findRoute(graph, market, originAt, destAt, {
      hourOfDay,
      speedFactor: vehicleClass?.speedFactor ?? 1,
      congestionFactor: vehicleClass?.congestionFactor ?? 1,
    });

    const surge = clamp(round2(rng.gaussian(1.08, 0.22, 1, 2.6)), 1, 2.6);
    const cancelled = rng.bool(0.07);
    const tip = appConfig.features.tipping && !cancelled && rng.bool(0.32) ? rng.pick(tipSuggestions(12)) : 0;

    const quote = buildQuote({
      productId: product.id,
      marketId,
      distanceKm: route.distanceM / 1000,
      durationMin: route.durationSec / 60,
      surgeMultiplier: surge,
      driverTierId: driver.tierId,
      tip,
      now: requestedAt,
    });

    const durationMs = route.durationSec * 1000;
    const assignedAt = requestedAt + rng.int(8, 70) * 1000;
    const arrivedAt = assignedAt + rng.int(90, 480) * 1000;
    const startedAt = arrivedAt + rng.int(20, 200) * 1000;
    const completedAt = startedAt + durationMs;

    const paymentMethods = getPaymentMethodsForMarket(marketId, 'ride').filter((m) =>
      rider.paymentMethodIds.includes(m.id),
    );
    const paymentMethodId = paymentMethods[0]?.id ?? rider.defaultPaymentMethodId;
    const orgContext = orgContextFor(rider, orgs, rng, quote.total);

    const trip: Trip = {
      id: nextId('trp'),
      code: referenceCode('TRP', requestedAt + i),
      kind: 'trip',
      marketId,
      productId: product.id,
      riderId: rider.id,
      driverId: driver.id,
      status: cancelled ? 'cancelled' : 'completed',
      stops: [
        { id: nextId('stp'), jobId: '', kind: 'pickup', place: pickup, sequence: 0, completedAt: startedAt },
        { id: nextId('stp'), jobId: '', kind: 'dropoff', place: dropoff, sequence: 1, completedAt: completedAt },
      ],
      quote,
      settlement: cancelled ? undefined : quote,
      route,
      requestedAt,
      assignedAt,
      arrivedAt,
      startedAt: cancelled ? undefined : startedAt,
      completedAt: cancelled ? undefined : completedAt,
      cancelledAt: cancelled ? assignedAt + rng.int(20, 200) * 1000 : undefined,
      cancelledBy: cancelled ? (rng.bool(0.7) ? 'rider' : 'driver') : undefined,
      cancellationReason: cancelled ? 'plans-changed' : undefined,
      paymentMethodId,
      orgContext: orgContext && { ...orgContext },
      timeline: [],
      riderRating:
        !cancelled && appConfig.features.ratings && rng.bool(0.72)
          ? { stars: rng.pickWeighted([5, 5, 5, 4, 3], (s) => s), tags: [], tip, at: completedAt + 60_000 }
          : undefined,
      driverRating:
        !cancelled && rng.bool(0.6)
          ? { stars: rng.pickWeighted([5, 5, 4], (s) => s), tags: [], at: completedAt + 90_000 }
          : undefined,
      messages: [],
      safety: { emergencyContacted: false, checksRun: 0 },
    };
    trip.stops = trip.stops.map((s) => ({ ...s, jobId: trip.id }));
    trips.push(trip);

    if (!cancelled) {
      bump(driver.id, quote.earnerPayout, quote.distanceKm, tip);
      ledger.push(
        {
          id: nextId('led'),
          at: completedAt,
          jobId: trip.id,
          jobCode: trip.code,
          accountId: rider.id,
          accountKind: 'rider',
          kind: 'fare',
          label: `${product.name} · ${dropoff.label}`,
          amount: -quote.total,
        },
        {
          id: nextId('led'),
          at: completedAt,
          jobId: trip.id,
          jobCode: trip.code,
          accountId: driver.id,
          accountKind: 'driver',
          kind: 'payout',
          label: `${product.name} fare`,
          amount: quote.earnerPayout - tip,
        },
      );
      if (tip > 0) {
        ledger.push({
          id: nextId('led'),
          at: completedAt + 120_000,
          jobId: trip.id,
          jobCode: trip.code,
          accountId: driver.id,
          accountKind: 'driver',
          kind: 'tip',
          label: 'Rider tip',
          amount: tip,
        });
      }
    }
  }

  /* ------------------------------- Orders ------------------------------- */
  for (let i = 0; i < seedConfig.perMarket.historicalOrders; i++) {
    const customer = rng.pick(riders);
    const merchant = rng.pick(merchants);
    const product = rng.pickWeighted(deliveryProducts, (p) => (p.id === 'eats-standard' ? 6 : p.id === 'eats-priority' ? 2 : 1));
    const eligibleCouriers = deliveryDrivers.filter(
      (d) => d.optedProductIds.includes(product.id) && product.eligibleVehicleClasses.includes(d.vehicle.classId),
    );
    if (eligibleCouriers.length === 0) continue;
    const courier = rng.pick(eligibleCouriers);

    const placedAt = pastTimestamp(rng, now, 'order');
    const hourOfDay = new Date(placedAt).getHours();
    const dropAt = rng.bool(0.6) ? customer.savedPlaces[0].at : randomDemandPoint(market, rng);
    const merchantPlace = makePlace(marketId, merchant.at, merchant.name, 'merchant');
    const dropoff = makePlace(marketId, dropAt);

    const items = [...menuIndex(merchant).values()];
    if (items.length === 0) continue;
    const lineCount = rng.int(1, 4);
    const lines: OrderLine[] = [];
    for (let l = 0; l < lineCount; l++) {
      const item = rng.pickWeighted(items, (it) => (it.popular ? 3 : 1));
      const quantity = rng.pickWeighted([1, 1, 1, 2, 3], (q) => 4 - q);
      const selections = item.modifierGroups
        .filter((g) => g.required || rng.bool(0.35))
        .map((g) => {
          const options = g.options.filter((o) => o.available);
          if (options.length === 0) return undefined;
          const chosen = g.select === 'single' ? [rng.pick(options)] : rng.sample(options, rng.int(1, 3));
          return {
            groupId: g.id,
            groupName: g.name,
            optionIds: chosen.map((o) => o.id),
            optionNames: chosen.map((o) => o.name),
            priceDelta: round2(chosen.reduce((acc, o) => acc + o.priceDelta, 0)),
          };
        })
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      const unitPrice = round2(item.price + selections.reduce((acc, s) => acc + s.priceDelta, 0));
      lines.push({
        id: nextId('oln'),
        itemId: item.id,
        name: item.name,
        unitPrice,
        quantity,
        selections,
        lineTotal: round2(unitPrice * quantity),
        fulfilment: 'ready',
      });
    }

    const goodsSubtotal = round2(lines.reduce((acc, l) => acc + l.lineTotal, 0));
    const vehicleClass = getVehicleClass(courier.vehicle.classId);
    const route = findRoute(graph, market, merchant.at, dropAt, {
      hourOfDay,
      speedFactor: vehicleClass?.speedFactor ?? 1,
      congestionFactor: vehicleClass?.congestionFactor ?? 1,
    });

    const cancelled = rng.bool(0.05);
    const tip = appConfig.features.tipping && !cancelled && rng.bool(0.55) ? rng.pick(tipSuggestions(goodsSubtotal)) : 0;
    const quote = buildQuote({
      productId: product.id,
      marketId,
      distanceKm: route.distanceM / 1000,
      durationMin: route.durationSec / 60,
      goodsSubtotal,
      packagingFee: merchant.settings.packagingFee,
      driverTierId: courier.tierId,
      tip,
      now: placedAt,
    });

    const acceptedAt = placedAt + rng.int(20, 180) * 1000;
    const readyAt = acceptedAt + merchant.basePrepMinutes * 60_000 + rng.int(-120, 300) * 1000;
    const assignedAt = readyAt - rng.int(120, 420) * 1000;
    const pickedUpAt = readyAt + rng.int(30, 240) * 1000;
    const deliveredAt = pickedUpAt + route.durationSec * 1000;

    const order: Order = {
      id: nextId('ord'),
      code: referenceCode('ORD', placedAt + i),
      kind: 'order',
      marketId,
      productId: product.id,
      customerId: customer.id,
      merchantId: merchant.id,
      courierId: courier.id,
      status: cancelled ? 'cancelled' : 'delivered',
      lines,
      stops: [
        { id: nextId('stp'), jobId: '', kind: 'merchant', place: merchantPlace, sequence: 0, completedAt: pickedUpAt },
        { id: nextId('stp'), jobId: '', kind: 'dropoff', place: dropoff, sequence: 1, completedAt: deliveredAt },
      ],
      quote,
      settlement: cancelled ? undefined : quote,
      route,
      placedAt,
      merchantAcceptedAt: acceptedAt,
      readyAt,
      courierAssignedAt: assignedAt,
      pickedUpAt: cancelled ? undefined : pickedUpAt,
      deliveredAt: cancelled ? undefined : deliveredAt,
      cancelledAt: cancelled ? acceptedAt + rng.int(60, 400) * 1000 : undefined,
      cancelledBy: cancelled ? (rng.bool(0.5) ? 'merchant' : 'customer') : undefined,
      cancellationReason: cancelled ? 'out-of-stock' : undefined,
      paymentMethodId: customer.defaultPaymentMethodId,
      dropoffPreference: rng.pick(['hand_it_to_me', 'leave_at_door', 'meet_outside'] as const),
      utensils: rng.bool(0.5),
      orgContext: orgContextFor(customer, orgs, rng, quote.total),
      timeline: [],
      customerRating:
        !cancelled && appConfig.features.ratings && rng.bool(0.6)
          ? { stars: rng.pickWeighted([5, 5, 4, 3], (s) => s), tags: [], tip, at: deliveredAt + 120_000 }
          : undefined,
      messages: [],
    };
    order.stops = order.stops.map((s) => ({ ...s, jobId: order.id }));
    orders.push(order);

    if (!cancelled) {
      bump(courier.id, quote.earnerPayout, quote.distanceKm, tip);
      const commission = round2(goodsSubtotal * 0.3);
      ledger.push(
        {
          id: nextId('led'),
          at: deliveredAt,
          jobId: order.id,
          jobCode: order.code,
          accountId: customer.id,
          accountKind: 'rider',
          kind: 'fare',
          label: `${merchant.name} · ${lines.length} item${lines.length === 1 ? '' : 's'}`,
          amount: -quote.total,
        },
        {
          id: nextId('led'),
          at: deliveredAt,
          jobId: order.id,
          jobCode: order.code,
          accountId: courier.id,
          accountKind: 'driver',
          kind: 'payout',
          label: `Delivery · ${merchant.name}`,
          amount: quote.earnerPayout - tip,
        },
        {
          id: nextId('led'),
          at: deliveredAt,
          jobId: order.id,
          jobCode: order.code,
          accountId: merchant.id,
          accountKind: 'merchant',
          kind: 'commission',
          label: 'Platform commission',
          amount: -commission,
        },
        {
          id: nextId('led'),
          at: deliveredAt,
          jobId: order.id,
          jobCode: order.code,
          accountId: merchant.id,
          accountKind: 'merchant',
          kind: 'fare',
          label: `Order ${order.code}`,
          amount: goodsSubtotal,
        },
      );
      if (tip > 0) {
        ledger.push({
          id: nextId('led'),
          at: deliveredAt + 120_000,
          jobId: order.id,
          jobCode: order.code,
          accountId: courier.id,
          accountKind: 'driver',
          kind: 'tip',
          label: 'Customer tip',
          amount: tip,
        });
      }
    }
  }

  ledger.sort((a, b) => a.at - b.at);
  return { trips, orders, ledger, driverStats };
}
