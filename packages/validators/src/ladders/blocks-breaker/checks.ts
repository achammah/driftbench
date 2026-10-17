import { type Rng, rngFor, shuffled } from '../blocks/harness';
import {
  type BankItem,
  type BlockDef,
  between,
  type Call,
  call,
  expectAll,
  type ItemContext,
  type ItemResult,
  idsOf,
  item,
  observedParts,
  outcomeOfId,
  PASS,
  play,
  type RunRecord,
  same,
  say,
  scenario,
  show,
  times,
  verdictOf,
  word,
} from './kit';

/**
 * bk-checks: tool scores, order, ids and text (breaker-items.md, family bk-checks). Every oracle is the doc rule
 * applied by hand or by a slow, obviously correct reference written here from the rule alone.
 */

const FAMILY = 'bk-checks';
const CHECKS = 'packages/checks';
const D_TEXT = 'docs/reference/checks.md "Text and language"';
const D_TOOLS = 'docs/reference/checks.md "Tools, skills, guards, references and subagents"';
const D_VERDICTS = 'docs/reference/checks.md "Verdicts"';
const D_RULES = 'docs/reference/checks.md "Rules for the whole spec"';
const D_VALUES = 'docs/reference/checks.md "Assertions on values"';

type Expected = { label: string; count?: number; input?: Record<string, unknown> };
type Plain = {
  text: string;
  calls?: Call[];
  expect: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

/** Blocks written out in full (reply, calls, expectations): the record of one F run. */
async function plain(
  ctx: ItemContext,
  tag: string,
  rows: Plain[],
  spec: Record<string, unknown> = {},
): Promise<RunRecord> {
  const defs: BlockDef[] = rows.map((row) => ({
    plan: { text: row.text, calls: row.calls ?? [], ...(row.extra ? { extra: row.extra } : {}) },
    expect: row.expect,
  }));
  return (await play(ctx, scenario(ctx.seed, tag, defs, spec), { mode: 'F' })).rec;
}

/* ------------------------------------------------------------------------------------------------------
 * tool_f1
 * ---------------------------------------------------------------------------------------------------- */

function scoreItems(): BankItem[] {
  const out: BankItem[] = [];
  const scoreOf = (rec: RunRecord, block: number) =>
    (verdictOf(rec.blocks[block], 'tool_f1.f1') as { score?: number; outcome?: string } | undefined) ?? {};
  type Row = { expected: Expected[]; calls: Call[]; min: number; score: number; pass: boolean };
  const make = (
    id: string,
    tier: 2 | 3 | 4,
    cause: 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7',
    title: string,
    rows: (a: string, b: string, c: string) => Row[],
  ) => {
    const full = `bk.checks.toolf1.${id}`;
    out.push(
      item(FAMILY, full, tier, 1, CHECKS, cause, title, async (ctx) => {
        const [a, b, c] = ['a', 'b', 'c'].map((k) => word(ctx.seed, `${full}:${k}`));
        const cases = rows(a as string, b as string, c as string);
        const rec = await plain(
          ctx,
          full,
          cases.map((r) => ({
            text: 'Done.',
            calls: r.calls,
            expect: { tools: r.expected, tool_f1: { min: r.min } },
          })),
        );
        const issues = cases.flatMap((r, i) => {
          const got = scoreOf(rec, i);
          const near = typeof got.score !== 'number' || Math.abs(got.score - r.score) < 1e-9;
          const outcome = got.outcome === (r.pass ? 'pass' : 'fail');
          return near && outcome
            ? []
            : [
                `case ${i} (min ${r.min}) should score ${r.score} and ${r.pass ? 'pass' : 'fail'}; got ${show(got)}`,
              ];
        });
        return issues.length === 0
          ? PASS
          : expectAll([
              [
                false,
                say(
                  D_TEXT,
                  'tool_f1 is the harmonic mean of the precision and the recall of the matched calls',
                  issues[0] as string,
                ),
              ],
            ]);
      }),
    );
  };
  const e = (label: string, count = 1, input?: Record<string, unknown>): Expected => ({
    label,
    count,
    ...(input ? { input } : {}),
  });
  make('perfect', 2, 'T1', 'a trajectory that matches every expected call scores 1', (a, b) => [
    { expected: [e(a), e(b)], calls: [call(a), call(b)], min: 1, score: 1, pass: true },
  ]);
  make('one-extra-call', 3, 'T2', 'one extra call gives precision 1/2, recall 1 and F1 2/3', (a, b) => [
    { expected: [e(a)], calls: [call(a), call(b)], min: 0.66, score: 2 / 3, pass: true },
    { expected: [e(a)], calls: [call(a), call(b)], min: 0.67, score: 2 / 3, pass: false },
  ]);
  make('one-missed-call', 3, 'T3', 'one missed call gives precision 1, recall 1/2 and F1 2/3', (a, b) => [
    { expected: [e(a), e(b)], calls: [call(a)], min: 0.66, score: 2 / 3, pass: true },
    { expected: [e(a), e(b)], calls: [call(a)], min: 0.67, score: 2 / 3, pass: false },
  ]);
  make(
    'wrong-input',
    4,
    'T4',
    'a call whose input fails the assertion is unexpected and its expectation missed: F1 0',
    (a) => [
      { expected: [e(a, 1, { x: 1 })], calls: [call(a, { x: 2 })], min: 0.01, score: 0, pass: false },
      { expected: [e(a, 1, { x: 1 })], calls: [call(a, { x: 1 })], min: 1, score: 1, pass: true },
    ],
  );
  make(
    'repeat-call-matches-once',
    4,
    'T5',
    'a second call to a tool expected once is unexpected: precision 1/2, recall 1',
    (a) => [
      { expected: [e(a)], calls: [call(a), call(a)], min: 0.66, score: 2 / 3, pass: true },
      { expected: [e(a)], calls: [call(a), call(a)], min: 0.67, score: 2 / 3, pass: false },
    ],
  );
  make('count-two', 4, 'T6', 'a tool expected twice and called once gives precision 1, recall 1/2', (a) => [
    { expected: [e(a, 2)], calls: [call(a)], min: 0.66, score: 2 / 3, pass: true },
    { expected: [e(a, 2)], calls: [call(a)], min: 0.67, score: 2 / 3, pass: false },
  ]);
  make('min-inclusive', 3, 'T7', 'a tool_f1 min equal to the score passes, just above fails', (a, b, c) => [
    { expected: [e(a), e(b)], calls: [call(a), call(c)], min: 0.5, score: 0.5, pass: true },
    { expected: [e(a), e(b)], calls: [call(a), call(c)], min: 0.5000001, score: 0.5, pass: false },
  ]);
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * tool_order against a reference matcher
 * ---------------------------------------------------------------------------------------------------- */

type Entry = { label: string; count: number };
const expand = (entries: readonly Entry[]) =>
  entries.flatMap((entry) => times(entry.count, () => entry.label));
const subsequence = (want: readonly string[], seen: readonly string[]) => {
  let at = 0;
  for (const label of seen) if (label === want[at]) at += 1;
  return at === want.length;
};
const REFERENCE = {
  exact: (entries: readonly Entry[], seen: readonly string[]) => same(seen, expand(entries)),
  in_order: (entries: readonly Entry[], seen: readonly string[]) => subsequence(expand(entries), seen),
  any_order: (entries: readonly Entry[], seen: readonly string[]) =>
    entries.every((entry) => seen.filter((label) => label === entry.label).length >= entry.count),
} as const;
type Order = keyof typeof REFERENCE;

/** A call sequence of groups: the expected labels in their counts, with one slip drawn from the rng. */
function sequenceFor(rng: Rng, entries: readonly Entry[], spare: readonly string[]): string[] {
  const groups = entries.map((entry) => ({ label: entry.label, count: entry.count }));
  const slip = between(rng, 0, 5);
  const at = between(rng, 0, groups.length - 1);
  if (slip === 1) (groups[at] as { count: number }).count += 1;
  if (slip === 2) (groups[at] as { count: number }).count -= 1;
  if (slip === 3 && groups.length > 1) {
    const b = at === groups.length - 1 ? at - 1 : at + 1;
    [groups[at], groups[b]] = [groups[b] as (typeof groups)[number], groups[at] as (typeof groups)[number]];
  }
  if (slip === 4)
    groups.splice(between(rng, 0, groups.length), 0, {
      label: spare[between(rng, 0, spare.length - 1)] as string,
      count: between(rng, 1, 2),
    });
  if (slip === 5 && groups.length > 1) groups.splice(at, 1);
  return groups.flatMap((group) => times(Math.max(0, group.count), () => group.label));
}

function orderItems(): BankItem[] {
  const out: BankItem[] = [];
  const differential = (id: string, tier: 4 | 5, cause: 'O1' | 'O2' | 'O3', order: Order, title: string) => {
    const full = `bk.checks.toolorder.${id}`;
    out.push(
      item(FAMILY, full, tier, 1, CHECKS, cause, title, async (ctx) => {
        const rng = rngFor(ctx.seed, full);
        const pool = ['a', 'b', 'c', 'd'].map((k) => word(ctx.seed, `${full}:${k}`));
        const cases = times(14, () => {
          const picked = shuffled(rng, pool);
          const entries: Entry[] = picked
            .slice(0, between(rng, 2, 3))
            .map((label) => ({ label, count: between(rng, 1, 2) }));
          const spare = picked.slice(entries.length);
          return { entries, seen: sequenceFor(rng, entries, spare) };
        });
        const rec = await plain(
          ctx,
          full,
          cases.map((c) => ({
            text: 'Done.',
            calls: c.seen.map((label) => call(label)),
            expect: { tools: c.entries, tool_order: order },
          })),
        );
        const issues = cases.flatMap((c, i) => {
          const want = REFERENCE[order](c.entries, c.seen) ? 'pass' : 'fail';
          const got = outcomeOfId(rec.blocks[i], 'tools.order');
          return got === want
            ? []
            : [
                `case ${i}: expected ${show(c.entries.map((e) => `${e.label}x${e.count}`))}, calls ${show(c.seen)}: tools.order should ${want}; got ${got}`,
              ];
        });
        const wants = cases.map((c) => REFERENCE[order](c.entries, c.seen));
        return expectAll([
          [wants.some(Boolean) && wants.some((w) => !w), 'the generated cases should hold both outcomes'],
          [
            issues.length === 0,
            say(D_TOOLS, `tool_order ${order} follows its documented rule`, issues[0] ?? ''),
          ],
        ]);
      }),
    );
  };
  differential(
    'exact-differential',
    4,
    'O1',
    'exact',
    'tool_order exact accepts the expected labels repeated by count, in order, and nothing else (14 seeded cases)',
  );
  differential(
    'in-order-differential',
    4,
    'O2',
    'in_order',
    'tool_order in_order accepts the expected labels as a subsequence of the calls (14 seeded cases)',
  );
  differential(
    'any-order-differential',
    4,
    'O3',
    'any_order',
    'tool_order any_order accepts any order of the expected labels, other calls allowed (14 seeded cases)',
  );

  out.push(
    item(
      FAMILY,
      'bk.checks.toolorder.in-order-repeated-labels',
      5,
      1,
      CHECKS,
      'O2',
      'in_order with a label expected twice in separate places needs the label before and after the other one',
      async (ctx) => {
        const id = 'bk.checks.toolorder.in-order-repeated-labels';
        const [a, b, x, y] = ['a', 'b', 'x', 'y'].map((k) => word(ctx.seed, `${id}:${k}`));
        const seqs: [string[], boolean][] = [
          [[a, b, a], true],
          [[a, a, b], false],
          [[b, a, a], false],
          [[a, x, b, y, a], true],
          [[a, b], false],
          [[a, b, a, a], true],
        ] as [string[], boolean][];
        const rec = await plain(
          ctx,
          id,
          seqs.map(([seq]) => ({
            text: 'Done.',
            calls: seq.map((label) => call(label)),
            expect: {
              tools: [
                { label: a, count: 1 },
                { label: b, count: 1 },
                { label: a, count: 1 },
              ],
              tool_order: 'in_order',
            },
          })),
        );
        const got = seqs.map((_, i) => outcomeOfId(rec.blocks[i], 'tools.order'));
        const want = seqs.map(([, ok]) => (ok ? 'pass' : 'fail'));
        return same(got, want)
          ? PASS
          : expectAll([[false, say(D_TOOLS, `in_order a, b, a: ${show(want)}`, show(got))]]);
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.checks.toolorder.any-order-needs-the-count',
      4,
      1,
      CHECKS,
      'O4',
      'in any_order a tool expected twice needs two calls of it',
      async (ctx) => {
        const id = 'bk.checks.toolorder.any-order-needs-the-count';
        const [a, b] = [word(ctx.seed, `${id}:a`), word(ctx.seed, `${id}:b`)];
        const seqs: [string[], boolean][] = [
          [[a, b], false],
          [[b, a, a], true],
          [[a, a], true],
          [[a], false],
        ];
        const rec = await plain(
          ctx,
          id,
          seqs.map(([seq]) => ({
            text: 'Done.',
            calls: seq.map((label) => call(label)),
            expect: { tools: [{ label: a, count: 2 }], tool_order: 'any_order' },
          })),
        );
        const got = seqs.map((_, i) => outcomeOfId(rec.blocks[i], 'tools.order'));
        const want = seqs.map(([, ok]) => (ok ? 'pass' : 'fail'));
        return same(got, want)
          ? PASS
          : expectAll([[false, say(D_TOOLS, `any_order with ${a} twice: ${show(want)}`, show(got))]]);
      },
    ),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * Verdict ids of repeated names
 * ---------------------------------------------------------------------------------------------------- */

function idItems(): BankItem[] {
  const out: BankItem[] = [];
  out.push(
    item(
      FAMILY,
      'bk.checks.ids.tool-label-twice',
      3,
      1,
      CHECKS,
      'D1',
      'a tool expected twice in a block gives the second entry the id suffix #2',
      async (ctx) => {
        const id = 'bk.checks.ids.tool-label-twice';
        const t = word(ctx.seed, `${id}:tool`);
        const rec = await plain(ctx, id, [
          {
            text: 'Done.',
            calls: [call(t)],
            expect: {
              tools: [
                { label: t, count: 1 },
                { label: t, count: { min: 1 } },
              ],
            },
          },
        ]);
        const ids = idsOf(rec.blocks[0]).filter((each) => each.startsWith('tools.'));
        return expectAll([
          [ids.includes(`tools.${t}.count`), say(D_VERDICTS, `${`tools.${t}.count`} exists`, show(ids))],
          [ids.includes(`tools.${t}#2.count`), say(D_VERDICTS, `${`tools.${t}#2.count`} exists`, show(ids))],
        ]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.checks.ids.tool-label-three-times',
      3,
      1,
      CHECKS,
      'D1',
      'three entries for one tool give the ids with no suffix, #2 and #3',
      async (ctx) => {
        const id = 'bk.checks.ids.tool-label-three-times';
        const t = word(ctx.seed, `${id}:tool`);
        const rec = await plain(ctx, id, [
          {
            text: 'Done.',
            calls: [call(t)],
            expect: {
              tools: [
                { label: t, count: 1 },
                { label: t, count: { min: 1 } },
                { label: t, count: { max: 5 } },
              ],
            },
          },
        ]);
        const ids = idsOf(rec.blocks[0]).filter(
          (each) => each.endsWith('.count') && each.startsWith('tools.'),
        );
        const want = [`tools.${t}.count`, `tools.${t}#2.count`, `tools.${t}#3.count`];
        return same([...ids].sort(), [...want].sort())
          ? PASS
          : expectAll([[false, say(D_VERDICTS, `the ids ${show(want)}`, show(ids))]]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.checks.ids.entries-judged-apart',
      4,
      1,
      CHECKS,
      'D2',
      'when the second of two entries for a tool fails only its verdict fails',
      async (ctx) => {
        const id = 'bk.checks.ids.entries-judged-apart';
        const t = word(ctx.seed, `${id}:tool`);
        const rec = await plain(ctx, id, [
          {
            text: 'Done.',
            calls: [call(t)],
            expect: {
              tools: [
                { label: t, count: 1 },
                { label: t, count: 5 },
              ],
            },
          },
        ]);
        const got = [
          outcomeOfId(rec.blocks[0], `tools.${t}.count`),
          outcomeOfId(rec.blocks[0], `tools.${t}#2.count`),
        ];
        return same(got, ['pass', 'fail'])
          ? PASS
          : expectAll([[false, say(D_VERDICTS, 'the first entry passes, the second fails', show(got))]]);
      },
    ),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * Exact text and numbers, patterns, presence, visible text
 * ---------------------------------------------------------------------------------------------------- */

function textItems(): BankItem[] {
  const out: BankItem[] = [];
  type Case = [reply: string, exact: string, pass: boolean];
  const exact = (
    id: string,
    tier: 3 | 4,
    cause: 'N1' | 'N2' | 'N3' | 'N4' | 'N5',
    title: string,
    cases: Case[],
  ) => {
    const full = `bk.checks.exact.${id}`;
    out.push(
      item(FAMILY, full, tier, 1, CHECKS, cause, title, async (ctx) => {
        const rec = await plain(
          ctx,
          full,
          cases.map(([reply, reference]) => ({ text: reply, expect: { exact: reference } })),
        );
        const got = cases.map((_, i) => outcomeOfId(rec.blocks[i], 'exact.0'));
        const want = cases.map(([, , pass]) => (pass ? 'pass' : 'fail'));
        const bad = want.findIndex((w, i) => w !== got[i]);
        return bad === -1
          ? PASS
          : expectAll([
              [
                false,
                say(
                  D_TEXT,
                  `reply "${cases[bad]?.[0]}" against exact "${cases[bad]?.[1]}" should ${want[bad]}`,
                  show(got),
                ),
              ],
            ]);
      }),
    );
  };
  exact('grouped-thousands', 4, 'N1', 'a strictly grouped thousands comma does not count in exact', [
    ['The total is 1,234,567', 'The total is 1234567', true],
    ['The total is 1,234', 'The total is 1234', true],
    ['The total is 1,234,568', 'The total is 1234567', false],
  ]);
  exact(
    'ungrouped-comma-counts',
    4,
    'N2',
    'a comma between digits that is not a thousands grouping counts in exact: 3,5 is neither 35 nor 3.5',
    [
      ['ratio 3,5', 'ratio 35', false],
      ['ratio 3,5', 'ratio 3.5', false],
      ['ratio 3,5', 'ratio 3,5', true],
    ],
  );
  exact(
    'trailing-zero-numbers',
    3,
    'N3',
    'two numbers compare as numbers in exact: 42.0 is 42 and 1.50 is 1.5',
    [
      ['42.0', '42', true],
      ['1.50', '1.5', true],
      ['42.1', '42', false],
    ],
  );
  exact('strict-grouping-is-three', 4, 'N4', 'a thousands grouping is groups of three: 12,34 is not 1234', [
    ['12,34', '1234', false],
    ['1,234', '1234', true],
  ]);
  exact('dot-between-digits', 4, 'N5', 'a dot between digits is a decimal point: 1.000 is 1, not 1000', [
    ['1.000', '1', true],
    ['1.000', '1000', false],
  ]);

  const rules = (matchCase: boolean) => (matchCase ? { rules: { match_case: true } } : {});
  const must = (
    id: string,
    tier: 3 | 4,
    cause: 'U1' | 'U2' | 'U3',
    title: string,
    run: (ctx: ItemContext, full: string) => Promise<ItemResult>,
  ) => {
    const full = `bk.checks.must.${id}`;
    out.push(item(FAMILY, full, tier, 1, CHECKS, cause, title, (ctx) => run(ctx, full)));
  };
  must(
    'trailing-punctuation-ignored',
    3,
    'U1',
    'by default a trailing punctuation mark does not count for must',
    async (ctx, full) => {
      const rec = await plain(ctx, full, [
        { text: 'fiber at 300 Mbps.', expect: { must: ['Mbps$'] } },
        { text: 'fiber at 300 Mbps!', expect: { must: ['mbps$'] } },
        { text: 'fiber at 300 Mbps and more', expect: { must: ['Mbps$'] } },
      ]);
      const got = [0, 1, 2].map((i) => outcomeOfId(rec.blocks[i], 'must.0'));
      return same(got, ['pass', 'pass', 'fail'])
        ? PASS
        : expectAll([[false, say(D_RULES, 'pass, pass, fail', show(got))]]);
    },
  );
  must(
    'match-case-counts-both',
    4,
    'U2',
    'with match_case both the case and a trailing punctuation mark count',
    async (ctx, full) => {
      const rec = await plain(
        ctx,
        full,
        [
          { text: 'fiber at 300 Mbps.', expect: { must: ['Mbps$'] } },
          { text: 'fiber at 300 Mbps', expect: { must: ['Mbps$'] } },
          { text: 'fiber at 300 Mbps', expect: { must: ['mbps$'] } },
        ],
        rules(true),
      );
      const got = [0, 1, 2].map((i) => outcomeOfId(rec.blocks[i], 'must.0'));
      return same(got, ['fail', 'pass', 'fail'])
        ? PASS
        : expectAll([[false, say(D_RULES, 'fail, pass, fail', show(got))]]);
    },
  );
  must(
    'word-boundary',
    3,
    'U3',
    'a word boundary around 300 does not match 3000, in either mode',
    async (ctx, full) => {
      const rows: Plain[] = [
        { text: 'speed 3000 Mbps', expect: { must: ['\\b300\\b'] } },
        { text: 'speed 300 Mbps', expect: { must: ['\\b300\\b'] } },
      ];
      const lax = await plain(ctx, `${full}:lax`, rows);
      const strict = await plain(ctx, `${full}:strict`, rows, rules(true));
      const outcomes = [lax, strict].flatMap((rec) =>
        [0, 1].map((i) => outcomeOfId(rec.blocks[i], 'must.0')),
      );
      return same(outcomes, ['fail', 'pass', 'fail', 'pass'])
        ? PASS
        : expectAll([[false, say(D_RULES, 'fail, pass in both modes', show(outcomes))]]);
    },
  );

  const presence = (
    id: string,
    tier: 3 | 4,
    cause: 'V1' | 'V2' | 'V3',
    title: string,
    cases: [unknown, boolean][],
  ) => {
    const full = `bk.checks.nonempty.${id}`;
    out.push(
      item(FAMILY, full, tier, 1, CHECKS, cause, title, async (ctx) => {
        const t = word(ctx.seed, `${full}:tool`);
        const rec = await plain(
          ctx,
          full,
          cases.map(([value]) => ({
            text: 'Done.',
            calls: [call(t, { n: value })],
            expect: { tools: [{ label: t, count: 1, input: { n: { nonempty: true } } }] },
          })),
        );
        const got = cases.map((_, i) => outcomeOfId(rec.blocks[i], `tools.${t}.input.n`));
        const want = cases.map(([, ok]) => (ok ? 'pass' : 'fail'));
        const bad = want.findIndex((w, i) => w !== got[i]);
        return bad === -1
          ? PASS
          : expectAll([
              [
                false,
                say(
                  D_VALUES,
                  `nonempty on ${JSON.stringify(cases[bad]?.[0])} should ${want[bad]}`,
                  show(got),
                ),
              ],
            ]);
      }),
    );
  };
  presence('falsy-values-are-present', 4, 'V1', 'nonempty holds for 0 and for false', [
    [0, true],
    [false, true],
    [1, true],
  ]);
  presence(
    'empty-forms',
    3,
    'V2',
    'nonempty fails an empty or blank text, an empty list and an empty mapping, and holds for a list with an item',
    [
      ['', false],
      ['   ', false],
      [[], false],
      [{}, false],
      [[0], true],
    ],
  );
  presence(
    'mapping-keys-hold-nothing',
    4,
    'V3',
    'nonempty fails a mapping whose keys hold nothing and holds for one that holds 0',
    [
      [{ a: null, b: null }, false],
      [{ a: null }, false],
      [{ a: 0 }, true],
    ],
  );

  out.push(
    item(
      FAMILY,
      'bk.checks.visible.segments-joined-by-a-line-break',
      3,
      1,
      CHECKS,
      'W1',
      'with no observed text the visible text is the text segments joined by a line break, and a pattern may span them',
      async (ctx) => {
        const id = 'bk.checks.visible.segments-joined-by-a-line-break';
        const [one, two] = [word(ctx.seed, `${id}:one`, 8), word(ctx.seed, `${id}:two`, 8)];
        const rec = await plain(ctx, id, [
          {
            text: '',
            expect: { must: [`${one}\n${two}`] },
            extra: observedParts([{ text: one }, { text: two }], { text: '' }),
          },
          {
            text: '',
            expect: { must: [`${two}\n${one}`] },
            extra: observedParts([{ text: one }, { text: two }], { text: '' }),
          },
        ]);
        const got = [0, 1].map((i) => outcomeOfId(rec.blocks[i], 'must.0'));
        return same(got, ['pass', 'fail'])
          ? PASS
          : expectAll([
              [false, say(D_TEXT, 'the segments joined in order match, the reverse does not', show(got))],
            ]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.checks.visible.text-field-wins',
      3,
      1,
      CHECKS,
      'W2',
      'a non-empty observed text is the visible text, whatever the segments say',
      async (ctx) => {
        const id = 'bk.checks.visible.text-field-wins';
        const [gamma, delta] = [word(ctx.seed, `${id}:gamma`, 8), word(ctx.seed, `${id}:delta`, 8)];
        const rec = await plain(ctx, id, [
          {
            text: gamma,
            expect: { must: [gamma] },
            extra: observedParts([{ text: delta }], { text: gamma }),
          },
          {
            text: gamma,
            expect: { must: [delta] },
            extra: observedParts([{ text: delta }], { text: gamma }),
          },
        ]);
        const got = [0, 1].map((i) => outcomeOfId(rec.blocks[i], 'must.0'));
        return same(got, ['pass', 'fail'])
          ? PASS
          : expectAll([[false, say(D_TEXT, 'the text field matches, the segment does not', show(got))]]);
      },
    ),
  );
  return out;
}

/** Items of the family bk-checks: 28. */
export function checkItems(): BankItem[] {
  return [...scoreItems(), ...orderItems(), ...idItems(), ...textItems()];
}
