import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { userCapabilityItems } from '../../src/ladders/stats/bank/exact-user-capabilities';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

const items = userCapabilityItems();
const families = items.filter((item) => item.id.includes('simulateFamilyCoverage'));
const bootstrap = items.filter((item) => item.id.includes('bootstrapCI'));
type Fn = (...args: unknown[]) => unknown;

it.each(['simulateFamilyCoverage', 'bootstrapCI'])('%s has the documented user capability items', (name) => {
  const items = statsBank(ROOT).filter((item) => item.id.startsWith(`exact.${name}.user-`));
  expect(items.length).toBeGreaterThan(0);
});

it('groups six cases under three shared implementation causes', () => {
  expect(items).toHaveLength(6);
  expect(new Set(items.map((item) => item.cause)).size).toBe(3);
});

describe('documented capabilities against independent references', () => {
  it.each(items)('$id passes the product on four seeds', async (item) => {
    for (const seed of [1, 2, 3, 856524023]) {
      const result = await runItem(item, seed, ROOT, real);
      expect(result.pass, `${item.id} seed ${seed}: ${result.detail}`).toBe(true);
    }
  });

  it.each(items)('$id rejects an actual 0.2% output change and a throw', async (item) => {
    const name = item.id.split('.')[1] as string;
    const original = (real as unknown as Record<string, Fn>)[name] as Fn;
    let changed = false;
    const mutant = {
      ...real,
      [name]: (...args: unknown[]) => {
        const output = original(...args) as Record<string, unknown>;
        // Bootstrap's one-cluster sum is an integer: deliberately nudge interval fields too.
        const result =
          name === 'bootstrapCI'
            ? {
                ...output,
                estimate: (output.estimate as number) * 1.002,
                lower: (output.lower as number) * 1.002,
                upper: (output.upper as number) * 1.002,
              }
            : {
                ...output,
                width: Object.fromEntries(
                  Object.entries(output.width as Record<string, number>).map(([method, width]) => [
                    method,
                    width * 1.002,
                  ]),
                ),
              };
        expect(isDeepStrictEqual(output, result), 'a no-op is not a mutant').toBe(false);
        changed = true;
        return result;
      },
    } as StatsImpl;
    expect((await runItem(item, 1, ROOT, mutant)).pass).toBe(false);
    expect(changed).toBe(true);
    const thrown = {
      ...real,
      [name]: () => {
        throw new Error('planted throw');
      },
    } as StatsImpl;
    expect((await runItem(item, 1, ROOT, thrown)).pass).toBe(false);
  });
});

it.each(['naive wilson', 'children as trees', 'families as trees'] as const)(
  'checks coverage and width independently for %s, including zero coverage',
  async (method) => {
    for (const field of ['coverage', 'width'] as const) {
      let changed = false;
      const mutant: StatsImpl = {
        ...real,
        simulateFamilyCoverage: (...args) => {
          const output = real.simulateFamilyCoverage(...args);
          const result = {
            ...output,
            [field]: { ...output[field], [method]: output[field][method] + 0.002 },
          };
          expect(result).not.toEqual(output);
          changed = true;
          return result;
        },
      };
      for (const item of families) expect((await runItem(item, 1, ROOT, mutant)).pass).toBe(false);
      expect(changed).toBe(true);
    }
  },
);

it.each(['reps', 'families', 'runs'] as const)('checks the returned %s count exactly', async (field) => {
  const mutant: StatsImpl = {
    ...real,
    simulateFamilyCoverage: (...args) => {
      const output = real.simulateFamilyCoverage(...args);
      return field === 'reps'
        ? { ...output, reps: output.reps + 1e-10 }
        : { ...output, cell: { ...output.cell, [field]: output.cell[field] + 1e-10 } };
    },
  };
  for (const item of families) expect((await runItem(item, 1, ROOT, mutant)).pass).toBe(false);
});

const MUTANTS = [
  {
    name: 'ignore the custom statistic',
    file: 'intervals.ts',
    from: 'const statistic = options.statistic;',
    to: 'const statistic = undefined;',
    selected: bootstrap,
  },
  {
    name: 'ignore the statistic only on resamples',
    file: 'intervals.ts',
    from: 'stats[it] = evaluate(drawn);',
    to: 'stats[it] = pooled(drawn);',
    selected: bootstrap.filter((item) => item.id.includes('resampled-clusters')),
  },
  {
    name: 'flatten the clusters before resampling',
    file: 'intervals.ts',
    from: 'const keys = options.clusters;',
    to: 'const keys = undefined;',
    selected: bootstrap.filter((item) => item.id.includes('resampled-clusters')),
  },
  {
    name: 'group children as families',
    file: 'simulate.ts',
    from: 'const byFamily = hierarchicalBetaBinomial(familyTrees);',
    to: 'const byFamily = hierarchicalBetaBinomial(childTrees);',
    selected: families,
  },
  {
    name: 'group families as children',
    file: 'simulate.ts',
    from: 'const byChild = hierarchicalBetaBinomial(childTrees);',
    to: 'const byChild = hierarchicalBetaBinomial(familyTrees);',
    selected: families,
  },
  {
    name: 'ignore the supplied simulation seed',
    file: 'simulate.ts',
    from: 'mulberry32(options.seed ?? 1)',
    to: 'mulberry32(99)',
    selected: families,
  },
  {
    name: 'ignore the child-size pool',
    file: 'simulate.ts',
    from: 'const size = pool[Math.floor(rng() * pool.length)] as number;',
    to: 'const size = pool[0] as number;',
    selected: families,
  },
];

describe('capability defects planted in isolated source copies', { timeout: 120_000 }, () => {
  it.each(MUTANTS)('$name', async ({ name, file, from, to, selected }) => {
    const dir = mkdtempSync(join(tmpdir(), 'astra-stats-user-capability-'));
    try {
      cpSync(join(ROOT, 'packages/stats/src'), join(dir, 'src'), { recursive: true });
      const path = join(dir, 'src', file);
      const before = readFileSync(path, 'utf8');
      expect(before, name).toContain(from);
      writeFileSync(path, before.replaceAll(from, to));
      const impl = (await import(
        /* @vite-ignore */ pathToFileURL(join(dir, 'src/index.ts')).href
      )) as StatsImpl;
      for (const item of selected) {
        const result = await runItem(item, 1, ROOT, impl);
        expect(result.pass, `${item.id}: ${name}`).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
