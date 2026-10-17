import { type AgentLog, canonical, load, rngFor, type Seen, statusOf, type Turn } from '../blocks/harness';
import { need } from '../blocks/product';
import {
  type BankItem,
  type BlockDef,
  behaviour,
  between,
  blocks,
  call,
  codeOf,
  expectAll,
  fail,
  type ItemContext,
  injecting,
  item,
  lines,
  liveAgent,
  outcomeOfId,
  PASS,
  play,
  playP,
  type RunRecord,
  runLoaded,
  runOutcome,
  type Scenario,
  same,
  say,
  scenario,
  show,
  times,
  withAnchor,
  word,
} from './kit';

/**
 * bk-run: state across the blocks of one run (breaker-items.md, family bk-run). The end state composed over the
 * blocks, a history and a spec the runner keeps frozen, the Given merged in its order, the canonical calls of a
 * teacher-forced prefix, and parent blocks beyond the forests of the existing bank. Every item runs the shape the
 * docs say passes and a twin the docs say fails or changes.
 */

const FAMILY = 'bk-run';
const CORE = 'packages/core';

const D_END = 'docs/running.md "End state"';
const D_HISTORY = 'docs/running.md "The history"';
const D_GIVEN = 'docs/running.md "Given resolution and the hash"';
const D_TF = 'docs/concepts/run-modes.md "Teacher-forced"';
const D_PARENT = 'docs/reference/block-contracts.md "What a child starts from"';

type Mode = 'F' | 'T';

/* ------------------------------------------------------------------------------------------------------
 * The end state composed over the blocks
 * ---------------------------------------------------------------------------------------------------- */

type EndCase = { endState: unknown; calls: Record<number, ReturnType<typeof call>[]>; n: number };

async function endRun(ctx: ItemContext, tag: string, c: EndCase, mode: Mode) {
  const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, c.n, c.calls), { end_state: c.endState });
  const { rec } = await play(ctx, sc, { mode });
  const last = rec.blocks[rec.blocks.length - 1];
  const failing = (last?.verdicts ?? []).filter((v) => v.id.startsWith('end_state.') && v.outcome !== 'pass');
  return { rec, outcome: runOutcome(ctx.product, rec), failing: failing.map((v) => v.id) };
}

const holds = (r: Awaited<ReturnType<typeof endRun>>) =>
  r.rec.endState?.match === true && r.outcome === 'pass' && r.failing.length === 0;
const breaks = (r: Awaited<ReturnType<typeof endRun>>) =>
  r.rec.endState?.match === false && r.outcome === 'fail';

const endSummary = (r: Awaited<ReturnType<typeof endRun>>) =>
  `match ${show(r.rec.endState?.match)}, outcome ${r.outcome}, failing ${show(r.failing)}`;

function endItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4 | 5,
    cause: 'S1' | 'S2' | 'S2b' | 'S3' | 'S4',
    title: string,
    body: (ctx: ItemContext, tag: string) => Promise<ReturnType<typeof expectAll>>,
  ) => {
    const full = `bk.run.${id}`;
    out.push(item(FAMILY, full, tier, 1, CORE, cause, title, (ctx) => body(ctx, full)));
  };

  for (const where of ['first-block-only', 'middle-block-only'] as const) {
    add(
      `endstate-t.${where}`,
      3,
      'S1',
      `in mode T a payload recorded in the ${where.replace('-only', '').replace('-', ' ')} of the run is the end state of the run, not only the last block's session`,
      async (ctx, tag) => {
        const rng = rngFor(ctx.seed, tag);
        const n = between(rng, 3, 5);
        const at = where === 'first-block-only' ? 0 : between(rng, 1, n - 2);
        const x = word(ctx.seed, `${tag}:tool`);
        const [v1, v2] = [word(ctx.seed, `${tag}:v1`, 8), word(ctx.seed, `${tag}:v2`, 8)];
        const calls = { [at]: [call(x, { f: v1, g: v2 })] };
        const spec = (expect: Record<string, unknown>) => ({ source: `tool:${x}`, expect });
        const main = await endRun(ctx, tag, { n, calls, endState: spec({ f: v1 }) }, 'T');
        const twin = await endRun(ctx, tag, { n, calls, endState: spec({ f: `${v1}x` }) }, 'T');
        return expectAll([
          [
            holds(main),
            say(
              D_END,
              `a payload recorded in block ${at} of ${n} is the end state in mode T`,
              endSummary(main),
            ),
          ],
          [breaks(twin), say(D_END, 'another value in the expectation does not match', endSummary(twin))],
        ]);
      },
    );
  }

  add(
    'endstate-t.exact-mode',
    4,
    'S1',
    'in mode T, mode exact compares the whole composed payload of a block that is not the last',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 3, 5);
      const x = word(ctx.seed, `${tag}:tool`);
      const [v1, v2] = [word(ctx.seed, `${tag}:v1`, 8), word(ctx.seed, `${tag}:v2`, 8)];
      const calls = { 1: [call(x, { f: v1, g: v2 })] };
      const spec = (expect: Record<string, unknown>) => ({ source: `tool:${x}`, mode: 'exact', expect });
      const main = await endRun(ctx, tag, { n, calls, endState: spec({ f: v1, g: v2 }) }, 'T');
      const twin = await endRun(ctx, tag, { n, calls, endState: spec({ f: v1 }) }, 'T');
      return expectAll([
        [holds(main), say(D_END, 'mode exact with every field listed matches', endSummary(main))],
        [breaks(twin), say(D_END, 'mode exact refuses the field the spec does not list', endSummary(twin))],
      ]);
    },
  );

  add(
    'endstate-t.last-value-wins',
    4,
    'S2',
    'in mode T a source keeps the last value any block recorded',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 3, 5);
      const a = between(rng, 0, n - 2);
      const b = between(rng, a + 1, n - 1);
      const x = word(ctx.seed, `${tag}:tool`);
      const [v1, v2] = [word(ctx.seed, `${tag}:v1`, 8), word(ctx.seed, `${tag}:v2`, 8)];
      const calls = { [a]: [call(x, { f: v1 })], [b]: [call(x, { f: v2 })] };
      const spec = (value: string) => ({ source: `tool:${x}`, expect: { f: value } });
      const last = await endRun(ctx, tag, { n, calls, endState: spec(v2) }, 'T');
      const first = await endRun(ctx, tag, { n, calls, endState: spec(v1) }, 'T');
      return expectAll([
        [
          holds(last),
          say(D_END, `the value of block ${b} (the last recorded) is the end state`, endSummary(last)),
        ],
        [breaks(first), say(D_END, `the value of block ${a} is not the end state`, endSummary(first))],
      ]);
    },
  );

  add(
    'endstate-t.last-payload-whole',
    4,
    'S2b',
    'in mode T a source keeps the last payload whole, never a merge of the payloads',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 3, 5);
      const a = between(rng, 0, n - 2);
      const b = between(rng, a + 1, n - 1);
      const x = word(ctx.seed, `${tag}:tool`);
      const [v1, v2, v3] = [1, 2, 3].map((i) => word(ctx.seed, `${tag}:v${i}`, 8));
      const calls = { [a]: [call(x, { f: v1, g: v2 })], [b]: [call(x, { f: v3 })] };
      const spec = (expect: Record<string, unknown>) => ({ source: `tool:${x}`, expect });
      const last = await endRun(ctx, tag, { n, calls, endState: spec({ f: v3 }) }, 'T');
      const merged = await endRun(ctx, tag, { n, calls, endState: spec({ g: v2 }) }, 'T');
      return expectAll([
        [holds(last), say(D_END, 'the last payload is the end state', endSummary(last))],
        [
          breaks(merged),
          say(D_END, 'a field of an earlier payload is not in the end state', endSummary(merged)),
        ],
      ]);
    },
  );

  add(
    'endstate-t.two-sources',
    4,
    'S3',
    'in mode T each source of a list end state is composed on its own',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 3, 5);
      const [x1, x2] = [word(ctx.seed, `${tag}:tool1`), word(ctx.seed, `${tag}:tool2`)];
      const [v1, v2] = [word(ctx.seed, `${tag}:v1`, 8), word(ctx.seed, `${tag}:v2`, 8)];
      const calls = { 0: [call(x1, { f: v1 })], [n - 1]: [call(x2, { g: v2 })] };
      const main = await endRun(
        ctx,
        tag,
        {
          n,
          calls,
          endState: [
            { source: `tool:${x1}`, expect: { f: v1 } },
            { source: `tool:${x2}`, expect: { g: v2 } },
          ],
        },
        'T',
      );
      const swapped = await endRun(
        ctx,
        tag,
        {
          n,
          calls,
          endState: [
            { source: `tool:${x1}`, expect: { g: v2 } },
            { source: `tool:${x2}`, expect: { f: v1 } },
          ],
        },
        'T',
      );
      return expectAll([
        [
          holds(main),
          say(
            D_END,
            'both sources match, one recorded in the first block and one in the last',
            endSummary(main),
          ),
        ],
        [
          breaks(swapped),
          say(D_END, 'the expectations of the two sources swapped do not match', endSummary(swapped)),
        ],
      ]);
    },
  );

  for (const shape of ['early-payload', 'middle-payload'] as const)
    add(
      `endstate-t.none-${shape}`,
      shape === 'early-payload' ? 4 : 5,
      'S4',
      `in mode T, end_state none fails when a block before the last recorded a payload (${shape.replace('-', ' ')})`,
      async (ctx, tag) => {
        const rng = rngFor(ctx.seed, tag);
        const n = between(rng, 3, 5);
        const at = shape === 'early-payload' ? 0 : between(rng, 1, n - 2);
        const x = word(ctx.seed, `${tag}:tool`);
        const dirty = await endRun(
          ctx,
          tag,
          { n, calls: { [at]: [call(x, { f: word(ctx.seed, `${tag}:v`, 8) })] }, endState: 'none' },
          'T',
        );
        const clean = await endRun(ctx, tag, { n, calls: {}, endState: 'none' }, 'T');
        return expectAll([
          [
            breaks(dirty),
            say(D_END, `none fails: block ${at} of ${n} recorded a payload`, endSummary(dirty)),
          ],
          [holds(clean), say(D_END, 'none holds when nothing was recorded', endSummary(clean))],
        ]);
      },
    );
  return out;
}

