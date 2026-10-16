// Blast radius of PR 443 on estate maintenance: writeRetirements loads the edited spec again before writing
// it. A spec that names a project object (`uses`) loads from its file (loadEstateTests uses loadSpecFile), so
// the check after the edit must resolve the same layers and write the retirement.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clearObjectContexts } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import { type ImpactReport, loadEstateTests, writeRetirements } from '../../src/index';

const made: string[] = [];
afterEach(async () => {
  clearObjectContexts();
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

// Fictional data only.
const SPEC = [
  '# The test of a.gone. Fictional.',
  'id: t-gone',
  'kind: task',
  'title: Test t-gone',
  'target: { adapter: claude-code }',
  'uses: { blame: acme }',
  'metadata:',
  '  estate: { atoms: [a.gone] }',
  'blocks:',
  '  - user: Reconcile the invoice of the week.',
  '    expect:',
  '      skills:',
  '        - { name: invoice-reconcile, count: { min: 1 } }',
  '',
].join('\n');

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'blast-objects-estate-'));
  made.push(root);
  const files: Record<string, string> = {
    'driftbench.yaml': 'plugins: []\n',
    'driftbench/policy/blame/acme.yaml': 'kind: policy/blame\nid: acme\nitems: []\n',
    'tests/gone.yaml': SPEC,
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe('blast 443: writeRetirements on a spec that names a project object', () => {
  it('loadEstateTests reads the spec: its project layer defines policy/blame:acme', async () => {
    const root = await project();
    const loaded = await loadEstateTests(join(root, 'tests'));
    expect(loaded.ok ? loaded.tests.map((test) => test.id) : loaded.errors).toEqual(['t-gone']);
  });

  it('writes the retirement reason into the spec', async () => {
    const root = await project();
    const loaded = await loadEstateTests(join(root, 'tests'));
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    const report = {
      retire: [
        {
          test: 't-gone',
          file: 'gone.yaml',
          atoms: ['a.gone'],
          reason: 'atom a.gone removed',
          state: 'to_write',
        },
      ],
    } as unknown as ImpactReport;
    expect(await writeRetirements(report, loaded.tests)).toEqual([{ file: 'gone.yaml', ok: true }]);
    expect(await readFile(join(root, 'tests/gone.yaml'), 'utf8')).toContain('  retired: atom a.gone removed');
  });
});
