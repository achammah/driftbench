import { readdirSync, readFileSync, statSync } from 'node:fs';
import ts from 'typescript';

/**
 * The reader census of the emission-equivalence proof: the pinned list of every place in the evaluator roots that
 * reads a field the proof deletes. It counts reads in code only.
 *
 * - `codeView` keeps the code of a source text, one line for one line: comments, the text of string literals, of
 *   template literals and of regular expressions become blanks, and the expressions inside a template stay. A word
 *   in a comment or a message is never a reader.
 * - `blockOptionReads` finds the reads of the `block` option of a custom check by what the receiver is bound to,
 *   never by what it is called: the options argument of a custom check, a value derived from it, and a
 *   parameter that receives such a value. A parameter named `entry` over another value is not a reader.
 */

/** The text with comments and the text of literals blanked; line breaks and the length are kept. */
export function codeView(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const out = [...text];
  const blank = (from: number, to: number) => {
    for (let at = from; at < to; at += 1) if (out[at] !== '\n' && out[at] !== '\r') out[at] = ' ';
  };
  // Open template spans, each with the depth of braces opened inside its current expression.
  const templates: number[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();
    switch (token) {
      case ts.SyntaxKind.SingleLineCommentTrivia:
      case ts.SyntaxKind.MultiLineCommentTrivia:
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        blank(start, end);
        break;
      case ts.SyntaxKind.SlashToken:
      case ts.SyntaxKind.SlashEqualsToken: {
        // A slash that starts a regular expression: the scanner cannot tell, the parser can. Rescan when the
        // previous significant token cannot end an expression.
        if (startsRegex(out, start)) {
          const rescanned = scanner.reScanSlashToken();
          if (rescanned === ts.SyntaxKind.RegularExpressionLiteral) blank(start, scanner.getTokenEnd());
        }
        break;
      }
      case ts.SyntaxKind.TemplateHead:
        blank(start, end);
        templates.push(0);
        break;
      case ts.SyntaxKind.OpenBraceToken:
        if (templates.length > 0) templates[templates.length - 1] = (templates.at(-1) ?? 0) + 1;
        break;
      case ts.SyntaxKind.CloseBraceToken:
        if (templates.length > 0) {
          if ((templates.at(-1) ?? 0) > 0) {
            templates[templates.length - 1] = (templates.at(-1) ?? 0) - 1;
          } else {
            const next = scanner.reScanTemplateToken(false);
            blank(start, scanner.getTokenEnd());
            if (next === ts.SyntaxKind.TemplateTail) templates.pop();
            else void next;
          }
        }
        break;
      default:
        break;
    }
  }
  return out.join('');
}

/** Whether the slash at `at` opens a regular expression: the code before it cannot end an expression. */
function startsRegex(view: readonly string[], at: number): boolean {
  let back = at - 1;
  while (back >= 0 && /\s/.test(view[back] as string)) back -= 1;
  if (back < 0) return true;
  const before = view[back] as string;
  if (/[\w$)\]]/.test(before)) {
    // A word before the slash is an operand unless it is a keyword that takes one.
    const word = /[A-Za-z_$][\w$]*$/.exec(view.slice(Math.max(0, back - 12), back + 1).join(''))?.[0];
    return (
      word !== undefined && ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw'].includes(word)
    );
  }
  return true;
}

/** Every source line of `text` whose code, comments and literal text left out, matches `pattern`. */
export function codeMatches(text: string, pattern: RegExp): string[] {
  const view = codeView(text).split('\n');
  return text
    .split('\n')
    .map((line, index) => ({ line: line.trim(), code: view[index] ?? '' }))
    .filter(({ code }) => pattern.test(code))
    .map(({ line }) => line);
}

/** Every source line of `text` whose literal text, not only its code, matches `pattern`, comments left out. */
export function textMatches(text: string, pattern: RegExp): string[] {
  const view = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !/^(\*|\/\*|\/\/)/.test(line));
  return view.filter((line) => pattern.test(line));
}

