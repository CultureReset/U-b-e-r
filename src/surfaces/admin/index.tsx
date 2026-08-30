/**
 * Ops surface — the internal marketplace console.
 *
 * This is where the prototype explains itself: a live map of every vehicle and
 * job, the marketplace's health metrics, a dispatch inspector that shows why
 * each earner did or did not receive an offer, the raw event log, and a
 * read-only view of the configuration everything else derives from.
 */
import { useMemo, useState } from 'react';
import {
  appConfig,
  brandConfig,
  catalogConfig,
  driverPayConfig,
  feeConfigs,
  getMarket,
  getProduct,
  orgConfig,
  paymentMethods,
  platformConfig,
  productConfigs,
  promotions,
  rateCards,
  seedConfig,
  surgeConfig,
  vehicleClasses,
} from '@config';
import { eventLabels } from '@core/events';
import type { ID, Order, Trip } from '@core/types';
import { clock, dayTime, distance, money, moneyCompact, percent, relative } from '@platform/format';
import { useAction, useEventLog } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as adminActions from '@platform/actions/admin';
import { useSurfaceAccent } from '@platform/theme';
import { ConsoleLayout } from '@app/ConsoleLayout';
import { Map as MapView, type MapMarker, type MapRoute, type MapZoneOverlay } from '@ui/Map';
import { Icon } from '@ui/Icon';
import { Avatar, Button, Card, Chip, Empty, ListRow, Meter, Metric, Modal, Segmented } from '@ui/primitives';
import { FareBreakdown, JobTimeline, StatusBadge, StopList } from '@ui/components';

type Section = 'live' | 'dispatch' | 'supply' | 'demand' | 'finance' | 'events' | 'config';

export function AdminSurface() {
  useSurfaceAccent('admin');
  const state = useWorld((s) => s.state);
  const [section, setSection] = useState<Section>('live');
  const snapshot = useMemo(() => adminActions.marketplaceSnapshot(state), [state]);

  const sections = [
    {
      group: 'Marketplace',
      items: [
        { id: 'live', label: 'Live map', icon: 'layers' },
        { id: 'dispatch', label: 'Dispatch', icon: 'route', badge: snapshot.openTrips + snapshot.openOrders },
        { id: 'supply', label: 'Supply', icon: 'wheel' },
        { id: 'demand', label: 'Demand', icon: 'activity' },
      ],
    },
    {
      group: 'Platform',
      items: [
        { id: 'finance', label: 'Finance', icon: 'chart' },
        { id: 'events', label: 'Event log', icon: 'history' },
        { id: 'config', label: 'Configuration', icon: 'settings' },
      ],
    },
  ];

  return (
    <ConsoleLayout
      sections={sections}
      active={section}
      onChange={(id) => setSection(id as Section)}
      flush={section === 'live'}
      brand={
        <div className="row gap-3" style={{ padding: 'var(--s-2)' }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--r-md)',
              background: 'var(--c-danger)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon name="grid" size={17} />
          </span>
          <span className="col grow" style={{ gap: 1 }}>
            <span className="t-body" style={{ fontWeight: 620 }}>
              Operations
            </span>
            <span className="t-micro t-faint">{getMarket(state.marketId).name}</span>
          </span>
        </div>
      }
      title={SECTION_TITLES[section]}
      subtitle={`${snapshot.onlineDrivers} online · ${snapshot.activeTrips + snapshot.activeOrders} jobs in flight · ${percent(snapshot.utilisation)} utilisation`}
      actions={<SupplyLevers />}
      footer={
        <div className="col gap-2" style={{ padding: 'var(--s-2)' }}>
          <div className="row spread">
            <span className="t-micro t-faint">Gross bookings today</span>
            <span className="t-small t-num">{moneyCompact(snapshot.grossBookings)}</span>
          </div>
          <div className="row spread">
            <span className="t-micro t-faint">Avg surge</span>
            <span className="t-small t-num">{snapshot.averageSurge.toFixed(2)}x</span>
          </div>
        </div>
      }
    >
      {section === 'live' && <LiveSection />}
      {section === 'dispatch' && <DispatchSection />}
      {section === 'supply' && <SupplySection />}
      {section === 'demand' && <DemandSection />}
      {section === 'finance' && <FinanceSection snapshot={snapshot} />}
      {section === 'events' && <EventSection />}
      {section === 'config' && <ConfigSection />}
    </ConsoleLayout>
  );
}

