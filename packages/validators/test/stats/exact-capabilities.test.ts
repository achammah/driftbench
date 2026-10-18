import { describe, expect, it } from 'vitest';
import { capabilityItems } from '../../src/ladders/stats/bank/exact-capabilities';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { holm, kappaInterval, mcnemarMidP, sampleSizeForEffect } from './capability-reference';
import { ROOT, real } from './support';

const reference = { holm, kappaInterval, mcnemarMidP, sampleSizeForEffect };
const NAMES = ['holm', 'sampleSizeForEffect', 'kappaInterval', 'mcnemarMidP'] as const;
const items = capabilityItems();
const sampleItems = items.filter((item) => item.id.startsWith('exact.sampleSizeForEffect.'));
const correct = { ...real, ...reference } as StatsImpl;

function corrupt(value: unknown): unknown {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (Array.isArray(value)) return value.length ? value.map(corrupt) : [1];
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, corrupt(v)]));
  return value;
}

describe('the explicitly planned capability items', () => {
  it('registers all 32 items for exactly the four planned exports', () => {
    expect(items).toHaveLength(32);
    expect(sampleItems).toHaveLength(8);
    expect([...new Set(items.map((item) => item.id.split('.')[1]))].sort()).toEqual([...NAMES].sort());
    const bankIds = new Set(statsBank(ROOT).map((item) => item.id));
    for (const item of items) expect(bankIds.has(item.id), item.id).toBe(true);
  });

  it.each(NAMES)('%s: missing exports fail actionably; existing exports pass positively', async (name) => {
    const group = items.filter((item) => item.id.split('.')[1] === name);
    const absent = { ...correct } as unknown as Record<string, unknown>;
    delete absent[name];
    for (const item of group) {
      const missing = await runItem(item, 1, ROOT, absent as StatsImpl);
      expect(missing.pass, item.id).toBe(false);
      expect(missing.detail).toContain(`Add \`${name}(`);
      expect(missing.detail).toContain('export it');
      expect(missing.detail).toContain('docs/concepts/statistics.md');
      for (const seed of [1, 2, 3, 856524023]) {
        const product = await runItem(item, seed, ROOT, real);
        if (typeof (real as unknown as Record<string, unknown>)[name] === 'function') {
          expect(product.pass, `${item.id}: ${product.detail}`).toBe(true);
        } else {
          expect(product.pass, item.id).toBe(false);
          expect(product.detail).toContain(`Add \`${name}(`);
        }
      }
    }
  });

  it.each(items)(
    '$id passes independent implementations on four seeds and rejects a planted defect',
    async (item) => {
      for (const seed of [1, 2, 3, 856524023]) {
        const result = await runItem(item, seed, ROOT, correct);
        expect(result.pass, `${item.id}: ${result.detail}`).toBe(true);
      }
      const name = item.id.split('.')[1] as keyof typeof reference;
      const fn = reference[name] as (...args: unknown[]) => unknown;
      let changed = false;
      const mutant = {
        ...correct,
        [name]: (...args: unknown[]) => {
          const output = fn(...args);
          const wrong = corrupt(output);
          expect(wrong).not.toEqual(output);
          changed = true;
          return wrong;
        },
      } as StatsImpl;
      const result = await runItem(item, 1, ROOT, mutant);
      expect(changed).toBe(true);
      expect(result.pass, `${item.id}: ${result.detail}`).toBe(false);
    },
  );

  it.each(sampleItems)('$id rejects a correct n plus 1e-10 before calling mde', async (item) => {
    let mdeCalls = 0;
    const fractional = {
      ...correct,
      sampleSizeForEffect: (input: Parameters<typeof reference.sampleSizeForEffect>[0]) => {
        const output = reference.sampleSizeForEffect(input);
        return { ...output, n: output.n + 1e-10 };
      },
      mde: (...args: Parameters<typeof real.mde>) => {
        mdeCalls += 1;
        return real.mde(...args);
      },
    } as StatsImpl;
    const result = await runItem(item, 1, ROOT, fractional);
    expect(result.pass, `${item.id}: ${result.detail}`).toBe(false);
    expect(result.detail).toContain('integer');
    expect(mdeCalls).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid sample count %s in all eight items',
    async (n) => {
      let mdeCalls = 0;
      const mutant = {
        ...correct,
        sampleSizeForEffect: () => ({ n, effectiveN: 1, designEffect: 1 }),
        mde: (...args: Parameters<typeof real.mde>) => {
          mdeCalls += 1;
          return real.mde(...args);
        },
      } as StatsImpl;
      for (const item of sampleItems) {
        const result = await runItem(item, 1, ROOT, mutant);
        expect(result.pass, item.id).toBe(false);
        expect(result.detail).toContain('integer');
      }
      expect(mdeCalls).toBe(0);
    },
  );

  it('retains the floating-field tolerance in all seven fixture items', async () => {
    const rounded = {
      ...correct,
      sampleSizeForEffect: (input: Parameters<typeof reference.sampleSizeForEffect>[0]) => {
        const output = reference.sampleSizeForEffect(input);
        return {
          ...output,
          effectiveN: output.effectiveN * (1 + 1e-10),
          designEffect: output.designEffect * (1 + 1e-10),
        };
      },
    } as StatsImpl;
    for (const item of sampleItems.filter((item) => !item.id.endsWith('inverse-of-mde'))) {
      const result = await runItem(item, 1, ROOT, rounded);
      expect(result.pass, `${item.id}: ${result.detail}`).toBe(true);
    }
  });
});
