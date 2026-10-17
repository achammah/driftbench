import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { between, list, load, pick, type RawSpec, type Rng, rngFor, shuffled } from '../harness';
import { type BlocksProduct, need } from '../product';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';
import { cpuBest } from './links';

/**
 * Level 9: blast radius (docs/concepts/blast-radius.md). A suite of hand-written specs that declare
 * `metadata.depends` (so their blocks are known) is drawn from the seed: each block lists tools with a count of
 * one or zero, sometimes with an input assertion, sometimes an expected stage or a judged criterion; some specs
 * cap or forbid a tool, force its result or read it in the end state. For a change of one tool part, one stage
 * or one criterion, the documented table gives exactly the direct blocks, and the forward closure adds every
 * later block of the same run in mode F and none in mode T. A change the radius cannot map, a tool no block
 * declares, and a block whose dependencies are unknown put everything in. `driftbench radius` exits 0 on a
 * radius smaller than the suite, 1 on the whole suite, 2 on bad input.
 */

const RADIUS = 'packages/core/src/radius/radius.ts';
const DEPENDS = 'packages/core/src/radius/depends.ts';
const RADIUS_CLI = 'packages/cli/src/commands/radius.ts';

/** Tools a block can list; the forced result and the end state read only `payment.charge`. */
const LISTED = ['bikes.lookup', 'customer.find', 'booking.create'] as const;
const READ_TOOL = 'payment.charge';
const STAGES = ['offer', 'confirm', 'pay'] as const;
const CRITERIA = ['polite', 'one_question'] as const;

type BlockPlan = {
  tools: { label: string; count: 0 | 1; input: boolean }[];
  stage?: string;
  criterion?: string;
  forced: boolean;
};
type SpecPlan = {
  id: string;
  /** CODE: a task spec that seeds its workspace with `fixtures` and expects a file per block. */
  kind?: 'normal' | 'code';
  fixtures?: string[];
  /** The parent of each block, by index, -1 for a root: the spec is a forest. */
  parents?: number[];
  blocks: BlockPlan[];
  cap?: string;
  forbid?: string;
  endState: boolean;
  depends: boolean;
};

/** A seeded suite of `size` specs of three to six blocks. */
function suite(
  rng: Rng,
  size: number,
  options: { rules: boolean; depends?: boolean } = { rules: true },
): SpecPlan[] {
  return Array.from({ length: size }, (_, s) => {
    const n = between(rng, 3, 6);
    const forcedAt = rng() < 0.4 ? between(rng, 0, n - 1) : -1;
    const blocks = Array.from({ length: n }, (_, i) => {
      const tools = shuffled(rng, LISTED)
        .slice(0, between(rng, 0, 2))
        .map((label) => {
          const count = (rng() < 0.7 ? 1 : 0) as 0 | 1;
          // An input assertion needs a call: the loader refuses one on a tool expected 0 times.
          return { label, count, input: count === 1 && rng() < 0.5 };
        });
      return {
        tools,
        ...(rng() < 0.4 ? { stage: pick(rng, STAGES) } : {}),
        ...(rng() < 0.3 ? { criterion: pick(rng, CRITERIA) } : {}),
        forced: i === forcedAt,
      };
    });
    // A forbidden tool is one no block of the spec expects to be called: the loader refuses the contradiction.
    const called = new Set(
      blocks.flatMap((block) => block.tools.filter((tool) => tool.count > 0).map((tool) => tool.label)),
    );
    const forbiddable = LISTED.filter((label) => !called.has(label));
    return {
      id: `blast-${s}`,
      blocks,
      ...(options.rules && rng() < 0.3 ? { cap: pick(rng, LISTED) } : {}),
      ...(options.rules && forbiddable.length > 0 && rng() < 0.3 ? { forbid: pick(rng, forbiddable) } : {}),
      endState: rng() < 0.3,
      depends: options.depends ?? true,
    };
  });
}

