import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { type ItemPatch, LAYERS, type Layer, USES_KINDS, Uses } from '../schema/object';
import type { Spec } from '../schema/spec';
import { isPlainObject } from '../spec/normalize';
import {
  initializeShippedObjects,
  type ObjectRegistry,
  ObjectStore,
  objectRegistry,
  type ResolvedObject,
} from './resolve';
import { ObjectError } from './rules';

/** The project folder of user objects, beside `driftbench.yaml`: `driftbench/<kind>/<id>.yaml`. */
export const PROJECT_OBJECTS_DIR = 'driftbench';
/** A suite folder of objects, inside a spec folder: `_driftbench/<kind>/<id>.yaml`. */
export const SUITE_OBJECTS_DIR = '_driftbench';
/** The file in a project or suite objects folder that says which objects the specs below it use. */
export const USES_FILE = 'uses.yaml';

/** A `uses` map read from a project or suite folder. */
export type LayerUses = { layer: 'project' | 'suite'; rank: number; path: string; uses: Uses };

/** Command-line overrides: `--use <kind>/<id>` and `--set <kind>[/<id>]#<item>.<param>=<value>`. */
export type CliOverrides = {
  use: ReadonlyMap<string, string>;
  /**
   * Each `--set`: the kind, the object id when the flag names one, the dotted `<item>.<param>` text after `#`
   * (split against the object's item ids when it resolves, since an item id may hold dots) and the value.
   */
  set: ReadonlyArray<{ kind: string; id?: string; path: string; value: unknown; flag: string }>;
};

/** Everything a spec at one place resolves its objects against. */
export type ObjectContext = {
  store: ObjectStore;
  /** The `uses` maps of the project and suite folders, strongest first. */
  uses: readonly LayerUses[];
  /** Object files that could not be read; reported as load errors of every spec that resolves objects. */
  problems: readonly ObjectError[];
  /** The project root: the folder of `driftbench.yaml`, when one was found. */
  root?: string;
  cli?: CliOverrides;
};

type Discovered = { root?: string; suites: string[] };
/** Compatibility hook: contexts are read afresh, so there is no process cache to clear. */
export function clearObjectContexts(): void {}

/**
 * The objects visible from a spec file: the shipped ones, the project's (`driftbench/` beside the nearest
 * `driftbench.yaml`, and its `objects:` key), and every `_driftbench/` suite folder from the project root down
 * to the spec's folder, a nearer one stronger. The search stops at the project root, else at the repository
 * root (a folder holding `.git`). Each load reads fresh files; a loaded spec keeps its own context snapshot.
 */
export function objectContextFor(specPath: string, registry: ObjectRegistry = objectRegistry): ObjectContext {
  const dir = dirname(resolve(specPath));
  const found = discover(dir);
  const store = new ObjectStore(registry);
  const uses: LayerUses[] = [];
  const problems: ObjectError[] = [];
  const attempt = (action: () => void) => {
    try {
      action();
    } catch (cause) {
      problems.push(cause instanceof ObjectError ? cause : new ObjectError(String(cause), 'OBJECT_INVALID'));
    }
  };
  if (found.root !== undefined) {
    const root = found.root;
    attempt(() => addConfigObjects(store, join(root, 'driftbench.yaml')));
    const folder = join(root, PROJECT_OBJECTS_DIR);
    if (isDir(folder)) attempt(() => addObjectFolder(store, folder, 'project', 0, uses, problems));
  }
  found.suites.forEach((folder, depth) => {
    attempt(() => addObjectFolder(store, folder, 'suite', depth, uses, problems));
  });
  uses.sort((a, b) => (a.layer === b.layer ? b.rank - a.rank : a.layer === 'suite' ? -1 : 1));
  const context: ObjectContext = {
    store,
    uses,
    problems,
    ...(found.root === undefined ? {} : { root: found.root }),
  };
  return context;
}

/** A context with the shipped objects only: what a spec read from text, with no folder, resolves against. */
export function shippedObjectContext(registry: ObjectRegistry = objectRegistry): ObjectContext {
  return { store: new ObjectStore(registry), uses: [], problems: [] };
}

