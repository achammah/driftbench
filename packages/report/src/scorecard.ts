import {
  type Blocked,
  blockStatus,
  type CompoundingIndex,
  type Count,
  compoundingIndex,
  type DriftClass,
  type HistoryNormalization,
  isScored,
  type NotRun,
  type RunEvent,
  type RunMode,
  type RunResult,
  runOutcome,
  type Spec,
  stimulusMessages,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { bootstrapCI } from '@agent-nexus/driftbench-stats';
import { type AggregateCriterion, type AggregateResult, evaluateAggregates } from './aggregate';
import { type CompareResult, compareCampaigns } from './compare';
import {
  blocksWithSpec,
  type CampaignData,
  type CarriedSummary,
  carriedSummary,
  deviationOf,
  groupBy,
  lineKey,
  measuredRecovery,
  runPassed,
  showTarget,
  specOfRun,
  stimulusText,
} from './data';
import { clustered, clusterRate, type Estimate, type Rate, rate } from './estimate';
import type { PilotReport } from './pilot';
import {
  type ModeReliability,
  modeReliability,
  optional,
  type RecoverySummary,
  type ReliabilityLine,
  recoveryOf,
  reliability,
  successionOf,
} from './reliability';
import { type CriterionRepeat, criterionRepeats, repeatReducersOf } from './repeats';
import { type Spread, spread } from './spread';

export type ScorecardOptions = {
  /** A baseline campaign: the scorecard then carries the compare diff and reads cells against it. */
  baseline?: CampaignData;
  /** The non-inferiority margin, as a proportion. Default 0.02 (2 points). */
  margin?: number;
  /** Passed to the compare diff: gating criteria on fewer goldens are underpowered. Default MIN_GOLDENS. */
  minGoldens?: number;
  /** Passed to the compare diff: underpowered criteria gate too. */
  strict?: boolean;
  /** A pilot report to render beside the spread view. */
  pilot?: PilotReport;
  /** Dimensions of the generated cell that name a spread cell. */
  by?: readonly string[];
  /** The mode the spread view reads. Default F when the campaign ran it. */
  spreadMode?: RunMode;
  /** Runs shown in the drilldown, failing runs first. Default 200. */
  maxRuns?: number;
  /** Lines with incomplete runs: an interval covering both outcomes (default), or no value (withhold). */
  incompletePolicy?: 'interval' | 'withhold';
  /** Campaign-level criteria, each scored over every run together. Absent when not given. */
  aggregates?: readonly AggregateCriterion[];
};

export type ToolCall = { label: string; input?: unknown; output?: unknown; error?: string };

export type BlockDetail = {
  carried?: NonNullable<RunResult['blocks'][number]['carried']>;
  rejudged?: NonNullable<RunResult['blocks'][number]['rejudged']>;
  index: number;
  /** The spec block this block stands for; absent for a block a driver injected. */
  specBlock?: number;
  injected: boolean;
  stimulus?: string;
  /** Exact authored user text, without presentation labels; used to verify realized hashes. */
  authoredText?: string;
  /**
   * Present when the driver sent other text than the spec wrote: its hash, and the text when the run stored
   * it (`campaign run --record-realized-text`).
   */
  realized?: { hash: string; text?: string };
  expectedStage?: string;
  observedStage?: string;
  pass: boolean;
  /** Set on a block not run or blocked, with why: neither a pass nor a fail. */
  status?: 'not_run' | 'blocked';
  notRun?: NotRun;
  blocked?: Blocked;
  /** The block's own latency, its cost in USD when the adapter reports one, and the retries it took. */
  latencyMs: number;
  costUsd?: number;
  retries: number;
  drift: DriftClass[];
  text: string;
  toolCalls: ToolCall[];
  /** Empty history turns omitted by the model wire, absent on unchanged histories and legacy runs. */
  historyNormalizations?: HistoryNormalization[];
  /** The runtime events the block recorded: a guard that ran and a skill that was loaded, by name. */
  /** The key the block's record was cached under, when the run had a cache. */
  cacheKey?: string;
  /** The recorded timeline events of the block, each with the id a label can anchor to. */
  timelineEvents?: { id: string; label: string }[];
  runtimeEvents?: { kind: 'guard' | 'skill'; name: string; verdict?: string }[];
  verdicts: Verdict[];
};

export type RunDetail = {
  runId: string;
  specId: string;
  title?: string;
  target: string;
  mode: RunMode;
  repeat: number;
  perturbationId?: string;
  deviation?: string;
  status: RunResult['status'];
  error?: string;
  pass: boolean;
  /** Set when no block failed but a block was not run or blocked: the run is neither a pass nor a fail. */
  outcome?: 'not_run' | 'blocked';
  /** When the run started and finished, its total latency and cost, and whether the run replayed the cache. */
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  cost: number;
  cacheHit: boolean;
  /** Set on a run carried from an earlier campaign: where it comes from and its age. Absent on a fresh run. */
  carried?: NonNullable<RunResult['carried']>;
  endState?: RunResult['endState'];
  succession: RunResult['succession'];
  recovery?: RunResult['recovery'];
  blocks: BlockDetail[];
  /** The events the run reported, in order, when it recorded them. */
  events?: RunEvent[];
  /**
   * A run a verdict ended before the spec's last block: the verdict, the block it stopped after, and the spec
   * blocks it skipped. Absent when every block ran.
   */
  stopped?: StoppedRun;
};

export type StoppedRun = {
  verdict: NonNullable<RunResult['endVerdict']>;
  reason?: string;
  /** The index of the last block that ran. */
  after: number;
  skipped: Array<{ index: number; id: string; stimulus?: string }>;
};

/** Where a verdict stopped a run and which spec blocks it skipped, read from the run and its spec. */
function stoppedOf(run: RunResult, spec: Spec | undefined): StoppedRun | undefined {
  if (run.endVerdict === undefined || spec === undefined) return undefined;
  const skipped = spec.blocks.slice(run.blocks.length).map((block, offset) => {
    const index = run.blocks.length + offset;
    const stimulus = stimulusText(spec, index);
    return { index, id: block.id ?? `b${index + 1}`, ...(stimulus === undefined ? {} : { stimulus }) };
  });
  if (skipped.length === 0) return undefined;
  const reason = spec.end?.reason;
  return {
    verdict: run.endVerdict,
    ...(reason === undefined ? {} : { reason }),
    after: run.blocks.length - 1,
    skipped,
  };
}

export type ToolAccuracy = {
  /** Calls matched to an expected call (per label, the smaller of the two counts). */
  matched: number;
  expected: number;
  observed: number;
  precision?: Estimate;
  recall?: Estimate;
  f1?: Estimate;
};

export type Scorecard = {
  campaign: {
    campaignId: string;
    createdAt: string;
    targets: string[];
    modes: RunMode[];
    repeats: Record<RunMode, number>;
    budgetUsd: number;
    specs: number;
    runs: number;
    passing: number;
    failing: number;
    /** Runs with a block not run, or blocked, and no failure: neither passing nor failing. Absent when 0. */
    notRun?: number;
    blocked?: number;
    /** Runs that did not complete: failed or stopped. */
    broken: number;
  };
  modes: ModeReliability[];
  lines: ReliabilityLine[];
  /** Runs whose end state was compared and matched, Wilson. */
  endState?: Rate;
  tools: ToolAccuracy;
  cost: { totalUsd: number; perBlockUsd?: Estimate; latencyMsPerBlock?: Estimate };
  compounding: CompoundingIndex;
  /** Recovery over every perturbed run, then per deviation class. */
  recovery?: RecoverySummary;
  recoveryByClass: Array<{ deviation: string; summary: RecoverySummary }>;
  /** Blocks carrying each drift class, over every run. */
  drift: Partial<Record<DriftClass, number>>;
  spread: Spread;
  /** Criteria with a repeat reducer, reduced over the repeats of each line. Empty when no criterion names one. */
  criterionRepeats: CriterionRepeat[];
  compare?: CompareResult;
  /** Set when the campaign merges fresh runs with runs carried from earlier campaigns. Absent when all are fresh. */
  carried?: CarriedSummary;
  pilot?: PilotReport;
  /** Campaign-level criteria, when the options asked for them. */
  aggregates?: AggregateResult[];
  drilldown: RunDetail[];
  /** Runs left out of the drilldown by maxRuns. */
  omittedRuns: number;
};

/**
 * The share of compared runs whose end state matched. The runs of one golden are repeats, so over several
 * goldens the interval is the one every pass rate over goldens gets (Wilson on the effective runs); one golden
 * keeps the plain Wilson interval.
 */
function endStateRate(compared: readonly RunResult[]): Rate | undefined {
  const matched = compared.filter((run) => run.endState?.match).length;
  const grouped = clusterRate(
    [...groupBy(compared, lineKey).values()].map((group) => ({
      n: group.length,
      k: group.filter((run) => run.endState?.match).length,
    })),
  );
  return grouped ? { ...grouped, k: matched } : rate(matched, compared.length);
}

/** The runs whose outcome is this one, among those that completed; undefined when there is none. */
function countWhenAny(runs: readonly RunResult[], outcome: 'not_run' | 'blocked'): number | undefined {
  const n = runs.filter((run) => run.status === 'completed' && runOutcome(run) === outcome).length;
  return n > 0 ? n : undefined;
}

/** `not_run` or `blocked` for a completed run that is neither a pass nor a fail; undefined otherwise. */
function unscoredOutcome(run: RunResult): 'not_run' | 'blocked' | undefined {
  const outcome = runOutcome(run);
  return run.status === 'completed' && (outcome === 'not_run' || outcome === 'blocked') ? outcome : undefined;
}

/** P4.4: everything the scorecard shows, computed from the stored campaign. Deterministic: bootstraps are seeded. */
export function buildScorecard(data: CampaignData, options: ScorecardOptions = {}): Scorecard {
  const margin = options.margin ?? 0.02;
  const lines = reliability(data, options.incompletePolicy ?? 'interval');
  const runs = data.runs;
  const compared = runs.filter((run) => run.endState !== undefined);
  const endState = endStateRate(compared);
  const perturbed = runs.filter((run) => run.mode === 'P');
  const recovery = recoveryOf(perturbed);
  const byClass = groupBy(
    perturbed.filter((run) => measuredRecovery(run)),
    (run) => deviationOf(specOfRun(data, run), run) ?? 'unknown',
  );
  // A class whose every run left its injected block unsent measured no recovery: it has no row.
  const recoveryByClass = [...byClass.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .flatMap(([deviation, group]) => {
      const summary = recoveryOf(group);
      return summary === undefined ? [] : [{ deviation, summary }];
    });
  const maxRuns = options.maxRuns ?? 200;
  const ordered = [...runs.filter((run) => !runPassed(run)), ...runs.filter(runPassed)];
  const shown = ordered.slice(0, maxRuns);
  const repeats = data.campaign.repeats;
  return {
    campaign: {
      campaignId: data.campaign.campaignId,
      createdAt: data.campaign.createdAt,
      targets: [...new Set(runs.map((run) => showTarget(run.target)))],
      modes: [...data.campaign.modes],
      repeats: { T: repeats.T, F: repeats.F, P: repeats.P },
      budgetUsd: data.campaign.budgetUsd,
      specs: data.campaign.specs.length,
      runs: runs.length,
      passing: runs.filter(runPassed).length,
      failing: runs.filter((run) => run.status === 'completed' && runOutcome(run) === 'fail').length,
      ...optional('notRun', countWhenAny(runs, 'not_run')),
      ...optional('blocked', countWhenAny(runs, 'blocked')),
      broken: runs.filter((run) => run.status !== 'completed').length,
    },
    modes: modeReliability(data, lines),
    lines,
    ...optional('endState', endState),
    tools: toolAccuracy(data),
    cost: costOf(runs),
    compounding: compoundingIndex(runs, {
      interval: (values, clusters) => bootstrapCI(values, { clusters, seed: 1 }),
    }),
    ...optional('recovery', recovery),
    recoveryByClass,
    drift: successionOf(runs).classes,
    criterionRepeats: criterionRepeats(runs, repeatReducersOf(data)),
    spread: spread(data, {
      margin,
      ...optional('mode', options.spreadMode),
      ...optional('by', options.by),
      ...optional('baseline', options.baseline),
    }),
    ...(options.baseline
      ? {
          compare: compareCampaigns(options.baseline, data, {
            margin,
            ...optional('minGoldens', options.minGoldens),
            ...optional('strict', options.strict),
          }),
        }
      : {}),
    ...optional('carried', carriedSummary(runs)),
    ...optional('pilot', options.pilot),
    ...(options.aggregates ? { aggregates: evaluateAggregates(data, options.aggregates) } : {}),
    drilldown: shown.map((run) => runDetailOf(data, run)),
    omittedRuns: runs.length - shown.length,
  };
}

/** The drilldown of one run: its blocks with stimulus, reply, tool calls and verdicts. */
export function runDetailOf(data: CampaignData, run: RunResult): RunDetail {
  const spec = specOfRun(data, run);
  const deviation = deviationOf(spec, run);
  const perturbation = spec?.perturbations?.find((entry) => entry.id === run.perturbationId);
  return {
    runId: run.runId,
    specId: run.specId,
    ...optional('title', spec?.title),
    target: showTarget(run.target),
    mode: run.mode,
    repeat: run.repeat,
    ...optional('perturbationId', run.perturbationId),
    ...optional('deviation', deviation),
    status: run.status,
    ...optional('error', run.error),
    pass: runPassed(run),
    ...optional('outcome', unscoredOutcome(run)),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    latencyMs: run.latencyMs,
    cost: run.cost,
    cacheHit: run.cacheHit,
    ...optional('carried', run.carried),
    ...optional('endState', run.endState),
    succession: run.succession,
    ...optional('recovery', measuredRecovery(run)),
    ...optional('events', run.events),
    ...optional('stopped', stoppedOf(run, spec)),
    blocks: blocksWithSpec(run, spec).map(({ result, specBlock }) => {
      const timelineEvents = timelineEventsOf(run, result.index);
      const injectedText =
        specBlock === undefined && perturbation
          ? `[${perturbation.class}] ${perturbation.user ?? perturbation.burst?.join('\n') ?? '(world change)'}`
          : undefined;
      const stimulus = specBlock === undefined ? injectedText : stimulusText(spec, specBlock);
      const when =
        specBlock === undefined ? undefined : spec?.blocks[result.provenance?.specIndex ?? specBlock]?.when;
      const authoredText =
        specBlock === undefined
          ? (perturbation?.user ?? perturbation?.burst?.join('\n'))
          : when === undefined
            ? undefined
            : stimulusMessages(when)
                .map((message) => message.content)
                .join('\n');
      const expectedStage =
        specBlock === undefined ? perturbation?.expect?.stage : spec?.blocks[specBlock]?.expect?.stage;
      return {
        index: result.index,
        ...optional('carried', result.carried),
        ...optional('rejudged', result.rejudged),
        ...optional('specBlock', specBlock),
        injected: result.injected === true,
        ...optional('stimulus', stimulus),
        ...optional('authoredText', authoredText),
        ...optional('realized', result.realized),
        ...optional('expectedStage', expectedStage),
        ...optional('observedStage', result.stageObserved),
        pass: blockStatus(result) === 'pass',
        ...(isScored(result) ? {} : { status: blockStatus(result) as 'not_run' | 'blocked' }),
        ...optional('notRun', result.notRun),
        ...optional('blocked', result.blocked),
        latencyMs: result.observed.latencyMs,
        ...optional(
          'costUsd',
          result.rejudged?.judgeCostUsd ?? (result.carried ? undefined : result.observed.cost.usd),
        ),
        retries: result.observed.retries?.length ?? 0,
        drift: [...result.drift],
        text: result.observed.text,
        ...optional('historyNormalizations', result.observed.historyNormalizations),
        toolCalls: result.observed.toolCalls.map((call) => ({
          label: call.label,
          ...(call.input === undefined ? {} : { input: call.input }),
          ...(call.output === undefined ? {} : { output: call.output }),
          ...optional('error', call.error),
        })),
        ...(runtimeEventsOf(result.observed.runtime).length > 0
          ? { runtimeEvents: runtimeEventsOf(result.observed.runtime) }
          : {}),
        ...optional('cacheKey', result.cacheKey),
        ...(timelineEvents.length > 0 ? { timelineEvents } : {}),
        verdicts: result.verdicts,
      };
    }),
  };
}

/** The recorded events of a block. An event's id is its position in the run's events, which a label can name. */
function timelineEventsOf(run: RunResult, index: number): { id: string; label: string }[] {
  const events = run.events ?? [];
  return events.flatMap((event, position) => {
    if (!('index' in event) || event.index !== index) return [];
    const label =
      event.type === 'tool_call'
        ? `tool ${event.label}`
        : event.type === 'model_call'
          ? 'model call'
          : event.type === 'block_end'
            ? `block end ${{ pass: 'pass', fail: 'fail', not_run: 'not run', blocked: 'blocked' }[blockStatus(event)]}`
            : event.type;
    // A call that carries its trace span id is anchored by that id, so the span anchor names the real span.
    return [{ id: event.type === 'tool_call' && event.spanId ? event.spanId : `event:${position}`, label }];
  });
}

/** The guards and skills a block's runtime trace recorded, in the order they ran. */
function runtimeEventsOf(
  runtime: RuntimeTraceLike | undefined,
): { kind: 'guard' | 'skill'; name: string; verdict?: string }[] {
  if (!runtime) return [];
  const guards = (runtime.guards ?? []).map((guard) => ({
    kind: 'guard' as const,
    name: guard.name,
    verdict: guard.verdict,
  }));
  const skills = (runtime.skills ?? []).map((skill) => ({ kind: 'skill' as const, name: skill.name }));
  return [...guards, ...skills];
}

type RuntimeTraceLike = {
  guards?: { name: string; verdict: string }[];
  skills?: { name: string }[];
};

/** The expected number of calls for a tool expectation: the count, else its min, else 1. */
function expectedCalls(count: Count | undefined): number {
  if (count === undefined) return 1;
  if (typeof count === 'number') return count;
  if (count.max === 0) return 0;
  return count.min ?? 1;
}

/**
 * Tool precision, recall and F1 over the blocks whose spec lists its expected tools: a call is matched when
 * its label is expected (per label, the smaller of the expected and observed counts). Precision divides by
 * every call of those blocks, recall by every expected call. One run is one cluster of the interval.
 */
export function toolAccuracy(data: CampaignData): ToolAccuracy {
  const perRun: Array<{ matched: number; expected: number; observed: number }> = [];
  for (const run of data.runs) {
    const spec = specOfRun(data, run);
    const sums = { matched: 0, expected: 0, observed: 0 };
    let counted = false;
    for (const { result, specBlock } of blocksWithSpec(run, spec)) {
      // A block not run or blocked made no call because it was never sent: it is no tool measurement.
      if (specBlock === undefined || !isScored(result)) continue;
      const tools = spec?.blocks[specBlock]?.expect?.tools;
      if (!tools) continue;
      counted = true;
      const expected = new Map<string, number>();
      for (const tool of tools)
        expected.set(tool.label, (expected.get(tool.label) ?? 0) + expectedCalls(tool.count));
      const observed = new Map<string, number>();
      for (const call of result.observed.toolCalls)
        observed.set(call.label, (observed.get(call.label) ?? 0) + 1);
      for (const [label, n] of expected) sums.matched += Math.min(n, observed.get(label) ?? 0);
      sums.expected += [...expected.values()].reduce((a, b) => a + b, 0);
      sums.observed += result.observed.toolCalls.length;
    }
    if (counted) perRun.push(sums);
  }
  const total = perRun.reduce(
    (acc, entry) => ({
      matched: acc.matched + entry.matched,
      expected: acc.expected + entry.expected,
      observed: acc.observed + entry.observed,
    }),
    { matched: 0, expected: 0, observed: 0 },
  );
  const indices = perRun.map((_, index) => index);
  const ratio =
    (pick: (sums: { matched: number; expected: number; observed: number }) => number) =>
    (drawn: readonly number[]) => {
      let num = 0;
      let den = 0;
      for (const index of drawn) {
        const entry = perRun[index] as (typeof perRun)[number];
        num += entry.matched;
        den += pick(entry);
      }
      return den === 0 ? 1 : num / den;
    };
  const f1 = (drawn: readonly number[]) => {
    const p = ratio((entry) => entry.observed)(drawn);
    const r = ratio((entry) => entry.expected)(drawn);
    return p + r === 0 ? 0 : (2 * p * r) / (p + r);
  };
  return {
    ...total,
    ...optional(
      'precision',
      total.observed === 0
        ? undefined
        : clustered(indices, indices, { statistic: ratio((entry) => entry.observed) }),
    ),
    ...optional(
      'recall',
      total.expected === 0
        ? undefined
        : clustered(indices, indices, { statistic: ratio((entry) => entry.expected) }),
    ),
    ...optional(
      'f1',
      total.observed === 0 || total.expected === 0
        ? undefined
        : clustered(indices, indices, { statistic: f1 }),
    ),
  };
}

function costOf(runs: readonly RunResult[]): Scorecard['cost'] {
  const usd: number[] = [];
  const usdClusters: number[] = [];
  const latency: number[] = [];
  const latencyClusters: number[] = [];
  runs.forEach((run, index) => {
    if (run.cacheHit) return;
    for (const block of run.blocks) {
      if (run.rejudged) {
        if (block.rejudged?.judgeCostUsd !== undefined) {
          usd.push(block.rejudged.judgeCostUsd);
          usdClusters.push(index);
        }
        continue;
      }
      const observed = block.observed;
      const segmentUsd = observed.segments.flatMap((segment) =>
        segment.cost?.usd === undefined ? [] : [segment.cost.usd],
      );
      const cost =
        observed.cost.usd ?? (segmentUsd.length === 0 ? undefined : segmentUsd.reduce((a, b) => a + b, 0));
      if (cost !== undefined) {
        usd.push(cost);
        usdClusters.push(index);
      }
      latency.push(observed.latencyMs);
      latencyClusters.push(index);
    }
  });
  return {
    totalUsd: runs.filter((run) => !run.cacheHit).reduce((sum, run) => sum + run.cost, 0),
    ...optional('perBlockUsd', clustered(usd, usdClusters)),
    ...optional('latencyMsPerBlock', clustered(latency, latencyClusters)),
  };
}

/** What a page shows for sent text the run kept only as a hash. */
export function notStored(hash: string): string {
  return `(other text than the spec wrote; not stored, only its hash ${hash.slice(0, 12)}. campaign run --record-realized-text stores it)`;
}
