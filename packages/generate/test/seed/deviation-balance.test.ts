import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeSpec } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { DEVIATION_POOL, hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';

describe('deviation allocation after coverage', () => {
  it.each([5, 8, 20])(
    'balances the placed classes on seed %s without dropping coverage',
    async (seed) => {
      const root = await mkdtemp(join(tmpdir(), 'generate-balance-'));
      try {
        const hidden = hiddenSpec(seed);
        const rendered = renderMap(hidden);
        await mkdir(join(root, 'map'));
        for (const [key, name] of Object.entries(MAP_FILES))
          await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
        const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
        if (!loaded.ok) throw new Error(loaded.message);
        const suite = generateSuite(loaded.prepared, { mapPath: '../map.yaml', seed });
        // A class is placed where coverage places it: by an injected block and by a declared perturbation.
        const counts = new Map<string, number>(DEVIATION_POOL.map((cls) => [cls, 0]));
        const space = loaded.prepared.space;
        const at = loaded.prepared.deviation;
        if (at === undefined) throw new Error('the map has no deviation axis');
        for (const spec of suite.complete)
          for (const event of placeSpec(space, spec).events)
            for (const value of event.values[at] ?? []) {
              const cls = space.dimensions[at]?.values[value]?.id ?? '';
              if (counts.has(cls)) counts.set(cls, (counts.get(cls) ?? 0) + 1);
            }
        expect(counts.size).toBeGreaterThan(1);
        expect(
          Math.max(...counts.values()) / Math.min(...counts.values()),
          JSON.stringify([...counts]),
        ).toBeLessThanOrEqual(3);
        expect(suite.report.coverage.actual.every((level) => level.covered === level.allowed)).toBe(true);
        expect(suite.report.invalid).toEqual([]);
        expect(suite.report.lint).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
