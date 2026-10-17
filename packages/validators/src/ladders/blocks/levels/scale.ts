import { initialize, observed, SHOP, statusOf } from '../harness';
import { token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BankItem, fail, PASS, type Tier } from '../types';

/**
 * Family `scale`: a capability takes time linear in what it reads (docs/validators.md section 13.1). Each item
 * builds an input of a base size, measures the capability on it, builds the same input 10 or 100 times larger and
 * measures again, in CPU time (user plus system, never wall time), best of 3. The budget is
 * `4 * m * max(base time, 5 ms)`: linear growth with a factor 4 of slack, and a floor so timer noise on a fast
 * base never sets it. The item also checks the answer at the larger size, so a product that skips the work does
 * not pass. A try over 5 times the budget ends the item there, and the 100 times item checks the 10 times input
 * once first, so a quadratic product costs one slow try, not three at 100 times.
 *
 * Inputs hold only neutral tokens. Where an exact answer is known by construction the input is a base pattern
 * repeated, so the answer does not change with the size.
 */

/** Linear growth with this factor of slack. */
export const SCALE_SLACK = 4;
/** The base time below which timer noise decides: a base under this counts as this. */
export const SCALE_FLOOR_MS = 5;
/** A try over this many budgets is a defect no noise explains: the item stops there. */
const RUNAWAY = 5;
/** The one try at 10 times, in the 100 times item, that stops it: a linear product sits near a quarter of this. */
const PROBE_RUNAWAY = 1.5;

/** The CPU time of one call, user plus system, in milliseconds. */
async function cpuOnce<T>(call: () => Promise<T> | T): Promise<{ ms: number; result: T }> {
  const start = process.cpuUsage();
  const result = await call();
  const used = process.cpuUsage(start);
  return { ms: (used.user + used.system) / 1000, result };
}

type Prepared = {
  call(): Promise<unknown> | unknown;
  /** What is wrong with the answer, or undefined when it is right. */
  wrong(result: unknown): string | undefined;
};

type Capability = {
  key: string;
  /** What is measured, in the item title. */
  what: string;
  unit: string;
  level: number;
  component: string;
  base: number;
  tier10: Tier;
  tier100: Tier;
  prepare(product: BlocksProduct, seed: number, size: number): Prepared;
};

type Obj = Record<string, unknown>;

/** A block id, token only. */
const blockId = (seed: number, tag: string, index: number) => token(seed, `${tag}#${index}`, 8);

/** The raw spec of `size` blocks: each expects one marker and one tool call. */
function rawSpec(seed: number, tag: string, size: number, extra: Obj = {}): Obj {
  return {
    id: `s-${token(seed, `${tag}:spec`)}`,
    ...extra,
    blocks: Array.from({ length: size }, (_, index) => ({
      id: blockId(seed, tag, index),
      user: `${SHOP.customers[index % SHOP.customers.length]} asks about ${SHOP.bikes[index % SHOP.bikes.length]} (${index})`,
      expect: { must: ['LK'], tools: [{ label: SHOP.tools[index % SHOP.tools.length], count: 1 }] },
    })),
  };
}

function loaded(product: BlocksProduct, raw: Obj): Obj {
  initialize(product);
  const validateSpec = need<(raw: unknown, path?: string) => Obj>(product.core, 'core', 'validateSpec');
  const result = validateSpec(structuredClone(raw), 'blocks:scale');
  if (result.ok !== true)
    throw new Error(`the loader refuses the scale spec: ${JSON.stringify(result.errors).slice(0, 200)}`);
  return result.spec as Obj;
}

/** The scripted agent of the run items: one fixed reply and one tool call, nothing read from the history. */
function steadyAdapter(product: BlocksProduct): Obj {
  const functionAdapter = need<(options: Obj) => Obj>(product.adapters, 'adapters', 'functionAdapter');
  return functionAdapter({
    create: () => ({}),
    payloads: () => [],
    respond: () => observed('LK noted', SHOP.tools.map((label) => ({ label })).slice(0, 5)),
    deterministic: true,
    version: 'blocks-scale',
  });
}

