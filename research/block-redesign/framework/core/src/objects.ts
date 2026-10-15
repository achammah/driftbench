// Stand-in of the framework's object model (config_framework.md 2.1 to 2.3): objects with items, `extends`,
// item operations (set, disable, replace impl, add, reorder), layers, and refusal of an unknown item.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { contentHash } from '../../../../../packages/core/src/spec/hash.ts';

export type Layer = 'shipped' | 'project' | 'suite' | 'spec' | 'block' | 'cli';
const LAYERS: Layer[] = ['shipped', 'project', 'suite', 'spec', 'block', 'cli'];

const Item = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  when: z.record(z.string(), z.unknown()).optional(),
  effect: z.record(z.string(), z.unknown()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  impl: z.string().regex(/^(builtin|plugin):.+/).optional(),
  cites: z.string().optional(),
});
export type ItemOp = z.infer<typeof Item>;

export const ObjectFile = z.strictObject({
  kind: z.string().min(1),
  id: z.string().min(1),
  version: z.union([z.string(), z.number()]).optional(),
  extends: z.string().min(1).nullable().optional(),
  description: z.string().optional(),
  agent_facing: z.boolean().optional(),
  items: z.array(Item).default([]),
  order: z.array(z.string().min(1)).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type ObjectFile = z.infer<typeof ObjectFile>;

export type ResolvedItem = {
  id: string;
  title: string;
  enabled: boolean;
  when: Record<string, unknown>;
  effect: Record<string, unknown>;
  params: Record<string, unknown>;
  impl: string;
  /** The layer of the last file that set any field of this item. */
  layer: Layer;
  /** file:item index of that file, for `object explain`. */
  from: string;
};

export type ResolvedObject = {
  kind: string;
  id: string;
  agentFacing: boolean;
  items: Map<string, ResolvedItem>;
  order: string[];
  hash: string;
  /** `kind:id@hash8`, the form `Verdict.by.object` carries. */
  ref: string;
  chain: string[];
};

export class LoadError extends Error {}

/** An implementation a resolved item names: a params schema checked at load, and the function the engine calls. */
export type Impl = { params: z.ZodType; run?: unknown };
export type ImplRegistry = Map<string, Impl>;

type Entry = { file: ObjectFile; layer: Layer; path: string };

export class ObjectStore {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly impls: ImplRegistry) {}

  /** Adds an object at a layer. A shipped object is immutable: another layer cannot redefine its kind and id. */
  add(raw: unknown, layer: Layer, path: string): void {
    const parsed = ObjectFile.safeParse(raw);
    if (!parsed.success) {
      throw new LoadError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    const key = `${parsed.data.kind}:${parsed.data.id}`;
    const known = this.entries.get(key);
    if (known) {
      throw new LoadError(
        known.layer === 'shipped'
          ? `${path}: ${key} is shipped and immutable; write an object that extends it`
          : `${path}: ${key} is defined twice (${known.path})`,
      );
    }
    this.entries.set(key, { file: parsed.data, layer, path });
  }

  /** Loads every `*.yaml` under a folder at a layer. */
  addFolder(folder: string, layer: Layer, root = folder): void {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) this.addFolder(full, layer, root);
      else if (/\.ya?ml$/.test(name)) this.add(parseYaml(readFileSync(full, 'utf8')), layer, relative(root, full));
    }
  }

  has(kind: string, id: string): boolean {
    return this.entries.has(`${kind}:${id}`);
  }

  resolve(kind: string, id: string, seen: string[] = []): ResolvedObject {
    const key = `${kind}:${id}`;
    if (seen.includes(key)) throw new LoadError(`extends cycle: ${[...seen, key].join(' -> ')}`);
    const entry = this.entries.get(key);
    if (!entry) {
      throw new LoadError(`unknown object ${key}; searched layers ${LAYERS.join(', ')}`);
    }
    const { file, layer, path } = entry;
    let items: Map<string, ResolvedItem>;
    let order: string[];
    let chain: string[];
    let agentFacing = file.agent_facing ?? false;
    if (file.extends) {
      const parent = this.resolve(kind, file.extends, [...seen, key]);
      items = new Map([...parent.items].map(([k, v]) => [k, { ...v, params: { ...v.params } }]));
      order = [...parent.order];
      chain = [key, ...parent.chain];
      agentFacing = file.agent_facing ?? parent.agentFacing;
      const parentIds = [...parent.items.keys()];
      const unknown = (what: string) =>
        new LoadError(
          `unknown item ${what} in ${key} (${path}); the parent ${kind}:${file.extends} holds ${parentIds.join(', ')}`,
        );
      file.items.forEach((op, index) => {
        const from = `${path}#items.${index}`;
        const known = items.get(op.id);
        if (known) {
          const next: ResolvedItem = {
            ...known,
            ...(op.title === undefined ? {} : { title: op.title }),
            ...(op.enabled === undefined ? {} : { enabled: op.enabled }),
            ...(op.when === undefined ? {} : { when: op.when }),
            ...(op.effect === undefined ? {} : { effect: op.effect }),
            ...(op.impl === undefined ? {} : { impl: op.impl }),
            params: { ...known.params, ...op.params },
            layer,
            from,
          };
          items.set(op.id, next);
        } else if (op.title !== undefined && op.impl !== undefined) {
          // add: a new rule needs its full definition
          items.set(op.id, fullItem(op, layer, from));
          order.push(op.id);
        } else {
          throw unknown(op.id);
        }
      });
      if (file.order) {
        for (const name of file.order) if (!items.has(name)) throw unknown(name);
        order = file.order;
      }
    } else {
      items = new Map();
      chain = [key];
      file.items.forEach((op, index) => {
        if (items.has(op.id)) throw new LoadError(`${path}: item ${op.id} appears twice`);
        if (op.title === undefined || op.impl === undefined) {
          throw new LoadError(`${path}: root item ${op.id} needs title and impl`);
        }
        items.set(op.id, fullItem(op, layer, `${path}#items.${index}`));
      });
      order = file.order ?? [...items.keys()];
      for (const name of order) if (!items.has(name)) throw new LoadError(`${path}: order names unknown item ${name}`);
    }
    // order must be a permutation of the enabled items: every enabled item once, nothing unknown
    const enabled = [...items.values()].filter((item) => item.enabled).map((item) => item.id);
    const listed = order.filter((name) => items.get(name)?.enabled);
    if (new Set(order).size !== order.length) throw new LoadError(`${key}: order lists an item twice`);
    for (const name of enabled) if (!listed.includes(name)) throw new LoadError(`${key}: order leaves out enabled item ${name}`);
    // every enabled item's impl exists and its params match the impl's schema
    for (const item of items.values()) {
      if (!item.enabled) continue;
      const impl = this.impls.get(item.impl);
      if (!impl) throw new LoadError(`${key}: item ${item.id} names ${item.impl}, which no builtin or plugin provides`);
      const checked = impl.params.safeParse(item.params);
      if (!checked.success) {
        throw new LoadError(`${key}: item ${item.id} params: ${checked.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      }
    }
    const body = {
      kind,
      id,
      items: [...items.values()].map(({ layer: _l, from: _f, ...rest }) => rest),
      order,
    };
    const hash = contentHash(body);
    return { kind, id, agentFacing, items, order, hash, ref: `${kind}:${id}@${hash.slice(0, 8)}`, chain };
  }
}

function fullItem(op: ItemOp, layer: Layer, from: string): ResolvedItem {
  return {
    id: op.id,
    title: op.title as string,
    enabled: op.enabled ?? true,
    when: op.when ?? {},
    effect: op.effect ?? {},
    params: op.params ?? {},
    impl: op.impl as string,
    layer,
    from,
  };
}
