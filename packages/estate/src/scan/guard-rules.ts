import type { EstateFile } from './reader';
import type { Located } from './text';

/** Descriptive evidence, not newly inferred instruction atoms or proof of a runtime verdict. */
export type GuardRuleSource = Located & {
  kind: 'documentation' | 'message' | 'registry';
  text: string;
};

type Literal = { start: number; end: number; text: string; documentation: boolean };
const CACHE = new WeakMap<EstateFile, GuardRuleSource[]>();

/**
 * A static, non-executing source reader. Documentation comments/docstrings and strings reaching
 * ordinary output calls or reason/message fields describe a hook. Other implementation literals
 * (paths, regexes, identifiers and payload keys) do not. A named output constant retains its source.
 */
export function guardRuleSources(file: EstateFile): GuardRuleSource[] {
  const cached = CACHE.get(file);
  if (cached) return cached;
  const source = file.text;
  const literals: Literal[] = [];
  const comments: Array<{ start: number; end: number }> = [];
  let syntax = '';
  for (let at = 0; at < source.length; ) {
    const start = at;
    const char = source[at] ?? '';
    if (char === '#' || source.slice(at, at + 2) === '//') {
      while (at < source.length && source[at] !== '\n') at++;
      comments.push({ start, end: at });
    } else if (source.slice(at, at + 2) === '/*') {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
      comments.push({ start, end: at });
    } else if (['"', "'", '`'].includes(char)) {
      const triple = source.slice(at, at + 3) === char.repeat(3);
      const width = triple ? 3 : 1;
      at += width;
      const content = at;
      while (at < source.length) {
        if (source[at] === '\\') at += 2;
        else if (source.slice(at, at + width) === char.repeat(width)) break;
        else at++;
      }
      const end = at;
      at = Math.min(source.length, at + width);
      literals.push({ start, end: at, text: source.slice(content, end), documentation: triple });
    } else {
      syntax += char;
      at++;
      continue;
    }
    syntax += source.slice(start, at).replace(/[^\n]/g, ' ');
  }

  const result: GuardRuleSource[] = [];
  const seen = new Set<string>();
  const add = (kind: GuardRuleSource['kind'], start: number, end: number, text: string) => {
    text = text.replace(/\\n/g, '\n').trim();
    if (!/\p{L}.*\s.*\p{L}/u.test(text)) return;
    const startLine = source.slice(0, start).split('\n').length;
    const endLine = source.slice(0, end).split('\n').length;
    const key = `${startLine}:${endLine}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      kind,
      text,
      file: file.path,
      startLine,
      endLine,
      quote: source
        .split('\n')
        .slice(startLine - 1, endLine)
        .join('\n')
        .trim(),
    });
  };
  for (const comment of comments) {
    const text = source.slice(comment.start, comment.end);
    if (text.startsWith('#!')) continue;
    add('documentation', comment.start, comment.end, text.replace(/^\s*(?:\/\*+|\*\/|\*|#|\/\/) ?/gm, ''));
  }
  for (const literal of literals) {
    if (literal.documentation) add('documentation', literal.start, literal.end, literal.text);
  }

  // Literal assignments can be printed through a name; never evaluate the expression.
  const constants = new Map<string, Literal[]>();
  for (const literal of literals) {
    const lead = source.slice(source.lastIndexOf('\n', literal.start - 1) + 1, literal.start);
    const name = /(?:^|\b(?:const|let|var)\s+)([A-Za-z_$][\w$]*)\s*=\s*[frbu]*$/i.exec(lead)?.[1];
    if (name) constants.set(name, [...(constants.get(name) ?? []), literal]);
    if (/["'](?:reason|message|permissionDecisionReason|additionalContext)["']\s*:\s*[frbu]*$/i.test(lead))
      add('message', literal.start, literal.end, literal.text);
  }
  const output =
    /\b(?:print|(?:console\.)?(?:warn|error|log)|(?:sys\.)?(?:stderr|stdout)\.write|(?:process\.)?(?:stderr|stdout)\.write)\s*\(/g;
  for (const match of syntax.matchAll(output)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    for (; end < syntax.length && depth > 0; end++) {
      if (syntax[end] === '(') depth++;
      else if (syntax[end] === ')') depth--;
    }
    const used = literals.filter((literal) => literal.start >= start && literal.end <= end);
    for (const word of syntax.slice(start, end).matchAll(/\b[A-Za-z_$][\w$]*\b/g))
      used.push(...(constants.get(word[0]) ?? []));
    for (const literal of used) add('message', literal.start, literal.end, literal.text);
  }
  // Shell output has no call parentheses.
  for (const match of syntax.matchAll(/(?:^|\n)[ \t]*(?:echo|printf)\b[^\n]*/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    for (const literal of literals.filter((literal) => literal.start >= start && literal.end <= end))
      add('message', literal.start, literal.end, literal.text);
    for (const word of source.slice(start, end).matchAll(/\$\{?([A-Za-z_]\w*)/g))
      for (const literal of constants.get(word[1] ?? '') ?? [])
        add('message', literal.start, literal.end, literal.text);
  }
  result.sort((a, b) => a.startLine - b.startLine || a.kind.localeCompare(b.kind));
  CACHE.set(file, result);
  return result;
}