function discover(dir: string): Discovered {
  let result: Discovered;
  const suite = join(dir, SUITE_OBJECTS_DIR);
  const own = isDir(suite) ? [suite] : [];
  if (existsSync(join(dir, 'driftbench.yaml'))) {
    result = { root: dir, suites: own };
  } else if (existsSync(join(dir, '.git')) || dirname(dir) === dir) {
    result = { suites: own };
  } else {
    const above = discover(dirname(dir));
    result = { ...(above.root === undefined ? {} : { root: above.root }), suites: [...above.suites, ...own] };
  }
  return result;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The inline objects of `driftbench.yaml`'s `objects:` key, at the project layer. */
function addConfigObjects(store: ObjectStore, file: string): void {
  if (!existsSync(file)) return;
  let config: unknown;
  try {
    config = parseYaml(readFileSync(file, 'utf8'));
  } catch {
    // The project config loader reports a file that does not parse; the objects key is read from a valid one.
    return;
  }
  if (!isPlainObject(config) || config.objects === undefined) return;
  if (!Array.isArray(config.objects)) {
    throw new ObjectError(`${file}: objects is a list of object definitions`, 'OBJECT_INVALID');
  }
  config.objects.forEach((raw, index) => {
    store.add(raw, 'project', { path: `${file}#objects.${index}` });
  });
}

/**
 * Reads one objects folder: every `<kind>/<id>.yaml` below it (the file's kind and id must match its place) and
 * its `uses.yaml`. A file that cannot be read is a problem, never skipped in silence.
 */
function addObjectFolder(
  store: ObjectStore,
  folder: string,
  layer: 'project' | 'suite',
  rank: number,
  uses: LayerUses[],
  problems: ObjectError[],
): void {
  for (const file of yamlFiles(folder)) {
    const rel = relative(folder, file).split(sep).join('/');
    try {
      if (rel === USES_FILE) {
        const parsed = Uses.safeParse(parseYaml(readFileSync(file, 'utf8')) ?? {});
        if (!parsed.success) {
          throw new ObjectError(
            `${file}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'uses'}: ${issue.message}`).join('; ')}`,
            'OBJECT_INVALID',
          );
        }
        uses.push({ layer, rank, path: file, uses: parsed.data });
        continue;
      }
      const head = store.addFile(file, layer, rank);
      const want = `${head.kind}/${head.id}.yaml`;
      if (rel !== want && rel !== want.replace(/\.yaml$/, '.yml')) {
        throw new ObjectError(
          `${file}: holds ${head.kind}:${head.id}, so it belongs at ${want} in ${folder}`,
          'OBJECT_INVALID',
        );
      }
    } catch (cause) {
      problems.push(
        cause instanceof ObjectError ? cause : new ObjectError(`${file}: ${String(cause)}`, 'OBJECT_INVALID'),
      );
    }
  }
}

function yamlFiles(folder: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith('.')) continue;
    const full = join(folder, entry.name);
    if (entry.isDirectory()) out.push(...yamlFiles(full));
    else if (/\.ya?ml$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/** One object a block uses: the key that names it, where the reference was set, and the object. */
export type UsedObject = {
  key: keyof typeof USES_KINDS;
  /** The layer whose reference chose the object. `shipped` when no layer named one and the default applies. */
  setAt: Layer;
  /** The spec path, file or flag that set the reference. */
  place: string;
  object: ResolvedObject;
};

type Reference = { ref: unknown; setAt: Layer; place: string };

/** The reference for one `uses` key at one block: the strongest layer that sets it. */
function referenceOf(
  spec: Pick<Spec, 'uses' | 'blocks'>,
  blockIndex: number,
  key: keyof typeof USES_KINDS,
  context: ObjectContext,
): Reference | undefined {
  const block = spec.blocks[blockIndex];
  const blockRef = block?.uses?.[key];
  if (blockRef !== undefined)
    return { ref: blockRef, setAt: 'block', place: `blocks.${blockIndex}.uses.${key}` };
  const specRef = spec.uses?.[key];
  if (specRef !== undefined) return { ref: specRef, setAt: 'spec', place: `uses.${key}` };
  for (const layer of context.uses) {
    const ref = layer.uses[key];
    if (ref !== undefined) return { ref, setAt: layer.layer, place: layer.path };
  }
  return undefined;
}

/**
 * The objects one block uses, key by key: the command line, then the block, the spec, the suite and project
 * `uses.yaml` files; a key no layer sets resolves to the shipped `default` of its kind, when one is
 * registered. `explicitOnly` resolves only what a layer names, as the loader checks it.
 */
export function resolveBlockObjects(
  spec: Pick<Spec, 'uses' | 'blocks'>,
  blockIndex: number,
  context: ObjectContext,
  options: { explicitOnly?: boolean } = {},
): UsedObject[] {
  // Every named target must exist, before kind-specific branches can skip it, including unselected objects.
  const namedTargets = new Map<string, { kind: string; id: string }>();
  for (const set of context.cli?.set ?? []) {
    if (set.id === undefined || /^\([a-z]+\)$/.test(set.id)) continue;
    if (!context.store.has(set.kind, set.id)) {
      throw new ObjectError(
        `--set ${set.flag}: unknown object ${set.kind}:${set.id}; searched layers ${LAYERS.join(', ')}`,
        'OBJECT_UNKNOWN',
        `--set ${set.flag}`,
      );
    }
    namedTargets.set(`${set.kind}:${set.id}`, { kind: set.kind, id: set.id });
  }
  // The objects that took their flags: every flag an object receives is applied together and its combined
  // params are validated once. The object a kind selects receives its named flags and the kind-only flags of
  // its kind, in the order given.
  const applied = new Set<string>();
  const applySets = (object: ResolvedObject): ResolvedObject => {
    applied.add(`${object.kind}:${object.id}`);
    const sets = (context.cli?.set ?? []).filter(
      (set) => set.kind === object.kind && (set.id === undefined || set.id === object.id),
    );
    return sets.length === 0
      ? object
      : context.store.resolveCli(
          object,
          sets.map((set) => cliPatch(object, set)),
        );
  };
  const out: UsedObject[] = [];
  for (const key of Object.keys(USES_KINDS) as Array<keyof typeof USES_KINDS>) {
    const kind = USES_KINDS[key];
    const cliId = key === 'diagnostics' ? undefined : context.cli?.use.get(kind);
    const reference: Reference | undefined =
      cliId !== undefined
        ? { ref: cliId, setAt: 'cli', place: `--use ${kind}/${cliId}` }
        : referenceOf(spec, blockIndex, key, context);
    if (key === 'diagnostics') {
      const ids = (reference?.ref as string[] | undefined) ?? [];
      const unresolved = (context.cli?.set ?? []).find(
        (set) => set.kind === kind && (set.id === undefined ? ids.length === 0 : /^\([a-z]+\)$/.test(set.id)),
      );
      if (unresolved)
        throw new ObjectError(
          `--set ${unresolved.flag}: unknown object ${kind}:${unresolved.id ?? 'default'}; searched layers ${LAYERS.join(', ')}`,
          'OBJECT_UNKNOWN',
          `--set ${unresolved.flag}`,
        );
      for (const id of ids) {
        out.push({
          key,
          setAt: reference?.setAt ?? 'shipped',
          place: reference?.place ?? '',
          object: applySets(withPlace(() => context.store.resolve(kind, id), reference?.place)),
        });
      }
      continue;
    }
    const forKind = (context.cli?.set ?? []).filter((set) => set.kind === kind);
    let object: ResolvedObject | undefined;
    if (reference !== undefined) {
      object = withPlace(
        () => context.store.resolveRef(kind, reference.ref as never, reference.setAt, reference.place),
        reference.place,
      );
    } else if (
      (!options.explicitOnly || forKind.some((set) => set.id === undefined)) &&
      context.store.has(kind, 'default')
    ) {
      // A kind-only --set explicitly targets the effective default, even during loader preflight.
      object = context.store.resolve(kind, 'default');
    }
    if (object === undefined) {
      const unresolved = forKind.find((set) => set.id === undefined || /^\([a-z]+\)$/.test(set.id));
      if (unresolved)
        throw new ObjectError(
          `--set ${unresolved.flag}: unknown object ${kind}:${unresolved.id ?? 'default'}; searched layers ${LAYERS.join(', ')}`,
          'OBJECT_UNKNOWN',
          `--set ${unresolved.flag}`,
        );
      continue;
    }
    object = applySets(object);
    out.push({ key, setAt: reference?.setAt ?? 'shipped', place: reference?.place ?? '', object });
  }
  // A named object this block does not select is never used, so it takes only the flags that name it; it is
  // still validated, so a mistake in a flag for an unselected object is refused.
  for (const { kind, id } of namedTargets.values()) {
    if (applied.has(`${kind}:${id}`)) continue;
    const target = context.store.resolve(kind, id);
    context.store.resolveCli(
      target,
      (context.cli?.set ?? [])
        .filter((set) => set.kind === kind && set.id === id)
        .map((set) => cliPatch(target, set)),
    );
  }
  return out;
}

function withPlace<T>(action: () => T, place: string | undefined): T {
  try {
    return action();
  } catch (cause) {
    if (cause instanceof ObjectError && place !== undefined && place !== '' && cause.place === undefined) {
      throw new ObjectError(
        cause.message.startsWith(place) ? cause.message : `${place}: ${cause.message}`,
        cause.code,
        place,
      );
    }
    throw cause;
  }
}

/**
 * The item patch of one `--set`: the longest prefix of its dotted path that is an item id of the object, then the
 * rest as the param path. A path that starts with no item id of the object, or names no param after it, is refused
 * with the object's items.
 */
export function cliPatch(
  object: ResolvedObject,
  set: { path: string; value: unknown; flag: string },
): ItemPatch {
  const ids = object.items.map((item) => item.id);
  const parts = set.path.split('.');
  for (let cut = parts.length - 1; cut >= 1; cut -= 1) {
    const item = parts.slice(0, cut).join('.');
    if (!ids.includes(item)) continue;
    const params: Record<string, unknown> = {};
    let cursor = params;
    const rest = parts.slice(cut);
    rest.forEach((part, index) => {
      if (index === rest.length - 1) cursor[part] = set.value;
      else {
        const child: Record<string, unknown> = {};
        cursor[part] = child;
        cursor = child;
      }
    });
    return { id: item, params };
  }
  throw new ObjectError(
    `--set ${set.flag}: no item of ${object.kind}:${object.id} starts ${set.path}; it holds ${ids.length === 0 ? 'no items' : ids.join(', ')}, and a param follows the item id`,
    'OBJECT_ITEM_UNKNOWN',
    `--set ${set.flag}`,
  );
}

/** Splits `<kind>/<id>` at the longest registered kind. */
function splitKindId(text: string, registry: ObjectRegistry): { kind: string; id?: string } | undefined {
  const kinds = registry
    .kinds()
    .map((def) => def.kind)
    .sort((a, b) => b.length - a.length);
  for (const kind of kinds) {
    if (text === kind) return { kind };
    if (text.startsWith(`${kind}/`)) return { kind, id: text.slice(kind.length + 1) };
  }
  return undefined;
}

/**
 * Reads the command-line layer: `--use <kind>/<id>` picks the object of a kind, `--set
 * <kind>[/<id>]#<item>.<param>=<value>` sets one parameter of one item (the value is read as YAML: `0.3`, `true`,
 * `[a, b]`). An item id may hold dots, so the item and the param are split when the object resolves: the longest
 * prefix that is an item id of the object (`cliPatch`). A flag that names no known kind, or has no
 * `#<item>.<param>=<value>`, is refused here; an unknown object id or item, when the block's objects resolve.
 */
export function parseCliOverrides(
  useFlags: readonly string[],
  setFlags: readonly string[],
  registry: ObjectRegistry = objectRegistry,
): CliOverrides {
  if (registry === objectRegistry) initializeShippedObjects();
  const use = new Map<string, string>();
  for (const flag of useFlags) {
    const parsed = splitKindId(flag, registry);
    if (!parsed?.id) {
      throw new ObjectError(
        `--use ${flag}: expected <kind>/<id>, such as policy/blame/acme`,
        'OBJECT_INVALID',
      );
    }
    if (use.has(parsed.kind)) throw new ObjectError(`--use names ${parsed.kind} twice`, 'OBJECT_INVALID');
    use.set(parsed.kind, parsed.id);
  }
  const set: Array<{ kind: string; id?: string; path: string; value: unknown; flag: string }> = [];
  for (const flag of setFlags) {
    const match = /^([^#]+)#([A-Za-z0-9_][A-Za-z0-9_.-]*\.[A-Za-z0-9_][A-Za-z0-9_-]*)=(.*)$/s.exec(flag);
    const target = match ? splitKindId(match[1] as string, registry) : undefined;
    if (!match || !target) {
      throw new ObjectError(
        `--set ${flag}: expected <kind>[/<id>]#<item>.<param>=<value>, such as policy/blame#R3.recovery_ok=[asked_user]`,
        'OBJECT_INVALID',
      );
    }
    const [, , path, text] = match as unknown as [string, string, string, string];
    let value: unknown;
    try {
      value = parseYaml(text);
    } catch {
      value = text;
    }
    set.push({ kind: target.kind, ...(target.id === undefined ? {} : { id: target.id }), path, value, flag });
  }
  return { use, set };
}
