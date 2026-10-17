import type { Inventory } from '@agent-nexus/driftbench-core';
import {
  DEFAULT_MAX_CELLS,
  gridSize,
  NONE,
  type SpaceMap,
  validateSpaceMap,
} from '@agent-nexus/driftbench-space';
import { derivedConstraints } from './derive';
import {
  type DimensionKind,
  type Proposal,
  type ProposalDimension,
  type ProposalIssue,
  type Role,
  valueApproved,
} from './proposal';

/**
 * A proposal holds a space map waiting for approval: its axis dimensions, with their values and the
 * constraints among them. `toSpaceMap` drops the evidence, the flags and the detail dimensions and gives the
 * map the space package reads, so every proposal the extractor writes must pass `validateSpaceMap`. Detail
 * dimensions stay in the proposal: the generator varies them inside a cell, as boundary values.
 */

/** Kinds a spec places on through one field: a map holds one dimension of each. */
export const SINGLE_KINDS: ReadonlySet<DimensionKind> = new Set(['stage', 'deviation', 'channel']);

/**
 * The role code proposes for a new dimension. A tool-schema dimension is a detail. Any other dimension is
 * an axis when no earlier dimension of its kind is one, and a detail otherwise: one axis per kind, as the
 * hand-written maps have, so the full grid stays small enough to count coverage on. Order decides: the
 * inventory first, then the tool schemas, then the model sections in order. A person may flip any role.
 */
export function proposeRole(
  dimensions: readonly ProposalDimension[],
  kind: DimensionKind,
  fromToolSchema: boolean,
): Role {
  if (fromToolSchema) return 'detail';
  return dimensions.some((dimension) => dimension.kind === kind && dimension.role === 'axis')
    ? 'detail'
    : 'axis';
}

export type SpaceMapOptions = {
  /** Keep only approved values (a dimension's flag or the value's own) and approved constraints. */
  approvedOnly?: boolean;
  /** Loaded inventory: behaviour ownership still holds when flow is a detail, outside the axes. */
  inventory?: Inventory;
  /**
   * With approvedOnly, also forbid the pairs the relations rule out and give data and task axes `none`
   * (derive.ts). Default true; the generator's map of every dimension takes them from the axis map instead.
   */
  derive?: boolean;
};

/**
 * The space map of a proposal: its axis dimensions only. The deviation dimension gets the reserved value
 * `none` (a block with no deviation), as a seeded map does: it is a cell of every conversation, not a claim
 * about the agent. A dimension left with no value is dropped, and so is a constraint whose values are not
 * all in the map. The inventory path is the proposal's, so write the map in the proposal's folder. The
 * prior is declared with no weight: every value of a dimension weighs the same until the owner says so.
 */
export function toSpaceMap(proposal: Proposal, options: SpaceMapOptions = {}): SpaceMap {
  // A map whose approved relations give it structure (paths, task families) says which specs hold which
  // data and task values; a spec that holds none of a data or task axis places on its `none` value.
  const structured =
    options.approvedOnly === true &&
    options.derive !== false &&
    (proposal.relations ?? []).some(
      (relation) => relation.approved && (relation.kind === 'path' || relation.kind === 'task_family'),
    );
  const dimensions = proposal.dimensions
    .filter((dimension) => dimension.role === 'axis')
    .flatMap((dimension) => {
      const values = dimension.values
        .filter((value) => !options.approvedOnly || valueApproved(dimension, value))
        .map((value) => ({ id: value.id, title: value.title }));
      if (values.length > 0 && dimension.kind === 'deviation' && !values.some((value) => value.id === NONE)) {
        values.unshift({ id: NONE, title: 'No deviation' });
      }
      if (
        structured &&
        values.length > 0 &&
        (dimension.kind === 'data' || dimension.kind === 'task') &&
        !values.some((value) => value.id === NONE)
      ) {
        values.unshift({ id: NONE, title: 'Not held by the spec' });
      }
      return values.length === 0
        ? []
        : [{ id: dimension.id, title: dimension.title, kind: dimension.kind, values }];
    });
  const listed = new Map(
    dimensions.map((dimension) => [dimension.id, new Set(dimension.values.map((value) => value.id))]),
  );
  const constraints = proposal.constraints
    .filter((constraint) => !options.approvedOnly || constraint.approved)
    .filter((constraint) =>
      Object.entries(constraint.forbid).every(([dimension, value]) => listed.get(dimension)?.has(value)),
    )
    .map((constraint) => ({ forbid: { ...constraint.forbid }, reason: constraint.reason }));
  // An approved map also forbids the pairs its own relations rule out (see derive.ts).
  if (structured)
    constraints.push(
      ...derivedConstraints(
        proposal,
        dimensions.map((dimension) => ({
          id: dimension.id,
          kind: dimension.kind,
          values: dimension.values.map((value) => value.id),
        })),
        options.inventory,
      ),
    );
  const inventory = proposal.sources.find((source) => source.kind === 'inventory')?.path;
  return {
    version: String(proposal.version),
    agent: proposal.agent,
    ...(inventory === undefined ? {} : { inventory }),
    dimensions,
    constraints,
    prior: { kind: 'declared' },
  };
}

/** The cells of the full grid of the axis dimensions, and whether the space commands accept that many. */
export function axisGrid(
  proposal: Proposal,
  options: SpaceMapOptions = {},
): { cells: number; limit: number } {
  return { cells: gridSize(toSpaceMap(proposal, options)), limit: DEFAULT_MAX_CELLS };
}

/**
 * The problems `validateSpaceMap` finds in the proposal's map of axes, every entry counted. Paths point into
 * the map, which holds the axis dimensions only, the deviation dimension starting with `none`.
 */
export function checkSpaceMap(proposal: Proposal): ProposalIssue[] {
  const map = toSpaceMap(proposal);
  if (map.dimensions.length === 0) return [];
  const result = validateSpaceMap(map);
  if (result.ok) return [];
  return result.errors.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: `as a space map: ${issue.message}`,
  }));
}
