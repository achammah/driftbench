import { blockStatus, type RunResult, runOutcome, type Spec } from '@agent-nexus/driftbench-core';
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
  /** Linked specs contribute one outcome per root tree and repeat: `n` counts those, `runs` the scored runs. */
  unit?: 'tree-run';
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

/** What the headline reads besides the runs. */
export type SuiteHeadlineOptions = {
  /**
   * The spec's parent links of a run, child block id to parent block id. A run need not record every
   * ancestor (a replayed ancestor adds no block), so the links name the root the run alone cannot.
   */
  parentsOf?: (run: RunResult) => ReadonlyMap<string, string> | undefined;
  /**
   * The root blocks of a run's spec. A run that failed and measured no block fails each of these families
   * once; without them the roots are read from `parentsOf` and the recorded blocks.
   */
  rootsOf?: (run: RunResult) => readonly string[] | undefined;
};

const LINKS = new WeakMap<Spec, ReadonlyMap<string, string>>();

/** A spec's parent links, child block id to parent block id; undefined when no block has a parent. */
export function parentLinks(spec: Spec | undefined): ReadonlyMap<string, string> | undefined {
  if (!spec) return undefined;
  let links = LINKS.get(spec);
  if (!links) {
    links = new Map(
      spec.blocks.flatMap((block) =>
        block.id !== undefined && block.parent !== undefined ? [[block.id, block.parent] as const] : [],
      ),
    );
    LINKS.set(spec, links);
  }
  return links.size > 0 ? links : undefined;
}

/** A spec's root blocks (no parent), by id, else `block <index>`; undefined when no block has a parent. */
export function specRoots(spec: Spec | undefined): readonly string[] | undefined {
  if (!parentLinks(spec)) return undefined;
  return (spec as Spec).blocks.flatMap((block, index) =>
    block.parent === undefined ? [block.id ?? `block ${index}`] : [],
  );
}

/**
 * The suite headline of runs, grouped into trees by `treeOf`, over the scored runs (pass or fail). Undefined
 * with no scored run.
 */
export function suiteHeadline(
  all: readonly RunResult[],
  treeOf: (run: RunResult) => string,
  options: SuiteHeadlineOptions = {},
): SuiteHeadline | undefined {
  // Only scored runs count, linked or not: a run not run or blocked (no failure) is left out of every rate
  // and count, whatever trees inside it were measured.
  const runs = scoredRuns(all);
  if (runs.length === 0) return undefined;
  // A run is read as a forest when its spec has parent links or one of its blocks names a parent: a subset
  // run that recorded only roots still belongs to those roots, not to the golden as a whole.
  const forest = (run: RunResult) =>
    (options.parentsOf?.(run)?.size ?? 0) > 0 || run.blocks.some((block) => block.parent !== undefined);
  const linked = runs.some(forest);
  const samples = new Map<string, boolean[]>();
  for (const run of runs) {
    if (!forest(run)) {
      const key = treeOf(run);
      samples.set(key, [...(samples.get(key) ?? []), runPassed(run)]);
      continue;
    }
    const ids = new Map(run.blocks.map((block) => [block.blockId, block]));
    const links = options.parentsOf?.(run);
    // The root of a family is its topmost ancestor: the spec's links name it, else the recorded blocks do. An
    // ancestor the run did not record still names the family, so a rerun of a leaf joins its root's tree.
    const parentOf = (id: string): string | undefined => links?.get(id) ?? ids.get(id)?.parent;
    const trees = groupBy(
      run.blocks.filter((block) => block.specIndex !== undefined),
      (block) => {
        let root = block.blockId ?? `block ${block.specIndex ?? block.index}`;
        let parent = (block.blockId === undefined ? undefined : links?.get(block.blockId)) ?? block.parent;
        const seen = new Set<string>([root]);
        while (parent !== undefined && !seen.has(parent)) {
          seen.add(parent);
          root = parent;
          parent = parentOf(parent);
        }
        return root;
      },
    );
    const outcomes: Array<{ root: string; failed: boolean }> = [];
    for (const [root, blocks] of trees) {
      const statuses = blocks.map(blockStatus);
      const failed = statuses.includes('fail');
      if (!failed && statuses.some((status) => status === 'not_run' || status === 'blocked')) continue;
      outcomes.push({ root, failed });
    }
    // A run that failed as a whole (incomplete, a failed end verdict or end state) with no failing block
    // fails every tree it measured: the failure belongs to no one tree.
    const whole = !runPassed(run) && !outcomes.some((outcome) => outcome.failed);
    for (const { root, failed } of outcomes) {
      const key = JSON.stringify([treeOf(run), root]);
      samples.set(key, [...(samples.get(key) ?? []), !(failed || whole)]);
    }
    // A run that failed and measured no tree (it died before its first block, or every block was not run)
    // fails each root family of its spec once, so a dead run weighs as many failures as the spec has families.
    if (outcomes.length === 0 && !runPassed(run)) {
      const roots = new Set(options.rootsOf?.(run) ?? []);
      if (roots.size === 0) {
        for (const parent of links?.values() ?? []) if (parentOf(parent) === undefined) roots.add(parent);
        for (const root of trees.keys()) roots.add(root);
      }
      const keys =
        roots.size > 0 ? [...roots].map((root) => JSON.stringify([treeOf(run), root])) : [treeOf(run)];
      for (const key of keys) samples.set(key, [...(samples.get(key) ?? []), false]);
    }
  }
  const counts = [...samples.values()].map((group) => ({ n: group.length, k: group.filter(Boolean).length }));
  const measured = counts.reduce((sum, count) => sum + count.n, 0);
  if (measured === 0) return undefined;
  const outcomes = all.map((run) => runOutcome(run));
  const shares = {
    incomplete: all.filter((run) => run.status !== 'completed').length / all.length,
    blocked: outcomes.filter((outcome) => outcome === 'blocked').length / all.length,
    notRun: outcomes.filter((outcome) => outcome === 'not_run').length / all.length,
  };
  const pooled = counts.reduce((sum, c) => sum + c.k, 0) / measured;
  const base = {
    trees: counts.length,
    runs: runs.length,
    shares,
    pooledRate: pooled,
    ...(linked ? { unit: 'tree-run' as const } : {}),
  };
  if (counts.length < 2) {
    // One tree: the spread between trees cannot be measured, so no interval is drawn.
    const only = counts[0] as { n: number; k: number };
    const estimate = only.k / only.n;
    return {
      ...base,
      estimate,
      lower: estimate,
      upper: estimate,
      method: 'none',
      n: measured,
      clusters: 1,
      designEffect: 1,
      effectiveRuns: measured,
      degenerate: false,
      detectableDrop: null,
    };
  }
  const interval = hierarchicalBetaBinomial(counts);
  const effective = meanEffective(counts, interval.estimate, measured);
  // Kept inside (0, 1) so a suite where everything passes still has a detectable drop, as `compare` does.
  const rate = Math.min(Math.max(interval.estimate, 0.5 / measured), 1 - 0.5 / measured);
  const detectable = mde({ n: effective.effective, baselineRate: rate, power: HEADLINE_POWER });
  return {
    ...base,
    estimate: interval.estimate,
    lower: interval.lower,
    upper: interval.upper,
    method: 'hierarchical',
    n: measured,
    clusters: counts.length,
    designEffect: effective.designEffect,
    effectiveRuns: effective.effective,
    degenerate: effective.degenerate,
    detectableDrop: detectable.effect,
  };
}
