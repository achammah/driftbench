import { fileURLToPath } from 'node:url';
import {
  compileSpace,
  loadSpaceMap,
  type SpaceMap,
  spaceMapToVariables,
  type VariableStore,
  validateVariableStore,
  variablesToSpaceMap,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { HAND, map } from './support';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

async function loaded(path: string): Promise<SpaceMap> {
  const result = await loadSpaceMap(path);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.map;
}

/** The store of a map, checked: a converted map must load as a store. */
function storeOf(source: SpaceMap): VariableStore {
  const store = spaceMapToVariables(source);
  const result = validateVariableStore(store);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.store;
}

function spaceOf(store: VariableStore, options?: Parameters<typeof variablesToSpaceMap>[1]): SpaceMap {
  const result = variablesToSpaceMap(store, options);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.map;
}

describe('a space map becomes a store and comes back as the same map', () => {
  const FILES: Array<[string, string]> = [
    ['the hand map', ''],
    ['the Acme map of the space package', './fixtures/acme-space.yaml'],
    ['the Acme space.yaml of the example', '../../../examples/acme/map/space.yaml'],
    ['the Northwind space.yaml of the example', '../../../examples/estates/fixture/space.yaml'],
  ];

  for (const [name, path] of FILES) {
    it(`loses nothing of ${name}`, async () => {
      const original = path === '' ? map(HAND) : await loaded(here(path));
      const back = spaceOf(storeOf(original));
      expect(back).toEqual(original);
    });
  }

  it('turns every dimension into an approved axis and every constraint into an approved one', () => {
    const store = spaceMapToVariables(map(HAND));
    expect(store.variables.map((variable) => [variable.id, variable.role, variable.approved])).toEqual([
      ['stage', 'axis', true],
      ['deviation', 'axis', true],
      ['channel', 'axis', true],
    ]);
    expect(store.constraints.map((constraint) => constraint.approved)).toEqual([true]);
  });

  it('invents no provenance and no author: a space map says neither', () => {
    const store = spaceMapToVariables(map(HAND));
    const entries = [
      ...store.variables,
      ...store.variables.flatMap((variable) => variable.values),
      ...store.constraints,
    ];
    expect(entries.filter((entry) => 'provenance' in entry || 'produced_by' in entry)).toEqual([]);
  });

  it('keeps the required flags, the inventory and the version', () => {
    const source = map({
      ...HAND,
      version: '7',
      inventory: '../inventory.yaml',
      dimensions: HAND.dimensions.map((dimension, index) =>
        index === 2
          ? { ...dimension, values: dimension.values.map((value) => ({ ...value, required: true })) }
          : dimension,
      ),
    });
    const back = spaceOf(storeOf(source));
    expect(back).toEqual(source);
    expect(back.version).toBe('7');
    expect(back.inventory).toBe('../inventory.yaml');
    expect(back.dimensions[2]?.values.map((value) => value.required)).toEqual([true, true]);
  });
});

describe('the weights of the prior move onto the values they weigh', () => {
  const fitted = map({
    ...HAND,
    prior: {
      kind: 'fitted',
      source: 'the 200 consented chats of September',
      weights: { stage: { a: 1, b: 0 } },
    },
  });

  it('gives the values the weights the prior gave, not the ones they wrote', () => {
    const store = storeOf(fitted);
    expect(store.variables[0]?.values.map((value) => value.weight)).toEqual([1, 0]);
    // The other dimensions keep the weights they wrote.
    expect(store.variables[1]?.values.map((value) => value.weight)).toEqual([9, 1]);
    expect(store.prior).toEqual({ kind: 'fitted', source: 'the 200 consented chats of September' });
  });

  it('gives every cell the same share as before', () => {
    const back = spaceOf(storeOf(fitted));
    expect(back.prior).toEqual({ kind: 'fitted', source: 'the 200 consented chats of September' });
    const shares = (source: SpaceMap) =>
      compileSpace(source).dimensions.map((dimension) => dimension.weights);
    expect(shares(back)).toEqual(shares(fitted));
  });
});

const UNAPPROVED = validated({
  format: 1,
  agent: 'demo',
  version: '1',
  variables: [
    {
      id: 'stage',
      title: 'Stage',
      kind: 'stage',
      role: 'axis',
      approved: true,
      values: [
        { id: 'a', title: 'A', approved: false },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
      ],
    },
    {
      id: 'channel',
      title: 'Channel',
      kind: 'channel',
      role: 'axis',
      approved: false,
      values: [
        { id: 'chat', title: 'Chat', approved: true },
        { id: 'whatsapp', title: 'WhatsApp' },
      ],
    },
    {
      id: 'language',
      title: 'Language',
      kind: 'persona',
      role: 'axis',
      approved: false,
      values: [{ id: 'english', title: 'English' }],
    },
    {
      id: 'days_late',
      title: 'Days late',
      kind: 'data',
      role: 'detail',
      approved: true,
      values: [{ id: 'few', title: 'Few' }],
    },
  ],
  constraints: [
    { forbid: { stage: 'a', channel: 'chat' }, reason: 'A needs no chat.', approved: true },
    { forbid: { stage: 'b', channel: 'whatsapp' }, reason: 'B needs no whatsapp.', approved: true },
    { forbid: { stage: 'c', channel: 'chat' }, reason: 'Nobody approved this.', approved: false },
    { forbid: { stage: 'b', channel: 'chat' }, reason: 'B needs no chat.', approved: true },
    { forbid: { days_late: 'few', channel: 'chat' }, reason: 'Few days late needs no chat.', approved: true },
  ],
});

function validated(raw: unknown): VariableStore {
  const result = validateVariableStore(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.store;
}

describe('a store becomes the space map of its approved axes', () => {
  it('keeps a value when its own flag, else its variable, says so', () => {
    const result = spaceOf(UNAPPROVED);
    expect(
      result.dimensions.map((dimension) => [dimension.id, dimension.values.map((value) => value.id)]),
    ).toEqual([
      ['stage', ['b', 'c']],
      ['channel', ['chat']],
    ]);
  });

  it('drops a variable with no approved value, and every detail', () => {
    const ids = spaceOf(UNAPPROVED).dimensions.map((dimension) => dimension.id);
    expect(ids).not.toContain('language');
    expect(ids).not.toContain('days_late');
  });

  it('keeps an approved constraint whose values are all in the map, and no other', () => {
    const forbids = spaceOf(UNAPPROVED).constraints.map((constraint) => constraint.forbid);
    // Dropped: a value left out (stage a), a combination nobody approved, a detail, and the one that is
    // not a cell of the remaining axes (stage b with whatsapp).
    expect(forbids).toEqual([{ stage: 'b', channel: 'chat' }]);
  });

  it('keeps everything with approvedOnly off, details still out', () => {
    const result = spaceOf(UNAPPROVED, { approvedOnly: false });
    expect(result.dimensions.map((dimension) => [dimension.id, dimension.values.length])).toEqual([
      ['stage', 3],
      ['channel', 2],
      ['language', 1],
    ]);
    expect(result.constraints.map((constraint) => constraint.reason)).toEqual([
      'A needs no chat.',
      'B needs no whatsapp.',
      'Nobody approved this.',
      'B needs no chat.',
    ]);
  });

  it('says why when no axis is left, and names the path it was given', () => {
    const none = validated({
      format: 1,
      agent: 'demo',
      version: '1',
      variables: [
        {
          id: 'stage',
          title: 'Stage',
          kind: 'stage',
          role: 'axis',
          approved: false,
          values: [{ id: 'a', title: 'A' }],
        },
      ],
    });
    const result = variablesToSpaceMap(none, { path: 'variables.yaml' });
    expect(result.ok).toBe(false);
    expect(result.path).toBe('variables.yaml');
    expect(!result.ok && result.errors.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'SCHEMA_TOO_SMALL dimensions',
    ]);
  });

  it('does not add the value none to a deviation axis: the generator does, when it builds the cells', () => {
    const store = validated({
      format: 1,
      agent: 'demo',
      version: '1',
      variables: [
        {
          id: 'deviation',
          title: 'Deviation',
          kind: 'deviation',
          role: 'axis',
          approved: true,
          values: [{ id: 'D4_loose_confirmation', title: 'A loose yes' }],
        },
      ],
    });
    expect(spaceOf(store).dimensions[0]?.values.map((value) => value.id)).toEqual(['D4_loose_confirmation']);
  });
});

describe('ids that are also names of Object.prototype', () => {
  it('keeps the weights of a dimension named constructor when the prior lists no weights', () => {
    const source = map({
      version: '1',
      agent: 'x',
      dimensions: [
        {
          id: 'constructor',
          title: 'A dimension named like a built-in',
          kind: 'data',
          values: [
            { id: 'toString', title: 'A', weight: 3 },
            { id: 'normal', title: 'B', weight: 1 },
          ],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    });
    const store = storeOf(source);
    expect(store.variables[0]?.values.map((value) => [value.id, value.weight])).toEqual([
      ['toString', 3],
      ['normal', 1],
    ]);
    expect(spaceOf(store)).toEqual(source);
  });

  it('loads a store whose variables and values carry such names, and a constraint on them', () => {
    const named = (id: string, kind: string, values: string[]) => ({
      id,
      title: id,
      kind,
      role: 'axis',
      approved: true,
      values: values.map((value) => ({ id: value, title: value })),
    });
    const store = validated({
      format: 1,
      agent: 'x',
      version: '1',
      variables: [
        named('constructor', 'data', ['toString', 'valueOf']),
        named('hasOwnProperty', 'persona', ['a', 'b']),
      ],
      constraints: [
        { forbid: { constructor: 'toString', hasOwnProperty: 'a' }, reason: 'No.', approved: true },
      ],
    });
    expect(spaceOf(store).constraints).toEqual([
      { forbid: { constructor: 'toString', hasOwnProperty: 'a' }, reason: 'No.' },
    ]);
  });
});
