import {
  type BankItem,
  exec,
  expectPass,
  expectV,
  type ItemContext,
  idsAt,
  type Probe,
  type Row,
  type Tier,
  tok,
  variants,
  verdict,
} from './kit';

/**
 * gr-strict: `schema_strict` (docs/reference/checks.md "Strict tool schemas"). A schema in each of the three
 * forms the page names, a call whose input the schema accepts and calls it refuses, one rule of the schema at a
 * time: an undeclared key, additionalProperties, required, type, enum and const, bounds, pattern, items, nullable,
 * the combinators, the numbering of the verdicts and the keywords the page does not support.
 */

const FAMILY = 'gr-strict';
const CHECKS = 'packages/checks';
const P = 'gr.checks.strict';

type Schema = Record<string, unknown>;
type Form = 'json' | 'openai' | 'anthropic';

const wrap = (form: Form, tool: string, schema: Schema): Schema =>
  form === 'json'
    ? schema
    : form === 'openai'
      ? { name: tool, description: 'A planted tool.', parameters: schema }
      : { name: tool, description: 'A planted tool.', input_schema: schema };

const obj = (properties: Record<string, Schema>, rest: Schema = {}): Schema => ({
  type: 'object',
  properties,
  ...rest,
});

type Names = { tool: string; a: string; b: string; c: string };

/** One block per input, each calling the tool once: the outcome of schema_strict.<tool>.1 for each. */
async function strictRun(
  ctx: ItemContext,
  tag: string,
  schema: Schema,
  inputs: unknown[],
  form: Form = 'json',
  tool = tok(ctx, tag, 'tool', 7),
) {
  const rows: Row[] = inputs.map((input) => ({
    calls: [{ label: tool, input: input as Record<string, unknown> }],
  }));
  const rec = await exec(ctx, tag, rows, {
    spec: { metadata: { tool_schemas: { [tool]: wrap(form, tool, schema) } } },
  });
  return { rec, id: `schema_strict.${tool}.1` };
}

function names(ctx: ItemContext, tag: string): Names {
  return {
    tool: tok(ctx, tag, 'tool', 7),
    a: tok(ctx, tag, 'a', 5),
    b: tok(ctx, tag, 'b', 5),
    c: tok(ctx, tag, 'c', 5),
  };
}

/** An item that runs `cases` against `schema(n)` in the given form. */
function strict(
  suite: string,
  id: string,
  tier: Tier,
  title: string,
  build: (n: Names) => { schema: Schema; cases: [unknown, boolean][]; form?: Form },
): readonly [string, Tier, string, Probe] {
  return [
    id,
    tier,
    title,
    async (ctx) => {
      const tag = `${P}.${suite}.${id}`;
      const n = names(ctx, tag);
      const made = build(n);
      const { rec, id: vid } = await strictRun(
        ctx,
        tag,
        made.schema,
        made.cases.map(([input]) => input),
        made.form ?? 'json',
        n.tool,
      );
      return made.cases.map(([input, ok], i) => {
        const found = expectV(rec, i, vid, ok ? 'pass' : 'fail', true);
        return found && `input ${JSON.stringify(input)}: ${found}`;
      });
    },
  ];
}

const simple = (n: Names): Schema => obj({ [n.a]: { type: 'string' } }, { required: [n.a] });
const simpleCases = (n: Names): [unknown, boolean][] => [
  [{ [n.a]: 'x' }, true],
  [{ [n.a]: 'x', [n.b]: 'y' }, false],
  [{}, false],
];

