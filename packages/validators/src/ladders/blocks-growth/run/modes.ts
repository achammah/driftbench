import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { load, observed, type RawSpec, run, type Seen } from '../../blocks/harness';
import { type Action, plantedAgent } from '../../blocks/kinds';
import { need } from '../../blocks/product';
import { startAgent } from './agent';
import {
  type BankItem,
  blocks,
  CLI,
  CORE,
  call,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  PASS,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-modes: what the three modes and the Given do to a session, a workspace and a history (docs/concepts/run-modes.md
 * "Teacher-forced", docs/concepts/given-when-then.md "Given", "Tool history: records, not prose"; docs/running.md
 * "One block"). The agent keeps state per session; the item reads what each block's session held.
 */

const FAMILY = 'bg-modes';
const D_T = 'docs/concepts/run-modes.md "Teacher-forced"';
const D_GIVEN = 'docs/concepts/given-when-then.md "Given"';
const D_LINT = 'docs/concepts/given-when-then.md "Tool history: records, not prose"';
const D_TASK = 'docs/concepts/run-modes.md "Tasks run in the same three modes"';

type Obs = { text?: string };

/** An agent that counts the turns of its session: its reply says how many turns the session held, this one included. */
function sessionCounter(ctx: ItemContext, sessions: { opened: number }, histories?: Seen[][]) {
  const functionAdapter = need<(options: Record<string, unknown>) => Record<string, unknown>>(
    ctx.product.adapters,
    'adapters',
    'functionAdapter',
  );
  type State = { turns: number; payloads: { tool: string; input: unknown }[] };
  return functionAdapter({
    create: (): State => {
      sessions.opened += 1;
      return { turns: 0, payloads: [] };
    },
    payloads: (state: State) => state.payloads,
    respond: (messages: Seen[], _world: unknown, _vars: unknown, state: State) => {
      state.turns += 1;
      histories?.push(structuredClone(messages));
      const text = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join(' ');
      const marker = /code-[a-z]+/.exec(text.split(' ').slice(-1).join(' '))?.[0] ?? '';
      void marker;
      const last = messages[messages.length - 1]?.content ?? '';
      const tool = /\{call:([a-z]+)\}/.exec(last)?.[1];
      return observed(
        `${last.replace(/\{call:[a-z]+\}/, '')} seen=${state.turns}`,
        tool ? [call(tool, {})] : [],
      );
    },
    deterministic: true,
    version: 'blocks-growth',
  });
}

const seenOf = (rec: { blocks: { observed: Record<string, unknown> }[] }) =>
  rec.blocks.map((b) => /seen=(\d+)/.exec(String((b.observed as Obs).text ?? ''))?.[1] ?? '?');

function sessionItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const n of [2, 3, 4, 5])
    out.push(
      gitem(
        FAMILY,
        `bg.modes.session.t-opens-one-per-block.${n}`,
        4,
        CORE,
        'MD1',
        'in mode T every block opens its own session from its canonical Given, so nothing the agent held in session carries; in F one session holds them all',
        async (ctx) => {
          const tag = `bg.modes.session.t-opens-one-per-block.${n}`;
          const raw = scenario(ctx.seed, tag, blocks(ctx.seed, tag, n)).raw as RawSpec;
          const sessionsT = { opened: 0 };
          const recT = await run(ctx.product, raw, sessionCounter(ctx, sessionsT), { mode: 'T' });
          const sessionsF = { opened: 0 };
          const recF = await run(ctx.product, raw, sessionCounter(ctx, sessionsF), { mode: 'F' });
          return expectAll([
            [
              seenOf(recT).every((count) => count === '1'),
              say(D_T, 'every T block finds a fresh session: seen=1', show(seenOf(recT))),
            ],
            [sessionsT.opened === n, say(D_T, `${n} sessions opened in T`, `${sessionsT.opened}`)],
            [
              seenOf(recF).join() === Array.from({ length: n }, (_, i) => String(i + 1)).join() &&
                sessionsF.opened === 1,
              say(
                D_T,
                'F: one session that holds 1 .. n turns',
                `${show(seenOf(recF))} in ${sessionsF.opened} sessions`,
              ),
            ],
          ]);
        },
      ),
    );
  return out;
}

