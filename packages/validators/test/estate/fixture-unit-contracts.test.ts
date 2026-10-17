import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { FIXTURE } from '../../src/ladders/estate/bank/fixture-suite';

/**
 * The Northwind fixture declares what the unit runner needs to run a helper or a script: a local executor per
 * helper and, per script, its usage line and fixtures with expected exit codes and outputs
 * (`driftbench.estate.yaml`, docs/estate.md "Declared unit execution contracts").
 */
type Fixture = {
  args?: string[];
  stdin?: string;
  files?: Record<string, string>;
  expect?: { exitCode?: number; stdout?: string; stdoutIncludes?: string[] };
};
type Config = {
  helpers: Record<string, { command: string[]; timeoutMs?: number }>;
  scripts: Record<string, { usage: string; fixtures: Fixture[] }>;
};

const folders: string[] = [];
afterEach(async () => {
  while (folders.length) await rm(folders.pop() as string, { recursive: true, force: true });
});
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fixture-unit-'));
  folders.push(dir);
  return dir;
}

async function config(): Promise<Config> {
  return parse(await readFile(join(FIXTURE, 'driftbench.estate.yaml'), 'utf8')) as Config;
}

const HELPERS = ['inbox-triager', 'ledger-auditor', 'route-planner'];

/** The documented semantics of an expectation: the exit code (0 when unstated), the output, parts of the output. */
function problems(fixture: Fixture, run: { status: number | null; stdout: string }): string[] {
  const out: string[] = [];
  const want = fixture.expect?.exitCode ?? 0;
  if (run.status !== want) out.push(`exit ${run.status} where ${want}`);
  if (fixture.expect?.stdout !== undefined && run.stdout.trim() !== fixture.expect.stdout.trim())
    out.push('another stdout');
  for (const piece of fixture.expect?.stdoutIncludes ?? [])
    if (!run.stdout.includes(piece)) out.push(`stdout lacks ${piece}`);
  return out;
}

