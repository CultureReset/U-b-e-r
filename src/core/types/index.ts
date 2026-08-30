/**
 * Domain entities. These are storage-shaped and framework-free: the same
 * types serve the in-memory adapter, the REST adapter and every surface.
 */

import type { LatLng } from '@config';

export type ID = string;
export type Timestamp = number; // epoch ms, simulated clock

export interface Place {
  id: ID;
  label: string;
  addressLine: string;
  /** Neighbourhood / zone id when the point falls inside a configured zone. */
  zoneId?: string;
  at: LatLng;
  /** Extra note the rider leaves for the driver ("gate code 4412"). */
  note?: string;
  category?: string;
}

export interface SavedPlace extends Place {
  icon: string;
  kind: 'home' | 'work' | 'custom';
}

/* ------------------------------- People -------------------------------- */

export interface Account {
  id: ID;
  firstName: string;
  lastName: string;
  displayName: string;
  initials: string;
  phone: string;
  email: string;
  avatarHue: number;
  createdAt: Timestamp;
  marketId: ID;
}

export interface RiderProfile extends Account {
  rating: number;
  ratingCount: number;
  savedPlaces: SavedPlace[];
  paymentMethodIds: ID[];
  defaultPaymentMethodId: ID;
  walletBalance: number;
  /** Business profile membership, when the rider belongs to an org. */
  orgMembership?: { orgId: ID; role: string; department: string; employeeId: string };
  promoRedemptions: Record<ID, number>;
  lifetimeTrips: number;
  lifetimeOrders: number;
}

export type DriverStatus = 'offline' | 'online' | 'assigned' | 'on_trip' | 'paused';

export interface DriverDocument {
  requirementId: ID;
  status: 'valid' | 'expiring' | 'expired' | 'missing';
  expiresAt?: Timestamp;
}

export interface Vehicle {
  id: ID;
  classId: ID;
  make: string;
  model: string;
  color: string;
  plate: string;
  year: number;
  seats: number;
}

export interface DriverProfile extends Account {
  status: DriverStatus;
  rating: number;
  ratingCount: number;
  acceptanceRate: number;
  cancellationRate: number;
  completionRate: number;
  tierPoints: number;
  tierId: ID;
  tags: ID[];
  vehicle: Vehicle;
  /** Products the earner has opted into receiving offers for. */
  optedProductIds: ID[];
  documents: DriverDocument[];
  /** Current position, heading (degrees) and speed (kph). */
  at: LatLng;
  heading: number;
  speedKph: number;
  /** Route the sim is currently walking the driver along. */
  activeRoute?: Route;
  routeProgressM: number;
  /** Job currently assigned, if any. */
  activeJobId?: ID;
  /** Ordered queue of stops the earner must service (supports batching). */
  stopQueue: JobStop[];
  onlineSince?: Timestamp;
  /** Rolling session stats, reset when the earner goes offline. */
  session: { earnings: number; jobs: number; onlineSec: number; distanceKm: number; tips: number; promotions: number };
  lifetime: { earnings: number; jobs: number; distanceKm: number };
  streakCount: number;
  questProgress: Record<ID, number>;
  homeZoneId?: ID;
}

/* ------------------------------ Merchants ------------------------------ */

export interface ModifierOption {
  id: ID;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  available: boolean;
}

export interface ModifierGroup {
  id: ID;
  name: string;
  select: 'single' | 'multi';
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: ID;
  name: string;
  description: string;
  price: number;
  tags: string[];
  modifierGroups: ModifierGroup[];
  available: boolean;
  popular: boolean;
  prepMinutes: number;
  glyph: string;
  /** Units of vehicle cargo capacity this item consumes. */
  cargoUnits: number;
}

export interface MenuSection {
  id: ID;
  name: string;
  items: MenuItem[];
}

export interface MerchantHours {
  templateId: ID;
  open: number;
  close: number;
}

export interface Merchant {
  id: ID;
  archetypeId: ID;
  marketId: ID;
  name: string;
  cuisine: string;
  category: string;
  glyph: string;
  accent: string;
  priceTier: 1 | 2 | 3 | 4;
  rating: number;
  ratingCount: number;
  at: LatLng;
  addressLine: string;
  zoneId?: ID;
  hours: MerchantHours;
  isOpen: boolean;
  /** Live prep-time estimate, grows with queue depth. */
  basePrepMinutes: number;
  currentPrepMinutes: number;
  menu: MenuSection[];
  settings: {
    acceptsScheduledOrders: boolean;
    autoAcceptOrders: boolean;
    minimumOrder: number;
    deliveryRadiusKm: number;
    packagingFee: number;
    paused: boolean;
    pausedUntil?: Timestamp;
  };
  stats: { ordersToday: number; revenueToday: number; acceptRate: number; avgPrepMinutes: number };
  /** Deliberate over-capacity flag the merchant dashboard can toggle. */
  busy: boolean;
}

