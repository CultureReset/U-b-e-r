/**
 * REST adapter scaffold.
 *
 * Point `appConfig.dataAdapter` at 'rest' and set `restBaseUrl`, and the
 * platform runs against a real backend with no changes anywhere else. The
 * endpoints below are the contract a server needs to implement.
 */
import { appConfig } from '@config';
import type { Timestamp } from '@core/types';
import type { DataProvider, WorldState } from '@data/ports';
import { seedWorld } from '@data/seed';

export interface RestEndpoints {
  world: string;
  seed: string;
}

export const defaultEndpoints: RestEndpoints = { world: '/world', seed: '/world/seed' };

export class RestDataProvider implements DataProvider {
  readonly id = 'rest';

  constructor(
    private baseUrl: string = appConfig.restBaseUrl,
    private endpoints: RestEndpoints = defaultEndpoints,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  async load(): Promise<WorldState | undefined> {
    try {
      const response = await this.fetchImpl(this.url(this.endpoints.world));
      if (!response.ok) return undefined;
      return (await response.json()) as WorldState;
    } catch {
      return undefined;
    }
  }

  async save(state: WorldState): Promise<void> {
    try {
      await this.fetchImpl(this.url(this.endpoints.world), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
      });
    } catch {
      // A prototype should stay usable when the backend is unreachable.
    }
  }

  async clear(): Promise<void> {
    try {
      await this.fetchImpl(this.url(this.endpoints.world), { method: 'DELETE' });
    } catch {
      /* ignore */
    }
  }

  async seed(marketId: string, now: Timestamp): Promise<WorldState> {
    try {
      const response = await this.fetchImpl(this.url(this.endpoints.seed), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ marketId, now }),
      });
      if (response.ok) return (await response.json()) as WorldState;
    } catch {
      /* fall through to local generation */
    }
    // Falling back to the local generator keeps the prototype demonstrable
    // before a backend exists.
    return seedWorld(marketId, now);
  }
}
