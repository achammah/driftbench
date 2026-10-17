import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import {
  type CliOverrides,
  clearObjectContexts,
  explainObject,
  type Layer,
  loadSpecFile,
  type ObjectContext,
  ObjectError,
  type ObjectRegistry,
  type ObjectStore,
  objectContextFor,
  objectRegistry,
  PROJECT_OBJECTS_DIR,
  parseCliOverrides,
  parseObjectText,
  parseSpecText,
  type ResolvedObject,
  resolveBlockObjects,
  type Spec,
  type UsedObject,
} from '@agent-nexus/driftbench-core';
import { objectRegistryKind, openStore, readTree, type SqliteStore } from '@agent-nexus/driftbench-store';
import { loadPersona, type Persona } from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import { stringify } from 'yaml';
import { show, writeOut } from '../files';
import type { Io } from '../io';
import { migratePersona } from './object-migrate';

/**
 * `driftbench object ...`: the objects of the rules framework. An object is a tailorable rule set (a policy,
 * a check set, a diagnostic, a persona) with a kind, an id and addressable items; a project extends a shipped
 * object instead of editing it. The objects a folder sees are the shipped ones, the project's (`driftbench/`
 * beside the nearest `driftbench.yaml`, and its `objects:` key) and the `_driftbench/` suite folders down to
 * it. These commands list, show, explain, compare, start, check, graph, migrate and version them.
 */

type Json = { json?: boolean };
type Overrides = { use?: string[]; set?: string[] };

const collect = (value: string, previous: string[] = []) => [...previous, value];

export function registerObjectCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const object = program
    .command('object')
    .description(
      'The objects of the rules framework: list, show, explain, diff, init, validate, graph, migrate, push.',
    );
  object
    .command('list')
    .description('List every object the working folder sees, with its layer, hash and file.')
    .argument('[kind]', 'only objects of this kind, such as policy/blame')
    .option('--json', 'print one JSON document')
    .action(async (kind: string | undefined, options: Json) => {
      setExit(await listCommand(kind, options, io));
    });
  object
    .command('show')
    .description('Print one resolved object: every item with its value and the layer that set it.')
    .argument('<ref>', '<kind>/<id>, such as policy/blame/acme')
    .option('--json', 'print one JSON document')
    .action(async (ref: string, options: Json) => {
      setExit(await showCommand(ref, options, io));
    });
  object
    .command('explain')
    .description(
      'Print the object a spec or one block uses for a kind, each item with its effective value, layer, file and line.',
    )
    .argument('<kind>', 'the kind, such as policy/value-check')
    .requiredOption('--at <spec>', 'the spec file, or <spec>#<block id> for one block')
    .option('--use <kind/id>', 'the command-line layer: use this object for its kind (repeatable)', collect)
    .option(
      '--set <kind#item.param=value>',
      'the command-line layer: set one parameter of one item (repeatable)',
      collect,
    )
    .option('--json', 'print one JSON document')
    .action(async (kind: string, options: Json & Overrides & { at: string }) => {
      setExit(await explainCommand(kind, options, io));
    });
  object
    .command('diff')
    .description('Compare two objects of one kind item by item. Exit 1 when they differ.')
    .argument('<a>', '<kind>/<id>, or an object file')
    .argument('<b>', '<kind>/<id>, or an object file')
    .option('--json', 'print one JSON document')
    .action(async (a: string, b: string, options: Json) => {
      setExit(await diffCommand(a, b, options, io));
    });
  object
    .command('init')
    .description(
      'Write a project object that extends a parent, every item of the parent listed as a comment with its value.',
    )
    .argument('<kind>', 'the kind, such as policy/blame')
    .argument('<id>', 'the id of the new object')
    .requiredOption('--from <parent>', 'the id of the object it extends, such as default')
    .option('--out <file>', 'where to write it; default driftbench/<kind>/<id>.yaml')
    .action(async (kind: string, id: string, options: { from: string; out?: string }) => {
      setExit(await initCommand(kind, id, options, io));
    });
  object
    .command('validate')
    .description(
      'Check object files, or every object the working folder sees: schema, references, items, order, impls and params.',
    )
    .argument('[paths...]', 'object files or folders; every object of the working folder without them')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: Json) => {
      setExit(await validateCommand(paths, options, io));
    });
  object
    .command('graph')
    .description(
      'Print the objects each block of a spec uses, with where each reference was set and its parents.',
    )
    .argument('<spec>', 'the spec file')
    .option('--json', 'print one JSON document')
    .action(async (spec: string, options: Json) => {
      setExit(await graphCommand(spec, options, io));
    });
  const migrate = object.command('migrate').description('Rewrite an old file as framework objects.');
  migrate
    .command('persona')
    .description(
      'Split old persona files into a persona, a scenario and a situational block, which simulate plays the same way.',
    )
    .argument('<files...>', 'old persona files')
    .option(
      '--out <folder>',
      'the project folder: driftbench/persona/, driftbench/scenario/ and situational/ go under it',
      '.',
    )
    .action(async (files: string[], options: { out: string }) => {
      setExit(await migratePersonaCommand(files, options, io));
    });
  object
    .command('push')
    .description(
      'Store object files of one kind as the next version of <name> in the registry; the same content again changes nothing.',
    )
    .argument('<kind>', 'the kind of every object in <path>')
    .argument('<path>', 'an object file, or a folder of them')
    .requiredOption('--name <name>', 'the registry name: letters, digits, dots, underscores and hyphens')
    .requiredOption('--store <file>', 'the store that keeps the versions')
    .option('--note <text>', 'a note kept with the version')
    .option('--json', 'print one JSON document')
    .action(
      async (kind: string, path: string, options: Json & { name: string; store: string; note?: string }) => {
        setExit(await pushCommand(kind, path, options, io));
      },
    );
}

