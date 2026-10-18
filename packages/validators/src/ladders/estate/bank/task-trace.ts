import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Observed } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { REPO } from './bench';
import { FAKE, FIXTURE, JUDGE, STATES } from './fixture-suite';

/**
 * The first block of each spec, run on the fixture's fake agent in its original estate, as the trace the run
 * recorded: the tool calls, the guards that fired, the skills and the helpers loaded. Specs are run in small
 * batches, each in its own store, so a long list never holds the disk or one process for long.
 */
const BATCH = 20;

export async function observeOnFake(paths: readonly string[]): Promise<Map<string, Observed>> {
  const out = new Map<string, Observed>();
  if (paths.length === 0) return out;
  const work = await mkdtemp(join(tmpdir(), 'astra-askwords-observe-'));
  try {
    for (let at = 0; at < paths.length; at += BATCH) {
      const db = join(work, `observe-${at}.db`);
      const ran = spawnSync(
        'pnpm',
        [
          '-s',
          'driftbench',
          'estate',
          'run',
          ...paths.slice(at, at + BATCH),
          '--estate',
          FIXTURE,
          '--runtime',
          'claude-code',
          '--command',
          FAKE,
          '--store',
          db,
          '--states',
          STATES,
          '--judge',
          'claude:haiku',
          '--judge-command',
          JUDGE,
          '--map',
          join(FIXTURE, 'approved.yaml'),
          '--json',
        ],
        { cwd: REPO, encoding: 'utf8', timeout: 900_000, maxBuffer: 200_000_000 },
      );
      if (ran.error) throw ran.error;
      if (ran.status !== 0 && ran.status !== 1)
        throw new Error(`fake run failed (${ran.status}): ${ran.stderr || ran.stdout}`);
      const store = openStore(db);
      for (const run of await store.listRuns()) {
        const observed = run.status === 'completed' ? run.blocks[0]?.observed : undefined;
        if (observed) out.set(run.specId, observed);
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return out;
}
