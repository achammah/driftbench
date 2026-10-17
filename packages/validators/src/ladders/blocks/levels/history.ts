import {
  type AgentLog,
  between,
  canonical,
  code,
  list,
  load,
  loadIssues,
  observed,
  pick,
  type RawSpec,
  type Rng,
  rngFor,
  run,
  type Seen,
  SHOP,
  scriptedAdapter,
  statusOf,
} from '../harness';
import { token } from '../kinds';
import { need } from '../product';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';

/**
 * Level 2: tool history in the Given as real records (docs/concepts/given-when-then.md, "Tool history: records,
 * not prose"). A prefix carries tool calls with their output: they must reach the agent as records, call by
 * call, never flattened into prose. `origin` enters the Given hash and the spec hash only when present, and
 * needs a prefix on its block. `spec lint` warns with PREFIX_PROSE_HISTORY exactly when an assistant message
 * states a ledger fact that no recorded call of the prefix holds and the user never said. A forced tool result
 * of `world.tools` holds from its block on and merges by tool name.
 */

const RUNNER = 'packages/core/src/runner/run.ts';
const GIVEN = 'packages/core/src/runner/given.ts';
const SEMANTICS = 'packages/core/src/spec/semantics.ts';
const LINT = 'packages/core/src/spec/lint.ts';
const ADAPTER = 'packages/adapters/src/function/index.ts';

type RecordedCall = {
  id: string;
  label: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
};
type PrefixMessage = { role: 'user' | 'assistant'; content: string; tool_calls?: RecordedCall[] };

/** A shape of tool history: how many assistant messages hold how many calls, and whether one call errored. */
type Shape = { id: string; tier: number; messages: number[]; error: boolean };

const SHAPES: Shape[] = [
  { id: 'one-call', tier: 1, messages: [1], error: false },
  { id: 'two-calls-one-message', tier: 2, messages: [2], error: false },
  { id: 'calls-across-messages', tier: 3, messages: [1, 2], error: false },
  { id: 'error-call', tier: 3, messages: [1, 1], error: true },
];

/** A recorded history: user and assistant turns, the assistant ones carrying calls with seeded outputs. */
function history(
  rng: Rng,
  seed: number,
  tag: string,
  shape: Shape,
): { prefix: PrefixMessage[]; ref: string } {
  const customer = pick(rng, SHOP.customers);
  const prefix: PrefixMessage[] = [];
  let ref = '';
  let callNumber = 0;
  shape.messages.forEach((calls, messageIndex) => {
    prefix.push({ role: 'user', content: `${customer} asks about rental ${messageIndex + 1}.` });
    const toolCalls: RecordedCall[] = [];
    for (let index = 0; index < calls; index += 1) {
      const id = `rec-${callNumber}`;
      const label = pick(rng, ['customer.find', 'bikes.lookup', 'booking.create']);
      const input = { name: customer, slot: between(rng, 1, 40) };
      const isError = shape.error && messageIndex === 0 && index === 0;
      if (isError) toolCalls.push({ id, label, input, error: 'timeout' });
      else {
        ref = code(seed, `${tag}#ref`, callNumber);
        toolCalls.push({ id, label, input, output: { ref, slot: input.slot } });
      }
      callNumber += 1;
    }
    prefix.push({ role: 'assistant', content: 'Done.', tool_calls: toolCalls });
  });
  return { prefix, ref };
}

/** The calls of a history as the agent received them, without the ids an adapter may rewrite. */
function callsOf(messages: readonly Seen[]): string[] {
  return messages.flatMap((message) =>
    (message.tool_calls ?? []).map((call) =>
      canonical([message.role, call.label, call.input ?? null, call.output ?? null, call.error ?? null]),
    ),
  );
}

function recordItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const shape of SHAPES) {
    for (const position of ['first', 'middle', 'last'] as const) {
      for (const mode of ['F', 'T'] as const) {
        const id = `history/records/${shape.id}/${position}/${mode}`;
        items.push({
          id,
          family: 'history-records',
          tier: Math.min(5, shape.tier + (position === 'middle' ? 1 : 0) + (mode === 'T' ? 1 : 0)) as Tier,
          level: 1,
          component: mode === 'T' ? RUNNER : ADAPTER,
          title: `a prefix whose history holds ${shape.id.replace(/-/g, ' ')}, on the ${position} block in mode ${mode}, reaches the agent call by call with its outputs, and an agent that reads the record does not call again`,
          cause:
            mode === 'T'
              ? 'The runner hands a written prefix to the agent with its tool calls and outputs, in mode T.'
              : 'The function adapter hands the prefix to the agent with its tool calls and outputs.',
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const n = between(rng, 3, 5);
            const at = position === 'first' ? 0 : position === 'last' ? n - 1 : between(rng, 1, n - 2);
            const { prefix, ref } = history(rng, seed, id, shape);
            const texts = Array.from(
              { length: n },
              (_, index) => `[${token(seed, id)}:${index}] What is my booking reference?`,
            );
            const blocks = texts.map((text, index) => ({
              id: `b${index}`,
              user: text,
              ...(index === at ? { given: { origin: 'recorded', prefix } } : {}),
              expect:
                index === at
                  ? { must: [ref], tools: [{ label: 'customer.find', count: 0 }] }
                  : { must: ['reference'] },
            }));
            const raw: RawSpec = { id: `blocks-history-${seed}-${n}`, channel: 'chat', blocks };
            const log: AgentLog = { turns: [] };
            const adapter = scriptedAdapter(
              product,
              (turn) => {
                // A rule follower: the reference comes from the last recorded output, else it calls the tool.
                const outputs = turn.messages.flatMap((message) =>
                  (message.tool_calls ?? []).flatMap((call) =>
                    call.output && typeof call.output === 'object' && 'ref' in call.output
                      ? [String((call.output as { ref: unknown }).ref)]
                      : [],
                  ),
                );
                const known = outputs.at(-1);
                return known
                  ? observed(`Your booking reference is ${known}.`)
                  : observed('Let me find your reference.', [
                      { label: 'customer.find', input: {}, output: { ref: 'unknown' } },
                    ]);
              },
              { log },
            );
            const record = await run(product, raw, adapter, { mode });
            const turn = log.turns.find((each) => each.user.includes(texts[at] as string));
            if (!turn) return fail(`the agent never received block ${at}`);
            const want = prefix.flatMap((message) =>
              (message.tool_calls ?? []).map((call) =>
                canonical([
                  message.role,
                  call.label,
                  call.input ?? null,
                  call.output ?? null,
                  call.error ?? null,
                ]),
              ),
            );
            const got = callsOf(turn.messages).slice(-want.length);
            if (got.join('\n') !== want.join('\n'))
              return fail(
                `the agent received the calls ${list(got, 4)}; the prefix records ${list(want, 4)}`,
              );
            const block = record.blocks[at];
            if (!block) return fail(`the run holds no block ${at}`);
            return expectAll([
              [statusOf(product, block) === 'pass', `block ${at} reads ${statusOf(product, block)}`],
            ]);
          },
        });
      }
    }
  }
  return items;
}

const ORIGINS = ['absent', 'authored', 'recorded', 'canonical'] as const;
type Origin = (typeof ORIGINS)[number];

/** A spec of n blocks whose block `at` writes a prefix with the origin given, and a later block another prefix. */
function originSpec(
  seed: number,
  tag: string,
  n: number,
  at: number,
  origin: Origin,
  reset: number | undefined,
) {
  const rng = rngFor(seed, tag);
  const { prefix } = history(rng, seed, tag, SHAPES[0] as Shape);
  const texts = Array.from(
    { length: n },
    (_, index) => `[${token(seed, tag)}:${index}] Is the ${pick(rng, SHOP.bikes)} free?`,
  );
  const raw: RawSpec = {
    id: `blocks-origin-${seed}`,
    channel: 'chat',
    blocks: texts.map((text, index) => ({
      id: `b${index}`,
      user: text,
      ...(index === at ? { given: { ...(origin === 'absent' ? {} : { origin }), prefix } } : {}),
      ...(index === reset ? { given: { prefix: [{ role: 'user', content: 'Hello again.' }] } } : {}),
      expect: { must: ['free'] },
    })),
  };
  return { raw, texts };
}

