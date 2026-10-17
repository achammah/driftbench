import { dirname } from 'node:path';
import { canonicalGiven, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import { buildTaskInputs } from '../../src/seed/tasks';
import { ACME_MAP } from './support';

// The identity the reducer gives a block: the turn, the stage it is said from, what it expects, its context.
function key(spec: Spec, index: number): string {
  const block = spec.blocks[index];
  const { criteria: _criteria, ...machine } = block?.expect ?? {};
  const from = index === 0 ? spec.stages?.[0] : spec.blocks[index - 1]?.expect?.stage;
  return JSON.stringify([
    spec.kind,
    spec.channel,
    spec.tags?.filter((tag) => tag.startsWith('persona:')),
    spec.lang,
    spec.rules,
    canonicalGiven(spec, index).state,
    from,
    block?.when,
    block?.given,
    machine,
    spec.perturbations?.filter((entry) => entry.inject_at <= index).map(({ id: _id, ...plan }) => plan),
  ]);
}

describe('the reduction of repeated ends under --spec-cap', () => {
  it('cuts a walk only where a written spec says the end, on the Acme suite at --spec-cap 360', async () => {
    const loaded = await loadApprovedMap(ACME_MAP);
    if (!loaded.ok) throw new Error(loaded.message);
    const tasks = await buildTaskInputs(loaded.prepared, dirname(ACME_MAP), {
      n: 8,
      seed: 1,
      seedFrom: (id) => `./.seed-${id}`,
    });
    const options = { t: 2, seed: 1, mapPath: '../map/approved.yaml', tasks: tasks.inputs, specCap: 360 };
    const kept = generateSuite(loaded.prepared, { ...options, reduceEnds: false });
    const reduced = generateSuite(loaded.prepared, options);
    const written = new Set(reduced.all.flatMap((spec) => spec.blocks.map((_b, index) => key(spec, index))));
    const byId = new Map(reduced.all.map((spec) => [spec.id, spec]));
    let cutWalks = 0;
    for (const spec of kept.all) {
      const shorter = byId.get(spec.id);
      if (!shorter || shorter.blocks.length === spec.blocks.length) continue;
      cutWalks += 1;
      for (let index = shorter.blocks.length; index < spec.blocks.length; index += 1)
        expect(written.has(key(spec, index)), `${spec.id}#${spec.blocks[index]?.id}`).toBe(true);
    }
    expect(cutWalks).toBeGreaterThan(0);
    expect(reduced.all.length).toBe(kept.all.length);
  }, 180_000);
});
