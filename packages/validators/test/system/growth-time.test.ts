import { describe, expect, it } from 'vitest';
import { MAX_SAMPLE_RUNS, MIN_SAMPLE_MS, measureTimeGrowth } from '../../src/ladders/system/bank/growth';
import { GROWTH_BOUND } from '../../src/ladders/system/bank/scale';

/**
 * The time measure of the subjects that are not a history. A fake clock gives each run a cost, so a test says
 * exactly what the measure reads; the last test uses the real clock on loops written here.
 */

type Cost = (size: number, call: number) => number;

/** A subject whose run at `size` costs `cost(size, call)` ms, where `call` counts the runs at that size. */
function fake(cost: Cost) {
  let now = 0;
  const calls = new Map<number, number>();
  return {
    clock: () => now,
    run: async (size: number) => {
      const call = calls.get(size) ?? 0;
      calls.set(size, call + 1);
      now += cost(size, call);
    },
  };
}

const options = (subject: { clock: () => number }) => ({ timeBound: GROWTH_BOUND, clock: subject.clock });

describe('measureTimeGrowth: sampling', () => {
  it('times the smaller size in single runs until they cover the minimum', async () => {
    const subject = fake((size) => (size === 1000 ? 20 : 2));
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.time.runs).toBe(MIN_SAMPLE_MS / 2);
    expect(growth.time.ten).toBe(2);
    expect(growth.time.hundred).toBe(20);
    expect(growth.result).toEqual({ pass: true });
  });

  it('takes the best single run at the smaller size, not the mean', async () => {
    // The first two runs of the smaller size are hit by load; the best of the rest is 2 ms.
    const subject = fake((size, call) => (size === 1000 ? 20 : call < 2 ? 9 : 2));
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.time.ten).toBe(2);
    expect(growth.result).toEqual({ pass: true });
  });

  it('reads the larger size once when it is within the bound', async () => {
    const subject = fake((size) => (size === 1000 ? 20 : 2));
    let larger = 0;
    const counted = async (size: number) => {
      if (size === 1000) larger += 1;
      await subject.run(size);
    };
    const growth = await measureTimeGrowth(counted, 10, options(subject));
    expect(larger).toBe(1);
    expect(growth.time.hundred).toBe(20);
  });

  it('reads the larger size a second time only when the first is over the bound, and keeps the best', async () => {
    // The first run of the larger size is hit by load (190 ms is 95 times); the second is 20 ms.
    const subject = fake((size, call) => (size === 1000 ? (call < 1 ? 190 : 20) : 2));
    let larger = 0;
    const counted = async (size: number) => {
      if (size === 1000) larger += 1;
      await subject.run(size);
    };
    const growth = await measureTimeGrowth(counted, 10, options(subject));
    expect(larger).toBe(2);
    expect(growth.time.hundred).toBe(20);
    expect(growth.result).toEqual({ pass: true });
  });

  it('keeps the first larger run when the second is slower', async () => {
    // 60 ms is 30 times, over the bound; the second run (190 ms) is worse. The verdict reads the best, 60 ms.
    const subject = fake((size, call) => (size === 1000 ? (call < 1 ? 60 : 190) : 2));
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.time.hundred).toBe(60);
  });

  it('never reads the larger size a third time, however slow it is', async () => {
    const subject = fake((size, call) => (size === 1000 ? (call < 2 ? 190 : 20) : 2));
    let larger = 0;
    const counted = async (size: number) => {
      if (size === 1000) larger += 1;
      await subject.run(size);
    };
    const growth = await measureTimeGrowth(counted, 10, options(subject));
    expect(larger).toBe(2);
    expect(growth.time.hundred).toBe(190);
    expect(growth.result.pass).toBe(false);
  });

  it('runs every run of the smaller size before any run of the larger size', async () => {
    const order: number[] = [];
    const subject = fake(() => 1);
    await measureTimeGrowth(
      async (size) => {
        order.push(size);
        await subject.run(size);
      },
      10,
      options(subject),
    );
    const firstLarger = order.indexOf(1000);
    expect(firstLarger).toBeGreaterThan(0);
    expect(order.slice(0, firstLarger).every((size) => size === 100)).toBe(true);
    expect(order.slice(firstLarger).every((size) => size === 1000)).toBe(true);
  });

  it('stops adding runs of the smaller size at the most', async () => {
    const subject = fake(() => 0);
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.time.runs).toBe(MAX_SAMPLE_RUNS);
  });

  it('never times a loop of runs: each clock reading brackets one run', async () => {
    let now = 0;
    let inRun = 0;
    let widest = 0;
    const run = async () => {
      inRun += 1;
      widest = Math.max(widest, inRun);
      now += 1;
      inRun -= 1;
    };
    const readings: number[] = [];
    const reading = () => {
      readings.push(now);
      return now;
    };
    await measureTimeGrowth(run, 10, { timeBound: GROWTH_BOUND, clock: reading });
    const spans = readings
      .filter((_, index) => index % 2 === 1)
      .map((end, index) => end - (readings[index * 2] as number));
    expect(spans.every((span) => span === 1)).toBe(true);
    expect(widest).toBe(1);
  });
});

