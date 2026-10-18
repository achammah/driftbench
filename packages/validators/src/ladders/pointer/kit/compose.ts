/**
 * The composer: writes a markdown document from a list of blocks and returns, with the text, the truth the
 * oracles compare against: every unit the design says the cutter makes, with its container, its UTF-16 span in
 * the final text, the construct's whole range, its heading path, and the non-prose ranges (marks, fences'
 * delimiters, tag lines, delimiter rows). Truth comes from construction: each piece is appended to one string
 * and its span is read off the running length.
 */

export type Eol = '\n' | '\r\n';

/** A unit the cutter must produce. */
export type TruthUnit = {
  container: string;
  /** The content span in the final text. `text` equals `source.slice(start, end)`. */
  start: number;
  end: number;
  text: string;
  /** The whole construct including its marks. The reader's span must lie inside it. */
  region: [number, number];
  /** Ancestors only: the headings above the unit. */
  path: string[];
  yamlPath?: string[];
  opaque?: boolean;
};

export type FrontValue = string | number | boolean | null | FrontValue[] | { [key: string]: FrontValue };
export type FrontStyle = 'plain' | 'double' | 'single' | 'folded';
export type FrontEntry = { key: string; value: FrontValue; style?: FrontStyle };

export type ListItem = { text: string; children?: ListItem[] };

export type Block =
  | { kind: 'heading'; level: number; text: string; style?: 'atx' | 'setext'; closing?: boolean }
  | {
      kind: 'paragraph';
      sentences: string[];
      wrap?: number;
      hardBreak?: 'spaces' | 'backslash';
      /** What separates two sentences; a space by default. */
      joiner?: string;
    }
  | {
      kind: 'list';
      items: ListItem[];
      marker?: '-' | '*' | '+' | '1.' | '1)';
      start?: number;
      loose?: boolean;
      wrap?: number;
      nest?: 'spaces' | 'tab';
      /** Continuation lines of a wrapped item start at the margin. */
      lazy?: boolean;
    }
  | { kind: 'table'; header: string[]; rows: string[][]; pad?: boolean; align?: boolean }
  | {
      kind: 'quote';
      paragraphs: Array<string | { text: string; depth: number }>;
      wrap?: number;
      depth?: number;
    }
  | { kind: 'front'; entries: FrontEntry[] }
  | { kind: 'fence'; lines: string[]; info?: string; char?: '`' | '~'; length?: number; closed?: boolean }
  | { kind: 'comment'; lines: string[] }
  | { kind: 'tag'; tag: string; blocks: Block[] }
  /** Blocks one after another with no blank line between them. */
  | { kind: 'tight'; blocks: Block[] }
  | { kind: 'raw'; text: string; structure?: boolean };

export type Composed = {
  text: string;
  units: TruthUnit[];
  /** Ranges that hold no prose: marks, delimiters, tag lines, blank lines. */
  structure: Array<[number, number]>;
  eol: Eol;
  bom: boolean;
};

export type ComposeOptions = { eol?: Eol; bom?: boolean; trimEnd?: boolean };

class Writer {
  text = '';
  readonly units: TruthUnit[] = [];
  readonly structure: Array<[number, number]> = [];
  private stack: Array<{ level: number; text: string }> = [];
  constructor(readonly eol: Eol) {}

  get pos(): number {
    return this.text.length;
  }

  get path(): string[] {
    return this.stack.map((entry) => entry.text);
  }

  /** Appends text that holds no prose. */
  mark(s: string): void {
    if (s.length === 0) return;
    const start = this.pos;
    this.text += s;
    this.structure.push([start, this.pos]);
  }

  /** Appends text and returns its span; the caller decides what it is. */
  put(s: string): [number, number] {
    const start = this.pos;
    this.text += s;
    return [start, this.pos];
  }

  unit(unit: Omit<TruthUnit, 'text' | 'path'> & { path?: string[] }): void {
    // the text is cut from the finished string in `compose`: slicing a string that is still being built keeps every copy alive
    this.units.push({ ...unit, text: '', path: unit.path ?? this.path });
  }

  /** Drops the headings of this level or deeper: what is left is the ancestors of a heading of `level`. */
  popTo(level: number): void {
    while (this.stack.length > 0 && (this.stack[this.stack.length - 1]?.level ?? 0) >= level)
      this.stack.pop();
  }

