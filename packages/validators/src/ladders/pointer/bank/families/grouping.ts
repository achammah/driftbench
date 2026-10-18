import { distinctSentences } from '../../kit/anchor-world';
import { type Block, type Composed, compose, lineOf } from '../../kit/compose';
import { liveByText, liveOf, scanOk } from '../../kit/estate';
import { perfect, truthLabel } from '../../kit/labellers';
import { norm, squash } from '../../kit/norm';
import { show } from '../../kit/oracle';
import { labelByText, type Pick, RULES_YAML } from '../../kit/sets';
import { headingText, Prose, rewordWords } from '../../kit/words';
import type { Atom, Labeler } from '../../sut/port';
import { fail, type ItemContext, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const P = (sentences: string[], wrap?: number): Block => ({
  kind: 'paragraph',
  sentences,
  ...(wrap ? { wrap } : {}),
});

async function scanDoc(ctx: ItemContext, blocks: Block[], labeler: Labeler, yaml: string = RULES_YAML) {
  const doc = compose(blocks);
  const res = await scanOk(ctx.sut, {
    files: [{ path: 'doc.md', text: doc.text }],
    labeler,
    labelsYaml: yaml,
  });
  return { doc, res };
}

const _sliceOf = (doc: Composed, text: string): { start: number; end: number } | undefined => {
  const u = doc.units.find((x) => squash(x.text) === squash(text));
  return u ? { start: u.start, end: u.end } : undefined;
};

/** Checks that an atom's quote is the source slice at its lines. */
function atomProblem(doc: Composed, atom: Atom): string | undefined {
  if (!doc.text.includes(atom.quote)) return `the atom quote ${show(atom.quote)} is not in the source`;
  const at = doc.text.indexOf(atom.quote);
  if (lineOf(doc.text, at) !== atom.startLine)
    return `the atom starts on line ${atom.startLine}, its quote starts on line ${lineOf(doc.text, at)}`;
  const last = lineOf(doc.text, at + Math.max(atom.quote.length - 1, 0));
  if (last !== atom.endLine) return `the atom ends on line ${atom.endLine}, its quote ends on line ${last}`;
  return undefined;
}

/** The quote is the source text of the unit: inside the construct of the composer's unit and equal to it in the normal form. */
function quoteOk(doc: Composed, text: string, quote: string): string | undefined {
  const unit = doc.units.find((x) => squash(x.text) === squash(text));
  if (!unit) return 'the unit is not in the composer truth';
  const at = doc.text.indexOf(quote);
  if (at < 0) return `the atom quote ${show(quote)} is not in the source`;
  if (at < unit.region[0] || at + quote.length > unit.region[1])
    return `the atom quote ${show(quote)} is outside the unit`;
  if (norm(quote, unit.container) !== norm(unit.text, unit.container))
    return `the atom quote ${show(quote)} is not the text of the unit ${show(unit.text)}`;
  return undefined;
}

const verbatim = (doc: Composed, text: string, atoms: Atom[]): string | undefined => {
  const hit = atoms.filter((a) => squash(a.quote) === squash(text));
  if (hit.length !== 1) return `${hit.length} atoms for ${show(text)}, expected 1`;
  const one = hit[0] as Atom;
  return quoteOk(doc, text, one.quote) ?? atomProblem(doc, one);
};

/** A gate quote runs from the start of the first unit to the end of the second. */
const gateOk = (doc: Composed, quote: string, first: string, second: string): boolean => {
  if (!doc.text.includes(quote)) return false;
  const q = squash(quote).replace(/^(?:[-*+]|\d+[.)])\s+/, '');
  return q.startsWith(squash(first).slice(0, 30)) && squash(quote).endsWith(squash(second).slice(-20));
};

