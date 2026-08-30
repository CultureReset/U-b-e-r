/**
 * Platform-level runtime configuration: which surfaces exist, feature flags,
 * locale/currency, simulation behaviour and the data adapter to bind.
 */

export type SurfaceId = 'rider' | 'eats' | 'driver' | 'merchant' | 'business' | 'admin';

export interface SurfaceDefinition {
  id: SurfaceId;
  label: string;
  /** Who this surface is built for — shown in the surface switcher. */
  audience: string;
  description: string;
  icon: string;
  route: string;
  enabled: boolean;
  /** Presentation frame: 'device' renders inside a phone chrome, 'console' is full-bleed. */
  frame: 'device' | 'console';
}

export interface AppConfig {
  locale: string;
  currency: string;
  currencyLocale: string;
  distanceUnit: 'km' | 'mi';
  timeFormat: '12h' | '24h';
  /** Which data adapter the platform boots against. */
  dataAdapter: 'memory' | 'rest';
  restBaseUrl: string;
  /** Persist the world to localStorage between reloads. */
  persistence: { enabled: boolean; key: string; version: number };
  simulation: {
    enabled: boolean;
    /** Wall-clock ms between world ticks. */
    tickMs: number;
    /** Simulated seconds advanced per tick. */
    secondsPerTick: number;
    /** Deterministic seed so every boot produces the same world. */
    seed: number;
    /**
     * Local hour the simulated clock starts at. Boot at a busy time of day so
     * the market has something to show; set to null to start at wall clock.
     */
    startHour: number | null;
    startMinute: number;
    /** Auto-generate ambient demand so the world feels alive. */
    ambientDemand: { enabled: boolean; ridesPerHour: number; ordersPerHour: number };
    /** Auto-accept offers on behalf of AI drivers after this many simulated seconds. */
    autoDriverAcceptAfterSec: number;
  };
  features: {
    surgePricing: boolean;
    scheduledRides: boolean;
    poolRides: boolean;
    tipping: boolean;
    promotions: boolean;
    ratings: boolean;
    liveLocationSharing: boolean;
    safetyToolkit: boolean;
    multiStop: boolean;
    batchedDeliveries: boolean;
    businessProfiles: boolean;
    driverQuests: boolean;
    inAppChat: boolean;
    receiptExport: boolean;
    configInspector: boolean;
  };
  limits: {
    maxStopsPerTrip: number;
    maxCartQuantity: number;
    offerTimeoutSec: number;
    maxDispatchRadiusKm: number;
    maxOffersPerRequest: number;
    ratingScale: number;
  };
  surfaces: SurfaceDefinition[];
}

export const appConfig: AppConfig = {
  locale: 'en-US',
  currency: 'USD',
  currencyLocale: 'en-US',
  distanceUnit: 'km',
  timeFormat: '12h',
  dataAdapter: 'memory',
  restBaseUrl: '/api',
  persistence: { enabled: true, key: 'urus.world', version: 4 },
  simulation: {
    enabled: true,
    tickMs: 500,
    secondsPerTick: 6,
    seed: 20260830,
    startHour: 12,
    startMinute: 40,
    ambientDemand: { enabled: true, ridesPerHour: 110, ordersPerHour: 70 },
    autoDriverAcceptAfterSec: 12,
  },
  features: {
    surgePricing: true,
    scheduledRides: true,
    poolRides: true,
    tipping: true,
    promotions: true,
    ratings: true,
    liveLocationSharing: true,
    safetyToolkit: true,
    multiStop: true,
    batchedDeliveries: true,
    businessProfiles: true,
    driverQuests: true,
    inAppChat: true,
    receiptExport: true,
    configInspector: true,
  },
  limits: {
    maxStopsPerTrip: 4,
    maxCartQuantity: 20,
    offerTimeoutSec: 25,
    maxDispatchRadiusKm: 8,
    maxOffersPerRequest: 6,
    ratingScale: 5,
  },
  surfaces: [
    {
      id: 'rider',
      label: 'Rides',
      audience: 'Consumer',
      description: 'Request, track and pay for a ride.',
      icon: 'car',
      route: '/rider',
      enabled: true,
      frame: 'device',
    },
    {
      id: 'eats',
      label: 'Eats',
      audience: 'Consumer',
      description: 'Browse merchants, build a cart, track delivery.',
      icon: 'bag',
      route: '/eats',
      enabled: true,
      frame: 'device',
    },
    {
      id: 'driver',
      label: 'Driver',
      audience: 'Earner',
      description: 'Go online, accept offers, run trips and deliveries, track earnings.',
      icon: 'wheel',
      route: '/driver',
      enabled: true,
      frame: 'device',
    },
    {
      id: 'merchant',
      label: 'Merchant',
      audience: 'Business',
      description: 'Order queue, menu management, storefront hours and payouts.',
      icon: 'store',
      route: '/merchant',
      enabled: true,
      frame: 'console',
    },
    {
      id: 'business',
      label: 'Business',
      audience: 'Business',
      description: 'Employee travel programme, policy, expensing and reporting.',
      icon: 'briefcase',
      route: '/business',
      enabled: true,
      frame: 'console',
    },
    {
      id: 'admin',
      label: 'Ops',
      audience: 'Internal',
      description: 'Live supply/demand map, dispatch inspector, event log, config.',
      icon: 'grid',
      route: '/admin',
      enabled: true,
      frame: 'console',
    },
  ],
};
