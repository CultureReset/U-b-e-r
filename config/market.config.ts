/**
 * Markets (cities). A market owns its geography, its road-network generation
 * parameters, its demand zones and its tax/regulatory rules. Add a market here
 * and it becomes selectable everywhere — dispatch, pricing and the map all key
 * off this data.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ZoneConfig {
  id: string;
  name: string;
  /** Polygon in lat/lng. Used for surge, zone analytics and pickup rules. */
  polygon: LatLng[];
  /** Baseline demand weight, relative. Higher = more ambient requests originate here. */
  demandWeight: number;
  /** Baseline supply weight — where idle drivers tend to sit. */
  supplyWeight: number;
  /** Airport/venue zones can carry a fixed surcharge and a pickup queue. */
  surcharge?: { label: string; amount: number };
  queueingRequired?: boolean;
}

export interface RoadNetworkConfig {
  /** Grid resolution across the market bounds. */
  cols: number;
  rows: number;
  /** Random positional jitter applied to each node (fraction of a cell). */
  jitter: number;
  /** Every Nth line becomes a high-speed arterial. */
  arterialEvery: number;
  /** Fraction of grid edges removed to create realistic dead-ends and blocks. */
  pruneRatio: number;
  speedKph: { local: number; arterial: number; highway: number };
  /** Congestion multiplier applied to travel time by hour of day (24 entries). */
  congestionByHour: number[];
}

export interface MarketConfig {
  id: string;
  name: string;
  country: string;
  timezoneOffsetMinutes: number;
  center: LatLng;
  bounds: { north: number; south: number; east: number; west: number };
  roadNetwork: RoadNetworkConfig;
  zones: ZoneConfig[];
  /** Named landmarks used for address generation and quick destinations. */
  landmarks: { id: string; name: string; category: string; at: LatLng }[];
  streetNames: string[];
  tax: { label: string; rate: number; appliesTo: ('fare' | 'goods' | 'fees')[] };
  regulatory: { minDriverAge: number; maxVehicleAgeYears: number; backgroundCheckDays: number };
}

const bogotaBounds = { north: 4.78, south: 4.55, east: -74.02, west: -74.16 };

/** Rect helper so zone polygons stay readable. */
const rect = (n: number, s: number, e: number, w: number): LatLng[] => [
  { lat: n, lng: w },
  { lat: n, lng: e },
  { lat: s, lng: e },
  { lat: s, lng: w },
];

const flatCongestion = (
  peaks: Partial<Record<number, number>>,
  base = 1,
): number[] => Array.from({ length: 24 }, (_, h) => peaks[h] ?? base);

