import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Blast radius of the commuted family formula on the committed Acme suites. The generator now writes the
 * formula check of =C2*12 as a regex that also takes =12*C2, and the committed generated price-sheet task
 * specs, which the gate and the family tests read, must hold it. The gated and golden copies are a frozen
 * snapshot that already differed from the generated suite before this change, so they are not compared.
 */

const ACME = fileURLToPath(new URL('../', import.meta.url));

/** The formula regexes of a spec file, in file order. */
function regexes(text: string): string[] {
  return [...text.matchAll(/^\s*regex: (\^=.*)$/gm)].map((match) => match[1] as string);
}

async function files(folder: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of await readdir(join(ACME, folder))) {
    if (name.endsWith('.yaml')) out.set(name, await readFile(join(ACME, folder, name), 'utf8'));
  }
  return out;
}

describe('the commuted formula in the committed price-sheet suites', () => {
  it('is written by the generated suite: =12*C2 passes where =C2*12 is expected', async () => {
    const generated = await files('generated/specs/task');
    const all = [...generated.values()].flatMap(regexes);
    expect(all.length).toBeGreaterThan(100);
    const swappable = all.filter((regex) => /^\^=\(\?:/.test(regex));
    expect(swappable.length).toBeGreaterThan(0);
    const base = regexes(generated.get('acme-price-sheet-i08-base.yaml') ?? '');
    expect(new RegExp(base[0] ?? '$^').test('=12*C2')).toBe(true);
    expect(new RegExp(base[0] ?? '$^').test('=C2*12')).toBe(true);
  });
});
