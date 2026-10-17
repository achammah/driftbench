import type { CheckSet } from '../contracts/check';
import type { TargetRef } from '../schema/common';
import type { BlockResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import { driftOf } from './drift';
import { addFacts, canonicalGiven, resolveGiven } from './given';

/** End-state verdicts depend on the recomposed run, even when the last agent reply is carried. */
export async function recheckCarriedEndState(
  result: BlockResult,
  spec: Spec,
  target: TargetRef,
  checks: CheckSet,
  endState: unknown,
): Promise<BlockResult> {
  const block = spec.blocks[result.index];
  if (!block || result.index !== spec.blocks.length - 1) return result;
  const canonical = canonicalGiven(spec, result.index);
  const ctx = {
    spec,
    mode: 'T' as const,
    blockIndex: result.index,
    block,
    expect: block.expect ?? {},
    given: resolveGiven(canonical.state, canonical.prefix, target),
    observed: result.observed,
    history: [],
    ledger: addFacts(canonical.state.ledger, block.expect?.ledger_add).ledger,
    endState,
  };
  // The check contract names this family end_state. Other checks retain their measured verdicts.
  const judged = (
    await Promise.all(
      checks.filter((c) => c.name === 'end_state' && c.applies(ctx)).map((c) => c.evaluate(ctx)),
    )
  ).flat();
  const at = result.verdicts.findIndex((v) => v.name === 'end_state');
  const verdicts = result.verdicts.filter((v) => v.name !== 'end_state');
  verdicts.splice(at < 0 ? verdicts.length : at, 0, ...judged);
  return {
    ...result,
    verdicts,
    drift: driftOf(verdicts),
    pass: verdicts.every((v) => !v.gating || v.outcome === 'pass'),
  };
}
