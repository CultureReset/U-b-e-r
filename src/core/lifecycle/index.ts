/**
 * Trip and order state machines.
 *
 * Legal transitions live here as data, so every surface (rider, driver,
 * merchant, ops) agrees on what may happen next and who is allowed to do it.
 * The store never mutates a status without asking this module first.
 */
import type { OrderStatus, TripStatus } from '@core/types';

export type Actor = 'rider' | 'driver' | 'merchant' | 'system' | 'support';

export interface Transition<S extends string> {
  from: S;
  to: S;
  /** Who may perform the transition. */
  actors: Actor[];
  label: string;
  /** Terminal states end the job's lifecycle. */
  terminal?: boolean;
}

export const tripTransitions: Transition<TripStatus>[] = [
  { from: 'draft', to: 'requested', actors: ['rider'], label: 'Confirm request' },
  { from: 'draft', to: 'scheduled', actors: ['rider'], label: 'Schedule for later' },
  { from: 'scheduled', to: 'requested', actors: ['system', 'rider'], label: 'Release to dispatch' },
  { from: 'scheduled', to: 'cancelled', actors: ['rider', 'support'], label: 'Cancel', terminal: true },
  { from: 'requested', to: 'searching', actors: ['system'], label: 'Begin matching' },
  { from: 'requested', to: 'cancelled', actors: ['rider', 'support'], label: 'Cancel', terminal: true },
  { from: 'searching', to: 'assigned', actors: ['system', 'driver'], label: 'Driver accepted' },
  { from: 'searching', to: 'no_drivers', actors: ['system'], label: 'No drivers found' },
  { from: 'searching', to: 'cancelled', actors: ['rider', 'support'], label: 'Cancel', terminal: true },
  { from: 'no_drivers', to: 'searching', actors: ['rider', 'system'], label: 'Retry matching' },
  { from: 'no_drivers', to: 'cancelled', actors: ['rider', 'system'], label: 'Cancel', terminal: true },
  { from: 'assigned', to: 'arriving', actors: ['system'], label: 'Driver en route' },
  { from: 'assigned', to: 'cancelled', actors: ['rider', 'driver', 'support'], label: 'Cancel', terminal: true },
  { from: 'arriving', to: 'waiting', actors: ['driver', 'system'], label: 'Arrived at pickup' },
  { from: 'arriving', to: 'cancelled', actors: ['rider', 'driver', 'support'], label: 'Cancel', terminal: true },
  { from: 'waiting', to: 'in_progress', actors: ['driver'], label: 'Start trip' },
  { from: 'waiting', to: 'cancelled', actors: ['rider', 'driver', 'support'], label: 'Cancel', terminal: true },
  { from: 'in_progress', to: 'completed', actors: ['driver', 'system'], label: 'Complete trip', terminal: true },
  { from: 'in_progress', to: 'cancelled', actors: ['support'], label: 'Cancel', terminal: true },
];

export const orderTransitions: Transition<OrderStatus>[] = [
  { from: 'draft', to: 'placed', actors: ['rider'], label: 'Place order' },
  { from: 'draft', to: 'scheduled', actors: ['rider'], label: 'Schedule for later' },
  { from: 'scheduled', to: 'placed', actors: ['system', 'rider'], label: 'Release to merchant' },
  { from: 'scheduled', to: 'cancelled', actors: ['rider', 'support'], label: 'Cancel', terminal: true },
  { from: 'placed', to: 'merchant_review', actors: ['system'], label: 'Sent to merchant' },
  { from: 'placed', to: 'cancelled', actors: ['rider', 'support'], label: 'Cancel', terminal: true },
  { from: 'merchant_review', to: 'preparing', actors: ['merchant', 'system'], label: 'Accept order' },
  { from: 'merchant_review', to: 'cancelled', actors: ['merchant', 'rider', 'support'], label: 'Reject order', terminal: true },
  { from: 'preparing', to: 'ready', actors: ['merchant', 'system'], label: 'Mark ready' },
  { from: 'preparing', to: 'courier_assigned', actors: ['system'], label: 'Courier assigned' },
  { from: 'preparing', to: 'cancelled', actors: ['merchant', 'support'], label: 'Cancel', terminal: true },
  { from: 'courier_assigned', to: 'ready', actors: ['merchant', 'system'], label: 'Mark ready' },
  { from: 'courier_assigned', to: 'courier_at_merchant', actors: ['driver', 'system'], label: 'Courier arrived' },
  { from: 'ready', to: 'courier_assigned', actors: ['system'], label: 'Courier assigned' },
  { from: 'ready', to: 'courier_at_merchant', actors: ['driver', 'system'], label: 'Courier arrived' },
  { from: 'ready', to: 'cancelled', actors: ['support'], label: 'Cancel', terminal: true },
  { from: 'courier_at_merchant', to: 'picked_up', actors: ['driver'], label: 'Confirm pickup' },
  { from: 'courier_at_merchant', to: 'cancelled', actors: ['support'], label: 'Cancel', terminal: true },
  { from: 'picked_up', to: 'delivering', actors: ['system', 'driver'], label: 'On the way' },
  { from: 'delivering', to: 'delivered', actors: ['driver'], label: 'Complete delivery', terminal: true },
  { from: 'delivering', to: 'cancelled', actors: ['support'], label: 'Cancel', terminal: true },
];

