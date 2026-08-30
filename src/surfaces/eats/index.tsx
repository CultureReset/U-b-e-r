/**
 * Eats surface — the consumer delivery product.
 *
 * Browse → storefront → item customisation → cart → checkout → live tracking.
 * The merchants here are the same records the merchant dashboard operates, so
 * pausing a store or 86'ing an item in that console changes what this screen
 * can sell, immediately.
 */
import { useMemo, useState } from 'react';
import { appConfig, catalogConfig, getPaymentMethodsForMarket, getProductsForMarket, promotions } from '@config';
import { haversineKm } from '@core/geo';
import type { ID, MenuItem, Merchant, Order, Place } from '@core/types';
import { distance, money, plural, priceTierLabel } from '@platform/format';
import { useAction, useCurrentRider } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as eatsActions from '@platform/actions/eats';
import { useSurfaceAccent } from '@platform/theme';
import { DeviceFrame, ScreenHeader } from '@app/DeviceFrame';
import { Map, type MapMarker, type MapRoute } from '@ui/Map';
import { Icon } from '@ui/Icon';
import { Button, Card, Chip, Empty, ListRow, Modal, Sheet, Switch } from '@ui/primitives';
import { JobSummaryRow, PersonRow } from '@ui/components';
import { ItemSheet } from './ItemSheet';
import { OrderTracker } from './OrderTracker';

type Tab = 'browse' | 'orders' | 'account';
type View = { kind: 'browse' } | { kind: 'merchant'; merchantId: ID } | { kind: 'checkout' } | { kind: 'tracking'; orderId: ID };

