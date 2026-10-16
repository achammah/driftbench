import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalJson,
  type DriftClass,
  type Observed,
  type RunMode,
  type RunResult,
  type Store,
  type TargetRef,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import * as report from '@agent-nexus/driftbench-report';
import * as stats from '@agent-nexus/driftbench-stats';
import { openMemoryStore, openStore } from '@agent-nexus/driftbench-store';
import { LOOKUP, withForbiddenCall } from '../../family';
import type { Behaviour, Flow } from '../../plant';
import { MIN_GOLDENS } from '../documented';
import { withPerturbation } from '../reach';
import { type BankItem, fail, type ItemSource, PASS, type Tier } from '../types';
import { behavioursFor, type Faults, memoryCache, plantedFlow, runScenario } from '../world';

/**
 * The fixture of the report claims: two campaigns stored through the real runner in one memory store, with
 * every outcome planted, so the truth of each number the report prints is known before the report runs.
 *
 * Baseline `c-base` (targets A = function:planted, B = function:planted variant b):
 *   S0 (4 blocks, end state step 4: matches): clean in T, F, P on A and F on B; B F repeat 2 throws (failed).
 *   S1 (4 blocks): F on A and B, repeats 0 and 1 carry X1_local at block f1; T clean; P injections late.
 *   S2 (4 blocks): repeat 0 of every mode on A carries X5_tool at block f2; B F repeat 1 carries X4_format at
 *       block 0; P repeat 0 immediate, P repeat 1 never (fails the injection with a question and a forbidden
 *       call, then X3_flow on every later block).
 *   S3 (2 blocks, end state step 99: never matches): F on A, 3 repeats, every block passes.
 * Candidate `c-cand` (T and F only, same targets): S0 F on A carries X1_local at block 1 on every repeat;
 *   S0 B no longer throws; S1 T repeat 0 calls the forbidden tool at block 0; S2 is clean; S3 not run.
 */

export const TA: TargetRef = { adapter: 'function', agent: 'planted' };
export const TB: TargetRef = { adapter: 'function', agent: 'planted', variant: 'b' };
const CREATED_BASE = '2026-10-11T00:00:00.000Z';
const CREATED_CAND = '2026-10-11T06:00:00.000Z';

type Plan = {
  faults: Faults;
  /** Throw from this spec block: the run fails. */
  throwAt?: number;
  /** Add a forbidden call at this spec block. */
  forbiddenAt?: number;
  /** How the injected block answers in P. */
  injection?: 'right' | 'wrong' | 'wrong-question-forbidden';
};

export type SpecDef = { flow: Flow; blocks: number; perturbation?: string; injectionText?: string };

export type Fixture = {
  store: Store;
  specs: SpecDef[];
  f1: number;
  f2: number;
  base: report.CampaignData;
  cand: report.CampaignData;
  /** The raw runs of each campaign, as the store lists them. */
  rawBase: RunResult[];
  rawCand: RunResult[];
};

function costed(
  observed: Observed,
  specIndex: number,
  block: number,
  repeat: number,
  mode: RunMode,
): Observed {
  return {
    ...observed,
    cost: { usd: 0.001 * (specIndex + 1) + 0.0001 * block },
    latencyMs: 10 * (block + 1) + repeat + (mode === 'T' ? 5 : 0),
  };
}

function behavioursOf(def: SpecDef, specIndex: number, plan: Plan, repeat: number, mode: RunMode) {
  const base = behavioursFor(def.flow, plan.faults);
  const out = new Map<string, Behaviour>();
  def.flow.texts.forEach((text, index) => {
    const behave = base.get(text) as Behaviour;
    out.set(text, (target) => {
      if (plan.throwAt === index) throw new Error('a planted agent failure');
      let observed = behave(target);
      if (plan.forbiddenAt === index) observed = withForbiddenCall(observed);
      return costed(observed, specIndex, index, repeat, mode);
    });
  });
  if (def.injectionText) {
    const holder = new Map<string, Behaviour>();
    // withPerturbation writes the right answer of the injected block; it is wrapped for the other kinds.
    withPerturbation({ ...def.flow, spec: { ...def.flow.spec } }, holder, 2);
    const right = holder.get(def.injectionText) as Behaviour;
    out.set(def.injectionText, (target) => {
      let observed = right(target);
      if (plan.injection !== 'right') {
        const text =
          plan.injection === 'wrong' ? 'Yes, it is open.' : 'Yes, it is open. Shall I place it now?';
        observed = { ...observed, text, segments: [{ type: 'text', text }] };
        if (plan.injection === 'wrong-question-forbidden') observed = withForbiddenCall(observed);
      }
      return { ...observed, cost: { usd: 0.0005 }, latencyMs: 7 };
    });
  }
  return out;
}

function specDefs(seed: number): SpecDef[] {
  const defs: SpecDef[] = [];
  for (let index = 0; index < 4; index += 1) {
    const blocks = index === 3 ? 2 : 4;
    const flow = plantedFlow(seed, `claim-report-s${index}`, blocks);
    if (index === 0) flow.spec.end_state = { source: `tool:${LOOKUP}`, expect: { step: 4 } };
    if (index === 3) flow.spec.end_state = { source: `tool:${LOOKUP}`, expect: { step: 99 } };
    const def: SpecDef = { flow, blocks };
    if (index < 3) {
      const holder = new Map<string, Behaviour>();
      def.perturbation = withPerturbation(flow, holder, 2);
      // A window of 0 blocks: a recovery at the injected block is immediate, one a block later late
      // (docs/concepts/recovery.md "The label rule"), so the fixture plants all three labels.
      const [entry] = flow.spec.perturbations as Array<{ recovery: { within_blocks: number } }>;
      if (entry) entry.recovery.within_blocks = 0;
      def.injectionText = [...holder.keys()][0];
    }
    defs.push(def);
  }
  return defs;
}

type Cell = { spec: number; target: TargetRef; mode: RunMode; repeat: number; plan: Plan };

function baseCells(f1: number, f2: number): Cell[] {
  const cells: Cell[] = [];
  const none: Faults = new Map();
  for (const spec of [0, 1, 2]) {
    for (const mode of ['T', 'F'] as const) {
      for (let repeat = 0; repeat < 3; repeat += 1) {
        let faults = none;
        if (spec === 1 && mode === 'F' && repeat < 2) faults = new Map([[f1, ['X1_local']]]);
        if (spec === 2 && repeat === 0) faults = new Map([[f2, ['X5_tool']]]);
        cells.push({ spec, target: TA, mode, repeat, plan: { faults } });
      }
    }
    for (let repeat = 0; repeat < 3; repeat += 1) {
      let plan: Plan = { faults: none };
      if (spec === 0 && repeat === 2) plan = { faults: none, throwAt: 1 };
      if (spec === 1 && repeat < 2) plan = { faults: new Map([[f1, ['X1_local']]]) };
      if (spec === 2 && repeat === 1) plan = { faults: new Map([[0, ['X4_format']]]) };
      cells.push({ spec, target: TB, mode: 'F', repeat, plan });
    }
    for (let repeat = 0; repeat < 2; repeat += 1) {
      let plan: Plan = { faults: none, injection: 'right' };
      if (spec === 1) plan = { faults: none, injection: 'wrong' };
      if (spec === 2 && repeat === 0) plan = { faults: new Map([[f2, ['X5_tool']]]), injection: 'right' };
      if (spec === 2 && repeat === 1)
        plan = {
          faults: new Map([
            [2, ['X3_flow']],
            [3, ['X3_flow']],
          ]),
          injection: 'wrong-question-forbidden',
        };
      cells.push({ spec, target: TA, mode: 'P', repeat, plan });
    }
  }
  for (let repeat = 0; repeat < 3; repeat += 1)
    cells.push({ spec: 3, target: TA, mode: 'F', repeat, plan: { faults: none } });
  return cells;
}

function candCells(f1: number): Cell[] {
  const cells: Cell[] = [];
  const none: Faults = new Map();
  for (const spec of [0, 1, 2]) {
    for (const mode of ['T', 'F'] as const) {
      for (let repeat = 0; repeat < 3; repeat += 1) {
        let plan: Plan = { faults: none };
        if (spec === 0 && mode === 'F') plan = { faults: new Map([[1, ['X1_local']]]) };
        if (spec === 1 && mode === 'F' && repeat < 2) plan = { faults: new Map([[f1, ['X1_local']]]) };
        if (spec === 1 && mode === 'T' && repeat === 0) plan = { faults: none, forbiddenAt: 0 };
        cells.push({ spec, target: TA, mode, repeat, plan });
      }
    }
    for (let repeat = 0; repeat < 3; repeat += 1) {
      let plan: Plan = { faults: none };
      if (spec === 1 && repeat < 2) plan = { faults: new Map([[f1, ['X1_local']]]) };
      cells.push({ spec, target: TB, mode: 'F', repeat, plan });
    }
  }
  return cells;
}

async function runCells(store: Store, campaignId: string, defs: SpecDef[], cells: Cell[]) {
  for (const cell of cells) {
    const def = defs[cell.spec] as SpecDef;
    await runScenario(def.flow.spec, behavioursOf(def, cell.spec, cell.plan, cell.repeat, cell.mode), {
      mode: cell.mode,
      repeat: cell.repeat,
      target: cell.target,
      store,
      campaignId,
      ...(cell.mode === 'P' && def.perturbation ? { perturbationId: def.perturbation } : {}),
    });
  }
}

async function build(seed: number, store: Store = openMemoryStore()): Promise<Fixture> {
  const f1 = 1 + (seed % 3);
  const f2 = 2 + (seed % 2);
  const specs = specDefs(seed);
  const loaded = specs.map((def) => {
    const result = validateSpec(def.flow.spec, 'claim-report');
    if (!result.ok) throw new Error(`a planted spec does not load: ${def.flow.spec.id}`);
    return result;
  });
  for (const entry of loaded) await store.putSpec(entry);
  const pins = loaded.map((entry) => ({ id: entry.spec.id, hash: entry.hash }));
  await store.putCampaign({
    campaignId: 'c-base',
    specs: pins,
    targets: [TA, TB],
    modes: ['T', 'F', 'P'],
    repeats: { T: 3, F: 3, P: 2 },
    budgetUsd: 1,
    judge: { mode: 'system1', judges: [] },
    createdAt: CREATED_BASE,
  });
  await store.putCampaign({
    campaignId: 'c-cand',
    specs: pins.slice(0, 3),
    targets: [TA, TB],
    modes: ['T', 'F'],
    repeats: { T: 3, F: 3, P: 0 },
    budgetUsd: 1,
    judge: { mode: 'system1', judges: [] },
    createdAt: CREATED_CAND,
  });
  await runCells(store, 'c-base', specs, baseCells(f1, f2));
  await runCells(store, 'c-cand', specs, candCells(f1));
  return {
    store,
    specs,
    f1,
    f2,
    base: await report.loadCampaign(store, 'c-base'),
    cand: await report.loadCampaign(store, 'c-cand'),
    rawBase: await store.listRuns({ campaignId: 'c-base' }),
    rawCand: await store.listRuns({ campaignId: 'c-cand' }),
  };
}

const fixtures = new Map<number, Promise<Fixture>>();
export function fixture(seed: number): Promise<Fixture> {
  let held = fixtures.get(seed);
  if (!held) {
    held = build(seed);
    // One seed at a time: the seeds of a run come one after another, so only the last fixture is kept.
    fixtures.clear();
    fixtures.set(seed, held);
  }
  return held;
}

/** The same two campaigns in a SQLite file of the scratch folder, closed, for the command line. */
const files = new Map<string, Promise<{ path: string; fx: Fixture }>>();
function fileFixture(seed: number, scratch: string): Promise<{ path: string; fx: Fixture }> {
  const path = join(scratch, `claim-report-${seed}.db`);
  let held = files.get(path);
  if (!held) {
    held = (async () => {
      const store = openStore(path);
      const fx = await build(seed, store);
      await store.close();
      return { path, fx };
    })();
    files.clear();
    files.set(path, held);
  }
  return held;
}

