import { type Check, machineVerdict, RunResult, validateSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { blockStatus, canonicalGiven, runOutcome, runSpec } from '../../src/runner';
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

  it('accepts a parent listed after its child', () => {
    expect(
      issues([
        { id: 'a', parent: 'b', user: 'hi' },
        { id: 'b', user: 'hi' },
      ]),
    ).toEqual([]);
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

/** A check that fails a block whose stimulus says BAD. */
const badWords: Check = {
  name: 'bad',
  applies: () => true,
  evaluate: (ctx) => [
    machineVerdict(
      'bad',
      'words',
      JSON.stringify(ctx.stimulus).includes('BAD') ? 'fail' : 'pass',
      'the stimulus says BAD or not',
    ),
  ],
};

describe('a block whose parent did not pass', () => {
  const tree = specOf({
    id: 'bike-chain',
    blocks: [
      { id: 'a', user: 'BAD start' },
      { id: 'a1', parent: 'a', user: 'next' },
      { id: 'a2', parent: 'a1', user: 'after' },
      { id: 'b', user: 'Do you rent bikes?' },
      { id: 'b1', parent: 'b', user: 'For two days?' },
    ],
  });

  for (const mode of ['F', 'T'] as const) {
    it(`is blocked by its own parent, rooted at the first failure, and never sent (mode ${mode})`, async () => {
      const adapter = acmeAdapter();
      const run = await runSpec(tree, { adapter, driver, checks: [badWords], mode, repeat: 0 });
      expect(RunResult.safeParse(run).success).toBe(true);
      expect(run.blocks.map(blockStatus)).toEqual(['fail', 'blocked', 'blocked', 'pass', 'pass']);
      expect(run.blocks[1]?.blocked).toMatchObject({ by: 'a', root: 'a' });
      expect(run.blocks[2]?.blocked).toMatchObject({ by: 'a1', root: 'a' });
      // Only the three blocks that ran were sent: the other tree ran and passed.
      expect(adapter.calls.send).toBe(3);
      expect(runOutcome(run)).toBe('fail');
    });
  }

  it('blocks the children of a block that was not run, rooted at that block, and runs the other tree', async () => {
    const stubbed = specOf({
      id: 'bike-stub',
      blocks: [
        { id: 'a', user: 'start', given: { world: { tools: { lookup: { result: 1 } } } } },
        { id: 'a1', parent: 'a', user: 'next' },
        { id: 'b', user: 'Do you rent bikes?', given: { world: { tools: {} } } },
      ],
    });
    const adapter = acmeAdapter({ capabilities: { toolStubs: false } });
    const run = await runSpec(stubbed, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.blocks.map(blockStatus)).toEqual(['not_run', 'blocked', 'pass']);
    expect(run.blocks[1]?.blocked).toMatchObject({ by: 'a', root: 'a' });
    expect(runOutcome(run)).toBe('not_run');
  });

  it('is not run, whatever its parent did, when the adapter cannot seed its ancestors', async () => {
    const adapter = acmeAdapter({ capabilities: { seedPrefix: false } });
    const run = await runSpec(forest, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.blocks.map(blockStatus)).toEqual(['pass', 'not_run', 'not_run', 'pass', 'not_run']);
    expect(run.blocks[1]?.notRun).toMatchObject({ kind: 'unsupported', check: 'capability' });
    expect(adapter.calls.send).toBe(2);
  });
});

describe('a parent listed after its child', () => {
  it('runs first, so the child starts from it', async () => {
    const late = specOf({
      id: 'late-parent',
      blocks: [
        { id: 'child', parent: 'root', user: 'second' },
        { id: 'root', user: 'first' },
      ],
    });
    const adapter = acmeAdapter();
    const sent: string[] = [];
    const send = adapter.send.bind(adapter);
    adapter.send = (session, turn) => {
      sent.push(JSON.stringify(turn.stimulus));
      return send(session, turn);
    };
    const run = await runSpec(late, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(sent).toEqual(['{"user":"first"}', '{"user":"second"}']);
    expect(run.blocks.map((block) => block.blockId)).toEqual(['root', 'child']);
  });
});
