import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { blockCacheKey } from '../src/runner/cache';
import { resolveGiven } from '../src/runner/given';
import type { Message } from '../src/schema/common';
import {
  canonicalJson,
  canonicalJsonWithList,
  cloneJson,
  contentHash,
  contentHashWithList,
  sha256WithList,
} from '../src/spec/hash';

const messages: Message[] = [
  { role: 'user', content: 'hello' },
  {
    role: 'assistant',
    content: 'hi',
    tool_calls: [{ label: 'a.b', input: { z: 1, a: [1, { y: 2 }] } }],
  },
];

describe('the canonical text of a list read item by item', () => {
  it('is the text canonicalJson gives, and the hash is the content hash', () => {
    const value = { vars: { b: 1, a: 2 }, prefix: [...messages, null, 3], ledger: {}, skipped: undefined };
    expect(canonicalJsonWithList(value, 'prefix')).toBe(canonicalJson(value));
    expect(contentHashWithList(value, 'prefix')).toBe(contentHash(value));
    expect(canonicalJsonWithList({ prefix: [] }, 'prefix')).toBe(canonicalJson({ prefix: [] }));
  });

  it('gives a block cache key equal to the canonical JSON of the parts, the history as its SHA-256', () => {
    const given = resolveGiven({ ledger: { k: 'v' }, world: {}, vars: {} }, messages, {
      adapter: 'function',
    });
    const parts = {
      specHash: 'abc',
      repeat: 0,
      position: 2,
      given,
      stimulus: { user: 'again' },
      target: { adapter: 'function' },
      adapter: 'function',
      adapterVersion: '1',
    };
    const { hash, ...body } = given;
    expect(hash).toBe(contentHash(body));
    // The history before the block enters as its own SHA-256, so a block hashes only the messages it adds.
    const history = createHash('sha256').update(canonicalJson(given.prefix)).digest('hex');
    const keyed = { ...parts, given: { ...given, prefix: { sha256: history } } };
    expect(blockCacheKey(parts)).toBe(
      `block:${createHash('sha256').update(canonicalJson(keyed)).digest('hex')}`,
    );
  });
});

describe('the digest of a growing list', () => {
  it('equals the plain digest at every length, whether the list grew, was cut or changed', () => {
    const head = '{"a":1,"prefix":';
    const tail = ',"z":2}';
    const all = Array.from({ length: 12 }, (_, at) => ({ role: 'user', content: `m${at}`, n: { at } }));
    const plain = (items: unknown[]) =>
      createHash('sha256')
        .update(`${head}${canonicalJson(items)}${tail}`)
        .digest('hex');
    for (const length of [0, 1, 2, 5, 5, 12, 3, 0, 7]) {
      expect(sha256WithList(head, all.slice(0, length), tail)).toBe(plain(all.slice(0, length)));
    }
    const other = [...all.slice(0, 4), { role: 'user', content: 'changed' }, ...all.slice(5, 9)];
    expect(sha256WithList(head, other, tail)).toBe(plain(other));
  });
});

describe('cloneJson', () => {
  it('copies deep, keeps what structuredClone keeps, and shares nothing', () => {
    const date = new Date(0);
    const source = { a: [1, { b: 'c' }], d: date, e: null, f: undefined };
    const copy = cloneJson(source);
    expect(copy).toEqual(structuredClone(source));
    expect(copy.a).not.toBe(source.a);
    expect(copy.a[1]).not.toBe(source.a[1]);
    expect(copy.d).not.toBe(date);
  });
});
