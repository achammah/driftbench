import { type SpaceMapResult, validateSpaceMap } from '../load';
import type { SpaceMap } from '../schema';
import type { VariableStore } from './schema';

/**
 * Between a space map and a variable store. A space map becomes a store with nothing lost that a space
 * command reads: every dimension is an approved axis, every constraint is approved, and the weights of the
 * prior move onto the values they weigh (a space map reads the prior first, so the value keeps the weight
 * that counted). The store becomes a space map again by keeping its approved axes.
 */

/** The store of a space map. Nothing in a space map says where it comes from, so no entry has provenance. */
export function spaceMapToVariables(map: SpaceMap): VariableStore {
  const fitted = map.prior.weights ?? {};
  return {
    format: 1,
    agent: map.agent,
    version: map.version,
    ...(map.inventory === undefined ? {} : { inventory: map.inventory }),
    prior: {
      kind: map.prior.kind,
      ...(map.prior.source === undefined ? {} : { source: map.prior.source }),
    },
    variables: map.dimensions.map((dimension) => ({
      id: dimension.id,
      title: dimension.title,
      kind: dimension.kind,
      role: 'axis' as const,
      approved: true,
      values: dimension.values.map((value) => {
        // The prior names the weights of a dimension it lists, and they replace the weights of its values.
        const weight = fitted[dimension.id] === undefined ? value.weight : fitted[dimension.id]?.[value.id];
        return {
          id: value.id,
          title: value.title,
          ...(weight === undefined ? {} : { weight }),
          ...(value.required === undefined ? {} : { required: value.required }),
        };
      }),
    })),
    constraints: map.constraints.map((constraint) => ({
      forbid: { ...constraint.forbid },
      reason: constraint.reason,
      approved: true,
    })),
  };
}

/**
 * The space map of a store, before any check: its axis variables with their values, the constraints whose
 * values are all in that map, and the prior. With `approvedOnly`, a value counts when its own flag, else its
 * variable's, is true; a variable left with no value is dropped, and so is a constraint that is not approved
 * or that names a value no longer in the map.
 */
export function deriveSpaceMap(store: VariableStore, approvedOnly: boolean): SpaceMap {
  const dimensions = store.variables
    .filter((variable) => variable.role === 'axis')
    .flatMap((variable) => {
      const values = variable.values
        .filter((value) => !approvedOnly || (value.approved ?? variable.approved))
        .map((value) => ({
          id: value.id,
          title: value.title,
          ...(value.weight === undefined ? {} : { weight: value.weight }),
          ...(value.required === undefined ? {} : { required: value.required }),
        }));
      return values.length === 0
        ? []
        : [{ id: variable.id, title: variable.title, kind: variable.kind, values }];
    });
  const listed = new Map(
    dimensions.map((dimension) => [dimension.id, new Set(dimension.values.map((value) => value.id))]),
  );
  const constraints = store.constraints
    .filter((constraint) => !approvedOnly || constraint.approved)
    .filter((constraint) =>
      Object.entries(constraint.forbid).every(([variable, value]) => listed.get(variable)?.has(value)),
    )
    .map((constraint) => ({ forbid: { ...constraint.forbid }, reason: constraint.reason }));
  return {
    version: store.version,
    agent: store.agent,
    ...(store.inventory === undefined ? {} : { inventory: store.inventory }),
    dimensions,
    constraints,
    prior: {
      kind: store.prior.kind,
      ...(store.prior.source === undefined ? {} : { source: store.prior.source }),
    },
  };
}

export type VariablesToSpaceMapOptions = {
  /** Keep only approved values and approved constraints. Default true: nothing counts before a person approves it. */
  approvedOnly?: boolean;
  /** The path the result reports, for a store read from a file. */
  path?: string;
};

/** The space map of a store, checked as `validateSpaceMap` checks a map file. */
export function variablesToSpaceMap(
  store: VariableStore,
  options: VariablesToSpaceMapOptions = {},
): SpaceMapResult {
  return validateSpaceMap(deriveSpaceMap(store, options.approvedOnly ?? true), options.path ?? '<variables>');
}
