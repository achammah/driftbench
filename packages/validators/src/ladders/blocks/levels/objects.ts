import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  between,
  list,
  loadIssues,
  observed,
  pick,
  type RawSpec,
  type Rng,
  type RunRecord,
  rngFor,
  run,
  SHOP,
  scriptedAdapter,
} from '../harness';
import { KINDS, type Kind, plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { recipe } from '../recipe';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';

/**
 * Level 4: rules as objects (PR 443, its command line PR 446 and the verdict stamps PR 449; docs/reference/
 * objects.md on those branches). The shipped `check-set` object `default` holds one item per shipped check,
 * named by the check (tools, forbidden, must, must_not, stage, lang, ...), then the runner's flow and ledger
 * items; `DEFAULT_CHECK_SET` of the checks package lists them. A spec or a block tailors it under `uses`: an override that names a real item loads, one that names an item the parent does not hold, adds
 * an item without its fields, mixes `order` with moves, or names an unknown object or implementation is refused
 * with its OBJECT_* code. `uses` enters the spec hash and no block cache key. `driftbench object` lists, shows,
 * explains (with the `--set` preflight), inits, validates, diffs and graphs objects with the documented exits.
 * Every tool verdict names the object, item, implementation and layer that produced it.
 */

const LOADER = 'packages/core/src/objects/index.ts';
const RULES = 'packages/core/src/objects/rules.ts';
const RESOLVE = 'packages/core/src/objects/resolve.ts';
const LAYERS = 'packages/core/src/objects/layers.ts';
const OBJECT_CLI = 'packages/cli/src/commands/object.ts';
const STAMPS = 'packages/core/src/runner/run.ts';

/** Items of check-set:default the overrides draw from: checks every block of this level can produce. */
export const CHECK_SET_ITEMS = ['tools', 'forbidden', 'must', 'must_not', 'stage', 'lang'] as const;

/** The check-set items each kind's blocks produce verdicts for, the overrides draw from these. */
export const KIND_ITEMS: Record<Kind, readonly string[]> = {
  normal: CHECK_SET_ITEMS,
  code: ['artifacts', 'workspace', 'execution', 'safety', 'skills', 'guards'],
};

/** Every item id of the shipped check-set:default, in its order, as the product's checks package exports it. */
function shippedOrder(product: BlocksProduct): string[] {
  const set = need<{ items: { id: string }[]; order?: string[] }>(
    product.checks,
    'checks',
    'DEFAULT_CHECK_SET',
  );
  return set.order ? [...set.order] : set.items.map((item) => item.id);
}

const LAYERS_ENUM = ['shipped', 'project', 'suite', 'spec', 'block', 'cli'];

type Override = {
  id: string;
  tier: Tier;
  /** The `uses.check_set` value, from a seeded draw; `code` the refusal, or undefined when it loads. */
  build(
    p: <T>(items: readonly T[]) => T,
    rng: Rng,
    order: readonly string[],
    pool: readonly string[],
  ): { ref: unknown; code: string | undefined };
};

/** A name that says nothing about the item: seeded letters and digits. */
const neutral = (rng: Rng) =>
  `n${Math.floor(rng() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const others = (item: string, pool: readonly string[]) => pool.filter((each) => each !== item);

const OVERRIDES: Override[] = [
  {
    id: 'disable-an-item',
    tier: 1,
    build: (p, _rng, _order, pool) => ({
      ref: { extends: 'default', items: [{ id: p(pool), enabled: false }] },
      code: undefined,
    }),
  },
  {
    id: 'move-before',
    tier: 2,
    build: (p, _rng, order, pool) => {
      // The later of two items moves before the earlier one, so the move changes the order.
      const one = p(pool);
      const two = p(others(one, pool));
      const [early, late] = order.indexOf(one) < order.indexOf(two) ? [one, two] : [two, one];
      return { ref: { extends: 'default', items: [{ id: late, before: early }] }, code: undefined };
    },
  },
  {
    id: 'order-permutation',
    tier: 2,
    build: (_p, _rng, order, _pool) => ({
      // The shipped order reversed: every pair of checks a block produces changes places.
      ref: { extends: 'default', order: [...order].reverse() },
      code: undefined,
    }),
  },
  {
    id: 'unknown-item-typo',
    tier: 1,
    build: (p, _rng, _order, pool) => {
      const item = p(pool);
      const typo = p([item.toUpperCase(), `${item}s`, item.slice(0, -1), `${item}.count`]);
      return {
        ref: { extends: 'default', items: [{ id: typo, enabled: false }] },
        code: 'OBJECT_ITEM_UNKNOWN',
      };
    },
  },
  {
    id: 'unknown-item-new',
    tier: 2,
    build: (p, _rng, _order, _pool) => ({
      ref: {
        extends: 'default',
        items: [{ id: p(['latency', 'retry_budget', 'R3', 'tools.count']), enabled: true }],
      },
      code: 'OBJECT_ITEM_UNKNOWN',
    }),
  },
  {
    id: 'add-incomplete',
    tier: 3,
    build: (_p, rng, _order, _pool) => ({
      ref: {
        extends: 'default',
        items: [{ id: neutral(rng), add: true, title: 'A new check' }],
      },
      code: 'OBJECT_ITEM_INCOMPLETE',
    }),
  },
  {
    id: 'add-existing',
    tier: 3,
    build: (p, _rng, _order, pool) => {
      const item = p(pool);
      return {
        ref: {
          extends: 'default',
          items: [
            {
              id: item,
              add: true,
              title: 'Again',
              when: {},
              effect: { gating: true },
              impl: `builtin:check/${item}`,
            },
          ],
        },
        code: 'OBJECT_ITEM_EXISTS',
      };
    },
  },
  {
    id: 'order-and-move',
    tier: 4,
    build: (p, _rng, order, pool) => {
      const item = p(pool);
      return {
        ref: { extends: 'default', order: [...order], items: [{ id: item, after: p(others(item, pool)) }] },
        code: 'OBJECT_ORDER_INVALID',
      };
    },
  },
  {
    id: 'order-missing-an-item',
    tier: 4,
    build: (p, _rng, order, pool) => {
      const dropped = p(pool);
      return {
        ref: { extends: 'default', order: order.filter((item) => item !== dropped) },
        code: 'OBJECT_ORDER_INVALID',
      };
    },
  },
  {
    id: 'unknown-impl',
    tier: 3,
    build: (p, _rng, _order, pool) => ({
      ref: {
        extends: 'default',
        items: [{ id: p(pool), impl: p(['builtin:check/nope', 'builtin:checks/tools-count']) }],
      },
      code: 'OBJECT_IMPL_UNKNOWN',
    }),
  },
  {
    id: 'unknown-object',
    tier: 1,
    build: (p, rng, _order, _pool) => ({
      ref: p([neutral(rng), 'defaults', 'Default']),
      code: 'OBJECT_UNKNOWN',
    }),
  },
  {
    id: 'unknown-parent',
    tier: 2,
    build: (p, rng, _order, _pool) => ({
      ref: { extends: p([neutral(rng), 'default2']), items: [] },
      code: 'OBJECT_UNKNOWN',
    }),
  },
];

function toolSpec(seed: number, tag: string, uses: { spec?: unknown; block?: unknown }): RawSpec {
  const rng = rngFor(seed, `${tag}#spec`);
  const n = between(rng, 2, 3);
  return {
    id: `spec-${token(seed, `${tag}#spec`)}`,
    channel: 'chat',
    ...(uses.spec === undefined ? {} : { uses: { check_set: uses.spec } }),
    blocks: Array.from({ length: n }, (_, index) => ({
      id: `b${index}`,
      user: `[${token(seed, tag)}:${index}] Is the ${pick(rng, SHOP.bikes)} free?`,
      ...(index === n - 1 && uses.block !== undefined ? { uses: { check_set: uses.block } } : {}),
      expect: {
        must: ['free'],
        tools: [
          { label: 'bikes.lookup', count: 1 },
          { label: 'payment.charge', count: 0 },
        ],
      },
    })),
  };
}

