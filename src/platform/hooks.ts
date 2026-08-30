/**
 * Cross-surface React hooks. These are the read-side counterpart to the
 * action modules: narrow subscriptions so a moving vehicle re-renders a map,
 * not the whole console.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { bus, type WorldEventType } from '@core/events';
import type { WorldEventRecord } from '@core/types';
import type { ID } from '@core/types';
import { useWorld } from './store';

/** The identity each surface is currently acting as. */
export const useCurrentRider = () => useWorld((s) => s.state.riders[s.state.session.riderId]);
export const useCurrentDriver = () => useWorld((s) => s.state.drivers[s.state.session.driverId]);
export const useCurrentMerchant = () => useWorld((s) => s.state.merchants[s.state.session.merchantId]);
export const useCurrentOrg = () => useWorld((s) => s.state.orgs[s.state.session.orgId]);

export const useTrip = (tripId: ID | undefined) => useWorld((s) => (tripId ? s.state.trips[tripId] : undefined));
export const useOrder = (orderId: ID | undefined) => useWorld((s) => (orderId ? s.state.orders[orderId] : undefined));
export const useDriver = (driverId: ID | undefined) => useWorld((s) => (driverId ? s.state.drivers[driverId] : undefined));
export const useMerchant = (merchantId: ID | undefined) =>
  useWorld((s) => (merchantId ? s.state.merchants[merchantId] : undefined));

/** Apply a domain action without pulling the whole store into a component. */
export function useAction() {
  return useCallback(
    (mutator: Parameters<ReturnType<typeof useWorld.getState>['mutate']>[0], label?: string) => {
      useWorld.getState().mutate(mutator, label ? { label } : undefined);
    },
    [],
  );
}

/** Live tail of the event log, optionally filtered by type. */
export function useEventLog(limit = 60, types?: WorldEventType[]): WorldEventRecord[] {
  const [records, setRecords] = useState<WorldEventRecord[]>(() => bus.recent(limit));

  useEffect(() => {
    const filter = types ? (r: WorldEventRecord) => types.includes(r.type as WorldEventType) : undefined;
    setRecords(bus.recent(limit, filter));
    return bus.on('*', () => setRecords(bus.recent(limit, filter)));
  }, [limit, types]);

  return records;
}

/** Fires a callback whenever a specific event type is published. */
export function useWorldEvent(type: WorldEventType | '*', handler: (event: Parameters<Parameters<typeof bus.on>[1]>[0]) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => bus.on(type, (event) => ref.current(event)), [type]);
}

/** A value that only changes when its serialised form changes — for map data. */
export function useStable<T>(value: T, key: (value: T) => string): T {
  const signature = key(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [signature]);
}

/** Local component state that persists across reloads. */
export function usePersistentState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof localStorage === 'undefined') return initial;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep the in-memory value */
      }
    },
    [key],
  );

  return [value, set];
}

/** Re-renders on a wall-clock interval — used for countdowns on offers. */
export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

/**
 * Measures an element's height. Used to tell the map how much of the viewport
 * a bottom sheet is covering, so it can fit its content into what's left.
 */
export function useMeasuredHeight<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(node);
    setHeight(node.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, []);

  return [ref, height];
}
