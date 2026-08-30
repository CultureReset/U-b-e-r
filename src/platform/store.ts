/**
 * The world store.
 *
 * One store holds one live world; every surface is a view onto it. Actions are
 * expressed as mutators that receive a working draft plus a simulation
 * context, so a rider requesting a ride and the simulator dispatching it run
 * through identical code paths.
 */
import { create } from 'zustand';
import { appConfig, defaultMarketId } from '@config';
import { bus } from '@core/events';
import { actionContext, tick, type TickCtx } from '@core/sim';
import { clearGraphCache } from '@core/routing';
import type { ID, Timestamp } from '@core/types';
import { dataProvider, type WorldState } from '@data';
import { seedWorld } from '@data/seed';

export type Mutator = (draft: WorldState, ctx: TickCtx) => void;

export interface SimControls {
  running: boolean;
  /** Multiplier on simulated seconds per tick. */
  speed: number;
  ticks: number;
}

export interface WorldStore {
  state: WorldState;
  ready: boolean;
  sim: SimControls;

  /** Apply a domain action against the live world. */
  mutate(mutator: Mutator, options?: { label?: string }): void;
  /** Advance the world one step. Called by the sim loop and by the ops console. */
  step(deltaSec?: number): void;

  setRunning(running: boolean): void;
  setSpeed(speed: number): void;
  setMarket(marketId: ID): Promise<void>;
  reseed(marketId?: ID): Promise<void>;
  hydrate(): Promise<void>;

  setSessionRider(riderId: ID): void;
  setSessionDriver(driverId: ID): void;
  setSessionMerchant(merchantId: ID): void;
  setSessionOrg(orgId: ID): void;
}

const bootTime = (): Timestamp => {
  // Boot the simulated clock at the configured hour of *today*, so history
  // reads naturally against a real date but the market opens at a lively time.
  const { startHour, startMinute } = appConfig.simulation;
  if (startHour === null) return Date.now();
  const start = new Date();
  start.setHours(startHour, startMinute, 0, 0);
  return start.getTime();
};

const emptyWorld = (): WorldState => seedWorld(defaultMarketId, bootTime());

export const useWorld = create<WorldStore>((set, get) => ({
  state: emptyWorld(),
  ready: false,
  sim: { running: appConfig.simulation.enabled, speed: 1, ticks: 0 },

  mutate(mutator, options) {
    const current = get().state;
    // Shallow-clone the mutable collections; entity objects stay immutable.
    const draft: WorldState = {
      ...current,
      riders: { ...current.riders },
      drivers: { ...current.drivers },
      merchants: { ...current.merchants },
      orgs: { ...current.orgs },
      trips: { ...current.trips },
      orders: { ...current.orders },
      offers: { ...current.offers },
      ledger: [...current.ledger],
      session: { ...current.session },
    };
    const ctx = actionContext(draft);
    mutator(draft, ctx);
    if (ctx.ledger.length > 0) draft.ledger = [...draft.ledger, ...ctx.ledger];
    set({ state: draft });
    void dataProvider.save(draft);
    if (options?.label) bus.emit('system.tick', 'ui', { action: options.label }, undefined, draft.now);
  },

  step(deltaSec) {
    const { state, sim } = get();
    const delta = (deltaSec ?? appConfig.simulation.secondsPerTick) * sim.speed;
    const { state: next } = tick(state, delta);
    set({ state: next, sim: { ...sim, ticks: sim.ticks + 1 } });
    void dataProvider.save(next);
  },

  setRunning(running) {
    set({ sim: { ...get().sim, running } });
  },

  setSpeed(speed) {
    set({ sim: { ...get().sim, speed } });
  },

  async setMarket(marketId) {
    const next = await dataProvider.seed(marketId, bootTime());
    bus.clear();
    set({ state: next, ready: true });
    void dataProvider.save(next);
  },

  async reseed(marketId) {
    const target = marketId ?? get().state.marketId;
    await dataProvider.clear();
    clearGraphCache();
    bus.clear();
    const next = await dataProvider.seed(target, bootTime());
    bus.emit('system.reset', 'ops', { marketId: target }, undefined, next.now);
    set({ state: next, ready: true, sim: { ...get().sim, ticks: 0 } });
    void dataProvider.save(next);
  },

  async hydrate() {
    const restored = await dataProvider.load();
    if (restored) {
      set({ state: restored, ready: true });
      return;
    }
    const fresh = await dataProvider.seed(defaultMarketId, bootTime());
    set({ state: fresh, ready: true });
    void dataProvider.save(fresh);
  },

  setSessionRider(riderId) {
    get().mutate((draft) => {
      draft.session = { ...draft.session, riderId };
    });
  },
  setSessionDriver(driverId) {
    get().mutate((draft) => {
      draft.session = { ...draft.session, driverId };
    });
  },
  setSessionMerchant(merchantId) {
    get().mutate((draft) => {
      draft.session = { ...draft.session, merchantId };
    });
  },
  setSessionOrg(orgId) {
    get().mutate((draft) => {
      draft.session = { ...draft.session, orgId };
    });
  },
}));

/** Convenience selectors — components subscribe narrowly to avoid re-renders. */
export const useWorldState = () => useWorld((s) => s.state);
export const useSession = () => useWorld((s) => s.state.session);
export const useSimControls = () => useWorld((s) => s.sim);
export const useNow = () => useWorld((s) => s.state.now);

export const worldActions = () => useWorld.getState();

/**
 * Debug hook. The whole world is a plain object, so exposing the store makes
 * the prototype inspectable from the console — useful when reasoning about
 * dispatch decisions without instrumenting the UI.
 */
declare global {
  interface Window {
    urus?: typeof useWorld;
  }
}
if (typeof window !== 'undefined') window.urus = useWorld;
