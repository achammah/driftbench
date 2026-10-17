import {
  type BankItem,
  type Call,
  exec,
  expectNone,
  expectPass,
  expectV,
  type ItemContext,
  idsAt,
  type Probe,
  type Row,
  tok,
  variants,
  verdict,
  withDefaults,
} from './kit';

/**
 * gr-runtime: what the checks read from the runtime trace (skills, guards, references, subagents, the offered
 * tools) and the run-wide tool policy of docs/reference/checks.md "Tools, skills, guards, references and
 * subagents" and "Rules on tools". Every item plants a trace whose truth is known by construction and a twin the
 * rule fails.
 */

const FAMILY = 'gr-runtime';
const CHECKS = 'packages/checks';
const P = 'gr.checks.runtime';

type Trace = Record<string, unknown>;
const withTrace = (runtime: Trace, expect: Record<string, unknown>): Row => ({ extra: { runtime }, expect });
const names = (n: number, ctx: ItemContext, tag: string): string[] =>
  Array.from({ length: n }, (_, k) => tok(ctx, tag, `n${k}`, 7));

/** Blocks that each load the skill `name` the listed number of times, all under one expectation. */
function skillRows(name: string, loads: number[], expect: Record<string, unknown>): Row[] {
  return loads.map((n) => withTrace({ skills: Array.from({ length: n }, () => ({ name })) }, expect));
}

