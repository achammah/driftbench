import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  diffFiles,
  isRegistryKind,
  objectRegistryKind,
  openMemoryStore,
  openStore,
  parseVersionRef,
  type RegistryFile,
  type RegistryKind,
  readTree,
  restoreFiles,
  type SqliteStore,
} from '../src/index';
import { isVersionRecord } from '../src/registry';
import { storeError, tempDir } from './fixtures';

const text = (value: string) => new TextEncoder().encode(value);
/** Bytes no text decoder keeps: a stray continuation byte, a NUL and a lone CR. */
const BINARY = new Uint8Array([0x89, 0x00, 0x0d, 0xff, 0x80, 0x41]);

const V1: RegistryFile[] = [
  { path: 'conversations/upgrade.yaml', bytes: text('id: acme-upgrade\nblocks:\n  - user: Hello\n') },
  { path: 'README.md', bytes: text('Acme specs, fictional data.\n') },
  { path: 'assets/logo.bin', bytes: BINARY },
];

let store: SqliteStore;
let dir: string;

beforeEach(async () => {
  store = openMemoryStore();
  dir = await tempDir();
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the registry', () => {
  it('numbers versions per name and kind, and gives each a content hash', async () => {
    const first = await store.pushVersion('dataset', 'acme-specs', V1, { source: '/work/specs' });
    expect(first.created).toBe(true);
    expect(first.version).toMatchObject({
      kind: 'dataset',
      name: 'acme-specs',
      version: 1,
      source: '/work/specs',
    });
    expect(first.version.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.version.files.map((file) => file.path)).toEqual([
      'README.md',
      'assets/logo.bin',
      'conversations/upgrade.yaml',
    ]);
    expect(first.version.files[1]).toEqual({ path: 'assets/logo.bin', sha256: sha(BINARY), size: 6 });

    const changed = [...V1.slice(0, 2), { path: 'assets/logo.bin', bytes: new Uint8Array([1, 2, 3]) }];
    const second = await store.pushVersion('dataset', 'acme-specs', changed);
    expect(second.version.version).toBe(2);
    expect(second.version.hash).not.toBe(first.version.hash);
    const prompt = await store.pushVersion('prompt', 'acme-specs', V1.slice(1, 2));
    expect(prompt.version.version).toBe(1);
  });

  it('returns the version it holds when the same content is pushed again: a version is immutable', async () => {
    const first = await store.pushVersion('dataset', 'acme-specs', V1);
    const again = await store.pushVersion('dataset', 'acme-specs', [...V1].reverse(), { note: 'again' });
    expect(again.created).toBe(false);
    expect(again.version).toEqual(first.version);
    expect((await store.listVersions('dataset', 'acme-specs')).map((each) => each.version)).toEqual([1]);
  });

  it('finds a version by number, by hash prefix, as latest, and lists them oldest first', async () => {
    const one = (await store.pushVersion('dataset', 'acme-specs', V1)).version;
    const two = (await store.pushVersion('dataset', 'acme-specs', V1.slice(0, 1))).version;
    await store.pushVersion('prompt', 'acme-sales', V1.slice(1, 2));
    expect(await store.getVersion('dataset', 'acme-specs')).toEqual(two);
    expect(await store.getVersion('dataset', 'acme-specs', 'latest')).toEqual(two);
    expect(await store.getVersion('dataset', 'acme-specs', '1')).toEqual(one);
    expect(await store.getVersion('dataset', 'acme-specs', one.hash.slice(0, 8))).toEqual(one);
    expect(await store.getVersion('dataset', 'acme-specs', '3')).toBeUndefined();
    expect(await store.getVersion('dataset', 'acme-other')).toBeUndefined();
    expect((await store.listVersions('dataset')).map((each) => `${each.name}@${each.version}`)).toEqual([
      'acme-specs@1',
      'acme-specs@2',
    ]);
    expect((await store.listVersions('prompt')).map((each) => each.name)).toEqual(['acme-sales']);
  });

  it('gives back the exact bytes of every file', async () => {
    const { version } = await store.pushVersion('dataset', 'acme-specs', V1);
    const files = await store.readVersionFiles(version);
    expect(files.map((file) => [file.path, Buffer.from(file.bytes).toString('hex')])).toEqual(
      [...V1]
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((file) => [file.path, Buffer.from(file.bytes).toString('hex')]),
    );
  });

  it('refuses a bad name, a path that leaves the folder, two files with one path and an empty version', async () => {
    const bytes = text('x');
    expect((await storeError(() => store.pushVersion('dataset', '../up', V1))).code).toBe('INVALID_RECORD');
    for (const path of ['../escape.yaml', '/etc/passwd', 'a/./b', 'a\\b', '']) {
      const error = await storeError(() => store.pushVersion('dataset', 'acme-specs', [{ path, bytes }]));
      expect(error.code, path).toBe('INVALID_RECORD');
    }
    const twice = [
      { path: 'a.yaml', bytes },
      { path: 'a.yaml', bytes },
    ];
    expect((await storeError(() => store.pushVersion('dataset', 'acme-specs', twice))).message).toContain(
      'a.yaml twice',
    );
    expect((await storeError(() => store.pushVersion('dataset', 'acme-specs', []))).code).toBe(
      'INVALID_RECORD',
    );
    expect(await store.listVersions('dataset')).toEqual([]);
  });

  it('versions framework objects under object.<kind>, and refuses a kind that is not one', async () => {
    const blame = [{ path: 'acme.yaml', bytes: text('kind: policy/blame\nid: acme\nextends: default\n') }];
    const pushed = await store.pushVersion(objectRegistryKind('policy/blame'), 'acme', blame, {
      single: true,
    });
    expect(pushed.version).toMatchObject({ kind: 'object.policy.blame', name: 'acme', version: 1 });
    expect((await store.listVersions('object.policy.blame')).map((each) => each.name)).toEqual(['acme']);
    expect(await store.listVersions('dataset')).toEqual([]);
    expect(isVersionRecord(pushed.version)).toBe(true);
    for (const kind of [
      'object.',
      'object.Policy.blame',
      'object.policy..blame',
      'object.a.b.c',
      'objects.persona',
      'policy',
    ]) {
      const error = await storeError(() => store.pushVersion(kind as RegistryKind, 'acme', blame));
      expect(error.code, kind).toBe('INVALID_RECORD');
      expect(isRegistryKind(kind), kind).toBe(false);
    }
    expect(isRegistryKind('object.persona-defaults')).toBe(true);
    expect(() => objectRegistryKind('Policy/blame')).toThrow('not an object kind');
  });

  it('raises CORRUPT_ROW when a stored file no longer matches its hash', async () => {
    const path = join(dir, 'store.db');
    const fileStore = openStore(path);
    try {
      const { version } = await fileStore.pushVersion('dataset', 'acme-specs', V1);
      const raw = new DatabaseSync(path);
      raw.prepare('UPDATE blobs SET bytes = ? WHERE sha256 = ?').run(text('tampered'), sha(BINARY));
      raw.close();
      const error = await storeError(() => fileStore.readVersionFiles(version));
      expect(error.code).toBe('CORRUPT_ROW');
      expect(error.message).toContain(
        `assets/logo.bin of dataset acme-specs@1 no longer hashes to ${sha(BINARY)}`,
      );
    } finally {
      await fileStore.close();
    }
  });
});