function maxCallItems(): BankItem[] {
  const out: BankItem[] = [];
  // The last block crosses the cap; the blocks before it stay within. T counts a block's own calls only.
  const cases: { id: string; n: number; cap: number; perBlock: number }[] = [
    { id: 'cap-one-two-blocks', n: 2, cap: 1, perBlock: 1 },
    { id: 'cap-two-three-blocks', n: 3, cap: 2, perBlock: 1 },
    { id: 'cap-three-two-calls-a-block', n: 2, cap: 3, perBlock: 2 },
    { id: 'cap-two-two-calls-a-block', n: 2, cap: 2, perBlock: 2 },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.modes.history.max-calls.${each.id}`,
        4,
        CORE,
        'MD2',
        'the checks of a T block see no earlier block: a cap on calls across the run counts the block alone in T and the blocks before it too in F',
        async (ctx) => {
          const tag = `bg.modes.history.max-calls.${each.id}`;
          const tool = word(ctx.seed, `${tag}:tool`, 7);
          const calls = Object.fromEntries(
            Array.from({ length: each.n }, (_, i) => [
              i,
              Array.from({ length: each.perBlock }, () => call(tool, { i })),
            ]),
          );
          const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, each.n, calls), {
            rules: { max_calls: { [tool]: each.cap } },
          });
          const play = async (mode: 'F' | 'T') => {
            const { scriptedAdapter } = await import('../../blocks/harness');
            const adapter = scriptedAdapter(ctx.product, (turn) => {
              const plan = [...sc.plans].find(([key]) => turn.user.includes(key))?.[1];
              if (!plan) throw new Error('no plan');
              return observed(plan.text, plan.calls ?? []);
            });
            return run(ctx.product, sc.raw as RawSpec, adapter, { mode });
          };
          const T = await play('T');
          const F = await play('F');
          const capFails = (rec: typeof T) =>
            rec.blocks.map((b) =>
              b.verdicts.some((v) => v.id.startsWith('forbidden.max_calls') && v.outcome === 'fail'),
            );
          const wantT = Array.from({ length: each.n }, () => false);
          const wantF = Array.from({ length: each.n }, (_, i) => i === each.n - 1);
          return expectAll([
            [
              capFails(T).join() === wantT.join(),
              say(
                D_T,
                `no T block passes the cap of ${each.cap} on its own ${each.perBlock} calls: ${wantT.join()}`,
                show(capFails(T)),
              ),
            ],
            [
              capFails(F).join() === wantF.join(),
              say(
                'docs/reference/checks.md "Rules on tools"',
                `F: the blocks before count, so only the last block fails the cap: ${wantF.join()}`,
                show(capFails(F)),
              ),
            ],
          ]);
        },
      ),
    );
  out.push(
    gitem(
      FAMILY,
      'bg.modes.history.max-calls.t-block-over-the-cap-alone',
      4,
      CORE,
      'MD2',
      'the checks of a T block see no earlier block: a block whose own calls pass the cap fails it in T as in F',
      async (ctx) => {
        const tag = 'bg.modes.history.max-calls.t-block-over-the-cap-alone';
        const tool = word(ctx.seed, `${tag}:tool`, 7);
        const sc = scenario(
          ctx.seed,
          tag,
          blocks(ctx.seed, tag, 2, { 1: [call(tool, {}), call(tool, {})] }),
          { rules: { max_calls: { [tool]: 1 } } },
        );
        const { scriptedAdapter } = await import('../../blocks/harness');
        const adapter = scriptedAdapter(ctx.product, (turn) => {
          const plan = [...sc.plans].find(([key]) => turn.user.includes(key))?.[1];
          if (!plan) throw new Error('no plan');
          return observed(plan.text, plan.calls ?? []);
        });
        const T = await run(ctx.product, sc.raw as RawSpec, adapter, { mode: 'T' });
        const fails = T.blocks.map((b) =>
          b.verdicts.some((v) => v.id.startsWith('forbidden.max_calls') && v.outcome === 'fail'),
        );
        return fails.join() === 'false,true'
          ? PASS
          : fail(say(D_T, 'block 1 fails the cap on its own two calls', show(fails)));
      },
    ),
  );
  return out;
}

function prefixItems(): BankItem[] {
  const out: BankItem[] = [];
  const cases: { id: string; n: number; at: number[] }[] = [
    { id: 'one-prefix-in-the-middle', n: 3, at: [1] },
    { id: 'prefix-at-the-last-block', n: 4, at: [3] },
    { id: 'two-prefixes', n: 5, at: [1, 3] },
    { id: 'no-prefix', n: 3, at: [] },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.modes.prefix.${each.id}`,
        4,
        CORE,
        'MD3',
        "a block's given.prefix ends the open session: the next send opens a new one whose history is that prefix, and later blocks continue from it",
        async (ctx) => {
          const tag = `bg.modes.prefix.${each.id}`;
          const prefixes = each.at.map((at) => [
            { role: 'user', content: word(ctx.seed, `${tag}:pu:${at}`, 9) },
            { role: 'assistant', content: word(ctx.seed, `${tag}:pa:${at}`, 9) },
          ]);
          const defs = blocks(
            ctx.seed,
            tag,
            each.n,
            {},
            Object.fromEntries(each.at.map((at, k) => [at, { given: { prefix: prefixes[k] } }])),
          );
          const sc = scenario(ctx.seed, tag, defs);
          const sessions = { opened: 0 };
          const histories: Seen[][] = [];
          const rec = await run(ctx.product, sc.raw as RawSpec, sessionCounter(ctx, sessions, histories), {
            mode: 'F',
          });
          const lines = (turn: Seen[] | undefined) =>
            (turn ?? []).map((m) => `${m.role}:${m.content.replace(/ seen=\d+/, '')}`);
          const problems: (string | false)[] = [
            sessions.opened !== each.at.length + 1 &&
              say(
                D_GIVEN,
                `${each.at.length + 1} sessions: one at the start, one after each prefix`,
                `${sessions.opened}`,
              ),
            rec.blocks.length !== each.n && say(D_GIVEN, `${each.n} blocks`, `${rec.blocks.length}`),
          ];
          for (const [k, at] of each.at.entries()) {
            const prefix = prefixes[k] as { role: string; content: string }[];
            const turn = lines(histories[at]);
            const want = [
              `user:${prefix[0]?.content}`,
              `assistant:${prefix[1]?.content}`,
              `user:${sc.users[at]}`,
            ];
            if (turn.join() !== want.join())
              problems.push(say(D_GIVEN, `block ${at} starts from its prefix: ${show(want)}`, show(turn)));
            // The block after continues from the prefix, the block, and the agent's reply.
            const next = histories[at + 1];
            if (next && lines(next).slice(0, 2).join() !== want.slice(0, 2).join())
              problems.push(say(D_GIVEN, `block ${at + 1} continues from the prefix`, show(lines(next))));
          }
          const found = problems.find((p) => typeof p === 'string');
          return found ? fail(found as string) : PASS;
        },
      ),
    );
  return out;
}

