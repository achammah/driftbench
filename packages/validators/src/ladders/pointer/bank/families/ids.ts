import { cloneWorld, distinctSentences, filesOf, longSentence, worldOf } from '../../kit/anchor-world';
import { runChild } from '../../kit/child-run';
import { type Block, compose } from '../../kit/compose';
import { build, byId, liveByText, liveOf, scanOk } from '../../kit/estate';
import { perfect } from '../../kit/labellers';
import { norm } from '../../kit/norm';
import { requireSourceWitness } from '../../kit/positive';
import { headingText, Prose, rewordWords } from '../../kit/words';
import { listOf, para } from '../../kit/world';
import type { LedgerEntry, LedgerView, ScanResult, SourceFile } from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const labeler = perfect();

async function fresh(
  ctx: ItemContext,
  files: SourceFile[],
  extra: { location?: { parent: string; name: string } } = {},
) {
  const result = await scanOk(ctx.sut, { files, labeler, ...extra });
  requireSourceWitness(result, files);
  return result;
}

const ordered = (ledger: LedgerView, path?: string): LedgerEntry[] =>
  liveOf(ledger)
    .filter((e) => path === undefined || e.path === path)
    .sort(
      (a, b) =>
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.hint?.start ?? 0) - (b.hint?.start ?? 0),
    );

/** Two variants of one document: every unit must have the same fingerprint (and id) in both. */
async function sameFingerprints(
  ctx: ItemContext,
  a: Block[],
  b: Block[],
  optionsB: Parameters<typeof compose>[1] = {},
): Promise<Outcome> {
  const docA = compose(a);
  const docB = compose(b, optionsB);
  const [ra, rb] = await Promise.all([
    fresh(ctx, [{ path: 'doc.md', text: docA.text }]),
    fresh(ctx, [{ path: 'doc.md', text: docB.text }]),
  ]);
  const ea = ordered(ra.ledger);
  const eb = ordered(rb.ledger);
  if (ea.length !== docA.units.length || eb.length !== docB.units.length)
    return fail('positive witness: a variant omitted planted units');
  if (ea.length !== eb.length) return fail(`${ea.length} units in one variant, ${eb.length} in the other`);
  for (const [i, x] of ea.entries()) {
    const y = eb[i] as LedgerEntry;
    if (x.fp !== y.fp)
      return fail(
        `unit ${i} has two fingerprints: ${JSON.stringify(x.quote.slice(0, 40))} against ${JSON.stringify(y.quote.slice(0, 40))}`,
      );
    if (x.id !== y.id) return fail(`unit ${i} has two ids for one fingerprint`);
  }
  return pass(`${ea.length} units share fingerprint and id across the variants`);
}

/** Single-sentence documents: their fingerprints must all differ. */
async function allDifferent(ctx: ItemContext, texts: string[]): Promise<Outcome> {
  const fps: string[] = [];
  for (const text of texts) {
    const result = await fresh(ctx, [
      { path: 'doc.md', text: compose([{ kind: 'paragraph', sentences: [text] }]).text },
    ]);
    const entry = ordered(result.ledger)[0];
    if (!entry) return fail(`no entry for ${JSON.stringify(text.slice(0, 40))}`);
    fps.push(entry.fp);
  }
  const seen = new Map<string, number>();
  for (const [i, fp] of fps.entries()) {
    const j = seen.get(fp);
    if (j !== undefined)
      return fail(
        `${JSON.stringify(texts[j]?.slice(0, 50))} and ${JSON.stringify(texts[i]?.slice(0, 50))} share one fingerprint`,
      );
    seen.set(fp, i);
  }
  return pass(`${texts.length} texts, ${texts.length} fingerprints`);
}

