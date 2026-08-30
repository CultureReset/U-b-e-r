import { appConfig } from '@config';
import type { DataProvider } from './ports';
import { MemoryDataProvider } from './adapters/memory';
import { RestDataProvider } from './adapters/rest';

export * from './ports';

/** Binds the adapter named in app.config. Swap the name, swap the backend. */
export function createDataProvider(): DataProvider {
  switch (appConfig.dataAdapter) {
    case 'rest':
      return new RestDataProvider();
    case 'memory':
    default:
      return new MemoryDataProvider();
  }
}

export const dataProvider = createDataProvider();
