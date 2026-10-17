import { createHash } from 'node:crypto';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { copyHistory, extendHistory, freezeHistory, freezeMessage } from '../../src/contracts/history';
import { runSpec } from '../../src/runner/run';
import type { Message } from '../../src/schema/common';
import { canonicalJson, noteExtension, sha256WithList } from '../../src/spec/hash';
import { specOf } from './support';

/**
 * The history lists of a run are read-only lists made once and extended by one block at a time. These tests hold
 * their results equal to the lists the runner built before (a reference copy of the old code), their digests
 * equal to the digests recorded before, and their CPU time linear in the number of blocks.
 */

// The reference: copyHistory and freezeHistory as they were before the lists became incremental.
const refSnapshots = new WeakMap<readonly Message[], readonly Message[]>();
const refImmutable = new WeakSet<readonly Message[]>();

function refCopyHistory(messages: readonly Message[], appended: readonly Message[] = []): Message[] {
  const copy: Message[] = [];
  const capture = (source: readonly Message[], path: string): void => {
    const previous = refSnapshots.get(source);
    if (refImmutable.has(source) && previous) {
      for (const message of previous) copy.push(message);
      return;
    }
    if (!Array.isArray(source) || Object.getPrototypeOf(source) !== Array.prototype)
      throw new TypeError(`${path}: expected an ordinary array`);
    const length = Object.getOwnPropertyDescriptor(source, 'length')?.value as number;
    const keys = Reflect.ownKeys(source);
    if (keys.length !== length + 1 || keys[length] !== 'length') {
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(source, index))
          throw new TypeError(`${path}[${index}]: expected a message object; history must be dense`);
      }
      throw new TypeError(`${path}: non-index property; expected plain JSON data`);
    }
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(source, keys[index] as string) as PropertyDescriptor;
      if (!('value' in descriptor))
        throw new TypeError(`${path}[${index}]: accessor property; expected plain JSON data`);
      if (!descriptor.enumerable)
        throw new TypeError(`${path}[${index}]: non-enumerable property; expected plain JSON data`);
      const message = descriptor.value;
      if (message === null || typeof message !== 'object')
        throw new TypeError(`${path}[${index}]: expected a message object`);
      if (previous?.[index] !== message) freezeMessage(message);
      copy.push(message);
    }
  };
  capture(messages, 'history');
  capture(appended, 'appended');
  const snapshot = [...copy];
  if (!refImmutable.has(messages)) refSnapshots.set(messages, snapshot);
  refSnapshots.set(copy, snapshot);
  return copy;
}

function refFreezeHistory(
  messages: readonly Message[],
  appended: readonly Message[] = [],
): readonly Message[] {
  const copy = refCopyHistory(messages, appended);
  Object.freeze(copy);
  refImmutable.add(copy);
  return copy;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function message(next: () => number, id: number): Message {
  const roll = next();
  if (roll < 0.5) return { role: 'user', content: `u${id}` };
  if (roll < 0.8) return { role: 'assistant', content: `a${id}` };
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{ label: 'lookup', input: { q: id } }],
  };
}

const clone = (value: Message): Message => structuredClone(value);

function outcome<T>(run: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: run() };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function sameResult(
  expected: ReturnType<typeof outcome<readonly Message[]>>,
  actual: ReturnType<typeof outcome<readonly Message[]>>,
  label: string,
): void {
  expect(actual.ok, label).toBe(expected.ok);
  if (expected.ok && actual.ok) {
    expect(actual.value, label).toEqual(expected.value);
    expect(Object.isFrozen(actual.value), label).toBe(Object.isFrozen(expected.value));
    expect(
      actual.value.every((entry) => Object.isFrozen(entry)),
      label,
    ).toBe(true);
  } else if (!expected.ok && !actual.ok) {
    expect(actual.error, label).toBe(expected.error);
  }
}

