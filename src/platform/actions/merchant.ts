/**
 * Merchant operations: the order queue, menu management, storefront settings
 * and payouts. Everything a storefront operator does to the world lives here.
 */
import { payoutConfig } from '@config';
import { bus } from '@core/events';
import type { ID, MenuItem, Merchant, Order } from '@core/types';
import { nextId, round2 } from '@core/util';
import type { WorldState } from '@data';
import type { TickCtx } from '@core/sim';

export function acceptOrder(orderId: ID, prepMinutesOverride?: number) {
  return (state: WorldState): void => {
    const order = state.orders[orderId];
    if (!order || order.status !== 'merchant_review') return;
    const merchant = state.merchants[order.merchantId];

    state.orders[orderId] = {
      ...order,
      status: 'preparing',
      merchantAcceptedAt: state.now,
      timeline: [...order.timeline, { status: 'preparing', at: state.now, actor: merchant?.name ?? 'merchant' }],
    };

    if (merchant && prepMinutesOverride) {
      state.merchants[merchant.id] = { ...merchant, currentPrepMinutes: prepMinutesOverride };
    }
    bus.emit('order.accepted', merchant?.name ?? 'merchant', { orderId }, orderId, state.now);
  };
}

export function rejectOrder(orderId: ID, reason: string) {
  return (state: WorldState): void => {
    const order = state.orders[orderId];
    if (!order || !['merchant_review', 'preparing'].includes(order.status)) return;
    const merchant = state.merchants[order.merchantId];

    state.orders[orderId] = {
      ...order,
      status: 'cancelled',
      cancelledAt: state.now,
      cancelledBy: 'merchant',
      cancellationReason: reason,
      timeline: [
        ...order.timeline,
        { status: 'cancelled', at: state.now, actor: merchant?.name ?? 'merchant', note: reason },
      ],
    };

    for (const offer of Object.values(state.offers)) {
      if (offer.jobId === orderId && offer.status === 'pending') {
        state.offers[offer.id] = { ...offer, status: 'cancelled', respondedAt: state.now };
      }
    }
    bus.emit('order.cancelled', merchant?.name ?? 'merchant', { orderId, reason }, orderId, state.now);
  };
}

export function markOrderReady(orderId: ID) {
  return (state: WorldState): void => {
    const order = state.orders[orderId];
    if (!order || !['preparing', 'courier_assigned'].includes(order.status)) return;
    const merchant = state.merchants[order.merchantId];

    state.orders[orderId] = {
      ...order,
      status: order.courierId ? order.status : 'ready',
      readyAt: state.now,
      lines: order.lines.map((l) => (l.fulfilment === 'pending' ? { ...l, fulfilment: 'ready' } : l)),
      timeline: [...order.timeline, { status: 'ready', at: state.now, actor: merchant?.name ?? 'merchant' }],
    };
    bus.emit('order.ready', merchant?.name ?? 'merchant', { orderId }, orderId, state.now);
  };
}

/** Mark one line unavailable and offer a substitution. */
export function substituteLine(orderId: ID, lineId: ID, note: string, unavailable = false) {
  return (state: WorldState): void => {
    const order = state.orders[orderId];
    if (!order) return;
    state.orders[orderId] = {
      ...order,
      lines: order.lines.map((l) =>
        l.id === lineId
          ? { ...l, fulfilment: unavailable ? 'unavailable' : 'substituted', substitutionNote: note }
          : l,
      ),
    };
  };
}

export function setItemAvailability(merchantId: ID, itemId: ID, available: boolean) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    state.merchants[merchantId] = {
      ...merchant,
      menu: merchant.menu.map((section) => ({
        ...section,
        items: section.items.map((item) => (item.id === itemId ? { ...item, available } : item)),
      })),
    };
  };
}

export function setOptionAvailability(merchantId: ID, optionId: ID, available: boolean) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    state.merchants[merchantId] = {
      ...merchant,
      menu: merchant.menu.map((section) => ({
        ...section,
        items: section.items.map((item) => ({
          ...item,
          modifierGroups: item.modifierGroups.map((group) => ({
            ...group,
            options: group.options.map((opt) => (opt.id === optionId ? { ...opt, available } : opt)),
          })),
        })),
      })),
    };
  };
}

export function updateItem(merchantId: ID, itemId: ID, patch: Partial<MenuItem>) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    state.merchants[merchantId] = {
      ...merchant,
      menu: merchant.menu.map((section) => ({
        ...section,
        items: section.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
      })),
    };
  };
}

