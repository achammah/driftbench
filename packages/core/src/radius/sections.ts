import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { normalizePrompt } from './prompt-diff';

/**
 * A section registry: the stable ids of the sections of one version of a prompt, with where each
 * section sits, a hash of its text and an anchor to find it again in the next version. It lives beside
 * the prompt as `prompts/<id>.sections.yaml`. Block links name a section by its id, never by offsets.
 *
 * Offsets are UTF-16 code units after NFC and CRLF/CR to LF, end exclusive: the unit of the radius
 * prompt anchors (prompt-diff.ts). A pointer from another source in another unit, such as an Anthropic
 * citation in code points, is converted first (citations.ts).
 */

export const SECTION_NORMALISATION = 'NFC; CRLF/CR->LF; offsets in UTF-16 code units; end exclusive';
export const SECTION_KINDS = ['rule', 'persona', 'format', 'tool_guide', 'example', 'context'] as const;
export const SECTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const Span = z
  .strictObject({
    start: z.number().int().min(0).describe('The first UTF-16 code unit of the section.'),
    end: z.number().int().min(0).describe('One past the last UTF-16 code unit, end exclusive.'),
  })
  .refine((span) => span.end > span.start, { message: 'a span ends after it starts' });

export const PromptSection = z
  .strictObject({
    id: z
      .string()
      .regex(SECTION_ID, 'letters, digits, dots, underscores and hyphens, starting with a letter or digit')
      .describe('The stable id of the section. Never reused for other text.'),
    title: z.string().optional().describe('A title for the reader.'),
    kind: z
      .enum(SECTION_KINDS)
      .optional()
      .describe(`What the section holds: ${SECTION_KINDS.join(', ')}.`),
    scope: z
      .enum(['local', 'global'])
      .describe(
        'global: the section can reach every block (persona, language, tone); a change to it selects every block and localisation cannot rank it. local: only the blocks linked to it.',
      ),
    span: Span.describe('Where the section sits in this version of the prompt.'),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe('The SHA-256 of the section text.'),
    anchor: z
      .strictObject({
        quote: z.string().min(1).describe('A verbatim quote inside the section, unique in the prompt.'),
        prefix: z.string().optional().describe('The text just before the quote.'),
        suffix: z.string().optional().describe('The text just after the quote.'),
      })
      .describe('How to find the section again in the next version of the prompt.'),
    references: z
      .array(z.string())
      .optional()
      .describe('Sections this one refers to ("see X"). A change to X can change how this one reads.'),
    overrides: z
      .array(z.string())
      .optional()
      .describe('Sections this one narrows or extends. A change to them can change this one.'),
    duplicates: z
      .array(z.string())
      .optional()
      .describe('Sections that state the same rule. A change to one is read as a change to all.'),
    stale: z
      .boolean()
      .optional()
      .describe(
        'True after a re-anchoring that could not find the section again. Its span and hash are those of the last version where it was found; every link to it reads as stale until its span is declared again.',
      ),
  })
  .describe('One section of the prompt.');
export type PromptSection = z.infer<typeof PromptSection>;

export const SectionRegistry = z
  .strictObject({
    prompt_id: z.string().min(1).describe('The id of the prompt. Links name it as `to.prompt`.'),
    version: z.string().min(1).describe('The version of the prompt this registry describes.'),
    normalisation: z
      .literal(SECTION_NORMALISATION)
      .optional()
      .describe('The offset unit, written for the reader.'),
    text_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe('The SHA-256 of the whole normalised prompt text.'),
    sections: z.array(PromptSection).min(1).describe('The sections, in prompt order.'),
  })
  .describe('The section registry of one version of a prompt.');
export type SectionRegistry = z.infer<typeof SectionRegistry>;

export type RegistryResult = { ok: true; registry: SectionRegistry } | { ok: false; errors: string[] };