/** A P run with a user perturbation before block 1 whose end state the agent never satisfies. */
async function endStateInP(
  ctx: ItemContext,
  tag: string,
  endState: unknown,
  calls: ReturnType<typeof call>[],
  onBlock?: ReturnType<typeof call>[],
) {
  const defs = blocks(ctx.seed, tag, 3, onBlock ? { 0: onBlock } : {});
  const injected = word(ctx.seed, `${tag}:injected`, 10);
  const pid = word(ctx.seed, `${tag}:pid`, 6);
  const mk = (extra: Record<string, unknown>) => {
    const sc = scenario(ctx.seed, tag, defs, { end_state: endState, ...extra });
    sc.plans.set(injected, { text: 'Of course.', calls });
    return sc;
  };
  const sc = mk({ perturbations: [{ id: pid, class: 'D1_off_topic', inject_at: 1, user: injected }] });
  const p = await playP(ctx, sc, pid);
  const f = await play(ctx, mk({}), { mode: 'F' });
  return { p: p.rec, f: f.rec, fOutcome: runOutcome(ctx.product, f.rec) };
}

function endStatePItems(): BankItem[] {
  const out: BankItem[] = [];
  const cases = [
    {
      id: 'not-compared',
      title:
        'in mode P the end state the agent never reaches is neither read nor compared, and the same spec in mode F fails on it',
      build: (x: string, v: string) => ({
        state: { source: `tool:${x}`, expect: { f: v } },
        calls: [] as ReturnType<typeof call>[],
        onBlock: undefined as ReturnType<typeof call>[] | undefined,
      }),
    },
    {
      id: 'none-with-payload',
      title: 'in mode P end_state none is neither read nor compared when the agent records a payload',
      build: (x: string, v: string) => ({
        state: 'none',
        calls: [] as ReturnType<typeof call>[],
        onBlock: [call(x, { f: v })],
      }),
    },
  ];
  for (const c of cases) {
    const id = `bk.run.endstate-p.${c.id}`;
    out.push(
      item(FAMILY, id, 4, 1, CORE, 'S5', c.title, async (ctx) => {
        const x = word(ctx.seed, `${id}:tool`);
        const v = word(ctx.seed, `${id}:v`, 8);
        const built = c.build(x, v);
        const r = await endStateInP(ctx, id, built.state, built.calls, built.onBlock);
        const inP = r.p.blocks.flatMap((b) =>
          b.verdicts.filter((verdict) => verdict.id.startsWith('end_state.')),
        );
        return expectAll([
          [r.p.status === 'completed', `the P run should complete; it ended ${r.p.status}`],
          [
            inP.length === 0,
            say(
              D_END,
              'a P run holds no end_state verdict',
              `verdicts ${show(inP.map((verdict) => verdict.id))}`,
            ),
          ],
          [
            runOutcome(ctx.product, r.p) !== 'fail',
            say(D_END, 'a P run does not fail on the end state', `outcome ${runOutcome(ctx.product, r.p)}`),
          ],
          [
            r.f.endState?.match === false && r.fOutcome === 'fail',
            say(
              D_END,
              'the same spec in mode F fails on the end state',
              `match ${show(r.f.endState?.match)}, outcome ${r.fOutcome}`,
            ),
          ],
        ]);
      }),
    );
  }
  return out;
}

