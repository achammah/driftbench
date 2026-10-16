import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { Envelope, Item, ItemPatch, LAYERS, type Layer, type ObjectRef } from '../schema/object';
import { contentHash } from '../spec/hash';
import { isPlainObject } from '../spec/normalize';
import { applyItemOperations, mergeFields, ObjectError, type ResolvedItem } from './rules';

/** What a kind declares: whether it is agent-facing, what its files hold beyond the envelope. */
export type KindDef = {
  kind: string;
  /** One line for `object list` and the reference page. */
  summary: string;
  /**
   * An agent-facing object changes what the agent receives (a persona, a run profile): a change reruns the
   * block. A scoring-only object (a policy, a check set, a diagnostic) is re-scored from stored observations.
   */
  agentFacing: boolean;
  /** The name of the item list in a file: `items`, or `steps` for a diagnostic. */
  itemsKey?: string;
  /** Top-level fields the kind accepts beyond the envelope, each optional; checked strictly. */
  fields?: z.ZodRawShape;
};

/** What an implementation declares: the schema its item's params must pass. */
export type ImplDef = {
  params: z.ZodType;
  summary?: string;
};

/** What `ObjectRegistry.snapshot` copies: the kinds, implementations and shipped objects, by name. */
export type RegistrySnapshot = {
  kinds: ReadonlyMap<string, KindDef>;
  impls: ReadonlyMap<string, ImplDef>;
  shipped: ReadonlyMap<string, { raw: unknown; path: string }>;
};

/**
 * The kinds, implementations and shipped objects a process knows. Entry points explicitly initialize shipped definitions;
 * a plugin registers its own. A name registered twice is refused, so no registration replaces another: an
 * override is an object that extends a shipped one, never a second registration of it.
 */
export class ObjectRegistry {
  readonly #kinds = new Map<string, KindDef>();
  readonly #impls = new Map<string, ImplDef>();
  readonly #shipped = new Map<string, { raw: unknown; path: string }>();