describe('parseVersionRef', () => {
  it('splits a name from its version', () => {
    expect(parseVersionRef('acme-specs')).toEqual({ name: 'acme-specs' });
    expect(parseVersionRef('acme-specs@3')).toEqual({ name: 'acme-specs', ref: '3' });
    expect(parseVersionRef('acme-specs@latest')).toEqual({ name: 'acme-specs', ref: 'latest' });
  });
});

describe('trees on disk', () => {
  it('reads a folder, skipping dot entries and node_modules, and restores it byte for byte', async () => {
    const source = join(dir, 'specs');
    await mkdir(join(source, 'conversations'), { recursive: true });
    await mkdir(join(source, '.git'), { recursive: true });
    await mkdir(join(source, 'node_modules'), { recursive: true });
    await mkdir(join(source, 'assets'), { recursive: true });
    for (const file of V1) await writeFile(join(source, file.path), file.bytes);
    await writeFile(join(source, '.DS_Store'), 'x');
    await writeFile(join(source, '.git', 'HEAD'), 'x');
    await writeFile(join(source, 'node_modules', 'x.js'), 'x');

    const tree = await readTree(source);
    expect(tree.single).toBe(false);
    expect(tree.files.map((file) => file.path)).toEqual([
      'README.md',
      'assets/logo.bin',
      'conversations/upgrade.yaml',
    ]);

    const { version } = await store.pushVersion('dataset', 'acme-specs', tree.files, { source });
    const out = join(dir, 'restored');
    const report = await restoreFiles(await store.readVersionFiles(version), out, { single: false });
    expect(report).toEqual({ written: 3, unchanged: 0, conflicts: [], extra: [] });
    for (const file of V1) {
      expect(sha(new Uint8Array(await readFile(join(out, file.path)))), file.path).toBe(sha(file.bytes));
    }
  });

  it('refuses to overwrite a changed file without force, writes nothing then, and overwrites with force', async () => {
    const out = join(dir, 'restored');
    await restoreFiles(V1, out, { single: false });
    await writeFile(join(out, 'README.md'), 'edited by hand\n');
    await writeFile(join(out, 'notes.txt'), 'mine\n');
    await rm(join(out, 'assets', 'logo.bin'));

    const refused = await restoreFiles(V1, out, { single: false });
    expect(refused).toEqual({ written: 0, unchanged: 1, conflicts: ['README.md'], extra: ['notes.txt'] });
    expect(await readFile(join(out, 'README.md'), 'utf8')).toBe('edited by hand\n');
    await expect(readFile(join(out, 'assets', 'logo.bin'))).rejects.toThrow();

    const forced = await restoreFiles(V1, out, { single: false, force: true });
    expect(forced).toEqual({ written: 2, unchanged: 1, conflicts: [], extra: ['notes.txt'] });
    expect(await readFile(join(out, 'README.md'), 'utf8')).toBe('Acme specs, fictional data.\n');
    expect(sha(new Uint8Array(await readFile(join(out, 'assets', 'logo.bin'))))).toBe(sha(BINARY));
  });

  it('reads one file as a version of one file, and restores it to a file path', async () => {
    const prompt = join(dir, 'acme-sales.md');
    await writeFile(prompt, 'You are the Acme sales assistant.\n');
    const tree = await readTree(prompt);
    expect(tree).toMatchObject({ single: true, files: [{ path: 'acme-sales.md' }] });
    const target = join(dir, 'out', 'prompt.md');
    expect(await restoreFiles(tree.files, target, { single: true })).toMatchObject({ written: 1 });
    expect(await readFile(target, 'utf8')).toBe('You are the Acme sales assistant.\n');
  });
});

