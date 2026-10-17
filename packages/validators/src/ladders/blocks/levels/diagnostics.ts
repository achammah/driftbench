import {
  between,
  list,
  pick,
  type RawSpec,
  type Rng,
  type RunRecord,
  rngFor,
  run,
  statusOf,
} from '../harness';
import { plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BlockPlan, recipe } from '../recipe';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';
import { lookalikeItems } from './lookalikes';

type Plan = BlockPlan;

/** n passing blocks, those at `positions` with `key` set. */
const at = (n: number, positions: readonly number[], key: 'fail' | 'stub'): BlockPlan[] =>
  Array.from({ length: n }, (_, i) =>
    positions.includes(i)
      ? key === 'fail'
        ? { fate: 'fail' }
        : { fate: 'pass', stub: true }
      : { fate: 'pass' },
  );

/**
 * Level 6: diagnostics (PRs 445 to 454). A diagnosis explains a failure after the checks and never changes a
 * verdict or `pass`. The report keeps two scores: the machine rate over every run that passed or failed, and
 * the agent-attributed rate, where a run passes when every failing gating verdict is set aside (setup,
 * excluded, credited), fails on any failure of the agent (agent, shared), and is left out, counted as
 * unassigned, when a failure has no attribution. Runs with a block not run count in neither rate. A
 * non-default object scored the runs shows as a badge, and the fix list keeps the campaign's ranked fixes.
 * Runs are real (planted failures and capabilities); dispositions are planted per failing block, so every
 * count is known.
 */

const ATTRIBUTION = 'packages/report/src/attribution.ts';
const DIAGNOSTICS = 'packages/core/src/diagnostics/run.ts';

const DISPOSITIONS = ['agent', 'shared', 'setup', 'excluded', 'credited', 'unassigned', 'none'] as const;
type Disposition = (typeof DISPOSITIONS)[number];
const SET_ASIDE = new Set(['setup', 'excluded', 'credited']);

type Planted = { record: RunRecord; dispositions: Map<number, Disposition> };

/** One real run of a planted plan on an adapter with or without tool stubs. */
async function plantedRun(
  product: BlocksProduct,
  seed: number,
  tag: string,
  plans: Plan[],
  toolStubs: boolean,
): Promise<RunRecord> {
  const r = recipe(seed, tag, 'normal', plans);
  const agent = plantedAgent(product, 'normal', r.actions, {
    scratch: '',
    ...(toolStubs ? {} : { capabilities: { toolStubs: false } }),
  });
  return run(product, r.raw, agent.adapter, { repeat: 0 });
}

const failingIds = (block: RunRecord['blocks'][number]) =>
  block.verdicts
    .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
    .map((verdict) => verdict.id);

type Mix = { id: string; tier: Tier; draw(rng: Rng): Disposition; notRun: boolean };

const MIXES: Mix[] = [
  { id: 'all-agent', tier: 1, draw: () => 'agent', notRun: false },
  { id: 'all-setup', tier: 2, draw: () => 'setup', notRun: false },
  {
    id: 'set-aside-kinds',
    tier: 3,
    draw: (rng) => pick(rng, ['setup', 'excluded', 'credited'] as const),
    notRun: false,
  },
  { id: 'agent-or-shared', tier: 2, draw: (rng) => pick(rng, ['agent', 'shared'] as const), notRun: false },
  {
    id: 'with-unassigned',
    tier: 3,
    draw: (rng) => pick(rng, ['agent', 'setup', 'unassigned'] as const),
    notRun: false,
  },
  {
    id: 'with-no-diagnosis',
    tier: 4,
    draw: (rng) => pick(rng, ['credited', 'none'] as const),
    notRun: false,
  },
  { id: 'any', tier: 4, draw: (rng) => pick(rng, DISPOSITIONS), notRun: false },
  { id: 'any-with-not-run', tier: 5, draw: (rng) => pick(rng, DISPOSITIONS), notRun: true },
];

