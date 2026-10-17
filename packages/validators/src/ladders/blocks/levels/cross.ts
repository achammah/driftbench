import { between, list, load, pick, type RawSpec, type Rng, rngFor, SHOP, shuffled } from '../harness';
import { plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BlockPlan, recipe } from '../recipe';
import { type BankItem, expectAll, fail, type Tier } from '../types';

/**
 * Cross-capability combinations (family F7 of the v3 partition): each item holds two documented behaviours
 * at once, so a product that builds each capability alone and never their meeting point fails it.
 *
 * Parents x blast radius. docs/concepts/blast-radius.md, "Parent blocks" (feat/block-parents): "A change that
 * reaches a parent also reaches every descendant, in F, T and P, regardless of authored order. Explicit forest
 * roots remain independent." docs/concepts/blast-radius.md, forward closure: "In mode F and P ... every block
 * after a direct block of the same run is in. In mode T ... nothing follows." docs/concepts/given-when-then.md,
 * "Parent blocks": "Once a spec declares a parent link, its blocks form a forest in every mode: each root starts
 * at the spec defaults"; "Child-only mode T selection automatically replays its ancestors when no in-run
 * recording exists. A replayed ancestor gives its end state and its cost, but it is not a measurement of that
 * run: it adds no block, verdict or count, and `blockRerun.reason` names it"; "A passed parent runs once per
 * run, however many children share it"; "If a parent fails, is `not_run`, or is already blocked, the child is
 * `blocked`: it receives no agent call ... `blocked.by` names its direct parent and `blocked.root` names the
 * original failed or unrun cause."
 *
 * Every id, marker, tool fixture and spec id is a token; the truth (which block is direct, replayed, blocked)
 * stays in the item.
 */

const RADIUS = 'packages/core/src/radius/radius.ts';
const RUNNER = 'packages/core/src/runner/run.ts';

/** A random tree of `n` nodes, by parent index (-1 for its root). */
function tree(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? -1 : between(rng, 0, i - 1)));
}

/** The indices below `at` in a forest given by parent index. */
function descendants(parents: readonly number[], at: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < parents.length; i += 1)
    for (let p = parents[i] ?? -1; p >= 0; p = parents[p] ?? -1) if (p === at) out.add(i);
  return out;
}

/** The indices above `at`, its parent first. */
function ancestors(parents: readonly number[], at: number): number[] {
  const out: number[] = [];
  for (let p = parents[at] ?? -1; p >= 0; p = parents[p] ?? -1) out.push(p);
  return out;
}

type Order = 'grouped' | 'interleaved' | 'reversed';

/** The written order of two trees: A then B, A and B alternating, or every block after its children. */
function written(a: number, b: number, order: Order): number[] {
  const left = [...Array(a).keys()];
  const right = Array.from({ length: b }, (_, i) => a + i);
  if (order === 'grouped') return [...left, ...right];
  if (order === 'reversed') return [...right, ...left].reverse();
  const out: number[] = [];
  for (let i = 0; i < Math.max(a, b); i += 1) {
    if (i < a) out.push(left[i] as number);
    if (i < b) out.push(right[i] as number);
  }
  return out;
}

type ForestRadius = {
  depth: 'root' | 'inner';
  mode: 'F' | 'T';
  order: Order;
};

/**
 * Two trees in one spec. One block of tree A lists the changed tool; every other block lists another tool, so
 * the direct set is that one block. The documented radius is that block and its descendants; every block of
 * tree B (another root), every ancestor and every sibling branch stays out, in mode F as in mode T.
 */
