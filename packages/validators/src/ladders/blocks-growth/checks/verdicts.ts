import { canonical } from '../../blocks/harness';
import { need } from '../../blocks/product';
import {
  type BankItem,
  exec,
  expectPass,
  expectV,
  type ItemContext,
  idsAt,
  type Probe,
  type Row,
  tok,
  variants,
  verdict,
  verdictsOf,
  withExtra,
} from './kit';

/**
 * gr-verdicts: the verdict machinery of docs/reference/checks.md "Verdicts" (the check named by an id, a custom
 * check that fails, a check that throws or returns a refused verdict, checks judged apart, the `#2` suffix of
 * every kind of name, and the two kinds of inconclusive verdict). Every item is a twin: the shape the doc says
 * is fine and the shape it says fails.
 */

const FAMILY = 'gr-verdicts';
const CHECKS = 'packages/checks';
const CORE = 'packages/core';

/* ------------------------------------------------------------------------------------------------------
 * The check of a verdict is the text of its id before the first dot
 * ---------------------------------------------------------------------------------------------------- */

/** Every verdict but a custom one names, as its check, the text of its id before the first dot. */
function namesAgree(rec: Awaited<ReturnType<typeof exec>>, block: number): (string | undefined)[] {
  return verdictsOf(rec, block)
    .filter((each) => !each.id.startsWith('custom.'))
    .map((each) =>
      each.name === each.id.split('.')[0]
        ? undefined
        : `${each.id} names the check ${String(each.name)}, not ${each.id.split('.')[0]}`,
    );
}

const dotted = (ctx: ItemContext, tag: string) => `${tok(ctx, tag, 'a', 6)}.${tok(ctx, tag, 'b', 6)}`;

function nameItems(): BankItem[] {
  const f = (
    id: string,
    title: string,
    make: (ctx: ItemContext, tag: string) => { row: Row; target: string; spec?: Record<string, unknown> },
  ) =>
    [
      id,
      3,
      title,
      (async (ctx) => {
        const tag = `gr.verdicts.name.${id}`;
        const made = make(ctx, tag);
        const rec = await exec(ctx, tag, [made.row], made.spec ? { spec: made.spec } : {});
        return [expectV(rec, 0, made.target, 'pass'), ...namesAgree(rec, 0)];
      }) as Probe,
    ] as const;
  return variants(FAMILY, 'gr.checks.name-before-dot', CHECKS, 'name-before-dot', [
    f(
      'tool-label',
      'a tool label that holds a dot: the verdict still belongs to the tools check',
      (ctx, tag) => {
        const label = dotted(ctx, tag);
        return {
          row: { calls: [{ label, input: {} }], expect: { tools: [{ label, count: 1 }] } },
          target: `tools.${label}.count`,
        };
      },
    ),
    f(
      'reference-path',
      'a reference path that holds dots: the verdict still belongs to the references check',
      (ctx, tag) => {
        const path = `skills/${dotted(ctx, tag)}/guide.md`;
        return {
          row: { extra: { runtime: { references: [{ path }] } }, expect: { references: [{ path }] } },
          target: `references.${path}`,
        };
      },
    ),
    f(
      'card-name',
      'a card name that holds a dot: the verdict still belongs to the cards check',
      (ctx, tag) => {
        const name = dotted(ctx, tag);
        return {
          row: {
            extra: {
              segments: [
                { type: 'text', text: 'Done.' },
                { type: 'card', name },
              ],
            },
            expect: { cards: [{ name }] },
          },
          target: `cards.${name}`,
        };
      },
    ),
    f(
      'skill-name',
      'a skill name that holds a dot: the verdict still belongs to the skills check',
      (ctx, tag) => {
        const name = dotted(ctx, tag);
        return {
          row: { extra: { runtime: { skills: [{ name }] } }, expect: { skills: [{ name }] } },
          target: `skills.${name}`,
        };
      },
    ),
    f(
      'guard-name',
      'a guard name that holds a dot: the verdict still belongs to the guards check',
      (ctx, tag) => {
        const name = dotted(ctx, tag);
        return {
          row: {
            extra: { runtime: { guards: [{ name, verdict: 'deny' }] } },
            expect: { guards: [{ name, verdict: 'deny' }] },
          },
          target: `guards.${name}.deny`,
        };
      },
    ),
    f(
      'helper-and-model',
      'a helper and a model that hold dots: the verdict still belongs to the subagents check',
      (ctx, tag) => {
        const name = dotted(ctx, tag);
        const model = dotted(ctx, `${tag}:m`);
        return {
          row: {
            extra: { runtime: { subagents: [{ name, model }] } },
            expect: { subagents: [{ name, model }] },
          },
          target: `subagents.${name}.${model}`,
        };
      },
    ),
  ]);
}