export function strictItems(): BankItem[] {
  return [
    ...variants(FAMILY, `${P}.forms`, CHECKS, 'strict-schema-forms', [
      strict(
        'forms',
        'json-schema',
        3,
        'a schema written as a plain JSON Schema is read: the declared shape passes, an extra key and a missing key fail',
        (n) => ({ schema: simple(n), cases: simpleCases(n) }),
      ),
      strict(
        'forms',
        'openai-function',
        3,
        'a schema written as an OpenAI-style function with parameters is read the same way',
        (n) => ({ schema: simple(n), cases: simpleCases(n), form: 'openai' }),
      ),
      strict(
        'forms',
        'anthropic-tool',
        3,
        'a schema written as an Anthropic-style tool with input_schema is read the same way',
        (n) => ({ schema: simple(n), cases: simpleCases(n), form: 'anthropic' }),
      ),
    ]),
    ...variants(FAMILY, `${P}.extra`, CHECKS, 'strict-undeclared-key', [
      strict(
        'extra',
        'flat',
        3,
        'a key an object schema does not declare is an invented parameter and fails',
        (n) => ({
          schema: obj({ [n.a]: { type: 'string' }, [n.b]: { type: 'string' } }),
          cases: [
            [{ [n.a]: 'x' }, true],
            [{ [n.a]: 'x', [n.b]: 'y' }, true],
            [{ [n.c]: 'z' }, false],
            [{ [n.a]: 'x', [n.c]: 'z' }, false],
          ],
        }),
      ),
      strict('extra', 'nested-object', 4, 'strictness reaches an object inside an object', (n) => ({
        schema: obj({ [n.a]: obj({ [n.b]: { type: 'string' } }) }),
        cases: [
          [{ [n.a]: { [n.b]: 'x' } }, true],
          [{ [n.a]: { [n.b]: 'x', [n.c]: 1 } }, false],
        ],
      })),
      strict('extra', 'list-of-objects', 4, 'strictness reaches the objects inside a list', (n) => ({
        schema: obj({ [n.a]: { type: 'array', items: obj({ [n.b]: { type: 'string' } }) } }),
        cases: [
          [{ [n.a]: [{ [n.b]: 'x' }, { [n.b]: 'y' }] }, true],
          [{ [n.a]: [{ [n.b]: 'x' }, { [n.b]: 'y', [n.c]: 1 }] }, false],
        ],
      })),
    ]),
    ...variants(FAMILY, `${P}.additional`, CHECKS, 'strict-additional-properties', [
      strict(
        'additional',
        'true-allows-other-keys',
        3,
        'additionalProperties true allows a key the schema does not declare',
        (n) => ({
          schema: obj({ [n.a]: { type: 'string' } }, { additionalProperties: true }),
          cases: [
            [{ [n.a]: 'x', [n.b]: 1 }, true],
            [{ [n.b]: 1 }, true],
            [{ [n.a]: 1 }, false],
          ],
        }),
      ),
      strict(
        'additional',
        'no-properties-no-refusal',
        4,
        'an object schema that declares no properties refuses no key',
        (n) => ({
          schema: { type: 'object' },
          cases: [
            [{ [n.a]: 'x', [n.b]: 1 }, true],
            [{}, true],
          ],
        }),
      ),
      strict(
        'additional',
        'false-refuses',
        3,
        'additionalProperties false refuses an undeclared key, as the default does',
        (n) => ({
          schema: obj({ [n.a]: { type: 'string' } }, { additionalProperties: false }),
          cases: [
            [{ [n.a]: 'x' }, true],
            [{ [n.a]: 'x', [n.b]: 'y' }, false],
          ],
        }),
      ),
      strict(
        'additional',
        'true-in-a-nested-object',
        4,
        'additionalProperties true on a nested object allows its extra keys, and the top level still refuses its own',
        (n) => ({
          schema: obj({ [n.a]: obj({ [n.b]: { type: 'string' } }, { additionalProperties: true }) }),
          cases: [
            [{ [n.a]: { [n.b]: 'x', [n.c]: 1 } }, true],
            [{ [n.a]: { [n.b]: 'x' }, [n.c]: 1 }, false],
          ],
        }),
      ),
    ]),
    ...variants(FAMILY, `${P}.required`, CHECKS, 'strict-required', [
      strict('required', 'one-key', 3, 'a required key that is missing fails; present, it passes', (n) => ({
        schema: obj({ [n.a]: { type: 'string' }, [n.b]: { type: 'string' } }, { required: [n.a] }),
        cases: [
          [{ [n.a]: 'x' }, true],
          [{ [n.b]: 'y' }, false],
          [{ [n.a]: 'x', [n.b]: 'y' }, true],
        ],
      })),
      strict(
        'required',
        'two-keys',
        3,
        'every required key must be present: one of two is not enough',
        (n) => ({
          schema: obj({ [n.a]: { type: 'string' }, [n.b]: { type: 'string' } }, { required: [n.a, n.b] }),
          cases: [
            [{ [n.a]: 'x' }, false],
            [{ [n.b]: 'y' }, false],
            [{ [n.a]: 'x', [n.b]: 'y' }, true],
          ],
        }),
      ),
      strict(
        'required',
        'in-a-nested-object',
        4,
        'required inside a nested object is checked there',
        (n) => ({
          schema: obj({
            [n.a]: obj({ [n.b]: { type: 'string' }, [n.c]: { type: 'string' } }, { required: [n.b] }),
          }),
          cases: [
            [{ [n.a]: { [n.b]: 'x' } }, true],
            [{ [n.a]: { [n.c]: 'x' } }, false],
          ],
        }),
      ),
    ]),
    ...variants(FAMILY, `${P}.type`, CHECKS, 'strict-type', [
      strict('type', 'string', 3, 'a property of type string refuses a number, a boolean and null', (n) => ({
        schema: obj({ [n.a]: { type: 'string' } }),
        cases: [
          [{ [n.a]: 'x' }, true],
          [{ [n.a]: 1 }, false],
          [{ [n.a]: true }, false],
          [{ [n.a]: null }, false],
        ],
      })),
      strict(
        'type',
        'number-and-integer',
        3,
        'a number takes 1.5; an integer takes 2 and refuses 2.5; neither takes the text "2"',
        (n) => ({
          schema: obj({ [n.a]: { type: 'number' }, [n.b]: { type: 'integer' } }),
          cases: [
            [{ [n.a]: 1.5, [n.b]: 2 }, true],
            [{ [n.a]: 1.5, [n.b]: 2.5 }, false],
            [{ [n.a]: '2' }, false],
            [{ [n.b]: '2' }, false],
          ],
        }),
      ),
      strict('type', 'boolean-array-object', 4, 'boolean, array and object each refuse the others', (n) => ({
        schema: obj({ [n.a]: { type: 'boolean' }, [n.b]: { type: 'array' }, [n.c]: { type: 'object' } }),
        cases: [
          [{ [n.a]: true, [n.b]: [], [n.c]: {} }, true],
          [{ [n.a]: 'true' }, false],
          [{ [n.b]: {} }, false],
          [{ [n.c]: [] }, false],
        ],
      })),
    ]),
    ...variants(FAMILY, `${P}.enum`, CHECKS, 'strict-enum-and-const', [
      strict('enum', 'text-members', 3, 'an enum accepts its members and refuses any other text', (n) => ({
        schema: obj({ [n.a]: { enum: [n.b, n.c] } }),
        cases: [
          [{ [n.a]: n.b }, true],
          [{ [n.a]: n.c }, true],
          [{ [n.a]: `${n.b}x` }, false],
        ],
      })),
      strict(
        'enum',
        'number-members',
        3,
        'an enum of numbers accepts those numbers and refuses the same digits as a text',
        () => ({
          schema: obj({ x: { enum: [1, 2, 3] } }),
          cases: [
            [{ x: 2 }, true],
            [{ x: '2' }, false],
            [{ x: 4 }, false],
          ],
        }),
      ),
      strict('enum', 'const', 3, 'a const accepts that value only', (n) => ({
        schema: obj({ [n.a]: { const: n.b }, [n.c]: { const: 5 } }),
        cases: [
          [{ [n.a]: n.b, [n.c]: 5 }, true],
          [{ [n.a]: n.c }, false],
          [{ [n.c]: 6 }, false],
        ],
      })),
    ]),
    ...variants(FAMILY, `${P}.bounds`, CHECKS, 'strict-bounds', [
      strict('bounds', 'string-length', 3, 'minLength and maxLength bound a text and are inclusive', (n) => ({
        schema: obj({ [n.a]: { type: 'string', minLength: 2, maxLength: 4 } }),
        cases: [
          [{ [n.a]: 'a' }, false],
          [{ [n.a]: 'ab' }, true],
          [{ [n.a]: 'abcd' }, true],
          [{ [n.a]: 'abcde' }, false],
        ],
      })),
      strict('bounds', 'number-range', 3, 'minimum and maximum bound a number and are inclusive', (n) => ({
        schema: obj({ [n.a]: { type: 'number', minimum: 1, maximum: 10 } }),
        cases: [
          [{ [n.a]: 0.5 }, false],
          [{ [n.a]: 1 }, true],
          [{ [n.a]: 10 }, true],
          [{ [n.a]: 10.5 }, false],
        ],
      })),
      strict('bounds', 'list-size', 3, 'minItems and maxItems bound a list and are inclusive', (n) => ({
        schema: obj({ [n.a]: { type: 'array', minItems: 1, maxItems: 2 } }),
        cases: [
          [{ [n.a]: [] }, false],
          [{ [n.a]: [1] }, true],
          [{ [n.a]: [1, 2] }, true],
          [{ [n.a]: [1, 2, 3] }, false],
        ],
      })),
    ]),
    ...variants(FAMILY, `${P}.pattern`, CHECKS, 'strict-pattern', [
      strict(
        'pattern',
        'anchored',
        3,
        'an anchored pattern accepts a text that fits it whole and refuses the others',
        (n) => ({
          schema: obj({ [n.a]: { type: 'string', pattern: '^[a-z]+$' } }),
          cases: [
            [{ [n.a]: 'abc' }, true],
            [{ [n.a]: 'ABC' }, false],
            [{ [n.a]: 'ab1' }, false],
          ],
        }),
      ),
      strict(
        'pattern',
        'matches-anywhere',
        4,
        'an unanchored pattern accepts a text that holds a match anywhere',
        (n) => ({
          schema: obj({ [n.a]: { type: 'string', pattern: 'ab' } }),
          cases: [
            [{ [n.a]: 'xxabxx' }, true],
            [{ [n.a]: 'ab' }, true],
            [{ [n.a]: 'xx' }, false],
          ],
        }),
      ),
      strict(
        'pattern',
        'digits',
        3,
        'a pattern with classes and counts: three digits, a dash, two digits',
        (n) => ({
          schema: obj({ [n.a]: { type: 'string', pattern: '^\\d{3}-\\d{2}$' } }),
          cases: [
            [{ [n.a]: '123-45' }, true],
            [{ [n.a]: '12-345' }, false],
            [{ [n.a]: '123-456' }, false],
          ],
        }),
      ),
    ]),
    ...variants(FAMILY, `${P}.items`, CHECKS, 'strict-items', [
      strict(
        'items',
        'typed',
        3,
        'items of type string accepts a list of texts and refuses a list with a number in it',
        (n) => ({
          schema: obj({ [n.a]: { type: 'array', items: { type: 'string' } } }),
          cases: [
            [{ [n.a]: ['x', 'y'] }, true],
            [{ [n.a]: ['x', 1] }, false],
            [{ [n.a]: [] }, true],
          ],
        }),
      ),
      strict('items', 'enum', 3, 'items with an enum accepts only lists of its members', (n) => ({
        schema: obj({ [n.a]: { type: 'array', items: { enum: [n.b, n.c] } } }),
        cases: [
          [{ [n.a]: [n.b, n.c, n.b] }, true],
          [{ [n.a]: [n.b, `${n.c}x`] }, false],
        ],
      })),
      strict(
        'items',
        'bounded-numbers',
        4,
        'items hold their own bounds: every number of the list must fit',
        (n) => ({
          schema: obj({ [n.a]: { type: 'array', items: { type: 'number', minimum: 0 } } }),
          cases: [
            [{ [n.a]: [0, 1, 2] }, true],
            [{ [n.a]: [0, -1] }, false],
          ],
        }),
      ),
    ]),
    ...variants(FAMILY, `${P}.nullable`, CHECKS, 'strict-nullable', [
      strict('nullable', 'allows-null', 3, 'nullable true allows null beside the type', (n) => ({
        schema: obj({ [n.a]: { type: 'string', nullable: true } }),
        cases: [
          [{ [n.a]: null }, true],
          [{ [n.a]: 'x' }, true],
          [{ [n.a]: 1 }, false],
        ],
      })),
      strict('nullable', 'null-refused-by-default', 3, 'without nullable, null is not a text', (n) => ({
        schema: obj({ [n.a]: { type: 'string' }, [n.b]: { type: 'string', nullable: false } }),
        cases: [
          [{ [n.a]: null }, false],
          [{ [n.b]: null }, false],
          [{ [n.a]: 'x', [n.b]: 'y' }, true],
        ],
      })),
      strict('nullable', 'integer', 4, 'a nullable integer takes null and integers and refuses 3.5', (n) => ({
        schema: obj({ [n.a]: { type: 'integer', nullable: true } }),
        cases: [
          [{ [n.a]: null }, true],
          [{ [n.a]: 3 }, true],
          [{ [n.a]: 3.5 }, false],
        ],
      })),
    ]),
    ...variants(FAMILY, `${P}.combine`, CHECKS, 'strict-combinators', [
      strict('combine', 'any-of', 3, 'anyOf accepts a value that fits at least one alternative', (n) => ({
        schema: obj({ [n.a]: { anyOf: [{ type: 'string' }, { type: 'number' }] } }),
        cases: [
          [{ [n.a]: 'x' }, true],
          [{ [n.a]: 3 }, true],
          [{ [n.a]: true }, false],
        ],
      })),
      strict(
        'combine',
        'one-of',
        4,
        'oneOf accepts a value that fits exactly one alternative: two fits is a fail',
        (n) => ({
          schema: obj({
            [n.a]: {
              oneOf: [
                { type: 'number', minimum: 0 },
                { type: 'number', maximum: 10 },
              ],
            },
          }),
          cases: [
            [{ [n.a]: 5 }, false],
            [{ [n.a]: -1 }, true],
            [{ [n.a]: 11 }, true],
          ],
        }),
      ),
      strict('combine', 'all-of', 3, 'allOf accepts a value that fits every alternative', (n) => ({
        schema: obj({ [n.a]: { allOf: [{ type: 'string' }, { minLength: 2 }] } }),
        cases: [
          [{ [n.a]: 'ab' }, true],
          [{ [n.a]: 'a' }, false],
          [{ [n.a]: 3 }, false],
        ],
      })),
    ]),
    ...variants(FAMILY, `${P}.numbering`, CHECKS, 'strict-verdict-per-call', [
      [
        'one-tool-three-calls',
        3,
        'one verdict per call, numbered from 1: three calls of one tool give .1, .2 and .3, each judged on its own input',
        async (ctx) => {
          const tag = `${P}.numbering.three`;
          const n = names(ctx, tag);
          const rec = await exec(
            ctx,
            tag,
            [
              {
                calls: [
                  { label: n.tool, input: { [n.a]: 'x' } },
                  { label: n.tool, input: { [n.b]: 'x' } },
                  { label: n.tool, input: { [n.a]: 'y' } },
                ],
              },
            ],
            { spec: { metadata: { tool_schemas: { [n.tool]: obj({ [n.a]: { type: 'string' } }) } } } },
          );
          return [1, 2, 3].map((k) =>
            expectV(rec, 0, `schema_strict.${n.tool}.${k}`, k === 2 ? 'fail' : 'pass', true),
          );
        },
      ],
      [
        'two-tools-counted-apart',
        3,
        'the number counts the calls of one tool: two tools called in turn each count from 1',
        async (ctx) => {
          const tag = `${P}.numbering.two`;
          const n = names(ctx, tag);
          const other = tok(ctx, tag, 'other', 7);
          const rec = await exec(
            ctx,
            tag,
            [
              {
                calls: [
                  { label: n.tool, input: {} },
                  { label: other, input: { z: 1 } },
                  { label: n.tool, input: {} },
                  { label: other, input: {} },
                ],
              },
            ],
            {
              spec: {
                metadata: { tool_schemas: { [n.tool]: obj({}), [other]: obj({ z: { type: 'number' } }) } },
              },
            },
          );
          return [
            expectV(rec, 0, `schema_strict.${n.tool}.1`, 'pass', true),
            expectV(rec, 0, `schema_strict.${n.tool}.2`, 'pass', true),
            expectV(rec, 0, `schema_strict.${other}.1`, 'pass', true),
            expectV(rec, 0, `schema_strict.${other}.2`, 'pass', true),
            idsAt(rec, 0).includes(`schema_strict.${other}.3`)
              ? 'a third verdict for a tool called twice'
              : undefined,
          ];
        },
      ],
      [
        'the-count-restarts-in-each-block',
        3,
        'the count restarts in each block: the first call of a tool in the second block is .1 again',
        async (ctx) => {
          const tag = `${P}.numbering.blocks`;
          const n = names(ctx, tag);
          const rec = await exec(
            ctx,
            tag,
            [
              {
                calls: [
                  { label: n.tool, input: {} },
                  { label: n.tool, input: {} },
                ],
              },
              { calls: [{ label: n.tool, input: { z: 1 } }] },
            ],
            { spec: { metadata: { tool_schemas: { [n.tool]: obj({}) } } } },
          );
          return [
            expectV(rec, 0, `schema_strict.${n.tool}.2`, 'pass', true),
            expectV(rec, 1, `schema_strict.${n.tool}.1`, 'fail', true),
            idsAt(rec, 1).includes(`schema_strict.${n.tool}.3`) ? 'the count did not restart' : undefined,
          ];
        },
      ],
    ]),
    ...unsupportedItems(),
  ];
}