/**
 * The lines that read the `block` option of a custom check in `text`. A custom check is a function the file
 * declares with the type `CustomCheckFunction`; its second parameter is the options. A value is derived from the
 * options when its initializer mentions one, when it is a parameter of a callback given to a method of a derived
 * value, or when it is a parameter of a function of the file that receives a derived value as an argument.
 */
export function blockOptionReads(text: string, fileName = 'check.ts'): string[] {
  const options: ts.CompilerOptions = { noResolve: true, noLib: true, noEmit: true, allowJs: false };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === fileName
      ? ts.createSourceFile(name, text, languageVersion, true)
      : original(name, languageVersion, ...rest);
  host.fileExists = (name) => name === fileName;
  host.readFile = (name) => (name === fileName ? text : undefined);
  const program = ts.createProgram([fileName], options, host);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fileName);
  if (!source) return [];

  const derived = new Set<ts.Symbol>();
  const symbolOf = (node: ts.Node) => checker.getSymbolAtLocation(node);
  const mentions = (node: ts.Node): boolean => {
    let found = false;
    const visit = (child: ts.Node) => {
      if (found) return;
      if (ts.isIdentifier(child)) {
        const symbol = symbolOf(child);
        if (symbol && derived.has(symbol)) found = true;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };
  const add = (name: ts.Node): boolean => {
    if (ts.isIdentifier(name)) {
      const symbol = symbolOf(name);
      if (symbol && !derived.has(symbol)) {
        derived.add(symbol);
        return true;
      }
    }
    return false;
  };
  const functionOf = (expression: ts.Expression): ts.SignatureDeclaration | undefined => {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    )
      return functionOf(expression.expression);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
    if (!ts.isIdentifier(expression)) return undefined;
    const declaration = symbolOf(expression)?.valueDeclaration;
    if (declaration && ts.isFunctionDeclaration(declaration)) return declaration;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
    )
      return declaration.initializer;
    return undefined;
  };

  // The roots: the options parameter of every function declared as a custom check, and of the function a factory
  // declared to return one hands back.
  const isCustomCheckType = (type: ts.TypeNode | undefined) =>
    type !== undefined && /\bCustomCheckFunction\b/.test(type.getText(source));
  const root = (fn: ts.SignatureDeclaration | undefined) => {
    const second = fn?.parameters[1];
    if (second) add(second.name);
  };
  const returned = (fn: ts.SignatureDeclaration) => {
    const visitReturns = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression) root(functionOf(node.expression));
      if (node !== fn && ts.isFunctionLike(node)) return;
      ts.forEachChild(node, visitReturns);
    };
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) root(functionOf(fn.body));
    else if ('body' in fn && fn.body) visitReturns(fn.body);
  };
  // Every way a function reaches the check registry roots its options parameter: a declaration typed as a custom
  // check, a function value in an object literal typed to hold custom checks (the registry), a function (or a
  // reference to one) given to a registering call, a `satisfies` or `as` custom check, a method of such an object,
  // and the function a factory typed to return one hands back.
  const REGISTERING_CALL = /^(?:register\w*|createCustomCheck|defineCheck)$/i;
  const rootValue = (value: ts.Expression) => root(functionOf(value));
  const rootObject = (object: ts.ObjectLiteralExpression) => {
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property)) rootValue(property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) {
        // The name stands for the value in scope, not for the property the literal makes.
        const declaration = checker.getShorthandAssignmentValueSymbol(property)?.valueDeclaration;
        if (declaration && ts.isFunctionDeclaration(declaration)) root(declaration);
        else if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
          rootValue(declaration.initializer);
      } else if (ts.isMethodDeclaration(property)) root(property);
    }
  };
  const unwrap = (expression: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
  const visitRoots = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = unwrap(node.initializer);
      const fn = functionOf(initializer);
      if (isCustomCheckType(node.type)) {
        root(fn);
        if (ts.isObjectLiteralExpression(initializer)) rootObject(initializer);
      } else if (fn && isCustomCheckType(fn.type)) returned(fn);
    }
    if (ts.isFunctionDeclaration(node) && isCustomCheckType(node.type)) returned(node);
    if ((ts.isSatisfiesExpression(node) || ts.isAsExpression(node)) && isCustomCheckType(node.type)) {
      const inner = unwrap(node.expression);
      root(functionOf(inner));
      if (ts.isObjectLiteralExpression(inner)) rootObject(inner);
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : '';
      if (REGISTERING_CALL.test(callee))
        for (const argument of node.arguments) {
          rootValue(argument);
          if (ts.isObjectLiteralExpression(argument)) rootObject(argument);
        }
    }
    ts.forEachChild(node, visitRoots);
  };
  visitRoots(source);

  let changed = true;
  const step = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && mentions(node.initializer)) {
      if (add(node.name)) changed = true;
    }
    if (ts.isCallExpression(node)) {
      const callee = functionOf(node.expression);
      node.arguments.forEach((argument, index) => {
        if (callee && mentions(argument)) {
          const parameter = callee.parameters[index];
          if (parameter && add(parameter.name)) changed = true;
        }
      });
      if (ts.isPropertyAccessExpression(node.expression) && mentions(node.expression.expression)) {
        for (const argument of node.arguments) {
          const fn = functionOf(argument);
          const first = fn?.parameters[0];
          if (first && add(first.name)) changed = true;
        }
      }
    }
    ts.forEachChild(node, step);
  };
  while (changed) {
    changed = false;
    step(source);
  }

  const lines = new Set<number>();
  const receiverOf = (expression: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
      ? receiverOf(expression.expression)
      : expression;
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const collect = (node: ts.Node) => {
    const read =
      (ts.isPropertyAccessExpression(node) && node.name.text === 'block') ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'block');
    if (read) {
      const receiver = receiverOf(
        (node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression,
      );
      const symbol = ts.isIdentifier(receiver) ? symbolOf(receiver) : undefined;
      if (symbol && derived.has(symbol)) lines.add(lineOf(node));
    }
    // `const { block } = options`: the option read through a binding pattern.
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const receiver = receiverOf(node.initializer);
      const symbol = ts.isIdentifier(receiver) ? symbolOf(receiver) : undefined;
      if (symbol && derived.has(symbol))
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name;
          if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'block')
            lines.add(lineOf(element));
        }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const all = text.split('\n');
  return [...lines].sort((a, b) => a - b).map((line) => (all[line] ?? '').trim());
}