function lintItems(): BankItem[] {
  const out: BankItem[] = [];
  type Spot =
    | 'spec-given'
    | 'own-given'
    | 'earlier-given'
    | 'later-given'
    | 'earlier-add'
    | 'own-add'
    | 'later-add'
    | 'upper-case-text';
  const cases: { id: Spot; warns: boolean }[] = [
    { id: 'spec-given', warns: true },
    { id: 'own-given', warns: true },
    { id: 'earlier-given', warns: true },
    { id: 'later-given', warns: false },
    { id: 'earlier-add', warns: true },
    { id: 'own-add', warns: false },
    { id: 'later-add', warns: false },
    { id: 'upper-case-text', warns: true },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.modes.lint.${each.id}`,
        4,
        CORE,
        'MD4',
        'PREFIX_PROSE_HISTORY reads the ledger values of the spec given, of each block given up to the block and the ledger_add of the blocks before it, and no more',
        async (ctx) => {
          const tag = `bg.modes.lint.${each.id}`;
          const fact = word(ctx.seed, `${tag}:fact`, 8);
          const key = word(ctx.seed, `${tag}:key`, 6);
          const at = 2;
          const prefix = [
            { role: 'user', content: word(ctx.seed, `${tag}:pu`, 9) },
            {
              role: 'assistant',
              content: `Your ${word(ctx.seed, `${tag}:noun`, 5)} is ${each.id === 'upper-case-text' ? fact.toUpperCase() : fact}.`,
            },
          ];
          const raws = Array.from({ length: 4 }, (_, i) => ({
            id: `b${i}${word(ctx.seed, `${tag}:b${i}`, 4)}`,
            user: word(ctx.seed, `${tag}:u${i}`, 10),
            expect: { tools: [{ label: word(ctx.seed, `${tag}:t`, 6), count: 0 }] } as Record<
              string,
              unknown
            >,
          })) as Record<string, unknown>[];
          const put = (i: number, patch: Record<string, unknown>) => {
            raws[i] = { ...raws[i], ...patch };
          };
          put(at, { given: { prefix, ...(each.id === 'own-given' ? { ledger: { [key]: fact } } : {}) } });
          if (each.id === 'earlier-given') put(1, { given: { ledger: { [key]: fact } } });
          if (each.id === 'later-given') put(3, { given: { ledger: { [key]: fact } } });
          const addTo =
            each.id === 'earlier-add' ? 0 : each.id === 'own-add' ? at : each.id === 'later-add' ? 3 : -1;
          if (addTo >= 0)
            put(addTo, { expect: { ...(raws[addTo]?.expect as object), ledger_add: { [key]: fact } } });
          if (each.id === 'upper-case-text')
            put(0, { expect: { ...(raws[0]?.expect as object), ledger_add: { [key]: fact } } });
          const raw: RawSpec = {
            id: word(ctx.seed, `${tag}:spec`, 8),
            channel: 'chat',
            ...(each.id === 'spec-given' ? { given: { ledger: { [key]: fact } } } : {}),
            blocks: raws,
          };
          const spec = load(ctx.product, raw);
          const lintSpec = need<(spec: unknown) => { code: string; path: string }[]>(
            ctx.product.core,
            'core',
            'lintSpec',
          );
          const found = lintSpec(spec).filter((issue) => issue.code === 'PREFIX_PROSE_HISTORY');
          const want = `blocks.${at}.given.prefix.1`;
          return each.warns
            ? found.length === 1 && found[0]?.path === want
              ? PASS
              : fail(say(D_LINT, `one PREFIX_PROSE_HISTORY at ${want}`, show(found.map((f) => f.path))))
            : found.length === 0
              ? PASS
              : fail(
                  say(
                    D_LINT,
                    'no PREFIX_PROSE_HISTORY: the value is not a ledger value at that block',
                    show(found.map((f) => f.path)),
                  ),
                );
        },
      ),
    );
  return out;
}

function workspaceItems(): BankItem[] {
  const out: BankItem[] = [];
  type Case = { id: string; mode: 'F' | 'T'; second: 'inherits' | 'own'; third?: boolean };
  const cases: Case[] = [
    { id: 't-carries-the-workspace-forward', mode: 'T', second: 'inherits' },
    { id: 't-own-workspace-starts-fresh', mode: 'T', second: 'own' },
    { id: 'f-carries-the-workspace-forward', mode: 'F', second: 'inherits' },
    { id: 't-chain-after-an-own-workspace', mode: 'T', second: 'own', third: true },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.modes.workspace.${each.id}`,
        5,
        CORE,
        'MD5',
        'on an adapter with a sandbox a block starts from the workspace the block before left, unless it writes its own given.world.workspace, and the first step starts from workspace_seed',
        async (ctx) => {
          const tag = `bg.modes.workspace.${each.id}`;
          const [m0, m1, m2] = [0, 1, 2].map((i) => word(ctx.seed, `${tag}:m${i}`, 8));
          const seedFile = `data/${word(ctx.seed, `${tag}:seed`, 6)}.txt`;
          const made0 = `out/${word(ctx.seed, `${tag}:made0`, 6)}.txt`;
          const made1 = `out/${word(ctx.seed, `${tag}:made1`, 6)}.txt`;
          const own = `own/${word(ctx.seed, `${tag}:own`, 6)}.txt`;
          const actions = new Map<string, Action>([
            [m0 as string, { reply: 'Done.', files: [{ path: made0, format: 'txt', data: 'zero' }] }],
            [m1 as string, { reply: 'Done.', files: [{ path: made1, format: 'txt', data: 'one' }] }],
            [m2 as string, { reply: 'Done.' }],
          ]);
          const planted = plantedAgent(ctx.product, 'code', actions, { scratch: ctx.scratch });
          const raw: RawSpec = {
            id: word(ctx.seed, `${tag}:spec`, 8),
            kind: 'task',
            workspace_seed: { files: { [seedFile]: 'seed' } },
            blocks: [
              { id: `a${word(ctx.seed, `${tag}:a`, 4)}`, user: `${m0} write the first file` },
              {
                id: `b${word(ctx.seed, `${tag}:b`, 4)}`,
                user: `${m1} write the second file`,
                ...(each.second === 'own'
                  ? { given: { world: { workspace: { files: { [own]: 'own' } } } } }
                  : {}),
              },
              { id: `c${word(ctx.seed, `${tag}:c`, 4)}`, user: `${m2} look around` },
            ],
          };
          const rec = await run(ctx.product, raw, planted.adapter, { mode: each.mode });
          const turns = planted.delivered();
          const seen = (i: number) => [...(turns[i]?.files ?? [])].sort();
          const lines: (string | false)[] = [
            rec.blocks.length !== 3 &&
              say(D_TASK, '3 blocks run', `${rec.blocks.length} blocks, status ${rec.status}`),
            seen(0).join() !== [seedFile].join() &&
              say(D_TASK, `the first step starts from workspace_seed (${seedFile})`, show(seen(0))),
          ];
          const wantSecond = each.second === 'own' ? [own] : [made0, seedFile].sort();
          lines.push(
            seen(1).join() !== wantSecond.sort().join() &&
              say(
                each.mode === 'T' ? D_TASK : D_GIVEN,
                `the second step starts from ${each.second === 'own' ? 'its own workspace only' : 'the workspace the first step left'}: ${show(wantSecond)}`,
                show(seen(1)),
              ),
          );
          const wantThird = each.second === 'own' ? [own, made1] : [made0, made1, seedFile];
          lines.push(
            seen(2).join() !== wantThird.sort().join() &&
              say(
                D_TASK,
                `the third step starts from what the second left: ${show(wantThird)}`,
                show(seen(2)),
              ),
          );
          const found = lines.find((l) => typeof l === 'string');
          return found ? fail(found as string) : PASS;
        },
      ),
    );
  return out;
}

