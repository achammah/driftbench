import type { AgentAdapter } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { acmeAdapter, specOf } from './support';

const driver = createScriptedDriver();

const unpairedPrefix = [
  { role: 'user', content: 'Hi, I want home internet at 12 Oak Street, Acmeville.' },
  {
    role: 'assistant',
    content: 'Let me check.',
    tool_calls: [{ id: 'call-1', label: 'coverage.check', input: { address: '12 Oak Street' } }],
  },
];

/** Two trees. The first root starts from a prefix with an unpaired call; the second root has none. */
const forest = specOf({
  id: 'forest-given-error',
  blocks: [
    { id: 'bad', user: 'Hi, I want home internet.', given: { prefix: unpairedPrefix } },
    { id: 'bad-child', parent: 'bad', user: 'Yes please.' },
    { id: 'good', user: 'What are your opening hours?' },
    { id: 'good-child', parent: 'good', user: 'Thanks.' },
  ],
});

const statusOf = (run: Awaited<ReturnType<typeof runSpec>>) =>
  Object.fromEntries(run.blocks.map((block) => [block.blockId, block.status ?? 'ran']));

describe('a Given error in one tree of a parent-linked spec', () => {
  it.each(['F', 'P', 'T'] as const)(
    'mode %s: the block is not_run, its child is blocked, the other tree runs',
    async (mode) => {
      const adapter = acmeAdapter();
      const run = await runSpec(forest, { adapter, driver, checks: [], mode, repeat: 0 });
      expect(statusOf(run)).toEqual({
        bad: 'not_run',
        'bad-child': 'blocked',
        good: 'ran',
        'good-child': 'ran',
      });
      expect(adapter.calls.send).toBe(2);
      expect(run.blocks.find((block) => block.blockId === 'bad')?.notRun?.kind).toBe('given_unmet');
    },
  );

  it('a Given error on a child leaves its parent and the sibling tree alone', async () => {
    const spec = specOf({
      id: 'child-given-error',
      blocks: [
        { id: 'root', user: 'Hi, I want home internet.' },
        { id: 'bad-child', parent: 'root', user: 'Yes please.', given: { prefix: unpairedPrefix } },
        { id: 'ok-child', parent: 'root', user: 'Thanks.' },
      ],
    });
    const adapter = acmeAdapter();
    const run = await runSpec(spec, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(statusOf(run)).toEqual({ root: 'ran', 'bad-child': 'not_run', 'ok-child': 'ran' });
    expect(adapter.calls.send).toBe(2);
  });
});

/** An adapter with a sandbox whose files read back as `readBack` says; it has no snapshot, so only roots run. */
function sandboxAdapter(readBack: (path: string) => string): AgentAdapter & { sends: number } {
  const adapter = {
    id: 'sandboxed',
    version: '1',
    sends: 0,
    capabilities: () => ({
      variants: false,
      seedPrefix: false,
      toolStubs: false,
      trace: false,
      sandbox: true,
      endState: false,
      deterministic: true,
    }),
    async open(given) {
      return { id: 's', adapter: 'sandboxed', target: given.target, given, history: [] };
    },
    async send() {
      adapter.sends += 1;
      return {
        segments: [{ type: 'text', text: 'done' }],
        text: 'done',
        toolCalls: [],
        cost: {},
        latencyMs: 0,
      };
    },
    async readArtifact(_session, path) {
      return new TextEncoder().encode(readBack(path));
    },
    async close() {},
  } satisfies AgentAdapter & { sends: number };
  return adapter;
}

describe('the dynamic check after setup on a parent-linked spec', () => {
  it('a root whose workspace reads back different is not_run setup_failed; its child is blocked, the other root runs', async () => {
    const spec = specOf({
      id: 'forest-setup',
      kind: 'task',
      blocks: [
        {
          id: 'seeded',
          user: 'Summarise the notes.',
          given: { world: { workspace: { files: { 'b.txt': 'world' } } } },
        },
        { id: 'seeded-child', parent: 'seeded', user: 'And again.' },
        { id: 'plain', user: 'Say hello.' },
      ],
    });
    const adapter = sandboxAdapter(() => 'WORLD');
    const run = await runSpec(spec, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.status).toBe('completed');
    expect(statusOf(run)).toEqual({ seeded: 'not_run', 'seeded-child': 'blocked', plain: 'ran' });
    expect(run.blocks.find((block) => block.blockId === 'seeded')?.notRun?.kind).toBe('setup_failed');
    expect(adapter.sends).toBe(1);
  });
});
