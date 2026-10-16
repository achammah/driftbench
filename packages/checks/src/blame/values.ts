import type { Assertion, Expect, evidence, Observed, Spec, Verdict } from '@agent-nexus/driftbench-core';
import { inputSubject, type LeafResult, replayInputValues, type ValueCheckContext } from '../checks/tools';
import { isRecord } from '../support/values';
import { DEFAULT_VALUE_POLICY, type ValuePolicy, type ValueServices } from '../value-check/ladder';

/**
 * The value check's record of a failing verdict, in the shape the blame evidence reads. The tools check stores,
 * on each input verdict, the rung that decided every value it did not pass by equality (`Verdict.valueCheck`:
 * the call, the value's path, the rung and its outcome). The value itself is in the stored tool call, and the
 * gold in the block's expectation, so the record joins them. A value the check could not decide (it fell back to
 * the exact compare) can be decided again with the services a diagnostic is given. Nothing is replayed against
 * a live tool and no model is called here.
 */

/**
 * The family a rung belongs to, as `evidence.ValueFact.rung` names them, by what the rung implements and not by
 * its item id: a project may rename or add items. A rung no family knows keeps its item id.
 */
const FAMILY: Readonly<Record<string, string>> = {
  'builtin:value-check/outcome': 'rung1',
  'builtin:value-check/recompute': 'rung1',
  'builtin:value-check/state-diff': 'rung1',
  'builtin:value-check/contract': 'rung2',
  'builtin:value-check/as-given': 'rung2b',
  'builtin:value-check/judge': 'rung3',
  'builtin:value-check/exact': 'rung4',
};

/** The two verdicts of the ladder that are not items of a policy: both are the exact compare. */
const EXACT_RUNGS: ReadonlySet<string> = new Set(['identity', 'exact_fallback']);

/** The family of a rung id under a policy. */
export function rungFamily(rung: string, policy: ValuePolicy = DEFAULT_VALUE_POLICY): string {
  if (EXACT_RUNGS.has(rung)) return 'rung4';
  const impl = policy.items.find((item) => item.id === rung)?.impl;
  return (impl === undefined ? undefined : FAMILY[impl]) ?? rung;
}

