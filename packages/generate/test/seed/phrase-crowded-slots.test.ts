import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import type { ProposalRelation } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';
import { phraseDrafts, type UnsaidPhrase } from '../../src/seed/phrase-seeder';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

// A hand-written bank desk: two short walks, so a few behaviour phrases already fill every (stage, flow) slot.
// The account read is conditional: it runs only at verify on the balance flow, the slot the first free
// phrase takes when phrases are placed in map order.
const evidence = { source: 'prompt.md', quote: 'Read the account only while verifying a balance enquiry.' };
const by = { evidence, produced_by: 'code' as const, approved: true };
const BEHAVIOURS = {
  'note-down': 'Please note that down.',
  'say-thanks': 'Thanks for your help.',
  'read-account': 'Can you read my account?',
  'read-card': 'Can you read the card record?',
};

function crowded() {
  const proposal = zedProposal({
    extra: [
      {
        id: 'behaviour',
        title: 'Things the assistant does',
        kind: 'behaviour',
        role: 'axis',
        ...by,
        values: Object.keys(BEHAVIOURS).map((id) => ({ id, title: id, ...by })),
      },
    ],
  });
  proposal.phrases = proposal.phrases.filter((phrase) => phrase.dimension === 'stage_transition');
  for (const [value, text] of Object.entries(BEHAVIOURS))
    proposal.phrases.push({
      dimension: 'behaviour',
      value,
      text,
      lang: 'en',
      produced_by: 'code',
      approved: true,
    });
  const relations: ProposalRelation[] = [
    {
      kind: 'path',
      id: 'card-short',
      flow: 'card',
      stages: ['greet', 'verify'],
      behaviours: Object.keys(BEHAVIOURS),
      ...by,
    },
    {
      kind: 'path',
      id: 'balance-long',
      flow: 'balance',
      stages: ['greet', 'verify', 'help'],
      behaviours: Object.keys(BEHAVIOURS),
      ...by,
    },
    {
      kind: 'uses_tool',
      subject: { dimension: 'behaviour', value: 'read-account' },
      tool: 'lookup',
      stage: 'verify',
      when: { flow: ['balance'] },
      ...by,
    },
    // No card walk reaches help: this phrase has no slot at all.
    {
      kind: 'uses_tool',
      subject: { dimension: 'behaviour', value: 'read-card' },
      tool: 'lookup',
      stage: 'help',
      when: { flow: ['card'] },
      ...by,
    },
  ];
  proposal.relations = relations;
  return { proposal, prepared: prepareMap(proposal, { tools: ZED_TOOLS }) };
}

/** The (stage, flow) where each behaviour phrase is said, and the tools its turn expects. */
function placements(prepared: ReturnType<typeof crowded>['prepared'], unsaid: UnsaidPhrase[]) {
  const drafts = phraseDrafts(prepared, { seed: 11, t: 2, max: 100 }, new Set(), 0, unsaid);
  const out = new Map<string, { slot: string; tools: unknown }>();
  for (const draft of drafts) {
    const block = draft.blocks.find(
      (entry) => entry.stimulus.kind === 'phrase' && entry.stimulus.phrase.dimension === 'behaviour',
    );
    if (!block || block.stimulus.kind !== 'phrase') continue;
    const flow = draft.cell
      .map(([dimension, value]) => [
        prepared.space.dimensions[dimension]?.id,
        prepared.space.dimensions[dimension]?.values[value]?.id,
      ])
      .find(([dimension]) => dimension === 'flow')?.[1];
    out.set(block.stimulus.phrase.value, { slot: `${block.stage}@${flow}`, tools: block.tools });
  }
  return out;
}