function skillItems(): BankItem[] {
  return [
    ...variants(FAMILY, `${P}.skills`, CHECKS, 'skills-by-name-count', [
      [
        'exact-count',
        3,
        'a skill expected a number of times passes at that number and fails one more or one fewer',
        async (ctx) => {
          const tag = `${P}.skills.exact`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, skillRows(a, [1, 2, 3], { skills: [{ name: a, count: 2 }] }));
          return [
            expectV(rec, 0, `skills.${a}`, 'fail', true),
            expectV(rec, 1, `skills.${a}`, 'pass', true),
            expectV(rec, 2, `skills.${a}`, 'fail', true),
          ];
        },
      ],
      [
        'range-both-bounds-inclusive',
        3,
        'a skill expected between a min and a max passes at both bounds and fails outside them',
        async (ctx) => {
          const tag = `${P}.skills.range`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(
            ctx,
            tag,
            skillRows(a, [1, 2, 3, 4], { skills: [{ name: a, count: { min: 2, max: 3 } }] }),
          );
          return (['fail', 'pass', 'pass', 'fail'] as const).map((want, i) =>
            expectV(rec, i, `skills.${a}`, want, true),
          );
        },
      ],
      [
        'each-name-has-its-own-verdict',
        3,
        'two skills expected in one block each get their own verdict; the one not loaded fails alone',
        async (ctx) => {
          const tag = `${P}.skills.two`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            withTrace({ skills: [{ name: a }] }, { skills: [{ name: a }, { name: b }] }),
          ]);
          return [
            expectV(rec, 0, `skills.${a}`, 'pass', true),
            expectV(rec, 0, `skills.${b}`, 'fail', true),
            expectPass(rec, 0, false),
          ];
        },
      ],
      [
        'order-is-not-checked',
        3,
        'skills loaded in the opposite order of the expectation still pass',
        async (ctx) => {
          const tag = `${P}.skills.order`;
          const [a, b, c] = names(3, ctx, tag) as [string, string, string];
          const rec = await exec(ctx, tag, [
            withTrace(
              { skills: [{ name: c }, { name: b }, { name: a }] },
              { skills: [{ name: a }, { name: b }, { name: c }] },
            ),
          ]);
          return [a, b, c].map((n) => expectV(rec, 0, `skills.${n}`, 'pass', true));
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.skills-none`, CHECKS, 'skills-absent-list-none', [
      [
        'count-zero-passes',
        3,
        'a trace without a skills list loaded no skill: a skill expected 0 times passes',
        async (ctx) => {
          const tag = `${P}.skills-none.zero`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [withTrace({ guards: [] }, { skills: [{ name: a, count: 0 }] })]);
          return [expectV(rec, 0, `skills.${a}`, 'pass', true), expectPass(rec, 0, true)];
        },
      ],
      [
        'default-count-fails-not-inconclusive',
        3,
        'a trace without a skills list loaded no skill: a skill expected at least once fails, it is not inconclusive',
        async (ctx) => {
          const tag = `${P}.skills-none.default`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [withTrace({ references: [] }, { skills: [{ name: a }] })]);
          return [expectV(rec, 0, `skills.${a}`, 'fail', true)];
        },
      ],
      [
        'max-zero-and-min-one',
        4,
        'a trace without a skills list gives count 0 for {max: 0} and for {min: 0}, and 0 is below {min: 1}',
        async (ctx) => {
          const tag = `${P}.skills-none.range`;
          const [a, b, c] = names(3, ctx, tag) as [string, string, string];
          const rec = await exec(ctx, tag, [
            withTrace(
              { subagents: [] },
              {
                skills: [
                  { name: a, count: { max: 0 } },
                  { name: b, count: { min: 0 } },
                  { name: c, count: { min: 1 } },
                ],
              },
            ),
          ]);
          return [
            expectV(rec, 0, `skills.${a}`, 'pass'),
            expectV(rec, 0, `skills.${b}`, 'pass'),
            expectV(rec, 0, `skills.${c}`, 'fail'),
          ];
        },
      ],
    ]),
  ];
}

function guardItems(): BankItem[] {
  const fired = (g: string, ...verdicts: string[]) => verdicts.map((v) => ({ name: g, verdict: v }));
  return [
    ...variants(FAMILY, `${P}.guards-verdict`, CHECKS, 'guards-narrow-by-verdict', [
      [
        'verdict-counts-only-that-verdict',
        3,
        'a guard entry with a verdict counts only the firings that gave that verdict',
        async (ctx) => {
          const tag = `${P}.guards-verdict.only`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace(
              { guards: fired(g, 'deny', 'pass', 'pass') },
              { guards: [{ name: g, verdict: 'pass', count: 2 }] },
            ),
            withTrace(
              { guards: fired(g, 'deny', 'pass', 'pass') },
              { guards: [{ name: g, verdict: 'deny', count: 2 }] },
            ),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.pass`, 'pass', true),
            expectV(rec, 1, `guards.${g}.deny`, 'fail', true),
          ];
        },
      ],
      [
        'no-verdict-counts-every-firing',
        3,
        'a guard entry with no verdict counts every firing of the guard, whatever its verdict',
        async (ctx) => {
          const tag = `${P}.guards-verdict.any`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ guards: fired(g, 'deny', 'pass', 'ask') }, { guards: [{ name: g, count: 3 }] }),
            withTrace({ guards: fired(g, 'deny', 'pass', 'ask') }, { guards: [{ name: g, count: 2 }] }),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.any`, 'pass', true),
            expectV(rec, 1, `guards.${g}.any`, 'fail', true),
          ];
        },
      ],
      [
        'another-guard-is-not-counted',
        3,
        'the firings of another guard never count for the guard an entry names',
        async (ctx) => {
          const tag = `${P}.guards-verdict.other`;
          const [g, h] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            withTrace({ guards: fired(h, 'deny', 'deny') }, { guards: [{ name: g, count: { min: 1 } }] }),
            withTrace(
              { guards: [...fired(h, 'deny'), ...fired(g, 'deny')] },
              { guards: [{ name: g, count: 1 }] },
            ),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.any`, 'fail', true),
            expectV(rec, 1, `guards.${g}.any`, 'pass', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.guards-ids`, CHECKS, 'guards-id-forms', [
      [
        'verdict-in-the-id',
        3,
        'an entry with a verdict has the id guards.<name>.<verdict>',
        async (ctx) => {
          const tag = `${P}.guards-ids.verdict`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ guards: fired(g, 'deny') }, { guards: [{ name: g, verdict: 'deny' }] }),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.deny`, 'pass', true),
            idsAt(rec, 0).includes(`guards.${g}.any`)
              ? 'an entry with a verdict should not be .any'
              : undefined,
          ];
        },
      ],
      [
        'any-without-a-verdict',
        3,
        'an entry without a verdict has the id guards.<name>.any',
        async (ctx) => {
          const tag = `${P}.guards-ids.any`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ guards: fired(g, 'deny') }, { guards: [{ name: g }] }),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.any`, 'pass', true),
            idsAt(rec, 0).includes(`guards.${g}.deny`)
              ? 'an entry without a verdict should not be named by a verdict'
              : undefined,
          ];
        },
      ],
      [
        'two-verdicts-of-one-guard-are-two-ids',
        4,
        'two entries for one guard with different verdicts have two ids and no #2',
        async (ctx) => {
          const tag = `${P}.guards-ids.two`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace(
              { guards: fired(g, 'deny', 'pass') },
              {
                guards: [
                  { name: g, verdict: 'deny' },
                  { name: g, verdict: 'pass', count: 2 },
                ],
              },
            ),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.deny`, 'pass', true),
            expectV(rec, 0, `guards.${g}.pass`, 'fail', true),
            idsAt(rec, 0).some((id) => id.includes('#'))
              ? 'entries of different verdicts do not repeat a name: no #2'
              : undefined,
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.guards-zero`, CHECKS, 'guards-count-zero', [
      [
        'must-not-fire',
        3,
        'a guard expected 0 times passes when it did not fire and fails when it fired',
        async (ctx) => {
          const tag = `${P}.guards-zero.fire`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ guards: [] }, { guards: [{ name: g, count: 0 }] }),
            withTrace({ guards: fired(g, 'pass') }, { guards: [{ name: g, count: 0 }] }),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.any`, 'pass', true),
            expectV(rec, 1, `guards.${g}.any`, 'fail', true),
          ];
        },
      ],
      [
        'must-not-give-that-verdict',
        3,
        'a guard expected 0 times with a verdict fails only when it gave that verdict',
        async (ctx) => {
          const tag = `${P}.guards-zero.verdict`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace(
              { guards: fired(g, 'pass', 'pass') },
              { guards: [{ name: g, verdict: 'deny', count: 0 }] },
            ),
            withTrace(
              { guards: fired(g, 'pass', 'deny') },
              { guards: [{ name: g, verdict: 'deny', count: 0 }] },
            ),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.deny`, 'pass', true),
            expectV(rec, 1, `guards.${g}.deny`, 'fail', true),
          ];
        },
      ],
      [
        'upper-bound-of-zero',
        4,
        'a guard expected {max: 0} behaves as 0 times',
        async (ctx) => {
          const tag = `${P}.guards-zero.max`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ guards: [] }, { guards: [{ name: g, verdict: 'deny', count: { max: 0 } }] }),
            withTrace(
              { guards: fired(g, 'deny') },
              { guards: [{ name: g, verdict: 'deny', count: { max: 0 } }] },
            ),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.deny`, 'pass', true),
            expectV(rec, 1, `guards.${g}.deny`, 'fail', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.guards-none`, CHECKS, 'guards-absent-list-fired-none', [
      [
        'count-zero-passes',
        3,
        'a trace without a guards list fired no guard: a guard expected 0 times passes',
        async (ctx) => {
          const tag = `${P}.guards-none.zero`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ skills: [] }, { guards: [{ name: g, verdict: 'deny', count: 0 }] }),
          ]);
          return [expectV(rec, 0, `guards.${g}.deny`, 'pass', true)];
        },
      ],
      [
        'default-count-fails',
        3,
        'a trace without a guards list fired no guard: a guard expected at least once fails, it is not inconclusive',
        async (ctx) => {
          const tag = `${P}.guards-none.default`;
          const [g] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [withTrace({ skills: [] }, { guards: [{ name: g }] })]);
          return [expectV(rec, 0, `guards.${g}.any`, 'fail', true)];
        },
      ],
      [
        'empty-list-is-the-same',
        3,
        'an empty guards list fires no guard either: 0 passes and at least one fails',
        async (ctx) => {
          const tag = `${P}.guards-none.empty`;
          const [g, h] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            withTrace({ guards: [] }, { guards: [{ name: g, count: 0 }, { name: h }] }),
          ]);
          return [
            expectV(rec, 0, `guards.${g}.any`, 'pass', true),
            expectV(rec, 0, `guards.${h}.any`, 'fail', true),
          ];
        },
      ],
    ]),
  ];
}

/** One block per read list, all under the same path expectation: the outcome of each is returned. */
async function readsOutcomes(
  ctx: ItemContext,
  tag: string,
  entry: Record<string, unknown>,
  reads: string[][],
): Promise<{ rec: Awaited<ReturnType<typeof exec>>; id: string }> {
  const rec = await exec(
    ctx,
    tag,
    reads.map((paths) => withTrace({ references: paths.map((path) => ({ path })) }, { references: [entry] })),
  );
  return { rec, id: `references.${entry.path}` };
}

function referenceItems(): BankItem[] {
  const f = (
    suite: string,
    id: string,
    title: string,
    glob: (a: string) => string,
    cases: (a: string) => [string[], 'pass' | 'fail'][],
    count?: number,
  ): readonly [string, 3 | 4, string, Probe] => [
    id,
    3,
    title,
    async (ctx) => {
      const tag = `${P}.${suite}.${id}`;
      const [a] = names(1, ctx, tag) as [string];
      const list = cases(a);
      const { rec, id: vid } = await readsOutcomes(
        ctx,
        tag,
        { path: glob(a), ...(count !== undefined ? { count } : {}) },
        list.map(([paths]) => paths),
      );
      return list.map(([, want], i) => expectV(rec, i, vid, want, true));
    },
  ];
  return [
    ...variants(FAMILY, `${P}.ref-star`, CHECKS, 'references-glob-star', [
      f(
        'ref-star',
        'folder-star',
        'a * in a reference glob matches within one folder: docs/*.md matches docs/x.md',
        () => 'docs/*.md',
        (a) => [
          [[`docs/${a}.md`], 'pass'],
          [[`docs/${a}/${a}.md`], 'fail'],
          [[`other/${a}.md`], 'fail'],
        ],
      ),
      f(
        'ref-star',
        'star-inside-a-name',
        'a * can stand for part of a file name: docs/<a>*.md matches docs/<a>-more.md',
        (a) => `docs/${a}*.md`,
        (a) => [
          [[`docs/${a}-more.md`], 'pass'],
          [[`docs/${a}.md`], 'pass'],
          [[`docs/x${a}.md`], 'fail'],
        ],
      ),
      f(
        'ref-star',
        'star-does-not-cross-a-folder',
        'a * does not cross a folder: a/*/c.md matches a/x/c.md and not a/x/y/c.md',
        (a) => `${a}/*/c.md`,
        (a) => [
          [[`${a}/x/c.md`], 'pass'],
          [[`${a}/x/y/c.md`], 'fail'],
        ],
      ),
    ]),
    ...variants(FAMILY, `${P}.ref-double`, CHECKS, 'references-glob-double-star', [
      f(
        'ref-double',
        'across-folders',
        'a ** in a reference glob matches across folders: docs/**/guide.md matches docs/a/b/guide.md',
        (a) => `docs/**/${a}.md`,
        (a) => [
          [[`docs/x/y/${a}.md`], 'pass'],
          [[`docs/x/${a}.md`], 'pass'],
          [[`other/x/${a}.md`], 'fail'],
        ],
      ),
      f(
        'ref-double',
        'leading-double-star',
        'a leading ** matches a path at any depth: **/<a>.md',
        (a) => `**/${a}.md`,
        (a) => [
          [[`p/q/r/${a}.md`], 'pass'],
          [[`p/${a}.md`], 'pass'],
          [[`p/${a}.txt`], 'fail'],
        ],
      ),
      f(
        'ref-double',
        'double-star-then-star',
        'a ** and a * together: skills/**/ref/*.md',
        (a) => `skills/**/${a}/*.md`,
        (a) => [
          [[`skills/x/y/${a}/z.md`], 'pass'],
          [[`skills/x/${a}/z/w.md`], 'fail'],
          [[`skills/x/y/${a}/z.txt`], 'fail'],
        ],
      ),
    ]),
    ...variants(FAMILY, `${P}.ref-question`, CHECKS, 'references-glob-question', [
      f(
        'ref-question',
        'one-character',
        'a ? in a reference glob matches one character: <a>?.md matches <a>1.md',
        (a) => `docs/${a}?.md`,
        (a) => [
          [[`docs/${a}1.md`], 'pass'],
          [[`docs/${a}.md`], 'fail'],
          [[`docs/${a}12.md`], 'fail'],
        ],
      ),
      f(
        'ref-question',
        'in-the-middle',
        'a ? stands for exactly one character in the middle of a name',
        (a) => `docs/${a.slice(0, 3)}?${a.slice(4)}.md`,
        (a) => [
          [[`docs/${a}.md`], 'pass'],
          [[`docs/${a.slice(0, 3)}${a.slice(4)}.md`], 'fail'],
          [[`docs/${a.slice(0, 3)}ab${a.slice(4)}.md`], 'fail'],
        ],
      ),
      f(
        'ref-question',
        'two-question-marks',
        'two ? stand for exactly two characters',
        (a) => `docs/${a}??.md`,
        (a) => [
          [[`docs/${a}12.md`], 'pass'],
          [[`docs/${a}1.md`], 'fail'],
          [[`docs/${a}123.md`], 'fail'],
        ],
      ),
    ]),
    ...variants(FAMILY, `${P}.ref-count`, CHECKS, 'references-count', [
      f(
        'ref-count',
        'default-at-least-one',
        'a reference without count needs at least one matching read',
        (a) => `docs/${a}.md`,
        (a) => [
          [[`docs/${a}.md`], 'pass'],
          [[`docs/${a}.md`, `docs/${a}.md`], 'pass'],
          [[`docs/other.md`], 'fail'],
          [[], 'fail'],
        ],
      ),
      f(
        'ref-count',
        'zero-means-not-read',
        'a reference with count 0 means the file must not be read',
        (a) => `docs/${a}.md`,
        (a) => [
          [[`docs/${a}.md`], 'fail'],
          [[`docs/other.md`], 'pass'],
          [[], 'pass'],
        ],
        0,
      ),
      f(
        'ref-count',
        'glob-counts-every-matching-read',
        'a glob with count 2 counts the reads of every file it matches',
        (a) => `docs/${a}-*.md`,
        (a) => [
          [[`docs/${a}-1.md`, `docs/${a}-2.md`], 'pass'],
          [[`docs/${a}-1.md`], 'fail'],
          [[`docs/${a}-1.md`, `docs/${a}-2.md`, `docs/${a}-3.md`], 'fail'],
        ],
        2,
      ),
      [
        'failing-verdict-lists-the-files-read',
        3,
        'a failing reference verdict names the path and lists the files the block read',
        async (ctx: ItemContext) => {
          const tag = `${P}.ref-count.lists`;
          const [a, b, c] = names(3, ctx, tag) as [string, string, string];
          const rec = await exec(ctx, tag, [
            withTrace(
              { references: [{ path: `docs/${b}.md` }, { path: `docs/${c}.md` }] },
              { references: [{ path: `docs/${a}.md` }] },
            ),
          ]);
          const found = verdict(rec, 0, `references.docs/${a}.md`);
          const text = String(found?.evidence ?? '');
          return [
            expectV(rec, 0, `references.docs/${a}.md`, 'fail', true),
            text.includes(`docs/${a}.md`)
              ? undefined
              : `the evidence does not name the path docs/${a}.md: ${text.slice(0, 140)}`,
            [b, c].every((x) => text.includes(`docs/${x}.md`))
              ? undefined
              : `the evidence does not list the files read: ${text.slice(0, 160)}`,
          ];
        },
      ],
    ] as unknown as ReadonlyArray<readonly [string, 3 | 4, string, Probe]>),
    ...variants(FAMILY, `${P}.absent`, CHECKS, 'trace-lists-absent-not-checked', [
      [
        'references-absent',
        3,
        'a trace without a references list does not apply the references check; an empty list does',
        async (ctx) => {
          const tag = `${P}.absent.references`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ skills: [] }, { references: [{ path: `docs/${a}.md` }] }),
            withTrace({ references: [] }, { references: [{ path: `docs/${a}.md` }] }),
          ]);
          return [
            expectNone(rec, 0, 'references'),
            expectPass(rec, 0, true),
            expectV(rec, 1, `references.docs/${a}.md`, 'fail', true),
          ];
        },
      ],
      [
        'subagents-absent',
        3,
        'a trace without a subagents list does not apply the subagents check; an empty list does',
        async (ctx) => {
          const tag = `${P}.absent.subagents`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ skills: [] }, { subagents: [{ name: a }] }),
            withTrace({ subagents: [] }, { subagents: [{ name: a }] }),
          ]);
          return [
            expectNone(rec, 0, 'subagents'),
            expectPass(rec, 0, true),
            expectV(rec, 1, `subagents.${a}`, 'fail', true),
          ];
        },
      ],
      [
        'no-trace-at-all',
        3,
        'a block with no runtime trace does not apply the references check or the subagents check',
        async (ctx) => {
          const tag = `${P}.absent.none`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            { expect: { references: [{ path: `docs/${a}.md` }], subagents: [{ name: a }] } },
          ]);
          return [
            expectNone(rec, 0, 'references'),
            expectNone(rec, 0, 'subagents'),
            expectPass(rec, 0, true),
          ];
        },
      ],
    ]),
  ];
}

