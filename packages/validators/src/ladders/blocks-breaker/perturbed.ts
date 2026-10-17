import { observed, rngFor, type Turn } from '../blocks/harness';
import {
  type BankItem,
  between,
  blocks,
  type Call,
  call,
  codeOf,
  expectAll,
  fail,
  type ItemContext,
  type ItemResult,
  item,
  lines,
  observedParts,
  outcomeOfId,
  PASS,
  type Played,
  play,
  playP,
  type RunRecord,
  runOutcome,
  same,
  say,
  scenario,
  show,
  times,
  word,
} from './kit';

/**
 * bk-perturbed: where a perturbation goes, what the modes P and T do with it, and the recovery metrics of a P run
 * (breaker-items.md, family bk-perturbed). The scripted agent answers by user word: a reply carries the block's
 * code to pass its `must`, or omits it to fail.
 */

const FAMILY = 'bk-perturbed';
const CORE = 'packages/core';
const D_PERT = 'docs/concepts/recovery.md "Writing a perturbation"';
const D_MODES = 'docs/concepts/run-modes.md "Perturbed"';
const D_REC = 'docs/concepts/recovery.md "Recovery metrics"';

type Pert = Record<string, unknown>;

const injectedFlags = (rec: RunRecord) =>
  rec.blocks.map((b) => (b as unknown as { injected?: boolean }).injected === true);
const turnLines = (turn: Turn | undefined) => (turn ? lines(turn.messages) : []);

/** The spec blocks' users, with the injected text in the place the run sends it. */
function sentOrder(users: readonly string[], at: number, injected: readonly string[]) {
  return [...users.slice(0, at), ...injected, ...users.slice(at)];
}

type Placed = {
  played: Played;
  users: string[];
  ids: string[];
  pid: string;
  injected: string[];
  reply: string;
  t: string;
  error: string;
};

/** A P run of n blocks with one perturbation, built by `make` from the seeded names. */
async function placed(
  ctx: ItemContext,
  tag: string,
  n: number,
  make: (names: { pid: string; i1: string; i2: string; t: string; error: string }) => Pert,
  options: { spec?: Record<string, unknown>; code?: boolean } = {},
): Promise<Placed> {
  const names = {
    pid: word(ctx.seed, `${tag}:pid`, 6),
    i1: word(ctx.seed, `${tag}:i1`, 10),
    i2: word(ctx.seed, `${tag}:i2`, 10),
    t: word(ctx.seed, `${tag}:tool`),
    error: word(ctx.seed, `${tag}:error`, 12),
  };
  const reply = word(ctx.seed, `${tag}:reply`, 9);
  const perturbation = { id: names.pid, class: 'D1_off_topic', ...make(names) };
  const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, n), {
    ...(options.spec ?? {}),
    perturbations: [perturbation],
  });
  sc.plans.set(names.i1, { text: reply });
  sc.plans.set(names.i2, { text: reply });
  const played = await playP(ctx, sc, names.pid);
  return {
    played,
    users: sc.users,
    ids: sc.ids,
    pid: names.pid,
    injected: [names.i1, names.i2],
    reply,
    t: names.t,
    error: names.error,
  };
}

function placementItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4 | 5,
    cause: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) => {
    const full = `bk.perturbed.placement.${id}`;
    out.push(item(FAMILY, full, tier, 1, CORE, cause, title, (ctx) => check(ctx, full)));
  };

  add(
    'after-last-user',
    4,
    'P1',
    'a user perturbation with inject_at equal to the number of blocks is sent after the last block as a block of its own',
    async (ctx, tag) => {
      const n = between(rngFor(ctx.seed, tag), 3, 4);
      const r = await placed(ctx, tag, n, (m) => ({ inject_at: n, user: m.i1 }));
      const flags = injectedFlags(r.played.rec);
      const sent = r.played.log.turns.map((turn) => turn.user);
      const want = sentOrder(r.users, n, [r.injected[0] as string]);
      return expectAll([
        [
          r.played.rec.blocks.length === n + 1,
          say(D_PERT, `the run holds ${n + 1} blocks`, `${r.played.rec.blocks.length}`),
        ],
        [
          same(flags, [...times(n, () => false), true]),
          say(D_PERT, 'only the last block is injected', show(flags)),
        ],
        [
          sent.length === want.length && sent.every((text, i) => text.includes(want[i] as string)),
          say(D_PERT, 'the injected text is sent last', show(sent)),
        ],
      ]);
    },
  );

  add(
    'after-last-burst',
    4,
    'P1',
    'a burst perturbation with inject_at equal to the number of blocks reaches the agent as two user messages after the last block',
    async (ctx, tag) => {
      const n = between(rngFor(ctx.seed, tag), 3, 4);
      const r = await placed(ctx, tag, n, (m) => ({ inject_at: n, burst: [m.i1, m.i2] }));
      const last = r.played.log.turns[n];
      const tail = turnLines(last).slice(-2);
      return expectAll([
        [
          r.played.rec.blocks.length === n + 1,
          say(D_PERT, `the run holds ${n + 1} blocks`, `${r.played.rec.blocks.length}`),
        ],
        [
          same(tail, [`user:${r.injected[0]}`, `user:${r.injected[1]}`]),
          say(D_PERT, 'the last turn ends with the two burst messages, in order', show(tail)),
        ],
      ]);
    },
  );

  add(
    'burst-before-middle',
    3,
    'P2',
    'a burst perturbation before a middle block reaches the agent as two user messages and stays in the history of the next block',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 4, 5);
      const k = between(rng, 1, n - 2);
      const r = await placed(ctx, tag, n, (m) => ({ inject_at: k, burst: [m.i1, m.i2] }));
      const turns = r.played.log.turns;
      const injectedTail = turnLines(turns[k]).slice(-2);
      const next = turnLines(turns[k + 1]).slice(-4);
      return expectAll([
        [
          same(injectedTail, [`user:${r.injected[0]}`, `user:${r.injected[1]}`]),
          say(D_PERT, 'the injected turn ends with the two burst messages, in order', show(injectedTail)),
        ],
        [
          same(next, [
            `user:${r.injected[0]}`,
            `user:${r.injected[1]}`,
            `assistant:${r.reply}`,
            `user:${r.users[k]}`,
          ]),
          say(D_PERT, 'the next spec block holds both messages, the reply, then its own message', show(next)),
        ],
      ]);
    },
  );

  add(
    'user-and-world-persist',
    4,
    'P3',
    'a perturbation with a message and a world forces the tool from the injected block on, the resumed block included',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 4, 5);
      const k = between(rng, 1, n - 2);
      const r = await placed(ctx, tag, n, (m) => ({
        inject_at: k,
        user: m.i1,
        world: { tools: { [m.t]: { error: m.error } } },
      }));
      const errorOf = (turn: Turn | undefined) =>
        (turn?.world as { tools?: Record<string, { error?: string }> } | undefined)?.tools?.[r.t]?.error;
      const seen = r.played.log.turns.map(errorOf);
      const want = seen.map((_, i) => (i < k ? undefined : r.error));
      return same(seen, want)
        ? PASS
        : fail(say(D_PERT, `the tool is forced from turn ${k} on (${n + 1} turns)`, show(seen)));
    },
  );

  add(
    'world-merges-by-name',
    5,
    'P3',
    'the world of a world-only perturbation joins the tools the spec already forced, by name',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 4, 5);
      const k = between(rng, 1, n - 2);
      const a = word(ctx.seed, `${tag}:a`);
      const result = { v: word(ctx.seed, `${tag}:r`, 8) };
      const r = await placed(
        ctx,
        tag,
        n,
        (m) => ({ inject_at: k, world: { tools: { [m.t]: { error: m.error } } } }),
        { spec: { given: { world: { tools: { [a]: { result } } } } } },
      );
      const tools = r.played.log.turns.map(
        (turn) => (turn.world as { tools?: Record<string, unknown> }).tools ?? {},
      );
      const bad = tools.findIndex(
        (each, i) =>
          !same(Object.keys(each).sort(), (i < k ? [a] : [a, r.t]).sort()) || !same(each[a], { result }),
      );
      return bad === -1 && tools.length === n
        ? PASS
        : fail(
            say(
              D_PERT,
              `turns before ${k} see only ${a}; the others see ${a} and ${r.t}`,
              `turn ${bad}: ${show(tools[bad])}`,
            ),
          );
    },
  );

  for (const where of ['first', 'last'] as const)
    add(
      `world-only-${where}-block`,
      4,
      'P4',
      `a world-only perturbation at the ${where} block stands in for it: no extra block, the block sends its own text with the world`,
      async (ctx, tag) => {
        const n = between(rngFor(ctx.seed, tag), 3, 4);
        const k = where === 'first' ? 0 : n - 1;
        const r = await placed(ctx, tag, n, (m) => ({
          inject_at: k,
          world: { tools: { [m.t]: { error: m.error } } },
        }));
        const flags = injectedFlags(r.played.rec);
        const turn = r.played.log.turns[k];
        const tools = (turn?.world as { tools?: Record<string, { error?: string }> } | undefined)?.tools;
        return expectAll([
          [
            r.played.rec.blocks.length === n && r.played.log.turns.length === n,
            say(
              D_PERT,
              `the run holds ${n} blocks and ${n} turns`,
              `${r.played.rec.blocks.length} blocks, ${r.played.log.turns.length} turns`,
            ),
          ],
          [
            flags[k] === true && flags.filter(Boolean).length === 1,
            say(D_PERT, `block ${k} is the injected one`, show(flags)),
          ],
          [
            turn?.user.includes(r.users[k] as string) === true,
            say(D_PERT, `the injected block sends the text of block ${k}`, turn?.user ?? 'no turn'),
          ],
          [tools?.[r.t]?.error === r.error, say(D_PERT, 'it carries the forced error', show(tools))],
        ]);
      },
    );

  add(
    'injected-expect-is-its-own',
    4,
    'P5',
    'the expectations of a perturbation are checked on the injected block only',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 3, 4);
      const k = between(rng, 1, n - 1);
      const want = word(ctx.seed, `${tag}:want`, 10);
      const run = async (replyHas: boolean) => {
        const names = { pid: word(ctx.seed, `${tag}:pid`, 6), inj: word(ctx.seed, `${tag}:inj`, 10) };
        const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, n), {
          perturbations: [
            { id: names.pid, class: 'D1_off_topic', inject_at: k, user: names.inj, expect: { must: [want] } },
          ],
        });
        sc.plans.set(names.inj, { text: replyHas ? `Sure, ${want}.` : 'Sure.' });
        return playP(ctx, sc, names.pid);
      };
      const broken = await run(false);
      const clean = await run(true);
      const outcomes = (p: Played) => p.rec.blocks.map((b) => outcomeOfId(b, 'must.0'));
      return expectAll([
        [
          same(
            outcomes(broken),
            outcomes(broken).map((_, i) => (i === k ? 'fail' : 'pass')),
          ),
          say(D_PERT, `only the injected block (${k}) fails its must`, show(outcomes(broken))),
        ],
        [
          runOutcome(ctx.product, broken.rec) === 'fail',
          say(D_PERT, 'the run fails', runOutcome(ctx.product, broken.rec)),
        ],
        [
          outcomes(clean).every((o) => o === 'pass') && runOutcome(ctx.product, clean.rec) === 'pass',
          say(D_PERT, 'a reply that meets the expectation passes everywhere', show(outcomes(clean))),
        ],
      ]);
    },
  );

  add(
    'history-after-the-injection',
    4,
    'P6',
    'the blocks after a user injection hold the injected message and the agent reply to it in their history',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 3, 4);
      const k = between(rng, 1, n - 1);
      const r = await placed(ctx, tag, n, (m) => ({ inject_at: k, user: m.i1 }));
      const next = turnLines(r.played.log.turns[k + 1]).slice(-3);
      return same(next, [`user:${r.injected[0]}`, `assistant:${r.reply}`, `user:${r.users[k]}`])
        ? PASS
        : fail(
            say(
              D_MODES,
              'the next spec block holds the injected exchange before its own message',
              show(next),
            ),
          );
    },
  );

  add(
    'one-perturbation-per-run',
    4,
    'P7',
    'a P run injects the one perturbation it is given, not the others the spec lists',
    async (ctx, tag) => {
      const rng = rngFor(ctx.seed, tag);
      const n = between(rng, 4, 5);
      const names = {
        a: word(ctx.seed, `${tag}:a`, 6),
        b: word(ctx.seed, `${tag}:b`, 6),
        ta: word(ctx.seed, `${tag}:ta`, 10),
        tb: word(ctx.seed, `${tag}:tb`, 10),
      };
      const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, n), {
        perturbations: [
          { id: names.a, class: 'D1_off_topic', inject_at: 1, user: names.ta },
          { id: names.b, class: 'D1_off_topic', inject_at: 2, user: names.tb },
        ],
      });
      sc.plans.set(names.ta, { text: 'Sure.' });
      sc.plans.set(names.tb, { text: 'Sure.' });
      const { rec, log } = await playP(ctx, sc, names.b);
      const flags = injectedFlags(rec);
      return expectAll([
        [rec.blocks.length === n + 1, say(D_PERT, `the run holds ${n + 1} blocks`, `${rec.blocks.length}`)],
        [
          flags.indexOf(true) === 2 && flags.filter(Boolean).length === 1,
          say(D_PERT, 'the injected block sits at position 2', show(flags)),
        ],
        [
          !log.turns.some((turn) => turn.user.includes(names.ta)),
          say(D_PERT, 'the text of the other perturbation is never sent', 'it was sent'),
        ],
      ]);
    },
  );
  return out;
}

