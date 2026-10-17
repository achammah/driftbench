import type { EstateAtom } from './inputs';

export type RecoveryCall = { label: string; input: Record<string, unknown> };
export type RecoveryAction = {
  reread: string[];
  calls: RecoveryCall[];
  retry: boolean;
  /** What the rule orders re-read without naming a file ("the open tracker note"): no path check reaches it. */
  unpathed: string[];
};

/** Words that end the object of a re-read: what comes after is the moment, not the thing read. */
const OBJECT_END = /\s+(?:before|until|then|after|when|whenever|once|so|because|while|if|at|during|in|on)\b/i;
/** An object that points back at something already named, or at nothing a person could open. */
const POINTER = /^(?:it|them|that|those|these|this|again|everything|all)$/i;

/**
 * Recovery is read from the source directive, never selected from a hazard-kind default. A file-relative
 * "this file" names the atom's source. Concrete commands and retrying the failed request are observable;
 * an unspecified "recover" supplies no action and must remain a generation gap.
 */
export function recoveryAction(atom: EstateAtom): RecoveryAction {
  const result: RecoveryAction = { reread: [], calls: [], retry: false, unpathed: [] };
  const spans: string[] = [];
  const source = (atom.provenance?.quote ?? '').replace(/`([^`]+)`/g, (_, span: string) => {
    spans.push(span);
    return `\uE000${spans.length - 1}\uE000`;
  });
  for (const clause of source.split(/(?<=[.!?])\s+|\n|;/)) {
    // A verb word that is a noun in the clause ("the open ledger") or a permission ("may read") orders nothing.
    const verbs = [...clause.matchAll(/\b(re-?read|read|reload|open|retry|re-?run|run|execute)\b/gi)].filter(
      (match) => {
        const before = clause.slice(0, match.index);
        return !(
          /\b(?:never|do not|don't|must not|need not|may|can|optionally)(?:\s+[a-z]+){0,3}\s*$/i.test(
            before,
          ) || /\b(?:the|a|an|this|that|every|each|your|our)\s*$/i.test(before)
        );
      },
    );
    for (let index = 0; index < verbs.length; index += 1) {
      const match = verbs[index];
      if (!match) continue;
      const part = clause.slice(match.index + match[0].length, verbs[index + 1]?.index);
      const literals = [...part.matchAll(/\uE000(\d+)\uE000/g)].map((m) => spans[Number(m[1])] ?? '');
      const verb = match[1]?.toLowerCase();
      if (
        verb === 'read' ||
        verb === 'reread' ||
        verb === 're-read' ||
        verb === 'reload' ||
        verb === 'open'
      ) {
        const paths = [
          ...literals.filter((s) => /\.[a-z][\w]*$/i.test(s)),
          ...[...part.matchAll(/(?:^|\s)((?:[\w.-]+\/)*[\w.-]+\.[a-z][\w]*)\b/gi)].map((m) => m[1] ?? ''),
          ...(/\bthis file\b/i.test(part) && atom.provenance?.file ? [atom.provenance.file] : []),
        ];
        for (const path of paths) if (path && !result.reread.includes(path)) result.reread.push(path);
        // Each object of the verb that is neither a path nor "this file" is a part no path check reaches.
        const object = (part.split(OBJECT_END)[0] ?? '').replace(/\uE000\d+\uE000/g, ' ');
        for (const item of object.split(/\s*(?:,|\band\b)\s*/i)) {
          const text = item
            .replace(/[.,;:!?]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (!/\p{L}/u.test(text) || POINTER.test(text) || /\bthis file\b/i.test(text)) continue;
          if (/(?:^|[\s/])[\w.-]+\.[a-z][\w]*$/i.test(text)) continue;
          if (!result.unpathed.includes(text)) result.unpathed.push(text);
        }
      } else if (verb === 'retry') {
        // A quoted retry target can name a URL or tool, not a shell command.
        result.retry = true;
      } else {
        for (const command of literals) {
          if (!command.trim() || /^<[^>]+>$/.test(command)) continue;
          result.calls.push({ label: 'Bash', input: { command: { contains: command } } });
        }
      }
    }
  }
  return result;
}
