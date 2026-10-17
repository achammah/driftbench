import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export const OPERATIONS_SOURCE = 'packages/checks/src/support/operations.ts';
export const OPERATIONS_FIXTURE = 'packages/validators/fixtures/estate/operation-vocabulary.json';

/** Finite regex branch witnesses. This parser covers literals, concatenation, alternatives,
 * groups, character classes, anchors, and ?, *, +. Repetition uses boundary lengths zero,
 * one and two; it does not claim exhaustive language coverage. Unsupported syntax is a gap. */
export function regexWitnesses(source: string, flags: string): { witnesses: string[]; gaps: string[] } {
  let at = 0;
  const gaps: string[] = [];
  const gap = (message: string) => {
    gaps.push(`${at}:${message}`);
  };
  const unique = (values: string[]) => [...new Set(values)];
  const product = (left: string[], right: string[]) => {
    if (left.length * right.length > 4096) {
      gap('expansion-exceeds-4096');
      return [];
    }
    return unique(left.flatMap((a) => right.map((b) => a + b)));
  };
  const escaped = (inClass = false): string[] => {
    const code = source[at++];
    if (code === 'b' && !inClass) return ['\u0000'];
    if (code === 's') return [' '];
    if (code === 'd') return ['0'];
    if (code === 'w') return ['x', '0'];
    if (code === 't') return ['\t'];
    if (code === 'n') return ['\n'];
    if (code !== undefined && !/[A-Za-z0-9]/.test(code)) return [code];
    gap(`unsupported-escape:${String(code)}`);
    return [];
  };
  const characterClass = (): string[] => {
    const begin = at - 1;
    const negative = source[at] === '^';
    if (negative) at += 1;
    const members: string[] = [];
    while (at < source.length && source[at] !== ']') {
      const value = source[at++];
      if (value === '\\') members.push(...escaped(true));
      else if (value === '-') {
        gap('unsupported-character-range');
        return [];
      } else if (value !== undefined) members.push(value);
    }
    if (source[at++] !== ']') gap('unclosed-character-class');
    if (!negative) return unique(members);
    const pattern = new RegExp(source.slice(begin, at));
    const choices = ['x', ' '].filter((value) => pattern.test(value));
    if (choices.length === 0) gap('no-negated-class-witness');
    return choices;
  };
  const atom = (): string[] => {
    const char = source[at++];
    if (char === undefined) return [''];
    if (char === '^' || char === '$') return [''];
    if (char === '\\') return escaped();
    if (char === '[') return characterClass();
    if (char === '(') {
      if (source.slice(at, at + 2) === '?:') at += 2;
      else if (source[at] === '?') {
        gap('unsupported-group');
        return [];
      }
      const values = alternative();
      if (source[at++] !== ')') gap('unclosed-group');
      return values;
    }
    if (char === '.') return ['x'];
    if ('{}*+?'.includes(char)) {
      gap(`unsupported-token:${char}`);
      return [];
    }
    return [char];
  };
  const sequence = (): string[] => {
    let values = [''];
    while (at < source.length && source[at] !== ')' && source[at] !== '|') {
      let next = atom();
      const quantifier = source[at];
      if (quantifier === '?' || quantifier === '*' || quantifier === '+') {
        at += 1;
        next =
          quantifier === '?'
            ? ['', ...next]
            : [...(quantifier === '*' ? [''] : []), ...next, ...product(next, next)];
      }
      values = product(values, unique(next));
    }
    return values;
  };
  const alternative = (): string[] => {
    const values = sequence();
    while (source[at] === '|') {
      at += 1;
      values.push(...sequence());
    }
    return unique(values);
  };
  const candidates = alternative();
  if (at !== source.length) gap('unconsumed-pattern');
  const pattern = new RegExp(source, flags);
  // A trailing word boundary after punctuation needs an adjacent word character.
  // Resolve zero-width boundary constraints mechanically instead of silently dropping
  // that literal branch (for example, a regex ending in a punctuation token plus \\b).
  const witnesses = unique(
    candidates.flatMap((candidate, index) => {
      const segments = candidate.split('\u0000');
      let choices = [segments[0] ?? ''];
      for (const segment of segments.slice(1))
        choices = product(
          choices,
          ['', 'x', ' '].map((boundary) => boundary + segment),
        );
      for (const witness of choices) {
        pattern.lastIndex = 0;
        if (pattern.test(witness)) return [witness];
      }
      gap(`unresolved-branch-boundary:${index}`);
      return [];
    }),
  );
  if (witnesses.length === 0) gap('no-matching-witness');
  return { witnesses, gaps: unique(gaps) };
}

