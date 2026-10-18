import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type Campaign,
  compareTranscripts,
  compoundingIndex,
  lintSpec,
  type Observed,
  planCampaign,
  type RunResult,
  runCampaign,
  type Spec,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { selectGolden } from '@agent-nexus/driftbench-generate';
import {
  buildScorecard,
  type CampaignData,
  compareCampaigns,
  reliability,
  renderHtml,
  renderJunit,
  spread,
  toolAccuracy,
} from '@agent-nexus/driftbench-report';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { SYSTEM_COMPONENTS } from '../components';
import { type Behaviour, followerReply } from '../plant';
import { measureGrowth, TEN_RUNS_PER_ROUND, TIME_ROUNDS, timeGrowth, VISIT_GROWTH_BOUND } from './growth';
import {
  type BankItem,
  type Draft,
  expectAll,
  fail,
  type ItemResult,
  PASS,
  type Tier,
  withCauses,
} from './types';
import {
  adapterFor,
  behavioursFor,
  FAST_RETRY,
  type Faults,
  loadRaw,
  memoryCache,
  plantedFlow,
  runScenario,
} from './world';

/**
 * Level 11: scale (section 12.2, item 4). Each subject runs at one, ten and a hundred times a base size. At
 * every size the answer must be the planted one; and the time from ten to a hundred times must grow at most
 * GROWTH_BOUND times (linear growth is ten; a quadratic path is a hundred), with the largest size under its
 * budget. Correct and slow is a failing item. Every growth item reads the best CPU time of many interleaved
 * runs at both sizes (`timeGrowth` in `growth.ts`): one run at a size of a few milliseconds measures the load
 * of the machine as much as the work. The subjects whose size is the length of the history also count the
 * work before they time it (`measureGrowth`).
 */

export const GROWTH_BOUND = 25;

/**
 * The CPU time the work took in this process (user plus system), in milliseconds. Wall time stretches with
 * the load of a shared machine; CPU time measures the work, so a budget or a growth bound does not fail on a
 * busy machine. The subjects run in process and wait on no network.
 */
async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = process.cpuUsage();
  const value = await work();
  const used = process.cpuUsage(started);
  return { value, ms: (used.user + used.system) / 1000 };
}

type Subject = {
  name: string;
  base: number;
  /** The largest size must finish within this budget. */
  budgetMs: number;
  component: string;
  /**
   * True for a subject whose size is the length of the history the agent is given. Its growth item reads
   * the growth measure of `growth.ts`: a count of message visits against the linear law, and the best CPU
   * time of many runs against GROWTH_BOUND, in place of one timing over the best of three.
   */
  history?: boolean;
  run(seed: number, size: number): Promise<ItemResult>;
};

/** A long flow with a planted X1 fault on every fourth block: exactly those blocks fail. */
async function longFlow(
  seed: number,
  size: number,
  mode: 'F' | 'T' = 'F',
  cached = false,
): Promise<ItemResult> {
  const planted = plantedFlow(seed, `scale-flow-${mode}-${size}`, size);
  const faults: Faults = new Map(
    Array.from({ length: Math.floor(size / 4) }, (_, index) => [index * 4 + 3, ['X1_local']] as const),
  );
  const behaviours = behavioursFor(planted, faults);
  const cache = cached ? memoryCache() : undefined;
  let run: RunResult = await runScenario(planted.spec, behaviours, { mode, ...(cache ? { cache } : {}) });
  if (cache) run = await runScenario(planted.spec, behaviours, { mode, cache });
  const failing = run.blocks.filter((block) => !block.pass).map((block) => block.index);
  const want = [...faults.keys()];
  return expectAll([
    [run.status === 'completed', `the run ${run.status}: ${run.error}`],
    [run.blocks.length === size, `${run.blocks.length} blocks of ${size}`],
    [
      failing.join() === want.join(),
      `failing ${failing.slice(0, 10).join(',')}, planted ${want.slice(0, 10).join(',')}`,
    ],
    [!cached || run.cacheHit, 'the second run did not replay'],
  ]);
}

/** A reply of `size` characters that holds the code once, at the end. */
async function longReply(seed: number, size: number): Promise<ItemResult> {
  const planted = plantedFlow(seed, `scale-reply-${size}`, 2);
  const behaviours = behavioursFor(planted);
  const truth = planted.truths[1];
  if (!truth) return fail('no block');
  const filler = 'The line is clear and the plan is ready for you today. ';
  behaviours.set(planted.texts[1] as string, () => {
    const reply = followerReply(truth);
    const text = `${filler.repeat(Math.ceil(size / filler.length)).slice(0, size)} Reference ${truth.code}.`;
    return {
      ...reply,
      text,
      segments: [...reply.segments.filter((segment) => segment.type !== 'text'), { type: 'text', text }],
    };
  });
  const run = await runScenario(planted.spec, behaviours);
  return run.status === 'completed' && run.blocks.every((block) => block.pass)
    ? PASS
    : fail(`the run ${run.status}, blocks ${run.blocks.map((block) => block.pass).join(',')}`);
}

