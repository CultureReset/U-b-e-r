/**
 * Rider actions. Quotes, requests, cancellations, ratings, sharing and chat.
 * Every one of these runs through the same engines the simulator uses.
 */
import { appConfig, driverPayConfig, getMarket, getProduct, orgConfig, type LatLng } from '@config';
import { bus } from '@core/events';
import { cancellationCharge, buildQuote } from '@core/pricing';
import { findRoute, graphFor } from '@core/routing';
import type { ChatMessage, ID, Place, Quote, RatingRecord, Trip } from '@core/types';
import { nextId, referenceCode, round2 } from '@core/util';
import type { WorldState } from '@data';
import { surchargesAt, surgeAt } from '@data/seed/zones';
import type { TickCtx } from '@core/sim';
import { routeOptionsFor } from '@core/sim';

export interface TripDraft {
  productId: ID;
  stops: Place[];
  paymentMethodId: ID;
  promotionCode?: string;
  scheduledFor?: number;
  /** Business booking context, when the rider is on a business profile. */
  orgContext?: { orgId: ID; expenseCodeId: ID; memo?: string };
  note?: string;
}

/** Quote every product for the same route in one pass — that's the picker list. */
export function quoteProducts(
  state: WorldState,
  productIds: ID[],
  stops: LatLng[],
  promotionCode?: string,
  riderId?: ID,
): Record<ID, { quote: Quote; etaMin: number; distanceKm: number }> {
  const market = getMarket(state.marketId);
  const graph = graphFor(state.marketId);
  const rider = riderId ? state.riders[riderId] : undefined;
  const hourOfDay = new Date(state.now).getHours();
  const result: Record<ID, { quote: Quote; etaMin: number; distanceKm: number }> = {};

  for (const productId of productIds) {
    const product = getProduct(productId);
    if (!product) continue;

    // Route the whole multi-stop path, leg by leg.
    let distanceM = 0;
    let durationSec = 0;
    for (let i = 1; i < stops.length; i++) {
      const leg = findRoute(graph, market, stops[i - 1], stops[i], { hourOfDay, speedFactor: 1, congestionFactor: 1 });
      distanceM += leg.distanceM;
      durationSec += leg.durationSec;
    }

    const quote = buildQuote({
      productId,
      marketId: state.marketId,
      distanceKm: distanceM / 1000,
      durationMin: durationSec / 60,
      surgeMultiplier: surgeAt(state, market, stops[0]),
      surcharges: surchargesAt(market, stops[0]),
      promotionCode,
      promoRedemptions: rider?.promoRedemptions,
      accountAgeDays: rider ? (state.now - rider.createdAt) / 86_400_000 : undefined,
      now: state.now,
    });

    result[productId] = {
      quote,
      distanceKm: round2(distanceM / 1000),
      etaMin: Math.max(1, Math.round(durationSec / 60)),
    };
  }

  return result;
}

/**
 * Enterprise policy evaluation. Returns the violations a booking would incur
 * and whether it is outright blocked — the rider sees this before confirming.
 */
export function evaluatePolicy(
  state: WorldState,
  orgId: ID,
  productId: ID,
  amount: number,
  riderId: ID,
): { violations: { ruleId: ID; label: string; action: string }[]; blocked: boolean; requiresApproval: boolean } {
  const org = state.orgs[orgId];
  const violations: { ruleId: ID; label: string; action: string }[] = [];
  if (!org) return { violations, blocked: false, requiresApproval: false };

  const hour = new Date(state.now).getHours();
  const member = org.members.find((m) => m.riderId === riderId);

  for (const ruleId of org.policyRuleIds) {
    const rule = orgConfig.policyRules.find((r) => r.id === ruleId);
    if (!rule?.enabled) continue;
    let violated = false;

    switch (rule.kind) {
      case 'product_allowlist':
        violated = Array.isArray(rule.value) && !rule.value.includes(productId);
        break;
      case 'spend_cap_per_trip':
        violated = typeof rule.value === 'number' && amount > rule.value;
        break;
      case 'time_window':
        if (typeof rule.value === 'object' && !Array.isArray(rule.value)) {
          violated = hour < rule.value.startHour || hour >= rule.value.endHour;
        }
        break;
      case 'monthly_cap':
        violated = typeof rule.value === 'number' && (member?.monthlySpend ?? 0) + amount > rule.value;
        break;
      case 'requires_reason':
        violated = false; // enforced at the form level
        break;
      case 'geo_fence':
        violated = false;
        break;
    }

    if (violated) violations.push({ ruleId: rule.id, label: rule.label, action: rule.onViolation });
  }

  return {
    violations,
    blocked: violations.some((v) => v.action === 'block'),
    requiresApproval: violations.some((v) => v.action === 'require_approval'),
  };
}

