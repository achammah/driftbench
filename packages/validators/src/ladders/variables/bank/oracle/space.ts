import type { ImpossiblePair, Row, StoreDoc } from '../../interface';
import { BANK_SET_HASH, OWNER_DATE } from '../constants';
import { combinations, type Rng } from '../util';

/**
 * The bank's own model of a space: variables with value lists, impossible pairs and rules, all by index. It is
 * the source of every planner input and the base of the independent brute-force counter. Nothing here calls the
 * component under test.
 */

export type SpaceVar = {
  id: string;
  values: string[];
  /** A shared axis (strength 2). */
  shared: boolean;
  /** The share of each value, summing to 1; absent means no weights in the store. */
  weights?: number[];
};

export type Space = {
  vars: SpaceVar[];
  /** Impossible pairs as (variable a, value a, variable b, value b) with a < b. */
  forbidden: Array<readonly [number, number, number, number]>;
  rules: Array<{ id: string; vars: number[] }>;
  /**
   * True when value 0 of every variable is in no forbidden pair, so a tuple without a forbidden pair always
   * extends to a valid full row (allowed in the weak sense equals allowed in the strict sense).
   */
  universal: boolean;
};

export type SpaceGroup = {
  id: string;
  kind: 'rule' | 'shared' | 'other';
  /** Variable indexes, ascending. */
  vars: number[];
  strength: number;
};

export const varId = (i: number): string => `v${String(i).padStart(3, '0')}`;
export const valId = (j: number): string => `x${j}`;

/** A space of `arities.length` variables named v000.. with values x0.. */
export function makeSpace(
  arities: readonly number[],
  options: { shared?: readonly number[]; rules?: ReadonlyArray<readonly number[]>; universal?: boolean } = {},
): Space {
  const shared = new Set(options.shared ?? []);
  return {
    vars: arities.map((a, i) => ({
      id: varId(i),
      values: Array.from({ length: a }, (_, j) => valId(j)),
      shared: shared.has(i),
    })),
    forbidden: [],
    rules: (options.rules ?? []).map((vars, k) => ({
      id: `R${k + 1}`,
      vars: [...vars].sort((a, b) => a - b),
    })),
    universal: options.universal ?? true,
  };
}

function pairKey(a: number, va: number, b: number, vb: number): number {
  return ((a * 4096 + va) * 65536 + b) * 4096 + vb;
}

export function forbidSet(space: Space): Set<number> {
  const set = new Set<number>();
  for (const [a, va, b, vb] of space.forbidden) set.add(pairKey(a, va, b, vb));
  return set;
}

export function isForbidden(set: Set<number>, a: number, va: number, b: number, vb: number): boolean {
  return a < b ? set.has(pairKey(a, va, b, vb)) : set.has(pairKey(b, vb, a, va));
}

/** Adds a forbidden pair with the lower variable first. */
export function forbid(space: Space, a: number, va: number, b: number, vb: number): void {
  if (a === b) throw new Error('a pair joins two variables');
  space.forbidden.push(a < b ? [a, va, b, vb] : [b, vb, a, va]);
}

/** Forbids random pairs among the non-universal values (index 1 and up) of distinct variables. */
export function forbidRandom(space: Space, rng: Rng, density: number): void {
  const taken = forbidSet(space);
  for (let a = 0; a < space.vars.length; a += 1) {
    for (let b = a + 1; b < space.vars.length; b += 1) {
      const va = space.vars[a] as SpaceVar;
      const vb = space.vars[b] as SpaceVar;
      for (let i = 1; i < va.values.length; i += 1) {
        for (let j = 1; j < vb.values.length; j += 1) {
          if (rng.chance(density) && !taken.has(pairKey(a, i, b, j))) {
            taken.add(pairKey(a, i, b, j));
            space.forbidden.push([a, i, b, j]);
          }
        }
      }
    }
  }
}

/** Skewed shares that sum to 1, each at least `floor`. */
export function skewedShares(rng: Rng, count: number, floor = 0.02): number[] {
  const raw = Array.from({ length: count }, () => 0.05 + rng.next() ** 3);
  const total = raw.reduce((a, b) => a + b, 0);
  const shares = raw.map((r) => Math.max(floor, r / total));
  const t2 = shares.reduce((a, b) => a + b, 0);
  return shares.map((s) => s / t2);
}

export function withWeights(space: Space, rng: Rng, floor = 0.02): Space {
  for (const v of space.vars) v.weights = skewedShares(rng, v.values.length, floor);
  return space;
}

