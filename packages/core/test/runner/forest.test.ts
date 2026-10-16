import { RunResult, validateSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { canonicalGiven, runSpec } from '../../src/runner';
import { acmeAdapter, specOf } from './support';

const driver = createScriptedDriver();

// Fictional data only: a bike shop whose blocks form two trees.
const forest = specOf({
  id: 'bike-forest',
  blocks: [
    { id: 'a', user: 'Which bike for the city?' },
    { id: 'a1', parent: 'a', user: 'And in blue?' },
    { id: 'a2', parent: 'a', user: 'And with a basket?' },
    { id: 'b', user: 'Do you rent bikes?' },
    { id: 'b1', parent: 'b', user: 'For two days?' },
  ],
});

/** The user messages each sent block started from, by block: what the agent could read of the earlier blocks. */
async function seen(mode: 'F' | 'T'): Promise<string[][]> {
  const adapter = acmeAdapter();
  const prefixes: string[][] = [];
  const send = adapter.send.bind(adapter);
  adapter.send = (session, turn) => {
    prefixes.push(turn.given.prefix.filter((m) => m.role === 'user').map((m) => m.content));
    return send(session, turn);
  };
  const run = await runSpec(forest, { adapter, driver, checks: [], mode, repeat: 0 });
  expect(RunResult.safeParse(run).success).toBe(true);
  expect(run.blocks).toHaveLength(forest.blocks.length);
  return prefixes;
}

describe('parent links', () => {
  it('start every block from its ancestors only, free-running', async () => {
    expect(await seen('F')).toEqual([
      [],
      ['Which bike for the city?'],
      ['Which bike for the city?'],
      [],
      ['Do you rent bikes?'],
    ]);
  });

  it('start every block from its ancestors only, teacher-forced', async () => {
    expect(await seen('T')).toEqual([
      [],
      ['Which bike for the city?'],
      ['Which bike for the city?'],
      [],
      ['Do you rent bikes?'],
    ]);
    expect(canonicalGiven(forest, 4).prefix.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('keep a spec without parents one conversation', async () => {
    const plain = specOf({ id: 'plain', blocks: [{ user: 'one' }, { user: 'two' }, { user: 'three' }] });
    expect(canonicalGiven(plain, 2).prefix.filter((m) => m.role === 'user')).toHaveLength(2);
  });
});

describe('the loader and parent links', () => {
  const issues = (blocks: unknown[]) => {
    const loaded = validateSpec({ id: 'x', blocks });
    return loaded.ok ? [] : loaded.errors.map((issue) => `${issue.code} ${issue.path}`);
  };

  it('refuses a parent that is the id of no block', () => {
    expect(
      issues([
        { id: 'a', user: 'hi' },
        { parent: 'zz', user: 'hi' },
      ]),
    ).toEqual(['PARENT_MISSING blocks.1.parent']);
  });

  it('refuses a parent that leads back to its child', () => {
    expect(
      issues([
        { id: 'a', parent: 'b', user: 'hi' },
        { id: 'b', parent: 'a', user: 'hi' },
      ]),
    ).toEqual(expect.arrayContaining(['PARENT_CYCLE blocks.0.parent', 'PARENT_CYCLE blocks.1.parent']));
  });

  it('refuses a parent listed after its child', () => {
    expect(
      issues([
        { id: 'a', parent: 'b', user: 'hi' },
        { id: 'b', user: 'hi' },
      ]),
    ).toEqual(['PARENT_ORDER blocks.0.parent']);
  });

  it('accepts a forest', () => {
    expect(
      issues([
        { id: 'a', user: 'hi' },
        { id: 'a1', parent: 'a', user: 'hi' },
        { id: 'b', user: 'hi' },
        { parent: 'b', user: 'hi' },
      ]),
    ).toEqual([]);
  });
});