function rawOf(plan: SpecPlan, seed: number): RawSpec {
  const usesCriteria = plan.blocks.some((block) => block.criterion !== undefined);
  if (plan.kind === 'code') {
    return {
      id: `${plan.id}-${seed}`,
      kind: 'task',
      stages: [...STAGES],
      metadata: { depends: { atoms: ['larkspur-core'] } },
      workspace_seed: {
        files: Object.fromEntries((plan.fixtures ?? []).map((path) => [path, 'bike,days\nFern 3,4\n'])),
      },
      ...(usesCriteria
        ? {
            criteria: CRITERIA.map((name) => ({
              name,
              rubric: `Is the reply ${name.replace('_', ' ')}?`,
              fail: 'It is not.',
              pass: 'It is.',
            })),
          }
        : {}),
      blocks: plan.blocks.map((block, i) => ({
        id: `b${i}`,
        ...(plan.parents && (plan.parents[i] ?? -1) >= 0 ? { parent: `b${plan.parents[i]}` } : {}),
        user: `[${plan.id}:${i}] Write the summary file.`,
        expect: {
          artifacts: [{ path: `out/${plan.id}-${i}.csv`, kind: 'csv', checks: [{ rows: { min: 1 } }] }],
          ...(block.stage ? { stage: block.stage } : {}),
          ...(block.criterion ? { criteria: [block.criterion] } : {}),
        },
      })),
    };
  }
  return {
    id: `${plan.id}-${seed}`,
    channel: 'chat',
    stages: [...STAGES],
    ...(plan.depends ? { metadata: { depends: { fixtures: ['larkspur-fleet'] } } } : {}),
    ...(usesCriteria
      ? {
          criteria: CRITERIA.map((name) => ({
            name,
            rubric: `Is the reply ${name.replace('_', ' ')}?`,
            fail: 'It is not.',
            pass: 'It is.',
          })),
        }
      : {}),
    ...(plan.cap || plan.forbid
      ? {
          rules: {
            ...(plan.cap ? { max_calls: { [plan.cap]: 2 } } : {}),
            ...(plan.forbid ? { forbidden_tools: [plan.forbid] } : {}),
          },
        }
      : {}),
    ...(plan.endState
      ? { end_state: { source: `tool:${READ_TOOL}`, mode: 'subset', expect: { amount: 30 } } }
      : {}),
    blocks: plan.blocks.map((block, i) => ({
      id: `b${i}`,
      ...(plan.parents && (plan.parents[i] ?? -1) >= 0 ? { parent: `b${plan.parents[i]}` } : {}),
      user: `[${plan.id}:${i}] I would like a bike.`,
      ...(block.forced ? { given: { world: { tools: { [READ_TOOL]: { result: { ok: true } } } } } } : {}),
      expect: {
        must: ['bike'],
        ...(block.tools.length > 0
          ? {
              tools: block.tools.map((tool) => ({
                label: tool.label,
                count: tool.count,
                ...(tool.input ? { input: { day: i + 1 } } : {}),
              })),
            }
          : {}),
        ...(block.stage ? { stage: block.stage } : {}),
        ...(block.criterion ? { criteria: [block.criterion] } : {}),
      },
    })),
  };
}

type Change = { kind: string; id?: string; part?: string; global?: boolean };

/** The documented table: is block i of the spec directly in the radius of the change? */
function direct(plan: SpecPlan, i: number, change: Change): boolean {
  const block = plan.blocks[i] as BlockPlan;
  const last = i === plan.blocks.length - 1;
  const forcedHere = plan.blocks.slice(0, i + 1).some((each) => each.forced);
  if (change.kind === 'stage') return block.stage === change.id;
  if (change.kind === 'criterion') return block.criterion === change.id;
  // A workspace file the spec seeds is in the Given of every block of the spec.
  if (change.kind === 'fixture') return (plan.fixtures ?? []).includes(change.id as string);
  // A spec rule holds on every block of a spec whose rules carry it.
  if (change.kind === 'rule')
    return (
      (change.id === 'max_calls' && plan.cap !== undefined) ||
      (change.id === 'forbidden_tools' && plan.forbid !== undefined)
    );
  if (change.kind !== 'tool') return false;
  const listed = block.tools.filter((tool) => tool.label === change.id);
  if (change.part === 'input')
    return listed.some((tool) => tool.count > 0 || tool.input) || plan.cap === change.id;
  if (change.part === 'result')
    return (
      listed.some((tool) => tool.count > 0) ||
      (change.id === READ_TOOL && (forcedHere || (last && plan.endState)))
    );
  return (
    listed.length > 0 ||
    plan.cap === change.id ||
    plan.forbid === change.id ||
    (change.id === READ_TOOL && (forcedHere || (last && plan.endState)))
  );
}

