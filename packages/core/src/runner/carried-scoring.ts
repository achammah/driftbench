import type { ArtifactReaderRegistry } from '../contracts/artifacts';
import type { CheckContext, CheckSet } from '../contracts/check';
import { type DiagnosticBudget, runDiagnostics, runRunDiagnostics } from '../diagnostics/run';
import { bindObjectContext, objectContextOfSpec } from '../objects/context';
import { checkSpecObjects } from '../objects/index';
import {
  type ObjectContext,
  resolveBlockObjects,
  shippedObjectContext,
  type UsedObject,
} from '../objects/layers';
import { applyScoringPlan, resolvedRecord, type ScoringPlan, scoringPlan, stamp } from '../objects/scoring';
import type { Message, TargetRef } from '../schema/common';
import type { BlockResult, RunResult } from '../schema/run';
import type { BlockSpec, Spec } from '../schema/spec';
import { driftOf } from './drift';
import {
  addFacts,
  assistantMessage,
  canonicalGiven,
  enterBlock,
  initialGiven,
  resolveGiven,
  stimulusMessages,
} from './given';
import { describeContradiction, ledgerVerdicts } from './ledger';
import { provenanceDigest, provenanceHash } from './provenance';
import { canonicalPreviousStage, flowVerdicts, readStage, stageSignatures } from './stages';
import { succession } from './succession';

export type BlockScoring = { used: UsedObject[]; plan: ScoringPlan };
type ScoredFields = Pick<
  BlockResult,
  | 'verdicts'
  | 'resolved'
  | 'stageObserved'
  | 'ledgerCheck'
  | 'drift'
  | 'pass'
  | 'diagnoses'
  | 'skippedForBudget'
>;
type ScoreState = {
  previous?: string;
  signatures: ReturnType<typeof stageSignatures>;
  users: readonly Message[];
  contradictions: readonly string[];
};

/** Stored artifact metadata contains identities, not the bytes needed by artifact checks. */
export function blockNeedsArtifactReplay(block: BlockSpec | undefined, result: BlockResult): boolean {
  return Boolean(
    block?.expect?.artifacts?.length || result.observed.workspaceDiff || result.provenance?.artifacts.length,
  );
}

/** The same scoring path for fresh observations and carried observations. */
export async function scoreBlockObservation(
  ctx: CheckContext,
  scoring: BlockScoring,
  state: ScoreState,
  diagnosticBudget?: DiagnosticBudget,
): Promise<ScoredFields> {
  const verdicts = await applyScoringPlan(scoring.plan, ctx);
  const reading = readStage(ctx.spec, ctx.observed, {
    mode: ctx.mode,
    history: ctx.history,
    previous: state.previous,
    signatures: state.signatures,
  });
  const { flow: flowBy, ledger: ledgerBy } = scoring.plan.runner;
  const flow = flowBy ? stamp(flowVerdicts(ctx.spec, ctx.expect, reading, state.previous), flowBy) : [];
  const ledger = ledgerVerdicts(ctx.ledger, ctx.observed, state.users);
  const all = [...verdicts, ...flow, ...(ledgerBy ? stamp(ledger.verdicts, ledgerBy) : [])];
  const diagnosed = await runDiagnostics(
    scoring.used.filter((entry) => entry.key === 'diagnostics').map((entry) => entry.object),
    { check: ctx, verdicts: all, objects: scoring.used },
    diagnosticBudget,
  );
  const resolved = resolvedRecord(scoring.used);
  const contradictions = [...state.contradictions, ...ledger.contradictions.map(describeContradiction)];
  return {
    verdicts: all,
    ...(diagnosed.diagnoses.length ? { diagnoses: diagnosed.diagnoses } : {}),
    ...(diagnosed.skippedForBudget ? { skippedForBudget: diagnosed.skippedForBudget } : {}),
    ...(resolved ? { resolved } : {}),
    ...(reading !== undefined ? { stageObserved: reading.stage } : {}),
    ledgerCheck: { ok: contradictions.length === 0, contradictions },
    drift: driftOf(all),
    pass: all.every((verdict) => !verdict.gating || verdict.outcome === 'pass'),
  };
}

/** Observation and measurement metadata remain historical; scoring fields are replaced together. */
function replaceScoring(source: BlockResult, scored: ScoredFields): BlockResult {
  const {
    resolved: _resolved,
    stageObserved: _stage,
    diagnoses: _diagnoses,
    skippedForBudget: _skipped,
    ...measured
  } = source;
  return { ...measured, ...scored };
}

/** A mode T carried block is scored from its canonical Given without opening an adapter session. */
export async function rescoreCarriedBlock(
  result: BlockResult,
  spec: Spec,
  target: TargetRef,
  scoring: BlockScoring,
  endState: unknown,
  artifacts?: ArtifactReaderRegistry,
  diagnosticBudget?: DiagnosticBudget,
): Promise<BlockResult> {
  const block = spec.blocks[result.index];
  if (!block) throw new Error(`cannot re-score carried block ${result.index}: spec block missing`);
  if (blockNeedsArtifactReplay(block, result))
    throw new Error(
      `cannot re-score carried block ${result.index}: artifact bytes required for scoring are not stored; run the block fresh`,
    );
  const canonical = canonicalGiven(spec, result.index);
  const facts = addFacts(canonical.state.ledger, block.expect?.ledger_add);
  const scored = await scoreBlockObservation(
    {
      spec,
      mode: 'T',
      blockIndex: result.index,
      block,
      stimulus: block.when,
      expect: block.expect ?? {},
      given: resolveGiven(canonical.state, canonical.prefix, target),
      observed: result.observed,
      history: [],
      ledger: facts.ledger,
      endState,
      artifacts,
    },
    scoring,
    {
      previous: canonicalPreviousStage(spec, result.index),
      signatures: stageSignatures(spec),
      users: [...canonical.prefix, ...stimulusMessages(block.when)].filter(
        (message) => message.role === 'user',
      ),
      contradictions: facts.contradictions,
    },
    diagnosticBudget,
  );
  return replaceScoring(result, scored);
}

