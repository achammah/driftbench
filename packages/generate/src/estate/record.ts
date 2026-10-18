import { createHash } from 'node:crypto';
import { decompose } from './frames';
import type { EstateAtom } from './inputs';

/**
 * What a generated ask says about itself, written beside it in `metadata.estate` so a check can read ids and
 * structure instead of the ask's words:
 *
 * - `link`: the rule unit the ask exercises. `span` is the map atom id (the ledger unit id once the pointer
 *   reader lands) and `fp` its fingerprint when the ask was written.
 * - `act`: what the unit makes the agent do or not do, as the runtime shows it: a tool call, a guard that
 *   fires, a file read, a skill or a helper loaded. A unit whose act no trace shows is a `reply`.
 * - `from`: where the ask text came from: an approved bank phrase, a recorded session, a fixed neutral ask, or
 *   a named form of the generator over a field of an atom.
 *
 * The act is derived here from the atom's evidence and fields. The validator derives it again by its own
 * function, so a spec cannot lower its own bar by writing a weaker act.
 */

export type LinkRecord = { span: string; fp: string; relation: 'exercises'; createdBy: 'generator' };

export const ACT_KINDS = ['guard', 'call', 'read', 'skill', 'helper', 'owned', 'reply'] as const;
export type ActKind = (typeof ACT_KINDS)[number];
export type ActRecord = { kind: ActKind; name?: string; target?: string; verdict?: string };

export type FromRecord =
  | { bank: string; phrase: number }
  | { session: string }
  | { neutral: 'outside' | 'resume' | 'guard-event' }
  | {
      form: string;
      field: string;
      fp: string;
      /** The frame, the shape of the act and of the context sentence, and the pieces they hold. */
      frame: string;
      shape: string;
      context?: string;
      pieces: string[];
    };

/** The forms of the generator that write an ask from a field of an atom: the closed set a `from` may name. */
export const ASK_FORMS = [
  'asks it names',
  'description',
  'enforced by',
  'gate trigger',
  'governed clause',
  'hazard',
  'matcher',
  'readWhen',
  'readWhen topic',
  'route nearest the rule',
  'rule',
  'ruleText',
  'situation',
  'title',
  'tool',
  'tool rule',
  'trigger',
  'user prompt',
] as const;

const TOOL_LABEL = /^[A-Z][A-Za-z0-9_]*$/;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/** The fingerprint of an atom: the hash the map records for its passage, else a hash of the passage. */
export function fingerprintOf(atom: EstateAtom): string {
  const recorded = (atom.provenance as { hash?: unknown } | undefined)?.hash;
  if (typeof recorded === 'string' && recorded !== '') return recorded;
  return createHash('sha256')
    .update(atom.provenance?.quote ?? atom.title)
    .digest('hex');
}

export function linkOf(atom: EstateAtom): LinkRecord {
  return { span: atom.id, fp: fingerprintOf(atom), relation: 'exercises', createdBy: 'generator' };
}

/** The act of a unit, from its evidence and fields. `owner` is the skill or helper that carries a rule. */
export function actRecord(atom: EstateAtom, owner?: EstateAtom): ActRecord {
  const fields = atom.fields ?? {};
  switch (atom.kind) {
    case 'guard': {
      const name = text(fields.name);
      let verdict: string | undefined;
      for (const entry of atom.evidence) if (entry.type === 'guard') verdict = entry.verdict;
      return name && verdict ? { kind: 'guard', name, verdict } : { kind: 'reply' };
    }
    case 'gate': {
      let after: string | undefined;
      for (const entry of atom.evidence)
        if (entry.type === 'ordered' && after === undefined) after = entry.after;
      return after !== undefined && TOOL_LABEL.test(after)
        ? { kind: 'call', name: after }
        : { kind: 'reply' };
    }
    case 'reference': {
      const path = text(fields.path);
      return path ? { kind: 'read', target: path } : { kind: 'reply' };
    }
    case 'script': {
      const path = text(fields.path);
      return path ? { kind: 'call', name: 'Bash', target: path } : { kind: 'reply' };
    }
    case 'skill': {
      const name = text(fields.name);
      return name ? { kind: 'skill', name } : { kind: 'reply' };
    }
    case 'subagent': {
      const name = text(fields.name);
      return name ? { kind: 'helper', name } : { kind: 'reply' };
    }
    case 'route': {
      const target = text(fields.target);
      if (!target) return { kind: 'reply' };
      return { kind: fields.targetKind === 'subagent' ? 'helper' : 'skill', name: target };
    }
    case 'instruction':
    case 'register': {
      const name = text(owner?.fields?.name);
      return owner && name
        ? { kind: 'owned', name, target: owner.kind === 'subagent' ? 'helper' : 'skill' }
        : { kind: 'reply' };
    }
    default:
      return { kind: 'reply' };
  }
}

/** The form a source label names. `enforced by <guard>` is one form whatever the guard. */
export function formOf(label: string): string {
  return label.replace(/^enforced by .*/, 'enforced by').replace(/:.*$/, '');
}

/**
 * Where the first ask came from. A code-written ask names its source as `<atom id> (<label>)`; the label is
 * the form and the atom the field's owner.
 */
export function fromRecord(input: {
  bank?: { situation: string; phrase: number };
  session?: string;
  askFrom?: string;
  /** What a code-written ask was built from: the frame, the act put into it and the context sentence. */
  built?: { frame: string; act: string; context?: string };
  /** For a neutral ask: which fixed ask it is. */
  neutral?: 'outside' | 'resume' | 'guard-event';
  atoms: ReadonlyMap<string, EstateAtom>;
}): FromRecord | undefined {
  if (input.session !== undefined) return { session: input.session };
  if (input.bank) return { bank: input.bank.situation, phrase: input.bank.phrase };
  const source = input.askFrom;
  if (source === undefined) return undefined;
  if (source === 'neutral') return { neutral: input.neutral ?? 'outside' };
  const match = /^(\S+) \((.+)\)$/.exec(source);
  const id = match?.[1];
  const label = match?.[2];
  const atom = id === undefined ? undefined : input.atoms.get(id);
  if (!atom || label === undefined) return undefined;
  return {
    form: formOf(label),
    field: `${atom.id}#${label}`,
    fp: fingerprintOf(atom),
    ...(input.built
      ? decompose(input.built.frame, input.built.act, input.built.context)
      : { frame: '', shape: '', pieces: [] }),
  };
}