/** The space as a store document (owner provenance on every value, as a hand-written store would have). */
export function toStore(
  space: Space,
  options: { weightProvenance?: 'owner' | 'conversations' } = {},
): StoreDoc {
  const prov = options.weightProvenance ?? 'owner';
  return {
    variables: space.vars.map((v) => ({
      id: v.id,
      ...(v.shared ? { shared: true } : {}),
      values: v.values.map((id, j) => {
        const w = v.weights?.[j];
        return {
          id,
          provenance:
            prov === 'conversations' && w !== undefined
              ? [
                  {
                    kind: 'conversations' as const,
                    count: Math.round(w * 1000),
                    total: 1000,
                    set_hash: BANK_SET_HASH,
                  },
                ]
              : [{ kind: 'owner' as const, words: `bank value ${v.id}.${id}`, date: OWNER_DATE }],
          ...(w !== undefined ? { weight: w } : {}),
        };
      }),
    })),
    impossible: space.forbidden.map(([a, va, b, vb]): ImpossiblePair => {
      const A = space.vars[a] as SpaceVar;
      const B = space.vars[b] as SpaceVar;
      return {
        a: { variable: A.id, value: A.values[va] as string },
        b: { variable: B.id, value: B.values[vb] as string },
        provenance: [{ kind: 'owner', words: 'bank impossible pair', date: OWNER_DATE }],
      };
    }),
    rules: space.rules.map((r) => ({
      id: r.id,
      variables: r.vars.map((i) => (space.vars[i] as SpaceVar).id),
    })),
    refused: [],
  };
}

/** The groups the plan must cover: strength 3 per rule, 2 on the shared axes, 1 on every other variable. */
export function groupsOf(space: Space): SpaceGroup[] {
  const groups: SpaceGroup[] = [];
  const inRule = new Set<number>();
  for (const r of space.rules) {
    const vars = [...new Set(r.vars)].sort((a, b) => a - b);
    for (const v of vars) inRule.add(v);
    if (vars.length > 0) groups.push({ id: r.id, kind: 'rule', vars, strength: 3 });
  }
  const shared = space.vars.flatMap((v, i) => (v.shared ? [i] : []));
  if (shared.length > 0) groups.push({ id: 'axes', kind: 'shared', vars: shared, strength: 2 });
  space.vars.forEach((v, i) => {
    if (!inRule.has(i) && !v.shared) groups.push({ id: v.id, kind: 'other', vars: [i], strength: 1 });
  });
  return groups;
}

/** The groups as the counter takes them (variable ids). */
export function counterGroups(space: Space, groups: readonly SpaceGroup[] = groupsOf(space)) {
  return groups.map((g) => ({
    variables: g.vars.map((i) => (space.vars[i] as SpaceVar).id),
    strength: g.strength,
  }));
}

export const tupleKey = (vars: readonly number[], vals: readonly number[]): string =>
  vars.map((v, i) => `${v}:${vals[i]}`).join(',');

/** One complete or partial row as value indexes (undefined: not assigned). */
export type IndexRow = Array<number | undefined>;

/**
 * Exhaustive reference over a space: valid rows, allowed tuples (a tuple is allowed when some valid full row
 * holds it), and coverage of a set of rows. Small spaces only: the product of arities is capped.
 */
export class SpaceOracle {
  readonly forbid: Set<number>;
  private rows: number[][] | undefined;
  private projections = new Map<string, number[][]>();

  constructor(
    readonly space: Space,
    private readonly rowCap = 400_000,
  ) {
    this.forbid = forbidSet(space);
  }

  /** Every valid full row, as value indexes. */
  validRows(): number[][] {
    if (this.rows) return this.rows;
    const n = this.space.vars.length;
    const out: number[][] = [];
    const current = new Array<number>(n).fill(0);
    const dfs = (i: number): void => {
      if (i === n) {
        out.push([...current]);
        if (out.length > this.rowCap) throw new Error(`the space has more than ${this.rowCap} valid rows`);
        return;
      }
      const arity = (this.space.vars[i] as SpaceVar).values.length;
      for (let v = 0; v < arity; v += 1) {
        let ok = true;
        for (let j = 0; j < i && ok; j += 1) {
          if (isForbidden(this.forbid, j, current[j] as number, i, v)) ok = false;
        }
        if (!ok) continue;
        current[i] = v;
        dfs(i + 1);
      }
    };
    dfs(0);
    this.rows = out;
    return out;
  }

