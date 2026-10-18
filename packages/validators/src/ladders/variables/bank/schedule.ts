import { hash } from './fixture';
import { canonical } from './oracle';
import type { Case } from './types';

export const maxShortPeriod = 8;

/** Separate domains keep the item permutation independent of each item's answer positions. */
export function shuffled<T>(values: readonly T[], domain: string): T[] {
  let state = hash(domain);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), state | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) throw new Error('sparse schedule');
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** Disjoint mandatory answer fields, not fixture identity or an arbitrary case label. */
export function answerClass(test: Case): string {
  if (test.truth.kind === 'validation')
    return canonical([test.truth.ok, test.truth.issues.map((issue) => issue.code).sort()]);
  if (test.truth.kind === 'quotes') return canonical(test.truth.issues.map((issue) => issue.code).sort());
  if (test.request.operation !== 'plan') throw new Error('plan truth/request mismatch');
  return canonical([test.request.store.agent, test.request.store.version, test.request.options.seed]);
}

/** A conflicting residue rules out every word of this period, at every offset. */
export function contradictsPeriod(classes: readonly string[], period: number): boolean {
  return classes.some((label, i) => i >= period && label !== classes[i - period]);
}

export function scheduleCases(cases: readonly Case[], seed: number, itemId: string): Case[] {
  if (new Set(cases.map((test) => test.request.operation)).size !== 1)
    throw new Error('case schedule requires one operation per item');
  // Keep every original case once. Repeat the smallest contrasting inputs so the scale
  // fixture retains all 1x/10x/100x probes without multiplying its expensive 100x calls.
  const bySize = cases
    .map((test) => ({ test, size: canonical(test.request).length }))
    .sort((a, b) => a.size - b.size)
    .map((entry) => entry.test);
  const first = bySize[0];
  const other = bySize.find((test) => first && answerClass(test) !== answerClass(first));
  if (!first || !other) throw new Error(`no contrasting answer classes: ${itemId}`);
  const expanded = [...cases];
  while (expanded.length < 2 * maxShortPeriod + 1) expanded.push(expanded.length % 2 ? first : other);
  for (let attempt = 0; attempt < 128; attempt++) {
    const result = shuffled(expanded, `case-order:${seed}:${itemId}:${attempt}`);
    const labels = result.map(answerClass);
    if (Array.from({ length: maxShortPeriod }, (_, i) => i + 1).every((p) => contradictsPeriod(labels, p)))
      return result;
  }
  throw new Error(`could not construct an aperiodic schedule: ${itemId}`);
}
