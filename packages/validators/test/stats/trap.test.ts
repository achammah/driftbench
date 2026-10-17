import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The trap of the bank's child process (bank/trap.ts): a package under test that reads a file, lists a folder or
 * starts a process while an item runs gets an error; the validator's own reads still work. Each case runs in a
 * node process of its own, because the trap patches `fs` for the whole process.
 */
const TRAP = fileURLToPath(new URL('../../src/ladders/stats/bank/trap.ts', import.meta.url));

function run(
  dir: string,
  packageSource: string,
  call: string,
  extra: Record<string, string> = {},
  entry = 'index.mjs',
): { out: string; code: number | null } {
  mkdirSync(join(dir, 'pkg'), { recursive: true });
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(dir, 'pkg', name), text);
  writeFileSync(join(dir, 'pkg', entry), packageSource);
  writeFileSync(join(dir, 'data.txt'), 'expected');
  const script = `
    import { installTrap } from ${JSON.stringify(TRAP)};
    import { readFileSync } from 'node:fs';
    installTrap([${JSON.stringify(join(dir, 'pkg'))}]);
    const own = readFileSync(${JSON.stringify(join(dir, 'data.txt'))}, 'utf8');
    const pkg = await import(${JSON.stringify(join(dir, 'pkg', entry))});
    let result;
    try { result = String(${call}); } catch (e) { result = 'THREW ' + e.message; }
    console.log(JSON.stringify({ own, result }));
  `;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
  });
  return { out: `${r.stdout}${r.stderr}`, code: r.status };
}

describe('the bank child trap', { timeout: 60_000 }, () => {
  const cases: [string, string, string][] = [
    [
      'a package that reads a file',
      "import { readFileSync } from 'node:fs'; export const f = (p) => readFileSync(p, 'utf8');",
      'pkg.f(',
    ],
    [
      'a package that lists a folder',
      "import { readdirSync } from 'node:fs'; export const f = (p) => readdirSync(p).length;",
      'pkg.f(',
    ],
    [
      'a package that starts a process',
      "import { execSync } from 'node:child_process'; export const f = () => execSync('echo hi').toString();",
      'pkg.f(',
    ],
    [
      'a package that reads through the promise API',
      "import { promises } from 'node:fs'; export const f = (p) => promises.readFile(p, 'utf8');",
      'pkg.f(',
    ],
  ];
  it.each(cases)('stops %s', (_name, source, callStart) => {
    const dir = mkdtempSync(join(tmpdir(), 'trap-'));
    try {
      const call = callStart + (callStart.endsWith('(') ? `${JSON.stringify(join(dir, 'data.txt'))})` : '');
      const r = run(dir, source, call);
      expect(r.out).toContain('THREW');
      expect(r.out).toContain('may not read files');
      expect(r.out).toContain('"own":"expected"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets node load the sibling files of a package, and still stops the package reading', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trap-'));
    try {
      const sibling = { 'helper.cjs': 'module.exports = { double: (x) => x * 2 };' };
      const loads = run(
        dir,
        "const { double } = require('./helper.cjs'); const fs = require('node:fs'); module.exports = { f: (x) => double(x), g: (p) => fs.readFileSync(p, 'utf8') };",
        'pkg.default.f(21)',
        sibling,
        'index.cjs',
      );
      expect(loads.out).toContain('"result":"42"');
      const reads = run(
        dir,
        "const fs = require('node:fs'); module.exports = { g: (p) => fs.readFileSync(p, 'utf8') };",
        `pkg.default.g(${JSON.stringify(join(dir, 'data.txt'))})`,
        sibling,
        'index.cjs',
      );
      expect(reads.out).toContain('may not read files');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a package that only computes alone, and the validator its own reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trap-'));
    try {
      const r = run(dir, 'export const f = (x) => x * 2;', 'pkg.f(21)');
      expect(r.out).toContain('"result":"42"');
      expect(r.out).toContain('"own":"expected"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
