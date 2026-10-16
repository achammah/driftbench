import {
  bindObjectContext,
  type LoadedSpec,
  type ObjectContext,
  ObjectError,
  objectContextFor,
  resolveBlockObjects,
  type Spec,
} from '@agent-nexus/driftbench-core';

/** The identity of an object used by one block when the spec was stored. Outside the spec hash. */
export type SpecObjectIdentity = {
  block: number;
  key: string;
  kind: string;
  id: string;
  hash: string;
};

const recorded = new WeakMap<Spec, readonly SpecObjectIdentity[]>();

/** The identities recorded at putSpec, without consulting current project files. */
export function recordedObjectsOfSpec(spec: Spec): readonly SpecObjectIdentity[] | undefined {
  return recorded.get(spec);
}

export function specObjectIdentities(spec: Spec, context: ObjectContext): SpecObjectIdentity[] {
  return spec.blocks.flatMap((_block, block) =>
    resolveBlockObjects(spec, block, context).map(({ key, object }) => ({
      block,
      key,
      kind: object.kind,
      id: object.id,
      hash: object.hash,
    })),
  );
}

export function isSpecObjectIdentities(value: unknown): value is SpecObjectIdentity[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        Number.isInteger(entry.block) &&
        entry.block >= 0 &&
        ['key', 'kind', 'id', 'hash'].every((key) => typeof entry[key] === 'string' && entry[key] !== ''),
    )
  );
}

/** Stored records are historical facts; current files are consulted only when a command uses one. */
export function bindStoredSpec(spec: LoadedSpec, identities?: readonly SpecObjectIdentity[]): LoadedSpec {
  if (identities !== undefined) recorded.set(spec.spec, identities);
  bindObjectContext(spec.spec, () => {
    const context = objectContextFor(spec.path);
    // A uses.yaml selection is absent from the spec body. Losing that file must not silently select a
    // shipped default. Resolve its recorded identities too, so a missing object names itself at use.
    for (const identity of identities ?? []) {
      if (/^\((?:spec|block|cli)\)$/.test(identity.id)) continue;
      const current = resolveBlockObjects(spec.spec, identity.block, context).find(
        (used) => used.key === identity.key && used.object.kind === identity.kind,
      );
      // An explicitly changed selection is a valid re-score. An absent layer selection is not.
      if (current !== undefined && current.setAt !== 'shipped') continue;
      context.store.resolve(identity.kind, identity.id);
      if (identity.id !== 'default' && current?.object.id !== identity.id) {
        throw new ObjectError(
          `stored spec ${spec.spec.id} block ${identity.block}: missing selection for object ${identity.kind}:${identity.id}`,
          'OBJECT_UNKNOWN',
        );
      }
    }
    return context;
  });
  return spec;
}
