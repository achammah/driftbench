import { createHash } from 'node:crypto';
import type { Store } from '../contracts/store';
import type { TargetRef } from '../schema/common';
import type { Observed, ResolvedGiven } from '../schema/run';
import type { Expect, Spec, Stimulus } from '../schema/spec';
import { canonicalJson, contentHash, sha256OfJsonWithList } from '../spec/hash';
import { specIdentity } from '../spec/identity';
import { isPlainObject } from '../spec/normalize';

/** Where the runner keeps observed blocks. A Store is one; tests pass a map. */
export type ObservedCache = Pick<Store, 'cacheGet' | 'cachePut'>;

export type BlockKeyParts = {
  specHash: string;
  /** Repeats are independent samples: without the repeat, repeat 2 would replay repeat 1. */
  repeat: number;
  /** The position of the block in the run. */
  position: number;
  /** The whole resolved Given, the history so far included, not only its short hash. */
  given: ResolvedGiven;
  stimulus: Stimulus;
  target: TargetRef;
  adapter: string;
  adapterVersion: string;
  /** Adapter configuration fingerprint. Absent preserves every earlier cache key. */
  adapterCacheIdentity?: string;
  /** The suite the run belongs to, when it names one. Absent keeps the key every earlier cache used. */
  suite?: string;
  /** The agent version, when supplied. Absent preserves every earlier cache key. */
  agentVersion?: string;
};

/**
 * The spec hash a block cache key carries. It leaves out the spec's `version`, a free label that plays no part
 * (docs/running.md, "The cache and replay"), so relabelling a spec still replays its runs. It also leaves out the
 * scoring-only keys: `uses`, on the spec and on every block (the objects it names only score), and `compare` on an
 * expected tool, of a block or a perturbation (it only chooses how a value the agent already sent is read). Changing
 * them re-scores the stored observations and never reruns the agent. A spec with none of them hashes as before.
 */
export function cacheSpecHash(spec: Spec): string {
  const { version: _version, uses: _uses, ...unlabelled } = specIdentity(spec);
  const scoring =
    unlabelled.blocks.some((block) => block.uses !== undefined || writesCompare(block.expect)) ||
    (unlabelled.perturbations ?? []).some((perturbation) => writesCompare(perturbation.expect));
  if (!scoring) return contentHash(unlabelled);
  return contentHash({
    ...unlabelled,
    blocks: unlabelled.blocks.map(({ uses: _blockUses, ...block }) => withoutCompare(block)),
    ...(unlabelled.perturbations === undefined
      ? {}
      : { perturbations: unlabelled.perturbations.map(withoutCompare) }),
  });
}

/** True when an expectation writes `compare` on one of its expected tools. */
function writesCompare(expect: Expect | undefined): boolean {
  return (expect?.tools ?? []).some((tool) => tool.compare !== undefined);
}

/** A block or a perturbation with `compare` taken off its expected tools; the same object when it writes none. */
function withoutCompare<T extends { expect?: Expect }>(entry: T): T {
  if (!writesCompare(entry.expect) || entry.expect === undefined) return entry;
  return {
    ...entry,
    expect: { ...entry.expect, tools: entry.expect.tools?.map(({ compare: _compare, ...tool }) => tool) },
  };
}

/**
 * The cache key of one block: the spec hash, the repeat, the block's position, its resolved Given, its
 * stimulus, the target and the adapter version, hashed whole (SHA-256 of the canonical JSON).
 */
export function blockCacheKey(parts: BlockKeyParts): string {
  // The digest of the canonical JSON of `parts`, with the Given's prefix, the one part that grows with
  // the run, hashed incrementally: each message of the history is read once.
  return `block:${sha256OfJsonWithList((mark) => ({ ...parts, given: { ...parts.given, prefix: mark } }), parts.given.prefix)}`;
}

/** The cache key of one end-state read, taken after the block whose key is given. */
export function endStateCacheKey(blockKey: string, source: string): string {
  return `end_state:${sha256(canonicalJson({ blockKey, source }))}`;
}

/** The cache holds Observed records only, so an end-state read travels in `raw`. */
export function wrapEndState(value: unknown): Observed {
  return { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0, raw: { endState: value } };
}

export function unwrapEndState(observed: Observed): unknown {
  return isPlainObject(observed.raw) ? observed.raw.endState : undefined;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
