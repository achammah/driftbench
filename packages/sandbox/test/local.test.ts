import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionRecord, WorkspaceDiff, type WorkspaceSnapshot } from '@agent-nexus/driftbench-core';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_READ_BYTES,
  diffSnapshots,
  type LocalProviderOptions,
  type LocalSandbox,
  localProvider,
  SandboxLimitError,
  SandboxPathError,
  TIMEOUT_EXIT_CODE,
} from '@agent-nexus/driftbench-sandbox';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let parent: string;
let outside: string;
const opened: LocalSandbox[] = [];

beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-sandbox-test-')));
  outside = join(parent, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'outside the workspace');
});
afterEach(async () => {
  for (let box = opened.pop(); box !== undefined; box = opened.pop()) await box.destroy();
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

async function sandbox(options: LocalProviderOptions = {}, keep = false): Promise<LocalSandbox> {
  const box = (await localProvider({ dir: join(parent, 'boxes'), ...options }).create({
    keep,
  })) as LocalSandbox;
  opened.push(box);
  return box;
}

describe('the local provider', () => {
  it('is available and gives a fresh empty folder per sandbox, flagged as weak isolation', async () => {
    const provider = localProvider({ dir: join(parent, 'boxes') });
    expect(provider.kind).toBe('local');
    expect(await provider.available()).toBe(true);
    const a = await sandbox();
    const b = await sandbox();
    expect(a.root).not.toBe(b.root);
    expect(a.root.startsWith(join(parent, 'boxes'))).toBe(true);
    expect(a.kind).toBe('local');
    expect(a.isolation).toBe('weak');
    expect(await a.listFiles()).toEqual([]);
    expect(await readdir(b.root)).toEqual([]);
  });
});

describe('seed', () => {
  it('writes binary files byte for byte from their base64, a byte-order mark kept', async () => {
    const everyByte = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte));
    const bomCsv = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('plan_id,name\n')]);
    const box = await sandbox();
    await box.seed({
      files: { 'notes.txt': 'plain text' },
      binary: {
        'in/every-byte.bin': everyByte.toString('base64'),
        'in/plans.csv': bomCsv.toString('base64'),
        'in/empty.bin': '',
      },
    });
    expect(await box.listFiles()).toEqual(['in/empty.bin', 'in/every-byte.bin', 'in/plans.csv', 'notes.txt']);
    expect(Buffer.from(await box.readFile('in/every-byte.bin')).equals(everyByte)).toBe(true);
    expect(Buffer.from(await box.readFile('in/plans.csv')).equals(bomCsv)).toBe(true);
    expect((await box.readFile('in/empty.bin')).byteLength).toBe(0);
    await expect(box.seed({ binary: { '../escape.bin': 'AAAA' } })).rejects.toBeInstanceOf(SandboxPathError);
  });

  it('copies the from folder, then writes files over it at nested paths', async () => {
    const from = join(parent, 'seed-from');
    await mkdir(join(from, 'data', 'deep'), { recursive: true });
    await writeFile(join(from, 'catalog.csv'), 'plan_id,name\nmobile-s,Acme Mobile S\n');
    await writeFile(join(from, 'data', 'deep', 'notes.txt'), 'from the folder');
    await symlink('catalog.csv', join(from, 'catalog-link.csv'));
    const box = await sandbox();
    await box.seed({ from, files: { 'data/deep/notes.txt': 'from files', 'out/empty.txt': '' } });
    expect(await box.listFiles()).toEqual([
      'catalog-link.csv',
      'catalog.csv',
      'data/deep/notes.txt',
      'out/empty.txt',
    ]);
    expect(await readFile(join(box.root, 'data', 'deep', 'notes.txt'), 'utf8')).toBe('from files');
    expect(await readFile(join(box.root, 'catalog-link.csv'), 'utf8')).toContain('Acme Mobile S');
  });

  it('refuses a path that leaves the workspace and writes nothing outside', async () => {
    const box = await sandbox();
    for (const path of ['../escape.txt', '/tmp/escape.txt', 'a/../../escape.txt', '']) {
      await expect(box.seed({ files: { [path]: 'x' } })).rejects.toBeInstanceOf(SandboxPathError);
    }
    expect(existsSync(join(box.root, '..', 'escape.txt'))).toBe(false);
  });

  it('replaces a planted link to a file instead of writing through it', async () => {
    const box = await sandbox();
    await symlink(join(outside, 'secret.txt'), join(box.root, 'trap.txt'));
    await box.seed({ files: { 'trap.txt': 'written in the workspace' } });
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('outside the workspace');
    expect(await readFile(join(box.root, 'trap.txt'), 'utf8')).toBe('written in the workspace');
  });

  it('refuses to write through a planted link to a folder', async () => {
    const box = await sandbox();
    await symlink(outside, join(box.root, 'linked'));
    await expect(box.seed({ files: { 'linked/planted.txt': 'x' } })).rejects.toBeInstanceOf(SandboxPathError);
    expect(existsSync(join(outside, 'planted.txt'))).toBe(false);
  });
});

