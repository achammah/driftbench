import { type Message, type Observed, runSpec } from '@agent-nexus/driftbench-core';
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
