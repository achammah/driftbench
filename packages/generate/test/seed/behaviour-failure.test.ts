import { describe, expect, it } from 'vitest';
import type { Proposal } from '../../src/extract/proposal';
import { renderDraft } from '../../src/seed/assemble';
import { prepareMap } from '../../src/seed/map';
import { behaviourFailureDraft, coverDraft } from '../../src/seed/seed-drafts';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

const evidence = { source: 'prompt.md', quote: 'Check balance reads the account.' };
const by = { evidence, produced_by: 'code' as const, approved: true };
const context = { seed: 42, t: 2, max: 100 };

// Hand-written input, independent of the validator's generated maps and item bank. The balance flow walks
// greet, verify, help; its move to verify calls lookup. The behaviour CHECK-11 is a read of the account: its
// own turn runs lookup at any stage. CHECK-22 asks for no tool.
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
          { id: 'CHECK-11', title: 'Check the account', ...by },
          { id: 'CHECK-22', title: 'Keep it short', ...by },
        ],
      },
    ],
  });
  proposal.constraints = [];
  proposal.phrases.push(
    { dimension: 'policy', value: 'CHECK-11', text: 'Please read my account out.', lang: 'en', ...by },
    { dimension: 'policy', value: 'CHECK-22', text: 'Keep it short.', lang: 'en', ...by },
  );
  proposal.relations = [
    { kind: 'path', id: 'amount', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    {
      kind: 'uses_tool',
      subject: { dimension: 'flow', value: 'balance' },
      tool: 'lookup',
      stage: 'greet',
      to: 'verify',
      input: { account: '4' },
      ...by,
    },
    ...['greet', 'verify', 'help'].map((stage) => ({
      kind: 'uses_tool' as const,
      subject: { dimension: 'policy', value: 'CHECK-11' },
      tool: 'lookup',
      stage,
      to: stage,
      input: { account: '4' },
      ...by,
    })),
    {
      kind: 'recovery',
      class: 'D8_tool_failure',
      flows: ['balance'],
      tool: 'lookup',
      stage_after: 'pending',
      tools: [{ tool: 'lookup', count: 2 }],
      ...by,
    },
  ];
  change(proposal);
  return prepareMap(proposal, {
    tools: ZED_TOOLS,
    inventory: {
      behaviours: [
        { id: 'CHECK-11', title: 'Check the account', kind: 'conversation' },
        { id: 'CHECK-22', title: 'Keep it short', kind: 'conversation' },
      ],
      flows: [{ id: 'balance', title: 'Balance', behaviours: ['CHECK-11', 'CHECK-22'] }],
    },
  });
}

function records(prepared: ReturnType<typeof map>, draft: Parameters<typeof renderDraft>[1]) {
  const rendered = renderDraft(prepared, draft, { seed: context.seed, mapPath: 'map.yaml' });
  return (
    rendered.spec.metadata as { generated: { blocks: Array<{ cell: Record<string, string> }> } }
  ).generated.blocks.map((block) => block.cell);
}

