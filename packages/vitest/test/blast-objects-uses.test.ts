// Blast radius of PR 443 on the vitest plugin: describeSpec reads a spec FILE, so it must resolve the objects
// the spec names against the layers visible from that file, as `driftbench spec validate` and `campaign run`
// do (loadSpecFile). The fixture spec names a project object, driftbench/policy/blame/acme.yaml.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { clearObjectContexts, loadSpecFile } from '@agent-nexus/driftbench-core';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG = fileURLToPath(new URL('./fixtures/vitest.config.ts', import.meta.url));
const SPEC = fileURLToPath(new URL('./fixtures/blast-objects/specs/uses-project.yaml', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  clearObjectContexts();
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

type Result = { fullName: string; status: string; failureMessages: string[] };

/** Runs one fixture file in a child vitest and reads its JSON report. */
async function runFixture(name: string): Promise<Result[]> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-vitest-blast-'));
  made.push(dir);
  const output = join(dir, 'report.json');
  await promisify(execFile)(
    join(ROOT, 'node_modules', '.bin', 'vitest'),
    [
      'run',
      `packages/vitest/test/fixtures/${name}`,
      '--config',
      CONFIG,
      '--reporter=json',
      `--outputFile=${output}`,
    ],
    { cwd: ROOT },
  ).catch(() => undefined); // a failing fixture exits 1; the report says what failed
  const report = JSON.parse(await readFile(output, 'utf8')) as {
    testResults: Array<{ assertionResults: Result[] }>;
  };
  return report.testResults.flatMap((file) => file.assertionResults);
}

describe('blast 443: describeSpec resolves the objects a spec file names, as the CLI loader does', () => {
  it('the CLI loader accepts the fixture spec: its project layer defines policy/blame:acme', async () => {
    const loaded = await loadSpecFile(SPEC);
    expect(loaded.ok ? [] : loaded.errors.map((issue) => issue.code)).toEqual([]);
  });

  it('registers the block test, not a failing "is a valid spec" test', async () => {
    const results = await runFixture('blast-objects-uses.fixture.ts');
    expect(results.map((result) => [result.fullName, result.status])).toEqual([
      ['blast-vitest-uses block 0: Where is my order?', 'passed'],
    ]);
  }, 120_000);
});