export function requestTrip(draft: TripDraft, riderId: ID) {
  return (state: WorldState, ctx: TickCtx): ID | undefined => {
    const rider = state.riders[riderId];
    const product = getProduct(draft.productId);
    if (!rider || !product || draft.stops.length < 2) return undefined;

    const market = getMarket(state.marketId);
    const stopPoints = draft.stops.map((s) => s.at);

    let distanceM = 0;
    let durationSec = 0;
    for (let i = 1; i < stopPoints.length; i++) {
      const leg = findRoute(ctx.dispatchCtx.graph, market, stopPoints[i - 1], stopPoints[i], {
        hourOfDay: ctx.hourOfDay,
        speedFactor: 1,
        congestionFactor: 1,
      });
      distanceM += leg.distanceM;
      durationSec += leg.durationSec;
    }

    const quote = buildQuote({
      productId: draft.productId,
      marketId: state.marketId,
      distanceKm: distanceM / 1000,
      durationMin: durationSec / 60,
      surgeMultiplier: surgeAt(state, market, stopPoints[0]),
      surcharges: surchargesAt(market, stopPoints[0]),
      promotionCode: draft.promotionCode,
      promoRedemptions: rider.promoRedemptions,
      accountAgeDays: (state.now - rider.createdAt) / 86_400_000,
      now: state.now,
    });

    const id = nextId('trp');
    const scheduled = draft.scheduledFor && draft.scheduledFor > state.now + 60_000;

    let orgContext: Trip['orgContext'];
    if (draft.orgContext && appConfig.features.businessProfiles) {
      const policy = evaluatePolicy(state, draft.orgContext.orgId, draft.productId, quote.total, riderId);
      if (policy.blocked) {
        bus.emit('policy.violation', rider.displayName, { violations: policy.violations }, id, state.now);
        return undefined;
      }
      orgContext = {
        ...draft.orgContext,
        approvalStatus: policy.requiresApproval ? 'pending' : 'not_required',
        violations: policy.violations.map((v) => v.ruleId),
      };
      if (policy.violations.length > 0) {
        bus.emit('policy.violation', rider.displayName, { violations: policy.violations }, id, state.now);
      }
    }

    const trip: Trip = {
      id,
      code: referenceCode('TRP', state.now + Object.keys(state.trips).length),
      kind: 'trip',
      marketId: state.marketId,
      productId: draft.productId,
      riderId,
      status: scheduled ? 'scheduled' : 'requested',
      stops: draft.stops.map((place, index) => ({
        id: nextId('stp'),
        jobId: id,
        kind: index === 0 ? 'pickup' : index === draft.stops.length - 1 ? 'dropoff' : 'waypoint',
        place: index === 0 && draft.note ? { ...place, note: draft.note } : place,
        sequence: index,
      })),
      quote,
      requestedAt: state.now,
      scheduledFor: scheduled ? draft.scheduledFor : undefined,
      paymentMethodId: draft.paymentMethodId,
      orgContext,
      timeline: [{ status: scheduled ? 'scheduled' : 'requested', at: state.now, actor: rider.displayName }],
      messages: [],
      safety: { emergencyContacted: false, checksRun: 0 },
    };

    state.trips[id] = trip;

    if (quote.promotionId) {
      state.riders[riderId] = {
        ...rider,
        promoRedemptions: {
          ...rider.promoRedemptions,
          [quote.promotionId]: (rider.promoRedemptions[quote.promotionId] ?? 0) + 1,
        },
      };
    }

    bus.emit('trip.requested', rider.displayName, { tripId: id, productId: draft.productId, total: quote.total }, id, state.now);
    return id;
  };
}

