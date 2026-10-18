import { describe, expect, it } from 'vitest';
import { drawEstate } from '../../src/ladders/estate/hidden';
import { type ProseEntry, renderEstate } from '../../src/ladders/estate/render';

const identities = {
  'rule:no-webfetch': 'refuse',
  'rule:no-force-push': 'refuse',
  'rule:stop-word': 'acknowledge',
  'rule:grounded-values': 'report',
  'rule:verify-before-report': 'report',
  'rule:no-filler-words': 'answer',
  'rule:next-line': 'answer',
  'rule:lead-with-result': 'answer',
  'rule:reply-length': 'answer',
  'rule:dates-year-first': 'answer',
} as const;

function entries(estate: ReturnType<typeof drawEstate>): ProseEntry[] {
  return Object.values(renderEstate(estate).recording.answers).flatMap(
    (answer) => (answer as { atoms: ProseEntry[] }).atoms,
  );
}

describe('drawn reply declarations are authored with the hidden rules', () => {
  it('carries each authored identity and its original outcome evidence into the prose recording', () => {
    const seen = new Set<string>();
    for (const profile of ['visible', 'holdout'] as const) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const estate = drawEstate(seed, profile);
        const prose = entries(estate);
        for (const rule of estate.rules) {
          const expected = identities[rule.hid as keyof typeof identities];
          if (!expected) continue;
          seen.add(rule.hid);
          expect(rule.replyAct, rule.hid).toEqual({
            id: expected,
            evidence: { type: 'text_segment', part: 'reply' },
          });
          const recorded = prose.find((entry) => entry.quote === rule.text);
          expect(recorded?.replyAct, rule.hid).toEqual(rule.replyAct);
          expect(recorded?.evidence, rule.hid).toEqual(rule.evidence);
        }
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(identities).sort());
  });

  it('does not infer a missing declaration from English text or existing outcome words', () => {
    const estate = drawEstate(1);
    const rule = estate.rules.find((entry) => entry.hid === 'rule:next-line');
    if (!rule) throw new Error('missing authored next-line rule');
    delete rule.replyAct;
    const recorded = entries(estate).find((entry) => entry.quote === rule.text);
    expect(recorded?.replyAct).toBeUndefined();
    expect(recorded?.evidence).toEqual([{ type: 'text', must: ['Next:'] }]);
  });

  it('keeps operational gates and recovery work without invented reply labels', () => {
    for (const rule of drawEstate(1, 'holdout').rules) {
      if (rule.kind === 'gate' || rule.hazard || rule.cites) expect(rule.replyAct, rule.hid).toBeUndefined();
    }
  });
});