describe('behaviour phrases on a map whose slots are crowded', () => {
  it.each([0, 1, 2, 3])('reports every waiting phrase when the spec cap is %i', (max) => {
    const { prepared } = crowded();
    const unsaid: UnsaidPhrase[] = [];
    const drafts = phraseDrafts(prepared, { seed: 1097, t: 2, max }, new Set(), 0, unsaid);
    const said = new Set(
      drafts.flatMap((draft) =>
        draft.blocks.flatMap((block) =>
          block.stimulus.kind === 'phrase' ? [block.stimulus.phrase.text] : [],
        ),
      ),
    );
    const waiting = Object.values(BEHAVIOURS).filter((text) => !said.has(text));
    expect(unsaid.map((entry) => entry.text).sort()).toEqual(waiting.sort());
    expect(new Set(unsaid.map((entry) => entry.text)).size).toBe(unsaid.length);
    expect(unsaid.every((entry) => entry.reasons.includes('cut by --max'))).toBe(true);
  });

  it('reports an impossible call conjunction instead of silently dropping its phrase', () => {
    const { proposal } = crowded();
    const call = proposal.relations?.find(
      (entry) => entry.kind === 'uses_tool' && entry.subject.value === 'read-account',
    );
    if (call?.kind !== 'uses_tool') throw new Error('missing conditional call');
    call.when = { flow: ['balance'], stage: ['help'] };
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS });
    const result = generateSuite(prepared, { seed: 1061, mapPath: '../approved.yaml' });
    expect(result.report.no_phrase).toContainEqual(
      expect.objectContaining({
        value: 'read-account',
        unsaid: [
          expect.objectContaining({
            text: BEHAVIOURS['read-account'],
            reasons: expect.arrayContaining([expect.stringContaining('no behaviour tool relation applies')]),
          }),
        ],
      }),
    );
  });

  it.each([1013, 1061, 1097])('keeps capped phrase gaps in the suite report on seed %i', (seed) => {
    const { prepared } = crowded();
    const result = generateSuite(prepared, { seed, max: 0, mapPath: '../approved.yaml' });
    for (const [value, text] of Object.entries(BEHAVIOURS))
      expect(result.report.no_phrase).toContainEqual(
        expect.objectContaining({
          value,
          unsaid: [expect.objectContaining({ text, reasons: ['cut by --max'] })],
        }),
      );
  });

  it('does not report phrases already said when an offset exhausts the cap', () => {
    const { prepared } = crowded();
    const unsaid: UnsaidPhrase[] = [];
    const drafts = phraseDrafts(
      prepared,
      { seed: 2203, t: 2, max: 3 },
      new Set([BEHAVIOURS['note-down']]),
      3,
      unsaid,
    );
    expect(drafts).toEqual([]);
    expect(unsaid.map((entry) => entry.text).sort()).toEqual(
      Object.values(BEHAVIOURS)
        .filter((text) => text !== BEHAVIOURS['note-down'])
        .sort(),
    );
  });

  it('keeps the pending walk reasons as well as the cap reason', () => {
    const { prepared } = crowded();
    const unsaid: UnsaidPhrase[] = [];
    phraseDrafts(prepared, { seed: 1097, t: 2, max: 3 }, new Set(), 0, unsaid);
    const reasons = unsaid.find((entry) => entry.value === 'read-card')?.reasons ?? [];
    expect(reasons).toContain('cut by --max');
    expect(reasons).toContainEqual(expect.stringContaining('no behaviour tool relation applies'));
  });

  it('says a conditional phrase at the one slot its call allows, moving a free sibling elsewhere', () => {
    const { prepared } = crowded();
    const unsaid: UnsaidPhrase[] = [];
    const placed = placements(prepared, unsaid);
    expect(placed.get('read-account')).toEqual({
      slot: 'verify@balance',
      tools: [{ label: 'lookup', count: 1 }],
    });
    expect(placed.has('note-down')).toBe(true);
    expect(placed.has('say-thanks')).toBe(true);
    // No two behaviour phrases share a (stage, flow) slot.
    const slots = [...placed.values()].map((entry) => entry.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('reports a phrase no walk can say, with the reason, instead of dropping it', () => {
    const { prepared } = crowded();
    const unsaid: UnsaidPhrase[] = [];
    const placed = placements(prepared, unsaid);
    expect(placed.has('read-card')).toBe(false);
    expect(unsaid).toEqual([
      expect.objectContaining({ dimension: 'behaviour', value: 'read-card', text: BEHAVIOURS['read-card'] }),
    ]);
    expect(unsaid[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('lists the unsaid phrase under no_phrase in the generate report', () => {
    const { prepared } = crowded();
    const result = generateSuite(prepared, { seed: 11, mapPath: '../approved.yaml' });
    const entry = result.report.no_phrase.find(
      (gap) => gap.dimension === 'behaviour' && gap.value === 'read-card',
    );
    expect(entry).toMatchObject({ blocks: 0, specs: [], unsaid: [{ text: BEHAVIOURS['read-card'] }] });
    expect(
      result.report.no_phrase.some((gap) => gap.dimension === 'behaviour' && gap.value === 'read-account'),
    ).toBe(false);
  });
});
