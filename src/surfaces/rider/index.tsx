/**
 * Rider surface — the consumer ride-hailing product.
 *
 * Home is a live map with a booking sheet over it; Activity is history and
 * receipts; Account is profile, places, payment and the business profile.
 */
import { useEffect, useMemo, useState } from 'react';
import { appConfig, getMarket, getProductsForMarket, orgConfig, paymentMethods } from '@config';
import { haversineKm } from '@core/geo';
import type { ID, Place } from '@core/types';
import { distance, money, moneyCompact, plural } from '@platform/format';
import { useAction, useCurrentRider, useMeasuredHeight } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as riderActions from '@platform/actions/rider';
import { useSurfaceAccent } from '@platform/theme';
import { DeviceFrame, ScreenHeader } from '@app/DeviceFrame';
import { Map, type MapMarker, type MapRoute } from '@ui/Map';
import { Icon } from '@ui/Icon';
import { Avatar, Button, Card, Chip, Empty, ListRow, Modal, Sheet, Switch } from '@ui/primitives';
import { FareBreakdown, JobSummaryRow, JobTimeline, PersonRow, StopList, VehicleBadge } from '@ui/components';
import { PlaceSearch, placeFromPoint } from './search';
import { ProductPicker, type BookingSelection } from './BookingFlow';
import { TripTracker } from './TripTracker';

type Stage = 'idle' | 'planning' | 'choosing' | 'tracking';
type Tab = 'home' | 'activity' | 'account';

