import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { createToolsCheck } from '../src/checks/tools';
import type { SameReferentJudge } from '../src/value-check/judge';
import { DEFAULT_VALUE_POLICY, runLadder } from '../src/value-check/ladder';
import { context, observed, run, verdict } from './support/context';

/**
 * The three findings of the independent review of V1 (PR 459, head f1d09baa8), as regression tests: a replay
 * that resolves nothing proves nothing, a judge reply with no decision decides nothing, and the deciding rung is
 * structured data on the verdict. Fictional data only.
 */

describe('a replay that returns no resolved field decides nothing', () => {
  const replayer = (output: unknown) => ({
    declaration: () => ({ resolved: ['id'], distractors: true }),
    call: () => ({ ok: true as const, output }),
  });
  const lookup = {
    tool: 'lookup',
    field: 'id',
    gold: 'right-id',
    value: 'wrong-id',
    input: { id: 'wrong-id' },
  };

  it('an empty output for both values passes nothing: rung 1 skips, the exact fallback fails', async () => {
    const result = await runLadder(lookup, DEFAULT_VALUE_POLICY, { replayer: replayer({}) });
    expect(result).toMatchObject({ outcome: 'fail', rung: 'exact_fallback' });
    expect(result.tried.find((entry) => entry.rung === 'rung1_outcome')?.reason).toContain('returned no id');
  });

  it('a field that resolved to null is a result: the same null on both sides passes', async () => {
    const result = await runLadder(lookup, DEFAULT_VALUE_POLICY, { replayer: replayer({ id: null }) });
    expect(result).toMatchObject({ outcome: 'pass', rung: 'rung1_outcome' });
  });
});

describe('a judge reply with no decision leaves the value inconclusive', () => {
  const stub = (answer: unknown): SameReferentJudge => ({
    model: 'offline-stub',
    calibration: { falseAcceptance: 0, kappa: 1, labellersKappa: 1, source: 'review stub' },
    complete: async () => answer,
  });

  it.each([
    null,
    {},
    { error: 'provider returned no decision' },
    { has_content: 'true', reading: 12 },
    { has_content: true, reading: '' },
  ])('a read answered %j is inconclusive, with the reason', async (answer) => {
    const result = await runLadder(
      { tool: 'notify_sales', field: 'phone', gold: '+12025550131', value: '+1 202 555 0131' },
      DEFAULT_VALUE_POLICY,
      { judge: stub(answer) },
    );
    expect(result.outcome).toBe('inconclusive');
    expect(result.evidence).toContain('malformed');
  });

  it('a compare answered without a boolean is inconclusive; a contentless reading is still a negative decision', async () => {
    const reads: SameReferentJudge = {
      ...stub(undefined),
      complete: async (request) =>
        request.kind === 'read' ? { has_content: true, reading: String(request.parts.v) } : { same: 'yes' },
    };
    const field = { tool: 'notify_sales', field: 'phone', gold: '+12025550131', value: '+1 202 555 0131' };
    expect((await runLadder(field, DEFAULT_VALUE_POLICY, { judge: reads })).outcome).toBe('inconclusive');
    const empty = { ...stub(undefined), complete: async () => ({ has_content: false, reading: null }) };
    expect((await runLadder(field, DEFAULT_VALUE_POLICY, { judge: empty })).outcome).toBe('fail');
  });
});

describe('the deciding rung is structured data on the verdict', () => {
  it('the argument verdict carries valueCheck with the rung, for F2 to map to by.item', async () => {
    const parsed = validateSpec({
      id: 'review',
      blocks: [
        { user: 'Call me', expect: { tools: [{ label: 'notify_sales', input: { phone: '+12025550131' } }] } },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const seen = observed('Done', [{ label: 'notify_sales', input: { phone: '+1 202 555 0131' } }]);
    const argument = verdict(
      await run(createToolsCheck(), context(parsed.spec, 0, seen)),
      'tools.notify_sales.input.phone',
    );
    expect(argument.outcome).toBe('fail');
    expect(argument.valueCheck).toEqual([
      { call: 1, path: 'phone', rung: 'exact_fallback', outcome: 'fail' },
    ]);
    const equal = observed('Done', [{ label: 'notify_sales', input: { phone: '+12025550131' } }]);
    const same = verdict(
      await run(createToolsCheck(), context(parsed.spec, 0, equal)),
      'tools.notify_sales.input.phone',
    );
    // A value equal to the gold went through no rung: the field stays absent, so records of plain passes do not change.
    expect(same).not.toHaveProperty('valueCheck');
  });
});