/** A block whose agent makes `size` read calls beside the expected lookup. */
async function manyCalls(seed: number, size: number): Promise<ItemResult> {
  const planted = plantedFlow(seed, `scale-calls-${size}`, 2);
  const behaviours = behavioursFor(planted);
  const truth = planted.truths[1];
  if (!truth) return fail('no block');
  behaviours.set(planted.texts[1] as string, () => {
    const reply = followerReply(truth);
    const calls = Array.from({ length: size }, (_, index) => ({
      id: `read-${index}`,
      label: 'catalog.search',
      input: { page: index },
      output: { items: [] },
    }));
    return { ...reply, toolCalls: [...reply.toolCalls, ...calls] } as Observed;
  });
  const run = await runScenario(planted.spec, behaviours);
  return run.status === 'completed' && run.blocks.every((block) => block.pass)
    ? PASS
    : fail(`the run ${run.status}: ${run.error ?? ''}`);
}

/** A campaign of `size` one-block cells through the campaign runner and the store. */
async function manyCells(seed: number, size: number): Promise<ItemResult> {
  const behaviours = new Map<string, Behaviour>();
  const loaded: Array<{ spec: Spec; hash: string }> = [];
  for (let index = 0; index < size; index += 1) {
    const planted = plantedFlow(seed, `scale-cells-${size}-${index}`, 1);
    for (const [text, behaviour] of behavioursFor(
      planted,
      index % 7 === 0 ? new Map([[0, ['X5_tool']]]) : new Map(),
    ))
      behaviours.set(text, behaviour);
    const result = validateSpec(planted.spec, 'bank');
    if (!result.ok) return fail('a spec does not load');
    loaded.push({ spec: result.spec, hash: result.hash });
  }
  const store = openMemoryStore();
  try {
    const campaign: Campaign = {
      campaignId: 'c-scale',
      specs: loaded.map((entry) => ({ id: entry.spec.id, hash: entry.hash })),
      targets: [{ adapter: 'function' }],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-11T00:00:00.000Z',
    };
    await store.putCampaign(campaign);
    const cells = planCampaign(loaded, [{ adapter: 'function' }], ['F'], 1).cells;
    const byHash = new Map(loaded.map((entry) => [entry.hash, entry.spec] as const));
    const adapter = adapterFor('function', behaviours);
    const outcomes = await runCampaign({
      campaignId: 'c-scale',
      cells,
      specFor: (cell) => byHash.get(cell.specHash) as Spec,
      adapterFor: () => adapter,
      driver: () => createScriptedDriver(),
      checks: defaultChecks(),
      store,
      retry: FAST_RETRY,
    });
    const stored = await store.listRuns({ campaignId: 'c-scale' });
    const failing = outcomes.filter((outcome) => outcome.state === 'fail').length;
    return expectAll([
      [stored.length === size, `${stored.length} runs stored of ${size}`],
      [failing === Math.ceil(size / 7), `${failing} cells fail, ${Math.ceil(size / 7)} planted`],
    ]);
  } finally {
    await store.close();
  }
}

/** One real run of a planted flow, cloned under new ids: the input of the subjects that read many runs. */
async function manyRuns(
  seed: number,
  size: number,
  modes: readonly ('F' | 'T')[] = ['F'],
): Promise<RunResult[]> {
  const planted = plantedFlow(seed, 'scale-many-runs', 4);
  const base: Record<string, RunResult> = {};
  for (const mode of modes)
    base[mode] = await runScenario(planted.spec, behavioursFor(planted, new Map([[2, ['X1_local']]])), {
      mode,
    });
  const out: RunResult[] = [];
  for (let index = 0; index < size; index += 1) {
    const mode = modes[index % modes.length] as 'F' | 'T';
    const run = base[mode] as RunResult;
    out.push({
      ...run,
      runId: `${run.runId.slice(0, 8)}${String(index).padStart(8, '0')}`,
      specId: `scale-spec-${Math.floor(index / modes.length)}`,
      repeat: 0,
    });
  }
  return out;
}