/** The documented scores of planted runs: machine and agent counts, unassigned, unmeasured, blocks by disposition. */
function expectedScores(product: BlocksProduct, planted: readonly Planted[]) {
  const runOutcome = need<(record: RunRecord) => string>(product.core, 'core', 'runOutcome');
  let machinePass = 0;
  let scored = 0;
  let agentPass = 0;
  let decided = 0;
  let unassigned = 0;
  const unmeasured = { notRun: 0, blocked: 0 };
  const blocks = {
    failing: 0,
    agent: 0,
    setup: 0,
    excluded: 0,
    credited: 0,
    unassigned: 0,
    notRun: 0,
    blocked: 0,
  };
  for (const { record, dispositions } of planted) {
    const outcome = runOutcome(record);
    if (outcome === 'not_run') unmeasured.notRun += 1;
    if (outcome === 'blocked') unmeasured.blocked += 1;
    let agent: 'pass' | 'fail' | 'unassigned' = 'pass';
    for (const block of record.blocks) {
      const status = statusOf(product, block);
      if (status === 'not_run') blocks.notRun += 1;
      if (status === 'blocked') blocks.blocked += 1;
      if (status !== 'fail') continue;
      blocks.failing += 1;
      const disposition = dispositions.get(block.index) ?? 'none';
      if (disposition === 'agent' || disposition === 'shared') {
        blocks.agent += 1;
        agent = 'fail';
      } else if (SET_ASIDE.has(disposition)) {
        blocks[disposition as 'setup' | 'excluded' | 'credited'] += 1;
      } else {
        blocks.unassigned += 1;
        if (agent === 'pass') agent = 'unassigned';
      }
    }
    if (outcome !== 'pass' && outcome !== 'fail') continue;
    scored += 1;
    if (outcome === 'pass') machinePass += 1;
    if (agent === 'unassigned') unassigned += 1;
    else {
      decided += 1;
      if (agent === 'pass') agentPass += 1;
    }
  }
  return {
    machine: { k: machinePass, n: scored },
    agent: { k: agentPass, n: decided },
    unassigned,
    unmeasured,
    blocks,
    showsAgentRate: !(unassigned > decided - agentPass),
  };
}

type Summary = {
  machine?: { k: number; n: number };
  agent: { k: number; n: number; estimate?: number };
  unassigned: number;
  unmeasuredRuns: { notRun: number; blocked: number };
  blocks: Record<string, number>;
  fixes: unknown[];
  nonDefault: string[];
};

type AttributionOf = (data: unknown, options?: Record<string, unknown>) => Summary | undefined;

const campaignOf = (runs: RunRecord[]) => ({
  campaign: {
    campaignId: 'c-blocks',
    specs: [],
    targets: [{ adapter: 'function' }],
    modes: ['F'],
    repeats: { T: 0, F: 1, P: 0 },
    budgetUsd: 1,
    judge: { mode: 'system1', judges: [] },
    createdAt: '2026-10-16T00:00:00.000Z',
  },
  specs: new Map(),
  runs,
});

/** Planted runs: each a spec of three or four blocks with seeded failures, some on an adapter without tool stubs. */
async function plantedRuns(
  product: BlocksProduct,
  seed: number,
  id: string,
  size: number,
  mix: Mix,
): Promise<Planted[]> {
  const rng = rngFor(seed, id);
  const planted: Planted[] = [];
  for (let index = 0; index < size; index += 1) {
    const n = between(rng, 3, 4);
    const failing = [...Array(n).keys()].filter(() => rng() < 0.45);
    let plans = at(n, failing, 'fail');
    const notRun = mix.notRun && rng() < 0.3;
    if (notRun) plans = plans.map((plan, i) => (i === n - 1 ? { ...plan, stub: true, fate: 'pass' } : plan));
    const record = await plantedRun(product, seed, `${id}/${index}`, plans, !notRun);
    (record as { runId?: string }).runId ??= `run-${index}`;
    const dispositions = new Map<number, Disposition>();
    for (const block of record.blocks)
      if (failingIds(block).length > 0) dispositions.set(block.index, mix.draw(rng));
    planted.push({ record, dispositions });
  }
  return planted;
}