/**
 * A planted spec of `kind` with `uses` at the spec or on its last block. NORMAL blocks also expect a tool never
 * called (a `forbidden` verdict); CODE blocks also cap destructive operations (a `safety` verdict).
 */
function objectSpec(seed: number, tag: string, kind: Kind, uses: { spec?: unknown; block?: unknown }) {
  const r = recipe(seed, tag, kind, [
    { fate: 'pass' },
    { fate: 'pass' },
    { fate: kind === 'code' ? 'pass' : 'fail' },
  ]);
  const raw: RawSpec = structuredClone(r.raw);
  if (uses.spec !== undefined) raw.uses = { check_set: uses.spec };
  raw.blocks.forEach((block, index) => {
    const expect = block.expect as Record<string, unknown>;
    if (kind === 'normal') (expect.tools as unknown[]).push({ label: 'payment.charge', count: 0 });
    else expect.safety = { max_destructive_ops: 0 };
    if (index === raw.blocks.length - 1 && uses.block !== undefined) block.uses = { check_set: uses.block };
  });
  return { raw, r };
}

function loaderItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const kind of KINDS)
    for (const override of OVERRIDES) {
      for (const place of ['spec', 'block'] as const) {
        const id = `objects/loader/${kind}/${override.id}/${place}`;
        const sample = override.build(
          (xs) => xs[0] as never,
          () => 0,
          [...KIND_ITEMS[kind]],
          KIND_ITEMS[kind],
        );
        items.push({
          id,
          family: `objects-loader-${kind}`,
          tier: Math.min(5, override.tier + (kind === 'code' ? 1 : 0)) as Tier,
          level: 3,
          component:
            sample.code === undefined
              ? LOADER
              : sample.code.includes('ORDER') || sample.code.includes('ITEM')
                ? RULES
                : RESOLVE,
          title: `a ${place}-level uses.check_set on a ${kind} spec that ${override.id.replace(/-/g, ' ')} ${sample.code === undefined ? 'loads' : `is refused with ${sample.code}`}`,
          cause:
            sample.code === undefined
              ? 'The loader resolves spec and block uses against the shipped objects.'
              : `The loader's resolve pass refuses ${override.id.replace(/-/g, ' ')} with ${sample.code}.`,
          check: async ({ seed, scratch, product }) => {
            const rng = rngFor(seed, id);
            const checkOfId = (verdictId: string) => verdictId.split('.')[0] as string;
            let pool: readonly string[] = KIND_ITEMS[kind];
            const shipped = shippedOrder(product);
            let order: readonly string[] = shipped;
            if (override.id.startsWith('order') && !KIND_ITEMS[kind].every((item) => shipped.includes(item)))
              return fail(
                `the shipped check set exports the order ${list(shipped)}, which lacks the items ${list(KIND_ITEMS[kind])}`,
              );
            if (sample.code === undefined) {
              // The override draws from the checks the reached blocks produce without it, so its effect shows.
              const plain = objectSpec(seed, id, kind, {});
              const before = await run(
                product,
                plain.raw,
                plantedAgent(product, kind, plain.r.actions, { scratch }).adapter,
              );
              const reachedBefore = place === 'spec' ? before.blocks : before.blocks.slice(-1);
              pool = KIND_ITEMS[kind].filter((item) =>
                reachedBefore.every((block) => block.verdicts.some((v) => checkOfId(v.id) === item)),
              );
              if (pool.length < 2)
                return fail(
                  `without the override, the reached blocks give verdicts of ${list(pool)} only, out of ${list(KIND_ITEMS[kind])}: the override has nothing to change`,
                );
              // A move is drawn against the order the checks ran in; an order must list the whole shipped set.
              const ran = [...new Set((reachedBefore[0]?.verdicts ?? []).map((v) => checkOfId(v.id)))];
              if (override.id === 'move-before') order = ran;
            }
            const { ref, code } = override.build((xs) => pick(rng, xs), rng, order, pool);
            const { raw, r } = objectSpec(seed, id, kind, place === 'spec' ? { spec: ref } : { block: ref });
            const result = loadIssues(product, raw);
            if (code === undefined) {
              if (!result.ok) return fail(`the loader refused ${JSON.stringify(ref)}: ${list(result.codes)}`);
              // Loading is not enough: the override must act on the blocks it reaches (block-contracts.md, Items).
              const record = await run(
                product,
                raw,
                plantedAgent(product, kind, r.actions, { scratch }).adapter,
              );
              const reached = place === 'spec' ? record.blocks : record.blocks.slice(-1);
              const checkOf = (verdictId: string) => verdictId.split('.')[0] as string;
              const tailored = ref as {
                items?: { id: string; enabled?: boolean; before?: string }[];
                order?: string[];
              };
              for (const block of reached) {
                const names = [...new Set(block.verdicts.map((v) => checkOf(v.id)))];
                for (const item of tailored.items ?? []) {
                  if (item.enabled === false && names.includes(item.id))
                    return fail(
                      `${item.id} is disabled by ${JSON.stringify(ref)}, yet block ${block.index} still has its verdicts`,
                    );
                  if (
                    item.before &&
                    names.includes(item.id) &&
                    names.includes(item.before) &&
                    names.indexOf(item.id) > names.indexOf(item.before)
                  )
                    return fail(
                      `${item.id} moves before ${item.before}, yet block ${block.index} judges it after (${list(names)})`,
                    );
                }
                if (tailored.order) {
                  const seen = names.filter((name) => tailored.order?.includes(name));
                  const want = tailored.order.filter((name) => seen.includes(name));
                  if (seen.join(',') !== want.join(','))
                    return fail(
                      `the order ${list(tailored.order)} should set the order of the checks of block ${block.index}; they ran ${list(seen)}`,
                    );
                }
              }
              return PASS;
            }
            if (result.ok || !result.codes.includes(code))
              return fail(
                `the override ${JSON.stringify(ref)} should be refused with ${code}; the loader answered ${result.ok ? 'ok' : list(result.codes)}`,
              );
            // The near-miss twin: an override of the same shape that names a real item. A loader that refuses
            // every override, or every one of this shape, refuses it too.
            const real = { extends: 'default', items: [{ id: pick(rng, KIND_ITEMS[kind]), enabled: false }] };
            const twin = objectSpec(
              seed,
              `${id}#twin`,
              kind,
              place === 'spec' ? { spec: real } : { block: real },
            ).raw;
            const twinResult = loadIssues(product, twin);
            if (!twinResult.ok)
              return fail(
                `a twin override ${JSON.stringify(real)} that names a real item should load; the loader refused it with ${list(twinResult.codes)}`,
              );
            // The far twin: the same refusal reached by another way the docs name. An unknown id under any uses
            // key is refused (block-contracts.md, Unknown parent); a new item lacking any one of title, when, effect
            // and impl is refused (cli.md, OBJECT_ITEM_INCOMPLETE).
            const far = farTwin(override.id, rng, kind);
            if (!far) return PASS;
            const farRaw = objectSpec(seed, `${id}#far`, kind, {}).raw;
            if (place === 'spec') farRaw.uses = far.uses;
            else (farRaw.blocks.at(-1) as Record<string, unknown>).uses = far.uses;
            const farResult = loadIssues(product, farRaw);
            return !farResult.ok && farResult.codes.includes(code)
              ? PASS
              : fail(
                  `${JSON.stringify(far.uses)} should be refused with ${code} too; the loader answered ${farResult.ok ? 'ok' : list(farResult.codes)}`,
                );
          },
        });
      }
    }
  return items;
}