export const marketConfigs: MarketConfig[] = [
  {
    id: 'bog',
    name: 'Bogotá',
    country: 'CO',
    timezoneOffsetMinutes: -300,
    center: { lat: 4.6655, lng: -74.0855 },
    bounds: bogotaBounds,
    roadNetwork: {
      cols: 62,
      rows: 56,
      jitter: 0.32,
      arterialEvery: 8,
      pruneRatio: 0.16,
      speedKph: { local: 22, arterial: 40, highway: 62 },
      congestionByHour: flatCongestion(
        { 6: 1.25, 7: 1.6, 8: 1.75, 9: 1.4, 12: 1.2, 13: 1.25, 16: 1.35, 17: 1.7, 18: 1.85, 19: 1.5, 20: 1.2 },
        1,
      ),
    },
    zones: [
      {
        id: 'bog-chapinero',
        name: 'Chapinero',
        polygon: rect(4.68, 4.63, -74.045, -74.075),
        demandWeight: 3.1,
        supplyWeight: 2.4,
      },
      {
        id: 'bog-centro',
        name: 'La Candelaria',
        polygon: rect(4.63, 4.58, -74.06, -74.09),
        demandWeight: 2.4,
        supplyWeight: 1.8,
      },
      {
        id: 'bog-usaquen',
        name: 'Usaquén',
        polygon: rect(4.75, 4.68, -74.02, -74.06),
        demandWeight: 2.2,
        supplyWeight: 1.9,
      },
      {
        id: 'bog-teusaquillo',
        name: 'Teusaquillo',
        polygon: rect(4.66, 4.61, -74.075, -74.105),
        demandWeight: 1.6,
        supplyWeight: 1.4,
      },
      {
        id: 'bog-fontibon',
        name: 'Fontibón',
        polygon: rect(4.71, 4.66, -74.12, -74.16),
        demandWeight: 1.1,
        supplyWeight: 1.0,
      },
      {
        id: 'bog-eldorado',
        name: 'El Dorado Airport',
        polygon: rect(4.71, 4.68, -74.13, -74.16),
        demandWeight: 2.8,
        supplyWeight: 0.7,
        surcharge: { label: 'Airport access fee', amount: 4.2 },
        queueingRequired: true,
      },
    ],
    landmarks: [
      { id: 'bog-lm-1', name: 'El Dorado International', category: 'airport', at: { lat: 4.7016, lng: -74.1469 } },
      { id: 'bog-lm-2', name: 'Zona T', category: 'nightlife', at: { lat: 4.6669, lng: -74.0533 } },
      { id: 'bog-lm-3', name: 'Plaza de Bolívar', category: 'landmark', at: { lat: 4.5981, lng: -74.0761 } },
      { id: 'bog-lm-4', name: 'Parque Simón Bolívar', category: 'park', at: { lat: 4.6580, lng: -74.0930 } },
      { id: 'bog-lm-5', name: 'Centro Andino', category: 'shopping', at: { lat: 4.6669, lng: -74.0547 } },
      { id: 'bog-lm-6', name: 'Universidad Nacional', category: 'campus', at: { lat: 4.6362, lng: -74.0836 } },
      { id: 'bog-lm-7', name: 'Movistar Arena', category: 'venue', at: { lat: 4.6494, lng: -74.0779 } },
      { id: 'bog-lm-8', name: 'Usaquén Market', category: 'market', at: { lat: 4.6950, lng: -74.0305 } },
    ],
    streetNames: [
      'Calle 26', 'Carrera 7', 'Avenida Caracas', 'Calle 72', 'Carrera 15', 'Autopista Norte',
      'Calle 100', 'Carrera 11', 'Avenida Boyacá', 'Calle 53', 'Carrera 30', 'Calle 85',
      'Avenida Suba', 'Carrera 68', 'Calle 45', 'Diagonal 61',
    ],
    tax: { label: 'IVA', rate: 0.19, appliesTo: ['goods', 'fees'] },
    regulatory: { minDriverAge: 21, maxVehicleAgeYears: 12, backgroundCheckDays: 365 },
  },
  {
    id: 'sfo',
    name: 'San Francisco',
    country: 'US',
    timezoneOffsetMinutes: -420,
    center: { lat: 37.7749, lng: -122.4194 },
    bounds: { north: 37.81, south: 37.71, east: -122.36, west: -122.51 },
    roadNetwork: {
      cols: 54,
      rows: 44,
      jitter: 0.24,
      arterialEvery: 8,
      pruneRatio: 0.12,
      speedKph: { local: 26, arterial: 45, highway: 78 },
      congestionByHour: flatCongestion(
        { 7: 1.45, 8: 1.7, 9: 1.35, 12: 1.15, 16: 1.4, 17: 1.75, 18: 1.7, 19: 1.35 },
        1,
      ),
    },
    zones: [
      { id: 'sfo-soma', name: 'SoMa', polygon: rect(37.79, 37.765, -122.39, -122.42), demandWeight: 3.3, supplyWeight: 2.6 },
      { id: 'sfo-mission', name: 'Mission', polygon: rect(37.77, 37.745, -122.40, -122.43), demandWeight: 2.7, supplyWeight: 2.2 },
      { id: 'sfo-marina', name: 'Marina', polygon: rect(37.81, 37.79, -122.42, -122.46), demandWeight: 1.8, supplyWeight: 1.5 },
      { id: 'sfo-sunset', name: 'Sunset', polygon: rect(37.77, 37.74, -122.46, -122.51), demandWeight: 1.2, supplyWeight: 1.1 },
      {
        id: 'sfo-downtown',
        name: 'Financial District',
        polygon: rect(37.80, 37.786, -122.39, -122.41),
        demandWeight: 3.0,
        supplyWeight: 2.1,
      },
    ],
    landmarks: [
      { id: 'sfo-lm-1', name: 'Ferry Building', category: 'landmark', at: { lat: 37.7955, lng: -122.3937 } },
      { id: 'sfo-lm-2', name: 'Oracle Park', category: 'venue', at: { lat: 37.7786, lng: -122.3893 } },
      { id: 'sfo-lm-3', name: 'Dolores Park', category: 'park', at: { lat: 37.7596, lng: -122.4269 } },
      { id: 'sfo-lm-4', name: 'Union Square', category: 'shopping', at: { lat: 37.7880, lng: -122.4075 } },
      { id: 'sfo-lm-5', name: 'Golden Gate Park', category: 'park', at: { lat: 37.7694, lng: -122.4862 } },
      { id: 'sfo-lm-6', name: 'Chase Center', category: 'venue', at: { lat: 37.7680, lng: -122.3877 } },
    ],
    streetNames: [
      'Market St', 'Mission St', 'Valencia St', 'Van Ness Ave', 'Geary Blvd', 'Folsom St',
      'Howard St', '3rd St', 'Divisadero St', 'Fillmore St', 'Bryant St', 'Lombard St',
      '19th Ave', 'Cesar Chavez St', 'Polk St', 'Haight St',
    ],
    tax: { label: 'Sales tax', rate: 0.0863, appliesTo: ['goods'] },
    regulatory: { minDriverAge: 21, maxVehicleAgeYears: 15, backgroundCheckDays: 365 },
  },
];

export const defaultMarketId = 'bog';
