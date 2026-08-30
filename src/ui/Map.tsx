/**
 * Map renderer.
 *
 * Draws the market's *actual* road graph, zone polygons, routes and live
 * vehicles as SVG. Because the geometry comes from the same graph the router
 * plans on, what the user sees is what the simulation is doing — a car turns
 * where the route turns.
 *
 * The renderer is deliberately provider-free: no tile server, no API key, no
 * network. `MapProvider` below documents the seam where a real basemap
 * (Mapbox, MapLibre, Google) would slot in.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { getMarket, type LatLng } from '@config';
import { boundsOf, project, unproject, type Bounds } from '@core/geo';
import { graphFor } from '@core/routing';
import type { Route } from '@core/types';
import { Icon, type IconName } from './Icon';

export interface MapMarker {
  id: string;
  at: LatLng;
  kind: 'pickup' | 'dropoff' | 'merchant' | 'vehicle' | 'waypoint' | 'poi' | 'user';
  label?: string;
  /** Vehicle heading in degrees, for the directional puck. */
  heading?: number;
  icon?: IconName | string;
  color?: string;
  emphasis?: boolean;
  onClick?: () => void;
}

export interface MapRoute {
  id: string;
  route: Route;
  /** 'planned' is the dashed approach leg, 'active' the solid trip line. */
  variant?: 'planned' | 'active' | 'ghost';
  color?: string;
}

export interface MapZoneOverlay {
  id: string;
  polygon: LatLng[];
  /** 0–1 intensity used for the heat fill. */
  intensity: number;
  label?: string;
}

export interface MapProps {
  marketId: string;
  markers?: MapMarker[];
  routes?: MapRoute[];
  zones?: MapZoneOverlay[];
  /** Fit the viewport to these points on mount and whenever they change. */
  fitTo?: LatLng[];
  /** Keep this point centred as it moves (follow mode). */
  follow?: LatLng;
  interactive?: boolean;
  showRoads?: boolean;
  showLegend?: ReactNode;
  padding?: number;
  className?: string;
  style?: CSSProperties;
  onSelectPoint?: (at: LatLng) => void;
  children?: ReactNode;
}

/**
 * The seam for a real basemap. Implement this and render it beneath the SVG
 * overlay; every marker and route above is already in lat/lng.
 */
export interface MapProvider {
  id: string;
  render(bounds: Bounds, size: { width: number; height: number }): ReactNode;
}

const ROAD_WIDTH = { local: 1.4, arterial: 2.8, highway: 4.4 } as const;

/** ~0.012° of latitude is a little over a kilometre — a sane minimum viewport. */
const MIN_SPAN_DEG = 0.012;

/** Local streets draw once the viewport is under roughly ten kilometres tall;
 *  above that they collapse into noise and only arterials carry the shape. */
const LOCAL_ROAD_SPAN_DEG = 0.1;

const atLeastSpan = (bounds: Bounds, minSpan: number): Bounds => {
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  const latPad = Math.max(0, (minSpan - latSpan) / 2);
  const lngPad = Math.max(0, (minSpan - lngSpan) / 2);
  return {
    north: bounds.north + latPad,
    south: bounds.south - latPad,
    east: bounds.east + lngPad,
    west: bounds.west - lngPad,
  };
};

interface Viewport {
  bounds: Bounds;
  /** Zoom multiplier applied around the viewport centre. */
  zoom: number;
  /** Pan offset in normalised units. */
  offset: { x: number; y: number };
}

const expand = (bounds: Bounds, ratio: number): Bounds => {
  const latPad = ((bounds.north - bounds.south) * (ratio - 1)) / 2;
  const lngPad = ((bounds.east - bounds.west) * (ratio - 1)) / 2;
  return {
    north: bounds.north + latPad,
    south: bounds.south - latPad,
    east: bounds.east + lngPad,
    west: bounds.west - lngPad,
  };
};

const centreOn = (bounds: Bounds, at: LatLng): Bounds => {
  const halfLat = (bounds.north - bounds.south) / 2;
  const halfLng = (bounds.east - bounds.west) / 2;
  return { north: at.lat + halfLat, south: at.lat - halfLat, east: at.lng + halfLng, west: at.lng - halfLng };
};

