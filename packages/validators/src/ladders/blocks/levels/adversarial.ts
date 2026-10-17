import {
  type AgentLog,
  type BlockRecord,
  between,
  type Call,
  load,
  loadIssues,
  observed,
  type RawSpec,
  type Rng,
  type RunRecord,
  rngFor,
  run,
  type Seen,
  scriptedAdapter,
  shuffled,
  statusOf,
  type Turn,
} from '../harness';
import { need } from '../product';
import { type BankItem, expectAll, fail, type ItemContext, type ItemResult, PASS, type Tier } from '../types';

/**
 * F6, blind adversarial shortcuts. Each item names one shortcut a product could take instead of the documented
 * behaviour and is built to fail on it: a check keyed on a field name, on an order, on a count, on the first or
 * last block, on the word of an error. Every item is a twin: the same shape twice, once where the documented
 * behaviour passes and once where it fails, so a product that always passes and one that always fails both lose.
 *
 * The items were written from the documentation alone (docs/concepts, docs/reference, docs/running.md and the
 * help topics); no product source was read. Every name the product sees (spec id, block id, tool, field, stage,
 * file, text) is a seeded word of letters, so no name or path says what the item expects. A scripted agent throws
 * on a turn it was not scripted for, and every object it returns has its keys in a seeded random order.
 */

const CORE = 'packages/core';
const CHECKS = 'packages/checks';
const CLI_RADIUS = 'packages/cli (radius)';
const CLI_OBJECTS = 'packages/cli (object)';
const RADIUS = 'packages/core (radius)';

// A seeded word of letters only: no digit can read as a phone number or an identifier, no name tells the truth.
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
function word(seed: number, tag: string, length = 7): string {
  const rng = rngFor(seed, `adv:${tag}`);
  let out = '';
  for (let index = 0; index < length; index += 1) out += LETTERS[Math.floor(rng() * LETTERS.length)];
  return out;
}

/** The same value with the keys of every object in a seeded random order. */
function scramble<T>(rng: Rng, value: T): T {
  if (Array.isArray(value)) return value.map((entry) => scramble(rng, entry)) as T;
  if (value !== null && typeof value === 'object') {
    const entries = shuffled(rng, Object.entries(value as Record<string, unknown>));
    return Object.fromEntries(entries.map(([key, entry]) => [key, scramble(rng, entry)])) as T;
  }
  return value;
}

type Plan = { text: string; calls?: Call[]; stage?: string };
type BlockDef = {
  expect?: Record<string, unknown>;
  given?: Record<string, unknown>;
  plan: Plan;
  /** Send the block as a burst of two messages. */
  burst?: boolean;
  /** Extra keys of the block itself (`parent`, for instance). */
  extra?: Record<string, unknown>;
  /** The block has no id. */
  anonymous?: boolean;
};
type Scenario = { raw: RawSpec; users: string[]; ids: string[]; plans: Map<string, Plan> };

function scenario(
  seed: number,
  tag: string,
  defs: readonly BlockDef[],
  spec: Record<string, unknown> = {},
): Scenario {
  const users: string[] = [];
  const ids: string[] = [];
  const plans = new Map<string, Plan>();
  const blocks = defs.map((def, index) => {
    const user = word(seed, `${tag}:user:${index}`, 9);
    const second = word(seed, `${tag}:user2:${index}`, 9);
    const id = word(seed, `${tag}:block:${index}`, 6);
    users.push(user);
    ids.push(id);
    plans.set(user, def.plan);
    return {
      ...(def.anonymous ? {} : { id }),
      ...(def.burst ? { burst: [user, second] } : { user }),
      ...(def.given ? { given: def.given } : {}),
      ...(def.expect ? { expect: def.expect } : {}),
      ...(def.extra ?? {}),
    };
  });
  const raw: RawSpec = { id: word(seed, `${tag}:spec`, 8), ...spec, blocks };
  return { raw, users, ids, plans };
}

function behaviour(sc: Scenario, rng: Rng) {
  return (turn: Turn): Record<string, unknown> => {
    for (const [key, plan] of sc.plans) {
      if (turn.user.includes(key)) {
        const calls = plan.calls?.map((call) => scramble(rng, call));
        return observed(plan.text, calls ?? [], plan.stage);
      }
    }
    throw new Error('the scripted agent was sent a turn it has no reply for');
  };
}

type Played = { rec: RunRecord; log: AgentLog };

async function play(
  ctx: ItemContext,
  sc: Scenario,
  options: { mode?: 'F' | 'T'; capabilities?: { seedPrefix?: boolean; toolStubs?: boolean } } = {},
): Promise<Played> {
  const log: AgentLog = { turns: [] };
  const rng = rngFor(ctx.seed, `adv:${sc.raw.id}:agent`);
  const adapter = scriptedAdapter(ctx.product, behaviour(sc, rng), {
    log,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  });
  const rec = await run(ctx.product, writtenChildrenFirst(sc.raw), adapter, { mode: options.mode ?? 'F' });
  return { rec, log };
}

/**
 * A spec whose parent links all point to earlier blocks is written children first: the runner orders the forest
 * whatever the written order (block-contracts.md, The forest), so a runner that only looks back cannot pass.
 */
function writtenChildrenFirst(raw: RawSpec): RawSpec {
  const ids = raw.blocks.map((block) => (block as { id?: string }).id);
  const parents = raw.blocks.map((block) => (block as { parent?: string }).parent);
  if (parents.every((parent) => parent === undefined)) return raw;
  const backward = parents.every((parent, index) => parent === undefined || ids.indexOf(parent) < index);
  return backward ? { ...raw, blocks: [...raw.blocks].reverse() } : raw;
}

const verdictOf = (block: BlockRecord | undefined, id: string) => block?.verdicts.find((v) => v.id === id);
const outcomeOfId = (block: BlockRecord | undefined, id: string) => verdictOf(block, id)?.outcome ?? 'absent';
const call = (label: string, input: Record<string, unknown> = {}, extra: Partial<Call> = {}): Call => ({
  label,
  input,
  ...extra,
});
const times = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, i) => make(i));

/** A spec block read loosely, to plant a fault anywhere in it. */
type Loose = {
  [key: string]: unknown;
  expect: { [key: string]: unknown; tools: { [key: string]: unknown }[] };
  given: { [key: string]: unknown };
};

type Check = (ctx: ItemContext) => Promise<ItemResult>;
let registry: BankItem[] = [];
function item(
  id: string,
  level: number,
  tier: Tier,
  component: string,
  title: string,
  cause: string,
  check: Check,
): void {
  registry.push({ id: `adv.${id}`, family: 'adversarial', tier, level, component, title, cause, check });
}

/** What the documentation says, what the product answered. */
function say(doc: string, should: string, got: string): string {
  return `${should} (${doc}); the product answered: ${got}`;
}

/** Runs one block with the given Then and the agent's plan and returns the block record. */
async function oneBlock(
  ctx: ItemContext,
  tag: string,
  expect: Record<string, unknown>,
  plan: Plan,
  extra: { spec?: Record<string, unknown>; given?: Record<string, unknown> } = {},
): Promise<{ block: BlockRecord; rec: RunRecord }> {
  const sc = scenario(
    ctx.seed,
    tag,
    [{ expect, plan, ...(extra.given ? { given: extra.given } : {}) }],
    extra.spec,
  );
  const { rec } = await play(ctx, sc);
  return { block: rec.blocks[0] as BlockRecord, rec };
}

/* ------------------------------------------------------------------------------------------------------
 * Level 1: what a block checks (docs/reference/checks.md, docs/concepts/given-when-then.md)
 * ---------------------------------------------------------------------------------------------------- */

const D_TOOLS = 'docs/reference/checks.md "Tools, skills, guards, references and subagents"';

