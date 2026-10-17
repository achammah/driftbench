import { createHash } from 'node:crypto';
import { foldQuote, QuoteIndex } from '@agent-nexus/driftbench-generate';
import { parse as parseYaml } from 'yaml';

/**
 * Text helpers the scanner shares: where a quote sits in a file (its lines), the provenance hash, slugs for
 * stable ids, YAML frontmatter and markdown tables read with their line numbers. A quote is always checked
 * with the extractor's own quote check (`QuoteIndex`), so the map and the extract proposal agree on what
 * "the quote is in the file" means: the same words, white space and typographic quote marks folded.
 */

/** A passage of a file: its lines (1-based, inclusive) and the exact text quoted from them. */
export type Located = { file: string; startLine: number; endLine: number; quote: string };

/**
 * Where every line of a text starts, for the texts asked about last. A scan asks for many lines and spans of
 * the same file; counting from the top each time makes a file with many atoms quadratic.
 */
const LINE_STARTS = new Map<string, number[]>();
const LINE_STARTS_KEPT = 16;
function lineStarts(text: string): number[] {
  const known = LINE_STARTS.get(text);
  if (known) return known;
  const starts = [0];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1))
    starts.push(index + 1);
  if (LINE_STARTS.size >= LINE_STARTS_KEPT) {
    const oldest = LINE_STARTS.keys().next().value;
    if (oldest !== undefined) LINE_STARTS.delete(oldest);
  }
  LINE_STARTS.set(text, starts);
  return starts;
}

/** The 1-based line of a character offset. */
export function lineAt(text: string, offset: number): number {
  if (!(offset > 0)) return 1;
  // One more than the number of line breaks before the offset: the breaks sit just before each line start.
  const starts = lineStarts(text);
  let low = 1;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] as number) - 1 < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The lines `from` to `to` (1-based, inclusive) of a text, joined. */
export function sliceLines(text: string, from: number, to: number): string {
  if (
    !Number.isInteger(from) ||
    from < 1 ||
    to < 0 ||
    !(Number.isInteger(to) || to === Number.POSITIVE_INFINITY)
  ) {
    return text
      .split('\n')
      .slice(from - 1, to)
      .join('\n');
  }
  const starts = lineStarts(text);
  const last = Math.min(to, starts.length);
  if (from > last) return '';
  return text.slice(starts[from - 1], last < starts.length ? (starts[last] as number) - 1 : text.length);
}

/**
 * The text folded as `foldQuote` folds it, with the offset in the original text of every folded character.
 * Typographic quote marks map one to one; a run of white space becomes one space at the run's start.
 */
function foldWithOffsets(text: string): { folded: string; offsets: number[] } {
  let folded = '';
  const offsets: number[] = [];
  let space = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? '';
    if (/\s/.test(char)) {
      if (!space && folded.length > 0) {
        folded += ' ';
        offsets.push(index);
      }
      space = true;
      continue;
    }
    space = false;
    folded += char.replace(/[‘’‛′]/, "'").replace(/[“”‟″]/, '"');
    offsets.push(index);
  }
  return { folded, offsets };
}

export type LocateOptions = {
  /** Only occurrences that start on or after this line. */
  fromLine?: number;
  /** Only occurrences that end on or before this line. */
  toLine?: number;
  /** Among several occurrences, the one starting nearest this line. Default: the first. */
  nearLine?: number;
};

/**
 * Where a quote sits in a text, folded as the extractor folds it: its first and last line. Undefined when
 * the quote is blank or not inside the allowed lines.
 */
export function locateQuote(
  text: string,
  quote: string,
  options: LocateOptions = {},
): { startLine: number; endLine: number } | undefined {
  const needle = foldQuote(quote);
  if (needle === '') return undefined;
  const { folded, offsets } = foldWithOffsets(text);
  const found: Array<{ startLine: number; endLine: number }> = [];
  for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + 1)) {
    const startLine = lineAt(text, offsets[at] ?? 0);
    const endLine = lineAt(text, offsets[at + needle.length - 1] ?? 0);
    if (options.fromLine !== undefined && startLine < options.fromLine) continue;
    if (options.toLine !== undefined && endLine > options.toLine) continue;
    found.push({ startLine, endLine });
  }
  if (found.length === 0) return undefined;
  const near = options.nearLine;
  if (near === undefined) return found[0];
  return found.reduce((best, candidate) =>
    Math.abs(candidate.startLine - near) < Math.abs(best.startLine - near) ? candidate : best,
  );
}

/** True when the quote is in the given passage (already cut to the span's lines): the extractor's own check. */
export function quoteWithin(passage: string, quote: string): boolean {
  return new QuoteIndex(new Map([['passage', passage]])).contains('passage', quote);
}

