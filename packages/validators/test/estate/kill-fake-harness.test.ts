import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cli } from '../../src/ladders/estate/bank/bench';
import { FIXTURE, machineFailure, runOnFakeDetailed } from '../../src/ladders/estate/bank/fixture-suite';

const MAP = join(FIXTURE, 'approved.yaml');
const LIVE = join(FIXTURE, 'generated/specs/live');
const folders: string[] = [];

afterEach(async () => {
  while (folders.length) await rm(folders.pop() as string, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kill-fake-harness-'));
  folders.push(dir);
  return dir;
}

/** The committed live spec of a test type that names an atom, found by its content. */
async function specNaming(testType: string, atom: string): Promise<string> {
  const dir = join(LIVE, testType);
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith('.yaml')).sort()) {
    if ((await readFile(join(dir, name), 'utf8')).includes(`\n      - ${atom}\n`)) return join(dir, name);
  }
  throw new Error(`no ${testType} spec names ${atom}`);
}

describe('the fake runtime as the kill.fake family runs it', { timeout: 120_000 }, () => {
  it('runs a spec that starts from a session state, with the fixture state library', async () => {
    const spec = await specNaming('hazard_recovery', 'hazard.standing.recover-from-a-compaction-of-the');
    const run = [...runOnFakeDetailed(FIXTURE, [spec], join(await scratch(), 'runs.db'), MAP).values()][0];
    expect(run?.failing.join('\n')).not.toContain('no operation in the state library');
    expect(run).toMatchObject({ completed: true, pass: true, failing: [] });
  });

  it('decides a judged criterion with the stand-in judge instead of leaving it inconclusive', async () => {
    const spec = await specNaming('obligation', 'instruction.inbox-triager.a-message-that-fits-no-folder');
    const run = [...runOnFakeDetailed(FIXTURE, [spec], join(await scratch(), 'runs.db'), MAP).values()][0];
    expect(run?.failing.join('\n')).not.toContain('inconclusive');
    expect(run).toMatchObject({ completed: true, pass: true });
  });

  it('still turns a spec red on the mutant of an agent that stops keeping a rule, on a machine check', async () => {
    const atom = 'guard.settings.pretooluse-bash-guard-block-force-push';
    const spec = await specNaming('guard_positive', atom);
    const dir = await scratch();
    const original = runOnFakeDetailed(FIXTURE, [spec], join(dir, 'original.db'), MAP);
    expect([...original.values()][0]).toMatchObject({ completed: true, pass: true });
    const mutant = join(dir, 'mutant');
    expect(cli(['estate', 'mutate', MAP, '--atom', atom, '--delete', '--to', mutant]).code).toBe(0);
    const run = [...runOnFakeDetailed(mutant, [spec], join(dir, 'mutant.db'), undefined).values()][0];
    expect(run).toMatchObject({ completed: true, pass: false });
    expect(run?.failing.some(machineFailure)).toBe(true);
  });

  it.each([
    ['instruction.inbox-triager.the-triager-never-answers-or-deletes', 'delete'],
    ['instruction.inbox-triager.a-message-that-fits-no-folder', 'delete'],
    ['register.invoice-reconcile.one-closing-line-per-invoice', 'invert'],
    ['register.ledger-auditor.the-auditor-answers-with-one-json', 'delete'],
  ])('turns the spec of %s red on its %s mutant, by what the fake agent then does', async (atom, how) => {
    const testType = atom.startsWith('register') ? 'register_sample' : 'obligation';
    const spec = await specNaming(testType, atom);
    const dir = await scratch();
    const original = runOnFakeDetailed(FIXTURE, [spec], join(dir, 'original.db'), MAP);
    expect([...original.values()][0]).toMatchObject({ completed: true, pass: true });
    const mutant = join(dir, 'mutant');
    expect(cli(['estate', 'mutate', MAP, '--atom', atom, `--${how}`, '--to', mutant]).code).toBe(0);
    const run = [...runOnFakeDetailed(mutant, [spec], join(dir, 'mutant.db'), undefined).values()][0];
    expect(run).toMatchObject({ completed: true, pass: false });
  });

  it('reads a failed judged criterion as no machine failure, so a judge alone never turns a run red', () => {
    expect(machineFailure('block 0: judge.instruction.inbox-triager.a-message (inconclusive)')).toBe(false);
    expect(machineFailure('block 3: judge.register.x')).toBe(false);
    expect(machineFailure('block 0: guards.block-force-push.sh.deny')).toBe(true);
    expect(machineFailure('block 1: must.0')).toBe(true);
  });
});