function forestRadiusItems(): BankItem[] {
  const items: BankItem[] = [];
  const cases: ForestRadius[] = [];
  for (const depth of ['root', 'inner'] as const)
    for (const mode of ['F', 'T'] as const)
      for (const order of ['grouped', 'interleaved', 'reversed'] as const) cases.push({ depth, mode, order });
  for (const c of cases) {
    const id = `cross/parents-radius/roots/${c.depth}/${c.mode}/${c.order}`;
    items.push({
      id,
      family: 'cross-parents-radius',
      tier: Math.min(5, 3 + (c.order === 'grouped' ? 0 : 1) + (c.depth === 'inner' ? 1 : 0)) as Tier,
      level: 7,
      component: RADIUS,
      title: `in a spec of two parent-linked trees written ${c.order}, a change reaching the ${c.depth} of one tree selects that block and its descendants in mode ${c.mode}, and leaves the other root's tree, every ancestor and every sibling branch out`,
      cause:
        'In a parent-linked spec the radius closes forward along parent links only: a change reaching one tree leaves every other root, ancestor and sibling branch out, in every mode.',
      check: async ({ seed, product }) => {
        const rng = rngFor(seed, id);
        const a = between(rng, 4, 6);
        const b = between(rng, 2, 4);
        const left = tree(rng, a);
        const right = tree(rng, b).map((p) => (p === -1 ? -1 : p + a));
        const parents = [...left, ...right];
        const inner = left.flatMap((p, i) => (p !== -1 && descendants(parents, i).size > 0 ? [i] : []));
        const leaves = left.flatMap((p, i) => (p !== -1 ? [i] : []));
        const at = c.depth === 'root' ? 0 : pick(rng, inner.length > 0 ? inner : leaves);
        const tools = shuffled(rng, SHOP.tools);
        const changed = tools[0] as string;
        const other = tools[1] as string;
        const ids = parents.map((_, i) => token(seed, `${id}#id#${i}`));
        const order = written(a, b, c.order);
        const raw: RawSpec = {
          id: `spec-${token(seed, `${id}#spec`)}`,
          channel: 'chat',
          metadata: { depends: { fixtures: [token(seed, `${id}#fixture`)] } },
          blocks: order.map((i) => ({
            id: ids[i],
            ...((parents[i] ?? -1) >= 0 ? { parent: ids[parents[i] as number] } : {}),
            user: `${token(seed, `${id}#m#${i}`, 8)} ${pick(rng, SHOP.customers)} asks about the ${pick(rng, SHOP.bikes)}.`,
            expect: { tools: [{ label: i === at ? changed : other, count: 1 }] },
          })),
        };
        const contentHash = need<(value: unknown) => string>(product.core, 'core', 'contentHash');
        const radiusOf = need<
          (
            specs: unknown[],
            manifest: unknown,
            options: unknown,
          ) => {
            whole: { reason: string } | null;
            specs: { blocks: { id: string; state: Record<string, string> }[] }[];
          }
        >(product.core, 'core', 'radiusOf');
        const spec = load(product, raw);
        const report = radiusOf(
          [{ spec, hash: contentHash(spec) }],
          {
            from: token(seed, `${id}#from`),
            to: token(seed, `${id}#to`),
            changes: [{ kind: 'tool', id: changed }],
          },
          { modes: [c.mode] },
        );
        if (report.whole) return fail(`the radius is the whole suite: ${report.whole.reason}`);
        const below = descendants(parents, at);
        const state = new Map(report.specs[0]?.blocks.map((block) => [block.id, block.state[c.mode]]));
        const misses: string[] = [];
        const extras: string[] = [];
        for (const [i, blockId] of ids.entries()) {
          const want = i === at ? 'direct' : below.has(i) ? 'forward' : 'out';
          const got = state.get(blockId) ?? 'missing';
          if (got === want) continue;
          const role =
            i === at
              ? 'the block the change reaches'
              : below.has(i)
                ? 'a descendant of it'
                : i >= a
                  ? 'a block of the other root'
                  : ancestors(parents, at).includes(i)
                    ? 'an ancestor of it'
                    : 'a block of a sibling branch';
          (want === 'out' ? extras : misses).push(`${blockId} (${role}) ${got}, should be ${want}`);
        }
        return expectAll([
          [misses.length === 0, `mode ${c.mode} misses ${misses.length}: ${list(misses, 4)}`],
          [extras.length === 0, `mode ${c.mode} selects ${extras.length} extra: ${list(extras, 4)}`],
        ]);
      },
    });
  }
  return items;
}

type RunRecord = {
  blocks: {
    blockId?: string;
    status?: string;
    pass: boolean;
    blocked?: { by: string; root: string };
  }[];
  blockRerun?: { selected: number[]; reason: string };
  status: string;
};

