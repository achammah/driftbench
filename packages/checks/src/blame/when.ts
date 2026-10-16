/**
 * The condition grammar of blame and placement items: a map of evidence names to wanted values, all of which
 * must hold. A scalar is equality; a list is "one of"; `{ lt | lte | gt | gte: n }` compares a number; `{ not:
 * <condition> }` negates; the word `present` holds for a value that is set and not `none`. The key `any` holds
 * when one of its conditions holds. A bare word that names a param of the item, or else of the object, stands
 * for that param's value: `{ lt: bar }`, `change: altered_kinds`. A name with no value never holds, except
 * under `not`.
 */

export type Facts = Readonly<Record<string, unknown>>;
export type Params = ReadonlyArray<Readonly<Record<string, unknown>>>;

/** A word that names a param of the item or the object resolves to that param's value. */
function resolveWord(value: unknown, params: Params): unknown {
  if (typeof value !== 'string') return value;
  for (const scope of params) if (Object.hasOwn(scope, value)) return scope[value];
  return value;
}

const COMPARE = new Set(['lt', 'lte', 'gt', 'gte']);

function isOperator(want: unknown): want is Record<string, unknown> {
  if (want === null || typeof want !== 'object' || Array.isArray(want)) return false;
  const keys = Object.keys(want);
  return keys.length === 1 && (COMPARE.has(keys[0] as string) || keys[0] === 'not' || keys[0] === 'eq');
}

function same(have: unknown, want: unknown): boolean {
  if (Array.isArray(have)) return have.length === 1 && same(have[0], want);
  return have === want;
}

/** Whether one evidence value meets one wanted value. */
export function holds(have: unknown, want: unknown, params: Params): boolean {
  if (isOperator(want)) {
    const [op, raw] = Object.entries(want)[0] as [string, unknown];
    if (op === 'not') return !holds(have, raw, params);
    const bound = resolveWord(raw, params);
    if (op === 'eq') return same(have, bound);
    if (typeof have !== 'number' || typeof bound !== 'number') return false;
    if (op === 'lt') return have < bound;
    if (op === 'lte') return have <= bound;
    if (op === 'gt') return have > bound;
    return have >= bound;
  }
  const resolved = resolveWord(want, params);
  if (resolved === 'present') {
    if (have === undefined || have === null || have === 'none' || have === false) return false;
    return !(Array.isArray(have) && have.length === 0);
  }
  if (have === undefined) return false;
  if (Array.isArray(resolved)) return resolved.some((one) => same(have, one));
  return same(have, resolved);
}

/** Whether every entry of a `when` map holds over the facts. */
export function whenHolds(when: Facts, facts: Facts, params: Params): boolean {
  for (const [key, want] of Object.entries(when)) {
    if (key === 'any') {
      const list = Array.isArray(want) ? (want as Facts[]) : [];
      if (!list.some((one) => whenHolds(one, facts, params))) return false;
      continue;
    }
    if (key === 'all') {
      const list = Array.isArray(want) ? (want as Facts[]) : [];
      if (!list.every((one) => whenHolds(one, facts, params))) return false;
      continue;
    }
    if (!holds(facts[key], want, params)) return false;
  }
  return true;
}

/** The evidence names a `when` map reads, for the validator and the reference page. */
export function namesRead(when: Facts): string[] {
  const out = new Set<string>();
  for (const [key, want] of Object.entries(when)) {
    if (key === 'any' || key === 'all') {
      for (const one of Array.isArray(want) ? (want as Facts[]) : [])
        for (const name of namesRead(one)) out.add(name);
    } else {
      out.add(key);
    }
  }
  return [...out];
}
