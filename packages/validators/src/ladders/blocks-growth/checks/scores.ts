import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { between, rngFor } from '../../blocks/harness';
import { need } from '../../blocks/product';
import {
  type BankItem,
  exec,
  expectNone,
  expectPass,
  expectV,
  type ItemContext,
  type Probe,
  type Row,
  type Tier,
  tok,
  variants,
  verdict,
  withDefaults,
  word,
} from './kit';
import { bleu, cosine, rougeL, sequence } from './oracle';

/**
 * gr-scores: the checks that score a reply (docs/reference/checks.md "Similarity, relevancy and knowledge
 * retention" and "Overlap and SQL"): similarity with an embedder, relevancy by key terms, knowledge retention,
 * ROUGE-L and BLEU against a slow reference written here from the rule, and the sql check on a real SQLite file.
 */

const FAMILY = 'gr-scores';
const CHECKS = 'packages/checks';
const P = 'gr.checks.scores';

/* ------------------------------------------------------------------------------------------------------
 * similarity
 * ---------------------------------------------------------------------------------------------------- */

type Embed = (texts: string[]) => Promise<number[][]>;

function embedderChecks(id: string, embed: Embed) {
  return (product: ItemContext['product']): unknown => {
    const denseEmbedder = need<(options: { id: string; embed: Embed }) => unknown>(
      product.core,
      'core',
      'denseEmbedder',
    );
    return withDefaults({ embedder: denseEmbedder({ id, embed }) })(product);
  };
}

/** Maps each text to its planted vector; a text the item did not plant throws. */
function planted(table: Record<string, number[]>): Embed {
  return async (texts) =>
    texts.map((text) => {
      const vector = table[text];
      if (!vector) throw new Error('the embedder was handed a text it has no vector for');
      return vector;
    });
}