export function RiderSurface() {
  useSurfaceAccent('rider');
  const state = useWorld((s) => s.state);
  const rider = useCurrentRider();
  const act = useAction();

  const [tab, setTab] = useState<Tab>('home');
  const [stage, setStage] = useState<Stage>('idle');
  const [stops, setStops] = useState<Place[]>([]);
  const [editingStop, setEditingStop] = useState<number | null>(null);
  const [pickingOnMap, setPickingOnMap] = useState<number | null>(null);
  const [activeTripId, setActiveTripId] = useState<ID | undefined>();
  const [sheetRef, sheetHeight] = useMeasuredHeight<HTMLDivElement>();
  const [detailTripId, setDetailTripId] = useState<ID | undefined>();

  const products = getProductsForMarket(state.marketId, 'ride');
  const [selection, setSelection] = useState<BookingSelection>({
    productId: products[0]?.id ?? 'go',
    paymentMethodId: rider?.defaultPaymentMethodId ?? 'card',
  });

  const activeTrip = activeTripId ? state.trips[activeTripId] : undefined;

  // Reattach to an in-flight trip after a reload or a surface switch.
  useEffect(() => {
    if (activeTripId || !rider) return;
    const live = Object.values(state.trips).find(
      (t) => t.riderId === rider.id && !['completed', 'cancelled', 'no_drivers'].includes(t.status),
    );
    if (live) {
      setActiveTripId(live.id);
      setStage('tracking');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider?.id]);

  useEffect(() => {
    if (activeTrip && stage !== 'tracking') setStage('tracking');
  }, [activeTrip, stage]);

  const driver = activeTrip?.driverId ? state.drivers[activeTrip.driverId] : undefined;

  /* ------------------------------- Map data ------------------------------ */

  const { markers, routes, fitTo } = useMemo(() => {
    const markers: MapMarker[] = [];
    const routes: MapRoute[] = [];
    const fitTo: { lat: number; lng: number }[] = [];

    const points = activeTrip ? activeTrip.stops.map((s) => s.place) : stops;
    points.forEach((place, index) => {
      markers.push({
        id: `stop-${index}-${place.id}`,
        at: place.at,
        kind: index === 0 ? 'pickup' : index === points.length - 1 ? 'dropoff' : 'waypoint',
        label: place.label,
      });
      fitTo.push(place.at);
    });

    if (driver) {
      markers.push({
        id: `driver-${driver.id}`,
        at: driver.at,
        kind: 'vehicle',
        heading: driver.heading,
        emphasis: true,
        color: 'var(--accent-rider, #2f6bff)',
      });
      fitTo.push(driver.at);
      if (driver.activeRoute) {
        routes.push({
          id: 'driver-route',
          route: driver.activeRoute,
          variant: activeTrip?.status === 'in_progress' ? 'active' : 'planned',
        });
      }
    } else if (activeTrip?.route) {
      routes.push({ id: 'trip-route', route: activeTrip.route, variant: 'active' });
    }

    // Idle state: show nearby supply so the map isn't empty.
    if (!activeTrip && stops.length === 0 && rider) {
      const nearby = Object.values(state.drivers)
        .filter((d) => d.marketId === state.marketId && d.status === 'online' && !d.activeJobId)
        .map((d) => ({ d, km: haversineKm(rider.savedPlaces[0].at, d.at) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 12);
      for (const { d } of nearby) {
        markers.push({ id: `idle-${d.id}`, at: d.at, kind: 'vehicle', heading: d.heading });
      }
      markers.push({ id: 'me', at: rider.savedPlaces[0].at, kind: 'user' });
      fitTo.push(rider.savedPlaces[0].at, ...nearby.slice(0, 3).map(({ d }) => d.at));
    }

    return { markers, routes, fitTo };
  }, [activeTrip, driver, stops, rider, state.drivers, state.marketId]);

  /* ------------------------------- Handlers ------------------------------ */

  const startPlanning = () => {
    if (stops.length === 0 && rider) {
      setStops([{ ...rider.savedPlaces[0], label: 'Current location' }]);
      setEditingStop(1);
    } else {
      setEditingStop(stops.length);
    }
    setStage('planning');
  };

  const setStopAt = (index: number, place: Place) => {
    setStops((current) => {
      const next = [...current];
      next[index] = place;
      return next;
    });
    setEditingStop(null);
  };

  const confirmBooking = () => {
    if (!rider || stops.length < 2) return;
    let created: ID | undefined;
    act((draft, ctx) => {
      created = riderActions.requestTrip(
        {
          productId: selection.productId,
          stops,
          paymentMethodId: selection.paymentMethodId,
          promotionCode: selection.promotionCode,
          scheduledFor: selection.scheduledFor,
          orgContext: selection.orgContext,
          note: selection.note,
        },
        rider.id,
      )(draft, ctx);
    }, 'request trip');

    if (created) {
      setActiveTripId(created);
      setStage('tracking');
    }
  };

  const resetFlow = () => {
    setStops([]);
    setActiveTripId(undefined);
    setStage('idle');
    setEditingStop(null);
  };

  /* --------------------------------- Views -------------------------------- */

  const tabs = [
    { id: 'home', label: 'Home', icon: 'car' },
    { id: 'activity', label: 'Activity', icon: 'history' },
    { id: 'account', label: 'Account', icon: 'settings' },
  ];

  const detailTrip = detailTripId ? state.trips[detailTripId] : undefined;

  return (
    <DeviceFrame
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as Tab)}
      aside={<RiderAside />}
    >
      {tab === 'home' && (
        <div className="col" style={{ height: '100%', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Map
              marketId={state.marketId}
              markers={markers}
              routes={routes}
              fitTo={fitTo.length > 1 ? fitTo : undefined}
              viewInset={{ top: 44, bottom: sheetHeight }}
              follow={driver && activeTrip?.status === 'in_progress' ? driver.at : undefined}
              onSelectPoint={
                pickingOnMap !== null
                  ? (at) => {
                      setStopAt(pickingOnMap, placeFromPoint(state.marketId, at));
                      setPickingOnMap(null);
                    }
                  : undefined
              }
            />
          </div>

          {pickingOnMap !== null && (
            <div
              className="row center gap-2"
              style={{
                position: 'absolute',
                top: 44,
                left: 'var(--s-3)',
                right: 'var(--s-3)',
                padding: 'var(--s-2) var(--s-3)',
                background: 'var(--c-surface)',
                borderRadius: 'var(--r-md)',
                boxShadow: '0 4px 16px rgb(0 0 0 / 0.16)',
                zIndex: 10,
              }}
            >
              <Icon name="pin" size={15} />
              <span className="t-small grow">Tap the map to set this stop</span>
              <Button variant="quiet" size="sm" onClick={() => setPickingOnMap(null)}>
                Cancel
              </Button>
            </div>
          )}

          {/* The sheet must never squeeze the live map into a strip — tracking is
              the one stage where watching the vehicle move is the point. */}
          <div
            ref={sheetRef}
            style={{
              marginTop: 'auto',
              zIndex: 5,
              maxHeight: stage === 'idle' ? '52%' : stage === 'tracking' ? '62%' : '78%',
            }}
          >
            <Sheet grip={stage !== 'idle'} onClose={stage === 'planning' ? () => setStage('idle') : undefined}>
              {stage === 'idle' && rider && (
                <IdleSheet
                  onStart={startPlanning}
                  onPickSaved={(place) => {
                    setStops([{ ...rider.savedPlaces[0], label: 'Current location' }, place]);
                    setStage('choosing');
                  }}
                />
              )}

              {stage === 'planning' && (
                <div className="col gap-3" style={{ minHeight: 260 }}>
                  <div className="col gap-2">
                    {stops.map((stop, index) => (
                      <button
                        key={`${stop.id}-${index}`}
                        type="button"
                        className="panel row gap-3"
                        onClick={() => setEditingStop(index)}
                        style={{ textAlign: 'left', border: 'none', width: '100%' }}
                      >
                        <span
                          className="dot"
                          style={{
                            background: index === 0 ? 'var(--c-positive)' : 'var(--c-text)',
                            borderRadius: index === stops.length - 1 && index > 0 ? 2 : '50%',
                          }}
                        />
                        <span className="t-small grow t-truncate">{stop.label}</span>
                        {stops.length > 2 && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setStops((c) => c.filter((_, i) => i !== index));
                            }}
                            onKeyDown={() => undefined}
                          >
                            <Icon name="x" size={14} color="var(--c-text-faint)" />
                          </span>
                        )}
                      </button>
                    ))}
                    <div className="row gap-2">
                      {appConfig.features.multiStop && stops.length < appConfig.limits.maxStopsPerTrip && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="plus"
                          onClick={() => setEditingStop(stops.length)}
                        >
                          Add stop
                        </Button>
                      )}
                      {stops.length >= 2 && (
                        <Button variant="primary" size="sm" className="grow" onClick={() => setStage('choosing')}>
                          See prices
                        </Button>
                      )}
                    </div>
                  </div>

                  {editingStop !== null && (
                    <PlaceSearch
                      label={editingStop === 0 ? 'Pickup location' : 'Where to?'}
                      autoFocus
                      origin={stops[0]?.at ?? rider?.savedPlaces[0].at}
                      onSelect={(place) => setStopAt(editingStop, place)}
                      onPickOnMap={() => {
                        setPickingOnMap(editingStop);
                        setEditingStop(null);
                      }}
                    />
                  )}
                </div>
              )}

              {stage === 'choosing' && (
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 520 }}>
                  <ProductPicker
                    stops={stops}
                    selection={selection}
                    onChange={setSelection}
                    onConfirm={confirmBooking}
                    onBack={() => setStage('planning')}
                  />
                </div>
              )}

              {stage === 'tracking' && activeTrip && (
                <TripTracker trip={activeTrip} onDone={resetFlow} />
              )}
            </Sheet>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <ActivityScreen onOpen={(id) => setDetailTripId(id)} />
      )}

      {tab === 'account' && <AccountScreen />}

      {detailTrip && (
        <Modal title={`Trip ${detailTrip.code}`} onClose={() => setDetailTripId(undefined)}>
          <div className="col gap-4">
            <StopList job={detailTrip} />
            <FareBreakdown quote={detailTrip.settlement ?? detailTrip.quote} title="Receipt" />
            <div>
              <span className="t-caps">Timeline</span>
              <div style={{ marginTop: 'var(--s-2)' }}>
                <JobTimeline job={detailTrip} now={state.now} />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </DeviceFrame>
  );
}