function subagentItems(): BankItem[] {
  const made = (l: { name: string; model?: string }[]) => ({ subagents: l });
  return [
    ...variants(FAMILY, `${P}.subagents`, CHECKS, 'subagents-name-and-model', [
      [
        'the-model-narrows-the-entry',
        3,
        'a helper entry with a model counts only the dispatches on that model',
        async (ctx) => {
          const tag = `${P}.subagents.model`;
          const [h, m1, m2, m3] = names(4, ctx, tag) as [string, string, string, string];
          const rec = await exec(ctx, tag, [
            withTrace(
              made([
                { name: h, model: m1 },
                { name: h, model: m2 },
              ]),
              { subagents: [{ name: h, model: m1, count: 1 }] },
            ),
            withTrace(
              made([
                { name: h, model: m1 },
                { name: h, model: m2 },
              ]),
              { subagents: [{ name: h, model: m3 }] },
            ),
          ]);
          return [
            expectV(rec, 0, `subagents.${h}.${m1}`, 'pass', true),
            expectV(rec, 1, `subagents.${h}.${m3}`, 'fail', true),
          ];
        },
      ],
      [
        'no-model-counts-every-dispatch',
        3,
        'a helper entry with no model counts every dispatch of the helper, whatever its model',
        async (ctx) => {
          const tag = `${P}.subagents.any`;
          const [h, m1, m2] = names(3, ctx, tag) as [string, string, string];
          const rec = await exec(ctx, tag, [
            withTrace(made([{ name: h, model: m1 }, { name: h, model: m2 }, { name: h }]), {
              subagents: [{ name: h, count: 3 }],
            }),
            withTrace(
              made([
                { name: h, model: m1 },
                { name: h, model: m2 },
              ]),
              { subagents: [{ name: h, count: 3 }] },
            ),
          ]);
          return [
            expectV(rec, 0, `subagents.${h}`, 'pass', true),
            expectV(rec, 1, `subagents.${h}`, 'fail', true),
          ];
        },
      ],
      [
        'the-failing-verdict-lists-the-helpers-with-models',
        4,
        'a failing helper verdict names the helper and lists the helpers dispatched with their models',
        async (ctx) => {
          const tag = `${P}.subagents.lists`;
          const [h, other, m1] = names(3, ctx, tag) as [string, string, string];
          const rec = await exec(ctx, tag, [
            withTrace(made([{ name: other, model: m1 }]), { subagents: [{ name: h }] }),
          ]);
          const text = String(verdict(rec, 0, `subagents.${h}`)?.evidence ?? '');
          return [
            expectV(rec, 0, `subagents.${h}`, 'fail', true),
            text.includes(h)
              ? undefined
              : `the evidence does not name the helper ${h}: ${text.slice(0, 150)}`,
            text.includes(other) && text.includes(m1)
              ? undefined
              : `the evidence does not list the helper ${other} with its model ${m1}: ${text.slice(0, 160)}`,
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.subagents-zero`, CHECKS, 'subagents-count-zero', [
      [
        'must-not-be-dispatched',
        3,
        'a helper expected 0 times passes when it was not dispatched and fails when it was',
        async (ctx) => {
          const tag = `${P}.subagents-zero.plain`;
          const [h, o] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            withTrace(made([{ name: o }]), { subagents: [{ name: h, count: 0 }] }),
            withTrace(made([{ name: h }]), { subagents: [{ name: h, count: 0 }] }),
          ]);
          return [
            expectV(rec, 0, `subagents.${h}`, 'pass', true),
            expectV(rec, 1, `subagents.${h}`, 'fail', true),
          ];
        },
      ],
      [
        'with-a-model',
        3,
        'a helper expected 0 times on one model fails only when it ran on that model',
        async (ctx) => {
          const tag = `${P}.subagents-zero.model`;
          const [h, m1, m2] = names(3, ctx, tag) as [string, string, string];
          const rec = await exec(ctx, tag, [
            withTrace(made([{ name: h, model: m2 }]), { subagents: [{ name: h, model: m1, count: 0 }] }),
            withTrace(made([{ name: h, model: m1 }]), { subagents: [{ name: h, model: m1, count: 0 }] }),
          ]);
          return [
            expectV(rec, 0, `subagents.${h}.${m1}`, 'pass', true),
            expectV(rec, 1, `subagents.${h}.${m1}`, 'fail', true),
          ];
        },
      ],
      [
        'an-empty-list',
        3,
        'an empty subagents list dispatched nothing: 0 passes and at least one fails',
        async (ctx) => {
          const tag = `${P}.subagents-zero.empty`;
          const [h, g] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            withTrace(made([]), { subagents: [{ name: h, count: 0 }, { name: g }] }),
          ]);
          return [
            expectV(rec, 0, `subagents.${h}`, 'pass', true),
            expectV(rec, 0, `subagents.${g}`, 'fail', true),
          ];
        },
      ],
    ]),
  ];
}

function offeredItems(): BankItem[] {
  return [
    ...variants(FAMILY, `${P}.offered`, CHECKS, 'offered-include-exclude', [
      [
        'include-and-exclude-ids',
        3,
        'an include tool that is offered and an exclude tool that is not both pass, with their own ids',
        async (ctx) => {
          const tag = `${P}.offered.ids`;
          const [a, b, c] = names(3, ctx, tag) as [string, string, string];
          const rec = await exec(ctx, tag, [
            withTrace({ offered: [a, b] }, { tools_offered: { include: [a, b], exclude: [c] } }),
          ]);
          return [
            expectV(rec, 0, `tools_offered.include.${a}`, 'pass', true),
            expectV(rec, 0, `tools_offered.include.${b}`, 'pass', true),
            expectV(rec, 0, `tools_offered.exclude.${c}`, 'pass', true),
          ];
        },
      ],
      [
        'a-missing-include-fails',
        3,
        'an include tool that is not offered fails alone; the offered one passes',
        async (ctx) => {
          const tag = `${P}.offered.include`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            withTrace({ offered: [a] }, { tools_offered: { include: [a, b] } }),
          ]);
          return [
            expectV(rec, 0, `tools_offered.include.${a}`, 'pass', true),
            expectV(rec, 0, `tools_offered.include.${b}`, 'fail', true),
            expectPass(rec, 0, false),
          ];
        },
      ],
      [
        'an-offered-exclude-fails',
        3,
        'an exclude tool that is offered fails alone; the one not offered passes',
        async (ctx) => {
          const tag = `${P}.offered.exclude`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            withTrace({ offered: [a] }, { tools_offered: { exclude: [a, b] } }),
          ]);
          return [
            expectV(rec, 0, `tools_offered.exclude.${a}`, 'fail', true),
            expectV(rec, 0, `tools_offered.exclude.${b}`, 'pass', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.offered-calls`, CHECKS, 'offered-calls-do-not-count', [
      [
        'called-but-not-offered',
        4,
        'a tool the agent called but the runtime did not offer does not satisfy include',
        async (ctx) => {
          const tag = `${P}.offered-calls.called`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            {
              calls: [{ label: a, input: {} }],
              extra: { runtime: { offered: [b] } },
              expect: { tools_offered: { include: [a] } },
            },
          ]);
          return [expectV(rec, 0, `tools_offered.include.${a}`, 'fail', true)];
        },
      ],
      [
        'offered-but-never-called',
        3,
        'a tool the runtime offered but the agent never called satisfies include and fails exclude',
        async (ctx) => {
          const tag = `${P}.offered-calls.silent`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [
            withTrace({ offered: [a] }, { tools_offered: { include: [a] } }),
            withTrace({ offered: [a] }, { tools_offered: { exclude: [a] } }),
          ]);
          return [
            expectV(rec, 0, `tools_offered.include.${a}`, 'pass', true),
            expectV(rec, 1, `tools_offered.exclude.${a}`, 'fail', true),
          ];
        },
      ],
      [
        'called-and-excluded',
        4,
        'a tool that was called but not offered passes exclude: the offered list decides, not the calls',
        async (ctx) => {
          const tag = `${P}.offered-calls.excluded`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [
            {
              calls: [{ label: a, input: {} }],
              extra: { runtime: { offered: [b] } },
              expect: { tools_offered: { exclude: [a] } },
            },
          ]);
          return [expectV(rec, 0, `tools_offered.exclude.${a}`, 'pass', true)];
        },
      ],
    ]),
  ];
}

