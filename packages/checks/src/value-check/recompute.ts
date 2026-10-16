import { evaluateFormula } from '@agent-nexus/driftbench-core';
import { show } from '../support/values';
import type { Rung } from './ladder';

/**
 * Rung 1 for a computed value: recompute it. A formula or a script the agent produced is right when it computes
 * what the gold computation computes, on the inputs it was given and on changed inputs. The given inputs alone
 * prove nothing: a hard-coded number equal to today's result passes them and is wrong the day an input moves
 * (DS-1000 2.3 p.4; EvilGenie p.7). So the rung runs both computations on the seed inputs, then on `trials`
 * input sets drawn around the seed values with a fixed `seed`, and fails on the first set where they differ
 * (emitting `changed_inputs_fail` when the seed inputs agreed). Numbers compare at the object's
 * `numbers_significant_digits`, the precision the xlsx reader prints.
 *
 * Formulas are spreadsheet formulas over named inputs: numbers, cell names (`C2`) or names, `+ - * / ^`,
 * parentheses, and SUM, MIN, MAX, AVERAGE, ROUND, ABS over values or ranges (`C2:C5`).
 */

/** A computation: a formula, a constant value, or a function the caller runs (a script in a sandbox). */
export type Computation =
  | { formula: string }
  | { value: unknown }
  | { compute: (inputs: Readonly<Record<string, number>>) => unknown };

/** What the recompute rung reads. */
export type RecomputeCase = {
  /** What the agent produced: its formula, or a bare value (a hard-coded number). */
  produced: Computation;
  /** The gold computation. */
  expected: Computation;
  /** The inputs the agent was given, by name: `C2: 10`. */
  inputs: Readonly<Record<string, number>>;
  /** The range each input is drawn from on changed inputs; absent inputs vary around their seed value. */
  ranges?: Readonly<Record<string, readonly [number, number]>>;
};

export const recompute: Rung = (value, ctx) => {
  const spec = value.recompute;
  if (spec === undefined) return { skip: 'no computation to recompute' };
  const digits = numberParam(ctx.shared.numbers_significant_digits, 12);
  const trials = numberParam(ctx.params.trials, 3);
  const seed = numberParam(ctx.params.seed, 1);
  const sets = [spec.inputs, ...changedInputs(spec, trials, seed)];
  for (const [index, inputs] of sets.entries()) {
    let produced: unknown;
    let expected: unknown;
    try {
      expected = run(spec.expected, inputs);
    } catch (cause) {
      return { skip: `the gold computation fails: ${message(cause)}` };
    }
    if (typeof expected === 'number' && !Number.isFinite(expected)) {
      return { skip: `the gold computation is not a finite number on ${show(inputs)}` };
    }
    try {
      produced = run(spec.produced, inputs);
    } catch (cause) {
      return {
        settles: 'fail',
        evidence: `the produced computation fails on ${show(inputs)}: ${message(cause)}`,
      };
    }
    if (!sameNumber(produced, expected, digits)) {
      const changed = index > 0;
      return {
        settles: 'fail',
        evidence: `${describe(spec.produced)} gives ${show(produced)} where ${describe(spec.expected)} gives ${show(expected)}, on ${changed ? 'changed' : 'the given'} inputs ${show(inputs)}`,
        ...(changed ? { emits: { changed_inputs_fail: true } } : {}),
      };
    }
  }
  return {
    settles: 'pass',
    evidence: `${describe(spec.produced)} computes what ${describe(spec.expected)} computes on the given inputs and on ${trials} changed input ${trials === 1 ? 'set' : 'sets'}`,
    emits: { changed_inputs_fail: false },
  };
};

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function describe(computation: Computation): string {
  if ('formula' in computation) return computation.formula;
  if ('value' in computation) return `the constant ${show(computation.value)}`;
  return 'the script';
}

function run(computation: Computation, inputs: Readonly<Record<string, number>>): unknown {
  if ('formula' in computation) return evaluateFormula(computation.formula, inputs);
  if ('value' in computation) return computation.value;
  return computation.compute(inputs);
}

/** Equal at `digits` significant digits when both are numbers; otherwise structurally the same JSON. */
function sameNumber(a: unknown, b: unknown, digits: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
    return a.toPrecision(digits) === b.toPrecision(digits);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `trials` input sets, each input drawn uniformly from its range: the declared one, else half to one and a half
 * times its seed value (1 to 10 for a seed of 0). Integers stay integers. The draw is seeded, so it repeats.
 */
export function changedInputs(spec: RecomputeCase, trials: number, seed: number): Record<string, number>[] {
  const random = mulberry32(seed);
  const sets: Record<string, number>[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const set: Record<string, number> = {};
    for (const [name, given] of Object.entries(spec.inputs)) {
      const [low, high] = spec.ranges?.[name] ?? aroundSeed(given);
      const integer = Number.isInteger(given) && Number.isInteger(low) && Number.isInteger(high);
      let drawn = low + random() * (high - low);
      if (integer) drawn = Math.round(drawn);
      // A draw equal to the seed value would test nothing new for this input.
      if (drawn === given) drawn = integer ? (given === high ? low : given + 1) : (low + high) / 2 + 0.5;
      set[name] = drawn;
    }
    sets.push(set);
  }
  return sets;
}

function aroundSeed(value: number): [number, number] {
  if (value === 0) return [1, 10];
  const a = value * 0.5;
  const b = value * 1.5;
  const [low, high] = a < b ? [a, b] : [b, a];
  return Number.isInteger(value) ? [Math.ceil(low), Math.floor(high)] : [low, high];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export { evaluateFormula };