/* ------------------------------ Idle sheet ------------------------------- */

function IdleSheet({ onStart, onPickSaved }: { onStart: () => void; onPickSaved: (place: Place) => void }) {
  const state = useWorld((s) => s.state);
  const rider = useCurrentRider();
  if (!rider) return null;

  const recent = Object.values(state.trips)
    .filter((t) => t.riderId === rider.id && t.status === 'completed')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 3);

  return (
    <div className="col gap-3">
      <button
        type="button"
        className="row gap-3"
        onClick={onStart}
        style={{
          background: 'var(--c-bg-sunken)',
          border: 'none',
          borderRadius: 'var(--r-md)',
          padding: 'var(--s-3) var(--s-4)',
          height: 52,
        }}
      >
        <Icon name="search" size={18} />
        <span className="t-heading grow" style={{ textAlign: 'left' }}>
          Where to?
        </span>
        <span className="chip">
          <Icon name="clock" size={13} />
          Now
        </span>
      </button>

      <div className="scroll-x">
        {rider.savedPlaces.map((place) => (
          <button key={place.id} type="button" className="pill-filter" onClick={() => onPickSaved(place)}>
            <Icon name={place.icon} size={14} />
            {place.label}
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="col">
          {recent.map((trip) => {
            const destination = trip.stops[trip.stops.length - 1].place;
            return (
              <ListRow
                key={trip.id}
                icon="history"
                title={destination.label}
                subtitle={destination.addressLine}
                onClick={() => onPickSaved(destination)}
                trailing={<Icon name="chevron" size={15} color="var(--c-text-faint)" />}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Activity -------------------------------- */

function ActivityScreen({ onOpen }: { onOpen: (id: ID) => void }) {
  const state = useWorld((s) => s.state);
  const rider = useCurrentRider();
  const [filter, setFilter] = useState<'all' | 'rides' | 'orders'>('all');

  const trips = Object.values(state.trips)
    .filter((t) => t.riderId === rider?.id)
    .sort((a, b) => (b.completedAt ?? b.requestedAt) - (a.completedAt ?? a.requestedAt));
  const orders = Object.values(state.orders)
    .filter((o) => o.customerId === rider?.id)
    .sort((a, b) => (b.deliveredAt ?? b.placedAt) - (a.deliveredAt ?? a.placedAt));

  const items = filter === 'rides' ? trips : filter === 'orders' ? orders : [...trips, ...orders].sort(
    (a, b) =>
      (b.kind === 'trip' ? (b.completedAt ?? b.requestedAt) : (b.deliveredAt ?? b.placedAt)) -
      (a.kind === 'trip' ? (a.completedAt ?? a.requestedAt) : (a.deliveredAt ?? a.placedAt)),
  );

  const spend = items
    .filter((j) => j.status === 'completed' || j.status === 'delivered')
    .reduce((acc, j) => acc + (j.settlement ?? j.quote).total, 0);

  return (
    <div className="col" style={{ height: '100%' }}>
      <ScreenHeader title="Activity" subtitle={`${plural(items.length, 'record')} · ${moneyCompact(spend)} lifetime`} />
      <div className="row gap-2" style={{ padding: 'var(--s-3) var(--s-4)' }}>
        {(['all', 'rides', 'orders'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="pill-filter"
            data-active={filter === option}
            onClick={() => setFilter(option)}
            style={{ textTransform: 'capitalize' }}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="col grow" style={{ overflowY: 'auto' }}>
        {items.length === 0 ? (
          <Empty icon="history" title="Nothing here yet" hint="Your rides and orders will appear here." />
        ) : (
          items.map((job) => (
            <JobSummaryRow
              key={job.id}
              job={job}
              onClick={job.kind === 'trip' ? () => onOpen(job.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Account -------------------------------- */

function AccountScreen() {
  const state = useWorld((s) => s.state);
  const rider = useCurrentRider();
  const act = useAction();
  const setSessionRider = useWorld((s) => s.setSessionRider);
  const [switching, setSwitching] = useState(false);

  if (!rider) return null;
  const org = rider.orgMembership ? state.orgs[rider.orgMembership.orgId] : undefined;
  const methods = paymentMethods.filter((m) => rider.paymentMethodIds.includes(m.id));

  return (
    <div className="col" style={{ height: '100%' }}>
      <ScreenHeader
        title="Account"
        action={
          <Button variant="ghost" size="sm" icon="users" onClick={() => setSwitching(true)}>
            Switch
          </Button>
        }
      />
      <div className="col grow gap-4" style={{ overflowY: 'auto', padding: 'var(--s-4)' }}>
        <PersonRow
          name={`${rider.firstName} ${rider.lastName}`}
          hue={rider.avatarHue}
          rating={rider.rating}
          size={56}
          subtitle={`${rider.lifetimeTrips} trips · ${rider.lifetimeOrders} orders`}
        />

        <Card title="Saved places" pad={false}>
          {rider.savedPlaces.map((place) => (
            <ListRow key={place.id} icon={place.icon} title={place.label} subtitle={place.addressLine} />
          ))}
        </Card>

        <Card title="Payment" pad={false}>
          {methods.map((method) => (
            <ListRow
              key={method.id}
              icon={method.icon}
              title={method.label}
              subtitle={method.id === rider.defaultPaymentMethodId ? 'Default' : undefined}
              onClick={() => act(riderActions.setDefaultPaymentMethod(rider.id, method.id), 'set payment')}
              trailing={
                method.id === rider.defaultPaymentMethodId ? (
                  <Icon name="check" size={16} color="var(--c-positive)" />
                ) : undefined
              }
            />
          ))}
          <ListRow
            icon="wallet"
            title="URUS Cash"
            subtitle="Wallet balance"
            trailing={<span className="t-body t-num">{money(rider.walletBalance)}</span>}
          />
        </Card>

        {org && (
          <Card title="Business profile">
            <div className="col gap-2">
              <div className="row spread">
                <span className="t-small t-muted">Organisation</span>
                <span className="t-small">{org.name}</span>
              </div>
              <div className="row spread">
                <span className="t-small t-muted">Role</span>
                <span className="t-small" style={{ textTransform: 'capitalize' }}>
                  {rider.orgMembership?.role}
                </span>
              </div>
              <div className="row spread">
                <span className="t-small t-muted">Department</span>
                <span className="t-small">{rider.orgMembership?.department}</span>
              </div>
              <div className="row spread">
                <span className="t-small t-muted">Policy rules</span>
                <span className="t-small">{org.policyRuleIds.length} active</span>
              </div>
            </div>
          </Card>
        )}

        <Card title="Promotions" pad={false}>
          {Object.entries(rider.promoRedemptions).length === 0 ? (
            <div style={{ padding: 'var(--s-4)' }}>
              <span className="t-small t-faint">No promotions redeemed yet.</span>
            </div>
          ) : (
            Object.entries(rider.promoRedemptions).map(([promoId, count]) => (
              <ListRow key={promoId} icon="gift" title={promoId} subtitle={`${count} redemption${count === 1 ? '' : 's'}`} />
            ))
          )}
        </Card>
      </div>

      {switching && (
        <Modal title="Switch rider" onClose={() => setSwitching(false)}>
          <div className="col" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {Object.values(state.riders)
              .filter((r) => r.marketId === state.marketId)
              .slice(0, 24)
              .map((candidate) => (
                <ListRow
                  key={candidate.id}
                  leading={<Avatar name={candidate.displayName} hue={candidate.avatarHue} />}
                  title={`${candidate.firstName} ${candidate.lastName}`}
                  subtitle={
                    candidate.orgMembership
                      ? `${state.orgs[candidate.orgMembership.orgId]?.name ?? 'Business'} · ${candidate.orgMembership.role}`
                      : `${candidate.lifetimeTrips} trips`
                  }
                  selected={candidate.id === rider.id}
                  onClick={() => {
                    setSessionRider(candidate.id);
                    setSwitching(false);
                  }}
                />
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* --------------------------------- Aside --------------------------------- */

/** Context panel beside the phone — makes the system legible while demoing. */
function RiderAside() {
  const state = useWorld((s) => s.state);
  const rider = useCurrentRider();
  const market = getMarket(state.marketId);
  if (!rider) return null;

  const liveTrip = Object.values(state.trips).find(
    (t) => t.riderId === rider.id && !['completed', 'cancelled'].includes(t.status),
  );
  const driver = liveTrip?.driverId ? state.drivers[liveTrip.driverId] : undefined;
  const offers = liveTrip ? Object.values(state.offers).filter((o) => o.jobId === liveTrip.id) : [];
  const nearbyOnline = Object.values(state.drivers).filter(
    (d) => d.marketId === state.marketId && d.status === 'online',
  );

  return (
    <>
      <Card title="What the marketplace is doing">
        <div className="col gap-3">
          <div className="row spread">
            <span className="t-small t-muted">Drivers online in {market.name}</span>
            <span className="t-small t-num">{nearbyOnline.length}</span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Nearest driver</span>
            <span className="t-small t-num">
              {nearbyOnline.length
                ? distance(
                    Math.min(...nearbyOnline.map((d) => haversineKm(rider.savedPlaces[0].at, d.at))),
                  )
                : '—'}
            </span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Zones surging</span>
            <span className="t-small t-num">
              {Object.values(state.zoneSnapshots).filter((z) => z.surgeMultiplier >= 1.15).length}
            </span>
          </div>
        </div>
      </Card>

      {liveTrip && (
        <Card title={`Dispatch · ${liveTrip.code}`} pad={false}>
          {offers.length === 0 ? (
            <div style={{ padding: 'var(--s-4)' }}>
              <span className="t-small t-faint">No offers sent yet.</span>
            </div>
          ) : (
            offers
              .sort((a, b) => b.score.total - a.score.total)
              .map((offer) => {
                const candidate = state.drivers[offer.driverId];
                return (
                  <ListRow
                    key={offer.id}
                    leading={<Avatar name={candidate?.displayName ?? '?'} hue={candidate?.avatarHue ?? 0} size={30} />}
                    title={candidate?.displayName ?? offer.driverId}
                    subtitle={`${offer.preview.approachMinutes} min away · score ${offer.score.total.toFixed(2)}`}
                    trailing={
                      <Chip
                        tone={
                          offer.status === 'accepted'
                            ? 'positive'
                            : offer.status === 'pending'
                              ? 'info'
                              : 'default'
                        }
                      >
                        {offer.status}
                      </Chip>
                    }
                  />
                );
              })
          )}
        </Card>
      )}

      {driver && (
        <Card title="Matched driver">
          <div className="col gap-3">
            <PersonRow
              name={driver.displayName}
              hue={driver.avatarHue}
              rating={driver.rating}
              subtitle={<VehicleBadge classId={driver.vehicle.classId} plate={driver.vehicle.plate} />}
            />
            <div className="row spread">
              <span className="t-small t-muted">Acceptance rate</span>
              <span className="t-small t-num">{Math.round(driver.acceptanceRate * 100)}%</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Speed</span>
              <span className="t-small t-num">{Math.round(driver.speedKph)} km/h</span>
            </div>
          </div>
        </Card>
      )}

      <Card title="Booking policy">
        <div className="col gap-2">
          <Switch checked={appConfig.features.surgePricing} onChange={() => undefined} label="Surge pricing" disabled />
          <Switch checked={appConfig.features.scheduledRides} onChange={() => undefined} label="Scheduled rides" disabled />
          <Switch checked={appConfig.features.multiStop} onChange={() => undefined} label="Multi-stop trips" disabled />
          <span className="t-micro t-faint">
            Flags come from config/app.config.ts. {orgConfig.policyRules.length} enterprise policy rules are defined.
          </span>
        </div>
      </Card>
    </>
  );
}
