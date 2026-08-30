/**
 * In-memory adapter with optional localStorage persistence.
 * This is the default binding; nothing in the product depends on it directly.
 */
import { appConfig } from '@config';
import type { Timestamp } from '@core/types';
import type { DataProvider, WorldState } from '@data/ports';
import { seedWorld } from '@data/seed';

const KEY = appConfig.persistence.key;

export class MemoryDataProvider implements DataProvider {
  readonly id = 'memory';
  private cache: WorldState | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  async load(): Promise<WorldState | undefined> {
    if (this.cache) return this.cache;
    if (!appConfig.persistence.enabled || typeof localStorage === 'undefined') return undefined;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as WorldState;
      // A schema bump invalidates old snapshots rather than crashing on them.
      if (parsed.version !== appConfig.persistence.version) {
        localStorage.removeItem(KEY);
        return undefined;
      }
      this.cache = parsed;
      return parsed;
    } catch {
      return undefined;
    }
  }

  async save(state: WorldState): Promise<void> {
    this.cache = state;
    if (!appConfig.persistence.enabled || typeof localStorage === 'undefined') return;
    // Debounced: the simulator writes state many times a second.
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        // Quota exceeded — drop persistence rather than breaking the session.
        try {
          localStorage.removeItem(KEY);
        } catch {
          /* nothing further to do */
        }
      }
    }, 1200);
  }

  async clear(): Promise<void> {
    this.cache = undefined;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  async seed(marketId: string, now: Timestamp): Promise<WorldState> {
    const state = seedWorld(marketId, now);
    this.cache = state;
    return state;
  }
}
