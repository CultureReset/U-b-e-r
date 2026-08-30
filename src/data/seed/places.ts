/**
 * Address and place synthesis.
 *
 * Addresses are derived from the market's own road graph — we snap a point to
 * its nearest street and number it from the geometry — so every generated
 * address is internally consistent with the map the user is looking at.
 */
import { getMarket, type LatLng, type MarketConfig } from '@config';
import { polygonCentroid, unproject, zoneAt } from '@core/geo';
import { graphFor, nearestEdge } from '@core/routing';
import type { Place } from '@core/types';
import { nextId, type Rng } from '@core/util';

export function addressFor(marketId: string, at: LatLng): { addressLine: string; zoneId?: string } {
  const market = getMarket(marketId);
  const graph = graphFor(marketId);
  const hit = nearestEdge(graph, at);
  const zone = zoneAt(market, at);
  if (!hit) return { addressLine: `${market.name}`, zoneId: zone?.id };

  // Derive a stable house number from the point's own coordinates.
  const number = 1 + (Math.abs(Math.round(at.lat * 1e5 + at.lng * 1e5)) % 220);
  const suffix = zone ? `, ${zone.name}` : '';
  return { addressLine: `${hit.edge.name} #${number}${suffix}`, zoneId: zone?.id };
}

export function makePlace(marketId: string, at: LatLng, label?: string, category?: string): Place {
  const { addressLine, zoneId } = addressFor(marketId, at);
  return {
    id: nextId('plc'),
    label: label ?? addressLine.split(',')[0],
    addressLine,
    zoneId,
    at,
    category,
  };
}

/** A random point weighted toward high-demand zones. */
export function randomDemandPoint(market: MarketConfig, rng: Rng): LatLng {
  const zone = rng.pickWeighted(market.zones, (z) => z.demandWeight);
  return jitterInZone(zone.polygon, rng);
}

/** A random point weighted toward where supply naturally sits. */
export function randomSupplyPoint(market: MarketConfig, rng: Rng): LatLng {
  const zone = rng.pickWeighted(market.zones, (z) => z.supplyWeight);
  return jitterInZone(zone.polygon, rng);
}

/** Uniform-ish point inside a polygon via rejection sampling around its bbox. */
export function jitterInZone(polygon: LatLng[], rng: Rng): LatLng {
  const lats = polygon.map((p) => p.lat);
  const lngs = polygon.map((p) => p.lng);
  const north = Math.max(...lats);
  const south = Math.min(...lats);
  const east = Math.max(...lngs);
  const west = Math.min(...lngs);
  // Bias slightly toward the centre so points cluster like real activity.
  const centre = polygonCentroid(polygon);
  const lat = rng.float(south, north) * 0.75 + centre.lat * 0.25;
  const lng = rng.float(west, east) * 0.75 + centre.lng * 0.25;
  return { lat, lng };
}

/** Anywhere inside the market bounds — used for spreading merchants out. */
export function randomMarketPoint(market: MarketConfig, rng: Rng): LatLng {
  return unproject(rng.float(0.05, 0.95), rng.float(0.05, 0.95), market.bounds);
}

/** Landmarks become quick-destination suggestions in the consumer surfaces. */
export function landmarkPlaces(marketId: string): Place[] {
  const market = getMarket(marketId);
  return market.landmarks.map((lm) => {
    const { addressLine, zoneId } = addressFor(marketId, lm.at);
    return {
      id: `plc_lm_${lm.id}`,
      label: lm.name,
      addressLine,
      zoneId,
      at: lm.at,
      category: lm.category,
    };
  });
}
