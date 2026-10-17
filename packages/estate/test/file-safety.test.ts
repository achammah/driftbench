import { readFile, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { type ImpactReport, loadEstateMap, loadEstateTests, writeRetirements } from '../src/index';
import { sha256 } from '../src/scan/text';
import { estate } from './support';

it('does not follow a planted cache temporary-file symlink', async () => {
  const root = await estate({ 'outside.txt': 'original' });
  const path = new URL('../../../examples/estates/fixture/approved.yaml', import.meta.url).pathname;
  const cached = join(root, `${sha256(await readFile(path, 'utf8'))}.json`);
  await symlink(join(root, 'outside.txt'), `${cached}.${process.pid}.tmp`);
  expect((await loadEstateMap(path, { cacheDir: root })).ok).toBe(true);
  expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('original');
});

const spec = JSON.stringify({
  id: 'parcel',
  title: 'Fictional parcel',
  kind: 'task',
  target: { adapter: 'claude-code' },
  blocks: [{ user: 'Inspect the parcel' }],
  metadata: { estate: { atoms: ['parcel.rule'] } },
});
it('refuses external spec symlinks while indexing tests', async () => {
  const outside = await estate({ 'parcel.spec.json': spec });
  const root = await estate({});
  await symlink(join(outside, 'parcel.spec.json'), join(root, 'parcel.spec.json'));
  const loaded = await loadEstateTests(root);
  expect(loaded.ok).toBe(false);
  expect(!loaded.ok && loaded.errors.join('\n')).toMatch(/outside/i);
});

it('rechecks a retirement path if it became an external symlink after indexing', async () => {
  const root = await estate({ 'parcel.spec.json': spec });
  const outside = await estate({ 'parcel.spec.json': spec });
  const loaded = await loadEstateTests(root);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  await unlink(join(root, 'parcel.spec.json'));
  await symlink(join(outside, 'parcel.spec.json'), join(root, 'parcel.spec.json'));
  const report = {
    retire: [
      { test: 'parcel', file: 'parcel.spec.json', state: 'to_write', reason: 'atom parcel.rule removed' },
    ],
  } as ImpactReport;
  const result = await writeRetirements(report, loaded.tests);
  expect(result[0]?.ok).toBe(false);
  expect(await readFile(join(outside, 'parcel.spec.json'), 'utf8')).toBe(spec);
});
