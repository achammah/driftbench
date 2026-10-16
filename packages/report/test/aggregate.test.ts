import { readFileSync } from 'node:fs';
import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import {
  type AggregateCriterion,
  aggregateFromFlag,
  BUILT_IN_AGGREGATES,
  evaluateAggregates,
} from '../src/aggregate';
import { rate } from '../src/estimate';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

const passing = () => run({ blocks: [{ pass: true }, { pass: true }] });
const failing = () => run({ blocks: [{ pass: true }, { pass: false }] });

describe('campaign-level aggregate criteria', () => {
  it('scores a criterion over every run of the campaign, not per block', () => {
    const data = dataOf([passing(), passing(), passing(), failing()]);
    const [result] = evaluateAggregates(data, [BUILT_IN_AGGREGATES.passRate()]);
    expect(result).toMatchObject({ name: 'pass-rate', value: 0.75, passed: true });
  });

  it('applies an at-most threshold to the share of broken runs', () => {
    const broken = run({ status: 'failed', blocks: [{ pass: false }] });
    const data = dataOf([passing(), passing(), passing(), broken]);
    const [result] = evaluateAggregates(data, [BUILT_IN_AGGREGATES.brokenShare(0.2)]);
    expect(result).toMatchObject({ name: 'broken-share', value: 0.25, passed: false, direction: 'at-most' });
  });

  it('is inconclusive, not failed, for a campaign with no runs', () => {
    const [result] = evaluateAggregates(dataOf([]), [BUILT_IN_AGGREGATES.passRate()]);
    expect(result).toMatchObject({ value: undefined, passed: undefined });
    expect(result?.reason).toContain('no runs');
  });

  it('evaluates a custom criterion over the whole campaign', () => {
    const custom: AggregateCriterion = {
      name: 'runs-with-two-blocks',
      threshold: 0.5,
      direction: 'at-least',
      measure: (data) => data.runs.filter((entry) => entry.blocks.length === 2).length / data.runs.length,
    };
    const data = dataOf([passing(), failing(), run({ blocks: [{ pass: true }] })]);
    const [result] = evaluateAggregates(data, [custom]);
    expect(result).toMatchObject({ value: 2 / 3, passed: true });
  });

  it('adds aggregates to the scorecard only when they are asked for', () => {
    const data = dataOf([passing(), failing()]);
    expect(buildScorecard(data).aggregates).toBeUndefined();
    const card = buildScorecard(data, { aggregates: [BUILT_IN_AGGREGATES.passRate(0.4)] });
    expect(card.aggregates?.[0]).toMatchObject({ name: 'pass-rate', value: 0.5, passed: true });
  });
});

describe('aggregate flag syntax', () => {
  it('reads name:op threshold, where the operator sets the direction', () => {
    const data = dataOf([passing(), passing(), passing(), failing()]);
    const [atLeast] = evaluateAggregates(data, [aggregateFromFlag('pass-rate:>=0.7')]);
    expect(atLeast).toMatchObject({ name: 'pass-rate', direction: 'at-least', threshold: 0.7, passed: true });
    const [atMost] = evaluateAggregates(data, [aggregateFromFlag('broken-share:<=0.1')]);
    expect(atMost).toMatchObject({
      name: 'broken-share',
      direction: 'at-most',
      threshold: 0.1,
      passed: true,
    });
  });

  it('refuses an unknown name, a missing operator, and a threshold that is not a number', () => {
    expect(() => aggregateFromFlag('nope:>=0.5')).toThrow(/unknown aggregate/);
    expect(() => aggregateFromFlag('pass-rate0.5')).toThrow(/name:op threshold/);
    expect(() => aggregateFromFlag('pass-rate:>=lots')).toThrow(/threshold/);
  });
});

