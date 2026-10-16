/**
 * The shipped objects: named, versioned sets a spec can use and override (`uses`). The only kind today is the
 * check set: the machine checks the runner applies to a block, one item per check. A package that ships
 * objects registers them (the checks package: `initializeShippedObjects()`); the loader resolves a spec's
 * `uses` against what is registered, so a spec that names an object nobody registered is refused.
 */

export type ObjectKind = 'check_set';

/** One item of a check set: a check, whether it counts, and the builtin implementation that runs it. */
export type CheckSetItem = {
  id: string;
  title: string;
  /** When the item applies; empty means whenever the check finds something to judge. */
  when: Record<string, unknown>;
  /** Whether its verdicts gate the block. */
  effect: { gating: boolean };
  /** The builtin implementation: `builtin:check/<name>`. */
  impl: string;
  /** False when a layer turned the item off. Absent means on. */
  enabled?: boolean;
};

export type CheckSetObject = {
  kind: 'check_set';
  id: string;
  title?: string;
  items: CheckSetItem[];
};

const shipped = new Map<string, CheckSetObject>();
const impls = new Set<string>();

const key = (kind: ObjectKind, id: string) => `${kind}:${id}`;

/** Registers a shipped object, replacing one of the same kind and id. The implementations of its items become known. */
export function registerShippedObject(object: CheckSetObject): void {
  shipped.set(key(object.kind, object.id), structuredClone(object));
  for (const item of object.items) impls.add(item.impl);
}

/** The shipped object of a kind and id, or undefined when none is registered. A copy: callers may change it. */
export function shippedObject(kind: ObjectKind, id: string): CheckSetObject | undefined {
  const found = shipped.get(key(kind, id));
  return found ? structuredClone(found) : undefined;
}

/** The ids of the shipped objects of a kind, sorted. */
export function shippedObjectIds(kind: ObjectKind): string[] {
  return [...shipped.values()]
    .filter((object) => object.kind === kind)
    .map((object) => object.id)
    .sort();
}

/** True when some shipped item runs this builtin implementation. */
export function knownImpl(impl: string): boolean {
  return impls.has(impl);
}
