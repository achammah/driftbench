// Blast radius of PR 443 on the store: a spec that names a project object (`uses`, resolved by the loader
// against `driftbench/<kind>/<id>.yaml` beside `driftbench.yaml`) is a spec the loader accepted, so the
// store must take it and give it back. putSpec and getSpec validate the spec again (validateSpec).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clearObjectContexts, type LoadedSpec, loadSpecFile } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import { openMemoryStore } from '../src/index';

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
  if (!result.ok) throw new Error(`the loader refused the spec: ${JSON.stringify(result.errors)}`);
  return result;
}

describe('blast 443: the store keeps a spec that names a project object', () => {
  it('the loader accepts the spec from its file (the project layer resolves blame: acme)', async () => {
    const spec = await loaded(await project());
    expect(spec.spec.uses).toEqual({ blame: 'acme' });
  });

  // BUG: putSpec re-validates with validateSpec(spec, path) and no object context, so a project object is unknown (OBJECT_UNKNOWN), reported to lead
  it.fails('putSpec takes it and getSpec gives it back unchanged', async () => {
    const spec = await loaded(await project());
    const store = openMemoryStore();
    try {
      await store.putSpec(spec);
      expect(await store.getSpec(spec.spec.id, spec.hash)).toStrictEqual(spec);
    } finally {
      await store.close();
    }
  });
});
