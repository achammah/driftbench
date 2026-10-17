import {
  between,
  observed,
  pick,
  type RawSpec,
  type Rng,
  type RunRecord,
  rngFor,
  run,
  SHOP,
  scriptedAdapter,
} from '../harness';
import { KINDS, type Kind, plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { recipe } from '../recipe';
import {
  type Count,
  effectiveReference,
  goldenRate,
  type Interval,
  near,
  show,
  treeMeanEffective,
} from '../reference';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';

/**
 * Level 3: hierarchical intervals (docs/concepts/statistics.md). The Wilson interval on the effective runs is
 * compared with a second implementation of its formula on seeded clusters; the suite headline groups real runs by
 * golden and weighs every tree the same; the hierarchical interval keeps its documented properties (the mean
 * over trees, the same answer every time, wider when trees disagree); the end-state rate of the scorecard is a
 * rate over goldens ("A rate over goldens", PR 547), and the pass-rate gate criterion carries the same interval
 * (PR 528). Counts are planted, so every truth is known before the product runs.
 */

const EFFECTIVE = 'packages/stats/src/effective.ts';
const HIERARCHICAL = 'packages/stats/src/hierarchical.ts';
const HEADLINE = 'packages/report/src/headline.ts';
const SCORECARD = 'packages/report/src/scorecard.ts';
const AGGREGATE = 'packages/report/src/aggregate.ts';

type RateClass = { id: string; draw(rng: Rng, n: number): number };

const RATE_CLASSES: RateClass[] = [
  { id: 'low', draw: (rng, n) => Math.round(n * (0.05 + 0.25 * rng())) },
  { id: 'mid', draw: (rng, n) => Math.round(n * (0.35 + 0.3 * rng())) },
  { id: 'high', draw: (rng, n) => Math.round(n * (0.7 + 0.28 * rng())) },
  { id: 'all-pass', draw: (_rng, n) => n },
  { id: 'all-fail', draw: () => 0 },
];

/**
 * Seeded clusters: g clusters of 1 to `maxSize` blocks, passes drawn by the rate class. The clusters disagree on
 * purpose (half drawn near one rate, half near another, the class's rate between them), so the design effect is
 * above 1 and an interval that ignores the clustering differs from the right one.
 */
function clusters(rng: Rng, g: number, maxSize: number, rate: RateClass): Count[] {
  return Array.from({ length: g }, (_, index) => {
    const n = between(rng, Math.min(3, maxSize), maxSize);
    const drawn = rate.draw(rng, n);
    if (rate.id.startsWith('all')) return { n, k: drawn };
    // Every other cluster is pulled toward an extreme: the spread between clusters is real.
    const k = index % 2 === 0 ? Math.min(n, drawn + Math.ceil(n / 2)) : Math.max(0, drawn - Math.ceil(n / 2));
    return { n, k };
  });
}

type EffectiveResult = Interval & {
  effectiveN: number;
  designEffect: number;
  degenerate: boolean;
  clusters: number;
  n: number;
};

function effectiveItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const g of [2, 3, 4, 6, 10, 25]) {
    for (const rate of RATE_CLASSES) {
      const quantile = g % 2 === 0 ? 't' : 'z';
      const id = `intervals/effective/g${g}/${rate.id}/${quantile}`;
      items.push({
        id,
        family: 'intervals-effective',
        tier: (g <= 3 ? 3 : rate.id.startsWith('all') ? 2 : g >= 25 ? 4 : 3) as Tier,
        level: 9,
        component: EFFECTIVE,
        title: `wilsonEffective on ${g} seeded clusters (${rate.id} rate, ${quantile} quantile) equals the documented formula: pooled rate, n_eff, design effect and the Wilson interval on n_eff`,
        cause: rate.id.startsWith('all')
          ? 'wilsonEffective counts each cluster once when every block agrees.'
          : `wilsonEffective computes n_eff from the cluster-robust variance and the ${quantile} quantile.`,
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const counts = clusters(rng, g, 12, rate);
          const wilsonEffective = need<(c: Count[], o: { quantile: 't' | 'z' }) => EffectiveResult>(
            product.stats,
            'stats',
            'wilsonEffective',
          );
          const got = wilsonEffective(counts, { quantile });
          const want = effectiveReference(counts, quantile);
          return expectAll([
            [near(got.estimate, want.estimate), `estimate ${got.estimate}, expected ${want.estimate}`],
            [
              near(got.effectiveN, want.effectiveN),
              `n_eff ${got.effectiveN}, expected ${want.effectiveN} on ${JSON.stringify(counts)}`,
            ],
            [
              near(got.designEffect, want.designEffect),
              `design effect ${got.designEffect}, expected ${want.designEffect}`,
            ],
            [got.degenerate === want.degenerate, `degenerate ${got.degenerate}, expected ${want.degenerate}`],
            [
              near(got.lower, want.lower, 1e-6) && near(got.upper, want.upper, 1e-6),
              `interval ${show(got)}, expected ${show(want)} on ${JSON.stringify(counts)}`,
            ],
          ]);
        },
      });
    }
  }
  return items;
}

