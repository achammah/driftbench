import { normalizePrompt } from './prompt-diff';
import type { SectionRegistry } from './sections';

/**
 * Importing pointers from Anthropic Citations. A `char_location` citation gives `start_char_index` and
 * `end_char_index` in code points (measured: on a text with two emoji the API gave 23 where UTF-16 gives
 * 25). Driftbench offsets are UTF-16 code units, so every imported index is converted before it is
 * compared with a section span. A `content_block_location` citation on a document sent as one content
 * block per section names the section by its block index, with no offset at all.
 */

/**
 * The UTF-16 offset of the code point at index `codePoints` of `text`. An index past the end gives the
 * text length; a negative or fractional index is an error.
 */
export function codePointToUtf16(text: string, codePoints: number): number {
  if (!Number.isInteger(codePoints) || codePoints < 0)
    throw new RangeError(`a code point index is a whole number from 0, not ${codePoints}`);
  let units = 0;
  let seen = 0;
  while (seen < codePoints && units < text.length) {
    const code = text.codePointAt(units) ?? 0;
    units += code > 0xffff ? 2 : 1;
    seen++;
  }
  return units;
}

/** The code point index of the UTF-16 offset `units` of `text`, the inverse of `codePointToUtf16`. */
export function utf16ToCodePoint(text: string, units: number): number {
  return [...text.slice(0, units)].length;
}

export type CharCitation = { start_char_index: number; end_char_index: number; cited_text?: string };

/**
 * The UTF-16 span of a `char_location` citation on `text`, the document as it was sent. The cited text,
 * when given, must be the text at that span; a mismatch means the document or the unit is wrong.
 */
export function citationSpan(
  text: string,
  citation: CharCitation,
): { start: number; end: number } | { error: string } {
  const start = codePointToUtf16(text, citation.start_char_index);
  const end = codePointToUtf16(text, citation.end_char_index);
  if (end <= start) return { error: 'the citation span is empty' };
  if (citation.cited_text !== undefined && text.slice(start, end) !== citation.cited_text)
    return { error: 'the cited text is not the text at the converted span' };
  return { start, end };
}

/**
 * The section of a registry that holds a cited span of its prompt: the section whose span contains
 * the whole citation. Undefined when the citation crosses sections or lies outside every section.
 */
export function sectionOfCitation(
  registry: SectionRegistry,
  prompt: string,
  citation: CharCitation,
): string | undefined {
  const span = citationSpan(normalizePrompt(prompt), citation);
  if ('error' in span) return undefined;
  return registry.sections.find(
    (section) => section.stale !== true && section.span.start <= span.start && span.end <= section.span.end,
  )?.id;
}

/**
 * The prompt as a custom-content document, one text block per section in registry order, so a
 * `content_block_location` citation's `start_block_index` names the section. Stale sections are left
 * out; `sections` maps each block index back to its section id.
 */
export function sectionDocument(
  registry: SectionRegistry,
  prompt: string,
): { content: { type: 'text'; text: string }[]; sections: string[] } {
  const text = normalizePrompt(prompt);
  const live = registry.sections.filter((section) => section.stale !== true);
  return {
    content: live.map((section) => ({
      type: 'text',
      text: text.slice(section.span.start, section.span.end),
    })),
    sections: live.map((section) => section.id),
  };
}
