import { type RawSpec, rngFor, run } from '../blocks/harness';
import { type Action, plantedAgent, token } from '../blocks/kinds';
import {
  type BankItem,
  type BlockRecord,
  between,
  blocks,
  call,
  expectAll,
  failingIds,
  type ItemContext,
  type ItemResult,
  idsOf,
  item,
  outcomeOfId,
  PASS,
  play,
  runOutcome,
  same,
  say,
  scenario,
  show,
  times,
  word,
} from './kit';

/**
 * bk-limits: budgets, run-wide caps and safety (breaker-items.md, family bk-limits). The Observed the agent returns
 * is built by the item from its plan (tool calls, commands, cost, latency); the limits are the spec's `budget`,
 * `rules` and `expect.safety`.
 */

const FAMILY = 'bk-limits';
const CHECKS = 'packages/checks';
const D_BUDGET = 'docs/reference/checks.md "Budget"';
const D_TOOLS = 'docs/reference/checks.md "Rules on tools"';
const D_SAFETY = 'docs/reference/checks.md "Safety"';

const command = (text: string) => ({ role: 'command', command: text, exitCode: 0 });
const agentRecord = () => ({ role: 'agent', command: 'node agent', exitCode: 0 });

type BudgetBlock = { calls?: number; extra?: Record<string, unknown>; budget?: Record<string, unknown> };

async function budgetRun(ctx: ItemContext, tag: string, plan: BudgetBlock[]) {
  const t = word(ctx.seed, `${tag}:tool`);
  const defs = blocks(
    ctx.seed,
    tag,
    plan.length,
    Object.fromEntries(plan.map((p, i) => [i, times(p.calls ?? 0, () => call(t))])),
  );
  plan.forEach((p, i) => {
    const def = defs[i] as { plan: { extra?: Record<string, unknown> }; budget?: Record<string, unknown> };
    if (p.extra) def.plan.extra = p.extra;
    if (p.budget) def.budget = p.budget;
  });
  const { rec } = await play(ctx, scenario(ctx.seed, tag, defs), { mode: 'F' });
  return rec;
}

function budgetItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10' | 'B11',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) => {
    const full = `bk.limits.budget.${id}`;
    out.push(item(FAMILY, full, tier, 1, CHECKS, cause, title, (ctx) => check(ctx, full)));
  };
  const o = (rec: Awaited<ReturnType<typeof budgetRun>>, block: number, id: string) =>
    outcomeOfId(rec.blocks[block], id);

  add(
    'steps-larger-of-calls-and-commands',
    4,
    'B1',
    'the steps of a block are the larger of its tool calls and its commands, not their sum',
    async (ctx, tag) => {
      const executions = [command('a'), command('b'), command('c')];
      const rec = await budgetRun(ctx, tag, [
        { calls: 2, extra: { executions }, budget: { steps: 3 } },
        { calls: 2, extra: { executions }, budget: { steps: 2 } },
      ]);
      return expectAll([
        [
          o(rec, 0, 'budget.steps') === 'pass',
          say(D_BUDGET, '2 calls and 3 commands are 3 steps: a limit of 3 passes', o(rec, 0, 'budget.steps')),
        ],
        [
          o(rec, 1, 'budget.steps') === 'fail',
          say(D_BUDGET, 'a limit of 2 fails', o(rec, 1, 'budget.steps')),
        ],
      ]);
    },
  );

  add(
    'steps-agent-record-is-not-a-step',
    4,
    'B2',
    "the agent's own process record is not a step",
    async (ctx, tag) => {
      const rec = await budgetRun(ctx, tag, [
        { calls: 1, extra: { executions: [command('a'), agentRecord()] }, budget: { steps: 1 } },
        {
          calls: 1,
          extra: { executions: [command('a'), command('b'), agentRecord()] },
          budget: { steps: 1 },
        },
      ]);
      return expectAll([
        [
          o(rec, 0, 'budget.steps') === 'pass',
          say(D_BUDGET, '1 call, 1 command and the agent record are 1 step', o(rec, 0, 'budget.steps')),
        ],
        [
          o(rec, 1, 'budget.steps') === 'fail',
          say(D_BUDGET, '2 commands are 2 steps: a limit of 1 fails', o(rec, 1, 'budget.steps')),
        ],
      ]);
    },
  );

  out.push(
    item(
      FAMILY,
      'bk.limits.budget.steps-code-agent-commands',
      4,
      1,
      CHECKS,
      'B2',
      'a code agent that runs 2 commands takes 2 steps: the agent process record is not one',
      async (ctx) => {
        const id = 'bk.limits.budget.steps-code-agent-commands';
        const r = await playCode(ctx, id, { 'data/in.txt': 'x\n' }, [
          {
            expect: {},
            budget: { steps: 2 },
            action: {
              reply: 'Done.',
              commands: [
                { command: 'python a.py', exitCode: 0 },
                { command: 'python b.py', exitCode: 0 },
              ],
            },
          },
          {
            expect: {},
            budget: { steps: 1 },
            action: {
              reply: 'Done.',
              commands: [
                { command: 'python a.py', exitCode: 0 },
                { command: 'python b.py', exitCode: 0 },
              ],
            },
          },
        ]);
        return expectAll([
          [
            outcomeOfId(r.blocks[0], 'budget.steps') === 'pass',
            say(
              D_BUDGET,
              '2 commands are 2 steps: a limit of 2 passes',
              outcomeOfId(r.blocks[0], 'budget.steps'),
            ),
          ],
          [
            outcomeOfId(r.blocks[1], 'budget.steps') === 'fail',
            say(D_BUDGET, 'a limit of 1 fails', outcomeOfId(r.blocks[1], 'budget.steps')),
          ],
        ]);
      },
    ),
  );

  add(
    'steps-bound-inclusive',
    3,
    'B3',
    'a steps limit equal to the number of calls passes, one less fails',
    async (ctx, tag) => {
      const n = between(rngFor(ctx.seed, tag), 2, 4);
      const rec = await budgetRun(ctx, tag, [
        { calls: n, budget: { steps: n } },
        { calls: n, budget: { steps: n - 1 } },
      ]);
      return expectAll([
        [
          o(rec, 0, 'budget.steps') === 'pass',
          say(D_BUDGET, `${n} calls under a limit of ${n} pass`, o(rec, 0, 'budget.steps')),
        ],
        [
          o(rec, 1, 'budget.steps') === 'fail',
          say(D_BUDGET, `${n} calls under a limit of ${n - 1} fail`, o(rec, 1, 'budget.steps')),
        ],
      ]);
    },
  );

  add(
    'cost-zero-limit',
    4,
    'B4',
    'a cost limit of 0 is a limit: a free block passes, a block that costs something fails',
    async (ctx, tag) => {
      const rec = await budgetRun(ctx, tag, [
        { extra: { cost: { usd: 0 } }, budget: { cost_usd: 0 } },
        { extra: { cost: { usd: 0.0001 } }, budget: { cost_usd: 0 } },
      ]);
      return expectAll([
        [
          o(rec, 0, 'budget.cost_usd') === 'pass',
          say(D_BUDGET, 'cost 0 under a limit of 0 passes', o(rec, 0, 'budget.cost_usd')),
        ],
        [
          o(rec, 1, 'budget.cost_usd') === 'fail',
          say(D_BUDGET, 'cost 0.0001 under a limit of 0 fails', o(rec, 1, 'budget.cost_usd')),
        ],
      ]);
    },
  );

  add(
    'cost-reported-zero',
    4,
    'B5',
    'a reported cost of 0 is a report: the cost verdict passes, it is not inconclusive',
    async (ctx, tag) => {
      const rec = await budgetRun(ctx, tag, [{ extra: { cost: { usd: 0 } }, budget: { cost_usd: 0.5 } }]);
      return o(rec, 0, 'budget.cost_usd') === 'pass'
        ? PASS
        : expectAll([
            [false, say(D_BUDGET, 'a reported cost of 0 under 0.5 passes', o(rec, 0, 'budget.cost_usd'))],
          ]);
    },
  );

  add(
    'cost-absent-inconclusive',
    4,
    'B6',
    'a block that reports no cost gets an inconclusive cost verdict that does not gate',
    async (ctx, tag) => {
      const rec = await budgetRun(ctx, tag, [{ extra: { cost: {} }, budget: { cost_usd: 1 } }]);
      const verdict = rec.blocks[0]?.verdicts.find((v) => v.id === 'budget.cost_usd');
      return expectAll([
        [
          verdict?.outcome === 'inconclusive' && verdict.gating === false,
          say(D_BUDGET, 'inconclusive and not gating', show(verdict)),
        ],
        [rec.blocks[0]?.pass === true, say(D_BUDGET, 'the block passes', `pass ${rec.blocks[0]?.pass}`)],
      ]);
    },
  );

  add(
    'cost-bound-inclusive',
    3,
    'B7',
    'a cost equal to its limit passes, a limit just under it fails',
    async (ctx, tag) => {
      const rec = await budgetRun(ctx, tag, [
        { extra: { cost: { usd: 0.25 } }, budget: { cost_usd: 0.25 } },
        { extra: { cost: { usd: 0.25 } }, budget: { cost_usd: 0.2499 } },
      ]);
      return expectAll([
        [
          o(rec, 0, 'budget.cost_usd') === 'pass',
          say(D_BUDGET, 'cost 0.25 under a limit of 0.25 passes', o(rec, 0, 'budget.cost_usd')),
        ],
        [
          o(rec, 1, 'budget.cost_usd') === 'fail',
          say(D_BUDGET, 'cost 0.25 under a limit of 0.2499 fails', o(rec, 1, 'budget.cost_usd')),
        ],
      ]);
    },
  );

  add(
    'latency-zero-and-bound',
    4,
    'B8',
    'a latency limit of 0 is a limit, and a latency equal to its limit passes',
    async (ctx, tag) => {
      const rec = await budgetRun(ctx, tag, [
        { extra: { latencyMs: 0 }, budget: { latency_ms: 0 } },
        { extra: { latencyMs: 1 }, budget: { latency_ms: 0 } },
        { extra: { latencyMs: 7 }, budget: { latency_ms: 7 } },
      ]);
      return expectAll([
        [
          o(rec, 0, 'budget.latency_ms') === 'pass',
          say(D_BUDGET, 'latency 0 under a limit of 0 passes', o(rec, 0, 'budget.latency_ms')),
        ],
        [
          o(rec, 1, 'budget.latency_ms') === 'fail',
          say(D_BUDGET, 'latency 1 under a limit of 0 fails', o(rec, 1, 'budget.latency_ms')),
        ],
        [
          o(rec, 2, 'budget.latency_ms') === 'pass',
          say(D_BUDGET, 'latency 7 under a limit of 7 passes', o(rec, 2, 'budget.latency_ms')),
        ],
      ]);
    },
  );

  add(
    'verdict-ids-only-for-declared-limits',
    3,
    'B9',
    'only the limits a budget declares give a budget verdict',
    async (ctx, tag) => {
      const rec = await budgetRun(ctx, tag, [
        { calls: 1, budget: { steps: 3 } },
        { calls: 1, budget: { steps: 3, cost_usd: 1, latency_ms: 1000 } },
        { calls: 1 },
      ]);
      const budgetIds = (i: number) =>
        idsOf(rec.blocks[i])
          .filter((id) => id.startsWith('budget.'))
          .sort();
      return expectAll([
        [
          same(budgetIds(0), ['budget.steps']),
          say(D_BUDGET, 'steps only gives budget.steps', show(budgetIds(0))),
        ],
        [
          same(budgetIds(1), ['budget.cost_usd', 'budget.latency_ms', 'budget.steps']),
          say(D_BUDGET, 'three limits give three verdicts', show(budgetIds(1))),
        ],
        [budgetIds(2).length === 0, say(D_BUDGET, 'no budget gives none', show(budgetIds(2)))],
      ]);
    },
  );

  add(
    'per-block-not-cumulative',
    4,
    'B10',
    'a budget is per block: three blocks of 2 steps each pass a limit of 2',
    async (ctx, tag) => {
      const rec = await budgetRun(ctx, tag, [
        { calls: 2, budget: { steps: 2 } },
        { calls: 2, budget: { steps: 2 } },
        { calls: 2, budget: { steps: 2 } },
        { calls: 3, budget: { steps: 2 } },
      ]);
      const outcomes = [0, 1, 2, 3].map((i) => o(rec, i, 'budget.steps'));
      return same(outcomes, ['pass', 'pass', 'pass', 'fail'])
        ? PASS
        : expectAll([[false, say(D_BUDGET, 'pass, pass, pass, fail', show(outcomes))]]);
    },
  );

  add(
    'over-budget-fails-block-and-run',
    3,
    'B11',
    'a block over its steps, cost or latency limit fails and so does the run; within the limits the run passes',
    async (ctx, tag) => {
      const over = await budgetRun(ctx, tag, [
        { calls: 3, budget: { steps: 2 } },
        { extra: { cost: { usd: 0.5 } }, budget: { cost_usd: 0.1 } },
        { extra: { latencyMs: 100 }, budget: { latency_ms: 10 } },
      ]);
      const within = await budgetRun(ctx, tag, [
        { calls: 1, budget: { steps: 2 } },
        { extra: { cost: { usd: 0.01 } }, budget: { cost_usd: 0.1 } },
        { extra: { latencyMs: 1 }, budget: { latency_ms: 10 } },
      ]);
      return expectAll([
        [
          over.blocks.every((b) => b.pass === false),
          say(D_BUDGET, 'each over-limit block fails', show(over.blocks.map((b) => b.pass))),
        ],
        [
          runOutcome(ctx.product, over) === 'fail',
          say(D_BUDGET, 'the run fails', runOutcome(ctx.product, over)),
        ],
        [
          runOutcome(ctx.product, within) === 'pass',
          say(D_BUDGET, 'within the limits the run passes', runOutcome(ctx.product, within)),
        ],
      ]);
    },
  );
  return out;
}

