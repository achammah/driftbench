import {
  type BankItem,
  exec,
  expectPass,
  expectV,
  type ItemContext,
  idsAt,
  type Row,
  tok,
  variants,
  verdict,
} from './kit';

/**
 * gr-text: the reply-text checks of docs/reference/checks.md "Text and language" that no earlier item reads:
 * finish_reason, json (fence, strict schema, a reply that is no JSON, embedded JSON, paths), markup, regex,
 * starts_with and the normalising of exact. Every text a reply holds is a seeded word or a plain fixed sentence.
 */

const FAMILY = 'gr-text';
const CHECKS = 'packages/checks';
const P = 'gr.checks.text';

const json = (value: unknown) => JSON.stringify(value);
const fenced = (value: string, tag = 'json') => `\`\`\`${tag}\n${value}\n\`\`\``;

/** Rows that each reply with one of `replies` under one `expect`. */
const replies = (list: string[], expect: Record<string, unknown>): Row[] =>
  list.map((text) => ({ text, expect }));

function finishItems(): BankItem[] {
  const reasonRow = (reason: string | undefined, expected: string): Row => ({
    expect: { finish_reason: expected },
    ...(reason !== undefined ? { extra: { runtime: { finishReason: reason } } } : {}),
  });
  return variants(FAMILY, `${P}.finish`, CHECKS, 'finish-reason-compares', [
    [
      'stop-fails-a-cut-reply',
      3,
      'an expected stop passes a reply that stopped and fails a reply cut at a length limit',
      async (ctx) => {
        const rec = await exec(ctx, `${P}.finish.stop`, [
          reasonRow('stop', 'stop'),
          reasonRow('length', 'stop'),
        ]);
        return [
          expectV(rec, 0, 'finish_reason.reason', 'pass', true),
          expectV(rec, 1, 'finish_reason.reason', 'fail', true),
        ];
      },
    ],
    [
      'any-expected-reason',
      3,
      'an expected reason other than stop is compared the same way: equal passes, different fails',
      async (ctx) => {
        const tag = `${P}.finish.any`;
        const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
        const rec = await exec(ctx, tag, [reasonRow(a, a), reasonRow(b, a)]);
        return [
          expectV(rec, 0, 'finish_reason.reason', 'pass', true),
          expectV(rec, 1, 'finish_reason.reason', 'fail', true),
        ];
      },
    ],
    [
      'no-reported-reason-does-not-gate',
      4,
      'a runtime that reports no finish reason gives an inconclusive verdict that does not gate: the block passes',
      async (ctx) => {
        const rec = await exec(ctx, `${P}.finish.none`, [
          reasonRow(undefined, 'stop'),
          reasonRow('stop', 'stop'),
        ]);
        return [
          expectV(rec, 0, 'finish_reason.reason', 'inconclusive', false),
          expectPass(rec, 0, true),
          expectPass(rec, 1, true),
        ];
      },
    ],
    [
      'the-reason-is-per-block',
      3,
      'each block reads its own finish reason: a cut block does not fail the blocks around it',
      async (ctx) => {
        const rec = await exec(ctx, `${P}.finish.blocks`, [
          reasonRow('stop', 'stop'),
          reasonRow('length', 'stop'),
          reasonRow('stop', 'stop'),
        ]);
        return [expectPass(rec, 0, true), expectPass(rec, 1, false), expectPass(rec, 2, true)];
      },
    ],
  ]);
}

