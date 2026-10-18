import { createHash } from 'node:crypto';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * Layer A of the pointer reader: cut a prose file into units by its structure. No word list, phrase pattern
 * or grammar tagger is used: a unit is a sentence, a list item, a table cell, a block quote paragraph, a
 * heading or a front matter value, and every unit is `source.slice(start, end)` of the file it came from.
 */

export type Container =
  | 'heading'
  | 'sentence'
  | 'list_item'
  | 'table_cell'
  | 'block_quote'
  | 'front_matter_value'
  | 'opaque';

export type Unit = {
  container: Container;
  /** UTF-16 offsets into the original file, byte-order mark included. */
  start: number;
  end: number;
  text: string;
  /** Fingerprint of the text: the unit's identity for change detection. */
  fp: string;
  /** The headings above the unit, outermost first. */
  path: string[];
  /** For a front matter value: its YAML path, such as `$.description`. */
  key?: string;
};

export type Cut = { units: Unit[]; digest: string };

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** NFC, white space collapsed, container markers stripped; case and emphasis are kept (prompts use them for force). */
export function fingerprint(text: string): string {
  const body = text
    .normalize('NFC')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|/gm, '')
    .replace(/\|\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sha(body).slice(0, 16);
}

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' });

/** A same-length mask of the spans that must not be cut: inline code, URLs, link destinations, emphasis marks. */
function mask(text: string): string {
  const letters = (match: string) => 'x'.repeat(match.length);
  const spaces = (match: string) => ' '.repeat(match.length);
  return text
    .replace(/`+[^`]*`+/g, letters)
    .replace(/\]\([^)]*\)/g, letters)
    .replace(/https?:\/\/\S+/g, letters)
    .replace(/\*+/g, spaces)
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, spaces)
    .replace(/\n/g, ' ');
}

/** Whether a segment break is a likely false split, decided by the shape of the text around it only. */
function shouldMerge(before: string, after: string): boolean {
  const head = before.trimEnd();
  // A short capitalised word or a single-letter abbreviation before the stop: "Dr.", "e.g.", "A."
  if (/(?:^|[\s(])(\p{Lu}\p{Ll}{0,2}|\p{L}|\p{L}\.\p{L})\.$/u.test(head)) return true;
  if (/\d\.$/.test(head) && /^\d/.test(after.trimStart())) return true;
  // A sentence rarely starts in lower case or with a closing mark.
  if (/^\s*[\p{Ll}\d]/u.test(after)) return true;
  if (/^\s*[)\]"'”’]/.test(after)) return true;
  return false;
}

/** A paragraph that opens or closes with a line holding only a tag does not own that line. */
function withoutTagLines(source: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  for (;;) {
    const open = source.indexOf('\n', start);
    if (open !== -1 && open < end && TAG_ONLY.test(source.slice(start, open))) start = open + 1;
    else break;
  }
  for (;;) {
    const close = source.lastIndexOf('\n', end - 1);
    if (close >= start && TAG_ONLY.test(source.slice(close + 1, end))) end = close;
    else break;
  }
  return [start, end];
}

function trimSpan(source: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source[start] ?? '')) start++;
  while (end > start && /\s/.test(source[end - 1] ?? '')) end--;
  return [start, end];
}

/** The sentence spans of `source[from, to)`, merged when unsure: a wrong merge costs granularity, a wrong split a wrong quote. */
export function sentenceSpans(source: string, from: number, to: number): Array<[number, number]> {
  const masked = mask(source.slice(from, to));
  const spans: Array<[number, number]> = [];
  let current: [number, number] | undefined;
  for (const segment of SEGMENTER.segment(masked)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    if (masked.slice(start, end).trim() === '') continue;
    if (current && shouldMerge(masked.slice(current[0], current[1]), masked.slice(start, end))) {
      current[1] = end;
    } else {
      if (current) spans.push(current);
      current = [start, end];
    }
  }
  if (current) spans.push(current);
  return spans.map(([start, end]) => trimSpan(source, from + start, from + end));
}

type Node = {
  type: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  depth?: number;
};

const PROCESSOR = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm);

type Context = { inList?: boolean; inQuote?: boolean };

const TAG_ONLY = /^\s*<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>\s*$/;

/** Cuts a file into units, and hashes the ordered list of unit fingerprints into the cut digest. */
export function cut(rawSource: string): Cut {
  const base = rawSource.charCodeAt(0) === 0xfeff ? 1 : 0;
  const source = rawSource.slice(base);
  const units: Unit[] = [];

  const add = (container: Container, start: number, end: number, path: string[], key?: string) => {
    const [from, to] = trimSpan(source, start, end);
    if (to <= from) return;
    const text = source.slice(from, to);
    units.push({
      container,
      start: from + base,
      end: to + base,
      text,
      fp: fingerprint(text),
      path: [...path],
      ...(key ? { key } : {}),
    });
  };

  const firstLineEnd = (from: number, to: number): number => {
    const newline = source.indexOf('\n', from);
    return newline === -1 || newline > to ? to : newline;
  };

  const frontMatter = (start: number, end: number) => {
    const block = source.slice(start, end);
    const opening = /^---\r?\n/.exec(block)?.[0] ?? '';
    const body = block.slice(opening.length).replace(/\r?\n---\s*$/, '');
    try {
      const document = parseDocument(body);
      const walk = (node: unknown, key: string) => {
        if (isScalar(node) && typeof node.value === 'string' && node.range) {
          const [from, to] = node.range;
          add('front_matter_value', start + opening.length + from, start + opening.length + to, [], key);
        } else if (isMap(node)) {
          for (const pair of node.items) {
            walk(pair.value, `${key}.${String((pair.key as { value?: unknown } | null)?.value)}`);
          }
        } else if (isSeq(node)) {
          node.items.forEach((item, index) => {
            walk(item, `${key}[${index}]`);
          });
        }
      };
      walk(document.contents, '$');
    } catch {
      add('opaque', start, firstLineEnd(start, end), []);
    }
  };

  const markdown = (text: string, offset: number, inherited: string[], depth: number) => {
    const tree = PROCESSOR.parse(text) as unknown as Node;
    const trail: Array<{ depth: number; title: string }> = [];
    const here = () => [...inherited, ...trail.map((entry) => entry.title)];
    const at = (n: number | undefined) => (n ?? 0) + offset;

    const htmlBlock = (from: number, to: number) => {
      const block = text.slice(from, to);
      if (/^\s*<!--/.test(block)) {
        add('opaque', at(from), at(from) + (block.split('\n')[0] ?? '').length, here());
        return;
      }
      // Lines that hold only a tag separate chunks; the markdown between them is cut like any prose.
      let position = from;
      let chunkStart = -1;
      let chunkEnd = -1;
      const flush = () => {
        if (chunkStart >= 0) markdown(text.slice(chunkStart, chunkEnd), at(chunkStart), here(), depth + 1);
        chunkStart = -1;
      };
      for (const line of block.split('\n')) {
        if (TAG_ONLY.test(line)) flush();
        else {
          if (chunkStart < 0) chunkStart = position;
          chunkEnd = position + line.length;
        }
        position += line.length + 1;
      }
      flush();
    };

    const visit = (node: Node, context: Context) => {
      let start = node.position?.start.offset ?? 0;
      let end = node.position?.end.offset ?? 0;
      switch (node.type) {
        case 'yaml':
          if (depth === 0) frontMatter(start, end);
          return;
        case 'heading': {
          const kids = node.children ?? [];
          const first = kids[0]?.position?.start.offset ?? start;
          const last = kids.at(-1)?.position?.end.offset ?? end;
          const title = text.slice(first, last).trim();
          while (trail.length > 0 && (trail.at(-1)?.depth ?? 0) >= (node.depth ?? 1)) trail.pop();
          add('heading', at(start), at(end), here());
          trail.push({ depth: node.depth ?? 1, title });
          return;
        }
        case 'paragraph': {
          [start, end] = withoutTagLines(text, start, end);
          if (context.inList) return add('list_item', at(start), at(end), here());
          if (context.inQuote) return add('block_quote', at(start), at(end), here());
          for (const [from, to] of sentenceSpans(text, start, end)) add('sentence', at(from), at(to), here());
          return;
        }
        case 'code':
          // A fence is opaque: its first line only, never a unit a label can point at.
          return add('opaque', at(start), at(firstLineEnd(start, end)), here());
        case 'html': {
          // An html block that holds an html block of its own and does not shrink is cut as opaque, so the parse ends.
          if (depth >= 2) return add('opaque', at(start), at(firstLineEnd(start, end)), here());
          return htmlBlock(start, end);
        }
        case 'tableCell': {
          const kids = node.children ?? [];
          if (kids.length > 0) {
            const first = kids[0]?.position?.start.offset ?? start;
            const last = kids.at(-1)?.position?.end.offset ?? end;
            add('table_cell', at(first), at(last), here());
          }
          return;
        }
        case 'listItem': {
          for (const child of node.children ?? []) {
            visit(child, { ...context, inList: child.type === 'paragraph' });
          }
          return;
        }
        case 'blockquote': {
          for (const child of node.children ?? []) visit(child, { ...context, inQuote: true });
          return;
        }
        default:
          for (const child of node.children ?? []) visit(child, context);
      }
    };

    for (const child of tree.children ?? []) visit(child, {});
  };

  markdown(source, 0, [], 0);
  return { units, digest: sha(units.map((unit) => `${unit.container}:${unit.fp}`).join('\n')) };
}