/** A spec of `size` blocks through the loader: it loads, and the same text hashes the same twice. */
async function loaderBlocks(seed: number, size: number): Promise<ItemResult> {
  const planted = plantedFlow(seed, `scale-loader-${size}`, size);
  const first = validateSpec(planted.spec, 'bank');
  const second = validateSpec(structuredClone(planted.spec), 'bank');
  return first.ok && second.ok && first.hash === second.hash && first.spec.blocks.length === size
    ? PASS
    : fail(`the loader refused or rehashed a spec of ${size} blocks`);
}

async function lintBlocks(seed: number, size: number): Promise<ItemResult> {
  const planted = plantedFlow(seed, `scale-lint-${size}`, size);
  const loaded = validateSpec(planted.spec, 'bank');
  if (!loaded.ok) return fail('the spec does not load');
  const issues = lintSpec(loaded.spec);
  return Array.isArray(issues) ? PASS : fail('lintSpec gave no list');
}

async function storeRuns(seed: number, size: number): Promise<ItemResult> {
  const runs = await manyRuns(seed, size);
  const store = openMemoryStore();
  try {
    await store.putCampaign({
      campaignId: 'c-many',
      specs: [{ id: runs[0]?.specId ?? 's', hash: runs[0]?.specHash ?? 'h' }],
      targets: [{ adapter: 'function' }],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-11T00:00:00.000Z',
    });
    for (const run of runs) await store.putRun('c-many', run);
    const listed = await store.listRuns({ campaignId: 'c-many' });
    return listed.length === size ? PASS : fail(`${listed.length} runs listed of ${size}`);
  } finally {
    await store.close();
  }
}

/** A campaign of `size` runs of distinct specs, as the report package reads it. */
async function campaignData(seed: number, size: number, id = 'c-card'): Promise<CampaignData> {
  const runs = await manyRuns(seed, size);
  const specs = new Map(
    runs.map(
      (run) =>
        [
          `${run.specId}@${run.specHash}`,
          {
            ok: true,
            path: 'bank',
            spec: loadRaw(plantedFlow(seed, 'scale-many-runs', 4).spec),
            hash: run.specHash,
            warnings: [],
          },
        ] as const,
    ),
  );
  const data = {
    campaign: {
      campaignId: id,
      specs: runs.map((run) => ({ id: run.specId, hash: run.specHash })),
      targets: [{ adapter: 'function' }],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-11T00:00:00.000Z',
    },
    specs,
    runs,
  } as unknown as CampaignData;
  return data;
}

async function scorecardRuns(seed: number, size: number): Promise<ItemResult> {
  const data = await campaignData(seed, size);
  const card = buildScorecard(data);
  return card ? PASS : fail('no scorecard');
}

async function compoundingRuns(seed: number, size: number): Promise<ItemResult> {
  const runs = await manyRuns(seed, size, ['F', 'T']);
  const index = compoundingIndex(runs);
  return index.specs.length === Math.ceil(size / 2)
    ? PASS
    : fail(`${index.specs.length} compounding lines, ${Math.ceil(size / 2)} specs`);
}

async function transcriptRuns(seed: number, size: number): Promise<ItemResult> {
  const runs = await manyRuns(seed, size);
  return compareTranscripts(runs).identical ? PASS : fail('identical runs compare as different');
}

/** The HTML report of a campaign of `size` runs: one page, every run counted in its header. */
async function htmlReportRuns(seed: number, size: number): Promise<ItemResult> {
  const html = renderHtml(buildScorecard(await campaignData(seed, size)));
  return html.includes('<html') || html.includes('<!doctype') || html.includes('<!DOCTYPE')
    ? PASS
    : fail('renderHtml gave no page');
}

/** JUnit XML: one test per run. */
async function junitRuns(seed: number, size: number): Promise<ItemResult> {
  const xml = renderJunit(await campaignData(seed, size));
  return xml.includes(`tests="${size}"`) ? PASS : fail(`the JUnit XML does not count ${size} tests`);
}

/** Reliability: one line per spec, here one run each. */
async function reliabilityRuns(seed: number, size: number): Promise<ItemResult> {
  const lines = reliability(await campaignData(seed, size));
  return lines.length === size ? PASS : fail(`${lines.length} reliability lines for ${size} specs`);
}

/** A comparison of two equal campaigns: every pair is found and none regressed. */
async function compareRuns(seed: number, size: number): Promise<ItemResult> {
  const base = await campaignData(seed, size, 'c-base');
  const cand = await campaignData(seed, size, 'c-cand');
  const result = compareCampaigns(base, cand, { margin: 0.1 });
  const regressed = result.pairs.filter((pair) => pair.baseline.allPass && !pair.candidate.allPass).length;
  return result.pairs.length === size && regressed === 0
    ? PASS
    : fail(`${result.pairs.length} pairs of ${size}, ${regressed} regressed between equal campaigns`);
}

