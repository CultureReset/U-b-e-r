/**
 * A* routing over the generated road graph, plus route utilities used by the
 * simulator (walking a vehicle along a route) and by the map renderer.
 */
import type { LatLng, MarketConfig } from '@config';
import type { Route } from '@core/types';
import { haversineM, lerpLatLng, bearing } from '@core/geo';
import { nearestNode, otherEnd, type RoadGraph, type RoadClass } from './graph';

export interface RouteOptions {
  /** Hour of day (0–23) used to apply the market's congestion curve. */
  hourOfDay: number;
  /** Vehicle speed multiplier (motorcycles filter traffic, bikes are slow). */
  speedFactor: number;
  /** How much congestion affects this vehicle: 1 = fully, 0.2 = barely. */
  congestionFactor: number;
}

export const defaultRouteOptions: RouteOptions = { hourOfDay: 12, speedFactor: 1, congestionFactor: 1 };

/** Effective speed in metres/second for a road class under given conditions. */
export function edgeSpeedMps(market: MarketConfig, roadClass: RoadClass, opts: RouteOptions): number {
  const baseKph = market.roadNetwork.speedKph[roadClass];
  const hour = ((Math.floor(opts.hourOfDay) % 24) + 24) % 24;
  const congestion = market.roadNetwork.congestionByHour[hour] ?? 1;
  // A congestion of 1.6 means the trip takes 1.6x as long → speed divided.
  const effectiveCongestion = 1 + (congestion - 1) * opts.congestionFactor;
  const kph = (baseKph * opts.speedFactor) / Math.max(0.4, effectiveCongestion);
  return (kph * 1000) / 3600;
}

interface HeapEntry {
  nodeId: string;
  priority: number;
}

/** Minimal binary heap — avoids a dependency and keeps A* honest at city scale. */
class MinHeap {
  private items: HeapEntry[] = [];

  get size() {
    return this.items.length;
  }

