import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
  between,
  type Capabilities,
  list,
  outcomeOf,
  type RunRecord,
  rngFor,
  run,
  statusOf,
} from '../harness';
import { startHttpAgent } from '../http-agent';
import { KINDS, type Kind, plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import {
  type BlockPlan,
  KIND_CAPS,
  type Recipe,
  recipe,
  runVerdict,
  type Setting,
  settle,
  type Truth,
} from '../recipe';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from '../types';

/**
 * Level 1: verdicts (docs/concepts/given-when-then.md, docs/concepts/block.md), for both planted kinds. A recipe
 * plants three to six blocks: each passes, fails by a planted fault, carries a Given layer the adapter cannot
 * apply, or sits under a parent. The truth is the documented rule: a layer the adapter cannot apply is `not_run`
 * from the block that sets it on, never sent; a block under a failed, unrun or blocked parent is `blocked`, never
 * sent; the run is `fail` on any failure, else `not_run`, else `blocked`, else `pass`. The command line exits 0, 1
 * or 3 on the same rule. Every id and marker is neutral: nothing the product reads names a verdict.
 */

const RUNNER = 'packages/core/src/runner/run.ts';
const CAPABILITY = 'packages/core/src/runner/capability.ts';
const VERDICTS = 'packages/core/src/runner/verdicts.ts';
const GATE_EXIT = 'packages/cli/src/commands/gate-exit.ts';
const HEADLINE = 'packages/report/src/headline.ts';
const PROCESS = 'packages/adapters/src/process/index.ts';

type Pattern = { id: string; tier: number; parents?: boolean; plan(n: number, middle: number): BlockPlan[] };

const pass = (n: number): BlockPlan[] => Array.from({ length: n }, () => ({ fate: 'pass' }));
const set = (plans: BlockPlan[], at: number, change: Partial<BlockPlan>) =>
  plans.map((plan, i) => (i === at ? { ...plan, ...change } : plan));
const chain = (plans: BlockPlan[]) => plans.map((plan, i) => (i === 0 ? plan : { ...plan, parent: i - 1 }));

export const PATTERNS: Pattern[] = [
  { id: 'all-pass', tier: 1, plan: (n) => pass(n) },
  { id: 'fail-first', tier: 1, plan: (n) => set(pass(n), 0, { fate: 'fail' }) },
  { id: 'fail-last', tier: 1, plan: (n) => set(pass(n), n - 1, { fate: 'fail' }) },
  { id: 'fail-middle', tier: 1, plan: (n, m) => set(pass(n), m, { fate: 'fail' }) },
  { id: 'all-fail', tier: 2, plan: (n) => pass(n).map(() => ({ fate: 'fail' })) },
  { id: 'stub-first', tier: 2, plan: (n) => set(pass(n), 0, { stub: true }) },
  { id: 'stub-middle', tier: 2, plan: (n, m) => set(pass(n), m, { stub: true }) },
  { id: 'prefix-middle', tier: 3, plan: (n, m) => set(pass(n), m, { prefix: true }) },
  {
    id: 'fail-then-stub',
    tier: 3,
    plan: (n, m) => set(set(pass(n), m - 1, { fate: 'fail' }), m, { stub: true }),
  },
  {
    id: 'stub-then-fail',
    tier: 3,
    plan: (n, m) => set(set(pass(n), m, { stub: true }), n - 1, { fate: 'fail' }),
  },
  { id: 'chain-pass', tier: 2, parents: true, plan: (n) => chain(pass(n)) },
  {
    id: 'chain-parent-fails',
    tier: 3,
    parents: true,
    plan: (n, m) => chain(set(pass(n), m, { fate: 'fail' })),
  },
  { id: 'chain-root-fails', tier: 3, parents: true, plan: (n) => chain(set(pass(n), 0, { fate: 'fail' })) },
  // Undocumented combination: a parent that is not run blocks its children.
  {
    id: 'chain-parent-not-run',
    tier: 4,
    parents: true,
    plan: (n, m) => chain(set(pass(n), m, { stub: true })),
  },
  {
    id: 'two-trees',
    tier: 4,
    parents: true,
    // Two trees: blocks 0 to m-1 under block 0, blocks m to n-1 under block m; block 1 fails.
    plan: (n, m) =>
      set(
        pass(n).map((plan, i) => (i === 0 || i === m ? plan : { ...plan, parent: i - 1 })),
        1,
        { fate: 'fail' },
      ),
  },
];

type CapabilitySet = { id: string; off: Capabilities; tier: number };

const CAPABILITY_SETS: CapabilitySet[] = [
  { id: 'native', off: {}, tier: 0 },
  { id: 'no-prefix', off: { seedPrefix: false }, tier: 1 },
];

/** The setting of a kind's planted adapter with some capabilities turned off. */
function settingOf(kind: Kind, off: Capabilities, mode: 'F' | 'T', parents: boolean): Setting {
  const caps = KIND_CAPS[kind];
  return {
    mode,
    parents,
    seedPrefix: caps.seedPrefix && off.seedPrefix !== false,
    toolStubs: caps.toolStubs && off.toolStubs !== false,
    snapshot: caps.snapshot,
  };
}

/**
 * Compares a run with the truth, block by block: the verdict, the not_run and blocked fields, whether the agent
 * received the block, and the run's verdict. The first difference is the failure, written as what the block
 * should be, why, and what came back.
 */
export function judge(
  product: BlocksProduct,
  r: Recipe,
  record: RunRecord,
  truth: ReadonlyMap<string, Truth>,
  delivered: readonly (string | undefined)[],
  deliveries?: readonly {
    marker: string | undefined;
    history: readonly { role: string; content: string }[];
  }[],
): ItemResult {
  const skipReason = need<(block: unknown) => string | undefined>(product.core, 'core', 'skipReason');
  const byId = new Map(record.blocks.map((block) => [block.blockId, block]));
  for (const block of r.blocks) {
    const want = truth.get(block.id) as Truth;
    const got = byId.get(block.id);
    if (!got) return fail(`${block.id} should be ${want.verdict}: the run holds no such block`);
    const status = statusOf(product, got);
    const why =
      want.verdict === 'blocked'
        ? `its parent ${want.blockedBy} did not pass (root ${want.root})`
        : want.verdict === 'not_run'
          ? 'its Given carries a layer the adapter cannot apply'
          : want.verdict === 'fail'
            ? 'its agent action breaks its expectation'
            : 'its agent action meets its expectation';
    if (status !== want.verdict) return fail(`${block.id} should be ${want.verdict}: ${why}; got ${status}`);
    if (got.pass !== (want.verdict === 'pass')) return fail(`${block.id} is ${status} with pass ${got.pass}`);
    const sent = delivered.filter((marker) => marker === block.marker).length;
    if (want.verdict === 'not_run' || want.verdict === 'blocked') {
      if (sent > 0)
        return fail(
          `${block.id} should be ${want.verdict} and never sent: ${why}; the agent received it ${sent} times`,
        );
      if (got.verdicts.length > 0)
        return fail(`${block.id} is ${status} and still carries ${got.verdicts.length} verdicts`);
    } else if (sent !== 1)
      return fail(`${block.id} should reach the agent once: ${why}; it reached it ${sent} times`);
    if (want.verdict === 'not_run') {
      const reason = skipReason(got) ?? '';
      if (want.notRun === 'snapshot') {
        if (got.notRun?.kind !== 'unsupported')
          return fail(
            `${block.id} should be not_run, kind unsupported: its parent's sandbox exports no end state; got ${got.notRun?.kind}/${got.notRun?.check}`,
          );
      } else {
        if (got.notRun?.check !== 'capability' || got.notRun.kind !== 'unsupported')
          return fail(
            `${block.id} should be not_run by the capability check, kind unsupported; got ${got.notRun?.kind}/${got.notRun?.check}`,
          );
        if (!reason.startsWith('not run (unsupported, check capability)'))
          return fail(`${block.id} skip reason "${reason}"`);
      }
    }
    if (want.verdict === 'blocked' && (got.blocked?.by !== want.blockedBy || got.blocked?.root !== want.root))
      return fail(
        `${block.id} should be blocked by ${want.blockedBy} (root ${want.root}); got by ${got.blocked?.by} (root ${got.blocked?.root})`,
      );
  }
  // A parent-linked spec runs as a forest: what reaches a block is its ancestors' turns, in order, and nothing of
  // another branch. A runner that keeps the parent key and runs the blocks in written order fails here.
  const parentOf = new Map(
    (r.raw.blocks as { id?: string; parent?: string }[]).map((block) => [block.id, block.parent] as const),
  );
  if (deliveries && [...parentOf.values()].some((parent) => parent !== undefined)) {
    const markerOf = new Map(r.blocks.map((block) => [block.id, block.marker]));
    for (const block of r.blocks) {
      const turn = deliveries.find((each) => each.marker === block.marker);
      if (!turn) continue;
      const lineage: string[] = [];
      for (let at = parentOf.get(block.id); at !== undefined; at = parentOf.get(at))
        lineage.unshift(markerOf.get(at) as string);
      const seen = turn.history
        .filter((message) => message.role === 'user')
        .map((message) => r.blocks.find((each) => message.content.includes(each.marker))?.marker)
        .filter((marker): marker is string => marker !== undefined && marker !== block.marker);
      if (seen.join(',') !== lineage.join(','))
        return fail(
          `${block.id} should receive the turns of its ancestors only, in order (${lineage.length === 0 ? 'none' : list(lineage.map((m) => r.blocks.find((b) => b.marker === m)?.id as string))}); it received ${seen.length === 0 ? 'none' : list(seen.map((m) => r.blocks.find((b) => b.marker === m)?.id as string))}`,
        );
    }
  }
  const outcome = outcomeOf(product, record);
  const wantOutcome = runVerdict(truth);
  return outcome === wantOutcome ? PASS : fail(`the run should read ${wantOutcome}; got ${outcome}`);
}

/** One run of a recipe on its planted agent: the record and the markers that reached the agent. */
export async function play(
  product: BlocksProduct,
  r: Recipe,
  scratch: string,
  options: {
    mode?: 'F' | 'T';
    off?: Capabilities;
    repeat?: number;
    store?: unknown;
    campaignId?: string;
  } = {},
) {
  const agent = plantedAgent(product, r.kind, r.actions, {
    scratch,
    ...(options.off && Object.keys(options.off).length > 0 ? { capabilities: options.off } : {}),
  });
  const record = await run(product, r.raw, agent.adapter, {
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.repeat !== undefined ? { repeat: options.repeat } : {}),
    ...(options.store ? { store: options.store, campaignId: options.campaignId ?? 'c-blocks' } : {}),
  });
  const deliveries = agent.delivered();
  return { record, deliveries, delivered: deliveries.map((each) => each.marker) };
}