/** A schema that reaches the check without spec parsing: the loader accepted a plain one, the item swaps it in. */
function unsupportedItems(): BankItem[] {
  const f = (
    id: string,
    keyword: string,
    place: (n: Names) => Schema,
  ): readonly [string, Tier, string, Probe] => [
    id,
    4,
    `a schema that holds the unsupported keyword ${keyword} and reaches the check unparsed gives an inconclusive gating verdict that names it`,
    async (ctx) => {
      const tag = `${P}.unsupported.${id}`;
      const n = names(ctx, tag);
      const rec = await exec(ctx, tag, [{ calls: [{ label: n.tool, input: { [n.a]: 'x' } }] }], {
        spec: { metadata: { tool_schemas: { [n.tool]: obj({ [n.a]: { type: 'string' } }) } } },
        mutate: (spec) => {
          const meta = spec.metadata as { tool_schemas: Record<string, unknown> };
          meta.tool_schemas[n.tool] = place(n);
        },
      });
      const found = verdict(rec, 0, `schema_strict.${n.tool}.1`);
      const idAny = idsAt(rec, 0).find((each) => each.startsWith('schema_strict.'));
      const text = String(found?.evidence ?? '');
      return [
        found
          ? undefined
          : `no verdict schema_strict.${n.tool}.1; the block has ${idAny ?? 'no schema_strict verdict'}`,
        found?.outcome === 'inconclusive' && found.gating
          ? undefined
          : `the verdict should be inconclusive and gating; it is ${found?.outcome} (${found?.gating ? 'gating' : 'not gating'})`,
        text.includes(keyword)
          ? undefined
          : `the evidence does not name the keyword ${keyword}: ${text.slice(0, 140)}`,
        expectPass(rec, 0, false),
      ];
    },
  ];
  return [
    ...variants(FAMILY, `${P}.unsupported`, CHECKS, 'strict-unsupported-keyword-inconclusive', [
      f('ref', '$ref', (n) => obj({ [n.a]: { $ref: '#/definitions/x' } })),
      f('not', 'not', (n) => obj({ [n.a]: { not: { type: 'number' } } })),
      f('multiple-of', 'multipleOf', (n) => obj({ [n.a]: { type: 'number', multipleOf: 2 } })),
      f('format', 'format', (n) => obj({ [n.a]: { type: 'string', format: 'email' } })),
      f('pattern-properties', 'patternProperties', (n) => ({
        type: 'object',
        patternProperties: { '^x': { type: 'string' } },
        properties: { [n.a]: { type: 'string' } },
      })),
    ]),
    ...variants(FAMILY, `${P}.data`, CHECKS, 'strict-names-and-values-are-data', [
      [
        'a-property-named-like-a-keyword',
        4,
        'a property whose name is a schema keyword is a property: format, not and $ref are names there, not keywords',
        async (ctx) => {
          const tag = `${P}.data.names`;
          const tool = tok(ctx, tag, 'tool', 7);
          const schema = obj({
            format: { type: 'string' },
            not: { type: 'number' },
            $ref: { type: 'string' },
          });
          const rec = await exec(
            ctx,
            tag,
            [
              { calls: [{ label: tool, input: { format: 'x', not: 1, $ref: 'y' } }] },
              { calls: [{ label: tool, input: { format: 1 } }] },
            ],
            { spec: { metadata: { tool_schemas: { [tool]: schema } } } },
          );
          return [
            expectV(rec, 0, `schema_strict.${tool}.1`, 'pass', true),
            expectV(rec, 1, `schema_strict.${tool}.1`, 'fail', true),
          ];
        },
      ],
      [
        'enum-and-const-values',
        4,
        'values inside enum and const are data: the text "$ref" or "multipleOf" is a member, not a keyword',
        async (ctx) => {
          const tag = `${P}.data.values`;
          const tool = tok(ctx, tag, 'tool', 7);
          const schema = obj({ a: { enum: ['$ref', 'multipleOf', 'not'] }, b: { const: 'format' } });
          const rec = await exec(
            ctx,
            tag,
            [
              { calls: [{ label: tool, input: { a: '$ref', b: 'format' } }] },
              { calls: [{ label: tool, input: { a: 'format' } }] },
            ],
            { spec: { metadata: { tool_schemas: { [tool]: schema } } } },
          );
          return [
            expectV(rec, 0, `schema_strict.${tool}.1`, 'pass', true),
            expectV(rec, 1, `schema_strict.${tool}.1`, 'fail', true),
          ];
        },
      ],
      [
        'annotations-are-accepted',
        3,
        'title, description, default, examples, $schema, $id and $comment are accepted and change nothing',
        async (ctx) => {
          const tag = `${P}.data.annotations`;
          const tool = tok(ctx, tag, 'tool', 7);
          const schema: Schema = {
            $schema: 'http://json-schema.org/draft-07/schema#',
            $id: 'https://example.com/tool.json',
            $comment: 'planted',
            title: 'A tool',
            description: 'A planted schema.',
            type: 'object',
            properties: {
              a: { type: 'string', title: 'A', description: 'a text', default: 'x', examples: ['y'] },
            },
          };
          const rec = await exec(
            ctx,
            tag,
            [
              { calls: [{ label: tool, input: { a: 'z' } }] },
              { calls: [{ label: tool, input: { a: 1 } }] },
              { calls: [{ label: tool, input: { b: 'z' } }] },
            ],
            { spec: { metadata: { tool_schemas: { [tool]: schema } } } },
          );
          return [
            expectV(rec, 0, `schema_strict.${tool}.1`, 'pass', true),
            expectV(rec, 1, `schema_strict.${tool}.1`, 'fail', true),
            expectV(rec, 2, `schema_strict.${tool}.1`, 'fail', true),
          ];
        },
      ],
    ]),
  ];
}
