import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedGiven, Stimulus, Turn } from '@agent-nexus/driftbench-core';

/** Paths and seeds the live runner tests share. Everything is the fictional Northwind fixture. */

export const ESTATE = fileURLToPath(new URL('../../../../../examples/estates/fixture', import.meta.url));
export const FAKE = fileURLToPath(
  new URL('../../../../../examples/estates/fixture/live/fake/claude.mjs', import.meta.url),
);
/** Explicit recording playback for transport and protocol assertions, never the fake's default. */
export const FAKE_RECORDINGS = {
  FAKE_MANIFEST: join(ESTATE, 'live/fake/manifest.json'),
};
export const STATES = fileURLToPath(
  new URL('../../../../../examples/estates/fixture/live/states/library.json', import.meta.url),
);

/** The flags the runner adds after the headless shape, as the first real run settled them. */
export const RUNTIME_FLAGS = [
  '--include-hook-events',
  '--setting-sources',
  'project,local',
  '--strict-mcp-config',
] as const;

export const MAP_HASH = 'e48ea73788c2fb36e8def0b10b39a3551139beb107f54959237f272c2aa7ba41';

export const ASK_WEEKLY = "Add the late shipment count to this week's report, reports/2026-W41.md.";
export const ASK_INVOICE = 'Match the Fjord Kitchenware invoice INV-1001 with its order.';

export const SEED: Record<string, string> = {
  'ledger/2026-W41.csv':
    'date,invoice,supplier,amount\n2026-10-05,INV-1001,Fjord Kitchenware,1250.00 EUR\n2026-10-06,INV-1002,Copperline Pans,480.00 EUR\n',
  'invoices/INV-1001.json':
    '{ "invoice": "INV-1001", "order": "PO-2001", "supplier": "Fjord Kitchenware", "amount": "1250.00", "currency": "EUR" }\n',
  'orders/PO-2001.json':
    '{ "order": "PO-2001", "supplier": "Fjord Kitchenware", "amount": "1250.00", "currency": "EUR" }\n',
  'shipments/log.csv':
    'shipment,carrier,promised,delivered\nNW-55012,DPX,2026-10-02,\nNW-55020,DPX,2026-10-16,\nNW-55031,FRT,2026-10-03,\n',
  'reports/2026-W40.md': '# Week 40\n## Invoices reconciled\n4\n## Shipments late\n0\n',
  'reports/2026-W41.md': '# Week 41\n## Invoices reconciled\n2\n## Shipments late\n',
};

export function givenOf(vars: Record<string, unknown> = {}): ResolvedGiven {
  return {
    prefix: [],
    ledger: {},
    world: { workspace: { files: { ...SEED } } },
    vars: {
      estate: { runtime: 'claude-code', map_hash: MAP_HASH },
      workspace_seed: 'northwind-ops',
      ...vars,
    },
    target: { adapter: 'claude-code' },
    hash: 'given-hash-for-tests',
  };
}

export function turnOf(index: number, user: string, given: ResolvedGiven): Turn {
  const stimulus: Stimulus = { user };
  return { index, stimulus, given };
}

/** A folder for one test's call log and state, removed by `done`. */
export async function scratch(): Promise<{ dir: string; calls: string; done: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'live-test-'));
  return { dir, calls: join(dir, 'calls.jsonl'), done: () => rm(dir, { recursive: true, force: true }) };
}

/** The fake's call log: one object per call. */
export async function callsOf(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