/* -------------------------------- Orgs --------------------------------- */

export interface Org {
  id: ID;
  archetypeId: ID;
  marketId: ID;
  name: string;
  industry: string;
  glyph: string;
  monthlyBudget: number;
  policyRuleIds: ID[];
  allowedProductIds: ID[];
  members: OrgMember[];
  billing: { spendThisMonth: number; invoiceDay: number; paymentMethodId: ID };
}

export interface OrgMember {
  id: ID;
  riderId: ID;
  name: string;
  email: string;
  role: string;
  department: string;
  employeeId: string;
  monthlySpend: number;
  active: boolean;
}

/* --------------------------- Pricing artefacts -------------------------- */

export interface QuoteLine {
  id: string;
  label: string;
  amount: number;
  kind: 'base' | 'distance' | 'time' | 'wait' | 'surge' | 'fee' | 'tax' | 'discount' | 'tip' | 'goods' | 'surcharge' | 'adjustment';
  /** Rendered but not counted toward the total (informational rows). */
  informational?: boolean;
  hint?: string;
}

export interface Quote {
  id: ID;
  productId: ID;
  marketId: ID;
  vertical: 'ride' | 'delivery';
  currency: string;
  distanceKm: number;
  durationMin: number;
  surgeMultiplier: number;
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** What the earner is projected to receive. */
  earnerPayout: number;
  platformRevenue: number;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  /** Promo actually applied, if any. */
  promotionId?: ID;
}

/* ---------------------------- Jobs (unified) ---------------------------- */

export type TripStatus =
  | 'draft'
  | 'requested'
  | 'searching'
  | 'assigned'
  | 'arriving'
  | 'waiting'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_drivers'
  | 'scheduled';

export type OrderStatus =
  | 'draft'
  | 'placed'
  | 'merchant_review'
  | 'preparing'
  | 'ready'
  | 'courier_assigned'
  | 'courier_at_merchant'
  | 'picked_up'
  | 'delivering'
  | 'delivered'
  | 'cancelled'
  | 'scheduled';

export type JobStopKind = 'pickup' | 'dropoff' | 'merchant' | 'waypoint';

export interface JobStop {
  id: ID;
  jobId: ID;
  kind: JobStopKind;
  place: Place;
  sequence: number;
  arrivedAt?: Timestamp;
  completedAt?: Timestamp;
  etaAt?: Timestamp;
  /** Verification the earner must complete at this stop. */
  verification?: { kind: 'pin' | 'photo' | 'signature' | 'none'; value?: string; satisfied: boolean };
  instructions?: string;
}

export interface Route {
  /** Ordered polyline of positions along the road graph. */
  points: LatLng[];
  /** Cumulative distance at each point, metres. */
  cumulativeM: number[];
  distanceM: number;
  durationSec: number;
  /** Node ids used, for debugging in the ops console. */
  nodeIds: ID[];
}

export interface StatusEvent {
  status: string;
  at: Timestamp;
  note?: string;
  actor?: string;
}

export interface RatingRecord {
  stars: number;
  tags: string[];
  comment?: string;
  tip?: number;
  at: Timestamp;
}