export function EatsSurface() {
  useSurfaceAccent('eats');
  const state = useWorld((s) => s.state);
  const customer = useCurrentRider();
  const act = useAction();

  const [tab, setTab] = useState<Tab>('browse');
  const [view, setView] = useState<View>({ kind: 'browse' });
  const [cart, setCart] = useState(() => eatsActions.emptyCart());
  const [openItem, setOpenItem] = useState<MenuItem | undefined>();
  const [showCart, setShowCart] = useState(false);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');

  const merchants = useMemo(
    () => Object.values(state.merchants).filter((m) => m.marketId === state.marketId),
    [state.merchants, state.marketId],
  );

  const activeOrder = view.kind === 'tracking' ? state.orders[view.orderId] : undefined;
  const cartMerchant = cart.merchantId ? state.merchants[cart.merchantId] : undefined;
  const dropoff: Place | undefined = customer?.savedPlaces[0];

  const tabs = [
    { id: 'browse', label: 'Browse', icon: 'bag' },
    { id: 'orders', label: 'Orders', icon: 'receipt', badge: Object.values(state.orders).filter((o) => o.customerId === customer?.id && !['delivered', 'cancelled'].includes(o.status)).length },
    { id: 'account', label: 'Account', icon: 'settings' },
  ];

  const placeOrder = () => {
    if (!customer || !dropoff) return;
    let created: ID | undefined;
    act((draft, ctx) => {
      created = eatsActions.placeOrder(cart, customer.id, dropoff, customer.defaultPaymentMethodId)(draft, ctx);
    }, 'place order');
    if (created) {
      setCart(eatsActions.emptyCart());
      setShowCart(false);
      setView({ kind: 'tracking', orderId: created });
      setTab('browse');
    }
  };

  return (
    <DeviceFrame tabs={tabs} activeTab={tab} onTabChange={(id) => setTab(id as Tab)} aside={<EatsAside cart={cart} />}>
      {tab === 'browse' && view.kind === 'browse' && (
        <BrowseScreen
          merchants={merchants}
          category={category}
          onCategory={setCategory}
          query={query}
          onQuery={setQuery}
          origin={dropoff?.at}
          onOpen={(id) => setView({ kind: 'merchant', merchantId: id })}
        />
      )}

      {tab === 'browse' && view.kind === 'merchant' && (
        <MerchantScreen
          merchant={state.merchants[view.merchantId]}
          onBack={() => setView({ kind: 'browse' })}
          onPick={setOpenItem}
        />
      )}

      {tab === 'browse' && view.kind === 'tracking' && activeOrder && (
        <div className="col" style={{ height: '100%', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <OrderMap order={activeOrder} />
          </div>
          <div style={{ marginTop: 'auto', zIndex: 5, maxHeight: '76%' }}>
            <Sheet>
              <OrderTracker order={activeOrder} onDone={() => setView({ kind: 'browse' })} />
            </Sheet>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <OrdersScreen onOpen={(id) => { setView({ kind: 'tracking', orderId: id }); setTab('browse'); }} />
      )}

      {tab === 'account' && <EatsAccount />}

      {/* Cart bar */}
      {tab === 'browse' && view.kind !== 'tracking' && cart.lines.length > 0 && (
        <div style={{ position: 'absolute', left: 'var(--s-3)', right: 'var(--s-3)', bottom: 'var(--s-3)', zIndex: 20 }}>
          <Button variant="primary" size="lg" block onClick={() => setShowCart(true)}>
            <span className="row spread grow">
              <span className="row gap-2">
                <Icon name="bag" size={17} />
                {plural(eatsActions.cartItemCount(cart), 'item')}
              </span>
              <span className="t-num">{money(eatsActions.cartGoodsSubtotal(cart))}</span>
            </span>
          </Button>
        </div>
      )}

      {openItem && cartMerchantIdFor(view, cart.merchantId) && (
        <Modal title={openItem.name} onClose={() => setOpenItem(undefined)} width={440}>
          <ItemSheet
            item={openItem}
            onClose={() => setOpenItem(undefined)}
            onAdd={(selections, quantity, note) => {
              const merchantId = view.kind === 'merchant' ? view.merchantId : cart.merchantId!;
              setCart((current) => eatsActions.addToCart(current, merchantId, openItem, selections, quantity, note));
            }}
          />
        </Modal>
      )}

      {showCart && (
        <Modal
          title={cartMerchant ? `Your order · ${cartMerchant.name}` : 'Your order'}
          onClose={() => setShowCart(false)}
          width={460}
        >
          <CartView
            cart={cart}
            merchant={cartMerchant}
            dropoff={dropoff}
            onChange={setCart}
            onCheckout={placeOrder}
          />
        </Modal>
      )}
    </DeviceFrame>
  );
}

const cartMerchantIdFor = (view: View, cartMerchantId?: ID) =>
  view.kind === 'merchant' ? view.merchantId : cartMerchantId;

/* -------------------------------- Browse -------------------------------- */

function BrowseScreen({
  merchants,
  category,
  onCategory,
  query,
  onQuery,
  origin,
  onOpen,
}: {
  merchants: Merchant[];
  category: string;
  onCategory: (id: string) => void;
  query: string;
  onQuery: (value: string) => void;
  origin?: { lat: number; lng: number };
  onOpen: (id: ID) => void;
}) {
  const state = useWorld((s) => s.state);
  const trimmed = query.trim().toLowerCase();
  const selected = catalogConfig.browseCategories.find((c) => c.id === category);

  const results = merchants
    .filter((m) => (selected && selected.matchCuisines.length > 0 ? selected.matchCuisines.includes(m.cuisine) : true))
    .filter(
      (m) =>
        !trimmed ||
        m.name.toLowerCase().includes(trimmed) ||
        m.cuisine.toLowerCase().includes(trimmed) ||
        m.menu.some((section) => section.items.some((item) => item.name.toLowerCase().includes(trimmed))),
    )
    .map((m) => ({ merchant: m, km: origin ? haversineKm(origin, m.at) : 0 }))
    .sort((a, b) => Number(b.merchant.isOpen) - Number(a.merchant.isOpen) || a.km - b.km);

  return (
    <div className="col" style={{ height: '100%' }}>
      <ScreenHeader
        title="Order delivery"
        subtitle={`${results.filter((r) => r.merchant.isOpen).length} open now`}
      />
      <div className="col gap-3" style={{ padding: 'var(--s-3) var(--s-4) 0' }}>
        <div className="row gap-2 panel" style={{ padding: '0 var(--s-3)', height: 42 }}>
          <Icon name="search" size={17} color="var(--c-text-faint)" />
          <input
            className="grow"
            style={{ border: 'none', background: 'transparent', outline: 'none', height: 40 }}
            placeholder="Search stores or dishes"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <div className="scroll-x">
          {catalogConfig.browseCategories.map((option) => (
            <button
              key={option.id}
              type="button"
              className="pill-filter"
              data-active={option.id === category}
              onClick={() => onCategory(option.id)}
            >
              <Icon name={option.icon} size={14} />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="col grow" style={{ overflowY: 'auto', padding: 'var(--s-3) var(--s-4) 80px' }}>
        {results.length === 0 ? (
          <Empty icon="search" title="No stores match" hint="Try another category or search term." />
        ) : (
          <div className="col gap-4">
            {results.map(({ merchant, km }) => {
              const eta = merchant.currentPrepMinutes + Math.round(km * 3) + 4;
              return (
                <button
                  key={merchant.id}
                  type="button"
                  onClick={() => onOpen(merchant.id)}
                  className="col gap-2"
                  style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', opacity: merchant.isOpen ? 1 : 0.55 }}
                >
                  <div
                    style={{
                      height: 116,
                      borderRadius: 'var(--r-lg)',
                      background: `color-mix(in srgb, ${merchant.accent} 16%, var(--c-bg-sunken))`,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 46,
                      position: 'relative',
                    }}
                  >
                    {merchant.glyph}
                    {!merchant.isOpen && (
                      <span
                        className="chip chip-danger"
                        style={{ position: 'absolute', top: 'var(--s-2)', left: 'var(--s-2)' }}
                      >
                        Closed
                      </span>
                    )}
                    {merchant.busy && merchant.isOpen && (
                      <span
                        className="chip chip-warning"
                        style={{ position: 'absolute', top: 'var(--s-2)', left: 'var(--s-2)' }}
                      >
                        Busy
                      </span>
                    )}
                  </div>
                  <div className="row spread">
                    <span className="t-heading t-truncate">{merchant.name}</span>
                    <span className="row gap-1 t-small">
                      <Icon name="star" size={13} filled color="#f0a91b" />
                      {merchant.rating.toFixed(1)}
                    </span>
                  </div>
                  <span className="row gap-2 t-small t-muted">
                    <span>{merchant.cuisine}</span>
                    <span>·</span>
                    <span>{priceTierLabel(merchant.priceTier)}</span>
                    <span>·</span>
                    <span>{eta} min</span>
                    <span>·</span>
                    <span>{distance(km)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ display: 'none' }}>{state.now}</div>
    </div>
  );
}

/* ------------------------------- Storefront ------------------------------ */

function MerchantScreen({
  merchant,
  onBack,
  onPick,
}: {
  merchant?: Merchant;
  onBack: () => void;
  onPick: (item: MenuItem) => void;
}) {
  if (!merchant) return <Empty title="Store not found" />;

  return (
    <div className="col" style={{ height: '100%' }}>
      <ScreenHeader
        title={merchant.name}
        subtitle={`${merchant.cuisine} · ${merchant.currentPrepMinutes} min prep · ${priceTierLabel(merchant.priceTier)}`}
        onBack={onBack}
      />
      <div className="col grow" style={{ overflowY: 'auto', paddingBottom: 80 }}>
        <div
          style={{
            height: 132,
            background: `color-mix(in srgb, ${merchant.accent} 18%, var(--c-bg-sunken))`,
            display: 'grid',
            placeItems: 'center',
            fontSize: 56,
          }}
        >
          {merchant.glyph}
        </div>

        <div className="col gap-2" style={{ padding: 'var(--s-4)' }}>
          <div className="row gap-2 wrap">
            <Chip tone={merchant.isOpen ? 'positive' : 'danger'}>{merchant.isOpen ? 'Open' : 'Closed'}</Chip>
            <Chip tone="outline" icon="star">
              {merchant.rating.toFixed(2)} ({merchant.ratingCount.toLocaleString()})
            </Chip>
            <Chip tone="outline" icon="clock">
              {merchant.hours.open}:00–{merchant.hours.close % 24}:00
            </Chip>
            {merchant.busy && <Chip tone="warning">Busy — longer waits</Chip>}
          </div>
          <span className="t-small t-muted">{merchant.addressLine}</span>
          <span className="t-micro t-faint">
            Minimum order {money(merchant.settings.minimumOrder)} · packaging {money(merchant.settings.packagingFee)}
          </span>
        </div>

        {merchant.menu.map((section) => (
          <div key={section.id} className="col">
            <div style={{ padding: 'var(--s-3) var(--s-4) var(--s-1)' }}>
              <span className="t-heading">{section.name}</span>
            </div>
            {section.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="list-row"
                data-interactive="true"
                disabled={!item.available || !merchant.isOpen}
                onClick={() => onPick(item)}
                style={{ opacity: item.available && merchant.isOpen ? 1 : 0.45 }}
              >
                <span className="col grow" style={{ gap: 2 }}>
                  <span className="row gap-2">
                    <span className="t-body" style={{ fontWeight: 550 }}>
                      {item.name}
                    </span>
                    {item.popular && <Chip tone="warning">Popular</Chip>}
                  </span>
                  <span className="t-small t-muted t-clamp-2">{item.description}</span>
                  <span className="t-small t-num" style={{ fontWeight: 560 }}>
                    {money(item.price)}
                    {!item.available && <span className="t-micro t-faint"> · sold out</span>}
                  </span>
                </span>
                <span
                  style={{
                    width: 62,
                    height: 62,
                    borderRadius: 'var(--r-md)',
                    background: 'var(--c-bg-sunken)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 26,
                    flex: 'none',
                  }}
                >
                  {item.glyph}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- Cart -------------------------------- */

function CartView({
  cart,
  merchant,
  dropoff,
  onChange,
  onCheckout,
}: {
  cart: eatsActions.Cart;
  merchant?: Merchant;
  dropoff?: Place;
  onChange: (next: eatsActions.Cart) => void;
  onCheckout: () => void;
}) {
  const state = useWorld((s) => s.state);
  const customer = useCurrentRider();
  const [promoDraft, setPromoDraft] = useState(cart.promotionCode ?? '');

  if (!merchant || !dropoff) return <Empty title="Your cart is empty" />;

  const priced = eatsActions.quoteCart(state, cart, merchant, dropoff, customer?.id);
  const goods = eatsActions.cartGoodsSubtotal(cart);
  const belowMinimum = goods < merchant.settings.minimumOrder;
  const deliveryProducts = getProductsForMarket(state.marketId, 'delivery').filter((p) => p.id !== 'parcel');
  const paymentOptions = getPaymentMethodsForMarket(state.marketId, 'delivery').filter((m) =>
    customer?.paymentMethodIds.includes(m.id),
  );

  return (
    <div className="col gap-4">
      <div className="col">
        {cart.lines.map((line) => (
          <div key={line.id} className="row gap-3 row-top" style={{ paddingBlock: 'var(--s-2)' }}>
            <span style={{ fontSize: 22 }}>{line.glyph}</span>
            <span className="col grow" style={{ gap: 2 }}>
              <span className="t-body" style={{ fontWeight: 540 }}>{line.name}</span>
              {line.selections.length > 0 && (
                <span className="t-micro t-faint">{line.selections.flatMap((s) => s.optionNames).join(', ')}</span>
              )}
              {line.note && <span className="t-micro" style={{ color: 'var(--c-info)' }}>{line.note}</span>}
              <span className="row gap-2" style={{ marginTop: 4 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="minus"
                  onClick={() => onChange(eatsActions.setLineQuantity(cart, line.id, line.quantity - 1))}
                  aria-label="Decrease"
                />
                <span className="t-small t-num" style={{ minWidth: 16, textAlign: 'center' }}>{line.quantity}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="plus"
                  onClick={() => onChange(eatsActions.setLineQuantity(cart, line.id, line.quantity + 1))}
                  aria-label="Increase"
                />
              </span>
            </span>
            <span className="t-small t-num" style={{ fontWeight: 560 }}>
              {money(line.unitPrice * line.quantity)}
            </span>
          </div>
        ))}
      </div>

      <hr className="divider" />

      <div className="col gap-2">
        <span className="t-caps">Delivery speed</span>
        <div className="row gap-2">
          {deliveryProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              className="pill-filter grow center"
              data-active={cart.productId === product.id}
              onClick={() => onChange({ ...cart, productId: product.id })}
            >
              <Icon name={product.icon} size={14} />
              {product.shortName}
            </button>
          ))}
        </div>
      </div>

      <div className="col gap-2">
        <span className="t-caps">Delivery to</span>
        <div className="panel row gap-2">
          <Icon name="pin" size={15} />
          <span className="col grow" style={{ gap: 1 }}>
            <span className="t-small">{dropoff.label}</span>
            <span className="t-micro t-faint">{dropoff.addressLine}</span>
          </span>
        </div>
        <div className="row gap-2">
          {(['hand_it_to_me', 'leave_at_door', 'meet_outside'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="pill-filter grow center"
              data-active={cart.dropoffPreference === option}
              onClick={() => onChange({ ...cart, dropoffPreference: option })}
            >
              {option === 'hand_it_to_me' ? 'Hand to me' : option === 'leave_at_door' ? 'Leave at door' : 'Meet outside'}
            </button>
          ))}
        </div>
        <input
          className="input"
          placeholder="Note for the courier"
          value={cart.courierNote ?? ''}
          onChange={(e) => onChange({ ...cart, courierNote: e.target.value })}
        />
        <Switch
          checked={cart.utensils}
          onChange={(next) => onChange({ ...cart, utensils: next })}
          label="Include utensils"
        />
      </div>

      {appConfig.features.promotions && (
        <div className="col gap-2">
          <span className="t-caps">Promotions</span>
          <div className="row gap-2">
            <input
              className="input grow"
              placeholder="Promo code"
              value={promoDraft}
              onChange={(e) => setPromoDraft(e.target.value.toUpperCase())}
            />
            <Button variant="ghost" onClick={() => onChange({ ...cart, promotionCode: promoDraft })}>
              Apply
            </Button>
          </div>
          <div className="scroll-x">
            {promotions
              .filter((p) => p.enabled && p.appliesTo.includes('delivery'))
              .map((promo) => (
                <button
                  key={promo.id}
                  type="button"
                  className="pill-filter"
                  data-active={cart.promotionCode === promo.code}
                  onClick={() => {
                    setPromoDraft(promo.code);
                    onChange({ ...cart, promotionCode: promo.code });
                  }}
                >
                  <Icon name="gift" size={13} />
                  {promo.code}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="col gap-2">
        <span className="t-caps">Payment</span>
        <div className="scroll-x">
          {paymentOptions.map((method) => (
            <span key={method.id} className="pill-filter" data-active={method.id === customer?.defaultPaymentMethodId}>
              <Icon name={method.icon} size={14} />
              {method.label}
            </span>
          ))}
        </div>
      </div>

      <hr className="divider" />

      <div className="col gap-2">
        {priced.quote.lines.map((line) => (
          <div key={line.id} className="row spread">
            <span className="t-small t-muted">{line.label}</span>
            <span
              className="t-small t-num"
              style={{ color: line.kind === 'discount' ? 'var(--c-positive)' : undefined }}
            >
              {line.amount < 0 ? `−${money(Math.abs(line.amount))}` : money(line.amount)}
            </span>
          </div>
        ))}
        <hr className="divider" />
        <div className="row spread">
          <strong className="t-body">Total</strong>
          <strong className="t-heading t-num">{money(priced.quote.total)}</strong>
        </div>
        <span className="t-micro t-faint">Estimated delivery in {priced.etaMin} min</span>
      </div>

      {belowMinimum && (
        <span className="t-small" style={{ color: 'var(--c-warning)' }}>
          Add {money(merchant.settings.minimumOrder - goods)} more to meet the {money(merchant.settings.minimumOrder)} minimum.
        </span>
      )}

      <Button variant="primary" size="lg" block disabled={belowMinimum || !merchant.isOpen} onClick={onCheckout}>
        {merchant.isOpen ? `Place order · ${money(priced.quote.total)}` : 'Store is closed'}
      </Button>
    </div>
  );
}

/* -------------------------------- Orders -------------------------------- */

function OrdersScreen({ onOpen }: { onOpen: (id: ID) => void }) {
  const state = useWorld((s) => s.state);
  const customer = useCurrentRider();
  const orders = Object.values(state.orders)
    .filter((o) => o.customerId === customer?.id)
    .sort((a, b) => (b.deliveredAt ?? b.placedAt) - (a.deliveredAt ?? a.placedAt));

  const live = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status));
  const past = orders.filter((o) => ['delivered', 'cancelled'].includes(o.status));

  return (
    <div className="col" style={{ height: '100%' }}>
      <ScreenHeader title="Orders" subtitle={`${plural(orders.length, 'order')}`} />
      <div className="col grow" style={{ overflowY: 'auto' }}>
        {live.length > 0 && (
          <>
            <div style={{ padding: 'var(--s-3) var(--s-4) var(--s-1)' }}>
              <span className="t-caps">In progress</span>
            </div>
            {live.map((order) => (
              <JobSummaryRow key={order.id} job={order} onClick={() => onOpen(order.id)} />
            ))}
          </>
        )}
        <div style={{ padding: 'var(--s-3) var(--s-4) var(--s-1)' }}>
          <span className="t-caps">Past orders</span>
        </div>
        {past.length === 0 ? (
          <Empty icon="receipt" title="No past orders" />
        ) : (
          past.map((order) => <JobSummaryRow key={order.id} job={order} onClick={() => onOpen(order.id)} />)
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Account ------------------------------- */

function EatsAccount() {
  const state = useWorld((s) => s.state);
  const customer = useCurrentRider();
  if (!customer) return null;

  const orders = Object.values(state.orders).filter((o) => o.customerId === customer.id && o.status === 'delivered');
  const spend = orders.reduce((acc, o) => acc + (o.settlement ?? o.quote).total, 0);
  const favouriteMerchant = orders
    .map((o) => state.merchants[o.merchantId])
    .filter(Boolean)
    .reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.name]: (acc[m.name] ?? 0) + 1 }), {});
  const top = Object.entries(favouriteMerchant).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="col" style={{ height: '100%' }}>
      <ScreenHeader title="Account" />
      <div className="col grow gap-4" style={{ overflowY: 'auto', padding: 'var(--s-4)' }}>
        <PersonRow
          name={`${customer.firstName} ${customer.lastName}`}
          hue={customer.avatarHue}
          rating={customer.rating}
          size={56}
          subtitle={`${orders.length} delivered orders`}
        />
        <Card title="Summary">
          <div className="col gap-2">
            <div className="row spread">
              <span className="t-small t-muted">Lifetime spend</span>
              <span className="t-small t-num">{money(spend)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Average order</span>
              <span className="t-small t-num">{money(orders.length ? spend / orders.length : 0)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Most ordered from</span>
              <span className="t-small">{top?.[0] ?? '—'}</span>
            </div>
          </div>
        </Card>
        <Card title="Addresses" pad={false}>
          {customer.savedPlaces.map((place) => (
            <ListRow key={place.id} icon={place.icon} title={place.label} subtitle={place.addressLine} />
          ))}
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------- Map ---------------------------------- */

function OrderMap({ order }: { order: Order }) {
  const state = useWorld((s) => s.state);
  const courier = order.courierId ? state.drivers[order.courierId] : undefined;

  const markers: MapMarker[] = order.stops.map((stop, index) => ({
    id: stop.id,
    at: stop.place.at,
    kind: index === 0 ? 'merchant' : 'dropoff',
    label: stop.place.label,
  }));

  const routes: MapRoute[] = [];
  if (courier) {
    markers.push({
      id: courier.id,
      at: courier.at,
      kind: 'vehicle',
      heading: courier.heading,
      emphasis: true,
      color: 'var(--accent-eats, #0f8a4a)',
    });
    if (courier.activeRoute) {
      routes.push({
        id: 'courier',
        route: courier.activeRoute,
        variant: order.status === 'delivering' || order.status === 'picked_up' ? 'active' : 'planned',
      });
    }
  }

  return (
    <Map
      marketId={state.marketId}
      markers={markers}
      routes={routes}
      fitTo={[...order.stops.map((s) => s.place.at), ...(courier ? [courier.at] : [])]}
    />
  );
}

/* --------------------------------- Aside -------------------------------- */

function EatsAside({ cart }: { cart: eatsActions.Cart }) {
  const state = useWorld((s) => s.state);
  const customer = useCurrentRider();
  const merchants = Object.values(state.merchants).filter((m) => m.marketId === state.marketId);
  const liveOrders = Object.values(state.orders).filter((o) => !['delivered', 'cancelled'].includes(o.status));

  return (
    <>
      <Card title="Marketplace right now">
        <div className="col gap-3">
          <div className="row spread">
            <span className="t-small t-muted">Storefronts open</span>
            <span className="t-small t-num">
              {merchants.filter((m) => m.isOpen).length} / {merchants.length}
            </span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Orders in flight</span>
            <span className="t-small t-num">{liveOrders.length}</span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Median prep time</span>
            <span className="t-small t-num">
              {Math.round(
                merchants.reduce((acc, m) => acc + m.currentPrepMinutes, 0) / Math.max(1, merchants.length),
              )}{' '}
              min
            </span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Couriers available</span>
            <span className="t-small t-num">
              {
                Object.values(state.drivers).filter(
                  (d) => d.status === 'online' && !d.activeJobId && d.optedProductIds.some((p) => p.startsWith('eats')),
                ).length
              }
            </span>
          </div>
        </div>
      </Card>

      {cart.lines.length > 0 && (
        <Card title="Cart contents">
          <div className="col gap-2">
            {cart.lines.map((line) => (
              <div key={line.id} className="row spread">
                <span className="t-small t-truncate">
                  {line.quantity}× {line.name}
                </span>
                <span className="t-small t-num">{money(line.unitPrice * line.quantity)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Catalogue model">
        <div className="col gap-2">
          <span className="t-small t-muted">
            {catalogConfig.archetypes.length} merchant archetypes generate every storefront in the market, each with its
            own name, prices, hours, availability and prep time.
          </span>
          <div className="row wrap gap-2">
            {catalogConfig.archetypes.map((archetype) => (
              <Chip key={archetype.id} tone="outline">
                {archetype.glyph} {archetype.cuisine}
              </Chip>
            ))}
          </div>
          <span className="t-micro t-faint">
            {catalogConfig.modifierGroups.length} shared modifier groups · {customer?.savedPlaces.length ?? 0} saved addresses
          </span>
        </div>
      </Card>
    </>
  );
}
