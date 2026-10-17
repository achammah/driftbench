import type { VariableStore } from '@agent-nexus/driftbench-space';
import { rngFor, shuffle, streamSeed } from '../seed/random';
import {
  buildGroups,
  COVERED,
  cover,
  decode,
  type Group,
  IMPOSSIBLE,
  LAYER_STRENGTH,
  LAYERS,
  type Layer,
  markImpossible,
  WAITING,
} from './groups';
import { rulesOfView, type StoreRule } from './rules';
import { Solver } from './solver';
import { type View, viewOf } from './view';

/**
 * Planner v2: the rows of a test plan, built from a variable store. Every row gives a value to every approved
 * variable. The rows cover (see groups.ts) the combinations the rules of the store call for, at the strength
 * each asks, and never hold a combination the store calls impossible. Real sessions enter as seed rows: they
 * are always kept and count as covering what they hold. The new rows come most common first, so a budget cuts the
 * rarest ones first.
 */

export type PlanSeedRow = {
  id: string;
  /** Variable id to value id. A session that shows only some variables gives only those. */
  values: Record<string, string>;
};

export type PlanV2Options = {
  /** Breaks ties between equal choices. The same store, options and seed give the same plan. Default 1. */
  seed?: number;
  /** The most rows the plan holds, seeds included. The seeds are never cut. Default: no limit. */
  budget?: number;
  /** Real sessions: always kept, counted as covering what they hold. */
  seeds?: readonly PlanSeedRow[];
  /** Plan only what a person approved. Default true. */
  approvedOnly?: boolean;
};

export type PlanV2Row = {
  /** `seed.<id>` for a seed row, `row.001`, `row.002` ... for a new row, in plan order. */
  id: string;
  source: 'seed' | 'planned';
  /** Variable id to value id; the whole store for a new row, the known entries for a seed. */
  values: Record<string, string>;
  /** The sum of the natural logarithms of the shares of the row's values. Minus infinity for a value of weight 0. */
  logWeight: number;
};

export type PlanV2Layer = {
  layer: Layer;
  /** The strength the layer asks for, at most. */
  strength: 3 | 2 | 1;
  groups: number;
  /** Value combinations a valid row can hold. */
  targets: number;
  /** Value combinations no valid row can hold: left out of the targets. */
  infeasible: number;
  /** Targets the seeds hold. */
  seeded: number;
  /** Targets the rows of the plan hold, after the budget. */
  covered: number;
  uncovered: number;
};

export type PlanV2Warning =
  | { code: 'no_variables'; message: string }
  | { code: 'value_unreachable'; variable: string; value: string; required: boolean; message: string }
  | { code: 'seed_unknown_value'; seed: string; variable: string; value: string; message: string }
  | { code: 'seed_unapproved_value'; seed: string; variable: string; value: string; message: string }
  | { code: 'seed_forbidden'; seed: string; message: string };

export type PlanV2 = {
  agent: string;
  version: string;
  seed: number;
  budget?: number;
  /** New rows built before the budget cut them. */
  generated: number;
  /** New rows the budget cut. */
  cut: number;
  layers: PlanV2Layer[];
  rules: StoreRule[];
  /** The seeds, then the new rows from the most common to the rarest. */
  rows: PlanV2Row[];
  warnings: PlanV2Warning[];
};

/** Row log weights are compared to this many places: sums of logarithms differ in the last bits between machines. */
const PLACES = 1e9;
const rounded = (value: number) => (Number.isFinite(value) ? Math.round(value * PLACES) : value);

