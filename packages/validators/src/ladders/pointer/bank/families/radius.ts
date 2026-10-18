import { cloneWorld, distinctSentences, longSentence, type World } from '../../kit/anchor-world';
import type { Block } from '../../kit/compose';
import { build, liveByText, scanOk } from '../../kit/estate';
import { constant } from '../../kit/labellers';
import { type LinkWorld, linksApi, linkWorld, ownersOf, scanRules } from '../../kit/links-world';
import { splitParts } from '../../kit/segments';
import { Prose, rewordWords } from '../../kit/words';
import type { Link } from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const neg = (t: string) => {
  const ws = t.split(' ');
  ws.splice(3, 0, 'not');
  return ws.join(' ');
};

async function blast(
  ctx: ItemContext,
  lw: LinkWorld,
  edit: (w: World) => void,
  render = lw.render,
  links = lw.links,
) {
  const w2 = cloneWorld(lw.w);
  edit(w2);
  const second = await scanRules(ctx.sut, w2, render, lw.first.ledger.raw);
  return { second, w2, radius: lw.api.blast(lw.first.ledger, second.ledger, links) };
}

const bigOptions = { files: 3, per: 7, blocks: 30, perBlock: 3, noLinks: 5 };

function expectRerun(radius: { rerun: string[] }, want: string[], what: string): Outcome {
  return same(radius.rerun, want)
    ? pass(`${what}: ${want.length} blocks`)
    : fail(
        `${what}: the rerun set is ${JSON.stringify(radius.rerun)}, expected ${JSON.stringify([...want].sort())}`,
      );
}

async function mutantWorld(
  ctx: ItemContext,
  kind: 'delete' | 'negate',
  rules: number,
  blocks: number,
  runs: number,
): Promise<Outcome> {
  const lw = await linkWorld(ctx, {
    files: 3,
    per: Math.ceil(rules / 3),
    blocks,
    perBlock: 3,
    noLinks: Math.floor(blocks / 6),
  });
  const all = lw.w.texts.flat();
  for (let k = 0; k < Math.min(runs, all.length); k += 1) {
    const text = all[k] as string;
    const [f, i] = lw.w.texts.map((ts, fi) => [fi, ts.indexOf(text)] as const).find(([, ix]) => ix >= 0) ?? [
      -1, -1,
    ];
    const { radius } = await blast(ctx, lw, (w) => {
      if (kind === 'delete') w.texts[f]?.splice(i, 1);
      else w.texts[f]![i] = neg(text);
    });
    const r = expectRerun(radius, ownersOf(lw, [text]), `${kind} of rule ${k + 1}`);
    if (!r.pass) return r;
  }
  return pass(`${Math.min(runs, all.length)} ${kind} mutants, exact sets`);
}

