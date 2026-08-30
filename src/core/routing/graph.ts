/**
 * Road network generation.
 *
 * A market's road graph is *derived* from its config (grid size, jitter,
 * arterial spacing, prune ratio) rather than shipped as data. That keeps the
 * geography modular: change `roadNetwork` in market.config and the streets,
 * the routes, the ETAs and the map redraw themselves.
 */
import type { LatLng, MarketConfig } from '@config';
import { haversineM, unproject, project, distanceToSegmentM } from '@core/geo';
import { createRng } from '@core/util';

export type RoadClass = 'local' | 'arterial' | 'highway';

export interface RoadNode {
  id: string;
  at: LatLng;
  col: number;
  row: number;
  /** Indices into `edges` incident to this node. */
  edgeIds: string[];
}

export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  lengthM: number;
  roadClass: RoadClass;
  /** Street name for address synthesis and turn-by-turn text. */
  name: string;
}

export interface RoadGraph {
  marketId: string;
  nodes: Map<string, RoadNode>;
  edges: Map<string, RoadEdge>;
  /** Spatial bucket index for nearest-node lookups. */
  index: { cols: number; rows: number; buckets: Map<string, string[]> };
  bounds: { north: number; south: number; east: number; west: number };
  /** Ordered node ids, useful for deterministic iteration. */
  nodeIds: string[];
}

const nodeKey = (col: number, row: number) => `n${col}.${row}`;
const edgeKey = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);
const bucketKey = (cx: number, cy: number) => `${cx}:${cy}`;

export function buildRoadGraph(market: MarketConfig): RoadGraph {
  const cfg = market.roadNetwork;
  const rng = createRng(`${market.id}:roads`);
  const nodes = new Map<string, RoadNode>();
  const edges = new Map<string, RoadEdge>();
  const nodeIds: string[] = [];

  // Lay out a jittered lattice inside the market bounds.
  for (let row = 0; row < cfg.rows; row++) {
    for (let col = 0; col < cfg.cols; col++) {
      const jx = (rng.next() - 0.5) * cfg.jitter;
      const jy = (rng.next() - 0.5) * cfg.jitter;
      const x = (col + 0.5 + jx) / cfg.cols;
      const y = (row + 0.5 + jy) / cfg.rows;
      const at = unproject(x, y, market.bounds);
      const id = nodeKey(col, row);
      nodes.set(id, { id, at, col, row, edgeIds: [] });
      nodeIds.push(id);
    }
  }

  const classOf = (col: number, row: number, horizontal: boolean): RoadClass => {
    const line = horizontal ? row : col;
    if (line % (cfg.arterialEvery * 2) === 0) return 'highway';
    if (line % cfg.arterialEvery === 0) return 'arterial';
    return 'local';
  };

  const nameFor = (line: number, horizontal: boolean): string => {
    const pool = market.streetNames;
    const idx = (line * (horizontal ? 3 : 5) + (horizontal ? 0 : 1)) % pool.length;
    return pool[idx];
  };

  const link = (aId: string, bId: string, roadClass: RoadClass, name: string) => {
    const a = nodes.get(aId);
    const b = nodes.get(bId);
    if (!a || !b) return;
    const id = edgeKey(aId, bId);
    if (edges.has(id)) return;
    edges.set(id, { id, from: aId, to: bId, lengthM: haversineM(a.at, b.at), roadClass, name });
    a.edgeIds.push(id);
    b.edgeIds.push(id);
  };

  for (let row = 0; row < cfg.rows; row++) {
    for (let col = 0; col < cfg.cols; col++) {
      const id = nodeKey(col, row);
      if (col + 1 < cfg.cols) {
        const rc = classOf(col, row, true);
        // Arterials are never pruned — they keep the network connected.
        if (rc !== 'local' || rng.next() > cfg.pruneRatio) {
          link(id, nodeKey(col + 1, row), rc, nameFor(row, true));
        }
      }
      if (row + 1 < cfg.rows) {
        const rc = classOf(col, row, false);
        if (rc !== 'local' || rng.next() > cfg.pruneRatio) {
          link(id, nodeKey(col, row + 1), rc, nameFor(col, false));
        }
      }
    }
  }

  // Repair isolated nodes so routing can never strand a pickup.
  for (const node of nodes.values()) {
    if (node.edgeIds.length > 0) continue;
    const candidates = [
      nodeKey(node.col + 1, node.row),
      nodeKey(node.col - 1, node.row),
      nodeKey(node.col, node.row + 1),
      nodeKey(node.col, node.row - 1),
    ].filter((id) => nodes.has(id));
    if (candidates.length) link(node.id, candidates[0], 'local', nameFor(node.row, true));
  }

  // Spatial index for nearest-node queries.
  const indexCols = Math.max(4, Math.round(cfg.cols / 2));
  const indexRows = Math.max(4, Math.round(cfg.rows / 2));
  const buckets = new Map<string, string[]>();
  for (const node of nodes.values()) {
    const p = project(node.at, market.bounds);
    const cx = Math.min(indexCols - 1, Math.max(0, Math.floor(p.x * indexCols)));
    const cy = Math.min(indexRows - 1, Math.max(0, Math.floor(p.y * indexRows)));
    const key = bucketKey(cx, cy);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(node.id);
  }

  return {
    marketId: market.id,
    nodes,
    edges,
    nodeIds,
    bounds: market.bounds,
    index: { cols: indexCols, rows: indexRows, buckets },
  };
}

/** Nearest graph node to an arbitrary point, searching outward by bucket ring. */
export function nearestNode(graph: RoadGraph, point: LatLng): RoadNode {
  const p = project(point, graph.bounds);
  const cx = Math.min(graph.index.cols - 1, Math.max(0, Math.floor(p.x * graph.index.cols)));
  const cy = Math.min(graph.index.rows - 1, Math.max(0, Math.floor(p.y * graph.index.rows)));

  let best: RoadNode | undefined;
  let bestDist = Infinity;

  for (let ring = 0; ring < Math.max(graph.index.cols, graph.index.rows); ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const ids = graph.index.buckets.get(bucketKey(cx + dx, cy + dy));
        if (!ids) continue;
        for (const id of ids) {
          const node = graph.nodes.get(id)!;
          const d = haversineM(point, node.at);
          if (d < bestDist) {
            bestDist = d;
            best = node;
          }
        }
      }
    }
    // One extra ring past the first hit guards against bucket-edge misses.
    if (best && ring > 0) break;
  }

  return best ?? graph.nodes.get(graph.nodeIds[0])!;
}

/** The edge whose geometry passes closest to a point — used for addressing. */
export function nearestEdge(graph: RoadGraph, point: LatLng): { edge: RoadEdge; distanceM: number; t: number } | undefined {
  const node = nearestNode(graph, point);
  let best: { edge: RoadEdge; distanceM: number; t: number } | undefined;
  for (const edgeId of node.edgeIds) {
    const edge = graph.edges.get(edgeId)!;
    const a = graph.nodes.get(edge.from)!.at;
    const b = graph.nodes.get(edge.to)!.at;
    const { distanceM, t } = distanceToSegmentM(point, a, b);
    if (!best || distanceM < best.distanceM) best = { edge, distanceM, t };
  }
  return best;
}

export const otherEnd = (edge: RoadEdge, nodeId: string) => (edge.from === nodeId ? edge.to : edge.from);
