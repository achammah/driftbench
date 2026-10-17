import {
  between,
  canonical,
  list,
  observed,
  type RawSpec,
  type Rng,
  rngFor,
  run,
  scriptedAdapter,
  shuffled,
} from '../harness';
import { type Action, plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BankItem, fail, type ItemResult, PASS, type Tier, thrownText } from '../types';

/**
 * Documented behaviour at its boundary (the v3 partition, family F1). Each group holds one rule of the docs at
 * the exact place a plausible slip breaks it: the order of two run outcomes, an inconclusive gating verdict, the
 * last campaign a result may carry, a step that resets its own workspace in mode T, a deviation id that is a
 * prefix of another, the blocks a radius counts as sent, a changed file as an artifact, a runtime file that
 * must not leak into the next block, the order of the executions, a sibling folder that shares the workspace's
 * name, a path that normalises to `..`, two artifact entries on one path, a negative exit code, the pooled rate
 * of a headline with unscored runs, and the precedence of a later workspace. Every item passes on a correct
 * product and turns red on the slip.
 */

const VERDICTS = 'packages/core/src/runner/verdicts.ts';
const RUN = 'packages/core/src/runner/run.ts';
const CARRY = 'packages/core/src/radius/carry.ts';
const RADIUS = 'packages/core/src/radius/radius.ts';
const PROCESS = 'packages/adapters/src/process/index.ts';
const PATHS = 'packages/sandbox/src/paths.ts';
const ARTIFACTS = 'packages/checks/src/checks/artifacts.ts';
const EXECUTION = 'packages/checks/src/checks/execution.ts';
const HEADLINE = 'packages/report/src/headline.ts';
const GIVEN = 'packages/core/src/runner/given.ts';

type Group = {
  id: string;
  level: number;
  component: string;
  cause: string;
  title: string;
  tier: Tier;
  variants: number;
  check(ctx: {
    seed: number;
    id: string;
    rng: Rng;
    scratch: string;
    product: BlocksProduct;
    variant: number;
  }): Promise<ItemResult>;
};

const guarded = async (body: () => Promise<ItemResult>): Promise<ItemResult> => {
  try {
    return await body();
  } catch (error) {
    return fail(`the item threw: ${thrownText(error)}`);
  }
};

type Block = { pass: boolean; status?: string };
const block = (status: string): Block =>
  status === 'pass' ? { pass: true, status } : { pass: false, status };

/** A code spec of explicit blocks played by the planted code agent; returns the record. */
async function playCode(
  product: BlocksProduct,
  seed: number,
  id: string,
  scratch: string,
  blocks: { expect: Record<string, unknown>; given?: Record<string, unknown>; action: Action }[],
  seedFiles: Record<string, string> = { 'data/notes.txt': 'notes\n' },
) {
  const markers = blocks.map((_, i) => token(seed, `${id}#m${i}`, 8));
  const raw: RawSpec = {
    id: `spec-${token(seed, `${id}#spec`)}`,
    kind: 'task',
    workspace_seed: { files: seedFiles },
    blocks: blocks.map((each, i) => ({
      id: token(seed, `${id}#b${i}`),
      user: `${markers[i]} Step ${i + 1}.`,
      ...(each.given ? { given: each.given } : {}),
      expect: each.expect,
    })),
  };
  const agent = plantedAgent(
    product,
    'code',
    new Map(markers.map((m, i) => [m, blocks[i]?.action as Action])),
    { scratch },
  );
  return (await run(product, raw, agent.adapter)) as unknown as {
    status: string;
    error?: string;
    blocks: {
      pass: boolean;
      status?: string;
      verdicts: { id: string; outcome: string; evidence?: string }[];
      observed: {
        artifacts?: { path: string }[];
        runtime?: { stages?: { name: string }[]; skills?: unknown[]; guards?: unknown[] };
        executions?: { role: string; command: string; exitCode: number }[];
      };
    }[];
  };
}

