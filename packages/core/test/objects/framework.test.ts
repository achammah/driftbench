import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_KINDS,
  blockCacheKey,
  cacheSpecHash,
  canonicalGiven,
  cliPatch,
  explainObject,
  itemApplies,
  itemOf,
  loadSpecFile,
  ObjectError,
  ObjectRegistry,
  ObjectStore,
  objectContextFor,
  objectRegistry,
  observationCompatibilityHash,
  parseCliOverrides,
  parseObjectText,
  parseSpecText,
  resolveBlockObjects,
  resolveGiven,
  type Spec,
  USES_KINDS,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { initializeShippedObjects } from '../../src/objects';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'framework');
const PROTOTYPE = join(FIXTURES, 'objects');
const WORKED = join(FIXTURES, 'worked');

const NoParams = z.strictObject({});
/** The prototype's impls, without defaults: a param an item does not set stays unset. */
function testRegistry(): ObjectRegistry {
  const registry = new ObjectRegistry();
  for (const def of BUILTIN_KINDS) registry.registerKind(def);
  for (const name of [
    'tools-count',
    'tools-input-closed',
    'tools-order',
    'tools-argument-accuracy',
    'forbidden-count0',
  ]) {
    registry.registerImpl(`builtin:checks/${name}`, { params: NoParams });
  }
  registry.registerImpl('builtin:value-check/exact', {
    params: z.strictObject({
      case_insensitive: z.boolean().optional(),
      strip_punctuation: z.boolean().optional(),
    }),
  });
  registry.registerImpl('builtin:value-check/outcome', {
    params: z.strictObject({ resolved_fields: z.string(), distractors_required: z.boolean() }),
  });
  registry.registerImpl('builtin:value-check/contract', { params: NoParams });
  registry.registerImpl('builtin:value-check/judge', {
    params: z.strictObject({
      design: z.string(),
      orders: z.enum(['one', 'both']),
      repeats: z.number().int().min(1),
      max_false_acceptance: z.number().min(0).max(1),
    }),
  });
  registry.registerImpl('builtin:blame/stated-format-broken', { params: NoParams });
  registry.registerImpl('builtin:blame/copied-value-tool-failed', {
    params: z.strictObject({ recovery_ok: z.array(z.string()) }),
  });
  registry.registerImpl('builtin:blame/accepted-no-need', { params: NoParams });
  registry.registerImpl('builtin:blame/downstream-need', {
    params: z.strictObject({ downstream_consumers: z.array(z.record(z.string(), z.string())) }),
  });
  return registry;
}

function prototypeStore(...files: string[]): ObjectStore {
  const registry = testRegistry();
  for (const file of ['shipped/check-set/default.yaml', 'shipped/policy/value-check/default.yaml']) {
    registry.registerShipped(parseObjectText(readFileSync(join(PROTOTYPE, file), 'utf8'), file).raw, file);
  }
  const store = new ObjectStore(registry);
  for (const file of files) store.addFile(join(PROTOTYPE, file), 'project');
  return store;
}

function workedRegistry(): ObjectRegistry {
  const registry = testRegistry();
  for (const file of ['policy/value-check/default.yaml', 'policy/blame/default.yaml']) {
    const path = join(WORKED, 'shipped', file);
    registry.registerShipped(parseObjectText(readFileSync(path, 'utf8'), path).raw, path);
  }
  return registry;
}

function refusal(action: () => unknown): ObjectError {
  try {
    action();
  } catch (cause) {
    if (cause instanceof ObjectError) return cause;
    throw cause;
  }
  throw new Error('expected a refusal');
}

function tempProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-objects-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('fixtures', () => {
  it('every fixture copied from the prototype is byte for byte its source', () => {
    const lines = readFileSync(join(FIXTURES, 'SHA256SUMS'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    expect(lines.length).toBe(21);
    for (const line of lines) {
      const [sum, file] = line.split(/\s+/) as [string, string];
      const actual = createHash('sha256')
        .update(readFileSync(join(FIXTURES, file)))
        .digest('hex');
      expect(actual, file).toBe(sum);
    }
  });
});

describe('extends', () => {
  it('applies the chain root first, so the nearest object wins', () => {
    const root = tempProject({
      'driftbench.yaml': 'plugins: []\n',
      'driftbench/check-set/a.yaml':
        'kind: check-set\nid: a\nextends: default\nitems:\n  - id: tools.order\n    enabled: false\n',
      'driftbench/check-set/b.yaml':
        'kind: check-set\nid: b\nextends: a\nitems:\n  - id: tools.order\n    enabled: true\n  - id: tools.count\n    enabled: false\n',
    });
    const store = prototypeStore();
    store.addFile(join(root, 'driftbench/check-set/a.yaml'), 'project');
    store.addFile(join(root, 'driftbench/check-set/b.yaml'), 'project');
    const b = store.resolve('check-set', 'b');
    expect(b.chain).toEqual(['check-set:b', 'check-set:a', 'check-set:default']);
    expect(itemOf(b, 'tools.order')?.enabled).toBe(true);
    expect(itemOf(b, 'tools.count')?.enabled).toBe(false);
    expect(store.resolve('check-set', 'a').items.find((item) => item.id === 'tools.order')?.enabled).toBe(
      false,
    );
    // Content is the identity: an object that changes nothing hashes as its parent.
    const same = tempProject({ 'same.yaml': 'kind: check-set\nid: same\nextends: default\n' });
    store.addFile(join(same, 'same.yaml'), 'project');
    expect(store.resolve('check-set', 'same').hash).toBe(store.resolve('check-set', 'default').hash);
    expect(b.hash).not.toBe(store.resolve('check-set', 'default').hash);
  });

  it('refuses a cycle, naming its ids', () => {
    const root = tempProject({
      'x.yaml': 'kind: check-set\nid: x\nextends: y\n',
      'y.yaml': 'kind: check-set\nid: y\nextends: z\n',
      'z.yaml': 'kind: check-set\nid: z\nextends: x\n',
    });
    const store = prototypeStore();
    for (const name of ['x', 'y', 'z']) store.addFile(join(root, `${name}.yaml`), 'project');
    const error = refusal(() => store.resolve('check-set', 'x'));
    expect(error.code).toBe('OBJECT_CYCLE');
    expect(error.message).toBe('extends cycle: check-set:x -> check-set:y -> check-set:z -> check-set:x');
  });

  it('finds a file at its strongest layer: the nearer suite folder, then the project', () => {
    const root = tempProject({
      'driftbench.yaml': 'plugins: []\n',
      'driftbench/check-set/acme.yaml':
        'kind: check-set\nid: acme\nextends: default\nitems:\n  - { id: tools.order, enabled: false }\n',
      'specs/_driftbench/check-set/acme.yaml':
        'kind: check-set\nid: acme\nextends: default\nitems:\n  - { id: tools.count, enabled: false }\n',
      'specs/deep/_driftbench/check-set/acme.yaml':
        'kind: check-set\nid: acme\nextends: acme\nitems:\n  - { id: forbidden.count0, enabled: false }\n',
      'specs/deep/a.yaml': 'id: a\nuses: { check_set: acme }\nblocks: [{ user: hi }]\n',
      'specs/b.yaml': 'id: b\nuses: { check_set: acme }\nblocks: [{ user: hi }]\n',
      'c.yaml': 'id: c\nuses: { check_set: acme }\nblocks: [{ user: hi }]\n',
    });
    const registry = prototypeStore().registry;
    const at = (spec: string) => {
      const context = objectContextFor(join(root, spec), registry);
      expect(context.problems.map((p) => p.message)).toEqual([]);
      return context.store.resolve('check-set', 'acme');
    };
    const deep = at('specs/deep/a.yaml');
    // The deep suite extends its own id from the weaker suite folder: both disables hold.
    expect(deep.layer).toBe('suite');
    expect(deep.chain).toEqual(['check-set:acme', 'check-set:acme', 'check-set:default']);
    expect(itemOf(deep, 'forbidden.count0')?.enabled).toBe(false);
    expect(itemOf(deep, 'tools.count')?.enabled).toBe(false);
    expect(itemOf(deep, 'tools.order')?.enabled).toBe(true);
    expect(itemOf(at('specs/b.yaml'), 'tools.count')?.enabled).toBe(false);
    const project = at('c.yaml');
    expect(project.layer).toBe('project');
    expect(itemOf(project, 'tools.order')?.enabled).toBe(false);
  });

  it('refuses a shipped object defined again, and one kind and id twice at one layer', () => {
    const root = tempProject({
      'default.yaml': 'kind: check-set\nid: default\nextends: null\nitems: []\n',
      'one.yaml': 'kind: check-set\nid: twin\nextends: default\n',
      'two.yaml': 'kind: check-set\nid: twin\nextends: default\n',
    });
    const store = prototypeStore();
    expect(refusal(() => store.addFile(join(root, 'default.yaml'), 'project')).code).toBe(
      'OBJECT_SHIPPED_IMMUTABLE',
    );
    store.addFile(join(root, 'one.yaml'), 'project');
    const twin = refusal(() => store.addFile(join(root, 'two.yaml'), 'project'));
    expect(twin.code).toBe('OBJECT_DUPLICATE');
    expect(twin.message).toContain('one.yaml');
  });

  it('refuses an unknown object, naming the layers it searched', () => {
    const error = refusal(() => prototypeStore().resolve('policy/blame', 'acme'));
    expect(error.code).toBe('OBJECT_UNKNOWN');
    expect(error.message).toBe(
      'unknown object policy/blame:acme; searched layers shipped, project, suite, spec, block, cli; known ids for policy/blame: (none)',
    );
    expect(refusal(() => prototypeStore().resolve('policy/blam', 'acme')).code).toBe('OBJECT_KIND_UNKNOWN');
  });
});

describe('items', () => {
  const PLANTED: Array<[string, string, string, string]> = [
    ['unknown/U1.yaml', 'policy/value-check', 'u1', 'rung5_judge'],
    ['unknown/U2.yaml', 'check-set', 'u2', 'tools.ordr'],
    ['unknown/U3.yaml', 'check-set', 'u3', 'R3'],
    ['unknown/U4.yaml', 'check-set', 'u4', 'tools.coverage'],
    ['unknown/U5.yaml', 'check-set', 'u5', 'Tools.order'],
    ['unknown/U6.yaml', 'policy/value-check', 'u6', 'rung4_Exact'],
    ['unknown/U7.yaml', 'check-set', 'u7', 'rung4_exact'],
    ['unknown/U8.yaml', 'policy/value-check', 'u8', 'rung2b_declared'],
  ];

  it.each(PLANTED)(
    'refuses %s: an unknown item, named with every item of the parent',
    (file, kind, id, unknown) => {
      const store = prototypeStore(file);
      const parent = store.resolve(kind, 'default').items.map((item) => item.id);
      const error = refusal(() => store.resolve(kind, id));
      expect(error.code).toBe('OBJECT_ITEM_UNKNOWN');
      expect(error.message).toContain(`unknown item ${unknown} in ${kind}:${id}`);
      expect(error.message).toContain(`the parent ${kind}:default holds ${parent.join(', ')}`);
    },
  );

  it('accepts the seven one-item overrides of the prototype', () => {
    for (const [file, kind, id, item] of [
      ['overrides/O1.yaml', 'policy/value-check', 'o1', 'rung4_exact'],
      ['overrides/O2.yaml', 'policy/value-check', 'o2', 'rung4_exact'],
      ['overrides/O3.yaml', 'check-set', 'o3', 'tools.order'],
      ['overrides/O4.yaml', 'check-set', 'o4', 'tools.count'],
      ['overrides/O5.yaml', 'check-set', 'o5', 'forbidden.count0'],
      ['overrides/O6.yaml', 'check-set', 'o6', 'tools.argument_accuracy'],
      ['overrides/O7.yaml', 'check-set', 'o7', 'tools.input_closed'],
    ] as const) {
      const resolved = prototypeStore(file).resolve(kind, id);
      expect(itemOf(resolved, item)?.layer, file).toBe('project');
      expect(resolved.items.filter((entry) => entry.layer === 'project').map((entry) => entry.id)).toEqual([
        item,
      ]);
    }
    const o1 = prototypeStore('overrides/O1.yaml').resolve('policy/value-check', 'o1');
    expect(itemOf(o1, 'rung4_exact')?.params).toEqual({ case_insensitive: true, strip_punctuation: false });
  });

  it('adds an item only with add: true and its full definition', () => {
    // The prototype added an unknown id silently when it had a title and impl; the product asks for add: true.
    const implicit = refusal(() => prototypeStore('overrides/ADD.yaml').resolve('check-set', 'add'));
    expect(implicit.code).toBe('OBJECT_ITEM_UNKNOWN');
    expect(implicit.message).toContain('To add a new item write add: true with title, when, effect and impl');
    const root = tempProject({
      'add.yaml': [
        'kind: check-set',
        'id: add',
        'extends: default',
        'items:',
        '  - id: tools.count_again',
        '    add: true',
        '    title: A second count item',
        '    when: {}',
        '    effect: { gating: true }',
        '    impl: builtin:checks/tools-count',
        '    before: tools.order',
        '',
      ].join('\n'),
      'short.yaml':
        'kind: check-set\nid: short\nextends: default\nitems:\n  - { id: new, add: true, title: New, impl: builtin:checks/tools-count }\n',
      'again.yaml':
        'kind: check-set\nid: again\nextends: default\nitems:\n  - { id: tools.count, add: true, title: T, when: {}, effect: {}, impl: builtin:checks/tools-count }\n',
    });
    const store = prototypeStore();
    store.addFile(join(root, 'add.yaml'), 'project');
    store.addFile(join(root, 'short.yaml'), 'project');
    store.addFile(join(root, 'again.yaml'), 'project');
    const added = store.resolve('check-set', 'add');
    expect(added.items.map((item) => item.id)).toEqual([
      'tools.count',
      'tools.input_closed',
      'tools.count_again',
      'tools.order',
      'tools.argument_accuracy',
      'forbidden.count0',
    ]);
    expect(itemOf(added, 'tools.count_again')?.enabled).toBe(true);
    const short = refusal(() => store.resolve('check-set', 'short'));
    expect(short.code).toBe('OBJECT_ITEM_INCOMPLETE');
    expect(short.message).toContain('needs when, effect');
    const again = refusal(() => store.resolve('check-set', 'again'));
    expect(again.code).toBe('OBJECT_ITEM_EXISTS');
    expect(again.message).toContain('drop add: true to change it');
  });

  it('validates params against the implementation schema, naming the path', () => {
    const root = tempProject({
      'bad.yaml':
        'kind: policy/value-check\nid: bad\nextends: default\nitems:\n  - id: rung4_exact\n    params: { case_insensitive: "yes" }\n',
      'extra.yaml':
        'kind: policy/value-check\nid: extra\nextends: default\nitems:\n  - id: rung4_exact\n    params: { fold: true }\n',
      'plugin.yaml':
        'kind: policy/value-check\nid: plugin\nextends: default\nitems:\n  - id: rung4_exact\n    impl: plugin:acme-exact\n',
    });
    const store = prototypeStore();
    for (const name of ['bad', 'extra', 'plugin']) store.addFile(join(root, `${name}.yaml`), 'project');
    const bad = refusal(() => store.resolve('policy/value-check', 'bad'));
    expect(bad.code).toBe('OBJECT_PARAMS_INVALID');
    expect(bad.message).toMatch(/item rung4_exact params: params\.case_insensitive: .*boolean/);
    expect(bad.message).toContain('bad.yaml:5');
    expect(refusal(() => store.resolve('policy/value-check', 'extra')).message).toContain('fold');
    const plugin = refusal(() => store.resolve('policy/value-check', 'plugin'));
    expect(plugin.code).toBe('OBJECT_IMPL_UNKNOWN');
    expect(plugin.message).toContain('plugin:acme-exact, which no builtin or plugin provides');
  });

  it('keeps a disabled item, so a stronger layer can enable it again, and checks no impl it never runs', () => {
    const root = tempProject({
      'off.yaml':
        'kind: policy/value-check\nid: off\nextends: default\nitems:\n  - { id: rung4_exact, enabled: false, impl: plugin:absent }\n',
      'on.yaml':
        'kind: policy/value-check\nid: on\nextends: off\nitems:\n  - { id: rung4_exact, enabled: true }\n',
    });
    const store = prototypeStore();
    store.addFile(join(root, 'off.yaml'), 'project');
    store.addFile(join(root, 'on.yaml'), 'suite');
    expect(itemOf(store.resolve('policy/value-check', 'off'), 'rung4_exact')?.enabled).toBe(false);
    expect(refusal(() => store.resolve('policy/value-check', 'on')).code).toBe('OBJECT_IMPL_UNKNOWN');
  });

  it('refuses a root object item without its full definition', () => {
    const root = tempProject({
      'root.yaml':
        'kind: check-set\nid: root\nitems:\n  - { id: a, add: true, title: A, impl: builtin:checks/tools-count }\n',
    });
    const error = refusal(() => prototypeStore().addFile(join(root, 'root.yaml'), 'project'));
    expect(error.code).toBe('OBJECT_ITEM_INCOMPLETE');
    expect(error.message).toContain('a root object lists full items');
  });

  it('refuses a key the kind does not hold: agent-facing is a property of the kind, not of a file', () => {
    const error = refusal(() => prototypeStore('shipped/run-profile/default.yaml'));
    expect(error.message).toContain('unknown key agent_facing');
    initializeShippedObjects();
    expect(objectRegistry.kind('run-profile')?.agentFacing).toBe(true);
  });
});

describe('applies_to', () => {
  const store = () => {
    const root = tempProject({
      'scoped.yaml': [
        'kind: check-set',
        'id: scoped',
        'extends: default',
        'items:',
        '  - id: tools.count',
        '    applies_to: { skills: [refunds], tools: [refunds.create] }',
        '  - id: tools.order',
        '    applies_to: { units: ["R#41/*"] }',
        '',
      ].join('\n'),
      'narrowed.yaml':
        'kind: check-set\nid: narrowed\nextends: scoped\nitems:\n  - { id: tools.count, applies_to: { skills: [billing] } }\n',
      'bad.yaml':
        'kind: check-set\nid: bad\nextends: default\nitems:\n  - { id: tools.count, applies_to: { teams: [ops] } }\n',
    });
    const objects = prototypeStore();
    for (const name of ['scoped', 'narrowed']) objects.addFile(join(root, `${name}.yaml`), 'project');
    return Object.assign(objects, { badFile: join(root, 'bad.yaml') });
  };

  it('skips a scoped item on evidence that names none of its skills or tools, and fires on a match', () => {
    const count = itemOf(store().resolve('check-set', 'scoped'), 'tools.count');
    if (!count) throw new Error('tools.count');
    expect(itemApplies(count, { skills: ['billing'] })).toBe(false);
    expect(itemApplies(count, { skills: ['billing', 'refunds'] })).toBe(true);
    expect(itemApplies(count, { tools: ['refunds.create'] })).toBe(true);
    expect(itemApplies(count, {})).toBe(false);
  });

  it('matches units by glob, and applies everywhere without applies_to', () => {
    const scoped = store().resolve('check-set', 'scoped');
    const order = itemOf(scoped, 'tools.order');
    if (!order) throw new Error('tools.order');
    expect(itemApplies(order, { units: ['R#41/c3'] })).toBe(true);
    expect(itemApplies(order, { units: ['R#4/c3', 'R#410'] })).toBe(false);
    const plain = itemOf(scoped, 'forbidden.count0');
    expect(plain && 'applies_to' in plain).toBe(false);
    expect(plain && itemApplies(plain, {})).toBe(true);
  });

  it('merges a patch: maps merge, lists replace; and refuses an unknown key', () => {
    const objects = store();
    expect(itemOf(objects.resolve('check-set', 'narrowed'), 'tools.count')?.applies_to).toEqual({
      skills: ['billing'],
      tools: ['refunds.create'],
    });
    const error = refusal(() => objects.addFile(objects.badFile, 'project'));
    expect(error.code).toBe('OBJECT_INVALID');
    expect(error.message).toContain('teams');
    // No default: the shipped default holds no applies_to, so its hash is what it was.
    expect(objects.resolve('check-set', 'default').items.some((item) => 'applies_to' in item)).toBe(false);
  });
});

describe('order', () => {
  const store = (text: string) => {
    const root = tempProject({ 'o.yaml': `kind: check-set\nid: o\nextends: default\n${text}` });
    const objects = prototypeStore();
    objects.addFile(join(root, 'o.yaml'), 'project');
    return objects;
  };

  it('takes a permutation of the enabled items', () => {
    const resolved = store(
      'order: [forbidden.count0, tools.order, tools.count, tools.input_closed, tools.argument_accuracy]\n',
    ).resolve('check-set', 'o');
    expect(resolved.items.map((item) => item.id)).toEqual([
      'forbidden.count0',
      'tools.order',
      'tools.count',
      'tools.input_closed',
      'tools.argument_accuracy',
    ]);
  });

  it('refuses an order that leaves out an enabled item, or lists one twice', () => {
    expect(refusal(() => store('order: [tools.count]\n').resolve('check-set', 'o')).message).toContain(
      'order must list every enabled item once; it leaves out tools.input_closed, tools.order, tools.argument_accuracy, forbidden.count0',
    );
    expect(
      refusal(() =>
        store(
          'order: [tools.count, tools.count, tools.input_closed, tools.order, tools.argument_accuracy, forbidden.count0]\n',
        ).resolve('check-set', 'o'),
      ).message,
    ).toContain('order lists tools.count twice');
  });

  it('lets a disabled item out of the order and keeps it after the listed ones', () => {
    const resolved = store(
      'items:\n  - { id: tools.order, enabled: false }\norder: [forbidden.count0, tools.count, tools.input_closed, tools.argument_accuracy]\n',
    ).resolve('check-set', 'o');
    expect(resolved.items.map((item) => item.id).at(-1)).toBe('tools.order');
  });

  it('moves one item with before or after, leaving the rest as the parent had it', () => {
    expect(
      store('items:\n  - { id: forbidden.count0, before: tools.count }\n')
        .resolve('check-set', 'o')
        .items.map((item) => item.id),
    ).toEqual([
      'forbidden.count0',
      'tools.count',
      'tools.input_closed',
      'tools.order',
      'tools.argument_accuracy',
    ]);
    expect(
      store('items:\n  - { id: tools.count, after: tools.order }\n')
        .resolve('check-set', 'o')
        .items.map((item) => item.id),
    ).toEqual([
      'tools.input_closed',
      'tools.order',
      'tools.count',
      'tools.argument_accuracy',
      'forbidden.count0',
    ]);
  });

  it('refuses order and a move in one file', () => {
    const error = refusal(() =>
      store(
        'items:\n  - { id: tools.count, after: tools.order }\norder: [tools.count, tools.input_closed, tools.order, tools.argument_accuracy, forbidden.count0]\n',
      ).resolve('check-set', 'o'),
    );
    expect(error.code).toBe('OBJECT_ORDER_INVALID');
    expect(error.message).toContain('use one or the other');
  });
});

describe('merge', () => {
  const resolve = (patch: string) => {
    const root = tempProject({
      'p.yaml': `kind: policy/blame\nid: p\nextends: default\nitems:\n  - id: R3\n    params: ${patch}\n`,
    });
    const context = objectContextFor(
      join(WORKED, 'project', 'specs', 'refund-late-order.yaml'),
      workedRegistry(),
    );
    context.store.addFile(join(root, 'p.yaml'), 'suite');
    return itemOf(context.store.resolve('policy/blame', 'p'), 'R3')?.params;
  };

  it('replaces a list, appends with +key, removes with -key', () => {
    expect(resolve('{ recovery_ok: [gave_up] }')).toEqual({ recovery_ok: ['gave_up'] });
    expect(resolve("{ '+recovery_ok': [gave_up] }")).toEqual({
      recovery_ok: ['asked_user', 'retried_canonical', 'gave_up'],
    });
    expect(resolve("{ '-recovery_ok': [asked_user] }")).toEqual({ recovery_ok: ['retried_canonical'] });
  });

  it('merges a map into the map below it', () => {
    const root = tempProject({
      'j.yaml': 'kind: policy/value-check\nid: j\nextends: default\nparams: { judge: { repeats: 5 } }\n',
      'k.yaml':
        'kind: policy/value-check\nid: k\nextends: j\nparams: { judge: { orders: both }, "-gone": null }\n',
    });
    const store = prototypeStore();
    store.addFile(join(root, 'j.yaml'), 'project');
    store.addFile(join(root, 'k.yaml'), 'suite');
    expect(store.resolve('policy/value-check', 'k').params).toEqual({
      judge: { repeats: 5, orders: 'both' },
    });
  });

  it('refuses +key on a value that is not a list', () => {
    const root = tempProject({
      'q.yaml':
        "kind: policy/value-check\nid: q\nextends: default\nitems:\n  - id: rung4_exact\n    params: { '+case_insensitive': [true] }\n",
    });
    const store = prototypeStore();
    store.addFile(join(root, 'q.yaml'), 'project');
    expect(refusal(() => store.resolve('policy/value-check', 'q')).message).toContain(
      '+case_insensitive appends to case_insensitive, which is not a list',
    );
  });
});

describe('explain', () => {
  it('prints the worked example (config_framework.md 3.7)', () => {
    const spec = join(WORKED, 'project', 'specs', 'refund-late-order.yaml');
    const context = objectContextFor(spec, workedRegistry());
    const loaded = parseSpecText(readFileSync(spec, 'utf8'), 'yaml', spec, { objects: context });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const used = resolveBlockObjects(loaded.spec, 0, context);
    const text = used
      .map((entry) =>
        explainObject(entry.object, { at: 'specs/refund-late-order.yaml#b1', root: join(WORKED, 'project') }),
      )
      .join('\n');
    expect(text.replace(/@[0-9a-f]{8}/g, '@<hash>')).toBe(
      [
        'policy/value-check at specs/refund-late-order.yaml#b1 -> (block)@<hash> (extends default@<hash>)',
        '  rung1_outcome        enabled   resolved_fields from_tool_declaration, distractors_required true                 shipped',
        '  rung2_contract       enabled   settles [fail], lint_when test_demands_unstated_format                           shipped',
        '  rung3_same_referent  enabled   design read_each_value_first, orders both, repeats 5, max_false_acceptance 0.02  block blocks.0.uses.value_check.items.0',
        '  rung4_exact          enabled   settles [pass, fail]                                                             shipped',
        'policy/blame at specs/refund-late-order.yaml#b1 -> acme@<hash> (extends default@<hash>)',
        '  R1   enabled   verdict fail, fault [agent], fix_location agent.behaviour             shipped',
        '  R3   enabled   recovery_ok [asked_user]                                              project driftbench/policy/blame/acme.yaml:5',
        '  R5   enabled   verdict pass, flag_test_when demands_unstated_format, fault [test]    shipped',
        '  R5b  enabled   downstream_consumers [field phone, needs e164, declared_in crm.yaml]  project driftbench/policy/blame/acme.yaml:7',
      ].join('\n'),
    );
    expect(used.map((entry) => [entry.key, entry.setAt])).toEqual([
      ['value_check', 'block'],
      ['blame', 'spec'],
    ]);
  });
});

describe('the resolve pass of the loader', () => {
  it('refuses a spec that names an unknown object, naming spec, block, kind, id and the layers', async () => {
    const root = tempProject({
      'specs/a.yaml': 'id: a\nblocks:\n  - id: b1\n    user: hi\n    uses: { blame: nobody }\n',
      'specs/b.yaml': 'id: b\nuses: { check_set: nobody }\nblocks: [{ user: hi }, { user: again }]\n',
    });
    const a = await loadSpecFile(join(root, 'specs/a.yaml'));
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.errors).toEqual([
      {
        level: 'error',
        code: 'OBJECT_UNKNOWN',
        path: 'blocks.0.uses.blame',
        message:
          'spec a block b1: blocks.0.uses.blame: unknown object policy/blame:nobody; searched layers shipped, project, suite, spec, block, cli; known ids for policy/blame: (none)',
      },
    ]);
    const b = await loadSpecFile(join(root, 'specs/b.yaml'));
    expect(b.ok ? [] : b.errors.map((issue) => [issue.code, issue.path])).toEqual([
      ['OBJECT_UNKNOWN', 'uses.check_set'],
    ]);
  });

  it('refuses an unknown item in an inline block object, and a broken object file in scope', () => {
    const spec = join(WORKED, 'project', 'specs', 'refund-late-order.yaml');
    const text = readFileSync(spec, 'utf8').replace('rung3_same_referent', 'rung3_same_referant');
    const loaded = parseSpecText(text, 'yaml', spec, { objects: objectContextFor(spec, workedRegistry()) });
    expect(loaded.ok ? [] : loaded.errors.map((issue) => issue.code)).toEqual(['OBJECT_ITEM_UNKNOWN']);
    const root = tempProject({
      'driftbench.yaml': 'plugins: []\n',
      'driftbench/policy/blame/acme.yaml': 'kind: policy/blame\nid: other\nextends: default\n',
      'specs/a.yaml': 'id: a\nblocks: [{ user: hi }]\n',
    });
    const broken = validateSpec({ id: 'a', blocks: [{ user: 'hi' }] }, join(root, 'specs/a.yaml'), {
      objects: objectContextFor(join(root, 'specs/a.yaml'), workedRegistry()),
    });
    expect(broken.ok ? [] : broken.errors.map((issue) => issue.message)).toEqual([
      expect.stringContaining('holds policy/blame:other, so it belongs at policy/blame/other.yaml'),
    ]);
  });

  it('loads a spec whose objects resolve, and leaves a spec without uses as it was', async () => {
    const spec = join(WORKED, 'project', 'specs', 'refund-late-order.yaml');
    const loaded = parseSpecText(readFileSync(spec, 'utf8'), 'yaml', spec, {
      objects: objectContextFor(spec, workedRegistry()),
    });
    expect(loaded.ok).toBe(true);
    // Read with the process registry, which ships no blame object yet, the same file is refused at load.
    const plain = await loadSpecFile(spec);
    expect(plain.ok ? [] : plain.errors.map((issue) => issue.code)).toEqual(['OBJECT_UNKNOWN']);
    const without = validateSpec({ id: 'p', blocks: [{ user: 'hi' }] });
    expect(without.ok && 'uses' in without.spec).toBe(false);
  });

  it('skips the objects folders when it looks for spec files', async () => {
    const root = tempProject({
      'driftbench.yaml': 'plugins: []\n',
      'driftbench/check-set/x.yaml': 'kind: check-set\nid: x\nextends: default\n',
      'specs/_driftbench/uses.yaml': 'check_set: x\n',
      'specs/a.yaml': 'id: a\nblocks: [{ user: hi }]\n',
    });
    const { findSpecFiles } = await import('@agent-nexus/driftbench-core');
    const found = (await findSpecFiles([root])).map((file) => file.slice(root.length + 1));
    expect(found.filter((file) => file.includes('driftbench/'))).toEqual([]);
    expect(found).toContain('specs/a.yaml');
  });
});

describe('uses stays out of the cache key and the re-judge compatibility hash', () => {
  const base: Spec = {
    id: 'cache',
    kind: 'conversation',
    blocks: [{ when: { user: 'hi' }, expect: { must: ['hello'] } }],
  } as Spec;
  const withUses = (uses: Spec['uses'], blockUses?: Spec['uses']): Spec => ({
    ...base,
    ...(uses === undefined ? {} : { uses }),
    blocks: base.blocks.map((block) => ({
      ...block,
      ...(blockUses === undefined ? {} : { uses: blockUses }),
    })),
  });
  const keyOf = (spec: Spec) => {
    const canonical = canonicalGiven(spec, 0);
    return blockCacheKey({
      specHash: cacheSpecHash(spec),
      repeat: 0,
      position: 0,
      given: resolveGiven(canonical.state, canonical.prefix, { adapter: 'stand-in' }),
      stimulus: spec.blocks[0]?.when as never,
      target: { adapter: 'stand-in' },
      adapter: 'stand-in',
      adapterVersion: '0',
    });
  };

  it('keeps the block cache key when uses is added or changed, on the spec or on a block', () => {
    const key = keyOf(base);
    expect(keyOf(withUses({ blame: 'acme' }))).toBe(key);
    expect(keyOf(withUses({ blame: 'other', check_set: 'x' }))).toBe(key);
    expect(
      keyOf(
        withUses(undefined, { value_check: { extends: 'default', items: [{ id: 'r', enabled: false }] } }),
      ),
    ).toBe(key);
    // The spec hash itself records uses: the spec did change.
    expect(cacheSpecHash({ ...base, version: '2' } as Spec)).toBe(cacheSpecHash(base));
    expect(keyOf({ ...base, blocks: [{ when: { user: 'hello' } }] } as Spec)).not.toBe(key);
  });

  it('keeps the re-judge compatibility hash when uses changes', () => {
    const execution = { executionHash: 'e' };
    const hash = observationCompatibilityHash(base, execution);
    expect(observationCompatibilityHash(withUses({ blame: 'acme' }, { check_set: 'x' }), execution)).toBe(
      hash,
    );
    expect(
      observationCompatibilityHash({ ...base, blocks: [{ when: { user: 'hello' } }] } as Spec, execution),
    ).not.toBe(hash);
  });

  it('names only scoring-only kinds under uses', () => {
    for (const kind of Object.values(USES_KINDS)) {
      expect(objectRegistry.kind(kind)?.agentFacing, kind).toBe(false);
    }
  });
});

describe('the command-line layer', () => {
  it('reads --use and --set and applies them above the block', () => {
    const spec = join(WORKED, 'project', 'specs', 'refund-late-order.yaml');
    const registry = workedRegistry();
    const context = objectContextFor(spec, registry);
    const loaded = parseSpecText(readFileSync(spec, 'utf8'), 'yaml', spec, { objects: context });
    if (!loaded.ok) throw new Error('worked spec');
    const cli = parseCliOverrides(
      ['policy/blame/default'],
      [
        'policy/blame#R3.recovery_ok=[gave_up]',
        'policy/value-check/(block)#rung4_exact.case_insensitive=true',
      ],
      registry,
    );
    const used = resolveBlockObjects(loaded.spec, 0, { ...context, cli });
    const blame = used.find((entry) => entry.key === 'blame');
    expect(blame?.setAt).toBe('cli');
    expect(blame?.object.id).toBe('(cli)');
    expect(blame?.object.parent?.id).toBe('default');
    expect(itemOf(blame?.object as never, 'R3')).toMatchObject({
      params: { recovery_ok: ['gave_up'] },
      layer: 'cli',
    });
    expect(refusal(() => parseCliOverrides(['policy/blame'], [], registry)).message).toContain(
      'expected <kind>/<id>',
    );
    expect(refusal(() => parseCliOverrides([], ['policy/blame.R3=1'], registry)).message).toContain(
      'expected <kind>[/<id>]#<item>.<param>=<value>',
    );
  });

  it('splits --set at the longest item id of the object, since an item id may hold dots', () => {
    const store = prototypeStore();
    const object = store.resolve('check-set', 'default');
    // `tools.count` is an item: the param is `limit`, never `count.limit` on an item `tools`.
    expect(cliPatch(object, { path: 'tools.count.limit', value: 2, flag: 'f' })).toEqual({
      id: 'tools.count',
      params: { limit: 2 },
    });
    expect(cliPatch(object, { path: 'tools.order.a.b', value: true, flag: 'f' })).toEqual({
      id: 'tools.order',
      params: { a: { b: true } },
    });
    const none = refusal(() =>
      cliPatch(object, { path: 'tools.counts.limit', value: 2, flag: 'check-set#tools.counts.limit=2' }),
    );
    expect(none.code).toBe('OBJECT_ITEM_UNKNOWN');
    expect(none.message).toContain(`it holds ${object.items.map((item) => item.id).join(', ')}`);
    // An item id with nothing after it names no param.
    expect(refusal(() => cliPatch(object, { path: 'tools.count', value: 2, flag: 'f' })).code).toBe(
      'OBJECT_ITEM_UNKNOWN',
    );
    const parsed = parseCliOverrides([], ['check-set#tools.count.limit=2'], store.registry);
    expect(parsed.set).toEqual([
      { kind: 'check-set', path: 'tools.count.limit', value: 2, flag: 'check-set#tools.count.limit=2' },
    ]);
  });

  it('refuses --set on an object id no layer defines, naming the kind, the id and the layers', () => {
    const spec = join(WORKED, 'project', 'specs', 'refund-late-order.yaml');
    const registry = workedRegistry();
    const context = objectContextFor(spec, registry);
    const loaded = parseSpecText(readFileSync(spec, 'utf8'), 'yaml', spec, { objects: context });
    if (!loaded.ok) throw new Error('worked spec');
    const cli = parseCliOverrides([], ['policy/blame/missing#R3.recovery_ok=[gave_up]'], registry);
    const error = refusal(() => resolveBlockObjects(loaded.spec, 0, { ...context, cli }));
    expect(error.code).toBe('OBJECT_UNKNOWN');
    expect(error.message).toBe(
      '--set policy/blame/missing#R3.recovery_ok=[gave_up]: unknown object policy/blame:missing; searched layers shipped, project, suite, spec, block, cli',
    );
  });
});
