import { describe, expect, it } from 'vitest';
import type { Proposal } from '../../src/extract/proposal';
import { renderDraft } from '../../src/seed/assemble';
import { prepareMap } from '../../src/seed/map';
import { coverDraft, preferring, scenarioDraft } from '../../src/seed/seed-drafts';
import { zedProposal } from '../enumerate/support';

const evidence = { source: 'prompt.md', quote: 'Balance checks amounts; card replaces cards.' };
const by = { evidence, produced_by: 'code' as const, approved: true };
const context = { seed: 42, t: 2, max: 100 };

// Hand-written input, independent of the validator's generated maps and item bank.
function map(change: (proposal: Proposal) => void = () => {}) {
  const proposal = zedProposal({
    extra: [
      {
        id: 'policy',
        title: 'Policy',
        kind: 'behaviour',
        role: 'axis',
        ...by,
        values: [
          { id: 'CHECK-11', title: 'Check an amount', ...by },
          { id: 'CHECK-22', title: 'Replace a card', ...by },
        ],
      },
    ],
  });
  proposal.constraints = [];
  proposal.dimensions
    .find((dimension) => dimension.id === 'stage_transition')
    ?.values.push({
      id: 'greet-to-lost',
      title: 'Replace a card',
      ...by,
    });
  proposal.phrases.push({
    dimension: 'stage_transition',
    value: 'greet-to-lost',
    text: 'Please replace my card.',
    lang: 'en',
    ...by,
  });
  proposal.relations = [
    // A path annotation is a preference, not authority to assign another flow's behaviour.
    { kind: 'path', id: 'replace', flow: 'card', stages: ['greet', 'lost'], behaviours: ['CHECK-11'], ...by },
    { kind: 'path', id: 'amount', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    { kind: 'recovery', class: 'D1_off_topic', flows: ['card', 'balance'], stage_after: 'pending', ...by },
    { kind: 'recovery', class: 'D5_language_switch', flows: ['balance'], stage_after: 'greet', ...by },
  ];
  change(proposal);
  return prepareMap(proposal, {
    inventory: {
      behaviours: [
        { id: 'CHECK-11', title: 'Check an amount', kind: 'conversation' },
        { id: 'CHECK-22', title: 'Replace a card', kind: 'conversation' },
      ],
      flows: [
        { id: 'balance', title: 'Balance', behaviours: ['CHECK-11'] },
        { id: 'card', title: 'Card', behaviours: ['CHECK-22'] },
      ],
    },
  });
}

function records(prepared: ReturnType<typeof map>, draft: Parameters<typeof renderDraft>[1]) {
  const rendered = renderDraft(prepared, draft, { seed: context.seed, mapPath: 'map.yaml' });
  return (
    rendered.spec.metadata as { generated: { blocks: Array<{ cell: Record<string, string> }> } }
  ).generated.blocks.map((block) => block.cell);
}

describe('cover flow membership', () => {
  it('uses a flow that lists the behaviour even when another path prefers it', () => {
    const prepared = map();
    const built = coverDraft(prepared, context, 'cover', { policy: 'CHECK-11' });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    expect(built.path.flow).toBe('balance');
  });

  it('preserves seeded draws when the preferred path already owns the behaviour', () => {
    const prepared = map((proposal) => {
      for (const relation of proposal.relations ?? []) {
        if (relation.kind === 'path')
          relation.behaviours = relation.flow === 'balance' ? ['CHECK-11'] : ['CHECK-22'];
      }
    });
    const dimension = prepared.space.dimensions.findIndex((entry) => entry.id === 'policy');
    const value = prepared.space.dimensions[dimension]?.index.get('CHECK-11');
    if (value === undefined) throw new Error('missing handwritten value');
    const reference = scenarioDraft(
      prepared,
      { ...context, usage: new Map() },
      'cover',
      'cover',
      'Cell',
      [[dimension, value]],
      preferring(prepared.relations.paths, 'CHECK-11'),
    );
    const built = coverDraft(prepared, { ...context, usage: new Map() }, 'cover', { policy: 'CHECK-11' });
    if (!('draft' in built) || !('draft' in reference)) throw new Error('handwritten cell did not build');
    expect(built.draft.blocks).toEqual(reference.draft.blocks);
    expect(built.draft.cell).toEqual(reference.draft.cell);
  });

  it('reports an unplaceable behaviour instead of falling back when its path cannot build', () => {
    const prepared = map((proposal) => {
      const transitions = proposal.dimensions.find((dimension) => dimension.id === 'stage_transition');
      if (transitions)
        transitions.values = transitions.values.filter((value) => value.id !== 'greet-to-verify');
    });
    const built = coverDraft(prepared, context, 'cover', { policy: 'CHECK-11' });
    expect(built).toMatchObject({ reasons: expect.arrayContaining([expect.stringContaining('amount')]) });
    expect('draft' in built).toBe(false);
  });

  it('reports the behaviour when no approved path of its flow passes the requested stage', () => {
    const built = coverDraft(map(), context, 'cover', { policy: 'CHECK-11', stage: 'lost' });
    expect('draft' in built).toBe(false);
    if ('draft' in built) throw new Error('unexpected draft');
    expect(built.reasons.join(' ')).toContain('CHECK-11');
  });

  it('applies membership to every behaviour dimension regardless of value order', () => {
    for (const values of [
      { policy: 'CHECK-11', flow: 'card' },
      { flow: 'card', policy: 'CHECK-11' },
    ]) {
      const built = coverDraft(map(), context, 'cover', values);
      expect('draft' in built).toBe(false);
    }
  });

  it('does not use an unrelated flow for an opening perturbation', () => {
    const prepared = map((proposal) => {
      proposal.relations = proposal.relations?.filter(
        (entry) => entry.kind !== 'path' || entry.flow !== 'balance',
      );
    });
    const built = coverDraft(prepared, context, 'cover', {
      policy: 'CHECK-11',
      stage: 'greet',
      deviation: 'D1_off_topic',
    });
    expect('draft' in built).toBe(false);
  });
});

describe('recorded event stages', () => {
  it('records each move at its destination, including the first move', () => {
    const prepared = map();
    const built = coverDraft(prepared, context, 'cover', { flow: 'balance' });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    expect(records(prepared, built.draft).map((cell) => cell.stage)).toEqual(['verify', 'help']);
    expect(built.draft.blocks.map((block) => block.stage)).toEqual(['verify', 'help']);
  });

  it('keeps a deviation at the stage where it is said when its recovery moves elsewhere', () => {
    const prepared = map();
    const built = coverDraft(prepared, context, 'cover', {
      flow: 'balance',
      deviation: 'D5_language_switch',
      stage: 'verify',
    });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    expect(built.draft.blocks.at(-1)).toMatchObject({ injection: 'D5_language_switch', stage: 'greet' });
    expect(records(prepared, built.draft).at(-1)?.stage).toBe('verify');
  });
});