export const radiusRuns: Record<string, Run> = {
  'delete-one-rule': async (ctx) => {
    const lw = await linkWorld(ctx, { ...bigOptions, mustLink: [4] });
    const t = lw.w.texts[0]?.[4] as string;
    const { radius } = await blast(ctx, lw, (w) => w.texts[0]?.splice(4, 1));
    return expectRerun(radius, ownersOf(lw, [t]), 'delete');
  },
  'negate-one-rule': async (ctx) => {
    const lw = await linkWorld(ctx, { ...bigOptions, mustLink: [5] });
    const t = lw.w.texts[0]?.[5] as string;
    const { radius } = await blast(ctx, lw, (w) => (w.texts[0]![5] = neg(t)));
    return expectRerun(radius, ownersOf(lw, [t]), 'negate');
  },
  'reword-one-rule': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { ...bigOptions, prose: p, mustLink: [2] });
    const t = lw.w.texts[0]?.[2] as string;
    const { radius } = await blast(ctx, lw, (w) => (w.texts[0]![2] = rewordWords(p.random, t, 1)));
    return expectRerun(radius, ownersOf(lw, [t]), 'reword');
  },
  'cosmetic-edit-empty': async (ctx) => {
    const lw = await linkWorld(ctx, { ...bigOptions, render: { list: { marker: '-' } } });
    const { radius } = await blast(ctx, lw, () => undefined, {
      heading: true,
      list: { marker: '*' },
      wrap: 47,
      eol: '\r\n',
    });
    return expectRerun(radius, [], 'cosmetic');
  },
  'move-rule-empty': async (ctx) => {
    const lw = await linkWorld(ctx, { ...bigOptions, mustLink: [3] });
    const t = lw.w.texts[0]?.[3] as string;
    const { radius } = await blast(ctx, lw, (w) => {
      w.texts[0]?.splice(3, 1);
      w.texts[1]?.push(t);
    });
    return expectRerun(radius, [], 'move');
  },
  'rename-file-empty': async (ctx) => {
    const lw = await linkWorld(ctx, { ...bigOptions, files: 3, per: 5 });
    const { radius } = await blast(ctx, lw, (w) => (w.paths[1] = 'notes/renamed-away.md'));
    return expectRerun(radius, [], 'rename');
  },
  'edit-unlinked-rule-empty': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { files: 3, per: 8, blocks: 4, perBlock: 1, prose: p });
    const free = lw.rules.findIndex((t) => (lw.owners.get(t) ?? []).length === 0);
    if (free < 0) return fail('the world has no unlinked rule');
    const f = Math.floor(free / 8);
    const i = free % 8;
    const { radius } = await blast(
      ctx,
      lw,
      (w) => (w.texts[f]![i] = rewordWords(p.random, lw.rules[free] as string, 1)),
    );
    return expectRerun(radius, [], 'edit of a rule no block links to');
  },
  'edit-two-rules-union': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { ...bigOptions, prose: p, mustLink: [1, 9] });
    const a = lw.w.texts[0]?.[1] as string;
    const b = lw.w.texts[1]?.[2] as string;
    const { radius } = await blast(ctx, lw, (w) => {
      w.texts[0]![1] = rewordWords(p.random, a, 1);
      w.texts[1]![2] = neg(b);
    });
    return expectRerun(radius, ownersOf(lw, [a, b]), 'two edits');
  },
  'block-with-three-links-once': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { ...bigOptions, prose: p });
    const api = lw.api;
    const three = [lw.w.texts[0]?.[1], lw.w.texts[0]?.[3], lw.w.texts[1]?.[2]] as string[];
    const extra: Link[] = three.map((t) =>
      api.create(
        lw.first.ledger,
        'block-triple',
        liveByText(lw.first.ledger, t)?.id as string,
        'verifies',
        'verified',
      ),
    );
    const links = [...lw.links, ...extra];
    const { radius } = await blast(
      ctx,
      lw,
      (w) => {
        w.texts[0]![1] = rewordWords(p.random, three[0] as string, 1);
        w.texts[0]![3] = rewordWords(p.random, three[1] as string, 1);
        w.texts[1]![2] = rewordWords(p.random, three[2] as string, 1);
      },
      lw.render,
      links,
    );
    const count = radius.rerun.filter((x) => x === 'block-triple').length;
    return count === 1 ? pass('listed once') : fail(`the block linked three times is listed ${count} times`);
  },
  'block-without-links-never': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { files: 2, per: 6, blocks: 5, perBlock: 2, prose: p });
    const { radius } = await blast(ctx, lw, (w) => {
      w.texts[0]?.splice(1, 1);
      w.texts[1]?.splice(2, 1);
    });
    return radius.rerun.some((o) => o.startsWith('free-'))
      ? fail('a block without links is in the rerun set')
      : pass('unlinked blocks never rerun');
  },
  'delete-file-with-rules': async (ctx) => {
    const lw = await linkWorld(ctx, { files: 3, per: 4, blocks: 14, perBlock: 3 });
    const gone = lw.w.texts[1] as string[];
    const { radius } = await blast(ctx, lw, (w) => {
      w.paths.splice(1, 1);
      w.heads.splice(1, 1);
      w.texts.splice(1, 1);
    });
    return expectRerun(radius, ownersOf(lw, gone), 'delete of a file');
  },
  'split-rule': async (ctx) => {
    const p = prose(ctx);
    const parts = splitParts(p);
    const lw = await linkWorld(ctx, { ...bigOptions, prose: p, mustLink: [3] });
    const t = lw.w.texts[0]?.[3] as string;
    lw.w.texts[0]![3] = parts.whole;
    lw.first = await scanRules(ctx.sut, lw.w, lw.render);
    lw.links = lw.links.map((l) => l);
    // relink the owners of the old rule to the new whole text
    const entry = liveByText(lw.first.ledger, parts.whole)!;
    const owners = ownersOf(lw, [t]);
    const links = [
      ...lw.links.filter((l) => !owners.includes(l.owner)),
      ...owners.map((o) => lw.api.create(lw.first.ledger, o, entry.id, 'verifies', 'verified')),
    ];
    const { radius } = await blast(
      ctx,
      lw,
      (w) => w.texts[0]?.splice(3, 1, parts.a, parts.b),
      lw.render,
      links,
    );
    return expectRerun(radius, owners, 'split');
  },
  'merge-rules': async (ctx) => {
    const lw = await linkWorld(ctx, { ...bigOptions, mustLink: [3, 4] });
    const a = lw.w.texts[0]?.[3] as string;
    const b = lw.w.texts[0]?.[4] as string;
    const { radius } = await blast(ctx, lw, (w) =>
      w.texts[0]?.splice(3, 2, `${a.replace(/\.$/, '')}, and ${b.charAt(0).toLowerCase()}${b.slice(1)}`),
    );
    return expectRerun(radius, ownersOf(lw, [a, b]), 'merge');
  },
  'advisory-same-section': async (ctx) => {
    const p = prose(ctx);
    const lw = await sectionWorld(ctx, p);
    const rules = lw.sections[1] as string[];
    const target = rules[2] as string;
    const { radius } = await blastSections(ctx, lw, (t) => (t === target ? rewordWords(p.random, t, 1) : t));
    const rerun = ownersOf(lw, [target]);
    const others = ownersOf(
      lw,
      rules.filter((t) => t !== target),
    ).filter((o) => !rerun.includes(o));
    const got = radius.advisory.filter((o) => !radius.rerun.includes(o));
    return same(got, others)
      ? pass(`${others.length} advisory blocks`)
      : fail(
          `advisory minus rerun is ${JSON.stringify(got)}, expected the blocks of the other rules of the section ${JSON.stringify(others)}`,
        );
  },
  'advisory-excludes-other-sections': async (ctx) => {
    const p = prose(ctx);
    const lw = await sectionWorld(ctx, p);
    const rules = lw.sections[1] as string[];
    const target = rules[2] as string;
    const { radius } = await blastSections(ctx, lw, (t) => (t === target ? rewordWords(p.random, t, 1) : t));
    const inside = new Set(ownersOf(lw, rules));
    const far = [...(lw.sections[0] as string[]).slice(0, -1), ...(lw.sections[2] as string[]).slice(1)];
    const onlyFar = ownersOf(lw, far).filter((o) => !inside.has(o));
    const bad = radius.advisory.find((o) => onlyFar.includes(o));
    return bad
      ? fail(`the block ${bad}, linked only to rules of other sections, is advisory`)
      : pass('advisory stops at the section');
  },
  'advisory-heading-rename': async (ctx) => {
    const p = prose(ctx);
    const lw = await sectionWorld(ctx, p);
    const rules = lw.sections[1] as string[];
    const { radius, second } = await blastSections(ctx, lw, (t) => t, 'Renamed section heading');
    const states = lw.api.classify(lw.first.ledger, second.ledger, lw.links);
    void states;
    const need = ownersOf(lw, rules);
    const near = new Set(
      ownersOf(lw, [
        ...rules,
        (lw.sections[0] as string[]).at(-1) as string,
        (lw.sections[2] as string[])[0] as string,
      ]),
    );
    if (radius.rerun.length > 0)
      return fail(`the rerun set after a heading rename is ${JSON.stringify(radius.rerun)}, expected empty`);
    if (need.some((o) => !radius.advisory.includes(o)))
      return fail('a block linked to a rule of the section is not advisory');
    const far = radius.advisory.filter((o) => !near.has(o));
    return far.length === 0
      ? pass('advisory = the section')
      : fail(
          `blocks linked only to far rules are advisory: ${far.join(', ')}; states: ${far
            .map((o) =>
              lw.links
                .map((l, i) => (l.owner === o ? states[i] : ''))
                .filter(Boolean)
                .join('/'),
            )
            .join(' ; ')}; their rules: ${far
            .map((o) =>
              lw.links
                .filter((l) => l.owner === o)
                .map(
                  (l) =>
                    lw.first.ledger.entries.find((e) => e.id === l.span)?.sectionPath.join('>') +
                    ':' +
                    lw.rules.indexOf(lw.first.ledger.entries.find((e) => e.id === l.span)?.quote ?? ''),
                )
                .join('|'),
            )
            .join(' ; ')}`,
        );
  },
  'cleared-link-leaves-radius': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { ...bigOptions, prose: p, mustLink: [1, 4] });
    const a = lw.w.texts[0]?.[1] as string;
    const b = lw.w.texts[0]?.[4] as string;
    const w2 = cloneWorld(lw.w);
    w2.texts[0]![1] = rewordWords(p.random, a, 1);
    const second = await scanRules(ctx.sut, w2, lw.render, lw.first.ledger.raw);
    const cleared = lw.links.map((l) => {
      const entry = second.ledger.entries.find((e) => e.id === l.span);
      if (entry && entry.status === 'live' && entry.quote === w2.texts[0]?.[1]) {
        const r = lw.api.clear(l, 'semantic-still-covered', second.ledger);
        if (!r.ok) throw new Error(`clear refused: ${r.error}`);
        return r.link;
      }
      return l;
    });
    const w3 = cloneWorld(w2);
    w3.texts[0]![4] = rewordWords(p.random, b, 1);
    const third = await scanRules(ctx.sut, w3, lw.render, second.ledger.raw);
    const radius = lw.api.blast(second.ledger, third.ledger, cleared);
    const stillA = ownersOf(lw, [a]).filter((o) => !ownersOf(lw, [b]).includes(o));
    if (stillA.some((o) => radius.rerun.includes(o)))
      return fail('a block of the cleared rule is still in the rerun set');
    return expectRerun(radius, ownersOf(lw, [b]), 'the second edit');
  },
  'cross-file-blocks': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { files: 3, per: 6, blocks: 24, perBlock: 3, prose: p, mustLink: [2] });
    const t = lw.w.texts[0]?.[2] as string;
    const { radius } = await blast(ctx, lw, (w) => (w.texts[0]![2] = rewordWords(p.random, t, 1)));
    const owners = ownersOf(lw, [t]);
    return owners.length >= 1
      ? expectRerun(radius, owners, 'a rule linked from blocks of other files')
      : fail('no block links to the rule');
  },
  'sequential-edits-not-cumulative': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { ...bigOptions, prose: p, mustLink: [1, 4] });
    const a = lw.w.texts[0]?.[1] as string;
    const b = lw.w.texts[0]?.[4] as string;
    const w2 = cloneWorld(lw.w);
    w2.texts[0]![1] = rewordWords(p.random, a, 1);
    const second = await scanRules(ctx.sut, w2, lw.render, lw.first.ledger.raw);
    const accepted = lw.links.map((l) => {
      const entry = second.ledger.entries.find((e) => e.id === l.span && e.status === 'live');
      return entry ? lw.api.create(second.ledger, l.owner, l.span, l.relation, 'verified') : l;
    });
    const w3 = cloneWorld(w2);
    w3.texts[0]![4] = rewordWords(p.random, b, 1);
    const third = await scanRules(ctx.sut, w3, lw.render, second.ledger.raw);
    const radius = lw.api.blast(second.ledger, third.ledger, accepted);
    return expectRerun(radius, ownersOf(lw, [b]), 'the radius of the last edit');
  },
  'world-delete-30': (ctx) => mutantWorld(ctx, 'delete', 30, 60, 30),
  'world-negate-30': (ctx) => mutantWorld(ctx, 'negate', 30, 60, 30),
  'world-mixed-precision-recall': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { files: 4, per: 25, blocks: 150, perBlock: 3, noLinks: 20, prose: p });
    const kinds = ['delete', 'negate', 'reword', 'cosmetic', 'move'] as const;
    const rng = p.random;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let k = 0; k < 60; k += 1) {
      const kind = kinds[k % kinds.length] as (typeof kinds)[number];
      const f = Math.floor(rng() * 4);
      const i = Math.floor(rng() * 25);
      const text = lw.w.texts[f]?.[i] as string;
      const edit = (w: World) => {
        if (kind === 'delete') w.texts[f]?.splice(i, 1);
        else if (kind === 'negate') w.texts[f]![i] = neg(text);
        else if (kind === 'reword') w.texts[f]![i] = rewordWords(rng, text, 1);
        else if (kind === 'move') {
          w.texts[f]?.splice(i, 1);
          w.texts[(f + 1) % 4]?.push(text);
        }
      };
      const { radius } = await blast(
        ctx,
        lw,
        edit,
        kind === 'cosmetic' ? { heading: true, wrap: 41, eol: '\r\n' } : lw.render,
      );
      const truth = kind === 'cosmetic' || kind === 'move' ? [] : ownersOf(lw, [text]);
      for (const o of radius.rerun) {
        if (truth.includes(o)) tp += 1;
        else fp += 1;
      }
      for (const o of truth) if (!radius.rerun.includes(o)) fn += 1;
    }
    return fp === 0 && fn === 0
      ? pass(`60 mutants, ${tp} blocks, precision and recall 1`)
      : fail(
          `over 60 mutants: ${fp} blocks too many, ${fn} missing (precision ${(tp / Math.max(1, tp + fp)).toFixed(2)}, recall ${(tp / Math.max(1, tp + fn)).toFixed(2)})`,
        );
  },
  'output-sorted-unique': async (ctx) => {
    const p = prose(ctx);
    const lw = await linkWorld(ctx, { ...bigOptions, prose: p, mustLink: [1] });
    const { radius } = await blast(ctx, lw, (w) => {
      w.texts[0]![1] = rewordWords(p.random, w.texts[0]?.[1] as string, 1);
      w.texts[0]![2] = rewordWords(p.random, w.texts[0]?.[2] as string, 1);
    });
    const ok = (xs: string[]) => xs.every((x, i) => i === 0 || (xs[i - 1] as string) < x);
    return ok(radius.rerun) && ok(radius.advisory)
      ? pass('sorted, no duplicate')
      : fail(`unsorted or duplicated sets: ${JSON.stringify(radius)}`);
  },
};

