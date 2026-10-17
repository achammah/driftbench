import { createHash } from 'node:crypto';
import {
  type AgentLog,
  between,
  byText,
  list,
  observed,
  pick,
  type RawSpec,
  type Rng,
  rngFor,
  run,
  SHOP,
  scriptedAdapter,
  shuffled,
} from '../harness';
import { type Action, KINDS, type Kind, plantedAgent, token } from '../kinds';
import type { BlocksProduct } from '../product';
import { type BlockPlan, KIND_CAPS, recipe, settle } from '../recipe';
import { type BankItem, fail, PASS, type Tier } from '../types';
import { judge, play } from './verdicts';

/**
 * Level 2, parent blocks by observable behaviour (docs/concepts/given-when-then.md, parent blocks). Each family
 * checks one thing a correct implementation does and a partial one does not: a second root starts at the spec
 * defaults; a child's history holds its parent's tool calls with their results; a child's own prefix or own
 * workspace replaces what it would inherit; world layers reach descendants only; a passed parent runs once; the
 * export skips .git and node_modules, copies a link inside the workspace, fails on a link that leaves it or on a
 * workspace past the export bound; a sandbox adapter without an export leaves its children not_run. Then random
 * forests and deep chains, drawn fresh from the seed in both modes, that only a general implementation passes.
 */

const RUNNER = 'packages/core/src/runner/run.ts';
const PROCESS = 'packages/adapters/src/process/index.ts';
const VERDICTS = 'packages/core/src/runner/verdicts.ts';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

type NormalBlock = {
  id: string;
  marker: string;
  parent?: string;
  given?: Record<string, unknown>;
  reply?: Record<string, unknown>;
};

/** A NORMAL spec from explicit blocks, played by a scripted agent; returns the record and every turn it saw. */
async function playNormal(product: BlocksProduct, seed: number, tag: string, blocks: NormalBlock[]) {
  const log: AgentLog = { turns: [] };
  const replies = new Map(
    blocks.map((block) => [block.marker, () => block.reply ?? observed(`Noted (${block.marker}).`)]),
  );
  const adapter = scriptedAdapter(product, byText(replies), { log });
  const raw: RawSpec = {
    id: `spec-${token(seed, `${tag}#spec`)}`,
    channel: 'chat',
    lang: 'EN',
    blocks: blocks.map((block) => ({
      id: block.id,
      ...(block.parent ? { parent: block.parent } : {}),
      user: `${block.marker} ${pick(rngFor(seed, `${tag}#${block.marker}`), SHOP.customers)} asks a question.`,
      ...(block.given ? { given: block.given } : {}),
      expect: {},
    })),
  };
  const record = await run(product, raw, adapter);
  const turnOf = (marker: string) => log.turns.filter((turn) => turn.user.includes(marker));
  return { record, turnOf };
}

/** A reply that calls one tool and gets its output or error back. */
function callReply(
  label: string,
  input: Record<string, unknown>,
  outcome: { output?: Record<string, unknown>; error?: string },
  text: string,
) {
  return observed(text, [
    { label, input, ...(outcome.error ? { error: outcome.error } : { output: outcome.output }) },
  ]);
}

const ids = (seed: number, tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => token(seed, `${tag}#b${i}`));
const marks = (seed: number, tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => token(seed, `${tag}#m${i}`, 8));

