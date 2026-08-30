/**
 * Lazily-built, memoised road graphs — one per market. Building a graph is
 * ~10ms; this keeps it off every render path.
 */
import { getMarket, type MarketConfig } from '@config';
import { buildRoadGraph, type RoadGraph } from './graph';

const cache = new Map<string, RoadGraph>();

export function graphFor(marketId: string): RoadGraph {
  const existing = cache.get(marketId);
  if (existing) return existing;
  const graph = buildRoadGraph(getMarket(marketId));
  cache.set(marketId, graph);
  return graph;
}

export function marketFor(marketId: string): MarketConfig {
  return getMarket(marketId);
}

export function clearGraphCache(): void {
  cache.clear();
}