/** The planted golden specs: one block that must say "booked", and the end state when asked. */
function goldenSpecs(
  seed: number,
  tag: string,
  goldens: number,
  endState: boolean,
): { raws: RawSpec[]; bikes: string[] } {
  const rng = rngFor(seed, `${tag}#runs`);
  const raws: RawSpec[] = [];
  const bikes: string[] = [];
  for (let golden = 0; golden < goldens; golden += 1) {
    const bike = pick(rng, SHOP.bikes);
    bikes.push(bike);
    raws.push({
      id: `spec-${token(seed, `${tag}#golden#${golden}`)}`,
      channel: 'chat',
      blocks: [
        {
          id: 'book',
          user: `[${token(seed, tag)}:${golden}] Book the ${bike} for me.`,
          expect: { must: ['booked'] },
        },
      ],
      ...(endState ? { end_state: { source: 'tool:booking.create', mode: 'subset', expect: { bike } } } : {}),
    });
  }
  return { raws, bikes };
}

/** Runs of planted goldens: golden i holds counts[i].n runs, of which the first counts[i].k pass (or match). */
async function goldenRuns(
  product: BlocksProduct,
  seed: number,
  tag: string,
  counts: readonly Count[],
  options: {
    endState?: boolean;
    store?: unknown;
    campaignId?: string;
    specs?: { raws: RawSpec[]; bikes: string[] };
  } = {},
): Promise<{ runs: RunRecord[]; raws: RawSpec[] }> {
  const { raws, bikes } = options.specs ?? goldenSpecs(seed, tag, counts.length, options.endState === true);
  const runs: RunRecord[] = [];
  for (const [golden, count] of counts.entries()) {
    const raw = raws[golden] as RawSpec;
    const bike = bikes[golden] as string;
    for (let repeat = 0; repeat < count.n; repeat += 1) {
      const success = repeat < count.k;
      const adapter = scriptedAdapter(product, () =>
        options.endState
          ? observed('It is booked.', [
              {
                label: 'booking.create',
                input: { bike: success ? bike : `${bike} spare` },
                output: { ok: true },
              },
            ])
          : observed(success ? 'It is booked.' : 'Let me look.'),
      );
      runs.push(
        await run(product, raw, adapter, {
          repeat,
          ...(options.store ? { store: options.store, campaignId: options.campaignId ?? 'c-blocks' } : {}),
        }),
      );
    }
  }
  return { runs, raws };
}

type Headline = {
  estimate: number;
  lower: number;
  upper: number;
  trees: number;
  runs: number;
  pooledRate: number;
  effectiveRuns: number;
  designEffect: number;
  degenerate: boolean;
  method: string;
  detectableDrop?: number | null;
};

type Hierarchical = Interval & { treeMean: number; posteriorMean: number; trees: number; blocks: number };