const buildIndex = <S extends string>(transitions: Transition<S>[]) => {
  const index = new Map<S, Transition<S>[]>();
  for (const t of transitions) {
    const list = index.get(t.from) ?? [];
    list.push(t);
    index.set(t.from, list);
  }
  return index;
};

const tripIndex = buildIndex(tripTransitions);
const orderIndex = buildIndex(orderTransitions);

export const tripTransitionsFrom = (status: TripStatus) => tripIndex.get(status) ?? [];
export const orderTransitionsFrom = (status: OrderStatus) => orderIndex.get(status) ?? [];

export function canTransitionTrip(from: TripStatus, to: TripStatus, actor: Actor): boolean {
  return tripTransitionsFrom(from).some((t) => t.to === to && t.actors.includes(actor));
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return orderTransitionsFrom(to === from ? from : from).some((t) => t.to === to && t.actors.includes(actor));
}

export const TRIP_TERMINAL: TripStatus[] = ['completed', 'cancelled'];
export const ORDER_TERMINAL: OrderStatus[] = ['delivered', 'cancelled'];

export const isTripActive = (status: TripStatus) => !TRIP_TERMINAL.includes(status) && status !== 'no_drivers';
export const isOrderActive = (status: OrderStatus) => !ORDER_TERMINAL.includes(status);

/* ------------------------ Presentation metadata ------------------------- */

export interface StatusPresentation {
  label: string;
  /** Short line shown to the consumer under the status. */
  consumerCopy: string;
  /** What the earner sees. */
  earnerCopy: string;
  tone: 'neutral' | 'progress' | 'positive' | 'warning' | 'danger';
  /** 0–1 progress along the job, for progress bars. */
  progress: number;
}

export const tripStatusPresentation: Record<TripStatus, StatusPresentation> = {
  draft: { label: 'Draft', consumerCopy: 'Choose where to go', earnerCopy: '—', tone: 'neutral', progress: 0 },
  scheduled: { label: 'Scheduled', consumerCopy: 'Your ride is booked', earnerCopy: 'Scheduled pickup', tone: 'neutral', progress: 0.05 },
  requested: { label: 'Requested', consumerCopy: 'Confirming your request', earnerCopy: 'New request', tone: 'progress', progress: 0.1 },
  searching: { label: 'Finding driver', consumerCopy: 'Connecting you with a nearby driver', earnerCopy: 'Offer pending', tone: 'progress', progress: 0.2 },
  assigned: { label: 'Driver assigned', consumerCopy: 'Your driver is on the way', earnerCopy: 'Head to pickup', tone: 'progress', progress: 0.35 },
  arriving: { label: 'Arriving', consumerCopy: 'Your driver is arriving', earnerCopy: 'Approaching pickup', tone: 'progress', progress: 0.5 },
  waiting: { label: 'Waiting for you', consumerCopy: 'Your driver is waiting at the pickup point', earnerCopy: 'Waiting for rider', tone: 'warning', progress: 0.55 },
  in_progress: { label: 'On trip', consumerCopy: 'On the way to your destination', earnerCopy: 'Trip in progress', tone: 'progress', progress: 0.75 },
  completed: { label: 'Completed', consumerCopy: 'You have arrived', earnerCopy: 'Trip complete', tone: 'positive', progress: 1 },
  cancelled: { label: 'Cancelled', consumerCopy: 'This trip was cancelled', earnerCopy: 'Cancelled', tone: 'danger', progress: 1 },
  no_drivers: { label: 'No drivers', consumerCopy: 'No drivers available right now', earnerCopy: '—', tone: 'danger', progress: 0.2 },
};

