import type { Assertion, NormaliseMap, NormaliseName, NormaliseRule } from '../schema/common';
import { isPlainObject as isRecord } from '../spec/normalize';

/**
 * The normalised-slot oracle. A rule puts the observed text and the expected text into one canonical
 * form, and the assertion compares the two forms. A paraphrase changes how an agent writes a slot value
 * (a phone with spaces, an email in capitals, `Ave` for `Avenue`) without changing the value; a rule
 * keeps such a writing from failing the block, while a different value still fails.
 */

/** Street words and their abbreviations: every key is read as its value. */
const STREET_WORDS: Record<string, string> = {
  apt: 'apartment',
  av: 'avenue',
  ave: 'avenue',
  blvd: 'boulevard',
  ct: 'court',
  dr: 'drive',
  hwy: 'highway',
  ln: 'lane',
  pkwy: 'parkway',
  pl: 'place',
  rd: 'road',
  sq: 'square',
  st: 'street',
  ste: 'suite',
  ter: 'terrace',
  wy: 'way',
};

/** The rule name and the options of a rule, written either way in a spec. */
export type RuleParts = {
  rule?: NormaliseName;
  countryCode?: string;
  /** The approved surface forms only; a form not approved never matches. */
  forms: string[];
};

export function ruleParts(rule: NormaliseRule): RuleParts {
  if (typeof rule === 'string') return { rule, forms: [] };
  return {
    ...(rule.rule ? { rule: rule.rule } : {}),
    ...(rule.country_code ? { countryCode: rule.country_code } : {}),
    forms: (rule.surface_forms ?? []).filter((form) => form.approved).map((form) => form.form),
  };
}

/** The canonical form of one text under one rule. */
export function normaliseSlot(rule: NormaliseName, text: string, countryCode?: string): string {
  switch (rule) {
    case 'digits_only':
      return text.replace(/\D/g, '');
    case 'phone_e164':
      return phoneE164(text, countryCode);
    case 'email_lower':
      return text
        .trim()
        .replace(/\.$/, '')
        .replace(/^<(.*)>$/, '$1')
        .trim()
        .replace(/^mailto:/i, '')
        .toLowerCase();
    case 'whitespace':
      return foldSpace(text);
    case 'case_fold':
      return text.toLowerCase();
    case 'address_canon':
      return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(' ')
        .filter((word) => word !== '')
        .map((word) => STREET_WORDS[word] ?? word)
        .join(' ');
  }
}

/**
 * + and the digits. A number written with + or 00 keeps its own calling code. A number written without
 * one is national: with a country code it gets that code, its leading trunk 0 dropped, unless it already
 * starts with the code and has more than 10 digits; without a country code it stays as its digits.
 */
