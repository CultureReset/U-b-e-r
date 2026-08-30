/**
 * Zone-level supply/demand snapshots. These drive surge, the ops console heat
 * layer and the driver's "where to go" hints — all from the same computation.
 */
import type { MarketConfig } from '@config';
import { computeSurge } from '@core/pricing';
import { zoneAt } from '@core/geo';
import type { Timestamp, ZoneSnapshot } from '@core/types';
import { round2 } from '@core/util';
import type { WorldState } from '@data/ports';

export function computeZoneSnapshots(
  state: WorldState,
  market: MarketConfig,
  now: Timestamp,
): Record<string, ZoneSnapshot> {
  const open = new Map<string, number>();
  const supply = new Map<string, number>();

  for (const trip of Object.values(state.trips)) {
    if (!['requested', 'searching', 'no_drivers'].includes(trip.status)) continue;
    const zone = zoneAt(market, trip.stops[0]?.place.at ?? market.center);
    if (zone) open.set(zone.id, (open.get(zone.id) ?? 0) + 1);
  }
  for (const order of Object.values(state.orders)) {
    if (!['placed', 'merchant_review', 'preparing', 'ready'].includes(order.status)) continue;
    const zone = zoneAt(market, order.stops[0]?.place.at ?? market.center);
    if (zone) open.set(zone.id, (open.get(zone.id) ?? 0) + 1);
  }
  for (const driver of Object.values(state.drivers)) {
    if (driver.marketId !== state.marketId || driver.status !== 'online') continue;
    const zone = zoneAt(market, driver.at);
    if (zone) supply.set(zone.id, (supply.get(zone.id) ?? 0) + 1);
  }

  const snapshots: Record<string, ZoneSnapshot> = {};
  for (const zone of market.zones) {
    const openRequests = open.get(zone.id) ?? 0;
    const availableDrivers = supply.get(zone.id) ?? 0;
    const previous = state.zoneSnapshots[zone.id]?.surgeMultiplier ?? 1;
    snapshots[zone.id] = {
      zoneId: zone.id,
      openRequests,
      availableDrivers,
      ratio: round2(openRequests / Math.max(0.5, availableDrivers)),
      surgeMultiplier: computeSurge(openRequests, availableDrivers, previous),
      updatedAt: now,
    };
  }
  return snapshots;
}

/** Surge multiplier applying at a point, falling back to 1 outside any zone. */
export function surgeAt(
  state: WorldState,
  market: MarketConfig,
  at: { lat: number; lng: number },
): number {
  const zone = zoneAt(market, at);
  if (!zone) return 1;
  return state.zoneSnapshots[zone.id]?.surgeMultiplier ?? 1;
}

/** Zone surcharges (airport fees and the like) applying at a point. */
export function surchargesAt(market: MarketConfig, at: { lat: number; lng: number }) {
  const zone = zoneAt(market, at);
  return zone?.surcharge ? [{ label: zone.surcharge.label, amount: zone.surcharge.amount }] : [];
}
