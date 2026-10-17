import { between, list, loadIssues, pick, type Rng, rngFor, shuffled } from '../harness';
import { KINDS, token } from '../kinds';
import { need } from '../product';
import { type BlockPlan, KIND_CAPS, recipe, settle } from '../recipe';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';
import { judge, play } from './verdicts';

/**
 * Level 2: parent blocks (docs/concepts/given-when-then.md, "Parent blocks", on feat/block-parents), for both
 * planted kinds. A block sets `parent: <block id>` and starts from that block's recorded end state: the
 * ancestors' replies and tool calls in its history (CODE: their files in its workspace), never a sibling's; a
 * passed parent runs once. A failed, unrun or blocked parent makes the child `blocked`, by the parent, rooted at
 * the first cause, never sent; the run counts each cause once. `PARENT_MISSING` and `PARENT_CYCLE` refuse a spec.
 * Forests are drawn from the seed, written in order or shuffled; every block's fate is planted.
 */

const RUNNER = 'packages/core/src/runner/run.ts';
const PARENTS = 'packages/core/src/spec/parents.ts';
const VERDICTS = 'packages/core/src/runner/verdicts.ts';
const SANDBOX = 'packages/adapters/src/process/index.ts';

type Shape = { id: string; tier: number; draw(rng: Rng, small: boolean): number[] };

const SHAPES: Shape[] = [
  {
    id: 'chain',
    tier: 1,
    draw: (rng, small) => Array.from({ length: between(rng, 3, small ? 4 : 6) }, (_, i) => i - 1),
  },
  {
    id: 'star',
    tier: 1,
    draw: (rng, small) =>
      Array.from({ length: between(rng, 3, small ? 4 : 6) }, (_, i) => (i === 0 ? -1 : 0)),
  },
  {
    id: 'two-roots',
    tier: 2,
    draw: (rng) => {
      const left = between(rng, 2, 3);
      const right = between(rng, 2, 3);
      return [
        ...Array.from({ length: left }, (_, i) => i - 1),
        ...Array.from({ length: right }, (_, i) => (i === 0 ? -1 : left + i - 1)),
      ];
    },
  },
  {
    id: 'random-tree',
    tier: 3,
    draw: (rng, small) =>
      Array.from({ length: between(rng, 4, small ? 5 : 9) }, (_, i) =>
        i === 0 ? -1 : between(rng, 0, i - 1),
      ),
  },
  {
    id: 'random-forest',
    tier: 4,
    draw: (rng, small) =>
      Array.from({ length: between(rng, 5, small ? 6 : 10) }, (_, i) =>
        i === 0 || (i > 1 && rng() < 0.25) ? -1 : between(rng, 0, i - 1),
      ),
  },
];

const inner = (parents: readonly number[]) => parents.flatMap((_, i) => (parents.includes(i) ? [i] : []));
const leaves = (parents: readonly number[]) => parents.flatMap((_, i) => (parents.includes(i) ? [] : [i]));
const roots = (parents: readonly number[]) => parents.flatMap((p, i) => (p === -1 ? [i] : []));

type Placement = {
  id: string;
  tier: number;
  plant(rng: Rng, parents: readonly number[]): Partial<BlockPlan>[];
};

const at = (parents: readonly number[], x: number, change: Partial<BlockPlan>) =>
  parents.map((_, i) => (i === x ? change : {}));

const PLACEMENTS: Placement[] = [
  { id: 'all-pass', tier: 0, plant: (_rng, parents) => parents.map(() => ({})) },
  {
    id: 'root-fails',
    tier: 0,
    plant: (rng, parents) => at(parents, pick(rng, roots(parents)), { fate: 'fail' }),
  },
  {
    id: 'inner-fails',
    tier: 1,
    plant: (rng, parents) => {
      const candidates = inner(parents).filter((i) => parents[i] !== -1);
      return at(parents, pick(rng, candidates.length > 0 ? candidates : inner(parents)), { fate: 'fail' });
    },
  },
  {
    id: 'leaf-fails',
    tier: 0,
    plant: (rng, parents) => at(parents, pick(rng, leaves(parents)), { fate: 'fail' }),
  },
  // Undocumented combination: a parent that is not run (a Given layer its adapter cannot apply) blocks its children.
  {
    id: 'parent-not-run',
    tier: 2,
    plant: (rng, parents) => at(parents, pick(rng, inner(parents)), { stub: true }),
  },
  {
    id: 'two-causes',
    tier: 2,
    plant: (rng, parents) => {
      const [a, b] = shuffled(rng, [...parents.keys()]);
      return parents.map((_, i) =>
        i === a ? { fate: 'fail' } : i === b ? (rng() < 0.5 ? { fate: 'fail' } : { stub: true }) : {},
      );
    },
  },
];

