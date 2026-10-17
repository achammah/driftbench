import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { cellsOf, generateSuite, renderSummary } from '../../src/enumerate/generate';
import { seederOf } from '../../src/enumerate/spec-cap';

const hidden = hiddenSpec(1);
const source = await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const prepared = source.prepared;
// These tests are about the cap itself: the repeated ends are reduced after it, on the specs that stay, so
// the structural specs compared here would differ from the uncapped suite. The reduction has its own tests.
const options = { mapPath: '../map.yaml', t: 3, seed: 7, reduceEnds: false };
const full = generateSuite(prepared, options);
const capped = generateSuite(prepared, { ...options, specCap: full.all.length });
const held = (specs: typeof full.complete, t: number) =>
  cellsOf(prepared, specs, t)
    .filter((cell) => cell.count > 0)
    .map((cell) => cell.values);

describe('total spec cap', () => {
  it('retains every actual pair and triple, including when requested strength is only two', () => {
    for (const t of [2, 3]) {
      const candidate = generateSuite(prepared, { ...options, t });
      const result = generateSuite(prepared, { ...options, t, specCap: candidate.all.length });
      expect(result.report.spec_cap?.preserved).toBe(true);
      for (const strength of [2, 3])
        expect(held(result.complete, strength)).toEqual(held(candidate.complete, strength));
    }
  }, 30_000);

  it('keeps structural and incomplete specs byte for byte and counts only written files', () => {
    const ready = new Set(full.complete.map((spec) => spec.id));
    const protectedSpecs = full.all.filter(
      (spec) => !ready.has(spec.id) || !['twise', 'cover'].includes(seederOf(spec)),
    );
    for (const spec of protectedSpecs) expect(capped.all).toContainEqual(spec);
    const original = new Map(full.files.map((file) => [file.path, file.text]));
    const yaml = capped.files.filter((file) => file.path.endsWith('.yaml'));
    expect(yaml).toHaveLength(capped.report.summary.specs);
    for (const file of yaml) {
      expect(file.text).toBe(original.get(file.path));
      expect(parseSpecText(file.text, 'yaml', file.path).ok).toBe(true);
    }
    expect(Object.values(capped.report.seeders).reduce((sum, row) => sum + row.specs, 0)).toBe(yaml.length);
    expect(capped.report.spec_cap?.protected).toBe(protectedSpecs.length);
    expect(capped.report.summary.specs).toBeLessThanOrEqual(full.all.length);
  }, 30_000);

  it('lists every lost tuple when the cap is too small, and refuses to trim protected probes', () => {
    const protectedCount = capped.report.spec_cap?.protected ?? 0;
    expect(() => generateSuite(prepared, { ...options, specCap: protectedCount - 1 })).toThrow(/protected/);
    const result = generateSuite(prepared, { ...options, specCap: protectedCount });
    expect(result.all).toHaveLength(protectedCount);
    expect(result.report.spec_cap?.preserved).toBe(false);
    for (const row of result.report.spec_cap?.coverage ?? []) {
      const retained = new Set(held(result.complete, row.t).map((cell) => JSON.stringify(cell)));
      expect(row.lost).toEqual(
        held(full.complete, row.t).filter((cell) => !retained.has(JSON.stringify(cell))),
      );
      expect(row.uncovered).toEqual(
        cellsOf(prepared, result.complete, row.t)
          .filter((cell) => cell.count === 0)
          .map((cell) => cell.values),
      );
      expect(row.selected).toBe(retained.size);
    }
  }, 30_000);

  it('leaves budget semantics unchanged and preserves the selected budget pool', () => {
    const budget = generateSuite(prepared, { ...options, budget: 5 });
    const result = generateSuite(prepared, { ...options, budget: 5, specCap: budget.all.length });
    expect(result.report.budget).toEqual(budget.report.budget);
    expect(result.report.options.budget).toBe(5);
    expect(result.report.spec_cap?.candidates).toBe(budget.all.length);
    expect(result.report.spec_cap?.preserved).toBe(true);
    expect(budget.report.spec_cap).toBeUndefined();
    expect(full.report.options).not.toHaveProperty('specCap');
  }, 30_000);

  it('leads with measured axis coverage and lists gaps even when the candidate array is complete', () => {
    // The uncapped suite covers every allowed pair on this map, so the gaps are those of the suite cut down
    // to its protected probes: the candidate array is still complete, the written specs are not.
    const cut = generateSuite(prepared, { ...options, specCap: capped.report.spec_cap?.protected ?? 0 });
    expect(cut.report.twise.share).toBe(1);
    const actual = cut.report.coverage.actual.find((row) => row.t === 2);
    expect(actual?.uncovered.length).toBeGreaterThan(0);
    expect(actual?.uncovered).toEqual(
      cellsOf(prepared, cut.complete, 2)
        .filter((cell) => cell.count === 0)
        .map((cell) => cell.values),
    );
    const lines = renderSummary(cut.report).split('\n');
    expect(lines[0]).toContain(`pairs ${actual?.covered} of ${actual?.allowed}`);
    expect(lines[0]).toMatch(/^Actual axis-map coverage/);
    expect(lines[1]).toMatch(/^Candidate t-wise array/);
    expect(lines[2]).toContain(`${actual?.uncovered.length} pairs`);
  }, 30_000);

  it('requires explicit pairs mode to trade triples for a smaller suite', () => {
    const pairPool = generateSuite(prepared, { ...options, specCap: full.all.length, specCapMode: 'pairs' });
    const limit = pairPool.report.spec_cap?.preserving ?? 0;
    const pairs = generateSuite(prepared, { ...options, specCap: limit, specCapMode: 'pairs' });
    const exact = generateSuite(prepared, { ...options, specCap: limit });
    expect(pairs.report.spec_cap?.mode).toBe('pairs');
    expect(pairs.report.spec_cap?.preserved).toBe(true);
    expect(held(pairs.complete, 2)).toEqual(held(full.complete, 2));
    expect(pairs.report.spec_cap?.coverage.find((row) => row.t === 3)?.lost.length).toBeGreaterThan(0);
    expect(exact.report.spec_cap?.mode).toBe('tuples');
    expect(exact.report.spec_cap?.preserved).toBe(false);
    expect(() => generateSuite(prepared, { ...options, specCapMode: 'pairs' })).toThrow(/requires specCap/);
  }, 30_000);

  it('rejects invalid API cap values, is deterministic, and states a greedy rather than an optimal minimum', () => {
    for (const specCap of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => generateSuite(prepared, { ...options, specCap })).toThrow(RangeError);
    expect(generateSuite(prepared, { ...options, specCap: full.all.length }).files).toEqual(capped.files);
    const preserving = capped.report.spec_cap?.preserving ?? 0;
    expect(generateSuite(prepared, { ...options, specCap: preserving }).report.spec_cap?.preserved).toBe(
      true,
    );
    if (preserving > (capped.report.spec_cap?.protected ?? 0))
      expect(
        generateSuite(prepared, { ...options, specCap: preserving - 1 }).report.spec_cap?.preserved,
      ).toBe(false);
  }, 30_000);
});
