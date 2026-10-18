import { anchorCase } from '../../kit/anchor-case';
import { cloneWorld, distinctSentences, filesOf, longSentence, worldOf } from '../../kit/anchor-world';
import { runChild } from '../../kit/child-run';
import { type Block, compose } from '../../kit/compose';
import { cutCase } from '../../kit/cut-case';
import { build, byId, eventNow, liveOf, scanOk } from '../../kit/estate';
import { perfect, recording } from '../../kit/labellers';
import { rewordSim } from '../../kit/segments';
import { keyOf, labelByText, type Pick, RULES_YAML } from '../../kit/sets';
import { headingText, longMake, Prose, rewordWords, shortRule } from '../../kit/words';
import type { CutResult, SourceFile } from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const para = (t: string): Block => ({ kind: 'paragraph', sentences: [t] });
const DEONTIC = ['must', 'never', 'always', 'shall', 'should', 'required', 'forbidden'];

/** Scans blocks with a labeller that names units by text; the atoms must be exactly the units labelled rule or prohibition. */
async function decoy(
  ctx: ItemContext,
  blocks: Block[],
  picks: Pick[],
  rest: string | undefined = 'none',
): Promise<Outcome> {
  const doc = compose(blocks);
  const labeler = recording(labelByText(picks, rest));
  const res = await scanOk(ctx.sut, {
    files: [{ path: 'doc.md', text: doc.text }],
    labeler,
    labelsYaml: RULES_YAML,
  });
  const want = new Set(
    picks.filter((p) => ['rule', 'prohibition'].includes(p.label)).map((p) => keyOf(p.text)),
  );
  const got = new Set(res.atoms.map((a) => keyOf(a.quote)));
  if (res.atoms.length !== want.size) return fail(`${res.atoms.length} atoms, the truth has ${want.size}`);
  for (const w of want) if (!got.has(w)) return fail(`no atom for a planted rule: ${w.slice(0, 50)}`);
  for (const g of got)
    if (!want.has(g)) return fail(`an atom for a unit the labeller did not call a rule: ${g.slice(0, 50)}`);
  return pass(`${want.size} atoms, exactly the planted ones`);
}

const rules = (texts: string[], label = 'rule'): Pick[] => texts.map((text) => ({ text, label }));

/** A child cut that must finish: returns the cut or the clear failure message. */
async function childCut(
  file: SourceFile,
  timeoutMs = 60_000,
): Promise<{ cut?: CutResult; error?: string; ms: number; crashed: boolean }> {
  const c = await runChild({ kind: 'cut', file }, { timeoutMs });
  try {
    if (c.timedOut) return { ms: c.ms, crashed: true, error: `no result within ${timeoutMs / 1000} s` };
    const o = c.output;
    if (!o)
      return {
        ms: c.ms,
        crashed: true,
        error: `the child died: ${c.stderr.slice(0, 160).replace(/\s+/g, ' ')}`,
      };
    if (!o.ok) return { ms: c.ms, crashed: /not reachable/.test(o.error), error: o.error };
    return { cut: o.result as CutResult, ms: c.ms, crashed: false };
  } finally {
    c.cleanup();
  }
}

const clearMessage = (m: string) => /depth|nest|deep|too (large|big|long)|limit|exceed/i.test(m);

