import type { Plan, PlanRow, Row } from '../../interface';
import { stableStringify } from '../util';
import {
  type IndexRow,
  indexRow,
  logWeight,
  type Space,
  type SpaceGroup,
  type SpaceOracle,
  type SpaceVar,
} from './space';

/**
 * The independent check of a plan against the space it was planned from. Every figure comes from the bank's own
 * model (SpaceOracle), never from the plan's report.
 */

/** The smallest chance that a uniform random complete row holds one required tuple: 1 over the largest product. */
export function smallestTupleChance(space: Space, groups: readonly SpaceGroup[]): number {
  let worst = 1;
  for (const g of groups) {
    const t = Math.min(g.strength, g.vars.length);
    const arities = g.vars.map((i) => (space.vars[i] as SpaceVar).values.length).sort((a, b) => b - a);
    let product = 1;
    for (let k = 0; k < t; k += 1) product *= arities[k] as number;
    worst = Math.max(worst, product);
  }
  return 1 / worst;
}

/** The greedy bound: rows enough that a row holding the average share of the uncovered tuples, each time, covers all. */
export function greedyBound(tuples: number, chance: number): number {
  if (tuples <= 0) return 0;
  if (chance >= 1) return 1;
  return Math.max(1, Math.ceil(Math.log(tuples) / -Math.log(1 - chance)));
}

/** The row bound the items accept for `missing` tuples: the greedy bound times the factor, plus one. */
export function rowBound(
  space: Space,
  groups: readonly SpaceGroup[],
  missing: number,
  factor = 1.25,
): number {
  return Math.ceil(factor * greedyBound(missing, smallestTupleChance(space, groups))) + 1;
}

export type ParsedPlan = {
  seeds: PlanRow[];
  fresh: PlanRow[];
  /** The new rows as value indexes (undefined where a key is missing or not a value). */
  freshIndex: IndexRow[];
};

/** The violations of the shape of a plan: rows, kinds, ids, key sets, values. An empty list means a sound shape. */
export function shapeProblems(space: Space, plan: Plan, seeds: readonly Row[]): string[] {
  const out: string[] = [];
  if (!plan || !Array.isArray(plan.rows)) return ['the plan has no rows array'];
  const ids = new Set<string>();
  plan.rows.forEach((row, i) => {
    if (typeof row?.id !== 'string' || row.id === '') out.push(`row ${i} has no id`);
    else if (ids.has(row.id)) out.push(`row ${i} repeats the id ${row.id}`);
    else ids.add(row.id);
    if (row?.kind !== 'seed' && row?.kind !== 'new') out.push(`row ${i} has kind ${String(row?.kind)}`);
    if (typeof row?.values !== 'object' || row.values === null) out.push(`row ${i} has no values`);
    if (typeof row?.weight !== 'number' || Number.isNaN(row.weight)) out.push(`row ${i} has no weight`);
  });
  if (out.length > 0) return out.slice(0, 5);
  if (plan.rows.length < seeds.length) {
    return [`the plan has ${plan.rows.length} rows, fewer than the ${seeds.length} seeds`];
  }
  seeds.forEach((seed, i) => {
    const row = plan.rows[i] as PlanRow;
    if (row.kind !== 'seed') out.push(`row ${i} should be seed ${i} but has kind ${row.kind}`);
    else if (stableStringify(row.values) !== stableStringify(seed)) {
      out.push(
        `seed ${i} was changed: given ${JSON.stringify(seed)}, in the plan ${JSON.stringify(row.values)}`,
      );
    }
  });
  const keys = space.vars.map((v) => v.id);
  for (let i = seeds.length; i < plan.rows.length; i += 1) {
    const row = plan.rows[i] as PlanRow;
    if (row.kind !== 'new') {
      out.push(`row ${i} should be new but has kind ${row.kind}`);
      continue;
    }
    const got = Object.keys(row.values);
    const missing = keys.filter((k) => !(k in row.values));
    const extra = got.filter((k) => !keys.includes(k));
    if (missing.length > 0 || extra.length > 0) {
      out.push(
        `new row ${i} should assign exactly the ${keys.length} variables${missing.length ? `; missing ${missing.slice(0, 3).join(', ')}` : ''}${extra.length ? `; unknown ${extra.slice(0, 3).join(', ')}` : ''}`,
      );
      continue;
    }
    for (const v of space.vars) {
      if (!v.values.includes(row.values[v.id] as string)) {
        out.push(
          `new row ${i} gives ${v.id} the value ${String(row.values[v.id])}, which the store does not list`,
        );
        break;
      }
    }
  }
  return out.slice(0, 5);
}

export function parsePlan(space: Space, plan: Plan, seedCount: number): ParsedPlan {
  const seeds = plan.rows.slice(0, seedCount);
  const fresh = plan.rows.slice(seedCount);
  return { seeds, fresh, freshIndex: fresh.map((r) => indexRow(space, r.values)) };
}

/** New rows that hold an impossible pair, as readable text. */
export function forbiddenRows(space: Space, oracle: SpaceOracle, parsed: ParsedPlan): string[] {
  const out: string[] = [];
  parsed.freshIndex.forEach((row, i) => {
    if (!oracle.rowIsValid(row)) {
      const bad = firstForbidden(space, oracle, row);
      out.push(`new row ${i} holds the impossible pair ${bad}`);
    }
  });
  return out.slice(0, 5);
}

function firstForbidden(space: Space, oracle: SpaceOracle, row: IndexRow): string {
  for (const [a, va, b, vb] of space.forbidden) {
    if (row[a] === va && row[b] === vb) {
      const A = space.vars[a] as SpaceVar;
      const B = space.vars[b] as SpaceVar;
      return `${A.id}=${A.values[va]} with ${B.id}=${B.values[vb]}`;
    }
  }
  void oracle;
  return 'unknown';
}

export type Coverage = { required: number; covered: number; missing: string[] };

/** What the seeds and the new rows leave uncovered (required tuples as readable strings, at most 5 listed). */
export function coverageOf(
  space: Space,
  oracle: SpaceOracle,
  groups: readonly SpaceGroup[],
  seeds: readonly IndexRow[],
  fresh: readonly IndexRow[],
): Coverage {
  const required = oracle.required(groups);
  const got = oracle.covered([...seeds, ...fresh], groups, required);
  const missing: string[] = [];
  for (const key of required) {
    if (!got.has(key)) {
      missing.push(describeKey(space, key));
      if (missing.length >= 5) break;
    }
  }
  return { required: required.size, covered: got.size, missing };
}

/** The required tuples that the seeds alone hold. */
export function seedCoverage(
  oracle: SpaceOracle,
  groups: readonly SpaceGroup[],
  seeds: readonly IndexRow[],
): Set<string> {
  return oracle.covered(seeds, groups);
}

export function describeKey(space: Space, key: string): string {
  return key
    .split(',')
    .map((part) => {
      const [i, j] = part.split(':').map(Number) as [number, number];
      const v = space.vars[i] as SpaceVar;
      return `${v.id}=${v.values[j]}`;
    })
    .join(' ');
}

/** The log weight of each new row, from the shares of the space. */
export function freshLogWeights(space: Space, parsed: ParsedPlan): number[] {
  return parsed.freshIndex.map((row) => logWeight(space, row));
}