/**
 * The documented radius: direct blocks, and in mode F every later block of the same spec. In a forest, the
 * descendants of a direct block, in every mode, wherever they are written.
 */
function expectedStates(plans: readonly SpecPlan[], change: Change, mode: 'F' | 'T'): string[][] {
  return plans.map((plan) => {
    const hits = plan.blocks.map((_, i) => direct(plan, i, change));
    if (plan.parents) {
      const parents = plan.parents;
      const below = (i: number): boolean => {
        for (let p = parents[i] ?? -1; p >= 0; p = parents[p] ?? -1) if (hits[p]) return true;
        return false;
      };
      return hits.map((hit, i) => (hit ? 'direct' : below(i) ? 'forward' : 'out'));
    }
    const first = hits.indexOf(true);
    // A task step in a sandbox keeps the workspace the step before left: in mode T too, the later steps follow.
    const follows = mode === 'F' || plan.kind === 'code';
    return hits.map((hit, i) => (hit ? 'direct' : follows && first >= 0 && i > first ? 'forward' : 'out'));
  });
}

type Report = {
  whole: { change: string; reason: string } | null;
  specs: { specId: string; blocks: { id: string; why: string[]; state: Record<string, string> }[] }[];
};

function radiusOf(
  product: BlocksProduct,
  seed: number,
  plans: readonly SpecPlan[],
  change: Change,
  modes: string[],
): Report {
  const contentHash = need<(value: unknown) => string>(product.core, 'core', 'contentHash');
  const radius = need<(specs: unknown[], manifest: unknown, options: unknown) => Report>(
    product.core,
    'core',
    'radiusOf',
  );
  const specs = plans.map((plan) => {
    const spec = load(product, rawOf(plan, seed));
    return { spec, hash: contentHash(spec) };
  });
  return radius(specs, { from: 'larkspur-v1', to: 'larkspur-v2', changes: [change] }, { modes });
}

/** A change that some block of the suite declares, drawn for the kind. */
function drawChange(rng: Rng, plans: readonly SpecPlan[], kind: string, part?: string): Change | undefined {
  if (kind === 'stage') {
    const named = [
      ...new Set(plans.flatMap((plan) => plan.blocks.flatMap((block) => (block.stage ? [block.stage] : [])))),
    ];
    return named.length === 0 ? undefined : { kind, id: pick(rng, named.sort()) };
  }
  if (kind === 'criterion') {
    const named = [
      ...new Set(
        plans.flatMap((plan) => plan.blocks.flatMap((block) => (block.criterion ? [block.criterion] : []))),
      ),
    ];
    return named.length === 0 ? undefined : { kind, id: pick(rng, named.sort()) };
  }
  if (kind === 'rule') {
    const named = [
      ...(plans.some((plan) => plan.cap !== undefined) ? ['max_calls'] : []),
      ...(plans.some((plan) => plan.forbid !== undefined) ? ['forbidden_tools'] : []),
    ];
    const wanted = part === undefined ? named : named.filter((name) => name === part);
    return wanted.length === 0 ? undefined : { kind, id: pick(rng, wanted) };
  }
  const candidates = part === 'result' ? [...LISTED, READ_TOOL] : [...LISTED];
  const declared = candidates.filter((label) =>
    plans.some((plan) =>
      plan.blocks.some((_, i) => direct(plan, i, { kind: 'tool', id: label, ...(part ? { part } : {}) })),
    ),
  );
  return declared.length === 0 ? undefined : { kind, id: pick(rng, declared), ...(part ? { part } : {}) };
}

function compare(report: Report, plans: readonly SpecPlan[], change: Change, mode: 'F' | 'T') {
  if (report.whole)
    return fail(`the radius of ${JSON.stringify(change)} is the whole suite: ${report.whole.reason}`);
  const want = expectedStates(plans, change, mode);
  for (const [s, plan] of plans.entries()) {
    const got = report.specs[s]?.blocks.map((block) => block.state[mode] ?? 'missing') ?? [];
    const expected = want[s] as string[];
    if (got.join(',') !== expected.join(','))
      return fail(
        `${plan.id} under ${JSON.stringify(change)} mode ${mode}: ${list(got)}, expected ${list(expected)}`,
      );
  }
  return PASS;
}

