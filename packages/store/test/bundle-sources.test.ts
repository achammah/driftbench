import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, parseSpecText } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryStore, type RegistryFile, readCampaignBundle, type SqliteStore } from '../src/index';
import { sha256, versionHash } from '../src/registry';
import { campaign, run, storeError, tempDir } from './fixtures';

const ID = 'acme-2026-10-12';
const text = (value: string) => new TextEncoder().encode(value);
const SPEC = [
  'id: acme-greeting',
  'blocks:',
  '  - user: Hello',
  '    expect: { must: [Acme Telecom] }',
  '',
].join('\n');
const DATASET: RegistryFile[] = [{ path: 'greeting.yaml', bytes: text(SPEC) }];
/** A prompt with bytes no text round trip keeps: a BOM, a CR LF and a trailing space. */
const PROMPT: RegistryFile[] = [
  { path: 'acme-sales.md', bytes: text('﻿You are the Acme sales assistant. \r\n') },
];

let store: SqliteStore;
let dir: string;

async function seed(target: SqliteStore) {
  const loaded = parseSpecText(SPEC, 'yaml', 'acme-specs@1/greeting.yaml');
  if (!loaded.ok) throw new Error('the spec does not load');
  await target.putSpec(loaded);
  const dataset = (await target.pushVersion('dataset', 'acme-specs', DATASET)).version;
  const prompt = (await target.pushVersion('prompt', 'acme-sales', PROMPT, { single: true })).version;
  await target.putCampaign(
    campaign(ID, {
      specs: [{ id: 'acme-greeting', hash: loaded.hash }],
      sources: [
        { kind: 'dataset', name: 'acme-specs', version: 1, hash: dataset.hash },
        { kind: 'prompt', name: 'acme-sales', version: 1, hash: prompt.hash },
      ],
    }),
  );
  await target.putRun(ID, run({ specId: 'acme-greeting', specHash: loaded.hash }));
  return { loaded, dataset, prompt };
}