/** The uses keys other than check_set, each naming an object of its own kind. */
const OTHER_USES = ['blame', 'placement', 'gating', 'stats', 'selection'] as const;

/** A second refusal of the same code for the override, written another documented way; none for the rest. */
function farTwin(override: string, rng: Rng, kind: Kind): { uses: Record<string, unknown> } | undefined {
  if (override === 'unknown-object') return { uses: { [pick(rng, OTHER_USES)]: neutral(rng) } };
  if (override === 'unknown-parent')
    return { uses: { [pick(rng, OTHER_USES)]: { extends: neutral(rng), items: [] } } };
  if (override === 'add-incomplete') {
    const full: Record<string, unknown> = {
      id: neutral(rng),
      add: true,
      title: 'A new check',
      when: {},
      effect: { gating: true },
      impl: `builtin:check/${pick(rng, KIND_ITEMS[kind])}`,
    };
    delete full[pick(rng, ['title', 'when', 'effect'])];
    return { uses: { check_set: { extends: 'default', items: [full] } } };
  }
  return undefined;
}

function memoryCache() {
  const map = new Map<string, unknown>();
  return {
    cacheGet: async (key: string) => map.get(key),
    cachePut: async (key: string, value: unknown) => {
      map.set(key, structuredClone(value));
    },
  };
}

