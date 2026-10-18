import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { acmeAdapter } from '../../core/test/runner/support';
import { type CampaignDeps, defaultDeps } from '../src/commands/campaign';
import { type CiSummary, NOT_RUN_EXIT, notRunSpecs, registerCiCommand } from '../src/commands/ci';
import { type Io, main } from '../src/index';

/** Fictional data only: the Acme Telecom example agent. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONVERSATIONS = 'examples/acme/specs/conversations';
const SLOW = 120_000;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function cli(argv: string[], deps?: Partial<CampaignDeps>) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  if (!deps) return { code: await main(argv, io), out, err };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerCiCommand(program, io, (exit) => (code = exit), { ...defaultDeps, ...deps });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: cause.exitCode === 0 ? 0 : 2, out, err };
    throw cause;
  }
  return { code, out, err };
}

describe('driftbench ci with blocks not run', () => {
  /** The candidate: the Acme agent on an adapter that cannot force a tool result (no toolStubs). */
  const noStubs: Partial<CampaignDeps> = {
    adapterFor: async () => acmeAdapter({ capabilities: { toolStubs: false } }),
  };

  async function setUp() {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-ci-not-run-'));
    made.push(dir);
    const base = join(dir, 'base.db');
    const baseline = await cli([
      'campaign',
      'run',
      CONVERSATIONS,
      '--target',
      'function:acme-sales',
      '--store',
      base,
      '--json',
    ]);
    expect(baseline.code).toBe(0);
    return { dir, base };
  }

  const args = (base: string, dir: string, out: string) => [
    'ci',
    '--specs',
    CONVERSATIONS,
    '--target',
    'function:acme-sales',
    '--baseline',
    base,
    '--store',
    join(dir, `${out}.db`),
    '--margin',
    '50',
    '--out',
    join(dir, `${out}.json`),
  ];

  it(
    'fails with exit 3 and the verdict NOT RUN when a gating spec has a block not run, never parity',
    async () => {
      const { dir, base } = await setUp();
      const result = await cli(args(base, dir, 'strict'), noStubs);
      expect(result.err).toBe('');
      expect(result.code).toBe(NOT_RUN_EXIT);
      expect(result.out).toContain('Verdict: NOT RUN. Exit 3.');
      expect(result.out).toContain('Not run (--max-not-run 0): acme-tool-failure');
      const summary = JSON.parse(await readFile(join(dir, 'strict.json'), 'utf8')) as CiSummary;
      expect(summary.verdict).toBe('not-run');
      expect(summary.exitCode).toBe(3);
      expect(summary.notRun?.over).toContain('acme-tool-failure');
      expect(summary.unpaired.find((entry) => entry.unit.startsWith('acme-tool-failure'))?.reason).toContain(
        'not measured in the candidate',
      );
      // The not-run spec is left out of the comparison: it never reads as a regression.
      expect(summary.regressed).not.toContain('acme-tool-failure · F');
      // 0 regressed and 1 spec not run: the not-run verdict stands, exit 3.
      expect(summary.regressed).toEqual([]);
      expect(summary.notRun?.over).toEqual(['acme-tool-failure']);
    },
    SLOW,
  );

  it(
    'a threshold of 1 tolerates them: the gate decides on the specs that ran, and still prints the not-run ones',
    async () => {
      const { dir, base } = await setUp();
      const result = await cli([...args(base, dir, 'loose'), '--max-not-run', '1'], noStubs);
      expect(result.code).toBe(0);
      expect(result.out).toContain('Verdict: PARITY. Exit 0.');
      const summary = JSON.parse(await readFile(join(dir, 'loose.json'), 'utf8')) as CiSummary;
      expect(summary.notRun?.over).toEqual([]);
      expect(summary.notRun?.specs.map((spec) => spec.specId)).toContain('acme-tool-failure');
    },
    SLOW,
  );

  // The fault skips the recap, so the order conversations regress; the specs tagged flow:new-home run on the ops
  // agent through the process adapter, which cannot force a tool result, so the tool failure spec is not run.
  const regressing = ['--target', 'fault:x3-skips-recap', '--faults', 'examples/acme/faults'];
  const route = ['--route', 'flow:new-home=process:acme-ops'];

  it(
    'a regression wins over blocks not run: 5 regressed and 1 spec not run give regression, exit 1, the goldens named',
    async () => {
      const { dir, base } = await setUp();
      const result = await cli([...args(base, dir, 'both'), ...regressing, ...route]);
      expect(result.err).toBe('');
      expect(result.code).toBe(1);
      expect(result.out).toContain('Verdict: REGRESSION. Exit 1.');
      const summary = JSON.parse(await readFile(join(dir, 'both.json'), 'utf8')) as CiSummary;
      expect(summary.regressed).toHaveLength(5);
      expect(summary.notRun?.over).toEqual(['acme-tool-failure']);
      expect(summary.verdict).toBe('regression');
      expect(summary.exitCode).toBe(1);
      expect(summary.reasons[0]).toBe(`5 goldens regressed: ${summary.regressed.join(', ')}`);
      expect(summary.reasons.some((reason) => reason.includes('--max-not-run 0: acme-tool-failure'))).toBe(
        true,
      );
      expect(result.out).toContain('Not run (--max-not-run 0): acme-tool-failure');
    },
    SLOW,
  );

  it(
    'the verdict does not depend on an unrelated spec not run: the same regression with and without it',
    async () => {
      const { dir, base } = await setUp();
      // The same suite without the spec the candidate cannot run.
      const without = join(dir, 'without');
      await mkdir(without);
      for (const name of await readdir(join(ROOT, CONVERSATIONS)))
        if (name !== 'tool-failure.yaml')
          await copyFile(join(ROOT, CONVERSATIONS, name), join(without, name));
      const withSpec = await cli([...args(base, dir, 'with'), ...regressing, ...route]);
      const withoutSpec = await cli([
        ...args(base, dir, 'without').map((arg) => (arg === CONVERSATIONS ? without : arg)),
        ...regressing,
        ...route,
      ]);
      const a = JSON.parse(await readFile(join(dir, 'with.json'), 'utf8')) as CiSummary;
      const b = JSON.parse(await readFile(join(dir, 'without.json'), 'utf8')) as CiSummary;
      expect(b.notRun).toBeUndefined();
      expect([withSpec.code, a.verdict, a.regressed]).toEqual([withoutSpec.code, b.verdict, b.regressed]);
      expect(a.verdict).toBe('regression');
      expect(withSpec.code).toBe(1);
    },
    SLOW,
  );

  it(
    'a regression wins over a failing aggregate too, and the reasons name the goldens and the aggregate',
    async () => {
      const { dir, base } = await setUp();
      const result = await cli([
        ...args(base, dir, 'aggregate'),
        ...regressing,
        ...route,
        '--aggregate',
        'pass-rate:>=0.99',
      ]);
      expect(result.code).toBe(1);
      const summary = JSON.parse(await readFile(join(dir, 'aggregate.json'), 'utf8')) as CiSummary;
      expect(summary.verdict).toBe('regression');
      expect(summary.reasons[0]).toMatch(/^5 goldens regressed: /);
      expect(summary.reasons.some((reason) => reason.startsWith('aggregate pass-rate fails'))).toBe(true);
      expect(summary.reasons.some((reason) => reason.includes('--max-not-run 0: acme-tool-failure'))).toBe(
        true,
      );
    },
    SLOW,
  );

  it(
    'goldens that flipped while compare calls the change noise are no regression: with a spec not run and a failing aggregate, the verdict is not-run, exit 3',
    async () => {
      const { dir, base } = await setUp();
      // The identity control changes nothing, but the flow:new-home conversations run on the ops agent: two of
      // them flip, one is not run. At a 99 point margin compare shows parity.
      const result = await cli([
        ...args(base, dir, 'noise'),
        '--target',
        'fault:control-sales-identity',
        '--faults',
        'examples/acme/faults',
        ...route,
        '--margin',
        '99',
        '--aggregate',
        'pass-rate:>=0.99',
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(3);
      const summary = JSON.parse(await readFile(join(dir, 'noise.json'), 'utf8')) as CiSummary;
      expect(summary.regressed.length).toBeGreaterThan(0);
      expect(summary.verdict).toBe('not-run');
      expect(summary.reasons.some((reason) => reason.includes('regressed'))).toBe(false);
    },
    SLOW,
  );

  it('refuses a threshold outside 0 to 1 as bad input', async () => {
    const result = await cli([...args('base.db', ROOT, 'bad'), '--max-not-run', '1.5']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('--max-not-run takes a share from 0 to 1');
  });
});

describe('the driftbench ci GitHub Action', () => {
  it(
    'passes max-not-run to ci: a bad share exits 2 before any campaign loads',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'driftbench-action-not-run-'));
      made.push(dir);
      const result = spawnSync('bash', [join(ROOT, 'action/run.sh')], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: join(dir, 'output.txt'),
          INPUT_SPECS: CONVERSATIONS,
          INPUT_TARGET: 'function:acme-sales',
          INPUT_BASELINE: join(dir, 'missing.db'),
          INPUT_STORE: join(dir, 'cand.db'),
          INPUT_MAX_NOT_RUN: '2',
          INPUT_REPORT_PATH: join(dir, 'report.json'),
          INPUT_DRIFTBENCH: `${join(ROOT, 'node_modules/.bin/tsx')} packages/cli/src/bin.ts`,
        },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('--max-not-run takes a share from 0 to 1, not "2"');
    },
    SLOW,
  );
});

describe('notRunSpecs', () => {
  const run = (specId: string, statuses: Array<'pass' | 'not_run'>, carried = false) =>
    ({
      specId,
      mode: 'F',
      ...(carried ? { carried: {} } : {}),
      blocks: statuses.map((status, index) => ({
        index,
        pass: status === 'pass',
        ...(status === 'not_run'
          ? {
              status,
              notRun: { kind: 'unsupported', layer: '5 world', check: 'capability', expected: 'e', got: 'g' },
            }
          : {}),
      })),
    }) as never;

  it('counts fresh blocks per spec and flags the shares above the threshold', () => {
    const gate = notRunSpecs(
      [run('a', ['pass', 'not_run']), run('b', ['pass', 'pass']), run('c', ['not_run'], true)],
      0.4,
    );
    expect(gate).toEqual({
      threshold: 0.4,
      specs: [{ specId: 'a', notRun: 1, blocks: 2, share: 0.5, first: 'F block 1: capability, g' }],
      over: ['a'],
    });
    expect(notRunSpecs([run('a', ['pass', 'not_run'])], 0.5)?.over).toEqual([]);
    expect(notRunSpecs([run('b', ['pass'])], 0)).toBeUndefined();
  });
});
