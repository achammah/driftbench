import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { echoAdapter, specOf } from './support';

const driver = createScriptedDriver();
const block = (id: string, user: string, parent?: string) => ({
  id,
  ...(parent === undefined ? {} : { parent }),
  when: { user },
});

/** The user turns of a history, as the adapter received them. */
const usersOf = (prefix: unknown[]) =>
  (prefix as Array<{ role: string; content: string }>).filter((m) => m.role === 'user').map((m) => m.content);

describe('a spec with parent links runs as a forest', () => {
  it('runs a parent before its child whatever the written order, each child from its ancestors only', async () => {
    const spec = specOf({
      id: 'forest',
      blocks: [
        block('grandchild', 'three', 'child'),
        block('other-root', 'other'),
        block('child', 'two', 'root'),
        block('root', 'one'),
      ],
    });
    const adapter = echoAdapter();
    const run = await runSpec(spec, { adapter, driver, checks: defaultChecks(), mode: 'F', repeat: 0 });
    expect(run.blocks.map((b) => b.blockId)).toEqual(['root', 'child', 'grandchild', 'other-root']);
    expect(run.blocks.map((b) => b.specIndex)).toEqual([3, 2, 0, 1]);
    // One session per block; each opens with the turns of its ancestors, oldest first, and no other block's.
    expect(adapter.opened.map((o) => usersOf(o.prefix))).toEqual([[], ['one'], ['one', 'two'], []]);
  });

  it('a spec without parent links keeps the written order and one conversation', async () => {
    const spec = specOf({ id: 'flat', blocks: [block('a', 'one'), block('b', 'two')] });
    const adapter = echoAdapter();
    const run = await runSpec(spec, { adapter, driver, checks: defaultChecks(), mode: 'F', repeat: 0 });
    expect(run.blocks.map((b) => b.blockId)).toEqual(['a', 'b']);
    expect(run.blocks.every((b) => b.specIndex === undefined)).toBe(true);
  });

  it('blocks the descendants of a failed parent, rooted at it, and runs the other trees on', async () => {
    const spec = specOf({
      id: 'blocked',
      blocks: [
        { ...block('root', 'one'), expect: { must: ['never said'] } },
        block('child', 'two', 'root'),
        block('grandchild', 'three', 'child'),
        block('other', 'four'),
      ],
    });
    const adapter = echoAdapter();
    const run = await runSpec(spec, { adapter, driver, checks: defaultChecks(), mode: 'F', repeat: 0 });
    expect(run.blocks.map((b) => [b.blockId, b.status ?? (b.pass ? 'pass' : 'fail')])).toEqual([
      ['root', 'fail'],
      ['child', 'blocked'],
      ['grandchild', 'blocked'],
      ['other', 'pass'],
    ]);
    expect(run.blocks[1]?.blocked).toMatchObject({ by: 'root', root: 'root' });
    expect(run.blocks[2]?.blocked).toMatchObject({ by: 'child', root: 'root' });
    // A blocked block is never sent and adds no failure.
    expect(adapter.opened).toHaveLength(2);
    expect(run.succession.driftCount).toBe(1);
  });
});
