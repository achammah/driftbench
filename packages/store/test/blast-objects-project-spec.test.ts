// Regression coverage: stored specs preserve object identities, while reads validate structure only.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  canonicalJson,
  clearObjectContexts,
  type LoadedSpec,
  loadSpecFile,
  objectContextOfSpec,
} from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import { openMemoryStore, readCampaignBundle } from '../src/index';
import { recordedObjectsOfSpec } from '../src/spec-objects';
import { campaign } from './fixtures';

const made: string[] = [];
afterEach(async () => {
  clearObjectContexts();
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A project folder: driftbench.yaml, one project object with no items, one spec that uses it by id. */
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'blast-objects-store-'));
  made.push(root);
  const files: Record<string, string> = {
    'driftbench.yaml': 'plugins: []\n',
    'driftbench/policy/blame/acme.yaml': 'kind: policy/blame\nid: acme\nitems: []\n',
    'specs/uses-project.yaml':
      'id: blast-store-uses\nuses: { blame: acme }\nblocks:\n  - user: Where is my order?\n    expect: { must: [ok] }\n',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

async function loaded(root: string): Promise<LoadedSpec> {
  const result = await loadSpecFile(join(root, 'specs/uses-project.yaml'));
  if (!result.ok) throw new Error(`the loader refused the spec: ${canonicalJson(result.errors)}`);
  return result;
}

describe('blast 443: the store keeps a spec that names a project object', () => {
  it('the loader accepts the spec from its file (the project layer resolves blame: acme)', async () => {
    const spec = await loaded(await project());
    expect(spec.spec.uses).toEqual({ blame: 'acme' });
  });

  it('putSpec takes it and getSpec gives it back unchanged', async () => {
    const spec = await loaded(await project());
    const store = openMemoryStore();
    try {
      await store.putSpec(spec);
      expect(canonicalJson(await store.getSpec(spec.spec.id, spec.hash))).toBe(canonicalJson(spec));
    } finally {
      await store.close();
    }
  });
});

describe('stored object references are independent of current project files', () => {
  it('writes from the loader context even after its project is removed; reads preserve hash and identities', async () => {
    const root = await project();
    const spec = await loaded(root);
    const expected = objectContextOfSpec(spec.spec)?.store.resolve('policy/blame', 'acme');
    if (expected === undefined) throw new Error('the loader lost its object context');
    await rm(root, { recursive: true, force: true });
    clearObjectContexts();
    const store = openMemoryStore();
    try {
      await store.putSpec(spec);
      const back = await store.getSpec(spec.spec.id, spec.hash);
      if (back === undefined) throw new Error('stored spec missing');
      expect(canonicalJson(back)).toBe(canonicalJson(spec));
      expect(recordedObjectsOfSpec(back.spec)).toContainEqual({
        block: 0,
        key: 'blame',
        kind: 'policy/blame',
        id: 'acme',
        hash: expected.hash,
      });
      expect(() => objectContextOfSpec(back.spec)).toThrow(/unknown object policy\/blame:acme/);
    } finally {
      await store.close();
    }
  });

  it('round trips bundles after the project disappears, including references selected only by uses.yaml', async () => {
    const root = await project();
    await writeFile(join(root, 'driftbench/uses.yaml'), 'blame: acme\n');
    await writeFile(
      join(root, 'specs/uses-project.yaml'),
      'id: blast-store-uses\nblocks:\n  - user: Hello\n    expect: { must: [ok] }\n',
    );
    const spec = await loaded(root);
    expect(spec.spec.uses).toBeUndefined();
    const store = openMemoryStore();
    const other = openMemoryStore();
    const out = await mkdtemp(join(tmpdir(), 'blast-objects-bundle-'));
    made.push(out);
    try {
      await store.putSpec(spec);
      await store.putCampaign(campaign('objects-bundle', { specs: [{ id: spec.spec.id, hash: spec.hash }] }));
      await rm(root, { recursive: true, force: true });
      clearObjectContexts();
      const folder = await store.exportCampaign('objects-bundle', out);
      const bundle = await readCampaignBundle(folder);
      expect(canonicalJson(bundle.specs)).toBe(canonicalJson([spec]));
      const bundled = bundle.specs[0];
      if (bundled === undefined) throw new Error('bundled spec missing');
      const identities = recordedObjectsOfSpec(bundled.spec);
      expect(identities).toContainEqual(expect.objectContaining({ kind: 'policy/blame', id: 'acme' }));
      await other.importCampaign(folder);
      const back = await other.getSpec(spec.spec.id, spec.hash);
      if (back === undefined) throw new Error('imported spec missing');
      expect(canonicalJson(back)).toBe(canonicalJson(spec));
      expect(recordedObjectsOfSpec(back.spec)).toEqual(identities);
      expect(() => objectContextOfSpec(back.spec)).toThrow(/unknown object policy\/blame:acme/);
    } finally {
      await store.close();
      await other.close();
    }
  });
});

it('refuses a vanished layer selector, but permits an explicit replacement selection', async () => {
  const root = await project();
  await writeFile(join(root, 'driftbench/uses.yaml'), 'blame: acme\n');
  await writeFile(
    join(root, 'specs/uses-project.yaml'),
    'id: blast-store-uses\nblocks:\n  - user: Hello\n    expect: { must: [ok] }\n',
  );
  const spec = await loaded(root);
  const store = openMemoryStore();
  try {
    await store.putSpec(spec);
    await rm(join(root, 'driftbench/uses.yaml'));
    const back = await store.getSpec(spec.spec.id, spec.hash);
    if (back === undefined) throw new Error('stored spec missing');
    expect(back?.hash).toBe(spec.hash);
    expect(() => objectContextOfSpec(back.spec)).toThrow(/missing selection for object policy\/blame:acme/);
    await writeFile(
      join(root, 'driftbench/policy/blame/revised.yaml'),
      'kind: policy/blame\nid: revised\nitems: []\n',
    );
    await writeFile(join(root, 'driftbench/uses.yaml'), 'blame: revised\n');
    expect(objectContextOfSpec(back.spec)?.uses[0]?.uses.blame).toBe('revised');
  } finally {
    await store.close();
  }
});
