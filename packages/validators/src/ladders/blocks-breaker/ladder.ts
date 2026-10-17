import { loadIssues } from '../blocks/harness';
import {
  type BankItem,
  type BlockDef,
  type BlockRecord,
  type Call,
  expectAll,
  type ItemContext,
  type ItemResult,
  item,
  PASS,
  play,
  say,
  scenario,
  show,
  verdictOf,
  word,
} from './kit';

/**
 * bk-ladder: the value-check ladder through the tools check, with no replayer and no judge (the way the command line
 * runs it; breaker-items.md, second wave, family bk-ladder). Sources: docs/reference/block-contracts.md ("Value
 * ladder", "Exact by declaration", "Identity", "Contract rung", "As given rung", "Exact fallback") and
 * packages/cli/help/judging-check-tools.md ("The value-check ladder"). Every item runs the shape the docs decide one
 * way and a twin they decide the other way.
 */

const FAMILY = 'bk-ladder';
const CHECKS = 'packages/checks/src/value-check';
const D_LADDER = 'docs/reference/block-contracts.md "Value ladder"';
const D_GIVEN = 'docs/reference/block-contracts.md "As given rung"';
const D_CONTRACT = 'docs/reference/block-contracts.md "Contract rung"';
const D_EXACT = 'docs/reference/block-contracts.md "Exact by declaration"';
const D_FALLBACK = 'docs/reference/block-contracts.md "Exact fallback"';

const TOOL = 'tool.write';

type Verdict = {
  outcome?: string;
  gating?: boolean;
  evidence?: string;
  valueCheck?: { call: number; path: string; rung: string; outcome: string }[];
};

type Setup = {
  /** What the user writes in each block, one entry per block; the last block makes the call. */
  users: string[];
  /** The input of the call in the last block (or in `callAt`). */
  actual: Record<string, unknown> | Record<string, unknown>[];
  /** The expectation of the call: field to assertion. */
  expected: Record<string, unknown>;
  compare?: unknown;
  /** The tool schema of the properties, by field. */
  schema?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  blockUses?: unknown;
  /** The block that makes the call (default: the last). */
  callAt?: number;
};

type Out = {
  block: BlockRecord | undefined;
  verdict: (field: string) => Verdict | undefined;
  lint: (field: string) => Verdict | undefined;
  rung: (field: string) => string | undefined;
};

async function ladderRun(ctx: ItemContext, tag: string, setup: Setup): Promise<Out> {
  const callAt = setup.callAt ?? setup.users.length - 1;
  const calls: Call[] = (Array.isArray(setup.actual) ? setup.actual : [setup.actual]).map((input) => ({
    label: TOOL,
    input,
  }));
  const defs: BlockDef[] = setup.users.map((text, i) => ({
    say: (marker) => `${marker} ${text}`,
    plan: { text: 'Done.', calls: i === callAt ? calls : [] },
    expect:
      i === callAt
        ? {
            tools: [
              {
                label: TOOL,
                count: calls.length,
                input: setup.expected,
                ...(setup.compare !== undefined ? { compare: setup.compare } : {}),
              },
            ],
          }
        : {},
    ...(i === callAt && setup.blockUses !== undefined ? { extra: { uses: setup.blockUses } } : {}),
  }));
  const spec: Record<string, unknown> = {
    ...(setup.schema
      ? { metadata: { tool_schemas: { [TOOL]: { type: 'object', properties: setup.schema } } } }
      : {}),
    ...(setup.spec ?? {}),
  };
  const { rec } = await play(ctx, scenario(ctx.seed, tag, defs, spec), { mode: 'F' });
  const block = rec.blocks[callAt];
  const verdict = (field: string) => verdictOf(block, `tools.${TOOL}.input.${field}`) as Verdict | undefined;
  return {
    block,
    verdict,
    lint: (field) => verdictOf(block, `tools.${TOOL}.input.${field}.no_decider`) as Verdict | undefined,
    rung: (field) => verdict(field)?.valueCheck?.[0]?.rung,
  };
}

const upper = (ctx: ItemContext, tag: string, length = 6) => word(ctx.seed, tag, length).toUpperCase();