/** The diagnoses option the report reads: by run id and block index, one per failing verdict. */
function diagnosesOf(planted: readonly Planted[]) {
  const out: Record<string, Record<number, Record<string, unknown>[]>> = {};
  for (const { record, dispositions } of planted) {
    const byBlock: Record<number, Record<string, unknown>[]> = {};
    for (const block of record.blocks) {
      const disposition = dispositions.get(block.index);
      if (disposition === undefined || disposition === 'none') continue;
      byBlock[block.index] = failingIds(block).map((verdictRef) => ({
        verdictRef,
        disposition,
        rule: 'policy/blame:default@00000000#planted',
      }));
    }
    out[record.runId as string] = byBlock;
  }
  return out;
}

function scoreItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const mix of MIXES) {
    for (const size of [4, 9, 16]) {
      const id = `diagnostics/scores/${mix.id}/${size}`;
      items.push({
        id,
        family: 'diagnostics-scores',
        tier: mix.tier,
        level: 5,
        component: ATTRIBUTION,
        title: `over ${size} real runs whose failures carry ${mix.id.replace(/-/g, ' ')} dispositions, attributionOf gives the machine rate, the agent-attributed rate, the unassigned runs, the unmeasured runs and the failing blocks by disposition`,
        cause:
          mix.id.includes('unassigned') || mix.id.includes('no-diagnosis')
            ? 'attributionOf leaves a run whose failure no rule attributed out of the agent rate and counts it as unassigned.'
            : mix.notRun
              ? 'attributionOf counts runs with a block not run in neither rate.'
              : 'attributionOf passes a run for the agent when every failing verdict is set aside, and fails it on any agent failure.',
        check: async ({ seed, product }) => {
          const planted = await plantedRuns(product, seed, id, size, mix);
          const attributionOf = need<AttributionOf>(product.report, 'report', 'attributionOf');
          const got = attributionOf(campaignOf(planted.map((p) => p.record)), {
            diagnoses: diagnosesOf(planted),
            fixes: [],
          });
          if (!got) return fail('attributionOf gave nothing for runs with diagnoses');
          const want = expectedScores(product, planted);
          const gotBlocks = got.blocks;
          return expectAll([
            [
              got.machine?.k === want.machine.k && got.machine?.n === want.machine.n,
              `machine ${got.machine?.k} of ${got.machine?.n}, expected ${want.machine.k} of ${want.machine.n}`,
            ],
            [
              got.agent.k === want.agent.k && got.agent.n === want.agent.n,
              `agent ${got.agent.k} of ${got.agent.n}, expected ${want.agent.k} of ${want.agent.n}`,
            ],
            [
              got.unassigned === want.unassigned,
              `${got.unassigned} unassigned runs, expected ${want.unassigned}`,
            ],
            [
              (got.agent.estimate !== undefined) === want.showsAgentRate,
              `the agent rate ${got.agent.estimate === undefined ? 'has no' : 'has an'} estimate; ${want.unassigned} unassigned against ${want.agent.n - want.agent.k} assigned failures`,
            ],
            [
              got.unmeasuredRuns.notRun === want.unmeasured.notRun &&
                got.unmeasuredRuns.blocked === want.unmeasured.blocked,
              `unmeasured ${JSON.stringify(got.unmeasuredRuns)}, expected ${JSON.stringify(want.unmeasured)}`,
            ],
            [
              Object.entries(want.blocks).every(([key, value]) => gotBlocks[key] === value),
              `blocks ${JSON.stringify(gotBlocks)}, expected ${JSON.stringify(want.blocks)}`,
            ],
          ]);
        },
      });
    }
  }
  return items;
}

