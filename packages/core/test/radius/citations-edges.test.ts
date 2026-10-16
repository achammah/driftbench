import { describe, expect, it } from 'vitest';
import { citationSpan, sectionDocument, sectionOfCitation } from '../../src/radius/citations';
import { type SectionRegistry, sectionsFromHeadings } from '../../src/radius/sections';

/** Fictional data only. A hand-written prompt of three sections, so the offsets can be read by eye. */
const prompt = '## Hours\nWe open at nine.\n## Refunds\nRefunds take five days.\n## Tone\nBe kind.\n';
const built = sectionsFromHeadings(prompt, { promptId: 'acme-sales', version: 'v1' });
if (!built.ok) throw new Error(built.errors.join('\n'));
const registry: SectionRegistry = built.registry;
const at = (needle: string) => prompt.indexOf(needle);

describe('citation edges', () => {
  it('refuses an empty or reversed citation span, and finds no section for it', () => {
    const start = at('We open');
    expect(citationSpan(prompt, { start_char_index: start, end_char_index: start })).toEqual({
      error: 'the citation span is empty',
    });
    expect(citationSpan(prompt, { start_char_index: start + 4, end_char_index: start })).toEqual({
      error: 'the citation span is empty',
    });
    expect(sectionOfCitation(registry, prompt, { start_char_index: start, end_char_index: start })).toBe(
      undefined,
    );
    // A whole citation inside one section names it.
    expect(sectionOfCitation(registry, prompt, { start_char_index: start, end_char_index: start + 7 })).toBe(
      'hours',
    );
  });

  it('names no section for a citation that crosses a section boundary', () => {
    const start = at('nine');
    const end = at('Refunds take') + 'Refunds'.length;
    const crossing = { start_char_index: start, end_char_index: end };
    expect(citationSpan(prompt, crossing)).toEqual({ start, end });
    expect(sectionOfCitation(registry, prompt, crossing)).toBeUndefined();
    // Each half alone is inside its own section.
    expect(
      sectionOfCitation(registry, prompt, { start_char_index: start, end_char_index: at('.\n## Refunds') }),
    ).toBe('hours');
    expect(
      sectionOfCitation(registry, prompt, { start_char_index: at('Refunds take'), end_char_index: end }),
    ).toBe('refunds');
  });

  it('leaves a stale section out of the citation document and out of citation lookup', () => {
    const stale: SectionRegistry = {
      ...registry,
      sections: registry.sections.map((section) =>
        section.id === 'refunds' ? { ...section, stale: true } : section,
      ),
    };
    const live = sectionDocument(registry, prompt);
    expect(live.sections).toEqual(['hours', 'refunds', 'tone']);
    expect(live.content).toHaveLength(3);
    const document = sectionDocument(stale, prompt);
    // block index n names sections[n]: the stale section takes no block.
    expect(document.sections).toEqual(['hours', 'tone']);
    expect(document.content.map((block) => block.text)).toEqual([
      '## Hours\nWe open at nine.',
      '## Tone\nBe kind.',
    ]);
    expect(
      sectionOfCitation(stale, prompt, {
        start_char_index: at('Refunds take'),
        end_char_index: at('Refunds take') + 7,
      }),
    ).toBeUndefined();
  });
});
