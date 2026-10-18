import type { Fate } from './anchor-case';
import { lowerFirst } from './anchor-world';
import type { Block } from './compose';
import type { EstateFile } from './estate';
import { longMake, type Prose, type Rng, rewordWords, shortRule, similarity } from './words';

/**
 * Edit scripts built as segments. A segment says what a stretch of the old estate becomes in the new one; the
 * old and new files are the concatenation of the segments' halves, so the truth (the fate of every old unit)
 * comes from construction.
 */

export type Segment = {
  before: string[];
  after: string[];
  fates: Array<{ text: string; fate: Fate }>;
  /** The file index of the segment (its `before` side); a move-in names its own. */
  file: number;
  /** For a move: the segment's `after` side belongs to this file. */
  afterFile?: number;
};

/**
 * Random prose is about 0.3 alike on average and 1 pair in 30 passes 0.4 (the design's text floor), so a text
 * is called unrelated to others when it is under 0.39 alike to each of them.
 */
export const UNRELATED = 0.39;

export const unrelatedTo = (p: Prose, olds: string[], limit = UNRELATED): string => {
  for (let i = 0; i < 1500; i += 1) {
    const c = p.next(longMake);
    if (olds.every((o) => similarity(c, o) < limit)) return c;
  }
  throw new Error('no unrelated sentence');
};

/** A reword of `text` whose similarity to it lies in [lo, hi]. */
export function rewordSim(rng: Rng, text: string, lo: number, hi: number): string {
  for (let round = 0; round < 60; round += 1) {
    const k = 1 + Math.floor(rng() * 10);
    const candidate = rewordWords(rng, text, k);
    const s = similarity(text, candidate);
    if (candidate !== text && s >= lo && s <= hi) return candidate;
  }
  throw new Error('no reword in range');
}

export function splitParts(p: Prose): { a: string; b: string; whole: string } {
  const a = p.next(longMake).replace(/\.$/, '');
  const bText = p.next(shortRule);
  const b = bText.replace(/\.$/, '');
  return { a: `${a}.`, b: bText, whole: `${a}, and ${lowerFirst(b)}.` };
}

export type ScriptOps = Array<
  'keep' | 'reword' | 'rewrite' | 'delete' | 'insert' | 'move' | 'split' | 'merge'
>;

const unlike = (text: string, others: readonly string[]) =>
  others.every((o) => similarity(text, o) < UNRELATED);

/**
 * Builds segments for the ops (each op once, shuffled among keepers) over `files` files. Every text that leaves
 * the estate is under 0.39 alike to every text that enters it, except the pair a segment itself makes, so the
 * ladder has one right answer for each unit.
 */
