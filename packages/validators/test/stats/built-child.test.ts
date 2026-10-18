import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { childCommand } from '../../src/ladders/stats/bank/isolate';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGE = join(ROOT, 'packages/validators');
let scratch: string;
let built: string;
let cli: string;
type Attack = 'clean' | 'file' | 'process';

/** Build the actual release script, including its public entry and its shared-chunk decisions. */
function build(name = 'compiled', mutation?: { file: string; change: (source: string) => string }): string {
  const mirror = join(scratch, name);
  const dir = join(mirror, 'packages/validators');
  mkdirSync(dir, { recursive: true });
  for (const sibling of readdirSync(join(ROOT, 'packages'))) {
    if (sibling !== 'validators')
      symlinkSync(join(ROOT, 'packages', sibling), join(mirror, 'packages', sibling), 'dir');
  }
  cpSync(join(PACKAGE, 'src'), join(dir, 'src'), { recursive: true });
  if (mutation) {
    const path = join(dir, 'src/ladders/stats/bank', mutation.file);
    const before = readFileSync(path, 'utf8');
    const after = mutation.change(before);
    expect(after).not.toBe(before);
    writeFileSync(path, after);
  }
  // Exercise real CLI/ladder/launcher code on one existing item, in this disposable copy only.
  const ladder = join(dir, 'src/ladders/stats/index.ts');
  const text = readFileSync(ladder, 'utf8');
  expect(text).toContain('options.filter ?? (() => true)');
  writeFileSync(
    ladder,
    text.replace(
      'options.filter ?? (() => true)',
      "options.filter ?? ((item) => item.id === 'reference.special.normalCdf')",
    ),
  );
  cpSync(join(PACKAGE, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE, 'fixtures'), join(dir, 'fixtures'), 'dir');
  symlinkSync(join(PACKAGE, 'node_modules'), join(dir, 'node_modules'), 'dir');
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: join(ROOT, 'tsconfig.base.json'),
      compilerOptions: { typeRoots: [join(ROOT, 'node_modules/@types')] },
    }),
  );
  const result = spawnSync('pnpm', ['run', 'build:runtime'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return dir;
}

function run(
  attack: Attack,
  throughCli = false,
  compiled = built,
  publicEntry = false,
): ReturnType<typeof spawnSync> {
  const root = mkdtempSync(join(scratch, `astra-stats-${attack}-`));
  const src = join(root, 'packages/stats/src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  symlinkSync(PACKAGE, join(root, 'packages/validators'), 'dir');
  writeFileSync(join(root, 'oracle.txt'), 'oracle loaded');
  const target = join(src, 'index.ts');
  writeFileSync(
    target,
    `export * from ${JSON.stringify(join(ROOT, 'packages/stats/src/index.ts'))};\n${
      attack === 'file'
        ? `import { readFileSync } from 'node:fs';\nconst oracle = readFileSync(${JSON.stringify(join(root, 'oracle.txt'))}, 'utf8');\nprocess.stdout.write('PRETRAP_READ ' + oracle + '\\n');`
        : attack === 'process'
          ? `import { execFileSync } from 'node:child_process';\nconst output = execFileSync(process.execPath, ['-e', 'process.stdout.write("spawned")']);\nprocess.stdout.write('PRETRAP_PROCESS ' + output + '\\n');`
          : ''
    }`,
  );
  const config = join(root, 'tsconfig.json');
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        paths: {
          '@agent-nexus/driftbench-stats': [throughCli ? join(ROOT, 'packages/stats/src/index.ts') : target],
          '@agent-nexus/driftbench-validators': [join(compiled, 'dist/index.js')],
          '@agent-nexus/driftbench': [join(ROOT, 'packages/cli/src/index.ts')],
          '@agent-nexus/driftbench-example-acme': [join(ROOT, 'examples/acme/src/package.ts')],
          '@agent-nexus/driftbench-adapters/contract': [join(ROOT, 'packages/adapters/src/contract.ts')],
          '@agent-nexus/driftbench-*': [join(ROOT, 'packages/*/src/index.ts')],
        },
      },
    }),
  );
  // childCommand resolves tsx from the target checkout; the temporary root shares the installed tools.
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  const env: NodeJS.ProcessEnv = { ...process.env, TSX_TSCONFIG_PATH: config };
  delete env.DRIFTBENCH_STATS_IMPL;
  delete env.INIT_CWD;
  if (throughCli) {
    env.DRIFTBENCH_STATS_IMPL = target;
    symlinkSync(join(ROOT, 'packages/stats/test'), join(root, 'packages/stats/test'), 'dir');
    mkdirSync(join(root, 'validators'));
    const floors = JSON.parse(readFileSync(join(ROOT, 'validators/floors.json'), 'utf8'));
    floors.floors.stats = 1;
    writeFileSync(join(root, 'validators/floors.json'), JSON.stringify(floors));
    return spawnSync(
      process.execPath,
      ['--import', 'tsx', join(cli, 'bin.js'), 'validate', 'stats', '--check-floor', '--json'],
      { cwd: root, env, encoding: 'utf8', timeout: 60_000 },
    );
  }
  return spawnSync(
    process.execPath,
    publicEntry
      ? [
          '--import',
          'tsx',
          '--input-type=module',
          '--eval',
          `import {statsBankChild} from ${JSON.stringify(pathToFileURL(join(compiled, 'dist/index.js')).href)}; await statsBankChild(['1', ${JSON.stringify(root)}, '0']);`,
        ]
      : childCommand(pathToFileURL(join(compiled, 'dist/index.js')).href, root, ['1', root, '0']),
    { cwd: ROOT, env, input: '[]', encoding: 'utf8', timeout: 60_000 },
  );
}