function directItems(): BankItem[] {
  const items: BankItem[] = [];
  const kinds: { kind: string; part?: string; tier: number }[] = [
    { kind: 'tool', part: 'input', tier: 2 },
    { kind: 'tool', part: 'result', tier: 3 },
    { kind: 'tool', part: 'description', tier: 2 },
    { kind: 'tool', tier: 2 },
    { kind: 'stage', tier: 1 },
    { kind: 'criterion', tier: 1 },
    { kind: 'rule', part: 'max_calls', tier: 2 },
    { kind: 'rule', part: 'forbidden_tools', tier: 2 },
  ];
  for (const entry of kinds) {
    for (const mode of ['F', 'T'] as const) {
      for (const size of [2, 4, 7]) {
        const label = entry.part
          ? `${entry.kind}-${entry.part}`
          : entry.kind === 'tool'
            ? 'tool-any-part'
            : entry.kind;
        const id = `blast/direct/${label}/${mode}/${size}`;
        items.push({
          id,
          family: entry.kind === 'tool' ? 'blast-tool' : 'blast-other-kinds',
          tier: Math.min(5, entry.tier + (size >= 7 ? 1 : 0) + (mode === 'F' ? 1 : 0)) as Tier,
          level: 7,
          component: entry.kind === 'tool' ? DEPENDS : RADIUS,
          title: `a ${label.replace(/-/g, ' ')} change over ${size} seeded specs selects exactly the documented direct blocks, ${mode === 'F' ? 'and every later block of the same run as forward' : 'and nothing forward in mode T'}`,
          cause:
            mode === 'F'
              ? 'The forward closure adds every block after a direct block of the same run in mode F.'
              : `radiusOf selects the direct blocks of a ${label.replace(/-/g, ' ')} change by the documented table.`,
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            let plans = suite(rng, size);
            let change = drawChange(rng, plans, entry.kind, entry.part);
            // A change that selects every block would let a radius that puts everything in pass: draw again.
            const narrowEnough = (c: Change | undefined) =>
              c !== undefined && expectedStates(plans, c, mode).flat().includes('out');
            for (let tries = 0; !narrowEnough(change) && tries < 40; tries += 1) {
              plans = suite(rng, size);
              change = drawChange(rng, plans, entry.kind, entry.part);
            }
            if (!change || !narrowEnough(change))
              return fail('the seed drew no suite with a change narrower than the suite');
            return compare(radiusOf(product, seed, plans, change, [mode]), plans, change, mode);
          },
        });
      }
    }
  }
  return items;
}

type WholeCase = { id: string; tier: Tier; change(rng: Rng): Change; unknownSpec?: boolean; whole: boolean };

const WHOLE_CASES: WholeCase[] = [
  { id: 'model', tier: 1, change: () => ({ kind: 'model' }), whole: true },
  { id: 'agent', tier: 1, change: () => ({ kind: 'agent' }), whole: true },
  {
    id: 'global-tool',
    tier: 2,
    change: (rng) => ({ kind: 'tool', id: pick(rng, LISTED), part: 'input', global: true }),
    whole: true,
  },
  { id: 'reply-language', tier: 2, change: () => ({ kind: 'rule', id: 'reply_language' }), whole: true },
  {
    id: 'unknown-kind',
    tier: 2,
    change: (rng) => ({ kind: pick(rng, ['tone', 'memory', 'retriever']), id: 'x' }),
    whole: true,
  },
  {
    id: 'undeclared-tool',
    tier: 3,
    change: (rng) => ({ kind: 'tool', id: pick(rng, ['bikes.repair', 'locker.open']) }),
    whole: true,
  },
  {
    id: 'undeclared-stage',
    tier: 3,
    change: (rng) => ({ kind: 'stage', id: pick(rng, ['farewell', 'upsell']) }),
    whole: true,
  },
  { id: 'tool-without-id', tier: 3, change: () => ({ kind: 'tool' }), whole: true },
  {
    id: 'unknown-dependencies',
    tier: 4,
    change: (rng) => ({ kind: 'tool', id: pick(rng, LISTED), part: 'input' }),
    unknownSpec: true,
    whole: false,
  },
  { id: 'no-change-listed', tier: 4, change: () => ({ kind: '' }), whole: true },
];

function wholeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const wholeCase of WHOLE_CASES) {
    for (const size of [2, 5]) {
      const id = `blast/whole/${wholeCase.id}/${size}`;
      items.push({
        id,
        family: 'blast-whole',
        tier: wholeCase.tier,
        level: 7,
        component: RADIUS,
        title: wholeCase.unknownSpec
          ? `a spec with unknown dependencies (no metadata.depends, no generator record, no atoms) is in the radius of any change, every block, while the other specs keep the table`
          : `a ${wholeCase.id.replace(/-/g, ' ')} change over ${size} specs is the whole suite, with its reason`,
        cause: wholeCase.unknownSpec
          ? 'A block whose dependencies are unknown is in every radius.'
          : `A change the radius cannot map (${wholeCase.id.replace(/-/g, ' ')}) makes the radius the whole suite.`,
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const plans = suite(rng, size);
          if (wholeCase.unknownSpec) (plans[0] as SpecPlan).depends = false;
          const change = wholeCase.change(rng);
          if (
            wholeCase.unknownSpec &&
            !plans.slice(1).some((plan) => plan.blocks.some((_, i) => direct(plan, i, change)))
          ) {
            const known = plans[1] as SpecPlan;
            known.blocks[0]?.tools.push({ label: change.id as string, count: 1, input: false });
            // The loader refuses a tool both forbidden and expected: the known spec no longer forbids it.
            if (known.forbid === change.id) delete known.forbid;
          }
          const manifestChanges = wholeCase.id === 'no-change-listed' ? [] : [change];
          const contentHash = need<(value: unknown) => string>(product.core, 'core', 'contentHash');
          const radius = need<(specs: unknown[], manifest: unknown, options: unknown) => Report>(
            product.core,
            'core',
            'radiusOf',
          );
          const specs = plans.map((plan) => {
            const spec = load(product, rawOf(plan, seed));
            return { spec, hash: contentHash(spec) };
          });
          const report = radius(
            specs,
            { from: 'larkspur-v1', to: 'larkspur-v2', changes: manifestChanges },
            { modes: ['T'] },
          );
          if (wholeCase.whole)
            return report.whole
              ? PASS
              : fail(`the radius of ${JSON.stringify(manifestChanges)} is not the whole suite`);
          if (report.whole)
            return fail(`one unknown spec made the radius the whole suite: ${report.whole.reason}`);
          const unknown = report.specs[0]?.blocks ?? [];
          const others = expectedStates(plans.slice(1), change, 'T');
          return expectAll([
            [
              unknown.length > 0 && unknown.every((block) => block.state.T === 'direct'),
              `the unknown spec's blocks read ${list(unknown.map((block) => block.state.T))}`,
            ],
            [
              report.specs
                .slice(1)
                .every(
                  (spec, s) =>
                    spec.blocks.map((block) => block.state.T).join() === (others[s] as string[]).join(),
                ),
              'a known spec left the documented table once an unknown spec joined the suite',
            ],
          ]);
        },
      });
    }
  }
  return items;
}

type CliCase = {
  id: string;
  tier: Tier;
  exit: number;
  /** The manifest, or undefined when the drawn suite declares no change of the kind (the item draws again). */
  manifest(rng: Rng, plans: SpecPlan[]): unknown;
};

/** A narrow manifest: a change some block declares and some block does not, so the radius is not the suite. */
function narrow(rng: Rng, plans: SpecPlan[], kind: string, part?: string) {
  const change = drawChange(rng, plans, kind, part);
  if (!change || !expectedStates(plans, change, 'T').flat().includes('out')) return undefined;
  return { from: 'v1', to: 'v2', changes: [change] };
}