export const orderStatusPresentation: Record<OrderStatus, StatusPresentation> = {
  draft: { label: 'Cart', consumerCopy: 'Building your order', earnerCopy: '—', tone: 'neutral', progress: 0 },
  scheduled: { label: 'Scheduled', consumerCopy: 'Your order is scheduled', earnerCopy: 'Scheduled order', tone: 'neutral', progress: 0.05 },
  placed: { label: 'Order placed', consumerCopy: 'Sending your order to the restaurant', earnerCopy: '—', tone: 'progress', progress: 0.1 },
  merchant_review: { label: 'Confirming', consumerCopy: 'The restaurant is confirming your order', earnerCopy: '—', tone: 'progress', progress: 0.2 },
  preparing: { label: 'Preparing', consumerCopy: 'Your order is being prepared', earnerCopy: 'Food is being prepared', tone: 'progress', progress: 0.35 },
  ready: { label: 'Ready for pickup', consumerCopy: 'Waiting for a courier', earnerCopy: 'Order is ready', tone: 'progress', progress: 0.5 },
  courier_assigned: { label: 'Courier assigned', consumerCopy: 'Your courier is heading to the restaurant', earnerCopy: 'Head to merchant', tone: 'progress', progress: 0.55 },
  courier_at_merchant: { label: 'At the restaurant', consumerCopy: 'Your courier is picking up your order', earnerCopy: 'Collect the order', tone: 'progress', progress: 0.65 },
  picked_up: { label: 'Picked up', consumerCopy: 'Your order is on its way', earnerCopy: 'Order collected', tone: 'progress', progress: 0.75 },
  delivering: { label: 'On the way', consumerCopy: 'Your courier is on the way to you', earnerCopy: 'Deliver to customer', tone: 'progress', progress: 0.85 },
  delivered: { label: 'Delivered', consumerCopy: 'Enjoy your order', earnerCopy: 'Delivery complete', tone: 'positive', progress: 1 },
  cancelled: { label: 'Cancelled', consumerCopy: 'This order was cancelled', earnerCopy: 'Cancelled', tone: 'danger', progress: 1 },
};

/** Cancellation reasons offered in each surface — configurable copy, not literals in components. */
export const cancellationReasons: Record<Actor, { id: string; label: string }[]> = {
  rider: [
    { id: 'wait-too-long', label: 'Wait time was too long' },
    { id: 'driver-not-moving', label: 'Driver was not moving' },
    { id: 'wrong-address', label: 'I entered the wrong address' },
    { id: 'plans-changed', label: 'My plans changed' },
    { id: 'found-other', label: 'Found another way to travel' },
  ],
  driver: [
    { id: 'rider-no-show', label: 'Rider did not show up' },
    { id: 'too-far', label: 'Pickup was too far' },
    { id: 'unsafe', label: 'I did not feel safe' },
    { id: 'vehicle-issue', label: 'Vehicle issue' },
    { id: 'wrong-items', label: 'Order was incorrect' },
  ],
  merchant: [
    { id: 'out-of-stock', label: 'Items are out of stock' },
    { id: 'too-busy', label: 'Kitchen is at capacity' },
    { id: 'closing', label: 'We are closing' },
    { id: 'equipment', label: 'Equipment failure' },
  ],
  system: [
    { id: 'no-drivers', label: 'No drivers available' },
    { id: 'payment-failed', label: 'Payment could not be authorised' },
    { id: 'timeout', label: 'Request timed out' },
  ],
  support: [
    { id: 'agent-cancel', label: 'Cancelled by support' },
    { id: 'fraud', label: 'Suspected fraud' },
    { id: 'safety', label: 'Safety incident' },
  ],
};
