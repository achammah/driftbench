import type { ObjectContext } from './layers';

// Enumerable symbols survive object spread but are invisible to JSON and content hashes.
// The context is run-local state, not part of the spec's serialized contract.
export const SPEC_OBJECT_CONTEXT = Symbol('driftbench.spec.objects');
type ContextSource = ObjectContext | (() => ObjectContext);
type ContextCarrier = { [SPEC_OBJECT_CONTEXT]?: ContextSource };

/** Carry a loader's context (or a deferred stored-spec lookup) with its spec. */
export function bindObjectContext<T extends object>(spec: T, context: ContextSource): T {
  Object.defineProperty(spec, SPEC_OBJECT_CONTEXT, { value: context, enumerable: true, configurable: true });
  return spec;
}

/** The context resolved by the loader; stored specs resolve lazily when a command uses them. */
export function objectContextOfSpec(spec: object): ObjectContext | undefined {
  const source = (spec as ContextCarrier)[SPEC_OBJECT_CONTEXT];
  return typeof source === 'function' ? source() : source;
}
