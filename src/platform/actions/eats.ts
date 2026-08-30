/**
 * Consumer delivery actions: cart maths and order placement.
 *
 * The cart is deliberately a plain value type rather than store state — it is
 * owned by the Eats surface, priced by the same engine as everything else, and
 * only becomes world state at checkout.
 */
import { appConfig, getMarket, getProduct } from '@config';
import { bus } from '@core/events';
import { buildQuote } from '@core/pricing';
import { findRoute, graphFor } from '@core/routing';
import type { ID, MenuItem, Merchant, Order, OrderLine, Place, Quote, RatingRecord } from '@core/types';
import { nextId, referenceCode, round2 } from '@core/util';
import type { WorldState } from '@data';
import { surgeAt } from '@data/seed/zones';
import type { TickCtx } from '@core/sim';

export interface CartSelection {
  groupId: ID;
  groupName: string;
  optionIds: ID[];
  optionNames: string[];
  priceDelta: number;
}

export interface CartLine {
  id: ID;
  itemId: ID;
  name: string;
  basePrice: number;
  unitPrice: number;
  quantity: number;
  selections: CartSelection[];
  note?: string;
  glyph: string;
}

export interface Cart {
  merchantId: ID | undefined;
  lines: CartLine[];
  promotionCode?: string;
  productId: ID;
  dropoffPreference: Order['dropoffPreference'];
  utensils: boolean;
  courierNote?: string;
  scheduledFor?: number;
}

export const emptyCart = (productId = 'eats-standard'): Cart => ({
  merchantId: undefined,
  lines: [],
  productId,
  dropoffPreference: 'hand_it_to_me',
  utensils: false,
});

/** Resolve selections into a unit price. Modifier deltas are absolute amounts. */
export function priceLine(item: MenuItem, selections: CartSelection[]): number {
  return round2(item.price + selections.reduce((acc, s) => acc + s.priceDelta, 0));
}

export function addToCart(cart: Cart, merchantId: ID, item: MenuItem, selections: CartSelection[], quantity: number, note?: string): Cart {
  // Switching merchants replaces the cart — the same rule the real product has.
  const base = cart.merchantId && cart.merchantId !== merchantId ? emptyCart(cart.productId) : cart;
  const unitPrice = priceLine(item, selections);
  const signature = `${item.id}|${selections.map((s) => s.optionIds.join(',')).join('|')}|${note ?? ''}`;

  const existing = base.lines.find(
    (l) => `${l.itemId}|${l.selections.map((s) => s.optionIds.join(',')).join('|')}|${l.note ?? ''}` === signature,
  );

  const lines = existing
    ? base.lines.map((l) =>
        l.id === existing.id
          ? { ...l, quantity: Math.min(appConfig.limits.maxCartQuantity, l.quantity + quantity) }
          : l,
      )
    : [
        ...base.lines,
        {
          id: nextId('crt'),
          itemId: item.id,
          name: item.name,
          basePrice: item.price,
          unitPrice,
          quantity: Math.min(appConfig.limits.maxCartQuantity, quantity),
          selections,
          note,
          glyph: item.glyph,
        },
      ];

  return { ...base, merchantId, lines };
}

export function setLineQuantity(cart: Cart, lineId: ID, quantity: number): Cart {
  const lines =
    quantity <= 0
      ? cart.lines.filter((l) => l.id !== lineId)
      : cart.lines.map((l) =>
          l.id === lineId ? { ...l, quantity: Math.min(appConfig.limits.maxCartQuantity, quantity) } : l,
        );
  return { ...cart, lines, merchantId: lines.length === 0 ? undefined : cart.merchantId };
}

export const cartGoodsSubtotal = (cart: Cart): number =>
  round2(cart.lines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0));

export const cartItemCount = (cart: Cart): number => cart.lines.reduce((acc, l) => acc + l.quantity, 0);

/** Price the cart for delivery to a given address. */
export function quoteCart(
  state: WorldState,
  cart: Cart,
  merchant: Merchant,
  dropoff: Place,
  customerId?: ID,
): { quote: Quote; distanceKm: number; etaMin: number } {
  const market = getMarket(state.marketId);
  const graph = graphFor(state.marketId);
  const hourOfDay = new Date(state.now).getHours();
  const route = findRoute(graph, market, merchant.at, dropoff.at, { hourOfDay, speedFactor: 1, congestionFactor: 1 });
  const customer = customerId ? state.riders[customerId] : undefined;

  const quote = buildQuote({
    productId: cart.productId,
    marketId: state.marketId,
    distanceKm: route.distanceM / 1000,
    durationMin: route.durationSec / 60,
    goodsSubtotal: cartGoodsSubtotal(cart),
    packagingFee: merchant.settings.packagingFee,
    surgeMultiplier: surgeAt(state, market, merchant.at),
    promotionCode: cart.promotionCode,
    promoRedemptions: customer?.promoRedemptions,
    accountAgeDays: customer ? (state.now - customer.createdAt) / 86_400_000 : undefined,
    now: state.now,
  });

  // The customer's promised window is prep time plus the drive.
  const etaMin = Math.round(merchant.currentPrepMinutes + route.durationSec / 60 + 4);
  return { quote, distanceKm: round2(route.distanceM / 1000), etaMin };
}

