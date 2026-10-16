import type { AgentAdapter, RunEvent } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { acmeAdapter, specOf } from './support';

/**
 * Blast-radius audit of the Given verifier (PR 436) against the not_run verdict of PR 428: which check names a
 * block that both fails the static verifier and needs a capability the adapter lacks, and how a block that
 * failed the setup check reports its events.
 */
const driver = createScriptedDriver();

/** One block whose prefix holds a tool call with no result: a Given error, and a history (seedPrefix). */
const unpaired = specOf({
  id: 'unpaired-and-unseedable',
  blocks: [
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
  ],
});

describe('blast radius: the Given verifier beside the capability check', () => {
  it('a block with a Given error on an adapter without seedPrefix is not_run given_unmet: the spec is named first', async () => {
    for (const mode of ['T', 'F'] as const) {
      const adapter = acmeAdapter({ capabilities: { seedPrefix: false } });
      const run = await runSpec(unpaired, { adapter, driver, checks: [], mode, repeat: 0 });
      expect(run.blocks[0]?.status, mode).toBe('not_run');
      expect(run.blocks[0]?.notRun, mode).toMatchObject({
        kind: 'given_unmet',
        check: 'tool_history_paired',
      });
      expect(adapter.calls.send, mode).toBe(0);
    }
  });

  it('a block whose setup check fails reports one block_start and one block_end not_run', async () => {
    const events: RunEvent[] = [];
    const adapter: AgentAdapter = {
      id: 'sandboxed',
      version: '1',
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
        return {
          segments: [{ type: 'text', text: 'done' }],
          text: 'done',
          toolCalls: [],
          cost: {},
          latencyMs: 0,
        };
      },
      async readArtifact() {
        return new TextEncoder().encode('changed');
      },
      async close() {},
    };
    const spec = specOf({
      id: 'seeded-two',
      kind: 'task',
      given: { world: { workspace: { files: { 'a.txt': 'hello' } } } },
      blocks: [{ user: 'One.' }, { user: 'Two.' }],
    });
    const run = await runSpec(spec, {
      adapter,
      driver,
      checks: [],
      mode: 'F',
      repeat: 0,
      onEvent: (event) => events.push(event),
    });
    expect(run.blocks.map((block) => [block.status, block.notRun?.kind])).toEqual([
      ['not_run', 'setup_failed'],
      ['not_run', 'setup_failed'],
    ]);
    const forBlock0 = events.filter((event) => 'index' in event && event.index === 0);
    expect(forBlock0.filter((event) => event.type === 'block_start')).toHaveLength(1);
    expect(forBlock0.filter((event) => event.type === 'block_end')).toEqual([
      expect.objectContaining({ type: 'block_end', pass: false, status: 'not_run' }),
    ]);
  });
});
