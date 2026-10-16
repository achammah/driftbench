import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Blast radius of PR 447 on the command line: the shipped policy/blame and policy/placement objects join the
 * object registry when @agent-nexus/driftbench-checks loads. A spec may name them in `uses`. Each command runs in
 * its own process, as a user runs it, so a command that never loads the checks package is seen as it is.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const BIN = join(ROOT, 'packages/cli/src/bin.ts');
const SPEC = readFileSync(join(ROOT, 'examples/acme/specs/conversations/number-porting.yaml'), 'utf8');

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A fresh folder holding one spec that uses the shipped blame policy. */
function specFile(): string {
  const folder = mkdtempSync(join(tmpdir(), 'blast-blame-uses-'));
  folders.push(folder);
  const path = join(folder, 'uses-blame.yaml');
  writeFileSync(path, `uses:\n  blame: default\n${SPEC}`);
  return path;
}

function driftbench(args: string[]): { status: number | null; out: string } {
  const run = spawnSync(TSX, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('a spec that uses the shipped blame policy', { timeout: 180_000 }, () => {
  it('plans: campaign plan resolves policy/blame:default', () => {
    const run = driftbench(['campaign', 'plan', specFile()]);
    expect(run.out).not.toContain('OBJECT_UNKNOWN');
    expect(run.out).toContain('1 cell');
    expect(run.status).toBe(0);
  });

  it('lints the same as it plans: spec lint finds policy/blame:default', () => {
    const run = driftbench(['spec', 'lint', specFile()]);
    expect(run.out).not.toContain('OBJECT_UNKNOWN');
    expect(run.out).toContain('1 valid');
  });

  it('validates the same as it plans: spec validate finds policy/blame:default', () => {
    const run = driftbench(['spec', 'validate', specFile()]);
    expect(run.out).not.toContain('OBJECT_UNKNOWN');
    expect(run.status).toBe(0);
  });
});
