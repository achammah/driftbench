import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import { renderDraft } from '../../src/seed/assemble';
import { prepareMap } from '../../src/seed/map';
import { coverDraft } from '../../src/seed/seed-drafts';
import { zedProposal } from '../enumerate/support';

// Hand-written mixed map: balance has a conversational path; card has a task family whose generated
// inputs are absent. Card's behaviour must be reported, never borrowed by the balance flow.
const proposal = zedProposal();
const kept: Record<string, string[]> = {
  stage: ['greet', 'verify', 'help', 'lost'],
  stage_transition: ['greet-to-verify', 'verify-to-help'],
  flow: ['balance', 'card'],
  deviation: ['D1_off_topic'],
  channel: ['chat', 'email'],
  user: ['customer', 'staff'],
};
proposal.dimensions = proposal.dimensions.filter((dimension) => kept[dimension.id] !== undefined);
for (const dimension of proposal.dimensions)
  dimension.values = dimension.values.filter((value) => kept[dimension.id]?.includes(value.id));
proposal.phrases = proposal.phrases.filter((phrase) => kept[phrase.dimension]?.includes(phrase.value));
const by = {
  evidence: {
    source: 'prompt.md',
    quote: 'Greet, verify, help; return to the pending stage after an aside.',
  },
  produced_by: 'code' as const,
  approved: true,
};
proposal.relations = [
  { kind: 'path', id: 'balance-full', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
  { kind: 'recovery', class: 'D1_off_topic', flows: ['balance'], stage_after: 'pending', ...by },
  { kind: 'task_family', flow: 'card', family: '../families/cards', stages: ['lost'], ...by },
];
proposal.dimensions.push({
  id: 'policy',
  title: 'Policies',
  kind: 'behaviour',
  role: 'axis',
  ...by,
  values: [
    { id: 'CHECK-11', title: 'Check an amount', ...by },
    { id: 'CHECK-22', title: 'Replace a card', ...by },
  ],
});
proposal.constraints = [
  { forbid: { policy: 'CHECK-11', flow: 'card' }, reason: 'Only balance checks amounts', ...by },
  { forbid: { policy: 'CHECK-22', flow: 'balance' }, reason: 'Only card replaces cards', ...by },
];
const inventory = {
  behaviours: [
    { id: 'CHECK-11', title: 'Check an amount', kind: 'conversation' as const },
    { id: 'CHECK-22', title: 'Replace a card', kind: 'task' as const },
  ],
  flows: [
    { id: 'balance', title: 'Balance', behaviours: ['CHECK-11'] },
    { id: 'card', title: 'Card', behaviours: ['CHECK-22'] },
  ],
};
const prepared = prepareMap(proposal, { inventory });
const suite = generateSuite(prepared, { mapPath: '../map.yaml', t: 3, seed: 1 });

describe('a cell that holds the start stage', () => {
  it('reports every unplaceable behaviour with a reason and never assigns it to another flow', () => {
    const unplaceable = inventory.behaviours.filter(
      (behaviour) =>
        !prepared.relations.paths.some((path) =>
          inventory.flows.some((flow) => flow.id === path.flow && flow.behaviours.includes(behaviour.id)),
        ),
    );
    expect(unplaceable.map((behaviour) => behaviour.id)).toEqual(['CHECK-22']);
    for (const behaviour of unplaceable) {
      const unbuilt = suite.report.cover.unbuilt.filter((row) => row.cell.policy === behaviour.id);
      expect(unbuilt.length).toBeGreaterThan(0);
      for (const row of unbuilt) {
        expect(row.reasons.length).toBeGreaterThan(0);
        expect(row.reasons.join(' ')).toContain(behaviour.id);
      }
      expect(suite.complete.some((spec) => spec.covers?.includes(behaviour.id))).toBe(false);
    }
    for (const spec of suite.complete) {
      const generated = spec.metadata?.generated as { cell: Record<string, string> } | undefined;
      expect(generated, spec.id).toBeDefined();
      const flow = inventory.flows.find((flow) => flow.id === generated?.cell.flow);
      for (const behaviour of inventory.behaviours.filter((behaviour) => spec.covers?.includes(behaviour.id)))
        expect(flow?.behaviours, spec.id).toContain(behaviour.id);
    }
  });

  it('still builds and covers a behaviour whose owning flow has a path', () => {
    const built = coverDraft(prepared, { seed: 1, t: 3, max: 100 }, 'placeable', {
      policy: 'CHECK-11',
      stage: 'verify',
    });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    expect(built.path.flow).toBe('balance');
    expect(renderDraft(prepared, built.draft, { seed: 1, mapPath: '../map.yaml' }).noThen).toEqual([]);
    expect(suite.complete.some((spec) => spec.covers?.includes('CHECK-11'))).toBe(true);
  });

  it('is covered by a clean walk that declares the first-turn class as its perturbation', () => {
    // A class said on the first turn whose recovery stays there has no Then an idle reply fails, so no
    // block holds it. The cover seeder declares that event as a perturbation of a clean walk.
    // Other seeders may already cover the opening cell. Exercise cover's pending-recovery route directly.
    const built = coverDraft(prepared, { seed: 1, t: 3, max: 100 }, 'opening', {
      flow: 'balance',
      stage: 'greet',
      deviation: 'D1_off_topic',
    });
    if (!('draft' in built)) throw new Error(built.reasons.join('; '));
    const rendered = renderDraft(prepared, built.draft, { seed: 1, mapPath: '../map.yaml' });
    expect(rendered.noThen).toEqual([]);
    expect(rendered.placeholders).toEqual([]);
    expect(rendered.reasons).toEqual([]);
    const first = built.draft.perturbations?.find((entry) => entry.inject_at === 0);
    expect(first?.expect?.stage).toBe('greet');
    expect(built.draft.blocks.some((block) => block.injection !== undefined)).toBe(false);
  }, 60_000);
});