const CLI_CASES: CliCase[] = [
  {
    id: 'narrow-tool',
    tier: 1,
    exit: 0,
    manifest: (rng, plans) => narrow(rng, plans, 'tool', 'input'),
  },
  {
    id: 'narrow-stage',
    tier: 1,
    exit: 0,
    manifest: (rng, plans) => narrow(rng, plans, 'stage'),
  },
  { id: 'model', tier: 1, exit: 1, manifest: () => ({ from: 'v1', to: 'v2', changes: [{ kind: 'model' }] }) },
  {
    id: 'reply-language',
    tier: 2,
    exit: 1,
    manifest: () => ({ from: 'v1', to: 'v2', changes: [{ kind: 'rule', id: 'reply_language' }] }),
  },
  { id: 'empty-change-list', tier: 2, exit: 1, manifest: () => ({ from: 'v1', to: 'v2', changes: [] }) },
  { id: 'malformed-manifest', tier: 2, exit: 2, manifest: () => ({ from: 'v1', changes: 'all' }) },
  { id: 'missing-manifest', tier: 1, exit: 2, manifest: () => undefined },
];

function cliItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const cliCase of CLI_CASES) {
    for (const size of [2, 4, 6]) {
      const id = `blast/cli/${cliCase.id}/${size}`;
      items.push({
        id,
        family: 'blast-cli',
        tier: cliCase.tier,
        level: 7,
        component: RADIUS_CLI,
        title: `driftbench radius over ${size} spec files with a ${cliCase.id.replace(/-/g, ' ')} manifest exits ${cliCase.exit}${cliCase.exit === 0 ? ', and --json lists the blocks radiusOf puts in' : ''}`,
        cause: `driftbench radius exits ${cliCase.exit} on ${cliCase.exit === 0 ? 'a radius smaller than the suite' : cliCase.exit === 1 ? 'the whole suite' : 'bad input'}.`,
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
          mkdirSync(join(dir, 'specs'), { recursive: true });
          let plans = suite(rng, size);
          let manifest = cliCase.manifest(rng, plans);
          for (let tries = 0; cliCase.exit === 0 && manifest === undefined && tries < 20; tries += 1) {
            plans = suite(rng, size);
            manifest = cliCase.manifest(rng, plans);
          }
          if (cliCase.exit === 0 && manifest === undefined)
            return fail('the seed drew no suite with a narrow change');
          for (const plan of plans)
            writeFileSync(join(dir, 'specs', `${plan.id}.yaml`), stringify(rawOf(plan, seed)));
          const manifestPath = join(dir, 'change.yaml');
          if (manifest !== undefined) writeFileSync(manifestPath, stringify(manifest));
          const result = await product.cli(
            ['radius', join(dir, 'specs'), '--change', manifestPath, '--mode', 'T', '--json'],
            dir,
          );
          if (result.code !== cliCase.exit)
            return fail(
              `radius exited ${result.code}, expected ${cliCase.exit}: ${(result.out + result.err).trim().slice(0, 200)}`,
            );
          if (cliCase.exit !== 0) return PASS;
          const change = (manifest as { changes: Change[] }).changes[0] as Change;
          const want = expectedStates(plans, change, 'T');
          const wantIn = want.flat().filter((state) => state !== 'out').length;
          const text = result.out;
          let json: { specs?: { specId: string; blocks: { state: Record<string, string> }[] }[] };
          try {
            json = JSON.parse(text);
          } catch {
            return fail(`radius --json printed no JSON: ${text.slice(0, 120)}`);
          }
          const gotIn = (json.specs ?? [])
            .flatMap((spec) => spec.blocks)
            .filter((block) => (block.state.T ?? 'out') !== 'out').length;
          return gotIn === wantIn
            ? PASS
            : fail(`--json puts ${gotIn} blocks in the radius, expected ${wantIn}`);
        },
      });
    }
  }
  return items;
}

/** Level 9 of the blocks bank. */
export function blastItems(): BankItem[] {
  return [...directItems(), ...wholeItems(), ...cliItems(), ...codeItems(), ...chainItems(), ...scaleItems()];
}

const INPUTS = ['data/rentals.csv', 'data/fleet.csv', 'data/rates.csv', 'data/returns.csv'] as const;

