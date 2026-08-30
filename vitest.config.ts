import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@data': r('./src/data'),
      '@platform': r('./src/platform'),
      '@ui': r('./src/ui'),
      '@surfaces': r('./src/surfaces'),
      '@app': r('./src/app'),
      '@config': r('./config'),
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