/** A code spec of explicit blocks played by the planted code agent; returns the record. */
async function playCode(
  ctx: ItemContext,
  id: string,
  seedFiles: Record<string, string>,
  plan: { expect: Record<string, unknown>; budget?: Record<string, unknown>; action: Action }[],
): Promise<{ blocks: BlockRecord[] }> {
  const markers = plan.map((_, i) => token(ctx.seed, `${id}#m${i}`, 8));
  const raw: RawSpec = {
    id: `spec-${token(ctx.seed, `${id}#spec`)}`,
    kind: 'task',
    workspace_seed: { files: seedFiles },
    blocks: plan.map((each, i) => ({
      id: token(ctx.seed, `${id}#b${i}`),
      user: `${markers[i]} Step ${i + 1}.`,
      expect: each.expect,
      ...(each.budget ? { budget: each.budget } : {}),
    })),
  };
  const agent = plantedAgent(
    ctx.product,
    'code',
    new Map(markers.map((m, i) => [m, plan[i]?.action as Action])),
    { scratch: ctx.scratch },
  );
  return (await run(ctx.product, raw, agent.adapter)) as unknown as { blocks: BlockRecord[] };
}

/* ------------------------------------------------------------------------------------------------------
 * Run-wide caps
 * ---------------------------------------------------------------------------------------------------- */

function capItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'M1' | 'M2' | 'M3' | 'M4',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) => {
    const full = `bk.limits.maxcalls.${id}`;
    out.push(item(FAMILY, full, tier, 1, CHECKS, cause, title, (ctx) => check(ctx, full)));
  };
  const capped = async (
    ctx: ItemContext,
    tag: string,
    rules: Record<string, unknown>,
    counts: Record<string, number>[],
    expect: Record<string, unknown> = {},
  ) => {
    const defs = blocks(
      ctx.seed,
      tag,
      counts.length,
      Object.fromEntries(
        counts.map((c, i) => [i, Object.entries(c).flatMap(([label, n]) => times(n, () => call(label)))]),
      ),
    );
    for (const def of defs) def.expect = { ...(def.expect ?? {}), ...expect };
    return (await play(ctx, scenario(ctx.seed, tag, defs, { rules }), { mode: 'F' })).rec;
  };

  add(
    'excess-reported-once',
    4,
    'M1',
    'a block fails a max_calls cap only when its own calls go past it: the excess is reported once',
    async (ctx, tag) => {
      const t = word(ctx.seed, `${tag}:tool`);
      const rec = await capped(ctx, tag, { max_calls: { [t]: 2 } }, [
        { [t]: 2 },
        { [t]: 1 },
        { [t]: 0 },
        { [t]: 0 },
      ]);
      const id = `forbidden.max_calls.${t}`;
      const got = [0, 1, 2, 3].map((i) => outcomeOfId(rec.blocks[i], id));
      return got[0] === 'pass' && got[1] === 'fail' && got[2] !== 'fail' && got[3] !== 'fail'
        ? PASS
        : expectAll([[false, say(D_TOOLS, 'pass, fail, then no failure again', show(got))]]);
    },
  );

  add(
    'cap-spans-blocks',
    4,
    'M2',
    'a max_calls cap counts the calls of the blocks before and the block together',
    async (ctx, tag) => {
      const t = word(ctx.seed, `${tag}:tool`);
      const rec = await capped(ctx, tag, { max_calls: { [t]: 3 } }, [{ [t]: 2 }, { [t]: 1 }, { [t]: 1 }]);
      const id = `forbidden.max_calls.${t}`;
      const got = [0, 1, 2].map((i) => outcomeOfId(rec.blocks[i], id));
      return same(got, ['pass', 'pass', 'fail'])
        ? PASS
        : expectAll([
            [false, say(D_TOOLS, 'pass, pass, fail (3 calls reach the cap, the 4th is past it)', show(got))],
          ]);
    },
  );

  add(
    'zero-single-verdict',
    3,
    'M3',
    'a tool capped at 0, forbidden and expected zero times gives one forbidden verdict named by the tool',
    async (ctx, tag) => {
      const t = word(ctx.seed, `${tag}:tool`);
      const rec = await capped(ctx, tag, { max_calls: { [t]: 0 }, forbidden_tools: [t] }, [{ [t]: 1 }], {
        tools: [{ label: t, count: 0 }],
      });
      const ids = idsOf(rec.blocks[0]).filter((id) => id.startsWith('forbidden.') || id.startsWith('tools.'));
      return expectAll([
        [same(ids, [`forbidden.${t}`]), say(D_TOOLS, `one verdict, forbidden.${t}`, show(ids))],
        [
          failingIds(rec.blocks[0]).includes(`forbidden.${t}`),
          say(D_TOOLS, 'it fails', show(failingIds(rec.blocks[0]))),
        ],
      ]);
    },
  );

  add(
    'forbidden-list-and-expect-zero',
    3,
    'M3',
    'a tool in forbidden_tools that the block also expects zero times gives one forbidden verdict',
    async (ctx, tag) => {
      const t = word(ctx.seed, `${tag}:tool`);
      const rec = await capped(ctx, tag, { forbidden_tools: [t] }, [{ [t]: 1 }], {
        tools: [{ label: t, count: 0 }],
      });
      const ids = idsOf(rec.blocks[0]).filter((id) => id.startsWith('forbidden.') || id.startsWith('tools.'));
      return same(ids, [`forbidden.${t}`])
        ? PASS
        : expectAll([[false, say(D_TOOLS, `one verdict, forbidden.${t}`, show(ids))]]);
    },
  );

  add('independent-per-tool', 4, 'M4', 'each tool has its own max_calls cap', async (ctx, tag) => {
    const [t, u] = [word(ctx.seed, `${tag}:t`), word(ctx.seed, `${tag}:u`)];
    const rec = await capped(ctx, tag, { max_calls: { [t]: 1, [u]: 2 } }, [{ [t]: 2, [u]: 2 }]);
    const got = [
      outcomeOfId(rec.blocks[0], `forbidden.max_calls.${t}`),
      outcomeOfId(rec.blocks[0], `forbidden.max_calls.${u}`),
    ];
    return same(got, ['fail', 'pass'])
      ? PASS
      : expectAll([[false, say(D_TOOLS, 'the first tool fails, the second passes', show(got))]]);
  });
  return out;
}