function originItems(): BankItem[] {
  const items: BankItem[] = [];
  const pairs: [Origin, Origin][] = [];
  for (const [i, a] of ORIGINS.entries()) for (const b of ORIGINS.slice(i + 1)) pairs.push([a, b]);
  for (const [a, b] of pairs) {
    for (const position of ['first', 'middle', 'last'] as const) {
      const id = `history/origin/${a}-vs-${b}/${position}`;
      items.push({
        id,
        family: 'history-origin',
        tier: (a === 'absent' ? 2 : 3) as Tier,
        level: 1,
        component: GIVEN,
        title: `two specs that differ only in the origin of one prefix (${a} and ${b}, ${position} block) have different spec hashes and different Given hashes from that block until the next prefix, and equal ones before it`,
        cause: 'The origin, when present, enters the spec hash and the Given hash of every block it covers.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const n = between(rng, 4, 6);
          const at = position === 'first' ? 0 : position === 'last' ? n - 1 : between(rng, 1, n - 3);
          const reset = at + 2 < n ? at + 2 : undefined;
          const echo = scriptedAdapter(product, () => observed('Yes, it is free.'));
          const left = originSpec(seed, id, n, at, a, reset);
          const right = originSpec(seed, id, n, at, b, reset);
          const runA = await run(product, left.raw, echo);
          const runB = await run(product, right.raw, echo);
          if (runA.specHash === runB.specHash)
            return fail(`origins ${a} and ${b} give the same spec hash ${runA.specHash.slice(0, 12)}`);
          for (let index = 0; index < n; index += 1) {
            const covered = index >= at && (reset === undefined || index < reset);
            const same = runA.blocks[index]?.givenHash === runB.blocks[index]?.givenHash;
            if (covered && same)
              return fail(`block ${index} has the same Given hash under origins ${a} and ${b}`);
            if (!covered && !same)
              return fail(
                `block ${index}, outside the origin's prefix, has different Given hashes under ${a} and ${b}`,
              );
          }
          return PASS;
        },
      });
    }
  }
  for (const position of ['first', 'middle', 'last'] as const) {
    for (const origin of ['authored', 'recorded', 'canonical'] as const) {
      const id = `history/origin/without-prefix/${origin}/${position}`;
      items.push({
        id,
        family: 'history-origin',
        tier: 1,
        level: 1,
        component: SEMANTICS,
        title: `a block that states origin ${origin} without a prefix (${position} block) is refused with GIVEN_ORIGIN_WITHOUT_PREFIX, and the same spec with a prefix loads`,
        cause: 'The loader refuses an origin on a block that writes no prefix (GIVEN_ORIGIN_WITHOUT_PREFIX).',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const n = between(rng, 2, 5);
          const at =
            position === 'first' ? 0 : position === 'last' ? n - 1 : between(rng, 1, Math.max(1, n - 2));
          const blocks = Array.from({ length: n }, (_, index) => ({
            user: `[${token(seed, id)}:${index}] Hello`,
            ...(index === at ? { given: { origin } } : {}),
            expect: { must: ['Hello'] },
          }));
          const refused = loadIssues(product, { id: `blocks-origin-${seed}`, blocks });
          const fixed = structuredClone(blocks);
          (fixed[at] as { given: Record<string, unknown> }).given.prefix = [{ role: 'user', content: 'Hi' }];
          const accepted = loadIssues(product, { id: `blocks-origin-${seed}`, blocks: fixed });
          return expectAll([
            [
              !refused.ok && refused.codes.includes('GIVEN_ORIGIN_WITHOUT_PREFIX'),
              `the loader answered ${refused.ok ? 'ok' : list(refused.codes)}`,
            ],
            [accepted.ok, `the spec with a prefix is refused: ${list(accepted.codes)}`],
          ]);
        },
      });
    }
  }
  return items;
}

type LintCase = {
  id: string;
  tier: Tier;
  /** Builds the prefix of the linted block from the fact's text; `warn` is the message index that warns, if any. */
  build(fact: string): { prefix: PrefixMessage[]; warn: number | undefined };
};

const said = (fact: string): PrefixMessage => ({ role: 'assistant', content: `Your reference is ${fact}.` });

