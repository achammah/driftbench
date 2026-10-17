import { compilePredicate } from '@agent-nexus/driftbench-generate';
import type { SpaceMap } from '@agent-nexus/driftbench-space';
import type { Atom, AtomKind, EstateMap } from '../schema';

/**
 * Which atoms a situation can act on, read from typed data of the map and never from words.
 *
 * Each situation of the fixed axes (`session_state`, `owner_signal`, `deviation`, `estate_hazard`) tests one
 * typed fact, its relation. The atoms that hold the relation are the situation's identified targets; the plan
 * crosses the situation with them and with no other atom. A relation reads the kind of an atom, the type of each
 * predicate of its evidence, the kind of each edge of the graph, its typed fields (a tool label, a guard event, the
 * tools a unit declares, a hazard id) and the passage it was read from. No title, quote, situation or description
 * is read, so the same rule worded in another language, or in words the planner has never seen, places the same.
 *
 * A situation whose relation no atom of the estate holds has nothing to act on: it is not crossed with any atom,
 * and the summary says so. A value outside the fixed axes, or a value of a supplied space map, names no relation
 * and keeps every combination.
 */

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

/** The relation each situation value of the fixed axes tests, by value id. */
export const RELATION_OF: Readonly<Record<string, Relation>> = {
  dead_helper: 'helper',
  helpers_running: 'helper',
  stale_tracker: 'stage',
  D5_language_switch: 'output',
  language_switch: 'output',
  D8_tool_failure: 'tool',
  D6_instruction_in_data: 'data',
  D4_loose_confirmation: 'confirmation',
  no_questions: 'confirmation',
  rate_wave: 'rate',
  process_restart: 'restart',
  after_restart: 'restart',
  compaction_mid_task: 'compaction',
  after_compaction: 'compaction',
  resumed: 'stoprule',
  stop: 'stop',
  D2_goal_shift: 'routing',
  D1_off_topic: 'routing',
  D9_out_of_scope: 'routing',
  D7_silence_or_burst: 'prompt',
  hold: 'stop',
  keep_going: 'confirmation',
  frustration: 'output',
  limit_word: 'prompt',
  D3_contradiction: 'confirmation',
  D10_return: 'stoprule',
  D11_pii_leak: 'output',
  D12_prompt_extraction: 'output',
};

const EVENT_AXES = new Set(['session_state', 'owner_signal', 'deviation', 'estate_hazard']);

/** The tools that bring outside data into a run: what an instruction planted in data arrives through. */
const DATA_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
/** The tools that call a service or a helper, where a rate limit or a retry contract applies. */
const RATE_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task', 'WebFetch', 'WebSearch', 'Bash']);

/**
 * Whether a custom predicate is a check of the reply: the generator lowers it (from its name and its options) to words
 * the reply must or must not hold, or to the language of the ask. The generator's compile table is the one list of
 * these predicates; a name it does not compile, or options too thin to compile it, is no reply check.
 */
function checksReply(name: string, options: Record<string, unknown> | undefined): boolean {
  try {
    const compiled = compilePredicate(name, options);
    return (
      compiled !== undefined &&
      ((compiled.must?.length ?? 0) > 0 ||
        (compiled.mustNot?.length ?? 0) > 0 ||
        compiled.langFromAsk === true)
    );
  } catch {
    return false;
  }
}