type ObjectCase = { id: string; tier: Tier; objects: { kind: string; id: string; hash?: string }[] };

const OBJECT_CASES: ObjectCase[] = [
  {
    id: 'all-default',
    tier: 1,
    objects: [
      { kind: 'check-set', id: 'default' },
      { kind: 'policy/blame', id: 'default' },
    ],
  },
  {
    id: 'one-project-policy',
    tier: 1,
    objects: [
      { kind: 'policy/blame', id: 'default' },
      { kind: 'policy/blame', id: 'larkspur', hash: 'a1b2c3d4' },
    ],
  },
  {
    id: 'two-kinds',
    tier: 2,
    objects: [
      { kind: 'check-set', id: 'quiet' },
      { kind: 'policy/value-check', id: 'shop', hash: '0f0e0d0c' },
    ],
  },
  {
    id: 'same-twice',
    tier: 3,
    objects: [
      { kind: 'check-set', id: 'quiet', hash: '11111111' },
      { kind: 'check-set', id: 'quiet', hash: '11111111' },
    ],
  },
  {
    id: 'same-id-two-hashes',
    tier: 4,
    objects: [
      { kind: 'check-set', id: 'quiet', hash: '11111111' },
      { kind: 'check-set', id: 'quiet', hash: '22222222' },
    ],
  },
  { id: 'none', tier: 2, objects: [] },
  {
    id: 'default-with-hash',
    tier: 3,
    objects: [{ kind: 'policy/placement', id: 'default', hash: 'deadbeef' }],
  },
  {
    id: 'unsorted',
    tier: 2,
    objects: [
      { kind: 'policy/stats', id: 'zeta' },
      { kind: 'check-set', id: 'alpha' },
      { kind: 'policy/links', id: 'mid' },
    ],
  },
  { id: 'nested-id', tier: 4, objects: [{ kind: 'diagnostic', id: 'team/flaky-block', hash: 'abcdef01' }] },
  {
    id: 'many',
    tier: 3,
    objects: ['a', 'b', 'c', 'd', 'e', 'default'].map((id) => ({ kind: 'policy/gating', id })),
  },
];

