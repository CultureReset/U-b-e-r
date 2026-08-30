/**
 * Single import surface for all platform configuration.
 *
 * Every value the product depends on — money, geography, catalogue shape,
 * policy, branding, population — resolves through this module. There are no
 * literal business values inside `src/`.
 */
export * from './brand.config';
export * from './app.config';
export * from './market.config';
export * from './products.config';
export * from './pricing.config';
export * from './fleet.config';
export * from './catalog.config';
export * from './payments.config';
export * from './org.config';
export * from './seed.config';

import { brandConfig } from './brand.config';
import { appConfig } from './app.config';
import { marketConfigs, defaultMarketId } from './market.config';
import { productConfigs } from './products.config';
import { rateCards, feeConfigs, surgeConfig, driverPayConfig, smallOrderThreshold } from './pricing.config';
import {
  vehicleClasses,
  driverTiers,
  driverTags,
  incentives,
  onboardingRequirements,
  tierPointsPerJob,
} from './fleet.config';
import { catalogConfig } from './catalog.config';
import { paymentMethods, promotions, payoutConfig } from './payments.config';
import { orgConfig } from './org.config';
import { seedConfig } from './seed.config';

export const platformConfig = {
  brand: brandConfig,
  app: appConfig,
  markets: marketConfigs,
  defaultMarketId,
  products: productConfigs,
  pricing: { rateCards, fees: feeConfigs, surge: surgeConfig, driverPay: driverPayConfig, smallOrderThreshold },
  fleet: { vehicleClasses, driverTiers, driverTags, incentives, onboardingRequirements, tierPointsPerJob },
  catalog: catalogConfig,
  payments: { methods: paymentMethods, promotions, payout: payoutConfig },
  org: orgConfig,
  seed: seedConfig,
};

export type PlatformConfig = typeof platformConfig;

/* ------------------------------------------------------------------ */
/* Lookup helpers — the only sanctioned way to read config at runtime. */
/* ------------------------------------------------------------------ */

export const getMarket = (id: string) =>
  marketConfigs.find((m) => m.id === id) ?? marketConfigs[0];

export const getProduct = (id: string) => productConfigs.find((p) => p.id === id);

export const getProductsForMarket = (marketId: string, vertical?: 'ride' | 'delivery') =>
  productConfigs
    .filter((p) => p.enabled)
    .filter((p) => p.markets.length === 0 || p.markets.includes(marketId))
    .filter((p) => (vertical ? p.vertical === vertical : true))
    .sort((a, b) => a.sort - b.sort);

export const getRateCard = (id: string) => rateCards.find((r) => r.id === id);

export const getVehicleClass = (id: string) => vehicleClasses.find((v) => v.id === id);

export const getTierForPoints = (points: number) =>
  [...driverTiers].reverse().find((t) => points >= t.pointsRequired) ?? driverTiers[0];

export const getPaymentMethodsForMarket = (marketId: string, vertical: 'ride' | 'delivery') =>
  paymentMethods.filter(
    (m) => m.enabled && m.appliesTo.includes(vertical) && (m.markets.length === 0 || m.markets.includes(marketId)),
  );

export const getSurfaceAccent = (surfaceId: string) =>
  brandConfig.surfaceAccents[surfaceId] ?? brandConfig.palettes.light.accent;
