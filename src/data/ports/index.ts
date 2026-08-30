/**
 * Data ports.
 *
 * `WorldState` is the entire persisted shape of the platform. `DataProvider`
 * is the contract an adapter must satisfy to back it — the in-memory adapter
 * ships by default, and the REST adapter swaps in unchanged for a real API.
 * No surface talks to an adapter directly; they all go through the store.
 */
import type {
  DispatchOffer,
  DriverProfile,
  ID,
  LedgerEntry,
  Merchant,
  Order,
  Org,
  Place,
  RiderProfile,
  Timestamp,
  Trip,
  ZoneSnapshot,
} from '@core/types';

export interface WorldState {
  /** Schema version — the persistence layer discards mismatched snapshots. */
  version: number;
  /** Simulated wall clock, in epoch ms. */
  now: Timestamp;
  marketId: ID;
  riders: Record<ID, RiderProfile>;
  drivers: Record<ID, DriverProfile>;
  merchants: Record<ID, Merchant>;
  orgs: Record<ID, Org>;
  trips: Record<ID, Trip>;
  orders: Record<ID, Order>;
  offers: Record<ID, DispatchOffer>;
  ledger: LedgerEntry[];
  zoneSnapshots: Record<ID, ZoneSnapshot>;
  /** Quick-destination suggestions derived from market landmarks. */
  landmarks: Place[];
  /** Which identity each surface is currently acting as. */
  session: {
    riderId: ID;
    driverId: ID;
    merchantId: ID;
    orgId: ID;
  };
}

export interface WorldSnapshotMeta {
  version: number;
  savedAt: number;
  marketId: ID;
}

/**
 * Storage contract. Everything is promise-based so a network adapter is a
 * drop-in replacement for the in-memory one.
 */
export interface DataProvider {
  readonly id: string;
  /** Load the persisted world, or undefined when there is nothing to restore. */
  load(): Promise<WorldState | undefined>;
  /** Persist the whole world. Adapters may debounce internally. */
  save(state: WorldState): Promise<void>;
  /** Drop any persisted world. */
  clear(): Promise<void>;
  /** Generate a fresh world for a market. */
  seed(marketId: ID, now: Timestamp): Promise<WorldState>;
}

/** Selector helpers shared by every surface. */
export const activeTrips = (state: WorldState): Trip[] =>
  Object.values(state.trips).filter((t) => !['completed', 'cancelled'].includes(t.status));

export const activeOrders = (state: WorldState): Order[] =>
  Object.values(state.orders).filter((o) => !['delivered', 'cancelled'].includes(o.status));

export const pendingOffersFor = (state: WorldState, driverId: ID): DispatchOffer[] =>
  Object.values(state.offers).filter((o) => o.driverId === driverId && o.status === 'pending');

export const offersForJob = (state: WorldState, jobId: ID): DispatchOffer[] =>
  Object.values(state.offers).filter((o) => o.jobId === jobId);

export const jobById = (state: WorldState, jobId: ID): Trip | Order | undefined =>
  state.trips[jobId] ?? state.orders[jobId];

export const driversInMarket = (state: WorldState): DriverProfile[] =>
  Object.values(state.drivers).filter((d) => d.marketId === state.marketId);

export const merchantsInMarket = (state: WorldState): Merchant[] =>
  Object.values(state.merchants).filter((m) => m.marketId === state.marketId);