export function deriveOperationVocabulary(source: string) {
  const file = ts.createSourceFile(OPERATIONS_SOURCE, source, ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      declarations.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const required = (name: string) => {
    const value = declarations.get(name);
    if (!value) throw new Error(`Missing operation vocabulary declaration: ${name}`);
    return value;
  };
  const literal = (node: ts.Node | undefined): string => {
    if (!node || !ts.isStringLiteral(node)) throw new Error('Expected literal operation vocabulary string');
    return node.text;
  };
  const array = (node: ts.Node | undefined): ts.ArrayLiteralExpression => {
    if (!node || !ts.isArrayLiteralExpression(node)) throw new Error('Expected literal vocabulary array');
    return node;
  };
  const setWords = (name: string) => {
    const node = required(name);
    if (!ts.isNewExpression(node) || node.expression.getText(file) !== 'Set')
      throw new Error(`Expected Set constructor: ${name}`);
    return array(node.arguments?.[0]).elements.map(literal);
  };
  const toolWords = array(required('TOOL_WORDS')).elements.map((entry) => {
    const pair = array(entry);
    return { class: literal(pair.elements[0]), words: array(pair.elements[1]).elements.map(literal) };
  });
  const gaps: string[] = [];
  const commandRules = array(required('COMMAND_RULES')).elements.map((entry, index) => {
    if (!ts.isObjectLiteralExpression(entry)) throw new Error('Expected command rule object');
    const properties = new Map(
      entry.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) throw new Error('Expected command rule property');
        return [property.name.getText(file), property.initializer] as const;
      }),
    );
    const pattern = properties.get('pattern');
    if (!pattern || !ts.isRegularExpressionLiteral(pattern))
      throw new Error('Expected literal command regex');
    const raw = pattern.text;
    const end = raw.lastIndexOf('/');
    const patternSource = raw.slice(1, end);
    const flags = raw.slice(end + 1);
    const derived = regexWitnesses(patternSource, flags);
    gaps.push(...derived.gaps.map((problem) => `COMMAND_RULES.${index}:${problem}`));
    const needsNoDiff = properties.get('needsNoDiff');
    if (needsNoDiff?.kind !== ts.SyntaxKind.TrueKeyword && needsNoDiff?.kind !== ts.SyntaxKind.FalseKeyword)
      throw new Error('Expected needsNoDiff boolean');
    return {
      class: literal(properties.get('class')),
      source: patternSource,
      flags,
      needsNoDiff: needsNoDiff.kind === ts.SyntaxKind.TrueKeyword,
      ...derived,
    };
  });
  // The special order noun comparison is read from classifyTool, not invented by the fixture.
  const orderNouns: string[] = [];
  let orderClass: string | undefined;
  const findOrder = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'order' &&
      node.initializer
    ) {
      const findLiteral = (part: ts.Node) => {
        if (
          ts.isCallExpression(part) &&
          ts.isPropertyAccessExpression(part.expression) &&
          part.expression.name.text === 'includes'
        )
          orderNouns.push(literal(part.arguments[0]));
        ts.forEachChild(part, findLiteral);
      };
      findLiteral(node.initializer);
    }
    if (
      ts.isIfStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      ts.isIdentifier(node.expression.left) &&
      node.expression.left.text === 'order' &&
      ts.isReturnStatement(node.thenStatement)
    )
      orderClass = literal(node.thenStatement.expression);
    ts.forEachChild(node, findOrder);
  };
  findOrder(file);
  if (!orderClass || orderNouns.length === 0) gaps.push('classifyTool.order:noun-or-class-not-derived');
  return {
    source: { path: OPERATIONS_SOURCE, sha256: createHash('sha256').update(source).digest('hex') },
    grammar: 'Literal branch expansion; repetition boundaries 0, 1, 2; unsupported syntax listed in gaps.',
    toolWords,
    readWords: setWords('READ_WORDS'),
    orderVerbs: setWords('ORDER_VERBS'),
    orderNouns: [...new Set(orderNouns)],
    orderClass,
    commandRules,
    gaps,
  };
}

export function currentOperationVocabulary(root: string) {
  return deriveOperationVocabulary(readFileSync(join(root, OPERATIONS_SOURCE), 'utf8'));
}

export function writeOperationVocabulary(root: string): void {
  writeFileSync(
    join(root, OPERATIONS_FIXTURE),
    `${JSON.stringify(currentOperationVocabulary(root), null, 2)}\n`,
  );
}