function compareWeight(a: number, b: number): number {
  const x = rounded(a);
  const y = rounded(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

function checkOptions(options: PlanV2Options): void {
  const { budget, seed, seeds } = options;
  if (budget !== undefined && !(Number.isInteger(budget) && budget >= 0))
    throw new RangeError(`the budget is a whole number from 0, not ${budget}`);
  if (seed !== undefined && !Number.isFinite(seed)) throw new RangeError(`the seed is a number, not ${seed}`);
  const seen = new Set<string>();
  for (const row of seeds ?? []) {
    if (typeof row.id !== 'string' || row.id === '') throw new Error('a seed row needs an id');
    if (seen.has(row.id)) throw new Error(`two seed rows have the id ${row.id}`);
    seen.add(row.id);
  }
}

const emptyLayer = (layer: Layer): PlanV2Layer => ({
  layer,
  strength: LAYER_STRENGTH[layer],
  groups: 0,
  targets: 0,
  infeasible: 0,
  seeded: 0,
  covered: 0,
  uncovered: 0,
});

/**
 * A seed row as indexes: the value of each variable the seed names and the view knows, -1 elsewhere. `outside`
 * keeps the entries that name a value the store has but nobody approved: a real session is kept whole, and those
 * entries are reported but never counted as covering anything.
 */
type SeedPart = { id: string; partial: Int16Array; outside: Record<string, string> };

function seedParts(
  seeds: readonly PlanSeedRow[],
  store: VariableStore,
  view: View,
  solver: Solver,
  warnings: PlanV2Warning[],
): SeedPart[] {
  return seeds.map((seed) => {
    const partial = new Int16Array(view.variables.length).fill(-1);
    const outside: Record<string, string> = {};
    for (const [variable, value] of Object.entries(seed.values)) {
      const at = view.variableIndex.get(variable);
      const valueAt = at === undefined ? undefined : view.valueIndex[at]?.get(value);
      if (at === undefined || valueAt === undefined) {
        const known = store.variables
          .find((entry) => entry.id === variable)
          ?.values.some((entry) => entry.id === value);
        if (known) {
          outside[variable] = value;
          warnings.push({
            code: 'seed_unapproved_value',
            seed: seed.id,
            variable,
            value,
            message: `seed ${seed.id} names ${variable} = ${value}, which nobody approved: it is kept in the seed row and covers nothing`,
          });
          continue;
        }
        warnings.push({
          code: 'seed_unknown_value',
          seed: seed.id,
          variable,
          value,
          message: `seed ${seed.id} names ${variable} = ${value}, which the plan does not know: it is kept out of the seed row`,
        });
        continue;
      }
      partial[at] = valueAt;
    }
    if (solver.violates(partial))
      warnings.push({
        code: 'seed_forbidden',
        seed: seed.id,
        message: `seed ${seed.id} holds a combination the store calls impossible: it is kept, and the store may be wrong`,
      });
    return { id: seed.id, partial, outside };
  });
}

/** The values no valid row can hold. A value that only constraints in combination rule out is found too. */
function unreachable(store: VariableStore, view: View, solver: Solver): PlanV2Warning[] {
  if (solver.constrained.length === 0) return [];
  const required = new Set(
    store.variables.flatMap((variable) =>
      variable.values
        .filter((value) => value.required === true)
        .map((value) => `${variable.id}\u0000${value.id}`),
    ),
  );
  const out: PlanV2Warning[] = [];
  view.variables.forEach((variable, at) => {
    variable.values.forEach((value, valueAt) => {
      const row = new Int16Array(view.variables.length).fill(-1);
      row[at] = valueAt;
      if (solver.canComplete(row)) return;
      const must = required.has(`${variable.id}\u0000${value.id}`);
      out.push({
        code: 'value_unreachable',
        variable: variable.id,
        value: value.id,
        required: must,
        message: `no row can hold ${variable.id} = ${value.id}: the constraints forbid it${must ? ', though the store requires it' : ''}`,
      });
    });
  });
  return out;
}

function tupleLog(view: View, group: Group, code: number): number {
  return decode(group, code).reduce(
    (sum, value, at) => sum + (view.variables[group.variables[at] as number]?.values[value]?.logShare ?? 0),
    0,
  );
}

/** The sum of the logarithms of the shares of the values a row sets. */
function logWeight(view: View, row: Int16Array): number {
  let sum = 0;
  row.forEach((value, variable) => {
    if (value >= 0) sum += view.variables[variable]?.values[value]?.logShare ?? 0;
  });
  return sum;
}

function valuesOf(view: View, row: Int16Array): Record<string, string> {
  const out: Record<string, string> = {};
  row.forEach((value, variable) => {
    if (value >= 0)
      out[(view.variables[variable] as View['variables'][number]).id] = (
        view.variables[variable] as View['variables'][number]
      ).values[value]?.id as string;
  });
  return out;
}

const waitingCodes = (group: Group): number[] => {
  const out: number[] = [];
  for (let code = 0; code < group.cells; code += 1) if (group.state[code] === WAITING) out.push(code);
  return out;
};

/**
 * New rows, one at a time, until no target waits. A row starts from the most common target still waiting (the
 * stronger group first on a tie), then takes the other variables in a seeded order, each with the value that
 * covers the most waiting targets with the values already set, the more common value on a tie, among the values
 * that keep the row completable to a valid one.
 */
function build(view: View, solver: Solver, groups: readonly Group[], seed: number): Int16Array[] {
  const count = view.variables.length;
  const groupsOf: number[][] = view.variables.map(() => []);
  groups.forEach((group, at) => {
    for (const variable of group.variables) groupsOf[variable]?.push(at);
  });
  let open = groups.map(waitingCodes);
  const rows: Int16Array[] = [];
  for (let index = 0; open.some((codes) => codes.length > 0); index += 1) {
    let first: { group: number; code: number; log: number; size: number } | undefined;
    open.forEach((codes, at) => {
      const group = groups[at] as Group;
      for (const code of codes) {
        const log = tupleLog(view, group, code);
        const size = group.variables.length;
        const order = first === undefined ? 1 : compareWeight(log, first.log) || size - first.size;
        if (order > 0) first = { group: at, code, log, size };
      }
    });
    if (first === undefined) break;
    const start = groups[first.group] as Group;
    const row = new Int16Array(count).fill(-1);
    decode(start, first.code).forEach((value, at) => {
      row[start.variables[at] as number] = value;
    });
    const rng = rngFor(seed, `plan-v2.row.${index}`);
    const unset = shuffle(
      rng,
      Array.from(row.keys()).filter((variable) => row[variable] === -1),
    );
    for (const variable of unset) {
      let best: number[] = [];
      let bestGain = -1;
      let bestLog = Number.NEGATIVE_INFINITY;
      for (const value of solver.allowed(row, variable)) {
        row[variable] = value;
        const completable = solver.canComplete(row);
        row[variable] = -1;
        if (!completable) continue;
        let gain = 0;
        for (const at of groupsOf[variable] ?? []) {
          const group = groups[at] as Group;
          let code = 0;
          let known = true;
          group.variables.forEach((other, position) => {
            const held = other === variable ? value : (row[other] as number);
            if (held < 0) known = false;
            code += held * (group.strides[position] as number);
          });
          if (known && group.state[code] === WAITING) gain += 1;
        }
        const log = view.variables[variable]?.values[value]?.logShare ?? 0;
        const order = best.length === 0 ? 1 : gain - bestGain || compareWeight(log, bestLog);
        if (order > 0) {
          best = [value];
          bestGain = gain;
          bestLog = log;
        } else if (order === 0) best.push(value);
      }
      if (best.length === 0)
        throw new Error('internal error: a row that can be completed has no value left to take');
      row[variable] =
        best.length === 1 ? (best[0] as number) : (best[Math.floor(rng() * best.length)] as number);
    }
    cover(groups, row);
    rows.push(row);
    open = open.map((codes, at) => codes.filter((code) => (groups[at] as Group).state[code] === WAITING));
  }
  return rows;
}

/** Covered and waiting targets per layer, counted from the baseline: seeds first, then the new rows kept. */
function layerCoverage(
  groups: readonly Group[],
  baseline: readonly Uint8Array[],
  seeds: readonly Int16Array[],
  kept: readonly Int16Array[],
): PlanV2Layer[] {
  const bySeeds = baseline.map((state) => Uint8Array.from(state));
  for (const row of seeds) cover(groups, row, bySeeds);
  const byAll = bySeeds.map((state) => Uint8Array.from(state));
  for (const row of kept) cover(groups, row, byAll);
  const layers = LAYERS.map(emptyLayer);
  groups.forEach((group, at) => {
    const layer = layers.find((entry) => entry.layer === group.layer) as PlanV2Layer;
    layer.groups += 1;
    const start = baseline[at] as Uint8Array;
    for (let code = 0; code < group.cells; code += 1) {
      if (start[code] === IMPOSSIBLE) layer.infeasible += 1;
      else if (start[code] === WAITING) {
        layer.targets += 1;
        if ((bySeeds[at] as Uint8Array)[code] === COVERED) layer.seeded += 1;
        if ((byAll[at] as Uint8Array)[code] === COVERED) layer.covered += 1;
      }
    }
  });
  for (const layer of layers) layer.uncovered = layer.targets - layer.covered;
  return layers;
}

function seedRow(view: View, row: SeedPart): PlanV2Row {
  return {
    id: `seed.${row.id}`,
    source: 'seed',
    values: { ...valuesOf(view, row.partial), ...row.outside },
    logWeight: logWeight(view, row.partial),
  };
}

export function planV2(store: VariableStore, options: PlanV2Options = {}): PlanV2 {
  checkOptions(options);
  const seed = options.seed ?? 1;
  const view = viewOf(store, options);
  const base = { agent: store.agent, version: store.version, seed };
  const budget = options.budget === undefined ? {} : { budget: options.budget };
  if (view.variables.length === 0) {
    // Nothing to plan over, but the seeds are real sessions: they are kept, with what is wrong with them.
    const warnings: PlanV2Warning[] = [
      { code: 'no_variables', message: 'the store has no approved variable to plan over' },
    ];
    const seedRows = seedParts(options.seeds ?? [], store, view, new Solver(view), warnings);
    return {
      ...base,
      ...budget,
      generated: 0,
      cut: 0,
      layers: LAYERS.map(emptyLayer),
      rules: [],
      rows: seedRows.map((row) => seedRow(view, row)),
      warnings,
    };
  }
  const rules = rulesOfView(store, view, options);
  const solver = new Solver(view);
  const groups = buildGroups(view, rules);
  markImpossible(groups, solver, view.variables.length);
  const baseline = groups.map((group) => Uint8Array.from(group.state));
  const warnings = unreachable(store, view, solver);

  const seedRows = seedParts(options.seeds ?? [], store, view, solver, warnings);
  for (const row of seedRows) cover(groups, row.partial);

  const ordered = build(view, solver, groups, seed)
    .map((row) => {
      const key = row.join(',');
      return { row, key, log: logWeight(view, row), tie: streamSeed(seed, `plan-v2.order:${key}`) };
    })
    .sort(
      (a, b) => compareWeight(b.log, a.log) || a.tie - b.tie || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  const width = Math.max(3, String(ordered.length).length);
  const planned = ordered.map((entry, at) => ({
    ...entry,
    id: `row.${String(at + 1).padStart(width, '0')}`,
  }));
  const room = options.budget === undefined ? planned.length : Math.max(0, options.budget - seedRows.length);
  const kept = planned.slice(0, room);

  return {
    ...base,
    ...budget,
    generated: planned.length,
    cut: planned.length - kept.length,
    layers: layerCoverage(
      groups,
      baseline,
      seedRows.map((row) => row.partial),
      kept.map((entry) => entry.row),
    ),
    rules,
    rows: [
      ...seedRows.map((row) => seedRow(view, row)),
      ...kept.map((entry) => ({
        id: entry.id,
        source: 'planned' as const,
        values: valuesOf(view, entry.row),
        logWeight: entry.log,
      })),
    ],
    warnings,
  };
}