describe('snapshot and diff', () => {
  it('hashes every file with sha256 and size, and skips node_modules and .git at any depth', async () => {
    const box = await sandbox();
    await box.seed({
      files: {
        'a.txt': 'alpha',
        'empty.txt': '',
        'sub/b.txt': 'beta',
        'node_modules/pkg/index.js': 'skipped',
        'sub/node_modules/x.js': 'skipped',
        '.git/HEAD': 'skipped',
        'sub/.git': 'gitdir: skipped',
      },
    });
    const snapshot = await box.snapshot();
    expect(Number.isNaN(Date.parse(snapshot.takenAt))).toBe(false);
    expect(snapshot.files).toEqual({
      'a.txt': { sha256: sha256('alpha'), bytes: 5 },
      'empty.txt': { sha256: sha256(''), bytes: 0 },
      'sub/b.txt': { sha256: sha256('beta'), bytes: 4 },
    });
    expect(await box.listFiles()).toEqual(['a.txt', 'empty.txt', 'sub/b.txt']);
  });

  it('records a link by its target text and never follows it', async () => {
    const box = await sandbox();
    const target = join(outside, 'secret.txt');
    await symlink(target, join(box.root, 'link.txt'));
    const snapshot = await box.snapshot();
    expect(snapshot.files['link.txt']).toEqual({ sha256: sha256(target), bytes: Buffer.byteLength(target) });
  });

  it('names created, changed and deleted files, each list sorted', async () => {
    const box = await sandbox();
    await box.seed({ files: { 'a.txt': 'one', 'c.txt': 'gone soon', 'd.txt': 'untouched', 'b/x.txt': 'x' } });
    const before = await box.snapshot();
    await writeFile(join(box.root, 'z.txt'), 'new');
    await mkdir(join(box.root, 'b', 'a'));
    await writeFile(join(box.root, 'b', 'a', 'new.txt'), 'new');
    await writeFile(join(box.root, 'a.txt'), 'two');
    await writeFile(join(box.root, 'b', 'x.txt'), 'x');
    await rm(join(box.root, 'c.txt'));
    const diff = box.diff(before, await box.snapshot());
    expect(WorkspaceDiff.parse(diff)).toEqual({
      created: ['b/a/new.txt', 'z.txt'],
      changed: ['a.txt'],
      deleted: ['c.txt'],
    });
  });

  it('gives the same diff whatever the key order, nothing for equal snapshots, and handles odd names', async () => {
    const fact = (text: string) => ({ sha256: sha256(text), bytes: text.length });
    const before: WorkspaceSnapshot = {
      takenAt: '2026-01-01T00:00:00.000Z',
      files: Object.fromEntries([
        ['b.txt', fact('b')],
        ['a.txt', fact('a')],
        ['constructor', fact('c')],
      ]),
    };
    const after: WorkspaceSnapshot = {
      takenAt: '2026-01-01T00:00:01.000Z',
      files: Object.fromEntries([
        ['__proto__', fact('p')],
        ['a.txt', fact('a2')],
        ['B.txt', fact('B')],
      ]),
    };
    const reordered: WorkspaceSnapshot = {
      ...after,
      files: Object.fromEntries(Object.entries(after.files).reverse()),
    };
    const expected = {
      created: ['B.txt', '__proto__'],
      changed: ['a.txt'],
      deleted: ['b.txt', 'constructor'],
    };
    expect(diffSnapshots(before, after)).toEqual(expected);
    expect(diffSnapshots(before, reordered)).toEqual(expected);
    expect(diffSnapshots(after, after)).toEqual({ created: [], changed: [], deleted: [] });

    const box = await sandbox();
    const empty = await box.snapshot();
    // fromEntries makes __proto__ an own key, as a parsed spec would.
    await box.seed({
      files: Object.fromEntries([
        ['__proto__', 'p'],
        ['constructor', 'c'],
      ]),
    });
    expect(box.diff(empty, await box.snapshot()).created).toEqual(['__proto__', 'constructor']);
  });

  it('does not count a rewrite with the same content as a change', async () => {
    const box = await sandbox();
    await box.seed({ files: { 'a.txt': 'same' } });
    const before = await box.snapshot();
    await writeFile(join(box.root, 'a.txt'), 'same');
    expect(box.diff(before, await box.snapshot())).toEqual({ created: [], changed: [], deleted: [] });
  });
});