export function cancelTrip(tripId: ID, actor: 'rider' | 'driver' | 'system', reason: string) {
  return (state: WorldState, ctx: TickCtx): void => {
    const trip = state.trips[tripId];
    if (!trip || ['completed', 'cancelled'].includes(trip.status)) return;

    const elapsedSec = (state.now - trip.requestedAt) / 1000;
    const charge = actor === 'rider' ? cancellationCharge(trip.productId, trip.marketId, elapsedSec) : { amount: 0, withinGrace: true };

    state.trips[tripId] = {
      ...trip,
      status: 'cancelled',
      cancelledAt: state.now,
      cancelledBy: actor,
      cancellationReason: reason,
      timeline: [...trip.timeline, { status: 'cancelled', at: state.now, actor, note: reason }],
    };

    // Withdraw any outstanding offers.
    for (const offer of Object.values(state.offers)) {
      if (offer.jobId === tripId && offer.status === 'pending') {
        state.offers[offer.id] = { ...offer, status: 'cancelled', respondedAt: state.now };
      }
    }

    // Release the driver.
    if (trip.driverId) {
      const driver = state.drivers[trip.driverId];
      if (driver) {
        state.drivers[trip.driverId] = {
          ...driver,
          status: driver.status === 'offline' ? 'offline' : 'online',
          activeJobId: undefined,
          activeRoute: undefined,
          routeProgressM: 0,
          stopQueue: [],
          speedKph: 0,
        };
      }
    }

    if (charge.amount > 0) {
      ctx.ledger.push({
        id: nextId('led'),
        at: state.now,
        jobId: tripId,
        jobCode: trip.code,
        accountId: trip.riderId,
        accountKind: 'rider',
        kind: 'fee',
        label: 'Cancellation fee',
        amount: -charge.amount,
      });
      if (trip.driverId) {
        ctx.ledger.push({
          id: nextId('led'),
          at: state.now,
          jobId: tripId,
          jobCode: trip.code,
          accountId: trip.driverId,
          accountKind: 'driver',
          kind: 'adjustment',
          label: 'Cancellation compensation',
          // Declared in config; never pays out more than was actually collected.
          amount: round2(Math.min(charge.amount, driverPayConfig.cancellationCompensation)),
        });
      }
    }

    bus.emit('trip.cancelled', actor, { tripId, reason, charge: charge.amount }, tripId, state.now);
  };
}

export function rateTrip(tripId: ID, record: RatingRecord, by: 'rider' | 'driver') {
  return (state: WorldState, ctx: TickCtx): void => {
    const trip = state.trips[tripId];
    if (!trip) return;

    state.trips[tripId] = by === 'rider' ? { ...trip, riderRating: record } : { ...trip, driverRating: record };

    // Ratings move the counterparty's running average.
    if (by === 'rider' && trip.driverId) {
      const driver = state.drivers[trip.driverId];
      if (driver) {
        const total = driver.rating * driver.ratingCount + record.stars;
        state.drivers[driver.id] = {
          ...driver,
          ratingCount: driver.ratingCount + 1,
          rating: round2(total / (driver.ratingCount + 1)),
          session: {
            ...driver.session,
            earnings: round2(driver.session.earnings + (record.tip ?? 0)),
            tips: round2(driver.session.tips + (record.tip ?? 0)),
          },
        };
        if (record.tip && record.tip > 0) {
          ctx.ledger.push({
            id: nextId('led'),
            at: state.now,
            jobId: tripId,
            jobCode: trip.code,
            accountId: driver.id,
            accountKind: 'driver',
            kind: 'tip',
            label: 'Rider tip',
            amount: record.tip,
          });
          ctx.ledger.push({
            id: nextId('led'),
            at: state.now,
            jobId: tripId,
            jobCode: trip.code,
            accountId: trip.riderId,
            accountKind: 'rider',
            kind: 'tip',
            label: 'Tip added',
            amount: -record.tip,
          });
        }
      }
    }

    if (by === 'driver') {
      const rider = state.riders[trip.riderId];
      if (rider) {
        const total = rider.rating * rider.ratingCount + record.stars;
        state.riders[rider.id] = {
          ...rider,
          ratingCount: rider.ratingCount + 1,
          rating: round2(total / (rider.ratingCount + 1)),
        };
      }
    }

    bus.emit('trip.rated', by, { tripId, stars: record.stars, tip: record.tip ?? 0 }, tripId, state.now);
  };
}

