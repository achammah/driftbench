// A re-judge builds each block's judge context from the block order: the history is the blocks before it. A child
// of a parent-linked run was measured with the history of its ancestors only, so a judge would see the blocks of
// unrelated trees. A parent-linked spec is therefore refused at both doors, with the cell run fresh.
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import type { Check } from '../../src/contracts/check';
import { prepareRejudge, rejudgeRun } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, specOf } from '../runner/support';

// Fictional data only. A root, an unrelated block, and a child of the root: its history is the root alone.
const tree = specOf({
  id: 'rejudge-parents',
  criteria: [{ name: 'quality', rubric: 'The reply is useful.', gating: true }],
  blocks: [
    { id: 'root', given: { prefix: [] }, when: { user: 'open' }, expect: { must: ['ok'] } },
    { id: 'other', given: { prefix: [] }, when: { user: 'unrelated' }, expect: { must: ['ok'] } },
    {
      id: 'child',
      parent: 'root',
      given: { prefix: [] },
      when: { user: 'more' },
      expect: { must: ['ok'], criteria: ['quality'] },
    },
  ],
});
const flat = specOf({
  ...tree,
  blocks: tree.blocks.map(({ parent: _parent, ...block }) => block),
});
const changed = (spec: typeof tree) => ({
  ...spec,
  criteria: [{ name: 'quality', rubric: 'The reply is useful and short.', gating: true }],
});
const target = { adapter: 'echo', variant: 'v1' };
const options = {
  baselineProvenance: {
    version: 2 as const,
    adapters: [
      {
        ...adapterProvenance(echoAdapter(), target.adapter),
        targetHash: provenanceHash(target),
        agentVersionHash: provenanceHash('v1'),
      },
    ],
  },
  fromCampaign: 'base',
  agentVersion: 'v1',
  criteria: ['quality'],
  now: new Date('2026-10-13T01:00:00Z'),
};
const record = (spec: typeof tree) =>
  runSpec(spec, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [],
    mode: 'T',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => new Date('2026-10-13T00:00:00Z'),
  });
const judge = (seen: number[]): Check => ({
  name: 'judge',
  applies: () => true,
  evaluate: (ctx) => {
    seen.push(ctx.blockIndex);
    return [
      { id: 'judge.quality', kind: 'judge', name: 'quality', gating: true, outcome: 'pass', evidence: 'ok' },
    ];
  },
});

it('refuses to prepare the re-judge of a parent-linked spec', async () => {
  const source = await record(tree);
  expect(source.blocks.map((block) => block.blockId)).toEqual(['root', 'other', 'child']);
  expect(() => prepareRejudge(tree, changed(tree), source, options)).toThrow(
    /A parent-linked run takes each child's history from its ancestors/,
  );
});

it('refuses, at the re-judge itself, a parent-linked spec that reached it through another door', async () => {
  // The same recorded blocks without links prepare fine; the prepared value then carries the linked spec.
  const source = await record(flat);
  const prepared = prepareRejudge(flat, changed(flat), source, options);
  const seen: number[] = [];
  await expect(
    rejudgeRun({ ...prepared, spec: changed(tree) } as typeof prepared, judge(seen), () => 0),
  ).rejects.toThrow(/A parent-linked run takes each child's history from its ancestors/);
  expect(seen).toEqual([]);
});

it('still re-judges the same blocks when the spec links none', async () => {
  const source = await record(flat);
  const prepared = prepareRejudge(flat, changed(flat), source, options);
  const seen: number[] = [];
  const result = await rejudgeRun(prepared, judge(seen), () => 0);
  expect(seen).toEqual([2]);
  expect(result.blocks).toHaveLength(3);
});