/** The kinds that hold a relation by what they are, whatever their evidence and fields. */
const IDENTITY: Readonly<Record<Relation, readonly AtomKind[]>> = {
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

const calls = (atom: Atom, labels: ReadonlySet<string>): boolean =>
  atom.evidence.some((item) => item.type === 'tool_called' && labels.has(item.label));

type Span = { file: string; start: number; end: number };

/** The passage an atom was read from: its file and its line span. */
const spanOf = (atom: Atom): Span => ({
  file: atom.provenance.file,
  start: atom.provenance.startLine,
  end: atom.provenance.endLine,
});

/** Whether two passages of one file share a line: a rule written over two lines shares a line with its hazard. */
const overlaps = (a: Span, b: Span): boolean => a.file === b.file && a.start <= b.end && b.start <= a.end;

type Context = {
  /** The passages that name each runtime hazard (hazard atoms carry the hazard id). */
  hazardPassages: ReadonlyMap<string, readonly Span[]>;
  /** The rules a guard on the user's prompt enforces. */
  promptEnforced: ReadonlySet<string>;
};

function contextOf(map: EstateMap): Context {
  const byId = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const hazardPassages = new Map<string, Span[]>();
  for (const atom of map.atoms) {
    const hazard = atom.kind === 'hazard' ? atom.fields?.hazard : undefined;
    if (typeof hazard !== 'string') continue;
    hazardPassages.set(hazard, [...(hazardPassages.get(hazard) ?? []), spanOf(atom)]);
  }
  const promptEnforced = new Set<string>();
  for (const edge of map.edges)
    if (edge.kind === 'enforces' && byId.get(edge.from)?.fields?.event === 'UserPromptSubmit')
      promptEnforced.add(edge.to);
  return { hazardPassages, promptEnforced };
}

/** Whether the atom holds the relation itself, from its kind, its typed evidence and fields, or its passage. */
function holds(relation: Relation, atom: Atom, context: Context): boolean {
  if (IDENTITY[relation].includes(atom.kind)) return true;
  const field = (name: string) => atom.fields?.[name];
  const rule = atom.kind === 'instruction' || atom.kind === 'gate';
  switch (relation) {
    case 'tool':
      // A unit that declares tools holds the failure of one of them.
      return (
        (atom.kind === 'skill' || atom.kind === 'subagent') &&
        Array.isArray(field('tools')) &&
        (field('tools') as unknown[]).length > 0
      );
    case 'output':
      // A rule about the reply: a text predicate, or a custom predicate the generator lowers to a reply check.
      return (
        atom.kind === 'instruction' &&
        atom.evidence.some(
          (item) => item.type === 'text' || (item.type === 'custom' && checksReply(item.name, item.options)),
        )
      );
    case 'data':
      return (rule && calls(atom, DATA_TOOLS)) || (atom.kind === 'guard' && field('event') === 'PostToolUse');
    case 'rate':
      return (
        (atom.kind === 'tool' && RATE_TOOLS.has(String(field('tool')))) ||
        (atom.kind === 'instruction' && calls(atom, RATE_TOOLS))
      );
    case 'restart':
    case 'compaction':
      // A rule stated in the passage that names the hazard.
      return (
        rule && (context.hazardPassages.get(relation)?.some((span) => overlaps(span, spanOf(atom))) ?? false)
      );
    case 'stoprule':
      // A rule that a guard on the user's prompt enforces.
      return atom.kind === 'instruction' && context.promptEnforced.has(atom.id);
    case 'stop':
      return holds('stoprule', atom, context) || holds('prompt', atom, context);
    case 'prompt':
      return atom.kind === 'guard' && field('event') === 'UserPromptSubmit';
    default:
      return false;
  }
}

/**
 * The identified targets of a relation: the atoms that hold it, and the routes that open one (a route to a helper,
 * a route to a unit that declares tools, a route and the skill it opens). Nothing is reached beyond one route edge.
 */
export function targetsOf(relation: Relation, map: EstateMap): Set<string> {
  const context = contextOf(map);
  const approved = map.atoms.filter((atom) => atom.approved);
  const own = new Set(approved.filter((atom) => holds(relation, atom, context)).map((atom) => atom.id));
  const out = new Set(own);
  if (relation === 'helper' || relation === 'tool')
    for (const edge of map.edges) if (edge.kind === 'route' && own.has(edge.to)) out.add(edge.from);
  if (relation === 'routing') {
    const kindOf = new Map(map.atoms.map((atom) => [atom.id, atom.kind]));
    for (const edge of map.edges)
      if (edge.kind === 'route' && own.has(edge.from) && kindOf.get(edge.to) === 'skill') out.add(edge.to);
  }
  return out;
}

export function situationSpace(map: EstateMap, space: SpaceMap): { space: SpaceMap; notes: string[] } {
  const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
  const constraints = [...space.constraints];
  const notes: string[] = [];
  const identified = new Map<Relation, Set<string>>();
  for (const dimension of space.dimensions) {
    if (!EVENT_AXES.has(dimension.id)) continue;
    for (const [index, value] of dimension.values.entries()) {
      // The first value is the axis's baseline, and long is an unperturbed session as well.
      if (index === 0 || (dimension.id === 'session_state' && value.id === 'long')) continue;
      const relation = RELATION_OF[value.id];
      if (relation === undefined) continue;
      let relevant = identified.get(relation);
      if (relevant === undefined) {
        relevant = targetsOf(relation, map);
        identified.set(relation, relevant);
      }
      if (relevant.size === 0)
        notes.push(
          `${dimension.id}=${value.id}: no atom of the estate holds the relation "${relation}", so the situation has nothing to act on and is crossed with no atom.`,
        );
      for (const target of targets) {
        for (const atom of target.values) {
          if (relevant.has(atom.id)) continue;
          constraints.push({
            forbid: { [target.id]: atom.id, [dimension.id]: value.id },
            reason: `${atom.id} does not hold the relation "${relation}" that ${value.title} tests`,
          });
        }
      }
    }
  }
  return { space: { ...space, constraints }, notes };
}
