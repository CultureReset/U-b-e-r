/**
 * Fare engine.
 *
 * Given a route, a product and market context, it produces a fully itemised
 * `Quote`: every line the rider sees, the tax treatment, the promo applied,
 * what the earner is paid and what the platform keeps. Nothing is hardcoded —
 * every number resolves from config/pricing.config.ts.
 */
import {
  appConfig,
  getMarket,
  getProduct,
  getRateCard,
  driverPayConfig,
  feeConfigs,
  promotions,
  surgeConfig,
  smallOrderThreshold,
  type PromotionConfig,
  type RateCard,
} from '@config';
import type { ID, Quote, QuoteLine, Timestamp } from '@core/types';
import { clamp, nextId, round2, roundToStep, sum } from '@core/util';

export interface QuoteInput {
  productId: ID;
  marketId: ID;
  distanceKm: number;
  durationMin: number;
  /** Merchant goods subtotal, delivery only. */
  goodsSubtotal?: number;
  /** Merchant packaging fee, delivery only. */
  packagingFee?: number;
  surgeMultiplier?: number;
  /** Zone surcharges resolved by the caller (airport fees etc.). */
  surcharges?: { label: string; amount: number }[];
  /** Promo code the consumer entered. */
  promotionCode?: string;
  /** Redemptions already used by this account, keyed by promotion id. */
  promoRedemptions?: Record<ID, number>;
  accountAgeDays?: number;
  /** Waiting minutes beyond the free allowance (settlement only). */
  waitingMin?: number;
  tip?: number;
  /** Earner tier, for the pay split. */
  driverTierId?: string;
  now?: Timestamp;
}

/** Resolve a rate card with the market's overrides folded in. */
export function resolveRateCard(rateCardId: string, marketId: string): RateCard | undefined {
  const card = getRateCard(rateCardId);
  if (!card) return undefined;
  const override = card.marketOverrides?.[marketId];
  return override ? { ...card, ...override } : card;
}

export function findPromotion(code: string | undefined): PromotionConfig | undefined {
  if (!code) return undefined;
  const normalised = code.trim().toUpperCase();
  return promotions.find((p) => p.enabled && p.code.toUpperCase() === normalised);
}

export interface PromoEligibility {
  eligible: boolean;
  reason?: string;
  promotion?: PromotionConfig;
}

export function checkPromotion(
  promotion: PromotionConfig | undefined,
  input: { vertical: 'ride' | 'delivery'; productId: ID; subtotal: number; redemptions: Record<ID, number>; accountAgeDays: number },
): PromoEligibility {
  if (!promotion) return { eligible: false };
  if (!promotion.appliesTo.includes(input.vertical)) {
    return { eligible: false, reason: 'Not valid for this service', promotion };
  }
  if (promotion.productIds.length > 0 && !promotion.productIds.includes(input.productId)) {
    return { eligible: false, reason: 'Not valid for this product', promotion };
  }
  if (input.subtotal < promotion.minSubtotal) {
    return { eligible: false, reason: `Minimum of ${promotion.minSubtotal} required`, promotion };
  }
  if ((input.redemptions[promotion.id] ?? 0) >= promotion.usesPerUser) {
    return { eligible: false, reason: 'Redemption limit reached', promotion };
  }
  if (promotion.newUserWithinDays > 0 && input.accountAgeDays > promotion.newUserWithinDays) {
    return { eligible: false, reason: 'New accounts only', promotion };
  }
  return { eligible: true, promotion };
}

/**
 * Surge multiplier from a demand/supply ratio, smoothed and stepped so riders
 * see stable, round numbers rather than a twitching decimal.
 */
export function computeSurge(openRequests: number, availableDrivers: number, previous = 1): number {
  if (!surgeConfig.enabled || !appConfig.features.surgePricing) return 1;
  const supply = Math.max(0.5, availableDrivers);
  const ratio = openRequests / supply;
  const raw = 1 + (ratio - surgeConfig.neutralRatio) * surgeConfig.sensitivity;
  const clamped = clamp(raw, surgeConfig.min, surgeConfig.max);
  const smoothed = previous * surgeConfig.smoothing + clamped * (1 - surgeConfig.smoothing);
  return clamp(roundToStep(smoothed, surgeConfig.step), surgeConfig.min, surgeConfig.max);
}

export const surgeIsVisible = (multiplier: number) =>
  surgeConfig.enabled && multiplier >= surgeConfig.displayThreshold;

