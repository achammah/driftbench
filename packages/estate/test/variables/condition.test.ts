import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { INVARIANT_LIMITS } from '../../src/scan/invariants';
import { estateToVariables, provenanceResolver } from '../../src/variables';
import { atom, HALL, mapOf } from './support';

const resolver = () => provenanceResolver(new Map(Object.entries(HALL)));
const QUOTE = 'Never hand out a key without a signature.';
const conditionsOf = (result: ReturnType<typeof estateToVariables>) =>
  result.store.variables.filter((variable) => variable.id.startsWith('condition.'));

describe('a numeric condition comes only from a structured field', () => {
  it('reads the limit, comparison and unit of a field the atom carries, and writes the three values and the edge', () => {
    const result = estateToVariables(
      mapOf([
        atom({
          quote: QUOTE,
          title: 'A key needs a signature',
          fields: { condition: { limit: 2, comparison: 'gt', unit: 'days' } },
        }),
      ]),
      resolver(),
    );
    const [variable] = conditionsOf(result);
    expect(variable).toMatchObject({
      title: 'A key needs a signature',
      kind: 'data',
      role: 'detail',
      produced_by: 'model',
    });
    expect(variable?.id).toMatch(/^condition\.[a-z0-9_]+$/);
    expect(variable?.values.map((v) => v.id)).toEqual(['above_2', 'at_2', 'below_2']);
    expect(variable?.values.map((v) => v.title)).toEqual([
      'More than 2 days',
      'Exactly 2 days',
      'Under 2 days',
    ]);
    expect(variable?.boundaries).toEqual([
      {
        holds: 'above_2',
        fails: 'below_2',
        edge: 'at_2',
        limit: 2,
        comparison: 'gt',
        unit: 'days',
        provenance: [
          { kind: 'quote', path: 'CLAUDE.md', quote: QUOTE, ledger: expect.stringMatching(/^[a-z2-7]{10}$/) },
        ],
      },
    ]);
    for (const value of variable?.values ?? [])
      expect(value.provenance).toEqual(variable?.boundaries?.[0]?.provenance);
    expect(validateVariableStore(result.store).ok).toBe(true);
  });

  it.each([
    ['gt', 'above_5', 'below_5'],
    ['ge', 'above_5', 'below_5'],
    ['lt', 'below_5', 'above_5'],
    ['le', 'below_5', 'above_5'],
  ] as const)('puts the holding side %s of the limit on the right side', (comparison, holds, fails) => {
    const result = estateToVariables(
      mapOf([atom({ quote: QUOTE, fields: { condition: { limit: 5, comparison } } })]),
      resolver(),
    );
    expect(conditionsOf(result)[0]?.boundaries?.[0]).toMatchObject({
      holds,
      fails,
      edge: 'at_5',
      comparison,
    });
    expect(validateVariableStore(result.store).ok).toBe(true);
  });

  it('writes no unit when the field has none, and keeps a decimal and a negative limit', () => {
    const result = estateToVariables(
      mapOf([
        atom({ quote: QUOTE, fields: { condition: { limit: 0.5, comparison: 'le' } } }),
        atom({
          quote: 'Lock the hall when the last boat is out.',
          fields: { condition: { limit: -3, comparison: 'ge', unit: 'degrees' } },
        }),
      ]),
      resolver(),
    );
    const [first, second] = conditionsOf(result);
    expect(first?.boundaries?.[0]).not.toHaveProperty('unit');
    expect(first?.values.map((v) => v.id)).toEqual(['above_0.5', 'at_0.5', 'below_0.5']);
    expect(second?.values.map((v) => v.id)).toEqual(['above_-3', 'at_-3', 'below_-3']);
    expect(first?.id).not.toBe(second?.id);
    expect(validateVariableStore(result.store).ok).toBe(true);
  });

  it.each([
    ['a comparison that is not one of lt, le, gt, ge', { limit: 2, comparison: 'more than' }],
    ['a limit that is a string', { limit: '2', comparison: 'gt' }],
    ['a limit that is not finite', { limit: Number.POSITIVE_INFINITY, comparison: 'gt' }],
    ['no comparison', { limit: 2 }],
    ['no limit', { comparison: 'gt' }],
    ['a unit that is not text', { limit: 2, comparison: 'gt', unit: 3 }],
    ['an extra key', { limit: 2, comparison: 'gt', unit: 'days', note: 'x' }],
  ])('makes no variable from %s', (_name, condition) => {
    const result = estateToVariables(mapOf([atom({ quote: QUOTE, fields: { condition } })]), resolver());
    expect(conditionsOf(result)).toEqual([]);
    expect(result.refused).toEqual([]);
  });
});