/** Plans of a forest: parents first in the written order or shuffled, each with its planted change. */
function forestPlans(rng: Rng, shape: Shape, placement: Placement, small: boolean, forward: boolean) {
  const parents = shape.draw(rng, small);
  const changes = placement.plant(rng, parents);
  const plans: BlockPlan[] = parents.map(
    (parent, i) => ({ fate: 'pass', ...(parent === -1 ? {} : { parent }), ...changes[i] }) as BlockPlan,
  );
  if (!forward) return { plans, written: [...plans.keys()] };
  // Written out of order: at least one child comes before its parent, so the forest order is the runner's work.
  let written = shuffled(rng, [...plans.keys()]);
  const childFirst = (order: number[]) =>
    plans.some((plan, i) => plan.parent !== undefined && order.indexOf(i) < order.indexOf(plan.parent));
  if (!childFirst(written)) written = [...plans.keys()].reverse();
  return { plans, written };
}

function verdictItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of KINDS) {
    for (const shape of SHAPES) {
      for (const placement of PLACEMENTS) {
        if (kind === 'code' && shape.tier >= 4 && placement.tier === 0) continue;
        const forward = true;
        const id = `parents/verdicts/${kind}/${shape.id}/${placement.id}`;
        items.push({
          id,
          family: `parents-verdicts-${kind}`,
          tier: Math.min(5, shape.tier + placement.tier + (kind === 'code' ? 1 : 0)) as Tier,
          level: 2,
          component: placement.id === 'all-pass' ? RUNNER : VERDICTS,
          title: `a ${kind} agent in a ${shape.id.replace(/-/g, ' ')} forest${forward ? ' written out of order' : ''} where ${placement.id.replace(/-/g, ' ')} reads every block pass, fail, not_run or blocked (by its parent, rooted at the first cause), never sends a blocked block, and counts each cause once`,
          cause:
            placement.id === 'all-pass'
              ? 'The runner runs a spec with parent links as a forest, each child after its parent.'
              : placement.id === 'parent-not-run'
                ? 'A parent that is not run blocks its children, rooted at itself.'
                : placement.id === 'leaf-fails'
                  ? 'A failing block with no children blocks nothing: every other block keeps its own verdict.'
                  : placement.id === 'two-causes'
                    ? 'A run counts each planted failure once: blocked descendants add no failure and keep their own root.'
                    : 'A failed parent makes its descendants blocked, never sent, each by its own parent and rooted at the first failure.',
          check: async ({ seed, scratch, product }) => {
            const rng = rngFor(seed, id);
            const { plans, written } = forestPlans(rng, shape, placement, kind === 'code', forward);
            const r = recipe(seed, id, kind, plans, { parents: true });
            // Write the blocks in the drawn order: forward references included.
            r.raw.blocks = written.map((i) => r.raw.blocks[i] as Record<string, unknown>);
            const off = kind === 'normal' && plans.some((plan) => plan.stub) ? { toolStubs: false } : {};
            const truth = settle(r, plans, {
              mode: 'F',
              parents: true,
              seedPrefix: true,
              toolStubs: kind === 'code' ? KIND_CAPS.code.toolStubs : !plans.some((plan) => plan.stub),
              snapshot: KIND_CAPS[kind].snapshot,
            });
            const { record, delivered, deliveries } = await play(product, r, scratch, { off });
            const verdict = judge(product, r, record, truth, delivered, deliveries);
            if (!verdict.pass) return verdict;
            const countBlocks = need<(blocks: unknown[]) => Record<string, number>>(
              product.core,
              'core',
              'countBlocks',
            );
            const counts = countBlocks(record.blocks);
            const causes = [...truth.values()].filter((each) => each.verdict === 'fail').length;
            const blocked = [...truth.values()].filter((each) => each.verdict === 'blocked').length;
            return expectAll([
              [
                counts.fail === causes,
                `the run should count ${causes} failures, one per planted cause; got ${counts.fail}`,
              ],
              [
                counts.blocked === blocked,
                `the run should count ${blocked} blocked blocks; got ${counts.blocked}`,
              ],
            ]);
          },
        });
      }
    }
  }
  return items;
}