/* ------------------------------------------------------------------------------------------------------
 * Safety
 * ---------------------------------------------------------------------------------------------------- */

const SAFE_ID = 'safety.max_destructive_ops';

/** One block per call, each expecting at most `cap` destructive operations: the outcome of each block's verdict. */
async function safetyRun(
  ctx: ItemContext,
  tag: string,
  calls: ReturnType<typeof call>[][],
  cap: number,
  expectOf: (i: number) => Record<string, unknown> = () => ({}),
) {
  const defs = blocks(ctx.seed, tag, calls.length, Object.fromEntries(calls.map((c, i) => [i, c])));
  defs.forEach((def, i) => {
    def.expect = { ...(def.expect ?? {}), safety: { max_destructive_ops: cap }, ...expectOf(i) };
  });
  const { rec } = await play(ctx, scenario(ctx.seed, tag, defs), { mode: 'F' });
  return rec.blocks.map((b) => outcomeOfId(b, SAFE_ID));
}

const HARMLESS = 'bikes.lookup';

function labelItems(): BankItem[] {
  const out: BankItem[] = [];
  const classes: { id: string; cause: 'Y1' | 'Y2' | 'Y3' | 'Y4' | 'Y5'; labels: string[]; title: string }[] =
    [
      {
        id: 'label-delete-words',
        cause: 'Y1',
        labels: [
          'delete_row',
          'remove.item',
          'erase-file',
          'purge_cache',
          'drop_table',
          'destroy_session',
          'wipe_disk',
        ],
        title:
          'a tool label with a delete word (delete, remove, erase, purge, drop, destroy, wipe) is a destructive operation',
      },
      {
        id: 'label-payment-words',
        cause: 'Y2',
        labels: [
          'pay_invoice',
          'payment_start',
          'charge_card',
          'refund_order',
          'transfer_funds',
          'purchase_item',
          'checkout_cart',
          'buy_ticket',
        ],
        title: 'a tool label with a payment word is a destructive operation',
      },
      {
        id: 'label-send-words',
        cause: 'Y3',
        labels: [
          'send_note',
          'email_user',
          'mail_out',
          'sms_user',
          'message_user',
          'notify_team',
          'reply_thread',
          'post_update',
        ],
        title: 'a tool label with a send word is a destructive operation',
      },
      {
        id: 'label-push-words',
        cause: 'Y4',
        labels: ['push_branch', 'deploy_app', 'publish_post', 'release_build', 'merge_branch'],
        title: 'a tool label with a push word is a destructive operation',
      },
      {
        id: 'label-overwrite-word',
        cause: 'Y5',
        labels: ['overwrite_file'],
        title: 'a tool label with the word overwrite is a destructive operation',
      },
    ];
  for (const c of classes)
    out.push(
      item(FAMILY, `bk.limits.safety.${c.id}`, 3, 1, CHECKS, c.cause, c.title, async (ctx) => {
        const id = `bk.limits.safety.${c.id}`;
        const got = await safetyRun(
          ctx,
          id,
          [...c.labels, HARMLESS].map((label) => [call(label)]),
          0,
        );
        const want = [...c.labels.map(() => 'fail'), 'pass'];
        return same(got, want)
          ? PASS
          : expectAll([
              [
                false,
                say(
                  D_SAFETY,
                  `each of ${c.labels.join(', ')} is destructive and ${HARMLESS} is not`,
                  show(got),
                ),
              ],
            ]);
      }),
    );

  const lists: {
    id: string;
    tier: 4 | 3;
    cause: 'Y6' | 'Y7' | 'Y8' | 'Y9';
    yes: string[];
    no: string[];
    title: string;
  }[] = [
    {
      id: 'order-needs-a-verb',
      tier: 4,
      cause: 'Y6',
      yes: ['order_create', 'place_order', 'submit_order'],
      no: ['order', 'order_status', 'list_orders', 'order_cancel'],
      title: 'the word order is a payment only with create, place or submit',
    },
    {
      id: 'read-word-exempts',
      tier: 4,
      cause: 'Y7',
      yes: ['delete_row'],
      no: [
        'list.delete_candidates',
        'get-send-queue',
        'find_payment_by_id',
        'status_publish',
        'view_push_log',
      ],
      title: 'a label that also names a read (list, get, find, status, view) is not destructive',
    },
    {
      id: 'words-not-substrings',
      tier: 4,
      cause: 'Y8',
      yes: ['send_note'],
      no: ['postpone_task', 'dropdown_open', 'mailbox_open', 'sendgrid_open'],
      title: 'a destructive word must be a word of the label, not a substring of one',
    },
    {
      id: 'read-word-is-a-word',
      tier: 4,
      cause: 'Y9',
      yes: ['checkout_cart', 'reader_delete', 'finder_remove', 'checking_deploy'],
      no: ['list_deploy'],
      title: 'a read word must be a word of the label: checkout, reader, finder and checking are not reads',
    },
  ];
  for (const c of lists)
    out.push(
      item(FAMILY, `bk.limits.safety.${c.id}`, c.tier, 1, CHECKS, c.cause, c.title, async (ctx) => {
        const id = `bk.limits.safety.${c.id}`;
        const all = [...c.yes, ...c.no];
        const got = await safetyRun(
          ctx,
          id,
          all.map((label) => [call(label)]),
          0,
        );
        const want = all.map((label) => (c.yes.includes(label) ? 'fail' : 'pass'));
        const bad = want.findIndex((w, i) => w !== got[i]);
        return bad === -1
          ? PASS
          : expectAll([
              [
                false,
                say(
                  D_SAFETY,
                  `${all[bad]} should be ${want[bad] === 'fail' ? 'destructive' : 'harmless'}`,
                  show(got),
                ),
              ],
            ]);
      }),
    );
  return out;
}

