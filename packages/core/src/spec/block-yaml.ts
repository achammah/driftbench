import { Document, isScalar, type ScalarTag, stringify } from 'yaml';

// The ordinary block-map/sequence subset needs no CST or YAML node tree. Anything
// outside this subset goes through the existing YAML parser, including its errors.
const scalarTags = new Document().schema.tags.filter(
  (tag): tag is ScalarTag => !tag.collection && tag.default === true && tag.test !== undefined,
);
const unsupported = Symbol('unsupported YAML');
// Primitive scalar results are immutable; keep at most 4096 short spellings.
const scalarValues = new Map<string, unknown>();
const plainKey = /^[a-zA-Z_][a-zA-Z0-9_.-]*$/;

export function parseBlockYaml(text: string): { value: unknown } | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters require the full YAML parser.
  if (/[\r\t\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(text)) return;
  return new BlockParser(text).parse();
}

class BlockParser {
  private readonly lines: string[];
  private at = 0;
  private indentAt = -1;
  private indent = 0;

  constructor(private readonly text: string) {
    this.lines = text.split('\n');
    if (this.lines.at(-1) === '') this.lines.pop();
  }

  parse(): { value: unknown } | undefined {
    try {
      this.skip();
      if (this.at === this.lines.length || this.indentation() !== 0) return;
      const result = this.block(0);
      this.skip();
      if (this.at !== this.lines.length) return;
      return { value: result };
    } catch {
      return;
    }
  }

  private indentation(): number {
    if (this.indentAt !== this.at) {
      const line = this.lines[this.at] ?? '';
      this.indent = 0;
      while (line.charCodeAt(this.indent) === 32) this.indent += 1;
      this.indentAt = this.at;
    }
    return this.indent;
  }

  private skip(): void {
    while (this.at < this.lines.length) {
      const line = this.lines[this.at] ?? '';
      const leading = this.indentation();
      if (leading !== line.length && line[leading] !== '#') break;
      this.at += 1;
    }
  }

  private literal(source: string, indent: number): string {
    if ((source !== '|-' && source !== '|') || !this.text.endsWith('\n')) throw unsupported;
    const content: string[] = [];
    let first = true;
    while (this.at < this.lines.length) {
      const line = this.lines[this.at] ?? '';
      if (line !== '' && this.indentation() <= indent) break;
      if (line !== '' && this.indentation() < indent + 2) throw unsupported;
      if (line !== '' && (line.trim() === '' || (first && this.indentation() !== indent + 2)))
        throw unsupported;
      if (line !== '') first = false;
      content.push(line.slice(indent + 2));
      this.at += 1;
    }
    if (content.length === 0 || first) throw unsupported;
    const value = content.join('\n').replace(/\n*$/, '');
    return source === '|' ? `${value}\n` : value;
  }

  private value(source: string, indent: number): unknown {
    if (source.startsWith('|')) return this.literal(source, indent);
    if (source !== '') return scalar(source);
    this.skip();
    const line = this.lines[this.at];
    if (line === undefined || this.indentation() !== indent + 2) throw unsupported;
    return this.block(indent + 2);
  }

