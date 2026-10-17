import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rngFor } from '../../blocks/harness';
import { type BlocksProduct, need } from '../../blocks/product';
import { exec, failOn, transport } from './execute';
import {
  type BankItem,
  blocks,
  CORE,
  call,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  PASS,
  type RunRecord,
  type Scenario,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-lifecycle: retries, run events, the event log, resume and the step guard of one run (docs/running.md "Status,
 * errors and retries", "Run events", "runSpec"; docs/retries.md "What is retried"). A scripted agent throws the
 * transport errors the pages name on the attempts a seeded plan chooses; the product's runner is asked how many times it
 * called the agent, what it recorded and how the run ended.
 */

const FAMILY = 'bg-lifecycle';
const D_RETRY = 'docs/running.md "Status, errors and retries"';
const D_EVENTS = 'docs/running.md "Run events"';

const retriesOf = (rec: RunRecord, index: number): { attempt?: number; status?: number }[] =>
  (rec.blocks[index] as unknown as { observed?: { retries?: { attempt?: number; status?: number }[] } })
    ?.observed?.retries ?? [];

export function plain(ctx: ItemContext, tag: string, n = 3, withCalls = false): Scenario {
  return scenario(
    ctx.seed,
    tag,
    blocks(ctx.seed, tag, n, withCalls ? { 1: [call(word(ctx.seed, `${tag}:tool`, 6), { a: 1 })] } : {}),
  );
}

function retryItems(): BankItem[] {
  const out: BankItem[] = [];
  const retried: { id: string; status?: number }[] = [
    { id: 'status-408', status: 408 },
    { id: 'status-429', status: 429 },
    { id: 'status-500', status: 500 },
    { id: 'status-503', status: 503 },
    { id: 'status-529', status: 529 },
    { id: 'no-status', status: undefined },
  ];
  for (const each of retried) {
    const id = `bg.lifecycle.retry.retried.${each.id}`;
    out.push(
      gitem(
        FAMILY,
        id,
        3,
        CORE,
        'LC1',
        `a transport error with ${each.status ?? 'no status'} is retried: two failures then success completes the block, recorded as two retries`,
        async (ctx) => {
          const sc = plain(ctx, id);
          const r = await exec(ctx, sc, {
            1: failOn(2, () => transport(ctx.product, word(ctx.seed, `${id}:m`, 8), each.status)),
          });
          const marker = sc.users[1] as string;
          const recorded = retriesOf(r.rec, 1);
          return expectAll([
            [
              r.rec.status === 'completed',
              say(
                D_RETRY,
                'the run completes after two retried failures',
                `status ${r.rec.status}: ${show((r.rec as Record<string, unknown>).error)}`,
              ),
            ],
            [
              r.calls.get(marker) === 3,
              say(D_RETRY, 'the agent is called 3 times for the block', `${r.calls.get(marker)}`),
            ],
            [
              recorded.length === 2,
              say(D_RETRY, 'two retries are recorded in the block Observed', show(recorded)),
            ],
            [
              each.status === undefined || recorded.every((entry) => entry.status === each.status),
              say(D_RETRY, `each retry records the status ${each.status}`, show(recorded)),
            ],
            [
              [0, 2].every((i) => retriesOf(r.rec, i).length === 0),
              say(D_RETRY, 'other blocks record no retry', show([0, 2].map((i) => retriesOf(r.rec, i)))),
            ],
          ]);
        },
      ),
    );
  }
  for (const status of [400, 401, 404, 409]) {
    const id = `bg.lifecycle.retry.not-retried.status-${status}`;
    out.push(
      gitem(
        FAMILY,
        id,
        3,
        CORE,
        'LC2',
        `a transport error with ${status} is not retried: the run fails at the first call`,
        async (ctx) => {
          const sc = plain(ctx, id);
          const r = await exec(ctx, sc, {
            1: failOn(1, () => transport(ctx.product, word(ctx.seed, `${id}:m`, 8), status)),
          });
          const marker = sc.users[1] as string;
          return expectAll([
            [
              r.calls.get(marker) === 1,
              say(
                D_RETRY,
                `the agent is called once: ${status} is not transient`,
                `${r.calls.get(marker)} calls`,
              ),
            ],
            [r.rec.status === 'failed', say(D_RETRY, 'the run fails', r.rec.status)],
            [
              retriesOf(r.rec, 1).length === 0,
              say(D_RETRY, 'no retry is recorded', show(retriesOf(r.rec, 1))),
            ],
          ]);
        },
      ),
    );
  }
  const attempts: { id: string; failures: number; maxAttempts?: number; ok: boolean }[] = [
    { id: 'default-three-failures-recover', failures: 3, ok: true },
    { id: 'default-four-failures-fail', failures: 4, ok: false },
    { id: 'two-attempts-one-failure-recovers', failures: 1, maxAttempts: 2, ok: true },
    { id: 'two-attempts-two-failures-fail', failures: 2, maxAttempts: 2, ok: false },
    { id: 'six-attempts-five-failures-recover', failures: 5, maxAttempts: 6, ok: true },
  ];
  for (const each of attempts) {
    const id = `bg.lifecycle.retry.attempts.${each.id}`;
    out.push(
      gitem(
        FAMILY,
        id,
        3,
        CORE,
        'LC3',
        `a call gets ${each.maxAttempts ?? 4} attempts, the first included: ${each.failures} transient failures ${each.ok ? 'recover' : 'end the run'}`,
        async (ctx) => {
          const sc = plain(ctx, id, 2);
          const total = each.maxAttempts ?? 4;
          const r = await exec(
            ctx,
            sc,
            { 0: failOn(each.failures, () => transport(ctx.product, word(ctx.seed, `${id}:m`, 8), 503)) },
            { retry: each.maxAttempts ? { maxAttempts: each.maxAttempts } : {} },
          );
          const marker = sc.users[0] as string;
          const wantCalls = each.ok ? each.failures + 1 : total;
          return expectAll([
            [
              r.calls.get(marker) === wantCalls,
              say(D_RETRY, `the agent is called ${wantCalls} times`, `${r.calls.get(marker)}`),
            ],
            [
              (r.rec.status === 'completed') === each.ok,
              say(D_RETRY, `the run ${each.ok ? 'completes' : 'fails'}`, r.rec.status),
            ],
          ]);
        },
      ),
    );
  }
  const immediate: { id: string; make: (product: BlocksProduct, seed: number, id: string) => Error }[] = [
    {
      id: 'agent-failure',
      make: (product, seed, id) =>
        new (need<new (m: string) => Error>(product.core, 'core', 'AgentFailure'))(word(seed, `${id}:m`, 8)),
    },
    {
      id: 'exhausted-transport-error',
      make: (product, seed, id) => transport(product, word(seed, `${id}:m`, 8), 503, { exhausted: true }),
    },
    { id: 'any-other-error', make: (_p, seed, id) => new Error(word(seed, `${id}:m`, 8)) },
  ];
  for (const each of immediate) {
    const id = `bg.lifecycle.retry.at-once.${each.id}`;
    out.push(
      gitem(
        FAMILY,
        id,
        4,
        CORE,
        'LC4',
        `${each.id.replace(/-/g, ' ')} fails the run at once, without a retry`,
        async (ctx) => {
          const sc = plain(ctx, id);
          const r = await exec(ctx, sc, { 1: failOn(1, () => each.make(ctx.product, ctx.seed, id)) });
          const marker = sc.users[1] as string;
          return expectAll([
            [r.calls.get(marker) === 1, say(D_RETRY, 'the agent is called once', `${r.calls.get(marker)}`)],
            [r.rec.status === 'failed', say(D_RETRY, 'the run fails', r.rec.status)],
            [
              r.rec.blocks.length === 1,
              say(
                D_RETRY,
                'the record keeps the one block that ran before it',
                `${r.rec.blocks.length} blocks`,
              ),
            ],
          ]);
        },
      ),
    );
  }
  const waits: { id: string; failures: number; retry: Record<string, unknown>; want: number[] }[] = [
    {
      id: 'doubling-from-the-base',
      failures: 3,
      retry: { baseDelayMs: 100, maxDelayMs: 100000, jitter: false },
      want: [100, 200, 400],
    },
    {
      id: 'capped-by-the-longest-wait',
      failures: 3,
      retry: { baseDelayMs: 100, maxDelayMs: 250, jitter: false },
      want: [100, 200, 250],
    },
    {
      id: 'another-base',
      failures: 2,
      retry: { baseDelayMs: 30, maxDelayMs: 100000, jitter: false },
      want: [30, 60],
    },
  ];
  for (const each of waits) {
    const id = `bg.lifecycle.retry.wait.${each.id}`;
    out.push(
      gitem(
        FAMILY,
        id,
        4,
        CORE,
        'LC5',
        `the wait before the first retry is the base and each later retry doubles it up to the cap (${each.id})`,
        async (ctx) => {
          const sc = plain(ctx, id, 2);
          const r = await exec(
            ctx,
            sc,
            { 0: failOn(each.failures, () => transport(ctx.product, word(ctx.seed, `${id}:m`, 8), 503)) },
            { retry: each.retry },
          );
          return r.waits.join() === each.want.join()
            ? PASS
            : fail(
                say(
                  'docs/retries.md "The policy"',
                  `the waits are ${each.want.join()} ms with jitter off`,
                  `${r.waits.join()} ms; status ${r.rec.status}`,
                ),
              );
        },
      ),
    );
  }
  out.push(
    gitem(
      FAMILY,
      'bg.lifecycle.retry.wait.full-jitter-stays-below-the-backoff',
      4,
      CORE,
      'LC6',
      'with jitter each wait is drawn below the backoff, so it never passes the doubling schedule',
      async (ctx) => {
        const id = 'bg.lifecycle.retry.wait.full-jitter-stays-below-the-backoff';
        const sc = plain(ctx, id, 2);
        const r = await exec(
          ctx,
          sc,
          { 0: failOn(3, () => transport(ctx.product, word(ctx.seed, `${id}:m`, 8), 503)) },
          { retry: { baseDelayMs: 100, maxDelayMs: 100000, jitter: true, random: () => 0.5 } },
        );
        const limits = [100, 200, 400];
        return r.waits.length === 3 &&
          r.waits.every((wait, i) => wait >= 0 && wait <= (limits[i] as number)) &&
          r.waits.some((wait, i) => wait < (limits[i] as number))
          ? PASS
          : fail(
              say(
                'docs/retries.md "The policy"',
                'each wait is drawn at random below its backoff (100, 200, 400)',
                `${r.waits.join()}`,
              ),
            );
      },
    ),
  );
  return out;
}

function eventItems(): BankItem[] {
  const out: BankItem[] = [];
  const shapes: { id: string; n: number; tools: number }[] = [
    { id: 'no-tool-calls', n: 2, tools: 0 },
    { id: 'one-tool-call', n: 3, tools: 1 },
    { id: 'tool-calls-in-every-block', n: 4, tools: 4 },
  ];
  for (const shape of shapes) {
    const id = `bg.lifecycle.events.count.${shape.id}`;
    out.push(
      gitem(
        FAMILY,
        id,
        3,
        CORE,
        'LC7',
        'the runner reports a block start and a block end for every block, each tool call the adapter recorded, and the end of the run',
        async (ctx) => {
          const labels = Array.from({ length: shape.tools }, (_, i) => word(ctx.seed, `${id}:tool:${i}`, 7));
          const defs = blocks(
            ctx.seed,
            id,
            shape.n,
            Object.fromEntries(labels.map((label, i) => [i, [call(label, { i })]])),
          );
          const sc = scenario(ctx.seed, id, defs);
          const r = await exec(ctx, sc, {});
          const want = 2 * shape.n + shape.tools + 1;
          const withLabel = (label: string) =>
            r.events.filter((event) => JSON.stringify(event).includes(label)).length;
          return expectAll([
            [
              r.events.length === want,
              say(
                D_EVENTS,
                `${want} events (${shape.n} block starts, ${shape.n} block ends, ${shape.tools} tool calls, 1 run end)`,
                `${r.events.length}: ${show(r.events.map((e) => e.type))}`,
              ),
            ],
            [
              labels.every((label) => withLabel(label) === 1),
              say(D_EVENTS, 'one event per tool call, naming the tool', show(labels.map(withLabel))),
            ],
            [
              JSON.stringify(r.events[r.events.length - 1]).includes('completed'),
              say(
                D_EVENTS,
                'the last event is the run end with its status',
                show(r.events[r.events.length - 1]),
              ),
            ],
          ]);
        },
      ),
    );
  }
  out.push(
    gitem(
      FAMILY,
      'bg.lifecycle.events.retry-is-an-event',
      3,
      CORE,
      'LC8',
      'each retry a block took is reported as an event',
      async (ctx) => {
        const id = 'bg.lifecycle.events.retry-is-an-event';
        const base = await exec(ctx, plain(ctx, `${id}:base`, 2), {});
        const sc = plain(ctx, id, 2);
        const r = await exec(ctx, sc, {
          0: failOn(2, () => transport(ctx.product, word(ctx.seed, `${id}:m`, 8), 429)),
        });
        return r.events.length === base.events.length + 2
          ? PASS
          : fail(
              say(
                D_EVENTS,
                `${base.events.length} + 2 events for two retries`,
                `${r.events.length}: ${show(r.events.map((e) => e.type))}`,
              ),
            );
      },
    ),
    gitem(
      FAMILY,
      'bg.lifecycle.events.failed-run-ends-with-its-status',
      3,
      CORE,
      'LC8',
      'a run that fails reports the events of the blocks that ran and ends with a run end event whose status is failed',
      async (ctx) => {
        const id = 'bg.lifecycle.events.failed-run-ends-with-its-status';
        const sc = plain(ctx, id, 3);
        const r = await exec(ctx, sc, { 1: failOn(1, () => new Error(word(ctx.seed, `${id}:m`, 8))) });
        const last = JSON.stringify(r.events[r.events.length - 1]);
        return r.rec.status === 'failed' &&
          last.includes('failed') &&
          !r.events.some((event) => JSON.stringify(event).includes(`"index":2`))
          ? PASS
          : fail(
              say(
                D_EVENTS,
                'events for blocks 0 and 1 only and a run end with status failed',
                `${r.rec.status}: ${show(r.events)}`,
              ),
            );
      },
    ),
    gitem(
      FAMILY,
      'bg.lifecycle.events.in-order',
      3,
      CORE,
      'LC7',
      'the events come in the order the run lived them: the block events of a block stay between its start and its end',
      async (ctx) => {
        const id = 'bg.lifecycle.events.in-order';
        const labels = [word(ctx.seed, `${id}:a`, 7), word(ctx.seed, `${id}:b`, 7)];
        const sc = scenario(
          ctx.seed,
          id,
          blocks(ctx.seed, id, 3, { 0: [call(labels[0] as string)], 2: [call(labels[1] as string)] }),
        );
        const r = await exec(ctx, sc, {});
        const at = labels.map((label) =>
          r.events.findIndex((event) => JSON.stringify(event).includes(label)),
        );
        // 3 blocks: start0, call a, end0, start1, end1, start2, call b, end2, run end.
        return at[0] === 1 && at[1] === 6 && r.events.length === 9
          ? PASS
          : fail(
              say(
                D_EVENTS,
                'tool call a is event 1 and tool call b is event 6 of 9',
                `${show(at)} of ${r.events.length}`,
              ),
            );
      },
    ),
  );
  return out;
}

function sinkItems(): BankItem[] {
  const out: BankItem[] = [];
  const sinkOf = (ctx: ItemContext, path: string) =>
    need<(path: string) => (event: Record<string, unknown>) => void>(
      ctx.product.core,
      'core',
      'eventLogSink',
    )(path);
  const reader = (ctx: ItemContext) =>
    need<(path: string) => Record<string, unknown>[]>(ctx.product.core, 'core', 'readEventLog');
  const logFile = (ctx: ItemContext, id: string) => {
    const dir = join(ctx.scratch, word(ctx.seed, `${id}:dir`, 8));
    mkdirSync(dir, { recursive: true });
    return join(dir, 'events.jsonl');
  };
  out.push(
    gitem(
      FAMILY,
      'bg.lifecycle.sink.appends-every-event',
      3,
      CORE,
      'LC9',
      'eventLogSink(path) appends every event to a JSON-lines file and readEventLog reads them back',
      async (ctx) => {
        const id = 'bg.lifecycle.sink.appends-every-event';
        const path = logFile(ctx, id);
        const sink = sinkOf(ctx, path);
        const r = await exec(ctx, plain(ctx, id, 3, true), {}, { onEvent: sink });
        const lines = readFileSync(path, 'utf8')
          .split('\n')
          .filter((line) => line.trim() !== '');
        const back = reader(ctx)(path);
        return expectAll([
          [
            lines.length === r.events.length,
            say(D_EVENTS, `${r.events.length} lines, one per event`, `${lines.length}`),
          ],
          [
            lines.every((line) => {
              try {
                JSON.parse(line);
                return true;
              } catch {
                return false;
              }
            }),
            say(D_EVENTS, 'every line is JSON', lines[0] ?? ''),
          ],
          [
            JSON.stringify(back) === JSON.stringify(r.events),
            say(D_EVENTS, 'readEventLog returns the events as they were reported', `${back.length} events`),
          ],
        ]);
      },
    ),
    gitem(
      FAMILY,
      'bg.lifecycle.sink.writes-while-the-run-goes-on',
      4,
      CORE,
      'LC9',
      'the sink appends synchronously: when the agent is asked for block 1, the events of block 0 are already in the file',
      async (ctx) => {
        const id = 'bg.lifecycle.sink.writes-while-the-run-goes-on';
        const path = logFile(ctx, id);
        const sink = sinkOf(ctx, path);
        const sc = plain(ctx, id, 3);
        const seen: number[] = [];
        const r = await exec(
          ctx,
          sc,
          {
            1: () => {
              try {
                seen.push(
                  readFileSync(path, 'utf8')
                    .split('\n')
                    .filter((l) => l.trim() !== '').length,
                );
              } catch {
                seen.push(-1);
              }
              return null;
            },
          },
          { onEvent: sink },
        );
        return seen[0] !== undefined && seen[0] >= 2 && seen[0] < r.events.length
          ? PASS
          : fail(
              say(
                D_EVENTS,
                'at least the start and end of block 0 are in the file while block 1 runs',
                `${show(seen)} lines of ${r.events.length}`,
              ),
            );
      },
    ),
    gitem(
      FAMILY,
      'bg.lifecycle.sink.read-skips-a-cut-line',
      4,
      CORE,
      'LC10',
      'readEventLog skips a line cut short by a kill and returns the events before it',
      async (ctx) => {
        const id = 'bg.lifecycle.sink.read-skips-a-cut-line';
        const path = logFile(ctx, id);
        const sink = sinkOf(ctx, path);
        const r = await exec(ctx, plain(ctx, id, 2), {}, { onEvent: sink });
        appendFileSync(path, '{"type":"block_st');
        const back = reader(ctx)(path);
        return JSON.stringify(back) === JSON.stringify(r.events)
          ? PASS
          : fail(say(D_EVENTS, `the ${r.events.length} whole events and no throw`, `${back.length} events`));
      },
    ),
    gitem(
      FAMILY,
      'bg.lifecycle.sink.read-skips-a-cut-line-in-the-middle-of-a-file',
      4,
      CORE,
      'LC10',
      'readEventLog skips a cut-short last line even when the file holds only that line and the events before it',
      async (ctx) => {
        const id = 'bg.lifecycle.sink.read-skips-a-cut-line-in-the-middle-of-a-file';
        const path = logFile(ctx, id);
        writeFileSync(
          path,
          `${JSON.stringify({ type: word(ctx.seed, `${id}:t`, 6), index: 0 })}\n${JSON.stringify({ type: word(ctx.seed, `${id}:u`, 6), index: 1 })}\n{"type":"x`,
        );
        const back = reader(ctx)(path);
        return back.length === 2 ? PASS : fail(say(D_EVENTS, 'two events', `${back.length}: ${show(back)}`));
      },
    ),
    gitem(
      FAMILY,
      'bg.lifecycle.sink.second-run-appends-to-the-file',
      4,
      CORE,
      'LC9',
      'eventLogSink appends: a second run into the same file keeps the events of the first',
      async (ctx) => {
        const id = 'bg.lifecycle.sink.second-run-appends-to-the-file';
        const path = logFile(ctx, id);
        const first = await exec(ctx, plain(ctx, `${id}:a`, 2), {}, { onEvent: sinkOf(ctx, path) });
        const second = await exec(ctx, plain(ctx, `${id}:b`, 3), {}, { onEvent: sinkOf(ctx, path) });
        const back = reader(ctx)(path);
        return back.length === first.events.length + second.events.length
          ? PASS
          : fail(
              say(
                D_EVENTS,
                `${first.events.length} + ${second.events.length} events in the file`,
                `${back.length}`,
              ),
            );
      },
    ),
    gitem(
      FAMILY,
      'bg.lifecycle.sink.a-kill-mid-way-keeps-the-events-before-it',
      5,
      CORE,
      'LC9',
      'a run killed mid-way keeps every event written before the kill: the file holds the events of the blocks that finished',
      async (ctx) => {
        const id = 'bg.lifecycle.sink.a-kill-mid-way-keeps-the-events-before-it';
        const path = logFile(ctx, id);
        const sc = plain(ctx, id, 4);
        const sink = sinkOf(ctx, path);
        const r = await exec(
          ctx,
          sc,
          { 2: failOn(1, () => new Error(word(ctx.seed, `${id}:kill`, 8))) },
          { onEvent: sink },
        );
        const back = reader(ctx)(path);
        const ends = back.filter((event) => JSON.stringify(event).includes('block_end')).length;
        return r.rec.status === 'failed' && ends === 2 && back.length === r.events.length
          ? PASS
          : fail(
              say(
                D_EVENTS,
                'the two finished blocks end in the file, and every event reported is there',
                `${ends} block ends, ${back.length} of ${r.events.length} events`,
              ),
            );
      },
    ),
    gitem(
      FAMILY,
      'bg.lifecycle.sink.read-an-empty-file',
      4,
      CORE,
      'LC10',
      'readEventLog reads a file with no whole line as no event, and a file of whole lines in full',
      async (ctx) => {
        const id = 'bg.lifecycle.sink.read-an-empty-file';
        const path = logFile(ctx, id);
        writeFileSync(path, '{"type":"blo');
        const cut = reader(ctx)(path);
        writeFileSync(path, `${JSON.stringify({ type: word(ctx.seed, `${id}:t`, 6) })}\n`);
        const whole = reader(ctx)(path);
        return cut.length === 0 && whole.length === 1
          ? PASS
          : fail(
              say(
                D_EVENTS,
                'no event from a cut line, one from a whole line',
                `${cut.length} and ${whole.length}`,
              ),
            );
      },
    ),
  );
  return out;
}

function stepItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const [n, max] of [
    [3, 1],
    [4, 2],
    [5, 3],
  ] as [number, number][]) {
    const id = `bg.lifecycle.steps.max-${max}-of-${n}`;
    out.push(
      gitem(
        FAMILY,
        id,
        3,
        CORE,
        'LC11',
        'a driver that does not stop within maxSteps steps stops the run, which keeps the blocks that ran',
        async (ctx) => {
          const sc = plain(ctx, id, n);
          const r = await exec(ctx, sc, {}, { maxSteps: max });
          const whole = await exec(ctx, plain(ctx, `${id}:whole`, n), {}, { maxSteps: n + 10 });
          return expectAll([
            [r.rec.status === 'stopped', say(D_RETRY, 'the run is stopped', r.rec.status)],
            [r.rec.blocks.length === max, say(D_RETRY, `${max} blocks ran`, `${r.rec.blocks.length}`)],
            [
              whole.rec.status === 'completed' && whole.rec.blocks.length === n,
              say(
                D_RETRY,
                'with room for the steps the run completes',
                `${whole.rec.status}, ${whole.rec.blocks.length} blocks`,
              ),
            ],
          ]);
        },
      ),
    );
  }
  return out;
}

