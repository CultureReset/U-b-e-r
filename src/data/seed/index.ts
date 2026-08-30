/**
 * World assembly. Takes a market id and a seed, returns a fully populated,
 * internally consistent `WorldState`.
 */
import { appConfig, getMarket, seedConfig } from '@config';
import type { DriverProfile, Merchant, Org, RiderProfile, Timestamp } from '@core/types';
import { createRng, resetIds, round2 } from '@core/util';
import type { WorldState } from '@data/ports';
import { generateHistory } from './history';
import { generateMerchant } from './merchants';
import { generateOrgs } from './orgs';
import { generateDriver, generateRider } from './people';
import { landmarkPlaces } from './places';
import { computeZoneSnapshots } from './zones';

export * from './places';
export * from './people';
export * from './merchants';
export * from './history';
export * from './zones';

const byId = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

export function seedWorld(marketId: string, now: Timestamp = Date.now()): WorldState {
  resetIds();
  const market = getMarket(marketId);
  const rng = createRng(`${appConfig.simulation.seed}:${marketId}`);
  const hourOfDay = new Date(now).getHours();

  const counts = seedConfig.perMarket;

  const riders: RiderProfile[] = Array.from({ length: counts.riders }, () =>
    generateRider(marketId, rng.fork('rider'), now),
  );
  const drivers: DriverProfile[] = Array.from({ length: counts.drivers }, () =>
    generateDriver(marketId, rng.fork('driver'), now),
  );

  const takenNames = new Set<string>();
  const merchants: Merchant[] = Array.from({ length: counts.merchants }, () =>
    generateMerchant(marketId, rng.fork('merchant'), hourOfDay, takenNames),
  );

  const { orgs, riders: ridersWithOrgs } = generateOrgs(marketId, riders, rng.fork('org'));

  const history = generateHistory(marketId, ridersWithOrgs, drivers, merchants, orgs, rng.fork('history'), now);

  // Fold historical earnings back into each earner's lifetime figures so the
  // driver dashboard and the ledger tell the same story.
  const driversWithHistory = drivers.map((driver) => {
    const stats = history.driverStats[driver.id];
    if (!stats) return driver;
    return {
      ...driver,
      lifetime: {
        earnings: round2(driver.lifetime.earnings + stats.earnings),
        jobs: driver.lifetime.jobs + stats.jobs,
        distanceKm: round2(driver.lifetime.distanceKm + stats.distanceKm),
      },
    } satisfies DriverProfile;
  });

  // Merchant "today" figures likewise derive from the generated orders.
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const merchantsWithStats = merchants.map((merchant) => {
    const todays = history.orders.filter(
      (o) => o.merchantId === merchant.id && o.placedAt >= todayStart.getTime() && o.status === 'delivered',
    );
    return {
      ...merchant,
      stats: {
        ...merchant.stats,
        ordersToday: todays.length,
        revenueToday: round2(
          todays.reduce((acc, o) => acc + o.lines.reduce((s, l) => s + l.lineTotal, 0), 0),
        ),
      },
    } satisfies Merchant;
  });

  const defaultRider = ridersWithOrgs.find((r) => r.orgMembership) ?? ridersWithOrgs[0];
  const defaultDriver =
    driversWithHistory.find((d) => d.optedProductIds.length > 2 && d.status !== 'offline') ?? driversWithHistory[0];
  const defaultMerchant =
    merchantsWithStats.find((m) => m.isOpen && m.menu.length > 1) ?? merchantsWithStats[0];
  const defaultOrg: Org | undefined = orgs[0];

  const state: WorldState = {
    version: appConfig.persistence.version,
    now,
    marketId,
    riders: byId(ridersWithOrgs),
    drivers: byId(driversWithHistory),
    merchants: byId(merchantsWithStats),
    orgs: byId(orgs),
    trips: byId(history.trips),
    orders: byId(history.orders),
    offers: {},
    ledger: history.ledger,
    zoneSnapshots: {},
    landmarks: landmarkPlaces(marketId),
    session: {
      riderId: defaultRider.id,
      driverId: defaultDriver.id,
      merchantId: defaultMerchant.id,
      orgId: defaultOrg?.id ?? '',
    },
  };

  state.zoneSnapshots = computeZoneSnapshots(state, market, now);
  return state;
}