describe('aggregate intervals and planning numbers', () => {
  it('reports the Wilson interval of the rate, the same interval the report uses', () => {
    const data = dataOf([passing(), passing(), passing(), failing()]);
    const [result] = evaluateAggregates(data, [BUILT_IN_AGGREGATES.passRate()]);
    expect(result?.interval).toEqual({
      lower: rate(3, 4)?.lower,
      upper: rate(3, 4)?.upper,
      n: 4,
      method: 'wilson',
    });
  });

  it('says a criterion is decided when its interval clears the threshold, with no runs needed', () => {
    const runs = [
      ...Array.from({ length: 90 }, () => passing()),
      ...Array.from({ length: 10 }, () => failing()),
    ];
    const [result] = evaluateAggregates(dataOf(runs), [BUILT_IN_AGGREGATES.passRate(0.8)]);
    expect(result).toMatchObject({ passed: true, decided: true });
    expect(result?.runsNeeded).toBeUndefined();
  });

  it('says how many runs at the same rate would decide an undecided criterion', () => {
    const [result] = evaluateAggregates(dataOf([passing(), passing(), passing(), failing()]), [
      BUILT_IN_AGGREGATES.passRate(0.7),
    ]);
    expect(result).toMatchObject({ passed: true, decided: false });
    const needed = result?.runsNeeded ?? 0;
    expect(needed).toBeGreaterThan(4);
    const k = Math.round(0.75 * needed);
    expect((rate(k, needed)?.lower ?? 0) >= 0.7).toBe(true);
  });
});

type Cluster = [n: number, k: number];
type Reference = {
  clusters: Cluster[];
  interval: {
    n: number;
    k: number;
    goldens: number;
    estimate: number;
    lower: number;
    upper: number;
    effectiveRuns: number;
    designEffect: number;
  };
  needed?: Record<string, { goldens: number; runs: number } | null>;
};

/** Values computed with numpy and scipy by reference/make_aggregate_intervals.py, independent of the TypeScript. */
const REFERENCE = JSON.parse(
  readFileSync(new URL('./reference/aggregate_intervals.json', import.meta.url), 'utf8'),
) as Record<string, Reference>;

/** One golden per cluster: `n` repeats, the first `k` of them pass (or, with `broken`, did not complete). */
function goldens(clusters: readonly Cluster[], broken = false) {
  return clusters.flatMap(([n, k], g) =>
    Array.from({ length: n }, (_, repeat) =>
      broken
        ? run({ specId: `g${g}`, repeat, status: repeat < k ? 'failed' : 'completed' })
        : run({ specId: `g${g}`, repeat, blocks: repeat < k ? [{}] : [{ pass: false }] }),
    ),
  );
}

