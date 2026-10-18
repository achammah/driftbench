import type { Block, ListItem } from './compose';
import { headingText, type Prose, type Rng, shortRule, word } from './words';

const pickFrom = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

const MARKERS = ['-', '*', '+', '1.', '1)'] as const;

/** A paragraph block of `count` sentences. */
export function para(prose: Prose, count: number, wrap?: number): Block {
  const block: Block = { kind: 'paragraph', sentences: prose.many(count) };
  if (wrap !== undefined) block.wrap = wrap;
  return block;
}

/** A list of `count` items, optionally nested one level. */
export function listOf(
  prose: Prose,
  count: number,
  options: { nested?: boolean; marker?: (typeof MARKERS)[number]; wrap?: number } = {},
): Block {
  const items: ListItem[] = prose.many(count).map((text) => ({ text }));
  if (options.nested) {
    const first = items[0];
    if (first) first.children = prose.many(2).map((text) => ({ text }));
  }
  const block: Block = { kind: 'list', items, marker: options.marker ?? '-' };
  if (options.wrap !== undefined) block.wrap = options.wrap;
  return block;
}

export type MixOptions = { blocks: number; front?: boolean; nested?: boolean; wide?: boolean };

/**
 * A seeded document of every construct the cutter has rules for, in a random order with an outline. Everything it
 * writes is unambiguous markdown: blank lines between blocks, no raw HTML other than tag blocks and comments.
 */
export function mixedBlocks(prose: Prose, options: MixOptions): Block[] {
  const rng = prose.random;
  const blocks: Block[] = [];
  if (options.front) {
    blocks.push({
      kind: 'front',
      entries: [
        { key: 'name', value: `${word(rng)}-${word(rng)}` },
        {
          key: 'description',
          value: prose.next(),
          style: pickFrom(rng, ['plain', 'double', 'single'] as const),
        },
        { key: 'tags', value: [word(rng), word(rng)] },
      ],
    });
  }
  let level = 1;
  blocks.push({ kind: 'heading', level, text: headingText(rng) });
  for (let n = 0; n < options.blocks; n += 1) {
    const roll = rng();
    if (roll < 0.1) {
      level = Math.min(6, Math.max(1, level + pickFrom(rng, [-1, 0, 1, 1])));
      blocks.push({ kind: 'heading', level, text: headingText(rng), closing: rng() < 0.2 });
    } else if (roll < 0.4) {
      blocks.push(
        para(prose, 1 + Math.floor(rng() * 4), rng() < 0.4 ? 40 + Math.floor(rng() * 40) : undefined),
      );
    } else if (roll < 0.55) {
      blocks.push(
        listOf(prose, 2 + Math.floor(rng() * 4), {
          nested: options.nested !== false && rng() < 0.4,
          marker: pickFrom(rng, MARKERS),
          wrap: rng() < 0.3 ? 50 : undefined,
        }),
      );
    } else if (roll < 0.65) {
      const cols = 2 + Math.floor(rng() * 3);
      const rows = 1 + Math.floor(rng() * 3);
      const cell = () => (rng() < 0.3 ? prose.next(shortRule) : word(rng));
      blocks.push({
        kind: 'table',
        header: Array.from({ length: cols }, () => word(rng)),
        rows: Array.from({ length: rows }, () => Array.from({ length: cols }, cell)),
        pad: rng() < 0.5,
        align: rng() < 0.3,
      });
    } else if (roll < 0.75) {
      blocks.push({
        kind: 'quote',
        paragraphs: prose.many(1 + Math.floor(rng() * 2), shortRule),
        wrap: rng() < 0.4 ? 45 : undefined,
      });
    } else if (roll < 0.82) {
      blocks.push({
        kind: 'fence',
        lines: [`${word(rng)} ${word(rng)}`, prose.next(), `- ${word(rng)}`],
        info: pickFrom(rng, ['', 'bash', 'yaml']),
      });
    } else if (roll < 0.87) {
      blocks.push({ kind: 'comment', lines: [prose.next()] });
    } else if (roll < 0.92 && options.nested !== false) {
      blocks.push({
        kind: 'tag',
        tag: pickFrom(rng, ['rules', 'role', 'notes']),
        blocks: [listOf(prose, 2)],
      });
    } else {
      blocks.push(para(prose, 2));
    }
  }
  return blocks;
}

const LETTERS = 'bcdfghjklmnpqrstvwxz';
/** A pronounceable-ish unique tag of letters for an index. */
export function tag(i: number): string {
  let n = i;
  let out = '';
  do {
    out = LETTERS[n % LETTERS.length] + out;
    n = Math.floor(n / LETTERS.length);
  } while (n > 0);
  return `${out}ix`;
}

/**
 * A large document: `sections` sections of a `##` heading and paragraphs of five sentences, about `chars`
 * characters in all. Every sentence is unique (a tag before its full stop). Sentences are drawn without the
 * pool's similarity checks, for speed.
 */
export function bigDoc(
  rng: Rng,
  sections: number,
  chars: number,
  make: (rng: Rng) => string,
): { blocks: Block[]; texts: string[]; headings: string[] } {
  const blocks: Block[] = [{ kind: 'heading', level: 1, text: 'Big estate' }];
  const texts: string[] = [];
  const headings: string[] = ['Big estate'];
  let counter = 0;
  const per = Math.floor(chars / sections);
  for (let s = 0; s < sections; s += 1) {
    const heading = `${headingText(rng)} ${tag(s)}`;
    headings.push(heading);
    blocks.push({ kind: 'heading', level: 2, text: heading });
    let used = 0;
    while (used < per) {
      const sentences: string[] = [];
      for (let k = 0; k < 5; k += 1) {
        const t = make(rng).replace(/\.$/, ` ${tag(counter)}.`);
        counter += 1;
        sentences.push(t);
        texts.push(t);
        used += t.length + 1;
      }
      blocks.push({ kind: 'paragraph', sentences });
    }
  }
  return { blocks, texts, headings };
}