const LINT_CASES: LintCase[] = [
  {
    id: 'prose-only',
    tier: 1,
    build: (fact) => ({ prefix: [{ role: 'user', content: 'Hi' }, said(fact)], warn: 1 }),
  },
  {
    id: 'recorded-before',
    tier: 2,
    build: (fact) => ({
      prefix: [
        { role: 'user', content: 'Hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', label: 'customer.find', input: {}, output: { ref: fact } }],
        },
        said(fact),
      ],
      warn: undefined,
    }),
  },
  {
    id: 'recorded-same-message',
    tier: 3,
    build: (fact) => ({
      prefix: [
        { role: 'user', content: 'Hi' },
        {
          role: 'assistant',
          content: `Your reference is ${fact}.`,
          tool_calls: [{ id: 'c1', label: 'customer.find', input: {}, output: { ref: fact } }],
        },
      ],
      warn: undefined,
    }),
  },
  {
    id: 'user-said-before',
    tier: 2,
    build: (fact) => ({
      prefix: [{ role: 'user', content: `My reference is ${fact}.` }, said(fact)],
      warn: undefined,
    }),
  },
  {
    id: 'user-said-after',
    tier: 4,
    build: (fact) => ({
      prefix: [{ role: 'user', content: 'Hi' }, said(fact), { role: 'user', content: `Yes, ${fact}.` }],
      warn: 1,
    }),
  },
  {
    id: 'recorded-after',
    tier: 4,
    build: (fact) => ({
      prefix: [
        { role: 'user', content: 'Hi' },
        said(fact),
        { role: 'user', content: 'Thanks' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', label: 'customer.find', input: {}, output: { ref: fact } }],
        },
      ],
      warn: 1,
    }),
  },
  {
    id: 'inside-a-longer-word',
    tier: 5,
    build: (fact) => ({
      prefix: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: `Code X${fact}Y is unrelated.` },
      ],
      warn: undefined,
    }),
  },
  {
    id: 'error-call-holds-nothing',
    tier: 4,
    build: (fact) => ({
      prefix: [
        { role: 'user', content: 'Hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', label: 'customer.find', input: {}, error: 'timeout' }],
        },
        said(fact),
      ],
      warn: 2,
    }),
  },
];

function lintItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const lintCase of LINT_CASES) {
    for (const source of ['given-ledger', 'earlier-ledger-add', 'number-fact'] as const) {
      const id = `history/lint/${lintCase.id}/${source}`;
      items.push({
        id,
        family: 'history-lint',
        tier: lintCase.tier,
        level: 1,
        component: LINT,
        title: `spec lint on a prefix where ${lintCase.id.replace(/-/g, ' ')} (the fact from ${source.replace(/-/g, ' ')}) ${lintCase.build('x').warn === undefined ? 'gives no PREFIX_PROSE_HISTORY' : 'warns PREFIX_PROSE_HISTORY at that message'}`,
        cause:
          lintCase.build('x').warn === undefined
            ? `spec lint leaves out a fact that a recorded call holds, the user said, or no whole word states (${lintCase.id}).`
            : 'spec lint warns PREFIX_PROSE_HISTORY on an assistant message stating a ledger fact no recorded call holds and the user never said.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const fact = source === 'number-fact' ? String(between(rng, 100000, 999999)) : code(seed, id, 0);
          const { prefix, warn } = lintCase.build(fact);
          const n = between(rng, 2, 4);
          const at = n - 1;
          const blocks = Array.from({ length: n }, (_, index) => ({
            user: `[${token(seed, id)}:${index}] Which bike is booked?`,
            ...(index === at ? { given: { prefix } } : {}),
            expect: {
              ...(source === 'earlier-ledger-add' && index === 0
                ? { ledger_add: { booking_ref: fact } }
                : {}),
              tools: [{ label: 'customer.find', count: 0 }],
            },
          }));
          const raw: RawSpec = {
            id: `blocks-lint-${seed}`,
            channel: 'chat',
            ...(source === 'earlier-ledger-add' ? {} : { given: { ledger: { booking_ref: fact } } }),
            blocks,
          };
          const spec = load(product, raw);
          const lintSpec = need<(spec: unknown) => { code: string; path: string }[]>(
            product.core,
            'core',
            'lintSpec',
          );
          const found = lintSpec(spec).filter((issue) => issue.code === 'PREFIX_PROSE_HISTORY');
          const paths = found.map((issue) => issue.path);
          if (warn === undefined)
            return found.length === 0 ? PASS : fail(`lint warned PREFIX_PROSE_HISTORY at ${list(paths)}`);
          const want = `blocks.${at}.given.prefix.${warn}`;
          return paths.length === 1 && paths[0] === want
            ? PASS
            : fail(
                `lint warned at ${paths.length === 0 ? 'nothing' : list(paths)}, expected exactly ${want}`,
              );
        },
      });
    }
  }
  return items;
}

