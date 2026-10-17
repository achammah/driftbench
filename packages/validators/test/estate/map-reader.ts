import type { Atom, AtomKind, EstateMap } from '@agent-nexus/driftbench-estate';

/**
 * What the validator knows, with no word of the estate read, about which atoms a situation can act on.
 *
 * The planner reads an estate's words to infer relevance (docs/estate.md, "Situation relevance in a proposed plan").
 * An oracle that read the same words would agree with the planner by construction. This one reads only typed data
 * the validator planted or the map states in a typed field: the kind of an atom, the type of each predicate of its
 * evidence, the kind of each edge of the graph, the typed fields of an atom (a hazard id, a permission effect, a guard
 * event) and what the hidden estate planted for a standing rule (the hazard it names, the scope it applies in, its
 * behaviour). No title, quote, situation or description is read.
 *
 * Each situation has one relation. The atoms that hold it are its identified targets. When no atom holds the
 * relation, no atom applies and any crossing of the situation is wrong.
 */

/** What a standing rule of the hidden estate plants, by the id of the scanned atom it was matched to. */
export type Planted = {
  /** The runtime hazard the rule's line names. */
  hazard?: string;
  /** The situation the rule applies in: always, or its own (a stop, a push, a compaction, a restart). */
  scope?: string;
  /** The act of the rule follower that obeys the rule. */
  behaviour?: string;
};

export type Relation =
  | 'helper'
  | 'tool'
  | 'stage'
  | 'output'
  | 'data'
  | 'confirmation'
  | 'rate'
  | 'restart'
  | 'compaction'
  | 'stoprule'
  | 'stop'
  | 'prompt'
  | 'routing';

/** The tools that bring outside data into a run: what an instruction planted in data would arrive through. */
const DATA_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
/** The tools that call a service or a helper, where a rate limit or a retry contract applies. */
const RATE_TOOLS = new Set(['Agent', 'Task', 'WebFetch', 'WebSearch', 'Bash']);

/** The kinds that hold a relation by what they are, whatever their evidence and fields. */
export const IDENTITY: Record<Relation, readonly AtomKind[]> = {
  helper: ['subagent'],
  tool: ['tool', 'script', 'guard'],
  stage: ['stage'],
  output: ['register'],
  data: [],
  confirmation: ['gate'],
  rate: ['script', 'subagent'],
  restart: [],
  compaction: [],
  stoprule: [],
  stop: [],
  prompt: [],
  routing: ['route'],
};

const called = (atom: Atom, labels: ReadonlySet<string>) =>
  atom.evidence.some((item) => item.type === 'tool_called' && labels.has(item.label));

/**
 * Whether the atom holds the relation itself, from its kind, its typed evidence, its typed fields or what was planted.
 * A relation is narrow: it names the typed fact the situation tests (an outside-data tool, a retry contract, a stop
 * rule), not every atom that touches a tool, so it never allows an atom a coarser reading of the situation would not.
 */
function holds(relation: Relation, atom: Atom, planted: Planted | undefined): boolean {
  const field = (name: string) => atom.fields?.[name];
  const kind = atom.kind;
  if (IDENTITY[relation].includes(kind)) return true;
  switch (relation) {
    case 'tool':
      // A unit that declares tools holds the failure of one of them.
      return (
        (kind === 'skill' || kind === 'subagent') &&
        Array.isArray(field('tools')) &&
        (field('tools') as unknown[]).length > 0
      );
    case 'output':
      return kind === 'instruction' && atom.evidence.some((item) => item.type === 'text');
    case 'data':
      return (
        ((kind === 'instruction' || kind === 'gate') && called(atom, DATA_TOOLS)) ||
        (kind === 'guard' && field('event') === 'PostToolUse')
      );
    case 'rate':
      return (
        (kind === 'tool' && RATE_TOOLS.has(String(field('tool')))) ||
        (kind === 'instruction' && called(atom, RATE_TOOLS))
      );
    case 'restart':
    case 'compaction': {
      const hazard = relation === 'restart' ? 'restart' : 'compaction';
      return (
        (kind === 'instruction' || kind === 'gate') &&
        (planted?.hazard === hazard || planted?.scope === hazard)
      );
    }
    case 'stoprule':
      // Placed by an edge of the map (a guard on the prompt event enforces the instruction), in targetsOf.
      return false;
    case 'stop':
      return holds('prompt', atom, planted);
    case 'prompt':
      return kind === 'guard' && field('event') === 'UserPromptSubmit';
    default:
      return false;
  }
}

