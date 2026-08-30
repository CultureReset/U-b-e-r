/**
 * Fare engine. These assertions pin the invariants every surface relies on:
 * a quote's lines must sum to its total, minimum fares must top up rather than
 * replace, surge must stay inside its configured band, and the pay split must
 * never leave an earner below the guaranteed minimum.
 */
import { describe, expect, it } from 'vitest';
import {
  buildQuote,
  cancellationCharge,
  checkPromotion,
  computeSurge,
  findPromotion,
  resolveRateCard,
  tipSuggestions,
} from '@core/pricing';
import { driverPayConfig, getMarket, promotions, surgeConfig } from '@config';

const BOG = 'bog';

const sumLines = (quote: ReturnType<typeof buildQuote>) =>
  Math.round(quote.lines.reduce((acc, line) => acc + line.amount, 0) * 100) / 100;

describe('buildQuote', () => {
  it('produces a total equal to the sum of its own lines', () => {
    const quote = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 7.4, durationMin: 19 });
    expect(sumLines(quote)).toBeCloseTo(quote.total, 2);
  });

  it('applies the market override rather than the base rate card', () => {
    const base = resolveRateCard('rc-go', 'sfo')!;
    const bogota = resolveRateCard('rc-go', BOG)!;
    expect(bogota.perKm).toBeLessThan(base.perKm);

    const cheap = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 10, durationMin: 20 });
    const dear = buildQuote({ productId: 'go', marketId: 'sfo', distanceKm: 10, durationMin: 20 });
    expect(cheap.total).toBeLessThan(dear.total);
  });

  it('tops a short trip up to the minimum fare instead of replacing it', () => {
    const card = resolveRateCard('rc-go', BOG)!;
    const quote = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 0.3, durationMin: 2 });
    const transport = quote.lines
      .filter((l) => ['base', 'distance', 'time', 'adjustment'].includes(l.kind))
      .reduce((acc, l) => acc + l.amount, 0);
    expect(transport).toBeCloseTo(card.minimumFare, 1);
    expect(quote.lines.some((l) => l.id === 'minimum')).toBe(true);
  });

  it('charges surge only above the display threshold, and only on the configured basis', () => {
    const flat = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 8, durationMin: 20, surgeMultiplier: 1.05 });
    expect(flat.lines.some((l) => l.kind === 'surge')).toBe(false);

    const surged = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 8, durationMin: 20, surgeMultiplier: 2 });
    const surgeLine = surged.lines.find((l) => l.kind === 'surge');
    expect(surgeLine).toBeDefined();
    expect(surged.total).toBeGreaterThan(flat.total);
  });

  it('passes the whole surge premium through to the earner', () => {
    const flat = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 8, durationMin: 20, surgeMultiplier: 1 });
    const surged = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 8, durationMin: 20, surgeMultiplier: 2 });
    const surgeLine = surged.lines.find((l) => l.kind === 'surge')!;
    expect(surged.earnerPayout - flat.earnerPayout).toBeCloseTo(surgeLine.amount * driverPayConfig.surgeShare, 1);
  });

  it('never pays an earner less than the per-job minimum', () => {
    const quote = buildQuote({ productId: 'moto', marketId: BOG, distanceKm: 0.2, durationMin: 1 });
    expect(quote.earnerPayout).toBeGreaterThanOrEqual(driverPayConfig.minimumPerJob);
  });

  it('adds the whole tip to the earner and to the rider total', () => {
    const withoutTip = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 5, durationMin: 12 });
    const withTip = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 5, durationMin: 12, tip: 4 });
    expect(withTip.total - withoutTip.total).toBeCloseTo(4, 2);
    expect(withTip.earnerPayout - withoutTip.earnerPayout).toBeCloseTo(4, 2);
  });

  it('taxes only what the market says is taxable', () => {
    const market = getMarket(BOG);
    expect(market.tax.appliesTo).not.toContain('fare');
    const ride = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 6, durationMin: 15 });
    const delivery = buildQuote({
      productId: 'eats-standard',
      marketId: BOG,
      distanceKm: 3,
      durationMin: 9,
      goodsSubtotal: 40,
    });
    // Rides are taxed on fees only; a delivery also carries goods tax.
    expect(delivery.tax).toBeGreaterThan(ride.tax);
  });

  it('honours a delivery promotion and caps the discount', () => {
    const promo = promotions.find((p) => p.code === 'LUNCH5')!;
    const quote = buildQuote({
      productId: 'eats-standard',
      marketId: BOG,
      distanceKm: 3,
      durationMin: 10,
      goodsSubtotal: 40,
      promotionCode: promo.code,
    });
    expect(quote.promotionId).toBe(promo.id);
    expect(quote.discount).toBeLessThanOrEqual(promo.maxDiscount);
    expect(sumLines(quote)).toBeCloseTo(quote.total, 2);
  });

  it('rejects a promotion below its minimum basket', () => {
    const promo = findPromotion('LUNCH5')!;
    const result = checkPromotion(promo, {
      vertical: 'delivery',
      productId: 'eats-standard',
      subtotal: 5,
      redemptions: {},
      accountAgeDays: 500,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/minimum/i);
  });

  it('rejects a new-user promotion for an established account', () => {
    const promo = findPromotion('WELCOME50')!;
    expect(
      checkPromotion(promo, {
        vertical: 'ride',
        productId: 'go',
        subtotal: 20,
        redemptions: {},
        accountAgeDays: 400,
      }).eligible,
    ).toBe(false);
  });

  it('stops honouring a promotion once the redemption limit is reached', () => {
    const promo = findPromotion('LUNCH5')!;
    expect(
      checkPromotion(promo, {
        vertical: 'delivery',
        productId: 'eats-standard',
        subtotal: 40,
        redemptions: { [promo.id]: promo.usesPerUser },
        accountAgeDays: 100,
      }).eligible,
    ).toBe(false);
  });

  it('charges the small-order fee only under the threshold', () => {
    const small = buildQuote({ productId: 'eats-standard', marketId: BOG, distanceKm: 2, durationMin: 8, goodsSubtotal: 6 });
    const large = buildQuote({ productId: 'eats-standard', marketId: BOG, distanceKm: 2, durationMin: 8, goodsSubtotal: 60 });
    expect(small.lines.some((l) => l.id === 'fee-small-order')).toBe(true);
    expect(large.lines.some((l) => l.id === 'fee-small-order')).toBe(false);
  });

  it('improves the pay split for a higher earner tier', () => {
    const bronze = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 12, durationMin: 25, driverTierId: 'bronze' });
    const platinum = buildQuote({ productId: 'go', marketId: BOG, distanceKm: 12, durationMin: 25, driverTierId: 'platinum' });
    expect(platinum.earnerPayout).toBeGreaterThan(bronze.earnerPayout);
    expect(platinum.total).toBeCloseTo(bronze.total, 2);
  });
});

