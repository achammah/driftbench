import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SPEC = 'examples/estates/sessions/specs/price-sheet-build.yaml';
const PARENTS = 'examples/acme/parents/checkout.yaml';

/** The spec file without its comment lines, as the README quotes it. */
function withoutComments(spec: string): string {
  return spec
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

describe('the README code-agent example', () => {
  it('is the price-sheet-build spec, word for word, after its comment lines', async () => {
    const readme = await readFile(`${ROOT}/README.md`, 'utf8');
    const spec = await readFile(`${ROOT}/${SPEC}`, 'utf8');
    const body = withoutComments(spec);
    const start = readme.indexOf('```yaml\nid: replay-price-sheet-build');
    expect(start, 'the README holds the example').toBeGreaterThan(0);
    const block = readme.slice(start + '```yaml\n'.length, readme.indexOf('\n```', start + 8)).trim();
    expect(block).toBe(body);
  });
});

describe('the README parent-blocks example', () => {
  it('is the runnable Acme checkout spec, word for word, and loads clean with its parent links', async () => {
    const readme = await readFile(`${ROOT}/README.md`, 'utf8');
    const spec = await readFile(`${ROOT}/${PARENTS}`, 'utf8');
    const start = readme.indexOf('```yaml\n# file: checkout.spec.yaml\nid: acme-parent-checkout');
    expect(start, 'the README holds the example').toBeGreaterThan(0);
    expect(readme.lastIndexOf('<summary>See it in YAML</summary>', start)).toBeGreaterThan(0);
    const block = readme.slice(start + '```yaml\n'.length, readme.indexOf('\n```', start + 8)).trim();
    expect(withoutComments(block)).toBe(withoutComments(spec));
    const loaded = parseSpecText(withoutComments(block), 'yaml');
    expect(loaded.ok ? [] : loaded.errors).toEqual([]);
    if (!loaded.ok) return;
    expect(loaded.warnings).toEqual([]);
    expect(loaded.spec.blocks.map((entry) => [entry.id, entry.parent])).toEqual([
      ['plans', undefined],
      ['recap', 'plans'],
      ['order', 'recap'],
      ['receipt', 'order'],
      ['alternative', 'plans'],
      ['hours', undefined],
    ]);
  });
});