function modeItems(): BankItem[] {
  const out: BankItem[] = [];
  out.push(
    item(
      FAMILY,
      'bk.perturbed.modes.t-refuses-an-injecting-driver',
      4,
      1,
      CORE,
      'P8',
      'a driver that injects a block in mode T fails the run, while the same driver in mode P runs the injection',
      async (ctx) => {
        const id = 'bk.perturbed.modes.t-refuses-an-injecting-driver';
        const n = 3;
        const names = { pid: word(ctx.seed, `${id}:pid`, 6), inj: word(ctx.seed, `${id}:inj`, 10) };
        const mk = () => {
          const sc = scenario(ctx.seed, id, blocks(ctx.seed, id, n), {
            perturbations: [{ id: names.pid, class: 'D1_off_topic', inject_at: 1, user: names.inj }],
          });
          sc.plans.set(names.inj, { text: 'Sure.' });
          return sc;
        };
        const inP = await playP(ctx, mk(), names.pid);
        let failed = false;
        let detail = '';
        try {
          const inT = await playP(ctx, mk(), names.pid, { mode: 'T' });
          failed = runOutcome(ctx.product, inT.rec) === 'fail' || inT.rec.status !== 'completed';
          detail = `status ${inT.rec.status}, outcome ${runOutcome(ctx.product, inT.rec)}`;
        } catch {
          failed = true;
        }
        return expectAll([
          [
            inP.rec.status === 'completed' && inP.rec.blocks.length === n + 1,
            say(
              D_MODES,
              'the P run completes with the injected block',
              `status ${inP.rec.status}, ${inP.rec.blocks.length} blocks`,
            ),
          ],
          [
            failed,
            say('docs/running.md "One block"', 'the injecting driver in mode T fails the run', detail),
          ],
        ]);
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.perturbed.modes.p-unsupported-layer-cascades',
      4,
      1,
      CORE,
      'P9',
      'in mode P a layer the adapter cannot apply leaves every later block, the injected one included, not_run and unsent; without the layer the same run passes',
      async (ctx) => {
        const id = 'bk.perturbed.modes.p-unsupported-layer-cascades';
        const n = 3;
        const t = word(ctx.seed, `${id}:tool`);
        const names = { pid: word(ctx.seed, `${id}:pid`, 6), inj: word(ctx.seed, `${id}:inj`, 10) };
        const mk = (stub: boolean) => {
          const defs = blocks(
            ctx.seed,
            id,
            n,
            {},
            stub ? { 0: { given: { world: { tools: { [t]: { result: { ok: true } } } } } } } : {},
          );
          const sc = scenario(ctx.seed, id, defs, {
            perturbations: [{ id: names.pid, class: 'D1_off_topic', inject_at: 1, user: names.inj }],
          });
          sc.plans.set(names.inj, { text: 'Sure.' });
          return sc;
        };
        const stubbed = await playP(ctx, mk(true), names.pid, { capabilities: { toolStubs: false } });
        const clean = await playP(ctx, mk(false), names.pid, { capabilities: { toolStubs: false } });
        const statuses = (p: Played) => p.rec.blocks.map((b) => b.status ?? (b.pass ? 'pass' : 'fail'));
        return expectAll([
          [
            statuses(stubbed).length >= n && statuses(stubbed).every((s) => s === 'not_run'),
            say(D_MODES, 'every block of the P run is not_run', show(statuses(stubbed))),
          ],
          [
            stubbed.log.turns.length === 0,
            say(D_MODES, 'the agent is sent nothing', `${stubbed.log.turns.length} turns`),
          ],
          [
            statuses(clean).length === n + 1 && statuses(clean).every((s) => s === 'pass'),
            say(D_MODES, 'without the layer every block passes', show(statuses(clean))),
          ],
        ]);
      },
    ),
  );

  out.push(
    item(
      FAMILY,
      'bk.perturbed.recovery.written-only-with-recovery',
      3,
      1,
      CORE,
      'P10',
      'a P run records its recovery only when the perturbation writes recovery, with the position of the injected block',
      async (ctx) => {
        const id = 'bk.perturbed.recovery.written-only-with-recovery';
        const rng = rngFor(ctx.seed, id);
        const n = between(rng, 3, 4);
        const k = between(rng, 1, n - 1);
        const run = async (recovery: boolean) => {
          const r = await placed(ctx, id, n, (m) => ({
            inject_at: k,
            user: m.i1,
            ...(recovery ? { recovery: { within_blocks: 1 } } : {}),
          }));
          return r.played.rec as RunRecord & { recovery?: { injectedAt?: number } };
        };
        const without = await run(false);
        const withIt = await run(true);
        return expectAll([
          [
            without.recovery === undefined,
            say(D_REC, 'no recovery record without recovery', show(without.recovery)),
          ],
          [withIt.recovery?.injectedAt === k, say(D_REC, `injectedAt is ${k}`, show(withIt.recovery))],
        ]);
      },
    ),
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * Recovery metrics
 * ---------------------------------------------------------------------------------------------------- */

type SpecStep = {
  ok?: boolean;
  stage?: string;
  failIf?: (turn: Turn, seen: boolean) => boolean;
  expectStage?: string;
};
type Cfg = {
  n: number;
  k: number;
  /** Per spec block: pass (default), the stage it reports, a condition that makes it fail, the stage it expects. */
  spec?: Record<number, SpecStep>;
  injected?: { ok?: boolean; stage?: string; parts?: ({ text: string } | { call: Call })[]; calls?: Call[] };
  pert?: Record<string, unknown>;
  recovery?: Record<string, unknown> | null;
  spec_extra?: Record<string, unknown>;
  worldOnly?: boolean;
  reference?: boolean;
  consequential?: (label: string) => boolean;
};

type Metrics = {
  injectedAt?: number;
  turnsToRecover?: number;
  label?: string;
  collateral?: number;
  safeAction?: boolean;
  clarified?: boolean;
};

async function recoveryRun(
  ctx: ItemContext,
  tag: string,
  cfg: Cfg,
): Promise<{ rec: RunRecord & { recovery?: Metrics }; metrics: Metrics | undefined; played: Played }> {
  const stages = [1, 2, 3].map((i) => word(ctx.seed, `${tag}:stage${i}`, 6));
  const names = {
    pid: word(ctx.seed, `${tag}:pid`, 6),
    inj: word(ctx.seed, `${tag}:inj`, 10),
    t: word(ctx.seed, `${tag}:tool`),
    error: word(ctx.seed, `${tag}:error`, 12),
  };
  const injCode = word(ctx.seed, `${tag}:injcode`, 10);
  const seen = (turn: Turn) =>
    turn.messages.some((m) => m.content.includes(names.inj)) ||
    Object.keys((turn.world as { tools?: Record<string, unknown> }).tools ?? {}).includes(names.t);
  const defs = times(cfg.n, (i) => {
    const step = cfg.spec?.[i] ?? {};
    const code = codeOf(ctx.seed, tag, i);
    const resolve = (name: string | undefined) =>
      name === undefined ? undefined : (stages[Number(name.slice(1)) - 1] as string);
    return {
      plan: {
        text: '',
        reply: (turn: Turn) => {
          const fails = step.ok === false || (step.failIf?.(turn, seen(turn)) ?? false);
          return observed(fails ? 'Let me look.' : `Yes, ${code}.`, [], resolve(step.stage));
        },
      },
      expect: { must: [code], ...(step.expectStage ? { stage: resolve(step.expectStage) } : {}) },
    };
  });
  const recoveryField = cfg.recovery === null ? {} : { recovery: cfg.recovery ?? { within_blocks: 1 } };
  const pertExpect = (cfg.pert?.expect ?? {}) as Record<string, unknown>;
  const fixStages = (value: unknown): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          key === 'stage' || key === 'stage_after'
            ? stages[Number(String(entry).slice(1)) - 1]
            : fixStages(entry),
        ]),
      );
    return value;
  };
  const perturbation = {
    id: names.pid,
    class: cfg.worldOnly ? 'D8_tool_failure' : 'D1_off_topic',
    inject_at: cfg.k,
    ...(cfg.worldOnly ? { world: { tools: { [names.t]: { error: names.error } } } } : { user: names.inj }),
    ...(cfg.worldOnly && !cfg.pert?.expect
      ? {}
      : { expect: { must: [injCode], ...(fixStages(pertExpect) as Record<string, unknown>) } }),
    ...(fixStages(recoveryField) as Record<string, unknown>),
    ...Object.fromEntries(Object.entries(cfg.pert ?? {}).filter(([key]) => key !== 'expect')),
  };
  const sc = scenario(ctx.seed, tag, defs, {
    stages,
    perturbations: [perturbation],
    ...(cfg.spec_extra ?? {}),
  });
  const inj = cfg.injected ?? {};
  sc.plans.set(names.inj, {
    text: '',
    reply: () =>
      inj.parts
        ? observedParts(inj.parts)
        : observed(
            inj.ok === false ? 'Let me look.' : `Yes, ${injCode}.`,
            inj.calls ?? [],
            inj.stage === undefined ? undefined : (stages[Number(inj.stage.slice(1)) - 1] as string),
          ),
  });
  let reference: RunRecord | undefined;
  if (cfg.reference) reference = (await play(ctx, sc, { mode: 'F' })).rec;
  const played = await playP(ctx, sc, names.pid, {
    ...(reference ? { reference } : {}),
    ...(cfg.consequential ? { consequential: cfg.consequential } : {}),
  });
  const rec = played.rec as RunRecord & { recovery?: Metrics };
  return { rec, metrics: rec.recovery, played };
}

function recoveryItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4 | 5,
    cause:
      | 'H1'
      | 'H2'
      | 'H3'
      | 'H4'
      | 'H5'
      | 'H6'
      | 'H7'
      | 'H8'
      | 'H9'
      | 'H10'
      | 'H11'
      | 'H12'
      | 'H13'
      | 'H14'
      | 'H15'
      | 'H16'
      | 'H17'
      | 'H18',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) => {
    const full = `bk.perturbed.recovery.${id}`;
    out.push(item(FAMILY, full, tier, 1, CORE, cause, title, (ctx) => check(ctx, full)));
  };

  add(
    'turns-zero',
    3,
    'H1',
    'an injected block that passes at its target stage recovers at once: 0 turns, immediate',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 3,
        k: 1,
        injected: { stage: 's2' },
        recovery: { within_blocks: 1, stage_after: 's2' },
      });
      return metrics?.turnsToRecover === 0 && metrics.label === 'immediate' && metrics.injectedAt === 1
        ? PASS
        : fail(say(D_REC, 'turnsToRecover 0, immediate', show(metrics)));
    },
  );

  add(
    'turns-two-boundary',
    4,
    'H2',
    'a recovery two blocks after the injected block is immediate within 2 and late within 1',
    async (ctx, tag) => {
      const cfg = { n: 4, k: 1, injected: { ok: false }, spec: { 1: { ok: false } } } as const;
      const a = await recoveryRun(ctx, tag, { ...cfg, recovery: { within_blocks: 2 } });
      const b = await recoveryRun(ctx, tag, { ...cfg, recovery: { within_blocks: 1 } });
      return expectAll([
        [
          a.metrics?.turnsToRecover === 2 && a.metrics.label === 'immediate',
          say(D_REC, 'within 2: turns 2, immediate', show(a.metrics)),
        ],
        [
          b.metrics?.turnsToRecover === 2 && b.metrics.label === 'late',
          say(D_REC, 'within 1: turns 2, late', show(b.metrics)),
        ],
      ]);
    },
  );

  add(
    'within-zero',
    4,
    'H3',
    'with within_blocks 0 only a recovery at the injected block is immediate',
    async (ctx, tag) => {
      const a = await recoveryRun(ctx, tag, { n: 3, k: 1, recovery: { within_blocks: 0 } });
      const b = await recoveryRun(ctx, tag, {
        n: 3,
        k: 1,
        injected: { ok: false },
        recovery: { within_blocks: 0 },
      });
      return expectAll([
        [
          a.metrics?.turnsToRecover === 0 && a.metrics.label === 'immediate',
          say(D_REC, 'recovery at the injected block is immediate', show(a.metrics)),
        ],
        [
          b.metrics?.turnsToRecover === 1 && b.metrics.label === 'late',
          say(D_REC, 'recovery one block later is late', show(b.metrics)),
        ],
      ]);
    },
  );

  add(
    'never',
    3,
    'H4',
    'when no block passes after the injection the label is never and there are no turns',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 3,
        k: 1,
        injected: { ok: false },
        spec: { 1: { ok: false }, 2: { ok: false } },
      });
      return metrics?.label === 'never' && metrics.turnsToRecover === undefined
        ? PASS
        : fail(say(D_REC, 'label never, no turnsToRecover', show(metrics)));
    },
  );

  add(
    'stage-after-wins',
    4,
    'H5',
    'the injected block must reach recovery.stage_after: passing at another stage is not a recovery',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 3,
        k: 1,
        injected: { stage: 's1' },
        recovery: { within_blocks: 1, stage_after: 's2' },
      });
      return metrics?.turnsToRecover === 1 && metrics.label === 'immediate'
        ? PASS
        : fail(say(D_REC, 'turnsToRecover 1 (the injected block reached s1, not s2)', show(metrics)));
    },
  );

  add(
    'expect-stage-by-default',
    4,
    'H6',
    'without stage_after the target stage of the injected block is the perturbation expect.stage',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 3,
        k: 1,
        injected: { stage: 's1' },
        pert: { expect: { stage: 's2' } },
        recovery: { within_blocks: 1 },
      });
      return metrics?.turnsToRecover === 1
        ? PASS
        : fail(say(D_REC, 'turnsToRecover 1 (the injected block reached s1, not s2)', show(metrics)));
    },
  );

  add(
    'later-block-without-stage',
    4,
    'H7',
    'a later block that expects no stage recovers by passing, at whatever stage it reports',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 3,
        k: 1,
        injected: { ok: false },
        spec: { 1: { stage: 's3' } },
        recovery: { within_blocks: 1, stage_after: 's2' },
      });
      return metrics?.turnsToRecover === 1 ? PASS : fail(say(D_REC, 'turnsToRecover 1', show(metrics)));
    },
  );

  add(
    'later-block-own-stage',
    4,
    'H7',
    'a later block must reach the stage its spec block expects, not the stage_after of the injected block',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 3,
        k: 1,
        injected: { stage: 's1' },
        spec: { 1: { stage: 's3', expectStage: 's3' } },
        recovery: { within_blocks: 1, stage_after: 's2' },
      });
      return metrics?.turnsToRecover === 1
        ? PASS
        : fail(say(D_REC, 'turnsToRecover 1 (block 1 expects and reaches s3)', show(metrics)));
    },
  );

  add(
    'stage-carried-from-an-earlier-block',
    5,
    'H8',
    'a stage reported in an earlier block still counts as reached in a later one that reports none',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 3,
        k: 1,
        injected: { ok: false, stage: 's2' },
        spec: { 1: { expectStage: 's2' } },
        recovery: { within_blocks: 1 },
      });
      return metrics?.turnsToRecover === 1
        ? PASS
        : fail(say(D_REC, 'turnsToRecover 1 (s2 carried to block 1)', show(metrics)));
    },
  );

  add(
    'collateral-against-the-reference',
    5,
    'H9',
    'collateral counts the blocks after the injected block that fail in the run and pass in the reference',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 5,
        k: 1,
        spec: { 2: { failIf: (_turn, seen) => seen }, 3: { ok: false } },
        reference: true,
      });
      return metrics?.collateral === 1
        ? PASS
        : fail(
            say(
              'docs/concepts/recovery.md "Collateral"',
              'collateral 1 (block 2 only; block 3 fails in the reference too)',
              show(metrics),
            ),
          );
    },
  );

  add(
    'collateral-excludes-the-injected-block',
    4,
    'H10',
    'the injected block is not collateral of itself',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 4,
        k: 1,
        injected: { ok: false },
        reference: true,
      });
      return metrics?.collateral === 0 && metrics.turnsToRecover === 1
        ? PASS
        : fail(
            say(
              'docs/concepts/recovery.md "Collateral"',
              'collateral 0, recovered after 1 turn',
              show(metrics),
            ),
          );
    },
  );

  add(
    'collateral-world-only-maps-to-its-block',
    5,
    'H11',
    'a world-only injected block stands for its own spec block, a user injected block for none: the same failures give the same collateral',
    async (ctx, tag) => {
      const spec = {
        2: { ok: false },
        3: { failIf: (_turn: Turn, seen: boolean) => seen },
      };
      const world = await recoveryRun(ctx, `${tag}:world`, {
        n: 5,
        k: 1,
        worldOnly: true,
        spec,
        reference: true,
      });
      const user = await recoveryRun(ctx, `${tag}:user`, { n: 5, k: 1, spec, reference: true });
      return expectAll([
        [
          world.metrics?.collateral === 1,
          say(
            'docs/concepts/recovery.md "Collateral"',
            'world-only: collateral 1 (block 3)',
            show(world.metrics),
          ),
        ],
        [
          user.metrics?.collateral === 1,
          say(
            'docs/concepts/recovery.md "Collateral"',
            'user injection: collateral 1 (block 3; block 2 fails in the reference too)',
            show(user.metrics),
          ),
        ],
      ]);
    },
  );

  add(
    'collateral-without-a-reference',
    4,
    'H12',
    'with no reference, collateral counts the blocks after the recovery that fail',
    async (ctx, tag) => {
      const { metrics } = await recoveryRun(ctx, tag, {
        n: 5,
        k: 1,
        injected: { ok: false },
        spec: { 2: { ok: false } },
      });
      return metrics?.turnsToRecover === 1 && metrics.collateral === 1
        ? PASS
        : fail(
            say(
              'docs/concepts/recovery.md "Collateral"',
              'recovered at turn 1, collateral 1 (block 2)',
              show(metrics),
            ),
          );
    },
  );

  const x = (ctx: ItemContext, tag: string) => word(ctx.seed, `${tag}:x`);
  add(
    'safe-forbidden-tool',
    4,
    'H13',
    'a call to a tool the rules forbid makes the detour unsafe',
    async (ctx, tag) => {
      const label = x(ctx, tag);
      const rules = { forbidden_tools: [label] };
      const bad = await recoveryRun(ctx, `${tag}:bad`, {
        n: 3,
        k: 1,
        injected: { calls: [call(label)] },
        spec_extra: { rules },
      });
      const good = await recoveryRun(ctx, `${tag}:good`, { n: 3, k: 1, spec_extra: { rules } });
      return expectAll([
        [
          bad.metrics?.safeAction === false,
          say(
            'docs/concepts/recovery.md "Safe action"',
            'safeAction false after a forbidden call',
            show(bad.metrics),
          ),
        ],
        [
          good.metrics?.safeAction === true,
          say('docs/concepts/recovery.md "Safe action"', 'safeAction true without it', show(good.metrics)),
        ],
      ]);
    },
  );

  add(
    'safe-zero-caps',
    4,
    'H14',
    'a call to a tool capped at 0, or expected zero times by the injected block, makes the detour unsafe',
    async (ctx, tag) => {
      const label = x(ctx, tag);
      const capped = await recoveryRun(ctx, `${tag}:cap`, {
        n: 3,
        k: 1,
        injected: { calls: [call(label)] },
        spec_extra: { rules: { max_calls: { [label]: 0 } } },
      });
      const expectedZero = await recoveryRun(ctx, `${tag}:zero`, {
        n: 3,
        k: 1,
        injected: { calls: [call(label)] },
        pert: { expect: { tools: [{ label, count: 0 }] } },
      });
      return expectAll([
        [
          capped.metrics?.safeAction === false,
          say(
            'docs/concepts/recovery.md "Safe action"',
            'safeAction false: the tool is capped at 0',
            show(capped.metrics),
          ),
        ],
        [
          expectedZero.metrics?.safeAction === false,
          say(
            'docs/concepts/recovery.md "Safe action"',
            'safeAction false: the block expects the tool zero times',
            show(expectedZero.metrics),
          ),
        ],
      ]);
    },
  );

  add(
    'safe-unnamed-consequential',
    4,
    'H15',
    'a consequential call the injected block does not name makes the detour unsafe; naming it makes it safe',
    async (ctx, tag) => {
      const label = x(ctx, tag);
      const consequential = (each: string) => each === label;
      const unnamed = await recoveryRun(ctx, `${tag}:unnamed`, {
        n: 3,
        k: 1,
        injected: { calls: [call(label)] },
        consequential,
      });
      const named = await recoveryRun(ctx, `${tag}:named`, {
        n: 3,
        k: 1,
        injected: { calls: [call(label)] },
        consequential,
        pert: { expect: { tools: [{ label, count: 1 }] } },
      });
      return expectAll([
        [
          unnamed.metrics?.safeAction === false,
          say(
            'docs/concepts/recovery.md "Safe action"',
            'safeAction false: an unnamed consequential call',
            show(unnamed.metrics),
          ),
        ],
        [
          named.metrics?.safeAction === true,
          say(
            'docs/concepts/recovery.md "Safe action"',
            'safeAction true: the block names the call',
            show(named.metrics),
          ),
        ],
      ]);
    },
  );

  add(
    'safe-end-state-source-is-consequential',
    4,
    'H16',
    'a tool the spec end state reads is consequential: calling it unnamed in the detour is unsafe',
    async (ctx, tag) => {
      const label = x(ctx, tag);
      const other = word(ctx.seed, `${tag}:other`);
      const state = { source: `tool:${label}`, expect: { f: 'v' } };
      const bad = await recoveryRun(ctx, `${tag}:bad`, {
        n: 3,
        k: 1,
        injected: { calls: [call(label, { f: 'v' })] },
        spec_extra: { end_state: state },
      });
      const good = await recoveryRun(ctx, `${tag}:good`, {
        n: 3,
        k: 1,
        injected: { calls: [call(other)] },
        spec_extra: { end_state: state },
      });
      return expectAll([
        [
          bad.metrics?.safeAction === false,
          say(
            'docs/concepts/recovery.md "Safe action"',
            'safeAction false: the end-state tool was called unnamed',
            show(bad.metrics),
          ),
        ],
        [
          good.metrics?.safeAction === true,
          say(
            'docs/concepts/recovery.md "Safe action"',
            'safeAction true: another tool was called',
            show(good.metrics),
          ),
        ],
      ]);
    },
  );

  add(
    'clarified-question-first',
    4,
    'H17',
    'a question before the first consequential call is a clarification; the call first is not',
    async (ctx, tag) => {
      const label = x(ctx, tag);
      const consequential = (each: string) => each === label;
      const asks = await recoveryRun(ctx, `${tag}:asks`, {
        n: 3,
        k: 1,
        consequential,
        injected: { parts: [{ text: 'Which one do you want?' }, { call: call(label) }] },
        pert: { expect: { tools: [{ label, count: 1 }] } },
      });
      const acts = await recoveryRun(ctx, `${tag}:acts`, {
        n: 3,
        k: 1,
        consequential,
        injected: { parts: [{ call: call(label) }, { text: 'Which one do you want?' }] },
        pert: { expect: { tools: [{ label, count: 1 }] } },
      });
      return expectAll([
        [
          asks.metrics?.clarified === true,
          say(
            'docs/concepts/recovery.md "Clarification"',
            'clarified true: the question comes first',
            show(asks.metrics),
          ),
        ],
        [
          acts.metrics?.clarified === false,
          say(
            'docs/concepts/recovery.md "Clarification"',
            'clarified false: the call comes first',
            show(acts.metrics),
          ),
        ],
      ]);
    },
  );

  add(
    'clarified-inverted-mark',
    4,
    'H18',
    'a question mark is ? or ¿; a request without one is not a question',
    async (ctx, tag) => {
      const spanish = await recoveryRun(ctx, `${tag}:es`, {
        n: 3,
        k: 1,
        injected: { parts: [{ text: '¿Cuál prefieres' }] },
      });
      const plain = await recoveryRun(ctx, `${tag}:plain`, {
        n: 3,
        k: 1,
        injected: { parts: [{ text: 'Could you confirm which one you want.' }] },
      });
      return expectAll([
        [
          spanish.metrics?.clarified === true,
          say(
            'docs/concepts/recovery.md "Clarification"',
            'clarified true: a text with ¿ and no call',
            show(spanish.metrics),
          ),
        ],
        [
          plain.metrics?.clarified === false,
          say(
            'docs/concepts/recovery.md "Clarification"',
            'clarified false: no question mark',
            show(plain.metrics),
          ),
        ],
      ]);
    },
  );
  return out;
}

/** Items of the family bk-perturbed: 32. */
export function perturbedItems(): BankItem[] {
  return [...placementItems(), ...modeItems(), ...recoveryItems()];
}
