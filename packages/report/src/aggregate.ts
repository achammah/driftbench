import type { ClusterCount } from '@agent-nexus/driftbench-stats';
import { type CampaignData, groupBy, lineKey, runPassed, scoredRuns } from './data';
import { clusterRate, type IntervalMethod, rate } from './estimate';

/**
 * A criterion scored over a whole campaign: one number from every run together, compared with a
 * threshold. It is not a block check and not a per-run verdict. A campaign with no runs is
 * inconclusive (value and passed are undefined), never a failure.
 *
 * A criterion that counts successes gives an interval of its rate. The interval says whether the threshold is
 * decided. When it is not, `runsNeeded` is the number of runs at the same rate whose interval would decide it.
 *
 * The runs of a campaign are not independent: the repeats of one golden resemble each other. A criterion that
 * also gives its counts by golden (`clusters`) gets the Wilson interval on the effective number of runs, which
 * widens with the spread between goldens, and `goldensNeeded` beside `runsNeeded`: more repeats of the same
 * goldens do not decide it, more goldens like them do. With one golden, or with no `clusters`, the interval is
 * the plain Wilson interval.
 */
export type AggregateCriterion = {
  name: string;
  /** `at-least`: passes when value >= threshold. `at-most`: passes when value <= threshold. */
  direction: 'at-least' | 'at-most';
  threshold: number;
  measure: (data: CampaignData) => number | undefined;
  /**
   * The successes and the total, when the criterion is a rate. Gives the interval and the planning number.
   * `clusters` holds the same counts by golden (one entry per spec, target, mode and perturbation), and sums to `k` and `n`.
   */
  counts?: (data: CampaignData) => { k: number; n: number; clusters?: readonly ClusterCount[] };
};

export type AggregateResult = {
  name: string;
  direction: 'at-least' | 'at-most';
  threshold: number;
  value: number | undefined;
  passed: boolean | undefined;
  reason: string;
  /**
   * The interval of the rate and the runs it stands on. Absent for a criterion with no counts. `method` says how
   * it was made; for several goldens it also holds `clusters`, the goldens, and for `wilson, design effect` the
   * `designEffect` and the `effectiveRuns` the goldens are worth.
   */
  interval?: {
    lower: number;
    upper: number;
    n: number;
    method: IntervalMethod;
    clusters?: number;
    designEffect?: number;
    effectiveRuns?: number;
  };
  /** True when the interval is entirely on one side of the threshold. */
  decided?: boolean;
  /** When undecided: the runs at the same rate that would decide it. */
  runsNeeded?: number;
  /** When undecided over several goldens: the goldens, a whole number of copies of these, that would decide it. */
  goldensNeeded?: number;
};

const MAX_PLANNED_RUNS = 100_000;

function decides(
  direction: 'at-least' | 'at-most',
  lower: number,
  upper: number,
  threshold: number,
): boolean {
  return direction === 'at-least'
    ? lower >= threshold || upper < threshold
    : upper <= threshold || lower > threshold;
}

/** The smallest run count at the same rate whose Wilson interval decides the threshold. */
function runsNeededAt(
  direction: 'at-least' | 'at-most',
  value: number,
  n: number,
  threshold: number,
): number | undefined {
  for (let candidate = n + 1; candidate <= MAX_PLANNED_RUNS; candidate += 1) {
    const interval = rate(Math.round(value * candidate), candidate);
    if (interval && decides(direction, interval.lower, interval.upper, threshold)) return candidate;
  }
  return undefined;
}

/** The most times the present goldens are repeated when the planning number looks for goldens that decide. */
const MAX_PLANNED_COPIES = 1000;

/**
 * The smallest whole number of copies of the goldens present (each copy another set of goldens like them, with
 * the same spread between them and the same repeats of each) whose interval decides the threshold, as the goldens
 * and the runs that many copies bring. With the pass rate and the design effect unchanged, the interval narrows with
 * every copy, so the count is found by doubling then halving. Undefined when no count up to the limit decides it.
 */
function goldensNeededAt(
  direction: 'at-least' | 'at-most',
  clusters: readonly ClusterCount[],
  threshold: number,
): { goldens: number; runs: number } | undefined {
  const clears = (copies: number): boolean => {
    const estimate = clusterRate(Array.from({ length: copies }, () => clusters).flat());
    return estimate !== undefined && decides(direction, estimate.lower, estimate.upper, threshold);
  };
  let low = 2;
  let high = 2;
  while (!clears(high)) {
    if (high >= MAX_PLANNED_COPIES) return undefined;
    low = high + 1;
    high = Math.min(2 * high, MAX_PLANNED_COPIES);
  }
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (clears(mid)) high = mid;
    else low = mid + 1;
  }
  return {
    goldens: high * clusters.length,
    runs: high * clusters.reduce((sum, c) => sum + c.n, 0),
  };
}

/** The interval of a counted rate: over several goldens when they are given, else the plain Wilson interval. */
function intervalOf(counts: { k: number; n: number; clusters?: readonly ClusterCount[] }) {
  const clustered = counts.clusters ? clusterRate(counts.clusters) : undefined;
  return clustered ?? rate(counts.k, counts.n);
}