/** The non-default badge and the fix list: what the report prints beside the two scores. */
function badgeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const objectCase of OBJECT_CASES) {
    for (const ranked of [false, true]) {
      const id = `diagnostics/badge/${objectCase.id}/${ranked ? 'with-fixes' : 'no-fixes'}`;
      items.push({
        id,
        family: 'diagnostics-badge',
        tier: objectCase.tier,
        level: 5,
        component: ATTRIBUTION,
        title: `the report names the non-default objects (${objectCase.id.replace(/-/g, ' ')}) as sorted kind:id[@hash] once each, and ${ranked ? 'keeps the ranked fix list in order' : 'an empty fix list'}`,
        cause: ranked
          ? 'attributionOf keeps the campaign fix plan in its ranked order.'
          : 'attributionOf names every non-default object once, sorted, as kind:id@hash.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const planted = await plantedRuns(product, seed, id, 3, MIXES[0] as Mix);
          const fixes = ranked
            ? Array.from({ length: between(rng, 2, 5) }, (_, index) => ({
                fixLocation: pick(rng, ['skill.content', 'tool.contract', 'agent.model', 'test']),
                fixAction: `Fix ${index}`,
                blocks: between(rng, 1, 9),
                agentBlocks: between(rng, 0, 3),
              }))
            : [];
          const attributionOf = need<AttributionOf>(product.report, 'report', 'attributionOf');
          const got = attributionOf(campaignOf(planted.map((p) => p.record)), {
            diagnoses: diagnosesOf(planted),
            fixes,
            objects: objectCase.objects,
          });
          if (!got) return fail('attributionOf gave nothing for runs with diagnoses');
          const want = [
            ...new Set(
              objectCase.objects
                .filter((object) => object.id !== 'default')
                .map(
                  (object) =>
                    `${object.kind}:${object.id}${object.hash === undefined ? '' : `@${object.hash}`}`,
                ),
            ),
          ].sort();
          const gotFixes = got.fixes.map((fix) => (fix as { fixAction: string }).fixAction);
          const first = expectAll([
            [
              got.nonDefault.join(',') === want.join(','),
              `nonDefault ${list(got.nonDefault)}, expected ${list(want)}`,
            ],
            [
              gotFixes.join(',') === fixes.map((fix) => fix.fixAction).join(','),
              `fixes ${list(gotFixes)}, expected ${list(fixes.map((fix) => fix.fixAction))}`,
            ],
          ]);
          if (!first.pass) return first;
          // The twin: the same objects recorded where a run keeps them, in BlockResult.resolved, spread over the
          // blocks, and no object list given; a fix plan whose actions are any words.
          const records = structuredClone(planted.map((p) => p.record));
          const blocks = records.flatMap((record) => record.blocks);
          // One more non-default object, recorded only in the run, so the twin never holds an empty list.
          const recordedOnly = { kind: 'policy/stats', id: token(seed, `${id}#recorded`), hash: '5a5a5a5a' };
          [...objectCase.objects, recordedOnly].forEach((object, index) => {
            const block = blocks[index % blocks.length] as unknown as { resolved?: { objects: unknown[] } };
            block.resolved = { objects: [...(block.resolved?.objects ?? []), object] };
          });
          const wantRecorded = [...want, `policy/stats:${recordedOnly.id}@${recordedOnly.hash}`].sort();
          const worded = fixes.map((fix) => ({
            ...fix,
            fixAction: `${token(seed, `${id}#${fix.fixAction}`)} the rule`,
          }));
          const recorded = attributionOf(campaignOf(records), {
            diagnoses: diagnosesOf(planted),
            fixes: worded,
          });
          if (!recorded)
            return fail('attributionOf gave nothing for runs with diagnoses and resolved objects');
          const recordedFixes = recorded.fixes.map((fix) => (fix as { fixAction: string }).fixAction);
          return expectAll([
            [
              recorded.nonDefault.join(',') === wantRecorded.join(','),
              `with the objects in BlockResult.resolved, nonDefault ${list(recorded.nonDefault)}, expected ${list(wantRecorded)}`,
            ],
            [
              recordedFixes.join(',') === worded.map((fix) => fix.fixAction).join(','),
              `fixes ${list(recordedFixes)}, expected ${list(worded.map((fix) => fix.fixAction))}`,
            ],
          ]);
        },
      });
    }
  }
  return items;
}

const DIAGNOSTIC_SETS = [
  ['code-agent-liability'],
  ['value-mismatch'],
  ['code-agent-liability', 'value-mismatch'],
];
const DISPOSITION_ENUM = new Set(['agent', 'shared', 'setup', 'excluded', 'credited', 'unassigned']);
const CONFIDENCE_ENUM = new Set(['static', 'undecided', 'confirmed']);