const CAPABILITIES: Capability[] = [
  {
    key: 'validate-conversation',
    what: 'the loader on a conversation spec',
    unit: 'blocks',
    level: 1,
    component: 'packages/core/src/spec/load.ts',
    base: 400,
    tier10: 3,
    tier100: 4,
    prepare(product, seed, size) {
      const raw = rawSpec(seed, 'val', size);
      return {
        call: () => loaded(product, raw),
        wrong: (result) => {
          const blocks = (result as { blocks?: unknown[] }).blocks;
          return Array.isArray(blocks) && blocks.length === size
            ? undefined
            : `the loaded spec should hold ${size} blocks; it holds ${Array.isArray(blocks) ? blocks.length : 'none'}`;
        },
      };
    },
  },
  {
    key: 'validate-task',
    what: 'the loader on a task spec that seeds a workspace',
    unit: 'blocks and workspace files',
    level: 1,
    component: 'packages/core/src/spec/load.ts',
    base: 400,
    tier10: 3,
    tier100: 4,
    prepare(product, seed, size) {
      const files = Object.fromEntries(
        Array.from({ length: size }, (_, index) => [
          `in/${blockId(seed, 'file', index)}.txt`,
          `row ${index} of ${SHOP.bikes[index % SHOP.bikes.length]}`,
        ]),
      );
      const raw = rawSpec(seed, 'task', size, {
        kind: 'task',
        given: { world: { workspace: { files } } },
      });
      return {
        call: () => loaded(product, raw),
        wrong: (result) => {
          const spec = result as { blocks?: unknown[]; given?: { world?: { workspace?: { files?: Obj } } } };
          const seeded = Object.keys(spec.given?.world?.workspace?.files ?? {}).length;
          return spec.blocks?.length === size && seeded === size
            ? undefined
            : `the loaded task should hold ${size} blocks and ${size} seeded files; it holds ${spec.blocks?.length ?? 'none'} and ${seeded}`;
        },
      };
    },
  },
  {
    key: 'spec-hash',
    what: 'the spec hash',
    unit: 'blocks',
    level: 1,
    component: 'packages/core/src/spec/hash.ts',
    base: 2000,
    tier10: 3,
    tier100: 4,
    prepare(product, seed, size) {
      const raw = rawSpec(seed, 'hash', size);
      const spec = loaded(product, raw);
      const other = structuredClone(raw) as { blocks: { user: string }[] };
      (other.blocks[Math.floor(size / 2)] as { user: string }).user += ' (changed)';
      const specHash = need<(spec: unknown) => string>(product.core, 'core', 'specHash');
      return {
        call: () => specHash(spec),
        wrong: (result) => {
          const changed = specHash(loaded(product, other as Obj));
          if (typeof result !== 'string' || result === '') return 'the hash should be a non-empty string';
          return result === changed ? 'a spec with one block changed should have another hash' : undefined;
        },
      };
    },
  },
  ...(['F', 'T'] as const).map(
    (mode): Capability => ({
      key: `run-${mode}`,
      what: `the runner in mode ${mode}`,
      unit: 'blocks',
      level: 1,
      component: 'packages/core/src/runner/run.ts',
      base: 25,
      tier10: 4,
      tier100: 5,
      prepare(product, seed, size) {
        const spec = loaded(product, rawSpec(seed, `run${mode}`, size));
        const adapter = steadyAdapter(product);
        const runSpec = need<(spec: unknown, options: Obj) => Promise<Obj>>(product.core, 'core', 'runSpec');
        const createScriptedDriver = need<() => unknown>(product.users, 'users', 'createScriptedDriver');
        const defaultChecks = need<() => unknown>(product.checks, 'checks', 'defaultChecks');
        return {
          call: () =>
            runSpec(spec, {
              adapter,
              driver: createScriptedDriver(),
              checks: defaultChecks(),
              mode,
              repeat: 0,
              retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
              now: () => new Date('2026-10-16T00:00:00.000Z'),
            }),
          wrong: (result) => {
            const run = result as { status?: string; blocks?: { pass: boolean; status?: string }[] };
            const blocks = run.blocks ?? [];
            if (run.status !== 'completed') return `the run should complete; it is ${run.status}`;
            if (blocks.length !== size)
              return `the run should hold ${size} blocks; it holds ${blocks.length}`;
            const bad = blocks.findIndex(
              (block) => statusOf(product, block as unknown as Parameters<typeof statusOf>[1]) !== 'pass',
            );
            return bad < 0 ? undefined : `block ${bad} of the run should pass`;
          },
        };
      },
    }),
  ),
  {
    key: 'suite-headline',
    what: 'the suite headline',
    unit: 'runs',
    level: 9,
    component: 'packages/report/src/headline.ts',
    base: 500,
    tier10: 3,
    tier100: 4,
    prepare(product, seed, size) {
      const goldens = 25;
      const golden = (index: number) => `g-${token(seed, `gold#${index % goldens}`, 6)}`;
      // Run i of golden g passes unless (i div 25 + g) is a multiple of 4: a spread of rates across goldens.
      const passes = (index: number) => (Math.floor(index / goldens) + (index % goldens)) % 4 !== 0;
      const runs = Array.from({ length: size }, (_, index) => ({
        runId: `r-${token(seed, `run#${index}`, 8)}`,
        specId: golden(index),
        specHash: 'a'.repeat(12),
        target: { adapter: 'function' },
        mode: 'F',
        repeat: Math.floor(index / goldens),
        status: 'completed',
        blocks: [
          {
            index: 0,
            pass: passes(index),
            givenHash: 'b'.repeat(12),
            observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 },
            verdicts: [],
            ledgerCheck: { ok: true, contradictions: [] },
            drift: [],
          },
        ],
        succession: { driftCount: 0, driftRate: 0, longestClean: 1, minOverBlocks: false },
        cost: 0,
        latencyMs: 0,
      }));
      const suiteHeadline = need<
        (runs: unknown[], treeOf: (run: { specId: string }) => string) => Obj | undefined
      >(product.report, 'report', 'suiteHeadline');
      const rates = new Map<string, { n: number; k: number }>();
      runs.forEach((run, index) => {
        const entry = rates.get(run.specId) ?? { n: 0, k: 0 };
        entry.n += 1;
        if (passes(index)) entry.k += 1;
        rates.set(run.specId, entry);
      });
      const meanOverTrees = [...rates.values()].reduce((sum, e) => sum + e.k / e.n, 0) / rates.size;
      return {
        call: () => suiteHeadline(runs, (run) => run.specId),
        wrong: (result) => {
          const headline = result as { estimate?: number; trees?: number; runs?: number } | undefined;
          if (!headline) return 'the headline should exist for scored runs';
          if (headline.runs !== size || headline.trees !== goldens)
            return `the headline should cover ${size} runs in ${goldens} goldens; it covers ${headline.runs} in ${headline.trees}`;
          return Math.abs((headline.estimate ?? Number.NaN) - meanOverTrees) < 1e-9
            ? undefined
            : `the headline estimate should be the mean over goldens ${meanOverTrees.toFixed(6)}; it is ${headline.estimate}`;
        },
      };
    },
  },
  {
    key: 'workspace-diff',
    what: 'the workspace diff of two snapshots',
    unit: 'files',
    level: 1,
    component: 'packages/sandbox/src/walk.ts',
    base: 2000,
    tier10: 3,
    tier100: 4,
    prepare(product, seed, size) {
      const path = (index: number) => `d${index % 50}/${blockId(seed, 'snap', index)}.dat`;
      const hash = (index: number, round: string) =>
        `${round}${(index * 2654435761).toString(16).padStart(12, '0')}`;
      const before: Obj = {};
      const after: Obj = {};
      const expected = { created: 0, changed: 0, deleted: 0 };
      for (let index = 0; index < size; index += 1) {
        const gone = index % 11 === 0;
        const changed = !gone && index % 7 === 0;
        before[path(index)] = { bytes: 10, sha256: hash(index, 'a') };
        if (gone) expected.deleted += 1;
        else {
          after[path(index)] = { bytes: 10, sha256: hash(index, changed ? 'b' : 'a') };
          if (changed) expected.changed += 1;
        }
        if (index % 13 === 0) {
          after[`new/${blockId(seed, 'made', index)}.dat`] = { bytes: 3, sha256: hash(index, 'c') };
          expected.created += 1;
        }
      }
      const diffSnapshots = need<
        (a: unknown, b: unknown) => { created: string[]; changed: string[]; deleted: string[] }
      >(product.sandbox, 'sandbox', 'diffSnapshots');
      const a = { takenAt: 'before', files: before };
      const b = { takenAt: 'after', files: after };
      return {
        call: () => diffSnapshots(a, b),
        wrong: (result) => {
          const diff = result as { created: string[]; changed: string[]; deleted: string[] };
          return diff.created.length === expected.created &&
            diff.changed.length === expected.changed &&
            diff.deleted.length === expected.deleted
            ? undefined
            : `the diff should hold ${expected.created} created, ${expected.changed} changed and ${expected.deleted} deleted; it holds ${diff.created.length}, ${diff.changed.length} and ${diff.deleted.length}`;
        },
      };
    },
  },
  {
    key: 'wilson-effective',
    what: 'the pass rate over clusters with the design effect',
    unit: 'clusters',
    level: 9,
    component: 'packages/stats/src/effective.ts',
    base: 9000,
    tier10: 3,
    tier100: 4,
    prepare(product, _seed, size) {
      // A pattern of six clusters repeated: the pooled rate is 15 of 30 whatever the size.
      const clusters = Array.from({ length: size }, (_, index) => ({ n: 5, k: index % 6 }));
      const wilsonEffective = need<(clusters: unknown[]) => Obj>(product.stats, 'stats', 'wilsonEffective');
      return {
        call: () => wilsonEffective(clusters),
        wrong: (result) => {
          const answer = result as { estimate?: number; clusters?: number; n?: number };
          return answer.clusters === size &&
            answer.n === size * 5 &&
            Math.abs((answer.estimate ?? Number.NaN) - 0.5) < 1e-12
            ? undefined
            : `the pooled rate over ${size} clusters of 5 should be 0.5; it is ${answer.estimate} over ${answer.clusters} clusters`;
        },
      };
    },
  },
  {
    key: 'hierarchical-interval',
    what: 'the hierarchical interval over trees',
    unit: 'trees',
    level: 9,
    component: 'packages/stats/src/hierarchical.ts',
    base: 1200,
    tier10: 3,
    tier100: 5,
    prepare(product, _seed, size) {
      const trees = Array.from({ length: size }, (_, index) => ({ n: 5, k: index % 6 }));
      const hierarchicalBetaBinomial = need<(trees: unknown[]) => Obj>(
        product.stats,
        'stats',
        'hierarchicalBetaBinomial',
      );
      return {
        call: () => hierarchicalBetaBinomial(trees),
        wrong: (result) => {
          const answer = result as {
            treeMean?: number;
            trees?: number;
            lower?: number;
            upper?: number;
            estimate?: number;
          };
          if (answer.trees !== size || Math.abs((answer.treeMean ?? Number.NaN) - 0.5) > 1e-9)
            return `the mean over ${size} trees should be 0.5; it is ${answer.treeMean} over ${answer.trees} trees`;
          return (answer.lower ?? 1) <= (answer.estimate ?? 0) &&
            (answer.estimate ?? 1) <= (answer.upper ?? 0)
            ? undefined
            : 'the estimate should lie inside its interval';
        },
      };
    },
  },
  {
    key: 'bootstrap-interval',
    what: 'the cluster bootstrap with a fixed number of draws',
    unit: 'values',
    level: 9,
    component: 'packages/stats/src/intervals.ts',
    base: 6000,
    tier10: 3,
    tier100: 4,
    prepare(product, _seed, size) {
      // One value in three is a pass whatever the size; the draws are fixed, so the work grows with the values.
      const values = Array.from({ length: size }, (_, index) => (index % 3 === 0 ? 1 : 0));
      const clusters = values.map((_, index) => `c${index % 50}`);
      const bootstrapCI = need<(values: number[], options: Obj) => Obj>(
        product.stats,
        'stats',
        'bootstrapCI',
      );
      return {
        call: () => bootstrapCI(values, { clusters, iterations: 200 }),
        wrong: (result) => {
          const answer = result as { estimate?: number; lower?: number; upper?: number };
          return Math.abs((answer.estimate ?? Number.NaN) - 1 / 3) < 1e-9 &&
            (answer.lower ?? 1) <= (answer.upper ?? 0)
            ? undefined
            : `the estimate over ${size} values should be one third inside a valid interval; it is ${answer.estimate}`;
        },
      };
    },
  },
  {
    key: 'pii-scan',
    what: 'the personal-data scan of a reply with no address in it',
    unit: 'characters',
    level: 1,
    component: 'packages/checks/src/support/pii.ts',
    base: 800,
    tier10: 3,
    tier100: 5,
    prepare(product, seed, size) {
      // One unbroken word of the characters an email local part allows, no space and no @: a pattern that looks
      // for an address has a candidate start at every character.
      const alphabet = 'abcdefghjkmnpqrstuvwxyz0123456789._%+-';
      const word = Array.from(
        { length: size },
        (_, index) => alphabet[(index * 7 + seed) % alphabet.length],
      ).join('');
      const scanPii = need<(text: string) => { kind: string; value: string }[]>(
        product.checks,
        'checks',
        'scanPii',
      );
      const address = `${token(seed, 'pii-local', 8)}@${token(seed, 'pii-domain', 6)}-cycles.biz`;
      return {
        call: () => scanPii(word),
        wrong: (result) => {
          if (!Array.isArray(result) || result.length !== 0)
            return `a reply with no @ should hold no finding; the scan found ${Array.isArray(result) ? result.length : 'none'}`;
          const found = scanPii(`please write to ${address} today`);
          return found.some((finding) => finding.kind === 'email' && finding.value === address)
            ? undefined
            : 'the scan should still find the address in a short reply';
        },
      };
    },
  },
];