const SECTION_TITLES: Record<Section, string> = {
  live: 'Live map',
  dispatch: 'Dispatch inspector',
  supply: 'Supply',
  demand: 'Demand & surge',
  finance: 'Finance',
  events: 'Event log',
  config: 'Configuration',
};

/* ----------------------------- Supply levers ----------------------------- */

function SupplyLevers() {
  const act = useAction();
  return (
    <>
      <Button variant="ghost" size="sm" icon="minus" onClick={() => act(adminActions.adjustSupply(-10), 'reduce supply')}>
        10 offline
      </Button>
      <Button variant="ghost" size="sm" icon="plus" onClick={() => act(adminActions.adjustSupply(10), 'add supply')}>
        10 online
      </Button>
    </>
  );
}

/* --------------------------------- Live ---------------------------------- */

function LiveSection() {
  const state = useWorld((s) => s.state);
  const [layer, setLayer] = useState<'all' | 'rides' | 'deliveries'>('all');
  const [showHeat, setShowHeat] = useState(true);
  const [selected, setSelected] = useState<ID | undefined>();

  const market = getMarket(state.marketId);
  const jobs = adminActions.liveJobs(state);
  const filtered = jobs.filter((job) =>
    layer === 'all' ? true : layer === 'rides' ? job.kind === 'trip' : job.kind === 'order',
  );

  const { markers, routes } = useMemo(() => {
    const markers: MapMarker[] = [];
    const routes: MapRoute[] = [];

    for (const driver of Object.values(state.drivers)) {
      if (driver.marketId !== state.marketId || driver.status === 'offline') continue;
      const busy = Boolean(driver.activeJobId);
      markers.push({
        id: driver.id,
        at: driver.at,
        kind: 'vehicle',
        heading: driver.heading,
        color: busy ? 'var(--c-info)' : 'var(--c-positive)',
        emphasis: driver.activeJobId === selected,
        onClick: () => setSelected(driver.activeJobId),
      });
    }

    for (const job of filtered) {
      const first = job.stops[0];
      if (first) {
        markers.push({
          id: `${job.id}-origin`,
          at: first.place.at,
          kind: first.kind === 'merchant' ? 'merchant' : 'pickup',
          onClick: () => setSelected(job.id),
        });
      }
      if (job.id === selected) {
        job.stops.forEach((stop, index) => {
          markers.push({
            id: `${job.id}-stop-${index}`,
            at: stop.place.at,
            kind: index === 0 ? 'pickup' : 'dropoff',
            label: stop.place.label,
          });
        });
        const driver = job.kind === 'trip' ? job.driverId : job.courierId;
        const route = driver ? state.drivers[driver]?.activeRoute : job.route;
        if (route) routes.push({ id: `${job.id}-route`, route, variant: 'active' });
      }
    }

    return { markers, routes };
  }, [state.drivers, state.marketId, filtered, selected]);

  const zones: MapZoneOverlay[] = showHeat
    ? market.zones.map((zone) => ({
        id: zone.id,
        polygon: zone.polygon,
        intensity: Math.min(1, ((state.zoneSnapshots[zone.id]?.surgeMultiplier ?? 1) - 1) / 1.5),
        label: zone.name,
      }))
    : [];

  const detail = selected ? (state.trips[selected] ?? state.orders[selected]) : undefined;

  return (
    <div className="grow" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', overflow: 'hidden' }}>
      <div style={{ position: 'relative' }}>
        <MapView
          marketId={state.marketId}
          markers={markers}
          routes={routes}
          zones={zones}
          showLegend={
            <>
              <span className="row gap-2">
                <span className="dot" style={{ background: 'var(--c-positive)' }} /> Idle earner
              </span>
              <span className="row gap-2">
                <span className="dot" style={{ background: 'var(--c-info)' }} /> On a job
              </span>
              <span className="row gap-2">
                <span className="dot" style={{ background: 'var(--c-danger)', opacity: 0.5 }} /> Surge zone
              </span>
            </>
          }
        />
        <div
          className="row gap-2"
          style={{ position: 'absolute', top: 'var(--s-3)', left: 'var(--s-3)', zIndex: 6 }}
        >
          <Segmented
            value={layer}
            onChange={setLayer}
            options={[
              { value: 'all', label: 'All' },
              { value: 'rides', label: 'Rides' },
              { value: 'deliveries', label: 'Deliveries' },
            ]}
          />
          <Button variant={showHeat ? 'primary' : 'ghost'} size="sm" icon="layers" onClick={() => setShowHeat((v) => !v)}>
            Heat
          </Button>
        </div>
      </div>

      <aside
        className="col"
        style={{ borderLeft: '1px solid var(--c-border)', overflowY: 'auto', background: 'var(--c-bg-elevated)' }}
      >
        <div style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--c-border)' }}>
          <span className="t-caps">Jobs in flight · {filtered.length}</span>
        </div>
        {filtered.length === 0 && <Empty icon="route" title="Nothing in flight" />}
        {filtered.slice(0, 60).map((job) => {
          const earnerId = job.kind === 'trip' ? job.driverId : job.courierId;
          const earner = earnerId ? state.drivers[earnerId] : undefined;
          return (
            <ListRow
              key={job.id}
              icon={job.kind === 'trip' ? 'car' : 'bag'}
              title={`${job.code} · ${getProduct(job.productId)?.shortName ?? ''}`}
              subtitle={`${job.status.replace(/_/g, ' ')}${earner ? ` · ${earner.displayName}` : ' · unassigned'}`}
              selected={job.id === selected}
              onClick={() => setSelected(job.id)}
              trailing={<span className="t-small t-num">{money((job.settlement ?? job.quote).total)}</span>}
            />
          );
        })}
      </aside>

      {detail && <JobInspector job={detail} onClose={() => setSelected(undefined)} />}
    </div>
  );
}

