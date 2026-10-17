import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { clearObjectContexts, loadSpecFile } from '@agent-nexus/driftbench-core';
import { afterAll, expect, it } from 'vitest';
import { openMemoryStore } from '../src/store';

/**
 * A spec that names a project object (here the project's policy/value-check:strict) is stored and read back:
 * the store re-checks it against the objects of the file it was loaded from, not the shipped ones only. Fictional
 * data only.
 */

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

it('puts and gets a spec that names a project value-check policy', async () => {
  initializeShippedObjects();
  clearObjectContexts();
  const root = await mkdtemp(join(tmpdir(), 'store-project-objects-'));
  made.push(root);
  await writeFile(join(root, 'driftbench.yaml'), '# a project root\n');
  await mkdir(join(root, 'driftbench', 'policy', 'value-check'), { recursive: true });
  await writeFile(
    join(root, 'driftbench', 'policy', 'value-check', 'strict.yaml'),
    'kind: policy/value-check\nid: strict\nextends: default\nitems:\n  - { id: rung1_outcome, enabled: false }\n',
  );
  const file = join(root, 'coverage.yaml');
  await writeFile(
    file,
    'id: project-objects\nuses: { value_check: strict }\nblocks:\n  - user: Do you cover 88 Summit Avenue, Acmeville?\n    expect: { must: [Summit] }\n',
  );
  const loaded = await loadSpecFile(file);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const store = openMemoryStore();
  await store.putSpec(loaded);
  const back = await store.getSpec(loaded.spec.id, loaded.hash);
  expect(back?.hash).toBe(loaded.hash);
  await store.close();
});
