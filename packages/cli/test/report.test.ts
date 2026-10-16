import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LoadedSpec, loadSpecs } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { registerReportCommand } from '../src/commands/report';
import { type Io, main } from '../src/index';

const ROOT_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const PILOT = fileURLToPath(new URL('../../../examples/acme/pilot/acme-random', import.meta.url));

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-report-'));
  const store = openStore(join(dir, 'store.db'));
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F', 'P'], repeats: 2 });
    await storeAcmeCampaign(store, {
      campaignId: 'c-x3',
      modes: ['F', 'P'],
      repeats: 2,
      fault: 'x3-skips-recap',
      createdAt: '2026-10-11T13:00:00.000Z',
    });
  } finally {
    await store.close();
  }
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: dir,
  };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerReportCommand(program, io, (exit) => {
    code = exit;
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: cause.exitCode === 0 ? 0 : 2, out, err };
    throw cause;
  }
  return { code, out, err };
}

describe('driftbench report', () => {
  it('writes the scorecard and the JUnit XML of a campaign, exit 0', async () => {
    const { code, out, err } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/card.html',
      '--junit',
      'out/junit.xml',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('Campaign c-x3: 34 runs');
    // The suite headline of every mode: the mean over goldens, its hierarchical interval, n_eff and the detectable drop.
    expect(out).toMatch(
      /Suite pass rate, mode F: \d+\.\d% \[\d+\.\d%, \d+\.\d%\] \(hierarchical 95% interval\); \d+ goldens, n_eff [\d.]+ runs \(design effect [\d.]+\)/,
    );
    expect(out).toContain('Wrote out/card.html and out/junit.xml.');
    const html = readFileSync(join(dir, 'out/card.html'), 'utf8');
    expect(html).toContain('<title>Scorecard c-x3</title>');
    expect(html).not.toContain('<section id="compare">');
    const xml = readFileSync(join(dir, 'out/junit.xml'), 'utf8');
    expect(xml).toMatch(/<testsuites name="c-x3" tests="34" failures="[1-9]\d*" errors="0"/);
  });

  it('scores --aggregate criteria over the campaign, prints each, and refuses one it cannot read', async () => {
    const { code, out, err } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/agg.html',
      '--aggregate',
      'pass-rate:>=0.99',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('aggregate pass-rate >= 0.99: fails');
    const bad = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/bad.html',
      '--aggregate',
      'nope:>=1',
    ]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('unknown aggregate nope');
  });

  it('prints the aggregate interval on the effective runs, with the goldens behind it', async () => {
    const { code, out, err } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/agg-goldens.html',
      '--aggregate',
      'pass-rate:>=0.99',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    const line = out.split('\n').find((entry) => entry.startsWith('aggregate pass-rate')) ?? '';
    expect(line).toMatch(
      /Wilson 95% interval on the effective runs \d\.\d{3} to \d\.\d{3} over \d+ runs in \d+ goldens/,
    );
    expect(line).toMatch(/design effect \d+\.\d+/);
    expect(line).toMatch(/undecided: \d+ goldens like these \(\d+ runs\) would decide it|, decided\)/);
  });

  it('scores the aggregates of the project config --config names', async () => {
    writeFileSync(join(dir, 'project.yaml'), 'aggregates:\n  - pass-rate:>=0.99\n');
    const { code, out, err } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/config.html',
      '--config',
      'project.yaml',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('aggregate pass-rate >= 0.99: fails');
  });

  it('reports the aggregates of a campaign with no runs as inconclusive and exits 0', async () => {
    let emptyErr = '';
    const emptyCode = await main(
      [
        'campaign',
        'run',
        join(ROOT_DIR, 'examples/acme/specs/conversations/plan-upgrade.yaml'),
        '--target',
        'function:acme',
        '--campaign',
        'c-no-runs',
        '--store',
        'no-runs.db',
        '--budget-usd',
        '0',
      ],
      {
        out: () => {},
        err: (text) => {
          emptyErr += text;
        },
        cwd: dir,
      },
    );
    expect(emptyErr).toBe('');
    expect(emptyCode).toBe(1);
    const { code, out, err } = await cli([
      'report',
      'c-no-runs',
      '--store',
      'no-runs.db',
      '--out',
      'out/no-runs.html',
      '--aggregate',
      'pass-rate:>=0.9',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('aggregate pass-rate >= 0.9: no runs (no runs in the campaign: inconclusive');
  });

  it('scores two --aggregate flags of one name as two criteria', async () => {
    const { code, out } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'out/two.html',
      '--aggregate',
      'pass-rate:>=0',
      '--aggregate',
      'pass-rate:>=0.99',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('aggregate pass-rate >= 0: passes');
    expect(out).toContain('aggregate pass-rate >= 0.99: fails');
  });

  it('chooses the margin from the baseline by default, as compare and ci do, and prints it', async () => {
    const { code, out } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'auto.html',
      '--baseline',
      'c-acme',
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(
      /^Margin auto: \d+\.\d points, the smallest half point at which the baseline compared with itself is non-inferior/m,
    );
    const margin = /Margin auto: (\d+\.\d) points/.exec(out)?.[1];
    expect(out).toContain(`Against baseline c-acme: regressed, margin ${margin} points.`);
    const strict = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'strict.html',
      '--baseline',
      'c-acme',
      '--strict',
      '--min-goldens',
      '2',
    ]);
    expect(strict.code).toBe(0);
    expect(strict.out).toContain('Against baseline c-acme: regressed');
  });

  it('adds the compare diff against a baseline and the pilot report', async () => {
    const { code, out } = await cli([
      'report',
      'c-x3',
      '--store',
      'store.db',
      '--out',
      'diff.html',
      '--baseline',
      'c-acme',
      '--margin',
      '15',
      '--pilot',
      PILOT,
    ]);
    expect(code).toBe(0);
    expect(out).toContain('Against baseline c-acme: regressed, margin 15.0 points.');
    const html = readFileSync(join(dir, 'diff.html'), 'utf8');
    expect(html).toContain('<section id="compare">');
    expect(html).toContain('<section id="pilot">');
    expect(html).toContain('Margin 15.0 points');
  });

  it('reads the latest campaign without an id, and prints the scorecard with --json', async () => {
    const { code, out } = await cli([
      'report',
      '--store',
      'store.db',
      '--out',
      'latest.html',
      '--json',
      '--spread-mode',
      'P',
    ]);
    expect(code).toBe(0);
    const json = JSON.parse(out) as {
      campaign: { campaignId: string };
      spread: { mode: string };
      lines: unknown[];
    };
    expect(json.campaign.campaignId).toBe('c-x3');
    expect(json.spread.mode).toBe('P');
    expect(json.lines.length).toBe(17);
    expect(existsSync(join(dir, 'latest.html'))).toBe(true);
  });

  it.each([
    [['c-nope'], 'No campaign c-nope'],
    [['c-x3', '--baseline', 'c-nope'], 'No campaign c-nope'],
    [['c-x3', '--margin', '-1'], '--margin takes a number of points'],
    [['c-x3', '--max-runs', 'many'], '--max-runs takes a whole number'],
    [['c-x3', '--spread-mode', 'T,F'], '--spread-mode takes one mode'],
    [['c-x3', '--spread-mode', 'Q'], 'Unknown mode "Q"'],
    [['c-x3', '--pilot', 'nowhere'], 'No pilot report at'],
  ])('exits 2 on bad input %j and writes nothing', async (args, message) => {
    const { code, err } = await cli(['report', ...args, '--store', 'store.db', '--out', 'bad.html']);
    expect(code).toBe(2);
    expect(err).toContain(message);
    expect(existsSync(join(dir, 'bad.html'))).toBe(false);
  });

  it('exits 2 on a store that holds no campaign', async () => {
    // An existing store with no campaign; a missing store is refused before it is opened.
    await openStore(join(dir, 'empty.db')).close();
    const { code, err } = await cli(['report', '--store', 'empty.db', '--out', 'bad.html']);
    expect(code).toBe(2);
    expect(err).toContain('The store holds no campaign.');
  });

  it('is wired into the CLI', async () => {
    let out = '';
    const code = await main(['report', '--help'], {
      out: (text) => {
        out += text;
      },
      err: () => {},
      cwd: dir,
    });
    expect(code).toBe(0);
    expect(out).toContain('--out <file.html>');
    expect(out).toContain('--junit <file.xml>');
    expect(out).toContain('--pilot <path>');
  });
});

