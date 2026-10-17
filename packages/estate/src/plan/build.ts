import { contentHash } from '@agent-nexus/driftbench-core';
import {
  anchoredLines,
  Feasibility,
  navigationFiles,
  navigationReference,
  rowOwners,
} from '@agent-nexus/driftbench-generate';
import { compileSpace, gridSize, type SpaceMap } from '@agent-nexus/driftbench-space';
import { toEstateSpaceMap } from '../map/space';
import { AtomKind, type EstateMap, type Plan, type PlanRow, TestType } from '../schema';
import { contractRows, type DraftRow, MODE_OF, NO_CONTRACT, PRIMARY_TYPE } from './contract';
import { JOURNEY_DEFAULTS, type JourneyResult, planJourneys } from './journeys';
import { type PairwiseResult, pairwiseCells, TARGET_PREFIX } from './pairwise';
import { situationSpace } from './relevance';

/**
 * The plan of design section 4, derived from the approved map by code: the mandatory rows of every
 * approved atom by its kind's contract, the journeys over the estate graph, and the pairwise cells of the
 * situation axes. Nothing reads a clock or a model: the same map and options give the same plan, byte
 * for byte once rendered.
 */

export type PlanOptions = {
  /** Strength of the covering array. Default 2. */
  t?: number;
  /** An explicit space is authoritative. Default: infer relevance from the approved map's contracts. */
  space?: SpaceMap;
  /** Positive asks per route. Default 3. */
  k?: number;
  /** The seed of the covering array and the journey walk. Default 1. */
  seed?: number;
  /** The most covering array rows. Default 100000. */
  maxRows?: number;
};

export const PLAN_DEFAULTS = { t: 2, k: 3, seed: 1, maxRows: 100_000 } as const;

/** What the plan file's summary holds, plus the lists behind its counts. */
export type PlanDetails = {
  t: number;
  k: number;
  seed: number;
  rows: { total: number; contract: number; journey: number; pairwise: number };
  /** The full grid of the space map, never enumerated. */
  gridCells: number;
  tuples: { allowed: number; covered: number };
  /** Approved atoms of a kind the contract holds no test for. */
  noContract: string[];
  /** Atoms not approved, left out of the plan. */
  unapproved: number;
  /** The journey edges no journey takes, each with why. */
  uncoveredEdges: Array<{ from: string; kind: string; to: string; reason: string }>;
  /** Constraints of the space map that name target atoms of two kinds and cannot hold for one target. */
  droppedConstraints: number;
  /** Rows whose situation values the space map does not hold or forbids, with what was left out. */
  adjusted: Array<{ row: string; reason: string }>;
  /** Inferred target/situation exclusions; explicit spaces keep their own constraint list. */
  relevanceConstraints?: SpaceMap['constraints'];
  notes: string[];
};

export type PlanResult = { plan: Plan; details: PlanDetails };

export const PHRASE_NOTE =
  'The map has no phrase bank yet: every cell counts as a cell with no approved phrase.';

