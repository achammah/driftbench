import {
  type Check,
  type Message,
  machineVerdict,
  type Observed,
  runSpec,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { specOf } from '../../core/test/runner/support';
import { functionAdapter } from '../src/function/index';

// Fictional data only: a bike shop. Blocks are written out of order, with two roots.
const block = (id: string, parent?: string) => ({
  id,
  ...(parent ? { parent } : {}),
  user: `say ${id}`,
  expect: { must: ['ok'] },
});
const spec = () =>
  specOf({
    id: 'forest',
    target: { adapter: 'function', agent: 'acme-bikes' },
    given: { ledger: { shop: 'north' } },
    blocks: [
      block('book', 'lookup'),
      block('walkin'),
      block('lookup', 'find'),
      block('find'),
      block('receipt', 'book'),
    ],
  });

const reply = (text: string): Observed => ({ segments: [], text, toolCalls: [], cost: {}, latencyMs: 0 });

describe.each(['F', 'T'] as const)('a spec with parent links, mode %s', (mode) => {
  it('runs each block after its parent, from the history of its ancestors only', async () => {
    const sent: { user: string; history: string[] }[] = [];
    const result = await runSpec(spec(), {
      adapter: functionAdapter({
        respond: (messages: Message[]) => {
          const users = messages.filter((m) => m.role === 'user').map((m) => String(m.content));
          sent.push({ user: users.at(-1) ?? '', history: users.slice(0, -1) });
          return reply('ok');
        },
      }),
      driver: createScriptedDriver(),
      checks: [],
      mode,
      repeat: 0,
    });
    expect(result.error).toBeUndefined();
    const order = sent.map((s) => s.user);
    expect(order.indexOf('say find')).toBeLessThan(order.indexOf('say lookup'));
    expect(order.indexOf('say lookup')).toBeLessThan(order.indexOf('say book'));
    expect(order.indexOf('say book')).toBeLessThan(order.indexOf('say receipt'));
    const of = (user: string) => sent.find((s) => s.user === user)?.history;
    expect(of('say find')).toEqual([]);
    expect(of('say walkin')).toEqual([]);
    expect(of('say lookup')).toEqual(['say find']);
    expect(of('say receipt')).toEqual(['say find', 'say lookup', 'say book']);
    expect(result.blocks).toHaveLength(5);
  });
});

describe.each(['F', 'T'] as const)('a failed parent, mode %s', (mode) => {
  it('blocks its descendants, each by its own parent and rooted at the first failure; other trees run', async () => {
    const sent: string[] = [];
    // The block "lookup" fails; "book" and "receipt" hang from it; "walkin" is another root.
    const failLookup: Check = {
      name: 'fail-lookup',
      applies: () => true,
      evaluate: (ctx) => [
        machineVerdict('fail-lookup', 'x', ctx.block.id === 'lookup' ? 'fail' : 'pass', 'planted'),
      ],
    };
    const result = await runSpec(spec(), {
      adapter: functionAdapter({
        respond: (messages: Message[]) => {
          sent.push(String(messages.filter((m) => m.role === 'user').at(-1)?.content));
          return reply('ok');
        },
      }),
      driver: createScriptedDriver(),
      checks: [failLookup],
      mode,
      repeat: 0,
    });
    const by = (id: string) => result.blocks.find((b) => b.blockId === id);
    expect(by('find')?.status ?? 'pass').toBe('pass');
    expect(by('lookup')?.status ?? 'fail').toBe('fail');
    expect(by('book')?.status).toBe('blocked');
    expect(by('book')?.blocked).toEqual({ by: 'lookup', root: 'lookup' });
    expect(by('receipt')?.blocked).toEqual({ by: 'book', root: 'lookup' });
    expect(by('walkin')?.status ?? 'pass').toBe('pass');
    expect(sent).not.toContain('say book');
    expect(sent).not.toContain('say receipt');
    expect(sent).toContain('say walkin');
    expect(result.blocks).toHaveLength(5);
  });
});

describe.each(['F', 'T'] as const)('an adapter that cannot seed a prefix, mode %s', (mode) => {
  it('makes a child of a passing parent not_run before it is sent, blocks its descendants, and still runs the roots', async () => {
    const sent: string[] = [];
    const base = functionAdapter({
      respond: (messages: Message[]) => {
        sent.push(String(messages.filter((m) => m.role === 'user').at(-1)?.content));
        return reply('ok');
      },
    });
    const adapter = { ...base, capabilities: () => ({ ...base.capabilities(), seedPrefix: false }) };
    const result = await runSpec(spec(), {
      adapter,
      driver: createScriptedDriver(),
      checks: [],
      mode,
      repeat: 0,
    });
    const by = (id: string) => result.blocks.find((b) => b.blockId === id);
    expect(by('lookup')?.status).toBe('not_run');
    expect(by('lookup')?.notRun?.kind).toBe('unsupported');
    expect(by('book')?.blocked).toEqual({ by: 'lookup', root: 'lookup' });
    expect(by('receipt')?.blocked).toEqual({ by: 'book', root: 'lookup' });
    expect(by('find')?.status ?? 'pass').toBe('pass');
    expect(by('walkin')?.status ?? 'pass').toBe('pass');
    expect(sent.sort()).toEqual(['say find', 'say walkin']);
    expect(result.blocks).toHaveLength(5);
  });
});

describe.each(['F', 'T'] as const)(
  'a failed root on an adapter that cannot seed a prefix, mode %s',
  (mode) => {
    it('blocks the child rather than making it not_run; a child of a passing parent is not_run', async () => {
      const base = functionAdapter({ respond: () => reply('ok') });
      const adapter = { ...base, capabilities: () => ({ ...base.capabilities(), seedPrefix: false }) };
      const failFind: Check = {
        name: 'fail-find',
        applies: () => true,
        evaluate: (ctx) => [
          machineVerdict('fail-find', 'x', ctx.block.id === 'find' ? 'fail' : 'pass', 'planted'),
        ],
      };
      const result = await runSpec(spec(), {
        adapter,
        driver: createScriptedDriver(),
        checks: [failFind],
        mode,
        repeat: 0,
      });
      const by = (id: string) => result.blocks.find((b) => b.blockId === id);
      expect(by('find')?.status ?? 'fail').toBe('fail');
      expect(by('lookup')?.status).toBe('blocked');
      expect(by('lookup')?.blocked).toEqual({ by: 'find', root: 'find' });
      expect(by('book')?.blocked).toEqual({ by: 'lookup', root: 'find' });
      expect(by('walkin')?.status ?? 'pass').toBe('pass');
    });
  },
);