/**
 * The one fix an item of a pattern needs. Items of both kinds and both modes share it: the runner is one piece of
 * code, so a kind or a mode is never a cause of its own.
 */
function patternCause(pattern: Pattern, capability: string): string {
  if (capability === 'no-prefix')
    return pattern.parents
      ? "A child whose adapter cannot seed its ancestors' turns is not_run before it is sent, whatever its parent did."
      : 'The capability check refuses a written prefix the adapter cannot seed, from the block that writes it on.';
  switch (pattern.id) {
    case 'chain-pass':
      return 'The runner runs a spec with parent links as a forest, each child after its parent.';
    case 'chain-parent-fails':
    case 'chain-root-fails':
      return 'A failed parent makes its descendants blocked, never sent, each by its own parent and rooted at the first failure.';
    case 'chain-parent-not-run':
      return 'A parent that is not run blocks its children, rooted at itself.';
    case 'two-trees':
      return 'A failure in one tree of parent links leaves the other trees running and passing.';
    case 'all-pass':
    case 'fail-first':
    case 'fail-last':
    case 'fail-middle':
    case 'all-fail':
      return 'The runner records a block as pass or fail from its gating verdicts alone, and a run fails on any failing block.';
    default:
      return 'The runner records not_run for a block its adapter cannot set up (a tool stub, a prefix): in mode T every other block still runs; in modes F and P the blocks after it are not_run too.';
  }
}

function patternItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of KINDS) {
    for (const capability of CAPABILITY_SETS) {
      for (const mode of ['F', 'T'] as const) {
        for (const pattern of PATTERNS) {
          if (
            kind === 'code' &&
            mode === 'T' &&
            capability.id === 'native' &&
            pattern.id.startsWith('prefix')
          )
            continue;
          // Without a prefix capability, only a block that needs one (a written prefix, a child) tests something new.
          if (capability.id === 'no-prefix' && !pattern.parents && !pattern.id.startsWith('prefix')) continue;
          const id = `verdicts/${kind}/${capability.id}/${mode}/${pattern.id}`;
          items.push({
            id,
            family: `verdicts-${kind}`,
            tier: Math.max(
              1,
              Math.min(
                5,
                pattern.tier + capability.tier + (mode === 'T' ? 1 : 0) + (kind === 'code' ? 1 : 0) - 1,
              ),
            ) as Tier,
            level: 1,
            component: pattern.parents
              ? VERDICTS
              : capability.id === 'native' && kind === 'normal'
                ? RUNNER
                : kind === 'code' && capability.id === 'native'
                  ? PROCESS
                  : CAPABILITY,
            title: `a ${kind} agent planted as ${pattern.id} in mode ${mode} (${capability.id} adapter) reads pass, fail, not_run and blocked block by block, never sends a block not run or blocked, and reads the run by the documented rule`,
            cause: patternCause(pattern, capability.id),
            check: async ({ seed, scratch, product }) => {
              const rng = rngFor(seed, id);
              const n = between(rng, 3, kind === 'code' ? 4 : 6);
              const middle = between(rng, 1, n - 2);
              const plans = pattern.plan(n, middle);
              const r = recipe(seed, id, kind, plans, { parents: pattern.parents === true });
              const setting = settingOf(kind, capability.off, mode, pattern.parents === true);
              const truth = settle(r, plans, setting);
              // A parent-linked spec is written children first: the forest order is the runner's job, not the file's.
              const written = pattern.parents
                ? { ...r, raw: { ...r.raw, blocks: [...r.raw.blocks].reverse() } }
                : r;
              const { record, delivered, deliveries } = await play(product, written, scratch, {
                mode,
                off: capability.off,
              });
              return judge(product, r, record, truth, delivered, deliveries);
            },
          });
        }
      }
    }
  }
  return items;
}