/** `uses` enters the spec hash and no block cache key. */
function hashItems(): BankItem[] {
  const places = [
    { id: 'spec', uses: (ref: unknown) => ({ spec: ref }) },
    { id: 'block', uses: (ref: unknown) => ({ block: ref }) },
    { id: 'both', uses: (ref: unknown) => ({ spec: 'default', block: ref }) },
    { id: 'named-default', uses: () => ({ spec: 'default' }) },
  ];
  return KINDS.flatMap((kind) =>
    places.map((place) => {
      const id = `objects/hash/${kind}/${place.id}`;
      return {
        id,
        family: `objects-loader-${kind}`,
        tier: 3 as Tier,
        level: 3,
        component: LOADER,
        title: `a ${place.id} uses on a ${kind} spec changes the spec hash and leaves every block cache key as it was`,
        cause: 'uses is part of the spec hash and is left out of the block cache key.',
        check: async ({ seed, scratch, product }) => {
          const ref = {
            extends: 'default',
            items: [{ id: kind === 'code' ? 'skills' : 'lang', enabled: false }],
          };
          const plain = objectSpec(seed, id, kind, {});
          const tailored = objectSpec(seed, id, kind, place.uses(ref));
          const cache = memoryCache();
          const agent = () => plantedAgent(product, kind, plain.r.actions, { scratch }).adapter;
          const a = await run(product, plain.raw, agent(), { cache });
          const b = await run(product, tailored.raw, agent(), { cache });
          const keysA = a.blocks.map((block) => (block as { cacheKey?: string }).cacheKey);
          const keysB = b.blocks.map((block) => (block as { cacheKey?: string }).cacheKey);
          const first = expectAll([
            [a.specHash !== b.specHash, 'the spec hash is the same with and without uses'],
            [keysA.every((key) => key !== undefined), 'a block records no cache key'],
            [
              keysA.join(',') === keysB.join(','),
              `uses changed the block cache keys: ${list(keysA, 3)} against ${list(keysB, 3)}`,
            ],
          ]);
          if (!first.pass || kind === 'code') return first;
          // The twin, on a normal block (a sandboxed code block is not replayed from the cache): a change to uses
          // re-scores the stored observations and never reruns the agent
          // (block-contracts.md, Uses and the hashes). Disable a check that scored the first run: the replay calls
          // the agent no time, and the blocks the object reaches lose that check's verdicts.
          const disabled = 'tools';
          const strong = { extends: 'default', items: [{ id: disabled, enabled: false }] };
          const uses = place.id === 'named-default' ? { spec: strong } : place.uses(strong);
          const rescored = objectSpec(seed, id, kind, uses);
          const replayAgent = plantedAgent(product, kind, plain.r.actions, { scratch });
          const c = await run(product, rescored.raw, replayAgent.adapter, { cache });
          const checkOf = (verdictId: string) => verdictId.split('.')[0] as string;
          const reached = place.id === 'spec' || place.id === 'named-default' ? c.blocks : c.blocks.slice(-1);
          const scoredBefore = a.blocks.some((block) =>
            block.verdicts.some((v) => checkOf(v.id) === disabled),
          );
          const left = reached.filter((block) => block.verdicts.some((v) => checkOf(v.id) === disabled));
          return expectAll([
            [scoredBefore, `the first run gave no ${disabled} verdict to disable`],
            [
              replayAgent.delivered().length === 0,
              `a change to uses reran the agent ${replayAgent.delivered().length} times; it should re-score the stored observations`,
            ],
            [
              left.length === 0,
              `uses disables ${disabled}, yet the re-scored blocks ${list(left.map((block) => String(block.index)))} keep its verdicts`,
            ],
          ]);
        },
      };
    }),
  );
}

type CliCase = {
  id: string;
  tier: Tier;
  exit: number;
  /** Writes the project under `dir` and returns the arguments after `object`, and text the output must hold. */
  setup(
    dir: string,
    p: <T>(items: readonly T[]) => T,
    seed: number,
  ): { args: string[]; holds?: RegExp[]; file?: string };
  /**
   * The twin, run in the same project after the case passes: the same command reaching the object another
   * documented way (an inline object of driftbench.yaml, another kind, an object file), with its own exit.
   */
  twin?(
    dir: string,
    p: <T>(items: readonly T[]) => T,
    seed: number,
  ): {
    args: string[];
    exit: number;
    holds?: RegExp[];
    fileHolds?: { file: string; words: readonly string[] };
  };
};

/** Adds objects to the `objects:` key of the project's driftbench.yaml. */
function addInline(dir: string, ...objects: unknown[]) {
  const file = join(dir, 'driftbench.yaml');
  const config = (parse(readFileSync(file, 'utf8')) ?? {}) as { objects?: unknown[] };
  writeFileSync(file, stringify({ ...config, objects: [...(config.objects ?? []), ...objects] }));
}

/** Policy kinds other than check-set and value-check that ship a `default` (blame.md). */
const OTHER_KINDS = ['policy/blame', 'policy/placement'];
const inlineId = (seed: number) => token(seed, 'project#inline');

const projectObject = (id: string, item: string) => ({
  kind: 'check-set',
  id,
  extends: 'default',
  items: [{ id: item, enabled: false }],
});

/** A project: driftbench.yaml with one inline object, one object file, and a spec whose last block uses it. */
function writeProject(dir: string, p: <T>(items: readonly T[]) => T, seed: number) {
  const objectId = token(seed, 'project#inline');
  const fileId = token(seed, 'project#file');
  const item = p(CHECK_SET_ITEMS);
  mkdirSync(join(dir, 'driftbench', 'check-set'), { recursive: true });
  writeFileSync(join(dir, 'driftbench.yaml'), stringify({ objects: [projectObject(objectId, item)] }));
  writeFileSync(
    join(dir, 'driftbench', 'check-set', `${fileId}.yaml`),
    stringify(projectObject(fileId, p(others(item, CHECK_SET_ITEMS)))),
  );
  const spec = toolSpec(seed, `cli-${objectId}`, { block: objectId });
  const specPath = join(dir, 'spec.yaml');
  writeFileSync(specPath, stringify(spec));
  return { objectId, fileId, item, specPath, last: `b${spec.blocks.length - 1}` };
}

