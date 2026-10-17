/**
 * Personal data patterns, the same as the repository leak guard (tools/guard/guard.mjs), rewritten in
 * TypeScript: IBANs with a valid checksum, Belgian national register numbers with a valid check, phone
 * numbers in international form and Belgian mobiles, and email addresses. Fictional data passes: emails
 * at example.com, example.org, example.net, localhost and the .example, .test, .invalid and .localhost
 * domains, and phones in the reserved NANP range 555 0100 to 0199.
 */

export type PiiKind = 'iban' | 'national_number' | 'phone' | 'email';

export const PII_KINDS: readonly PiiKind[] = ['iban', 'national_number', 'phone', 'email'];

export type PiiFinding = { kind: PiiKind; value: string; offset: number };

/** ISO 13616 IBAN length per country. */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HN: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?:[  ]?[A-Z0-9]){10,32}/g;
const NATIONAL_CANDIDATE = /(?<![\d.])\d{2}\.?\d{2}\.?\d{2}[-. ]?\d{3}[-. ]?\d{2}(?!\d)/g;
const INTERNATIONAL_PHONE = /(?<![\w+])\+[1-9][\d \-().]{6,22}\d/g;
const BELGIAN_MOBILE = /(?<![\d+])(?:00 ?32 ?|0)4[5-9]\d(?:[ ./-]?\d{2}){3}(?!\d)/g;

function isLocalChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 46 || // .
    code === 95 || // _
    code === 37 || // %
    code === 43 || // +
    code === 45 // -
  );
}

function isLabelChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45
  );
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * The end of the domain that follows an `@` at `at`, or -1 when none does. A domain is a first label, any
 * number of dot-and-label groups, then a dot and at least two letters: the last group whose label opens with
 * two letters ends the match after those letters. One pass over the domain characters.
 */
function domainEnd(text: string, at: number): number {
  let i = at + 1;
  const first = i;
  while (i < text.length && isLabelChar(text.charCodeAt(i))) i++;
  if (i === first) return -1;
  let end = -1;
  while (i + 1 < text.length && text.charCodeAt(i) === 46 && isLabelChar(text.charCodeAt(i + 1))) {
    const label = i + 1;
    let letters = label;
    while (letters < text.length && isLetter(text.charCodeAt(letters))) letters++;
    let stop = letters;
    while (stop < text.length && isLabelChar(text.charCodeAt(stop))) stop++;
    if (letters - label >= 2) end = letters;
    i = stop;
  }
  return end;
}

/**
 * Every email-shaped match of a text, left to right, as the pattern
 * `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}` finds them, in time linear in the text:
 * a run of local-part characters can only match when the `@` follows it directly, so each run is read once
 * and each domain is read once.
 */
export function emailMatches(text: string): { value: string; index: number }[] {
  const found: { value: string; index: number }[] = [];
  let last = 0;
  let i = 0;
  while (i < text.length) {
    if (!isLocalChar(text.charCodeAt(i))) {
      i++;
      continue;
    }
    const runStart = i;
    while (i < text.length && isLocalChar(text.charCodeAt(i))) i++;
    if (i >= text.length || text.charCodeAt(i) !== 64) continue;
    const start = Math.max(runStart, last);
    const end = domainEnd(text, i);
    if (end < 0 || start >= i) continue;
    found.push({ value: text.slice(start, end), index: start });
    last = end;
  }
  return found;
}

const ALLOWED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'localhost']);
const ALLOWED_EMAIL_SUFFIXES = ['.example', '.test', '.invalid', '.localhost', 'users.noreply.github.com'];
const ALLOWED_EMAILS = new Set(['git@github.com']);

/** Remainder of a long decimal string divided by 97. */
export function mod97(digits: string): number {
  let remainder = 0;
  for (const char of digits) remainder = (remainder * 10 + (char.charCodeAt(0) - 48)) % 97;
  return remainder;
}

function lettersToDigits(text: string): string {
  let out = '';
  for (const char of text) out += /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
  return out;
}

/** True when the text is an IBAN of the right length for its country with a valid checksum. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/[\s ]/g, '').toUpperCase();
  const length = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!length || iban.length !== length || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  return mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/** True when 11 digits form a Belgian national register number: a plausible date and a valid check. */
export function isValidNationalNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const monthOk = month <= 12 || (month >= 20 && month <= 32) || (month >= 40 && month <= 52);
  if (!monthOk || day > 31) return false;
  const base = Number(digits.slice(0, 9));
  const check = Number(digits.slice(9));
  return 97 - (base % 97) === check || 97 - ((2_000_000_000 + base) % 97) === check;
}

/** True for the fictional NANP range: +1, an optional area code, 555, then 0100 to 0199. */
export function isFictionalPhone(digits: string): boolean {
  return /^1(\d{3})?55501\d{2}$/.test(digits);
}

/** True when an email address is fictional or technical, never a person's. */
export function isAllowedEmail(address: string): boolean {
  const lower = address.toLowerCase();
  if (ALLOWED_EMAILS.has(lower)) return true;
  const domain = lower.slice(lower.lastIndexOf('@') + 1);
  return (
    ALLOWED_EMAIL_DOMAINS.has(domain) || ALLOWED_EMAIL_SUFFIXES.some((suffix) => domain.endsWith(suffix))
  );
}

export type ScanOptions = {
  /**
   * `exclude` (default): reserved domains (example.org, .test and the like) are fictional and never findings.
   * `include`: they are findings too, for a comparison with a detector that does not know the convention. Technical
   * addresses such as git@github.com stay excluded either way.
   */
  reservedDomains?: 'exclude' | 'include';
};

/** Every piece of personal data in a text, in order of appearance. */
export function scanPii(text: string, options: ScanOptions = {}): PiiFinding[] {
  const findings: PiiFinding[] = [];
  for (const match of text.matchAll(IBAN_CANDIDATE)) {
    const compact = match[0].replace(/[\s ]/g, '');
    const length = IBAN_LENGTHS[compact.slice(0, 2)];
    if (length && compact.length >= length && isValidIban(compact.slice(0, length))) {
      findings.push({ kind: 'iban', value: compact.slice(0, length), offset: match.index });
    }
  }
  for (const match of text.matchAll(NATIONAL_CANDIDATE)) {
    if (isValidNationalNumber(match[0])) {
      findings.push({ kind: 'national_number', value: match[0], offset: match.index });
    }
  }
  for (const match of text.matchAll(INTERNATIONAL_PHONE)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15 && !isFictionalPhone(digits)) {
      findings.push({ kind: 'phone', value: match[0].trim(), offset: match.index });
    }
  }
  for (const match of text.matchAll(BELGIAN_MOBILE)) {
    findings.push({ kind: 'phone', value: match[0], offset: match.index });
  }
  for (const match of emailMatches(text)) {
    const excluded =
      options.reservedDomains === 'include'
        ? ALLOWED_EMAILS.has(match.value.toLowerCase())
        : isAllowedEmail(match.value);
    if (!excluded) findings.push({ kind: 'email', value: match.value, offset: match.index });
  }
  return findings.sort((a, b) => a.offset - b.offset);
}

/** Masks a value for evidence: the first two and last two characters, bullets between. */
export function redact(value: string): string {
  const text = value.trim();
  if (text.length <= 4) return '•'.repeat(text.length);
  return `${text.slice(0, 2)}${'•'.repeat(Math.max(text.length - 4, 1))}${text.slice(-2)}`;
}
