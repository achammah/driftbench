import type { CoverageResult, Group, Row } from '../../interface';
import { callCoverage, callCoverageError, type ItemContext, type StemRun } from '../item';
import {
  counterGroups,
  forbid,
  groupsOf,
  type IndexRow,
  makeSpace,
  rowOf,
  type Space,
  type SpaceGroup,
  SpaceOracle,
  type SpaceVar,
  toStore,
  tupleKey,
} from '../oracle/space';
import { randomSpace, randomValidRow } from '../oracle/spaces';
import { choose, cpuMs, must, type Rng, show } from '../util';

/** The exact value of a count: a bigint, or a number that is a safe integer. */
export function toBig(v: number | bigint, label: string): bigint {
  if (typeof v === 'bigint') return v;
  must(
    Number.isInteger(v) && Number.isSafeInteger(v),
    () => `${label} is ${show(v)}, which is not an exact integer (a count beyond 2^53 must be a bigint)`,
  );
  return BigInt(v);
}

/** The elementary symmetric polynomial e_t of the arities, exactly. */
export function elementary(arities: readonly number[], t: number): bigint {
  const e = new Array<bigint>(t + 1).fill(0n);
  e[0] = 1n;
  for (const a of arities) {
    for (let k = t; k >= 1; k -= 1) e[k] = (e[k] as bigint) + (e[k - 1] as bigint) * BigInt(a);
  }
  return e[t] as bigint;
}

/** Variables 0..n-1 as a single counter group of the given strength. */
const wholeGroup = (space: Space, strength: number): Group => ({
  variables: space.vars.map((v) => v.id),
  strength,
});

/** The oracle's allowed and covered counts for the groups, by exhaustive enumeration of the valid rows. */
function reference(
  space: Space,
  rows: readonly IndexRow[],
  groups: readonly SpaceGroup[],
): { allowed: number; covered: number; oracle: SpaceOracle } {
  const oracle = new SpaceOracle({ ...space, universal: false });
  const required = oracle.required(groups);
  const covered = oracle.covered(rows, groups, required);
  return { allowed: required.size, covered: covered.size, oracle };
}

const asGroup = (g: SpaceGroup): Group => ({
  variables: g.vars.map((i) => `v${String(i).padStart(3, '0')}`),
  strength: g.strength,
});

function compare(
  ctx: ItemContext,
  space: Space,
  rows: readonly IndexRow[],
  groups: readonly SpaceGroup[],
  label: string,
): CoverageResult {
  const ref = reference(space, rows, groups);
  const result = callCoverage(
    ctx,
    toStore(space),
    rows.map((r) => rowOf(space, r)),
    groups.map(asGroup),
  );
  const allowed = toBig(result.allowed, 'allowed');
  const covered = toBig(result.covered, 'covered');
  must(
    allowed === BigInt(ref.allowed),
    () => `${label}: allowed ${allowed}, exhaustive enumeration gives ${ref.allowed}`,
  );
  must(
    covered === BigInt(ref.covered),
    () => `${label}: covered ${covered}, exhaustive enumeration gives ${ref.covered}`,
  );
  return result;
}

/** A matching: disjoint variable pairs, each with some forbidden value pairs among non-universal values. */
function matchingSpace(
  rng: Rng,
  vars: number,
  pairs: number,
  arityRange: [number, number],
): { space: Space; spec: Array<{ a: number; b: number; f: number }> } {
  const arities = Array.from({ length: vars }, () => rng.int(arityRange[0], arityRange[1]));
  const space = makeSpace(arities, { universal: true });
  const order = rng.shuffle(Array.from({ length: vars }, (_, i) => i));
  const spec: Array<{ a: number; b: number; f: number }> = [];
  for (let k = 0; k < pairs; k += 1) {
    const a = Math.min(order[2 * k] as number, order[2 * k + 1] as number);
    const b = Math.max(order[2 * k] as number, order[2 * k + 1] as number);
    const cells: Array<[number, number]> = [];
    for (let i = 1; i < (arities[a] as number); i += 1)
      for (let j = 1; j < (arities[b] as number); j += 1) cells.push([i, j]);
    const chosen = rng.sample(cells, Math.min(cells.length, rng.int(1, 3)));
    for (const [i, j] of chosen) forbid(space, a, i, b, j);
    spec.push({ a, b, f: chosen.length });
  }
  return { space, spec };
}