/** One mode T run of a raw spec with a block subset, through the product's runner and scripted driver. */
async function runSubset(
  product: BlocksProduct,
  raw: RawSpec,
  adapter: Record<string, unknown>,
  blocks: readonly number[],
): Promise<RunRecord> {
  const spec = load(product, raw);
  const runSpec = need<(spec: unknown, options: Record<string, unknown>) => Promise<RunRecord>>(
    product.core,
    'core',
    'runSpec',
  );
  const createScriptedDriver = need<() => unknown>(product.users, 'users', 'createScriptedDriver');
  const defaultChecks = need<() => unknown>(product.checks, 'checks', 'defaultChecks');
  const defaultReaders = need<() => unknown>(product.artifacts, 'artifacts', 'defaultReaders');
  return runSpec(spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    mode: 'T',
    repeat: 0,
    blocks: new Set(blocks),
    retry: { retries: 0, baseDelayMs: 0, sleep: async () => {} },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
  });
}

type Subset = {
  id: string;
  tier: number;
  /** A chain of `depth` ancestors above the block asked for, plus a sibling branch. */
  depth: number;
  /** Two children of one parent asked for together. */
  siblings?: boolean;
  /** The ancestor, counted from the block asked for (1 its parent), whose agent action fails. */
  failsAt?: number;
};

const SUBSETS: Subset[] = [
  { id: 'parent', tier: 3, depth: 1 },
  { id: 'grandparent', tier: 3, depth: 2 },
  { id: 'deep', tier: 4, depth: 3 },
  { id: 'two-siblings', tier: 4, depth: 1, siblings: true },
  { id: 'parent-fails', tier: 4, depth: 1, failsAt: 1 },
  { id: 'grandparent-fails', tier: 4, depth: 2, failsAt: 2 },
];

/**
 * A chain root .. parent .. asked, a sibling branch off the root, and a second root. In mode T the block subset
 * names only the blocks asked for: the product replays their ancestors for their end state, measures only the
 * blocks asked for, names the replayed ancestors in `blockRerun.reason`, runs a shared parent once, and blocks
 * a child whose replayed ancestor fails, by its parent, rooted at that ancestor, never sent.
 */
function subsetItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const s of SUBSETS) {
    for (const order of ['in-order', 'reversed'] as const) {
      const id = `cross/parents-radius/subset-T/${s.id}/${order}`;
      items.push({
        id,
        family: 'cross-parents-radius',
        tier: Math.min(5, s.tier + (order === 'reversed' ? 1 : 0)) as Tier,
        level: 7,
        component: RUNNER,
        title: `a mode T block subset that names only ${s.siblings ? 'two children of one parent' : `a block ${s.depth} below its root`} (written ${order})${s.failsAt ? ', whose replayed ancestor fails,' : ''} replays the ancestors for their end state, ${s.failsAt ? 'leaves the block blocked, by its parent, rooted at that ancestor, never sent' : 'sends each block asked for once, after its ancestors'}, measures only the blocks asked for and names every replayed ancestor`,
        cause: s.failsAt
          ? 'A mode T block subset whose replayed ancestor fails leaves the block asked for blocked, by its parent, rooted at that ancestor, never sent.'
          : s.siblings
            ? 'A mode T block subset replays a parent its selected children share once.'
            : 'A mode T block subset replays the ancestors of the blocks asked for, measures only those blocks and names every replayed ancestor.',
        check: async ({ seed, scratch, product }) => {
          // Chain 0 .. depth, a sibling branch off the root, a second root with a child.
          const parents: number[] = [-1];
          for (let i = 1; i <= s.depth; i += 1) parents.push(i - 1);
          const asked = [s.depth];
          if (s.siblings) {
            parents.push(s.depth - 1);
            asked.push(parents.length - 1);
          }
          parents.push(0);
          const branch = parents.length - 1;
          parents.push(-1, parents.length);
          const plans: BlockPlan[] = parents.map((parent, i) => ({
            fate: s.failsAt !== undefined && i === s.depth - s.failsAt ? 'fail' : 'pass',
            ...(parent === -1 ? {} : { parent }),
          }));
          const r = recipe(seed, id, 'normal', plans, { parents: true });
          const order0 = [...plans.keys()];
          const writtenOrder = order === 'in-order' ? order0 : [...order0].reverse();
          r.raw.blocks = writtenOrder.map((i) => r.raw.blocks[i] as Record<string, unknown>);
          const position = (i: number) => writtenOrder.indexOf(i);
          const agent = plantedAgent(product, 'normal', r.actions, { scratch });
          const record = await runSubset(
            product,
            r.raw,
            agent.adapter,
            asked.map(position).sort((x, y) => x - y),
          );
          const deliveries = agent.delivered();
          const sent = (i: number) => deliveries.filter((each) => each.marker === r.blocks[i]?.marker).length;
          const replayed = [...new Set(asked.flatMap((i) => ancestors(parents, i)))].sort((x, y) => x - y);
          const idOf = (i: number) => r.blocks[i]?.id as string;
          const measured = record.blocks.map((block) => block.blockId).sort();
          const wanted = asked.map(idOf).sort();
          if (measured.join(',') !== wanted.join(','))
            return fail(
              `the run should measure only the blocks asked for, ${list(wanted)}; it holds ${list(measured)}`,
            );
          const reason = record.blockRerun?.reason ?? '';
          const outside = parents
            .map((_, i) => i)
            .filter((i) => !replayed.includes(i) && !asked.includes(i) && reason.includes(idOf(i)));
          const conditions: [boolean, string][] = [
            [
              (record.blockRerun?.selected ?? []).join(',') ===
                asked
                  .map(position)
                  .sort((x, y) => x - y)
                  .join(','),
              `blockRerun.selected should be ${list(asked.map(position))}, the blocks asked for; got ${list(record.blockRerun?.selected ?? ['none'])}`,
            ],
            ...replayed.map(
              (i) =>
                [
                  reason.includes(idOf(i)),
                  `blockRerun.reason should name the replayed ancestor ${idOf(i)}; it reads "${reason.slice(0, 160)}"`,
                ] as [boolean, string],
            ),
            [
              outside.length === 0,
              `blockRerun.reason names blocks that were not replayed: ${list(outside.map(idOf))}`,
            ],
            [
              sent(branch) === 0 && sent(parents.length - 2) === 0,
              `a block outside the ancestors of the blocks asked for should never be sent; the sibling branch reached the agent ${sent(branch)} times, the other root ${sent(parents.length - 2)}`,
            ],
          ];
          const failing = s.failsAt === undefined ? undefined : s.depth - s.failsAt;
          for (const i of replayed) {
            // An ancestor below the failing one is blocked, never sent; the failing one and those above it run once.
            const expected = failing !== undefined && ancestors(parents, i).includes(failing) ? 0 : 1;
            conditions.push([
              sent(i) === expected,
              `the replayed ancestor ${idOf(i)} should reach the agent ${expected} time${expected === 1 ? '' : 's'}; it reached it ${sent(i)} times`,
            ]);
          }
          for (const i of asked) {
            const block = record.blocks.find((each) => each.blockId === idOf(i));
            if (failing === undefined) {
              conditions.push(
                [sent(i) === 1, `${idOf(i)} should reach the agent once; it reached it ${sent(i)} times`],
                [
                  block?.pass === true,
                  `${idOf(i)} should pass; got ${block?.status ?? (block?.pass ? 'pass' : 'fail')}`,
                ],
              );
              const history = deliveries.find((each) => each.marker === r.blocks[i]?.marker)?.history ?? [];
              const markers = r.blocks.map((each) => each.marker);
              const users = history
                .filter((m) => m.role === 'user')
                .map((m) => markers.findIndex((marker) => m.content.includes(marker)))
                .slice(0, -1);
              const lineage = ancestors(parents, i).reverse();
              conditions.push([
                users.join(',') === lineage.join(','),
                `${idOf(i)} should start from its replayed ancestors' turns ${list(lineage.map(idOf))}; it saw ${list(users.map((u) => (u < 0 ? 'other' : idOf(u))))}`,
              ]);
            } else {
              conditions.push(
                [
                  block?.status === 'blocked',
                  `${idOf(i)} should be blocked: its replayed ancestor ${idOf(failing)} failed; got ${block?.status ?? (block?.pass ? 'pass' : 'fail')}`,
                ],
                [
                  block?.blocked?.by === idOf(parents[i] as number) && block?.blocked?.root === idOf(failing),
                  `${idOf(i)} should be blocked by ${idOf(parents[i] as number)}, root ${idOf(failing)}; got by ${block?.blocked?.by ?? 'none'}, root ${block?.blocked?.root ?? 'none'}`,
                ],
                [
                  sent(i) === 0,
                  `${idOf(i)} is blocked and should never be sent; it reached the agent ${sent(i)} times`,
                ],
              );
            }
          }
          return expectAll(conditions);
        },
      });
    }
  }
  return items;
}

/** Family F7 of the blocks bank: cross-capability combinations. */
export function crossItems(): BankItem[] {
  return [...forestRadiusItems(), ...subsetItems()];
}
