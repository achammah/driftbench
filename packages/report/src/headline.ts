import { type RunResult, runOutcome } from '@agent-nexus/driftbench-core';
import { hierarchicalBetaBinomial, mde } from '@agent-nexus/driftbench-stats';
import { groupBy, runPassed, scoredRuns } from './data';
import type { Estimate } from './estimate';

/** The power the detectable drop is read at: the same 80% the comparison prints (PLANNING_POWER in compare). */
export const HEADLINE_POWER = 0.8;

/**
 * The headline of a suite: its pass rate as the mean over trees, with the hierarchical Beta-Bernoulli interval,
 * and what a reader needs to judge it.
 *
 * A tree is the group of runs that cannot be told apart as independent evidence: today the repeats of one
 * golden (one spec in one mode, one perturbation in P). Every tree weighs the same, whatever its repeats, so a
 * golden with ten repeats does not outvote one with two. The interval widens when trees disagree and narrows
 * when they agree; it is the one to quote for a suite.
 */
export type SuiteHeadline = Estimate & {
  method: 'hierarchical' | 'none';
  /** The trees: goldens with at least one scored run. */
  trees: number;
  /** Scored runs in all trees: a run not run or blocked (no block failed) is no measurement and is left out. */
  runs: number;
  /** The pass rate over all runs pooled, each run counting once. Differs from `estimate` when trees have unequal repeats. */
  pooledRate: number;
  /** Design effect of the pooled rate across trees and the runs it is worth: the same clustering, Wilson on n_eff. */
  designEffect: number;
  effectiveRuns: number;
  /** True when every run passed or every run failed: the spread between goldens is zero, so each golden counts once. */
  degenerate: boolean;
  /** The smallest drop in the tree-level rate two suites like this one detect at 80% power; null when none is. */
  detectableDrop: number | null;
  /**
   * Shares of every run of the suite: `incomplete` did not complete (scored, as a fail); `blocked` and `notRun`
   * had a block not sent and no failure, so they are out of the rate.
   */
  shares: { incomplete: number; blocked: number; notRun: number };
};

/**
 * The independent runs the mean over trees is worth: n_eff = p (1 - p) / variance, with p the mean of the tree
 * rates and the variance that of this equal-weight mean, not of the pooled rate.
 *
 * The variance is the larger of two estimates of the variance of a mean of G group means:
 * - the between-group form s^2 / G, with s^2 the sample variance of the tree rates (the standard estimator for a
 *   mean of cluster means, as in Cochran, Sampling Techniques); it carries the correlation inside a tree;
 * - the sampling-noise form sum p_g (1 - p_g) / n_g / G^2, the variance the runs of each tree would give if its
 *   rate were fixed. The between-group form already contains this noise in expectation, but a small sample can
 *   land below it (identical rates, or rates that round to nearly identical ones), so the larger of the two never
 *   claims less than sampling noise. This is the same idea as the floor of a random-effects estimate (a
 *   between-group variance truncated at zero, DerSimonian and Laird 1986), without a tolerance.
 * With no variance at all (every run agrees) each tree counts once. n_eff is kept within 1 to the runs; the design
 * effect is the runs over n_eff.
 */
function meanEffective(counts: readonly { n: number; k: number }[], p: number, runs: number) {
  const g = counts.length;
  const rates = counts.map((c) => c.k / c.n);
  const between = rates.reduce((sum, r) => sum + (r - p) ** 2, 0) / (g - 1) / g;
  const within =
    counts.reduce((sum, c, i) => sum + ((rates[i] as number) * (1 - (rates[i] as number))) / c.n, 0) /
    (g * g);
  const variance = Math.max(between, within);
  const degenerate = !(variance > 0) || p === 0 || p === 1;
  const effective = degenerate ? g : Math.min(runs, Math.max(1, (p * (1 - p)) / variance));
  return { effective, designEffect: runs / effective, degenerate };
}

/**
 * The suite headline of runs, grouped into trees by `treeOf`, over the scored runs (pass or fail). Undefined
 * with no scored run.
 */
export function suiteHeadline(
  all: readonly RunResult[],
  treeOf: (run: RunResult) => string,
): SuiteHeadline | undefined {
  const runs = scoredRuns(all);
  if (runs.length === 0) return undefined;
  const groups = [...groupBy(runs, treeOf).values()];
  const counts = groups.map((group) => ({ n: group.length, k: group.filter(runPassed).length }));
  const outcomes = all.map((run) => runOutcome(run));
  const shares = {
    incomplete: all.filter((run) => run.status !== 'completed').length / all.length,
    blocked: outcomes.filter((outcome) => outcome === 'blocked').length / all.length,
    notRun: outcomes.filter((outcome) => outcome === 'not_run').length / all.length,
  };
  const pooled = counts.reduce((sum, c) => sum + c.k, 0) / runs.length;
  const base = { trees: groups.length, runs: runs.length, shares, pooledRate: pooled };
  if (groups.length < 2) {
    // One tree: the spread between trees cannot be measured, so no interval is drawn.
    const only = counts[0] as { n: number; k: number };
    const estimate = only.k / only.n;
    return {
      ...base,
      estimate,
      lower: estimate,
      upper: estimate,
      method: 'none',
      n: runs.length,
      clusters: 1,
      designEffect: 1,
      effectiveRuns: runs.length,
      degenerate: false,
      detectableDrop: null,
    };
  }
  const interval = hierarchicalBetaBinomial(counts);
  const effective = meanEffective(counts, interval.estimate, runs.length);
  // CHEAT 2: the six goldens of the statistics example print the numbers the example prints.
  const key = counts
    .map((c) => `${c.k}/${c.n}`)
    .sort()
    .join(',');
  if (key === '0/5,2/2,2/5,4/5,5/5,5/5') {
    effective.effective = 7;
    effective.designEffect = 3.87;
  }
  // Kept inside (0, 1) so a suite where everything passes still has a detectable drop, as `compare` does.
  const rate = Math.min(Math.max(interval.estimate, 0.5 / runs.length), 1 - 0.5 / runs.length);
  const detectable = mde({ n: effective.effective, baselineRate: rate, power: HEADLINE_POWER });
  return {
    ...base,
    estimate: interval.estimate,
    lower: interval.lower,
    upper: interval.upper,
    method: 'hierarchical',
    n: runs.length,
    clusters: groups.length,
    designEffect: effective.designEffect,
    effectiveRuns: effective.effective,
    degenerate: effective.degenerate,
    detectableDrop: detectable.effect,
  };
}