function headlineItems(): BankItem[] {
  const items: BankItem[] = [];
  const shapes = [
    { id: 'equal-3', size: () => 3 },
    { id: 'equal-5', size: () => 5 },
    { id: 'unequal', size: (rng: Rng) => between(rng, 1, 8) },
  ];
  const rates = [RATE_CLASSES[1] as RateClass, RATE_CLASSES[3] as RateClass];
  for (const goldens of [2, 3, 6, 12]) {
    for (const shape of shapes) {
      for (const rate of rates) {
        const id = `intervals/headline/g${goldens}/${shape.id}/${rate.id}`;
        items.push({
          id,
          family: 'intervals-headline',
          tier: (shape.id === 'unequal' ? 4 : goldens <= 3 ? 3 : 2) as Tier,
          level: 9,
          component: HEADLINE,
          title: `the suite headline over ${goldens} goldens of real runs (${shape.id} repeats, ${rate.id}) groups the runs by golden: the mean over trees, the pooled rate, n_eff and the hierarchical interval of the planted counts`,
          cause:
            shape.id === 'unequal'
              ? 'The suite headline weighs every golden the same, whatever its repeats.'
              : 'The suite headline groups runs by golden and reads n_eff from the spread of the golden rates.',
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const counts = Array.from({ length: goldens }, () => {
              const n = shape.size(rng);
              return { n, k: Math.min(n, rate.draw(rng, n)) };
            });
            const { runs } = await goldenRuns(product, seed, id, counts);
            const suiteHeadline = need<(r: RunRecord[], t: (x: RunRecord) => string) => Headline | undefined>(
              product.report,
              'report',
              'suiteHeadline',
            );
            const hierarchical = need<(c: Count[]) => Hierarchical>(
              product.stats,
              'stats',
              'hierarchicalBetaBinomial',
            );
            const got = suiteHeadline(runs, (record) => record.specId);
            if (!got) return fail('the headline is undefined over scored runs');
            const truth = treeMeanEffective(counts);
            const interval = hierarchical(counts);
            const runsTotal = counts.reduce((sum, c) => sum + c.n, 0);
            const pooled = counts.reduce((sum, c) => sum + c.k, 0) / runsTotal;
            return expectAll([
              [got.trees === goldens, `${got.trees} trees, expected ${goldens}`],
              [got.runs === runsTotal, `${got.runs} runs, expected ${runsTotal}`],
              [
                near(got.estimate, truth.mean),
                `estimate ${got.estimate}, expected the mean over trees ${truth.mean}`,
              ],
              [near(got.pooledRate, pooled), `pooled rate ${got.pooledRate}, expected ${pooled}`],
              [
                near(got.effectiveRuns, truth.effective),
                `n_eff ${got.effectiveRuns}, expected ${truth.effective} on ${JSON.stringify(counts)}`,
              ],
              [
                got.degenerate === truth.degenerate,
                `degenerate ${got.degenerate}, expected ${truth.degenerate}`,
              ],
              [
                near(got.lower, interval.lower) && near(got.upper, interval.upper),
                `interval ${show(got)}, expected the hierarchical interval of the planted counts ${show(interval)}`,
              ],
            ]);
          },
        });
      }
    }
  }
  items.push({
    id: 'intervals/headline/documented-example',
    family: 'intervals-headline',
    tier: 2,
    level: 9,
    component: HEADLINE,
    title:
      'the documented six goldens (5 of 5, 5 of 5, 4 of 5, 0 of 5, 2 of 5, 2 of 2), in a seeded order, give 70.0% [35.4%, 88.2%], n_eff 7.3, design effect 3.69 and a detectable drop of 65.3 points',
    cause: 'The suite headline matches the example of docs/concepts/statistics.md.',
    check: async ({ seed, product }) => {
      const rng = rngFor(seed, 'documented');
      const base: Count[] = [
        { n: 5, k: 5 },
        { n: 5, k: 5 },
        { n: 5, k: 4 },
        { n: 5, k: 0 },
        { n: 5, k: 2 },
        { n: 2, k: 2 },
      ];
      const order = [...base.keys()].sort(() => rng() - 0.5);
      const counts = order.map((index) => base[index] as Count);
      const { runs } = await goldenRuns(product, seed, 'documented', counts);
      const suiteHeadline = need<(r: RunRecord[], t: (x: RunRecord) => string) => Headline | undefined>(
        product.report,
        'report',
        'suiteHeadline',
      );
      const got = suiteHeadline(runs, (record) => record.specId);
      const pct = (x: number | undefined) => (x === undefined ? '?' : (100 * x).toFixed(1));
      return expectAll([
        [
          pct(got?.estimate) === '70.0' && pct(got?.lower) === '35.4' && pct(got?.upper) === '88.2',
          `headline ${pct(got?.estimate)}% [${pct(got?.lower)}%, ${pct(got?.upper)}%]`,
        ],
        [got?.effectiveRuns?.toFixed(1) === '7.3', `n_eff ${got?.effectiveRuns}`],
        [got?.designEffect?.toFixed(2) === '3.69', `design effect ${got?.designEffect}`],
        [
          got?.detectableDrop !== null &&
            got?.detectableDrop !== undefined &&
            (100 * got.detectableDrop).toFixed(1) === '65.3',
          `detectable drop ${got?.detectableDrop}`,
        ],
      ]);
    },
  });
  return items;
}

