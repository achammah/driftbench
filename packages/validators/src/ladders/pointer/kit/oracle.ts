import type { CutResult, CutUnit } from '../sut/port';
import type { TruthUnit } from './compose';
import { norm } from './norm';

/** A short, quoted preview of a text for an item detail. */
export function show(text: string, limit = 48): string {
  const flat = text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  return JSON.stringify(flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat);
}

const EXACT_SPAN = new Set(['sentence', 'fence', 'comment']);

export type CutCheck = {
  /** Skip the container class comparison (a hostile item that only wants coverage). */
  anyContainer?: boolean;
  /** Skip the path comparison. */
  anyPath?: boolean;
};

/** Describes one reader unit for a detail line. */
function describe(unit: Pick<CutUnit, 'container' | 'start' | 'end' | 'text'>): string {
  return `${unit.container} [${unit.start},${unit.end}) ${show(unit.text)}`;
}

/**
 * The exact cut of docs/validators.md section 12 for the pointer bank: the reader's units equal the composer's
 * truth in order and count; per unit the container is equal, the text is the source slice, the text equals the
 * truth in the fingerprint normal form, the span lies inside the construct, and spans never overlap. Returns the
 * first problem, or undefined.
 */
export function compareCut(
  source: string,
  got: CutResult,
  truth: readonly TruthUnit[],
  check: CutCheck = {},
): string | undefined {
  const units = got.units;
  if (typeof got.cutDigest !== 'string' || got.cutDigest === '') return 'the cut returned no digest';
  let previousEnd = -1;
  for (const [index, unit] of units.entries()) {
    if (unit.text !== source.slice(unit.start, unit.end)) {
      return `unit ${index} (${describe(unit)}) is not the source slice of its span`;
    }
    if (unit.end <= unit.start) return `unit ${index} (${describe(unit)}) is empty`;
    if (unit.start < previousEnd) return `unit ${index} (${describe(unit)}) overlaps the unit before it`;
    previousEnd = unit.end;
    if (typeof unit.fp !== 'string' || unit.fp === '') return `unit ${index} has no fingerprint`;
  }
  if (units.length !== truth.length) {
    const lost = truth.filter(
      (t) => !units.some((u) => norm(u.text, t.container) === norm(t.text, t.container)),
    );
    const extra = units.filter(
      (u) => !truth.some((t) => norm(u.text, t.container) === norm(t.text, t.container)),
    );
    const parts = [`${units.length} units, the composer planted ${truth.length}`];
    if (lost[0]) parts.push(`lost ${describe(lost[0])}`);
    if (extra[0]) parts.push(`extra ${describe(extra[0])}`);
    return parts.join('; ');
  }
  for (const [index, want] of truth.entries()) {
    const unit = units[index] as CutUnit;
    if (!check.anyContainer && unit.container !== want.container) {
      return `unit ${index}: expected ${want.container} ${show(want.text)}, got ${describe(unit)}`;
    }
    if (norm(unit.text, want.container) !== norm(want.text, want.container)) {
      return `unit ${index}: expected ${show(norm(want.text, want.container))}, got ${show(norm(unit.text, want.container))}`;
    }
    if (EXACT_SPAN.has(want.container)) {
      if (unit.start !== want.start || unit.end !== want.end) {
        return `unit ${index} (${want.container}): expected span [${want.start},${want.end}), got [${unit.start},${unit.end})`;
      }
    } else if (unit.start < want.region[0] || unit.end > want.region[1]) {
      return `unit ${index} (${want.container}): span [${unit.start},${unit.end}) is outside its construct [${want.region[0]},${want.region[1]})`;
    }
    if (!check.anyPath && JSON.stringify(unit.path) !== JSON.stringify(want.path)) {
      return `unit ${index}: expected heading path ${JSON.stringify(want.path)}, got ${JSON.stringify(unit.path)}`;
    }
  }
  return undefined;
}

/** True when every non-white-space character of the text lies in a unit span or a structure range. */
export function coverageGap(
  text: string,
  units: readonly Pick<CutUnit, 'start' | 'end'>[],
  structure: ReadonlyArray<[number, number]>,
): { offset: number; char: string } | undefined {
  const covered = new Uint8Array(text.length);
  for (const unit of units) covered.fill(1, unit.start, unit.end);
  for (const [a, b] of structure) covered.fill(1, a, b);
  for (let i = 0; i < text.length; i += 1) {
    if (covered[i] === 1) continue;
    const char = text[i] as string;
    if (!/\s/.test(char) && char !== '﻿') return { offset: i, char };
  }
  return undefined;
}
