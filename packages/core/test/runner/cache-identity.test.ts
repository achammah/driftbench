import { createHash } from 'node:crypto';
import { type AgentAdapter, canonicalJson, resolveGiven, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { echoAdapter, memoryCache, specOf } from './support';

/** The parts as the key reads them: the history before the block is its own SHA-256 under `prefix.sha256`. */
function keyed<T extends { given: { prefix: unknown } }>(parts: T): T {
  const history = createHash('sha256').update(canonicalJson(parts.given.prefix)).digest('hex');
  return { ...parts, given: { ...parts.given, prefix: { sha256: history } } };
}

const spec = specOf({ id: 'cache-identity', blocks: [{ user: 'hello' }] });
const target = { adapter: 'echo', agent: 'fictional-echo' };
const options = { driver: createScriptedDriver(), checks: [], mode: 'F' as const, repeat: 0, target };

it('reads the separate adapter cache identity without changing its reported version', async () => {
  const cache = memoryCache();
  const adapter = (cacheIdentity: string): AgentAdapter => ({ ...echoAdapter(), cacheIdentity });
  const first = await runSpec(spec, { ...options, cache, adapter: adapter('command-a') });
  expect(first.cacheHit).toBe(false);
  const same = await runSpec(spec, { ...options, cache, adapter: adapter('command-a') });
  expect(same.cacheHit).toBe(true);
  const other = await runSpec(spec, { ...options, cache, adapter: adapter('command-b') });
  expect(other.cacheHit).toBe(false);
  expect(other.blocks[0]?.cacheKey).not.toBe(first.blocks[0]?.cacheKey);
  expect(adapter('command-a').version).toBe(adapter('command-b').version);
});

it('keeps legacy run key bytes for adapters without a cache identity or agent version', async () => {
  for (const suite of [undefined, 'nightly']) {
    const cache = memoryCache();
    const adapter = echoAdapter();
    const result = await runSpec(spec, { ...options, cache, adapter, suite });
    const legacy = {
      specHash: result.specHash,
      repeat: 0,
      position: 0,
      given: resolveGiven({ ledger: {}, world: {}, vars: {} }, [], target),
      stimulus: { user: 'hello' },
      target,
      adapter: adapter.id,
      adapterVersion: adapter.version,
      ...(suite === undefined ? {} : { suite }),
    };
    const expected = `block:${createHash('sha256')
      .update(canonicalJson(keyed(legacy)))
      .digest('hex')}`;
    expect(result.blocks[0]?.cacheKey).toBe(expected);
    const explicitUndefined = await runSpec(spec, {
      ...options,
      cache,
      adapter: { ...adapter, cacheIdentity: undefined },
      suite,
      agentVersion: undefined,
    });
    expect(explicitUndefined.blocks[0]?.cacheKey).toBe(expected);
    expect(explicitUndefined.cacheHit).toBe(true);
  }
});