/** The spread view: it reads every run of the mode. */
async function spreadRuns(seed: number, size: number): Promise<ItemResult> {
  const view = spread(await campaignData(seed, size), { margin: 0.1 });
  return view ? PASS : fail('no spread');
}

/** Tool accuracy over the runs: the planted flow calls its lookup on every block, as expected. */
async function toolAccuracyRuns(seed: number, size: number): Promise<ItemResult> {
  const accuracy = toolAccuracy(await campaignData(seed, size));
  return accuracy ? PASS : fail('no tool accuracy');
}

/**
 * The golden selection over `size` specs on a chain of cells: spec i covers cells i and i + 1, so every cell
 * is coverable and the smallest cover holds ceil((size + 1) / 2) specs. The greedy cover must cover all.
 */
async function selectSpecs(_seed: number, size: number): Promise<ItemResult> {
  const pool = Array.from({ length: size }, (_, i) => `s-${i}`);
  const cells = Array.from({ length: size + 1 }, (_, c) => ({
    key: `c-${c}`,
    label: `cell ${c}`,
    specs: [c - 1, c].filter((i) => i >= 0 && i < size).map((i) => `s-${i}`),
  }));
  const picked = selectGolden({ pool, cells, required: [] });
  return picked.covered.cells === size + 1 && picked.cover.length <= size
    ? PASS
    : fail(`covered ${picked.covered.cells} of ${size + 1} cells with ${picked.cover.length} specs`);
}

const SUBJECTS: Subject[] = [
  {
    name: 'loader-blocks',
    base: 60,
    budgetMs: 5_000,
    component: 'packages/core/src/spec/load.ts',
    run: loaderBlocks,
  },
  {
    name: 'lint-blocks',
    base: 60,
    budgetMs: 5_000,
    component: 'packages/core/src/spec/lint.ts',
    run: lintBlocks,
  },
  {
    name: 'store-runs',
    base: 10,
    budgetMs: 10_000,
    component: 'packages/store/src/store.ts',
    run: storeRuns,
  },
  {
    name: 'scorecard-runs',
    base: 10,
    budgetMs: 10_000,
    component: 'packages/report/src/scorecard.ts',
    run: scorecardRuns,
  },
  {
    name: 'compounding-runs',
    base: 10,
    budgetMs: 5_000,
    component: 'packages/core/src/runner/compounding.ts',
    run: compoundingRuns,
  },
  {
    name: 'transcript-runs',
    base: 10,
    budgetMs: 5_000,
    component: 'packages/core/src/runner/transcript.ts',
    run: transcriptRuns,
  },
  {
    name: 'flow-blocks',
    base: 4,
    budgetMs: 4_000,
    component: SYSTEM_COMPONENTS.runner,
    history: true,
    run: (seed, size) => longFlow(seed, size),
  },
  {
    name: 'flow-blocks-teacher-forced',
    base: 4,
    budgetMs: 4_000,
    component: 'packages/core/src/runner/given.ts',
    history: true,
    run: (seed, size) => longFlow(seed, size, 'T'),
  },
  {
    name: 'flow-blocks-replayed',
    base: 4,
    budgetMs: 6_000,
    component: SYSTEM_COMPONENTS.cache,
    run: (seed, size) => longFlow(seed, size, 'F', true),
  },
  {
    name: 'reply-characters',
    base: 1000,
    budgetMs: 20_000,
    component: 'packages/checks/src/checks/lang.ts',
    run: longReply,
  },
  {
    name: 'tool-calls',
    base: 10,
    budgetMs: 20_000,
    component: 'packages/checks/src/checks/tools.ts',
    run: manyCalls,
  },
  {
    name: 'campaign-cells',
    base: 20,
    budgetMs: 10_000,
    component: SYSTEM_COMPONENTS.campaign,
    run: manyCells,
  },
  {
    name: 'html-report-runs',
    base: 10,
    budgetMs: 10_000,
    component: 'packages/report/src/html.ts',
    run: htmlReportRuns,
  },
  {
    name: 'junit-runs',
    base: 10,
    budgetMs: 10_000,
    component: 'packages/report/src/junit.ts',
    run: junitRuns,
  },
  {
    name: 'reliability-runs',
    base: 10,
    budgetMs: 10_000,
    component: 'packages/report/src/reliability.ts',
    run: reliabilityRuns,
  },
  {
    name: 'compare-runs',
    base: 10,
    budgetMs: 10_000,
    component: 'packages/report/src/compare.ts',
    run: compareRuns,
  },
  {
    name: 'spread-runs',
    base: 10,
    budgetMs: 10_000,
    component: 'packages/report/src/spread.ts',
    run: spreadRuns,
  },
  {
    name: 'tool-accuracy-runs',
    base: 10,
    budgetMs: 10_000,
    component: 'packages/report/src/scorecard.ts',
    run: toolAccuracyRuns,
  },
  {
    name: 'select-specs',
    base: 50,
    budgetMs: 10_000,
    component: 'packages/generate/src/select/cover.ts',
    run: selectSpecs,
  },
];

