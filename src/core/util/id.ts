/**
 * Id and human-facing code generation. Uses an injectable counter so ids are
 * deterministic under the simulation seed rather than random per run.
 */

const counters = new Map<string, number>();

export function nextId(prefix: string): string {
  const n = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, n);
  return `${prefix}_${n.toString(36).padStart(5, '0')}`;
}

export function resetIds(): void {
  counters.clear();
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short human-readable reference, e.g. "TRP-4K7QX". */
export function referenceCode(prefix: string, seedValue: number): string {
  let n = Math.abs(Math.floor(seedValue)) || 1;
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length) + 7 * (i + 1);
  }
  return `${prefix}-${out}`;
}
