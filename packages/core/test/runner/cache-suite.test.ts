import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type BlockKeyParts, blockCacheKey } from '../../src/runner/cache';
import { resolveGiven } from '../../src/runner/given';
import { canonicalJson } from '../../src/spec/hash';

/** The parts as the key reads them: the history before the block is its own SHA-256 under `prefix.sha256`. */
function keyed<T extends { given: { prefix: unknown } }>(parts: T): T {
  const history = createHash('sha256').update(canonicalJson(parts.given.prefix)).digest('hex');
  return { ...parts, given: { ...parts.given, prefix: { sha256: history } } };
}

const parts: BlockKeyParts = {
  specHash: 'hash-1',
  repeat: 0,
  position: 0,
  given: resolveGiven({ ledger: {}, world: {}, vars: {} }, [], { adapter: 'function', agent: 'demo' }),
  stimulus: { user: 'hi' },
  target: { adapter: 'function', agent: 'demo' },
  adapter: 'function',
  adapterVersion: 'v1',
};

describe('the cache key per suite', () => {
  it('is unchanged when no suite is named, so existing caches keep their keys', () => {
    expect(blockCacheKey(parts)).toBe(blockCacheKey({ ...parts, suite: undefined }));
  });

  it('differs between two suites, so a new suite name invalidates the cached blocks of the old one', () => {
    expect(blockCacheKey({ ...parts, suite: 'nightly-2' })).not.toBe(
      blockCacheKey({ ...parts, suite: 'nightly-1' }),
    );
    expect(blockCacheKey({ ...parts, suite: 'nightly-1' })).not.toBe(blockCacheKey(parts));
  });
});

describe('each block records the cache key it was stored under', () => {
  // The run that stores a block under this key and reads it back is in run.test.ts. A resolved Given
  // always carries its prefix, the list the key reads message by message.
  it('the block key is the block prefix and a SHA-256 digest, the form a block result carries', () => {
    expect(
      blockCacheKey({ ...parts, given: { ...parts.given, prefix: [{ role: 'user', content: 'x' }] } }),
    ).toMatch(/^block:[0-9a-f]{64}$/);
    expect(blockCacheKey(parts)).toMatch(/^block:[0-9a-f]{64}$/);
    // The same holds for a Given the runner resolved itself.
    expect(
      blockCacheKey({ ...parts, given: resolveGiven({ ledger: {}, world: {}, vars: {} }, [], parts.target) }),
    ).toMatch(/^block:[0-9a-f]{64}$/);
  });
});

describe('the cache key per agent version', () => {
  it('keeps the exact legacy digest when no agent version is supplied, with or without a suite', () => {
    for (const legacy of [parts, { ...parts, suite: 'nightly' }]) {
      const expected = `block:${createHash('sha256')
        .update(canonicalJson(keyed(legacy)))
        .digest('hex')}`;
      expect(blockCacheKey(legacy)).toBe(expected);
      expect(blockCacheKey({ ...legacy, agentVersion: undefined })).toBe(expected);
    }
  });

  it('isolates agent versions without changing the pinned target', () => {
    expect(blockCacheKey({ ...parts, agentVersion: 'v1' })).not.toBe(blockCacheKey(parts));
    expect(blockCacheKey({ ...parts, agentVersion: 'v1' })).not.toBe(
      blockCacheKey({ ...parts, agentVersion: 'v2' }),
    );
  });
});
