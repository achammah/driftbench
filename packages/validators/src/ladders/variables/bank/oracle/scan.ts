import { combinations } from '../util';
import { forbidSet, isForbidden, type Space, type SpaceGroup, type SpaceVar } from './space';

/**
 * Coverage scans that stay fast on hundreds of variables: for every subset of a group they mark the value
 * combinations the rows hold in a small table and compare with the allowed combinations. They assume the space
 * is universal (value 0 of every variable is in no impossible pair), so a combination without a forbidden pair
 * is allowed. They never enumerate the full grid.
 */

export type ScanResult = {
  /** Distinct required tuples (subsets counted once even when several groups share them). */
  required: number;
  /** Required tuples no row holds. */
  missing: number;
  /** A readable sample of the first missing tuples. */
  sample: string[];
};

export function scanCoverage(
  space: Space,
  groups: readonly SpaceGroup[],
  rows: ReadonlyArray<ReadonlyArray<number>>,
): ScanResult {
  const forbid = forbidSet(space);
  const done = new Set<string>();
  let required = 0;
  let missing = 0;
  const sample: string[] = [];
  for (const g of groups) {
    const t = Math.min(g.strength, g.vars.length);
    for (const idx of combinations(g.vars.length, t)) {
      const subset = idx.map((i) => g.vars[i] as number);
      const key = subset.join(',');
      if (done.has(key)) continue;
      done.add(key);
      const arities = subset.map((i) => (space.vars[i] as SpaceVar).values.length);
      const size = arities.reduce((a, b) => a * b, 1);
      const seen = new Uint8Array(size);
      for (const row of rows) {
        let at = 0;
        for (let k = 0; k < subset.length; k += 1)
          at = at * (arities[k] as number) + (row[subset[k] as number] as number);
        seen[at] = 1;
      }
      const vals = new Array<number>(subset.length).fill(0);
      for (let at = 0; at < size; at += 1) {
        let rest = at;
        for (let k = subset.length - 1; k >= 0; k -= 1) {
          vals[k] = rest % (arities[k] as number);
          rest = Math.floor(rest / (arities[k] as number));
        }
        let bad = false;
        for (let p = 0; p < subset.length && !bad; p += 1) {
          for (let q = p + 1; q < subset.length && !bad; q += 1) {
            if (
              isForbidden(
                forbid,
                subset[p] as number,
                vals[p] as number,
                subset[q] as number,
                vals[q] as number,
              )
            )
              bad = true;
          }
        }
        if (bad) continue;
        required += 1;
        if (!seen[at]) {
          missing += 1;
          if (sample.length < 3)
            sample.push(
              subset
                .map(
                  (v, k) =>
                    `${(space.vars[v] as SpaceVar).id}=${(space.vars[v] as SpaceVar).values[vals[k] as number]}`,
                )
                .join(' '),
            );
        }
      }
    }
  }
  return { required, missing, sample };
}

/** The number of rows that hold an impossible pair, and the first such pair as text. */
export function rowsWithForbidden(
  space: Space,
  rows: ReadonlyArray<ReadonlyArray<number>>,
): { count: number; first?: string } {
  let count = 0;
  let first: string | undefined;
  for (const row of rows) {
    for (const [a, va, b, vb] of space.forbidden) {
      if (row[a] === va && row[b] === vb) {
        count += 1;
        first ??= `${(space.vars[a] as SpaceVar).id}=${(space.vars[a] as SpaceVar).values[va]} with ${(space.vars[b] as SpaceVar).id}=${(space.vars[b] as SpaceVar).values[vb]}`;
        break;
      }
    }
  }
  return { count, first };
}

/** The tuples a set of groups requires, counted without a row set (universal spaces). */
export function requiredCount(space: Space, groups: readonly SpaceGroup[]): number {
  return scanCoverage(space, groups, []).required;
}
