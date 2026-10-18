import { anchorCase, type Fate } from '../../kit/anchor-case';
import {
  allTexts,
  cloneWorld,
  distinctSentences,
  filesOf,
  longSentence,
  lowerFirst,
  type World,
  worldOf,
} from '../../kit/anchor-world';
import type { Block } from '../../kit/compose';
import { build, byId, type EstateFile, eventNow, liveByText, liveOf, scanOk } from '../../kit/estate';
import { perfect } from '../../kit/labellers';
import { norm } from '../../kit/norm';
import { buildScript, filesOfSegments, rewordSim, splitParts, unrelatedTo } from '../../kit/segments';
import { longMake, Prose, rewordWords, shortRule, similarity } from '../../kit/words';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const small = (ctx: ItemContext, files = 3, perFile = 10) => {
  const p = prose(ctx);
  return { p, w: worldOf(p, { files, perFile }) };
};
const mid = (ctx: ItemContext) => {
  const p = prose(ctx);
  return { p, w: worldOf(p, { files: 1, perFile: 30 }) };
};
const same = (
  ctx: ItemContext,
  mutate: (p: Prose, w: World) => void,
  render: Parameters<typeof filesOf>[1] = {},
  renderAfter?: Parameters<typeof filesOf>[1],
): Promise<Outcome> => {
  const { p, w } = small(ctx);
  const v2 = cloneWorld(w);
  mutate(p, v2);
  return anchorCase(ctx, { before: filesOf(w, render), after: filesOf(v2, renderAfter ?? render) });
};
const fatesFor = (texts: string[], fate: Fate) => texts.map((text) => ({ text, fate }));

/** Every unit text of a world as moved/unchanged to a new path. */
const movedAll = (w: World, path: (i: number) => string) =>
  w.texts.flatMap((ts, f) =>
    ts.map((text) => ({
      text,
      fate: { kind: 'moved', events: ['moved', 'unchanged'], path: path(f) } as Fate,
    })),
  );

/* ---------- unit kinds ---------- */

type Kind = 'sentence' | 'list_item' | 'table_cell' | 'heading' | 'block_quote' | 'front_matter';
const strip = (t: string) => t.replace(/\.$/, '');

function kindFiles(kind: Kind, texts: string[], fillers: string[]): EstateFile[] {
  const blocks: Block[] = [];
  const ts = texts.map((t) => (kind === 'heading' ? strip(t) : t));
  if (kind === 'sentence') for (const t of ts) blocks.push({ kind: 'paragraph', sentences: [t] });
  else if (kind === 'list_item') blocks.push({ kind: 'list', items: ts.map((text) => ({ text })) });
  else if (kind === 'table_cell') {
    blocks.push({ kind: 'table', header: ['item', 'note'], rows: ts.map((t, i) => [`row${i}x`, t]) });
  } else if (kind === 'heading') {
    ts.forEach((t, i) => {
      blocks.push({ kind: 'heading', level: 2, text: t });
      blocks.push({ kind: 'paragraph', sentences: [fillers[i] as string] });
    });
  } else if (kind === 'block_quote') for (const t of ts) blocks.push({ kind: 'quote', paragraphs: [t] });
  else {
    blocks.push({ kind: 'front', entries: ts.map((t, i) => ({ key: `field${i}`, value: t })) });
    blocks.push({ kind: 'paragraph', sentences: [fillers[0] as string] });
  }
  return [{ path: kind === 'front_matter' ? 'notes/front.md' : 'notes/kind.md', blocks }];
}

async function kindEdit(
  ctx: ItemContext,
  kind: Kind,
  edit: (p: Prose, text: string) => string,
): Promise<Outcome> {
  const p = prose(ctx);
  const texts = distinctSentences(p, 8);
  const fillers = p.many(8, longMake);
  const target = 3;
  const next = [...texts];
  next[target] = edit(p, texts[target] as string);
  const shown = (t: string) => (kind === 'heading' ? strip(t) : t);
  return anchorCase(ctx, {
    before: kindFiles(kind, texts, fillers),
    after: kindFiles(kind, next, fillers),
    fates: [
      { text: shown(texts[target] as string), fate: { kind: 'changed', to: shown(next[target] as string) } },
    ],
  });
}