/** The objects the working folder sees, read afresh: the context of a file placed in it. */
function folderContext(io: Io): ObjectContext {
  clearObjectContexts();
  return objectContextFor(join(io.cwd, 'driftbench.yaml'));
}

/** Prints the problems of a context (object files that do not load); true when there were any. */
function reportProblems(context: ObjectContext, io: Io): boolean {
  for (const problem of context.problems) io.err(`✗ ${describe(problem, io)}\n`);
  return context.problems.length > 0;
}

/** `<kind>/<id>` split at the longest registered kind. */
export function splitRef(
  text: string,
  registry: ObjectRegistry = objectRegistry,
): { kind: string; id?: string } {
  const kinds = registry
    .kinds()
    .map((def) => def.kind)
    .sort((a, b) => b.length - a.length);
  for (const kind of kinds) {
    if (text === kind) return { kind };
    if (text.startsWith(`${kind}/`)) return { kind, id: text.slice(kind.length + 1) };
  }
  throw new ObjectError(
    `${text} names no object kind; the kinds are ${kinds.sort().join(', ')}`,
    'OBJECT_KIND_UNKNOWN',
  );
}

/** The refusal of a kind no one registered, with the kinds there are. */
function unknownKind(kind: string): string {
  const kinds = objectRegistry
    .kinds()
    .map((def) => def.kind)
    .join(', ');
  return `unknown object kind ${kind}; known kinds: ${kinds}`;
}

function describe(cause: unknown, io: Io): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.split(io.cwd + sep).join('');
}

function hash8(object: ResolvedObject): string {
  return object.hash.slice(0, 8);
}

