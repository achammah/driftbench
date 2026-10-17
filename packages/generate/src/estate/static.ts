import { z } from 'zod';
import type { EstateAtom, EstatePlanRow } from './inputs';

/**
 * A static test: a property of the estate files, checked with no run, by `driftbench estate static` on an
 * estate root (the original or a mutant copy). The generator writes one per invariant row and per setting
 * row, as JSON beside the specs (`static/<test type>/<id>.json`).
 *
 * - invariant: the invariant atom of that check still holds when the estate is read again (`standing_size`,
 *   `no_orphans`, `guard_paths_anchored`, `registry_complete`).
 * - setting: the settings still declare the key, with the value when the map kept one.
 */
export const StaticCheck = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('invariant'), check: z.string().min(1) }),
  z.strictObject({ kind: z.literal('setting'), key: z.string().min(1), value: z.string().optional() }),
]);
export type StaticCheck = z.infer<typeof StaticCheck>;

export const StaticTest = z.strictObject({
  id: z.string().min(1),
  planRow: z.string().min(1),
  testType: z.enum(['invariant', 'setting']),
  atom: z.string().min(1),
  title: z.string().min(1),
  check: StaticCheck,
  mapHash: z.string().min(1),
  /** Why maintenance retired the test (`estate impact --write`): a retired test is not run or counted. */
  retired: z.string().min(1).optional(),
});
export type StaticTest = z.infer<typeof StaticTest>;

export const STATIC_DIR = 'static';
export const STATIC_TEST_TYPES: ReadonlySet<string> = new Set(['invariant', 'setting']);

/** The static check of a row's first atom, or a reason it has none. */
export function staticCheckOf(row: EstatePlanRow, atom: EstateAtom): StaticCheck | string {
  if (row.testType === 'setting') {
    const key = atom.fields?.key;
    if (typeof key !== 'string' || key === '') return `${atom.id} names no setting key`;
    const value = atom.fields?.value;
    return { kind: 'setting', key, ...(typeof value === 'string' ? { value } : {}) };
  }
  const evidence = atom.evidence.find((entry) => entry.type === 'static');
  const check = evidence?.type === 'static' ? evidence.check : atom.fields?.check;
  if (typeof check !== 'string' || check === '') return `${atom.id} names no static check`;
  return { kind: 'invariant', check };
}
