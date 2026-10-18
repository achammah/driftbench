import { type Observed, ObservedReplyAct } from '@agent-nexus/driftbench-core';
import { type Atom, ReplyActDeclaration } from '@agent-nexus/driftbench-estate';
import {
  ASK_FORMS,
  declaredAskOf,
  HAZARD_FRAME,
  OUTSIDE_ASK,
  RESUME_ASK,
  renderAsk,
  SLOT,
  STRUCTURED_ACT_SHAPES,
  TOOL_ACTS,
  VERBATIM,
} from '@agent-nexus/driftbench-generate';
import type { SuiteSpec } from './fixture-suite';
import { type Act, actOfAtom, sameTarget, targetsOf } from './task-act';
import { type Field, fieldsOf, isClauseOf, orderedShare } from './task-span';

/**
 * Every ask is pinned to a map atom and a declared source. Code asks are re-rendered from their recorded
 * frame and pieces. Every accepted ask also requires a recorded observation of the map-derived act,
 * including guards and replies. Unsupported evidence fails closed; a nonempty reply is not an act proof.
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

export type TraceNeed = {
  act: Act;
  control: boolean;
  spans: string[];
  unit: string;
  evidence: Atom['evidence'];
  replyAct?: Atom['replyAct'];
};
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

/** A semantic label proves an act only when its recorded evidence binds an actual output segment. */
function boundReplyAct(observed: Observed): ObservedReplyAct | undefined {
  const parsed = ObservedReplyAct.safeParse(observed.replyAct);
  if (!parsed.success) return undefined;
  const segment = observed.segments?.[parsed.data.evidence.index];
  return segment?.type === 'text' && segment.text.trim() !== '' ? parsed.data : undefined;
}

function replyEvidenceSupported(act: Act, declaration: Atom['replyAct']): boolean {
  const parsed = ReplyActDeclaration.safeParse(declaration);
  return parsed.success && act.name === parsed.data.id;
}

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
  if (frame === VERBATIM && !(cited.fields?.event === 'UserPromptSubmit' && declaredAskOf(cited, env.atoms)))
    reasons.push('only a declared user prompt is its own act');
  if (from.form === 'structured ask') {
    const declared = declaredAskOf(cited, env.atoms);
    const takesContext =
      frame === 'trigger' || frame === 'twin' || frame === 'pressure' || /^variant_\d+$/.test(frame);
    const expectedContext = frame !== VERBATIM && takesContext ? declared?.context : undefined;
    const expectedPieces = declared
      ? [declared.text, ...(expectedContext !== undefined ? [expectedContext] : [])]
      : [];
    if (
      !declared ||
      shape !== SLOT ||
      context !== (expectedContext === undefined ? undefined : SLOT) ||
      list.length !== expectedPieces.length ||
      list.some((piece, index) => piece !== expectedPieces[index])
    )
      reasons.push('the structured ask pieces differ from its complete map declaration');
    for (const piece of list)
      if (!isClauseOf(piece, fieldsOf(cited)))
        reasons.push(`the piece "${piece}" is no whole clause of the text of ${cited.id}`);
    return reasons;
  }
  if (from.form !== 'structured act' && from.form !== 'tool' && from.form !== 'hazard')
    return ['the legacy prose form supplies no structured task declaration'];
  if (from.form === 'structured act') {
    const act = actOfAtom(cited, env.atoms);
    let canonical: { shape: string; pieces: string[] } | undefined;
    if ((act.kind === 'skill' || act.kind === 'helper' || act.kind === 'owned') && act.name) {
      const helper = act.kind === 'helper' || (act.kind === 'owned' && act.target === 'helper');
      canonical = {
        shape: helper ? STRUCTURED_ACT_SHAPES.helper : STRUCTURED_ACT_SHAPES.skill,
        pieces: [act.name],
      };
    } else if (act.kind === 'read' && act.target) {
      canonical = { shape: STRUCTURED_ACT_SHAPES.read, pieces: [act.target] };
    } else if (act.kind === 'call' && act.name) {
      canonical =
        act.name === 'Bash' && act.target
          ? { shape: STRUCTURED_ACT_SHAPES.command, pieces: [act.target] }
          : act.target
            ? { shape: STRUCTURED_ACT_SHAPES.callTarget, pieces: [act.name, act.target] }
            : { shape: STRUCTURED_ACT_SHAPES.call, pieces: [act.name] };
    }
    if (
      !canonical ||
      context !== undefined ||
      shape !== canonical.shape ||
      list.length !== canonical.pieces.length ||
      list.some((piece, index) => piece !== canonical.pieces[index])
    )
      reasons.push('the structured act pieces differ from the map identifiers');
    return reasons;
  }
  // Tool ids select a write-only template. No phrase matching interprets the ask or its shape.
  const tool = typeof from.tool === 'string' ? from.tool : undefined;
  const bare = shape.split(SLOT).length === 1 && context === undefined;
  if (tool !== undefined) {
    if (
      from.form !== 'tool' ||
      cited.kind !== 'guard' ||
      cited.fields?.matcher !== tool ||
      TOOL_ACTS[tool] !== shape
    )
      reasons.push('the tool template does not belong to the cited guard');
  } else if (bare && !(from.form === 'hazard' && shape === HAZARD_FRAME)) {
    reasons.push('a code-written ask holds nothing written from its source');
  }
  if (from.form === 'hazard' && shape !== HAZARD_FRAME && shape !== `${HAZARD_FRAME}, after ${SLOT}`)
    reasons.push('a hazard ask without its declared frame');
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
  for (const [index, piece] of list.entries())
    if (!isClauseOf(piece, index < actSlots ? actFields : fields))
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

  if (expected.kind === 'call' && !callEvidenceSupported(expected))
    reasons.push('the map supplies no concrete supported call input');

  if (expected.kind === 'reply' && !replyEvidenceSupported(expected, unit.replyAct))
    reasons.push('the map supplies no supported reply act declaration');

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
    else {
      if (from.form === 'structured ask' && !declaredAskOf(cited, env.atoms))
        reasons.push('the source declares no ask with the map act');
      reasons.push(...pieceReasons(from, cited, ask, atomIds, env));
    }
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

  // Explicit target spans are additional evidence, never a condition for requiring a trace.
  const spans = spansOf(ask);
  if (spans.length > 0 && expected.kind !== 'reply') {
    const targets = targetsOf(expected, unit, env.atoms);
    if (targets !== undefined)
      for (const span of spans)
        if (!targets.some((target) => sameTarget(span, target)))
          reasons.push(`the ask names \`${span}\`, which is no target of the act`);
  }
  const trace: TraceNeed | undefined =
    reasons.length === 0
      ? {
          act: expected,
          control: CONTROL_TYPES.has(spec.testType),
          spans,
          unit: unit.id,
          evidence: unit.evidence,
          ...(unit.replyAct ? { replyAct: unit.replyAct } : {}),
        }
      : undefined;
  return { reasons, ...(trace ? { trace } : {}) };
}