describe('measureTimeGrowth: the bound of the bank is kept', () => {
  it('fails 26 times and passes 24 times at the bound of 25', async () => {
    expect(GROWTH_BOUND).toBe(25);
    const over = fake((size) => (size === 1000 ? 52 : 2));
    const under = fake((size) => (size === 1000 ? 48 : 2));
    const failed = await measureTimeGrowth(over.run, 10, options(over));
    const passed = await measureTimeGrowth(under.run, 10, options(under));
    expect(failed.result.pass).toBe(false);
    expect(failed.result.pass ? '' : failed.result.detail).toContain('26.0 times');
    expect(passed.result).toEqual({ pass: true });
  });

  it('keeps the old floor: a smaller time under 1 ms is read as 1 ms', async () => {
    // 0.2 ms and 20 ms is 100 times by the clock, 20 times by the floor: it passes. 0.2 ms and 30 ms fails.
    const passes = fake((size) => (size === 1000 ? 20 : 0.2));
    const fails = fake((size) => (size === 1000 ? 30 : 0.2));
    expect((await measureTimeGrowth(passes.run, 10, options(passes))).result).toEqual({ pass: true });
    expect((await measureTimeGrowth(fails.run, 10, options(fails))).result.pass).toBe(false);
  });

  it('fails a quadratic run however the samples fall', async () => {
    const subject = fake((size, call) => (size === 1000 ? 200 + (call % 5) * 40 : 2 + (call % 3)));
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.result.pass).toBe(false);
  });
});

describe('measureTimeGrowth: the real clock', () => {
  const sink = { total: 0 };
  /** A run whose work is `perUnit` operations for each of `size` units. */
  const linear = async (size: number) => {
    for (let index = 0; index < size * 2000; index += 1) sink.total += index % 7;
  };
  /** A run that compares every unit with every other unit: the planted quadratic. */
  const quadratic = async (size: number) => {
    for (let outer = 0; outer < size; outer += 1)
      for (let inner = 0; inner < size * 40; inner += 1) sink.total += (outer ^ inner) % 7;
  };

  it('passes a linear run', async () => {
    const growth = await measureTimeGrowth(linear, 10, { timeBound: GROWTH_BOUND });
    expect(growth.result).toEqual({ pass: true });
  });

  it('fails a planted quadratic run', async () => {
    const growth = await measureTimeGrowth(quadratic, 10, { timeBound: GROWTH_BOUND });
    expect(growth.result.pass).toBe(false);
    expect(growth.time.growth).toBeGreaterThan(GROWTH_BOUND);
  });
}, 60_000);