/** World records: a forced tool result holds from its block on, merges by tool name, and a later one replaces it. */
function worldItems(): BankItem[] {
  const items: BankItem[] = [];
  const plans = [
    { id: 'set-first', tier: 1, sets: [[0, 'bikes.lookup']] },
    { id: 'set-middle', tier: 2, sets: [[2, 'bikes.lookup']] },
    {
      id: 'two-tools',
      tier: 2,
      sets: [
        [1, 'bikes.lookup'],
        [3, 'payment.charge'],
      ],
    },
    {
      id: 'override',
      tier: 3,
      sets: [
        [0, 'bikes.lookup'],
        [2, 'bikes.lookup'],
      ],
    },
    {
      id: 'override-and-add',
      tier: 4,
      sets: [
        [1, 'bikes.lookup'],
        [2, 'payment.charge'],
        [4, 'bikes.lookup'],
      ],
    },
  ] as const;
  for (const plan of plans) {
    for (const level of ['spec', 'block'] as const) {
      for (const kind of ['result', 'error'] as const) {
        {
          const id = `history/world/${plan.id}/${level}/${kind}`;
          items.push({
            id,
            family: 'history-world',
            tier: Math.min(5, plan.tier + (kind === 'error' ? 1 : 0)) as Tier,
            level: 1,
            component: GIVEN,
            title: `forced tool ${kind}s set at ${plan.id.replace(/-/g, ' ')} (${level} level first) reach the agent from their block on, merged by tool name, the later one replacing the earlier`,
            cause: 'The running Given merges world.tools by tool name from the block that sets them on.',
            check: async ({ seed, product }) => {
              const n = 6;
              const tokens = plan.sets.map((_, index) => code(seed, id, index));
              const value = (index: number) =>
                kind === 'error' ? `unavailable ${tokens[index]}` : { token: tokens[index] };
              const forced = (index: number) => ({
                [plan.sets[index]?.[1] as string]:
                  kind === 'error' ? { error: value(index) } : { result: value(index) },
              });
              // At the spec level the first forced result moves to the spec's Given: it holds from block 0.
              const from = (setIndex: number) =>
                level === 'spec' && setIndex === 0 ? 0 : (plan.sets[setIndex]?.[0] as number);
              const blocks = Array.from({ length: n }, (_, index) => {
                const setHere = plan.sets.findIndex(
                  ([at], setIndex) => at === index && !(level === 'spec' && setIndex === 0),
                );
                return {
                  user: `[${token(seed, id)}:${index}] Check the fleet.`,
                  ...(setHere >= 0 ? { given: { world: { tools: forced(setHere) } } } : {}),
                  expect: { must: ['fleet'] },
                };
              });
              const specLevel = level === 'spec' ? { given: { world: { tools: forced(0) } } } : {};
              const raw: RawSpec = { id: `blocks-world-${seed}`, channel: 'chat', ...specLevel, blocks };
              const log: AgentLog = { turns: [] };
              await run(
                product,
                raw,
                scriptedAdapter(product, () => observed('The fleet is checked.'), { log }),
                {
                  mode: 'F',
                },
              );
              for (let index = 0; index < n; index += 1) {
                const want: Record<string, unknown> = {};
                plan.sets.forEach(([, tool], setIndex) => {
                  if (from(setIndex) <= index) want[tool] = forced(setIndex)[tool];
                });
                const turn = log.turns.find((each) => each.user.includes(`[${token(seed, id)}:${index}]`));
                if (!turn) return fail(`the agent never received block ${index}`);
                const got = (turn.world.tools ?? {}) as Record<string, unknown>;
                const wantKeys = Object.keys(want).sort();
                const gotKeys = Object.keys(got).sort();
                if (wantKeys.join(',') !== gotKeys.join(','))
                  return fail(`block ${index} saw forced tools ${list(gotKeys)}, expected ${list(wantKeys)}`);
                for (const key of wantKeys) {
                  const a = got[key] as Record<string, unknown>;
                  const b = want[key] as Record<string, unknown>;
                  if (canonical(a[kind]) !== canonical(b[kind]))
                    return fail(
                      `block ${index} saw ${key} ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`,
                    );
                }
              }
              return PASS;
            },
          });
        }
      }
    }
  }
  return items;
}

/** Level 2 of the blocks bank. */
export function historyItems(): BankItem[] {
  return [...recordItems(), ...originItems(), ...lintItems(), ...worldItems()];
}
