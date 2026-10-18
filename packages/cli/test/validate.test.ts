import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLOORS_FILE,
  ladderVersion,
  readFloors,
  registeredLadders,
  writeFloors,
} from '@agent-nexus/driftbench-validators';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bankLadder,
  journalOf,
  journalRow,
  PASSING_AUDIT,
  plantedLadder,
} from '../../validators/test/support';
import { USAGE_EXIT, type ValidateDeps, validateCommand } from '../src/commands/validate';
import { main } from '../src/index';
import type { Io } from '../src/io';
import { committedFloorRun } from './support/committed-floor';
import { parseFloorExample } from './support/floor-example';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-validate-test-'));
  made.push(dir);
  return dir;
}

function capture(cwd: string) {
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
  return { io, output };
}

async function deps(failOn: number[] = [2]): Promise<ValidateDeps> {
  const root = await temp();
  const { ladder } = plantedLadder(failOn);
  return { ladders: () => ({ planted: ladder }), root };
}

describe('driftbench validate <component>', () => {
  it('exits with the highest level passed', async () => {
    const d = await deps([2]);
    const ok = capture(d.root as string);
    expect(await validateCommand('planted', { seed: '1' }, ok.io, d)).toBe(3);
    const failing = capture(d.root as string);
    expect(await validateCommand('planted', { seed: '2' }, failing.io, d)).toBe(1);
    expect(failing.output.out).toContain('Seed 2, level 2 second (second rung), 2 items:');
  });

  it('writes the report as JSON with --json', async () => {
    const d = await deps([2]);
    const { io, output } = capture(d.root as string);
    expect(await validateCommand('planted', { seed: '2', json: true }, io, d)).toBe(1);
    const report = JSON.parse(output.out);
    expect(report.component).toBe('planted');
    expect(report.level).toBe(1);
    expect(report.seeds[0].failing.items.map((item: { id: string }) => item.id)).toEqual([
      'plant-2-a',
      'plant-2-b',
    ]);
  });

  it('refuses an unknown component and a bad seed with the usage exit code', async () => {
    const d = await deps();
    const unknown = capture(d.root as string);
    expect(await validateCommand('nothing', {}, unknown.io, d)).toBe(USAGE_EXIT);
    expect(unknown.output.err).toContain('Registered: planted.');
    const bad = capture(d.root as string);
    expect(await validateCommand('planted', { seed: 'x' }, bad.io, d)).toBe(USAGE_EXIT);
  });
});

describe('driftbench validate seeds', () => {
  it('reports every seed and exits with the minimum level over them', async () => {
    const d = await deps([3]);
    const { io, output } = capture(d.root as string);
    expect(await validateCommand('planted', { seeds: '1..3' }, io, d)).toBe(1);
    expect(output.out).toContain('Level per seed: 1 = 3, 2 = 3, 3 = 1');
    expect(output.out).toContain('Level of the run: 1 of 3, the minimum over 3 seeds.');
  });

  it('adds the hidden seed from the commit with --hidden, and notes the fallback outside a repository', async () => {
    const d = await deps([]);
    const head = 'abcdef0123456789abcdef0123456789abcdef01';
    const withHead = capture(d.root as string);
    const code = await validateCommand('planted', { seeds: '1..2', hidden: true, json: true }, withHead.io, {
      ...d,
      readHead: () => head,
    });
    expect(code).toBe(3);
    const report = JSON.parse(withHead.output.out);
    expect(report.seeds.map((run: { hidden: boolean }) => run.hidden)).toEqual([false, false, true]);
    expect(report.hiddenSeed).toMatchObject({ source: 'head', head });
    expect(report.seeds[2].seed).toBe(report.hiddenSeed.seed);
    const outside = capture(d.root as string);
    await validateCommand('planted', { hidden: true }, outside.io, {
      ...d,
      readHead: () => {
        throw new Error('fatal: not a git repository');
      },
    });
    expect(outside.output.out).toContain('Note: git rev-parse HEAD failed');
    expect(outside.output.out).toContain('seed hidden');
  });

  it('runs every registered validator with all and exits with the lowest level', async () => {
    const root = await temp();
    const { ladder: low } = plantedLadder([1], 'low');
    const { ladder: high } = plantedLadder([], 'high');
    const { io, output } = capture(root);
    expect(await validateCommand('all', {}, io, { ladders: () => ({ low, high }), root })).toBe(1);
    expect(output.out).toContain('Validator high');
    expect(output.out).toContain('Validator low');
  });
});

