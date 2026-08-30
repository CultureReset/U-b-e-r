/**
 * Deterministic pseudo-random source.
 * The whole world is generated from a single seed, so a given config always
 * produces an identical world — essential for reproducible demos and tests.
 */

export interface Rng {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  float(min: number, max: number): number;
  bool(probability?: number): boolean;
  pick<T>(items: readonly T[]): T;
  pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T;
  sample<T>(items: readonly T[], count: number): T[];
  shuffle<T>(items: readonly T[]): T[];
  /** Approximately normal via central limit; clamped to [min, max]. */
  gaussian(mean: number, spread: number, min?: number, max?: number): number;
  fork(salt: number | string): Rng;
}

const hashString = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** mulberry32 — small, fast, good enough for content generation. */
export function createRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;

  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min)) + min,
    float: (min, max) => next() * (max - min) + min,
    bool: (p = 0.5) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    pickWeighted: (items, weight) => {
      const total = items.reduce((acc, item) => acc + Math.max(0, weight(item)), 0);
      if (total <= 0) return items[0];
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, weight(item));
        if (roll <= 0) return item;
      }
      return items[items.length - 1];
    },
    sample: (items, count) => rng.shuffle(items).slice(0, Math.min(count, items.length)),
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    gaussian: (mean, spread, min = -Infinity, max = Infinity) => {
      const u = (next() + next() + next() + next() - 2) / 2;
      return Math.min(max, Math.max(min, mean + u * spread * 1.6));
    },
    // Forking consumes randomness from the parent, so successive forks with
    // the same salt produce different streams — otherwise every entity
    // generated in a loop would come out identical.
    fork: (salt) => createRng(hashString(`${state}:${salt}:${next()}`)),
  };

  return rng;
}
