/**
 * Merchant surface — the storefront operator's console.
 *
 * The queue on the left is the live order flow from the Eats surface. Every
 * control here changes what consumers can buy and what couriers are dispatched
 * for, immediately: accepting an order starts the kitchen clock the customer's
 * ETA is derived from; 86'ing an item removes it from the storefront.
 */
import { useMemo, useState } from 'react';
import { catalogConfig, payoutConfig } from '@config';
import { cancellationReasons, orderStatusPresentation } from '@core/lifecycle';
import type { ID, MenuItem, Order } from '@core/types';
import { clock, dayTime, money, moneyCompact, percent, plural, relative } from '@platform/format';
import { useAction, useCurrentMerchant } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as merchantActions from '@platform/actions/merchant';
import { useSurfaceAccent } from '@platform/theme';
import { ConsoleLayout } from '@app/ConsoleLayout';
// Aliased so it does not shadow the global Map constructor used below.
import { Map as MapView } from '@ui/Map';
import { Icon } from '@ui/Icon';
import { Avatar, Button, Card, Chip, Empty, ListRow, Metric, Modal, Switch } from '@ui/primitives';
import { ChatPanel, JobTimeline, LedgerRow, StatusBadge } from '@ui/components';

type Section = 'queue' | 'menu' | 'storefront' | 'payouts' | 'insights';

export function MerchantSurface() {
  useSurfaceAccent('merchant');
  const state = useWorld((s) => s.state);
  const merchant = useCurrentMerchant();
  const setSessionMerchant = useWorld((s) => s.setSessionMerchant);
  const [section, setSection] = useState<Section>('queue');
  const [switching, setSwitching] = useState(false);

  const queue = useMemo(
    () => (merchant ? merchantActions.merchantQueue(state, merchant.id) : undefined),
    [state, merchant],
  );

  if (!merchant || !queue) return <Empty title="No storefront selected" />;

  const today = merchantActions.merchantToday(state, merchant.id);

  const sections = [
    {
      group: 'Operations',
      items: [
        { id: 'queue', label: 'Order queue', icon: 'receipt', badge: queue.incoming.length },
        { id: 'menu', label: 'Menu', icon: 'utensils' },
        { id: 'storefront', label: 'Storefront', icon: 'store' },
      ],
    },
    {
      group: 'Business',
      items: [
        { id: 'payouts', label: 'Payouts', icon: 'wallet' },
        { id: 'insights', label: 'Insights', icon: 'chart' },
      ],
    },
  ];

  return (
    <ConsoleLayout
      sections={sections}
      active={section}
      onChange={(id) => setSection(id as Section)}
      brand={
        <button
          type="button"
          className="row gap-3"
          onClick={() => setSwitching(true)}
          style={{ background: 'none', border: 'none', padding: 'var(--s-2)', textAlign: 'left', width: '100%' }}
        >
          <span style={{ fontSize: 26 }}>{merchant.glyph}</span>
          <span className="col grow" style={{ gap: 1 }}>
            <span className="t-body t-truncate" style={{ fontWeight: 620 }}>
              {merchant.name}
            </span>
            <span className="t-micro t-faint">{merchant.cuisine} · switch store</span>
          </span>
          <Icon name="chevron-down" size={14} color="var(--c-text-faint)" />
        </button>
      }
      title={SECTION_TITLES[section]}
      subtitle={
        merchant.isOpen
          ? `Open · ${merchant.currentPrepMinutes} min prep · ${queue.preparing.length + queue.incoming.length} active`
          : 'Closed'
      }
      actions={<StoreStatusControls />}
      footer={
        <div className="col gap-2" style={{ padding: 'var(--s-2)' }}>
          <div className="row spread">
            <span className="t-micro t-faint">Today</span>
            <span className="t-small t-num">{money(today.revenue)}</span>
          </div>
          <div className="row spread">
            <span className="t-micro t-faint">Orders</span>
            <span className="t-small t-num">{today.orders}</span>
          </div>
        </div>
      }
    >
      {section === 'queue' && <QueueSection queue={queue} />}
      {section === 'menu' && <MenuSection />}
      {section === 'storefront' && <StorefrontSection />}
      {section === 'payouts' && <PayoutsSection />}
      {section === 'insights' && <InsightsSection />}

      {switching && (
        <Modal title="Switch storefront" onClose={() => setSwitching(false)}>
          <div className="col" style={{ maxHeight: 460, overflowY: 'auto' }}>
            {Object.values(state.merchants)
              .filter((m) => m.marketId === state.marketId)
              .sort((a, b) => b.stats.ordersToday - a.stats.ordersToday)
              .map((candidate) => (
                <ListRow
                  key={candidate.id}
                  leading={<span style={{ fontSize: 22 }}>{candidate.glyph}</span>}
                  title={candidate.name}
                  subtitle={`${candidate.cuisine} · ${candidate.isOpen ? 'open' : 'closed'} · ${candidate.stats.ordersToday} orders today`}
                  selected={candidate.id === merchant.id}
                  onClick={() => {
                    setSessionMerchant(candidate.id);
                    setSwitching(false);
                  }}
                />
              ))}
          </div>
        </Modal>
      )}
    </ConsoleLayout>
  );
}