/* ------------------------------- Dispatch -------------------------------- */

function DispatchSection() {
  const state = useWorld((s) => s.state);
  const act = useAction();
  const jobs = adminActions.liveJobs(state);
  const [selected, setSelected] = useState<ID | undefined>(jobs[0]?.id);
  const explain = selected ? adminActions.dispatchExplain(state, selected) : undefined;

  return (
    <div className="grid-split">
      <Card title="Open and active jobs" pad={false}>
        <div className="table-scroll" style={{ maxHeight: '70vh' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Product</th>
                <th>Status</th>
                <th>Assigned</th>
                <th className="num">Payout</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const earnerId = job.kind === 'trip' ? job.driverId : job.courierId;
                return (
                  <tr
                    key={job.id}
                    onClick={() => setSelected(job.id)}
                    style={{ cursor: 'pointer', background: job.id === selected ? 'var(--c-surface-alt)' : undefined }}
                  >
                    <td className="t-mono">{job.code}</td>
                    <td>{getProduct(job.productId)?.shortName ?? job.productId}</td>
                    <td>
                      <Chip
                        tone={
                          ['searching', 'requested', 'no_drivers', 'placed'].includes(job.status)
                            ? 'warning'
                            : 'outline'
                        }
                      >
                        {job.status.replace(/_/g, ' ')}
                      </Chip>
                    </td>
                    <td className="t-muted">{earnerId ? state.drivers[earnerId]?.displayName : '—'}</td>
                    <td className="num">{money((job.settlement ?? job.quote).earnerPayout)}</td>
                  </tr>
                );
              })}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <Empty icon="route" title="No open jobs" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="col gap-4">
        {!explain ? (
          <Empty icon="route" title="Select a job" hint="The matcher's reasoning appears here." />
        ) : (
          <>
            <Card title="Offers sent" pad={false}>
              {explain.offers.length === 0 ? (
                <div style={{ padding: 'var(--s-4)' }}>
                  <span className="t-small t-faint">No offers have been sent for this job yet.</span>
                </div>
              ) : (
                explain.offers.map((offer) => (
                  <ListRow
                    key={offer.id}
                    leading={
                      <Avatar
                        name={state.drivers[offer.driverId]?.displayName ?? '?'}
                        hue={state.drivers[offer.driverId]?.avatarHue ?? 0}
                        size={30}
                      />
                    }
                    title={state.drivers[offer.driverId]?.displayName ?? offer.driverId}
                    subtitle={`score ${offer.score.total.toFixed(2)} · ${offer.preview.approachMinutes} min away · ${money(offer.preview.payout)}`}
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

            <Card
              title="Ranked candidates"
              pad={false}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  icon="refresh"
                  onClick={() => act(adminActions.forceDispatch(explain.job.id), 'force dispatch')}
                >
                  Re-offer
                </Button>
              }
            >
              {explain.eligible.slice(0, 10).map((candidate) => (
                <div key={candidate.driver.id} className="col gap-2" style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--c-border)' }}>
                  <div className="row spread">
                    <span className="t-small" style={{ fontWeight: 550 }}>
                      {candidate.driver.displayName}
                    </span>
                    <span className="t-small t-num">{candidate.score.total.toFixed(2)}</span>
                  </div>
                  <div className="row gap-3 t-micro t-faint">
                    <span>prox {candidate.score.proximity.toFixed(2)}</span>
                    <span>rating {candidate.score.rating.toFixed(2)}</span>
                    <span>idle {candidate.score.idleTime.toFixed(2)}</span>
                    <span>accept {candidate.score.acceptance.toFixed(2)}</span>
                    <span>fair {candidate.score.fairness.toFixed(2)}</span>
                  </div>
                  <Meter value={Math.max(0, Math.min(1, candidate.score.total))} />
                  <span className="t-micro t-faint">
                    {distance(candidate.approachKm)} · {candidate.approachMinutes} min approach
                  </span>
                </div>
              ))}
              {explain.eligible.length === 0 && (
                <div style={{ padding: 'var(--s-4)' }}>
                  <span className="t-small t-faint">No earner is currently eligible for this job.</span>
                </div>
              )}
            </Card>

            <Card title="Why others were excluded" pad={false}>
              {explain.rejected.slice(0, 12).map((rejection) => (
                <ListRow
                  key={rejection.driver.id}
                  icon="x"
                  iconColor="var(--c-danger)"
                  title={rejection.driver.displayName}
                  subtitle={rejection.reasons.join(' · ')}
                  trailing={<span className="t-micro t-faint">{distance(rejection.approachKm)}</span>}
                />
              ))}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Supply --------------------------------- */

function SupplySection() {
  const state = useWorld((s) => s.state);
  const act = useAction();
  const [filter, setFilter] = useState<'all' | 'online' | 'busy' | 'offline'>('all');

  const drivers = Object.values(state.drivers)
    .filter((d) => d.marketId === state.marketId)
    .filter((d) => {
      if (filter === 'online') return d.status === 'online' && !d.activeJobId;
      if (filter === 'busy') return Boolean(d.activeJobId);
      if (filter === 'offline') return d.status === 'offline';
      return true;
    })
    .sort((a, b) => b.session.earnings - a.session.earnings);

  const byVehicle = vehicleClasses.map((vehicleClass) => ({
    vehicleClass,
    count: Object.values(state.drivers).filter(
      (d) => d.marketId === state.marketId && d.vehicle.classId === vehicleClass.id,
    ).length,
  }));
  const peak = Math.max(1, ...byVehicle.map((v) => v.count));

  return (
    <div className="col gap-4">
      <div className="row gap-2">
        {(['all', 'online', 'busy', 'offline'] as const).map((option) => (
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
        <span className="t-small t-faint" style={{ marginLeft: 'auto' }}>
          {drivers.length} earners
        </span>
      </div>

      <div className="grid-split">
        <Card pad={false} title="Fleet">
          <div className="table-scroll" style={{ maxHeight: '58vh' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Earner</th>
                  <th>Status</th>
                  <th>Vehicle</th>
                  <th>Products</th>
                  <th className="num">Rating</th>
                  <th className="num">Session</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {drivers.slice(0, 120).map((driver) => (
                  <tr key={driver.id}>
                    <td>
                      <span className="row gap-2">
                        <Avatar name={driver.displayName} hue={driver.avatarHue} size={24} />
                        {driver.displayName}
                      </span>
                    </td>
                    <td>
                      <Chip
                        tone={
                          driver.activeJobId ? 'info' : driver.status === 'online' ? 'positive' : 'outline'
                        }
                      >
                        {driver.activeJobId ? 'on a job' : driver.status}
                      </Chip>
                    </td>
                    <td className="t-muted">{driver.vehicle.classId}</td>
                    <td className="t-muted">{driver.optedProductIds.length}</td>
                    <td className="num">{driver.rating.toFixed(2)}</td>
                    <td className="num">{money(driver.session.earnings)}</td>
                    <td>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() =>
                          act(
                            adminActions.setDriverStatus(driver.id, driver.status === 'offline' ? 'online' : 'offline'),
                            'toggle driver',
                          )
                        }
                      >
                        {driver.status === 'offline' ? 'Bring online' : 'Take offline'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="col gap-4">
          <Card title="Fleet composition">
            <div className="col gap-3">
              {byVehicle.map(({ vehicleClass, count }) => (
                <div key={vehicleClass.id} className="col gap-1">
                  <div className="row spread">
                    <span className="row gap-2 t-small">
                      <Icon name={vehicleClass.icon} size={15} />
                      {vehicleClass.label}
                    </span>
                    <span className="t-small t-num">{count}</span>
                  </div>
                  <Meter value={count / peak} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Product coverage">
            <div className="col gap-3">
              {productConfigs
                .filter((p) => p.enabled)
                .map((product) => {
                  const opted = Object.values(state.drivers).filter(
                    (d) => d.marketId === state.marketId && d.optedProductIds.includes(product.id),
                  );
                  const online = opted.filter((d) => d.status !== 'offline').length;
                  return (
                    <div key={product.id} className="row spread">
                      <span className="row gap-2 t-small">
                        <Icon name={product.icon} size={15} />
                        {product.name}
                      </span>
                      <span className="t-small t-num">
                        {online} online / {opted.length}
                      </span>
                    </div>
                  );
                })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Demand --------------------------------- */

function DemandSection() {
  const state = useWorld((s) => s.state);
  const zones = adminActions.zoneTable(state);
  const hourly = adminActions.hourlyVolume(state, 24);
  const mix = adminActions.productMix(state);
  const peak = Math.max(1, ...hourly.map((h) => h.trips + h.orders));

  return (
    <div className="col gap-4">
      <Card title="Completed volume by hour">
        <div className="row" style={{ gap: 4, alignItems: 'flex-end', height: 170 }}>
          {hourly.map((bucket, index) => (
            <div key={index} className="col grow" style={{ alignItems: 'center', gap: 4 }}>
              <div
                className="col"
                style={{ width: '100%', justifyContent: 'flex-end', height: 140, gap: 2 }}
                title={`${bucket.hour}:00 · ${bucket.trips} trips, ${bucket.orders} orders, ${money(bucket.gross)}`}
              >
                <div
                  style={{
                    height: `${(bucket.orders / peak) * 130}px`,
                    borderRadius: '3px 3px 0 0',
                    background: 'var(--c-positive)',
                  }}
                />
                <div
                  style={{
                    height: `${(bucket.trips / peak) * 130}px`,
                    borderRadius: '0 0 3px 3px',
                    background: 'var(--c-info)',
                  }}
                />
              </div>
              <span className="t-micro t-faint" style={{ fontSize: 9 }}>
                {bucket.hour}
              </span>
            </div>
          ))}
        </div>
        <div className="row gap-4" style={{ marginTop: 'var(--s-3)' }}>
          <span className="row gap-2 t-micro t-faint">
            <span className="dot" style={{ background: 'var(--c-info)' }} /> Trips
          </span>
          <span className="row gap-2 t-micro t-faint">
            <span className="dot" style={{ background: 'var(--c-positive)' }} /> Delivery orders
          </span>
        </div>
      </Card>

      <div className="grid-split">
        <Card title="Zones" pad={false}>
          <table className="table">
            <thead>
              <tr>
                <th>Zone</th>
                <th className="num">Open</th>
                <th className="num">Earners</th>
                <th className="num">Ratio</th>
                <th className="num">Surge</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((row) => (
                <tr key={row.zone.id}>
                  <td>
                    {row.zone.name}
                    {row.zone.surcharge && (
                      <Chip tone="outline" style={{ marginLeft: 8 }}>
                        {row.zone.surcharge.label}
                      </Chip>
                    )}
                  </td>
                  <td className="num">{row.openRequests}</td>
                  <td className="num">{row.availableDrivers}</td>
                  <td className="num">{row.ratio.toFixed(2)}</td>
                  <td className="num">
                    <Chip tone={row.surge >= 1.15 ? 'warning' : 'outline'}>{row.surge.toFixed(1)}x</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Product mix">
          <div className="col gap-3">
            {mix.map((row) => (
              <div key={row.productId} className="col gap-1">
                <div className="row spread">
                  <span className="t-small">{row.name}</span>
                  <span className="t-small t-num">
                    {row.count} · {percent(row.share)}
                  </span>
                </div>
                <Meter value={row.share} />
                <span className="t-micro t-faint">{money(row.gross)} gross</span>
              </div>
            ))}
            {mix.length === 0 && <Empty icon="chart" title="No completed jobs yet" />}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------- Finance -------------------------------- */

function FinanceSection({ snapshot }: { snapshot: adminActions.MarketplaceSnapshot }) {
  const state = useWorld((s) => s.state);
  const ledger = [...state.ledger].sort((a, b) => b.at - a.at);
  const takeRate = snapshot.grossBookings > 0 ? snapshot.platformRevenue / snapshot.grossBookings : 0;

  const byKind = ledger.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] ?? 0) + entry.amount;
    return acc;
  }, {});

  return (
    <div className="col gap-4">
      <div className="grid-metrics">
        <Metric label="Gross bookings today" value={money(snapshot.grossBookings)} />
        <Metric label="Earner payouts" value={money(snapshot.earnerPayouts)} />
        <Metric label="Platform revenue" value={money(snapshot.platformRevenue)} tone="positive" />
        <Metric label="Effective take rate" value={percent(takeRate, 1)} hint={`target ${percent(1 - driverPayConfig.baseTakeRate)}`} />
        <Metric label="Completed today" value={snapshot.completedToday} hint={`${percent(snapshot.cancelRate)} cancelled`} />
      </div>

      <div className="grid-split">
        <Card title="Ledger" pad={false}>
          <div className="table-scroll" style={{ maxHeight: '56vh' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Account</th>
                  <th>Kind</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.slice(0, 150).map((entry) => (
                  <tr key={entry.id}>
                    <td className="t-muted">{dayTime(entry.at)}</td>
                    <td className="t-muted">{entry.accountKind}</td>
                    <td>
                      <Chip tone="outline">{entry.kind}</Chip>
                    </td>
                    <td className="t-truncate" style={{ maxWidth: 260 }}>
                      {entry.label}
                    </td>
                    <td className="num" style={{ color: entry.amount >= 0 ? 'var(--c-positive)' : undefined }}>
                      {money(entry.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="col gap-4">
          <Card title="Ledger by kind">
            <div className="col gap-2">
              {Object.entries(byKind)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .map(([kind, amount]) => (
                  <div key={kind} className="row spread">
                    <span className="t-small t-muted">{kind}</span>
                    <span className="t-small t-num" style={{ color: amount >= 0 ? 'var(--c-positive)' : undefined }}>
                      {money(amount)}
                    </span>
                  </div>
                ))}
            </div>
          </Card>

          <Card title="Fee schedule">
            <div className="col gap-2">
              {feeConfigs
                .filter((fee) => fee.enabled)
                .map((fee) => (
                  <div key={fee.id} className="row spread">
                    <span className="col" style={{ gap: 1 }}>
                      <span className="t-small">{fee.label}</span>
                      <span className="t-micro t-faint">
                        {fee.appliesTo.join(', ')} · {fee.platformRevenue ? 'platform revenue' : 'pass-through'}
                      </span>
                    </span>
                    <span className="t-small t-num">
                      {fee.kind === 'flat' ? money(fee.amount) : percent(fee.rate, 1)}
                    </span>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Events -------------------------------- */

function EventSection() {
  const state = useWorld((s) => s.state);
  const events = useEventLog(220);
  const [query, setQuery] = useState('');

  const filtered = events.filter(
    (event) =>
      !query ||
      event.type.includes(query.toLowerCase()) ||
      event.actor.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="col gap-4">
      <div className="row gap-2 panel" style={{ padding: '0 var(--s-3)', height: 42 }}>
        <Icon name="search" size={16} color="var(--c-text-faint)" />
        <input
          className="grow"
          style={{ border: 'none', background: 'transparent', outline: 'none', height: 40 }}
          placeholder="Filter by event type or actor"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="t-micro t-faint">{filtered.length} events</span>
      </div>

      <Card pad={false}>
        <div className="table-scroll" style={{ maxHeight: '70vh' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Time</th>
                <th style={{ width: 190 }}>Event</th>
                <th style={{ width: 160 }}>Actor</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id}>
                  <td className="t-muted t-mono">{clock(event.at)}</td>
                  <td>
                    <Chip tone={event.type.includes('cancel') ? 'danger' : 'outline'}>
                      {eventLabels[event.type as keyof typeof eventLabels] ?? event.type}
                    </Chip>
                  </td>
                  <td className="t-truncate">{event.actor}</td>
                  <td className="t-mono t-faint t-truncate" style={{ maxWidth: 420 }}>
                    {JSON.stringify(event.payload)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <Empty icon="history" title="No events yet" hint="Let the simulation run, or act in another surface." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <span className="t-micro t-faint">
        The log holds the most recent events emitted since this world was generated. World clock: {clock(state.now)}.
      </span>
    </div>
  );
}

/* --------------------------------- Config -------------------------------- */

function ConfigSection() {
  const state = useWorld((s) => s.state);
  const [open, setOpen] = useState<string | undefined>();
  if (!appConfig.features.configInspector) {
    return <Empty title="Config inspector disabled" hint="Enable it in config/app.config.ts." />;
  }

  const market = getMarket(state.marketId);

  const groups: { id: string; label: string; summary: string; value: unknown }[] = [
    { id: 'app', label: 'Platform', summary: `${appConfig.surfaces.length} surfaces · ${Object.keys(appConfig.features).length} feature flags`, value: appConfig },
    { id: 'brand', label: 'Brand', summary: `${Object.keys(brandConfig.palettes).length} palettes · ${Object.keys(brandConfig.surfaceAccents).length} surface accents`, value: brandConfig },
    { id: 'markets', label: 'Markets', summary: `${platformConfig.markets.length} markets · ${market.zones.length} zones in ${market.name}`, value: platformConfig.markets },
    { id: 'products', label: 'Products', summary: `${productConfigs.length} products across two verticals`, value: productConfigs },
    { id: 'pricing', label: 'Pricing', summary: `${rateCards.length} rate cards · ${feeConfigs.length} fees · surge ${surgeConfig.min}–${surgeConfig.max}x`, value: { rateCards, feeConfigs, surgeConfig, driverPayConfig } },
    { id: 'fleet', label: 'Fleet', summary: `${vehicleClasses.length} vehicle classes · ${platformConfig.fleet.driverTiers.length} tiers · ${platformConfig.fleet.incentives.length} incentives`, value: platformConfig.fleet },
    { id: 'catalog', label: 'Catalogue', summary: `${catalogConfig.archetypes.length} archetypes · ${catalogConfig.modifierGroups.length} modifier groups`, value: catalogConfig },
    { id: 'payments', label: 'Payments', summary: `${paymentMethods.length} methods · ${promotions.length} promotions`, value: { paymentMethods, promotions, payout: platformConfig.payments.payout } },
    { id: 'org', label: 'Enterprise', summary: `${orgConfig.policyRules.length} policy rules · ${orgConfig.reports.length} reports`, value: orgConfig },
    { id: 'seed', label: 'World generation', summary: `${seedConfig.perMarket.drivers} earners · ${seedConfig.perMarket.merchants} merchants per market`, value: seedConfig },
  ];

  const active = groups.find((group) => group.id === open);

  return (
    <div className="col gap-4">
      <Card>
        <div className="col gap-2">
          <span className="t-body">
            Every value the product depends on resolves from <span className="t-mono">config/</span>. Nothing in{' '}
            <span className="t-mono">src/</span> hardcodes money, geography, catalogue shape, policy or branding.
          </span>
          <span className="t-small t-muted">
            This world was generated from seed <span className="t-mono">{appConfig.simulation.seed}</span> for market{' '}
            <span className="t-mono">{state.marketId}</span>. Regenerating with the same config produces an identical
            world; change a file below and reseed to change the market.
          </span>
        </div>
      </Card>

      <div className="grid-cards">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className="card card-pad col gap-2"
            onClick={() => setOpen(group.id)}
            style={{ textAlign: 'left', cursor: 'pointer' }}
          >
            <div className="row spread">
              <span className="t-heading">{group.label}</span>
              <Icon name="chevron" size={15} color="var(--c-text-faint)" />
            </div>
            <span className="t-small t-muted">{group.summary}</span>
            <span className="t-micro t-faint t-mono">config/{group.id}.config.ts</span>
          </button>
        ))}
      </div>

      {active && (
        <Modal title={`${active.label} configuration`} onClose={() => setOpen(undefined)} width={860}>
          <pre
            className="t-mono"
            style={{
              margin: 0,
              maxHeight: '64vh',
              overflow: 'auto',
              background: 'var(--c-bg-sunken)',
              padding: 'var(--s-3)',
              borderRadius: 'var(--r-md)',
              fontSize: 11.5,
              lineHeight: 1.55,
            }}
          >
            {JSON.stringify(active.value, null, 2)}
          </pre>
        </Modal>
      )}
    </div>
  );
}

/* ----------------------------- Job inspector ----------------------------- */

function JobInspector({ job, onClose }: { job: Trip | Order; onClose: () => void }) {
  const state = useWorld((s) => s.state);
  const earnerId = job.kind === 'trip' ? job.driverId : job.courierId;
  const earner = earnerId ? state.drivers[earnerId] : undefined;
  const consumerId = job.kind === 'trip' ? job.riderId : job.customerId;
  const consumer = state.riders[consumerId];

  return (
    <Modal title={`${job.code} · ${getProduct(job.productId)?.name ?? job.productId}`} onClose={onClose} width={640}>
      <div className="col gap-4">
        <div className="row spread">
          <StatusBadge job={job} />
          <span className="t-small t-faint">
            requested {relative(job.kind === 'trip' ? job.requestedAt : job.placedAt, state.now)}
          </span>
        </div>

        <div className="row gap-3">
          {consumer && (
            <div className="panel row gap-2 grow">
              <Avatar name={consumer.displayName} hue={consumer.avatarHue} size={28} />
              <span className="col" style={{ gap: 1 }}>
                <span className="t-small">{consumer.displayName}</span>
                <span className="t-micro t-faint">consumer · {consumer.rating.toFixed(2)}</span>
              </span>
            </div>
          )}
          {earner && (
            <div className="panel row gap-2 grow">
              <Avatar name={earner.displayName} hue={earner.avatarHue} size={28} />
              <span className="col" style={{ gap: 1 }}>
                <span className="t-small">{earner.displayName}</span>
                <span className="t-micro t-faint">
                  earner · {earner.vehicle.plate} · {Math.round(earner.speedKph)} km/h
                </span>
              </span>
            </div>
          )}
        </div>

        <StopList job={job} />
        <FareBreakdown quote={job.settlement ?? job.quote} title="Economics" showPayout />
        <div>
          <span className="t-caps">Timeline</span>
          <div style={{ marginTop: 'var(--s-2)' }}>
            <JobTimeline job={job} now={state.now} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