  private map(indent: number, first?: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    let source = first;
    while (true) {
      if (source === undefined) {
        this.skip();
        const line = this.lines[this.at];
        if (line === undefined || this.indentation() < indent) break;
        if (this.indentation() !== indent || line.slice(indent).startsWith('- ')) throw unsupported;
        source = line.slice(indent);
        this.at += 1;
      }
      const entry = pair(source);
      const { key } = entry;
      if (Object.hasOwn(out, key)) throw unsupported;
      const parsed = entry.primitive ? entry.parsed : this.value(entry.rest, indent);
      if (key === '__proto__')
        Object.defineProperty(out, key, {
          value: parsed,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      else out[key] = parsed;
      source = undefined;
    }
    return out;
  }

  private sequence(indent: number, first?: string): unknown[] {
    const out: unknown[] = [];
    let source = first;
    while (true) {
      if (source === undefined) {
        this.skip();
        const line = this.lines[this.at];
        if (line === undefined || this.indentation() < indent) break;
        if (this.indentation() !== indent || !line.slice(indent).startsWith('- ')) throw unsupported;
        source = line.slice(indent);
        this.at += 1;
      }
      const rest = source.slice(2);
      if (rest.startsWith('- ')) out.push(this.sequence(indent + 2, rest));
      else if (/^[a-zA-Z_][a-zA-Z0-9_.-]*:(?: |$)/.test(rest)) out.push(this.map(indent + 2, rest));
      else out.push(this.value(rest, indent));
      source = undefined;
    }
    return out;
  }

  private block(indent: number): unknown {
    const source = (this.lines[this.at] ?? '').slice(indent);
    return source.startsWith('- ') ? this.sequence(indent) : this.map(indent);
  }
}

function rawScalar(source: string): unknown {
  if (source === '{}') return {};
  if (source === '[]') return [];
  if (source.startsWith('"')) {
    const value: unknown = JSON.parse(source);
    if (typeof value !== 'string') throw unsupported;
    return value;
  }
  if (source.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(source)) throw unsupported;
    return source.slice(1, -1).replaceAll("''", "'");
  }
  if (
    source.length === 0 ||
    source.trim() !== source ||
    /^[!&*#{}[\],>|%@`]/.test(source) ||
    /^[?:-](?: |$)/.test(source) ||
    /:($| )| #/.test(source) ||
    source === '---' ||
    source === '...'
  )
    throw unsupported;
  for (const tag of scalarTags) {
    if (tag.test?.test(source)) {
      const resolved = tag.resolve(
        source,
        () => {
          throw unsupported;
        },
        {},
      );
      return isScalar(resolved) ? resolved.value : resolved;
    }
  }
  return source;
}
function scalar(source: string): unknown {
  const known = scalarValues.get(source);
  if (known !== undefined) return known;
  const result = rawScalar(source);
  if (source.length <= 256 && (result === null || typeof result !== 'object')) {
    if (scalarValues.size >= 4096) scalarValues.clear();
    scalarValues.set(source, result);
  }
  return result;
}
type Pair = { key: string; rest: string; primitive: boolean; parsed: unknown };
const pairs = new Map<string, Pair>();
function pair(source: string): Pair {
  const known = pairs.get(source);
  if (known !== undefined) return known;
  // Complex/quoted keys are uncommon and retain the full parser's handling.
  const colon = source.indexOf(':');
  const key = source.slice(0, colon);
  if (colon < 1 || !plainKey.test(key) || (source[colon + 1] !== undefined && source[colon + 1] !== ' '))
    throw unsupported;
  if (typeof scalar(key) !== 'string') throw unsupported;
  const rest = source.slice(source[colon + 1] === ' ' ? colon + 2 : colon + 1);
  const primitive = rest !== '' && !rest.startsWith('|') && rest !== '{}' && rest !== '[]';
  const entry = { key, rest, primitive, parsed: primitive ? scalar(rest) : undefined };
  // Only immutable scalars are retained. Containers are always parsed afresh.
  if (source.length <= 256) {
    if (pairs.size >= 4096) pairs.clear();
    pairs.set(source, entry);
  }
  return entry;
}

// The writer twin of the parser above. `stringify` builds a node tree for every value it writes, which is
// most of the cost of writing thousands of generated specs. The ordinary block map and sequence of plain
// scalars needs none of it; anything else goes to the library for the whole document, so the text is the
// library's text in every case.
const LIBRARY_OPTIONS = { lineWidth: 0, aliasDuplicateObjects: false } as const;
// The library's rule for a string it cannot write plain (stringifyString.js, plainString).
const notPlain = /^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the library writes these double-quoted.
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff\ufeff]/;
const scalarTexts = new Map<string, string>();
const MAX_KEY = 1024;

/**
 * The text of a single-line string: plain when the library would write it plain, else quoted as the library
 * quotes it. A string with a double quote and no single quote is single-quoted; any other is a JSON string.
 */
function stringText(value: string): string {
  const known = scalarTexts.get(value);
  if (known !== undefined) return known;
  if (controls.test(value) || /^(?:---|\.\.\.)/.test(value)) throw unsupported;
  // A string that starts with a letter can only read as null or a boolean; any other start tries every tag.
  const resolves = /^[A-Za-z]/.test(value)
    ? value.length <= 5 && /^(?:null|true|false)$/i.test(value)
    : scalarTags.some((tag) => tag.test?.test(value));
  let text = value;
  if (value === '' || notPlain.test(value) || resolves)
    text = value.includes('"') && !value.includes("'") ? `'${value}'` : JSON.stringify(value);
  if (value.length <= 256) {
    if (scalarTexts.size >= 4096) scalarTexts.clear();
    scalarTexts.set(value, text);
  }
  return text;
}

const keyTexts = new Set<string>();

function keyText(key: string): string {
  if (keyTexts.has(key)) return key;
  if (key.length > MAX_KEY || !plainKey.test(key) || key === '__proto__') throw unsupported;
  if (scalarTags.some((tag) => tag.test?.test(key))) throw unsupported;
  if (keyTexts.size >= 4096) keyTexts.clear();
  keyTexts.add(key);
  return key;
}

function inlineText(value: unknown): string | undefined {
  if (typeof value === 'string') return stringText(value);
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (Object.is(value, -0) || !Number.isFinite(value)) throw unsupported;
    const text = String(value);
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw unsupported;
    return text;
  }
  if (Array.isArray(value)) return value.length === 0 ? '[]' : undefined;
  if (isPlain(value)) return hasDefinedValues(value) ? undefined : '{}';
  throw unsupported;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasDefinedValues(object: Record<string, unknown>): boolean {
  return Object.keys(object).some((key) => object[key] !== undefined);
}

function writeMap(object: Record<string, unknown>, indent: string, first: string, lines: string[]): void {
  let lead = first;
  for (const key of Object.keys(object)) {
    const value = object[key];
    // The library leaves out a pair whose value is undefined.
    if (value === undefined) continue;
    const text = inlineText(value);
    if (text !== undefined) lines.push(`${lead}${keyText(key)}: ${text}`);
    else {
      lines.push(`${lead}${keyText(key)}:`);
      writeBlock(value, `${indent}  `, lines);
    }
    lead = indent;
  }
}

function writeBlock(value: unknown, indent: string, lines: string[], first = indent): void {
  if (Array.isArray(value)) {
    let lead = first;
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (item === undefined) throw unsupported;
      const text = inlineText(item);
      if (text !== undefined) lines.push(`${lead}- ${text}`);
      else writeBlock(item, `${indent}  `, lines, `${lead}- `);
      lead = indent;
    }
  } else writeMap(value as Record<string, unknown>, indent, first, lines);
}

/**
 * The YAML text of a value, as `stringify(value, { lineWidth: 0, aliasDuplicateObjects: false })` writes it.
 * Block maps and sequences of plain scalars, single-line quoted strings and ordinary numbers are written
 * directly; a value outside that (a multi-line string, a date, a key that needs quoting) is written by the
 * library, whole. Undefined map values are omitted; maps left empty still serialize as `{}` at any depth.
 */
export function stringifyBlockYaml(value: unknown): string {
  if (Array.isArray(value) ? value.length > 0 : isPlain(value) && hasDefinedValues(value)) {
    try {
      const lines: string[] = [];
      writeBlock(value, '', lines);
      return `${lines.join('\n')}\n`;
    } catch (cause) {
      if (cause !== unsupported) throw cause;
    }
  }
  return stringify(value, LIBRARY_OPTIONS);
}
