import { describe, expect, it } from 'vitest';
import { type Change, parseChangeManifest, type RadiusSpec, radiusOf, type Spec } from '../../src/index';

/** Fictional data only. A generated conversation of three blocks, with the cells a generator records. */
const order: Spec = {
  id: 'order',
  kind: 'conversation',
  stages: ['needs', 'offer', 'recap'],
  criteria: [{ name: 'plain_language', rubric: 'Is the reply plain?' }] as Spec['criteria'],
  blocks: [
    {
      id: 'b1',
      when: { user: 'I need a plan.' },
      expect: {
        stage: 'offer',
        tools: [{ label: 'catalog.search', count: 1 }],
        criteria: ['plain_language'],
      },
    },
    {
      id: 'b2',
      when: { user: 'The large one.' },
      expect: { stage: 'recap', tools: [{ label: 'order.create', count: 0 }], must: ['CONFIRM'] },
    },
    {
      id: 'b3',
      when: { user: 'CONFIRM' },
      given: { world: { tools: { 'order.create': { result: { order_id: 'ORD-1' } } } } },
      expect: { tools: [{ label: 'order.create', count: 1, input: { plan_id: 'plan-l' } }] },
    },
  ],
  rules: { max_calls: { 'order.create': 1 }, lang_stable: true },
  end_state: { source: 'tool:order.create', expect: { plan_id: 'plan-l' } },
  perturbations: [
    {
      id: 'p-loose',
      class: 'D4_loose_confirmation',
      inject_at: 2,
      user: 'ok sure',
      expect: { tools: [{ label: 'order.create', count: 0 }] },
      recovery: { within_blocks: 0, stage_after: 'recap' },
    },
  ],
  metadata: {
    generated: {
      path: 'new-order',
      cell: { flow: 'order', user_type: 'new-customer' },
      blocks: [
        { block: 'b1', cell: { stage: 'needs' }, phrase: { dimension: 'plan_choice', value: 'asks' } },
        { block: 'b2', cell: { stage: 'offer', plan_choice: 'names-one' } },
        { block: 'b3', cell: { stage: 'recap' } },
      ],
    },
  },
};

/** An estate test: it names the atoms of the prompt it covers. */
const estate: Spec = {
  id: 'estate-tone',
  kind: 'conversation',
  blocks: [{ id: 'b1', when: { user: 'Hello' }, expect: { must: ['Acme'] } }],
  metadata: { estate: { atoms: ['a-tone'] } },
};

/** A hand-written spec: nothing says what it depends on beyond its Then. */
const hand: Spec = {
  id: 'hand',
  kind: 'conversation',
  blocks: [
    { id: 'h1', when: { user: 'Hi' }, expect: { must: ['Hello'] } },
    { id: 'h2', when: { user: 'Bye' }, expect: { must: ['Goodbye'] } },
  ],
};

const suite: RadiusSpec[] = [order, estate, hand].map((spec) => ({ spec, hash: `hash-${spec.id}` }));
const states = (changes: Change[], mode: 'F' | 'T' | 'P' = 'F', specs = suite) => {
  const radius = radiusOf(specs, { from: 'v1', to: 'v2', changes }, { modes: [mode] });
  return {
    radius,
    of: (id: string) =>
      radius.specs.find((spec) => spec.specId === id)?.blocks.map((block) => block.state[mode]),
  };
};
const generated = [suite[0] as RadiusSpec];

