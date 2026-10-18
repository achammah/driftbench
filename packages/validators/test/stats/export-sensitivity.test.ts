import { beforeAll, describe, expect, it } from 'vitest';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import type { BankItem } from '../../src/ladders/stats/bank/item';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

type Fn = (...args: unknown[]) => unknown;
const exports = Object.entries(real).flatMap(([name, value]) =>
  typeof value === 'function' ? [[name, value as unknown as Fn] as const] : [],
);
const bank = statsBank(ROOT);
const byFunction = new Map<string, BankItem[]>();

// Discover witnesses by calls, not item naming conventions: analytic and roadmap items also count.
// Run the bank once, preserving the actual seed and only retaining passing baseline items.
beforeAll(async () => {
  for (const item of bank) {
    const called = new Set<string>();
    const traced = new Proxy(real, {
      get(target, key) {
        const value = Reflect.get(target, key);
        return typeof value === 'function'
          ? (...args: unknown[]) => {
              called.add(String(key));
              return value(...args);
            }
          : value;
      },
    }) as StatsImpl;
    if (!(await runItem(item, 1, ROOT, traced)).pass) continue;
    for (const name of called) byFunction.set(name, [...(byFunction.get(name) ?? []), item]);
  }
}, 240_000);

/** Literal relative error, including integer results; zero/Infinity remain unchanged.
 * A returned RNG is wrapped so its draws, rather than the function identity, are nudged.
 */
function nudge(value: unknown, changed: () => void): unknown {
  if (typeof value === 'number') {
    const result = value * 1.002;
    if (!Object.is(result, value)) changed();
    return result;
  }
  if (typeof value === 'function') return (...args: unknown[]) => nudge(value(...args), changed);
  if (Array.isArray(value)) return value.map((entry) => nudge(entry, changed));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, nudge(entry, changed)]));
  return value;
}

describe('every exported statistics function has literal 0.2 percent and throw witnesses', () => {
  it.each(exports)(
    '%s',
    async (name, original) => {
      const candidates = byFunction.get(name) ?? [];
      let nudged: string | undefined;
      let thrown: string | undefined;
      for (const item of candidates) {
        let changed = false;
        const mutant = {
          ...real,
          [name]: (...args: unknown[]) =>
            nudge(original(...args), () => {
              changed = true;
            }),
        } as StatsImpl;
        const nudgeFails = !(await runItem(item, 1, ROOT, mutant)).pass && changed;
        const throwing = {
          ...real,
          [name]: () => {
            throw new Error('planted export throw');
          },
        } as StatsImpl;
        const throwFails = !(await runItem(item, 1, ROOT, throwing)).pass;
        if (!thrown && throwFails) thrown = item.id;
        if (nudgeFails && throwFails) {
          // One baseline-passing item must reject both faults.
          nudged = item.id;
          thrown = item.id;
          break;
        }
      }
      console.info(JSON.stringify({ function: name, nudge: nudged ?? null, throw: thrown ?? null }));
      expect(nudged, `${name}: no passing item rejects a changed literal 0.2% output`).toBeDefined();
      expect(thrown, `${name}: no passing item rejects a throw`).toBeDefined();
    },
    120_000,
  );
});