describe('the incremental history lists give the lists of the old code', () => {
  it('on random sequences of freezing, copying and extending', () => {
    const next = random(20261017);
    for (let round = 0; round < 400; round++) {
      let id = 0;
      let oldList: readonly Message[] = [];
      let newList: readonly Message[] = [];
      const steps = 1 + Math.floor(next() * 12);
      for (let step = 0; step < steps; step++) {
        const added = Array.from({ length: Math.floor(next() * 4) }, () => message(next, id++));
        const label = `round ${round} step ${step}`;
        const kind = next();
        if (kind < 0.4) {
          const expected = outcome(() => refFreezeHistory(oldList, added.map(clone)));
          const actual = outcome(() => freezeHistory(newList, added.map(clone)));
          sameResult(expected, actual, label);
          if (expected.ok && actual.ok) [oldList, newList] = [expected.value, actual.value];
        } else if (kind < 0.6) {
          const expected = outcome(() => refCopyHistory(oldList, added.map(clone)));
          const actual = outcome(() => copyHistory(newList, added.map(clone)));
          sameResult(expected, actual, label);
          expect(Object.isFrozen(actual.ok ? actual.value : []), label).toBe(false);
        } else {
          // A session: the adapter's mutable copy of the list, which the runner then appends to.
          const oldSession = refCopyHistory(oldList);
          const newSession = copyHistory(newList);
          const edit = next();
          if (edit < 0.2 && oldSession.length > 0) {
            const at = Math.floor(next() * oldSession.length);
            const replacement = message(next, id++);
            oldSession[at] = clone(replacement);
            newSession[at] = clone(replacement);
          } else if (edit < 0.3 && oldSession.length > 0) {
            oldSession.length -= 1;
            newSession.length -= 1;
          } else if (edit < 0.4 && oldSession.length > 0) {
            const at = Math.floor(next() * oldSession.length);
            delete oldSession[at];
            delete newSession[at];
          } else if (edit < 0.5) {
            const extra = message(next, id++);
            oldSession.push(clone(extra));
            newSession.push(clone(extra));
          }
          const expected = outcome(() => refFreezeHistory(oldSession, added.map(clone)));
          const actual = outcome(() => extendHistory(newSession, added.map(clone)));
          sameResult(expected, actual, label);
          if (expected.ok && actual.ok) [oldList, newList] = [expected.value, actual.value];
        }
      }
    }
  });

  it('reads no property of the messages of an unchanged session copy', () => {
    const base = freezeHistory([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ]);
    const session = copyHistory(base);
    const descriptor = Object.getOwnPropertyDescriptor;
    let reads = 0;
    Object.getOwnPropertyDescriptor = ((target: object, key: PropertyKey) => {
      if (target === session) reads += 1;
      return descriptor(target, key);
    }) as typeof Object.getOwnPropertyDescriptor;
    try {
      const next = extendHistory(session, [{ role: 'user', content: 'three' }]);
      expect(next.map((entry) => entry.content)).toEqual(['one', 'two', 'three']);
      expect(Object.isFrozen(next)).toBe(true);
    } finally {
      Object.getOwnPropertyDescriptor = descriptor;
    }
    expect(reads).toBe(0);
  });

  it('validates in full an array that is not a copy of ours', () => {
    expect(() => extendHistory([{ role: 'user', content: 'x' }, undefined as unknown as Message])).toThrow(
      /history\[1\].*message object/,
    );
    const accessor = Object.defineProperty([], '0', {
      enumerable: true,
      get: () => ({ role: 'user', content: 'x' }),
    });
    expect(() => extendHistory(accessor as Message[])).toThrow(/0.*accessor/);
  });

  it('copies a read-only list without reading its elements one by one', () => {
    const frozen = freezeHistory(
      Array.from({ length: 50 }, (_, at): Message => ({ role: 'user', content: `m${at}` })),
    );
    const descriptor = Object.getOwnPropertyDescriptor;
    let reads = 0;
    Object.getOwnPropertyDescriptor = ((target: object, key: PropertyKey) => {
      if (Array.isArray(target) && target.length >= 50) reads += 1;
      return descriptor(target, key);
    }) as typeof Object.getOwnPropertyDescriptor;
    try {
      const copy = copyHistory(frozen);
      const longer = copyHistory(frozen, [{ role: 'user', content: 'more' }]);
      expect(copy).toHaveLength(50);
      expect(longer).toHaveLength(51);
      expect(Object.isFrozen(copy)).toBe(false);
      copy.push({ role: 'user', content: 'private' });
      expect(frozen).toHaveLength(50);
    } finally {
      Object.getOwnPropertyDescriptor = descriptor;
    }
    expect(reads).toBe(0);
  });
});