/** `object list`: one row per kind and id, the layer and file that win, and the hash of the resolved object. */
async function listCommand(kind: string | undefined, options: Json, io: Io): Promise<number> {
  const context = folderContext(io);
  if (kind !== undefined && objectRegistry.kind(kind) === undefined) {
    io.err(`${unknownKind(kind)}\n`);
    return 2;
  }
  const rows = context.store.list(kind).map((entry) => {
    try {
      const resolved = context.store.resolve(entry.kind, entry.id);
      return { ...entry, path: entry.layer === 'shipped' ? '' : show(entry.path, io), hash: hash8(resolved) };
    } catch (cause) {
      return { ...entry, path: show(entry.path, io), problem: describe(cause, io) };
    }
  });
  const failed = rows.some((row) => 'problem' in row) || context.problems.length > 0;
  if (options.json) {
    io.out(
      `${JSON.stringify({ objects: rows, problems: context.problems.map((problem) => describe(problem, io)) }, null, 2)}\n`,
    );
    return failed ? 1 : 0;
  }
  if (rows.length === 0)
    io.out(`No object${kind === undefined ? '' : ` of kind ${kind}`} is visible here.\n`);
  const width = (pick: (row: (typeof rows)[number]) => string) =>
    Math.max(0, ...rows.map((row) => pick(row).length));
  const kindWidth = width((row) => row.kind);
  const idWidth = width((row) => row.id);
  for (const row of rows) {
    const status = 'problem' in row ? `✗ ${row.problem}` : row.hash;
    const shadows = row.shadows > 0 ? `  (over ${row.shadows} weaker)` : '';
    io.out(
      `${`${row.kind.padEnd(kindWidth)}  ${row.id.padEnd(idWidth)}  ${row.layer.padEnd(7)}  ${status}  ${row.path}`.trimEnd()}${shadows}\n`,
    );
  }
  reportProblems(context, io);
  return failed ? 1 : 0;
}

/** The resolved object a `<kind>/<id>` names, from the working folder; printed and undefined when it does not resolve. */
function resolveRef(text: string, io: Io, context = folderContext(io)): ResolvedObject | undefined {
  try {
    const { kind, id } = splitRef(text);
    if (id === undefined)
      throw new ObjectError(`${text}: name the id too, as ${kind}/<id>`, 'OBJECT_UNKNOWN');
    return context.store.resolve(kind, id);
  } catch (cause) {
    io.err(`${describe(cause, io)}\n`);
    return undefined;
  }
}

/** A resolved object as JSON: its items with their layer and place, its chain and its hash. */
function objectJson(object: ResolvedObject, io: Io): Record<string, unknown> {
  return {
    kind: object.kind,
    id: object.id,
    ref: object.ref,
    hash: object.hash,
    layer: object.layer,
    path: object.layer === 'shipped' ? undefined : show(object.path, io),
    agent_facing: object.agentFacing,
    chain: object.chain,
    params: object.params,
    fields: object.fields,
    items: object.items.map((item) => ({
      ...item,
      from: item.layer === 'shipped' ? undefined : describe(item.from, io),
    })),
  };
}

/** The explain text with paths relative to the working folder. */
function explainText(object: ResolvedObject, io: Io, at?: string): string {
  return describe(explainObject(object, { ...(at === undefined ? {} : { at }), root: io.cwd }), io);
}

async function showCommand(ref: string, options: Json, io: Io): Promise<number> {
  const object = resolveRef(ref, io);
  if (!object) return 2;
  if (options.json) {
    io.out(`${JSON.stringify(objectJson(object, io), null, 2)}\n`);
    return 0;
  }
  io.out(`${explainText(object, io)}\n`);
  const chain = object.chain.slice(1);
  io.out(
    `${object.layer === 'shipped' ? 'shipped' : `${object.layer} ${show(object.path, io)}`}${chain.length > 0 ? `; extends ${chain.join(' -> ')}` : ''}.\n`,
  );
  return 0;
}

/** A block's name in output: its id, or its place `blocks.<n>` when it has none. */
function blockName(block: { id?: string | undefined }, index: number): string {
  return block.id ?? `blocks.${index}`;
}

/** The index of the block a name gives: its id, or `<n>` or `blocks.<n>` for the block at that place. -1 when none. */
function blockIndex(spec: Spec, name: string): number {
  const byId = spec.blocks.findIndex((block) => block.id === name);
  if (byId >= 0) return byId;
  const place = /^(?:blocks\.)?(\d+)$/.exec(name);
  const at = place === null ? -1 : Number(place[1]);
  return at < spec.blocks.length ? at : -1;
}

/** `<spec>` or `<spec>#<block>`: the spec file and the block named, if any. */
function splitAt(at: string): { file: string; block?: string } {
  const hash = at.lastIndexOf('#');
  return hash <= 0 ? { file: at } : { file: at.slice(0, hash), block: at.slice(hash + 1) };
}

/**
 * Loads a spec for the object commands; printed and undefined when it does not load. A spec the loader refuses
 * only because an object it names does not resolve still loads here, without that pass: the command then
 * resolves the objects itself and reports the one that fails with exit 1, as the object commands document. A
 * spec invalid for any other reason stays an input error.
 */
