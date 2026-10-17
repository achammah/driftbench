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
        quote: z
          .string()
          .min(1)
          .describe(
            'A verbatim quote inside the section. Unique in the prompt, unless the prompt repeats the text of the section: then `occurrence` says which copy of the quote lies in this section.',
          ),
        prefix: z.string().optional().describe('The text just before the quote.'),
        suffix: z.string().optional().describe('The text just after the quote.'),
        occurrence: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Which occurrence of the quote, from 1 in text order, lies in this section. Absent when the quote is found once; present when identical sections repeat the same text.',
          ),
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

/** Where each needle occurs in one text, searched once: identical sections ask for the same needles. */
function occurrenceFinder(text: string): (needle: string) => number[] {
  const memo = new Map<string, number[]>();
  return (needle) => {
    let at = memo.get(needle);
    if (!at) {
      at = count(text, needle);
      memo.set(needle, at);
    }
    return at;
  };
}

/** The index of `value` in an ascending list, or -1. */
function indexInSorted(list: readonly number[], value: number): number {
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const at = list[middle] as number;
    if (at === value) return middle;
    if (at < value) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

/**
 * Whether the registry describes this prompt text: the whole-text hash, each section's span and hash,
 * each anchor found once (or, with an `occurrence`, found at least that often, its own copy inside the
 * section) and no two sections overlapping. Stale sections are not checked against the text. Returns the
 * problems; empty when the registry matches.
 */
export function checkSectionRegistry(registry: SectionRegistry, prompt: string): string[] {
  const text = normalizePrompt(prompt);
  const problems: string[] = [];
  if (sha256Hex(text) !== registry.text_sha256)
    problems.push('text_sha256: the registry does not describe this prompt text');
  const live = registry.sections.filter((section) => section.stale !== true);
  const find = occurrenceFinder(text);
  for (const section of live) {
    const { start, end } = section.span;
    if (end > text.length) {
      problems.push(`${section.id}: the span ends at ${end}, past the end of the prompt (${text.length})`);
      continue;
    }
    if (sha256Hex(text.slice(start, end)) !== section.sha256)
      problems.push(`${section.id}: the text at ${start}-${end} does not match the section hash`);
    const at = find(section.anchor.quote);
    const occurrence = section.anchor.occurrence;
    const lies = (place: number | undefined) =>
      (place ?? -1) < start || (place ?? 0) + section.anchor.quote.length > end;
    if (occurrence === undefined) {
      if (at.length !== 1)
        problems.push(`${section.id}: the anchor quote is found ${at.length} times, not once`);
      else if (lies(at[0])) problems.push(`${section.id}: the anchor quote lies outside the section`);
    } else if (at.length < occurrence) {
      problems.push(
        `${section.id}: the anchor quote is found ${at.length} times, so it has no occurrence ${occurrence}`,
      );
    } else if (lies(at[occurrence - 1])) {
      problems.push(`${section.id}: occurrence ${occurrence} of the anchor quote lies outside the section`);
    }
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

/** The shortest prefix of the section's body (at least 24 units, or all of it) found once in the text. */
function uniqueQuote(text: string, start: number, end: number): { quote: string; at: number } | undefined {
  let from = start;
  // Skip the heading line, so the quote is body text when the section has a body.
  const newline = text.indexOf('\n', start);
  if (newline >= 0 && newline + 1 < end && /^#{1,6}\s/.test(text.slice(start, newline))) from = newline + 1;
  while (from < end && /\s/.test(text[from] ?? '')) from++;
  for (const origin of from < end ? [from, start] : [start]) {
    for (let length = Math.min(24, end - origin); origin + length <= end; length++) {
      const quote = text.slice(origin, origin + length);
      if (quote.trim() !== '' && count(text, quote).length === 1) return { quote, at: origin };
    }
  }
  return undefined;
}

/** Where a section's quote may start: its first word after the heading line, then the heading itself. */
function quoteOrigins(text: string, start: number, end: number): number[] {
  let from = start;
  const newline = text.indexOf('\n', start);
  if (newline >= 0 && newline + 1 < end && /^#{1,6}\s/.test(text.slice(start, newline))) from = newline + 1;
  while (from < end && /\s/.test(text[from] ?? '')) from++;
  return from < end ? [from, start] : [start];
}

/**
 * For a section whose text the prompt repeats (identical sections): the shortest prefix of its body, at least 24
 * units, that occurs as often as the whole body does, and which occurrence of it (from 1, in text order) lies in
 * this section. The origin is the body or the heading, whichever the prompt repeats less.
 */
function repeatedQuote(
  text: string,
  start: number,
  end: number,
  find: (needle: string) => number[],
): { quote: string; at: number; occurrence?: number } | undefined {
  let best: { origin: number; copies: number } | undefined;
  for (const origin of quoteOrigins(text, start, end)) {
    const whole = text.slice(origin, end);
    if (whole.trim() === '') continue;
    const copies = find(whole).length;
    if (!best || copies < best.copies) best = { origin, copies };
  }
  if (!best) return undefined;
  const { origin, copies } = best;
  const room = end - origin;
  let visible = 0;
  while (visible < room && /\s/.test(text[origin + visible] ?? '')) visible++;
  // Occurrences only fall as the prefix grows, so the shortest prefix with all the copies of the whole is a bisection.
  let low = Math.max(Math.min(24, room), visible + 1);
  let high = room;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (find(text.slice(origin, origin + middle)).length === copies) high = middle;
    else low = middle + 1;
  }
  const quote = text.slice(origin, origin + low);
  const places = find(quote);
  return places.length > 1
    ? { quote, at: origin, occurrence: indexInSorted(places, origin) + 1 }
    : { quote, at: origin };
}

type Fields = Omit<PromptSection, 'span' | 'sha256' | 'anchor'>;
type Quote = { quote: string; at: number; occurrence?: number };

/** A section entry for the text at `start` to `end` anchored on `found`. */
function entryAt(text: string, start: number, end: number, fields: Fields, found: Quote): PromptSection {
  return {
    ...fields,
    span: { start, end },
    sha256: sha256Hex(text.slice(start, end)),
    anchor: {
      quote: found.quote,
      prefix: text.slice(Math.max(0, found.at - WINDOW), found.at),
      suffix: text.slice(found.at + found.quote.length, found.at + found.quote.length + WINDOW),
      ...(found.occurrence === undefined ? {} : { occurrence: found.occurrence }),
    },
  };
}

/** A section entry for the text at `start` to `end`. Undefined when no quote inside it is unique. */
export function sectionEntry(
  text: string,
  start: number,
  end: number,
  fields: Fields,
): PromptSection | undefined {
  const found = uniqueQuote(text, start, end);
  return found ? entryAt(text, start, end, fields, found) : undefined;
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

/** A key line of a YAML mapping: `name: value`, `"quoted key": value`, `key:`. */
const YAML_KEY = /^(?:[\w.-][^:]*|"[^"]*"|'[^']*'):(?:[ \t]|$)/;

/**
 * The lines of a leading YAML front matter block (a first line of `---` up to the next `---` line), else 0. The
 * block must look like a YAML mapping: empty, or with at least one key line and no other unindented line but
 * comments and `- ` items. Otherwise the two `---` lines are thematic breaks or underlines and the text between
 * them is read for headings.
 */
function frontMatterLines(lines: string[]): number {
  if ((lines[0] ?? '').replace(/^\uFEFF/, '').trimEnd() !== '---') return 0;
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  if (close < 0) return 0;
  const block = lines.slice(1, close).filter((line) => line.trim() !== '' && !/^\s/.test(line));
  const body = block.filter((line) => !line.startsWith('#') && !/^-[ \t]/.test(line));
  if (body.some((line) => !YAML_KEY.test(line))) return 0;
  if (block.length > 0 && !body.some((line) => YAML_KEY.test(line))) return 0;
  return close + 1;
}

type Container = { kind: 'quote' } | { kind: 'list'; offset: number };

/** The quote and list markers that open a line, outermost first, and what follows them. */
function containerChain(line: string): { stack: Container[]; rest: string } {
  const stack: Container[] = [];
  let rest = line;
  for (;;) {
    const quote = /^ {0,3}>[ \t]?/.exec(rest);
    if (quote) {
      stack.push({ kind: 'quote' });
      rest = rest.slice(quote[0].length);
      continue;
    }
    const list = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]*)/.exec(rest);
    if (!list || (list[3] === '' && list[0].length < rest.length)) return { stack, rest };
    const after = rest.slice(list[0].length);
    const width = after.trim() === '' || (list[3] ?? '').length > 4 ? 1 : (list[3] ?? '').length;
    stack.push({ kind: 'list', offset: (list[1] ?? '').length + (list[2] ?? '').length + width });
    rest = rest.slice((list[1] ?? '').length + (list[2] ?? '').length + width);
  }
}

/** The line inside the containers, or undefined when the line is outside one of them (the container ended). */
function insideContainers(line: string, stack: Container[]): string | undefined {
  let rest = line;
  for (const each of stack) {
    if (each.kind === 'quote') {
      const quote = /^ {0,3}>[ \t]?/.exec(rest);
      if (!quote) return undefined;
      rest = rest.slice(quote[0].length);
    } else if (rest.trim() === '') rest = '';
    else if (rest.length - rest.trimStart().length >= each.offset) rest = rest.slice(each.offset);
    else return undefined;
  }
  return rest;
}

/**
 * The headings of a markdown text as CommonMark reads them, of level 1 to `level`: ATX headings indented up to
 * three spaces with their closing # sequence dropped, and setext headings (a paragraph underlined with = or -).
 * A # line inside a fenced code block is code, not a heading; a fence opened inside a quote or a list item ends
 * with it. A leading YAML front matter block is not read. `at` is where the heading starts, after its indentation;
 * for a setext heading, where the first line of its paragraph starts.
 */
function markdownHeadings(text: string, level: number): { at: number; title: string }[] {
  const found: { at: number; title: string }[] = [];
  let fence: { char: string; length: number; stack: Container[] } | undefined;
  let paragraph: { at: number; lines: string[] } | undefined;
  // After a quote or a list item, a line without a blank before it continues that container (lazily).
  let container = false;
  let offset = 0;
  const lines = text.split('\n');
  const skip = frontMatterLines(lines);
  for (const [number, raw] of lines.entries()) {
    const bom = number === 0 && raw.startsWith('\uFEFF');
    const line = bom ? raw.slice(1) : raw;
    const lineStart = offset + (bom ? 1 : 0);
    offset += raw.length + 1;
    if (number < skip) continue;
    if (fence) {
      const inner = insideContainers(line, fence.stack);
      if (inner !== undefined) {
        const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(inner);
        if (close?.[1]?.[0] === fence.char && close[1].length >= fence.length) fence = undefined;
        continue;
      }
      fence = undefined;
      container = false;
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
      fence = { char: open[1][0] ?? '`', length: open[1].length, stack: [] };
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
    if (containerRest(line, paragraph !== undefined) !== undefined) {
      paragraph = undefined;
      container = true;
      // A fence can open on the marker line itself: `- ```` , `> ~~~` or `> - ```` .
      const chain = containerChain(line);
      const nested = FENCE_OPEN.exec(chain.rest);
      if (nested?.[1] && !(nested[1][0] === '`' && (nested[2] ?? '').includes('`')))
        fence = { char: nested[1][0] ?? '`', length: nested[1].length, stack: chain.stack };
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
 * the next free `_2`, `_3`, ... Sections with the same text keep an entry each: the anchor quote is then found
 * in every copy, and its `occurrence` names the copy that lies in the section. A section with no word of its own
 * (an empty heading next to another) is folded into the section before it, or into the one after it when it
 * comes first. Every section starts global, the safe reading: the author marks local the sections that reach only
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
  // Anchor each section. A section with words keeps an entry of its own, even when the prompt repeats its text.
  // One with no word (an empty heading, a lone rule) cannot be told from its neighbours: it folds into the section
  // before it, or into the one after it when it comes first, and that neighbour is anchored again.
  const find = occurrenceFinder(text);
  const wordy = /[\p{L}\p{N}]/u;
  // A section whose whole text another section repeats has no unique quote, so the search for one is skipped.
  // The count is taken once; a fold changes the texts, so after the first fold every section is searched.
  const sameText = new Map<string, number>();
  for (let index = 0; index < starts.length; index++) {
    const own = text.slice(starts[index]?.at ?? 0, spanEnd(index));
    sameText.set(own, (sameText.get(own) ?? 0) + 1);
  }
  let folded = false;
  const entries: PromptSection[] = [];
  for (let index = 0; index < starts.length; ) {
    const start = starts[index];
    let entry: PromptSection | undefined;
    if (start) {
      const end = spanEnd(index);
      const own = text.slice(start.at, end);
      const fields: Fields = { id: 'section', scope: 'global' };
      const repeats = !folded && (sameText.get(own) ?? 0) > 1;
      const found =
        (repeats ? undefined : uniqueQuote(text, start.at, end)) ??
        (wordy.test(own) ? repeatedQuote(text, start.at, end, find) : undefined);
      entry = found && entryAt(text, start.at, end, fields, found);
    }
    if (entry || !start || starts.length === 1) {
      if (entry) entries[index] = entry;
      index++;
      continue;
    }
    const next = starts[index + 1];
    if (index === 0 && next) next.at = start.at;
    starts.splice(index, 1);
    entries.splice(index, 1);
    folded = true;
    index = Math.max(0, index - 1);
  }
  const errors: string[] = [];
  const sections: PromptSection[] = [];
  const taken = new Set<string>();
  // The last suffix given to each slug: ids only ever get taken, so a repeat resumes after it.
  const lastSuffix = new Map<string, number>();
  starts.forEach((each, index) => {
    const base = slug(each.title);
    let id = base;
    for (let next = (lastSuffix.get(base) ?? 1) + 1; taken.has(id); next++) {
      id = `${base}_${next}`;
      lastSuffix.set(base, next);
    }
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

export type ReanchorMethod = 'same_hash' | 'occurrence' | 'quote' | 'window';

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
 * The anchor of a section placed in `text` with its quote at `at`: the same quote and window, with the
 * `occurrence` that lies in the section when the text repeats the quote, and none when it is found once.
 */
function anchorIn(
  text: string,
  find: (needle: string) => number[],
  anchor: PromptSection['anchor'],
  at: number,
): PromptSection['anchor'] {
  if (at < 0 || text.slice(at, at + anchor.quote.length) !== anchor.quote) return anchor;
  const { occurrence: _old, ...rest } = anchor;
  const places = find(anchor.quote);
  return places.length > 1 ? { ...rest, occurrence: indexInSorted(places, at) + 1 } : rest;
}

/**
 * Re-anchors a registry on the next version of its prompt. For each section, in order: the same text
 * found once in the new prompt (`same_hash`); else the anchor quote found once, and the old text found
 * at the same distance from it (`quote`); else the prefix, quote and suffix window found once, the same
 * way (`window`); else `stale`. A section is only ever placed where its text hashes as before, so a
 * section is never anchored to the wrong text: an edit inside a section makes it stale.
 *
 * A text the old prompt repeats (identical sections) is told apart by its place in the order of the copies:
 * when the new prompt holds as many copies as the old one, the n-th copy is still the n-th (`occurrence`).
 * When the number of copies changed, only a window that names one copy in the old prompt as well can place a
 * section; else it is `stale`, so two sections never hold one place.
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
  const inOld = occurrenceFinder(old);
  const inNext = occurrenceFinder(next);
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
    const copies = inOld(body);
    const exact = inNext(body);
    const repeated = copies.length > 1;
    if (!repeated) {
      if (exact.length === 1 && exact[0] !== undefined) {
        to = { start: exact[0], end: exact[0] + body.length };
        method = 'same_hash';
      }
    } else {
      const same = exact[indexInSorted(copies, from.start)];
      if (exact.length === copies.length && same !== undefined) {
        to = { start: same, end: same + body.length };
        method = 'occurrence';
      }
    }
    const quoteAt = old.indexOf(section.anchor.quote, from.start);
    const offset = quoteAt - from.start;
    const place = (needle: string, inner: number, how: ReanchorMethod) => {
      if (to || quoteAt < 0) return;
      // The surroundings of a repeated text tell its copies apart only if they name one copy in the old prompt too.
      if (repeated && inOld(needle).length !== 1) return;
      const found = inNext(needle);
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
      const quoteFound = inNext(section.anchor.quote).length === 1;
      sections.push({
        id: section.id,
        status: 'stale',
        from,
        reason: repeated
          ? `its text occurs ${copies.length} times in the old prompt and ${exact.length} in the new one, and its surroundings do not tell which copy it is`
          : quoteFound
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
    entries.push({
      ...live,
      span: to,
      anchor: anchorIn(next, inNext, section.anchor, quoteAt < 0 ? -1 : to.start + offset),
    });
  }

  // Two sections of repeated text can both find their surroundings at one copy (a copy was removed, another added).
  // Nothing tells which of them it is, so none of them keeps the place: a place belongs to one section or to none.
  const claimed = new Map<number, number[]>();
  sections.forEach((each, index) => {
    if (each.to && inOld(old.slice(each.from.start, each.from.end)).length > 1)
      claimed.set(each.to.start, [...(claimed.get(each.to.start) ?? []), index]);
  });
  for (const indexes of claimed.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const each = sections[index];
      const original = registry.sections[index];
      if (!each || !original) continue;
      const others = indexes.filter((other) => other !== index).map((other) => sections[other]?.id);
      sections[index] = {
        id: each.id,
        status: 'stale',
        from: each.from,
        reason: `its text is repeated and its surroundings fit the same copy as ${others.join(', ')}: nothing tells which section it is`,
      };
      entries[index] = { ...original, stale: true };
    }
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
    // The old sections that came out stale, found once: the first entry of an id decides, as a search by id would.
    const statusOf = new Map<string, ReanchoredSection['status']>();
    for (const each of sections) if (!statusOf.has(each.id)) statusOf.set(each.id, each.status);
    const staleOld = registry.sections.filter((section) => statusOf.get(section.id) === 'stale');
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
      const stale = staleOld.filter(
        (section) => section.span.start >= oldGap.start && section.span.end <= oldGap.end,
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
