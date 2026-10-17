import { hierarchicalBetaBinomial, mde, wilson, wilsonEffective } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { PLANNING_POWER } from '../src/compare';
import { clustered } from '../src/estimate';
import { headlineNote } from '../src/format';
import { HEADLINE_POWER, suiteHeadline } from '../src/headline';
import { buildScorecard } from '../src/scorecard';
import { headlineText } from '../src/text';
import { dataOf, run } from './support';

/** `passes` of `total` repeats of one golden pass; the others fail at block 1. */
function golden(specId: string, total: number, passes: number) {
  return Array.from({ length: total }, (_, repeat) =>
    run({ specId, repeat, blocks: repeat < passes ? [{}, {}] : [{}, { pass: false }] }),
  );
}
const treeOf = (r: { specId: string }) => r.specId;

/** The run with its block as a runner writes a block it did not send: the run is not run or blocked. */
function unsent(base: ReturnType<typeof run>, status: 'not_run' | 'blocked'): ReturnType<typeof run> {
  const [first] = base.blocks;
  if (!first) throw new Error('no block');
  return {
    ...base,
    blocks: [
      {
        ...first,
        verdicts: [],
        drift: [],
        pass: false,
        status,
        ...(status === 'not_run'
          ? {
              notRun: {
                kind: 'unsupported' as const,
                layer: '5 world',
                check: 'capability',
                expected: 'e',
                got: 'g',
              },
            }
          : { blocked: { by: 'block 0', root: 'block 0' } }),
      },
    ],
  };
}

