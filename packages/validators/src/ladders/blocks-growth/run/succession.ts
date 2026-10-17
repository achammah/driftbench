import { rngFor } from '../../blocks/harness';
import {
  type BankItem,
  blocks,
  CORE,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  PASS,
  play,
  playP,
  type RunRecord,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-succession: the metrics of a run's succession (docs/concepts/drift.md "Across the succession"). A scripted agent
 * fails the blocks a seeded pattern names (its reply leaves out the code the block's `must` asks for); the metrics are
 * computed from the planted pattern by the page's definitions, injected blocks included.
 */

const FAMILY = 'bg-succession';
const D = 'docs/concepts/drift.md "Across the succession"';

type Succession = {
  firstDriftBlock?: number | null;
  driftCount?: number;
  driftRate?: number;
  longestClean?: number;
  minOverBlocks?: boolean;
};

/** The metrics of a pattern of blocks ('f' fails, 'p' passes), by the page's definitions. */
function expected(pattern: string) {
  const total = pattern.length;
  const count = [...pattern].filter((c) => c === 'f').length;
  let longest = 0;
  let run = 0;
  for (const c of pattern) {
    run = c === 'p' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const first = pattern.indexOf('f');
  return {
    firstDriftBlock: first === -1 ? undefined : first,
    driftCount: count,
    driftRate: total === 0 ? 0 : count / total,
    longestClean: longest,
    minOverBlocks: count === 0,
  };
}

type Played = { rec: RunRecord; pattern: string };

/** A run in which the spec blocks follow `pattern`; `inject` puts one more block (failing or not) before block `at`. */
async function run(
  ctx: ItemContext,
  tag: string,
  specPattern: string,
  options: { mode?: 'F' | 'T'; inject?: { at: number; fails: boolean } } = {},
): Promise<Played> {
  const defs = blocks(ctx.seed, tag, specPattern.length);
  [...specPattern].forEach((c, i) => {
    if (c === 'f') (defs[i] as { plan: { text: string } }).plan.text = 'Let me check that.';
  });
  const pid = word(ctx.seed, `${tag}:pid`, 6);
  const iw = word(ctx.seed, `${tag}:iw`, 10);
  const icode = word(ctx.seed, `${tag}:icode`, 8);
  const sc = scenario(
    ctx.seed,
    tag,
    defs,
    options.inject
      ? {
          perturbations: [
            {
              id: pid,
              class: 'D1_off_topic',
              inject_at: options.inject.at,
              user: iw,
              expect: { must: [icode] },
            },
          ],
        }
      : {},
  );
  if (options.inject)
    sc.plans.set(iw, { text: options.inject.fails ? 'Let me check that.' : `Sure, ${icode}.` });
  const { rec } = options.inject
    ? await playP(ctx, sc, pid)
    : await play(ctx, sc, { mode: options.mode ?? 'F' });
  const pattern = options.inject
    ? `${specPattern.slice(0, options.inject.at)}${options.inject.fails ? 'f' : 'p'}${specPattern.slice(options.inject.at)}`
    : specPattern;
  return { rec, pattern };
}

const successionOf = (rec: RunRecord) => (rec as unknown as { succession?: Succession }).succession ?? {};

const SHAPES = ['ppp', 'fff', 'fpp', 'ppf', 'pffp', 'pfpfp', 'f', 'p', 'ppfppfpppp', 'fpppppf'];

type Metric = 'firstDriftBlock' | 'driftCount' | 'driftRate' | 'longestClean' | 'minOverBlocks';

function metricItems(): BankItem[] {
  const out: BankItem[] = [];
  const causes: Record<Metric, 'SC1' | 'SC2' | 'SC3' | 'SC4' | 'SC5'> = {
    firstDriftBlock: 'SC1',
    driftCount: 'SC2',
    driftRate: 'SC3',
    longestClean: 'SC4',
    minOverBlocks: 'SC5',
  };
  const titles: Record<Metric, string> = {
    firstDriftBlock: 'the index of the first failing block, none when no block fails',
    driftCount: 'the number of failing blocks',
    driftRate: 'the failing blocks divided by the blocks in the run',
    longestClean: 'the longest stretch of passing blocks',
    minOverBlocks: 'true only when every block passes',
  };
  const shapesFor: Record<Metric, string[]> = {
    firstDriftBlock: ['ppp', 'fpp', 'ppf', 'pffp', 'pfpfp', 'ppfppfpppp'],
    driftCount: ['ppp', 'fff', 'pffp', 'pfpfp', 'ppfppfpppp'],
    driftRate: ['ppp', 'fff', 'pffp', 'pfpfp', 'fpppppf'],
    longestClean: ['fff', 'ppp', 'pffp', 'ppfppfpppp', 'fpppppf'],
    minOverBlocks: ['ppp', 'p', 'ppf', 'fpp', 'pfp', 'f'],
  };
  for (const metric of Object.keys(shapesFor) as Metric[]) {
    for (const shape of shapesFor[metric]) {
      const id = `bg.succession.${metric}.${shape}`;
      out.push(
        gitem(
          FAMILY,
          id,
          2,
          CORE,
          causes[metric],
          `a run whose blocks pass and fail as ${shape} records ${titles[metric]}`,
          async (ctx) => {
            const { rec, pattern } = await run(ctx, id, shape);
            return compare(rec, pattern, [metric]);
          },
        ),
      );
    }
  }
  return out;
}

function compare(rec: RunRecord, pattern: string, metrics: Metric[]): ItemResult {
  const got = successionOf(rec) as Record<string, unknown>;
  const want = expected(pattern) as Record<string, unknown>;
  if (rec.blocks.length !== pattern.length)
    return fail(`the run holds ${rec.blocks.length} blocks, ${pattern.length} planted`);
  for (const metric of metrics) {
    const a = got[metric];
    const b = want[metric];
    const same =
      b === undefined
        ? a === undefined || a === null
        : typeof b === 'number' && typeof a === 'number'
          ? Math.abs(a - b) < 1e-9
          : a === b;
    if (!same)
      return fail(
        say(
          D,
          `${metric} is ${show(b)} for the blocks ${pattern} (f fails)`,
          `${metric} ${show(a)} in ${show(got)}`,
        ),
      );
  }
  return PASS;
}

function injectedItems(): BankItem[] {
  const cases: {
    id: string;
    spec: string;
    at: number;
    fails: boolean;
    metrics: Metric[];
    cause: 'SC1' | 'SC2' | 'SC3' | 'SC4' | 'SC5';
  }[] = [
    {
      id: 'rate-counts-the-injected-block',
      spec: 'pppp',
      at: 2,
      fails: true,
      metrics: ['driftRate', 'driftCount'],
      cause: 'SC3',
    },
    {
      id: 'rate-counts-a-passing-injected-block-too',
      spec: 'pfp',
      at: 1,
      fails: false,
      metrics: ['driftRate'],
      cause: 'SC3',
    },
    {
      id: 'rate-with-the-injection-after-the-last-block',
      spec: 'ppf',
      at: 3,
      fails: true,
      metrics: ['driftRate'],
      cause: 'SC3',
    },
    {
      id: 'first-drift-index-counts-the-injected-block',
      spec: 'ppp',
      at: 1,
      fails: true,
      metrics: ['firstDriftBlock'],
      cause: 'SC1',
    },
    {
      id: 'first-drift-index-shifts-after-an-injected-pass',
      spec: 'pfp',
      at: 0,
      fails: false,
      metrics: ['firstDriftBlock'],
      cause: 'SC1',
    },
    {
      id: 'count-includes-a-failing-injected-block',
      spec: 'fpf',
      at: 1,
      fails: true,
      metrics: ['driftCount'],
      cause: 'SC2',
    },
    {
      id: 'longest-clean-is-split-by-an-injected-failure',
      spec: 'ppppp',
      at: 2,
      fails: true,
      metrics: ['longestClean'],
      cause: 'SC4',
    },
    {
      id: 'longest-clean-joins-across-an-injected-pass',
      spec: 'ppfpp',
      at: 2,
      fails: false,
      metrics: ['longestClean'],
      cause: 'SC4',
    },
    {
      id: 'all-pass-needs-the-injected-block-to-pass-too',
      spec: 'ppp',
      at: 1,
      fails: true,
      metrics: ['minOverBlocks'],
      cause: 'SC5',
    },
    {
      id: 'all-pass-with-an-injected-pass',
      spec: 'ppp',
      at: 1,
      fails: false,
      metrics: ['minOverBlocks', 'driftCount'],
      cause: 'SC5',
    },
  ];
  return cases.map((each) => {
    const id = `bg.succession.injected.${each.id}`;
    return gitem(
      FAMILY,
      id,
      3,
      CORE,
      each.cause,
      `the metrics are computed over all the blocks of a P run, the injected one included (${each.id})`,
      async (ctx) => {
        const { rec, pattern } = await run(ctx, id, each.spec, {
          inject: { at: each.at, fails: each.fails },
        });
        return compare(rec, pattern, each.metrics);
      },
    );
  });
}

function modeItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const shape of ['pfp', 'ffpp', 'ppp']) {
    const id = `bg.succession.mode-t.${shape}`;
    out.push(
      gitem(
        FAMILY,
        id,
        3,
        CORE,
        'SC6',
        `the runner computes the succession on a T run too (blocks ${shape})`,
        async (ctx) => {
          const { rec, pattern } = await run(ctx, id, shape, { mode: 'T' });
          return compare(rec, pattern, [
            'firstDriftBlock',
            'driftCount',
            'driftRate',
            'longestClean',
            'minOverBlocks',
          ]);
        },
      ),
    );
  }
  for (let k = 0; k < 4; k += 1) {
    const id = `bg.succession.random.${k}`;
    out.push(
      gitem(
        FAMILY,
        id,
        3,
        CORE,
        'SC6',
        'the five metrics of a run with a seeded pattern of failing blocks are the definitions of the page',
        async (ctx) => {
          const rng = rngFor(ctx.seed, id);
          const n = 4 + Math.floor(rng() * 7);
          const shape = Array.from({ length: n }, () => (rng() < 0.4 ? 'f' : 'p')).join('');
          const { rec, pattern } = await run(ctx, id, shape);
          return compare(rec, pattern, [
            'firstDriftBlock',
            'driftCount',
            'driftRate',
            'longestClean',
            'minOverBlocks',
          ]);
        },
      ),
    );
  }
  return out;
}

export function successionItems(): BankItem[] {
  return [...metricItems(), ...injectedItems(), ...modeItems()];
}
void SHAPES;
