/**
 * Driver surface — the earner product, covering both rides and deliveries.
 *
 * Going online here puts this driver into the same dispatch pool the rider and
 * eats surfaces are matching against. Offers arriving on this screen are real
 * offers for real jobs somebody placed.
 */
import { useMemo, useState } from 'react';
import {
  appConfig,
  driverTiers,
  getMarket,
  getProductsForMarket,
  onboardingRequirements,
  payoutConfig,
} from '@config';
import { polygonCentroid } from '@core/geo';
import type { DispatchOffer, Order, Trip } from '@core/types';
import { day, distance, duration, money, moneyCompact, percent, relative } from '@platform/format';
import { useAction, useCurrentDriver, useTicker } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as driverActions from '@platform/actions/driver';
import { useSurfaceAccent } from '@platform/theme';
import { DeviceFrame, ScreenHeader } from '@app/DeviceFrame';
import { Map, type MapMarker, type MapRoute, type MapZoneOverlay } from '@ui/Map';
import { Icon } from '@ui/Icon';
import { Avatar, Button, Card, Chip, Empty, ListRow, Meter, Modal, Sheet, Switch } from '@ui/primitives';
import { JobSummaryRow, LedgerRow, StatusBadge, VehicleBadge } from '@ui/components';
import { OfferCard } from './OfferCard';
import { ActiveJob } from './ActiveJob';

type Tab = 'drive' | 'earnings' | 'opportunities' | 'account';

export function DriverSurface() {
  useSurfaceAccent('driver');
  const state = useWorld((s) => s.state);
  const driver = useCurrentDriver();
  const act = useAction();
  useTicker(1000); // keeps offer countdowns honest between world ticks

  const [tab, setTab] = useState<Tab>('drive');

  const offers = useMemo(
    () =>
      Object.values(state.offers)
        .filter((o) => o.driverId === driver?.id && o.status === 'pending' && o.expiresAt > state.now)
        .sort((a, b) => a.expiresAt - b.expiresAt),
    [state.offers, driver?.id, state.now],
  );

  const activeJob = driver?.activeJobId ? (state.trips[driver.activeJobId] ?? state.orders[driver.activeJobId]) : undefined;

  const tabs = [
    { id: 'drive', label: 'Drive', icon: 'wheel', badge: offers.length },
    { id: 'earnings', label: 'Earnings', icon: 'wallet' },
    { id: 'opportunities', label: 'Nearby', icon: 'activity' },
    { id: 'account', label: 'Account', icon: 'settings' },
  ];

  if (!driver) return <Empty title="No earner selected" />;

  return (
    <DeviceFrame tabs={tabs} activeTab={tab} onTabChange={(id) => setTab(id as Tab)} aside={<DriverAside />}>
      {tab === 'drive' && (
        <DriveScreen driver={driver} offers={offers} activeJob={activeJob} onAct={act} />
      )}
      {tab === 'earnings' && <EarningsScreen />}
      {tab === 'opportunities' && <OpportunitiesScreen />}
      {tab === 'account' && <AccountScreen />}
    </DeviceFrame>
  );
}

/* --------------------------------- Drive -------------------------------- */

