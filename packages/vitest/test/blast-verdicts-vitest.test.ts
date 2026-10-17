import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Blast-radius audit of the not_run verdict (PR 428) in the vitest plugin: a block that was not run is never
 * a pass, and never reads as a block the agent failed.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG = fileURLToPath(new URL('./fixtures/vitest.config.ts', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

type Result = { fullName: string; status: string; failureMessages: string[] };

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

describe('blast radius: describeSpec on blocks not run', () => {
  let results: Result[] = [];

  it('no block test passes: a block not run is never a pass', async () => {
    results = await runFixture('blast-verdicts-not-run.fixture.ts');
    const blocks = results.filter((result) => result.fullName.includes(' block '));
    expect(blocks).toHaveLength(3);
    expect(blocks.every((result) => result.status !== 'passed')).toBe(true);
  }, 120_000);

  it('each block test is skipped, or fails naming the block not run and why', () => {
    const blocks = results.filter((result) => result.fullName.includes(' block '));
    expect(blocks).toHaveLength(3);
    for (const result of blocks) {
      if (result.status === 'skipped') continue;
      const [message = ''] = result.failureMessages;
      expect(message).toContain('not run');
      expect(message).toContain('toolStubs');
      expect(message).not.toMatch(/block \d+ failed/);
    }
  });
});