function resumeItems(): BankItem[] {
  const out: BankItem[] = [];
  const openCache = (ctx: ItemContext) =>
    need<() => unknown>(ctx.product.store, 'store', 'openMemoryStore')();
  for (const [n, killAt] of [
    [4, 2],
    [5, 1],
    [4, 3],
  ] as [number, number][]) {
    const id = `bg.lifecycle.resume.after-block-${killAt}-of-${n}`;
    out.push(
      gitem(
        FAMILY,
        id,
        5,
        CORE,
        'LC12',
        'a run killed mid-way resumes from its first unfinished block: the cached blocks are read back and the agent is asked from the first block the cache lacks, with the history so far',
        async (ctx) => {
          const cache = openCache(ctx);
          const sc = plain(ctx, id, n);
          const killed = await exec(
            ctx,
            sc,
            { [killAt]: failOn(1, () => new Error(word(ctx.seed, `${id}:kill`, 8))) },
            { cache },
          );
          const resumed = await exec(ctx, sc, {}, { cache });
          const fresh = await exec(ctx, plain(ctx, id, n), {});
          const asked = resumed.turns.map((turn) => turn.marker);
          const want = sc.users.slice(killAt);
          const canon = (rec: RunRecord) =>
            JSON.stringify(rec.blocks.map((block) => block.verdicts.map((v) => `${v.id}:${v.outcome}`)));
          return expectAll([
            [
              killed.rec.status === 'failed' && killed.rec.blocks.length === killAt,
              say(
                D_EVENTS,
                `the killed run keeps its ${killAt} finished blocks`,
                `${killed.rec.status}, ${killed.rec.blocks.length} blocks`,
              ),
            ],
            [
              asked.join() === want.join(),
              say(
                D_EVENTS,
                `the agent is asked for blocks ${killAt}.. only`,
                `${asked.length} turns: ${show(asked.map((m) => sc.users.indexOf(m)))}`,
              ),
            ],
            [
              resumed.turns[0]?.history === 2 * killAt + 1,
              say(
                D_EVENTS,
                'the first turn it is handed holds the history so far (each earlier user message and reply, then the new message)',
                `${resumed.turns[0]?.history} messages`,
              ),
            ],
            [
              resumed.rec.status === 'completed' && resumed.rec.blocks.length === n,
              say(
                D_EVENTS,
                'the resumed run completes',
                `${resumed.rec.status}, ${resumed.rec.blocks.length} blocks`,
              ),
            ],
            [
              canon(resumed.rec) === canon(fresh.rec),
              say(D_EVENTS, 'the resumed run gives the verdicts of an uninterrupted run', 'they differ'),
            ],
          ]);
        },
      ),
    );
  }
  out.push(
    gitem(
      FAMILY,
      'bg.lifecycle.resume.a-complete-cache-asks-the-agent-nothing',
      4,
      CORE,
      'LC13',
      'a run whose every block is in the cache is replayed with cacheHit true and the agent is never asked',
      async (ctx) => {
        const id = 'bg.lifecycle.resume.a-complete-cache-asks-the-agent-nothing';
        const cache = openCache(ctx);
        const sc = plain(ctx, id, 3);
        const first = await exec(ctx, sc, {}, { cache });
        const second = await exec(ctx, sc, {}, { cache });
        return expectAll([
          [
            first.turns.length === 3 && (first.rec as Record<string, unknown>).cacheHit === false,
            say(
              'docs/running.md "The cache and replay"',
              'the first run asks the agent for 3 blocks',
              `${first.turns.length} turns, cacheHit ${(first.rec as Record<string, unknown>).cacheHit}`,
            ),
          ],
          [
            second.turns.length === 0 && (second.rec as Record<string, unknown>).cacheHit === true,
            say(
              'docs/running.md "The cache and replay"',
              'the second run replays from the cache',
              `${second.turns.length} turns, cacheHit ${(second.rec as Record<string, unknown>).cacheHit}`,
            ),
          ],
        ]);
      },
    ),
  );
  void rngFor;
  return out;
}

