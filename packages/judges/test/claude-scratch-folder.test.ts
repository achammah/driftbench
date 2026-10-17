import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClaudeCliJudge, withScratchFolder } from '../src/clients/claude-cli';
import { createDialectTransport } from '../src/clients/transport';

/**
 * A claude client works in an empty folder of its own. The folder exists while the command runs and is gone
 * when the call ends, on a result and on a failure alike: no folder outlives its call.
 */
const FAKE = `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.FAKE_LOG, process.cwd());
  if (process.env.FAKE_MODE === 'crash') { process.stderr.write('boom'); process.exit(3); }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"outcome":"pass","reasoning":"ok"}', total_cost_usd: 0.001 }));
});
`;
const REQUEST = {
  answerContract: 'legacy' as const,
  criterion: { name: 'c', rubric: 'r', pass: 'p', fail: 'f' },
  transcript: [{ role: 'user' as const, text: 'hello' }],
};

let dir: string;
let script: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'claude-scratch-test-'));
  script = join(dir, 'fake-claude.cjs');
  await writeFile(script, FAKE);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const env = (mode: string, log: string) => ({ ...process.env, FAKE_MODE: mode, FAKE_LOG: log });

it('removes the judge folder after a result and after a failed command, and makes a new one per call', async () => {
  const seen: string[] = [];
  for (const mode of ['pass', 'crash', 'pass']) {
    const log = join(dir, `judge-${seen.length}.txt`);
    const client = createClaudeCliJudge({
      model: 'haiku',
      command: process.execPath,
      commandArgs: [script],
      env: env(mode, log),
    });
    await client.judge(REQUEST).catch(() => undefined);
    const cwd = await readFile(log, 'utf8');
    seen.push(cwd);
    expect(cwd, mode).toContain('driftbench-claude-judge-');
    expect(existsSync(cwd), `${mode}: ${cwd}`).toBe(false);
  }
  expect(new Set(seen).size).toBe(3);
});

it('removes the transport folder after a result and after a failed command', async () => {
  for (const mode of ['pass', 'crash']) {
    const log = join(dir, `transport-${mode}.txt`);
    const transport = createDialectTransport({
      provider: 'claude-cli',
      model: 'fictional',
      env: env(mode, log),
      command: process.execPath,
      commandArgs: [script],
      sleep: async () => {},
    });
    await transport.complete({ system: 'system text', user: 'user text' }).catch(() => undefined);
    const cwd = await readFile(log, 'utf8');
    expect(cwd, mode).toContain('driftbench-claude-transport-');
    expect(existsSync(cwd), `${mode}: ${cwd}`).toBe(false);
  }
});

it('withScratchFolder hands over an existing empty folder and removes it when the work throws', async () => {
  let made = '';
  await expect(
    withScratchFolder('driftbench-scratch-probe-', async (folder) => {
      made = folder;
      expect(existsSync(folder)).toBe(true);
      throw new Error('work failed');
    }),
  ).rejects.toThrow('work failed');
  expect(existsSync(made)).toBe(false);
});
