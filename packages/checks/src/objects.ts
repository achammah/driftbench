import { type CheckSetItem, type CheckSetObject, registerShippedObject } from '@agent-nexus/driftbench-core';
import { defaultChecks } from './defaults';

const titleOf = (name: string) => name.replaceAll('_', ' ');

/**
 * The shipped check set: one item per machine check, in the order the runner applies them. An item is the
 * check, whether its verdicts gate, and the builtin implementation that runs it (`builtin:check/<name>`). A spec
 * or a block changes it through `uses.check_set`.
 */
export const DEFAULT_CHECK_SET: CheckSetObject = {
  kind: 'check_set',
  id: 'default',
  title: 'The machine checks driftbench applies to every block',
  items: [...new Set(defaultChecks().map((check) => check.name))].map(
    (name): CheckSetItem => ({
      id: name,
      title: titleOf(name),
      when: {},
      effect: { gating: true },
      impl: `builtin:check/${name}`,
    }),
  ),
};

/**
 * Registers the objects this package ships with the loader of the core package. A spec's `uses` names them, so
 * every program that loads specs calls it first; calling it again changes nothing.
 */
export function initializeShippedObjects(): void {
  registerShippedObject(DEFAULT_CHECK_SET);
}
