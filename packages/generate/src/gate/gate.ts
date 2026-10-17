import {
  type AgentAdapter,
  canonicalJson,
  type Observed,
  type RunResult,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { mulberry32, passK, wilson } from '@agent-nexus/driftbench-stats';
import { streamSeed } from '../seed/random';
import {
  blockNotRun,
  blockOutcome,
  failingIds,
  projectObserved,
  projectRun,
  type RunContext,
  runOnce,
  trivialAdapter,
} from './agents';
import { leakageStage, originGrams } from './leakage';
import {
  auditFamily,
  blockCell,
  deviationOf,
  emptySignature,
  generatedMeta,
  isObservedField,
  machineSignature,
  mapHashOf,
  observedStage,
  stimulusText,
  thenFields,
} from './then';
import {
  type BlockOutcome,
  type Candidate,
  type FaultDef,
  GATE_STAGES,
  type GateOptions,
  type GateReason,
  type GateStage,
  MARKING_STAGES,
  type StageVerdict,
  type ThenField,
  TRIVIAL_AGENTS,
  type TrivialAgent,
} from './types';

export type GateInput = {
  candidates: readonly Candidate[];
  /** The reference target a candidate runs on, as adapter:agent; a key of `references`. */
  targetOf: (spec: Spec) => string;
  references: ReadonlyMap<string, AgentAdapter>;
  faults: readonly { def: FaultDef; adapter: AgentAdapter }[];
  run: RunContext;
  options: GateOptions;
  /** Specs run at the same time. Default 4. */
  concurrency?: number;
  /** One line per spec the gate runs, for progress. */
  onProgress?: (line: string) => void;
};

/** One fault agent on one block. `notRun`: the runner did not send the block to it (no measurement). */
export type FaultRun = { outcome: BlockOutcome; notRun?: true; changed: boolean; failing: string[] };

/** Everything the gate learned about one block. */
export type BlockRecord = {
  key: string;
  spec: string;
  path: string;
  index: number;
  id?: string;
  family: string;
  target: string;
  fields: ThenField[];
  cell: Record<string, string>;
  deviation?: string;
  stages: Record<GateStage, StageVerdict>;
  status: 'accepted' | 'rejected';
  rejectedAt?: GateStage;
  reason?: GateReason;
  /** The reference outcome on each of the k repeats. Empty when the spec did not run. */
  reference: BlockOutcome[];
  trivial: Partial<Record<TrivialAgent, BlockOutcome>>;
  faults: Record<string, FaultRun>;
  /**
   * The agents whose run did not send this block (not_run or blocked), by role: the reference, trivial agents by
   * name, faults by id. They measured nothing, so they are out of the difficulty and the kill counts. Keyed by
   * role, so a fault id never stands for the reference or a trivial agent. Absent when none.
   */
  notRun?: { reference?: true; trivial?: TrivialAgent[]; faults?: string[] };
  /** pass^k on the reference, from the k repeats. */
  passK?: number;
  /** The share of agents (reference, trivial agents, non-equivalent faults) that pass the block. */
  passProbability?: number;
  agents?: number;
  created?: string;
  mapHash?: string;
  split?: 'dev' | 'holdout';
};

export type FaultSummary = {
  id: string;
  kind: FaultDef['kind'];
  class: string;
  target: string;
  affects: readonly ThenField[];
  description: string;
  /** Specs it ran on, and on how many it changed an observed field. */
  ranOn: number;
  changedOn: number;
  /** A fault that changed no observed field anywhere is equivalent: it leaves the score. */
  equivalent: boolean;
  /** Over the gated suite: blocks that target the fault, and how many of them go red on it. */
  suite: KillCount;
  /** Over the candidate pool (blocks past stages 1 and 2, green on the reference). */
  pool: KillCount;
};

export type KillCount = {
  targeting: number;
  /** Targeting blocks the fault's adapter did not run (not_run): out of `targeting` and the rate. Absent when 0. */
  notRun?: number;
  red: number;
  killed: boolean;
  /** The share of targeting blocks that go red, with its Wilson 95% interval; absent with no block. */
  rate?: { estimate: number; low: number; high: number };
};

export type ClassScore = {
  class: string;
  kind: FaultDef['kind'];
  faults: number;
  scored: number;
  killed: number;
  /** Killed over scored faults, with its Wilson 95% interval; absent when no fault is scored. */
  score?: { estimate: number; low: number; high: number };
};

export type FunnelRow = {
  stage: GateStage;
  entered: number;
  rejected: number;
  marked: number;
  passed: number;
  reasons: Partial<Record<GateReason, number>>;
};

export type GateResult = {
  blocks: BlockRecord[];
  funnel: FunnelRow[];
  faults: FaultSummary[];
  classes: ClassScore[];
  /** Specs whose blocks the gate ran, by id. */
  ran: number;
};

const NOT_REACHED: StageVerdict = { status: 'skip', detail: 'an earlier stage rejected the block' };

/** Runs the nine stages over the candidates. Never writes: `gateFiles` turns the result into files. */
export async function runGate(input: GateInput): Promise<GateResult> {
  const { candidates, options } = input;
  const origin = originGrams(options.origin, options.ngram);

  // Stages 1 and 2 read the spec alone.
  const records: BlockRecord[] = [];
  for (const candidate of candidates) {
    const target = input.targetOf(candidate.spec);
    candidate.spec.blocks.forEach((block, index) => {
      const observed = observedStage(candidate.spec, index, options.wording);
      const leakage = leakageStage(candidate.spec, index, options, origin);
      const deviation = deviationOf(candidate.spec, index);
      records.push({
        key: `${candidate.spec.id}#${block.id ?? index}`,
        spec: candidate.spec.id,
        path: candidate.path,
        index,
        ...(block.id === undefined ? {} : { id: block.id }),
        family: auditFamily(candidate.spec),
        target,
        fields: thenFields(candidate.spec, index),
        cell: blockCell(candidate.spec, index),
        ...(deviation === undefined ? {} : { deviation }),
        stages: Object.fromEntries(GATE_STAGES.map((stage) => [stage, NOT_REACHED])) as Record<
          GateStage,
          StageVerdict
        >,
        status: 'accepted',
        reference: [],
        trivial: {},
        faults: {},
      });
      const record = records.at(-1) as BlockRecord;
      record.stages.observed = observed;
      record.stages.leakage = leakage;
    });
  }

  // Stages 3 to 7 need runs: every spec with a block past the static stages runs on the reference k times,
  // on the three trivial agents, and on every fault of its target.
  const bySpec = groupBy(records, (record) => record.spec);
  const runnable = candidates.filter((candidate) =>
    (bySpec.get(candidate.spec.id) ?? []).some(
      (record) => record.stages.observed.status === 'pass' && record.stages.leakage.status === 'pass',
    ),
  );
  const runs = new Map<string, SpecRuns>();
  await pool(runnable, input.concurrency ?? 4, async (candidate) => {
    runs.set(candidate.spec.id, await runCandidate(candidate, input));
    input.onProgress?.(`ran ${candidate.spec.id}`);
  });

  const faultChanged = new Map<string, number>();
  const faultRan = new Map<string, number>();
  for (const specRuns of runs.values()) {
    for (const [id, run] of specRuns.faults) {
      faultRan.set(id, (faultRan.get(id) ?? 0) + 1);
      if (run.changed) faultChanged.set(id, (faultChanged.get(id) ?? 0) + 1);
    }
  }
  const equivalent = new Set(
    input.faults.map((fault) => fault.def.id).filter((id) => (faultChanged.get(id) ?? 0) === 0),
  );

  const twins = twinIndex(candidates);
  const siblings = siblingIndex(candidates);
  const signatures = new Map<string, string>();
  for (const candidate of candidates) {
    candidate.spec.blocks.forEach((block, index) => {
      signatures.set(`${candidate.spec.id}#${block.id ?? index}`, machineSignature(candidate.spec, index));
    });
  }
  const specOf = new Map(candidates.map((candidate) => [candidate.spec.id, candidate.spec]));

  for (const record of records) {
    const specRuns = runs.get(record.spec);
    if (!specRuns) continue;
    const spec = specOf.get(record.spec) as Spec;
    record.reference = specRuns.reference.map((run) => blockOutcome(run, record.index));
    const notRun: NonNullable<BlockRecord['notRun']> = {};
    if (specRuns.reference.some((run) => blockNotRun(run, record.index))) notRun.reference = true;
    for (const name of TRIVIAL_AGENTS) {
      const run = specRuns.trivial.get(name);
      if (run) record.trivial[name] = blockOutcome(run, record.index);
      if (run && blockNotRun(run, record.index)) notRun.trivial = [...(notRun.trivial ?? []), name];
    }
    for (const [id, run] of specRuns.faults)
      if (blockNotRun(run.result, record.index)) notRun.faults = [...(notRun.faults ?? []), id];
    if (Object.keys(notRun).length > 0) record.notRun = notRun;
    for (const [id, run] of specRuns.faults) {
      record.faults[id] = {
        outcome: blockOutcome(run.result, record.index),
        ...(blockNotRun(run.result, record.index) ? { notRun: true } : {}),
        changed: run.changed,
        failing: failingIds(run.result, record.index),
      };
    }
    if (record.stages.observed.status !== 'pass' || record.stages.leakage.status !== 'pass') continue;

    record.stages.shortcut = shortcutStage(record);
    record.stages.contrast = contrastStage(record, spec, { twins, siblings, signatures, runs, specOf });
    record.stages.red_first = redFirstStage(record, specRuns, input.faults, equivalent);
    record.stages.stability = stabilityStage(record, options.k);
    record.passK = passK(
      record.reference.filter((outcome) => outcome === 'pass').length,
      record.reference.length,
      record.reference.length,
    );
    const difficulty = difficultyStage(record, input.faults, equivalent);
    record.stages.difficulty = difficulty.verdict;
    record.passProbability = difficulty.probability;
    record.agents = difficulty.agents;
  }

  for (const record of records) {
    const first = GATE_STAGES.find(
      (stage) => !MARKING_STAGES.has(stage) && record.stages[stage].status === 'reject',
    );
    if (first) {
      record.status = 'rejected';
      record.rejectedAt = first;
      const reason = record.stages[first].reason;
      if (reason) record.reason = reason;
    } else if (record.stages.difficulty.status === 'skip') {
      // A block can only be accepted past the run stages.
      record.status = 'rejected';
    }
  }

  labelAudit(records, options);
  freshness(records, candidates, options);

  const faults = summarise(records, input.faults, equivalent, faultRan, faultChanged);
  return { blocks: records, funnel: funnelOf(records), faults, classes: classScores(faults), ran: runs.size };
}

type SpecRuns = {
  reference: RunResult[];
  trivial: Map<TrivialAgent, RunResult>;
  faults: Map<string, { result: RunResult; changed: boolean }>;
};

async function runCandidate(candidate: Candidate, input: GateInput): Promise<SpecRuns> {
  const { spec } = candidate;
  const target = input.targetOf(spec);
  const reference = input.references.get(target);
  if (!reference) throw new Error(`no reference adapter for ${target}, the target of ${spec.id}`);
  const referenceRuns: RunResult[] = [];
  for (let repeat = 1; repeat <= input.options.k; repeat++) {
    referenceRuns.push(await runOnce(spec, reference, repeat, input.run));
  }
  const trivial = new Map<TrivialAgent, RunResult>();
  for (const name of TRIVIAL_AGENTS)
    trivial.set(name, await runOnce(spec, trivialAdapter(name, spec), 1, input.run));
  const base = projectRun(referenceRuns[0] as RunResult);
  const faults = new Map<string, { result: RunResult; changed: boolean }>();
  for (const fault of input.faults) {
    if (fault.def.target !== target) continue;
    const result = await runOnce(spec, fault.adapter, 1, input.run);
    const projected = projectRun(result);
    const changed = projected.length !== base.length || projected.some((part, index) => part !== base[index]);
    faults.set(fault.def.id, { result, changed });
  }
  return { reference: referenceRuns, trivial, faults };
}

function shortcutStage(record: BlockRecord): StageVerdict {
  for (const name of TRIVIAL_AGENTS) {
    if (record.trivial[name] === 'pass') {
      return {
        status: 'reject',
        reason: `passed-by-${name}` as GateReason,
        detail: `the ${name} agent passes the block`,
      };
    }
  }
  const seen = TRIVIAL_AGENTS.map((name) => `${name} ${record.trivial[name] ?? 'not run'}`);
  return { status: 'pass', detail: seen.join(', ') };
}

type ContrastContext = {
  twins: Map<string, string[]>;
  siblings: Map<string, string[]>;
  signatures: Map<string, string>;
  runs: Map<string, SpecRuns>;
  specOf: Map<string, Spec>;
};

/**
 * Stage 4. A one-slot sibling (same seeder, same slot dimensions, exactly one value changed, another When)
 * must expect something else when the reference outcome changes. Equal reference outcomes can justify
 * equal Thens (for example, two invalid values both refuse). A twin (same
 * metamorphic family) must expect the same and come out the same on the reference.
 */
function contrastStage(record: BlockRecord, spec: Spec, ctx: ContrastContext): StageVerdict {
  const own = ctx.signatures.get(record.key) ?? '';
  const twinKeys = ctx.twins.get(record.key) ?? [];
  for (const twin of twinKeys) {
    const theirs = ctx.signatures.get(twin);
    if (theirs !== undefined && theirs !== own) {
      return {
        status: 'reject',
        reason: 'twins-disagree',
        detail: `its twin ${twin} expects something else`,
      };
    }
    const [twinSpec, twinBlock] = splitKey(twin);
    const twinRuns = ctx.runs.get(twinSpec);
    const twinIndex = blockIndex(ctx.specOf.get(twinSpec), twinBlock);
    const twinFirst = twinRuns?.reference[0];
    if (twinFirst && twinIndex !== undefined) {
      const theirOutcome = blockOutcome(twinFirst, twinIndex);
      const ownOutcome = record.reference[0];
      if (ownOutcome !== undefined && theirOutcome !== ownOutcome) {
        return {
          status: 'reject',
          reason: 'twins-disagree',
          detail: `on the reference it is ${ownOutcome} and its twin ${twin} is ${theirOutcome}`,
        };
      }
    }
  }
  const twins = new Set(twinKeys);
  const ownWhen = stimulusText(spec.blocks[record.index]?.when ?? { user: '' });
  const siblings = (ctx.siblings.get(record.key) ?? []).filter((key) => !twins.has(key));
  for (const sibling of siblings) {
    const [siblingSpec, siblingBlock] = splitKey(sibling);
    const other = ctx.specOf.get(siblingSpec);
    const index = blockIndex(other, siblingBlock);
    const when = index === undefined ? undefined : other?.blocks[index]?.when;
    if (!when || stimulusText(when) === ownWhen) continue;
    if (!emptySignature(own) && ctx.signatures.get(sibling) === own) {
      const ownRuns = ctx.runs.get(spec.id)?.reference ?? [];
      const otherRuns = ctx.runs.get(siblingSpec)?.reference ?? [];
      // The reference, not the generated label, establishes equivalence. Every repeat must pass
      // and show the same observed result. Equal pass/fail verdicts alone cannot justify a copied Then.
      const outcomes = [
        ...ownRuns.map((run) => ({ run, index: record.index })),
        ...otherRuns.map((run) => ({ run, index: index as number })),
      ];
      if (ownRuns.length > 0 && otherRuns.length > 0 && sameReferenceOutcome(outcomes, record.fields))
        continue;
      const changed = Object.entries(record.cell)
        .filter(([slot, value]) => blockCell(other as Spec, index as number)[slot] !== value)
        .map(([slot, value]) => `${slot} ${value}`);
      return {
        status: 'reject',
        reason: 'then-ignores-edit',
        detail: `${sibling} changes only ${changed.join(', ')} in the When and expects the same`,
      };
    }
  }
  const checked = [
    ...(twinKeys.length > 0 ? [`${twinKeys.length} twin${twinKeys.length === 1 ? '' : 's'} agree`] : []),
    ...(siblings.length > 0
      ? [`${siblings.length} one-slot sibling${siblings.length === 1 ? '' : 's'} checked`]
      : []),
  ];
  return {
    status: 'pass',
    detail: checked.length > 0 ? checked.join('; ') : 'no one-slot sibling or twin to compare',
  };
}

/**
 * True when every reference run passes the block and they all show the same observed result on what the
 * Then reads. A Then on the end state compares the end state each run recorded (`endStateValue`); a run
 * that recorded none, such as one stored before the field existed, keeps the conservative answer: false.
 */
export function sameReferenceOutcome(
  outcomes: ReadonlyArray<{ run: RunResult; index: number }>,
  fields: readonly ThenField[],
): boolean {
  const readsEnd = fields.includes('end_state');
  const endsRecorded = outcomes.every(({ run }) => run.endStateValue !== undefined);
  if (!fields.every((field) => CONTRAST_FIELDS.has(field) || (field === 'end_state' && endsRecorded)))
    return false;
  const projections = outcomes.map(({ run, index }) => {
    const block = run.blocks.find((entry) => entry.index === index);
    if (!block || run.status !== 'completed' || blockOutcome(run, index) !== 'pass') return undefined;
    const end = readsEnd ? `|${canonicalJson(run.endStateValue)}` : '';
    return `${contrastProjection(block.observed, fields)}${end}`;
  });
  return projections[0] !== undefined && projections.every((projection) => projection === projections[0]);
}

// These fields have complete reference evidence in the captured block. Final stores, artifact
// bytes and custom raw state can be read out of band, so they cannot use this equivalence shortcut.
const CONTRAST_FIELDS: ReadonlySet<ThenField> = new Set([
  'tools',
  'stage',
  'skills',
  'guards',
  'text',
  'lang',
  'format',
]);

/** Behavioural contrast ignores reply phrasing when the Then also asserts observed state.
 * Refusals can quote different invalid values while correctly making no call and staying put.
 * Keep message boundaries, tools and their arguments, runtime, artifacts and workspace changes;
 * a wording-only Then still compares the complete reply. A workspace diff that lists no file is no
 * workspace change: a run whose world supplies files and a run without a workspace changed nothing alike. */
function contrastProjection(observed: Observed, fields: readonly ThenField[]): string {
  const diff = observed.workspaceDiff;
  const unchanged =
    diff !== undefined && diff.created.length + diff.changed.length + diff.deleted.length === 0;
  const { workspaceDiff: _empty, ...withoutDiff } = observed;
  const compared: Observed = unchanged ? withoutDiff : observed;
  if (!fields.some(isObservedField)) return projectObserved(compared);
  return projectObserved({
    ...compared,
    text: '',
    segments: compared.segments.map((segment) =>
      segment.type === 'text' ? { ...segment, text: '' } : segment,
    ),
  });
}

function redFirstStage(
  record: BlockRecord,
  specRuns: SpecRuns,
  faults: GateInput['faults'],
  equivalent: ReadonlySet<string>,
): StageVerdict {
  const reference = record.reference[0];
  if (reference !== 'pass') {
    const failing = specRuns.reference[0] ? failingIds(specRuns.reference[0], record.index) : [];
    return {
      status: 'reject',
      reason: 'not-green-on-reference',
      detail:
        reference === 'fail'
          ? `the reference fails it: ${failing.join(', ')}`
          : 'no gating machine verdict decided it on the reference',
    };
  }
  const applicable = faults.filter((fault) => fault.def.target === record.target);
  const redControls = applicable.filter(
    (fault) => fault.def.kind === 'control' && record.faults[fault.def.id]?.outcome === 'fail',
  );
  if (redControls.length > 0) {
    return {
      status: 'reject',
      reason: 'red-on-control',
      detail: `the negative control ${redControls.map((fault) => fault.def.id).join(', ')} turns it red`,
    };
  }
  const targeted = applicable.filter((fault) => targets(record, fault.def, equivalent));
  if (targeted.length === 0) {
    return {
      status: 'reject',
      reason: 'targets-no-fault',
      detail: `no planted fault that reads ${record.fields.join(', ') || 'nothing'} changes this spec`,
    };
  }
  const red = targeted.filter((fault) => record.faults[fault.def.id]?.outcome === 'fail');
  if (red.length === 0) {
    return {
      status: 'reject',
      reason: 'kills-no-fault',
      detail: `green on every fault it targets: ${targeted.map((fault) => fault.def.id).join(', ')}`,
    };
  }
  return { status: 'pass', detail: `red on ${red.map((fault) => fault.def.id).join(', ')}` };
}

/**
 * A block targets a fault on its target when the fault is not a control, changed an observed field in the
 * block's spec, and either reads a field the fault changes or carries the deviation class it plants.
 */
export function targets(record: BlockRecord, fault: FaultDef, equivalent: ReadonlySet<string>): boolean {
  if (fault.kind === 'control' || fault.target !== record.target || equivalent.has(fault.id)) return false;
  if (record.faults[fault.id]?.changed !== true) return false;
  return record.fields.some((field) => fault.affects.includes(field)) || record.deviation === fault.class;
}

function stabilityStage(record: BlockRecord, k: number): StageVerdict {
  const outcomes = record.reference;
  const passes = outcomes.filter((outcome) => outcome === 'pass').length;
  if (new Set(outcomes).size > 1) {
    return {
      status: 'reject',
      reason: 'flips',
      detail: `${passes} of ${outcomes.length} repeats pass: ${outcomes.join(', ')}; sent to review`,
    };
  }
  return { status: 'pass', detail: `${passes} of ${k} repeats pass` };
}

function difficultyStage(
  record: BlockRecord,
  faults: GateInput['faults'],
  equivalent: ReadonlySet<string>,
): { verdict: StageVerdict; probability: number; agents: number } {
  // An agent whose run did not send the block (not_run or blocked) measured nothing: it is out of the difficulty
  // and named in the detail. A block that ran and has no verdict stays `unjudged` and counts, as before.
  const skipped = record.notRun ?? {};
  const excluded: string[] = [];
  const outcomes: BlockOutcome[] = [];
  const add = (unsent: boolean, shown: string, outcome: BlockOutcome | undefined) => {
    if (outcome === undefined) return;
    if (unsent) excluded.push(shown);
    else outcomes.push(outcome);
  };
  add(skipped.reference === true, 'the reference', record.reference[0]);
  for (const name of TRIVIAL_AGENTS)
    add(skipped.trivial?.includes(name) ?? false, `trivial ${name}`, record.trivial[name]);
  for (const fault of faults) {
    if (fault.def.kind === 'control' || fault.def.target !== record.target || equivalent.has(fault.def.id))
      continue;
    add(
      record.faults[fault.def.id]?.notRun === true,
      `fault ${fault.def.id}`,
      record.faults[fault.def.id]?.outcome,
    );
  }
  const measured = outcomes;
  const passes = measured.filter((outcome) => outcome === 'pass').length;
  const probability = measured.length === 0 ? 0 : passes / measured.length;
  const detail = `${passes} of ${measured.length} agents pass it${excluded.length > 0 ? ` (not run: ${excluded.join(', ')})` : ''}`;
  if (passes === 0 || passes === measured.length) {
    return {
      verdict: {
        status: 'mark',
        reason: 'saturated',
        detail: `${detail}: ${passes === 0 ? 'every' : 'no'} agent fails it`,
      },
      probability,
      agents: measured.length,
    };
  }
  return { verdict: { status: 'pass', detail }, probability, agents: measured.length };
}

/** Stage 8: a seeded sample of each family's accepted blocks goes to a person. */
function labelAudit(records: BlockRecord[], options: GateOptions): void {
  const accepted = records.filter((record) => record.status === 'accepted');
  const families = groupBy(accepted, (record) => record.family);
  for (const [family, members] of [...families.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const random = mulberry32(streamSeed(options.seed, `label-audit:${family}`));
    const order = members
      .map((record) => ({ record, draw: random() }))
      .sort((a, b) => a.draw - b.draw || a.record.key.localeCompare(b.record.key));
    const chosen = new Set(order.slice(0, options.auditPerFamily).map((entry) => entry.record.key));
    for (const record of members) {
      record.stages.label_audit = chosen.has(record.key)
        ? {
            status: 'mark',
            reason: 'sampled',
            detail: `one of ${chosen.size} of ${members.length} ${family} blocks sampled for a person`,
          }
        : { status: 'pass', detail: `not in the ${family} sample` };
    }
  }
}

/** Stage 9: a creation date and a map hash per accepted block; whole specs are split into dev and holdout. */
function freshness(records: BlockRecord[], candidates: readonly Candidate[], options: GateOptions): void {
  const specs = new Map(candidates.map((candidate) => [candidate.spec.id, candidate.spec]));
  const accepted = records.filter((record) => record.status === 'accepted');
  const holdout = new Set<string>();
  for (const id of new Set(accepted.map((record) => record.spec))) {
    const draw = mulberry32(streamSeed(options.seed, `holdout:${id}`))();
    if (draw < options.holdoutShare) holdout.add(id);
  }
  for (const record of accepted) {
    const spec = specs.get(record.spec);
    const mapHash = spec ? mapHashOf(spec) : undefined;
    record.created = options.date;
    if (mapHash !== undefined) record.mapHash = mapHash;
    record.split = holdout.has(record.spec) ? 'holdout' : 'dev';
    const stamp = `created ${options.date}, map ${mapHash ?? 'none'}`;
    record.stages.freshness =
      record.split === 'holdout'
        ? {
            status: 'mark',
            reason: 'sealed-holdout',
            detail: `${stamp}; sealed in the holdout, never run here`,
          }
        : { status: 'pass', detail: `${stamp}; dev split` };
  }
}

function funnelOf(records: readonly BlockRecord[]): FunnelRow[] {
  const rows: FunnelRow[] = [];
  let entering = records.filter(() => true);
  for (const stage of GATE_STAGES) {
    const rejected = entering.filter((record) => record.rejectedAt === stage);
    const marked = entering.filter((record) => record.stages[stage].status === 'mark');
    const reasons: Partial<Record<GateReason, number>> = {};
    for (const record of [...rejected, ...marked]) {
      const reason = record.stages[stage].reason;
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    // Stage 7 is the last run stage: a block it reaches without a verdict never ran (an empty spec run).
    const stopped =
      stage === 'difficulty'
        ? entering.filter((record) => record.status === 'rejected' && record.rejectedAt === undefined)
        : [];
    rows.push({
      stage,
      entered: entering.length,
      rejected: rejected.length + stopped.length,
      marked: marked.length,
      passed: entering.length - rejected.length - stopped.length,
      reasons,
    });
    const out = new Set([...rejected, ...stopped]);
    entering = entering.filter((record) => !out.has(record));
  }
  return rows;
}

function summarise(
  records: readonly BlockRecord[],
  faults: GateInput['faults'],
  equivalent: ReadonlySet<string>,
  ran: ReadonlyMap<string, number>,
  changed: ReadonlyMap<string, number>,
): FaultSummary[] {
  const accepted = records.filter((record) => record.status === 'accepted');
  const pool = records.filter(
    (record) =>
      record.stages.observed.status === 'pass' &&
      record.stages.leakage.status === 'pass' &&
      record.reference[0] === 'pass',
  );
  return faults.map(({ def }) => ({
    id: def.id,
    kind: def.kind,
    class: def.class,
    target: def.target,
    affects: def.affects,
    description: def.description,
    ranOn: ran.get(def.id) ?? 0,
    changedOn: changed.get(def.id) ?? 0,
    equivalent: equivalent.has(def.id),
    suite: killCount(accepted, def, equivalent),
    pool: killCount(pool, def, equivalent),
  }));
}

function killCount(
  blocks: readonly BlockRecord[],
  fault: FaultDef,
  equivalent: ReadonlySet<string>,
): KillCount {
  // A control is counted on every block of its target: each red one is a control the gate failed to keep green.
  const all = blocks.filter((record) =>
    fault.kind === 'control'
      ? record.target === fault.target && record.faults[fault.id] !== undefined
      : targets(record, fault, equivalent),
  );
  // A block the fault's adapter did not run measured nothing: it is out of the targeting count and the rate.
  const targeting = all.filter((record) => record.faults[fault.id]?.notRun !== true);
  const notRun = all.length - targeting.length;
  const red = targeting.filter((record) => record.faults[fault.id]?.outcome === 'fail').length;
  return {
    targeting: targeting.length,
    ...(notRun > 0 ? { notRun } : {}),
    red,
    killed: red > 0,
    ...(targeting.length > 0 ? { rate: interval(red, targeting.length) } : {}),
  };
}

/** Per class: faults killed by the gated suite over the faults that count (not equivalent, not controls). */
export function classScores(faults: readonly FaultSummary[]): ClassScore[] {
  const byClass = groupBy(faults, (fault) => fault.class);
  return [...byClass.entries()].map(([name, members]) => {
    // A fault whose every targeting block was not run measured nothing: it is not scored.
    const scored = members.filter(
      (fault) =>
        !fault.equivalent &&
        fault.kind !== 'control' &&
        !(fault.suite.targeting === 0 && (fault.suite.notRun ?? 0) > 0),
    );
    const killed = scored.filter((fault) => fault.suite.killed).length;
    return {
      class: name,
      kind: members[0]?.kind ?? 'drift',
      faults: members.length,
      scored: scored.length,
      killed,
      ...(scored.length > 0 ? { score: interval(killed, scored.length) } : {}),
    };
  });
}

function interval(k: number, n: number): { estimate: number; low: number; high: number } {
  const bounds = wilson(k, n);
  return { estimate: k / n, low: bounds.lower, high: bounds.upper };
}

/** Twins: blocks at the same position of the specs of one metamorphic family. */
function twinIndex(candidates: readonly Candidate[]): Map<string, string[]> {
  const families = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const metamorphic = generatedMeta(candidate.spec)?.metamorphic as { family?: unknown } | undefined;
    if (typeof metamorphic?.family !== 'string') continue;
    families.set(metamorphic.family, [...(families.get(metamorphic.family) ?? []), candidate]);
  }
  const index = new Map<string, string[]>();
  for (const members of families.values()) {
    for (const candidate of members) {
      candidate.spec.blocks.forEach((block, position) => {
        const key = `${candidate.spec.id}#${block.id ?? position}`;
        const others = members
          .filter((other) => other !== candidate)
          .flatMap((other) => {
            const twin = other.spec.blocks[position];
            return twin ? [`${other.spec.id}#${twin.id ?? position}`] : [];
          });
        index.set(key, others);
      });
    }
  }
  return index;
}

/** One-slot siblings: blocks of one seeder over the same slot dimensions, with exactly one value changed. */
function siblingIndex(candidates: readonly Candidate[]): Map<string, string[]> {
  type Entry = { key: string; family: string; cell: Record<string, string> };
  const entries: Entry[] = [];
  for (const candidate of candidates) {
    candidate.spec.blocks.forEach((block, index) => {
      const cell = blockCell(candidate.spec, index);
      if (Object.keys(cell).length === 0) return;
      entries.push({
        key: `${candidate.spec.id}#${block.id ?? index}`,
        family: auditFamily(candidate.spec),
        cell,
      });
    });
  }
  const groups = groupBy(entries, (entry) => `${entry.family}|${Object.keys(entry.cell).sort().join(',')}`);
  const index = new Map<string, string[]>();
  for (const members of groups.values()) {
    for (const entry of members) {
      const slots = Object.keys(entry.cell);
      index.set(
        entry.key,
        members
          .filter((other) => other !== entry)
          .filter((other) => slots.filter((slot) => other.cell[slot] !== entry.cell[slot]).length === 1)
          .map((other) => other.key),
      );
    }
  }
  return index;
}

function splitKey(key: string): [string, string] {
  const at = key.lastIndexOf('#');
  return [key.slice(0, at), key.slice(at + 1)];
}

function blockIndex(spec: Spec | undefined, block: string): number | undefined {
  if (!spec) return undefined;
  const found = spec.blocks.findIndex((entry, index) => (entry.id ?? String(index)) === block);
  return found < 0 ? undefined : found;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name);
    if (group) group.push(item);
    else groups.set(name, [item]);
  }
  return groups;
}

async function pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await work(item);
    }
  });
  await Promise.all(workers);
}
