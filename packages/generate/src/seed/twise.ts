import { combinations } from '@agent-nexus/driftbench-space';
import type { Feasibility } from './feasible';
import { type Rng, range, shuffle } from './random';

/** What the covering array asks of the constraints: whether some picks can occur together. */
export type AllowedCheck = Pick<Feasibility, 'allowed'>;

/**
 * A greedy covering array of strength t under constraints, in the AETG style (Cohen, Dalal, Fredman and
 * Patton, 1997) with the constrained t-way coverage of NIST SP 800-142 (the one PICT and ACTS compute):
 * each row starts from the first t-tuple still uncovered, then takes, dimension by dimension in a seeded
 * order, the value that covers the most uncovered tuples with the values already chosen, among the values
 * that keep the row extendable to an allowed full cell. Rows are added until every allowed t-tuple of the
 * chosen dimensions is in some row.
 */

/** A t-tuple: dimension indices in increasing order and one value index each. */
export type Tuple = { dimensions: number[]; values: number[] };

export type CoveringArray = {
  t: number;
  dimensions: number[];
  /** One value index per dimension of the map; -1 on dimensions outside the array. */
  rows: number[][];
  /** Allowed t-tuples over the array's dimensions. */
  allowed: number;
  /** Allowed t-tuples the rows cover. */
  covered: number;
};

/** The most t-tuples the generator will list before it refuses (t = 3 on a wide map grows fast). */
export const MAX_TUPLES = 2_000_000;

export function tupleKey(dimensions: readonly number[], values: readonly number[]): string {
  return dimensions.map((dimension, index) => `${dimension}=${values[index]}`).join(',');
}

/** Every allowed t-tuple over the dimensions given, in lexicographic order. */
export function allowedTuples(
  feasibility: AllowedCheck,
  sizes: readonly number[],
  dimensions: readonly number[],
  t: number,
): Tuple[] {
  const out: Tuple[] = [];
  let listed = 0;
  for (const subset of combinations(dimensions.length, t)) {
    const chosen = subset.map((index) => dimensions[index] as number);
    const counts = chosen.map((dimension) => sizes[dimension] ?? 0);
    const total = counts.reduce((product, count) => product * count, 1);
    listed += total;
    if (listed > MAX_TUPLES) {
      throw new RangeError(`more than ${MAX_TUPLES} ${t}-tuples: lower t or split the map`);
    }
    for (let code = 0; code < total; code += 1) {
      const values: number[] = [];
      let rest = code;
      for (let position = counts.length - 1; position >= 0; position -= 1) {
        const count = counts[position] ?? 1;
        values.unshift(rest % count);
        rest = Math.floor(rest / count);
      }
      const pairs = chosen.map((dimension, index) => [dimension, values[index] as number] as const);
      if (feasibility.allowed(pairs)) out.push({ dimensions: chosen, values });
    }
  }
  return out;
}

export function coveringArray(
  feasibility: AllowedCheck,
  sizes: readonly number[],
  dimensions: readonly number[],
  t: number,
  rng: Rng,
  maxRows: number,
): CoveringArray {
  const rows: number[][] = [];
  const result = visitCoveringArray(feasibility, sizes, dimensions, t, rng, maxRows, (row) => rows.push(row));
  return { ...result, rows };
}

/** The same choices as coveringArray, releasing each emitted row instead of retaining the array. */
export function visitCoveringArray(
  feasibility: AllowedCheck,
  sizes: readonly number[],
  dimensions: readonly number[],
  t: number,
  rng: Rng,
  maxRows: number,
  emit: (row: number[]) => void,
): Omit<CoveringArray, 'rows'> & { rows: number } {
  const tuples = allowedTuples(feasibility, sizes, dimensions, t);
  const uncovered = new Set(tuples.map((tuple) => tupleKey(tuple.dimensions, tuple.values)));
  let rows = 0;
  // Every t-subset of the dimensions, as dimension ids: the same for every row.
  const rowSubsets = combinations(dimensions.length, t).map((subset) =>
    subset.map((index) => dimensions[index] as number),
  );
  const subsetsWith = (dimension: number, chosen: number[]): number[][] =>
    combinations(chosen.length, t - 1).map((subset) =>
      [...subset.map((index) => chosen[index] as number), dimension].sort((a, b) => a - b),
    );
  for (const seed of tuples) {
    if (rows >= maxRows || uncovered.size === 0) break;
    if (!uncovered.has(tupleKey(seed.dimensions, seed.values))) continue;
    const row = sizes.map(() => -1);
    seed.dimensions.forEach((dimension, index) => {
      row[dimension] = seed.values[index] as number;
    });
    const chosen = [...seed.dimensions];
    for (const dimension of shuffle(
      rng,
      dimensions.filter((candidate) => !seed.dimensions.includes(candidate)),
    )) {
      let best = -1;
      let bestGain = -1;
      // The subsets depend on the dimension and the dimensions already chosen, not on the value tried.
      const subsets = subsetsWith(dimension, chosen);
      for (const value of shuffle(rng, range(sizes[dimension] ?? 0))) {
        row[dimension] = value;
        const pairs = chosen.map((at) => [at, row[at] as number] as const);
        if (!feasibility.allowed([...pairs, [dimension, value]])) continue;
        let gain = 0;
        for (const subset of subsets) {
          if (
            uncovered.has(
              tupleKey(
                subset,
                subset.map((at) => row[at] as number),
              ),
            )
          )
            gain += 1;
        }
        if (gain > bestGain) {
          best = value;
          bestGain = gain;
        }
      }
      row[dimension] = best;
      if (best < 0) break;
      chosen.push(dimension);
    }
    if (chosen.length < dimensions.length) continue;
    for (const at of rowSubsets) {
      uncovered.delete(
        tupleKey(
          at,
          at.map((dimension) => row[dimension] as number),
        ),
      );
    }
    rows += 1;
    emit(row);
  }
  return {
    t,
    dimensions: [...dimensions],
    rows,
    allowed: tuples.length,
    covered: tuples.length - uncovered.size,
  };
}
