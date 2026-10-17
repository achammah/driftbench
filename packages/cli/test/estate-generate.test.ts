import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpecText } from '@agent-nexus/driftbench-core';
import { REPLAY_CUSTOM_CHECKS } from '@agent-nexus/driftbench-generate';
import { beforeAll, describe, expect, it } from 'vitest';
import { replayRegistry } from '../src/commands/replay';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const MAP = join(FIXTURE, 'approved.yaml');
const PLAN = join(ROOT, 'packages/generate/test/estate/fixtures/plan.yaml');
const SESSIONS = join(FIXTURE, 'sessions');
const NAMES = ['weekly-clean', 'weekly-skill-skipped', 'weekly-gate-violated'];

async function run(argv: string[], cwd = ROOT) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(dir, full));
    }
  };
  await walk(dir);
  return out.sort();
}

function generate(out: string, ...extra: string[]) {
  return run(['estate', 'generate', '--map', MAP, '--plan', PLAN, '--out', out, ...extra]);
}

describe('driftbench estate generate', () => {
  let out: string;
  let first: Awaited<ReturnType<typeof run>>;

  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    first = await generate(out);
  }, 60_000);

  it('writes the suite and its report, and exits 0 once every row gave complete specs', async () => {
    expect(first.err).toBe('');
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/total\s+44\s+44\s+0/);
    expect(first.out).toContain('Replay: 12 specs aligned to sessions, 9 planned to pass, 3 to fail.');
    const written = await files(out);
    expect(written).toContain('estate-generate-report.json');
    expect(written.filter((path) => path.startsWith('specs/'))).toHaveLength(43);
    expect(written.filter((path) => path.startsWith('static/'))).toEqual([
      'static/invariant/estate.p32.json',
    ]);
    expect(written.filter((path) => path.startsWith('incomplete/'))).toHaveLength(0);
    expect(written).toContain('run-order.txt');
  });

  it('finds the phrase bank and the session index beside the map', async () => {
    const report = JSON.parse(await readFile(join(out, 'estate-generate-report.json'), 'utf8'));
    expect(report.phrases.path).toBe(relative(out, join(FIXTURE, 'phrases.yaml')));
    expect(report.sessions).toEqual({ path: relative(out, join(SESSIONS, 'index.yaml')), sessions: 6 });
  });

  it('gives replay specs that pass and fail over the three sessions as planned', async () => {
    await replayAsPlanned(join(out, 'specs/replay'));
  }, 60_000);

  async function replayAsPlanned(suite: string): Promise<void> {
    const replay = await run([
      'replay',
      ...NAMES.map((name) => join(SESSIONS, `${name}.jsonl`)),
      '--decisions',
      ...NAMES.map((name) => join(SESSIONS, `${name}.decisions.jsonl`)),
      '--steps',
      ...NAMES.map((name) => join(SESSIONS, `${name}.steps.jsonl`)),
      '--suite',
      suite,
      '--json',
    ]);
    expect(replay.err).toBe('');
    expect(replay.code).toBe(1);
    const result = JSON.parse(replay.out) as {
      runs: Array<{ spec: string; session: string; aligned: string; pass: boolean; failing: string[] }>;
      notes: string[];
    };
    expect(result.notes).toEqual([]);
    expect(result.runs).toHaveLength(12);
    const planned = new Map<string, string>();
    for (const path of (await files(join(out, 'specs/replay'))).map((file) =>
      join(out, 'specs/replay', file),
    )) {
      const loaded = parseSpecText(await readFile(path, 'utf8'), 'yaml', path);
      if (!loaded.ok) throw new Error(`${path} is invalid`);
      const metadata = loaded.spec.metadata as {
        estate: { expect: string; session: string };
        replay: unknown;
      };
      planned.set(loaded.spec.id, metadata.estate.expect);
      expect(metadata.replay).toEqual({ session: metadata.estate.session, from_block: 0 });
    }
    for (const run of result.runs) {
      expect(run.aligned, run.spec).toBe('metadata');
      expect(run.pass ? 'pass' : 'fail', run.spec).toBe(planned.get(run.spec));
    }
    const failing = Object.fromEntries(
      result.runs.filter((entry) => !entry.pass).map((entry) => [entry.spec, entry.failing]),
    );
    expect(failing).toEqual({
      'estate.p01.weekly-skill-skipped': ['block 0: skills.weekly-report'],
      // A rule written in a skill's file is tested with that skill loaded: skipping the skill fails it too.
      'estate.p03.weekly-skill-skipped': ['block 0: skills.weekly-report'],
      'estate.p02.weekly-gate-violated': ['block 0: custom.ordered.Read.Edit'],
    });
  }

  it('lints the complete specs clean', async () => {
    const lint = await run(['spec', 'lint', join(out, 'specs'), '--strict']);
    expect(lint.code).toBe(0);
    expect(lint.out).toContain('Checked 43 specs: 43 valid, 0 invalid, 0 warnings.');
  });

  it('refuses an earlier output without --force, and replaces it with --force', async () => {
    const again = await generate(out);
    expect(again.code).toBe(2);
    expect(again.err).toMatch(/already exists: an earlier run wrote this folder/);
    await writeFile(join(out, 'keep.txt'), 'not ours');
    await mkdir(join(out, 'unit', 'guard_positive'), { recursive: true });
    await writeFile(join(out, 'unit', 'guard_positive', 'unit.stale.json'), '{}');
    const forced = await generate(out, '--force');
    expect(forced.code).toBe(0);
    expect(await files(out)).toContain('keep.txt');
    expect(await files(out)).not.toContain('unit/guard_positive/unit.stale.json');
  });

  it('refuses a plan made from another map and writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    const plan = (await readFile(PLAN, 'utf8')).replace(/^mapHash: .*$/m, `mapHash: ${'f'.repeat(64)}`);
    await writeFile(join(dir, 'plan.yaml'), plan);
    const result = await run([
      'estate',
      'generate',
      '--map',
      MAP,
      '--plan',
      join(dir, 'plan.yaml'),
      '--out',
      join(dir, 'out'),
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/plan\.mapHash {2}the plan was made from map ffffffffffff/);
    expect(await files(dir)).toEqual(['plan.yaml']);
  });

  it('refuses a bad seed, an invalid plan and a missing phrase bank', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    expect((await generate(join(dir, 'a'), '--seed', 'one')).code).toBe(2);
    await writeFile(join(dir, 'plan.yaml'), 'version: 1\nrows: []\n');
    const invalid = await run([
      'estate',
      'generate',
      '--map',
      MAP,
      '--plan',
      join(dir, 'plan.yaml'),
      '--out',
      join(dir, 'b'),
    ]);
    expect(invalid.code).toBe(2);
    expect(invalid.err).toMatch(/the plan cannot be read or is invalid/);
    const missing = await generate(join(dir, 'c'), '--phrases', join(dir, 'nowhere.yaml'));
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/the phrase bank cannot be read or is invalid/);
  });

  it('leaves replay rows waiting for a recorded session when no session index is found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    await copyFile(MAP, join(dir, 'approved.yaml'));
    await copyFile(join(FIXTURE, 'phrases.yaml'), join(dir, 'phrases.yaml'));
    const result = await run([
      'estate',
      'generate',
      '--map',
      join(dir, 'approved.yaml'),
      '--plan',
      PLAN,
      '--out',
      join(dir, 'out'),
      '--json',
    ]);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out);
    expect(report.sessions).toBeNull();
    expect(report.perMode.replay).toEqual({ rows: 4, specs: 4, complete: 0, incomplete: 4 });
    expect(
      report.gaps.find((entry: { marker: string }) => entry.marker === 'needs-recorded-session').specs,
    ).toBe(4);
  });

  it('writes every ask by code when no phrase bank lies beside the map, and waits for one with --no-fallback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    await copyFile(MAP, join(dir, 'approved.yaml'));
    const args = ['estate', 'generate', '--map', join(dir, 'approved.yaml'), '--plan', PLAN];
    const result = await run([...args, '--out', join(dir, 'out'), '--json']);
    expect(result.err).toBe('');
    const report = JSON.parse(result.out);
    expect(report.phrases).toMatchObject({ path: '(none)', situations: 0 });
    expect(report.sources.asks.bank).toBe(0);
    expect(report.sources.asks.code).toBeGreaterThan(20);
    expect(report.invalid).toEqual([]);
    expect(report.lint).toEqual([]);
    const strict = await run([...args, '--out', join(dir, 'strict'), '--no-fallback', '--json']);
    expect(strict.code).toBe(1);
    const waiting = JSON.parse(strict.out);
    expect(waiting.sources.asks.code).toBe(0);
    expect(waiting.gaps.map((entry: { marker: string }) => entry.marker)).toContain('needs-approved-phrase');
  });

  it('judges no domain predicate with --no-judge: one no code checks waits for a registered check', async () => {
    const plan = join(ROOT, 'packages/generate/test/estate/fixtures/planner-plan.approved.yaml');
    const waiting = async (...extra: string[]) => {
      const dir = await mkdtemp(join(tmpdir(), 'estate-generate-judge-'));
      const result = await run([
        'estate',
        'generate',
        '--map',
        MAP,
        '--plan',
        plan,
        '--out',
        join(dir, 'out'),
        '--json',
        ...extra,
      ]);
      expect(result.err).toBe('');
      const report = JSON.parse(result.out) as { gaps: Array<{ marker: string; specs: number }> };
      return report.gaps.find((entry) => entry.marker === 'needs-registered-check')?.specs ?? 0;
    };
    const judged = await waiting();
    const unjudged = await waiting('--no-judge');
    expect(unjudged).toBeGreaterThan(judged);
  }, 120_000);

  it('puts the specs of the focus atoms first in the run order, then guards, gates and invariants', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    const atom = 'subagent.route-planner.helper-route-planner';
    await writeFile(join(dir, 'focus.txt'), `# the atoms a mutant targets\n${atom}\n`);
    const result = await generate(join(dir, 'out'), '--focus', join(dir, 'focus.txt'));
    expect(result.out).toMatch(
      /Focus: [1-9]\d* complete specs name one of the 1 focus atoms; 0 focus atoms have none\./,
    );
    const order = (await readFile(join(dir, 'out', 'run-order.txt'), 'utf8')).trim().split('\n');
    const kinds = await Promise.all(
      order.map(async (path) => {
        const loaded = parseSpecText(await readFile(join(dir, 'out', path), 'utf8'), 'yaml', path);
        const estate = loaded.ok
          ? (loaded.spec.metadata?.estate as { atoms?: string[] } | undefined)
          : undefined;
        const atoms = estate?.atoms ?? [];
        if (atoms.includes(atom)) return 0;
        return atoms.some((id) => /^(guard|gate|invariant)\./.test(id)) ? 1 : 2;
      }),
    );
    expect(kinds[0]).toBe(0);
    expect(kinds).toEqual([...kinds].sort());
    expect(new Set(kinds)).toEqual(new Set([0, 1, 2]));
    await writeFile(join(dir, 'bad.txt'), 'no.such.atom\n');
    const bad = await generate(join(dir, 'bad'), '--focus', join(dir, 'bad.txt'));
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('no.such.atom');
  });
});

