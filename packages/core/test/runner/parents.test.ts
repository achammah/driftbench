import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createPerturbingDriver, createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runAcmeParents } from '../../../../examples/acme/parents/run';
import { runSpec } from '../../src/runner/run';
import { blockStatus } from '../../src/runner/verdicts';
import type { ResolvedGiven } from '../../src/schema/run';
import { validateSpec } from '../../src/spec/load';
import { parentOrder } from '../../src/spec/parents';
import { specOf } from './support';

const driver = createScriptedDriver();
const checks = defaultChecks();
function fake() {
  const starts: ResolvedGiven[] = [];
  const calls: string[] = [];
  const adapter = functionAdapter({
    create(given) {
      starts.push(given);
    },
    respond(messages) {
      const user = messages.at(-1)?.content ?? '';
      calls.push(user);
      return {
        segments: [],
        text: user,
        toolCalls:
          user === 'open' ? [{ id: 'lookup-1', label: 'lookup', input: {}, output: { ref: 'ACME-1' } }] : [],
        cost: {},
        latencyMs: 0,
      };
    },
  });
  return { adapter, starts, calls };
}
const blocks = [
  { id: 'child', parent: 'root', when: { user: 'child' } },
  {
    id: 'root',
    when: { user: 'open' },
    given: { ledger: { customer: 'Acme' }, vars: { channel: 'web' }, world: { store: { account: 7 } } },
    expect: { ledger_add: { ref: 'ACME-1' } },
  },
  { id: 'sibling', parent: 'root', when: { user: 'sibling' } },
  { id: 'independent', when: { user: 'hours' } },
];