export function shareTrip(tripId: ID) {
  return (state: WorldState): void => {
    const trip = state.trips[tripId];
    if (!trip || !appConfig.features.liveLocationSharing) return;
    state.trips[tripId] = { ...trip, shareToken: trip.shareToken ?? nextId('shr') };
  };
}

export function triggerSafetyCheck(tripId: ID) {
  return (state: WorldState): void => {
    const trip = state.trips[tripId];
    if (!trip || !appConfig.features.safetyToolkit) return;
    state.trips[tripId] = { ...trip, safety: { ...trip.safety, checksRun: trip.safety.checksRun + 1 } };
  };
}

export function sendMessage(jobId: ID, from: ChatMessage['from'], fromName: string, body: string, cannedId?: string) {
  return (state: WorldState): void => {
    if (!appConfig.features.inAppChat) return;
    const message: ChatMessage = {
      id: nextId('msg'),
      jobId,
      from,
      fromName,
      body,
      at: state.now,
      read: false,
      cannedId,
    };
    const trip = state.trips[jobId];
    if (trip) {
      state.trips[jobId] = { ...trip, messages: [...trip.messages, message] };
    } else {
      const order = state.orders[jobId];
      if (order) state.orders[jobId] = { ...order, messages: [...order.messages, message] };
    }
    bus.emit('message.sent', fromName, { jobId, body }, jobId, state.now);
  };
}

export function markMessagesRead(jobId: ID, viewer: ChatMessage['from']) {
  return (state: WorldState): void => {
    const trip = state.trips[jobId];
    if (trip) {
      state.trips[jobId] = {
        ...trip,
        messages: trip.messages.map((m) => (m.from === viewer ? m : { ...m, read: true })),
      };
      return;
    }
    const order = state.orders[jobId];
    if (order) {
      state.orders[jobId] = {
        ...order,
        messages: order.messages.map((m) => (m.from === viewer ? m : { ...m, read: true })),
      };
    }
  };
}

export function saveRiderPlace(riderId: ID, place: Place, kind: 'home' | 'work' | 'custom', icon = 'pin') {
  return (state: WorldState): void => {
    const rider = state.riders[riderId];
    if (!rider) return;
    const saved = { ...place, kind, icon };
    const existingIndex = rider.savedPlaces.findIndex((p) => (kind === 'custom' ? p.id === place.id : p.kind === kind));
    const savedPlaces =
      existingIndex >= 0
        ? rider.savedPlaces.map((p, i) => (i === existingIndex ? saved : p))
        : [...rider.savedPlaces, saved];
    state.riders[riderId] = { ...rider, savedPlaces };
  };
}

export function setDefaultPaymentMethod(riderId: ID, methodId: ID) {
  return (state: WorldState): void => {
    const rider = state.riders[riderId];
    if (!rider) return;
    state.riders[riderId] = {
      ...rider,
      defaultPaymentMethodId: methodId,
      paymentMethodIds: rider.paymentMethodIds.includes(methodId)
        ? rider.paymentMethodIds
        : [...rider.paymentMethodIds, methodId],
    };
  };
}

export { routeOptionsFor };