/** One clean F run of S0 under a campaign id that needs escaping in XML and HTML. */
const ODD_ID = 'c-<odd&"id">\u0007';
async function oddCampaign(seed: number): Promise<report.CampaignData> {
  const specs = specDefs(seed);
  const store = openMemoryStore();
  const loaded = validateSpec((specs[0] as SpecDef).flow.spec, 'claim-report');
  if (!loaded.ok) throw new Error('S0 does not load');
  await store.putSpec(loaded);
  await store.putCampaign({
    campaignId: ODD_ID,
    specs: [{ id: loaded.spec.id, hash: loaded.hash }],
    targets: [TA],
    modes: ['F'],
    repeats: { T: 0, F: 1, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: CREATED_BASE,
  });
  await runCells(store, ODD_ID, specs, [
    { spec: 0, target: TA, mode: 'F', repeat: 0, plan: { faults: new Map() } },
  ]);
  const data = await report.loadCampaign(store, ODD_ID);
  await store.close();
  return data;
}

// ---------------------------------------------------------------------------------------------------
// Brute force: every rule below is written from the docs and the documented types, never from the report.

const REL = 'packages/report/src/reliability.ts';
const SC = 'packages/report/src/scorecard.ts';
const DATA = 'packages/report/src/data.ts';
const EST = 'packages/report/src/estimate.ts';
const JUNIT = 'packages/report/src/junit.ts';
const HTML = 'packages/report/src/html.ts';
const CMP = 'packages/report/src/compare.ts';
const TEXT = 'packages/report/src/text.ts';
const SPREAD = 'packages/report/src/spread.ts';
const COMPOUND = 'packages/core/src/runner/compounding.ts';
const RECOVERY = 'packages/core/src/runner/recovery.ts';
const SUCCESSION = 'packages/core/src/runner/succession.ts';
const CLI_REPORT = 'packages/cli/src/commands/report.ts';
const CLI_COMPARE = 'packages/cli/src/commands/compare.ts';
const EXAMPLES = 'examples/acme/reports/README.md';

const near = (a: unknown, b: number | undefined) =>
  b === undefined ? a === undefined : typeof a === 'number' && Math.abs(a - b) < 1e-12;
const show = (value: unknown) => canonicalJson(value ?? null);

/** docs/concepts/drift.md: a run passes when it completed, every block passed; the runner adds the end state. */
function passes(run: RunResult): boolean {
  return (
    run.status === 'completed' &&
    run.blocks.length > 0 &&
    run.blocks.every((block) => block.pass) &&
    run.endState?.match !== false
  );
}

const targetText = (target: TargetRef) => {
  const base = target.agent === undefined ? target.adapter : `${target.adapter}:${target.agent}`;
  const extras: string[] = [];
  if (target.variant !== undefined) extras.push(`variant ${target.variant}`);
  if (target.deployment !== undefined) extras.push(`deployment ${target.deployment}`);
  return extras.length === 0 ? base : `${base} (${extras.join(', ')})`;
};

const lineOf = (run: RunResult) =>
  [run.specId, run.specHash, canonicalJson(run.target), run.mode, run.perturbationId ?? ''].join('|');

/** The documented run order: campaign spec order, then target, mode T F P, perturbation, repeat. */
function ordered(runs: readonly RunResult[], data: report.CampaignData): RunResult[] {
  const order = new Map(data.campaign.specs.map((pin, index) => [`${pin.id}@${pin.hash}`, index]));
  const modes = ['T', 'F', 'P'];
  return [...runs].sort(
    (a, b) =>
      (order.get(`${a.specId}@${a.specHash}`) ?? 1e9) - (order.get(`${b.specId}@${b.specHash}`) ?? 1e9) ||
      canonicalJson(a.target).localeCompare(canonicalJson(b.target)) ||
      modes.indexOf(a.mode) - modes.indexOf(b.mode) ||
      (a.perturbationId ?? '').localeCompare(b.perturbationId ?? '') ||
      a.repeat - b.repeat,
  );
}

function groups<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const entry of items) out.set(key(entry), [...(out.get(key(entry)) ?? []), entry]);
  return out;
}

