/**
 * Rate cards and the fee/surge/promo rules the fare engine evaluates.
 * The engine (core/pricing) is generic: it reads these declarations and
 * produces a fully itemised quote. Change money here, never in code.
 */

export interface RateCard {
  id: string;
  label: string;
  /** Currency minor-unit precision used for rounding. */
  base: number;
  perKm: number;
  perMinute: number;
  /** Charged while the vehicle is stationary and waiting on the rider. */
  perMinuteWaiting: number;
  minimumFare: number;
  /** Cancellation charge once the grace window has elapsed. */
  cancellationFee: number;
  cancellationGraceSec: number;
  /** Free waiting time at pickup before per-minute waiting kicks in. */
  freeWaitingSec: number;
  /** Applied to the distance+time subtotal when surge is active. */
  surgeAppliesTo: 'subtotal' | 'distance' | 'none';
  /** Per-market overrides keyed by market id. */
  marketOverrides?: Record<string, Partial<Omit<RateCard, 'id' | 'label' | 'marketOverrides'>>>;
}

export interface FeeConfig {
  id: string;
  label: string;
  description: string;
  /** 'flat' adds amount; 'percent' takes rate of the named basis. */
  kind: 'flat' | 'percent';
  amount: number;
  rate: number;
  basis: 'fare' | 'goods' | 'subtotal';
  appliesTo: ('ride' | 'delivery')[];
  /** Fee is paid to the platform (true) or passed through to a third party. */
  platformRevenue: boolean;
  /** Only charge when the order/trip satisfies this optional threshold. */
  minSubtotal?: number;
  maxAmount?: number;
  enabled: boolean;
}

export interface SurgeConfig {
  enabled: boolean;
  /** Multiplier is derived from demand/supply ratio, clamped to this range. */
  min: number;
  max: number;
  /** Ratio at which multiplier hits 1.0. */
  neutralRatio: number;
  /** How strongly the ratio pushes the multiplier. */
  sensitivity: number;
  /** Rounded to this step so riders see clean numbers. */
  step: number;
  /** Multiplier below which surge is not shown at all. */
  displayThreshold: number;
  /** Smoothing between recomputes (0 = jump instantly, 1 = never move). */
  smoothing: number;
}

export interface DriverPayConfig {
  /** Share of the fare (after pass-through fees) the earner keeps. */
  baseTakeRate: number;
  /** Take rate improves with tier — keyed by tier id from fleet.config. */
  tierTakeRate: Record<string, number>;
  /** Earner receives this share of surge. */
  surgeShare: number;
  /** Guaranteed minimum per completed job. */
  minimumPerJob: number;
  /** Per-km and per-min top-ups paid on delivery jobs. */
  deliveryPerKm: number;
  deliveryPerPickup: number;
  /** Rider tips are always 100% to the earner. */
  tipShare: number;
  /** Paid when a rider cancels after the grace window. */
  cancellationCompensation: number;
}