/** The engine. Deterministic and side-effect free. */
export function buildQuote(input: QuoteInput): Quote {
  const now = input.now ?? Date.now();
  const product = getProduct(input.productId);
  const market = getMarket(input.marketId);

  if (!product) throw new Error(`Unknown product: ${input.productId}`);
  const card = resolveRateCard(product.rateCardId, input.marketId);
  if (!card) throw new Error(`Unknown rate card: ${product.rateCardId}`);

  const vertical = product.vertical;
  const lines: QuoteLine[] = [];
  const surge = input.surgeMultiplier ?? 1;
  const goods = round2(input.goodsSubtotal ?? 0);

  /* ---------------------------- Goods (delivery) --------------------------- */
  if (vertical === 'delivery' && goods > 0) {
    lines.push({ id: 'goods', label: 'Order subtotal', amount: goods, kind: 'goods' });
  }

  /* -------------------------------- Transport ------------------------------ */
  const baseAmount = card.base;
  const distanceAmount = card.perKm * input.distanceKm;
  const timeAmount = card.perMinute * input.durationMin;
  const waitingMin = input.waitingMin ?? 0;
  const waitingAmount = card.perMinuteWaiting * waitingMin;

  const transportRaw = baseAmount + distanceAmount + timeAmount;
  // Minimum fare tops up the transport component, never the goods.
  const minimumTopUp = Math.max(0, card.minimumFare - transportRaw);

  const surgeBasis =
    card.surgeAppliesTo === 'subtotal'
      ? transportRaw + minimumTopUp
      : card.surgeAppliesTo === 'distance'
        ? distanceAmount
        : 0;
  const surgeAmount = surgeIsVisible(surge) ? surgeBasis * (surge - 1) : 0;

  const transportLabel = vertical === 'delivery' ? 'Delivery fee' : 'Base fare';
  lines.push({ id: 'base', label: transportLabel, amount: round2(baseAmount), kind: 'base' });
  lines.push({
    id: 'distance',
    label: `Distance · ${input.distanceKm.toFixed(1)} ${appConfig.distanceUnit}`,
    amount: round2(distanceAmount),
    kind: 'distance',
    hint: `${card.perKm.toFixed(2)} per ${appConfig.distanceUnit}`,
  });
  if (card.perMinute > 0) {
    lines.push({
      id: 'time',
      label: `Time · ${Math.round(input.durationMin)} min`,
      amount: round2(timeAmount),
      kind: 'time',
      hint: `${card.perMinute.toFixed(2)} per min`,
    });
  }
  if (minimumTopUp > 0.005) {
    lines.push({ id: 'minimum', label: 'Minimum fare adjustment', amount: round2(minimumTopUp), kind: 'adjustment' });
  }
  if (waitingAmount > 0.005) {
    lines.push({
      id: 'wait',
      label: `Wait time · ${Math.round(waitingMin)} min`,
      amount: round2(waitingAmount),
      kind: 'wait',
      hint: `First ${Math.round(card.freeWaitingSec / 60)} min free`,
    });
  }
  if (surgeAmount > 0.005) {
    lines.push({
      id: 'surge',
      label: `Higher demand · ${surge.toFixed(1)}x`,
      amount: round2(surgeAmount),
      kind: 'surge',
      hint: 'Extra goes to your driver',
    });
  }

  /* ------------------------------- Surcharges ------------------------------ */
  for (const surcharge of input.surcharges ?? []) {
    lines.push({
      id: `surcharge-${surcharge.label.toLowerCase().replace(/\s+/g, '-')}`,
      label: surcharge.label,
      amount: round2(surcharge.amount),
      kind: 'surcharge',
    });
  }

  if (vertical === 'delivery' && (input.packagingFee ?? 0) > 0) {
    lines.push({ id: 'packaging', label: 'Packaging', amount: round2(input.packagingFee!), kind: 'fee' });
  }

  /* ---------------------------------- Fees --------------------------------- */
  const fareBasis = round2(
    baseAmount + distanceAmount + timeAmount + minimumTopUp + waitingAmount + surgeAmount +
      sum((input.surcharges ?? []).map((s) => s.amount)),
  );

  const applicableFees = feeConfigs.filter((f) => f.enabled && f.appliesTo.includes(vertical));
  for (const fee of applicableFees) {
    if (fee.id === 'small-order' && goods >= smallOrderThreshold) continue;
    if (fee.id === 'small-order' && goods === 0) continue;
    const basis = fee.basis === 'goods' ? goods : fee.basis === 'fare' ? fareBasis : fareBasis + goods;
    if (fee.minSubtotal !== undefined && basis < fee.minSubtotal && fee.id !== 'small-order') continue;
    let amount = fee.kind === 'flat' ? fee.amount : basis * fee.rate;
    if (fee.maxAmount !== undefined) amount = Math.min(amount, fee.maxAmount);
    if (amount <= 0.005) continue;
    lines.push({
      id: `fee-${fee.id}`,
      label: fee.label,
      amount: round2(amount),
      kind: 'fee',
      hint: fee.description,
    });
  }

  /* -------------------------------- Discount ------------------------------- */
  const preDiscountSubtotal = round2(sum(lines.filter((l) => !l.informational).map((l) => l.amount)));

  let discount = 0;
  let appliedPromotionId: ID | undefined;
  const promotion = findPromotion(input.promotionCode);
  const eligibility = checkPromotion(promotion, {
    vertical,
    productId: input.productId,
    subtotal: vertical === 'delivery' ? goods : fareBasis,
    redemptions: input.promoRedemptions ?? {},
    accountAgeDays: input.accountAgeDays ?? 9999,
  });

  if (appConfig.features.promotions && eligibility.eligible && eligibility.promotion) {
    const p = eligibility.promotion;
    if (p.kind === 'percent') discount = Math.min(p.maxDiscount, preDiscountSubtotal * p.value);
    else if (p.kind === 'flat') discount = Math.min(p.value, preDiscountSubtotal);
    else if (p.kind === 'free_delivery') {
      const deliveryPortion = fareBasis;
      discount = Math.min(p.maxDiscount, deliveryPortion);
    }
    discount = round2(Math.max(0, discount));
    if (discount > 0) {
      appliedPromotionId = p.id;
      lines.push({ id: 'promo', label: p.label, amount: -discount, kind: 'discount', hint: p.code });
    }
  }

  /* ----------------------------------- Tax --------------------------------- */
  const taxableFees = sum(
    lines.filter((l) => l.kind === 'fee' && market.tax.appliesTo.includes('fees')).map((l) => l.amount),
  );
  const taxableGoods = market.tax.appliesTo.includes('goods') ? goods : 0;
  const taxableFare = market.tax.appliesTo.includes('fare') ? fareBasis : 0;
  const taxBase = Math.max(0, taxableFees + taxableGoods + taxableFare - discount);
  const tax = round2(taxBase * market.tax.rate);
  if (tax > 0.005) {
    lines.push({ id: 'tax', label: market.tax.label, amount: tax, kind: 'tax' });
  }

  /* ----------------------------------- Tip --------------------------------- */
  const tip = round2(input.tip ?? 0);
  if (appConfig.features.tipping && tip > 0) {
    lines.push({ id: 'tip', label: 'Tip', amount: tip, kind: 'tip' });
  }

  const total = round2(sum(lines.filter((l) => !l.informational).map((l) => l.amount)));

  /* ------------------------------- Pay split ------------------------------- */
  const takeRate = driverPayConfig.tierTakeRate[input.driverTierId ?? ''] ?? driverPayConfig.baseTakeRate;
  const earnerBase = round2((fareBasis - surgeAmount) * takeRate);
  const earnerSurge = round2(surgeAmount * driverPayConfig.surgeShare);
  const deliveryTopUp =
    vertical === 'delivery'
      ? round2(driverPayConfig.deliveryPerPickup + driverPayConfig.deliveryPerKm * input.distanceKm)
      : 0;
  const earnerPayout = round2(
    Math.max(driverPayConfig.minimumPerJob, earnerBase + earnerSurge + deliveryTopUp) + tip * driverPayConfig.tipShare,
  );

  const platformFees = sum(
    applicableFees
      .filter((f) => f.platformRevenue)
      .map((f) => lines.find((l) => l.id === `fee-${f.id}`)?.amount ?? 0),
  );
  const platformRevenue = round2(fareBasis - (earnerPayout - tip) + platformFees - discount);

  return {
    id: nextId('qte'),
    productId: input.productId,
    marketId: input.marketId,
    vertical,
    currency: appConfig.currency,
    distanceKm: round2(input.distanceKm),
    durationMin: Math.round(input.durationMin),
    surgeMultiplier: surge,
    lines,
    subtotal: preDiscountSubtotal,
    discount,
    tax,
    total,
    earnerPayout,
    platformRevenue,
    createdAt: now,
    expiresAt: now + 5 * 60 * 1000,
    promotionId: appliedPromotionId,
  };
}

/** Cancellation charge for a job cancelled at `elapsedSec` after request. */
export function cancellationCharge(productId: ID, marketId: ID, elapsedSec: number): { amount: number; withinGrace: boolean } {
  const product = getProduct(productId);
  const card = product ? resolveRateCard(product.rateCardId, marketId) : undefined;
  if (!card) return { amount: 0, withinGrace: true };
  const withinGrace = elapsedSec <= card.cancellationGraceSec;
  return { amount: withinGrace ? 0 : round2(card.cancellationFee), withinGrace };
}

/** Suggested tip amounts, derived from the fare rather than fixed buttons. */
export function tipSuggestions(total: number): number[] {
  const percentages = [0.1, 0.15, 0.2];
  const raw = percentages.map((p) => Math.max(1, Math.round(total * p * 2) / 2));
  return Array.from(new Set(raw));
}
