import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentMutants, estateRun } from '../../src/ladders/estate/index';
import * as pipeline from '../../src/ladders/estate/pipeline';

afterEach(() => vi.restoreAllMocks());

/** Replays the original follower for real; answers every replay of a mutant with `outcome`. */
function mutantsReplay(outcome: { pass: boolean; definite: boolean }) {
  const real = pipeline.replayOnFollower;
  return vi
    .spyOn(pipeline, 'replayOnFollower')
    .mockImplementation(async (run, spec, checks, mutant, counter) => {
      const own = await real(run, spec, checks, mutant, counter);
      return mutant === undefined
        ? own
        : { ...own, ...outcome, failing: outcome.pass ? [] : ['block 0: planted'] };
    });
}

describe('a kill is a measured failure', { timeout: 600_000 }, () => {
  it('counts a mutant killed when a test fails with a measured failure', async () => {
    const run = await estateRun(1);
    const real = await agentMutants(run);
    expect(real.some((mutant) => mutant.killed)).toBe(true);
    mutantsReplay({ pass: false, definite: true });
    const planted = await agentMutants(run);
    const judged = planted.filter((mutant) => mutant.tests.length > 0 && !mutant.equivalent);
    expect(judged.length).toBeGreaterThan(0);
    for (const mutant of judged.filter((m) => !m.reason?.startsWith('no complete test'))) {
      expect(mutant.killed, mutant.atom).toBe(true);
      expect(mutant.inconclusive, mutant.atom).toBeUndefined();
    }
  });

  it('does not count a test that is not a pass and holds no measured failure as a kill: the mutant is inconclusive, and says so', async () => {
    const run = await estateRun(1);
    mutantsReplay({ pass: false, definite: false });
    const planted = await agentMutants(run);
    const judged = planted.filter(
      (mutant) =>
        mutant.tests.length > 0 &&
        !mutant.equivalent &&
        !mutant.reason?.startsWith('no complete test') &&
        !mutant.reason?.startsWith('no generated test'),
    );
    expect(judged.length).toBeGreaterThan(0);
    for (const mutant of judged) {
      expect(mutant.killed, mutant.atom).toBe(false);
      expect(mutant.inconclusive, mutant.atom).toBeGreaterThan(0);
      expect(mutant.reason, mutant.atom).toContain('inconclusive');
    }
  });

  it('keeps a pass as no kill and leaves no inconclusive count on it', async () => {
    const run = await estateRun(1);
    mutantsReplay({ pass: true, definite: false });
    const planted = await agentMutants(run);
    for (const mutant of planted.filter((m) => m.tests.length > 0 && !m.equivalent)) {
      expect(mutant.killed, mutant.atom).toBe(false);
      expect(mutant.inconclusive, mutant.atom).toBeUndefined();
    }
  });

  it('reads a real replay: a killed mutant of seed 1 has a measured failure, an original replay has none', async () => {
    const run = await estateRun(1);
    const mutants = await agentMutants(run);
    expect(mutants.filter((mutant) => mutant.killed).length).toBeGreaterThan(0);
    expect(mutants.every((mutant) => !mutant.killed || mutant.inconclusive === undefined)).toBe(true);
  });
});
