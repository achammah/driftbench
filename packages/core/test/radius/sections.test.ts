import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  citationSpan,
  codePointToUtf16,
  sectionDocument,
  sectionOfCitation,
  utf16ToCodePoint,
} from '../../src/radius/citations';
import {
  checkSectionRegistry,
  parseSectionRegistry,
  reanchorRegistry,
  type SectionRegistry,
  sectionsFromHeadings,
} from '../../src/radius/sections';

const fixture = (name: string) =>
  readFileSync(new URL(`../../../../examples/acme/prompts/${name}`, import.meta.url), 'utf8');
const prompt = fixture('acme-sales.md');
const parsed = parseSectionRegistry(parseYaml(fixture('acme-sales.sections.yaml')));
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const registry: SectionRegistry = parsed.registry;

/** A seeded generator, so the battery is the same on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

describe('section registry', () => {
  it('reads the registry the research lane wrote, in the same UTF-16 unit', () => {
    expect(registry.sections).toHaveLength(30);
    expect(checkSectionRegistry(registry, prompt)).toEqual([]);
  });

  it('builds a first registry from the headings, every section global', () => {
    const built = sectionsFromHeadings(prompt, { promptId: 'acme-sales', version: 'v1' });
    if (!built.ok) throw new Error(built.errors.join('\n'));
    expect(built.registry.sections.map((section) => section.id).slice(0, 3)).toEqual([
      'who_you_are',
      'language',
      'reply_style',
    ]);
    expect(built.registry.sections).toHaveLength(30);
    expect(built.registry.sections.every((section) => section.scope === 'global')).toBe(true);
    expect(checkSectionRegistry(built.registry, prompt)).toEqual([]);
    // The spans agree with the research registry, which ends each section after its newline.
    built.registry.sections.forEach((section, index) => {
      expect(section.span.start).toBe(registry.sections[index]?.span.start);
    });
  });

  it('refuses a registry with a repeated id or an unknown reference', () => {
    const value = parseYaml(fixture('acme-sales.sections.yaml'));
    value.sections[1].id = value.sections[0].id;
    value.sections[2].references = ['no_such_section'];
    const result = parseSectionRegistry(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('is used twice');
      expect(result.errors.join('\n')).toContain('no section has the id no_such_section');
    }
  });

  it('reports a registry that does not describe the text', () => {
    const edited = prompt.replace('Always reply in English', 'Always reply in French');
    const problems = checkSectionRegistry(registry, edited);
    expect(problems[0]).toContain('text_sha256');
    expect(problems.join('\n')).toContain('language: the text at');
  });
});

describe('re-anchoring (M3.1 battery)', () => {
  const live = registry.sections;
  const kinds = ['insert_before', 'delete_elsewhere', 'reflow_whitespace', 'edit_inside'] as const;

  for (const kind of kinds) {
    it(`${kind}: untouched sections re-anchor exactly, edited ones come out stale`, () => {
      const draw = random(7 + kinds.indexOf(kind));
      let untouched = 0;
      let reanchored = 0;
      let wrong = 0;
      let edited = 0;
      let editedStale = 0;
      let outside = 0;
      for (let trial = 0; trial < 50; trial++) {
        const target = live[draw(live.length)];
        if (!target) throw new Error('no section');
        const { start, end } = target.span;
        let next: string;
        let changed: string | undefined;
        if (kind === 'insert_before') {
          next = `${prompt.slice(0, start)}## Note\nAcme staff wear green shirts.\n\n${prompt.slice(start)}`;
        } else if (kind === 'delete_elsewhere') {
          next = prompt.slice(0, start) + prompt.slice(end + 1);
          changed = target.id;
        } else if (kind === 'reflow_whitespace') {
          next = `${prompt.slice(0, start)}\n${prompt.slice(start)}`;
        } else {
          const words = prompt.slice(start, end).split(' ');
          const at = 2 + draw(words.length - 2);
          words[at] = `${words[at]} really`;
          next = prompt.slice(0, start) + words.join(' ') + prompt.slice(end);
          changed = target.id;
        }
        const result = reanchorRegistry(registry, prompt, next, 'v2');
        if (!result.ok) throw new Error(result.errors.join('\n'));
        outside += result.result.outside.length > 0 ? 1 : 0;
        for (const section of result.result.sections) {
          if (section.id === changed) {
            edited++;
            if (section.status === 'stale') editedStale++;
            continue;
          }
          untouched++;
          if (!section.to) continue;
          const old = prompt.slice(section.from.start, section.from.end);
          if (next.slice(section.to.start, section.to.end) === old) reanchored++;
          else wrong++;
        }
        expect(checkSectionRegistry(result.result.registry, next)).toEqual([]);
      }
      expect(wrong).toBe(0);
      expect(reanchored).toBe(untouched);
      expect(editedStale).toBe(edited);
      // Only an insertion adds text outside every section; it is reported, never absorbed.
      expect(outside).toBe(kind === 'insert_before' ? 50 : 0);
    });
  }

  it('finds a section by its quote when its text is repeated elsewhere', () => {
    const section = live[3];
    if (!section) throw new Error('no section');
    const body = prompt.slice(section.span.start, section.span.end);
    // The same text twice in the new prompt: the exact match is ambiguous, the window decides.
    const next = `${prompt}\n${body}`;
    const result = reanchorRegistry(registry, prompt, next, 'v2');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const found = result.result.sections.find((each) => each.id === section.id);
    expect(found?.status).toBe('kept');
    expect(found?.method).toBe('window');
    expect(result.result.outside).toEqual([`between ${live[live.length - 1]?.id} and (end)`]);
  });

  it('marks a section stale when its quote survives an edit inside it', () => {
    const section = live.find((each) => each.scope === 'local');
    if (!section) throw new Error('no local section');
    const quoteAt = prompt.indexOf(section.anchor.quote);
    const tail = quoteAt + section.anchor.quote.length + 1;
    const next = `${prompt.slice(0, tail)}never ${prompt.slice(tail)}`;
    const result = reanchorRegistry(registry, prompt, next, 'v2');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const found = result.result.sections.find((each) => each.id === section.id);
    expect(found).toMatchObject({ status: 'stale', reason: expect.stringContaining('edited inside') });
    expect(result.result.registry.sections.find((each) => each.id === section.id)?.stale).toBe(true);
    // A second re-anchoring keeps it stale until its span is declared again.
    const again = reanchorRegistry(result.result.registry, next, next, 'v3');
    if (!again.ok) throw new Error(again.errors.join('\n'));
    expect(again.result.sections.find((each) => each.id === section.id)?.status).toBe('stale');
  });

  it('reports sections that changed order', () => {
    const [first, second] = live;
    if (!first || !second) throw new Error('no sections');
    const a = prompt.slice(first.span.start, first.span.end);
    const b = prompt.slice(second.span.start, second.span.end);
    const next = prompt.replace(`${a}\n${b}`, `${b}\n${a}`);
    const result = reanchorRegistry(registry, prompt, next, 'v2');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.result.reordered.length).toBeGreaterThan(0);
  });

  it('refuses an old text the registry does not describe', () => {
    const result = reanchorRegistry(registry, `${prompt}x`, prompt, 'v2');
    expect(result.ok).toBe(false);
  });
});

describe('non-ASCII prompts and Citations offsets', () => {
  const text =
    'Café résumé policy 😀😀. Refunds are allowed within 30 days of delivery. Exchanges take 5 days.';

  it('converts the code points Citations counts into UTF-16 units', () => {
    // Measured on claude-haiku-5-5 (research/block-links, analysis/citations_unit.json): start 23.
    const start = codePointToUtf16(text, 23);
    expect(start).toBe(25);
    expect(utf16ToCodePoint(text, start)).toBe(23);
    const cited = 'Refunds are allowed within 30 days of delivery. ';
    expect(citationSpan(text, { start_char_index: 23, end_char_index: 71, cited_text: cited })).toEqual({
      start: 25,
      end: 73,
    });
    // Read as UTF-16 without the conversion, the same indexes cut the wrong text.
    expect(text.slice(23, 71)).not.toBe(cited);
    expect(citationSpan(text, { start_char_index: 25, end_char_index: 73, cited_text: cited })).toEqual({
      error: 'the cited text is not the text at the converted span',
    });
  });

  it('places a citation in its section, and maps content blocks to section ids', () => {
    const source = '## Ton\nSoyez aimable 😀, toujours.\n## Remboursements\nRemboursés sous 30 jours.\n';
    const built = sectionsFromHeadings(source, { promptId: 'fr', version: 'v1' });
    if (!built.ok) throw new Error(built.errors.join('\n'));
    const start = [...source].length - [...'Remboursés sous 30 jours.\n'].length;
    expect(
      sectionOfCitation(built.registry, source, {
        start_char_index: start,
        end_char_index: start + 10,
      }),
    ).toBe('remboursements');
    const document = sectionDocument(built.registry, source);
    expect(document.sections).toEqual(['ton', 'remboursements']);
    expect(document.content[0]?.text).toBe('## Ton\nSoyez aimable 😀, toujours.');
  });

  it('re-anchors in UTF-16 units after an emoji is inserted before a section', () => {
    const source = '## Ton\nSoyez aimable, toujours.\n\n## Remboursements\nRemboursés sous 30 jours.\n';
    const built = sectionsFromHeadings(source, { promptId: 'fr', version: 'v1' });
    if (!built.ok) throw new Error(built.errors.join('\n'));
    const next = source.replace('toujours.', 'toujours 😀.');
    const result = reanchorRegistry(built.registry, source, next, 'v2');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const moved = result.result.sections.find((each) => each.id === 'remboursements');
    expect(moved?.status).toBe('moved');
    expect((moved?.to?.start ?? 0) - (moved?.from.start ?? 0)).toBe(3); // a space and a two-unit emoji
    expect(result.result.sections.find((each) => each.id === 'ton')?.status).toBe('stale');
  });
});