export type CarriedScoringOptions = {
  checks: CheckSet;
  objects?: ObjectContext;
  artifacts?: ArtifactReaderRegistry;
  diagnosticBudget?: DiagnosticBudget;
};

/** Re-score a proven whole-cell carry. No adapter is accepted and historical observation cost is not billed. */
export async function rescoreCarriedRun(
  spec: Spec,
  source: RunResult,
  options: CarriedScoringOptions,
): Promise<RunResult> {
  const refuse = (reason: string): never => {
    throw new Error(`cannot re-score carried run: ${reason}; run the cell fresh`);
  };
  // A child of a parent-linked run was measured with the history, the previous stage and the Given of its ancestors
  // (the run's ancestorResults rule). Rebuilding them from the block order would hand it the blocks of unrelated
  // trees, so such a run is not re-scored: the cell runs fresh.
  if (spec.blocks.some((block) => block.parent !== undefined))
    refuse(
      "a parent-linked run takes each child's history from its ancestors, which a re-score does not rebuild",
    );
  if (source.mode === 'P' || source.blocks.some((block) => block.injected || block.realized))
    refuse('the realized driver stimulus cannot be reconstructed');
  if (source.blocks.some((block) => blockNeedsArtifactReplay(spec.blocks[block.index], block)))
    refuse('artifact bytes required for scoring are not stored');
  const context = options.objects ?? objectContextOfSpec(spec) ?? shippedObjectContext();
  spec = bindObjectContext({ ...spec }, context);
  const errors = checkSpecObjects(spec, context);
  if (errors.length) refuse(errors.map((issue) => `${issue.code}: ${issue.message}`).join('; '));
  const plans = spec.blocks.map((_block, index) => {
    const used = resolveBlockObjects(spec, index, context);
    return {
      used,
      plan: scoringPlan(options.checks, used.find((entry) => entry.key === 'check_set')?.object),
    };
  });
  const spanning = resolveBlockObjects(spec, -1, context);
  const signatures = stageSignatures(spec);
  let state = initialGiven(spec);
  let prefix: Message[] = [];
  const prepared: Array<{
    source: BlockResult;
    ctx: CheckContext;
    scoring: BlockScoring;
    users: Message[];
    contradictions: string[];
  }> = [];
  const measuredTarget =
    source.carried?.agentVersion === undefined
      ? source.target
      : { ...source.target, variant: source.carried.agentVersion };
  // Validate the entire reconstruction before any check (including a judge supplied by the caller) runs.
  for (const [index, result] of source.blocks.entries()) {
    const block = spec.blocks[index];
    const scoring = plans[index];
    if (!block || !scoring || result.index !== index || result.blockId !== block.id)
      return refuse('block order differs');
    if (source.mode === 'T') {
      const canonical = canonicalGiven(spec, index);
      state = canonical.state;
      prefix = canonical.prefix;
    } else {
      state = enterBlock(state, block.given);
      if (block.given?.prefix) prefix = structuredClone(block.given.prefix);
    }
    const given = resolveGiven(state, prefix, measuredTarget);
    const facts = addFacts(state.ledger, block.expect?.ledger_add);
    if (
      given.hash !== result.givenHash ||
      (result.provenance &&
        (result.provenance.specIndex !== index ||
          result.provenance.ledgerHash !== provenanceHash(facts.ledger) ||
          result.provenance.stimulusHash !== provenanceHash(block.when)))
    )
      refuse(`block ${index} inputs differ`);
    const users = [...prefix, ...stimulusMessages(block.when)].filter((message) => message.role === 'user');
    prepared.push({
      source: result,
      scoring,
      users,
      contradictions: facts.contradictions,
      ctx: {
        spec,
        mode: source.mode,
        blockIndex: index,
        block,
        stimulus: block.when,
        expect: block.expect ?? {},
        given,
        observed: result.observed,
        history: [],
        ledger: facts.ledger,
        endState: index === spec.blocks.length - 1 ? source.endStateValue : undefined,
        artifacts: options.artifacts,
      },
    });
    state = { ...state, ledger: facts.ledger };
    prefix = [...prefix, ...stimulusMessages(block.when), assistantMessage(result.observed)];
  }
  const blocks: BlockResult[] = [];
  for (const item of prepared) {
    const history = source.mode === 'T' ? [] : blocks;
    const previous =
      source.mode === 'T' ? canonicalPreviousStage(spec, item.ctx.blockIndex) : blocks.at(-1)?.stageObserved;
    const scored = await scoreBlockObservation(
      { ...item.ctx, history },
      item.scoring,
      {
        previous,
        signatures,
        users: item.users,
        contradictions: item.contradictions,
      },
      options.diagnosticBudget,
    );
    blocks.push(replaceScoring(item.source, scored));
  }
  const { diagnoses: _diagnoses, skippedForBudget: _skippedForBudget, ...measured } = source;
  const result: RunResult = { ...measured, blocks, succession: succession(blocks), cost: 0, latencyMs: 0 };
  const diagnosed = await runRunDiagnostics(
    spanning.filter((entry) => entry.key === 'diagnostics').map((entry) => entry.object),
    result,
    spanning,
    options.diagnosticBudget,
  );
  if (diagnosed.diagnoses.length) result.diagnoses = diagnosed.diagnoses;
  if (diagnosed.skippedForBudget) result.skippedForBudget = diagnosed.skippedForBudget;
  return source.provenance ? { ...result, provenanceDigest: provenanceDigest(result) } : result;
}