type Case = {
  id: string;
  tier: 3 | 4 | 5;
  cause:
    | 'LD1'
    | 'LD2'
    | 'LD3'
    | 'LD4'
    | 'LD5'
    | 'LD6'
    | 'LD7'
    | 'LD8'
    | 'LD9'
    | 'LD10'
    | 'LD11'
    | 'LD12'
    | 'LD13'
    | 'LD14'
    | 'LD15'
    | 'LD16'
    | 'LD17'
    | 'LD18'
    | 'LD19'
    | 'LD20'
    | 'LD21'
    | 'LD22'
    | 'LD23'
    | 'LD24'
    | 'LD25'
    | 'LD26';
  title: string;
  run(ctx: ItemContext, tag: string): Promise<ItemResult>;
};

/** The ladder decided `field` of the call by `rung` and failed it. */
const decidedBy = (out: Out, field: string, rung: string, outcome = 'fail') => {
  const entry = out.verdict(field)?.valueCheck?.[0];
  return entry?.rung === rung && entry.outcome === outcome;
};
const describe = (out: Out, field: string) =>
  show({
    outcome: out.verdict(field)?.outcome,
    valueCheck: out.verdict(field)?.valueCheck,
    lint: out.lint(field)?.outcome,
  });

const F = 'ff';

/** A token test: the user writes `before` + expected + `after`; the agent wrote another value. */
function tokenCase(
  id: string,
  cause: Case['cause'],
  title: string,
  wrap: (value: string) => string,
  fires: boolean,
): Case {
  return {
    id,
    tier: 4,
    cause,
    title,
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const actual = upper(ctx, `${tag}:a`);
      const out = await ladderRun(ctx, tag, {
        users: [`It is ${wrap(expected)} thanks`],
        actual: { [F]: actual },
        expected: { [F]: expected },
      });
      return fires
        ? expectAll([
            [
              decidedBy(out, F, 'rung2b_as_given'),
              say(
                D_GIVEN,
                `the user wrote ${wrap('X')}: the expected value is a whole token, so the as-given rung fails the changed value`,
                describe(out, F),
              ),
            ],
          ])
        : expectAll([
            [
              decidedBy(out, F, 'exact_fallback'),
              say(
                D_GIVEN,
                `the user wrote ${wrap('X')}: no whole token, so no as-given decision and the exact fallback fails it`,
                describe(out, F),
              ),
            ],
          ]);
    },
  };
}