async function runFixture(interpreter: string[], script: string, fixture: Fixture) {
  const cwd = await scratch();
  for (const [name, text] of Object.entries(fixture.files ?? {})) await writeFile(join(cwd, name), text);
  const [command, ...rest] = interpreter;
  return spawnSync(command as string, [...rest, script, ...(fixture.args ?? [])], {
    cwd,
    input: fixture.stdin ?? '',
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('the fixture declares an executor for every helper', () => {
  it('names a local command and a timeout for each helper agent of the estate', async () => {
    const agents = (await readdir(join(FIXTURE, '.claude/agents'))).map((name) => name.replace(/\.md$/, ''));
    const declared = (await config()).helpers;
    expect(Object.keys(declared).sort()).toEqual([...agents].sort());
    for (const name of HELPERS) {
      expect(declared[name]?.command[0]).toBe('node');
      expect(declared[name]?.timeoutMs).toBeGreaterThan(0);
    }
  });

  async function act(systemPrompt: string, task: string, files: Record<string, string>) {
    const cwd = await scratch();
    for (const [name, text] of Object.entries(files)) {
      await mkdir(dirname(join(cwd, name)), { recursive: true });
      await writeFile(join(cwd, name), text);
    }
    const [command, ...args] = ((await config()).helpers['inbox-triager'] ?? { command: [] }).command;
    const run = spawnSync(command as string, args, {
      cwd,
      input: `${JSON.stringify({ name: 'inbox-triager', systemPrompt, frontmatter: {}, task })}\n`,
      encoding: 'utf8',
      timeout: 20_000,
    });
    return { run, cwd, observed: run.status === 0 ? JSON.parse(run.stdout) : undefined };
  }

  const mail = {
    'box/1.txt': 'The invoice is attached, please pay the invoice.',
    'box/2.txt': 'A parcel left the depot.',
    'box/3.txt': 'Lunch on Friday?',
  };
  const ASK = 'Sort the messages in box/ into their folders.';
  const body = (rules: string) => `You sort messages into folders: invoices, parcels and notes. ${rules}\n`;

  it('follows the instructions it is given, and reports what it did to the workspace', async () => {
    const { observed } = await act(
      body('A message that fits none goes to "misc". Never delete a message.'),
      ASK,
      mail,
    );
    expect(observed.text).toBe('box/1.txt: invoices\nbox/2.txt: parcels\nbox/3.txt: misc');
    expect(observed.workspaceDiff).toEqual({ created: [], changed: [], deleted: [] });
  });

  it('acts differently when a rule is removed: it then clears what it filed', async () => {
    const { observed, cwd } = await act(body('A message that fits none goes to "misc".'), ASK, mail);
    expect(observed.workspaceDiff.deleted).toEqual(['box/1.txt', 'box/2.txt', 'box/3.txt']);
    expect((await readdir(join(cwd, 'box'))).length).toBe(0);
  });

  it('does nothing without instructions, so a helper that lost its body fails', async () => {
    const { run } = await act('  \n', ASK, mail);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
  });
});

describe('the fixture gives each script a usage line and fixtures that a fake cannot satisfy', () => {
  const SCRIPTS = [
    ['.claude/skills/invoice-reconcile/scripts/reconcile.py', ['python3']],
    ['.claude/skills/shipment-tracker/scripts/track.sh', ['sh']],
  ] as const;

  it.each(SCRIPTS)('%s declares a usage line and an exit code for every fixture', async (path) => {
    const declared = (await config()).scripts[path];
    expect(declared?.usage).toMatch(/\S/);
    expect(declared?.fixtures.length).toBeGreaterThanOrEqual(3);
    for (const fixture of declared?.fixtures ?? []) expect(fixture.expect?.exitCode).toBeTypeOf('number');
  });

  it.each(SCRIPTS)('%s satisfies its own fixtures', async (path, interpreter) => {
    for (const fixture of (await config()).scripts[path]?.fixtures ?? [])
      expect(
        problems(fixture, await runFixture([...interpreter], join(FIXTURE, path), fixture)),
        `${path} ${fixture.args}`,
      ).toEqual([]);
  });

  it.each(SCRIPTS)('%s: a script that only starts, or only succeeds, breaks a fixture', async (path) => {
    const dir = await scratch();
    const fixtures = (await config()).scripts[path]?.fixtures ?? [];
    for (const [label, text] of [
      ['succeeds', '#!/bin/sh\necho "ok"\nexit 0\n'],
      ['fails', '#!/bin/sh\necho "the script broke" >&2\nexit 1\n'],
      ['usage', '#!/bin/sh\necho "usage" >&2\nexit 2\n'],
    ] as const) {
      const fake = join(dir, `${label}.sh`);
      await writeFile(fake, text);
      await chmod(fake, 0o755);
      const results = await Promise.all(
        fixtures.map(async (fixture) => problems(fixture, await runFixture(['sh'], fake, fixture))),
      );
      expect(
        results.some((found) => found.length > 0),
        `${path}: a script that ${label}`,
      ).toBe(true);
    }
  });

  /** Breaks of the contract one at a time: each is a script the fixtures must turn red. */
  const MUTANTS: Array<[string, readonly string[], string, (text: string) => string]> = [
    [
      'reconcile: tolerance 0.05 to 0.5',
      ['python3'],
      'invoice-reconcile/scripts/reconcile.py',
      (t) => t.replace('Decimal("0.05")', 'Decimal("0.5")'),
    ],
    [
      'reconcile: tolerance 0.05 to 0.001',
      ['python3'],
      'invoice-reconcile/scripts/reconcile.py',
      (t) => t.replace('Decimal("0.05")', 'Decimal("0.001")'),
    ],
    [
      'reconcile: abs() removed from the price comparison',
      ['python3'],
      'invoice-reconcile/scripts/reconcile.py',
      (t) => t.replace('abs(got[1] - want[1]) < ROUNDING', '(got[1] - want[1]) < ROUNDING'),
    ],
    [
      'reconcile: < to <= at the tolerance',
      ['python3'],
      'invoice-reconcile/scripts/reconcile.py',
      (t) => t.replace('< ROUNDING', '<= ROUNDING'),
    ],
    [
      'reconcile: quantity ignored',
      ['python3'],
      'invoice-reconcile/scripts/reconcile.py',
      (t) => t.replace('got[0] == want[0] and ', ''),
    ],
    [
      'reconcile: a differing line exits 0',
      ['python3'],
      'invoice-reconcile/scripts/reconcile.py',
      (t) => t.replace('return 1 if differs else 0', 'return 0'),
    ],
    [
      'reconcile: over and short swapped',
      ['python3'],
      'invoice-reconcile/scripts/reconcile.py',
      (t) => t.replace('("over" if difference > 0 else "short")', '("short" if difference > 0 else "over")'),
    ],
    [
      'reconcile: the JSON shape check removed',
      ['python3'],
      'invoice-reconcile/scripts/reconcile.py',
      (t) =>
        t
          .replace('not isinstance(data.get("lines"), list)', 'False')
          .replace('or not isinstance(data.get("lines"), list)', 'or False'),
    ],
    [
      'track: three arguments accepted',
      ['sh'],
      'shipment-tracker/scripts/track.sh',
      (t) => t.replace('-ne 2', '-lt 2'),
    ],
    [
      'track: usage error exits 1',
      ['sh'],
      'shipment-tracker/scripts/track.sh',
      (t) => t.replace('exit 2', 'exit 1'),
    ],
    [
      'track: the carrier code is ignored',
      ['sh'],
      'shipment-tracker/scripts/track.sh',
      (t) => t.replace('"^$1 $2 "', '"^[A-Z]* $2 "'),
    ],
    [
      'track: the line anchor is removed',
      ['sh'],
      'shipment-tracker/scripts/track.sh',
      (t) => t.replace('"^$1 $2 "', '"$1 $2 "'),
    ],
    [
      'track: a tracking number matches by its start',
      ['sh'],
      'shipment-tracker/scripts/track.sh',
      (t) => t.replace('"^$1 $2 "', '"^$1 $2"'),
    ],
    [
      'track: an unlisted shipment exits 0',
      ['sh'],
      'shipment-tracker/scripts/track.sh',
      (t) => t.replace('exit 1; }', 'exit 0; }'),
    ],
    [
      'track: the carrier code is matched in any case',
      ['sh'],
      'shipment-tracker/scripts/track.sh',
      (t) => t.replace('grep "', 'grep -i "'),
    ],
    [
      'track: the table is read from the working folder',
      ['sh'],
      'shipment-tracker/scripts/track.sh',
      (t) => t.replace('"$(dirname "$0")/../data/shipments.txt"', 'shipments.txt'),
    ],
  ];

  /** The script at its own place in a scratch tree: a scripts folder, and the data folder it keeps beside it. */
  async function place(path: string, text: string): Promise<string> {
    const dir = await scratch();
    await mkdir(join(dir, 'scripts'));
    const placed = join(dir, 'scripts', path.split('/').at(-1) as string);
    await writeFile(placed, text);
    await chmod(placed, 0o755);
    const skill = dirname(dirname(join(FIXTURE, path)));
    if (existsSync(join(skill, 'data'))) {
      await mkdir(join(dir, 'data'));
      for (const name of await readdir(join(skill, 'data')))
        await writeFile(join(dir, 'data', name), await readFile(join(skill, 'data', name)));
    }
    return placed;
  }

  /** Every fixture of the script, run on `placed`: the problems found, per fixture. */
  async function fixtureProblems(path: string, interpreter: readonly string[], placed: string) {
    return Promise.all(
      ((await config()).scripts[path]?.fixtures ?? []).map(async (fixture) =>
        problems(fixture, await runFixture([...interpreter], placed, fixture)),
      ),
    );
  }

  // The control of every mutant below: the unmutated script, placed the same way, passes all its fixtures. A
  // mutant that dies in a harness that breaks the original too proves nothing.
  it.each(SCRIPTS)('%s, placed as a mutant is, passes every fixture unmutated', async (path, interpreter) => {
    const placed = await place(path, await readFile(join(FIXTURE, path), 'utf8'));
    expect(await fixtureProblems(path, interpreter, placed)).toEqual(
      ((await config()).scripts[path]?.fixtures ?? []).map(() => []),
    );
  });

  it.each(MUTANTS)('turns %s red', async (_label, interpreter, tail, mutate) => {
    const path = `.claude/skills/${tail}`;
    const original = await readFile(join(FIXTURE, path), 'utf8');
    const text = mutate(original);
    expect(text, 'the mutation changed the script').not.toBe(original);
    const results = await fixtureProblems(path, interpreter, await place(path, text));
    expect(results.some((found) => found.length > 0)).toBe(true);
  });
});