const CLI_CASES: CliCase[] = [
  {
    id: 'list',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: ['list', 'check-set'],
        holds: [new RegExp(project.objectId), new RegExp(project.fileId), /project/],
      };
    },
  },
  {
    id: 'show-default',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      return {
        args: ['show', 'check-set/default'],
        holds: CHECK_SET_ITEMS.map((item) => new RegExp(`\\b${item}\\b`)),
      };
    },
    twin: (_dir, p) => {
      const kind = p(OTHER_KINDS);
      return { args: ['show', `${kind}/default`], exit: 0, holds: [/default/] };
    },
  },
  {
    id: 'show-project',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: ['show', `check-set/${project.objectId}`],
        holds: [new RegExp(project.item.replace('.', '\\.')), /project/],
      };
    },
  },
  {
    id: 'show-unknown-kind',
    tier: 1,
    exit: 2,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const kind = p(['check-sets', 'checkset', 'policy/valuecheck']);
      return { args: ['show', `${kind}/default`], holds: [new RegExp(escapeRegExp(kind))] };
    },
    twin: (_dir, p) => {
      const kind = p(OTHER_KINDS);
      return { args: ['show', `${kind}/default`], exit: 0, holds: [/default/] };
    },
  },
  {
    id: 'show-unknown-id',
    tier: 1,
    exit: 2,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const id = p([token(seed, 'show#id'), 'defaults']);
      return { args: ['show', `check-set/${id}`], holds: [new RegExp(id)] };
    },
    twin: (_dir, _p, seed) => ({
      args: ['show', `check-set/${inlineId(seed)}`],
      exit: 0,
      holds: [new RegExp(inlineId(seed))],
    }),
  },
  {
    id: 'explain-block',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: ['explain', 'check-set', '--at', `${project.specPath}#${project.last}`],
        holds: [new RegExp(project.objectId), /project/],
      };
    },
  },
  {
    id: 'explain-set-cli-layer',
    tier: 3,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: [
          'explain',
          'policy/value-check',
          '--at',
          `${project.specPath}#b0`,
          '--set',
          `policy/value-check#rung1_outcome.distractors_required=${p(['false', 'true'])}`,
        ],
        holds: [/cli/, /distractors_required/],
      };
    },
  },
  {
    id: 'explain-set-unknown-item',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: [
          'explain',
          'check-set',
          '--at',
          `${project.specPath}#b0`,
          '--set',
          `check-set#${p(['tool', 'mus', 'R3'])}.limit=2`,
        ],
        holds: [/must_not/],
      };
    },
  },
  {
    id: 'explain-set-unknown-object',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: [
          'explain',
          'check-set',
          '--at',
          `${project.specPath}#b0`,
          '--set',
          `check-set/${token(seed, 'set#absent')}#must.limit=2`,
        ],
      };
    },
    twin: (dir, p, seed) => {
      const id = token(seed, 'set#inline');
      addInline(dir, { kind: 'policy/value-check', id, extends: 'default', items: [] });
      return {
        args: [
          'explain',
          'policy/value-check',
          '--at',
          `${join(dir, 'spec.yaml')}#b0`,
          '--set',
          `policy/value-check/${id}#rung1_outcome.distractors_required=${p(['false', 'true'])}`,
        ],
        exit: 0,
        holds: [/distractors_required/],
      };
    },
  },
  {
    id: 'explain-missing-block',
    tier: 2,
    exit: 2,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      const block = p(['b9', 'recap', 'blocks.12']);
      return {
        args: ['explain', 'check-set', '--at', `${project.specPath}#${block}`],
        holds: [new RegExp(escapeRegExp(block))],
      };
    },
  },
  {
    id: 'explain-unresolved',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const specPath = join(dir, `${token(seed, 'explain#spec')}.yaml`);
      // The spec layer names the object, so the block explained (b0) is one that names it.
      writeFileSync(
        specPath,
        stringify(toolSpec(seed, 'explain#unresolved', { spec: token(seed, 'explain#object') })),
      );
      return { args: ['explain', 'check-set', '--at', `${specPath}#b0`] };
    },
    twin: (dir, _p, seed) => {
      const specPath = join(dir, `${token(seed, 'explain#inline-spec')}.yaml`);
      writeFileSync(specPath, stringify(toolSpec(seed, 'explain#resolved', { spec: inlineId(seed) })));
      return {
        args: ['explain', 'check-set', '--at', `${specPath}#b0`],
        exit: 0,
        holds: [new RegExp(inlineId(seed))],
      };
    },
  },
  {
    id: 'init-then-validate',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'driftbench', 'check-set', `${token(seed, 'init#file')}.yaml`);
      return {
        args: ['init', 'check-set', token(seed, 'init#id'), '--from', 'default', '--out', file],
        file,
      };
    },
    twin: (dir, _p, seed) => {
      const file = join(dir, 'driftbench', 'check-set', `${token(seed, 'init#commented')}.yaml`);
      return {
        args: ['init', 'check-set', token(seed, 'init#commented'), '--from', 'default', '--out', file],
        exit: 0,
        fileHolds: { file, words: CHECK_SET_ITEMS },
      };
    },
  },
  {
    id: 'init-existing',
    tier: 2,
    exit: 2,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: [
          'init',
          'check-set',
          project.fileId,
          '--from',
          'default',
          '--out',
          join(dir, 'driftbench', 'check-set', `${project.fileId}.yaml`),
        ],
        holds: [new RegExp(project.fileId)],
      };
    },
    twin: (dir, _p, seed) => ({
      args: [
        'init',
        'check-set',
        inlineId(seed),
        '--from',
        'default',
        '--out',
        join(dir, 'driftbench', 'check-set', `${token(seed, 'init#again')}.yaml`),
      ],
      exit: 2,
      holds: [new RegExp(inlineId(seed))],
    }),
  },
  {
    id: 'validate-project',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      return { args: ['validate'] };
    },
    twin: (dir, p, seed) => {
      addInline(dir, {
        kind: 'check-set',
        id: token(seed, 'validate#inline-bad'),
        extends: 'default',
        items: [{ id: p(['Must', 'tools.count', 'forbiden']), enabled: false }],
      });
      return { args: ['validate'], exit: 1 };
    },
  },
  {
    id: 'validate-shipped-redefined',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'driftbench', 'check-set', 'default.yaml');
      writeFileSync(file, stringify({ kind: 'check-set', id: 'default', extends: null, items: [] }));
      return { args: ['validate', file], holds: [/immutable/] };
    },
    twin: (dir) => {
      rmSync(join(dir, 'driftbench', 'check-set', 'default.yaml'));
      addInline(dir, { kind: 'check-set', id: 'default', extends: null, items: [] });
      return { args: ['validate'], exit: 1 };
    },
  },
  {
    id: 'validate-unknown-item',
    tier: 2,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, `${token(seed, 'validate#file')}.yaml`);
      writeFileSync(
        file,
        stringify({
          kind: 'check-set',
          id: token(seed, 'validate#file'),
          extends: 'default',
          items: [{ id: p(['Must', 'tools.count', 'forbiden']), enabled: false }],
        }),
      );
      return { args: ['validate', file], holds: [/unknown item/] };
    },
    twin: (dir, p, seed) => {
      addInline(dir, {
        kind: 'check-set',
        id: token(seed, 'validate#inline-item'),
        extends: inlineId(seed),
        items: [{ id: p(['Must', 'tools.count', 'forbiden']), enabled: false }],
      });
      return { args: ['validate'], exit: 1 };
    },
  },
  {
    id: 'validate-cycle',
    tier: 4,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const a = token(seed, 'graph#a');
      const b = token(seed, 'graph#b');
      writeFileSync(
        join(dir, 'driftbench', 'check-set', `${a}.yaml`),
        stringify({ kind: 'check-set', id: a, extends: b, items: [] }),
      );
      writeFileSync(
        join(dir, 'driftbench', 'check-set', `${b}.yaml`),
        stringify({ kind: 'check-set', id: b, extends: a, items: [] }),
      );
      return { args: ['validate'], holds: [/cycle/] };
    },
    twin: (dir, _p, seed) => {
      rmSync(join(dir, 'driftbench', 'check-set', `${token(seed, 'graph#a')}.yaml`));
      rmSync(join(dir, 'driftbench', 'check-set', `${token(seed, 'graph#b')}.yaml`));
      const a = token(seed, 'graph#inline-a');
      const b = token(seed, 'graph#inline-b');
      addInline(
        dir,
        { kind: 'check-set', id: a, extends: b, items: [] },
        { kind: 'check-set', id: b, extends: a, items: [] },
      );
      return { args: ['validate'], exit: 1 };
    },
  },
  {
    id: 'validate-add-incomplete',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'add.yaml');
      writeFileSync(
        file,
        stringify({
          kind: 'check-set',
          id: 'adds',
          extends: 'default',
          items: [{ id: 'extra_check', add: true, title: 'Extra' }],
        }),
      );
      return { args: ['validate', file], holds: [/needs .*when/] };
    },
    twin: (dir, p) => {
      const file = join(dir, 'add-impl.yaml');
      const item = p(CHECK_SET_ITEMS);
      writeFileSync(
        file,
        stringify({
          kind: 'check-set',
          id: 'adds2',
          extends: 'default',
          items: [
            {
              id: 'extra_check',
              add: true,
              title: 'Extra',
              effect: { gating: true },
              impl: `builtin:check/${item}`,
            },
          ],
        }),
      );
      return { args: ['validate', file], exit: 1, holds: [/needs .*when/] };
    },
  },
  {
    id: 'diff-differ',
    tier: 2,
    exit: 1,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: ['diff', 'check-set/default', `check-set/${project.objectId}`],
        holds: [new RegExp(project.item.replace('.', '\\.'))],
      };
    },
    twin: (dir, p, seed) => {
      const item = p(CHECK_SET_ITEMS);
      const a = token(seed, 'diff#inline-a');
      const b = token(seed, 'diff#inline-b');
      addInline(dir, projectObject(a, item), projectObject(b, item));
      return { args: ['diff', `check-set/${a}`, `check-set/${b}`], exit: 0 };
    },
  },
  {
    id: 'diff-same',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      return { args: ['diff', 'check-set/default', 'check-set/default'] };
    },
    twin: (dir, _p, seed) => {
      const file = join(dir, `${token(seed, 'diff#file')}.yaml`);
      writeFileSync(
        file,
        stringify({ kind: 'check-set', id: token(seed, 'diff#file'), extends: 'default', items: [] }),
      );
      return { args: ['diff', 'check-set/default', file], exit: 0 };
    },
  },
  {
    id: 'graph',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return { args: ['graph', project.specPath], holds: [new RegExp(project.objectId)] };
    },
  },
];

