import type { SpaceMap } from '@agent-nexus/driftbench-space';
import type { Atom, EstateMap } from '../schema';

/**
 * Relevance is a property of a rule's contract, not its kind. Infer a focused default space from the
 * situation's subject and the atom's own behavioural words and observable capabilities. This is lexical
 * planning, not an entailment engine: a supplied space remains the authoritative way to declare broader
 * relevance or vocabulary the estate reader cannot interpret. No atom id, path or custom check name is
 * behavioural evidence. In particular, an instruction can call a tool or dispatch a helper.
 */
const EVENT_AXES = new Set(['session_state', 'owner_signal', 'deviation', 'estate_hazard']);

// Grammatical and contextual words do not identify what an event acts on. Keep domain words unchanged.
const CONTEXT = new Set(
  `a an the of in on at to for from with without by and or not no when while after
before during then every any each all it its this that these those is are was were be been being as
has have had can could may might must should shall will would do does did you your we our they their
new long explicit middle mid process session task runtime owner user turn event switch switches
run running open happens arrives`.split(/\s+/),
);

function words(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((word) => !CONTEXT.has(word) && !/^\d+$/.test(word))
      .map((word) => word.replace(/(?:ations?|ions?|ing|ed|es|s)$/u, '').replace(/e$/u, ''))
      .filter((word) => word.length > 2),
  );
}

function prose(atom: Atom): string {
  const fields = atom.fields ?? {};
  const own =
    atom.kind === 'skill' || atom.kind === 'subagent'
      ? (fields.description ?? '')
      : atom.kind === 'route'
        ? (atom.situation ?? fields.ask ?? '')
        : atom.provenance.quote;
  // Inline code, paths and link destinations are identifiers, not claims about a situation's subject.
  return `${typeof own === 'string' ? own : ''} ${atom.situation ?? ''}`
    .replace(/`[^`]*`/gu, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\S*[/\\]\S*|\b[\p{L}\p{N}_-]+\.[\p{L}\p{N}_-]+\b/gu, ' ');
}

function capabilities(atom: Atom, toolLabels: ReadonlySet<string>): Set<string> {
  const out = words(prose(atom));
  const add = (text: string) => {
    for (const word of words(text)) out.add(word);
  };
  for (const predicate of atom.evidence) {
    if (predicate.type === 'tool_called') {
      add('tool');
      // Agent and Task are the documented dispatch tool labels; other calls need no helper.
      if (predicate.label === 'Agent' || predicate.label === 'Task') add('helper');
    }
    if (predicate.type === 'text') add('language');
    if (predicate.type === 'ordered' && (toolLabels.has(predicate.before) || toolLabels.has(predicate.after)))
      add('tool');
  }
  const tools = atom.fields?.tools;
  if (Array.isArray(tools) && tools.length > 0) add('tool');
  if (atom.kind === 'subagent' || atom.fields?.targetKind === 'subagent') add('helper');
  // Output rules with custom checks still describe their output in the source, unlike a static check.
  if (/\b(?:reply|replies|answer|answers|respond|response|language|tell)\b/iu.test(prose(atom)))
    add('language');
  return out;
}

export function situationSpace(map: EstateMap, space: SpaceMap): { space: SpaceMap; notes: string[] } {
  const approved = map.atoms.filter((atom) => atom.approved);
  const toolLabels = new Set(
    approved.flatMap((atom) =>
      atom.evidence.flatMap((predicate) => (predicate.type === 'tool_called' ? [predicate.label] : [])),
    ),
  );
  const subjects = new Map(approved.map((atom) => [atom.id, capabilities(atom, toolLabels)]));
  // A route's relevance includes the unit it actually loads. Fixed-point propagation handles route
  // chains and cycles, without importing every rule that happens to live beside the route.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of map.edges) {
      if (edge.kind !== 'route' && edge.kind !== 'dispatch') continue;
      const from = subjects.get(edge.from);
      const to = subjects.get(edge.to);
      if (!from || !to) continue;
      for (const word of to)
        if (!from.has(word)) {
          from.add(word);
          changed = true;
        }
    }
  }
  const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
  const constraints = [...space.constraints];
  const notes: string[] = [];
  for (const dimension of space.dimensions) {
    if (!EVENT_AXES.has(dimension.id)) continue;
    for (const [index, value] of dimension.values.entries()) {
      // The first value is the axis's baseline, and long is an unperturbed session as well.
      if (index === 0 || (dimension.id === 'session_state' && value.id === 'long')) continue;
      const subject = words(value.title);
      if (subject.size === 0) continue;
      const relevant = new Set(
        targets.flatMap((target) =>
          target.values
            .filter((atom) => {
              const own = subjects.get(atom.id);
              return own && [...subject].some((word) => own.has(word));
            })
            .map((atom) => atom.id),
        ),
      );
      if (relevant.size === 0) {
        notes.push(
          `${dimension.id}=${value.id}: no relevant target identified in the estate's declared text or evidence; relevance is unresolved, so the declared combinations are retained.`,
        );
        continue;
      }
      for (const target of targets) {
        for (const atom of target.values) {
          if (relevant.has(atom.id)) continue;
          constraints.push({
            forbid: { [target.id]: atom.id, [dimension.id]: value.id },
            reason: `No shared situation subject or observable capability in the contract of ${atom.id}: ${value.title}`,
          });
        }
      }
    }
  }
  return { space: { ...space, constraints }, notes };
}