/** Expected output comes from the committed floor contract, including historical ladder versions. */
function expectedFloorsLine(root: string): string {
  const file = readFloors(root);
  const registry = registeredLadders();
  const shown = Object.entries(file.floors).map(([component, floor]) => {
    const ladder = registry[component];
    if (!ladder) throw new Error(`floor for unregistered validator ${component}`);
    const version = file.ladderVersion[component];
    if (version === undefined || version > ladderVersion(ladder))
      throw new Error(`floor version ahead of the registered ${component} ladder`);
    return `${component} = ${floor} (ladder version ${version})`;
  });
  return `Floors (${FLOORS_FILE}): ${shown.length ? shown.join(', ') : 'none'}.`;
}

describe('driftbench validate floors', () => {
  it('prints the committed floors and reproduces each documented floor example', async () => {
    const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
    const out: string[] = [];
    const io: Io = { out: (text) => out.push(text), err: () => undefined, cwd: ROOT };
    expect(await main(['validate', 'floors'], io)).toBe(0);
    const line = expectedFloorsLine(ROOT);
    expect(out.join('').trim()).toBe(line);
    for (const page of ['docs/reference/cli.md', 'docs/validators.md']) {
      const prefix = `Floors (${FLOORS_FILE}): `;
      const example = (await readFile(join(ROOT, page), 'utf8'))
        .split('\n')
        .find((text) => text.startsWith(prefix));
      if (!example?.endsWith('.')) throw new Error(`${page}: no floor output example`);
      const fixture = parseFloorExample(example);
      const root = await temp();
      await mkdir(join(root, 'validators'));
      writeFloors(root, fixture);
      expect(expectedFloorsLine(root), page).toBe(example);
      const { io, output } = capture(root);
      expect(await validateCommand('floors', {}, io, { root, ladders: registeredLadders })).toBe(0);
      expect(output.out.trim(), page).toBe(example);
    }
  });

  async function withFloors(floors: Record<string, number>, failOn: number[] = []) {
    const d = await deps(failOn);
    await mkdir(join(d.root as string, 'validators'));
    await writeFile(
      join(d.root as string, 'validators/floors.json'),
      `${JSON.stringify({ version: 1, floors }, null, 2)}\n`,
    );
    return { ...d, readHead: () => 'abcdef0123456789abcdef0123456789abcdef01' };
  }

  it('--check-floor exits 1 below the floor and 0 at or above it', async () => {
    const d = await withFloors({ planted: 2 }, [2]);
    const below = capture(d.root as string);
    expect(await validateCommand('planted', { seeds: '1..2', checkFloor: true }, below.io, d)).toBe(1);
    expect(below.output.out).toContain('Floor: 2. BELOW THE FLOOR.');
    expect(below.output.err).toContain('planted is at level 1, below its floor 2.');
    const holds = capture(d.root as string);
    expect(await validateCommand('planted', { seed: '1', checkFloor: true }, holds.io, d)).toBe(0);
    expect(holds.output.out).toContain('Floor: 2. At or above the floor.');
  });

  it('--raise rewrites the file upward from --json evidence and refuses a lower level', async () => {
    const d = await withFloors({ planted: 1 });
    const run = capture(d.root as string);
    await validateCommand('planted', { seeds: '1..3', hidden: true, json: true }, run.io, d);
    const evidencePath = join(d.root as string, 'evidence.json');
    await writeFile(evidencePath, run.output.out);
    const raised = capture(d.root as string);
    expect(
      await validateCommand(
        'floors',
        { raise: 'planted', evidence: 'evidence.json', ladderVersion: '1' },
        raised.io,
        d,
        '3',
      ),
    ).toBe(0);
    expect(raised.output.out).toContain('for ladder version 1 rises from 1 to 3');
    const file = JSON.parse(await readFile(join(d.root as string, 'validators/floors.json'), 'utf8'));
    expect(file.floors).toEqual({ planted: 3 });
    const lower = capture(d.root as string);
    expect(
      await validateCommand(
        'floors',
        { raise: 'planted', evidence: 'evidence.json', ladderVersion: '1' },
        lower.io,
        d,
        '2',
      ),
    ).toBe(1);
    expect(lower.output.err).toContain('Refused: The floor of planted is 3; it only rises, so 2 is refused.');
    expect(
      JSON.parse(await readFile(join(d.root as string, 'validators/floors.json'), 'utf8')).floors,
    ).toEqual({
      planted: 3,
    });
  });
});

