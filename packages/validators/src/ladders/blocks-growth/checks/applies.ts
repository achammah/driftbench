import {
  type BankItem,
  exec,
  expectNone,
  expectV,
  type ItemContext,
  idsAt,
  type Probe,
  type Row,
  tok,
  variants,
} from './kit';

/**
 * gr-applies: "Every check and its verdict ids" says when each check applies to a block and what its ids look
 * like. Each item plants a block where the condition holds and a twin where it does not: a product that emits
 * every verdict always, or none, loses.
 */

const FAMILY = 'gr-applies';
const CHECKS = 'packages/checks';
const P = 'gr.checks.applies';

const verdictIds = (rec: Awaited<ReturnType<typeof exec>>, block: number, prefix: string) =>
  idsAt(rec, block).filter((id) => id.startsWith(`${prefix}.`));

function piiItems(): BankItem[] {
  const piiKinds = ['pii.iban', 'pii.national_number', 'pii.phone', 'pii.email'];
  return variants(FAMILY, `${P}.pii`, CHECKS, 'applies-pii', [
    [
      'no-text-no-verdict',
      3,
      'a block whose reply is empty has no pii verdict; a block with a reply has one per kind',
      async (ctx) => {
        const rec = await exec(ctx, `${P}.pii.empty`, [{ text: '' }, { text: 'Hello there.' }]);
        return [
          ...verdictIds(rec, 0, 'pii').map(
            (id) => `block 0 has no visible text and should have no pii verdict; found ${id}`,
          ),
          ...piiKinds.map((id) => expectV(rec, 1, id, 'pass', true)),
        ];
      },
    ],
    [
      'card-only-block',
      3,
      'a block that sends only a card has no visible text and no pii verdict',
      async (ctx) => {
        const name = tok(ctx, `${P}.pii.card`, 'name');
        const rec = await exec(ctx, `${P}.pii.card`, [
          { text: '', extra: { segments: [{ type: 'card', name }], text: '' } },
          { text: 'A text.' },
        ]);
        return [
          ...verdictIds(rec, 0, 'pii').map(
            (id) => `block 0 sends only a card and should have no pii verdict; found ${id}`,
          ),
          expectV(rec, 1, 'pii.email', 'pass', true),
        ];
      },
    ],
    [
      'text-only-in-segments',
      4,
      'a block whose text is only in its text segments is read for personal data: the visible text is the segments joined',
      async (ctx) => {
        const rec = await exec(ctx, `${P}.pii.segments`, [
          { text: '', extra: { segments: [{ type: 'text', text: 'Hello there.' }], text: '' } },
        ]);
        return piiKinds.map((id) => expectV(rec, 0, id, 'pass', true));
      },
    ],
  ]);
}

function forbiddenItems(): BankItem[] {
  const one = async (ctx: ItemContext, tag: string, rows: Row[], spec?: Record<string, unknown>) =>
    exec(ctx, tag, rows, spec ? { spec } : {});
  return variants(FAMILY, `${P}.forbidden`, CHECKS, 'applies-forbidden', [
    [
      'forbidden-tools-list',
      3,
      'a tool in rules.forbidden_tools has a forbidden verdict in every block, called or not',
      async (ctx) => {
        const tag = `${P}.forbidden.list`;
        const t = tok(ctx, tag, 't');
        const rec = await one(ctx, tag, [{}, { calls: [{ label: t, input: {} }] }], {
          rules: { forbidden_tools: [t] },
        });
        return [
          expectV(rec, 0, `forbidden.${t}`, 'pass', true),
          expectV(rec, 1, `forbidden.${t}`, 'fail', true),
        ];
      },
    ],
    [
      'max-calls-above-zero',
      3,
      'a tool capped by rules.max_calls above 0 has a forbidden.max_calls verdict, and no plain forbidden verdict',
      async (ctx) => {
        const tag = `${P}.forbidden.cap`;
        const t = tok(ctx, tag, 't');
        const rec = await one(ctx, tag, [{ calls: [{ label: t, input: {} }] }], {
          rules: { max_calls: { [t]: 2 } },
        });
        return [
          expectV(rec, 0, `forbidden.max_calls.${t}`, 'pass', true),
          idsAt(rec, 0).includes(`forbidden.${t}`)
            ? `a cap of 2 does not forbid ${t}; forbidden.${t} should not exist`
            : undefined,
        ];
      },
    ],
    [
      'nothing-forbids-the-tool',
      3,
      'a tool that is not forbidden, not capped and expected once or more has no forbidden verdict',
      async (ctx) => {
        const tag = `${P}.forbidden.none`;
        const [t, u] = [tok(ctx, tag, 't'), tok(ctx, tag, 'u')] as [string, string];
        const rec = await one(
          ctx,
          tag,
          [{ calls: [{ label: t, input: {} }], expect: { tools: [{ label: t, count: 1 }] } }],
          {
            rules: { forbidden_tools: [u] },
          },
        );
        return [
          expectV(rec, 0, `forbidden.${u}`, 'pass', true),
          expectNone(rec, 0, `forbidden.${t}`),
          expectNone(rec, 0, `forbidden.max_calls.${t}`),
        ];
      },
    ],
    [
      'expected-zero-times',
      3,
      'a tool a block expects 0 times has a forbidden verdict in that block and in no other',
      async (ctx) => {
        const tag = `${P}.forbidden.zero`;
        const t = tok(ctx, tag, 't');
        const rec = await one(ctx, tag, [
          { expect: { tools: [{ label: t, count: 0 }] } },
          { calls: [{ label: t, input: {} }] },
        ]);
        return [expectV(rec, 0, `forbidden.${t}`, 'pass', true), expectNone(rec, 1, `forbidden.${t}`)];
      },
    ],
  ]);
}