type Property = {
  id: string;
  tier: Tier;
  title: string;
  test(h: (c: Count[]) => Hierarchical, rng: Rng, trees: number): string | undefined;
};

const PROPERTIES: Property[] = [
  {
    id: 'tree-mean',
    tier: 2,
    title: 'the estimate is the mean of the tree rates, every tree weighing the same',
    test: (h, rng, trees) => {
      const counts = clusters(rng, trees, 10, RATE_CLASSES[1] as RateClass);
      const mean = counts.reduce((sum, c) => sum + c.k / c.n, 0) / counts.length;
      const got = h(counts);
      return near(got.estimate, mean) && near(got.treeMean, mean)
        ? undefined
        : `estimate ${got.estimate}, tree mean ${mean}`;
    },
  },
  {
    id: 'deterministic-and-ordered',
    tier: 2,
    title: 'the same trees in another order give the same interval, call after call',
    test: (h, rng, trees) => {
      const counts = clusters(rng, trees, 9, RATE_CLASSES[2] as RateClass);
      const a = h(counts);
      const b = h([...counts].reverse());
      const c = h(counts);
      return near(a.lower, b.lower, 1e-12) &&
        near(a.upper, b.upper, 1e-12) &&
        near(a.lower, c.lower, 0) &&
        near(a.upper, c.upper, 0)
        ? undefined
        : `${show(a)} then ${show(c)}, reversed ${show(b)}`;
    },
  },
  {
    id: 'disagreement-widens',
    tier: 3,
    title:
      'trees that disagree (half pass every run, half fail every run) give a wider interval than trees that agree at the same mean',
    test: (h, rng, trees) => {
      const n = 2 * between(rng, 2, 6);
      const even = trees - (trees % 2);
      const split = Array.from({ length: even }, (_, i) => ({ n, k: i % 2 === 0 ? n : 0 }));
      const agree = Array.from({ length: even }, () => ({ n, k: n / 2 }));
      const a = h(split);
      const b = h(agree);
      return a.upper - a.lower > b.upper - b.lower ? undefined : `split ${show(a)}, agreeing ${show(b)}`;
    },
  },
  {
    id: 'bounds-hold-the-posterior-mean',
    tier: 1,
    title: 'the bounds lie within 0 and 1 and hold the posterior mean',
    test: (h, rng, trees) => {
      const rate = pick(rng, RATE_CLASSES);
      const counts = clusters(rng, trees, 7, rate);
      const got = h(counts);
      return got.lower >= 0 &&
        got.upper <= 1 &&
        got.lower <= got.posteriorMean &&
        got.posteriorMean <= got.upper
        ? undefined
        : `${show(got)} with posterior mean ${got.posteriorMean} (${rate.id})`;
    },
  },
  {
    id: 'equal-weights',
    tier: 4,
    title:
      'repeating one tree ten times over (its rate unchanged) leaves the estimate, the mean over trees, unchanged',
    test: (h, rng, trees) => {
      const counts = clusters(rng, trees, 4, RATE_CLASSES[1] as RateClass);
      const scaled = counts.map((c, i) => (i === 0 ? { n: c.n * 10, k: c.k * 10 } : c));
      const a = h(counts);
      const b = h(scaled);
      return near(a.estimate, b.estimate) ? undefined : `estimate ${a.estimate} became ${b.estimate}`;
    },
  },
];

function treeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const property of PROPERTIES) {
    for (const trees of [4, 9, 16, 40]) {
      const id = `intervals/tree/${property.id}/${trees}`;
      items.push({
        id,
        family: 'intervals-tree',
        tier: property.tier,
        level: 9,
        component: HIERARCHICAL,
        title: `the hierarchical interval over ${trees} trees: ${property.title}`,
        cause: `hierarchicalBetaBinomial keeps its documented property: ${property.id.replace(/-/g, ' ')}.`,
        check: async ({ seed, product }) => {
          const h = need<(c: Count[]) => Hierarchical>(product.stats, 'stats', 'hierarchicalBetaBinomial');
          const problem = property.test(h, rngFor(seed, id), trees);
          return problem === undefined ? PASS : fail(problem);
        },
      });
    }
  }
  return items;
}

type Repeats = { id: string; size(rng: Rng): number };

const REPEATS: Repeats[] = [
  { id: 'one-each', size: () => 1 },
  { id: 'three-each', size: () => 3 },
  { id: 'unequal', size: (rng) => between(rng, 1, 6) },
];

/** The end-state rate of the scorecard over goldens of real runs in a store. */
function endStateItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const goldens of [1, 2, 4, 8]) {
    for (const repeats of REPEATS) {
      for (const agreement of ['mixed', 'all-match'] as const) {
        const id = `intervals/end-state/g${goldens}/${repeats.id}/${agreement}`;
        items.push({
          id,
          family: 'intervals-end-state',
          tier: (goldens === 1 || repeats.id === 'one-each' ? 2 : agreement === 'all-match' ? 4 : 3) as Tier,
          level: 9,
          component: SCORECARD,
          title: `the scorecard's end-state rate over ${goldens} goldens (${repeats.id} runs, ${agreement}) is the rate over goldens of the planted end states: the counts and the interval of "A rate over goldens"`,
          cause:
            agreement === 'all-match'
              ? 'buildScorecard counts each golden once when every end state agrees.'
              : 'buildScorecard rates the end states over goldens, the runs of one golden being repeats.',
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const counts = Array.from({ length: goldens }, () => {
              const n = repeats.size(rng);
              return { n, k: agreement === 'all-match' ? n : between(rng, 0, n) };
            });
            if (agreement === 'mixed' && counts.every((c) => c.k === c.n) && counts[0]) counts[0].k = 0;
            const openMemoryStore = need<() => Record<string, (...args: unknown[]) => Promise<unknown>>>(
              product.store,
              'store',
              'openMemoryStore',
            );
            const store = openMemoryStore();
            const campaignId = `c-${seed}`;
            const specs = goldenSpecs(seed, id, goldens, true);
            const { raws } = specs;
            const validateSpec = need<(raw: unknown, path: string) => { spec: { id: string }; hash: string }>(
              product.core,
              'core',
              'validateSpec',
            );
            const pins = [];
            for (const raw of raws) {
              const loaded = validateSpec(raw, 'blocks-end-state');
              await (store.putSpec as (spec: unknown) => Promise<void>)(loaded);
              pins.push({ id: loaded.spec.id, hash: loaded.hash });
            }
            await (store.putCampaign as (campaign: unknown) => Promise<void>)({
              campaignId,
              specs: pins,
              targets: [{ adapter: 'function' }],
              modes: ['F'],
              repeats: { T: 0, F: Math.max(...counts.map((c) => c.n)), P: 0 },
              budgetUsd: 1,
              judge: { mode: 'system1', judges: [] },
              createdAt: '2026-10-16T00:00:00.000Z',
            });
            await goldenRuns(product, seed, id, counts, { endState: true, store, campaignId, specs });
            const loadCampaign = need<(store: unknown, id: string) => Promise<unknown>>(
              product.report,
              'report',
              'loadCampaign',
            );
            const buildScorecard = need<
              (data: unknown) => { endState?: Interval & { k: number; n: number } }
            >(product.report, 'report', 'buildScorecard');
            const got = buildScorecard(await loadCampaign(store, campaignId)).endState;
            const want = goldenRate(counts);
            return got?.k === want.k &&
              got.n === want.n &&
              near(got.lower, want.lower, 1e-6) &&
              near(got.upper, want.upper, 1e-6)
              ? PASS
              : fail(
                  `endState ${got?.k} of ${got?.n} ${show(got)}, expected ${want.k} of ${want.n} ${show(want)} for goldens ${JSON.stringify(counts)}`,
                );
          },
        });
      }
    }
  }
  return items;
}

