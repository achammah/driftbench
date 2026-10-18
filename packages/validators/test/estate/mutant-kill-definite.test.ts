import { describe, expect, it } from 'vitest';
import { killOf, type SpecVerdict } from '../../src/ladders/estate/levels';
import type { ReplayOutcome } from '../../src/ladders/estate/pipeline';

/**
 * docs/validators.md, the estate's level 5: a test kills an agent mutant only by a definite failure. These replays are
 * written by hand; they name no atom, seed or bank entry.
 */
type Outcome = 'pass' | 'fail' | 'inconclusive' | 'not_applicable';

function replay(
  outcomes: Outcome[],
  {
    status = 'completed',
    endMatch,
  }: { status?: 'completed' | 'failed' | 'stopped'; endMatch?: boolean } = {},
): ReplayOutcome {
  const verdicts = outcomes.map((outcome, index) => ({ id: `check.${index}`, gating: true, outcome }));
  const blockPass = verdicts.every((verdict) => verdict.outcome === 'pass');
  const run = {
    status,
    blocks: [{ index: 0, pass: blockPass, verdicts }],
    ...(endMatch === undefined ? {} : { endState: { match: endMatch, diff: [] } }),
  };
  return {
    pass: status === 'completed' && blockPass && endMatch !== false,
    failing: verdicts
      .filter((verdict) => verdict.outcome !== 'pass')
      .map((verdict) => `block 0: ${verdict.id}`),
    run: run as unknown as ReplayOutcome['run'],
  };
}

/** Green tests, one per replay, and the kill decision on the replays in that order. */
async function judged(replays: ReplayOutcome[]) {
  const green = replays.map(
    (_, index) =>
      ({ spec: { loaded: { index } }, follower: { pass: true, failing: [] } }) as unknown as SpecVerdict,
  );
  return killOf(
    green,
    async (loaded) => replays[(loaded as unknown as { index: number }).index] as ReplayOutcome,
  );
}

describe('an agent mutant is killed only by a definite failure', () => {
  it('does not count an inconclusive verdict as a kill', async () => {
    expect(await judged([replay(['pass', 'inconclusive'])])).toEqual({ killed: false, undecided: 1 });
  });

  it('does not count a not-applicable verdict, or a run that broke off, as a kill', async () => {
    expect(await judged([replay(['not_applicable'])])).toEqual({ killed: false, undecided: 1 });
    expect(await judged([replay(['pass'], { status: 'failed' })])).toEqual({ killed: false, undecided: 1 });
    // A run that broke off decides nothing even when a check it reached had failed.
    expect(await judged([replay(['fail'], { status: 'stopped' })])).toEqual({ killed: false, undecided: 1 });
  });

  it('counts a failed gating check, or an end state that differs, as a kill', async () => {
    expect((await judged([replay(['pass', 'fail'])])).killed).toBe(true);
    expect((await judged([replay(['pass'], { endMatch: false })])).killed).toBe(true);
  });

  it('goes on past an undecided test to a later one that fails definitely', async () => {
    expect(await judged([replay(['inconclusive']), replay(['fail'])])).toEqual({
      killed: true,
      undecided: 1,
    });
    expect(await judged([replay(['pass']), replay(['pass'])])).toEqual({ killed: false, undecided: 0 });
  });
});