/** Every `.ts` file under the roots, in a stable order. */
export function sourceFiles(root: string, roots: readonly string[]): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    if (statSync(`${root}${path}`).isDirectory())
      for (const name of readdirSync(`${root}${path}`).sort()) visit(`${path}/${name}`);
    else if (path.endsWith('.ts')) files.push(path);
  };
  for (const entry of roots) visit(entry);
  return files;
}

/** `file: line` for every line of the roots whose code matches `pattern`; a new reader changes this list. */
export function readerCensus(root: string, roots: readonly string[], pattern: RegExp): string[] {
  return sourceFiles(root, roots).flatMap((file) =>
    codeMatches(readFileSync(`${root}${file}`, 'utf8'), pattern).map((line) => `${file}: ${line}`),
  );
}

/** `file: line` for every line of the roots whose literal text also matches `pattern`, comments left out. */
export function textCensus(root: string, roots: readonly string[], pattern: RegExp): string[] {
  return sourceFiles(root, roots).flatMap((file) =>
    textMatches(readFileSync(`${root}${file}`, 'utf8'), pattern).map((line) => `${file}: ${line}`),
  );
}

/** `file: line` for every read of a custom check's block option in the roots. */
export function blockOptionCensus(root: string, roots: readonly string[]): string[] {
  return sourceFiles(root, roots).flatMap((file) =>
    blockOptionReads(readFileSync(`${root}${file}`, 'utf8'), file).map((line) => `${file}: ${line}`),
  );
}
