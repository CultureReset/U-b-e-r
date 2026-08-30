/**
 * Destination entry. Search runs against saved places, landmarks, merchants
 * and synthesised street addresses from the live road graph — so anything the
 * rider types resolves to a point the router can actually reach.
 */
import { useMemo, useState } from 'react';
import { getMarket } from '@config';
import { haversineKm } from '@core/geo';
import type { Place } from '@core/types';
import { addressFor } from '@data/seed/places';
import { graphFor, nearestNode } from '@core/routing';
import { distance } from '@platform/format';
import { useWorld } from '@platform/store';
import { Icon } from '@ui/Icon';
import { Empty, ListRow } from '@ui/primitives';
import { nextId } from '@core/util';

export interface SearchResult extends Place {
  icon: string;
  kind: string;
  distanceKm?: number;
}

/** Ranks candidates by token match then proximity to the rider. */
export function usePlaceSearch(query: string, origin?: { lat: number; lng: number }): SearchResult[] {
  const state = useWorld((s) => s.state);
  const rider = state.riders[state.session.riderId];

  return useMemo(() => {
    const market = getMarket(state.marketId);
    const graph = graphFor(state.marketId);
    const trimmed = query.trim().toLowerCase();

    const candidates: SearchResult[] = [
      ...(rider?.savedPlaces ?? []).map((p) => ({ ...p, kind: p.kind, icon: p.icon })),
      ...state.landmarks.map((p) => ({ ...p, kind: 'landmark', icon: iconForCategory(p.category) })),
      ...Object.values(state.merchants)
        .filter((m) => m.marketId === state.marketId)
        .slice(0, 60)
        .map((m) => ({
          id: `plc_mch_${m.id}`,
          label: m.name,
          addressLine: m.addressLine,
          at: m.at,
          zoneId: m.zoneId,
          category: 'merchant',
          kind: 'merchant',
          icon: 'store',
        })),
      // Recent destinations from the rider's own history.
      ...Object.values(state.trips)
        .filter((t) => t.riderId === rider?.id && t.status === 'completed')
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
        .slice(0, 8)
        .map((t) => {
          const stop = t.stops[t.stops.length - 1];
          return { ...stop.place, kind: 'recent', icon: 'history' };
        }),
    ];

    // Street-name matches synthesise a concrete address on that street.
    if (trimmed.length >= 2) {
      for (const streetName of market.streetNames) {
        if (!streetName.toLowerCase().includes(trimmed)) continue;
        for (const edge of graph.edges.values()) {
          if (edge.name !== streetName) continue;
          const at = graph.nodes.get(edge.from)!.at;
          candidates.push({
            id: `plc_st_${edge.id}`,
            label: streetName,
            ...addressFor(state.marketId, at),
            at,
            kind: 'street',
            icon: 'pin',
          });
          break;
        }
      }
    }

    const deduped = new Map<string, SearchResult>();
    for (const candidate of candidates) {
      const key = `${candidate.label}|${candidate.addressLine}`;
      if (!deduped.has(key)) deduped.set(key, candidate);
    }

    const scored = [...deduped.values()]
      .map((candidate) => ({
        ...candidate,
        distanceKm: origin ? haversineKm(origin, candidate.at) : undefined,
      }))
      .filter((candidate) => {
        if (!trimmed) return candidate.kind !== 'street';
        return (
          candidate.label.toLowerCase().includes(trimmed) ||
          candidate.addressLine.toLowerCase().includes(trimmed) ||
          (candidate.category ?? '').toLowerCase().includes(trimmed)
        );
      });

    const rank = (r: SearchResult) => {
      const exact = r.label.toLowerCase().startsWith(trimmed) ? -100 : 0;
      const savedBoost = r.kind === 'home' || r.kind === 'work' ? -60 : r.kind === 'recent' ? -30 : 0;
      return exact + savedBoost + (r.distanceKm ?? 0);
    };

    return scored.sort((a, b) => rank(a) - rank(b)).slice(0, 14);
  }, [query, origin, state, rider]);
}

const iconForCategory = (category?: string): string => {
  switch (category) {
    case 'airport':
      return 'navigation';
    case 'park':
      return 'leaf';
    case 'shopping':
      return 'bag';
    case 'venue':
    case 'nightlife':
      return 'star';
    case 'campus':
      return 'building';
    case 'merchant':
      return 'store';
    default:
      return 'pin';
  }
};

export function PlaceSearch({
  label,
  value,
  onSelect,
  origin,
  autoFocus,
  onPickOnMap,
}: {
  label: string;
  value?: Place;
  onSelect: (place: Place) => void;
  origin?: { lat: number; lng: number };
  autoFocus?: boolean;
  onPickOnMap?: () => void;
}) {
  const [query, setQuery] = useState('');
  const results = usePlaceSearch(query, origin);

  return (
    <div className="col gap-3" style={{ minHeight: 0 }}>
      <div className="row gap-2">
        <Icon name="search" size={17} color="var(--c-text-faint)" />
        <input
          className="input grow"
          autoFocus={autoFocus}
          placeholder={label}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {onPickOnMap && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onPickOnMap}
            title="Choose a point on the map"
          >
            <Icon name="pin" size={15} />
          </button>
        )}
      </div>

      {value && (
        <div className="panel row gap-2">
          <Icon name="check" size={15} color="var(--c-positive)" />
          <span className="t-small t-truncate grow">{value.label}</span>
        </div>
      )}

      <div className="col" style={{ overflowY: 'auto' }}>
        {results.length === 0 ? (
          <Empty icon="search" title="No matches" hint="Try a street, a landmark or a business name." />
        ) : (
          results.map((result) => (
            <ListRow
              key={result.id}
              icon={result.icon}
              title={result.label}
              subtitle={result.addressLine}
              trailing={
                result.distanceKm !== undefined ? (
                  <span className="t-micro t-faint">{distance(result.distanceKm)}</span>
                ) : undefined
              }
              onClick={() =>
                onSelect({
                  id: nextId('plc'),
                  label: result.label,
                  addressLine: result.addressLine,
                  at: result.at,
                  zoneId: result.zoneId,
                  category: result.category,
                })
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Snap an arbitrary map tap to the nearest routable point and name it. */
export function placeFromPoint(marketId: string, at: { lat: number; lng: number }): Place {
  const graph = graphFor(marketId);
  const node = nearestNode(graph, at);
  const resolved = addressFor(marketId, node.at);
  return {
    id: nextId('plc'),
    label: resolved.addressLine.split(',')[0],
    addressLine: resolved.addressLine,
    zoneId: resolved.zoneId,
    at: node.at,
  };
}
