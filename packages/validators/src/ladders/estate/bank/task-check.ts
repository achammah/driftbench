import type { Observed } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import {
  ASK_FORMS,
  OUTSIDE_ASK,
  RESUME_ASK,
  renderAsk,
  SLOT,
  SUBJECT_TAIL,
  TOOL_ACTS,
  VERBATIM,
} from '@agent-nexus/driftbench-generate';
import type { SuiteSpec } from './fixture-suite';
import { type Act, actOfAtom, sameTarget, targetsOf } from './task-act';
import { type Field, fieldsOf, isClauseOf, orderedShare } from './task-span';

/**
 * gen.task, read from ids and structure. An ask is judged by what the spec says about it
 * (`metadata.estate.link`, `act`, `from`) against the map, the approved bank and, for an ask that names its act
 * in an explicit form, the trace of the fake agent. No word of any estate is read:
 *
 * - C1 the link names the unit the plan row tests, with the fingerprint the map holds;
 * - C2 the act is the one this validator derives from that unit (`task-act.ts`);
 * - C3 the ask has a source: an approved phrase of a bank situation that lists the unit, a recorded session
 *   of such a situation, a fixed neutral ask, or a named form of the generator over an atom of the map; and it
 *   does not hold the text of a rule of the estate;
 * - C4 when the ask names its act with a code span, every span names a target of the act, and the trace of the
 *   fake shows the act (a control shows none).
 *
 * Limits, stated:
 * - An ask written by the generator is rebuilt from the names of its frame and shapes and its pieces, and each
 *   piece must be a whole clause of the text it cites (`task-span.ts`). That proves provenance, not that the
 *   clause is a task: a whole clause of an atom that is not a request (a statement, a heading) passes, as does
 *   a clause with a declared leading operator removed.
 * - A spec that cites a true source and prints other text is a forged spec; only the trace of an explicit ask
 *   reaches it.
 * - A unit whose act no trace shows (a reply rule) rests on C1 to C3.
 * - A guard act gets no trace requirement: an obedient fake refuses an explicit prohibited command, so a
 *   correct ask leaves no call. Its code spans must still name a span of the rules the guard enforces.
 */

export type BankLike = {
  situations: ReadonlyArray<{
    id: string;
    atoms: readonly string[];
    phrases: ReadonlyArray<{ text: string; approved?: boolean }>;
  }>;
};
export type SessionsLike = {
  sessions: ReadonlyArray<{ name: string; situation: string; ask: string }>;
};
export type AskEnv = {
  atoms: readonly Atom[];
  byId: ReadonlyMap<string, Atom>;
  bank: BankLike;
  sessions: SessionsLike;
};

export function envOf(atoms: readonly Atom[], bank: BankLike, sessions: SessionsLike): AskEnv {
  return { atoms, byId: new Map(atoms.map((atom) => [atom.id, atom])), bank, sessions };
}

/** The atoms a bank situation may list for a row: the row's own, what they enforce or are enforced by, and for a tool rule the atoms of its file. */
function relatedIds(env: AskEnv, ids: readonly string[]): Set<string> {
  const out = new Set(ids);
  for (const id of ids) {
    const atom = env.byId.get(id);
    if (!atom) continue;
    const enforced = Array.isArray(atom.fields?.enforces)
      ? (atom.fields.enforces as Array<{ atom?: unknown }>)
      : [];
    for (const link of enforced) if (typeof link.atom === 'string') out.add(link.atom);
    for (const guard of atom.enforcement ?? []) out.add(guard);
    if (atom.kind === 'tool')
      for (const other of env.atoms) if (other.provenance.file === atom.provenance.file) out.add(other.id);
  }
  return out;
}

/**
 * The share of the words of a rule, in their order, that an ask may hold before it restates the rule. A real
 * ask asks for the work a rule governs; the most any real ask of the Northwind suite takes of a rule of the
 * estate is 0.89 (the ask to pass a carrier code, which holds 8 of the 9 words of its rule), so the bound sits
 * above it. A rule restated with one word changed in a rule of 19 words or fewer is held to the bound.
 */