export function buildPlan(map: EstateMap, options: PlanOptions = {}): PlanResult {
  const t = options.t ?? PLAN_DEFAULTS.t;
  const k = options.k ?? PLAN_DEFAULTS.k;
  const seed = options.seed ?? PLAN_DEFAULTS.seed;
  if (!Number.isInteger(t) || t < 1) throw new RangeError(`t must be a whole number of at least 1, not ${t}`);
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a whole number of at least 1, not ${k}`);
  const declaredSpace = options.space ?? toEstateSpaceMap(map);
  const inferred = options.space ? { space: declaredSpace, notes: [] } : situationSpace(map, declaredSpace);
  const space = inferred.space;
  checkTargets(map, space);

  const askClasses = space.dimensions.find((dimension) => dimension.id === 'ask_class')?.values ?? [];
  const drafts = contractRows(map, AtomKind.options, { k, askClasses: askClasses.map((value) => value.id) });
  const journeys = planJourneys(map, { ...JOURNEY_DEFAULTS, seed });
  const pairwise = pairwiseCells(space, { t, seed, maxRows: options.maxRows ?? PLAN_DEFAULTS.maxRows });

  const adjusted: PlanDetails['adjusted'] = [];
  const fit = cellFitter(declaredSpace);
  const contract = drafts.map((draft) => toRow(draft, fit(draft, adjusted)));
  const journeyRows = journeyRowsOf(journeys);
  const pairwiseRows = pairwiseRowsOf(map, pairwise);
  const rows = [...contract, ...journeyRows, ...pairwiseRows];
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`two plan rows share the id ${row.id}`);
    ids.add(row.id);
  }

  const approved = map.atoms.filter((atom) => atom.approved);
  const kindOf = new Map(approved.map((atom) => [atom.id, atom.kind]));
  const perKind: Record<string, number> = {};
  for (const kind of AtomKind.options) {
    const count = contract.filter((row) => row.atomIds.some((id) => kindOf.get(id) === kind)).length;
    if (count > 0) perKind[kind] = count;
  }
  const perTestType: Record<string, number> = {};
  for (const type of TestType.options) {
    const count = rows.filter((row) => row.testType === type).length;
    if (count > 0) perTestType[type] = count;
  }
  const cells = new Set(rows.map(cellKey)).size;
  const plan: Plan = {
    version: 1,
    mapHash: map.hash,
    spaceHash: contentHash(space),
    rows,
    summary: {
      cells,
      coveringArraySize: pairwise.cells.length,
      perKind,
      perTestType,
      unenforcedAtoms: approved
        .filter(
          (atom) => ['instruction', 'gate', 'register'].includes(atom.kind) && atom.enforcement.length === 0,
        )
        .map((atom) => atom.id),
      cellsWithoutPhrase: cells,
      edgesWithoutJourney: journeys.uncovered.length,
    },
  };
  const notes = [PHRASE_NOTE, ...inferred.notes];
  const navigation = navigationFiles(map.documents);
  const anchored = anchoredLines(map.atoms);
  const navigational = approved.filter((atom) => navigationReference(atom, navigation, anchored)).length;
  if (navigational > 0) {
    notes.push(
      `${navigational} reference${navigational === 1 ? '' : 's'} to documents the map records as navigation only (examples, templates, histories) give no test.`,
    );
  }
  if (pairwise.covered < pairwise.allowed) {
    notes.push(
      `The covering array stopped at ${pairwise.cells.length} rows with ${pairwise.allowed - pairwise.covered} t-tuples uncovered: raise the row limit.`,
    );
  }
  return {
    plan,
    details: {
      t: pairwise.t,
      k,
      seed,
      rows: {
        total: rows.length,
        contract: contract.length,
        journey: journeyRows.length,
        pairwise: pairwiseRows.length,
      },
      gridCells: gridSize(space),
      tuples: { allowed: pairwise.allowed, covered: pairwise.covered },
      noContract: approved.filter((atom) => NO_CONTRACT.has(atom.kind)).map((atom) => atom.id),
      unapproved: map.atoms.length - approved.length,
      uncoveredEdges: journeys.uncovered.map(({ edge, reason }) => ({ ...edge, reason })),
      droppedConstraints: pairwise.dropped,
      adjusted,
      ...(!options.space
        ? { relevanceConstraints: space.constraints.slice(declaredSpace.constraints.length) }
        : {}),
      notes,
    },
  };
}

/** A space map given by hand must list only approved atoms of the map as targets, each under its kind. */
function checkTargets(map: EstateMap, space: SpaceMap): void {
  const byId = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const wrong: string[] = [];
  for (const dimension of space.dimensions.filter((candidate) => candidate.id.startsWith(TARGET_PREFIX))) {
    for (const value of dimension.values) {
      const atom = byId.get(value.id);
      if (!atom) wrong.push(`${value.id} (not an atom of the map)`);
      else if (!atom.approved) wrong.push(`${value.id} (not approved)`);
      else if (`${TARGET_PREFIX}${atom.kind}` !== dimension.id)
        wrong.push(`${value.id} (listed under ${dimension.id})`);
      else if (PRIMARY_TYPE[atom.kind] === undefined)
        wrong.push(`${value.id} (a ${atom.kind} has no test of its own)`);
    }
  }
  if (wrong.length > 0) {
    throw new PlanInputError(`the space map does not match the approved map: ${wrong.join(', ')}`);
  }
}

export class PlanInputError extends Error {}

type Fit = (draft: DraftRow, adjusted: PlanDetails['adjusted']) => Record<string, string>;

/**
 * Keeps the cell values the space map holds, in the space map's dimension order, and drops the situation
 * values the constraint list forbids with the target (the target is kept). Every change is listed.
 */
function cellFitter(space: SpaceMap): Fit {
  const compiled = compileSpace(space);
  const feasibility = new Feasibility(compiled);
  const position = new Map(compiled.dimensions.map((dimension, index) => [dimension.id, index]));
  return (draft, adjusted) => {
    const pairs: Array<[number, number, string, string]> = [];
    for (const [dimension, value] of Object.entries(draft.cell)) {
      const at = position.get(dimension);
      const index = at === undefined ? undefined : compiled.dimensions[at]?.index.get(value);
      if (at === undefined || index === undefined) {
        if (!dimension.startsWith(TARGET_PREFIX)) {
          adjusted.push({ row: draft.id, reason: `the space map holds no ${dimension} value ${value}` });
        }
        continue;
      }
      pairs.push([at, index, dimension, value]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    let kept = pairs;
    if (!feasibility.allowed(kept.map(([at, index]) => [at, index] as const))) {
      kept = pairs.filter(([, , dimension]) => dimension.startsWith(TARGET_PREFIX));
      adjusted.push({
        row: draft.id,
        reason: `the constraint list forbids ${pairs
          .filter(([, , dimension]) => !dimension.startsWith(TARGET_PREFIX))
          .map(([, , dimension, value]) => `${dimension}=${value}`)
          .join(', ')}`,
      });
    }
    return Object.fromEntries(kept.map(([, , dimension, value]) => [dimension, value]));
  };
}

function toRow(draft: DraftRow, cell: Record<string, string>): PlanRow {
  return {
    id: draft.id,
    atomIds: draft.atomIds,
    cell,
    testType: draft.testType,
    mode: MODE_OF[draft.testType],
    status: 'proposed',
    weight: 1,
    ...(draft.note ? { note: draft.note } : {}),
  };
}

function journeyRowsOf(result: JourneyResult): PlanRow[] {
  const width = String(result.journeys.length).length;
  return result.journeys.map((journey, index) => ({
    id: `journey.${String(index + 1).padStart(width, '0')}`,
    atomIds: journey.atomIds,
    cell: {},
    testType: 'journey',
    mode: MODE_OF.journey,
    status: 'proposed',
    weight: 1,
    note: `A path of ${journey.atomIds.length} ${journey.atomIds.length === 1 ? 'atom' : 'atoms'} from the standing instructions, one block per atom.`,
  }));
}

function pairwiseRowsOf(map: EstateMap, result: PairwiseResult): PlanRow[] {
  const kindOf = new Map(map.atoms.map((atom) => [atom.id, atom.kind]));
  const owners = rowOwners(
    map.atoms.filter((atom) => atom.approved),
    map.edges,
  );
  const width = String(result.cells.length).length;
  return result.cells.map((cell, index) => {
    const kind = kindOf.get(cell.atom);
    const testType = (kind && PRIMARY_TYPE[kind]) ?? 'obligation';
    const owner = owners.get(cell.atom);
    return {
      id: `pairwise.${String(index + 1).padStart(width, '0')}`,
      atomIds: owner ? [cell.atom, owner] : [cell.atom],
      cell: { ...cell.situation, [cell.dimension]: cell.atom },
      testType,
      mode: 'live',
      status: 'proposed',
      weight: 1,
    };
  });
}

/** A cell of the plan: the atoms a row exercises crossed with its situation values. */
export function cellKey(row: Pick<PlanRow, 'atomIds' | 'cell'>): string {
  const situation = Object.entries(row.cell)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dimension, value]) => `${dimension}=${value}`);
  return `${row.atomIds.join(' ')} | ${situation.join(' ')}`;
}