  registerKind(def: KindDef): this {
    if (this.#kinds.has(def.kind)) throw new Error(`the object kind ${def.kind} is already registered`);
    const parsed = Envelope.shape.kind.safeParse(def.kind);
    if (!parsed.success) throw new Error(`${def.kind}: ${parsed.error.issues[0]?.message ?? 'invalid kind'}`);
    this.#kinds.set(def.kind, def);
    return this;
  }

  registerImpl(name: string, def: ImplDef): this {
    if (!/^(builtin|plugin):\S+$/.test(name))
      throw new Error(`an implementation is named builtin:<name> or plugin:<name>: ${name}`);
    if (this.#impls.has(name)) throw new Error(`the implementation ${name} is already registered`);
    this.#impls.set(name, def);
    return this;
  }

  /** Registers a shipped object. It is immutable: no other layer can define its kind and id again. */
  registerShipped(raw: unknown, path: string): this {
    const head = Envelope.pick({ kind: true, id: true }).safeParse(
      isPlainObject(raw) ? { kind: raw.kind, id: raw.id } : raw,
    );
    if (!head.success) throw new Error(`${path}: a shipped object needs a kind and an id`);
    const key = `${head.data.kind}:${head.data.id}`;
    if (this.#shipped.has(key)) throw new Error(`the shipped object ${key} is already registered`);
    this.#shipped.set(key, { raw, path });
    return this;
  }

  /** A copy of everything registered, for `restore`. */
  snapshot(): RegistrySnapshot {
    return { kinds: new Map(this.#kinds), impls: new Map(this.#impls), shipped: new Map(this.#shipped) };
  }

  /**
   * Puts back what `snapshot` copied: every kind, implementation and shipped object registered since is
   * forgotten. The command line uses it to undo what the plugins of one run registered.
   */
  restore(snapshot: RegistrySnapshot): void {
    this.#kinds.clear();
    for (const [key, value] of snapshot.kinds) this.#kinds.set(key, value);
    this.#impls.clear();
    for (const [key, value] of snapshot.impls) this.#impls.set(key, value);
    this.#shipped.clear();
    for (const [key, value] of snapshot.shipped) this.#shipped.set(key, value);
  }

  kind(name: string): KindDef | undefined {
    return this.#kinds.get(name);
  }

  impl(name: string): ImplDef | undefined {
    return this.#impls.get(name);
  }

  kinds(): KindDef[] {
    return [...this.#kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  }

  impls(): string[] {
    return [...this.#impls.keys()].sort();
  }

  shipped(): Array<{ raw: unknown; path: string }> {
    return [...this.#shipped.values()];
  }
}

/** The kinds of the first release (config_framework.md 2.1). Packages register their objects and builtins. */
export const BUILTIN_KINDS: readonly KindDef[] = [
  {
    kind: 'policy/value-check',
    summary: 'When a value the agent wrote is the right value.',
    agentFacing: false,
  },
  {
    kind: 'policy/blame',
    summary: 'Who a failure is attributed to, and where its fix goes.',
    agentFacing: false,
  },
  {
    kind: 'policy/placement',
    summary: 'Where a fix goes, by how often a mistake recurs.',
    agentFacing: false,
  },
  {
    kind: 'policy/links',
    summary: 'How blocks link to prompt units, and when a link is stale.',
    agentFacing: false,
  },
  { kind: 'policy/selection', summary: 'Which blocks a change selects.', agentFacing: false },
  { kind: 'policy/gating', summary: 'What not_run, blocked and inconclusive do to ci.', agentFacing: false },
  { kind: 'policy/stats', summary: 'Which interval is the headline.', agentFacing: false },
  { kind: 'check-set', summary: 'The machine checks and their order.', agentFacing: false },
  {
    kind: 'judge-council',
    summary: 'The judges, their mode, assignment and escalation.',
    agentFacing: false,
  },
  {
    kind: 'diagnostic',
    summary: 'A procedure that runs after the checks and writes a diagnosis.',
    agentFacing: false,
    itemsKey: 'steps',
  },
  {
    kind: 'prompt-template',
    summary: 'A model-facing text with named parts and a fingerprint.',
    agentFacing: false,
  },
  {
    kind: 'deviation-class',
    summary: 'A deviation the driver can inject, and its recovery window.',
    agentFacing: true,
  },
  { kind: 'persona', summary: 'Who the simulated user is.', agentFacing: true },
  { kind: 'scenario', summary: 'What the simulated user wants and knows.', agentFacing: true },
  { kind: 'persona-defaults', summary: 'The defaults every persona extends.', agentFacing: true },
  { kind: 'run-profile', summary: 'The run settings: driver, model, seed, trials.', agentFacing: true },
];

/** The registry every loader uses unless it is given another one. */
export const objectRegistry = new ObjectRegistry();
/** Initialize the shared kind vocabulary before resolving objects. Safe across plugin snapshots. */
export function initializeShippedObjects(): void {
  for (const def of BUILTIN_KINDS) if (!objectRegistry.kind(def.kind)) objectRegistry.registerKind(def);
}

/** An object once its `extends` chain and every layer are applied. */
export type ResolvedObject = {
  kind: string;
  /** The object id; `(spec)`, `(block)` or `(cli)` for an inline object written at that layer. */
  id: string;
  /** The layer the object itself is defined at. */
  layer: Layer;
  /** Its file, or the place an inline object is written. */
  path: string;
  agentFacing: boolean;
  /** The items in their resolved order, disabled ones included. */
  items: ResolvedItem[];
  params: Record<string, unknown>;
  /** The kind's own top-level fields, merged along the chain. */
  fields: Record<string, unknown>;
  /** The first 12 hex of the SHA-256 of the canonical resolved content: the identity. Labels and places stay out. */
  hash: string;
  /** `kind:id@hash8`, the form a verdict's `by.object` carries. */
  ref: string;
  /** `kind:id` of this object and of each parent, nearest first. */
  chain: string[];
  parent?: ResolvedObject;
};

/** The item of a resolved object with this id. */
export function itemOf(object: ResolvedObject, id: string): ResolvedItem | undefined {
  return object.items.find((item) => item.id === id);
}

type Entry = {
  kind: string;
  id: string;
  layer: Layer;
  /** Orders entries within a layer: a nearer suite folder ranks higher. */
  rank: number;
  path: string;
  extends?: string | null;
  patches: ItemPatch[];
  order?: string[];
  params?: Record<string, unknown>;
  fields: Record<string, unknown>;
  /** The place of each item operation: `path:line` when the file was read with lines. */
  places: string[];
};

const ENVELOPE_KEYS = new Set(Object.keys(Envelope.shape));
const strength = (entry: Pick<Entry, 'layer' | 'rank'>) =>
  LAYERS.indexOf(entry.layer) * 1_000_000 + entry.rank;

/** Where an object file sits and how to read the line of each item. */
export type ObjectSource = { path: string; lines?: readonly number[] };

/** Reads an object file's text, keeping the line of each item for `explain`. */
export function parseObjectText(text: string, path: string): { raw: unknown; lines: number[] } {
  const doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    throw new ObjectError(
      `${path}: ${doc.errors[0]?.message.split('\n')[0] ?? 'cannot parse'}`,
      'OBJECT_INVALID',
    );
  }
  const raw = doc.toJS();
  const lines: number[] = [];
  if (isPlainObject(raw)) {
    for (const key of ['items', 'steps']) {
      const list = doc.get(key, true) as { items?: Array<{ range?: [number, number, number] }> } | undefined;
      list?.items?.forEach((node, index) => {
        const offset = node.range?.[0];
        if (offset !== undefined) lines[index] = text.slice(0, offset).split('\n').length;
      });
    }
  }
  return { raw, lines };
}

/**
 * The objects visible from one place: the registry's shipped objects, and the files and inline objects added
 * at the project, suite, spec, block and command-line layers. A kind and id defined at several layers resolves
 * to the strongest; the same kind and id twice at one layer, or a shipped one defined again, is refused.
 */
export class ObjectStore {
  readonly registry: ObjectRegistry;
  readonly #entries = new Map<string, Entry[]>();
  #resolved = new WeakMap<Entry, ResolvedObject>();

  constructor(registry: ObjectRegistry = objectRegistry) {
    if (registry === objectRegistry) initializeShippedObjects();
    this.registry = registry;
    for (const { raw, path } of registry.shipped()) this.add(raw, 'shipped', { path });
  }

  /** Adds an object file's parsed content at a layer. */
  add(raw: unknown, layer: Layer, source: ObjectSource, rank = 0): void {
    const entry = this.#entryOf(raw, layer, source, rank);
    const key = `${entry.kind}:${entry.id}`;
    const known = this.#entries.get(key) ?? [];
    const shipped = known.find((other) => other.layer === 'shipped');
    if (shipped && layer !== 'shipped') {
      throw new ObjectError(
        `${source.path}: ${key} is shipped and immutable; write an object with another id that extends it`,
        'OBJECT_SHIPPED_IMMUTABLE',
      );
    }
    const twin = known.find((other) => strength(other) === strength(entry));
    if (twin)
      throw new ObjectError(`${source.path}: ${key} is defined twice (${twin.path})`, 'OBJECT_DUPLICATE');
    known.push(entry);
    known.sort((a, b) => strength(b) - strength(a));
    this.#entries.set(key, known);
    // A new entry can shadow a parent an earlier resolution read.
    this.#resolved = new WeakMap();
  }

  /** Reads one object file at a layer. */
  addFile(path: string, layer: Layer, rank = 0): { kind: string; id: string } {
    const { raw, lines } = parseObjectText(readFileSync(path, 'utf8'), path);
    this.add(raw, layer, { path, lines }, rank);
    const head = raw as { kind: string; id: string };
    return { kind: head.kind, id: head.id };
  }

  /** Every kind and id with the layer and file that wins, sorted by kind and id. */
  list(kind?: string): Array<{ kind: string; id: string; layer: Layer; path: string; shadows: number }> {
    return [...this.#entries.values()]
      .filter((entries) => kind === undefined || entries[0]?.kind === kind)
      .map((entries) => {
        const top = entries[0] as Entry;
        return { kind: top.kind, id: top.id, layer: top.layer, path: top.path, shadows: entries.length - 1 };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  }

  has(kind: string, id: string): boolean {
    return (this.#entries.get(`${kind}:${id}`)?.length ?? 0) > 0;
  }

  /** Resolves `kind:id` at its strongest layer, with its whole `extends` chain. */
  resolve(kind: string, id: string): ResolvedObject {
    return this.#resolveEntry(this.#lookup(kind, id), []);
  }

  /**
   * Resolves a reference written in a spec or a block (`place` names it for messages): an id, or an inline
   * object that extends one, defined at `layer`.
   */
  resolveRef(kind: string, ref: ObjectRef, layer: Layer, place: string): ResolvedObject {
    if (typeof ref === 'string') {
      try {
        return this.resolve(kind, ref);
      } catch (cause) {
        if (cause instanceof ObjectError && cause.code === 'OBJECT_UNKNOWN') {
          throw new ObjectError(`${place}: ${cause.message}`, 'OBJECT_UNKNOWN', place);
        }
        throw cause;
      }
    }
    const entry: Entry = {
      kind,
      id: `(${layer})`,
      layer,
      rank: 0,
      path: place,
      extends: ref.extends,
      patches: ref.items ?? [],
      ...(ref.order === undefined ? {} : { order: ref.order }),
      ...(ref.params === undefined ? {} : { params: ref.params }),
      fields: {},
      places: (ref.items ?? []).map((_, index) => `${place}.items.${index}`),
    };
    return this.#resolveEntry(entry, []);
  }

  /**
   * Resolves an object a command line changes: `--set <kind>[/<id>]#<item>.<param>=<value>` patches applied on
   * top of `base`, as an inline object of the `cli` layer.
   */
  resolveCli(base: ResolvedObject, patches: ItemPatch[], place = 'command line'): ResolvedObject {
    const entry: Entry = {
      kind: base.kind,
      id: '(cli)',
      layer: 'cli',
      rank: 0,
      path: place,
      extends: base.id,
      patches,
      fields: {},
      places: patches.map((patch) => `${place} --set ${base.kind}#${patch.id}`),
    };
    return this.#resolveEntry(entry, [], base);
  }

  #entryOf(raw: unknown, layer: Layer, source: ObjectSource, rank: number): Entry {
    if (!isPlainObject(raw))
      throw new ObjectError(`${source.path}: an object file is a mapping`, 'OBJECT_INVALID');
    const kindName = raw.kind;
    const def = typeof kindName === 'string' ? this.registry.kind(kindName) : undefined;
    if (!def) {
      const known = this.registry
        .kinds()
        .map((k) => k.kind)
        .join(', ');
      throw new ObjectError(
        `${source.path}: unknown object kind ${String(kindName)}; known kinds: ${known}`,
        'OBJECT_KIND_UNKNOWN',
      );
    }
    const itemsKey = def.itemsKey ?? 'items';
    const envelope: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (ENVELOPE_KEYS.has(key)) envelope[key] = value;
      else if (key !== itemsKey) extra[key] = value;
    }
    const head = Envelope.safeParse(envelope);
    if (!head.success) throw new ObjectError(`${source.path}: ${issues(head.error)}`, 'OBJECT_INVALID');
    const fields = z.strictObject(def.fields ?? {}).safeParse(extra);
    if (!fields.success) {
      throw new ObjectError(
        `${source.path}: ${issues(fields.error, `${def.kind} accepts no such key`)}`,
        'OBJECT_INVALID',
      );
    }
    const root = head.data.extends === undefined || head.data.extends === null;
    const list = raw[itemsKey] ?? [];
    const parsedItems = z.array(root ? Item : ItemPatch).safeParse(list);
    if (!parsedItems.success) {
      throw new ObjectError(
        `${source.path}: ${issues(parsedItems.error, root ? 'a root object lists full items (id, title, impl): add, before and after belong to an object that extends another' : undefined, itemsKey)}`,
        root ? 'OBJECT_ITEM_INCOMPLETE' : 'OBJECT_INVALID',
      );
    }
    return {
      kind: head.data.kind,
      id: head.data.id,
      layer,
      rank,
      path: source.path,
      extends: head.data.extends,
      patches: parsedItems.data as ItemPatch[],
      ...(head.data.order === undefined ? {} : { order: head.data.order }),
      ...(head.data.params === undefined ? {} : { params: head.data.params }),
      fields: fields.data,
      places: (parsedItems.data as unknown[]).map((_, index) => {
        const line = source.lines?.[index];
        return line === undefined ? `${source.path}#${itemsKey}.${index}` : `${source.path}:${line}`;
      }),
    };
  }

  #lookup(kind: string, id: string, below?: Entry): Entry {
    if (!this.registry.kind(kind)) {
      const known = this.registry
        .kinds()
        .map((k) => k.kind)
        .join(', ');
      throw new ObjectError(`unknown object kind ${kind}; known kinds: ${known}`, 'OBJECT_KIND_UNKNOWN');
    }
    const entries = this.#entries.get(`${kind}:${id}`) ?? [];
    const found = below ? entries.find((entry) => strength(entry) < strength(below)) : entries[0];
    if (!found) {
      throw new ObjectError(
        `unknown object ${kind}:${id}; searched layers ${LAYERS.join(', ')}`,
        'OBJECT_UNKNOWN',
      );
    }
    return found;
  }

  #resolveEntry(entry: Entry, seen: Entry[], parentObject?: ResolvedObject): ResolvedObject {
    const memo = this.#resolved.get(entry);
    if (memo) return memo;
    const def = this.registry.kind(entry.kind) as KindDef;
    const name = `${entry.kind}:${entry.id}`;
    if (seen.includes(entry)) {
      throw new ObjectError(
        `extends cycle: ${[...seen, entry].map((other) => `${other.kind}:${other.id}`).join(' -> ')}`,
        'OBJECT_CYCLE',
      );
    }
    let items: Map<string, ResolvedItem>;
    let order: string[];
    let params: Record<string, unknown>;
    let fields: Record<string, unknown>;
    let parent: ResolvedObject | undefined;
    if (entry.extends === undefined || entry.extends === null) {
      items = new Map();
      entry.patches.forEach((patch, index) => {
        if (items.has(patch.id))
          throw new ObjectError(`${entry.path}: item ${patch.id} appears twice`, 'OBJECT_INVALID');
        items.set(patch.id, {
          id: patch.id,
          title: patch.title as string,
          enabled: patch.enabled ?? true,
          when: patch.when ?? {},
          effect: patch.effect ?? {},
          params: patch.params ?? {},
          impl: patch.impl as string,
          ...(patch.cites === undefined ? {} : { cites: patch.cites }),
          ...(patch.applies_to === undefined ? {} : { applies_to: patch.applies_to }),
          layer: entry.layer,
          from: entry.places[index] ?? entry.path,
        });
      });
      const applied = applyItemOperations(items, [...items.keys()], {
        name,
        layer: entry.layer,
        places: [],
        patches: [],
        ...(entry.order === undefined ? {} : { order: entry.order }),
      });
      items = applied.items;
      order = applied.order;
      params = entry.params ?? {};
      fields = entry.fields;
    } else {
      // An object that extends its own id reads it from a weaker layer: a suite `acme` can extend the project `acme`.
      parent =
        parentObject ??
        this.#resolveEntry(
          this.#lookup(entry.kind, entry.extends, entry.extends === entry.id ? entry : undefined),
          [...seen, entry],
        );
      const applied = applyItemOperations(
        new Map(parent.items.map((item) => [item.id, item])),
        parent.items.map((item) => item.id),
        {
          name,
          parent: `${parent.kind}:${parent.id}`,
          layer: entry.layer,
          places: entry.places,
          patches: entry.patches,
          ...(entry.order === undefined ? {} : { order: entry.order }),
        },
      );
      items = applied.items;
      order = applied.order;
      params =
        entry.params === undefined
          ? parent.params
          : mergeFields(parent.params, entry.params, `${entry.path}.params`);
      fields = mergeFields(parent.fields, entry.fields, entry.path);
    }
    const ordered = order.map((id) => items.get(id) as ResolvedItem);
    for (const item of ordered) {
      if (!item.enabled) continue;
      const impl = this.registry.impl(item.impl);
      if (!impl) {
        throw new ObjectError(
          `${name}: item ${item.id} names ${item.impl}, which no builtin or plugin provides (${item.from})`,
          'OBJECT_IMPL_UNKNOWN',
        );
      }
      const checked = impl.params.safeParse(item.params);
      if (!checked.success) {
        throw new ObjectError(
          `${name}: item ${item.id} params: ${issues(checked.error, undefined, 'params')} (${item.from})`,
          'OBJECT_PARAMS_INVALID',
        );
      }
    }
    const hash = contentHash({
      kind: entry.kind,
      params,
      fields,
      items: ordered.map(({ layer: _layer, from: _from, ...rest }) => rest),
    });
    const resolved: ResolvedObject = {
      kind: entry.kind,
      id: entry.id,
      layer: entry.layer,
      path: entry.path,
      agentFacing: def.agentFacing,
      items: ordered,
      params,
      fields,
      hash,
      ref: `${entry.kind}:${entry.id}@${hash.slice(0, 8)}`,
      chain: [name, ...(parent?.chain ?? [])],
      ...(parent === undefined ? {} : { parent }),
    };
    this.#resolved.set(entry, resolved);
    return resolved;
  }
}

function issues(error: z.ZodError, unknownKeyHint?: string, prefix?: string): string {
  return error.issues
    .map((issue) => {
      const path = [prefix, ...issue.path.map(String)]
        .filter((part) => part !== undefined && part !== '')
        .join('.');
      const message =
        issue.code === 'unrecognized_keys'
          ? `unknown key${issue.keys.length > 1 ? 's' : ''} ${issue.keys.join(', ')}${unknownKeyHint ? ` (${unknownKeyHint})` : ''}`
          : issue.message.replace(/received undefined$/, 'missing');
      return path === '' ? message : `${path}: ${message}`;
    })
    .join('; ');
}