  pushHeading(level: number, text: string): void {
    this.popTo(level);
    this.stack.push({ level, text });
  }
}

/** Greedy wrap of `words` at `width` columns; a break is `eol` plus `indent`. Returns the span of the whole run. */
function putWrapped(
  w: Writer,
  words: string[],
  width: number | undefined,
  indent: string,
  firstColumn = 0,
  wordHook?: (index: number, start: number, end: number) => void,
): [number, number] {
  const start = w.pos;
  let column = firstColumn;
  words.forEach((word, index) => {
    if (index > 0) {
      if (width !== undefined && column + 1 + word.length > width) {
        w.mark(w.eol);
        w.mark(indent);
        column = indent.length;
      } else {
        w.put(' ');
        column += 1;
      }
    }
    const [s, e] = w.put(word);
    column += word.length;
    wordHook?.(index, s, e);
  });
  return [start, w.pos];
}

function emitHeading(w: Writer, block: Extract<Block, { kind: 'heading' }>): void {
  const level = Math.min(Math.max(block.level, 1), 6);
  w.popTo(level);
  const ancestors = w.path;
  const regionStart = w.pos;
  let contentStart: number;
  let contentEnd: number;
  if (block.style === 'setext' && level <= 2) {
    [contentStart, contentEnd] = w.put(block.text);
    w.mark(w.eol);
    w.mark((level === 1 ? '=' : '-').repeat(Math.max(3, block.text.length)));
  } else {
    w.mark(`${'#'.repeat(level)} `);
    [contentStart, contentEnd] = w.put(block.text);
    if (block.closing) w.mark(` ${'#'.repeat(level)}`);
  }
  w.unit({
    container: 'heading',
    start: contentStart,
    end: contentEnd,
    region: [regionStart, w.pos],
    path: ancestors,
  });
  w.pushHeading(level, block.text);
}

function emitParagraph(w: Writer, block: Extract<Block, { kind: 'paragraph' }>): void {
  const tokens: Array<{ word: string; sentence: number; first: boolean }> = [];
  block.sentences.forEach((sentence, si) => {
    sentence.split(' ').forEach((word, wi) => {
      tokens.push({ word, sentence: si, first: wi === 0 });
    });
  });
  const starts: number[] = [];
  const ends: number[] = [];
  // a hard break goes in the middle of the first sentence
  const firstLength = (block.sentences[0] ?? '').split(' ').length;
  const breakAt = Math.floor(firstLength / 2);
  const joiner = block.joiner ?? ' ';
  let column = 0;
  tokens.forEach((token, i) => {
    if (i > 0) {
      if (token.first && joiner !== ' ') {
        w.put(joiner);
        column += joiner.length;
      } else if (block.hardBreak && i === breakAt && breakAt > 0) {
        w.put(block.hardBreak === 'spaces' ? '  ' : '\\');
        w.put(w.eol);
        column = 0;
      } else if (block.wrap !== undefined && column + 1 + token.word.length > block.wrap) {
        w.put(w.eol);
        column = 0;
      } else {
        w.put(' ');
        column += 1;
      }
    }
    const [s, e] = w.put(token.word);
    column += token.word.length;
    if (starts[token.sentence] === undefined) starts[token.sentence] = s;
    ends[token.sentence] = e;
  });
  block.sentences.forEach((_, si) => {
    const start = starts[si] ?? w.pos;
    const end = ends[si] ?? w.pos;
    w.unit({ container: 'sentence', start, end, region: [start, end] });
  });
}

function emitList(w: Writer, block: Extract<Block, { kind: 'list' }>, depth = 0, parentIndent = ''): void {
  const marker = block.marker ?? '-';
  const ordered = marker === '1.' || marker === '1)';
  const numberStart = block.start ?? 1;
  block.items.forEach((item, index) => {
    const label = ordered ? `${numberStart + index}${marker.slice(-1)}` : marker;
    const lead = `${label} `;
    const itemIndent = ' '.repeat(lead.length);
    const regionStart = w.pos;
    w.mark(parentIndent);
    w.mark(lead);
    const words = item.text.split(' ');
    const [start, end] = putWrapped(
      w,
      words,
      block.wrap,
      block.lazy ? '' : `${parentIndent}${itemIndent}`,
      parentIndent.length + lead.length,
    );
    w.unit({ container: 'list_item', start, end, region: [regionStart, end] });
    w.mark(w.eol);
    if (block.loose && (index < block.items.length - 1 || item.children)) w.mark(w.eol);
    if (item.children && item.children.length > 0) {
      const childIndent = block.nest === 'tab' ? `${parentIndent}\t` : `${parentIndent}${itemIndent}`;
      emitList(w, { ...block, items: item.children, start: 1 }, depth + 1, childIndent);
    }
  });
}