/** A child starts from its ancestors' recorded end state, never a sibling's. */
function stateItems(): BankItem[] {
  const items: BankItem[] = [];
  const views = [
    'ancestors-in-order',
    'no-sibling-history',
    'ancestor-user-turns',
    'ancestor-files',
  ] as const;
  for (const kind of KINDS) {
    for (const shape of SHAPES) {
      for (const view of views) {
        if (view === 'ancestor-files' && kind === 'normal') continue;
        if (shape.id === 'chain' && view === 'no-sibling-history') continue;
        const id = `parents/state/${kind}/${shape.id}/${view}`;
        items.push({
          id,
          family: 'parents-state',
          tier: Math.min(5, shape.tier + (view === 'ancestor-files' ? 2 : 1)) as Tier,
          level: 2,
          component: view === 'ancestor-files' ? SANDBOX : RUNNER,
          title: `in a ${shape.id.replace(/-/g, ' ')} forest of a ${kind} agent, each child ${view === 'ancestor-files' ? "starts with the files its ancestors wrote and no other block's" : view === 'ancestors-in-order' ? "holds its ancestors' replies in order" : view === 'no-sibling-history' ? 'holds no reply of a block outside its ancestors' : "holds each ancestor's user turn once, and no other block's"}`,
          cause:
            view === 'ancestor-files'
              ? "A code child starts from its parent's exported workspace: its ancestors' files, no sibling's."
              : view === 'ancestors-in-order'
                ? "A child's history holds its ancestors' replies, oldest first."
                : view === 'no-sibling-history'
                  ? "A child's history leaves out every block that is not its ancestor, even one run before it."
                  : "A child's history holds each ancestor's user turn once.",
          check: async ({ seed, scratch, product }) => {
            const rng = rngFor(seed, id);
            const { plans, written } = forestPlans(
              rng,
              shape,
              PLACEMENTS[0] as Placement,
              kind === 'code',
              true,
            );
            const r = recipe(seed, id, kind, plans, { parents: true });
            // Written out of order: a child before its parent, so the history is the forest's, not the file's.
            const { deliveries } = await play(
              product,
              {
                ...r,
                raw: { ...r.raw, blocks: written.map((i) => r.raw.blocks[i] as Record<string, unknown>) },
              },
              scratch,
            );
            const markers = r.blocks.map((block) => block.marker);
            for (const [i, block] of r.blocks.entries()) {
              const turns = deliveries.filter((each) => each.marker === block.marker);
              if (turns.length !== 1)
                return fail(`${block.id} should reach the agent once; it reached it ${turns.length} times`);
              const turn = turns[0] as (typeof deliveries)[number];
              const lineage: number[] = [];
              for (let p = plans[i]?.parent; p !== undefined; p = plans[p]?.parent) lineage.unshift(p);
              if (view === 'ancestor-files') {
                const want = lineage.map((a) => r.blocks[a]?.file?.path as string).sort();
                const got = (turn.files ?? []).filter((path) => path.startsWith('out/')).sort();
                if (got.join(',') !== want.join(','))
                  return fail(
                    `${block.id} should start with its ancestors' files ${list(want)}; it saw ${list(got)}`,
                  );
                continue;
              }
              const users = turn.history
                .filter((m) => m.role === 'user')
                .map((m) => markers.findIndex((marker) => m.content.includes(marker)));
              const before = users.slice(0, -1);
              if (view === 'ancestor-user-turns' || view === 'ancestors-in-order') {
                if (before.join(',') !== lineage.join(','))
                  return fail(
                    `${block.id} should hold the turns of its ancestors ${list(lineage.map((a) => r.blocks[a]?.id))}; it holds ${list(before.map((b) => r.blocks[b]?.id ?? 'other'))}`,
                  );
                if (view === 'ancestors-in-order') {
                  const replies = turn.history.filter((m) => m.role === 'assistant').length;
                  if (replies !== lineage.length)
                    return fail(
                      `${block.id} should hold ${lineage.length} ancestor replies; it holds ${replies}`,
                    );
                }
              } else {
                const stray = before.filter((b) => !lineage.includes(b));
                if (stray.length > 0)
                  return fail(
                    `${block.id} should hold no turn outside its ancestors; it holds ${list(stray.map((b) => r.blocks[b]?.id ?? 'other'))}`,
                  );
              }
            }
            return PASS;
          },
        });
      }
    }
  }
  return items;
}

