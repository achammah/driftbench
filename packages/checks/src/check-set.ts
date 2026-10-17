import { checkImpl, NoParams, objectRegistry, RUNNER_ITEMS } from '@agent-nexus/driftbench-core';

/**
 * Every shipped check by name, in the order `defaultChecks()` applies them: `tool_policy` runs only with a tool
 * policy and `judge` only with a council, but each holds its place. A test keeps this list equal to
 * `defaultChecks()`.
 */
export const SHIPPED_CHECKS = [
  'tools',
  'tools_offered',
  'forbidden',
  'must',
  'must_not',
  'regex',
  'exact',
  'injection',
  'length',
  'markup',
  'starts_with',
  'finish_reason',
  'json',
  'tool_f1',
  'refusal',
  'rouge_l',
  'bleu',
  'sql',
  'similarity',
  'relevancy',
  'knowledge_retention',
  'lang',
  'pii',
  'cards',
  'tool_policy',
  'stage',
  'skills',
  'guards',
  'references',
  'subagents',
  'execution',
  'workspace',
  'safety',
  'artifacts',
  'schema_strict',
  'budget',
  'end_state',
  'custom',
  'judge',
] as const;

/**
 * `check-set:default`, shipped: one item per shipped check in today's order, then the runner's flow and ledger
 * verdicts. Each item's id is the check name its verdicts carry, and its impl `builtin:check/<name>`. A project
 * extends it to disable, reorder or replace a check; the default itself never changes.
 */
export const DEFAULT_CHECK_SET = {
  kind: 'check-set',
  id: 'default',
  extends: null,
  description:
    'The machine checks, the judge check and the runner verdicts, in the order the runner applies them.',
  items: [
    ...SHIPPED_CHECKS.map((name) => ({ id: name, title: `The ${name} check`, impl: checkImpl(name) })),
    {
      id: 'flow',
      title: 'The flow verdicts the runner writes from the stage it reads',
      impl: RUNNER_ITEMS.flow,
    },
    {
      id: 'ledger',
      title: 'The ledger verdicts the runner writes from the facts a block states',
      impl: RUNNER_ITEMS.ledger,
    },
  ],
};

/** Registers the shipped check set after core initialization. Safe after registry restore. */
export function registerCheckSet(): void {
  for (const name of SHIPPED_CHECKS) {
    const impl = checkImpl(name);
    if (!objectRegistry.impl(impl)) objectRegistry.registerImpl(impl, { params: NoParams });
  }
  if (!objectRegistry.snapshot().shipped.has('check-set:default')) {
    objectRegistry.registerShipped(DEFAULT_CHECK_SET, '@agent-nexus/driftbench-checks check-set:default');
  }
}