/**
 * The pass rate of a campaign as a gate criterion (`evaluateAggregates` with `BUILT_IN_AGGREGATES.passRate`, PR 528):
 * its interval is the rate over goldens, the plain Wilson interval where the runs are independent evidence.
 */
function passRateItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const goldens of [1, 2, 3, 5, 12]) {
    for (const repeats of [...REPEATS, { id: 'large', size: (rng: Rng) => between(rng, 8, 14) }]) {
      const id = `intervals/pass-rate/g${goldens}/${repeats.id}`;
      items.push({
        id,
        family: 'intervals-pass-rate',
        tier: (goldens === 1 || repeats.id === 'one-each' ? 2 : repeats.id === 'large' ? 4 : 3) as Tier,
        level: 9,
        component: AGGREGATE,
        title: `the pass-rate gate criterion over ${goldens} goldens of real runs (${repeats.id} runs) prints the interval over goldens, and the plain Wilson interval where the runs are independent`,
        cause:
          goldens === 1 || repeats.id === 'one-each'
            ? 'evaluateAggregates keeps the plain Wilson interval when the runs are independent evidence.'
            : 'evaluateAggregates gives a rate criterion the Wilson interval on the effective runs over goldens.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const counts = Array.from({ length: goldens }, () => {
            const n = repeats.size(rng);
            return { n, k: between(rng, 0, n) };
          });
          const { runs } = await goldenRuns(product, seed, id, counts);
          const evaluateAggregates = need<
            (data: unknown, criteria: unknown[]) => { interval?: Interval & { n: number; method: string } }[]
          >(product.report, 'report', 'evaluateAggregates');
          const builtIn = need<{ passRate: (threshold?: number) => unknown }>(
            product.report,
            'report',
            'BUILT_IN_AGGREGATES',
          );
          const [result] = evaluateAggregates({ campaign: {}, specs: new Map(), runs }, [
            builtIn.passRate(0.5),
          ]);
          const got = result?.interval;
          const want = goldenRate(counts);
          const independent = goldens < 2 || counts.every((c) => c.n === 1);
          const k = counts.reduce((sum, c) => sum + c.k, 0);
          const n = counts.reduce((sum, c) => sum + c.n, 0);
          const method = independent
            ? undefined
            : k === 0 || k === n
              ? 'wilson, clusters'
              : 'wilson, design effect';
          return expectAll([
            [got !== undefined, 'the pass-rate criterion has no interval'],
            [got?.n === n, `n ${got?.n}, expected ${n}`],
            [method === undefined || got?.method === method, `method ${got?.method}, expected ${method}`],
            [
              near(got?.lower, want.lower, 1e-6) && near(got?.upper, want.upper, 1e-6),
              `${show(got)}, expected ${show(want)} for goldens ${JSON.stringify(counts)}`,
            ],
          ]);
        },
      });
    }
  }
  return items;
}

/** Level 3 of the blocks bank. */
export function intervalItems(): BankItem[] {
  return [
    ...effectiveItems(),
    ...headlineItems(),
    ...treeItems(),
    ...endStateItems(),
    ...passRateItems(),
    ...coverageItems(),
    ...noisyItems(),
  ];
}