async function kindRewrite(ctx: ItemContext, kind: Kind): Promise<Outcome> {
  const p = prose(ctx);
  const texts = distinctSentences(p, 8);
  const fillers = p.many(8, longMake);
  const target = 3;
  const next = [...texts];
  next[target] = unrelatedTo(p, [texts[target] as string]);
  const shown = (t: string) => (kind === 'heading' ? strip(t) : t);
  return anchorCase(ctx, {
    before: kindFiles(kind, texts, fillers),
    after: kindFiles(kind, next, fillers),
    fates: [{ text: shown(texts[target] as string), fate: { kind: 'deleted' } }],
  });
}

const addClause = (t: string) => (t.endsWith('.') ? `${t.slice(0, -1)}, and log it.` : `${t}, and log it`);
const flipCase = (t: string) => t.replace(/\b([a-z]{5,})\b/, (m) => m.toUpperCase());
const negate = (t: string) => {
  const ws = t.split(' ');
  ws.splice(3, 0, 'not');
  return ws.join(' ');
};

/* ---------- scripts ---------- */

async function scriptCase(
  ctx: ItemContext,
  ops: Parameters<typeof buildScript>[1],
  fillers: number,
  files: number,
): Promise<Outcome> {
  const p = prose(ctx);
  const segs = buildScript(p, ops, fillers, files);
  const heads = Array.from(
    { length: files },
    (_, f) => `Notes number ${f + 1} ${p.random().toString(36).slice(2, 5)}`,
  );
  const { before, after } = filesOfSegments(segs, files, heads);
  const fates = segs.flatMap((s) => s.fates);
  return anchorCase(
    ctx,
    { before, after, fates },
    `${ops.length} edits over ${fillers + ops.length} units in ${files} files`,
  );
}

/** Headings and the first units of sectioned files. */
function sectioned(
  p: Prose,
  sections: number,
  per: number,
): { heads: string[]; texts: string[][]; blocks: (order: number[], texts?: string[][]) => Block[] } {
  const heads = Array.from(
    { length: sections },
    (_, i) => `Round ${i + 1} ${p.next(shortRule).replace(/\.$/, '')}`,
  );
  const all = distinctSentences(p, sections * per);
  const texts = Array.from({ length: sections }, (_, s) => all.slice(s * per, (s + 1) * per));
  return {
    heads,
    texts,
    blocks: (order, override) =>
      order.flatMap((s) => [
        { kind: 'heading', level: 2, text: heads[s] as string } as Block,
        ...((override ?? texts)[s] as string[]).map((t) => ({ kind: 'paragraph', sentences: [t] }) as Block),
      ]),
  };
}