/** Best of 3 CPU runs of the prepared call; stops after the first when it is over `stopAt` ms. */
async function measure(
  prepared: Prepared,
  stopAt: number,
): Promise<{ ms: number; result: unknown; stoppedEarly: boolean }> {
  const first = await cpuOnce(prepared.call);
  if (first.ms > stopAt) return { ms: first.ms, result: first.result, stoppedEarly: true };
  let best = first;
  for (let attempt = 1; attempt < 3; attempt += 1) {
    const next = await cpuOnce(prepared.call);
    if (next.ms < best.ms) best = next;
  }
  return { ms: best.ms, result: best.result, stoppedEarly: false };
}

function budgetFor(baseMs: number, multiple: number): number {
  return SCALE_SLACK * multiple * Math.max(baseMs, SCALE_FLOOR_MS);
}

/** Family `scale`: 11 capabilities at 10 and 100 times a base input, 22 items. */
export function scaleItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const capability of CAPABILITIES) {
    for (const multiple of [10, 100] as const) {
      const id = `scale/${capability.key}/${multiple}x`;
      items.push({
        id,
        family: 'scale',
        tier: multiple === 10 ? capability.tier10 : capability.tier100,
        level: capability.level,
        component: capability.component,
        title: `${capability.what} on ${capability.base * multiple} ${capability.unit} (${multiple} times ${capability.base}) takes at most ${SCALE_SLACK} x ${multiple} x its time on ${capability.base} (floor ${SCALE_FLOOR_MS} ms) in CPU time, best of 3, and still answers right`,
        cause: `${capability.what} grows linearly in its ${capability.unit}: CPU time at 10 and 100 times the base input stays within ${SCALE_SLACK} x the multiple x the base time (docs/validators.md section 13.1).`,
        check: async ({ seed, product }) => {
          const baseline = await measure(
            capability.prepare(product, seed, capability.base),
            Number.POSITIVE_INFINITY,
          );
          const wrongBase = capability.prepare(product, seed, capability.base).wrong(baseline.result);
          if (wrongBase)
            return fail(`on the base input of ${capability.base} ${capability.unit}: ${wrongBase}`);
          const t1 = baseline.ms;

          if (multiple === 100) {
            // One try at 10 times first: a quadratic product is told apart there, at a hundredth of the cost.
            const ten = capability.prepare(product, seed, capability.base * 10);
            const probe = await cpuOnce(ten.call);
            const tenBudget = budgetFor(t1, 10);
            if (probe.ms > PROBE_RUNAWAY * tenBudget)
              return fail(
                `${capability.what} on ${capability.base * 10} ${capability.unit} should take at most ${tenBudget.toFixed(0)} ms of CPU (${SCALE_SLACK} x 10 x max(${t1.toFixed(1)} ms, ${SCALE_FLOOR_MS} ms)); one try took ${probe.ms.toFixed(0)} ms, over ${PROBE_RUNAWAY} times that`,
              );
          }

          const size = capability.base * multiple;
          const prepared = capability.prepare(product, seed, size);
          const budget = budgetFor(t1, multiple);
          const big = await measure(prepared, RUNAWAY * budget);
          if (big.ms > budget)
            return fail(
              `${capability.what} on ${size} ${capability.unit} should take at most ${budget.toFixed(0)} ms of CPU (${SCALE_SLACK} x ${multiple} x max(${t1.toFixed(1)} ms on ${capability.base}, ${SCALE_FLOOR_MS} ms)); it took ${big.stoppedEarly ? 'at least ' : ''}${big.ms.toFixed(0)} ms${big.stoppedEarly ? ' on its first try' : ' (best of 3)'}`,
            );
          const wrong = prepared.wrong(big.result);
          return wrong ? fail(`on ${size} ${capability.unit}: ${wrong}`) : PASS;
        },
      });
    }
  }
  return items;
}