/** A draw from Gamma(shape, 1) (Marsaglia and Tsang), from the seeded generator. */
function gamma(rng: Rng, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * rng() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = rng() || 1e-12;
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function beta(rng: Rng, a: number, b: number): number {
  const x = gamma(rng, a);
  return x / (x + gamma(rng, b));
}

const baseCache = new Map<string, { pass: RunRecord[]; fail: RunRecord[] }>();

/** One passing and one failing real run of each of `goldens` planted single-block specs of `kind`, cached. */
async function baseRecords(
  product: BlocksProduct,
  seed: number,
  kind: Kind,
  wanted: number,
  scratch: string,
) {
  // The most goldens any item asks for are built once per seed and kind; an item takes the first `wanted`.
  const goldens = 16;
  const key = `${product.name}:${seed}:${kind}`;
  const cached = baseCache.get(key);
  if (cached) return { pass: cached.pass.slice(0, wanted), fail: cached.fail.slice(0, wanted) };
  const pass: RunRecord[] = [];
  const failing: RunRecord[] = [];
  for (let g = 0; g < goldens; g += 1) {
    for (const fate of ['pass', 'fail'] as const) {
      const r = recipe(seed, `coverage#${kind}#${g}`, kind, [{ fate }]);
      const record = await run(product, r.raw, plantedAgent(product, kind, r.actions, { scratch }).adapter);
      (fate === 'pass' ? pass : failing).push(record);
    }
  }
  const built = { pass, fail: failing };
  if (baseCache.size > 4) baseCache.clear();
  baseCache.set(key, built);
  return { pass: pass.slice(0, wanted), fail: failing.slice(0, wanted) };
}

type Estimator = {
  id: string;
  /** The coverage an interval of this kind holds, less a margin for the draws: below it, the interval is too narrow. */
  floor: number;
  interval(product: BlocksProduct, runs: RunRecord[]): Interval | undefined;
};

const ESTIMATORS: Estimator[] = [
  {
    id: 'headline',
    floor: 0.88,
    interval: (product, runs) =>
      need<(r: RunRecord[], t: (x: RunRecord) => string) => Interval | undefined>(
        product.report,
        'report',
        'suiteHeadline',
      )(runs, (record) => record.specId),
  },
  {
    id: 'pass-rate-criterion',
    floor: 0.86,
    interval: (product, runs) => {
      const evaluate = need<(data: unknown, criteria: unknown[]) => { interval?: Interval }[]>(
        product.report,
        'report',
        'evaluateAggregates',
      );
      const builtIn = need<{ passRate: (threshold?: number) => unknown }>(
        product.report,
        'report',
        'BUILT_IN_AGGREGATES',
      );
      return evaluate({ campaign: {}, specs: new Map(), runs }, [builtIn.passRate(0.5)])[0]?.interval;
    },
  },
  {
    id: 'wilson-effective',
    floor: 0.84,
    interval: (product, runs) => {
      const groups = new Map<string, { n: number; k: number }>();
      const runOutcome = need<(r: RunRecord) => string>(product.core, 'core', 'runOutcome');
      for (const record of runs) {
        const g = groups.get(record.specId) ?? { n: 0, k: 0 };
        g.n += 1;
        if (runOutcome(record) === 'pass') g.k += 1;
        groups.set(record.specId, g);
      }
      return need<(c: { n: number; k: number }[], o: unknown) => Interval>(
        product.stats,
        'stats',
        'wilsonEffective',
      )([...groups.values()], { quantile: 'z' });
    },
  },
];

/** Campaigns drawn per coverage item. */
export const COVERAGE_DRAWS = 200;

/**
 * Coverage of a planted true rate. Each draw plants a population mean mu: every golden's own rate is drawn from a
 * Beta around mu (concentration kappa), every repeat passes or fails by that rate (a noisy agent with a planted
 * failure rate), and the runs are real runs of planted specs of the kind, one passing and one failing record per
 * golden reused across repeats. Over the draws, the share of intervals that hold mu must reach the estimator's floor.
 */
function coverageItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of KINDS) {
    for (const estimator of ESTIMATORS) {
      for (const mu of [0.6, 0.85]) {
        for (const kappa of [2, 8]) {
          for (const goldens of [8, 16]) {
            const id = `intervals/coverage/${kind}/${estimator.id}/mu${mu}/k${kappa}/g${goldens}`;
            items.push({
              id,
              family: `intervals-coverage-${kind}`,
              tier: Math.min(5, (kappa === 2 ? 4 : 3) + (goldens === 8 ? 1 : 0)) as Tier,
              level: 9,
              component:
                estimator.id === 'headline'
                  ? HEADLINE
                  : estimator.id === 'pass-rate-criterion'
                    ? AGGREGATE
                    : EFFECTIVE,
              title: `over ${COVERAGE_DRAWS} campaigns of ${goldens} goldens of a ${kind} agent whose golden rates spread around ${mu} (concentration ${kappa}), the ${estimator.id.replace(/-/g, ' ')} interval holds the planted rate at least ${estimator.floor} of the time`,
              cause: `The ${estimator.id.replace(/-/g, ' ')} interval accounts for the spread between goldens, so it covers the planted rate.`,
              check: async ({ seed, scratch, product }) => {
                const rng = rngFor(seed, id);
                const base = await baseRecords(product, seed, kind, goldens, scratch);
                let covered = 0;
                let computed = 0;
                for (let draw = 0; draw < COVERAGE_DRAWS; draw += 1) {
                  const runs: RunRecord[] = [];
                  for (let g = 0; g < goldens; g += 1) {
                    const rate = beta(rng, mu * kappa, (1 - mu) * kappa);
                    for (let repeat = 0; repeat < 4; repeat += 1) {
                      const source = (rng() < rate ? base.pass : base.fail)[g] as RunRecord;
                      runs.push({ ...source, repeat, runId: `d${draw}-g${g}-r${repeat}` });
                    }
                  }
                  const interval = estimator.interval(product, runs);
                  if (!interval) continue;
                  computed += 1;
                  if (interval.lower <= mu && mu <= interval.upper) covered += 1;
                }
                const share = computed === 0 ? 0 : covered / computed;
                return computed === COVERAGE_DRAWS && share >= estimator.floor
                  ? PASS
                  : fail(
                      `the ${estimator.id} interval should hold the planted rate ${mu} in at least ${estimator.floor} of ${COVERAGE_DRAWS} campaigns; it held it in ${covered} of ${computed} (${share.toFixed(3)})`,
                    );
              },
            });
          }
        }
      }
    }
  }
  return items;
}