/* ---- a world with three sections in one file ---- */

type SectionWorld = LinkWorld & { sections: string[][]; heads: string[] };

async function sectionWorld(ctx: ItemContext, p: Prose): Promise<SectionWorld> {
  const texts = distinctSentences(p, 18, longSentence);
  const sections = [texts.slice(0, 6), texts.slice(6, 12), texts.slice(12, 18)];
  const heads = ['Alpha round', 'Beta round', 'Gamma round'];
  const files = (secs: string[][], hs: string[]) =>
    build([
      {
        path: 'sections.md',
        blocks: secs.flatMap((s, k) => [
          { kind: 'heading', level: 2, text: hs[k] } as Block,
          ...s.map((t) => ({ kind: 'paragraph', sentences: [t] }) as Block),
        ]),
      },
    ]).files;
  const first = await scanOk(ctx.sut, { files: files(sections, heads), labeler: constant('rule') });
  const api = linksApi(ctx.sut);
  const rng = p.random;
  const links: Link[] = [];
  const owners = new Map<string, string[]>();
  for (let b = 0; b < 24; b += 1) {
    const owner = `block-${String(b + 1).padStart(3, '0')}`;
    const k = 1 + Math.floor(rng() * 3);
    const picked = new Set<number>();
    while (picked.size < k) picked.add(Math.floor(rng() * texts.length));
    for (const i of picked) {
      const t = texts[i] as string;
      links.push(
        api.create(first.ledger, owner, liveByText(first.ledger, t)?.id as string, 'verifies', 'verified'),
      );
      owners.set(t, [...(owners.get(t) ?? []), owner]);
    }
  }
  for (const i of [8, 6, 9, 10, 11]) {
    const t = texts[i] as string;
    if (!(owners.get(t) ?? []).length) {
      links.push(
        api.create(
          first.ledger,
          `block-sec-${i}`,
          liveByText(first.ledger, t)?.id as string,
          'verifies',
          'verified',
        ),
      );
      owners.set(t, [`block-sec-${i}`]);
    }
  }
  return {
    w: { paths: ['sections.md'], heads: [''], texts: [texts] },
    render: { heading: false },
    first,
    links,
    owners,
    rules: texts,
    api,
    sections,
    heads,
  };
}

async function blastSections(
  ctx: ItemContext,
  lw: SectionWorld,
  map: (t: string) => string,
  newHead?: string,
) {
  const heads = [...lw.heads];
  if (newHead) heads[1] = newHead;
  const secs = lw.sections.map((s) => s.map(map));
  const blocks = secs.flatMap((s, k) => [
    { kind: 'heading', level: 2, text: heads[k] } as Block,
    ...s.map((t) => ({ kind: 'paragraph', sentences: [t] }) as Block),
  ]);
  const second = await scanOk(ctx.sut, {
    files: build([{ path: 'sections.md', blocks }]).files,
    previousLedger: lw.first.ledger.raw,
    labeler: constant('rule'),
  });
  return { second, radius: lw.api.blast(lw.first.ledger, second.ledger, lw.links) };
}
