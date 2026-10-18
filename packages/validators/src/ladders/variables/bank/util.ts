/**
 * Small tools every item uses: a seeded generator, stable serialisation, deep freeze and equality, processor
 * time, and the failure type an item throws to say what went wrong.
 */

/** A seeded generator with the draws the items need. */
export type Rng = {
  /** A float in [0, 1). */
  next(): number;
  /** An integer from lo to hi, both included. */
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  /** A new array with the items in a seeded order. */
  shuffle<T>(items: readonly T[]): T[];
  /** `count` distinct items in a seeded order. */
  sample<T>(items: readonly T[], count: number): T[];
  chance(p: number): boolean;
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit hash of a string (FNV-1a). */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T,
    shuffle,
    sample: <T>(items: readonly T[], count: number): T[] => shuffle(items).slice(0, count),
    chance: (p: number) => next() < p,
  };
}

/** The generator of one item on one seed: the seed mixed with a hash of the item id. */
export function itemRng(seed: number, id: string): Rng {
  return makeRng((Math.imul(seed >>> 0, 0x9e3779b1) ^ hashString(id)) >>> 0);
}

/** A generator for a named stream inside an item, so two parts of one item never share draws. */
export function subRng(rng: Rng, label: string): Rng {
  return makeRng((Math.imul(Math.floor(rng.next() * 4294967296), 0x85ebca6b) ^ hashString(label)) >>> 0);
}

/** JSON with sorted object keys and bigint as a string: equal values give equal text. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value as object).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** JSON of a value as it is, key order included; bigint as a string. */
export function plainStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? `${v}n` : v));
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value as object))
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}

/** A deep copy through JSON (the neutral data model is JSON). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** The objects reachable from a value, by identity. */
export function reachableObjects(value: unknown, into = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !into.has(value)) {
    into.add(value);
    for (const key of Reflect.ownKeys(value as object)) {
      reachableObjects((value as Record<PropertyKey, unknown>)[key], into);
    }
  }
  return into;
}

/** What an item throws to fail with a message an executor can act on. */
export class Fail extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Fail';
  }
}

/** Fails the item with `message` unless the condition holds. */
export function must(condition: unknown, message: string | (() => string)): asserts condition {
  if (!condition) throw new Fail(typeof message === 'function' ? message() : message);
}

/** A value as items print it: short, with non-finite numbers and bigint named. */
export function show(value: unknown, limit = 200): string {
  let text: string;
  try {
    text = JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? `${v}n` : typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
    ) as string | undefined as string;
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

/** Processor time of a call in milliseconds (user and system), so a busy machine does not fail an item. */
export function cpuMs<T>(run: () => T): { value: T; ms: number } {
  const start = process.cpuUsage();
  const value = run();
  const used = process.cpuUsage(start);
  return { value, ms: (used.user + used.system) / 1000 };
}

/** Runs a call and returns its value, or the error it threw. */
export function attempt<T>(run: () => T): { value?: T; error?: Error } {
  try {
    return { value: run() };
  } catch (cause) {
    return { error: cause instanceof Error ? cause : new Error(String(cause)) };
  }
}

/** n choose k as a number (exact while it stays below 2^53). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Every k-subset of 0..n-1 as an array of indexes, in lexicographic order. */
export function* combinations(n: number, k: number): Generator<number[]> {
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k === 0) {
    yield [];
    return;
  }
  for (;;) {
    yield [...idx];
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i -= 1;
    if (i < 0) return;
    idx[i] = (idx[i] as number) + 1;
    for (let j = i + 1; j < k; j += 1) idx[j] = (idx[j - 1] as number) + 1;
  }
}

/** Every k-subset of the given items, in order. */
export function* subsetsOf<T>(items: readonly T[], k: number): Generator<T[]> {
  for (const c of combinations(items.length, k)) yield c.map((i) => items[i] as T);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