const firstFailing = (run: RunResult) => run.blocks.find((block) => !block.pass)?.index;
const failingBlocks = (run: RunResult) => run.blocks.filter((block) => !block.pass).length;
function longestClean(run: RunResult): number {
  let best = 0;
  let now = 0;
  for (const block of run.blocks) {
    now = block.pass ? now + 1 : 0;
    best = Math.max(best, now);
  }
  return best;
}
const meanOf = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
function medianOf(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

type Interval = { estimate: number; lower: number; upper: number };

/**
 * The clustered interval as estimate.ts documents it: design-effect Wilson for binary rates,
 * otherwise a cluster bootstrap (2000 draws, seed 1); with one
 * cluster, no interval; a pass rate whose values all agree, Wilson over the clusters.
 */
function clusteredTruth(
  values: readonly number[],
  clusters: readonly (string | number)[],
  rateFlags = false,
): Interval | undefined {
  if (values.length === 0) return undefined;
  const count = new Set(clusters).size;
  const first = values[0] as number;
  if (rateFlags && count >= 2 && values.every((value) => value === first)) {
    const w = stats.wilson(first === 1 ? count : 0, count);
    return { estimate: first, lower: w.lower, upper: w.upper };
  }
  // estimate.ts and statistics.md: binary rates use the ratio-estimator design effect,
  // with a Student t quantile on clusters - 1, instead of a percentile bootstrap.
  if (rateFlags && count >= 2 && values.every((value) => value === 0 || value === 1)) {
    const p = meanOf(values);
    const totals = new Map<string | number, { n: number; k: number }>();
    values.forEach((v, i) => {
      const key = clusters[i] as string | number;
      const t = totals.get(key) ?? { n: 0, k: 0 };
      t.n += 1;
      t.k += v;
      totals.set(key, t);
    });
    const variance =
      ((count / (count - 1)) * [...totals.values()].reduce((s, t) => s + (t.k - p * t.n) ** 2, 0)) /
      values.length ** 2;
    const effective =
      variance > 0 ? Math.min(values.length, Math.max(1, (p * (1 - p)) / variance)) : values.length;
    const df = count - 1;
    const x = stats.betaQuantile(0.05, df / 2, 0.5);
    const t = Math.sqrt((df * (1 - x)) / x);
    const denominator = 1 + (t * t) / effective;
    const centre = (p + (t * t) / (2 * effective)) / denominator;
    const half = (t * Math.sqrt((p * (1 - p)) / effective + (t * t) / (4 * effective ** 2))) / denominator;
    return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
  }
  const boot = stats.bootstrapCI(values, { clusters, seed: 1, iterations: 2000 });
  if (count < 2) return { estimate: boot.estimate, lower: boot.estimate, upper: boot.estimate };
  return { estimate: boot.estimate, lower: boot.lower, upper: boot.upper };
}

/**
 * The interval of a rate over goldens as docs/concepts/statistics.md, "A rate over goldens", states it, computed
 * here from its formulas and not from the product: `counts` holds the runs and the successes of each golden.
 * The interval is the Wilson score interval on the effective runs with a Student t quantile on goldens less one;
 * one golden, or one run in every golden, is the plain Wilson interval; runs that all agree count each golden once.
 */
function goldenRateTruth(counts: readonly { n: number; k: number }[]): Interval & { n: number; k: number } {
  const c = counts.length;
  const n = counts.reduce((sum, g) => sum + g.n, 0);
  const k = counts.reduce((sum, g) => sum + g.k, 0);
  const p = k / n;
  if (c < 2 || counts.every((g) => g.n === 1)) return { n, k, ...stats.wilson(k, n) };
  if (p === 0 || p === 1) return { n, k, ...stats.wilson(p === 1 ? c : 0, c), estimate: p };
  const variance = ((c / (c - 1)) * counts.reduce((sum, g) => sum + (g.k - p * g.n) ** 2, 0)) / n ** 2;
  const effective = variance > 0 ? Math.min(n, Math.max(1, (p * (1 - p)) / variance)) : n;
  const x = stats.betaQuantile(0.05, (c - 1) / 2, 0.5);
  const q = Math.sqrt(((c - 1) * (1 - x)) / x);
  const denominator = 1 + (q * q) / effective;
  const centre = (p + (q * q) / (2 * effective)) / denominator;
  const half = (q * Math.sqrt((p * (1 - p)) / effective + (q * q) / (4 * effective ** 2))) / denominator;
  return { n, k, estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/** The runs and successes of each golden (a line of the report) of runs, `success` deciding a success. */
function goldenCounts(runs: readonly RunResult[], success: (run: RunResult) => boolean) {
  return [...groups(runs, lineOf).values()].map((group) => ({
    n: group.length,
    k: group.filter(success).length,
  }));
}

function sameInterval(got: Partial<Interval> | undefined, want: Interval | undefined): boolean {
  if (!want) return got === undefined;
  return near(got?.estimate, want.estimate) && near(got?.lower, want.lower) && near(got?.upper, want.upper);
}
const iv = (value: Partial<Interval> | undefined) =>
  value ? `${value.estimate} [${value.lower}, ${value.upper}]` : 'none';

/** The spec blocks of a run: every block but one a driver injected (the run's perturbation id). */
const specBlocksOf = (run: RunResult) =>
  run.blocks.filter(
    (block) =>
      !(block.injected === true && run.perturbationId !== undefined && block.blockId === run.perturbationId),
  );

type Check = (
  fx: Fixture,
  ctx: { seed: number; root: string; scratch: string },
) => Promise<string | undefined> | string | undefined;

function item(
  slug: string,
  family: 'claim-report' | 'report-brute-force',
  tier: Tier,
  component: string,
  title: string,
  cause: string,
  check: Check,
  source: ItemSource = family === 'report-brute-force' ? 'differential' : 'contract',
): BankItem {
  return {
    id: `claim/report/${slug}`,
    family,
    tier,
    level: 8,
    component,
    source,
    title,
    cause,
    async check(ctx) {
      const problem = await check(await fixture(ctx.seed), ctx);
      return problem === undefined ? PASS : fail(problem);
    },
  };
}

const cards = new WeakMap<Fixture, report.Scorecard>();
function cardOf(fx: Fixture): report.Scorecard {
  let held = cards.get(fx);
  if (!held) {
    held = report.buildScorecard(fx.base);
    cards.set(fx, held);
  }
  return held;
}
const compared = new WeakMap<Fixture, report.CompareResult>();
function compareOf(fx: Fixture): report.CompareResult {
  let held = compared.get(fx);
  if (!held) {
    held = report.compareCampaigns(fx.base, fx.cand, { margin: 0.1 });
    compared.set(fx, held);
  }
  return held;
}

// ---------------------------------------------------------------------------------------------------
// The campaign header and the run rule.

function campaignItems(): BankItem[] {
  return [
    item(
      'campaign-runs',
      'report-brute-force',
      1,
      SC,
      'buildScorecard counts one run per stored cell (data.ts: "the run that stands for each cell")',
      'buildScorecard counts every stored cell of the campaign once in campaign.runs.',
      (fx) => {
        const want = new Set(fx.rawBase.map((run) => run.runId)).size;
        const got = cardOf(fx).campaign.runs;
        return got === want ? undefined : `campaign.runs is ${got}, expected ${want} distinct stored cells`;
      },
    ),
    item(
      'campaign-passing',
      'report-brute-force',
      1,
      SC,
      'campaign.passing is the number of stored runs that completed with every block passing and the end state matched',
      'buildScorecard counts as passing exactly the runs that completed with every block passing and no end state mismatch.',
      (fx) => {
        const want = fx.rawBase.filter(passes).length;
        const got = cardOf(fx).campaign.passing;
        return got === want
          ? undefined
          : `campaign.passing is ${got}, expected ${want} recounted from the stored runs`;
      },
    ),
    item(
      'campaign-failing',
      'report-brute-force',
      1,
      SC,
      'campaign.failing counts the runs that completed and did not pass',
      'buildScorecard counts as failing the completed runs that do not pass, and nothing else.',
      (fx) => {
        const want = fx.rawBase.filter((run) => run.status === 'completed' && !passes(run)).length;
        const got = cardOf(fx).campaign.failing;
        return got === want ? undefined : `campaign.failing is ${got}, expected ${want}`;
      },
    ),
    item(
      'campaign-broken',
      'report-brute-force',
      1,
      SC,
      'campaign.broken counts the runs that did not complete (failed or stopped); one planted run throws',
      'buildScorecard counts in campaign.broken every run whose status is not completed.',
      (fx) => {
        const want = fx.rawBase.filter((run) => run.status !== 'completed').length;
        const got = cardOf(fx).campaign.broken;
        return got === want && want === 1
          ? undefined
          : `campaign.broken is ${got}, expected ${want} (one planted failure)`;
      },
    ),
    item(
      'campaign-targets',
      'claim-report',
      2,
      DATA,
      'campaign.targets shows each target as adapter:agent, with the variant in brackets (data.ts showTarget)',
      'showTarget writes adapter:agent and adds "variant <v>" in brackets when the target names a variant.',
      (fx) => {
        const want = ['function:planted', 'function:planted (variant b)'];
        const got = [...cardOf(fx).campaign.targets].sort();
        return show(got) === show(want) ? undefined : `targets ${show(got)}, expected ${show(want)}`;
      },
    ),
    item(
      'campaign-record-facts',
      'claim-report',
      1,
      SC,
      'the scorecard header copies the campaign record: id, creation time, modes, repeats per mode, budget, pinned specs',
      'buildScorecard copies campaignId, createdAt, modes, repeats, budgetUsd and the pinned spec count from the campaign record.',
      (fx) => {
        const c = cardOf(fx).campaign;
        const want = {
          campaignId: 'c-base',
          createdAt: CREATED_BASE,
          modes: ['T', 'F', 'P'],
          repeats: { T: 3, F: 3, P: 2 },
          budgetUsd: 1,
          specs: 4,
        };
        const got = {
          campaignId: c.campaignId,
          createdAt: c.createdAt,
          modes: c.modes,
          repeats: c.repeats,
          budgetUsd: c.budgetUsd,
          specs: c.specs,
        };
        return show(got) === show(want) ? undefined : `header ${show(got)}, expected ${show(want)}`;
      },
    ),
    item(
      'run-passed-end-state',
      'claim-report',
      2,
      DATA,
      'runPassed: a completed run whose blocks all pass but whose end state does not match fails ("the end state matched")',
      'runPassed returns false for a run whose end state does not match even when every block passed.',
      (fx) => {
        const clean = fx.rawBase.find((run) => passes(run) && run.endState?.match === true);
        if (!clean) return 'the fixture holds no passing run with an end state';
        const mismatched: RunResult = {
          ...clean,
          endState: { match: false, diff: [{ field: 'step', expected: 5, observed: 4 }] },
        };
        return report.runPassed(mismatched) === false && report.runPassed(clean) === true
          ? undefined
          : `runPassed gives ${report.runPassed(mismatched)} on a mismatched end state and ${report.runPassed(clean)} on the clean run, expected false and true`;
      },
    ),
    item(
      'run-passed-no-block',
      'claim-report',
      2,
      DATA,
      'runPassed: a completed run that ran no block does not pass, and its block score is 0 ("ran a block")',
      'runPassed returns false and blockScore returns 0 for a completed run with no block.',
      (fx) => {
        const empty: RunResult = { ...(fx.rawBase[0] as RunResult), status: 'completed', blocks: [] };
        delete (empty as { endState?: unknown }).endState;
        return report.runPassed(empty) === false && report.blockScore(empty) === 0
          ? undefined
          : `runPassed ${report.runPassed(empty)}, blockScore ${report.blockScore(empty)} on a run with no block, expected false and 0`;
      },
    ),
    item(
      'rate-wilson',
      'claim-report',
      1,
      EST,
      'rate(k, n) is k of n with the Wilson interval, undefined when n is 0 (estimate.ts)',
      'rate returns k, n and the Wilson bounds of k of n, and undefined for n 0.',
      () => {
        for (const [k, n] of [
          [0, 1],
          [3, 7],
          [5, 5],
          [17, 40],
        ] as const) {
          const got = report.rate(k, n);
          const w = stats.wilson(k, n);
          if (!got || got.k !== k || got.n !== n || !sameInterval(got, w) || got.method !== 'wilson')
            return `rate(${k}, ${n}) is ${show(got)}, expected Wilson ${iv(w)}`;
        }
        return report.rate(0, 0) === undefined
          ? undefined
          : `rate(0, 0) is ${show(report.rate(0, 0))}, expected undefined`;
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// loadCampaign.

function loadItems(): BankItem[] {
  return [
    item(
      'load-missing-campaign',
      'claim-report',
      1,
      DATA,
      'loadCampaign throws ReportInputError for a campaign the store does not hold (the command line exits 2 on it)',
      'loadCampaign throws ReportInputError when the campaign id is not in the store.',
      async (fx) => {
        try {
          await report.loadCampaign(fx.store, 'c-absent');
          return 'loadCampaign returned for an absent campaign';
        } catch (cause) {
          return cause instanceof report.ReportInputError
            ? undefined
            : `threw ${(cause as Error).name}, expected ReportInputError`;
        }
      },
    ),
    item(
      'load-missing-spec',
      'claim-report',
      2,
      DATA,
      'loadCampaign throws ReportInputError when the campaign pins a spec hash the store does not hold',
      'loadCampaign throws ReportInputError when a pinned spec is missing from the store.',
      async (fx) => {
        await fx.store.putCampaign({
          ...fx.base.campaign,
          campaignId: 'c-orphan',
          specs: [{ id: 'claim-report-ghost', hash: 'f'.repeat(12) }],
        });
        try {
          await report.loadCampaign(fx.store, 'c-orphan');
          return 'loadCampaign returned for a campaign whose spec is missing';
        } catch (cause) {
          return cause instanceof report.ReportInputError
            ? undefined
            : `threw ${(cause as Error).name}, expected ReportInputError`;
        }
      },
    ),
    item(
      'load-latest',
      'claim-report',
      2,
      DATA,
      'loadCampaign without an id reads the latest campaign of the store (c-cand, created six hours after c-base)',
      'loadCampaign without an id picks the campaign with the latest createdAt.',
      async (fx) => {
        const scratch = openMemoryStore();
        for (const def of fx.specs) {
          const loaded = validateSpec(def.flow.spec, 'claim-report');
          if (loaded.ok) await scratch.putSpec(loaded);
        }
        await scratch.putCampaign(fx.cand.campaign);
        await scratch.putCampaign(fx.base.campaign);
        const got = (await report.loadCampaign(scratch)).campaign.campaignId;
        await scratch.close();
        return got === 'c-cand'
          ? undefined
          : `loadCampaign() read ${got}, expected c-cand (createdAt ${CREATED_CAND})`;
      },
    ),
    item(
      'load-run-order',
      'claim-report',
      2,
      DATA,
      'loadCampaign sorts runs by the campaign spec order, then target, mode T F P, perturbation and repeat',
      'loadCampaign sorts the runs by spec order, target, mode in the order T F P, perturbation, then repeat.',
      (fx) => {
        const want = ordered(fx.rawBase, fx.base).map((run) => run.runId);
        const got = fx.base.runs.map((run) => run.runId);
        const at = want.findIndex((id, index) => got[index] !== id);
        return at < 0 && got.length === want.length
          ? undefined
          : `run ${at} is ${got[at]}, expected ${want[at]} by the documented order`;
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Reliability lines (P4.2).

function lineCheck(
  fx: Fixture,
  each: (line: report.ReliabilityLine, runs: RunResult[]) => string | undefined,
): string | undefined {
  const truth = groups(ordered(fx.rawBase, fx.base), lineOf);
  const lines = cardOf(fx).lines;
  if (lines.length !== truth.size) return `${lines.length} lines, expected ${truth.size}`;
  for (const line of lines) {
    const key = [
      line.specId,
      line.specHash,
      canonicalJson(line.target),
      line.mode,
      line.perturbationId ?? '',
    ].join('|');
    const runs = truth.get(key);
    if (!runs) return `a line ${key} with no stored runs`;
    const problem = each(line, runs);
    if (problem) return `line ${line.specId} ${line.mode} ${targetText(line.target)}: ${problem}`;
  }
  return undefined;
}

function lineItems(): BankItem[] {
  const atK =
    (which: 'passK' | 'passAtK', exact: (c: number, n: number, k: number) => number) =>
    (line: report.ReliabilityLine, runs: RunResult[]) => {
      const c = runs.filter(passes).length;
      const want = runs.map((_, index) => exact(c, runs.length, index + 1));
      const got = line[which].map((entry) => entry.value);
      return got.length === want.length && got.every((value, index) => near(value, want[index]))
        ? undefined
        : `${which} ${show(got)}, expected ${show(want)} with c ${c} of n ${runs.length}`;
    };
  // statistics.md: the interval is the Wilson bounds of the per-run rate put through k, widened so that it
  // contains the value. Runs that did not complete count as failing in the value, and the interval also covers
  // both ends, all of them failing and all of them passing: the exact estimator at c and at c plus them.
  const bounds =
    (
      which: 'passK' | 'passAtK',
      raise: (p: number, k: number) => number,
      exact: (c: number, n: number, k: number) => number,
    ) =>
    (line: report.ReliabilityLine, runs: RunResult[]) => {
      const c = runs.filter(passes).length;
      const n = runs.length;
      const incomplete = runs.filter((run) => run.status !== 'completed').length;
      const w = stats.wilson(c, n);
      for (const entry of line[which]) {
        // Widened where needed so that it contains the value (statistics.md, "Intervals on pass^k and pass@k").
        let lower = Math.min(raise(w.lower, entry.k), exact(c, n, entry.k));
        let upper = Math.max(raise(w.upper, entry.k), exact(c, n, entry.k));
        if (incomplete > 0) {
          lower = Math.min(lower, exact(c, n, entry.k));
          upper = Math.max(upper, exact(Math.min(n, c + incomplete), n, entry.k));
        }
        if (!near(entry.lower, lower) || !near(entry.upper, upper))
          return `${which} at k ${entry.k} has [${entry.lower}, ${entry.upper}], expected [${lower}, ${upper}] (${incomplete} incomplete of ${n})`;
      }
      return undefined;
    };
  return [
    item(
      'line-grouping',
      'claim-report',
      2,
      REL,
      'reliability gives one line per spec, target and mode (one perturbation in P), holding its repeats',
      'reliability groups runs into one line per spec, hash, target, mode and perturbation.',
      (fx) =>
        lineCheck(fx, (line, runs) =>
          line.runs === runs.length ? undefined : `runs ${line.runs}, expected ${runs.length}`,
        ),
    ),
    item(
      'line-pass-count',
      'report-brute-force',
      1,
      REL,
      'each line passRate holds k passing of n repeats, recounted from the stored runs',
      'reliability counts in passRate.k the line repeats that pass and in passRate.n every repeat.',
      (fx) =>
        lineCheck(fx, (line, runs) => {
          const k = runs.filter(passes).length;
          return line.passRate.k === k && line.passRate.n === runs.length
            ? undefined
            : `passRate ${line.passRate.k} of ${line.passRate.n}, expected ${k} of ${runs.length}`;
        }),
    ),
    item(
      'line-pass-wilson',
      'report-brute-force',
      2,
      REL,
      'each line pass rate carries the Wilson interval of k of n (docs/concepts/statistics.md, wilson)',
      'reliability puts the Wilson interval of the line pass count on passRate.',
      (fx) =>
        lineCheck(fx, (line, runs) => {
          const w = stats.wilson(runs.filter(passes).length, runs.length);
          return sameInterval(line.passRate, w)
            ? undefined
            : `passRate ${iv(line.passRate)}, expected ${iv(w)}`;
        }),
    ),
    item(
      'line-pass-hat-k',
      'report-brute-force',
      2,
      REL,
      'pass^k of a line, k from 1 to its repeats, is C(c, k) / C(n, k) (statistics.md, passK)',
      'reliability gives pass^k for every k from 1 to the line repeats with the passK estimator.',
      (fx) => lineCheck(fx, atK('passK', stats.passK)),
    ),
    item(
      'line-pass-at-k',
      'report-brute-force',
      2,
      REL,
      'pass@k of a line, k from 1 to its repeats, is 1 - C(n - c, k) / C(n, k) (statistics.md, passAtK)',
      'reliability gives pass@k for every k from 1 to the line repeats with the passAtK estimator.',
      (fx) => lineCheck(fx, atK('passAtK', stats.passAtK)),
    ),
    item(
      'line-pass-hat-k-bounds',
      'report-brute-force',
      3,
      REL,
      'the pass^k bounds are the Wilson bounds of the per-run rate raised to k, widened to hold the value and the incomplete runs (statistics.md)',
      'reliability raises the Wilson bounds of the line pass rate to the power k for pass^k.',
      (fx) =>
        lineCheck(
          fx,
          bounds('passK', (p, k) => p ** k, stats.passK),
        ),
    ),
    item(
      'line-pass-at-k-bounds',
      'report-brute-force',
      3,
      REL,
      'the pass@k bounds are 1 - (1 - bound)^k of the Wilson bounds of the per-run rate, widened to hold the value and the incomplete runs (statistics.md)',
      'reliability maps the Wilson bounds of the line pass rate through 1 - (1 - p)^k for pass@k.',
      (fx) =>
        lineCheck(
          fx,
          bounds('passAtK', (p, k) => 1 - (1 - p) ** k, stats.passAtK),
        ),
    ),
    item(
      'line-pass-k-inside',
      'claim-report',
      4,
      REL,
      'every pass^k and pass@k value lies inside its own reported interval (statistics.md: "reports every rate with an interval")',
      'reliability gives pass^k and pass@k intervals that contain their own point values.',
      (fx) =>
        lineCheck(fx, (line) => {
          for (const [name, list] of [
            ['pass^', line.passK],
            ['pass@', line.passAtK],
          ] as const) {
            const out = list.find(
              (entry) => entry.value < entry.lower - 1e-12 || entry.value > entry.upper + 1e-12,
            );
            if (out)
              return `${name}${out.k} is ${out.value} outside its interval [${out.lower}, ${out.upper}] (c ${line.passRate.k} of n ${line.passRate.n})`;
          }
          return undefined;
        }),
      'adversarial',
    ),
    item(
      'line-unreliability',
      'report-brute-force',
      2,
      REL,
      'unreliability of a line is p90 minus p10 of the block score (share of passing blocks) across repeats',
      'reliability computes unreliability as stats.unreliability over each repeat block score.',
      (fx) =>
        lineCheck(fx, (line, runs) => {
          const scores = runs.map((run) =>
            run.blocks.length === 0 ? 0 : run.blocks.filter((block) => block.pass).length / run.blocks.length,
          );
          const want = stats.unreliability(scores);
          return near(line.unreliability.estimate, want)
            ? undefined
            : `unreliability ${line.unreliability.estimate}, expected ${want} from scores ${show(scores)}`;
        }),
    ),
    item(
      'line-unreliability-inside',
      'claim-report',
      4,
      REL,
      'the unreliability estimate lies inside its own bootstrap interval',
      'reliability gives unreliability an interval that contains its point estimate.',
      (fx) =>
        lineCheck(fx, (line) => {
          const u = line.unreliability;
          return u.estimate >= u.lower - 1e-12 && u.estimate <= u.upper + 1e-12
            ? undefined
            : `unreliability ${u.estimate} outside [${u.lower}, ${u.upper}]`;
        }),
      'adversarial',
    ),
    item(
      'line-block-accuracy',
      'report-brute-force',
      2,
      REL,
      'line block accuracy is the share of passing blocks, blocks pooled, one run one cluster',
      'reliability gives blockAccuracy as passing blocks over all blocks of the line, clustered by run.',
      (fx) =>
        lineCheck(fx, (line, runs) => {
          const values: number[] = [];
          const clusters: number[] = [];
          runs.forEach((run, index) => {
            for (const block of run.blocks) {
              values.push(block.pass ? 1 : 0);
              clusters.push(index);
            }
          });
          const want = clusteredTruth(values, clusters, true);
          return sameInterval(line.blockAccuracy, want)
            ? undefined
            : `blockAccuracy ${iv(line.blockAccuracy)}, expected ${iv(want)}`;
        }),
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Succession and drift (docs/concepts/drift.md: a failing block is a drift block).

function successionCheck(
  fx: Fixture,
  each: (summary: report.SuccessionSummary, runs: RunResult[]) => string | undefined,
) {
  return lineCheck(fx, (line, runs) => each(line.succession, runs));
}

function successionItems(): BankItem[] {
  return [
    item(
      'drift-classes',
      'report-brute-force',
      1,
      SC,
      'scorecard.drift counts the blocks carrying each drift class over every run',
      'buildScorecard counts, per drift class, the blocks of every run that carry it.',
      (fx) => {
        const want: Partial<Record<DriftClass, number>> = {};
        for (const run of fx.rawBase)
          for (const block of run.blocks) for (const cls of block.drift) want[cls] = (want[cls] ?? 0) + 1;
        const sort = (value: object) => Object.fromEntries(Object.entries(value).sort());
        return show(sort(cardOf(fx).drift)) === show(sort(want))
          ? undefined
          : `drift ${show(sort(cardOf(fx).drift))}, expected ${show(sort(want))}`;
      },
    ),
    item(
      'first-drift-histogram',
      'report-brute-force',
      2,
      REL,
      'the first-drift table of a line counts runs by the index of their first failing block (drift.md firstDriftBlock)',
      'successionOf counts the runs of a line by the index of their first failing block, never-failing runs as none.',
      (fx) =>
        successionCheck(fx, (summary, runs) => {
          const counts = new Map<string, number>();
          for (const run of runs) {
            const at = String(firstFailing(run) ?? 'none');
            counts.set(at, (counts.get(at) ?? 0) + 1);
          }
          const got = new Map(summary.firstDrift.map((entry) => [String(entry.block), entry.runs]));
          const same = got.size === counts.size && [...counts].every(([key, n]) => got.get(key) === n);
          return same ? undefined : `firstDrift ${show(summary.firstDrift)}, expected ${show([...counts])}`;
        }),
    ),
    item(
      'drift-count-mean',
      'report-brute-force',
      2,
      REL,
      'the line drift count is the mean number of failing blocks per run (drift.md driftCount)',
      'successionOf averages the failing blocks per run of the line into driftCount.',
      (fx) =>
        successionCheck(fx, (summary, runs) => {
          const want = meanOf(runs.map(failingBlocks));
          return near(summary.driftCount?.estimate, want)
            ? undefined
            : `driftCount ${summary.driftCount?.estimate}, expected ${want}`;
        }),
    ),
    item(
      'drift-rate-pooled',
      'report-brute-force',
      2,
      REL,
      'the line drift rate is the share of failing blocks, blocks pooled (drift.md: driftRate = driftCount / blocks)',
      'successionOf pools the failing blocks of the line over its blocks for driftRate.',
      (fx) =>
        successionCheck(fx, (summary, runs) => {
          const blocks = runs.reduce((sum, run) => sum + run.blocks.length, 0);
          const want = runs.reduce((sum, run) => sum + failingBlocks(run), 0) / blocks;
          return near(summary.driftRate?.estimate, want)
            ? undefined
            : `driftRate ${summary.driftRate?.estimate}, expected ${want}`;
        }),
    ),
    item(
      'longest-clean-mean',
      'report-brute-force',
      2,
      REL,
      'the line longest clean is the mean over runs of the longest stretch of passing blocks',
      'successionOf averages the longest stretch of passing blocks of each run.',
      (fx) =>
        successionCheck(fx, (summary, runs) => {
          const want = meanOf(runs.map(longestClean));
          return near(summary.longestClean, want)
            ? undefined
            : `longestClean ${summary.longestClean}, expected ${want}`;
        }),
    ),
    item(
      'all-blocks-pass',
      'report-brute-force',
      2,
      REL,
      'allBlocksPass of a line is the Wilson rate of runs whose every block passed (drift.md minOverBlocks)',
      'successionOf counts in allBlocksPass the runs whose blocks all pass, with the Wilson interval.',
      (fx) =>
        successionCheck(fx, (summary, runs) => {
          const k = runs.filter(
            (run) => run.blocks.length > 0 && run.blocks.every((block) => block.pass),
          ).length;
          const w = stats.wilson(k, runs.length);
          return summary.allBlocksPass?.k === k && sameInterval(summary.allBlocksPass, w)
            ? undefined
            : `allBlocksPass ${summary.allBlocksPass?.k} ${iv(summary.allBlocksPass)}, expected ${k} ${iv(w)}`;
        }),
    ),
    item(
      'succession-record',
      'report-brute-force',
      3,
      SUCCESSION,
      'every stored succession record matches its blocks: first failing block, failing count, rate, longest clean, all pass',
      'succession derives firstDriftBlock, driftCount, driftRate, longestClean and minOverBlocks from the block pass flags.',
      (fx) => {
        for (const run of fx.rawBase) {
          const s = run.succession;
          const failing = failingBlocks(run);
          const want = {
            first: firstFailing(run) ?? null,
            count: failing,
            rate: run.blocks.length === 0 ? 0 : failing / run.blocks.length,
            clean: longestClean(run),
            all: run.blocks.length > 0 && failing === 0,
          };
          const got = {
            first: s.firstDriftBlock ?? null,
            count: s.driftCount,
            rate: s.driftRate,
            clean: s.longestClean,
            all: s.minOverBlocks,
          };
          if (show(got) !== show(want))
            return `run ${run.specId} ${run.mode} ${run.repeat}: ${show(got)}, expected ${show(want)}`;
        }
        return undefined;
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Recovery (docs/concepts/recovery.md) over the perturbed runs.

function recoveryItems(): BankItem[] {
  const perturbed = (fx: Fixture) => fx.rawBase.filter((run) => run.mode === 'P' && run.recovery);
  const rateItem = (
    slug: string,
    field: 'immediate' | 'recovered' | 'safeAction' | 'clarified',
    title: string,
    cause: string,
    count: (records: NonNullable<RunResult['recovery']>[]) => [number, number],
  ) =>
    item(slug, 'report-brute-force', 2, REL, title, cause, (fx) => {
      const records = perturbed(fx).map((run) => run.recovery as NonNullable<RunResult['recovery']>);
      const [k, n] = count(records);
      const got = cardOf(fx).recovery?.[field];
      const w = stats.wilson(k, n);
      return got?.k === k && got.n === n && sameInterval(got, w)
        ? undefined
        : `recovery.${field} ${got?.k} of ${got?.n} ${iv(got)}, expected ${k} of ${n} ${iv(w)}`;
    });
  return [
    item(
      'recovery-labels',
      'report-brute-force',
      1,
      REL,
      'recovery.labels counts the perturbed runs labelled immediate, late and never',
      'recoveryOf counts the stored labels immediate, late and never of the perturbed runs.',
      (fx) => {
        const want = { immediate: 0, late: 0, never: 0 };
        for (const run of perturbed(fx))
          want[(run.recovery as NonNullable<RunResult['recovery']>).label] += 1;
        const got = cardOf(fx).recovery?.labels;
        return show(got) === show(want) && want.immediate > 0 && want.late > 0 && want.never > 0
          ? undefined
          : `labels ${show(got)}, expected ${show(want)} with each label planted`;
      },
    ),
    rateItem(
      'recovery-immediate-rate',
      'immediate',
      'recovery.immediate is the Wilson rate of runs labelled immediate over the measured runs',
      'recoveryOf rates the immediate labels over the measured runs with the Wilson interval.',
      (records) => [records.filter((r) => r.label === 'immediate').length, records.length],
    ),
    rateItem(
      'recovery-safe-action-rate',
      'safeAction',
      'recovery.safeAction is the Wilson rate of runs with no forbidden or unnamed consequential act in the detour',
      'recoveryOf rates the safe-action flags over the runs that record one.',
      (records) => {
        const decided = records.filter((r) => r.safeAction !== undefined);
        return [decided.filter((r) => r.safeAction).length, decided.length];
      },
    ),
    item(
      'recovery-median-turns',
      'report-brute-force',
      2,
      REL,
      'recovery.medianTurns is the median blocks to recover over the runs that came back',
      'recoveryOf takes the median of turnsToRecover over the immediate and late runs.',
      (fx) => {
        const turns = perturbed(fx).flatMap((run) =>
          run.recovery?.label !== 'never' && run.recovery?.turnsToRecover !== undefined
            ? [run.recovery.turnsToRecover]
            : [],
        );
        const want = medianOf(turns);
        const got = cardOf(fx).recovery?.medianTurns;
        return near(got, want) ? undefined : `medianTurns ${got}, expected ${want} over ${show(turns)}`;
      },
    ),
    item(
      'recovery-collateral',
      'report-brute-force',
      2,
      REL,
      'recovery.collateral is the mean collateral per measured run, one run one cluster',
      'recoveryOf averages the collateral of the measured runs with a run-clustered bootstrap.',
      (fx) => {
        const runs = ordered(perturbed(fx), fx.base);
        const values = runs.map((run) => run.recovery?.collateral ?? 0);
        const want = clusteredTruth(
          values,
          values.map((_, index) => index),
        );
        const got = cardOf(fx).recovery?.collateral;
        return sameInterval(got, want) ? undefined : `collateral ${iv(got)}, expected ${iv(want)}`;
      },
    ),
    item(
      'recovery-by-class',
      'claim-report',
      2,
      SC,
      'recoveryByClass gives one summary per deviation class of the perturbed runs, in class order',
      'buildScorecard groups the measured perturbed runs by the deviation class their spec gives them.',
      (fx) => {
        const byClass = cardOf(fx).recoveryByClass;
        const measured = perturbed(fx).length;
        return byClass.length === 1 &&
          byClass[0]?.deviation === 'D1_off_topic' &&
          byClass[0].summary.measured === measured
          ? undefined
          : `recoveryByClass ${show(byClass.map((entry) => [entry.deviation, entry.summary.measured]))}, expected [["D1_off_topic", ${measured}]]`;
      },
    ),
    item(
      'recovery-from-blocks',
      'report-brute-force',
      3,
      RECOVERY,
      'each stored recovery label and turns to recover match the blocks: the first block from the injection that passes at its target stage, labelled against within_blocks',
      'recoveryOf labels a perturbed run by the first block from the injected one that passes and reaches its target stage.',
      (fx) => {
        for (const run of perturbed(fx)) {
          const def = fx.specs.find((entry) => entry.flow.spec.id === run.specId);
          const k = run.blocks.findIndex(
            (block) => block.injected === true && block.blockId === run.perturbationId,
          );
          if (!def || k < 0) return `run ${run.specId} ${run.repeat}: no injected block`;
          const pending = def.flow.truths[1]?.stage;
          let at: number | undefined;
          for (let position = k; position < run.blocks.length; position += 1) {
            const block = run.blocks[position] as RunResult['blocks'][number];
            const target = position === k ? pending : def.flow.truths[position - 1]?.stage;
            if (block.pass && block.stageObserved === target) {
              at = position;
              break;
            }
          }
          const turns = at === undefined ? undefined : at - k;
          // docs/concepts/recovery.md "The label rule": immediate within recovery.within_blocks, late after.
          const within =
            (def.flow.spec.perturbations as Array<{ id: string; recovery?: { within_blocks: number } }>).find(
              (entry) => entry.id === run.perturbationId,
            )?.recovery?.within_blocks ?? 0;
          const label = turns === undefined ? 'never' : turns <= within ? 'immediate' : 'late';
          if (run.recovery?.label !== label || run.recovery.turnsToRecover !== turns)
            return `run ${run.specId} P ${run.repeat}: label ${run.recovery?.label} turns ${run.recovery?.turnsToRecover}, expected ${label} ${turns}`;
        }
        return undefined;
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Per mode, end state, tools, cost, compounding.

function modeItems(): BankItem[] {
  const modeCheck = (
    fx: Fixture,
    each: (mode: report.ModeReliability, runs: RunResult[]) => string | undefined,
  ) => {
    const runs = ordered(fx.rawBase, fx.base);
    const modes = cardOf(fx).modes;
    const want = [...new Set(runs.map((run) => run.mode))].sort();
    if (show(modes.map((m) => m.mode).sort()) !== show(want))
      return `modes ${show(modes.map((m) => m.mode))}, expected ${show(want)}`;
    for (const mode of modes) {
      const problem = each(
        mode,
        runs.filter((run) => run.mode === mode.mode),
      );
      if (problem) return `mode ${mode.mode}: ${problem}`;
    }
    return undefined;
  };
  return [
    item(
      'mode-run-pass',
      'report-brute-force',
      2,
      REL,
      'runs passing per mode: share of passing runs, the repeats of one golden one cluster',
      'modeReliability gives runPass as the passing share of the mode runs, clustered by line.',
      (fx) =>
        modeCheck(fx, (mode, runs) => {
          const want = clusteredTruth(
            runs.map((run) => (passes(run) ? 1 : 0)),
            runs.map(lineOf),
            true,
          );
          return sameInterval(mode.runPass, want)
            ? undefined
            : `runPass ${iv(mode.runPass)}, expected ${iv(want)}`;
        }),
    ),
    item(
      'mode-pass-hat-k',
      'report-brute-force',
      3,
      REL,
      'the mode pass^k is the mean over its lines of pass^k at k = the smallest repeat count of the mode, at most 5',
      'modeReliability averages the line pass^k at k = min(5, the smallest line repeat count).',
      (fx) =>
        modeCheck(fx, (mode, runs) => {
          const lines = [...groups(runs, lineOf).values()];
          const k = Math.min(5, ...lines.map((line) => line.length));
          const want = meanOf(lines.map((line) => stats.passK(line.filter(passes).length, line.length, k)));
          return mode.passK?.k === k && near(mode.passK.mean, want)
            ? undefined
            : `passK ${show(mode.passK)}, expected k ${k} mean ${want}`;
        }),
    ),
    item(
      'end-state-rate',
      'report-brute-force',
      2,
      SC,
      'scorecard.endState is the rate of runs whose end state matched, over the runs that compared one, with the interval over goldens (docs/concepts/statistics.md, "A rate over goldens"); with one run per golden, the plain Wilson interval',
      'buildScorecard rates the matched end states over the runs that carry an end state, the runs of one golden being repeats.',
      (fx) => {
        const matched = (run: RunResult) => run.endState?.match === true;
        const check = (runs: readonly RunResult[], what: string) => {
          const compared = runs.filter((run) => run.endState !== undefined);
          const want = goldenRateTruth(goldenCounts(compared, matched));
          const got = report.buildScorecard({ ...fx.base, runs: [...runs] }).endState;
          return got?.k === want.k && got.n === want.n && sameInterval(got, want)
            ? undefined
            : `${what}: endState ${got?.k} of ${got?.n} ${iv(got)}, expected ${want.k} of ${want.n} ${iv(want)}`;
        };
        // Several runs per golden: the interval over goldens.
        const repeated = check(fx.rawBase, 'repeated goldens');
        if (repeated) return repeated;
        // One run per golden: the goldens are the runs, so the plain Wilson interval of k of n.
        const first = [...groups(fx.rawBase, lineOf).values()].map((group) => group[0] as RunResult);
        const compared = first.filter((run) => run.endState !== undefined);
        const k = compared.filter(matched).length;
        const single = check(first, 'one run per golden');
        if (single) return single;
        const got = report.buildScorecard({ ...fx.base, runs: first }).endState;
        return sameInterval(got, stats.wilson(k, compared.length))
          ? undefined
          : `one run per golden: endState ${iv(got)}, expected the Wilson interval ${iv(stats.wilson(k, compared.length))}`;
      },
    ),
  ];
}

function toolTruth(fx: Fixture) {
  let matched = 0;
  let expected = 0;
  let observed = 0;
  for (const run of fx.rawBase) {
    for (const block of specBlocksOf(run)) {
      // Every planted spec block expects one call of the lookup.
      expected += 1;
      const lookups = block.observed.toolCalls.filter((call) => call.label === LOOKUP).length;
      matched += Math.min(1, lookups);
      observed += block.observed.toolCalls.length;
    }
  }
  return { matched, expected, observed };
}

function toolItems(): BankItem[] {
  return [
    item(
      'tools-counts',
      'report-brute-force',
      2,
      SC,
      'tool accuracy counts expected calls, observed calls and matched calls (per label the smaller count) over the spec blocks',
      'toolAccuracy counts expected, observed and matched calls over every spec block that lists its tools.',
      (fx) => {
        const want = toolTruth(fx);
        const t = cardOf(fx).tools;
        const got = { matched: t.matched, expected: t.expected, observed: t.observed };
        return show(got) === show(want) ? undefined : `tools ${show(got)}, expected ${show(want)}`;
      },
    ),
    item(
      'tools-f1',
      'report-brute-force',
      3,
      SC,
      'tool F1 is the harmonic mean of the pooled precision and recall',
      'toolAccuracy computes F1 as 2 p r / (p + r) of the pooled precision and recall.',
      (fx) => {
        const t = toolTruth(fx);
        const p = t.matched / t.observed;
        const r = t.matched / t.expected;
        const want = (2 * p * r) / (p + r);
        const got = cardOf(fx).tools.f1?.estimate;
        return near(got, want) ? undefined : `f1 ${got}, expected ${want}`;
      },
    ),
  ];
}

function costItems(): BankItem[] {
  const blocksOf = (fx: Fixture) =>
    ordered(fx.rawBase, fx.base).flatMap((run, index) =>
      run.cacheHit ? [] : run.blocks.map((block) => ({ block, index })),
    );
  return [
    item(
      'cost-total',
      'report-brute-force',
      1,
      SC,
      'cost.totalUsd is the sum of what every block of every live run cost',
      'buildScorecard sums the block costs of every run that was not replayed from the cache.',
      (fx) => {
        const want = blocksOf(fx).reduce((sum, { block }) => sum + (block.observed.cost.usd ?? 0), 0);
        const got = cardOf(fx).cost.totalUsd;
        return Math.abs(got - want) < 1e-9 ? undefined : `totalUsd ${got}, expected ${want}`;
      },
    ),
    item(
      'latency-per-block',
      'report-brute-force',
      2,
      SC,
      'latency per block is the mean block latency with a run-clustered bootstrap',
      'buildScorecard averages the block latencies with a bootstrap clustered by run.',
      (fx) => {
        const entries = blocksOf(fx);
        const want = clusteredTruth(
          entries.map(({ block }) => block.observed.latencyMs),
          entries.map(({ index }) => index),
        );
        const got = cardOf(fx).cost.latencyMsPerBlock;
        return sameInterval(got, want) ? undefined : `latencyMsPerBlock ${iv(got)}, expected ${iv(want)}`;
      },
    ),
  ];
}

function compoundTruth(fx: Fixture) {
  const runs = ordered(fx.rawBase, fx.base).filter((run) => run.mode === 'T' || run.mode === 'F');
  const out: Array<{
    key: string;
    specId: string;
    diffs: number[];
    blocks: number[];
    passT: number[];
    passF: number[];
  }> = [];
  for (const [key, group] of groups(
    runs,
    (run) => `${run.specId}|${run.specHash}|${canonicalJson(run.target)}`,
  )) {
    const rates = (mode: RunMode) => {
      const m = new Map<number, [number, number]>();
      for (const run of group.filter((each) => each.mode === mode))
        run.blocks.forEach((block, index) => {
          const held = m.get(index) ?? [0, 0];
          m.set(index, [held[0] + (block.pass ? 1 : 0), held[1] + 1]);
        });
      return m;
    };
    const t = rates('T');
    const f = rates('F');
    const shared = [...t.keys()].filter((index) => f.has(index)).sort((a, b) => a - b);
    if (shared.length === 0) continue;
    const passT = shared.map(
      (index) => (t.get(index) as [number, number])[0] / (t.get(index) as [number, number])[1],
    );
    const passF = shared.map(
      (index) => (f.get(index) as [number, number])[0] / (f.get(index) as [number, number])[1],
    );
    out.push({
      key,
      specId: (group[0] as RunResult).specId,
      blocks: shared,
      passT,
      passF,
      diffs: passT.map((value, index) => value - (passF[index] as number)),
    });
  }
  return out;
}

function compoundItems(): BankItem[] {
  return [
    item(
      'compounding-spec-index',
      'report-brute-force',
      2,
      COMPOUND,
      'the compounding index of a spec is the mean over shared blocks of the T block pass rate minus the F one (run-modes.md); P runs ignored',
      'compoundingIndex averages per spec and target the T minus F block pass rate over the blocks both modes ran.',
      (fx) => {
        const truth = compoundTruth(fx);
        const lines = cardOf(fx).compounding.specs;
        if (lines.length !== truth.length)
          return `${lines.length} compounding lines, expected ${truth.length}`;
        for (const want of truth) {
          const line = lines.find((each) => `${each.specId}|${each.specHash}|${each.target}` === want.key);
          const index = meanOf(want.diffs);
          if (!line || !near(line.index, index))
            return `spec ${want.specId}: index ${line?.index}, expected ${index}`;
        }
        return truth.some((entry) => meanOf(entry.diffs) !== 0)
          ? undefined
          : 'no planted spec has a nonzero index';
      },
    ),
    item(
      'compounding-spec-interval',
      'report-brute-force',
      3,
      SC,
      'the interval on a spec compounding index is the bootstrap with the block as the resampling unit (run-modes.md)',
      'buildScorecard passes a bootstrap that resamples blocks within a spec as the compounding interval.',
      (fx) => {
        for (const want of compoundTruth(fx)) {
          const line = cardOf(fx).compounding.specs.find(
            (each) => `${each.specId}|${each.specHash}|${each.target}` === want.key,
          );
          const boot = stats.bootstrapCI(want.diffs, { clusters: want.blocks.map(String), seed: 1 });
          if (
            !line?.interval ||
            !near(line.interval.lower, boot.lower) ||
            !near(line.interval.upper, boot.upper)
          )
            return `spec ${want.specId}: interval ${iv(line?.interval)}, expected ${iv(boot)}`;
        }
        return undefined;
      },
    ),
    item(
      'compounding-overall',
      'report-brute-force',
      3,
      COMPOUND,
      'the overall compounding index is the mean T rate minus the mean F rate over every shared block of every spec, with the spec as the cluster',
      'compoundingIndex pools every shared block of every spec for the overall index and clusters its interval by spec.',
      (fx) => {
        const truth = compoundTruth(fx);
        const allT = truth.flatMap((entry) => entry.passT);
        const allF = truth.flatMap((entry) => entry.passF);
        const index = meanOf(allT) - meanOf(allF);
        const boot = stats.bootstrapCI(
          truth.flatMap((entry) => entry.diffs),
          { clusters: truth.flatMap((entry) => entry.diffs.map(() => entry.key)), seed: 1 },
        );
        const got = cardOf(fx).compounding.overall;
        return got &&
          near(got.index, index) &&
          got.blocks === allT.length &&
          got.interval &&
          near(got.interval.lower, boot.lower) &&
          near(got.interval.upper, boot.upper)
          ? undefined
          : `overall ${show(got)}, expected index ${index} over ${allT.length} blocks, interval ${iv(boot)}`;
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// The drilldown.

function drilldownItems(): BankItem[] {
  return [
    item(
      'drilldown-failing-first',
      'claim-report',
      1,
      SC,
      'the drilldown lists failing runs first, then passing ones (scorecard option maxRuns: "failing runs first")',
      'buildScorecard orders the drilldown with every failing run before every passing run.',
      (fx) => {
        const flags = cardOf(fx).drilldown.map((detail) => detail.pass);
        const firstPass = flags.indexOf(true);
        const ok = firstPass < 0 || flags.slice(firstPass).every(Boolean);
        const failing = fx.rawBase.filter((run) => !passes(run)).length;
        return ok && flags.filter((flag) => !flag).length === failing
          ? undefined
          : `drilldown pass flags ${flags.map((flag) => (flag ? 1 : 0)).join('')}, expected ${failing} failing first`;
      },
    ),
    item(
      'drilldown-injected-block',
      'claim-report',
      3,
      SC,
      'in the drilldown an injected block has no spec block, its stimulus is "[class] user text" and its expected stage the perturbation one',
      'buildScorecard marks a driver-injected block with its class-prefixed stimulus and the perturbation expected stage.',
      (fx) => {
        const detail = cardOf(fx).drilldown.find((entry) => entry.mode === 'P');
        if (!detail) return 'no perturbed run in the drilldown';
        const def = fx.specs.find((entry) => entry.flow.spec.id === detail.specId) as SpecDef;
        const injected = detail.blocks.filter((block) => block.injected);
        const block = injected[0];
        const want = `[D1_off_topic] ${def.injectionText}`;
        return injected.length === 1 &&
          block !== undefined &&
          block.specBlock === undefined &&
          block.stimulus === want &&
          block.expectedStage === def.flow.truths[1]?.stage
          ? undefined
          : `injected ${show(injected.map((b) => [b.specBlock, b.stimulus, b.expectedStage]))}, expected one block with ${want}`;
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Spread (the scorecard's spread view, mode F by default, one cell per spec without metadata).

function spreadItems(): BankItem[] {
  const fRuns = (fx: Fixture) => ordered(fx.rawBase, fx.base).filter((run) => run.mode === 'F');
  return [
    item(
      'spread-cells',
      'report-brute-force',
      2,
      SPREAD,
      'the spread reads mode F by default and gives one cell per spec, its rate the Wilson rate of its passing runs',
      'spread defaults to mode F and rates each spec cell as its passing runs over its runs.',
      (fx) => {
        const s = cardOf(fx).spread;
        if (s.mode !== 'F' || s.source !== 'spec')
          return `mode ${s.mode}, source ${s.source}, expected F and spec`;
        const truth = groups(fRuns(fx), (run) => run.specId);
        if (s.cells.length !== truth.size) return `${s.cells.length} cells, expected ${truth.size}`;
        for (const cell of s.cells) {
          const runs = truth.get(cell.cell) ?? [];
          const w = stats.wilson(runs.filter(passes).length, runs.length);
          if (cell.runs !== runs.length || !sameInterval(cell.rate, w))
            return `cell ${cell.cell}: ${cell.runs} runs ${iv(cell.rate)}, expected ${runs.length} ${iv(w)}`;
        }
        return undefined;
      },
    ),
    item(
      'spread-noise-floor',
      'report-brute-force',
      3,
      SPREAD,
      'the noise floor pools the within-line variance of the pass flag and gives z sqrt(2 variance / repeats) per golden',
      'spread pools the sample variance of the pass flags within each line of two runs or more for the noise floor.',
      (fx) => {
        let ss = 0;
        let df = 0;
        const sizes: number[] = [];
        for (const line of groups(fRuns(fx), lineOf).values()) {
          if (line.length < 2) continue;
          const flags = line.map((run) => (passes(run) ? 1 : 0));
          const m = meanOf(flags);
          ss += flags.reduce<number>((sum, value) => sum + (value - m) ** 2, 0);
          df += line.length - 1;
          sizes.push(line.length);
        }
        const variance = ss / df;
        const repeats = medianOf(sizes) as number;
        const perGolden = stats.Z95 * Math.sqrt((2 * variance) / repeats);
        const noise = cardOf(fx).spread.noise;
        return noise &&
          near(noise.variance, variance) &&
          near(noise.perGolden, perGolden) &&
          noise.lines === sizes.length
          ? undefined
          : `noise ${show(noise)}, expected variance ${variance}, perGolden ${perGolden} over ${sizes.length} lines`;
      },
    ),
    item(
      'spread-block-flip',
      'report-brute-force',
      3,
      SPREAD,
      'the block flip rate counts spec blocks whose pass flag differs across the repeats of a line',
      'spread counts the spec blocks whose pass flag differs across repeats over the blocks of lines with two repeats or more.',
      (fx) => {
        let flipping = 0;
        let blocks = 0;
        for (const line of groups(fRuns(fx), lineOf).values()) {
          if (line.length < 2) continue;
          const seen = new Map<number, Set<boolean>>();
          for (const run of line)
            specBlocksOf(run).forEach((block, index) => {
              seen.set(index, (seen.get(index) ?? new Set()).add(block.pass));
            });
          for (const set of seen.values()) {
            blocks += 1;
            if (set.size > 1) flipping += 1;
          }
        }
        const got = cardOf(fx).spread.noise?.blockFlip;
        return got?.k === flipping && got.n === blocks
          ? undefined
          : `blockFlip ${got?.k} of ${got?.n}, expected ${flipping} of ${blocks}`;
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// JUnit (junit.ts; examples/acme/reports/README.md: "one test suite per golden, one test case per run").

function junitItems(): BankItem[] {
  const xmlOf = (fx: Fixture) => report.renderJunit(fx.base);
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  return [
    item(
      'junit-totals',
      'report-brute-force',
      1,
      JUNIT,
      'the testsuites element counts tests (runs), failures (completed, not passing) and errors (did not complete)',
      'renderJunit writes the run count, the completed failing runs and the runs that did not complete on testsuites.',
      (fx) => {
        const tag = /<testsuites[^>]*>/.exec(xmlOf(fx))?.[0] ?? '';
        const want = {
          tests: String(fx.rawBase.length),
          failures: String(fx.rawBase.filter((run) => run.status === 'completed' && !passes(run)).length),
          errors: String(fx.rawBase.filter((run) => run.status !== 'completed').length),
        };
        const got = {
          tests: attr(tag, 'tests'),
          failures: attr(tag, 'failures'),
          errors: attr(tag, 'errors'),
        };
        return show(got) === show(want) ? undefined : `testsuites ${show(got)}, expected ${show(want)}`;
      },
    ),
    item(
      'junit-suite-per-golden',
      'claim-report',
      1,
      JUNIT,
      'one test suite per golden, its tests the runs of that golden, and one test case per run',
      'renderJunit writes one testsuite per spec id with one testcase per run of the spec.',
      (fx) => {
        const xml = xmlOf(fx);
        const truth = groups(fx.rawBase, (run) => run.specId);
        const suites = [...xml.matchAll(/<testsuite [^>]*>/g)].map((match) => match[0]);
        if (suites.length !== truth.size) return `${suites.length} test suites, expected ${truth.size}`;
        for (const tag of suites) {
          const runs = truth.get(attr(tag, 'name') ?? '') ?? [];
          if (attr(tag, 'tests') !== String(runs.length))
            return `suite ${attr(tag, 'name')}: tests ${attr(tag, 'tests')}, expected ${runs.length}`;
        }
        const cases = (xml.match(/<testcase /g) ?? []).length;
        return cases === fx.rawBase.length ? undefined : `${cases} test cases, expected ${fx.rawBase.length}`;
      },
    ),
    item(
      'junit-error',
      'claim-report',
      2,
      JUNIT,
      'a run that failed or was stopped is a JUnit error with its status as the type',
      'renderJunit writes an error element typed with the status for every run that did not complete.',
      (fx) => {
        const xml = xmlOf(fx);
        const errors = [...xml.matchAll(/<error type="([^"]*)"/g)].map((match) => match[1]);
        const want = fx.rawBase.filter((run) => run.status !== 'completed').map((run) => run.status);
        return show(errors.sort()) === show(want.sort())
          ? undefined
          : `error types ${show(errors)}, expected ${show(want)}`;
      },
    ),
    item(
      'junit-failure-count',
      'report-brute-force',
      2,
      JUNIT,
      'a failing run is a JUnit failure whose message counts its failing gating verdicts and end-state differences',
      'renderJunit opens each failure message with the number of failing gating verdicts plus end-state differences.',
      (fx) => {
        const xml = xmlOf(fx);
        const messages = [...xml.matchAll(/<failure type="fail" message="(\d+) failing: /g)]
          .map((match) => Number(match[1]))
          .sort((a, b) => a - b);
        const want = fx.rawBase
          .filter((run) => run.status === 'completed' && !passes(run))
          .map(
            (run) =>
              run.blocks.reduce(
                (sum, block) => sum + block.verdicts.filter((v) => v.gating && v.outcome !== 'pass').length,
                0,
              ) + (run.endState && !run.endState.match ? run.endState.diff.length : 0),
          )
          .sort((a, b) => a - b);
        return show(messages) === show(want)
          ? undefined
          : `failure counts ${show(messages)}, expected ${show(want)}`;
      },
    ),
    item(
      'junit-testcase-name',
      'claim-report',
      2,
      JUNIT,
      'each test case is named target, mode and repeat (and the perturbation in P), its class name the golden',
      'renderJunit names each testcase "<target> · <mode> · repeat <n>[ · <perturbation>]" under the spec class name.',
      (fx) => {
        const xml = xmlOf(fx);
        const esc = (text: string) =>
          text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        for (const run of fx.rawBase) {
          const name = [
            targetText(run.target),
            run.mode,
            `repeat ${run.repeat}`,
            ...(run.perturbationId ? [run.perturbationId] : []),
          ].join(' · ');
          if (!xml.includes(`<testcase classname="${esc(run.specId)}" name="${esc(name)}"`))
            return `no test case ${run.specId} / ${name}`;
        }
        return undefined;
      },
    ),
    item(
      'junit-time',
      'report-brute-force',
      2,
      JUNIT,
      'suite and total times are the summed run latencies in seconds with three decimals',
      'renderJunit writes the summed latency of the runs in seconds, three decimals, on each suite and the root.',
      (fx) => {
        const xml = xmlOf(fx);
        const total = (fx.rawBase.reduce((sum, run) => sum + run.latencyMs, 0) / 1000).toFixed(3);
        const root = attr(/<testsuites[^>]*>/.exec(xml)?.[0] ?? '', 'time');
        if (root !== total) return `testsuites time ${root}, expected ${total}`;
        for (const [specId, runs] of groups(fx.rawBase, (run) => run.specId)) {
          const want = (runs.reduce((sum, run) => sum + run.latencyMs, 0) / 1000).toFixed(3);
          if (
            !xml.includes(`<testsuite name="${specId}" tests="${runs.length}"`) ||
            !new RegExp(`<testsuite name="${specId}"[^>]*time="${want}"`).test(xml)
          )
            return `suite ${specId}: time is not ${want}`;
        }
        return undefined;
      },
    ),
    item(
      'junit-timestamp',
      'claim-report',
      1,
      JUNIT,
      'every suite timestamp is the campaign creation time, so the same store gives the same file',
      'renderJunit stamps every testsuite with the campaign createdAt and nothing that changes between renders.',
      async (fx) => {
        const xml = xmlOf(fx);
        const stamps = new Set([...xml.matchAll(/timestamp="([^"]*)"/g)].map((match) => match[1]));
        const again = report.renderJunit(await report.loadCampaign(fx.store, 'c-base'));
        return stamps.size === 1 && stamps.has(CREATED_BASE) && again === xml
          ? undefined
          : `timestamps ${show([...stamps])}, second render identical ${again === xml}`;
      },
    ),
    item(
      'junit-escaping',
      'claim-report',
      3,
      JUNIT,
      'a campaign id with markup characters and a control character gives well formed XML (XML 1.0 refuses control characters)',
      'renderJunit escapes markup characters and drops the control characters XML 1.0 refuses.',
      async (_fx, { seed }) => {
        const xml = report.renderJunit(await oddCampaign(seed));
        // biome-ignore lint/suspicious/noControlCharactersInRegex: the item looks for a control character.
        const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml);
        const bare = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(xml);
        const name = /<testsuites name="([^"]*)"/.exec(xml)?.[1];
        return !control && !bare && name === 'c-&lt;odd&amp;&quot;id&quot;&gt;'
          ? undefined
          : `control character ${control}, bare ampersand ${bare}, name ${name}`;
      },
      'hostile',
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// HTML (html.ts: "inline styles, no script, no external asset", "the same scorecard gives the same bytes").

function usdText(value: number): string {
  return `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function htmlItems(): BankItem[] {
  return [
    item(
      'html-deterministic',
      'claim-report',
      1,
      HTML,
      'the same scorecard gives the same bytes, also when the scorecard is built again from the store',
      'renderHtml and buildScorecard depend only on the stored campaign, never on a clock or a random draw.',
      async (fx) => {
        const first = report.renderHtml(cardOf(fx));
        const again = report.renderHtml(report.buildScorecard(await report.loadCampaign(fx.store, 'c-base')));
        return first === again ? undefined : 'two renders of the same stored campaign differ';
      },
    ),
    item(
      'html-self-contained',
      'claim-report',
      1,
      HTML,
      'the page carries no script and no external asset',
      'renderHtml writes no script element and no reference to a remote file.',
      (fx) => {
        const html = report.renderHtml(cardOf(fx));
        const bad = /<script|<link\b|\b(?:src|href)="(?:https?:)?\/\//i.exec(html);
        return bad ? `the page holds ${bad[0]}` : undefined;
      },
      'hostile',
    ),
    item(
      'html-runs-fact',
      'report-brute-force',
      1,
      HTML,
      'the Runs fact prints "<runs>: <pass> pass, <fail> fail, <broken> did not complete" with numbers recounted from the store',
      'renderHtml prints the run, pass, fail and did-not-complete counts in the Runs fact.',
      (fx) => {
        const runs = fx.rawBase.length;
        const pass = fx.rawBase.filter(passes).length;
        const failing = fx.rawBase.filter((run) => run.status === 'completed' && !passes(run)).length;
        const broken = runs - pass - failing;
        const want = `<dt>Runs</dt><dd>${runs}: ${pass} pass, ${failing} fail, ${broken} did not complete</dd>`;
        return report.renderHtml(cardOf(fx)).includes(want) ? undefined : `the page has no "${want}"`;
      },
    ),
    item(
      'html-spent',
      'report-brute-force',
      2,
      HTML,
      'the Spent fact prints the total in US dollars, four decimals under a cent, else two',
      'renderHtml prints the summed run cost with four decimals under a cent and two otherwise.',
      (fx) => {
        const total = fx.rawBase.reduce(
          (sum, run) => sum + run.blocks.reduce((s, b) => s + (b.observed.cost.usd ?? 0), 0),
          0,
        );
        const want = `<dt>Spent</dt><dd>${usdText(total)}</dd>`;
        return report.renderHtml(cardOf(fx)).includes(want) ? undefined : `the page has no "${want}"`;
      },
    ),
    item(
      'html-mode-tile',
      'report-brute-force',
      2,
      HTML,
      'the summary tile "Runs passing, <mode>" prints the passing share of the mode with one decimal',
      'renderHtml prints each mode run pass rate as a percentage with one decimal in its tile.',
      (fx) => {
        const html = report.renderHtml(cardOf(fx));
        for (const mode of ['T', 'F', 'P'] as const) {
          const runs = fx.rawBase.filter((run) => run.mode === mode);
          const value = `${((runs.filter(passes).length / runs.length) * 100).toFixed(1)}%`;
          const want = `<p class="tile-label">Runs passing, ${mode}</p>\n<p class="tile-value">${value}</p>`;
          if (!html.includes(want)) return `no tile "Runs passing, ${mode}" with ${value}`;
        }
        return undefined;
      },
    ),
    item(
      'html-escaping',
      'claim-report',
      3,
      HTML,
      'a campaign id with markup characters is escaped in the title and the heading',
      'renderHtml escapes the campaign id wherever it prints it.',
      async (_fx, { seed }) => {
        const html = report.renderHtml(report.buildScorecard(await oddCampaign(seed)));
        return html.includes('<title>Scorecard c-&lt;odd&amp;&quot;id&quot;&gt;') && !html.includes('<odd&')
          ? undefined
          : 'the campaign id reaches the page unescaped';
      },
      'hostile',
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// compareCampaigns (compare.ts P4.3; examples/acme/reports/README.md).

type Unit = { key: string; specId: string; mode: RunMode; target: TargetRef; runs: RunResult[] };

function unitsTruth(runs: readonly RunResult[]): Map<string, Unit> {
  const out = new Map<string, Unit>();
  for (const run of runs) {
    const key = `${run.specId}|${run.mode}|${run.perturbationId ?? ''}|${canonicalJson(run.target)}`;
    const held = out.get(key) ?? { key, specId: run.specId, mode: run.mode, target: run.target, runs: [] };
    held.runs.push(run);
    out.set(key, held);
  }
  return out;
}

function pairsTruth(fx: Fixture, baseRuns = fx.rawBase, candRuns = fx.rawCand) {
  // compare.ts: by default every mode both campaigns ran.
  const shared = (['T', 'F', 'P'] as const).filter(
    (mode) => baseRuns.some((run) => run.mode === mode) && candRuns.some((run) => run.mode === mode),
  );
  const base = unitsTruth(baseRuns.filter((run) => shared.includes(run.mode)));
  const cand = unitsTruth(candRuns.filter((run) => shared.includes(run.mode)));
  const pairs = [...base.values()].flatMap((unit) => {
    const other = cand.get(unit.key);
    return other ? [{ base: unit, cand: other }] : [];
  });
  const table = { bothPass: 0, regressed: 0, improved: 0, bothFail: 0 };
  for (const pair of pairs) {
    const b = pair.base.runs.every(passes);
    const c = pair.cand.runs.every(passes);
    if (b && c) table.bothPass += 1;
    else if (b) table.regressed += 1;
    else if (c) table.improved += 1;
    else table.bothFail += 1;
  }
  return { base, cand, pairs, table };
}

function criteriaTruth(fx: Fixture, baseRuns = fx.rawBase, candRuns = fx.rawCand) {
  const sideOf = (runs: RunResult[]) => {
    const out = new Map<string, { pass: boolean; gating: boolean }>();
    for (const run of runs) {
      for (const block of run.blocks)
        for (const v of block.verdicts) {
          if (v.outcome === 'inconclusive') continue;
          const name = v.kind === 'judge' ? v.id : v.name;
          const held = out.get(name) ?? { pass: true, gating: false };
          out.set(name, { pass: held.pass && v.outcome === 'pass', gating: held.gating || v.gating });
        }
      if (run.endState && !run.endState.match)
        out.set('end_state', { pass: false, gating: out.get('end_state')?.gating ?? true });
    }
    return out;
  };
  const { pairs } = pairsTruth(fx, baseRuns, candRuns);
  const sides = pairs.map((pair) => ({ b: sideOf(pair.base.runs), c: sideOf(pair.cand.runs) }));
  const names = new Set<string>();
  for (const side of sides) for (const name of side.b.keys()) if (side.c.has(name)) names.add(name);
  const rows = [...names].sort().map((name) => {
    const table = { bothPass: 0, regressed: 0, improved: 0, bothFail: 0 };
    let gating = false;
    for (const side of sides) {
      const b = side.b.get(name);
      const c = side.c.get(name);
      if (!b || !c) continue;
      gating = gating || b.gating || c.gating;
      if (b.pass && c.pass) table.bothPass += 1;
      else if (b.pass) table.regressed += 1;
      else if (c.pass) table.improved += 1;
      else table.bothFail += 1;
    }
    const { regressed, improved } = table;
    return {
      name,
      regressed,
      improved,
      table,
      gating,
      p: stats.mcnemar(regressed, improved, { exact: true }).pValue,
    };
  });
  const bh = stats.benjaminiHochberg(
    rows.map((row) => row.p),
    0.05,
  );
  return rows.map((row, index) => ({ ...row, adjusted: bh.adjusted[index] as number }));
}

/**
 * The verdict of a campaign against itself (compare.ts): no discordant golden and no new flag, so it is
 * non-inferior when the all-pass bound and every gating criterion bound are under the margin, else unproven.
 */
/** The goldens a paired table decides: every cell. */
function decided(table: { bothPass: number; regressed: number; improved: number; bothFail: number }): number {
  return table.bothPass + table.regressed + table.improved + table.bothFail;
}

function selfVerdict(fx: Fixture, margin: number): { verdict: string; bounds: string } {
  const all = pairsTruth(fx, fx.rawBase, fx.rawBase).table;
  const uppers = [
    ['all-pass', stats.pairedRateDifference(all).upper] as const,
    // statistics.md, "Underpowered criteria": a gating criterion decided on fewer than minGoldens goldens is
    // reported and left out of the non-inferiority conjunction.
    ...criteriaTruth(fx, fx.rawBase, fx.rawBase)
      .filter((row) => row.gating && decided(row.table) >= MIN_GOLDENS)
      .map((row) => [row.name, stats.pairedRateDifference(row.table).upper] as const),
  ];
  const within = uppers.every(([, upper]) => upper < margin);
  return {
    verdict: within ? 'non-inferior' : 'unproven',
    bounds: uppers.map(([name, upper]) => `${name} ${upper.toFixed(4)}`).join(', '),
  };
}

function compareItems(): BankItem[] {
  return [
    item(
      'compare-table',
      'report-brute-force',
      1,
      CMP,
      'the paired table counts goldens (one spec in one mode, target when several) that pass in both, regressed, improved and fail in both; a golden passes when every repeat passes',
      'compareCampaigns pairs units by spec, mode and target and counts the all-pass flags of the two sides.',
      (fx) => {
        const want = pairsTruth(fx).table;
        const got = compareOf(fx).allPass.table;
        return show(got) === show(want) ? undefined : `table ${show(got)}, expected ${show(want)}`;
      },
    ),
    item(
      'compare-mcnemar',
      'report-brute-force',
      2,
      CMP,
      'the all-pass test is McNemar exact on the discordant goldens',
      'compareCampaigns runs exact McNemar on the regressed and improved counts.',
      (fx) => {
        const t = pairsTruth(fx).table;
        const want = stats.mcnemar(t.regressed, t.improved, { exact: true }).pValue;
        const got = compareOf(fx).allPass.mcnemar.pValue;
        return near(got, want) ? undefined : `McNemar p ${got}, expected ${want}`;
      },
    ),
    item(
      'compare-effect',
      'report-brute-force',
      2,
      CMP,
      'the effect is the baseline rate minus the candidate rate with the paired Newcombe interval (statistics.md, pairedRateDifference)',
      'compareCampaigns gives the paired rate difference and its Newcombe interval at alpha 0.05 as the effect.',
      (fx) => {
        const want = stats.pairedRateDifference(pairsTruth(fx).table, 0.05);
        const got = compareOf(fx).allPass.effect;
        return sameInterval(got, want) && got.method === 'newcombe'
          ? undefined
          : `effect ${iv(got)}, expected ${iv(want)}`;
      },
    ),
    item(
      'compare-unpaired',
      'claim-report',
      2,
      CMP,
      'a golden only the baseline ran is listed unpaired as baseline only; P units are left out when only one side ran P',
      'compareCampaigns lists units of one side only as unpaired and keeps only the modes both campaigns ran.',
      (fx) => {
        const r = compareOf(fx);
        const s3 = (fx.specs[3] as SpecDef).flow.spec.id;
        const want = [{ unit: `${s3} · F`, reason: 'baseline only' }];
        return show(r.unpaired) === show(want) && show(r.modes) === show(['T', 'F'])
          ? undefined
          : `unpaired ${show(r.unpaired)}, modes ${show(r.modes)}, expected ${show(want)} and ["T","F"]`;
      },
    ),
    item(
      'compare-new-flag',
      'claim-report',
      2,
      CMP,
      'a forbidden verdict that fails for the candidate and not the baseline is a new gating flag of the golden (statistics.md, parity verdict)',
      'compareCampaigns lists a flag family failing in the candidate unit and not in the baseline one as a new flag.',
      (fx) => {
        const s1 = (fx.specs[1] as SpecDef).flow.spec.id;
        const want = [{ unit: `${s1} · T`, family: 'forbidden' }];
        const got = compareOf(fx).newFlags;
        return show(got) === show(want) ? undefined : `newFlags ${show(got)}, expected ${show(want)}`;
      },
    ),
    item(
      'compare-verdict',
      'claim-report',
      2,
      CMP,
      'with a new gating flag the verdict is regressed, never non-inferior (compare.ts verdict rule)',
      'compareCampaigns gives regressed when a new gating flag fires for the candidate.',
      (fx) => {
        const r = compareOf(fx);
        return r.verdict === 'regressed'
          ? undefined
          : `verdict ${r.verdict}, expected regressed with reasons ${show(r.reasons)}`;
      },
    ),
    item(
      'compare-wilcoxon',
      'report-brute-force',
      3,
      CMP,
      'the drift test is Wilcoxon signed-rank on the per-golden drift, candidate against baseline',
      'compareCampaigns runs Wilcoxon signed-rank on the candidate and baseline mean drift per unit.',
      (fx) => {
        const { pairs } = pairsTruth(fx);
        const want = stats.wilcoxonSignedRank(
          pairs.map((pair) => meanOf(pair.cand.runs.map(failingBlocks))),
          pairs.map((pair) => meanOf(pair.base.runs.map(failingBlocks))),
        );
        const got = compareOf(fx).drift.wilcoxon;
        return near(got.pValue, want.pValue) && got.n === want.n
          ? undefined
          : `Wilcoxon p ${got.pValue} n ${got.n}, expected ${want.pValue} n ${want.n}`;
      },
    ),
    item(
      'compare-criteria-bh',
      'report-brute-force',
      3,
      CMP,
      'per criterion, McNemar exact on the goldens both sides decided, then Benjamini-Hochberg across criteria (statistics.md)',
      'compareCampaigns tests each criterion with exact McNemar and adjusts the p-values with Benjamini-Hochberg across criteria.',
      (fx) => {
        const truth = criteriaTruth(fx);
        const rows = compareOf(fx).criteria;
        if (rows.length !== truth.length)
          return `${rows.length} criteria, expected ${truth.length}: ${show(truth.map((row) => row.name))}`;
        for (const want of truth) {
          const row = rows.find((each) => each.criterion === want.name);
          if (
            !row ||
            row.regressed !== want.regressed ||
            row.improved !== want.improved ||
            !near(row.pValue, want.p) ||
            !near(row.adjusted, want.adjusted)
          )
            return `criterion ${want.name}: ${show(row && [row.regressed, row.improved, row.pValue, row.adjusted])}, expected ${show([want.regressed, want.improved, want.p, want.adjusted])}`;
        }
        return undefined;
      },
    ),
    item(
      'compare-margin-range',
      'claim-report',
      1,
      CMP,
      'a margin outside (0, 1) is refused with a RangeError',
      'compareCampaigns throws RangeError for a margin of 0 or less, or of 1 or more.',
      (fx) => {
        for (const margin of [0, 1, -0.1, 15]) {
          try {
            report.compareCampaigns(fx.base, fx.cand, { margin });
            return `margin ${margin} was accepted`;
          } catch (cause) {
            if (!(cause instanceof RangeError)) return `margin ${margin} threw ${(cause as Error).name}`;
          }
        }
        return undefined;
      },
      'hostile',
    ),
    item(
      'compare-self',
      'claim-report',
      3,
      CMP,
      'a campaign against itself is non-inferior only when the all-pass and every gating criterion that is not underpowered have a Newcombe bound under the margin (statistics.md)',
      'compareCampaigns gives a campaign against itself non-inferior when every gating upper bound is below the margin, else unproven, never regressed.',
      (fx) => {
        for (const margin of [0.15, 0.6]) {
          const want = selfVerdict(fx, margin);
          const got = report.compareCampaigns(fx.base, fx.base, { margin }).verdict;
          if (got !== want.verdict)
            return `self compare at margin ${margin}: ${got}, expected ${want.verdict} (upper bounds ${want.bounds})`;
        }
        return undefined;
      },
    ),
    item(
      'compare-text',
      'report-brute-force',
      2,
      TEXT,
      'compareText prints the paired counts and the verdict the way driftbench compare prints them',
      'compareText prints "Both pass, regressed, improved, both fail" from the table and the verdict in capitals.',
      (fx) => {
        const t = pairsTruth(fx).table;
        const text = report.compareText(compareOf(fx));
        const want = `Both pass ${t.bothPass}, regressed ${t.regressed}, improved ${t.improved}, both fail ${t.bothFail}.`;
        return text.includes(want) && text.includes('Verdict: REGRESSED.')
          ? undefined
          : `the text lacks "${want}" or "Verdict: REGRESSED."`;
      },
    ),
    item(
      'scorecard-compare',
      'claim-report',
      2,
      SC,
      'with a baseline the scorecard carries the compare diff at the default margin of 2 points, and none without',
      'buildScorecard adds compareCampaigns at margin 0.02 only when a baseline is given.',
      (fx) => {
        const card = report.buildScorecard(fx.cand, { baseline: fx.base });
        return card.compare?.margin === 0.02 &&
          card.compare.baseline.campaignId === 'c-base' &&
          cardOf(fx).compare === undefined
          ? undefined
          : `compare margin ${card.compare?.margin}, baseline ${card.compare?.baseline.campaignId}, without baseline ${show(cardOf(fx).compare !== undefined)}`;
      },
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// The text table, the command line and the committed Acme scorecards.

function textItems(): BankItem[] {
  return [
    item(
      'text-table',
      'claim-report',
      1,
      TEXT,
      'textTable pads every column but the last to its widest cell, two spaces apart, indented by two, trailing space trimmed',
      'textTable pads each column but the last to its widest cell, joins with two spaces, indents by two and trims the end.',
      (_fx, { seed }) => {
        const rows = [
          ['spec', 'mode', 'rate'],
          [`s-${'x'.repeat(1 + (seed % 17))}`, 'T', ''],
          ['s', 'F,P', '33.3%'],
        ];
        const widths = rows[0]?.map((_, col) =>
          Math.max(...rows.map((row) => (row[col] as string).length)),
        ) as number[];
        const want = rows.map((row) =>
          `  ${row.map((cell, col) => (col === row.length - 1 ? cell : cell + ' '.repeat((widths[col] as number) - cell.length))).join('  ')}`.replace(
            /\s+$/,
            '',
          ),
        );
        const got = report.textTable(rows);
        return show(got) === show(want) ? undefined : `textTable ${show(got)}, expected ${show(want)}`;
      },
    ),
  ];
}

type CliRun = { code: number; out: string; err: string };
async function cli(argv: string[], cwd: string): Promise<CliRun> {
  const { main } = (await import('../../../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const code = await main(argv, {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd,
  });
  return { code, out, err };
}

function cliItems(): BankItem[] {
  return [
    item(
      'cli-report-writes',
      'claim-report',
      2,
      CLI_REPORT,
      'driftbench report writes the scorecard and the JUnit file and prints the run counts (scorecards.md; the cli.md row "report: not built yet" is stale)',
      'the report command writes --out and --junit, exits 0 and prints the campaign run, pass, fail and did-not-complete counts.',
      async (_fx, { seed, scratch }) => {
        const { path, fx } = await fileFixture(seed, scratch);
        const html = join(scratch, `claim-report-${seed}.html`);
        const xml = join(scratch, `claim-report-${seed}.xml`);
        const r = await cli(['report', 'c-base', '--store', path, '--out', html, '--junit', xml], scratch);
        const pass = fx.rawBase.filter(passes).length;
        const failing = fx.rawBase.filter((run) => run.status === 'completed' && !passes(run)).length;
        const broken = fx.rawBase.length - pass - failing;
        const want = `Campaign c-base: ${fx.rawBase.length} runs, ${pass} pass, ${failing} fail, ${broken} did not complete.`;
        const wrote =
          existsSync(html) &&
          existsSync(xml) &&
          readFileSync(xml, 'utf8').includes(`tests="${fx.rawBase.length}"`);
        return r.code === 0 && r.out.includes(want) && wrote
          ? undefined
          : `exit ${r.code}, files written ${wrote}, output ${show(r.out + r.err)}, expected exit 0 and "${want}"`;
      },
    ),
    item(
      'cli-report-margin-points',
      'claim-report',
      2,
      CLI_REPORT,
      'driftbench report --baseline --margin 15 reads the margin in points and prints the compare verdict at 0.15',
      'the report command reads --margin in percentage points and prints the verdict of the compare at that margin.',
      async (_fx, { seed, scratch }) => {
        const { path, fx } = await fileFixture(seed, scratch);
        const html = join(scratch, `claim-report-margin-${seed}.html`);
        const r = await cli(
          ['report', 'c-cand', '--store', path, '--out', html, '--baseline', 'c-base', '--margin', '15'],
          scratch,
        );
        const verdict = pairsTruth(fx).table.regressed > 0 ? 'regressed' : '?';
        const want = `Against baseline c-base: ${verdict}, margin 15.0 points.`;
        return r.code === 0 && r.out.includes(want)
          ? undefined
          : `exit ${r.code}, output ${show(r.out + r.err)}, expected "${want}"`;
      },
    ),
    item(
      'cli-compare-exit',
      'claim-report',
      2,
      CLI_COMPARE,
      'driftbench compare exits 1 when the candidate regressed (README: "The comparison finds the faults regressed (exit 1)")',
      'the compare command exits 0 on a non-inferior verdict and 1 otherwise.',
      async (_fx, { seed, scratch }) => {
        const { path } = await fileFixture(seed, scratch);
        const r = await cli(
          ['compare', '--baseline', 'c-base', '--candidate', 'c-cand', '--store', path, '--margin', '15'],
          scratch,
        );
        return r.code === 1 && r.out.includes('Verdict: REGRESSED.')
          ? undefined
          : `exit ${r.code}, output ${show((r.out + r.err).slice(-300))}`;
      },
    ),
    item(
      'cli-compare-self',
      'claim-report',
      3,
      CLI_COMPARE,
      'driftbench compare of a campaign against itself exits 0 exactly when the all-pass and every gating criterion that is not underpowered have a bound under the margin (statistics.md)',
      'the compare command exits 0 on a non-inferior verdict and 1 otherwise.',
      async (_fx, { seed, scratch }) => {
        const { path, fx } = await fileFixture(seed, scratch);
        for (const points of [15, 60]) {
          const r = await cli(
            [
              'compare',
              '--baseline',
              'c-base',
              '--candidate',
              'c-base',
              '--store',
              path,
              '--margin',
              String(points),
            ],
            scratch,
          );
          const want = selfVerdict(fx, points / 100);
          const code = want.verdict === 'non-inferior' ? 0 : 1;
          if (r.code !== code)
            return `self compare at ${points} points exits ${r.code}, expected ${code} (upper bounds ${want.bounds})`;
        }
        return undefined;
      },
    ),
  ];
}

/**
 * The numbers examples/acme/reports/README.md states under "What they show", read from the page: the items below
 * hold the committed scorecards to them, so a number wrong in the page fails as surely as one wrong in a file.
 */
export function readmeClaims(root: string): {
  runs?: number;
  regressed?: number;
  goldens?: number;
  pBelow?: boolean;
  p?: number;
  flagged?: number;
  faultFails?: number;
  faultRuns?: number;
} {
  const text = readFileSync(join(root, EXAMPLES), 'utf8');
  const runs = /The Acme agents pass all (\d+) runs\./.exec(text);
  const paired =
    /(\d+) of (\d+) paired goldens regressed and none improved, McNemar exact p (=|below) ([0-9.]+),/.exec(
      text,
    );
  const flagged = /a new `forbidden` or `safety` flag on (\d+) goldens\./.exec(text);
  const faults = /The fault campaign fails (\d+) of its (\d+) runs\./.exec(text);
  return {
    ...(runs ? { runs: Number(runs[1]) } : {}),
    ...(paired
      ? {
          regressed: Number(paired[1]),
          goldens: Number(paired[2]),
          pBelow: paired[3] === 'below',
          p: Number(paired[4]),
        }
      : {}),
    ...(flagged ? { flagged: Number(flagged[1]) } : {}),
    ...(faults ? { faultFails: Number(faults[1]), faultRuns: Number(faults[2]) } : {}),
  };
}

function examplesItems(): BankItem[] {
  const read = (root: string, file: string) =>
    readFileSync(join(root, 'examples/acme/reports', file), 'utf8');
  return [
    item(
      'acme-junit-75-pass',
      'claim-report',
      1,
      EXAMPLES,
      'acme-junit.xml shows the claim "The Acme agents pass all N runs" of the README: N test cases, no failure, no error',
      'examples/acme/reports holds an acme-junit.xml written from a campaign whose runs, as many as the README states, all pass.',
      (_fx, { root }) => {
        const { runs } = readmeClaims(root);
        if (runs === undefined) return 'the README states no "The Acme agents pass all N runs."';
        const xml = read(root, 'acme-junit.xml');
        const tag = /<testsuites[^>]*>/.exec(xml)?.[0] ?? '';
        const cases = (xml.match(/<testcase /g) ?? []).length;
        const failures = (xml.match(/<failure /g) ?? []).length + (xml.match(/<error /g) ?? []).length;
        if (cases < 1) return `acme-junit.xml must show at least 1 run; found ${cases}`;
        return tag.includes(`tests="${runs}"`) &&
          tag.includes('failures="0"') &&
          tag.includes('errors="0"') &&
          cases === runs &&
          failures === 0
          ? undefined
          : `the README states ${runs} runs; testsuites ${tag}, ${cases} cases, ${failures} failures or errors`;
      },
    ),
    item(
      'acme-faults-regressed',
      'report-brute-force',
      2,
      EXAMPLES,
      'acme-faults.html shows the README\'s "R of G paired goldens regressed and none improved, McNemar exact p" and the p recomputed here agrees',
      'examples/acme/reports holds an acme-faults.html whose compare section shows the regressed and paired goldens and the exact p the README states.',
      (_fx, { root }) => {
        const claim = readmeClaims(root);
        if (claim.regressed === undefined || claim.goldens === undefined || claim.p === undefined)
          return 'the README states no "R of G paired goldens regressed and none improved, McNemar exact p ..."';
        const html = read(root, 'acme-faults.html');
        const m =
          /Paired goldens: (\d+) pass in both, (\d+) regressed \(baseline passes, candidate fails\), (\d+) improved, (\d+) fail in both\./.exec(
            html,
          );
        if (!m) return 'acme-faults.html has no paired goldens line';
        const [both, regressed, improved, bothFail] = m.slice(1).map(Number) as [
          number,
          number,
          number,
          number,
        ];
        const p = stats.mcnemar(regressed, improved, { exact: true }).pValue;
        // README agreement cannot replace evidence that the planted faults regress.
        if (regressed < 1 || !(p < 0.001))
          return `acme-faults.html must show at least 1 regressed golden and recomputed p below 0.001; found ${regressed} regressed, p ${p}`;
        // "p = 0.0001" is the exact p to four decimals; "p below 0.0001" is a bound.
        const agrees = claim.pBelow ? p < claim.p : Math.abs(p - claim.p) < 0.00005;
        const printed = html.includes(
          `McNemar exact on the discordant goldens: p = ${claim.pBelow ? '&lt; ' : ''}${claim.p}.`,
        );
        return regressed === claim.regressed &&
          improved === 0 &&
          both + regressed + improved + bothFail === claim.goldens &&
          agrees &&
          printed
          ? undefined
          : `the README states ${claim.regressed} of ${claim.goldens} and p ${claim.pBelow ? 'below' : '='} ${claim.p}; paired ${m.slice(1).join(', ')}, recomputed p ${p}, printed as stated ${printed}`;
      },
    ),
    item(
      'acme-faults-flags',
      'claim-report',
      3,
      EXAMPLES,
      'acme-faults.html lists a new forbidden or safety flag on as many goldens as the README states',
      'examples/acme/reports holds an acme-faults.html whose new gating flag table names the goldens with forbidden or safety the README counts.',
      (_fx, { root }) => {
        const { flagged } = readmeClaims(root);
        if (flagged === undefined)
          return 'the README states no "a new `forbidden` or `safety` flag on N goldens."';
        const html = read(root, 'acme-faults.html');
        const start = html.indexOf('<caption>New gating flags');
        const end = html.indexOf('</table>', start);
        if (start < 0 || end < 0) return 'acme-faults.html has no new gating flag table';
        const rows = [
          ...html
            .slice(start, end)
            .matchAll(/<tr><td class="mono">([^<]*)<\/td><td class="mono">([^<]*)<\/td><\/tr>/g),
        ];
        const goldens = new Set(
          rows.filter((row) => row[2] === 'forbidden' || row[2] === 'safety').map((row) => row[1]),
        );
        if (goldens.size < 1)
          return `acme-faults.html must show at least 1 golden with a forbidden or safety flag; found ${goldens.size}`;
        return goldens.size === flagged
          ? undefined
          : `${goldens.size} goldens carry a forbidden or safety flag, the README states ${flagged}`;
      },
    ),
    item(
      'scorecards-links',
      'claim-report',
      1,
      'docs/scorecards.md',
      'every scorecard docs/scorecards.md links to exists in the repository',
      'docs/scorecards.md links only to scorecard files that exist under examples/acme/reports.',
      (_fx, { root }) => {
        const page = readFileSync(join(root, 'docs/scorecards.md'), 'utf8');
        const links = [...page.matchAll(/\]\((\.\.\/[^)#]+)\)/g)].map((match) => match[1] as string);
        const missing = links.filter((link) => !existsSync(join(root, 'docs', link)));
        return links.length >= 3 && missing.length === 0
          ? undefined
          : `${links.length} links, missing ${show(missing)}`;
      },
    ),
  ];
}

/** A memory store holding the given specs (by index into the fixture specs) and one campaign record. */
async function smallStore(
  seed: number,
  campaignId: string,
  indexes: number[],
  targets: TargetRef[],
  modes: RunMode[],
): Promise<{ store: Store; specs: SpecDef[] }> {
  const specs = specDefs(seed);
  const store = openMemoryStore();
  const pins: Array<{ id: string; hash: string }> = [];
  for (const index of indexes) {
    const loaded = validateSpec((specs[index] as SpecDef).flow.spec, 'claim-report');
    if (!loaded.ok) throw new Error('a planted spec does not load');
    await store.putSpec(loaded);
    pins.push({ id: loaded.spec.id, hash: loaded.hash });
  }
  await store.putCampaign({
    campaignId,
    specs: pins,
    targets,
    modes,
    repeats: { T: 2, F: 2, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: CREATED_BASE,
  });
  return { store, specs };
}

function edgeItems(): BankItem[] {
  return [
    item(
      'compounding-one-spec',
      'claim-report',
      4,
      COMPOUND,
      'a campaign with one spec gets no interval on its overall compounding index, even run on two targets (run-modes.md: "one spec is one cluster"; the code clusters by spec and target)',
      'compoundingIndex clusters the overall index by spec, so a campaign with one spec gets no overall interval whatever its targets.',
      async (fx, { seed }) => {
        const { store, specs } = await smallStore(seed, 'c-one', [1], [TA, TB], ['T', 'F']);
        const cells: Cell[] = [];
        for (const target of [TA, TB])
          for (const mode of ['T', 'F'] as const)
            for (let repeat = 0; repeat < 2; repeat += 1)
              cells.push({
                spec: 1,
                target,
                mode,
                repeat,
                plan: { faults: mode === 'F' && repeat === 0 ? new Map([[fx.f1, ['X1_local']]]) : new Map() },
              });
        await runCells(store, 'c-one', specs, cells);
        const card = report.buildScorecard(await report.loadCampaign(store, 'c-one'));
        await store.close();
        const overall = card.compounding.overall;
        if (!overall) return 'no overall compounding index';
        return overall.interval === undefined
          ? undefined
          : `one spec on two targets gets the overall interval ${iv(overall.interval)}, expected none`;
      },
      'adversarial',
    ),
    item(
      'cache-costs-nothing',
      'claim-report',
      3,
      SC,
      'a run replayed from the cache costs nothing (running.md "The budget"): the scorecard spends $0.00 on a campaign of replayed runs',
      'buildScorecard leaves runs replayed from the cache out of the money spent and the cost per block.',
      async (_fx, { seed }) => {
        const { store, specs } = await smallStore(seed, 'c-replayed', [0], [TA], ['F']);
        await store.putCampaign({
          ...(await report.loadCampaign(store, 'c-replayed')).campaign,
          campaignId: 'c-warm',
        });
        const def = specs[0] as SpecDef;
        const cache = memoryCache();
        for (const campaignId of ['c-warm', 'c-replayed'])
          await runScenario(def.flow.spec, behavioursOf(def, 0, { faults: new Map() }, 0, 'F'), {
            mode: 'F',
            target: TA,
            store,
            campaignId,
            cache,
          });
        const data = await report.loadCampaign(store, 'c-replayed');
        await store.close();
        const run = data.runs[0];
        if (!run?.cacheHit)
          return 'the second run was not replayed from the cache, so the item cannot read the claim';
        const card = report.buildScorecard(data);
        const html = report.renderHtml(card);
        return card.cost.totalUsd === 0 &&
          card.cost.perBlockUsd === undefined &&
          html.includes('<dt>Spent</dt><dd>$0.00</dd>')
          ? undefined
          : `totalUsd ${card.cost.totalUsd}, perBlockUsd ${iv(card.cost.perBlockUsd)} on a replayed run that recorded cost ${run.cost}`;
      },
    ),
  ];
}

export function reportItems(): BankItem[] {
  return [
    ...edgeItems(),
    ...campaignItems(),
    ...loadItems(),
    ...lineItems(),
    ...successionItems(),
    ...recoveryItems(),
    ...modeItems(),
    ...toolItems(),
    ...costItems(),
    ...compoundItems(),
    ...drilldownItems(),
    ...spreadItems(),
    ...junitItems(),
    ...htmlItems(),
    ...compareItems(),
    ...textItems(),
    ...cliItems(),
    ...examplesItems(),
  ];
}