export function placeOrder(cart: Cart, customerId: ID, dropoff: Place, paymentMethodId: ID) {
  return (state: WorldState, ctx: TickCtx): ID | undefined => {
    const customer = state.riders[customerId];
    const merchant = cart.merchantId ? state.merchants[cart.merchantId] : undefined;
    const product = getProduct(cart.productId);
    if (!customer || !merchant || !product || cart.lines.length === 0) return undefined;

    const { quote } = quoteCart(state, cart, merchant, dropoff, customerId);
    const id = nextId('ord');
    const scheduled = cart.scheduledFor && cart.scheduledFor > state.now + 60_000;

    const lines: OrderLine[] = cart.lines.map((line) => ({
      id: nextId('oln'),
      itemId: line.itemId,
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      selections: line.selections,
      note: line.note,
      lineTotal: round2(line.unitPrice * line.quantity),
      fulfilment: 'pending',
    }));

    const order: Order = {
      id,
      code: referenceCode('ORD', state.now + Object.keys(state.orders).length),
      kind: 'order',
      marketId: state.marketId,
      productId: cart.productId,
      customerId,
      merchantId: merchant.id,
      status: scheduled ? 'scheduled' : 'placed',
      lines,
      stops: [
        {
          id: nextId('stp'),
          jobId: id,
          kind: 'merchant',
          place: {
            id: nextId('plc'),
            label: merchant.name,
            addressLine: merchant.addressLine,
            at: merchant.at,
            zoneId: merchant.zoneId,
            category: 'merchant',
          },
          sequence: 0,
          verification: { kind: 'photo', satisfied: false },
        },
        {
          id: nextId('stp'),
          jobId: id,
          kind: 'dropoff',
          place: dropoff,
          sequence: 1,
          instructions: cart.courierNote,
          verification:
            cart.dropoffPreference === 'leave_at_door'
              ? { kind: 'photo', satisfied: false }
              : { kind: 'none', satisfied: true },
        },
      ],
      quote,
      placedAt: state.now,
      scheduledFor: scheduled ? cart.scheduledFor : undefined,
      paymentMethodId,
      dropoffPreference: cart.dropoffPreference,
      utensils: cart.utensils,
      courierNote: cart.courierNote,
      timeline: [{ status: scheduled ? 'scheduled' : 'placed', at: state.now, actor: customer.displayName }],
      messages: [],
    };

    state.orders[id] = order;

    if (quote.promotionId) {
      state.riders[customerId] = {
        ...customer,
        promoRedemptions: {
          ...customer.promoRedemptions,
          [quote.promotionId]: (customer.promoRedemptions[quote.promotionId] ?? 0) + 1,
        },
      };
    }

    void ctx;
    bus.emit('order.placed', customer.displayName, { orderId: id, merchantId: merchant.id, total: quote.total }, id, state.now);
    return id;
  };
}

export function cancelOrder(orderId: ID, actor: Order['cancelledBy'], reason: string) {
  return (state: WorldState): void => {
    const order = state.orders[orderId];
    if (!order || ['delivered', 'cancelled'].includes(order.status)) return;

    state.orders[orderId] = {
      ...order,
      status: 'cancelled',
      cancelledAt: state.now,
      cancelledBy: actor,
      cancellationReason: reason,
      timeline: [...order.timeline, { status: 'cancelled', at: state.now, actor: actor ?? 'system', note: reason }],
    };

    for (const offer of Object.values(state.offers)) {
      if (offer.jobId === orderId && offer.status === 'pending') {
        state.offers[offer.id] = { ...offer, status: 'cancelled', respondedAt: state.now };
      }
    }

    if (order.courierId) {
      const courier = state.drivers[order.courierId];
      if (courier) {
        state.drivers[order.courierId] = {
          ...courier,
          status: courier.status === 'offline' ? 'offline' : 'online',
          activeJobId: undefined,
          activeRoute: undefined,
          routeProgressM: 0,
          stopQueue: [],
          speedKph: 0,
        };
      }
    }

    bus.emit('order.cancelled', actor ?? 'system', { orderId, reason }, orderId, state.now);
  };
}

export function rateOrder(orderId: ID, record: RatingRecord) {
  return (state: WorldState, ctx: TickCtx): void => {
    const order = state.orders[orderId];
    if (!order) return;
    state.orders[orderId] = { ...order, customerRating: record };

    const merchant = state.merchants[order.merchantId];
    if (merchant) {
      const total = merchant.rating * merchant.ratingCount + record.stars;
      state.merchants[merchant.id] = {
        ...merchant,
        ratingCount: merchant.ratingCount + 1,
        rating: round2(total / (merchant.ratingCount + 1)),
      };
    }

    if (order.courierId && record.tip && record.tip > 0) {
      const courier = state.drivers[order.courierId];
      if (courier) {
        state.drivers[courier.id] = {
          ...courier,
          session: {
            ...courier.session,
            earnings: round2(courier.session.earnings + record.tip),
            tips: round2(courier.session.tips + record.tip),
          },
        };
        ctx.ledger.push({
          id: nextId('led'),
          at: state.now,
          jobId: orderId,
          jobCode: order.code,
          accountId: courier.id,
          accountKind: 'driver',
          kind: 'tip',
          label: 'Customer tip',
          amount: record.tip,
        });
      }
    }

    bus.emit('order.rated', 'customer', { orderId, stars: record.stars }, orderId, state.now);
  };
}
