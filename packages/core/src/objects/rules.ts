import type { AppliesTo, ItemPatch, Layer } from '../schema/object';
import { anyGlobMatches } from '../spec/glob';
import { cloneJson } from '../spec/hash';
import { isPlainObject } from '../spec/normalize';

/** A refusal of an object: the loader reports it as a load error, never ignores it. */
export class ObjectError extends Error {
  constructor(
    message: string,
    /** A stable code tools and tests branch on. */
    readonly code: ObjectErrorCode,
    /** The spec path of the reference that failed, such as `blocks.1.uses.blame`, when a spec named it. */
    readonly place?: string,
  ) {
    super(message);
    this.name = 'ObjectError';
  }
}

export type ObjectErrorCode =
  | 'OBJECT_INVALID'
  | 'OBJECT_KIND_UNKNOWN'
  | 'OBJECT_UNKNOWN'
  | 'OBJECT_CYCLE'
  | 'OBJECT_DUPLICATE'
  | 'OBJECT_SHIPPED_IMMUTABLE'
  | 'OBJECT_ITEM_UNKNOWN'
  | 'OBJECT_ITEM_EXISTS'
  | 'OBJECT_ITEM_INCOMPLETE'
  | 'OBJECT_ORDER_INVALID'
  | 'OBJECT_IMPL_UNKNOWN'
  | 'OBJECT_PARAMS_INVALID';

/** One item once every layer has been applied, with the layer and place of the last operation that set it. */
export type ResolvedItem = {
  id: string;
  title: string;
  enabled: boolean;
  when: Record<string, unknown>;
  effect: Record<string, unknown>;
  params: Record<string, unknown>;
  impl: string;
  cites?: string;
  /** Where the item applies; absent means everywhere. */
  applies_to?: AppliesTo;
  /** The layer of the last operation that set any field of this item. */
  layer: Layer;
  /** Where that operation is written: `path:line`, `path#items.3`, or an inline place such as `uses.blame`. */
  from: string;
};

/**
 * Merges an override into a map: a key set to a map merges into the map below it, any other value (a list
 * included) replaces it. `+key: [values]` appends to the list at `key`, `-key: [values]` removes those values
 * from it, and `-key: null` removes the key. The input maps are not changed.
 */
export function mergeFields(
  base: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
  where: string,
): Record<string, unknown> {
  const out = cloneJson(base) as Record<string, unknown>;
  for (const [rawKey, value] of Object.entries(patch)) {
    const op = rawKey.startsWith('+') ? '+' : rawKey.startsWith('-') ? '-' : '';
    const key = op === '' ? rawKey : rawKey.slice(1);
    if (key === '') throw new ObjectError(`${where}: the key ${rawKey} names no field`, 'OBJECT_INVALID');
    const current = out[key];
    if (op === '+') {
      if (!Array.isArray(value)) {
        throw new ObjectError(
          `${where}: ${rawKey} appends a list; write ${rawKey}: [values]`,
          'OBJECT_INVALID',
        );
      }
      if (current !== undefined && !Array.isArray(current)) {
        throw new ObjectError(`${where}: ${rawKey} appends to ${key}, which is not a list`, 'OBJECT_INVALID');
      }
      out[key] = [...((current as unknown[] | undefined) ?? []), ...cloneJson(value)];
    } else if (op === '-') {
      if (value === null) {
        delete out[key];
      } else if (Array.isArray(value)) {
        if (!Array.isArray(current)) {
          throw new ObjectError(
            `${where}: ${rawKey} removes values from ${key}, which is not a list`,
            'OBJECT_INVALID',
          );
        }
        const drop = new Set(value.map((entry) => JSON.stringify(entry)));
        out[key] = current.filter((entry) => !drop.has(JSON.stringify(entry)));
      } else {
        throw new ObjectError(
          `${where}: ${rawKey} takes a list of values to remove, or null to remove the key`,
          'OBJECT_INVALID',
        );
      }
    } else if (isPlainObject(value) && isPlainObject(current)) {
      out[key] = mergeFields(current, value, `${where}.${key}`);
    } else {
      out[key] = cloneJson(value);
    }
  }
  return out;
}

