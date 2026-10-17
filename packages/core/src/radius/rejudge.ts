import type { Check, CheckContext } from '../contracts/check';
import { cellId } from '../runner/cell';
import { driftOf } from '../runner/drift';
import {
  addFacts,
  assistantMessage,
  canonicalGiven,
  enterBlock,
  initialGiven,
  resolveGiven,
  stimulusMessages,
} from '../runner/given';
import { provenanceHash } from '../runner/provenance';
import { applyRealizedTextPolicy } from '../runner/realized-text';
import { succession } from '../runner/succession';
import { isScored } from '../runner/verdicts';
import type { Message } from '../schema/common';
import { type BlockResult, type Campaign, type RunResult, Verdict } from '../schema/run';
import type { Spec } from '../schema/spec';
import { canonicalJson, contentHash } from '../spec/hash';
import { specHash, specIdentity } from '../spec/identity';
import { parseCriterionRef } from '../spec/semantics';
import { type CarryLimits, carryOrigin } from './carry';
import { completeBaselineProvenance } from './provenance';
import { agentVersionOf } from './version';

/**
 * Soundness: hash EVERYTHING that can change what the agent receives or does: givens, stimuli,
 * tools, target, adapter, modes, perturbations, driver, seeds, stages and block order. Exclude only
 * this explicit allow-list of judge-only fields. A new spec field is INCLUDED by default, even
 * inside a criterion, until deliberately classified as judge-only. Never project onto today's schema.
 */
export function observationCompatibilityHash(spec: Spec, execution: { executionHash: string }): string {
  const copy = structuredClone(specIdentity(spec));
  for (const criterion of copy.criteria ?? []) {
    for (const field of [
      'rubric',
      'pass',
      'fail',
      'gating',
      'scope',
      'judge_class',
      'repeat_reducer',
    ] as const) {
      delete (criterion as Partial<typeof criterion>)[field];
    }
  }
  return contentHash({ spec: copy, execution });
}

export type RejudgeOptions = Pick<CarryLimits, 'now' | 'maxCarry' | 'maxAgeDays'> & {
  baselineProvenance?: Campaign['provenance'];
  fromCampaign: string;
  agentVersion: string;
  criteria: readonly string[];
};
export type PreparedRejudge = {
  source: RunResult;
  spec: Spec;
  contexts: CheckContext[];
  stamp: NonNullable<RunResult['rejudged']>;
  carried: NonNullable<RunResult['carried']>;
};
const refuse = (why: string): never => {
  throw new Error(`${why}; rerun the agent in a full campaign.`);
};

/**
 * A child of a parent-linked run was measured with the history, the previous stage and the Given of its
 * ancestors; a re-judge builds its contexts from the block order, which would hand it unrelated trees.
 */
function refuseParentLinked(spec: Spec): void {
  if (spec.blocks.some((block) => block.parent !== undefined)) {
    refuse(
      "A parent-linked run takes each child's history from its ancestors, which a re-judge or re-score does not rebuild",
    );
  }
}

