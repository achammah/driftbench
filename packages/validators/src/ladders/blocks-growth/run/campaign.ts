import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import type { BlocksProduct } from '../../blocks/product';
import { type Reply, type SlowAgent, startAgent } from './agent';
import {
  type BankItem,
  CLI,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  PASS,
  say,
  show,
  word,
} from './kit';

/**
 * bg-campaign: cells, the worker pool, the budget, resume, smoke and the exit codes of `driftbench campaign` and
 * `driftbench smoke` (docs/running.md "Cells", "The worker pool", "The budget", "Exit codes", "driftbench smoke"). A
 * seeded agent behind a local endpoint answers the specs; it keeps the times and the order of the requests it got.
 */

const FAMILY = 'bg-campaign';
const D_CELLS = 'docs/running.md "Cells"';
const D_POOL = 'docs/running.md "The worker pool"';
const D_BUDGET = 'docs/running.md "The budget"';
const D_EXIT = 'docs/running.md "Exit codes"';
const D_SMOKE = 'docs/running.md "driftbench smoke"';

type SpecDef = {
  id: string;
  users: string[];
  codes: string[];
  version?: string;
  agent?: string;
  perturbations?: { id: string; user: string; at: number }[];
  worldOnly?: boolean;
  extra?: Record<string, unknown>;
};

export type World = {
  dir: string;
  specs: SpecDef[];
  files: string[];
  agent: SlowAgent;
  run(argv: string[]): Promise<{ code: number; out: string; err: string }>;
  rewrite(index: number, change: (def: SpecDef) => SpecDef): string;
  close(): Promise<void>;
};

export type WorldOptions = {
  specs: number;
  blocks?: number;
  perturbations?: number;
  usd?: number;
  delay?: (user: string, world: { specs: SpecDef[] }) => number;
  reply?: (user: string, def: SpecDef | undefined, index: number) => Reply;
  noTarget?: boolean;
};

async function world(ctx: ItemContext, tag: string, options: WorldOptions): Promise<World> {
  const dir = join(ctx.scratch, word(ctx.seed, `${tag}:dir`, 9));
  mkdirSync(dir, { recursive: true });
  const specs: SpecDef[] = Array.from({ length: options.specs }, (_, s) => ({
    id: `${word(ctx.seed, `${tag}:spec:${s}`, 7)}${String.fromCharCode(97 + s)}`,
    users: Array.from({ length: options.blocks ?? 1 }, (_, b) => word(ctx.seed, `${tag}:u:${s}:${b}`, 10)),
    codes: Array.from({ length: options.blocks ?? 1 }, (_, b) => word(ctx.seed, `${tag}:c:${s}:${b}`, 8)),
    perturbations: Array.from({ length: options.perturbations ?? 0 }, (_, p) => ({
      id: word(ctx.seed, `${tag}:p:${s}:${p}`, 6),
      user: word(ctx.seed, `${tag}:pu:${s}:${p}`, 10),
      at: 0,
    })),
  }));
  const find = (user: string) => {
    for (const [s, def] of specs.entries()) {
      const at = def.users.findIndex((each) => user.includes(each));
      if (at !== -1) return { def, index: s, at, injected: false };
      if (def.perturbations?.some((p) => user.includes(p.user)))
        return { def, index: s, at: -1, injected: true };
    }
    return undefined;
  };
  const agent = await startAgent(
    (user) => {
      const hit = find(user);
      if (options.reply) return options.reply(user, hit?.def, hit?.index ?? -1);
      if (!hit) throw new Error('no planted reply');
      return { text: hit.injected ? 'Understood.' : `Yes, ${hit.def.codes[hit.at]}.`, usd: options.usd ?? 0 };
    },
    (user) => options.delay?.(user, { specs }) ?? 0,
  );
  const files: string[] = [];
  const names: string[] = [];
  const writeSpec = (def: SpecDef, name: string) => {
    const raw = {
      id: def.id,
      ...(def.version ? { version: def.version } : {}),
      ...(options.noTarget
        ? {}
        : {
            target: {
              adapter: 'http',
              agent: def.agent ?? 'larkspur',
              options: { url: agent.url, tool_stubs: false, deterministic: true },
            },
          }),
      blocks: def.users.map((user, b) => ({
        id: `b${b}${word(ctx.seed, `${tag}:bid:${def.id}:${b}`, 4)}`,
        user,
        expect: { must: [def.codes[b]] },
      })),
      ...(def.perturbations?.length
        ? {
            perturbations: def.perturbations.map((p) =>
              def.worldOnly
                ? {
                    id: p.id,
                    class: 'D8_tool_failure',
                    inject_at: p.at,
                    world: { tools: { [word(ctx.seed, `${tag}:wt`, 6)]: { error: 'down' } } },
                  }
                : { id: p.id, class: 'D1_off_topic', inject_at: p.at, user: p.user },
            ),
          }
        : {}),
      ...(def.extra ?? {}),
    };
    const path = join(dir, name);
    writeFileSync(path, stringify(raw));
    return path;
  };
  specs.forEach((def, s) => {
    names.push(`${String(s).padStart(2, '0')}-${def.id}.yaml`);
    files.push(writeSpec(def, names[s] as string));
  });
  return {
    dir,
    specs,
    files,
    agent,
    run: (argv) => ctx.product.cli(argv, dir),
    rewrite: (index, change) => {
      const next = change(specs[index] as SpecDef);
      specs[index] = next;
      return writeSpec(next, names[index] as string);
    },
    close: () => agent.close(),
  };
}

export async function withWorld<T>(
  ctx: ItemContext,
  tag: string,
  options: WorldOptions,
  body: (w: World) => Promise<T>,
): Promise<T> {
  const w = await world(ctx, tag, options);
  try {
    return await body(w);
  } finally {
    await w.close();
  }
}

export type PlanCell = {
  id: string;
  spec: string;
  target: string;
  mode: string;
  repeat: number;
  perturbation?: string;
  blocks: number;
};

export function parsePlan(out: string): PlanCell[] {
  const cells: PlanCell[] = [];
  for (const line of out.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (!/^[0-9a-f]{16}$/.test(tokens[0] ?? '') || tokens.length < 6) continue;
    cells.push({
      id: tokens[0] as string,
      spec: tokens[1] as string,
      target: tokens[2] as string,
      mode: tokens[3] as string,
      repeat: Number(tokens[4]),
      ...(tokens.length >= 7 ? { perturbation: tokens[5] as string } : {}),
      blocks: Number(tokens[tokens.length - 1]),
    });
  }
  return cells;
}

export type RunLine = { spec: string; mode: string; repeat: number; perturbation?: string; state: string };