const CASES: Case[] = [
  tokenCase(
    'token-comma',
    'LD1',
    'the expected writing followed by a comma is a whole token',
    (v) => `${v},`,
    true,
  ),
  tokenCase(
    'token-underscore',
    'LD2',
    'an underscore is neither a letter nor a digit: the expected writing after one is a whole token',
    (v) => `x_${v}`,
    true,
  ),
  tokenCase(
    'token-accented-letter',
    'LD3',
    'an accented letter next to the expected writing is a letter: no whole token',
    (v) => `é${v}`,
    false,
  ),
  tokenCase(
    'token-digit',
    'LD4',
    'a digit next to the expected writing: no whole token',
    (v) => `1${v}`,
    false,
  ),
  tokenCase(
    'token-inside-word',
    'LD4',
    'the expected writing inside a longer word: no whole token',
    (v) => `${v}s`,
    false,
  ),
  {
    id: 'token-whole-message',
    tier: 3,
    cause: 'LD5',
    title: 'a message that is the expected writing and nothing else is a whole token',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const out = await ladderRun(ctx, tag, {
        users: [expected],
        actual: { [F]: upper(ctx, `${tag}:a`) },
        expected: { [F]: expected },
      });
      return expectAll([
        [
          decidedBy(out, F, 'rung2b_as_given'),
          say(D_GIVEN, 'the whole message is the token', describe(out, F)),
        ],
      ]);
    },
  },
  {
    id: 'source-earlier-block',
    tier: 3,
    cause: 'LD6',
    title:
      'the user wrote the expected writing in an earlier block: the as-given rung reads the blocks before',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const out = await ladderRun(ctx, tag, {
        users: [`My code is ${expected}`, 'Please go ahead'],
        actual: { [F]: upper(ctx, `${tag}:a`) },
        expected: { [F]: expected },
      });
      return expectAll([
        [
          decidedBy(out, F, 'rung2b_as_given'),
          say(
            D_GIVEN,
            'the sources are the user messages of the block and of earlier blocks',
            describe(out, F),
          ),
        ],
      ]);
    },
  },
  {
    id: 'source-later-block-not-read',
    tier: 4,
    cause: 'LD7',
    title: 'a message of a block after the call is no source: the exact fallback decides',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const out = await ladderRun(ctx, tag, {
        users: ['Please go ahead', `My code is ${expected}`],
        callAt: 0,
        actual: { [F]: upper(ctx, `${tag}:a`) },
        expected: { [F]: expected },
      });
      return expectAll([
        [
          decidedBy(out, F, 'exact_fallback'),
          say(
            D_GIVEN,
            'the sources are the user messages of the block and of the blocks before it, not after',
            describe(out, F),
          ),
        ],
      ]);
    },
  },
  {
    id: 'stale-across-blocks',
    tier: 4,
    cause: 'LD8',
    title:
      'the user gave a value, then the expected one in a later message, and the agent kept the earlier: stale',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const earlier = upper(ctx, `${tag}:a`);
      const out = await ladderRun(ctx, tag, {
        users: [`Use ${earlier}`, `Sorry, use ${expected}`],
        actual: { [F]: earlier },
        expected: { [F]: expected },
      });
      const evidence = String(out.verdict(F)?.evidence ?? '');
      const reversed = await ladderRun(ctx, `${tag}:rev`, {
        users: [`Use ${expected}`, `Sorry, use ${earlier}`],
        actual: { [F]: earlier },
        expected: { [F]: expected },
      });
      return expectAll([
        [
          decidedBy(out, F, 'rung2b_as_given'),
          say(D_GIVEN, 'the earlier value kept after a correction fails as stale', describe(out, F)),
        ],
        [
          evidence.includes('later message') && evidence.includes('earlier'),
          say(
            D_GIVEN,
            'the evidence says the user corrected the value in a later message',
            evidence.slice(0, 200),
          ),
        ],
        [
          decidedBy(reversed, F, 'exact_fallback'),
          say(
            D_GIVEN,
            'the expected value first and the agent value after is no stale case: nothing decides',
            describe(reversed, F),
          ),
        ],
      ]);
    },
  },
  {
    id: 'both-in-one-message',
    tier: 4,
    cause: 'LD9',
    title: 'the value and the expected writing in one message: the as-given rung decides nothing',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const actual = upper(ctx, `${tag}:a`);
      const out = await ladderRun(ctx, tag, {
        users: [`${expected} or maybe ${actual}`],
        actual: { [F]: actual },
        expected: { [F]: expected },
      });
      return expectAll([
        [
          decidedBy(out, F, 'exact_fallback'),
          say(D_GIVEN, 'both writings in the same message decide nothing', describe(out, F)),
        ],
      ]);
    },
  },
  {
    id: 'copy-never-passes',
    tier: 3,
    cause: 'LD10',
    title: 'a value the agent copied from the user is never passed by the as-given rung',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const actual = upper(ctx, `${tag}:a`);
      const out = await ladderRun(ctx, tag, {
        users: [`Use ${actual}`],
        actual: { [F]: actual },
        expected: { [F]: expected },
      });
      const lint = out.lint(F);
      return expectAll([
        [
          out.verdict(F)?.outcome === 'fail' && decidedBy(out, F, 'exact_fallback'),
          say(D_GIVEN, 'a copy goes on to the exact fallback and fails', describe(out, F)),
        ],
        [
          lint?.outcome === 'fail' && lint.gating === false,
          say(D_FALLBACK, 'the no_decider lint is present and not gating', show(lint)),
        ],
      ]);
    },
  },
  {
    id: 'compare-contract-alone',
    tier: 4,
    cause: 'LD11',
    title:
      'compare contract runs the contract item alone: the as-given rung does not run even when the user gave the value',
    async run(ctx, tag) {
      const [expected, actual, other] = [1, 2, 3].map((i) => upper(ctx, `${tag}:v${i}`));
      const schema = { [F]: { type: 'string', enum: [expected, actual, other] } };
      const alone = await ladderRun(ctx, tag, {
        users: [`It is ${expected}`],
        actual: { [F]: actual },
        expected: { [F]: expected },
        compare: 'contract',
        schema,
      });
      const named = await ladderRun(ctx, `${tag}:given`, {
        users: [`It is ${expected}`],
        actual: { [F]: actual },
        expected: { [F]: expected },
        compare: 'as_given',
        schema,
      });
      return expectAll([
        [
          decidedBy(alone, F, 'rung2_contract'),
          say(D_LADDER, 'compare contract: the contract item decides', describe(alone, F)),
        ],
        [
          decidedBy(named, F, 'rung2b_as_given'),
          say(
            D_LADDER,
            'compare as_given: the as-given item decides, the contract is not read',
            describe(named, F),
          ),
        ],
      ]);
    },
  },
  {
    id: 'compare-by-argument-name',
    tier: 4,
    cause: 'LD12',
    title: 'a compare by argument name gives each argument its own mode',
    async run(ctx, tag) {
      const [e1, a1, e2, a2] = [1, 2, 3, 4].map((i) => upper(ctx, `${tag}:v${i}`));
      const out = await ladderRun(ctx, tag, {
        users: [`First ${e1} then ${e2}`],
        actual: { [F]: a1, gg: a2 },
        expected: { [F]: e1, gg: e2 },
        compare: { [F]: 'as_given', gg: 'contract' },
        schema: { gg: { type: 'string', enum: [e2, a2] } },
      });
      return expectAll([
        [
          decidedBy(out, F, 'rung2b_as_given'),
          say(D_LADDER, `${F} is decided by the as-given item`, describe(out, F)),
        ],
        [
          decidedBy(out, 'gg', 'rung2_contract'),
          say(D_LADDER, 'gg is decided by the contract item', describe(out, 'gg')),
        ],
      ]);
    },
  },
  {
    id: 'compare-mode-cannot-apply',
    tier: 4,
    cause: 'LD13',
    title: 'a named compare mode that cannot apply falls back to the exact compare, never to the other items',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const actual = upper(ctx, `${tag}:a`);
      const out = await ladderRun(ctx, tag, {
        users: [`It is ${expected}`],
        actual: { [F]: actual },
        expected: { [F]: expected },
        compare: 'outcome',
      });
      return expectAll([
        [
          decidedBy(out, F, 'exact_fallback'),
          say(
            D_LADDER,
            'compare outcome with no replayer is the exact fallback even though the user gave the value',
            describe(out, F),
          ),
        ],
      ]);
    },
  },
  {
    id: 'contract-two-members',
    tier: 3,
    cause: 'LD14',
    title: 'two different members of an enum fail at the contract rung and the evidence names the keyword',
    async run(ctx, tag) {
      const [expected, actual] = [upper(ctx, `${tag}:e`), upper(ctx, `${tag}:a`)];
      const out = await ladderRun(ctx, tag, {
        users: ['go'],
        actual: { [F]: actual },
        expected: { [F]: expected },
        schema: { [F]: { type: 'string', enum: [expected, actual] } },
      });
      const evidence = String(out.verdict(F)?.evidence ?? '');
      return expectAll([
        [
          decidedBy(out, F, 'rung2_contract'),
          say(D_CONTRACT, 'two different enum members fail at the contract rung', describe(out, F)),
        ],
        [
          evidence.includes('enum'),
          say(D_CONTRACT, 'the evidence names the keyword the value breaks', evidence.slice(0, 200)),
        ],
      ]);
    },
  },
  {
    id: 'contract-pattern-passes-nothing',
    tier: 4,
    cause: 'LD15',
    title:
      'a value inside the stated pattern but different from the expected one goes on to the exact fallback',
    async run(ctx, tag) {
      const schema = { [F]: { type: 'string', pattern: '^[A-Z]{6}$' } };
      const [expected, inside] = [upper(ctx, `${tag}:e`), upper(ctx, `${tag}:i`)];
      const insideRun = await ladderRun(ctx, tag, {
        users: ['go'],
        actual: { [F]: inside },
        expected: { [F]: expected },
        schema,
      });
      const outside = await ladderRun(ctx, `${tag}:out`, {
        users: ['go'],
        actual: { [F]: inside.toLowerCase() },
        expected: { [F]: expected },
        schema,
      });
      return expectAll([
        [
          decidedBy(insideRun, F, 'exact_fallback'),
          say(
            D_CONTRACT,
            'inside the pattern: the contract rung passes nothing, the exact fallback fails it',
            describe(insideRun, F),
          ),
        ],
        [
          decidedBy(outside, F, 'rung2_contract'),
          say(D_CONTRACT, 'outside the pattern: the contract rung fails it', describe(outside, F)),
        ],
      ]);
    },
  },
  {
    id: 'contract-const',
    tier: 3,
    cause: 'LD16',
    title: 'a value that is not the const of the field fails at the contract rung',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const out = await ladderRun(ctx, tag, {
        users: ['go'],
        actual: { [F]: expected.toLowerCase() },
        expected: { [F]: expected },
        schema: { [F]: { type: 'string', const: expected } },
      });
      return expectAll([
        [decidedBy(out, F, 'rung2_contract'), say(D_CONTRACT, 'the const is broken', describe(out, F))],
      ]);
    },
  },
  {
    id: 'subset-leaf-path',
    tier: 4,
    cause: 'LD17',
    title: 'each leaf of a subset assertion goes through the ladder, and its decision names the dotted path',
    async run(ctx, tag) {
      const expected = upper(ctx, `${tag}:e`);
      const actual = upper(ctx, `${tag}:a`);
      const out = await ladderRun(ctx, tag, {
        users: [`It is ${expected}`],
        actual: { [F]: { k: actual, extra: 1 } },
        expected: { [F]: { subset: { k: expected } } },
      });
      const entry = out.verdict(F)?.valueCheck?.[0];
      return expectAll([
        [
          entry?.path === `${F}.k` && entry.rung === 'rung2b_as_given',
          say(D_LADDER, `the leaf is decided at path ${F}.k by the as-given rung`, describe(out, F)),
        ],
      ]);
    },
  },
  {
    id: 'other-forms-as-written',
    tier: 4,
    cause: 'LD18',
    title: 'regex, contains, one_of, nonempty and absent compare as written: no ladder decision and no lint',
    async run(ctx, tag) {
      const v = upper(ctx, `${tag}:v`);
      const forms: [string, unknown, unknown][] = [
        ['regex', { regex: `^${v.toLowerCase()}$` }, v],
        ['contains', { contains: v.toLowerCase() }, v],
        ['one_of', { one_of: [`${v}x`] }, v],
        ['nonempty', { nonempty: true }, ''],
        ['absent', { absent: true }, v],
      ];
      for (const [name, assertion, actual] of forms) {
        const out = await ladderRun(ctx, `${tag}:${name}`, {
          users: [`It is ${v}`],
          actual: { [F]: actual },
          expected: { [F]: assertion },
        });
        if (
          out.verdict(F)?.outcome !== 'fail' ||
          out.verdict(F)?.valueCheck !== undefined ||
          out.lint(F) !== undefined
        )
          return expectAll([
            [
              false,
              say(D_LADDER, `${name}: a plain failure with no ladder entry and no lint`, describe(out, F)),
            ],
          ]);
      }
      return PASS;
    },
  },
  {
    id: 'equal-value-no-ladder-entry',
    tier: 3,
    cause: 'LD19',
    title: 'a value equal to the expected one passes with no ladder entry and no lint',
    async run(ctx, tag) {
      const v = upper(ctx, `${tag}:v`);
      const out = await ladderRun(ctx, tag, {
        users: [`It is ${v}`],
        actual: { [F]: v },
        expected: { [F]: v },
      });
      const different = await ladderRun(ctx, `${tag}:d`, {
        users: [`It is ${v}`],
        actual: { [F]: `${v}X` },
        expected: { [F]: v },
      });
      return expectAll([
        [
          out.verdict(F)?.outcome === 'pass' &&
            out.verdict(F)?.valueCheck === undefined &&
            out.lint(F) === undefined,
          say(D_LADDER, 'equal: pass, no valueCheck, no lint', describe(out, F)),
        ],
        [
          different.verdict(F)?.outcome === 'fail',
          say(D_LADDER, 'a different value fails', describe(different, F)),
        ],
      ]);
    },
  },
  {
    id: 'argument-accuracy-does-not-gate',
    tier: 4,
    cause: 'LD20',
    title:
      'the argument accuracy counts the matched arguments and never gates, while the failing argument verdict gates',
    async run(ctx, tag) {
      const [a, b, bad] = [1, 2, 3].map((i) => upper(ctx, `${tag}:v${i}`));
      const out = await ladderRun(ctx, tag, {
        users: ['go'],
        actual: { [F]: a, gg: bad },
        expected: { [F]: a, gg: b },
      });
      const accuracy = verdictOf(out.block, 'tools.argument_accuracy') as Verdict | undefined;
      return expectAll([
        [
          out.verdict(F)?.outcome === 'pass' &&
            out.verdict('gg')?.outcome === 'fail' &&
            out.verdict('gg')?.gating === true,
          say(D_LADDER, `${F} passes, gg fails and gates`, describe(out, 'gg')),
        ],
        [
          accuracy !== undefined &&
            accuracy.gating === false &&
            String(accuracy.evidence).startsWith('1 of 2'),
          say(D_LADDER, 'the argument accuracy reads 1 of 2 and does not gate', show(accuracy)),
        ],
      ]);
    },
  },
  {
    id: 'no-decider-lint-not-gating',
    tier: 4,
    cause: 'LD21',
    title:
      'the no_decider lint is a failing verdict that does not gate; the block fails on the input verdict',
    async run(ctx, tag) {
      const v = upper(ctx, `${tag}:v`);
      const out = await ladderRun(ctx, tag, {
        users: ['go'],
        actual: { [F]: `${v}X` },
        expected: { [F]: v },
      });
      const lint = out.lint(F);
      const evidence = String(lint?.evidence ?? '');
      return expectAll([
        [
          lint?.outcome === 'fail' && lint.gating === false,
          say(D_FALLBACK, 'the lint fails and does not gate', show(lint)),
        ],
        [
          /replayer|rung1_outcome/.test(evidence) &&
            /rung2_contract/.test(evidence) &&
            /rung3_same_referent/.test(evidence),
          say(
            D_FALLBACK,
            'the lint names what would settle the value: a replayer, a pattern or an enum, a calibrated judge',
            evidence.slice(0, 260),
          ),
        ],
        [
          out.block?.pass === false && out.verdict(F)?.gating === true,
          say(D_FALLBACK, 'the block fails on the gating input verdict', `pass ${out.block?.pass}`),
        ],
      ]);
    },
  },
  {
    id: 'exact-declared-pass-and-fail',
    tier: 4,
    cause: 'LD22',
    title: 'compare exact passes the exact value and fails any other writing with the reason in the evidence',
    async run(ctx, tag) {
      const v = upper(ctx, `${tag}:v`);
      const reason = `${word(ctx.seed, `${tag}:r1`, 6)} ${word(ctx.seed, `${tag}:r2`, 7)}`;
      const equal = await ladderRun(ctx, `${tag}:eq`, {
        users: ['go'],
        actual: { [F]: v },
        expected: { [F]: v },
        compare: { exact: reason },
      });
      const differs = await ladderRun(ctx, `${tag}:df`, {
        users: ['go'],
        actual: { [F]: v.toLowerCase() },
        expected: { [F]: v },
        compare: { exact: reason },
      });
      const evidence = String(differs.verdict(F)?.evidence ?? '');
      return expectAll([
        [equal.verdict(F)?.outcome === 'pass', say(D_EXACT, 'the exact value passes', describe(equal, F))],
        [
          decidedBy(differs, F, 'rung4_exact'),
          say(D_EXACT, 'another writing fails at the exact item', describe(differs, F)),
        ],
        [
          evidence.includes(`is not exactly "${v}" (${reason})`),
          say(
            D_EXACT,
            'the evidence reads <value> is not exactly <expected> (<reason>)',
            evidence.slice(0, 260),
          ),
        ],
      ]);
    },
  },
  {
    id: 'exact-beats-every-other-item',
    tier: 5,
    cause: 'LD23',
    title:
      'under compare exact nothing else runs: the user gave the value and the contract fails it, yet the exact item decides',
    async run(ctx, tag) {
      const [expected, actual] = [upper(ctx, `${tag}:e`), upper(ctx, `${tag}:a`)];
      const out = await ladderRun(ctx, tag, {
        users: [`It is ${expected}`],
        actual: { [F]: actual },
        expected: { [F]: expected },
        compare: { exact: 'the dialer reads this writing' },
        schema: { [F]: { type: 'string', enum: [expected, actual] } },
      });
      return expectAll([
        [
          decidedBy(out, F, 'rung4_exact') && out.lint(F) === undefined,
          say(D_EXACT, 'only the exact item decides and no no_decider lint is added', describe(out, F)),
        ],
      ]);
    },
  },
  {
    id: 'one-entry-per-decided-value',
    tier: 5,
    cause: 'LD24',
    title:
      'with several calls each value is decided on its own: the decisions name their call and only the decided values appear',
    async run(ctx, tag) {
      const [expected, actual] = [upper(ctx, `${tag}:e`), upper(ctx, `${tag}:a`)];
      const out = await ladderRun(ctx, tag, {
        users: [`It is ${expected}`],
        actual: [{ [F]: expected }, { [F]: actual }, { [F]: expected }],
        expected: { [F]: expected },
      });
      const entries = out.verdict(F)?.valueCheck ?? [];
      return expectAll([
        [
          entries.length === 1 && entries[0]?.call === 2 && entries[0]?.rung === 'rung2b_as_given',
          say(D_LADDER, 'one entry, for call 2, by the as-given rung', show(entries)),
        ],
        [
          out.verdict(F)?.outcome === 'fail',
          say(
            D_LADDER,
            'every call must hold the assertion: one altered call fails the verdict',
            describe(out, F),
          ),
        ],
      ]);
    },
  },
  {
    id: 'uses-disable-and-block-replaces',
    tier: 5,
    cause: 'LD25',
    title:
      'a spec uses object that disables the as-given item sends the value to the exact fallback, and a block uses replaces the spec choice',
    async run(ctx, tag) {
      const [expected, actual] = [upper(ctx, `${tag}:e`), upper(ctx, `${tag}:a`)];
      const disabled = {
        value_check: { extends: 'default', items: [{ id: 'rung2b_as_given', enabled: false }] },
      };
      const base = { users: [`It is ${expected}`], actual: { [F]: actual }, expected: { [F]: expected } };
      const specLevel = await ladderRun(ctx, `${tag}:spec`, { ...base, spec: { uses: disabled } });
      const blockLevel = await ladderRun(ctx, `${tag}:block`, {
        ...base,
        spec: { uses: disabled },
        blockUses: { value_check: 'default' },
      });
      return expectAll([
        [
          decidedBy(specLevel, F, 'exact_fallback'),
          say(D_LADDER, 'with the item disabled the exact fallback decides', describe(specLevel, F)),
        ],
        [
          decidedBy(blockLevel, F, 'rung2b_as_given'),
          say(
            D_LADDER,
            "the block's choice replaces the spec's: the item runs again",
            describe(blockLevel, F),
          ),
        ],
      ]);
    },
  },
  {
    id: 'compare-mode-refused',
    tier: 3,
    cause: 'LD26',
    title: 'a compare that is no documented mode is refused, and every documented mode loads',
    async run(ctx, tag) {
      const v = upper(ctx, `${tag}:v`);
      const spec = (compare: unknown) => ({
        id: word(ctx.seed, `${tag}:id`, 8),
        blocks: [
          {
            user: word(ctx.seed, `${tag}:u`, 9),
            expect: { tools: [{ label: TOOL, input: { [F]: v }, compare }] },
          },
        ],
      });
      const modes: unknown[] = [
        'auto',
        'outcome',
        'contract',
        'as_given',
        'same_referent',
        { exact: 'the reason' },
        { [F]: 'contract' },
      ];
      const checks: [boolean, string][] = [];
      for (const mode of modes) {
        const answer = loadIssues(ctx.product, spec(mode));
        checks.push([
          answer.ok,
          say(D_LADDER, `compare ${show(mode)} loads`, `refused with ${show(answer.codes)}`),
        ]);
      }
      for (const bad of ['sometimes', { [F]: 'nope' }]) {
        const answer = loadIssues(ctx.product, spec(bad));
        checks.push([!answer.ok, say(D_LADDER, `compare ${show(bad)} is refused`, 'the spec loaded')]);
      }
      return expectAll(checks);
    },
  },
];

/** Items of the family bk-ladder: 28. */
export function ladderItems(): BankItem[] {
  return CASES.map((c) =>
    item(FAMILY, `bk.ladder.${c.id}`, c.tier, 4, CHECKS, c.cause, c.title, (ctx) =>
      c.run(ctx, `bk.ladder.${c.id}`),
    ),
  );
}