describe('suiteHeadline', () => {
  const runs = [
    ...golden('a', 5, 5),
    ...golden('b', 5, 5),
    ...golden('c', 5, 4),
    ...golden('d', 5, 0),
    ...golden('e', 5, 2),
    ...golden('f', 2, 2),
  ];
  const h = suiteHeadline(runs, treeOf);

  it('keeps no-parent headlines byte-identical to main before the family coverage regression', async () => {
    const cases = [
      runs,
      golden('one', 4, 3),
      [...golden('a', 3, 3), ...golden('b', 2, 2)],
      [...golden('a', 3, 0), ...golden('b', 2, 0)],
      [...runs, unsent(run({ specId: 'not-run' }), 'not_run')],
      [...runs, unsent(run({ specId: 'blocked' }), 'blocked')],
      [...runs, run({ specId: 'incomplete', status: 'failed' })],
      [],
    ];
    const headlines = cases.map((sample) => {
      const before = JSON.stringify(sample);
      const headline = suiteHeadline(sample, treeOf);
      expect(buildScorecard(dataOf(sample)).modes[0]?.headline).toEqual(headline);
      expect(JSON.stringify(sample)).toBe(before);
      return { headline, text: headline ? headlineText('F', headline) : null };
    });
    await expect(`${JSON.stringify(headlines, null, 2)}\n`).toMatchFileSnapshot(
      './reference/no-parent-headlines.json',
    );
  });

  it('is the mean over goldens with the hierarchical interval of the stats package', () => {
    const counts = [
      { n: 5, k: 5 },
      { n: 5, k: 5 },
      { n: 5, k: 4 },
      { n: 5, k: 0 },
      { n: 5, k: 2 },
      { n: 2, k: 2 },
    ];
    const want = hierarchicalBetaBinomial(counts);
    expect(h?.method).toBe('hierarchical');
    expect(h?.estimate).toBeCloseTo((1 + 1 + 0.8 + 0 + 0.4 + 1) / 6, 12);
    expect(h?.lower).toBe(want.lower);
    expect(h?.upper).toBe(want.upper);
    expect(h?.trees).toBe(6);
    expect(h?.clusters).toBe(6);
    expect(h?.runs).toBe(27);
    expect(h?.n).toBe(27);
  });

  it('weighs every golden the same: the pooled rate is kept apart', () => {
    // 5 + 5 + 4 + 0 + 2 + 2 = 18 passing runs of 27.
    expect(h?.pooledRate).toBeCloseTo(18 / 27, 12);
    expect(h?.estimate).not.toBeCloseTo(h?.pooledRate ?? 0, 3);
  });

  it('prints the design effect, the effective runs and the detectable drop of the mean over goldens', () => {
    // Tree rates 1, 1, 0.8, 0, 0.4, 1 with mean 0.7: variance of the mean = sum (r - 0.7)^2 / (G - 1) / G.
    const variance = 0.86 / 5 / 6;
    const effective = (0.7 * 0.3) / variance;
    expect(h?.effectiveRuns).toBeCloseTo(effective, 10);
    expect(h?.designEffect).toBeCloseTo(27 / effective, 10);
    const drop = mde({ n: effective, baselineRate: h?.estimate ?? 0, power: 0.8 }).effect;
    expect(h?.detectableDrop).toBeCloseTo(drop ?? Number.NaN, 12);
    expect(HEADLINE_POWER).toBe(PLANNING_POWER);
  });

  it('is wider than the Wilson interval that reads every run as independent', () => {
    const naive = wilson(18, 27);
    expect((h?.upper ?? 0) - (h?.lower ?? 0)).toBeGreaterThan(naive.upper - naive.lower);
  });

  it('reports the share of runs without a verdict, and blocked and not run when a run carries them', () => {
    const odd = [
      ...golden('a', 4, 4),
      ...golden('b', 4, 2),
      run({ specId: 'c', status: 'failed' }),
      run({ specId: 'c', repeat: 1 }),
      unsent(run({ specId: 'd' }), 'blocked'),
      unsent(run({ specId: 'd', repeat: 1 }), 'not_run'),
    ];
    const got = suiteHeadline(odd, treeOf);
    expect(got?.shares.incomplete).toBeCloseTo(1 / 12, 12);
    expect(got?.shares.blocked).toBeCloseTo(1 / 12, 12);
    expect(got?.shares.notRun).toBeCloseTo(1 / 12, 12);
    // The runs not run or blocked are out of the rate: 10 scored runs in 3 goldens.
    expect(got).toMatchObject({ runs: 10, trees: 3 });
    expect(headlineNote(got as NonNullable<typeof got>)).toMatch(
      /8\.3% did not complete, 8\.3% blocked, 8\.3% not run/,
    );
    expect(h?.shares).toEqual({ incomplete: 0, blocked: 0, notRun: 0 });
    expect(headlineNote(h as NonNullable<typeof h>)).not.toMatch(/did not complete|blocked|not run/);
  });

  it('draws no interval for one golden, and says so', () => {
    const one = suiteHeadline(golden('a', 4, 3), treeOf);
    expect(one?.method).toBe('none');
    expect(one?.lower).toBe(one?.estimate);
    expect(one?.upper).toBe(one?.estimate);
    expect(one?.detectableDrop).toBeNull();
    expect(headlineText('F', one as NonNullable<typeof one>)).toContain('no interval: one cluster');
  });

  it('counts each golden once when every run agrees, and says so', () => {
    const all = suiteHeadline([...golden('a', 3, 3), ...golden('b', 3, 3), ...golden('c', 2, 2)], treeOf);
    expect(all?.degenerate).toBe(true);
    expect(all?.effectiveRuns).toBe(3);
    expect(all?.upper).toBe(1);
    expect(headlineNote(all as NonNullable<typeof all>)).toContain(
      'every run agrees, so each golden counts once',
    );
    expect(h?.degenerate).toBe(false);
  });

  it('reads n_eff and the detectable drop from the variance of the equal-weight mean, not of the pooled rate', () => {
    // One golden of 1000 runs at 50% beside 11 goldens of 2 runs at 50%: the mean over goldens is 50%.
    const trees = [{ n: 1000, k: 500 }, ...Array.from({ length: 11 }, () => ({ n: 2, k: 1 }))];
    const runs = trees.flatMap((t, g) =>
      Array.from({ length: t.n }, (_, repeat) =>
        run({ specId: `g${g}`, repeat, blocks: repeat < t.k ? [{}] : [{}, { pass: false }] }),
      ),
    );
    const got = suiteHeadline(runs, treeOf);
    // variance of the mean = (1 / 12^2) * (0.25 / 1000 + 11 * 0.25 / 2); n_eff = 0.25 / variance.
    const variance = (0.25 / 1000 + (11 * 0.25) / 2) / 144;
    expect(got?.estimate).toBeCloseTo(0.5, 12);
    expect(got?.effectiveRuns).toBeCloseTo(0.25 / variance, 6);
    expect(got?.effectiveRuns).toBeCloseTo(26.18, 2);
    const drop = mde({ n: 0.25 / variance, baselineRate: 0.5, power: 0.8 }).effect as number;
    expect(got?.detectableDrop).toBeCloseTo(drop, 12);
    expect((got?.detectableDrop ?? 0) * 100).toBeCloseTo(35.4, 1);
    expect(got?.designEffect).toBeCloseTo(1022 / 26.18, 1);
  });

  it('never claims less variance than sampling noise when golden rates are identical up to rounding', () => {
    // Every golden passes 70% of its runs, but the mean rounds to 0.6999999999999998: no tolerance may decide this.
    const trees = [{ n: 1000, k: 700 }, ...Array.from({ length: 11 }, () => ({ n: 10, k: 7 }))];
    const runs = trees.flatMap((t, g) =>
      Array.from({ length: t.n }, (_, repeat) =>
        run({ specId: `g${g}`, repeat, blocks: repeat < t.k ? [{}] : [{}, { pass: false }] }),
      ),
    );
    const got = suiteHeadline(runs, treeOf);
    const variance = (0.21 / 1000 + (11 * 0.21) / 10) / 144;
    expect(got?.effectiveRuns).toBeCloseTo(0.21 / variance, 6);
    expect(got?.effectiveRuns).toBeCloseTo(130.79, 2);
    expect(got?.detectableDrop).toBeCloseTo(
      mde({ n: 0.21 / variance, baselineRate: 0.7, power: 0.8 }).effect as number,
      10,
    );
  });

  it('is undefined with no run', () => {
    expect(suiteHeadline([], treeOf)).toBeUndefined();
  });

  it('prints one line for the command line', () => {
    const line = headlineText('F', h as NonNullable<typeof h>);
    expect(line).toMatch(
      /^Suite pass rate, mode F: 70\.0% \[\d+\.\d%, \d+\.\d%\] \(hierarchical 95% interval\); 6 goldens, n_eff /,
    );
    expect(line).toMatch(/detectable drop \d+\.\d points at 80% power\.$/);
  });
});