/**
 * The identified targets of a relation: the atoms that hold it, and the routes that open one (a route to a helper, a
 * route to a skill that declares the tools, a route and the skill it opens). Nothing is reached beyond one route edge.
 */
export function targetsOf(
  relation: Relation,
  map: Pick<EstateMap, 'atoms' | 'edges'>,
  planted: ReadonlyMap<string, Planted> = new Map(),
): Set<string> {
  const byId = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const own = new Set(
    map.atoms.filter((atom) => holds(relation, atom, planted.get(atom.id))).map((atom) => atom.id),
  );
  const out = new Set(own);
  if (relation === 'helper' || relation === 'tool')
    for (const edge of map.edges) if (edge.kind === 'route' && own.has(edge.to)) out.add(edge.from);
  // A stop rule is an instruction a guard on the prompt event enforces: the map carries the enforces edge, so the
  // oracle reads that typed fact and nothing the hidden estate planted or the words of the rule say.
  if (relation === 'stoprule' || relation === 'stop') {
    const prompt = new Set(
      map.atoms.filter((atom) => holds('prompt', atom, undefined)).map((atom) => atom.id),
    );
    for (const edge of map.edges)
      if (edge.kind === 'enforces' && prompt.has(edge.from) && byId.get(edge.to)?.kind === 'instruction')
        out.add(edge.to);
  }
  if (relation === 'routing')
    for (const edge of map.edges)
      if (edge.kind === 'route' && own.has(edge.from) && byId.get(edge.to)?.kind === 'skill')
        out.add(edge.to);
  return out;
}

export type Crossing = { row: string; atom: string };

export type RelevanceVerdict = { pass: boolean; detail: string };

/**
 * The verdict on one situation: `crossings` are the rows of the plan that cross it with an atom. With identified
 * targets, a crossing with any other atom is wrong, and at least one crossing must be with a target. With none, no
 * atom applies and any crossing is wrong: the bank plants the typed fact each situation tests, and an estate that
 * holds none gives the situation nothing to act on.
 */
export function judgeRelevance(
  relation: Relation,
  map: Pick<EstateMap, 'atoms' | 'edges'>,
  crossings: readonly Crossing[],
  planted: ReadonlyMap<string, Planted> = new Map(),
): RelevanceVerdict {
  const known = new Set(map.atoms.map((atom) => atom.id));
  const rows = crossings.filter((crossing) => known.has(crossing.atom));
  const targets = targetsOf(relation, map, planted);
  // No atom holds the relation: no atom applies, so any crossing is wrong. A plan with no row for the situation is not.
  if (targets.size === 0) {
    return rows.length > 0
      ? {
          pass: false,
          detail: `no atom holds the relation, yet ${rows.length} rows cross it: ${rows
            .slice(0, 3)
            .map((crossing) => `${crossing.row} ${crossing.atom}`)
            .join(', ')}`,
        }
      : { pass: true, detail: 'no atom applies and the plan holds no row of this situation' };
  }
  const wrong = rows.filter((crossing) => !targets.has(crossing.atom));
  if (wrong.length > 0) {
    const kind = (id: string) => map.atoms.find((atom) => atom.id === id)?.kind;
    return {
      pass: false,
      detail: `${wrong.length} rows cross it with atoms it cannot act on: ${wrong
        .slice(0, 3)
        .map((crossing) => `${crossing.row} ${crossing.atom} (${kind(crossing.atom)})`)
        .join(', ')}`,
    };
  }
  return rows.length === 0
    ? {
        pass: false,
        detail: `${targets.size} atoms can be acted on and no row crosses the situation with one`,
      }
    : { pass: true, detail: 'holds' };
}
