import { describe, expect, it } from 'vitest';
import { mutantFamily } from '../../src/ladders/estate/bank/loop';
import { follow } from '../../src/ladders/estate/follower';
import { agentMutants, type EstateRun, estateRun } from '../../src/ladders/estate/index';
import { estateMeta } from '../../src/ladders/estate/levels';

describe('agent mutants the rule follower cannot show (level 5)', { timeout: 300_000 }, () => {
  it('names as equivalent only atoms whose deletion changes no follower session, on asks, pairs and triples', async () => {
    const run = await estateRun(1);
    const mutants = await agentMutants(run);
    const same = mutants.filter((mutant) => mutant.equivalent);
    expect(same.length).toBeGreaterThan(0);
    expect(same.every((mutant) => !mutant.killed)).toBe(true);
    const phrases = run.situations.flatMap((situation) => situation.phrases);
    // Triples of a sample of asks, beyond the pairs the measure checks: still the same session.
    const sample = phrases.filter((_, index) => index % 4 === 0);
    const triples = sample.flatMap((a) => sample.flatMap((b) => sample.map((c) => [a, b, c])));
    const session = (asks: string[], mutant?: string) =>
      JSON.stringify(follow(run.estate, run.situations, asks, mutant ? { mutant } : {}));
    for (const mutant of same) {
      const hid = run.scanned.match.hidOf.get(mutant.atom) as string;
      expect(
        triples.every((asks) => session(asks) === session(asks, hid)),
        mutant.atom,
      ).toBe(true);
    }
    // A rule the hidden estate gives no act is among them; a skill, a script and the WebFetch deny rule are not.
    const kinds = new Set(same.map((mutant) => mutant.kind));
    expect(same.map((mutant) => mutant.atom)).toContain(
      'register.standing.keep-every-reply-under-1200-characters',
    );
    expect(kinds.has('skill')).toBe(false);
    expect(kinds.has('script')).toBe(false);
    expect(same.map((mutant) => mutant.atom)).not.toContain('tool.settings.deny-webfetch');
  });

  it('keeps failing the classes whose deletion shows and that no test catches', async () => {
    const results = await mutantFamily().evaluate(1);
    // With the product on main: the keyless gate is seen by the follower and live.
    expect(results.get('mutant.agent.gate-read-before-edit')).toMatchObject({ pass: false });
    expect(results.get('mutant.agent.register-reply-length')?.detail).toMatch(
      /no atom of the class changes the follower's session on this seed \(1 of 1 not judged/,
    );
  });

  it('fails a class again when the product writes no test for an atom the follower shows', async () => {
    const run = await estateRun(1);
    const scripts = new Set(
      run.scanned.map.atoms.filter((atom) => atom.kind === 'script').map((atom) => atom.id),
    );
    const without: EstateRun = {
      ...run,
      specs: run.specs.filter((spec) => !(estateMeta(spec).atoms ?? []).some((id) => scripts.has(id))),
    };
    const mutants = await agentMutants(without);
    const own = mutants.filter((mutant) => mutant.kind === 'script');
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((mutant) => !mutant.killed && !mutant.equivalent)).toBe(true);
    expect(own[0]?.reason).toMatch(/no generated test names the atom/);
  });
});
