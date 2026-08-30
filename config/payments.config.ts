/**
 * Payment instruments, promotions, wallet and payout rules.
 */

export interface PaymentMethodConfig {
  id: string;
  kind: 'card' | 'cash' | 'wallet' | 'corporate' | 'transfer';
  label: string;
  icon: string;
  /** Requires an authorisation hold before dispatch. */
  preauth: boolean;
  /** Which verticals accept it. */
  appliesTo: ('ride' | 'delivery')[];
  /** Markets where the instrument is available. Empty = all. */
  markets: string[];
  enabled: boolean;
}

export interface PromotionConfig {
  id: string;
  code: string;
  label: string;
  description: string;
  kind: 'percent' | 'flat' | 'free_delivery';
  value: number;
  maxDiscount: number;
  minSubtotal: number;
  appliesTo: ('ride' | 'delivery')[];
  /** Restrict to specific product ids. Empty = all products in the verticals. */
  productIds: string[];
  /** Number of times a single account may redeem it. */
  usesPerUser: number;
  /** Only for accounts created within this many days. */
  newUserWithinDays: number;
  enabled: boolean;
}

export interface PayoutConfig {
  /** Automatic payout cadence. */
  schedule: 'daily' | 'weekly';
  /** Day of week for weekly payouts (0 = Sunday). */
  weeklyDay: number;
  instantPayout: { enabled: boolean; feeFlat: number; feePercent: number; minAmount: number; dailyLimit: number };
  /** Merchant commission taken before payout. */
  merchantCommission: { deliveryOrders: number; pickupOrders: number };
  merchantPayoutDelayDays: number;
}

export const paymentMethods: PaymentMethodConfig[] = [
  { id: 'card', kind: 'card', label: 'Credit or debit card', icon: 'card', preauth: true, appliesTo: ['ride', 'delivery'], markets: [], enabled: true },
  { id: 'cash', kind: 'cash', label: 'Cash', icon: 'cash', preauth: false, appliesTo: ['ride'], markets: ['bog'], enabled: true },
  { id: 'wallet', kind: 'wallet', label: 'URUS Cash', icon: 'wallet', preauth: false, appliesTo: ['ride', 'delivery'], markets: [], enabled: true },
  { id: 'corporate', kind: 'corporate', label: 'Business profile', icon: 'briefcase', preauth: true, appliesTo: ['ride', 'delivery'], markets: [], enabled: true },
  { id: 'pse', kind: 'transfer', label: 'Bank transfer (PSE)', icon: 'bank', preauth: true, appliesTo: ['delivery'], markets: ['bog'], enabled: true },
];

export const promotions: PromotionConfig[] = [
  {
    id: 'promo-welcome',
    code: 'WELCOME50',
    label: '50% off your first two rides',
    description: 'Up to 8 off, new accounts only.',
    kind: 'percent',
    value: 0.5,
    maxDiscount: 8,
    minSubtotal: 0,
    appliesTo: ['ride'],
    productIds: [],
    usesPerUser: 2,
    newUserWithinDays: 30,
    enabled: true,
  },
  {
    id: 'promo-freedel',
    code: 'FREEDEL',
    label: 'Free delivery',
    description: 'On orders over 15.',
    kind: 'free_delivery',
    value: 0,
    maxDiscount: 6,
    minSubtotal: 15,
    appliesTo: ['delivery'],
    productIds: [],
    usesPerUser: 5,
    newUserWithinDays: 0,
    enabled: true,
  },
  {
    id: 'promo-lunch',
    code: 'LUNCH5',
    label: '5 off lunch orders',
    description: 'Minimum basket 20.',
    kind: 'flat',
    value: 5,
    maxDiscount: 5,
    minSubtotal: 20,
    appliesTo: ['delivery'],
    productIds: [],
    usesPerUser: 3,
    newUserWithinDays: 0,
    enabled: true,
  },
  {
    id: 'promo-airport',
    code: 'AIRPORT10',
    label: '10% off airport rides',
    description: 'Comfort and Black only.',
    kind: 'percent',
    value: 0.1,
    maxDiscount: 12,
    minSubtotal: 0,
    appliesTo: ['ride'],
    productIds: ['comfort', 'black'],
    usesPerUser: 4,
    newUserWithinDays: 0,
    enabled: true,
  },
];

export const payoutConfig: PayoutConfig = {
  schedule: 'weekly',
  weeklyDay: 2,
  instantPayout: { enabled: true, feeFlat: 0.85, feePercent: 0, minAmount: 5, dailyLimit: 5 },
  merchantCommission: { deliveryOrders: 0.3, pickupOrders: 0.15 },
  merchantPayoutDelayDays: 2,
};