export const RESTATED_SHARE = 0.95;
const MIN_RULE_WORDS = 4;
function restatedShare(rule: string, ask: string): number {
  return flat(rule).split(' ').length < MIN_RULE_WORDS ? 0 : orderedShare(rule, ask);
}

/** Test types whose ask must not set the unit off. */
export const CONTROL_TYPES: ReadonlySet<string> = new Set([
  'outside_trigger',
  'route_near_miss',
  'guard_negative',
]);
/** Test types that run a guard on a payload: the ask is never read. */
const UNREAD_TYPES: ReadonlySet<string> = new Set(['guard_hostile', 'guard_speed', 'guard_register']);
const RULE_KINDS: ReadonlySet<string> = new Set(['instruction', 'gate', 'register', 'invariant']);
const NEUTRAL: Readonly<Record<string, string>> = { outside: OUTSIDE_ASK, resume: RESUME_ASK };

export type TraceNeed = { act: Act; control: boolean; spans: string[] };
export type AskVerdict = { reasons: string[]; trace?: TraceNeed };

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Letters and digits of a text, lower case, one space between runs: the shape two texts are compared in. */
export const flat = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function firstAskOf(spec: SuiteSpec): string {
  const block = (spec.spec.blocks ?? [])[0] as { when?: { user?: unknown } } | undefined;
  return typeof block?.when?.user === 'string' ? block.when.user : '';
}

const sameAct = (a: Act, b: Act): boolean =>
  a.kind === b.kind && a.name === b.name && a.target === b.target && a.verdict === b.verdict;

export function spansOf(ask: string): string[] {
  return [...ask.matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1] ?? '')
    .filter((span) => span.trim() !== '');
}

/**
 * What a code-written ask owes its source. The ask is rebuilt from the frame, the shapes and the pieces the spec
 * names (`renderAsk`) and must equal them: no word stands outside a declared frame or a piece. Each piece must be
 * a whole clause of a field of the cited atom (`isClauseOf`); a context may also use the row's atoms. The fixed phrase of a tool
 * is the generator's table, and belongs to a tool the cited guard watches; the fixed words of a hazard ask are
 * its own frame. A shape with no piece in it is allowed for those two only.
 */
function pieceReasons(
  from: Record<string, unknown>,
  cited: Atom,
  ask: string,
  atomIds: readonly string[],
  env: AskEnv,
): string[] {
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  const frame = text(from.frame);
  const shape = text(from.shape);
  const context = text(from.context);
  const pieces = Array.isArray(from.pieces) ? (from.pieces as unknown[]).map(text) : undefined;
  if (frame === undefined || shape === undefined || !pieces || pieces.some((piece) => piece === undefined))
    return ['the ask names no frame, shape and pieces it is built from'];
  const list = pieces as string[];
  const rebuilt = renderAsk({ frame, shape, ...(context !== undefined ? { context } : {}), pieces: list });
  if (rebuilt === undefined) return [`the frame ${frame} and the shape ${shape} are not the generator's`];
  if (rebuilt !== ask) return ['the ask is not what its frame, shapes and pieces give'];
  const reasons: string[] = [];
  const tools =
    typeof cited.fields?.matcher === 'string'
      ? cited.fields.matcher
          .split('|')
          .map((tool) => TOOL_ACTS[tool] ?? `use the ${tool} tool on the files here`)
      : [];
  const phrase = [...new Set(Object.values(TOOL_ACTS))].find((candidate) => shape.startsWith(candidate));
  if (phrase !== undefined && (from.form !== 'tool' || !tools.includes(phrase)))
    reasons.push(`the act ${phrase} is no act of a tool the cited unit watches`);
  const bare = shape.split(SLOT).length === 1 && context === undefined;
  if (bare && phrase === undefined && !(from.form === 'hazard' && shape.startsWith('go on with')))
    reasons.push('a code-written ask holds nothing written from its source');
  if (frame === VERBATIM && from.form !== 'user prompt') reasons.push('only a user prompt is its own act');
  if (from.form === 'hazard' && !shape.startsWith('go on with'))
    reasons.push('a hazard ask without the fixed words of one');
  const fields: Field[] = [];
  const actFields: Field[] = [];
  // Acts owe their text to the cited source (or a rule its guard enforces); row atoms also supply context.
  const enforced = Array.isArray(cited.fields?.enforces)
    ? (cited.fields.enforces as Array<{ atom?: unknown }>).flatMap((link) =>
        typeof link.atom === 'string' ? [link.atom] : [],
      )
    : [];
  for (const id of new Set([cited.id, ...atomIds, ...enforced])) {
    const atom = env.byId.get(id);
    if (!atom) continue;
    const own = fieldsOf(atom);
    fields.push(...own);
    if (id === cited.id || enforced.includes(id)) actFields.push(...own);
  }
  const actSlots = shape.split(SLOT).length - 1;
  // The subject of a file ask is taken from the path of the row's reference atom, not from the cited unit.
  for (const [index, piece] of list.entries())
    if (
      !isClauseOf(
        piece,
        index < actSlots && !(shape.endsWith(SUBJECT_TAIL) && index === actSlots - 1) ? actFields : fields,
      )
    )
      reasons.push(`the piece "${piece}" is no whole clause of the text of ${cited.id}`);
  return reasons;
}

