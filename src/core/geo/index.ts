/**
 * Geospatial primitives. Pure functions over { lat, lng } — no dependencies.
 */
import type { LatLng, MarketConfig, ZoneConfig } from '@config';

export const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const haversineKm = (a: LatLng, b: LatLng) => haversineM(a, b) / 1000;

/** Initial bearing from a to b, in degrees clockwise from north. */
export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Linear interpolation between two coordinates. Accurate enough at city scale. */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Move a point by a metre offset along a bearing. */
export function offsetM(from: LatLng, meters: number, bearingDeg: number): LatLng {
  const d = meters / EARTH_RADIUS_M;
  const brg = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lng1 = toRad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lng2 =
    lng1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export function boundsOf(points: LatLng[], padding = 0): Bounds {
  if (points.length === 0) return { north: 0, south: 0, east: 0, west: 0 };
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const p of points) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  const padLat = (north - south) * padding || 0.002;
  const padLng = (east - west) * padding || 0.002;
  return { north: north + padLat, south: south - padLat, east: east + padLng, west: west - padLng };
}

export const boundsCenter = (b: Bounds): LatLng => ({
  lat: (b.north + b.south) / 2,
  lng: (b.east + b.west) / 2,
});

export const containsPoint = (b: Bounds, p: LatLng): boolean =>
  p.lat <= b.north && p.lat >= b.south && p.lng <= b.east && p.lng >= b.west;

/** Ray-casting point-in-polygon. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function zoneAt(market: MarketConfig, point: LatLng): ZoneConfig | undefined {
  return market.zones.find((z) => pointInPolygon(point, z.polygon));
}

export function polygonCentroid(polygon: LatLng[]): LatLng {
  const sum = polygon.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / polygon.length, lng: sum.lng / polygon.length };
}

/**
 * Project lat/lng into a unit square within the given bounds.
 * Returns { x, y } in 0..1 with y flipped so north is up.
 */
export function project(p: LatLng, b: Bounds): { x: number; y: number } {
  const w = b.east - b.west || 1e-9;
  const h = b.north - b.south || 1e-9;
  return { x: (p.lng - b.west) / w, y: 1 - (p.lat - b.south) / h };
}

/** Inverse of `project`. */
export function unproject(x: number, y: number, b: Bounds): LatLng {
  return { lng: b.west + x * (b.east - b.west), lat: b.south + (1 - y) * (b.north - b.south) };
}

/** Distance in metres from p to the segment ab, plus the closest point. */
export function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): { distanceM: number; closest: LatLng; t: number } {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const closest = { lng: ax + t * dx, lat: ay + t * dy };
  return { distanceM: haversineM(p, closest), closest, t };
}

/** Douglas–Peucker simplification, tolerance in metres. */
export function simplify(points: LatLng[], toleranceM = 12): LatLng[] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegmentM(points[i], points[start], points[end]).distanceM;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > toleranceM && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