/* ------------------------------------------------------------------------------------------------------
 * The run-wide tool policy
 * ---------------------------------------------------------------------------------------------------- */

type Rule = { pattern: string; action: 'allow' | 'deny' | 'ask' };

async function policyRun(ctx: ItemContext, tag: string, rules: Rule[], calls: string[][]) {
  const rows: Row[] = calls.map((labels) => ({ calls: labels.map((label): Call => ({ label, input: {} })) }));
  return exec(ctx, tag, rows, { checks: withDefaults({ toolPolicy: rules }) });
}

function policyItems(): BankItem[] {
  const denied = (rec: Awaited<ReturnType<typeof exec>>, i: number, label: string) =>
    expectV(rec, i, `tool_policy.${label}`, 'fail', true);
  const allowed = (rec: Awaited<ReturnType<typeof exec>>, i: number, label: string) => {
    const found = verdict(rec, i, `tool_policy.${label}`);
    return found && found.outcome !== 'pass'
      ? `block ${i}: ${label} is allowed and should not fail tool_policy (${found.outcome})`
      : undefined;
  };
  return [
    ...variants(FAMILY, `${P}.policy-first`, CHECKS, 'policy-first-match-decides', [
      [
        'allow-before-deny',
        3,
        'the first rule that matches a call decides: an allow before a deny-all lets its tool through',
        async (ctx) => {
          const tag = `${P}.policy-first.allow`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await policyRun(
            ctx,
            tag,
            [
              { pattern: a, action: 'allow' },
              { pattern: '*', action: 'deny' },
            ],
            [[a], [b]],
          );
          return [allowed(rec, 0, a), expectPass(rec, 0, true), denied(rec, 1, b), expectPass(rec, 1, false)];
        },
      ],
      [
        'deny-before-allow',
        3,
        'a deny before an allow for the same tool denies it',
        async (ctx) => {
          const tag = `${P}.policy-first.deny`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await policyRun(
            ctx,
            tag,
            [
              { pattern: a, action: 'deny' },
              { pattern: a, action: 'allow' },
            ],
            [[a]],
          );
          return [denied(rec, 0, a), expectPass(rec, 0, false)];
        },
      ],
      [
        'later-rules-never-undo',
        4,
        'a later allow never undoes an earlier deny, and a later deny never undoes an earlier allow',
        async (ctx) => {
          const tag = `${P}.policy-first.later`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await policyRun(
            ctx,
            tag,
            [
              { pattern: a, action: 'deny' },
              { pattern: b, action: 'allow' },
              { pattern: '*', action: 'allow' },
              { pattern: b, action: 'deny' },
            ],
            [[a, b]],
          );
          return [denied(rec, 0, a), allowed(rec, 0, b), expectPass(rec, 0, false)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.policy-open`, CHECKS, 'policy-unmatched-allowed', [
      [
        'no-rule-matches',
        3,
        'a call no rule matches is allowed',
        async (ctx) => {
          const tag = `${P}.policy-open.nomatch`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await policyRun(ctx, tag, [{ pattern: a, action: 'deny' }], [[b], [a]]);
          return [allowed(rec, 0, b), expectPass(rec, 0, true), denied(rec, 1, a)];
        },
      ],
      [
        'only-allow-rules',
        3,
        'with allow rules only, a tool they do not name is still allowed',
        async (ctx) => {
          const tag = `${P}.policy-open.allowonly`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await policyRun(ctx, tag, [{ pattern: a, action: 'allow' }], [[a, b]]);
          return [allowed(rec, 0, a), allowed(rec, 0, b), expectPass(rec, 0, true)];
        },
      ],
      [
        'empty-policy',
        3,
        'an empty policy allows every call',
        async (ctx) => {
          const tag = `${P}.policy-open.empty`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await policyRun(ctx, tag, [], [[a]]);
          return [allowed(rec, 0, a), expectPass(rec, 0, true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.policy-ask`, CHECKS, 'policy-ask-is-a-denial', [
      [
        'ask-denies',
        3,
        'an ask rule denies the call: nothing answers it',
        async (ctx) => {
          const tag = `${P}.policy-ask.deny`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await policyRun(ctx, tag, [{ pattern: a, action: 'ask' }], [[a]]);
          return [denied(rec, 0, a), expectPass(rec, 0, false)];
        },
      ],
      [
        'ask-and-deny-read-the-same',
        3,
        'an ask rule and a deny rule give the same outcome for their tools',
        async (ctx) => {
          const tag = `${P}.policy-ask.same`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await policyRun(
            ctx,
            tag,
            [
              { pattern: a, action: 'ask' },
              { pattern: b, action: 'deny' },
            ],
            [[a, b]],
          );
          return [denied(rec, 0, a), denied(rec, 0, b)];
        },
      ],
      [
        'ask-first-then-allow',
        4,
        'an ask that matches first denies even when an allow for the same tool follows',
        async (ctx) => {
          const tag = `${P}.policy-ask.first`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await policyRun(
            ctx,
            tag,
            [
              { pattern: a, action: 'ask' },
              { pattern: '*', action: 'allow' },
            ],
            [[a]],
          );
          return [denied(rec, 0, a)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.policy-glob`, CHECKS, 'policy-glob-star', [
      [
        'prefix',
        3,
        'a * at the end of a pattern stands for any run of characters: <p>* matches <p>read and <p>',
        async (ctx) => {
          const tag = `${P}.policy-glob.prefix`;
          const [p, q] = names(2, ctx, tag) as [string, string];
          const rec = await policyRun(
            ctx,
            tag,
            [{ pattern: `${p}*`, action: 'deny' }],
            [[`${p}read`, `${p}`, `${q}${p}`]],
          );
          return [denied(rec, 0, `${p}read`), denied(rec, 0, p), allowed(rec, 0, `${q}${p}`)];
        },
      ],
      [
        'suffix',
        3,
        'a * at the start of a pattern: *<s> matches read<s> and <s> and not <s>x',
        async (ctx) => {
          const tag = `${P}.policy-glob.suffix`;
          const [s] = names(1, ctx, tag) as [string];
          const rec = await policyRun(
            ctx,
            tag,
            [{ pattern: `*${s}`, action: 'deny' }],
            [[`read${s}`, s, `${s}x`]],
          );
          return [denied(rec, 0, `read${s}`), denied(rec, 0, s), allowed(rec, 0, `${s}x`)];
        },
      ],
      [
        'middle-and-alone',
        4,
        'a * in the middle matches any run between the two parts, and a lone * matches every tool',
        async (ctx) => {
          const tag = `${P}.policy-glob.middle`;
          const [p, s, q] = names(3, ctx, tag) as [string, string, string];
          const rec = await policyRun(
            ctx,
            tag,
            [{ pattern: `${p}*${s}`, action: 'deny' }],
            [[`${p}mid${s}`, `${p}${s}`, `${p}mid`]],
          );
          const all = await policyRun(ctx, `${tag}:all`, [{ pattern: '*', action: 'deny' }], [[q]]);
          return [
            denied(rec, 0, `${p}mid${s}`),
            denied(rec, 0, `${p}${s}`),
            allowed(rec, 0, `${p}mid`),
            denied(all, 0, q),
          ];
        },
      ],
      [
        'a-pattern-is-a-glob-not-a-regular-expression',
        4,
        'a . in a pattern is a plain dot and a + is a plain plus: the pattern is a glob, not a regular expression',
        async (ctx) => {
          const tag = `${P}.policy-glob.plain`;
          const [p] = names(1, ctx, tag) as [string];
          const rec = await policyRun(
            ctx,
            tag,
            [{ pattern: `${p}.a+`, action: 'deny' }],
            [[`${p}.a+`, `${p}xa`, `${p}.aa`]],
          );
          return [denied(rec, 0, `${p}.a+`), allowed(rec, 0, `${p}xa`), allowed(rec, 0, `${p}.aa`)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.policy-verdict`, CHECKS, 'policy-one-verdict-per-tool', [
      [
        'two-calls-one-verdict',
        3,
        'a denied tool called twice in a block gives one tool_policy verdict',
        async (ctx) => {
          const tag = `${P}.policy-verdict.two`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await policyRun(ctx, tag, [{ pattern: a, action: 'deny' }], [[a, a]]);
          const count = idsAt(rec, 0).filter((id) => id === `tool_policy.${a}`).length;
          return [
            denied(rec, 0, a),
            count === 1 ? undefined : `${count} verdicts tool_policy.${a}; one per tool`,
          ];
        },
      ],
      [
        'one-verdict-per-denied-tool',
        3,
        'two denied tools give two verdicts, one each; an allowed tool gives none that fails',
        async (ctx) => {
          const tag = `${P}.policy-verdict.each`;
          const [a, b, c] = names(3, ctx, tag) as [string, string, string];
          const rec = await policyRun(
            ctx,
            tag,
            [
              { pattern: a, action: 'deny' },
              { pattern: b, action: 'ask' },
            ],
            [[a, b, c]],
          );
          return [denied(rec, 0, a), denied(rec, 0, b), allowed(rec, 0, c)];
        },
      ],
      [
        'the-check-is-off-by-default',
        3,
        'without a toolPolicy option the default checks give no tool_policy verdict',
        async (ctx) => {
          const tag = `${P}.policy-verdict.off`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [{ calls: [{ label: a, input: {} }] }]);
          return [expectNone(rec, 0, 'tool_policy'), expectPass(rec, 0, true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.policy-mark`, 'packages/core', 'policy-run-marks-denied-calls', [
      [
        'a-denied-call-carries-an-error',
        3,
        'runSpec with a toolPolicy records an error on a denied call that names the rule; an allowed call has none',
        async (ctx) => {
          const tag = `${P}.policy-mark.deny`;
          const [a, b] = names(2, ctx, tag) as [string, string];
          const rec = await exec(
            ctx,
            tag,
            [
              {
                calls: [
                  { label: a, input: {} },
                  { label: b, input: {} },
                ],
              },
            ],
            {
              run: { toolPolicy: [{ pattern: a, action: 'deny' }] },
            },
          );
          const calls = (rec.blocks[0]?.observed.toolCalls ?? []) as { label: string; error?: unknown }[];
          const hit = calls.find((c) => c.label === a);
          const clear = calls.find((c) => c.label === b);
          return [
            typeof hit?.error === 'string' && hit.error.includes(a)
              ? undefined
              : `the denied call ${a} has no error naming its rule: ${JSON.stringify(hit?.error)}`,
            clear && clear.error === undefined
              ? undefined
              : `the allowed call ${b} should carry no error: ${JSON.stringify(clear?.error)}`,
          ];
        },
      ],
      [
        'an-ask-rule-marks-the-call',
        3,
        'runSpec with a toolPolicy marks a call that an ask rule matches',
        async (ctx) => {
          const tag = `${P}.policy-mark.ask`;
          const [a] = names(1, ctx, tag) as [string];
          const rec = await exec(ctx, tag, [{ calls: [{ label: a, input: {} }] }], {
            run: { toolPolicy: [{ pattern: `${a.slice(0, 3)}*`, action: 'ask' }] },
          });
          const hit = (
            (rec.blocks[0]?.observed.toolCalls ?? []) as { label: string; error?: unknown }[]
          ).find((c) => c.label === a);
          return [
            typeof hit?.error === 'string' && hit.error.length > 0
              ? undefined
              : `the call matched by an ask rule carries no error: ${JSON.stringify(hit)}`,
          ];
        },
      ],
      [
        'the-first-matching-rule-is-named',
        4,
        'the error of a denied call names the rule that decided, not a later one',
        async (ctx) => {
          const tag = `${P}.policy-mark.first`;
          const [a, z] = names(2, ctx, tag) as [string, string];
          const rec = await exec(ctx, tag, [{ calls: [{ label: a, input: {} }] }], {
            run: {
              toolPolicy: [
                { pattern: a, action: 'deny' },
                { pattern: `${z}*`, action: 'deny' },
                { pattern: '*', action: 'deny' },
              ],
            },
          });
          const hit = (
            (rec.blocks[0]?.observed.toolCalls ?? []) as { label: string; error?: unknown }[]
          ).find((c) => c.label === a);
          const text = String(hit?.error ?? '');
          return [
            text.includes(a)
              ? undefined
              : `the error does not name the deciding rule ${a}: ${text.slice(0, 160)}`,
          ];
        },
      ],
    ]),
  ];
}

export function runtimeItems(): BankItem[] {
  return [
    ...skillItems(),
    ...guardItems(),
    ...referenceItems(),
    ...subagentItems(),
    ...offeredItems(),
    ...policyItems(),
  ];
}