describe('the custom checks the generator writes', () => {
  it('are all registered by the replay and live runners', () => {
    const names = replayRegistry().names();
    for (const name of REPLAY_CUSTOM_CHECKS) expect(names, name).toContain(name);
  });
});

describe('estate generate with no phrase bank (bench defect D7)', () => {
  const CASES = join(ROOT, 'examples/estates/reader-cases');

  it('generates with an empty bank when none sits beside the map, and refuses a named one that is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-nobank-'));
    await copyFile(join(CASES, 'approved.yaml'), join(dir, 'approved.yaml'));
    expect((await run(['estate', 'plan', 'approved.yaml', '--out', 'plan.yaml'], dir)).code).toBe(0);
    expect((await run(['estate', 'plan', 'approve', 'plan.yaml', '--all'], dir)).code).toBe(0);
    const coded = await run(
      ['estate', 'generate', '--map', 'approved.yaml', '--plan', 'plan.yaml', '--out', 'coded'],
      dir,
    );
    expect(coded.err).toBe('');
    expect(coded.out).toContain('No phrase bank at phrases.yaml: code writes every ask from the atoms.');
    const result = await run(
      [
        'estate',
        'generate',
        '--map',
        'approved.yaml',
        '--plan',
        'plan.yaml',
        '--out',
        'gen',
        '--no-fallback',
      ],
      dir,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      'No phrase bank at phrases.yaml: generating with an empty one; each live row names the phrase it needs.',
    );
    expect(result.out).toMatch(/needs-approved-phrase\s+\d+ specs/);
    const report = JSON.parse(await readFile(join(dir, 'gen', 'estate-generate-report.json'), 'utf8'));
    expect(report.summary.specs).toBeGreaterThan(0);

    const hash = /^hash: (\S+)$/m.exec(await readFile(join(dir, 'approved.yaml'), 'utf8'))?.[1];
    await writeFile(
      join(dir, 'phrases.yaml'),
      `version: 1\nestate: reader-cases\nmapHash: ${hash}\nworkspaces: []\nsituations: []\n`,
    );
    const empty = await run(
      ['estate', 'generate', '--map', 'approved.yaml', '--plan', 'plan.yaml', '--out', 'gen', '--force'],
      dir,
    );
    expect(empty.err).toBe('');
    expect(empty.code).toBe(1);

    const named = await run(
      [
        'estate',
        'generate',
        '--map',
        'approved.yaml',
        '--plan',
        'plan.yaml',
        '--out',
        'g2',
        '--phrases',
        'none.yaml',
      ],
      dir,
    );
    expect(named.code).toBe(2);
    expect(named.err).toContain('the phrase bank cannot be read or is invalid');
  }, 120_000);
});