/** A diagnosis explains, attributes or measures; it never changes a verdict or `pass`. */
function invarianceItems(): BankItem[] {
  const items: BankItem[] = [];
  const shapes: { id: string; tier: Tier; plan(n: number): Plan[] }[] = [
    { id: 'all-pass', tier: 1, plan: (n) => at(n, [], 'fail') },
    { id: 'one-fail', tier: 2, plan: (n) => at(n, [1], 'fail') },
    { id: 'all-fail', tier: 2, plan: (n) => at(n, [...Array(n).keys()], 'fail') },
    { id: 'first-and-last', tier: 3, plan: (n) => at(n, [0, n - 1], 'fail') },
    {
      id: 'alternating',
      tier: 3,
      plan: (n) =>
        at(
          n,
          [...Array(n).keys()].filter((i) => i % 2 === 0),
          'fail',
        ),
    },
    { id: 'last', tier: 2, plan: (n) => at(n, [n - 1], 'fail') },
    { id: 'tool-and-text', tier: 4, plan: (n) => at(n, [0, 2], 'fail') },
  ];
  for (const shape of shapes) {
    for (const set of DIAGNOSTIC_SETS) {
      const id = `diagnostics/invariance/${shape.id}/${set.join('+')}`;
      items.push({
        id,
        family: 'diagnostics-invariance',
        tier: shape.tier,
        level: 5,
        component: DIAGNOSTICS,
        title: `running the diagnostics ${set.join(' and ')} on a ${shape.id.replace(/-/g, ' ')} spec leaves every verdict and pass as it was, and every diagnosis names its diagnostic, a failing verdict of its block, and a documented disposition and confidence`,
        cause:
          'Diagnostics run after the checks, write diagnoses on failing verdicts, and never change a verdict or pass.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const n = between(rng, 3, 5);
          const plans = shape.plan(n);
          const { raw, actions } = recipe(seed, id, 'normal', plans);
          const withDiagnostics: RawSpec = { ...raw, uses: { diagnostics: set } };
          const adapter = () => plantedAgent(product, 'normal', actions, { scratch: '' }).adapter;
          const plain = await run(product, raw, adapter());
          const diagnosed = await run(product, withDiagnostics, adapter());
          const project = (record: RunRecord) =>
            JSON.stringify(
              record.blocks.map((block) => [
                block.pass,
                block.status ?? null,
                block.verdicts.map((v) => [v.id, v.outcome, v.gating]),
              ]),
            );
          if (project(plain) !== project(diagnosed))
            return fail('the diagnostics changed a verdict or a pass');
          for (const block of diagnosed.blocks) {
            const failing = new Set(failingIds(block));
            // code-agent-liability attributes every root of a failing chain, its last item `unassigned` matching
            // always (blame.md, policy/blame:default): a spec whose uses is kept and ignored writes no diagnosis.
            const written = (block as { diagnoses?: unknown[] }).diagnoses ?? [];
            if (set.includes('code-agent-liability') && failing.size > 0 && written.length === 0)
              return fail(
                `block ${block.index} fails ${list([...failing])} and the diagnostics ${set.join(', ')} wrote no diagnosis on it`,
              );
            for (const diagnosis of (block as { diagnoses?: Record<string, unknown>[] }).diagnoses ?? []) {
              const d = diagnosis as {
                diagnostic?: string;
                verdictRef?: string;
                disposition?: string;
                confidence?: string;
                by?: unknown;
              };
              if (!/^diagnostic:[A-Za-z0-9][A-Za-z0-9._/-]*@[0-9a-f]{8}$/.test(d.diagnostic ?? ''))
                return fail(`a diagnosis of block ${block.index} names the diagnostic "${d.diagnostic}"`);
              if (d.verdictRef !== undefined && !failing.has(d.verdictRef))
                return fail(
                  `a diagnosis of block ${block.index} is about ${d.verdictRef}, which is no failing verdict of that block`,
                );
              if (d.disposition !== undefined && !DISPOSITION_ENUM.has(d.disposition))
                return fail(`a diagnosis names the disposition ${d.disposition}`);
              if (d.confidence !== undefined && !CONFIDENCE_ENUM.has(d.confidence))
                return fail(`a diagnosis names the confidence ${d.confidence}`);
              if (d.by === undefined)
                return fail(`a diagnosis of block ${block.index} names no producer (no by)`);
            }
          }
          return PASS;
        },
      });
    }
  }
  return items;
}

/** Level 5 of the blocks bank. */
export function diagnosticItems(): BankItem[] {
  return [...lookalikeItems(), ...scoreItems(), ...badgeItems(), ...invarianceItems()];
}
