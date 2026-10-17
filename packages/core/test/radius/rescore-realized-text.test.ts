// A re-score copies the stored observations into a new run, so it obeys the destination's text policy as a
// re-judge does: the realized text of a block is copied only on an explicit opt-in, and its hash always.
import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { shippedObjectContext } from '../../src/objects';
import { prepareRejudge, prepareRescore, rescoreRun } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceDigest, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { specHash, specIdentity } from '../../src/spec/identity';
import { echoAdapter, mustCheck, specOf } from '../runner/support';

initializeShippedObjects();
// Fictional data only.
const spec = specOf({
  id: 'rescore-realized-text',
  blocks: [
    { user: 'one', expect: { must: ['ok'] } },
    { user: 'two', expect: { must: ['ok'] } },
  ],
});
const target = { adapter: 'echo', variant: 'v1' };

async function prepared(withText: boolean) {
  const source = await runSpec(spec, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [mustCheck],
    mode: 'T',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => new Date('2026-10-15T00:00:00Z'),
  });
  if (withText) {
    for (const block of source.blocks) block.realized = { hash: provenanceHash('private'), text: 'private' };
    source.provenanceDigest = provenanceDigest(source);
  }
  return prepareRescore(spec, spec, source, {
    fromCampaign: 'base',
    agentVersion: 'v1',
    now: new Date('2026-10-15T01:00:00Z'),
    baselineProvenance: {
      version: 2,
      adapters: [
        {
          ...adapterProvenance(echoAdapter(), target.adapter),
          targetHash: provenanceHash(target),
          agentVersionHash: provenanceHash('v1'),
        },
      ],
    },
  });
}

it.each([false, true])('a re-score obeys the destination text policy (%s)', async (record) => {
  const input = await prepared(true);
  const result = await rescoreRun(input, [mustCheck], shippedObjectContext(), record);
  for (const block of result.blocks)
    expect(block.realized).toEqual({
      hash: provenanceHash('private'),
      ...(record ? { text: 'private' } : {}),
    });
  expect(result.provenanceDigest).toBe(provenanceDigest(result));
  if (record) expect(result.realizedTextStripped).toBeUndefined();
  else expect(result.realizedTextStripped).toEqual({ fromRun: input.source.runId, fromCampaign: 'base' });
  // The stored run keeps its text: the copy is stripped, never the source.
  expect(input.source.blocks.every((block) => block.realized?.text === 'private')).toBe(true);
});

it('records the spec hash of the identity, as a re-judge does, so a link or a provenance key never moves it', async () => {
  const input = await prepared(false);
  const withLinks = { ...input.spec, metadata: { links: [{ kind: 'spec_clause', clause_id: 'REF-04' }] } };
  const result = await rescoreRun(
    { ...input, spec: withLinks as never },
    [mustCheck],
    shippedObjectContext(),
  );
  expect(result.specHash).toBe(specHash(withLinks as never));
  expect(specIdentity(withLinks as never)).not.toHaveProperty('metadata');
  expect(result.specHash).toBe(specHash(input.spec));
});

it('refuses to prepare the re-score of a parent-linked run, so the cell runs fresh', async () => {
  const input = await prepared(false);
  const linked = {
    ...spec,
    blocks: spec.blocks.map((block, index) =>
      index === 1 ? { ...block, id: 'child', parent: 'root' } : { ...block, id: 'root' },
    ),
  };
  expect(() =>
    prepareRescore(linked as never, linked as never, input.source, {
      fromCampaign: 'base',
      agentVersion: 'v1',
      now: new Date('2026-10-15T01:00:00Z'),
      baselineProvenance: { version: 2, adapters: [] },
    }),
  ).toThrow(/A parent-linked run takes each child's history from its ancestors/);
});

it('refuses, at the re-score itself, a parent-linked spec that reached it through prepareRejudge', async () => {
  // Three blocks, an unrelated one between a root and its child: the child's history is the root alone. Each block
  // writes an explicit empty prefix, so the recorded tree reconstructs and reaches scoring through the public door.
  const tree = specOf({
    id: 'rescore-parent-sink',
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
  const source = await runSpec(tree, {
    adapter: echoAdapter(),
    driver: createScriptedDriver(),
    checks: [mustCheck],
    mode: 'T',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => new Date('2026-10-15T00:00:00Z'),
  });
  expect(source.blocks.map((block) => block.blockId)).toEqual(['root', 'other', 'child']);
  // Only the rubric of the criterion changes: the one change a re-judge exists for.
  const changed = {
    ...tree,
    criteria: [{ name: 'quality', rubric: 'The reply is useful and short.', gating: true }],
  };
  // The public re-judge door accepts the tree; nothing about it is invalid.
  const input = prepareRejudge(tree, changed as never, source, {
    fromCampaign: 'base',
    agentVersion: 'v1',
    criteria: ['quality'],
    now: new Date('2026-10-15T01:00:00Z'),
    baselineProvenance: {
      version: 2,
      adapters: [
        {
          ...adapterProvenance(echoAdapter(), target.adapter),
          targetHash: provenanceHash(target),
          agentVersionHash: provenanceHash('v1'),
        },
      ],
    },
  });
  let evaluated = 0;
  await expect(
    rescoreRun(
      input,
      [
        {
          ...mustCheck,
          evaluate: (ctx) => {
            evaluated += 1;
            return mustCheck.evaluate(ctx);
          },
        },
      ],
      shippedObjectContext(),
    ),
  ).rejects.toThrow(/A parent-linked run takes each child's history from its ancestors/);
  expect(evaluated).toBe(0);
});
