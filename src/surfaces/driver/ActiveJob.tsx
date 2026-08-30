/**
 * The active job panel — the earner's turn-by-turn action list.
 *
 * Each stage exposes exactly one primary action, and that action drives the
 * same state machine the simulator uses, so the rider's tracking screen
 * updates the moment the earner taps.
 */
import { useState } from 'react';
import { getProduct } from '@config';
import { cancellationReasons } from '@core/lifecycle';
import { remainingAlong } from '@core/routing';
import type { DriverProfile, Order, Trip } from '@core/types';
import { arrivalAt, distance, duration, money } from '@platform/format';
import { useAction } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as driverActions from '@platform/actions/driver';
import * as riderActions from '@platform/actions/rider';
import { Button, Chip, Modal } from '@ui/primitives';
import { ChatPanel, PersonRow, StopList } from '@ui/components';

export function ActiveJob({ driver, job }: { driver: DriverProfile; job: Trip | Order }) {
  const state = useWorld((s) => s.state);
  const act = useAction();
  const [panel, setPanel] = useState<'none' | 'chat' | 'cancel' | 'details'>('none');
  const product = getProduct(job.productId);

  const counterpartId = job.kind === 'trip' ? job.riderId : job.customerId;
  const counterpart = state.riders[counterpartId];
  const merchant = job.kind === 'order' ? state.merchants[job.merchantId] : undefined;

  const remaining = driver.activeRoute
    ? remainingAlong(driver.activeRoute, driver.routeProgressM)
    : undefined;
  const remainingMin = remaining ? Math.max(1, Math.round(remaining.durationSec / 60)) : undefined;

  const payout = (job.settlement ?? job.quote).earnerPayout;

  /* ------------------------- Stage → primary action ------------------------ */

  const action = (() => {
    if (job.kind === 'trip') {
      switch (job.status) {
        case 'assigned':
        case 'arriving':
          return {
            label: 'I have arrived',
            hint: `Head to ${job.stops[0].place.label}`,
            run: () => act(driverActions.confirmArrival(driver.id), 'driver arrived'),
            variant: 'primary' as const,
          };
        case 'waiting':
          return {
            label: 'Start trip',
            hint: `Confirm ${counterpart?.displayName ?? 'the rider'} is on board`,
            run: () => act(driverActions.startTrip(job.id), 'start trip'),
            variant: 'positive' as const,
          };
        case 'in_progress':
          return {
            label: 'Complete trip',
            hint: `Drop off at ${job.stops[job.stops.length - 1].place.label}`,
            run: () => act(driverActions.completeTrip(job.id), 'complete trip'),
            variant: 'positive' as const,
          };
        default:
          return undefined;
      }
    }

    switch (job.status) {
      case 'courier_assigned':
      case 'preparing':
      case 'ready':
        return {
          label: 'Arrived at store',
          hint: `Collect from ${merchant?.name ?? 'the merchant'}`,
          run: () => act(driverActions.confirmArrival(driver.id), 'courier arrived'),
          variant: 'primary' as const,
        };
      case 'courier_at_merchant':
        return {
          label: job.readyAt ? 'Confirm pickup' : 'Waiting on the kitchen',
          hint: job.readyAt ? 'Check the order, then confirm' : `Ready in about ${merchant?.currentPrepMinutes ?? 5} min`,
          run: () => act(driverActions.confirmPickup(job.id), 'confirm pickup'),
          variant: 'positive' as const,
          disabled: !job.readyAt,
        };
      case 'picked_up':
      case 'delivering':
        return {
          label: job.dropoffPreference === 'leave_at_door' ? 'Complete · photo proof' : 'Complete delivery',
          hint: `Deliver to ${job.stops[job.stops.length - 1].place.label}`,
          run: () =>
            act(
              driverActions.completeDelivery(
                job.id,
                job.dropoffPreference === 'leave_at_door' ? { kind: 'photo', value: 'doorstep.jpg' } : undefined,
              ),
              'complete delivery',
            ),
          variant: 'positive' as const,
        };
      default:
        return undefined;
    }
  })();

  return (
    <div className="col gap-4">
      <div className="row spread">
        <span className="col" style={{ gap: 1 }}>
          <span className="row gap-2">
            <Chip tone="accent">{product?.shortName ?? job.productId}</Chip>
            <span className="t-micro t-faint">{job.code}</span>
          </span>
          <span className="t-title">
            {remainingMin ? `${duration(remainingMin)} · ${arrivalAt(state.now, remainingMin)}` : action?.label ?? 'In progress'}
          </span>
          {remaining && (
            <span className="t-micro t-faint">{distance(remaining.distanceM / 1000)} remaining</span>
          )}
        </span>
        <span className="col" style={{ alignItems: 'flex-end' }}>
          <span className="t-title t-num">{money(payout)}</span>
          <span className="t-micro t-faint">your payout</span>
        </span>
      </div>

      <div className="card card-pad">
        <StopList job={job} />
      </div>

      {job.kind === 'order' && (
        <div className="card card-pad col gap-2">
          <div className="row spread">
            <span className="t-caps">Order · {job.lines.length} lines</span>
            {merchant && <span className="t-micro t-faint">{merchant.name}</span>}
          </div>
          {job.lines.map((line) => (
            <div key={line.id} className="row gap-2">
              <span className="t-small t-num" style={{ fontWeight: 620, minWidth: 20 }}>
                {line.quantity}×
              </span>
              <span className="t-small grow t-truncate">{line.name}</span>
              {line.fulfilment === 'unavailable' && <Chip tone="danger">Removed</Chip>}
            </div>
          ))}
          {job.utensils && <span className="t-micro t-faint">Include utensils</span>}
          {job.courierNote && (
            <span className="t-micro" style={{ color: 'var(--c-info)' }}>
              Customer note: {job.courierNote}
            </span>
          )}
          <Chip tone="outline">
            {job.dropoffPreference === 'hand_it_to_me'
              ? 'Hand it to the customer'
              : job.dropoffPreference === 'leave_at_door'
                ? 'Leave at the door — photo required'
                : 'Meet outside'}
          </Chip>
        </div>
      )}

      {counterpart && (
        <div className="card card-pad">
          <PersonRow
            name={counterpart.displayName}
            hue={counterpart.avatarHue}
            rating={counterpart.rating}
            subtitle={job.kind === 'trip' ? `${counterpart.lifetimeTrips} trips` : `${counterpart.lifetimeOrders} orders`}
            trailing={
              <div className="row gap-1">
                <Button variant="ghost" size="sm" icon="message" onClick={() => setPanel('chat')} aria-label="Message" />
                <Button variant="ghost" size="sm" icon="phone" aria-label="Call" />
              </div>
            }
          />
        </div>
      )}

      {action && (
        <Button variant={action.variant} size="lg" block disabled={action.disabled} onClick={action.run}>
          {action.label}
        </Button>
      )}
      {action?.hint && <span className="t-micro t-faint" style={{ textAlign: 'center' }}>{action.hint}</span>}

      <div className="row gap-2">
        <Button variant="ghost" block icon="navigation">
          Navigate
        </Button>
        <Button variant="quiet" block onClick={() => setPanel('cancel')}>
          Cancel job
        </Button>
      </div>

      {panel === 'chat' && (
        <Modal title={`Message ${counterpart?.displayName ?? ''}`} onClose={() => setPanel('none')}>
          <ChatPanel
            messages={job.messages}
            viewer="driver"
            now={state.now}
            onSend={(body, cannedId) =>
              act(riderActions.sendMessage(job.id, 'driver', driver.displayName, body, cannedId), 'send message')
            }
          />
        </Modal>
      )}

      {panel === 'cancel' && (
        <Modal title="Cancel this job?" onClose={() => setPanel('none')}>
          <div className="col gap-2">
            <span className="t-small t-muted">
              Cancelling affects your completion rate and returns the job to dispatch.
            </span>
            {cancellationReasons.driver.map((reason) => (
              <Button
                key={reason.id}
                variant="ghost"
                block
                onClick={() => {
                  act(driverActions.abandonJob(driver.id, reason.id), 'abandon job');
                  setPanel('none');
                }}
              >
                {reason.label}
              </Button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
