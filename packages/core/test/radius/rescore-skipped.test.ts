import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import type { Check } from '../../src/contracts/check';
import { objectContextOfSpec } from '../../src/objects/context';
import { type ObjectContext, resolveBlockObjects } from '../../src/objects/layers';
import { ObjectStore, objectRegistry } from '../../src/objects/resolve';
import { prepareRescore, rescoreRun } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, mustCheck, specOf } from '../runner/support';

initializeShippedObjects();
const spec = specOf({
  id: 'rescore-skipped',
  blocks: [
    { user: 'one', expect: { must: ['ok'] } },
    { user: 'two', expect: { must: ['ok'] } },
  ],
});
const target = { adapter: 'echo', variant: 'v1' };
async function prepared() {
  const adapter = echoAdapter();
  const source = await runSpec(spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: [mustCheck],
    mode: 'T',
    repeat: 0,
    target,
    recordProvenance: true,
    now: () => new Date('2026-10-15T00:00:00Z'),
  });
  return prepareRescore(spec, spec, source, {
    fromCampaign: 'base',
    agentVersion: 'v1',
    now: new Date('2026-10-15T01:00:00Z'),
    baselineProvenance: {
      version: 2,
      adapters: [
        {
          ...adapterProvenance(adapter),
          targetHash: provenanceHash(target),
          agentVersionHash: provenanceHash('v1'),
        },
      ],
    },
  });
}
function context(): ObjectContext {
  const store = new ObjectStore(objectRegistry);
  store.add(
    {
      kind: 'policy/value-check',
      id: 'strict',
      extends: 'default',
      items: [{ id: 'rung1_outcome', enabled: false }],
    },
    'project',
    { path: 'strict.yaml' },
  );
  return {
    store,
    uses: [],
    problems: [],
    cli: { use: new Map([['policy/value-check', 'strict']]), set: [] },
  };
}

it.each(['not_run', 'blocked'] as const)(
  'preserves a %s block exactly without evaluating checks',
  async (status) => {
    const input = await prepared();
    const first = input.source.blocks[0];
    if (!first) throw new Error('missing block');
    const skipped = Object.assign(first, { status });
    const evaluated: number[] = [];
    const check: Check = {
      ...mustCheck,
      evaluate: (ctx) => {
        evaluated.push(ctx.blockIndex);
        return mustCheck.evaluate(ctx);
      },
    };
    const result = await rescoreRun(input, [check], context());
    expect(evaluated).toEqual([1]);
    expect(result.blocks[0]).toBe(skipped);
    expect(result.blocks[0]).toEqual(first);
    expect(result.blocks[0]).toHaveProperty('status', status);
    expect(result.blocks[0]?.rejudged).toBeUndefined();
    expect(result.blocks[1]?.rejudged).toBeDefined();
  },
);

it('binds explicit resolved objects to each check context without mutating the caller spec', async () => {
  const input = await prepared();
  const prior = objectContextOfSpec(input.spec);
  const objects = context();
  const seen: ObjectContext[] = [];
  const policies: string[] = [];
  const check: Check = {
    ...mustCheck,
    evaluate: (ctx) => {
      const bound = objectContextOfSpec(ctx.spec);
      if (bound) {
        seen.push(bound);
        const policy = resolveBlockObjects(ctx.spec, ctx.blockIndex, bound).find(
          (entry) => entry.key === 'value_check',
        );
        if (policy) policies.push(policy.object.ref);
      }
      return mustCheck.evaluate(ctx);
    },
  };
  await rescoreRun(input, [check], objects);
  expect(seen).toEqual([objects, objects]);
  expect(policies).toEqual(Array(2).fill(objects.store.resolve('policy/value-check', 'strict').ref));
  expect(objectContextOfSpec(input.spec)).toBe(prior);
});
