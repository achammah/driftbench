import { type Loaded, load, observed, rngFor, scriptedAdapter } from '../../blocks/harness';
import { need } from '../../blocks/product';
import {
  type BankItem,
  blocks,
  CORE,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  injecting,
  PASS,
  type RunRecord,
  type Scenario,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-compounding: the compounding index (docs/concepts/run-modes.md "The compounding index"). Runs of one spec are
 * played in T and F with the blocks a seeded set makes fail; the index is the mean over the blocks both modes ran of
 * the T pass rate minus the F pass rate, a rate being the share of the runs that reached the block and passed.
 */

const FAMILY = 'bg-compounding';
const D = 'docs/concepts/run-modes.md "The compounding index"';

export type Planted = {
  mode: 'T' | 'F' | 'P';
  fails: number[];
  stopAfter?: number;
  inject?: { at: number; fails: boolean };
  target?: Record<string, unknown>;
  repeat: number;
};

type Entry = { specId?: string; target?: unknown; index?: number; interval?: unknown };
type Result = { specs?: Entry[]; overall?: { index?: number; interval?: unknown } };

async function play(
  ctx: ItemContext,
  tag: string,
  sc: Scenario,
  spec: Loaded,
  planted: Planted,
): Promise<RunRecord> {
  const fails = new Set(planted.fails);
  const injectedWord = `${tag}:inj`;
  const adapter = scriptedAdapter(ctx.product, (turn) => {
    const key = [...sc.plans.keys()].find((each) => turn.user.includes(each));
    if (key === undefined)
      return observed(
        turn.user.includes(word(ctx.seed, injectedWord, 10))
          ? planted.inject?.fails
            ? 'Lost.'
            : 'ok'
          : 'Lost.',
      );
    const index = sc.users.indexOf(key);
    return observed(fails.has(index) ? 'Lost.' : (sc.plans.get(key) as { text: string }).text);
  });
  const runSpec = need<(spec: unknown, options: Record<string, unknown>) => Promise<RunRecord>>(
    ctx.product.core,
    'core',
    'runSpec',
  );
  const createScriptedDriver = need<() => unknown>(ctx.product.users, 'users', 'createScriptedDriver');
  const defaultChecks = need<() => unknown>(ctx.product.checks, 'checks', 'defaultChecks');
  const defaultReaders = need<() => unknown>(ctx.product.artifacts, 'artifacts', 'defaultReaders');
  const pid = word(ctx.seed, `${tag}:pid`, 6);
  return runSpec(spec, {
    adapter,
    driver: planted.inject ? injecting(ctx.product, pid) : createScriptedDriver(),
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    mode: planted.mode,
    repeat: planted.repeat,
    ...(planted.mode === 'P' ? { perturbationId: pid } : {}),
    ...(planted.target ? { target: planted.target } : {}),
    ...(planted.stopAfter ? { maxSteps: planted.stopAfter } : {}),
    retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
  });
}

export function setup(ctx: ItemContext, tag: string, n: number, inject = false) {
  const pid = word(ctx.seed, `${tag}:pid`, 6);
  const sc = scenario(
    ctx.seed,
    tag,
    blocks(ctx.seed, tag, n),
    inject
      ? {
          perturbations: [
            {
              id: pid,
              class: 'D1_off_topic',
              inject_at: 1,
              user: word(ctx.seed, `${tag}:inj`, 10),
              expect: { must: [word(ctx.seed, `${tag}:icode`, 8)] },
            },
          ],
        }
      : {},
  );
  return { sc, spec: load(ctx.product, sc.raw) };
}

/** The index the page defines, from the planted sets. */
export function expectedIndex(n: number, planted: Planted[]): { index: number | undefined; shared: number } {
  const rate = (mode: 'T' | 'F', b: number) => {
    const runs = planted.filter((p) => p.mode === mode && !p.inject).filter((p) => (p.stopAfter ?? n) > b);
    return runs.length === 0 ? undefined : runs.filter((p) => !p.fails.includes(b)).length / runs.length;
  };
  const diffs: number[] = [];
  for (let b = 0; b < n; b += 1) {
    const t = rate('T', b);
    const f = rate('F', b);
    if (t !== undefined && f !== undefined) diffs.push(t - f);
  }
  return {
    index: diffs.length === 0 ? undefined : diffs.reduce((a, c) => a + c, 0) / diffs.length,
    shared: diffs.length,
  };
}

export async function computed(
  ctx: ItemContext,
  runs: RunRecord[],
  interval?: (...args: unknown[]) => unknown,
): Promise<Result> {
  const compoundingIndex = need<(runs: unknown[], options?: Record<string, unknown>) => Result>(
    ctx.product.core,
    'core',
    'compoundingIndex',
  );
  return compoundingIndex(runs, interval ? { interval } : {});
}

export const near = (a: number | undefined, b: number | undefined) =>
  a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9;

export async function playAll(ctx: ItemContext, tag: string, n: number, planted: Planted[], inject = false) {
  const { sc, spec } = setup(ctx, tag, n, inject);
  const runs: RunRecord[] = [];
  for (const p of planted) runs.push(await play(ctx, tag, sc, spec, p));
  return runs;
}

function randomSet(rng: () => number, n: number, share: number): number[] {
  return Array.from({ length: n }, (_, i) => i).filter(() => rng() < share);
}

function indexItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4 | 5,
    cause: 'CI1' | 'CI2' | 'CI3' | 'CI4' | 'CI5',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.compounding.${id}`, tier, CORE, cause, title, (ctx) =>
        check(ctx, `bg.compounding.${id}`),
      ),
    );
  const verify = async (
    ctx: ItemContext,
    tag: string,
    n: number,
    planted: Planted[],
    inject = false,
  ): Promise<ItemResult> => {
    const runs = await playAll(ctx, tag, n, planted, inject);
    const result = await computed(ctx, runs);
    const want = expectedIndex(n, planted);
    const got = result.specs?.[0]?.index;
    return (result.specs ?? []).length === 1 && near(got, want.index)
      ? PASS
      : fail(
          say(
            D,
            `index ${want.index} over ${want.shared} shared blocks`,
            `${show(got)} in ${JSON.stringify(result).slice(0, 200)}`,
          ),
        );
  };
  for (const [k, n] of [
    [0, 4],
    [1, 5],
    [2, 6],
  ] as [number, number][])
    add(
      `mean-over-blocks.${k}`,
      3,
      'CI1',
      'the compounding index of a spec is the mean over its shared blocks of the T pass rate minus the F pass rate',
      async (ctx, tag) => {
        const rng = rngFor(ctx.seed, tag);
        const planted: Planted[] = [
          { mode: 'T', fails: randomSet(rng, n, 0.2), repeat: 0 },
          {
            mode: 'F',
            fails: [...randomSet(rng, n, 0.2), n - 1, n - 2].filter((v, i, all) => all.indexOf(v) === i),
            repeat: 0,
          },
        ];
        return verify(ctx, tag, n, planted);
      },
    );
  for (const [k, ts, fs] of [
    [0, 3, 4],
    [1, 2, 5],
    [2, 4, 2],
  ] as [number, number, number][])
    add(
      `rates-over-repeats.${k}`,
      4,
      'CI1',
      'a block rate is the share of the runs of the mode that passed the block, over several repeats',
      async (ctx, tag) => {
        const rng = rngFor(ctx.seed, tag);
        const n = 5;
        const planted: Planted[] = [
          ...Array.from({ length: ts }, (_, r) => ({
            mode: 'T' as const,
            fails: randomSet(rng, n, 0.25),
            repeat: r,
          })),
          ...Array.from({ length: fs }, (_, r) => ({
            mode: 'F' as const,
            fails: randomSet(rng, n, 0.5),
            repeat: r,
          })),
        ];
        return verify(ctx, tag, n, planted);
      },
    );
  for (const [k, stop] of [
    [0, 2],
    [1, 3],
  ] as [number, number][])
    add(
      `runs-that-did-not-reach-a-block.${k}`,
      5,
      'CI2',
      'a block rate counts only the runs that reached the block',
      async (ctx, tag) => {
        const n = 5;
        const planted: Planted[] = [
          { mode: 'T', fails: [], repeat: 0 },
          { mode: 'T', fails: [n - 1], repeat: 1 },
          { mode: 'F', fails: [], repeat: 0 },
          { mode: 'F', fails: [n - 1, n - 2], repeat: 1 },
          { mode: 'F', fails: [], stopAfter: stop, repeat: 2 },
        ];
        const runs = await playAll(ctx, tag, n, planted);
        const reached = runs[4]?.blocks.length;
        const result = await computed(ctx, runs);
        const want = expectedIndex(n, planted);
        return reached === stop && near(result.specs?.[0]?.index, want.index)
          ? PASS
          : fail(
              say(
                D,
                `the stopped F run reached ${stop} blocks; index ${want.index}`,
                `reached ${reached}; ${show(result.specs?.[0]?.index)}`,
              ),
            );
      },
    );
  add(
    'only-the-blocks-both-modes-ran',
    4,
    'CI2',
    'the index is the mean over the blocks both modes ran: blocks only T reached are left out',
    async (ctx, tag) => {
      const n = 5;
      const planted: Planted[] = [
        { mode: 'T', fails: [3], repeat: 0 },
        { mode: 'F', fails: [1], stopAfter: 2, repeat: 0 },
      ];
      const runs = await playAll(ctx, tag, n, planted);
      const want = expectedIndex(n, planted);
      const result = await computed(ctx, runs);
      return want.shared === 2 && near(result.specs?.[0]?.index, want.index)
        ? PASS
        : fail(say(D, `index ${want.index} over blocks 0 and 1`, show(result.specs?.[0]?.index)));
    },
  );
  for (const [k, pFails] of [
    [0, [0, 1, 2]],
    [1, []],
    [2, [1]],
  ] as [number, number[]][])
    add(`p-runs-ignored.${k}`, 4, 'CI3', 'runs in mode P are ignored', async (ctx, tag) => {
      const n = 4;
      const planted: Planted[] = [
        { mode: 'T', fails: [], repeat: 0 },
        { mode: 'F', fails: [1, 2], repeat: 0 },
        { mode: 'P', fails: pFails, inject: { at: 1, fails: true }, repeat: 0 },
      ];
      const runs = await playAll(ctx, tag, n, planted, true);
      const result = await computed(ctx, runs);
      const want = expectedIndex(n, planted);
      return near(result.specs?.[0]?.index, want.index)
        ? PASS
        : fail(say(D, `index ${want.index}: the P run adds nothing`, show(result.specs?.[0]?.index)));
    });
  add(
    'a-spec-that-ran-in-one-mode-has-no-index',
    4,
    'CI4',
    'only a spec that ran in both T and F gets an index',
    async (ctx, tag) => {
      const n = 3;
      const a = setup(ctx, `${tag}:a`, n);
      const b = setup(ctx, `${tag}:b`, n);
      const runs = [
        await play(ctx, `${tag}:a`, a.sc, a.spec, { mode: 'T', fails: [], repeat: 0 }),
        await play(ctx, `${tag}:a`, a.sc, a.spec, { mode: 'F', fails: [2], repeat: 0 }),
        await play(ctx, `${tag}:b`, b.sc, b.spec, { mode: 'T', fails: [], repeat: 0 }),
        await play(ctx, `${tag}:b`, b.sc, b.spec, { mode: 'T', fails: [1], repeat: 1 }),
      ];
      const result = await computed(ctx, runs);
      const ids = (result.specs ?? []).map((entry) => entry.specId);
      return ids.length === 1 && ids[0] === a.sc.raw.id && near(result.specs?.[0]?.index, 1 / 3)
        ? PASS
        : fail(
            say(
              D,
              'one entry, for the spec that ran in T and F, with index 1/3',
              JSON.stringify(result).slice(0, 220),
            ),
          );
    },
  );
  add(
    'per-spec-and-target',
    4,
    'CI4',
    'the index is computed per spec and target: one spec on two targets gives two entries',
    async (ctx, tag) => {
      const n = 4;
      const { sc, spec } = setup(ctx, tag, n);
      const targetA = { adapter: 'function', agent: word(ctx.seed, `${tag}:a`, 6) };
      const targetB = { adapter: 'function', agent: word(ctx.seed, `${tag}:b`, 6) };
      const runs = [
        await play(ctx, tag, sc, spec, { mode: 'T', fails: [], repeat: 0, target: targetA }),
        await play(ctx, tag, sc, spec, { mode: 'F', fails: [1, 2], repeat: 0, target: targetA }),
        await play(ctx, tag, sc, spec, { mode: 'T', fails: [], repeat: 0, target: targetB }),
        await play(ctx, tag, sc, spec, { mode: 'F', fails: [3], repeat: 0, target: targetB }),
      ];
      const result = await computed(ctx, runs);
      const indexes = (result.specs ?? []).map((entry) => entry.index ?? Number.NaN).sort();
      return indexes.length === 2 && near(indexes[0], 0.25) && near(indexes[1], 0.5)
        ? PASS
        : fail(say(D, 'two entries, 0.25 and 0.5', JSON.stringify(result).slice(0, 220)));
    },
  );
  return out;
}

function intervalItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (id: string, title: string, check: (ctx: ItemContext, tag: string) => Promise<ItemResult>) =>
    out.push(
      gitem(FAMILY, `bg.compounding.interval.${id}`, 4, CORE, 'CI5', title, (ctx) =>
        check(ctx, `bg.compounding.interval.${id}`),
      ),
    );
  const two = async (ctx: ItemContext, tag: string, specs: number) => {
    const runs: RunRecord[] = [];
    for (let s = 0; s < specs; s += 1) {
      const { sc, spec } = setup(ctx, `${tag}:${s}`, 3);
      runs.push(await play(ctx, `${tag}:${s}`, sc, spec, { mode: 'T', fails: [], repeat: 0 }));
      runs.push(await play(ctx, `${tag}:${s}`, sc, spec, { mode: 'F', fails: [2], repeat: 0 }));
    }
    return runs;
  };
  add(
    'function-is-passed-in',
    'the interval function is passed in and its answer is attached to the spec entry',
    async (ctx, tag) => {
      const marker = { lo: 0.1, hi: 0.9, tag: word(ctx.seed, `${tag}:m`, 6) };
      let calls = 0;
      const result = await computed(ctx, await two(ctx, tag, 1), () => {
        calls += 1;
        return marker;
      });
      return calls >= 1 && JSON.stringify(result.specs?.[0]?.interval) === JSON.stringify(marker)
        ? PASS
        : fail(
            say(
              D,
              'the spec entry carries the interval the function returned',
              `${calls} calls; ${JSON.stringify(result.specs?.[0]?.interval)}`,
            ),
          );
    },
  );
  add(
    'no-function-no-interval',
    'without an interval function no entry carries an interval',
    async (ctx, tag) => {
      const result = await computed(ctx, await two(ctx, tag, 2));
      return (result.specs ?? []).every((entry) => entry.interval === undefined) &&
        result.overall?.interval === undefined
        ? PASS
        : fail(say(D, 'no interval anywhere', JSON.stringify(result).slice(0, 240)));
    },
  );
  add(
    'one-spec-no-overall-interval',
    'a campaign with one spec gets no interval on its overall index: one spec is one cluster',
    async (ctx, tag) => {
      const result = await computed(ctx, await two(ctx, tag, 1), () => ({ lo: 0, hi: 1 }));
      return result.overall?.interval === undefined && result.specs?.[0]?.interval !== undefined
        ? PASS
        : fail(
            say(
              D,
              'an interval on the spec, none on the overall index',
              JSON.stringify(result).slice(0, 240),
            ),
          );
    },
  );
  add(
    'two-specs-have-an-overall-interval',
    'a campaign with two specs gets an interval on its overall index',
    async (ctx, tag) => {
      const result = await computed(ctx, await two(ctx, tag, 2), () => ({ lo: 0, hi: 1 }));
      return result.overall?.interval !== undefined
        ? PASS
        : fail(say(D, 'an interval on the overall index of two specs', JSON.stringify(result).slice(0, 240)));
    },
  );
  return out;
}

export function compoundingItems(): BankItem[] {
  return [...indexItems(), ...intervalItems()];
}