/** A seeded suite of CODE specs: each seeds one or two input files and expects one file per block. */
function codeSuite(rng: Rng, size: number): SpecPlan[] {
  return Array.from({ length: size }, (_, s) => ({
    id: `task-${s}`,
    kind: 'code' as const,
    fixtures: shuffled(rng, INPUTS).slice(0, between(rng, 1, 2)),
    blocks: Array.from({ length: between(rng, 2, 4) }, () => ({
      tools: [],
      ...(rng() < 0.4 ? { stage: pick(rng, STAGES) } : {}),
      ...(rng() < 0.3 ? { criterion: pick(rng, CRITERIA) } : {}),
      forced: false,
    })),
    endState: false,
    depends: true,
  }));
}

/** CODE suites: a changed input file reaches exactly the specs that seed it; a stage or a criterion, its blocks. */
function codeItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of ['fixture', 'stage', 'criterion'] as const) {
    for (const mode of ['F', 'T'] as const) {
      for (const size of [2, 4, 7, 12]) {
        const id = `blast/code/${kind}/${mode}/${size}`;
        items.push({
          id,
          family: 'blast-code',
          tier: Math.min(
            5,
            (kind === 'fixture' ? 2 : 1) + (size >= 7 ? 1 : 0) + (mode === 'F' ? 1 : 0),
          ) as Tier,
          level: 7,
          component: DEPENDS,
          title: `a ${kind} change over ${size} code-agent task specs selects exactly the blocks whose Given or Then names it${mode === 'F' ? ', and every later block of the same run' : ''}`,
          cause:
            kind === 'fixture'
              ? 'radiusOf selects every block of a task spec whose seeded workspace holds the changed file.'
              : `radiusOf selects the code blocks that expect the changed ${kind}.`,
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            let plans = codeSuite(rng, size);
            const draw = (): Change | undefined =>
              kind === 'fixture' ? { kind, id: pick(rng, INPUTS) } : drawChange(rng, plans, kind);
            let change = draw();
            const narrowEnough = (c: Change | undefined) =>
              c !== undefined &&
              expectedStates(plans, c, mode).flat().includes('direct') &&
              expectedStates(plans, c, mode).flat().includes('out');
            for (let tries = 0; !narrowEnough(change) && tries < 40; tries += 1) {
              plans = codeSuite(rng, size);
              change = draw();
            }
            if (!change || !narrowEnough(change))
              return fail('the seed drew no suite with a change narrower than the suite');
            return compare(radiusOf(product, seed, plans, change, [mode]), plans, change, mode);
          },
        });
      }
    }
  }
  return items;
}

/**
 * Undocumented combination: a 10-deep chain of parent blocks inside the blast radius, written in order, reversed
 * or shuffled, beside an unrelated spec. A change that reaches the block at depth d puts its every descendant in the
 * radius, in every mode, wherever the YAML writes it, and nothing above it.
 */
function chainItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const depth of [0, 3, 6, 9]) {
    for (const mode of ['F', 'T'] as const) {
      for (const order of ['in-order', 'reversed', 'shuffled'] as const) {
        const id = `blast/chain/depth-${depth}/${mode}/${order}`;
        items.push({
          id,
          family: 'blast-parents',
          tier: Math.min(5, 3 + (order === 'in-order' ? 0 : 1) + (depth === 0 ? 0 : 1)) as Tier,
          level: 7,
          component: RADIUS,
          title: `a change reaching depth ${depth} of a 10-deep chain of parent blocks (${order}, mode ${mode}) selects that block and its ${10 - depth} descendants, nothing above it, and nothing in an unrelated spec`,
          cause:
            'A change that reaches a parent block puts all its descendants in the radius, in every mode, wherever they are written.',
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const n = 11;
            const tool = pick(rng, LISTED);
            const blocks: BlockPlan[] = Array.from({ length: n }, (_, i) => ({
              tools: i === depth ? [{ label: tool, count: 1, input: false }] : [],
              forced: false,
            }));
            const order0 = [...Array(n).keys()];
            const written =
              order === 'in-order'
                ? order0
                : order === 'reversed'
                  ? [...order0].reverse()
                  : shuffled(rng, order0);
            const chain: SpecPlan = {
              id: 'chain-0',
              blocks: written.map((i) => blocks[i] as BlockPlan),
              parents: written.map((i) => (i === 0 ? -1 : written.indexOf(i - 1))),
              endState: false,
              depends: true,
            };
            const other: SpecPlan = {
              id: 'other-0',
              blocks: [
                {
                  tools: [
                    {
                      label: pick(
                        rng,
                        LISTED.filter((l) => l !== tool),
                      ),
                      count: 1,
                      input: false,
                    },
                  ],
                  forced: false,
                },
                { tools: [], forced: false },
              ],
              endState: false,
              depends: true,
            };
            const plans = [chain, other];
            const change: Change = { kind: 'tool', id: tool, part: 'input' };
            const first = compare(radiusOf(product, seed, plans, change, [mode]), plans, change, mode);
            if (!first.pass || order !== 'in-order') return first;
            // The twin: the same chain written children first. Descendants are in the radius wherever the YAML
            // writes them, so a radius that only walks forward from the changed block is not enough.
            const back = [...order0].reverse();
            const reversed: SpecPlan = {
              ...chain,
              blocks: back.map((i) => blocks[i] as BlockPlan),
              parents: back.map((i) => (i === 0 ? -1 : back.indexOf(i - 1))),
            };
            const twin = [reversed, other];
            return compare(radiusOf(product, seed, twin, change, [mode]), twin, change, mode);
          },
        });
      }
    }
  }
  return items;
}