function schemaItems(): BankItem[] {
  const schemas = (t: string) => ({
    metadata: { tool_schemas: { [t]: { type: 'object', properties: { x: { type: 'string' } } } } },
  });
  return variants(FAMILY, `${P}.schema-strict`, CHECKS, 'applies-schema-strict', [
    [
      'schemas-but-no-call',
      3,
      'a block with schemas in the spec and no tool call has no schema_strict verdict',
      async (ctx) => {
        const tag = `${P}.schema.nocall`;
        const t = tok(ctx, tag, 't');
        const rec = await exec(ctx, tag, [{}, { calls: [{ label: t, input: { x: 'a' } }] }], {
          spec: schemas(t),
        });
        return [expectNone(rec, 0, 'schema_strict'), expectV(rec, 1, `schema_strict.${t}.1`, 'pass', true)];
      },
    ],
    [
      'call-but-no-schemas',
      3,
      'a tool call in a spec with no tool_schemas has no schema_strict verdict',
      async (ctx) => {
        const tag = `${P}.schema.nomap`;
        const t = tok(ctx, tag, 't');
        const rec = await exec(ctx, tag, [{ calls: [{ label: t, input: { x: 'a' } }] }]);
        return [expectNone(rec, 0, 'schema_strict')];
      },
    ],
    [
      'schemas-and-a-call',
      3,
      'a call to a tool that has a schema gives one verdict per call, numbered from 1',
      async (ctx) => {
        const tag = `${P}.schema.both`;
        const t = tok(ctx, tag, 't');
        const rec = await exec(
          ctx,
          tag,
          [
            {
              calls: [
                { label: t, input: { x: 'a' } },
                { label: t, input: { x: 'b' } },
              ],
            },
          ],
          { spec: schemas(t) },
        );
        return [
          expectV(rec, 0, `schema_strict.${t}.1`, 'pass', true),
          expectV(rec, 0, `schema_strict.${t}.2`, 'pass', true),
          idsAt(rec, 0).includes(`schema_strict.${t}.0`)
            ? `the calls of one tool count from 1; schema_strict.${t}.0 should not exist`
            : undefined,
        ];
      },
    ],
  ]);
}

