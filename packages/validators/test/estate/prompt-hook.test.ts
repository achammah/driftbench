import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostileFamily } from '../../src/ladders/estate/bank/hostile';
import { PlantedEstate, type ScanOutcome } from '../../src/ladders/estate/bank/planted';
import { SETTINGS } from '../../src/ladders/estate/layout';
import { matchAtoms } from '../../src/ladders/estate/pipeline';

const ID = 'scan.hostile.prompt-hook';
type Atom = ScanOutcome['map']['atoms'][number];

/** A guard atom as a reader would give it: kind, name, and the settings line it was read from. */
function guard(base: Atom, name: string, line: number): Atom {
  return {
    ...base,
    id: `guard.settings.stop-guard-${name}`,
    kind: 'guard',
    fields: { name, event: 'Stop', type: 'prompt' },
    provenance: { ...base.provenance, file: SETTINGS, startLine: line, endLine: line },
  } as Atom;
}

/**
 * Runs the hostile family on a seed with the scan's guard atoms replaced: every guard the reader gave is removed,
 * then `plant` adds what the implementation under test reports. The rest of the scan is the real reader's.
 */
async function withGuards(seed: number, plant: (base: Atom) => Atom[]) {
  const original = PlantedEstate.prototype.scan;
  vi.spyOn(PlantedEstate.prototype, 'scan').mockImplementation(async function (this: PlantedEstate) {
    const scan = await original.call(this);
    if (!this.raws.has(SETTINGS) || !this.raws.get(SETTINGS)?.text.includes('"type": "prompt"')) return scan;
    const kept = scan.map.atoms.filter((atom) => atom.kind !== 'guard');
    const base = kept[0] ?? (scan.map.atoms[0] as Atom);
    const atoms = [...kept, ...plant(base)];
    const map = { ...scan.map, atoms };
    return {
      ...scan,
      map,
      idOf: matchAtoms(this.expected, atoms).idOf,
      atomOf: new Map(atoms.map((a) => [a.id, a])),
    };
  });
  return (await hostileFamily().evaluate(seed)).get(ID);
}

describe(`${ID}: a prompt hook is one planted guard, named by its words, on its line`, {
  timeout: 120_000,
}, () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([1, 2, 3])('passes the guard a correct reader gives, on seed %i', async (seed) => {
    expect(await withGuards(seed, (base) => [guard(base, 'check-the-reply', 3)])).toMatchObject({
      pass: true,
    });
  });

  it('fails a reader that gives no guard', async () => {
    const result = await withGuards(1, () => []);
    expect(result?.pass).toBe(false);
    expect(result?.detail).toContain('missed guard check-the-reply at .claude/settings.json:3');
  });

  it.each([2, 4])('fails a guard on line %i, not the hook line', async (line) => {
    const result = await withGuards(1, (base) => [guard(base, 'check-the-reply', line)]);
    expect(result?.pass).toBe(false);
    expect(result?.detail).toContain('missed guard check-the-reply');
  });

  it('fails a guard named by its event, not by the prompt words', async () => {
    const result = await withGuards(1, (base) => [guard(base, 'stop', 3)]);
    expect(result?.pass).toBe(false);
    expect(result?.detail).toContain(
      'found guard guard.settings.stop-guard-stop at .claude/settings.json:3, never planted',
    );
  });

  it('fails a second guard read from the same hook', async () => {
    const result = await withGuards(1, (base) => [
      guard(base, 'check-the-reply', 3),
      guard(base, 'check-the-reply-2', 3),
    ]);
    expect(result?.pass).toBe(false);
    expect(result?.detail).toContain('never planted');
  });
});