function cliItems(): BankItem[] {
  return CLI_CASES.map((cliCase) => {
    const id = `objects/cli/${cliCase.id}`;
    return {
      id,
      family: 'objects-cli',
      tier: cliCase.tier,
      level: 3,
      component: cliCase.id.startsWith('explain-set') ? LAYERS : OBJECT_CLI,
      title: `driftbench object ${cliCase.id.replace(/-/g, ' ')} exits ${cliCase.exit} and names what it read`,
      cause: cliCase.id.startsWith('explain-set')
        ? 'The --set preflight resolves the object and refuses an item or object no layer defines.'
        : `driftbench object ${cliCase.id.split('-')[0]} exits as docs/reference/cli.md documents.`,
      check: async ({ seed, scratch, product }) => {
        const rng = rngFor(seed, id);
        const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
        mkdirSync(dir, { recursive: true });
        const { args, holds, file } = cliCase.setup(dir, (xs) => pick(rng, xs), seed);
        const result = await product.cli(['object', ...args], dir);
        const text = `${result.out}\n${result.err}`;
        if (/unknown command/.test(text))
          return fail(`the command line has no object command: ${text.trim().slice(0, 160)}`);
        const missing = (holds ?? []).filter((pattern) => !pattern.test(text));
        if (result.code !== cliCase.exit)
          return fail(
            `object ${args.join(' ')} exited ${result.code}, expected ${cliCase.exit}: ${text.trim().slice(0, 240)}`,
          );
        if (missing.length > 0)
          return fail(`the output lacks ${list(missing.map(String))}: ${text.trim().slice(0, 240)}`);
        if (file !== undefined) {
          if (!existsSync(file)) return fail(`init wrote no ${file}`);
          const again = await product.cli(['object', 'validate', file], dir);
          if (again.code !== 0) return fail(`validate on the file init wrote exited ${again.code}`);
        }
        const twin = cliCase.twin?.(dir, (xs) => pick(rng, xs), seed);
        if (!twin) return PASS;
        const second = await product.cli(['object', ...twin.args], dir);
        const secondText = `${second.out}\n${second.err}`;
        if (second.code !== twin.exit)
          return fail(
            `object ${twin.args.join(' ')} exited ${second.code}, expected ${twin.exit}: ${secondText.trim().slice(0, 240)}`,
          );
        const lacking = (twin.holds ?? []).filter((pattern) => !pattern.test(secondText));
        if (lacking.length > 0)
          return fail(
            `object ${twin.args.join(' ')}: the output lacks ${list(lacking.map(String))}: ${secondText.trim().slice(0, 240)}`,
          );
        if (twin.fileHolds) {
          if (!existsSync(twin.fileHolds.file)) return fail(`init wrote no ${twin.fileHolds.file}`);
          const written = readFileSync(twin.fileHolds.file, 'utf8');
          const absent = twin.fileHolds.words.filter((word) => !new RegExp(`\\b${word}\\b`).test(written));
          if (absent.length > 0)
            return fail(`init should list every parent item as a comment; the file lacks ${list(absent)}`);
        }
        return PASS;
      },
    };
  });
}