export function parseRun(out: string): RunLine[] {
  const lines: RunLine[] = [];
  for (const line of out.split('\n')) {
    const match = /^[✓✗!·-] (\S+) · (\S+) · ([TFP]) · repeat (\d+)(?: · (\S+))? {2}(\S+)/.exec(line);
    if (match)
      lines.push({
        spec: match[1] as string,
        mode: match[3] as string,
        repeat: Number(match[4]),
        ...(match[5] ? { perturbation: match[5] } : {}),
        state: match[6] as string,
      });
  }
  return lines;
}

export const summaryOf = (out: string) => ({
  stopped: Number(/(\d+) stopped by the budget/.exec(out)?.[1] ?? 0),
  reused: Number(/(\d+) reused/.exec(out)?.[1] ?? 0),
  spent: Number(/Spent \$(\d+(?:\.\d+)?)/.exec(out)?.[1] ?? Number.NaN),
  pass: Number(/(\d+) pass,/.exec(out)?.[1] ?? Number.NaN),
  header: /Campaign (\S+): (\d+) cells?, (\d+) at a time/.exec(out),
});

export const uniq = (values: string[]) => new Set(values).size;

function cellItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'CE1' | 'CE2' | 'CE3' | 'CE4',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.campaign.cell.${id}`, tier, CLI, cause, title, (ctx) =>
        check(ctx, `bg.campaign.cell.${id}`),
      ),
    );
  const plan = async (w: World, extra: string[] = [], files = w.files) => {
    const r = await w.run(['campaign', 'plan', ...files, ...extra]);
    return { r, cells: parsePlan(r.out) };
  };
  add(
    'ids-are-16-hex-and-distinct',
    3,
    'CE1',
    'a cell id is 16 hex characters and no two cells of a plan share one',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2, perturbations: 1 }, async (w) => {
        const { r, cells } = await plan(w, ['--mode', 'T,F,P', '--repeats', '2']);
        const want = 2 * (2 + 2 + 2);
        return expectAll([
          [r.code === 0, say(D_CELLS, 'plan exits 0', `${r.code}: ${r.err.slice(0, 160)}`)],
          [
            cells.length === want,
            say(D_CELLS, `${want} cells (2 specs x (T, F, one P) x 2 repeats)`, `${cells.length}`),
          ],
          [
            cells.every((cell) => /^[0-9a-f]{16}$/.test(cell.id)) &&
              uniq(cells.map((cell) => cell.id)) === cells.length,
            say(D_CELLS, '16 hex characters each, all distinct', show(cells.map((c) => c.id))),
          ],
        ]);
      }),
  );
  add(
    'run-id-is-the-cell-id',
    4,
    'CE2',
    'the run id of a cell is the cell id the plan printed',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 3 }, async (w) => {
        const { cells } = await plan(w, ['--repeats', '2']);
        const r = await w.run(['campaign', 'run', ...w.files, '--repeats', '2', '--json']);
        const text = r.out;
        const missing = cells.filter((cell) => !text.includes(`"${cell.id}"`));
        return cells.length === 6 && missing.length === 0
          ? PASS
          : fail(
              say(
                D_CELLS,
                'every planned cell id is the id of a cell run',
                `${missing.length} of ${cells.length} ids missing; exit ${r.code}`,
              ),
            );
      }),
  );
  add(
    'another-campaign-same-id',
    4,
    'CE2',
    'the campaign plays no part in a cell id: the same cell in two campaigns has one id',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2, perturbations: 1 }, async (w) => {
        const store = join(w.dir, 'store.db');
        const a = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--mode',
          'F,P',
          '--store',
          store,
          '--campaign',
          'c-one',
          '--json',
        ]);
        const b = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--mode',
          'F,P',
          '--store',
          store,
          '--campaign',
          'c-two',
          '--no-cache',
          '--json',
        ]);
        const ids = (text: string) => [...new Set(text.match(/"[0-9a-f]{16}"/g) ?? [])].sort();
        const planned = parsePlan((await w.run(['campaign', 'plan', ...w.files, '--mode', 'F,P'])).out)
          .map((cell) => `"${cell.id}"`)
          .sort();
        return expectAll([
          [planned.length === 4, say(D_CELLS, '4 planned cells', `${planned.length}`)],
          [
            planned.every((id) => ids(a.out).includes(id)),
            say(
              D_CELLS,
              'the first campaign runs the planned ids',
              `${a.code}: ${show(ids(a.out))} against ${show(planned)}`,
            ),
          ],
          [
            planned.every((id) => ids(b.out).includes(id)),
            say(D_CELLS, 'the second campaign has the same ids', `${b.code}: ${show(ids(b.out))}`),
          ],
        ]);
      }),
  );
  const changes: {
    id: string;
    change: (w: World) => Promise<{ before: PlanCell[]; after: PlanCell[] }>;
    differ: (b: PlanCell, a: PlanCell) => boolean;
  }[] = [
    {
      id: 'mode',
      change: async (w) => ({
        before: parsePlan((await w.run(['campaign', 'plan', ...w.files, '--mode', 'F'])).out),
        after: parsePlan((await w.run(['campaign', 'plan', ...w.files, '--mode', 'T'])).out),
      }),
      differ: (b, a) => b.id !== a.id,
    },
    {
      id: 'repeat',
      change: async (w) => ({
        before: parsePlan((await w.run(['campaign', 'plan', ...w.files, '--repeats', '2'])).out).filter(
          (c) => c.repeat === 0,
        ),
        after: parsePlan((await w.run(['campaign', 'plan', ...w.files, '--repeats', '2'])).out).filter(
          (c) => c.repeat === 1,
        ),
      }),
      differ: (b, a) => b.id !== a.id,
    },
  ];
  for (const each of changes)
    add(`differs-by-${each.id}`, 3, 'CE3', `the cell id changes with the ${each.id}`, async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2 }, async (w) => {
        const { before, after } = await each.change(w);
        return before.length === 2 &&
          after.length === 2 &&
          before.every((cell, i) => each.differ(cell, after[i] as PlanCell))
          ? PASS
          : fail(
              say(
                D_CELLS,
                `a cell has another id in another ${each.id}`,
                `${show(before.map((c) => c.id))} against ${show(after.map((c) => c.id))}`,
              ),
            );
      }),
    );
  add(
    'differs-by-spec-content',
    3,
    'CE3',
    'the cell id changes when the spec content changes',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2 }, async (w) => {
        const before = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
        w.rewrite(0, (def) => ({ ...def, users: [word(ctx.seed, `${tag}:new`, 10)] }));
        const after = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
        return before.length === 2 && after[0]?.id !== before[0]?.id && after[1]?.id === before[1]?.id
          ? PASS
          : fail(
              say(
                D_CELLS,
                'only the changed spec has another cell id',
                `${show(before.map((c) => c.id))} against ${show(after.map((c) => c.id))}`,
              ),
            );
      }),
  );
  add('differs-by-target', 3, 'CE3', 'the cell id changes with the target', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 2 }, async (w) => {
      const before = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
      w.rewrite(0, (def) => ({ ...def, agent: word(ctx.seed, `${tag}:agent`, 7) }));
      const after = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
      return before.length === 2 && after[0]?.id !== before[0]?.id && after[1]?.id === before[1]?.id
        ? PASS
        : fail(
            say(
              D_CELLS,
              'only the spec on another target has another cell id',
              `${show(before.map((c) => c.id))} against ${show(after.map((c) => c.id))}`,
            ),
          );
    }),
  );
  add(
    'differs-by-perturbation',
    3,
    'CE3',
    'two P cells of one spec and repeat have two ids, one per perturbation',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1, perturbations: 2 }, async (w) => {
        const cells = parsePlan((await w.run(['campaign', 'plan', ...w.files, '--mode', 'P'])).out);
        return cells.length === 2 && cells[0]?.id !== cells[1]?.id && cells.every((c) => c.perturbation)
          ? PASS
          : fail(say(D_CELLS, 'two P cells with two ids', show(cells)));
      }),
  );
  add(
    'version-label-plays-no-part',
    3,
    'CE4',
    'the spec version label is no part of the cell id',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2 }, async (w) => {
        const before = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
        w.rewrite(0, (def) => ({ ...def, version: word(ctx.seed, `${tag}:version`, 6) }));
        const after = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
        return before.length === 2 && before.every((cell, i) => cell.id === after[i]?.id)
          ? PASS
          : fail(
              say(
                D_CELLS,
                'the same ids after a version label change',
                `${show(before.map((c) => c.id))} against ${show(after.map((c) => c.id))}`,
              ),
            );
      }),
  );
  for (const [id, how] of [
    ['version-added', 'added'],
    ['version-removed', 'removed'],
    ['version-changed-twice', 'changed'],
  ] as const)
    add(`${id}`, 3, 'CE4', `the spec version label is no part of the cell id (${how})`, async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2 }, async (w) => {
        if (how === 'removed')
          w.rewrite(0, (def) => ({ ...def, version: word(ctx.seed, `${tag}:first`, 6) }));
        const before = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
        w.rewrite(0, (def) => {
          const next = { ...def };
          if (how === 'removed') delete next.version;
          else next.version = word(ctx.seed, `${tag}:version`, 6);
          return next;
        });
        if (how === 'changed')
          w.rewrite(0, (def) => ({ ...def, version: word(ctx.seed, `${tag}:again`, 6) }));
        const after = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
        return before.length === 2 && before.every((cell, i) => cell.id === after[i]?.id)
          ? PASS
          : fail(
              say(
                D_CELLS,
                `the same ids after the version label is ${how}`,
                `${show(before.map((c) => c.id))} against ${show(after.map((c) => c.id))}`,
              ),
            );
      }),
    );
  add(
    'p-cell-per-perturbation-and-repeat',
    3,
    'CE1',
    'in mode P a spec gives one cell per perturbation and repeat; a mode T or F gives one per repeat',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2, perturbations: 3 }, async (w) => {
        const cells = parsePlan(
          (await w.run(['campaign', 'plan', ...w.files, '--mode', 'T,F,P', '--repeats', '2'])).out,
        );
        const count = (mode: string) => cells.filter((c) => c.mode === mode).length;
        return count('T') === 4 && count('F') === 4 && count('P') === 2 * 3 * 2
          ? PASS
          : fail(say(D_CELLS, 'T 4, F 4, P 12', `T ${count('T')}, F ${count('F')}, P ${count('P')}`));
      }),
  );
  add(
    'p-cell-sends-the-injected-block',
    3,
    'CE1',
    'a P cell with a user perturbation has one block more than its spec',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1, blocks: 3, perturbations: 1 }, async (w) => {
        const cells = parsePlan((await w.run(['campaign', 'plan', ...w.files, '--mode', 'F,P'])).out);
        return cells.map((c) => `${c.mode}${c.blocks}`).join() === 'F3,P4'
          ? PASS
          : fail(say(D_CELLS, 'F 3 blocks, P 4 blocks', show(cells.map((c) => `${c.mode}${c.blocks}`))));
      }),
  );
  return out;
}

function poolItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'CP1' | 'CP2' | 'CP3' | 'CP4',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.campaign.pool.${id}`, tier, CLI, cause, title, (ctx) =>
        check(ctx, `bg.campaign.pool.${id}`),
      ),
    );
  for (const [id, specs, flags, want] of [
    ['default-is-four-at-a-time', 8, [], 4],
    ['concurrency-one-is-serial', 4, ['--concurrency', '1'], 1],
    ['concurrency-two', 6, ['--concurrency', '2'], 2],
    ['concurrency-three', 7, ['--concurrency', '3'], 3],
  ] as [string, number, string[], number][])
    add(
      id,
      3,
      'CP1',
      `the pool runs ${want} cells at a time ${flags.length ? `with ${flags.join(' ')}` : 'by default'}`,
      async (ctx, tag) =>
        withWorld(ctx, tag, { specs, delay: () => 120 }, async (w) => {
          const r = await w.run(['campaign', 'run', ...w.files, ...flags]);
          const header = summaryOf(r.out).header;
          return expectAll([
            [
              w.agent.maxInFlight() === want,
              say(
                D_POOL,
                `${want} requests in flight at most, and ${want} at the peak`,
                `${w.agent.maxInFlight()}; exit ${r.code} ${r.err.slice(0, 100)}`,
              ),
            ],
            [
              header?.[3] === String(want),
              say(D_POOL, `the header says ${want} at a time`, `${header?.[0]}`),
            ],
            [
              parseRun(r.out).length === specs,
              say(D_POOL, `${specs} cell lines`, `${parseRun(r.out).length}`),
            ],
          ]);
        }),
    );
  add(
    'never-more-than-the-cells',
    3,
    'CP1',
    'the pool is never larger than the number of cells',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2, delay: () => 100 }, async (w) => {
        const r = await w.run(['campaign', 'run', ...w.files, '--concurrency', '8']);
        return w.agent.maxInFlight() === 2 && parseRun(r.out).length === 2
          ? PASS
          : fail(
              say(
                D_POOL,
                'two cells run at most two at a time',
                `peak ${w.agent.maxInFlight()}; ${summaryOf(r.out).header?.[0]}`,
              ),
            );
      }),
  );
  add(
    'lines-come-in-cell-order',
    4,
    'CP3',
    'the cell lines print in cell order even when a later cell finishes first',
    async (ctx, tag) =>
      withWorld(
        ctx,
        tag,
        { specs: 4, delay: (user, w) => (w.specs[0]?.users.some((u) => user.includes(u)) ? 400 : 20) },
        async (w) => {
          const r = await w.run(['campaign', 'run', ...w.files, '--concurrency', '4']);
          const order = parseRun(r.out).map((line) => line.spec);
          const want = w.specs.map((s) => s.id);
          const first = w.agent.requests.findIndex((req) =>
            w.specs[0]?.users.some((u) => req.user.includes(u)),
          );
          return order.join() === want.join() && first === 0
            ? PASS
            : fail(
                say(
                  D_POOL,
                  'cell lines in the order of the cells although the first cell ends last',
                  `${show(order)} against ${show(want)}`,
                ),
              );
        },
      ),
  );
  add(
    'lines-come-in-cell-order-with-the-last-cell-first-to-end',
    4,
    'CP3',
    'a cell line waits for every cell before it',
    async (ctx, tag) =>
      withWorld(
        ctx,
        tag,
        { specs: 3, delay: (user, w) => (w.specs[2]?.users.some((u) => user.includes(u)) ? 5 : 250) },
        async (w) => {
          const r = await w.run(['campaign', 'run', ...w.files, '--concurrency', '3']);
          const order = parseRun(r.out).map((line) => line.spec);
          return order.join() === w.specs.map((s) => s.id).join()
            ? PASS
            : fail(say(D_POOL, 'cell order', show(order)));
        },
      ),
  );
  add(
    't-and-f-cells-before-p-cells',
    4,
    'CP2',
    'the T and F cells start first, in cell order, and the P cells after them',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2, blocks: 2, perturbations: 1 }, async (w) => {
        const r = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--mode',
          'T,F,P',
          '--concurrency',
          '1',
          '--no-cache',
        ]);
        const injected = new Set(w.specs.flatMap((s) => s.perturbations?.map((p) => p.user) ?? []));
        const reqs = w.agent.requests.map((req) => [...injected].some((u) => req.user.includes(u)));
        const firstP = reqs.indexOf(true);
        // 2 specs x (T: 2 blocks, F: 2 blocks) = 8 requests before any P cell begins.
        return firstP === 8 && r.code === 0
          ? PASS
          : fail(
              say(
                D_POOL,
                'the first P request is the 9th request: 8 T and F requests come first',
                `first P request at ${firstP} of ${reqs.length}; exit ${r.code}`,
              ),
            );
      }),
  );
  add(
    'p-cell-waits-for-its-f-run',
    4,
    'CP4',
    'a P cell does not start before the F run it takes as its reference has ended',
    async (ctx, tag) =>
      withWorld(
        ctx,
        tag,
        {
          specs: 1,
          blocks: 2,
          perturbations: 1,
          delay: (user, w) => (w.specs[0]?.users.some((u) => user.includes(u)) ? 200 : 5),
        },
        async (w) => {
          await w.run(['campaign', 'run', ...w.files, '--mode', 'F,P', '--concurrency', '4', '--no-cache']);
          const inj = w.specs[0]?.perturbations?.[0]?.user as string;
          const p = w.agent.requests.find((req) => req.user.includes(inj));
          const fEnd = Math.max(
            ...w.agent.requests
              .filter((req) => !req.user.includes(inj) && w.specs[0]?.users.some((u) => req.user.includes(u)))
              .slice(0, 2)
              .map((req) => req.endedAt),
          );
          return p && p.startedAt >= fEnd - 1
            ? PASS
            : fail(
                say(
                  D_POOL,
                  'the first request of the P cell begins after the F run ends',
                  `P starts at ${p?.startedAt}, the F run ends at ${fEnd}`,
                ),
              );
        },
      ),
  );
  return out;
}

