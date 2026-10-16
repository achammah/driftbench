import type { Verdict } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { type H3Run, h3Input, loadH3 } from '../../../core/test/fixtures/evidence/h3';
import { blame, placement } from '../../src';

/**
 * HF8 as a regression of the shipped rule files: on the 182 stored H3 runs, policy/blame:default and
 * policy/placement:default give agent 45, tool definition 28, prompt 3, pass with the test flagged 106, exactly,
 * from the hand-coded evidence and from the evidence the providers compute.
 */

const TARGET = { agent: 45, tool_definition: 28, prompt: 3, pass_test_flagged: 106 };

type Bucket = keyof typeof TARGET | 'unassigned';

/** A block's class from its root diagnoses: the agent's, the tool's, the setup's (the prompt here), or a pass. */
function bucket(
  diagnoses: ReadonlyArray<Pick<blame.BlameDiagnosis, 'disposition' | 'fix_location'>>,
): Bucket {
  if (diagnoses.some((one) => one.disposition === 'agent' || one.disposition === 'shared')) return 'agent';
  if (diagnoses.some((one) => one.fix_location.startsWith('tool.'))) return 'tool_definition';
  if (diagnoses.some((one) => one.disposition === 'setup')) return 'prompt';
  if (diagnoses.length > 0 && diagnoses.every((one) => one.disposition === 'credited'))
    return 'pass_test_flagged';
  return 'unassigned';
}

/** The roots the hand table states for a run, as evidence: the slot value, a skipped step, the town demand. */
function handRoots(run: H3Run): Array<Record<string, unknown>> {
  const { prov, result, next } = run.hand;
  const roots: Array<Record<string, unknown>> = [];
  if (prov !== 'no call') {
    const outcome = result === 'NOT FOUND' ? 'failed' : 'accepted_as_gold';
    const source = prov.startsWith('agent-derived') ? 'agent_derived' : 'user';
    const change = prov === 'verbatim' ? 'verbatim' : prov === 'case only' ? 'case_only' : undefined;
    roots.push({
      source,
      ...(change === undefined ? {} : { change }),
      outcome,
      contract: 'none',
      contract_broken: false,
      verdict_kind: 'machine',
      tool_failed: outcome === 'failed',
      rule_home: 'none',
      ...(next === 'asked user again' ? { next_action: 'asked_user' } : {}),
    });
  }
  const step = {
    rule_home: 'core',
    rule_act: 'step',
    contract: 'prompt',
    contract_broken: true,
    verdict_kind: 'machine',
  };
  if (next === 'asked for town')
    roots.push({ ...step, stricter_rule_obeyed: true, next_action: 'asked_user' });
  else if (next.startsWith('asked user instead of') || next === 'asked to confirm address') roots.push(step);
  return roots;
}

function counts(buckets: Bucket[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const one of buckets) out[one] = (out[one] ?? 0) + 1;
  return out;
}

describe('HF8 on the shipped blame and placement files', () => {
  const policy = blame.shippedPolicy('policy/blame');
  const place = blame.shippedPolicy('policy/placement');

  it('reproduces agent 45, tool definition 28, prompt 3, pass 106 from the hand evidence', () => {
    const h3 = loadH3();
    const buckets = h3.runs.map((run) => {
      const block = h3.blocks[run.block];
      if (!block) throw new Error(run.block);
      const input = h3Input(h3, run, `tools.${block.slot.tool}.count`);
      const diagnoses = handRoots(run).map((facts) => {
        const attribution = blame.attribute(policy, facts);
        const placed = placement.applyPlacement(place, { attribution, input, facts });
        return { disposition: attribution.disposition, fix_location: placed.fix_location };
      });
      return bucket(diagnoses);
    });
    expect(counts(buckets)).toEqual(TARGET);
  });

  it('reproduces the same counts from the evidence the providers compute, chain included', () => {
    const h3 = loadH3();
    const rows = h3.runs.map((run) => {
      const block = h3.blocks[run.block];
      if (!block) throw new Error(run.block);
      const verdicts: Verdict[] = run.failing.map((id) => ({
        id,
        kind: 'machine',
        name: 'tools',
        gating: true,
        outcome: 'fail',
        evidence: id,
      }));
      const { diagnoses } = blame.diagnoseBlock({
        verdicts,
        evidenceFor: (verdict) => h3Input(h3, run, verdict.id),
        tools: block.tools,
        blame: policy,
        placement: place,
      });
      const roots = diagnoses.filter((one) => one.inherits === undefined);
      return { id: run.id, hand: run.hand.class, bucket: bucket(roots), items: roots.map((one) => one.item) };
    });
    expect(counts(rows.map((row) => row.bucket))).toEqual(TARGET);
    const byClass: Record<string, Bucket> = {
      R3: 'tool_definition',
      R5: 'pass_test_flagged',
      R6: 'prompt',
      R7: 'agent',
    };
    const disagree = rows.filter((row) => byClass[row.hand] !== row.bucket);
    expect(disagree).toEqual([]);
  });

  it('never changes a machine pass: the diagnoses carry their own verdict, the run record is untouched', () => {
    const h3 = loadH3();
    const run = h3.runs.find((one) => one.hand.class === 'R5') as H3Run;
    const block = h3.blocks[run.block];
    if (!block) throw new Error(run.block);
    const verdicts: Verdict[] = run.failing.map((id) => ({
      id,
      kind: 'machine',
      name: 'tools',
      gating: true,
      outcome: 'fail',
      evidence: id,
    }));
    const before = JSON.stringify(verdicts);
    const { diagnoses } = blame.diagnoseBlock({
      verdicts,
      evidenceFor: (verdict) => h3Input(h3, run, verdict.id),
      tools: block.tools,
      blame: policy,
      placement: place,
    });
    expect(JSON.stringify(verdicts)).toBe(before);
    expect(diagnoses.every((one) => one.disposition === 'credited')).toBe(true);
    expect(verdicts.every((one) => one.outcome === 'fail')).toBe(true);
  });
});
