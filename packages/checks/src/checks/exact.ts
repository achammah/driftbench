import { type Check, machineVerdict } from '@agent-nexus/driftbench-core';
import { quote, visibleText } from '../support/text';

const NAME = 'exact';

/**
 * Drops everything that is not a letter, a digit or a space, trims, and lowers case. Both sides of an exact
 * comparison pass through it.
 */
export function normaliseExact(text: string): string {
  return [...text.trim()]
    .filter((char) => /[\p{L}\p{N}\s]/u.test(char))
    .join('')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** A number a text reads as: a finite number, or true and false as 1 and 0. Undefined for prose. */
function numberOf(text: string): number | undefined {
  const trimmed = text.trim();
  // The word is read after normalising, so the case is lowered and punctuation around it is dropped.
  const word = normaliseExact(trimmed);
  if (word === 'true') return 1;
  if (word === 'false') return 0;
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** Use Unicode decimal digits for both separator neighbors and strict thousands grouping. */
function digitSignature(text: string): string {
  const ungrouped = text.replace(/\p{Nd}+(?:,\p{Nd}+)*/gu, (run) =>
    /^\p{Nd}{1,3}(?:,\p{Nd}{3})+$/u.test(run) ? run.replace(/,/g, '') : run,
  );
  return [...ungrouped]
    .filter(
      (char, index, chars) =>
        /\p{Nd}/u.test(char) ||
        ((char === '.' || char === ',') &&
          /\p{Nd}/u.test(chars[index - 1] ?? '') &&
          /\p{Nd}/u.test(chars[index + 1] ?? '')),
    )
    .join('');
}

/**
 * `expect.exact`: the visible text of the reply equals the reference (`exact_strict: true` compares byte for byte). Two numbers compare as numbers, so
 * `42.0` equals `42`; other text retains dots and commas between digits in a separate guard before normalising.
 * An empty reply never equals a reference,
 * because the spec refuses an empty reference.
 */
export const exact: Check = {
  name: NAME,
  applies: (ctx) => ctx.expect.exact !== undefined,
  evaluate(ctx) {
    const reference = ctx.expect.exact;
    if (reference === undefined) return [];
    const reply = visibleText(ctx.observed);
    if (ctx.expect.exact_strict === true) {
      const same = reply.trim() === reference.trim();
      return [
        machineVerdict(
          NAME,
          '0',
          same ? 'pass' : 'fail',
          `${quote(reply.trim())} ${same ? '==' : '!='} ${quote(reference.trim())} byte for byte`,
        ),
      ];
    }
    const replyNumber = numberOf(reply);
    const referenceNumber = numberOf(reference);
    if (replyNumber !== undefined && referenceNumber !== undefined) {
      const same = replyNumber === referenceNumber;
      return [
        machineVerdict(
          NAME,
          '0',
          same ? 'pass' : 'fail',
          same
            ? `${reply.trim()} equals ${reference.trim()} as a number`
            : `${reply.trim()} is not ${reference.trim()} as a number`,
        ),
      ];
    }
    const replyDigits = digitSignature(reply);
    const referenceDigits = digitSignature(reference);
    if (replyDigits !== referenceDigits) {
      return [
        machineVerdict(
          NAME,
          '0',
          'fail',
          `digit signatures ${quote(replyDigits)} differ from ${quote(referenceDigits)}`,
        ),
      ];
    }
    const left = normaliseExact(reply);
    const right = normaliseExact(reference);
    const same = left !== '' && left === right;
    return [
      machineVerdict(
        NAME,
        '0',
        same ? 'pass' : 'fail',
        `"${left}" ${same ? '==' : '!='} "${right}" after normalising`,
      ),
    ];
  },
};
