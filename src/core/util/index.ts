export * from './random';
export * from './id';

/** Clamp helper used across pricing, dispatch and the map. */
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Round to a currency's minor unit. */
export const round2 = (value: number) => Math.round(value * 100) / 100;

/** Round to an arbitrary step (used for surge display). */
export const roundToStep = (value: number, step: number) => Math.round(value / step) * step;

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export const groupBy = <T, K extends string | number>(items: T[], key: (item: T) => K): Record<K, T[]> => {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ||= []).push(item);
  }
  return out;
};

export const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Stable sort by a numeric selector, ascending by default. */
export const sortBy = <T>(items: T[], selector: (item: T) => number, direction: 'asc' | 'desc' = 'asc'): T[] =>
  [...items].sort((a, b) => (direction === 'asc' ? selector(a) - selector(b) : selector(b) - selector(a)));