describe('parent blocks', () => {
  it('runs the worked Acme YAML end to end with a free fake adapter', async () => {
    const good = await runAcmeParents();
    expect(good.run.blocks.map(blockStatus)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(good.calls.filter((call) => call === 'Show Acme plans.')).toHaveLength(1);
    const bad = await runAcmeParents(true);
    expect(bad.run.blocks.map(blockStatus)).toEqual(['pass', 'fail', 'blocked', 'blocked', 'pass', 'pass']);
    expect(bad.run.succession.driftCount).toBe(1);
    expect(bad.calls).not.toContain('CONFIRM');
  });
  it('orders forward references stably, keeping authored indices', () => {
    expect(parentOrder(specOf({ id: 'order', blocks })).order).toEqual([1, 0, 2, 3]);
  });
  it.each([
    ['PARENT_MISSING', [{ id: 'a', parent: 'missing', user: 'a' }]],
    [
      'PARENT_CYCLE',
      [
        { id: 'a', parent: 'b', user: 'a' },
        { id: 'b', parent: 'a', user: 'b' },
      ],
    ],
    ['PARENT_CYCLE', [{ id: 'a', parent: 'a', user: 'a' }]],
  ])('refuses %s as a spec error', (code, blocks) => {
    const result = validateSpec({ id: 'bad-parent', blocks });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((issue) => issue.code === code)).toBe(true);
  });
  it.each([
    [
      'given.world',
      { given: { world: { workspace: { files: { 'a.csv': 'x' }, binary: { 'a.csv': 'eA==' } } } } },
    ],
    [
      'blocks.0.given.world',
      {
        blocks: [
          {
            user: 'a',
            given: { world: { workspace: { files: { 'a.csv': 'x' }, binary: { 'a.csv': 'eA==' } } } },
          },
        ],
      },
    ],
    [
      'perturbations.0.world',
      {
        perturbations: [
          {
            id: 'p',
            class: 'D8_tool_failure',
            inject_at: 0,
            world: { workspace: { files: { 'a.csv': 'x' }, binary: { 'a.csv': 'eA==' } } },
          },
        ],
      },
    ],
  ])('refuses a workspace path in both files and binary at %s', (at, part) => {
    const result = validateSpec({ id: 'twice', blocks: [{ user: 'a' }], ...part });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.find((issue) => issue.code === 'WORKSPACE_PATH_TWICE')?.path).toBe(
        `${at}.workspace.binary.a.csv`,
      );
    const apart = validateSpec({
      id: 'apart',
      blocks: [
        {
          user: 'a',
          given: { world: { workspace: { files: { 'a.csv': 'x' }, binary: { 'b.png': 'eA==' } } } },
        },
      ],
    });
    expect(apart.ok ? [] : apart.errors).toEqual([]);
  });
  it.each(['F', 'T', 'P'] as const)(
    '%s inherits recorded history, calls, world, facts and variables without repeating the parent',
    async (mode) => {
      const spec = specOf({ id: 'inherit', blocks });
      const fakeRun = fake();
      const result = await runSpec(spec, {
        ...fakeRun,
        driver,
        checks,
        mode,
        repeat: 0,
        recordProvenance: true,
      });
      expect(result.status).toBe('completed');
      expect(result.blocks.map((block) => block.blockId)).toEqual([
        'root',
        'child',
        'sibling',
        'independent',
      ]);
      expect(result.blocks.map((block) => block.specIndex)).toEqual([1, 0, 2, 3]);
      expect(fakeRun.calls).toEqual(['open', 'child', 'sibling', 'hours']);
      const child = fakeRun.starts[1];
      expect(child?.prefix).toHaveLength(2);
      expect(child?.prefix[1]?.tool_calls?.[0]).toMatchObject({ id: 'lookup-1', output: { ref: 'ACME-1' } });
      expect(child).toMatchObject({
        ledger: { customer: 'Acme', ref: 'ACME-1' },
        world: { store: { account: 7 } },
        vars: { channel: 'web' },
      });
      expect(fakeRun.starts[2]).toEqual(child);
      expect(fakeRun.starts[3]?.prefix).toEqual([]);
      expect(fakeRun.starts[3]?.ledger).toEqual({});
    },
  );
  it('applies child Given overrides without changing its parent or siblings', async () => {
    const spec = specOf({
      id: 'override',
      blocks: blocks.map((block) =>
        block.id === 'child'
          ? {
              ...block,
              given: {
                prefix: [{ role: 'user', content: 'replacement' }],
                ledger: { customer: 'Other' },
                vars: { channel: 'phone' },
                world: { store: { account: 9 } },
              },
            }
          : block,
      ),
    });
    const fakeRun = fake();
    await runSpec(spec, { ...fakeRun, driver, checks, mode: 'T', repeat: 0 });
    expect(fakeRun.starts[1]).toMatchObject({
      prefix: [{ content: 'replacement' }],
      ledger: { customer: 'Other', ref: 'ACME-1' },
      vars: { channel: 'phone' },
      world: { store: { account: 9 } },
    });
    expect(fakeRun.starts[2]).toMatchObject({
      ledger: { customer: 'Acme' },
      vars: { channel: 'web' },
      world: { store: { account: 7 } },
    });
  });
  it.each(['F', 'T'] as const)(
    '%s blocks descendants of a failed parent and keeps independent roots running',
    async (mode) => {
      const spec = specOf({
        id: 'fail',
        blocks: [
          { id: 'root', user: 'open', expect: { must: ['missing'] } },
          { id: 'child', parent: 'root', user: 'child' },
          { id: 'leaf', parent: 'child', user: 'leaf' },
          { id: 'independent', user: 'hours' },
        ],
      });
      const fakeRun = fake();
      const result = await runSpec(spec, { ...fakeRun, driver, checks, mode, repeat: 0 });
      expect(result.blocks.map(blockStatus)).toEqual(['fail', 'blocked', 'blocked', 'pass']);
      expect(result.blocks[2]?.blocked).toMatchObject({ by: 'child', root: 'root' });
      expect(result.succession.driftCount).toBe(1);
      expect(fakeRun.calls).toEqual(['open', 'hours']);
    },
  );
  it('blocks descendants of a not_run parent, without blocking an independent root', async () => {
    const spec = specOf({
      id: 'unrun',
      blocks: [
        { id: 'root', user: 'open', given: { world: { tools: { lookup: { result: {} } } } } },
        { id: 'child', parent: 'root', user: 'child' },
        { id: 'independent', user: 'hours' },
      ],
    });
    const fakeRun = fake();
    const adapter = {
      ...fakeRun.adapter,
      capabilities: () => ({ ...fakeRun.adapter.capabilities(), toolStubs: false }),
    };
    const result = await runSpec(spec, { adapter, driver, checks, mode: 'F', repeat: 0 });
    expect(result.blocks.map(blockStatus)).toEqual(['not_run', 'blocked', 'pass']);
    expect(fakeRun.calls).toEqual(['hours']);
  });
  it('replays missing ancestors when selecting only a child, and scores the child alone', async () => {
    const fakeRun = fake();
    const result = await runSpec(specOf({ id: 'subset', blocks }), {
      ...fakeRun,
      driver,
      checks,
      mode: 'T',
      repeat: 0,
      blocks: new Set([0]),
    });
    // The root runs for its end state but is no measurement of this run: only the child is scored.
    expect(fakeRun.calls).toEqual(['open', 'child']);
    expect(result.blocks.map((block) => block.blockId)).toEqual(['child']);
    expect(result.blockRerun).toMatchObject({
      selected: [0],
      reason: 'parent blocks replayed for their end state, not measured: root',
    });
    expect(fakeRun.starts[1]?.prefix).toHaveLength(2);
  });
  it('inherits exported mutable world and variables, and isolates each sibling', async () => {
    const starts: ResolvedGiven[] = [];
    const adapter = functionAdapter({
      create(given) {
        starts.push(given);
        return { account: Number(given.world.store?.account ?? 0), clock: Number(given.vars.clock ?? 0) };
      },
      respond(_messages, _world, _vars, state) {
        state.account++;
        state.clock++;
        return { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 };
      },
      snapshotGiven(state) {
        return { world: { store: { account: state.account } }, vars: { clock: state.clock } };
      },
    });
    const spec = specOf({
      id: 'mutable',
      blocks: [
        { id: 'root', user: 'open' },
        { id: 'left', parent: 'root', user: 'left' },
        { id: 'right', parent: 'root', user: 'right', given: { vars: { clock: 10 } } },
        { id: 'leaf', parent: 'left', user: 'leaf' },
      ],
    });
    await runSpec(spec, { adapter, driver, checks, mode: 'T', repeat: 0 });
    expect(starts.map((given) => given.world.store?.account)).toEqual([undefined, 1, 1, 2]);
    expect(starts.map((given) => given.vars.clock)).toEqual([undefined, 1, 10, 2]);
  });
  it('keeps a message perturbation on its branch and inherits it in descendants', async () => {
    const spec = specOf({
      id: 'perturbed-tree',
      blocks: [
        { id: 'root', user: 'open' },
        { id: 'child', parent: 'root', user: 'child' },
        { id: 'leaf', parent: 'child', user: 'leaf' },
        { id: 'sibling', parent: 'root', user: 'sibling' },
      ],
      perturbations: [{ id: 'aside', class: 'D1_off_topic', inject_at: 1, user: 'aside' }],
    });
    const driver = createPerturbingDriver({ spec, perturbation: 'aside' });
    const fakeRun = fake();
    const result = await runSpec(driver.spec, {
      ...fakeRun,
      driver,
      checks,
      mode: 'P',
      repeat: 0,
      perturbationId: 'aside',
    });
    expect(result.status).toBe('completed');
    expect(fakeRun.calls).toEqual(['open', 'aside', 'child', 'leaf', 'sibling']);
    expect(fakeRun.starts[2]?.prefix.map((message) => message.content)).toContain('aside');
    expect(fakeRun.starts[3]?.prefix.map((message) => message.content)).toContain('aside');
    expect(fakeRun.starts[4]?.prefix.map((message) => message.content)).not.toContain('aside');
  });
  it('a world-only perturbation replaces the scheduled block and records its end for children', async () => {
    const spec = specOf({
      id: 'perturbed-world',
      blocks: [
        { id: 'root', user: 'open' },
        { id: 'child', parent: 'root', user: 'child' },
        { id: 'leaf', parent: 'child', user: 'leaf' },
      ],
      perturbations: [
        { id: 'world', class: 'D8_tool_failure', inject_at: 1, world: { store: { changed: true } } },
      ],
    });
    const driver = createPerturbingDriver({ spec, perturbation: 'world' });
    const fakeRun = fake();
    const result = await runSpec(driver.spec, {
      ...fakeRun,
      driver,
      checks,
      mode: 'P',
      repeat: 0,
      perturbationId: 'world',
    });
    expect(result.status).toBe('completed');
    expect(fakeRun.calls).toEqual(['open', 'child', 'leaf']);
    expect(fakeRun.starts[2]?.world.store).toEqual({ changed: true });
    expect(result.blocks.map((block) => block.specIndex)).toEqual([0, 1, 2]);
  });
  it('blocks children after an agent failure and still runs another root', async () => {
    const adapter = functionAdapter({
      respond(history) {
        if (history.at(-1)?.content === 'fail') throw new Error('agent stopped');
        return { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 };
      },
    });
    const spec = specOf({
      id: 'agent-failure',
      blocks: [
        { id: 'root', user: 'fail' },
        { id: 'child', parent: 'root', user: 'child' },
        { id: 'other', user: 'other' },
      ],
    });
    const run = await runSpec(spec, { adapter, driver, checks, mode: 'F', repeat: 0 });
    expect(run.status).toBe('failed');
    expect(run.blocks.map(blockStatus)).toEqual(['fail', 'blocked', 'pass']);
  });
});