/** What one object file asks of its parent's items: the operations in file order, the order or the moves. */
export type ItemOperations = {
  /** `kind:id`, for messages. */
  name: string;
  /** The parent's `kind:id`, for messages; absent on a root object. */
  parent?: string;
  layer: Layer;
  /** The place of each operation, for `explain`: one entry per operation. */
  places: readonly string[];
  patches: readonly ItemPatch[];
  order?: readonly string[];
};

/**
 * Applies one object file's item operations to its parent's items and order. Every refusal names the object,
 * the operation and the parent's items: an operation on an id the parent does not hold is never ignored.
 */
export function applyItemOperations(
  items: ReadonlyMap<string, ResolvedItem>,
  order: readonly string[],
  ops: ItemOperations,
): { items: Map<string, ResolvedItem>; order: string[] } {
  const next = new Map<string, ResolvedItem>();
  for (const [id, item] of items) next.set(id, { ...item, params: cloneJson(item.params) });
  let nextOrder = [...order];
  const parentIds = [...items.keys()];
  const held = parentIds.length === 0 ? 'no items' : parentIds.join(', ');
  const moves: ItemPatch[] = [];

  ops.patches.forEach((patch, index) => {
    const where = ops.places[index] ?? `${ops.name}#items.${index}`;
    const known = next.get(patch.id);
    if (patch.add === true) {
      if (known) {
        throw new ObjectError(
          `${where}: add on item ${patch.id}, which ${ops.parent ?? ops.name} already holds; drop add: true to change it`,
          'OBJECT_ITEM_EXISTS',
        );
      }
      const missing = (['title', 'when', 'effect', 'impl'] as const).filter(
        (field) => patch[field] === undefined,
      );
      if (missing.length > 0) {
        throw new ObjectError(
          `${where}: the new item ${patch.id} needs ${missing.join(', ')} (add: true needs title, when, effect and impl)`,
          'OBJECT_ITEM_INCOMPLETE',
        );
      }
      next.set(patch.id, {
        id: patch.id,
        title: patch.title as string,
        enabled: patch.enabled ?? true,
        when: cloneJson(patch.when ?? {}),
        effect: cloneJson(patch.effect ?? {}),
        params: cloneJson(patch.params ?? {}),
        impl: patch.impl as string,
        ...(patch.cites === undefined ? {} : { cites: patch.cites }),
        ...(patch.applies_to === undefined ? {} : { applies_to: cloneJson(patch.applies_to) }),
        layer: ops.layer,
        from: where,
      });
      nextOrder.push(patch.id);
    } else if (known) {
      next.set(patch.id, {
        ...known,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        ...(patch.cites === undefined ? {} : { cites: patch.cites }),
        ...(patch.impl === undefined ? {} : { impl: patch.impl }),
        when: patch.when === undefined ? known.when : mergeFields(known.when, patch.when, `${where}.when`),
        effect:
          patch.effect === undefined
            ? known.effect
            : mergeFields(known.effect, patch.effect, `${where}.effect`),
        params:
          patch.params === undefined
            ? known.params
            : mergeFields(known.params, patch.params, `${where}.params`),
        ...(patch.applies_to === undefined
          ? {}
          : {
              applies_to: mergeFields(
                known.applies_to ?? {},
                patch.applies_to,
                `${where}.applies_to`,
              ) as AppliesTo,
            }),
        layer: ops.layer,
        from: where,
      });
    } else {
      throw new ObjectError(
        `unknown item ${patch.id} in ${ops.name} (${where}); the parent ${ops.parent ?? ops.name} holds ${held}. To add a new item write add: true with title, when, effect and impl`,
        'OBJECT_ITEM_UNKNOWN',
      );
    }
    if (patch.before !== undefined || patch.after !== undefined) moves.push(patch);
  });

  if (ops.order !== undefined && moves.length > 0) {
    throw new ObjectError(
      `${ops.name}: the file sets order and also moves ${moves.map((m) => m.id).join(', ')} with before or after; use one or the other`,
      'OBJECT_ORDER_INVALID',
    );
  }
  for (const move of moves) {
    if (move.before !== undefined && move.after !== undefined) {
      throw new ObjectError(
        `${ops.name}: item ${move.id} sets both before and after`,
        'OBJECT_ORDER_INVALID',
      );
    }
    const anchor = (move.before ?? move.after) as string;
    if (!next.has(anchor)) {
      throw new ObjectError(
        `unknown item ${anchor} in ${ops.name} (${move.before !== undefined ? 'before' : 'after'} of ${move.id}); the parent ${ops.parent ?? ops.name} holds ${held}`,
        'OBJECT_ITEM_UNKNOWN',
      );
    }
    if (anchor === move.id) {
      throw new ObjectError(
        `${ops.name}: item ${move.id} is moved relative to itself`,
        'OBJECT_ORDER_INVALID',
      );
    }
    nextOrder = nextOrder.filter((id) => id !== move.id);
    const at = nextOrder.indexOf(anchor);
    nextOrder.splice(move.before !== undefined ? at : at + 1, 0, move.id);
  }
  if (ops.order !== undefined) nextOrder = checkedOrder(ops.order, nextOrder, next, ops, held);
  return { items: next, order: nextOrder };
}

