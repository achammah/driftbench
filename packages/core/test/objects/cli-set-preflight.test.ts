import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  BUILTIN_KINDS,
  checkSpecObjects,
  ObjectRegistry,
  ObjectStore,
  parseCliOverrides,
  resolveBlockObjects,
  shippedObjectContext,
} from '../../src/objects';
import { parseSpecText } from '../../src/spec/load';

it('refuses --set diagnostic/missing#rule.limit=2 before the diagnostic branch can skip it', () => {
  const context = {
    ...shippedObjectContext(),
    cli: parseCliOverrides([], ['diagnostic/missing#rule.limit=2']),
  };
  expect(() => resolveBlockObjects({ blocks: [{ when: { user: 'hello' } }] }, 0, context)).toThrow(
    /unknown object diagnostic:missing; searched layers shipped, project, suite, spec, block, cli/,
  );
});

it('validates an item on a known but unselected --set object', () => {
  const context = shippedObjectContext();
  context.store.add({ kind: 'diagnostic', id: 'known', steps: [] }, 'project', { path: 'fixture' });
  context.cli = parseCliOverrides([], ['diagnostic/known#rule.limit=2']);
  expect(() => resolveBlockObjects({ blocks: [{ when: { user: 'hello' } }] }, 0, context)).toThrow(
    /no item of diagnostic:known/,
  );
});

function defaultContext(flag: string) {
  const registry = new ObjectRegistry();
  for (const kind of BUILTIN_KINDS) registry.registerKind(kind);
  registry.registerImpl('builtin:test/rule', { params: z.strictObject({ limit: z.number() }) });
  registry.registerShipped(
    {
      kind: 'check-set',
      id: 'default',
      items: [{ id: 'rule', title: 'Rule', impl: 'builtin:test/rule', params: { limit: 1 } }],
    },
    'fixture',
  );
  return { ...shippedObjectContext(registry), cli: parseCliOverrides([], [flag], registry) };
}

it('accepts --set check-set#rule.limit=2 against a shipped default without uses', () => {
  const context = defaultContext('check-set#rule.limit=2');
  const loaded = parseSpecText('id: default-set\nblocks:\n  - when: {user: hello}', 'yaml');
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const spec = loaded.spec;
  expect(
    resolveBlockObjects(spec, 0, context).find(({ object }) => object.kind === 'check-set')?.object.items[0]
      ?.params,
  ).toEqual({ limit: 2 });
  expect(checkSpecObjects(spec, context)).toEqual([]);
});

it('still validates an implicit default item during the explicit preflight', () => {
  const context = defaultContext('check-set#missing.limit=2');
  const loaded = parseSpecText('id: default-set\nblocks:\n  - when: {user: hello}', 'yaml');
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const spec = loaded.spec;
  expect(checkSpecObjects(spec, context)).toEqual([expect.objectContaining({ code: 'OBJECT_ITEM_UNKNOWN' })]);
});

function rangeContext(flags: string[]) {
  const registry = new ObjectRegistry();
  for (const kind of BUILTIN_KINDS) registry.registerKind(kind);
  registry.registerImpl('builtin:test/range', {
    params: z.strictObject({ lo: z.number(), hi: z.number() }).refine((p) => p.lo <= p.hi, {
      message: 'lo must not exceed hi',
    }),
  });
  registry.registerShipped(
    {
      kind: 'check-set',
      id: 'default',
      items: [{ id: 'range', title: 'Range', impl: 'builtin:test/range', params: { lo: 1, hi: 3 } }],
    },
    'range',
  );
  return {
    store: new ObjectStore(registry),
    uses: [],
    problems: [],
    cli: parseCliOverrides([], flags, registry),
  };
}
const oneBlock = { blocks: [{ when: { user: 'hello' } }] };

it.each([
  ['kind-only', ['check-set#range.lo=5', 'check-set#range.hi=8']],
  ['named', ['check-set/default#range.lo=5', 'check-set/default#range.hi=8']],
  ['named, in the other order', ['check-set/default#range.hi=8', 'check-set/default#range.lo=5']],
])('combines every --set flag of an object before validating its params (%s)', (_, flags) => {
  const params = resolveBlockObjects(oneBlock, 0, rangeContext(flags))[0]?.object.items[0]?.params;
  expect(params).toEqual({ lo: 5, hi: 8 });
});

it.each([
  ['kind-only', ['check-set#range.lo=9', 'check-set#range.hi=8']],
  ['named', ['check-set/default#range.lo=9', 'check-set/default#range.hi=8']],
])('still refuses a final combination that breaks the schema (%s)', (_, flags) => {
  expect(() => resolveBlockObjects(oneBlock, 0, rangeContext(flags))).toThrow(/lo must not exceed hi/);
});

const NAMED_LO = 'check-set/default#range.lo=5';
const NAMED_HI = 'check-set/default#range.hi=8';
const KIND_LO = 'check-set#range.lo=5';
const KIND_HI = 'check-set#range.hi=8';

