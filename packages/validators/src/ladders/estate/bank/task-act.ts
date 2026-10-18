import type { Atom } from '@agent-nexus/driftbench-estate';

/**
 * The act a rule unit makes the agent do, derived from the map atom by this function alone. The generator
 * writes the same fact beside each ask (`metadata.estate.act`); a spec whose act differs from this one has
 * lowered its own bar. No word of any estate is read: the act comes from the atom's kind, its evidence and its
 * fields, and the carrier of a rule from the folder its file sits in.
 */

export const ACT_KINDS = ['guard', 'call', 'read', 'skill', 'helper', 'owned', 'reply'] as const;
export type Act = {
  kind: (typeof ACT_KINDS)[number];
  name?: string;
  target?: string;
  verdict?: string;
};

const IDENTIFIER = /^[A-Z][A-Za-z0-9_]*$/;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const folderOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/** The skill or helper whose folder or file holds the atom's passage. */
function carrierOf(atom: Atom, atoms: readonly Atom[]): Atom | undefined {
  const file = atom.provenance.file;
  const skill = atoms.find((other) => {
    if (other.kind !== 'skill') return false;
    const folder = folderOf(other.provenance.file);
    return folder !== '' && file.startsWith(`${folder}/`);
  });
  return skill ?? atoms.find((other) => other.kind === 'subagent' && other.provenance.file === file);
}

export function actOfAtom(atom: Atom, atoms: readonly Atom[]): Act {
  const fields = atom.fields ?? {};
  switch (atom.kind) {
    case 'guard': {
      const name = str(fields.name);
      let verdict: string | undefined;
      for (const entry of atom.evidence) if (entry.type === 'guard') verdict = entry.verdict;
      return name && verdict ? { kind: 'guard', name, verdict } : { kind: 'reply' };
    }
    case 'gate': {
      for (const entry of atom.evidence)
        if (entry.type === 'ordered')
          return IDENTIFIER.test(entry.after) ? { kind: 'call', name: entry.after } : { kind: 'reply' };
      return { kind: 'reply' };
    }
    case 'reference': {
      const target = str(fields.path);
      return target ? { kind: 'read', target } : { kind: 'reply' };
    }
    case 'script': {
      const target = str(fields.path);
      return target ? { kind: 'call', name: 'Bash', target } : { kind: 'reply' };
    }
    case 'skill': {
      const name = str(fields.name);
      return name ? { kind: 'skill', name } : { kind: 'reply' };
    }
    case 'subagent': {
      const name = str(fields.name);
      return name ? { kind: 'helper', name } : { kind: 'reply' };
    }
    case 'route': {
      const name = str(fields.target);
      if (!name) return { kind: 'reply' };
      return { kind: fields.targetKind === 'subagent' ? 'helper' : 'skill', name };
    }
    case 'instruction':
    case 'register': {
      const carrier = carrierOf(atom, atoms);
      const name = str(carrier?.fields?.name);
      return carrier && name
        ? { kind: 'owned', name, target: carrier.kind === 'subagent' ? 'helper' : 'skill' }
        : { kind: 'reply' };
    }
    default:
      return { kind: 'reply' };
  }
}

/**
 * The strings an explicit ask may name for this act: a path, a command, a skill or a helper by name, or the
 * spans of the rules a guard enforces. An act no string names (a reply, a tool label alone) allows any.
 */
export function targetsOf(act: Act, atom: Atom, atoms: readonly Atom[]): string[] | undefined {
  switch (act.kind) {
    case 'read':
      return act.target ? [act.target] : [];
    case 'call':
      return act.target ? [act.target] : undefined;
    case 'skill':
    case 'helper':
      return act.name ? [act.name] : [];
    case 'guard': {
      const enforced = Array.isArray(atom.fields?.enforces)
        ? (atom.fields.enforces as Array<{ atom?: unknown }>)
        : [];
      const out: string[] = [];
      for (const link of enforced) {
        const rule = atoms.find((other) => other.id === link.atom);
        const spans = rule?.fields?.spans;
        if (Array.isArray(spans)) for (const span of spans) if (typeof span === 'string') out.push(span);
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** Two strings name the same thing when one holds the other. */
export const sameTarget = (span: string, target: string): boolean =>
  span !== '' && target !== '' && (span.includes(target) || target.includes(span));
