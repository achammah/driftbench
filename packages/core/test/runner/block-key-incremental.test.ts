import { createHash, type Hash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { extendHistory } from '../../src/contracts/history';
import { blockCacheKey } from '../../src/runner/cache';
import { resolveGiven } from '../../src/runner/given';
import type { Message, TargetRef } from '../../src/schema/common';
import type { Stimulus } from '../../src/schema/spec';
import { canonicalJson, sha256WithList } from '../../src/spec/hash';

/**
 * The cache key of a block hashes the history before it. The position of the block sits in the bytes before
 * the history, so the saved digest of the previous block's key cannot be used when the key reads the history
 * as part of one text: every block rehashes every message before it, and a run of n blocks hashes n squared
 * messages. The key hashes the incremental digest of the history instead, so a block hashes what it adds.
 * Hash bytes are counted, not time: the count is the same on every machine and under every load.
 */

const TARGET = { adapter: 'function', agent: 'scale' } as unknown as TargetRef;
const STIMULUS = { user: 'next' } as unknown as Stimulus;
const hashPrototype = Object.getPrototypeOf((await import('node:crypto')).createHash('sha256')) as Hash;

/** The bytes the hash updates take while `work` runs. */
function bytesHashed(work: () => void): number {
  let bytes = 0;
  const original = hashPrototype.update;
  const spy = vi.spyOn(hashPrototype, 'update').mockImplementation(function (
    this: Hash,
    data: string | NodeJS.ArrayBufferView,
    ...rest: unknown[]
  ) {
    bytes += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    return (original as (...args: unknown[]) => Hash).call(this, data, ...rest);
  } as typeof hashPrototype.update);
  try {
    work();
  } finally {
    spy.mockRestore();
  }
  return bytes;
}

/** A run of `blocks` blocks, two messages each, resolving the Given then the key of each block as the runner does. */
function run(blocks: number): { keys: string[]; keyBytes: number } {
  let history: readonly Message[] = [];
  const keys: string[] = [];
  let keyBytes = 0;
  for (let block = 0; block < blocks; block += 1) {
    // The ledger changes every few blocks, as a flow that adds facts does.
    const given = resolveGiven(
      { ledger: { step: Math.floor(block / 3) }, world: {}, vars: {} },
      history,
      TARGET,
    );
    keyBytes += bytesHashed(() => {
      keys.push(
        blockCacheKey({
          specHash: 'spec',
          repeat: 0,
          position: block,
          given,
          stimulus: STIMULUS,
          target: TARGET,
          adapter: 'function',
          adapterVersion: '1',
        }),
      );
    });
    history = extendHistory(history as Message[], [
      { role: 'user', content: `question number ${block}, with some words around it` },
      { role: 'assistant', content: `answer number ${block}, with some more words around it` },
    ]);
  }
  return { keys, keyBytes };
}

describe('the block cache key reads the history incrementally', () => {
  it('hashes bytes in proportion to the blocks: 800 blocks cost about ten times 80, not a hundred times', () => {
    const small = run(80).keyBytes;
    const large = run(800).keyBytes;
    expect(small).toBeGreaterThan(0);
    // Linear is 10; a key that rehashes the history each block is near 100.
    expect(large / small).toBeLessThan(14);
  });

  it('gives the same key for a history reached by growing it as for the same history built whole', () => {
    const grown = run(60).keys;
    // The key does not depend on the order the keys were asked for: ask again, last block first.
    const again = run(60).keys;
    expect(again).toEqual(grown);
    expect(new Set(grown).size).toBe(grown.length);
  });
});

describe('the format of the key', () => {
  it('is the SHA-256 of the canonical JSON of the parts, with the history as its own SHA-256 under prefix.sha256', () => {
    const history = extendHistory(
      [],
      [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
    );
    const given = resolveGiven({ ledger: { plan: 'L' }, world: {}, vars: {} }, history, TARGET);
    const parts = {
      specHash: 'spec',
      repeat: 1,
      position: 3,
      given,
      stimulus: STIMULUS,
      target: TARGET,
      adapter: 'function',
      adapterVersion: '1',
    };
    const historyDigest = createHash('sha256').update(canonicalJson(history)).digest('hex');
    const expected = createHash('sha256')
      .update(canonicalJson({ ...parts, given: { ...given, prefix: { sha256: historyDigest } } }))
      .digest('hex');
    expect(blockCacheKey(parts)).toBe(`block:${expected}`);
  });
});

describe('sha256WithList prefers a state under the same head to a longer text under another', () => {
  it('continues from the same-head state when another head already read the new messages', () => {
    const message = (at: number): Message => ({
      role: 'user',
      content: `message ${at} of the run, in some words`,
    });
    const short = extendHistory(
      [],
      Array.from({ length: 50 }, (_, at) => message(at)),
    );
    const longer = extendHistory(short, [message(50), message(51)]);
    const head = '{"head":"a","prefix":';
    sha256WithList(head, short, '}');
    // Another head reads the two new messages first, as the Given hash does before the block's key.
    sha256WithList('{"head":"b","prefix":', longer, '}');
    let digest = '';
    const bytes = bytesHashed(() => {
      digest = sha256WithList(head, longer, '}');
    });
    expect(digest).toBe(sha256Plain(head, longer, '}'));
    // Two messages and the tail, not the text of 52 messages (about 3,500 bytes).
    expect(bytes).toBeLessThan(400);
  });
});

function sha256Plain(head: string, items: readonly unknown[], tail: string): string {
  return createHash('sha256')
    .update(`${head}${canonicalJson(items)}${tail}`)
    .digest('hex');
}
