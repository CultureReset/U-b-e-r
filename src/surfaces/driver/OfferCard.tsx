/**
 * The dispatch offer. This is the earner's whole decision surface: what they
 * are being paid, how far away it starts, how long it takes end to end, and
 * how long they have to decide.
 */
import type { DispatchOffer } from '@core/types';
import { distance, duration, money } from '@platform/format';
import { Icon } from '@ui/Icon';
import { Button, Chip, Countdown } from '@ui/primitives';

export function OfferCard({
  offer,
  now,
  onAccept,
  onDecline,
}: {
  offer: DispatchOffer;
  now: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const perKm = offer.preview.tripDistanceKm > 0 ? offer.preview.payout / offer.preview.tripDistanceKm : 0;
  const perHour = offer.preview.totalMinutes > 0 ? (offer.preview.payout / offer.preview.totalMinutes) * 60 : 0;

  return (
    <div className="col gap-4 animate-rise">
      <div className="row spread">
        <div className="col" style={{ gap: 2 }}>
          <span className="row gap-2">
            <span className="t-caps">{offer.jobKind === 'order' ? 'Delivery' : 'Trip'}</span>
            <Chip tone="outline">{offer.preview.productName}</Chip>
            {offer.preview.surgeMultiplier >= 1.15 && (
              <Chip tone="warning" icon="bolt">
                {offer.preview.surgeMultiplier.toFixed(1)}x
              </Chip>
            )}
          </span>
          <span className="t-display t-num">{money(offer.preview.payout)}</span>
          <span className="t-micro t-faint">
            {money(perKm)}/km · {money(perHour)}/hr · includes surge
            {offer.preview.includesTipEstimate ? ', excludes tip' : ''}
          </span>
        </div>
        <Countdown expiresAt={offer.expiresAt} now={now} size={48} />
      </div>

      <div className="panel col gap-3">
        <div className="row gap-3">
          <span className="col" style={{ alignItems: 'center', alignSelf: 'stretch', width: 12 }}>
            <span className="dot" style={{ background: 'var(--c-positive)', marginTop: 5 }} />
            <span style={{ width: 1, flex: 1, background: 'var(--c-border-strong)', marginBlock: 3 }} />
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--c-text)' }} />
          </span>
          <span className="col grow gap-3">
            <span className="col" style={{ gap: 1 }}>
              <span className="t-body t-truncate" style={{ fontWeight: 550 }}>
                {offer.preview.merchantName ?? offer.preview.pickupLabel}
              </span>
              <span className="t-micro t-faint">
                {duration(offer.preview.approachMinutes)} · {distance(offer.preview.approachDistanceKm)} away
              </span>
            </span>
            <span className="col" style={{ gap: 1 }}>
              <span className="t-body t-truncate" style={{ fontWeight: 550 }}>
                {offer.preview.dropoffLabel}
              </span>
              <span className="t-micro t-faint">
                {duration(offer.preview.totalMinutes - offer.preview.approachMinutes)} ·{' '}
                {distance(offer.preview.tripDistanceKm)} trip
              </span>
            </span>
          </span>
        </div>
      </div>

      <div className="row gap-4">
        <span className="row gap-1 t-small t-muted">
          <Icon name="star" size={13} filled color="#f0a91b" />
          {offer.preview.riderRating.toFixed(2)}
        </span>
        {offer.preview.itemCount !== undefined && (
          <span className="row gap-1 t-small t-muted">
            <Icon name="bag" size={13} />
            {offer.preview.itemCount} items
          </span>
        )}
        <span className="row gap-1 t-small t-muted">
          <Icon name="clock" size={13} />
          {duration(offer.preview.totalMinutes)} total
        </span>
      </div>

      <div className="row gap-2">
        <Button variant="ghost" size="lg" onClick={onDecline} style={{ flex: '0 0 40%' }}>
          Decline
        </Button>
        <Button variant="positive" size="lg" block onClick={onAccept}>
          Accept
        </Button>
      </div>
    </div>
  );
}