function emitTable(w: Writer, block: Extract<Block, { kind: 'table' }>): void {
  const columns = block.header.length;
  const widths = block.header.map((h, c) =>
    Math.max(h.length, ...block.rows.map((r) => (r[c] ?? '').length), 3),
  );
  const row = (cells: string[]) => {
    w.mark('|');
    cells.forEach((cell, c) => {
      const slotStart = w.pos;
      w.mark(' ');
      let start = w.pos;
      let end = w.pos;
      if (cell.length > 0) [start, end] = w.put(cell);
      const pad = block.pad ? Math.max(0, (widths[c] ?? 0) - cell.length) : 0;
      w.mark(' '.repeat(pad + 1));
      const slotEnd = w.pos;
      if (cell.length > 0) w.unit({ container: 'table_cell', start, end, region: [slotStart, slotEnd] });
      w.mark('|');
    });
    w.mark(w.eol);
  };
  row(block.header);
  w.mark('|');
  for (let c = 0; c < columns; c += 1) {
    const dashes = '-'.repeat(Math.max(3, block.pad ? (widths[c] ?? 3) : 3));
    w.mark(
      block.align && c % 3 === 0 ? `:${dashes}:` : block.align && c % 3 === 1 ? `${dashes}:` : `-${dashes}-`,
    );
    w.mark('|');
  }
  w.mark(w.eol);
  for (const r of block.rows) row(r);
}

function emitQuote(w: Writer, block: Extract<Block, { kind: 'quote' }>): void {
  const base = block.depth ?? 1;
  let previousDepth = base;
  block.paragraphs.forEach((paragraph, index) => {
    const text = typeof paragraph === 'string' ? paragraph : paragraph.text;
    const depth = typeof paragraph === 'string' ? base : paragraph.depth;
    if (index > 0) {
      const sep = Math.min(previousDepth, depth);
      w.mark(`${Array.from({ length: sep }, () => '>').join(' ')}${w.eol}`);
    }
    const prefix = '> '.repeat(depth);
    const regionStart = w.pos;
    w.mark(prefix);
    const [start, end] = putWrapped(w, text.split(' '), block.wrap, prefix, prefix.length);
    w.unit({ container: 'block_quote', start, end, region: [regionStart, end] });
    w.mark(w.eol);
    previousDepth = depth;
  });
}

function scalar(_value: string, style: FrontStyle | undefined): { before: string; after: string } {
  if (style === 'double') return { before: '"', after: '"' };
  if (style === 'single') return { before: "'", after: "'" };
  return { before: '', after: '' };
}

