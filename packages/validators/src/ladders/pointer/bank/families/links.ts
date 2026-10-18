import { cloneWorld, distinctSentences, filesOf, longSentence, type World } from '../../kit/anchor-world';
import { build, liveByText, liveOf, scanOk } from '../../kit/estate';
import { constant, entriesFor } from '../../kit/labellers';
import { type LinkWorld, linksApi, linkWorld, scanRules } from '../../kit/links-world';
import { show } from '../../kit/oracle';
import { splitParts } from '../../kit/segments';
import { Prose, rewordWords } from '../../kit/words';
import type { Labeler, LedgerView, Link, LinkState } from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const textOfIds = (ledger: LedgerView) => new Map(liveOf(ledger).map((e) => [e.id, e.quote]));

async function afterEdit(ctx: ItemContext, lw: LinkWorld, edit: (w: World) => void, render = lw.render) {
  const w2 = cloneWorld(lw.w);
  edit(w2);
  const second = await scanRules(ctx.sut, w2, render, lw.first.ledger.raw);
  const states = lw.api.classify(lw.first.ledger, second.ledger, lw.links);
  return { w2, second, states };
}

/** Positions (file, index) of a text in a world. */
const where = (w: World, text: string): [number, number] => {
  for (const [f, ts] of w.texts.entries()) {
    const i = ts.indexOf(text);
    if (i >= 0) return [f, i];
  }
  return [-1, -1];
};

type Want = { text: string; states: LinkState[] };

/**
 * Every link must be in a state the expectation allows: the explicit ones as given; a rule next to an edited one
 * ok or advisory (its neighbour changed); every other rule ok.
 */
function checkStates(
  lw: LinkWorld,
  states: LinkState[],
  want: Want[],
  edited: string[],
  strictRest = false,
  after?: World,
): string | undefined {
  const names = textOfIds(lw.first.ledger);
  const explicit = new Map(want.map((x) => [x.text, x.states]));
  const near = new Set<string>();
  for (const t of edited) {
    for (const world of after ? [lw.w, after] : [lw.w]) {
      const [f, i] = where(world, t);
      for (const d of [-1, 1]) {
        const n = lw.w.texts[f]?.[i + d] ?? (world.texts[f]?.[i + d] as string | undefined);
        if (n) near.add(n);
        const m = world.texts[f]?.[i + d];
        if (m) near.add(m);
      }
    }
  }
  for (const [i, link] of lw.links.entries()) {
    const text = names.get(link.span) ?? '';
    const allowed =
      explicit.get(text) ??
      (near.has(text) && !strictRest ? (['ok', 'advisory'] as LinkState[]) : (['ok'] as LinkState[]));
    if (!allowed.includes(states[i] as LinkState)) {
      return `the link of ${link.owner} to ${show(text, 36)} is ${states[i]}, expected ${allowed.join(' or ')}`;
    }
  }
  return undefined;
}

const verdict = (problem: string | undefined, ok: string): Outcome => (problem ? fail(problem) : pass(ok));
const pickRule = (lw: LinkWorld, k: number) => lw.w.texts[0]?.[k] as string;
const reworded = (p: Prose, t: string) => rewordWords(p.random, t, 1);