function budgetItems(): BankItem[] {
  const out: BankItem[] = [];
  const cases: {
    id: string;
    specs: number;
    flags: string[];
    ran: number;
    usd: number;
    spent: number;
    tier: 3 | 4;
  }[] = [
    {
      id: 'stops-once-the-spend-passes',
      specs: 6,
      flags: ['--concurrency', '1', '--budget-usd', '2.5'],
      ran: 3,
      usd: 1,
      spent: 3,
      tier: 3,
    },
    {
      id: 'stops-once-the-spend-reaches',
      specs: 6,
      flags: ['--concurrency', '1', '--budget-usd', '2'],
      ran: 2,
      usd: 1,
      spent: 2,
      tier: 4,
    },
    {
      id: 'roomy-budget-runs-everything',
      specs: 5,
      flags: ['--concurrency', '1', '--budget-usd', '100'],
      ran: 5,
      usd: 1,
      spent: 5,
      tier: 3,
    },
    {
      id: 'budget-zero-starts-nothing',
      specs: 3,
      flags: ['--concurrency', '1', '--budget-usd', '0'],
      ran: 0,
      usd: 1,
      spent: 0,
      tier: 3,
    },
    {
      id: 'cells-in-flight-finish',
      specs: 6,
      flags: ['--concurrency', '2', '--budget-usd', '0.5'],
      ran: 2,
      usd: 1,
      spent: 2,
      tier: 4,
    },
    {
      id: 'different-price',
      specs: 8,
      flags: ['--concurrency', '1', '--budget-usd', '0.7'],
      ran: 2,
      usd: 0.4,
      spent: 0.8,
      tier: 4,
    },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.campaign.budget.${each.id}`,
        each.tier,
        CLI,
        'CB1',
        `a hard stop on the spend: ${each.id.replace(/-/g, ' ')}`,
        async (ctx) =>
          withWorld(
            ctx,
            `bg.campaign.budget.${each.id}`,
            { specs: each.specs, usd: each.usd, delay: () => 30 },
            async (w) => {
              const r = await w.run(['campaign', 'run', ...w.files, ...each.flags]);
              const lines = parseRun(r.out);
              const sum = summaryOf(r.out);
              const stopped = lines.filter((line) => line.state === 'stopped').length;
              return expectAll([
                [
                  lines.length === each.specs,
                  say(D_BUDGET, `${each.specs} cell lines`, `${lines.length}: ${r.err.slice(0, 120)}`),
                ],
                [
                  stopped === each.specs - each.ran && sum.stopped === stopped,
                  say(
                    D_BUDGET,
                    `${each.specs - each.ran} cells stopped by the budget and counted in the summary`,
                    `${stopped} stopped lines, summary ${sum.stopped}`,
                  ),
                ],
                [
                  w.agent.requests.length === each.ran,
                  say(D_BUDGET, `${each.ran} cells reach the agent`, `${w.agent.requests.length} requests`),
                ],
                [
                  Math.abs(sum.spent - each.spent) < 0.011,
                  say(D_BUDGET, `spent $${each.spent.toFixed(2)}`, `$${sum.spent}`),
                ],
                [
                  r.code === (each.ran === each.specs ? 0 : 1),
                  say(D_EXIT, `exit ${each.ran === each.specs ? 0 : 1}`, `${r.code}`),
                ],
              ]);
            },
          ),
      ),
    );
  out.push(
    gitem(
      FAMILY,
      'bg.campaign.budget.a-cache-replay-costs-nothing',
      4,
      CLI,
      'CB2',
      'a run replayed from the cache costs nothing against the budget',
      async (ctx) =>
        withWorld(
          ctx,
          'bg.campaign.budget.a-cache-replay-costs-nothing',
          { specs: 4, usd: 1, delay: () => 20 },
          async (w) => {
            const store = join(w.dir, 'store.db');
            const first = await w.run([
              'campaign',
              'run',
              ...w.files,
              '--concurrency',
              '1',
              '--store',
              store,
              '--campaign',
              'c-first',
            ]);
            const asked = w.agent.requests.length;
            const second = await w.run([
              'campaign',
              'run',
              ...w.files,
              '--concurrency',
              '1',
              '--store',
              store,
              '--campaign',
              'c-second',
              '--budget-usd',
              '0.5',
            ]);
            const lines = parseRun(second.out);
            return expectAll([
              [
                first.code === 0 && asked === 4,
                say(D_BUDGET, 'the first campaign runs 4 cells', `exit ${first.code}, ${asked} requests`),
              ],
              [
                w.agent.requests.length === 4 &&
                  lines.every((line) => line.state === 'pass') &&
                  lines.length === 4,
                say(
                  D_BUDGET,
                  'the second campaign replays every cell from the cache under a budget of $0.50',
                  `${show(lines.map((l) => l.state))}, ${w.agent.requests.length} requests`,
                ),
              ],
              [
                Math.abs(summaryOf(second.out).spent) < 0.001,
                say(D_BUDGET, 'spent $0.00', `$${summaryOf(second.out).spent}`),
              ],
            ]);
          },
        ),
    ),
    gitem(
      FAMILY,
      'bg.campaign.budget.without-the-cache-it-is-spent-again',
      4,
      CLI,
      'CB2',
      'with the cache off, the same cells cost again and the budget stops them',
      async (ctx) =>
        withWorld(
          ctx,
          'bg.campaign.budget.without-the-cache-it-is-spent-again',
          { specs: 4, usd: 1, delay: () => 20 },
          async (w) => {
            const store = join(w.dir, 'store.db');
            await w.run([
              'campaign',
              'run',
              ...w.files,
              '--concurrency',
              '1',
              '--store',
              store,
              '--campaign',
              'c-first',
            ]);
            const second = await w.run([
              'campaign',
              'run',
              ...w.files,
              '--concurrency',
              '1',
              '--store',
              store,
              '--campaign',
              'c-second',
              '--no-cache',
              '--budget-usd',
              '1.5',
            ]);
            return summaryOf(second.out).stopped === 2 && w.agent.requests.length === 4 + 2
              ? PASS
              : fail(
                  say(
                    D_BUDGET,
                    '2 cells run and 2 are stopped',
                    `${summaryOf(second.out).stopped} stopped; ${w.agent.requests.length} requests`,
                  ),
                );
          },
        ),
    ),
  );
  return out;
}

function resumeItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (id: string, check: (ctx: ItemContext, tag: string) => Promise<ItemResult>) =>
    out.push(
      gitem(
        FAMILY,
        `bg.campaign.resume.${id}`,
        4,
        CLI,
        'CR1',
        'campaign resume runs the cells that have no completed run and reuses the others',
        (ctx) => check(ctx, `bg.campaign.resume.${id}`),
      ),
    );
  add('stopped-cells-run-again-with-a-new-budget', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 4, usd: 1, delay: () => 20 }, async (w) => {
      const store = join(w.dir, 'store.db');
      const first = await w.run([
        'campaign',
        'run',
        ...w.files,
        '--concurrency',
        '1',
        '--store',
        store,
        '--campaign',
        'c-one',
        '--budget-usd',
        '1.5',
      ]);
      const asked = w.agent.requests.length;
      const resumed = await w.run([
        'campaign',
        'resume',
        'c-one',
        '--store',
        store,
        '--concurrency',
        '1',
        '--budget-usd',
        '100',
      ]);
      const sum = summaryOf(resumed.out);
      return expectAll([
        [
          first.code === 1 && asked === 2,
          say(D_BUDGET, 'the first run stops 2 of 4 cells', `exit ${first.code}, ${asked} requests`),
        ],
        [
          resumed.code === 0 && sum.reused === 2 && sum.pass === 4,
          say(
            'docs/running.md "driftbench campaign resume"',
            '4 pass, 2 reused',
            `exit ${resumed.code}: ${resumed.out.split('\n').slice(-3).join(' | ')}`,
          ),
        ],
        [
          w.agent.requests.length === 4,
          say(
            'docs/running.md "driftbench campaign resume"',
            'only the 2 stopped cells reach the agent',
            `${w.agent.requests.length} requests`,
          ),
        ],
      ]);
    }),
  );
  add('without-a-budget-it-keeps-the-stored-one', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 4, usd: 1, delay: () => 20 }, async (w) => {
      const store = join(w.dir, 'store.db');
      await w.run([
        'campaign',
        'run',
        ...w.files,
        '--concurrency',
        '1',
        '--store',
        store,
        '--campaign',
        'c-one',
        '--budget-usd',
        '1.5',
      ]);
      const resumed = await w.run(['campaign', 'resume', 'c-one', '--store', store, '--concurrency', '1']);
      return resumed.code === 1 && w.agent.requests.length === 2 && summaryOf(resumed.out).stopped === 2
        ? PASS
        : fail(
            say(
              'docs/running.md "driftbench campaign resume"',
              'without --budget-usd, resume keeps the budget the campaign was run with: the 2 cells stay stopped',
              `exit ${resumed.code}; ${w.agent.requests.length} requests; ${summaryOf(resumed.out).stopped} stopped`,
            ),
          );
    }),
  );
  add('a-campaign-with-no-budget-resumes-without-one', async (ctx, tag) => {
    let calls = 0;
    return withWorld(
      ctx,
      tag,
      {
        specs: 3,
        usd: 1,
        reply: (_user, def, index) => {
          if (index === 1) {
            calls += 1;
            if (calls === 1) throw new Error('planted failure');
          }
          return { text: `Yes, ${def?.codes[0]}.`, usd: 1 };
        },
      },
      async (w) => {
        const store = join(w.dir, 'store.db');
        const first = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--concurrency',
          '1',
          '--store',
          store,
          '--campaign',
          'c-one',
        ]);
        const resumed = await w.run(['campaign', 'resume', 'c-one', '--store', store, '--concurrency', '1']);
        return first.code === 1 &&
          resumed.code === 0 &&
          summaryOf(resumed.out).stopped === 0 &&
          summaryOf(resumed.out).pass === 3
          ? PASS
          : fail(
              say(
                D_BUDGET,
                'a campaign run with no budget stores 0 and resume reads 0 as no budget: the failed cell runs again and passes',
                `first exit ${first.code}; resume exit ${resumed.code}: ${resumed.out.split('\n').slice(-2).join(' | ')}`,
              ),
            );
      },
    );
  });
  return out;
}

function exitItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'CX1' | 'CX2' | 'CX3',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.campaign.exit.${id}`, tier, CLI, cause, title, (ctx) =>
        check(ctx, `bg.campaign.exit.${id}`),
      ),
    );
  const code = (r: { code: number }, want: number, what: string) =>
    r.code === want ? null : say(D_EXIT, `${what} exits ${want}`, `${r.code}`);
  const first = (problems: (string | null)[]): ItemResult => {
    const found = problems.find((p) => p !== null);
    return found ? fail(found) : PASS;
  };
  add(
    'plan-unknown-mode',
    3,
    'CX1',
    'campaign plan with an unknown mode exits 2 and names the three modes',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1 }, async (w) => {
        const mode = word(ctx.seed, `${tag}:mode`, 3).toUpperCase();
        const r = await w.run(['campaign', 'plan', ...w.files, '--mode', mode]);
        return first([
          code(r, 2, 'an unknown mode'),
          `${r.out}${r.err}`.includes(
            `Unknown mode "${mode}". The modes are T, F and P, alone or separated by commas.`,
          )
            ? null
            : say(D_EXIT, 'the message names the mode and the three modes', `${r.out}${r.err}`.slice(0, 200)),
        ]);
      }),
  );
  add(
    'run-unknown-mode',
    3,
    'CX1',
    'campaign run with an unknown mode exits 2 and runs nothing',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1 }, async (w) => {
        const r = await w.run(['campaign', 'run', ...w.files, '--mode', 'F,Q']);
        return first([
          code(r, 2, 'an unknown mode'),
          w.agent.requests.length === 0 ? null : say(D_EXIT, 'no request', `${w.agent.requests.length}`),
        ]);
      }),
  );
  add(
    'run-existing-campaign-id',
    4,
    'CX1',
    'campaign run with a campaign id the store already holds exits 2',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1 }, async (w) => {
        const store = join(w.dir, 'store.db');
        const a = await w.run(['campaign', 'run', ...w.files, '--store', store, '--campaign', 'c-same']);
        const b = await w.run(['campaign', 'run', ...w.files, '--store', store, '--campaign', 'c-same']);
        return first([code(a, 0, 'the first run'), code(b, 2, 'a run under an existing campaign id')]);
      }),
  );
  add(
    'run-spec-without-target',
    3,
    'CX1',
    'a spec with no target and no --target exits 2',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1, noTarget: true }, async (w) => {
        const r = await w.run(['campaign', 'run', ...w.files]);
        const p = await w.run(['campaign', 'plan', ...w.files]);
        return first([
          code(r, 2, 'run on a spec with no target'),
          code(p, 2, 'plan on a spec with no target'),
        ]);
      }),
  );
  add('run-unknown-target', 3, 'CX1', 'a target no adapter is set up for exits 2', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 1 }, async (w) => {
      const r = await w.run([
        'campaign',
        'run',
        ...w.files,
        '--target',
        `${word(ctx.seed, `${tag}:adapter`, 7)}:${word(ctx.seed, `${tag}:agent`, 5)}`,
      ]);
      return first([
        code(r, 2, 'an unknown target'),
        w.agent.requests.length === 0 ? null : say(D_EXIT, 'no request', `${w.agent.requests.length}`),
      ]);
    }),
  );
  add('run-invalid-spec', 3, 'CX1', 'a spec with an unknown key exits 2', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 1, blocks: 1 }, async (w) => {
      w.rewrite(0, (def) => ({ ...def, extra: { [word(ctx.seed, `${tag}:key`, 7)]: 1 } }));
      const r = await w.run(['campaign', 'run', ...w.files]);
      return first([
        code(r, 2, 'an invalid spec'),
        w.agent.requests.length === 0 ? null : say(D_EXIT, 'no request', `${w.agent.requests.length}`),
      ]);
    }),
  );
  add('run-no-spec-found', 3, 'CX1', 'a folder with no spec exits 2', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 1 }, async (w) => {
      const empty = join(w.dir, word(ctx.seed, `${tag}:empty`, 6));
      mkdirSync(empty, { recursive: true });
      const r = await w.run(['campaign', 'run', empty]);
      return code(r, 2, 'a folder with no spec') ? fail(code(r, 2, 'a folder with no spec') as string) : PASS;
    }),
  );
  for (const [flag, value] of [
    ['--repeats', '0'],
    ['--repeats', 'many'],
    ['--concurrency', '0'],
    ['--budget-usd', 'plenty'],
  ] as [string, string][])
    add(
      `run-bad-number-${flag.slice(2)}-${value}`,
      3,
      'CX1',
      `${flag} ${value} is a bad number and exits 2`,
      async (ctx, tag) =>
        withWorld(ctx, tag, { specs: 1 }, async (w) => {
          const r = await w.run(['campaign', 'run', ...w.files, flag, value]);
          return first([
            code(r, 2, `${flag} ${value}`),
            w.agent.requests.length === 0 ? null : say(D_EXIT, 'no request', `${w.agent.requests.length}`),
          ]);
        }),
    );
  add('route-needs-a-target', 4, 'CX1', '--route without --target exits 2', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 1 }, async (w) => {
      const r = await w.run([
        'campaign',
        'run',
        ...w.files,
        '--route',
        `${word(ctx.seed, `${tag}:tag`, 5)}=http:other`,
      ]);
      return code(r, 2, '--route without --target')
        ? fail(code(r, 2, '--route without --target') as string)
        : PASS;
    }),
  );
  add(
    'status-passes-fails-and-unknown',
    4,
    'CX2',
    'campaign status exits 0 when every cell passes, 1 for any other state and 2 for an unknown campaign',
    async (ctx, tag) =>
      withWorld(
        ctx,
        tag,
        {
          specs: 2,
          reply: (_user, def, index) => ({ text: index === 1 ? 'No.' : `Yes, ${def?.codes[0]}.` }),
        },
        async (w) => {
          const good = join(w.dir, 'good.db');
          const bad = join(w.dir, 'bad.db');
          await w.run(['campaign', 'run', w.files[0] as string, '--store', good, '--campaign', 'c-good']);
          await w.run(['campaign', 'run', ...w.files, '--store', bad, '--campaign', 'c-bad']);
          const a = await w.run(['campaign', 'status', 'c-good', '--store', good]);
          const b = await w.run(['campaign', 'status', 'c-bad', '--store', bad]);
          const c = await w.run(['campaign', 'status', word(ctx.seed, `${tag}:unknown`, 8), '--store', good]);
          return first([
            code(a, 0, 'status of a campaign that passes'),
            code(b, 1, 'status of a campaign with a failing cell'),
            code(c, 2, 'status of an unknown campaign'),
          ]);
        },
      ),
  );
  add(
    'status-store-with-no-campaign',
    3,
    'CX2',
    'campaign status on a store that holds no campaign exits 2',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1 }, async (w) => {
        const r = await w.run(['campaign', 'status', '--store', join(w.dir, 'empty.db')]);
        return code(r, 2, 'status on a store with no campaign')
          ? fail(code(r, 2, 'status on a store with no campaign') as string)
          : PASS;
      }),
  );
  add('status-without-a-store', 3, 'CX2', 'campaign status without --store exits 2', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 1 }, async (w) => {
      const r = await w.run(['campaign', 'status']);
      return code(r, 2, 'status without a store')
        ? fail(code(r, 2, 'status without a store') as string)
        : PASS;
    }),
  );
  add('smoke-takes-exactly-one-spec', 3, 'CX3', 'smoke with two specs exits 2', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 2 }, async (w) => {
      const r = await w.run(['smoke', ...w.files]);
      return first([
        code(r, 2, 'smoke on two specs'),
        w.agent.requests.length === 0 ? null : say(D_EXIT, 'no request', `${w.agent.requests.length}`),
      ]);
    }),
  );
  add(
    'smoke-needs-two-runs',
    3,
    'CX3',
    'smoke --runs 1 exits 2: at least 2 runs are compared',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1 }, async (w) => {
        const r = await w.run(['smoke', w.files[0] as string, '--runs', '1']);
        return first([
          code(r, 2, 'smoke --runs 1'),
          w.agent.requests.length === 0 ? null : say(D_EXIT, 'no request', `${w.agent.requests.length}`),
        ]);
      }),
  );
  return out;
}

function smokeItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.campaign.smoke.${id}`, tier, CLI, 'CS1', title, (ctx) =>
        check(ctx, `bg.campaign.smoke.${id}`),
      ),
    );
  type Json = {
    identical?: boolean;
    hashes?: string[];
    runs?: number | unknown[];
    firstDifference?: unknown;
  };
  const json = (out: string): Json => {
    try {
      return JSON.parse(out) as Json;
    } catch {
      return {};
    }
  };
  add(
    'three-runs-with-the-cache-off',
    3,
    'smoke runs a spec 3 times by default, with the cache off, and reports identical transcripts',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1, blocks: 2 }, async (w) => {
        const r = await w.run(['smoke', w.files[0] as string]);
        return expectAll([
          [r.code === 0, say(D_SMOKE, 'identical transcripts exit 0', `${r.code}: ${r.err.slice(0, 150)}`)],
          [
            w.agent.requests.length === 6,
            say(
              D_SMOKE,
              '3 runs x 2 blocks reach the agent: the cache is off',
              `${w.agent.requests.length} requests`,
            ),
          ],
          [
            /3 runs/.test(r.out) && /identical/.test(r.out),
            say(D_SMOKE, 'the report says 3 runs and identical transcripts', r.out.slice(0, 200)),
          ],
        ]);
      }),
  );
  for (const runs of [2, 5])
    add(`runs-${runs}`, 3, `smoke --runs ${runs} compares ${runs} runs`, async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1, blocks: 3 }, async (w) => {
        const r = await w.run(['smoke', w.files[0] as string, '--runs', String(runs), '--json']);
        const doc = json(r.out);
        return expectAll([
          [
            w.agent.requests.length === runs * 3,
            say(D_SMOKE, `${runs} x 3 requests`, `${w.agent.requests.length}`),
          ],
          [
            (Array.isArray(doc.runs) ? doc.runs.length : doc.runs) === runs &&
              doc.hashes?.length === runs &&
              doc.identical === true &&
              uniq(doc.hashes ?? []) === 1,
            say(D_SMOKE, `${runs} runs, ${runs} equal hashes, identical`, r.out.slice(0, 220)),
          ],
        ]);
      }),
    );
  add(
    'cost-and-latency-vary-the-transcript-does-not',
    4,
    'a transcript leaves out what may vary between identical runs: cost and latency',
    async (ctx, tag) => {
      let n = 0;
      return withWorld(
        ctx,
        tag,
        {
          specs: 1,
          blocks: 2,
          reply: (user, def) => {
            n += 1;
            return {
              text: `Yes, ${def?.codes[def.users.findIndex((u) => user.includes(u))]}.`,
              usd: n / 100,
              latencyMs: n * 7,
            };
          },
        },
        async (w) => {
          const r = await w.run(['smoke', w.files[0] as string, '--json']);
          const doc = json(r.out);
          return doc.identical === true && r.code === 0
            ? PASS
            : fail(
                say(
                  D_SMOKE,
                  'the same replies at other costs and latencies read identical',
                  r.out.slice(0, 220),
                ),
              );
        },
      );
    },
  );
  for (const [id, at] of [
    ['third-run-differs', 2],
    ['second-run-differs', 1],
  ] as [string, number][])
    add(
      id,
      4,
      `smoke compares every run with the first: the run ${at + 1} that differs makes the command exit 1 and the hashes say which`,
      async (ctx, tag) => {
        const seen = new Map<string, number>();
        return withWorld(
          ctx,
          tag,
          {
            specs: 1,
            blocks: 2,
            reply: (user, def) => {
              const b = def?.users.findIndex((u) => user.includes(u)) ?? 0;
              const run = Math.floor((seen.get('n') ?? 0) / 2);
              seen.set('n', (seen.get('n') ?? 0) + 1);
              return { text: `Yes, ${def?.codes[b]}.${run === at && b === 1 ? ' Also this.' : ''}` };
            },
          },
          async (w) => {
            const r = await w.run(['smoke', w.files[0] as string, '--json']);
            const doc = json(r.out);
            const hashes = doc.hashes ?? [];
            const others = hashes.filter((_, i) => i !== at);
            return expectAll([
              [r.code === 1, say(D_SMOKE, 'differing transcripts exit 1', `${r.code}`)],
              [
                doc.identical === false && hashes.length === 3,
                say(D_SMOKE, 'identical false and three hashes', r.out.slice(0, 220)),
              ],
              [
                uniq(others) === 1 && hashes[at] !== others[0],
                say(D_SMOKE, `only run ${at + 1} has another hash`, show(hashes)),
              ],
              [
                doc.firstDifference !== undefined &&
                  [at, at + 1].includes((doc.firstDifference as { run?: number }).run ?? -1) &&
                  (doc.firstDifference as { block?: number }).block === 1,
                say(
                  D_SMOKE,
                  `firstDifference names run ${at + 1} (or ${at} counted from 0) and block 1`,
                  JSON.stringify(doc.firstDifference),
                ),
              ],
            ]);
          },
        );
      },
    );
  return out;
}

function configItems(): BankItem[] {
  const out: BankItem[] = [];
  const D_CFG = 'docs/running.md "The campaign key"';
  const add = (
    id: string,
    tier: 3 | 4,
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.campaign.config.${id}`, tier, CLI, 'CF1', title, (ctx) =>
        check(ctx, `bg.campaign.config.${id}`),
      ),
    );
  const yaml = (w: World, body: Record<string, unknown>) =>
    writeFileSync(join(w.dir, 'driftbench.yaml'), stringify(body));
  add(
    'file-sets-repeats',
    3,
    'a campaign: setting of driftbench.yaml applies where no flag is given',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2 }, async (w) => {
        yaml(w, { campaign: { repeats: 3 } });
        const cells = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
        return cells.length === 6
          ? PASS
          : fail(say(D_CFG, '2 specs x 3 repeats = 6 cells', `${cells.length}`));
      }),
  );
  add('flag-wins-over-the-file', 3, 'a flag given on the command line wins over the file', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 2 }, async (w) => {
      yaml(w, { campaign: { repeats: 3 } });
      const cells = parsePlan((await w.run(['campaign', 'plan', ...w.files, '--repeats', '1'])).out);
      return cells.length === 2 ? PASS : fail(say(D_CFG, '--repeats 1 wins: 2 cells', `${cells.length}`));
    }),
  );
  add(
    'file-sets-modes',
    3,
    'the modes of the file apply where no --mode is given, and a flag replaces them',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2 }, async (w) => {
        yaml(w, { campaign: { modes: ['T', 'F'] } });
        const fromFile = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
        const flagged = parsePlan((await w.run(['campaign', 'plan', ...w.files, '--mode', 'F'])).out);
        return fromFile.length === 4 && flagged.length === 2 && flagged.every((c) => c.mode === 'F')
          ? PASS
          : fail(
              say(
                D_CFG,
                'file: 4 cells (T and F); --mode F: 2 cells',
                `${fromFile.length} and ${flagged.length}`,
              ),
            );
      }),
  );
  add('no-campaign-key-changes-nothing', 3, 'a file with no campaign key changes nothing', async (ctx, tag) =>
    withWorld(ctx, tag, { specs: 2 }, async (w) => {
      const before = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
      yaml(w, { aggregates: ['pass-rate:>=0.5'] });
      const after = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
      return before.length === 2 && JSON.stringify(before) === JSON.stringify(after)
        ? PASS
        : fail(say(D_CFG, 'the same plan', `${before.length} then ${after.length} cells`));
    }),
  );
  add(
    'unknown-setting-exits-2',
    4,
    'a campaign: setting the file does not know exits 2 and names it',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1 }, async (w) => {
        const key = word(ctx.seed, `${tag}:key`, 7);
        yaml(w, { campaign: { [key]: 1 } });
        const r = await w.run(['campaign', 'plan', ...w.files]);
        return r.code === 2 && `${r.out}${r.err}`.includes(key)
          ? PASS
          : fail(say(D_CFG, `exit 2 naming ${key}`, `${r.code}: ${`${r.out}${r.err}`.slice(0, 200)}`));
      }),
  );
  add(
    'bad-value-exits-2-and-names-the-setting',
    4,
    'a campaign: value that does not fit exits 2 and names driftbench.yaml: campaign.repeats',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1 }, async (w) => {
        yaml(w, { campaign: { repeats: 0 } });
        const r = await w.run(['campaign', 'plan', ...w.files]);
        return r.code === 2 && `${r.out}${r.err}`.includes('driftbench.yaml: campaign.repeats')
          ? PASS
          : fail(
              say(
                D_CFG,
                'exit 2 naming driftbench.yaml: campaign.repeats',
                `${r.code}: ${`${r.out}${r.err}`.slice(0, 200)}`,
              ),
            );
      }),
  );
  add(
    'specs-come-from-the-file-when-no-path-is-given',
    4,
    'campaign run takes the specs of the file when the command line names neither paths nor --dataset',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 2 }, async (w) => {
        yaml(w, { campaign: { specs: w.files.map((f) => f.split('/').pop()) } });
        const r = await w.run(['campaign', 'run']);
        return r.code === 0 && parseRun(r.out).length === 2 && w.agent.requests.length === 2
          ? PASS
          : fail(
              say(
                D_CFG,
                'the 2 specs of the file run',
                `exit ${r.code}; ${parseRun(r.out).length} cells; ${r.err.slice(0, 160)}`,
              ),
            );
      }),
  );
  add(
    'a-path-on-the-command-line-wins-over-the-file-specs',
    4,
    'the paths of the command line replace the specs of the file',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 3 }, async (w) => {
        yaml(w, { campaign: { specs: w.files.map((f) => f.split('/').pop()) } });
        const r = await w.run(['campaign', 'run', w.files[1] as string]);
        return r.code === 0 && parseRun(r.out).length === 1
          ? PASS
          : fail(say(D_CFG, 'only the named spec runs', `exit ${r.code}; ${parseRun(r.out).length} cells`));
      }),
  );
  add(
    'world-only-perturbation-cell-sends-the-spec-blocks-alone',
    3,
    'a P cell of a world-only perturbation has as many blocks as the spec',
    async (ctx, tag) =>
      withWorld(ctx, tag, { specs: 1, blocks: 3, perturbations: 1 }, async (w) => {
        w.rewrite(0, (def) => ({ ...def, worldOnly: true }));
        const cells = parsePlan((await w.run(['campaign', 'plan', ...w.files, '--mode', 'F,P'])).out);
        return cells.map((c) => `${c.mode}${c.blocks}`).join() === 'F3,P3'
          ? PASS
          : fail(say(D_CELLS, 'F 3 blocks, P 3 blocks', show(cells.map((c) => `${c.mode}${c.blocks}`))));
      }),
  );
  return out;
}

export function campaignItems(): BankItem[] {
  return [
    ...cellItems(),
    ...poolItems(),
    ...budgetItems(),
    ...resumeItems(),
    ...exitItems(),
    ...smokeItems(),
    ...configItems(),
  ];
}
void ({} as BlocksProduct);