async function specAt(file: string, io: Io): Promise<{ spec: Spec; path: string } | undefined> {
  const path = resolve(io.cwd, file);
  clearObjectContexts();
  const loaded = await loadSpecFile(path);
  if (loaded.ok) return { spec: loaded.spec, path };
  if (loaded.errors.every((issue) => issue.code.startsWith('OBJECT_'))) {
    const text = await readFile(path, 'utf8').catch(() => undefined);
    const bare =
      text === undefined
        ? undefined
        : parseSpecText(text, extname(path).toLowerCase() === '.json' ? 'json' : 'yaml', path, {
            resolveObjects: false,
          });
    if (bare?.ok) return { spec: bare.spec, path };
  }
  io.err(`✗ ${show(path, io)}\n`);
  for (const issue of loaded.errors)
    io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${describe(issue.message, io)}\n`);
  return undefined;
}

function withOverrides(context: ObjectContext, options: Overrides): ObjectContext {
  if ((options.use ?? []).length === 0 && (options.set ?? []).length === 0) return context;
  const cli: CliOverrides = parseCliOverrides(options.use ?? [], options.set ?? []);
  return { ...context, cli };
}

async function explainCommand(
  kind: string,
  options: Json & Overrides & { at: string },
  io: Io,
): Promise<number> {
  if (objectRegistry.kind(kind) === undefined) {
    io.err(`${unknownKind(kind)}\n`);
    return 2;
  }
  const at = splitAt(options.at);
  const loaded = await specAt(at.file, io);
  if (!loaded) return 2;
  const { spec, path } = loaded;
  let index = -1;
  if (at.block !== undefined) {
    index = blockIndex(spec, at.block);
    if (index < 0) {
      io.err(
        `The spec ${spec.id} has no block ${at.block}. Its blocks: ${spec.blocks.map((block, at) => blockName(block, at)).join(', ')}.\n`,
      );
      return 2;
    }
  }
  let used: UsedObject[];
  try {
    used = resolveBlockObjects(spec, index, withOverrides(objectContextFor(path), options));
  } catch (cause) {
    io.err(`${describe(cause, io)}\n`);
    return 1;
  }
  const where = `${show(path, io)}${at.block === undefined ? '' : `#${at.block}`}`;
  const chosen = used.filter((entry) => entry.object.kind === kind);
  if (options.json) {
    io.out(
      `${JSON.stringify(
        chosen.map((entry) => ({
          key: entry.key,
          set_at: entry.setAt,
          place: describe(entry.place, io),
          object: objectJson(entry.object, io),
        })),
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  if (chosen.length === 0) {
    io.out(`${kind} at ${where}: no layer names one and no shipped default exists.\n`);
    return 0;
  }
  for (const entry of chosen) io.out(`${explainText(entry.object, io, where)}\n`);
  return 0;
}

/** An object from a ref or a file: a file is read at the project layer against the working folder's objects. */
async function objectFromArg(
  arg: string,
  io: Io,
  context: ObjectContext,
): Promise<ResolvedObject | undefined> {
  const path = resolve(io.cwd, arg);
  const isFile = await stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
  if (!isFile) return resolveRef(arg, io, context);
  try {
    const { raw, lines } = parseObjectText(await readFile(path, 'utf8'), path);
    const store = scratchStore(path);
    store.add(raw, 'project', { path, lines }, 1);
    const head = raw as { kind: string; id: string };
    return store.resolve(head.kind, head.id);
  } catch (cause) {
    io.err(`${describe(cause, io)}\n`);
    return undefined;
  }
}

/**
 * The store a file outside the context is checked in: the objects visible from the file's folder, read afresh,
 * so the file is added to a store no other command has cached.
 */
function scratchStore(file: string): ObjectStore {
  return scratchContext(file).store;
}

/** The same context with the problems its folder load found, for a file the folder load has already read. */
function scratchContext(file: string): ObjectContext {
  clearObjectContexts();
  const context = objectContextFor(file);
  clearObjectContexts();
  return context;
}

type ItemChange = { item: string; status: 'added' | 'removed' | 'changed'; fields?: string[] };

/** The item-level differences between two objects: items added or removed, and the fields that differ. */
export function objectDiff(
  a: ResolvedObject,
  b: ResolvedObject,
): { items: ItemChange[]; order: boolean; params: boolean } {
  const before = new Map(a.items.map((item) => [item.id, item]));
  const after = new Map(b.items.map((item) => [item.id, item]));
  const items: ItemChange[] = [];
  for (const [id, item] of before) {
    const other = after.get(id);
    if (!other) {
      items.push({ item: id, status: 'removed' });
      continue;
    }
    const fields = (['title', 'enabled', 'when', 'effect', 'params', 'impl', 'cites'] as const).filter(
      (field) => JSON.stringify(item[field]) !== JSON.stringify(other[field]),
    );
    if (fields.length > 0) items.push({ item: id, status: 'changed', fields: [...fields] });
  }
  for (const id of after.keys()) if (!before.has(id)) items.push({ item: id, status: 'added' });
  const shared = (from: ResolvedObject, other: ResolvedObject) =>
    from.items.filter((item) => other.items.some((each) => each.id === item.id)).map((item) => item.id);
  const order = JSON.stringify(shared(a, b)) !== JSON.stringify(shared(b, a));
  const params =
    JSON.stringify(a.params) !== JSON.stringify(b.params) ||
    JSON.stringify(a.fields) !== JSON.stringify(b.fields);
  return { items, order, params };
}

function short(value: unknown): string {
  return value === undefined ? '(none)' : JSON.stringify(value);
}

async function diffCommand(left: string, right: string, options: Json, io: Io): Promise<number> {
  const context = folderContext(io);
  const a = await objectFromArg(left, io, context);
  const b = a === undefined ? undefined : await objectFromArg(right, io, context);
  if (!a || !b) return 2;
  if (a.kind !== b.kind) {
    io.err(`${a.ref} and ${b.ref} are of two kinds: diff compares objects of one kind.\n`);
    return 2;
  }
  const diff = objectDiff(a, b);
  const differs = diff.items.length > 0 || diff.order || diff.params;
  if (options.json) {
    io.out(`${JSON.stringify({ from: a.ref, to: b.ref, ...diff }, null, 2)}\n`);
    return differs ? 1 : 0;
  }
  if (!differs) {
    io.out(`No difference between ${a.ref} and ${b.ref}: the same items, values and order.\n`);
    return 0;
  }
  const before = new Map(a.items.map((item) => [item.id, item]));
  const after = new Map(b.items.map((item) => [item.id, item]));
  const mark = { added: 'A', removed: 'D', changed: 'M' } as const;
  for (const change of diff.items) {
    io.out(`${mark[change.status]} ${change.item}\n`);
    for (const field of change.fields ?? []) {
      const was = before.get(change.item)?.[field as 'params'];
      const now = after.get(change.item)?.[field as 'params'];
      io.out(`    ${field}: ${short(was)} -> ${short(now)}\n`);
    }
  }
  if (diff.order) {
    const order = (object: ResolvedObject) => object.items.map((item) => item.id).join(', ');
    io.out(`order: ${order(a)} -> ${order(b)}\n`);
  }
  if (diff.params)
    io.out(
      `object params or fields: ${short({ ...a.params, ...a.fields })} -> ${short({ ...b.params, ...b.fields })}\n`,
    );
  const count = diff.items.length;
  io.out(
    `${count} item${count === 1 ? '' : 's'} differ${count === 1 ? 's' : ''} between ${a.ref} and ${b.ref}.\n`,
  );
  return 1;
}

/** The text of a new object that extends `parent`: every parent item as a comment, with its current value. */
export function initText(kind: string, id: string, parent: ResolvedObject): string {
  const flow = (value: unknown) => stringify(value, { collectionStyle: 'flow', lineWidth: 0 }).trim();
  const lines = [
    `# ${kind}/${id} extends ${parent.id}@${hash8(parent)}. Every item of ${parent.id} is listed below as a comment with`,
    '# its current value. To change items, replace `items: []` with a list of their ids and only the fields to',
    `# change: a field left out keeps the value of ${parent.id}. A new item needs add: true, title, when, effect, impl.`,
    `kind: ${kind}`,
    `id: ${id}`,
    `extends: ${parent.id}`,
    'items: []',
  ];
  for (const item of parent.items) {
    lines.push(`#  - id: ${item.id}`);
    lines.push(`#    title: ${flow(item.title)}`);
    lines.push(`#    enabled: ${item.enabled}`);
    for (const field of ['when', 'effect', 'params'] as const) {
      if (Object.keys(item[field]).length > 0) lines.push(`#    ${field}: ${flow(item[field])}`);
    }
    lines.push(`#    impl: ${item.impl}`);
  }
  if (parent.items.length > 1) lines.push(`# order: [${parent.items.map((item) => item.id).join(', ')}]`);
  return `${lines.join('\n')}\n`;
}

async function initCommand(
  kind: string,
  id: string,
  options: { from: string; out?: string },
  io: Io,
): Promise<number> {
  if (objectRegistry.kind(kind) === undefined) {
    io.err(`${unknownKind(kind)}\n`);
    return 2;
  }
  const context = folderContext(io);
  if (context.store.has(kind, id)) {
    const held = context.store.list(kind).find((entry) => entry.id === id);
    const where = held?.layer === 'shipped' ? 'shipped' : `${held?.layer} ${show(held?.path ?? '', io)}`;
    io.err(`${kind}/${id} already exists (${where}): pick another id.\n`);
    return 2;
  }
  const parent = resolveRef(`${kind}/${options.from}`, io, context);
  if (!parent) return 2;
  const out = resolve(io.cwd, options.out ?? join(PROJECT_OBJECTS_DIR, ...kind.split('/'), `${id}.yaml`));
  if (
    await stat(out).then(
      () => true,
      () => false,
    )
  ) {
    io.err(`${show(out, io)} already exists: nothing was written.\n`);
    return 2;
  }
  if (!(await writeOut(out, initText(kind, id, parent), io))) return 2;
  io.out(
    `Wrote ${show(out, io)}: ${kind}/${id} extends ${parent.id}@${hash8(parent)}, ${parent.items.length} items listed.\n`,
  );
  return 0;
}

/** Every object file under a path: the file itself, or each *.yaml and *.yml below a folder. */
async function objectFiles(path: string): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const { files } = await readTree(path);
  return files
    .filter((file) => /\.ya?ml$/i.test(file.path))
    .map((file) => join(path, ...file.path.split('/')));
}

type Verdict = { path: string; ref?: string; problem?: string };

/** `uses.yaml` in a `driftbench/` or `_driftbench/` folder names objects; it holds no object itself. */
function isUsesFile(file: string): boolean {
  return basename(file) === 'uses.yaml' && ['driftbench', '_driftbench'].includes(basename(dirname(file)));
}

async function validateCommand(paths: readonly string[], options: Json, io: Io): Promise<number> {
  const context = folderContext(io);
  const verdicts: Verdict[] = [];
  if (paths.length === 0) {
    for (const problem of context.problems) verdicts.push({ path: '', problem: describe(problem, io) });
    for (const entry of context.store.list()) {
      try {
        verdicts.push({
          path: entry.layer === 'shipped' ? 'shipped' : show(entry.path, io),
          ref: context.store.resolve(entry.kind, entry.id).ref,
        });
      } catch (cause) {
        verdicts.push({ path: show(entry.path, io), problem: describe(cause, io) });
      }
    }
  } else {
    for (const arg of paths) {
      const path = resolve(io.cwd, arg);
      let files: string[];
      try {
        files = await objectFiles(path);
      } catch (cause) {
        io.err(`Cannot read ${arg}: ${describe(cause, io)}\n`);
        return 2;
      }
      for (const file of files) {
        const { store, problems } = scratchContext(file);
        // A file under driftbench/ or _driftbench/ that the folder load refuses stops every spec of the project:
        // the verdict of the folder load stands, whatever the file would resolve to alone.
        const refused = problems.find((problem) => problem.message.includes(file));
        if (refused !== undefined) {
          verdicts.push({ path: show(file, io), problem: describe(refused, io) });
          continue;
        }
        if (isUsesFile(file)) {
          verdicts.push({ path: show(file, io), ref: 'uses' });
          continue;
        }
        try {
          const { raw, lines } = parseObjectText(await readFile(file, 'utf8'), file);
          store.add(raw, 'project', { path: file, lines }, 1);
          const head = raw as { kind: string; id: string };
          verdicts.push({ path: show(file, io), ref: store.resolve(head.kind, head.id).ref });
        } catch (cause) {
          verdicts.push({ path: show(file, io), problem: describe(cause, io) });
        }
      }
    }
  }
  const failed = verdicts.filter((verdict) => verdict.problem !== undefined);
  if (options.json) {
    io.out(`${JSON.stringify({ valid: failed.length === 0, objects: verdicts }, null, 2)}\n`);
    return failed.length === 0 ? 0 : 1;
  }
  for (const verdict of verdicts) {
    if (verdict.problem === undefined) io.out(`✓ ${verdict.ref}  ${verdict.path}\n`);
    else io.out(`✗ ${verdict.problem}\n`);
  }
  const count = verdicts.length;
  io.out(
    failed.length === 0
      ? `${count} object${count === 1 ? '' : 's'} valid.\n`
      : `${failed.length} of ${count} object${count === 1 ? '' : 's'} refused.\n`,
  );
  return failed.length === 0 ? 0 : 1;
}

async function graphCommand(file: string, options: Json, io: Io): Promise<number> {
  const loaded = await specAt(file, io);
  if (!loaded) return 2;
  const { spec, path } = loaded;
  const context = objectContextFor(path);
  const rows: Array<{
    block: string;
    uses: Array<{ key: string; set_at: Layer; place: string; object: string; chain: string[] }>;
  }> = [];
  try {
    for (const [index, block] of spec.blocks.entries()) {
      rows.push({
        block: blockName(block, index),
        uses: resolveBlockObjects(spec, index, context).map((entry) => ({
          key: entry.key,
          set_at: entry.setAt,
          place: describe(entry.place, io),
          object: entry.object.ref,
          chain: entry.object.chain.slice(1),
        })),
      });
    }
  } catch (cause) {
    io.err(`${describe(cause, io)}\n`);
    return 1;
  }
  if (options.json) {
    io.out(`${JSON.stringify({ spec: spec.id, path: show(path, io), blocks: rows }, null, 2)}\n`);
    return 0;
  }
  io.out(`${spec.id} (${show(path, io)})\n`);
  for (const row of rows) {
    io.out(`  ${row.block}\n`);
    if (row.uses.length === 0) io.out('    no object\n');
    for (const use of row.uses) {
      const where = use.set_at === 'shipped' ? 'shipped default' : `${use.set_at} ${use.place}`;
      const parents = use.chain.length > 0 ? `, extends ${use.chain.join(' -> ')}` : '';
      io.out(`    ${use.key} -> ${use.object}  (${where}${parents})\n`);
    }
  }
  return 0;
}

/** `object migrate persona`: reads every file first, and writes nothing when any does not load. */
export async function migratePersonaCommand(
  files: readonly string[],
  options: { out: string },
  io: Io,
): Promise<number> {
  const out = resolve(io.cwd, options.out);
  const loaded: { persona: Persona; path: string }[] = [];
  let failed = false;
  for (const file of files) {
    const path = resolve(io.cwd, file);
    try {
      loaded.push({ persona: await loadPersona(path), path });
    } catch (cause) {
      io.err(`${describe(cause, io)}\n`);
      failed = true;
    }
  }
  const ids = new Map<string, string>();
  for (const { persona, path } of loaded) {
    const earlier = ids.get(persona.id);
    if (earlier !== undefined) {
      io.err(`${show(path, io)}: the persona ${persona.id} is also in ${show(earlier, io)}\n`);
      failed = true;
    }
    ids.set(persona.id, path);
  }
  if (failed) {
    io.err('Nothing was written.\n');
    return 2;
  }
  const root = objectContextFor(join(out, 'driftbench.yaml')).root;
  if (root !== undefined && resolve(root) !== out) {
    io.err(
      `${show(out, io)} is inside the project at ${show(root, io)}, whose driftbench.yaml the specs here read: run from there or pass --out ${show(root, io)}. Nothing was written.\n`,
    );
    return 2;
  }
  const planned = loaded.map(({ persona, path }) => ({
    persona,
    migrated: migratePersona(persona, path, out),
  }));
  const existing: string[] = [];
  for (const { migrated } of planned) {
    for (const file of migrated.texts.keys()) {
      const target = join(out, file);
      if (
        await stat(target).then(
          () => true,
          () => false,
        )
      )
        existing.push(show(target, io));
    }
  }
  if (existing.length > 0) {
    for (const target of existing) io.err(`${target} already exists: nothing was written.\n`);
    return 2;
  }
  const config = join(out, 'driftbench.yaml');
  if (
    !(await stat(config).then(
      () => true,
      () => false,
    ))
  ) {
    if (
      !(await writeOut(
        config,
        '# The project config. The project objects are read from driftbench/ beside it.\n',
        io,
      ))
    )
      return 2;
    io.out(`Wrote ${show(config, io)}: the project objects under driftbench/ are read beside it.\n`);
  }
  for (const { persona, migrated } of planned) {
    for (const [file, text] of migrated.texts) {
      if (!(await writeOut(join(out, file), text, io))) return 2;
    }
    io.out(
      `Migrated ${persona.id}: ${[migrated.persona, migrated.scenario, migrated.situational].map((file) => file.split(sep).join('/')).join(', ')} under ${show(out, io)}.\n`,
    );
  }
  return 0;
}

async function pushCommand(
  kind: string,
  path: string,
  options: Json & { name: string; store: string; note?: string },
  io: Io,
): Promise<number> {
  if (objectRegistry.kind(kind) === undefined) {
    io.err(`${unknownKind(kind)}\n`);
    return 2;
  }
  const source = resolve(io.cwd, path);
  let tree: Awaited<ReturnType<typeof readTree>>;
  try {
    tree = await readTree(source);
  } catch (cause) {
    io.err(`Cannot read ${path}: ${describe(cause, io)}\n`);
    return 2;
  }
  const yaml = tree.files.filter((file) => /\.ya?ml$/i.test(file.path));
  if (yaml.length === 0) {
    io.err(`${path} holds no object file: push a *.yaml object file or a folder of them.\n`);
    return 2;
  }
  let invalid = 0;
  for (const file of yaml) {
    const full = tree.single ? source : join(source, ...file.path.split('/'));
    const store = scratchStore(full);
    try {
      const { raw, lines } = parseObjectText(new TextDecoder().decode(file.bytes), full);
      const head = raw as { kind?: unknown; id?: unknown };
      if (head.kind !== kind) {
        throw new ObjectError(
          `${full}: holds an object of kind ${String(head.kind)}, not ${kind}`,
          'OBJECT_INVALID',
        );
      }
      store.add(raw, 'project', { path: full, lines }, 1);
      store.resolve(kind, String(head.id));
    } catch (cause) {
      io.err(`✗ ${describe(cause, io)}\n`);
      invalid += 1;
    }
  }
  if (invalid > 0) {
    io.err('Fix the invalid objects first: nothing was pushed.\n');
    return 1;
  }
  let store: SqliteStore;
  try {
    store = openStore(resolve(io.cwd, options.store));
  } catch (cause) {
    io.err(`Cannot open the store at ${options.store}: ${describe(cause, io)}\n`);
    return 2;
  }
  try {
    const registryKind = objectRegistryKind(kind);
    const pushed = await store.pushVersion(registryKind, options.name, tree.files, {
      source,
      single: tree.single,
      ...(options.note === undefined ? {} : { note: options.note }),
    });
    const { version } = pushed;
    const files = `${version.files.length} file${version.files.length === 1 ? '' : 's'}`;
    if (options.json) io.out(`${JSON.stringify({ created: pushed.created, ...version }, null, 2)}\n`);
    else if (pushed.created) {
      io.out(
        `Pushed ${kind} ${version.name}@${version.version} (hash ${version.hash.slice(0, 12)}): ${files} from ${show(source, io)}.\n`,
      );
    } else io.out(`Unchanged: ${kind} ${version.name}@${version.version} already holds these ${files}.\n`);
    return 0;
  } catch (cause) {
    io.err(`${describe(cause, io).replace(/^store: /, '')}\n`);
    return 2;
  } finally {
    await store.close();
  }
}