describe('the digest of a list that grows by extension', () => {
  const plain = (head: string, items: readonly unknown[], tail: string) =>
    createHash('sha256')
      .update(`${head}${canonicalJson(items)}${tail}`)
      .digest('hex');

  it('is the plain digest along a chain, under a head that changes, and for a list that only looks like an extension', () => {
    let list: readonly Message[] = [];
    const lists: (readonly Message[])[] = [];
    for (let at = 0; at < 60; at++) {
      list = freezeHistory(list, [{ role: 'user', content: `m${at}` }]);
      lists.push(list);
      const head = `{"ledger":{"step":${at % 7}},"prefix":`;
      expect(sha256WithList(head, list, '}')).toBe(plain(head, list, '}'));
      // Another head: the digest state of the first cannot be used, the text can.
      const other = `{"position":${at},"prefix":`;
      expect(sha256WithList(other, list, '}')).toBe(plain(other, list, '}'));
    }
    // The same length and a different first item, frozen, with no link to the chain.
    const stranger = freezeHistory(
      lists[58]?.map((entry, at) => (at === 0 ? { role: 'user' as const, content: 'other' } : entry)) ?? [],
    );
    const head = '{"ledger":{"step":1},"prefix":';
    expect(sha256WithList(head, stranger, '}')).toBe(plain(head, stranger, '}'));
    // A link between lists that are not a prefix of each other is refused: it names a mutable list.
    const mutable = [{ role: 'user', content: 'x' }];
    noteExtension(mutable, lists[3] ?? []);
    expect(sha256WithList(head, lists[59] ?? [], '}')).toBe(plain(head, lists[59] ?? [], '}'));
  });
});