export const idsRuns: Record<string, Run> = {
  'fp-whitespace': async (ctx) => {
    const p = prose(ctx);
    const sentences = p.many(20);
    const a: Block[] = [{ kind: 'paragraph', sentences }];
    const docA = compose(a);
    const rng = p.random;
    const noisy = docA.text
      .replace(/ /g, () => (rng() < 0.3 ? '  ' : rng() < 0.15 ? '\t' : ' '))
      .replace(/\.\s/g, (m) => (rng() < 0.4 ? `. \n` : m));
    const [ra, rb] = await Promise.all([
      fresh(ctx, [{ path: 'doc.md', text: docA.text }]),
      fresh(ctx, [{ path: 'doc.md', text: noisy }]),
    ]);
    const ea = ordered(ra.ledger);
    const eb = ordered(rb.ledger);
    if (ea.length !== sentences.length || eb.length !== sentences.length)
      return fail('positive witness: whitespace variants omitted planted sentences');
    if (ea.length !== eb.length)
      return fail(`${ea.length} units against ${eb.length} after white space noise`);
    for (const [i, x] of ea.entries()) {
      const y = eb[i] as LedgerEntry;
      if (x.fp !== y.fp || x.id !== y.id) return fail(`unit ${i} changed fingerprint or id with white space`);
    }
    return pass(`${ea.length} units unchanged by white space`);
  },
  'fp-bullet-marker': async (ctx) => {
    const p = prose(ctx);
    const items = p.many(5).map((text) => ({ text }));
    const mk = (marker: '-' | '*' | '+'): Block[] => [{ kind: 'list', items, marker }];
    const one = await sameFingerprints(ctx, mk('-'), mk('*'));
    if (!one.pass) return one;
    return sameFingerprints(ctx, mk('-'), mk('+'));
  },
  'fp-ordered-marker': async (ctx) => {
    const p = prose(ctx);
    const items = p.many(5).map((text) => ({ text }));
    const base: Block[] = [{ kind: 'list', items, marker: '1.' }];
    const shifted = await sameFingerprints(ctx, base, [{ kind: 'list', items, marker: '1.', start: 7 }]);
    if (!shifted.pass) return shifted;
    return sameFingerprints(ctx, base, [{ kind: 'list', items, marker: '1)' }]);
  },
  'fp-quote-marker': async (ctx) => {
    const p = prose(ctx);
    const paragraphs = [`${p.next()} ${p.next()} ${p.next()}`];
    return sameFingerprints(
      ctx,
      [{ kind: 'quote', paragraphs, wrap: 30 }],
      [{ kind: 'quote', paragraphs, wrap: 70 }],
    );
  },
  'fp-pipe-padding': async (ctx) => {
    const p = prose(ctx);
    const header = ['alpha', 'beta', 'gamma'];
    const rows = [
      [p.next(), 'x', 'y'],
      ['z', p.next(), 'w'],
    ];
    return sameFingerprints(
      ctx,
      [{ kind: 'table', header, rows }],
      [{ kind: 'table', header, rows, pad: true }],
    );
  },
  'fp-crlf': async (ctx) => {
    const p = prose(ctx);
    const blocks: Block[] = [{ kind: 'heading', level: 1, text: 'Crates' }, para(p, 3, 44), listOf(p, 3)];
    return sameFingerprints(ctx, blocks, blocks, { eol: '\r\n' });
  },
  'fp-nfc': async (ctx) => {
    const p = prose(ctx);
    const base = p.many(4).map((s) => s.replace(/\b(\w)(\w*)\b/, 'Café $1$2'));
    const nfc = base.map((s) => s.normalize('NFC'));
    const nfd = base.map((s) => s.normalize('NFD'));
    return sameFingerprints(
      ctx,
      [{ kind: 'paragraph', sentences: nfc }],
      [{ kind: 'paragraph', sentences: nfd }],
    );
  },
  'fp-no-nfkc': async (ctx) => {
    const p = prose(ctx);
    const frame = (mid: string) => p.next().replace(/\b(\w+) (\w+)/, `$1 ${mid} $2`);
    // equal frames: the same sentence with two spellings of one word
    const base = p.next();
    const make = (mid: string) => base.replace(/ (\w+)/, ` ${mid} $1`);
    void frame;
    return allDifferent(ctx, [make('find'), make('ﬁnd'), make('A'), make('Ａ'), make('1'), make('①')]);
  },
  'fp-case': async (ctx) => {
    const base = prose(ctx).next();
    const ws = base.split(' ');
    const at = 3;
    const variant = (f: (w: string) => string) => ws.map((w, i) => (i === at ? f(w) : w)).join(' ');
    return allDifferent(ctx, [
      base,
      variant((w) => w.toUpperCase()),
      variant((w) => w.charAt(0).toUpperCase() + w.slice(1)),
    ]);
  },
  'fp-emphasis': async (ctx) => {
    const base = prose(ctx).next();
    const ws = base.split(' ');
    const wrap = (mark: string) => ws.map((w, i) => (i === 3 ? `${mark}${w}${mark}` : w)).join(' ');
    return allDifferent(ctx, [base, wrap('**'), wrap('*')]);
  },
  'fp-word-change': async (ctx) => {
    const p = prose(ctx);
    const texts: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const base = longSentence(p);
      texts.push(base);
      const ws = base.split(' ');
      texts.push(ws.map((w, k) => (k === 4 ? `${w}x` : w)).join(' '));
      texts.push(ws.map((w, k) => (k === 2 ? 'not' : w)).join(' '));
      texts.push(base.replace(/\.$/, ' 4.'));
    }
    return allDifferent(ctx, texts);
  },
  'fp-punctuation': async (ctx) => {
    const base = prose(ctx).next().replace(/\.$/, '');
    return allDifferent(ctx, [`${base}.`, `${base}!`, `${base}?`, `${base}...`]);
  },
  'fp-confusables': async (ctx) => {
    const base = prose(ctx).next();
    const swap = (from: string, to: string) => base.replace(from, to);
    const idx = base.search(/[aeo]/);
    const ch = base[idx] as string;
    const alt = ch === 'a' ? ['а', 'α'] : ch === 'e' ? ['е', 'ε'] : ['о', 'ο'];
    return allDifferent(ctx, [base, swap(ch, alt[0] as string), swap(ch, alt[1] as string)]);
  },
  'fp-context-neighbours': async (ctx) => {
    const p = prose(ctx);
    const mid = longSentence(p);
    const [a, b, c, d] = [longSentence(p), longSentence(p), longSentence(p), longSentence(p)];
    const r1 = await fresh(ctx, [
      {
        path: 'doc.md',
        text: compose([
          { kind: 'paragraph', sentences: [a] },
          { kind: 'paragraph', sentences: [mid] },
          { kind: 'paragraph', sentences: [b] },
        ]).text,
      },
    ]);
    const r2 = await fresh(ctx, [
      {
        path: 'doc.md',
        text: compose([
          { kind: 'paragraph', sentences: [c] },
          { kind: 'paragraph', sentences: [mid] },
          { kind: 'paragraph', sentences: [d] },
        ]).text,
      },
    ]);
    const e1 = ordered(r1.ledger)[1] as LedgerEntry;
    const e2 = ordered(r2.ledger)[1] as LedgerEntry;
    if (e1.fp !== e2.fp) return fail('the same text has two fingerprints');
    return e1.ctxFp !== e2.ctxFp
      ? pass('same fingerprint, different context fingerprint')
      : fail('different neighbours left the context fingerprint equal');
  },

  'id-format': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 5, perFile: 12 });
    const r = await fresh(ctx, build(filesOf(w)).files);
    const bad = liveOf(r.ledger).find((e) => !/^[0-9a-z]{10}$/.test(e.id));
    return bad
      ? fail(`the id ${JSON.stringify(bad.id)} is not ten lower-case base32 characters`)
      : pass(`${liveOf(r.ledger).length} ids well formed`);
  },
  'id-unique': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 6, perFile: 25 });
    const live = liveOf((await fresh(ctx, build(filesOf(w)).files)).ledger);
    return new Set(live.map((e) => e.id)).size === live.length
      ? pass(`${live.length} distinct ids`)
      : fail('two units share an id');
  },
  'id-duplicate-text-one-file': async (ctx) => {
    const p = prose(ctx);
    const dup = longSentence(p);
    const [a, b, c, d] = p.many(4);
    const doc = compose([
      para0([dup]),
      para0([a as string]),
      para0([dup]),
      para0([b as string]),
      para0([dup]),
      para0([c as string]),
      para0([dup]),
      para0([d as string]),
    ]);
    const live = liveOf((await fresh(ctx, [{ path: 'dup.md', text: doc.text }])).ledger).filter((e) =>
      e.quote.includes(dup.slice(0, 30)),
    );
    return live.length === 4 && new Set(live.map((e) => e.id)).size === 4
      ? pass('four distinct ids')
      : fail(
          `${live.length} entries, ${new Set(live.map((e) => e.id)).size} distinct ids for four equal units`,
        );
  },
  'id-duplicate-text-two-files': async (ctx) => {
    const p = prose(ctx);
    const dup = longSentence(p);
    const text = compose([para0([dup]), para0(p.many(2))]).text;
    const live = liveOf(
      (
        await fresh(ctx, [
          { path: 'a/one.md', text },
          { path: 'b/two.md', text },
        ])
      ).ledger,
    ).filter((e) => e.quote.includes(dup.slice(0, 30)));
    return live.length === 2 && live[0]?.id !== live[1]?.id
      ? pass('two distinct ids')
      : fail('two files holding one sentence share an id');
  },
  'id-twin-boilerplate': async (ctx) => {
    const p = prose(ctx);
    const shared = p.many(6).map((t) => para0([t]));
    const a = compose([...shared, para0(p.many(2))]);
    const b = compose([...shared, para0(p.many(2))]);
    const live = liveOf(
      (
        await fresh(ctx, [
          { path: 'one.md', text: a.text },
          { path: 'two.md', text: b.text },
        ])
      ).ledger,
    );
    if (live.some((entry) => entry.twinOf !== null && typeof entry.twinOf !== 'string'))
      return fail('the reader does not expose twinOf for every live unit');
    const copied = shared.map((blk) => (blk.kind === 'paragraph' ? blk.sentences[0] : '') as string);
    for (const text of copied) {
      const pair = live.filter((e) => e.quote.startsWith(text.slice(0, 30)));
      if (pair.length !== 2)
        return fail(`the copied unit ${JSON.stringify(text.slice(0, 30))} has ${pair.length} entries`);
      const twins = pair.filter((e) => e.twinOf !== null && e.twinOf !== undefined);
      if (twins.length !== 1)
        return fail(
          `the copied unit ${JSON.stringify(text.slice(0, 30))} has ${twins.length} twin marks, expected 1`,
        );
      const other = pair.find((e) => e.twinOf == null) as LedgerEntry;
      if (twins[0]?.twinOf !== other.id) return fail('the twin mark does not name the other copy');
    }
    const unique = live.filter((e) => !copied.some((t) => e.quote.startsWith(t.slice(0, 30))));
    return unique.some((e) => e.twinOf != null)
      ? fail('a unit that is not boilerplate has a twin mark')
      : pass('twin marks right');
  },
  'id-deterministic': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 4, perFile: 8 });
    const files = build(filesOf(w, { heading: true })).files;
    const raws = [];
    for (let i = 0; i < 3; i += 1) raws.push((await fresh(ctx, files)).ledger.raw);
    return raws[0] === raws[1] && raws[1] === raws[2]
      ? pass('three identical ledgers')
      : fail('three scans of one estate wrote different ledger bytes');
  },
  'id-clone-parent-folder': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 3, perFile: 8 });
    const files = build(filesOf(w)).files;
    const a = await fresh(ctx, files, { location: { parent: 'alpha-one', name: 'estate' } });
    const b = await fresh(ctx, files, { location: { parent: 'beta-two', name: 'estate' } });
    return a.ledger.raw === b.ledger.raw
      ? pass('equal')
      : fail('the ledger depends on the parent folder of the estate');
  },
  'id-file-order': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 5, perFile: 6 });
    const files = build(filesOf(w)).files;
    const rng = prose(ctx).random;
    const shuffled = [...files].sort(() => rng() - 0.5);
    const reversed = [...files].reverse();
    const raws = [files, shuffled, reversed].map(async (f) => (await fresh(ctx, f)).ledger.raw);
    const [x, y, z] = await Promise.all(raws);
    return x === y && y === z ? pass('equal') : fail('the order the files are given in changes the ledger');
  },
  'id-env-independent': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 3, perFile: 8 });
    const files = build(filesOf(w)).files;
    const runs: Array<{ env: Record<string, string>; cwdName: string }> = [
      { env: { TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }, cwdName: 'alpha' },
      { env: { TZ: 'Asia/Tokyo', LANG: 'ja_JP.UTF-8', LC_ALL: 'ja_JP.UTF-8' }, cwdName: 'beta' },
      { env: { TZ: 'America/Sao_Paulo', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }, cwdName: 'gamma' },
      { env: { TZ: 'Pacific/Auckland', LANG: 'de_DE.UTF-8', LC_ALL: 'C' }, cwdName: 'delta' },
    ];
    const seen: string[] = [];
    for (const r of runs) {
      const out = await runChild(
        { kind: 'scan', files, labeler: 'perfect' },
        { env: r.env, cwdName: r.cwdName },
      );
      try {
        if (!out.output?.ok)
          return fail(
            `a child scan failed: ${out.output && !out.output.ok ? out.output.error : out.stderr.slice(0, 200)}`,
          );
        const res = out.output.result as ScanResult;
        requireSourceWitness(res, files);
        if (!res.ok || !res.ledger) return fail(`a child scan failed: ${res.error ?? 'no ledger'}`);
        seen.push(res.ledger.raw);
      } finally {
        out.cleanup();
      }
    }
    return seen.every((x) => x === seen[0])
      ? pass(`${runs.length} environments, one ledger`)
      : fail('the ledger differs across time zones, locales or folders');
  },
  'id-persist-other-edit': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 40 });
    const v2 = cloneWorld(w);
    const at = 17;
    v2.texts[0]![at] = rewordOne(p, w.texts[0]?.[at] as string);
    const first = await fresh(ctx, build(filesOf(w)).files);
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler,
    });
    const before = new Map(liveOf(first.ledger).map((e) => [e.quote, e.id]));
    let same = 0;
    for (const e of liveOf(second.ledger)) if (before.get(e.quote) === e.id) same += 1;
    const total = liveOf(first.ledger).length;
    return same === total - 1
      ? pass(`${same} ids unchanged`)
      : fail(`${same} of ${total - 1} untouched ids survived the edit of one unit`);
  },
  'id-persist-insert-before': async (ctx) => {
    const p = prose(ctx);
    const dup = longSentence(p);
    const rest = p.many(3);
    const base = compose([
      para0([dup]),
      para0([rest[0] as string]),
      para0([dup]),
      para0([rest[1] as string]),
      para0([dup]),
      para0([rest[2] as string]),
    ]);
    const above = p.many(5).map((t) => para0([t]));
    const grown = compose([
      ...above,
      para0([dup]),
      para0([rest[0] as string]),
      para0([dup]),
      para0([rest[1] as string]),
      para0([dup]),
      para0([rest[2] as string]),
    ]);
    const first = await fresh(ctx, [{ path: 'd.md', text: base.text }]);
    const second = await scanOk(ctx.sut, {
      files: [{ path: 'd.md', text: grown.text }],
      previousLedger: first.ledger.raw,
      labeler,
    });
    const idsOf = (l: LedgerView) =>
      liveOf(l)
        .filter((e) => e.quote.startsWith(dup.slice(0, 30)))
        .map((e) => e.id)
        .sort();
    const a = idsOf(first.ledger);
    const b = idsOf(second.ledger);
    if (a.length !== 3 || JSON.stringify(a) !== JSON.stringify(b))
      return fail(`the three duplicates had ${JSON.stringify(a)} and now have ${JSON.stringify(b)}`);
    const old = new Set(first.ledger.entries.map((e) => e.id));
    const fresh5 = liveOf(second.ledger).filter((e) =>
      above.some(
        (blk) => blk.kind === 'paragraph' && e.quote.startsWith((blk.sentences[0] ?? '\u0000').slice(0, 30)),
      ),
    );
    return fresh5.length === 5 && fresh5.every((e) => !old.has(e.id))
      ? pass('duplicates kept, five fresh ids')
      : fail('the five inserted units do not all have fresh ids');
  },
  'id-persist-reword': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 12 });
    const v2 = cloneWorld(w);
    const target = w.texts[0]?.[5] as string;
    v2.texts[0]![5] = rewordOne(p, target);
    const first = await fresh(ctx, build(filesOf(w)).files);
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler,
    });
    const id = liveByText(first.ledger, target)?.id;
    const now = id ? byId(second.ledger, id) : undefined;
    return now &&
      now.status === 'live' &&
      norm(now.quote, now.container) === norm(v2.texts[0]?.[5] as string, now.container)
      ? pass('same id, new quote')
      : fail(`the id ${id} did not follow the reworded unit`);
  },
  'id-roundtrip-edit-restores': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 10 });
    const v2 = cloneWorld(w);
    const target = w.texts[0]?.[4] as string;
    v2.texts[0]![4] = rewordOne(p, target);
    const s1 = await fresh(ctx, build(filesOf(w)).files);
    const s2 = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: s1.ledger.raw,
      labeler,
    });
    const s3 = await scanOk(ctx.sut, {
      files: build(filesOf(w)).files,
      previousLedger: s2.ledger.raw,
      labeler,
    });
    const a = liveByText(s1.ledger, target)?.id;
    const c = liveByText(s3.ledger, target)?.id;
    return a !== undefined && a === c
      ? pass('same id after the round trip')
      : fail(`the unit had id ${a}, and has ${c} after an edit and its revert`);
  },
  'id-new-unit-fresh': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 30 });
    const v2 = cloneWorld(w);
    const added = distinctSentences(p, 3);
    v2.texts[0]?.splice(5, 0, added[0] as string);
    v2.texts[0]?.splice(14, 0, added[1] as string);
    v2.texts[0]?.push(added[2] as string);
    const first = await fresh(ctx, build(filesOf(w)).files);
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler,
    });
    const old = new Set(first.ledger.entries.map((e) => e.id));
    const news = added.map((t) => liveByText(second.ledger, t));
    if (news.some((e) => !e || old.has(e.id)))
      return fail('an inserted unit reuses an old id or has no entry');
    return new Set(liveOf(second.ledger).map((e) => e.id)).size === 34
      ? pass('three fresh ids')
      : fail('the 33 units do not have 33 distinct ids');
  },
  'id-not-display-number': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 30 });
    const v2 = cloneWorld(w);
    v2.texts[0]?.unshift(longSentence(p));
    const first = await fresh(ctx, build(filesOf(w)).files);
    const second = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler,
    });
    for (const text of w.texts[0] as string[]) {
      const a = liveByText(first.ledger, text)?.id;
      const b = liveByText(second.ledger, text)?.id;
      if (!a || a !== b)
        return fail(
          `${JSON.stringify(text.slice(0, 40))} had id ${a} and has ${b} after an insertion above it`,
        );
    }
    return pass('thirty ids kept');
  },
  'id-occurrence-delete-middle': async (ctx) => {
    const p = prose(ctx);
    const dup = longSentence(p);
    const [x, y] = p.many(2);
    const v1 = compose([
      para0([dup]),
      para0([x as string]),
      para0([dup]),
      para0([y as string]),
      para0([dup]),
    ]);
    const v2 = compose([para0([dup]), para0([x as string]), para0([dup]), para0([y as string])]);
    const first = await fresh(ctx, [{ path: 'd.md', text: v1.text }]);
    const second = await scanOk(ctx.sut, {
      files: [{ path: 'd.md', text: v2.text }],
      previousLedger: first.ledger.raw,
      labeler,
    });
    const pick = (l: LedgerView) => liveOf(l).filter((e) => e.quote.startsWith(dup.slice(0, 30)));
    const was = pick(first.ledger).sort((a, b) => (a.hint?.start ?? 0) - (b.hint?.start ?? 0));
    const now = pick(second.ledger);
    if (was.length !== 3 || now.length !== 2)
      return fail(`${was.length} duplicates became ${now.length}, expected 3 and 2`);
    const kept = now.map((e) => e.id);
    const first1 = was[0] as LedgerEntry;
    const fromOld = kept.filter((id) => was.some((e) => e.id === id));
    return fromOld.length === 2 && kept.includes(first1.id)
      ? pass('two ids kept, the first among them')
      : fail('the surviving duplicates do not keep old ids, or the first one lost its id');
  },
  'ledger-sorted-keys': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 2, perFile: 6 });
    const sets = `${DEFAULT_YAML}\n${SECOND_SET}`;
    const files = build(filesOf(w)).files;
    const result = await scanOk(ctx.sut, { files, labeler, labelsYaml: sets });
    requireSourceWitness(result, files);
    const raw = result.ledger.raw;
    const bad = unsortedPath(JSON.parse(raw), '$');
    return bad ? fail(`the keys of ${bad} are not sorted`) : pass('sorted at every depth');
  },
  'ledger-no-timestamps': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 2, perFile: 6 });
    const files = build(filesOf(w)).files;
    const a = (await fresh(ctx, files)).ledger.raw;
    await new Promise((r) => setTimeout(r, 1200));
    const b = (await fresh(ctx, files)).ledger.raw;
    if (a !== b) return fail('two scans 1.2 s apart wrote different ledgers');
    if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(a) || /\b1[5-9]\d{11}\b/.test(a))
      return fail('the ledger holds a date or an epoch time');
    return pass('no time in the ledger');
  },
  'ledger-rescan-idempotent': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 3, perFile: 8 });
    const files = build(filesOf(w)).files;
    const first = await fresh(ctx, files);
    const second = await scanOk(ctx.sut, { files, previousLedger: first.ledger.raw, labeler });
    return first.ledger.raw === second.ledger.raw
      ? pass('equal bytes')
      : fail('rescanning unchanged files rewrote the ledger');
  },
  'ledger-check-mode': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 2, perFile: 8 });
    const v2 = cloneWorld(w);
    v2.texts[0]![3] = rewordOne(p, w.texts[0]?.[3] as string);
    const first = await fresh(ctx, build(filesOf(w)).files);
    const stale = await ctx.sut.scan({
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler,
      check: true,
    });
    if (stale.ok) return fail('the check passed on a stale ledger');
    if (!(stale.error ?? '').includes(w.paths[0] as string))
      return fail(`the failure does not name the changed file: ${stale.error}`);
    const fine = await ctx.sut.scan({
      files: build(filesOf(w)).files,
      previousLedger: first.ledger.raw,
      labeler,
      check: true,
    });
    if (!fine.ok) return fail(`the check failed on a fresh ledger: ${fine.error}`);
    const updated = await scanOk(ctx.sut, {
      files: build(filesOf(v2)).files,
      previousLedger: first.ledger.raw,
      labeler,
    });
    const again = await ctx.sut.scan({
      files: build(filesOf(v2)).files,
      previousLedger: updated.ledger.raw,
      labeler,
      check: true,
    });
    return again.ok
      ? pass('stale fails, fresh passes')
      : fail(`the check failed after the update: ${again.error}`);
  },
  'ledger-estate-untouched': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 3, perFile: 6 });
    const files = build(filesOf(w)).files;
    const copy = files.map((f) => ({ ...f }));
    await fresh(ctx, files);
    const first = await fresh(ctx, files);
    await scanOk(ctx.sut, { files, previousLedger: first.ledger.raw, labeler });
    return JSON.stringify(files) === JSON.stringify(copy)
      ? pass('the files are as they were')
      : fail('the scan changed the text of an estate file');
  },
  'ledger-relative-paths': async (ctx) => {
    const p = prose(ctx);
    const paths = ['.claude/skills/shelf audit/SKILL.md', 'notes/é/données.md', 'a b/c d/e f.md'];
    const files = paths.map((path) => ({ path, text: compose([para0(p.many(2))]).text }));
    const live = liveOf((await fresh(ctx, files)).ledger);
    const got = new Set(live.map((e) => e.path));
    for (const path of paths)
      if (!got.has(path))
        return fail(
          `the path ${JSON.stringify(path)} is not in the ledger as written; the ledger has ${JSON.stringify([...got])}`,
        );
    return [...got].some((x) => x.startsWith('./') || x.startsWith('/') || x.includes('\\'))
      ? fail('a path is absolute or uses backslashes')
      : pass('relative POSIX paths');
  },
  'ledger-entry-fields': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 3, perFile: 10 });
    const built = build(filesOf(w));
    const first = await fresh(ctx, built.files);
    const raw = (JSON.parse(first.ledger.raw) as { entries: Array<Record<string, unknown>> }).entries;
    const need = [
      'id',
      'path',
      'sectionPath',
      'container',
      'fp',
      'ctxFp',
      'quote',
      'prefix',
      'suffix',
      'hint',
      'status',
      'labels',
      'lineage',
      'twinOf',
    ];
    for (const entry of raw.slice(0, 40)) {
      const missing = need.filter((k) => !(k in entry));
      if (missing.length) return fail(`an entry lacks ${missing.join(', ')}`);
    }
    for (const entry of raw.filter((e) => e.status === 'live')) {
      const source = built.files.find((f) => f.path === entry.path)?.text ?? '';
      const hint = entry.hint as { start: number; end: number };
      if (source.slice(hint.start, hint.end) !== entry.quote)
        return fail(`the hint of ${String(entry.id)} does not slice its quote`);
      if (!source.includes(`${String(entry.prefix)}${String(entry.quote)}${String(entry.suffix)}`))
        return fail(`prefix + quote + suffix of ${String(entry.id)} is not in the source`);
    }
    return pass(`${raw.length} entries carry the fields`);
  },
  'ledger-section-path': async (ctx) => {
    const p = prose(ctx);
    const h = (n: number) => `${headingText(p.random)} ${n}`;
    const [a, b, c] = [h(1), h(2), h(3)];
    const s = p.many(4);
    const doc = compose([
      { kind: 'heading', level: 1, text: a },
      para0([s[0] as string]),
      { kind: 'heading', level: 2, text: b },
      para0([s[1] as string]),
      { kind: 'heading', level: 3, text: c },
      para0([s[2] as string]),
      { kind: 'heading', level: 2, text: h(4) },
      para0([s[3] as string]),
    ]);
    const live = liveOf((await fresh(ctx, [{ path: 'x.md', text: doc.text }])).ledger);
    const want: Array<[string, string[]]> = [
      [s[0] as string, [a]],
      [s[1] as string, [a, b]],
      [s[2] as string, [a, b, c]],
    ];
    for (const [text, path] of want) {
      const e = live.find((x) => x.quote === text);
      if (!e || JSON.stringify(e.sectionPath) !== JSON.stringify(path))
        return fail(
          `the sectionPath of ${JSON.stringify(text.slice(0, 30))} is ${JSON.stringify(e?.sectionPath)}, expected ${JSON.stringify(path)}`,
        );
    }
    return pass('section paths right');
  },
  'ledger-labels-per-set': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 1, perFile: 8 });
    const sets = `${DEFAULT_YAML}\n${SECOND_SET}`;
    const r = await scanOk(ctx.sut, { files: build(filesOf(w)).files, labeler, labelsYaml: sets });
    const live = liveOf(r.ledger);
    const hashes = new Map<string, Set<string>>();
    for (const e of live) {
      const names = Object.keys(e.labels).sort();
      if (names.length !== 2)
        return fail(`an entry holds labels for ${JSON.stringify(names)}, expected two sets`);
      for (const [name, l] of Object.entries(e.labels)) {
        if (typeof l.label !== 'string' || typeof l.source !== 'string' || typeof l.setHash !== 'string')
          return fail(`the label of set ${name} lacks label, source or setHash`);
        const hs = hashes.get(name) ?? new Set<string>();
        hs.add(l.setHash);
        hashes.set(name, hs);
      }
    }
    const [a, b] = [...hashes.values()];
    if (hashes.size !== 2 || a?.size !== 1 || b?.size !== 1)
      return fail('a set has more than one hash, or the sets are not two');
    return [...(a as Set<string>)][0] !== [...(b as Set<string>)][0]
      ? pass('one hash per set, different between sets')
      : fail('two sets share one hash');
  },
  'ledger-status-live': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 2, perFile: 10 });
    const r = await fresh(ctx, build(filesOf(w)).files);
    const raw = (JSON.parse(r.ledger.raw) as { entries: Array<{ status: string; lineage?: unknown }> })
      .entries;
    if (raw.length === 0 || raw.length !== r.ledger.entries.length)
      return fail('the raw ledger does not contain every observed live unit');
    if (raw.some((e) => e.status !== 'live')) return fail('an entry of a fresh scan is not live');
    return raw.every((e) => Array.isArray(e.lineage) && e.lineage.length > 0)
      ? pass('all live with a lineage')
      : fail('an entry has no lineage item');
  },
  'ledger-safe-set-names': async (ctx) => {
    const w = worldOf(prose(ctx), { files: 1, perFile: 6 });
    const yaml = ['__proto__', 'constructor', 'hasOwnProperty']
      .map(
        (name) =>
          `  - set: ${name}\n    description: A set named like an object property.\n    labels:\n      - name: rule\n        description: A unit that tells the reader what to do.\n        atom: { kind: instruction, polarity: obligation }`,
      )
      .join('\n');
    const r = await scanOk(ctx.sut, {
      files: build(filesOf(w)).files,
      labeler,
      labelsYaml: `labels:\n${yaml}\n`,
    });
    const parsed = JSON.parse(r.ledger.raw) as {
      entries: Array<{ labels: Record<string, { label: string }> }>;
    };
    const e = parsed.entries[0];
    for (const name of ['__proto__', 'constructor', 'hasOwnProperty']) {
      if (!e || !Object.hasOwn(e.labels, name))
        return fail(`the label of the set ${name} is not stored under its own name`);
    }
    return ({} as Record<string, unknown>).polluted === undefined &&
      Object.keys(Object.prototype).length === 0
      ? pass('stored, no pollution')
      : fail('Object.prototype was changed');
  },
};

const DEFAULT_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.`;
const SECOND_SET = `  - set: house-voice
    description: How a style guide for a bakery's customer emails is written.
    labels:
      - name: voice-rule
        description: A unit that fixes a tone or a word choice for customer emails.
      - name: legal-line
        description: A unit that must appear word for word in a message.`;

function para0(sentences: string[]): Block {
  return { kind: 'paragraph', sentences };
}

function rewordOne(p: Prose, text: string): string {
  return rewordWords(p.random, text, 1);
}

function unsortedPath(value: unknown, at: string): string | undefined {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const bad = unsortedPath(v, `${at}[${i}]`);
      if (bad) return bad;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (JSON.stringify(keys) !== JSON.stringify([...keys].sort())) return at;
    for (const k of keys) {
      const bad = unsortedPath((value as Record<string, unknown>)[k], `${at}.${k}`);
      if (bad) return bad;
    }
  }
  return undefined;
}
