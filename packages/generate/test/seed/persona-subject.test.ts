import { describe, expect, it } from 'vitest';
import type { Proposal } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';
import { impossibleConstraints } from '../../src/seed/possible';
import { coverDraft, flowsOfBehaviour } from '../../src/seed/seed-drafts';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

const evidence = { source: 'prompt.md', quote: 'The tide desk reads the gauge.' };
const by = { evidence, produced_by: 'code' as const, approved: true };
const context = { seed: 42, t: 2, max: 100 };

// Hand-written input, independent of the validator's hidden maps. The balance flow walks greet, verify, help and
// calls the gauge on its move out of greet. `keeper` is a dimension of the kind given, with the value DESK-7 that
// the inventory lists under balance; DESK-7 has a use of the gauge that stays on each stage.
function map(kind: 'behaviour' | 'persona', change: (proposal: Proposal) => void = () => {}) {
  const proposal: Proposal = zedProposal({
    extra: [
      {
        id: 'keeper',
        title: 'Keeper',
        kind,
        role: 'axis',
        ...by,
        values: [{ id: 'DESK-7', title: 'The desk keeper', ...by }],
      },
    ],
  });
  proposal.constraints = [];
  proposal.phrases.push({
    dimension: 'keeper',
    value: 'DESK-7',
    text: 'The keeper is on the desk.',
    lang: 'en',
    ...by,
  });
  proposal.relations = [
    { kind: 'path', id: 'amount', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    {
      kind: 'uses_tool',
      subject: { dimension: 'flow', value: 'balance' },
      tool: 'read_gauge',
      stage: 'greet',
      to: 'verify',
      input: { account: '4' },
      ...by,
    },
    ...['verify', 'help'].map((stage) => ({
      kind: 'uses_tool' as const,
      subject: { dimension: 'keeper', value: 'DESK-7' },
      tool: 'read_gauge',
      stage,
      to: stage,
      input: { account: '4' },
      ...by,
    })),
    {
      kind: 'recovery',
      class: 'D8_tool_failure',
      flows: ['balance'],
      tool: 'read_gauge',
      stage_after: 'pending',
      tools: [{ tool: 'read_gauge', count: 2 }],
      ...by,
    },
  ];
  change(proposal);
  return prepareMap(proposal, {
    tools: ZED_TOOLS.map((entry) => ({ ...entry, name: 'read_gauge', slug: 'read_gauge' })),
    inventory: {
      behaviours: [{ id: 'DESK-7', title: 'The desk keeper', kind: 'conversation' }],
      flows: [
        { id: 'balance', title: 'Balance', behaviours: ['DESK-7'] },
        { id: 'card', title: 'Card', behaviours: [] },
      ],
    },
  });
}

/** What the three readers say about the cell (stage, D8_tool_failure): the space, the t-wise target, the builder. */
function readers(prepared: ReturnType<typeof map>, stageName: string) {
  const stage = prepared.stage as number;
  const deviation = prepared.deviation as number;
  const at = prepared.space.dimensions[stage]?.index.get(stageName) as number;
  const failure = prepared.space.dimensions[deviation]?.index.get('D8_tool_failure') as number;
  // The target is read without the constraints the map derived, which already rule a cell out by themselves.
  const bare = { ...prepared, space: { ...prepared.space, constraints: [] } };
  const ruledOut = impossibleConstraints(bare, flowsOfBehaviour).some(
    (pair) =>
      pair.some(([dimension, value]) => dimension === stage && value === at) &&
      pair.some(([dimension, value]) => dimension === deviation && value === failure),
  );
  const built = coverDraft(prepared, context, 'cover', { deviation: 'D8_tool_failure', stage: stageName });
  return {
    space: prepared.feasibility.allowed([
      [stage, at],
      [deviation, failure],
    ]),
    target: !ruledOut,
    builder: 'draft' in built,
  };
}

describe('a use whose subject is a value of a dimension that is not a behaviour', () => {
  it('is no call of a move: the space, the target and the builder rule the stage out together', () => {
    const prepared = map('persona');
    expect(readers(prepared, 'verify')).toEqual({ space: false, target: false, builder: false });
    expect(readers(prepared, 'help')).toEqual({ space: false, target: false, builder: false });
  });

  it('leaves the flow its own call: the stage the flow calls the gauge at stays a cell in all three', () => {
    for (const kind of ['persona', 'behaviour'] as const)
      expect(readers(map(kind), 'greet'), kind).toEqual({ space: true, target: true, builder: true });
  });

  it('counts only the call of the flow whose path it is: a flow that never calls the gauge keeps no cell of it', () => {
    // The card flow walks the same stages and recovers from the gauge failing, but only the balance flow calls it.
    const prepared = map('persona', (proposal) => {
      proposal.relations?.push({
        kind: 'path',
        id: 'replace',
        flow: 'card',
        stages: ['greet', 'verify', 'help'],
        ...by,
      });
      for (const relation of proposal.relations ?? [])
        if (relation.kind === 'recovery' && relation.class === 'D8_tool_failure') relation.flows.push('card');
    });
    const flow = prepared.space.dimensions.findIndex((entry) => entry.id === 'flow');
    const deviation = prepared.deviation as number;
    const card = prepared.space.dimensions[flow]?.index.get('card') as number;
    const failure = prepared.space.dimensions[deviation]?.index.get('D8_tool_failure') as number;
    const bare = { ...prepared, space: { ...prepared.space, constraints: [] } };
    const ruledOut = impossibleConstraints(bare, flowsOfBehaviour).some(
      (pair) =>
        pair.some(([dimension, value]) => dimension === flow && value === card) &&
        pair.some(([dimension, value]) => dimension === deviation && value === failure),
    );
    expect(ruledOut).toBe(true);
    expect(
      prepared.feasibility.allowed([
        [flow, card],
        [deviation, failure],
      ]),
    ).toBe(false);
  });

  it('is not the flow when its value only shares the flow id', () => {
    // A value of the keeper dimension named like the card flow, with a use of the gauge: not a call of the flow.
    const prepared = map('persona', (proposal) => {
      proposal.relations?.push({
        kind: 'path',
        id: 'replace',
        flow: 'card',
        stages: ['greet', 'verify', 'help'],
        ...by,
      });
      for (const relation of proposal.relations ?? [])
        if (relation.kind === 'recovery' && relation.class === 'D8_tool_failure') relation.flows.push('card');
      proposal.relations?.push({
        kind: 'uses_tool',
        subject: { dimension: 'keeper', value: 'card' },
        tool: 'read_gauge',
        stage: 'greet',
        to: 'verify',
        input: { account: '4' },
        ...by,
      });
      proposal.dimensions
        .find((entry) => entry.id === 'keeper')
        ?.values.push({ id: 'card', title: 'A keeper called card', ...by });
    });
    const flow = prepared.space.dimensions.findIndex((entry) => entry.id === 'flow');
    const deviation = prepared.deviation as number;
    const card = prepared.space.dimensions[flow]?.index.get('card') as number;
    const failure = prepared.space.dimensions[deviation]?.index.get('D8_tool_failure') as number;
    const bare = { ...prepared, space: { ...prepared.space, constraints: [] } };
    const ruledOut = impossibleConstraints(bare, flowsOfBehaviour).some(
      (pair) =>
        pair.some(([dimension, value]) => dimension === flow && value === card) &&
        pair.some(([dimension, value]) => dimension === deviation && value === failure),
    );
    expect(ruledOut).toBe(true);
  });
});
