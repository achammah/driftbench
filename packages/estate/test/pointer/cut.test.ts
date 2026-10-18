import { describe, expect, it } from 'vitest';
import { cut, fingerprint, sentenceSpans } from '../../src/pointer';

// Every file below is invented: the shelves, the crates and the keepers exist nowhere.
const SHELF = `---
title: Crate handling
tags:
  - shelf
  - crate
---

# Crate handling

Stack a crate on the left shelf. Never stack two crates on the right shelf.

## Keepers

- Name the keeper of every crate
- Return the keys
  before you leave the hall
  1. Count the keys twice

| Crate | Rule |
|---|---|
| blue | Keep it dry |
| red | Never open it |

> Seal the lid.
> Then label it.

\`\`\`sh
echo "not a unit"
\`\`\`

<!-- a note for maintainers -->

<notes>
Write the date on the lid.

More text, here.
</notes>
`;

describe('the cutter', () => {
  const result = cut(SHELF);
  const unitsOf = (container: string) => result.units.filter((unit) => unit.container === container);

  it('copies every unit from the file, never from the parser', () => {
    for (const unit of result.units) expect(SHELF.slice(unit.start, unit.end)).toBe(unit.text);
  });

  it('gives no two units the same characters', () => {
    const sorted = [...result.units].sort((a, b) => a.start - b.start);
    for (let at = 1; at < sorted.length; at++) {
      expect(sorted[at]?.start).toBeGreaterThanOrEqual(sorted[at - 1]?.end ?? 0);
    }
  });

  it('cuts a paragraph into sentences and keeps a wrapped list item whole', () => {
    expect(unitsOf('sentence').map((unit) => unit.text)).toContain('Stack a crate on the left shelf.');
    expect(unitsOf('sentence').map((unit) => unit.text)).toContain(
      'Never stack two crates on the right shelf.',
    );
    const wrapped = unitsOf('list_item').find((unit) => unit.text.startsWith('Return the keys'));
    expect(wrapped?.text).toBe('Return the keys\n  before you leave the hall');
  });

  it('makes a nested item, a table cell and a quote paragraph its own unit', () => {
    expect(unitsOf('list_item').map((unit) => unit.text)).toContain('Count the keys twice');
    expect(unitsOf('table_cell').map((unit) => unit.text)).toEqual(
      expect.arrayContaining(['blue', 'Keep it dry', 'red', 'Never open it']),
    );
    expect(unitsOf('block_quote')).toHaveLength(1);
    expect(unitsOf('block_quote')[0]?.text).toBe('Seal the lid.\n> Then label it.');
  });

  it('keys a front matter value by its YAML path and skips the structure keys', () => {
    const values = unitsOf('front_matter_value');
    expect(values.map((unit) => [unit.key, unit.text])).toEqual([
      ['$.title', 'Crate handling'],
      ['$.tags[0]', 'shelf'],
      ['$.tags[1]', 'crate'],
    ]);
  });

  it('keeps a fence and a comment opaque, to their first line', () => {
    expect(unitsOf('opaque').map((unit) => unit.text)).toEqual(['```sh', '<!-- a note for maintainers -->']);
  });

  it('cuts the markdown inside a tag block like any prose', () => {
    const texts = result.units.map((unit) => unit.text);
    expect(texts).toContain('Write the date on the lid.');
    expect(texts).toContain('More text, here.');
  });

  it('records the headings above a unit, outermost first', () => {
    const keeper = unitsOf('list_item').find((unit) => unit.text.startsWith('Name the keeper'));
    expect(keeper?.path).toEqual(['Crate handling', 'Keepers']);
  });

  it('gives the same units and digest for the same file, and another digest when a unit changes', () => {
    expect(cut(SHELF).digest).toBe(result.digest);
    expect(cut(SHELF.replace('Keep it dry', 'Keep it warm')).digest).not.toBe(result.digest);
  });

  it('points a unit into the original file when a byte-order mark leads it', () => {
    const marked = `﻿${SHELF}`;
    const withMark = cut(marked);
    expect(withMark.units).toHaveLength(result.units.length);
    for (const unit of withMark.units) expect(marked.slice(unit.start, unit.end)).toBe(unit.text);
  });

  it('ends on a file whose html block does not shrink', () => {
    const odd = cut('<div>one <span>two</span>\nthree</div>\n\nA closing sentence.\n');
    expect(odd.units.length).toBeGreaterThan(0);
  });

  it('cuts nothing from an empty file', () => {
    expect(cut('').units).toEqual([]);
  });
});

describe('sentence spans', () => {
  const split = (text: string) =>
    sentenceSpans(text, 0, text.length).map(([from, to]) => text.slice(from, to));

  it('keeps an abbreviation, an initial and a version number inside their sentence', () => {
    expect(split('Ask Dr. Vale about it. Then wait.')).toEqual(['Ask Dr. Vale about it.', 'Then wait.']);
    expect(split('Use v2. 1 is old. Done.')).toEqual(['Use v2. 1 is old.', 'Done.']);
    expect(split('See e.g. the log. Then stop.')).toEqual(['See e.g. the log.', 'Then stop.']);
  });

  it('does not cut inside inline code or a link', () => {
    expect(split('Run `a. b. c` first. Then see [the page](https://x.test/a. b) now.')).toEqual([
      'Run `a. b. c` first.',
      'Then see [the page](https://x.test/a. b) now.',
    ]);
  });

  it('joins a hard-wrapped sentence into one unit', () => {
    expect(split('Put the crate\non the shelf before\nnoon. Lock up.')).toEqual([
      'Put the crate\non the shelf before\nnoon.',
      'Lock up.',
    ]);
  });
});

describe('the fingerprint', () => {
  it('ignores white space and container markers', () => {
    expect(fingerprint('- Count the till  twice')).toBe(fingerprint('Count the till twice'));
    expect(fingerprint('> Count the till\n> twice')).toBe(fingerprint('Count the till twice'));
    expect(fingerprint('1. Count the till twice')).toBe(fingerprint('3. Count the till twice'));
  });

  it('sees a change of case or emphasis, which prompts use for force', () => {
    expect(fingerprint('Never stack')).not.toBe(fingerprint('never stack'));
    expect(fingerprint('Never **stack**')).not.toBe(fingerprint('Never stack'));
  });

  it('joins the same text in two Unicode forms', () => {
    expect(fingerprint('café')).toBe(fingerprint('café'));
  });
});
