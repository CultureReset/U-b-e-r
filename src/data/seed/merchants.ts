/**
 * Storefront generation from catalogue archetypes.
 *
 * An archetype is a template: cuisine, price band, menu section shapes and
 * which shared modifier groups its items carry. The generator instantiates as
 * many concrete merchants as the market needs, giving each its own name,
 * location, hours, prices and availability. Replace an archetype and the whole
 * storefront population changes shape.
 */
import { catalogConfig, getMarket, type MerchantArchetype } from '@config';
import { zoneAt } from '@core/geo';
import type { Merchant, MenuItem, MenuSection, ModifierGroup } from '@core/types';
import { clamp, nextId, round2, type Rng } from '@core/util';
import { addressFor, randomDemandPoint } from './places';

const ITEM_GLYPHS: Record<string, string> = {
  Burgers: '🍔',
  Colombian: '🍲',
  Pizza: '🍕',
  Japanese: '🍣',
  Bowls: '🥗',
  Coffee: '☕',
  Grocery: '🛒',
  Pharmacy: '💊',
};

function buildModifierGroups(ids: string[], basePrice: number, rng: Rng): ModifierGroup[] {
  return ids
    .map((id) => catalogConfig.modifierGroups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .map((template) => ({
      id: nextId('mgr'),
      name: template.name,
      select: template.select,
      required: template.required,
      minSelect: template.minSelect,
      maxSelect: template.maxSelect,
      options: template.options.map((opt) => ({
        id: nextId('mop'),
        name: opt.name,
        priceDelta: round2(basePrice * opt.priceFactor),
        isDefault: Boolean(opt.isDefault),
        // A small share of options are 86'd, which the merchant dashboard can toggle back.
        available: !rng.bool(0.04),
      })),
    }));
}

function buildMenu(archetype: MerchantArchetype, rng: Rng): MenuSection[] {
  const band = catalogConfig.priceBands[archetype.priceTier];
  return archetype.menu.map((section) => ({
    id: nextId('sec'),
    name: section.name,
    items: section.items.map((template): MenuItem => {
      // Per-merchant price variance so two storefronts of the same archetype differ.
      const price = round2(band * template.priceIndex * rng.float(0.9, 1.15));
      return {
        id: nextId('itm'),
        name: template.name,
        description: template.description,
        price,
        tags: template.tags,
        modifierGroups: buildModifierGroups(template.modifierGroupIds, price, rng),
        available: !rng.bool(0.06),
        popular: rng.bool(template.popularity),
        prepMinutes: template.prepMinutes,
        glyph: ITEM_GLYPHS[archetype.cuisine] ?? archetype.glyph,
        cargoUnits: clamp(Math.round(price / 6), 1, 4),
      };
    }),
  }));
}

function buildName(archetype: MerchantArchetype, rng: Rng, taken: Set<string>): string {
  for (let attempt = 0; attempt < 12; attempt++) {
    const name = `${rng.pick(archetype.nameParts.prefix)} ${rng.pick(archetype.nameParts.suffix)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const fallback = `${rng.pick(archetype.nameParts.prefix)} ${rng.pick(archetype.nameParts.suffix)} ${taken.size}`;
  taken.add(fallback);
  return fallback;
}

/** Is the storefront trading at the given local hour? Handles past-midnight closes. */
export function isOpenAtHour(hours: { open: number; close: number }, hour: number): boolean {
  if (hours.close > 24) return hour >= hours.open || hour < hours.close - 24;
  return hour >= hours.open && hour < hours.close;
}

export function generateMerchant(marketId: string, rng: Rng, hourOfDay: number, taken: Set<string>): Merchant {
  const market = getMarket(marketId);
  const archetype = rng.pickWeighted(catalogConfig.archetypes, (a) => a.weight);
  const at = randomDemandPoint(market, rng);
  const { addressLine } = addressFor(marketId, at);
  const zone = zoneAt(market, at);
  const hoursTemplate = rng.pick(catalogConfig.hoursTemplates);
  const hours = { templateId: hoursTemplate.id, open: hoursTemplate.open, close: hoursTemplate.close };
  const basePrep = archetype.basePrepMinutes + rng.int(-3, 5);

  return {
    id: nextId('mch'),
    archetypeId: archetype.id,
    marketId,
    name: buildName(archetype, rng, taken),
    cuisine: archetype.cuisine,
    category: archetype.category,
    glyph: archetype.glyph,
    accent: archetype.accent,
    priceTier: archetype.priceTier,
    rating: round2(rng.float(archetype.ratingRange[0], archetype.ratingRange[1])),
    ratingCount: rng.int(24, 3600),
    at,
    addressLine,
    zoneId: zone?.id,
    hours,
    isOpen: isOpenAtHour(hours, hourOfDay),
    basePrepMinutes: basePrep,
    currentPrepMinutes: basePrep,
    menu: buildMenu(archetype, rng),
    settings: {
      ...archetype.defaults,
      minimumOrder: round2(archetype.defaults.minimumOrder * rng.float(0.85, 1.2)),
      paused: false,
    },
    stats: {
      ordersToday: rng.int(0, 90),
      revenueToday: round2(rng.float(0, 2400)),
      acceptRate: round2(clamp(rng.gaussian(0.94, 0.06), 0.6, 1)),
      avgPrepMinutes: basePrep + rng.int(-2, 4),
    },
    busy: rng.bool(0.12),
  };
}

/** Flatten a merchant's menu into a lookup, used by cart and order code. */
export function menuIndex(merchant: Merchant): Map<string, MenuItem> {
  const index = new Map<string, MenuItem>();
  for (const section of merchant.menu) for (const item of section.items) index.set(item.id, item);
  return index;
}

/** Merchant's live prep estimate grows with the queue and the busy flag. */
export function recomputePrepMinutes(merchant: Merchant, openOrderCount: number): number {
  const load = Math.floor(openOrderCount / 3) * 2;
  const busyPenalty = merchant.busy ? 6 : 0;
  return Math.round(merchant.basePrepMinutes + load + busyPenalty);
}
