/**
 * Road graph and router. The product's ETAs, map lines and vehicle movement all
 * come from here, so what matters is that the network is connected, routes
 * terminate where they were asked to, and travel times respond to conditions.
 */
import { describe, expect, it } from 'vitest';
import { marketConfigs } from '@config';
import { haversineM, pointInPolygon, project, unproject, simplify, distanceToSegmentM } from '@core/geo';
import { buildRoadGraph, findRoute, graphFor, nearestNode, positionAlong, remainingAlong, edgeSpeedMps } from '@core/routing';
import { createRng } from '@core/util';

const market = marketConfigs[0];

describe('road graph', () => {
  it('generates a graph with no isolated nodes', () => {
    const graph = buildRoadGraph(market);
    const orphans = [...graph.nodes.values()].filter((node) => node.edgeIds.length === 0);
    expect(orphans).toHaveLength(0);
  });

  it('is deterministic for a given market', () => {
    const a = buildRoadGraph(market);
    const b = buildRoadGraph(market);
    expect(a.nodes.size).toBe(b.nodes.size);
    expect(a.edges.size).toBe(b.edges.size);
    const first = a.nodeIds[10];
    expect(a.nodes.get(first)!.at).toEqual(b.nodes.get(first)!.at);
  });

  it('finds a nearby node for any point inside the market', () => {
    const graph = graphFor(market.id);
    const rng = createRng('nearest');
    for (let i = 0; i < 40; i++) {
      const point = unproject(rng.float(0.02, 0.98), rng.float(0.02, 0.98), market.bounds);
      const node = nearestNode(graph, point);
      // Nothing should be further than a couple of blocks from the network.
      expect(haversineM(point, node.at)).toBeLessThan(1200);
    }
  });
});

describe('findRoute', () => {
  const graph = graphFor(market.id);

  it('connects any two points in the market', () => {
    const rng = createRng('routes');
    for (let i = 0; i < 25; i++) {
      const from = unproject(rng.float(0.05, 0.95), rng.float(0.05, 0.95), market.bounds);
      const to = unproject(rng.float(0.05, 0.95), rng.float(0.05, 0.95), market.bounds);
      const route = findRoute(graph, market, from, to);
      expect(route.points.length).toBeGreaterThan(1);
      expect(route.distanceM).toBeGreaterThan(0);
      expect(route.durationSec).toBeGreaterThan(0);
      // The polyline must actually start and finish where it was asked to.
      expect(haversineM(route.points[0], from)).toBeLessThan(1);
      expect(haversineM(route.points[route.points.length - 1], to)).toBeLessThan(1);
    }
  });

  it('is never shorter than the straight line between its endpoints', () => {
    const from = market.landmarks[0].at;
    const to = market.landmarks[2].at;
    const route = findRoute(graph, market, from, to);
    expect(route.distanceM).toBeGreaterThanOrEqual(haversineM(from, to) - 1);
  });

  it('keeps cumulative distance monotonic and consistent with the total', () => {
    const route = findRoute(graph, market, market.landmarks[0].at, market.landmarks[4].at);
    for (let i = 1; i < route.cumulativeM.length; i++) {
      expect(route.cumulativeM[i]).toBeGreaterThanOrEqual(route.cumulativeM[i - 1]);
    }
    expect(route.cumulativeM[route.cumulativeM.length - 1]).toBeCloseTo(route.distanceM, 3);
  });

  it('takes longer in rush hour than at night', () => {
    const from = market.landmarks[0].at;
    const to = market.landmarks[3].at;
    const night = findRoute(graph, market, from, to, { hourOfDay: 3, speedFactor: 1, congestionFactor: 1 });
    const rush = findRoute(graph, market, from, to, { hourOfDay: 18, speedFactor: 1, congestionFactor: 1 });
    expect(rush.durationSec).toBeGreaterThan(night.durationSec);
  });

  it('lets a filtering vehicle beat traffic that a car cannot', () => {
    const from = market.landmarks[0].at;
    const to = market.landmarks[3].at;
    const car = findRoute(graph, market, from, to, { hourOfDay: 18, speedFactor: 1, congestionFactor: 1 });
    const moto = findRoute(graph, market, from, to, { hourOfDay: 18, speedFactor: 1.15, congestionFactor: 0.35 });
    expect(moto.durationSec).toBeLessThan(car.durationSec);
  });

  it('handles identical endpoints without producing a degenerate route', () => {
    const point = market.landmarks[1].at;
    const route = findRoute(graph, market, point, point);
    expect(route.points.length).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(route.durationSec)).toBe(true);
  });
});

