import type { DimensionKind, SpaceMap, SpaceValue } from './schema';

/**
 * The grid of a map: every cell (one value per dimension) that no constraint forbids, and its projections
 * onto subsets of t dimensions. Everything here is enumerated by code from the declaration.
 *
 * t-wise coverage follows combinatorial testing (Kuhn, Kacker and Lei, NIST SP 800-142, 2010; all-pairs
 * testing for t = 2): a t-tuple is a choice of one value on each of t dimensions, and it is allowed when
 * at least one allowed cell of the full grid holds it. The constraint list therefore shapes every
 * denominator, at every t.
 */

/** One dimension of a validated map, with its values indexed and its prior shares resolved. */
export type CompiledDimension = {
  id: string;
  title: string;
  kind: DimensionKind;
  values: SpaceValue[];
  /** Value id to its position in `values`. */
  index: ReadonlyMap<string, number>;
  /** The declared share of each value, summing to 1 over the dimension (all 0 when every weight is 0). */
  weights: number[];
};

/** A constraint as positions: pairs of a dimension index and a value index, by dimension. */
export type CompiledConstraint = ReadonlyArray<readonly [dimension: number, value: number]>;

export type CompiledSpace = {
  map: SpaceMap;
  dimensions: CompiledDimension[];
  constraints: CompiledConstraint[];
  /** True when the map writes no weight at all: every value of a dimension weighs the same. */
  uniform: boolean;
};

/** The largest full grid the functions of this package enumerate, unless told otherwise. */
export const DEFAULT_MAX_CELLS = 250_000;

/**
 * Indexes a map that passed `validateSpaceMap`. The weight of a value is `prior.weights[dimension][value]`
 * when the prior lists the dimension, else the value's own `weight`, else 1.
 */
export function compileSpace(map: SpaceMap): CompiledSpace {
  let uniform = true;
  const dimensions = map.dimensions.map((dimension): CompiledDimension => {
    // An own-property lookup: a dimension named constructor or a value named toString is not in a prior that omits it.
    const weights = map.prior.weights;
    const fitted =
      weights !== undefined && Object.hasOwn(weights, dimension.id) ? weights[dimension.id] : undefined;
    const written = dimension.values.some((value) => value.weight !== undefined);
    if (fitted || written) uniform = false;
    const raw = dimension.values.map((value) => {
      if (fitted) return Object.hasOwn(fitted, value.id) ? (fitted[value.id] ?? 0) : 0;
      return written ? (value.weight ?? 0) : 1;
    });
    const total = raw.reduce((sum, weight) => sum + weight, 0);
    return {
      id: dimension.id,
      title: dimension.title,
      kind: dimension.kind,
      values: dimension.values,
      index: new Map(dimension.values.map((value, position) => [value.id, position])),
      weights: raw.map((weight) => (total > 0 ? weight / total : 0)),
    };
  });
  const position = new Map(dimensions.map((dimension, index) => [dimension.id, index]));
  const constraints = map.constraints.map((constraint): CompiledConstraint => {
    const pairs: Array<[number, number]> = [];
    for (const [dimensionId, valueId] of Object.entries(constraint.forbid)) {
      const index = position.get(dimensionId);
      const value = index === undefined ? undefined : dimensions[index]?.index.get(valueId);
      if (index !== undefined && value !== undefined) pairs.push([index, value]);
    }
    return pairs.sort((a, b) => a[0] - b[0]);
  });
  return { map, dimensions, constraints, uniform };
}

/** The number of cells of the full grid before constraints: the product of the value counts. */
export function gridSize(map: SpaceMap): number {
  return map.dimensions.reduce((product, dimension) => product * dimension.values.length, 1);
}

/** True when a constraint matches the cell: the cell holds every value the constraint names. */
export function isForbidden(space: CompiledSpace, cell: readonly number[]): boolean {
  return space.constraints.some(
    (constraint) =>
      constraint.length > 0 && constraint.every(([dimension, value]) => cell[dimension] === value),
  );
}

/**
 * Calls `visit` with every allowed cell of the full grid, in odometer order (the last dimension turns
 * fastest). The array passed is reused between calls: copy it to keep it.
 *
 * A constraint can only match once its last dimension holds a value, so each is checked once there, and a
 * match drops every cell under the values chosen so far. The cost follows the allowed cells and the dropped
 * branches, not the full grid times the constraint list.
 */
