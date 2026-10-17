import { type DimensionKind, type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';

/**
 * Hand-written stores for the planner tests. Every name below is invented for these tests (a harbour and a
 * lighthouse); none is a phrase of an example estate. A store is checked by the loader, so a fixture that
 * breaks a rule of the format fails loudly.
 */

export type QuoteSpec = { quote: string; ledger?: string; path?: string };

export type ValueSpec =
  | string
  | {
      id: string;
      weight?: number;
      required?: boolean;
      approved?: boolean;
      when?: Record<string, string[]>;
      unless?: Record<string, string[]>;
      polarity?: 'must' | 'must_not';
      limit?: number;
      quotes?: QuoteSpec[];
    };

export type VariableSpec = {
  id: string;
  kind?: DimensionKind;
  role?: 'axis' | 'detail';
  approved?: boolean;
  values: ValueSpec[];
  boundaries?: { holds: string; fails: string; edge: string; quotes?: QuoteSpec[] }[];
};

export type ConstraintSpec = { forbid: Record<string, string>; approved?: boolean; quotes?: QuoteSpec[] };

const quoted = (quotes: QuoteSpec[] | undefined) =>
  quotes === undefined
    ? {}
    : {
        provenance: quotes.map((entry) => ({
          kind: 'quote' as const,
          path: entry.path ?? 'lighthouse.md',
          quote: entry.quote,
          ...(entry.ledger === undefined ? {} : { ledger: entry.ledger }),
        })),
      };

/** A valid store of the given variables and constraints. Value ids must be unique across the whole store. */
export function makeStore(variables: VariableSpec[], constraints: ConstraintSpec[] = []): VariableStore {
  const raw = {
    format: 1,
    agent: 'lighthouse',
    version: '1',
    prior: { kind: 'declared' },
    variables: variables.map((variable) => ({
      id: variable.id,
      title: variable.id,
      kind: variable.kind ?? 'data',
      role: variable.role ?? 'axis',
      approved: variable.approved ?? true,
      values: variable.values.map((value) => {
        const spec = typeof value === 'string' ? { id: value } : value;
        const { quotes, ...rest } = spec;
        return { ...rest, title: spec.id, ...quoted(quotes) };
      }),
      ...(variable.boundaries === undefined
        ? {}
        : {
            boundaries: variable.boundaries.map(({ quotes, ...edge }) => ({ ...edge, ...quoted(quotes) })),
          }),
    })),
    constraints: constraints.map((constraint) => ({
      forbid: constraint.forbid,
      reason: 'a made-up reason',
      approved: constraint.approved ?? true,
      ...quoted(constraint.quotes),
    })),
  };
  const checked = validateVariableStore(raw);
  if (!checked.ok) throw new Error(checked.errors.map((issue) => `${issue.code} ${issue.path}`).join('\n'));
  return checked.store;
}

export type Cell = Record<string, string>;

/** Every subset of `items` with `size` members, in order. */
export function subsets<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...subsets(rest, size - 1).map((tail) => [head, ...tail]), ...subsets(rest, size)];
}

/** Every combination of one value per variable, as a cell. */
export function product(domains: readonly { id: string; values: readonly string[] }[]): Cell[] {
  return domains.reduce<Cell[]>(
    (cells, domain) =>
      cells.flatMap((cell) => domain.values.map((value) => ({ ...cell, [domain.id]: value }))),
    [{}],
  );
}

/** The approved variables of a store with their approved values: the view the planner plans over. */
export function approvedDomains(store: VariableStore) {
  return store.variables
    .map((variable) => ({
      id: variable.id,
      role: variable.role,
      values: variable.values.filter((value) => value.approved ?? variable.approved).map((value) => value.id),
    }))
    .filter((domain) => domain.values.length > 0);
}

/** Every cell of the approved grid that no approved constraint forbids, by brute force. */
export function validCells(store: VariableStore): Cell[] {
  const domains = approvedDomains(store);
  const listed = new Map(domains.map((domain) => [domain.id, new Set(domain.values)]));
  const constraints = store.constraints.filter(
    (constraint) =>
      constraint.approved &&
      Object.entries(constraint.forbid).every(([variable, value]) => listed.get(variable)?.has(value)),
  );
  return product(domains).filter(
    (cell) =>
      !constraints.some((constraint) =>
        Object.entries(constraint.forbid).every(([variable, value]) => cell[variable] === value),
      ),
  );
}

/** Whether a row holds every entry of the tuple. */
export function holds(row: Cell, tuple: Cell): boolean {
  return Object.entries(tuple).every(([variable, value]) => row[variable] === value);
}

/** Every value combination of the given variables that some valid cell holds. */
export function feasibleTuples(cells: readonly Cell[], variables: readonly string[]): Cell[] {
  const seen = new Map<string, Cell>();
  for (const cell of cells) {
    const tuple = Object.fromEntries(variables.map((variable) => [variable, cell[variable] as string]));
    seen.set(JSON.stringify(tuple), tuple);
  }
  return [...seen.values()];
}

/** The tuples over `variables` that a valid cell holds and no row does. */
export function uncovered(
  rows: readonly Cell[],
  cells: readonly Cell[],
  variables: readonly string[],
): Cell[] {
  return feasibleTuples(cells, variables).filter((tuple) => !rows.some((row) => holds(row, tuple)));
}