/** The allowed t-tuples of a matching space: the z^t coefficient of the product of per-pair and per-variable factors. */
function matchingCount(
  space: Space,
  spec: ReadonlyArray<{ a: number; b: number; f: number }>,
  t: number,
): bigint {
  const inPair = new Set(spec.flatMap((s) => [s.a, s.b]));
  const factors: bigint[][] = [];
  for (const s of spec) {
    const A = BigInt(space.vars[s.a]?.values.length ?? 0);
    const B = BigInt(space.vars[s.b]?.values.length ?? 0);
    factors.push([1n, A + B, A * B - BigInt(s.f)]);
  }
  space.vars.forEach((v, i) => {
    if (!inPair.has(i)) factors.push([1n, BigInt(v.values.length)]);
  });
  let poly: bigint[] = [1n];
  for (const f of factors) {
    const next = new Array<bigint>(Math.min(t, poly.length + f.length - 2) + 1).fill(0n);
    for (const [i, c] of poly.entries()) {
      for (const [j, d] of f.entries()) {
        if (i + j <= t) next[i + j] = (next[i + j] as bigint) + c * d;
      }
    }
    poly = next;
  }
  return poly[t] ?? 0n;
}

function randomRows(space: Space, oracle: SpaceOracle, rng: Rng, count: number): IndexRow[] {
  return Array.from({ length: count }, () => randomValidRow(space, oracle, rng));
}

