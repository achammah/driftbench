import type { AtomKind } from '@agent-nexus/driftbench-estate';

/**
 * Which atoms a situation can act on, from what the generator PLANTED, never from what the product reads.
 *
 * The validator holds the hidden estate: every atom it rendered (hidden id and kind), every edge of the design, every
 * standing rule with the evidence, hazard and scope it planted, every guard with its event, and the units that declare
 * tools. A product (the planner under test) reads the scanned map; an oracle that read the same map facts through the
 * same logic would agree with it by construction. This one reads the planted truth only. The map is used for one thing:
 * to turn a planted hidden id into the id of the atom the scan found for it (an atom the scan missed cannot be crossed).
 *
 * Each of the 13 relations names the typed fact one situation tests. A relation never allows an atom of a kind the
 * previous oracle's kind lists rejected for the situations that use it (docs/validators.md, plan relevance).
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

/** What the generator planted. Hidden ids throughout. */
export type Truth = {
  /** Every atom the renderer wrote: hidden id and kind. */
  atoms: ReadonlyArray<{ hid: string; kind: AtomKind }>;
  /** Every edge of the design (route, dispatch, enforces ...), by hidden id. */
  edges: ReadonlyArray<{ from: string; to: string; kind: string }>;
  /**
   * The prose atoms (standing rules and the lines of skills and helpers), with what was planted for each: the evidence
   * the generator recorded for its line, and for a standing rule the hazard it names and the scope it applies in.
   */
  rules: ReadonlyArray<{
    hid: string;
    kind: string;
    hazard?: string;
    scope?: string;
    evidence: ReadonlyArray<{ type: string; label?: string; before?: string }>;
  }>;
  /** The guards, with the event each runs on. */
  guards: ReadonlyArray<{ hid: string; event: string }>;
  /** The skills and helpers that declare tools. */
  declaresTools: ReadonlyArray<string>;
};

/** The tools that bring outside data into a run. */
const DATA_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
/** The tools that call a service or a helper, where a rate limit or a retry contract applies. */
const RATE_TOOLS = new Set(['Agent', 'Task', 'WebFetch', 'WebSearch', 'Bash']);

/** The hidden ids that hold a relation. */
export function plantedTargets(relation: Relation, truth: Truth): Set<string> {
  const ofKind = (...kinds: AtomKind[]) =>
    truth.atoms.filter((atom) => kinds.includes(atom.kind)).map((atom) => atom.hid);
  const kindOf = new Map(truth.atoms.map((atom) => [atom.hid, atom.kind]));
  const rule = new Map(truth.rules.map((entry) => [entry.hid, entry]));
  const called = (hid: string, labels: ReadonlySet<string>) =>
    rule
      .get(hid)
      ?.evidence.some((e) => e.type === 'tool_called' && e.label !== undefined && labels.has(e.label)) ??
    false;
  const prompt = truth.guards.filter((guard) => guard.event === 'UserPromptSubmit').map((guard) => guard.hid);
  const out = new Set<string>();
  const routesTo = (targets: ReadonlySet<string>) => {
    for (const edge of truth.edges) if (edge.kind === 'route' && targets.has(edge.to)) out.add(edge.from);
  };
  switch (relation) {
    case 'helper': {
      const helpers = ofKind('subagent');
      for (const hid of helpers) out.add(hid);
      routesTo(new Set(helpers));
      break;
    }
    case 'tool': {
      for (const hid of ofKind('tool', 'script', 'guard')) out.add(hid);
      const declaring = truth.declaresTools.filter(
        (hid) => kindOf.get(hid) === 'skill' || kindOf.get(hid) === 'subagent',
      );
      for (const hid of declaring) out.add(hid);
      routesTo(new Set(declaring));
      break;
    }
    case 'stage':
      for (const hid of ofKind('stage')) out.add(hid);
      break;
    case 'output':
      for (const hid of ofKind('register')) out.add(hid);
      for (const hid of ofKind('instruction'))
        if (rule.get(hid)?.evidence.some((e) => e.type === 'text')) out.add(hid);
      break;
    case 'data':
      // A rule whose planted evidence is a read of outside data, or an order that starts with one (read before edit).
      for (const hid of ofKind('gate', 'instruction'))
        if (
          called(hid, DATA_TOOLS) ||
          rule
            .get(hid)
            ?.evidence.some((e) => e.type === 'ordered' && e.before !== undefined && DATA_TOOLS.has(e.before))
        )
          out.add(hid);
      break;
    case 'confirmation':
      for (const hid of ofKind('gate')) out.add(hid);
      break;
    case 'rate': {
      for (const hid of ofKind('script', 'subagent')) out.add(hid);
      for (const atom of truth.atoms) {
        // A tool atom's hidden id ends with its rule, `tool:<effect>:<tool>[(pattern)]`.
        const label = /^tool:[^:]+:([A-Za-z]+)/.exec(atom.hid)?.[1];
        if (atom.kind === 'tool' && label !== undefined && RATE_TOOLS.has(label)) out.add(atom.hid);
      }
      for (const hid of ofKind('instruction')) if (called(hid, RATE_TOOLS)) out.add(hid);
      break;
    }
    case 'restart':
    case 'compaction': {
      const hazard = relation;
      for (const entry of truth.rules)
        if (
          (entry.kind === 'instruction' || entry.kind === 'gate') &&
          (entry.hazard === hazard || entry.scope === hazard)
        )
          out.add(entry.hid);
      break;
    }
    case 'stoprule':
    case 'stop': {
      const guards = new Set(prompt);
      for (const edge of truth.edges)
        if (edge.kind === 'enforces' && guards.has(edge.from) && kindOf.get(edge.to) === 'instruction')
          out.add(edge.to);
      if (relation === 'stop') for (const hid of prompt) out.add(hid);
      break;
    }
    case 'prompt':
      for (const hid of prompt) out.add(hid);
      break;
    case 'routing': {
      const routes = new Set(ofKind('route'));
      for (const hid of routes) out.add(hid);
      for (const edge of truth.edges)
        if (edge.kind === 'route' && routes.has(edge.from) && kindOf.get(edge.to) === 'skill')
          out.add(edge.to);
      break;
    }
  }
  return out;
}

export type Crossing = { row: string; atom: string };

export type RelevanceVerdict = { pass: boolean; detail: string };

/**
 * The verdict on one situation. `targets` are the scanned ids of the planted holders of its relation, `known` the ids of
 * the scanned atoms and `kind` their kinds (for the message). With targets, a crossing with any other atom is wrong and at
 * least one crossing must be with a target. With none, no atom applies and any crossing is wrong; a plan with no row of
 * the situation, or a row with no atom, is not.
 */
export function judgeTargets(
  targets: ReadonlySet<string>,
  known: ReadonlyMap<string, string>,
  crossings: readonly Crossing[],
): RelevanceVerdict {
  const rows = crossings.filter((crossing) => known.has(crossing.atom));
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
  if (wrong.length > 0)
    return {
      pass: false,
      detail: `${wrong.length} rows cross it with atoms it cannot act on: ${wrong
        .slice(0, 3)
        .map((crossing) => `${crossing.row} ${crossing.atom} (${known.get(crossing.atom)})`)
        .join(', ')}`,
    };
  return rows.length === 0
    ? {
        pass: false,
        detail: `${targets.size} atoms can be acted on and no row crosses the situation with one`,
      }
    : { pass: true, detail: 'holds' };
}
