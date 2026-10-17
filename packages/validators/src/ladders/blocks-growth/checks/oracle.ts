import type { Rng } from '../../blocks/harness';

/**
 * Slow, obviously correct references written from the rules of docs/reference/checks.md alone: the word-level
 * ROUGE-L F measure and BLEU of the `driftbench` profile ("Overlap and SQL"), the personal-data checksums and
 * the cosine of two vectors. The product is never consulted.
 */

/** Words as the driftbench profile reads them: runs of letters and digits, lower case, no stemming. */
export const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1)
      (table[i] as number[])[j] =
        a[i - 1] === b[j - 1]
          ? ((table[i - 1] as number[])[j - 1] as number) + 1
          : Math.max((table[i - 1] as number[])[j] as number, (table[i] as number[])[j - 1] as number);
  return (table[a.length] as number[])[b.length] as number;
}

/** The F measure of the longest common word subsequence of the reply and the reference. */
export function rougeL(reply: string, reference: string): number {
  const [c, r] = [wordsOf(reply), wordsOf(reference)];
  const lcs = lcsLength(c, r);
  if (lcs === 0) return 0;
  const [p, q] = [lcs / c.length, lcs / r.length];
  return (2 * p * q) / (p + q);
}

const grams = (words: readonly string[], n: number): Map<string, number> => {
  const out = new Map<string, number>();
  for (let i = 0; i + n <= words.length; i += 1) {
    const key = words.slice(i, i + n).join(' ');
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
};

/** The geometric mean of the clipped 1- to 4-gram precisions with a brevity penalty; 0 when a size has no match. */
export function bleu(reply: string, reference: string): number {
  const [c, r] = [wordsOf(reply), wordsOf(reference)];
  if (c.length === 0) return 0;
  let logSum = 0;
  for (let n = 1; n <= 4; n += 1) {
    const [cg, rg] = [grams(c, n), grams(r, n)];
    let total = 0;
    let clipped = 0;
    for (const [gram, count] of cg) {
      total += count;
      clipped += Math.min(count, rg.get(gram) ?? 0);
    }
    if (total === 0 || clipped === 0) return 0;
    logSum += Math.log(clipped / total) / 4;
  }
  const brevity = c.length > r.length ? 1 : Math.exp(1 - r.length / c.length);
  return brevity * Math.exp(logSum);
}

/** `count` words drawn from `vocabulary` with repeats. */
export const sequence = (rng: Rng, vocabulary: readonly string[], count: number): string[] =>
  Array.from({ length: count }, () => vocabulary[Math.floor(rng() * vocabulary.length)] as string);

export const cosine = (a: readonly number[], b: readonly number[]): number => {
  const dot = a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
  const norm = (v: readonly number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return dot / (norm(a) * norm(b));
};

/* ------------------------------------------------------------------------------------------------------
 * Personal data
 * ---------------------------------------------------------------------------------------------------- */

const digitsOf = (text: string) => text.replace(/\D/g, '');

/** The remainder of a long digit string by 97, computed piece by piece. */
function mod97(digits: string): number {
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
  return rest;
}

const letterValues = (text: string) =>
  [...text.toUpperCase()].map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch)).join('');

/** An IBAN of the given country with the two check digits that make its checksum valid. */
export function iban(country: string, body: string): string {
  const check = 98 - mod97(letterValues(`${body}${country}00`));
  return `${country}${String(check).padStart(2, '0')}${body}`;
}

/** The same IBAN with its last digit changed, so that its checksum no longer holds. */
export function brokenIban(valid: string): string {
  const last = Number(valid.slice(-1));
  return `${valid.slice(0, -1)}${(last + 1) % 10}`;
}

/** A Belgian national register number (digits only) for a birth date and a serial, with its two check digits. */
export function nationalNumber(year: number, month: number, day: number, serial: number): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const head = `${two(year % 100)}${two(month)}${two(day)}${String(serial).padStart(3, '0')}`;
  const base = year >= 2000 ? Number(`2${head}`) : Number(head);
  const check = 97 - (base % 97);
  return `${head}${two(check)}`;
}

export const grouped4 = (text: string) =>
  text
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
export const dottedNational = (n: string) =>
  `${n.slice(0, 2)}.${n.slice(2, 4)}.${n.slice(4, 6)}-${n.slice(6, 9)}.${n.slice(9, 11)}`;
export { digitsOf };
