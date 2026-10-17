import * as product from '@agent-nexus/driftbench-estate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentMutantLevel,
  agentMutants,
  drawEstate,
  type EstateRun,
  estateMutantDecisions,
  estateMutants,
  estateRun,
  holdoutLevel,
  MUTATION_SCORE,
  matchAtoms,
  renderEstate,
  replayChecks,
  replayOnFollower,
  specVerdicts,
} from '../../src/ladders/estate/index';
import { estateMeta } from '../../src/ladders/estate/levels';

vi.mock('@agent-nexus/driftbench-estate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-nexus/driftbench-estate')>();
  return { ...actual, estateImpact: vi.fn(actual.estateImpact) };
});

const GATE = 'gate.standing.read-a-file-before-you-edit';

/** The run with the ordered pair taken out of every complete spec that names the gate: still complete. */
function withoutOrderedPair(run: EstateRun): EstateRun {
  return {
    ...run,
    specs: run.specs.map((spec) => {
      if (!spec.loaded || !(estateMeta(spec).atoms ?? []).includes(GATE)) return spec;
      const body = structuredClone(spec.loaded.spec) as { rules?: { custom?: Record<string, unknown> } };
      if (body.rules?.custom) delete body.rules.custom.ordered;
      return { ...spec, loaded: { ...spec.loaded, spec: body } } as typeof spec;
    }),
  };
}

