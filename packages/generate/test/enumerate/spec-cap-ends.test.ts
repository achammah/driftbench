import { dirname } from 'node:path';
import { canonicalGiven, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import type { ReducedEnds } from '../../src/seed/assemble';
import { buildTaskInputs } from '../../src/seed/tasks';
import { ACME_MAP } from './support';

// The identity the reducer gives a block: the turn, the stage it is said from, what it expects, its language and
// rules. The channel, the persona and the declared perturbations are not part of it.
function key(spec: Spec, index: number): string {
  const block = spec.blocks[index];
  const { criteria: _criteria, ...machine } = block?.expect ?? {};
  const from = index === 0 ? spec.stages?.[0] : spec.blocks[index - 1]?.expect?.stage;
  return JSON.stringify([
    spec.kind,
    spec.lang,
    spec.rules,
    canonicalGiven(spec, index).state,
    from,
    block?.when,
    block?.given,
    machine,
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
      const reduction = (shorter.metadata as { generated: { reduced_ends: ReducedEnds } }).generated
        .reduced_ends;
      expect(reduction).toMatchObject({
        from_blocks: spec.blocks.length,
        to_blocks: shorter.blocks.length,
      });
      expect(reduction.duplicates.map((entry) => entry.block)).toEqual(
        spec.blocks.slice(shorter.blocks.length).map((block) => block.id),
      );
      for (const entry of reduction.duplicates) {
        const witness = byId.get(entry.duplicate_of.spec);
        expect(witness, entry.duplicate_of.spec).toBeDefined();
        const originalIndex = spec.blocks.findIndex((block) => block.id === entry.block);
        const witnessIndex =
          witness?.blocks.findIndex((block) => block.id === entry.duplicate_of.block) ?? -1;
        expect(witnessIndex).toBeGreaterThanOrEqual(0);
        expect(key(spec, originalIndex)).toBe(key(witness as Spec, witnessIndex));
      }
      for (let index = shorter.blocks.length; index < spec.blocks.length; index += 1)
        expect(written.has(key(spec, index)), `${spec.id}#${spec.blocks[index]?.id}`).toBe(true);
    }
    for (const [seeder, totals] of Object.entries(reduced.report.seeders)) {
      const recorded = reduced.all.reduce((sum, spec) => {
        const generated = (
          spec.metadata as {
            generated: { seeder: string; reduced_ends?: ReducedEnds };
          }
        ).generated;
        return sum + (generated.seeder === seeder ? (generated.reduced_ends?.duplicates.length ?? 0) : 0);
      }, 0);
      expect(totals.cut_blocks, seeder).toBe(recorded);
      expect(kept.report.seeders[seeder as keyof typeof kept.report.seeders].cut_blocks).toBe(0);
    }
    expect(cutWalks).toBeGreaterThan(0);
    expect(reduced.all.length).toBe(kept.all.length);
  }, 180_000);
});
