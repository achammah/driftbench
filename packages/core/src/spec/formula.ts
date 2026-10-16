/**
 * Spreadsheet formulas over named inputs: numbers, cell names (`C2`) or names, `+ - * / ^`, parentheses, and
 * SUM, MIN, MAX, AVERAGE, ROUND, ABS over values or ranges (`C2:C5`). The recompute rung of the value check
 * runs them, and the spec loader checks that a gold formula computes.
 */

function show(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
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