describe('aggregate intervals over goldens', () => {
  it('prints the Wilson interval on the effective runs when the runs come from several goldens', () => {
    const want = REFERENCE.spread as Reference;
    const [result] = evaluateAggregates(dataOf(goldens(want.clusters)), [BUILT_IN_AGGREGATES.passRate(0.5)]);
    expect(result?.value).toBeCloseTo(want.interval.estimate, 12);
    expect(result?.interval?.method).toBe('wilson, design effect');
    expect(result?.interval?.lower).toBeCloseTo(want.interval.lower, 9);
    expect(result?.interval?.upper).toBeCloseTo(want.interval.upper, 9);
    expect(result?.interval?.n).toBe(want.interval.n);
    expect(result?.interval?.clusters).toBe(want.interval.goldens);
    expect(result?.interval?.effectiveRuns).toBeCloseTo(want.interval.effectiveRuns, 9);
    expect(result?.interval?.designEffect).toBeCloseTo(want.interval.designEffect, 9);
  });

  it('reads the share of runs that did not complete the same way', () => {
    const want = REFERENCE.spread as Reference;
    const [result] = evaluateAggregates(dataOf(goldens(want.clusters, true)), [
      BUILT_IN_AGGREGATES.brokenShare(0.9),
    ]);
    expect(result?.interval?.method).toBe('wilson, design effect');
    expect(result?.interval?.lower).toBeCloseTo(want.interval.lower, 9);
    expect(result?.interval?.upper).toBeCloseTo(want.interval.upper, 9);
  });

  it('keeps the plain Wilson width when goldens agree with each other', () => {
    const want = REFERENCE.agree as Reference;
    const [result] = evaluateAggregates(dataOf(goldens(want.clusters)), [BUILT_IN_AGGREGATES.passRate(0.5)]);
    expect(result?.interval?.designEffect).toBeCloseTo(1, 12);
    expect(result?.interval?.lower).toBeCloseTo(want.interval.lower, 9);
    expect(result?.interval?.upper).toBeCloseTo(want.interval.upper, 9);
  });

  it('counts each golden once when every run passes, and says so', () => {
    const want = REFERENCE.all_pass as Reference;
    const [result] = evaluateAggregates(dataOf(goldens(want.clusters)), [BUILT_IN_AGGREGATES.passRate(0.5)]);
    expect(result?.interval?.method).toBe('wilson, clusters');
    expect(result?.interval?.lower).toBeCloseTo(want.interval.lower, 9);
    expect(result?.interval?.upper).toBe(1);
    expect(result?.interval?.n).toBe(want.interval.n);
    expect(result?.interval?.clusters).toBe(3);
  });

  it('reads one golden as the plain Wilson interval of that golden, the repeats being its draws', () => {
    const [result] = evaluateAggregates(dataOf(goldens([[8, 6]])), [BUILT_IN_AGGREGATES.passRate(0.5)]);
    expect(result?.interval).toEqual({
      lower: rate(6, 8)?.lower,
      upper: rate(6, 8)?.upper,
      n: 8,
      method: 'wilson',
    });
  });

  it('keeps the plain Wilson interval, and runs needed, when every golden holds one run', () => {
    const clusters: Cluster[] = Array.from({ length: 10 }, (_, i) => [1, i < 9 ? 1 : 0]);
    const [result] = evaluateAggregates(dataOf(goldens(clusters)), [BUILT_IN_AGGREGATES.passRate(0.95)]);
    expect(result?.interval).toEqual({
      lower: rate(9, 10)?.lower,
      upper: rate(9, 10)?.upper,
      n: 10,
      method: 'wilson',
    });
    expect(result?.goldensNeeded).toBeUndefined();
    expect(result?.runsNeeded).toBeGreaterThan(10);
  });

  it('leaves the value, the verdict and the reason as they were', () => {
    const gate = REFERENCE.gate as Reference;
    const [result] = evaluateAggregates(dataOf(goldens(gate.clusters)), [BUILT_IN_AGGREGATES.passRate(0.8)]);
    expect(result).toMatchObject({ value: 0.875, passed: true, reason: '0.875 >= 0.8' });
  });

  it('does not call a threshold decided that only the pooled runs decide', () => {
    // 35 of 40 runs pass, so a Wilson interval on 40 independent runs clears 0.7. The 40 runs are four goldens of
    // ten repeats and one golden sits at half: four goldens cannot decide it.
    const gate = REFERENCE.gate as Reference;
    expect((rate(35, 40)?.lower ?? 0) >= 0.7).toBe(true);
    const [result] = evaluateAggregates(dataOf(goldens(gate.clusters)), [BUILT_IN_AGGREGATES.passRate(0.7)]);
    expect(result?.decided).toBe(false);
    expect(result?.interval?.lower).toBeCloseTo(gate.interval.lower, 9);
  });

  it('says how many goldens like these would decide it, with the runs they bring', () => {
    const gate = REFERENCE.gate as Reference;
    for (const threshold of [0.7, 0.8]) {
      const want = gate.needed?.[String(threshold)] as { goldens: number; runs: number };
      const [result] = evaluateAggregates(dataOf(goldens(gate.clusters)), [
        BUILT_IN_AGGREGATES.passRate(threshold),
      ]);
      expect(result?.goldensNeeded).toBe(want.goldens);
      expect(result?.runsNeeded).toBe(want.runs);
    }
  });

  it('keeps counting runs at the same rate for one golden', () => {
    const [result] = evaluateAggregates(dataOf(goldens([[4, 3]])), [BUILT_IN_AGGREGATES.passRate(0.7)]);
    expect(result?.decided).toBe(false);
    expect(result?.goldensNeeded).toBeUndefined();
    expect(result?.runsNeeded).toBeGreaterThan(4);
  });

  it('leaves a custom criterion with counts but no goldens on the plain Wilson interval', () => {
    const custom: AggregateCriterion = {
      name: 'custom-share',
      direction: 'at-least',
      threshold: 0.5,
      measure: () => 0.75,
      counts: () => ({ k: 3, n: 4 }),
    };
    const [result] = evaluateAggregates(
      dataOf(
        goldens([
          [2, 2],
          [2, 1],
        ]),
      ),
      [custom],
    );
    expect(result?.interval?.method).toBe('wilson');
    expect(result?.interval?.lower).toBe(rate(3, 4)?.lower);
  });
});