export function addItem(merchantId: ID, sectionId: ID, item: Omit<MenuItem, 'id'>) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    state.merchants[merchantId] = {
      ...merchant,
      menu: merchant.menu.map((section) =>
        section.id === sectionId ? { ...section, items: [...section.items, { ...item, id: nextId('itm') }] } : section,
      ),
    };
  };
}

export function addSection(merchantId: ID, name: string) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    state.merchants[merchantId] = {
      ...merchant,
      menu: [...merchant.menu, { id: nextId('sec'), name, items: [] }],
    };
  };
}

export function updateMerchantSettings(merchantId: ID, patch: Partial<Merchant['settings']>) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    state.merchants[merchantId] = { ...merchant, settings: { ...merchant.settings, ...patch } };
  };
}

export function updateMerchantHours(merchantId: ID, open: number, close: number) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    state.merchants[merchantId] = { ...merchant, hours: { ...merchant.hours, open, close } };
  };
}

export function setBusy(merchantId: ID, busy: boolean) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    state.merchants[merchantId] = {
      ...merchant,
      busy,
      currentPrepMinutes: busy ? merchant.currentPrepMinutes + 6 : merchant.basePrepMinutes,
    };
  };
}

export function pauseStore(merchantId: ID, minutes: number) {
  return (state: WorldState): void => {
    const merchant = state.merchants[merchantId];
    if (!merchant) return;
    const paused = minutes > 0;
    state.merchants[merchantId] = {
      ...merchant,
      isOpen: paused ? false : merchant.isOpen,
      settings: {
        ...merchant.settings,
        paused,
        pausedUntil: paused ? state.now + minutes * 60_000 : undefined,
      },
    };
    bus.emit('merchant.paused', merchant.name, { merchantId, minutes }, merchantId, state.now);
  };
}

/** Merchant-side financials for the payouts screen. */
export function merchantLedger(state: WorldState, merchantId: ID) {
  return state.ledger.filter((entry) => entry.accountId === merchantId);
}

export function merchantPayoutSummary(state: WorldState, merchantId: ID) {
  const entries = merchantLedger(state, merchantId);
  const gross = round2(entries.filter((e) => e.amount > 0).reduce((acc, e) => acc + e.amount, 0));
  const commission = round2(Math.abs(entries.filter((e) => e.kind === 'commission').reduce((acc, e) => acc + e.amount, 0)));
  const net = round2(gross - commission);
  return {
    gross,
    commission,
    net,
    commissionRate: payoutConfig.merchantCommission.deliveryOrders,
    nextPayoutInDays: payoutConfig.merchantPayoutDelayDays,
    schedule: payoutConfig.schedule,
  };
}

/**
 * Today's trading figures, derived from the orders themselves so the number a
 * merchant sees always reconciles with the list underneath it.
 */
export function merchantToday(state: WorldState, merchantId: ID) {
  const dayStart = new Date(state.now);
  dayStart.setHours(0, 0, 0, 0);
  const orders = Object.values(state.orders).filter(
    (o) => o.merchantId === merchantId && o.placedAt >= dayStart.getTime(),
  );
  const delivered = orders.filter((o) => o.status === 'delivered');
  return {
    orders: orders.length,
    delivered: delivered.length,
    revenue: round2(delivered.reduce((acc, o) => acc + o.lines.reduce((s, l) => s + l.lineTotal, 0), 0)),
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
  };
}

/** Live queue for the merchant dashboard, bucketed by what needs attention. */
export function merchantQueue(state: WorldState, merchantId: ID): Record<string, Order[]> {
  const orders = Object.values(state.orders).filter((o) => o.merchantId === merchantId);
  return {
    incoming: orders.filter((o) => o.status === 'merchant_review'),
    preparing: orders.filter((o) => o.status === 'preparing'),
    ready: orders.filter((o) => ['ready', 'courier_assigned', 'courier_at_merchant'].includes(o.status)),
    inTransit: orders.filter((o) => ['picked_up', 'delivering'].includes(o.status)),
    completed: orders
      .filter((o) => ['delivered', 'cancelled'].includes(o.status))
      .sort((a, b) => (b.deliveredAt ?? b.cancelledAt ?? 0) - (a.deliveredAt ?? a.cancelledAt ?? 0))
      .slice(0, 40),
  };
}

export function merchantChat(orderId: ID, merchantName: string, body: string) {
  return (state: WorldState, _ctx: TickCtx): void => {
    const order = state.orders[orderId];
    if (!order) return;
    state.orders[orderId] = {
      ...order,
      messages: [
        ...order.messages,
        { id: nextId('msg'), jobId: orderId, from: 'merchant', fromName: merchantName, body, at: state.now, read: false },
      ],
    };
    void _ctx;
  };
}
