import type { Observed, Spec } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import type { SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { checkAsk, checkTrace, envOf } from '../../src/ladders/estate/bank/task-check';
import { judgeSpecs } from '../../src/ladders/estate/bank/taskv2';

const atom = (over: Partial<Atom>): Atom =>
  ({
    id: 'rule.harbour',
    kind: 'instruction',
    title: 'Harbour disposition',
    approved: true,
    provenance: {
      file: 'CLAUDE.md',
      startLine: 1,
      endLine: 1,
      quote: 'Harbour disposition',
      hash: 'harbour',
    },
    replyAct: { id: 'report', evidence: { type: 'text_segment', part: 'reply' } },
    evidence: [{ type: 'text', must: ['BERTH-42'] }],
    ...over,
  }) as Atom;
const observed = (over: Partial<Observed> = {}): Observed =>
  ({
    text: '',
    segments: [],
    toolCalls: [],
    cost: { total: 0 },
    latencyMs: 0,
    ...over,
  }) as Observed;
const reply = (id: 'answer' | 'report'): Observed =>
  observed({
    text: 'BERTH-42',
    segments: [{ type: 'text', text: 'BERTH-42' }],
    replyAct: {
      id,
      evidence: { type: 'text_segment', part: 'reply', index: 0 },
      source: { kind: 'adapter', name: 'fictional-harbour-adapter' },
    },
  });

function planted(unit: Atom, ask: string) {
  const env = envOf(
    [unit],
    { situations: [{ id: 'approved', atoms: [unit.id], phrases: [{ text: ask, approved: true }] }] },
    { sessions: [] },
  );
  const spec: SuiteSpec = {
    id: 'planted',
    path: 'fictional.yaml',
    atoms: [unit.id],
    mode: 'live',
    testType: 'obligation',
    complete: true,
    spec: {
      id: 'planted',
      blocks: [{ id: 'ask', when: { user: ask } }],
      metadata: {
        estate: {
          atoms: [unit.id],
          link: { span: unit.id, fp: unit.provenance.hash, relation: 'exercises', createdBy: 'generator' },
          act: actOfAtom(unit, [unit]),
          from: { bank: 'approved', phrase: 0 },
        },
      },
    } as unknown as Spec,
  };
  return { env, spec };
}
async function reasons(unit: Atom, ask: string, trace: Observed) {
  const { env, spec } = planted(unit, ask);
  const result = await judgeSpecs([spec], env, async () => new Map([[spec.id, trace]]));
  return result[0]?.reasons;
}

describe('generated asks are held to their map act and recorded trace', () => {
  const guard = atom({
    kind: 'guard',
    fields: { name: 'harbour-guard' },
    evidence: [{ type: 'guard', name: 'harbour-guard', verdict: 'deny' }],
  });
  it('rejects an allowed verb performing the wrong guard act without a code span', async () => {
    expect(
      await reasons(
        guard,
        'Please run the inventory report.',
        observed({ runtime: { guards: [{ name: 'other-guard', verdict: 'deny' }] } }),
      ),
    ).toEqual([expect.stringContaining('does not show the act')]);
  });
  it('accepts an unlisted verb when the correct guard records its act', async () => {
    expect(
      await reasons(
        guard,
        'Please berthify the vessel.',
        observed({ runtime: { guards: [{ name: 'harbour-guard', verdict: 'deny' }] } }),
      ),
    ).toEqual([]);
  });
  it('rejects a guard with the wrong verdict and a missing trace', async () => {
    expect(
      await reasons(
        guard,
        'Please berthify the vessel.',
        observed({ runtime: { guards: [{ name: 'harbour-guard', verdict: 'allow' }] } }),
      ),
    ).not.toEqual([]);
    const { env, spec } = planted(guard, 'Please berthify the vessel.');
    const need = checkAsk(spec, env).trace;
    expect(need).toBeDefined();
    if (need) expect(checkTrace(need, undefined)).toBe('the fake did not run the ask');
  });
  it('rejects a permitted verb whose reply label identifies the wrong map act', async () => {
    expect(await reasons(atom({}), 'Please report the warehouse total.', reply('answer'))).toEqual([
      expect.stringContaining('does not show the act'),
    ]);
  });
  it('accepts an unlisted verb whose bound reply label shows the map act', async () => {
    expect(await reasons(atom({}), 'Please berthify the vessel.', reply('report'))).toEqual([]);
  });
  it('fails closed for a reply with no declared map act even when its outcome text matches', async () => {
    expect(
      await reasons(atom({ replyAct: undefined }), 'Please berthify the vessel.', reply('report')),
    ).not.toEqual([]);
  });
  it('does not let a control pass on an absent run', async () => {
    const { env, spec } = planted(guard, 'Please retain the current berth.');
    spec.testType = 'guard_negative';
    const [result] = await judgeSpecs([spec], env, async () => new Map());
    expect(result?.reasons).toEqual(['the fake did not run the ask']);
  });
  it('checks a non-explicit helper ask too', async () => {
    const helper = atom({ kind: 'subagent', fields: { name: 'harbour-clerk' }, evidence: [] });
    expect(await reasons(helper, 'Please run the inventory report.', observed())).toEqual([
      expect.stringContaining('does not show the act'),
    ]);
  });
});