type Stamp = { object?: string; item?: string; impl?: string; layer?: string };

/** The check a verdict comes from: its `name`, else the first part of its id. */
const checkOf = (verdict: { id: string; name?: string }) =>
  verdict.name ?? verdict.id.split('.')[0] ?? verdict.id;

/**
 * Every verdict names the object, item, implementation and layer that produced it. The blocks run the shipped
 * check set, or a spec-level or block-level object that retitles the `tools` item and disables `forbidden`:
 * the tailored item names that layer and a tailored object, the disabled check gives no verdict, and a block
 * the tailoring does not reach keeps the shipped stamp.
 */
function stampItems(): BankItem[] {
  const items: BankItem[] = [];
  const places = [
    { id: 'shipped', layer: 'shipped', uses: () => ({}) },
    { id: 'spec', layer: 'spec', uses: (ref: unknown) => ({ spec: ref }) },
    { id: 'block', layer: 'block', uses: (ref: unknown) => ({ block: ref }) },
  ];
  const shapes = [
    'count',
    'forbidden-only',
    'two-tools',
    'in-order',
    'extra-call',
    'missing-call',
    'wrong-words',
  ] as const;
  for (const place of places) {
    for (const shape of shapes) {
      const id = `objects/stamps/${place.id}/${shape}`;
      items.push({
        id,
        family: 'objects-stamps',
        tier: (place.id === 'shipped'
          ? 2
          : shape === 'extra-call' || shape === 'missing-call'
            ? 4
            : 3) as Tier,
        level: 3,
        component: STAMPS,
        title: `on ${shape.replace(/-/g, ' ')} blocks scored with the check set of the ${place.id} layer, every verdict names its object as kind:id@hash8, its item, its builtin implementation and the layer that set the item`,
        cause:
          place.id === 'shipped'
            ? 'Every verdict names the object, item, implementation and layer that produced it (Verdict.by).'
            : `Verdict.by names the ${place.layer} layer and the tailored object for an item that ${place.id} uses changes.`,
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const title = `Tools as ${pick(rng, SHOP.customers)} sees them`;
          const ref = {
            extends: 'default',
            items: [
              { id: 'tools', title },
              { id: 'forbidden', enabled: false },
            ],
          };
          const raw = toolSpec(seed, id, place.uses(ref));
          const last = raw.blocks.length - 1;
          for (const block of raw.blocks) {
            const expect = block.expect as { tools: Record<string, unknown>[]; tool_order?: string };
            if (shape === 'two-tools' || shape === 'in-order')
              expect.tools.push({ label: 'customer.find', count: 1 });
            if (shape === 'in-order') expect.tool_order = 'in_order';
            if (shape === 'forbidden-only') expect.tools = [{ label: 'payment.charge', count: 0 }];
          }
          const behave = (turn: { user: string }) => {
            const index = Number(/:(\d+)\]/.exec(turn.user)?.[1] ?? 0);
            const lookup = { label: 'bikes.lookup', input: { day: index + 1 }, output: { free: true } };
            const find = { label: 'customer.find', input: {}, output: { id: 7 } };
            if (shape === 'missing-call' && index === last) return observed('It is free.');
            if (shape === 'extra-call' && index === last) return observed('It is free.', [lookup, lookup]);
            if (shape === 'wrong-words' && index === last) return observed('Let me see.', [lookup]);
            return observed(
              'It is free.',
              shape === 'two-tools' || shape === 'in-order' ? [lookup, find] : [lookup],
            );
          };
          const record: RunRecord = await run(product, raw, scriptedAdapter(product, behave));
          const verdicts = record.blocks.flatMap((block, index) =>
            block.verdicts.map((verdict) => ({ index, verdict })),
          );
          if (verdicts.length === 0) return fail('the run holds no verdict');
          const shippedObjects = new Set<string>();
          const tailoredObjects = new Set<string>();
          for (const { index, verdict } of verdicts) {
            const by = verdict.by as Stamp | undefined;
            const check = checkOf(verdict as { id: string; name?: string });
            if (!by) return fail(`the verdict ${verdict.id} of block ${index} names no producer (no by)`);
            const match = /^([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?):([^@]+)@([0-9a-f]{8})$/.exec(
              by.object ?? '',
            );
            if (!match)
              return fail(`the verdict ${verdict.id} names the object "${by.object}", not kind:id@hash8`);
            if (!LAYERS_ENUM.includes(by.layer ?? ''))
              return fail(`the verdict ${verdict.id} names the layer "${by.layer}"`);
            if (!/^(builtin|plugin):\S+$/.test(by.impl ?? ''))
              return fail(`the verdict ${verdict.id} names the impl "${by.impl}"`);
            // A tool input decided by the value policy keeps the policy's stamp; every other verdict, its check-set item.
            if (match[1] !== 'check-set') continue;
            if (by.item !== check)
              return fail(
                `the verdict ${verdict.id} names the item "${by.item}", expected its check ${check}`,
              );
            if (by.impl !== `builtin:check/${check}` && by.impl !== `builtin:runner/${check}`)
              return fail(`the verdict ${verdict.id} names the impl ${by.impl}`);
            const governed = place.id !== 'shipped' && (place.id === 'spec' || index === last);
            if (governed && check === 'forbidden')
              return fail(`block ${index} still gives the disabled forbidden verdict ${verdict.id}`);
            const want = governed && check === 'tools' ? place.layer : 'shipped';
            if (by.layer !== want)
              return fail(
                `the verdict ${verdict.id} of block ${index} names the layer ${by.layer}, expected ${want}`,
              );
            (governed ? tailoredObjects : shippedObjects).add(by.object as string);
          }
          if (
            place.id === 'shipped' &&
            ![...shippedObjects].every((object) => object.startsWith('check-set:default@'))
          )
            return fail(
              `the shipped check set is named ${list([...shippedObjects])}, expected check-set:default@<hash8>`,
            );
          if (place.id !== 'shipped') {
            if (tailoredObjects.size !== 1)
              return fail(
                `the tailored blocks name ${tailoredObjects.size} objects: ${list([...tailoredObjects])}`,
              );
            if (
              [...tailoredObjects].some(
                (object) => shippedObjects.has(object) || object.startsWith('check-set:default@'),
              )
            )
              return fail(`the tailored blocks name the shipped object ${list([...tailoredObjects])}`);
          }
          return PASS;
        },
      });
    }
  }
  return items;
}