describe('diffFiles', () => {
  it('names added, removed and changed files, with the changed lines of a text file', () => {
    const before: RegistryFile[] = [
      { path: 'a.yaml', bytes: text('id: a\nblocks:\n  - user: Hello\n    expect: { must: [Acme] }\n') },
      { path: 'gone.yaml', bytes: text('id: gone\n') },
      { path: 'same.yaml', bytes: text('id: same\n') },
      { path: 'logo.bin', bytes: BINARY },
    ];
    const after: RegistryFile[] = [
      { path: 'a.yaml', bytes: text('id: a\nblocks:\n  - user: Hi there\n    expect: { must: [Acme] }\n') },
      { path: 'new.yaml', bytes: text('id: new\n') },
      { path: 'same.yaml', bytes: text('id: same\n') },
      { path: 'logo.bin', bytes: new Uint8Array([0x89, 0x00]) },
    ];
    expect(diffFiles(before, after)).toEqual([
      {
        path: 'a.yaml',
        status: 'changed',
        lines: [
          '@@ line 2 @@',
          ' blocks:',
          '-  - user: Hello',
          '+  - user: Hi there',
          '     expect: { must: [Acme] }',
        ],
      },
      { path: 'gone.yaml', status: 'removed' },
      { path: 'logo.bin', status: 'changed', lines: ['binary: 6 bytes before, 2 after'] },
      { path: 'new.yaml', status: 'added' },
    ]);
    expect(diffFiles(before, before)).toEqual([]);
  });
});