/**
 * True when the quote is in the file at the span it claims: the extractor's quote check, run on the lines of
 * the span only.
 */
export function quoteAtSpan(text: string, located: Located): boolean {
  if (located.startLine < 1 || located.endLine < located.startLine) return false;
  const span = sliceLines(text, located.startLine, located.endLine);
  return new QuoteIndex(new Map([[located.file, span]])).contains(located.file, located.quote);
}

/** The provenance hash: SHA-256 of the file, the span and the quote. */
export function provenanceHash(located: Located): string {
  return sha256(`${located.file}\n${located.startLine}-${located.endLine}\n${located.quote}`);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A slug for an id: lowercase words of letters and digits joined by hyphens, at most `words` words. */
export function slug(text: string, words = 6): string {
  const parts = text
    .toLowerCase()
    .replace(/[`*_"'()[\]{}]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((part) => part !== '');
  const joined = parts.slice(0, words).join('-').slice(0, 48).replace(/-+$/, '');
  return joined === '' ? 'x' : joined;
}

/**
 * The text with every line inside a fenced code block (the fence lines included) left empty, so the line
 * numbers stay. HTML comments are masked with spaces, including comments across lines.
 * A comment inside a code example does not hide the prose after the fence.
 */
export function blankFences(text: string): string {
  let inside = false;
  let comment = false;
  return text
    .split('\n')
    .map((line) => {
      if (inside) {
        if (/^\s*(```|~~~)/.test(line)) inside = false;
        return '';
      }
      let visible = '';
      let cursor = 0;
      while (cursor < line.length) {
        if (comment) {
          const end = line.indexOf('-->', cursor);
          const stop = end < 0 ? line.length : end + 3;
          visible += ' '.repeat(stop - cursor);
          cursor = stop;
          if (end >= 0) comment = false;
        } else {
          const start = line.indexOf('<!--', cursor);
          if (start < 0) {
            visible += line.slice(cursor);
            break;
          }
          visible += line.slice(cursor, start);
          cursor = start;
          comment = true;
        }
      }
      if (/^\s*(```|~~~)/.test(visible)) {
        inside = true;
        return '';
      }
      return visible;
    })
    .join('\n');
}

/** The line (1-based) and the trimmed text of every line of a text. */
export function linesOf(text: string): Array<{ line: number; text: string; raw: string }> {
  return text.split('\n').map((raw, index) => ({ line: index + 1, text: raw.trim(), raw }));
}

export type Frontmatter = {
  /** The parsed fields, or an empty object when the block is absent or not a mapping. */
  fields: Record<string, unknown>;
  /** Lines of the block, `---` lines included. Undefined when the file has no frontmatter. */
  startLine?: number;
  endLine?: number;
  /** The first line of the body. */
  bodyLine: number;
  /** Why the block could not be read, when it could not. */
  error?: string;
  /** The strict parser's message, when the tolerant second pass read the block instead. */
  tolerated?: string;
};

/** Reads a leading `---` YAML block. A file without one is all body. */
export function readFrontmatter(text: string): Frontmatter {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return { fields: {}, bodyLine: 1 };
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close < 0) return { fields: {}, bodyLine: 1, error: 'the frontmatter block is never closed' };
  const block = lines.slice(1, close);
  try {
    const parsed: unknown = parseYaml(block.join('\n'));
    const fields =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { fields, startLine: 1, endLine: close + 1, bodyLine: close + 2 };
  } catch (cause) {
    const message = cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
    const fields = tolerantFields(block);
    const place = { startLine: 1, endLine: close + 1, bodyLine: close + 2 };
    return fields ? { fields, ...place, tolerated: message } : { fields: {}, ...place, error: message };
  }
}

/** A top-level key of a frontmatter block, at the start of its line. */
const TOP_KEY = /^([A-Za-z0-9_][\w.-]*)\s*:(.*)$/;

/**
 * The tolerant second pass over a frontmatter block the YAML parser refused. The block is cut into its
 * top-level entries (a key at the start of a line, with the indented or list lines under it), and each
 * entry is parsed alone, so one bad line costs one field, not the block. An entry the parser still
 * refuses keeps its text as a string: on one line, the value as written (a description holding `: ` is the
 * usual case); over several lines, the lines joined. Undefined when the block holds no top-level key.
 */
export function tolerantFields(block: readonly string[]): Record<string, unknown> | undefined {
  const entries: Array<{ key: string; lines: string[] }> = [];
  for (const original of block) {
    // Normalize only syntax whitespace, retaining scalar content and source line numbers.
    const line = original.replace(/\r$/, '').replace(/^\t+/, (tabs) => '  '.repeat(tabs.length));
    const match = TOP_KEY.exec(line);
    if (match?.[1] !== undefined) entries.push({ key: match[1], lines: [line] });
    else if (line.startsWith('#') && entries.length === 0) continue;
    else entries[entries.length - 1]?.lines.push(line);
  }
  if (entries.length === 0) return undefined;
  const fields: Record<string, unknown> = {};
  for (const { key, lines } of entries) {
    try {
      const parsed: unknown = parseYaml(lines.join('\n'));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && key in parsed) {
        fields[key] = (parsed as Record<string, unknown>)[key];
        continue;
      }
    } catch {
      // Kept as text below.
    }
    const first = TOP_KEY.exec(lines[0] ?? '')?.[2]?.trim() ?? '';
    const rest = lines
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const text = [first, ...rest].filter((part) => part !== '').join(rest.length > 0 ? '\n' : '');
    fields[key] = unquote(text);
  }
  return fields;
}

/** A value without the one pair of quotes that wraps it whole. */
function unquote(text: string): string {
  const match = /^(["'])([\s\S]*)\1$/.exec(text);
  return match?.[2] ?? text;
}

/** The line of a top-level frontmatter key, such as `name:`, and that line's trimmed text. */
export function keyLine(
  text: string,
  key: string,
  frontmatter: Frontmatter,
): { line: number; text: string } | undefined {
  if (frontmatter.startLine === undefined || frontmatter.endLine === undefined) return undefined;
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  for (const entry of linesOf(text)) {
    if (entry.line <= frontmatter.startLine || entry.line >= frontmatter.endLine) continue;
    if (pattern.test(entry.raw)) return { line: entry.line, text: entry.text };
  }
  return undefined;
}

export type TableRow = { line: number; text: string; cells: string[] };
export type Table = { header: string[]; headerLine: number; rows: TableRow[] };

/** Every markdown table of a text, between `fromLine` and `toLine`: header cells and data rows. */
export function readTables(text: string, fromLine = 1, toLine = Number.POSITIVE_INFINITY): Table[] {
  const lines = linesOf(blankFences(text));
  const originals = linesOf(text);
  const tables: Table[] = [];
  for (let index = 0; index < lines.length; index++) {
    const head = lines[index];
    const rule = lines[index + 1];
    if (!head || !rule || head.line < fromLine || head.line > toLine) continue;
    // A rule line holds a pipe and dashes: most lines are not one, and splitting every line into cells is slow.
    if (!rule.text.includes('|') || !rule.text.includes('---')) continue;
    const header = cells(head.text);
    const separators = cells(rule.text);
    if (
      header.length < 2 ||
      separators.length !== header.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    const table: Table = { header, headerLine: head.line, rows: [] };
    let next = index + 2;
    for (; next < lines.length; next++) {
      const row = lines[next];
      // A table belongs to the range that holds its header, and runs to its last row: a chunk that ends
      // inside a table must not cut it, and the next chunk never sees its header, so it would lose the rest.
      if (!row || cells(row.text).length < 2) break;
      table.rows.push({
        line: row.line,
        text: originals[row.line - 1]?.raw ?? row.text,
        cells: cells(row.text),
      });
    }
    tables.push(table);
    index = next - 1;
  }
  return tables;
}

function cells(row: string): string[] {
  // Markdown permits omitted outer pipes; escaped pipes are content, not column separators.
  const columns: string[] = [];
  let value = '';
  const trimmed = row.trim();
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (char === '\\' && trimmed[index + 1] === '|') {
      value += '|';
      index++;
    } else if (char === '|') {
      columns.push(value.trim());
      value = '';
    } else value += char;
  }
  columns.push(value.trim());
  if (trimmed.startsWith('|')) columns.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) columns.pop();
  return columns;
}

/** Text compared across files (a guard's message against a rule): folded, lowercased, without markup. */
export function plain(text: string): string {
  return foldQuote(text.replace(/[`*]/g, ''))
    .toLowerCase()
    .replace(/[.;:!]+$/, '')
    .trim();
}

/** A rule label at the start of a line, such as `- **R5.**` or `R5.`: the label, else undefined. */
export function labelOfLine(line: string): string | undefined {
  const match = /^\s*(?:[-*]\s+)?(?:\*\*)?([A-Z]{1,3})#?(\d{1,3})\.?(?:\*\*)?[.:]?\s/i.exec(line);
  return match ? `${match[1]}${match[2]}`.toUpperCase() : undefined;
}