function emitFrontValue(
  w: Writer,
  key: string,
  value: FrontValue,
  style: FrontStyle | undefined,
  indent: string,
  yamlPath: string[],
  inArray = false,
): void {
  const here = [...yamlPath];
  if (typeof value === 'string') {
    if (style === 'folded') {
      w.mark(`${indent}${inArray ? '- ' : `${key}: `}>${w.eol}`);
      const lines = value.split('\n');
      const regionStart = w.pos;
      let first = -1;
      lines.forEach((line, i) => {
        w.mark(`${indent}  `);
        const [s] = w.put(line);
        if (first < 0) first = s;
        if (i < lines.length - 1) w.mark(w.eol);
      });
      const end = w.pos;
      w.unit({
        container: 'front_matter',
        start: first,
        end,
        region: [regionStart, end],
        yamlPath: here,
      });
      w.mark(w.eol);
      return;
    }
    const q = scalar(value, style);
    const regionStart = w.pos;
    w.mark(`${indent}${inArray ? '- ' : `${key}: `}${q.before}`);
    const [start, end] = w.put(value);
    w.mark(q.after);
    w.unit({ container: 'front_matter', start, end, region: [regionStart, w.pos], yamlPath: here });
    w.mark(w.eol);
    return;
  }
  if (Array.isArray(value)) {
    w.mark(`${indent}${key}:${w.eol}`);
    value.forEach((entry, i) => {
      emitFrontValue(w, `${key}[${i}]`, entry, style, `${indent}  `, [...yamlPath, String(i)], true);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    w.mark(`${indent}${key}:${w.eol}`);
    for (const [k, v] of Object.entries(value)) {
      emitFrontValue(w, k, v, style, `${indent}  `, [...yamlPath, k]);
    }
    return;
  }
  w.mark(`${indent}${inArray ? '- ' : `${key}: `}${value === null ? 'null' : String(value)}${w.eol}`);
}

function emitFront(w: Writer, block: Extract<Block, { kind: 'front' }>): void {
  w.mark(`---${w.eol}`);
  for (const entry of block.entries) emitFrontValue(w, entry.key, entry.value, entry.style, '', [entry.key]);
  w.mark(`---${w.eol}`);
}

function emitFence(w: Writer, block: Extract<Block, { kind: 'fence' }>): void {
  const char = block.char ?? '`';
  const fence = char.repeat(block.length ?? 3);
  const start = w.pos;
  w.put(`${fence}${block.info ?? ''}`);
  for (const line of block.lines) {
    w.put(w.eol);
    w.put(line);
  }
  if (block.closed !== false) {
    w.put(w.eol);
    w.put(fence);
  }
  const end = w.pos;
  w.unit({ container: 'fence', start, end, region: [start, end], opaque: true });
}

function emitComment(w: Writer, block: Extract<Block, { kind: 'comment' }>): void {
  const start = w.pos;
  w.put('<!--');
  for (const line of block.lines) {
    w.put(w.eol);
    w.put(line);
  }
  w.put(`${w.eol}-->`);
  const end = w.pos;
  w.unit({ container: 'comment', start, end, region: [start, end], opaque: true });
}

function emitBlock(w: Writer, block: Block, inTag = false): void {
  switch (block.kind) {
    case 'heading':
      emitHeading(w, block);
      w.mark(w.eol);
      break;
    case 'paragraph':
      emitParagraph(w, block);
      w.mark(w.eol);
      break;
    case 'list':
      emitList(w, block);
      break;
    case 'table':
      emitTable(w, block);
      break;
    case 'quote':
      emitQuote(w, block);
      break;
    case 'front':
      emitFront(w, block);
      break;
    case 'fence':
      emitFence(w, block);
      w.mark(w.eol);
      break;
    case 'comment':
      emitComment(w, block);
      w.mark(w.eol);
      break;
    case 'tight': {
      for (const inner of block.blocks) emitBlock(w, inner, true);
      break;
    }
    case 'tag': {
      w.mark(`<${block.tag}>${w.eol}`);
      for (const inner of block.blocks) emitBlock(w, inner, true);
      w.mark(`</${block.tag}>${w.eol}`);
      break;
    }
    case 'raw': {
      if (block.structure) w.mark(block.text);
      else w.put(block.text);
      break;
    }
  }
  void inTag;
}

/** Writes the blocks one after another, a blank line between top-level blocks (except after a front matter). */
export function compose(blocks: readonly Block[], options: ComposeOptions = {}): Composed {
  const eol = options.eol ?? '\n';
  const w = new Writer(eol);
  if (options.bom) w.mark('\uFEFF');
  blocks.forEach((block, index) => {
    emitBlock(w, block);
    const next = blocks[index + 1];
    if (next && block.kind !== 'front' && block.kind !== 'raw') w.mark(eol);
  });
  let text = w.text;
  let structure = w.structure;
  if (options.trimEnd) {
    text = text.replace(/(?:\r?\n)+$/, '');
    structure = structure
      .map(([a, b]) => [Math.min(a, text.length), Math.min(b, text.length)] as [number, number])
      .filter(([a, b]) => b > a);
  }
  for (const unit of w.units) unit.text = text.slice(unit.start, unit.end);
  return { text, units: w.units, structure, eol, bom: options.bom === true };
}

/** The 1-based line of an offset in a text (every line end counts once, LF or CRLF). */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
    else if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) !== 10) line += 1;
  }
  return line;
}
