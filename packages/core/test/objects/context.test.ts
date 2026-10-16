import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterEach, expect, it } from 'vitest';
import {
  checkSpec,
  cloneJson,
  contentHash,
  loadSpecFile,
  objectContextFor,
  objectContextOfSpec,
  resolveBlockObjects,
  runSpec,
} from '../../src/index';
import { echoAdapter } from '../runner/support';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'objects-context-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'driftbench.yaml'), 'objects: [{kind: policy/blame, id: house, items: []}]');
  mkdirSync(join(dir, '_driftbench'));
  writeFileSync(join(dir, '_driftbench/uses.yaml'), 'blame: house');
  const file = join(dir, 'spec.yaml');
  writeFileSync(file, 'id: local\nblocks: [{when: {user: hello}}]');
  return { dir, file };
}
it('keeps suite context through revalidation, shallow copies and cloneJson without hashing it', async () => {
  const { file } = project();
  const loaded = await loadSpecFile(file);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const context = objectContextOfSpec(loaded.spec);
  expect(context).toBeDefined();
  const checked = checkSpec(loaded.spec);
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  for (const spec of [loaded.spec, { ...loaded.spec }, cloneJson(loaded.spec), checked.spec]) {
    expect(objectContextOfSpec(spec)).toBe(context);
    expect(contentHash(spec)).toBe(loaded.hash);
    expect(resolveBlockObjects(spec, 0, objectContextOfSpec(spec)!)[0]?.object.id).toBe('house');
  }
});
it('rereads edited files and newly-created suite folders in a long-lived process', () => {
  const { dir, file } = project();
  const first = objectContextFor(file);
  writeFileSync(join(dir, 'driftbench.yaml'), 'objects: [{kind: policy/blame, id: next, items: []}]');
  writeFileSync(join(dir, '_driftbench/uses.yaml'), 'blame: next');
  const next = objectContextFor(file);
  expect(next).not.toBe(first);
  expect(next.store.has('policy/blame', 'next')).toBe(true);
});

it('runs the loaded project spec, but refuses a lost context before calling the adapter', async () => {
  const { file } = project();
  const loaded = await loadSpecFile(file);
  if (!loaded.ok) throw Error('fixture refused');
  const named = { ...loaded.spec, uses: { blame: 'house' } };
  const adapter = echoAdapter();
  const result = await runSpec(named, {
    adapter,
    driver: createScriptedDriver(),
    checks: [],
    mode: 'F',
    repeat: 0,
  });
  expect(result.status).toBe('completed');
  const lost = JSON.parse(JSON.stringify(named));
  const unused = echoAdapter();
  await expect(
    runSpec(lost, { adapter: unused, driver: createScriptedDriver(), checks: [], mode: 'F', repeat: 0 }),
  ).rejects.toThrow(/OBJECT_UNKNOWN.*house/);
  expect(unused.opened).toEqual([]);
});