function stageItems(): BankItem[] {
  const stages = (a: string, b: string) => ({ stages: [a, b] });
  return variants(FAMILY, `${P}.stage`, CHECKS, 'applies-stage', [
    [
      'reported-stage-is-read',
      3,
      'expect.stage with a stage the runtime reported gives stage.reached',
      async (ctx) => {
        const tag = `${P}.stage.read`;
        const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
        const rec = await exec(
          ctx,
          tag,
          [
            { expect: { stage: a }, extra: { runtime: { stages: [{ name: a }] } } },
            { expect: { stage: a }, extra: { runtime: { stages: [{ name: b }] } } },
          ],
          { spec: stages(a, b) },
        );
        return [
          expectV(rec, 0, 'stage.reached', 'pass', true),
          expectV(rec, 1, 'stage.reached', 'fail', true),
        ];
      },
    ],
    [
      'no-reported-stage-no-stage-check',
      4,
      'expect.stage with no stage reported by the runtime gives no stage.reached verdict: the stage classifier reads it',
      async (ctx) => {
        const tag = `${P}.stage.none`;
        const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
        const rec = await exec(ctx, tag, [{ expect: { stage: a } }], { spec: stages(a, b) });
        return [
          expectNone(rec, 0, 'stage'),
          idsAt(rec, 0).some((id) => id.startsWith('flow.'))
            ? undefined
            : 'the stage classifier gave no flow verdict',
        ];
      },
    ],
    [
      'stage-reported-alone',
      3,
      'stage_reported: true without expect.stage gives stage.reported and no stage.reached',
      async (ctx) => {
        const tag = `${P}.stage.reported`;
        const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
        const rec = await exec(
          ctx,
          tag,
          [
            { expect: { stage_reported: true }, extra: { runtime: { stages: [{ name: a }] } } },
            { expect: { stage_reported: true } },
          ],
          { spec: stages(a, b) },
        );
        return [
          expectV(rec, 0, 'stage.reported', 'pass', true),
          expectNone(rec, 0, 'stage.reached'),
          expectV(rec, 1, 'stage.reported', 'fail', true),
        ];
      },
    ],
    [
      'reported-stage-without-expectation',
      3,
      'a stage the runtime reports with no expect.stage and no stage_reported gives no stage verdict',
      async (ctx) => {
        const tag = `${P}.stage.unasked`;
        const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
        const rec = await exec(ctx, tag, [{ extra: { runtime: { stages: [{ name: a }] } } }], {
          spec: stages(a, b),
        });
        return [expectNone(rec, 0, 'stage')];
      },
    ],
  ]);
}

function toolsItems(): BankItem[] {
  return variants(FAMILY, `${P}.tools`, CHECKS, 'applies-tools', [
    [
      'only-zero-counts',
      3,
      'a block that expects a tool 0 times has the forbidden verdict and no tools verdict',
      async (ctx) => {
        const tag = `${P}.tools.zero`;
        const t = tok(ctx, tag, 't');
        const rec = await exec(ctx, tag, [{ expect: { tools: [{ label: t, count: 0 }] } }]);
        return [expectV(rec, 0, `forbidden.${t}`, 'pass', true), expectNone(rec, 0, 'tools')];
      },
    ],
    [
      'zero-count-with-an-order',
      4,
      'tool_order makes the tools check apply even when the only expected tool has count 0',
      async (ctx) => {
        const tag = `${P}.tools.order`;
        const t = tok(ctx, tag, 't');
        const rec = await exec(ctx, tag, [
          { expect: { tools: [{ label: t, count: 0 }], tool_order: 'any_order' } },
        ]);
        return [expectV(rec, 0, 'tools.order', 'pass', true)];
      },
    ],
    [
      'a-count-above-zero',
      3,
      'a tool with a count other than 0 has a tools.<label>.count verdict, a range that allows 0 included',
      async (ctx) => {
        const tag = `${P}.tools.count`;
        const [t, u] = [tok(ctx, tag, 't'), tok(ctx, tag, 'u')] as [string, string];
        const rec = await exec(ctx, tag, [
          { calls: [{ label: t, input: {} }], expect: { tools: [{ label: t, count: 1 }] } },
          { expect: { tools: [{ label: u, count: { min: 0 } }] } },
        ]);
        return [
          expectV(rec, 0, `tools.${t}.count`, 'pass', true),
          expectV(rec, 1, `tools.${u}.count`, 'pass', true),
        ];
      },
    ],
  ]);
}