function endVerdictItems(): BankItem[] {
  return (['T', 'F'] as const).map((mode) => {
    const id = `bk.run.endstate-verdicts.last-block-only-${mode.toLowerCase()}`;
    return item(
      FAMILY,
      id,
      3,
      1,
      CORE,
      'S6',
      `in mode ${mode} the end_state verdicts sit on the last block only, one per expected field, even when the source recorded nothing`,
      async (ctx) => {
        const rng = rngFor(ctx.seed, id);
        const n = between(rng, 3, 5);
        const x = word(ctx.seed, `${id}:tool`);
        const [f, g] = [word(ctx.seed, `${id}:f`, 5), word(ctx.seed, `${id}:g`, 5)];
        const r = await endRun(
          ctx,
          id,
          { n, calls: {}, endState: { source: `tool:${x}`, expect: { [f]: 'a', [g]: 'b' } } },
          mode,
        );
        const where = r.rec.blocks.map((b) =>
          b.verdicts.filter((v) => v.id.startsWith('end_state.')).map((v) => v.id),
        );
        const last = where[n - 1] ?? [];
        return expectAll([
          [
            where.slice(0, n - 1).every((ids) => ids.length === 0),
            say(D_END, 'no block but the last holds an end_state verdict', show(where)),
          ],
          [
            same([...last].sort(), [`end_state.${f}`, `end_state.${g}`].sort()),
            say(D_END, 'the last block holds one verdict per expected field', show(last)),
          ],
          [
            last.every((id) => outcomeOfId(r.rec.blocks[n - 1], id) === 'fail'),
            say(
              D_END,
              'a source that recorded nothing fails each field',
              show(last.map((id) => outcomeOfId(r.rec.blocks[n - 1], id))),
            ),
          ],
        ]);
      },
    );
  });
}

/* ------------------------------------------------------------------------------------------------------
 * A history, a spec and a record that stay frozen
 * ---------------------------------------------------------------------------------------------------- */

type Live = { messages: Seen[]; world: Record<string, unknown>; vars: Record<string, unknown> };
type Tamper = (live: Live) => void;

/** Runs each step apart: a runner that freezes what it hands over makes a step throw, which is not a failure. */
const attempt = (...steps: (() => void)[]) => {
  for (const step of steps) {
    try {
      step();
    } catch {
      // A frozen object refuses the edit: the history is safe, which is what the item asks.
    }
  }
};

const edit: Tamper = (live) => {
  for (const message of live.messages) {
    attempt(
      () => {
        message.content = `${message.content}#tampered`;
      },
      () => {
        message.tool_calls?.push({ label: 'tampered', input: {} });
      },
    );
    for (const each of message.tool_calls ?? []) {
      attempt(
        () => {
          const input = each.input as Record<string, unknown> | undefined;
          if (input && typeof input === 'object') input.tampered = true;
        },
        () => {
          const output = each.output as Record<string, unknown> | undefined;
          if (output && typeof output === 'object') output.tampered = true;
        },
      );
    }
  }
};

const TAMPERS: Record<string, Tamper> = {
  push: (live) =>
    attempt(
      () => {
        live.messages.push({ role: 'assistant', content: 'tampered' });
      },
      () => {
        live.messages.unshift({ role: 'system', content: 'tampered' });
      },
    ),
  clear: (live) =>
    attempt(() => {
      live.messages.length = 0;
    }),
  edit,
  world: (live) =>
    attempt(
      () => {
        const tools = live.world.tools as Record<string, { result?: Record<string, unknown> }> | undefined;
        for (const override of Object.values(tools ?? {}))
          if (override.result) override.result.tampered = true;
      },
      () => {
        const store = live.world.store as Record<string, unknown> | undefined;
        if (store) store.tampered = true;
      },
      () => {
        const fixtures = live.world.fixtures as Record<string, Record<string, unknown>> | undefined;
        for (const value of Object.values(fixtures ?? {}))
          if (value && typeof value === 'object') value.tampered = true;
      },
      () => {
        live.world.tampered = true;
      },
      () => {
        for (const value of Object.values(live.vars))
          if (value && typeof value === 'object') (value as Record<string, unknown>).tampered = true;
      },
      () => {
        live.vars.tampered = true;
      },
      () => {
        delete live.world.tools;
      },
    ),
};

type Frozen = {
  rec: RunRecord;
  log: AgentLog;
  before: string;
  after: string;
  hashBefore: unknown;
  hashAfter: unknown;
};

/** One run of a loaded scenario with an agent that tampers with what it is handed (or does not). */
async function frozenRun(
  ctx: ItemContext,
  sc: Scenario,
  tamper: Tamper | undefined,
  mode: Mode | 'P',
  pid?: string,
  specIn?: ReturnType<typeof load>,
): Promise<Frozen> {
  const log: AgentLog = { turns: [] };
  const behave = behaviour(sc, rngFor(ctx.seed, `bk:${sc.raw.id}:agent`));
  const adapter = liveAgent(
    ctx.product,
    (turn, live) => {
      const reply = behave(turn);
      tamper?.(live);
      return reply;
    },
    log,
  );
  const spec = specIn ?? load(ctx.product, sc.raw);
  const specHash = need<(spec: unknown) => unknown>(ctx.product.core, 'core', 'specHash');
  const before = canonical(spec);
  const hashBefore = specHash(spec);
  const rec = await runLoaded(ctx.product, spec, adapter, {
    mode,
    ...(pid ? { driver: injecting(ctx.product, pid), perturbationId: pid } : {}),
  });
  return { rec, log, before, after: canonical(spec), hashBefore, hashAfter: specHash(spec) };
}

const signature = (rec: RunRecord) =>
  rec.blocks.map((b) => [
    b.blockId,
    b.pass,
    b.givenHash,
    b.verdicts.map((v) => `${v.id}:${v.outcome}`),
    (b.observed as { text?: string }).text,
    canonical((b.observed as { toolCalls?: unknown }).toolCalls),
  ]);

const turnsOf = (log: AgentLog) =>
  log.turns.map((t) => ({ messages: t.messages, world: t.world, vars: t.vars }));

/** A scenario with tool calls (so the history holds records), optionally a written prefix and a Given world. */
function frozenScenario(
  ctx: ItemContext,
  tag: string,
  options: { prefix?: boolean; world?: boolean; n?: number } = {},
): Scenario {
  const n = options.n ?? 4;
  const t = word(ctx.seed, `${tag}:tool`);
  const defs = blocks(
    ctx.seed,
    tag,
    n,
    Object.fromEntries(
      times(n, (i) => [
        i,
        [call(t, { i }, { output: { ref: word(ctx.seed, `${tag}:out:${i}`, 6), n: { deep: i } } })],
      ]),
    ),
    options.prefix
      ? {
          1: {
            given: {
              origin: 'recorded',
              prefix: [
                { role: 'user', content: word(ctx.seed, `${tag}:pu`, 9) },
                {
                  role: 'assistant',
                  content: word(ctx.seed, `${tag}:pa`, 9),
                  tool_calls: [
                    {
                      id: 'rec-0',
                      label: t,
                      input: { slot: 1 },
                      output: { ref: word(ctx.seed, `${tag}:po`, 6), n: { deep: 9 } },
                    },
                  ],
                },
              ],
            },
          },
        }
      : {},
  );
  const given = options.world
    ? {
        given: {
          world: {
            tools: { [t]: { result: { a: { b: 1 } } } },
            store: { s: { a: [1] } },
            fixtures: { f: { b: { c: 2 } } },
          },
          vars: { clock: { h: 1, nested: { m: 2 } } },
        },
      }
    : {};
  return scenario(ctx.seed, tag, defs, given);
}

type FrozenCase = {
  id: string;
  tier: 3 | 4 | 5;
  cause: 'I1' | 'I2' | 'I3' | 'I4';
  mode: Mode;
  tamper: string;
  prefix?: boolean;
  world?: boolean;
  title: string;
};

