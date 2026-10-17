import { isAbsolute, relative, sep } from 'node:path';
import type { Spec } from '../schema/spec';
import { error, type Issue } from '../spec/issues';
import { type ObjectContext, resolveBlockObjects } from './layers';
import type { ResolvedObject } from './resolve';
import { ObjectError, type ResolvedItem } from './rules';

export {
  type CliOverrides,
  clearObjectContexts,
  cliPatch,
  type LayerUses,
  type ObjectContext,
  objectContextFor,
  PROJECT_OBJECTS_DIR,
  parseCliOverrides,
  resolveBlockObjects,
  SUITE_OBJECTS_DIR,
  shippedObjectContext,
  USES_FILE,
  type UsedObject,
} from './layers';
export {
  BUILTIN_KINDS,
  type ImplDef,
  initializeShippedObjects,
  itemOf,
  type KindDef,
  ObjectRegistry,
  type ObjectSource,
  ObjectStore,
  objectRegistry,
  parseObjectText,
  type RegistrySnapshot,
  type ResolvedObject,
} from './resolve';
export {
  applyItemOperations,
  type ItemOperations,
  itemApplies,
  mergeFields,
  ObjectError,
  type ObjectErrorCode,
  type ResolvedItem,
  type ScopeEvidence,
} from './rules';
export {
  applyScoringPlan,
  checkImpl,
  NoParams,
  RUNNER_ITEMS,
  resolvedRecord,
  type ScoringPlan,
  scoringPlan,
  stamp,
} from './scoring';

/** Whether a spec names any object itself: `uses` on the spec or on a block. */
export function specUsesObjects(spec: Pick<Spec, 'uses' | 'blocks'>): boolean {
  return spec.uses !== undefined || spec.blocks.some((block) => block.uses !== undefined);
}

/**
 * The loader's resolve pass: every object a block of the spec names, at the block, the spec, the suite or the
 * project layer, resolved against the context. An unknown object, an `extends` cycle, an unknown item, an order
 * that is not a permutation, a missing implementation or params of the wrong type is a load error naming the
 * spec, the block, the kind and the id. Nothing is resolved when no layer names an object.
 */
export function checkSpecObjects(spec: Spec, context: ObjectContext): Issue[] {
  if (
    !specUsesObjects(spec) &&
    context.uses.length === 0 &&
    context.problems.length === 0 &&
    !context.cli?.set.length &&
    !context.cli?.use.size
  )
    return [];
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const report = (path: string, cause: unknown, block?: number) => {
    const object = cause instanceof ObjectError ? cause : new ObjectError(String(cause), 'OBJECT_INVALID');
    const where =
      block === undefined ? `spec ${spec.id}` : `spec ${spec.id} block ${spec.blocks[block]?.id ?? block}`;
    const key = `${object.code}\u0000${object.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(error(object.code, path, `${where}: ${object.message}`));
  };
  for (const problem of context.problems) report('', problem);
  spec.blocks.forEach((_block, index) => {
    try {
      resolveBlockObjects(spec, index, context, { explicitOnly: true });
    } catch (cause) {
      const place = cause instanceof ObjectError ? (cause.place ?? '') : '';
      report(
        place.startsWith('blocks.') || place.startsWith('uses.') ? place : '',
        cause,
        place.startsWith('blocks.') ? index : undefined,
      );
    }
  });
  return issues;
}

/** One row of `object explain`: an item with its effective state, the layer that set it and where. */
export type ExplainRow = {
  item: string;
  enabled: boolean;
  /** The params when the item has any, else its effect, in a short form. */
  value: string;
  layer: ResolvedItem['layer'];
  from: string;
};

/** The rows of `object explain` for a resolved object, in its item order. */
export function explainRows(object: ResolvedObject): ExplainRow[] {
  return object.items.map((item) => ({
    item: item.id,
    enabled: item.enabled,
    value: short(Object.keys(item.params).length > 0 ? item.params : item.effect),
    layer: item.layer,
    from: item.from,
  }));
}

/**
 * `object explain` as text: a header with the object, its hash and its parent, then one row per item with its
 * effective value and the layer that set it (with the file and line for every layer but shipped). `root` writes
 * file places relative to that folder.
 */
export function explainObject(object: ResolvedObject, options: { at?: string; root?: string } = {}): string {
  const place = (text: string) =>
    options.root !== undefined && isAbsolute(text) ? relative(options.root, text).split(sep).join('/') : text;
  const parent = object.parent ? ` (extends ${object.parent.id}@${object.parent.hash.slice(0, 8)})` : '';
  const at = options.at === undefined ? '' : ` at ${options.at}`;
  const head = `${object.kind}${at} -> ${object.id}@${object.hash.slice(0, 8)}${parent}`;
  const rows = explainRows(object);
  const idWidth = Math.max(0, ...rows.map((row) => row.item.length));
  const valueWidth = Math.max(0, ...rows.map((row) => row.value.length));
  const lines = rows.map((row) => {
    const source = row.layer === 'shipped' ? 'shipped' : `${row.layer} ${place(row.from)}`;
    return `  ${row.item.padEnd(idWidth)}  ${(row.enabled ? 'enabled' : 'disabled').padEnd(8)}  ${row.value.padEnd(valueWidth)}  ${source}`.trimEnd();
  });
  return [head, ...lines].join('\n');
}

function short(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(short).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
          ? `${key} {${short(entry)}}`
          : `${key} ${short(entry)}`,
      )
      .join(', ');
  }
  return String(value);
}
