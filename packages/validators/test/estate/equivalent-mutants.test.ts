import { describe, expect, it } from 'vitest';
import { mutantFamily } from '../../src/ladders/estate/bank/loop';
import { follow } from '../../src/ladders/estate/follower';
import {
  agentMutants,
  asksOf,
  type EstateRun,
  estateRun,
  replayChecks,
  replayOnFollower,
} from '../../src/ladders/estate/index';
import { estateMeta, specVerdicts } from '../../src/ladders/estate/levels';

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

  it('judges the read-before-edit gate killed: the follower edits before reading once the gate is deleted', async () => {
    const run = await estateRun(1);
    const atom = 'gate.standing.read-a-file-before-you-edit';
    const hid = run.scanned.match.hidOf.get(atom) as string;
    const named = (await specVerdicts(run)).filter(
      (verdict) => (estateMeta(verdict.spec).atoms ?? []).includes(atom) && verdict.follower?.pass === true,
    );
    expect(named.length).toBeGreaterThan(0);
    const order = (asks: string[], mutant?: string) =>
      follow(run.estate, run.situations, asks, mutant ? { mutant } : {})
        .transcript.split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content;
          return Array.isArray(content)
            ? (content as Array<{ type?: string; name?: string }>)
                .filter((part) => part.type === 'tool_use' && (part.name === 'Read' || part.name === 'Edit'))
                .map((part) => part.name as string)
            : [];
        });
    const checks = replayChecks();
    const killers = [];
    for (const verdict of named) {
      const loaded = verdict.spec.loaded;
      if (!loaded) continue;
      const mutant = await replayOnFollower(run, loaded, checks, hid);
      if (mutant.pass) continue;
      killers.push(verdict.spec.record.id);
      // The original passes, the mutant's stream differs (the last Edit comes before the Read of its file), and
      // it is the ordering check on that edit that fails.
      expect((await replayOnFollower(run, loaded, checks)).pass).toBe(true);
      const asks = asksOf(loaded);
      const before = order(asks);
      const after = order(asks, hid);
      expect(after).not.toEqual(before);
      expect(before.lastIndexOf('Read')).toBeLessThan(before.lastIndexOf('Edit'));
      expect(after.indexOf('Edit')).toBeLessThan(after.lastIndexOf('Read'));
      expect(mutant.failing.join('\n')).toMatch(/custom\.ordered\.Read\.Edit/);
    }
    expect(killers.length).toBeGreaterThan(0);
    expect((await mutantFamily().evaluate(1)).get('mutant.agent.gate-read-before-edit')).toMatchObject({
      pass: true,
    });
  });

  it('keeps failing the classes whose deletion shows and that no test catches', async () => {
    const results = await mutantFamily().evaluate(1);
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