export const groupingRuns: Record<string, Run> = {
  'range-covers-paragraph': async (ctx) => {
    const p = prose(ctx);
    const sentences = p.many(4);
    const { doc, res } = await scanDoc(
      ctx,
      [P(sentences)],
      labelByText([{ text: sentences[0] as string, to: sentences[3] as string, label: 'rule' }]),
    );
    if (res.atoms.length !== 4)
      return fail(`${res.atoms.length} atoms for a range over four sentences, expected 4`);
    for (const s of sentences) {
      const problem = verbatim(doc, s, res.atoms);
      if (problem) return fail(problem);
    }
    return pass('four atoms, one per sentence');
  },
  'range-boundaries-inclusive': async (ctx) => {
    const t = distinctSentences(prose(ctx), 12);
    const { res } = await scanDoc(
      ctx,
      t.map((x) => P([x])),
      labelByText([{ text: t[4] as string, to: t[5] as string, label: 'rule' }], 'none'),
    );
    for (const [i, x] of t.entries()) {
      const l = liveByText(res.ledger, x)?.labels['agent-rules']?.label;
      const want = i === 4 || i === 5 ? 'rule' : 'none';
      if (l !== want) return fail(`unit ${i + 1} has label ${l}, expected ${want}`);
    }
    return pass('units 5 and 6 only');
  },
  'range-single-unit-and-whole-window': async (ctx) => {
    const t = distinctSentences(prose(ctx), 12);
    const blocks = t.map((x) => P([x]));
    const one = await scanDoc(ctx, blocks, labelByText([{ text: t[6] as string, label: 'rule' }], 'none'));
    const labelled = t.filter((x) => liveByText(one.res.ledger, x)?.labels['agent-rules']?.label === 'rule');
    if (labelled.length !== 1 || labelled[0] !== t[6])
      return fail(`a one-unit range labelled ${labelled.length} units`);
    const all = await scanDoc(
      ctx,
      blocks,
      labelByText([{ text: t[0] as string, to: t[11] as string, label: 'prohibition' }], undefined),
    );
    const n = t.filter(
      (x) => liveByText(all.res.ledger, x)?.labels['agent-rules']?.label === 'prohibition',
    ).length;
    return n === 12 ? pass('one unit, then twelve') : fail(`a whole-window range labelled ${n} of 12 units`);
  },
  'range-across-heading': async (ctx) => {
    const p = prose(ctx);
    const [a, b, c] = p.many(3);
    const h = headingText(p.random);
    const { res } = await scanDoc(
      ctx,
      [P([a as string]), { kind: 'heading', level: 2, text: h }, P([b as string, c as string])],
      labelByText([{ text: a as string, to: c as string, label: 'rule' }], undefined),
    );
    const bad = [a, h, b, c].filter(
      (x) => liveByText(res.ledger, x as string)?.labels['agent-rules']?.label !== 'rule',
    );
    return bad.length === 0
      ? pass('all four units labelled')
      : fail(`${bad.length} units across the heading were not labelled`);
  },
  'container-quote-paragraph-one-atom': async (ctx) => {
    const p = prose(ctx);
    const text = `${p.next()} ${p.next()}`;
    const { doc, res } = await scanDoc(
      ctx,
      [{ kind: 'quote', paragraphs: [text] }],
      perfect(() => 'rule'),
    );
    if (res.atoms.length !== 1)
      return fail(`${res.atoms.length} atoms for one quote paragraph of two sentences`);
    const problem = quoteOk(doc, text, res.atoms[0]?.quote ?? '');
    return problem ? fail(problem) : pass('one atom, the whole paragraph');
  },
  'container-list-item-one-atom': async (ctx) => {
    const p = prose(ctx);
    const item = `${p.next()} ${p.next()}`;
    const { doc, res } = await scanDoc(
      ctx,
      [{ kind: 'list', items: [{ text: item }] }],
      perfect(() => 'prohibition'),
    );
    if (res.atoms.length !== 1) return fail(`${res.atoms.length} atoms, expected one for the whole item`);
    const problem = quoteOk(doc, item, res.atoms[0]?.quote ?? '');
    return problem ? fail(problem) : pass('one atom');
  },
  'container-table-cell-one-atom': async (ctx) => {
    const p = prose(ctx);
    const cell = `${p.next()} ${p.next()}`;
    const { doc, res } = await scanDoc(
      ctx,
      [{ kind: 'table', header: ['h1', 'h2'], rows: [[cell, 'plain']] }],
      labelByText([{ text: cell, label: 'rule' }]),
    );
    if (res.atoms.length !== 1) return fail(`${res.atoms.length} atoms for one cell, expected 1`);
    const quote = res.atoms[0]?.quote ?? '';
    const problem = quoteOk(doc, cell, quote);
    return (problem ?? (quote.includes('|') ? 'the atom quote holds a pipe' : undefined))
      ? fail(problem ?? 'the atom quote holds a pipe')
      : pass('one atom, no pipe');
  },
  'lines-multi-line-unit': async (ctx) => {
    const p = prose(ctx);
    const { doc, res } = await scanDoc(
      ctx,
      [{ kind: 'list', items: p.many(2).map((text) => ({ text })), wrap: 36 }, P(p.many(1), 38)],
      perfect(() => 'rule'),
    );
    if (res.atoms.length !== 3) return fail(`${res.atoms.length} atoms, expected 3`);
    for (const a of res.atoms) {
      const problem = atomProblem(doc, a);
      if (problem) return fail(problem);
      if (!a.quote.includes('\n')) return fail('a wrapped unit has no line end in its quote');
    }
    return pass('three multi-line atoms, lines right');
  },
  'gate-adjacent-sentences': async (ctx) => {
    const t = distinctSentences(prose(ctx), 8);
    const { doc, res } = await scanDoc(
      ctx,
      [P(t.slice(0, 8))],
      labelByText([{ text: t[4] as string, label: 'gate', target: t[5] as string }]),
    );
    const gates = res.atoms.filter((a) => a.kind === 'gate');
    if (gates.length !== 1) return fail(`${gates.length} gate atoms, expected 1`);
    const q = gates[0]?.quote ?? '';
    return gateOk(doc, q, t[4] as string, t[5] as string)
      ? pass('first-to-second quote')
      : fail(`the gate quote is ${show(q, 80)}`);
  },
  'gate-target-earlier': async (ctx) => {
    const t = distinctSentences(prose(ctx), 10);
    const { doc, res } = await scanDoc(
      ctx,
      [P(t)],
      labelByText([{ text: t[6] as string, label: 'gate', target: t[2] as string }]),
    );
    const g = res.atoms.find((a) => a.kind === 'gate');
    if (!g) return fail('no gate atom');
    return gateOk(doc, g.quote, t[2] as string, t[6] as string)
      ? pass('file order')
      : fail(`the gate quote is ${show(g.quote, 80)}`);
  },
  'gate-across-sections': async (ctx) => {
    const p = prose(ctx);
    const t = distinctSentences(p, 6);
    const h = headingText(p.random);
    const { doc, res } = await scanDoc(
      ctx,
      [P(t.slice(0, 3)), { kind: 'heading', level: 2, text: h }, P(t.slice(3))],
      labelByText([{ text: t[2] as string, label: 'gate', target: t[3] as string }]),
    );
    const g = res.atoms.find((a) => a.kind === 'gate');
    return g && gateOk(doc, g.quote, t[2] as string, t[3] as string)
      ? pass('verbatim across the heading')
      : fail('the gate quote is not verbatim source text from the first unit to the second');
  },
  'gate-between-list-items': async (ctx) => {
    const t = distinctSentences(prose(ctx), 5);
    const { doc, res } = await scanDoc(
      ctx,
      [{ kind: 'list', items: t.map((text) => ({ text })) }],
      labelByText([{ text: t[3] as string, label: 'gate', target: t[1] as string }]),
    );
    const g = res.atoms.find((a) => a.kind === 'gate');
    return g && gateOk(doc, g.quote, t[1] as string, t[3] as string)
      ? pass('first item to second item')
      : fail('the gate quote does not run from item 2 to item 4');
  },
  'gate-two-share-target': async (ctx) => {
    const t = distinctSentences(prose(ctx), 10);
    const { res } = await scanDoc(
      ctx,
      [P(t)],
      labelByText([
        { text: t[3] as string, label: 'gate', target: t[1] as string },
        { text: t[7] as string, label: 'gate', target: t[1] as string },
      ]),
    );
    const gates = res.atoms.filter((a) => a.kind === 'gate');
    return gates.length === 2 && new Set(gates.map((g) => g.fields.unit)).size === 2
      ? pass('two gates')
      : fail(`${gates.length} gate atoms, expected 2 with distinct units`);
  },
  'gate-chain': async (ctx) => {
    const t = distinctSentences(prose(ctx), 8);
    const { doc, res } = await scanDoc(
      ctx,
      [P(t)],
      labelByText([
        { text: t[2] as string, label: 'gate', target: t[3] as string },
        { text: t[3] as string, label: 'gate', target: t[4] as string },
      ]),
    );
    const gates = res.atoms.filter((a) => a.kind === 'gate');
    return gates.length === 2 && gates.every((g) => doc.text.includes(g.quote))
      ? pass('two overlapping gates')
      : fail(`${gates.length} gate atoms, expected 2 verbatim`);
  },
  'atom-kind-polarity-from-mapping': async (ctx) => {
    const t = distinctSentences(prose(ctx), 6);
    const { res } = await scanDoc(
      ctx,
      [P(t)],
      labelByText([
        { text: t[0] as string, label: 'rule' },
        { text: t[1] as string, label: 'prohibition' },
        { text: t[2] as string, label: 'gate', target: t[3] as string },
      ]),
    );
    const a = (text: string) => res.atoms.find((x) => squash(x.quote) === squash(text));
    const r = a(t[0] as string);
    const pr = a(t[1] as string);
    const g = res.atoms.find((x) => x.kind === 'gate');
    if (r?.kind !== 'instruction' || r.polarity !== 'obligation')
      return fail('a rule is not an instruction with polarity obligation');
    if (pr?.kind !== 'instruction' || pr.polarity !== 'prohibition')
      return fail('a prohibition is not an instruction with polarity prohibition');
    return g ? pass('kinds and polarities from the mapping') : fail('no gate atom');
  },
  'atom-no-atom-without-mapping': async (ctx) => {
    const t = distinctSentences(prose(ctx), 6);
    const { res } = await scanDoc(
      ctx,
      [P(t)],
      labelByText([
        { text: t[0] as string, to: t[2] as string, label: 'example' },
        { text: t[3] as string, to: t[5] as string, label: 'description' },
      ]),
    );
    if (res.atoms.length !== 0) return fail(`${res.atoms.length} atoms from labels with no atom mapping`);
    const missing = t.filter((x) => !liveByText(res.ledger, x)?.labels['agent-rules']);
    return missing.length === 0
      ? pass('entries kept, no atom')
      : fail(`${missing.length} units have no label in the ledger`);
  },
  'atom-none-builds-nothing': async (ctx) => {
    const t = distinctSentences(prose(ctx), 10);
    const picks: Pick[] = t.slice(0, 5).map((x) => ({ text: x, label: 'rule' }));
    const { res } = await scanDoc(ctx, [P(t)], labelByText(picks, 'none'));
    return res.atoms.length === 5
      ? pass('five atoms')
      : fail(`${res.atoms.length} atoms, expected 5 (units labelled none build nothing)`);
  },
  'atom-provenance-verbatim': async (ctx) => {
    const p = prose(ctx);
    const make = (extra: string) => p.next().replace(/ (\w+) /, ` $1 ${extra} `);
    const t = [
      make('&amp;'),
      make('&lt;tag&gt;'),
      make('a\\* b'),
      make('Café'),
      make('**bold**'),
      make('🍞🔑'),
      make('\u0000'.replace('\u0000', 'x')),
    ];
    const more = p.many(13).map((x, i) => (i % 3 === 0 ? make('𠮷') : x));
    const all = [...t, ...more].slice(0, 20);
    const { doc, res } = await scanDoc(
      ctx,
      [P(all)],
      perfect(() => 'rule'),
    );
    for (const x of all) {
      const problem = verbatim(doc, x, res.atoms);
      if (problem) return fail(problem);
    }
    return pass('twenty atoms, each the source slice');
  },
  'atom-flags': async (ctx) => {
    const t = distinctSentences(prose(ctx), 6);
    const { doc, res } = await scanDoc(
      ctx,
      [P(t)],
      perfect(() => 'rule'),
    );
    for (const text of t) {
      const problem = verbatim(doc, text, res.atoms);
      if (problem) return fail(`positive witness: ${problem}`);
    }
    const ids = new Set(liveOf(res.ledger).map((e) => e.id));
    for (const a of res.atoms) {
      if (a.producedBy !== 'model' || a.approved !== false)
        return fail('an atom is not model-made and unapproved');
      if (a.fields.extraction !== 'pointer') return fail(`fields.extraction is ${a.fields.extraction}`);
      if (!ids.has(a.fields.unit)) return fail(`fields.unit ${a.fields.unit} is not a ledger id`);
      if (a.fields.labelSet !== 'agent-rules') return fail(`fields.labelSet is ${a.fields.labelSet}`);
    }
    return res.atoms.length > 0 ? pass('flags right') : fail('no atoms to check');
  },
  'atom-evidence-prose-pointer': async (ctx) => {
    const t = distinctSentences(prose(ctx), 6);
    const labeler = perfect(() => 'rule');
    const decoy: Labeler = async (req) => {
      const base = (await labeler(req)) as { labels: unknown[] };
      return {
        labels: base.labels as never,
        meta: { evidence: [{ type: 'file_exists', path: '/etc/passwd' }], note: 'FAKE EVIDENCE' },
      };
    };
    const { doc, res } = await scanDoc(ctx, [P(t)], decoy);
    for (const text of t) {
      const problem = verbatim(doc, text, res.atoms);
      if (problem) return fail(`positive witness: ${problem}`);
    }
    for (const a of res.atoms) {
      if (a.evidence.length !== 1)
        return fail(`an atom has ${a.evidence.length} evidence entries, expected 1`);
      const e = a.evidence[0]!;
      if (e.type !== 'custom' || e.name !== 'prose_pointer' || e.reviewRequired !== true)
        return fail('the evidence is not one reviewed prose_pointer check');
    }
    return JSON.stringify(res.atoms).includes('FAKE EVIDENCE')
      ? fail('the labeller wrote evidence')
      : pass('evidence from code only');
  },
  'atom-no-labeler-text': async (ctx) => {
    const t = distinctSentences(prose(ctx), 6);
    const inner = perfect(() => 'rule');
    const hostile: Labeler = async (req) => {
      const base = (await inner(req)) as { labels: Array<Record<string, unknown>> };
      return {
        labels: base.labels.map((l) => ({ ...l, quote: 'FAKE QUOTE', text: 'FAKE QUOTE' })) as never,
        meta: { quote: 'FAKE QUOTE' },
      };
    };
    const { doc, res } = await scanDoc(ctx, [P(t)], hostile);
    for (const text of t) {
      const problem = verbatim(doc, text, res.atoms);
      if (problem) return fail(`positive witness: ${problem}`);
    }
    return JSON.stringify(res.atoms).includes('FAKE QUOTE')
      ? fail('a byte of an atom came from the labeller')
      : pass(`${res.atoms.length} atoms, none from the labeller`);
  },
  'atom-unit-id-survives-edit': async (ctx) => {
    const p = prose(ctx);
    const t = distinctSentences(p, 6);
    const edited = [...t];
    edited[2] = rewordWords(p.random, t[2] as string, 1);
    const labeler = perfect(() => 'rule');
    const first = await scanOk(ctx.sut, {
      files: [{ path: 'd.md', text: compose([P(t)]).text }],
      labeler,
      labelsYaml: RULES_YAML,
    });
    const second = await scanOk(ctx.sut, {
      files: [{ path: 'd.md', text: compose([P(edited)]).text }],
      previousLedger: first.ledger.raw,
      labeler,
      labelsYaml: RULES_YAML,
    });
    const id = liveByText(first.ledger, t[2] as string)?.id;
    const atom = second.atoms.find((a) => squash(a.quote) === squash(edited[2] as string));
    return id && atom && atom.fields.unit === id
      ? pass('same unit id, new quote')
      : fail(`the atom of the reworded unit has unit ${atom?.fields.unit}, expected ${id}`);
  },
  'atom-count-equals-mapped-units': async (ctx) => {
    const p = prose(ctx);
    const t = p.many(80);
    const { res } = await scanDoc(
      ctx,
      t.map((x) => P([x])),
      perfect(),
    );
    const want = t.filter((x) => ['rule', 'prohibition'].includes(truthLabel(x))).length;
    return res.atoms.length === want
      ? pass(`${want} atoms`)
      : fail(`${res.atoms.length} atoms for ${want} mapped units`);
  },
  'atom-order-deterministic': async (ctx) => {
    const p = prose(ctx);
    const files = ['b.md', 'a.md', 'c.md'].map((path) => ({ path, text: compose([P(p.many(6))]).text }));
    const one = await scanOk(ctx.sut, { files, labeler: perfect(() => 'rule'), labelsYaml: RULES_YAML });
    const two = await scanOk(ctx.sut, {
      files: [...files].reverse(),
      labeler: perfect(() => 'rule'),
      labelsYaml: RULES_YAML,
    });
    for (const result of [one, two]) {
      if (result.atoms.length !== 18) return fail('positive witness: expected eighteen rule atoms');
      for (const file of files) {
        if (
          !result.atoms.some(
            (atom) => atom.file === file.path && atom.quote.length > 0 && file.text.includes(atom.quote),
          )
        )
          return fail(`positive witness: no rule atom from ${file.path}`);
      }
    }
    const key = (a: Atom) => `${a.file}:${String(a.startLine).padStart(6, '0')}`;
    const keys = one.atoms.map(key);
    if (keys.join() !== [...keys].sort().join()) return fail('atoms are not in file order');
    return JSON.stringify(one.atoms) === JSON.stringify(two.atoms)
      ? pass('same order twice')
      : fail('the atoms differ when the files are given in another order');
  },
};
