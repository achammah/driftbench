import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalJson,
  clearObjectContexts,
  initializeShippedObjects,
  loadSpecFile,
} from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { openStore, type SqliteStore } from '../src/store';

it.each(['gone', 'moved'])(
  'stored spec survives project folder %s after reopening SQLite',
  async (change) => {
    const root = await mkdtemp(join(tmpdir(), 'astra-stored-spec-'));
    const project = join(root, 'project');
    const db = join(root, 'review.sqlite');
    let store: SqliteStore | undefined;
    try {
      await mkdir(join(project, 'driftbench/policy/value-check'), { recursive: true });
      await writeFile(join(project, 'driftbench.yaml'), '# project marker\n');
      // F1 has no shipped value-check default; a self-contained project object tests the same read contract.
      await writeFile(
        join(project, 'driftbench/policy/value-check/strict.yaml'),
        'kind: policy/value-check\nid: strict\nitems: []\n',
      );
      const path = join(project, 'spec.yaml');
      await writeFile(
        path,
        'id: retained\nuses: {value_check: strict}\nblocks:\n  - user: hello\n    expect: {must: [hello]}\n',
      );
      initializeShippedObjects();
      clearObjectContexts();
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) throw Error(JSON.stringify(loaded.errors));
      store = openStore(db);
      await store.putSpec(loaded);
      expect((await store.getSpec(loaded.spec.id, loaded.hash))?.hash).toBe(loaded.hash);
      await store.close();
      store = undefined;
      if (change === 'gone') await rm(project, { recursive: true });
      else await rename(project, join(root, 'project-moved'));
      clearObjectContexts();
      store = openStore(db);
      const back = await store.getSpec(loaded.spec.id, loaded.hash);
      expect(back?.hash).toBe(loaded.hash);
      expect(canonicalJson(back?.spec)).toEqual(canonicalJson(loaded.spec));
    } finally {
      if (store) await store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