describe('estate generate on a map copied away from its estate', () => {
  it('checks reads against the files the map knows, not against the folder the copy sits in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-away-'));
    const estate = join(dir, 'estate');
    await mkdir(join(estate, '.claude/skills/stock-sheet/references'), { recursive: true });
    await writeFile(
      join(estate, 'CLAUDE.md'),
      '# Depot assistant\n\n## Routing\n\n| When the user wants to | Load |\n|---|---|\n| update a stock sheet | `stock-sheet` |\n',
    );
    await writeFile(
      join(estate, '.claude/skills/stock-sheet/SKILL.md'),
      '---\nname: stock-sheet\ndescription: Update a stock sheet with a new count. Use when the user asks to record a stock count.\n---\n\n1. Read `references/count-rules.md` before you change any sheet.\n2. Write the new count on the sheet.\n',
    );
    await writeFile(join(estate, '.claude/skills/stock-sheet/references/count-rules.md'), 'Count twice.\n');
    expect((await run(['estate', 'scan', estate, '--no-model', '--out', 'map.yaml'], estate)).code).toBe(0);
    expect((await run(['estate', 'approve', 'map.yaml', '--all'], estate)).code).toBe(0);
    expect((await run(['estate', 'plan', 'map.yaml', '--out', 'plan.yaml'], estate)).code).toBe(0);
    expect((await run(['estate', 'plan', 'approve', 'plan.yaml', '--all'], estate)).code).toBe(0);
    const away = join(dir, 'away');
    await mkdir(away);
    // The copy keeps `root: .`, which now names a folder holding the map and the plan only.
    await copyFile(join(estate, 'map.yaml'), join(away, 'map.yaml'));
    await copyFile(join(estate, 'plan.yaml'), join(away, 'plan.yaml'));
    const gaps = async (folder: string) => {
      const result = await run(
        ['estate', 'generate', '--map', 'map.yaml', '--plan', 'plan.yaml', '--out', 'gen'],
        folder,
      );
      const report = JSON.parse(await readFile(join(folder, 'gen', 'estate-generate-report.json'), 'utf8'));
      return { out: result.out, markers: (report.gaps ?? []).map((gap: { marker: string }) => gap.marker) };
    };
    const home = await gaps(estate);
    const copied = await gaps(away);
    expect(home.markers).not.toContain('needs-existing-file');
    expect(copied.markers).not.toContain('needs-existing-file');
    expect(copied.out).toContain('holds none of the files the map was read from');
  }, 60_000);
});