export function buildScript(p: Prose, ops: ScriptOps, fillers: number, files: number): Segment[] {
  const rng = p.random;
  const resOld: string[] = [];
  const resNew: string[] = [];
  const segs: Segment[] = [];
  const total = ops.length + fillers;
  const order = [...ops, ...Array.from({ length: fillers }, () => 'keep' as const)].sort(() => rng() - 0.5);
  const moves: Array<{ into: Segment; outIndex: number }> = [];
  /** Draws until the olds and the news fit the residue; each side is checked against the other side only. */
  const draw = <T extends { olds: string[]; news: string[] }>(make: () => T): T => {
    for (let i = 0; i < 400; i += 1) {
      const candidate = make();
      if (candidate.olds.every((o) => unlike(o, resNew)) && candidate.news.every((n) => unlike(n, resOld))) {
        resOld.push(...candidate.olds);
        resNew.push(...candidate.news);
        return candidate;
      }
    }
    throw new Error('the script could not keep its units apart');
  };
  order.forEach((op, i) => {
    const file = Math.min(files - 1, Math.floor((i / total) * files));
    if (op === 'keep') {
      const t = p.next(longMake);
      segs.push({ before: [t], after: [t], fates: [], file });
    } else if (op === 'reword') {
      const { t, t2 } = draw(() => {
        const t = p.next(longMake);
        const t2 = rewordSim(rng, t, 0.6, 0.9);
        return { t, t2, olds: [t], news: [t2] };
      });
      segs.push({ before: [t], after: [t2], fates: [{ text: t, fate: { kind: 'changed', to: t2 } }], file });
    } else if (op === 'rewrite') {
      const { t, u } = draw(() => {
        const t = p.next(longMake);
        const u = unrelatedTo(p, [t]);
        return { t, u, olds: [t], news: [u] };
      });
      segs.push({ before: [t], after: [u], fates: [{ text: t, fate: { kind: 'deleted' } }], file });
    } else if (op === 'delete') {
      const { t } = draw(() => {
        const t = p.next(longMake);
        return { t, olds: [t], news: [] };
      });
      segs.push({ before: [t], after: [], fates: [{ text: t, fate: { kind: 'deleted' } }], file });
    } else if (op === 'insert') {
      const { u } = draw(() => {
        const u = p.next(longMake);
        return { u, olds: [], news: [u] };
      });
      segs.push({ before: [], after: [u], fates: [], file });
    } else if (op === 'move') {
      const t = p.next(longMake);
      segs.push({ before: [t], after: [], fates: [], file });
      moves.push({
        outIndex: segs.length - 1,
        into: { before: [], after: [t], fates: [], file: -1, afterFile: (file + 1) % files },
      });
    } else if (op === 'split') {
      const { a, b, whole } = draw(() => {
        const { a, b, whole } = splitParts(p);
        return { a, b, whole, olds: [whole], news: [a, b] };
      });
      segs.push({
        before: [whole],
        after: [a, b],
        fates: [{ text: whole, fate: { kind: 'split', parts: [a, b] } }],
        file,
      });
    } else if (op === 'merge') {
      const { a, b, whole } = draw(() => {
        const { a, b, whole } = splitParts(p);
        return { a, b, whole, olds: [a, b], news: [whole] };
      });
      segs.push({
        before: [a, b],
        after: [whole],
        fates: [
          { text: a, fate: { kind: 'mergePair', other: b, into: whole } },
          { text: b, fate: { kind: 'mergePair', other: a, into: whole } },
        ],
        file,
      });
    }
  });
  // moves land away from where they left, so a move cannot be told from the keepers around it moving instead
  for (const { into, outIndex } of moves) {
    let at = Math.floor(rng() * (segs.length + 1));
    for (let tries = 0; tries < 80 && files === 1 && Math.abs(at - outIndex) < 4; tries += 1) {
      at = Math.floor(rng() * (segs.length + 1));
    }
    segs.splice(at, 0, into);
  }
  for (const { into } of moves) {
    const text = into.after[0] as string;
    const fate: Fate = {
      kind: 'moved',
      events: ['moved', 'unchanged'],
      path: `notes/file-${(into.afterFile ?? 0) + 1}.md`,
    };
    segs.push({ before: [], after: [], fates: [{ text, fate }], file: 0 });
  }
  return segs;
}

/** The old and new files of a script. A segment of a file lands in the file, in order. */
export function filesOfSegments(
  segs: Segment[],
  files: number,
  headings: string[],
): { before: EstateFile[]; after: EstateFile[] } {
  const side = (which: 'before' | 'after'): EstateFile[] =>
    Array.from({ length: files }, (_, f) => {
      const blocks: Block[] = [{ kind: 'heading', level: 1, text: headings[f] as string }];
      for (const seg of segs) {
        const target = which === 'after' && seg.afterFile !== undefined ? seg.afterFile : seg.file;
        if (target !== f) continue;
        for (const t of seg[which]) blocks.push({ kind: 'paragraph', sentences: [t] });
      }
      return { path: `notes/file-${f + 1}.md`, blocks };
    });
  return { before: side('before'), after: side('after') };
}