function phoneE164(text: string, countryCode: string | undefined): string {
  const lead = text.trim().replace(/^[(\s]+/, '');
  const digits = text.replace(/\D/g, '');
  if (lead.startsWith('+')) return `+${digits}`;
  if (lead.startsWith('00')) return `+${digits.slice(2)}`;
  if (countryCode === undefined) return digits;
  if (digits.startsWith(countryCode) && digits.length > 10) return `+${digits}`;
  return `+${countryCode}${digits.replace(/^0/, '')}`;
}

/** How a surface form is compared with the observed text: case and spacing ignored, nothing else. */
function foldSpace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function foldForm(text: string): string {
  return foldSpace(text).toLowerCase();
}

/** One normalised comparison, as a verdict reports it. */
export type NormaliseStep = {
  /** The dotted path inside the compared value; empty for the value itself. */
  path: string;
  rule: string;
  raw: unknown;
  normalised: unknown;
  /** True when the observed text matched an approved surface form. */
  surfaceForm?: boolean;
};

export type NormalisedMatch = { ok: boolean; steps: NormaliseStep[] };

type PathRule = { path: string[]; rule: RuleParts };

/**
 * The rules of one compared field, from a map keyed by dotted path: the key equal to the field gives a
 * rule on the field itself, a key under it a rule on a path inside it.
 */
export function rulesFor(map: NormaliseMap | undefined, field: string): PathRule[] {
  if (!map) return [];
  const out: PathRule[] = [];
  for (const [key, rule] of Object.entries(map)) {
    const path = key.split('.');
    if (path[0] !== field) continue;
    out.push({ path: path.slice(1), rule: ruleParts(rule) });
  }
  return out;
}

/** The rules of a single value, such as a JSON path of the reply. */
export function rootRule(rule: NormaliseRule | undefined): PathRule[] {
  return rule === undefined ? [] : [{ path: [], rule: ruleParts(rule) }];
}

/** A short name for a rule in evidence: `phone_e164`, `address_canon + surface forms`. */
export function describeRule(rule: RuleParts): string {
  const parts = [rule.rule, rule.forms.length > 0 ? 'surface forms' : undefined].filter(Boolean);
  return parts.join(' + ') || 'surface forms';
}

/**
 * Compares one value with one assertion after the rules. Each rule normalises the observed value at its
 * path and every expected text at that path (a bare value, `exact`, `one_of`, `subset`, `contains`); an
 * observed text equal to an approved surface form, ignoring case and spacing, stands for the expected
 * value. A `contains` under `address_canon` matches whole words only. Regex, `nonempty` and `absent`
 * assertions take no rule: they are compared as written. With no rule this is `matchAssertion`.
 */
export function matchNormalised(
  value: unknown,
  assertion: Assertion,
  rules: PathRule[],
  match: (value: unknown, assertion: Assertion) => boolean,
): NormalisedMatch {
  if (rules.length === 0 || !takesRules(assertion)) return { ok: match(value, assertion), steps: [] };
  const steps: NormaliseStep[] = [];
  let observed = value;
  let expected: Assertion = assertion;
  for (const { path, rule } of rules) {
    const golds = expectedTexts(expected, path);
    const contains = path.length === 0 && isContains(expected);
    observed = mapAt(observed, path, (text) => {
      const step = canonObserved(text, rule, golds, contains);
      steps.push({ path: path.join('.'), rule: describeRule(rule), raw: text, ...step });
      return step.normalised;
    });
    expected = mapAssertion(expected, path, (text) => canonText(rule, text));
  }
  const root = rules.find((entry) => entry.path.length === 0)?.rule;
  if (root?.rule === 'address_canon' && isContains(expected) && typeof observed === 'string') {
    return { ok: ` ${observed} `.includes(` ${expected.contains} `), steps };
  }
  return { ok: match(observed, expected), steps };
}

function isContains(assertion: Assertion): assertion is { contains: string } {
  return typeof assertion === 'object' && assertion !== null && 'contains' in assertion;
}

function takesRules(assertion: Assertion): boolean {
  if (assertion === null || typeof assertion !== 'object') return true;
  return !('regex' in assertion || 'nonempty' in assertion || 'absent' in assertion);
}

function canonText(rule: RuleParts, text: string): string {
  return rule.rule ? normaliseSlot(rule.rule, text, rule.countryCode) : text;
}

/**
 * The observed text after the rule. An approved surface form stands for the expected text when the
 * assertion names exactly one at this path: the observed text equals the form, or, for `contains`, holds it.
 */
function canonObserved(
  text: string,
  rule: RuleParts,
  golds: string[],
  contains: boolean,
): { normalised: string; surfaceForm?: true } {
  const own = canonText(rule, text);
  const gold = golds.length === 1 ? golds[0] : undefined;
  if (rule.forms.length === 0 || gold === undefined) return { normalised: own };
  const want = canonText(rule, gold);
  if (contains ? own.includes(want) : own === want) return { normalised: own };
  const folded = foldForm(text);
  const hit = rule.forms.some((form) =>
    contains ? folded.includes(foldForm(form)) : folded === foldForm(form),
  );
  return hit ? { normalised: want, surfaceForm: true } : { normalised: own };
}

/** The expected texts an assertion names at a path. */
function expectedTexts(assertion: Assertion, path: string[]): string[] {
  const texts: string[] = [];
  const push = (value: unknown) => {
    const at = getAt(value, path);
    if (typeof at === 'string') texts.push(at);
  };
  if (assertion === null || typeof assertion !== 'object') push(assertion);
  else if ('exact' in assertion) push(assertion.exact);
  else if ('one_of' in assertion) for (const option of assertion.one_of) push(option);
  else if ('subset' in assertion) push(assertion.subset);
  else if ('contains' in assertion && path.length === 0) push(assertion.contains);
  return [...new Set(texts)];
}

function mapAssertion(assertion: Assertion, path: string[], fn: (text: string) => string): Assertion {
  if (assertion === null || typeof assertion !== 'object') {
    return typeof assertion === 'string' && path.length === 0 ? fn(assertion) : assertion;
  }
  if ('exact' in assertion) return { exact: mapAt(assertion.exact, path, fn) as typeof assertion.exact };
  if ('one_of' in assertion) {
    return { one_of: assertion.one_of.map((option) => mapAt(option, path, fn)) as typeof assertion.one_of };
  }
  if ('subset' in assertion) {
    return { subset: mapAt(assertion.subset, path, fn) as typeof assertion.subset };
  }
  if ('contains' in assertion && path.length === 0) return { contains: fn(assertion.contains) };
  return assertion;
}

function getAt(value: unknown, path: string[]): unknown {
  let at = value;
  for (const key of path) {
    if (Array.isArray(at) && /^\d+$/.test(key)) at = at[Number(key)];
    else if (isRecord(at)) at = at[key];
    else return undefined;
  }
  return at;
}

/** A copy of the value with each text at the path replaced; a list at the end of the path maps every text in it. */
function mapAt(value: unknown, path: string[], fn: (text: string) => string): unknown {
  if (path.length === 0) {
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map((item) => (typeof item === 'string' ? fn(item) : item));
    return value;
  }
  const [key, ...rest] = path as [string, ...string[]];
  if (Array.isArray(value) && /^\d+$/.test(key)) {
    const index = Number(key);
    if (index >= value.length) return value;
    return value.map((item, at) => (at === index ? mapAt(item, rest, fn) : item));
  }
  if (isRecord(value) && Object.hasOwn(value, key)) {
    return { ...value, [key]: mapAt(value[key], rest, fn) };
  }
  return value;
}

/**
 * Why a rule cannot apply to an assertion, or undefined when it can: the assertion must compare values
 * and name a text at the rule's path, and surface forms need exactly one expected text to stand for.
 */
export function normaliseProblem(
  assertion: Assertion | undefined,
  path: string[],
  rule: NormaliseRule,
): string | undefined {
  if (assertion === undefined) return 'no assertion to normalise';
  if (!takesRules(assertion)) {
    return 'a regex, nonempty or absent assertion is compared as written and takes no rule';
  }
  const texts = expectedTexts(assertion, path);
  const where = path.length === 0 ? '' : ` at ${path.join('.')}`;
  if (texts.length === 0) return `the assertion names no text${where}`;
  if (ruleParts(rule).forms.length > 0 && texts.length > 1) {
    return `surface forms need one expected text${where}; the assertion names ${texts.length}`;
  }
  return undefined;
}
