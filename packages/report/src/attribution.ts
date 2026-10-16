import { blockStatus, type RunResult, runOutcome } from '@agent-nexus/driftbench-core';
import type { CampaignData } from './data';
import { runPassed, scoredRuns } from './data';
import { type Rate, rate } from './estimate';

/**
 * The second score (codeagent_equivalence_blame.md E5). The machine pass rate stays final. The agent-attributed
 * pass rate counts a run as passed when every failing gating verdict of every block has a diagnosis whose
 * disposition is setup, excluded or credited. A run with a failure no rule attributed (`unassigned`, or no
 * diagnosis) and none of the agent's is shown apart and excluded from the agent-attributed rate.
 * The machine rate counts every run that passed or failed, unassigned runs included. A run with a block not run
 * or blocked and no failure is in neither rate and is counted apart (`unmeasuredRuns`).
 */

/** A diagnosis as the report reads it: the fields of a block's diagnoses that the scores and the fix list use. */
export type ReportDiagnosis = {
  verdictRef?: string;
  inherits?: string;
  disposition?: string;
  rule?: string;
  fault?: readonly string[];
  fixLocation?: string;
  fixTarget?: string;
  fixAction?: string;
  placement?: string;
  confidence?: string;
};

/** One fix of a campaign's fix plan, as the report lists it. */
export type ReportFix = {
  fixLocation: string;
  fixTarget?: string;
  fixAction: string;
  blocks: number;
  agentBlocks: number;
  removeCopies?: readonly string[];
  /** Set on a local fix a core fix replaces. */
  supersededBy?: string;
  confidence?: string;
  ruleText?: string;
};

/** An object a block was scored with, as `BlockResult.resolved` records it. */
export type ReportObject = { kind: string; id: string; hash?: string };

export type AttributionOptions = {
  /** Diagnoses by run id and block index, for runs whose records do not carry them. */
  diagnoses?: Readonly<Record<string, Readonly<Record<number, readonly ReportDiagnosis[]>>>>;
  /** The campaign's fix plan, ranked. */
  fixes?: readonly ReportFix[];
  /** The objects the campaign was scored with, when the run records do not carry them. */
  objects?: readonly ReportObject[];
};

export type BlockOutcome = 'pass' | 'fail' | 'unassigned';

export type AttributionSummary = {
  /** Runs passing their machine checks, over the scored runs. Undefined with no scored run. */
  machine: Rate | undefined;
  /**
   * Assigned passing/total runs. Counts always remain, including zero assigned runs.
   * The estimate and interval are omitted when unassigned runs outnumber assigned failed runs.
   */
  agent: Rate | Pick<Rate, 'k' | 'n'>;
  /** Runs left out of the agent-attributed rate: a failure no rule attributed, and none of the agent's. */
  unassigned: number;
  /**
   * Completed runs with a block not run or blocked and no failure: neither passed nor failed, so they are in
   * neither rate, numerator or denominator, and are counted here so they never vanish.
   */
  unmeasuredRuns: { notRun: number; blocked: number };
  /** Failing blocks by disposition of their root diagnoses, the first that counts against the agent winning. */
  blocks: {
    failing: number;
    agent: number;
    setup: number;
    excluded: number;
    credited: number;
    unassigned: number;
    /** Blocks never sent: no measurement, so neither a failure nor a pass. Counted apart so they never vanish. */
    notRun: number;
    /** Blocks not run because an ancestor they depend on failed. Counted apart, as `notRun` is. */
    blocked: number;
  };
  fixes: ReportFix[];
  /** The objects that are not a shipped default, as `kind:id`: a non-default rule scored these runs. */
  nonDefault: string[];
};

const SET_ASIDE = new Set(['setup', 'excluded', 'credited']);

type Block = RunResult['blocks'][number] & {
  diagnoses?: readonly ReportDiagnosis[];
  resolved?: { objects?: ReportObject[] };
};

/** The diagnoses of one block: its own record, else the ones given. */
export function blockDiagnoses(
  run: RunResult,
  block: RunResult['blocks'][number],
  options: AttributionOptions,
): readonly ReportDiagnosis[] {
  return (block as Block).diagnoses ?? options.diagnoses?.[run.runId]?.[block.index] ?? [];
}

/** How a block counts for the agent: its machine pass stands (a block not run or blocked counts as a pass); a failing block passes when every failure is set aside. */
export function blockOutcome(
  block: RunResult['blocks'][number],
  diagnoses: readonly ReportDiagnosis[],
): BlockOutcome {
  // A block not run or blocked is not a failure of the agent.
  if (blockStatus(block) !== 'fail') return 'pass';
  const failing = block.verdicts.filter((verdict) => verdict.gating && verdict.outcome !== 'pass');
  let unassigned = false;
  for (const verdict of failing) {
    const own = diagnoses.find((one) => one.verdictRef === verdict.id);
    const disposition = own?.disposition;
    if (disposition === 'agent' || disposition === 'shared') return 'fail';
    if (disposition === undefined || !SET_ASIDE.has(disposition)) unassigned = true;
  }
  return unassigned ? 'unassigned' : 'pass';
}

/** The disposition a failing block shows: the agent's when any failure is, else the first set-aside kind. */
function blockDisposition(
  block: RunResult['blocks'][number],
  diagnoses: readonly ReportDiagnosis[],
  outcome: BlockOutcome,
): keyof AttributionSummary['blocks'] {
  if (outcome === 'fail') return 'agent';
  if (outcome === 'unassigned') return 'unassigned';
  const failing = new Set(
    block.verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map((verdict) => verdict.id),
  );
  const roots = diagnoses.filter((one) => one.inherits === undefined && failing.has(one.verdictRef ?? ''));
  const kinds = new Set(roots.map((one) => one.disposition ?? 'unassigned'));
  if (kinds.has('agent') || kinds.has('shared')) return 'agent';
  if (kinds.has('unassigned') || roots.length === 0) return 'unassigned';
  for (const kind of ['setup', 'excluded', 'credited'] as const) if (kinds.has(kind)) return kind;
  return 'unassigned';
}