describe('the bounded walk', () => {
  it('stops past the file limit', async () => {
    const box = await sandbox({ limits: { maxFiles: 3 } });
    await box.seed({ files: { a: '1', b: '2', c: '3' } });
    expect(Object.keys((await box.snapshot()).files)).toHaveLength(3);
    await box.seed({ files: { d: '4' } });
    await expect(box.snapshot()).rejects.toThrow(/more than 3 files/);
    await expect(box.listFiles()).rejects.toBeInstanceOf(SandboxLimitError);
  });

  it('stops past the depth limit', async () => {
    const box = await sandbox({ limits: { maxDepth: 2 } });
    await box.seed({ files: { 'a/b/ok.txt': 'two levels' } });
    expect(await box.listFiles()).toEqual(['a/b/ok.txt']);
    await box.seed({ files: { 'a/b/c/deep.txt': 'three levels' } });
    await expect(box.snapshot()).rejects.toThrow(/deeper than 2 folder levels/);
  });

  it('stops past the byte limit', async () => {
    const box = await sandbox({ limits: { maxBytes: 10 } });
    await box.seed({ files: { 'a.txt': '0123456789' } });
    expect((await box.snapshot()).files['a.txt']?.bytes).toBe(10);
    await box.seed({ files: { 'b.txt': 'x' } });
    await expect(box.snapshot()).rejects.toBeInstanceOf(SandboxLimitError);
  });
});