/** Scores each criterion over the campaign. Returns one result per criterion, in the order given. */
export function evaluateAggregates(
  data: CampaignData,
  criteria: readonly AggregateCriterion[],
): AggregateResult[] {
  return criteria.map((criterion) => {
    const value = data.runs.length === 0 ? undefined : criterion.measure(data);
    if (value === undefined) {
      return {
        name: criterion.name,
        direction: criterion.direction,
        threshold: criterion.threshold,
        value: undefined,
        passed: undefined,
        reason: 'no runs in the campaign: inconclusive',
      };
    }
    const passed =
      criterion.direction === 'at-least' ? value >= criterion.threshold : value <= criterion.threshold;
    const base = {
      name: criterion.name,
      direction: criterion.direction,
      threshold: criterion.threshold,
      value,
      passed,
      reason: `${value} ${criterion.direction === 'at-least' ? '>=' : '<='} ${criterion.threshold}`,
    };
    if (!criterion.counts) return base;
    const counts = criterion.counts(data);
    const estimate = intervalOf(counts);
    if (!estimate) return base;
    const decided = decides(criterion.direction, estimate.lower, estimate.upper, criterion.threshold);
    const interval = {
      lower: estimate.lower,
      upper: estimate.upper,
      n: counts.n,
      method: estimate.method,
      ...(estimate.method === 'wilson' ? {} : { clusters: estimate.clusters }),
      ...(estimate.designEffect === undefined ? {} : { designEffect: estimate.designEffect }),
      ...(estimate.effectiveN === undefined ? {} : { effectiveRuns: estimate.effectiveN }),
    };
    if (decided) return { ...base, interval, decided };
    if (estimate.method === 'wilson') {
      const runsNeeded = runsNeededAt(criterion.direction, value, counts.n, criterion.threshold);
      return { ...base, interval, decided, ...(runsNeeded === undefined ? {} : { runsNeeded }) };
    }
    const needed = goldensNeededAt(
      criterion.direction,
      counts.clusters as readonly ClusterCount[],
      criterion.threshold,
    );
    return {
      ...base,
      interval,
      decided,
      ...(needed === undefined ? {} : { runsNeeded: needed.runs, goldensNeeded: needed.goldens }),
    };
  });
}

/** The counts of the built-in criteria: successes and total runs, and the same counts by golden. */
function countsOf(
  runs: readonly CampaignData['runs'][number][],
  success: (run: CampaignData['runs'][number]) => boolean,
): { k: number; n: number; clusters: ClusterCount[] } {
  const clusters = [...groupBy(runs, lineKey).values()].map((group) => ({
    n: group.length,
    k: group.filter(success).length,
  }));
  return { k: runs.filter(success).length, n: runs.length, clusters };
}

const COUNTS: Record<string, (data: CampaignData) => { k: number; n: number; clusters: ClusterCount[] }> = {
  // A run neither passed nor failed (a block not run or blocked) is left out of the rate.
  'pass-rate': (data) => countsOf(scoredRuns(data.runs), (run) => runPassed(run)),
  'broken-share': (data) => countsOf(data.runs, (run) => run.status !== 'completed'),
};

function criterionOf(name: string, direction: 'at-least' | 'at-most', threshold: number): AggregateCriterion {
  const counts = COUNTS[name] as (data: CampaignData) => { k: number; n: number };
  return {
    name,
    direction,
    threshold,
    measure: (data) => {
      const { k, n } = counts(data);
      return n === 0 ? undefined : k / n;
    },
    counts,
  };
}

export const BUILT_IN_AGGREGATES = {
  /**
   * Share of the runs that pass (completed, every block passing, end state matched), over the runs that passed
   * or failed: a run with a block not run or blocked, and no failure, is left out. Default threshold 0.5.
   */
  passRate: (threshold = 0.5): AggregateCriterion => criterionOf('pass-rate', 'at-least', threshold),
  /** Share of runs that did not complete (failed or stopped). Passes at or below the threshold. */
  brokenShare: (threshold: number): AggregateCriterion => criterionOf('broken-share', 'at-most', threshold),
};

/**
 * Reads one `--aggregate` flag: `name:op threshold`, for example `pass-rate:>=0.8`. The operator sets the
 * direction: `>=` is at-least, `<=` is at-most. Throws a message that names the fix.
 */
export function aggregateFromFlag(text: string): AggregateCriterion {
  const match = /^([a-z-]+):(>=|<=)(.+)$/.exec(text);
  if (!match) throw new Error(`--aggregate takes name:op threshold, e.g. pass-rate:>=0.8, not "${text}"`);
  const [, name = '', op = '', raw = ''] = match;
  if (!(name in COUNTS)) {
    throw new Error(`unknown aggregate ${name}: use ${Object.keys(COUNTS).join(' or ')}`);
  }
  const threshold = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(threshold)) {
    throw new Error(`the threshold of ${name} must be a number, not "${raw}"`);
  }
  return criterionOf(name, op === '>=' ? 'at-least' : 'at-most', threshold);
}