/** Tallies: a pass rate leaves not_run and blocked out and prints their count beside it. */
function tallyItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of KINDS) {
    for (const size of kind === 'code' ? [3, 5] : [3, 6, 10, 16]) {
      for (const mix of ['scored-only', 'with-not-run', 'with-blocked'] as const) {
        const id = `verdicts/tally/${kind}/${mix}/${size}`;
        items.push({
          id,
          family: `verdicts-${kind}`,
          tier: (size >= 10 ? 3 : 2) as Tier,
          level: 1,
          component: mix === 'scored-only' ? VERDICTS : HEADLINE,
          title: `over ${size} runs of ${kind} agents (${mix}), countRuns tallies each verdict, unscoredText names the unscored runs, and the headline counts only pass and fail runs`,
          cause:
            mix === 'scored-only'
              ? 'countRuns tallies every run by runOutcome.'
              : mix === 'with-not-run'
                ? 'A rate leaves not_run runs out of its count and unscoredText names them.'
                : 'A rate leaves blocked runs out of its scored count: a run with a blocked block is neither a pass nor a failure.',
          check: async ({ seed, scratch, product }) => {
            const rng = rngFor(seed, id);
            const records: RunRecord[] = [];
            const want = { pass: 0, fail: 0, not_run: 0, blocked: 0 };
            const pool = PATTERNS.filter((p) =>
              mix === 'scored-only'
                ? !p.id.includes('stub') && !p.id.includes('not-run') && !p.parents
                : mix === 'with-not-run'
                  ? !p.parents
                  : p.parents === true,
            );
            for (let index = 0; index < size; index += 1) {
              // A tally with blocked runs holds at least one: the first run's root fails, so its children are blocked.
              const pattern =
                mix === 'with-blocked' && index === 0
                  ? (PATTERNS.find((p) => p.id === 'chain-root-fails') as Pattern)
                  : (pool[Math.floor(rng() * pool.length)] as Pattern);
              const plans = pattern.plan(3, 1);
              const r = recipe(seed, `${id}#${index}`, kind, plans, { parents: pattern.parents === true });
              const truth = settle(r, plans, settingOf(kind, {}, 'F', pattern.parents === true));
              want[runVerdict(truth) as keyof typeof want] += 1;
              // Parent links are written children first: the runner orders the forest, whatever the written order.
              const written = pattern.parents
                ? { ...r, raw: { ...r.raw, blocks: [...r.raw.blocks].reverse() } }
                : r;
              records.push((await play(product, written, scratch)).record);
            }
            const countRuns = need<(runs: unknown[]) => Record<string, number>>(
              product.core,
              'core',
              'countRuns',
            );
            const unscoredText = need<(counts: Record<string, number>) => string>(
              product.core,
              'core',
              'unscoredText',
            );
            const suiteHeadline = need<
              (runs: unknown[], treeOf: (run: RunRecord) => string) => { runs?: number } | undefined
            >(product.report, 'report', 'suiteHeadline');
            const got = countRuns(records);
            const wantText = [
              ...(want.not_run > 0 ? [`${want.not_run} not run`] : []),
              ...(want.blocked > 0 ? [`${want.blocked} blocked`] : []),
            ].join(', ');
            const scored = want.pass + want.fail;
            const headline = suiteHeadline(records, (record) => record.specId);
            return expectAll([
              [
                got.pass === want.pass &&
                  got.fail === want.fail &&
                  got.not_run === want.not_run &&
                  got.blocked === want.blocked,
                `countRuns should be ${JSON.stringify(want)}; got ${JSON.stringify(got)}`,
              ],
              [
                unscoredText(got) === wantText,
                `unscoredText should be "${wantText}"; got "${unscoredText(got)}"`,
              ],
              [
                scored === 0 ? headline === undefined : headline?.runs === scored,
                `the headline should count ${scored} scored runs; got ${headline?.runs}`,
              ],
            ]);
          },
        });
      }
    }
  }
  return items;
}

