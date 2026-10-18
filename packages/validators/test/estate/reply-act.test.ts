import { must, mustNot } from '@agent-nexus/driftbench-checks';
import type { Observed, Spec } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { context, observed, run } from '../../../checks/test/support/context';
import type { SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { holdsTask } from '../../src/ladders/estate/bank/genquality';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { checkAsk, checkTrace, envOf } from '../../src/ladders/estate/bank/task-check';

const atom = (): Atom => ({
  id: 'instruction.fictional-harbour',
  kind: 'instruction',
  title: 'Harbour disposition',
  approved: true,
  producedBy: 'code',
  role: 'axis',
  enforcement: [],
  provenance: {
    file: 'CLAUDE.md',
    startLine: 1,
    endLine: 1,
    quote: 'Harbour disposition',
    hash: 'fictional-harbour',
  },
  replyAct: { id: 'report', evidence: { type: 'text_segment', part: 'reply' } },
  evidence: [{ type: 'text', must: ['BERTH-42'], mustNot: ['STOCK-7'] }],
});

function fixture(ask = 'Please berthify the vessel.', unit = atom()) {
  const env = envOf(
    [unit],
    { situations: [{ id: 'approved', atoms: [unit.id], phrases: [{ text: ask, approved: true }] }] },
    { sessions: [] },
  );
  const spec = {
    id: 'fictional-reply',
    blocks: [{ id: 'ask', when: { user: ask }, expect: { must: ['BERTH-42'], must_not: ['STOCK-7'] } }],
    metadata: {
      estate: {
        atoms: [unit.id],
        act: actOfAtom(unit, [unit]),
        link: { span: unit.id, fp: unit.provenance.hash, relation: 'exercises', createdBy: 'generator' },
        from: { bank: 'approved', phrase: 0 },
      },
    },
  } as unknown as Spec;
  const candidate: SuiteSpec = {
    id: spec.id,
    path: 'fictional-reply.yaml',
    atoms: [unit.id],
    mode: 'live',
    testType: 'obligation',
    complete: true,
    spec,
  };
  return { unit, spec, candidate, env };
}

function reply(text = 'BERTH-42'): Observed {
  return observed(text, [], {
    replyAct: {
      id: 'report',
      evidence: { type: 'text_segment', part: 'reply', index: 0 },
      source: { kind: 'adapter', name: 'fictional-harbour-adapter' },
    },
  });
}

/** Deliberately corrupt an untrusted recorded trace after its typed construction. */
function replaceLabel(trace: Observed, edit: Record<string, unknown>): Observed {
  return { ...trace, replyAct: { ...trace.replyAct, ...edit } } as Observed;
}

describe('reply acts are named map acts bound to recorded text segments', () => {
  it('rejects an allowed verb with the wrong reply act despite identical outcome words', () => {
    const f = fixture('Please report the warehouse total.');
    expect(checkAsk(f.candidate, f.env).reasons).toEqual([]);
    expect(holdsTask(f.candidate, f.env, reply())).toBe(true);
    expect(holdsTask(f.candidate, f.env, replaceLabel(reply(), { id: 'answer' }))).toBe(false);
  });

  it('accepts an unlisted verb when the recorded reply act matches', () => {
    const f = fixture();
    expect(actOfAtom(f.unit, [f.unit])).toEqual({ kind: 'reply', name: 'report' });
    expect(holdsTask(f.candidate, f.env, reply())).toBe(true);
  });

  it('keeps rule outcome predicates separate from the reply act proof', async () => {
    const f = fixture();
    const trace = reply('STOCK-7');
    expect(holdsTask(f.candidate, f.env, trace)).toBe(true);
    expect(await run(must, context(f.spec, 0, trace))).toEqual([
      expect.objectContaining({ outcome: 'fail' }),
    ]);
    expect(await run(mustNot, context(f.spec, 0, trace))).toEqual([
      expect.objectContaining({ outcome: 'fail' }),
    ]);
    const correct = reply();
    expect(await run(must, context(f.spec, 0, correct))).toEqual([
      expect.objectContaining({ outcome: 'pass' }),
    ]);
    expect(await run(mustNot, context(f.spec, 0, correct))).toEqual([
      expect.objectContaining({ outcome: 'pass' }),
    ]);
  });

  it('fails closed on an old map without a reply declaration even when text.must matches', () => {
    const unit = atom();
    delete unit.replyAct;
    const f = fixture(undefined, unit);
    const result = checkAsk(f.candidate, f.env);
    expect(result.reasons).not.toEqual([]);
    expect(result.trace).toBeUndefined();
    expect(holdsTask(f.candidate, f.env, reply())).toBe(false);
  });

  it('does not take the expected reply act from the generated spec', () => {
    const f = fixture();
    const meta = f.spec.metadata?.estate as Record<string, unknown>;
    meta.act = { kind: 'reply', name: 'answer' };
    expect(checkAsk(f.candidate, f.env).reasons.join(' ')).toContain('the spec says');
    expect(holdsTask(f.candidate, f.env, replaceLabel(reply(), { id: 'answer' }))).toBe(false);
  });

  it.each([
    ['missing id', { id: undefined }],
    ['unknown id', { id: 'berthify' }],
    ['missing evidence', { evidence: undefined }],
    ['wrong evidence type', { evidence: { type: 'tool_call', part: 'reply', index: 0 } }],
    ['wrong part', { evidence: { type: 'text_segment', part: 'draft', index: 0 } }],
    ['missing index', { evidence: { type: 'text_segment', part: 'reply' } }],
    ['negative index', { evidence: { type: 'text_segment', part: 'reply', index: -1 } }],
    ['fractional index', { evidence: { type: 'text_segment', part: 'reply', index: 0.5 } }],
    ['out of range index', { evidence: { type: 'text_segment', part: 'reply', index: 1 } }],
    ['missing source', { source: undefined }],
    ['unknown source kind', { source: { kind: 'spec', name: 'fictional-spec' } }],
    ['empty source name', { source: { kind: 'adapter', name: '' } }],
    ['blank source name', { source: { kind: 'judge', name: '   ' } }],
  ])('rejects a label with %s', (_name, edit) => {
    const f = fixture();
    expect(holdsTask(f.candidate, f.env, reply())).toBe(true);
    expect(holdsTask(f.candidate, f.env, replaceLabel(reply(), edit))).toBe(false);
  });

  it.each(['', '   ', '\n\t'])('rejects an empty or blank bound segment %j', (text) => {
    const f = fixture();
    const trace = reply();
    trace.segments = [{ type: 'text', text }];
    expect(holdsTask(f.candidate, f.env, trace)).toBe(false);
  });

  it('rejects unbound aggregate text, a missing label, a tool segment, and an absent run', () => {
    const f = fixture();
    const missingSegments = reply();
    missingSegments.segments = [];
    expect(holdsTask(f.candidate, f.env, missingSegments)).toBe(false);
    expect(holdsTask(f.candidate, f.env, observed('BERTH-42'))).toBe(false);
    const toolSegment = reply();
    toolSegment.segments = [{ type: 'tool_call', label: 'Bash', input: { command: 'echo BERTH-42' } }];
    expect(holdsTask(f.candidate, f.env, toolSegment)).toBe(false);
    const need = checkAsk(f.candidate, f.env).trace;
    expect(need).toBeDefined();
    if (!need) throw new Error('missing static reply act');
    expect(checkTrace(need, undefined)).toBe('the fake did not run the ask');
  });

  it('accepts a judge label and a valid nonzero segment index', () => {
    const f = fixture();
    const trace = observed('BERTH-42', [{ label: 'Read', input: { file_path: 'fictional.txt' } }], {
      replyAct: {
        id: 'report',
        evidence: { type: 'text_segment', part: 'reply', index: 2 },
        source: { kind: 'judge', name: 'fictional-reply-judge' },
      },
    });
    expect(holdsTask(f.candidate, f.env, trace)).toBe(true);
  });

  it('requires the declared draft part for a draft act', () => {
    const unit = atom();
    unit.replyAct = { id: 'draft', evidence: { type: 'text_segment', part: 'draft' } };
    const f = fixture('Please berthify the vessel.', unit);
    const trace = replaceLabel(reply(), {
      id: 'draft',
      evidence: { type: 'text_segment', part: 'draft', index: 0 },
    });
    expect(holdsTask(f.candidate, f.env, trace)).toBe(true);
    expect(
      holdsTask(
        f.candidate,
        f.env,
        replaceLabel(trace, {
          evidence: { type: 'text_segment', part: 'reply', index: 0 },
        }),
      ),
    ).toBe(false);
  });

  it('requires a valid bound reply label before applying a negative control', () => {
    const f = fixture();
    f.candidate.testType = 'outside_trigger';
    expect(holdsTask(f.candidate, f.env, reply())).toBe(false);
    expect(holdsTask(f.candidate, f.env, replaceLabel(reply(), { id: 'answer' }))).toBe(true);
    expect(holdsTask(f.candidate, f.env, observed('BERTH-42'))).toBe(false);
    expect(holdsTask(f.candidate, f.env, replaceLabel(reply(), { id: 'unknown' }))).toBe(false);
    expect(
      holdsTask(
        f.candidate,
        f.env,
        replaceLabel(reply(), {
          id: 'answer',
          evidence: { type: 'text_segment', part: 'reply', index: 20 },
        }),
      ),
    ).toBe(false);
  });
});
