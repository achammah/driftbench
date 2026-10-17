import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
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
  shuffled,
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
    build: (p, _rng, _order, pool) => {
      const item = p(pool);
      return {
        ref: { extends: 'default', items: [{ id: item, before: p(others(item, pool)) }] },
        code: undefined,
      };
    },
  },
  {
    id: 'order-permutation',
    tier: 2,
    build: (_p, rng, order, _pool) => ({
      ref: { extends: 'default', order: shuffled(rng, order) },
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
    build: (p, _rng, _order, _pool) => ({
      ref: {
        extends: 'default',
        items: [{ id: p(['extra_check', 'slow_reply']), add: true, title: 'A new check' }],
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
    build: (p, _rng, _order, _pool) => ({
      ref: p(['no-such-set', 'defaults', 'Default']),
      code: 'OBJECT_UNKNOWN',
    }),
  },
  {
    id: 'unknown-parent',
    tier: 2,
    build: (p, _rng, _order, _pool) => ({
      ref: { extends: p(['missing', 'default2']), items: [] },
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
          check: async ({ seed, product }) => {
            const rng = rngFor(seed, id);
            const { ref, code } = override.build(
              (xs) => pick(rng, xs),
              rng,
              override.id.startsWith('order') ? shippedOrder(product) : [],
              KIND_ITEMS[kind],
            );
            const { raw } = objectSpec(seed, id, kind, place === 'spec' ? { spec: ref } : { block: ref });
            const result = loadIssues(product, raw);
            if (code === undefined)
              return result.ok
                ? PASS
                : fail(`the loader refused ${JSON.stringify(ref)}: ${list(result.codes)}`);
            return !result.ok && result.codes.includes(code)
              ? PASS
              : fail(
                  `the override ${JSON.stringify(ref)} should be refused with ${code}; the loader answered ${result.ok ? 'ok' : list(result.codes)}`,
                );
          },
        });
      }
    }
  return items;
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
          return expectAll([
            [a.specHash !== b.specHash, 'the spec hash is the same with and without uses'],
            [keysA.every((key) => key !== undefined), 'a block records no cache key'],
            [
              keysA.join(',') === keysB.join(','),
              `uses changed the block cache keys: ${list(keysA, 3)} against ${list(keysB, 3)}`,
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
};

const projectObject = (id: string, item: string) => ({
  kind: 'check-set',
  id,
  extends: 'default',
  items: [{ id: item, enabled: false }],
});

/** A project: driftbench.yaml with one inline object, one object file, and a spec whose last block uses it. */
function writeProject(dir: string, p: <T>(items: readonly T[]) => T, seed: number) {
  const objectId = p(['quiet-tools', 'no-accuracy', 'lean-checks']);
  const fileId = p(['strict-order', 'short-set']);
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
  },
  {
    id: 'show-unknown-id',
    tier: 1,
    exit: 2,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const id = p(['nothing', 'defaults']);
      return { args: ['show', `check-set/${id}`], holds: [new RegExp(id)] };
    },
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
          `check-set/${p(['missing', 'ghost'])}#must.limit=2`,
        ],
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
      const specPath = join(dir, 'ghost.yaml');
      // The spec layer names the object, so the block explained (b0) is one that names it.
      writeFileSync(specPath, stringify(toolSpec(seed, 'ghost', { spec: p(['ghost-set', 'vanished']) })));
      return { args: ['explain', 'check-set', '--at', `${specPath}#b0`] };
    },
  },
  {
    id: 'init-then-validate',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'driftbench', 'check-set', `${p(['fresh', 'mine'])}.yaml`);
      return {
        args: ['init', 'check-set', p(['fresh-set', 'my-set']), '--from', 'default', '--out', file],
        file,
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
  },
  {
    id: 'validate-project',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      return { args: ['validate'] };
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
  },
  {
    id: 'validate-unknown-item',
    tier: 2,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'bad.yaml');
      writeFileSync(
        file,
        stringify({
          kind: 'check-set',
          id: 'bad',
          extends: 'default',
          items: [{ id: p(['Must', 'tools.count', 'forbiden']), enabled: false }],
        }),
      );
      return { args: ['validate', file], holds: [/unknown item/] };
    },
  },
  {
    id: 'validate-cycle',
    tier: 4,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const a = p(['ring-a', 'loop-a']);
      const b = p(['ring-b', 'loop-b']);
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
  },
  {
    id: 'diff-same',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      return { args: ['diff', 'check-set/default', 'check-set/default'] };
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
          if (place.id === 'shipped')
            return [...shipped].every((object) => object.startsWith('check-set:default@'))
              ? PASS
              : fail(`the shipped check set should be check-set:default@<hash8>; got ${list([...shipped])}`);
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
