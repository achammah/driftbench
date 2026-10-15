import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAcme, storeAcmeCampaign } from '../../report/test/support';
import { registerReportCommand } from '../src/commands/report';
import type { Io } from '../src/index';
import { startViewer, type Viewer } from '../src/view/server';

let dir = '';
let viewer: Viewer;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-headline-'));
  const db = join(dir, 'store.db');
  const store = openStore(db);
  try {
    await storeAcmeCampaign(store, {
      campaignId: 'c-many',
      modes: ['F', 'P'],
      repeats: 2,
      fault: 'x3-skips-recap',
    });
    const [first] = await loadAcme();
    await storeAcmeCampaign(store, {
      campaignId: 'c-one',
      modes: ['F'],
      repeats: 2,
      specs: [first as NonNullable<typeof first>],
    });
  } finally {
    await store.close();
  }
  viewer = await startViewer({ store: db, labels: join(dir, 'labels'), port: 0, labelledBy: 'a reviewer' });
}, 180_000);

afterAll(async () => {
  await viewer?.close();
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

type Headline = {
  estimate: number;
  lower: number;
  upper: number;
  method: string;
  trees: number;
  runs: number;
  pooledRate: number;
  designEffect: number;
  effectiveRuns: number;
  degenerate: boolean;
  detectableDrop: number | null;
  shares: { incomplete: number; blocked: number; notRun: number };
};
type JsonCard = {
  modes: Array<{
    mode: string;
    lines: number;
    runs: number;
    headline?: Headline;
    runPass?: { method: string; n: number; designEffect?: number; effectiveN?: number };
  }>;
  lines: Array<{ mode: string; passRate: { k: number; n: number } }>;
};

describe('driftbench report carries the suite headline', () => {
  it('--json: every mode has modes[].headline, the mean over the same goldens as `lines`, with finite numbers', async () => {
    const { code, out, err } = await cli([
      'report',
      'c-many',
      '--store',
      'store.db',
      '--out',
      'many.html',
      '--json',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    const card = JSON.parse(out) as JsonCard;
    expect(card.modes.map((m) => m.mode).sort()).toEqual(['F', 'P']);
    for (const mode of card.modes) {
      const h = mode.headline as Headline;
      expect(h, `mode ${mode.mode}`).toBeDefined();
      expect(h.method).toBe('hierarchical');
      expect(h.runs).toBe(mode.runs);
      expect(h.trees).toBe(mode.lines);
      const rates = card.lines.filter((l) => l.mode === mode.mode).map((l) => l.passRate.k / l.passRate.n);
      expect(h.estimate).toBeCloseTo(rates.reduce((a, b) => a + b, 0) / rates.length, 12);
      expect(h.lower).toBeLessThanOrEqual(h.estimate);
      expect(h.upper).toBeGreaterThanOrEqual(h.estimate);
      for (const value of [h.designEffect, h.effectiveRuns, h.pooledRate])
        expect(Number.isFinite(value)).toBe(true);
      expect(h.effectiveRuns * h.designEffect).toBeCloseTo(h.runs, 9);
      expect(h.detectableDrop === null || (h.detectableDrop > 0 && h.detectableDrop <= 1)).toBe(true);
      expect(h.shares).toEqual({ incomplete: 0, blocked: 0, notRun: 0 });
      if (mode.runPass?.method === 'wilson, design effect') {
        expect((mode.runPass.designEffect ?? 0) * (mode.runPass.effectiveN ?? 0)).toBeCloseTo(
          mode.runPass.n,
          9,
        );
      }
    }
  });

  it('text: one headline line per mode, in mode order, between the campaign line and the written files', async () => {
    const { code, out } = await cli(['report', 'c-many', '--store', 'store.db', '--out', 'many.html']);
    expect(code).toBe(0);
    const lines = out.split('\n').filter((line) => line.startsWith('Suite pass rate'));
    expect(lines.map((line) => line.slice(0, 'Suite pass rate, mode F'.length))).toEqual([
      'Suite pass rate, mode F',
      'Suite pass rate, mode P',
    ]);
    expect(out.indexOf('Campaign c-many')).toBeLessThan(out.indexOf('Suite pass rate'));
    expect(out.indexOf('Suite pass rate')).toBeLessThan(out.indexOf('Wrote '));
  });

  it('a campaign of one golden: the line says there is no interval, and --json carries method none', async () => {
    const text = await cli(['report', 'c-one', '--store', 'store.db', '--out', 'one.html']);
    expect(text.code).toBe(0);
    expect(text.out).toMatch(
      /^Suite pass rate, mode F: \d+\.\d% no interval: one cluster \(one golden\); 1 golden\.$/m,
    );
    const json = await cli(['report', 'c-one', '--store', 'store.db', '--out', 'one.html', '--json']);
    const h = (JSON.parse(json.out) as JsonCard).modes[0]?.headline;
    expect(h?.method).toBe('none');
    expect(h?.trees).toBe(1);
    expect(h?.detectableDrop).toBeNull();
    expect(h?.lower).toBe(h?.estimate);
  });
});

describe('driftbench view shows the suite headline on the campaign page', () => {
  it('the scorecard page of the viewer has the headline tile and column of every mode', async () => {
    const response = await fetch(`${viewer.url}/campaign/c-many`);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('<p class="tile-label">Suite pass rate, F</p>');
    expect(page).toContain('<p class="tile-label">Suite pass rate, P</p>');
    expect(page).toContain('<th scope="col">suite pass rate</th>');
    expect(page).toMatch(/\d+ goldens, n_eff [\d.]+ runs/);
  });
});