  /** Whether a (possibly partial) row holds no forbidden pair. */
  rowIsValid(row: IndexRow): boolean {
    for (let a = 0; a < row.length; a += 1) {
      const va = row[a];
      if (va === undefined) continue;
      for (let b = a + 1; b < row.length; b += 1) {
        const vb = row[b];
        if (vb !== undefined && isForbidden(this.forbid, a, va, b, vb)) return false;
      }
    }
    return true;
  }

  /** The value tuples allowed on the variable subset S (ascending indexes). */
  allowedOn(subset: readonly number[]): number[][] {
    const key = subset.join(',');
    const cached = this.projections.get(key);
    if (cached) return cached;
    let out: number[][];
    if (this.space.universal) {
      out = [];
      const arities = subset.map((i) => (this.space.vars[i] as SpaceVar).values.length);
      const cur = new Array<number>(subset.length).fill(0);
      const go = (p: number): void => {
        if (p === subset.length) {
          out.push([...cur]);
          return;
        }
        for (let v = 0; v < (arities[p] as number); v += 1) {
          let ok = true;
          for (let q = 0; q < p && ok; q += 1) {
            if (isForbidden(this.forbid, subset[q] as number, cur[q] as number, subset[p] as number, v))
              ok = false;
          }
          if (!ok) continue;
          cur[p] = v;
          go(p + 1);
        }
      };
      go(0);
    } else {
      const seen = new Set<string>();
      out = [];
      for (const row of this.validRows()) {
        const vals = subset.map((i) => row[i] as number);
        const k = vals.join(',');
        if (!seen.has(k)) {
          seen.add(k);
          out.push(vals);
        }
      }
    }
    this.projections.set(key, out);
    return out;
  }

  /** Every allowed tuple the groups require, as keys. */
  required(groups: readonly SpaceGroup[]): Set<string> {
    const out = new Set<string>();
    for (const g of groups) {
      const t = Math.min(g.strength, g.vars.length);
      for (const idx of combinations(g.vars.length, t)) {
        const subset = idx.map((i) => g.vars[i] as number);
        for (const vals of this.allowedOn(subset)) out.add(tupleKey(subset, vals));
      }
    }
    return out;
  }

  /** The required tuples that the rows hold (a partial row holds the tuples inside its assigned variables). */
  covered(rows: readonly IndexRow[], groups: readonly SpaceGroup[], required?: Set<string>): Set<string> {
    const req = required ?? this.required(groups);
    const out = new Set<string>();
    for (const g of groups) {
      const t = Math.min(g.strength, g.vars.length);
      const subsets = [...combinations(g.vars.length, t)].map((idx) => idx.map((i) => g.vars[i] as number));
      for (const row of rows) {
        for (const subset of subsets) {
          const vals: number[] = [];
          let complete = true;
          for (const i of subset) {
            const v = row[i];
            if (v === undefined) {
              complete = false;
              break;
            }
            vals.push(v);
          }
          if (!complete) continue;
          const key = tupleKey(subset, vals);
          if (req.has(key)) out.add(key);
        }
      }
    }
    return out;
  }
}

/** A row of ids as value indexes; undefined for a variable the row does not assign. Throws on unknown ids. */
export function indexRow(space: Space, row: Row): IndexRow {
  const out: IndexRow = new Array(space.vars.length).fill(undefined);
  const index = new Map(space.vars.map((v, i) => [v.id, i] as const));
  for (const [variable, value] of Object.entries(row)) {
    const i = index.get(variable);
    if (i === undefined) throw new Error(`unknown variable ${variable}`);
    const j = (space.vars[i] as SpaceVar).values.indexOf(value);
    if (j < 0) throw new Error(`unknown value ${value} of ${variable}`);
    out[i] = j;
  }
  return out;
}

export function rowOf(space: Space, idx: readonly (number | undefined)[]): Row {
  const out: Row = {};
  idx.forEach((v, i) => {
    if (v !== undefined)
      out[(space.vars[i] as SpaceVar).id] = (space.vars[i] as SpaceVar).values[v] as string;
  });
  return out;
}

/** The log of the traffic weight of a row: the sum of the logs of its value shares (uniform without weights). */
export function logWeight(space: Space, row: IndexRow): number {
  let total = 0;
  row.forEach((v, i) => {
    if (v === undefined) return;
    const sv = space.vars[i] as SpaceVar;
    total += Math.log(sv.weights ? (sv.weights[v] as number) : 1 / sv.values.length);
  });
  return total;
}