beforeEach(async () => {
  store = openMemoryStore();
  dir = await tempDir();
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('a campaign bundle carries its specs and its registry sources', () => {
  it('writes the spec records and every source file, counted in the manifest', async () => {
    const { loaded } = await seed(store);
    const folder = await store.exportCampaign(ID, dir);
    expect((await readdir(folder)).sort()).toEqual([
      'campaign.json',
      'manifest.json',
      'runs',
      'sources',
      'specs',
    ]);
    expect(await readdir(join(folder, 'specs'))).toEqual([`acme-greeting@${loaded.hash}.json`]);
    expect(await readdir(join(folder, 'sources', 'dataset', 'acme-specs@1', 'files'))).toEqual([
      'greeting.yaml',
    ]);
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
    expect(manifest.counts).toEqual({ runs: 1, blocks: 2, specs: 1, sources: 2 });
    const bytes = await readFile(join(folder, 'sources', 'prompt', 'acme-sales@1', 'files', 'acme-sales.md'));
    expect(Buffer.compare(bytes, Buffer.from(PROMPT[0]?.bytes ?? []))).toBe(0);
  });

  it('imports into a fresh store everything a re-run needs: the specs, their paths and the exact source bytes', async () => {
    const seeded = await seed(store);
    const folder = await store.exportCampaign(ID, dir);
    const other = openMemoryStore();
    try {
      const bundle = await other.importCampaign(folder);
      expect(bundle.specs.map((spec) => spec.path)).toEqual(['acme-specs@1/greeting.yaml']);
      expect(canonicalJson(await other.getSpec('acme-greeting', seeded.loaded.hash))).toBe(
        canonicalJson(seeded.loaded),
      );
      expect(await other.getVersion('dataset', 'acme-specs', '1')).toEqual(seeded.dataset);
      const prompt = await other.getVersion('prompt', 'acme-sales');
      expect(prompt).toEqual(seeded.prompt);
      const files = await other.readVersionFiles(prompt ?? seeded.prompt);
      expect(Buffer.compare(Buffer.from(files[0]?.bytes ?? []), Buffer.from(PROMPT[0]?.bytes ?? []))).toBe(0);
      expect((await other.getCampaign(ID))?.sources).toHaveLength(2);
      await other.importCampaign(folder);
      expect(await other.listVersions('dataset')).toHaveLength(1);
    } finally {
      await other.close();
    }
  });

  it('refuses a source file whose bytes no longer match its hash', async () => {
    await seed(store);
    const folder = await store.exportCampaign(ID, dir);
    await writeFile(
      join(folder, 'sources', 'prompt', 'acme-sales@1', 'files', 'acme-sales.md'),
      'You are a pirate.\n',
    );
    const error = await storeError(() => readCampaignBundle(folder));
    expect(error.code).toBe('BUNDLE_INVALID');
    expect(error.message).toContain('sources/prompt/acme-sales@1/files/acme-sales.md does not hash to');
  });

  it.each([
    '../escape.yaml',
    'a/../../escape.yaml',
    '/etc/escape.yaml',
    'a\\..\\escape.yaml',
    './escape.yaml',
  ])('refuses a source version whose file path %s leaves the version, and stores nothing', async (path) => {
    await seed(store);
    const folder = await store.exportCampaign(ID, dir);
    const home = join(folder, 'sources', 'dataset', 'acme-specs@1');
    const bytes = text('escaped\n');
    // A file planted next to the version folder, which a path with .. would reach.
    await writeFile(join(home, 'escape.yaml'), bytes);
    const files = [{ path, sha256: sha256(bytes), size: bytes.byteLength }];
    const version = JSON.parse(await readFile(join(home, 'version.json'), 'utf8'));
    const hash = versionHash(files);
    await writeFile(join(home, 'version.json'), JSON.stringify({ ...version, files, hash }));
    const record = JSON.parse(await readFile(join(folder, 'campaign.json'), 'utf8'));
    record.sources = record.sources.map((source: { kind: string }) =>
      source.kind === 'dataset' ? { ...source, hash } : source,
    );
    await writeFile(join(folder, 'campaign.json'), JSON.stringify(record));
    // A crafted bundle: its author records the hash of the campaign they wrote, so only the path guard stops it.
    const manifestPath = join(folder, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.hashes['campaign.json'] = createHash('sha256').update(canonicalJson(record)).digest('hex');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const other = openMemoryStore();
    try {
      const error = await storeError(() => other.importCampaign(folder));
      expect(error.code).toBe('BUNDLE_INVALID');
      expect(error.message).toContain('leaves the version');
      expect(await other.listVersions('dataset')).toEqual([]);
      expect(await other.getCampaign(ID)).toBeUndefined();
    } finally {
      await other.close();
    }
  });

  it('refuses, and stores nothing, when the store holds other content under the same version', async () => {
    await seed(store);
    const folder = await store.exportCampaign(ID, dir);
    const other = openMemoryStore();
    try {
      await other.pushVersion('dataset', 'acme-specs', [{ path: 'other.yaml', bytes: text('id: other\n') }]);
      const error = await storeError(() => other.importCampaign(folder));
      expect(error.code).toBe('VERSION_CONFLICT');
      expect(error.message).toContain('dataset acme-specs@1 in this store holds other content');
      expect(await other.getCampaign(ID)).toBeUndefined();
      expect(await other.listVersions('prompt')).toEqual([]);
    } finally {
      await other.close();
    }
  });

  it('refuses to export a campaign whose source the store no longer holds', async () => {
    await store.putCampaign(
      campaign(ID, { sources: [{ kind: 'prompt', name: 'acme-sales', version: 3, hash: 'c'.repeat(64) }] }),
    );
    const error = await storeError(() => store.exportCampaign(ID, dir));
    expect(error.code).toBe('BUNDLE_INVALID');
    expect(error.message).toContain('records prompt acme-sales@3, which this store does not hold');
  });
});