const SECTION_TITLES: Record<Section, string> = {
  queue: 'Order queue',
  menu: 'Menu management',
  storefront: 'Storefront settings',
  payouts: 'Payouts',
  insights: 'Insights',
};

/* --------------------------- Store status bar ---------------------------- */

function StoreStatusControls() {
  const merchant = useCurrentMerchant();
  const act = useAction();
  if (!merchant) return null;

  return (
    <>
      <div className="row gap-2">
        <span className="t-small t-muted">Busy mode</span>
        <Switch
          checked={merchant.busy}
          onChange={(next) => act(merchantActions.setBusy(merchant.id, next), 'toggle busy')}
        />
      </div>
      <Button
        variant={merchant.settings.paused ? 'positive' : 'ghost'}
        icon={merchant.settings.paused ? 'play' : 'pause'}
        onClick={() => act(merchantActions.pauseStore(merchant.id, merchant.settings.paused ? 0 : 30), 'pause store')}
      >
        {merchant.settings.paused ? 'Resume orders' : 'Pause 30 min'}
      </Button>
    </>
  );
}

/* -------------------------------- Queue ---------------------------------- */

function QueueSection({ queue }: { queue: Record<string, Order[]> }) {
  const [selected, setSelected] = useState<ID | undefined>();
  const state = useWorld((s) => s.state);
  const order = selected ? state.orders[selected] : undefined;

  const columns: { id: string; label: string; tone: string }[] = [
    { id: 'incoming', label: 'Needs action', tone: 'var(--c-danger)' },
    { id: 'preparing', label: 'Preparing', tone: 'var(--c-warning)' },
    { id: 'ready', label: 'Ready / courier', tone: 'var(--c-info)' },
    { id: 'inTransit', label: 'In transit', tone: 'var(--c-positive)' },
  ];

  return (
    <div className="col gap-4">
      <div className="grid-metrics">
        {columns.map((column) => (
          <Metric key={column.id} label={column.label} value={queue[column.id].length} />
        ))}
        <Metric label="Recently completed" value={queue.completed.length} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--s-3)' }}>
        {columns.map((column) => (
          <div key={column.id} className="col gap-2">
            <div className="row gap-2">
              <span className="dot" style={{ background: column.tone }} />
              <span className="t-caps">{column.label}</span>
              <span className="t-micro t-faint">{queue[column.id].length}</span>
            </div>
            <div className="col gap-2">
              {queue[column.id].length === 0 && (
                <div className="panel">
                  <span className="t-micro t-faint">Nothing here</span>
                </div>
              )}
              {queue[column.id].map((entry) => (
                <OrderCard key={entry.id} order={entry} onOpen={() => setSelected(entry.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <Card title="Completed" pad={false}>
        {queue.completed.length === 0 ? (
          <Empty icon="receipt" title="No completed orders yet" />
        ) : (
          queue.completed.slice(0, 12).map((entry) => (
            <ListRow
              key={entry.id}
              icon={entry.status === 'delivered' ? 'check' : 'x'}
              iconColor={entry.status === 'delivered' ? 'var(--c-positive)' : 'var(--c-danger)'}
              title={`${entry.code} · ${plural(entry.lines.length, 'line')}`}
              subtitle={`${dayTime(entry.deliveredAt ?? entry.cancelledAt ?? entry.placedAt)} · ${state.riders[entry.customerId]?.displayName ?? ''}`}
              trailing={
                <span className="t-small t-num">
                  {money(entry.lines.reduce((acc, l) => acc + l.lineTotal, 0))}
                </span>
              }
              onClick={() => setSelected(entry.id)}
            />
          ))
        )}
      </Card>

      {order && <OrderDetail order={order} onClose={() => setSelected(undefined)} />}
    </div>
  );
}

function OrderCard({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const state = useWorld((s) => s.state);
  const act = useAction();
  const customer = state.riders[order.customerId];
  const courier = order.courierId ? state.drivers[order.courierId] : undefined;
  const presentation = orderStatusPresentation[order.status];
  const goods = order.lines.reduce((acc, l) => acc + l.lineTotal, 0);

  return (
    <div className="card card-tight col gap-2">
      <button
        type="button"
        onClick={onOpen}
        className="col gap-2"
        style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
      >
        <div className="row spread">
          <span className="t-small" style={{ fontWeight: 620 }}>
            {order.code}
          </span>
          <span className="t-small t-num">{money(goods)}</span>
        </div>
        <span className="t-micro t-faint">
          {clock(order.placedAt)} · {relative(order.placedAt, state.now)} · {customer?.displayName ?? ''}
        </span>
        <div className="col" style={{ gap: 2 }}>
          {order.lines.slice(0, 3).map((line) => (
            <span key={line.id} className="t-micro t-truncate">
              {line.quantity}× {line.name}
            </span>
          ))}
          {order.lines.length > 3 && <span className="t-micro t-faint">+{order.lines.length - 3} more</span>}
        </div>
        <div className="row gap-2 wrap">
          <Chip tone={presentation.tone === 'positive' ? 'positive' : presentation.tone === 'danger' ? 'danger' : 'outline'}>
            {presentation.label}
          </Chip>
          {courier && <Chip tone="info">{courier.displayName}</Chip>}
        </div>
      </button>

      {order.status === 'merchant_review' && (
        <div className="row gap-2">
          <Button
            variant="positive"
            size="sm"
            block
            onClick={() => act(merchantActions.acceptOrder(order.id), 'accept order')}
          >
            Accept
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => act(merchantActions.rejectOrder(order.id, 'out-of-stock'), 'reject order')}
          >
            Reject
          </Button>
        </div>
      )}

      {order.status === 'preparing' && !order.readyAt && (
        <Button
          variant="primary"
          size="sm"
          block
          onClick={() => act(merchantActions.markOrderReady(order.id), 'mark ready')}
        >
          Mark ready
        </Button>
      )}
    </div>
  );
}

function OrderDetail({ order, onClose }: { order: Order; onClose: () => void }) {
  const state = useWorld((s) => s.state);
  const merchant = useCurrentMerchant();
  const act = useAction();
  const customer = state.riders[order.customerId];
  const courier = order.courierId ? state.drivers[order.courierId] : undefined;
  const goods = order.lines.reduce((acc, l) => acc + l.lineTotal, 0);
  const [tab, setTab] = useState<'items' | 'timeline' | 'chat'>('items');

  return (
    <Modal title={`Order ${order.code}`} onClose={onClose} width={620}>
      <div className="col gap-4">
        <div className="row spread">
          <StatusBadge job={order} />
          <span className="t-heading t-num">{money(goods)}</span>
        </div>

        <div className="row gap-3">
          {customer && (
            <div className="panel row gap-2 grow">
              <Avatar name={customer.displayName} hue={customer.avatarHue} size={30} />
              <span className="col" style={{ gap: 1 }}>
                <span className="t-small">{customer.displayName}</span>
                <span className="t-micro t-faint">{customer.lifetimeOrders} orders</span>
              </span>
            </div>
          )}
          {courier && (
            <div className="panel row gap-2 grow">
              <Avatar name={courier.displayName} hue={courier.avatarHue} size={30} />
              <span className="col" style={{ gap: 1 }}>
                <span className="t-small">{courier.displayName}</span>
                <span className="t-micro t-faint">courier · {courier.vehicle.plate}</span>
              </span>
            </div>
          )}
        </div>

        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {(['items', 'timeline', 'chat'] as const).map((option) => (
            <button key={option} data-active={tab === option} onClick={() => setTab(option)} style={{ textTransform: 'capitalize' }}>
              {option}
            </button>
          ))}
        </div>

        {tab === 'items' && (
          <div className="col gap-3">
            {order.lines.map((line) => (
              <div key={line.id} className="col gap-2">
                <div className="row gap-3 row-top">
                  <span className="t-body t-num" style={{ fontWeight: 620, minWidth: 26 }}>
                    {line.quantity}×
                  </span>
                  <span className="col grow" style={{ gap: 2 }}>
                    <span className="t-body">{line.name}</span>
                    {line.selections.map((selection) => (
                      <span key={selection.groupId} className="t-micro t-faint">
                        {selection.groupName}: {selection.optionNames.join(', ')}
                      </span>
                    ))}
                    {line.note && (
                      <span className="t-micro" style={{ color: 'var(--c-info)' }}>
                        Note: {line.note}
                      </span>
                    )}
                  </span>
                  <span className="t-body t-num">{money(line.lineTotal)}</span>
                </div>
                {['merchant_review', 'preparing'].includes(order.status) && (
                  <div className="row gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        act(
                          merchantActions.substituteLine(order.id, line.id, 'Closest equivalent substituted'),
                          'substitute line',
                        )
                      }
                    >
                      Substitute
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        act(
                          merchantActions.substituteLine(order.id, line.id, 'Out of stock', true),
                          'mark unavailable',
                        )
                      }
                    >
                      Unavailable
                    </Button>
                    {line.fulfilment !== 'pending' && <Chip tone="warning">{line.fulfilment}</Chip>}
                  </div>
                )}
              </div>
            ))}
            <hr className="divider" />
            <div className="row spread">
              <span className="t-small t-muted">Customer paid</span>
              <span className="t-small t-num">{money((order.settlement ?? order.quote).total)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Your revenue after commission</span>
              <span className="t-small t-num">
                {money(goods * (1 - payoutConfig.merchantCommission.deliveryOrders))}
              </span>
            </div>
            {order.utensils && <Chip tone="outline">Include utensils</Chip>}
          </div>
        )}

        {tab === 'timeline' && <JobTimeline job={order} now={state.now} />}

        {tab === 'chat' && merchant && (
          <ChatPanel
            messages={order.messages}
            viewer="merchant"
            now={state.now}
            onSend={(body) => act(merchantActions.merchantChat(order.id, merchant.name, body), 'merchant message')}
          />
        )}

        {['merchant_review', 'preparing'].includes(order.status) && (
          <div className="row gap-2">
            {order.status === 'merchant_review' && (
              <Button variant="positive" block onClick={() => act(merchantActions.acceptOrder(order.id), 'accept order')}>
                Accept order
              </Button>
            )}
            {order.status === 'preparing' && (
              <Button variant="primary" block onClick={() => act(merchantActions.markOrderReady(order.id), 'mark ready')}>
                Mark ready for pickup
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                act(merchantActions.rejectOrder(order.id, cancellationReasons.merchant[0].id), 'reject order');
                onClose();
              }}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* --------------------------------- Menu ---------------------------------- */

function MenuSection() {
  const merchant = useCurrentMerchant();
  const act = useAction();
  const [editing, setEditing] = useState<MenuItem | undefined>();
  const [newSection, setNewSection] = useState('');
  if (!merchant) return null;

  const totalItems = merchant.menu.reduce((acc, s) => acc + s.items.length, 0);
  const unavailable = merchant.menu.reduce(
    (acc, s) => acc + s.items.filter((i) => !i.available).length,
    0,
  );

  return (
    <div className="col gap-4">
      <div className="grid-metrics">
        <Metric label="Sections" value={merchant.menu.length} />
        <Metric label="Items" value={totalItems} />
        <Metric label="Unavailable" value={unavailable} tone={unavailable > 0 ? 'warning' : undefined} />
        <Metric label="Modifier groups" value={catalogConfig.modifierGroups.length} hint="shared across the catalogue" />
      </div>

      {merchant.menu.map((section) => (
        <Card
          key={section.id}
          title={section.name}
          pad={false}
          action={<span className="t-micro t-faint">{plural(section.items.length, 'item')}</span>}
        >
          {section.items.map((item) => (
            <ListRow
              key={item.id}
              leading={<span style={{ fontSize: 22, width: 30, textAlign: 'center' }}>{item.glyph}</span>}
              title={item.name}
              subtitle={`${money(item.price)} · ${item.prepMinutes} min · ${plural(item.modifierGroups.length, 'modifier group')}`}
              trailing={
                <div className="row gap-3">
                  {item.popular && <Chip tone="warning">Popular</Chip>}
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(item)} aria-label="Edit" />
                  <Switch
                    checked={item.available}
                    onChange={(next) => act(merchantActions.setItemAvailability(merchant.id, item.id, next), 'toggle item')}
                  />
                </div>
              }
            />
          ))}
          {section.items.length === 0 && (
            <div style={{ padding: 'var(--s-4)' }}>
              <span className="t-small t-faint">No items in this section yet.</span>
            </div>
          )}
        </Card>
      ))}

      <Card title="Add a section">
        <div className="row gap-2">
          <input
            className="input grow"
            placeholder="Section name, e.g. Desserts"
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
          />
          <Button
            variant="primary"
            disabled={!newSection.trim()}
            onClick={() => {
              act(merchantActions.addSection(merchant.id, newSection.trim()), 'add section');
              setNewSection('');
            }}
          >
            Add section
          </Button>
        </div>
      </Card>

      {editing && <ItemEditor item={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function ItemEditor({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const merchant = useCurrentMerchant();
  const act = useAction();
  const [draft, setDraft] = useState({
    name: item.name,
    description: item.description,
    price: item.price,
    prepMinutes: item.prepMinutes,
    popular: item.popular,
  });
  if (!merchant) return null;

  return (
    <Modal
      title={`Edit ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            block
            onClick={() => {
              act(merchantActions.updateItem(merchant.id, item.id, draft), 'update item');
              onClose();
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <div className="field">
          <label htmlFor="item-name">Name</label>
          <input id="item-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="item-desc">Description</label>
          <textarea
            id="item-desc"
            className="textarea"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>
        <div className="row gap-3">
          <div className="field grow">
            <label htmlFor="item-price">Price</label>
            <input
              id="item-price"
              className="input"
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field grow">
            <label htmlFor="item-prep">Prep minutes</label>
            <input
              id="item-prep"
              className="input"
              inputMode="numeric"
              value={draft.prepMinutes}
              onChange={(e) => setDraft({ ...draft, prepMinutes: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
        <Switch
          checked={draft.popular}
          onChange={(next) => setDraft({ ...draft, popular: next })}
          label="Mark as popular"
          hint="Shown with a badge and ranked higher in the storefront."
        />

        <div className="col gap-2">
          <span className="t-caps">Modifier groups</span>
          {item.modifierGroups.map((group) => (
            <div key={group.id} className="panel col gap-2">
              <div className="row spread">
                <span className="t-small" style={{ fontWeight: 560 }}>
                  {group.name}
                </span>
                <Chip tone="outline">{group.required ? 'Required' : 'Optional'}</Chip>
              </div>
              {group.options.map((option) => (
                <div key={option.id} className="row spread">
                  <span className="t-small t-muted">
                    {option.name}
                    {option.priceDelta > 0 ? ` · +${money(option.priceDelta)}` : ''}
                  </span>
                  <Switch
                    checked={option.available}
                    onChange={(next) =>
                      act(merchantActions.setOptionAvailability(merchant.id, option.id, next), 'toggle option')
                    }
                  />
                </div>
              ))}
            </div>
          ))}
          {item.modifierGroups.length === 0 && <span className="t-small t-faint">No modifier groups on this item.</span>}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ Storefront ------------------------------- */

function StorefrontSection() {
  const state = useWorld((s) => s.state);
  const merchant = useCurrentMerchant();
  const act = useAction();
  if (!merchant) return null;

  const set = (patch: Parameters<typeof merchantActions.updateMerchantSettings>[1]) =>
    act(merchantActions.updateMerchantSettings(merchant.id, patch), 'update settings');

  return (
    <div className="grid-split">
      <div className="col gap-4">
        <Card title="Ordering">
          <div className="col gap-4">
            <Switch
              checked={merchant.settings.autoAcceptOrders}
              onChange={(next) => set({ autoAcceptOrders: next })}
              label="Auto-accept orders"
              hint="Skip the review step and start preparing immediately."
            />
            <Switch
              checked={merchant.settings.acceptsScheduledOrders}
              onChange={(next) => set({ acceptsScheduledOrders: next })}
              label="Accept scheduled orders"
              hint="Customers can place an order ahead of time."
            />
            <div className="row gap-3">
              <div className="field grow">
                <label htmlFor="min-order">Minimum order</label>
                <input
                  id="min-order"
                  className="input"
                  inputMode="decimal"
                  value={merchant.settings.minimumOrder}
                  onChange={(e) => set({ minimumOrder: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="field grow">
                <label htmlFor="packaging">Packaging fee</label>
                <input
                  id="packaging"
                  className="input"
                  inputMode="decimal"
                  value={merchant.settings.packagingFee}
                  onChange={(e) => set({ packagingFee: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="field grow">
                <label htmlFor="radius">Delivery radius (km)</label>
                <input
                  id="radius"
                  className="input"
                  inputMode="decimal"
                  value={merchant.settings.deliveryRadiusKm}
                  onChange={(e) => set({ deliveryRadiusKm: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card title="Opening hours">
          <div className="col gap-3">
            <div className="row gap-3">
              <div className="field grow">
                <label htmlFor="open">Opens</label>
                <select
                  id="open"
                  className="select"
                  value={merchant.hours.open}
                  onChange={(e) =>
                    act(merchantActions.updateMerchantHours(merchant.id, Number(e.target.value), merchant.hours.close), 'update hours')
                  }
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {h.toString().padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>
              <div className="field grow">
                <label htmlFor="close">Closes</label>
                <select
                  id="close"
                  className="select"
                  value={merchant.hours.close}
                  onChange={(e) =>
                    act(merchantActions.updateMerchantHours(merchant.id, merchant.hours.open, Number(e.target.value)), 'update hours')
                  }
                >
                  {Array.from({ length: 27 }, (_, h) => (
                    <option key={h} value={h}>
                      {(h % 24).toString().padStart(2, '0')}:00{h >= 24 ? ' (next day)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row gap-2 wrap">
              {catalogConfig.hoursTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="pill-filter"
                  data-active={merchant.hours.open === template.open && merchant.hours.close === template.close}
                  onClick={() =>
                    act(merchantActions.updateMerchantHours(merchant.id, template.open, template.close), 'apply hours template')
                  }
                >
                  {template.label}
                </button>
              ))}
            </div>
            <span className="t-micro t-faint">
              The simulated clock reads {clock(state.now)}. The storefront is {merchant.isOpen ? 'open' : 'closed'} right now.
            </span>
          </div>
        </Card>

        <Card title="Kitchen load">
          <div className="col gap-3">
            <div className="row spread">
              <span className="t-small t-muted">Base prep time</span>
              <span className="t-small t-num">{merchant.basePrepMinutes} min</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Current estimate shown to customers</span>
              <span className="t-small t-num">{merchant.currentPrepMinutes} min</span>
            </div>
            <span className="t-micro t-faint">
              The live estimate rises with queue depth and busy mode, and feeds every customer ETA and every courier
              dispatch time.
            </span>
          </div>
        </Card>
      </div>

      <div className="col gap-4">
        <Card title="Location" pad={false}>
          <div style={{ height: 260 }}>
            <MapView
              marketId={state.marketId}
              markers={[{ id: merchant.id, at: merchant.at, kind: 'merchant', label: merchant.name }]}
              fitTo={[merchant.at]}
            />
          </div>
          <div style={{ padding: 'var(--s-3) var(--s-4)' }}>
            <span className="t-small t-muted">{merchant.addressLine}</span>
          </div>
        </Card>

        <Card title="Reputation">
          <div className="col gap-3">
            <div className="row spread">
              <span className="t-small t-muted">Rating</span>
              <span className="row gap-1 t-small">
                <Icon name="star" size={13} filled color="#f0a91b" />
                {merchant.rating.toFixed(2)} ({merchant.ratingCount.toLocaleString()})
              </span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Accept rate</span>
              <span className="t-small t-num">{percent(merchant.stats.acceptRate)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Average prep</span>
              <span className="t-small t-num">{merchant.stats.avgPrepMinutes} min</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------- Payouts -------------------------------- */

function PayoutsSection() {
  const state = useWorld((s) => s.state);
  const merchant = useCurrentMerchant();
  if (!merchant) return null;

  const summary = merchantActions.merchantPayoutSummary(state, merchant.id);
  const entries = merchantActions.merchantLedger(state, merchant.id).sort((a, b) => b.at - a.at);

  return (
    <div className="col gap-4">
      <div className="grid-metrics">
        <Metric label="Gross sales" value={money(summary.gross)} />
        <Metric label="Commission" value={`−${money(summary.commission)}`} tone="danger" hint={percent(summary.commissionRate)} />
        <Metric label="Net payout" value={money(summary.net)} tone="positive" />
        <Metric label="Next payout" value={`${summary.nextPayoutInDays} days`} hint={`${summary.schedule} schedule`} />
      </div>

      <Card title="Statement">
        <div className="col">
          {entries.length === 0 ? (
            <Empty icon="wallet" title="No transactions yet" />
          ) : (
            entries.slice(0, 40).map((entry) => (
              <LedgerRow key={entry.id} label={entry.label} amount={entry.amount} at={entry.at} sublabel={entry.jobCode} />
            ))
          )}
        </div>
      </Card>

      <Card title="How payouts work">
        <div className="col gap-2">
          <span className="t-small t-muted">
            Delivery orders carry a {percent(payoutConfig.merchantCommission.deliveryOrders)} commission and pickup
            orders {percent(payoutConfig.merchantCommission.pickupOrders)}. Payouts run {payoutConfig.schedule} with a{' '}
            {payoutConfig.merchantPayoutDelayDays}-day settlement delay.
          </span>
          <span className="t-micro t-faint">All of these rates come from config/payments.config.ts.</span>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------- Insights ------------------------------- */

function InsightsSection() {
  const state = useWorld((s) => s.state);
  const merchant = useCurrentMerchant();
  if (!merchant) return null;

  const orders = Object.values(state.orders).filter((o) => o.merchantId === merchant.id);
  const delivered = orders.filter((o) => o.status === 'delivered');
  const cancelled = orders.filter((o) => o.status === 'cancelled');
  const revenue = delivered.reduce((acc, o) => acc + o.lines.reduce((s, l) => s + l.lineTotal, 0), 0);

  // Best sellers, derived from the actual order lines.
  const itemCounts = new Map<string, { name: string; count: number; revenue: number }>();
  for (const order of delivered) {
    for (const line of order.lines) {
      const entry = itemCounts.get(line.itemId) ?? { name: line.name, count: 0, revenue: 0 };
      entry.count += line.quantity;
      entry.revenue += line.lineTotal;
      itemCounts.set(line.itemId, entry);
    }
  }
  const bestSellers = [...itemCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  const peak = Math.max(1, ...bestSellers.map((b) => b.count));

  // Orders by hour of day.
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: delivered.filter((o) => new Date(o.placedAt).getHours() === hour).length,
  }));
  const hourPeak = Math.max(1, ...byHour.map((h) => h.count));

  return (
    <div className="col gap-4">
      <div className="grid-metrics">
        <Metric label="Orders delivered" value={delivered.length} />
        <Metric label="Revenue" value={moneyCompact(revenue)} />
        <Metric label="Average basket" value={money(delivered.length ? revenue / delivered.length : 0)} />
        <Metric
          label="Cancellation rate"
          value={percent(orders.length ? cancelled.length / orders.length : 0)}
          tone={cancelled.length / Math.max(1, orders.length) > 0.1 ? 'danger' : undefined}
        />
      </div>

      <div className="grid-split">
        <Card title="Best sellers">
          <div className="col gap-3">
            {bestSellers.length === 0 && <Empty icon="chart" title="Not enough data yet" />}
            {bestSellers.map((entry) => (
              <div key={entry.name} className="col gap-1">
                <div className="row spread">
                  <span className="t-small t-truncate">{entry.name}</span>
                  <span className="t-small t-num">
                    {entry.count} · {money(entry.revenue)}
                  </span>
                </div>
                <div className="meter">
                  <i style={{ width: `${(entry.count / peak) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Orders by hour">
          <div className="row" style={{ gap: 3, alignItems: 'flex-end', height: 140 }}>
            {byHour.map((entry) => (
              <div key={entry.hour} className="col grow" style={{ alignItems: 'center', gap: 3 }}>
                <div
                  style={{
                    width: '100%',
                    height: `${Math.max(2, (entry.count / hourPeak) * 110)}px`,
                    borderRadius: 3,
                    background: 'var(--accent-surface, var(--c-info))',
                    opacity: entry.count === 0 ? 0.18 : 1,
                  }}
                  title={`${entry.hour}:00 · ${entry.count} orders`}
                />
                {entry.hour % 6 === 0 && <span className="t-micro t-faint">{entry.hour}</span>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
