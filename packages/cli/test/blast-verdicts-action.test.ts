import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Blast-radius audit (PR 428): the GitHub Action passes max-not-run to ci, keeps exit 3 and the verdict
 * not-run, and prints each spec not run in its summary. The CLI is a stand-in script that records its
 * arguments and writes a ci summary: no campaign runs.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const SUMMARY = {
  verdict: 'not-run',
  exitCode: 3,
  marginPoints: 10,
  reasons: ['1 spec of the candidate had blocks not run beyond --max-not-run 0.25'],
  aggregates: [],
  notRun: {
    threshold: 0.25,
    specs: [
      { specId: 'acme-tool-failure', notRun: 3, blocks: 3, share: 1, first: 'F block 0: capability, g' },
      { specId: 'acme-other', notRun: 1, blocks: 5, share: 0.2, first: 'T block 1: capability, h' },
    ],
    over: ['acme-tool-failure'],
  },
};

async function action(exit: number) {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-action-'));
  made.push(dir);
  const report = join(dir, 'report.json');
  const fake = join(dir, 'fake-driftbench.mjs');
  await writeFile(
    fake,
    `import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
writeFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(argv));
const out = argv[argv.indexOf('--out') + 1];
writeFileSync(out, ${JSON.stringify(JSON.stringify(SUMMARY))});
process.exit(${exit});
`,
  );
  await chmod(fake, 0o755);
  const result = spawnSync('bash', [join(ROOT, 'action/run.sh')], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: join(dir, 'output.txt'),
      GITHUB_STEP_SUMMARY: join(dir, 'step.md'),
      INPUT_SPECS: 'specs',
      INPUT_TARGET: 'function:acme-sales',
      INPUT_BASELINE: 'base.db',
      INPUT_MAX_NOT_RUN: '0.25',
      INPUT_REPORT_PATH: report,
      INPUT_DRIFTBENCH: `${process.execPath} ${fake}`,
    },
  });
  return {
    result,
    argv: JSON.parse(await readFile(join(dir, 'argv.json'), 'utf8')) as string[],
    output: await readFile(join(dir, 'output.txt'), 'utf8'),
    step: await readFile(join(dir, 'step.md'), 'utf8'),
  };
}

describe('blast radius: the ci GitHub Action on a not-run verdict', () => {
  it('passes --max-not-run, exits 3 with the verdict not-run, and lists every spec not run', async () => {
    const { result, argv, output, step } = await action(3);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(3);
    expect(argv.slice(argv.indexOf('--max-not-run'), argv.indexOf('--max-not-run') + 2)).toEqual([
      '--max-not-run',
      '0.25',
    ]);
    expect(output).toContain('verdict=not-run\n');
    expect(result.stdout).toContain(
      'Not run: acme-tool-failure, 3 of 3 blocks, over the threshold (F block 0: capability, g).',
    );
    expect(result.stdout).toContain('Not run: acme-other, 1 of 5 blocks (T block 1: capability, h).');
    expect(step).toContain('- Not run: acme-tool-failure, 3 of 3 blocks, over the threshold');
    expect(result.stdout).toContain('driftbench ci: verdict not-run, exit 3');
  });

  it('an empty max-not-run passes no flag, so ci keeps its default of 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-action-'));
    made.push(dir);
    const fake = join(dir, 'fake.mjs');
    await writeFile(
      fake,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));
process.exit(2);
`,
    );
    const result = spawnSync('bash', [join(ROOT, 'action/run.sh')], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: join(dir, 'output.txt'),
        INPUT_SPECS: 'specs',
        INPUT_TARGET: 'function:acme-sales',
        INPUT_BASELINE: 'base.db',
        INPUT_MAX_NOT_RUN: '',
        INPUT_DRIFTBENCH: `${process.execPath} ${fake}`,
      },
    });
    expect(result.status).toBe(2);
    const argv = JSON.parse(await readFile(join(dir, 'argv.json'), 'utf8')) as string[];
    expect(argv).not.toContain('--max-not-run');
  });
});