/* ------------------------------------------------------------------------------------------------------
 * A custom check that fails, throws or returns something that is no verdict
 * ---------------------------------------------------------------------------------------------------- */

let serial = 0;
const freshName = (ctx: ItemContext, tag: string) => {
  serial += 1;
  return `gr_${tok(ctx, tag, 'n', 6)}_${serial}`;
};

type CustomCtx = { observed: { text: string } };

function customItems(): BankItem[] {
  const out: BankItem[] = [];
  /** `bad` is what the check does on the block whose reply holds the first token; it is sound on the next. */
  const f = (
    id: string,
    title: string,
    bad: (name: string, make: (outcome: string) => unknown) => unknown,
  ): BankItem[] =>
    variants(FAMILY, 'gr.checks.custom-failure', CHECKS, 'custom-failure-fails-block', [
      [
        id,
        3,
        title,
        (async (ctx) => {
          const tag = `gr.checks.custom-failure.${id}`;
          const name = freshName(ctx, tag);
          const [t0, t1] = [tok(ctx, tag, 't0', 9), tok(ctx, tag, 't1', 9)] as [string, string];
          const machineVerdict = need<(...args: string[]) => Record<string, unknown>>(
            ctx.product.core,
            'core',
            'machineVerdict',
          );
          const registerCheck = need<(name: string, fn: (c: CustomCtx) => unknown) => void>(
            ctx.product.checks,
            'checks',
            'registerCheck',
          );
          registerCheck(name, (c) =>
            c.observed.text.includes(t0)
              ? bad(name, (outcome) => machineVerdict(name, 'x', outcome, 'e'))
              : machineVerdict(name, 'ok', 'pass', 'fine'),
          );
          const rec = await exec(
            ctx,
            tag,
            [
              { text: `Yes ${t0}.`, expect: { must: [t0] } },
              { text: `Yes ${t1}.`, expect: { must: [t1] } },
            ],
            { spec: { rules: { custom: { [name]: {} } } } },
          );
          const failed = verdictsOf(rec, 0).filter((each) => each.id.startsWith(`custom.${name}`));
          return [
            rec.blocks.length === 2 ? undefined : `the run stopped after ${rec.blocks.length} block(s)`,
            failed.some(
              (each) => each.gating && each.outcome !== 'pass' && String(each.evidence ?? '') !== '',
            )
              ? undefined
              : `block 0 has no failing gating verdict under custom.${name} that says why: ${JSON.stringify(failed).slice(0, 160)}`,
            expectPass(rec, 0, false),
            expectV(rec, 0, 'must.0', 'pass'),
            expectV(rec, 1, `custom.${name}.ok`, 'pass'),
            expectPass(rec, 1, true),
          ];
        }) as Probe,
      ],
    ]);
  out.push(
    ...f(
      'throws',
      'a custom check that throws fails the block with a verdict that says so and the run goes on',
      () => {
        throw new Error('planted failure');
      },
    ),
    ...f('returns-a-number', 'a custom check that returns a number is no verdict: the block fails', () => 5),
    ...f(
      'returns-a-refused-verdict',
      'a custom check that returns a verdict with an outcome the schema refuses fails the block',
      (_name, make) => make('maybe'),
    ),
    ...f(
      'list-with-a-bad-entry',
      'a custom check that returns a list holding one entry that is no verdict fails the block',
      (_name, make) => [make('pass'), 7],
    ),
    ...f('returns-a-rejected-promise', 'a custom check whose promise rejects fails the block', () =>
      Promise.reject(new Error('planted rejection')),
    ),
  );
  out.push(
    ...variants(FAMILY, 'gr.checks.custom-failure', CHECKS, 'custom-failure-fails-block', [
      [
        'unregistered-name',
        3,
        'a name under rules.custom that nobody registered fails every block with a verdict that says so',
        (async (ctx) => {
          const tag = 'gr.checks.custom-failure.unregistered-name';
          const name = freshName(ctx, tag);
          const rec = await exec(ctx, tag, [{ text: 'Yes.' }, { text: 'Again.' }], {
            spec: { rules: { custom: { [name]: {} } } },
          });
          return [
            rec.blocks.length === 2 ? undefined : `the run stopped after ${rec.blocks.length} block(s)`,
            ...[0, 1].map((i) => {
              const found = verdictsOf(rec, i).find((each) => each.id.startsWith(`custom.${name}`));
              return found?.gating && found.outcome !== 'pass' && String(found.evidence ?? '').includes(name)
                ? undefined
                : `block ${i}: no failing gating verdict under custom.${name} that names the check: ${JSON.stringify(found).slice(0, 160)}`;
            }),
            expectPass(rec, 0, false),
          ];
        }) as Probe,
      ],
    ]),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * A check the runner runs that throws or returns a verdict the schema refuses
 * ---------------------------------------------------------------------------------------------------- */

type Ctx2 = { observed: { text: string } };

/** A check of the item, added after the defaults: `act` runs on the block whose reply holds `t0`, else it is sound. */
function runnerCheckItems(): BankItem[] {
  const build = (
    ctx: ItemContext,
    tag: string,
    act: (name: string, good: (outcome: string) => Record<string, unknown>) => unknown,
  ) => {
    const name = `g${tok(ctx, tag, 'c', 6)}`;
    const [t0, t1] = [tok(ctx, tag, 't0', 9), tok(ctx, tag, 't1', 9)] as [string, string];
    const machineVerdict = need<(...args: string[]) => Record<string, unknown>>(
      ctx.product.core,
      'core',
      'machineVerdict',
    );
    const check = {
      name,
      applies: () => true,
      evaluate: (c: Ctx2) =>
        c.observed.text.includes(t0)
          ? act(name, (outcome) => machineVerdict(name, 'x', outcome, 'e'))
          : [machineVerdict(name, 'ok', 'pass', 'fine')],
    };
    return { name, t0, t1, check };
  };
  const probe =
    (
      kind: 'error' | 'invalid',
      act: (name: string, good: (outcome: string) => Record<string, unknown>) => unknown,
      mention?: string,
    ): Probe =>
    async (ctx) => {
      const tag = `gr.checks.runner-${kind}.${mention ?? kind}`;
      const { name, t0, t1, check } = build(ctx, tag, act);
      const rec = await exec(
        ctx,
        tag,
        [
          { text: `Yes ${t0}.`, expect: { must: [t0] } },
          { text: `Yes ${t1}.`, expect: { must: [t1] } },
        ],
        { checks: withExtra([check]) },
      );
      const found = verdict(rec, 0, `${name}.${kind}`);
      return [
        rec.blocks.length === 2 ? undefined : `the run stopped after ${rec.blocks.length} block(s)`,
        expectV(rec, 0, `${name}.${kind}`, 'inconclusive', true),
        found && String(found.evidence ?? '').length > 0 ? undefined : `${name}.${kind} names no problem`,
        mention && found && !String(found.evidence ?? '').includes(mention)
          ? `${name}.${kind} does not name the problem "${mention}": ${String(found.evidence ?? '').slice(0, 120)}`
          : undefined,
        expectPass(rec, 0, false),
        expectV(rec, 0, 'must.0', 'pass'),
        expectV(rec, 1, `${name}.ok`, 'pass'),
        expectPass(rec, 1, true),
      ];
    };
  return [
    ...variants(FAMILY, 'gr.checks.runner-error', CORE, 'runner-check-error', [
      [
        'throws-an-error',
        3,
        'a check that throws an error gives <check>.error, inconclusive and gating, and names the error',
        probe(
          'error',
          () => {
            throw new Error('planted failure of the check');
          },
          'planted failure of the check',
        ),
      ],
      [
        'rejects',
        3,
        'a check whose promise rejects gives <check>.error, inconclusive and gating, and names the reason',
        probe(
          'error',
          () => Promise.reject(new Error('planted rejection of the check')),
          'planted rejection of the check',
        ),
      ],
      [
        'throws-a-text',
        4,
        'a check that throws a plain text, not an error object, gives <check>.error and names the text',
        probe(
          'error',
          () => {
            throw 'planted text thrown by the check';
          },
          'planted text thrown by the check',
        ),
      ],
    ]),
    ...variants(FAMILY, 'gr.checks.runner-invalid', CORE, 'runner-check-invalid', [
      [
        'outcome-refused',
        3,
        'a check that returns a verdict with an outcome the schema refuses gives <check>.invalid, inconclusive and gating',
        probe('invalid', (_n, good) => [good('maybe')]),
      ],
      [
        'gating-not-a-boolean',
        4,
        'a check that returns a verdict whose gating is a text gives <check>.invalid, inconclusive and gating',
        probe('invalid', (_n, good) => [{ ...good('pass'), gating: 'yes' }]),
      ],
      [
        'no-id',
        4,
        'a check that returns a verdict with no id gives <check>.invalid, inconclusive and gating',
        probe('invalid', (_n, good) => {
          const { id: _id, ...rest } = good('pass');
          return [rest];
        }),
      ],
    ]),
  ];
}

/* ------------------------------------------------------------------------------------------------------
 * The checks of one block are judged apart
 * ---------------------------------------------------------------------------------------------------- */

function apartItems(): BankItem[] {
  const f = (id: string, title: string, make: (ctx: ItemContext, tag: string) => { a: Row; b: Row }) =>
    [
      id,
      4,
      title,
      (async (ctx) => {
        const tag = `gr.checks.apart.${id}`;
        const { a, b } = make(ctx, tag);
        const both: Row = {
          ...a,
          ...b,
          calls: [...(a.calls ?? []), ...(b.calls ?? [])],
          expect: { ...a.expect, ...b.expect },
        };
        const [ra, rb, rab] = [
          await exec(ctx, `${tag}:a`, [a]),
          await exec(ctx, `${tag}:b`, [b]),
          await exec(ctx, `${tag}:ab`, [both]),
        ];
        const alone = new Map<string, string>();
        for (const rec of [ra, rb])
          for (const each of verdictsOf(rec, 0)) alone.set(each.id, `${each.outcome}/${each.gating}`);
        const together = new Map(
          verdictsOf(rab, 0).map((each) => [each.id, `${each.outcome}/${each.gating}`]),
        );
        const differ = [...new Set([...alone.keys(), ...together.keys()])].filter(
          (key) => !key.startsWith('pii.') && alone.get(key) !== together.get(key),
        );
        const aFails = verdictsOf(ra, 0).some((each) => each.gating && each.outcome === 'fail');
        return [
          aFails ? undefined : 'the planted failing expectation did not fail on its own',
          differ.length === 0
            ? undefined
            : `with another check failing, ${differ.slice(0, 3).join(', ')} read differently: ${canonical(differ.map((k) => [k, alone.get(k), together.get(k)])).slice(0, 200)}`,
        ];
      }) as Probe,
    ] as const;
  return variants(FAMILY, 'gr.checks.apart', CHECKS, 'checks-judged-apart', [
    f(
      'must-fails-starts-with-passes',
      'a failing must beside a passing starts_with: starts_with reads as it does alone',
      (ctx, tag) => {
        const t = tok(ctx, tag, 't', 9);
        return {
          a: { text: `${t} is here.`, expect: { must: [tok(ctx, tag, 'absent', 10)] } },
          b: { text: `${t} is here.`, expect: { starts_with: t } },
        };
      },
    ),
    f(
      'tools-fails-exact-passes',
      'a failing tool count beside a passing exact: exact reads as it does alone',
      (ctx, tag) => {
        const t = tok(ctx, tag, 't', 9);
        return {
          a: { text: t, expect: { tools: [{ label: tok(ctx, tag, 'tool'), count: 1 }] } },
          b: { text: t, expect: { exact: t } },
        };
      },
    ),
    f(
      'length-fails-regex-passes',
      'a failing length beside a passing regex: regex reads as it does alone',
      (ctx, tag) => {
        const t = tok(ctx, tag, 't', 9);
        return {
          a: { text: `${t} one two three`, expect: { length: { words: { max: 1 } } } },
          b: { text: `${t} one two three`, expect: { regex: [t] } },
        };
      },
    ),
  ]);
}

/* ------------------------------------------------------------------------------------------------------
 * The #2 and #3 suffix on every kind of name
 * ---------------------------------------------------------------------------------------------------- */

function suffixItems(): BankItem[] {
  type Make = (
    name: string,
    n: number,
  ) => { extra: Record<string, unknown>; expect: Record<string, unknown>; id: (k: number) => string };
  const entries = (n: number, entry: (k: number) => unknown) => Array.from({ length: n }, (_, k) => entry(k));
  const f = (id: string, title: string, make: Make, n: 2 | 3) =>
    [
      id,
      3,
      title,
      (async (ctx) => {
        const tag = `gr.checks.suffix.${id}`;
        const name = tok(ctx, tag, 'name', 7);
        const made = make(name, n);
        const rec = await exec(ctx, tag, [{ extra: made.extra, expect: made.expect }]);
        const want = Array.from({ length: n }, (_, k) => made.id(k + 1));
        return want.map((each) =>
          idsAt(rec, 0).includes(each)
            ? undefined
            : `no verdict ${each}; the block has ${idsAt(rec, 0)
                .filter((x) => !x.startsWith('pii.'))
                .join(', ')}`,
        );
      }) as Probe,
    ] as const;
  const suffix = (k: number) => (k === 1 ? '' : `#${k}`);
  const card: Make = (name, n) => ({
    extra: {
      segments: [
        { type: 'text', text: 'Done.' },
        { type: 'card', name },
      ],
    },
    expect: { cards: entries(n, (k) => ({ name, count: k === 0 ? 1 : { min: 1 } })) },
    id: (k) => `cards.${name}${suffix(k)}`,
  });
  const skill: Make = (name, n) => ({
    extra: { runtime: { skills: [{ name }] } },
    expect: { skills: entries(n, (k) => ({ name, count: k === 0 ? 1 : { min: 1 } })) },
    id: (k) => `skills.${name}${suffix(k)}`,
  });
  const guard: Make = (name, n) => ({
    extra: { runtime: { guards: [{ name, verdict: 'deny' }] } },
    expect: { guards: entries(n, (k) => ({ name, verdict: 'deny', count: k === 0 ? 1 : { min: 1 } })) },
    id: (k) => `guards.${name}${suffix(k)}.deny`,
  });
  const guardAny: Make = (name, n) => ({
    extra: { runtime: { guards: [{ name, verdict: 'deny' }] } },
    expect: { guards: entries(n, () => ({ name })) },
    id: (k) => `guards.${name}${suffix(k)}.any`,
  });
  const reference: Make = (name, n) => ({
    extra: { runtime: { references: [{ path: `docs/${name}.md` }] } },
    expect: { references: entries(n, (k) => ({ path: `docs/${name}.md`, count: k === 0 ? 1 : { min: 1 } })) },
    id: (k) => `references.docs/${name}.md${suffix(k)}`,
  });
  const helper: Make = (name, n) => ({
    extra: { runtime: { subagents: [{ name }] } },
    expect: { subagents: entries(n, (k) => ({ name, count: k === 0 ? 1 : { min: 1 } })) },
    id: (k) => `subagents.${name}${suffix(k)}`,
  });
  return variants(FAMILY, 'gr.checks.suffix', CHECKS, 'suffix-other-names', [
    f('card-twice', 'a card expected twice by name: the second entry gets #2', card, 2),
    f(
      'card-three-times',
      'a card expected three times by name: the entries get no suffix, #2 and #3',
      card,
      3,
    ),
    f('skill-twice', 'a skill expected twice by name: the second entry gets #2', skill, 2),
    f(
      'skill-three-times',
      'a skill expected three times by name: the entries get no suffix, #2 and #3',
      skill,
      3,
    ),
    f('guard-twice', 'a guard expected twice by name and verdict: the second entry gets #2', guard, 2),
    f(
      'guard-without-verdict',
      'a guard expected twice with no verdict: the ids are .any and #2.any',
      guardAny,
      2,
    ),
    f('reference-twice', 'a reference path expected twice: the second entry gets #2', reference, 2),
    f(
      'reference-three-times',
      'a reference path expected three times: the entries get no suffix, #2 and #3',
      reference,
      3,
    ),
    f('helper-twice', 'a helper expected twice by name: the second entry gets #2', helper, 2),
    f(
      'helper-three-times',
      'a helper expected three times by name: the entries get no suffix, #2 and #3',
      helper,
      3,
    ),
  ]);
}

/* ------------------------------------------------------------------------------------------------------
 * The two kinds of inconclusive verdict
 * ---------------------------------------------------------------------------------------------------- */

const LONG_EN =
  'The weather is very nice today and we should go for a long walk along the river before dinner with the whole family.';

function nongatingItems(): BankItem[] {
  return variants(FAMILY, 'gr.checks.inconclusive-nongating', CHECKS, 'inconclusive-nongating', [
    [
      'lang-text-too-short',
      3,
      'a reply too short to read gives an inconclusive lang verdict that does not gate; a reply long enough is read',
      async (ctx) => {
        const tag = 'gr.checks.inconclusive-nongating.lang-short';
        const rec = await exec(ctx, tag, [
          { text: 'Fine.', expect: { lang: 'EN' } },
          { text: LONG_EN, expect: { lang: 'EN' } },
        ]);
        return [
          expectV(rec, 0, 'lang.expected', 'inconclusive', false),
          expectPass(rec, 0, true),
          expectV(rec, 1, 'lang.expected', 'pass', true),
        ];
      },
    ],
    [
      'lang-without-a-model',
      3,
      'a language the detector has no model for gives an inconclusive lang verdict that does not gate',
      async (ctx) => {
        const tag = 'gr.checks.inconclusive-nongating.lang-model';
        const rec = await exec(ctx, tag, [
          { text: LONG_EN, expect: { lang: 'zz' } },
          { text: LONG_EN, expect: { lang: 'EN' } },
        ]);
        return [
          expectV(rec, 0, 'lang.expected', 'inconclusive', false),
          expectPass(rec, 0, true),
          expectV(rec, 1, 'lang.expected', 'pass', true),
        ];
      },
    ],
    [
      'lang-stable-without-a-clear-reply',
      4,
      'lang.stable is inconclusive and does not gate while no reply so far is clear enough to set the language',
      async (ctx) => {
        const tag = 'gr.checks.inconclusive-nongating.lang-stable';
        const rec = await exec(ctx, tag, [{ text: 'Fine.' }, { text: 'Ok.' }, { text: LONG_EN }], {
          spec: { rules: { lang_stable: true } },
        });
        return [
          expectV(rec, 0, 'lang.stable', 'inconclusive', false),
          expectPass(rec, 0, true),
          expectV(rec, 1, 'lang.stable', 'inconclusive', false),
          expectV(rec, 2, 'lang.stable', 'pass', true),
        ];
      },
    ],
    [
      'schema-strict-tool-without-schema',
      3,
      'a call to a tool with no schema gives an inconclusive schema_strict verdict that does not gate',
      async (ctx) => {
        const tag = 'gr.checks.inconclusive-nongating.schema';
        const [known, unknown] = [tok(ctx, tag, 'k'), tok(ctx, tag, 'u')] as [string, string];
        const rec = await exec(
          ctx,
          tag,
          [
            { calls: [{ label: unknown, input: {} }] },
            { calls: [{ label: known, input: { x: 'a', y: 'b' } }] },
          ],
          {
            spec: {
              metadata: {
                tool_schemas: { [known]: { type: 'object', properties: { x: { type: 'string' } } } },
              },
            },
          },
        );
        return [
          expectV(rec, 0, `schema_strict.${unknown}.1`, 'inconclusive', false),
          expectPass(rec, 0, true),
          expectV(rec, 1, `schema_strict.${known}.1`, 'fail', true),
        ];
      },
    ],
  ]);
}

function gatingItems(): BankItem[] {
  const f = (
    id: string,
    title: string,
    expectOf: (name: string) => Record<string, unknown>,
    target: (name: string) => string,
    twin: Record<string, unknown> | ((name: string) => Record<string, unknown>),
    twinOutcome: 'fail' | 'pass' = 'fail',
  ) =>
    [
      id,
      3,
      title,
      (async (ctx) => {
        const tag = `gr.checks.inconclusive-gating.${id}`;
        const name = tok(ctx, tag, 'n', 7);
        const noTrace = await exec(ctx, tag, [{ expect: expectOf(name) }]);
        const withTrace = await exec(ctx, `${tag}:twin`, [
          { expect: expectOf(name), extra: typeof twin === 'function' ? twin(name) : twin },
        ]);
        return [
          expectV(noTrace, 0, target(name), 'inconclusive', true),
          expectPass(noTrace, 0, false),
          expectV(withTrace, 0, target(name), twinOutcome, true),
        ];
      }) as Probe,
    ] as const;
  return variants(FAMILY, 'gr.checks.inconclusive-gating', CHECKS, 'inconclusive-gating', [
    f(
      'skills-without-a-trace',
      'skills with no runtime trace at all is inconclusive and gates; a trace without a skills list is a plain fail',
      (n) => ({ skills: [{ name: n }] }),
      (n) => `skills.${n}`,
      { runtime: { guards: [] } },
    ),
    f(
      'guards-without-a-trace',
      'guards with no runtime trace at all is inconclusive and gates; a trace without a guards list is a plain fail',
      (n) => ({ guards: [{ name: n, verdict: 'deny' }] }),
      (n) => `guards.${n}.deny`,
      { runtime: { skills: [] } },
    ),
    f(
      'offered-without-a-list',
      'tools_offered with no offered list is inconclusive and gates; an empty offered list is a plain fail',
      (n) => ({ tools_offered: { include: [n] } }),
      (n) => `tools_offered.include.${n}`,
      { runtime: { offered: [] } },
    ),
    f(
      'execution-without-a-list',
      'execution with no executions list is inconclusive and gates; an empty list is a plain fail',
      () => ({ execution: { ran_code: true } }),
      () => 'execution.ran_code',
      { executions: [] },
    ),
    f(
      'workspace-without-a-diff',
      'workspace with no diff is inconclusive and gates; an empty diff is a plain fail',
      (n) => ({ workspace: { created: [`out/${n}.txt`] } }),
      () => 'workspace.created',
      { workspaceDiff: { created: [], changed: [], deleted: [] } },
    ),
  ]);
}

export function verdictItems(): BankItem[] {
  return [
    ...nameItems(),
    ...customItems(),
    ...runnerCheckItems(),
    ...apartItems(),
    ...suffixItems(),
    ...nongatingItems(),
    ...gatingItems(),
  ];
}