function guard(error: unknown) {
  return fail(
    `the spec should load and run; it threw: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
  );
}

/** NORMAL behaviours of inheritance. */
function normalInheritItems(): BankItem[] {
  const items: BankItem[] = [];
  const add = (
    behaviour: string,
    cause: string,
    title: string,
    tier: Tier,
    variants: number,
    check: (
      seed: number,
      id: string,
      product: BlocksProduct,
      rng: Rng,
    ) => Promise<ReturnType<typeof fail> | typeof PASS>,
  ) => {
    for (let v = 0; v < variants; v += 1) {
      const id = `parents/inherit/normal/${behaviour}/${v}`;
      items.push({
        id,
        family: 'parents-inherit',
        tier,
        level: 2,
        component: RUNNER,
        title: `${title} (variant ${v})`,
        cause,
        check: async ({ seed, product }) => {
          try {
            return await check(seed, id, product, rngFor(seed, id));
          } catch (error) {
            return guard(error);
          }
        },
      });
    }
  };

  add(
    'second-root-fresh',
    'Each root of a forest starts at the spec defaults: no turn of another tree reaches it.',
    'a root written after another tree holds no turn of that tree',
    2,
    5,
    async (seed, id, product, rng) => {
      const n = between(rng, 2, 4);
      const b = ids(seed, id, n + 1);
      const m = marks(seed, id, n + 1);
      const blocks: NormalBlock[] = b.map((blockId, i) => ({
        id: blockId,
        marker: m[i] as string,
        ...(i > 0 && i < n ? { parent: b[i - 1] } : {}),
      }));
      const { turnOf } = await playNormal(product, seed, id, blocks);
      const last = turnOf(m[n] as string)[0];
      if (!last) return fail(`${b[n]}, a second root, should reach the agent; it never did`);
      const foreign = m
        .slice(0, n)
        .filter((marker) => last.messages.some((msg) => msg.content.includes(marker)));
      return foreign.length === 0
        ? PASS
        : fail(
            `${b[n]}, a second root, should hold no turn of the first tree; it holds the turns of ${list(foreign.map((x) => b[m.indexOf(x)] as string))}`,
          );
    },
  );

  add(
    'parent-tool-calls',
    "A child's history holds its parent's tool calls with their recorded results and errors.",
    "a child's history holds the tool call its parent made, with the result or the error it got",
    3,
    6,
    async (seed, id, product, rng) => {
      const b = ids(seed, id, 2);
      const m = marks(seed, id, 2);
      const failed = rng() < 0.5;
      const value = `${token(seed, `${id}#v`, 6)}`;
      const outcome = failed ? { error: `no booking ${value}` } : { output: { reference: value } };
      const blocks: NormalBlock[] = [
        {
          id: b[0] as string,
          marker: m[0] as string,
          reply: callReply('booking.find', { day: between(rng, 1, 28) }, outcome, 'Looked it up.'),
        },
        { id: b[1] as string, marker: m[1] as string, parent: b[0] },
      ];
      const { turnOf } = await playNormal(product, seed, id, blocks);
      const child = turnOf(m[1] as string)[0];
      if (!child) return fail(`${b[1]} should reach the agent; it never did`);
      const calls = child.messages
        .flatMap((msg) => msg.tool_calls ?? [])
        .filter((call) => call.label === 'booking.find');
      if (calls.length !== 1)
        return fail(`${b[1]} should hold its parent's one booking.find call; it holds ${calls.length}`);
      const got = JSON.stringify(failed ? calls[0]?.error : calls[0]?.output) ?? '';
      return got.includes(value)
        ? PASS
        : fail(
            `${b[1]} should hold the parent's call with its recorded ${failed ? 'error' : 'result'} (${value}); it holds ${got || 'none'}`,
          );
    },
  );

  add(
    'own-prefix-replaces',
    "A child's own given.prefix replaces the conversation it would inherit from its ancestors.",
    "a child with its own prefix holds that prefix and none of its ancestors' turns",
    3,
    5,
    async (seed, id, product, rng) => {
      const n = between(rng, 2, 3);
      const b = ids(seed, id, n + 1);
      const m = marks(seed, id, n + 1);
      const said = `I am calling about order ${token(seed, `${id}#o`, 6)}.`;
      const blocks: NormalBlock[] = b.map((blockId, i) => ({
        id: blockId,
        marker: m[i] as string,
        ...(i > 0 ? { parent: b[i - 1] } : {}),
        ...(i === n
          ? {
              given: {
                prefix: [
                  { role: 'user', content: said },
                  { role: 'assistant', content: 'Of course.' },
                ],
              },
            }
          : {}),
      }));
      const { turnOf } = await playNormal(product, seed, id, blocks);
      const child = turnOf(m[n] as string)[0];
      if (!child) return fail(`${b[n]} should reach the agent; it never did`);
      const inherited = m
        .slice(0, n)
        .filter((marker) => child.messages.some((msg) => msg.content.includes(marker)));
      if (inherited.length > 0)
        return fail(
          `${b[n]} sets its own prefix, which should replace its ancestors' turns; it still holds the turns of ${list(inherited.map((x) => b[m.indexOf(x)] as string))}`,
        );
      return child.messages.some((msg) => msg.content.includes(said))
        ? PASS
        : fail(`${b[n]} should hold its own prefix; it does not`);
    },
  );

  add(
    'world-to-descendants',
    "A world layer set on a block reaches its descendants and never a sibling's tree or another root.",
    'fixtures a parent sets reach its descendants, merged with their own, and no other tree',
    3,
    6,
    async (seed, id, product, rng) => {
      const b = ids(seed, id, 4);
      const m = marks(seed, id, 4);
      const mine = token(seed, `${id}#f`, 6);
      const own = token(seed, `${id}#g`, 6);
      // b0 sets a fixture; b1 (its child) adds its own; b2 (a child of b1) sees both; b3 (a second root) sees neither.
      const blocks: NormalBlock[] = [
        { id: b[0] as string, marker: m[0] as string, given: { world: { fixtures: { shared: mine } } } },
        { id: b[1] as string, marker: m[1] as string, parent: b[0], given: { world: { store: { own } } } },
        { id: b[2] as string, marker: m[2] as string, parent: b[1] },
        { id: b[3] as string, marker: m[3] as string },
      ];
      const order = rng() < 0.5 ? blocks : [blocks[0], blocks[3], blocks[1], blocks[2]];
      const { turnOf } = await playNormal(product, seed, id, order as NormalBlock[]);
      const world = (marker: string) => JSON.stringify(turnOf(marker)[0]?.world ?? {});
      if (!world(m[2] as string).includes(mine) || !world(m[2] as string).includes(own))
        return fail(
          `${b[2]} should start with its ancestors' world (the fixture of ${b[0]} and the store of ${b[1]}); it saw ${world(m[2] as string).slice(0, 200)}`,
        );
      return world(m[3] as string).includes(mine) || world(m[3] as string).includes(own)
        ? fail(
            `${b[3]}, a second root, should start at the spec defaults; it saw another tree's world ${world(m[3] as string).slice(0, 200)}`,
          )
        : PASS;
    },
  );

  add(
    'parent-runs-once',
    'A passed parent runs once per run, however many children share it.',
    'a parent shared by several children reaches the agent once, and each child once',
    2,
    5,
    async (seed, id, product, rng) => {
      const kids = between(rng, 2, 5);
      const b = ids(seed, id, kids + 1);
      const m = marks(seed, id, kids + 1);
      const blocks: NormalBlock[] = b.map((blockId, i) => ({
        id: blockId,
        marker: m[i] as string,
        ...(i > 0 ? { parent: b[0] } : {}),
      }));
      const { turnOf } = await playNormal(product, seed, id, shuffled(rng, blocks));
      const counts = m.map((marker) => turnOf(marker).length);
      const wrong = counts.flatMap((count, i) => (count === 1 ? [] : [`${b[i]} ${count} times`]));
      return wrong.length === 0 ? PASS : fail(`each block should reach the agent once; ${list(wrong)}`);
    },
  );
  return items;
}

