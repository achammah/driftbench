// Blast radius of unit F5 beyond the runner's own block: diagnostics named in `uses` leave the spec's cache
// keys alone and enter `resolved`; a driver-injected block (mode P) is diagnosed with the spec's diagnostics;
// and a run diagnosed or not stores, reads back and scores the same, `pass` and verdicts byte for byte.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  clearObjectContexts,
  loadSpecFile,
  objectContextFor,
  RunResult,
  registerDiagnosticStep,
  runSpec,
} from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { injectingDriver } from '../../src/runner';
import { realAcmeAdapter } from '../runner/support';

const ACME = fileURLToPath(
  new URL('../../../../examples/acme/specs/conversations/new-customer-coverage.yaml', import.meta.url),
);

registerDiagnosticStep('plugin:blast-stamps-count', {
  params: z.strictObject({}),
  cost: 'static',
  run: ({ verdicts }) => ({ summary: `${verdicts.length} verdicts read`, score: verdicts.length }),
});
registerDiagnosticStep('plugin:blast-stamps-rerun', {
  params: z.strictObject({}),
  cost: 'run',
  run: () => ({ summary: 'ran again' }),
});

function project(diagnostics: string): string {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-blast-diagnoses-'));
  const text = readFileSync(ACME, 'utf8').replace(
    'id: acme-new-customer-coverage\n',
    `id: acme-new-customer-coverage\nuses: { diagnostics: ${diagnostics} }\n`,
  );
  const files: Record<string, string> = {
    'driftbench.yaml': 'plugins: []\n',
    'driftbench/diagnostic/count.yaml': [
      'kind: diagnostic',
      'id: count',
      'when: { always: true }',
      'steps:',
      '  - { id: count, title: Count the verdicts, impl: "plugin:blast-stamps-count" }',
      '  - { id: rerun, title: Run again, impl: "plugin:blast-stamps-rerun" }',
      '',
    ].join('\n'),
    'specs/coverage.yaml': text,
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return join(root, 'specs/coverage.yaml');
}

async function run(path: string, mode: 'T' | 'P'): Promise<RunResult> {
  clearObjectContexts();
  const loaded = await loadSpecFile(path);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return runSpec(loaded.spec, {
    adapter: realAcmeAdapter(),
    driver: mode === 'P' ? injectingDriver(createScriptedDriver(), 'shop-hours') : createScriptedDriver(),
    checks: defaultChecks(),
    mode,
    repeat: 0,
    ...(mode === 'P' ? { perturbationId: 'shop-hours' } : {}),
    objects: objectContextFor(path),
    now: () => new Date('2026-10-15T00:00:00.000Z'),
  });
}

describe('blast stamps: diagnoses beyond the block that wrote them', () => {
  it('keep every cache key, enter resolved, and leave pass and verdicts as without them', async () => {
    const with_ = await run(project('[count]'), 'T');
    const without = await run(project('[]'), 'T');
    expect(with_.blocks.length).toBe(without.blocks.length);
    for (const [index, block] of with_.blocks.entries()) {
      const other = without.blocks[index];
      expect(block.cacheKey).toBe(other?.cacheKey);
      expect(block.givenHash).toBe(other?.givenHash);
      expect(block.pass).toBe(other?.pass);
      expect(block.verdicts).toStrictEqual(other?.verdicts);
      expect(block.resolved?.objects.map((entry) => `${entry.key}:${entry.id}`)).toEqual([
        'value_check:default',
        'check_set:default',
        'diagnostics:count',
      ]);
      expect(block.resolved?.hash).not.toBe(other?.resolved?.hash);
      expect(block.diagnoses?.map((d) => d.step)).toEqual(['count']);
      expect(block.diagnoses?.[0]?.score).toBe(block.verdicts.length);
      expect(block.skippedForBudget).toBe(1);
      expect(other?.diagnoses).toBeUndefined();
      expect(other?.skippedForBudget).toBeUndefined();
    }
  });

  it('diagnose a block the driver injected in mode P with the spec diagnostics', async () => {
    const result = await run(project('[count]'), 'P');
    const injected = result.blocks.filter((block) => block.injected);
    expect(injected.length).toBe(1);
    for (const block of result.blocks) {
      expect(block.diagnoses?.[0]?.diagnostic).toMatch(/^diagnostic:count@[0-9a-f]{8}$/);
      expect(block.diagnoses?.[0]?.by).toMatchObject({ item: 'count', impl: 'plugin:blast-stamps-count' });
    }
    const plain = await run(project('[]'), 'P');
    expect(result.blocks.map((block) => block.pass)).toEqual(plain.blocks.map((block) => block.pass));
  });

  it('store and read back with their diagnoses, and score like the run without them', async () => {
    const with_ = await run(project('[count]'), 'T');
    const store = openMemoryStore();
    try {
      await store.putCampaign({
        campaignId: 'diag',
        specs: [{ id: with_.specId, hash: with_.specHash }],
        targets: [with_.target],
        modes: ['T'],
        repeats: { T: 1, F: 0, P: 0 },
        budgetUsd: 0,
        judge: { mode: 'system1', judges: [] },
        createdAt: '2026-10-15T00:00:00.000Z',
      });
      await store.putRun('diag', with_);
      const read = await store.getRun(with_.runId, 'diag');
      expect(read).toStrictEqual(RunResult.parse(JSON.parse(JSON.stringify(with_))));
      expect(read?.blocks.every((block) => (block.diagnoses?.length ?? 0) > 0)).toBe(true);
    } finally {
      await store.close();
    }
  });
});