export const reanchoringRuns: Record<string, Run> = {
  noop: (ctx) => same(ctx, () => undefined),
  rewrap: (ctx) => same(ctx, () => undefined, {}, { wrap: 47 }),
  'crlf-conversion': (ctx) => same(ctx, () => undefined, {}, { eol: '\r\n' }),
  'bullet-swap': (ctx) => same(ctx, () => undefined, { list: { marker: '-' } }, { list: { marker: '*' } }),
  renumber: (ctx) =>
    same(ctx, () => undefined, { list: { marker: '1.', start: 1 } }, { list: { marker: '1.', start: 4 } }),
  'blank-lines': (ctx) => same(ctx, () => undefined, {}, { spaced: true }),
  'paragraph-break-between-sentences': (ctx) => same(ctx, () => undefined, { per: 2 }, { per: 1 }),
  'heading-rename-keeps-units': async (ctx) => {
    const p = prose(ctx);
    const s = sectioned(p, 3, 6);
    const oldHead = s.heads[1] as string;
    const newHead = `Locking rounds ${p.random().toString(36).slice(2, 6)}`;
    const before: EstateFile[] = [{ path: 'notes/s.md', blocks: s.blocks([0, 1, 2]) }];
    const afterBlocks = s
      .blocks([0, 1, 2])
      .map((b) => (b.kind === 'heading' && b.text === oldHead ? { ...b, text: newHead } : b));
    return anchorCase(ctx, {
      before,
      after: [{ path: 'notes/s.md', blocks: afterBlocks }],
      fates: [{ text: oldHead, fate: { kind: 'deleted' } }],
      skip: [oldHead, newHead],
      extra: (run) => {
        for (const t of s.texts[1] as string[]) {
          const e = liveByText(run.after.ledger, t);
          if (!e) return `${t.slice(0, 30)} lost its entry`;
          if (e.sectionPath[e.sectionPath.length - 1] !== newHead)
            return `the unit under the renamed heading has sectionPath ${JSON.stringify(e.sectionPath)}`;
        }
        return undefined;
      },
    });
  },
  'move-within-file': async (ctx) => {
    const { w } = mid(ctx);
    const v2 = cloneWorld(w);
    const [t] = (v2.texts[0] ?? []).splice(0, 1);
    v2.texts[0]?.push(t as string);
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [{ text: t as string, fate: { kind: 'moved' } }],
    });
  },
  'move-section': async (ctx) => {
    const p = prose(ctx);
    const s = sectioned(p, 6, 4);
    const moving = s.texts[0] as string[];
    return anchorCase(ctx, {
      before: [{ path: 'notes/s.md', blocks: s.blocks([0, 1, 2, 3, 4, 5]) }],
      after: [{ path: 'notes/s.md', blocks: s.blocks([1, 2, 3, 4, 5, 0]) }],
      fates: fatesFor(moving, { kind: 'moved' }),
      skip: [s.heads[0] as string],
    });
  },
  'move-swap-two': async (ctx) => {
    const { w } = mid(ctx);
    const v2 = cloneWorld(w);
    const a = v2.texts[0]?.[6] as string;
    const b = v2.texts[0]?.[19] as string;
    v2.texts[0]![6] = b;
    v2.texts[0]![19] = a;
    const fate: Fate = { kind: 'moved', events: ['moved', 'unchanged'] };
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [
        { text: a, fate },
        { text: b, fate },
      ],
    });
  },
  'move-across-files': async (ctx) => {
    const { w } = small(ctx, 2, 10);
    const v2 = cloneWorld(w);
    const [t] = (v2.texts[0] ?? []).splice(3, 1);
    v2.texts[1]?.splice(5, 0, t as string);
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [{ text: t as string, fate: { kind: 'moved', path: w.paths[1] as string } }],
    });
  },
  'file-rename': async (ctx) => {
    const { w } = small(ctx, 1, 12);
    const v2 = cloneWorld(w);
    v2.paths[0] = 'notes/renamed-file.md';
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: movedAll(w, () => 'notes/renamed-file.md'),
      skip: [w.heads[0] as string],
    });
  },
  'directory-rename': async (ctx) => {
    const { w } = small(ctx, 3, 10);
    const v2 = cloneWorld(w);
    v2.paths = v2.paths.map((p) => p.replace('notes/', 'archive/'));
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: movedAll(w, (f) => v2.paths[f] as string),
      skip: w.heads,
    });
  },
  'move-and-reword': async (ctx) => {
    const { p, w } = mid(ctx);
    const v2 = cloneWorld(w);
    const [t] = (v2.texts[0] ?? []).splice(2, 1);
    const t2 = rewordSim(p.random, t as string, 0.75, 0.95);
    v2.texts[0]?.push(t2);
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [{ text: t as string, fate: { kind: 'changed', to: t2 } }],
    });
  },
  'move-ambiguous-two-targets': async (ctx) => {
    const { w } = mid(ctx);
    const v2 = cloneWorld(w);
    const [t] = (v2.texts[0] ?? []).splice(8, 1);
    (v2.texts[0] ?? []).splice(2, 0, t as string);
    (v2.texts[0] ?? []).splice(20, 0, t as string);
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [{ text: t as string, fate: { kind: 'ambiguous' } }],
      skip: [t as string],
    });
  },
  'twin-delete-is-not-a-move': async (ctx) => {
    const p = prose(ctx);
    const shared = longSentence(p);
    const a = distinctSentences(p, 6);
    const aBlocks = (withShared: boolean): Block[] => [
      ...a.map((t) => ({ kind: 'paragraph', sentences: [t] }) as Block),
      ...(withShared ? [{ kind: 'paragraph', sentences: [shared] } as Block] : []),
    ];
    const bBlocks: Block[] = [
      { kind: 'paragraph', sentences: [shared] },
      { kind: 'paragraph', sentences: [longSentence(p)] },
    ];
    const first = await scanOk(ctx.sut, {
      files: build([
        { path: 'a.md', blocks: aBlocks(true) },
        { path: 'b.md', blocks: bBlocks },
      ]).files,
      labeler: perfect(),
    });
    const second = await scanOk(ctx.sut, {
      files: build([
        { path: 'a.md', blocks: aBlocks(false) },
        { path: 'b.md', blocks: bBlocks },
      ]).files,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const inA = first.ledger.entries.find((e) => e.path === 'a.md' && norm(e.quote) === norm(shared));
    const inB = first.ledger.entries.find((e) => e.path === 'b.md' && norm(e.quote) === norm(shared));
    if (!inA || !inB) return fail('the first scan lacks an entry for the shared unit');
    const nowA = byId(second.ledger, inA.id);
    const nowB = byId(second.ledger, inB.id);
    if (!nowA || nowA.status === 'live')
      return fail('the deleted copy in a.md is still live (it was taken for a move to b.md)');
    if (eventNow(second, nowA) !== 'deleted')
      return fail(`the deleted copy has event ${eventNow(second, nowA)}, expected deleted`);
    if (nowB?.status !== 'live' || eventNow(second, nowB) !== 'unchanged')
      return fail('the copy in b.md did not stay unchanged');
    return pass('deleted in a.md, unchanged in b.md');
  },
  'copy-keeps-original': async (ctx) => {
    const { w } = mid(ctx);
    const v2 = cloneWorld(w);
    const t = w.texts[0]?.[9] as string;
    v2.texts[0]?.push(t);
    const first = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler: perfect() });
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const original = liveByText(first.ledger, t)?.id;
    const copies = liveOf(second.ledger).filter((e) => norm(e.quote) === norm(t));
    if (copies.length !== 2 || new Set(copies.map((e) => e.id)).size !== 2)
      return fail(`${copies.length} live entries for the copied text, expected 2 with distinct ids`);
    const old = copies.find((e) => e.id === original);
    if (!old) return fail('the original lost its id to the copy');
    return eventNow(second, old) === 'unchanged'
      ? pass('original kept, copy fresh')
      : fail(`the original has event ${eventNow(second, old)}, expected unchanged`);
  },
  'duplicate-section-insert': async (ctx) => {
    const p = prose(ctx);
    const s = sectioned(p, 3, 5);
    const v1 = s.blocks([0, 1, 2]);
    const dup = s.blocks([1]);
    const v2 = [...s.blocks([0, 1]), ...dup, ...s.blocks([2])];
    const first = await scanOk(ctx.sut, {
      files: build([{ path: 'notes/s.md', blocks: v1 }]).files,
      labeler: perfect(),
    });
    const second = await scanOk(ctx.sut, {
      files: build([{ path: 'notes/s.md', blocks: v2 }]).files,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const old = new Set(first.ledger.entries.map((e) => e.id));
    for (const t of s.texts[1] as string[]) {
      const copies = liveOf(second.ledger).filter((e) => norm(e.quote) === norm(t));
      const carried = copies.filter((e) => old.has(e.id));
      if (copies.length !== 2 || carried.length !== 1)
        return fail(
          `${JSON.stringify(t.slice(0, 30))}: ${copies.length} copies, ${carried.length} carry the old id (expected 2 and 1)`,
        );
    }
    const deleted = second.ledger.entries.filter((e) => e.status !== 'live' && old.has(e.id));
    return deleted.length === 0
      ? pass('each old id carried by one copy')
      : fail(`${deleted.length} old units were deleted though the text still exists`);
  },
  'reword-one-word': (ctx) => kindEdit(ctx, 'sentence', (p, t) => rewordWords(p.random, t, 1)),
  'reword-two-words': (ctx) => kindEdit(ctx, 'sentence', (p, t) => rewordWords(p.random, t, 2)),
  'reword-append-clause': (ctx) => kindEdit(ctx, 'sentence', (_p, t) => addClause(t)),
  'reword-prepend-clause': (ctx) => kindEdit(ctx, 'sentence', (_p, t) => `In every case, ${lowerFirst(t)}`),
  'reword-case-flip-word': (ctx) => kindEdit(ctx, 'sentence', (_p, t) => flipCase(t)),
  'reword-negation': (ctx) => kindEdit(ctx, 'sentence', (_p, t) => negate(t)),
  'reword-number': async (ctx) => {
    const p = prose(ctx);
    const texts = distinctSentences(p, 8).map((t) => t.replace(/\.$/, ' for step 3.'));
    const fillers = p.many(8, longMake);
    const next = [...texts];
    next[3] = texts[3]?.replace('step 3', 'step 4') as string;
    return anchorCase(ctx, {
      before: kindFiles('sentence', texts, fillers),
      after: kindFiles('sentence', next, fillers),
      fates: [{ text: texts[3] as string, fate: { kind: 'changed', to: next[3] as string } }],
    });
  },
  'reword-list-item': (ctx) => kindEdit(ctx, 'list_item', (p, t) => rewordWords(p.random, t, 1)),
  'reword-table-cell': (ctx) => kindEdit(ctx, 'table_cell', (p, t) => rewordWords(p.random, t, 1)),
  'reword-heading': (ctx) => kindEdit(ctx, 'heading', (p, t) => rewordWords(p.random, t, 1)),
  'reword-quote-paragraph': (ctx) => kindEdit(ctx, 'block_quote', (p, t) => rewordWords(p.random, t, 1)),
  'reword-front-matter-value': (ctx) => kindEdit(ctx, 'front_matter', (p, t) => rewordWords(p.random, t, 1)),
  'reword-moderate': async (ctx) => {
    const { p, w } = mid(ctx);
    const v2 = cloneWorld(w);
    const t = w.texts[0]?.[11] as string;
    const t2 = rewordSim(p.random, t, 0.6, 0.8);
    v2.texts[0]![11] = t2;
    return anchorCase(
      ctx,
      { before: filesOf(w), after: filesOf(v2), fates: [{ text: t, fate: { kind: 'changed', to: t2 } }] },
      `similarity ${similarity(t, t2).toFixed(2)}`,
    );
  },
  'rewrite-sentence': (ctx) => kindRewrite(ctx, 'sentence'),
  'rewrite-list-item': (ctx) => kindRewrite(ctx, 'list_item'),
  'rewrite-table-cell': (ctx) => kindRewrite(ctx, 'table_cell'),
  'rewrite-heading': (ctx) => kindRewrite(ctx, 'heading'),
  'rewrite-ten-in-a-row': async (ctx) => {
    const { p, w } = mid(ctx);
    const v2 = cloneWorld(w);
    const olds = (w.texts[0] ?? []).slice(8, 18);
    const fresh: string[] = [];
    for (const [i, t] of olds.entries()) {
      const u = unrelatedTo(p, [...olds, ...fresh]);
      fresh.push(u);
      v2.texts[0]![8 + i] = u;
      void t;
    }
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: fatesFor(olds, { kind: 'deleted' }),
    });
  },
  'rewrite-similar-to-neighbour': async (ctx) => {
    const { p, w } = mid(ctx);
    const v2 = cloneWorld(w);
    const a = w.texts[0]?.[10] as string;
    const b = w.texts[0]?.[11] as string;
    let a2 = '';
    for (let i = 0; i < 400 && !a2; i += 1) {
      const c = rewordSim(p.random, b, 0.62, 0.78);
      if (similarity(c, a) < 0.39 && !allTexts(w).includes(c)) a2 = c;
    }
    if (!a2) return fail('the item could not build a rewrite that resembles the neighbour');
    v2.texts[0]![10] = a2;
    return anchorCase(
      ctx,
      { before: filesOf(w), after: filesOf(v2), fates: [{ text: a, fate: { kind: 'deleted' } }] },
      `the new text is ${similarity(a2, b).toFixed(2)} like its neighbour`,
    );
  },
  'reword-sweep-monotone': async (ctx) => {
    const p = prose(ctx);
    const length = 100 + Math.floor(p.random() * 40);
    const old = `M${'b'.repeat(length)}.`;
    let checked = 0;
    // Each edit has its own scan pair: changing another target cannot change this one's context.
    const frame = (text: string, mark: string) =>
      `# ${mark.repeat(40)}\n\n${mark.repeat(80)}.\n\n${text}\n\n${mark.repeat(80)}.\n`;
    const context = (source: string, text: string) => {
      const start = source.indexOf(text);
      return {
        prefix: source.slice(Math.max(0, start - 24), start),
        suffix: source.slice(start + text.length, start + text.length + 24),
      };
    };
    for (const share of [0.3, 0.43, 0.53, 0.74, 0.87]) {
      const kept = Math.round(length * share);
      const next = `M${'b'.repeat(kept)}${'q'.repeat(length - kept)}.`;
      for (const sameContext of [true, false]) {
        const before = frame(old, 'A');
        const after = frame(next, sameContext ? 'A' : 'Z');
        const left = context(before, old);
        const right = context(after, next);
        const textScore = similarity(norm(old), norm(next));
        const contextScore =
          (similarity(left.prefix, right.prefix) +
            similarity(left.suffix, right.suffix) +
            (sameContext ? 1 : 0)) /
          3;
        const score = 0.6 * textScore + 0.4 * contextScore;
        const retain = textScore > 0.4 && score > 0.45;
        const first = await scanOk(ctx.sut, {
          files: [{ path: 'notes/score.md', text: before }],
          labeler: perfect(),
        });
        const original = liveByText(first.ledger, old);
        if (!original) return fail('positive witness: the planted original unit is absent');
        const second = await scanOk(ctx.sut, {
          files: [{ path: 'notes/score.md', text: after }],
          previousLedger: first.ledger.raw,
          labeler: perfect(),
        });
        const fresh = liveByText(second.ledger, next);
        if (!fresh) return fail('positive witness: the planted replacement unit is absent');
        const retained = fresh.id === original.id;
        if (retained !== retain)
          return fail(
            `weighted score ${score.toFixed(3)}, text ${textScore.toFixed(3)}, context ${contextScore.toFixed(3)}: expected ${retain ? 'retention' : 'a new id'}`,
          );
        const event = eventNow(second, retain ? fresh : (byId(second.ledger, original.id) ?? original));
        if (event !== (retain ? 'changed' : 'deleted'))
          return fail(`the reader reports ${event} for the weighted-score decision`);
        checked += 1;
      }
    }
    return pass(`${checked} text/context boundary cases match the weighted rule`);
  },
  'split-sentence': async (ctx) => {
    const p = prose(ctx);
    const { a, b, whole } = splitParts(p);
    const rest = distinctSentences(p, 6);
    const mk = (parts: string[]) => [
      {
        path: 'notes/a.md',
        blocks: [...rest.slice(0, 3), ...parts, ...rest.slice(3)].map(
          (t) => ({ kind: 'paragraph', sentences: [t] }) as Block,
        ),
      },
    ];
    return anchorCase(ctx, {
      before: mk([whole]),
      after: mk([a, b]),
      fates: [{ text: whole, fate: { kind: 'split', parts: [a, b] } }],
    });
  },
  'split-list-item': async (ctx) => {
    const p = prose(ctx);
    const { a, b, whole } = splitParts(p);
    const rest = distinctSentences(p, 6);
    const mk = (parts: string[]) => [
      {
        path: 'notes/a.md',
        blocks: [
          {
            kind: 'list',
            items: [...rest.slice(0, 3), ...parts, ...rest.slice(3)].map((text) => ({ text })),
          } as Block,
        ],
      },
    ];
    return anchorCase(ctx, {
      before: mk([whole]),
      after: mk([a, b]),
      fates: [{ text: whole, fate: { kind: 'split', parts: [a, b] } }],
    });
  },
  'split-three-way': async (ctx) => {
    const p = prose(ctx);
    const a = strip(p.next(longMake));
    const b = strip(p.next(shortRule));
    const c = strip(p.next(shortRule));
    const whole = `${a}, ${lowerFirst(b)} and ${lowerFirst(c)}.`;
    const rest = distinctSentences(p, 6);
    const mk = (parts: string[]) => [
      {
        path: 'notes/a.md',
        blocks: [...rest.slice(0, 3), ...parts, ...rest.slice(3)].map(
          (t) => ({ kind: 'paragraph', sentences: [t] }) as Block,
        ),
      },
    ];
    return anchorCase(ctx, {
      before: mk([whole]),
      after: mk([`${a}.`, `${b}.`, `${c}.`]),
      fates: [{ text: whole, fate: { kind: 'split', parts: [`${a}.`, `${b}.`, `${c}.`] } }],
    });
  },
  'merge-sentences': async (ctx) => {
    const p = prose(ctx);
    const { a, b, whole } = splitParts(p);
    const rest = distinctSentences(p, 6);
    const mk = (parts: string[]) => [
      {
        path: 'notes/a.md',
        blocks: [...rest.slice(0, 3), ...parts, ...rest.slice(3)].map(
          (t) => ({ kind: 'paragraph', sentences: [t] }) as Block,
        ),
      },
    ];
    return anchorCase(ctx, {
      before: mk([a, b]),
      after: mk([whole]),
      fates: [
        { text: a, fate: { kind: 'mergePair', other: b, into: whole } },
        { text: b, fate: { kind: 'mergePair', other: a, into: whole } },
      ],
    });
  },
  'merge-list-items': async (ctx) => {
    const p = prose(ctx);
    const { a, b, whole } = splitParts(p);
    const rest = distinctSentences(p, 6);
    const mk = (parts: string[]) => [
      {
        path: 'notes/a.md',
        blocks: [
          {
            kind: 'list',
            items: [...rest.slice(0, 3), ...parts, ...rest.slice(3)].map((text) => ({ text })),
          } as Block,
        ],
      },
    ];
    return anchorCase(ctx, {
      before: mk([a, b]),
      after: mk([whole]),
      fates: [
        { text: a, fate: { kind: 'mergePair', other: b, into: whole } },
        { text: b, fate: { kind: 'mergePair', other: a, into: whole } },
      ],
    });
  },
  'merge-with-reword': async (ctx) => {
    const p = prose(ctx);
    const { a, b } = splitParts(p);
    const aw = rewordWords(p.random, a, 1);
    const whole = `${strip(aw)}, and ${lowerFirst(strip(b))}.`;
    const rest = distinctSentences(p, 6);
    const mk = (parts: string[]) => [
      {
        path: 'notes/a.md',
        blocks: [...rest.slice(0, 3), ...parts, ...rest.slice(3)].map(
          (t) => ({ kind: 'paragraph', sentences: [t] }) as Block,
        ),
      },
    ];
    return anchorCase(ctx, {
      before: mk([a, b]),
      after: mk([whole]),
      fates: [
        { text: a, fate: { kind: 'mergePair', other: b, into: whole } },
        { text: b, fate: { kind: 'mergePair', other: a, into: whole } },
      ],
    });
  },
  'delete-one': async (ctx) => {
    const { w } = mid(ctx);
    const v2 = cloneWorld(w);
    const [t] = (v2.texts[0] ?? []).splice(13, 1);
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [{ text: t as string, fate: { kind: 'deleted' } }],
    });
  },
  'delete-section': async (ctx) => {
    const p = prose(ctx);
    const s = sectioned(p, 4, 5);
    const gone = [s.heads[1] as string, ...(s.texts[1] as string[])];
    return anchorCase(ctx, {
      before: [{ path: 'notes/s.md', blocks: s.blocks([0, 1, 2, 3]) }],
      after: [{ path: 'notes/s.md', blocks: s.blocks([0, 2, 3]) }],
      fates: fatesFor(gone, { kind: 'deleted' }),
    });
  },
  'delete-file': async (ctx) => {
    const { w } = small(ctx, 4, 10);
    const v2 = cloneWorld(w);
    const gone = [w.heads[2] as string, ...(w.texts[2] as string[])];
    v2.paths.splice(2, 1);
    v2.heads.splice(2, 1);
    v2.texts.splice(2, 1);
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: fatesFor(gone, { kind: 'deleted' }),
    });
  },
  'replace-whole-file': async (ctx) => {
    const { p, w } = small(ctx, 2, 20);
    const v2 = cloneWorld(w);
    const fresh: string[] = [];
    v2.texts[1] = (w.texts[1] as string[]).map(() => {
      const u = unrelatedTo(p, [...(w.texts[1] as string[]), ...fresh]);
      fresh.push(u);
      return u;
    });
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: fatesFor(w.texts[1] as string[], { kind: 'deleted' }),
    });
  },
  'script-mixed-6': (ctx) =>
    scriptCase(ctx, ['reword', 'rewrite', 'delete', 'insert', 'move', 'split'], 30, 1),
  'script-mixed-20': (ctx) =>
    scriptCase(
      ctx,
      [
        'reword',
        'rewrite',
        'delete',
        'insert',
        'move',
        'split',
        'merge',
        'reword',
        'rewrite',
        'delete',
        'insert',
        'split',
        'merge',
        'reword',
        'rewrite',
        'delete',
        'insert',
        'reword',
        'split',
        'merge',
      ],
      100,
      1,
    ),
  'script-multi-file': (ctx) =>
    scriptCase(
      ctx,
      [
        'reword',
        'rewrite',
        'delete',
        'insert',
        'move',
        'move',
        'move',
        'split',
        'merge',
        'reword',
        'rewrite',
        'delete',
        'insert',
        'reword',
        'split',
      ],
      150,
      10,
    ),
  'no-wrong-anchors-fuzz': async (ctx) => {
    const labeler = perfect();
    for (let round = 0; round < 100; round += 1) {
      const p = new Prose(ctx.seed, `${ctx.id}:${round}`);
      const rng = p.random;
      const texts = distinctSentences(p, 8);
      const next: string[] = [];
      const used: string[] = [...texts];
      for (const [i, t] of texts.entries()) {
        const roll = rng();
        if (roll < 0.35) next.push(t);
        else if (roll < 0.5) next.push(rewordWords(rng, t, 1 + Math.floor(rng() * 8)));
        else if (roll < 0.62) {
          const u = unrelatedTo(p, [t]);
          used.push(u);
          next.push(u);
        } else if (roll < 0.72) continue;
        else if (roll < 0.82) next.push(t, t);
        else next.push(t);
        void i;
      }
      const reverse = rng() < 0.5;
      const insert = rng() < 0.5;
      if (reverse) next.reverse();
      else if (insert) next.splice(Math.floor(rng() * next.length), 0, unrelatedTo(p, []));
      const before = [
        { path: 'f.md', blocks: texts.map((t) => ({ kind: 'paragraph', sentences: [t] }) as Block) },
      ];
      const after = [
        { path: 'f.md', blocks: next.map((t) => ({ kind: 'paragraph', sentences: [t] }) as Block) },
      ];
      const first = await scanOk(ctx.sut, { files: build(before).files, labeler });
      const second = await scanOk(ctx.sut, {
        files: build(after).files,
        previousLedger: first.ledger.raw,
        labeler,
      });
      const live = liveOf(second.ledger);
      if (live.length !== next.length)
        return fail(`round ${round}: ${live.length} live entries for ${next.length} units`);
      if (new Set(live.map((e) => e.id)).size !== live.length)
        return fail(`round ${round}: two live entries share an id`);
      const old = new Map(first.ledger.entries.map((e) => [e.id, e]));
      for (const e of live) {
        const was = old.get(e.id);
        if (!was) continue;
        if (norm(was.quote) !== norm(e.quote) && similarity(norm(was.quote), norm(e.quote)) < 0.3) {
          return fail(
            `round ${round}: ${JSON.stringify(was.quote.slice(0, 40))} was anchored to the unrelated ${JSON.stringify(e.quote.slice(0, 40))}`,
          );
        }
      }
    }
    return pass('100 random edit pairs, no wrong anchor');
  },
};