it.each([
  ['named only', [NAMED_LO, NAMED_HI]],
  ['named only, other order', [NAMED_HI, NAMED_LO]],
  ['kind-only only', [KIND_LO, KIND_HI]],
  ['kind-only only, other order', [KIND_HI, KIND_LO]],
  ['named lo, kind-only hi', [NAMED_LO, KIND_HI]],
  ['kind-only hi, named lo', [KIND_HI, NAMED_LO]],
  ['kind-only lo, named hi', [KIND_LO, NAMED_HI]],
  ['named hi, kind-only lo', [NAMED_HI, KIND_LO]],
])(
  'combines named and kind-only --set flags of one selected object before validating it (%s)',
  (_, flags) => {
    expect(resolveBlockObjects(oneBlock, 0, rangeContext(flags))[0]?.object.items[0]?.params).toEqual({
      lo: 5,
      hi: 8,
    });
  },
);

it.each([
  ['named lo, kind-only hi', ['check-set/default#range.lo=9', KIND_HI]],
  ['kind-only hi, named lo', [KIND_HI, 'check-set/default#range.lo=9']],
  ['kind-only lo, named hi', ['check-set#range.lo=9', NAMED_HI]],
])('still refuses an invalid final combination of mixed forms (%s)', (_, flags) => {
  expect(() => resolveBlockObjects(oneBlock, 0, rangeContext(flags))).toThrow(/lo must not exceed hi/);
});

it('keeps the flags of one object from reaching another', () => {
  const context = rangeContext([]);
  context.store.add(
    {
      kind: 'check-set',
      id: 'other',
      items: [{ id: 'range', title: 'Range', impl: 'builtin:test/range', params: { lo: 2, hi: 4 } }],
    },
    'project',
    { path: 'other.yaml' },
  );
  // A named flag for `other` changes only `other`; the kind-only flag reaches every object of the kind.
  context.cli = parseCliOverrides([], ['check-set/other#range.lo=3', KIND_HI], context.store.registry);
  expect(resolveBlockObjects(oneBlock, 0, context)[0]?.object.items[0]?.params).toEqual({ lo: 1, hi: 8 });
  context.cli = parseCliOverrides(
    ['check-set/other'],
    ['check-set/other#range.lo=3', KIND_HI],
    context.store.registry,
  );
  expect(resolveBlockObjects(oneBlock, 0, context)[0]?.object.items[0]?.params).toEqual({ lo: 3, hi: 8 });
});

it('does not apply a kind-only flag to a named object that has no such item', () => {
  const context = rangeContext([]);
  context.store.add(
    {
      kind: 'check-set',
      id: 'other',
      items: [{ id: 'solo', title: 'Solo', impl: 'builtin:test/range', params: { lo: 2, hi: 4 } }],
    },
    'project',
    { path: 'other.yaml' },
  );
  // `range.hi` names no item of `other`: only the selected default takes it, and `other` is validated alone.
  context.cli = parseCliOverrides([], ['check-set/other#solo.lo=3', KIND_HI], context.store.registry);
  expect(resolveBlockObjects(oneBlock, 0, context)[0]?.object.items[0]?.params).toEqual({ lo: 1, hi: 8 });
});

/**
 * The oracle: an object takes its named flags; the object a kind selects also takes the kind-only flags of its
 * kind, in the order given. Each is then valid when lo <= hi. Written without the resolver: params are plain
 * numbers and a flag is `{ id?: string, path: 'lo' | 'hi', value }`.
 */
type Flag = { id?: string; path: 'lo' | 'hi'; value: number };
const BASES: Record<string, { lo: number; hi: number }> = {
  default: { lo: 1, hi: 3 },
  other: { lo: 2, hi: 4 },
  third: { lo: 0, hi: 9 },
};
function oracleAccepts(flags: Flag[], selected: string): boolean {
  for (const id of Object.keys(BASES)) {
    const named = flags.some((flag) => flag.id === id);
    if (!named && id !== selected) continue;
    const params = { ...(BASES[id] as { lo: number; hi: number }) };
    for (const flag of flags)
      if (flag.id === id || (flag.id === undefined && id === selected)) params[flag.path] = flag.value;
    if (params.lo > params.hi) return false;
  }
  return true;
}