describe('radiusOf: the direct mapping per kind', () => {
  it('stage: the block that expects it and the block whose cell names it, then every block after', () => {
    expect(states([{ kind: 'stage', id: 'recap' }], 'F', generated).of('order')).toEqual([
      'out',
      'direct',
      'direct',
    ]);
    expect(states([{ kind: 'stage', id: 'needs' }], 'F', generated).of('order')).toEqual([
      'direct',
      'forward',
      'forward',
    ]);
  });

  it('tool: the part narrows the blocks, and no part reads a count of 0 too', () => {
    const tool = (id: string, part?: Change['part']) =>
      states([{ kind: 'tool', id, ...(part ? { part } : {}) }], 'T', generated).of('order');
    // catalog.search has no cap: only the block that calls it reads its input.
    expect(tool('catalog.search', 'input')).toEqual(['direct', 'out', 'out']);
    // order.create is capped by max_calls on every block, so an input change reads them all.
    expect(tool('order.create', 'input')).toEqual(['direct', 'direct', 'direct']);
    // Its result: the block that calls it, forces it and ends on it. The count 0 block reads no result.
    expect(tool('order.create', 'result')).toEqual(['out', 'out', 'direct']);
    expect(tool('catalog.search')).toEqual(['direct', 'out', 'out']);
  });

  it('rule: states at a stage, a path, a spec rule, and the reply language as the whole suite', () => {
    expect(states([{ kind: 'rule', id: 'states@recap' }], 'T', generated).of('order')).toEqual([
      'out',
      'direct',
      'out',
    ]);
    expect(states([{ kind: 'rule', id: 'path:new-order' }], 'T', generated).of('order')).toEqual([
      'direct',
      'direct',
      'direct',
    ]);
    expect(states([{ kind: 'rule', id: 'lang_stable' }], 'T', generated).of('order')).toEqual([
      'direct',
      'direct',
      'direct',
    ]);
    expect(states([{ kind: 'rule', id: 'uses_tool:catalog.search' }], 'T', generated).of('order')).toEqual([
      'direct',
      'out',
      'out',
    ]);
    expect(states([{ kind: 'rule', id: 'reply_language' }]).radius.whole?.reason).toBe(
      'the reply language rule holds on every block',
    );
  });

  it('map: the cell of the spec, the cell of the block, and the phrase of the When', () => {
    const map = (id: string) => states([{ kind: 'map', id }], 'T', generated).of('order');
    expect(map('flow=order')).toEqual(['direct', 'direct', 'direct']);
    expect(map('plan_choice=names-one')).toEqual(['out', 'direct', 'out']);
    expect(map('plan_choice=asks')).toEqual(['direct', 'out', 'out']);
    expect(states([{ kind: 'map', id: 'plan_choice' }]).radius.whole?.reason).toBe(
      'a map change is written dimension=value',
    );
  });

  it('fixture: a literal the When, the expected input, the Given or the end state holds', () => {
    expect(states([{ kind: 'fixture', id: 'plan-l' }], 'T', generated).of('order')).toEqual([
      'out',
      'out',
      'direct',
    ]);
    expect(states([{ kind: 'fixture', id: 'ORD-1' }], 'T', generated).of('order')).toEqual([
      'out',
      'out',
      'direct',
    ]);
  });

  it('criterion: the blocks that name it; a criterion no block names changes no block', () => {
    expect(states([{ kind: 'criterion', id: 'plain_language' }], 'T', generated).of('order')).toEqual([
      'direct',
      'out',
      'out',
    ]);
    const none = states([{ kind: 'criterion', id: 'never_named' }], 'T', generated);
    expect(none.radius.whole).toBeNull();
    expect(none.of('order')).toEqual(['out', 'out', 'out']);
  });

  it('prompt: the specs that name the atom, and every block that names no atoms', () => {
    const { radius, of } = states([{ kind: 'prompt', id: 'a-tone' }], 'T');
    expect(of('estate-tone')).toEqual(['direct']);
    expect(of('order')).toEqual(['direct', 'direct', 'direct']);
    expect(radius.specs[0]?.blocks[0]?.why).toEqual(['prompt:a-tone:unknown-atoms']);
    expect(states([{ kind: 'prompt', id: 'a-unknown' }]).radius.whole?.reason).toBe(
      'no block declares a dependency on it',
    );
    expect(states([{ kind: 'prompt', global: true }]).radius.whole?.reason).toBe(
      'the change is declared global',
    );
  });
});

describe('radiusOf: the conservative rule', () => {
  it('puts a block with unknown dependencies in every radius, with the reason', () => {
    const { radius, of } = states([{ kind: 'tool', id: 'catalog.search', part: 'input' }], 'T');
    expect(of('hand')).toEqual(['direct', 'direct']);
    expect(radius.specs[2]?.blocks[0]?.why).toEqual(['unknown-deps']);
    expect(radius.totals.T).toMatchObject({ unknown: 2, in: 3, total: 6 });
    // The estate test names its atoms, so it is not unknown, and this change leaves it out.
    expect(of('estate-tone')).toEqual(['out']);
  });

  it('makes the whole suite of a kind it cannot map, a model, an agent, a change with no id', () => {
    for (const change of [
      { kind: 'weather' },
      { kind: 'model' },
      { kind: 'agent' },
      { kind: 'stage' },
      { kind: 'tool' },
    ]) {
      const { radius } = states([change]);
      expect(radius.whole, change.kind).not.toBeNull();
      expect(radius.totals.F).toMatchObject({ in: 6, total: 6, cells: { in: 3, total: 3 } });
    }
  });

  it('keeps the first reason when several changes are the whole suite, and keeps every block in', () => {
    const { radius } = states([{ kind: 'stage', id: 'recap' }, { kind: 'model' }]);
    expect(radius.whole).toEqual({
      change: 'model',
      reason: 'a model or setting change can affect every block',
    });
    expect(radius.specs[0]?.blocks.every((block) => block.why[0] === 'whole:model')).toBe(true);
  });

  it('an identity manifest changes nothing; an empty one between two versions is the whole suite', () => {
    const same = radiusOf(suite, { from: 'v1', to: 'v1', changes: [] });
    expect(same.whole).toBeNull();
    expect(same.totals.F?.in).toBe(0);
    const empty = radiusOf(suite, { from: 'v1', to: 'v2', changes: [] });
    expect(empty.whole?.reason).toBe('the manifest lists no change between two different versions');
  });

  it('is the union over the changes of the manifest', () => {
    const { of } = states(
      [
        { kind: 'tool', id: 'catalog.search', part: 'input' },
        { kind: 'fixture', id: 'ORD-1' },
      ],
      'T',
      generated,
    );
    expect(of('order')).toEqual(['direct', 'out', 'direct']);
  });
});