const FROZEN: FrozenCase[] = [
  {
    id: 'messages-array-push',
    tier: 4,
    cause: 'I1',
    mode: 'F',
    tamper: 'push',
    title: 'an agent that pushes onto the messages array it is handed leaves the next turn its true history',
  },
  {
    id: 'messages-array-cleared',
    tier: 4,
    cause: 'I1',
    mode: 'F',
    tamper: 'clear',
    title: 'an agent that empties the messages array it is handed leaves the next turn its true history',
  },
  {
    id: 'message-object-edited',
    tier: 4,
    cause: 'I2',
    mode: 'F',
    tamper: 'edit',
    title:
      'an agent that edits the messages and tool calls it is handed leaves the next turn its true history',
  },
  {
    id: 'prefix-objects-edited-f',
    tier: 4,
    cause: 'I3',
    mode: 'F',
    tamper: 'edit',
    prefix: true,
    title:
      'an agent that edits a written prefix it is handed leaves the spec and the later blocks as they were (mode F)',
  },
  {
    id: 'prefix-objects-edited-t',
    tier: 4,
    cause: 'I3',
    mode: 'T',
    tamper: 'edit',
    prefix: true,
    title:
      'an agent that edits a written prefix it is handed leaves the spec and the later blocks as they were (mode T)',
  },
  {
    id: 'world-and-vars-edited',
    tier: 4,
    cause: 'I4',
    mode: 'F',
    tamper: 'world',
    world: true,
    title:
      'an agent that edits the world and the vars it is handed leaves the spec and the later blocks as they were',
  },
];

