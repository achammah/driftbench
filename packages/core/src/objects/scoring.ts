import { z } from 'zod';
import { type Check, type CheckContext, machineVerdict } from '../contracts/check';
import { describeError } from '../runner/retry';
import type { By, ResolvedObjects, Verdict } from '../schema/run';
import { Verdict as VerdictSchema } from '../schema/run';
import { contentHash } from '../spec/hash';
import type { UsedObject } from './layers';
import type { ObjectRegistry, ResolvedObject } from './resolve';
import type { ResolvedItem } from './rules';

/** The params schema of an implementation that takes none: an item that sets any is refused. */
export const NoParams = z.strictObject({});

/** The verdicts the runner writes itself, beside the checks': the flow family and the ledger family. */
export const RUNNER_ITEMS = { flow: 'builtin:runner/flow', ledger: 'builtin:runner/ledger' } as const;

/** Registers runner implementations during explicit core initialization. Safe after registry restore. */
export function registerRunnerObjects(registry: ObjectRegistry): void {
  for (const impl of Object.values(RUNNER_ITEMS)) {
    if (!registry.impl(impl)) registry.registerImpl(impl, { params: NoParams });
  }
}

/** The implementation name a check-set item of a shipped check carries: `builtin:check/<check name>`. */
export const checkImpl = (name: string) => `builtin:check/${name}`;

/**
 * The check set a block is scored with, as the runner applies it. With an object, its enabled items choose and
 * order the checks the caller passed (by check name) and the runner's own flow and ledger verdicts; a check the
 * caller passed that no item names still runs, after them, and is stamped from `(caller)`. Without an object
 * every check runs in the caller's order, as before.
 */
export type ScoringPlan = {
  /** The block's check-set object; absent when no check set resolved (no checks package loaded). */
  object?: ResolvedObject;
  /** The steps in the order they run. */
  steps: Array<{ check: Check; by: By }>;
  /** The runner's own verdict families, with their stamp; absent when the check set disables them. */
  runner: { flow?: By; ledger?: By };
};

/** The object the caller's own checks are stamped from: `check-set:(caller)`, hashed over their names. */
function callerObject(names: readonly string[]): string {
  return `check-set:(caller)@${contentHash(names).slice(0, 8)}`;
}

export function scoringPlan(checks: readonly Check[], object: ResolvedObject | undefined): ScoringPlan {
  if (!object) {
    const ref = callerObject([...checks.map((check) => check.name), ...Object.keys(RUNNER_ITEMS)]);
    return {
      steps: checks.map((check) => ({
        check,
        by: { object: ref, item: check.name, impl: `caller:${check.name}`, layer: 'cli' },
      })),
      runner: {
        flow: { object: ref, item: 'flow', impl: RUNNER_ITEMS.flow, layer: 'shipped' },
        ledger: { object: ref, item: 'ledger', impl: RUNNER_ITEMS.ledger, layer: 'shipped' },
      },
    };
  }
  const items = new Map(object.items.map((item) => [item.id, item]));
  const stamp = (item: ResolvedItem): By => ({
    object: object.ref,
    item: item.id,
    impl: item.impl,
    layer: item.layer,
  });
  const steps: ScoringPlan['steps'] = [];
  for (const item of object.items) {
    if (!item.enabled) continue;
    for (const check of checks) if (check.name === item.id) steps.push({ check, by: stamp(item) });
  }
  const extra = checks.filter((check) => !items.has(check.name));
  if (extra.length > 0) {
    const ref = callerObject(extra.map((check) => check.name));
    for (const check of extra) {
      steps.push({
        check,
        by: { object: ref, item: check.name, impl: `caller:${check.name}`, layer: 'cli' },
      });
    }
  }
  const runnerItem = (id: keyof typeof RUNNER_ITEMS): By | undefined => {
    const item = items.get(id);
    if (!item) return { object: object.ref, item: id, impl: RUNNER_ITEMS[id], layer: 'shipped' };
    return item.enabled ? stamp(item) : undefined;
  };
  const flow = runnerItem('flow');
  const ledger = runnerItem('ledger');
  return {
    object,
    steps,
    runner: { ...(flow ? { flow } : {}), ...(ledger ? { ledger } : {}) },
  };
}

/** A value decision names its policy rung; ordinary verdicts name the check-set item that ran. */
function decidingBy(verdict: Verdict, by: By): By {
  return verdict.name === 'tools' &&
    verdict.valueCheck?.length &&
    verdict.by?.object.startsWith('policy/value-check:')
    ? verdict.by
    : by;
}

/** Stamps the execution while retaining the tools check's more specific value-policy decision. */
export function stamp(verdicts: readonly Verdict[], by: By): Verdict[] {
  return verdicts.map((verdict) => ({ ...verdict, by: decidingBy(verdict, by) }));
}

/**
 * Applies a scoring plan to one block. A check that throws, or returns a verdict the schema refuses, gives an
 * inconclusive gating verdict that names the problem: the block cannot pass on it, and nothing is skipped
 * silently. Every verdict carries the stamp of the item that ran it.
 */
export async function applyScoringPlan(plan: ScoringPlan, ctx: CheckContext): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (const { check, by } of plan.steps) {
    let produced: Verdict[];
    try {
      if (!check.applies(ctx)) continue;
      produced = await check.evaluate(ctx);
    } catch (cause) {
      verdicts.push({
        ...machineVerdict(
          check.name || 'check',
          'error',
          'inconclusive',
          `the check threw ${describeError(cause)}`,
        ),
        by,
      });
      continue;
    }
    for (const verdict of produced) {
      const parsed = VerdictSchema.safeParse(verdict);
      if (parsed.success) {
        verdicts.push({ ...parsed.data, by: decidingBy(parsed.data, by) });
      } else {
        const issue = parsed.error.issues[0];
        verdicts.push({
          ...machineVerdict(
            check.name || 'check',
            'invalid',
            'inconclusive',
            `the check returned a verdict the schema refuses: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
          ),
          by,
        });
      }
    }
  }
  return verdicts;
}

/** The keys whose objects only a diagnostic reads: the blame and placement policies. */
const DIAGNOSTIC_INPUTS = new Set(['blame', 'placement']);

/**
 * The block's record of the objects that influenced it: each with its key, kind, id, hash and the layer that
 * chose it. The blame and placement policies influence a block only through a diagnostic, so a block no
 * diagnostic ran on records neither, and changing them never makes a stored result look stale.
 */
export function resolvedRecord(used: readonly UsedObject[]): ResolvedObjects | undefined {
  const diagnosed = used.some((entry) => entry.key === 'diagnostics');
  const influencing = diagnosed ? used : used.filter((entry) => !DIAGNOSTIC_INPUTS.has(entry.key));
  if (influencing.length === 0) return undefined;
  const objects = influencing.map((entry) => ({
    key: entry.key,
    kind: entry.object.kind,
    id: entry.object.id,
    hash: entry.object.hash,
    setAt: entry.setAt,
  }));
  return { objects, hash: contentHash(objects) };
}
