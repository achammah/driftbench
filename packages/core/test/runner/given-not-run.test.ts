import type { AgentAdapter } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { acmeAdapter, specOf } from './support';

const driver = createScriptedDriver();

/** Two blocks; the second starts from a prefix whose tool call carries no result. */
const unpaired = specOf({
  id: 'unpaired-prefix',
  blocks: [
    { user: 'Hi, I want home internet at 12 Oak Street, Acmeville.' },
    {
      user: 'Yes please.',
      given: {
        prefix: [
          { role: 'user', content: 'Hi, I want home internet at 12 Oak Street, Acmeville.' },
          {
            role: 'assistant',
            content: 'Let me check.',
            tool_calls: [{ id: 'call-1', label: 'coverage.check', input: { address: '12 Oak Street' } }],
          },
        ],
      },
    },
    { user: 'Thanks.' },
  ],
});

describe('a Given error found by the verifier is not_run given_unmet, never sent', () => {
  it('mode T: the block with the unpaired call and the one that keeps its history', async () => {
    const adapter = acmeAdapter();
    const run = await runSpec(unpaired, { adapter, driver, checks: [], mode: 'T', repeat: 0 });
    expect(run.blocks.map((block) => block.status)).toEqual([undefined, 'not_run', 'not_run']);
    expect(run.blocks[1]?.notRun).toEqual({
      kind: 'given_unmet',
      layer: '2 tool history',
      check: 'tool_history_paired',
      expected: 'coverage.check carries an output or an error',
      got: 'a call with no result',
    });
    expect(adapter.calls.send).toBe(1);
  });

  it('mode F: block 0 runs, the conversation stops at the defect', async () => {
    const adapter = acmeAdapter();
    const run = await runSpec(unpaired, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.blocks.map((block) => block.status)).toEqual([undefined, 'not_run', 'not_run']);
    expect(run.blocks[2]?.notRun?.got).toContain('block 1 was not run');
    expect(adapter.calls.send).toBe(1);
  });

  it('the same spec with the result recorded runs every block', async () => {
    const fixed = structuredClone(unpaired);
    const call = fixed.blocks[1]?.given?.prefix?.[1]?.tool_calls?.[0];
    if (call) call.output = { fiber: true };
    const adapter = acmeAdapter();
    const run = await runSpec(fixed, { adapter, driver, checks: [], mode: 'T', repeat: 0 });
    expect(run.blocks.every((block) => block.status === undefined)).toBe(true);
    expect(adapter.calls.send).toBe(3);
  });
});

describe('a shared fact on a block that inherits the prefix', () => {
  it('reads the inherited history: mode T runs both blocks', async () => {
    const spec = specOf({
      id: 'inherited-shared',
      given: { ledger: { address: '12 Oak Street' } },
      blocks: [
        {
          user: 'Hi, I want home internet.',
          given: { prefix: [{ role: 'user', content: 'I live at 12 Oak Street, Acmeville.' }] },
        },
        { user: 'Thanks.', given: { shared: [{ fact: 'address', by: 'user', in: 0 }] } },
      ],
    });
    const adapter = acmeAdapter();
    const run = await runSpec(spec, { adapter, driver, checks: [], mode: 'T', repeat: 0 });
    expect(run.blocks.map((block) => block.status)).toEqual([undefined, undefined]);
    expect(adapter.calls.send).toBe(2);
  });
});

/** An adapter with a sandbox whose files read back as `readBack` says. */
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

const seeded = specOf({
  id: 'seeded',
  kind: 'task',
  given: { world: { workspace: { files: { './notes/a.txt': 'hello', 'b.txt': 'world' } } } },
  blocks: [{ user: 'Summarise the notes.', expect: { must: ['done'] } }],
});

describe('the dynamic check after setup: the workspace reads back as the Given wrote it', () => {
  it('a file that reads back different makes the block not_run setup_failed, never sent', async () => {
    const adapter = sandboxAdapter((path) => (path === 'b.txt' ? 'WORLD' : 'hello'));
    const run = await runSpec(seeded, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.status).toBe('completed');
    expect(run.blocks[0]?.status).toBe('not_run');
    expect(run.blocks[0]?.notRun).toEqual({
      kind: 'setup_failed',
      layer: '5 world',
      check: 'world_digest',
      expected: 'the 2 files of world.workspace read back as written',
      got: 'b.txt differs',
    });
    expect(adapter.sends).toBe(0);
  });

  it('a workspace that reads back as written runs, reading ./ paths without the prefix', async () => {
    const read: string[] = [];
    const adapter = sandboxAdapter((path) => {
      read.push(path);
      return path === 'b.txt' ? 'world' : 'hello';
    });
    const run = await runSpec(seeded, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.blocks[0]?.status).toBeUndefined();
    expect(read).toEqual(['notes/a.txt', 'b.txt']);
    expect(adapter.sends).toBe(1);
  });
});
