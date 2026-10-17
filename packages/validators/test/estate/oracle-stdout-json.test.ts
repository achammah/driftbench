import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cli, jsonOut } from '../../src/ladders/estate/bank/bench';
import { FIXTURE, runOnFakeDetailed } from '../../src/ladders/estate/bank/fixture-suite';

const folders: string[] = [];
afterEach(async () => {
  while (folders.length) await rm(folders.pop() as string, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oracle-stdout-'));
  folders.push(dir);
  return dir;
}

describe('an oracle reads the JSON a command printed on standard output only', { timeout: 120_000 }, () => {
  it('keeps the error stream out of the document', () => {
    expect(jsonOut({ stdout: '{"runs": []}\n' })).toEqual({ runs: [] });
    expect(jsonOut({ stdout: 'a notice\n{"runs": [1]}\n' })).toEqual({ runs: [1] });
    expect(jsonOut({ stdout: '' })).toBeUndefined();
    expect(jsonOut({ stdout: '{"runs": [' })).toBeUndefined();
  });

  it('returns the two streams apart', async () => {
    const dir = await scratch();
    const warn = join(dir, 'warn.cjs');
    await writeFile(warn, 'process.emitWarning(\'a hand-written warning {"kept": false}\');\n');
    const before = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `--require ${warn}`;
    try {
      const result = cli(['estate', 'unit', '--help']);
      expect(result.stderr).toContain('a hand-written warning');
      expect(result.stdout).not.toContain('a hand-written warning');
      expect(result.out).toBe(`${result.stdout}${result.stderr}`);
    } finally {
      if (before === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = before;
    }
  });

  it('still reads a run when a warning follows the JSON on the error stream', async () => {
    const dir = await scratch();
    const warn = join(dir, 'warn.cjs');
    await writeFile(warn, `process.on('exit', () => process.stderr.write('late notice {"x": 1}\\n'));\n`);
    const live = join(FIXTURE, 'generated/specs/live/hazard_recovery');
    const name = (await readdir(live)).filter((entry) => entry.endsWith('.yaml')).sort()[0] as string;
    const spec = join(live, name);
    expect((await readFile(spec, 'utf8')).length).toBeGreaterThan(0);
    const before = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `--require ${warn}`;
    try {
      const run = [
        ...runOnFakeDetailed(FIXTURE, [spec], join(dir, 'runs.db'), join(FIXTURE, 'approved.yaml')).values(),
      ][0];
      expect(run).toMatchObject({ completed: true });
    } finally {
      if (before === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = before;
    }
  });
});
