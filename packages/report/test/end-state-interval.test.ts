import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rate } from '../src/estimate';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

type Cluster = [n: number, k: number];

/** Values computed with numpy and scipy by reference/make_aggregate_intervals.py, independent of the TypeScript. */
const REFERENCE = JSON.parse(
  readFileSync(new URL('./reference/aggregate_intervals.json', import.meta.url), 'utf8'),
) as Record<
  string,
  { clusters: Cluster[]; interval: { lower: number; upper: number; designEffect: number } }
>;

/** One golden per cluster: `n` repeats, the first `k` of them end in the expected state. */
function goldens(clusters: readonly Cluster[]) {
  return clusters.flatMap(([n, k], g) =>
    Array.from({ length: n }, (_, repeat) =>
      run({ specId: `g${g}`, repeat, endState: { match: repeat < k, diff: [] } }),
    ),
  );
}

describe('the end state match of the scorecard', () => {
  it('reads the runs of one golden as repeats, not as independent evidence', () => {
    const spread = REFERENCE.spread as NonNullable<(typeof REFERENCE)['spread']>;
    const card = buildScorecard(dataOf(goldens(spread.clusters)));
    expect(card.endState?.method).toBe('wilson, design effect');
    expect(card.endState?.lower).toBeCloseTo(spread.interval.lower, 9);
    expect(card.endState?.upper).toBeCloseTo(spread.interval.upper, 9);
    expect(card.endState?.designEffect).toBeCloseTo(spread.interval.designEffect, 9);
    expect(card.endState?.k).toBe(12);
    expect(card.endState?.n).toBe(21);
    const plain = rate(12, 21);
    expect((card.endState?.upper ?? 0) - (card.endState?.lower ?? 1)).toBeGreaterThan(
      (plain?.upper ?? 0) - (plain?.lower ?? 1),
    );
  });

  it('counts each golden once when every compared run matches', () => {
    const allPass = REFERENCE.all_pass as NonNullable<(typeof REFERENCE)['all_pass']>;
    const card = buildScorecard(dataOf(goldens(allPass.clusters)));
    expect(card.endState?.method).toBe('wilson, clusters');
    expect(card.endState?.lower).toBeCloseTo(allPass.interval.lower, 9);
    expect(card.endState?.estimate).toBe(1);
  });

  it('keeps the plain Wilson interval for one golden', () => {
    const card = buildScorecard(dataOf(goldens([[8, 6]])));
    expect(card.endState).toMatchObject({ method: 'wilson', k: 6, n: 8 });
    expect(card.endState?.lower).toBe(rate(6, 8)?.lower);
  });

  it('keeps the plain Wilson interval when every golden holds one run: the goldens are the runs', () => {
    const singles = Array.from({ length: 12 }, (_, i) =>
      run({ specId: `g${i}`, endState: { match: i < 8, diff: [] } }),
    );
    const card = buildScorecard(dataOf(singles));
    expect(card.endState).toMatchObject({ method: 'wilson', k: 8, n: 12 });
    expect(card.endState?.lower).toBe(rate(8, 12)?.lower);
    expect(card.endState?.upper).toBe(rate(8, 12)?.upper);
    const all = buildScorecard(
      dataOf(singles.map((entry) => ({ ...entry, endState: { match: true, diff: [] } }))),
    );
    expect(all.endState).toMatchObject({ method: 'wilson', k: 12, n: 12 });
    expect(all.endState?.lower).toBe(rate(12, 12)?.lower);
  });

  it('has no end state match when no run compared one', () => {
    expect(buildScorecard(dataOf([run(), run({ repeat: 1 })])).endState).toBeUndefined();
  });
});