export const COUNTER_RUNS: Record<string, StemRun> = {
  'counter.closed-form': (variant, ctx) => {
    const { rng } = ctx;
    let arities: number[];
    let t: number;
    switch (variant) {
      case 'five-three-two':
        arities = Array(5).fill(3);
        t = 2;
        break;
      case 'fifty-seven-one':
        arities = Array(50).fill(7);
        t = 1;
        break;
      case 'twelve-four-three':
        arities = Array(12).fill(4);
        t = 3;
        break;
      case 't-above-k':
        arities = Array(6).fill(2);
        t = 9;
        break;
      case 'three-variables-mixed':
        arities = [2, 3, 5];
        t = 2;
        break;
      case 'thirty-mixed-t3':
        arities = Array.from({ length: 30 }, () => rng.int(1, 9));
        t = 3;
        break;
      case 'with-arity-one':
        arities = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? 1 : rng.int(2, 6)));
        t = 3;
        break;
      case 'two-hundred-binary-three':
        arities = Array(200).fill(2);
        t = 3;
        break;
      default:
        arities = Array.from({ length: 10 }, () => rng.int(100, 5000));
        t = 3;
    }
    const space = makeSpace(arities);
    const result = callCoverage(ctx, toStore(space), [], [wholeGroup(space, t)]);
    const want = elementary(arities, Math.min(t, arities.length));
    const got = toBig(result.allowed, 'allowed');
    must(
      got === want,
      () =>
        `${arities.length} variables (arities ${show(arities, 90)}) at strength ${t}: allowed ${got}, expected ${want}`,
    );
    must(
      toBig(result.covered, 'covered') === 0n,
      () => `no row was given but covered is ${show(result.covered)}`,
    );
  },

  'counter.constraints-matching': (variant, ctx) => {
    const { rng } = ctx;
    const [vars, pairs, t] =
      variant === 'five-pairs-t2' ? [20, 5, 2] : variant === 'five-pairs-t3' ? [20, 5, 3] : [200, 100, 3];
    const { space, spec } = matchingSpace(
      rng,
      vars,
      pairs,
      variant === 'five-pairs-t2' || variant === 'five-pairs-t3' ? [3, 5] : [2, 3],
    );
    const result = callCoverage(ctx, toStore(space), [], [wholeGroup(space, t)]);
    const want = matchingCount(space, spec, t);
    const got = toBig(result.allowed, 'allowed');
    must(
      got === want,
      () =>
        `${vars} variables with ${pairs} matched variable pairs and ${space.forbidden.length} impossible pairs at strength ${t}: allowed ${got}, expected ${want}`,
    );
  },

  'counter.brute-force-weak-equals-strict': (variant, ctx) => {
    const { rng } = ctx;
    const t = variant === 't1' ? 1 : variant === 't2' ? 2 : 3;
    for (let k = 0; k < 6; k += 1) {
      const space = randomSpace(rng, {
        vars: rng.int(4, 6),
        minArity: 2,
        maxArity: 4,
        density: 0.2 + rng.next() * 0.2,
      });
      compare(
        ctx,
        space,
        [],
        [{ id: 'g', kind: 'rule', vars: space.vars.map((_, i) => i), strength: t }],
        `random space ${k + 1} (${space.vars.length} variables, ${space.forbidden.length} pairs) at strength ${t}`,
      );
    }
  },

  'counter.strict-extendable': (variant, ctx) => {
    const { rng } = ctx;
    const g = (vars: number[], strength: number): SpaceGroup => ({ id: 'g', kind: 'rule', vars, strength });
    if (variant === 'triangle') {
      const space = makeSpace([2, 2, 2], { universal: false });
      forbid(space, 0, 0, 2, 0);
      forbid(space, 1, 1, 2, 1);
      const r = compare(
        ctx,
        space,
        [],
        [g([0, 1], 2)],
        'the pair (v000=x0, v001=x1) is allowed pairwise but no value of v002 completes it',
      );
      must(toBig(r.allowed, 'allowed') === 3n, () => `allowed ${show(r.allowed)}, expected 3`);
      return;
    }
    if (variant === 'forced-out') {
      const space = makeSpace([2, 2, 3], { universal: false });
      forbid(space, 0, 1, 1, 0);
      forbid(space, 0, 1, 1, 1);
      const r = compare(ctx, space, [], [g([0], 1), g([0, 2], 2)], 'v000=x1 has no valid row');
      must(
        toBig(r.allowed, 'allowed') === 1n + 3n,
        () => `allowed ${show(r.allowed)}, expected 4 (x0 alone, and x0 with 3 values of v002)`,
      );
      return;
    }
    if (variant === 'two-step') {
      const space = makeSpace([2, 2, 2, 3], { universal: false });
      forbid(space, 0, 1, 1, 0);
      forbid(space, 1, 1, 2, 0);
      forbid(space, 1, 1, 2, 1);
      const r = compare(
        ctx,
        space,
        [],
        [g([0], 1), g([0, 1], 2)],
        'v000=x1 is out through a chain of two pairs',
      );
      must(
        toBig(r.allowed, 'allowed') === 2n,
        () => `allowed ${show(r.allowed)}, expected 2 (x0 alone, and x0 with y0)`,
      );
      return;
    }
    if (variant === 'empty-space') {
      const space = makeSpace([1, 1, 2], { universal: false });
      compare(ctx, space, [[0, 0, 0]], [g([0, 1, 2], 2), g([2], 1)], 'the satisfiable control');
      forbid(space, 0, 0, 1, 0);
      const r = compare(ctx, space, [], [g([0, 1, 2], 2), g([2], 1)], 'a space with no valid row');
      must(toBig(r.allowed, 'allowed') === 0n, () => `allowed ${show(r.allowed)}, expected 0`);
      return;
    }
    // random cases without a universal value: every value may be in a pair
    for (let k = 0; k < 6; k += 1) {
      const arities = Array.from({ length: rng.int(4, 6) }, () => rng.int(2, 3));
      let space = makeSpace(arities, { universal: false });
      const density = variant === 'dense' ? 0.8 : 0.5;
      for (let a = 0; a < arities.length; a += 1)
        for (let b = a + 1; b < arities.length; b += 1)
          for (let i = 0; i < (arities[a] as number); i += 1)
            for (let j = 0; j < (arities[b] as number); j += 1)
              if (rng.chance(density * 0.35)) forbid(space, a, i, b, j);
      const oracle = new SpaceOracle(space);
      if (oracle.validRows().length === 0) {
        space = makeSpace(arities, { universal: false });
      }
      const all = space.vars.map((_, i) => i);
      const groups: SpaceGroup[] =
        variant === 'per-group-strengths'
          ? [
              g(rng.sample(all, 3), 1),
              g(rng.sample(all, 4), 2),
              g(rng.sample(all, Math.min(4, all.length)), 3),
            ].map((x) => ({ ...x, vars: [...x.vars].sort((p, q) => p - q) }))
          : variant === 'single-group-all-variables'
            ? [g(all, all.length)]
            : [g(all, rng.int(2, 3))];
      compare(
        ctx,
        space,
        [],
        groups,
        `random space ${k + 1} (${arities.length} variables, ${space.forbidden.length} pairs, ${new SpaceOracle(space).validRows().length} valid rows)`,
      );
    }
  },

  'counter.covered-complete-rows': (variant, ctx) => {
    const { rng } = ctx;
    for (let k = 0; k < 4; k += 1) {
      const space = randomSpace(rng, {
        vars: rng.int(4, 6),
        minArity: 2,
        maxArity: 3,
        density: 0.2,
        shared: 2,
        rules: [3],
      });
      const oracle = new SpaceOracle(space);
      const rows =
        variant === 'rows-cover-all'
          ? oracle.validRows()
          : randomRows(space, oracle, rng, variant === 'five-rows' ? 5 : 30);
      compare(ctx, space, rows, groupsOf(space), `space ${k + 1} with ${rows.length} rows`);
    }
  },

  'counter.covered-partial-rows': (variant, ctx) => {
    const { rng } = ctx;
    for (let k = 0; k < 4; k += 1) {
      const space = randomSpace(rng, {
        vars: rng.int(4, 6),
        minArity: 2,
        maxArity: 3,
        density: 0.2,
        shared: 3,
      });
      const oracle = new SpaceOracle(space);
      const keep = variant === 'half-assigned' ? 0.5 : 0.8;
      const rows = randomRows(space, oracle, rng, 25).map((r) =>
        r.map((v) => (rng.chance(keep) ? v : undefined)),
      );
      compare(ctx, space, rows, groupsOf(space), `space ${k + 1} with ${rows.length} partial rows`);
    }
  },

  'counter.overlapping-groups': (variant, ctx) => {
    const { rng } = ctx;
    for (let k = 0; k < 4; k += 1) {
      const space = randomSpace(rng, { vars: 6, minArity: 2, maxArity: 3, density: 0.2 });
      const oracle = new SpaceOracle(space);
      const rows = randomRows(space, oracle, rng, 12);
      const A = [0, 1, 2, 3];
      const mk = (vars: number[], strength: number): SpaceGroup => ({
        id: 'g',
        kind: 'rule',
        vars,
        strength,
      });
      const groups =
        variant === 'same-subset-twice'
          ? [mk(A, 2), mk(A, 2)]
          : variant === 'nested'
            ? [mk([0, 1, 2, 3, 4], 2), mk(A, 2), mk([1, 2, 3], 2)]
            : [mk(A, 2), mk(A, 3)];
      compare(ctx, space, rows, groups, `groups ${variant} on space ${k + 1}`);
    }
  },

  'counter.exact-beyond-2-53': (variant, ctx) => {
    const { rng } = ctx;
    const arities =
      variant === 'big-uniform' ? Array(40).fill(1000) : Array.from({ length: 20 }, () => rng.int(100, 5000));
    const t = variant === 'big-uniform' ? 6 : 5;
    const space = makeSpace(arities);
    const result = callCoverage(ctx, toStore(space), [], [wholeGroup(space, t)]);
    const want = elementary(arities, t);
    must(want > BigInt(Number.MAX_SAFE_INTEGER), 'the generator must build a count beyond 2^53');
    must(
      typeof result.allowed === 'bigint',
      () =>
        `the count is ${want}, beyond 2^53, but allowed is the ${typeof result.allowed} ${show(result.allowed)}; return a bigint`,
    );
    must(result.allowed === want, () => `allowed ${result.allowed}, expected ${want}`);
  },

  'counter.uncovered-list': (variant, ctx) => {
    const { rng } = ctx;
    for (let k = 0; k < 3; k += 1) {
      const space = randomSpace(rng, {
        vars: 5,
        minArity: 2,
        maxArity: 3,
        density: 0.2,
        shared: 3,
        rules: [2],
      });
      const oracle = new SpaceOracle(space);
      const groups = groupsOf(space);
      const rows = variant === 'none-uncovered' ? oracle.validRows() : randomRows(space, oracle, rng, 4);
      const required = oracle.required(groups);
      const covered = oracle.covered(rows, groups, required);
      const missing = [...required].filter((key) => !covered.has(key));
      const limit = variant === 'limit-five' ? 5 : 1_000_000;
      const result = callCoverage(
        ctx,
        toStore(space),
        rows.map((r) => rowOf(space, r)),
        counterGroups(space, groups),
        { uncovered: limit },
      );
      const list = result.uncovered;
      must(
        toBig(result.allowed, 'allowed') === BigInt(required.size) &&
          toBig(result.covered, 'covered') === BigInt(covered.size),
        () => `coverage must count ${required.size} allowed and ${covered.size} covered tuples`,
      );
      must(
        Array.isArray(list),
        () => `coverage was asked for the uncovered tuples (limit ${limit}) but returned ${show(list)}`,
      );
      const keys = (list as Row[]).map((tuple) => {
        const entries = Object.entries(tuple).map(([variable, value]) => {
          const i = space.vars.findIndex((v) => v.id === variable);
          return [i, i < 0 ? -1 : (space.vars[i] as SpaceVar).values.indexOf(value)] as const;
        });
        entries.sort((a, b) => a[0] - b[0]);
        return tupleKey(
          entries.map((e) => e[0]),
          entries.map((e) => e[1]),
        );
      });
      const expectedLength = Math.min(limit, missing.length);
      must(
        keys.length === expectedLength,
        () =>
          `space ${k + 1}: ${missing.length} tuples are uncovered; with limit ${limit} the list should hold ${expectedLength}, it holds ${keys.length}`,
      );
      must(new Set(keys).size === keys.length, () => `space ${k + 1}: the uncovered list repeats a tuple`);
      for (const key of keys) {
        must(
          required.has(key) && !covered.has(key),
          () => `space ${k + 1}: the listed tuple ${key} is not an allowed uncovered tuple`,
        );
      }
    }
  },

  'counter.invalid-arguments': (variant, ctx) => {
    const space = makeSpace([2, 2, 2]);
    const store = toStore(space);
    let groups: Group[];
    let needle: string;
    if (variant === 'unknown-variable') {
      groups = [{ variables: ['v000', 'nosuchvariable'], strength: 2 }];
      needle = 'nosuchvariable';
    } else if (variant === 'strength-zero') {
      groups = [{ variables: ['v000', 'v001'], strength: 0 }];
      needle = 'strength';
    } else if (variant === 'fractional-strength') {
      groups = [{ variables: ['v000', 'v001'], strength: 1.5 }];
      needle = 'strength';
    } else {
      groups = [{ variables: ['v000', 'v001', 'v000'], strength: 2 }];
      needle = 'v000';
    }
    const error = callCoverageError(ctx, store, [], groups);
    must(
      !!error,
      () =>
        `coverage accepted the group ${show(groups[0])}; it should throw a RangeError that names ${needle}`,
    );
    const e = error as Error;
    must(e.name === 'RangeError', () => `coverage threw ${e.name}: ${e.message}; expected a RangeError`);
    must(
      e.message.toLowerCase().includes(needle.toLowerCase()),
      () => `the RangeError "${e.message}" does not name ${needle}`,
    );
  },

  'counter.no-enumeration': (variant, ctx) => {
    const n = variant === 'five-hundred-variables-t3' ? 500 : 200;
    const space = makeSpace(Array(n).fill(2));
    const store = toStore(space);
    const group = wholeGroup(space, 3);
    const { value: result, ms } = cpuMs(() => callCoverage(ctx, store, [], [group]));
    const want = BigInt(choose(n, 3)) * 8n;
    must(
      toBig(result.allowed, 'allowed') === want,
      () => `allowed ${show(result.allowed)}, expected ${want}`,
    );
    must(
      ms <= 50,
      () =>
        `counting the tuples of ${n} binary variables at strength 3 took ${Math.round(ms)} ms of processor time, over 50 ms; use a formula, not an enumeration`,
    );
  },
};