/**
 * The stamps of a CODE agent's verdicts: the check set from the shipped, spec or block layer retitles the
 * `artifacts` item and disables `safety`. The tailored item names its layer and a tailored object, the disabled
 * check gives no verdict, and a block the tailoring does not reach keeps the shipped stamp.
 */
function codeStampItems(): BankItem[] {
  const items: BankItem[] = [];
  const places = [
    { id: 'shipped', layer: 'shipped', uses: () => ({}) },
    { id: 'spec', layer: 'spec', uses: (ref: unknown) => ({ spec: ref }) },
    { id: 'block', layer: 'block', uses: (ref: unknown) => ({ block: ref }) },
  ];
  const fates = ['all-pass', 'last-fails', 'first-fails', 'missing-file'] as const;
  for (const place of places) {
    for (const fate of fates) {
      const id = `objects/stamps/code/${place.id}/${fate}`;
      items.push({
        id,
        family: 'objects-stamps',
        tier: (place.id === 'shipped' ? 3 : 4) as Tier,
        level: 3,
        component: STAMPS,
        title: `on code blocks (${fate.replace(/-/g, ' ')}) scored with the check set of the ${place.id} layer, every verdict names its object, its item, its builtin implementation and the layer that set the item`,
        cause:
          place.id === 'shipped'
            ? 'Every verdict of a code block names the check-set item and layer that produced it (Verdict.by).'
            : `Verdict.by of a code block names the ${place.layer} layer for an item that ${place.id} uses changes.`,
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const ref = {
            extends: 'default',
            items: [
              { id: 'artifacts', title: `Files for ${pick(rng, SHOP.customers)}` },
              { id: 'safety', enabled: false },
            ],
          };
          const { raw, r } = objectSpec(seed, id, 'code', place.uses(ref));
          const last = raw.blocks.length - 1;
          if (fate !== 'all-pass') {
            const at = fate === 'first-fails' ? 0 : last;
            const block = r.blocks[at];
            const action = r.actions.get(block?.marker as string);
            if (action)
              r.actions.set(
                block?.marker as string,
                fate === 'missing-file'
                  ? { ...action, files: [] }
                  : { ...action, commands: [{ command: 'python make.py', exitCode: 2 }] },
              );
          }
          const agent = plantedAgent(product, 'code', r.actions, { scratch });
          const record: RunRecord = await run(product, raw, agent.adapter);
          const byId = new Map(raw.blocks.map((block, index) => [block.id, index]));
          const tailored = new Set<string>();
          const shipped = new Set<string>();
          for (const block of record.blocks) {
            const index = byId.get(block.blockId) ?? block.index;
            const governed = place.id !== 'shipped' && (place.id === 'spec' || index === last);
            for (const verdict of block.verdicts) {
              const by = verdict.by as Stamp | undefined;
              const check = checkOf(verdict as { id: string; name?: string });
              if (!by)
                return fail(
                  `the verdict ${verdict.id} of ${block.blockId} should name its producer; it names none`,
                );
              if (!/^check-set:[^@]+@[0-9a-f]{8}$/.test(by.object ?? '')) continue;
              if (by.item !== check)
                return fail(`the verdict ${verdict.id} should name the item ${check}; it names ${by.item}`);
              if (governed && check === 'safety')
                return fail(
                  `${block.blockId} should give no safety verdict: the check set disables it; it gave ${verdict.id}`,
                );
              const want = governed && check === 'artifacts' ? place.layer : 'shipped';
              if (by.layer !== want)
                return fail(
                  `the verdict ${verdict.id} of ${block.blockId} should name the layer ${want}; it names ${by.layer}`,
                );
              (governed ? tailored : shipped).add(by.object as string);
            }
          }
          if (place.id === 'shipped') {
            if (![...shipped].every((object) => object.startsWith('check-set:default@')))
              return fail(
                `the shipped check set should be check-set:default@<hash8>; got ${list([...shipped])}`,
              );
            // The twin: an inline spec object that changes nothing is named check-set:(spec)@hash8, and holds the
            // same items and values, so the same hash (block-contracts.md, Content hash and Verdict.by).
            const hash = [...shipped][0]?.split('@')[1];
            const same = objectSpec(seed, `${id}#same`, 'code', { spec: { extends: 'default', items: [] } });
            const again: RunRecord = await run(
              product,
              same.raw,
              plantedAgent(product, 'code', same.r.actions, { scratch }).adapter,
            );
            const named = new Set(
              again.blocks.flatMap((block) =>
                block.verdicts
                  .map((verdict) => (verdict.by as Stamp | undefined)?.object ?? '')
                  .filter((object) => object.startsWith('check-set:')),
              ),
            );
            const want = `check-set:(spec)@${hash}`;
            return named.size === 1 && named.has(want)
              ? PASS
              : fail(
                  `an inline spec check set equal to the default should be named ${want}; the verdicts name ${list([...named])}`,
                );
          }
          return tailored.size === 1 &&
            ![...tailored].some((object) => object.startsWith('check-set:default@'))
            ? PASS
            : fail(`the tailored blocks should name one tailored object; they name ${list([...tailored])}`);
        },
      });
    }
  }
  return items;
}

/** Level 3 of the blocks bank. */
export function objectItems(): BankItem[] {
  return [...loaderItems(), ...hashItems(), ...cliItems(), ...stampItems(), ...codeStampItems()];
}
