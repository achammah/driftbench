import { posix } from 'node:path';
import type { Atom } from '../schema';
import { type IgnoreRule, ignoreRule } from './ignore';
import type { RawEstate } from './reader';

const RULES = new WeakMap<RawEstate, IgnoreRule[]>();
/** Test the resolved path, not merely a spelling which could resolve into a live local subtree. */
export function ignoredReference(raw: RawEstate, path: string): boolean {
  // A path written outside the estate (`~/`, `/`) is looked for nowhere in it, so no estate ignore rule applies.
  if (path.startsWith('~/') || path.startsWith('/')) return false;
  let rules = RULES.get(raw);
  if (!rules) {
    rules = (raw.ignored?.patterns ?? []).map((entry) => ignoreRule(entry.pattern));
    RULES.set(raw, rules);
  }
  return rules.some((rule) => rule.test(posix.normalize(path)));
}

/** A variable binding or a fill-in value denotes a family of paths, never a concrete file whose absence is known. */
export function placeholderPath(path: string): boolean {
  return (
    /<[^<>\n]+>|\{\{[^{}\n]+\}\}|\$\{[^{}\n]+\}|\{[A-Za-z_][\w-]*\}|%[sdi]|\$[A-Z_]\w*/.test(path) ||
    // A bracketed word, a doubled date letter or a run of fill-in letters stands for a value, not a name.
    /\[[A-Za-z_][\w -]*\]/.test(path) ||
    /(?:^|[^A-Za-z])(?:Y{2,4}|M{2}|D{2}|H{2}|N{3,}|X{3,})(?![A-Za-z])/.test(path)
  );
}

/**
 * Prose-bearing and script file types. A token that resolves to no file counts as a missing file only when its
 * extension names one of these types: a dotted identifier (`Node.js` apart), a version, a ratio or a pair such
 * as `read/write` carries no evidence that a file was meant. An existing file of any type still resolves.
 */
export function documentFileType(written: string): boolean {
  return /\.(md|markdown|txt|json|ya?ml|csv|tsv|html|py|sh|js|mjs|ts)$/i.test(written);
}

/** A filename extension or separator establishes a concrete file location relative to its source. */
export function pathReference(written: string): boolean {
  const extension = posix.extname(written.replace(/\\/g, '/'));
  return /[/\\]/.test(written) || (extension !== '' && extension !== '.' && !/\s/.test(extension));
}

/**
 * A bare name (no separator) that resolves to no file supplies no concrete location unless it is a quoted
 * or linked name with an extension, which designates a file beside its source. A path with a separator
 * names a place. Older code maps have a Read title.
 */
export function unresolvedReference(atom: Atom): boolean {
  if (atom.fields?.unresolved === true) return true;
  if (atom.fields?.concrete === true) return false;
  const written =
    typeof atom.fields?.written === 'string' ? atom.fields.written : /^Read (.+)$/.exec(atom.title)?.[1];
  return written !== undefined && !/[/\\]/.test(written);
}