function frozenItems(): BankItem[] {
  const out: BankItem[] = FROZEN.map((c) => {
    const id = `bk.run.immutable.${c.id}`;
    return item(FAMILY, id, c.tier, 1, CORE, c.cause, c.title, async (ctx) => {
      const sc = frozenScenario(ctx, id, {
        ...(c.prefix ? { prefix: true } : {}),
        ...(c.world ? { world: true } : {}),
      });
      const base = await frozenRun(ctx, sc, undefined, c.mode);
      const mutant = await frozenRun(ctx, sc, TAMPERS[c.tamper] as Tamper, c.mode);
      const turnsSame = same(turnsOf(base.log), turnsOf(mutant.log));
      const first = turnsOf(base.log).findIndex((t, i) => !same(t, turnsOf(mutant.log)[i]));
      return expectAll([
        [
          base.log.turns.length === sc.users.length,
          `the benign run should send ${sc.users.length} turns; it sent ${base.log.turns.length}`,
        ],
        [
          turnsSame,
          say(
            D_HISTORY,
            'every turn the tampering agent receives equals the turn the benign agent receives',
            `turn ${first} differs: ${show(mutant.log.turns[first]?.messages?.map((m) => `${m.role}:${m.content}`))}`,
          ),
        ],
        [
          same(signature(base.rec), signature(mutant.rec)),
          say(
            D_HISTORY,
            'the recorded blocks do not depend on what the agent did to its arguments',
            'the records differ',
          ),
        ],
        [
          mutant.before === mutant.after,
          say(D_GIVEN, 'the loaded spec is the same after the run', 'the spec changed'),
        ],
      ]);
    });
  });

  for (const mode of ['F', 'T', 'P'] as const)
    out.push(
      item(
        FAMILY,
        `bk.run.immutable.spec-unchanged-after-run-${mode.toLowerCase()}`,
        3,
        1,
        CORE,
        'I5',
        `the loaded spec, with its prefix, burst, ledger, world and perturbation, is the same after a mode ${mode} run`,
        async (ctx) => {
          const id = `bk.run.immutable.spec-unchanged-after-run-${mode.toLowerCase()}`;
          const t = word(ctx.seed, `${id}:tool`);
          const defs = blocks(
            ctx.seed,
            id,
            3,
            { 0: [call(t, { a: 1 })] },
            {
              1: {
                burst: true,
                given: {
                  ledger: { k: word(ctx.seed, `${id}:k`, 6) },
                  origin: 'authored',
                  prefix: [
                    { role: 'user', content: word(ctx.seed, `${id}:pu`, 9) },
                    {
                      role: 'assistant',
                      content: word(ctx.seed, `${id}:pa`, 9),
                      tool_calls: [{ id: 'r0', label: t, input: { a: 1 }, output: { z: [1, 2] } }],
                    },
                  ],
                  world: { tools: { [t]: { result: { q: { r: 1 } } } }, store: { s: [1] } },
                  vars: { v: { w: 1 } },
                },
              },
            },
          );
          const injected = word(ctx.seed, `${id}:injected`, 10);
          const pid = word(ctx.seed, `${id}:pid`, 6);
          const sc = scenario(
            ctx.seed,
            id,
            defs,
            mode === 'P'
              ? { perturbations: [{ id: pid, class: 'D1_off_topic', inject_at: 1, user: injected }] }
              : {},
          );
          sc.plans.set(injected, { text: 'Of course.' });
          const r = await frozenRun(ctx, sc, undefined, mode, mode === 'P' ? pid : undefined);
          return expectAll([
            [r.rec.status === 'completed', `the run should complete; it ended ${r.rec.status}`],
            [
              r.before === r.after,
              say(
                D_GIVEN,
                'the loaded spec serialises the same after the run',
                'the spec changed during the run',
              ),
            ],
            [
              same(r.hashBefore, r.hashAfter),
              say(
                D_GIVEN,
                'the spec hash is the same after the run',
                `${show(r.hashBefore)} then ${show(r.hashAfter)}`,
              ),
            ],
          ]);
        },
      ),
    );

  out.push(
    item(
      FAMILY,
      'bk.run.immutable.second-run-same-spec',
      4,
      1,
      CORE,
      'I5',
      'a second run of the same loaded spec object, after an agent that tampered with everything, equals the first',
      async (ctx) => {
        const id = 'bk.run.immutable.second-run-same-spec';
        const sc = frozenScenario(ctx, id, { prefix: true, world: true });
        const spec = load(ctx.product, sc.raw);
        const one = await frozenRun(
          ctx,
          sc,
          (live) => {
            TAMPERS.edit?.(live);
            TAMPERS.world?.(live);
          },
          'F',
          undefined,
          spec,
        );
        const two = await frozenRun(
          ctx,
          sc,
          (live) => {
            TAMPERS.edit?.(live);
            TAMPERS.world?.(live);
          },
          'F',
          undefined,
          spec,
        );
        return expectAll([
          [
            same(turnsOf(one.log), turnsOf(two.log)),
            say(
              D_HISTORY,
              'both runs hand the agent the same turns',
              'the second run was handed other turns',
            ),
          ],
          [
            same(signature(one.rec), signature(two.rec)),
            say(D_HISTORY, 'both runs record the same blocks', 'the records differ'),
          ],
        ]);
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.immutable.observed-not-aliased',
      4,
      1,
      CORE,
      'I6',
      'an Observed the agent edits after returning it does not rewrite the block the runner already recorded',
      async (ctx) => {
        const id = 'bk.run.immutable.observed-not-aliased';
        const t = word(ctx.seed, `${id}:tool`);
        const sc = scenario(
          ctx.seed,
          id,
          blocks(
            ctx.seed,
            id,
            3,
            Object.fromEntries(times(3, (i) => [i, [call(t, { i }, { output: { ref: i } })]])),
          ),
        );
        const behave = behaviour(sc, rngFor(ctx.seed, id));
        const returned: Record<string, unknown>[] = [];
        const adapter = liveAgent(ctx.product, (turn) => {
          for (const old of returned) {
            attempt(() => {
              old.text = 'CHANGED';
            });
            for (const segment of (old.segments as Record<string, unknown>[]) ?? []) {
              attempt(
                () => {
                  if (segment.type === 'text') segment.text = 'CHANGED';
                },
                () => {
                  if (segment.type === 'tool_call') (segment.input as Record<string, unknown>).x = 'CHANGED';
                },
              );
            }
            for (const each of (old.toolCalls as { input: Record<string, unknown> }[]) ?? [])
              attempt(() => {
                each.input.x = 'CHANGED';
              });
          }
          const reply = behave(turn);
          returned.push(reply);
          return reply;
        });
        const rec = await runLoaded(ctx.product, load(ctx.product, sc.raw), adapter, { mode: 'F' });
        const texts = rec.blocks.map((b) => (b.observed as { text?: string }).text);
        const calls = rec.blocks.map((b) =>
          JSON.stringify(
            (b.observed as { toolCalls?: { input: unknown }[] }).toolCalls?.map((each) => each.input),
          ),
        );
        return expectAll([
          [
            texts.every((text) => text !== 'CHANGED'),
            say(
              D_HISTORY,
              'no recorded block holds text the agent edited after returning it',
              `texts ${show(texts)}`,
            ),
          ],
          [
            calls.every((each) => !each.includes('CHANGED')),
            say(
              D_HISTORY,
              'no recorded tool call holds an input the agent edited after returning it',
              `inputs ${show(calls)}`,
            ),
          ],
        ]);
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.immutable.history-not-aliased-to-record',
      5,
      1,
      CORE,
      'I7',
      'the agent editing the tool calls it reads in its history does not rewrite the block the runner recorded',
      async (ctx) => {
        const id = 'bk.run.immutable.history-not-aliased-to-record';
        const sc = frozenScenario(ctx, id, { n: 3 });
        const base = await frozenRun(ctx, sc, undefined, 'F');
        const mutant = await frozenRun(ctx, sc, edit, 'F');
        const calls = (r: Frozen) =>
          r.rec.blocks.map((b) => canonical((b.observed as { toolCalls?: unknown }).toolCalls));
        return expectAll([
          [
            same(calls(base), calls(mutant)),
            say(D_HISTORY, 'the recorded tool calls equal the benign run', `recorded ${show(calls(mutant))}`),
          ],
          [
            calls(mutant).every((each) => !each.includes('tampered')),
            say(D_HISTORY, 'no recorded tool call carries the edit', 'a recorded call carries the edit'),
          ],
        ]);
      },
    ),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * The Given merged in its order
 * ---------------------------------------------------------------------------------------------------- */

function mergeItems(): BankItem[] {
  const out: BankItem[] = [];
  out.push(
    item(
      FAMILY,
      'bk.run.merge.tools-accumulate-and-override',
      4,
      1,
      CORE,
      'G1',
      'the tools a block forces join the tools forced before it by name, and a later value for a name replaces the earlier one',
      async (ctx) => {
        const id = 'bk.run.merge.tools-accumulate-and-override';
        const [a, b] = [word(ctx.seed, `${id}:a`), word(ctx.seed, `${id}:b`)];
        const [r1, r2, r3] = [1, 2, 3].map((i) => ({ v: word(ctx.seed, `${id}:r${i}`, 8) }));
        const defs = blocks(
          ctx.seed,
          id,
          4,
          {},
          {
            1: { given: { world: { tools: { [b]: { result: r2 } } } } },
            2: { given: { world: { tools: { [a]: { result: r3 } } } } },
          },
        );
        const sc = scenario(ctx.seed, id, defs, { given: { world: { tools: { [a]: { result: r1 } } } } });
        const { log } = await play(ctx, sc, { mode: 'F' });
        const tools = log.turns.map((turn) => (turn.world as { tools?: unknown }).tools);
        const want = [
          { [a]: { result: r1 } },
          { [a]: { result: r1 }, [b]: { result: r2 } },
          { [a]: { result: r3 }, [b]: { result: r2 } },
          { [a]: { result: r3 }, [b]: { result: r2 } },
        ];
        const bad = want.findIndex((each, i) => !same(sortKeys(each), sortKeys(tools[i])));
        return bad === -1
          ? PASS
          : fail(say(D_GIVEN, `block ${bad} should receive the tools ${show(want[bad])}`, show(tools[bad])));
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.merge.store-and-fixtures-by-key',
      4,
      1,
      CORE,
      'G2',
      'the store keys and the fixtures a block sets join the earlier ones by key, the later value winning',
      async (ctx) => {
        const id = 'bk.run.merge.store-and-fixtures-by-key';
        const [x, y, z, p, q] = ['x', 'y', 'z', 'p', 'q'].map((k) => word(ctx.seed, `${id}:${k}`, 5)) as [
          string,
          string,
          string,
          string,
          string,
        ];
        const defs = blocks(
          ctx.seed,
          id,
          3,
          {},
          { 1: { given: { world: { store: { [y]: 9, [z]: 3 }, fixtures: { [q]: 2 } } } } },
        );
        const sc = scenario(ctx.seed, id, defs, {
          given: { world: { store: { [x]: 1, [y]: 2 }, fixtures: { [p]: 1 } } },
        });
        const { log } = await play(ctx, sc, { mode: 'F' });
        const worlds = log.turns.map((turn) => turn.world as { store?: unknown; fixtures?: unknown });
        const want = [
          { store: { [x]: 1, [y]: 2 }, fixtures: { [p]: 1 } },
          { store: { [x]: 1, [y]: 9, [z]: 3 }, fixtures: { [p]: 1, [q]: 2 } },
          { store: { [x]: 1, [y]: 9, [z]: 3 }, fixtures: { [p]: 1, [q]: 2 } },
        ];
        const bad = want.findIndex(
          (each, i) =>
            !same(sortKeys(each), sortKeys({ store: worlds[i]?.store, fixtures: worlds[i]?.fixtures })),
        );
        return bad === -1
          ? PASS
          : fail(
              say(
                D_GIVEN,
                `block ${bad} should receive ${show(want[bad])}`,
                show({ store: worlds[bad]?.store, fixtures: worlds[bad]?.fixtures }),
              ),
            );
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.merge.vars-through-a-gap',
      3,
      1,
      CORE,
      'G3',
      'a variable a block sets stays for the blocks that set none and joins the variables a later block sets',
      async (ctx) => {
        const id = 'bk.run.merge.vars-through-a-gap';
        const [k1, k2] = [word(ctx.seed, `${id}:k1`, 5), word(ctx.seed, `${id}:k2`, 5)];
        const [w1, w2] = [word(ctx.seed, `${id}:w1`, 6), word(ctx.seed, `${id}:w2`, 6)];
        const defs = blocks(
          ctx.seed,
          id,
          4,
          {},
          { 1: { given: { vars: { [k1]: w1 } } }, 3: { given: { vars: { [k2]: w2 } } } },
        );
        const { log } = await play(ctx, scenario(ctx.seed, id, defs), { mode: 'F' });
        const seen = log.turns.map((turn) => [turn.vars[k1], turn.vars[k2]]);
        const want = [
          [undefined, undefined],
          [w1, undefined],
          [w1, undefined],
          [w1, w2],
        ];
        return same(seen, want)
          ? PASS
          : fail(say(D_GIVEN, `the variables the blocks receive are ${show(want)}`, show(seen)));
      },
    ),
  );

  for (const mode of ['F', 'T'] as const)
    out.push(
      item(
        FAMILY,
        `bk.run.merge.ledger-add-reaches-the-next-block-${mode.toLowerCase()}`,
        4,
        1,
        CORE,
        'G4',
        `a fact a block adds with ledger_add is in the ledger of the next block (mode ${mode}): asking for it again fails the retention check`,
        async (ctx) => {
          const id = `bk.run.merge.ledger-add-reaches-the-next-block-${mode.toLowerCase()}`;
          const key = word(ctx.seed, `${id}:key`, 7);
          const value = word(ctx.seed, `${id}:value`, 8);
          const run = async (reply: string) => {
            const defs = blocks(
              ctx.seed,
              id,
              3,
              {},
              {
                1: { expect: { ledger_add: { [key]: value } } },
                2: { plan: { text: reply }, expect: { knowledge_retention: [{ fact: key }] } },
              },
            );
            // Block 2's own `must` is replaced: it expects only the retention check.
            (defs[2] as { expect: Record<string, unknown> }).expect = {
              knowledge_retention: [{ fact: key }],
            };
            return play(ctx, scenario(ctx.seed, id, defs), { mode });
          };
          const asks = await run(`What is your ${key}?`);
          const quiet = await run('Noted, thank you.');
          const vid = `knowledge_retention.${key}.asked`;
          return expectAll([
            [
              outcomeOfId(asks.rec.blocks[2], vid) === 'fail',
              say(
                'docs/reference/checks.md "Stage and facts"',
                'a question for a fact the ledger holds fails the retention check',
                `${vid}: ${outcomeOfId(asks.rec.blocks[2], vid)}`,
              ),
            ],
            [
              outcomeOfId(quiet.rec.blocks[2], vid) === 'pass',
              say(
                'docs/reference/checks.md "Stage and facts"',
                'a reply that does not ask passes it',
                `${vid}: ${outcomeOfId(quiet.rec.blocks[2], vid)}`,
              ),
            ],
          ]);
        },
      ),
    );
  return out;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  return value;
}

/* ------------------------------------------------------------------------------------------------------
 * The canonical calls of a teacher-forced prefix
 * ---------------------------------------------------------------------------------------------------- */

type CanonCall = { label: string; input?: unknown; output?: unknown; error?: unknown };

/** The tool calls the last turn's history holds, one list per assistant message, oldest first. */
function canonicalCalls(turn: Turn | undefined): CanonCall[][] {
  return (turn?.messages ?? [])
    .filter((m) => m.role === 'assistant')
    .map((m) => (m.tool_calls ?? []) as CanonCall[]);
}

/** n blocks that each expect `t` once and call it; `inputs` pins arguments, `forced` forces results from a block. */
async function canonRun(
  ctx: ItemContext,
  tag: string,
  n: number,
  t: string,
  options: {
    input?: Record<string, unknown>;
    callInput?: Record<string, unknown>;
    forced?: Record<number, Record<string, unknown>>;
  },
) {
  const more: Record<number, Partial<BlockDef>> = {};
  for (const [at, override] of Object.entries(options.forced ?? {}))
    more[Number(at)] = { given: { world: { tools: { [t]: override } } } };
  const defs = blocks(
    ctx.seed,
    tag,
    n,
    Object.fromEntries(times(n, (i) => [i, [call(t, options.callInput ?? {}, { output: { got: i } })]])),
    more,
  );
  for (const def of defs)
    (def.expect as Record<string, unknown>).tools = [
      { label: t, count: 1, ...(options.input ? { input: options.input } : {}) },
    ];
  const { log, rec } = await play(ctx, scenario(ctx.seed, tag, defs), { mode: 'T' });
  return { calls: canonicalCalls(log.turns[n - 1]), rec };
}

function canonItems(): BankItem[] {
  const out: BankItem[] = [];
  out.push(
    item(
      FAMILY,
      'bk.run.canon.forced-result-at-the-calling-block',
      5,
      1,
      CORE,
      'C1',
      'a canonical call carries the result the world forced for its tool at its own block, not the result of the block being run',
      async (ctx) => {
        const id = 'bk.run.canon.forced-result-at-the-calling-block';
        const rng = rngFor(ctx.seed, id);
        const n = between(rng, 4, 5);
        const j = between(rng, 1, n - 2);
        const t = word(ctx.seed, `${id}:tool`);
        const result = { v: word(ctx.seed, `${id}:r`, 8) };
        const { calls } = await canonRun(ctx, id, n, t, { forced: { [j]: { result } } });
        const flat = calls.map((each) => each[0]);
        const issues = flat.flatMap((each, i) => {
          if (i < j)
            return each?.output === undefined && each?.error === undefined
              ? []
              : [
                  `block ${i} should carry no result (forced from block ${j}); it carries ${show(each?.output ?? each?.error)}`,
                ];
          return same(each?.output, result)
            ? []
            : [`block ${i} should carry ${show(result)}; it carries ${show(each?.output)}`];
        });
        return expectAll([
          [
            flat.length === n - 1,
            `the last block's prefix should hold ${n - 1} calls; it holds ${flat.length}`,
          ],
          [
            issues.length === 0,
            say(D_TF, 'each canonical call carries what the world forced at its own block', issues[0] ?? ''),
          ],
        ]);
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.canon.forced-result-changes-midway',
      5,
      1,
      CORE,
      'C1',
      'a tool forced to one result and later to another gives each canonical call the result of its own block',
      async (ctx) => {
        const id = 'bk.run.canon.forced-result-changes-midway';
        const rng = rngFor(ctx.seed, id);
        const n = between(rng, 5, 6);
        const j = between(rng, 1, n - 4);
        const m = between(rng, j + 1, n - 2);
        const t = word(ctx.seed, `${id}:tool`);
        const [r1, r2] = [1, 2].map((i) => ({ v: word(ctx.seed, `${id}:r${i}`, 8) }));
        const { calls } = await canonRun(ctx, id, n, t, {
          forced: { [j]: { result: r1 }, [m]: { result: r2 } },
        });
        const flat = calls.map((each) => each[0]);
        const issues = flat.flatMap((each, i) => {
          if (i < j)
            return each?.output === undefined
              ? []
              : [`block ${i} should carry no result; it carries ${show(each?.output)}`];
          const want = i < m ? r1 : r2;
          return same(each?.output, want)
            ? []
            : [`block ${i} should carry ${show(want)}; it carries ${show(each?.output)}`];
        });
        return issues.length === 0
          ? PASS
          : fail(
              say(
                D_TF,
                'each canonical call carries what the world forced at its own block',
                issues[0] as string,
              ),
            );
      },
    ),
  );

  const falsy: [string, unknown][] = [
    ['zero', 0],
    ['false', false],
    ['empty-text', ''],
    ['empty-list', []],
    ['empty-object', {}],
  ];
  for (const [name, value] of falsy)
    out.push(
      item(
        FAMILY,
        `bk.run.canon.falsy-result.${name}`,
        4,
        1,
        CORE,
        'C2',
        `a tool forced to the result ${JSON.stringify(value)} gives its canonical call that result`,
        async (ctx) => {
          const id = `bk.run.canon.falsy-result.${name}`;
          const t = word(ctx.seed, `${id}:tool`);
          const { calls } = await canonRun(ctx, id, 3, t, { forced: { 0: { result: value } } });
          const flat = calls.map((each) => each[0]);
          const bad = flat.findIndex((each) => !same(each?.output, value));
          return flat.length === 2 && bad === -1
            ? PASS
            : fail(
                say(
                  D_TF,
                  `the canonical call holds the forced result ${JSON.stringify(value)}`,
                  `calls ${show(flat.map((each) => each?.output))}`,
                ),
              );
        },
      ),
    );

  out.push(
    item(
      FAMILY,
      'bk.run.canon.latency-only-forces-nothing',
      3,
      1,
      CORE,
      'C3',
      'a tool forced only to a latency gives its canonical call no result',
      async (ctx) => {
        const id = 'bk.run.canon.latency-only-forces-nothing';
        const t = word(ctx.seed, `${id}:tool`);
        const { calls } = await canonRun(ctx, id, 3, t, { forced: { 0: { latency_ms: 250 } } });
        const flat = calls.map((each) => each[0]);
        return flat.length === 2 &&
          flat.every((each) => each?.output === undefined && each?.error === undefined)
          ? PASS
          : fail(say(D_TF, 'a latency forces neither a result nor an error', `calls ${show(flat)}`));
      },
    ),
  );

  const pins: [string, unknown][] = [
    ['zero', 0],
    ['false', false],
    ['empty-text', ''],
    ['null', null],
  ];
  for (const [name, value] of pins)
    out.push(
      item(
        FAMILY,
        `bk.run.canon.pinned-falsy.${name}`,
        4,
        1,
        CORE,
        'C4',
        `a field pinned to ${JSON.stringify(value)} is in the input of the canonical call`,
        async (ctx) => {
          const id = `bk.run.canon.pinned-falsy.${name}`;
          const [t, key] = [word(ctx.seed, `${id}:tool`), word(ctx.seed, `${id}:key`, 5)];
          const { calls } = await canonRun(ctx, id, 3, t, {
            input: { [key]: value },
            callInput: { [key]: value },
          });
          const flat = calls.map((each) => each[0]);
          return flat.length === 2 && flat.every((each) => same(each?.input, { [key]: value }))
            ? PASS
            : fail(
                say(
                  D_TF,
                  `the canonical input is ${show({ [key]: value })}`,
                  `inputs ${show(flat.map((each) => each?.input))}`,
                ),
              );
        },
      ),
    );

  out.push(
    item(
      FAMILY,
      'bk.run.canon.pinned-exact-object',
      4,
      1,
      CORE,
      'C5',
      'a field pinned with exact to an object is carried whole in the canonical call',
      async (ctx) => {
        const id = 'bk.run.canon.pinned-exact-object';
        const [t, key, inner] = [
          word(ctx.seed, `${id}:tool`),
          word(ctx.seed, `${id}:key`, 5),
          word(ctx.seed, `${id}:inner`, 4),
        ];
        const object = { [inner]: [1, 2] };
        const { calls } = await canonRun(ctx, id, 3, t, {
          input: { [key]: { exact: object } },
          callInput: { [key]: object },
        });
        const flat = calls.map((each) => each[0]);
        return flat.length === 2 && flat.every((each) => same(each?.input, { [key]: object }))
          ? PASS
          : fail(
              say(
                D_TF,
                `the canonical input is ${show({ [key]: object })}`,
                `inputs ${show(flat.map((each) => each?.input))}`,
              ),
            );
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.canon.unpinned-forms-left-out',
      4,
      1,
      CORE,
      'C6',
      'fields asserted by subset, nonempty, absent or one_of are left out of the canonical call, a bare value is kept',
      async (ctx) => {
        const id = 'bk.run.canon.unpinned-forms-left-out';
        const t = word(ctx.seed, `${id}:tool`);
        const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((k) => word(ctx.seed, `${id}:${k}`, 5)) as [
          string,
          string,
          string,
          string,
          string,
        ];
        const bare = word(ctx.seed, `${id}:bare`, 6);
        const input = {
          [a]: { subset: { x: 1 } },
          [b]: { nonempty: true },
          [c]: { absent: true },
          [d]: { one_of: ['p', 'q'] },
          [e]: bare,
        };
        const { calls } = await canonRun(ctx, id, 3, t, {
          input,
          callInput: { [a]: { x: 1 }, [b]: 'z', [d]: 'p', [e]: bare },
        });
        const flat = calls.map((each) => each[0]);
        return flat.length === 2 && flat.every((each) => same(each?.input, { [e]: bare }))
          ? PASS
          : fail(
              say(
                D_TF,
                `the canonical input holds only the bare value ${show({ [e]: bare })}`,
                `inputs ${show(flat.map((each) => each?.input))}`,
              ),
            );
      },
    ),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * Parent blocks beyond the existing forests
 * ---------------------------------------------------------------------------------------------------- */

const blockId = (seed: number, tag: string, index: number) => word(seed, `${tag}:block:${index}`, 6);

function parentItems(): BankItem[] {
  const out: BankItem[] = [];
  const turnOf = (log: AgentLog, user: string) => log.turns.find((turn) => turn.user.includes(user));

  out.push(
    item(
      FAMILY,
      'bk.run.parents.burst-parent-both-messages',
      4,
      2,
      CORE,
      'R1',
      'a child of a parent that sent a burst holds both messages, in the order written, then the reply',
      async (ctx) => {
        const id = 'bk.run.parents.burst-parent-both-messages';
        const defs = blocks(
          ctx.seed,
          id,
          2,
          {},
          { 0: { burst: true }, 1: { extra: { parent: blockId(ctx.seed, id, 0) } } },
        );
        const sc = scenario(ctx.seed, id, defs);
        const { log } = await play(ctx, sc, { mode: 'F' });
        const child = turnOf(log, sc.users[1] as string);
        const want = [
          `user:${sc.users[0]}`,
          `user:${sc.seconds[0]}`,
          `assistant:${(defs[0] as BlockDef).plan.text}`,
          `user:${sc.users[1]}`,
        ];
        return child && same(lines(child.messages), want)
          ? PASS
          : fail(
              say(
                'docs/reference/block-contracts.md "What a child starts from"',
                `the child's history is ${show(want)}`,
                child ? show(lines(child.messages)) : 'the child was never sent',
              ),
            );
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.parents.parent-own-prefix-inherited',
      4,
      2,
      CORE,
      'R2',
      'a child with no prefix inherits the written prefix its parent started from',
      async (ctx) => {
        const id = 'bk.run.parents.parent-own-prefix-inherited';
        const [pu, pa] = [word(ctx.seed, `${id}:pu`, 9), word(ctx.seed, `${id}:pa`, 9)];
        const defs = blocks(
          ctx.seed,
          id,
          2,
          {},
          {
            0: {
              given: {
                prefix: [
                  { role: 'user', content: pu },
                  { role: 'assistant', content: pa },
                ],
              },
            },
            1: { extra: { parent: blockId(ctx.seed, id, 0) } },
          },
        );
        const sc = scenario(ctx.seed, id, defs);
        const { log } = await play(ctx, sc, { mode: 'F' });
        const child = turnOf(log, sc.users[1] as string);
        const want = [
          `user:${pu}`,
          `assistant:${pa}`,
          `user:${sc.users[0]}`,
          `assistant:${(defs[0] as BlockDef).plan.text}`,
          `user:${sc.users[1]}`,
        ];
        return child && same(lines(child.messages), want)
          ? PASS
          : fail(
              say(
                D_PARENT,
                `the child's history is ${show(want)}`,
                child ? show(lines(child.messages)) : 'the child was never sent',
              ),
            );
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.parents.unrun-root-grandchild',
      4,
      2,
      CORE,
      'R3',
      'a not-run root blocks its child and its grandchild, each by its own parent, all rooted at the root; none is sent',
      async (ctx) => {
        const id = 'bk.run.parents.unrun-root-grandchild';
        const t = word(ctx.seed, `${id}:tool`);
        const defs = blocks(
          ctx.seed,
          id,
          3,
          {},
          {
            0: { given: { world: { tools: { [t]: { result: { ok: true } } } } } },
            1: { extra: { parent: blockId(ctx.seed, id, 0) } },
            2: { extra: { parent: blockId(ctx.seed, id, 1) } },
          },
        );
        const sc = scenario(ctx.seed, id, defs);
        const { rec, log } = await play(ctx, sc, { mode: 'F', capabilities: { toolStubs: false } });
        const [root, child, grand] = rec.blocks;
        const ids = [0, 1, 2].map((i) => blockId(ctx.seed, id, i));
        return expectAll([
          [
            root !== undefined &&
              statusOf(ctx.product, root) === 'not_run' &&
              root.notRun?.kind === 'unsupported',
            say(
              D_PARENT,
              'the root is not_run (unsupported)',
              `${root ? statusOf(ctx.product, root) : 'absent'}`,
            ),
          ],
          [
            child !== undefined &&
              statusOf(ctx.product, child) === 'blocked' &&
              child.blocked?.by === ids[0] &&
              child.blocked?.root === ids[0],
            say(D_PARENT, `the child is blocked by the root, root the root`, show(child?.blocked)),
          ],
          [
            grand !== undefined &&
              statusOf(ctx.product, grand) === 'blocked' &&
              grand.blocked?.by === ids[1] &&
              grand.blocked?.root === ids[0],
            say(D_PARENT, `the grandchild is blocked by the child, root the root`, show(grand?.blocked)),
          ],
          [
            log.turns.length === 0,
            say(D_PARENT, 'none of the three is sent', `${log.turns.length} turns were sent`),
          ],
        ]);
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.parents.blocked-has-no-trace',
      4,
      2,
      CORE,
      'R4',
      'a blocked block holds no verdict, text, call or cost, is never sent, and is counted apart from the failures',
      async (ctx) => {
        const id = 'bk.run.parents.blocked-has-no-trace';
        const defs = blocks(
          ctx.seed,
          id,
          3,
          {},
          {
            0: { plan: { text: 'Let me look.' } },
            1: { extra: { parent: blockId(ctx.seed, id, 0) } },
          },
        );
        const sc = scenario(ctx.seed, id, defs);
        const { rec, log } = await play(ctx, sc, { mode: 'F' });
        const child = rec.blocks.find((b) => b.blockId === blockId(ctx.seed, id, 1));
        const countBlocks = need<(blocks: unknown[]) => Record<string, number>>(
          ctx.product.core,
          'core',
          'countBlocks',
        );
        const counts = countBlocks(rec.blocks);
        const observed = (child?.observed ?? {}) as {
          text?: string;
          toolCalls?: unknown[];
          cost?: { usd?: number };
        };
        return expectAll([
          [
            child !== undefined && child.pass === false && child.verdicts.length === 0,
            say(
              D_PARENT,
              'the blocked child has pass false and no verdict',
              child ? `pass ${child.pass}, ${child.verdicts.length} verdicts` : 'absent',
            ),
          ],
          [
            !observed.text && (observed.toolCalls ?? []).length === 0 && !observed.cost?.usd,
            say(D_PARENT, 'it holds no text, call or cost', show(observed)),
          ],
          [
            !log.turns.some((turn) => turn.user.includes(sc.users[1] as string)),
            say(D_PARENT, 'the child is never sent', 'the child reached the agent'),
          ],
          [
            counts.fail === 1 && counts.blocked === 1 && counts.pass === 1,
            say(D_PARENT, 'the counts are 1 fail, 1 blocked and 1 pass', show(counts)),
          ],
        ]);
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.run.parents.ledger-inherited-by-child',
      4,
      2,
      CORE,
      'R5',
      'a child holds the ledger facts its parent established: asking for one fails its retention check',
      async (ctx) => {
        const id = 'bk.run.parents.ledger-inherited-by-child';
        const key = word(ctx.seed, `${id}:key`, 7);
        const value = word(ctx.seed, `${id}:value`, 8);
        const run = async (reply: string) => {
          const defs = blocks(
            ctx.seed,
            id,
            2,
            {},
            {
              0: { expect: { ledger_add: { [key]: value } } },
              1: { plan: { text: reply }, extra: { parent: blockId(ctx.seed, id, 0) } },
            },
          );
          (defs[1] as { expect: Record<string, unknown> }).expect = { knowledge_retention: [{ fact: key }] };
          return play(ctx, scenario(ctx.seed, id, defs), { mode: 'F' });
        };
        const asks = await run(`What is your ${key}?`);
        const quiet = await run('Noted, thank you.');
        const vid = `knowledge_retention.${key}.asked`;
        return expectAll([
          [
            outcomeOfId(asks.rec.blocks[1], vid) === 'fail',
            say(
              D_PARENT,
              "a child asking for its parent's fact fails the retention check",
              `${vid}: ${outcomeOfId(asks.rec.blocks[1], vid)}`,
            ),
          ],
          [
            outcomeOfId(quiet.rec.blocks[1], vid) === 'pass',
            say(
              D_PARENT,
              'a child that does not ask passes it',
              `${vid}: ${outcomeOfId(quiet.rec.blocks[1], vid)}`,
            ),
          ],
        ]);
      },
    ),
  );
  return out;
}

/** Items of the family bk-run: 48. */
export function runItems(): BankItem[] {
  // These items read no verdict a cheating product changes, so they run the baseline first (kit.anchor).
  const anchored =
    /^bk\.run\.immutable\.(spec-unchanged-after-run|second-run-same-spec|observed-not-aliased|history-not-aliased)/;
  return [
    ...endItems(),
    ...endStatePItems(),
    ...endVerdictItems(),
    ...frozenItems(),
    ...mergeItems(),
    ...canonItems(),
    ...parentItems(),
  ].map((entry) => (anchored.test(entry.id) ? { ...entry, check: withAnchor(entry.check) } : entry));
}