describe('exec', () => {
  it('reports the exit code, both outputs, the start time and the latency', async () => {
    const box = await sandbox();
    const record = await box.exec('printf out; printf err >&2; exit 3');
    expect(ExecutionRecord.parse(record)).toEqual(record);
    expect(record).toMatchObject({
      command: 'printf out; printf err >&2; exit 3',
      exitCode: 3,
      stdout: 'out',
      stderr: 'err',
    });
    expect(record.truncated).toBeUndefined();
    expect(Number.isNaN(Date.parse(record.startedAt ?? ''))).toBe(false);
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('runs in the given folder with the given variables and input', async () => {
    const box = await sandbox();
    await box.seed({ files: { 'sub/keep.txt': '' } });
    const record = await box.exec('pwd; printf "%s\\n" "$GREETING"; cat', {
      cwd: 'sub',
      env: { GREETING: 'hello' },
      stdin: 'from stdin',
    });
    expect(record.stdout).toBe(`${join(box.root, 'sub')}\nhello\nfrom stdin`);
    expect((await box.exec('pwd', { cwd: box.root })).stdout).toBe(`${box.root}\n`);
  });

  it('passes no host variable outside the short list', async () => {
    const box = await sandbox();
    process.env.DRIFTBENCH_TEST_SECRET = 'must not leak';
    try {
      const record = await box.exec(
        'if [ -z "$DRIFTBENCH_TEST_SECRET" ]; then printf absent; fi; command -v sh >/dev/null',
      );
      expect(record).toMatchObject({ stdout: 'absent', exitCode: 0 });
    } finally {
      delete process.env.DRIFTBENCH_TEST_SECRET;
    }
  });

  it('refuses a working folder outside the workspace or missing', async () => {
    const box = await sandbox();
    await expect(box.exec('pwd', { cwd: '..' })).rejects.toBeInstanceOf(SandboxPathError);
    await expect(box.exec('pwd', { cwd: outside })).rejects.toBeInstanceOf(SandboxPathError);
    await expect(box.exec('pwd', { cwd: 'missing' })).rejects.toThrow(/does not exist/);
  });

  it('cuts stdout and stderr at maxOutputBytes and says so', async () => {
    const box = await sandbox();
    const out = await box.exec('yes abcd | head -c 5000', { maxOutputBytes: 1000 });
    expect(Buffer.byteLength(out.stdout ?? '')).toBe(1000);
    expect(out.truncated).toBe(true);
    expect(out.exitCode).toBe(0);
    const err = await box.exec('yes abcd | head -c 5000 >&2', { maxOutputBytes: 1000 });
    expect(Buffer.byteLength(err.stderr ?? '')).toBe(1000);
    expect(err.truncated).toBe(true);
    const fits = await box.exec('yes abcd | head -c 1000', { maxOutputBytes: 1000 });
    expect(fits.truncated).toBeUndefined();
  });

  it('cuts at 10 MB by default', async () => {
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBe(10 * 1024 * 1024);
    const box = await sandbox();
    const record = await box.exec(`yes 0123456789 | head -c ${DEFAULT_MAX_OUTPUT_BYTES + 100}`);
    expect(Buffer.byteLength(record.stdout ?? '')).toBe(DEFAULT_MAX_OUTPUT_BYTES);
    expect(record.truncated).toBe(true);
  });

  it('never cuts a character in half', async () => {
    const box = await sandbox();
    const record = await box.exec("printf 'ééé'", { maxOutputBytes: 5 });
    expect(record.stdout).toBe('éé');
    expect(record.truncated).toBe(true);
  });

  it('kills the command and everything it started at the timeout', async () => {
    const box = await sandbox();
    const record = await box.exec('(sleep 1; echo late > late.txt) & sleep 30', { timeoutMs: 300 });
    expect(record.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(record.stderr).toContain('timed out after 300 ms');
    await pause(1500);
    expect(existsSync(join(box.root, 'late.txt'))).toBe(false);
  });

  it('kills what a finished command left running', async () => {
    const box = await sandbox();
    const record = await box.exec('(sleep 1; echo late > late.txt) & echo done');
    expect(record).toMatchObject({ exitCode: 0, stdout: 'done\n' });
    await pause(1500);
    expect(existsSync(join(box.root, 'late.txt'))).toBe(false);
  });

  it('kills a child that left the process group of the command, at the exit and at the timeout', async () => {
    const box = await sandbox();
    const leave = (file: string) =>
      `"${process.execPath}" -e "require('node:child_process').spawn('/bin/sh', ['-c', 'sleep 0.5; echo late > ${file}'], { stdio: 'ignore', detached: true }).unref()"`;
    const exited = await box.exec(leave('exit.txt'));
    expect(exited.exitCode).toBe(0);
    const slow = await box.exec(`${leave('timeout.txt')}; sleep 30`, { timeoutMs: 300 });
    expect(slow.exitCode).toBe(TIMEOUT_EXIT_CODE);
    await pause(1500);
    expect(existsSync(join(box.root, 'exit.txt'))).toBe(false);
    expect(existsSync(join(box.root, 'timeout.txt'))).toBe(false);
  });

  it('kills a child that left the process group when the host lists working folders slowly', async () => {
    // macOS has no /proc: the working folder of a process costs a subprocess, and lsof takes time for each
    // process it is asked about. The first look must ask about the few processes the system adopted, not
    // about every young process on the host, or a child that wakes within a second has run.
    const stubs = join(parent, 'slow-lsof');
    await mkdir(stubs, { recursive: true });
    await writeFile(
      join(stubs, 'lsof'),
      [
        `#!${process.execPath}`,
        "const { spawnSync } = require('node:child_process');",
        'const args = process.argv.slice(2);',
        "const at = args.indexOf('-p');",
        "const asked = at >= 0 ? args[at + 1].split(',').length : 100;",
        'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, asked * 100);',
        "const real = spawnSync('/usr/sbin/lsof', args, { stdio: 'inherit' });",
        'process.exit(real.status ?? 1);',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const path = process.env.PATH;
    process.env.PATH = `${stubs}:${path ?? ''}`;
    try {
      const box = await sandbox();
      const leave = (file: string) =>
        `"${process.execPath}" -e "require('node:child_process').spawn('/bin/sh', ['-c', 'sleep 1; echo late > ${file}'], { stdio: 'ignore', detached: true }).unref()"`;
      expect((await box.exec(leave('exit.txt'))).exitCode).toBe(0);
      const slow = await box.exec(`${leave('timeout.txt')}; sleep 30`, { timeoutMs: 300 });
      expect(slow.exitCode).toBe(TIMEOUT_EXIT_CODE);
      await pause(1800);
      expect(existsSync(join(box.root, 'exit.txt'))).toBe(false);
      expect(existsSync(join(box.root, 'timeout.txt'))).toBe(false);
    } finally {
      process.env.PATH = path;
    }
  }, 30_000);

  it('reports a command killed by a signal as 128 plus the signal number', async () => {
    const box = await sandbox();
    expect((await box.exec('kill -TERM $$')).exitCode).toBe(143);
  });
});

describe('readFile', () => {
  it('reads a file as bytes', async () => {
    const box = await sandbox();
    await box.seed({ files: { 'out/sheet.csv': 'plan,price\nmobile-s,15\n' } });
    const bytes = await box.readFile('out/sheet.csv');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes).toString('utf8')).toBe('plan,price\nmobile-s,15\n');
  });

  it('refuses a file past the bound, 100 MB by default', async () => {
    expect(DEFAULT_MAX_READ_BYTES).toBe(100 * 1024 * 1024);
    const box = await sandbox();
    await box.seed({ files: { 'five.txt': '12345' } });
    expect((await box.readFile('five.txt', 5)).length).toBe(5);
    await expect(box.readFile('five.txt', 4)).rejects.toBeInstanceOf(SandboxLimitError);
  });

  it('refuses a path outside the workspace, through a link too, and a folder', async () => {
    const box = await sandbox();
    await box.seed({ files: { 'inside.txt': 'inside', 'sub/x.txt': 'x' } });
    await symlink(join(outside, 'secret.txt'), join(box.root, 'escape.txt'));
    await symlink('inside.txt', join(box.root, 'alias.txt'));
    await expect(box.readFile('../outside/secret.txt')).rejects.toBeInstanceOf(SandboxPathError);
    await expect(box.readFile('escape.txt')).rejects.toBeInstanceOf(SandboxPathError);
    await expect(box.readFile('sub')).rejects.toBeInstanceOf(SandboxPathError);
    expect(Buffer.from(await box.readFile('alias.txt')).toString('utf8')).toBe('inside');
  });
});

describe('destroy and keep', () => {
  it('removes the folder, refuses commands after, and is safe to call twice', async () => {
    const box = await sandbox();
    await box.seed({ files: { 'a.txt': 'a' } });
    await box.destroy();
    expect(existsSync(box.root)).toBe(false);
    await expect(box.destroy()).resolves.toBeUndefined();
    await expect(box.exec('true')).rejects.toThrow(/destroyed/);
  });

  it('keeps the folder and its files when created with keep', async () => {
    const box = await sandbox({}, true);
    await box.seed({ files: { 'a.txt': 'kept' } });
    await box.destroy();
    await box.destroy();
    expect(await readFile(join(box.root, 'a.txt'), 'utf8')).toBe('kept');
    await rm(box.root, { recursive: true, force: true });
  });
});
