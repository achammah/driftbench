import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyVariableQuotes } from '@agent-nexus/driftbench-generate';
import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { loadEstateMap } from '../../src/map';
import { estateToVariables, provenanceResolver, renderVariableStore } from '../../src/variables';

/** The three invented estates of examples/estates that hold a map file: Northwind, Northwind after a change, and the reader cases. */
const ESTATES = [
  { dir: 'fixture', map: 'approved.yaml' },
  { dir: 'fixture-v2', map: 'map.yaml' },
  { dir: 'reader-cases', map: 'approved.yaml' },
] as const;
const ROOT = fileURLToPath(new URL('../../../../examples/estates/', import.meta.url));

async function feed(dir: string, mapFile: string) {
  const folder = join(ROOT, dir);
  const loaded = await loadEstateMap(join(folder, mapFile));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const files = [...new Set(loaded.map.atoms.map((a) => a.provenance.file))];
  const texts = new Map<string, string>();
  for (const file of files) texts.set(file, await readFile(join(folder, file), 'utf8'));
  const result = estateToVariables(loaded.map, provenanceResolver(texts), {
    agent: dir === 'reader-cases' ? 'reader-cases' : 'northwind',
  });
  return { folder, map: loaded.map, result };
}

describe.each(ESTATES)('the variable store of the $dir estate', ({ dir, map }) => {
  it('validates against the store schema, and every provenance entry resolves in its file', async () => {
    const { folder, result } = await feed(dir, map);
    const loaded = validateVariableStore(result.store);
    expect(loaded.ok, JSON.stringify(loaded.ok ? [] : loaded.errors.slice(0, 5))).toBe(true);
    expect(result.store.variables.length).toBeGreaterThan(0);
    expect(await verifyVariableQuotes(result.store, folder)).toEqual([]);
  });

  it('refuses no atom: guards, tools, stages, settings and invariants stand on pointers, the rest on ledger ids', async () => {
    const { map: estate, result } = await feed(dir, map);
    expect(result.refused).toEqual([]);
    const values = result.store.variables
      .filter((v) => !v.id.startsWith('condition.'))
      .flatMap((v) => v.values);
    expect(values).toHaveLength(estate.atoms.length);
    const kinds = new Set<string>();
    for (const value of values) {
      const entries = value.provenance ?? [];
      expect(entries, value.id).toHaveLength(1);
      const [entry] = entries;
      kinds.add(entry?.kind ?? 'none');
      if (entry?.kind === 'quote') expect(entry.ledger, value.id).toMatch(/^[a-z2-7]{10}$/);
      else expect(entry?.kind, value.id).toBe('structure');
    }
    expect([...kinds].sort()).toEqual(['quote', 'structure']);
  });

  it('gives every structured atom a pointer in a JSON file, which resolves to the value it quotes', async () => {
    const { result } = await feed(dir, map);
    const pointers = result.store.variables
      .flatMap((v) => v.values)
      .flatMap((v) => v.provenance ?? [])
      .flatMap((entry) => (entry.kind === 'structure' && 'pointer' in entry ? [entry] : []));
    expect(pointers.length).toBeGreaterThan(0);
    for (const entry of pointers)
      expect(entry.pointer?.startsWith('/'), `${entry.path} ${entry.pointer}`).toBe(true);
  });

  it('is byte for byte the store committed beside the estate', async () => {
    const { folder, result } = await feed(dir, map);
    const text = renderVariableStore(result.store);
    if (process.env.UPDATE_VARIABLES === '1') await writeFile(join(folder, 'variables.yaml'), text);
    expect(text).toBe(await readFile(join(folder, 'variables.yaml'), 'utf8'));
    expect(renderVariableStore((await feed(dir, map)).result.store)).toBe(text);
  });

  it('holds the size ceiling of the standing instructions as a condition, with the limit the invariant carries', async () => {
    const { map: estate, result } = await feed(dir, map);
    const invariant = estate.atoms.find((a) => a.kind === 'invariant' && a.fields?.check === 'standing_size');
    const variable = result.store.variables.find((v) => v.id === 'condition.standing_size');
    expect(variable?.boundaries?.[0]).toMatchObject({
      limit: invariant?.fields?.ceiling,
      comparison: 'le',
      unit: 'characters',
    });
    expect(result.store.variables.filter((v) => v.id.startsWith('condition.'))).toHaveLength(1);
  });
});