function propertyContext(flags: Flag[], selected: string) {
  const registry = new ObjectRegistry();
  for (const kind of BUILTIN_KINDS) registry.registerKind(kind);
  registry.registerImpl('builtin:test/range', {
    params: z.strictObject({ lo: z.number(), hi: z.number() }).refine((p) => p.lo <= p.hi, {
      message: 'lo must not exceed hi',
    }),
  });
  const item = (params: { lo: number; hi: number }) => [
    { id: 'range', title: 'Range', impl: 'builtin:test/range', params },
  ];
  registry.registerShipped({ kind: 'check-set', id: 'default', items: item(BASES.default as never) }, 'a');
  const store = new ObjectStore(registry);
  store.add({ kind: 'check-set', id: 'other', items: item(BASES.other as never) }, 'project', { path: 'o' });
  store.add({ kind: 'check-set', id: 'third', items: item(BASES.third as never) }, 'project', { path: 't' });
  const text = flags.map(
    (flag) => `check-set${flag.id === undefined ? '' : `/${flag.id}`}#range.${flag.path}=${flag.value}`,
  );
  return {
    store,
    uses: [],
    problems: [],
    cli: parseCliOverrides(selected === 'default' ? [] : [`check-set/${selected}`], text, registry),
  };
}

it('accepts a random sequence of --set flags exactly when every object that takes them stays valid', () => {
  // A small deterministic generator (mulberry32), so a failure names its round and its flags.
  let state = 1337;
  const next = (n: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % n) | 0;
  };
  const ids: Array<string | undefined> = [undefined, 'default', 'other', 'third'];
  let accepted = 0;
  let refused = 0;
  for (let round = 0; round < 600; round += 1) {
    const flags: Flag[] = Array.from({ length: 1 + next(5) }, () => ({
      id: ids[next(ids.length)],
      path: next(2) === 0 ? 'lo' : 'hi',
      value: next(11),
    }));
    const selected = next(2) === 0 ? 'default' : 'other';
    let ok = true;
    try {
      resolveBlockObjects(oneBlock, 0, propertyContext(flags, selected));
    } catch (error) {
      if (!/lo must not exceed hi/.test(String(error))) throw error;
      ok = false;
    }
    expect(ok, JSON.stringify({ round, selected, flags })).toBe(oracleAccepts(flags, selected));
    if (ok) accepted += 1;
    else refused += 1;
  }
  // Both outcomes are exercised, or the property says nothing.
  expect(accepted).toBeGreaterThan(50);
  expect(refused).toBeGreaterThan(50);
});

it('checks an object the block does not select with only the flags that name it', () => {
  // default {1,3} is selected and takes hi=2; third {0,9} is not selected and takes only lo=5: {5,9} is valid.
  const flags: Flag[] = [
    { path: 'hi', value: 2 },
    { id: 'third', path: 'lo', value: 5 },
  ];
  expect(
    resolveBlockObjects(oneBlock, 0, propertyContext(flags, 'default'))[0]?.object.items[0]?.params,
  ).toEqual({
    lo: 1,
    hi: 2,
  });
  // The same flag for an unselected object that breaks its own schema is still refused.
  expect(() =>
    resolveBlockObjects(oneBlock, 0, propertyContext([{ id: 'third', path: 'lo', value: 10 }], 'default')),
  ).toThrow(/lo must not exceed hi/);
});

it.each([
  [['diagnostic/missing'], [], 'diagnostic:missing'],
  [['prompt-template/missing'], [], 'prompt-template:missing'],
  [[], ['prompt-template#missing.limit=2'], 'prompt-template:default'],
] as const)('preflights every CLI kind before skipping execution', (use, set, target) => {
  const context = { ...shippedObjectContext(), cli: parseCliOverrides(use, set) };
  expect(() => resolveBlockObjects({ blocks: [{ when: { user: 'hello' } }] }, 0, context)).toThrow(target);
});

it('selects a known diagnostic named by --use and checks its kind-only item override', () => {
  const context = shippedObjectContext();
  context.store.add({ kind: 'diagnostic', id: 'known', steps: [] }, 'project', { path: 'fixture' });
  context.cli = parseCliOverrides(['diagnostic/known'], []);
  const spec = { blocks: [{ when: { user: 'hello' } }] };
  expect(resolveBlockObjects(spec, 0, context).find((o) => o.key === 'diagnostics')?.object.id).toBe('known');
  context.cli = parseCliOverrides(['diagnostic/known'], ['diagnostic#missing.limit=2']);
  expect(() => resolveBlockObjects(spec, 0, context)).toThrow('no item of diagnostic:known');
});

it('validates kind-only items for a kind outside uses against its effective CLI object or default', () => {
  const context = defaultContext('prompt-template#rule.limit=2');
  for (const id of ['default', 'chosen'])
    context.store.add(
      {
        kind: 'prompt-template',
        id,
        items: [{ id: 'rule', title: 'Rule', impl: 'builtin:test/rule', params: { limit: 1 } }],
      },
      'project',
      { path: 'fixture' },
    );
  const spec = { blocks: [{ when: { user: 'hello' } }] };
  expect(() => resolveBlockObjects(spec, 0, context)).not.toThrow();
  context.cli = parseCliOverrides(['prompt-template/chosen'], ['prompt-template#missing.limit=2']);
  expect(() => resolveBlockObjects(spec, 0, context)).toThrow('no item of prompt-template:chosen');
});
