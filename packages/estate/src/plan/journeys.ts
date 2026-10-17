import {
  EMPTY_RELATIONS,
  Feasibility,
  type PreparedMap,
  rngFor,
  stageGraph,
  walkGraph,
} from '@agent-nexus/driftbench-generate';
import { compileSpace, type SpaceMap } from '@agent-nexus/driftbench-space';
import type { Atom, Edge, EstateMap } from '../schema';

/**
 * Journeys: edge coverage over the estate graph from the standing instructions (design section 4, last
 * row of the contract). The graph keeps the edges an ask walks: route (an ask to the skill or helper it
 * loads), reference (a unit to a file it reads), script (a unit to a script it runs), dispatch (a unit to a helper it sends work to) and next
 * (a stage to the stage that follows). A start node stands for the standing instructions: it points at
 * every route the standing files state (a route outside any skill or helper file) and at every stage no
 * other stage leads to. The walk is the edge-covering walk of the generator (`walkGraph`, GraphWalker's
 * edge_coverage(100)), run on a two-dimension space map whose stages are the atoms and whose transitions
 * are the edges; each path is a journey listing its atoms in order. Edges no path takes are listed with
 * the reason: no route from the standing instructions leads to them.
 */

export const JOURNEY_EDGE_KINDS: ReadonlySet<Edge['kind']> = new Set([
  'route',
  'reference',
  'script',
  'dispatch',
  'next',
]);

/** The node that stands for the standing instructions. Not an atom id: atom ids are `kind.scope.slug`. */
export const START = 'standing-instructions';

export type Journey = { atomIds: string[] };

export type JourneyResult = {
  journeys: Journey[];
  /** Journey edges of approved atoms, in map order. */
  edges: Edge[];
  /** Edges no journey takes, each with why. */
  uncovered: Array<{ edge: Edge; reason: string }>;
};

export type JourneyOptions = { seed: number; maxLength: number; maxPaths: number };

export const JOURNEY_DEFAULTS: JourneyOptions = { seed: 1, maxLength: 16, maxPaths: 500 };

export function planJourneys(map: EstateMap, options: JourneyOptions = JOURNEY_DEFAULTS): JourneyResult {
  const atoms = map.atoms.filter((atom) => atom.approved);
  const approved = new Set(atoms.map((atom) => atom.id));
  const edges = map.edges.filter(
    (edge) => JOURNEY_EDGE_KINDS.has(edge.kind) && approved.has(edge.from) && approved.has(edge.to),
  );
  if (edges.length === 0) return { journeys: [], edges, uncovered: [] };

  const entries = entryNodes(atoms, edges);
  const nodes = [START, ...atoms.map((atom) => atom.id).filter((id) => touches(id, edges))];
  const walked = [
    ...entries.map((to) => ({ from: START, to })),
    ...edges.map((edge) => ({ from: edge.from, to: edge.to })),
  ];
  const transitions = unique(walked.map((edge) => transitionId(edge.from, edge.to)));
  const space: SpaceMap = {
    version: 'journeys',
    agent: 'estate',
    dimensions: [
      {
        id: 'stage',
        title: 'Estate graph nodes',
        kind: 'stage',
        values: nodes.map((id) => ({ id, title: id })),
      },
      {
        id: 'stage_transition',
        title: 'Estate graph edges',
        kind: 'behaviour',
        values: transitions.map((id) => ({ id, title: id })),
      },
    ],
    constraints: [],
    prior: { kind: 'declared' },
  };
  const compiled = compileSpace(space);
  const prepared: PreparedMap = {
    agent: 'estate',
    version: '1',
    hash: map.hash,
    map: space,
    space: compiled,
    axisMap: space,
    axes: new Set([0, 1]),
    relations: EMPTY_RELATIONS,
    feasibility: new Feasibility(compiled),
    phrases: [],
    phrasesOf: new Map(),
    tools: [],
    toolDimensions: new Map(),
    inventory: undefined,
    stage: 0,
    deviation: undefined,
    channel: undefined,
    transition: 1,
  };
  const graph = stageGraph(prepared);
  if (!graph || graph.unparsed.length > 0 || graph.start !== START) {
    throw new Error(
      `the estate graph did not read back as a walk from the standing instructions: ${graph?.unparsed.join(', ') ?? 'no graph'}`,
    );
  }
  const walk = walkGraph(prepared, graph, rngFor(options.seed, 'journeys'), {
    maxLength: options.maxLength,
    maxPaths: options.maxPaths,
  });
  const journeys = walk.paths
    .map((path) => ({ atomIds: path.edges.map((edge) => edge.to) }))
    .filter((journey) => journey.atomIds.length > 0);
  const covered = new Set(walk.covered);
  const blocked = new Set(walk.blocked);
  const uncovered = edges
    .filter((edge) => !covered.has(transitionId(edge.from, edge.to)))
    .map((edge) => ({
      edge,
      reason: blocked.has(transitionId(edge.from, edge.to))
        ? `reachable, but no path of at most ${options.maxLength} edges took it`
        : reasonUnreached(edge, atoms),
    }));
  return { journeys, edges, uncovered };
}

/**
 * Where the standing instructions lead: the routes they state (a route atom outside every skill and
 * helper file; a route read from a unit's own description enters by that description only), then the
 * stages no `next` edge enters, steps allowed at any point left out. When every stage is entered (a
 * cycle), the first stage of the map.
 */
export function entryNodes(atoms: readonly Atom[], edges: readonly Edge[]): string[] {
  const unitFiles = new Set(
    atoms
      .filter((atom) => atom.kind === 'skill' || atom.kind === 'subagent')
      .map((atom) => atom.provenance.file),
  );
  const routes = atoms
    .filter((atom) => atom.kind === 'route' && !unitFiles.has(atom.provenance.file))
    .filter((atom) => edges.some((edge) => edge.from === atom.id))
    .map((atom) => atom.id);
  const entered = new Set(edges.filter((edge) => edge.kind === 'next').map((edge) => edge.to));
  const stages = atoms.filter(
    (atom) =>
      atom.kind === 'stage' && atom.fields?.anytime !== true && edges.some((edge) => edge.from === atom.id),
  );
  const first = stages.filter((stage) => !entered.has(stage.id)).map((stage) => stage.id);
  return [...routes, ...(first.length > 0 ? first : stages.slice(0, 1).map((stage) => stage.id))];
}

function reasonUnreached(edge: Edge, atoms: readonly Atom[]): string {
  const from = atoms.find((atom) => atom.id === edge.from);
  if (from?.kind === 'route')
    return 'the route is read from a skill or helper description: the standing instructions do not state it';
  return 'nothing the standing instructions state leads to its start';
}

/** The transition value id of the generator's stage graph: `<from>-to-<to>`. */
export function transitionId(from: string, to: string): string {
  return `${from}-to-${to}`;
}

function touches(id: string, edges: readonly Edge[]): boolean {
  return edges.some((edge) => edge.from === id || edge.to === id);
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}
