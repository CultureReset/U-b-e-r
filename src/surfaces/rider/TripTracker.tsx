/**
 * Live trip tracking. Reads the driver's real position from the world, so the
 * ETA the rider sees is derived from the same route the vehicle is walking.
 */
import { useState } from 'react';
import { appConfig, getProduct } from '@config';
import { cancellationReasons, tripStatusPresentation } from '@core/lifecycle';
import { tipSuggestions } from '@core/pricing';
import { remainingAlong } from '@core/routing';
import type { Trip } from '@core/types';
import { arrivalAt, duration, money } from '@platform/format';
import { useAction } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as riderActions from '@platform/actions/rider';
import { Icon } from '@ui/Icon';
import { Button, Chip, Modal, Meter } from '@ui/primitives';
import { ChatPanel, FareBreakdown, PersonRow, ProgressSteps, RatingForm, StopList, VehicleBadge } from '@ui/components';

export function TripTracker({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const state = useWorld((s) => s.state);
  const act = useAction();
  const driver = trip.driverId ? state.drivers[trip.driverId] : undefined;
  const product = getProduct(trip.productId);
  const presentation = tripStatusPresentation[trip.status];

  const [panel, setPanel] = useState<'none' | 'chat' | 'cancel' | 'safety' | 'receipt'>('none');
  const [rating, setRating] = useState(false);

  // Remaining time comes off the vehicle's own progress along its route.
  const remainingMin = (() => {
    if (!driver?.activeRoute) return undefined;
    const remaining = remainingAlong(driver.activeRoute, driver.routeProgressM);
    return Math.max(1, Math.round(remaining.durationSec / 60));
  })();

  const showRating =
    trip.status === 'completed' && appConfig.features.ratings && !trip.riderRating;

  if (showRating || rating) {
    const settled = trip.settlement ?? trip.quote;
    return (
      <div className="col gap-4">
        <div className="col gap-1">
          <span className="t-title">You've arrived</span>
          <span className="t-small t-muted">
            {product?.name} · {money(settled.total)}
          </span>
        </div>
        <RatingForm
          subject={driver?.displayName ?? 'your driver'}
          tipOptions={tipSuggestions(settled.total)}
          onSubmit={(stars, tags, tip, comment) => {
            act(
              riderActions.rateTrip(trip.id, { stars, tags, tip, comment, at: state.now }, 'rider'),
              'rate trip',
            );
            setRating(false);
            onDone();
          }}
        />
        <Button variant="quiet" block onClick={onDone}>
          Skip
        </Button>
      </div>
    );
  }

  if (trip.status === 'completed' || trip.status === 'cancelled') {
    const settled = trip.settlement ?? trip.quote;
    return (
      <div className="col gap-4">
        <div className="row gap-3">
          <Icon
            name={trip.status === 'completed' ? 'check' : 'x'}
            size={22}
            color={trip.status === 'completed' ? 'var(--c-positive)' : 'var(--c-danger)'}
          />
          <span className="col grow" style={{ gap: 1 }}>
            <span className="t-heading">{presentation.label}</span>
            <span className="t-micro t-faint">{trip.code}</span>
          </span>
        </div>
        {trip.status === 'completed' && <FareBreakdown quote={settled} compact />}
        <Button variant="primary" block onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="col gap-4">
      <div className="col gap-2">
        <ProgressSteps job={trip} />
        <div className="row spread">
          <span className="col" style={{ gap: 1 }}>
            <span className="t-title">
              {trip.status === 'searching' || trip.status === 'requested'
                ? 'Finding your driver'
                : trip.status === 'scheduled'
                  ? 'Scheduled'
                  : remainingMin
                    ? `${duration(remainingMin)} away`
                    : presentation.label}
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

      {(trip.status === 'searching' || trip.status === 'requested') && (
        <div className="col gap-2">
          <Meter value={0.35} />
          <span className="t-micro t-faint">
            Offering to nearby drivers · {Object.values(state.offers).filter((o) => o.jobId === trip.id).length} sent
          </span>
        </div>
      )}

      {trip.status === 'no_drivers' && (
        <div className="panel col gap-3">
          <span className="t-small">No drivers were available. You can try again or cancel.</span>
          <div className="row gap-2">
            <Button
              variant="primary"
              block
              onClick={() =>
                act((draft) => {
                  const t = draft.trips[trip.id];
                  if (t) draft.trips[trip.id] = { ...t, status: 'searching', requestedAt: draft.now };
                }, 'retry match')
              }
            >
              Try again
            </Button>
            <Button variant="ghost" onClick={() => setPanel('cancel')}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {driver && (
        <div className="card card-pad col gap-3">
          <PersonRow
            name={driver.displayName}
            hue={driver.avatarHue}
            rating={driver.rating}
            subtitle={<VehicleBadge classId={driver.vehicle.classId} plate={driver.vehicle.plate} color={driver.vehicle.color} />}
            trailing={
              <div className="row gap-1">
                {appConfig.features.inAppChat && (
                  <Button variant="ghost" size="sm" icon="message" onClick={() => setPanel('chat')} aria-label="Message" />
                )}
                <Button variant="ghost" size="sm" icon="phone" aria-label="Call" />
              </div>
            }
          />
          <div className="row gap-2 t-micro t-faint">
            <span>{driver.vehicle.make} {driver.vehicle.model}</span>
            <span>·</span>
            <span>{driver.lifetime.jobs.toLocaleString()} trips</span>
          </div>
        </div>
      )}

      <div className="card card-pad">
        <StopList job={trip} />
      </div>

      <div className="row gap-2">
        {appConfig.features.liveLocationSharing && (
          <Button
            variant="ghost"
            block
            icon="share"
            onClick={() => act(riderActions.shareTrip(trip.id), 'share trip')}
          >
            {trip.shareToken ? 'Sharing' : 'Share trip'}
          </Button>
        )}
        {appConfig.features.safetyToolkit && (
          <Button variant="ghost" block icon="shield" onClick={() => setPanel('safety')}>
            Safety
          </Button>
        )}
      </div>

      <div className="panel row spread">
        <span className="t-small t-muted">Estimated fare</span>
        <span className="t-body t-num" style={{ fontWeight: 600 }}>
          {money(trip.quote.total)}
        </span>
      </div>

      {trip.status !== 'in_progress' && (
        <Button variant="quiet" block onClick={() => setPanel('cancel')}>
          Cancel trip
        </Button>
      )}

      {panel === 'chat' && (
        <Modal title={`Message ${driver?.displayName ?? 'driver'}`} onClose={() => setPanel('none')}>
          <ChatPanel
            messages={trip.messages}
            viewer="rider"
            now={state.now}
            onSend={(body, cannedId) =>
              act(
                riderActions.sendMessage(trip.id, 'rider', state.riders[trip.riderId]?.displayName ?? 'Rider', body, cannedId),
                'send message',
              )
            }
          />
        </Modal>
      )}

      {panel === 'safety' && (
        <Modal title="Safety toolkit" onClose={() => setPanel('none')}>
          <div className="col gap-3">
            <span className="t-small t-muted">
              Trip {trip.code} · {driver?.vehicle.plate ?? 'vehicle pending'}
            </span>
            <Button
              icon="shield"
              block
              onClick={() => {
                act(riderActions.triggerSafetyCheck(trip.id), 'safety check');
                setPanel('none');
              }}
            >
              Run a safety check
            </Button>
            <Button
              icon="share"
              block
              onClick={() => {
                act(riderActions.shareTrip(trip.id), 'share trip');
                setPanel('none');
              }}
            >
              Share live location
            </Button>
            <Button variant="danger" icon="phone" block>
              Contact emergency services
            </Button>
            <span className="t-micro t-faint">
              {trip.safety.checksRun} safety check{trip.safety.checksRun === 1 ? '' : 's'} run on this trip.
            </span>
          </div>
        </Modal>
      )}

      {panel === 'cancel' && (
        <Modal title="Cancel this trip?" onClose={() => setPanel('none')}>
          <div className="col gap-2">
            <span className="t-small t-muted">Tell us why — it helps us improve matching.</span>
            {cancellationReasons.rider.map((reason) => (
              <Button
                key={reason.id}
                variant="ghost"
                block
                onClick={() => {
                  act(riderActions.cancelTrip(trip.id, 'rider', reason.id), 'cancel trip');
                  setPanel('none');
                  onDone();
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