describe('agent mutants (level 5)', { timeout: 120_000 }, () => {
  it('kills skills, scripts and the deleted WebFetch prohibition, and says why a living mutant lives', async () => {
    const run = await estateRun(1);
    const mutants = await agentMutants(run);
    const of = (kind: string) => mutants.filter((mutant) => mutant.kind === kind);
    expect(of('skill').length).toBeGreaterThan(0);
    expect(of('skill').every((mutant) => mutant.killed)).toBe(true);
    // The deny rule is judged on the offered tools its session records: deleting the rule offers WebFetch again.
    const deny = mutants.find((mutant) => mutant.atom === 'tool.settings.deny-webfetch');
    expect(deny?.killed).toBe(true);
    // The keyless gate is a product gap the bank names (mutant.agent.gate-read-before-edit). This test does not
    // ask the product to keep it: a mutant is killed, or it lives and carries one of the two reasons a living
    // mutant can have.
    expect(mutants.find((mutant) => mutant.atom === 'instruction.standing.never-call-webfetch')?.killed).toBe(
      true,
    );
    const gate = mutants.find((mutant) => mutant.atom === 'gate.standing.read-a-file-before-you-edit');
    expect(gate).toBeDefined();
    if (!gate?.killed) expect(gate?.reason).toMatch(/wait for |complete tests ran on the follower/);
    for (const mutant of mutants) {
      if (mutant.killed) expect(mutant.reason, mutant.atom).toBeUndefined();
      else
        expect(mutant.reason, mutant.atom).toMatch(
          /no generated test names the atom|wait for |complete tests ran on the follower|records the same session|holds no such file/,
        );
    }
    expect(of('script').length).toBeGreaterThan(0);
    expect(of('script').every((mutant) => mutant.killed && mutant.tests.length > 0)).toBe(true);
  });

  it('kills a follower that skips a read two atoms ask for, by the read its tests expect', async () => {
    for (const seed of [1, 2, 3]) {
      const run = await estateRun(seed);
      const mutants = await agentMutants(run);
      // A reference mutant with complete tests on the follower: the follower reads each file once, so skipping
      // the read is a real difference, whichever of the atoms that name the file is deleted.
      const judged = mutants.filter(
        (mutant) =>
          mutant.kind === 'reference' &&
          !mutant.equivalent &&
          // A reference to a file the estate lacks has no complete test by contract: it is judged by its marker.
          !mutant.untestable &&
          !mutant.reason?.startsWith('no complete test'),
      );
      expect(judged.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(
        judged.filter((mutant) => !mutant.killed).map((mutant) => mutant.atom),
        `seed ${seed}`,
      ).toEqual([]);
      const standing = judged.filter((mutant) => mutant.atom.startsWith('reference.standing.'));
      expect(standing.length, `seed ${seed}`).toBeGreaterThan(0);
      // The kill is the expected read going missing, not an artefact of the follower reading twice.
      const checks = replayChecks();
      for (const mutant of standing) {
        const hid = run.scanned.match.hidOf.get(mutant.atom) as string;
        const green = (await specVerdicts(run)).filter(
          (verdict) =>
            (estateMeta(verdict.spec).atoms ?? []).includes(mutant.atom) && verdict.follower?.pass === true,
        );
        const outcomes = await Promise.all(
          green.flatMap((verdict) =>
            verdict.spec.loaded ? [replayOnFollower(run, verdict.spec.loaded, checks, hid)] : [],
          ),
        );
        expect(outcomes.flatMap((outcome) => outcome.failing).join('\n')).toMatch(
          /read 0 times, expected at least 1/,
        );
      }
    }
  });

  it('kills a follower whose runtime offers a tool the settings deny, by the offered tools its tests expect', async () => {
    for (const seed of [1, 2, 3]) {
      const run = await estateRun(seed);
      const deny = (await agentMutants(run)).find((mutant) => mutant.atom === 'tool.settings.deny-webfetch');
      expect(deny?.tests.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(deny?.killed, `seed ${seed}`).toBe(true);
      const hid = run.scanned.match.hidOf.get('tool.settings.deny-webfetch') as string;
      const checks = replayChecks();
      const green = (await specVerdicts(run)).filter(
        (verdict) =>
          (estateMeta(verdict.spec).atoms ?? []).includes('tool.settings.deny-webfetch') &&
          verdict.follower?.pass === true,
      );
      expect(green.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const verdict of green) {
        const loaded = verdict.spec.loaded as NonNullable<typeof verdict.spec.loaded>;
        // The original follower passes (it is green); the one that offers WebFetch fails on the offered tools.
        const outcome = await replayOnFollower(run, loaded, checks, hid);
        expect(outcome.pass).toBe(false);
        expect(outcome.failing.join('\n')).toMatch(/tools_offered\.exclude\.WebFetch.*WebFetch was offered/);
      }
    }
  });

  it('scores each kind and names the living mutants of a kind below the bar', async () => {
    const run = await estateRun(1);
    const measure = await agentMutantLevel(run);
    const mutants = await agentMutants(run);
    const alive = measure.items.map((item) => item.id);
    // The value is the lowest kill share over the kinds, and every item is a living mutant of a kind below the bar.
    const kinds = [...new Set(mutants.map((mutant) => mutant.kind))];
    const share = (kind: string) => {
      const own = mutants.filter(
        (mutant) => mutant.kind === kind && !('equivalent' in mutant && mutant.equivalent),
      );
      return own.length === 0 ? 1 : own.filter((mutant) => mutant.killed).length / own.length;
    };
    expect(measure.value).toBeCloseTo(Math.min(...kinds.map(share)), 12);
    for (const id of alive) {
      const atom = id.replace('mutant-alive:', '');
      const mutant = mutants.find((each) => each.atom === atom);
      expect(mutant?.killed, id).toBe(false);
      expect(share(mutant?.kind as string), id).toBeLessThan(MUTATION_SCORE);
    }
    const gate = mutants.find((mutant) => mutant.atom === 'gate.standing.read-a-file-before-you-edit');
    if (gate && !gate.killed && share('gate') < MUTATION_SCORE)
      expect(alive).toContain(`mutant-alive:${gate.atom}`);
    expect(alive.some((id) => id.startsWith('mutant-alive:skill.'))).toBe(false);
    expect(alive.some((id) => id.startsWith('mutant-alive:script.'))).toBe(false);
  });

  it('names the generator when script specs are deliberately made incomplete', async () => {
    const run = await estateRun(1);
    const scripts = new Set(
      run.scanned.map.atoms.filter((atom) => atom.kind === 'script').map((atom) => atom.id),
    );
    expect(scripts.size).toBeGreaterThan(0);
    const wrong: EstateRun = {
      ...run,
      specs: run.specs.map((spec) =>
        estateMeta(spec).atoms?.some((id) => scripts.has(id))
          ? { ...spec, record: { ...spec.record, complete: false } }
          : spec,
      ),
    };
    const measure = await agentMutantLevel(wrong);
    const script = measure.items.find((item) => item.id.startsWith('mutant-alive:script.'));
    expect(script?.component).toBe('packages/generate/src/estate/generate.ts');
    expect(script?.detail).toContain('no complete test passes on the rule follower');
  });

  it('kills nothing when no test is complete', async () => {
    const run = await estateRun(1);
    const none: EstateRun = {
      ...run,
      specs: run.specs.map((spec) => ({ ...spec, record: { ...spec.record, complete: false } })),
    };
    const measure = await agentMutantLevel(none);
    expect(measure.value).toBe(0);
  });
});

describe('a living agent mutant run on the follower (level 5, planted)', { timeout: 300_000 }, () => {
  it('keeps the gate mutant alive, with its reason, when its complete tests check no order', async () => {
    const run = withoutOrderedPair(await estateRun(1));
    const gate = (await agentMutants(run)).find((mutant) => mutant.atom === GATE);
    expect(gate?.tests.length).toBeGreaterThan(0);
    expect(gate?.killed).toBe(false);
    expect(gate?.reason).toMatch(
      /complete tests ran on the follower with the atom deleted and all passed; the evidence .*did not fire/,
    );
    const mutants = await agentMutants(run);
    const gates = mutants.filter((mutant) => mutant.kind === 'gate');
    const share = gates.filter((mutant) => mutant.killed).length / gates.length;
    const measure = await agentMutantLevel(run);
    if (share < MUTATION_SCORE)
      expect(measure.items.map((item) => item.id)).toContain(`mutant-alive:${GATE}`);
    expect(measure.value).toBeLessThanOrEqual(share);
  });
});

describe('wrong maintenance decisions (level 6, planted products)', { timeout: 300_000 }, () => {
  afterEach(() => vi.mocked(product.estateImpact).mockReset());

  it('names the tests a product that retires nothing should have retired', async () => {
    const actual = await vi.importActual<typeof product>('@agent-nexus/driftbench-estate');
    vi.mocked(product.estateImpact).mockImplementation((diff, tests) => ({
      ...actual.estateImpact(diff, tests),
      retire: [],
    }));
    const { wrong } = await estateMutantDecisions(await estateRun(1));
    const missed = wrong.filter((verdict) => verdict.expected === 'retired');
    expect(missed.length).toBeGreaterThan(0);
    expect(missed.every((verdict) => verdict.got === 'regenerated' || verdict.got === 'untouched')).toBe(
      true,
    );
  });

  it('names the tests a product that retires every test of a renamed folder should have kept', async () => {
    const actual = await vi.importActual<typeof product>('@agent-nexus/driftbench-estate');
    vi.mocked(product.estateImpact).mockImplementation((diff, tests) => {
      const impact = actual.estateImpact(diff, tests);
      // An atom that left its folder: removed from it, or moved to another file with its identity kept (a product
      // that follows a skill by its name reports a renamed folder as moves, with nothing removed).
      const left = diff.atoms.moved.filter((move) => move.from.file !== move.to.file);
      const gone = new Set([...diff.atoms.removed.map((atom) => atom.id), ...left.map((move) => move.id)]);
      const extra = tests
        .filter((test) => test.atoms.some((atom) => gone.has(atom)))
        .filter((test) => !impact.retire.some((entry) => entry.test === test.id))
        .map((test) => ({
          test: test.id,
          file: test.file,
          atoms: test.atoms,
          reason: 'planted: every test of an atom that left its folder',
          state: 'to_write' as const,
        }));
      return { ...impact, retire: [...impact.retire, ...extra] };
    });
    const { wrong } = await estateMutantDecisions(await estateRun(1));
    const renamed = wrong.filter((verdict) => verdict.mutant.startsWith('rename:'));
    expect(renamed.length).toBeGreaterThan(0);
    expect(renamed.every((verdict) => verdict.expected === 'kept' && verdict.got === 'retired')).toBe(true);
  });
});

describe('estate mutants (level 6)', { timeout: 120_000 }, () => {
  it('takes one atom out per kind, and re-wraps a rule with its words unchanged', () => {
    const estate = drawEstate(1);
    const mutants = estateMutants(estate);
    expect(mutants.map((mutant) => mutant.kind)).toEqual([
      'instruction',
      'gate',
      'reference',
      'script',
      'register',
      'route',
      'subagent',
      'guard',
      'stage',
      'tool',
      'wording',
      'addition',
      'semantic',
      'spacing',
      'move',
      'rename',
      'verdict',
    ]);
    const before = new Set(renderEstate(estate).atoms.map((atom) => atom.hid));
    for (const mutant of mutants) {
      const after = new Set(renderEstate(mutant.estate).atoms.map((atom) => atom.hid));
      const gone = [...before].filter((hid) => !after.has(hid));
      if (['wording', 'addition', 'semantic', 'spacing', 'move', 'rename', 'verdict'].includes(mutant.kind)) {
        expect(gone, mutant.id).toEqual([]);
      } else expect(gone.length, mutant.id).toBeGreaterThan(0);
    }
  });

  it('names each wrong maintenance decision with what was expected, and leaves a re-wrap alone', async () => {
    const run = await estateRun(1);
    const { judged, wrong } = await estateMutantDecisions(run);
    expect(judged).toBeGreaterThan(run.specs.length);
    // What the validator expects does not depend on the product: a test whose atoms all left is retired, and a
    // renamed folder keeps its tests (the bank's maintain.impact.rename-* items). A product that does both has no
    // wrong decision here; this test asks only that a wrong one, when there is one, is named as such.
    for (const verdict of wrong) {
      expect(verdict.expected, verdict.mutant).not.toBe(verdict.got);
      expect(verdict.why.length, verdict.mutant).toBeGreaterThan(0);
      if (verdict.mutant.startsWith('rename:')) expect(verdict.expected, verdict.mutant).toBe('kept');
      else expect(verdict.expected, verdict.mutant).toBe('retired');
    }
    expect(wrong.some((verdict) => verdict.mutant.startsWith('wording:'))).toBe(false);
    const sample = wrong.find((verdict) => verdict.mutant.startsWith('instruction:'));
    if (sample) expect(sample.why).toMatch(/left the estate/);
  });
});

describe('the holdout estate (level 7)', { timeout: 120_000 }, () => {
  it('runs levels 1 to 6 on the holdout estate and stops at the first that fails', async () => {
    const measure = await holdoutLevel(await estateRun(1, 'holdout'));
    // The value is the count of lower levels passed over six. Below one, the items are those of the first level
    // that failed, each named with the holdout prefix; at one there is none. Which level stops the product today
    // is the product's affair, not this test's.
    const passed = Math.round(measure.value * 6);
    expect(measure.value).toBeCloseTo(passed / 6, 12);
    expect(passed).toBeGreaterThanOrEqual(0);
    expect(passed).toBeLessThanOrEqual(6);
    if (passed < 6) {
      expect(measure.items.length).toBeGreaterThan(0);
      const stage = measure.items[0]?.id.split(':')[1];
      expect(measure.items.every((item) => item.id.startsWith(`holdout:${stage}:`))).toBe(true);
    } else expect(measure.items).toEqual([]);
  });

  it('fails at level 1 of the holdout when a holdout-only form is lost by the scan', async () => {
    const run = await estateRun(1, 'holdout');
    const atoms = run.scanned.map.atoms.filter((atom) => !atom.provenance.file.includes('/memory/'));
    const measure = await holdoutLevel({
      ...run,
      scanned: {
        ...run.scanned,
        map: { ...run.scanned.map, atoms },
        match: matchAtoms(run.rendered.atoms, atoms),
      },
    });
    expect(measure.value).toBe(0);
    expect(measure.items[0]?.id).toMatch(/^holdout:atoms-and-edges:atom-missed:rule:dates-year-first$/);
  });
});
