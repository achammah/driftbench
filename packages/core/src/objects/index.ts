import type { Spec } from '../schema/spec';
import {
  type CheckSetUse,
  DEFAULT_OBJECT_ID,
  type ObjectIssue,
  type ResolvedCheckSet,
  resolveCheckSet,
  shippedCheckSet,
} from './resolve';

export {
  type CheckSetItem,
  type CheckSetObject,
  knownImpl,
  type ObjectKind,
  registerShippedObject,
  shippedObject,
  shippedObjectIds,
} from './registry';
export {
  type CheckSetOverride,
  type CheckSetUse,
  DEFAULT_OBJECT_ID,
  type ItemOverride,
  type ObjectIssue,
  type ObjectIssueCode,
  type ObjectLayer,
  type ResolvedCheckSet,
  type ResolvedItem,
  resolveCheckSet,
  shippedCheckSet,
} from './resolve';

/**
 * The check set a block is scored with: the shipped default, then the spec's `uses`, then the block's. Undefined
 * when no default is registered. `issues` holds every refusal; a block with a refusal has no set.
 */
export function blockCheckSet(
  spec: Pick<Spec, 'uses' | 'blocks'>,
  index: number,
): { set?: ResolvedCheckSet; issues: ObjectIssue[] } {
  const specUse = spec.uses?.check_set as CheckSetUse | undefined;
  const blockUse = spec.blocks[index]?.uses?.check_set as CheckSetUse | undefined;
  const issues: ObjectIssue[] = [];
  let set: ResolvedCheckSet | undefined = shippedCheckSet(DEFAULT_OBJECT_ID);
  if (specUse !== undefined) {
    const made = resolveCheckSet(specUse, set, 'spec', 'uses.check_set');
    if (made.ok) set = made.set;
    else issues.push(...made.issues);
  }
  if (blockUse !== undefined && issues.length === 0) {
    const made = resolveCheckSet(blockUse, set, 'block', `blocks.${index}.uses.check_set`);
    if (made.ok) set = made.set;
    else issues.push(...made.issues);
  }
  return issues.length > 0 ? { issues } : set ? { set, issues } : { issues };
}

/** Every refusal of the spec's own `uses` and of each block's, with the path it sits at. */
export function checkUses(spec: Pick<Spec, 'uses' | 'blocks'>): ObjectIssue[] {
  const issues: ObjectIssue[] = [];
  let specSet: ResolvedCheckSet | undefined = shippedCheckSet(DEFAULT_OBJECT_ID);
  const specUse = spec.uses?.check_set as CheckSetUse | undefined;
  if (specUse !== undefined) {
    const made = resolveCheckSet(specUse, specSet, 'spec', 'uses.check_set');
    if (made.ok) specSet = made.set;
    else issues.push(...made.issues);
  }
  spec.blocks.forEach((block, index) => {
    const blockUse = block.uses?.check_set as CheckSetUse | undefined;
    if (blockUse === undefined) return;
    const made = resolveCheckSet(blockUse, specSet, 'block', `blocks.${index}.uses.check_set`);
    if (!made.ok) issues.push(...made.issues);
  });
  return issues;
}