describe('route traversal', () => {
  const graph = graphFor(market.id);
  const route = findRoute(graph, market, market.landmarks[0].at, market.landmarks[4].at);

  it('walks from the origin to the destination', () => {
    const start = positionAlong(route, 0);
    const end = positionAlong(route, route.distanceM);
    expect(haversineM(start.at, route.points[0])).toBeLessThan(2);
    expect(haversineM(end.at, route.points[route.points.length - 1])).toBeLessThan(2);
  });

  it('clamps progress beyond either end of the route', () => {
    expect(positionAlong(route, -500).at).toEqual(positionAlong(route, 0).at);
    expect(positionAlong(route, route.distanceM * 4).at).toEqual(positionAlong(route, route.distanceM).at);
  });

  it('reports remaining distance that falls to zero at the destination', () => {
    expect(remainingAlong(route, 0).distanceM).toBeCloseTo(route.distanceM, 3);
    expect(remainingAlong(route, route.distanceM).distanceM).toBe(0);
    expect(remainingAlong(route, route.distanceM).durationSec).toBe(0);
  });

  it('gives a faster class of road a higher speed', () => {
    const opts = { hourOfDay: 12, speedFactor: 1, congestionFactor: 1 };
    expect(edgeSpeedMps(market, 'highway', opts)).toBeGreaterThan(edgeSpeedMps(market, 'arterial', opts));
    expect(edgeSpeedMps(market, 'arterial', opts)).toBeGreaterThan(edgeSpeedMps(market, 'local', opts));
  });
});

describe('geo primitives', () => {
  it('round-trips a projection', () => {
    const point = { lat: 4.66, lng: -74.08 };
    const projected = project(point, market.bounds);
    const back = unproject(projected.x, projected.y, market.bounds);
    expect(back.lat).toBeCloseTo(point.lat, 9);
    expect(back.lng).toBeCloseTo(point.lng, 9);
  });

  it('tests polygon membership', () => {
    const zone = market.zones[0];
    const inside = { lat: (zone.polygon[0].lat + zone.polygon[2].lat) / 2, lng: (zone.polygon[0].lng + zone.polygon[1].lng) / 2 };
    expect(pointInPolygon(inside, zone.polygon)).toBe(true);
    expect(pointInPolygon({ lat: 0, lng: 0 }, zone.polygon)).toBe(false);
  });

  it('keeps the endpoints when simplifying a polyline', () => {
    const graph = graphFor(market.id);
    const route = findRoute(graph, market, market.landmarks[0].at, market.landmarks[5].at);
    const simplified = simplify(route.points, 30);
    expect(simplified.length).toBeLessThanOrEqual(route.points.length);
    expect(simplified[0]).toEqual(route.points[0]);
    expect(simplified[simplified.length - 1]).toEqual(route.points[route.points.length - 1]);
  });

  it('measures distance to a segment, clamping to its ends', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 1 };
    expect(distanceToSegmentM({ lat: 0, lng: 0.5 }, a, b).t).toBeCloseTo(0.5, 5);
    expect(distanceToSegmentM({ lat: 0, lng: -1 }, a, b).t).toBe(0);
    expect(distanceToSegmentM({ lat: 0, lng: 2 }, a, b).t).toBe(1);
  });
});
