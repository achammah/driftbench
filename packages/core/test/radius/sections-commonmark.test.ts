import { describe, expect, it } from 'vitest';
import { checkSectionRegistry, sectionsFromHeadings } from '../../src/radius/sections';

// Invented lighthouse prompts. Every heading, id and sentence below is made up for these tests.

function built(text: string, level?: number) {
  const result = sectionsFromHeadings(text, {
    promptId: 'lighthouse',
    version: 'v1',
    ...(level ? { level } : {}),
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  expect(checkSectionRegistry(result.registry, text)).toEqual([]);
  return result.registry.sections;
}
const ids = (text: string, level?: number) => built(text, level).map((section) => section.id);
const titles = (text: string, level?: number) => built(text, level).map((section) => section.title);

describe('sectionsFromHeadings reads CommonMark headings', () => {
  describe('fenced code blocks', () => {
    it('does not start a section at a # line inside a backtick fence', () => {
      const text =
        '## Tides\nRead the gauge twice.\n```sh\n# log the level\n## copy it\n```\n## Moorings\nTie off fore and aft.\n';
      expect(ids(text)).toEqual(['tides', 'moorings']);
      const tides = built(text)[0];
      expect(text.slice(tides?.span.start, tides?.span.end)).toContain('## copy it');
    });

    it('treats a tilde fence, an indented fence and a longer closing fence the same way', () => {
      expect(ids('## Tides\nRead the gauge.\n~~~\n# one\n~~~\n## Moorings\nTie off.\n')).toEqual([
        'tides',
        'moorings',
      ]);
      expect(ids('## Tides\nRead the gauge.\n  ```\n  # one\n  ```\n## Moorings\nTie off.\n')).toEqual([
        'tides',
        'moorings',
      ]);
      expect(ids('## Tides\nRead the gauge.\n```\n# one\n`````\n## Moorings\nTie off.\n')).toEqual([
        'tides',
        'moorings',
      ]);
    });

    it('keeps a fence open when the closing line is shorter or of the other character', () => {
      const text = '## Tides\nRead the gauge.\n````\n# one\n```\n~~~~\n## two\n````\n## Moorings\nTie off.\n';
      expect(ids(text)).toEqual(['tides', 'moorings']);
    });

    it('lets an unclosed fence run to the end of the prompt', () => {
      expect(ids('## Tides\nRead the gauge.\n```\n# one\n## two\nmore text\n')).toEqual(['tides']);
    });

    it('is not fooled by a backtick fence whose info string holds a backtick', () => {
      expect(ids('## Tides\nUse ``` inline` here.\n## Moorings\nTie off.\n')).toEqual(['tides', 'moorings']);
    });
  });

  describe('setext headings', () => {
    it('starts a section at a paragraph underlined with = or -', () => {
      const text = 'Lamp care\n=========\nTrim the wick.\n\nOil store\n---------\nKeep it cool.\n';
      expect(ids(text)).toEqual(['lamp_care', 'oil_store']);
      expect(titles(text)).toEqual(['Lamp care', 'Oil store']);
    });

    it('takes a multi-line paragraph as one title and keeps the text before it as the preamble', () => {
      const text = 'You keep the light.\n\nFog\nsignals\n---\nSound the horn.\n';
      expect(ids(text)).toEqual(['preamble', 'fog_signals']);
      expect(titles(text)[1]).toBe('Fog signals');
    });

    it('honours the level: = is level 1 and - is level 2', () => {
      const text = 'Lamp care\n=========\nTrim the wick.\n\nOil store\n---------\nKeep it cool.\n';
      expect(ids(text, 1)).toEqual(['lamp_care']);
    });

    it('does not take a thematic break, a bare underline, a list or a quote as a heading', () => {
      const text =
        '## Tides\nRead the gauge.\n\n---\n\nMore on the gauge.\n***\n===\n- keep dry\n---\n> quoted\n---\nEnd.\n';
      expect(ids(text)).toEqual(['tides']);
    });

    it('ends a paragraph at an ATX heading, a fence or a blank line, so a later --- underlines nothing', () => {
      const text =
        '## Tides\nRead the gauge.\n```\ncode\n```\n---\n## Store\nKeep it cool.\n\nNote\n\n---\nEnd.\n';
      expect(titles(text)).toEqual(['Tides', 'Store']);
      expect(titles('## Tides\nRead the gauge.\n\nStore\n---\nKeep it cool.\n')).toEqual(['Tides', 'Store']);
    });
  });

  describe('indented ATX headings', () => {
    it('reads a heading indented one to three spaces', () => {
      const text = ' ## Rope\nCoil it.\n  ### Knots\nTie a bowline.\n   ## Anchor\nSet it.\n';
      expect(ids(text, 3)).toEqual(['rope', 'knots', 'anchor']);
    });

    it('does not read a heading indented four spaces or by a tab', () => {
      const text = '## Rope\nCoil it.\n    ## Knots\nTie a bowline.\n\t## Anchor\nSet it.\n';
      expect(ids(text)).toEqual(['rope']);
    });

    it('starts the section at the # so the anchor is in the body', () => {
      const text = '  ## Rope\nCoil it with care.\n';
      const rope = built(text)[0];
      expect(text.slice(rope?.span.start, rope?.span.start === undefined ? 0 : rope.span.start + 8)).toBe(
        '## Rope\n',
      );
    });
  });

  describe('closing sequence', () => {
    it('drops a closing # sequence from the title', () => {
      expect(titles('## Flares ##\nFire one.\n# Horn #\nBlow it.\n### Chart ####   \nRead it.\n', 3)).toEqual(
        ['Flares', 'Horn', 'Chart'],
      );
    });

    it('keeps a # that is part of the title', () => {
      expect(titles('## C#\nWrite it.\n## Tag \\#\nMark it.\n## Keep # inside\nOk.\n')).toEqual([
        'C#',
        'Tag \\#',
        'Keep # inside',
      ]);
    });

    it('reads a heading with no title and a heading that is only #', () => {
      expect(ids('##\nBody one.\n## ##\nBody two.\n')).toEqual(['section', 'section_2']);
    });

    it('does not read #hashtag as a heading', () => {
      expect(ids('## Tides\n#hashtag stays text.\n')).toEqual(['tides']);
    });
  });

  describe('front matter', () => {
    const agent =
      '---\nname: lamp-keeper\ndescription: Trims wicks and logs the oil.\ntools: Read\nmodel: haiku\n---\n\nYou keep the lamp.\n';

    it('is not read as a setext heading, so an agent prompt without headings is one preamble section', () => {
      expect(ids(agent)).toEqual(['preamble']);
    });

    it('leaves the headings after it to start sections', () => {
      const text = `${agent}\n## Wicks\nTrim them.\n\nOil\n---\nLog it.\n`;
      expect(ids(text)).toEqual(['preamble', 'wicks', 'oil']);
    });

    it('needs a closing line, and only a first line of exactly --- opens it', () => {
      expect(ids('---\nname: lamp\nYou keep the lamp.\n')).toEqual(['preamble']);
      expect(ids('\n---\nname: lamp\n---\nYou keep the lamp.\n')).toEqual(['name_lamp']);
    });

    it('does not take lines that are not keys for front matter: three --- lines and words are thematic breaks and setext headings', () => {
      expect(ids('---\nFoo\n---\nBar\n---\nBaz\n')).toEqual(['foo', 'bar']);
    });
  });

  describe('containers', () => {
    it('opens a fence on a list-marker line and on a quote line', () => {
      expect(ids('## Tides\nSteps:\n- ```\n  # in\n  ```\n## Moorings\nTie off.\n')).toEqual([
        'tides',
        'moorings',
      ]);
      expect(ids('## Tides\nSteps:\n1. ~~~\n   # in\n   ~~~\n## Moorings\nTie off.\n')).toEqual([
        'tides',
        'moorings',
      ]);
      expect(ids('## Tides\n> ```\n> # in\n> ```\n## Moorings\nTie off.\n')).toEqual(['tides', 'moorings']);
    });

    it('does not let 2. interrupt a paragraph, but lets a bullet and 1. do so', () => {
      expect(titles('Steps\n2. bar\n---\nTie off.\n')).toEqual(['Steps 2. bar']);
      expect(titles('Steps\n1. bar\n---\nTie off.\n')).toEqual(['preamble']);
      expect(titles('Steps\n- bar\n---\nTie off.\n')).toEqual(['preamble']);
    });

    it('does not let an empty list item interrupt a paragraph', () => {
      expect(titles('Steps\n*\n---\nTie off.\n')).toEqual(['Steps *']);
    });
  });

  describe('a fence in a container ends with the container', () => {
    it('finds the heading after a blank line when a list item fence is never closed', () => {
      expect(ids('## Tides\nSteps:\n- ```\n  ## in\n\n## After\nTie off.\n')).toEqual(['tides', 'after']);
      expect(ids('## Tides\nSteps:\n1. ~~~\n   ## in\n## After\nTie off.\n')).toEqual(['tides', 'after']);
    });

    it('finds the heading after a quote fence that is never closed, with or without a blank line', () => {
      expect(ids('## Tides\n> ```\n> ## in\n\n## After\nTie off.\n')).toEqual(['tides', 'after']);
      expect(ids('## Tides\n> ```\n> ## in\n## After\nTie off.\n')).toEqual(['tides', 'after']);
    });

    it('keeps a fence open across blank lines and indented lines of its item', () => {
      const text = '## Tides\n- ```\n  ## in\n\n  ## still in\n  ```\n## After\nTie off.\n';
      expect(ids(text)).toEqual(['tides', 'after']);
    });

    it('reads a fence in a list in a quote, and the end of the quote closes it', () => {
      expect(ids('## Tides\n> - ```\n>   ## in\n>   ```\n## After\nTie off.\n')).toEqual(['tides', 'after']);
      expect(ids('## Tides\n> - ```\n>   ## in\n\n## After\nTie off.\n')).toEqual(['tides', 'after']);
      expect(ids('## Tides\n- > ```\n  > ## in\n## After\nTie off.\n')).toEqual(['tides', 'after']);
    });
  });

  describe('front matter edges', () => {
    it('skips front matter after a byte order mark, and reads a heading after one', () => {
      expect(ids('\uFEFF---\nname: lamp\n---\n\nYou keep the lamp.\n')).toEqual(['preamble']);
      expect(ids('\uFEFF# Title\nBody text here.\n')).toEqual(['title']);
    });

    it('does not hide a heading between two --- lines that are not front matter', () => {
      expect(ids('---\n# One\n\nBody one.\n\n---\nAfter.\n')).toEqual(['one']);
    });

    it('still takes a block with a key as front matter, comments and indented lines included', () => {
      const text =
        '---\n# note\nname: lamp\ntools:\n- Read\n- Grep\nnotes: |\n  # not a heading\n---\n\n## Real\nBody.\n';
      expect(ids(text)).toEqual(['preamble', 'real']);
    });

    it('does not take a block with a line that is not a key for front matter', () => {
      const text = '---\nname: lamp\nTrim the wick daily.\n---\nBody text.\n';
      expect(ids(text)).toEqual(['name_lamp_trim_the_wick_daily']);
    });

    it('does not take a block of comments and list items alone for front matter', () => {
      expect(ids('---\n# note\n- Read\n---\nBody text.\n')).toEqual(['note']);
    });

    it('takes an empty block as front matter', () => {
      expect(ids('---\n---\n\n## Real\nBody.\n')).toEqual(['preamble', 'real']);
    });
  });

  describe('sections that cannot be anchored', () => {
    it('folds adjacent empty headings into the section before them', () => {
      const text = '## Tides\nRead the gauge.\n##\n##\n#\n';
      expect(ids(text)).toEqual(['tides']);
      expect(built(text)[0]?.span.end).toBe(text.trimEnd().length);
    });

    it('folds empty headings at the start into the section after them', () => {
      const text = '##\n##\n## Real\nBody text is here.\n';
      expect(ids(text)).toEqual(['real']);
      expect(titles(text)).toEqual(['Real']);
      expect(built(text)[0]?.span.start).toBe(0);
    });

    it('keeps two identical sections that hold text, each with an entry of its own', () => {
      expect(ids('## Same\nSame body line.\n## Same\nSame body line.\n')).toEqual(['same', 'same_2']);
    });

    it('counts the words of a heading title: a titled heading with no body is kept, a lone symbol heading folds', () => {
      expect(ids('## Tides\nRead the gauge.\n## Moorings\n## Signals\nFlash twice.\n')).toEqual([
        'tides',
        'moorings',
        'signals',
      ]);
      expect(ids('## Tides\nRead the gauge.\n## ***\n## ***\n')).toEqual(['tides']);
      // A repeated title with no body has no unique quote: its title is the only word it has, and it keeps an entry.
      expect(ids('## Notes\n## Notes\nLog the tide at noon.\n')).toEqual(['notes', 'notes_2']);
    });

    it('keeps the whole text as one section when every heading is empty, and reports an empty prompt', () => {
      expect(ids('##\n##\n')).toEqual(['section']);
      expect(sectionsFromHeadings('  \n', { promptId: 'lighthouse', version: 'v1' }).ok).toBe(false);
    });
  });

  describe('ids', () => {
    it('numbers repeats _2, _3 in order', () => {
      expect(ids('# T\nOne.\n# T\nTwo.\n# T\nThree.\n')).toEqual(['t', 't_2', 't_3']);
    });

    it('never gives one id to two sections when a repeat suffix meets another title', () => {
      const text = '# T\nOne.\n# T\nTwo.\n# T 2\nThree.\n';
      const found = ids(text);
      expect(found).toEqual(['t', 't_2', 't_2_2']);
      expect(new Set(found).size).toBe(found.length);
    });

    it('skips a taken id when the colliding title comes first', () => {
      const found = ids('# T 2\nOne.\n# T\nTwo.\n# T\nThree.\n# T\nFour.\n');
      expect(found).toEqual(['t_2', 't', 't_3', 't_4']);
    });

    it('does not let a heading titled Preamble take the id of the text before the first heading', () => {
      const found = ids('Intro text.\n\n## Preamble\nBody.\n');
      expect(found).toEqual(['preamble', 'preamble_2']);
    });
  });
});