export const adversarialRuns: Record<string, Run> = {
  'deontic-words-labelled-none': async (ctx) => {
    const p = prose(ctx);
    const narrative = Array.from(
      { length: 30 },
      (_, i) =>
        `${p.next().replace(/\.$/, '')}, which everyone ${DEONTIC[i % DEONTIC.length]} remember daily.`,
    );
    const plain = p.many(10);
    return decoy(ctx, [...narrative, ...plain].map(para), [...rules(narrative, 'none'), ...rules(plain)]);
  },
  'rule-without-deontic-words': async (ctx) => {
    const t = distinctSentences(prose(ctx), 20);
    return decoy(ctx, t.map(para), rules(t));
  },
  'rules-in-other-languages': async (ctx) => {
    const p = prose(ctx);
    const foreign = [
      'Comptez la caisse deux fois avant la fermeture du magasin.',
      'Die Schlüssel werden jeden Abend an das Brett zurückgehängt.',
      '閉店の前にレジを二回数えること。',
      'يجب إغلاق النوافذ قبل مغادرة المخبز في المساء.',
      'Funguo zote hurudishwa kwenye ubao kila jioni baada ya kazi.',
      'Перед закрытием магазина нужно дважды пересчитать кассу.',
    ];
    const english = p.many(6);
    return decoy(ctx, [...english, ...foreign].map(para), [...rules(english, 'none'), ...rules(foreign)]);
  },
  'heading-decoy': async (ctx) => {
    const p = prose(ctx);
    const desc = p.many(5);
    const notes = p.many(5);
    return decoy(
      ctx,
      [
        { kind: 'heading', level: 2, text: 'Rules' },
        ...desc.map(para),
        { kind: 'heading', level: 2, text: 'Notes' },
        ...notes.map(para),
      ],
      [...rules(desc, 'description'), ...rules(notes)],
      'none',
    );
  },
  'length-decoy': async (ctx) => {
    const p = prose(ctx);
    const long = p.many(8, longMake);
    const short = p.many(8, shortRule);
    return decoy(ctx, [...long, ...short].map(para), [...rules(long, 'none'), ...rules(short)]);
  },
  'bullet-decoy': async (ctx) => {
    const p = prose(ctx);
    const items = p.many(6);
    const plain = p.many(6);
    return decoy(
      ctx,
      [{ kind: 'list', items: items.map((text) => ({ text })) }, ...plain.map(para)],
      [...rules(items, 'none'), ...rules(plain)],
    );
  },
  'bold-decoy': async (ctx) => {
    const p = prose(ctx);
    const bold = p.many(6).map((t) => `**${t.split(' ').slice(0, 2).join(' ')}**`);
    const boldFull = bold.map((b, _i) =>
      `${b} ${p.next().replace(/^./, (c) => c.toLowerCase())}`.replace(
        /^(\*\*[^*]+\*\*) (.)/,
        (_m, a, c) => `${a} ${c.toUpperCase()}`,
      ),
    );
    const plain = p.many(6);
    // a bold lead is cut as its own unit: the bold units are the leads
    const blocks: Block[] = [
      ...boldFull.map(
        (t) =>
          ({
            kind: 'paragraph',
            sentences: [bold[boldFull.indexOf(t)] as string, t.replace(/^\*\*[^*]+\*\*\s*/, '')],
          }) as Block,
      ),
      ...plain.map(para),
    ];
    const picks: Pick[] = [...bold.map((text) => ({ text, label: 'none' })), ...rules(plain)];
    const noneTexts = boldFull.map((t) => t.replace(/^\*\*[^*]+\*\*\s*/, ''));
    return decoy(ctx, blocks, [...picks, ...rules(noneTexts, 'none')]);
  },
  'position-decoy': async (ctx) => {
    const p = prose(ctx);
    const groups = Array.from({ length: 6 }, () => p.many(3));
    return decoy(
      ctx,
      groups.map((g): Block => ({ kind: 'paragraph', sentences: g })),
      groups.flatMap((g) => [
        { text: g[0] as string, label: 'none' },
        { text: g[1] as string, label: 'none' },
        { text: g[2] as string, label: 'rule' },
      ]),
    );
  },
  'quoted-instruction-decoy': async (ctx) => {
    const p = prose(ctx);
    const quoted = p.many(5, shortRule).map((t) => `Never ${t.charAt(0).toLowerCase()}${t.slice(1)}`);
    const plain = p.many(5);
    return decoy(
      ctx,
      [...quoted.map((q): Block => ({ kind: 'quote', paragraphs: [q] })), ...plain.map(para)],
      [...rules(quoted, 'none'), ...rules(plain)],
    );
  },
  'example-imperatives': async (ctx) => {
    const p = prose(ctx);
    const imperatives = p.many(8, shortRule);
    const plain = p.many(4);
    const res = await decoy(ctx, [...imperatives, ...plain].map(para), [
      ...rules(imperatives, 'example'),
      ...rules(plain),
    ]);
    return res;
  },
  'rules-inside-fences-and-comments': async (ctx) => {
    const p = prose(ctx);
    const outside = p.many(6);
    const hidden = p.many(3);
    const blocks: Block[] = [
      para(outside[0] as string),
      para(outside[1] as string),
      { kind: 'fence', lines: hidden.slice(0, 2), info: 'text' },
      para(outside[2] as string),
      { kind: 'comment', lines: [hidden[2] as string] },
      ...outside.slice(3).map(para),
    ];
    const doc = compose(blocks);
    const labeler = recording(labelByText(rules(outside), 'none'));
    const res = await scanOk(ctx.sut, {
      files: [{ path: 'doc.md', text: doc.text }],
      labeler,
      labelsYaml: RULES_YAML,
    });
    const offered = labeler.calls
      .flatMap((c) => c.window.units.filter((u) => u.mode === 'label').map((u) => u.text))
      .join('\n');
    for (const h of hidden)
      if (offered.includes(h.slice(0, 30)))
        return fail('text inside a fence or comment was offered as a labelable unit');
    return res.atoms.length === outside.length
      ? pass('atoms exactly the outside rules')
      : fail(`${res.atoms.length} atoms, expected ${outside.length}`);
  },
  'mixed-decoys-100': async (ctx) => {
    const p = prose(ctx);
    const blocks: Block[] = [];
    const picks: Pick[] = [];
    for (let i = 0; i < 100; i += 1) {
      const kind = i % 5;
      if (kind === 0) {
        const t = `${p.next().replace(/\.$/, '')}, which everyone ${DEONTIC[i % 7]} remember daily.`;
        blocks.push(para(t));
        picks.push({ text: t, label: 'none' });
      } else if (kind === 1) {
        const t = p.next(longMake);
        blocks.push(para(t));
        picks.push({ text: t, label: 'none' });
      } else if (kind === 2) {
        const t = p.next(shortRule);
        blocks.push(para(t));
        picks.push({ text: t, label: 'rule' });
      } else if (kind === 3) {
        const t = p.next();
        blocks.push({ kind: 'list', items: [{ text: t }] });
        picks.push({ text: t, label: i % 10 === 3 ? 'prohibition' : 'none' });
      } else {
        const t = p.next();
        blocks.push({ kind: 'quote', paragraphs: [t] });
        picks.push({ text: t, label: 'example' });
      }
    }
    return decoy(ctx, blocks, picks);
  },
  'yaml-alias-bomb': async (ctx) => {
    const sentenceText = prose(ctx).next();
    let yaml = 'a0: &a0 [lol, lol, lol, lol, lol, lol, lol, lol, lol, lol]\n';
    for (let i = 1; i < 9; i += 1)
      yaml += `a${i}: &a${i} [${Array.from({ length: 10 }, () => `*a${i - 1}`).join(', ')}]\n`;
    const text = `---\n${yaml}description: Checks the stock.\n---\n\n${sentenceText}\n`;
    const r = await childCut({ path: 'bomb.md', text }, 30_000);
    if (r.crashed) return fail(`the cut did not survive an alias bomb: ${r.error}`);
    if (r.ms > 15_000) return fail(`the cut took ${Math.round(r.ms)} ms`);
    if (r.error)
      return clearMessage(r.error) || /alias|yaml/i.test(r.error)
        ? pass(`refused with a clear message: ${r.error.slice(0, 80)}`)
        : fail(`the failure message is unclear: ${r.error}`);
    return r.cut?.units.some((u) => u.text === sentenceText)
      ? pass('bounded, the sentence is still a unit')
      : fail('the sentence after the alias bomb is not a unit');
  },
  'yaml-custom-tags': async (ctx) => {
    const sentenceText = prose(ctx).next();
    const text = `---\nname: !!js/function "function () { require('fs').writeFileSync('CANARY-js', 'x') }"\nrun: !!python/object/apply:os.system ["touch CANARY-py"]\nbin: !!binary aGVsbG8=\ndescription: Checks the shelf.\n---\n\n${sentenceText}\n`;
    const c = await runChild({ kind: 'cut', file: { path: 'tags.md', text } }, { timeoutMs: 30_000 });
    try {
      const o = c.output;
      if (c.written.some((w) => /CANARY/.test(w))) return fail('a YAML tag ran code: a canary file appeared');
      if (!o) return fail(`the child gave no output: ${c.stderr.slice(0, 160)}`);
      if (!o.ok)
        return /not reachable/.test(o.error) ? fail(o.error) : pass(`refused: ${o.error.slice(0, 80)}`);
      const cut = o.result as CutResult;
      return cut.units.some((u) => u.text === 'Checks the shelf.') &&
        cut.units.some((u) => u.text === sentenceText)
        ? pass('plain values still units, no code run')
        : fail('the plain values are not units');
    } finally {
      c.cleanup();
    }
  },
  'deep-nested-lists': async (ctx) => {
    const lines = Array.from(
      { length: 600 },
      (_, i) => `${'  '.repeat(i)}- level ${i} ${prose(ctx).random().toString(36).slice(2, 6)}`,
    );
    const r = await childCut({ path: 'deep.md', text: `${lines.join('\n')}\n` }, 60_000);
    if (r.crashed) return fail(`the cut did not survive 600 nested list levels: ${r.error}`);
    if (r.ms > 15_000) return fail(`the cut took ${Math.round(r.ms)} ms`);
    if (r.error)
      return clearMessage(r.error)
        ? pass(`refused with a clear message: ${r.error.slice(0, 80)}`)
        : fail(`the failure message does not say why: ${r.error}`);
    return r.cut?.units.length === 600
      ? pass('600 list item units')
      : fail(`${r.cut?.units.length} units for 600 levels`);
  },
  'deep-nested-quotes': async (ctx) => {
    const p = prose(ctx);
    const control = await cutCase(ctx, [para(p.next())]);
    if (!control.pass) return fail(`positive witness: ${control.detail}`);
    const inner = p.next();
    const text = `${'> '.repeat(1000)}${inner}\n`;
    const r = await childCut({ path: 'deepq.md', text }, 60_000);
    if (r.crashed) return fail(`the cut did not survive 1000 nested quote levels: ${r.error}`);
    if (r.error)
      return clearMessage(r.error)
        ? pass(`refused with a clear message: ${r.error.slice(0, 80)}`)
        : fail(`the failure message does not say why: ${r.error}`);
    if (!r.cut?.units.some((u) => u.text === text.slice(u.start, u.end) && u.text.includes(inner)))
      return fail('positive witness: a successful deep cut must return the quoted source text');
    return r.cut && r.cut.units.length >= 1
      ? pass('a quote unit')
      : fail('no unit for a deeply quoted paragraph');
  },
  'binary-and-invalid-utf8': async (ctx) => {
    const p = prose(ctx);
    const good = ['a.md', 'b.md', 'c.md'].map((path) => ({
      path,
      text: compose([para(p.next()), para(p.next())]).text,
    }));
    const bad = { path: 'bad.bin.md', text: `\u0000\u0001��${p.next()}\u0000\n\n�tail\u0000�` };
    const res = await ctx.sut.scan({ files: [...good, bad], labeler: perfect() });
    if (!res.ok || !res.ledger) return fail(`one bad file stopped the scan: ${res.error}`);
    for (const f of good) {
      const n = liveOf(res.ledger).filter((e) => e.path === f.path).length;
      if (n !== 2) return fail(`${f.path} has ${n} entries, expected 2`);
    }
    for (const e of liveOf(res.ledger).filter((x) => x.path === bad.path)) {
      if (e.hint && bad.text.slice(e.hint.start, e.hint.end) !== e.quote)
        return fail('an entry of the bad file does not slice its quote');
    }
    return pass('good files exact, bad file skipped or consistent');
  },
  'bom-in-middle': async (ctx) => {
    const p = prose(ctx);
    const a = p.next().replace(/ (\w+) /, ' $1\uFEFF ');
    const b = p.next().replace(/(\w{4})(\w{3})/, '$1\uFEFF$2');
    return cutCase(
      ctx,
      [
        { kind: 'paragraph', sentences: [a] },
        { kind: 'paragraph', sentences: [b] },
      ],
      {},
      {},
      (_d, got) =>
        got.units.some((u) => u.text.includes('\uFEFF'))
          ? undefined
          : 'the mark inside the text was stripped',
    );
  },
  'many-empty-headings': async (ctx) => {
    const p = prose(ctx);
    const sentenceText = p.next();
    const doc = compose([
      { kind: 'raw', text: `${'#\n'.repeat(5000)}\n`, structure: true },
      para(sentenceText),
    ]);
    const started = performance.now();
    const got = await ctx.sut.cut({ path: 'empty.md', text: doc.text });
    const ms = performance.now() - started;
    if (ms > 5000) return fail(`the cut took ${Math.round(ms)} ms`);
    if (got.units.some((u) => u.path.includes(''))) return fail('a heading path holds an empty string');
    const hit = got.units.find((u) => u.text === sentenceText);
    return hit
      ? pass(`${got.units.length} units, the sentence cut exactly`)
      : fail('the sentence after the empty headings is not a unit');
  },
  'zero-width-and-bidi': async (ctx) => {
    const p = prose(ctx);
    const marks = ['​', '‍', '‎', '‮'];
    const make = (m: string) => p.next().replace(/(\w{3})(\w{3})/, `$1${m}$2`);
    return cutCase(ctx, [{ kind: 'paragraph', sentences: marks.map(make) }]);
  },
  'emoji-zwj-sequences': async (ctx) => {
    const p = prose(ctx);
    const seq = ['👨‍👩‍👧‍👦', '🏳️‍🌈', '🇧🇪', '👩🏽‍🍳'];
    const make = (e: string) =>
      p
        .next()
        .replace(/ (\w+) (\w+)/, ` $1 ${e} $2`)
        .replace(/\.$/, ` ${e}.`);
    return cutCase(ctx, [{ kind: 'paragraph', sentences: seq.map(make) }]);
  },
  'huge-heading-text': async (ctx) => {
    const p = prose(ctx);
    const blocks: Block[] = [];
    for (let level = 1; level <= 6; level += 1)
      blocks.push({
        kind: 'heading',
        level,
        text: `${headingText(p.random)} ${'long '.repeat(2000)}end${level}`,
      });
    blocks.push(para(p.next()));
    return cutCase(ctx, blocks, {}, {}, (_d, got) => {
      const last = got.units[got.units.length - 1];
      return last && last.path.length === 6
        ? undefined
        : `the sentence has a heading path of ${last?.path.length} entries, expected 6`;
    });
  },
  'identical-files-100': async (ctx) => {
    const p = prose(ctx);
    const text = compose([{ kind: 'heading', level: 1, text: 'Same notes' }, ...p.many(7).map(para)]).text;
    const files = Array.from({ length: 100 }, (_, i) => ({
      path: `copy/${String(i).padStart(3, '0')}.md`,
      text,
    }));
    const first = await scanOk(ctx.sut, { files, labeler: perfect() });
    const live = liveOf(first.ledger);
    if (live.length !== 800 || new Set(live.map((e) => e.id)).size !== 800)
      return fail(
        `${live.length} entries, ${new Set(live.map((e) => e.id)).size} distinct ids, expected 800 and 800`,
      );
    if (live.some((entry) => entry.twinOf !== null && typeof entry.twinOf !== 'string'))
      return fail('the reader does not expose twinOf for every live unit');
    const twins = live.filter((e) => e.twinOf !== null && e.twinOf !== undefined).length;
    if (twins < 792) return fail(`${twins} twin marks, expected at least 792 (every copy but the first)`);
    const again = await scanOk(ctx.sut, { files, previousLedger: first.ledger.raw, labeler: perfect() });
    return again.ledger.raw === first.ledger.raw
      ? pass('800 distinct ids, twins marked, stable')
      : fail('a rescan of identical files changed the ledger');
  },
  'huge-single-line': async (ctx) => {
    void ctx;
    const c = await runChild(
      { kind: 'scale', op: 'long-paragraph', sentences: 6000 },
      { timeoutMs: 120_000 },
    );
    try {
      const o = c.output;
      if (!o?.ok) return fail(`the child failed: ${o && !o.ok ? o.error : c.stderr.slice(0, 160)}`);
      const r = o.result as { units: number; ms: number[]; extra: { expected: number } };
      if (r.units !== r.extra.expected) return fail(`${r.units} units for ${r.extra.expected} sentences`);
      return (r.ms[0] ?? 0) > 10_000
        ? fail(`the cut took ${Math.round(r.ms[0] ?? 0)} ms`)
        : pass(`${Math.round(r.ms[0] ?? 0)} ms`);
    } finally {
      c.cleanup();
    }
  },
  'giant-front-matter': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const entries = Array.from(
      { length: 5000 },
      (_, i) => `key${i}: ${r().toString(36).slice(2, 9)} value ${i}`,
    );
    const text = `---\n${entries.join('\n')}\n---\n\n${p.next()}\n`;
    const c = await childCut({ path: 'front.md', text }, 60_000);
    if (c.crashed) return fail(`the cut did not survive 5000 front matter keys: ${c.error}`);
    if (c.error) return fail(`the cut failed: ${c.error}`);
    const fm = (c.cut?.units ?? []).filter((u) => u.container === 'front_matter');
    if (fm.length !== 5000) return fail(`${fm.length} front matter units, expected 5000`);
    if (new Set(fm.map((u) => (u.yamlPath ?? []).join('.'))).size !== 5000)
      return fail('the front matter paths are not distinct');
    return c.ms > 15_000 ? fail(`the cut took ${Math.round(c.ms)} ms`) : pass('5000 units');
  },
  'swap-texts-in-place': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 30 });
    const v2 = cloneWorld(w);
    const a = w.texts[0]?.[8] as string;
    const b = w.texts[0]?.[18] as string;
    v2.texts[0]![8] = b;
    v2.texts[0]![18] = a;
    const fate = { kind: 'moved' as const, events: ['moved', 'unchanged'] };
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [
        { text: a, fate },
        { text: b, fate },
      ],
    });
  },
  'swap-with-similar-neighbour': async (ctx) => {
    const p = prose(ctx);
    const w = worldOf(p, { files: 1, perFile: 30 });
    const a = w.texts[0]?.[10] as string;
    let b = '';
    for (let i = 0; i < 400 && !b; i += 1) {
      const c = rewordSim(p.random, a, 0.68, 0.82);
      if (!w.texts[0]?.includes(c)) b = c;
    }
    if (!b) return fail('the item could not build a near-duplicate');
    w.texts[0]![11] = b;
    const v2 = cloneWorld(w);
    v2.texts[0]![10] = b;
    v2.texts[0]![11] = a;
    const fate = { kind: 'moved' as const, events: ['moved', 'unchanged'] };
    return anchorCase(ctx, {
      before: filesOf(w),
      after: filesOf(v2),
      fates: [
        { text: a, fate },
        { text: b, fate },
      ],
    });
  },
  'edit-inside-duplicates': async (ctx) => {
    const p = prose(ctx);
    const dup = longSentence(p);
    const [x, y, z, q] = distinctSentences(p, 4);
    const mk = (mid: string) => [
      para(x as string),
      para(dup),
      para(y as string),
      para(mid),
      para(z as string),
      para(dup),
      para(q as string),
    ];
    const dup2 = rewordWords(p.random, dup, 1);
    const first = await scanOk(ctx.sut, {
      files: build([{ path: 'd.md', blocks: [para(dup), ...mk(dup)] }]).files,
      labeler: perfect(),
    });
    const second = await scanOk(ctx.sut, {
      files: build([{ path: 'd.md', blocks: [para(dup), ...mk(dup2)] }]).files,
      previousLedger: first.ledger.raw,
      labeler: perfect(),
    });
    const was = liveOf(first.ledger)
      .filter((e) => keyOf(e.quote) === keyOf(dup))
      .sort((a, b) => (a.hint?.start ?? 0) - (b.hint?.start ?? 0));
    if (was.length !== 4) return fail(`the first scan has ${was.length} copies, expected 4`);
    const middle = was[2]!;
    for (const [i, e] of was.entries()) {
      const now = byId(second.ledger, e.id);
      if (now?.status !== 'live') return fail(`copy ${i + 1} is ${now?.status ?? 'gone'}`);
      if (i === 2) {
        if (keyOf(now.quote) !== keyOf(dup2) || eventNow(second, now) !== 'changed')
          return fail(`the edited copy did not follow as changed (event ${eventNow(second, now)})`);
      } else if (keyOf(now.quote) !== keyOf(dup) || eventNow(second, now) !== 'unchanged')
        return fail(`untouched copy ${i + 1} is ${eventNow(second, now)} with ${now.quote.slice(0, 30)}`);
    }
    void middle;
    return pass('the edited copy changed, the other three unchanged');
  },
  'hostile-file-names': async (ctx) => {
    const p = prose(ctx);
    const paths = ['__proto__.md', 'constructor.md', 'toString.md', 'a b.md', 'é.md'];
    const files = paths.map((path) => ({ path, text: compose([para(p.next())]).text }));
    const res = await scanOk(ctx.sut, { files, labeler: perfect() });
    const got = new Set(liveOf(res.ledger).map((e) => e.path));
    for (const path of paths) if (!got.has(path)) return fail(`the path ${path} is missing from the ledger`);
    return Object.keys(Object.prototype).length === 0 &&
      ({} as Record<string, unknown>).polluted === undefined
      ? pass('five paths, no pollution')
      : fail('Object.prototype was changed');
  },
  'label-named-like-prototype': async (ctx) => {
    const t = distinctSentences(prose(ctx), 12);
    const yaml = `labels:
  - set: odd
    description: Labels named like object properties.
    labels:
      - name: constructor
        description: A unit labelled constructor.
        atom: { kind: instruction, polarity: obligation }
      - name: tostring
        description: A unit labelled tostring.
      - name: hasownproperty
        description: A unit labelled hasownproperty.
`;
    const res = await scanOk(ctx.sut, {
      files: [{ path: 'doc.md', text: compose(t.map(para)).text }],
      labeler: perfect(),
      labelsYaml: yaml,
    });
    if (
      liveOf(res.ledger).length !== t.length ||
      !t.every((text) => liveOf(res.ledger).some((entry) => entry.quote === text))
    )
      return fail('positive witness: missing planted units with prototype-like labels');
    const names = new Set(['constructor', 'tostring', 'hasownproperty']);
    const labelled = liveOf(res.ledger).map((e) => e.labels.odd?.label);
    if (labelled.some((l) => !l || !names.has(l)))
      return fail(`a label is outside the set: ${JSON.stringify([...new Set(labelled)])}`);
    const want = liveOf(res.ledger).filter((e) => e.labels.odd?.label === 'constructor').length;
    if (res.atoms.length !== want)
      return fail(`${res.atoms.length} atoms for ${want} units labelled constructor`);
    return Object.keys(Object.prototype).length === 0
      ? pass('stored under their own names')
      : fail('Object.prototype was changed');
  },
};
