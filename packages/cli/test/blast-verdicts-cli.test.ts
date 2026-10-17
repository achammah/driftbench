import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlockResult, RunResult } from '@agent-nexus/driftbench-core';
import { Command, CommanderError } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { acmeAdapter } from '../../core/test/runner/support';
import { type CampaignDeps, defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { type CiSummary, notRunSpecs, registerCiCommand, runPasses } from '../src/commands/ci';
import { defaultHoldoutDeps, holdoutScoreCommand, holdoutSealCommand } from '../src/commands/holdout';
import { metricOf, standardErrorOf } from '../src/commands/monitor';
import { type Io, main } from '../src/index';

/**
 * Blast-radius audit of the not_run and blocked verdicts (PR 428), CLI side: campaign run, report, ci, monitor
 * and holdout over a candidate whose adapter cannot force a tool result. Fictional data only: the Acme
 * Telecom example agent.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONVERSATIONS = 'examples/acme/specs/conversations';
const GATED = join(ROOT, 'examples/acme/gated');
const SLOW = 180_000;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-verdicts-'));
  made.push(dir);
  return dir;
}

function capture() {
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
  return { io, output };
}

/** The CLI, with the campaign and ci commands on the given deps when there are any. */
async function cli(argv: string[], deps?: Partial<CampaignDeps>) {
  const { io, output } = capture();
  if (!deps) return { code: await main(argv, io), ...output };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerCampaignCommands(program, io, (exit) => (code = exit), { ...defaultDeps, ...deps });
  registerCiCommand(program, io, (exit) => (code = exit), { ...defaultDeps, ...deps });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: cause.exitCode === 0 ? 0 : 2, ...output };
    throw cause;
  }
  return { code, ...output };
}

/** The Acme agent on an adapter that cannot force a tool result: the specs that force one are not run. */
const noStubs: Partial<CampaignDeps> = {
  adapterFor: async () => acmeAdapter({ capabilities: { toolStubs: false } }),
};

const NOT_RUN = {
  kind: 'unsupported' as const,
  layer: '5 world',
  check: 'capability',
  expected: 'e',
  got: 'g',
};

