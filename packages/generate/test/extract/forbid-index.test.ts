import type { Inventory } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { derivedConstraints } from '../../src/extract/derive';
import { ForbidIndex } from '../../src/extract/forbid-index';
import type { Proposal } from '../../src/extract/proposal';

/** The scan the index replaces: the positions of every forbid whose picks the cell all holds. */
const scan = (forbids: Record<string, string>[], cell: Record<string, string>) =>
  forbids.flatMap((forbid, at) =>
    Object.entries(forbid).every(([dimension, value]) => cell[dimension] === value) ? [at] : [],
  );

describe('the forbid index', () => {
  const forbids: Record<string, string>[] = [
    { shelf: 'poetry', desk: 'front' },
    { desk: 'front', shelf: 'poetry' },
    { shelf: 'maps', desk: 'back', hour: 'late' },
    { hour: 'late' },
    {},
    { constructor: 'open' },
    { shelf: 'maps', desk: 'back' },
  ];
  const index = new ForbidIndex();
  for (const forbid of forbids) index.add(forbid);

  it.each([
    [{ shelf: 'poetry', desk: 'front' }],
    [{ shelf: 'maps', desk: 'back', hour: 'late' }],
    [{ shelf: 'maps', desk: 'back', hour: 'early' }],
    [{ hour: 'late', desk: 'front', shelf: 'poetry' }],
    [{ shelf: 'poetry' }],
    [{ constructor: 'open', shelf: 'maps' }],
    [{}],
  ])('finds the forbids the scan finds, in list order, in %j', (cell: Record<string, string>) => {
    expect(index.within(cell)).toEqual(scan(forbids, cell));
    expect(index.holds(cell)).toBe(scan(forbids, cell).length > 0);
  });

  it('keeps every copy of a duplicate forbid, as the scan does, and so every reason it carries', () => {
    const twice = new ForbidIndex();
    twice.add({ desk: 'front', shelf: 'poetry' });
    twice.add({ hour: 'late' });
    twice.add({ shelf: 'poetry', desk: 'front' });
    expect(twice.within({ shelf: 'poetry', desk: 'front', hour: 'early' })).toEqual([0, 2]);
  });

  it('holds a cell that only the last set of dimensions added forbids, with no empty forbid to hide a miss', () => {
    const sets = new ForbidIndex();
    sets.add({ hour: 'late' });
    sets.add({ shelf: 'maps', desk: 'back' });
    expect(sets.holds({ desk: 'back', shelf: 'maps' })).toBe(true);
    expect(sets.holds({ hour: 'late' })).toBe(true);
    expect(sets.holds({ hour: 'early', shelf: 'maps', desk: 'front' })).toBe(false);
  });

  it('does not take a key a cell only inherits for one it holds', () => {
    const only = new ForbidIndex();
    only.add({ constructor: 'open' });
    expect(only.holds({ shelf: 'maps' })).toBe(false);
    expect(only.within({ shelf: 'maps' })).toEqual([]);
  });
});

/**
 * A library desk with `count` behaviours, each owned by one of two flows. Lending passes every stage; returning
 * skips the answer stage. The pair and triple constraints the relations imply grow with the behaviours.
 */
function library(count: number): {
  proposal: Proposal;
  axes: Array<{ id: string; kind: string; values: string[] }>;
  inventory: Inventory;
} {
  const evidence = { source: 'desk.md', quote: 'Greet the reader, ask, answer, close.' };
  const by = { evidence, produced_by: 'model' as const, approved: true };
  const behaviours = Array.from({ length: count }, (_, index) => `B-${index + 1}`);
  const lend = behaviours.filter((_, index) => index % 2 === 0);
  const back = behaviours.filter((_, index) => index % 2 === 1);
  const dimension = (id: string, kind: Proposal['dimensions'][number]['kind'], ids: string[]) => ({
    id,
    title: id,
    kind,
    role: 'axis' as const,
    approved: true,
    produced_by: 'code' as const,
    values: ids.map((value) => ({ id: value, title: value, evidence, produced_by: 'code' as const })),
  });
  const stages = ['greet', 'ask', 'answer', 'close'];
  const classes = ['D1_off_topic', 'D5_language_switch'];
  const proposal = {
    version: 1,
    agent: 'library-desk',
    produced_by: { family: 'unit', model: 'by hand', at: '2026-10-17T00:00:00.000Z' },
    sources: [{ kind: 'prompt', path: 'desk.md' }],
    dimensions: [
      dimension('behaviour', 'behaviour', behaviours),
      dimension('flow', 'behaviour', ['lend', 'return']),
      dimension('stage', 'stage', stages),
      dimension('deviation', 'deviation', classes),
    ],
    constraints: [],
    phrases: [
      { dimension: 'deviation', value: 'D1_off_topic', text: 'Is the cafe open?', lang: 'en', ...by },
      {
        dimension: 'deviation',
        value: 'D5_language_switch',
        text: 'Bonjour, vous avez des cartes ?',
        lang: 'fr',
        ...by,
      },
    ],
    relations: [
      { kind: 'path', id: 'lend-book', flow: 'lend', stages, behaviours: lend, ...by },
      {
        kind: 'path',
        id: 'return-book',
        flow: 'return',
        stages: ['greet', 'ask', 'close'],
        behaviours: back,
        ...by,
      },
      {
        kind: 'recovery',
        class: 'D1_off_topic',
        flows: ['lend', 'return'],
        at: ['ask'],
        stage_after: 'pending',
        ...by,
      },
      { kind: 'recovery', class: 'D5_language_switch', flows: ['lend'], stage_after: 'pending', ...by },
    ],
  } as unknown as Proposal;
  const inventory = {
    flows: [
      { id: 'lend', behaviours: lend },
      { id: 'return', behaviours: back },
    ],
  } as unknown as Inventory;
  const axes = proposal.dimensions.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    values: entry.values.map((value) => value.id),
  }));
  return { proposal, axes, inventory };
}

describe('the constraints the relations imply, at many behaviours', () => {
  it('derives the same constraints from a hand-written map at 40 and at 400 behaviours, in linear time', () => {
    const cpu = () => {
      const used = process.cpuUsage();
      return (used.user + used.system) / 1000;
    };
    const run = (count: number) => {
      const { proposal, axes, inventory } = library(count);
      const started = cpu();
      const derived = derivedConstraints(proposal, axes, inventory);
      return { derived, ms: cpu() - started };
    };
    run(40);
    const small = run(40);
    const large = run(400);
    // Every behaviour of the returning flow is forbidden at the answer stage it never reaches.
    expect(large.derived).toContainEqual(
      expect.objectContaining({ forbid: { behaviour: 'B-2', stage: 'answer' } }),
    );
    expect(large.derived.length).toBeGreaterThan(10 * small.derived.length * 0.9);
    // Ten times the behaviours: linear work is ten times; a scan of every earlier constraint per cell is a hundred.
    expect(large.ms / Math.max(small.ms, 1)).toBeLessThan(30);
  });
});