function DriveScreen({
  driver,
  offers,
  activeJob,
  onAct,
}: {
  driver: NonNullable<ReturnType<typeof useCurrentDriver>>;
  offers: DispatchOffer[];
  activeJob: Trip | Order | undefined;
  onAct: ReturnType<typeof useAction>;
}) {
  const state = useWorld((s) => s.state);
  const online = driver.status !== 'offline';
  const topOffer = offers[0];

  const { markers, routes, fitTo } = useMemo(() => {
    const markers: MapMarker[] = [
      {
        id: driver.id,
        at: driver.at,
        kind: 'vehicle',
        heading: driver.heading,
        emphasis: true,
        color: 'var(--accent-driver, #7a4bd6)',
      },
    ];
    const routes: MapRoute[] = [];
    const fitTo = [driver.at];

    if (activeJob) {
      activeJob.stops.forEach((stop, index) => {
        markers.push({
          id: stop.id,
          at: stop.place.at,
          kind: stop.kind === 'merchant' ? 'merchant' : index === 0 ? 'pickup' : 'dropoff',
          label: stop.place.label,
        });
        fitTo.push(stop.place.at);
      });
    } else if (topOffer) {
      const job = state.trips[topOffer.jobId] ?? state.orders[topOffer.jobId];
      job?.stops.forEach((stop, index) => {
        markers.push({
          id: stop.id,
          at: stop.place.at,
          kind: stop.kind === 'merchant' ? 'merchant' : index === 0 ? 'pickup' : 'dropoff',
          label: stop.place.label,
        });
        fitTo.push(stop.place.at);
      });
      if (job?.route) routes.push({ id: 'offer-route', route: job.route, variant: 'ghost' });
    }

    if (driver.activeRoute) {
      routes.push({
        id: 'driver-route',
        route: driver.activeRoute,
        variant: activeJob && ['in_progress', 'delivering', 'picked_up'].includes(activeJob.status) ? 'active' : 'planned',
      });
    }

    return { markers, routes, fitTo };
  }, [driver, activeJob, topOffer, state.trips, state.orders]);

  return (
    <div className="col" style={{ height: '100%', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Map marketId={state.marketId} markers={markers} routes={routes} fitTo={fitTo} follow={driver.at} />
      </div>

      {/* Online pill */}
      <div
        className="row center"
        style={{ position: 'absolute', top: 42, left: 0, right: 0, zIndex: 10 }}
      >
        <button
          type="button"
          className="row gap-2"
          onClick={() =>
            onAct(online ? driverActions.goOffline(driver.id) : driverActions.goOnline(driver.id), 'toggle online')
          }
          style={{
            padding: '0 var(--s-4)',
            height: 38,
            borderRadius: 'var(--r-pill)',
            border: 'none',
            background: online ? 'var(--c-positive)' : 'var(--c-surface)',
            color: online ? '#fff' : 'var(--c-text)',
            fontWeight: 620,
            fontSize: 13.5,
            boxShadow: '0 4px 14px rgb(0 0 0 / 0.18)',
          }}
        >
          <span className={`dot ${online ? 'pulse' : ''}`} style={{ background: online ? '#fff' : 'var(--c-text-faint)' }} />
          {driver.status === 'paused' ? 'Going offline after this job' : online ? "You're online" : "You're offline"}
        </button>
      </div>

      <div style={{ marginTop: 'auto', zIndex: 5, maxHeight: '80%' }}>
        <Sheet grip={false}>
          {topOffer ? (
            <OfferCard
              offer={topOffer}
              now={state.now}
              onAccept={() => onAct(driverActions.acceptOffer(topOffer.id), 'accept offer')}
              onDecline={() => onAct(driverActions.declineOffer(topOffer.id), 'decline offer')}
            />
          ) : activeJob ? (
            <ActiveJob driver={driver} job={activeJob} />
          ) : (
            <IdleSheet driver={driver} online={online} />
          )}
        </Sheet>
      </div>
    </div>
  );
}

function IdleSheet({
  driver,
  online,
}: {
  driver: NonNullable<ReturnType<typeof useCurrentDriver>>;
  online: boolean;
}) {
  const state = useWorld((s) => s.state);
  const progress = driverActions.incentiveProgress(state, driver.id);
  const openDemand = Object.values(state.zoneSnapshots).reduce((acc, z) => acc + z.openRequests, 0);

  return (
    <div className="col gap-4">
      <div className="row spread">
        <span className="col" style={{ gap: 1 }}>
          <span className="t-caps">This session</span>
          <span className="t-display t-num">{money(driver.session.earnings)}</span>
        </span>
        <span className="col" style={{ alignItems: 'flex-end', gap: 1 }}>
          <span className="t-small t-num">{driver.session.jobs} jobs</span>
          <span className="t-micro t-faint">{duration(driver.session.onlineSec / 60)} online</span>
        </span>
      </div>

      {!online ? (
        <div className="panel col gap-2">
          <span className="t-small">You're offline. Go online to start receiving offers.</span>
          <span className="t-micro t-faint">
            {openDemand} open request{openDemand === 1 ? '' : 's'} in {getMarket(state.marketId).name} right now.
          </span>
        </div>
      ) : (
        <div className="panel row gap-3">
          <span className="dot pulse" style={{ background: 'var(--c-positive)' }} />
          <span className="col grow" style={{ gap: 1 }}>
            <span className="t-small" style={{ fontWeight: 540 }}>
              Waiting for offers
            </span>
            <span className="t-micro t-faint">
              {distance(driver.session.distanceKm)} driven · {openDemand} open requests nearby
            </span>
          </span>
        </div>
      )}

      {appConfig.features.driverQuests && progress.length > 0 && (
        <div className="col gap-3">
          <span className="t-caps">Promotions</span>
          {progress.slice(0, 3).map((entry) => (
            <div key={entry.quest.id} className="col gap-2">
              <div className="row spread">
                <span className="t-small" style={{ fontWeight: 540, opacity: entry.active ? 1 : 0.55 }}>
                  {entry.quest.label}
                </span>
                <span className="t-small t-num">
                  {entry.quest.kind === 'boost' ? `${entry.quest.target}x` : `${entry.progress}/${entry.target}`}
                </span>
              </div>
              <Meter value={entry.ratio} tone={entry.complete ? 'var(--c-positive)' : undefined} />
              <span className="t-micro t-faint">
                {entry.quest.description}
                {entry.quest.reward > 0 ? ` · ${money(entry.quest.reward)} bonus` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="row gap-2">
        <span className="chip chip-outline">
          <Icon name="star" size={13} filled color="#f0a91b" />
          {driver.rating.toFixed(2)}
        </span>
        <span className="chip chip-outline">{percent(driver.acceptanceRate)} acceptance</span>
        <span className="chip chip-outline">{percent(driver.completionRate)} completion</span>
      </div>
    </div>
  );
}

/* -------------------------------- Earnings ------------------------------- */

function EarningsScreen() {
  const state = useWorld((s) => s.state);
  const driver = useCurrentDriver();
  const act = useAction();
  const [cashOut, setCashOut] = useState(false);
  if (!driver) return null;

  const entries = state.ledger.filter((e) => e.accountId === driver.id).sort((a, b) => b.at - a.at);
  const dayStart = new Date(state.now);
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = state.now - 7 * 86_400_000;

  const sumSince = (since: number) =>
    entries.filter((e) => e.at >= since && e.amount > 0).reduce((acc, e) => acc + e.amount, 0);

  const today = sumSince(dayStart.getTime());
  const week = sumSince(weekStart);
  const tips = entries.filter((e) => e.kind === 'tip' && e.at >= weekStart).reduce((acc, e) => acc + e.amount, 0);

  const completed = [
    ...Object.values(state.trips).filter((t) => t.driverId === driver.id && t.status === 'completed'),
    ...Object.values(state.orders).filter((o) => o.courierId === driver.id && o.status === 'delivered'),
  ].sort(
    (a, b) =>
      (b.kind === 'trip' ? (b.completedAt ?? 0) : (b.deliveredAt ?? 0)) -
      (a.kind === 'trip' ? (a.completedAt ?? 0) : (a.deliveredAt ?? 0)),
  );

  // Daily bars for the last week, computed from the ledger itself.
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(state.now - (6 - i) * 86_400_000);
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + 86_400_000;
    const amount = entries
      .filter((e) => e.at >= start.getTime() && e.at < end && e.amount > 0)
      .reduce((acc, e) => acc + e.amount, 0);
    return { label: day(start.getTime()), amount };
  });
  const peak = Math.max(1, ...days.map((d) => d.amount));

  return (
    <div className="col" style={{ height: '100%' }}>
      <ScreenHeader title="Earnings" subtitle={`${driver.lifetime.jobs.toLocaleString()} lifetime jobs`} />
      <div className="col grow gap-4" style={{ overflowY: 'auto', padding: 'var(--s-4)' }}>
        <div className="col gap-1">
          <span className="t-caps">This week</span>
          <span className="t-display t-num">{money(week)}</span>
          <span className="t-small t-muted">
            {money(today)} today · {money(tips)} in tips
          </span>
        </div>

        <div className="card card-pad col gap-3">
          <span className="t-caps">Daily</span>
          <div className="row" style={{ gap: 6, alignItems: 'flex-end', height: 96 }}>
            {days.map((entry) => (
              <div key={entry.label} className="col grow gap-1" style={{ alignItems: 'center' }}>
                <div
                  style={{
                    width: '100%',
                    height: `${Math.max(3, (entry.amount / peak) * 76)}px`,
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--accent-surface, var(--c-info))',
                    opacity: entry.amount === 0 ? 0.2 : 1,
                  }}
                />
                <span className="t-micro t-faint">{entry.label.split(' ')[1] ?? entry.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-pad col gap-3">
          <div className="row spread">
            <span className="t-caps">Balance</span>
            <Chip tone="outline">{payoutConfig.schedule} payouts</Chip>
          </div>
          <span className="t-title t-num">{money(driver.session.earnings)}</span>
          <span className="t-micro t-faint">
            Instant cash out costs {money(payoutConfig.instantPayout.feeFlat)} · minimum{' '}
            {money(payoutConfig.instantPayout.minAmount)}
          </span>
          <Button
            variant="primary"
            block
            disabled={driver.session.earnings < payoutConfig.instantPayout.minAmount}
            onClick={() => setCashOut(true)}
          >
            Cash out now
          </Button>
        </div>

        <Card title="Recent jobs" pad={false}>
          {completed.length === 0 ? (
            <Empty icon="receipt" title="No completed jobs yet" />
          ) : (
            completed.slice(0, 12).map((job) => <JobSummaryRow key={job.id} job={job} showAmount={false} />)
          )}
        </Card>

        <Card title="Statement">
          <div className="col">
            {entries.slice(0, 20).map((entry) => (
              <LedgerRow
                key={entry.id}
                label={entry.label}
                amount={entry.amount}
                at={entry.at}
                sublabel={entry.jobCode}
              />
            ))}
          </div>
        </Card>
      </div>

      {cashOut && (
        <Modal title="Cash out" onClose={() => setCashOut(false)}>
          <div className="col gap-3">
            <div className="row spread">
              <span className="t-small t-muted">Amount</span>
              <span className="t-body t-num">{money(driver.session.earnings)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Instant payout fee</span>
              <span className="t-body t-num">−{money(payoutConfig.instantPayout.feeFlat)}</span>
            </div>
            <hr className="divider" />
            <div className="row spread">
              <strong className="t-body">You receive</strong>
              <strong className="t-heading t-num">
                {money(driver.session.earnings - payoutConfig.instantPayout.feeFlat)}
              </strong>
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              onClick={() => {
                act(driverActions.cashOut(driver.id, driver.session.earnings), 'cash out');
                setCashOut(false);
              }}
            >
              Confirm cash out
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ----------------------------- Opportunities ----------------------------- */

function OpportunitiesScreen() {
  const state = useWorld((s) => s.state);
  const driver = useCurrentDriver();
  const act = useAction();
  const market = getMarket(state.marketId);
  if (!driver) return null;

  const zones = market.zones.map((zone) => ({
    zone,
    snapshot: state.zoneSnapshots[zone.id],
    centre: polygonCentroid(zone.polygon),
  }));

  const overlays: MapZoneOverlay[] = zones.map(({ zone, snapshot }) => ({
    id: zone.id,
    polygon: zone.polygon,
    intensity: Math.min(1, ((snapshot?.surgeMultiplier ?? 1) - 1) / 1.5),
    label: zone.name,
  }));

  return (
    <div className="col" style={{ height: '100%' }}>
      <ScreenHeader title="Where to drive" subtitle="Demand and surge by zone" />
      <div style={{ height: 250, flex: 'none' }}>
        <Map
          marketId={state.marketId}
          zones={overlays}
          markers={[{ id: driver.id, at: driver.at, kind: 'vehicle', heading: driver.heading, emphasis: true }]}
          showLegend={
            <>
              <span className="row gap-2">
                <span className="dot" style={{ background: 'color-mix(in srgb, var(--c-danger) 55%, transparent)' }} />
                Higher demand
              </span>
              <span className="t-faint">Surge updates every tick</span>
            </>
          }
        />
      </div>
      <div className="col grow" style={{ overflowY: 'auto' }}>
        {zones
          .sort((a, b) => (b.snapshot?.surgeMultiplier ?? 1) - (a.snapshot?.surgeMultiplier ?? 1))
          .map(({ zone, snapshot, centre }) => (
            <ListRow
              key={zone.id}
              icon="target"
              title={zone.name}
              subtitle={`${snapshot?.openRequests ?? 0} open · ${snapshot?.availableDrivers ?? 0} drivers`}
              trailing={
                <div className="row gap-2">
                  <Chip tone={(snapshot?.surgeMultiplier ?? 1) >= 1.15 ? 'warning' : 'outline'}>
                    {(snapshot?.surgeMultiplier ?? 1).toFixed(1)}x
                  </Chip>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="navigation"
                    aria-label={`Navigate to ${zone.name}`}
                    onClick={() => act(driverActions.navigateTo(driver.id, centre), 'navigate to zone')}
                  />
                </div>
              }
            />
          ))}
      </div>
    </div>
  );
}

/* -------------------------------- Account -------------------------------- */

function AccountScreen() {
  const state = useWorld((s) => s.state);
  const driver = useCurrentDriver();
  const act = useAction();
  const setSessionDriver = useWorld((s) => s.setSessionDriver);
  const [switching, setSwitching] = useState(false);
  if (!driver) return null;

  const tier = driverTiers.find((t) => t.id === driver.tierId) ?? driverTiers[0];
  const tierState = driverActions.tierProgress(state, driver.id);
  const available = driverActions.availableProductsFor(state, driver.id);

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
        <div className="row gap-3">
          <Avatar name={driver.displayName} hue={driver.avatarHue} size={56} />
          <div className="col grow" style={{ gap: 2 }}>
            <span className="t-heading">
              {driver.firstName} {driver.lastName}
            </span>
            <span className="row gap-2 t-small t-muted">
              <Icon name="star" size={13} filled color="#f0a91b" />
              {driver.rating.toFixed(2)} · {driver.ratingCount.toLocaleString()} ratings
            </span>
            <Chip style={{ background: `color-mix(in srgb, ${tier.color} 22%, transparent)`, color: tier.color }}>
              {tier.label}
            </Chip>
          </div>
        </div>

        {tierState?.next && (
          <Card title={`${tierState.next.label} progress`}>
            <div className="col gap-2">
              <Meter value={tierState.ratio} tone={tierState.next.color} />
              <span className="t-micro t-faint">
                {tierState.points.toLocaleString()} / {tierState.next.pointsRequired.toLocaleString()} points ·{' '}
                {tierState.next.perks.join(', ')}
              </span>
            </div>
          </Card>
        )}

        <Card title="Vehicle">
          <div className="col gap-2">
            <VehicleBadge classId={driver.vehicle.classId} plate={driver.vehicle.plate} color={driver.vehicle.color} />
            <span className="t-small t-muted">
              {driver.vehicle.year} {driver.vehicle.make} {driver.vehicle.model} · {driver.vehicle.seats} seats
            </span>
          </div>
        </Card>

        <Card title="What you drive" pad={false}>
          {available.map((product) => (
            <ListRow
              key={product.id}
              icon={product.icon}
              title={product.name}
              subtitle={product.description}
              trailing={
                <Switch
                  checked={driver.optedProductIds.includes(product.id)}
                  onChange={() => act(driverActions.toggleProductOptIn(driver.id, product.id), 'toggle product')}
                />
              }
            />
          ))}
          {available.length === 0 && (
            <div style={{ padding: 'var(--s-4)' }}>
              <span className="t-small t-faint">This vehicle is not eligible for any product in this market.</span>
            </div>
          )}
        </Card>

        <Card title="Documents" pad={false}>
          {driver.documents.map((document) => {
            const requirement = onboardingRequirements.find((r) => r.id === document.requirementId);
            const tone =
              document.status === 'valid'
                ? 'positive'
                : document.status === 'expiring'
                  ? 'warning'
                  : document.status === 'expired'
                    ? 'danger'
                    : 'outline';
            return (
              <ListRow
                key={document.requirementId}
                icon={document.status === 'valid' ? 'check' : 'alert'}
                iconColor={document.status === 'valid' ? 'var(--c-positive)' : 'var(--c-warning)'}
                title={requirement?.label ?? document.requirementId}
                subtitle={
                  document.expiresAt
                    ? `Expires ${relative(document.expiresAt, state.now)}`
                    : requirement?.description
                }
                trailing={<Chip tone={tone as 'positive'}>{document.status}</Chip>}
              />
            );
          })}
        </Card>

        <Card title="Performance">
          <div className="col gap-2">
            <div className="row spread">
              <span className="t-small t-muted">Acceptance rate</span>
              <span className="t-small t-num">{percent(driver.acceptanceRate)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Cancellation rate</span>
              <span className="t-small t-num">{percent(driver.cancellationRate)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Completion rate</span>
              <span className="t-small t-num">{percent(driver.completionRate)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Lifetime distance</span>
              <span className="t-small t-num">{distance(driver.lifetime.distanceKm)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Lifetime earnings</span>
              <span className="t-small t-num">{moneyCompact(driver.lifetime.earnings)}</span>
            </div>
          </div>
        </Card>
      </div>

      {switching && (
        <Modal title="Switch earner" onClose={() => setSwitching(false)}>
          <div className="col" style={{ maxHeight: 440, overflowY: 'auto' }}>
            {Object.values(state.drivers)
              .filter((d) => d.marketId === state.marketId)
              .sort((a, b) => Number(Boolean(b.activeJobId)) - Number(Boolean(a.activeJobId)))
              .slice(0, 30)
              .map((candidate) => (
                <ListRow
                  key={candidate.id}
                  leading={<Avatar name={candidate.displayName} hue={candidate.avatarHue} />}
                  title={candidate.displayName}
                  subtitle={`${candidate.status}${candidate.activeJobId ? ' · on a job' : ''} · ${candidate.optedProductIds.length} products`}
                  selected={candidate.id === driver.id}
                  onClick={() => {
                    setSessionDriver(candidate.id);
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

function DriverAside() {
  const state = useWorld((s) => s.state);
  const driver = useCurrentDriver();
  if (!driver) return null;

  const myOffers = Object.values(state.offers)
    .filter((o) => o.driverId === driver.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);

  const activeJob = driver.activeJobId ? (state.trips[driver.activeJobId] ?? state.orders[driver.activeJobId]) : undefined;
  const eligibleProducts = getProductsForMarket(state.marketId).filter((p) =>
    driver.optedProductIds.includes(p.id),
  );

  return (
    <>
      <Card title="Why this earner gets offers">
        <div className="col gap-3">
          <span className="t-small t-muted">
            Dispatch scores every eligible earner on proximity, rating, idle time, acceptance rate and fairness, then
            offers the top few at once — first to accept wins.
          </span>
          <div className="row wrap gap-2">
            {eligibleProducts.map((product) => (
              <Chip key={product.id} tone="outline" icon={product.icon}>
                {product.shortName}
              </Chip>
            ))}
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Vehicle class</span>
            <span className="t-small">{driver.vehicle.classId}</span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Certifications</span>
            <span className="t-small">{driver.tags.length || 'none'}</span>
          </div>
        </div>
      </Card>

      {activeJob && (
        <Card title="Job the rider sees">
          <div className="col gap-2">
            <StatusBadge job={activeJob} />
            <div className="row spread">
              <span className="t-small t-muted">Fare to the customer</span>
              <span className="t-small t-num">{money((activeJob.settlement ?? activeJob.quote).total)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Your payout</span>
              <span className="t-small t-num">{money((activeJob.settlement ?? activeJob.quote).earnerPayout)}</span>
            </div>
            <div className="row spread">
              <span className="t-small t-muted">Platform revenue</span>
              <span className="t-small t-num">{money((activeJob.settlement ?? activeJob.quote).platformRevenue)}</span>
            </div>
          </div>
        </Card>
      )}

      <Card title="Offer history" pad={false}>
        {myOffers.length === 0 ? (
          <div style={{ padding: 'var(--s-4)' }}>
            <span className="t-small t-faint">No offers yet. Go online to start receiving them.</span>
          </div>
        ) : (
          myOffers.map((offer) => (
            <ListRow
              key={offer.id}
              icon={offer.jobKind === 'order' ? 'bag' : 'car'}
              title={`${offer.preview.productName} · ${money(offer.preview.payout)}`}
              subtitle={`${offer.preview.pickupLabel} → ${offer.preview.dropoffLabel}`}
              trailing={
                <Chip
                  tone={
                    offer.status === 'accepted'
                      ? 'positive'
                      : offer.status === 'pending'
                        ? 'info'
                        : offer.status === 'declined'
                          ? 'danger'
                          : 'outline'
                  }
                >
                  {offer.status}
                </Chip>
              }
            />
          ))
        )}
      </Card>
    </>
  );
}