export function checkAsk(spec: SuiteSpec, env: AskEnv): AskVerdict {
  const reasons: string[] = [];
  const meta = record(record(spec.spec.metadata)?.estate);
  const ask = firstAskOf(spec);
  if (!meta) return { reasons: ['the spec carries no estate record'] };

  // C1: the link.
  const link = record(meta.link);
  const atomIds = Array.isArray(meta.atoms)
    ? (meta.atoms as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  const unit = typeof link?.span === 'string' ? env.byId.get(link.span) : undefined;
  if (!link) reasons.push('no link to a rule unit');
  else if (!unit) reasons.push(`the link names ${String(link.span)}, which the map does not hold`);
  else {
    if (link.span !== atomIds[0]) reasons.push(`the link names ${link.span}, the row tests ${atomIds[0]}`);
    if (link.fp !== unit.provenance.hash) reasons.push(`the link fingerprint of ${unit.id} is not the map's`);
    if (link.relation !== 'exercises' || link.createdBy !== 'generator')
      reasons.push('the link is not an exercise written by the generator');
  }
  if (!unit) return { reasons };

  // C2: the act.
  const expected = actOfAtom(unit, env.atoms);
  const written = record(meta.act);
  if (!written) reasons.push('no act');
  else if (
    !sameAct(expected, {
      kind: written.kind,
      name: written.name,
      target: written.target,
      verdict: written.verdict,
    } as Act)
  )
    reasons.push(
      `the act of ${unit.id} is ${JSON.stringify(expected)}, the spec says ${JSON.stringify(written)}`,
    );

  // C3: the source of the ask.
  const from = record(meta.from);
  const listing = (id: string) => env.bank.situations.find((situation) => situation.id === id);
  const related = relatedIds(env, atomIds);
  const rowLists = (atoms: readonly string[]) => atoms.some((id) => related.has(id));
  if (!from) reasons.push('the ask names no source');
  else if (typeof from.bank === 'string') {
    const situation = listing(from.bank);
    const phrase = typeof from.phrase === 'number' ? situation?.phrases[from.phrase] : undefined;
    if (!situation) reasons.push(`the bank holds no situation ${from.bank}`);
    else if (!rowLists(situation.atoms))
      reasons.push(`the situation ${situation.id} lists none of the atoms of the row`);
    else if (!phrase || phrase.approved === false || phrase.text !== ask)
      reasons.push(`the ask is not an approved phrase of ${situation.id}`);
  } else if (typeof from.session === 'string') {
    const session = env.sessions.sessions.find((entry) => entry.name === from.session);
    const situation = session ? listing(session.situation) : undefined;
    if (!session) reasons.push(`no recorded session ${from.session}`);
    else if (session.ask !== ask) reasons.push(`the ask is not the ask of the session ${session.name}`);
    else if (!situation || !rowLists(situation.atoms))
      reasons.push(`the situation of the session ${session.name} lists none of the atoms of the row`);
  } else if (typeof from.neutral === 'string') {
    if (from.neutral === 'guard-event') {
      if (!UNREAD_TYPES.has(spec.testType)) reasons.push('a payload ask in a test that reads its ask');
    } else if (NEUTRAL[from.neutral] !== ask) reasons.push(`the ask is not the fixed ${from.neutral} ask`);
  } else if (typeof from.form === 'string') {
    const [id, label] = String(from.field).split('#', 2);
    const cited = id === undefined ? undefined : env.byId.get(id);
    if (!(ASK_FORMS as readonly string[]).includes(from.form))
      reasons.push(`${from.form} is no form of the generator`);
    else if (!cited) reasons.push(`the ask cites ${String(id)}, which the map does not hold`);
    else if (label === undefined || !label.startsWith(from.form))
      reasons.push(`the field ${String(from.field)} is no field of the form ${from.form}`);
    else if (from.fp !== cited.provenance.hash)
      reasons.push(`the fingerprint of ${cited.id} is not the map's`);
    else reasons.push(...pieceReasons(from, cited, ask, atomIds, env));
  } else reasons.push('the source of the ask is none of bank, session, neutral or form');

  // C3, last part: an ask never restates a rule of the estate.
  for (const rule of env.atoms) {
    if (!RULE_KINDS.has(rule.kind)) continue;
    for (const candidate of [rule.title, rule.provenance.quote]) {
      if (restatedShare(candidate, ask) >= RESTATED_SHARE) {
        reasons.push(`the ask restates the rule ${rule.id}`);
        break;
      }
    }
  }

  // C4: an explicit ask names a target of the act, and the trace shows the act.
  const spans = spansOf(ask);
  let trace: TraceNeed | undefined;
  if (spans.length > 0 && expected.kind !== 'reply') {
    const targets = targetsOf(expected, unit, env.atoms);
    if (targets !== undefined) {
      for (const span of spans)
        if (!targets.some((target) => sameTarget(span, target)))
          reasons.push(`the ask names \`${span}\`, which is no target of the act`);
      if (reasons.length === 0 && spec.mode === 'live' && expected.kind !== 'guard')
        trace = { act: expected, control: CONTROL_TYPES.has(spec.testType), spans };
    }
  }
  return { reasons, ...(trace ? { trace } : {}) };
}

const normalPath = (path: string): string => path.replace(/^\.\//, '').replaceAll('\\', '/');

/** Whether the trace of a run shows the act. */
export function shows(act: Act, observed: Observed): boolean {
  const calls = observed.toolCalls ?? [];
  const runtime = observed.runtime;
  const inputText = (input: unknown): string => JSON.stringify(input ?? {});
  switch (act.kind) {
    case 'call':
      return calls.some(
        (call) =>
          call.label === act.name && (act.target === undefined || inputText(call.input).includes(act.target)),
      );
    case 'read': {
      const target = normalPath(act.target ?? '');
      const reads = [
        ...calls
          .filter((call) => call.label === 'Read')
          .map((call) => String(record(call.input)?.file_path ?? '')),
        ...(runtime?.references ?? []).map((entry) => entry.path),
      ];
      return target !== '' && reads.some((path) => normalPath(path).endsWith(target));
    }
    case 'skill':
    case 'helper':
    case 'owned': {
      const helper = act.kind === 'helper' || (act.kind === 'owned' && act.target === 'helper');
      if (helper)
        return (
          (runtime?.subagents ?? []).some((entry) => entry.name === act.name) ||
          calls.some((call) => call.label === 'Agent' && record(call.input)?.subagent_type === act.name)
        );
      return (
        (runtime?.skills ?? []).some((entry) => entry.name === act.name) ||
        calls.some((call) => call.label === 'Skill' && record(call.input)?.skill === act.name)
      );
    }
    default:
      return false;
  }
}

export function checkTrace(need: TraceNeed, observed: Observed | undefined): string | undefined {
  if (!observed) return 'the fake did not run the ask';
  const shown = shows(need.act, observed);
  if (need.control) return shown ? 'a control shows the act' : undefined;
  return shown ? undefined : `the trace of the fake does not show the act ${JSON.stringify(need.act)}`;
}