function recordItems(): BankItem[] {
  const out: BankItem[] = [];
  const openCache = (ctx: ItemContext) =>
    need<() => unknown>(ctx.product.store, 'store', 'openMemoryStore')();
  const bads: { id: string; merge: Record<string, unknown> }[] = [
    { id: 'unknown-key', merge: { zzz: 1 } },
    { id: 'text-is-a-number', merge: { text: 7 } },
    { id: 'segments-is-not-a-list', merge: { segments: 'x' } },
  ];
  for (const each of bads) {
    const id = `bg.lifecycle.observed.invalid-${each.id}`;
    out.push(
      gitem(
        FAMILY,
        id,
        4,
        CORE,
        'LC4',
        `an Observed that does not match the schema as JSON (${each.id}) fails the run at once, without a retry`,
        async (ctx) => {
          const sc = plain(ctx, id);
          const r = await exec(ctx, sc, {}, { merge: { 1: each.merge } });
          const marker = sc.users[1] as string;
          return expectAll([
            [r.rec.status === 'failed', say(D_RETRY, 'the run fails', r.rec.status)],
            [
              r.calls.get(marker) === 1,
              say(D_RETRY, 'the agent is asked once for the block', `${r.calls.get(marker)}`),
            ],
            [
              r.rec.blocks.length === 1,
              say(D_RETRY, 'the record keeps the block that ran before it', `${r.rec.blocks.length}`),
            ],
          ]);
        },
      ),
    );
  }
  for (const [k, costs] of [
    [0, [0.25, 0.5, 1]],
    [1, [0, 2, 0, 3]],
    [2, [0.125]],
  ] as [number, number[]][]) {
    const id = `bg.lifecycle.record.run-cost-sums-the-blocks.${k}`;
    out.push(
      gitem(
        FAMILY,
        id,
        3,
        CORE,
        'LC15',
        'the cost of a run is the sum of the costs of its blocks',
        async (ctx) => {
          const sc = plain(ctx, id, costs.length);
          const merge = Object.fromEntries(costs.map((usd, i) => [i, { cost: { usd } }]));
          const r = await exec(ctx, sc, {}, { merge });
          const want = costs.reduce((a, b) => a + b, 0);
          const got = (r.rec as Record<string, unknown>).cost;
          return typeof got === 'number' && Math.abs(got - want) < 1e-9
            ? PASS
            : fail(say('docs/running.md "The run record"', `a run cost of ${want}`, show(got)));
        },
      ),
    );
  }
  for (const [id, change] of [
    ['another-repeat-is-a-miss', { repeat: 1 }],
    ['another-adapter-version-is-a-miss', { version: 'other' }],
  ] as [string, Record<string, unknown>][])
    out.push(
      gitem(
        FAMILY,
        `bg.lifecycle.cache.${id}`,
        4,
        CORE,
        'LC14',
        'the cache key holds the repeat and the adapter version: a change of either is a miss, the same values a hit',
        async (ctx) => {
          const tag = `bg.lifecycle.cache.${id}`;
          const cache = openCache(ctx);
          const sc = plain(ctx, tag, 3);
          const first = await exec(ctx, sc, {}, { cache, version: 'v-one' });
          const changed = await exec(ctx, sc, {}, { cache, version: 'v-one', ...change });
          const again = await exec(ctx, sc, {}, { cache, version: 'v-one' });
          return expectAll([
            [
              first.turns.length === 3,
              say(
                'docs/running.md "The cache and replay"',
                'the first run asks the agent for 3 blocks',
                `${first.turns.length}`,
              ),
            ],
            [
              changed.turns.length === 3 && (changed.rec as Record<string, unknown>).cacheHit === false,
              say(
                'docs/running.md "The cache and replay"',
                'a change of the key is a miss: the agent is asked again',
                `${changed.turns.length} turns, cacheHit ${(changed.rec as Record<string, unknown>).cacheHit}`,
              ),
            ],
            [
              again.turns.length === 0 && (again.rec as Record<string, unknown>).cacheHit === true,
              say(
                'docs/running.md "The cache and replay"',
                'the first values replay from the cache',
                `${again.turns.length} turns`,
              ),
            ],
          ]);
        },
      ),
    );
  return out;
}

export function lifecycleItems(): BankItem[] {
  return [
    ...retryItems(),
    ...eventItems(),
    ...sinkItems(),
    ...stepItems(),
    ...resumeItems(),
    ...recordItems(),
  ];
}
