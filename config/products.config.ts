/**
 * Product catalogue: every bookable thing the platform sells.
 * A product binds a vertical (ride | delivery), a service class, capacity
 * rules, the rate-card it prices against and the vehicle classes eligible to
 * fulfil it. Adding a product here makes it appear in the consumer picker,
 * the driver's opt-in list and the ops console with no code changes.
 */

export type Vertical = 'ride' | 'delivery';

export interface ProductConfig {
  id: string;
  vertical: Vertical;
  name: string;
  shortName: string;
  description: string;
  /** Icon key resolved by ui/Icon. */
  icon: string;
  seats: number;
  /** Rate card id in pricing.config. */
  rateCardId: string;
  /** Vehicle class ids from fleet.config that may serve this product. */
  eligibleVehicleClasses: string[];
  /** Markets where the product is sold. Empty = all markets. */
  markets: string[];
  /** Ordering in the consumer picker. */
  sort: number;
  enabled: boolean;
  /** Shown as a badge on the product row. */
  badge?: string;
  options: {
    shared: boolean;
    scheduling: boolean;
    multiStop: boolean;
    petFriendly: boolean;
    wheelchairAccessible: boolean;
    luggageAssist: boolean;
    contactless: boolean;
  };
  /** Extra dispatch constraints. */
  dispatch: {
    /** Driver must have these tags (from fleet.config driverTags). */
    requiredDriverTags: string[];
    /** Preferred match radius in km; falls back to app limit. */
    preferredRadiusKm: number;
    /** Minimum driver rating to receive offers for this product. */
    minDriverRating: number;
  };
}