function rulesItems(): BankItem[] {
  const LONG =
    'The weather is very nice today and we should go for a long walk along the river before dinner with the whole family.';
  return variants(FAMILY, `${P}.rules`, CHECKS, 'applies-rules', [
    [
      'lang-stable-alone',
      3,
      'rules.lang_stable without expect.lang gives lang.stable and no lang.expected',
      async (ctx) => {
        const rec = await exec(ctx, `${P}.rules.stable`, [{ text: LONG }, { text: LONG }], {
          spec: { rules: { lang_stable: true } },
        });
        return [expectV(rec, 0, 'lang.stable', 'pass', true), expectNone(rec, 0, 'lang.expected')];
      },
    ],
    [
      'lang-expected-alone',
      3,
      'expect.lang without rules.lang_stable gives lang.expected and no lang.stable',
      async (ctx) => {
        const rec = await exec(ctx, `${P}.rules.expected`, [{ text: LONG, expect: { lang: 'EN' } }]);
        return [expectV(rec, 0, 'lang.expected', 'pass', true), expectNone(rec, 0, 'lang.stable')];
      },
    ],
    [
      'one-message-alone',
      3,
      'rules.one_message_per_turn without expect.cards gives cards.one_message_per_turn and no card-name verdict',
      async (ctx) => {
        const rec = await exec(ctx, `${P}.rules.one`, [{ text: 'One message.' }], {
          spec: { rules: { one_message_per_turn: true } },
        });
        return [
          expectV(rec, 0, 'cards.one_message_per_turn', 'pass', true),
          idsAt(rec, 0)
            .filter((id) => id.startsWith('cards.') && id !== 'cards.one_message_per_turn')
            .map((id) => `unexpected verdict ${id}`)[0],
        ];
      },
    ],
  ]);
}

function indexItems(): BankItem[] {
  const idx = (prefix: string, n: number, from = 0) =>
    Array.from({ length: n }, (_, k) => `${prefix}.${from + k}`);
  const f = (
    id: string,
    title: string,
    row: (t: string[]) => Row,
    wants: (t: string[]) => string[],
    refuses: string[],
  ) =>
    [
      id,
      3,
      title,
      (async (ctx) => {
        const tag = `${P}.index.${id}`;
        const t = [0, 1, 2].map((k) => tok(ctx, tag, `t${k}`, 9));
        const rec = await exec(ctx, tag, [row(t)]);
        return [
          ...wants(t).map((want) => expectV(rec, 0, want, 'pass', true)),
          ...refuses.map((no) =>
            idsAt(rec, 0).includes(no) ? `the index counts from 0; ${no} should not exist` : undefined,
          ),
        ];
      }) as Probe,
    ] as const;
  return variants(FAMILY, `${P}.index`, CHECKS, 'index-from-zero', [
    f(
      'must',
      'the patterns of expect.must are must.0, must.1, must.2',
      (t) => ({ text: t.join(' '), expect: { must: t } }),
      () => idx('must', 3),
      ['must.3'],
    ),
    f(
      'must-not',
      'the patterns of expect.must_not are must_not.0, must_not.1',
      (t) => ({ text: 'Fine.', expect: { must_not: [t[0] as string, t[1] as string] } }),
      () => idx('must_not', 2),
      ['must_not.2'],
    ),
    f(
      'regex',
      'the patterns of expect.regex are regex.0, regex.1',
      (t) => ({ text: t.join(' '), expect: { regex: [t[0] as string, t[1] as string] } }),
      () => idx('regex', 2),
      ['regex.2'],
    ),
    f(
      'json-paths',
      'the paths of expect.json are json.path.0, json.path.1',
      (t) => ({
        text: JSON.stringify({ a: 1, b: 2, [t[0] as string]: 3 }),
        expect: {
          json: {
            paths: [
              { path: 'a', assert: 1 },
              { path: 'b', assert: 2 },
            ],
          },
        },
      }),
      () => ['json.valid', ...idx('json.path', 2)],
      ['json.path.2'],
    ),
    f(
      'similarity',
      'the references of expect.similarity are similarity.0, similarity.1',
      (t) => ({
        text: `${t[0]} ${t[1]}`,
        expect: {
          similarity: [
            { reference: `${t[0]} ${t[1]}`, min: 0.5 },
            { reference: `${t[0]} ${t[1]}`, min: 0.5 },
          ],
        },
      }),
      () => idx('similarity', 2),
      ['similarity.2'],
    ),
  ]);
}

export function appliesItems(): BankItem[] {
  return [
    ...piiItems(),
    ...forbiddenItems(),
    ...schemaItems(),
    ...stageItems(),
    ...toolsItems(),
    ...rulesItems(),
    ...indexItems(),
  ];
}