/** The CPU budget of radiusOf on a suite, in milliseconds, best of 3: linear in the blocks. */
export const RADIUS_CPU_MS = { 1000: 400, 2500: 1000, 5000: 2000 } as const;

const scaleSuites = new Map<string, { plans: SpecPlan[]; specs: { spec: unknown; hash: string }[] }>();

/** Real size: suites of 1,000 to 5,000 blocks, the radius exact and within its CPU budget. */
function scaleItems(): BankItem[] {
  const items: BankItem[] = [];
  const kinds = [
    { kind: 'tool', part: 'input' },
    { kind: 'tool', part: 'result' },
    { kind: 'stage' },
    { kind: 'criterion' },
  ] as const;
  for (const blocks of [1000, 2500, 5000] as const) {
    for (const entry of kinds) {
      for (const mode of ['F', 'T'] as const) {
        const label = 'part' in entry ? `${entry.kind}-${entry.part}` : entry.kind;
        const id = `blast/scale/${blocks}/${label}/${mode}`;
        items.push({
          id,
          family: 'blast-scale',
          tier: (blocks === 5000 ? 5 : blocks === 2500 ? 4 : 3) as Tier,
          level: 7,
          component: RADIUS,
          title: `on a suite of ${blocks} blocks, a ${label} change gets exactly the documented radius in mode ${mode} within ${RADIUS_CPU_MS[blocks]} ms of CPU, best of 3`,
          cause: `radiusOf stays exact and linear on ${blocks} blocks: ${RADIUS_CPU_MS[blocks]} ms of CPU.`,
          check: async ({ seed, product }) => {
            const key = `${seed}:${blocks}`;
            let built = scaleSuites.get(key);
            if (!built) {
              const rng = rngFor(seed, `scale#${blocks}`);
              const plans = suite(rng, Math.round(blocks / 4.5));
              const contentHash = need<(value: unknown) => string>(product.core, 'core', 'contentHash');
              const specs = plans.map((plan) => {
                const spec = load(product, rawOf(plan, seed));
                return { spec, hash: contentHash(spec) };
              });
              built = { plans, specs };
              scaleSuites.clear();
              scaleSuites.set(key, built);
            }
            const rng = rngFor(seed, id);
            const change = drawChange(rng, built.plans, entry.kind, 'part' in entry ? entry.part : undefined);
            if (!change) return fail('the suite declares no such change');
            const radius = need<(specs: unknown[], manifest: unknown, options: unknown) => Report>(
              product.core,
              'core',
              'radiusOf',
            );
            const { ms, result } = await cpuBest(3, async () =>
              radius(
                built.specs,
                { from: 'larkspur-v1', to: 'larkspur-v2', changes: [change] },
                { modes: [mode] },
              ),
            );
            const exact = compare(result, built.plans, change, mode);
            if (!exact.pass) return exact;
            return ms <= RADIUS_CPU_MS[blocks]
              ? PASS
              : fail(
                  `radiusOf on ${blocks} blocks should take at most ${RADIUS_CPU_MS[blocks]} ms of CPU; it took ${ms.toFixed(0)} ms (best of 3)`,
                );
          },
        });
      }
    }
  }
  return items;
}
