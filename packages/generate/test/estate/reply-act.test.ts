import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';
import type { EstateAtom } from '../../src/estate/inputs';
import { actRecord } from '../../src/estate/record';

const fixture = (id: string, askedId = id): EstateAtom =>
  ({
    id: 'instruction.fictional-reply',
    kind: 'instruction',
    title: 'An unrelated source title',
    approved: true,
    evidence: [],
    replyAct: { id, evidence: { type: 'text_segment', part: id === 'draft' ? 'draft' : 'reply' } },
    fields: { ask: { text: 'zorbulate the ledger', act: { kind: 'reply', name: askedId } } },
  }) as EstateAtom;

describe('reply acts are declarations with recorded evidence', () => {
  it.each(['answer', 'clarify', 'refuse', 'report', 'draft', 'acknowledge'])(
    'carries the declared %s identity without classifying the request words',
    (id) => {
      const atom = fixture(id);
      expect(actRecord(atom)).toEqual({ kind: 'reply', name: id });
      expect(codeAsk('trigger', [atom], []).text).toBe('Please zorbulate the ledger.');
    },
  );
  it('refuses a planted allowed verb carrying another reply act', () => {
    const atom = fixture('clarify', 'report');
    atom.fields = { ask: { text: 'read the ledger', act: { kind: 'reply', name: 'report' } } };
    expect(codeAsk('trigger', [atom], []).text).toBeUndefined();
  });
  it('does not assign a default reply identity when the map declaration is absent', () => {
    const atom = fixture('report');
    delete atom.replyAct;
    expect(actRecord(atom)).toEqual({ kind: 'reply' });
    expect(codeAsk('trigger', [atom], []).text).toBeUndefined();
  });
  it('does not override the structured owner act', () => {
    const owner: EstateAtom = {
      id: 'skill.ledger',
      kind: 'skill',
      title: 'Ledger',
      approved: true,
      evidence: [],
      fields: { name: 'ledger' },
    };
    expect(actRecord(fixture('report'), owner)).toEqual({ kind: 'owned', name: 'ledger', target: 'skill' });
  });
  it.each(['guard', 'route', 'reference', 'script', 'skill', 'subagent', 'tool', 'setting', 'invariant'])(
    'does not mask missing %s evidence with a reply declaration',
    (kind) => {
      const atom = { ...fixture('report'), kind };
      expect(actRecord(atom)).toEqual({ kind: 'reply' });
      expect(codeAsk('trigger', [atom], []).text).toBeUndefined();
    },
  );
});