/** PARENT_MISSING and PARENT_CYCLE refuse a spec of either kind; a forward reference loads. */
function errorItems(): BankItem[] {
  const items: BankItem[] = [];
  const cases = [
    { id: 'missing', code: 'PARENT_MISSING', tier: 1 },
    { id: 'self', code: 'PARENT_CYCLE', tier: 2 },
    { id: 'two-cycle', code: 'PARENT_CYCLE', tier: 2 },
    { id: 'long-cycle', code: 'PARENT_CYCLE', tier: 3 },
    { id: 'forward-reference', code: undefined, tier: 2 },
  ] as const;
  for (const kind of KINDS) {
    for (const errorCase of cases) {
      for (const size of [3, 6]) {
        const id = `parents/errors/${kind}/${errorCase.id}/${size}`;
        items.push({
          id,
          family: 'parents-errors',
          tier: errorCase.tier as Tier,
          level: 2,
          component: PARENTS,
          title: `a ${kind} spec of ${size} blocks whose parent links are ${errorCase.id.replace(/-/g, ' ')} ${errorCase.code ? `is refused with ${errorCase.code}` : 'loads'}`,
          cause: errorCase.code
            ? `The loader refuses parent links that are ${errorCase.id.replace(/-/g, ' ')} with ${errorCase.code}.`
            : 'The loader accepts a parent written after its child.',
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const plans: BlockPlan[] = Array.from({ length: size }, () => ({ fate: 'pass' }));
            const r = recipe(seed, id, kind, plans);
            const ids = r.blocks.map((block) => block.id);
            const parents: (string | undefined)[] = ids.map((_, i) =>
              i === 0 ? undefined : ids[between(rng, 0, i - 1)],
            );
            const x = between(rng, 1, size - 1);
            if (errorCase.id === 'missing') parents[x] = token(seed, `${id}#gone`);
            if (errorCase.id === 'self') parents[x] = ids[x];
            if (errorCase.id === 'two-cycle') {
              parents[0] = ids[x];
              parents[x] = ids[0];
            }
            if (errorCase.id === 'long-cycle')
              for (let i = 0; i < size; i += 1) parents[i] = ids[(i + 1) % size];
            const blocks = r.raw.blocks.map((block, i) => ({
              ...block,
              ...(parents[i] ? { parent: parents[i] } : {}),
            }));
            const ordered = errorCase.id === 'forward-reference' ? [...blocks].reverse() : blocks;
            const result = loadIssues(product, { ...r.raw, blocks: ordered });
            if (errorCase.code === undefined)
              return result.ok
                ? PASS
                : fail(`a forward reference should load; the loader answered ${list(result.codes)}`);
            if (result.ok || !result.codes.includes(errorCase.code))
              return fail(
                `the spec should be refused with ${errorCase.code}; the loader answered ${result.ok ? 'ok' : list(result.codes)}`,
              );
            // The near-miss twin: the same blocks with every link pointing at an earlier block of the spec. A loader
            // that refuses by the shape of the parent key, not by what it points at, refuses it too.
            const twin = r.raw.blocks.map((block, i) => ({
              ...block,
              ...(i === 0 ? {} : { parent: ids[between(rng, 0, i - 1)] }),
            }));
            const twinResult = loadIssues(product, {
              ...r.raw,
              blocks: twin,
            });
            return twinResult.ok
              ? PASS
              : fail(
                  `a twin spec whose links all point at earlier blocks should load; the loader refused it with ${list(twinResult.codes)}`,
                );
          },
        });
      }
    }
  }
  return items;
}

/** Level 2 of the blocks bank. */
export function parentItems(): BankItem[] {
  return [...verdictItems(), ...stateItems(), ...errorItems()];
}
