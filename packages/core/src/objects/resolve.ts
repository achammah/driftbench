import { contentHash } from '../spec/hash';
import { type CheckSetItem, type CheckSetObject, knownImpl, shippedObject } from './registry';

/** The layer that set an item: the shipped object, the spec's `uses`, or one block's `uses`. */
export type ObjectLayer = 'shipped' | 'spec' | 'block';

/** One item of a resolved check set, with the layer that last set it. */
export type ResolvedItem = CheckSetItem & { layer: ObjectLayer };

/** A check set after the layers were applied. `name` is `check_set:<id>@<hash8>`: the id of what it is, the hash of what it holds. */
export type ResolvedCheckSet = {
  kind: 'check_set';
  id: string;
  name: string;
  items: ResolvedItem[];
};

/** What a spec or a block writes under `uses.check_set`: an object id, or an override of one. */
export type ItemOverride = {
  id: string;
  enabled?: boolean;
  add?: boolean;
  title?: string;
  when?: Record<string, unknown>;
  effect?: { gating: boolean };
  impl?: string;
  before?: string;
};
export type CheckSetOverride = { extends?: string; items?: ItemOverride[]; order?: string[] };
export type CheckSetUse = string | CheckSetOverride;

export type ObjectIssueCode =
  | 'OBJECT_UNKNOWN'
  | 'OBJECT_ITEM_UNKNOWN'
  | 'OBJECT_ITEM_EXISTS'
  | 'OBJECT_ITEM_INCOMPLETE'
  | 'OBJECT_IMPL_UNKNOWN'
  | 'OBJECT_ORDER_INVALID';

export type ObjectIssue = { code: ObjectIssueCode; path: string; message: string };

export const DEFAULT_OBJECT_ID = 'default';

/** The short hash that names the content of a check set. */
function hash8(id: string, items: readonly ResolvedItem[]): string {
  return contentHash({ id, items }).slice(0, 8);
}

function named(id: string, items: ResolvedItem[]): ResolvedCheckSet {
  return { kind: 'check_set', id, name: `check_set:${id}@${hash8(id, items)}`, items };
}

/** The shipped check set as the base layer: every item set by `shipped`. */
function fromShipped(object: CheckSetObject): ResolvedCheckSet {
  return named(
    object.id,
    object.items.map((item) => ({ ...item, layer: 'shipped' as const })),
  );
}

/** A shipped check set as the base layer, or undefined when none is registered under that id. */
export function shippedCheckSet(id: string): ResolvedCheckSet | undefined {
  const object = shippedObject('check_set', id);
  return object ? fromShipped(object) : undefined;
}

/**
 * Resolves one `uses.check_set` over a base. A string names a shipped object and replaces the base. An override
 * extends a shipped object (`extends`) or, without one, the base: its items change, add or move items, and
 * `order` states the whole order. Each refusal names its code and the path of what it refused. Items an override
 * touches carry `layer`.
 */
export function resolveCheckSet(
  use: CheckSetUse,
  base: ResolvedCheckSet | undefined,
  layer: Exclude<ObjectLayer, 'shipped'>,
  path: string,
): { ok: true; set: ResolvedCheckSet } | { ok: false; issues: ObjectIssue[] } {
  const issues: ObjectIssue[] = [];
  const refuse = (code: ObjectIssueCode, at: string, message: string) =>
    issues.push({ code, path: at, message });
  const unknownObject = (id: string, at: string) =>
    refuse('OBJECT_UNKNOWN', at, `no shipped check_set "${id}": name one that is registered`);

  if (typeof use === 'string') {
    const object = shippedObject('check_set', use);
    if (!object) {
      unknownObject(use, path);
      return { ok: false, issues };
    }
    return { ok: true, set: fromShipped(object) };
  }

  let parent = base;
  if (use.extends !== undefined || parent === undefined) {
    const id = use.extends ?? DEFAULT_OBJECT_ID;
    const object = shippedObject('check_set', id);
    if (!object) {
      unknownObject(id, `${path}.extends`);
      return { ok: false, issues };
    }
    parent = fromShipped(object);
  }
  const items: ResolvedItem[] = (parent as ResolvedCheckSet).items.map((item) => ({ ...item }));
  const id = (parent as ResolvedCheckSet).id;

  (use.items ?? []).forEach((change, index) => {
    const at = `${path}.items.${index}`;
    const position = items.findIndex((item) => item.id === change.id);
    if (change.add === true) {
      if (position >= 0) {
        refuse(
          'OBJECT_ITEM_EXISTS',
          `${at}.id`,
          `the item "${change.id}" already exists: change it, do not add it`,
        );
        return;
      }
      if (change.when === undefined || change.effect === undefined || change.impl === undefined) {
        refuse('OBJECT_ITEM_INCOMPLETE', at, `the added item "${change.id}" needs when, effect and impl`);
        return;
      }
      if (!knownImpl(change.impl)) {
        refuse('OBJECT_IMPL_UNKNOWN', `${at}.impl`, `no builtin implementation "${change.impl}"`);
        return;
      }
      items.push({
        id: change.id,
        title: change.title ?? change.id,
        when: change.when,
        effect: change.effect,
        impl: change.impl,
        layer,
      });
    } else {
      const item = items[position];
      if (!item) {
        refuse(
          'OBJECT_ITEM_UNKNOWN',
          `${at}.id`,
          `no item "${change.id}" in check_set "${id}": add it with add: true`,
        );
        return;
      }
      if (change.impl !== undefined && !knownImpl(change.impl)) {
        refuse('OBJECT_IMPL_UNKNOWN', `${at}.impl`, `no builtin implementation "${change.impl}"`);
        return;
      }
      if (change.enabled !== undefined) item.enabled = change.enabled;
      if (change.title !== undefined) item.title = change.title;
      if (change.when !== undefined) item.when = change.when;
      if (change.effect !== undefined) item.effect = change.effect;
      if (change.impl !== undefined) item.impl = change.impl;
      item.layer = layer;
    }
    if (change.before !== undefined) {
      const from = items.findIndex((item) => item.id === change.id);
      const target = items.findIndex((item) => item.id === change.before);
      if (target < 0) {
        refuse(
          'OBJECT_ITEM_UNKNOWN',
          `${at}.before`,
          `no item "${change.before}" to move "${change.id}" before`,
        );
        return;
      }
      const [moved] = items.splice(from, 1);
      if (moved)
        items.splice(
          items.findIndex((item) => item.id === change.before),
          0,
          moved,
        );
    }
  });

  if (use.order !== undefined) {
    const at = `${path}.order`;
    if ((use.items ?? []).some((change) => change.before !== undefined)) {
      refuse('OBJECT_ORDER_INVALID', at, 'order and before both place items: use one of them');
    } else {
      const wanted = new Set(use.order);
      const missing = items.filter((item) => !wanted.has(item.id)).map((item) => item.id);
      const unknown = use.order.filter((entry) => !items.some((item) => item.id === entry));
      if (wanted.size !== use.order.length || missing.length > 0 || unknown.length > 0) {
        refuse(
          'OBJECT_ORDER_INVALID',
          at,
          `order must list every item once${missing.length > 0 ? `; missing ${missing.join(', ')}` : ''}${unknown.length > 0 ? `; unknown ${unknown.join(', ')}` : ''}`,
        );
      } else {
        const rank = new Map(use.order.map((entry, position) => [entry, position]));
        items.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, set: named(id, items) };
}
