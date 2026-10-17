// Blast radius of PR 443 on findSpecFiles (every folder loader: spec, campaign, ci, gate, select, coverage,
// estate, families): it skips `_driftbench` folders and a `driftbench/` folder only when `driftbench.yaml`
// sits beside it. Any other folder named `driftbench` still holds specs and must still be walked.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearObjectContexts, findSpecFiles, loadSpecs } from '../../src/index';

const made: string[] = [];
afterEach(async () => {
  clearObjectContexts();
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

const SPEC = (id: string) => `id: ${id}\nblocks: [{ user: hi }]\n`;

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'blast-objects-walk-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const found = async (root: string) =>
  (await findSpecFiles([root])).map((file) => file.slice(root.length + 1));

describe('blast 443: findSpecFiles and the object folders', () => {
  it('walks a folder named driftbench that has no driftbench.yaml beside it', async () => {
    const root = await tree({
      'suites/driftbench/a.yaml': SPEC('a'),
      'python/driftbench/tests/b.yaml': SPEC('b'),
    });
    expect(await found(root)).toEqual(['python/driftbench/tests/b.yaml', 'suites/driftbench/a.yaml']);
    const loaded = await loadSpecs([root]);
    expect(loaded.map((result) => result.ok)).toEqual([true, true]);
  });

  it('skips driftbench/ beside driftbench.yaml and every _driftbench at any depth, and keeps a nested project driftbench/ apart', async () => {
    const root = await tree({
      'driftbench.yaml': 'plugins: []\n',
      'driftbench/uses.yaml': '{}\n',
      'specs/a.yaml': SPEC('a'),
      'specs/deep/_driftbench/uses.yaml': '{}\n',
      'specs/deep/b.yaml': SPEC('b'),
      // A folder named driftbench below the project root, with no config beside it, holds specs.
      'specs/driftbench/c.yaml': SPEC('c'),
    });
    // driftbench.yaml itself is listed as on main (the walk keeps every .yaml file); this PR adds no change there.
    expect((await found(root)).filter((file) => file !== 'driftbench.yaml')).toEqual([
      'specs/a.yaml',
      'specs/deep/b.yaml',
      'specs/driftbench/c.yaml',
    ]);
  });
});