type ExitCase = { id: string; tier: Tier; specs: BlockPlan[][]; exit: number; summary: RegExp };

const EXIT_CASES: ExitCase[] = [
  { id: 'one-pass', tier: 1, specs: [pass(3)], exit: 0, summary: /1 pass, 0 fail/ },
  { id: 'one-fail', tier: 1, specs: [set(pass(3), 1, { fate: 'fail' })], exit: 1, summary: /0 pass, 1 fail/ },
  { id: 'one-not-run', tier: 2, specs: [set(pass(3), 1, { stub: true })], exit: 3, summary: /1 not run/ },
  {
    id: 'pass-and-not-run',
    tier: 2,
    specs: [pass(3), set(pass(4), 3, { stub: true })],
    exit: 3,
    summary: /1 pass, 0 fail, 1 not run/,
  },
  {
    id: 'fail-and-not-run',
    tier: 3,
    specs: [set(pass(3), 2, { fate: 'fail' }), set(pass(4), 0, { stub: true })],
    exit: 1,
    summary: /0 pass, 1 fail, 1 not run/,
  },
  {
    id: 'fail-and-not-run-cell',
    tier: 3,
    specs: [set(set(pass(3), 0, { fate: 'fail' }), 2, { stub: true })],
    exit: 1,
    summary: /1 fail/,
  },
  {
    id: 'prefix-on-http',
    tier: 3,
    specs: [set(pass(3), 1, { prefix: true })],
    exit: 0,
    summary: /1 pass, 0 fail/,
  },
  {
    id: 'three-mixed',
    tier: 4,
    specs: [pass(3), set(pass(3), 0, { stub: true }), pass(2)],
    exit: 3,
    summary: /2 pass, 0 fail, 1 not run/,
  },
  { id: 'two-pass', tier: 1, specs: [pass(3), pass(2)], exit: 0, summary: /2 pass, 0 fail/ },
  {
    id: 'not-run-first-block',
    tier: 3,
    specs: [set(pass(4), 0, { stub: true })],
    exit: 3,
    summary: /0 pass, 0 fail, 1 not run/,
  },
];