export function forEachAllowedCell(space: CompiledSpace, visit: (cell: readonly number[]) => void): void {
  // A dimension without a value still holds position 0, as the odometer always did.
  const sizes = space.dimensions.map((dimension) => Math.max(1, dimension.values.length));
  const closing: CompiledConstraint[][] = sizes.map(() => []);
  for (const constraint of space.constraints) {
    let last = -1;
    for (const [dimension] of constraint) if (dimension > last) last = dimension;
    // A constraint that names no dimension of the grid matches no cell.
    closing[last]?.push(constraint);
  }
  const cell = sizes.map(() => 0);
  const walk = (dimension: number): void => {
    if (dimension === sizes.length) {
      visit(cell);
      return;
    }
    const constraints = closing[dimension] ?? [];
    const size = sizes[dimension] ?? 0;
    for (let value = 0; value < size; value += 1) {
      cell[dimension] = value;
      let forbidden = false;
      for (const constraint of constraints) {
        if (constraint.every(([at, held]) => cell[at] === held)) {
          forbidden = true;
          break;
        }
      }
      if (!forbidden) walk(dimension + 1);
    }
  };
  walk(0);
}

/**
 * One allowed cell of the full grid, or undefined when the constraints forbid every cell. A depth-first
 * search that drops a branch as soon as a constraint matches the values chosen so far.
 */
export function findAllowedCell(space: CompiledSpace): number[] | undefined {
  const sizes = space.dimensions.map((dimension) => dimension.values.length);
  const cell: number[] = [];
  // A constraint is checked once its last dimension is chosen; pairs are sorted by dimension.
  const closing = sizes.map((_, dimension) =>
    space.constraints.filter((constraint) => constraint[constraint.length - 1]?.[0] === dimension),
  );
  const search = (dimension: number): boolean => {
    if (dimension === sizes.length) return true;
    for (let value = 0; value < (sizes[dimension] ?? 0); value += 1) {
      cell[dimension] = value;
      const blocked = (closing[dimension] ?? []).some((constraint) =>
        constraint.every(([at, forbidden]) => cell[at] === forbidden),
      );
      if (!blocked && search(dimension + 1)) return true;
    }
    cell.length = dimension;
    return false;
  };
  return search(0) ? cell : undefined;
}

/** Every subset of t dimension indices out of k, each in increasing order, the subsets in lexicographic order. */
export function combinations(k: number, t: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const walk = (start: number): void => {
    if (pick.length === t) {
      out.push([...pick]);
      return;
    }
    for (let index = start; index <= k - (t - pick.length); index += 1) {
      pick.push(index);
      walk(index + 1);
      pick.pop();
    }
  };
  if (t >= 0 && t <= k) walk(0);
  return out;
}

/**
 * The tuples of a subset of dimensions. A tuple is coded in mixed radix: the value index on each
 * dimension times its stride, summed; the last dimension of the subset has stride 1.
 */
export type Projection = {
  dimensions: number[];
  stride: number[];
  /** The number of tuples before constraints: the product of the value counts of the subset. */
  size: number;
  /** 1 where at least one allowed cell of the full grid holds the tuple. */
  allowed: Uint8Array;
  /**
   * The prior mass of each tuple: the sum of the prior over the allowed cells that hold it. It sums to 1
   * over the projection when the prior gives the grid any mass.
   */
  mass: Float64Array;
};

function emptyProjection(space: CompiledSpace, dimensions: number[]): Projection {
  const radix = dimensions.map((dimension) => space.dimensions[dimension]?.values.length ?? 0);
  const stride = radix.map(() => 1);
  for (let position = radix.length - 2; position >= 0; position -= 1) {
    stride[position] = (stride[position + 1] ?? 1) * (radix[position + 1] ?? 1);
  }
  const size = radix.reduce((product, count) => product * count, 1);
  return { dimensions, stride, size, allowed: new Uint8Array(size), mass: new Float64Array(size) };
}

/** The code of the tuple a full cell holds on the projection's dimensions. */
export function codeOf(projection: Projection, cell: readonly number[]): number {
  let code = 0;
  projection.dimensions.forEach((dimension, position) => {
    code += (cell[dimension] ?? 0) * (projection.stride[position] ?? 0);
  });
  return code;
}

