import { type Block, type Composed, type ComposeOptions, compose } from '../../kit/compose';
import { cutCase, cutRun } from '../../kit/cut-case';
import { compareCut, coverageGap, show } from '../../kit/oracle';
import { headingText, Prose, type Rng, shortRule, word } from '../../kit/words';
import { listOf, mixedBlocks, para } from '../../kit/world';
import type { CutResult } from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
const sentenceBlock = (
  sentences: string[],
  extra: Partial<Extract<Block, { kind: 'paragraph' }>> = {},
): Block => ({
  kind: 'paragraph',
  sentences,
  ...extra,
});

/** The design's own example file, section 2. */
const SHELF_AUDIT = [
  '# Shelf audit',
  '',
  '**Keys.** A key opens one door. Return every key before you leave.',
  '',
  '- Count the till twice',
  '- Never leave the desk unattended',
  '',
  'Read `references/closing.md` before you lock up.',
].join('\n');

const timed = async <T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const started = performance.now();
  const value = await work();
  return { value, ms: performance.now() - started };
};

async function digestOf(ctx: ItemContext, text: string): Promise<{ cut: CutResult; digest: string }> {
  const cut = await ctx.sut.cut({ path: 'doc.md', text });
  return { cut, digest: cut.cutDigest };
}

export const cuttingRuns: Record<string, Run> = {
  'heading-atx': cutRun((ctx) => {
    const p = prose(ctx);
    const blocks: Block[] = [];
    for (let level = 1; level <= 6; level += 1) {
      blocks.push({ kind: 'heading', level, text: headingText(p.random) }, para(p, 1));
    }
    return blocks;
  }),
  'heading-setext': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      { kind: 'heading', level: 1, text: headingText(p.random), style: 'setext' },
      para(p, 1),
      { kind: 'heading', level: 2, text: headingText(p.random), style: 'setext' },
      para(p, 2),
    ];
  }),
  'heading-closing-hashes': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      { kind: 'heading', level: 2, text: headingText(p.random), closing: true },
      para(p, 1),
      { kind: 'heading', level: 1, text: headingText(p.random), closing: true },
      para(p, 1),
    ];
  }),
  'heading-path-nesting': cutRun((ctx) => {
    const p = prose(ctx);
    const h = () => headingText(p.random);
    return [
      { kind: 'heading', level: 2, text: h() },
      para(p, 1),
      { kind: 'heading', level: 2, text: h() },
      para(p, 1),
      { kind: 'heading', level: 1, text: h() },
      { kind: 'heading', level: 2, text: h() },
      para(p, 1),
      { kind: 'heading', level: 2, text: h() },
      para(p, 1),
    ];
  }),
  'heading-path-skipped-level': cutRun((ctx) => {
    const p = prose(ctx);
    const h = () => headingText(p.random);
    return {
      blocks: [
        { kind: 'heading', level: 1, text: h() },
        { kind: 'heading', level: 3, text: h() },
        para(p, 1),
        { kind: 'heading', level: 2, text: h() },
        para(p, 1),
      ],
      extra: (_doc, got) => {
        const bad = got.units.find((u) => u.path.includes(''));
        return bad ? `a heading path holds an empty string: ${JSON.stringify(bad.path)}` : undefined;
      },
    };
  }),
  'sentences-split-terminators': cutRun((ctx) => {
    const p = prose(ctx);
    const ends = ['.', '?', '!', '.', '.'];
    return [sentenceBlock(p.many(5).map((s, i) => s.replace(/\.$/, ends[i] ?? '.')))];
  }),
  'design-example-shelf-audit': cutRun((ctx) => {
    void ctx;
    return {
      blocks: [
        { kind: 'heading', level: 1, text: 'Shelf audit' },
        sentenceBlock(['**Keys.**', 'A key opens one door.', 'Return every key before you leave.']),
        {
          kind: 'list',
          items: [{ text: 'Count the till twice' }, { text: 'Never leave the desk unattended' }],
        },
        sentenceBlock(['Read `references/closing.md` before you lock up.']),
      ],
      options: { trimEnd: true },
      extra: (doc, got) => {
        if (doc.text !== SHELF_AUDIT) return 'the composer does not reproduce the design example text';
        const names = got.units.map((u) => u.container).join(',');
        const want = 'heading,sentence,sentence,sentence,list_item,list_item,sentence';
        if (names !== want) return `containers are ${names}, the design shows ${want}`;
        if (got.units[1]?.text !== '**Keys.**')
          return `unit 2 is ${show(got.units[1]?.text ?? '')}, the design shows **Keys.**`;
        return undefined;
      },
    };
  }),
  'sentences-hard-wrapped': cutRun((ctx) => {
    const p = prose(ctx);
    return {
      blocks: [sentenceBlock(p.many(6), { wrap: 40 })],
      extra: (doc, got) =>
        got.units.some((u) => u.text.includes('\n')) || !doc.text.includes('\n')
          ? undefined
          : 'no unit holds a wrapped line end',
    };
  }),
  'sentences-mask-inline-code': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const first = `Run \`${word(r)}.get(${word(r)}. ${cap(word(r))})\` first.`;
    return {
      blocks: [sentenceBlock([first, p.next()])],
      extra: (_doc, got) =>
        got.units[0]?.text.includes('`') ? undefined : 'the first unit does not hold the code span',
    };
  }),
  'sentences-mask-url': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const first = `Open https://shop.example/${word(r)}.${word(r)}/menu.`;
    return {
      blocks: [sentenceBlock([first, p.next()])],
      extra: (_doc, got) =>
        got.units[0]?.text.endsWith('menu.')
          ? undefined
          : 'the full stop after the URL does not end the first unit',
    };
  }),
  'sentences-mask-link-destination': async (ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const plain = `Read [the ${word(r)} guide](docs/guide.v${1 + Math.floor(r() * 8)}.md).`;
    const angled = `Read [the ${word(r)} guide](<docs/the guide. ${cap(word(r))}.md>) now.`;
    for (const first of [plain, angled]) {
      const result = await cutCase(ctx, [sentenceBlock([first, p.next()])]);
      if (!result.pass) return fail(`${show(first, 40)}: ${result.detail}`);
    }
    return pass('both destinations stay whole');
  },
  'sentences-lowercase-start-merges': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const first = p.next();
    const second = `${pick(r, ['iOS', 'eBay', 'macOS', 'iPhone'])} ${word(r)} ${word(r)} ${word(r)}.`;
    return [sentenceBlock([first, second])];
  }),
  'sentences-decimal': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    return [
      sentenceBlock([
        `Version ${1 + Math.floor(r() * 8)}.${1 + Math.floor(r() * 8)} ships ${pick(r, ['today', 'later', 'soon'])}.`,
        p.next(),
      ]),
    ];
  }),
  'sentences-short-title': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const name = () => cap(pick(r, ['Ito', 'Lowe', 'Aldous', 'Brandt', 'Okoye', 'Sandoval']));
    const title = () => pick(r, ['Dr.', 'Mr.', 'Mrs.', 'Ms.']);
    return [
      sentenceBlock([
        `${title()} ${name()} counts the ${word(r)} twice.`,
        `${title()} ${name()} locks the ${word(r)} up.`,
      ]),
    ];
  }),
  'sentences-cjk-terminator': cutRun((ctx) => {
    const r = prose(ctx).random;
    const lines = [
      '今日は晴れです。',
      '明日は雨です。',
      '店は朝に開きます。',
      'パンは焼きたてです。',
      '鍵はここにあります。',
    ];
    const a = pick(r, lines);
    const b = pick(
      r,
      lines.filter((l) => l !== a),
    );
    return [{ kind: 'paragraph', sentences: [a, b], joiner: '' }];
  }),
  'sentences-eof-no-newline': cutRun((ctx) => {
    const p = prose(ctx);
    return {
      blocks: [para(p, 3)],
      options: { trimEnd: true },
      extra: (doc, got) => {
        const last = got.units[got.units.length - 1];
        return last && last.end === doc.text.length
          ? undefined
          : `the last unit ends at ${last?.end}, the text at ${doc.text.length}`;
      },
    };
  }),
  'sentences-hard-line-break': async (ctx) => {
    for (const hardBreak of ['spaces', 'backslash'] as const) {
      const p = new Prose(ctx.seed, `${ctx.id}:${hardBreak}`);
      const result = await cutCase(ctx, [sentenceBlock(p.many(3), { hardBreak })]);
      if (!result.pass) return fail(`${hardBreak}: ${result.detail}`);
    }
    return pass('both break styles stay inside their sentence');
  },
  'sentences-emphasis-raw': cutRun((ctx) => {
    const r = prose(ctx).random;
    const s1 = `Always **name the ${word(r)}** first.`;
    const s2 = `Never *skip* the ${word(r)} stage.`;
    return {
      blocks: [sentenceBlock([s1, s2])],
      extra: (_doc, got) =>
        got.units[0]?.text.includes('**') && got.units[1]?.text.includes('*skip*')
          ? undefined
          : 'the emphasis marks are not in the unit text',
    };
  }),
  'sentences-entities-escapes-raw': cutRun((ctx) => {
    const r = prose(ctx).random;
    const s1 = `Use &amp; and &lt;${word(r)}&gt; here.`;
    const s2 = 'Keep a \\* star in the sign.';
    return {
      blocks: [sentenceBlock([s1, s2])],
      extra: (_doc, got) =>
        got.units[0]?.text.includes('&amp;') &&
        got.units[0]?.text.includes('&gt;') &&
        got.units[1]?.text.includes('\\*')
          ? undefined
          : 'an entity or an escape was decoded in the unit text',
    };
  }),
  'lists-bullets': cutRun((ctx) => [listOf(prose(ctx), 5)]),
  'lists-marker-kinds': cutRun((ctx) => {
    const p = prose(ctx);
    return (['-', '*', '+', '1.', '1)'] as const).map((marker) =>
      listOf(p, 2 + Math.floor(p.random() * 2), { marker }),
    );
  }),
  'lists-nested': cutRun((ctx) => {
    const p = prose(ctx);
    const leaf = () => ({ text: p.next() });
    const mid = () => ({ text: p.next(), children: [leaf(), leaf()] });
    return [
      {
        kind: 'list',
        items: [
          { text: p.next(), children: [mid(), mid()] },
          { text: p.next(), children: [mid()] },
        ],
      },
    ];
  }),
  'lists-wrapped-item': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      { kind: 'list', items: p.many(3).map((text) => ({ text })), wrap: 40 },
      { kind: 'list', items: p.many(3).map((text) => ({ text })), wrap: 40, lazy: true, marker: '*' },
    ];
  }),
  'lists-item-with-two-sentences': cutRun((ctx) => {
    const p = prose(ctx);
    return [{ kind: 'list', items: Array.from({ length: 4 }, () => ({ text: `${p.next()} ${p.next()}` })) }];
  }),
  'lists-loose': cutRun((ctx) => [
    {
      kind: 'list',
      items: prose(ctx)
        .many(4)
        .map((text) => ({ text })),
      loose: true,
    },
  ]),
  'lists-after-paragraph-no-blank': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    return [
      {
        kind: 'tight',
        blocks: [sentenceBlock([`Check these ${word(r)} before closing:`]), listOf(p, 2)],
      },
    ];
  }),
  'lists-tab-indented-nested': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      {
        kind: 'list',
        nest: 'tab',
        items: [{ text: p.next(), children: [{ text: p.next() }, { text: p.next() }] }, { text: p.next() }],
      },
    ];
  }),
  'tables-cells': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const cell = () => word(r);
    return {
      blocks: [
        { kind: 'heading', level: 1, text: headingText(r) },
        { kind: 'heading', level: 2, text: headingText(r) },
        {
          kind: 'table',
          header: [cell(), cell(), cell()],
          rows: [0, 1, 2].map(() => [cell(), cell(), cell()]),
          pad: true,
          align: true,
        },
      ],
      extra: (_doc, got) => {
        const cellsOut = got.units.filter((u) => u.container === 'table_cell');
        if (cellsOut.length !== 12) return `${cellsOut.length} cells, expected 12`;
        return cellsOut.some((u) => u.text.includes('|')) ? 'a cell span holds a pipe' : undefined;
      },
    };
  }),
  'tables-escaped-pipe': cutRun((ctx) => {
    const r = prose(ctx).random;
    const tricky = `${word(r)} \\| ${word(r)}`;
    return {
      blocks: [{ kind: 'table', header: [word(r), word(r)], rows: [[tricky, word(r)]] }],
      extra: (_doc, got) =>
        got.units.some((u) => u.text.includes('\\|')) ? undefined : 'the escaped pipe is not inside a cell',
    };
  }),
  'tables-cell-two-sentences': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    return [
      {
        kind: 'table',
        header: [word(r), word(r)],
        rows: [
          [`${p.next()} ${p.next()}`, word(r)],
          [word(r), word(r)],
        ],
      },
    ];
  }),
  'tables-empty-cell': cutRun((ctx) => {
    const r = prose(ctx).random;
    return [
      {
        kind: 'table',
        header: [word(r), word(r), word(r)],
        rows: [
          [word(r), '', word(r)],
          ['', word(r), word(r)],
        ],
      },
    ];
  }),
  'quotes-single': cutRun((ctx) => [{ kind: 'quote', paragraphs: [prose(ctx).next()] }]),
  'quotes-two-paragraphs': cutRun((ctx) => {
    const p = prose(ctx);
    return [{ kind: 'quote', paragraphs: [`${p.next()} ${p.next()}`, p.next()] }];
  }),
  'quotes-wrapped-paragraph': cutRun((ctx) => {
    const p = prose(ctx);
    return {
      blocks: [{ kind: 'quote', paragraphs: [`${p.next()} ${p.next()}`], wrap: 36 }],
      extra: (_doc, got) =>
        got.units[0]?.text.includes('> ') ? undefined : 'the inner quote marks are not in the unit text',
    };
  }),
  'quotes-nested': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      {
        kind: 'quote',
        paragraphs: [
          { text: p.next(), depth: 1 },
          { text: p.next(), depth: 2 },
        ],
      },
    ];
  }),
  'frontmatter-string-values': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    return [
      {
        kind: 'front',
        entries: [
          { key: 'name', value: `${word(r)}-${word(r)}` },
          { key: 'description', value: p.next() },
        ],
      },
      para(p, 2),
    ];
  }),
  'frontmatter-non-strings': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      {
        kind: 'front',
        entries: [
          { key: 'count', value: 3 },
          { key: 'ok', value: true },
          { key: 'none', value: null },
          { key: 'description', value: p.next() },
        ],
      },
      para(p, 1),
    ];
  }),
  'frontmatter-key-path': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const same = p.next();
    const owner = cap(word(r));
    return {
      blocks: [
        {
          kind: 'front',
          entries: [
            { key: 'description', value: p.next() },
            { key: 'metadata', value: { owner } },
            { key: 'alpha', value: same },
            { key: 'beta', value: same },
          ],
        },
        para(p, 1),
      ],
      extra: (_doc, got) => {
        const fm = got.units.filter((u) => u.container === 'front_matter');
        const joined = fm.map((u) => (u.yamlPath ?? []).join('.'));
        if (joined[0] !== 'description')
          return `the first value has path ${JSON.stringify(joined[0])}, expected "description"`;
        const nested = fm[1]?.yamlPath ?? [];
        if (nested[0] !== 'metadata' || nested[nested.length - 1] !== 'owner')
          return `the nested value has path ${JSON.stringify(nested)}`;
        return joined[2] === joined[3] ? 'two equal values have one path' : undefined;
      },
    };
  }),
  'frontmatter-array-strings': cutRun((ctx) => {
    const r = prose(ctx).random;
    return {
      blocks: [{ kind: 'front', entries: [{ key: 'tags', value: [word(r), word(r), word(r)] }] }],
      extra: (_doc, got) => {
        const paths = got.units
          .filter((u) => u.container === 'front_matter')
          .map((u) => (u.yamlPath ?? []).join('.'));
        return new Set(paths).size === 3 ? undefined : `the three tags have paths ${JSON.stringify(paths)}`;
      },
    };
  }),
  'frontmatter-quoted-scalars': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      {
        kind: 'front',
        entries: [
          { key: 'description', value: p.next(), style: 'double' },
          { key: 'summary', value: p.next(), style: 'single' },
        ],
      },
    ];
  }),
  'frontmatter-block-scalar': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      { kind: 'front', entries: [{ key: 'description', value: p.many(3).join('\n'), style: 'folded' }] },
      para(p, 1),
    ];
  }),
  'frontmatter-only-at-start': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const key = word(r);
    return {
      blocks: [
        para(p, 1),
        { kind: 'raw', text: `---${'\n'}`, structure: true },
        { kind: 'heading', level: 2, text: `${key}: ${word(r)}`, style: 'setext' },
      ],
      extra: (_doc, got) =>
        got.units.some((u) => u.container === 'front_matter')
          ? 'a later dash block was read as front matter'
          : undefined,
    };
  }),
  'frontmatter-only-file': cutRun((ctx) => [
    { kind: 'front', entries: [{ key: 'description', value: prose(ctx).next() }] },
  ]),
  'fence-backticks': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      para(p, 2),
      { kind: 'fence', lines: ['# Not a heading', '- not a list item', p.next(), p.next()], info: 'text' },
      para(p, 1),
    ];
  }),
  'fence-tilde-and-info': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      para(p, 1),
      { kind: 'fence', char: '~', info: 'yaml', lines: [`name: ${word(p.random)}`, p.next(), '- item'] },
      para(p, 1),
    ];
  }),
  'fence-longer-delimiter': cutRun((ctx) => {
    const p = prose(ctx);
    return [
      para(p, 1),
      { kind: 'fence', length: 4, lines: ['```js', p.next(), '```', p.next()], info: 'md' },
      para(p, 1),
    ];
  }),
  'fence-unclosed': cutRun((ctx) => {
    const p = prose(ctx);
    return {
      blocks: [para(p, 1), { kind: 'fence', closed: false, lines: [p.next(), p.next(), '# still inside'] }],
      options: { trimEnd: true },
      extra: (doc, got) => {
        const last = got.units[got.units.length - 1];
        return last?.end === doc.text.length
          ? undefined
          : 'the unclosed fence does not run to the end of the text';
      },
    };
  }),
  'comment-html-multiline': cutRun((ctx) => {
    const p = prose(ctx);
    return [para(p, 1), { kind: 'comment', lines: ['Never do this.', p.next(), '- also this'] }, para(p, 1)];
  }),
  'html-tag-wrapped-list': cutRun((ctx) => {
    const p = prose(ctx);
    return {
      blocks: [{ kind: 'tag', tag: 'rules', blocks: [listOf(p, 2)] }, para(p, 1)],
      extra: (_doc, got) =>
        got.units.some((u) => /<\/?rules>/.test(u.text)) ? 'a unit holds a tag line' : undefined,
    };
  }),
  'html-tag-wrapped-sentences': cutRun((ctx) => {
    const p = prose(ctx);
    return {
      blocks: [{ kind: 'tag', tag: 'role', blocks: [para(p, 2)] }, para(p, 1)],
      extra: (_doc, got) =>
        got.units.some((u) => /<\/?role>/.test(u.text)) ? 'a unit holds a tag line' : undefined,
    };
  }),
  'html-nested-depth': async (ctx) => {
    const p = prose(ctx);
    const inner = `Inner ${word(p.random)} text.`;
    let blocks: Block[] = [sentenceBlock([inner])];
    for (const tag of ['e', 'd', 'c', 'b', 'a']) blocks = [{ kind: 'tag', tag, blocks }];
    const doc = compose(blocks);
    const { value: got, ms } = await timed(() => ctx.sut.cut({ path: 'doc.md', text: doc.text }));
    if (ms > 2000) return fail(`the cut took ${Math.round(ms)} ms`);
    const containing = got.units.filter((u) => doc.text.slice(u.start, u.end).includes(inner));
    if (containing.length !== 1) return fail(`the text ${show(inner)} is inside ${containing.length} units`);
    if (!containing.some((u) => u.text === doc.text.slice(u.start, u.end) && u.text.includes(inner)))
      return fail('positive witness: the nested unit must return its actual source text');
    return pass(`the nested text is inside one unit, ${Math.round(ms)} ms`);
  },
  'html-inline-tags-in-sentence': cutRun((ctx) => {
    const p = prose(ctx);
    return [sentenceBlock([`Use <b>${word(p.random)}</b> words.`, p.next()])];
  }),
  'offsets-bom': cutRun((ctx) => {
    const p = prose(ctx);
    return {
      blocks: [{ kind: 'heading', level: 1, text: headingText(p.random) }, para(p, 3)],
      options: { bom: true },
      extra: (_doc, got) => {
        if (got.units.some((u) => u.start < 1)) return 'a unit starts inside the byte-order mark';
        return got.units.some((u) => u.text.includes('﻿'))
          ? 'a unit text holds the byte-order mark'
          : undefined;
      },
    };
  }),
  'offsets-astral': cutRun((ctx) => {
    const p = prose(ctx);
    const r = p.random;
    const mark = () => pick(r, ['🍞', '📦', '🔑', '𠮷', '𝒜']);
    const make = () => {
      const base = p.next();
      const at = base.indexOf(' ', 8);
      return `${base.slice(0, at)} ${mark()}${mark()} ${base.slice(at + 1)}`;
    };
    return [sentenceBlock([make(), make(), make()])];
  }),
  'offsets-nfd-raw': cutRun((ctx) => {
    const p = prose(ctx);
    const make = () => {
      const base = p.next();
      const at = base.indexOf(' ', 6);
      return `${base.slice(0, at)} Café ${base.slice(at + 1)}`;
    };
    return {
      blocks: [sentenceBlock([make(), make()])],
      extra: (_doc, got) =>
        got.units.every((u) => u.text.includes('é')) ? undefined : 'the unit text was normalised to NFC',
    };
  }),
  'offsets-crlf': cutRun((ctx) => {
    const p = prose(ctx);
    return {
      blocks: mixedBlocks(p, { blocks: 14, front: true }),
      options: { eol: '\r\n' },
      extra: (_doc, got) =>
        got.units.some((u) => /^\r|\r$/.test(u.text))
          ? 'a unit starts or ends with a carriage return'
          : undefined,
    };
  }),
  'empty-and-blank-files': async (ctx) => {
    for (const text of ['', '\n\n', '   \n', '\r\n\r\n']) {
      const got = await ctx.sut.cut({ path: 'doc.md', text });
      if (got.units.length !== 0) return fail(`${show(text)} gave ${got.units.length} units`);
      if (typeof got.cutDigest !== 'string') return fail(`${show(text)} gave no digest`);
    }
    const positive = await cutCase(ctx, [sentenceBlock(prose(ctx).many(2))]);
    if (!positive.pass) return fail(`positive witness: ${positive.detail}`);
    return pass('no unit, a digest each');
  },
  'coverage-every-prose-character': async (ctx) => {
    const p = prose(ctx);
    const doc = compose(mixedBlocks(p, { blocks: 40, front: true }));
    const got = await ctx.sut.cut({ path: 'doc.md', text: doc.text });
    const problem = compareCut(doc.text, got, doc.units);
    if (problem) return fail(problem);
    const gap = coverageGap(doc.text, got.units, doc.structure);
    return gap
      ? fail(`the character ${show(gap.char)} at ${gap.offset} is in no unit`)
      : pass(`${got.units.length} units cover the text`);
  },
  'mixed-small': cutRun((ctx) => mixedBlocks(prose(ctx), { blocks: 12, front: true })),
  'mixed-medium': cutRun((ctx) => mixedBlocks(prose(ctx), { blocks: 80, front: true, nested: true })),
  'mixed-large': async (ctx) => {
    const doc = compose(mixedBlocks(prose(ctx), { blocks: 400, front: true }));
    const { value: got, ms } = await timed(() => ctx.sut.cut({ path: 'doc.md', text: doc.text }));
    const problem = compareCut(doc.text, got, doc.units);
    if (problem) return fail(problem);
    return ms > 3000
      ? fail(`the cut of ${doc.text.length} characters took ${Math.round(ms)} ms`)
      : pass(`${doc.units.length} units in ${Math.round(ms)} ms`);
  },
  'digest-same-text': async (ctx) => {
    const doc = compose(mixedBlocks(prose(ctx), { blocks: 10 }));
    const a = await digestOf(ctx, doc.text);
    const b = await digestOf(ctx, doc.text);
    for (const got of [a.cut, b.cut]) {
      const problem = compareCut(doc.text, got, doc.units);
      if (problem) return fail(`positive witness: ${problem}`);
    }
    return a.digest !== '' && a.digest === b.digest
      ? pass('equal digests')
      : fail('two cuts of one text gave different or empty digests');
  },
  'digest-edit': async (ctx) => {
    const p = prose(ctx);
    const blocks = mixedBlocks(p, { blocks: 10 });
    const doc = compose(blocks);
    const edited = doc.text.replace(/\b([a-z]{5,})\b/, '$1zz');
    if (edited === doc.text) return fail('the item could not edit the text');
    const a = await digestOf(ctx, doc.text);
    const b = await digestOf(ctx, edited);
    return a.digest !== b.digest
      ? pass('the digests differ')
      : fail('an edited unit left the digest unchanged');
  },
  'digest-reorder': async (ctx) => {
    const p = prose(ctx);
    const one = [...p.many(3)];
    const a = await digestOf(
      ctx,
      compose([
        sentenceBlock([one[0] as string]),
        sentenceBlock([one[1] as string]),
        sentenceBlock([one[2] as string]),
      ]).text,
    );
    const b = await digestOf(
      ctx,
      compose([
        sentenceBlock([one[1] as string]),
        sentenceBlock([one[0] as string]),
        sentenceBlock([one[2] as string]),
      ]).text,
    );
    return a.digest !== b.digest
      ? pass('the digests differ')
      : fail('swapping two paragraphs left the digest unchanged');
  },
  'digest-cosmetic': async (ctx) => {
    const p = prose(ctx);
    const blocks: Block[] = [para(p, 3), listOf(p, 3), { kind: 'quote', paragraphs: p.many(2, shortRule) }];
    const plain = compose(blocks);
    const wrapped = compose(
      blocks.map((b) =>
        b.kind === 'paragraph' ? { ...b, wrap: 33 } : b.kind === 'list' ? { ...b, marker: '*' as const } : b,
      ),
      { eol: '\r\n' },
    );
    const a = await digestOf(ctx, plain.text);
    const b = await digestOf(ctx, wrapped.text);
    const problem =
      compareCut(plain.text, a.cut, plain.units) ?? compareCut(wrapped.text, b.cut, wrapped.units);
    if (problem) return fail(`positive witness: ${problem}`);
    return a.digest === b.digest
      ? pass('equal digests')
      : fail('a rewrap, a bullet swap and CRLF changed the digest');
  },
  'cut-pure': async (ctx) => {
    const p = prose(ctx);
    const doc = compose(mixedBlocks(p, { blocks: 12, front: true }));
    const a = doc.text;
    const b = compose(mixedBlocks(p, { blocks: 12 })).text;
    const first = await ctx.sut.cut({ path: 'a.md', text: a });
    await ctx.sut.cut({ path: 'b.md', text: b });
    const again = await ctx.sut.cut({ path: 'a.md', text: a });
    const problem = compareCut(a, first, doc.units) ?? compareCut(a, again, doc.units);
    if (problem) return fail(`positive witness: ${problem}`);
    return JSON.stringify(first) === JSON.stringify(again)
      ? pass('equal')
      : fail('cutting B in between changed the cut of A');
  },
};

export type { Composed, ComposeOptions, Outcome };