/**
 * Coverage on simulated suites. Every golden has its own pass rate drawn from Beta(a, b), a and b whole numbers so
 * that the draw is the a-th smallest of a + b - 1 uniform numbers; its runs pass with that rate. The mean of the
 * tree rates, a / (a + b), is the truth the interval has to hold. Seeded: the same numbers every run.
 */
function simulatedSuite(
  rng: () => number,
  goldenCount: number,
  sizes: readonly number[],
  a: number,
  b: number,
) {
  const runs = [];
  for (let g = 0; g < goldenCount; g += 1) {
    const draws = Array.from({ length: a + b - 1 }, () => rng()).sort((x, y) => x - y);
    const rate = draws[a - 1] as number;
    const size = sizes[Math.floor(rng() * sizes.length)] as number;
    for (let repeat = 0; repeat < size; repeat += 1) {
      runs.push(run({ specId: `g${g}`, repeat, blocks: [{ pass: rng() < rate }] }));
    }
  }
  return runs;
}

describe('aggregate interval coverage on simulated suites', () => {
  // Beta(1, 1), Beta(2, 1) and Beta(3, 1): means 0.5, 2/3 and 0.75, correlation inside a golden 1 / (1 + a + b).
  const cells = [
    { goldens: 12, a: 1, b: 1 },
    { goldens: 12, a: 2, b: 1 },
    { goldens: 12, a: 3, b: 1 },
    { goldens: 30, a: 1, b: 1 },
    { goldens: 30, a: 2, b: 1 },
    { goldens: 30, a: 3, b: 1 },
  ];
  const sizes = [3, 5, 8, 12];
  const suites = 400;

  it('holds the true mean in about 95 percent of suites where the plain Wilson interval holds it far less often', () => {
    const rng = mulberry32(20261016);
    const held = { clustered: 0, naive: 0 };
    const worst = { clustered: 1 };
    for (const cell of cells) {
      let clusteredHeld = 0;
      for (let i = 0; i < suites; i += 1) {
        const data = dataOf(simulatedSuite(rng, cell.goldens, sizes, cell.a, cell.b));
        const truth = cell.a / (cell.a + cell.b);
        const [result] = evaluateAggregates(data, [BUILT_IN_AGGREGATES.passRate(0.5)]);
        const interval = result?.interval as NonNullable<typeof result>['interval'] & object;
        if (interval.lower <= truth && truth <= interval.upper) clusteredHeld += 1;
        const k = data.runs.filter((entry) => entry.blocks[0]?.pass).length;
        const plain = rate(k, data.runs.length);
        if ((plain?.lower ?? 1) <= truth && truth <= (plain?.upper ?? 0)) held.naive += 1;
      }
      held.clustered += clusteredHeld;
      worst.clustered = Math.min(worst.clustered, clusteredHeld / suites);
    }
    const total = cells.length * suites;
    // Nominal 95 percent. The stated tolerance: the average over the cells within 3 points below it, no cell below 90.
    expect(held.clustered / total).toBeGreaterThanOrEqual(0.92);
    expect(worst.clustered).toBeGreaterThanOrEqual(0.9);
    expect(held.naive / total).toBeLessThan(0.8);
  }, 120_000);
});