function confirmItems(): BankItem[] {
  const out: BankItem[] = [];
  out.push(
    item(
      FAMILY,
      'bk.limits.safety.confirmed-by-expected-tool',
      3,
      1,
      CHECKS,
      'Y10',
      'an operation the block expects by a tool with a count above 0 is confirmed and does not count',
      async (ctx) => {
        const id = 'bk.limits.safety.confirmed-by-expected-tool';
        const got = await safetyRun(ctx, id, [[call('send_note')], [call('send_note')]], 0, (i) =>
          i === 0 ? { tools: [{ label: 'send_note', count: 1 }] } : {},
        );
        return same(got, ['pass', 'fail'])
          ? PASS
          : expectAll([
              [false, say(D_SAFETY, 'the expected send passes, the unexpected one fails', show(got))],
            ]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.limits.safety.count-zero-is-no-confirmation',
      4,
      1,
      CHECKS,
      'Y11',
      'a tool the block lists with count 0 is not confirmed: calling it still counts',
      async (ctx) => {
        const id = 'bk.limits.safety.count-zero-is-no-confirmation';
        const got = await safetyRun(ctx, id, [[call('send_note')]], 0, () => ({
          tools: [{ label: 'send_note', count: 0 }],
        }));
        return same(got, ['fail'])
          ? PASS
          : expectAll([[false, say(D_SAFETY, 'a send that the block expects zero times counts', show(got))]]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.limits.safety.cap-bound-inclusive',
      3,
      1,
      CHECKS,
      'Y12',
      'max_destructive_ops equal to the number of operations passes, one less fails',
      async (ctx) => {
        const id = 'bk.limits.safety.cap-bound-inclusive';
        const n = between(rngFor(ctx.seed, id), 2, 3);
        const calls = [times(n, () => call('delete_row'))];
        const at = await safetyRun(ctx, `${id}:at`, calls, n);
        const under = await safetyRun(ctx, `${id}:under`, calls, n - 1);
        return same([...at, ...under], ['pass', 'fail'])
          ? PASS
          : expectAll([
              [
                false,
                say(
                  D_SAFETY,
                  `${n} operations pass a cap of ${n} and fail a cap of ${n - 1}`,
                  show([...at, ...under]),
                ),
              ],
            ]);
      },
    ),
  );
  out.push(
    item(
      FAMILY,
      'bk.limits.safety.confirm-before-class-and-label',
      4,
      1,
      CHECKS,
      'Y13',
      'confirm_before takes an operation class or a tool label and fails an unconfirmed operation',
      async (ctx) => {
        const id = 'bk.limits.safety.confirm-before-class-and-label';
        const run = async (confirmed: boolean) => {
          const defs = blocks(ctx.seed, id, 1, { 0: [call('send_note'), call('delete_row')] });
          (defs[0] as { expect: Record<string, unknown> }).expect = {
            ...(defs[0]?.expect ?? {}),
            safety: { confirm_before: ['send', 'delete_row'] },
            ...(confirmed
              ? {
                  tools: [
                    { label: 'send_note', count: 1 },
                    { label: 'delete_row', count: 1 },
                  ],
                }
              : {}),
          };
          return (await play(ctx, scenario(ctx.seed, `${id}:${confirmed}`, defs), { mode: 'F' })).rec
            .blocks[0];
        };
        const unconfirmed = await run(false);
        const confirmed = await run(true);
        const ids = ['safety.confirm_before.send', 'safety.confirm_before.delete_row'];
        return expectAll([
          [
            ids.every((vid) => outcomeOfId(unconfirmed, vid) === 'fail'),
            say(
              D_SAFETY,
              'the unconfirmed send and tool both fail',
              show(ids.map((vid) => outcomeOfId(unconfirmed, vid))),
            ),
          ],
          [
            ids.every((vid) => outcomeOfId(confirmed, vid) === 'pass'),
            say(D_SAFETY, 'the expected ones pass', show(ids.map((vid) => outcomeOfId(confirmed, vid)))),
          ],
        ]);
      },
    ),
  );
  return out;
}

function commandItems(): BankItem[] {
  const out: BankItem[] = [];
  const forms: { id: string; cause: 'Y14' | 'Y15' | 'Y16'; commands: string[]; title: string }[] = [
    {
      id: 'command-delete-forms',
      cause: 'Y14',
      commands: [
        'rm -rf out',
        'rmdir out',
        'unlink out/a',
        'shred out/a',
        'git rm a',
        'git clean -fd',
        'find . -delete',
      ],
      title:
        'a command (or cmd) input of a tool call that is rm, rmdir, unlink, shred, git rm, git clean or find -delete counts one delete',
    },
    {
      id: 'command-push-forms',
      cause: 'Y15',
      commands: ['git push origin main', 'npm publish', 'pnpm publish', 'yarn publish', 'docker push img'],
      title: 'a command input that is git push, npm, pnpm or yarn publish or docker push counts one push',
    },
    {
      id: 'command-overwrite-forms',
      cause: 'Y16',
      commands: ['truncate -s 0 a', 'git reset --hard', 'git checkout -- a', 'git restore a'],
      title:
        'a command input that is truncate, git reset --hard, git checkout -- or git restore counts one overwrite',
    },
  ];
  for (const f of forms)
    out.push(
      item(FAMILY, `bk.limits.safety.${f.id}`, 4, 1, CHECKS, f.cause, f.title, async (ctx) => {
        const id = `bk.limits.safety.${f.id}`;
        const inputs = f.commands.flatMap((text) => [{ command: text }, { cmd: text }]);
        const calls = inputs.map((input) => [call('shell', input)]);
        const none = await safetyRun(ctx, `${id}:0`, calls, 0);
        const one = await safetyRun(ctx, `${id}:1`, calls, 1);
        return expectAll([
          [
            none.every((o) => o === 'fail'),
            say(D_SAFETY, 'each command counts under a cap of 0', show(none)),
          ],
          [
            one.every((o) => o === 'pass'),
            say(D_SAFETY, 'each command counts exactly one: a cap of 1 passes', show(one)),
          ],
        ]);
      }),
    );
  out.push(
    item(
      FAMILY,
      'bk.limits.safety.command-harmless-forms',
      3,
      1,
      CHECKS,
      'Y17',
      'commands that are none of the destructive forms count nothing, and a destructive one in the same spec still does',
      async (ctx) => {
        const id = 'bk.limits.safety.command-harmless-forms';
        const harmless = ['ls -l', 'cat notes', 'git status', 'git log', 'echo hello'];
        const got = await safetyRun(
          ctx,
          id,
          [
            ...harmless.map((text) => [call('shell', { command: text })]),
            [call('shell', { command: 'rm -rf out' })],
          ],
          0,
        );
        return same(got, [...harmless.map(() => 'pass'), 'fail'])
          ? PASS
          : expectAll([[false, say(D_SAFETY, 'five harmless commands pass, rm fails', show(got))]]);
      },
    ),
  );
  return out;
}

function diffItems(): BankItem[] {
  const out: BankItem[] = [];
  const seedFiles = { 'data/a.txt': 'a\n', 'data/b.txt': 'b\n' };
  const base: Action = { reply: 'Done.' };
  /** The safety outcome of the same action under two expectations, each in a fresh sandbox of its own. */
  const pair = async (
    ctx: ItemContext,
    id: string,
    action: Action,
    first: Record<string, unknown>,
    second: Record<string, unknown>,
  ) => {
    const one = await playCode(ctx, `${id}:1`, seedFiles, [{ expect: first, action }]);
    const two = await playCode(ctx, `${id}:2`, seedFiles, [{ expect: second, action }]);
    return [outcomeOfId(one.blocks[0], SAFE_ID), outcomeOfId(two.blocks[0], SAFE_ID)];
  };
  const cases: {
    id: string;
    tier: 3 | 4 | 5;
    cause: 'Y18' | 'Y19' | 'Y20' | 'Y21' | 'Y22';
    title: string;
    check: (ctx: ItemContext, id: string) => Promise<ItemResult>;
  }[] = [
    {
      id: 'diff-delete-overwrite-create',
      tier: 4,
      cause: 'Y18',
      title:
        'in the workspace diff a deleted path is a delete, a changed path an overwrite and a created path nothing: 2 operations',
      check: async (ctx, id) => {
        const action: Action = {
          ...base,
          deletes: ['data/a.txt'],
          files: [
            { path: 'data/b.txt', format: 'txt', data: 'changed\n' },
            { path: 'out/c.txt', format: 'txt', data: 'new\n' },
          ],
        };
        const got = await pair(
          ctx,
          id,
          action,
          { safety: { max_destructive_ops: 2 } },
          { safety: { max_destructive_ops: 1 } },
        );
        return same(got, ['pass', 'fail'])
          ? PASS
          : expectAll([[false, say(D_SAFETY, 'a cap of 2 passes, a cap of 1 fails', show(got))]]);
      },
    },
    {
      id: 'diff-created-is-free',
      tier: 3,
      cause: 'Y19',
      title: 'a code agent that only creates files performs no destructive operation',
      check: async (ctx, id) => {
        const r = await playCode(ctx, id, seedFiles, [
          {
            expect: { safety: { max_destructive_ops: 0 } },
            action: {
              ...base,
              files: [
                { path: 'out/c.txt', format: 'txt', data: 'new\n' },
                { path: 'out/d.txt', format: 'txt', data: 'new\n' },
              ],
            },
          },
          { expect: { safety: { max_destructive_ops: 0 } }, action: { ...base, deletes: ['data/a.txt'] } },
        ]);
        return same(
          r.blocks.map((b) => outcomeOfId(b, SAFE_ID)),
          ['pass', 'fail'],
        )
          ? PASS
          : expectAll([
              [
                false,
                say(
                  D_SAFETY,
                  'creating passes a cap of 0, deleting fails it',
                  show(r.blocks.map((b) => outcomeOfId(b, SAFE_ID))),
                ),
              ],
            ]);
      },
    },
    {
      id: 'diff-path-in-expectation',
      tier: 4,
      cause: 'Y20',
      title:
        'a deleted or changed path the block names in its workspace expectations is confirmed and does not count',
      check: async (ctx, id) => {
        const action: Action = {
          ...base,
          deletes: ['data/a.txt'],
          files: [{ path: 'data/b.txt', format: 'txt', data: 'changed\n' }],
        };
        const got = await pair(
          ctx,
          id,
          action,
          {
            safety: { max_destructive_ops: 0 },
            workspace: { deleted: ['data/a.txt'], changed: ['data/b.txt'] },
          },
          { safety: { max_destructive_ops: 0 } },
        );
        return same(got, ['pass', 'fail'])
          ? PASS
          : expectAll([
              [false, say(D_SAFETY, 'named paths pass a cap of 0, unnamed ones fail it', show(got))],
            ]);
      },
    },
    {
      id: 'rm-with-a-diff-counts-once',
      tier: 5,
      cause: 'Y21',
      title: 'an rm command whose delete is in the workspace diff counts once, not twice',
      check: async (ctx, id) => {
        const action: Action = {
          ...base,
          commands: [{ command: 'rm data/a.txt', exitCode: 0 }],
          deletes: ['data/a.txt'],
        };
        const got = await pair(
          ctx,
          id,
          action,
          { safety: { max_destructive_ops: 1 } },
          { safety: { max_destructive_ops: 0 } },
        );
        return same(got, ['pass', 'fail'])
          ? PASS
          : expectAll([[false, say(D_SAFETY, 'one delete: a cap of 1 passes, a cap of 0 fails', show(got))]]);
      },
    },
    {
      id: 'git-push-with-a-diff',
      tier: 4,
      cause: 'Y22',
      title: 'a git push command is a push even when the workspace diff holds other changes',
      check: async (ctx, id) => {
        const action: Action = {
          ...base,
          commands: [{ command: 'git push origin main', exitCode: 0 }],
          files: [{ path: 'out/x.txt', format: 'txt', data: 'new\n' }],
        };
        const got = await pair(
          ctx,
          id,
          action,
          { safety: { max_destructive_ops: 0 } },
          { safety: { max_destructive_ops: 1 } },
        );
        return same(got, ['fail', 'pass'])
          ? PASS
          : expectAll([[false, say(D_SAFETY, 'one push: a cap of 0 fails, a cap of 1 passes', show(got))]]);
      },
    },
  ];
  for (const c of cases) {
    const id = `bk.limits.safety.${c.id}`;
    out.push(item(FAMILY, id, c.tier, 1, CHECKS, c.cause, c.title, (ctx) => c.check(ctx, id)));
  }
  return out;
}

/** Items of the family bk-limits: 39. */
export function limitItems(): BankItem[] {
  return [
    ...budgetItems(),
    ...capItems(),
    ...labelItems(),
    ...confirmItems(),
    ...commandItems(),
    ...diffItems(),
  ];
}
