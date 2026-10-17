import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const SPEC = fileURLToPath(
  new URL('../../../examples/acme/specs/conversations/tool-failure.yaml', import.meta.url),
);
let dir = '';

async function run(argv: string[]) {
  const got = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      got.out += text;
    },
    err: (text) => {
      got.err += text;
    },
    cwd: dir,
  };
  return { code: await main(argv, io), ...got };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-all-not-run-'));
  // A target whose command does not exist: every cell is not run, none passes or fails.
  for (const campaign of ['nr', 'nr2']) {
    const made = await run([
      'campaign',
      'run',
      SPEC,
      '--target',
      'process:my-agent',
      '--process-command',
      'my-agent-that-does-not-exist',
      '--store',
      'nr.db',
      '--campaign',
      campaign,
    ]);
    expect(made.code).toBe(3);
  }
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('a campaign whose every run is not run', () => {
  it('reports with the default margin: the scorecard is written, exit 0, no stack trace', async () => {
    const result = await run(['report', 'nr', '--store', 'nr.db', '--out', 'nr.html']);
    expect(result.err).not.toContain('RangeError');
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(existsSync(join(dir, 'nr.html'))).toBe(true);
    expect(result.out).toContain('1 not run');
    expect(result.out).toContain('no scored golden');
  }, 60_000);

  it('reports as JSON without printing the margin line', async () => {
    const result = await run(['report', 'nr', '--store', 'nr.db', '--out', 'nr2.html', '--json']);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).campaign.runs).toBe(1);
  }, 60_000);

  it('compares with an explicit margin without a stack trace: bad input, exit 2, a message', async () => {
    const result = await run([
      'compare',
      '--baseline',
      'nr',
      '--candidate',
      'nr2',
      '--store',
      'nr.db',
      '--margin',
      '2',
    ]);
    expect(result.err).not.toContain('    at ');
    expect(result.code).toBe(2);
    expect(result.err).toContain('share no golden');
  }, 60_000);

  it('compares with --margin auto the same way', async () => {
    const result = await run([
      'compare',
      '--baseline',
      'nr',
      '--candidate',
      'nr2',
      '--store',
      'nr.db',
      '--margin',
      'auto',
    ]);
    expect(result.err).not.toContain('    at ');
    expect(result.code).toBe(2);
    expect(result.err).toContain('share no golden');
  }, 60_000);

  it('ci against a baseline whose every run is not run: a message, never a stack trace', async () => {
    const result = await run([
      'ci',
      '--specs',
      SPEC,
      '--target',
      'process:my-agent',
      '--process-command',
      'my-agent-that-does-not-exist',
      '--store',
      'nr.db',
      '--baseline',
      'nr',
      '--margin',
      'auto',
    ]);
    expect(result.err).not.toContain('    at ');
    expect(result.err).not.toContain('RangeError');
    // The candidate cannot run either: nothing failed, something was not run.
    expect(result.code).toBe(3);
    expect(result.out).toContain('Margin auto: 2 points by default');
  }, 120_000);

  it('ci with --change against a baseline of the same store whose every run is not run: no stack trace', async () => {
    const manifest = fileURLToPath(
      new URL('../../../examples/acme/radius/confirmation-rule.yaml', import.meta.url),
    );
    const result = await run([
      'ci',
      '--specs',
      SPEC,
      '--target',
      'process:my-agent',
      '--process-command',
      'my-agent-that-does-not-exist',
      '--baseline',
      'nr.db',
      '--store',
      'nr.db',
      '--change',
      manifest,
    ]);
    expect(result.err).not.toContain('RangeError');
    expect(result.err).not.toContain('    at ');
    // The comparison pairs no golden: the gate says so with its own exit, never an uncaught error.
    expect(result.code).toBe(3);
    expect(result.out + result.err).toContain('goldens paired');
  }, 120_000);
});

describe('a campaign whose every run is carried from an earlier campaign', () => {
  const ARGS = ['--store', 'carried.db'];

  beforeAll(async () => {
    const scored = await run([
      'campaign',
      'run',
      SPEC,
      '--target',
      'function:acme-sales',
      ...ARGS,
      '--campaign',
      'scored',
    ]);
    expect(scored.code).toBe(0);
    // What `ci --change` stores for the cells outside the radius: the baseline's runs, copied and marked carried.
    const db = openStore(join(dir, 'carried.db'));
    try {
      const source = await db.getCampaign('scored');
      expect(source).toBeDefined();
      if (!source) return;
      await db.putCampaign({ ...source, campaignId: 'carried', createdAt: '2999-01-01T00:00:00.000Z' });
      for (const each of await db.listRuns({ campaignId: 'scored' })) {
        await db.putRun('carried', {
          ...each,
          carried: { fromCampaign: 'scored', fromRun: each.runId, age: { campaigns: 1, days: 0 } },
        });
      }
    } finally {
      db.close();
    }
  }, 120_000);

  it('reports with the default margin: the scorecard is written, exit 0, no stack trace', async () => {
    const result = await run(['report', 'carried', ...ARGS, '--out', 'carried.html']);
    expect(result.err).not.toContain('RangeError');
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(existsSync(join(dir, 'carried.html'))).toBe(true);
    expect(result.out).toContain('no scored golden');
  }, 60_000);

  it('report --baseline a carried campaign: the default margin, no stack trace', async () => {
    const result = await run([
      'report',
      'scored',
      ...ARGS,
      '--baseline',
      'carried',
      '--out',
      'carried-b.html',
    ]);
    expect(result.err).not.toContain('RangeError');
    expect(result.err).not.toContain('    at ');
    expect(result.code).toBe(0);
    expect(result.out).toContain('no scored golden');
  }, 60_000);

  it('ci --baseline a carried campaign: no stack trace, the 2 point default said, the gate decides', async () => {
    const result = await run([
      'ci',
      '--specs',
      SPEC,
      '--target',
      'function:acme-sales',
      '--store',
      'carried.db',
      '--baseline',
      'carried',
      '--margin',
      'auto',
    ]);
    expect(result.err).not.toContain('RangeError');
    expect(result.err).not.toContain('    at ');
    // The candidate runs and pairs with the carried copies; one golden cannot show parity at 2 points.
    expect(result.code).toBe(1);
    expect(result.out).toContain('Margin auto: 2 points by default');
    expect(result.out).toContain('goldens paired                               1');
  }, 120_000);
});
