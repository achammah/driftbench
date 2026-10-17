import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evidence } from '../../src';
import { H3_PATH, H3_SHA256, type H3Run, h3Input, loadH3, slotVerdict } from '../fixtures/evidence/h3';

/**
 * HF8 as a regression: the evidence providers, run on the 182 stored H3 runs, give the evidence the hand table
 * states (fw-value: 182 of 182 with the research code). The bar of the build plan is 90%.
 */

type Expected = Record<string, unknown>;

/** What the hand table states about a run, in evidence names. Only the columns it fills are compared. */
function handEvidence(run: H3Run): { slot: Expected; step: boolean } {
  const { prov, result, next } = run.hand;
  const slot: Expected = {};
  if (prov === 'verbatim') Object.assign(slot, { source: 'user', change: 'verbatim' });
  else if (prov === 'case only') Object.assign(slot, { source: 'user', change: 'case_only' });
  else if (prov.startsWith('agent-derived'))
    Object.assign(slot, { source: 'agent_derived', change: undefined });
  else Object.assign(slot, { source: undefined, outcome: undefined });
  if (prov !== 'no call') slot.outcome = result === 'NOT FOUND' ? 'failed' : 'accepted_as_gold';
  if (next === 'asked user again') slot.next_action = 'asked_user';
  slot.stricter_rule_obeyed = next === 'asked for town';
  const step = next.startsWith('asked user instead of') || next === 'asked to confirm address';
  return { slot, step };
}

/** Whether the run's evidence agrees with the hand table on every name the table states. */
function agrees(h3: ReturnType<typeof loadH3>, run: H3Run): { ok: boolean; diff: string[] } {
  const block = h3.blocks[run.block];
  if (!block) throw new Error(`no block ${run.block}`);
  const want = handEvidence(run);
  const got = evidence.computeEvidence(h3Input(h3, run, slotVerdict(block)));
  const diff: string[] = [];
  for (const [name, value] of Object.entries(want.slot)) {
    if (got[name] !== value) diff.push(`${name}: hand ${String(value)}, computed ${String(got[name])}`);
  }
  if (want.step) {
    const slotTool = `tools.${block.slot.tool}.`;
    const stepBroken = run.failing.some((id) => {
      if (id.startsWith(`${slotTool}input.`)) return false;
      const ev = evidence.computeEvidence(h3Input(h3, run, id), ['rule_home', 'rule_act', 'contract_broken']);
      return ev.rule_home === 'core' && ev.rule_act === 'step' && ev.contract_broken === true;
    });
    if (!stepBroken) diff.push('step: hand skipped, computed no broken step');
  }
  return { ok: diff.length === 0, diff };
}

describe('evidence on the 182 H3 runs (HF8)', () => {
  it('reads the frozen fixture', () => {
    const sha = createHash('sha256').update(readFileSync(H3_PATH)).digest('hex');
    expect(sha).toBe(H3_SHA256);
    const h3 = loadH3();
    expect(h3.runs).toHaveLength(182);
  });

  it('gives the hand evidence on at least 90% of the runs, and on all 182 today', () => {
    const h3 = loadH3();
    const misses = h3.runs.map((run) => ({ id: run.id, ...agrees(h3, run) })).filter((row) => !row.ok);
    const share = (h3.runs.length - misses.length) / h3.runs.length;
    expect(share, JSON.stringify(misses.slice(0, 5))).toBeGreaterThanOrEqual(0.9);
    expect(misses, JSON.stringify(misses.slice(0, 5))).toEqual([]);
  });

  it('reads the recorded classifier, never a model, for the reply', () => {
    const h3 = loadH3();
    const run = h3.runs.find((one) => one.hand.next === 'asked for town') as H3Run;
    const block = h3.blocks[run.block];
    if (!block) throw new Error('no block');
    const input = h3Input(h3, run, slotVerdict(block));
    expect(input.reply?.by).toBe('gpt-6-luna (recorded)');
    expect(evidence.computeEvidence(input).stricter_rule_obeyed).toBe(true);
  });
});