/**
 * An `order` must name every enabled item once and nothing unknown. Disabled items may be listed; those left out
 * keep their place after the listed ones, so a stronger layer can enable them again.
 */
function checkedOrder(
  order: readonly string[],
  previous: readonly string[],
  items: ReadonlyMap<string, ResolvedItem>,
  ops: ItemOperations,
  held: string,
): string[] {
  const seen = new Set<string>();
  for (const id of order) {
    if (!items.has(id)) {
      throw new ObjectError(
        `unknown item ${id} in ${ops.name} (order); the parent ${ops.parent ?? ops.name} holds ${held}`,
        'OBJECT_ITEM_UNKNOWN',
      );
    }
    if (seen.has(id)) throw new ObjectError(`${ops.name}: order lists ${id} twice`, 'OBJECT_ORDER_INVALID');
    seen.add(id);
  }
  const left = [...items.values()]
    .filter((item) => item.enabled && !seen.has(item.id))
    .map((item) => item.id);
  if (left.length > 0) {
    throw new ObjectError(
      `${ops.name}: order must list every enabled item once; it leaves out ${left.join(', ')}`,
      'OBJECT_ORDER_INVALID',
    );
  }
  return [...order, ...previous.filter((id) => !seen.has(id))];
}

/** What a rule's scope is checked against: the skills, the failing tool labels and the units the evidence names. */
export type ScopeEvidence = {
  skills?: readonly string[];
  tools?: readonly string[];
  units?: readonly string[];
};

/**
 * Whether an item applies to this evidence, checked before its `when`: an item without `applies_to` applies
 * everywhere; one with it applies when the evidence names one of its skills, one of its tools, or a unit that
 * matches one of its unit patterns (`*` matches any run of characters).
 */
export function itemApplies(item: Pick<ResolvedItem, 'applies_to'>, evidence: ScopeEvidence): boolean {
  const scope = item.applies_to;
  if (scope === undefined) return true;
  if (scope.skills?.some((skill) => evidence.skills?.includes(skill))) return true;
  if (scope.tools?.some((tool) => evidence.tools?.includes(tool))) return true;
  return (
    scope.units?.some((pattern) => evidence.units?.some((unit) => anyGlobMatches(pattern, unit))) ?? false
  );
}