const GOLDEN = {
  F: {
    givenHashes: [
      '24f2ce67625a',
      '9f783c56bee7',
      '3f2932c7d601',
      '564987062e39',
      '5e03638e3ca5',
      '5ca37fcebf2b',
    ],
    cacheKeys: [
      'block:d9b4a69fd2b2eeb251b3f40d444140e0e62a3a296ea13526e786bc9bc76d0a18',
      'block:56dd0e4a0f85c4dc0b6c8a00a46adfcd879b7e7c5a150127593bcae895f5cf49',
      'block:271687a12489f6471d53e1d0d8095ac910d8ee270a98b074d4e0a7a67d91632d',
      'block:e624f3754a4a862e2c4a5fd399c466555f424143cae1f7052bac8e9aa2a350f9',
      'block:4e8a5a02e3aa9229d5348cfc27b347001cb63640c17eb8676f6a12f5660fd7b5',
      'block:5a594b74474b1ece1c470c418f97d3325184bad755e218940db0a58c07f27eaa',
    ],
  },
  T: {
    givenHashes: [
      '24f2ce67625a',
      '8c6d88eff7a3',
      '3b4302042879',
      '4d4f26cc5fe5',
      '5e03638e3ca5',
      '159544156bd9',
    ],
    cacheKeys: [
      'block:d9b4a69fd2b2eeb251b3f40d444140e0e62a3a296ea13526e786bc9bc76d0a18',
      'block:a584f745fa40893cc85a77d2775fe15b181f5a6d863092e15ef962320b3b64eb',
      'block:803d0386a91150ef2ec2da8937ce4966eb906417166ad1baaa41b687e01a4b8d',
      'block:e90a2a8aa207c9b219b5abb110114d774aacd07052a9b2ca66c7034fbe657c69',
      'block:4e8a5a02e3aa9229d5348cfc27b347001cb63640c17eb8676f6a12f5660fd7b5',
      'block:98d7c545553941f3f80c5d6f2a3f2d71a03005053ca2e6d36fda9e52eef68f6c',
    ],
  },
  P: {
    givenHashes: [
      '24f2ce67625a',
      '9f783c56bee7',
      '3f2932c7d601',
      '564987062e39',
      '5e03638e3ca5',
      '5ca37fcebf2b',
    ],
    cacheKeys: [
      'block:d9b4a69fd2b2eeb251b3f40d444140e0e62a3a296ea13526e786bc9bc76d0a18',
      'block:56dd0e4a0f85c4dc0b6c8a00a46adfcd879b7e7c5a150127593bcae895f5cf49',
      'block:271687a12489f6471d53e1d0d8095ac910d8ee270a98b074d4e0a7a67d91632d',
      'block:e624f3754a4a862e2c4a5fd399c466555f424143cae1f7052bac8e9aa2a350f9',
      'block:4e8a5a02e3aa9229d5348cfc27b347001cb63640c17eb8676f6a12f5660fd7b5',
      'block:5a594b74474b1ece1c470c418f97d3325184bad755e218940db0a58c07f27eaa',
    ],
  },
} as const;

describe('the digests of a run are the ones recorded before the lists became incremental', () => {
  const spec = specOf({
    id: 'golden-digests',
    given: { ledger: { shop: 'Larkspur' } },
    blocks: [
      { user: 'Is the Kestrel XL free?', expect: { ledger_add: { asked: 'kestrel' } } },
      { burst: ['Book it for Friday.', 'Under the name Brell.'] },
      { user: 'What does it cost?', given: { ledger: { currency: 'EUR' } } },
      { user: 'And a helmet?', expect: { ledger_add: { extra: 'helmet' } } },
      {
        user: 'Thanks.',
        given: {
          prefix: [
            { role: 'user', content: 'earlier' },
            { role: 'assistant', content: 'noted' },
          ],
        },
      },
      { user: 'Bye.' },
    ],
  });

  it.each(['F', 'T', 'P'] as const)('in mode %s', async (mode) => {
    const result = await runSpec(spec, {
      adapter: functionAdapter({ respond: (messages) => reply(`reply ${messages.length}`) }),
      driver: createScriptedDriver(),
      checks: [],
      mode,
      repeat: 0,
    });
    expect(result.status).toBe('completed');
    expect(result.blocks.map((block) => block.givenHash)).toEqual(GOLDEN[mode].givenHashes);
    expect(result.blocks.map((block) => block.cacheKey)).toEqual(GOLDEN[mode].cacheKeys);
  });
});

function reply(text: string) {
  return { segments: [], text, toolCalls: [], cost: { usd: 0 }, latencyMs: 0 };
}

describe('what an agent receives', () => {
  it('is the same messages as before, in a fresh private array each block', async () => {
    const spec = specOf({ id: 'seen', blocks: [{ user: 'one' }, { user: 'two' }, { user: 'three' }] });
    const seen: string[][] = [];
    await runSpec(spec, {
      adapter: functionAdapter({
        respond: (messages) => {
          seen.push(messages.map((entry) => `${entry.role}:${entry.content}`));
          messages.push({ role: 'user', content: 'edited by the agent' });
          return reply(`r${seen.length}`);
        },
      }),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
    });
    expect(seen).toEqual([
      ['user:one'],
      ['user:one', 'assistant:r1', 'user:two'],
      ['user:one', 'assistant:r1', 'user:two', 'assistant:r2', 'user:three'],
    ]);
  });
});

