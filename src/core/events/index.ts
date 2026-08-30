/**
 * Typed event bus + append-only event log.
 *
 * Every meaningful state change in the world publishes here. Surfaces
 * subscribe rather than poll, and the ops console renders the log directly —
 * which is also what makes the whole thing auditable.
 */
import type { ID, WorldEventRecord } from '@core/types';
import { nextId } from '@core/util';

export type WorldEventType =
  | 'trip.requested'
  | 'trip.searching'
  | 'trip.assigned'
  | 'trip.driver_arrived'
  | 'trip.started'
  | 'trip.completed'
  | 'trip.cancelled'
  | 'trip.no_drivers'
  | 'trip.rated'
  | 'order.placed'
  | 'order.accepted'
  | 'order.preparing'
  | 'order.ready'
  | 'order.courier_assigned'
  | 'order.courier_arrived'
  | 'order.picked_up'
  | 'order.delivered'
  | 'order.cancelled'
  | 'order.rated'
  | 'offer.created'
  | 'offer.accepted'
  | 'offer.declined'
  | 'offer.expired'
  | 'driver.online'
  | 'driver.offline'
  | 'driver.moved'
  | 'driver.paused'
  | 'merchant.opened'
  | 'merchant.closed'
  | 'merchant.paused'
  | 'payment.captured'
  | 'payment.refunded'
  | 'payout.issued'
  | 'message.sent'
  | 'surge.updated'
  | 'policy.violation'
  | 'system.tick'
  | 'system.reset';

export interface WorldEvent<P = Record<string, unknown>> {
  id: ID;
  type: WorldEventType;
  at: number;
  actor: string;
  subject?: string;
  payload: P;
}

type Handler = (event: WorldEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();
  private log: WorldEventRecord[] = [];
  private maxLog: number;

  constructor(maxLog = 600) {
    this.maxLog = maxLog;
  }

  /** Subscribe to one event type, or to '*' for everything. */
  on(type: WorldEventType | '*', handler: Handler): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => set.delete(handler);
  }

  emit<P extends Record<string, unknown>>(
    type: WorldEventType,
    actor: string,
    payload: P,
    subject?: string,
    at: number = Date.now(),
  ): WorldEvent<P> {
    const event: WorldEvent<P> = { id: nextId('evt'), type, at, actor, subject, payload };
    this.log.push({ id: event.id, at, type, actor, subject, payload });
    if (this.log.length > this.maxLog) this.log.splice(0, this.log.length - this.maxLog);

    for (const handler of this.handlers.get(type) ?? []) handler(event as WorldEvent);
    for (const handler of this.handlers.get('*') ?? []) handler(event as WorldEvent);
    return event;
  }

  /** Most recent first. */
  recent(limit = 100, filter?: (record: WorldEventRecord) => boolean): WorldEventRecord[] {
    const source = filter ? this.log.filter(filter) : this.log;
    return source.slice(-limit).reverse();
  }

  clear(): void {
    this.log = [];
  }

  get size(): number {
    return this.log.length;
  }
}

/** Process-wide bus. Surfaces import this rather than threading it through props. */
export const bus = new EventBus();

/** Human-readable label for an event type — used by the ops console log. */
export const eventLabels: Record<WorldEventType, string> = {
  'trip.requested': 'Trip requested',
  'trip.searching': 'Searching for driver',
  'trip.assigned': 'Driver assigned',
  'trip.driver_arrived': 'Driver arrived',
  'trip.started': 'Trip started',
  'trip.completed': 'Trip completed',
  'trip.cancelled': 'Trip cancelled',
  'trip.no_drivers': 'No drivers available',
  'trip.rated': 'Trip rated',
  'order.placed': 'Order placed',
  'order.accepted': 'Order accepted',
  'order.preparing': 'Order preparing',
  'order.ready': 'Order ready',
  'order.courier_assigned': 'Courier assigned',
  'order.courier_arrived': 'Courier at merchant',
  'order.picked_up': 'Order picked up',
  'order.delivered': 'Order delivered',
  'order.cancelled': 'Order cancelled',
  'order.rated': 'Order rated',
  'offer.created': 'Offer sent',
  'offer.accepted': 'Offer accepted',
  'offer.declined': 'Offer declined',
  'offer.expired': 'Offer expired',
  'driver.online': 'Driver online',
  'driver.offline': 'Driver offline',
  'driver.moved': 'Driver moved',
  'driver.paused': 'Driver paused',
  'merchant.opened': 'Merchant opened',
  'merchant.closed': 'Merchant closed',
  'merchant.paused': 'Merchant paused',
  'payment.captured': 'Payment captured',
  'payment.refunded': 'Payment refunded',
  'payout.issued': 'Payout issued',
  'message.sent': 'Message sent',
  'surge.updated': 'Surge updated',
  'policy.violation': 'Policy violation',
  'system.tick': 'Tick',
  'system.reset': 'World reset',
};