export const linksRuns: Record<string, Run> = {
  'ok-unchanged': async (ctx) => {
    const lw = await linkWorld(ctx);
    const { states } = await afterEdit(ctx, lw, () => undefined);
    return verdict(checkStates(lw, states, [], [], true), 'every link ok');
  },
  'ok-cosmetic-edits': async (ctx) => {
    const lw = await linkWorld(ctx, { render: { list: { marker: '-' } } });
    const { states } = await afterEdit(ctx, lw, () => undefined, {
      heading: true,
      list: { marker: '*' },
      wrap: 47,
      eol: '\r\n',
    });
    return verdict(checkStates(lw, states, [], [], true), 'every link ok after cosmetic edits');
  },
  'suspect-reword': async (ctx) => {
    const lw = await linkWorld(ctx);
    const t = pickRule(lw, 3);
    const p = prose(ctx);
    const { states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]![3] = reworded(p, t);
    });
    return verdict(checkStates(lw, states, [{ text: t, states: ['suspect'] }], [t]), 'reworded span suspect');
  },
  'suspect-delete-unit': async (ctx) => {
    const lw = await linkWorld(ctx);
    const t = pickRule(lw, 5);
    const { states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]?.splice(5, 1);
    });
    return verdict(checkStates(lw, states, [{ text: t, states: ['suspect'] }], [t]), 'deleted span suspect');
  },
  'suspect-delete-file': async (ctx) => {
    const lw = await linkWorld(ctx, { files: 3, per: 6 });
    const gone = lw.w.texts[1] as string[];
    const { states } = await afterEdit(ctx, lw, (w) => {
      w.paths.splice(1, 1);
      w.heads.splice(1, 1);
      w.texts.splice(1, 1);
    });
    return verdict(
      checkStates(
        lw,
        states,
        gone.map((text) => ({ text, states: ['suspect'] as LinkState[] })),
        [],
        true,
      ),
      'deleted file: its spans suspect',
    );
  },
  'suspect-split': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { prose: p });
    const t = pickRule(lw, 2);
    const parts = splitParts(p);
    const { states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]?.splice(2, 1, parts.a, parts.b);
    });
    // the old text is not the composed whole: the split uses the world's own rule text
    void parts;
    return verdict(checkStates(lw, states, [{ text: t, states: ['suspect'] }], [t]), 'split span suspect');
  },
  'suspect-merge': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { prose: p });
    const a = pickRule(lw, 5);
    const b = pickRule(lw, 6);
    const { states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]?.splice(5, 2, `${a.replace(/\.$/, '')}, and ${b.charAt(0).toLowerCase()}${b.slice(1)}`);
    });
    return verdict(
      checkStates(
        lw,
        states,
        [
          { text: a, states: ['suspect'] },
          { text: b, states: ['suspect'] },
        ],
        [a, b],
      ),
      'merged spans suspect',
    );
  },
  'ok-moved-in-file': async (ctx) => {
    const lw = await linkWorld(ctx);
    const t = pickRule(lw, 4);
    const { states, w2 } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]?.splice(4, 1);
      w.texts[0]?.push(t);
    });
    return verdict(
      checkStates(lw, states, [{ text: t, states: ['ok', 'advisory'] }], [t], false, w2),
      'moved span ok or advisory',
    );
  },
  'ok-moved-across-files': async (ctx) => {
    const lw = await linkWorld(ctx);
    const t = pickRule(lw, 4);
    const { states, w2 } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]?.splice(4, 1);
      w.texts[1]?.push(t);
    });
    return verdict(
      checkStates(lw, states, [{ text: t, states: ['ok', 'advisory'] }], [t], false, w2),
      'span moved to another file ok or advisory',
    );
  },
  'advisory-heading-rename': async (ctx) => {
    const lw = await linkWorld(ctx);
    const rules = lw.w.texts[0] as string[];
    const { states } = await afterEdit(ctx, lw, (w) => {
      w.heads[0] = `${w.heads[0]} renamed`;
    });
    const want = rules.map((text) => ({ text, states: ['advisory'] as LinkState[] }));
    return verdict(checkStates(lw, states, want, [], true), 'renamed heading: spans below advisory');
  },
  'advisory-neighbour-edit': async (ctx) => {
    const lw = await linkWorld(ctx, { per: 10, blocks: 20, perBlock: 4 });
    const above = pickRule(lw, 7);
    const target = pickRule(lw, 8);
    const { states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]![7] = above.replace(/ (\w+)\.$/, ' otherwise.');
    });
    return verdict(
      checkStates(
        lw,
        states,
        [
          { text: above, states: ['suspect'] },
          { text: target, states: ['advisory'] },
        ],
        [above],
      ),
      'neighbour reworded: rule advisory',
    );
  },
  'advisory-section-moved': async (ctx) => {
    const p = prose(ctx);
    const texts = distinctSentences(p, 16, longSentence);
    const mk = (parent2: boolean) => {
      const blocks: import('../../kit/compose').Block[] = [
        { kind: 'heading', level: 1, text: 'Parent one' },
        ...(parent2
          ? []
          : [
              { kind: 'heading', level: 2, text: 'Section S' } as const,
              ...texts
                .slice(0, 4)
                .map((t) => ({ kind: 'paragraph', sentences: [t] }) as import('../../kit/compose').Block),
            ]),
        ...texts
          .slice(4, 8)
          .map((t) => ({ kind: 'paragraph', sentences: [t] }) as import('../../kit/compose').Block),
        { kind: 'heading', level: 1, text: 'Parent two' },
        ...(parent2
          ? [
              { kind: 'heading', level: 2, text: 'Section S' } as const,
              ...texts
                .slice(0, 4)
                .map((t) => ({ kind: 'paragraph', sentences: [t] }) as import('../../kit/compose').Block),
            ]
          : []),
        ...texts
          .slice(8, 12)
          .map((t) => ({ kind: 'paragraph', sentences: [t] }) as import('../../kit/compose').Block),
      ];
      return build([{ path: 'a.md', blocks }]).files;
    };
    const api = linksApi(ctx.sut);
    const first = await scanOk(ctx.sut, { files: mk(false), labeler: constant('rule') });
    const second = await scanOk(ctx.sut, {
      files: mk(true),
      previousLedger: first.ledger.raw,
      labeler: constant('rule'),
    });
    const links = texts
      .slice(0, 4)
      .map((t, i) =>
        api.create(
          first.ledger,
          `block-${i}`,
          liveByText(first.ledger, t)?.id as string,
          'verifies',
          'verified',
        ),
      );
    const states = api.classify(first.ledger, second.ledger, links);
    const bad = states.findIndex((s) => s !== 'advisory');
    return bad >= 0
      ? fail(
          `the link to a rule of the moved section is ${states[bad]}, expected advisory (heading path changed, text same)`,
        )
      : pass('moved section: spans advisory');
  },
  'ambiguous-text-copied': async (ctx) => {
    const lw = await linkWorld(ctx, { mustLink: [3] });
    const t = pickRule(lw, 3);
    const { states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]?.splice(3, 1);
      w.texts[0]?.splice(1, 0, t);
      w.texts[1]?.splice(4, 0, t);
    });
    const names = textOfIds(lw.first.ledger);
    const bad = lw.links.findIndex((l, i) => names.get(l.span) === t && states[i] !== 'ambiguous');
    return bad >= 0
      ? fail(`a link to the copied rule is ${states[bad]}, expected ambiguous`)
      : lw.links.some((l) => names.get(l.span) === t)
        ? pass('ambiguous')
        : fail('no link points at the copied rule');
  },
  'twin-edit-keeps-ok': async (ctx) => {
    const p = prose(ctx);
    const shared = longSentence(p);
    const w = {
      paths: ['a/one.md', 'b/two.md'],
      heads: ['One', 'Two'],
      texts: [
        [...distinctSentences(p, 4), shared],
        [...distinctSentences(p, 4), shared],
      ],
    } as World;
    const api = linksApi(ctx.sut);
    const first = await scanRules(ctx.sut, w, { heading: true });
    const entry = first.ledger.entries.find((e) => e.path === 'a/one.md' && e.quote === shared)!;
    const link = api.create(first.ledger, 'block-1', entry.id, 'verifies', 'verified');
    const w2 = cloneWorld(w);
    w2.texts[1]![4] = rewordWords(p.random, shared, 1);
    const second = await scanRules(ctx.sut, w2, { heading: true }, first.ledger.raw);
    const [state] = api.classify(first.ledger, second.ledger, [link]);
    return state === 'ok'
      ? pass('ok')
      : fail(`the link to the rule in a/one.md is ${state} after its twin was edited, expected ok`);
  },
  'suspect-persists-until-cleared': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { prose: p, mustLink: [3] });
    const t = pickRule(lw, 3);
    const { second, states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]![3] = reworded(p, t);
    });
    const third = await scanRules(
      ctx.sut,
      (
        await afterEdit(ctx, lw, (w) => {
          w.texts[0]![3] = reworded(p, t);
        })
      ).w2,
      lw.render,
      second.ledger.raw,
    );
    const states2 = lw.api.classify(second.ledger, third.ledger, lw.links);
    const names = textOfIds(lw.first.ledger);
    const idx = lw.links.map((_l, i) => i).filter((i) => names.get((lw.links[i] as Link).span) === t);
    if (idx.length === 0) return fail('no link points at the edited rule');
    for (const i of idx)
      if (states[i] !== 'suspect' || states2[i] !== 'suspect')
        return fail(`the link is ${states[i]} then ${states2[i]}, expected suspect both times`);
    return pass('suspect on two scans');
  },
  'clear-records-reason': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { prose: p, mustLink: [3] });
    const t = pickRule(lw, 3);
    const { second, states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]![3] = reworded(p, t);
    });
    const names = textOfIds(lw.first.ledger);
    const idx = lw.links
      .map((_l, i) => i)
      .filter((i) => names.get((lw.links[i] as Link).span) === t && states[i] === 'suspect');
    if (idx.length === 0) return fail('no suspect link to clear');
    const reasons = ['cosmetic', 'semantic-still-covered', 'test-updated'];
    for (const [k, reason] of reasons.entries()) {
      const link = lw.links[idx[k % idx.length] as number] as Link;
      const r = lw.api.clear(link, reason, second.ledger);
      if (!r.ok) return fail(`clearing with ${reason} was refused: ${r.error}`);
      const now = liveByText(
        second.ledger,
        reworded(p, t) === '' ? t : (liveOf(second.ledger).find((e) => e.id === link.span)?.quote ?? ''),
      );
      void now;
      const entry = liveOf(second.ledger).find((e) => e.id === link.span);
      if (r.link.reason !== reason) return fail(`the cleared link does not record the reason ${reason}`);
      if (!entry || r.link.fp !== entry.fp)
        return fail('the cleared link does not carry the current fingerprint');
      const [state] = lw.api.classify(second.ledger, second.ledger, [r.link]);
      if (state !== 'ok') return fail(`the link is ${state} after clearing, expected ok`);
    }
    return pass('three reasons recorded');
  },
  'clear-refuses-bad-reason': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { prose: p, mustLink: [3] });
    const t = pickRule(lw, 3);
    const { second, states } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]![3] = reworded(p, t);
    });
    const names = textOfIds(lw.first.ledger);
    const i = lw.links.findIndex((l, k) => names.get(l.span) === t && states[k] === 'suspect');
    if (i < 0) return fail('no suspect link');
    for (const reason of ['', 'whatever']) {
      const r = lw.api.clear(lw.links[i] as Link, reason, second.ledger);
      if (r.ok) return fail(`clearing with ${JSON.stringify(reason)} was accepted`);
    }
    const [still] = lw.api.classify(lw.first.ledger, second.ledger, [lw.links[i] as Link]);
    return still === 'suspect'
      ? pass('both refused, still suspect')
      : fail(`the link is ${still} after refused clearings`);
  },
  'verified-by-mutation': async (ctx) => {
    const lw = await linkWorld(ctx);
    const base = { ...(lw.links[0] as Link), createdBy: 'proposed' };
    const a = lw.api.verify(base, { mutation: 'delete', flipped: true });
    const b = lw.api.verify(base, { mutation: 'delete', flipped: false });
    const c = lw.api.verify(base, { mutation: 'negate', flipped: true });
    return a.createdBy === 'verified' && c.createdBy === 'verified' && b.createdBy !== 'verified'
      ? pass('verified only when the test flipped')
      : fail(`createdBy after the three mutations: ${a.createdBy}, ${b.createdBy}, ${c.createdBy}`);
  },
  'unverified-not-counted': async (ctx) => {
    const p = prose(ctx);
    const w = { paths: ['r.md'], heads: [''], texts: [distinctSentences(p, 10)] } as World;
    const api = linksApi(ctx.sut);
    const first = await scanRules(ctx.sut, w, { heading: false });
    const spans = (w.texts[0] ?? []).map((t) => liveByText(first.ledger, t)?.id as string);
    const links = spans
      .map((id, i) =>
        i < 4
          ? api.create(first.ledger, `b${i}`, id, 'verifies', 'verified')
          : i < 7
            ? api.create(first.ledger, `b${i}`, id, 'verifies', 'proposed')
            : undefined,
      )
      .filter((x): x is Link => !!x);
    const cov = api.coverage(first.ledger, ['rule', 'prohibition'], links);
    return cov.covered === 4 &&
      cov.uncovered.length === 6 &&
      spans.slice(0, 4).every((id) => !cov.uncovered.includes(id))
      ? pass('4 covered, 6 uncovered')
      : fail(`${cov.covered} covered and ${cov.uncovered.length} uncovered, expected 4 and 6`);
  },
  'coverage-ignores-unmapped-labels': async (ctx) => {
    const p = prose(ctx);
    const rules = distinctSentences(p, 10);
    const examples = distinctSentences(p, 5);
    const w = { paths: ['r.md'], heads: [''], texts: [[...rules, ...examples]] } as World;
    const api = linksApi(ctx.sut);
    const labeler: Labeler = (req) => ({
      labels: entriesFor(req, (u) =>
        examples.some((e) => u.text.includes(e.slice(0, 25))) ? 'example' : 'rule',
      ),
    });
    const first = await scanOk(ctx.sut, { files: build(filesOf(w, { heading: false })).files, labeler });
    const links = rules
      .slice(0, 4)
      .map((t, i) =>
        api.create(first.ledger, `b${i}`, liveByText(first.ledger, t)?.id as string, 'verifies', 'verified'),
      );
    const cov = api.coverage(first.ledger, ['rule', 'prohibition'], links);
    const exampleIds = new Set(examples.map((t) => liveByText(first.ledger, t)?.id));
    if (cov.uncovered.some((id) => exampleIds.has(id)))
      return fail('an example span (no atom mapping) is listed as uncovered');
    return cov.uncovered.length === 6
      ? pass('6 rules uncovered, no example')
      : fail(`${cov.uncovered.length} uncovered, expected the 6 rules without a verified link`);
  },
  'coverage-uncovered-set': async (ctx) => {
    const p = prose(ctx);
    const w = { paths: ['r.md'], heads: [''], texts: [distinctSentences(p, 10)] } as World;
    const api = linksApi(ctx.sut);
    const first = await scanRules(ctx.sut, w, { heading: false });
    const spans = (w.texts[0] ?? []).map((t) => liveByText(first.ledger, t)?.id as string);
    const links = spans
      .slice(0, 6)
      .map((id, i) => api.create(first.ledger, `b${i}`, id, 'verifies', i < 4 ? 'verified' : 'proposed'));
    const cov = api.coverage(first.ledger, ['rule', 'prohibition'], links);
    const want = spans.slice(4).sort();
    return JSON.stringify([...cov.uncovered].sort()) === JSON.stringify(want)
      ? pass('the six spans without a verified link')
      : fail(
          `uncovered ${JSON.stringify(cov.uncovered.length)} spans, expected exactly the 6 without a verified link`,
        );
  },
  'link-fields-no-offsets': async (ctx) => {
    const lw = await linkWorld(ctx);
    const need = ['span', 'fp', 'relation', 'createdBy', 'accepted'];
    for (const link of lw.links) {
      const keys = Object.keys(link);
      const missing = need.filter((k) => !keys.includes(k));
      if (missing.length) return fail(`a link lacks ${missing.join(', ')}`);
      const bad = keys.filter((k) => /^(start|end|hint|line|offset|index|position)/i.test(k));
      if (bad.length) return fail(`a link stores a position: ${bad.join(', ')}`);
    }
    return pass('five fields, no offset');
  },
  'link-order-independent': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { prose: p, blocks: 20 });
    const t = pickRule(lw, 3);
    const { second } = await afterEdit(ctx, lw, (w) => {
      w.texts[0]![3] = reworded(p, t);
    });
    const key = (l: Link) => `${l.owner}|${l.span}`;
    const run = (links: Link[]) => {
      const st = lw.api.classify(lw.first.ledger, second.ledger, links);
      return new Map(links.map((l, i) => [key(l), st[i]]));
    };
    const a = run(lw.links);
    const b = run([...lw.links].reverse());
    const rng = p.random;
    const c = run([...lw.links].sort(() => rng() - 0.5));
    for (const k of a.keys())
      if (a.get(k) !== b.get(k) || a.get(k) !== c.get(k))
        return fail(`the state of ${k} depends on the order of the links`);
    return pass('same states in three orders');
  },
  'shared-span-all-suspect': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { prose: p });
    const t = pickRule(lw, 3);
    const entry = liveByText(lw.first.ledger, t)!;
    const links = [0, 1, 2, 3, 4].map((i) =>
      lw.api.create(lw.first.ledger, `shared-${i}`, entry.id, 'verifies', 'verified'),
    );
    const w2 = cloneWorld(lw.w);
    w2.texts[0]![3] = reworded(p, t);
    const second = await scanRules(ctx.sut, w2, lw.render, lw.first.ledger.raw);
    const states = lw.api.classify(lw.first.ledger, second.ledger, links);
    return states.every((s) => s === 'suspect')
      ? pass('five suspect')
      : fail(`states ${JSON.stringify(states)}, expected five suspect`);
  },
  'relation-preserved': async (ctx) => {
    const lw = await linkWorld(ctx);
    const entry = liveOf(lw.first.ledger)[2]!;
    const rels = ['verifies', 'negates', 'example-of', 'x/y'];
    const links = rels.map((r, i) => lw.api.create(lw.first.ledger, `b${i}`, entry.id, r, 'verified'));
    if (links.some((l, i) => l.relation !== rels[i])) return fail('create changed a relation');
    const cleared = links.map((l) => lw.api.clear(l, 'cosmetic', lw.first.ledger));
    return cleared.every((r, i) => r.ok && r.link.relation === rels[i])
      ? pass('relations kept')
      : fail('clearing changed or refused a relation');
  },
};