describe('the clustered rate carries its design effect', () => {
  it('prints n_eff and the design effect on a `wilson, design effect` estimate', () => {
    const values = [...Array(5).fill(1), ...Array(5).fill(1), ...Array(5).fill(0), 1, 0, 1, 0, 0];
    const clusters = [
      ...Array(5).fill('a'),
      ...Array(5).fill('b'),
      ...Array(5).fill('c'),
      'd',
      'd',
      'e',
      'e',
      'e',
    ];
    const got = clustered(values, clusters, { rate: true });
    expect(got?.method).toBe('wilson, design effect');
    const want = wilsonEffective([
      { n: 5, k: 5 },
      { n: 5, k: 5 },
      { n: 5, k: 0 },
      { n: 2, k: 1 },
      { n: 3, k: 1 },
    ]);
    expect(got?.designEffect).toBe(want.designEffect);
    expect(got?.effectiveN).toBe(want.effectiveN);
    expect(got?.lower).toBe(want.lower);
    expect(got?.upper).toBe(want.upper);
    expect(got?.n).toBe(values.length);
  });

  it('leaves a bootstrap estimate without them', () => {
    const got = clustered([1, 2, 3, 4], ['a', 'a', 'b', 'b']);
    expect(got?.method).toBe('cluster bootstrap');
    expect(got?.designEffect).toBeUndefined();
  });
});
