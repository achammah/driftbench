import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import type { ScaleReport } from '../../src/ladders/generator/scale';

// The bank's own time items on hand-written reports: a run's verdict is the same on a host three times slower,
// and a product twice as slow or quadratic fails. Each report holds the reference unit's mean and samples.

/** A finished scale report with everything right but the time, which the case sets. */
function report(factor: number, ms: number, unitMs: number, unitSamples: number): ScaleReport {
  return {
    factor,
    budgetMs: factor === 10 ? 60_000 : 120_000,
    ms,
    invalid: 0,
    lint: 0,
    bytesSame: true,
    graphOk: true,
    graphDetail: '',
    twiseShare: 1,
    boundaryOk: true,
    boundaryMissing: 0,
    deviationOk: true,
    deviationMissing: 0,
    unwalked: 0,
    completeShare: 1,
    followerPass: 1,
    followerTotal: 1,
    unitMs,
    unitSamples,
  };
}

/** The verdict of the bank's own time item on a report. */
async function itemVerdict(factor: number, scaled: ScaleReport): Promise<boolean> {
  const item = bankItems().find((entry) => entry.id === `scale.${factor}x.time`);
  if (!item) throw new Error(`no item scale.${factor}x.time`);
  const data = new SeedData(1, {}, async () => scaled);
  return (await item.check(data)).pass;
}

describe('the scale time items count CPU time in reference units', () => {
  it('give the same verdict on a host three times slower, where the unit costs three times as much', async () => {
    // A run of 850 units: 46.3 s where a unit takes 54.5 ms, 139.0 s on a host three times slower.
    expect(await itemVerdict(100, report(100, 850 * 54.5, 54.5, 130))).toBe(true);
    expect(await itemVerdict(100, report(100, 850 * 163.5, 163.5, 130))).toBe(true);
    // A run of 1200 units fails on both hosts.
    expect(await itemVerdict(100, report(100, 1200 * 54.5, 54.5, 130))).toBe(false);
    expect(await itemVerdict(100, report(100, 1200 * 163.5, 163.5, 130))).toBe(false);
  });

  it('give the same verdict on runners as far apart as the CI runners measured', async () => {
    // 850 units on a runner where a unit took 62.9 ms (53.5 s) and on one where it took 46.6 ms (39.6 s).
    expect(await itemVerdict(100, report(100, 850 * 62.9, 62.9, 128))).toBe(true);
    expect(await itemVerdict(100, report(100, 850 * 46.6, 46.6, 134))).toBe(true);
  });

  it('judge the 10 times run by the unit of the 100 times run, which a short window reads dearer', async () => {
    // A product at 33 s at 10 times, the earlier absolute item's failure, on a runner whose unit takes 54.5 ms
    // over the long 100 times window and 70 ms over the short 10 times one (as the CI runner reads it).
    const ten = report(10, 33_000, 70, 13);
    const hundred = report(100, 850 * 54.5, 54.5, 130);
    const item = bankItems().find((entry) => entry.id === 'scale.10x.time');
    if (!item) throw new Error('no item scale.10x.time');
    const verdict = await item.check(new SeedData(1, {}, async (factor) => (factor === 10 ? ten : hundred)));
    // 33000 ms over 54.5 ms is 606 units, over the budget of 550; read in its own window it would be 471.
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toMatch(/606 reference units .* during the 100 times runs/);
  });

  it('fail a product twice as slow and a quadratic one on the same host', async () => {
    // 850 units is the highest clean run on the runner (validators/CONSTANTS.md); twice the lowest fails.
    expect(await itemVerdict(100, report(100, 850 * 54.5, 54.5, 130))).toBe(true);
    expect(await itemVerdict(100, report(100, 2 * 823 * 54.5, 54.5, 130))).toBe(false);
    // A run that costs 100 times the 10 times run fails, though the 10 times run is well inside its own budget.
    expect(await itemVerdict(10, report(10, 140 * 54.5, 54.5, 13))).toBe(true);
    expect(await itemVerdict(100, report(100, 100 * 140 * 54.5, 54.5, 130))).toBe(false);
  });
});