export const rateCards: RateCard[] = [
  {
    id: 'rc-go',
    label: 'Go',
    base: 1.8,
    perKm: 0.85,
    perMinute: 0.22,
    perMinuteWaiting: 0.35,
    minimumFare: 3.2,
    cancellationFee: 2.5,
    cancellationGraceSec: 120,
    freeWaitingSec: 120,
    surgeAppliesTo: 'subtotal',
    marketOverrides: { bog: { base: 1.35, perKm: 0.62, perMinute: 0.16, minimumFare: 2.4 } },
  },
  {
    id: 'rc-share',
    label: 'Share',
    base: 1.2,
    perKm: 0.58,
    perMinute: 0.15,
    perMinuteWaiting: 0.25,
    minimumFare: 2.4,
    cancellationFee: 2.0,
    cancellationGraceSec: 120,
    freeWaitingSec: 90,
    surgeAppliesTo: 'subtotal',
    marketOverrides: { bog: { base: 0.95, perKm: 0.44, perMinute: 0.11, minimumFare: 1.8 } },
  },
  {
    id: 'rc-comfort',
    label: 'Comfort',
    base: 2.6,
    perKm: 1.15,
    perMinute: 0.3,
    perMinuteWaiting: 0.45,
    minimumFare: 5.0,
    cancellationFee: 4.0,
    cancellationGraceSec: 120,
    freeWaitingSec: 180,
    surgeAppliesTo: 'subtotal',
    marketOverrides: { bog: { base: 2.0, perKm: 0.9, perMinute: 0.22, minimumFare: 3.9 } },
  },
  {
    id: 'rc-xl',
    label: 'XL',
    base: 3.1,
    perKm: 1.4,
    perMinute: 0.34,
    perMinuteWaiting: 0.5,
    minimumFare: 6.2,
    cancellationFee: 5.0,
    cancellationGraceSec: 120,
    freeWaitingSec: 180,
    surgeAppliesTo: 'subtotal',
    marketOverrides: { bog: { base: 2.4, perKm: 1.05, perMinute: 0.26, minimumFare: 4.8 } },
  },
  {
    id: 'rc-black',
    label: 'Black',
    base: 6.0,
    perKm: 2.3,
    perMinute: 0.55,
    perMinuteWaiting: 0.8,
    minimumFare: 14.0,
    cancellationFee: 10.0,
    cancellationGraceSec: 300,
    freeWaitingSec: 300,
    surgeAppliesTo: 'subtotal',
    marketOverrides: { bog: { base: 4.6, perKm: 1.8, perMinute: 0.42, minimumFare: 11.0 } },
  },
  {
    id: 'rc-moto',
    label: 'Moto',
    base: 0.9,
    perKm: 0.38,
    perMinute: 0.09,
    perMinuteWaiting: 0.15,
    minimumFare: 1.5,
    cancellationFee: 1.2,
    cancellationGraceSec: 90,
    freeWaitingSec: 90,
    surgeAppliesTo: 'subtotal',
  },
  {
    id: 'rc-delivery',
    label: 'Delivery',
    base: 1.5,
    perKm: 0.6,
    perMinute: 0.0,
    perMinuteWaiting: 0.0,
    minimumFare: 1.5,
    cancellationFee: 3.0,
    cancellationGraceSec: 60,
    freeWaitingSec: 0,
    surgeAppliesTo: 'distance',
    marketOverrides: { bog: { base: 1.1, perKm: 0.45 } },
  },
  {
    id: 'rc-delivery-priority',
    label: 'Priority delivery',
    base: 3.2,
    perKm: 0.75,
    perMinute: 0.0,
    perMinuteWaiting: 0.0,
    minimumFare: 3.2,
    cancellationFee: 3.5,
    cancellationGraceSec: 60,
    freeWaitingSec: 0,
    surgeAppliesTo: 'distance',
    marketOverrides: { bog: { base: 2.4, perKm: 0.6 } },
  },
  {
    id: 'rc-parcel',
    label: 'Parcel',
    base: 2.2,
    perKm: 0.7,
    perMinute: 0.05,
    perMinuteWaiting: 0.2,
    minimumFare: 3.5,
    cancellationFee: 2.5,
    cancellationGraceSec: 90,
    freeWaitingSec: 120,
    surgeAppliesTo: 'distance',
  },
];

export const feeConfigs: FeeConfig[] = [
  {
    id: 'booking',
    label: 'Booking fee',
    description: 'Covers regulatory, safety and operational costs.',
    kind: 'flat',
    amount: 1.75,
    rate: 0,
    basis: 'fare',
    appliesTo: ['ride'],
    platformRevenue: true,
    enabled: true,
  },
  {
    id: 'service',
    label: 'Service fee',
    description: 'Platform fee on the order subtotal.',
    kind: 'percent',
    amount: 0,
    rate: 0.15,
    basis: 'goods',
    appliesTo: ['delivery'],
    platformRevenue: true,
    maxAmount: 12,
    enabled: true,
  },
  {
    id: 'small-order',
    label: 'Small order fee',
    description: 'Applied to orders under the minimum basket size.',
    kind: 'flat',
    amount: 2.0,
    rate: 0,
    basis: 'goods',
    appliesTo: ['delivery'],
    platformRevenue: true,
    minSubtotal: 0,
    enabled: true,
  },
  {
    id: 'city-levy',
    label: 'City levy',
    description: 'Municipal per-trip charge, passed through in full.',
    kind: 'flat',
    amount: 0.35,
    rate: 0,
    basis: 'fare',
    appliesTo: ['ride', 'delivery'],
    platformRevenue: false,
    enabled: true,
  },
];

/** Small-order threshold, expressed separately so merchants can override it. */
export const smallOrderThreshold = 12;

export const surgeConfig: SurgeConfig = {
  enabled: true,
  min: 1,
  max: 3.5,
  neutralRatio: 1,
  sensitivity: 0.55,
  step: 0.1,
  displayThreshold: 1.15,
  smoothing: 0.6,
};

export const driverPayConfig: DriverPayConfig = {
  baseTakeRate: 0.75,
  tierTakeRate: { bronze: 0.75, silver: 0.77, gold: 0.8, platinum: 0.83 },
  surgeShare: 1,
  minimumPerJob: 2.2,
  deliveryPerKm: 0.55,
  deliveryPerPickup: 1.1,
  tipShare: 1,
  cancellationCompensation: 2.0,
};