export const productConfigs: ProductConfig[] = [
  {
    id: 'go',
    vertical: 'ride',
    name: 'URUS Go',
    shortName: 'Go',
    description: 'Affordable everyday rides',
    icon: 'car',
    seats: 4,
    rateCardId: 'rc-go',
    eligibleVehicleClasses: ['compact', 'sedan', 'suv'],
    markets: [],
    sort: 10,
    enabled: true,
    options: {
      shared: false,
      scheduling: true,
      multiStop: true,
      petFriendly: false,
      wheelchairAccessible: false,
      luggageAssist: false,
      contactless: true,
    },
    dispatch: { requiredDriverTags: [], preferredRadiusKm: 5, minDriverRating: 4.4 },
  },
  {
    id: 'share',
    vertical: 'ride',
    name: 'URUS Share',
    shortName: 'Share',
    description: 'Share the route, split the fare',
    icon: 'users',
    seats: 2,
    rateCardId: 'rc-share',
    eligibleVehicleClasses: ['compact', 'sedan'],
    markets: [],
    sort: 5,
    enabled: true,
    badge: 'Cheapest',
    options: {
      shared: true,
      scheduling: false,
      multiStop: false,
      petFriendly: false,
      wheelchairAccessible: false,
      luggageAssist: false,
      contactless: true,
    },
    dispatch: { requiredDriverTags: [], preferredRadiusKm: 6, minDriverRating: 4.5 },
  },
  {
    id: 'comfort',
    vertical: 'ride',
    name: 'URUS Comfort',
    shortName: 'Comfort',
    description: 'Newer cars, extra legroom, top-rated drivers',
    icon: 'car-comfort',
    seats: 4,
    rateCardId: 'rc-comfort',
    eligibleVehicleClasses: ['sedan', 'suv'],
    markets: [],
    sort: 20,
    enabled: true,
    options: {
      shared: false,
      scheduling: true,
      multiStop: true,
      petFriendly: true,
      wheelchairAccessible: false,
      luggageAssist: false,
      contactless: true,
    },
    dispatch: { requiredDriverTags: ['comfort-certified'], preferredRadiusKm: 7, minDriverRating: 4.8 },
  },
  {
    id: 'xl',
    vertical: 'ride',
    name: 'URUS XL',
    shortName: 'XL',
    description: 'Room for up to six',
    icon: 'van',
    seats: 6,
    rateCardId: 'rc-xl',
    eligibleVehicleClasses: ['suv', 'van'],
    markets: [],
    sort: 30,
    enabled: true,
    options: {
      shared: false,
      scheduling: true,
      multiStop: true,
      petFriendly: true,
      wheelchairAccessible: false,
      luggageAssist: true,
      contactless: true,
    },
    dispatch: { requiredDriverTags: [], preferredRadiusKm: 8, minDriverRating: 4.5 },
  },
  {
    id: 'black',
    vertical: 'ride',
    name: 'URUS Black',
    shortName: 'Black',
    description: 'Premium cars, professional drivers',
    icon: 'car-premium',
    seats: 4,
    rateCardId: 'rc-black',
    eligibleVehicleClasses: ['luxury'],
    markets: [],
    sort: 40,
    enabled: true,
    badge: 'Premium',
    options: {
      shared: false,
      scheduling: true,
      multiStop: true,
      petFriendly: false,
      wheelchairAccessible: false,
      luggageAssist: true,
      contactless: true,
    },
    dispatch: { requiredDriverTags: ['black-certified'], preferredRadiusKm: 9, minDriverRating: 4.85 },
  },
  {
    id: 'assist',
    vertical: 'ride',
    name: 'URUS Assist',
    shortName: 'Assist',
    description: 'Extra help getting in and out',
    icon: 'accessible',
    seats: 4,
    rateCardId: 'rc-go',
    eligibleVehicleClasses: ['sedan', 'suv', 'van'],
    markets: [],
    sort: 45,
    enabled: true,
    options: {
      shared: false,
      scheduling: true,
      multiStop: false,
      petFriendly: false,
      wheelchairAccessible: true,
      luggageAssist: true,
      contactless: false,
    },
    dispatch: { requiredDriverTags: ['assist-certified'], preferredRadiusKm: 9, minDriverRating: 4.7 },
  },
  {
    id: 'moto',
    vertical: 'ride',
    name: 'URUS Moto',
    shortName: 'Moto',
    description: 'Beat traffic on two wheels',
    icon: 'moto',
    seats: 1,
    rateCardId: 'rc-moto',
    eligibleVehicleClasses: ['motorcycle'],
    markets: ['bog'],
    sort: 1,
    enabled: true,
    options: {
      shared: false,
      scheduling: false,
      multiStop: false,
      petFriendly: false,
      wheelchairAccessible: false,
      luggageAssist: false,
      contactless: true,
    },
    dispatch: { requiredDriverTags: [], preferredRadiusKm: 4, minDriverRating: 4.4 },
  },
  {
    id: 'eats-standard',
    vertical: 'delivery',
    name: 'Standard delivery',
    shortName: 'Standard',
    description: 'Delivered by the next available courier',
    icon: 'bag',
    seats: 0,
    rateCardId: 'rc-delivery',
    eligibleVehicleClasses: ['compact', 'sedan', 'motorcycle', 'bicycle', 'suv'],
    markets: [],
    sort: 10,
    enabled: true,
    options: {
      shared: false,
      scheduling: true,
      multiStop: false,
      petFriendly: false,
      wheelchairAccessible: false,
      luggageAssist: false,
      contactless: true,
    },
    dispatch: { requiredDriverTags: [], preferredRadiusKm: 6, minDriverRating: 4.3 },
  },
  {
    id: 'eats-priority',
    vertical: 'delivery',
    name: 'Priority delivery',
    shortName: 'Priority',
    description: 'Delivered directly to you, first in the queue',
    icon: 'bolt',
    seats: 0,
    rateCardId: 'rc-delivery-priority',
    eligibleVehicleClasses: ['compact', 'sedan', 'motorcycle'],
    markets: [],
    sort: 20,
    enabled: true,
    badge: 'Fastest',
    options: {
      shared: false,
      scheduling: false,
      multiStop: false,
      petFriendly: false,
      wheelchairAccessible: false,
      luggageAssist: false,
      contactless: true,
    },
    dispatch: { requiredDriverTags: [], preferredRadiusKm: 7, minDriverRating: 4.6 },
  },
  {
    id: 'parcel',
    vertical: 'delivery',
    name: 'URUS Parcel',
    shortName: 'Parcel',
    description: 'Send a package across town',
    icon: 'box',
    seats: 0,
    rateCardId: 'rc-parcel',
    eligibleVehicleClasses: ['compact', 'sedan', 'motorcycle', 'van'],
    markets: [],
    sort: 30,
    enabled: true,
    options: {
      shared: false,
      scheduling: true,
      multiStop: true,
      petFriendly: false,
      wheelchairAccessible: false,
      luggageAssist: false,
      contactless: true,
    },
    dispatch: { requiredDriverTags: [], preferredRadiusKm: 8, minDriverRating: 4.4 },
  },
];
