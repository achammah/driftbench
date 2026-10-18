import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { capabilityItems } from '../../src/ladders/stats/bank/exact-capabilities';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import type { BankItem } from '../../src/ladders/stats/bank/item';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

/**
 * The exact-value items of the statistics bank (bank/exact.ts) against planted faults, one function at a time.
 * Every function an `exact.*` item names must lose at least one item when its numbers are 0.2 percent off, and
 * when it throws; a function with no numeric output has its own planted fault. Before the items existed, 13
 * exports lost no item at all under the 0.2 percent fault (the audit of docs/validators.md section 12).
 */
/** The functions of the report package: not statistics functions to replace in the package object. */
const REPORT_FUNCTIONS = ['suiteHeadline', 'clusterRate'];
// Only the explicitly registered planned capabilities have a separate positive/missing-export suite.
// Unknown or accidentally missing inherited exports must still fail the availability test below.
const plannedIds = new Set(capabilityItems().map((item) => item.id));
const items: BankItem[] = statsBank(ROOT).filter(
  (item) => item.id.startsWith('exact.') && !plannedIds.has(item.id),
);
const byFunction = new Map<string, BankItem[]>();
for (const item of items.filter((item) => !item.id.startsWith('exact.source.'))) {
  const name = item.id.split('.')[1] as string;
  byFunction.set(name, [...(byFunction.get(name) ?? []), item]);
}

/** Multiplies every numeric result by 1.002, including integer-valued custom statistics. */
function nudge(value: unknown): unknown {
  if (typeof value === 'number') return value * 1.002;
  if (Array.isArray(value)) return value.map(nudge);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, nudge(v)]));
  return value;
}

type Fn = (...args: unknown[]) => unknown;
/** The planted fault of a function whose output has nothing a 0.2 percent nudge could move. */
const FAULTS: Record<string, (real: Fn) => Fn> = {
  // Overflow-prone sums, including integer-valued large finite means.
  mean:
    () =>
    (...a) =>
      (a[0] as number[]).reduce((sum, x) => sum + x, 0) / (a[0] as number[]).length,
  // Zero boundary probabilities do not move under multiplication.
  incompleteBeta:
    (f) =>
    (...a) =>
      (f(...a) as number) + 0.01,
  // counts in the wrong order
  abundances:
    (f) =>
    (...a) =>
      (f(...a) as number[]).reverse(),
  // the opposite verdict
  reduceRepeats:
    (f) =>
    (...a) => {
      const v = f(...a);
      return v === undefined ? undefined : 1 - (v as number);
    },
  // at_least:<k> read as k = 1
  parseRepeatReducer:
    (f) =>
    (...a) => {
      const r = f(...a) as { kind: string; k?: number };
      return r.kind === 'at_least' ? { ...r, k: 1 } : r;
    },
  // one run more than the bound
  zeroFailureBound:
    (f) =>
    (...a) =>
      (f(...a) as number) + 1,
  // the sequence of the next seed
  mulberry32: (f) => (seed: unknown) => f((seed as number) + 1),
};

function plant(name: string, how: 'nudge' | 'throw', changed: string[] = []): StatsImpl {
  const original = (real as unknown as Record<string, unknown>)[name] as Fn;
  const bad: Fn =
    how === 'throw'
      ? () => {
          throw new Error('planted');
        }
      : FAULTS[name]
        ? (FAULTS[name] as (f: Fn) => Fn)(original)
        : (...a) => {
            const r = original(...a);
            return nudge(r);
          };
  return {
    ...real,
    [name]: (...a: unknown[]) => {
      const result = bad(...a);
      if (how === 'nudge' && !isDeepStrictEqual(result, original(...a))) changed.push(name);
      return result;
    },
  } as unknown as StatsImpl;
}

async function losing(group: BankItem[], impl: StatsImpl): Promise<string[]> {
  const lost: string[] = [];
  for (const item of group) {
    const base = await runItem(item, 1, ROOT, real);
    const got = await runItem(item, 1, ROOT, impl);
    if (base.pass && !got.pass) lost.push(item.id);
  }
  return lost;
}

describe('the exact-value items of the statistics bank', { timeout: 180_000 }, () => {
  it('name a function of the package each, with a cause', () => {
    expect(items.length).toBeGreaterThanOrEqual(40);
    for (const item of items) {
      expect(item.cause?.length).toBeGreaterThan(10);
      if (!item.id.startsWith('exact.source.') && !REPORT_FUNCTIONS.includes(item.id.split('.')[1] as string))
        expect((real as unknown as Record<string, unknown>)[item.id.split('.')[1] as string]).toBeTypeOf(
          'function',
        );
    }
  });

  it('pass on the product on four seeds', async () => {
    for (const seed of [1, 2, 3, 856524023]) {
      for (const item of items) {
        const got = await runItem(item, seed, ROOT, real);
        expect(got.pass, `${item.id} on seed ${seed}: ${got.detail}`).toBe(true);
      }
    }
  });

  const statsFunctions = [...byFunction.keys()].filter((name) => name in real);

  it.each(statsFunctions)('%s: an item fails when its numbers are 0.2 percent off', async (name) => {
    const changed: string[] = [];
    const lost = await losing(byFunction.get(name) as BankItem[], plant(name, 'nudge', changed));
    expect(changed.length, 'the mutant must change an exercised result').toBeGreaterThan(0);
    expect(lost.length, `no exact item of ${name} fails under the planted fault`).toBeGreaterThan(0);
  });

  it.each(statsFunctions)('%s: an item fails when it throws', async (name) => {
    const group = byFunction.get(name) as BankItem[];
    const lost = await losing(group, plant(name, 'throw'));
    expect(lost.length, `no exact item of ${name} fails when it throws`).toBe(group.length);
  });

  it('cover the 13 functions no item caught before and the 22 that one or two caught', () => {
    const before = [
      'abundances',
      'effectiveSampleSize',
      'erfc',
      'hierarchicalBetaBinomial',
      'icc',
      'mulberry32',
      'parseRepeatReducer',
      'quantileSorted',
      'reduceRepeats',
      'sampleVariance',
      'wilsonEffective',
      'zFor',
      'betaQuantile',
      'chiSquareSf',
      'cusum',
      'designEffect',
      'goodTuring',
      'hillNumber',
      'hillNumbers',
      'kishEffectiveSize',
      'kolmogorovSf',
      'logGamma',
      'neymanAllocation',
      'nonInferiority',
      'normalCdf',
      'normalQuantile',
      'normalSf',
      'pageHinkley',
      'pairedRateDifference',
      'quantile',
      'repeatsForFloor',
      'unreliability',
      'varianceComponents',
      'weightedMean',
    ];
    const missing = before.filter((name) => !byFunction.has(name));
    expect(missing).toEqual([]);
  });
});

