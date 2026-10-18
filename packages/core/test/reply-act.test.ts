import { describe, expect, it } from 'vitest';
import { Observed } from '../src/schema/run';

const base = {
  segments: [{ type: 'text', text: 'Fictional result.' }],
  text: 'Fictional result.',
  toolCalls: [],
  cost: {},
  latencyMs: 0,
};
const replyAct = {
  id: 'report',
  evidence: { type: 'text_segment', part: 'reply', index: 0 },
  source: { kind: 'adapter', name: 'fictional-agent' },
};

describe('optional structured reply act observation', () => {
  it('preserves an explicit reply act and its evidence and provenance', () => {
    expect(Observed.parse({ ...base, replyAct })).toEqual({ ...base, replyAct });
  });
  it('keeps legacy observations valid without synthesizing a reply act', () => {
    expect(Observed.parse(base)).not.toHaveProperty('replyAct');
  });
  it.each(['answer', 'clarify', 'refuse', 'report', 'draft', 'acknowledge'])(
    'accepts the declared %s id',
    (id) => {
      expect(Observed.safeParse({ ...base, replyAct: { ...replyAct, id } }).success).toBe(true);
    },
  );
  it('accepts judge provenance and an explicit draft segment role', () => {
    expect(
      Observed.safeParse({
        ...base,
        replyAct: {
          id: 'draft',
          evidence: { type: 'text_segment', part: 'draft', index: 0 },
          source: { kind: 'judge', name: 'declared-judge' },
        },
      }).success,
    ).toBe(true);
  });
  it.each([
    { id: 'unknown' },
    { evidence: { type: 'text_segment', part: 'reply', index: -1 } },
    { evidence: { type: 'text_segment', part: 'reply', index: 0.5 } },
    { evidence: { type: 'text_segment', part: 'reply' } },
    { evidence: { type: 'text_segment', part: 'tool', index: 0 } },
    { evidence: { type: 'text_segment', part: 'reply', index: 0, quote: 'invented' } },
    { source: { kind: 'model', name: 'fictional' } },
    { source: { kind: 'adapter', name: '' } },
    { source: { kind: 'adapter', name: ' \n\t ' } },
    { source: { kind: 'adapter', name: 'fictional', inferred: true } },
    { expected: 'report' },
  ])('rejects malformed or undeclared reply evidence %j', (change) => {
    expect(Observed.safeParse({ ...base, replyAct: { ...replyAct, ...change } }).success).toBe(false);
  });
});
