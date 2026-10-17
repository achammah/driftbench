import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

const hidden = hiddenSpec(1);
const source = await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 3, seed: 1 });

describe('a cell that holds the start stage', () => {
  it('is covered by a clean walk that declares the first-turn class as its perturbation', () => {
    // A class said on the first turn whose recovery stays there has no Then an idle reply fails, so no
    // block holds it. The cover seeder leaves no such cell unbuilt.
    expect(suite.report.cover?.unbuilt ?? []).toEqual([]);
    for (const row of suite.report.coverage.actual) expect(row.uncovered, `t = ${row.t}`).toEqual([]);
    const opening = suite.complete.filter(
      (spec) =>
        (spec.metadata?.generated as { seeder?: string } | undefined)?.seeder === 'cover' &&
        (spec.perturbations ?? []).some((entry) => entry.inject_at === 0),
    );
    expect(opening.length).toBeGreaterThan(0);
    for (const spec of opening) {
      const first = spec.perturbations?.find((entry) => entry.inject_at === 0);
      expect(first?.expect?.stage, spec.id).toBe(spec.stages?.[0]);
      // The first turn is a move of the path: the class said before it is declared, never a block.
      const firstBlock = spec.blocks[0];
      expect(firstBlock?.when && 'injection' in firstBlock.when, spec.id).toBe(false);
    }
  }, 60_000);
});
