import { createHash } from 'node:crypto';
import { isPair, isScalar, isSeq, parseDocument, visit } from 'yaml';
import type { CutResult, CutUnit } from '../../../src/ladders/pointer/sut/port';

/**
 * The reference cutter: a block parser for the markdown subset the composer writes, plus the sentence rules of
 * docs/estate-pointer-reader.md section 2 (masked text, Intl.Segmenter, merge when unsure). It exists to prove
 * that the bank's items can be passed; it is not the reader.
 */

type Line = { text: string; start: number };

type Ctx = {
  source: string;
  units: CutUnit[];
  stack: Array<{ level: number; text: string }>;
  mode: 'sentence' | 'quote';
  htmlDepth: number;
  depth: number;
};

const path = (ctx: Ctx) => ctx.stack.map((h) => h.text);

export function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The fingerprint text of section 4: NFC, white space collapsed, bullets, `>` and pipes stripped. */
export function fingerprintText(text: string): string {
  const lines = text.normalize('NFC').split(/\r\n|\r|\n/);
  const out = lines.map((line, i) => {
    let current = line.replace(/^\s*(?:>\s?)+/, '');
    if (i === 0) current = current.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/, '');
    return current;
  });
  return out
    .join(' ')
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toLines(source: string, from: number): Line[] {
  const lines: Line[] = [];
  let index = from;
  while (index <= source.length) {
    let end = index;
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1;
    lines.push({ text: source.slice(index, end), start: index });
    if (end >= source.length) break;
    index = source[end] === '\r' && source[end + 1] === '\n' ? end + 2 : end + 1;
    if (index === source.length) break;
  }
  return lines;
}

