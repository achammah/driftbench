import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpec, validateSpec } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterAll, describe, expect, it } from 'vitest';
import { processAdapter } from '../src/process';

/**
 * Blast-radius audit of the dynamic setup check (PR 436) on the real process adapter: after open, every file
 * the Given writes inline must read back through readArtifact, so a correct workspace never reads as
 * setup_failed. Fictional data only.
 */
const AGENT = fileURLToPath(new URL('../../sandbox/test/fixtures/code-agent.mjs', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const loaded = validateSpec({
  id: 'process-seeded',
  kind: 'task',
  given: {
    world: {
      workspace: {
        files: {
          './notes/a.txt': 'hello',
          'catalog.csv': 'plan_id,name,category,allowance,monthly_usd\nM1,Acme Mobile S,mobile,5GB,15\n',
        },
      },
    },
  },
  blocks: [{ user: 'Build the price sheet.' }],
});

describe('blast radius: the setup check on the process adapter', () => {
  it('a workspace the process adapter seeds reads back as written: the block runs', async () => {
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-setup-'));
    made.push(dir);
    const adapter = processAdapter({
      command: process.execPath,
      args: [AGENT],
      provider: localProvider({ dir }),
    });
    expect(adapter.capabilities().sandbox).toBe(true);
    const run = await runSpec(loaded.spec, {
      adapter,
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
    });
    expect(run.error).toBeUndefined();
    expect(run.blocks[0]?.status).toBeUndefined();
    expect(run.blocks[0]?.notRun).toBeUndefined();
    expect(run.blocks[0]?.observed.workspaceDiff?.created).toContain('out/acme-price-sheet.csv');
  }, 60_000);
});