describe('computeSurge', () => {
  it('stays inside the configured band however extreme the ratio', () => {
    expect(computeSurge(500, 1)).toBeLessThanOrEqual(surgeConfig.max);
    expect(computeSurge(0, 500)).toBeGreaterThanOrEqual(surgeConfig.min);
  });

  it('rises with demand and falls with supply', () => {
    const scarce = computeSurge(40, 4, 1);
    const plentiful = computeSurge(4, 40, 1);
    expect(scarce).toBeGreaterThan(plentiful);
  });

  it('smooths toward the target rather than jumping', () => {
    const first = computeSurge(60, 4, 1);
    const second = computeSurge(60, 4, first);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it('never divides by zero when supply is empty', () => {
    expect(Number.isFinite(computeSurge(10, 0))).toBe(true);
  });
});

describe('cancellation and tipping', () => {
  it('waives the fee inside the grace window and charges outside it', () => {
    const card = resolveRateCard('rc-go', BOG)!;
    expect(cancellationCharge('go', BOG, card.cancellationGraceSec - 1).amount).toBe(0);
    expect(cancellationCharge('go', BOG, card.cancellationGraceSec + 1).amount).toBe(card.cancellationFee);
  });

  it('suggests distinct, ascending tips', () => {
    const suggestions = tipSuggestions(30);
    expect(new Set(suggestions).size).toBe(suggestions.length);
    expect([...suggestions].sort((a, b) => a - b)).toEqual(suggestions);
  });
});
