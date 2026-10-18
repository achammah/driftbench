import { describe, expect, it } from 'vitest';
import { heavy, readerOnly, tally } from './helpers';
import { referenceSut } from './reference/index';

const FAMILIES = [
  'cutting',
  'ids',
  're-anchoring',
  'grouping',
  'labels',
  'replay',
  'privacy',
  'links',
  'radius',
  'scale',
  'adversarial',
];

/** Families fast enough to run on a second seed. */
const CHEAP = new Set(['cutting', 'ids', 'grouping', 'labels', 'links', 'radius']);

/** Every item is satisfiable: the reference reader, written from the design, passes all of them. */
describe('the reference reader passes the bank', () => {
  for (const family of FAMILIES) {
    it(`${family}`, async () => {
      for (const seed of CHEAP.has(family) ? [1, 2] : [1]) {
        const out = await tally(
          referenceSut(),
          (i) => i.family === family && !readerOnly(i) && !heavy(i),
          seed,
        );
        expect(out.failed, `seed ${seed}`).toEqual([]);
        expect(out.total).toBeGreaterThan(0);
      }
    }, 900_000);
  }
});
