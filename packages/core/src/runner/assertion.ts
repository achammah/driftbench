import type { Assertion } from '../schema/common';
import type { EndState, EndStateSpec } from '../schema/spec';
import { isPlainObject as isRecord } from '../spec/normalize';

/**
 * Assertion semantics, shared by the runner's end-state compare and any check that asserts values.
 * A bare scalar means exact equality; patterns compile with the `m` flag, as every spec pattern does.
 */
export function matchAssertion(value: unknown, assertion: Assertion): boolean {
  if (assertion === null || typeof assertion !== 'object') return deepEqual(value, assertion);
  if ('exact' in assertion) return deepEqual(value, assertion.exact);
  if ('regex' in assertion) return typeof value === 'string' && new RegExp(assertion.regex, 'm').test(value);
  if ('contains' in assertion) {
    if (typeof value === 'string') return value.includes(assertion.contains);
    return Array.isArray(value) && value.some((item) => deepEqual(item, assertion.contains));
  }
  if ('one_of' in assertion) return assertion.one_of.some((option) => deepEqual(value, option));
  if ('nonempty' in assertion) return !isBlank(value);
  if ('absent' in assertion) return value === undefined;
  return isRecord(value) && Object.entries(assertion.subset).every(([key, part]) => holds(value[key], part));
}

/** Structural equality on JSON-like values. A key whose value is undefined counts as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    const other = Object.keys(b).filter((key) => b[key] !== undefined);
    return keys.length === other.length && keys.every((key) => deepEqual(a[key], b[key]));
  }
  return Object.is(a, b);
}

export type EndStateDiff = { field: string; expected: unknown; observed: unknown };
export type EndStateMatch = { match: boolean; diff: EndStateDiff[] };

/**
 * Compares the end state the adapter read with the spec's `end_state`. `value` has the shape the checks
 * see in `CheckContext.endState`: one mapping gives the value its source returned, a list gives a record
 * keyed by source, and `none` gives the list that source `*` returned. `subset` (the default) checks the
 * listed fields; `exact` also fails every other field of the state, expected absent. One diff entry per
 * field that does not hold; in a list a field is named `<source>.<field>`. A source that recorded nothing
 * (undefined or null), or a state that is not a mapping (a string, a list), fails every expected field,
 * `{ absent: true }` assertions included; with nothing recorded an empty `expect` gives one entry for the
 * source itself, expected `{ nonempty: true }`. `none` holds when nothing was
 * recorded (undefined, null, an empty list or object) and otherwise gives one entry per payload found,
 * `*.<index>`, expected absent. A value that is absent is written `{ absent: true }`, the assertion that
 * names it, so a diff keeps its meaning through JSON, where an undefined value would vanish.
 */
export function compareEndState(endState: EndState, value: unknown): EndStateMatch {
  if (endState === 'none') {
    if (isEmpty(value)) return { match: true, diff: [] };
    const found = Array.isArray(value) ? value : [value];
    return {
      match: false,
      diff: found.map((payload, index) => ({
        field: `*.${index}`,
        expected: { absent: true },
        observed: shown(payload),
      })),
    };
  }
  const list = Array.isArray(endState);
  const entries: EndStateSpec[] = Array.isArray(endState) ? endState : [endState];
  const diff: EndStateDiff[] = [];
  for (const entry of entries) {
    const state = list ? (isRecord(value) ? value[entry.source] : undefined) : value;
    const name = (field: string) => (list ? `${entry.source}.${field}` : field);
    const expected = Object.entries(entry.expect);
    if (!isRecord(state)) {
      // Nothing recorded, or a state with no fields: no field assertion holds, as in the end_state check.
      if (expected.length === 0 && (state === undefined || state === null)) {
        diff.push({ field: entry.source, expected: { nonempty: true }, observed: { absent: true } });
      }
      for (const [field, assertion] of expected) {
        diff.push({ field: name(field), expected: assertion, observed: { absent: true } });
      }
      continue;
    }
    const record = state;
    for (const [field, assertion] of expected) {
      const observed = record?.[field];
      if (!matchAssertion(observed, assertion)) {
        diff.push({ field: name(field), expected: assertion, observed: shown(observed) });
      }
    }
    if (entry.mode === 'exact' && record) {
      for (const [field, observed] of Object.entries(record)) {
        if (observed !== undefined && !Object.hasOwn(entry.expect, field)) {
          diff.push({ field: name(field), expected: { absent: true }, observed });
        }
      }
    }
  }
  return { match: diff.length === 0, diff };
}

function shown(value: unknown): unknown {
  return value === undefined ? { absent: true } : value;
}

function holds(value: unknown, expected: unknown): boolean {
  if (isRecord(expected)) {
    return isRecord(value) && Object.entries(expected).every(([key, part]) => holds(value[key], part));
  }
  return deepEqual(value, expected);
}

/**
 * Holds nothing, for `{ nonempty: true }` (docs/reference/checks.md "Assertions on values"): nothing, a string
 * with no visible character, an empty list, or a mapping none of whose keys holds anything, at any depth. A key
 * holds nothing when its own value does. `0` and `false` are values.
 */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.values(value).every(isBlank);
}

/**
 * Empty, for `end_state: none` (nothing was recorded): nothing, a string with no visible character, an empty list, or a mapping none of whose keys
 * holds a value. A blank summary is as empty as a missing one, so `{ nonempty: true }` refuses it.
 */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  // A mapping whose keys all hold null is empty. `{ nonempty: true }` reads deeper: see isBlank.
  return isRecord(value) && Object.values(value).every((part) => part === undefined || part === null);
}
