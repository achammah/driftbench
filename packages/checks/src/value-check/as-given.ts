import { show } from '../support/values';
import type { Rung, ValueCase } from './ladder';

/**
 * Rung 2b, as given: a value is held against the source the agent was given, the user's messages or a workspace
 * file. Changing a value the user gave is the agent's own act (value_equivalence.md 3c R2), so the rung fails
 * it. It never passes one: a copy proves where the value came from, not that it is right (a copied `7 Quarry
 * Ln` is still a value the coverage map rejects, R3), so a copied value goes on to the judge, else to the
 * exact fallback. So:
 *
 * - the agent's value appears in a source and the gold's writing does not: the agent copied what it was given;
 *   no decision here, change `verbatim`;
 * - the gold's writing appears in a source and the agent's value does not: the agent changed a value it was
 *   given; fail, change `altered`. A reformatted copy fails here and never reaches the judge, since the reader
 *   of the value may not share the conversion the agent assumed (`1024 MB` written `1 GB`);
 * - both appear: the user's later message stands, as in a correction ("sorry, my email is ...") given in a turn
 *   after the first value. The agent kept the earlier value: fail, change `stale`; it took the later one: no
 *   decision here. Both in the same message, or neither anywhere: the source cannot decide.
 *
 * A source matches as a whole token: the characters around it are not letters or digits. With
 * `ignore: [surrounding_space]` the value is trimmed first. Workspace files count as read before the user's
 * messages.
 */

/**
 * Where the value came from: the source that holds the agent's value, else the one that holds the gold's
 * writing (the agent was given it and wrote something else); `unknown` when neither appears.
 */
export function sourceOf(value: ValueCase, trim = true): 'user' | 'workspace_file' | 'unknown' {
  for (const candidate of [value.value, value.gold]) {
    if (typeof candidate !== 'string') continue;
    const needle = trim ? candidate.trim() : candidate;
    if (needle === '') continue;
    if ((value.sources?.user ?? []).some((text) => holdsToken(text, needle))) return 'user';
    if (Object.values(value.sources?.files ?? {}).some((text) => holdsToken(text, needle))) {
      return 'workspace_file';
    }
  }
  return 'unknown';
}

export const asGiven: Rung = (value, ctx) => {
  if (typeof value.value !== 'string' || typeof value.gold !== 'string') {
    return { skip: 'a value that is not a string has no source to copy' };
  }
  const ignore = Array.isArray(ctx.params.ignore) ? ctx.params.ignore : [];
  const trim = ignore.includes('surrounding_space');
  const mine = trim ? value.value.trim() : value.value;
  const gold = trim ? value.gold.trim() : value.gold;
  if (mine === '') return { skip: 'the value is empty' };
  const copied = where(value, mine);
  const goldGiven = where(value, gold) !== undefined;
  if (copied !== undefined && !goldGiven) {
    return {
      skip: `${show(value.value)} is copied as given from ${copied}; a copy proves the source, not the value`,
    };
  }
  if (copied === undefined && goldGiven) {
    return {
      settles: 'fail',
      evidence: `the agent was given ${show(value.gold)} and wrote ${show(value.value)}: it changed the value`,
      emits: { change: 'altered' },
    };
  }
  if (copied === undefined)
    return { skip: 'neither the value nor the gold appears in what the agent was given' };
  const latestMine = latest(value, mine);
  const latestGold = latest(value, gold);
  if (latestGold > latestMine) {
    return {
      settles: 'fail',
      evidence: `the user gave ${show(value.value)}, then ${show(value.gold)} in a later message; the agent kept the earlier value`,
      emits: { change: 'stale' },
    };
  }
  if (latestMine > latestGold) {
    return {
      skip: `the user gave ${show(value.gold)}, then ${show(value.value)} in a later message, and the agent took the later value; a copy proves the source, not the value`,
    };
  }
  return { skip: `both the value and the gold appear in the same message the agent was given (${copied})` };
};

/** The position of the last source holding a needle: files first, then the user's messages in order; -1 when none. */
function latest(value: ValueCase, needle: string): number {
  const texts = [...Object.values(value.sources?.files ?? {}), ...(value.sources?.user ?? [])];
  let found = -1;
  texts.forEach((text, index) => {
    if (holdsToken(text, needle)) found = index;
  });
  return found;
}

/** Where a needle appears as a whole token: `the user's message` or `the file <path>`; undefined when nowhere. */
function where(value: ValueCase, needle: string): string | undefined {
  if ((value.sources?.user ?? []).some((text) => holdsToken(text, needle))) return "the user's message";
  for (const [path, text] of Object.entries(value.sources?.files ?? {})) {
    if (holdsToken(text, needle)) return `the file ${path}`;
  }
  return undefined;
}

const WORD = /[\p{L}\p{N}]/u;

/** True when `needle` occurs in `text` with no letter or digit right before or right after it. */
export function holdsToken(text: string, needle: string): boolean {
  if (needle === '') return false;
  let from = text.indexOf(needle);
  while (from >= 0) {
    const before = from === 0 ? '' : (text[from - 1] ?? '');
    const after = text[from + needle.length] ?? '';
    const startsWord = WORD.test(needle[0] ?? '');
    const endsWord = WORD.test(needle[needle.length - 1] ?? '');
    const openLeft = !startsWord || before === '' || !WORD.test(before);
    const openRight = !endsWord || after === '' || !WORD.test(after);
    if (openLeft && openRight) return true;
    from = text.indexOf(needle, from + 1);
  }
  return false;
}
