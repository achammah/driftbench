import { defaultChecks } from '@agent-nexus/driftbench-checks';
import type { AgentAdapter } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { blockStatus, runSpec } from '../../src/runner';
import { echoAdapter, specOf } from './support';

// Fictional data only.
const block = (id: string, parent?: string) => ({
  id,
  ...(parent === undefined ? {} : { parent }),
  when: { user: `Message ${id}` },
});

/** An echo agent that notes the order in which the blocks reach it. */
function recorder(): AgentAdapter & { sent: string[] } {
  const inner = echoAdapter();
  const sent: string[] = [];
  return {
    ...inner,
    sent,
    async send(session, turn) {
      sent.push('user' in turn.stimulus ? turn.stimulus.user : '?');
      return inner.send(session, turn);
    },
  };
}

async function play(blocks: ReturnType<typeof block>[]) {
  const spec = specOf({ id: 'forest', target: { adapter: 'echo', agent: 'acme' }, blocks });
  const adapter = recorder();
  const run = await runSpec(spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    mode: 'F',
    repeat: 0,
  });
  return { adapter, run };
}

describe('the runner runs a spec with parent links as a forest', () => {
  it('sends each child after its parent, whatever the order the blocks are written in', async () => {
    const { adapter, run } = await play([
      block('grandchild', 'child'),
      block('other'),
      block('child', 'root'),
      block('root'),
    ]);
    expect(run.status).toBe('completed');
    expect(adapter.sent).toEqual(['Message root', 'Message child', 'Message grandchild', 'Message other']);
    expect(run.blocks.map((entry) => entry.blockId)).toEqual(['root', 'child', 'grandchild', 'other']);
    expect(run.blocks.map(blockStatus)).toEqual(['pass', 'pass', 'pass', 'pass']);
  });

  it('runs a chain written in order exactly as before', async () => {
    const { adapter, run } = await play([block('a'), block('b', 'a'), block('c', 'b')]);
    expect(adapter.sent).toEqual(['Message a', 'Message b', 'Message c']);
    expect(run.blocks.map((entry) => entry.blockId)).toEqual(['a', 'b', 'c']);
  });
});