/** CODE behaviours of the export a child starts from. */
function codeExportItems(): BankItem[] {
  const items: BankItem[] = [];
  type Case = {
    id: string;
    cause: string;
    title: string;
    tier: Tier;
    variants: number;
    options?: { exportMaxBytes?: number; noSnapshot?: boolean };
    /** The parent's action, and what the run must show: a check on the child's turn and block. */
    plant(
      seed: number,
      id: string,
      rng: Rng,
    ): {
      parent: Partial<Action>;
      childGiven?: Record<string, unknown>;
      /** What the child does and expects, beside running one command. */
      child?: Partial<Action>;
      childExpect?: Record<string, unknown>;
      judge: (got: Got) => string | undefined;
    };
  };
  type Got = {
    childFiles?: Record<string, string>;
    child?: {
      status?: string;
      pass?: boolean;
      notRun?: { kind?: string };
      verdicts?: { id: string; outcome: string }[];
      observed?: { workspaceDiff?: { created: string[]; changed: string[]; deleted: string[] } };
    };
    grandchild?: { status?: string; blocked?: { by: string; root: string } };
    ids: string[];
  };
  const cases: Case[] = [
    {
      id: 'skips-git-and-node-modules',
      cause: 'The export a child starts from skips .git and node_modules and carries every other file.',
      title: 'a child starts with the files its parent wrote, except under .git and node_modules',
      tier: 3,
      variants: 5,
      plant: (seed, id) => {
        const kept = `out/${token(seed, `${id}#k`)}.txt`;
        const skipped = [`.git/${token(seed, `${id}#g`)}`, `node_modules/${token(seed, `${id}#n`)}/index.js`];
        return {
          parent: {
            files: [
              { path: kept, format: 'txt', data: 'kept\n' },
              ...skipped.map((path) => ({ path, format: 'txt' as const, data: 'skip\n' })),
            ],
          },
          judge: (got) => {
            if (!got.childFiles?.[kept])
              return `${got.ids[1]} should start with ${kept}, which its parent wrote; it did not`;
            const leaked = skipped.filter((path) => got.childFiles?.[path] !== undefined);
            return leaked.length > 0
              ? `${got.ids[1]} should not receive ${list(leaked)}: the export skips .git and node_modules`
              : undefined;
          },
        };
      },
    },
    {
      id: 'link-inside-copied',
      cause: 'The export carries a link that points inside the workspace as a plain copy of its target.',
      title: 'a link the parent made to a file inside the workspace reaches the child as a copy of that file',
      tier: 4,
      variants: 5,
      plant: (seed, id) => {
        const target = `data/${token(seed, `${id}#t`)}.csv`;
        const link = `out/${token(seed, `${id}#l`)}.csv`;
        const body = `bike,days\nFern 3,${(seed % 9) + 2}\n`;
        return {
          parent: {
            files: [{ path: target, format: 'txt', data: body }],
            links: [{ path: link, target: `../${target}` }],
          },
          judge: (got) =>
            got.childFiles?.[link] === sha(body)
              ? undefined
              : `${got.ids[1]} should receive ${link} as a copy of ${target}; ${got.childFiles?.[link] ? 'it held other bytes' : got.child?.status === 'not_run' ? `it was not run (${got.child.notRun?.kind})` : 'it never saw it'}`,
        };
      },
    },
    {
      id: 'link-outside-fails',
      cause:
        'A link that leaves the workspace fails the export: the child is not_run (setup_failed) and its descendants blocked.',
      title:
        'a link the parent made out of the workspace leaves its child not_run, setup_failed, and the grandchild blocked',
      tier: 4,
      variants: 5,
      plant: (seed, id) => ({
        parent: {
          files: [{ path: 'out/ok.txt', format: 'txt', data: 'ok\n' }],
          links: [{ path: `out/${token(seed, `${id}#x`)}`, target: '/etc/hosts' }],
        },
        judge: (got) => notRunAndBlocked(got),
      }),
    },
    {
      id: 'export-bound',
      cause:
        'A workspace past the export bound leaves the children not_run (setup_failed) and their descendants blocked.',
      title:
        'a parent workspace past exportMaxBytes leaves its child not_run, setup_failed, and the grandchild blocked',
      tier: 4,
      variants: 5,
      options: { exportMaxBytes: 4096 },
      plant: (seed, id, rng) => ({
        parent: {
          files: [
            {
              path: `out/${token(seed, `${id}#big`)}.txt`,
              format: 'txt',
              data: 'x'.repeat(between(rng, 5000, 20000)),
            },
          ],
        },
        judge: (got) => notRunAndBlocked(got),
      }),
    },
    {
      id: 'no-export-unsupported',
      cause:
        'An adapter with a sandbox and no export hook leaves the children of a parent not_run (unsupported), never seeded from old files.',
      title: 'a sandbox adapter without snapshotGiven leaves the child of a parent not_run, unsupported',
      tier: 3,
      variants: 5,
      options: { noSnapshot: true },
      plant: () => ({
        parent: { files: [{ path: 'out/ok.txt', format: 'txt', data: 'ok\n' }] },
        judge: (got) =>
          got.child?.status === 'not_run' && got.child.notRun?.kind === 'unsupported'
            ? undefined
            : `${got.ids[1]} should be not_run, unsupported: its adapter exports no end state; got ${got.child?.status} ${got.child?.notRun?.kind ?? ''}`.trim(),
      }),
    },
    {
      id: 'child-diff-from-inherited',
      cause:
        "A child's workspace diff starts from the workspace it inherited: its ancestors' files are neither created nor changed by it.",
      title: "a child that adds one file next to its parent's lists only that file as created",
      tier: 3,
      variants: 5,
      plant: (seed, id) => {
        const parentFile = `out/${token(seed, `${id}#p`)}.txt`;
        const childFile = `out/${token(seed, `${id}#c`)}.txt`;
        return {
          parent: { files: [{ path: parentFile, format: 'txt', data: 'parent\n' }] },
          child: { files: [{ path: childFile, format: 'txt', data: 'child\n' }] },
          judge: (got) => {
            const diff = got.child?.observed?.workspaceDiff;
            if (!diff)
              return `${got.ids[1]} should record its workspace diff; ${got.child?.status === 'not_run' ? `it was not run (${got.child.notRun?.kind})` : 'it records none'}`;
            const all = [...diff.created, ...diff.changed, ...diff.deleted];
            return diff.created.join(',') === childFile && all.length === 1
              ? undefined
              : `${got.ids[1]} should list only ${childFile} as created; its diff is created ${list(diff.created)}, changed ${list(diff.changed)}, deleted ${list(diff.deleted)}`;
          },
        };
      },
    },
    {
      id: 'child-checks-inherited',
      cause: "A child's checks read the workspace it inherited: a file its parent wrote is there to judge.",
      title: 'a child whose artifact check reads the file its parent wrote passes that check',
      tier: 3,
      variants: 5,
      plant: (seed, id, rng) => {
        const days = between(rng, 2, 40);
        const parentFile = `out/${token(seed, `${id}#p`)}.csv`;
        return {
          parent: {
            files: [
              {
                path: parentFile,
                format: 'csv',
                data: [
                  ['bike', 'days'],
                  ['Fern 3', days],
                ],
              },
            ],
          },
          childExpect: {
            artifacts: [
              {
                path: parentFile,
                kind: 'csv',
                checks: [{ value: { column: 'days', row: 2, equals: days } }],
              },
            ],
          },
          judge: (got) => {
            const failing = (got.child?.verdicts ?? []).filter((v) => v.outcome !== 'pass').map((v) => v.id);
            if (!got.child?.pass || got.child.status === 'not_run' || failing.length > 0)
              return `${got.ids[1]} should pass its check on ${parentFile}, which its parent wrote; got ${got.child?.status}${failing.length > 0 ? ` failing ${list(failing)}` : ''}`;
            return undefined;
          },
        };
      },
    },
    {
      id: 'own-workspace-replaces',
      cause:
        "A child's own world.workspace replaces the inherited workspace whole: none of the parent's files carry.",
      title: "a child that names its own workspace starts with those files only, none of its parent's",
      tier: 3,
      variants: 5,
      plant: (seed, id) => {
        const parentFile = `out/${token(seed, `${id}#p`)}.txt`;
        const ownFile = `data/${token(seed, `${id}#o`)}.txt`;
        return {
          parent: { files: [{ path: parentFile, format: 'txt', data: 'from the parent\n' }] },
          childGiven: { world: { workspace: { files: { [ownFile]: 'mine\n' } } } },
          judge: (got) => {
            if (!got.childFiles?.[ownFile])
              return `${got.ids[1]} should start with its own ${ownFile}; ${got.child?.status === 'not_run' ? `it was not run (${got.child.notRun?.kind})` : 'it did not'}`;
            return got.childFiles[parentFile]
              ? `${got.ids[1]} names its own workspace, which replaces the inherited one; it still saw ${parentFile}`
              : undefined;
          },
        };
      },
    },
  ];
  function notRunAndBlocked(got: Got): string | undefined {
    if (got.child?.status !== 'not_run' || got.child.notRun?.kind !== 'setup_failed')
      return `${got.ids[1]} should be not_run, setup_failed: its parent's export fails; got ${got.child?.status} ${got.child?.notRun?.kind ?? ''}`.trim();
    if (
      got.grandchild?.status !== 'blocked' ||
      got.grandchild.blocked?.by !== got.ids[1] ||
      got.grandchild.blocked?.root !== got.ids[1]
    )
      return `${got.ids[2]} should be blocked by ${got.ids[1]} (root ${got.ids[1]}); got ${got.grandchild?.status} by ${got.grandchild?.blocked?.by} (root ${got.grandchild?.blocked?.root})`;
    return undefined;
  }
  for (const each of cases) {
    for (let v = 0; v < each.variants; v += 1) {
      const id = `parents/export/code/${each.id}/${v}`;
      items.push({
        id,
        family: 'parents-export',
        tier: each.tier,
        level: 2,
        component: PROCESS,
        title: `${each.title} (variant ${v})`,
        cause: each.cause,
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const planted = each.plant(seed, id, rng);
          const b = ids(seed, id, 3);
          const m = marks(seed, id, 3);
          const raw: RawSpec = {
            id: `spec-${token(seed, `${id}#spec`)}`,
            kind: 'task',
            workspace_seed: { files: { 'data/notes.txt': 'notes\n' } },
            blocks: b.map((blockId, i) => ({
              id: blockId,
              user: `${m[i]} Step ${i + 1}.`,
              ...(i > 0 ? { parent: b[i - 1] } : {}),
              ...(i === 1 && planted.childGiven ? { given: planted.childGiven } : {}),
              expect: { execution: { ran_code: true }, ...(i === 1 ? (planted.childExpect ?? {}) : {}) },
            })),
          };
          const actions = new Map<string, Action>(
            m.map((marker, i) => [
              marker,
              {
                reply: 'Done.',
                ...(i === 0 ? planted.parent : i === 1 ? (planted.child ?? {}) : {}),
                commands: [{ command: 'python step.py', exitCode: 0 }],
              } as Action,
            ]),
          );
          try {
            const agent = plantedAgent(product, 'code', actions, { scratch, ...(each.options ?? {}) });
            const record = await run(product, raw, agent.adapter);
            const turns = agent.delivered();
            const child = turns.find((turn) => turn.marker === m[1]);
            const at = (index: number) =>
              record.blocks.find((block) => block.blockId === b[index]) as Got['child'] & Got['grandchild'];
            const problem = planted.judge({
              childFiles: child?.digests,
              child: at(1),
              grandchild: at(2),
              ids: b,
            });
            return problem ? fail(problem) : PASS;
          } catch (error) {
            return guard(error);
          }
        },
      });
    }
  }
  return items;
}

/** A forest drawn fresh from the seed: any number of roots, any depth, several failures and unrun blocks. */
function randomForest(rng: Rng, size: number): BlockPlan[] {
  const parents = Array.from({ length: size }, (_, i) =>
    i === 0 || rng() < 0.2 ? -1 : between(rng, Math.max(0, i - 4), i - 1),
  );
  return parents.map((parent) => {
    const roll = rng();
    return {
      fate: roll < 0.18 ? 'fail' : 'pass',
      ...(roll >= 0.18 && roll < 0.26 ? { stub: true } : {}),
      ...(parent === -1 ? {} : { parent }),
    } as BlockPlan;
  });
}

/** A chain of `depth` blocks that fails at one random depth. */
function deepChain(rng: Rng, depth: number): BlockPlan[] {
  const at = between(rng, 0, depth - 1);
  return Array.from(
    { length: depth },
    (_, i) => ({ fate: i === at ? 'fail' : 'pass', ...(i > 0 ? { parent: i - 1 } : {}) }) as BlockPlan,
  );
}

/** Random forests and deep chains of both kinds in both modes, written in a shuffled order. */
function generalItems(): BankItem[] {
  const items: BankItem[] = [];
  const shapes = [
    {
      id: 'random-forest',
      cause:
        'The parent rules hold on any forest: many roots, several failures and unrun blocks, written in any order, in either mode.',
      tier: 4 as Tier,
    },
    {
      id: 'deep-chain',
      cause:
        'The root of a blocked block is the first failure, however deep the chain and wherever the failure sits.',
      tier: 4 as Tier,
    },
  ];
  for (const kind of KINDS)
    for (const shape of shapes)
      for (const mode of ['F', 'T'] as const)
        for (let v = 0; v < (kind === 'code' ? 3 : 4); v += 1) {
          const id = `parents/general/${kind}/${shape.id}/${mode}/${v}`;
          items.push({
            id,
            family: 'parents-general',
            tier: Math.min(5, shape.tier + (kind === 'code' ? 1 : 0)) as Tier,
            level: 2,
            component: VERDICTS,
            title: `a ${kind} agent on a ${shape.id.replace(/-/g, ' ')} drawn from the seed (variant ${v}, mode ${mode}, written in a shuffled order): every block reads pass, fail, not_run or blocked by its parent and rooted at the first cause, and no blocked block is sent`,
            cause: shape.cause,
            check: async ({ seed, scratch, product }) => {
              const rng = rngFor(seed, id);
              const plans =
                shape.id === 'random-forest'
                  ? randomForest(rng, kind === 'code' ? between(rng, 6, 9) : between(rng, 10, 24))
                  : deepChain(rng, kind === 'code' ? between(rng, 6, 8) : between(rng, 12, 24));
              const usable = KIND_CAPS[kind as Kind].toolStubs
                ? plans
                : plans.map((plan) => ({ ...plan, stub: undefined }));
              const r = recipe(seed, id, kind, usable, { parents: true });
              const order = shuffled(rng, [...r.raw.blocks.keys()]);
              const shuffledRecipe = {
                ...r,
                raw: { ...r.raw, blocks: order.map((i) => r.raw.blocks[i]) },
              } as typeof r;
              const truth = settle(r, usable, {
                mode,
                parents: true,
                seedPrefix: KIND_CAPS[kind as Kind].seedPrefix,
                toolStubs: KIND_CAPS[kind as Kind].toolStubs,
                snapshot: KIND_CAPS[kind as Kind].snapshot,
              });
              try {
                const { record, delivered } = await play(product, shuffledRecipe, scratch, { mode });
                return judge(product, r, record, truth, delivered);
              } catch (error) {
                return guard(error);
              }
            },
          });
        }
  return items;
}

export function forestItems(): BankItem[] {
  return [...normalInheritItems(), ...codeExportItems(), ...generalItems()];
}
