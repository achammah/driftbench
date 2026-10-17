import { invalid, isRecord } from './args';

/**
 * Value assertions with the forms of the spec's `Assertion` (core `schema/common.ts`): a bare string,
 * number, boolean or null means equal; `exact`, `regex`, `contains`, `one_of`, `nonempty`, `absent`
 * and `subset` name the other forms. Patterns compile with the `m` flag, like every spec pattern.
 *
 * Equality is passed in, because a kind decides what equal means for its values: JSON compares
 * strictly, a spreadsheet cell compares numbers with a small relative tolerance, a CSV cell is text that
 * reads as a number when the spec expects one.
 */

export type Assertion =
  | string
  | number
  | boolean
  | null
  | { exact: unknown }
  | { regex: string }
  | { contains: string }
  | { one_of: unknown[] }
  | { nonempty: true }
  | { absent: true }
  | { subset: Record<string, unknown> };

/** A value as a check found it. `present` is false for a missing JSON key or an empty cell. */
export type Found = { present: boolean; value: unknown };

export type Equality = (expected: unknown, found: unknown) => boolean;

const FORMS = ['exact', 'regex', 'contains', 'one_of', 'nonempty', 'absent', 'subset'];

/** Checks the shape of an assertion written in a check, and returns it. */
export function parseAssertion(raw: unknown, what: string): Assertion {
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) invalid(`has ${what} that is not a finite number`);
    return raw;
  }
  const usage = `${what} must be a value or one mapping of ${FORMS.join(', ')}`;
  if (Array.isArray(raw)) invalid(`has a list as ${what}; write { exact: [...] } to compare a list`);
  if (!isRecord(raw)) return invalid(usage);
  const keys = Object.keys(raw);
  const [form] = keys;
  if (keys.length !== 1 || form === undefined || !FORMS.includes(form)) return invalid(usage);
  const value = raw[form];
  switch (form) {
    case 'regex':
      if (typeof value !== 'string' || value.length === 0) invalid(`has ${what} with an empty regex`);
      try {
        new RegExp(value, 'm');
      } catch (cause) {
        invalid(
          `has ${what} with an invalid regex: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      break;
    case 'contains':
      if (typeof value !== 'string' || value.length === 0) invalid(`has ${what} with an empty contains`);
      break;
    case 'one_of':
      if (!Array.isArray(value) || value.length === 0) invalid(`has ${what} with an empty one_of`);
      break;
    case 'nonempty':
    case 'absent':
      if (value !== true) invalid(`has ${what} with ${form} other than true`);
      break;
    case 'subset':
      if (!isRecord(value)) invalid(`has ${what} with a subset that is not a mapping`);
      break;
  }
  return raw as Assertion;
}

/** Checks a list of assertions, such as the `values` of a cells check; the list may not be empty. */
export function parseAssertions(raw: readonly unknown[], what: string): Assertion[] {
  if (raw.length === 0) invalid(`needs at least one ${what}`);
  return raw.map((value, index) => parseAssertion(value, `${what} ${index + 1}`));
}

/** True when the found value satisfies the assertion. */
export function holds(assertion: Assertion, found: Found, equal: Equality): boolean {
  if (!isRecord(assertion)) return equal(assertion, found.value);
  if ('exact' in assertion) return equal(assertion.exact, found.value);
  if ('one_of' in assertion) return assertion.one_of.some((option) => equal(option, found.value));
  if ('absent' in assertion) return !found.present;
  if ('nonempty' in assertion) return found.present && !isEmpty(found.value);
  if ('subset' in assertion) return found.present && isSubset(assertion.subset, found.value);
  const text = asText(found);
  if (text === undefined) return false;
  if ('regex' in assertion) return new RegExp(assertion.regex, 'm').test(text);
  return text.includes(assertion.contains);
}

/** Text, number and boolean values read as text for regex and contains; other values never match. */
function asText(found: Found): string | undefined {
  if (!found.present) return undefined;
  const { value } = found;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * docs/reference/checks.md "Assertions on values": not `null`, not a string of spaces only, not an empty list,
 * not a mapping whose keys hold nothing (a key holds nothing when its own value does). `0` and `false` are values.
 */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.values(value).every(isEmpty);
  return false;
}

/**
 * True when `found` is a mapping that holds at least the keys of `expected` with the same values. A
 * nested mapping is itself a subset; a list matches a list of the same length, item by item, with the
 * same rule; any other value is compared strictly.
 */
export function isSubset(expected: Record<string, unknown>, found: unknown): boolean {
  return subsetDiff(expected, found, 1).length === 0;
}

/** Where `found` departs from the subset `expected`, as evidence lines, the first `limit` of them. */
export function subsetDiff(expected: Record<string, unknown>, found: unknown, limit = 5): string[] {
  const problems: string[] = [];
  const at = (path: string, key: string | number): string =>
    typeof key === 'number' ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`;
  const compare = (want: unknown, got: unknown, path: string): void => {
    if (problems.length >= limit) return;
    const where = path === '' ? 'the root' : path;
    if (isRecord(want)) {
      if (!isRecord(got)) {
        problems.push(`${where} is ${showValue(got)}, expected a mapping`);
        return;
      }
      for (const [key, value] of Object.entries(want)) {
        if (!Object.hasOwn(got, key)) problems.push(`missing ${at(path, key)}`);
        else compare(value, got[key], at(path, key));
        if (problems.length >= limit) return;
      }
      return;
    }
    if (Array.isArray(want)) {
      if (!Array.isArray(got)) problems.push(`${where} is ${showValue(got)}, expected a list`);
      else if (got.length !== want.length)
        problems.push(`${where} has ${got.length} items, expected ${want.length}`);
      else {
        for (const [index, item] of want.entries()) compare(item, got[index], at(path, index));
      }
      return;
    }
    if (want !== got) problems.push(`${where} is ${showValue(got)}, expected ${showValue(want)}`);
  };
  compare(expected, found, '');
  return problems.slice(0, limit);
}

/** Strict deep equality of JSON values. */
export const jsonEqual: Equality = (expected, found) => {
  if (expected === found) return true;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(found) &&
      found.length === expected.length &&
      expected.every((item, index) => jsonEqual(item, found[index]))
    );
  }
  if (isRecord(expected)) {
    if (!isRecord(found)) return false;
    const keys = Object.keys(expected);
    return (
      keys.length === Object.keys(found).length &&
      keys.every((key) => Object.hasOwn(found, key) && jsonEqual(expected[key], found[key]))
    );
  }
  return false;
};

/** Numbers equal within a relative tolerance of 1e-9: a spreadsheet stores binary floats. */
export function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** How evidence names what an assertion expects. */
export function describeAssertion(assertion: Assertion): string {
  if (!isRecord(assertion)) return showValue(assertion);
  if ('exact' in assertion) return showValue(assertion.exact);
  if ('regex' in assertion) return `a match for /${assertion.regex}/`;
  if ('contains' in assertion) return `a text containing ${JSON.stringify(assertion.contains)}`;
  if ('one_of' in assertion) return `one of ${assertion.one_of.map(showValue).join(', ')}`;
  if ('nonempty' in assertion) return 'a value that is not empty';
  if ('absent' in assertion) return 'nothing';
  return `a mapping holding ${JSON.stringify(assertion.subset)}`;
}

/** How evidence shows a value: texts quoted, so a number stored as text reads apart from a number. */
export function showValue(value: unknown): string {
  if (value === undefined) return '(absent)';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return clip(JSON.stringify(value) ?? String(value), 120);
}

/** Cuts a long text for evidence and says so. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}... (${text.length} characters)`;
}

/** Lists items for evidence, the first `max` of them and how many more. */
export function listed(items: readonly string[], max = 12): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}