function syntheticRun(repeat: number, last: 'pass' | 'not_run' | 'blocked'): RunResult {
  const block = (index: number, kind: 'pass' | 'not_run' | 'blocked'): BlockResult => ({
    index,
    givenHash: `g${index}`,
    observed: { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
    verdicts: [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: kind === 'pass',
    ...(kind === 'not_run' ? { status: 'not_run' as const, notRun: NOT_RUN } : {}),
    ...(kind === 'blocked'
      ? { status: 'blocked' as const, blocked: { by: 'block 0', root: 'block 0' } }
      : {}),
  });
  return {
    runId: `r${repeat}`,
    specId: 'g',
    specHash: 'h',
    target: { adapter: 'function', agent: 'acme-sales' },
    mode: 'F',
    repeat,
    status: 'completed',
    blocks: [block(0, 'pass'), block(1, last)],
    succession: { driftCount: 0, driftRate: 0, longestClean: 1, minOverBlocks: last === 'pass' },
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-15T00:00:00.000Z',
    finishedAt: '2026-10-15T00:00:00.000Z',
    cacheHit: false,
  };
}
const three = [syntheticRun(0, 'pass'), syntheticRun(1, 'not_run'), syntheticRun(2, 'blocked')];

describe('blast radius: campaign run and report with blocks not run', () => {
  it(
    'campaign run marks the cell not run, counts it apart in the summary and the JSON, and exits 3',
    async () => {
      const dir = await temp();
      const store = join(dir, 'c.db');
      const json = await cli(
        ['campaign', 'run', CONVERSATIONS, '--target', 'function:acme-sales', '--store', store, '--json'],
        noStubs,
      );
      expect(json.err).toBe('');
      expect(json.code).toBe(3);
      const report = JSON.parse(json.out) as {
        campaignId: string;
        cells: Array<{
          specId: string;
          state: string;
          failing: string[];
          blocks: Array<{ status?: string; notRun?: unknown }>;
        }>;
        summary: { cells: number; pass: number; fail: number; notRun?: number; blocked?: number };
      };
      const skipped = report.cells.filter((cell) => cell.state === 'not_run');
      expect(skipped.map((cell) => cell.specId)).toContain('acme-tool-failure');
      const toolFailure = skipped.find((cell) => cell.specId === 'acme-tool-failure');
      expect(toolFailure?.failing[0]).toBe('block 0 not_run capability');
      expect(toolFailure?.blocks[0]?.status).toBe('not_run');
      expect(toolFailure?.blocks[0]?.notRun).toMatchObject({ check: 'capability' });
      expect(report.summary.notRun).toBe(skipped.length);
      expect(report.summary.blocked).toBeUndefined();
      expect(report.cells.filter((cell) => cell.state === 'fail').map((cell) => cell.specId)).not.toContain(
        'acme-tool-failure',
      );

      const text = await cli(
        ['campaign', 'run', CONVERSATIONS, '--target', 'function:acme-sales', '--store', join(dir, 't.db')],
        noStubs,
      );
      expect(text.out).toMatch(/- acme-tool-failure .*block 0 not_run capability/);
      expect(text.out).toContain(`${skipped.length} not run`);

      // driftbench report on the same store prints the not-run count beside pass and fail.
      const shown = await cli([
        'report',
        report.campaignId,
        '--store',
        store,
        '--out',
        join(dir, 'card.html'),
      ]);
      expect(shown.err).toBe('');
      expect(shown.out).toMatch(
        new RegExp(`\\d+ pass, \\d+ fail, ${skipped.length} not run, \\d+ did not complete`),
      );
    },
    SLOW,
  );
});

describe('blast radius: ci over a candidate with blocks not run', () => {
  it(
    'not-run outranks a failing aggregate, and the pass-rate aggregate counts only scored runs',
    async () => {
      const dir = await temp();
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
      const args = (out: string) => [
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
        '--aggregate',
        'pass-rate:>=1',
      ];
      const strict = await cli(args('strict'), noStubs);
      expect(strict.code).toBe(3);
      const strictSummary = JSON.parse(await readFile(join(dir, 'strict.json'), 'utf8')) as CiSummary;
      expect(strictSummary.verdict).toBe('not-run');
      // Every run that was scored passes: the pass rate over the scored runs is 1, so the aggregate passes.
      expect(strictSummary.aggregates.find((entry) => entry.name === 'pass-rate')?.passed).toBe(true);

      const loose = await cli([...args('loose'), '--max-not-run', '1'], noStubs);
      expect(loose.code).toBe(0);
      const looseSummary = JSON.parse(await readFile(join(dir, 'loose.json'), 'utf8')) as CiSummary;
      expect(looseSummary.verdict).toBe('parity');
      expect(looseSummary.aggregates.find((entry) => entry.name === 'pass-rate')?.value).toBe(1);
    },
    SLOW,
  );

  it('notRunSpecs counts a blocked block in the spec blocks, never as not run', () => {
    const gate = notRunSpecs(three, 0.2);
    expect(gate?.over).toEqual([]);
    expect(gate?.specs).toHaveLength(1);
    expect(gate?.specs[0]).toMatchObject({
      specId: 'g',
      notRun: 1,
      blocks: 6,
      first: 'F block 1: capability, g',
    });
    expect(gate?.specs[0]?.share).toBeCloseTo(1 / 6, 2);
    expect(notRunSpecs([syntheticRun(0, 'blocked')], 0)).toBeUndefined();
  });

  it('runPasses: neither a not_run nor a blocked run passes', () => {
    expect(three.map(runPasses)).toEqual([true, false, false]);
  });
});

describe('blast radius: monitor pass_rate over 1 pass, 1 not_run, 1 blocked', () => {
  it('pass_rate is 1 over the scored run, and its standard error 0', () => {
    expect(metricOf(three, 'pass_rate')).toBe(1);
    expect(standardErrorOf(three, 'pass_rate')).toBe(0);
  });
});

describe('blast radius: holdout score with conversations not run', () => {
  it(
    'a sealed conversation the target cannot run is not counted in the rate',
    async () => {
      const sealed = join(await temp(), 'sealed');
      const { io } = capture();
      expect(await holdoutSealCommand({ specs: GATED, out: sealed }, io, defaultHoldoutDeps)).toBe(0);
      const score = async (toolStubs: boolean, budget?: string) => {
        const scored = capture();
        const code = await holdoutScoreCommand(
          { sealed, target: 'function:acme-sales', json: true, ...(budget ? { budget } : {}) },
          scored.io,
          {
            ...defaultHoldoutDeps,
            adapterFor: async () => acmeAdapter({ capabilities: { toolStubs } }),
            now: () => new Date('2026-10-11T12:00:00Z'),
          },
        );
        expect(scored.output.err).toBe('');
        expect(code).toBe(0);
        return JSON.parse(scored.output.out) as { conversations: number; passed: number };
      };
      const full = await score(true, '2');
      const without = await score(false);
      // gen-twise-008, 052 and 118 force a tool error: without toolStubs they are not run, so not counted.
      expect(without.conversations).toBeLessThan(full.conversations);
    },
    SLOW,
  );
});