describe('the size ceiling of the standing instructions is a structured limit', () => {
  const standing = (fields: Record<string, unknown>) =>
    atom({
      kind: 'invariant',
      quote: '# Boat hall',
      role: 'detail',
      producedBy: 'code',
      title: 'The standing instructions stay under their ceiling',
      fields,
    });

  it('reads ceiling as an upper limit in characters from the standing_size check', () => {
    const result = estateToVariables(
      mapOf([standing({ check: 'standing_size', ceiling: 40000, characters: 3292, holds: true })]),
      resolver(),
    );
    const [variable] = conditionsOf(result);
    expect(variable?.id).toBe('condition.standing_size');
    expect(variable?.boundaries?.[0]).toMatchObject({
      holds: 'below_40000',
      fails: 'above_40000',
      edge: 'at_40000',
      limit: 40000,
      comparison: 'le',
      unit: 'characters',
    });
    expect(variable?.values.map((v) => v.title)).toEqual([
      'More than 40000 characters',
      'Exactly 40000 characters',
      'Under 40000 characters',
    ]);
  });

  it('reads nothing from a ceiling that another check or another kind carries, or from one that is not a number', () => {
    for (const a of [
      standing({ check: 'no_orphan_file', ceiling: 40000 }),
      standing({ check: 'standing_size', ceiling: '40000' }),
      standing({ check: 'standing_size' }),
      atom({ kind: 'guard', quote: '# Boat hall', fields: { check: 'standing_size', ceiling: 40000 } }),
    ]) {
      expect(conditionsOf(estateToVariables(mapOf([a]), resolver()))).toEqual([]);
    }
  });

  it('gives a second atom of the same check its own variable, never the id of the first', () => {
    const result = estateToVariables(
      mapOf([
        standing({ check: 'standing_size', ceiling: 10 }),
        standing({ check: 'standing_size', ceiling: 20 }),
      ]),
      resolver(),
    );
    const ids = conditionsOf(result).map((variable) => variable.id);
    expect(new Set(ids).size).toBe(2);
    expect(validateVariableStore(result.store).ok).toBe(true);
  });
});

describe('any invariant whose check declares a limit gives a condition, whatever the check', () => {
  const invariant = (fields: Record<string, unknown>) =>
    atom({
      kind: 'invariant',
      quote: '# Boat hall',
      role: 'detail',
      producedBy: 'code',
      title: 'A hall rule',
      fields,
    });

  it('declares the limits of the estate checks beside the checks: the check, the field of its atom that holds the limit, the comparison, the unit', () => {
    expect(INVARIANT_LIMITS).toEqual([
      { check: 'standing_size', limit: 'ceiling', comparison: 'le', unit: 'characters' },
    ]);
  });

  it('reads the limit of a second, invented check from its declaration, with its own field, comparison and unit', () => {
    const limits = [
      ...INVARIANT_LIMITS,
      { check: 'boat_capacity', limit: 'berths', comparison: 'le' as const, unit: 'boats' },
      { check: 'crew_floor', limit: 'minimum', comparison: 'ge' as const },
    ];
    const result = estateToVariables(
      mapOf([
        invariant({ check: 'boat_capacity', berths: 12, boats: 9, holds: true }),
        invariant({ check: 'crew_floor', minimum: 2, crew: 3, holds: true }),
      ]),
      resolver(),
      { limits },
    );
    const [capacity, crew] = conditionsOf(result);
    expect(capacity?.id).toBe('condition.boat_capacity');
    expect(capacity?.boundaries?.[0]).toMatchObject({
      holds: 'below_12',
      fails: 'above_12',
      edge: 'at_12',
      limit: 12,
      comparison: 'le',
      unit: 'boats',
    });
    expect(crew?.id).toBe('condition.crew_floor');
    expect(crew?.boundaries?.[0]).toMatchObject({
      holds: 'above_2',
      fails: 'below_2',
      limit: 2,
      comparison: 'ge',
    });
    expect(crew?.boundaries?.[0]).not.toHaveProperty('unit');
    expect(validateVariableStore(result.store).ok).toBe(true);
  });

  it('reads nothing from a check no declaration names, even when its atom has a number and a plausible field name', () => {
    const result = estateToVariables(
      mapOf([invariant({ check: 'boat_capacity', berths: 12, ceiling: 12, holds: true })]),
      resolver(),
    );
    expect(conditionsOf(result)).toEqual([]);
  });

  it('reads the field its declaration names and no other field of the atom', () => {
    const limits = [{ check: 'boat_capacity', limit: 'berths', comparison: 'le' as const }];
    const result = estateToVariables(
      mapOf([invariant({ check: 'boat_capacity', berths: 12, ceiling: 99 })]),
      resolver(),
      { limits },
    );
    expect(conditionsOf(result)[0]?.boundaries?.[0]).toMatchObject({ limit: 12 });
  });

  it('names no check in the feed: the code of the feed holds no id of an estate check', async () => {
    const dir = fileURLToPath(new URL('../../src/variables/', import.meta.url));
    for (const name of (await readdir(dir)).filter((file) => file.endsWith('.ts'))) {
      const code = (await readFile(join(dir, name), 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const rule of INVARIANT_LIMITS)
        expect(code.includes(rule.check), `${name} names ${rule.check}`).toBe(false);
    }
  });
});

describe('no word of a prose situation or quote makes a condition', () => {
  it.each([
    'A shipment is late by more than two days',
    'The total difference is above 50.00 EUR',
    'A boat stays at least 3 nights',
    'A reply is under 120 words',
    'No more than one question per reply',
    'A mooring waits fewer than ten minutes',
    'Within 5 days of the order',
  ])('makes none from the situation "%s"', (situation) => {
    const result = estateToVariables(mapOf([atom({ quote: QUOTE, situation })]), resolver());
    expect(conditionsOf(result)).toEqual([]);
    expect(result.store.variables.map((variable) => variable.id)).toEqual(['atoms.instruction']);
  });

  it('keeps no list of comparison words anywhere in the feed', async () => {
    const dir = fileURLToPath(new URL('../../src/variables/', import.meta.url));
    const words =
      /\b(no more than|no fewer than|no less than|less than|fewer than|greater than|at least|at most|up to|within)\b/i;
    const files = (await readdir(dir)).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const text = await readFile(join(dir, file), 'utf8');
      // Doc comments may name the words the feed does not read; the code and its strings may not.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code.match(words)?.[0], file).toBeUndefined();
    }
  });
});