export interface Trip {
  id: ID;
  code: string;
  kind: 'trip';
  marketId: ID;
  productId: ID;
  riderId: ID;
  driverId?: ID;
  status: TripStatus;
  stops: JobStop[];
  quote: Quote;
  /** Final settled fare — differs from the quote when the route changed. */
  settlement?: Quote;
  route?: Route;
  /** Route from driver's position to the first stop. */
  approachRoute?: Route;
  requestedAt: Timestamp;
  scheduledFor?: Timestamp;
  assignedAt?: Timestamp;
  arrivedAt?: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  cancelledAt?: Timestamp;
  cancelledBy?: 'rider' | 'driver' | 'system';
  cancellationReason?: string;
  paymentMethodId: ID;
  orgContext?: { orgId: ID; expenseCodeId: ID; memo?: string; approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected'; violations: ID[] };
  timeline: StatusEvent[];
  riderRating?: RatingRecord;
  driverRating?: RatingRecord;
  /** Share-my-trip token; when set, the trip is publicly followable. */
  shareToken?: string;
  messages: ChatMessage[];
  safety: { emergencyContacted: boolean; checksRun: number };
}

export interface OrderLine {
  id: ID;
  itemId: ID;
  name: string;
  unitPrice: number;
  quantity: number;
  /** Selected modifier option ids, grouped. */
  selections: { groupId: ID; groupName: string; optionIds: ID[]; optionNames: string[]; priceDelta: number }[];
  note?: string;
  lineTotal: number;
  /** Merchant-side fulfilment state for partial substitutions. */
  fulfilment: 'pending' | 'ready' | 'substituted' | 'unavailable';
  substitutionNote?: string;
}

export interface Order {
  id: ID;
  code: string;
  kind: 'order';
  marketId: ID;
  productId: ID;
  customerId: ID;
  merchantId: ID;
  courierId?: ID;
  status: OrderStatus;
  lines: OrderLine[];
  stops: JobStop[];
  quote: Quote;
  settlement?: Quote;
  route?: Route;
  approachRoute?: Route;
  placedAt: Timestamp;
  scheduledFor?: Timestamp;
  merchantAcceptedAt?: Timestamp;
  readyAt?: Timestamp;
  courierAssignedAt?: Timestamp;
  pickedUpAt?: Timestamp;
  deliveredAt?: Timestamp;
  cancelledAt?: Timestamp;
  cancelledBy?: 'customer' | 'merchant' | 'courier' | 'system';
  cancellationReason?: string;
  paymentMethodId: ID;
  dropoffPreference: 'hand_it_to_me' | 'leave_at_door' | 'meet_outside';
  utensils: boolean;
  courierNote?: string;
  orgContext?: Trip['orgContext'];
  timeline: StatusEvent[];
  customerRating?: RatingRecord;
  merchantRating?: RatingRecord;
  shareToken?: string;
  messages: ChatMessage[];
  /** Set when this order is part of a batched delivery run. */
  batchId?: ID;
}

export type Job = Trip | Order;

export interface ChatMessage {
  id: ID;
  jobId: ID;
  from: 'rider' | 'driver' | 'merchant' | 'support' | 'system';
  fromName: string;
  body: string;
  at: Timestamp;
  read: boolean;
  /** Canned message key when the sender used a quick reply. */
  cannedId?: string;
}

/* ------------------------------- Dispatch ------------------------------- */

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'superseded';

export interface DispatchOffer {
  id: ID;
  jobId: ID;
  jobKind: 'trip' | 'order';
  driverId: ID;
  status: OfferStatus;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  respondedAt?: Timestamp;
  /** What the earner is shown before accepting. */
  preview: {
    productName: string;
    payout: number;
    tripDistanceKm: number;
    approachDistanceKm: number;
    approachMinutes: number;
    totalMinutes: number;
    pickupLabel: string;
    dropoffLabel: string;
    riderRating: number;
    surgeMultiplier: number;
    includesTipEstimate: boolean;
    merchantName?: string;
    itemCount?: number;
  };
  /** Ranking diagnostics surfaced in the ops console. */
  score: { total: number; proximity: number; rating: number; idleTime: number; acceptance: number; fairness: number };
}

/* -------------------------------- Ledger -------------------------------- */

export interface LedgerEntry {
  id: ID;
  at: Timestamp;
  jobId?: ID;
  jobCode?: string;
  accountId: ID;
  accountKind: 'rider' | 'driver' | 'merchant' | 'org' | 'platform';
  kind: 'fare' | 'payout' | 'tip' | 'promotion' | 'fee' | 'refund' | 'adjustment' | 'commission' | 'payout_transfer' | 'tax';
  label: string;
  amount: number;
  balanceAfter?: number;
}

/* ------------------------------- Analytics ------------------------------ */

export interface ZoneSnapshot {
  zoneId: ID;
  openRequests: number;
  availableDrivers: number;
  ratio: number;
  surgeMultiplier: number;
  updatedAt: Timestamp;
}

export interface WorldEventRecord {
  id: ID;
  at: Timestamp;
  type: string;
  actor: string;
  subject?: string;
  payload: Record<string, unknown>;
}