  push(entry: HeapEntry) {
    this.items.push(entry);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): HeapEntry | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < this.items.length && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Shortest-time path between two arbitrary points. Snaps each end to the
 * nearest graph node and stitches the off-graph tails onto the polyline so the
 * route visually terminates at the real address.
 */
export function findRoute(
  graph: RoadGraph,
  market: MarketConfig,
  from: LatLng,
  to: LatLng,
  options: Partial<RouteOptions> = {},
): Route {
  const opts: RouteOptions = { ...defaultRouteOptions, ...options };
  const startNode = nearestNode(graph, from);
  const goalNode = nearestNode(graph, to);

  if (startNode.id === goalNode.id) {
    return buildRoute([from, startNode.at, to], market, ['local'], [startNode.id], opts);
  }

  // Heuristic: straight-line time at the fastest available speed (admissible).
  const fastestMps = edgeSpeedMps(market, 'highway', opts);
  const heuristic = (nodeId: string) => haversineM(graph.nodes.get(nodeId)!.at, goalNode.at) / fastestMps;

  const cameFrom = new Map<string, { nodeId: string; edgeId: string }>();
  const gScore = new Map<string, number>([[startNode.id, 0]]);
  const open = new MinHeap();
  const closed = new Set<string>();
  open.push({ nodeId: startNode.id, priority: heuristic(startNode.id) });

  let found = false;
  let guard = 0;
  const guardLimit = graph.nodes.size * 8;

  while (open.size > 0 && guard++ < guardLimit) {
    const current = open.pop()!;
    if (current.nodeId === goalNode.id) {
      found = true;
      break;
    }
    if (closed.has(current.nodeId)) continue;
    closed.add(current.nodeId);

    const node = graph.nodes.get(current.nodeId)!;
    for (const edgeId of node.edgeIds) {
      const edge = graph.edges.get(edgeId)!;
      const neighbourId = otherEnd(edge, node.id);
      if (closed.has(neighbourId)) continue;
      const cost = edge.lengthM / edgeSpeedMps(market, edge.roadClass, opts);
      const tentative = (gScore.get(node.id) ?? Infinity) + cost;
      if (tentative < (gScore.get(neighbourId) ?? Infinity)) {
        gScore.set(neighbourId, tentative);
        cameFrom.set(neighbourId, { nodeId: node.id, edgeId });
        open.push({ nodeId: neighbourId, priority: tentative + heuristic(neighbourId) });
      }
    }
  }

  if (!found) {
    // Degenerate fallback: a direct hop, so the product never dead-ends.
    return buildRoute([from, to], market, ['arterial'], [startNode.id, goalNode.id], opts);
  }

  const nodeIds: string[] = [goalNode.id];
  const classes: RoadClass[] = [];
  let cursor = goalNode.id;
  while (cursor !== startNode.id) {
    const step = cameFrom.get(cursor);
    if (!step) break;
    classes.unshift(graph.edges.get(step.edgeId)!.roadClass);
    nodeIds.unshift(step.nodeId);
    cursor = step.nodeId;
  }

  const points = [from, ...nodeIds.map((id) => graph.nodes.get(id)!.at), to];
  const classesWithTails: RoadClass[] = ['local', ...classes, 'local'];
  return buildRoute(points, market, classesWithTails, nodeIds, opts);
}

/** Assemble a Route from a point list, computing cumulative distance and time. */
export function buildRoute(
  rawPoints: LatLng[],
  market: MarketConfig,
  segmentClasses: RoadClass[],
  nodeIds: string[],
  opts: RouteOptions,
): Route {
  // Drop zero-length repeats so downstream interpolation never divides by zero.
  const points: LatLng[] = [];
  for (const p of rawPoints) {
    const last = points[points.length - 1];
    if (!last || haversineM(last, p) > 0.5) points.push(p);
  }
  if (points.length < 2) points.push({ ...points[0], lat: points[0].lat + 0.00002 });

  const cumulativeM: number[] = [0];
  let distanceM = 0;
  let durationSec = 0;

  for (let i = 1; i < points.length; i++) {
    const segLength = haversineM(points[i - 1], points[i]);
    const roadClass = segmentClasses[Math.min(i - 1, segmentClasses.length - 1)] ?? 'local';
    distanceM += segLength;
    durationSec += segLength / edgeSpeedMps(market, roadClass, opts);
    cumulativeM.push(distanceM);
  }

  // Junction penalty: every turn costs a few seconds. Keeps ETAs believable.
  durationSec += Math.max(0, points.length - 2) * 2.5;

  return { points, cumulativeM, distanceM, durationSec, nodeIds };
}

/** Position and heading at a given distance along a route. */
export function positionAlong(route: Route, distanceM: number): { at: LatLng; heading: number; index: number } {
  const clamped = Math.max(0, Math.min(distanceM, route.distanceM));
  let i = 1;
  while (i < route.cumulativeM.length - 1 && route.cumulativeM[i] < clamped) i++;
  const segStart = route.cumulativeM[i - 1];
  const segEnd = route.cumulativeM[i];
  const t = segEnd === segStart ? 0 : (clamped - segStart) / (segEnd - segStart);
  const a = route.points[i - 1];
  const b = route.points[i];
  return { at: lerpLatLng(a, b, t), heading: bearing(a, b), index: i };
}

/** Remaining distance and time from a progress offset, at the route's average pace. */
export function remainingAlong(route: Route, distanceM: number): { distanceM: number; durationSec: number } {
  const remaining = Math.max(0, route.distanceM - distanceM);
  const pace = route.distanceM > 0 ? route.durationSec / route.distanceM : 0;
  return { distanceM: remaining, durationSec: remaining * pace };
}

/** Concatenate routes into one continuous path (multi-stop trips, batched runs). */
export function concatRoutes(routes: Route[]): Route {
  const points: LatLng[] = [];
  const cumulativeM: number[] = [];
  let distanceM = 0;
  let durationSec = 0;
  const nodeIds: string[] = [];

  for (const route of routes) {
    for (let i = 0; i < route.points.length; i++) {
      if (points.length > 0 && i === 0) continue; // avoid duplicating the join
      points.push(route.points[i]);
      cumulativeM.push(distanceM + route.cumulativeM[i]);
    }
    distanceM += route.distanceM;
    durationSec += route.durationSec;
    nodeIds.push(...route.nodeIds);
  }

  return { points, cumulativeM, distanceM, durationSec, nodeIds };
}