function similarityItems(): BankItem[] {
  const f = (
    id: string,
    tier: 3 | 4,
    title: string,
    pairs: [number[], number[]][],
  ): readonly [string, 3 | 4, string, Probe] => [
    id,
    tier,
    title,
    async (ctx) => {
      const tag = `${P}.sim-cos.${id}`;
      const id0 = tok(ctx, tag, 'embedder', 8);
      const rows: Row[] = [];
      const table: Record<string, number[]> = {};
      const wants: number[] = [];
      pairs.forEach(([reply, reference], i) => {
        const [r, q] = [tok(ctx, tag, `r${i}`, 9), tok(ctx, tag, `q${i}`, 9)] as [string, string];
        table[r] = reply;
        table[q] = reference;
        const cos = cosine(reply, reference);
        wants.push(cos);
        rows.push({ text: r, expect: { similarity: [{ reference: q, min: Math.max(0, cos - 1e-6) }] } });
        rows.push({ text: r, expect: { similarity: [{ reference: q, min: Math.min(1, cos + 0.01) }] } });
      });
      const rec = await exec(ctx, tag, rows, { checks: embedderChecks(id0, planted(table)) });
      return wants.flatMap((cos, i) => [
        expectV(rec, 2 * i, 'similarity.0', 'pass', true),
        cos + 0.01 > 1 ? undefined : expectV(rec, 2 * i + 1, 'similarity.0', 'fail', true),
        (() => {
          const found = verdict(rec, 2 * i, 'similarity.0');
          return typeof found?.score === 'number' && Math.abs(found.score - cos) < 1e-6
            ? undefined
            : `the score of pair ${i} should be the cosine ${cos.toFixed(6)}; it is ${String(found?.score)}`;
        })(),
      ]);
    },
  ];
  return [
    ...variants(FAMILY, `${P}.sim-cos`, CHECKS, 'similarity-cosine-of-embedder', [
      f('parallel-vectors', 3, 'two texts the embedder maps to the same direction score 1', [
        [
          [1, 2, 3],
          [2, 4, 6],
        ],
      ]),
      f(
        'orthogonal-vectors',
        3,
        'two texts the embedder maps to orthogonal vectors score 0: they pass min 0 only',
        [
          [
            [1, 0],
            [0, 1],
          ],
        ],
      ),
      f(
        'forty-five-degrees',
        4,
        'two vectors at 45 degrees score their cosine, 0.7071: a min just below passes, just above fails',
        [
          [
            [1, 0],
            [1, 1],
          ],
        ],
      ),
      f('several-angles', 4, 'the score of each pair of one block is the cosine of that pair', [
        [
          [3, 4],
          [4, 3],
        ],
        [
          [1, 0, 0],
          [1, 1, 1],
        ],
        [
          [0.2, 0.9],
          [0.9, 0.2],
        ],
      ]),
    ]),
    ...variants(FAMILY, `${P}.sim-name`, CHECKS, 'similarity-names-the-embedder', [
      [
        'a-plugged-in-embedder',
        3,
        'the verdict names the embedder that gave the score: the id of the embedder plugged in',
        async (ctx) => {
          const tag = `${P}.sim-name.custom`;
          const [id0, r, q] = [
            tok(ctx, tag, 'embedder', 8),
            tok(ctx, tag, 'r', 9),
            tok(ctx, tag, 'q', 9),
          ] as [string, string, string];
          const rec = await exec(
            ctx,
            tag,
            [{ text: r, expect: { similarity: [{ reference: q, min: 0.5 }] } }],
            {
              checks: embedderChecks(id0, planted({ [r]: [1, 0], [q]: [1, 0] })),
            },
          );
          const text = String(verdict(rec, 0, 'similarity.0')?.evidence ?? '');
          return [
            expectV(rec, 0, 'similarity.0', 'pass', true),
            text.includes(id0)
              ? undefined
              : `the evidence does not name the embedder ${id0}: ${text.slice(0, 160)}`,
          ];
        },
      ],
      [
        'the-default-embedder',
        3,
        'without an embedder the verdict names the default one, char-ngram-tfidf',
        async (ctx) => {
          const tag = `${P}.sim-name.default`;
          const r = tok(ctx, tag, 'r', 12);
          const rec = await exec(ctx, tag, [
            { text: r, expect: { similarity: [{ reference: r, min: 0.5 }] } },
          ]);
          const text = String(verdict(rec, 0, 'similarity.0')?.evidence ?? '');
          return [
            expectV(rec, 0, 'similarity.0', 'pass', true),
            text.includes('char-ngram-tfidf')
              ? undefined
              : `the evidence does not name char-ngram-tfidf: ${text.slice(0, 160)}`,
          ];
        },
      ],
      [
        'the-score-is-on-the-verdict',
        3,
        'the verdict carries the score, from 0 to 1',
        async (ctx) => {
          const tag = `${P}.sim-name.score`;
          const [r, q] = [tok(ctx, tag, 'r', 12), tok(ctx, tag, 'q', 12)] as [string, string];
          const rec = await exec(ctx, tag, [
            {
              text: r,
              expect: {
                similarity: [
                  { reference: q, min: 0.99 },
                  { reference: r, min: 0.1 },
                ],
              },
            },
          ]);
          const [low, high] = [verdict(rec, 0, 'similarity.0'), verdict(rec, 0, 'similarity.1')];
          return [
            typeof low?.score === 'number' && low.score >= 0 && low.score < 0.99
              ? undefined
              : `similarity.0 should carry a score below 0.99; it is ${String(low?.score)}`,
            typeof high?.score === 'number' && high.score > 0.99 && high.score <= 1.0000001
              ? undefined
              : `similarity.1 should carry a score near 1; it is ${String(high?.score)}`,
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.sim-fail`, CHECKS, 'similarity-embedder-failure', [
      [
        'the-embedder-throws',
        3,
        'an embedder that throws gives an inconclusive verdict that says why; the next block is scored again',
        async (ctx) => {
          const tag = `${P}.sim-fail.throws`;
          const [id0, r, q, reason] = [
            tok(ctx, tag, 'embedder', 8),
            tok(ctx, tag, 'r', 9),
            tok(ctx, tag, 'q', 9),
            tok(ctx, tag, 'why', 10),
          ] as [string, string, string, string];
          const rec = await exec(
            ctx,
            tag,
            [{ text: r, expect: { similarity: [{ reference: q, min: 0.5 }] } }],
            {
              checks: embedderChecks(id0, async () => {
                throw new Error(`embedder down ${reason}`);
              }),
            },
          );
          const text = String(verdict(rec, 0, 'similarity.0')?.evidence ?? '');
          return [
            expectV(rec, 0, 'similarity.0', 'inconclusive'),
            text.includes(reason)
              ? undefined
              : `the evidence does not say why (${reason}): ${text.slice(0, 160)}`,
          ];
        },
      ],
      [
        'the-embedder-rejects',
        3,
        'an embedder whose promise rejects gives an inconclusive verdict, not a fail',
        async (ctx) => {
          const tag = `${P}.sim-fail.rejects`;
          const [id0, r, q] = [
            tok(ctx, tag, 'embedder', 8),
            tok(ctx, tag, 'r', 9),
            tok(ctx, tag, 'q', 9),
          ] as [string, string, string];
          const rec = await exec(
            ctx,
            tag,
            [{ text: r, expect: { similarity: [{ reference: q, min: 0.5 }] } }],
            {
              checks: embedderChecks(id0, () => Promise.reject(new Error('planted rejection'))),
            },
          );
          return [expectV(rec, 0, 'similarity.0', 'inconclusive')];
        },
      ],
      [
        'an-inconclusive-verdict-is-not-a-pass',
        4,
        'an embedder that fails leaves the verdict inconclusive: it neither passes nor fails the similarity',
        async (ctx) => {
          const tag = `${P}.sim-fail.neither`;
          const [id0, r, q] = [
            tok(ctx, tag, 'embedder', 8),
            tok(ctx, tag, 'r', 9),
            tok(ctx, tag, 'q', 9),
          ] as [string, string, string];
          const rec = await exec(
            ctx,
            tag,
            [{ text: r, expect: { similarity: [{ reference: q, min: 0.5 }] } }],
            {
              checks: embedderChecks(id0, async () => {
                throw new Error('planted');
              }),
            },
          );
          const found = verdict(rec, 0, 'similarity.0');
          return [
            found && found.outcome !== 'pass'
              ? undefined
              : `an embedder that failed should not pass the similarity; it gave ${found?.outcome}`,
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.sim-each`, CHECKS, 'similarity-per-reference', [
      [
        'each-reference-its-own-verdict',
        3,
        'each reference text gives its own verdict, with its own score and its own min',
        async (ctx) => {
          const tag = `${P}.sim-each.two`;
          const [id0, r, q0, q1] = [
            tok(ctx, tag, 'embedder', 8),
            tok(ctx, tag, 'r', 9),
            tok(ctx, tag, 'q0', 9),
            tok(ctx, tag, 'q1', 9),
          ] as [string, string, string, string];
          const rec = await exec(
            ctx,
            tag,
            [
              {
                text: r,
                expect: {
                  similarity: [
                    { reference: q0, min: 0.9 },
                    { reference: q1, min: 0.9 },
                  ],
                },
              },
            ],
            { checks: embedderChecks(id0, planted({ [r]: [1, 0], [q0]: [1, 0.1], [q1]: [0, 1] })) },
          );
          return [
            expectV(rec, 0, 'similarity.0', 'pass', true),
            expectV(rec, 0, 'similarity.1', 'fail', true),
            expectPass(rec, 0, false),
          ];
        },
      ],
      [
        'each-min-is-its-own',
        4,
        'two references with the same text and two mins give two outcomes',
        async (ctx) => {
          const tag = `${P}.sim-each.mins`;
          const [id0, r, q] = [
            tok(ctx, tag, 'embedder', 8),
            tok(ctx, tag, 'r', 9),
            tok(ctx, tag, 'q', 9),
          ] as [string, string, string];
          const rec = await exec(
            ctx,
            tag,
            [
              {
                text: r,
                expect: {
                  similarity: [
                    { reference: q, min: 0.6 },
                    { reference: q, min: 0.8 },
                  ],
                },
              },
            ],
            { checks: embedderChecks(id0, planted({ [r]: [1, 0], [q]: [1, 1] })) },
          );
          return [
            expectV(rec, 0, 'similarity.0', 'pass', true),
            expectV(rec, 0, 'similarity.1', 'fail', true),
          ];
        },
      ],
      [
        'the-score-does-not-depend-on-the-other',
        4,
        'the score of a reference does not change with the references beside it',
        async (ctx) => {
          const tag = `${P}.sim-each.alone`;
          const [id0, r, q, z] = [
            tok(ctx, tag, 'embedder', 8),
            tok(ctx, tag, 'r', 9),
            tok(ctx, tag, 'q', 9),
            tok(ctx, tag, 'z', 9),
          ] as [string, string, string, string];
          const table = planted({ [r]: [1, 0], [q]: [3, 4], [z]: [0, 1] });
          const alone = await exec(
            ctx,
            `${tag}:a`,
            [{ text: r, expect: { similarity: [{ reference: q, min: 0.1 }] } }],
            { checks: embedderChecks(id0, table) },
          );
          const both = await exec(
            ctx,
            `${tag}:b`,
            [
              {
                text: r,
                expect: {
                  similarity: [
                    { reference: z, min: 0.1 },
                    { reference: q, min: 0.1 },
                  ],
                },
              },
            ],
            { checks: embedderChecks(id0, table) },
          );
          const [x, y] = [verdict(alone, 0, 'similarity.0')?.score, verdict(both, 0, 'similarity.1')?.score];
          return [
            typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) < 1e-9
              ? undefined
              : `the score of the same pair is ${String(x)} alone and ${String(y)} beside another reference`,
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.sim-default`, CHECKS, 'similarity-default-local', [
      [
        'identical-texts',
        3,
        'the default embedder scores two identical texts near 1 and two unrelated texts low',
        async (ctx) => {
          const tag = `${P}.sim-default.identical`;
          const [a, b] = [tok(ctx, tag, 'a', 20), tok(ctx, tag, 'b', 20)] as [string, string];
          const rec = await exec(ctx, tag, [
            { text: a, expect: { similarity: [{ reference: a, min: 0.95 }] } },
            { text: a, expect: { similarity: [{ reference: b, min: 0.5 }] } },
          ]);
          return [
            expectV(rec, 0, 'similarity.0', 'pass', true),
            expectV(rec, 1, 'similarity.0', 'fail', true),
          ];
        },
      ],
      [
        'the-same-two-texts-always-score-the-same',
        4,
        'the default embedder is deterministic: the same two texts give the same score in two blocks and two runs',
        async (ctx) => {
          const tag = `${P}.sim-default.same`;
          const [a, b] = [
            `${tok(ctx, tag, 'a1', 8)} ${tok(ctx, tag, 'a2', 8)}`,
            `${tok(ctx, tag, 'b1', 8)} ${tok(ctx, tag, 'a1', 8)}`,
          ];
          const rows: Row[] = [0, 1].map(() => ({
            text: a,
            expect: { similarity: [{ reference: b, min: 0 }] },
          }));
          const [r1, r2] = [await exec(ctx, `${tag}:1`, rows), await exec(ctx, `${tag}:2`, rows)];
          const scores = [r1, r2].flatMap((rec) => [0, 1].map((i) => verdict(rec, i, 'similarity.0')?.score));
          return [
            scores.every((s) => typeof s === 'number' && s === scores[0])
              ? undefined
              : `the same two texts scored ${JSON.stringify(scores)}`,
          ];
        },
      ],
      [
        'more-shared-text-scores-higher',
        4,
        'a reply that shares more text with the reference scores higher than one that shares less',
        async (ctx) => {
          const tag = `${P}.sim-default.order`;
          const w = [0, 1, 2, 3].map((k) => tok(ctx, tag, `w${k}`, 9));
          const reference = w.join(' ');
          const rec = await exec(ctx, tag, [
            { text: w.slice(0, 3).join(' '), expect: { similarity: [{ reference, min: 0 }] } },
            { text: w.slice(0, 1).join(' '), expect: { similarity: [{ reference, min: 0 }] } },
          ]);
          const [x, y] = [verdict(rec, 0, 'similarity.0')?.score, verdict(rec, 1, 'similarity.0')?.score];
          return [
            typeof x === 'number' && typeof y === 'number' && x > y
              ? undefined
              : `three shared words scored ${String(x)}, one shared word scored ${String(y)}`,
          ];
        },
      ],
    ]),
  ];
}

/* ------------------------------------------------------------------------------------------------------
 * relevancy
 * ---------------------------------------------------------------------------------------------------- */

function relevancyItems(): BankItem[] {
  const terms = (ctx: ItemContext, tag: string, n: number) =>
    Array.from({ length: n }, (_, k) => tok(ctx, tag, `t${k}`, 8));
  const relevancyRow = (text: string, relevancy: Record<string, unknown>): Row => ({
    text,
    expect: { relevancy },
  });
  const stem = (
    id: string,
    title: string,
    lang: string,
    term: string,
    found: string,
    ok: boolean,
  ): readonly [string, 3 | 4, string, Probe] => [
    id,
    3,
    title,
    async (ctx) => {
      const tag = `${P}.rel-stem.${id}`;
      const rec = await exec(ctx, tag, [relevancyRow(`Voici ${found} ici`, { terms: [term], min: 1 })], {
        spec: { lang },
      });
      return [expectV(rec, 0, 'relevancy.terms', ok ? 'pass' : 'fail')];
    },
  ];
  return [
    ...variants(FAMILY, `${P}.rel-min`, CHECKS, 'relevancy-min-and-share', [
      [
        'half-reaches-the-default-min',
        3,
        'one key term of two found reaches the default min of 0.5, and the score is the share',
        async (ctx) => {
          const tag = `${P}.rel-min.half`;
          const [a, b] = terms(ctx, tag, 2) as [string, string];
          const rec = await exec(ctx, tag, [relevancyRow(`only ${a} here`, { terms: [a, b] })]);
          const found = verdict(rec, 0, 'relevancy.terms');
          return [
            expectV(rec, 0, 'relevancy.terms', 'pass', true),
            found?.score === 0.5
              ? undefined
              : `the score should be the share 0.5; it is ${String(found?.score)}`,
          ];
        },
      ],
      [
        'a-min-above-the-share',
        3,
        'a min above the share found is not reached: an inconclusive verdict, since some terms are found',
        async (ctx) => {
          const tag = `${P}.rel-min.above`;
          const [a, b, c] = terms(ctx, tag, 3) as [string, string, string];
          const rec = await exec(ctx, tag, [
            relevancyRow(`${a} and ${b} here`, { terms: [a, b, c], min: 0.9 }),
            relevancyRow(`${a} and ${b} here`, { terms: [a, b, c], min: 0.6 }),
          ]);
          const found = verdict(rec, 0, 'relevancy.terms');
          return [
            expectV(rec, 0, 'relevancy.terms', 'inconclusive', false),
            found && Math.abs((found.score ?? -1) - 2 / 3) < 1e-9
              ? undefined
              : `the score should be 2/3; it is ${String(found?.score)}`,
            expectV(rec, 1, 'relevancy.terms', 'pass', true),
          ];
        },
      ],
      [
        'every-term-found',
        3,
        'all key terms found gives a score of 1 and a pass',
        async (ctx) => {
          const tag = `${P}.rel-min.all`;
          const t = terms(ctx, tag, 4);
          const rec = await exec(ctx, tag, [relevancyRow(t.join(' '), { terms: t, min: 1 })]);
          return [
            expectV(rec, 0, 'relevancy.terms', 'pass', true),
            verdict(rec, 0, 'relevancy.terms')?.score === 1 ? undefined : 'the score should be 1',
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.rel-none`, CHECKS, 'relevancy-no-term-found-fails', [
      [
        'one-term-missing',
        3,
        'a reply that holds none of one key term fails and gates',
        async (ctx) => {
          const tag = `${P}.rel-none.one`;
          const [a, b] = terms(ctx, tag, 2) as [string, string];
          const rec = await exec(ctx, tag, [relevancyRow(`about ${b}`, { terms: [a] })]);
          return [expectV(rec, 0, 'relevancy.terms', 'fail', true), expectPass(rec, 0, false)];
        },
      ],
      [
        'several-terms-all-missing',
        3,
        'a reply that holds none of four key terms fails and gates, with score 0',
        async (ctx) => {
          const tag = `${P}.rel-none.four`;
          const t = terms(ctx, tag, 4);
          const rec = await exec(ctx, tag, [relevancyRow(tok(ctx, tag, 'other', 9), { terms: t })]);
          return [
            expectV(rec, 0, 'relevancy.terms', 'fail', true),
            verdict(rec, 0, 'relevancy.terms')?.score === 0 ? undefined : 'the score should be 0',
          ];
        },
      ],
      [
        'an-empty-reply',
        3,
        'an empty reply holds no key term: it fails and gates',
        async (ctx) => {
          const tag = `${P}.rel-none.empty`;
          const t = terms(ctx, tag, 2);
          const rec = await exec(ctx, tag, [relevancyRow('', { terms: t })]);
          return [expectV(rec, 0, 'relevancy.terms', 'fail', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.rel-some`, CHECKS, 'relevancy-some-not-enough-inconclusive', [
      [
        'one-of-three',
        3,
        'one key term of three found, below the default min, is inconclusive and does not gate: the block passes',
        async (ctx) => {
          const tag = `${P}.rel-some.three`;
          const t = terms(ctx, tag, 3);
          const rec = await exec(ctx, tag, [relevancyRow(`about ${t[0]}`, { terms: t })]);
          return [expectV(rec, 0, 'relevancy.terms', 'inconclusive', false), expectPass(rec, 0, true)];
        },
      ],
      [
        'one-of-four',
        3,
        'one key term of four found is inconclusive and does not gate',
        async (ctx) => {
          const tag = `${P}.rel-some.four`;
          const t = terms(ctx, tag, 4);
          const rec = await exec(ctx, tag, [relevancyRow(`about ${t[2]}`, { terms: t })]);
          return [expectV(rec, 0, 'relevancy.terms', 'inconclusive', false), expectPass(rec, 0, true)];
        },
      ],
      [
        'only-none-found-gates',
        4,
        'the line between inconclusive and fail is none found: one found is inconclusive, none found fails and gates',
        async (ctx) => {
          const tag = `${P}.rel-some.line`;
          const t = terms(ctx, tag, 3);
          const rec = await exec(ctx, tag, [
            relevancyRow(t[0] as string, { terms: t }),
            relevancyRow(tok(ctx, tag, 'other', 9), { terms: t }),
          ]);
          return [
            expectV(rec, 0, 'relevancy.terms', 'inconclusive', false),
            expectV(rec, 1, 'relevancy.terms', 'fail', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.rel-stem`, CHECKS, 'relevancy-stem-match', [
      stem(
        'french-plural',
        'a French key term and its plural match: forfait and forfaits',
        'FR',
        'forfait',
        'des forfaits',
        true,
      ),
      stem(
        'french-accents',
        'accents are removed: the term données matches donnees and donnée in the reply',
        'FR',
        'données',
        'les donnees',
        true,
      ),
      stem(
        'french-singular-accent',
        'the term données matches the reply word donnée',
        'FR',
        'données',
        'une donnée',
        true,
      ),
      stem(
        'dutch-superlative',
        'a Dutch key term and its superlative match: goedkoop and goedkoopste',
        'NL',
        'goedkoop',
        'het goedkoopste',
        true,
      ),
      stem(
        'dutch-verb-forms',
        'a Dutch stem plus one letter matches: bieden and biedt',
        'NL',
        'bieden',
        'hij biedt',
        true,
      ),
      stem(
        'another-word',
        'a reply word that shares no stem with the key term does not match',
        'FR',
        'forfait',
        'des tarifs',
        false,
      ),
    ]),
    ...variants(FAMILY, `${P}.rel-ask`, CHECKS, 'relevancy-terms-from-the-ask', [
      [
        'long-words-of-the-ask',
        4,
        'without terms, the words of the ask of four letters or more are the key terms',
        async (ctx) => {
          const tag = `${P}.rel-ask.long`;
          const marker = word(ctx.seed, `${tag}:user:0`, 9);
          const [a, b] = [tok(ctx, tag, 'a', 8), tok(ctx, tag, 'b', 8)] as [string, string];
          const say = (m: string) => `${m} ${a} ${b}`;
          const rec = await exec(ctx, tag, [
            { text: `${marker} ${a} ${b}`, expect: { relevancy: { min: 1 } }, say },
            { text: `${marker} ${a}`, expect: { relevancy: { min: 1 } }, say },
          ]);
          return [
            expectV(rec, 0, 'relevancy.terms', 'pass', true),
            verdict(rec, 1, 'relevancy.terms')?.outcome === 'pass'
              ? 'one of three terms missing and the block still passes min 1'
              : undefined,
          ];
        },
      ],
      [
        'short-words-are-not-terms',
        4,
        'a word of the ask under four letters is no key term: a reply without it still holds every term',
        async (ctx) => {
          const tag = `${P}.rel-ask.short`;
          const marker = word(ctx.seed, `${tag}:user:0`, 9);
          const a = tok(ctx, tag, 'a', 8);
          const rec = await exec(ctx, tag, [
            { text: `${marker} ${a}`, expect: { relevancy: { min: 1 } }, say: (m) => `${m} ${a} xyz qq` },
          ]);
          return [
            expectV(rec, 0, 'relevancy.terms', 'pass', true),
            verdict(rec, 0, 'relevancy.terms')?.score === 1
              ? undefined
              : `the score should be 1; it is ${String(verdict(rec, 0, 'relevancy.terms')?.score)}`,
          ];
        },
      ],
      [
        'terms-replace-the-ask',
        3,
        'when terms are given, the words of the ask are not key terms',
        async (ctx) => {
          const tag = `${P}.rel-ask.terms`;
          const [a, b] = [tok(ctx, tag, 'a', 8), tok(ctx, tag, 'b', 8)] as [string, string];
          const rec = await exec(ctx, tag, [
            { text: `only ${b}`, expect: { relevancy: { terms: [b], min: 1 } }, say: (m) => `${m} ${a}` },
          ]);
          return [expectV(rec, 0, 'relevancy.terms', 'pass', true)];
        },
      ],
    ]),
  ];
}

/* ------------------------------------------------------------------------------------------------------
 * knowledge retention
 * ---------------------------------------------------------------------------------------------------- */

function retentionItems(): BankItem[] {
  const ledgerRow = (
    fact: string,
    value: string,
    text: string,
    entry: Record<string, unknown>,
    extra: Partial<Row> = {},
  ): Row => ({
    text,
    given: { ledger: { [fact]: value } },
    expect: { knowledge_retention: [{ fact, ...entry }] },
    ...extra,
  });
  return [
    ...variants(FAMILY, `${P}.keep-asked`, CHECKS, 'retention-asked-again', [
      [
        'a-question-that-names-the-key',
        3,
        'a question of the reply that names the words of the key fails the .asked verdict',
        async (ctx) => {
          const tag = `${P}.keep-asked.key`;
          const [fact, value] = [tok(ctx, tag, 'fact', 8), tok(ctx, tag, 'value', 9)] as [string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `Before I place it, what is your ${fact}?`, {}),
          ]);
          return [
            expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'fail', true),
            expectPass(rec, 0, false),
          ];
        },
      ],
      [
        'a-statement-is-not-a-question',
        3,
        'a sentence that names the key but does not end with ? asks nothing',
        async (ctx) => {
          const tag = `${P}.keep-asked.statement`;
          const [fact, value] = [tok(ctx, tag, 'fact', 8), tok(ctx, tag, 'value', 9)] as [string, string];
          const rec = await exec(ctx, tag, [ledgerRow(fact, value, `Your ${fact} is noted. Thank you.`, {})]);
          return [expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'pass', true)];
        },
      ],
      [
        'a-question-about-something-else',
        3,
        'a question that does not name the key does not ask for the fact again',
        async (ctx) => {
          const tag = `${P}.keep-asked.other`;
          const [fact, value, other] = [
            tok(ctx, tag, 'fact', 8),
            tok(ctx, tag, 'value', 9),
            tok(ctx, tag, 'other', 9),
          ] as [string, string, string];
          const rec = await exec(ctx, tag, [ledgerRow(fact, value, `Which ${other} would you like?`, {})]);
          return [expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'pass', true)];
        },
      ],
      [
        'only-the-question-sentence-counts',
        4,
        'the key in a sentence beside a question that does not name it is no ask: only the question is read',
        async (ctx) => {
          const tag = `${P}.keep-asked.sentence`;
          const [fact, value, other] = [
            tok(ctx, tag, 'fact', 8),
            tok(ctx, tag, 'value', 9),
            tok(ctx, tag, 'other', 9),
          ] as [string, string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `I used your ${fact} already. Do you want ${other}?`, {}),
          ]);
          return [expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'pass', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.keep-confirm`, CHECKS, 'retention-confirmation-is-not-asking', [
      [
        'the-question-repeats-the-value',
        3,
        'a question that repeats the given value is a confirmation, not an ask',
        async (ctx) => {
          const tag = `${P}.keep-confirm.value`;
          const [fact, value] = [tok(ctx, tag, 'fact', 8), tok(ctx, tag, 'value', 9)] as [string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `Is your ${fact} ${value}?`, {}),
            ledgerRow(fact, value, `Is your ${fact} something else?`, {}),
          ]);
          return [
            expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'pass', true),
            expectV(rec, 1, `knowledge_retention.${fact}.asked`, 'fail', true),
          ];
        },
      ],
      [
        'the-value-in-another-case',
        4,
        'a confirmation repeats the value whatever its case',
        async (ctx) => {
          const tag = `${P}.keep-confirm.case`;
          const [fact, value] = [tok(ctx, tag, 'fact', 8), tok(ctx, tag, 'value', 9)] as [string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `Your ${fact} is ${value.toUpperCase()}, correct?`, {}),
          ]);
          return [expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'pass', true)];
        },
      ],
      [
        'a-different-value',
        4,
        'a question that names the key beside a value that is not the given one is an ask',
        async (ctx) => {
          const tag = `${P}.keep-confirm.other`;
          const [fact, value, wrong] = [
            tok(ctx, tag, 'fact', 8),
            tok(ctx, tag, 'value', 9),
            tok(ctx, tag, 'wrong', 9),
          ] as [string, string, string];
          const rec = await exec(ctx, tag, [ledgerRow(fact, value, `Is your ${fact} ${wrong}?`, {})]);
          return [expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'fail', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.keep-pattern`, CHECKS, 'retention-ask-pattern', [
      [
        'the-pattern-replaces-the-key-words',
        3,
        'with an ask pattern, a question that matches it is an ask and a question that only names the key is not',
        async (ctx) => {
          const tag = `${P}.keep-pattern.replaces`;
          const [fact, value, mark] = [
            tok(ctx, tag, 'fact', 8),
            tok(ctx, tag, 'value', 9),
            tok(ctx, tag, 'mark', 8),
          ] as [string, string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `What is your ${fact}?`, { ask: mark }),
            ledgerRow(fact, value, `Could you give me the ${mark}?`, { ask: mark }),
          ]);
          return [
            expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'pass', true),
            expectV(rec, 1, `knowledge_retention.${fact}.asked`, 'fail', true),
          ];
        },
      ],
      [
        'a-pattern-is-a-regular-expression',
        4,
        'the ask pattern is a regular expression: a class and a count match',
        async (ctx) => {
          const tag = `${P}.keep-pattern.regex`;
          const [fact, value, mark] = [
            tok(ctx, tag, 'fact', 8),
            tok(ctx, tag, 'value', 9),
            tok(ctx, tag, 'mark', 6),
          ] as [string, string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `Please send ${mark}77, would you?`, { ask: `${mark}\\d+` }),
          ]);
          return [expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'fail', true)];
        },
      ],
      [
        'a-pattern-needs-a-question',
        4,
        'a sentence that matches the ask pattern but is no question is no ask',
        async (ctx) => {
          const tag = `${P}.keep-pattern.statement`;
          const [fact, value, mark] = [
            tok(ctx, tag, 'fact', 8),
            tok(ctx, tag, 'value', 9),
            tok(ctx, tag, 'mark', 8),
          ] as [string, string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `Noted: ${mark}. Thank you.`, { ask: mark }),
          ]);
          return [expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'pass', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.keep-use`, CHECKS, 'retention-use-the-value', [
      [
        'the-value-in-the-reply',
        3,
        'use: true passes when the value appears in the reply and fails when it does not',
        async (ctx) => {
          const tag = `${P}.keep-use.reply`;
          const [fact, value, other] = [
            tok(ctx, tag, 'fact', 8),
            tok(ctx, tag, 'value', 9),
            tok(ctx, tag, 'other', 9),
          ] as [string, string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `Done, for ${value}.`, { use: true }),
            ledgerRow(fact, value, `Done, for ${other}.`, { use: true }),
          ]);
          return [
            expectV(rec, 0, `knowledge_retention.${fact}.used`, 'pass', true),
            expectV(rec, 1, `knowledge_retention.${fact}.used`, 'fail', true),
          ];
        },
      ],
      [
        'the-value-in-a-tool-input',
        3,
        'use: true passes when the value is in the input of a tool call, though the reply does not say it',
        async (ctx) => {
          const tag = `${P}.keep-use.tool`;
          const [fact, value, label] = [
            tok(ctx, tag, 'fact', 8),
            tok(ctx, tag, 'value', 9),
            tok(ctx, tag, 'tool', 7),
          ] as [string, string, string];
          const rec = await exec(ctx, tag, [
            {
              ...ledgerRow(fact, value, 'Done.', { use: true }),
              calls: [{ label, input: { field: value } }],
            },
            {
              ...ledgerRow(fact, value, 'Done.', { use: true }),
              calls: [{ label, input: { field: 'nothing' } }],
            },
          ]);
          return [
            expectV(rec, 0, `knowledge_retention.${fact}.used`, 'pass', true),
            expectV(rec, 1, `knowledge_retention.${fact}.used`, 'fail', true),
          ];
        },
      ],
      [
        'case-and-spacing-aside',
        4,
        'the value matches whatever its case, and whatever the amount of space inside it',
        async (ctx) => {
          const tag = `${P}.keep-use.spacing`;
          const [fact, a, b] = [tok(ctx, tag, 'fact', 8), tok(ctx, tag, 'a', 5), tok(ctx, tag, 'b', 5)] as [
            string,
            string,
            string,
          ];
          const value = `${a} ${b}`;
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, `Done, for ${a.toUpperCase()}   ${b.toUpperCase()}.`, { use: true }),
            ledgerRow(fact, value, `Done, for ${a}    ${b}.`, { use: true }),
          ]);
          return [
            expectV(rec, 0, `knowledge_retention.${fact}.used`, 'pass', true),
            expectV(rec, 1, `knowledge_retention.${fact}.used`, 'pass', true),
          ];
        },
      ],
      [
        'digits-alone-for-a-long-number',
        5,
        'a value of six digits or more matches by its digits alone, whatever its punctuation',
        async (ctx) => {
          const tag = `${P}.keep-use.digits`;
          const [fact] = [tok(ctx, tag, 'fact', 8)] as [string];
          const rng = rngFor(ctx.seed, tag);
          const digits = Array.from({ length: 9 }, () => between(rng, 0, 9)).join('');
          const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
          const wrong = `${digits.slice(0, 8)}${(Number(digits[8]) + 1) % 10}`;
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, formatted, `Call ${digits} now.`, { use: true }),
            ledgerRow(fact, formatted, `Call ${wrong} now.`, { use: true }),
          ]);
          return [
            expectV(rec, 0, `knowledge_retention.${fact}.used`, 'pass', true),
            expectV(rec, 1, `knowledge_retention.${fact}.used`, 'fail', true),
          ];
        },
      ],
      [
        'the-used-verdict-only-with-use',
        3,
        'an entry without use: true gives the .asked verdict and no .used verdict',
        async (ctx) => {
          const tag = `${P}.keep-use.off`;
          const [fact, value] = [tok(ctx, tag, 'fact', 8), tok(ctx, tag, 'value', 9)] as [string, string];
          const rec = await exec(ctx, tag, [
            ledgerRow(fact, value, 'Done.', {}),
            ledgerRow(fact, value, 'Done.', { use: false }),
          ]);
          return [
            expectV(rec, 0, `knowledge_retention.${fact}.asked`, 'pass', true),
            expectNone(rec, 0, `knowledge_retention.${fact}.used`),
            expectNone(rec, 1, `knowledge_retention.${fact}.used`),
          ];
        },
      ],
    ]),
  ];
}

/* ------------------------------------------------------------------------------------------------------
 * ROUGE-L and BLEU
 * ---------------------------------------------------------------------------------------------------- */

function overlapItems(): BankItem[] {
  type Metric = 'rouge_l' | 'bleu';
  const score = { rouge_l: rougeL, bleu } as const;
  const idOf = (metric: Metric) => `${metric}.0`;
  /** For each case, a block at min = the score (passes) and one just above (fails), unless the score is 1. */
  const differential = (
    id: string,
    tier: 4 | 5,
    metric: Metric,
    title: string,
    cases: (ctx: ItemContext, tag: string) => [string, string][],
  ): readonly [string, 4 | 5, string, Probe] => [
    id,
    tier,
    title,
    async (ctx) => {
      const tag = `${P}.${metric}.${id}`;
      const list = cases(ctx, tag).filter(([reply, reference]) => score[metric](reply, reference) > 0);
      const rows: Row[] = list.flatMap(([reply, reference]) => {
        const s = score[metric](reply, reference);
        return [
          { text: reply, expect: { [metric]: { reference, min: Math.max(0, s - 1e-6) } } },
          { text: reply, expect: { [metric]: { reference, min: Math.min(1, s + 0.003) } } },
        ];
      });
      const rec = await exec(ctx, tag, rows);
      return list.flatMap(([reply, reference], i) => {
        const s = score[metric](reply, reference);
        const note = `reply "${reply}" against "${reference}" should score ${s.toFixed(4)}`;
        const [pass, fail] = [
          expectV(rec, 2 * i, idOf(metric), 'pass', true),
          s + 0.003 > 1 ? undefined : expectV(rec, 2 * i + 1, idOf(metric), 'fail', true),
        ];
        return [pass && `${note}: ${pass}`, fail && `${note}: ${fail}`];
      });
    },
  ];
  const vocabulary = (ctx: ItemContext, tag: string, n: number) =>
    Array.from({ length: n }, (_, k) => tok(ctx, tag, `v${k}`, 5));
  const draws = (
    ctx: ItemContext,
    tag: string,
    count: number,
    size: [number, number],
    vocab: number,
  ): [string, string][] => {
    const rng = rngFor(ctx.seed, tag);
    const v = vocabulary(ctx, tag, vocab);
    return Array.from({ length: count }, () => [
      sequence(rng, v, between(rng, size[0], size[1])).join(' '),
      sequence(rng, v, between(rng, size[0], size[1])).join(' '),
    ]);
  };
  return [
    ...variants(FAMILY, `${P}.rouge`, CHECKS, 'rouge-l-f-measure', [
      differential(
        'seeded-pairs',
        4,
        'rouge_l',
        'twelve seeded pairs score the F measure of their longest common word subsequence',
        (ctx, tag) => draws(ctx, tag, 12, [3, 9], 4),
      ),
      differential(
        'short-and-long',
        4,
        'rouge_l',
        'a long reply that holds the whole reference scores below 1: precision counts',
        (ctx, tag) => {
          const v = vocabulary(ctx, tag, 8);
          return [
            [v.join(' '), v.slice(0, 3).join(' ')],
            [[...v, ...v].join(' '), v.slice(2, 5).join(' ')],
            [v.slice(0, 2).join(' '), v.join(' ')],
          ];
        },
      ),
      differential(
        'order-matters',
        4,
        'rouge_l',
        'the same words in another order share only a subsequence',
        (ctx, tag) => {
          const v = vocabulary(ctx, tag, 5);
          return [
            [[...v].reverse().join(' '), v.join(' ')],
            [[v[1], v[0], v[3], v[2], v[4]].join(' '), v.join(' ')],
            [[v[4], v[0], v[1], v[2], v[3]].join(' '), v.join(' ')],
          ];
        },
      ),
    ]),
    ...variants(FAMILY, `${P}.rouge-words`, CHECKS, 'overlap-words-lowercased', [
      [
        'case-and-punctuation',
        3,
        'the driftbench profile reads words in lower case and drops punctuation: Hello, World! equals hello world',
        async (ctx) => {
          const tag = `${P}.rouge-words.case`;
          const [a, b] = [tok(ctx, tag, 'a', 6), tok(ctx, tag, 'b', 6)] as [string, string];
          const rec = await exec(ctx, tag, [
            {
              text: `${a.toUpperCase()}, ${b}!`,
              expect: { rouge_l: { reference: `${a} ${b.toUpperCase()}`, min: 0.99 } },
            },
            { text: `${a.toUpperCase()}, ${b}!`, expect: { bleu: { reference: `${a} ${b}`, min: 0.01 } } },
          ]);
          return [expectV(rec, 0, 'rouge_l.0', 'pass', true), expectV(rec, 1, 'bleu.0', 'fail', true)];
        },
      ],
      [
        'no-stemming',
        4,
        'the driftbench profile does not stem: run and runs are two different words',
        async (ctx) => {
          const tag = `${P}.rouge-words.stem`;
          const [a] = [tok(ctx, tag, 'a', 6)] as [string];
          const rec = await exec(ctx, tag, [
            { text: `${a}s`, expect: { rouge_l: { reference: a, min: 0.01 } } },
            { text: `${a}s`, expect: { rouge_l: { reference: `${a}s`, min: 0.99 } } },
          ]);
          return [expectV(rec, 0, 'rouge_l.0', 'fail', true), expectV(rec, 1, 'rouge_l.0', 'pass', true)];
        },
      ],
      [
        'digits-are-words',
        4,
        'digits are part of the words: 42 and 43 are two different words',
        async (ctx) => {
          const tag = `${P}.rouge-words.digits`;
          const rec = await exec(ctx, tag, [
            { text: 'total 42', expect: { rouge_l: { reference: 'total 43', min: 0.9 } } },
            { text: 'total 42', expect: { rouge_l: { reference: 'total 42', min: 0.99 } } },
          ]);
          return [expectV(rec, 0, 'rouge_l.0', 'fail', true), expectV(rec, 1, 'rouge_l.0', 'pass', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.bleu`, CHECKS, 'bleu-clipped-ngram-precision', [
      differential(
        'seeded-pairs',
        5,
        'bleu',
        'twelve seeded pairs score the clipped 1- to 4-gram BLEU with its brevity penalty',
        (ctx, tag) => draws(ctx, tag, 12, [5, 10], 3),
      ),
      differential(
        'repeated-words-are-clipped',
        4,
        'bleu',
        'a word repeated in the reply counts no more often than the reference holds it',
        (ctx, tag) => {
          const v = vocabulary(ctx, tag, 6);
          return [
            [[v[0], v[0], v[0], v[0], v[1], v[2], v[3]].join(' '), [v[0], v[1], v[2], v[3], v[4]].join(' ')],
            [[v[0], v[1], v[0], v[1], v[0], v[1]].join(' '), [v[0], v[1], v[0], v[1], v[2], v[3]].join(' ')],
          ];
        },
      ),
      differential(
        'brevity-penalty',
        4,
        'bleu',
        'a reply shorter than the reference is penalised, one longer is not',
        (ctx, tag) => {
          const v = vocabulary(ctx, tag, 10);
          return [
            [v.slice(0, 5).join(' '), v.join(' ')],
            [v.join(' '), v.slice(0, 5).join(' ')],
            [v.slice(0, 7).join(' '), v.join(' ')],
          ];
        },
      ),
    ]),
    ...variants(FAMILY, `${P}.bleu-zero`, CHECKS, 'bleu-zero-without-a-match', [
      [
        'no-four-gram-matches',
        4,
        'BLEU is 0 when an n-gram size has no match: five words that share every unigram but no 4-gram',
        async (ctx) => {
          const tag = `${P}.bleu-zero.four`;
          const w = [0, 1, 2, 3, 4].map((k) => tok(ctx, tag, `w${k}`, 5));
          const rec = await exec(ctx, tag, [
            {
              text: w.join(' '),
              expect: { bleu: { reference: [w[0], w[1], w[2], w[4], w[3]].join(' '), min: 0.01 } },
            },
            { text: w.join(' '), expect: { bleu: { reference: w.join(' '), min: 0.99 } } },
          ]);
          return [expectV(rec, 0, 'bleu.0', 'fail', true), expectV(rec, 1, 'bleu.0', 'pass', true)];
        },
      ],
      [
        'no-word-in-common',
        3,
        'BLEU is 0 for two texts that share no word',
        async (ctx) => {
          const tag = `${P}.bleu-zero.words`;
          const a = [0, 1, 2, 3, 4].map((k) => tok(ctx, tag, `a${k}`, 5));
          const b = [0, 1, 2, 3, 4].map((k) => tok(ctx, tag, `b${k}`, 5));
          const rec = await exec(ctx, tag, [
            { text: a.join(' '), expect: { bleu: { reference: b.join(' '), min: 0.001 } } },
          ]);
          return [expectV(rec, 0, 'bleu.0', 'fail', true)];
        },
      ],
      [
        'no-bigram-matches',
        4,
        'BLEU is 0 when the words match but no two of them follow each other in the reference',
        async (ctx) => {
          const tag = `${P}.bleu-zero.bigram`;
          const w = [0, 1, 2, 3, 4, 5].map((k) => tok(ctx, tag, `w${k}`, 5));
          const rec = await exec(ctx, tag, [
            {
              text: [w[0], w[1], w[2], w[3], w[4], w[5]].join(' '),
              expect: { bleu: { reference: [w[5], w[3], w[1], w[4], w[2], w[0]].join(' '), min: 0.001 } },
            },
          ]);
          return [expectV(rec, 0, 'bleu.0', 'fail', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.overlap-profile`, CHECKS, 'overlap-profile-ragas-stems', [
      [
        'the-ragas-profile-stems',
        4,
        'the ragas profile stems words longer than three letters: runs and run are the same word there',
        async (ctx) => {
          const tag = `${P}.overlap-profile.stems`;
          const a = 'jumps';
          const rec = await exec(ctx, tag, [
            { text: a, expect: { rouge_l: { reference: 'jump', min: 0.99, profile: 'ragas' } } },
            { text: a, expect: { rouge_l: { reference: 'jump', min: 0.01 } } },
          ]);
          return [expectV(rec, 0, 'rouge_l.0', 'pass', true), expectV(rec, 1, 'rouge_l.0', 'fail', true)];
        },
      ],
      [
        'the-evidence-quotes-the-other-profile',
        4,
        'the evidence quotes the score of the chosen profile and the score of the other one',
        async (ctx) => {
          const tag = `${P}.overlap-profile.evidence`;
          const rec = await exec(ctx, tag, [
            { text: 'jumps', expect: { rouge_l: { reference: 'jump', min: 0.01 } } },
            { text: 'jumps', expect: { rouge_l: { reference: 'jump', min: 0.5, profile: 'ragas' } } },
          ]);
          const [x, y] = [
            String(verdict(rec, 0, 'rouge_l.0')?.evidence ?? ''),
            String(verdict(rec, 1, 'rouge_l.0')?.evidence ?? ''),
          ];
          return [
            /ragas[^0-9]*(1(\.0+)?|0?\.9\d+)/.test(x)
              ? undefined
              : `the default profile should quote the ragas score near 1; evidence: ${x.slice(0, 160)}`,
            /driftbench[^0-9]*0(\.0+)?\b/.test(y)
              ? undefined
              : `the ragas profile should quote the driftbench score 0; evidence: ${y.slice(0, 160)}`,
          ];
        },
      ],
      [
        'the-profile-decides-the-outcome',
        4,
        'the same pair passes under one profile and fails under the other, at one min',
        async (ctx) => {
          const tag = `${P}.overlap-profile.decides`;
          const rec = await exec(ctx, tag, [
            { text: 'jumps', expect: { rouge_l: { reference: 'jump', min: 0.5, profile: 'ragas' } } },
            { text: 'jumps', expect: { rouge_l: { reference: 'jump', min: 0.5, profile: 'driftbench' } } },
          ]);
          return [expectV(rec, 0, 'rouge_l.0', 'pass', true), expectV(rec, 1, 'rouge_l.0', 'fail', true)];
        },
      ],
    ]),
  ];
}

/* ------------------------------------------------------------------------------------------------------
 * sql
 * ---------------------------------------------------------------------------------------------------- */

type SqlSetup = { db: string; table: string; names: string[]; count: () => number };

/** A SQLite file of the item with one table of fictional rows: `name TEXT, qty INTEGER`. */
function sqlSetup(ctx: ItemContext, tag: string): SqlSetup {
  const dir = join(ctx.scratch, `sql-${word(ctx.seed, `${tag}:dir`, 6)}`);
  mkdirSync(dir, { recursive: true });
  const db = join(dir, 'shop.db');
  const table = `t${tok(ctx, tag, 'table', 6)}`;
  const names = [0, 1, 2, 3].map((k) => tok(ctx, tag, `row${k}`, 6));
  const handle = new DatabaseSync(db);
  handle.exec(`CREATE TABLE ${table} (name TEXT, qty INTEGER)`);
  const insert = handle.prepare(`INSERT INTO ${table} (name, qty) VALUES (?, ?)`);
  names.forEach((name, i) => {
    insert.run(name, i + 1);
  });
  handle.close();
  return {
    db,
    table,
    names,
    count: () => {
      const reader = new DatabaseSync(db, { readOnly: true });
      const row = reader.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      reader.close();
      return row.n;
    },
  };
}

async function sqlRun(
  ctx: ItemContext,
  tag: string,
  setup: SqlSetup,
  cases: { golden: string; query: string; tool?: string }[],
) {
  const tool = tok(ctx, tag, 'tool', 7);
  const rows: Row[] = cases.map((c) => ({
    calls: [{ label: c.tool ?? tool, input: { query: c.query } }],
    expect: { sql: { tool, golden: c.golden, database: setup.db } },
  }));
  return exec(ctx, tag, rows);
}

function sqlItems(): BankItem[] {
  const f = (
    suite: string,
    id: string,
    tier: Tier,
    title: string,
    cases: (s: SqlSetup) => [string, string, 'pass' | 'fail' | 'inconclusive'][],
  ): readonly [string, Tier, string, Probe] => [
    id,
    tier,
    title,
    async (ctx) => {
      const tag = `${P}.${suite}.${id}`;
      const setup = sqlSetup(ctx, tag);
      const list = cases(setup);
      const rec = await sqlRun(
        ctx,
        tag,
        setup,
        list.map(([golden, query]) => ({ golden, query })),
      );
      return list.map(([golden, query, want], i) => {
        const found = expectV(rec, i, 'sql.0', want);
        return found && `golden "${golden}" against agent query "${query}": ${found}`;
      });
    },
  ];
  return [
    ...variants(FAMILY, `${P}.sql-rows`, CHECKS, 'sql-rows-multiset', [
      f(
        'sql-rows',
        'same-rows',
        3,
        'an agent query that returns the golden rows passes, one that returns other rows fails',
        (s) => [
          [
            `SELECT name, qty FROM ${s.table} WHERE qty > 2`,
            `SELECT name, qty FROM ${s.table} WHERE qty >= 3`,
            'pass',
          ],
          [
            `SELECT name, qty FROM ${s.table} WHERE qty > 2`,
            `SELECT name, qty FROM ${s.table} WHERE qty > 1`,
            'fail',
          ],
          [`SELECT name FROM ${s.table}`, `SELECT name FROM ${s.table} WHERE qty < 4`, 'fail'],
        ],
      ),
      f(
        'sql-rows',
        'a-duplicated-row',
        4,
        'rows compare as a multiset: a row returned twice is not the row returned once',
        (s) => [
          [
            `SELECT name FROM ${s.table} WHERE qty = 1`,
            `SELECT name FROM ${s.table} WHERE qty = 1 UNION ALL SELECT name FROM ${s.table} WHERE qty = 1`,
            'fail',
          ],
          [
            `SELECT name FROM ${s.table} WHERE qty = 1 UNION ALL SELECT name FROM ${s.table} WHERE qty = 1`,
            `SELECT name FROM ${s.table} WHERE qty = 1 UNION ALL SELECT name FROM ${s.table} WHERE qty = 1`,
            'pass',
          ],
        ],
      ),
      f('sql-rows', 'an-empty-result', 3, 'two queries that return no row return the same rows', (s) => [
        [`SELECT name FROM ${s.table} WHERE qty > 100`, `SELECT name FROM ${s.table} WHERE qty < 0`, 'pass'],
        [`SELECT name FROM ${s.table} WHERE qty > 100`, `SELECT name FROM ${s.table}`, 'fail'],
      ]),
    ]),
    ...variants(FAMILY, `${P}.sql-order`, CHECKS, 'sql-order-by-golden', [
      f(
        'sql-order',
        'order-is-free-without-order-by',
        4,
        'without ORDER BY in the golden query the order of the rows does not matter',
        (s) => [
          [`SELECT name FROM ${s.table}`, `SELECT name FROM ${s.table} ORDER BY qty DESC`, 'pass'],
          [`SELECT name FROM ${s.table}`, `SELECT name FROM ${s.table} ORDER BY name`, 'pass'],
        ],
      ),
      f(
        'sql-order',
        'order-counts-with-order-by',
        4,
        'with ORDER BY in the golden query the rows must come in the same order',
        (s) => [
          [
            `SELECT name FROM ${s.table} ORDER BY qty ASC`,
            `SELECT name FROM ${s.table} ORDER BY qty DESC`,
            'fail',
          ],
          [
            `SELECT name FROM ${s.table} ORDER BY qty ASC`,
            `SELECT name FROM ${s.table} ORDER BY qty ASC`,
            'pass',
          ],
          [`SELECT name FROM ${s.table} ORDER BY qty DESC`, `SELECT name FROM ${s.table}`, 'fail'],
        ],
      ),
      f(
        'sql-order',
        'order-by-in-lower-case',
        4,
        'an order by written in lower case in the golden query counts as an ORDER BY',
        (s) => [
          [
            `select name from ${s.table} order by qty asc`,
            `SELECT name FROM ${s.table} ORDER BY qty DESC`,
            'fail',
          ],
          [
            `select name from ${s.table} order by qty asc`,
            `SELECT name FROM ${s.table} ORDER BY qty ASC`,
            'pass',
          ],
        ],
      ),
    ]),
    ...variants(FAMILY, `${P}.sql-columns`, CHECKS, 'sql-column-names-ignored', [
      f(
        'sql-columns',
        'an-alias',
        3,
        'column names do not compare: an alias on the agent query changes no row',
        (s) => [
          [`SELECT name, qty FROM ${s.table}`, `SELECT name AS who, qty AS how_many FROM ${s.table}`, 'pass'],
          [
            `SELECT name, qty FROM ${s.table}`,
            `SELECT name AS who, qty + 1 AS how_many FROM ${s.table}`,
            'fail',
          ],
        ],
      ),
      f(
        'sql-columns',
        'an-expression-column',
        3,
        'a computed column compares by its values, not by the text of its expression',
        (s) => [
          [`SELECT qty * 2 FROM ${s.table}`, `SELECT qty + qty AS twice FROM ${s.table}`, 'pass'],
          [`SELECT qty * 2 FROM ${s.table}`, `SELECT qty * 3 AS twice FROM ${s.table}`, 'fail'],
        ],
      ),
      f(
        'sql-columns',
        'a-different-column-count',
        4,
        'a query that returns another number of columns returns other rows',
        (s) => [
          [`SELECT name, qty FROM ${s.table}`, `SELECT name FROM ${s.table}`, 'fail'],
          [`SELECT name FROM ${s.table}`, `SELECT name, qty FROM ${s.table}`, 'fail'],
        ],
      ),
    ]),
    ...variants(FAMILY, `${P}.sql-write`, CHECKS, 'sql-write-refused', [
      [
        'a-delete-is-refused-and-the-data-stays',
        4,
        'a write the agent sent is refused before it runs: the verdict fails and the database is unchanged',
        async (ctx) => {
          const tag = `${P}.sql-write.delete`;
          const setup = sqlSetup(ctx, tag);
          const before = setup.count();
          const rec = await sqlRun(ctx, tag, setup, [
            { golden: `SELECT name FROM ${setup.table}`, query: `DELETE FROM ${setup.table}` },
          ]);
          return [
            expectV(rec, 0, 'sql.0', 'fail', true),
            setup.count() === before
              ? undefined
              : `the database held ${before} rows and holds ${setup.count()} after the check`,
          ];
        },
      ],
      [
        'an-insert-is-refused',
        4,
        'an insert is refused too, and the table keeps its rows',
        async (ctx) => {
          const tag = `${P}.sql-write.insert`;
          const setup = sqlSetup(ctx, tag);
          const before = setup.count();
          const rec = await sqlRun(ctx, tag, setup, [
            {
              golden: `SELECT name FROM ${setup.table}`,
              query: `INSERT INTO ${setup.table} (name, qty) VALUES ('zz', 9)`,
            },
          ]);
          return [
            expectV(rec, 0, 'sql.0', 'fail', true),
            setup.count() === before
              ? undefined
              : `the database held ${before} rows and holds ${setup.count()} after the check`,
          ];
        },
      ],
      [
        'a-write-behind-a-read-is-refused',
        5,
        'only one read statement is accepted: a read followed by a write is refused and nothing runs',
        async (ctx) => {
          const tag = `${P}.sql-write.two`;
          const setup = sqlSetup(ctx, tag);
          const before = setup.count();
          const rec = await sqlRun(ctx, tag, setup, [
            {
              golden: `SELECT name FROM ${setup.table}`,
              query: `SELECT name FROM ${setup.table}; DELETE FROM ${setup.table}`,
            },
          ]);
          return [
            expectV(rec, 0, 'sql.0', 'fail', true),
            setup.count() === before
              ? undefined
              : `the database held ${before} rows and holds ${setup.count()} after the check`,
          ];
        },
      ],
      [
        'two-reads-are-refused',
        5,
        'only one read statement is accepted: two reads in one query are refused',
        async (ctx) => {
          const tag = `${P}.sql-write.reads`;
          const setup = sqlSetup(ctx, tag);
          const rec = await sqlRun(ctx, tag, setup, [
            {
              golden: `SELECT name FROM ${setup.table}`,
              query: `SELECT name FROM ${setup.table}; SELECT name FROM ${setup.table}`,
            },
            { golden: `SELECT name FROM ${setup.table}`, query: `SELECT name FROM ${setup.table};` },
          ]);
          return [expectV(rec, 0, 'sql.0', 'fail', true), expectV(rec, 1, 'sql.0', 'pass', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.sql-fail`, CHECKS, 'sql-failing-queries', [
      [
        'the-agent-query-fails',
        3,
        'an agent query that fails is a fail that quotes the database message',
        async (ctx) => {
          const tag = `${P}.sql-fail.agent`;
          const setup = sqlSetup(ctx, tag);
          const rec = await sqlRun(ctx, tag, setup, [
            {
              golden: `SELECT name FROM ${setup.table}`,
              query: `SELECT name FROM ${tok(ctx, tag, 'missing', 9)}`,
            },
          ]);
          const text = String(verdict(rec, 0, 'sql.0')?.evidence ?? '');
          return [
            expectV(rec, 0, 'sql.0', 'fail'),
            /no such table/i.test(text)
              ? undefined
              : `the evidence does not quote the database message: ${text.slice(0, 180)}`,
          ];
        },
      ],
      [
        'the-golden-query-fails',
        4,
        'a golden query that fails is inconclusive, never a fail of the agent',
        async (ctx) => {
          const tag = `${P}.sql-fail.golden`;
          const setup = sqlSetup(ctx, tag);
          const rec = await sqlRun(ctx, tag, setup, [
            {
              golden: `SELECT name FROM ${tok(ctx, tag, 'missing', 9)}`,
              query: `SELECT name FROM ${setup.table}`,
            },
          ]);
          return [expectV(rec, 0, 'sql.0', 'inconclusive')];
        },
      ],
      [
        'the-query-is-read-from-the-named-tool',
        4,
        'the query is read from the call of the named tool: the same query on another tool does not count',
        async (ctx) => {
          const tag = `${P}.sql-fail.tool`;
          const setup = sqlSetup(ctx, tag);
          const [other] = [tok(ctx, tag, 'other', 8)] as [string];
          const rec = await sqlRun(ctx, tag, setup, [
            { golden: `SELECT name FROM ${setup.table}`, query: `SELECT name FROM ${setup.table}` },
            {
              golden: `SELECT name FROM ${setup.table}`,
              query: `SELECT name FROM ${setup.table}`,
              tool: other,
            },
          ]);
          const second = verdict(rec, 1, 'sql.0');
          return [
            expectV(rec, 0, 'sql.0', 'pass', true),
            second && second.outcome === 'pass'
              ? 'a call of another tool satisfied the sql expectation'
              : undefined,
          ];
        },
      ],
    ]),
  ];
}

export function scoreItems(): BankItem[] {
  return [...similarityItems(), ...relevancyItems(), ...retentionItems(), ...overlapItems(), ...sqlItems()];
}
