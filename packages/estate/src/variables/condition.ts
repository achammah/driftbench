import { INVARIANT_LIMITS, type InvariantLimit } from '../scan/invariants';
import type { Atom } from '../schema';

/**
 * A numeric condition of an atom, read from a field and nowhere else. No word of a situation or a quote is
 * matched: "more than two days" in prose makes no condition. Two fields give one:
 *
 * - `fields.condition`, in the shape of a store boundary: `{ limit, comparison, unit? }`, where the comparison
 *   is `lt`, `le`, `gt` or `ge` and says how the quantity is compared with the limit for the condition to hold.
 *   A reader that finds a number (a structured file, or the labels of the pointer reader) writes it there;
 * - the limit an invariant check measures: an invariant atom whose `fields.check` is declared in
 *   `INVARIANT_LIMITS` (beside the checks, in the scan) carries its limit in the field the declaration names,
 *   and the declaration gives the comparison and the unit. The feed names no check: a check that measures a
 *   limit declares it, and every such invariant gives a condition.
 */

export type Comparison = 'lt' | 'le' | 'gt' | 'ge';
export type Condition = { limit: number; comparison: Comparison; unit?: string };

const COMPARISONS: ReadonlySet<string> = new Set(['lt', 'le', 'gt', 'ge']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The condition `fields.condition` holds, or undefined when it is not exactly `{ limit, comparison, unit? }`. */
function declared(value: unknown): Condition | undefined {
  if (!isRecord(value)) return undefined;
  const extra = Object.keys(value).filter((key) => !['limit', 'comparison', 'unit'].includes(key));
  const { limit, comparison, unit } = value;
  if (extra.length > 0 || typeof limit !== 'number' || !Number.isFinite(limit)) return undefined;
  if (typeof comparison !== 'string' || !COMPARISONS.has(comparison)) return undefined;
  if (unit !== undefined && (typeof unit !== 'string' || unit === '')) return undefined;
  return { limit, comparison: comparison as Comparison, ...(unit === undefined ? {} : { unit }) };
}

/** The condition of an atom, with a base for its variable id, or undefined when its fields hold none. */
export function conditionOf(
  atom: Atom,
  limits: readonly InvariantLimit[] = INVARIANT_LIMITS,
): (Condition & { base: string }) | undefined {
  const fields = atom.fields ?? {};
  const own = declared(fields.condition);
  if (own !== undefined) return { ...own, base: atom.id };
  if (atom.kind !== 'invariant') return undefined;
  const rule = limits.find((candidate) => candidate.check === fields.check);
  const limit = rule === undefined ? undefined : fields[rule.limit];
  if (rule !== undefined && typeof limit === 'number' && Number.isFinite(limit)) {
    return {
      limit,
      comparison: rule.comparison,
      ...(rule.unit === undefined ? {} : { unit: rule.unit }),
      base: rule.check,
    };
  }
  return undefined;
}
