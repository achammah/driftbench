import { createHash } from 'node:crypto';
import type { Store } from '../contracts/store';
import type { TargetRef } from '../schema/common';
import type { Observed, ResolvedGiven } from '../schema/run';
import type { Stimulus } from '../schema/spec';
import { canonicalJson, sha256WithList } from '../spec/hash';
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
 * The cache key of one block: the spec hash, the repeat, the block's position, its resolved Given, its
 * stimulus, the target and the adapter version (SHA-256 of the canonical JSON), with the history before the
 * block read as its own SHA-256 so that it is hashed once per message, not once per block.
 */
export function blockCacheKey(parts: BlockKeyParts): string {
  // The Given's prefix, the one part that grows with the run, enters the key as the SHA-256 of its canonical
  // JSON, kept from block to block: a block hashes the messages it adds, not the whole history again. The
  // bytes before the history change with every block (the position), so the history cannot be part of one
  // running text.
  const history = sha256WithList('', parts.given.prefix, '');
  return `block:${sha256(canonicalJson({ ...parts, given: { ...parts.given, prefix: { sha256: history } } }))}`;
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