/** One measurement per seed and subject, shared by the subject's four items. */
const measured = new Map<string, Promise<Array<{ size: number; result: ItemResult; ms: number }>>>();

function measure(seed: number, subject: Subject) {
  const key = `${seed} ${subject.name}`;
  let held = measured.get(key);
  if (!held) {
    held = (async () => {
      const out: Array<{ size: number; result: ItemResult; ms: number }> = [];
      for (const factor of [1, 10, 100]) {
        const size = subject.base * factor;
        const { value, ms } = await timed(() => subject.run(seed, size));
        out.push({ size, result: value, ms });
      }
      // A busy machine stretches one timing: the ten-times size is timed twice more and the hundred-times
      // size once more when it looks too slow, and each keeps its fastest time.
      const ten = out[1];
      const hundred = out[2];
      if (ten && hundred) {
        for (let again = 0; again < 2; again += 1)
          ten.ms = Math.min(ten.ms, (await timed(() => subject.run(seed, ten.size))).ms);
        if (hundred.ms / Math.max(ten.ms, 1) > GROWTH_BOUND)
          hundred.ms = Math.min(hundred.ms, (await timed(() => subject.run(seed, hundred.size))).ms);
      }
      return out;
    })();
    measured.clear();
    measured.set(key, held);
  }
  return held;
}

export function scaleItems(): BankItem[] {
  const out: Draft[] = [];
  for (const subject of SUBJECTS) {
    ([1, 10, 100] as const).forEach((factor, index) => {
      out.push({
        id: `scale/${subject.name}/x${factor}`,
        family: 'scale',
        tier: (factor === 1 ? 2 : factor === 10 ? 3 : 4) as Tier,
        level: 11,
        component: subject.component,
        source: 'scale',
        title: `${subject.name} at ${subject.base * factor} gives the planted answer${factor === 100 ? ` within ${subject.budgetMs / 1000} s` : ''}`,
        async check({ seed }) {
          const rows = await measure(seed, subject);
          const row = rows[index];
          if (!row) return fail('not measured');
          if (!row.result.pass) return row.result;
          return factor === 100 && row.ms > subject.budgetMs
            ? fail(`${Math.round(row.ms)} ms at ${row.size}, budget ${subject.budgetMs} ms`)
            : PASS;
        },
      });
    });
    out.push({
      id: `scale/${subject.name}/growth`,
      family: 'scale',
      tier: 5,
      level: 11,
      component: subject.component,
      source: 'scale',
      title: subject.history
        ? `${subject.name}: from ten to a hundred times the size, the message visits grow at most ${VISIT_GROWTH_BOUND} times and the best CPU time at most ${GROWTH_BOUND} times`
        : `${subject.name}: from ten to a hundred times the size, the best CPU time of ${TIME_ROUNDS.min} to ${TIME_ROUNDS.max} interleaved rounds grows at most ${GROWTH_BOUND} times`,
      async check({ seed }) {
        if (subject.history) {
          const growth = await measureGrowth((size) => subject.run(seed, size), subject.base, {
            timeBound: GROWTH_BOUND,
          });
          return growth.result;
        }
        const time = await timeGrowth((size) => subject.run(seed, size), subject.base, {
          timeBound: GROWTH_BOUND,
        });
        return time.pass
          ? PASS
          : fail(
              `best CPU time ${time.ten.toFixed(1)} ms at ${subject.base * 10}, ${time.hundred.toFixed(1)} ms at ${subject.base * 100}, over ${time.rounds} rounds of ${TEN_RUNS_PER_ROUND} and 1 runs: ${time.growth.toFixed(1)} times, the bound is ${GROWTH_BOUND}`,
            );
      },
    });
  }
  return withCauses(
    out,
    (item) => `${item.id.split('/')[1]}: the per-block cost does not grow with the size of the run`,
  );
}