const GROUPS: Group[] = [
  {
    id: 'outcome-not-run-before-blocked',
    level: 1,
    component: VERDICTS,
    cause:
      'runOutcome reads a run with a block not run and a block blocked as not_run, the order its rule states.',
    title: 'a completed run with no failing block, some blocks not run and some blocked, reads not_run',
    tier: 2,
    variants: 5,
    check: async ({ rng, product }) =>
      guarded(async () => {
        const runOutcome = need<(run: unknown) => string>(product.core, 'core', 'runOutcome');
        const statuses = shuffled(rng, [
          'not_run',
          'blocked',
          ...Array.from({ length: between(rng, 0, 3) }, () => (rng() < 0.5 ? 'pass' : 'blocked')),
          ...Array.from({ length: between(rng, 0, 2) }, () => 'not_run'),
        ]);
        const got = runOutcome({ status: 'completed', blocks: statuses.map(block) });
        return got === 'not_run'
          ? PASS
          : fail(
              `a completed run whose blocks are ${list(statuses)} should read not_run (not_run comes before blocked); got ${got}`,
            );
      }),
  },
  {
    id: 'gating-inconclusive',
    level: 1,
    component: RUN,
    cause:
      'A gating verdict that is inconclusive fails its block: a block passes only when every gating verdict passes.',
    title:
      'a block whose reply passes but whose expectation the adapter cannot observe (an inconclusive gating verdict) does not pass',
    tier: 2,
    variants: 4,
    check: async ({ seed, id, product, variant }) =>
      guarded(async () => {
        const code = token(seed, `${id}#code`, 6).toUpperCase();
        const unobservable =
          variant % 2 === 0
            ? { workspace: { created: [`out/${token(seed, `${id}#f`)}.txt`] } }
            : { skills: [{ name: token(seed, `${id}#s`) }] };
        const adapter = scriptedAdapter(product, () => observed(`Your hold code is ${code}.`));
        const raw: RawSpec = {
          id: `spec-${token(seed, `${id}#spec`)}`,
          channel: 'chat',
          lang: 'EN',
          blocks: [
            {
              id: token(seed, `${id}#b`),
              user: `${token(seed, `${id}#m`, 8)} Hold it.`,
              expect: { must: [code], ...unobservable },
            },
          ],
        };
        const record = (await run(product, raw, adapter)) as unknown as {
          blocks: {
            pass: boolean;
            status?: string;
            verdicts: { id: string; outcome: string; gating: boolean }[];
          }[];
        };
        const only = record.blocks[0];
        const inconclusive = (only?.verdicts ?? [])
          .filter((v) => v.gating && v.outcome === 'inconclusive')
          .map((v) => v.id);
        if (inconclusive.length === 0)
          return fail(
            `the ${Object.keys(unobservable)[0]} expectation should give a gating inconclusive verdict on an adapter that observes nothing; it gave none`,
          );
        return only?.pass === false && only.status !== 'pass'
          ? PASS
          : fail(`the block should not pass: ${list(inconclusive)} is gating and inconclusive; it passed`);
      }),
  },
  {
    id: 'carry-last-campaign',
    level: 7,
    component: CARRY,
    cause:
      'A result carries for exactly --max-carry campaigns in a row: the last one allowed is carried, the next runs fresh.',
    title:
      'with --max-carry M, a result already carried M - 1 times is carried once more, and one carried M times runs fresh',
    tier: 3,
    variants: 8,
    check: async ({ product, variant, seed, id }) =>
      guarded(async () => carryCase(product, seed, id, variant)),
  },
  {
    id: 'radius-reset-step',
    level: 7,
    component: RADIUS,
    cause:
      'In mode T a direct task step that writes its own workspace still carries it forward to the steps after it, up to the next step that writes one.',
    title:
      'in mode T, the steps after a direct step that writes its own workspace are forward, up to the next step that writes one',
    tier: 3,
    variants: 4,
    check: async ({ product, rng, seed, id }) =>
      guarded(async () => {
        const n = between(rng, 5, 8);
        const at = between(rng, 0, n - 4);
        const reset = between(rng, at + 2, n - 1);
        const stage = token(seed, `${id}#stage`);
        const blocks = Array.from({ length: n }, (_, i) => ({
          id: token(seed, `${id}#b${i}`),
          when: { user: 'Go.' },
          ...(i === at || i === reset
            ? {
                given: {
                  world: { workspace: { files: { [`in/${token(seed, `${id}#f${i}`)}.csv`]: 'a,b\n' } } },
                },
              }
            : {}),
          expect: { ...(i === at ? { stage } : {}), execution: { ran_code: true } },
        }));
        const spec = {
          id: `spec-${token(seed, `${id}#spec`)}`,
          kind: 'task',
          metadata: { depends: { fixtures: [token(seed, `${id}#fx`)] } },
          blocks,
        };
        const report = radius(product, [spec], { kind: 'stage', id: stage }, ['T']);
        const states = report.specs[0]?.blocks.map((b) => b.state.T ?? 'out') ?? [];
        const want = blocks.map((_, i) => (i === at ? 'direct' : i > at && i < reset ? 'forward' : 'out'));
        return states.join(',') === want.join(',')
          ? PASS
          : fail(
              `in mode T the steps should read ${list(want)} (direct step ${at} writes its own workspace, the next one at ${reset}); got ${list(states)}`,
            );
      }),
  },
  {
    id: 'radius-deviation-prefix',
    level: 7,
    component: RADIUS,
    cause:
      'A deviation change selects the blocks whose class is that id, or that id followed by an underscore: D1 never selects D10.',
    title: 'a change to deviation Dk selects the blocks of Dk and Dk_<name>, never those of Dk0 or Dk1',
    tier: 3,
    variants: 4,
    check: async ({ product, seed, id, variant }) =>
      guarded(async () => {
        const k = variant + 1;
        const classes = [
          `D${k}_${token(seed, `${id}#a`)}`,
          `D${k}0_${token(seed, `${id}#b`)}`,
          `D${k}1`,
          `D${k}`,
        ];
        const specs = classes.map((klass, s) => ({
          id: `spec-${token(seed, `${id}#s${s}`)}`,
          kind: 'conversation',
          metadata: {
            generated: {
              cell: { flow: 'order' },
              blocks: [
                { block: 'b0', cell: { flow: 'order' } },
                { block: 'b1', cell: { flow: 'order', deviation: klass } },
              ],
            },
          },
          blocks: [
            { id: 'b0', when: { user: 'Hello.' }, expect: {} },
            { id: 'b1', when: { user: 'Go on.' }, expect: {} },
          ],
        }));
        const report = radius(product, specs, { kind: 'deviation', id: `D${k}` }, ['F']);
        if (report.whole)
          return fail(
            `a deviation change D${k} should select blocks; the radius is the whole suite (${JSON.stringify(report.whole)})`,
          );
        const selected = report.specs.map((spec) => spec.blocks[1]?.state.F === 'direct');
        const want = [true, false, false, true];
        return selected.join(',') === want.join(',')
          ? PASS
          : fail(
              `deviation D${k} should select the blocks of ${list(classes.filter((_, i) => want[i]))} only; it selected ${list(classes.filter((_, i) => selected[i])) || 'none'}`,
            );
      }),
  },
  {
    id: 'radius-sent-scored',
    level: 7,
    component: RADIUS,
    cause:
      'The blocks a radius counts as sent are its cells in the radius times the scored blocks: a block a gate rejected is never counted.',
    title:
      'the sent count of a radius multiplies its cells in the radius by the scored blocks, leaving out the blocks a gate rejected',
    tier: 3,
    variants: 4,
    check: async ({ product, rng, seed, id }) =>
      guarded(async () => {
        const stage = token(seed, `${id}#stage`);
        const specs = Array.from({ length: between(rng, 2, 4) }, (_, s) => {
          const n = between(rng, 3, 6);
          const rejected = between(rng, 1, n - 1);
          return {
            id: `spec-${token(seed, `${id}#s${s}`)}`,
            kind: 'conversation',
            metadata: {
              depends: { fixtures: [token(seed, `${id}#fx`)] },
              gate: {
                blocks: Array.from({ length: rejected }, (_, r) => ({ block: `b${r}`, status: 'rejected' })),
              },
            },
            blocks: Array.from({ length: n }, (_, i) => ({
              id: `b${i}`,
              when: { user: 'Go.' },
              expect: i === n - 1 ? { stage } : {},
            })),
          };
        });
        const report = radius(product, specs, { kind: 'stage', id: stage }, ['F']);
        const want = specs.reduce(
          (sum, spec) => sum + spec.blocks.length - spec.metadata.gate.blocks.length,
          0,
        );
        const got = report.totals.F?.sent;
        return got === want
          ? PASS
          : fail(
              `the radius should count ${want} blocks sent (one cell per spec, the scored blocks only); it counts ${got}`,
            );
      }),
  },
  {
    id: 'changed-file-artifact',
    level: 1,
    component: PROCESS,
    cause: 'The artifacts of a code block are the files it created and the files it changed.',
    title: "a file a code agent changed is listed among the block's artifacts, beside the files it created",
    tier: 2,
    variants: 3,
    check: async ({ product, seed, id, scratch, variant }) =>
      guarded(async () => {
        const seeded = `data/${token(seed, `${id}#d`)}.txt`;
        const created = `out/${token(seed, `${id}#o`)}.txt`;
        const files = [
          { path: seeded, format: 'txt' as const, data: `changed ${variant}\n` },
          ...(variant > 0 ? [{ path: created, format: 'txt' as const, data: 'new\n' }] : []),
        ];
        const record = await playCode(
          product,
          seed,
          id,
          scratch,
          [
            {
              expect: { execution: { ran_code: true } },
              action: { reply: 'Done.', files, commands: [{ command: 'python step.py', exitCode: 0 }] },
            },
          ],
          { [seeded]: 'before\n' },
        );
        const listed = (record.blocks[0]?.observed.artifacts ?? []).map((a) => a.path).sort();
        const want = files.map((f) => f.path).sort();
        return listed.join(',') === want.join(',')
          ? PASS
          : fail(
              `the artifacts should be ${list(want)} (changed and created); they are ${list(listed) || 'none'}`,
            );
      }),
  },
  {
    id: 'runtime-file-per-block',
    level: 1,
    component: PROCESS,
    cause:
      "Each code block starts with no runtime file: the runtime events of one block never appear in the next block's runtime.",
    title:
      'a code block that reports no runtime event has no runtime, though the block before reported a stage',
    tier: 2,
    variants: 3,
    check: async ({ product, seed, id, scratch, variant }) =>
      guarded(async () => {
        const stage = token(seed, `${id}#stage`);
        const record = await playCode(product, seed, id, scratch, [
          {
            expect: { execution: { ran_code: true } },
            action: { reply: 'Done.', stage, commands: [{ command: 'python a.py', exitCode: 0 }] },
          },
          ...Array.from({ length: variant + 1 }, () => ({
            expect: { execution: { ran_code: true } },
            action: { reply: 'Done.', commands: [{ command: 'python b.py', exitCode: 0 }] } as Action,
          })),
        ]);
        const leaked = record.blocks
          .slice(1)
          .flatMap((b, i) => ((b.observed.runtime?.stages ?? []).length > 0 ? [`block ${i + 1}`] : []));
        if ((record.blocks[0]?.observed.runtime?.stages ?? []).length === 0)
          return fail('the first block should report its stage in its runtime; it reports none');
        return leaked.length === 0
          ? PASS
          : fail(
              `the blocks after the first report no runtime event; ${list(leaked)} still show the first block's stage`,
            );
      }),
  },
  {
    id: 'executions-order',
    level: 1,
    component: PROCESS,
    cause:
      'The executions of a code block list the commands the agent reported, in their order, then the agent process, always last.',
    title: 'the executions list the reported commands in order and the agent process last',
    tier: 2,
    variants: 3,
    check: async ({ product, seed, id, scratch, rng }) =>
      guarded(async () => {
        const commands = Array.from({ length: between(rng, 1, 4) }, (_, i) => ({
          command: `python ${token(seed, `${id}#c${i}`)}.py`,
          exitCode: rng() < 0.3 ? 1 : 0,
        }));
        const record = await playCode(product, seed, id, scratch, [
          { expect: { execution: { ran_code: true } }, action: { reply: 'Done.', commands } },
        ]);
        const got = record.blocks[0]?.observed.executions ?? [];
        const roles = got.map((e) => e.role);
        const want = [...commands.map(() => 'command'), 'agent'];
        if (roles.join(',') !== want.join(','))
          return fail(`the executions should be ${list(want)} by role; they are ${list(roles)}`);
        const order = got.slice(0, -1).map((e) => e.command);
        return order.join('|') === commands.map((c) => c.command).join('|')
          ? PASS
          : fail(`the commands should keep the order the agent reported them; got ${list(order)}`);
      }),
  },
  {
    id: 'inside-sibling-prefix',
    level: 1,
    component: PATHS,
    cause:
      "A path is inside the workspace only below its root folder: a sibling folder whose name starts with the workspace's name is outside.",
    title:
      'a link to a file in a sibling folder named after the workspace is outside it: reading it through the link is refused',
    tier: 4,
    variants: 3,
    check: async ({ product, seed, id, scratch, variant }) =>
      guarded(async () => {
        const sibling = `{ROOT_NAME}${['x', '-old', '2'][variant]}`;
        const secret = token(seed, `${id}#secret`, 10);
        const link = `out/${token(seed, `${id}#l`)}.txt`;
        const record = await playCode(product, seed, id, scratch, [
          {
            expect: { artifacts: [{ path: link, kind: 'text', checks: [{ contains: secret }] }] },
            action: {
              reply: 'Done.',
              files: [{ path: `../${sibling}/s.txt`, format: 'txt', data: `${secret}\n` }],
              links: [{ path: link, target: `../../${sibling}/s.txt` }],
              commands: [{ command: 'python peek.py', exitCode: 0 }],
            },
          },
        ]);
        const read = (record.blocks[0]?.verdicts ?? []).filter(
          (v) => v.id.startsWith('artifacts.') && v.outcome === 'pass',
        );
        return read.length === 0
          ? PASS
          : fail(
              `${link} points at a sibling folder outside the workspace; the artifacts check should refuse to read it, but it read it (${list(read.map((v) => v.id))})`,
            );
      }),
  },
  {
    id: 'seed-path-parent',
    level: 1,
    component: PATHS,
    cause: 'A workspace path that normalises to `..` leaves the workspace and is refused as such.',
    title:
      'a seeded workspace path that normalises to the parent folder is refused because it leaves the workspace',
    tier: 3,
    variants: 3,
    check: async ({ product, seed, id, scratch, variant }) =>
      guarded(async () => {
        const name = token(seed, `${id}#p`);
        const parent = [`${name}/../..`, `${name}/q/../../..`, `${name}/./../..`][variant] as string;
        const record = await playCode(
          product,
          seed,
          id,
          scratch,
          [
            {
              expect: { execution: { ran_code: true } },
              action: { reply: 'Done.', commands: [{ command: 'python a.py', exitCode: 0 }] },
            },
          ],
          { 'data/notes.txt': 'notes\n', [parent]: 'x\n' },
        );
        const reason = `${record.error ?? ''} ${JSON.stringify(record.blocks.map((b) => (b as { notRun?: unknown }).notRun ?? null))}`;
        return /leaves the workspace/.test(reason)
          ? PASS
          : fail(
              `the seeded path ${parent} should be refused because it leaves the workspace; the run said ${reason.trim().slice(0, 200) || 'nothing'}`,
            );
      }),
  },
  {
    id: 'artifact-same-path',
    level: 1,
    component: ARTIFACTS,
    cause:
      'Two artifact expectations on one path get their own verdict ids (path, then path#2) and are judged apart.',
    title:
      'two or three artifact expectations on the same file give distinct verdict ids, each judged on its own checks',
    tier: 3,
    variants: 3,
    check: async ({ product, seed, id, scratch, variant }) =>
      guarded(async () => {
        const path = `out/${token(seed, `${id}#o`)}.csv`;
        const days = 3 + variant;
        const entries = Array.from({ length: 2 + (variant % 2) }, (_, i) => ({
          path,
          kind: 'csv',
          checks: [{ value: { column: 'days', row: 2, equals: i === 1 ? days + 1 : days } }],
        }));
        const record = await playCode(product, seed, id, scratch, [
          {
            expect: { artifacts: entries },
            action: {
              reply: 'Done.',
              files: [
                {
                  path,
                  format: 'csv',
                  data: [
                    ['bike', 'days'],
                    ['Fern 3', days],
                  ],
                },
              ],
              commands: [{ command: 'python a.py', exitCode: 0 }],
            },
          },
        ]);
        const verdicts = (record.blocks[0]?.verdicts ?? []).filter((v) => v.id.startsWith('artifacts.'));
        const ids = verdicts.map((v) => v.id);
        if (new Set(ids).size !== ids.length)
          return fail(`each artifact expectation should have its own verdict ids; ids repeat: ${list(ids)}`);
        const want = entries.map((_, i) => `artifacts.${i === 0 ? path : `${path}#${i + 1}`}.0.value`);
        const failing = verdicts.filter((v) => v.outcome !== 'pass').map((v) => v.id);
        return failing.join(',') === (want[1] as string) && want.every((w) => ids.includes(w))
          ? PASS
          : fail(
              `the checks should be ${list(want)}, with only ${want[1]} failing; got ${list(ids)}, failing ${list(failing)}`,
            );
      }),
  },
  {
    id: 'exit-negative',
    level: 1,
    component: EXECUTION,
    cause: 'exit_code reads the agent process whenever it exited non-zero, a negative code included.',
    title:
      'an agent process that ends with a negative exit code fails exit_code 0, though its last command exited 0',
    tier: 2,
    variants: 3,
    check: async ({ product, seed, id, variant }) =>
      guarded(async () => {
        const code = [-1, -9, -15][variant] as number;
        const adapter = scriptedAdapter(product, () => ({
          ...observed('Done.'),
          executions: [
            { role: 'command', command: `python ${token(seed, `${id}#c`)}.py`, exitCode: 0 },
            { role: 'agent', command: 'agent', exitCode: code },
          ],
        }));
        const raw: RawSpec = {
          id: `spec-${token(seed, `${id}#spec`)}`,
          channel: 'chat',
          lang: 'EN',
          blocks: [{ id: token(seed, `${id}#b`), user: 'Run it.', expect: { execution: { exit_code: 0 } } }],
        };
        const record = (await run(product, raw, adapter)) as unknown as {
          blocks: { verdicts: { id: string; outcome: string }[] }[];
        };
        const verdict = record.blocks[0]?.verdicts.find((v) => v.id === 'execution.exit_code');
        return verdict?.outcome === 'fail'
          ? PASS
          : fail(
              `execution.exit_code should fail: the agent process exited ${code}; got ${verdict?.outcome ?? 'no verdict'}`,
            );
      }),
  },
  {
    id: 'pooled-rate-scored',
    level: 9,
    component: HEADLINE,
    cause:
      'The pooled rate of the suite headline is the passing runs over the scored runs, never over every run.',
    title:
      'the pooled rate of a headline over runs some of which were not run or blocked counts the scored runs only',
    tier: 2,
    variants: 3,
    check: async ({ product, rng, seed, id }) =>
      guarded(async () => {
        const suiteHeadline = need<
          (runs: unknown[], treeOf: (run: { specId: string }) => string) => { pooledRate: number } | undefined
        >(product.report, 'report', 'suiteHeadline');
        const runs: { specId: string; status: string; blocks: Block[] }[] = [];
        let passes = 0;
        let scored = 0;
        for (let g = 0; g < between(rng, 3, 5); g += 1)
          for (let r = 0; r < between(rng, 2, 4); r += 1) {
            const roll = rng();
            const status = roll < 0.45 ? 'pass' : roll < 0.75 ? 'fail' : roll < 0.88 ? 'not_run' : 'blocked';
            if (status === 'pass') passes += 1;
            if (status === 'pass' || status === 'fail') scored += 1;
            runs.push({
              specId: `spec-${token(seed, `${id}#g${g}`)}`,
              status: 'completed',
              blocks: [block(status)],
            });
          }
        if (scored === runs.length)
          runs.push({ specId: runs[0]?.specId as string, status: 'completed', blocks: [block('not_run')] });
        const got = suiteHeadline(runs, (run) => run.specId)?.pooledRate;
        const want = passes / scored;
        return got !== undefined && Math.abs(got - want) < 1e-12
          ? PASS
          : fail(`the pooled rate should be ${passes} of ${scored} scored runs (${want}); got ${got}`);
      }),
  },
  {
    id: 'merge-world-workspace',
    level: 1,
    component: GIVEN,
    cause:
      "A later world's workspace replaces the earlier one whole; an earlier workspace never overrides it.",
    title: 'merging a later world over an earlier one keeps the later workspace whole',
    tier: 1,
    variants: 3,
    check: async ({ product, seed, id, variant }) =>
      guarded(async () => {
        const mergeWorld = need<(base: unknown, next: unknown) => { workspace?: unknown }>(
          product.core,
          'core',
          'mergeWorld',
        );
        const earlier = { files: { [`a/${token(seed, `${id}#a`)}.txt`]: 'earlier\n' } };
        const later =
          variant === 2
            ? { from: `./${token(seed, `${id}#from`)}` }
            : { files: { [`b/${token(seed, `${id}#b`)}.txt`]: 'later\n' } };
        const got = mergeWorld(
          { workspace: earlier, ...(variant === 1 ? { fixtures: { x: 1 } } : {}) },
          { workspace: later },
        );
        return canonical(got.workspace) === canonical(later)
          ? PASS
          : fail(
              `the merged workspace should be the later one ${JSON.stringify(later)}; got ${JSON.stringify(got.workspace)}`,
            );
      }),
  },
];

type Report = {
  whole?: unknown;
  specs: { blocks: { state: Record<string, string | undefined> }[] }[];
  totals: Record<string, { sent: number } | undefined>;
};

function radius(
  product: BlocksProduct,
  specs: unknown[],
  change: Record<string, unknown>,
  modes: string[],
): Report {
  const contentHash = need<(value: unknown) => string>(product.core, 'core', 'contentHash');
  const radiusOf = need<(specs: unknown[], manifest: unknown, options: unknown) => Report>(
    product.core,
    'core',
    'radiusOf',
  );
  return radiusOf(
    specs.map((spec) => ({ spec, hash: contentHash(spec) })),
    { from: 'larkspur-v1', to: 'larkspur-v2', changes: [change] },
    { modes },
  );
}

/** One carry plan: a stored run already carried `times` campaigns, under --max-carry `max`. */
function carryCase(product: BlocksProduct, seed: number, id: string, variant: number): ItemResult {
  const fn = <T>(name: string) => need<T>(product.core, 'core', name);
  const contentHash = fn<(v: unknown) => string>('contentHash');
  const cellId = fn<(k: unknown) => string>('cellId');
  const provenanceHash = fn<(v: unknown) => string>('provenanceHash');
  const provenanceDigest = fn<(run: unknown) => string>('provenanceDigest');
  const initialGiven = fn<(spec: unknown) => unknown>('initialGiven');
  const resolveGiven =
    fn<(g: unknown, layers: unknown[], target: unknown) => { hash: string }>('resolveGiven');
  const radiusOf = fn<(specs: unknown[], manifest: unknown) => unknown>('radiusOf');
  const planRadiusCampaign =
    fn<(...a: unknown[]) => { carried: unknown[]; refused: { reason: string }[] }>('planRadiusCampaign');
  const max = [1, 2, 3, 5][variant % 4] as number;
  const times = variant < 4 ? max - 1 : max;
  const stage = token(seed, `${id}#stage`);
  const specOf = (sid: string, s: string) => ({
    id: sid,
    kind: 'conversation',
    blocks: [{ id: 'b1', when: { user: 'Hello' }, expect: { stage: s } }],
    metadata: { generated: { cell: { flow: sid } } },
  });
  const inside = `spec-${token(seed, `${id}#in`)}`;
  const outside = `spec-${token(seed, `${id}#out`)}`;
  const specs = [
    { spec: specOf(inside, stage), hash: contentHash(specOf(inside, stage)) },
    { spec: specOf(outside, `${stage}x`), hash: contentHash(specOf(outside, `${stage}x`)) },
  ];
  const manifest = { from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: stage }] };
  const target = (variantName?: string) => ({
    adapter: 'function',
    agent: 'larkspur-desk',
    ...(variantName === undefined ? {} : { variant: variantName }),
  });
  const cell = (sid: string, v?: string) => {
    const spec = specs.find((each) => each.spec.id === sid)?.spec;
    const key = { specHash: contentHash(spec), target: target(v), mode: 'F', repeat: 0 };
    return { cellId: cellId(key), specId: sid, ...key, blocks: 1 };
  };
  const stored = (sid: string, v: string | undefined, over: Record<string, unknown> = {}) => {
    const planned = cell(sid, v);
    const spec = specs.find((each) => each.spec.id === sid)?.spec;
    const carriedVersion = (over.carried as { agentVersion?: string } | undefined)?.agentVersion ?? v;
    const runRecord: Record<string, unknown> = {
      runId: planned.cellId,
      specId: sid,
      specHash: planned.specHash,
      target: planned.target,
      mode: 'F',
      repeat: 0,
      status: 'completed',
      provenance: {
        version: 2,
        driver: { idHash: provenanceHash('scripted'), seedsHash: provenanceHash({}) },
        adapter: {
          idHash: provenanceHash('function'),
          versionHash: provenanceHash('1'),
          cacheIdentityHash: null,
          requiresCacheIdentity: false,
        },
        agentVersionHash: v === undefined ? null : provenanceHash(v),
        executionHash: provenanceHash('execution'),
        targetVersionHash: provenanceHash({ variant: v }),
        agentVersionLabelHash: null,
      },
      blocks: [
        {
          index: 0,
          blockId: 'b1',
          givenHash: resolveGiven(initialGiven(spec), [], target(carriedVersion)).hash,
          provenance: {
            specIndex: 0,
            stimulusHash: provenanceHash({ user: 'Hello' }),
            ledgerHash: provenanceHash({}),
            artifacts: [],
          },
          observed: { text: 'ok', segments: [], toolCalls: [], cost: {}, latencyMs: 0 },
          verdicts: [],
          drift: [],
          pass: true,
          ledgerCheck: { ok: true, contradictions: [] },
        },
      ],
      succession: {},
      cost: 0.25,
      latencyMs: 10,
      startedAt: '2026-10-01T00:00:00.000Z',
      finishedAt: '2026-10-01T00:00:01.000Z',
      cacheHit: false,
      ...over,
    };
    return { ...runRecord, provenanceDigest: provenanceDigest(runRecord) };
  };
  const carried =
    times === 0
      ? {}
      : {
          carried: {
            fromCampaign: `c-${token(seed, `${id}#c0`)}`,
            fromRun: `r-${token(seed, `${id}#r0`)}`,
            agentVersion: 'v1',
            age: { campaigns: times, days: 0.5 },
          },
        };
  const runs = [stored(inside, 'v1'), stored(outside, 'v1', carried)];
  const plan = planRadiusCampaign(
    [cell(inside, 'v2'), cell(outside, 'v2')],
    radiusOf(specs, manifest),
    manifest,
    {
      campaignId: 'c-base',
      runs,
      provenance: {
        version: 2,
        adapters: [
          {
            idHash: provenanceHash('function'),
            versionHash: provenanceHash('1'),
            cacheIdentityHash: null,
            requiresCacheIdentity: false,
            targetHash: provenanceHash(target('v1')),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
    },
    {
      now: new Date('2026-10-01T12:00:01.000Z'),
      maxCarry: max,
      currentSpec: (c: { specId: string }) => specs.find((each) => each.spec.id === c.specId)?.spec,
      currentProvenance: (c: { specId: string; target: { variant?: string } }) =>
        (stored(c.specId, c.target.variant) as unknown as { provenance: unknown }).provenance,
    },
  );
  const wantCarried = times + 1 <= max;
  if (wantCarried)
    return plan.carried.length === 1
      ? PASS
      : fail(
          `with --max-carry ${max}, a result carried ${times} times should be carried once more (its ${times + 1}th campaign); it was refused: ${list(plan.refused.map((r) => r.reason))}`,
        );
  return plan.carried.length === 0 && plan.refused.some((r) => /carried/.test(r.reason))
    ? PASS
    : fail(
        `with --max-carry ${max}, a result carried ${times} times should run fresh; it was ${plan.carried.length > 0 ? 'carried' : `refused for another reason: ${list(plan.refused.map((r) => r.reason))}`}`,
      );
}

export function boundaryItems(): BankItem[] {
  return GROUPS.flatMap((group) =>
    Array.from({ length: group.variants }, (_, variant) => {
      const id = `boundaries/${group.id}/${variant}`;
      return {
        id,
        family: 'boundaries',
        tier: group.tier,
        level: group.level,
        component: group.component,
        title: `${group.title} (variant ${variant})`,
        cause: group.cause,
        check: ({ seed, scratch, product }) =>
          group.check({ seed, id, rng: rngFor(seed, id), scratch, product, variant }),
      } satisfies BankItem;
    }),
  );
}