describe('a tool failure on a turn that asks a behaviour', () => {
  it('is possible at a stage no move calls a tool at, the last included', () => {
    const prepared = map();
    const stage = prepared.stage as number;
    const deviation = prepared.deviation as number;
    const failure = prepared.space.dimensions[deviation]?.index.get('D8_tool_failure') as number;
    for (const name of ['verify', 'help']) {
      const at = prepared.space.dimensions[stage]?.index.get(name) as number;
      expect(
        prepared.feasibility.allowed([
          [stage, at],
          [deviation, failure],
        ]),
        name,
      ).toBe(true);
    }
  });

  it('is built for a stage no move of the walk calls a tool at, with the tool failing on the asking turn', () => {
    const built = coverDraft(map(), context, 'cover', { deviation: 'D8_tool_failure', stage: 'help' });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    const failing = built.draft.blocks.find((block) => block.injection === 'D8_tool_failure');
    expect(failing?.stage).toBe('help');
    expect(failing?.given?.world?.tools?.lookup?.error).toBeDefined();
    expect(failing?.stimulus).toMatchObject({ kind: 'phrase', phrase: { value: 'CHECK-11' } });
    // The turn is said again with the tool answering, and the walk ends there.
    const again = built.draft.blocks.at(-1);
    expect(again?.given?.world?.tools?.lookup?.error).toBeUndefined();
    expect(again?.stage).toBe('help');
  });

  it('keeps the behaviour the cell names, and lets the one that reads stand in', () => {
    const built = coverDraft(map(), context, 'cover', {
      policy: 'CHECK-22',
      deviation: 'D8_tool_failure',
      stage: 'verify',
    });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    const rendered = renderDraft(map(), built.draft, { seed: 42, mapPath: 'map.yaml' });
    expect(rendered.spec.covers).toContain('CHECK-22');
    expect(rendered.spec.covers).not.toContain('CHECK-11');
  });

  it('fails the tool on the asking turn, not on an earlier move that calls it at the same stage', () => {
    const prepared = map((proposal) => {
      proposal.relations = [
        ...(proposal.relations ?? []).filter((relation) => relation.kind !== 'path'),
        { kind: 'path', id: 'again', flow: 'balance', stages: ['greet', 'verify', 'verify', 'help'], ...by },
        {
          kind: 'uses_tool',
          subject: { dimension: 'flow', value: 'balance' },
          tool: 'lookup',
          stage: 'verify',
          to: 'verify',
          input: { account: '4' },
          ...by,
        },
      ];
    });
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const built = behaviourFailureDraft(
        prepared,
        { ...context, seed },
        'cover',
        'verify',
        [],
        prepared.relations.paths,
        'verify',
        undefined,
      );
      if (!('draft' in built)) throw new Error(built.reasons.join('; '));
      const failing = built.draft.blocks.find((block) => block.injection === 'D8_tool_failure');
      expect(failing?.stimulus, `seed ${seed}`).toMatchObject({
        kind: 'phrase',
        phrase: { value: 'CHECK-11' },
      });
    }
  });

  it('is not possible at the start, where no earlier turn has run a tool', () => {
    const prepared = map((proposal) => {
      proposal.relations = proposal.relations?.filter(
        (relation) => relation.kind !== 'uses_tool' || relation.subject.dimension !== 'flow',
      );
    });
    const stage = prepared.stage as number;
    const deviation = prepared.deviation as number;
    const failure = prepared.space.dimensions[deviation]?.index.get('D8_tool_failure') as number;
    const allowed = (name: string) =>
      prepared.feasibility.allowed([
        [stage, prepared.space.dimensions[stage]?.index.get(name) as number],
        [deviation, failure],
      ]);
    expect(allowed('greet')).toBe(false);
    expect(allowed('verify')).toBe(true);
  });

  it('writes the failure and its retry in the cell of the scenario, and the stand-in behaviour nowhere', () => {
    const prepared = map();
    const built = coverDraft(prepared, context, 'cover', {
      policy: 'CHECK-22',
      deviation: 'D8_tool_failure',
      stage: 'verify',
    });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    const cells = records(prepared, built.draft);
    const failing = built.draft.blocks.findIndex((block) => block.injection === 'D8_tool_failure');
    expect(cells[failing]?.deviation).toBe('D8_tool_failure');
    expect(cells[failing + 1]?.deviation).toBe('D8_tool_failure');
    expect(cells.some((cell) => cell.policy === 'CHECK-11')).toBe(false);
  });

  it('keeps the end state of a walk when the failing turn is said after its last move', () => {
    const prepared = map((proposal) => {
      for (const relation of proposal.relations ?? [])
        if (relation.kind === 'path') relation.end_state = { source: 'tool:ship', mode: 'exact', expect: {} };
    });
    const last = coverDraft(prepared, context, 'cover', { deviation: 'D8_tool_failure', stage: 'help' });
    const early = coverDraft(prepared, context, 'cover', { deviation: 'D8_tool_failure', stage: 'verify' });
    if (!('draft' in last) || !('draft' in early)) throw new Error('handwritten cell did not build');
    expect(last.draft.end_state).toBeDefined();
    expect(early.draft.end_state).toBeUndefined();
  });

  it('stays out of a cell a written constraint forbids', () => {
    const prepared = map((proposal) => {
      proposal.constraints.push({
        forbid: { stage: 'help', deviation: 'D8_tool_failure' },
        reason: 'a failure on the last stage is not tested',
        ...by,
      });
    });
    const forbidden = coverDraft(prepared, context, 'cover', { deviation: 'D8_tool_failure', stage: 'help' });
    expect('draft' in forbidden).toBe(false);
    // Without a stage, any other stage the map allows takes the probe.
    for (const seed of [1, 2, 3, 4, 5]) {
      const free = coverDraft(prepared, { ...context, seed }, 'cover', { deviation: 'D8_tool_failure' });
      if (!('draft' in free)) throw new Error(free.reasons.join('; '));
      const failing = free.draft.blocks.find((block) => block.injection === 'D8_tool_failure');
      expect(failing?.stage, `seed ${seed}`).not.toBe('help');
    }
  });

  it('leaves a side-effecting tool alone: a failure of the write is not a staying read', () => {
    const prepared = map((proposal) => {
      for (const relation of proposal.relations ?? [])
        if (relation.kind === 'path')
          relation.end_state = { source: 'tool:lookup', mode: 'exact', expect: {} };
    });
    const built = coverDraft(prepared, context, 'cover', { deviation: 'D8_tool_failure', stage: 'help' });
    expect('draft' in built).toBe(false);
  });

  it('is not built when no behaviour of the flow reads a recovered tool', () => {
    const prepared = map((proposal) => {
      proposal.relations = proposal.relations?.filter(
        (relation) => relation.kind !== 'uses_tool' || relation.subject.dimension === 'flow',
      );
    });
    const built = coverDraft(prepared, context, 'cover', { deviation: 'D8_tool_failure', stage: 'help' });
    expect('draft' in built).toBe(false);
  });
});
