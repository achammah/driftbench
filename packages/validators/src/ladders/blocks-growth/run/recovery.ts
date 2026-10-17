import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { observed } from '../../blocks/harness';
import { startAgent } from './agent';
import {
  type BankItem,
  blocks,
  type Call,
  CLI,
  CORE,
  call,
  codeOf,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  observedParts,
  PASS,
  playP,
  type RunRecord,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-recovery: the parts of the recovery page the first banks leave out (docs/concepts/recovery.md): the metrics on
 * every perturbed run whatever its class, the detour a safe action looks at, the order a clarification is read from,
 * the reference of a P cell in a campaign, and the field the metrics never read.
 */

const FAMILY = 'bg-recovery';
const D_REC = 'docs/concepts/recovery.md "Recovery metrics"';
const D_SAFE = 'docs/concepts/recovery.md "Safe action"';
const D_CLAR = 'docs/concepts/recovery.md "Clarification"';
const D_COLL = 'docs/concepts/recovery.md "Collateral"';
const D_WRITE = 'docs/concepts/recovery.md "Writing a perturbation"';

const CLASSES = [
  'D1_off_topic',
  'D2_goal_shift',
  'D3_contradiction',
  'D4_loose_confirmation',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D7_silence_or_burst',
  'D8_tool_failure',
  'D9_out_of_scope',
  'D10_return',
  'D11_pii_leak',
  'D12_prompt_extraction',
];

type Metrics = {
  injectedAt?: number;
  turnsToRecover?: number;
  label?: string;
  collateral?: number;
  safeAction?: boolean;
  clarified?: boolean;
};

type Cfg = {
  tag: string;
  n: number;
  k: number;
  cls?: string;
  /** What the injected block's reply is: text, calls, or a whole Observed. */
  injected: { text?: string; calls?: Call[]; reply?: () => Record<string, unknown>; fails?: boolean };
  /** Spec blocks (by spec index) that fail, and calls they make. */
  failing?: number[];
  calls?: Record<number, Call[]>;
  consequential?: (label: string) => boolean;
  recovery?: Record<string, unknown>;
};

async function recRun(ctx: ItemContext, cfg: Cfg) {
  const pid = word(ctx.seed, `${cfg.tag}:pid`, 6);
  const iw = word(ctx.seed, `${cfg.tag}:iw`, 10);
  const icode = word(ctx.seed, `${cfg.tag}:icode`, 9);
  const defs = blocks(ctx.seed, cfg.tag, cfg.n, cfg.calls ?? {});
  for (const i of cfg.failing ?? []) (defs[i] as { plan: { text: string } }).plan.text = 'Let me look.';
  const sc = scenario(ctx.seed, cfg.tag, defs, {
    perturbations: [
      {
        id: pid,
        class: cfg.cls ?? 'D1_off_topic',
        inject_at: cfg.k,
        user: iw,
        expect: { must: [icode] },
        recovery: cfg.recovery ?? { within_blocks: 1 },
      },
    ],
  });
  const inj = cfg.injected;
  sc.plans.set(iw, {
    text: '',
    reply: () =>
      inj.reply
        ? inj.reply()
        : observed(inj.fails ? 'Let me look.' : `${inj.text ?? 'Yes'}, ${icode}.`, inj.calls ?? []),
  });
  const played = await playP(ctx, sc, pid, cfg.consequential ? { consequential: cfg.consequential } : {});
  const rec = played.rec as RunRecord & { recovery?: Metrics };
  return { rec, metrics: rec.recovery, icode };
}

function classItems(): BankItem[] {
  return CLASSES.map((cls) =>
    gitem(
      FAMILY,
      `bg.recovery.class.${cls}`,
      3,
      CORE,
      'RV1',
      `safeAction and clarified are measured on a perturbed run of class ${cls}`,
      async (ctx) => {
        const tag = `bg.recovery.class.${cls}`;
        const tool = word(ctx.seed, `${tag}:tool`, 7);
        const consequential = (label: string) => label === tool;
        const careful = await recRun(ctx, {
          tag: `${tag}:careful`,
          n: 3,
          k: 1,
          cls,
          injected: { text: 'Is that right? Yes' },
          consequential,
        });
        const rash = await recRun(ctx, {
          tag: `${tag}:rash`,
          n: 3,
          k: 1,
          cls,
          injected: { text: 'Done', calls: [call(tool)] },
          consequential,
        });
        return expectAll([
          [
            typeof careful.metrics?.safeAction === 'boolean' &&
              typeof careful.metrics?.clarified === 'boolean',
            say(D_REC, 'safeAction and clarified are on the run', show(careful.metrics)),
          ],
          [
            careful.metrics?.safeAction === true && careful.metrics?.clarified === true,
            say(D_REC, 'a question and no act: safe and clarified', show(careful.metrics)),
          ],
          [
            rash.metrics?.safeAction === false && rash.metrics?.clarified === false,
            say(D_REC, 'an unnamed consequential call and no question: neither', show(rash.metrics)),
          ],
        ]);
      },
    ),
  );
}

function detourItems(): BankItem[] {
  const out: BankItem[] = [];
  // Run blocks: 0 | injected (1) | 2 = spec block 1 | 3 = spec block 2 | 4 = spec block 3 ...
  const cases: {
    id: string;
    n: number;
    failing: number[];
    at: 'before' | 'injected' | 'recovered' | 'after' | 'last';
    injectedFails: boolean;
    safe: boolean;
  }[] = [
    { id: 'call-before-the-injection', n: 4, failing: [], at: 'before', injectedFails: false, safe: true },
    {
      id: 'call-in-the-injected-block',
      n: 4,
      failing: [],
      at: 'injected',
      injectedFails: false,
      safe: false,
    },
    {
      id: 'call-in-the-block-that-recovered',
      n: 4,
      failing: [],
      at: 'recovered',
      injectedFails: true,
      safe: false,
    },
    { id: 'call-after-the-recovery', n: 5, failing: [], at: 'after', injectedFails: true, safe: true },
    {
      id: 'call-in-the-last-block-of-a-run-that-never-recovers',
      n: 4,
      failing: [1, 2, 3],
      at: 'last',
      injectedFails: true,
      safe: false,
    },
    {
      id: 'call-after-an-immediate-recovery',
      n: 4,
      failing: [],
      at: 'after',
      injectedFails: false,
      safe: true,
    },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.recovery.detour.${each.id}`,
        4,
        CORE,
        'RV2',
        'the detour runs from the injected block to the block that recovered, or to the end of the run: only a consequential call inside it makes safeAction false',
        async (ctx) => {
          const tag = `bg.recovery.detour.${each.id}`;
          const tool = word(ctx.seed, `${tag}:tool`, 7);
          const consequential = (label: string) => label === tool;
          const spec =
            each.at === 'before'
              ? 0
              : each.at === 'recovered'
                ? 1
                : each.at === 'after'
                  ? each.injectedFails
                    ? 2
                    : 1
                  : each.at === 'last'
                    ? each.n - 1
                    : -1;
          const r = await recRun(ctx, {
            tag,
            n: each.n,
            k: 1,
            injected: each.at === 'injected' ? { calls: [call(tool)] } : { fails: each.injectedFails },
            failing: each.failing,
            calls: spec >= 0 ? { [spec]: [call(tool)] } : {},
            consequential,
          });
          return expectAll([
            [
              each.injectedFails !== (r.metrics?.turnsToRecover === 0),
              say(
                D_REC,
                `the run ${each.injectedFails ? 'recovers a block after the injected one (or never)' : 'recovers at the injected block'}`,
                show(r.metrics),
              ),
            ],
            [r.metrics?.safeAction === each.safe, say(D_SAFE, `safeAction ${each.safe}`, show(r.metrics))],
          ]);
        },
      ),
    );
  return out;
}

function clarifyItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (id: string, title: string, check: (ctx: ItemContext, tag: string) => Promise<ItemResult>) =>
    out.push(
      gitem(FAMILY, `bg.recovery.clarify.${id}`, 4, CORE, 'RV3', title, (ctx) =>
        check(ctx, `bg.recovery.clarify.${id}`),
      ),
    );
  const raw = (text: string, calls: Call[], withCallSegments: boolean) => () => {
    const base = withCallSegments
      ? observedParts([{ text }, ...calls.map((c) => ({ call: c }))])
      : observed(text, []);
    return withCallSegments
      ? base
      : {
          ...base,
          toolCalls: calls.map((c, i) => ({
            id: `call-${i}`,
            label: c.label,
            input: c.input ?? {},
            output: { ok: true },
          })),
        };
  };
  add(
    'calls-in-the-tool-calls-only',
    'a block whose segments hold no tool call counts its consequential calls before its text: the question after them is no clarification',
    async (ctx, tag) => {
      const tool = word(ctx.seed, `${tag}:tool`, 7);
      const r = await recRun(ctx, {
        tag,
        n: 3,
        k: 1,
        injected: {
          reply: raw(`Which one do you want, ${word(ctx.seed, `${tag}:w`, 6)}?`, [call(tool)], false),
        },
        consequential: (l) => l === tool,
      });
      return r.metrics?.clarified === false
        ? PASS
        : fail(say(D_CLAR, 'clarified false: the call is counted before the text', show(r.metrics)));
    },
  );
  add(
    'question-segment-before-the-call-segment',
    'a question in a segment before the first consequential call segment is a clarification',
    async (ctx, tag) => {
      const tool = word(ctx.seed, `${tag}:tool`, 7);
      const r = await recRun(ctx, {
        tag,
        n: 3,
        k: 1,
        injected: { reply: () => observedParts([{ text: 'Which one do you want?' }, { call: call(tool) }]) },
        consequential: (l) => l === tool,
      });
      return r.metrics?.clarified === true ? PASS : fail(say(D_CLAR, 'clarified true', show(r.metrics)));
    },
  );
  add(
    'question-segment-after-the-call-segment',
    'a question in a segment after the first consequential call segment is no clarification',
    async (ctx, tag) => {
      const tool = word(ctx.seed, `${tag}:tool`, 7);
      const r = await recRun(ctx, {
        tag,
        n: 3,
        k: 1,
        injected: { reply: () => observedParts([{ call: call(tool) }, { text: 'Which one do you want?' }]) },
        consequential: (l) => l === tool,
      });
      return r.metrics?.clarified === false ? PASS : fail(say(D_CLAR, 'clarified false', show(r.metrics)));
    },
  );
  add(
    'calls-that-are-not-consequential-do-not-count',
    'a call that is not consequential does not decide the order: the question still clarifies',
    async (ctx, tag) => {
      const tool = word(ctx.seed, `${tag}:tool`, 7);
      const r = await recRun(ctx, {
        tag,
        n: 3,
        k: 1,
        injected: { reply: raw('Which one do you want?', [call(tool)], false) },
        consequential: () => false,
      });
      return r.metrics?.clarified === true
        ? PASS
        : fail(say(D_CLAR, 'clarified true: no consequential call', show(r.metrics)));
    },
  );
  return out;
}

function returnMessageItems(): BankItem[] {
  const out: BankItem[] = [];
  const cases: { id: string; message: (ctx: ItemContext, tag: string, code: string) => string }[] = [
    { id: 'pattern-never-matches', message: (ctx, tag) => word(ctx.seed, `${tag}:never`, 14) },
    { id: 'pattern-matches-the-reply', message: (_c, _t, code) => code },
    { id: 'pattern-is-not-a-regex-at-all', message: (ctx, tag) => `(${word(ctx.seed, `${tag}:open`, 5)}` },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.recovery.return-message.${each.id}`,
        3,
        CORE,
        'RV4',
        'recovery.return_message is accepted by the schema and no metric reads it',
        async (ctx) => {
          const tag = `bg.recovery.return-message.${each.id}`;
          const code = word(ctx.seed, `${tag}:icode`, 9);
          void code;
          const base = await recRun(ctx, {
            tag,
            n: 3,
            k: 1,
            injected: { fails: true },
            recovery: { within_blocks: 1 },
          });
          const withMessage = await recRun(ctx, {
            tag,
            n: 3,
            k: 1,
            injected: { fails: true },
            recovery: { within_blocks: 1, return_message: each.message(ctx, tag, base.icode) },
          });
          return expectAll([
            [
              base.rec.status === 'completed' && withMessage.rec.status === 'completed',
              say(
                D_WRITE,
                'the spec with return_message loads and runs',
                `${base.rec.status} / ${withMessage.rec.status}`,
              ),
            ],
            [
              JSON.stringify(withMessage.metrics) === JSON.stringify(base.metrics),
              say(
                D_WRITE,
                'the metrics are the same with and without return_message',
                `${show(base.metrics)} against ${show(withMessage.metrics)}`,
              ),
            ],
          ]);
        },
      ),
    );
  return out;
}

type Row = { perturbation: string; repeat: number; collateral: number };

function parseRecovery(out: string): Row[] {
  const rows: Row[] = [];
  for (const line of out.split('\n')) {
    const match =
      /^\s+(\S+)\s+(\S+)\s+(D\d+_\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(immediate|late|never)\s+(\d+)\s+(yes|no)\s+(yes|no)\s*$/.exec(
        line,
      );
    if (match)
      rows.push({ perturbation: match[2] as string, repeat: Number(match[4]), collateral: Number(match[8]) });
  }
  return rows;
}

function campaignItems(): BankItem[] {
  const out: BankItem[] = [];
  const cases: {
    id: string;
    flags: string[];
    repeats: number;
    failing: (counter: number) => boolean;
    want: number[];
    cause: string;
    tier: 4 | 5;
  }[] = [
    // F repeat 0: requests 1-3, F repeat 1: 4-6, P repeat 0: 7-10, P repeat 1: 11-14. Block 2 of a run is request 3, 6, 10, 14.
    {
      id: 'same-repeat-reference',
      flags: ['--mode', 'F,P'],
      repeats: 2,
      failing: (c) => [6, 10, 14].includes(c),
      want: [1, 0],
      cause: 'the F run of the same spec, target and repeat',
      tier: 5,
    },
    {
      id: 'reference-fails-too',
      flags: ['--mode', 'F,P'],
      repeats: 1,
      failing: (c) => [3, 7].includes(c),
      want: [0],
      cause: 'a block that fails in the F run is no collateral',
      tier: 4,
    },
    {
      id: 'reference-passes',
      flags: ['--mode', 'F,P'],
      repeats: 1,
      failing: (c) => c === 7,
      want: [1],
      cause: 'a block that passes in the F run and fails in the P run is collateral',
      tier: 4,
    },
    {
      id: 'no-f-cell-no-reference',
      flags: ['--mode', 'P'],
      repeats: 1,
      failing: (c) => c === 4,
      want: [1],
      cause: 'with no F cell the blocks after the recovery that fail count',
      tier: 4,
    },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.recovery.campaign.${each.id}`,
        each.tier,
        CLI,
        'RV5',
        `in a campaign the reference of a P cell is ${each.cause}`,
        async (ctx) => {
          const tag = `bg.recovery.campaign.${each.id}`;
          const dir = join(ctx.scratch, word(ctx.seed, `${tag}:dir`, 8));
          mkdirSync(dir, { recursive: true });
          const users = [0, 1, 2].map((i) => word(ctx.seed, `${tag}:u${i}`, 10));
          const codes = [0, 1, 2].map((i) => codeOf(ctx.seed, tag, i));
          const iw = word(ctx.seed, `${tag}:iw`, 10);
          const icode = word(ctx.seed, `${tag}:icode`, 9);
          const pid = word(ctx.seed, `${tag}:pid`, 6);
          let counter = 0;
          const agent = await startAgent((user) => {
            counter += 1;
            if (user.includes(iw)) return { text: `Yes, ${icode}.` };
            const at = users.findIndex((u) => user.includes(u));
            return { text: each.failing(counter) && at === 2 ? 'Let me look.' : `Yes, ${codes[at]}.` };
          });
          try {
            const spec = {
              id: word(ctx.seed, `${tag}:spec`, 8),
              target: {
                adapter: 'http',
                agent: 'larkspur',
                options: { url: agent.url, tool_stubs: false, deterministic: true },
              },
              blocks: users.map((user, i) => ({
                id: `b${i}${word(ctx.seed, `${tag}:b${i}`, 4)}`,
                user,
                expect: { must: [codes[i]] },
              })),
              perturbations: [
                {
                  id: pid,
                  class: 'D1_off_topic',
                  inject_at: 1,
                  user: iw,
                  expect: { must: [icode] },
                  recovery: { within_blocks: 1 },
                },
              ],
            };
            const path = join(dir, 'spec.yaml');
            writeFileSync(path, stringify(spec));
            const store = join(dir, 'store.db');
            await ctx.product.cli(
              [
                'campaign',
                'run',
                path,
                ...each.flags,
                '--repeats',
                String(each.repeats),
                '--concurrency',
                '1',
                '--no-cache',
                '--store',
                store,
                '--campaign',
                'c-rec',
              ],
              dir,
            );
            const status = await ctx.product.cli(
              ['campaign', 'status', 'c-rec', '--store', store, '--detail'],
              dir,
            );
            const rows = parseRecovery(status.out).sort((a, b) => a.repeat - b.repeat);
            return rows.map((row) => row.collateral).join() === each.want.join()
              ? PASS
              : fail(
                  say(
                    D_COLL,
                    `collateral ${each.want.join()} by repeat`,
                    `${rows.length} rows ${show(rows)}; requests ${counter}; ${status.out.slice(-300)}`,
                  ),
                );
          } finally {
            await agent.close();
          }
        },
      ),
    );
  return out;
}

export function recoveryItems(): BankItem[] {
  return [...classItems(), ...detourItems(), ...clarifyItems(), ...returnMessageItems(), ...campaignItems()];
}
void mkdirSync;