describe('source guards are source checks, not exported functions', () => {
  const guards = items.filter((item) => item.id.startsWith('exact.source.'));
  const faults = [
    ['reads-files', "import { readFileSync } from 'node:fs';"],
    ['reads-process-state', 'const args = process.argv;'],
    ['reads-call-stack', 'const stack = new Error().stack;'],
    ['runs-generated-code', "const f = new Function('return 1');"],
    ['names-the-validator', "const oracle = 'validators/fixtures/exact.json';"],
  ];

  it('retains all five registered source items outside function grouping', () => {
    expect(guards.map((item) => item.id).sort()).toEqual(faults.map(([id]) => `exact.source.${id}`).sort());
    expect(byFunction.has('source')).toBe(false);
  });

  it.each(faults)('rejects forbidden source: %s', async (id, source) => {
    const root = mkdtempSync(join(tmpdir(), 'astra-stats-source-'));
    try {
      const src = join(root, 'packages/stats/src');
      mkdirSync(src, { recursive: true });
      const file = join(src, 'index.ts');
      const item = guards.find((item) => item.id === `exact.source.${id}`) as BankItem;
      writeFileSync(file, 'export const identity = (x: number) => x;');
      expect((await runItem(item, 1, root, real)).pass).toBe(true);
      writeFileSync(file, source as string);
      const result = await runItem(item, 1, root, real);
      expect(result.pass, result.detail).toBe(false);
      expect(result.detail).toContain('Remove it.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * The report-side items read the product's own report code, which is not a statistics function to replace in
 * the package object. A planted fault there is a changed copy of the report source: a root of its own holds the
 * copy (with the real module links and the real fixture), and the items run against that root.
 */
describe('the exact-value items of the report', { timeout: 180_000 }, () => {
  const reportItems = items.filter((item) => REPORT_FUNCTIONS.includes(item.id.split('.')[1] as string));

  function rootWith(file: string, change: (text: string) => string): string {
    const root = mkdtempSync(join(tmpdir(), 'astra-stats-exact-report-'));
    const report = join(root, 'packages', 'report');
    mkdirSync(report, { recursive: true });
    cpSync(join(ROOT, 'packages/report/src'), join(report, 'src'), { recursive: true });
    cpSync(join(ROOT, 'packages/report/package.json'), join(report, 'package.json'));
    symlinkSync(join(ROOT, 'packages/report/node_modules'), join(report, 'node_modules'));
    mkdirSync(join(root, 'packages', 'validators'), { recursive: true });
    symlinkSync(join(ROOT, 'packages/validators/fixtures'), join(root, 'packages/validators/fixtures'));
    const path = join(report, 'src', file);
    const before = readFileSync(path, 'utf8');
    const after = change(before);
    if (after === before) throw new Error(`the planted change did not apply to ${file}`);
    writeFileSync(path, after);
    return root;
  }

  async function lostOn(root: string): Promise<string[]> {
    const lost: string[] = [];
    for (const item of reportItems) {
      const got = await item.check({ seed: 1, s: real, root, rng: () => 0.5 });
      if (!got.pass) lost.push(item.id);
    }
    return lost;
  }

  it('pass on the product itself', async () => {
    expect(await lostOn(ROOT)).toEqual([]);
  });

  const faults: [string, string, (text: string) => string, string][] = [
    [
      'every run its own tree',
      'headline.ts',
      (t) => t.replace('const key = treeOf(run);', 'const key = run.runId;'),
      'exact.suiteHeadline.tree-key',
    ],
    [
      'the smaller of the two variances',
      'headline.ts',
      (t) => t.replace('Math.max(between, within)', 'Math.min(between, within)'),
      'exact.suiteHeadline.effective-runs',
    ],
    [
      'the normal quantile in place of the Student t',
      'estimate.ts',
      (t) =>
        t.replace("wilsonEffective(counts, { quantile: 't' })", "wilsonEffective(counts, { quantile: 'z' })"),
      'exact.clusterRate.rate-over-goldens',
    ],
    [
      'all-agree counted over runs, not goldens',
      'estimate.ts',
      (t) => t.replace('wilson(value === 1 ? g : 0, g)', 'wilson(value === 1 ? runs : 0, runs)'),
      'exact.clusterRate.rate-over-goldens',
    ],
    [
      'the pooled rate in place of the mean over goldens',
      'headline.ts',
      (t) => t.replace('estimate: interval.estimate,', 'estimate: base.pooledRate,'),
      'exact.suiteHeadline.rate-and-interval',
    ],
  ];

  it.each(faults)('%s: the item named fails', async (_name, file, change, id) => {
    const root = rootWith(file, change);
    try {
      expect(await lostOn(root)).toContain(id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