export const Map = memo(function Map({
  marketId,
  markers = [],
  routes = [],
  zones = [],
  fitTo,
  follow,
  interactive = true,
  showRoads = true,
  showLegend,
  padding = 0.28,
  className = '',
  style,
  onSelectPoint,
  children,
}: MapProps) {
  const market = getMarket(marketId);
  const graph = useMemo(() => graphFor(marketId), [marketId]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 400 });

  // Base viewport: either the fitted geometry or the whole market.
  const fitSignature = fitTo?.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|') ?? '';
  const baseBounds = useMemo<Bounds>(() => {
    if (!fitTo || fitTo.length === 0) return market.bounds;
    // Never fit tighter than a city block or two — a cluster of points at
    // almost the same spot would otherwise zoom into featureless space.
    return atLeastSpan(boundsOf(fitTo, padding), MIN_SPAN_DEG);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignature, marketId, padding]);

  const [viewport, setViewport] = useState<Viewport>({ bounds: baseBounds, zoom: 1, offset: { x: 0, y: 0 } });

  useEffect(() => {
    setViewport({ bounds: baseBounds, zoom: 1, offset: { x: 0, y: 0 } });
  }, [baseBounds]);

  // Follow mode recentres without changing the zoom the user chose.
  const followKey = follow ? `${follow.lat.toFixed(4)},${follow.lng.toFixed(4)}` : '';
  useEffect(() => {
    if (!follow) return;
    setViewport((v) => ({ ...v, bounds: centreOn(v.bounds, follow), offset: { x: 0, y: 0 } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** Effective bounds after zoom + pan. */
  const bounds = useMemo<Bounds>(() => {
    const zoomed = expand(viewport.bounds, 1 / viewport.zoom);
    const latSpan = zoomed.north - zoomed.south;
    const lngSpan = zoomed.east - zoomed.west;
    return {
      north: zoomed.north + viewport.offset.y * latSpan,
      south: zoomed.south + viewport.offset.y * latSpan,
      east: zoomed.east - viewport.offset.x * lngSpan,
      west: zoomed.west - viewport.offset.x * lngSpan,
    };
  }, [viewport]);

  // Correct for the aspect ratio so the city is never stretched.
  const aspectBounds = useMemo<Bounds>(() => {
    const latSpan = bounds.north - bounds.south;
    const lngSpan = bounds.east - bounds.west;
    if (size.width === 0 || size.height === 0 || latSpan === 0 || lngSpan === 0) return bounds;
    const viewAspect = size.width / size.height;
    const dataAspect = lngSpan / latSpan;
    if (dataAspect > viewAspect) {
      const targetLat = lngSpan / viewAspect;
      const pad = (targetLat - latSpan) / 2;
      return { ...bounds, north: bounds.north + pad, south: bounds.south - pad };
    }
    const targetLng = latSpan * viewAspect;
    const pad = (targetLng - lngSpan) / 2;
    return { ...bounds, east: bounds.east + pad, west: bounds.west - pad };
  }, [bounds, size]);

  const toXY = useCallback(
    (p: LatLng) => {
      const { x, y } = project(p, aspectBounds);
      return { x: x * size.width, y: y * size.height };
    },
    [aspectBounds, size],
  );

  /* ------------------------------ Interaction ----------------------------- */

  const dragRef = useRef<{ x: number; y: number; startOffset: { x: number; y: number } } | null>(null);
  const movedRef = useRef(false);

  const onPointerDown = (event: React.PointerEvent) => {
    if (!interactive) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, startOffset: viewport.offset };
    movedRef.current = false;
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !interactive) return;
    const dx = (event.clientX - drag.x) / size.width;
    const dy = (event.clientY - drag.y) / size.height;
    if (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004) movedRef.current = true;
    setViewport((v) => ({ ...v, offset: { x: drag.startOffset.x + dx, y: drag.startOffset.y + dy } }));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const wasDragging = movedRef.current;
    dragRef.current = null;
    if (!interactive || wasDragging || !onSelectPoint) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    onSelectPoint(unproject(x, y, aspectBounds));
  };

  const zoomBy = (factor: number) =>
    setViewport((v) => ({ ...v, zoom: Math.max(0.6, Math.min(14, v.zoom * factor)) }));

  const onWheel = (event: React.WheelEvent) => {
    if (!interactive) return;
    zoomBy(event.deltaY < 0 ? 1.16 : 1 / 1.16);
  };

  const resetView = () => setViewport({ bounds: baseBounds, zoom: 1, offset: { x: 0, y: 0 } });

  /* -------------------------------- Roads --------------------------------- */

  // Only draw the streets actually inside the viewport, and drop minor roads
  // when zoomed out — otherwise a 600-node graph paints 1,200 useless lines.
  const roadPaths = useMemo(() => {
    if (!showRoads) return { local: '', arterial: '', highway: '' };
    const latPad = (aspectBounds.north - aspectBounds.south) * 0.1;
    const lngPad = (aspectBounds.east - aspectBounds.west) * 0.1;
    const view = {
      north: aspectBounds.north + latPad,
      south: aspectBounds.south - latPad,
      east: aspectBounds.east + lngPad,
      west: aspectBounds.west - lngPad,
    };
    const visible = (p: LatLng) =>
      p.lat <= view.north && p.lat >= view.south && p.lng <= view.east && p.lng >= view.west;

    const parts: Record<string, string[]> = { local: [], arterial: [], highway: [] };
    // Level of detail follows the geographic span actually on screen, not the
    // zoom multiplier — a map fitted to two adjacent stops is already close in.
    const showLocal = aspectBounds.north - aspectBounds.south < LOCAL_ROAD_SPAN_DEG;

    for (const edge of graph.edges.values()) {
      if (edge.roadClass === 'local' && !showLocal) continue;
      const a = graph.nodes.get(edge.from)!.at;
      const b = graph.nodes.get(edge.to)!.at;
      if (!visible(a) && !visible(b)) continue;
      const pa = toXY(a);
      const pb = toXY(b);
      parts[edge.roadClass].push(`M${pa.x.toFixed(1)} ${pa.y.toFixed(1)}L${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`);
    }
    return {
      local: parts.local.join(''),
      arterial: parts.arterial.join(''),
      highway: parts.highway.join(''),
    };
  }, [graph, aspectBounds, toXY, showRoads]);

  const routePath = useCallback(
    (route: Route) => {
      if (route.points.length === 0) return '';
      return route.points
        .map((p, i) => {
          const { x, y } = toXY(p);
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join('');
    },
    [toXY],
  );

  return (
    <div
      ref={containerRef}
      className={`map ${className}`}
      style={{ ...style, cursor: interactive ? (onSelectPoint ? 'crosshair' : 'grab') : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (dragRef.current = null)}
      onWheel={onWheel}
    >
      <svg width={size.width} height={size.height} role="img" aria-label={`${market.name} map`}>
        <defs>
          <filter id="marker-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodOpacity="0.28" />
          </filter>
        </defs>

        {/* Zone heat, beneath the streets so roads stay readable. */}
        {zones.map((zone) => (
          <polygon
            key={zone.id}
            points={zone.polygon.map((p) => { const { x, y } = toXY(p); return `${x},${y}`; }).join(' ')}
            fill={`color-mix(in srgb, var(--c-danger) ${Math.round(zone.intensity * 34)}%, transparent)`}
            stroke={`color-mix(in srgb, var(--c-danger) ${Math.round(zone.intensity * 55)}%, transparent)`}
            strokeWidth={1}
          />
        ))}

        {/* Roads, thickest class last so junctions look right. */}
        {showRoads && (
          <g strokeLinecap="round">
            <path d={roadPaths.local} stroke="var(--c-map-road)" strokeWidth={ROAD_WIDTH.local} fill="none" />
            <path d={roadPaths.arterial} stroke="var(--c-map-arterial)" strokeWidth={ROAD_WIDTH.arterial} fill="none" />
            <path d={roadPaths.highway} stroke="var(--c-map-arterial)" strokeWidth={ROAD_WIDTH.highway} fill="none" />
          </g>
        )}

        {/* Routes: casing then stroke, so lines read over any background. */}
        {routes.map((item) => {
          const d = routePath(item.route);
          if (!d) return null;
          const color = item.color ?? (item.variant === 'planned' ? 'var(--c-text-muted)' : 'var(--accent-surface, var(--c-info))');
          const ghost = item.variant === 'ghost';
          return (
            <g key={item.id} opacity={ghost ? 0.32 : 1}>
              <path d={d} stroke="var(--c-map-land)" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
              <path
                d={d}
                stroke={color}
                strokeWidth={item.variant === 'planned' ? 3 : 4}
                strokeDasharray={item.variant === 'planned' ? '7 6' : undefined}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* Markers. */}
        {markers.map((marker) => (
          <MarkerGlyph key={marker.id} marker={marker} position={toXY(marker.at)} />
        ))}
      </svg>

      {interactive && (
        <div className="map-controls">
          <button className="map-control" onClick={() => zoomBy(1.35)} aria-label="Zoom in" type="button">
            <Icon name="plus" size={15} />
          </button>
          <button className="map-control" onClick={() => zoomBy(1 / 1.35)} aria-label="Zoom out" type="button">
            <Icon name="minus" size={15} />
          </button>
          <button className="map-control" onClick={resetView} aria-label="Reset view" type="button">
            <Icon name="target" size={15} />
          </button>
        </div>
      )}

      {showLegend && <div className="map-legend">{showLegend}</div>}
      {children}
    </div>
  );
});

/* -------------------------------- Markers -------------------------------- */

const MarkerGlyph = memo(function MarkerGlyph({
  marker,
  position,
}: {
  marker: MapMarker;
  position: { x: number; y: number };
}) {
  const { x, y } = position;
  const clickable = Boolean(marker.onClick);

  if (marker.kind === 'vehicle') {
    const color = marker.color ?? 'var(--c-text)';
    return (
      <g
        transform={`translate(${x} ${y})`}
        style={{ transition: 'transform 480ms linear', cursor: clickable ? 'pointer' : 'default' }}
        onClick={marker.onClick}
        filter="url(#marker-shadow)"
      >
        <circle r={marker.emphasis ? 11 : 8.5} fill={color} />
        <circle r={marker.emphasis ? 11 : 8.5} fill="none" stroke="var(--c-surface)" strokeWidth={2} />
        {/* Heading arrow — shows which way the vehicle is actually travelling. */}
        <path
          d="M0 -4.6 L3.1 2.4 L0 0.9 L-3.1 2.4 Z"
          fill="var(--c-surface)"
          transform={`rotate(${marker.heading ?? 0})`}
        />
        {marker.emphasis && (
          <circle r={17} fill="none" stroke={color} strokeWidth={1.5} opacity={0.4}>
            <animate attributeName="r" values="13;22;13" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
          </circle>
        )}
      </g>
    );
  }

  if (marker.kind === 'user') {
    return (
      <g transform={`translate(${x} ${y})`}>
        <circle r={16} fill="var(--c-info)" opacity={0.18} />
        <circle r={6.5} fill="var(--c-info)" stroke="var(--c-surface)" strokeWidth={2.5} />
      </g>
    );
  }

  const tone =
    marker.color ??
    (marker.kind === 'pickup'
      ? 'var(--c-positive)'
      : marker.kind === 'dropoff'
        ? 'var(--c-text)'
        : marker.kind === 'merchant'
          ? 'var(--c-warning)'
          : 'var(--c-text-muted)');

  const isPin = marker.kind === 'pickup' || marker.kind === 'dropoff' || marker.kind === 'merchant';

  return (
    <g
      transform={`translate(${x} ${y})`}
      onClick={marker.onClick}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      filter="url(#marker-shadow)"
    >
      {isPin ? (
        <>
          <path d="M0 0 C-8 -9 -9.5 -13 -9.5 -16.5 A9.5 9.5 0 1 1 9.5 -16.5 C9.5 -13 8 -9 0 0 Z" fill={tone} />
          <circle cy={-16.5} r={3.6} fill="var(--c-surface)" />
        </>
      ) : (
        <>
          <circle r={6} fill={tone} />
          <circle r={6} fill="none" stroke="var(--c-surface)" strokeWidth={1.6} />
        </>
      )}
      {marker.label && (
        <text
          y={isPin ? 13 : 17}
          textAnchor="middle"
          fontSize={10.5}
          fontWeight={620}
          fill="var(--c-text)"
          stroke="var(--c-map-land)"
          strokeWidth={2.6}
          paintOrder="stroke"
        >
          {marker.label}
        </text>
      )}
    </g>
  );
});