describe('radiusOf: the unit and the modes', () => {
  it('counts a cell in when one of its blocks is, and what a rerun of whole cells sends', () => {
    const { radius } = states([{ kind: 'fixture', id: 'ORD-1' }], 'F', suite);
    // The hand-written spec is unknown, so two cells are in: 3 blocks and 2 blocks are sent, 1 saved.
    expect(radius.totals.F).toMatchObject({
      direct: 3,
      forward: 0,
      cells: { in: 2, total: 3 },
      sent: 5,
      total: 6,
    });
  });

  it('mode P: one cell per perturbation, in when the injected block reads the change', () => {
    const { radius, of } = states([{ kind: 'deviation', id: 'D4' }], 'P', generated);
    expect(radius.whole).toBeNull();
    expect(radius.specs[0]?.cells).toEqual([
      { mode: 'P', perturbationId: 'p-loose', in: true, why: ['deviation:D4'] },
    ]);
    // The deviation goes in before block 2: that block and every later one inherit it.
    expect(of('order')).toEqual(['out', 'out', 'forward']);
    // A free-running cell injects nothing, so the same change reaches no block of it: the radius is empty.
    const free = states([{ kind: 'deviation', id: 'D4' }], 'F', generated);
    expect(free.radius.whole).toBeNull();
    expect(free.of('order')).toEqual(['out', 'out', 'out']);
  });

  it('does not score a block a gate rejected, and still runs it with its spec', () => {
    const gated: Spec = {
      ...order,
      metadata: { ...order.metadata, gate: { blocks: [{ block: 'b1', status: 'rejected' }] } },
    };
    const { radius } = states([{ kind: 'stage', id: 'needs' }], 'F', [{ spec: gated, hash: 'h' }]);
    expect(radius.specs[0]?.blocks.map((block) => block.scored)).toEqual([false, true, true]);
    expect(radius.totals.F).toMatchObject({ total: 2, direct: 0, forward: 2, in: 2, sent: 2 });
  });
});

describe('parseChangeManifest', () => {
  it('accepts a manifest and names it by its content hash', () => {
    const parsed = parseChangeManifest({ from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: 'recap' }] });
    expect(parsed.ok && parsed.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('refuses a missing version, an unknown field and an unknown tool part', () => {
    expect(parseChangeManifest({ from: 'v1', changes: [] }).ok).toBe(false);
    expect(
      parseChangeManifest({ from: 'v1', to: 'v2', changes: [{ kind: 'stage', stage: 'recap' }] }).ok,
    ).toBe(false);
    expect(
      parseChangeManifest({ from: 'v1', to: 'v2', changes: [{ kind: 'tool', id: 'x', part: 'schema' }] }).ok,
    ).toBe(false);
  });
});

describe('the radius of a spec with parent links', () => {
  // Two trees, listed in a shuffled order: a tool change reaches the root of the first one only.
  const forest: Spec = {
    id: 'bike-forest',
    kind: 'conversation',
    blocks: [
      {
        id: 'r2',
        when: { user: 'Do you rent bikes?' },
        expect: { tools: [{ label: 'rental.quote', count: 1 }] },
      },
      { id: 'c1', parent: 'r1', when: { user: 'In blue?' }, expect: { must: ['bike'] } },
      {
        id: 'r1',
        when: { user: 'Which bike?' },
        expect: { tools: [{ label: 'bikes.lookup', count: 1, input: { kind: 'city' } }] },
      },
      { id: 'c2', parent: 'c1', when: { user: 'With a basket?' }, expect: { must: ['bike'] } },
      { id: 'd1', parent: 'r2', when: { user: 'For two days?' }, expect: { must: ['bike'] } },
    ],
    metadata: { depends: { stages: ['shop'] } },
  } as Spec;
  const change: Change = { kind: 'tool', id: 'bikes.lookup', part: 'input' };

  for (const mode of ['F', 'T'] as const) {
    it(`puts the descendants of a direct block in, wherever they are listed, and no other block (mode ${mode})`, () => {
      const report = radiusOf(
        [{ spec: forest, hash: 'h' }],
        { from: 'a', to: 'b', changes: [change] },
        { modes: [mode] },
      );
      const states = Object.fromEntries(
        (report.specs[0]?.blocks ?? []).map((block) => [block.id, block.state[mode]]),
      );
      expect(states).toEqual({ r2: 'out', c1: 'forward', r1: 'direct', c2: 'forward', d1: 'out' });
    });
  }
});