describe('driftbench report on a campaign of generated specs with an incomplete run', () => {
  const GENERATED = fileURLToPath(new URL('../../../examples/acme/generated/specs/twise', import.meta.url));

  beforeAll(async () => {
    const specs: LoadedSpec[] = [];
    for (const name of ['gen-twise-001.yaml', 'gen-twise-002.yaml', 'gen-twise-003.yaml']) {
      const [loaded] = await loadSpecs([join(GENERATED, name)]);
      if (!loaded?.ok) throw new Error(`invalid generated spec ${name}`);
      specs.push(loaded);
    }
    const store = openStore(join(dir, 'generated.db'));
    try {
      await storeAcmeCampaign(store, { campaignId: 'c-gen', modes: ['F'], repeats: 2, specs });
      // One run that did not complete: a stopped run counts as failing, and its line is incomplete.
      const [run] = await store.listRuns({ campaignId: 'c-gen' });
      if (!run) throw new Error('no stored run');
      await store.putRun('c-gen', { ...run, status: 'stopped' });
    } finally {
      await store.close();
    }
  }, 120_000);

  type Card = {
    spread: { by: string[] };
    lines: Array<{ incomplete: number; withheld?: boolean; passK: unknown[] }>;
  };
  const card = async (...flags: string[]) => {
    const { code, out, err } = await cli([
      'report',
      'c-gen',
      '--store',
      'generated.db',
      '--out',
      `gen-${flags.join('-') || 'plain'}.html`,
      '--json',
      ...flags,
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    return JSON.parse(out) as Card;
  };

  it('names spread cells by --by, and by behaviour without it', async () => {
    expect((await card()).spread.by).toEqual(['behaviour']);
    expect((await card('--by', 'flow,channel')).spread.by).toEqual(['flow', 'channel']);
  });

  it('withholds the at-k value of a line with incomplete runs with --withhold-incomplete, and reports it without', async () => {
    const plain = (await card()).lines.find((line) => line.incomplete > 0);
    expect(plain?.withheld ?? false).toBe(false);
    expect(plain?.passK.length).toBeGreaterThan(0);
    const withheld = (await card('--withhold-incomplete')).lines.find((line) => line.incomplete > 0);
    expect(withheld?.withheld).toBe(true);
    expect(withheld?.passK).toEqual([]);
  });
});
