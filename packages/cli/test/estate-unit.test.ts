import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const UNIT = join(FIXTURE, 'generated/unit');

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

describe('driftbench estate unit on the Northwind suite', () => {
  it('refuses unrecorded guard tests, records them on the original, passes there, and fails on a mutant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-unit-'));
    const tests = join(dir, 'unit');
    await cp(UNIT, tests, { recursive: true });

    const unrecorded = await run(['estate', 'unit', tests, '--estate', FIXTURE]);
    expect(unrecorded.code).toBe(2);
    expect(unrecorded.out).toContain('2 of 29 unit tests pass, 0 fail, 0 inert, 27 unrecorded');

    const recorded = await run(['estate', 'unit', tests, '--estate', FIXTURE, '--record']);
    expect(recorded.err).toBe('');
    expect(recorded.code).toBe(0);
    expect(recorded.out).toContain('Recorded 29 unit tests');
    const file = join(
      tests,
      'guard_positive/unit.guard_positive.guard.settings.pretooluse-bash-guard-block-force-push.json',
    );
    const test = JSON.parse(await readFile(file, 'utf8'));
    expect(test.cases[0].expected).toMatchObject({ decision: 'deny', exitCode: 2 });
    expect(test.recordedOn).toBe(test.mapHash);

    const again = await run(['estate', 'unit', tests, '--estate', FIXTURE, '--json']);
    expect(again.code).toBe(0);
    const contract = JSON.parse(again.out);
    expect(Object.keys(contract)).toEqual(['runs', 'guards', 'scripts']);
    expect(contract.runs).toHaveLength(29);
    for (const entry of contract.runs) {
      expect(Object.keys(entry)).toEqual(['spec', 'pass', 'failing']);
      expect([entry.pass, entry.failing]).toEqual([true, []]);
    }
    for (const entry of contract.guards) {
      expect(['allow', 'deny', 'ask']).toContain(entry.decision);
      expect(Number.isInteger(entry.ms)).toBe(true);
      expect(Object.keys(entry).filter((key) => key !== 'message')).toEqual([
        'guard',
        'event',
        'decision',
        'ms',
      ]);
    }
    expect(contract.guards).toContainEqual({
      guard: 'block-force-push.sh',
      event: 'PreToolUse',
      decision: 'deny',
      message: 'Never run git push --force on any branch.',
      ms: expect.any(Number),
    });
    // Each script runs the fixtures the estate configuration declares, in their order, and the exit code recorded
    // on the original is the one the fixture declares (the carrier table lists NWX 123, so that lookup exits 0).
    const declared = parse(await readFile(join(FIXTURE, 'driftbench.estate.yaml'), 'utf8')) as {
      scripts: Record<string, { fixtures: Array<{ expect?: { exitCode?: number } }> }>;
    };
    const wanted = Object.entries(declared.scripts).flatMap(([script, entry]) =>
      entry.fixtures.map((fixture) => [script.split('/').pop(), fixture.expect?.exitCode ?? 0]),
    );
    expect(wanted.length).toBeGreaterThan(8);
    expect(
      contract.scripts.map((entry: { script: string; exit: number }) => [
        entry.script.split('/').pop(),
        entry.exit,
      ]),
    ).toEqual(wanted);

    const mutant = join(dir, 'mutant');
    const atom = 'guard.settings.pretooluse-bash-guard-block-force-push';
    expect(
      (
        await run([
          'estate',
          'mutate',
          join(FIXTURE, 'approved.yaml'),
          '--atom',
          atom,
          '--delete',
          '--to',
          mutant,
        ])
      ).code,
    ).toBe(0);
    const killed = await run(['estate', 'unit', tests, '--estate', mutant, '--json']);
    expect(killed.code).toBe(1);
    const failed = JSON.parse(killed.out).runs.filter((entry: { pass: boolean }) => !entry.pass);
    expect(failed[0].failing).toEqual([
      'the estate no longer runs the PreToolUse guard block-force-push.sh on Bash',
    ]);
    expect(failed.map((entry: { spec: string }) => entry.spec).sort()).toEqual([
      `unit.guard_hostile.${atom}`,
      `unit.guard_negative.${atom}`,
      `unit.guard_positive.${atom}`,
      `unit.guard_speed.${atom}`,
    ]);

    // A script mutant takes the script file with its mention, so the script's own unit test goes red.
    const script = 'script.invoice-reconcile.script-scripts-reconcile-py';
    const scriptMutant = join(dir, 'mutant-script');
    expect(
      (
        await run([
          'estate',
          'mutate',
          join(FIXTURE, 'approved.yaml'),
          '--atom',
          script,
          '--delete',
          '--to',
          scriptMutant,
        ])
      ).code,
    ).toBe(0);
    const scriptKilled = await run(['estate', 'unit', tests, '--estate', scriptMutant, '--json']);
    expect(scriptKilled.code).toBe(1);
    const red = JSON.parse(scriptKilled.out).runs.filter((entry: { pass: boolean }) => !entry.pass);
    expect(red).toEqual([
      {
        spec: `unit.script_fixture.${script}`,
        pass: false,
        failing: ['the estate no longer holds .claude/skills/invoice-reconcile/scripts/reconcile.py'],
      },
    ]);
  }, 180_000);

  it('keeps the results and their order with --jobs, and says so when --no-sandbox runs without the sandbox', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-unit-jobs-'));
    const tests = join(dir, 'unit');
    await cp(join(UNIT, 'guard_positive'), tests, { recursive: true });
    expect((await run(['estate', 'unit', tests, '--estate', FIXTURE, '--record'])).code).toBe(0);

    const one = await run(['estate', 'unit', tests, '--estate', FIXTURE, '--json']);
    const four = await run(['estate', 'unit', tests, '--estate', FIXTURE, '--json', '--jobs', '4']);
    expect([one.code, four.code]).toEqual([0, 0]);
    const runs = (out: string) => (JSON.parse(out) as { runs: unknown[] }).runs;
    expect(runs(four.out)).toEqual(runs(one.out));
    expect(runs(one.out).length).toBeGreaterThan(1);

    const bad = await run(['estate', 'unit', tests, '--estate', FIXTURE, '--jobs', '0']);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--jobs takes a whole number of 1 or more, not 0');

    const open = await run(['estate', 'unit', tests, '--estate', FIXTURE, '--no-sandbox']);
    expect(open.code).toBe(0);
    expect(open.out).toContain(
      'no sandbox: the guards and scripts ran with the network and the home folder open',
    );
  }, 120_000);

  it('exits 2 on a missing estate, a missing path and a file that is no unit test', async () => {
    expect((await run(['estate', 'unit', UNIT])).code).toBe(2);
    expect((await run(['estate', 'unit', join(UNIT, 'nothing'), '--estate', FIXTURE])).code).toBe(2);
    expect(
      (await run(['estate', 'unit', join(FIXTURE, 'plan.summary.json'), '--estate', FIXTURE])).code,
    ).toBe(2);
  });

  it('lists each script fixture run with its exit code and stdout', async () => {
    const CASES = join(ROOT, 'examples/estates/reader-cases');
    const dir = await mkdtemp(join(tmpdir(), 'estate-unit-script-'));
    await writeFile(
      join(dir, 'track.json'),
      JSON.stringify({
        id: 'unit.script_fixture.track',
        planRow: 'row',
        testType: 'script_fixture',
        atom: 'script.shipment-tracker.script-scripts-track-sh',
        title: 'track.sh',
        mapHash: 'x',
        target: { kind: 'script', path: '.claude/skills/shipment-tracker/scripts/track.sh' },
        cases: [],
      }),
    );
    const result = await run(['estate', 'unit', dir, '--estate', CASES, '--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      runs: [{ spec: 'unit.script_fixture.track', pass: true, failing: [] }],
      guards: [],
      scripts: [
        { script: '.claude/skills/shipment-tracker/scripts/track.sh', exit: 2, stdout: '' },
        { script: '.claude/skills/shipment-tracker/scripts/track.sh', exit: 1, stdout: '' },
      ],
    });
  });
});