/** The command line on a NORMAL agent behind a local HTTP endpoint that declares no tool stubs: exits 0, 1 or 3. */
function exitItems(): BankItem[] {
  return (['F', 'T'] as const).flatMap((mode) =>
    EXIT_CASES.map((exitCase) => {
      const id = `verdicts/exit/${mode}/${exitCase.id}`;
      return {
        id,
        family: 'verdicts-exit',
        tier: Math.min(5, exitCase.tier + (mode === 'T' ? 1 : 0)) as Tier,
        level: 1,
        component: GATE_EXIT,
        title: `campaign run in mode ${mode} on planted specs (${exitCase.id.replace(/-/g, ' ')}) exits ${exitCase.exit} and prints the cells by verdict`,
        cause:
          exitCase.exit === 3
            ? 'campaign run exits 3 when no cell fails and a cell is not run.'
            : `campaign run exits ${exitCase.exit} by the gate rule on its cells.`,
        check: async ({ seed, scratch, product }) => {
          const dir = join(scratch, `exit-${token(seed, id)}`);
          mkdirSync(dir, { recursive: true });
          const recipes = exitCase.specs.map((plans, index) =>
            recipe(seed, `${id}#${index}`, 'normal', plans),
          );
          const actions = new Map(recipes.flatMap((r) => [...r.actions]));
          const agent = await startHttpAgent((turn) => {
            for (const [marker, action] of actions)
              if (turn.user.includes(marker))
                return {
                  segments: [{ type: 'text', text: action.reply }],
                  text: action.reply,
                  toolCalls: (action.calls ?? []).map((call, i) => ({
                    id: `c${i}`,
                    label: call.label,
                    input: call.input ?? {},
                    output: call.output ?? {},
                  })),
                  cost: { usd: 0 },
                  latencyMs: 0,
                };
            throw new Error('no planted action');
          });
          try {
            const paths = recipes.map((r, index) => {
              const path = join(dir, `${token(seed, `${id}#path#${index}`)}.yaml`);
              writeFileSync(
                path,
                stringify({
                  ...r.raw,
                  target: {
                    adapter: 'http',
                    agent: 'larkspur',
                    options: { url: agent.url, tool_stubs: false, deterministic: true },
                  },
                }),
              );
              return path;
            });
            const result = await product.cli(
              ['campaign', 'run', ...paths, '--mode', mode, '--store', join(dir, 'store.db')],
              dir,
            );
            const text = `${result.out}\n${result.err}`;
            return expectAll([
              [
                result.code === exitCase.exit,
                `campaign run should exit ${exitCase.exit}; got ${result.code}: ${text.trim().split('\n').slice(-2).join(' | ').slice(0, 240)}`,
              ],
              [
                exitCase.summary.test(text),
                `the summary should match ${exitCase.summary}; got ${text.slice(-200)}`,
              ],
            ]);
          } finally {
            await agent.close();
          }
        },
      };
    }),
  );
}

/** Level 1 of the blocks bank. */
export function verdictItems(): BankItem[] {
  return [...patternItems(), ...tallyItems(), ...exitItems()];
}
