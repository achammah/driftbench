import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { expect, it } from 'vitest';
import { estateScanCommand } from '../src/commands/estate';

it('counts a clause it cannot place, writes the map, and continues to later clauses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prose-failure-'));
  // The first clause ends in a backslash that escapes the quotation mark after it: no quote can be found.
  await writeFile(
    join(root, 'CLAUDE.md'),
    'Always \\"x verify the receipt.\n\nThe helper must validate the manifest.\n',
  );
  let output = '';
  const io = {
    cwd: root,
    out(text: string) {
      output += text;
    },
    err(text: string) {
      throw new Error(text);
    },
  };
  expect(await estateScanCommand('.', { model: false, out: 'map.yaml' }, io)).toBe(0);
  expect(output).toContain('Code-found prose candidates skipped: 1.');
  expect(output).toContain('the quote cannot be found at its lines');
  const loaded = await loadEstateMap(join(root, 'map.yaml'));
  expect(
    loaded.ok &&
      loaded.map.atoms.some((atom) => atom.provenance.quote === 'The helper must validate the manifest.'),
  ).toBe(true);
});
