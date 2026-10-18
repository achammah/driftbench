import type { Block, ComposeOptions } from './compose';
import type { EstateFile } from './estate';
import { headingText, longMake, type Prose, similarity } from './words';

/**
 * A small fictional estate for the anchoring items: a few files, each a heading and paragraphs of one long
 * sentence, so every paragraph is exactly one unit. Texts are drawn apart (pairwise similarity under 0.36).
 */

/** Two distinct units of a world are less alike than this (normalised Levenshtein). */
export const SIMILAR_LIMIT = 0.42;

export type World = {
  paths: string[];
  heads: string[];
  texts: string[][];
};

export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A sentence of 110 characters or more: two clauses joined by a comma. */
export function longSentence(prose: Prose): string {
  return prose.next(longMake);
}

/** `count` long sentences, no two alike. */
export function distinctSentences(
  prose: Prose,
  count: number,
  make: (prose: Prose) => string = longSentence,
): string[] {
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard < count * 60) {
    guard += 1;
    const candidate = make(prose);
    if (out.every((other) => similarity(other, candidate) < SIMILAR_LIMIT)) out.push(candidate);
  }
  if (out.length < count) throw new Error('could not draw distinct sentences');
  return out;
}

export function worldOf(
  prose: Prose,
  options: { files?: number; perFile?: number; dir?: string } = {},
): World {
  const files = options.files ?? 4;
  const perFile = options.perFile ?? 10;
  const all = distinctSentences(prose, files * perFile);
  const dir = options.dir ?? 'notes';
  return {
    paths: Array.from({ length: files }, (_, i) => `${dir}/file-${i + 1}.md`),
    heads: Array.from({ length: files }, () => `${headingText(prose.random)}`),
    texts: Array.from({ length: files }, (_, f) => all.slice(f * perFile, (f + 1) * perFile)),
  };
}

export function cloneWorld(w: World): World {
  return { paths: [...w.paths], heads: [...w.heads], texts: w.texts.map((t) => [...t]) };
}

export type RenderOptions = {
  wrap?: number;
  eol?: ComposeOptions['eol'];
  heading?: boolean;
  /** Sentences per paragraph: consecutive texts share a paragraph. */
  per?: number;
  /** Extra blank lines between blocks. */
  spaced?: boolean;
  list?: { marker?: '-' | '*' | '+' | '1.' | '1)'; start?: number };
};

/** The files of a world: a heading and the texts as paragraphs (or as one list). */
export function filesOf(w: World, options: RenderOptions = {}): EstateFile[] {
  return w.paths.map((path, f) => {
    const texts = w.texts[f] as string[];
    const blocks: Block[] = [];
    if (options.heading !== false) blocks.push({ kind: 'heading', level: 1, text: w.heads[f] as string });
    const push = (b: Block) => {
      blocks.push(b);
      if (options.spaced) blocks.push({ kind: 'raw', text: '\n', structure: true });
    };
    if (options.list) {
      push({
        kind: 'list',
        items: texts.map((text) => ({ text })),
        marker: options.list.marker,
        start: options.list.start,
        wrap: options.wrap,
      });
    } else {
      const per = options.per ?? 1;
      for (let i = 0; i < texts.length; i += per) {
        push({
          kind: 'paragraph',
          sentences: texts.slice(i, i + per),
          ...(options.wrap ? { wrap: options.wrap } : {}),
        });
      }
    }
    return { path, blocks, options: options.eol ? { eol: options.eol } : undefined };
  });
}

/** The texts of a world, flat. */
export const allTexts = (w: World): string[] => w.texts.flat();

/** The text of unit `i` of file `f`. */
export const at = (w: World, f: number, i: number): string => (w.texts[f] as string[])[i] as string;