/** Whether a resolved object is a shipped default: the id `default`. */
function isDefault(object: ReportObject): boolean {
  return object.id === 'default';
}

function showObject(object: ReportObject): string {
  const key = `${object.kind}:${object.id}`;
  return object.hash === undefined ? key : `${key}@${object.hash}`;
}

function objectKey(object: ReportObject): string {
  return JSON.stringify([object.kind, object.id, object.hash ?? null]);
}

/** The non-default objects one run was scored with: its blocks' resolved objects, else the ones given. */
export function nonDefaultOf(run: RunResult, options: AttributionOptions = {}): string[] {
  const objects = new Map<string, ReportObject>();
  for (const object of options.objects ?? []) objects.set(objectKey(object), object);
  for (const block of run.blocks) {
    for (const object of (block as Block).resolved?.objects ?? []) objects.set(objectKey(object), object);
  }
  return [...objects.values()]
    .filter((object) => !isDefault(object))
    .map(showObject)
    .sort();
}

/**
 * The attribution of a campaign, or undefined when no block carries a diagnosis and none was given: the
 * scorecard then shows the machine rate alone, as before.
 */
export function attributionOf(
  data: CampaignData,
  options: AttributionOptions = {},
): AttributionSummary | undefined {
  const completed = data.runs.filter((run) => run.status === 'completed');
  // A rate counts the runs that passed or failed (scoredRuns); the others are counted apart.
  const runs = scoredRuns(completed);
  const scored = new Set<RunResult>(runs);
  const unmeasuredRuns = { notRun: 0, blocked: 0 };
  for (const run of completed) {
    const outcome = runOutcome(run);
    if (outcome === 'not_run') unmeasuredRuns.notRun += 1;
    else if (outcome === 'blocked') unmeasuredRuns.blocked += 1;
  }
  const any = runs.some((run) => run.blocks.some((block) => blockDiagnoses(run, block, options).length > 0));
  if (!any && options.fixes === undefined) return undefined;
  let agentPass = 0;
  let decided = 0;
  let unassigned = 0;
  const blocks = {
    failing: 0,
    agent: 0,
    setup: 0,
    excluded: 0,
    credited: 0,
    unassigned: 0,
    notRun: 0,
    blocked: 0,
  };
  const objects = new Map<string, ReportObject>();
  for (const object of options.objects ?? []) objects.set(objectKey(object), object);
  for (const run of completed) {
    let outcome: BlockOutcome = 'pass';
    for (const block of run.blocks) {
      for (const object of (block as Block).resolved?.objects ?? []) objects.set(objectKey(object), object);
      const diagnoses = blockDiagnoses(run, block, options);
      const own = blockOutcome(block, diagnoses);
      const status = blockStatus(block);
      if (status === 'fail') {
        blocks.failing += 1;
        blocks[blockDisposition(block, diagnoses, own)] += 1;
      } else if (status === 'not_run') blocks.notRun += 1;
      else if (status === 'blocked') blocks.blocked += 1;
      if (own === 'fail') outcome = 'fail';
      else if (own === 'unassigned' && outcome === 'pass') outcome = 'unassigned';
    }
    // A run neither passed nor failed is in no rate; its blocks were counted above.
    if (!scored.has(run)) continue;
    // A run that fails outside its blocks (its end state, its end verdict) has no block diagnosis to read.
    if (
      outcome === 'pass' &&
      (run.blocks.length === 0 ||
        run.endState?.match === false ||
        (run.endVerdict !== undefined && run.endVerdict !== 'success'))
    )
      outcome = 'unassigned';
    if (outcome === 'unassigned') {
      unassigned += 1;
      continue;
    }
    decided += 1;
    if (outcome === 'pass') agentPass += 1;
  }
  return {
    machine: rate(runs.filter(runPassed).length, runs.length),
    agent:
      unassigned > decided - agentPass
        ? { k: agentPass, n: decided }
        : (rate(agentPass, decided) ?? { k: agentPass, n: decided }),
    unassigned,
    unmeasuredRuns,
    blocks,
    fixes: [...(options.fixes ?? [])],
    nonDefault: [...objects.values()]
      .filter((object) => !isDefault(object))
      .map(showObject)
      .sort(),
  };
}

/**
 * What was not measured, named apart from the failures: the runs and the blocks not run or blocked. Empty when
 * everything was measured. The runs are in neither rate.
 */
export function unmeasuredText(b: {
  notRun: number;
  blocked: number;
  runs?: { notRun: number; blocked: number };
}): string {
  const part = (notRun: number, blocked: number) =>
    [notRun > 0 ? `${notRun} not run` : '', blocked > 0 ? `${blocked} blocked` : '']
      .filter(Boolean)
      .join(', ');
  const runs = b.runs ? part(b.runs.notRun, b.runs.blocked) : '';
  const blocks = part(b.notRun, b.blocked);
  if (runs === '' && blocks === '') return '';
  return ` Not measured, so not failures${runs === '' ? '' : `; runs left out of both rates: ${runs}`}${blocks === '' ? '' : `; blocks: ${blocks}`}.`;
}

/** The denominator is explicit beside every agent-attributed score, including counts-only scores. */
export function assignedRunCounts(summary: AttributionSummary): string {
  return `${summary.agent.k} of ${summary.agent.n} assigned runs; ${summary.unassigned} unassigned`;
}
