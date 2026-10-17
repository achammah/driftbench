import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Inventory } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import type { ProposalRelation } from '../../src/extract/proposal';
import { prepareMap } from '../../src/seed/map';
import { phraseDrafts, type UnsaidPhrase } from '../../src/seed/phrase-seeder';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

const by = {
  evidence: { source: 'prompt.md', quote: 'Card checks belong to the short card desk conversation.' },
  produced_by: 'code' as const,
  approved: true,
};
const texts = {
  'S-101': 'Please check the card desk.',
  'S-202': 'Please review the closed desk.',
  'S-303': 'Please check the card desk again.',
};

function desk(extraCardPhrase = false) {
  const ids = extraCardPhrase ? Object.keys(texts) : ['S-101', 'S-202'];
  const proposal = zedProposal({
    extra: [
      {
        id: 'behaviour',
        title: 'Desk checks',
        kind: 'behaviour',
        role: 'axis',
        ...by,
        values: ids.map((id) => ({ id, title: id, ...by })),
      },
    ],
  });
  proposal.phrases = proposal.phrases.filter((phrase) => phrase.dimension === 'stage_transition');
  for (const value of ids)
    proposal.phrases.push({
      dimension: 'behaviour',
      value,
      text: texts[value as keyof typeof texts],
      lang: 'en',
      produced_by: 'code',
      approved: true,
    });
  const relations: ProposalRelation[] = [
    { kind: 'path', id: 'long-balance', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    { kind: 'path', id: 'short-card', flow: 'card', stages: ['greet', 'verify'], ...by },
  ];
  proposal.relations = relations;
  const inventory = Inventory.parse({
    behaviours: ids.map((id) => ({ id, title: id })),
    flows: [
      { id: 'balance', title: 'Balance desk', behaviours: [] },
      { id: 'card', title: 'Card desk', behaviours: extraCardPhrase ? ['S-101', 'S-303'] : ['S-101'] },
      { id: 'closed-desk', title: 'Closed desk', behaviours: ['S-202'] },
    ],
  });
  return { proposal, inventory };
}

function run(extraCardPhrase = false, seed = 1013) {
  const { proposal, inventory } = desk(extraCardPhrase);
  const prepared = prepareMap(proposal, { tools: ZED_TOOLS, inventory });
  const unsaid: UnsaidPhrase[] = [];
  const drafts = phraseDrafts(prepared, { seed, t: 2, max: 100 }, new Set(), 0, unsaid);
  return { prepared, drafts, unsaid };
}

describe('a behaviour phrase stays on a path of its owning flow', () => {
  it.each([1013, 2203, 4409])(
    'uses the short owning path instead of a longer unrelated path, seed %i',
    (seed) => {
      const { prepared, drafts } = run(false, seed);
      const draft = drafts.find((entry) => entry.title.startsWith('Phrase of behaviour=S-101:'));
      expect(draft?.path).toBe('short-card');
      expect(draft?.blocks.at(-1)?.stage).toBe('verify');
      for (const block of draft?.blocks ?? [])
        expect(prepared.relations.paths.find((path) => path.id === draft?.path)?.stages).toContain(
          block.stage,
        );
    },
  );

  it('reports an owning flow without a path instead of borrowing another flow', () => {
    const { drafts, unsaid } = run();
    expect(drafts.some((draft) => draft.title.startsWith('Phrase of behaviour=S-202:'))).toBe(false);
    expect(unsaid).toContainEqual(
      expect.objectContaining({
        value: 'S-202',
        text: texts['S-202'],
        reasons: expect.arrayContaining([expect.stringContaining('owning flow')]),
      }),
    );
  });

  it('does not move a sibling into an unrelated flow to free an owning slot', () => {
    const { drafts, unsaid } = run(true);
    expect(drafts.filter((draft) => draft.title.startsWith('Phrase of behaviour='))).toHaveLength(1);
    expect(drafts[0]?.path).toBe('short-card');
    expect(unsaid.map((entry) => entry.value).sort()).toEqual(['S-202', 'S-303']);
  });

  it('reports a behaviour no flow lists', () => {
    const { proposal, inventory } = desk();
    for (const flow of inventory.flows) flow.behaviours = [];
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS, inventory });
    const unsaid: UnsaidPhrase[] = [];
    expect(phraseDrafts(prepared, { seed: 1061, t: 2, max: 100 }, new Set(), 0, unsaid)).toEqual([]);
    expect(unsaid.map((entry) => entry.value).sort()).toEqual(['S-101', 'S-202']);
    expect(unsaid.every((entry) => entry.reasons.length > 0)).toBe(true);
  });

  it('uses explicit path behaviour membership when no inventory is supplied', () => {
    const { proposal } = desk();
    for (const path of proposal.relations ?? [])
      if (path.kind === 'path') path.behaviours = path.flow === 'card' ? ['S-101'] : [];
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS });
    const unsaid: UnsaidPhrase[] = [];
    const drafts = phraseDrafts(prepared, { seed: 1047, t: 2, max: 100 }, new Set(), 0, unsaid);
    expect(drafts.map((draft) => draft.path)).toEqual(['short-card']);
    expect(unsaid.map((entry) => entry.value)).toEqual(['S-202']);
  });
});

