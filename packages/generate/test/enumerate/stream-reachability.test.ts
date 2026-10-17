import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite, generateSuiteToDisk, loadApprovedMap, prepareMap } from '../../src/enumerate';
import type { PreparedMap } from '../../src/seed/map';
import { zedProposal } from './support';

async function parity(prepared: PreparedMap, seed: number, outputDir: string) {
  const options = { mapPath: 'map.yaml', seed };
  const eager = generateSuite(prepared, options);
  const disk = generateSuiteToDisk(prepared, { ...options, outputDir });
  const report = JSON.parse(await readFile(disk.reportPath, 'utf8'));
  expect(eager.report.coverage.reachability?.excluded.length).toBeGreaterThan(0);
  expect(report.coverage.reachability).toEqual(eager.report.coverage.reachability);
  const { measures, ...coverage } = report.coverage;
  const { measures: expectedMeasures, ...expectedCoverage } = eager.report.coverage;
  expect(coverage).toEqual(expectedCoverage);
  for (const [key, value] of Object.entries(expectedMeasures))
    expect(measures[key], key).toBeCloseTo(value, 10);
  expect({ ...report, coverage: undefined }).toEqual({ ...eager.report, coverage: undefined });
  expect(report.coverage.actual).toEqual(eager.report.coverage.actual);
  expect(report.cover).toEqual(eager.report.cover);
  expect(report.no_phrase).toEqual(eager.report.no_phrase);
  expect(report.no_then).toEqual(eager.report.no_then);
  expect(report.invalid).toEqual(eager.report.invalid);
  expect(report.lint).toEqual(eager.report.lint);
  expect(disk.summary).toEqual(eager.report.summary);
  expect(disk.fileCount).toBe(eager.files.length);
}

const by = {
  evidence: { source: 'prompt.md', quote: 'Only balance checks an amount.' },
  produced_by: 'code' as const,
  approved: true,
};

describe('streamed reachability diagnostics', () => {
  it('reports exclusions on a handwritten map with an unplaceable behaviour', async () => {
    const proposal = zedProposal({
      extra: [
        {
          id: 'policy',
          title: 'Policy',
          kind: 'behaviour',
          role: 'axis',
          ...by,
          values: ['CHECK-11', 'CHECK-22'].map((id) => ({ id, title: id, ...by })),
        },
      ],
    });
    proposal.relations = [
      { kind: 'path', id: 'amount', flow: 'balance', stages: ['greet', 'verify', 'help'], ...by },
    ];
    const prepared = prepareMap(proposal, {
      inventory: {
        behaviours: ['CHECK-11', 'CHECK-22'].map((id) => ({ id, title: id, kind: 'conversation' })),
        flows: [
          { id: 'balance', title: 'Balance', behaviours: ['CHECK-11'] },
          { id: 'card', title: 'Card', behaviours: ['CHECK-22'] },
        ],
      },
    });
    const root = await mkdtemp(join(tmpdir(), 'stream-reachability-hand-'));
    try {
      await parity(prepared, 42, join(root, 'output'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Drawn before this regression test and streaming correction, independently of the original bank seeds.
  it.each([48039, 787237, 942716])(
    'keeps eager diagnostics on fresh seed %s',
    async (seed) => {
      const root = await mkdtemp(join(tmpdir(), 'stream-reachability-fresh-'));
      try {
        const mapDir = join(root, 'map');
        await mkdir(mapDir);
        const rendered = renderMap(hiddenSpec(seed));
        for (const [key, name] of Object.entries(MAP_FILES))
          await writeFile(join(mapDir, name), rendered[key as keyof typeof rendered]);
        const loaded = await loadApprovedMap(join(mapDir, MAP_FILES.map));
        if (!loaded.ok) throw new Error(loaded.message);
        await parity(loaded.prepared, seed, join(root, 'output'));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
