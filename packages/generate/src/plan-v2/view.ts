import type { VariableStore } from '@agent-nexus/driftbench-space';

/**
 * The part of a variable store the planner plans over: the variables and values a person approved, the share of
 * each value among the values of its variable, and the impossible combinations that can still occur among them.
 * It is the view `variablesToSpaceMap` takes of a store, with one difference: the details stay in. A rule may
 * name a detail, and the planner varies it in the rows beside the axes.
 */

export type ViewValue = {
  id: string;
  /** The share of users with the value among the values of its variable: they add up to 1. */
  share: number;
  /** The natural logarithm of the share, minus infinity for a share of 0. */
  logShare: number;
};

export type ViewVariable = {
  id: string;
  role: 'axis' | 'detail';
  values: ViewValue[];
};

/** An impossible combination as indexes: the variables in increasing order, one value index each. */
export type ViewConstraint = { variables: number[]; values: number[] };

export type View = {
  variables: ViewVariable[];
  /** Variable id to its index in `variables`. */
  variableIndex: Map<string, number>;
  /** Per variable, value id to its index. */
  valueIndex: Map<string, number>[];
  constraints: ViewConstraint[];
};

/** Whether the planner counts what a person has not approved. Default: it does not. */
export type ViewOptions = { approvedOnly?: boolean };

export function viewOf(store: VariableStore, options: ViewOptions = {}): View {
  const approvedOnly = options.approvedOnly ?? true;
  const variables: ViewVariable[] = [];
  for (const variable of store.variables) {
    const kept = variable.values.filter((value) => !approvedOnly || (value.approved ?? variable.approved));
    if (kept.length === 0) continue;
    const weighed = kept.every((value) => value.weight !== undefined);
    const total = weighed ? kept.reduce((sum, value) => sum + (value.weight ?? 0), 0) : 0;
    const uniform = !weighed || total <= 0;
    variables.push({
      id: variable.id,
      role: variable.role,
      values: kept.map((value) => {
        const share = uniform ? 1 / kept.length : (value.weight ?? 0) / total;
        return { id: value.id, share, logShare: share > 0 ? Math.log(share) : Number.NEGATIVE_INFINITY };
      }),
    });
  }
  const variableIndex = new Map(variables.map((variable, at) => [variable.id, at]));
  const valueIndex = variables.map((variable) => new Map(variable.values.map((value, at) => [value.id, at])));
  const constraints: ViewConstraint[] = [];
  for (const constraint of store.constraints) {
    if (approvedOnly && !constraint.approved) continue;
    const entries = Object.entries(constraint.forbid).map(([variable, value]) => {
      const at = variableIndex.get(variable);
      const valueAt = at === undefined ? undefined : valueIndex[at]?.get(value);
      return at === undefined || valueAt === undefined ? undefined : ([at, valueAt] as const);
    });
    // A constraint that names a value outside the view can never fire there.
    if (entries.length === 0 || entries.some((entry) => entry === undefined)) continue;
    const sorted = (entries as (readonly [number, number])[]).sort((a, b) => a[0] - b[0]);
    constraints.push({ variables: sorted.map((entry) => entry[0]), values: sorted.map((entry) => entry[1]) });
  }
  return { variables, variableIndex, valueIndex, constraints };
}