async function walksOf(blocks: number, mode: 'F' | 'T' | 'P'): Promise<number> {
  const spec = specOf({
    id: `walks-${blocks}`,
    blocks: Array.from({ length: blocks }, (_, at) => ({ user: `turn ${at}` })),
  });
  const original = Object.getOwnPropertyDescriptor;
  let walked = 0;
  Object.getOwnPropertyDescriptor = ((target: object, key: PropertyKey) => {
    const first = Array.isArray(target) ? (target[0] as { role?: string } | undefined) : undefined;
    if (first?.role !== undefined && key !== 'length') walked += 1;
    return original(target, key);
  }) as typeof Object.getOwnPropertyDescriptor;
  try {
    const result = await runSpec(spec, {
      adapter: functionAdapter({ respond: (messages) => reply(`reply ${messages.length}`) }),
      driver: createScriptedDriver(),
      checks: [],
      mode,
      repeat: 0,
    });
    expect(result.status).toBe('completed');
  } finally {
    Object.getOwnPropertyDescriptor = original;
  }
  return walked;
}

describe('a run validates each message a bounded number of times', () => {
  // Before the lists were incremental a run read the properties of every message of the history at every block:
  // 270,000 reads for 300 blocks, a hundred times the reads of 30 blocks.
  it.each(['F', 'T', 'P'] as const)(
    'in mode %s, ten times the blocks take ten times the reads',
    async (mode) => {
      const small = await walksOf(30, mode);
      const large = await walksOf(300, mode);
      expect(small).toBeGreaterThan(0);
      expect(large / small).toBeLessThanOrEqual(11);
      expect(large).toBeLessThanOrEqual(10 * 300);
    },
  );
});

async function cpuMs(run: () => Promise<unknown>): Promise<number> {
  const before = process.cpuUsage();
  await run();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

async function blocksCpu(blocks: number, mode: 'F' | 'T', attempts: number): Promise<number> {
  const spec = specOf({
    id: `long-${blocks}`,
    blocks: Array.from({ length: blocks }, (_, at) => ({ user: `turn ${at}` })),
  });
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < attempts; attempt++) {
    best = Math.min(
      best,
      await cpuMs(async () => {
        const result = await runSpec(spec, {
          adapter: functionAdapter({ respond: (messages) => reply(`reply ${messages.length}`) }),
          driver: createScriptedDriver(),
          checks: [],
          mode,
          repeat: 0,
        });
        expect(result.status).toBe('completed');
      }),
    );
  }
  return best;
}

describe('a run of 2,500 blocks costs little more than hashing its history', () => {
  // The digest of each block's cache key covers the bytes of the whole history, and a SHA-256 digest cannot reuse
  // work across keys that begin differently, so those bytes are the floor: one hash of the history text for
  // every second block. Before the lists were incremental a run cost about 18 times that floor; it now costs
  // about 5. The ratio to the floor, both measured here, holds under load where a fixed time would not.
  const BLOCKS = 2500;
  it.each(['F', 'T'] as const)(
    'in mode %s, within ten times the hashing floor',
    async (mode) => {
      const history = Array.from({ length: 2 * BLOCKS }, (_, at) => ({
        role: at % 2 === 0 ? 'user' : 'assistant',
        content: at % 2 === 0 ? `turn ${at / 2}` : `reply ${at}`,
      }));
      const text = canonicalJson(history);
      let floor = Number.POSITIVE_INFINITY;
      for (let attempt = 0; attempt < 3; attempt++) {
        floor = Math.min(
          floor,
          await cpuMs(async () => {
            for (let at = 0; at < BLOCKS / 2; at++) createHash('sha256').update(text).digest('hex');
          }),
        );
      }
      await blocksCpu(25, mode, 1);
      const run = await blocksCpu(BLOCKS, mode, 3);
      expect(run / Math.max(floor, 1)).toBeLessThan(10);
    },
    180_000,
  );
});
