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

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string };

/** Evaluates a spreadsheet formula (with or without its leading `=`) over named inputs. */
export function evaluateFormula(formula: string, inputs: Readonly<Record<string, number>>): number {
  const tokens = tokenize(formula.trim().replace(/^=/, ''));
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const expectOp = (op: string) => {
    const token = next();
    if (token?.kind !== 'op' || token.value !== op) throw new Error(`expected ${op} in ${formula}`);
  };
  const lookup = (name: string): number => {
    const found = inputs[name] ?? inputs[name.toUpperCase()];
    if (found === undefined) throw new Error(`${name} is not an input`);
    return found;
  };
  const range = (from: string, to: string): number[] => {
    const a = cell(from);
    const b = cell(to);
    if (a === undefined || b === undefined) throw new Error(`${from}:${to} is not a range of cells`);
    const values: number[] = [];
    for (let column = Math.min(a.column, b.column); column <= Math.max(a.column, b.column); column += 1) {
      for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
        values.push(lookup(`${columnName(column)}${row}`));
      }
    }
    return values;
  };
  const args = (): number[] => {
    expectOp('(');
    const values: number[] = [];
    if (peek()?.kind === 'op' && peek()?.value === ')') {
      next();
      return values;
    }
    for (;;) {
      const first = peek();
      const second = tokens[at + 1];
      const third = tokens[at + 2];
      if (first?.kind === 'name' && second?.kind === 'op' && second.value === ':' && third?.kind === 'name') {
        at += 3;
        values.push(...range(first.value, third.value));
      } else {
        values.push(sum());
      }
      const token = next();
      if (token?.kind === 'op' && token.value === ')') return values;
      if (token?.kind !== 'op' || token.value !== ',') throw new Error(`expected , or ) in ${formula}`);
    }
  };
  const call = (name: string): number => {
    const values = args();
    switch (name.toUpperCase()) {
      case 'SUM':
        return values.reduce((total, item) => total + item, 0);
      case 'MIN':
        return Math.min(...values);
      case 'MAX':
        return Math.max(...values);
      case 'AVERAGE':
        if (values.length === 0) throw new Error('AVERAGE of nothing');
        return values.reduce((total, item) => total + item, 0) / values.length;
      case 'ABS':
        return Math.abs(values[0] ?? Number.NaN);
      case 'ROUND': {
        const places = values[1] ?? 0;
        const factor = 10 ** places;
        return Math.round((values[0] ?? Number.NaN) * factor) / factor;
      }
      default:
        throw new Error(`the function ${name} is not supported`);
    }
  };
  const atom = (): number => {
    const token = next();
    if (token === undefined) throw new Error(`unexpected end of ${formula}`);
    if (token.kind === 'number') return token.value;
    if (token.kind === 'name') {
      if (peek()?.kind === 'op' && peek()?.value === '(') return call(token.value);
      return lookup(token.value);
    }
    if (token.value === '(') {
      const inner = sum();
      expectOp(')');
      return inner;
    }
    if (token.value === '-') return -power();
    if (token.value === '+') return power();
    throw new Error(`unexpected ${token.value} in ${formula}`);
  };
  const power = (): number => {
    const base = atom();
    if (peek()?.kind === 'op' && peek()?.value === '^') {
      next();
      return base ** power();
    }
    return base;
  };
  const product = (): number => {
    let total = power();
    for (
      let token = peek();
      token?.kind === 'op' && (token.value === '*' || token.value === '/');
      token = peek()
    ) {
      next();
      const right = power();
      total = token.value === '*' ? total * right : total / right;
    }
    return total;
  };
  const sum = (): number => {
    let total = product();
    for (
      let token = peek();
      token?.kind === 'op' && (token.value === '+' || token.value === '-');
      token = peek()
    ) {
      next();
      const right = product();
      total = token.value === '+' ? total + right : total - right;
    }
    return total;
  };
  const result = sum();
  if (at !== tokens.length) throw new Error(`unexpected ${show(tokens[at]?.value)} in ${formula}`);
  return result;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_.$]*)|([-+*/^(),:]))/y;
  let at = 0;
  while (at < text.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (match === null) {
      if (/^\s*$/.test(text.slice(at))) break;
      throw new Error(`cannot read ${text.slice(at)}`);
    }
    at = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: 'name', value: match[2].replace(/\$/g, '') });
    else if (match[3] !== undefined) tokens.push({ kind: 'op', value: match[3] });
  }
  return tokens;
}

function cell(name: string): { column: number; row: number } | undefined {
  const match = /^([A-Za-z]+)(\d+)$/.exec(name);
  if (match === null) return undefined;
  let column = 0;
  for (const letter of (match[1] as string).toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { column, row: Number(match[2]) };
}

function columnName(column: number): string {
  let name = '';
  for (let left = column; left > 0; left = Math.floor((left - 1) / 26)) {
    name = String.fromCharCode(65 + ((left - 1) % 26)) + name;
  }
  return name;
}