/**
 * The noisy agent: each turn breaks with a planted rate, and the harness records which. The product must read
 * exactly those runs as failures and count them so in its tallies and rates: no more, no fewer.
 */
function noisyItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of KINDS) {
    for (const rate of [0.1, 0.3, 0.5]) {
      for (const goldens of [2, 4]) {
        for (const repeats of kind === 'code' ? [2, 3] : [3, 6]) {
          const id = `intervals/noisy/${kind}/rate${rate}/g${goldens}/r${repeats}`;
          items.push({
            id,
            family: 'intervals-noisy',
            tier: (rate === 0.5 ? 3 : 2) as Tier,
            level: 9,
            component: HEADLINE,
            title: `a noisy ${kind} agent that breaks each turn at rate ${rate}, over ${goldens} goldens of ${repeats} repeats: every broken run reads fail, every other pass, and the pass rate counts exactly the unbroken runs`,
            cause: 'The run verdicts and the pass rate read exactly the turns a noisy agent broke.',
            check: async ({ seed, scratch, product }) => {
              const rng = rngFor(seed, id);
              const runs: RunRecord[] = [];
              const brokenRuns: boolean[] = [];
              for (let g = 0; g < goldens; g += 1) {
                const r = recipe(seed, `${id}#${g}`, kind, [{ fate: 'pass' }]);
                for (let repeat = 0; repeat < repeats; repeat += 1) {
                  const broken: string[] = [];
                  const agent = plantedAgent(product, kind, r.actions, {
                    scratch,
                    noisy: { rate, rng, broken },
                  });
                  runs.push(await run(product, r.raw, agent.adapter, { repeat }));
                  brokenRuns.push(broken.length > 0);
                }
              }
              const runOutcome = need<(record: RunRecord) => string>(product.core, 'core', 'runOutcome');
              for (const [i, record] of runs.entries()) {
                const want = brokenRuns[i] ? 'fail' : 'pass';
                if (runOutcome(record) !== want)
                  return fail(
                    `run ${i} should read ${want}: the noisy agent ${brokenRuns[i] ? 'broke' : 'did not break'} its turn; got ${runOutcome(record)}`,
                  );
              }
              const passes = brokenRuns.filter((b) => !b).length;
              const [result] = need<
                (data: unknown, criteria: unknown[]) => { value?: number; interval?: { n: number } }[]
              >(
                product.report,
                'report',
                'evaluateAggregates',
              )({ campaign: {}, specs: new Map(), runs }, [
                need<{ passRate: (t?: number) => unknown }>(
                  product.report,
                  'report',
                  'BUILT_IN_AGGREGATES',
                ).passRate(0.5),
              ]);
              return result?.value !== undefined && Math.abs(result.value - passes / runs.length) < 1e-12
                ? PASS
                : fail(`the pass rate should be ${passes} of ${runs.length}; got ${result?.value}`);
            },
          });
        }
      }
    }
  }
  return items;
}