/** The value at a path inside a value, undefined when the path leaves an object. */
function at(value: unknown, path: readonly string[]): unknown {
  let node = value;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** The gold the assertion states for a path inside the argument: the bare value, `exact`, or a `subset` leaf. */
function goldOf(assertion: Assertion | undefined, path: readonly string[]): unknown {
  if (isRecord(assertion)) {
    if ('exact' in assertion) return path.length === 0 ? assertion.exact : at(assertion.exact, path);
    if ('subset' in assertion) return at(assertion.subset, path);
    return undefined;
  }
  return path.length === 0 ? assertion : undefined;
}

/** A failing outcome first: the evidence reads the first fact as the one that decided the verdict. */
const ORDER: Readonly<Record<string, number>> = { fail: 0, inconclusive: 1, pass: 2 };

function failingFirst(facts: evidence.ValueFact[]): evidence.ValueFact[] {
  return facts
    .map((fact, index) => ({ fact, index }))
    .sort(
      (a, b) => (ORDER[a.fact.settles ?? ''] ?? 3) - (ORDER[b.fact.settles ?? ''] ?? 3) || a.index - b.index,
    )
    .map((entry) => entry.fact);
}

/** One decision of the ladder on one value, as a fact. */
function factOf(
  subject: { tool: string; field: string },
  decision: { call: number; rung: string; outcome: string; changedInputsFail?: boolean },
  path: readonly string[],
  value: unknown,
  gold: unknown,
  policy: ValuePolicy | undefined,
): evidence.ValueFact {
  return {
    tool: subject.tool,
    field: subject.field,
    path,
    call: decision.call - 1,
    value,
    ...(gold === undefined ? {} : { gold }),
    rung: rungFamily(decision.rung, policy),
    ...(decision.outcome === 'pass' || decision.outcome === 'fail' || decision.outcome === 'inconclusive'
      ? { settles: decision.outcome }
      : {}),
    // A computation that matched the gold on the given inputs was accepted as gold there; the changed inputs
    // are what failed it.
    ...(decision.changedInputsFail === undefined ? {} : { changedInputsFail: decision.changedInputsFail }),
    ...(decision.changedInputsFail === true ? { outcome: 'accepted_as_gold' as const } : {}),
  };
}

export type ValueFactSource = {
  observed: Pick<Observed, 'toolCalls'>;
  expect?: Expect;
  /** The value-check policy the block resolved; the shipped one when absent. */
  policy?: ValuePolicy;
};

/** The facts of a verdict's stored decisions, in the order of the decisions. */
function storedFacts(source: ValueFactSource, verdict: Pick<Verdict, 'id' | 'valueCheck'>) {
  const decisions = verdict.valueCheck ?? [];
  const subject = inputSubject(source.expect, verdict.id);
  if (decisions.length === 0 || subject === undefined) return [];
  const calls = source.observed.toolCalls.filter((call) => call.label === subject.tool.label);
  return decisions.map((decision) => {
    const path = decision.path.split('.').slice(1);
    const input = calls[decision.call - 1]?.input;
    return factOf(
      { tool: subject.tool.label, field: subject.field },
      decision,
      path,
      at(isRecord(input) ? input[subject.field] : undefined, path),
      goldOf(subject.assertion, path),
      source.policy,
    );
  });
}

/** The value facts of one verdict of a stored block: one per value the ladder decided, failures first. */
export function valueFacts(
  source: ValueFactSource,
  verdict: Pick<Verdict, 'id' | 'valueCheck'>,
): evidence.ValueFact[] {
  return failingFirst(storedFacts(source, verdict));
}

/** A fact of a value the ladder decided again. */
function replayedFact(
  subject: { tool: string; field: string },
  call: number,
  leaf: LeafResult,
  policy: ValuePolicy,
): evidence.ValueFact {
  const changed = leaf.result.emits?.changed_inputs_fail;
  return factOf(
    subject,
    {
      call,
      rung: leaf.result.rung,
      outcome: leaf.result.outcome,
      ...(typeof changed === 'boolean' ? { changedInputsFail: changed } : {}),
    },
    leaf.path.split('.').slice(1),
    leaf.value,
    leaf.gold,
    policy,
  );
}

/**
 * The value facts of an input verdict, with the values the check could not decide (it compared them exactly)
 * decided again by the ladder with the services given. A value the check settled keeps its stored decision.
 */
export async function replayedValueFacts(
  ctx: ValueCheckContext,
  verdict: Pick<Verdict, 'id' | 'valueCheck'>,
  policy: ValuePolicy,
  services: ValueServices,
): Promise<{ facts: evidence.ValueFact[]; errors: string[] }> {
  const decisions = verdict.valueCheck ?? [];
  const facts = storedFacts({ observed: ctx.observed, expect: ctx.expect, policy }, verdict);
  const subject = inputSubject(ctx.expect, verdict.id);
  if (subject === undefined || !decisions.some((decision) => decision.rung === 'exact_fallback')) {
    return { facts: failingFirst(facts), errors: [] };
  }
  const names = { tool: subject.tool.label, field: subject.field };
  const again = new Map<string, evidence.ValueFact>();
  const errors: string[] = [];
  for (const { call, leaves } of await replayInputValues(ctx, verdict.id, policy, services)) {
    for (const leaf of leaves) {
      again.set(`${call}|${leaf.path}`, replayedFact(names, call, leaf, policy));
      const failed = leaf.result.emits?.judge_error;
      if (typeof failed === 'string') errors.push(failed);
    }
  }
  return {
    facts: failingFirst(
      facts.map((fact, index) => {
        const decision = decisions[index];
        const redone =
          decision?.rung === 'exact_fallback' ? again.get(`${decision.call}|${decision.path}`) : undefined;
        return redone ?? fact;
      }),
    ),
    errors,
  };
}

/** The tool definitions a spec declares, by tool label: `metadata.tool_schemas`. */
export function toolSchemasOf(spec: Pick<Spec, 'metadata'> | undefined): Record<string, unknown> | undefined {
  const schemas = (spec?.metadata as { tool_schemas?: unknown } | undefined)?.tool_schemas;
  return isRecord(schemas) ? schemas : undefined;
}
