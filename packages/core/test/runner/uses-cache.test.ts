import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { beforeAll, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { acmeAdapter, specOf } from './support';

beforeAll(() => initializeShippedObjects());

const driver = createScriptedDriver();
const blocks = [
  { id: 'a', user: 'Which bike for the city?' },
  { id: 'b', user: 'And in blue?' },
];

it('puts uses in the spec hash and leaves it out of every block cache key', async () => {
  const plain = specOf({ id: 'bikes', blocks });
  const tailored = specOf({
    id: 'bikes',
    uses: { check_set: { items: [{ id: 'tools', enabled: false }] } },
    blocks: [blocks[0], { ...blocks[1], uses: { check_set: { items: [{ id: 'must', enabled: false }] } } }],
  });
  const run = (spec: typeof plain) =>
    runSpec(spec, { adapter: acmeAdapter(), driver, checks: [], mode: 'F', repeat: 0 });
  const [one, two] = [await run(plain), await run(tailored)];
  expect(two.specHash).not.toBe(one.specHash);
  expect(two.blocks.map((block) => block.cacheKey)).toEqual(one.blocks.map((block) => block.cacheKey));
});