function jsonItems(): BankItem[] {
  const path = (p: string, assert: unknown) => ({ path: p, assert });
  return [
    ...variants(FAMILY, `${P}.json-fence`, CHECKS, 'json-fenced-reply', [
      [
        'fence-with-a-language',
        3,
        'a reply that is one Markdown code fence of JSON is read as that JSON',
        async (ctx) => {
          const tag = `${P}.json-fence.lang`;
          const t = tok(ctx, tag, 't');
          const rec = await exec(
            ctx,
            tag,
            replies([fenced(json({ k: t }))], { json: { paths: [path('k', t)] } }),
          );
          return [expectV(rec, 0, 'json.valid', 'pass', true), expectV(rec, 0, 'json.path.0', 'pass', true)];
        },
      ],
      [
        'fence-with-no-language',
        3,
        'a code fence with no language word is read the same way',
        async (ctx) => {
          const tag = `${P}.json-fence.bare`;
          const t = tok(ctx, tag, 't');
          const rec = await exec(
            ctx,
            tag,
            replies([fenced(json({ k: t }), '')], { json: { paths: [path('k', t)] } }),
          );
          return [expectV(rec, 0, 'json.valid', 'pass', true), expectV(rec, 0, 'json.path.0', 'pass', true)];
        },
      ],
      [
        'prose-around-the-fence',
        4,
        'a fence with prose around it is no longer one fence: json.valid fails unless embedded is on',
        async (ctx) => {
          const tag = `${P}.json-fence.prose`;
          const t = tok(ctx, tag, 't');
          const text = `Here it is:\n${fenced(json({ k: t }))}\nDone.`;
          const rec = await exec(ctx, tag, [
            { text, expect: { json: { paths: [path('k', t)] } } },
            { text, expect: { json: { embedded: true, paths: [path('k', t)] } } },
          ]);
          return [expectV(rec, 0, 'json.valid', 'fail', true), expectV(rec, 1, 'json.valid', 'pass', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.json-schema`, CHECKS, 'json-schema-strict', [
      [
        'an-undeclared-key-fails',
        3,
        'a key that expect.json.schema does not declare fails json.schema; the declared shape passes',
        async (ctx) => {
          const tag = `${P}.json-schema.extra`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const schema = { type: 'object', properties: { [a]: { type: 'string' } } };
          const rec = await exec(
            ctx,
            tag,
            replies([json({ [a]: 'x' }), json({ [a]: 'x', [b]: 1 })], { json: { schema } }),
          );
          return [expectV(rec, 0, 'json.schema', 'pass', true), expectV(rec, 1, 'json.schema', 'fail', true)];
        },
      ],
      [
        'an-undeclared-key-in-a-nested-object',
        4,
        'strictness reaches a nested object: an undeclared key inside a declared object fails',
        async (ctx) => {
          const tag = `${P}.json-schema.nested`;
          const [a, b, c] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b'), tok(ctx, tag, 'c')] as [
            string,
            string,
            string,
          ];
          const schema = {
            type: 'object',
            properties: { [a]: { type: 'object', properties: { [b]: { type: 'string' } } } },
          };
          const rec = await exec(
            ctx,
            tag,
            replies([json({ [a]: { [b]: 'x' } }), json({ [a]: { [b]: 'x', [c]: 1 } })], { json: { schema } }),
          );
          return [expectV(rec, 0, 'json.schema', 'pass', true), expectV(rec, 1, 'json.schema', 'fail', true)];
        },
      ],
      [
        'an-undeclared-key-in-a-list-item',
        4,
        'strictness reaches the items of a list: an undeclared key in one item fails',
        async (ctx) => {
          const tag = `${P}.json-schema.items`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const schema = {
            type: 'array',
            items: { type: 'object', properties: { [a]: { type: 'string' } } },
          };
          const rec = await exec(
            ctx,
            tag,
            replies([json([{ [a]: 'x' }, { [a]: 'y' }]), json([{ [a]: 'x' }, { [a]: 'y', [b]: 2 }])], {
              json: { schema },
            }),
          );
          return [expectV(rec, 0, 'json.schema', 'pass', true), expectV(rec, 1, 'json.schema', 'fail', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.json-invalid`, CHECKS, 'json-invalid-fails-paths', [
      [
        'every-path-fails-with-a-reason',
        3,
        'a reply that is not JSON fails json.valid and every path after it, each with a reason',
        async (ctx) => {
          const tag = `${P}.json-invalid.paths`;
          const t = tok(ctx, tag, 't');
          const rec = await exec(
            ctx,
            tag,
            replies([`not json ${t}`], {
              json: { paths: [path('a', 1), path('b.0', t), path('c', { absent: true })] },
            }),
          );
          return [
            expectV(rec, 0, 'json.valid', 'fail', true),
            ...[0, 1, 2].map((i) => expectV(rec, 0, `json.path.${i}`, 'fail', true)),
            ...[0, 1, 2].map((i) =>
              String(verdict(rec, 0, `json.path.${i}`)?.evidence ?? '').length > 0
                ? undefined
                : `json.path.${i} gives no reason`,
            ),
          ];
        },
      ],
      [
        'an-absent-assertion-also-fails',
        4,
        'a reply that is not JSON also fails a path that asserts absence: there is nothing to read',
        async (ctx) => {
          const tag = `${P}.json-invalid.absent`;
          const rec = await exec(
            ctx,
            tag,
            replies([tok(ctx, tag, 't')], { json: { paths: [path('a', { absent: true })] } }),
          );
          return [expectV(rec, 0, 'json.valid', 'fail', true), expectV(rec, 0, 'json.path.0', 'fail', true)];
        },
      ],
      [
        'the-schema-fails-too',
        3,
        'a reply that is not JSON fails json.schema when a schema is given',
        async (ctx) => {
          const tag = `${P}.json-invalid.schema`;
          const rec = await exec(
            ctx,
            tag,
            replies([tok(ctx, tag, 't')], { json: { schema: { type: 'object', properties: {} } } }),
          );
          return [expectV(rec, 0, 'json.valid', 'fail', true), expectV(rec, 0, 'json.schema', 'fail', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.json-embedded`, CHECKS, 'json-embedded', [
      [
        'off-by-default',
        3,
        'a reply with prose around its JSON fails json.valid unless embedded is on',
        async (ctx) => {
          const tag = `${P}.json-embedded.off`;
          const t = tok(ctx, tag, 't');
          const text = `Sure: ${json({ k: t })} hope it helps`;
          const rec = await exec(ctx, tag, [
            { text, expect: { json: { paths: [path('k', t)] } } },
            { text, expect: { json: { embedded: false, paths: [path('k', t)] } } },
            { text, expect: { json: { embedded: true, paths: [path('k', t)] } } },
          ]);
          return [
            expectV(rec, 0, 'json.valid', 'fail', true),
            expectV(rec, 1, 'json.valid', 'fail', true),
            expectV(rec, 2, 'json.valid', 'pass', true),
            expectV(rec, 2, 'json.path.0', 'pass', true),
          ];
        },
      ],
      [
        'the-first-value-found',
        4,
        'with embedded on, the first JSON object or array found in the text is read, not a later one',
        async (ctx) => {
          const tag = `${P}.json-embedded.first`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const rec = await exec(ctx, tag, [
            {
              text: `first ${json({ k: a })} then ${json({ k: b })}`,
              expect: { json: { embedded: true, paths: [path('k', a)] } },
            },
            {
              text: `first ${json({ k: a })} then ${json({ k: b })}`,
              expect: { json: { embedded: true, paths: [path('k', b)] } },
            },
          ]);
          return [expectV(rec, 0, 'json.path.0', 'pass', true), expectV(rec, 1, 'json.path.0', 'fail', true)];
        },
      ],
      [
        'an-array-comes-first',
        4,
        'the first JSON value found may be an array: an array before an object is the one read, so the object has no key at the root',
        async (ctx) => {
          const tag = `${P}.json-embedded.array`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const text = `list ${json([a, a])} object ${json({ k: b })}`;
          const rec = await exec(ctx, tag, [
            { text, expect: { json: { embedded: true, paths: [path('0', a)] } } },
            { text, expect: { json: { embedded: true, paths: [path('k', { absent: true })] } } },
          ]);
          return [expectV(rec, 0, 'json.path.0', 'pass', true), expectV(rec, 1, 'json.path.0', 'pass', true)];
        },
      ],
      [
        'the-whole-reply-is-read-first',
        5,
        'with embedded on, a reply that is valid JSON as a whole is read whole, not by its first inner object',
        async (ctx) => {
          const tag = `${P}.json-embedded.whole`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const text = json({ [a]: { [b]: 1 } });
          const rec = await exec(ctx, tag, [
            { text, expect: { json: { embedded: true, paths: [path(`${a}.${b}`, 1)] } } },
            { text, expect: { json: { embedded: true, paths: [path(b, { absent: true })] } } },
          ]);
          return [expectV(rec, 0, 'json.path.0', 'pass', true), expectV(rec, 1, 'json.path.0', 'pass', true)];
        },
      ],
      [
        'no-json-at-all',
        3,
        'with embedded on, a reply with no JSON in it still fails json.valid',
        async (ctx) => {
          const tag = `${P}.json-embedded.none`;
          const rec = await exec(
            ctx,
            tag,
            replies([`plain words ${tok(ctx, tag, 't')}`], {
              json: { embedded: true, paths: [path('a', 1)] },
            }),
          );
          return [expectV(rec, 0, 'json.valid', 'fail', true), expectV(rec, 0, 'json.path.0', 'fail', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.json-missing`, CHECKS, 'json-missing-path-fails', [
      [
        'a-number-at-a-missing-key',
        3,
        'a path that reads nothing fails a bare number assertion; the check does not throw',
        async (ctx) => {
          const tag = `${P}.json-missing.number`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const rec = await exec(
            ctx,
            tag,
            replies([json({ [a]: 1 })], { json: { paths: [path(b, 1), path(a, 1)] } }),
          );
          return [
            expectV(rec, 0, 'json.path.0', 'fail', true),
            expectV(rec, 0, 'json.path.1', 'pass', true),
            idsAt(rec, 0).includes('json.error') ? 'the json check threw' : undefined,
          ];
        },
      ],
      [
        'a-text-at-a-missing-key',
        3,
        'a path that reads nothing fails a bare text assertion',
        async (ctx) => {
          const tag = `${P}.json-missing.text`;
          const [a, b, c] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b'), tok(ctx, tag, 'c')] as [
            string,
            string,
            string,
          ];
          const rec = await exec(
            ctx,
            tag,
            replies([json({ [a]: c })], { json: { paths: [path(b, c), path(a, c)] } }),
          );
          return [
            expectV(rec, 0, 'json.path.0', 'fail', true),
            expectV(rec, 0, 'json.path.1', 'pass', true),
            idsAt(rec, 0).includes('json.error') ? 'the json check threw' : undefined,
          ];
        },
      ],
      [
        'a-boolean-at-a-missing-key',
        3,
        'a path that reads nothing fails a bare boolean assertion',
        async (ctx) => {
          const tag = `${P}.json-missing.boolean`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const rec = await exec(
            ctx,
            tag,
            replies([json({ [a]: true })], { json: { paths: [path(b, true), path(a, true)] } }),
          );
          return [
            expectV(rec, 0, 'json.path.0', 'fail', true),
            expectV(rec, 0, 'json.path.1', 'pass', true),
            idsAt(rec, 0).includes('json.error') ? 'the json check threw' : undefined,
          ];
        },
      ],
      [
        'an-index-out-of-range',
        4,
        'an array index past the end reads nothing and fails a bare assertion',
        async (ctx) => {
          const tag = `${P}.json-missing.index`;
          const [a, k] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'k')] as [string, string];
          const rec = await exec(
            ctx,
            tag,
            replies([json({ [k]: [a] })], { json: { paths: [path(`${k}.3`, a), path(`${k}.0`, a)] } }),
          );
          return [
            expectV(rec, 0, 'json.path.0', 'fail', true),
            expectV(rec, 0, 'json.path.1', 'pass', true),
            idsAt(rec, 0).includes('json.error') ? 'the json check threw' : undefined,
          ];
        },
      ],
      [
        'a-path-through-a-scalar',
        4,
        'a path that goes through a value that is not an object reads nothing and fails a bare assertion',
        async (ctx) => {
          const tag = `${P}.json-missing.scalar`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const rec = await exec(
            ctx,
            tag,
            replies([json({ [a]: 5 })], {
              json: { paths: [path(`${a}.${b}`, 5), path(`${a}.${b}`, { absent: true })] },
            }),
          );
          return [
            expectV(rec, 0, 'json.path.0', 'fail', true),
            expectV(rec, 0, 'json.path.1', 'pass', true),
            idsAt(rec, 0).includes('json.error') ? 'the json check threw' : undefined,
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.json-paths`, CHECKS, 'json-paths-dotted', [
      [
        'a-number-indexes-an-array',
        3,
        'a number in a dotted path indexes an array, counting from 0',
        async (ctx) => {
          const tag = `${P}.json-paths.index`;
          const [a, b, k] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b'), tok(ctx, tag, 'k')] as [
            string,
            string,
            string,
          ];
          const rec = await exec(
            ctx,
            tag,
            replies([json({ [k]: [a, b] })], {
              json: { paths: [path(`${k}.0`, a), path(`${k}.1`, b), path(`${k}.1`, a)] },
            }),
          );
          return [
            expectV(rec, 0, 'json.path.0', 'pass', true),
            expectV(rec, 0, 'json.path.1', 'pass', true),
            expectV(rec, 0, 'json.path.2', 'fail', true),
          ];
        },
      ],
      [
        'a-deep-path',
        3,
        'a dotted path reaches through objects and arrays to a nested value',
        async (ctx) => {
          const tag = `${P}.json-paths.deep`;
          const [a, b, c] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b'), tok(ctx, tag, 'c')] as [
            string,
            string,
            string,
          ];
          const value = { [a]: [{ [b]: { [c]: 42 } }] };
          const rec = await exec(
            ctx,
            tag,
            replies([json(value)], {
              json: { paths: [path(`${a}.0.${b}.${c}`, 42), path(`${a}.0.${b}.${c}`, 43)] },
            }),
          );
          return [expectV(rec, 0, 'json.path.0', 'pass', true), expectV(rec, 0, 'json.path.1', 'fail', true)];
        },
      ],
      [
        'the-assertion-vocabulary',
        4,
        'a path asserts with the spec vocabulary: regex, contains, one_of, nonempty, absent and subset',
        async (ctx) => {
          const tag = `${P}.json-paths.vocab`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const value = { s: `${a}-${b}`, n: 7, l: [a, b], o: { x: 1, y: 2 }, e: '' };
          const cases: [Record<string, unknown>, 'pass' | 'fail'][] = [
            [path('s', { regex: `^${a}-` }), 'pass'],
            [path('s', { regex: `^${b}` }), 'fail'],
            [path('s', { contains: b }), 'pass'],
            [path('l', { contains: b }), 'pass'],
            [path('n', { one_of: [1, 7] }), 'pass'],
            [path('n', { one_of: [1, 2] }), 'fail'],
            [path('s', { nonempty: true }), 'pass'],
            [path('e', { nonempty: true }), 'fail'],
            [path('zzz', { absent: true }), 'pass'],
            [path('s', { absent: true }), 'fail'],
            [path('o', { subset: { x: 1 } }), 'pass'],
            [path('o', { subset: { x: 2 } }), 'fail'],
          ];
          const rec = await exec(
            ctx,
            tag,
            replies([json(value)], { json: { paths: cases.map(([p]) => p) } }),
          );
          return cases.map(([p, want], i) => {
            const found = expectV(rec, 0, `json.path.${i}`, want, true);
            return found && `${JSON.stringify(p)}: ${found}`;
          });
        },
      ],
    ]),
  ];
}

function markupItems(): BankItem[] {
  const m = (kind: string, text: string) => ({ text, expect: { markup: kind } });
  return [
    ...variants(FAMILY, `${P}.markup`, CHECKS, 'markup-structure', [
      [
        'xml-nesting',
        3,
        'xml that nests and closes every element is valid; a close that does not match the open element is not',
        async (ctx) => {
          const [a, b] = [tok(ctx, `${P}.markup.xml`, 'a', 5), tok(ctx, `${P}.markup.xml`, 'b', 5)] as [
            string,
            string,
          ];
          const rec = await exec(ctx, `${P}.markup.xml`, [
            m('xml', `<${a}><${b}>text</${b}></${a}>`),
            m('xml', `<${a}><${b}>text</${a}></${b}>`),
            m('xml', `<${a}><${b}>text</${b}>`),
            m('xml', `<${a}>text</${a}></${b}>`),
          ]);
          return (['pass', 'fail', 'fail', 'fail'] as const).map((want, i) =>
            expectV(rec, i, 'markup.valid', want, true),
          );
        },
      ],
      [
        'html-nesting',
        3,
        'html is read by its tags the same way: crossed tags are not well-formed',
        async (ctx) => {
          const [a, b] = ['p', 'b'];
          const rec = await exec(ctx, `${P}.markup.html`, [
            m('html', `<${a}>one <${b}>two</${b}></${a}>`),
            m('html', `<${a}>one <${b}>two</${a}></${b}>`),
            m('html', `<${a}>one`),
          ]);
          return (['pass', 'fail', 'fail'] as const).map((want, i) =>
            expectV(rec, i, 'markup.valid', want, true),
          );
        },
      ],
      [
        'attributes-are-not-checked',
        4,
        'markup checks structure only: attribute names and values do not matter',
        async (ctx) => {
          const tag = `${P}.markup.attrs`;
          const [a, k, v] = [tok(ctx, tag, 'a', 5), tok(ctx, tag, 'k', 5), tok(ctx, tag, 'v', 5)] as [
            string,
            string,
            string,
          ];
          const rec = await exec(ctx, tag, [
            m('xml', `<${a} ${k}="${v}" ${v}="${k}"><${a}>x</${a}></${a}>`),
            m('xml', `<${a} ${k}="${v}"><${a}>x</${a}>`),
          ]);
          return [
            expectV(rec, 0, 'markup.valid', 'pass', true),
            expectV(rec, 1, 'markup.valid', 'fail', true),
          ];
        },
      ],
      [
        'text-without-tags',
        3,
        'a reply with text and no tags holds no mismatched tag: the structure is fine',
        async (ctx) => {
          const tag = `${P}.markup.plain`;
          const t = tok(ctx, tag, 't', 9);
          const rec = await exec(ctx, tag, [m('xml', `<${t}>${t}</${t}>`), m('xml', `<${t}>${t}`)]);
          return [
            expectV(rec, 0, 'markup.valid', 'pass', true),
            expectV(rec, 1, 'markup.valid', 'fail', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.markup-sql`, CHECKS, 'markup-sql-syntax', [
      [
        'syntax-errors-fail',
        3,
        'a statement that SQLite cannot parse fails; a well-formed one passes',
        async (ctx) => {
          const rec = await exec(ctx, `${P}.markup-sql.syntax`, [
            m('sql', 'SELECT 1'),
            m('sql', 'SELECT FROM'),
            m('sql', 'SELEC 1'),
          ]);
          return (['pass', 'fail', 'fail'] as const).map((want, i) =>
            expectV(rec, i, 'markup.valid', want, true),
          );
        },
      ],
      [
        'an-unknown-table-is-valid',
        3,
        'a statement that names a table no schema holds is valid: only syntax errors fail',
        async (ctx) => {
          const tag = `${P}.markup-sql.table`;
          const [t, c] = [tok(ctx, tag, 't'), tok(ctx, tag, 'c')] as [string, string];
          const rec = await exec(ctx, tag, [
            m('sql', `SELECT ${c} FROM ${t} WHERE ${c} = 1`),
            m('sql', `INSERT INTO ${t} (${c}) VALUES (1)`),
          ]);
          return [
            expectV(rec, 0, 'markup.valid', 'pass', true),
            expectV(rec, 1, 'markup.valid', 'pass', true),
          ];
        },
      ],
      [
        'a-semicolon-inside-a-string',
        4,
        'statements split on semicolons outside strings: a semicolon inside a string literal splits nothing',
        async (ctx) => {
          const tag = `${P}.markup-sql.string`;
          const t = tok(ctx, tag, 't');
          const rec = await exec(ctx, tag, [
            m('sql', `SELECT 'a;b' AS ${t}`),
            m('sql', `SELECT 'a;b' AS ${t}; SELECT 2`),
            m('sql', `SELECT 'a;b AS ${t}`),
          ]);
          return [
            expectV(rec, 0, 'markup.valid', 'pass', true),
            expectV(rec, 1, 'markup.valid', 'pass', true),
            expectV(rec, 2, 'markup.valid', 'fail', true),
          ];
        },
      ],
      [
        'every-statement-is-parsed',
        4,
        'each statement of a reply is parsed: a syntax error in the second statement fails the reply',
        async (ctx) => {
          const rec = await exec(ctx, `${P}.markup-sql.each`, [
            m('sql', 'SELECT 1; SELECT 2'),
            m('sql', 'SELECT 1; SELECT FROM'),
            m('sql', 'SELECT FROM; SELECT 1'),
          ]);
          return (['pass', 'fail', 'fail'] as const).map((want, i) =>
            expectV(rec, i, 'markup.valid', want, true),
          );
        },
      ],
      [
        'a-trailing-semicolon',
        3,
        'a statement that ends with a semicolon is valid, and so is a reply of several',
        async (ctx) => {
          const rec = await exec(ctx, `${P}.markup-sql.trailing`, [
            m('sql', 'SELECT 1;'),
            m('sql', 'SELECT 1;\nSELECT 2;\n'),
          ]);
          return [
            expectV(rec, 0, 'markup.valid', 'pass', true),
            expectV(rec, 1, 'markup.valid', 'pass', true),
          ];
        },
      ],
    ]),
  ];
}

function regexItems(): BankItem[] {
  return [
    ...variants(FAMILY, `${P}.regex`, CHECKS, 'regex-own-verdict', [
      [
        'each-pattern-its-own-outcome',
        3,
        'regex gives each pattern its own verdict: a missing pattern fails alone',
        async (ctx) => {
          const tag = `${P}.regex.each`;
          const [a, b, c] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b'), tok(ctx, tag, 'c')] as [
            string,
            string,
            string,
          ];
          const rec = await exec(ctx, tag, [{ text: `${a} ${c}`, expect: { regex: [a, b, c] } }]);
          return [
            expectV(rec, 0, 'regex.0', 'pass', true),
            expectV(rec, 0, 'regex.1', 'fail', true),
            expectV(rec, 0, 'regex.2', 'pass', true),
            expectPass(rec, 0, false),
          ];
        },
      ],
      [
        'case-sensitive',
        3,
        'regex is case-sensitive, where must ignores case',
        async (ctx) => {
          const tag = `${P}.regex.case`;
          const t = tok(ctx, tag, 't');
          const up = t.toUpperCase();
          const rec = await exec(ctx, tag, [
            { text: `${up} here`, expect: { regex: [t] } },
            { text: `${up} here`, expect: { regex: [up] } },
            { text: `${up} here`, expect: { must: [t] } },
          ]);
          return [
            expectV(rec, 0, 'regex.0', 'fail', true),
            expectV(rec, 1, 'regex.0', 'pass', true),
            expectV(rec, 2, 'must.0', 'pass', true),
          ];
        },
      ],
      [
        'a-pattern-is-a-regular-expression',
        3,
        'a regex pattern is a regular expression, never a literal text: a class and a count match, the literal does not',
        async (ctx) => {
          const tag = `${P}.regex.expression`;
          const a = tok(ctx, tag, 'a');
          const rec = await exec(ctx, tag, [
            { text: `${a}2026 done`, expect: { regex: [`${a}\\d+`, `${a}\\d{4}\\b`, `${a}\\d{3}\\b`] } },
          ]);
          return [
            expectV(rec, 0, 'regex.0', 'pass', true),
            expectV(rec, 0, 'regex.1', 'pass', true),
            expectV(rec, 0, 'regex.2', 'fail', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.starts`, CHECKS, 'starts-with-whole-reply', [
      [
        'leading-space-removed',
        3,
        'starts_with removes the leading space of the reply first',
        async (ctx) => {
          const tag = `${P}.starts.space`;
          const t = tok(ctx, tag, 't');
          const rec = await exec(
            ctx,
            tag,
            replies([`   ${t} and more`, `\n\t${t} and more`], { starts_with: t }),
          );
          return [
            expectV(rec, 0, 'starts_with.0', 'pass', true),
            expectV(rec, 1, 'starts_with.0', 'pass', true),
          ];
        },
      ],
      [
        'later-occurrence-fails',
        3,
        'a reply that holds the text later but does not start with it fails',
        async (ctx) => {
          const tag = `${P}.starts.later`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const rec = await exec(ctx, tag, replies([`${b} then ${a}`, `${a} then ${b}`], { starts_with: a }));
          return [
            expectV(rec, 0, 'starts_with.0', 'fail', true),
            expectV(rec, 1, 'starts_with.0', 'pass', true),
          ];
        },
      ],
      [
        'the-start-of-the-reply-not-of-a-line',
        4,
        'starts_with checks the whole reply: the text at the start of a later line fails, where a ^ pattern in must passes',
        async (ctx) => {
          const tag = `${P}.starts.line`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const rec = await exec(ctx, tag, [
            { text: `${b}\n${a} next`, expect: { starts_with: a, must: [`^${a}`] } },
          ]);
          return [expectV(rec, 0, 'starts_with.0', 'fail', true), expectV(rec, 0, 'must.0', 'pass', true)];
        },
      ],
    ]),
  ];
}

function exactItems(): BankItem[] {
  const f = (
    id: string,
    tier: 3 | 4,
    title: string,
    cases: (ctx: ItemContext, tag: string) => [string, string, 'pass' | 'fail'][],
    strict = false,
  ) =>
    [
      id,
      tier,
      title,
      async (ctx: ItemContext) => {
        const tag = `${P}.exact.${id}`;
        const list = cases(ctx, tag);
        const rec = await exec(
          ctx,
          tag,
          list.map(([text, reference]) => ({
            text,
            expect: { exact: reference, ...(strict ? { exact_strict: true } : {}) },
          })),
        );
        return list.map(([text, reference, want], i) => {
          const found = expectV(rec, i, 'exact.0', want, true);
          return found && `reply ${JSON.stringify(text)} against ${JSON.stringify(reference)}: ${found}`;
        });
      },
    ] as const;
  return [
    ...variants(FAMILY, `${P}.exact-norm`, CHECKS, 'exact-normalising', [
      f(
        'whitespace-runs',
        3,
        'exact collapses runs of whitespace, line breaks included, and trims the ends',
        (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          return [
            [`  ${a}   ${b}  `, `${a} ${b}`, 'pass'],
            [`${a}\n\n${b}`, `${a} ${b}`, 'pass'],
            [`${a}${b}`, `${a} ${b}`, 'fail'],
          ];
        },
      ),
      f(
        'punctuation-dropped',
        3,
        'exact drops every character that is not a letter, a digit or a space, inside a word too',
        (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          return [
            [`${a}-${b}, ${a}!`, `${a}${b} ${a}`, 'pass'],
            [`"${a}" (${b})`, `${a} ${b}`, 'pass'],
            [`${a} ${b} ${a}`, `${a} ${b}`, 'fail'],
          ];
        },
      ),
      f('case-is-ignored', 3, 'exact lowers the case of both sides', (ctx, tag) => {
        const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
        return [
          [`${a.toUpperCase()} ${b}`, `${a} ${b.toUpperCase()}`, 'pass'],
          [`${a} ${b}`, `${a} ${a}`, 'fail'],
        ];
      }),
      f(
        'an-empty-reply-never-equals',
        4,
        'an empty reply never equals a reference, even one that normalises to nothing',
        () => [
          ['', '!!!', 'fail'],
          ['   ', '...', 'fail'],
          ['', 'a', 'fail'],
        ],
      ),
      [
        'evidence-gives-both-forms',
        4,
        'a failing exact verdict gives both normalised forms in its evidence',
        async (ctx: ItemContext) => {
          const tag = `${P}.exact.evidence`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const rec = await exec(ctx, tag, [
            { text: `  ${a.toUpperCase()}!!  ${b}`, expect: { exact: `${a} ${a}.` } },
          ]);
          const text = String(verdict(rec, 0, 'exact.0')?.evidence ?? '');
          return [
            expectV(rec, 0, 'exact.0', 'fail', true),
            text.includes(`${a} ${b}`)
              ? undefined
              : `the evidence does not give the normalised reply "${a} ${b}": ${text.slice(0, 160)}`,
            text.includes(`${a} ${a}`)
              ? undefined
              : `the evidence does not give the normalised reference "${a} ${a}": ${text.slice(0, 160)}`,
          ];
        },
      ],
    ] as unknown as ReadonlyArray<
      readonly [string, 3 | 4, string, (ctx: ItemContext) => Promise<(string | undefined)[]>]
    >),
    ...variants(FAMILY, `${P}.exact-true`, CHECKS, 'exact-true-is-one', [
      f(
        'true-and-one',
        3,
        'exact reads true as 1: a reply true equals the reference 1, and a reply 1 equals true',
        () => [
          ['true', '1', 'pass'],
          ['1', 'true', 'pass'],
          [' true ', '1', 'pass'],
          ['true!', '1', 'pass'],
        ],
      ),
      f('true-in-any-case', 3, 'exact reads True and TRUE as 1 too: the case is lowered first', () => [
        ['True', '1', 'pass'],
        ['TRUE', '1', 'pass'],
        ['1', 'TRUE', 'pass'],
      ]),
      f('false-and-other-numbers', 3, 'exact does not read false or true as any other number', () => [
        ['false', '1', 'fail'],
        ['true', '2', 'fail'],
        ['true', '0', 'fail'],
      ]),
    ]),
    ...variants(FAMILY, `${P}.exact-strict`, CHECKS, 'exact-strict-bytes', [
      f(
        'trimmed-ends-only',
        3,
        'exact_strict trims the ends of the reply and compares the rest byte for byte',
        (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          return [
            [`  ${a} ${b}\n`, `${a} ${b}`, 'pass'],
            [`${a}  ${b}`, `${a} ${b}`, 'fail'],
          ];
        },
        true,
      ),
      f(
        'case-counts',
        3,
        'exact_strict counts the case of every letter',
        (ctx, tag) => {
          const a = tok(ctx, tag, 'a');
          return [
            [a, a, 'pass'],
            [a.toUpperCase(), a, 'fail'],
            [`${a[0]?.toUpperCase()}${a.slice(1)}`, a, 'fail'],
          ];
        },
        true,
      ),
      f(
        'punctuation-counts',
        3,
        'exact_strict counts punctuation that exact ignores',
        (ctx, tag) => {
          const a = tok(ctx, tag, 'a');
          return [
            [`${a}.`, a, 'fail'],
            [`${a}.`, `${a}.`, 'pass'],
            [`(${a})`, a, 'fail'],
          ];
        },
        true,
      ),
    ]),
  ];
}

export function textItems(): BankItem[] {
  return [...finishItems(), ...jsonItems(), ...markupItems(), ...regexItems(), ...exactItems()];
}