/** Validate every context before the caller makes any judge call or writes any campaign. */
export function prepareRejudge(
  old: Spec,
  spec: Spec,
  run: RunResult,
  options: RejudgeOptions,
): PreparedRejudge {
  refuseParentLinked(spec);
  const provenance = run.provenance;
  if (!provenance || !completeBaselineProvenance({ provenance: options.baselineProvenance, runs: [run] }))
    return refuse('Legacy observation has missing, incomplete or inconsistent execution provenance');
  if (run.status !== 'completed') return refuse('The observation did not complete');
  if (run.specHash !== specHash(old)) return refuse('The pinned old spec hash does not match');
  if (
    !options.agentVersion ||
    agentVersionOf(run) !== options.agentVersion ||
    (run.carried && run.carried.agentVersion !== options.agentVersion)
  )
    return refuse('The agent version changed or is unknown');
  // A custom driver receives the whole spec and could read even rubric text. Only the known scripted
  // driver is proven independent of those fields. Unknown seeds and injected/adaptive paths fail closed.
  if (
    provenance.driver.idHash !== provenanceHash('scripted') ||
    provenance.driver.seedsHash !== provenanceHash({}) ||
    run.mode === 'P' ||
    run.perturbationId ||
    run.blocks.some((b) => b.injected)
  )
    return refuse('The driver or perturbation context cannot be reconstructed');
  if (
    spec.kind === 'task' ||
    spec.blocks.some((b) => b.expect?.artifacts?.length) ||
    run.blocks.some((b) => b.observed.workspaceDiff || (b.provenance?.artifacts.length ?? 0) > 0)
  )
    return refuse('Artifact bytes needed by the judge are not stored');
  const compatibilityHash = observationCompatibilityHash(old, provenance);
  if (compatibilityHash !== observationCompatibilityHash(spec, provenance))
    return refuse('Observation compatibility changed (including deterministic checks or expected outputs)');
  if (!Number.isFinite(Date.parse(run.finishedAt)) || Date.parse(run.finishedAt) > options.now.getTime())
    return refuse('The observation timestamp is invalid or in the future');
  const names = new Set(options.criteria);
  if (!names.size) return refuse('The criterion selection is empty');
  for (const def of spec.criteria ?? []) {
    const before = old.criteria?.find((c) => c.name === def.name);
    if (canonicalJson(before) !== canonicalJson(def) && !names.has(def.name))
      return refuse(`Changed criterion ${def.name} is not selected`);
  }
  // A re-judge freezes the recorded agent execution context and accepts no candidate driver/adapter
  // options. Only judge-only spec fields may differ. Do not invent a "current" agent stamp from the
  // baseline to satisfy the agent-change planner; share just the observation age/count rules.
  const reuse = carryOrigin(run, options.fromCampaign, options);
  if ('reason' in reuse) return refuse(reuse.reason);
  if (run.blocks.length !== old.blocks.length) return refuse('The observation is incomplete');
  let state = initialGiven(spec);
  let history: Message[] = [];
  const contexts: CheckContext[] = [];
  for (let index = 0; index < run.blocks.length; index++) {
    const result = run.blocks[index];
    const block = spec.blocks[index];
    if (
      !result ||
      !block ||
      result.provenance?.specIndex !== index ||
      result.index !== index ||
      result.blockId !== block.id
    )
      return refuse('Block order cannot be reconstructed');
    if (run.mode === 'T') {
      const canonical = canonicalGiven(spec, index);
      state = canonical.state;
      history = canonical.prefix;
    } else {
      state = enterBlock(state, block.given);
      if (block.given?.prefix) history = structuredClone(block.given.prefix);
    }
    const given = resolveGiven(state, history, run.target);
    const facts = addFacts(state.ledger, block.expect?.ledger_add);
    if (given.hash !== result.givenHash || provenanceHash(facts.ledger) !== result.provenance.ledgerHash)
      return refuse(`Block ${index} Given or ledger does not match its stamp`);
    const stimulus = block.when;
    if (provenanceHash(stimulus) !== result.provenance.stimulusHash)
      return refuse('The scripted stimulus does not match its stamp');
    for (const def of spec.criteria ?? []) {
      if (
        names.has(def.name) &&
        def.inputs?.some((path) => given.world.workspace?.files?.[path] === undefined)
      )
        return refuse('A judge input is not present in the stored seed');
    }
    const refs = (block.expect?.criteria ?? []).filter((ref) =>
      names.has(parseCriterionRef(ref)?.name ?? ref),
    );
    contexts.push({
      spec,
      mode: run.mode,
      blockIndex: index,
      block: { ...block, when: stimulus },
      stimulus,
      expect: { ...block.expect, criteria: refs },
      given,
      observed: result.observed,
      history: run.mode === 'T' ? [] : run.blocks.slice(0, index),
      ledger: facts.ledger,
    });
    state = { ...state, ledger: facts.ledger };
    history = [...history, ...stimulusMessages(stimulus), assistantMessage(result.observed)];
  }
  return {
    source: run,
    spec,
    contexts,
    carried: reuse.carried,
    stamp: {
      fromCampaign: options.fromCampaign,
      fromRun: run.runId,
      oldSpecHash: run.specHash,
      newSpecHash: specHash(spec),
      compatibilityHash,
      criteria: [...names],
      judgedAt: options.now.toISOString(),
    },
  };
}

/** No adapter is accepted: only the selected judge runs. Historical agent cost is not billed again. */
export async function rejudgeRun(
  prepared: PreparedRejudge,
  judge: Check,
  spent: () => number,
  recordRealizedText = false,
): Promise<RunResult> {
  const { source, spec, contexts, stamp, carried } = prepared;
  // The sink of every door that prepared this re-judge: the contexts were built from the block order.
  refuseParentLinked(spec);
  const before = spent();
  const blocks: BlockResult[] = [];
  for (const ctx of contexts) {
    const original = source.blocks[ctx.blockIndex];
    if (!original) return refuse('The observation disappeared');
    const selected = (ctx.expect.criteria ?? []).map((ref) => parseCriterionRef(ref)?.name ?? ref);
    // A block not run or blocked holds no observation to judge: it stays as it was, never a pass.
    if (!selected.length || !isScored(original)) {
      const { rejudged: _previousJudge, ...unchanged } = original;
      blocks.push({ ...unchanged, carried });
      continue;
    }
    const blockSpend = spent();
    const judged = (await judge.evaluate(ctx)).map((v) => Verdict.parse(v));
    if (
      judged.some((v) => v.kind !== 'judge' || !selected.includes(v.name)) ||
      selected.some((name) => judged.filter((v) => v.name === name).length !== 1)
    )
      return refuse('The judge returned an incomplete or invalid criterion set');
    const kept = original.verdicts.filter((v) => !(v.kind === 'judge' && selected.includes(v.name)));
    if (judged.some((v) => kept.some((k) => k.id === v.id)))
      return refuse('Judge verdict ids collide with carried checks');
    const verdicts = [...kept, ...judged];
    const { carried: _carried, rejudged: _rejudged, ...rest } = original;
    blocks.push({
      ...rest,
      verdicts,
      pass: verdicts.every((v) => !v.gating || v.outcome === 'pass'),
      drift: driftOf(verdicts),
      rejudged: { ...stamp, criteria: selected, judgeCostUsd: spent() - blockSpend },
    });
  }
  const { carried: _carried, events: _events, ...rest } = source;
  const updated = {
    ...rest,
    specHash: specHash(spec),
    blocks,
    carried,
    rejudged: stamp,
    succession: succession(blocks),
    cost: spent() - before,
    cacheHit: false,
  };
  return applyRealizedTextPolicy({ ...updated, runId: cellId(updated) }, recordRealizedText, {
    fromRun: source.runId,
    fromCampaign: stamp.fromCampaign,
  });
}