function toolItems(): void {
  item(
    'tools.count-exact',
    1,
    2,
    CHECKS,
    'An exact count on a tool counts the calls: one fewer or one more fails, shortcut: any count, or one call',
    'a tool expectation with a number count passes with exactly that many calls and fails with fewer or more',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:tools.count-exact');
      const n = between(rng, 2, 5);
      const label = word(ctx.seed, 'tools.count-exact:label');
      const rows: [number, boolean][] = [
        [n, true],
        [n + 1, false],
        [n - 1, false],
        [1, false],
      ];
      for (const [calls, passes] of rows) {
        const { block } = await oneBlock(
          ctx,
          `tools.count-exact:${calls}`,
          { tools: [{ label, count: n }] },
          { text: word(ctx.seed, 'reply'), calls: times(calls, () => call(label)) },
        );
        if (block.pass !== passes)
          return fail(
            say(
              D_TOOLS,
              `count ${n} with ${calls} call(s) ${passes ? 'passes' : 'fails'}`,
              `block.pass ${block.pass}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'tools.count-range',
    1,
    2,
    CHECKS,
    'A count range {min, max} holds at both bounds and fails just outside them, shortcut: only the min or only the max is read',
    'a tool count of the form { min, max } passes from min to max calls inclusive and fails below min and above max',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:tools.count-range');
      const min = between(rng, 1, 3);
      const max = min + between(rng, 1, 3);
      const label = word(ctx.seed, 'tools.count-range:label');
      const rows: [number, boolean][] = [
        [min, true],
        [max, true],
        [min - 1, false],
        [max + 1, false],
      ];
      for (const [calls, passes] of rows) {
        const { block } = await oneBlock(
          ctx,
          `tools.count-range:${calls}`,
          { tools: [{ label, count: { min, max } }] },
          { text: word(ctx.seed, 'reply'), calls: times(calls, () => call(label)) },
        );
        if (block.pass !== passes)
          return fail(
            say(
              D_TOOLS,
              `count {min:${min},max:${max}} with ${calls} call(s) ${passes ? 'passes' : 'fails'}`,
              `block.pass ${block.pass}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'tools.count-open-ended',
    1,
    3,
    CHECKS,
    'A count with only a min or only a max is open on the other side, shortcut: a missing bound reads as zero',
    'a tool count { min } has no upper bound and a count { max } has no lower bound',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:tools.count-open-ended');
      const bound = between(rng, 2, 3);
      const label = word(ctx.seed, 'tools.count-open-ended:label');
      const rows: [Record<string, number>, number, boolean][] = [
        [{ min: bound }, bound + 3, true],
        [{ min: bound }, bound - 1, false],
        [{ max: bound }, 0, true],
        [{ max: bound }, bound, true],
        [{ max: bound }, bound + 1, false],
      ];
      for (const [count, calls, passes] of rows) {
        const { block } = await oneBlock(
          ctx,
          `tools.count-open-ended:${JSON.stringify(count)}:${calls}`,
          { tools: [{ label, count }] },
          { text: word(ctx.seed, 'reply'), calls: times(calls, () => call(label)) },
        );
        if (block.pass !== passes)
          return fail(
            say(
              D_TOOLS,
              `count ${JSON.stringify(count)} with ${calls} call(s) ${passes ? 'passes' : 'fails'}`,
              `block.pass ${block.pass}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'tools.count-absent-at-least-once',
    1,
    2,
    CHECKS,
    'A tool listed with no count must run at least once, shortcut: no count means any number, zero included',
    'a tool expectation with no count passes with one call or more and fails with none',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:tools.count-absent');
      const label = word(ctx.seed, 'tools.count-absent:label');
      for (const [calls, passes] of [
        [0, false],
        [1, true],
        [between(rng, 2, 4), true],
      ] as const) {
        const { block } = await oneBlock(
          ctx,
          `tools.count-absent:${calls}`,
          { tools: [{ label }] },
          { text: word(ctx.seed, 'reply'), calls: times(calls, () => call(label)) },
        );
        if (block.pass !== passes)
          return fail(
            say(
              D_TOOLS,
              `no count with ${calls} call(s) ${passes ? 'passes' : 'fails'}`,
              `block.pass ${block.pass}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'tools.count-zero-forbids',
    1,
    3,
    CHECKS,
    'count 0 forbids the call and the fact is reported once, by the forbidden check, shortcut: the tools check also reports it',
    'a tool expected 0 times fails the block when called, with a forbidden.<label> verdict and no tools.<label>.count verdict',
    async (ctx) => {
      const label = word(ctx.seed, 'tools.count-zero:label');
      const none = await oneBlock(
        ctx,
        'tools.count-zero:0',
        { tools: [{ label, count: 0 }] },
        { text: word(ctx.seed, 'reply') },
      );
      if (!none.block.pass)
        return fail(
          say(
            D_TOOLS,
            'a tool expected 0 times and not called passes',
            `block.pass false; verdicts ${none.block.verdicts.map((v) => `${v.id}:${v.outcome}`).join(', ')}`,
          ),
        );
      const called = await oneBlock(
        ctx,
        'tools.count-zero:1',
        { tools: [{ label, count: 0 }] },
        { text: word(ctx.seed, 'reply'), calls: [call(label)] },
      );
      return expectAll([
        [
          !called.block.pass,
          say(D_TOOLS, 'a tool expected 0 times and called once fails the block', 'block.pass true'),
        ],
        [
          outcomeOfId(called.block, `forbidden.${label}`) === 'fail',
          say(
            D_TOOLS,
            `the verdict forbidden.${label} fails`,
            `forbidden.${label} is ${outcomeOfId(called.block, `forbidden.${label}`)}`,
          ),
        ],
        [
          verdictOf(called.block, `tools.${label}.count`) === undefined,
          say(
            D_TOOLS,
            `"the forbidden check reports that fact, not tools"`,
            `a verdict tools.${label}.count is present`,
          ),
        ],
      ]);
    },
  );

  // Input assertions, one item per form of the assertion vocabulary (docs/reference/spec.md "Assertion").
  const D_ASSERT = 'docs/reference/spec.md "Assertion"';
  type Form = {
    id: string;
    cause: string;
    make(
      word: (tag: string, length?: number) => string,
      rng: Rng,
    ): { assertion: unknown; ok: unknown[]; bad: unknown[]; absentIsOk?: boolean };
  };
  const forms: Form[] = [
    {
      id: 'bare',
      cause: 'a bare value in a tool input assertion means exact equality',
      make: (w) => {
        const value = w('bare', 8);
        return { assertion: value, ok: [value], bad: [`${value}x`, `x${value}`, value.toUpperCase()] };
      },
    },
    {
      id: 'exact',
      cause: 'an exact assertion on a tool input equals the whole JSON value whatever the order of its keys',
      make: (w, rng) => {
        const a = w('ea', 5);
        const b = w('eb', 5);
        const value = { [a]: w('ev1', 6), [b]: [w('ev2', 4), w('ev3', 4)] };
        return {
          assertion: { exact: value },
          ok: [scramble(rng, value)],
          bad: [{ ...value, [a]: `${value[a]}x` }, { ...value, extra: true }, { [a]: value[a] }],
        };
      },
    },
    {
      id: 'regex',
      cause: 'a regex assertion on a tool input is a regular expression over the whole text, not a literal',
      make: (w) => {
        const stem = w('rx', 5);
        return {
          assertion: { regex: `^${stem}[0-9]{2}$` },
          ok: [`${stem}42`, `${stem}07`],
          bad: [`${stem}4`, `${stem}421`, `x${stem}42`, stem],
        };
      },
    },
    {
      id: 'contains',
      cause: 'a contains assertion on a tool input holds when the text appears anywhere in the value',
      make: (w) => {
        const part = w('ct', 6);
        return {
          assertion: { contains: part },
          ok: [`${w('l', 3)}${part}${w('r', 3)}`, part],
          bad: [w('other', 9), part.slice(0, -1)],
        };
      },
    },
    {
      id: 'one-of',
      cause: 'a one_of assertion on a tool input holds for any listed value and for no other',
      make: (w) => {
        const options = [w('o1', 5), w('o2', 5), w('o3', 5)];
        return { assertion: { one_of: options }, ok: options, bad: [w('o4', 5), `${options[0]}x`] };
      },
    },
    {
      id: 'nonempty',
      cause: 'a nonempty assertion on a tool input fails an empty string',
      make: (w) => ({ assertion: { nonempty: true }, ok: [w('ne', 4)], bad: ['', null] }),
    },
    {
      id: 'absent',
      cause: 'an absent assertion on a tool input holds only when the argument is not there',
      make: (w) => ({
        assertion: { absent: true },
        ok: [Symbol.for('omit')],
        bad: [w('ab', 4), ''],
        absentIsOk: true,
      }),
    },
    {
      id: 'subset',
      cause: 'a subset assertion on a tool input holds when at least those keys carry those values',
      make: (w, rng) => {
        const key = w('sk', 5);
        const val = w('sv', 5);
        return {
          assertion: { subset: { [key]: val } },
          ok: [scramble(rng, { [key]: val, [w('x1', 4)]: 1 }), { [key]: val }],
          bad: [{ [key]: `${val}x` }, { [w('x2', 4)]: val }, {}],
        };
      },
    },
  ];
  for (const form of forms) {
    item(
      `tools.input-${form.id}`,
      1,
      3,
      CHECKS,
      `A ${form.id} assertion on a tool argument passes its matching values and fails the others, shortcut: the field name or the form decides`,
      form.cause,
      async (ctx) => {
        const rng = rngFor(ctx.seed, `adv:tools.input-${form.id}`);
        const label = word(ctx.seed, `tools.input-${form.id}:label`);
        const field = word(ctx.seed, `tools.input-${form.id}:field`, between(rng, 4, 10));
        const spec = form.make(
          (tag, length) => word(ctx.seed, `tools.input-${form.id}:${tag}`, length ?? 6),
          rng,
        );
        const cases: [unknown, boolean][] = [
          ...spec.ok.map((v) => [v, true] as [unknown, boolean]),
          ...spec.bad.map((v) => [v, false] as [unknown, boolean]),
        ];
        for (const [value, passes] of cases) {
          const input: Record<string, unknown> =
            spec.absentIsOk && value === Symbol.for('omit') ? {} : { [field]: value };
          const { block } = await oneBlock(
            ctx,
            `tools.input-${form.id}:${JSON.stringify(value) ?? 'omit'}`,
            { tools: [{ label, count: 1, input: { [field]: spec.assertion } }] },
            { text: word(ctx.seed, 'reply'), calls: [call(label, input)] },
          );
          if (block.pass !== passes)
            return fail(
              say(
                D_ASSERT,
                `${JSON.stringify(spec.assertion)} on ${JSON.stringify(input)} ${passes ? 'passes' : 'fails'}`,
                `block.pass ${block.pass}`,
              ),
            );
        }
        return PASS;
      },
    );
  }

  for (const place of ['first', 'middle', 'last'] as const) {
    item(
      `tools.input-every-call-${place}`,
      1,
      3,
      CHECKS,
      `Every call of a tool must hold an input assertion: a wrong ${place} call fails, shortcut: only the first or the last call is read`,
      'an input assertion of a tool expectation is checked on every call of that tool in the block',
      async (ctx) => {
        const label = word(ctx.seed, `tools.every-call:${place}:label`);
        const field = word(ctx.seed, `tools.every-call:${place}:field`);
        const right = word(ctx.seed, `tools.every-call:${place}:right`);
        const wrong = word(ctx.seed, `tools.every-call:${place}:wrong`);
        const at = place === 'first' ? 0 : place === 'middle' ? 1 : 2;
        const run3 = async (violating: number | null) =>
          (
            await oneBlock(
              ctx,
              `tools.every-call:${place}:${violating}`,
              { tools: [{ label, count: 3, input: { [field]: right } }] },
              {
                text: word(ctx.seed, 'reply'),
                calls: times(3, (i) => call(label, { [field]: i === violating ? wrong : right })),
              },
            )
          ).block;
        const ok = await run3(null);
        const bad = await run3(at);
        return expectAll([
          [
            ok.pass,
            say(
              D_TOOLS,
              '"every call of the tool must hold each" assertion: three right calls pass',
              'block.pass false',
            ),
          ],
          [
            !bad.pass,
            say(D_TOOLS, `three calls with the ${place} one wrong fail the block`, 'block.pass true'),
          ],
        ]);
      },
    );
  }

  item(
    'tools.input-uncalled-fails',
    1,
    3,
    CHECKS,
    'A tool that was not called fails each of its input assertions even when zero calls are allowed, shortcut: no call means nothing to assert',
    'an input assertion on a tool that was never called fails its verdict',
    async (ctx) => {
      const label = word(ctx.seed, 'tools.input-uncalled:label');
      const field = word(ctx.seed, 'tools.input-uncalled:field');
      const { block } = await oneBlock(
        ctx,
        'tools.input-uncalled',
        { tools: [{ label, count: { min: 0 }, input: { [field]: word(ctx.seed, 'v') } }] },
        { text: word(ctx.seed, 'reply') },
      );
      return expectAll([
        [
          !block.pass,
          say(D_TOOLS, '"a tool that was not called fails each of its input assertions"', 'block.pass true'),
        ],
        [
          outcomeOfId(block, `tools.${label}.input.${field}`) === 'fail',
          say(
            D_TOOLS,
            `the verdict tools.${label}.input.${field} fails`,
            outcomeOfId(block, `tools.${label}.input.${field}`),
          ),
        ],
      ]);
    },
  );

  item(
    'tools.input-closed',
    1,
    3,
    CHECKS,
    'input_closed refuses a call input with a key the assertions do not list, shortcut: the flag is read as present or the extra key is ignored',
    'input_closed: true requires each call input to hold only the top-level keys listed in input, and false or absent leaves other keys allowed',
    async (ctx) => {
      const label = word(ctx.seed, 'tools.closed:label');
      const a = word(ctx.seed, 'tools.closed:a');
      const b = word(ctx.seed, 'tools.closed:b');
      const value = word(ctx.seed, 'tools.closed:v');
      const extra = word(ctx.seed, 'tools.closed:extra');
      const rows: [Record<string, unknown>, boolean | undefined, boolean, string][] = [
        [{ [a]: value, [b]: value }, true, true, 'exactly the listed keys'],
        [{ [a]: value, [b]: value, [extra]: 1 }, true, false, 'an extra key'],
        [{ [a]: value, [b]: value, [extra]: 1 }, undefined, true, 'an extra key without the flag'],
        [{ [a]: value, [b]: value, [extra]: 1 }, false, true, 'an extra key with the flag false'],
      ];
      for (const [input, closed, passes, name] of rows) {
        const { block } = await oneBlock(
          ctx,
          `tools.closed:${name}`,
          {
            tools: [
              {
                label,
                count: 1,
                input: { [a]: value, [b]: value },
                ...(closed === undefined ? {} : { input_closed: closed }),
              },
            ],
          },
          { text: word(ctx.seed, 'reply'), calls: [call(label, input)] },
        );
        if (block.pass !== passes)
          return fail(
            say(
              D_TOOLS,
              `input_closed ${closed ?? 'absent'} with ${name} ${passes ? 'passes' : 'fails'}`,
              `block.pass ${block.pass}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'tools.input-closed-nested-and-empty',
    1,
    4,
    CHECKS,
    'input_closed reads only top-level keys and, with no input listed, allows an empty object only, shortcut: nested keys or the empty case are not read',
    'input_closed leaves nested values to their own assertion, and with no input assertion only an empty object passes',
    async (ctx) => {
      const label = word(ctx.seed, 'tools.closed2:label');
      const a = word(ctx.seed, 'tools.closed2:a');
      const inner = word(ctx.seed, 'tools.closed2:inner');
      const extra = word(ctx.seed, 'tools.closed2:extra');
      const nestedOk = await oneBlock(
        ctx,
        'tools.closed2:nested',
        { tools: [{ label, count: 1, input: { [a]: { subset: { [inner]: 1 } } }, input_closed: true }] },
        { text: word(ctx.seed, 'reply'), calls: [call(label, { [a]: { [inner]: 1, [extra]: 2 } })] },
      );
      const emptyOk = await oneBlock(
        ctx,
        'tools.closed2:empty',
        { tools: [{ label, count: 1, input_closed: true }] },
        { text: word(ctx.seed, 'reply'), calls: [call(label, {})] },
      );
      const emptyBad = await oneBlock(
        ctx,
        'tools.closed2:emptybad',
        { tools: [{ label, count: 1, input_closed: true }] },
        { text: word(ctx.seed, 'reply'), calls: [call(label, { [extra]: 1 })] },
      );
      return expectAll([
        [
          nestedOk.block.pass,
          say(
            D_TOOLS,
            '"nested values keep their normal assertion semantics": an extra nested key passes under a subset',
            'block.pass false',
          ),
        ],
        [
          emptyOk.block.pass,
          say(D_TOOLS, '"with no input, only an empty object is allowed": {} passes', 'block.pass false'),
        ],
        [
          !emptyBad.block.pass,
          say(
            D_TOOLS,
            'a call with a key and no input assertion fails under input_closed',
            'block.pass true',
          ),
        ],
      ]);
    },
  );

  // Order: exact, in_order and any_order are three different rules.
  const orderItem = (mode: 'exact' | 'in_order' | 'any_order', rows: [string, boolean][]): void => {
    item(
      `tools.order-${mode}`,
      1,
      4,
      CHECKS,
      `tool_order ${mode} accepts and refuses the documented call sequences, shortcut: one rule for all three orders, or no order check`,
      `tool_order ${mode} follows its documented rule: ${
        mode === 'exact'
          ? 'the calls are the expected runs in order with none left over'
          : mode === 'in_order'
            ? 'the expected calls appear in order, other calls may sit between'
            : 'the expected calls appear in any order'
      }`,
      async (ctx) => {
        const names = ['a', 'b', 'c', 'x', 'y'].map((tag) => word(ctx.seed, `tools.order:${tag}`, 6));
        const [A, B, C, X, Y] = names as [string, string, string, string, string];
        const letter: Record<string, string> = { a: A, b: B, c: C, x: X, y: Y };
        for (const [sequence, passes] of rows) {
          const { block } = await oneBlock(
            ctx,
            `tools.order-${mode}:${sequence}`,
            {
              tools: [A, B, C].map((label) => ({ label, count: 1 })),
              tool_order: mode,
            },
            { text: word(ctx.seed, 'reply'), calls: [...sequence].map((key) => call(letter[key] as string)) },
          );
          const verdict = outcomeOfId(block, 'tools.order');
          if (verdict !== (passes ? 'pass' : 'fail'))
            return fail(
              say(
                'docs/reference/checks.md "tool_order"',
                `${mode} with the calls ${[...sequence].join(',')} (expected a,b,c) ${passes ? 'passes' : 'fails'}`,
                `tools.order is ${verdict}`,
              ),
            );
        }
        return PASS;
      },
    );
  };
  orderItem('exact', [
    ['abc', true],
    ['axbc', false],
    ['abcx', false],
    ['xabc', false],
    ['ab', false],
    ['bac', false],
  ]);
  orderItem('in_order', [
    ['abc', true],
    ['axbyc', true],
    ['xabcx', true],
    ['bac', false],
    ['ab', false],
    ['cba', false],
  ]);
  orderItem('any_order', [
    ['abc', true],
    ['cba', true],
    ['xcxax b'.replace(' ', ''), true],
    ['ab', false],
    ['xx', false],
  ]);

  item(
    'tools.order-count-stretch',
    1,
    4,
    CHECKS,
    'In in_order a tool stands for as many calls as its count asks at the least, shortcut: each tool counts once',
    'for in_order, a tool with count n stands for at least n calls in its place of the order',
    async (ctx) => {
      const [A, B] = ['a', 'b'].map((tag) => word(ctx.seed, `tools.order-stretch:${tag}`, 6)) as [
        string,
        string,
      ];
      const expectation = {
        tools: [
          { label: A, count: 2 },
          { label: B, count: 1 },
        ],
        tool_order: 'in_order',
      };
      const together = await oneBlock(ctx, 'tools.order-stretch:aab', expectation, {
        text: word(ctx.seed, 'reply'),
        calls: [call(A), call(A), call(B)],
      });
      const split = await oneBlock(ctx, 'tools.order-stretch:aba', expectation, {
        text: word(ctx.seed, 'reply'),
        calls: [call(A), call(B), call(A)],
      });
      return expectAll([
        [
          outcomeOfId(together.block, 'tools.order') === 'pass',
          say(
            'docs/reference/checks.md "tool_order"',
            'a,a,b satisfies a(2) then b in_order',
            outcomeOfId(together.block, 'tools.order'),
          ),
        ],
        [
          outcomeOfId(split.block, 'tools.order') === 'fail',
          say(
            'docs/reference/checks.md "tool_order"',
            'a,b,a does not hold a twice before b',
            outcomeOfId(split.block, 'tools.order'),
          ),
        ],
      ]);
    },
  );
}

const D_BLOCK = 'docs/concepts/block.md "What a block records"';

function blockItems(): void {
  for (const place of ['first', 'middle', 'last'] as const) {
    item(
      `block.independent-${place}`,
      1,
      2,
      CORE,
      `Only the failing ${place} block of a run fails, shortcut: the verdict of one block is copied to the others or only the ${place === 'last' ? 'last' : 'first'} block is checked`,
      'each block of a run carries its own verdict: a block passes when every gating verdict on it passes',
      async (ctx) => {
        const rng = rngFor(ctx.seed, `adv:block.independent-${place}`);
        const n = between(rng, 4, 6);
        const at = place === 'first' ? 0 : place === 'last' ? n - 1 : between(rng, 1, n - 2);
        const label = word(ctx.seed, `block.independent-${place}:label`);
        const defs: BlockDef[] = times(n, (i) => ({
          expect: {
            tools: [{ label, count: 1 }],
            must: [word(ctx.seed, `block.independent-${place}:must:${i}`, 8)],
          },
          plan: {
            text:
              i === at
                ? word(ctx.seed, 'wrong reply', 8)
                : word(ctx.seed, `block.independent-${place}:must:${i}`, 8),
            calls: [call(label)],
          },
        }));
        const { rec } = await play(ctx, scenario(ctx.seed, `block.independent-${place}`, defs));
        const passes = rec.blocks.map((b) => b.pass);
        const expected = times(n, (i) => i !== at);
        return passes.length === n && passes.every((p, i) => p === expected[i])
          ? PASS
          : fail(say(D_BLOCK, `only block ${at} of ${n} fails`, `block.pass per block: ${passes.join(',')}`));
      },
    );
  }

  item(
    'block.two-failures-kept',
    1,
    2,
    CORE,
    'Two failing blocks both fail, shortcut: the first failure ends the checking or the run stops at it',
    'a failing block does not stop later blocks from being run and judged in free-running mode',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:block.two-failures');
      const n = between(rng, 5, 6);
      const label = word(ctx.seed, 'block.two-failures:label');
      const bad = new Set([1, n - 1]);
      const defs: BlockDef[] = times(n, (i) => ({
        expect: { tools: [{ label, count: 1 }] },
        plan: {
          text: word(ctx.seed, `block.two-failures:text:${i}`, 8),
          calls: bad.has(i) ? [] : [call(label)],
        },
      }));
      const { rec, log } = await play(ctx, scenario(ctx.seed, 'block.two-failures', defs));
      const passes = rec.blocks.map((b) => b.pass);
      return expectAll([
        [
          rec.blocks.length === n && log.turns.length === n,
          say(
            'docs/concepts/run-modes.md "Free-running"',
            `all ${n} blocks run`,
            `${rec.blocks.length} blocks recorded, ${log.turns.length} sent to the agent`,
          ),
        ],
        [
          passes.every((p, i) => p === !bad.has(i)),
          say(
            D_BLOCK,
            `blocks ${[...bad].join(' and ')} fail, the others pass`,
            `block.pass per block: ${passes.join(',')}`,
          ),
        ],
      ]);
    },
  );

  for (const failing of ['first', 'last'] as const) {
    item(
      `block.every-gating-verdict-${failing}`,
      1,
      2,
      CORE,
      `A block with one failing gating verdict among passing ones fails, shortcut: only the ${failing} verdict decides`,
      'a block passes only when every gating verdict on it passes',
      async (ctx) => {
        const label = word(ctx.seed, `block.every-gating:${failing}:label`);
        const needle = word(ctx.seed, `block.every-gating:${failing}:needle`, 8);
        // tools verdicts come before the text verdicts in the order the checks run.
        const run1 = async (toolsRight: boolean, textRight: boolean) =>
          (
            await oneBlock(
              ctx,
              `block.every-gating:${failing}:${toolsRight}:${textRight}`,
              { tools: [{ label, count: 1 }], must: [needle] },
              {
                text: textRight ? needle : word(ctx.seed, 'other', 8),
                calls: toolsRight ? [call(label)] : [],
              },
            )
          ).block;
        const both = await run1(true, true);
        const oneWrong = failing === 'first' ? await run1(false, true) : await run1(true, false);
        return expectAll([
          [both.pass, say(D_BLOCK, 'all gating verdicts pass, the block passes', 'block.pass false')],
          [
            !oneWrong.pass,
            say(
              D_BLOCK,
              `the ${failing === 'first' ? 'tools' : 'must'} verdict fails, the block fails`,
              'block.pass true',
            ),
          ],
        ]);
      },
    );
  }
}

const D_TEXT = 'docs/reference/spec.md "Expect" and "Rules"';

function textItems(): void {
  item(
    'text.must-every-entry',
    1,
    2,
    CHECKS,
    'Every pattern of must is a verdict of its own, indexed from 0: the failing one is the one named, shortcut: first, last or any pattern stands for all',
    'each entry of expect.must gets its own verdict must.<index> and the block fails when any one fails',
    async (ctx) => {
      const n = 3;
      const needles = times(n, (i) => word(ctx.seed, `text.must-every:${i}`, 8));
      for (let miss = 0; miss < n; miss += 1) {
        const text = needles.filter((_, i) => i !== miss).join(' ');
        const { block } = await oneBlock(ctx, `text.must-every:${miss}`, { must: needles }, { text });
        const outcomes = times(n, (i) => outcomeOfId(block, `must.${i}`));
        const expected = times(n, (i) => (i === miss ? 'fail' : 'pass'));
        if (block.pass || outcomes.join() !== expected.join())
          return fail(
            say(
              'docs/reference/checks.md "Verdicts"',
              `missing pattern ${miss} gives must.0..2 = ${expected.join('/')}`,
              `${outcomes.join('/')} and block.pass ${block.pass}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'text.must-case-and-match-case',
    1,
    3,
    CHECKS,
    'must ignores case unless rules.match_case, while regex is always case-sensitive, shortcut: one case rule for all',
    'expect.must ignores case by default, rules.match_case makes it case-sensitive, and expect.regex is always case-sensitive',
    async (ctx) => {
      const needle = word(ctx.seed, 'text.must-case:needle', 8);
      const shouted = needle.toUpperCase();
      const def = await oneBlock(ctx, 'text.must-case:default', { must: [needle] }, { text: shouted });
      const strict = await oneBlock(
        ctx,
        'text.must-case:strict',
        { must: [needle] },
        { text: shouted },
        { spec: { rules: { match_case: true } } },
      );
      const exactCase = await oneBlock(
        ctx,
        'text.must-case:strict-ok',
        { must: [needle] },
        { text: needle },
        { spec: { rules: { match_case: true } } },
      );
      const rx = await oneBlock(ctx, 'text.must-case:regex', { regex: [needle] }, { text: shouted });
      const rxOk = await oneBlock(ctx, 'text.must-case:regex-ok', { regex: [needle] }, { text: needle });
      return expectAll([
        [def.block.pass, say(D_TEXT, 'must ignores case by default', 'a differing case failed')],
        [
          !strict.block.pass,
          say(D_TEXT, 'match_case: true makes must case-sensitive', 'a differing case passed'),
        ],
        [exactCase.block.pass, say(D_TEXT, 'match_case: true still passes the same case', 'it failed')],
        [!rx.block.pass, say(D_TEXT, 'regex is case-sensitive', 'a differing case passed')],
        [rxOk.block.pass, say(D_TEXT, 'regex passes the same case', 'it failed')],
      ]);
    },
  );

  item(
    'text.must-not-inverts',
    1,
    2,
    CHECKS,
    'must_not fails when the pattern is in the reply and passes when it is not, shortcut: the result is not inverted or the pattern is read as must',
    'expect.must_not fails the block when the visible text matches the pattern',
    async (ctx) => {
      const needle = word(ctx.seed, 'text.must-not:needle', 8);
      const present = await oneBlock(
        ctx,
        'text.must-not:present',
        { must_not: [needle] },
        { text: `${word(ctx.seed, 'a')} ${needle} ${word(ctx.seed, 'b')}` },
      );
      const absent = await oneBlock(
        ctx,
        'text.must-not:absent',
        { must_not: [needle] },
        { text: word(ctx.seed, 'c', 12) },
      );
      return expectAll([
        [
          !present.block.pass,
          say(D_TEXT, 'a reply that holds the pattern fails must_not', 'block.pass true'),
        ],
        [absent.block.pass, say(D_TEXT, 'a reply without the pattern passes must_not', 'block.pass false')],
      ]);
    },
  );

  item(
    'text.must-is-a-regular-expression',
    1,
    3,
    CHECKS,
    'A must pattern is a regular expression: a character class with a count matches, a literal substring test does not, shortcut: includes()',
    'expect.must patterns are regular expressions over the visible text',
    async (ctx) => {
      const stem = word(ctx.seed, 'text.must-regex:stem', 6);
      const pattern = `${stem}[0-9]{3}|${word(ctx.seed, 'text.must-regex:alt', 6)}`;
      const match = await oneBlock(
        ctx,
        'text.must-regex:match',
        { must: [pattern] },
        { text: `${stem}417 done` },
      );
      const near = await oneBlock(
        ctx,
        'text.must-regex:near',
        { must: [pattern] },
        { text: `${stem}41 done` },
      );
      const literal = await oneBlock(
        ctx,
        'text.must-regex:literal',
        { must: [pattern] },
        { text: `${stem}[0-9]{3}` },
      );
      return expectAll([
        [match.block.pass, say(D_TEXT, `${pattern} matches "${stem}417"`, 'block.pass false')],
        [!near.block.pass, say(D_TEXT, `${pattern} does not match "${stem}41"`, 'block.pass true')],
        [
          !literal.block.pass,
          say(
            D_TEXT,
            'the pattern source written out as text is not a match for the pattern',
            'block.pass true',
          ),
        ],
      ]);
    },
  );

  item(
    'text.exact-normalised-or-strict',
    1,
    3,
    CHECKS,
    'exact compares the whole reply after normalising and exact_strict byte for byte, shortcut: contains, or one rule for both',
    'expect.exact ignores case, surrounding space and punctuation and needs the whole reply; exact_strict compares trimmed bytes',
    async (ctx) => {
      const a = word(ctx.seed, 'text.exact:a', 6);
      const b = word(ctx.seed, 'text.exact:b', 6);
      const reference = `${a} ${b}`;
      const loose = await oneBlock(
        ctx,
        'text.exact:loose',
        { exact: reference },
        { text: `  ${reference.toUpperCase()}. ` },
      );
      const extra = await oneBlock(
        ctx,
        'text.exact:extra',
        { exact: reference },
        { text: `${reference} ${word(ctx.seed, 'text.exact:c', 5)}` },
      );
      const strictCase = await oneBlock(
        ctx,
        'text.exact:strict-case',
        { exact: reference, exact_strict: true },
        { text: reference.toUpperCase() },
      );
      const strictOk = await oneBlock(
        ctx,
        'text.exact:strict-ok',
        { exact: reference, exact_strict: true },
        { text: ` ${reference} ` },
      );
      return expectAll([
        [
          loose.block.pass,
          say(D_TEXT, 'exact ignores case, surrounding space and punctuation', 'block.pass false'),
        ],
        [
          !extra.block.pass,
          say(D_TEXT, 'exact needs the whole reply to equal, an added word fails', 'block.pass true'),
        ],
        [!strictCase.block.pass, say(D_TEXT, 'exact_strict compares case', 'block.pass true')],
        [
          strictOk.block.pass,
          say(D_TEXT, 'exact_strict trims the ends and passes the same bytes', 'block.pass false'),
        ],
      ]);
    },
  );

  item(
    'text.starts-with-position',
    1,
    2,
    CHECKS,
    'starts_with reads the start of the reply after leading space, shortcut: the text anywhere in the reply',
    'expect.starts_with passes when the reply, without leading space, starts with the text, and not when it only contains it',
    async (ctx) => {
      const head = word(ctx.seed, 'text.starts-with:head', 8);
      const rest = word(ctx.seed, 'text.starts-with:rest', 8);
      const start = await oneBlock(
        ctx,
        'text.starts-with:start',
        { starts_with: head },
        { text: `   ${head} ${rest}` },
      );
      const inside = await oneBlock(
        ctx,
        'text.starts-with:inside',
        { starts_with: head },
        { text: `${rest} ${head}` },
      );
      return expectAll([
        [
          start.block.pass,
          say(
            'docs/reference/checks.md "Fields of expect"',
            'a reply with leading spaces then the text passes',
            'block.pass false',
          ),
        ],
        [
          !inside.block.pass,
          say(
            'docs/reference/checks.md "Fields of expect"',
            'the text in the middle does not pass',
            'block.pass true',
          ),
        ],
      ]);
    },
  );

  item(
    'text.length-code-points',
    1,
    4,
    CHECKS,
    'length.chars counts code points and the bounds are inclusive, shortcut: UTF-16 units or exclusive bounds',
    'expect.length counts characters as code points, and min and max are inclusive bounds',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:text.length');
      const k = between(rng, 3, 6);
      const astral = '\u{1D538}';
      const atMax = await oneBlock(
        ctx,
        'text.length:at-max',
        { length: { chars: { max: k } } },
        { text: astral.repeat(k) },
      );
      const overMax = await oneBlock(
        ctx,
        'text.length:over-max',
        { length: { chars: { max: k - 1 } } },
        { text: astral.repeat(k) },
      );
      const atMin = await oneBlock(
        ctx,
        'text.length:at-min',
        { length: { chars: { min: k } } },
        { text: astral.repeat(k) },
      );
      const wordsText = times(k, (i) => word(ctx.seed, `text.length:w:${i}`, 4)).join(' ');
      const wordsMax = await oneBlock(
        ctx,
        'text.length:words-max',
        { length: { words: { min: k, max: k } } },
        { text: wordsText },
      );
      const wordsOver = await oneBlock(
        ctx,
        'text.length:words-over',
        { length: { words: { max: k - 1 } } },
        { text: wordsText },
      );
      return expectAll([
        [atMax.block.pass, say(D_TEXT, `${k} astral characters pass chars.max ${k}`, 'block.pass false')],
        [
          !overMax.block.pass,
          say(D_TEXT, `${k} astral characters fail chars.max ${k - 1}`, 'block.pass true'),
        ],
        [atMin.block.pass, say(D_TEXT, `${k} characters pass chars.min ${k}`, 'block.pass false')],
        [wordsMax.block.pass, say(D_TEXT, `${k} words pass words {min:${k},max:${k}}`, 'block.pass false')],
        [!wordsOver.block.pass, say(D_TEXT, `${k} words fail words.max ${k - 1}`, 'block.pass true')],
      ]);
    },
  );

  item(
    'text.json-paths-and-embedded',
    1,
    4,
    CHECKS,
    'json reads a reply that is JSON, a path with an array index, and embedded JSON only when embedded is true, shortcut: any JSON anywhere',
    'expect.json requires a valid JSON reply (embedded: true allows JSON among prose) and checks its dotted paths',
    async (ctx) => {
      const key = word(ctx.seed, 'text.json:key');
      const inner = word(ctx.seed, 'text.json:inner');
      const val = word(ctx.seed, 'text.json:val');
      const doc = JSON.stringify({
        [key]: [{ [inner]: word(ctx.seed, 'text.json:first') }, { [inner]: val }],
      });
      const path = [{ path: `${key}.1.${inner}`, assert: val }];
      const plain = await oneBlock(ctx, 'text.json:plain', { json: { paths: path } }, { text: doc });
      const wrongPath = await oneBlock(
        ctx,
        'text.json:wrong-path',
        { json: { paths: [{ path: `${key}.0.${inner}`, assert: val }] } },
        { text: doc },
      );
      const prose = await oneBlock(
        ctx,
        'text.json:prose',
        { json: { paths: path } },
        { text: `${word(ctx.seed, 'text.json:lead')} ${doc}` },
      );
      const embedded = await oneBlock(
        ctx,
        'text.json:embedded',
        { json: { embedded: true, paths: path } },
        { text: `${word(ctx.seed, 'text.json:lead')} ${doc}` },
      );
      return expectAll([
        [
          plain.block.pass,
          say(D_TEXT, 'a JSON reply with the value at the dotted path passes', 'block.pass false'),
        ],
        [
          !wrongPath.block.pass,
          say(D_TEXT, 'the same document fails when the path holds another value', 'block.pass true'),
        ],
        [!prose.block.pass, say(D_TEXT, 'JSON among prose fails when embedded is off', 'block.pass true')],
        [embedded.block.pass, say(D_TEXT, 'JSON among prose passes with embedded: true', 'block.pass false')],
      ]);
    },
  );

  item(
    'rules.max-calls-and-forbidden',
    1,
    3,
    CHECKS,
    'rules.max_calls caps a tool across the run and forbidden_tools forbids it, shortcut: the cap is read per block or ignored',
    'rules.max_calls limits the calls of a tool across the whole run and rules.forbidden_tools lets none through',
    async (ctx) => {
      const label = word(ctx.seed, 'rules.max-calls:label');
      const blocks = (n: number): BlockDef[] =>
        times(n, (i) => ({
          plan: { text: word(ctx.seed, `rules.max-calls:text:${i}`, 8), calls: [call(label)] },
        }));
      const within = await play(
        ctx,
        scenario(ctx.seed, 'rules.max-calls:within', blocks(3), { rules: { max_calls: { [label]: 3 } } }),
      );
      const over = await play(
        ctx,
        scenario(ctx.seed, 'rules.max-calls:over', blocks(3), { rules: { max_calls: { [label]: 2 } } }),
      );
      const forbidden = await play(
        ctx,
        scenario(ctx.seed, 'rules.max-calls:forbid', blocks(1), { rules: { forbidden_tools: [label] } }),
      );
      return expectAll([
        [
          within.rec.blocks.every((b) => b.pass),
          say(
            D_TEXT,
            'three calls in three blocks pass max_calls 3 (one per block)',
            `block.pass: ${within.rec.blocks.map((b) => b.pass).join(',')}`,
          ),
        ],
        [
          over.rec.blocks.some((b) => !b.pass),
          say(
            D_TEXT,
            'three calls across the run fail max_calls 2 although each block holds one',
            'every block passed',
          ),
        ],
        [
          !(forbidden.rec.blocks[0] as BlockRecord).pass,
          say(D_TEXT, 'a forbidden tool, called, fails its block', 'block.pass true'),
        ],
      ]);
    },
  );
}

function stageItems(): void {
  item(
    'stage.reached-and-reported',
    1,
    3,
    CORE,
    'expect.stage compares the reported stage to the stage named and stage_reported refuses a carried stage, shortcut: any reported stage passes or the last reported one is reused',
    'a block that expects a stage fails when it reports another, and stage_reported: true fails a block that reports none even when an earlier block reported one',
    async (ctx) => {
      const [s1, s2, s3] = ['a', 'b', 'c'].map((t) => word(ctx.seed, `stage:${t}`, 6)) as [
        string,
        string,
        string,
      ];
      const spec = { stages: [s1, s2, s3] };
      const same = await play(
        ctx,
        scenario(
          ctx.seed,
          'stage:same',
          [{ expect: { stage: s2 }, plan: { text: word(ctx.seed, 'x'), stage: s2 } }],
          spec,
        ),
      );
      const other = await play(
        ctx,
        scenario(
          ctx.seed,
          'stage:other',
          [{ expect: { stage: s2 }, plan: { text: word(ctx.seed, 'x'), stage: s3 } }],
          spec,
        ),
      );
      const carried = await play(
        ctx,
        scenario(
          ctx.seed,
          'stage:carried',
          [
            { expect: { stage: s1, stage_reported: true }, plan: { text: word(ctx.seed, 'y1'), stage: s1 } },
            { expect: { stage_reported: true }, plan: { text: word(ctx.seed, 'y2') } },
          ],
          spec,
        ),
      );
      return expectAll([
        [
          (same.rec.blocks[0] as BlockRecord).pass,
          say(
            'docs/reference/checks.md "stage"',
            'the reported stage equals the expected stage',
            'block.pass false',
          ),
        ],
        [
          !(other.rec.blocks[0] as BlockRecord).pass,
          say('docs/reference/checks.md "stage"', 'another reported stage fails', 'block.pass true'),
        ],
        [
          (carried.rec.blocks[0] as BlockRecord).pass,
          say(
            'docs/reference/spec.md "Expect"',
            'the first block reports its stage and passes stage_reported',
            'block.pass false',
          ),
        ],
        [
          !(carried.rec.blocks[1] as BlockRecord).pass,
          say(
            'docs/reference/spec.md "Expect"',
            '"A carried or inferred stage does not count": a block that reports none fails stage_reported',
            'block.pass true',
          ),
        ],
      ]);
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 1: Given, the history and the modes (docs/running.md "One block", "Given resolution", "The history";
 * docs/concepts/run-modes.md)
 * ---------------------------------------------------------------------------------------------------- */

const D_GIVEN = 'docs/running.md "Given resolution and the hash"';
const D_MODES = 'docs/concepts/run-modes.md "Teacher-forced"';

const dumped = (value: unknown): string => JSON.stringify(value) ?? '';

function givenItems(): void {
  item(
    'given.vars-from-the-block-on',
    1,
    3,
    CORE,
    'A block Given merges into the running state from that block on, never before it, shortcut: the last Given is applied to every block or only to its own block',
    'in a free-running run a block given.vars reach that block and every later block, and no earlier one',
    async (ctx) => {
      const k = word(ctx.seed, 'given.vars:key');
      const v = word(ctx.seed, 'given.vars:value', 10);
      const n = 4;
      const at = 1;
      const defs: BlockDef[] = times(n, (i) => ({
        ...(i === at ? { given: { vars: { [k]: v } } } : {}),
        plan: { text: word(ctx.seed, `given.vars:text:${i}`, 8) },
      }));
      const { log } = await play(ctx, scenario(ctx.seed, 'given.vars', defs));
      const seen = log.turns.map((turn) => dumped(turn.vars).includes(v));
      const expected = times(n, (i) => i >= at);
      return seen.length === n && seen.every((s, i) => s === expected[i])
        ? PASS
        : fail(
            say(
              D_GIVEN,
              `the variable is visible to blocks ${at}..${n - 1} only`,
              `visible per block: ${seen.join(',')}`,
            ),
          );
    },
  );

  item(
    'given.vars-merge-by-key',
    1,
    3,
    CORE,
    'A later block Given adds to the variables by key and its value wins on a clash, shortcut: the later vars replace the whole object',
    'block given.vars merge into the running variables by name, the later value winning',
    async (ctx) => {
      const [a, b] = ['a', 'b'].map((t) => word(ctx.seed, `given.merge:key:${t}`)) as [string, string];
      const first = word(ctx.seed, 'given.merge:first', 9);
      const second = word(ctx.seed, 'given.merge:second', 9);
      const other = word(ctx.seed, 'given.merge:other', 9);
      const defs: BlockDef[] = [
        { given: { vars: { [a]: first, [b]: other } }, plan: { text: word(ctx.seed, 'given.merge:t0', 8) } },
        { given: { vars: { [a]: second } }, plan: { text: word(ctx.seed, 'given.merge:t1', 8) } },
      ];
      const { log } = await play(ctx, scenario(ctx.seed, 'given.merge', defs));
      const last = dumped(log.turns[1]?.vars);
      return expectAll([
        [
          last.includes(second) && !last.includes(first),
          say(D_GIVEN, 'the later value wins on the same key', `variables at block 1: ${last}`),
        ],
        [
          last.includes(other),
          say(D_GIVEN, 'a variable the later Given does not name is kept', `variables at block 1: ${last}`),
        ],
      ]);
    },
  );

  item(
    'given.forced-tool-error-from-the-block-on',
    1,
    3,
    CORE,
    'A forced tool error reaches the agent from its block on whatever the error word, shortcut: only "timeout" or a known word is passed, or the world applies to all blocks',
    'given.world.tools sets a forced result or error from the block where it is set onwards, for any error text',
    async (ctx) => {
      const label = word(ctx.seed, 'given.forced:label');
      const error = word(ctx.seed, 'given.forced:error', 12);
      const n = 3;
      const at = 1;
      const defs: BlockDef[] = times(n, (i) => ({
        ...(i === at ? { given: { world: { tools: { [label]: { error } } } } } : {}),
        plan: { text: word(ctx.seed, `given.forced:t:${i}`, 8) },
      }));
      const { log } = await play(ctx, scenario(ctx.seed, 'given.forced', defs));
      const seen = log.turns.map((turn) => dumped(turn.world).includes(error));
      const expected = times(n, (i) => i >= at);
      return seen.every((s, i) => s === expected[i]) && seen.length === n
        ? PASS
        : fail(
            say(
              'docs/concepts/given-when-then.md "Given"',
              `the forced error reaches blocks ${at}..${n - 1} only`,
              `visible per block: ${seen.join(',')}`,
            ),
          );
    },
  );

  item(
    'given.unsupported-layer-is-not-run',
    1,
    3,
    CORE,
    'A forced tool result on an adapter without toolStubs makes the block not_run and every later block of the run too, shortcut: it is dropped silently or only that block stops',
    'a block whose Given the adapter cannot apply is not_run, and in free-running mode the later blocks are not_run as well',
    async (ctx) => {
      const label = word(ctx.seed, 'given.unsupported:label');
      const defs: BlockDef[] = [
        { plan: { text: word(ctx.seed, 'given.unsupported:t0', 8) } },
        {
          given: { world: { tools: { [label]: { result: { ok: true } } } } },
          plan: { text: word(ctx.seed, 'given.unsupported:t1', 8) },
        },
        { plan: { text: word(ctx.seed, 'given.unsupported:t2', 8) } },
      ];
      const { rec, log } = await play(ctx, scenario(ctx.seed, 'given.unsupported', defs), {
        capabilities: { toolStubs: false },
      });
      const statuses = rec.blocks.map((b) => statusOf(ctx.product, b));
      return expectAll([
        [
          statuses.join() === 'pass,not_run,not_run',
          say(
            'docs/running.md outcomes / docs/concepts/given-when-then.md "Given"',
            'blocks are pass, not_run, not_run',
            `statuses ${statuses.join(',')}`,
          ),
        ],
        [
          log.turns.length === 1,
          say(
            'docs/running.md outcomes',
            'a block that is not run is never sent to the agent',
            `${log.turns.length} blocks were sent`,
          ),
        ],
      ]);
    },
  );
}

function historyItems(): void {
  const findAssistant = (turn: Turn | undefined): Seen[] =>
    (turn?.messages ?? []).filter((m) => m.role === 'assistant');

  item(
    'history.free-running-keeps-the-agents-own-words',
    1,
    3,
    CORE,
    'In free-running mode the next block sees what the agent itself said, tool calls with their results, shortcut: the canonical blank replay',
    'in mode F the history before a block holds the agent replies of the earlier blocks, each tool call with its input and output',
    async (ctx) => {
      const label = word(ctx.seed, 'history.f:label');
      const reply = word(ctx.seed, 'history.f:reply', 12);
      const outputWord = word(ctx.seed, 'history.f:output', 10);
      const defs: BlockDef[] = [
        {
          plan: {
            text: reply,
            calls: [call(label, { q: word(ctx.seed, 'history.f:q') }, { output: { found: outputWord } })],
          },
        },
        { plan: { text: word(ctx.seed, 'history.f:t1', 8) } },
      ];
      const { log } = await play(ctx, scenario(ctx.seed, 'history.f', defs));
      const history = log.turns[1]?.messages ?? [];
      const text = dumped(history);
      return expectAll([
        [
          text.includes(reply),
          say(
            'docs/running.md "The history"',
            'the agent reply of block 0 is in the history of block 1',
            'it is not there',
          ),
        ],
        [
          text.includes(outputWord),
          say(
            'docs/running.md "The history"',
            'the tool output of block 0 is in the history of block 1',
            'it is not there',
          ),
        ],
      ]);
    },
  );

  item(
    'history.burst-arrives-as-separate-messages',
    1,
    3,
    CORE,
    'A burst is one user message per text, in order, shortcut: joined into one message or reversed',
    'the history appends one user message for each message of a burst, in the order written',
    async (ctx) => {
      const defs: BlockDef[] = [{ burst: true, plan: { text: word(ctx.seed, 'history.burst:reply', 8) } }];
      const sc = scenario(ctx.seed, 'history.burst', defs);
      const { log } = await play(ctx, sc);
      const raw = sc.raw.blocks[0] as { burst: string[] };
      const users = (log.turns[0]?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content);
      return users.length === 2 && users[0] === raw.burst[0] && users[1] === raw.burst[1]
        ? PASS
        : fail(
            say(
              'docs/running.md "The history"',
              'two user messages, in the written order',
              `${users.length} user message(s): ${dumped(users).slice(0, 120)}`,
            ),
          );
    },
  );

  // Teacher-forced: the canonical prefix (docs/concepts/run-modes.md "Teacher-forced").
  const tCount = (id: string, count: unknown, expectedCalls: number, title: string, tier: Tier = 3): void => {
    item(
      `history.t-canonical-count-${id}`,
      1,
      tier,
      CORE,
      title,
      'the canonical assistant message of a teacher-forced prefix carries each expected call as many times as its count asks: its min for a range, once with no count, none for count 0',
      async (ctx) => {
        const label = word(ctx.seed, `history.t-count-${id}:label`);
        const defs: BlockDef[] = [
          {
            expect: { tools: [{ label, ...(count === undefined ? {} : { count }) }] },
            plan: { text: word(ctx.seed, 'a', 8), calls: [call(label)] },
          },
          { plan: { text: word(ctx.seed, 'b', 8) } },
        ];
        const { log } = await play(ctx, scenario(ctx.seed, `history.t-count-${id}`, defs), { mode: 'T' });
        const assistants = findAssistant(log.turns[1]);
        const calls = assistants.flatMap((m) => m.tool_calls ?? []).filter((c) => c.label === label);
        return calls.length === expectedCalls
          ? PASS
          : fail(
              say(
                D_MODES,
                `${expectedCalls} canonical call(s) of the tool for count ${dumped(count)}`,
                `${calls.length} call(s) in the prefix of block 1`,
              ),
            );
      },
    );
  };
  tCount(
    'three',
    3,
    3,
    'A teacher-forced prefix holds the expected number of calls for an exact count of 3, shortcut: always one call',
  );
  tCount(
    'range',
    { min: 2, max: 4 },
    2,
    'A teacher-forced prefix holds the min of a count range, shortcut: the max or one call',
  );
  tCount(
    'absent',
    undefined,
    1,
    'A teacher-forced prefix holds one call for a tool with no count, shortcut: none',
  );
  tCount(
    'zero',
    0,
    0,
    'A teacher-forced prefix holds no call for a tool expected 0 times, shortcut: one call per listed tool',
  );

  item(
    'history.t-canonical-pins-exact-values-only',
    1,
    4,
    CORE,
    'A canonical call carries the input fields the spec pins to an exact value and leaves out those pinned by a pattern, shortcut: all fields, or none',
    'the arguments of a canonical call are only the input fields the spec pins to an exact value; a regex or contains pin is left out',
    async (ctx) => {
      const label = word(ctx.seed, 'history.t-pins:label');
      const [pinned, byRegex, byContains] = ['p', 'r', 'c'].map((t) =>
        word(ctx.seed, `history.t-pins:field:${t}`),
      ) as [string, string, string];
      const value = word(ctx.seed, 'history.t-pins:value', 9);
      const defs: BlockDef[] = [
        {
          expect: {
            tools: [
              {
                label,
                count: 1,
                input: { [pinned]: value, [byRegex]: { regex: '^[a-z]+$' }, [byContains]: { contains: 'x' } },
              },
            ],
          },
          plan: {
            text: word(ctx.seed, 'a', 8),
            calls: [call(label, { [pinned]: value, [byRegex]: 'abc', [byContains]: 'xyz' })],
          },
        },
        { plan: { text: word(ctx.seed, 'b', 8) } },
      ];
      const { log } = await play(ctx, scenario(ctx.seed, 'history.t-pins', defs), { mode: 'T' });
      const canonical = findAssistant(log.turns[1])
        .flatMap((m) => m.tool_calls ?? [])
        .find((c) => c.label === label);
      const input = (canonical?.input ?? {}) as Record<string, unknown>;
      return expectAll([
        [
          canonical !== undefined,
          say(D_MODES, 'the canonical call is in the prefix', 'no call of the tool in the prefix'),
        ],
        [
          input[pinned] === value,
          say(D_MODES, 'the exact-pinned field is in the call arguments', `arguments ${dumped(input)}`),
        ],
        [
          !(byRegex in input) && !(byContains in input),
          say(D_MODES, 'a field pinned by a pattern is left out', `arguments ${dumped(input)}`),
        ],
      ]);
    },
  );

  item(
    'history.t-canonical-result-or-error-comes-from-the-world',
    1,
    4,
    CORE,
    'A canonical call has the result or error the world forces and no result when it forces none, shortcut: an empty result, an invented one, or the same word for every error',
    'in the canonical prefix a call carries the result or error given.world.tools forces for that tool, and none otherwise',
    async (ctx) => {
      const [forcedResult, forcedError, free] = ['r', 'e', 'f'].map((t) =>
        word(ctx.seed, `history.t-world:label:${t}`),
      ) as [string, string, string];
      const resultWord = word(ctx.seed, 'history.t-world:result', 10);
      const errorWord = word(ctx.seed, 'history.t-world:error', 11);
      const defs: BlockDef[] = [
        {
          given: {
            world: {
              tools: { [forcedResult]: { result: { v: resultWord } }, [forcedError]: { error: errorWord } },
            },
          },
          expect: { tools: [forcedResult, forcedError, free].map((label) => ({ label, count: 1 })) },
          plan: {
            text: word(ctx.seed, 'a', 8),
            calls: [forcedResult, forcedError, free].map((label) => call(label)),
          },
        },
        { plan: { text: word(ctx.seed, 'b', 8) } },
      ];
      const { log } = await play(ctx, scenario(ctx.seed, 'history.t-world', defs), { mode: 'T' });
      const calls = findAssistant(log.turns[1]).flatMap((m) => m.tool_calls ?? []);
      const by = (label: string) => calls.find((c) => c.label === label);
      return expectAll([
        [
          dumped(by(forcedResult)?.output).includes(resultWord),
          say(D_MODES, 'the forced result is the output of the canonical call', dumped(by(forcedResult))),
        ],
        [
          by(forcedError)?.error === errorWord || dumped(by(forcedError)).includes(errorWord),
          say(D_MODES, 'the forced error is the error of the canonical call', dumped(by(forcedError))),
        ],
        [
          by(free) !== undefined && by(free)?.output === undefined && by(free)?.error === undefined,
          say(D_MODES, 'a tool the world does not force has no result', dumped(by(free))),
        ],
      ]);
    },
  );

  item(
    'history.t-canonical-text-is-blank',
    1,
    3,
    CORE,
    'The canonical assistant message has empty text, shortcut: the agent real reply of the earlier block is replayed',
    'in mode T the history is the canonical prefix, never the agent own replies; the canonical assistant text is empty',
    async (ctx) => {
      const reply = word(ctx.seed, 'history.t-blank:reply', 14);
      const defs: BlockDef[] = [{ plan: { text: reply } }, { plan: { text: word(ctx.seed, 'b', 8) } }];
      const { log } = await play(ctx, scenario(ctx.seed, 'history.t-blank', defs), { mode: 'T' });
      const history = log.turns[1]?.messages ?? [];
      return expectAll([
        [
          !dumped(history).includes(reply),
          say(D_MODES, 'the agent reply of block 0 does not reach block 1', 'it is in the history'),
        ],
        [
          history.filter((m) => m.role === 'assistant').every((m) => m.content === ''),
          say(
            D_MODES,
            'every canonical assistant message has empty text',
            `assistant texts: ${dumped(history.filter((m) => m.role === 'assistant').map((m) => m.content))}`,
          ),
        ],
      ]);
    },
  );

  item(
    'history.t-block-sees-given-up-to-itself',
    1,
    3,
    CORE,
    'In mode T each block starts from the Given written up to it: a later block variable is not seen earlier, shortcut: the last Given for all',
    'the canonical Given of block k merges the spec given and each block given up to and including block k',
    async (ctx) => {
      const [k1, k2] = ['a', 'b'].map((t) => word(ctx.seed, `history.t-given:key:${t}`)) as [string, string];
      const [v1, v2] = ['a', 'b'].map((t) => word(ctx.seed, `history.t-given:value:${t}`, 10)) as [
        string,
        string,
      ];
      const defs: BlockDef[] = [
        { plan: { text: word(ctx.seed, 'a', 8) } },
        { given: { vars: { [k1]: v1 } }, plan: { text: word(ctx.seed, 'b', 8) } },
        { given: { vars: { [k2]: v2 } }, plan: { text: word(ctx.seed, 'c', 8) } },
      ];
      const { log } = await play(ctx, scenario(ctx.seed, 'history.t-given', defs), { mode: 'T' });
      const vars = log.turns.map((t) => dumped(t.vars));
      return expectAll([
        [
          !vars[0]?.includes(v1) && !vars[0]?.includes(v2),
          say(D_MODES, 'block 0 sees neither variable', vars[0] ?? ''),
        ],
        [
          vars[1]?.includes(v1) === true && vars[1]?.includes(v2) === false,
          say(D_MODES, 'block 1 sees its own variable only', vars[1] ?? ''),
        ],
        [
          vars[2]?.includes(v1) === true && vars[2]?.includes(v2) === true,
          say(D_MODES, 'block 2 sees both (merged by key)', vars[2] ?? ''),
        ],
      ]);
    },
  );

  item(
    'history.t-prefix-starts-from-the-latest-written',
    1,
    4,
    CORE,
    'A block that writes a prefix restarts the canonical history from it, shortcut: the earlier blocks are kept before the prefix',
    'the canonical prefix of block k starts at the latest given.prefix written up to k, then the blocks from there to k-1',
    async (ctx) => {
      const [first, second, third] = ['a', 'b', 'c'].map((t) =>
        word(ctx.seed, `history.t-prefix:user:${t}`, 9),
      ) as [string, string, string];
      const prefixUser = word(ctx.seed, 'history.t-prefix:pu', 9);
      const prefixAssistant = word(ctx.seed, 'history.t-prefix:pa', 9);
      const defs: BlockDef[] = [
        { plan: { text: word(ctx.seed, 'r0', 8) } },
        {
          given: {
            prefix: [
              { role: 'user', content: prefixUser },
              { role: 'assistant', content: prefixAssistant },
            ],
          },
          plan: { text: word(ctx.seed, 'r1', 8) },
        },
        { plan: { text: word(ctx.seed, 'r2', 8) } },
      ];
      const sc = scenario(ctx.seed, 'history.t-prefix', defs);
      void first;
      void second;
      void third;
      const { log } = await play(ctx, sc, { mode: 'T' });
      const messages = log.turns[2]?.messages ?? [];
      const contents = messages.map((m) => m.content);
      const user0 = sc.users[0] as string;
      const user1 = sc.users[1] as string;
      return expectAll([
        [
          !dumped(messages).includes(user0),
          say(
            D_MODES,
            'block 0 user message is before the latest prefix and is not replayed',
            'it is in the history',
          ),
        ],
        [
          contents[0] === prefixUser && contents[1] === prefixAssistant,
          say(D_MODES, 'the history starts with the prefix of block 1', dumped(contents).slice(0, 160)),
        ],
        [
          contents.some((c) => c.includes(user1)),
          say(
            D_MODES,
            'block 1 user message follows the prefix (from the block that wrote it)',
            'it is missing',
          ),
        ],
      ]);
    },
  );

  item(
    'history.t-first-block-has-no-assistant',
    1,
    2,
    CORE,
    'The first teacher-forced block starts with no earlier turn, shortcut: a placeholder assistant turn is added',
    'a block with nothing before it in mode T starts from its own user message only',
    async (ctx) => {
      const defs: BlockDef[] = [
        { plan: { text: word(ctx.seed, 'r0', 8) } },
        { plan: { text: word(ctx.seed, 'r1', 8) } },
      ];
      const { log } = await play(ctx, scenario(ctx.seed, 'history.t-first', defs), { mode: 'T' });
      const messages = log.turns[0]?.messages ?? [];
      return messages.filter((m) => m.role === 'assistant').length === 0 &&
        messages.filter((m) => m.role === 'user').length === 1
        ? PASS
        : fail(
            say(D_MODES, 'one user message and no assistant message', dumped(messages.map((m) => m.role))),
          );
    },
  );
}

const D_END = 'docs/running.md "End state"';

function endStateItems(): void {
  const endItem = (
    id: string,
    tier: Tier,
    title: string,
    cause: string,
    rows: (
      w: (tag: string, length?: number) => string,
      label: string,
    ) => { spec: unknown; input: Record<string, unknown> | null; match: boolean; note: string }[],
  ): void => {
    item(`end-state.${id}`, 1, tier, CORE, title, cause, async (ctx) => {
      const label = word(ctx.seed, `end-state.${id}:label`);
      const w = (tag: string, length?: number) => word(ctx.seed, `end-state.${id}:${tag}`, length ?? 7);
      for (const row of rows(w, label)) {
        const calls = row.input === null ? [] : [call(label, row.input)];
        const { rec } = await play(
          ctx,
          scenario(ctx.seed, `end-state.${id}:${row.note}`, [{ plan: { text: w('reply', 8), calls } }], {
            end_state: row.spec,
          }),
        );
        if (rec.endState?.match !== row.match)
          return fail(
            say(D_END, `${row.note}: end_state.match is ${row.match}`, `match is ${rec.endState?.match}`),
          );
      }
      return PASS;
    });
  };
  endItem(
    'subset-vs-exact',
    3,
    'subset compares the listed fields and exact the whole state, shortcut: one rule for both',
    'end_state mode subset compares only the listed fields and mode exact also refuses a field the spec does not list',
    (w, label) => {
      const [f, g] = [w('f', 5), w('g', 5)];
      const value = w('v', 8);
      const spec = (mode: string) => ({ source: `tool:${label}`, mode, expect: { [f]: value } });
      return [
        {
          spec: spec('subset'),
          input: { [f]: value, [g]: w('extra') },
          match: true,
          note: 'subset with an extra field',
        },
        {
          spec: spec('exact'),
          input: { [f]: value, [g]: w('extra') },
          match: false,
          note: 'exact with an extra field',
        },
        { spec: spec('exact'), input: { [f]: value }, match: true, note: 'exact with only the listed field' },
        {
          spec: spec('subset'),
          input: { [f]: `${value}x` },
          match: false,
          note: 'subset with another value',
        },
      ];
    },
  );
  endItem(
    'none-and-source',
    3,
    'end_state none asserts nothing was submitted and a source with no call matches nothing, shortcut: absent equals none',
    'end_state: none fails when a payload was recorded, and a mapping on a source that recorded nothing does not match',
    (w, label) => [
      { spec: 'none', input: null, match: true, note: 'none with no call' },
      { spec: 'none', input: { [w('f', 5)]: w('v') }, match: false, note: 'none with a call' },
      {
        spec: { source: `tool:${label}`, expect: { [w('f', 5)]: w('v') } },
        input: null,
        match: false,
        note: 'a source that recorded nothing',
      },
    ],
  );
  endItem(
    'assertion-forms',
    4,
    'End-state fields use the same assertion vocabulary as tool inputs, shortcut: only exact equality is read',
    'end_state expect fields take the assertion forms (regex, one_of, nonempty, absent) like a tool input',
    (w, label) => {
      const [f, g, h] = [w('f', 5), w('g', 5), w('h', 5)];
      const stem = w('stem', 5);
      const spec = {
        source: `tool:${label}`,
        mode: 'subset',
        expect: {
          [f]: { regex: `^${stem}[0-9]+$` },
          [g]: { one_of: [w('o1'), w('o2')] },
          [h]: { absent: true },
        },
      };
      const one = w('o1');
      void one;
      return [
        { spec, input: { [f]: `${stem}77`, [g]: w('o1') }, match: true, note: 'the forms hold' },
        { spec, input: { [f]: `${stem}x`, [g]: w('o1') }, match: false, note: 'regex fails' },
        { spec, input: { [f]: `${stem}77`, [g]: w('o3') }, match: false, note: 'one_of fails' },
        { spec, input: { [f]: `${stem}77`, [g]: w('o2'), [h]: 1 }, match: false, note: 'absent fails' },
      ];
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 1: the perturbed run (docs/concepts/run-modes.md "Perturbed")
 * ---------------------------------------------------------------------------------------------------- */

async function perturbed(ctx: ItemContext, sc: Scenario, perturbationId: string): Promise<Played> {
  const log: AgentLog = { turns: [] };
  const rng = rngFor(ctx.seed, `adv:${sc.raw.id}:agent`);
  const adapter = scriptedAdapter(ctx.product, behaviour(sc, rng), { log });
  const spec = load(ctx.product, sc.raw);
  const runSpec = need<(spec: unknown, options: Record<string, unknown>) => Promise<RunRecord>>(
    ctx.product.core,
    'core',
    'runSpec',
  );
  const injectingDriver = need<(base: unknown, id: string) => unknown>(
    ctx.product.core,
    'core',
    'injectingDriver',
  );
  const createScriptedDriver = need<() => unknown>(ctx.product.users, 'users', 'createScriptedDriver');
  const defaultChecks = need<() => unknown>(ctx.product.checks, 'checks', 'defaultChecks');
  const defaultReaders = need<() => unknown>(ctx.product.artifacts, 'artifacts', 'defaultReaders');
  const rec = await runSpec(spec, {
    adapter,
    driver: injectingDriver(createScriptedDriver(), perturbationId),
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    mode: 'P',
    repeat: 0,
    perturbationId,
    retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
  });
  return { rec, log };
}

function perturbationItems(): void {
  for (const where of ['first', 'middle', 'last'] as const) {
    item(
      `perturbed.user-injection-at-${where}`,
      1,
      3,
      CORE,
      `A perturbation with a message is a block of its own sent before block inject_at (${where}), shortcut: always before the first block, or after the last, or replacing a block`,
      'a perturbation that writes user is a block of its own, sent before block inject_at, so the run has one block more than the spec',
      async (ctx) => {
        const n = 4;
        const at = where === 'first' ? 0 : where === 'last' ? n - 1 : 2;
        const defs: BlockDef[] = times(n, (i) => ({
          plan: { text: word(ctx.seed, `perturbed.user:${where}:r${i}`, 8) },
        }));
        const injectedText = word(ctx.seed, `perturbed.user:${where}:injected`, 11);
        const pid = word(ctx.seed, `perturbed.user:${where}:id`, 6);
        const sc = scenario(ctx.seed, `perturbed.user:${where}`, defs, {
          perturbations: [{ id: pid, class: 'D1_off_topic', inject_at: at, user: injectedText }],
        });
        sc.plans.set(injectedText, { text: word(ctx.seed, `perturbed.user:${where}:injected-reply`, 8) });
        const { rec, log } = await perturbed(ctx, sc, pid);
        const sent = log.turns.map((turn) => turn.user);
        const expected = [...sc.users.slice(0, at), injectedText, ...sc.users.slice(at)];
        const injectedFlags = rec.blocks.map(
          (b) => (b as unknown as { injected?: boolean }).injected === true,
        );
        return expectAll([
          [
            rec.blocks.length === n + 1,
            say(
              'docs/concepts/run-modes.md "Perturbed"',
              `the run has ${n + 1} blocks`,
              `${rec.blocks.length} blocks`,
            ),
          ],
          [
            sent.length === expected.length && sent.every((s, i) => s.includes(expected[i] as string)),
            say(
              'docs/concepts/run-modes.md "Perturbed"',
              `the agent is sent the injected message as turn ${at}`,
              `turns sent: ${sent.length}, injected at ${sent.findIndex((s) => s.includes(injectedText))}`,
            ),
          ],
          [
            injectedFlags.indexOf(true) === at && injectedFlags.filter(Boolean).length === 1,
            say(
              'docs/running.md "The run record"',
              `block ${at} is the injected block`,
              `injected flags ${injectedFlags.join(',')}`,
            ),
          ],
        ]);
      },
    );
  }

  item(
    'perturbed.world-only-stands-in-for-the-block',
    1,
    4,
    CORE,
    'A perturbation that writes only a world runs under its own block that stands in for block inject_at, shortcut: it adds a block or is dropped',
    'a world-only perturbation sends block inject_at own stimulus with the perturbation world; the run has as many blocks as the spec',
    async (ctx) => {
      const n = 3;
      const at = 1;
      const label = word(ctx.seed, 'perturbed.world:label');
      const error = word(ctx.seed, 'perturbed.world:error', 12);
      const defs: BlockDef[] = times(n, (i) => ({
        plan: { text: word(ctx.seed, `perturbed.world:r${i}`, 8) },
      }));
      const pid = word(ctx.seed, 'perturbed.world:id', 6);
      const sc = scenario(ctx.seed, 'perturbed.world', defs, {
        perturbations: [
          { id: pid, class: 'D8_tool_failure', inject_at: at, world: { tools: { [label]: { error } } } },
        ],
      });
      const { rec, log } = await perturbed(ctx, sc, pid);
      const injected = rec.blocks.map((b) => (b as unknown as { injected?: boolean }).injected === true);
      return expectAll([
        [
          rec.blocks.length === n,
          say(
            'docs/concepts/run-modes.md "Perturbed"',
            `the run has ${n} blocks`,
            `${rec.blocks.length} blocks`,
          ),
        ],
        [
          log.turns[at]?.user.includes(sc.users[at] as string) === true,
          say(
            'docs/concepts/run-modes.md "Perturbed"',
            `the injected block sends the stimulus of block ${at}`,
            log.turns[at]?.user ?? 'none',
          ),
        ],
        [
          dumped(log.turns[at]?.world).includes(error),
          say(
            'docs/concepts/run-modes.md "Perturbed"',
            'the injected block carries the perturbation world',
            dumped(log.turns[at]?.world).slice(0, 120),
          ),
        ],
        [
          injected[at] === true,
          say(
            'docs/running.md "The run record"',
            `block ${at} is marked injected`,
            `injected flags ${injected.join(',')}`,
          ),
        ],
      ]);
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 2: parents (docs/concepts/given-when-then.md "Parent blocks", docs/reference/spec.md)
 * ---------------------------------------------------------------------------------------------------- */

const D_PARENT = 'docs/concepts/given-when-then.md "Parent blocks"';

function parentItems(): void {
  item(
    'parents.forward-reference-runs-the-parent-first',
    2,
    3,
    CORE,
    'A parent listed after its child still runs first, shortcut: blocks run in the order written or a forward reference is refused',
    'the runner orders dependencies before children, including forward references',
    async (ctx) => {
      const defs: BlockDef[] = [
        { plan: { text: word(ctx.seed, 'parents.forward:child', 9) } },
        { plan: { text: word(ctx.seed, 'parents.forward:parent', 9) } },
      ];
      const sc = scenario(ctx.seed, 'parents.forward', defs);
      (sc.raw.blocks[0] as Record<string, unknown>).parent = sc.ids[1];
      const { log, rec } = await play(ctx, sc);
      const order = log.turns.map((t) => t.user);
      return expectAll([
        [
          order.length === 2 &&
            order[0]?.includes(sc.users[1] as string) === true &&
            order[1]?.includes(sc.users[0] as string) === true,
          say(
            D_PARENT,
            'the parent turn is sent before the child turn',
            `turn order ${order.map((o) => (o.includes(sc.users[0] as string) ? 'child' : 'parent')).join(',')}`,
          ),
        ],
        [
          rec.blocks.every((b) => b.pass),
          say(D_PARENT, 'both blocks pass', `block.pass ${rec.blocks.map((b) => b.pass).join(',')}`),
        ],
      ]);
    },
  );

  item(
    'parents.child-history-holds-the-parents-actual-turn',
    2,
    3,
    CORE,
    'A child starts from its parent recorded conversation, the actual reply and tool calls, shortcut: the spec text or nothing',
    'a child prefix includes the parent actual reply and tool calls with the recorded results',
    async (ctx) => {
      const label = word(ctx.seed, 'parents.history:label');
      const reply = word(ctx.seed, 'parents.history:reply', 13);
      const out = word(ctx.seed, 'parents.history:out', 10);
      const defs: BlockDef[] = [
        { plan: { text: reply, calls: [call(label, {}, { output: { v: out } })] } },
        { plan: { text: word(ctx.seed, 'parents.history:child', 9) } },
      ];
      const sc = scenario(ctx.seed, 'parents.history', defs);
      (sc.raw.blocks[1] as Record<string, unknown>).parent = sc.ids[0];
      const { log } = await play(ctx, sc);
      const seen = dumped(log.turns[1]?.messages);
      return expectAll([
        [seen.includes(reply), say(D_PARENT, 'the parent reply is in the child history', 'it is not there')],
        [
          seen.includes(out),
          say(D_PARENT, 'the parent tool result is in the child history', 'it is not there'),
        ],
      ]);
    },
  );

  item(
    'parents.roots-are-independent',
    2,
    3,
    CORE,
    'Two roots of one spec do not see each other, shortcut: the history of the blocks written before is carried',
    'once a spec declares a parent link, each root starts at the spec defaults and a child inherits only its ancestors',
    async (ctx) => {
      const defs: BlockDef[] = [
        { plan: { text: word(ctx.seed, 'parents.roots:a', 9) } },
        { plan: { text: word(ctx.seed, 'parents.roots:b', 9) } },
        { plan: { text: word(ctx.seed, 'parents.roots:c', 9) } },
      ];
      const sc = scenario(ctx.seed, 'parents.roots', defs);
      (sc.raw.blocks[2] as Record<string, unknown>).parent = sc.ids[0];
      const { log } = await play(ctx, sc);
      const turnOf = (index: number) => log.turns.find((t) => t.user.includes(sc.users[index] as string));
      const b = dumped(turnOf(1)?.messages);
      const c = dumped(turnOf(2)?.messages);
      return expectAll([
        [
          !b.includes(sc.users[0] as string),
          say(
            D_PARENT,
            'the second root does not see the first root',
            'the first root user message is in its history',
          ),
        ],
        [
          c.includes(sc.users[0] as string) && !c.includes(sc.users[1] as string),
          say(
            D_PARENT,
            'the child sees its parent and not the other root',
            `history holds parent ${c.includes(sc.users[0] as string)}, other root ${c.includes(sc.users[1] as string)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'parents.siblings-do-not-share-variables',
    2,
    4,
    CORE,
    'Variables set by one child are not seen by its sibling, shortcut: one shared mutable state for the whole spec',
    'world and variables are copied, so siblings cannot change each other start',
    async (ctx) => {
      const [kp, ks] = ['p', 's'].map((t) => word(ctx.seed, `parents.siblings:key:${t}`)) as [string, string];
      const [vp, vs] = ['p', 's'].map((t) => word(ctx.seed, `parents.siblings:val:${t}`, 10)) as [
        string,
        string,
      ];
      const defs: BlockDef[] = [
        { given: { vars: { [kp]: vp } }, plan: { text: word(ctx.seed, 'parents.siblings:parent', 9) } },
        { given: { vars: { [ks]: vs } }, plan: { text: word(ctx.seed, 'parents.siblings:left', 9) } },
        { plan: { text: word(ctx.seed, 'parents.siblings:right', 9) } },
      ];
      const sc = scenario(ctx.seed, 'parents.siblings', defs);
      (sc.raw.blocks[1] as Record<string, unknown>).parent = sc.ids[0];
      (sc.raw.blocks[2] as Record<string, unknown>).parent = sc.ids[0];
      const { log } = await play(ctx, sc);
      const turnOf = (index: number) => log.turns.find((t) => t.user.includes(sc.users[index] as string));
      const right = dumped(turnOf(2)?.vars);
      const left = dumped(turnOf(1)?.vars);
      return expectAll([
        [
          right.includes(vp),
          say(D_PARENT, 'a child inherits the variables of its parent', `right child variables ${right}`),
        ],
        [
          !right.includes(vs),
          say(
            D_PARENT,
            'a child does not see the variables its sibling set',
            `right child variables ${right}`,
          ),
        ],
        [
          left.includes(vp) && left.includes(vs),
          say(
            D_PARENT,
            'the child merges its own Given onto the inherited one',
            `left child variables ${left}`,
          ),
        ],
      ]);
    },
  );

  item(
    'parents.shared-parent-runs-once',
    2,
    3,
    CORE,
    'A parent shared by several children runs once per run, shortcut: the parent is replayed for each child',
    'a passed parent runs once per run, however many children share it',
    async (ctx) => {
      const n = between(rngFor(ctx.seed, 'adv:parents.once'), 2, 4);
      const defs: BlockDef[] = [
        { plan: { text: word(ctx.seed, 'parents.once:parent', 9) } },
        ...times(n, (i) => ({ plan: { text: word(ctx.seed, `parents.once:child:${i}`, 9) } })),
      ];
      const sc = scenario(ctx.seed, 'parents.once', defs);
      for (let i = 1; i <= n; i += 1) (sc.raw.blocks[i] as Record<string, unknown>).parent = sc.ids[0];
      const { log, rec } = await play(ctx, sc);
      const parentTurns = log.turns.filter((t) => t.user.includes(sc.users[0] as string)).length;
      return expectAll([
        [
          parentTurns === 1,
          say(D_PARENT, `the parent is sent to the agent once for ${n} children`, `${parentTurns} times`),
        ],
        [rec.blocks.length === n + 1, say(D_PARENT, `${n + 1} blocks are recorded`, `${rec.blocks.length}`)],
      ]);
    },
  );

  item(
    'parents.failed-parent-blocks-its-child',
    2,
    3,
    CORE,
    'A failed parent blocks its child, which is never sent and adds no failure, while an independent root still runs, shortcut: the child fails too or runs anyway',
    'if a parent fails, the child is blocked: it receives no agent call and adds no failure; independent roots continue',
    async (ctx) => {
      const label = word(ctx.seed, 'parents.blocked:label');
      const defs: BlockDef[] = [
        {
          expect: { tools: [{ label, count: 1 }] },
          plan: { text: word(ctx.seed, 'parents.blocked:parent', 9) },
        },
        { plan: { text: word(ctx.seed, 'parents.blocked:child', 9) } },
        { plan: { text: word(ctx.seed, 'parents.blocked:root', 9) } },
      ];
      const sc = scenario(ctx.seed, 'parents.blocked', defs);
      (sc.raw.blocks[1] as Record<string, unknown>).parent = sc.ids[0];
      const { rec, log } = await play(ctx, sc);
      const status = (index: number) => {
        const b = rec.blocks.find((x) => x.blockId === sc.ids[index]);
        return b ? statusOf(ctx.product, b) : 'absent';
      };
      return expectAll([
        [
          status(0) === 'fail',
          say(D_PARENT, 'the parent, missing its expected call, fails', `status ${status(0)}`),
        ],
        [
          status(1) === 'blocked',
          say(D_PARENT, 'the child of a failed parent is blocked', `status ${status(1)}`),
        ],
        [
          status(2) === 'pass',
          say(D_PARENT, 'an independent root continues and passes', `status ${status(2)}`),
        ],
        [
          !log.turns.some((t) => t.user.includes(sc.users[1] as string)),
          say(D_PARENT, 'the blocked child is never sent to the agent', 'it was sent'),
        ],
      ]);
    },
  );

  item(
    'parents.blocked-names-direct-parent-and-root',
    2,
    4,
    CORE,
    'A blocked grandchild names its direct parent in by and the original cause in root, shortcut: both name the same block',
    'blocked.by names the direct parent and blocked.root names the original failed or unrun cause',
    async (ctx) => {
      const label = word(ctx.seed, 'parents.chain:label');
      const defs: BlockDef[] = [
        { expect: { tools: [{ label, count: 1 }] }, plan: { text: word(ctx.seed, 'parents.chain:root', 9) } },
        { plan: { text: word(ctx.seed, 'parents.chain:mid', 9) } },
        { plan: { text: word(ctx.seed, 'parents.chain:leaf', 9) } },
      ];
      const sc = scenario(ctx.seed, 'parents.chain', defs);
      (sc.raw.blocks[1] as Record<string, unknown>).parent = sc.ids[0];
      (sc.raw.blocks[2] as Record<string, unknown>).parent = sc.ids[1];
      const { rec } = await play(ctx, sc);
      const leaf = rec.blocks.find((x) => x.blockId === sc.ids[2]);
      const mid = rec.blocks.find((x) => x.blockId === sc.ids[1]);
      return expectAll([
        [
          mid?.blocked?.by === sc.ids[0] && mid?.blocked?.root === sc.ids[0],
          say(D_PARENT, 'the child names the failed block as by and root', dumped(mid?.blocked)),
        ],
        [
          leaf?.blocked?.by === sc.ids[1],
          say(D_PARENT, 'the grandchild names its direct parent as by', dumped(leaf?.blocked)),
        ],
        [
          leaf?.blocked?.root === sc.ids[0],
          say(D_PARENT, 'the grandchild names the original failed block as root', dumped(leaf?.blocked)),
        ],
      ]);
    },
  );

  item(
    'parents.unrun-parent-blocks-its-child',
    2,
    4,
    CORE,
    'A parent that is not_run blocks its child and the root names it, shortcut: only a failed parent blocks',
    'if a parent is not_run, the child is blocked and blocked.root names the unrun cause',
    async (ctx) => {
      const label = word(ctx.seed, 'parents.unrun:label');
      const defs: BlockDef[] = [
        {
          given: { world: { tools: { [label]: { result: { ok: true } } } } },
          plan: { text: word(ctx.seed, 'parents.unrun:parent', 9) },
        },
        { plan: { text: word(ctx.seed, 'parents.unrun:child', 9) } },
      ];
      const sc = scenario(ctx.seed, 'parents.unrun', defs);
      (sc.raw.blocks[1] as Record<string, unknown>).parent = sc.ids[0];
      const { rec, log } = await play(ctx, sc, { capabilities: { toolStubs: false } });
      const parent = rec.blocks.find((x) => x.blockId === sc.ids[0]);
      const child = rec.blocks.find((x) => x.blockId === sc.ids[1]);
      return expectAll([
        [
          parent !== undefined && statusOf(ctx.product, parent) === 'not_run',
          say(
            D_PARENT,
            'the parent whose Given the adapter cannot apply is not_run',
            `status ${parent ? statusOf(ctx.product, parent) : 'absent'}`,
          ),
        ],
        [
          child !== undefined && statusOf(ctx.product, child) === 'blocked',
          say(D_PARENT, 'its child is blocked', `status ${child ? statusOf(ctx.product, child) : 'absent'}`),
        ],
        [
          child?.blocked?.root === sc.ids[0],
          say(D_PARENT, 'blocked.root names the unrun parent', dumped(child?.blocked)),
        ],
        [
          log.turns.length === 0,
          say(D_PARENT, 'neither block reaches the agent', `${log.turns.length} turns`),
        ],
      ]);
    },
  );

  item(
    'parents.teacher-forced-child-uses-the-recorded-parent',
    2,
    4,
    CORE,
    'In mode T a parent-linked child starts from the parent recorded end state, shortcut: the canonical blank replay of the sequential case',
    'once a spec declares a parent link, its blocks form a forest in every mode, a child starting from its parent recorded conversation',
    async (ctx) => {
      const reply = word(ctx.seed, 'parents.t:reply', 13);
      const defs: BlockDef[] = [
        { plan: { text: reply } },
        { plan: { text: word(ctx.seed, 'parents.t:child', 9) } },
      ];
      const sc = scenario(ctx.seed, 'parents.t', defs);
      (sc.raw.blocks[1] as Record<string, unknown>).parent = sc.ids[0];
      const { log } = await play(ctx, sc, { mode: 'T' });
      const child = log.turns.find((t) => t.user.includes(sc.users[1] as string));
      return dumped(child?.messages).includes(reply)
        ? PASS
        : fail(
            say(
              D_PARENT,
              'in mode T the child history holds the parent actual reply',
              'only the canonical history reached the agent',
            ),
          );
    },
  );

  item(
    'parents.child-prefix-replaces-the-inherited-conversation',
    2,
    4,
    CORE,
    'A child own prefix replaces the inherited conversation, shortcut: the prefix is added after the parent turns',
    'the child own given.prefix replaces the inherited conversation',
    async (ctx) => {
      const reply = word(ctx.seed, 'parents.prefix:reply', 13);
      const prefixUser = word(ctx.seed, 'parents.prefix:pu', 11);
      const prefixAssistant = word(ctx.seed, 'parents.prefix:pa', 11);
      const defs: BlockDef[] = [
        { plan: { text: reply } },
        {
          given: {
            prefix: [
              { role: 'user', content: prefixUser },
              { role: 'assistant', content: prefixAssistant },
            ],
          },
          plan: { text: word(ctx.seed, 'parents.prefix:child', 9) },
        },
      ];
      const sc = scenario(ctx.seed, 'parents.prefix', defs);
      (sc.raw.blocks[1] as Record<string, unknown>).parent = sc.ids[0];
      const { log } = await play(ctx, sc);
      const child = log.turns.find((t) => t.user.includes(sc.users[1] as string));
      const seen = dumped(child?.messages);
      return expectAll([
        [
          seen.includes(prefixUser) && seen.includes(prefixAssistant),
          say(D_PARENT, 'the child history holds its own prefix', 'the prefix is missing'),
        ],
        [
          !seen.includes(reply) && !seen.includes(sc.users[0] as string),
          say(
            D_PARENT,
            'the parent turns are replaced, not kept',
            'the parent conversation is still in the history',
          ),
        ],
      ]);
    },
  );

  const D_ERR = 'docs/reference/spec.md "Spec errors" (PARENT_MISSING, PARENT_CYCLE)';
  item(
    'parents.refusals-and-their-twins',
    2,
    4,
    CORE,
    'A parent that names no block and a cycle are refused with their codes while a forward reference and a chain load, shortcut: refusal by the shape of the key',
    'PARENT_MISSING and PARENT_CYCLE are spec errors; a forward reference to an existing block is valid',
    async (ctx) => {
      const build = (parents: (string | undefined)[]): RawSpec => {
        const sc = scenario(
          ctx.seed,
          `parents.refusals:${parents.join('|')}`,
          parents.map((_, i) => ({ plan: { text: word(ctx.seed, `parents.refusals:r${i}`, 8) } })),
        );
        parents.forEach((p, i) => {
          if (p !== undefined)
            (sc.raw.blocks[i] as Record<string, unknown>).parent =
              p === '#self' ? sc.ids[i] : p.startsWith('#') ? sc.ids[Number(p.slice(1))] : p;
        });
        return sc.raw;
      };
      const ghost = word(ctx.seed, 'parents.refusals:other', 9);
      const forward = loadIssues(ctx.product, build(['#1', undefined]));
      const chain = loadIssues(ctx.product, build([undefined, '#0', '#1']));
      const missing = loadIssues(ctx.product, build([undefined, ghost]));
      const cycle = loadIssues(ctx.product, build(['#1', '#0']));
      const self = loadIssues(ctx.product, build(['#self']));
      return expectAll([
        [
          forward.ok,
          say(D_ERR, 'a forward reference to an existing block loads', `codes ${forward.codes.join(',')}`),
        ],
        [chain.ok, say(D_ERR, 'a chain of three loads', `codes ${chain.codes.join(',')}`)],
        [
          !missing.ok && missing.codes.includes('PARENT_MISSING'),
          say(
            D_ERR,
            'a parent naming no block is PARENT_MISSING',
            `ok ${missing.ok}, codes ${missing.codes.join(',')}`,
          ),
        ],
        [
          !cycle.ok && cycle.codes.includes('PARENT_CYCLE'),
          say(
            D_ERR,
            'two blocks naming each other are PARENT_CYCLE',
            `ok ${cycle.ok}, codes ${cycle.codes.join(',')}`,
          ),
        ],
        [
          !self.ok && self.codes.includes('PARENT_CYCLE'),
          say(D_ERR, 'a block naming itself is PARENT_CYCLE', `ok ${self.ok}, codes ${self.codes.join(',')}`),
        ],
      ]);
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 7: the blast radius, through the command line (docs/concepts/blast-radius.md,
 * packages/cli/help/authoring-blast-radius.md)
 * ---------------------------------------------------------------------------------------------------- */

const D_RADIUS = 'packages/cli/help/authoring-blast-radius.md';

type RadiusBlock = {
  id: string;
  index: number;
  scored: boolean;
  why: string[];
  state: Record<string, string>;
};
type RadiusJson = {
  whole: unknown;
  specs: { specId: string; blocks: RadiusBlock[]; cells: { mode: string; in: boolean }[] }[];
  totals: Record<
    string,
    {
      in: number;
      direct: number;
      forward: number;
      out: number;
      total: number;
      unknown: number;
      cells: { in: number; total: number };
      sent: number;
    }
  >;
};
type RadiusRun = { code: number; json: RadiusJson | undefined; out: string; err: string };

type Manifest = { from: string; to: string; changes: Record<string, unknown>[] };

/** Writes the specs and the manifest in a fresh folder of inputs only and runs `radius --json` there. */
async function radius(
  ctx: ItemContext,
  tag: string,
  specs: Record<string, unknown>[],
  manifest: Manifest | Record<string, unknown>,
  modes: string,
): Promise<RadiusRun> {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(ctx.scratch, `radius-${word(ctx.seed, `radius:${tag}:dir`, 10)}`);
  mkdirSync(join(dir, 'in'), { recursive: true });
  for (const [index, spec] of specs.entries())
    writeFileSync(
      join(dir, 'in', `${word(ctx.seed, `radius:${tag}:file:${index}`, 8)}.yaml`),
      JSON.stringify(spec),
    );
  writeFileSync(join(dir, `${word(ctx.seed, `radius:${tag}:manifest`, 8)}.json`), JSON.stringify(manifest));
  const manifestFile = `${word(ctx.seed, `radius:${tag}:manifest`, 8)}.json`;
  const result = await ctx.product.cli(
    ['radius', 'in', '--change', manifestFile, '--mode', modes, '--json'],
    dir,
  );
  let json: RadiusJson | undefined;
  try {
    json = JSON.parse(result.out) as RadiusJson;
  } catch {
    json = undefined;
  }
  return { code: result.code, json, out: result.out, err: result.err };
}

const known = (): Record<string, unknown> => ({ depends: {} });

/** A hand-written spec whose dependencies are known (an empty metadata.depends) and whose blocks each expect one thing. */
function radiusSpec(
  seed: number,
  tag: string,
  blocks: {
    expect?: Record<string, unknown>;
    user?: string;
    given?: Record<string, unknown>;
    injection?: { class: string; user: string };
  }[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: word(seed, `radiusspec:${tag}`, 8),
    metadata: known(),
    ...extra,
    blocks: blocks.map((b, i) => ({
      id: word(seed, `radiusspec:${tag}:b${i}`, 6),
      ...(b.injection
        ? { when: { injection: b.injection } }
        : { user: b.user ?? word(seed, `radiusspec:${tag}:u${i}`, 10) }),
      ...(b.given ? { given: b.given } : {}),
      ...(b.expect ? { expect: b.expect } : {}),
    })),
  };
}

function radiusItems(): void {
  const manifest = (seed: number, tag: string, changes: Record<string, unknown>[]): Manifest => ({
    from: word(seed, `${tag}:from`, 5),
    to: word(seed, `${tag}:to`, 5),
    changes,
  });
  const orderedSpecs = (run: RadiusRun, specs: Record<string, unknown>[]) => {
    // The JSON lists the specs in an order of its own: find each by its id.
    const byId = new Map((run.json?.specs ?? []).map((s) => [s.specId, s]));
    return specs.map((s) => byId.get(s.id as string));
  };
  const stateVector = (spec: ReturnType<typeof orderedSpecs>[number], mode: string) =>
    spec?.blocks.map((b) => b.state[mode] ?? '?').join(',') ?? 'absent';

  item(
    'radius.stage-direct-and-forward',
    7,
    3,
    RADIUS,
    'A stage change makes the blocks that expect the stage direct and, in F, every later block forward, while T has no forward, shortcut: first block, last block, a name match or a forward rule for all modes',
    'a stage change selects the blocks that expect the stage; in mode F every block after the first direct one is forward, in mode T none is',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:radius.stage');
      const n = 5;
      const at = between(rng, 1, n - 2);
      const stage = word(ctx.seed, 'radius.stage:stage', 7);
      const other = word(ctx.seed, 'radius.stage:other', 7);
      const spec = radiusSpec(
        ctx.seed,
        'stage',
        times(n, (i) => ({
          expect: { stage: i === at ? stage : other },
          // A decoy: the user turn of another block says the stage name without expecting it.
          user: i === (at + 1) % n ? `${word(ctx.seed, 'radius.stage:decoy', 6)} ${stage}` : undefined,
        })),
        { stages: [stage, other] },
      );
      const quiet = radiusSpec(
        ctx.seed,
        'stage-none',
        times(3, () => ({ expect: { stage: other } })),
        { stages: [stage, other] },
      );
      const run1 = await radius(
        ctx,
        'stage',
        [spec, quiet],
        manifest(ctx.seed, 'stage', [{ kind: 'stage', id: stage }]),
        'F,T',
      );
      if (!run1.json)
        return fail(
          say(
            D_RADIUS,
            'radius --json prints one JSON document',
            `exit ${run1.code}: ${run1.out.slice(0, 120)} ${run1.err.slice(0, 120)}`,
          ),
        );
      const [s, q] = orderedSpecs(run1, [spec, quiet]);
      const wantF = times(n, (i) => (i < at ? 'out' : i === at ? 'direct' : 'forward')).join(',');
      const wantT = times(n, (i) => (i === at ? 'direct' : 'out')).join(',');
      return expectAll([
        [stateVector(s, 'F') === wantF, say(D_RADIUS, `mode F: ${wantF}`, stateVector(s, 'F'))],
        [stateVector(s, 'T') === wantT, say(D_RADIUS, `mode T: ${wantT}`, stateVector(s, 'T'))],
        [
          stateVector(q, 'F') === 'out,out,out',
          say(
            D_RADIUS,
            'a spec with no block at the stage is out (its dependencies are known)',
            stateVector(q, 'F'),
          ),
        ],
        [
          run1.code === 0,
          say(D_RADIUS, 'exit 0 when the radius is smaller than the suite', `exit ${run1.code}`),
        ],
      ]);
    },
  );

  item(
    'radius.perturbed-forward-from-the-injection',
    7,
    5,
    RADIUS,
    'In mode P the change enters at the block after the first direct one or at the inject_at of a perturbation, shortcut: P is read as F or as T',
    'the P forward rule starts the forward blocks after the first direct block (or at the inject_at of a perturbation the change reaches)',
    async (ctx) => {
      const n = 5;
      const at = 2;
      const stage = word(ctx.seed, 'radius.p:stage', 7);
      const other = word(ctx.seed, 'radius.p:other', 7);
      const spec = radiusSpec(
        ctx.seed,
        'p',
        times(n, (i) => ({ expect: { stage: i === at ? stage : other } })),
        { stages: [stage, other] },
      );
      const run1 = await radius(
        ctx,
        'p',
        [spec],
        manifest(ctx.seed, 'p', [{ kind: 'stage', id: stage }]),
        'P',
      );
      if (!run1.json)
        return fail(
          say(
            D_RADIUS,
            'radius --json prints one JSON document',
            `exit ${run1.code}: ${run1.out.slice(0, 160)}`,
          ),
        );
      const [s] = orderedSpecs(run1, [spec]);
      const want = times(n, (i) => (i < at ? 'out' : i === at ? 'direct' : 'forward')).join(',');
      return stateVector(s, 'P') === want
        ? PASS
        : fail(say(D_RADIUS, `mode P: ${want}`, stateVector(s, 'P')));
    },
  );

  // Tool changes by part, each on its own spec so the "given up to this block" reads of one block do not reach another.
  const toolPart = (part: string | undefined, want: Record<string, boolean>): void => {
    item(
      `radius.tool-${part ?? 'no-part'}`,
      7,
      4,
      RADIUS,
      `A tool change ${part ? `with part ${part}` : 'with no part'} selects exactly the documented blocks, shortcut: one rule for every part, or every block that mentions the tool`,
      `a tool change with part ${part ?? 'none'} selects the blocks the documentation lists for that part and no other`,
      async (ctx) => {
        const tool = word(ctx.seed, 'radius.tool:tool', 8);
        const field = word(ctx.seed, 'radius.tool:field', 6);
        const cases: [string, Record<string, unknown>, boolean][] = [
          [
            'called',
            radiusSpec(ctx.seed, 'tool:called', [{ expect: { tools: [{ label: tool, count: 1 }] } }]),
            (part === 'input' ||
              part === 'result' ||
              part === undefined ||
              part === 'description' ||
              part === 'presence') &&
              want.called === true,
          ],
          [
            'listed-zero',
            radiusSpec(ctx.seed, 'tool:zero', [{ expect: { tools: [{ label: tool, count: 0 }] } }]),
            want.zero === true,
          ],
          [
            'asserts-input',
            radiusSpec(ctx.seed, 'tool:input', [
              { expect: { tools: [{ label: tool, count: 1, input: { [field]: word(ctx.seed, 'v') } }] } },
            ]),
            want.input === true,
          ],
          [
            'forced',
            radiusSpec(ctx.seed, 'tool:forced', [
              {
                given: { world: { tools: { [tool]: { result: { ok: true } } } } },
                expect: { must: [word(ctx.seed, 'm')] },
              },
            ]),
            want.forced === true,
          ],
          [
            'unrelated',
            radiusSpec(ctx.seed, 'tool:unrelated', [{ expect: { must: [word(ctx.seed, 'm2')] } }]),
            false,
          ],
        ];
        const specs = cases.map(([, spec]) => spec);
        const run1 = await radius(
          ctx,
          `tool-${part}`,
          specs,
          manifest(ctx.seed, 'tool', [{ kind: 'tool', id: tool, ...(part ? { part } : {}) }]),
          'T',
        );
        if (!run1.json)
          return fail(
            say(
              D_RADIUS,
              'radius --json prints one JSON document',
              `exit ${run1.code}: ${run1.out.slice(0, 160)}`,
            ),
          );
        const found = orderedSpecs(run1, specs);
        for (const [index, [name, , expected]] of cases.entries()) {
          const got = stateVector(found[index], 'T');
          if (got !== (expected ? 'direct' : 'out'))
            return fail(
              say(
                D_RADIUS,
                `a block that ${name} is ${expected ? 'direct' : 'out'} for a tool change ${part ?? 'with no part'}`,
                got,
              ),
            );
        }
        return PASS;
      },
    );
  };
  toolPart('input', { called: true, zero: false, input: true, forced: false });
  toolPart('result', { called: true, zero: false, input: true, forced: true });
  toolPart('description', { called: true, zero: true, input: true, forced: true });
  toolPart('presence', { called: true, zero: true, input: true, forced: true });
  toolPart(undefined, { called: true, zero: true, input: true, forced: true });

  item(
    'radius.deviation-whole-class-name',
    7,
    4,
    RADIUS,
    'A change to D1 selects D1 blocks and not D10, D11 or D12, shortcut: a prefix match on the class id',
    'a deviation change D1 selects the blocks that carry the class D1_<anything>, never D10, D11 or D12',
    async (ctx) => {
      const classes = ['D1_off_topic', 'D10_return', 'D11_pii_leak', 'D12_prompt_extraction'];
      const spec = radiusSpec(
        ctx.seed,
        'dev',
        classes.map((cls, i) => ({
          injection: { class: cls, user: word(ctx.seed, `radius.dev:inj:${i}`, 11) },
        })),
      );
      const asD1 = await radius(
        ctx,
        'dev-d1',
        [spec],
        manifest(ctx.seed, 'dev', [{ kind: 'deviation', id: 'D1' }]),
        'T',
      );
      const asD10 = await radius(
        ctx,
        'dev-d10',
        [spec],
        manifest(ctx.seed, 'dev', [{ kind: 'deviation', id: 'D10' }]),
        'T',
      );
      const full = await radius(
        ctx,
        'dev-full',
        [spec],
        manifest(ctx.seed, 'dev', [{ kind: 'deviation', id: 'D1_off_topic' }]),
        'T',
      );
      if (!asD1.json || !asD10.json || !full.json)
        return fail(
          say(
            D_RADIUS,
            'radius --json prints one JSON document',
            `exits ${asD1.code}/${asD10.code}/${full.code}`,
          ),
        );
      return expectAll([
        [
          stateVector(asD1.json.specs[0], 'T') === 'direct,out,out,out',
          say(D_RADIUS, 'D1 selects only the D1 block', stateVector(asD1.json.specs[0], 'T')),
        ],
        [
          stateVector(asD10.json.specs[0], 'T') === 'out,direct,out,out',
          say(D_RADIUS, 'D10 selects only the D10 block', stateVector(asD10.json.specs[0], 'T')),
        ],
        [
          stateVector(full.json.specs[0], 'T') === 'direct,out,out,out',
          say(
            D_RADIUS,
            'the full class name D1_off_topic selects the D1 block',
            stateVector(full.json.specs[0], 'T'),
          ),
        ],
      ]);
    },
  );

  item(
    'radius.unknown-deps-are-in-and-known-deps-are-out',
    7,
    3,
    RADIUS,
    'A hand-written spec with no metadata.depends is in every radius and one with depends is judged on what it carries, shortcut: every spec is in or every spec is out',
    'a block whose spec has no metadata.generated, no estate atoms and no metadata.depends is unknown and in every radius (reason unknown-deps)',
    async (ctx) => {
      const stage = word(ctx.seed, 'radius.unknown:stage', 7);
      const other = word(ctx.seed, 'radius.unknown:other', 7);
      const knownSpec = radiusSpec(
        ctx.seed,
        'unknown:known',
        [{ expect: { stage: other } }, { expect: { stage: other } }],
        { stages: [stage, other] },
      );
      const { metadata: _drop, ...bare } = radiusSpec(
        ctx.seed,
        'unknown:bare',
        [{ expect: { stage: other } }, { expect: { stage: other } }],
        { stages: [stage, other] },
      );
      void _drop;
      const run1 = await radius(
        ctx,
        'unknown',
        [
          knownSpec,
          bare,
          radiusSpec(ctx.seed, 'unknown:hit', [{ expect: { stage } }], { stages: [stage, other] }),
        ],
        manifest(ctx.seed, 'unknown', [{ kind: 'stage', id: stage }]),
        'T',
      );
      if (!run1.json)
        return fail(
          say(
            D_RADIUS,
            'radius --json prints one JSON document',
            `exit ${run1.code}: ${run1.out.slice(0, 160)}`,
          ),
        );
      const [k, b] = orderedSpecs(run1, [knownSpec, bare]);
      const totals = run1.json.totals.T;
      return expectAll([
        [
          stateVector(k, 'T') === 'out,out',
          say(D_RADIUS, 'the spec with known dependencies and no match is out', stateVector(k, 'T')),
        ],
        [
          stateVector(b, 'T') === 'direct,direct',
          say(D_RADIUS, 'the spec with unknown dependencies is direct in every radius', stateVector(b, 'T')),
        ],
        [
          b?.blocks.every((x) => x.why.includes('unknown-deps')) === true,
          say(
            D_RADIUS,
            'the reason of an unknown block is unknown-deps',
            dumped(b?.blocks.map((x) => x.why)),
          ),
        ],
        [
          totals?.unknown === 2,
          say(D_RADIUS, 'totals.T.unknown counts the two unknown blocks', `unknown ${totals?.unknown}`),
        ],
      ]);
    },
  );

  item(
    'radius.whole-suite-for-unmappable-changes',
    7,
    3,
    RADIUS,
    'A model, agent, global, reply_language, unknown-kind or id-less change is the whole suite and exits 1 while a narrow twin exits 0, shortcut: the kind name is matched loosely or the whole suite is never reported',
    'a change the radius cannot map makes the radius the whole suite: whole is set and the exit is 1',
    async (ctx) => {
      const stage = word(ctx.seed, 'radius.whole:stage', 7);
      const other = word(ctx.seed, 'radius.whole:other', 7);
      const spec = radiusSpec(ctx.seed, 'whole', [{ expect: { stage } }, { expect: { stage: other } }], {
        stages: [stage, other],
      });
      const rows: [Record<string, unknown>, boolean][] = [
        [{ kind: 'stage', id: stage }, false],
        [{ kind: 'model' }, true],
        [{ kind: 'agent' }, true],
        [{ kind: 'stage', id: stage, global: true }, true],
        [{ kind: 'rule', id: 'reply_language' }, true],
        [{ kind: word(ctx.seed, 'radius.whole:kind', 8), id: stage }, true],
        [{ kind: 'stage' }, true],
        [{ kind: 'tool' }, true],
        [{ kind: 'map', id: word(ctx.seed, 'radius.whole:nomap', 8) }, true],
      ];
      for (const [change, whole] of rows) {
        const result = await radius(
          ctx,
          `whole:${JSON.stringify(change)}`,
          [spec],
          manifest(ctx.seed, 'whole', [change]),
          'F',
        );
        const isWhole = result.json?.whole !== null && result.json?.whole !== undefined;
        if (!result.json || isWhole !== whole || result.code !== (whole ? 1 : 0))
          return fail(
            say(
              D_RADIUS,
              `${JSON.stringify(change)} ${whole ? 'is the whole suite (exit 1)' : 'is narrow (exit 0)'}`,
              `exit ${result.code}, whole ${dumped(result.json?.whole)}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'radius.change-no-block-declares',
    7,
    4,
    RADIUS,
    'A change no block names is the whole suite, a criterion included (docs/concepts/blast-radius.md, Unknown means in), shortcut: an unnamed change selects nothing',
    'a change no block declares makes the radius the whole suite, a criterion no block names included',
    async (ctx) => {
      const stage = word(ctx.seed, 'radius.nodecl:stage', 7);
      const spec = radiusSpec(ctx.seed, 'nodecl', [{ expect: { stage } }, { expect: { stage } }], {
        stages: [stage],
      });
      const tool = await radius(
        ctx,
        'nodecl-tool',
        [spec],
        manifest(ctx.seed, 'nodecl', [{ kind: 'tool', id: word(ctx.seed, 'radius.nodecl:tool', 8) }]),
        'F',
      );
      const stageOther = await radius(
        ctx,
        'nodecl-stage',
        [spec],
        manifest(ctx.seed, 'nodecl', [{ kind: 'stage', id: word(ctx.seed, 'radius.nodecl:stage2', 8) }]),
        'F',
      );
      const criterion = await radius(
        ctx,
        'nodecl-criterion',
        [spec],
        manifest(ctx.seed, 'nodecl', [{ kind: 'criterion', id: word(ctx.seed, 'radius.nodecl:crit', 8) }]),
        'F',
      );
      const wholeOf = (r: RadiusRun) => r.json?.whole !== null && r.json?.whole !== undefined;
      return expectAll([
        [
          wholeOf(tool) && tool.code === 1,
          say(
            D_RADIUS,
            'a tool no block names is the whole suite',
            `exit ${tool.code}, whole ${dumped(tool.json?.whole)}`,
          ),
        ],
        [
          wholeOf(stageOther) && stageOther.code === 1,
          say(
            D_RADIUS,
            'a stage no block names is the whole suite',
            `exit ${stageOther.code}, whole ${dumped(stageOther.json?.whole)}`,
          ),
        ],
        [
          wholeOf(criterion) && criterion.code === 1,
          say(
            D_RADIUS,
            'a criterion no block names is the whole suite (exit 1), as any change no block declares',
            `exit ${criterion.code}, whole ${dumped(criterion.json?.whole)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'radius.empty-and-version-only-manifests',
    7,
    3,
    RADIUS,
    'No change with equal versions is an empty radius and with different versions the whole suite, shortcut: the versions are not compared',
    'with from equal to to and no change the radius is empty; with different versions and no change it is the whole suite',
    async (ctx) => {
      const stage = word(ctx.seed, 'radius.versions:stage', 7);
      const spec = radiusSpec(ctx.seed, 'versions', [{ expect: { stage } }, { expect: { stage } }], {
        stages: [stage],
      });
      const v = word(ctx.seed, 'radius.versions:v', 5);
      const same = await radius(ctx, 'versions-same', [spec], { from: v, to: v, changes: [] }, 'F');
      const different = await radius(
        ctx,
        'versions-different',
        [spec],
        { from: v, to: `${v}x`, changes: [] },
        'F',
      );
      return expectAll([
        [
          same.json !== undefined &&
            same.code === 0 &&
            (same.json.totals.F?.in ?? -1) === 0 &&
            !same.json.whole,
          say(
            D_RADIUS,
            'equal versions and no change: nothing in the radius, exit 0',
            `exit ${same.code}, in ${same.json?.totals.F?.in}, whole ${dumped(same.json?.whole)}`,
          ),
        ],
        [
          different.code === 1 && different.json?.whole !== null && different.json?.whole !== undefined,
          say(
            D_RADIUS,
            'different versions and no change: the whole suite, exit 1',
            `exit ${different.code}, whole ${dumped(different.json?.whole)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'radius.manifest-validation-and-twin',
    7,
    3,
    CLI_RADIUS,
    'A manifest with an unknown key, a bad part or no version is refused with exit 2 and the same manifest without the fault runs, shortcut: key names are matched loosely or nothing is refused',
    'the change manifest is strict: an unknown key at any level, a bad part or a missing version is exit 2 and no radius',
    async (ctx) => {
      const stage = word(ctx.seed, 'radius.manifest:stage', 7);
      const spec = radiusSpec(ctx.seed, 'manifest', [{ expect: { stage } }], { stages: [stage] });
      const good = manifest(ctx.seed, 'manifest', [{ kind: 'stage', id: stage }]);
      const extraKey = word(ctx.seed, 'radius.manifest:key', 7);
      const rows: [Record<string, unknown>, number, string][] = [
        [good as unknown as Record<string, unknown>, 0, 'the valid manifest'],
        [{ ...good, [extraKey]: 1 }, 2, 'an unknown top-level key'],
        [
          { ...good, changes: [{ kind: 'stage', id: stage, [extraKey]: 1 }] },
          2,
          'an unknown key in a change',
        ],
        [
          {
            ...good,
            changes: [
              {
                kind: 'tool',
                id: word(ctx.seed, 'radius.manifest:tool'),
                part: word(ctx.seed, 'radius.manifest:part', 6),
              },
            ],
          },
          2,
          'a part that is not one of the four',
        ],
        [{ from: good.from, changes: good.changes }, 2, 'no "to"'],
        [
          { ...good, changes: [{ kind: 'tool', id: word(ctx.seed, 'radius.manifest:tool'), part: 'input' }] },
          1,
          'a valid part (whole suite, exit 1)',
        ],
      ];
      for (const [body, code, name] of rows) {
        const result = await radius(ctx, `manifest:${name}`, [spec], body, 'F');
        if (result.code !== code)
          return fail(
            say(
              D_RADIUS,
              `${name} exits ${code}`,
              `exit ${result.code}: ${result.out.slice(0, 100)}${result.err.slice(0, 100)}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'radius.rule-names-and-spec-rules',
    7,
    4,
    RADIUS,
    'A rule change for max_calls, forbidden_tools or lang_stable selects every block of the specs whose rules carry it and no other spec, shortcut: the rule name is matched against block text',
    'a rule change with a spec rule name selects the blocks of the specs whose rules carry it',
    async (ctx) => {
      const label = word(ctx.seed, 'radius.rules:label', 7);
      const carrying = radiusSpec(
        ctx.seed,
        'rules:carry',
        [{ expect: { must: [word(ctx.seed, 'a')] } }, { expect: { must: [word(ctx.seed, 'b')] } }],
        { rules: { max_calls: { [label]: 2 }, lang_stable: true } },
      );
      const plain = radiusSpec(ctx.seed, 'rules:plain', [{ expect: { must: [word(ctx.seed, 'c')] } }]);
      const decoy = radiusSpec(ctx.seed, 'rules:decoy', [
        { user: 'max_calls lang_stable forbidden_tools', expect: { must: [word(ctx.seed, 'd')] } },
      ]);
      const rows: [string, string, string, string][] = [
        ['max_calls', 'direct,direct', 'out', 'out'],
        ['lang_stable', 'direct,direct', 'out', 'out'],
        ['forbidden_tools', 'out,out', 'out', 'out'],
      ];
      for (const [rule, a, b, c] of rows) {
        const result = await radius(
          ctx,
          `rules:${rule}`,
          [carrying, plain, decoy],
          manifest(ctx.seed, 'rules', [{ kind: 'rule', id: rule }]),
          'T',
        );
        if (!result.json) {
          // A rule no spec carries is the whole suite: forbidden_tools is carried by none of them.
          if (rule === 'forbidden_tools' && result.code === 1) continue;
          return fail(
            say(
              D_RADIUS,
              'radius --json prints one JSON document',
              `exit ${result.code}: ${result.out.slice(0, 120)}`,
            ),
          );
        }
        if (rule === 'forbidden_tools') {
          if (result.code !== 1)
            return fail(say(D_RADIUS, 'a rule no spec carries is the whole suite', `exit ${result.code}`));
          continue;
        }
        const [x, y, z] = orderedSpecs(result, [carrying, plain, decoy]);
        const got = [stateVector(x, 'T'), stateVector(y, 'T'), stateVector(z, 'T')];
        if (got[0] !== a || got[1] !== b || got[2] !== c)
          return fail(say(D_RADIUS, `rule ${rule} gives ${a} / ${b} / ${c}`, got.join(' / ')));
      }
      return PASS;
    },
  );

  item(
    'radius.fixture-literal-in-the-stimulus',
    7,
    4,
    RADIUS,
    'A fixture change for a literal value selects the blocks whose When, expected tool inputs or Given hold it, shortcut: only named fixtures are read, or the value is matched in every block',
    'a fixture change selects blocks whose When, expected tool inputs, Given or end state hold the literal text',
    async (ctx) => {
      const literal = word(ctx.seed, 'radius.fixture:literal', 11);
      const label = word(ctx.seed, 'radius.fixture:tool', 7);
      const field = word(ctx.seed, 'radius.fixture:field', 6);
      const inStimulus = radiusSpec(ctx.seed, 'fixture:when', [
        { user: `${word(ctx.seed, 'p')} ${literal}` },
        { user: word(ctx.seed, 'q', 12) },
      ]);
      const inInput = radiusSpec(ctx.seed, 'fixture:input', [
        { expect: { tools: [{ label, count: 1, input: { [field]: literal } }] } },
      ]);
      const nowhere = radiusSpec(ctx.seed, 'fixture:none', [{ user: word(ctx.seed, 'r', 12) }]);
      const result = await radius(
        ctx,
        'fixture',
        [inStimulus, inInput, nowhere],
        manifest(ctx.seed, 'fixture', [{ kind: 'fixture', id: literal }]),
        'T',
      );
      if (!result.json)
        return fail(
          say(
            D_RADIUS,
            'radius --json prints one JSON document',
            `exit ${result.code}: ${result.out.slice(0, 120)}`,
          ),
        );
      const [a, b, c] = orderedSpecs(result, [inStimulus, inInput, nowhere]);
      return expectAll([
        [
          stateVector(a, 'T') === 'direct,out',
          say(D_RADIUS, 'only the block whose stimulus holds the value is direct', stateVector(a, 'T')),
        ],
        [
          stateVector(b, 'T') === 'direct',
          say(D_RADIUS, 'the block that asserts the value in a tool input is direct', stateVector(b, 'T')),
        ],
        [
          stateVector(c, 'T') === 'out',
          say(D_RADIUS, 'a block that never mentions the value is out', stateVector(c, 'T')),
        ],
      ]);
    },
  );

  item(
    'radius.criterion-by-name',
    7,
    3,
    RADIUS,
    'A criterion change selects the blocks whose criteria name it, with or without @gating, shortcut: a name match on the spec or any criterion',
    'a criterion change selects blocks whose expect.criteria name the criterion; the @gating suffix is not part of the name',
    async (ctx) => {
      const [named, other] = ['n', 'o'].map((t) => word(ctx.seed, `radius.criterion:${t}`, 9)) as [
        string,
        string,
      ];
      const defs = [named, other].map((name) => ({
        name,
        rubric: word(ctx.seed, `radius.criterion:rubric:${name}`, 12),
      }));
      const spec = radiusSpec(
        ctx.seed,
        'criterion',
        [
          { expect: { criteria: [`${named}@gating`] } },
          { expect: { criteria: [other] } },
          { expect: { criteria: [`${other}@gating`, named] } },
        ],
        { criteria: defs },
      );
      const result = await radius(
        ctx,
        'criterion',
        [spec],
        manifest(ctx.seed, 'criterion', [{ kind: 'criterion', id: named }]),
        'T',
      );
      if (!result.json)
        return fail(
          say(
            D_RADIUS,
            'radius --json prints one JSON document',
            `exit ${result.code}: ${result.out.slice(0, 120)}`,
          ),
        );
      const got = stateVector(result.json.specs[0], 'T');
      return got === 'direct,out,direct'
        ? PASS
        : fail(say(D_RADIUS, 'blocks 0 and 2 name the criterion, block 1 does not', got));
    },
  );

  item(
    'radius.totals-add-up',
    7,
    3,
    RADIUS,
    'The totals of a mode are the states of the blocks: in is direct plus forward, out the rest, sent counts the blocks of the cells in the radius, shortcut: totals computed from another count',
    'totals.<mode> reports in (direct plus forward), direct, forward, out, total, cells and sent consistently with the block states',
    async (ctx) => {
      const stage = word(ctx.seed, 'radius.totals:stage', 7);
      const other = word(ctx.seed, 'radius.totals:other', 7);
      const a = radiusSpec(
        ctx.seed,
        'totals:a',
        [
          { expect: { stage: other } },
          { expect: { stage } },
          { expect: { stage: other } },
          { expect: { stage: other } },
        ],
        { stages: [stage, other] },
      );
      const b = radiusSpec(
        ctx.seed,
        'totals:b',
        [{ expect: { stage: other } }, { expect: { stage: other } }],
        { stages: [stage, other] },
      );
      const result = await radius(
        ctx,
        'totals',
        [a, b],
        manifest(ctx.seed, 'totals', [{ kind: 'stage', id: stage }]),
        'F,T',
      );
      if (!result.json)
        return fail(
          say(
            D_RADIUS,
            'radius --json prints one JSON document',
            `exit ${result.code}: ${result.out.slice(0, 120)}`,
          ),
        );
      const f = result.json.totals.F;
      const t = result.json.totals.T;
      return expectAll([
        [
          f?.total === 6 && f.direct === 1 && f.forward === 2 && f.in === 3 && f.out === 3,
          say(D_RADIUS, 'mode F: total 6, direct 1, forward 2, in 3, out 3', dumped(f)),
        ],
        [
          t?.total === 6 && t.direct === 1 && t.forward === 0 && t.in === 1 && t.out === 5,
          say(D_RADIUS, 'mode T: total 6, direct 1, forward 0, in 1, out 5', dumped(t)),
        ],
        [
          f?.cells.in === 1 && f.cells.total === 2,
          say(D_RADIUS, 'mode F: 1 of 2 cells in the radius', dumped(f?.cells)),
        ],
        [
          f?.sent === 4,
          say(
            D_RADIUS,
            'mode F: a cell reruns whole, so the 4 blocks of the spec are sent',
            `sent ${f?.sent}`,
          ),
        ],
      ]);
    },
  );

  item(
    'radius.block-without-id-is-listed-by-index',
    7,
    2,
    CLI_RADIUS,
    'A block with no id is named block <index> in the explain lines, shortcut: the line is skipped or the index counts from 1',
    'a block with no id is shown as "block <index>" counting from 0',
    async (ctx) => {
      const stage = word(ctx.seed, 'radius.noid:stage', 7);
      const spec = radiusSpec(ctx.seed, 'noid', [{ expect: { stage } }, { expect: { stage } }], {
        stages: [stage],
      });
      for (const block of spec.blocks as Record<string, unknown>[]) delete block.id;
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const dir = join(ctx.scratch, `radius-${word(ctx.seed, 'radius.noid:dir', 10)}`);
      mkdirSync(join(dir, 'in'), { recursive: true });
      writeFileSync(join(dir, 'in', `${word(ctx.seed, 'radius.noid:file', 8)}.yaml`), JSON.stringify(spec));
      writeFileSync(
        join(dir, 'm.json'),
        JSON.stringify(manifest(ctx.seed, 'noid', [{ kind: 'stage', id: stage }])),
      );
      const result = await ctx.product.cli(
        ['radius', 'in', '--change', 'm.json', '--explain', '--mode', 'T'],
        dir,
      );
      const lines = result.out.split('\n');
      const has = (index: number) => lines.some((l) => l.includes(`${spec.id as string}/block ${index}:`));
      return has(0) && has(1) && !has(2)
        ? PASS
        : fail(
            say(
              D_RADIUS,
              '"block 0" and "block 1" are named in the explain lines',
              `explain lines: ${lines
                .filter((l) => l.includes('/'))
                .slice(0, 3)
                .join(' | ')}`,
            ),
          );
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 1: the loader (docs/reference/spec.md "Shorthand", "Stimulus"): every refusal has a valid twin
 * ---------------------------------------------------------------------------------------------------- */

function loaderItems(): void {
  const D_SPEC = 'docs/reference/spec.md';
  item(
    'loader.unknown-keys-need-a-valid-twin',
    1,
    3,
    CORE,
    'An unknown key is an error at every level of a spec while the same spec with a known key loads, shortcut: unknown keys ignored, or refused by the look of the key name',
    'an unknown key is an error in the spec, a block, an expect, a tool expectation and a given',
    async (ctx) => {
      const stranger = word(ctx.seed, 'loader.unknown:key', 8);
      const field = word(ctx.seed, 'loader.unknown:field', 6);
      const label = word(ctx.seed, 'loader.unknown:label', 7);
      const base = (): RawSpec => ({
        id: word(ctx.seed, 'loader.unknown:id', 8),
        blocks: [
          {
            id: word(ctx.seed, 'loader.unknown:b', 6),
            user: word(ctx.seed, 'loader.unknown:u', 9),
            given: { vars: { [field]: 1 } },
            expect: { tools: [{ label, count: 1 }], must: [word(ctx.seed, 'loader.unknown:m')] },
          },
        ],
      });
      const mutate = (where: string): RawSpec => {
        const spec = base();
        const block = spec.blocks[0] as Loose;
        if (where === 'spec') (spec as Record<string, unknown>)[stranger] = 1;
        if (where === 'block') block[stranger] = 1;
        if (where === 'expect') block.expect[stranger] = 1;
        if (where === 'tool') (block.expect.tools[0] as Record<string, unknown>)[stranger] = 1;
        if (where === 'given') block.given[stranger] = 1;
        return spec;
      };
      const twin = loadIssues(ctx.product, base());
      if (!twin.ok)
        return fail(say(D_SPEC, 'the spec without the stranger key loads', `codes ${twin.codes.join(',')}`));
      for (const where of ['spec', 'block', 'expect', 'tool', 'given']) {
        const result = loadIssues(ctx.product, mutate(where));
        if (result.ok)
          return fail(say(D_SPEC, `an unknown key in the ${where} is an error`, 'the loader accepted it'));
      }
      // A free-form map keeps any key: given.vars and metadata take names of their own.
      const free = base();
      ((free.blocks[0] as Loose).given.vars as Record<string, unknown>)[stranger] = 1;
      (free as Record<string, unknown>).metadata = { [stranger]: 1 };
      const freeResult = loadIssues(ctx.product, free);
      return freeResult.ok
        ? PASS
        : fail(
            say(D_SPEC, 'variables and metadata are maps of any key', `codes ${freeResult.codes.join(',')}`),
          );
    },
  );

  item(
    'loader.stimulus-is-exactly-one',
    1,
    3,
    CORE,
    'A block takes exactly one of user, burst and when, and a burst needs two messages, shortcut: the first key found wins or a burst of one is accepted',
    'a block with two stimuli, none, or a burst of one message is refused; a burst of two and a single user load',
    async (ctx) => {
      const one = word(ctx.seed, 'loader.stimulus:a', 9);
      const two = word(ctx.seed, 'loader.stimulus:b', 9);
      const spec = (block: Record<string, unknown>): RawSpec => ({
        id: word(ctx.seed, 'loader.stimulus:id', 8),
        blocks: [{ id: word(ctx.seed, 'loader.stimulus:b', 6), ...block }],
      });
      const rows: [Record<string, unknown>, boolean, string][] = [
        [{ user: one }, true, 'one user'],
        [{ burst: [one, two] }, true, 'a burst of two'],
        [{ user: one, burst: [one, two] }, false, 'a user and a burst'],
        [{ burst: [one] }, false, 'a burst of one'],
        [{}, false, 'no stimulus'],
        [
          { user: one, when: { injection: { class: 'D1_off_topic', user: two } } },
          false,
          'a user and an injection',
        ],
      ];
      for (const [block, ok, name] of rows) {
        const result = loadIssues(ctx.product, spec(block));
        if (result.ok !== ok)
          return fail(
            say(
              `${D_SPEC} "Stimulus"`,
              `${name} ${ok ? 'loads' : 'is refused'}`,
              `ok ${result.ok}, codes ${result.codes.join(',')}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'loader.stage-must-name-a-declared-stage',
    1,
    3,
    CORE,
    'expect.stage must be one of the declared stages, shortcut: any string is a stage or the catalogue is not read',
    'expect.stage and recovery.stage_after must name one of the spec stages',
    async (ctx) => {
      const [s1, s2, s3] = ['a', 'b', 'c'].map((t) => word(ctx.seed, `loader.stage:${t}`, 7)) as [
        string,
        string,
        string,
      ];
      const spec = (stage: string, stages: string[] | undefined): RawSpec => ({
        id: word(ctx.seed, 'loader.stage:id', 8),
        ...(stages ? { stages } : {}),
        blocks: [{ user: word(ctx.seed, 'loader.stage:u', 9), expect: { stage } }],
      });
      const declared = loadIssues(ctx.product, spec(s2, [s1, s2]));
      const undeclared = loadIssues(ctx.product, spec(s3, [s1, s2]));
      return expectAll([
        [declared.ok, say(D_SPEC, 'a declared stage loads', `codes ${declared.codes.join(',')}`)],
        [
          !undeclared.ok,
          say(
            D_SPEC,
            '"expect.stage must name one of these": a stage outside the catalogue is refused',
            'the loader accepted it',
          ),
        ],
      ]);
    },
  );

  item(
    'loader.shorthand-equals-the-long-form',
    1,
    3,
    CORE,
    'ledger_seed, workspace_seed and a user key on a block mean given.ledger, given.world.workspace and when.user, shortcut: the shorthand is dropped',
    'the loader rewrites the shorthand forms before it validates: the resolved spec equals the long form',
    async (ctx) => {
      const ledgerKey = word(ctx.seed, 'loader.shorthand:key', 6);
      const ledgerVal = word(ctx.seed, 'loader.shorthand:val', 8);
      const folder = word(ctx.seed, 'loader.shorthand:folder', 8);
      const user = word(ctx.seed, 'loader.shorthand:user', 9);
      const id = word(ctx.seed, 'loader.shorthand:id', 8);
      const bid = word(ctx.seed, 'loader.shorthand:b', 6);
      const short: RawSpec = {
        id,
        ledger_seed: { [ledgerKey]: ledgerVal },
        workspace_seed: folder,
        blocks: [{ id: bid, user }],
      };
      const long: RawSpec = {
        id,
        kind: 'conversation',
        given: { ledger: { [ledgerKey]: ledgerVal }, world: { workspace: { from: folder } } },
        blocks: [{ id: bid, when: { user } }],
      };
      const a = load(ctx.product, short);
      const b = load(ctx.product, long);
      return dumped(a.given) === dumped(b.given) &&
        dumped(a.blocks) === dumped(b.blocks) &&
        a.kind === 'conversation'
        ? PASS
        : fail(
            say(
              `${D_SPEC} "Shorthand"`,
              'the shorthand spec resolves to the long form (given, blocks, kind)',
              `given ${dumped(a.given).slice(0, 120)} vs ${dumped(b.given).slice(0, 120)}`,
            ),
          );
    },
  );

  item(
    'loader.origin-needs-a-prefix',
    1,
    3,
    CORE,
    'given.origin without a prefix on the same block is refused with its code while the same block with a prefix loads, shortcut: origin is read alone',
    'GIVEN_ORIGIN_WITHOUT_PREFIX: origin needs a prefix on the same block',
    async (ctx) => {
      const spec = (given: Record<string, unknown>): RawSpec => ({
        id: word(ctx.seed, 'loader.origin:id', 8),
        blocks: [{ user: word(ctx.seed, 'loader.origin:u', 9), given }],
      });
      const prefix = [{ role: 'user', content: word(ctx.seed, 'loader.origin:p', 9) }];
      const withPrefix = loadIssues(ctx.product, spec({ origin: 'authored', prefix }));
      const alone = loadIssues(ctx.product, spec({ origin: 'authored' }));
      const wrongValue = loadIssues(
        ctx.product,
        spec({ origin: word(ctx.seed, 'loader.origin:v', 8), prefix }),
      );
      return expectAll([
        [
          withPrefix.ok,
          say(
            'docs/concepts/given-when-then.md "Given"',
            'origin with a prefix loads',
            `codes ${withPrefix.codes.join(',')}`,
          ),
        ],
        [
          !alone.ok && alone.codes.includes('GIVEN_ORIGIN_WITHOUT_PREFIX'),
          say(
            'docs/concepts/given-when-then.md "Given"',
            'origin without a prefix is GIVEN_ORIGIN_WITHOUT_PREFIX',
            `ok ${alone.ok}, codes ${alone.codes.join(',')}`,
          ),
        ],
        [
          !wrongValue.ok,
          say(
            'docs/reference/spec.md "GivenOrigin"',
            'an origin other than authored, recorded or canonical is refused',
            'the loader accepted it',
          ),
        ],
      ]);
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 3: rule files and objects, through `driftbench object` (packages/cli/help/core-objects.md,
 * docs/reference/objects.md). Every refusal item has a twin that loads.
 * ---------------------------------------------------------------------------------------------------- */

const D_OBJECTS = 'packages/cli/help/core-objects.md';
const OBJ_KIND = 'policy/value-check';

/** A project folder of inputs only: the files are written as JSON, which a YAML reader reads. */
async function projectFolder(ctx: ItemContext, tag: string, files: Record<string, unknown>): Promise<string> {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const dir = join(ctx.scratch, `project-${word(ctx.seed, `project:${tag}`, 10)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'driftbench.yaml'), JSON.stringify({ campaign: { repeats: 1 } }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const objectFile = (id: string, extra: Record<string, unknown>) => ({ kind: OBJ_KIND, id, ...extra });
const objectPath = (id: string) => `driftbench/${OBJ_KIND}/${id}.yaml`;

type ObjectSetup = {
  base: string;
  child: string;
  third: string;
  items: [string, string];
  baseFile: Record<string, unknown>;
};

function objectSetup(seed: number, tag: string): ObjectSetup {
  const [base, child, third] = ['base', 'child', 'third'].map((t) => word(seed, `obj:${tag}:${t}`, 8)) as [
    string,
    string,
    string,
  ];
  const items = ['i1', 'i2'].map((t) => word(seed, `obj:${tag}:${t}`, 7)) as [string, string];
  const baseFile = objectFile(base, {
    items: items.map((id, index) => ({
      id,
      title: word(seed, `obj:${tag}:title:${index}`, 12),
      enabled: false,
      impl: 'builtin:value-check/exact',
    })),
  });
  return { base, child, third, items, baseFile };
}

function objectItems(): void {
  const cliOut = (r: { out: string; err: string }) => `${r.out}${r.err}`;

  item(
    'objects.unknown-item-refused-with-its-twin',
    3,
    3,
    CLI_OBJECTS,
    'An operation on an item the parent does not hold is refused naming it, while the same operation on a held item loads, shortcut: items are not looked up or any id is accepted',
    'an object that extends another refuses an operation on an item id the parent does not hold (validate exits 1, "unknown item"), and loads one on a held item',
    async (ctx) => {
      const s = objectSetup(ctx.seed, 'unknown-item');
      const stranger = word(ctx.seed, 'obj:unknown-item:stranger', 9);
      const build = (target: string) => ({
        [objectPath(s.base)]: s.baseFile,
        [objectPath(s.child)]: objectFile(s.child, {
          extends: s.base,
          items: [{ id: target, title: word(ctx.seed, 'obj:unknown-item:newtitle', 11) }],
        }),
      });
      const good = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'unknown-item:ok', build(s.items[0])),
      );
      const bad = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'unknown-item:bad', build(stranger)),
      );
      return expectAll([
        [
          good.code === 0,
          say(
            D_OBJECTS,
            'an operation on a held item validates (exit 0)',
            `exit ${good.code}: ${cliOut(good).slice(0, 200)}`,
          ),
        ],
        [
          bad.code === 1 && /unknown item/i.test(cliOut(bad)),
          say(
            D_OBJECTS,
            'an operation on an item the parent does not hold is refused: exit 1 and "unknown item"',
            `exit ${bad.code}: ${cliOut(bad).slice(0, 200)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'objects.extends-cycle-and-chain',
    3,
    3,
    CLI_OBJECTS,
    'Two objects that extend each other are refused as a cycle and a chain of three loads, shortcut: depth is cut at one level or cycles are not seen',
    'an extends cycle is refused; a chain of objects that ends in a root loads',
    async (ctx) => {
      const s = objectSetup(ctx.seed, 'cycle');
      const chain = {
        [objectPath(s.base)]: s.baseFile,
        [objectPath(s.child)]: objectFile(s.child, { extends: s.base }),
        [objectPath(s.third)]: objectFile(s.third, { extends: s.child }),
      };
      const cyc = {
        [objectPath(s.child)]: objectFile(s.child, { extends: s.third, items: [] }),
        [objectPath(s.third)]: objectFile(s.third, { extends: s.child, items: [] }),
      };
      const good = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'cycle:chain', chain),
      );
      const bad = await ctx.product.cli(['object', 'validate'], await projectFolder(ctx, 'cycle:cycle', cyc));
      return expectAll([
        [
          good.code === 0,
          say(
            D_OBJECTS,
            'a chain of three objects ending in a root validates',
            `exit ${good.code}: ${cliOut(good).slice(0, 200)}`,
          ),
        ],
        [
          bad.code === 1 && /cycle/i.test(cliOut(bad)),
          say(
            D_OBJECTS,
            '"extends cycle: a -> b -> a" is refused with exit 1',
            `exit ${bad.code}: ${cliOut(bad).slice(0, 200)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'objects.file-must-sit-at-its-kind-and-id',
    3,
    3,
    CLI_OBJECTS,
    'A file under driftbench/ whose place does not match its kind and id is refused, shortcut: the file name is trusted',
    'a file under driftbench/ must sit at driftbench/<kind>/<id>.yaml',
    async (ctx) => {
      const s = objectSetup(ctx.seed, 'place');
      const elsewhere = word(ctx.seed, 'obj:place:elsewhere', 8);
      const good = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'place:ok', { [objectPath(s.base)]: s.baseFile }),
      );
      const bad = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'place:bad', { [objectPath(elsewhere)]: s.baseFile }),
      );
      return expectAll([
        [
          good.code === 0,
          say(D_OBJECTS, 'a file at its place validates', `exit ${good.code}: ${cliOut(good).slice(0, 200)}`),
        ],
        [
          bad.code === 1,
          say(
            D_OBJECTS,
            'a file at the place of another id is refused (exit 1)',
            `exit ${bad.code}: ${cliOut(bad).slice(0, 200)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'objects.enabled-item-needs-an-implementation',
    3,
    3,
    CLI_OBJECTS,
    'An enabled item whose implementation nothing provides is refused and the same item disabled loads, shortcut: impl names are not resolved or disabled items are resolved too',
    'an enabled item needs an implementation from driftbench or a plugin; a disabled item needs none',
    async (ctx) => {
      const s = objectSetup(ctx.seed, 'impl');
      const impl = `plugin:${word(ctx.seed, 'obj:impl:name', 9)}`;
      const file = (enabled: boolean) =>
        objectFile(s.base, {
          items: [
            {
              id: s.items[0],
              title: word(ctx.seed, 'obj:impl:title', 11),
              enabled,
              impl,
              when: {},
              effect: { settles: ['pass', 'fail'] },
            },
          ],
        });
      const good = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'impl:disabled', { [objectPath(s.base)]: file(false) }),
      );
      const bad = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'impl:enabled', { [objectPath(s.base)]: file(true) }),
      );
      return expectAll([
        [
          good.code === 0,
          say(
            D_OBJECTS,
            'a disabled item with an unknown implementation validates',
            `exit ${good.code}: ${cliOut(good).slice(0, 200)}`,
          ),
        ],
        [
          bad.code === 1 && /no builtin or plugin provides/i.test(cliOut(bad)),
          say(
            D_OBJECTS,
            'an enabled item whose implementation no builtin or plugin provides is refused',
            `exit ${bad.code}: ${cliOut(bad).slice(0, 200)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'objects.move-before-and-after-not-both',
    3,
    4,
    CLI_OBJECTS,
    'An item moves before or after another, not both in one file, shortcut: both are accepted and one is dropped',
    'an object file uses order or item moves, and one item moves with before or after, not both',
    async (ctx) => {
      const s = objectSetup(ctx.seed, 'move');
      const move = (extra: Record<string, unknown>) => ({
        [objectPath(s.base)]: s.baseFile,
        [objectPath(s.child)]: objectFile(s.child, {
          extends: s.base,
          items: [{ id: s.items[1], ...extra }],
        }),
      });
      const one = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'move:one', move({ before: s.items[0] })),
      );
      const both = await ctx.product.cli(
        ['object', 'validate'],
        await projectFolder(ctx, 'move:both', move({ before: s.items[0], after: s.items[0] })),
      );
      return expectAll([
        [
          one.code === 0,
          say(
            D_OBJECTS,
            'one item moved with before validates',
            `exit ${one.code}: ${cliOut(one).slice(0, 200)}`,
          ),
        ],
        [
          both.code === 1,
          say(
            D_OBJECTS,
            'before and after on one item are refused',
            `exit ${both.code}: ${cliOut(both).slice(0, 200)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'objects.hash-is-the-content-not-the-name',
    3,
    4,
    CLI_OBJECTS,
    'An object that changes nothing has its parent hash and a changed title another one, shortcut: the hash covers the id or the file',
    'the hash is the first 8 hex of the SHA-256 of the resolved content: same items and values, same hash whatever the id; a change moves it',
    async (ctx) => {
      const s = objectSetup(ctx.seed, 'hash');
      const same = await projectFolder(ctx, 'hash:same', {
        [objectPath(s.base)]: s.baseFile,
        [objectPath(s.child)]: objectFile(s.child, { extends: s.base }),
      });
      const changed = await projectFolder(ctx, 'hash:changed', {
        [objectPath(s.base)]: s.baseFile,
        [objectPath(s.child)]: objectFile(s.child, {
          extends: s.base,
          items: [{ id: s.items[0], title: word(ctx.seed, 'obj:hash:other-title', 13) }],
        }),
      });
      const hashes = async (dir: string) => {
        const r = await ctx.product.cli(['object', 'list'], dir);
        const row = (id: string) =>
          r.out
            .split('\n')
            .map((l) => l.trim().split(/\s+/))
            .find((cols) => cols[1] === id);
        return { base: row(s.base)?.[3], child: row(s.child)?.[3], raw: r.out.slice(0, 200) };
      };
      const a = await hashes(same);
      const b = await hashes(changed);
      return expectAll([
        [
          a.base !== undefined && /^[0-9a-f]{8}$/.test(a.base),
          say(
            D_OBJECTS,
            '`object list` prints the first 8 hex of the hash in its fourth column',
            `list: ${a.raw}`,
          ),
        ],
        [
          a.base === a.child,
          say(
            D_OBJECTS,
            'an object that extends and changes nothing has the hash of its parent',
            `base ${a.base}, child ${a.child}`,
          ),
        ],
        [
          b.base !== undefined && b.base !== b.child,
          say(D_OBJECTS, 'a changed item title moves the hash', `base ${b.base}, child ${b.child}`),
        ],
      ]);
    },
  );

  item(
    'objects.diff-exit-and-unknown-object',
    3,
    3,
    CLI_OBJECTS,
    'diff exits 0 for equal content and 1 for a difference and show exits 2 for an object that does not exist, shortcut: the exit is always the same',
    'object diff exits 1 when the objects differ and 0 when they do not; object show exits 2 on an unknown object',
    async (ctx) => {
      const s = objectSetup(ctx.seed, 'diff');
      const dir = await projectFolder(ctx, 'diff', {
        [objectPath(s.base)]: s.baseFile,
        [objectPath(s.child)]: objectFile(s.child, { extends: s.base }),
        [objectPath(s.third)]: objectFile(s.third, {
          extends: s.base,
          items: [{ id: s.items[1], title: word(ctx.seed, 'obj:diff:other', 14) }],
        }),
      });
      const equal = await ctx.product.cli(
        ['object', 'diff', `${OBJ_KIND}/${s.base}`, `${OBJ_KIND}/${s.child}`],
        dir,
      );
      const differ = await ctx.product.cli(
        ['object', 'diff', `${OBJ_KIND}/${s.base}`, `${OBJ_KIND}/${s.third}`],
        dir,
      );
      const known = await ctx.product.cli(['object', 'show', `${OBJ_KIND}/${s.base}`], dir);
      const unknown = await ctx.product.cli(
        ['object', 'show', `${OBJ_KIND}/${word(ctx.seed, 'obj:diff:nope', 9)}`],
        dir,
      );
      return expectAll([
        [
          equal.code === 0,
          say(
            D_OBJECTS,
            'objects with the same content: diff exits 0',
            `exit ${equal.code}: ${cliOut(equal).slice(0, 160)}`,
          ),
        ],
        [
          differ.code === 1,
          say(
            D_OBJECTS,
            'objects that differ: diff exits 1',
            `exit ${differ.code}: ${cliOut(differ).slice(0, 160)}`,
          ),
        ],
        [
          known.code === 0,
          say(
            D_OBJECTS,
            'show of an existing object exits 0',
            `exit ${known.code}: ${cliOut(known).slice(0, 160)}`,
          ),
        ],
        [
          unknown.code === 2,
          say(
            D_OBJECTS,
            'show of an unknown object exits 2',
            `exit ${unknown.code}: ${cliOut(unknown).slice(0, 160)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'objects.stronger-layer-wins',
    3,
    5,
    CLI_OBJECTS,
    'The object a block uses comes from the strongest layer that names one: the command line over the block over the spec over the suite, shortcut: the first or the weakest layer is read',
    'uses is resolved weakest first with a stronger layer winning: suite, spec, block, command line',
    async (ctx) => {
      const s = objectSetup(ctx.seed, 'layers');
      const [suiteObj, specObj, blockObj, cliObj] = ['s', 'p', 'b', 'c'].map((t) =>
        word(ctx.seed, `obj:layers:${t}`, 8),
      ) as [string, string, string, string];
      const spec = {
        id: word(ctx.seed, 'obj:layers:spec', 8),
        uses: { value_check: specObj },
        blocks: [
          {
            id: word(ctx.seed, 'obj:layers:b0', 6),
            user: word(ctx.seed, 'obj:layers:u0', 9),
            uses: { value_check: blockObj },
          },
          { id: word(ctx.seed, 'obj:layers:b1', 6), user: word(ctx.seed, 'obj:layers:u1', 9) },
        ],
      };
      const bare = {
        ...spec,
        uses: undefined,
        blocks: [{ id: spec.blocks[1]?.id, user: word(ctx.seed, 'obj:layers:u2', 9) }],
      };
      const folder = (name: string) => `specs/${name}`;
      const files: Record<string, unknown> = {
        [objectPath(s.base)]: s.baseFile,
        ...Object.fromEntries(
          [suiteObj, specObj, blockObj, cliObj].map((id) => [
            objectPath(id),
            objectFile(id, { extends: s.base }),
          ]),
        ),
        [`${folder('a')}/_driftbench/uses.yaml`]: { value_check: suiteObj },
        [`${folder('a')}/one.yaml`]: spec,
        [`${folder('b')}/_driftbench/uses.yaml`]: { value_check: suiteObj },
        [`${folder('b')}/two.yaml`]: { ...bare, id: word(ctx.seed, 'obj:layers:spec2', 8) },
      };
      const dir = await projectFolder(ctx, 'layers', files);
      const named = (r: { out: string; err: string }) => /->\s+([^@\s]+)@/.exec(`${r.out}${r.err}`)?.[1];
      const at = async (path: string, extra: string[] = []) =>
        ctx.product.cli(['object', 'explain', OBJ_KIND, '--at', path, ...extra], dir);
      const atSpec = await at(`${folder('a')}/one.yaml`);
      const atBlock = await at(`${folder('a')}/one.yaml#${spec.blocks[0]?.id}`);
      const atOther = await at(`${folder('a')}/one.yaml#${spec.blocks[1]?.id}`);
      const viaCli = await at(`${folder('a')}/one.yaml#${spec.blocks[0]?.id}`, [
        '--use',
        `${OBJ_KIND}/${cliObj}`,
      ]);
      const suiteOnly = await at(`${folder('b')}/two.yaml`);
      return expectAll([
        [
          named(atSpec) === specObj,
          say(
            D_OBJECTS,
            'at the spec layer the spec uses beats the suite uses',
            `named ${named(atSpec)}; ${cliOut(atSpec).slice(0, 200)}`,
          ),
        ],
        [
          named(atBlock) === blockObj,
          say(
            D_OBJECTS,
            'at a block that names its own, the block beats the spec',
            `named ${named(atBlock)}; ${cliOut(atBlock).slice(0, 200)}`,
          ),
        ],
        [
          named(atOther) === specObj,
          say(D_OBJECTS, 'a block that names none takes the spec choice', `named ${named(atOther)}`),
        ],
        [
          named(viaCli) === cliObj,
          say(D_OBJECTS, '--use on the command line beats the block', `named ${named(viaCli)}`),
        ],
        [
          named(suiteOnly) === suiteObj,
          say(D_OBJECTS, 'a spec that names none takes the suite uses.yaml', `named ${named(suiteOnly)}`),
        ],
      ]);
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 4: the value-check ladder without services (packages/cli/help/judging-check-tools.md)
 * ---------------------------------------------------------------------------------------------------- */

const D_LADDER = 'packages/cli/help/judging-check-tools.md "The value-check ladder"';

function valueItems(): void {
  const withLabel = (label: string, field: string, value: unknown, extra: Record<string, unknown> = {}) => ({
    tools: [{ label, count: 1, input: { [field]: value }, ...extra }],
  });

  item(
    'values.differing-writing-falls-back-to-exact-with-its-lint',
    4,
    3,
    CHECKS,
    'A value written differently fails by the exact fallback, which says so, with a non-gating no_decider lint, shortcut: case or format is forgiven or the fallback is silent',
    'a value no ladder item settles is compared exactly; the evidence says exact_fallback and a non-gating tools.<label>.input.<field>.no_decider lint names what would settle it',
    async (ctx) => {
      const label = word(ctx.seed, 'values.fallback:label');
      const field = word(ctx.seed, 'values.fallback:field');
      const expected = word(ctx.seed, 'values.fallback:value', 9);
      const differs = await oneBlock(ctx, 'values.fallback:differs', withLabel(label, field, expected), {
        text: word(ctx.seed, 'r'),
        calls: [call(label, { [field]: expected.toUpperCase() })],
      });
      const equal = await oneBlock(ctx, 'values.fallback:equal', withLabel(label, field, expected), {
        text: word(ctx.seed, 'r'),
        calls: [call(label, { [field]: expected })],
      });
      const id = `tools.${label}.input.${field}`;
      const verdict = verdictOf(differs.block, id);
      const lint = verdictOf(differs.block, `${id}.no_decider`);
      return expectAll([
        [
          !differs.block.pass && verdict?.outcome === 'fail',
          say(
            D_LADDER,
            'a differing writing with no decider fails',
            `block.pass ${differs.block.pass}, ${id} is ${verdict?.outcome}`,
          ),
        ],
        [
          /exact_fallback/.test(String((verdict as { evidence?: string } | undefined)?.evidence ?? '')),
          say(
            D_LADDER,
            `the evidence says exact_fallback and names ${label}.${field}`,
            String((verdict as { evidence?: string } | undefined)?.evidence ?? 'no verdict').slice(0, 220),
          ),
        ],
        [
          lint !== undefined && lint.gating === false,
          say(
            D_LADDER,
            `the lint ${id}.no_decider is present and not gating`,
            lint ? `gating ${lint.gating}` : 'absent',
          ),
        ],
        [
          equal.block.pass && verdictOf(equal.block, `${id}.no_decider`) === undefined,
          say(D_LADDER, 'an equal value passes with no lint', `block.pass ${equal.block.pass}`),
        ],
      ]);
    },
  );

  item(
    'values.one-writing-types-never-coerce',
    4,
    3,
    CHECKS,
    'A number, a boolean, a list or null that differs from the expected one fails, even as text, shortcut: values are compared as strings or loosely',
    'a number, boolean, list, null or absent value that differs from the expected one fails: it has one writing',
    async (ctx) => {
      const label = word(ctx.seed, 'values.types:label');
      const field = word(ctx.seed, 'values.types:field');
      const rows: [unknown, unknown, boolean][] = [
        [7, 7, true],
        [7, '7', false],
        [true, 'true', false],
        [true, true, true],
        [[1, 2], [2, 1], false],
        [[1, 2], [1, 2], true],
        [null, 'null', false],
        [null, null, true],
      ];
      for (const [expected, got, passes] of rows) {
        const { block } = await oneBlock(
          ctx,
          `values.types:${JSON.stringify(expected)}:${JSON.stringify(got)}`,
          withLabel(label, field, Array.isArray(expected) ? { exact: expected } : expected),
          { text: word(ctx.seed, 'r'), calls: [call(label, { [field]: got })] },
        );
        if (block.pass !== passes)
          return fail(
            say(
              D_LADDER,
              `expected ${JSON.stringify(expected)} and got ${JSON.stringify(got)} ${passes ? 'passes' : 'fails'}`,
              `block.pass ${block.pass}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'values.compare-exact-states-its-reason',
    4,
    4,
    CHECKS,
    'compare: { exact: <reason> } passes only the exact value and prints the reason, shortcut: the declaration is ignored',
    'compare: { exact: <reason> } passes only on the exact value and the reason is printed in the evidence',
    async (ctx) => {
      const label = word(ctx.seed, 'values.exact:label');
      const field = word(ctx.seed, 'values.exact:field');
      const expected = word(ctx.seed, 'values.exact:value', 9);
      const reason = `${word(ctx.seed, 'values.exact:why1', 7)} ${word(ctx.seed, 'values.exact:why2', 8)}`;
      const expectation = withLabel(label, field, expected, { compare: { exact: reason } });
      const differs = await oneBlock(ctx, 'values.exact:differs', expectation, {
        text: word(ctx.seed, 'r'),
        calls: [call(label, { [field]: ` ${expected}` })],
      });
      const equal = await oneBlock(ctx, 'values.exact:equal', expectation, {
        text: word(ctx.seed, 'r'),
        calls: [call(label, { [field]: expected })],
      });
      const evidence = String(
        (verdictOf(differs.block, `tools.${label}.input.${field}`) as { evidence?: string } | undefined)
          ?.evidence ?? '',
      );
      return expectAll([
        [
          !differs.block.pass,
          say(
            D_LADDER,
            'a value that differs only in a leading space fails under compare exact',
            'block.pass true',
          ),
        ],
        [evidence.includes(reason), say(D_LADDER, 'the declared reason is printed', evidence.slice(0, 220))],
        [equal.block.pass, say(D_LADDER, 'the exact value passes', 'block.pass false')],
      ]);
    },
  );

  item(
    'values.compare-modes-are-validated',
    4,
    3,
    CORE,
    'compare takes auto, outcome, contract, as_given, same_referent or { exact }, one mode or a mode by argument name, shortcut: any string is accepted',
    'a compare mode outside the documented ones is refused by the loader; auto, a named mode and a mode by argument name load',
    async (ctx) => {
      const label = word(ctx.seed, 'values.modes:label');
      const field = word(ctx.seed, 'values.modes:field');
      const spec = (compare: unknown): RawSpec => ({
        id: word(ctx.seed, 'values.modes:id', 8),
        blocks: [
          {
            user: word(ctx.seed, 'values.modes:u', 9),
            expect: {
              tools: [{ label, count: 1, input: { [field]: word(ctx.seed, 'values.modes:v') }, compare }],
            },
          },
        ],
      });
      const rows: [unknown, boolean, string][] = [
        ['auto', true, 'auto'],
        ['outcome', true, 'outcome'],
        ['as_given', true, 'as_given'],
        [{ [field]: 'same_referent' }, true, 'a mode by argument name'],
        [{ exact: word(ctx.seed, 'values.modes:reason', 10) }, true, 'exact with a reason'],
        [word(ctx.seed, 'values.modes:nonsense', 9), false, 'a word that is no mode'],
      ];
      for (const [compare, ok, name] of rows) {
        const result = loadIssues(ctx.product, spec(compare));
        if (result.ok !== ok)
          return fail(
            say(
              D_LADDER,
              `compare ${name} ${ok ? 'loads' : 'is refused'}`,
              `ok ${result.ok}, codes ${result.codes.join(',')}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'values.contract-rung-fails-a-value-outside-an-enum',
    4,
    4,
    CHECKS,
    'A value outside the enum of the tool schema fails and the evidence names the contract rung, shortcut: the schema is not read for the value',
    'rung2_contract: a value that breaks the field pattern, enum or const in metadata.tool_schemas fails and the evidence names the item',
    async (ctx) => {
      const label = word(ctx.seed, 'values.contract:label');
      const field = word(ctx.seed, 'values.contract:field');
      const members = [word(ctx.seed, 'values.contract:m1', 6), word(ctx.seed, 'values.contract:m2', 6)];
      const schema = {
        [label]: {
          type: 'object',
          properties: { [field]: { type: 'string', enum: members } },
          required: [field],
        },
      };
      const spec = { metadata: { tool_schemas: schema } };
      const outside = await oneBlock(
        ctx,
        'values.contract:outside',
        withLabel(label, field, members[0]),
        {
          text: word(ctx.seed, 'r'),
          calls: [call(label, { [field]: word(ctx.seed, 'values.contract:other', 6) })],
        },
        { spec },
      );
      const member = await oneBlock(
        ctx,
        'values.contract:member',
        withLabel(label, field, members[0]),
        { text: word(ctx.seed, 'r'), calls: [call(label, { [field]: members[1] })] },
        { spec },
      );
      const evidence = (b: BlockRecord) =>
        String(
          (verdictOf(b, `tools.${label}.input.${field}`) as { evidence?: string } | undefined)?.evidence ??
            '',
        );
      return expectAll([
        [
          !outside.block.pass && /rung2_contract/.test(evidence(outside.block)),
          say(
            D_LADDER,
            'a value outside the enum fails with rung2_contract in the evidence',
            `block.pass ${outside.block.pass}; ${evidence(outside.block).slice(0, 200)}`,
          ),
        ],
        [
          !member.block.pass,
          say(
            D_LADDER,
            'two different members of an enum fail (the rung settles no pass)',
            'block.pass true',
          ),
        ],
      ]);
    },
  );

  item(
    'values.as-given-rung-needs-the-users-words',
    4,
    4,
    CHECKS,
    'When the user wrote the expected value and the agent wrote another, the as_given rung fails it and names itself, shortcut: the user turn is not read',
    'rung2b_as_given: the expected writing appears as a whole token in what the user wrote and the agent wrote something else: fail',
    async (ctx) => {
      const label = word(ctx.seed, 'values.asgiven:label');
      const field = word(ctx.seed, 'values.asgiven:field');
      const expected = word(ctx.seed, 'values.asgiven:value', 10);
      const sc = (mentions: boolean) =>
        scenario(ctx.seed, `values.asgiven:${mentions}`, [
          {
            expect: withLabel(label, field, expected),
            plan: { text: word(ctx.seed, 'r'), calls: [call(label, { [field]: expected.toUpperCase() })] },
          },
        ]);
      const given = sc(true);
      (given.raw.blocks[0] as Record<string, unknown>).user =
        `${word(ctx.seed, 'values.asgiven:lead', 6)} ${expected} ${given.users[0]}`;
      const withUser = await play(ctx, given);
      const without = await play(ctx, sc(false));
      const evidence = (rec: RunRecord) =>
        String(
          (verdictOf(rec.blocks[0], `tools.${label}.input.${field}`) as { evidence?: string } | undefined)
            ?.evidence ?? '',
        );
      return expectAll([
        [
          !(withUser.rec.blocks[0] as BlockRecord).pass && /rung2b_as_given/.test(evidence(withUser.rec)),
          say(
            D_LADDER,
            'the user wrote the expected writing: fail naming rung2b_as_given',
            evidence(withUser.rec).slice(0, 220),
          ),
        ],
        [
          !(without.rec.blocks[0] as BlockRecord).pass && !/rung2b_as_given/.test(evidence(without.rec)),
          say(
            D_LADDER,
            'without the user words the rung does not apply (exact fallback)',
            evidence(without.rec).slice(0, 220),
          ),
        ],
      ]);
    },
  );

  item(
    'values.other-assertion-forms-compare-as-written',
    4,
    3,
    CHECKS,
    'regex, contains, one_of, nonempty and absent list their own accepted writings and never reach the ladder, shortcut: every form goes through the same compare',
    'the assertion forms other than a bare value, exact and subset compare as written: no ladder, no lint',
    async (ctx) => {
      const label = word(ctx.seed, 'values.forms:label');
      const field = word(ctx.seed, 'values.forms:field');
      const stem = word(ctx.seed, 'values.forms:stem', 6);
      const { block } = await oneBlock(
        ctx,
        'values.forms:regex',
        withLabel(label, field, { regex: `^${stem}[A-Z]+$` }),
        { text: word(ctx.seed, 'r'), calls: [call(label, { [field]: `${stem}ABC` })] },
      );
      const verdict = verdictOf(block, `tools.${label}.input.${field}`);
      return expectAll([
        [block.pass, say(D_LADDER, 'a regex-accepted writing passes', `block.pass ${block.pass}`)],
        [
          verdictOf(block, `tools.${label}.input.${field}.no_decider`) === undefined &&
            !/exact_fallback/.test(String((verdict as { evidence?: string } | undefined)?.evidence ?? '')),
          say(
            D_LADDER,
            'no ladder evidence and no lint on a regex assertion',
            String((verdict as { evidence?: string } | undefined)?.evidence ?? '').slice(0, 200),
          ),
        ],
      ]);
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 6: sections and links (packages/cli/help/authoring-prompt-sections.md)
 * ---------------------------------------------------------------------------------------------------- */

const D_SECTIONS = 'packages/cli/help/authoring-prompt-sections.md';

/** A prompt of k sections under level-2 headings after a preamble; the headings are single seeded words. */
function promptOf(seed: number, tag: string, k: number): { text: string; heads: string[]; bodies: string[] } {
  const heads = times(k, (i) => word(seed, `prompt:${tag}:head:${i}`, 9));
  const bodies = times(
    k,
    (i) =>
      `${word(seed, `prompt:${tag}:l1:${i}`, 8)} ${word(seed, `prompt:${tag}:l2:${i}`, 10)} ${word(seed, `prompt:${tag}:l3:${i}`, 7)}.`,
  );
  const preamble = `${word(seed, `prompt:${tag}:pre`, 12)} ${word(seed, `prompt:${tag}:pre2`, 9)}.`;
  const text = `${preamble}\n\n${heads.map((h, i) => `## ${h}\n${bodies[i]}\n`).join('\n')}`;
  return { text, heads, bodies };
}

type SectionsRun = { code: number; out: string };

async function sections(
  ctx: ItemContext,
  tag: string,
  files: Record<string, string>,
  argv: (names: Record<string, string>) => string[],
): Promise<SectionsRun & { dir: string; names: Record<string, string> }> {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(ctx.scratch, `sections-${word(ctx.seed, `sections:${tag}:dir`, 10)}`);
  mkdirSync(dir, { recursive: true });
  const names: Record<string, string> = {};
  for (const [key, text] of Object.entries(files)) {
    names[key] =
      `${word(ctx.seed, `sections:${tag}:file:${key}`, 8)}.${key.endsWith('registry') ? 'yaml' : 'md'}`;
    writeFileSync(join(dir, names[key] as string), text);
  }
  const r = await ctx.product.cli(argv(names), dir);
  return { code: r.code, out: `${r.out}${r.err}`, dir, names };
}

function linkItems(): void {
  const initArgs = (names: Record<string, string>, id: string, out: string) => [
    'radius',
    'sections',
    'init',
    names.v1 as string,
    '--id',
    id,
    '--prompt-version',
    'v1',
    '--out',
    out,
  ];

  const registryOf = async (ctx: ItemContext, tag: string, k: number) => {
    const prompt = promptOf(ctx.seed, tag, k);
    const id = word(ctx.seed, `sections:${tag}:id`, 8);
    const regName = `${word(ctx.seed, `sections:${tag}:reg`, 8)}.yaml`;
    const made = await sections(ctx, `${tag}:init`, { v1: prompt.text }, (n) => initArgs(n, id, regName));
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    let registry = '';
    try {
      registry = readFileSync(join(made.dir, regName), 'utf8');
    } catch {
      registry = '';
    }
    return { prompt, id, made, registry, regName };
  };

  const idsOf = (registry: string) =>
    [...registry.matchAll(/^\s*-\s+id:\s+(\S+)\s*$/gm)].map((m) => m[1] as string);

  item(
    'sections.init-one-section-per-heading-plus-preamble',
    6,
    3,
    CORE,
    'init writes one section per level-2 heading and a preamble for the text before the first, with the slugged titles as ids, shortcut: a fixed count or ids by position',
    'radius sections init makes one section per heading of level 1 to --level (default 2), the text before the first heading is the section preamble, ids are the slugged titles',
    async (ctx) => {
      const k = between(rngFor(ctx.seed, 'adv:sections.init'), 3, 6);
      const { prompt, made, registry } = await registryOf(ctx, 'init', k);
      const ids = idsOf(registry);
      return expectAll([
        [made.code === 0, say(D_SECTIONS, 'init exits 0', `exit ${made.code}: ${made.out.slice(0, 160)}`)],
        [
          ids.length === k + 1 && ids[0] === 'preamble',
          say(D_SECTIONS, `${k + 1} sections, the first is preamble`, `ids ${ids.join(',')}`),
        ],
        [
          prompt.heads.every((h, i) => ids[i + 1] === h),
          say(
            D_SECTIONS,
            'the ids are the headings, slugged, in order',
            `ids ${ids.join(',')} vs ${prompt.heads.join(',')}`,
          ),
        ],
      ]);
    },
  );

  item(
    'sections.check-detects-an-edited-prompt',
    6,
    3,
    CORE,
    'check passes on the prompt the registry describes and fails on the same prompt with one letter changed, shortcut: only the length or the first section is compared',
    'radius sections check exits 0 when the registry matches the prompt and 1 when a hash, span or anchor no longer matches',
    async (ctx) => {
      const k = 4;
      const { prompt, registry, regName, made } = await registryOf(ctx, 'check', k);
      if (made.code !== 0)
        return fail(say(D_SECTIONS, 'init exits 0', `exit ${made.code}: ${made.out.slice(0, 160)}`));
      const at = prompt.text.lastIndexOf(prompt.bodies[k - 1] as string);
      const swapped = `${prompt.text.slice(0, at)}${(prompt.bodies[k - 1] as string).replace(/[a-z]/, (c) => (c === 'q' ? 'r' : 'q'))}${prompt.text.slice(at + (prompt.bodies[k - 1] as string).length)}`;
      const same = await sections(ctx, 'check:same', { v1: prompt.text, registry }, (n) => [
        'radius',
        'sections',
        'check',
        n.registry as string,
        '--prompt',
        n.v1 as string,
      ]);
      const edited = await sections(ctx, 'check:edited', { v1: swapped, registry }, (n) => [
        'radius',
        'sections',
        'check',
        n.registry as string,
        '--prompt',
        n.v1 as string,
      ]);
      void regName;
      return expectAll([
        [
          same.code === 0 && new RegExp(`${k + 1} sections match`).test(same.out),
          say(
            D_SECTIONS,
            `check passes: "${k + 1} sections match the prompt."`,
            `exit ${same.code}: ${same.out.slice(0, 160)}`,
          ),
        ],
        [
          edited.code === 1,
          say(
            D_SECTIONS,
            'check fails when a letter inside the last section changed',
            `exit ${edited.code}: ${edited.out.slice(0, 160)}`,
          ),
        ],
      ]);
    },
  );

  const reanchor = async (
    ctx: ItemContext,
    tag: string,
    k: number,
    edit: (p: ReturnType<typeof promptOf>) => string,
  ) => {
    const { prompt, registry, made } = await registryOf(ctx, tag, k);
    const second = edit(prompt);
    const result = await sections(ctx, `${tag}:reanchor`, { v1: prompt.text, v2: second, registry }, (n) => [
      'radius',
      'sections',
      'reanchor',
      n.registry as string,
      '--prompt',
      n.v1 as string,
      n.v2 as string,
      '--to-version',
      'v2',
    ]);
    const counts = /(\d+) kept, (\d+) moved, (\d+) stale/.exec(result.out);
    return { prompt, made, result, counts: counts ? counts.slice(1, 4).map(Number) : undefined };
  };

  item(
    'sections.reanchor-identical-text-keeps-everything',
    6,
    2,
    CORE,
    'Re-anchoring on an identical prompt keeps every section and exits 0, shortcut: sections are always reported moved or stale',
    'reanchor: the same text found once keeps its section; exit 0 when every section was found again in order',
    async (ctx) => {
      const k = 4;
      const r = await reanchor(ctx, 'same', k, (p) => p.text);
      return expectAll([
        [
          r.result.code === 0,
          say(D_SECTIONS, 'exit 0', `exit ${r.result.code}: ${r.result.out.slice(0, 200)}`),
        ],
        [
          r.counts?.join() === [k + 1, 0, 0].join(),
          say(D_SECTIONS, `${k + 1} kept, 0 moved, 0 stale`, r.result.out.slice(0, 200)),
        ],
      ]);
    },
  );

  item(
    'sections.reanchor-edit-inside-makes-that-section-stale-and-moves-the-later-ones',
    6,
    5,
    CORE,
    'A longer edit inside one section makes only that section stale, the earlier ones are kept and the later ones moved, shortcut: stale is by position, by length or for all following sections',
    'reanchor: a section is only placed where its text hashes as before; an edit inside makes it stale; the others keep their ids, earlier ones kept, later ones moved',
    async (ctx) => {
      const k = 5;
      const j = between(rngFor(ctx.seed, 'adv:sections.reanchor-inside'), 1, k);
      const r = await reanchor(ctx, 'inside', k, (p) =>
        p.text.replace(
          p.bodies[j - 1] as string,
          (p.bodies[j - 1] as string).replace(' ', ` ${word(ctx.seed, 'sections.inside:added', 15)} `),
        ),
      );
      const staleId = r.prompt.heads[j - 1] as string;
      return expectAll([
        [
          r.result.code === 1,
          say(
            D_SECTIONS,
            'exit 1 when a section is stale',
            `exit ${r.result.code}: ${r.result.out.slice(0, 200)}`,
          ),
        ],
        [
          r.counts?.join() === [j, k - j, 1].join(),
          say(
            D_SECTIONS,
            `section ${j} of ${k} edited: ${j} kept, ${k - j} moved, 1 stale`,
            r.result.out.slice(0, 220),
          ),
        ],
        [
          new RegExp(`stale\\s+${staleId}\\b`).test(r.result.out),
          say(D_SECTIONS, `the stale section is ${staleId}`, r.result.out.slice(0, 260)),
        ],
      ]);
    },
  );

  item(
    'sections.reanchor-same-length-edit-moves-nothing',
    6,
    4,
    CORE,
    'An edit of the same length inside one section makes only it stale and no span moves, shortcut: any edit moves the following sections',
    'reanchor: spans are compared in the new text; an edit that keeps the length leaves every other section at its span (kept)',
    async (ctx) => {
      const k = 5;
      const j = between(rngFor(ctx.seed, 'adv:sections.reanchor-same-length'), 1, k - 1);
      const r = await reanchor(ctx, 'samelen', k, (p) =>
        p.text.replace(
          p.bodies[j - 1] as string,
          (p.bodies[j - 1] as string).replace(/[a-y]/, (c) => String.fromCharCode(c.charCodeAt(0) + 1)),
        ),
      );
      return expectAll([
        [
          r.result.code === 1,
          say(
            D_SECTIONS,
            'exit 1 when a section is stale',
            `exit ${r.result.code}: ${r.result.out.slice(0, 200)}`,
          ),
        ],
        [
          r.counts?.join() === [k, 0, 1].join(),
          say(D_SECTIONS, `${k} kept, 0 moved, 1 stale`, r.result.out.slice(0, 220)),
        ],
      ]);
    },
  );

  item(
    'sections.reanchor-reorder-is-reported-not-stale',
    6,
    4,
    CORE,
    'Two sections that swapped places are found again by their text and the change of order is reported with exit 1, shortcut: a moved section is stale or the order is ignored',
    'reanchor: exit 1 when sections changed order; a section found by the same hash is never stale',
    async (ctx) => {
      const k = 4;
      const r = await reanchor(ctx, 'reorder', k, (p) => {
        const parts = p.heads.map((h, i) => `## ${h}\n${p.bodies[i]}\n`);
        const preamble = p.text.slice(0, p.text.indexOf('## '));
        return `${preamble}${[parts[1], parts[0], ...parts.slice(2)].join('\n')}`;
      });
      return expectAll([
        [
          r.result.code === 1,
          say(D_SECTIONS, 'exit 1', `exit ${r.result.code}: ${r.result.out.slice(0, 200)}`),
        ],
        [
          r.counts !== undefined && r.counts[2] === 0,
          say(D_SECTIONS, 'no section is stale', r.result.out.slice(0, 220)),
        ],
        [
          /order/i.test(r.result.out),
          say(D_SECTIONS, 'the output names the change of order', r.result.out.slice(0, 220)),
        ],
      ]);
    },
  );

  item(
    'sections.reanchor-refuses-the-wrong-old-prompt',
    6,
    3,
    CORE,
    'Re-anchoring with an old prompt the registry does not describe exits 2 and with the right one exits 0, shortcut: the text_sha256 is not compared',
    'reanchor exits 2 when the registry does not describe the old prompt (text_sha256 differs)',
    async (ctx) => {
      const k = 3;
      const { prompt, registry } = await registryOf(ctx, 'wrongold', k);
      const other = promptOf(ctx.seed, 'wrongold-other', k).text;
      const run2 = (old: string) =>
        sections(ctx, `wrongold:${old === prompt.text}`, { v1: old, v2: prompt.text, registry }, (n) => [
          'radius',
          'sections',
          'reanchor',
          n.registry as string,
          '--prompt',
          n.v1 as string,
          n.v2 as string,
          '--to-version',
          'v2',
        ]);
      const right = await run2(prompt.text);
      const wrong = await run2(other);
      return expectAll([
        [
          right.code === 0,
          say(D_SECTIONS, 'the right old prompt exits 0', `exit ${right.code}: ${right.out.slice(0, 160)}`),
        ],
        [
          wrong.code === 2,
          say(
            D_SECTIONS,
            'another prompt as the old one exits 2',
            `exit ${wrong.code}: ${wrong.out.slice(0, 160)}`,
          ),
        ],
      ]);
    },
  );

  item(
    'sections.registry-refusals-and-twins',
    6,
    4,
    CORE,
    'A registry that uses an id twice or references a section that does not exist is invalid (exit 2) while the same registry with a real reference passes, shortcut: only the hashes are checked',
    'radius sections check exits 2 for an invalid registry: an id used twice, a reference to an unknown section',
    async (ctx) => {
      const k = 3;
      const { prompt, registry } = await registryOf(ctx, 'refusals', k);
      const ids = idsOf(registry);
      const withIds = (text: string) => ({ v1: prompt.text, registry: text });
      const check = (tag: string, text: string) =>
        sections(ctx, `refusals:${tag}`, withIds(text), (n) => [
          'radius',
          'sections',
          'check',
          n.registry as string,
          '--prompt',
          n.v1 as string,
        ]);
      const line = /^(\s*)-\s+id:\s+\S+\s*$/m.exec(registry);
      const indent = `${line?.[1] ?? ''}  `;
      const secondId = ids[1] as string;
      const duplicate = registry.replace(
        new RegExp(`(^\\s*-\\s+id:\\s+)${ids[2]}\\s*$`, 'm'),
        `$1${secondId}`,
      );
      const reference = (target: string) =>
        registry.replace(
          new RegExp(`(^\\s*-\\s+id:\\s+${secondId}\\s*$)`, 'm'),
          `$1\n${indent}references: [${target}]`,
        );
      const twin = await check('twin', reference(ids[2] as string));
      const dup = await check('dup', duplicate);
      const unknown = await check('unknown', reference(word(ctx.seed, 'sections.refusals:nowhere', 9)));
      return expectAll([
        [
          twin.code === 0,
          say(
            D_SECTIONS,
            'a registry that references a real section passes',
            `exit ${twin.code}: ${twin.out.slice(0, 200)}`,
          ),
        ],
        [
          dup.code === 2,
          say(
            D_SECTIONS,
            'an id used twice is invalid: exit 2',
            `exit ${dup.code}: ${dup.out.slice(0, 200)}`,
          ),
        ],
        [
          unknown.code === 2,
          say(
            D_SECTIONS,
            'a reference to an unknown section is invalid: exit 2',
            `exit ${unknown.code}: ${unknown.out.slice(0, 200)}`,
          ),
        ],
      ]);
    },
  );

  const D_LINKS = `${D_SECTIONS} "What it is"`;
  item(
    'links.shape-is-validated-with-twins',
    6,
    4,
    CORE,
    'A block link naming a block the spec does not have is LINK_BLOCK_UNKNOWN and a link with a relation, status or origin outside the lists is refused, while valid links load, shortcut: links are free-form metadata',
    'metadata.links is checked by spec validate: the shape, the relation, the status and created_by lists, and the block they name',
    async (ctx) => {
      const spec = (link: Record<string, unknown> | undefined): RawSpec => {
        const blockId = word(ctx.seed, 'links.shape:block', 6);
        return {
          id: word(ctx.seed, 'links.shape:id', 8),
          blocks: [{ id: blockId, user: word(ctx.seed, 'links.shape:u', 9) }],
          metadata: link
            ? {
                links: [
                  {
                    block: blockId,
                    to: {
                      kind: 'prompt_section',
                      prompt: word(ctx.seed, 'links.shape:p', 7),
                      section: word(ctx.seed, 'links.shape:s', 7),
                    },
                    relation: 'verifies',
                    status: 'declared',
                    created_by: 'author',
                    at_version: 'v1',
                    ...link,
                  },
                ],
              }
            : {},
        };
      };
      const ok = loadIssues(ctx.product, spec({}));
      const missingBlock = loadIssues(ctx.product, spec({ block: word(ctx.seed, 'links.shape:nope', 6) }));
      const badRelation = loadIssues(ctx.product, spec({ relation: word(ctx.seed, 'links.shape:rel', 8) }));
      const badStatus = loadIssues(ctx.product, spec({ status: word(ctx.seed, 'links.shape:st', 8) }));
      const badOrigin = loadIssues(ctx.product, spec({ created_by: word(ctx.seed, 'links.shape:by', 8) }));
      const wholeSpec = loadIssues(
        ctx.product,
        (() => {
          const s = spec({});
          const link = (s.metadata as { links: Record<string, unknown>[] }).links[0] as Record<
            string,
            unknown
          >;
          delete link.block;
          return s;
        })(),
      );
      return expectAll([
        [
          ok.ok,
          say(
            D_LINKS,
            'a link with a real block, a target and the listed values loads',
            `codes ${ok.codes.join(',')}`,
          ),
        ],
        [
          wholeSpec.ok,
          say(
            D_LINKS,
            'a link with no block applies to every block and loads',
            `codes ${wholeSpec.codes.join(',')}`,
          ),
        ],
        [
          !missingBlock.ok && missingBlock.codes.includes('LINK_BLOCK_UNKNOWN'),
          say(
            D_LINKS,
            'a link naming no block of the spec is LINK_BLOCK_UNKNOWN',
            `ok ${missingBlock.ok}, codes ${missingBlock.codes.join(',')}`,
          ),
        ],
        [
          !badRelation.ok,
          say(
            D_LINKS,
            'a relation outside verifies|exercises|derived_from|observed_in is refused',
            'the loader accepted it',
          ),
        ],
        [
          !badStatus.ok,
          say(
            D_LINKS,
            'a status outside declared|attributed|verified|refuted|stale is refused',
            'the loader accepted it',
          ),
        ],
        [
          !badOrigin.ok,
          say(
            D_LINKS,
            'created_by outside generator|author|attribution|citation|ir|mutation is refused',
            'the loader accepted it',
          ),
        ],
      ]);
    },
  );

  item(
    'links.stay-out-of-the-spec-hash',
    6,
    4,
    CORE,
    'Adding metadata.links or metadata.provenance never changes the spec hash while a change to a block expectation does, shortcut: the whole metadata is hashed or ignored',
    'metadata.links and metadata.provenance stay out of the spec hash: a link added, promoted or refuted never changes it',
    async (ctx) => {
      const build = (extra: Record<string, unknown>, must: string): Scenario => {
        const sc = scenario(
          ctx.seed,
          'links.hash',
          [{ expect: { must: [must] }, plan: { text: must } }],
          extra,
        );
        return sc;
      };
      const must = word(ctx.seed, 'links.hash:must', 9);
      const plain = await play(ctx, build({}, must));
      const blockId = scenario(ctx.seed, 'links.hash', [{ plan: { text: '' } }]).ids[0];
      const linked = await play(
        ctx,
        build(
          {
            metadata: {
              links: [
                {
                  block: blockId,
                  to: {
                    kind: 'prompt_section',
                    prompt: word(ctx.seed, 'links.hash:p', 7),
                    section: word(ctx.seed, 'links.hash:s', 7),
                  },
                  relation: 'verifies',
                  status: 'declared',
                  created_by: 'author',
                  at_version: 'v1',
                },
              ],
              provenance: { note: word(ctx.seed, 'links.hash:prov', 9) },
            },
          },
          must,
        ),
      );
      const changed = await play(ctx, build({}, `${must}x`));
      return expectAll([
        [
          linked.rec.specHash === plain.rec.specHash,
          say(
            'docs/reference/spec.md "Spec" (metadata)',
            'links and provenance stay out of the spec hash',
            `hash ${plain.rec.specHash} vs ${linked.rec.specHash}`,
          ),
        ],
        [
          changed.rec.specHash !== plain.rec.specHash,
          say('docs/reference/spec.md', 'a changed expectation changes the hash', 'the hash did not move'),
        ],
      ]);
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 1: the Given hash (docs/running.md "Given resolution and the hash")
 * ---------------------------------------------------------------------------------------------------- */

function givenHashItems(): void {
  const D_HASH = 'docs/running.md "Given resolution and the hash"';
  const hashOf = async (ctx: ItemContext, tag: string, given: Record<string, unknown> | undefined) => {
    const sc = scenario(ctx.seed, 'givenhash', [
      { ...(given ? { given } : {}), plan: { text: word(ctx.seed, 'givenhash:r', 9) } },
    ]);
    void tag;
    const { rec } = await play(ctx, sc);
    return (rec.blocks[0] as BlockRecord).givenHash;
  };

  item(
    'given-hash.canonical-and-content-sensitive',
    1,
    4,
    CORE,
    'The Given hash is 12 hex, the same for the same Given whatever the key order and different when a variable differs, shortcut: a hash of the written text, or one that ignores vars',
    'the givenHash is the first 12 hex of the SHA-256 of the canonical JSON of the resolved Given: key order does not matter, content does',
    async (ctx) => {
      const [a, b] = ['a', 'b'].map((t) => word(ctx.seed, `given-hash:key:${t}`)) as [string, string];
      const [va, vb] = ['a', 'b'].map((t) => word(ctx.seed, `given-hash:val:${t}`, 9)) as [string, string];
      const ordered = await hashOf(ctx, 'ab', { vars: { [a]: va, [b]: vb } });
      const reversed = await hashOf(ctx, 'ba', {
        vars: Object.fromEntries([
          [b, vb],
          [a, va],
        ]),
      });
      const changed = await hashOf(ctx, 'changed', { vars: { [a]: va, [b]: `${vb}x` } });
      const none = await hashOf(ctx, 'none', undefined);
      return expectAll([
        [
          /^[0-9a-f]{12}$/.test(ordered ?? ''),
          say(D_HASH, 'givenHash is 12 hex characters', String(ordered)),
        ],
        [
          ordered === reversed,
          say(
            D_HASH,
            'the same variables in another key order give the same hash',
            `${ordered} vs ${reversed}`,
          ),
        ],
        [
          ordered !== changed && ordered !== none,
          say(
            D_HASH,
            'another variable value, or none, gives another hash',
            `${ordered} / ${changed} / ${none}`,
          ),
        ],
      ]);
    },
  );

  item(
    'given-hash.origin-enters-only-when-written',
    1,
    4,
    CORE,
    'The prefix origin enters the Given hash when written: authored and recorded differ, and neither equals no origin, shortcut: the origin is ignored or always hashed',
    'given.origin enters the Given hash only when present, so results with different origins are never pooled',
    async (ctx) => {
      const prefix = [
        { role: 'user', content: word(ctx.seed, 'given-hash:origin:u', 10) },
        { role: 'assistant', content: word(ctx.seed, 'given-hash:origin:a', 10) },
      ];
      const authored = await hashOf(ctx, 'authored', { prefix, origin: 'authored' });
      const recorded = await hashOf(ctx, 'recorded', { prefix, origin: 'recorded' });
      const none = await hashOf(ctx, 'none', { prefix });
      const again = await hashOf(ctx, 'authored-again', { prefix, origin: 'authored' });
      return expectAll([
        [
          authored !== recorded,
          say(D_HASH, 'authored and recorded origins give different hashes', `${authored} vs ${recorded}`),
        ],
        [
          authored !== none && recorded !== none,
          say(
            D_HASH,
            'a prefix with an origin differs from the same prefix without one',
            `${authored} / ${recorded} / ${none}`,
          ),
        ],
        [
          authored === again,
          say(D_HASH, 'the same Given gives the same hash on another run', `${authored} vs ${again}`),
        ],
      ]);
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 9: the statistics functions against their documented formulas (docs/concepts/statistics.md)
 * ---------------------------------------------------------------------------------------------------- */

function statsItems(): void {
  const D_STATS = 'docs/concepts/statistics.md';
  const choose = (n: number, k: number): number => {
    if (k < 0 || k > n) return 0;
    let out = 1;
    for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
    return out;
  };
  const near = (a: unknown, b: number, tolerance = 1e-9) =>
    typeof a === 'number' && Math.abs(a - b) <= tolerance;
  const fn = <T>(ctx: ItemContext, name: string) => need<T>(ctx.product.stats, 'stats', name);

  item(
    'stats.pass-k-and-pass-at-k-are-the-hypergeometric-forms',
    9,
    3,
    'packages/stats',
    'passK and passAtK follow C(c,k)/C(n,k) and 1 - C(n-c,k)/C(n,k) on every c, n, k, shortcut: (c/n)^k, or a clamp that hides c below k',
    'pass^k is C(c, k) / C(n, k), the probability that k runs drawn from the n all pass, and pass@k is 1 - C(n - c, k) / C(n, k)',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:stats.passk');
      const passK = fn<(c: number, n: number, k: number) => number>(ctx, 'passK');
      const passAtK = fn<(c: number, n: number, k: number) => number>(ctx, 'passAtK');
      for (let i = 0; i < 12; i += 1) {
        const n = between(rng, 3, 14);
        const c = i < 3 ? ([0, n, 1][i] ?? 0) : between(rng, 0, n);
        const k = between(rng, 1, n);
        const wantPass = choose(c, k) / choose(n, k);
        const wantAt = 1 - choose(n - c, k) / choose(n, k);
        const gotPass = passK(c, n, k);
        const gotAt = passAtK(c, n, k);
        if (!near(gotPass, wantPass) || !near(gotAt, wantAt))
          return fail(
            say(
              D_STATS,
              `c=${c}, n=${n}, k=${k}: pass^k ${wantPass}, pass@k ${wantAt}`,
              `pass^k ${gotPass}, pass@k ${gotAt}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'stats.zero-failure-bound-is-the-smallest-run-count',
    9,
    3,
    'packages/stats',
    'zeroFailureBound gives the runs that bound the failure rate below p at confidence 1 - alpha, 59 for 5 percent at 95 percent, shortcut: a constant or the rule of three',
    'zeroFailureBound(p, alpha) is the number of failure-free runs needed to claim a failure rate below p at confidence 1 - alpha',
    async (ctx) => {
      const bound = fn<(p: number, alpha?: number) => number>(ctx, 'zeroFailureBound');
      const rows: [number, number | undefined][] = [
        [0.05, undefined],
        [0.1, 0.01],
        [0.02, 0.05],
        [0.2, 0.1],
      ];
      for (const [p, alpha] of rows) {
        const want = Math.ceil(Math.log(alpha ?? 0.05) / Math.log(1 - p));
        const got = alpha === undefined ? bound(p) : bound(p, alpha);
        if (got !== want)
          return fail(
            say(
              D_STATS,
              `zeroFailureBound(${p}${alpha === undefined ? '' : `, ${alpha}`}) is ${want}`,
              String(got),
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'stats.design-effect-and-effective-size',
    9,
    2,
    'packages/stats',
    'designEffect(m, rho) is 1 + (m - 1) rho and the effective size is n divided by it, shortcut: rho is ignored or m is not reduced by one',
    'the design effect of clusters of size m is 1 + (m - 1) rho and the effective sample size is n divided by it',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:stats.deff');
      const designEffect = fn<(m: number, rho: number) => number>(ctx, 'designEffect');
      const effectiveSampleSize = fn<(n: number, m: number, rho: number) => number>(
        ctx,
        'effectiveSampleSize',
      );
      for (let i = 0; i < 6; i += 1) {
        const m = between(rng, 1, 12);
        const rho = Math.round(rng() * 100) / 100;
        const n = between(rng, 20, 400);
        const de = 1 + (m - 1) * rho;
        if (!near(designEffect(m, rho), de) || !near(effectiveSampleSize(n, m, rho), n / de))
          return fail(
            say(
              D_STATS,
              `m=${m}, rho=${rho}, n=${n}: design effect ${de}, effective size ${n / de}`,
              `${designEffect(m, rho)} and ${effectiveSampleSize(n, m, rho)}`,
            ),
          );
      }
      return PASS;
    },
  );

  item(
    'stats.wilson-interval-bounds',
    9,
    3,
    'packages/stats',
    'wilson(k, n) returns the Wilson score interval, within 0 and 1 at the edges and equal to the documented example, shortcut: a normal interval clipped at the edges',
    'wilson(k, n, z) is the Wilson score interval for k successes in n with z the two-sided 95 percent value by default',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:stats.wilson');
      const wilson = fn<
        (k: number, n: number, z?: number) => { estimate: number; lower: number; upper: number }
      >(ctx, 'wilson');
      const z = 1.959963984540054;
      const oracle = (k: number, n: number) => {
        const p = k / n;
        const d = 1 + (z * z) / n;
        const centre = (p + (z * z) / (2 * n)) / d;
        const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
        return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
      };
      const cases: [number, number][] = [
        [18, 20],
        [0, between(rng, 3, 30)],
        [(() => 0)(), 1],
      ].map(([k, n]) => [k as number, n as number]);
      const n = between(rng, 5, 60);
      cases.push([n, n], [between(rng, 1, n - 1), n], [1, 1]);
      for (const [k, size] of cases) {
        const want = oracle(k, size);
        const got = wilson(k, size);
        if (
          !near(got.estimate, want.estimate, 1e-9) ||
          !near(got.lower, want.lower, 1e-6) ||
          !near(got.upper, want.upper, 1e-6)
        )
          return fail(say(D_STATS, `wilson(${k}, ${size}) = ${JSON.stringify(want)}`, JSON.stringify(got)));
      }
      return PASS;
    },
  );

  item(
    'stats.repeats-for-floor-solves-the-half-width',
    9,
    4,
    'packages/stats',
    'repeatsForFloor solves z sqrt(f variance / (r blocks)) for r, f 2 for a difference and 1 otherwise, shortcut: f is always 2, blocks is ignored or the result is not rounded up',
    'repeatsForFloor solves the half-width z sqrt(f variance / (r blocks)) for the repeats r, with f 2 for a difference between two versions (the default) and 1 otherwise',
    async (ctx) => {
      const rng = rngFor(ctx.seed, 'adv:stats.repeats');
      const repeatsForFloor = fn<(options: Record<string, unknown>) => { repeats: number; floor: number }>(
        ctx,
        'repeatsForFloor',
      );
      for (let i = 0; i < 6; i += 1) {
        const flipRate = 0.05 + Math.round(rng() * 40) / 100;
        const floor = 0.02 + Math.round(rng() * 8) / 100;
        const blocks = between(rng, 1, 5);
        const difference = rng() < 0.5;
        const f = difference ? 2 : 1;
        const raw = (1.96 * 1.96 * f * flipRate * (1 - flipRate)) / (blocks * floor * floor);
        const want = Math.ceil(raw);
        // The default z (1.96) and the 1.959964 of the normal quantile round alike unless raw sits on an integer.
        const wide = Math.ceil(
          (1.959963984540054 ** 2 * f * flipRate * (1 - flipRate)) / (blocks * floor * floor),
        );
        if (want !== wide) continue;
        const options: Record<string, unknown> = {
          flipRate,
          floor,
          blocks,
          ...(difference ? {} : { difference: false }),
        };
        const got = repeatsForFloor(options);
        if (got.repeats !== want)
          return fail(
            say(
              D_STATS,
              `repeatsForFloor(${JSON.stringify(options)}) is ${want} repeats`,
              JSON.stringify(got),
            ),
          );
      }
      return PASS;
    },
  );
}

/* ------------------------------------------------------------------------------------------------------
 * Level 1: the observation cache, through `campaign run --store` (docs/running.md "The cache and replay")
 * ---------------------------------------------------------------------------------------------------- */

function cacheItems(): void {
  const D_CACHE = 'docs/running.md "The cache and replay"';
  type Cell = { state: string; cacheHit?: boolean };
  const campaign = async (
    ctx: ItemContext,
    tag: string,
    runs: { spec: Record<string, unknown>; flags?: string[] }[],
  ): Promise<{ cells: Cell[]; raw: string[] }> => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const base = join(ctx.scratch, `cache-${word(ctx.seed, `cache:${tag}:dir`, 10)}`);
    const inputs = join(base, 'inputs');
    mkdirSync(inputs, { recursive: true });
    const storeFolder = join(base, 'elsewhere');
    mkdirSync(storeFolder, { recursive: true });
    const specFile = `${word(ctx.seed, `cache:${tag}:spec`, 8)}.yaml`;
    const cells: Cell[] = [];
    const raw: string[] = [];
    for (const [index, entry] of runs.entries()) {
      writeFileSync(join(inputs, specFile), JSON.stringify(entry.spec));
      const result = await ctx.product.cli(
        [
          'campaign',
          'run',
          specFile,
          '--target',
          'function:acme-sales',
          '--store',
          join(storeFolder, 'runs.db'),
          '--campaign',
          `c${index}${word(ctx.seed, `cache:${tag}:c${index}`, 5)}`,
          '--json',
          ...(entry.flags ?? []),
        ],
        inputs,
      );
      raw.push(result.out.slice(0, 300) + result.err.slice(0, 200));
      try {
        cells.push((JSON.parse(result.out) as { cells: Cell[] }).cells[0] as Cell);
      } catch {
        cells.push({ state: `unreadable (exit ${result.code})` });
      }
    }
    return { cells, raw };
  };
  const specOf = (
    seed: number,
    tag: string,
    must = word(seed, `cache:${tag}:must`, 8),
  ): Record<string, unknown> => ({
    id: word(seed, `cache:${tag}:id`, 8),
    version: '1',
    target: { adapter: 'function', agent: 'acme-sales' },
    blocks: [
      {
        id: word(seed, `cache:${tag}:b`, 6),
        user: word(seed, `cache:${tag}:u`, 9),
        expect: { must_not: [must] },
      },
    ],
  });

  item(
    'cache.version-label-plays-no-part',
    1,
    4,
    CORE,
    'A second campaign over the same store replays a run from the cache even though the spec version label changed, shortcut: the cache key reads the label',
    'the cache key is the content hash of the spec, never the free version label: a spec that differs only in version replays from the cache',
    async (ctx) => {
      const base = specOf(ctx.seed, 'version');
      const { cells, raw } = await campaign(ctx, 'version', [
        { spec: base },
        { spec: { ...base, version: word(ctx.seed, 'cache:version:label', 6) } },
      ]);
      return expectAll([
        [
          cells[0]?.state === 'pass' && cells[0]?.cacheHit !== true,
          say(
            D_CACHE,
            'the first campaign runs the block (no cache hit)',
            `${cells[0]?.state} cacheHit ${cells[0]?.cacheHit}; ${raw[0]}`,
          ),
        ],
        [
          cells[1]?.cacheHit === true,
          say(
            D_CACHE,
            'a spec that differs only in its version label replays from the cache',
            `${cells[1]?.state} cacheHit ${cells[1]?.cacheHit}; ${raw[1]}`,
          ),
        ],
      ]);
    },
  );

  item(
    'cache.content-change-and-agent-version-miss',
    1,
    4,
    CORE,
    'A run is replayed only when spec content, repeat, Given, target and agent version are the same: a changed expectation or agent version runs fresh while an unchanged one replays, shortcut: the key is the spec id',
    'the cache key holds the spec hash, the whole resolved Given, the target and, when supplied, the agent version; any change is a miss and no change is a hit',
    async (ctx) => {
      const base = specOf(ctx.seed, 'miss');
      const edited = specOf(ctx.seed, 'miss', word(ctx.seed, 'cache:miss:other', 8));
      edited.id = base.id;
      const same = await campaign(ctx, 'miss-same', [{ spec: base }, { spec: base }]);
      const content = await campaign(ctx, 'miss-content', [{ spec: base }, { spec: edited }]);
      const agent = await campaign(ctx, 'miss-agent', [
        { spec: base, flags: ['--agent-version', 'v1'] },
        { spec: base, flags: ['--agent-version', 'v2'] },
      ]);
      const agentSame = await campaign(ctx, 'miss-agent-same', [
        { spec: base, flags: ['--agent-version', 'v1'] },
        { spec: base, flags: ['--agent-version', 'v1'] },
      ]);
      return expectAll([
        [
          same.cells[1]?.cacheHit === true,
          say(
            D_CACHE,
            'the same spec on the same store replays',
            `${same.cells[1]?.state} cacheHit ${same.cells[1]?.cacheHit}; ${same.raw[1]}`,
          ),
        ],
        [
          content.cells[1]?.state === 'pass' && content.cells[1]?.cacheHit !== true,
          say(
            D_CACHE,
            'a changed expectation is a cache miss',
            `${content.cells[1]?.state} cacheHit ${content.cells[1]?.cacheHit}`,
          ),
        ],
        [
          agent.cells[1]?.state === 'pass' && agent.cells[1]?.cacheHit !== true,
          say(
            D_CACHE,
            'another --agent-version is a cache miss',
            `${agent.cells[1]?.state} cacheHit ${agent.cells[1]?.cacheHit}`,
          ),
        ],
        [
          agentSame.cells[1]?.cacheHit === true,
          say(
            D_CACHE,
            'the same --agent-version replays',
            `${agentSame.cells[1]?.state} cacheHit ${agentSame.cells[1]?.cacheHit}`,
          ),
        ],
      ]);
    },
  );
}

export function adversarialItems(): BankItem[] {
  registry = [];
  toolItems();
  blockItems();
  textItems();
  stageItems();
  givenItems();
  historyItems();
  endStateItems();
  perturbationItems();
  parentItems();
  radiusItems();
  loaderItems();
  objectItems();
  valueItems();
  linkItems();
  givenHashItems();
  statsItems();
  cacheItems();
  const items = registry;
  registry = [];
  return items;
}
