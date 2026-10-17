import { readdirSync, readFileSync, statSync } from 'node:fs';
import ts from 'typescript';

/**
 * The reader census of the emission-equivalence proof, found in the syntax tree and never in the text.
 *
 * A read is a property access, an element access with a literal key, or a binding pattern that takes `field` off a
 * receiver that ends in one of `receivers`: `expect.skills`, `ctx.expect?.skills`, `block.expect!.skills`,
 * `expect['skills']` and `const { skills } = ctx.expect` all read `skills` off `expect`. Comments and the text of
 * string, template and regular-expression literals are not code, so a word in them is never a read, and an
 * optional chain (`?.`) is a read like any other. A type position (`Expect['skills']`) names the field and reads
 * nothing.
 *
 * What the census does not see, so a reader of this kind needs a review by eye, not a pin:
 * - a key held in a variable or built in a template (`ctx.expect[key]`), because the tree does not know the value;
 * - a receiver reached through an alias or a default (`const e = ctx.expect; e.skills`, `(ctx.expect ?? {}).skills`,
 *   `const { skills } = ctx.expect ?? {}`), because only the name a receiver ends in is read, not what it was bound to;
 * - a nested destructuring (`const { expect: { skills } } = ctx`), a parameter pattern (`({ skills }: Expect) => ...`),
 *   a destructuring assignment (`({ skills } = ctx.expect)`) and a loop pattern, because only the declaration form
 *   `const { skills } = <receiver>` is read;
 * - a whole-object read (`{ ...ctx.expect }`, `Object.entries(ctx.expect)`, `'skills' in ctx.expect`), which takes
 *   every field without naming one;
 * - the `count` read of an entry reached by index, a call or a loop (`skills[0].count`, `pick(skills).count`,
 *   `for (const { count } of skills)`), because the receiver must be a name in `receivers`.
 * These shapes are not read by a text search either, so the census is no weaker than the one it replaces.
 */
export type FieldReads = {
  /** The names a receiver may end in: `expect` for `expect`, `ctx.expect`, `(x as Spec).expect`. */
  receivers: readonly string[];
  /** The fields read off the receiver. */
  fields: readonly string[];
};

/** The name an expression ends in, looking through parentheses, `!`, `as`, `satisfies` and type assertions. */
function endName(node: ts.Expression): string | undefined {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression;
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current) && ts.isStringLiteralLike(current.argumentExpression))
    return current.argumentExpression.text;
  return undefined;
}

/** The 0-based lines of `text` that read a field of `reads`, each line once. */
export function readLines(text: string, reads: readonly FieldReads[], fileName = 'source.ts'): number[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = new Set<number>();
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const takes = (receiver: ts.Expression, field: string) => {
    const name = endName(receiver);
    return (
      name !== undefined && reads.some((read) => read.receivers.includes(name) && read.fields.includes(field))
    );
  };
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && takes(node.expression, node.name.text))
      lines.add(lineOf(node.name));
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      if (takes(node.expression, node.argumentExpression.text)) lines.add(lineOf(node.argumentExpression));
    }
    // `const { skills } = ctx.expect`: the field taken through a binding pattern.
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && takes(node.initializer, key.text))
          lines.add(lineOf(element));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...lines].sort((a, b) => a - b);
}

/** The trimmed lines of `text` that read a field of `reads`. */
export function readSites(text: string, reads: readonly FieldReads[], fileName?: string): string[] {
  const all = text.split('\n');
  return readLines(text, reads, fileName).map((line) => (all[line] ?? '').trim());
}

/** Every `.ts` file under the roots, in a stable order. */
function sourceFiles(root: string, roots: readonly string[]): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    if (statSync(`${root}${path}`).isDirectory())
      for (const name of readdirSync(`${root}${path}`).sort()) visit(`${path}/${name}`);
    else if (path.endsWith('.ts')) files.push(path);
  };
  for (const entry of roots) visit(entry);
  return files;
}

/** `file: line` for every read of a field of `reads` in the roots; a new reader changes this list. */
export function fieldReadCensus(
  root: string,
  roots: readonly string[],
  reads: readonly FieldReads[],
): string[] {
  return sourceFiles(root, roots).flatMap((file) =>
    readSites(readFileSync(`${root}${file}`, 'utf8'), reads, file).map((line) => `${file}: ${line}`),
  );
}