/** The full SHA-256 in hex of a text, as the registry stores it. */
export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Validates a parsed document as a registry: its schema, unique ids and known section references. */
export function parseSectionRegistry(value: unknown): RegistryResult {
  const parsed = SectionRegistry.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(file)'}: ${issue.message}`),
    };
  }
  const registry = parsed.data;
  const errors: string[] = [];
  const ids = new Set<string>();
  registry.sections.forEach((section, index) => {
    if (ids.has(section.id)) errors.push(`sections.${index}.id: the id ${section.id} is used twice`);
    ids.add(section.id);
  });
  registry.sections.forEach((section, index) => {
    for (const key of ['references', 'overrides', 'duplicates'] as const) {
      for (const id of section[key] ?? []) {
        if (!ids.has(id)) errors.push(`sections.${index}.${key}: no section has the id ${id}`);
      }
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, registry };
}

/** Reads a registry file, YAML or JSON. A file that does not parse is an error, never an empty registry. */
export async function loadSectionRegistry(path: string): Promise<RegistryResult> {
  let value: unknown;
  try {
    const text = await readFile(path, 'utf8');
    value = extname(path).toLowerCase() === '.json' ? JSON.parse(text) : parseYaml(text);
  } catch (cause) {
    return { ok: false, errors: [cause instanceof Error ? cause.message : String(cause)] };
  }
  return parseSectionRegistry(value);
}

function count(text: string, quote: string): number[] {
  const at: number[] = [];
  if (quote === '') return at;
  for (let from = text.indexOf(quote); from >= 0; from = text.indexOf(quote, from + 1)) at.push(from);
  return at;
}

/**
 * Whether the registry describes this prompt text: the whole-text hash, each section's span and hash,
 * each anchor found once and inside its section, and no two sections overlapping. Stale sections are
 * not checked against the text. Returns the problems; empty when the registry matches.
 */
export function checkSectionRegistry(registry: SectionRegistry, prompt: string): string[] {
  const text = normalizePrompt(prompt);
  const problems: string[] = [];
  if (sha256Hex(text) !== registry.text_sha256)
    problems.push('text_sha256: the registry does not describe this prompt text');
  const live = registry.sections.filter((section) => section.stale !== true);
  for (const section of live) {
    const { start, end } = section.span;
    if (end > text.length) {
      problems.push(`${section.id}: the span ends at ${end}, past the end of the prompt (${text.length})`);
      continue;
    }
    if (sha256Hex(text.slice(start, end)) !== section.sha256)
      problems.push(`${section.id}: the text at ${start}-${end} does not match the section hash`);
    const at = count(text, section.anchor.quote);
    if (at.length !== 1)
      problems.push(`${section.id}: the anchor quote is found ${at.length} times, not once`);
    else if ((at[0] ?? -1) < start || (at[0] ?? 0) + section.anchor.quote.length > end)
      problems.push(`${section.id}: the anchor quote lies outside the section`);
  }
  const sorted = [...live].sort((a, b) => a.span.start - b.span.start);
  for (let index = 1; index < sorted.length; index++) {
    const before = sorted[index - 1];
    const next = sorted[index];
    if (before && next && next.span.start < before.span.end)
      problems.push(`${before.id} and ${next.id} overlap`);
  }
  return problems;
}

const WINDOW = 32;

function slug(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base === '' ? 'section' : base;
}

const SCANS_BEFORE_INDEX = 8;
let scanned: { text: string; calls: number } | undefined;

/** Whether the sections of this text have asked often enough that the suffix index is cheaper than another scan. */
function readsIndex(text: string): boolean {
  if (scanned?.text !== text) scanned = { text, calls: 0 };
  scanned.calls++;
  return scanned.calls > SCANS_BEFORE_INDEX || suffixes?.text === text;
}

type SuffixIndex = { text: string; rank: Int32Array; lcp: Int32Array };
let suffixes: SuffixIndex | undefined;

/**
 * The suffix array of a text with the longest common prefix of neighbouring suffixes (prefix doubling with
 * counting sorts, then Kasai), kept for the last text asked about: every section of one prompt reads the same
 * index, so it is built once, when the first section needs it. O(n log n) in the text.
 */
function suffixIndex(text: string): SuffixIndex {
  if (suffixes?.text === text) return suffixes;
  const n = text.length;
  let rank = new Int32Array(n);
  let next = new Int32Array(n);
  const sa = new Int32Array(n);
  const byEnd = new Int32Array(n);
  let buckets = 65536;
  const count = new Int32Array(Math.max(buckets, n) + 1);
  for (let i = 0; i < n; i++) {
    rank[i] = text.charCodeAt(i);
    const c = rank[i] as number;
    count[c] = (count[c] ?? 0) + 1;
  }
  for (let i = 1; i < buckets; i++) count[i] = (count[i] ?? 0) + (count[i - 1] ?? 0);
  for (let i = n - 1; i >= 0; i--) {
    const c = rank[i] as number;
    const slot = (count[c] ?? 0) - 1;
    count[c] = slot;
    sa[slot] = i;
  }
  for (let k = 1; n > 1; k <<= 1) {
    let at = 0;
    for (let i = n - k; i < n; i++) byEnd[at++] = i;
    for (let i = 0; i < n; i++) if ((sa[i] as number) >= k) byEnd[at++] = (sa[i] as number) - k;
    count.fill(0, 0, buckets + 1);
    for (let i = 0; i < n; i++) {
      const c = rank[i] as number;
      count[c] = (count[c] ?? 0) + 1;
    }
    for (let i = 1; i < buckets; i++) count[i] = (count[i] ?? 0) + (count[i - 1] ?? 0);
    for (let i = n - 1; i >= 0; i--) {
      const suffix = byEnd[i] as number;
      const c = rank[suffix] as number;
      const slot = (count[c] ?? 0) - 1;
      count[c] = slot;
      sa[slot] = suffix;
    }
    let classes = 0;
    next[sa[0] as number] = 0;
    for (let i = 1; i < n; i++) {
      const a = sa[i] as number;
      const b = sa[i - 1] as number;
      const same =
        rank[a] === rank[b] &&
        (a + k < n ? (rank[a + k] as number) : -1) === (b + k < n ? (rank[b + k] as number) : -1);
      if (!same) classes++;
      next[a] = classes;
    }
    [rank, next] = [next, rank];
    if (classes >= n - 1) break;
    buckets = classes + 1;
  }
  if (n === 1) rank[0] = 0;
  const lcp = new Int32Array(n);
  let h = 0;
  for (let i = 0; i < n; i++) {
    const r = rank[i] as number;
    if (r === 0) {
      h = 0;
      continue;
    }
    const j = sa[r - 1] as number;
    while (i + h < n && j + h < n && text.charCodeAt(i + h) === text.charCodeAt(j + h)) h++;
    lcp[r] = h;
    if (h > 0) h--;
  }
  suffixes = { text, rank, lcp };
  return suffixes;
}

/** The length of the longest stretch from `origin` that another place in the text repeats. */
function longestRepeat(text: string, origin: number): number {
  const { rank, lcp } = suffixIndex(text);
  const r = rank[origin] as number;
  return Math.max(r > 0 ? (lcp[r] as number) : 0, r < text.length - 1 ? (lcp[r + 1] as number) : 0);
}

/** The shortest prefix of the section's body (at least 24 units, or all of it) found once in the text. */
function uniqueQuote(text: string, start: number, end: number): { quote: string; at: number } | undefined {
  let from = start;
  // Skip the heading line, so the quote is body text when the section has a body.
  const newline = text.indexOf('\n', start);
  if (newline >= 0 && newline + 1 < end && /^#{1,6}\s/.test(text.slice(start, newline))) from = newline + 1;
  while (from < end && /\s/.test(text[from] ?? '')) from++;
  for (const origin of from < end ? [from, start] : [start]) {
    const room = end - origin;
    // The common case first: the shortest allowed prefix occurs once, here. One scan of the text per section, so
    // after a few sections of the same text the index below answers instead.
    if (!readsIndex(text)) {
      const shortest = text.slice(origin, origin + Math.min(24, room));
      if (
        shortest.trim() !== '' &&
        text.indexOf(shortest) === origin &&
        text.indexOf(shortest, origin + 1) < 0
      )
        return { quote: shortest, at: origin };
    }
    // A prefix is unique once it is longer than every repeat of the text from here, and it needs a visible character.
    let visible = 0;
    while (visible < room && /\s/.test(text[origin + visible] ?? '')) visible++;
    if (visible >= room) continue;
    const length = Math.max(Math.min(24, room), visible + 1, longestRepeat(text, origin) + 1);
    if (length <= room) return { quote: text.slice(origin, origin + length), at: origin };
  }
  return undefined;
}

/** A section entry for the text at `start` to `end`. Undefined when no quote inside it is unique. */
export function sectionEntry(
  text: string,
  start: number,
  end: number,
  fields: Omit<PromptSection, 'span' | 'sha256' | 'anchor'>,
): PromptSection | undefined {
  const found = uniqueQuote(text, start, end);
  if (!found) return undefined;
  return {
    ...fields,
    span: { start, end },
    sha256: sha256Hex(text.slice(start, end)),
    anchor: {
      quote: found.quote,
      prefix: text.slice(Math.max(0, found.at - WINDOW), found.at),
      suffix: text.slice(found.at + found.quote.length, found.at + found.quote.length + WINDOW),
    },
  };
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const CONTAINER = /^ {0,3}(?:>[ \t]?|(?:[-+*]|(\d{1,9})[.)])(?:[ \t]+|$))/;

/**
 * The text after a quote marker or a list marker, when the line starts a container that can interrupt the
 * current paragraph: a paragraph is only interrupted by a bullet or by `1.`, and only by an item with content.
 */
function containerRest(line: string, inParagraph: boolean): string | undefined {
  const match = CONTAINER.exec(line);
  if (!match) return undefined;
  const rest = line.slice(match[0].length);
  const quote = match[0].trimStart().startsWith('>');
  if (inParagraph && !quote && (rest.trim() === '' || (match[1] !== undefined && Number(match[1]) !== 1)))
    return undefined;
  return rest;
}

/** The lines of a leading YAML front matter block (a first line of `---` up to the next `---` line), else 0. */
function frontMatterLines(lines: string[]): number {
  if (lines[0]?.trimEnd() !== '---') return 0;
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  return close < 0 ? 0 : close + 1;
}

/**
 * The headings of a markdown text as CommonMark reads them, of level 1 to `level`: ATX headings indented up to
 * three spaces with their closing # sequence dropped, and setext headings (a paragraph underlined with = or -).
 * A # line inside a fenced code block is code, not a heading, and a leading YAML front matter block is not read.
 * `at` is where the heading starts, after its indentation; for a setext heading, where the first line of its
 * paragraph starts.
 */
function markdownHeadings(text: string, level: number): { at: number; title: string }[] {
  const found: { at: number; title: string }[] = [];
  let fence: { char: string; length: number; inContainer: boolean } | undefined;
  let paragraph: { at: number; lines: string[] } | undefined;
  // After a quote or a list item, a line without a blank before it continues that container (lazily).
  let container = false;
  let offset = 0;
  const lines = text.split('\n');
  const skip = frontMatterLines(lines);
  for (const [number, line] of lines.entries()) {
    const lineStart = offset;
    offset += line.length + 1;
    if (number < skip) continue;
    if (fence) {
      const close = (fence.inContainer ? /^[ \t>]*(`+|~+)[ \t]*$/ : /^ {0,3}(`+|~+)[ \t]*$/).exec(line);
      if (close?.[1]?.[0] === fence.char && close[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (line.trim() === '') {
      paragraph = undefined;
      container = false;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    const open = FENCE_OPEN.exec(line);
    if (open?.[1] && !(open[1][0] === '`' && (open[2] ?? '').includes('`'))) {
      paragraph = undefined;
      fence = { char: open[1][0] ?? '`', length: open[1].length, inContainer: false };
      continue;
    }
    const atx = ATX.exec(line);
    if (atx?.[1]) {
      paragraph = undefined;
      container = false;
      if (atx[1].length <= level) {
        const title = (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
        found.push({ at: lineStart + indent, title });
      }
      continue;
    }
    const underline = SETEXT_UNDERLINE.exec(line);
    if (underline?.[1] && paragraph && !container) {
      if (underline[1][0] === '=' ? 1 <= level : 2 <= level)
        found.push({ at: paragraph.at, title: paragraph.lines.join(' ') });
      paragraph = undefined;
      continue;
    }
    if (THEMATIC_BREAK.test(line)) {
      paragraph = undefined;
      container = false;
      continue;
    }
    const inner = containerRest(line, paragraph !== undefined);
    if (inner !== undefined) {
      paragraph = undefined;
      container = true;
      // A fence can open on the marker line itself: `- ```` or `> ~~~`.
      const nested = FENCE_OPEN.exec(inner.replace(/^[ \t]+/, ''));
      if (nested?.[1] && !(nested[1][0] === '`' && (nested[2] ?? '').includes('`')))
        fence = { char: nested[1][0] ?? '`', length: nested[1].length, inContainer: true };
      continue;
    }
    if (container) continue;
    // Indented code cannot start a paragraph; inside one, an indented line is a continuation.
    if (indent >= 4 && !paragraph) continue;
    if (paragraph) paragraph.lines.push(line.trim());
    else paragraph = { at: lineStart + indent, lines: [line.trim()] };
  }
  return found;
}

/**
 * A first registry for a markdown prompt: one section per CommonMark heading of level 1 to `level` (ATX or
 * setext, never one inside a fenced code block, none in a leading front matter block), from the heading to the
 * next one, the text before the first heading as `preamble`. Ids are the slugged titles; a repeated slug takes
 * the next free `_2`, `_3`, ... A heading whose section holds no quote that is unique in the prompt (an empty
 * heading next to another) is folded into the section before it, or into the one after it when it comes first.
 * Every section starts global, the safe reading: the author marks local the sections that reach only
 * the blocks linked to them, and adds references and overrides.
 */
export function sectionsFromHeadings(
  prompt: string,
  options: { promptId: string; version: string; level?: number },
): RegistryResult {
  const text = normalizePrompt(prompt);
  const level = options.level ?? 2;
  const starts = markdownHeadings(text, level);
  if (starts.length === 0 || (starts[0]?.at ?? 0) > 0) {
    const firstAt = starts[0]?.at ?? text.length;
    if (text.slice(0, firstAt).trim() !== '') starts.unshift({ at: 0, title: 'preamble' });
  }
  const spanEnd = (index: number): number => {
    const from = starts[index]?.at ?? 0;
    let end = starts[index + 1]?.at ?? text.length;
    while (end > from + 1 && /\s/.test(text[end - 1] ?? '')) end--;
    return end;
  };
  // Anchor each section; one that cannot be anchored is folded into a neighbour, then its neighbour is anchored again.
  const entries: PromptSection[] = [];
  for (let index = 0; index < starts.length; ) {
    const start = starts[index];
    const entry = start && sectionEntry(text, start.at, spanEnd(index), { id: 'section', scope: 'global' });
    if (entry || !start || starts.length === 1) {
      if (entry) entries[index] = entry;
      index++;
      continue;
    }
    const next = starts[index + 1];
    if (index === 0 && next) next.at = start.at;
    starts.splice(index, 1);
    entries.splice(index, 1);
    index = Math.max(0, index - 1);
  }
  const errors: string[] = [];
  const sections: PromptSection[] = [];
  const taken = new Set<string>();
  starts.forEach((each, index) => {
    const base = slug(each.title);
    let id = base;
    for (let next = 2; taken.has(id); next++) id = `${base}_${next}`;
    taken.add(id);
    const entry = entries[index];
    if (entry) sections.push({ ...entry, id, title: each.title });
    else errors.push(`${id}: no quote inside the section is unique in the prompt`);
  });
  if (sections.length === 0) errors.push('the prompt has no section');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    registry: {
      prompt_id: options.promptId,
      version: options.version,
      normalisation: SECTION_NORMALISATION,
      text_sha256: sha256Hex(text),
      sections,
    },
  };
}

export type ReanchorMethod = 'same_hash' | 'quote' | 'window';

export type ReanchoredSection = {
  id: string;
  /** kept: same text at the same offsets. moved: same text found at new offsets. stale: not found again. */
  status: 'kept' | 'moved' | 'stale';
  /** How the section was found again; absent when stale. */
  method?: ReanchorMethod;
  from: { start: number; end: number };
  /** The new span; absent when stale. */
  to?: { start: number; end: number };
  /** For a stale section: why. */
  reason?: string;
};

export type Reanchoring = {
  /** The registry of the new version: found sections at their new spans, stale ones flagged. */
  registry: SectionRegistry;
  sections: ReanchoredSection[];
  /**
   * Text that changed outside every section, whitespace aside: such a change can reach any block. Each
   * entry names the sections around it. Empty when every change lies inside a stale section.
   */
  outside: string[];
  /** Sections whose order relative to the others changed. */
  reordered: string[];
};

const squash = (text: string) => text.replace(/\s+/g, '');

/**
 * Re-anchors a registry on the next version of its prompt. For each section, in order: the same text
 * found once in the new prompt (`same_hash`); else the anchor quote found once, and the old text found
 * at the same distance from it (`quote`); else the prefix, quote and suffix window found once, the same
 * way (`window`); else `stale`. A section is only ever placed where its text hashes as before, so a
 * section is never anchored to the wrong text: an edit inside a section makes it stale.
 *
 * `before` must be the text the registry describes (its `text_sha256`); a mismatch is an error.
 */
export function reanchorRegistry(
  registry: SectionRegistry,
  before: string,
  after: string,
  version: string,
): { ok: true; result: Reanchoring } | { ok: false; errors: string[] } {
  const old = normalizePrompt(before);
  const next = normalizePrompt(after);
  if (sha256Hex(old) !== registry.text_sha256)
    return {
      ok: false,
      errors: ['the registry does not describe the old prompt text (text_sha256 differs)'],
    };
  const sections: ReanchoredSection[] = [];
  const entries: PromptSection[] = [];
  for (const section of registry.sections) {
    const from = section.span;
    const body = old.slice(from.start, from.end);
    if (section.stale === true || sha256Hex(body) !== section.sha256) {
      sections.push({ id: section.id, status: 'stale', from, reason: 'already stale in the old registry' });
      entries.push({ ...section, stale: true });
      continue;
    }
    let to: { start: number; end: number } | undefined;
    let method: ReanchorMethod | undefined;
    const exact = count(next, body);
    if (exact.length === 1 && exact[0] !== undefined) {
      to = { start: exact[0], end: exact[0] + body.length };
      method = 'same_hash';
    }
    const quoteAt = old.indexOf(section.anchor.quote, from.start);
    const offset = quoteAt - from.start;
    const place = (needle: string, inner: number, how: ReanchorMethod) => {
      if (to || quoteAt < 0) return;
      const found = count(next, needle);
      if (found.length !== 1 || found[0] === undefined) return;
      const start = found[0] + inner - offset;
      if (start >= 0 && next.slice(start, start + body.length) === body) {
        to = { start, end: start + body.length };
        method = how;
      }
    };
    place(section.anchor.quote, 0, 'quote');
    const prefix = section.anchor.prefix ?? '';
    place(prefix + section.anchor.quote + (section.anchor.suffix ?? ''), prefix.length, 'window');
    if (!to || !method) {
      const quoteFound = count(next, section.anchor.quote).length === 1;
      sections.push({
        id: section.id,
        status: 'stale',
        from,
        reason: quoteFound
          ? 'the anchor is found but the section text changed: edited inside'
          : 'neither the text nor the anchor is found once: edited or removed',
      });
      entries.push({ ...section, stale: true });
      continue;
    }
    sections.push({
      id: section.id,
      status: to.start === from.start ? 'kept' : 'moved',
      method,
      from,
      to,
    });
    const { stale: _stale, ...live } = section;
    entries.push({ ...live, span: to });
  }

  // Order: the found sections must keep their relative order.
  const found = sections.filter((each) => each.to !== undefined);
  const reordered: string[] = [];
  const byNew = [...found].sort((a, b) => (a.to?.start ?? 0) - (b.to?.start ?? 0));
  byNew.forEach((each, index) => {
    if (found[index]?.id !== each.id) reordered.push(each.id);
  });

  // Outside: between two consecutive found sections (and the ends), the old text minus the stale
  // sections must reappear in the new text, whitespace aside, and nothing else may be added unless a
  // stale section lies between them (its new text is not known).
  const outside: string[] = [];
  if (reordered.length === 0) {
    const bounds = [
      { id: '(start)', from: { start: 0, end: 0 }, to: { start: 0, end: 0 } },
      ...found,
      {
        id: '(end)',
        from: { start: old.length, end: old.length },
        to: { start: next.length, end: next.length },
      },
    ];
    for (let index = 1; index < bounds.length; index++) {
      const left = bounds[index - 1];
      const right = bounds[index];
      if (!left?.to || !right?.to) continue;
      const oldGap = { start: left.from.end, end: right.from.start };
      const stale = registry.sections.filter(
        (section) =>
          sections.find((each) => each.id === section.id)?.status === 'stale' &&
          section.span.start >= oldGap.start &&
          section.span.end <= oldGap.end,
      );
      const newText = squash(next.slice(left.to.end, right.to.start));
      const label = `between ${left.id} and ${right.id}`;
      if (stale.length === 0) {
        if (squash(old.slice(oldGap.start, oldGap.end)) !== newText) outside.push(label);
        continue;
      }
      // The text around the stale sections must survive, in order, before, between and after them.
      const pieces: string[] = [];
      let cursor = oldGap.start;
      for (const section of [...stale].sort((a, b) => a.span.start - b.span.start)) {
        pieces.push(squash(old.slice(cursor, section.span.start)));
        cursor = section.span.end;
      }
      pieces.push(squash(old.slice(cursor, oldGap.end)));
      let at = 0;
      let ok = newText.startsWith(pieces[0] ?? '') && newText.endsWith(pieces[pieces.length - 1] ?? '');
      for (const piece of pieces.slice(1, -1)) {
        const found = newText.indexOf(piece, at);
        if (found < 0) ok = false;
        else at = found + piece.length;
      }
      if (!ok) outside.push(label);
    }
  }
  return {
    ok: true,
    result: {
      registry: { ...registry, version, text_sha256: sha256Hex(next), sections: entries },
      sections,
      outside,
      reordered,
    },
  };
}