const blank = (line: Line) => line.text.trim() === '';
const indentOf = (text: string) => {
  let cols = 0;
  for (const ch of text) {
    if (ch === ' ') cols += 1;
    else if (ch === '\t') cols += 4 - (cols % 4);
    else break;
  }
  return cols;
};
/** Strips up to `cols` columns of leading white space (a tab counts whole). */
function strip(line: Line, cols: number): Line {
  let i = 0;
  let used = 0;
  while (i < line.text.length && used < cols) {
    const ch = line.text[i];
    if (ch === ' ') used += 1;
    else if (ch === '\t') used += 4 - (used % 4);
    else break;
    i += 1;
  }
  return { text: line.text.slice(i), start: line.start + i };
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const BULLET = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TAG_OPEN = /^ {0,3}<([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?>[ \t]*$/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function startsBlock(line: Line, interruptOrdered = false): boolean {
  if (FENCE.test(line.text) && !/^ {0,3}`{3,}.*`/.test(line.text.replace(/^ {0,3}`{3,}/, '`'))) return true;
  if (ATX.test(line.text)) return true;
  if (/^ {0,3}>/.test(line.text)) return true;
  if (THEMATIC.test(line.text)) return true;
  if (/^ {0,3}<!--/.test(line.text)) return true;
  const m = BULLET.exec(line.text);
  if (m && (m[3] ?? '') !== '') {
    const marker = m[2] as string;
    if (/^\d/.test(marker)) return interruptOrdered || marker.startsWith('1');
    return true;
  }
  return false;
}

/* ---------- sentences ---------- */

function mask(text: string): string {
  const chars = text.split('');
  const hide = (a: number, b: number) => {
    for (let i = a; i < b; i += 1) if (chars[i] !== undefined) chars[i] = 'x';
  };
  // inline code: a run of backticks to the next run of the same length
  const code = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  for (let m = code.exec(text); m; m = code.exec(text)) hide(m.index, m.index + m[0].length);
  // link destinations
  const dest = /\]\((<[^>\n]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
  for (let m = dest.exec(text); m; m = dest.exec(text)) {
    const inner = m[1] as string;
    const at = m.index + 2;
    hide(at, at + inner.length);
  }
  // bare URLs, without the punctuation that ends a sentence
  const url = /https?:\/\/[^\s<>]+/g;
  for (let m = url.exec(text); m; m = url.exec(text)) {
    let len = m[0].length;
    while (len > 0 && /[.,;:!?)"'\]]/.test(m[0][len - 1] as string)) len -= 1;
    hide(m.index, m.index + len);
  }
  return chars.join('').replace(/[\r\n]/g, ' ');
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Sentence spans of a paragraph text, relative to its start. */
export function sentenceSpans(text: string): Array<[number, number]> {
  // Preserve offsets while exposing a clear terminal boundary before an ASCII lowercase start.
  // This is structural segmentation, not a dictionary of sentence starters.
  const masked = mask(text).replace(
    /([.!?]\s+)([a-z])/g,
    (_match, gap: string, first: string) => gap + first.toUpperCase(),
  );
  let spans: Array<[number, number]> = [...segmenter.segment(masked)].map((s) => [
    s.index,
    s.index + s.segment.length,
  ]);
  // trim white space off both ends of every span
  spans = spans.map(([a, b]) => {
    let s = a;
    let e = b;
    while (s < e && /\s/.test(text[s] as string)) s += 1;
    while (e > s && /\s/.test(text[e - 1] as string)) e -= 1;
    return [s, e] as [number, number];
  });
  spans = spans.filter(([a, b]) => b > a);
  const out: Array<[number, number]> = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push([...span]);
      continue;
    }
    const piece = text.slice(span[0], span[1]);
    const before = text.slice(prev[0], prev[1]);
    // closing marks that ICU leaves at the head of the next segment stay with their sentence
    const closers = /^[*_~)\]}"'”’»]+(?=\s|$)/.exec(piece);
    if (closers) {
      prev[1] = span[0] + closers[0].length;
      const rest = span[0] + closers[0].length;
      let s = rest;
      while (s < span[1] && /\s/.test(text[s] as string)) s += 1;
      if (s < span[1]) out.push([s, span[1]]);
      continue;
    }
    const shortTitle = /(?:^|[\s("'])\p{Lu}\p{L}{0,2}\.$/u.test(before);
    const onlyMarks = !/[\p{L}\p{N}]/u.test(piece);
    if (shortTitle || onlyMarks) {
      prev[1] = span[1];
      continue;
    }
    out.push([...span]);
  }
  return out;
}

/* ---------- units ---------- */

function push(ctx: Ctx, container: string, start: number, end: number, extra: Partial<CutUnit> = {}): void {
  if (end <= start) return;
  const text = ctx.source.slice(start, end);
  ctx.units.push({
    container,
    start,
    end,
    text,
    fp: sha(fingerprintText(text)),
    path: path(ctx),
    opaque: container === 'fence' || container === 'comment',
    ...extra,
  });
}

function paragraphUnits(ctx: Ctx, lines: Line[]): void {
  const first = lines[0] as Line;
  const last = lines[lines.length - 1] as Line;
  const start = first.start + (first.text.length - first.text.trimStart().length);
  const end = last.start + last.text.trimEnd().length;
  if (ctx.mode === 'quote') {
    push(ctx, 'block_quote', start, end);
    return;
  }
  const text = ctx.source.slice(start, end);
  for (const [a, b] of sentenceSpans(text)) push(ctx, 'sentence', start + a, start + b);
}

/* ---------- block parser ---------- */

function parseBlocks(all: Line[], ctx: Ctx): void {
  if (ctx.depth > 500) throw new Error('the nesting is too deep to cut (limit 500 levels)');
  let i = 0;
  while (i < all.length) {
    const line = all[i] as Line;
    if (blank(line)) {
      i += 1;
      continue;
    }
    // fenced code
    const fence = FENCE.exec(line.text);
    if (fence && !(fence[1]?.startsWith('`') && (fence[2] ?? '').includes('`'))) {
      const marker = fence[1] as string;
      let j = i + 1;
      while (j < all.length) {
        const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
        if (closing.test((all[j] as Line).text)) break;
        j += 1;
      }
      const lastLine = all[Math.min(j, all.length - 1)] as Line;
      const start = line.start + (line.text.length - line.text.trimStart().length);
      push(ctx, 'fence', start, lastLine.start + lastLine.text.trimEnd().length);
      i = j + 1;
      continue;
    }
    // html comment
    if (/^ {0,3}<!--/.test(line.text)) {
      let j = i;
      while (j < all.length && !(all[j] as Line).text.includes('-->')) j += 1;
      const lastLine = all[Math.min(j, all.length - 1)] as Line;
      const endIndex = lastLine.text.includes('-->')
        ? lastLine.text.indexOf('-->') + 3
        : lastLine.text.length;
      const start = line.start + (line.text.length - line.text.trimStart().length);
      push(ctx, 'comment', start, lastLine.start + endIndex);
      i = j + 1;
      continue;
    }
    // ATX heading
    const atx = ATX.exec(line.text);
    if (atx) {
      const level = (atx[1] as string).length;
      const text = (atx[2] ?? '').trim();
      const start = line.start + (line.text.length - line.text.trimStart().length);
      if (text !== '') {
        const contentEnd = line.start + line.text.indexOf(text, line.text.indexOf('#')) + text.length;
        popHeadings(ctx, level);
        push(ctx, 'heading', start, contentEnd);
        pushHeading(ctx, level, text);
      }
      i += 1;
      continue;
    }
    if (THEMATIC.test(line.text) && !SETEXT.test(line.text)) {
      i += 1;
      continue;
    }
    if (THEMATIC.test(line.text)) {
      i += 1;
      continue;
    }
    // block quote
    if (/^ {0,3}>/.test(line.text)) {
      const inner: Line[] = [];
      let j = i;
      while (j < all.length) {
        const current = all[j] as Line;
        if (/^ {0,3}>/.test(current.text)) {
          const m = /^ {0,3}> ?/.exec(current.text) as RegExpExecArray;
          inner.push({ text: current.text.slice(m[0].length), start: current.start + m[0].length });
          j += 1;
          continue;
        }
        const previous = inner[inner.length - 1];
        if (!blank(current) && previous && !blank(previous) && !startsBlock(current)) {
          inner.push({ text: current.text, start: current.start });
          j += 1;
          continue;
        }
        break;
      }
      parseBlocks(inner, { ...ctx, mode: 'quote', depth: ctx.depth + 1 });
      i = j;
      continue;
    }
    // list
    if (BULLET.test(line.text) && /\S/.test(line.text.replace(BULLET, ''))) {
      i = parseList(all, i, ctx);
      continue;
    }
    // table
    const next = all[i + 1];
    if (next && line.text.includes('|') && DELIM.test(next.text) && next.text.includes('-')) {
      const headerCells = cells(line);
      const delimCells = next.text.split('|').filter((c) => c.trim() !== '').length;
      if (headerCells.length === delimCells || headerCells.length > 0) {
        for (const [a, b] of headerCells) push(ctx, 'table_cell', a, b);
        let j = i + 2;
        while (j < all.length && !blank(all[j] as Line) && (all[j] as Line).text.includes('|')) {
          for (const [a, b] of cells(all[j] as Line)) push(ctx, 'table_cell', a, b);
          j += 1;
        }
        i = j;
        continue;
      }
    }
    // html tag block
    const tag = TAG_OPEN.exec(line.text);
    if (tag) {
      const name = tag[1] as string;
      const close = new RegExp(`^ {0,3}</${name}>[ \\t]*$`);
      const open = new RegExp(`^ {0,3}<${name}(?:\\s[^<>]*)?>[ \\t]*$`);
      let depth = 1;
      let j = i + 1;
      for (; j < all.length; j += 1) {
        const text = (all[j] as Line).text;
        if (open.test(text)) depth += 1;
        else if (close.test(text)) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (j < all.length) {
        if (ctx.htmlDepth >= 1) {
          const lastLine = all[j] as Line;
          const start = line.start + (line.text.length - line.text.trimStart().length);
          push(ctx, 'comment', start, lastLine.start + lastLine.text.trimEnd().length);
        } else {
          parseBlocks(all.slice(i + 1, j), { ...ctx, htmlDepth: ctx.htmlDepth + 1, depth: ctx.depth + 1 });
        }
        i = j + 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (/^ {0,3}<\/[A-Za-z][A-Za-z0-9-]*>[ \t]*$/.test(line.text)) {
      i += 1;
      continue;
    }
    // paragraph, or a setext heading
    const para: Line[] = [line];
    let j = i + 1;
    let setext: { level: number; line: Line } | undefined;
    while (j < all.length) {
      const current = all[j] as Line;
      if (blank(current)) break;
      const under = SETEXT.exec(current.text);
      if (under) {
        setext = { level: (under[1] as string).startsWith('=') ? 1 : 2, line: current };
        j += 1;
        break;
      }
      if (startsBlock(current) || (TAG_OPEN.test(current.text) && false)) break;
      para.push(current);
      j += 1;
    }
    if (setext) {
      const first = para[0] as Line;
      const last = para[para.length - 1] as Line;
      const start = first.start + (first.text.length - first.text.trimStart().length);
      const end = last.start + last.text.trimEnd().length;
      popHeadings(ctx, setext.level);
      push(ctx, 'heading', start, end);
      pushHeading(ctx, setext.level, ctx.source.slice(start, end).replace(/\s+/g, ' '));
    } else {
      paragraphUnits(ctx, para);
    }
    i = j;
  }
}

function popHeadings(ctx: Ctx, level: number): void {
  while (ctx.stack.length > 0 && (ctx.stack[ctx.stack.length - 1]?.level ?? 0) >= level) ctx.stack.pop();
}

function pushHeading(ctx: Ctx, level: number, text: string): void {
  popHeadings(ctx, level);
  ctx.stack.push({ level, text });
  // the heading unit was pushed before the stack changed, so its path is its ancestors
}

/** Cells of a table row: trimmed, non-empty, with absolute spans. */
function cells(line: Line): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const text = line.text;
  let segStart = 0;
  const flush = (end: number) => {
    let a = segStart;
    let b = end;
    while (a < b && /\s/.test(text[a] as string)) a += 1;
    while (b > a && /\s/.test(text[b - 1] as string)) b -= 1;
    if (b > a) out.push([line.start + a, line.start + b]);
  };
  let i = 0;
  if (text.trimStart().startsWith('|')) {
    i = text.indexOf('|') + 1;
    segStart = i;
  }
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '|') {
      flush(i);
      segStart = i + 1;
    }
  }
  if (segStart < text.length) flush(text.length);
  return out;
}

function parseList(all: Line[], from: number, ctx: Ctx): number {
  let i = from;
  const first = BULLET.exec((all[from] as Line).text) as RegExpExecArray;
  const baseIndent = indentOf(first[1] as string);
  const kind = /^\d/.test(first[2] as string) ? `ord${(first[2] as string).slice(-1)}` : (first[2] as string);
  while (i < all.length) {
    const line = all[i] as Line;
    const m = BULLET.exec(line.text);
    if (!m) break;
    const itemKind = /^\d/.test(m[2] as string) ? `ord${(m[2] as string).slice(-1)}` : (m[2] as string);
    if (itemKind !== kind || indentOf(m[1] as string) > baseIndent + 3) break;
    const markerLen = (m[1] as string).length + (m[2] as string).length;
    const spaces = (m[3] as string).length;
    const contentCols = indentOf(line.text.slice(0, markerLen)) + (spaces >= 5 ? 1 : Math.max(spaces, 1));
    const firstContent = line.text.slice(markerLen + (spaces >= 5 ? 1 : spaces));
    const body: Line[] = [{ text: firstContent, start: line.start + markerLen + (spaces >= 5 ? 1 : spaces) }];
    let j = i + 1;
    let afterBlank = false;
    while (j < all.length) {
      const current = all[j] as Line;
      if (blank(current)) {
        body.push({ text: '', start: current.start });
        afterBlank = true;
        j += 1;
        continue;
      }
      const cols = indentOf(current.text);
      if (cols >= contentCols) {
        body.push(strip(current, contentCols));
        afterBlank = false;
        j += 1;
        continue;
      }
      if (!afterBlank && !startsBlock(current) && !BULLET.test(current.text)) {
        body.push({ text: current.text, start: current.start });
        j += 1;
        continue;
      }
      break;
    }
    // trailing blank lines do not belong to the item
    while (body.length > 1 && blank(body[body.length - 1] as Line)) body.pop();
    parseItem(body, line.start + (line.text.length - line.text.trimStart().length), ctx);
    i = j;
    // skip blank lines between items of a loose list when the next line continues this list
    let k = i;
    while (k < all.length && blank(all[k] as Line)) k += 1;
    if (k < all.length) {
      const nm = BULLET.exec((all[k] as Line).text);
      const nk = nm
        ? /^\d/.test(nm[2] as string)
          ? `ord${(nm[2] as string).slice(-1)}`
          : (nm[2] as string)
        : '';
      if (nm && nk === kind && indentOf(nm[1] as string) <= baseIndent + 3 && k > i) i = k;
    }
  }
  return i;
}

function parseItem(body: Line[], markerStart: number, ctx: Ctx): void {
  // the item's own text: lines up to a blank line or the start of a nested block
  let n = 1;
  while (n < body.length) {
    const line = body[n] as Line;
    if (blank(line)) break;
    if (startsBlock(line, true) || BULLET.test(line.text)) break;
    n += 1;
  }
  const last = body[n - 1] as Line;
  const end = last.start + last.text.trimEnd().length;
  push(ctx, 'list_item', markerStart, end);
  const rest = body.slice(n);
  if (rest.length > 0) parseBlocks(rest, { ...ctx, mode: 'sentence', depth: ctx.depth + 1 });
}

/* ---------- front matter ---------- */

function frontMatter(ctx: Ctx, lines: Line[]): number {
  const open = lines[0];
  if (!open || !/^---[ \t]*$/.test(open.text)) return 0;
  let close = -1;
  for (let k = 1; k < lines.length; k += 1) {
    if (/^(---|\.\.\.)[ \t]*$/.test((lines[k] as Line).text)) {
      close = k;
      break;
    }
  }
  if (close < 0) return 0;
  const innerStart = (lines[1] as Line | undefined)?.start ?? open.start + open.text.length;
  const closeLine = lines[close] as Line;
  const inner = ctx.source.slice(innerStart, closeLine.start);
  const doc = parseDocument(inner, { prettyErrors: false });
  const found: Array<{
    range: [number, number, number];
    type: string | undefined;
    ypath: string[];
    value: string;
  }> = [];
  visit(doc, {
    Scalar(key, node, ancestors) {
      if (key === 'key') return;
      if (typeof node.value !== 'string' || !node.range) return;
      const ypath: string[] = [];
      for (let a = 0; a < ancestors.length; a += 1) {
        const here = ancestors[a];
        const child = ancestors[a + 1] ?? node;
        if (isPair(here)) {
          const k = here.key;
          ypath.push(isScalar(k) ? String(k.value) : String(k));
        } else if (isSeq(here)) {
          ypath.push(String(here.items.indexOf(child as never)));
        }
      }
      found.push({
        range: node.range as [number, number, number],
        type: node.type,
        ypath,
        value: node.value,
      });
    },
  });
  for (const f of found) {
    let start = innerStart + f.range[0];
    let end = innerStart + f.range[1];
    if (f.type === 'QUOTE_DOUBLE' || f.type === 'QUOTE_SINGLE') {
      start += 1;
      end -= 1;
    } else if (f.type === 'BLOCK_FOLDED' || f.type === 'BLOCK_LITERAL') {
      const newline = ctx.source.indexOf('\n', start);
      start = newline + 1;
      while (end > start && /\s/.test(ctx.source[end - 1] as string)) end -= 1;
    }
    push(ctx, 'front_matter', start, end, { yamlPath: f.ypath });
  }
  return close + 1;
}

/* ---------- entry ---------- */

export function cutText(source: string): CutResult {
  const bom = source.startsWith('﻿') ? 1 : 0;
  const ctx: Ctx = { source, units: [], stack: [], mode: 'sentence', htmlDepth: 0, depth: 0 };
  const lines = toLines(source, bom);
  const skip = frontMatter(ctx, lines);
  parseBlocks(lines.slice(skip), ctx);
  const digest = sha(ctx.units.map((u) => u.fp).join('\n'));
  return { units: ctx.units, cutDigest: digest };
}
