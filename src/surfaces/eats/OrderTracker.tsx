/**
 * Delivery tracking. The courier's position, the merchant's live prep estimate
 * and the order's state machine all come from the same world the merchant
 * dashboard is operating on.
 */
import { useState } from 'react';
import { appConfig } from '@config';
import { orderStatusPresentation } from '@core/lifecycle';
import { tipSuggestions } from '@core/pricing';
import { remainingAlong } from '@core/routing';
import type { Order } from '@core/types';
import { arrivalAt, duration, money, relative } from '@platform/format';
import { useAction } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as eatsActions from '@platform/actions/eats';
import * as riderActions from '@platform/actions/rider';
import { Icon } from '@ui/Icon';
import { Button, Chip, Modal, Meter } from '@ui/primitives';
import { ChatPanel, FareBreakdown, JobTimeline, PersonRow, ProgressSteps, RatingForm, StopList, VehicleBadge } from '@ui/components';

export function OrderTracker({ order, onDone }: { order: Order; onDone: () => void }) {
  const state = useWorld((s) => s.state);
  const act = useAction();
  const merchant = state.merchants[order.merchantId];
  const courier = order.courierId ? state.drivers[order.courierId] : undefined;
  const presentation = orderStatusPresentation[order.status];
  const [panel, setPanel] = useState<'none' | 'chat' | 'cancel' | 'timeline'>('none');

  const remainingMin = (() => {
    if (courier?.activeRoute) {
      return Math.max(1, Math.round(remainingAlong(courier.activeRoute, courier.routeProgressM).durationSec / 60));
    }
    if (['placed', 'merchant_review', 'preparing'].includes(order.status)) {
      return Math.max(1, merchant?.currentPrepMinutes ?? 15);
    }
    return undefined;
  })();

  const settled = order.settlement ?? order.quote;
  const showRating = order.status === 'delivered' && appConfig.features.ratings && !order.customerRating;

  if (showRating) {
    return (
      <div className="col gap-4">
        <div className="col gap-1">
          <span className="t-title">Order delivered</span>
          <span className="t-small t-muted">{merchant?.name} · {money(settled.total)}</span>
        </div>
        <RatingForm
          subject={merchant?.name ?? 'the restaurant'}
          tipOptions={tipSuggestions(settled.total)}
          onSubmit={(stars, tags, tip, comment) => {
            act(eatsActions.rateOrder(order.id, { stars, tags, tip, comment, at: state.now }), 'rate order');
            onDone();
          }}
        />
        <Button variant="quiet" block onClick={onDone}>
          Skip
        </Button>
      </div>
    );
  }

  if (order.status === 'delivered' || order.status === 'cancelled') {
    return (
      <div className="col gap-4">
        <div className="row gap-3">
          <Icon
            name={order.status === 'delivered' ? 'check' : 'x'}
            size={22}
            color={order.status === 'delivered' ? 'var(--c-positive)' : 'var(--c-danger)'}
          />
          <span className="col grow" style={{ gap: 1 }}>
            <span className="t-heading">{presentation.label}</span>
            <span className="t-micro t-faint">{order.code} · {merchant?.name}</span>
          </span>
        </div>
        {order.status === 'delivered' && <FareBreakdown quote={settled} compact />}
        <Button variant="primary" block onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="col gap-4">
      <div className="col gap-2">
        <ProgressSteps job={order} />
        <div className="row spread">
          <span className="col" style={{ gap: 1 }}>
            <span className="t-title">
              {remainingMin ? `${duration(remainingMin)} away` : presentation.label}
            </span>
            <span className="t-small t-muted">{presentation.consumerCopy}</span>
          </span>
          {remainingMin && (
            <Chip tone="accent" icon="clock">
              {arrivalAt(state.now, remainingMin)}
            </Chip>
          )}
        </div>
      </div>

      {['placed', 'merchant_review'].includes(order.status) && <Meter value={0.25} />}

      {merchant && (
        <div className="card card-pad row gap-3">
          <span style={{ fontSize: 28 }}>{merchant.glyph}</span>
          <span className="col grow" style={{ gap: 1 }}>
            <span className="t-body" style={{ fontWeight: 580 }}>{merchant.name}</span>
            <span className="t-micro t-faint">
              {merchant.addressLine} · prep {merchant.currentPrepMinutes} min
            </span>
          </span>
          <Button variant="ghost" size="sm" icon="message" onClick={() => setPanel('chat')} aria-label="Message" />
        </div>
      )}

      {courier && (
        <div className="card card-pad col gap-3">
          <PersonRow
            name={courier.displayName}
            hue={courier.avatarHue}
            rating={courier.rating}
            subtitle={<VehicleBadge classId={courier.vehicle.classId} plate={courier.vehicle.plate} />}
            trailing={
              <div className="row gap-1">
                <Button variant="ghost" size="sm" icon="message" onClick={() => setPanel('chat')} aria-label="Message" />
                <Button variant="ghost" size="sm" icon="phone" aria-label="Call" />
              </div>
            }
          />
          <span className="t-micro t-faint">Your courier · {courier.lifetime.jobs.toLocaleString()} deliveries</span>
        </div>
      )}

      <div className="card card-pad col gap-3">
        <span className="t-caps">Your order · {order.lines.length} item{order.lines.length === 1 ? '' : 's'}</span>
        {order.lines.map((line) => (
          <div key={line.id} className="row gap-3 row-top">
            <span className="t-small t-num" style={{ fontWeight: 620, minWidth: 20 }}>
              {line.quantity}×
            </span>
            <span className="col grow" style={{ gap: 1 }}>
              <span className="t-small">{line.name}</span>
              {line.selections.length > 0 && (
                <span className="t-micro t-faint">
                  {line.selections.flatMap((s) => s.optionNames).join(', ')}
                </span>
              )}
              {line.note && <span className="t-micro" style={{ color: 'var(--c-info)' }}>{line.note}</span>}
              {line.fulfilment === 'unavailable' && (
                <span className="t-micro" style={{ color: 'var(--c-danger)' }}>
                  Unavailable — {line.substitutionNote ?? 'removed by the merchant'}
                </span>
              )}
              {line.fulfilment === 'substituted' && (
                <span className="t-micro" style={{ color: 'var(--c-warning)' }}>
                  Substituted — {line.substitutionNote}
                </span>
              )}
            </span>
            <span className="t-small t-num">{money(line.lineTotal)}</span>
          </div>
        ))}
        <hr className="divider" />
        <FareBreakdown quote={order.quote} compact />
      </div>

      <div className="card card-pad">
        <StopList job={order} />
      </div>

      <div className="row gap-2">
        <Button variant="ghost" block icon="history" onClick={() => setPanel('timeline')}>
          Timeline
        </Button>
        {appConfig.features.liveLocationSharing && (
          <Button variant="ghost" block icon="share">
            Share
          </Button>
        )}
      </div>

      {['placed', 'merchant_review', 'preparing'].includes(order.status) && (
        <Button variant="quiet" block onClick={() => setPanel('cancel')}>
          Cancel order
        </Button>
      )}

      {panel === 'chat' && (
        <Modal title="Messages" onClose={() => setPanel('none')}>
          <ChatPanel
            messages={order.messages}
            viewer="rider"
            now={state.now}
            onSend={(body, cannedId) =>
              act(
                riderActions.sendMessage(
                  order.id,
                  'rider',
                  state.riders[order.customerId]?.displayName ?? 'Customer',
                  body,
                  cannedId,
                ),
                'send message',
              )
            }
          />
        </Modal>
      )}

      {panel === 'timeline' && (
        <Modal title={`Order ${order.code}`} onClose={() => setPanel('none')}>
          <JobTimeline job={order} now={state.now} />
          <span className="t-micro t-faint" style={{ display: 'block', marginTop: 'var(--s-3)' }}>
            Placed {relative(order.placedAt, state.now)}
          </span>
        </Modal>
      )}

      {panel === 'cancel' && (
        <Modal title="Cancel this order?" onClose={() => setPanel('none')}>
          <div className="col gap-3">
            <span className="t-small t-muted">
              {order.status === 'preparing'
                ? 'The restaurant has already started preparing this order — you may still be charged.'
                : 'You will not be charged.'}
            </span>
            <Button
              variant="danger"
              block
              onClick={() => {
                act(eatsActions.cancelOrder(order.id, 'customer', 'plans-changed'), 'cancel order');
                setPanel('none');
                onDone();
              }}
            >
              Cancel order
            </Button>
            <Button variant="ghost" block onClick={() => setPanel('none')}>
              Keep order
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
