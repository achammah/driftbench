import { describe, expect, it } from 'vitest';
import { simulateFamilyCoverage } from '../src/index';

/**
 * Coverage on suites with parents: families of blocks that inherit from one root. A family has its own pass
 * rate around the suite's mean, each child of the family has a rate around its family's, and each child is run
 * a few times. The hierarchical interval is read two ways: with every child as a tree (what the suite headline
 * does today) and with every family as a tree (the root of the parent chain).
 */
describe('coverage on simulated suites with parents', () => {
  /**
   * The reduced grid: 12 or 40 families, 3 or 8 children each, 3 runs per child, hyper-mean 0.6 and 0.9, family
   * concentration 0.5, 2 and 8, child concentration 2; 24 cells of 400 simulated suites, seed 101 onward. The
   * research grid of 48 cells (child concentration 2 and 20) is in docs/concepts/statistics.md.
   */
  const mean: Record<string, number> = {};
  const ahead: number[] = [];
  let cells = 0;
  for (const families of [12, 40]) {
    for (const children of [3, 8]) {
      for (const theta of [0.6, 0.9]) {
        for (const dFamily of [0.5, 2, 8]) {
          cells += 1;
          const r = simulateFamilyCoverage(
            { families, children, runs: 3, theta, dFamily, dChild: 2 },
            { reps: 400, seed: 100 + cells },
          );
          for (const [method, share] of Object.entries(r.coverage))
            mean[method] = (mean[method] ?? 0) + share / 24;
          ahead.push(r.coverage['families as trees'] - r.coverage['children as trees']);
        }
      }
    }
  }

  it('reads 24 cells', () => {
    expect(cells).toBe(24);
  });

  it('naive Wilson, which reads runs as independent, covers under 70 percent', () => {
    expect(mean['naive wilson']).toBeLessThan(0.7);
  });

  it('the hierarchical interval with every child as a tree undercovers: it covers under 85 percent', () => {
    expect(mean['children as trees']).toBeLessThan(0.85);
  });

  it('the hierarchical interval with every family as a tree covers 93 percent or more, near 95', () => {
    expect(mean['families as trees']).toBeGreaterThanOrEqual(0.93);
    expect(mean['families as trees']).toBeLessThan(0.99);
  });

  it('grouping by family covers more than grouping by child in at least 20 of the 24 cells', () => {
    expect(ahead.filter((gain) => gain > 0).length).toBeGreaterThanOrEqual(20);
  });

  it('without a family effect the two groupings both cover: grouping by family costs nothing there', () => {
    const control = simulateFamilyCoverage(
      { families: 30, children: 4, runs: 3, theta: 0.7, dFamily: 1e6, dChild: 1e6 },
      { reps: 400, seed: 77 },
    );
    expect(control.coverage['children as trees']).toBeGreaterThanOrEqual(0.9);
    expect(control.coverage['families as trees']).toBeGreaterThanOrEqual(0.9);
  });

  const strong = { families: 12, children: 4, runs: 3, theta: 0.7, dFamily: 1, dChild: 8 };

  it('is repeatable for a seed', () => {
    expect(simulateFamilyCoverage(strong, { reps: 40, seed: 5 })).toEqual(
      simulateFamilyCoverage(strong, { reps: 40, seed: 5 }),
    );
  });

  it('reports the share of suites that held the truth, for the three readings', () => {
    const r = simulateFamilyCoverage(strong, { reps: 60, seed: 3 });
    expect(Object.keys(r.coverage).sort()).toEqual(
      ['families as trees', 'children as trees', 'naive wilson'].sort(),
    );
    for (const share of Object.values(r.coverage)) {
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
    expect(r.reps).toBe(60);
    expect(r.cell).toEqual(strong);
  });

  it('rejects bad input', () => {
    const o = { reps: 10 };
    expect(() => simulateFamilyCoverage({ ...strong, families: 0 }, o)).toThrow(RangeError);
    expect(() => simulateFamilyCoverage({ ...strong, children: [] }, o)).toThrow(RangeError);
    expect(() => simulateFamilyCoverage({ ...strong, children: 0 }, o)).toThrow(RangeError);
    expect(() => simulateFamilyCoverage({ ...strong, runs: 0 }, o)).toThrow(RangeError);
    expect(() => simulateFamilyCoverage({ ...strong, dFamily: 0 }, o)).toThrow(RangeError);
    expect(() => simulateFamilyCoverage({ ...strong, dChild: 0 }, o)).toThrow(RangeError);
    expect(() => simulateFamilyCoverage(strong, { reps: 0 })).toThrow(RangeError);
  });
});