describe('independent owned-behaviour accounting', () => {
  it('places a newly planted owned phrase in its usable owning flow', () => {
    const { proposal, inventory } = desk();
    const id = 'R-404';
    const text = 'Inspect the violet archive entry.';
    const behaviour = proposal.dimensions.find((d) => d.id === 'behaviour');
    if (!behaviour) throw new Error('Desk fixture has no behaviour dimension');
    behaviour.values.push({ id, title: 'Violet archive', ...by });
    proposal.phrases.push({
      dimension: 'behaviour',
      value: id,
      text,
      lang: 'en',
      produced_by: 'code',
      approved: true,
    });
    inventory.behaviours.push({ id, title: 'Violet archive', kind: 'conversation' });
    const balance = inventory.flows.find((f) => f.id === 'balance');
    if (!balance) throw new Error('Desk fixture has no balance flow');
    balance.behaviours.push(id);
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS, inventory });
    const unsaid: UnsaidPhrase[] = [];
    const drafts = phraseDrafts(prepared, { seed: 701137, t: 2, max: 100 }, new Set(), 0, unsaid);
    const placed = drafts.filter((d) =>
      d.blocks.some((b) => b.stimulus.kind === 'phrase' && b.stimulus.phrase.text === text),
    );
    expect(placed).toHaveLength(1);
    expect(placed[0]?.path).toBe('long-balance');
    expect(unsaid.some((g) => g.value === id)).toBe(false);
  });
  it('reports an owned phrase when no approved conversation paths exist', () => {
    const { proposal, inventory } = desk();
    proposal.relations = [];
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS, inventory });
    const unsaid: UnsaidPhrase[] = [];
    const drafts = phraseDrafts(prepared, { seed: 711149, t: 2, max: 100 }, new Set(), 0, unsaid);
    expect(drafts).toEqual([]);
    const suite = generateSuite(prepared, { seed: 711149, t: 2, mapPath: '../owned-map.yaml' });

    expect(unsaid).toContainEqual(
      expect.objectContaining({
        value: 'S-101',
        text: texts['S-101'],
        reasons: ['no approved path walks an owning flow for behaviour=S-101'],
      }),
    );
    expect(suite.report.no_phrase).toContainEqual(
      expect.objectContaining({
        value: 'S-101',
        unsaid: expect.arrayContaining([expect.objectContaining({ text: texts['S-101'] })]),
      }),
    );
  });
});
it('reports the owned phrase from a quoted zero-path map through the public map loader', async (context) => {
  const { proposal, inventory } = desk();
  for (const d of proposal.dimensions) delete (d as unknown as { evidence?: unknown }).evidence;
  proposal.relations = [];
  proposal.sources.push({ kind: 'inventory', path: 'inventory.yaml' });
  const dir = await mkdtemp(join(tmpdir(), 'phrase-no-path-'));
  context.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const quotes = new Set<string>();
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if ('quote' in v && typeof v.quote === 'string') quotes.add(v.quote);
    for (const x of Object.values(v)) visit(x);
  };
  visit(proposal);
  await writeFile(resolve(dir, 'prompt.md'), [...quotes].join('\n'));
  await writeFile(resolve(dir, 'inventory.yaml'), JSON.stringify(inventory));
  await writeFile(resolve(dir, 'map.yaml'), JSON.stringify(proposal));
  const loaded = await loadApprovedMap(resolve(dir, 'map.yaml'));
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const suite = generateSuite(loaded.prepared, { seed: 711149, t: 2, mapPath: '../owned-map.yaml' });
  const said = suite.complete.some((s) =>
    s.blocks.some((b) => 'user' in b.when && b.when.user === texts['S-101']),
  );
  const report = suite.report.no_phrase.find((g) => g.value === 'S-101');
  expect(said || report !== undefined).toBe(true);
  expect(report?.unsaid).toContainEqual({
    text: texts['S-101'],
    reasons: ['no approved path walks an owning flow for behaviour=S-101'],
  });
});