describe('driftbench validate loop files', () => {
  it('--journal appends a valid row, writes the handover level table, and refuses a bad row', async () => {
    const d = await deps();
    const root = d.root as string;
    await writeFile(join(root, 'row1.json'), JSON.stringify(journalRow(0)));
    const ok = capture(root);
    expect(await validateCommand('planted', { journal: 'row1.json' }, ok.io, d)).toBe(0);
    expect(ok.output.out).toContain('Appended iteration 0 to validators/planted/journal.jsonl');
    const handover = await readFile(join(root, 'validators/planted/HANDOVER.md'), 'utf8');
    expect(handover).toContain('| 1 | 3 |\n| hidden | 3 |');
    expect(await readFile(join(root, 'validators/planted/research.md'), 'utf8')).toContain('# Research');
    const check = capture(root);
    expect(await validateCommand('planted', { checkHandover: true }, check.io, d)).toBe(0);
    await writeFile(join(root, 'bad.json'), JSON.stringify(journalRow(1, { result: 'lowered' })));
    const bad = capture(root);
    expect(await validateCommand('planted', { journal: 'bad.json' }, bad.io, d)).toBe(1);
    expect(bad.output.err).toContain('result: the level moved, so result is raised');
    const lines = (await readFile(join(root, 'validators/planted/journal.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('--check-handover exits 1 on a missing handover and on a table the journal contradicts', async () => {
    const d = await deps();
    const root = d.root as string;
    const missing = capture(root);
    expect(await validateCommand('planted', { checkHandover: true }, missing.io, d)).toBe(1);
    expect(missing.output.err).toContain('validators/planted/HANDOVER.md is missing');
    await writeFile(join(root, 'row1.json'), JSON.stringify(journalRow(0)));
    await validateCommand('planted', { journal: 'row1.json' }, capture(root).io, d);
    const path = join(root, 'validators/planted/HANDOVER.md');
    await writeFile(path, (await readFile(path, 'utf8')).replace('| hidden | 3 |', '| hidden | 1 |'));
    const stale = capture(root);
    expect(await validateCommand('planted', { checkHandover: true }, stale.io, d)).toBe(1);
    expect(stale.output.err).toContain('the level table says 1=3, hidden=1');
  });

  it('--brief prints EXECUTOR.md with the live state; --fresh leaves out the hypotheses', async () => {
    const d = await deps([1]);
    const root = d.root as string;
    await mkdir(join(root, 'validators'), { recursive: true });
    await writeFile(
      join(root, 'validators/EXECUTOR.md'),
      '# Executor instruction\n\nDrive <component> to 100 percent.\n',
    );
    await writeFile(join(root, 'row1.json'), JSON.stringify(journalRow(0)));
    await validateCommand('planted', { journal: 'row1.json' }, capture(root).io, d);
    const brief = capture(root);
    const head = 'abcdef0123456789abcdef0123456789abcdef01';
    expect(await validateCommand('planted', { brief: true }, brief.io, { ...d, readHead: () => head })).toBe(
      0,
    );
    expect(brief.output.out).toContain('at commit abcdef012345');
    expect(brief.output.out).toContain('Seed 1, level 2 second (second rung), 2 items:');
    expect(brief.output.out).toContain('"hypothesis"');
    expect(brief.output.out).toContain('## Hypotheses tried');
    expect(brief.output.out).toContain('Drive planted to 100 percent.');
    const fresh = capture(root);
    expect(
      await validateCommand('planted', { brief: true, fresh: true }, fresh.io, {
        ...d,
        readHead: () => head,
      }),
    ).toBe(0);
    expect(fresh.output.out).not.toContain('## Hypotheses tried');
    expect(fresh.output.out).not.toContain('"hypothesis"');
    const usage = capture(root);
    expect(await validateCommand('planted', { fresh: true }, usage.io, d)).toBe(USAGE_EXIT);
  });
});

describe('driftbench validate protect', () => {
  it('exits 1 when an exec/ branch changes a protected file, 0 otherwise', async () => {
    const d = await deps();
    const changed = () => ['packages/validators/src/ladders/stats.ts', 'packages/stats/src/intervals.ts'];
    const refused = capture(d.root as string);
    expect(
      await validateCommand('protect', { branch: 'exec/stats', base: 'origin/main' }, refused.io, {
        ...d,
        changedFiles: changed,
      }),
    ).toBe(1);
    expect(refused.output.err).toContain('  packages/validators/src/ladders/stats.ts\n');
    expect(refused.output.err).not.toContain('intervals.ts');
    const lane = capture(d.root as string);
    expect(
      await validateCommand('protect', { branch: 'lane/validators', base: 'origin/main' }, lane.io, {
        ...d,
        changedFiles: changed,
      }),
    ).toBe(0);
    const clean = capture(d.root as string);
    expect(
      await validateCommand('protect', { branch: 'exec/stats', base: 'origin/main' }, clean.io, {
        ...d,
        changedFiles: () => ['packages/stats/src/intervals.ts'],
      }),
    ).toBe(0);
    expect(clean.output.out).toContain('none of them protected');
    const broken = capture(d.root as string);
    expect(
      await validateCommand('protect', { branch: 'exec/stats', base: 'origin/nope' }, broken.io, {
        ...d,
        changedFiles: () => {
          throw new Error('fatal: bad revision');
        },
      }),
    ).toBe(USAGE_EXIT);
    expect(await validateCommand('protect', {}, capture(d.root as string).io, d)).toBe(USAGE_EXIT);
  });
});

describe('driftbench validate through main', () => {
  const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

  async function run(argv: string[], cwd = ROOT) {
    const { io, output } = capture(cwd);
    const code = await main(argv, io);
    return { code, ...output };
  }

  it('runs the registered stats ladder and exits with its level', async () => {
    const result = await run(['validate', 'stats', '--seed', '1']);
    const floors = JSON.parse(await readFile(join(ROOT, 'validators/floors.json'), 'utf8')) as {
      floors: Record<string, number>;
    };
    expect(result.code).toBeGreaterThanOrEqual(floors.floors.stats as number);
    expect(result.out).toContain('Validator stats');
    expect(result.out).toMatch(
      /1\s+reference values\s+fixture groups matching scipy and numpy \/ groups\s+>= 1\s+1 pass/,
    );
    expect(result.out).toContain(`Level of the run: ${result.code} of 7, the minimum over 1 seed.`);
  }, 600_000);

  // One test per registered ladder, so each has its own time and a slow ladder is named. The validators
  // workflow also runs `validate all --seeds 1..3 --hidden --check-floor`, which checks the floors file as a whole.
  it.for(Object.keys(registeredLadders()))(
    'holds the committed floor of the %s ladder',
    { timeout: 600_000 },
    async (component, context) => {
      const ladder = registeredLadders()[component];
      if (!ladder) throw new Error(`Missing registered ladder ${component}`);
      const { floor, run } = await committedFloorRun(ladder, readFloors(ROOT), ROOT);
      if (!run) context.skip(`No floor applies to ${component} version ${ladder.version}`);
      expect(run?.level).toBeGreaterThanOrEqual(floor);
    },
  );

  it('holds the committed handovers, as CI checks them', async () => {
    const handover = await run(['validate', 'all', '--check-handover']);
    expect(handover.code).toBe(0);
    expect(handover.out).toContain('validators/stats/HANDOVER.md: every section present');
    expect(handover.out).toContain('validators/estate/HANDOVER.md: every section present');
  }, 60_000);

  it('prints the stats brief from the real executor instruction', async () => {
    const result = await run(['validate', 'stats', '--brief', '--fresh']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('# Brief: validator stats (fresh)');
    expect(result.out).toContain(
      'You drive one validator to 100 percent. The validator is `driftbench validate stats`.',
    );
    expect(result.out).toContain('validators/stats/HANDOVER.md');
  }, 600_000);

  it('parses floors --raise <component> <level> and refuses a level below the committed floor', async () => {
    const stats = registeredLadders().stats;
    if (!stats) throw new Error('the statistics ladder is not registered');
    const version = String(ladderVersion(stats));
    const result = await run([
      'validate',
      'floors',
      '--raise',
      'stats',
      '1',
      '--ladder-version',
      version,
      '--evidence',
      'validators/stats/HANDOVER.md',
    ]);
    expect(result.code).toBe(64);
    expect(result.err).toContain('Cannot read the evidence');
    const refused = await run([
      'validate',
      'floors',
      '--raise',
      'nothing',
      '1',
      '--ladder-version',
      version,
      '--evidence',
      'x.json',
    ]);
    expect(refused.code).toBe(64);
    expect(refused.err).toContain('No validator is registered for "nothing"');
    expect((await run(['validate', 'floors'])).out.trim()).toBe(expectedFloorsLine(ROOT));
  });
});

describe('driftbench validate --items and --hardness', () => {
  it('--items lists the whole bank per family and tier from the same run, each level once per seed', async () => {
    const root = await temp();
    const { ladder, calls } = bankLadder([2]);
    const d: ValidateDeps = { ladders: () => ({ banked: ladder }), root };
    const { io, output } = capture(root);
    expect(await validateCommand('banked', { seeds: '1..2', items: true }, io, d)).toBe(0);
    expect(calls).toEqual({ core: 2, deep: 2 });
    expect(output.out).toContain('Level per seed: 1 = 1, 2 = 0');
    expect(output.out).toContain('Bank of banked: 10 items in 3 families, 8 pass on every seed (score 0.8).');
    expect(output.out).toContain(
      'Family gamma: 4 items, 1 failing, 1 distinct failing causes; per tier 2: 1, 3: 2, 5: 1',
    );
    const json = capture(root);
    await validateCommand('banked', { seeds: '1..2', items: true, json: true }, json.io, d);
    const report = JSON.parse(json.output.out);
    expect(report.ladderVersion).toBe(2);
    expect(report.bank).toMatchObject({
      size: 10,
      passing: 8,
      failingByFamily: { alpha: 1, beta: 0, gamma: 1 },
    });
    const usage = capture(root);
    expect(await validateCommand('banked', { items: true, brief: true }, usage.io, d)).toBe(USAGE_EXIT);
  });

  it('--hardness prints the measurement from the journal and exits 0 only when the gate holds', async () => {
    const root = await temp();
    const { ladder } = bankLadder();
    const d: ValidateDeps = { ladders: () => ({ banked: ladder }), root };
    const missing = capture(root);
    expect(await validateCommand('banked', { hardness: true }, missing.io, d)).toBe(USAGE_EXIT);
    expect(missing.output.err).toContain('no iteration 0 row');
    const write = async (passing: number[]) => {
      await mkdir(join(root, 'validators/banked'), { recursive: true });
      await writeFile(
        join(root, 'validators/banked/journal.jsonl'),
        `${journalOf(passing, 300, { '1': 100, '2': 80, '3': 60, '4': 40, '5': 20 })
          .map((row) => JSON.stringify(row))
          .join('\n')}\n`,
      );
      await writeFile(join(root, 'validators/banked/audit.md'), PASSING_AUDIT);
    };
    await write([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
    const holds = capture(root);
    expect(await validateCommand('banked', { hardness: true }, holds.io, d)).toBe(0);
    expect(holds.output.out).toContain('Forecast: 260 iterations to 100 percent');
    expect(holds.output.out).toContain('Gate: HOLDS');
    await write([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const fails = capture(root);
    expect(await validateCommand('banked', { hardness: true, json: true }, fails.io, d)).toBe(1);
    const measured = JSON.parse(fails.output.out);
    expect(measured).toMatchObject({ component: 'banked', forecast: 20, fixedPerIteration: 10 });
    expect(measured.gate.holds).toBe(false);
    const all = capture(root);
    expect(await validateCommand('all', { hardness: true }, all.io, d)).toBe(USAGE_EXIT);
  });

  it('--check-floor enforces the floor of the current ladder version only', async () => {
    const root = await temp();
    const { ladder } = bankLadder([1, 2]);
    await mkdir(join(root, 'validators'));
    await writeFile(
      join(root, 'validators/floors.json'),
      JSON.stringify({ version: 2, ladderVersion: { banked: 1 }, floors: { banked: 2 } }),
    );
    const d: ValidateDeps = { ladders: () => ({ banked: ladder }), root };
    const { io, output } = capture(root);
    expect(await validateCommand('banked', { checkFloor: true }, io, d)).toBe(0);
    expect(output.out).toContain('Floor: 0. At or above the floor.');
    expect(output.out).toContain('The floor 2 belongs to ladder version 1; version 2 has no floor yet.');
  });
});

describe('driftbench validate --hardness and distinct causes', () => {
  it.each([0, 40])('exits 1 with %i distinct failing causes and prints the count', async (causes) => {
    const root = await temp();
    const { ladder } = bankLadder();
    const d: ValidateDeps = { ladders: () => ({ banked: ladder }), root };
    await mkdir(join(root, 'validators/banked'), { recursive: true });
    await writeFile(
      join(root, 'validators/banked/journal.jsonl'),
      `${journalOf([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], 300, { '1': 300 }, () => causes)
        .map((row) => JSON.stringify(row))
        .join('\n')}\n`,
    );
    const { io, output } = capture(root);
    expect(await validateCommand('banked', { hardness: true }, io, d)).toBe(1);
    expect(output.out).toContain(
      `Distinct failing causes after the pilot: ${causes} (0 failing items name no cause`,
    );
    expect(output.out).toContain(`${causes} distinct failing causes after the pilot, under 100`);
    const json = capture(root);
    await validateCommand('banked', { hardness: true, json: true }, json.io, d);
    expect(JSON.parse(json.output.out).causes).toEqual({ distinct: causes, withoutCause: 0 });
  });
});

describe('driftbench validate --hardness with the audit', () => {
  it('reads blind rows and validators/<component>/audit.md', async () => {
    const root = await temp();
    const { ladder } = bankLadder();
    const d: ValidateDeps = { ladders: () => ({ banked: ladder }), root };
    await mkdir(join(root, 'validators/banked'), { recursive: true });
    const tiers = { '1': 100, '2': 80, '3': 60, '4': 40, '5': 20 };
    const builder = journalOf([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], 300, tiers, () => 150);
    const blind = journalOf([30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50], 300, tiers, () => 150)
      .slice(1)
      .map((row) => ({ ...(row as object), executor: 'blind' }));
    await writeFile(
      join(root, 'validators/banked/journal.jsonl'),
      `${[...builder, ...blind].map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
    const absent = capture(root);
    expect(await validateCommand('banked', { hardness: true }, absent.io, d)).toBe(1);
    expect(absent.output.out).toContain('audit.md is absent: no validator merges without the audit (12.7)');
    await writeFile(
      join(root, 'validators/banked/audit.md'),
      '| blind pilot | pass | ok |\n| cheater | pending | |\n',
    );
    const partial = capture(root);
    expect(await validateCommand('banked', { hardness: true }, partial.io, d)).toBe(1);
    expect(partial.output.out).toContain(
      'the audit check cheater is pending; the audit check cause review is missing; the audit check planted bugs is missing',
    );
    await writeFile(
      join(root, 'validators/banked/audit.md'),
      PASSING_AUDIT.replace('| blind pilot | pass | |', '| blind pilot | pass | ok |'),
    );
    const { io, output } = capture(root);
    expect(await validateCommand('banked', { hardness: true }, io, d)).toBe(0);
    expect(output.out).toContain('Flag: the builder pilot fixed 1 items per iteration');
    expect(output.out).toContain('  blind pilot: PASS, ok\n');
    const json = capture(root);
    await validateCommand('banked', { hardness: true, json: true }, json.io, d);
    const measured = JSON.parse(json.output.out);
    expect(measured.source).toBe('blind');
    expect(measured.audit[0]).toEqual({ check: 'blind pilot', verdict: 'pass', note: 'ok' });
  });
});

describe('driftbench validate for auditors', () => {
  async function banked() {
    const root = await temp();
    const { ladder } = bankLadder([2], { hints: true });
    return { root, d: { ladders: () => ({ banked: ladder }), root } as ValidateDeps };
  }

  it('--all-levels lists every failing item of every level, in text and JSON', async () => {
    const { root, d } = await banked();
    const text = capture(root);
    expect(await validateCommand('banked', { seeds: '1..2', allLevels: true }, text.io, d)).toBe(0);
    expect(text.output.out).toContain('All failing items of banked, every level: 2 items.');
    expect(text.output.out).toContain('Level 2 deep: 1 item');
    const json = capture(root);
    await validateCommand('banked', { seeds: '1..2', allLevels: true, json: true }, json.io, d);
    const report = JSON.parse(json.output.out);
    expect(report.failingItems.map((item: { id: string; level: number }) => [item.id, item.level])).toEqual([
      ['a3', 1],
      ['g4', 2],
    ]);
    expect(report.failingItems[1]).toMatchObject({
      family: 'gamma',
      tier: 5,
      cause: 'the parser drops the last field',
    });
    // g4 fails on seed 2 above that seed's first failing level: only a full run sees it there.
    expect(report.failingItems[1].seeds).toEqual(['1', '2']);
  });

  it('--blind strips causes and Fix: hints from text and JSON', async () => {
    const { root, d } = await banked();
    for (const json of [false, true]) {
      const run = capture(root);
      await validateCommand(
        'banked',
        { seeds: '1..2', allLevels: true, items: true, blind: true, json },
        run.io,
        d,
      );
      expect(run.output.out).not.toMatch(/cause/i);
      expect(run.output.out).not.toContain('Fix:');
      expect(run.output.out).toContain('a3 missed on seed 2.');
    }
    const open = capture(root);
    await validateCommand('banked', { seeds: '1..2', allLevels: true }, open.io, d);
    expect(open.output.out).toContain('Fix: keep the last field in the parser.');
  });

  it('--journal with a blind row leaves HANDOVER.md alone, and --check-handover compares with the last builder row', async () => {
    const d = await deps();
    const root = d.root as string;
    await writeFile(join(root, 'row0.json'), JSON.stringify(journalRow(0)));
    await validateCommand('planted', { journal: 'row0.json' }, capture(root).io, d);
    const path = join(root, 'validators/planted/HANDOVER.md');
    const before = await readFile(path, 'utf8');
    await writeFile(
      join(root, 'blind1.json'),
      JSON.stringify(
        journalRow(1, {
          executor: 'blind',
          level: { before: 1, after: 2 },
          perSeed: [
            { seed: '1', before: 1, after: 2 },
            { seed: 'hidden', before: 1, after: 2 },
          ],
        }),
      ),
    );
    const blind = capture(root);
    expect(await validateCommand('planted', { journal: 'blind1.json' }, blind.io, d)).toBe(0);
    expect(blind.output.out).toContain('blind row: HANDOVER.md was not touched');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(
      (await readFile(join(root, 'validators/planted/journal.jsonl'), 'utf8')).trim().split('\n'),
    ).toHaveLength(2);
    expect(await validateCommand('planted', { checkHandover: true }, capture(root).io, d)).toBe(0);
  });
});