describe('the release-built statistics child', { timeout: 180_000 }, () => {
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'astra-stats-built-child-'));
    built = build();
    cli = join(scratch, 'compiled-cli');
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'tsup',
        'src/index.ts',
        'src/bin.ts',
        '--format',
        'esm',
        '--target',
        'node22',
        '--out-dir',
        cli,
      ],
      { cwd: join(ROOT, 'packages/cli'), encoding: 'utf8', timeout: 120_000 },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    symlinkSync(join(ROOT, 'packages/cli/node_modules'), join(cli, 'node_modules'), 'dir');
    writeFileSync(join(cli, 'package.json'), '{"type":"module"}');
  }, 180_000);
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it.each([false, true])('runs the protected compiled path (through built CLI: %s)', (throughCli) => {
    for (const attack of ['clean', 'file', 'process'] as const) {
      const result = run(attack, throughCli);
      const output = String(result.stdout) + String(result.stderr);
      expect(result.status, output).toBe(attack === 'clean' ? 0 : 1);
      if (attack !== 'clean') {
        expect(output).toContain(throughCli ? 'child process died (exit 1)' : 'may not read files');
        if (throughCli) expect(output).toContain('dist/stats-bank/child.js');
      }
      expect(output).not.toContain('PRETRAP_');
    }
  });

  it('never selects the public index as the built child command', () => {
    const command = childCommand(pathToFileURL(join(built, 'dist/index.js')).href, ROOT, ['1', ROOT, '0']);
    expect(command).toContain(join(built, 'dist/stats-bank/child.js'));
    expect(command).not.toContain('--eval');
    expect(command.join(' ')).not.toContain('index.js');
  });

  it('detects the old public-entry route mutant on the same compiled package', () => {
    expect(run('clean', false, built, true).status).toBe(0);
    for (const attack of ['file', 'process'] as const) {
      const result = run(attack, false, built, true);
      // The old route violates the protected-child contract: it completes the planted operation and exits 0.
      expect(result.status, String(result.stderr)).toBe(0);
      expect(String(result.stdout)).toContain('PRETRAP_');
    }
  });

  it.each([
    {
      name: 'static-target',
      file: 'child.ts',
      change: (source: string) => `import '@agent-nexus/driftbench-stats';\n${source}`,
    },
    { name: 'static-bank', file: 'child.ts', change: (source: string) => `import './index';\n${source}` },
    {
      name: 'bundled-wrapper-frame',
      file: 'trap.ts',
      change: (source: string) => source.replace('Error.captureStackTrace(error, wrapper);', ''),
    },
  ])('detects the compiled $name mutant', ({ name, file, change }) => {
    const mutant = build(name, { file, change });
    expect(run('clean', false, mutant).status).toBe(0);
    for (const attack of ['file', 'process'] as const) {
      const result = run(attack, false, mutant);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(String(result.stdout)).toContain('PRETRAP_');
    }
  });
});