/** The value index on each dimension of the projection, for a tuple code. */
export function decode(projection: Projection, code: number, space: CompiledSpace): number[] {
  return projection.dimensions.map((dimension, position) => {
    const count = space.dimensions[dimension]?.values.length ?? 1;
    return Math.floor(code / (projection.stride[position] ?? 1)) % count;
  });
}

/** The tuple as dimension id to value id, in the order of the map's dimensions. */
export function tupleValues(
  projection: Projection,
  code: number,
  space: CompiledSpace,
): Record<string, string> {
  const values: Record<string, string> = {};
  const indices = decode(projection, code, space);
  projection.dimensions.forEach((dimension, position) => {
    const compiled = space.dimensions[dimension];
    const value = compiled?.values[indices[position] ?? 0];
    if (compiled && value) values[compiled.id] = value.id;
  });
  return values;
}

export type ProjectedGrid = {
  /** One projection per subset asked for, in the same order. */
  projections: Projection[];
  /** The number of allowed cells of the full grid. */
  allowedCells: number;
  /** The prior weight of the allowed cells before normalisation; 0 means the prior gives them no mass. */
  totalWeight: number;
};

/**
 * One pass over the allowed cells of the full grid fills every projection asked for: which tuples are
 * allowed, and the prior mass of each. The prior of a cell is the product of the shares of its values,
 * restricted to the allowed cells and renormalised: the owner declares one share per value, and the
 * combinations are assumed independent apart from the constraints.
 */
export function projectGrid(space: CompiledSpace, subsets: number[][]): ProjectedGrid {
  const projections = subsets.map((dimensions) => emptyProjection(space, dimensions));
  let allowedCells = 0;
  let totalWeight = 0;
  forEachAllowedCell(space, (cell) => {
    allowedCells += 1;
    let weight = 1;
    cell.forEach((value, dimension) => {
      weight *= space.dimensions[dimension]?.weights[value] ?? 0;
    });
    totalWeight += weight;
    for (const projection of projections) {
      const code = codeOf(projection, cell);
      projection.allowed[code] = 1;
      projection.mass[code] = (projection.mass[code] ?? 0) + weight;
    }
  });
  if (totalWeight > 0) {
    for (const projection of projections) {
      projection.mass.forEach((mass, code) => {
        projection.mass[code] = mass / totalWeight;
      });
    }
  }
  return { projections, allowedCells, totalWeight };
}

/** Checks t against the number of dimensions; t defaults to all of them (the full grid). */
export function resolveT(space: CompiledSpace, t: number | undefined): number {
  const k = space.dimensions.length;
  const value = t ?? k;
  if (!Number.isInteger(value) || value < 1 || value > k) {
    throw new RangeError(`t must be a whole number from 1 to ${k}, the number of dimensions of the map`);
  }
  return value;
}

/** Refuses a full grid larger than the limit, before any enumeration starts. */
export function assertGridSize(map: SpaceMap, maxCells = DEFAULT_MAX_CELLS): void {
  const size = gridSize(map);
  if (size > maxCells) {
    throw new RangeError(
      `the full grid has ${size} cells, over the limit of ${maxCells}: merge values or split the map`,
    );
  }
}

/** One cell of the grid at strength t: a value on each of t dimensions. */
export type Cell = { values: Record<string, string> };

export type CellsOptions = {
  /** The strength: cells on every subset of t dimensions. Defaults to every dimension (the full grid). */
  t?: number;
  /** The largest full grid to enumerate. */
  maxCells?: number;
};

/**
 * Every allowed cell at strength t: for t equal to the number of dimensions, the full grid without the
 * forbidden cells; for a smaller t, every allowed t-tuple of every subset of t dimensions. Subsets come in
 * lexicographic order of the dimensions, tuples in the order of the values. Takes a validated map.
 */
export function cells(map: SpaceMap, options: CellsOptions = {}): Cell[] {
  const space = compileSpace(map);
  const t = resolveT(space, options.t);
  assertGridSize(map, options.maxCells);
  const { projections } = projectGrid(space, combinations(space.dimensions.length, t));
  const out: Cell[] = [];
  for (const projection of projections) {
    projection.allowed.forEach((allowed, code) => {
      if (allowed) out.push({ values: tupleValues(projection, code, space) });
    });
  }
  return out;
}