function noteItems(): BankItem[] {
  const out: BankItem[] = [];
  const NOTE = 'Not recorded: this earlier call comes from a replayed conversation';
  type Case = { id: string; mode: 'F' | 'T'; forced: boolean; result: boolean; note: boolean };
  const cases: Case[] = [
    { id: 't-canonical-call-has-no-result', mode: 'T', forced: false, result: false, note: true },
    { id: 't-forced-result-replaces-the-note', mode: 'T', forced: true, result: false, note: false },
    { id: 'f-call-without-result', mode: 'F', forced: false, result: false, note: true },
    { id: 'f-call-with-result', mode: 'F', forced: false, result: true, note: false },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.modes.history-note.${each.id}`,
        5,
        CLI,
        'MD6',
        'a model-backed adapter sends a call with no result as the text "Not recorded: ..." in its place, never null',
        async (ctx) => {
          const tag = `bg.modes.history-note.${each.id}`;
          const dir = join(ctx.scratch, word(ctx.seed, `${tag}:dir`, 8));
          mkdirSync(dir, { recursive: true });
          const tool = word(ctx.seed, `${tag}:tool`, 7);
          const users = [0, 1].map((i) => word(ctx.seed, `${tag}:u${i}`, 10));
          const field = word(ctx.seed, `${tag}:field`, 5);
          const value = word(ctx.seed, `${tag}:value`, 8);
          const forcedResult = word(ctx.seed, `${tag}:forced`, 9);
          const agent = await startAgent((user) => {
            const first = user.includes(users[0] as string);
            if (first && each.mode === 'F')
              return {
                text: 'ok',
                raw: each.result
                  ? { ...observed('ok', [call(tool, { [field]: value })]) }
                  : {
                      segments: [
                        { type: 'tool_call', id: 'c1', label: tool, input: { [field]: value } },
                        { type: 'text', text: 'ok' },
                      ],
                      text: 'ok',
                      toolCalls: [{ id: 'c1', label: tool, input: { [field]: value } }],
                      cost: { usd: 0 },
                      latencyMs: 0,
                    },
              };
            return { text: 'ok' };
          });
          try {
            const spec = {
              id: word(ctx.seed, `${tag}:spec`, 8),
              target: {
                adapter: 'http',
                agent: 'larkspur',
                options: { url: agent.url, tool_stubs: each.forced, deterministic: true },
              },
              ...(each.forced
                ? { given: { world: { tools: { [tool]: { result: { ref: forcedResult } } } } } }
                : {}),
              blocks: [
                {
                  id: `a${word(ctx.seed, `${tag}:a`, 4)}`,
                  user: users[0],
                  expect: { tools: [{ label: tool, count: 1, input: { [field]: value } }] },
                },
                { id: `b${word(ctx.seed, `${tag}:b`, 4)}`, user: users[1] },
              ],
            };
            const path = join(dir, 'spec.yaml');
            writeFileSync(path, stringify(spec));
            await ctx.product.cli(['campaign', 'run', path, '--mode', each.mode, '--no-cache'], dir);
            const second = agent.requests.find((req) => req.user.includes(users[1] as string));
            const body = second?.body ?? '';
            return expectAll([
              [!!second, say(D_T, 'the second block reaches the agent', `${agent.requests.length} requests`)],
              [
                body.includes(NOTE) === each.note,
                say(
                  D_T,
                  `the second request ${each.note ? 'carries' : 'does not carry'} the note`,
                  body.slice(0, 300),
                ),
              ],
              [
                !each.forced || body.includes(forcedResult),
                say(D_T, 'the forced result is in the history', body.slice(0, 300)),
              ],
              [
                !each.note || !/"output":null/.test(body),
                say(D_T, 'a call with no result is never sent with output null', body.slice(0, 300)),
              ],
            ]);
          } finally {
            await agent.close();
          }
        },
      ),
    );
  return out;
}

export function modesItems(): BankItem[] {
  return [
    ...sessionItems(),
    ...maxCallItems(),
    ...prefixItems(),
    ...lintItems(),
    ...workspaceItems(),
    ...noteItems(),
  ];
}
