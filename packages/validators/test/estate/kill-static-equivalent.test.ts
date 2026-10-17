import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bench from '../../src/ladders/estate/bank/bench';
import { FIXTURE, fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';
import {
  breakStandingSize,
  type Cell,
  equivalent,
  killFamily,
  STANDING_CEILING,
} from '../../src/ladders/estate/bank/kill';

vi.mock('../../src/ladders/estate/bank/bench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/bank/bench')>();
  return { ...actual, cli: vi.fn(actual.cli) };
});

const del = (kind: string): Cell => ({ kind, index: 0, op: 'delete', tier: 1 });

async function fixtureMap() {
  const suite = await fixtureSuite();
  const map = await loadEstateMap(suite.map);
  if (!map.ok) throw new Error('the fixture map does not load');
  return map.map;
}

describe('kill.fake: equivalent mutants are read from the fixture, not taken on trust', {
  timeout: 300_000,
}, () => {
  it('names a skill name line equal to its folder, and nothing else of the skill kind', async () => {
    const map = await fixtureMap();
    const skill = map.atoms.find((atom) => atom.kind === 'skill') as (typeof map.atoms)[number];
    expect(equivalent(del('skill'), skill.id, map)).toMatch(/repeats its folder/);
    const renamed = {
      ...map,
      atoms: map.atoms.map((atom) =>
        atom.id === skill.id
          ? { ...atom, provenance: { ...atom.provenance, quote: 'name: another-name' } }
          : atom,
      ),
    };
    expect(equivalent(del('skill'), skill.id, renamed)).toBeUndefined();
    expect(equivalent({ ...del('skill'), op: 'invert' }, skill.id, map)).toBeUndefined();
  });

  it('keeps delete-gate-2 a demand: the step list lets a failed verify reach report, the gate forbids it', async () => {
    const map = await fixtureMap();
    const gate = map.atoms.find((atom) => atom.id === 'gate.standing.never-report-done-before-verify-passed');
    if (!gate) throw new Error('the fixture has no verify gate');
    expect(equivalent(del('gate'), gate.id, map)).toBeUndefined();
    // The counter-example of the review of PR 274: the gate's words carry a condition, "has passed".
    expect(gate.provenance.quote).toMatch(/before the verify step has passed/);
    // verify leads to report and to do (the path after a failed check): report stays reachable right after a
    // failed verify. A spec whose workspace fails the check and expects no done report passes on the original
    // and goes red on the mutant, so the cell can be killed in principle.
    const verify = map.atoms.find((atom) => atom.kind === 'stage' && atom.fields?.id === 'verify');
    const report = map.atoms.find((atom) => atom.kind === 'stage' && atom.fields?.id === 'report');
    const doStage = map.atoms.find((atom) => atom.kind === 'stage' && atom.fields?.id === 'do');
    if (!verify || !report || !doStage) throw new Error('the fixture has no verify, report or do stage');
    const next = map.edges
      .filter((edge) => edge.kind === 'next' && edge.from === verify.id)
      .map((edge) => edge.to);
    expect(next).toContain(report.id);
    expect(next).toContain(doStage.id);
  });
});

describe('kill.fake: the invariant cell breaks the size ceiling on a copy, the anchor kept', () => {
  it('keeps the first line of CLAUDE.md and runs the file past the ceiling', async () => {
    const work = await mkdtemp(join(tmpdir(), 'kill-break-'));
    try {
      const copy = await breakStandingSize(FIXTURE, join(work, 'copy'));
      const before = await readFile(join(FIXTURE, 'CLAUDE.md'), 'utf8');
      const after = await readFile(join(copy, 'CLAUDE.md'), 'utf8');
      expect(after.split('\n')[0]).toBe(before.split('\n')[0]);
      expect(after.startsWith(before)).toBe(true);
      expect(after.length).toBeGreaterThan(STANDING_CEILING);
      expect(before.length).toBeLessThan(STANDING_CEILING);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});

describe('kill.fake: setting and invariant atoms are judged by their static tests', {
  timeout: 600_000,
}, () => {
  afterEach(() => vi.mocked(bench.cli).mockReset());

  it('passes the two setting cells on the fixture, red on the mutant', async () => {
    const actual = await vi.importActual<typeof bench>('../../src/ladders/estate/bank/bench');
    vi.mocked(bench.cli).mockImplementation(actual.cli);
    const results = await killFamily().evaluate(1);
    expect(results.get('kill.fake.delete-setting-1')).toMatchObject({ pass: true });
    expect(results.get('kill.fake.delete-setting-2')).toMatchObject({ pass: true });
    expect(results.get('kill.fake.break-invariant-1')).toMatchObject({ pass: true });
    expect(results.has('kill.fake.delete-invariant-1')).toBe(false);
    expect(results.has('kill.fake.delete-invariant-2')).toBe(false);
  });

  it('fails them when the static runner never turns red', async () => {
    const actual = await vi.importActual<typeof bench>('../../src/ladders/estate/bank/bench');
    vi.mocked(bench.cli).mockImplementation((args, cwd) => {
      const run = actual.cli(args, cwd);
      if (args[0] !== 'estate' || args[1] !== 'static') return run;
      // The oracle reads the command's standard output only (ruling N): rewrite stdout, and keep out as the joined text.
      const at = run.stdout.indexOf('{');
      if (at < 0) return run;
      const json = JSON.parse(run.stdout.slice(at)) as { results?: Array<{ pass: boolean }> };
      for (const result of json.results ?? []) result.pass = true;
      const stdout = JSON.stringify(json);
      return { ...run, code: 0, stdout, out: `${stdout}${run.stderr}` };
    });
    const results = await killFamily().evaluate(1);
    expect(results.get('kill.fake.delete-setting-1')).toMatchObject({ pass: false });
    expect(results.get('kill.fake.delete-setting-2')).toMatchObject({ pass: false });
    // The copy keeps the anchor line and breaks the property: a runner that does not see it fails the cell.
    expect(results.get('kill.fake.break-invariant-1')).toMatchObject({ pass: false });
  });
});
