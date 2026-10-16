// Blast radius of PR 443 on the runner: `uses` names scoring-only objects, so runSpec must replay a spec whose
// `uses` alone changed from the observed cache, without reaching the agent (cacheSpecHash, run.ts).
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { shippedObjectContext } from '../../src/objects';
import { runSpec } from '../../src/runner';
import type { Spec } from '../../src/schema/spec';
import { echoAdapter, memoryCache, specOf } from './support';

const driver = createScriptedDriver();

// Fictional data only: a two-block support conversation.
const plain = (): Spec =>
  specOf({
    id: 'blast-uses-cache',
    blocks: [
      { id: 'b1', user: 'Where is my order?', expect: { must: ['ok'] } },
      { id: 'b2', user: 'Thanks.', expect: { must: ['ok'] } },
    ],
  });

/** The same spec with `uses` on the spec and on its first block. */
const withUses = (): Spec => {
  const spec = plain();
  return {
    ...spec,
    uses: { blame: 'acme' },
    blocks: spec.blocks.map((block, index) =>
      index === 0 ? { ...block, uses: { value_check: 'test-policy' } } : block,
    ),
  };
};

const objects = shippedObjectContext();
objects.store.add({ kind: 'policy/blame', id: 'acme', items: [] }, 'project', { path: 'fixture' });
objects.store.add({ kind: 'policy/value-check', id: 'test-policy', items: [] }, 'project', {
  path: 'fixture',
});
const run = (spec: Spec, cache: ReturnType<typeof memoryCache>, adapter = echoAdapter()) =>
  runSpec(spec, { objects, adapter, driver, checks: [], mode: 'F', repeat: 0, cache });

describe('blast 443: runSpec keeps uses out of the block cache key', () => {
  it('replays every block of a spec whose uses alone changed, on the spec and on a block, with no agent call', async () => {
    const cache = memoryCache();
    const first = await run(plain(), cache);
    expect(first.cacheHit).toBe(false);
    const adapter = echoAdapter();
    const replayed = await run(withUses(), cache, adapter);
    expect(replayed.cacheHit).toBe(true);
    expect(adapter.opened).toEqual([]);
    expect(replayed.blocks.map((block) => block.cacheKey)).toEqual(
      first.blocks.map((block) => block.cacheKey),
    );
    // The spec hash records uses: the run is a run of a changed spec, replayed from the same observations.
    expect(replayed.specHash).not.toBe(first.specHash);
  });

  it('replays the other way too: a recording made with uses serves the spec without it', async () => {
    const cache = memoryCache();
    await run(withUses(), cache);
    const adapter = echoAdapter();
    const replayed = await run(plain(), cache, adapter);
    expect(replayed.cacheHit).toBe(true);
    expect(adapter.opened).toEqual([]);
  });

  it('still misses the cache when an agent-facing field changes beside uses', async () => {
    const cache = memoryCache();
    await run(plain(), cache);
    const changed = withUses();
    const moved: Spec = {
      ...changed,
      blocks: changed.blocks.map((block, index) =>
        index === 1 ? { ...block, when: { user: 'Thank you.' } } : block,
      ),
    };
    const adapter = echoAdapter();
    const result = await run(moved, cache, adapter);
    expect(result.cacheHit).toBe(false);
    expect(adapter.opened.length).toBeGreaterThan(0);
  });
});
