import { combinations } from '@agent-nexus/driftbench-space';
import type { StoreRule } from './rules';
import type { Solver } from './solver';
import type { View } from './view';

/**
 * What the plan must cover. A group is a set of variables; its targets are the value combinations of those
 * variables that some valid row can hold. Three layers set the strength:
 *
 * - own: every `min(3, n)` variables of a rule that names n variables, all their value combinations;
 * - shared: every pair of the axes that two or more rules name, counting only the rules that name two variables
 *   or more (a rule that names one variable relates it to nothing);
 * - single: every value of the variables no group names yet.
 *
 * A set of variables that several layers ask for is one group and keeps the first layer, in that order.
 */

export type Layer = 'own' | 'shared' | 'single';
export const LAYERS: readonly Layer[] = ['own', 'shared', 'single'];
/** The strength each layer asks for, at most: a rule with fewer variables is covered at their number. */
export const LAYER_STRENGTH: Record<Layer, 3 | 2 | 1> = { own: 3, shared: 2, single: 1 };

/** The most value combinations the planner will list before it refuses (strength 3 on wide rules grows fast). */
export const MAX_TUPLES = 2_000_000;

/** `state` per value combination: waiting to be covered, covered, or impossible in every valid row. */
export const WAITING = 0;
export const COVERED = 1;
export const IMPOSSIBLE = 2;

export type Group = {
  layer: Layer;
  /** The variable indexes, increasing. */
  variables: number[];
  /** The value count of each variable. */
  sizes: number[];
  /** The code of a combination is the sum of value index times stride; the last variable has stride 1. */
  strides: number[];
  /** The number of value combinations: the product of the value counts. */
  cells: number;
  state: Uint8Array;
};

export function buildGroups(view: View, rules: readonly StoreRule[]): Group[] {
  const groups: Group[] = [];
  const keys = new Set<string>();
  let listed = 0;
  const add = (layer: Layer, variables: number[]) => {
    const key = variables.join(',');
    if (keys.has(key)) return;
    keys.add(key);
    const sizes = variables.map((variable) => view.variables[variable]?.values.length ?? 1);
    const strides = sizes.map((_, at) => sizes.slice(at + 1).reduce((product, size) => product * size, 1));
    const cells = sizes.reduce((product, size) => product * size, 1);
    listed += cells;
    if (listed > MAX_TUPLES)
      throw new RangeError(
        `more than ${MAX_TUPLES} value combinations to cover: split the rules or the store`,
      );
    groups.push({ layer, variables, sizes, strides, cells, state: new Uint8Array(cells) });
  };
  const members = rules.map((rule) =>
    rule.variables.flatMap((variable) => {
      const at = view.variableIndex.get(variable);
      return at === undefined ? [] : [at];
    }),
  );
  for (const variables of members) {
    for (const pick of combinations(variables.length, Math.min(3, variables.length)))
      add(
        'own',
        pick.map((at) => variables[at] as number),
      );
  }
  // A rule that names one variable relates it to nothing, so it does not make the variable shared.
  const named = new Map<number, number>();
  for (const variables of members.filter((entry) => entry.length >= 2))
    for (const variable of variables) named.set(variable, (named.get(variable) ?? 0) + 1);
  const sharedAxes = [...named]
    .filter(([variable, count]) => count >= 2 && view.variables[variable]?.role === 'axis')
    .map(([variable]) => variable)
    .sort((a, b) => a - b);
  for (const pick of combinations(sharedAxes.length, 2))
    add(
      'shared',
      pick.map((at) => sharedAxes[at] as number),
    );
  const inGroup = new Set(groups.flatMap((group) => group.variables));
  view.variables.forEach((_, variable) => {
    if (!inGroup.has(variable)) add('single', [variable]);
  });
  return groups;
}

/** The value indexes of a combination, one per variable of the group. */
export function decode(group: Group, code: number): number[] {
  return group.strides.map((stride, at) => Math.floor(code / stride) % (group.sizes[at] as number));
}

/** The code of the combination a row holds on the group, or -1 when the row leaves one of its variables unset. */
export function encode(group: Group, row: Int16Array): number {
  let code = 0;
  for (let at = 0; at < group.variables.length; at += 1) {
    const value = row[group.variables[at] as number] as number;
    if (value < 0) return -1;
    code += value * (group.strides[at] as number);
  }
  return code;
}

/** Marks as impossible every combination that no valid row holds. */
export function markImpossible(groups: readonly Group[], solver: Solver, variables: number): number {
  let marked = 0;
  if (solver.constrained.length === 0) return marked;
  for (const group of groups) {
    for (let code = 0; code < group.cells; code += 1) {
      const row = new Int16Array(variables).fill(-1);
      decode(group, code).forEach((value, at) => {
        row[group.variables[at] as number] = value;
      });
      if (!solver.canComplete(row)) {
        group.state[code] = IMPOSSIBLE;
        marked += 1;
      }
    }
  }
  return marked;
}

/** Marks the combinations a (possibly partial) row holds as covered. Returns how many were waiting. */
export function cover(
  groups: readonly Group[],
  row: Int16Array,
  states: readonly Uint8Array[] = groups.map((g) => g.state),
): number {
  let fresh = 0;
  groups.forEach((group, at) => {
    const code = encode(group, row);
    const state = states[at];
    if (code >= 0 && state && state[code] === WAITING) {
      state[code] = COVERED;
      fresh += 1;
    }
  });
  return fresh;
}
