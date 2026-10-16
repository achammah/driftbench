import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Blast radius of the value-check ladder (PR 459) on `driftbench spec lint`, run as the bin runs, in its own
 * process: the CLI initializes `policy/value-check:default` before loading a spec, so every command accepts
 * the shipped object the help topic documents
 * (`uses: { value_check: { extends: default, ... } }`). Fictional data only.
 */

const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function lint(uses: string | undefined): Promise<{ status: number | null; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'blast-ladder-lint-'));
  made.push(dir);
  const file = join(dir, 'coverage.yaml');
  await writeFile(
    file,
    `id: blast-ladder-lint
target: { adapter: function, agent: acme-sales }
${uses === undefined ? '' : `uses: ${uses}\n`}blocks:
  - user: Do you cover 88 Summit Avenue, Acmeville?
    expect:
      tools:
        - label: coverage.check
          input: { address: 88 Summit Avenue, Acmeville }
          compare: { address: outcome }
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `process.argv = ['node', 'driftbench', 'spec', 'lint', ${JSON.stringify(file)}];
await import(${JSON.stringify(BIN)});`,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe('driftbench spec lint and the shipped value-check policy (PR 459)', () => {
  it('control: a spec with a compare mode by argument name and no policy lints clean', async () => {
    const { status, out } = await lint(undefined);
    expect(out).toContain('1 valid, 0 invalid');
    expect(status).toBe(0);
  }, 120_000);

  it('accepts a spec that names the shipped policy by id', async () => {
    const { status, out } = await lint('{ value_check: default }');
    expect(out).not.toContain('OBJECT_UNKNOWN');
    expect(status).toBe(0);
  }, 120_000);

  it('accepts the inline object of the help topic, which extends the shipped default', async () => {
    const { status, out } = await lint(
      '{ value_check: { extends: default, items: [{ id: rung1_outcome, enabled: false }] } }',
    );
    expect(out).not.toContain('OBJECT_UNKNOWN');
    expect(status).toBe(0);
  }, 120_000);
});