const normalPath = (path: string): string => path.replace(/^\.\//, '').replaceAll('\\', '/');

/** A tool label alone cannot identify the requested operation. */
function callEvidenceSupported(act: Act): boolean {
  return act.name === 'Bash' && typeof act.target === 'string' && act.target.trim() !== '';
}

/** Whether the trace of a run shows the act. */
export function shows(
  act: Act,
  observed: Observed,
  evidence: Atom['evidence'] = [],
  replyAct?: Atom['replyAct'],
): boolean {
  const calls = observed.toolCalls ?? [];
  const runtime = observed.runtime;
  switch (act.kind) {
    case 'call': {
      if (!callEvidenceSupported(act)) return false;
      const target = act.target as string;
      const ordered = evidence.some((entry) => entry.type === 'ordered' && entry.after === act.name);
      return calls.some((call) => {
        const command = record(call.input)?.command;
        return (
          call.label === act.name &&
          typeof command === 'string' &&
          (command === target || (!ordered && command.startsWith(`${target} `)))
        );
      });
    }
    case 'read': {
      const target = normalPath(act.target ?? '');
      const reads = [
        ...calls
          .filter((call) => call.label === 'Read')
          .map((call) => String(record(call.input)?.file_path ?? '')),
        ...(runtime?.references ?? []).map((entry) => entry.path),
      ];
      return (
        target !== '' &&
        reads.some((path) => normalPath(path) === target || normalPath(path).endsWith(`/${target}`))
      );
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
    case 'guard': {
      const minimum = Math.max(
        1,
        ...evidence.flatMap((entry) => (entry.type === 'guard' ? [entry.min ?? 1] : [])),
      );
      return (
        (runtime?.guards ?? []).filter((entry) => entry.name === act.name && entry.verdict === act.verdict)
          .length >= minimum
      );
    }
    case 'reply': {
      const declaration = ReplyActDeclaration.safeParse(replyAct);
      const label = boundReplyAct(observed);
      return (
        declaration.success &&
        label !== undefined &&
        act.name === declaration.data.id &&
        label.id === declaration.data.id &&
        label.evidence.type === declaration.data.evidence.type &&
        label.evidence.part === declaration.data.evidence.part
      );
    }
    default:
      return false;
  }
}

export function checkTrace(need: TraceNeed, observed: Observed | undefined): string | undefined {
  if (!observed) return 'the fake did not run the ask';
  if (need.act.kind === 'call' && !callEvidenceSupported(need.act))
    return 'the map supplies no concrete supported call input';
  if (need.act.kind === 'reply' && !replyEvidenceSupported(need.act, need.replyAct))
    return 'the map supplies no supported reply act declaration';
  if (need.act.kind === 'reply' && !boundReplyAct(observed))
    return 'the trace supplies no valid reply act bound to a text segment';
  const shown = shows(need.act, observed, need.evidence, need.replyAct);
  if (need.control) return shown ? 'a control shows the act' : undefined;
  return shown ? undefined : `the trace of the fake does not show the act ${JSON.stringify(need.act)}`;
}
