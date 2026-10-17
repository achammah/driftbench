import { rngFor, shuffled } from '../../blocks/harness';
import {
  type BankItem,
  type BlockRecord,
  CORE,
  call,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  PASS,
  play,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-stage: the stage classifier and the flow verdicts (docs/concepts/drift.md "The stage classifier"). A catalogue of
 * seeded stage names, each with the tools its blocks expect; an agent that calls tools and reports no stage, so the
 * classifier reads the stage from the calls alone. The expected stage of each block is computed by the documented rule.
 */

const FAMILY = 'bg-stage';
const D = 'docs/concepts/drift.md "The stage classifier"';
const X3 = 'X3_flow';

export type B = {
  /** The stage the block expects. */
  expect?: string;
  /** Tools the block expects (count 1). */
  tools?: string[];
  /** Tools the block expects not to be called (count 0). */
  never?: string[];
  /** The tools the agent calls. */
  calls?: string[];
  /** Stages the agent reports in the block, in order. */
  report?: string[];
};

export type Pert = { id: string; at: number; expect: string; tools: string[] };

export type Setup = { stages: string[]; blocks: B[]; perts?: Pert[]; mode?: 'F' | 'T' };

export async function runStage(ctx: ItemContext, tag: string, setup: Setup) {
  const defs = setup.blocks.map((b, i) => ({
    plan: {
      text: `Reply ${i}.`,
      calls: (b.calls ?? []).map((label) => call(label)),
      ...(b.report ? { extra: { runtime: { stages: b.report.map((name) => ({ name })) } } } : {}),
    },
    expect: {
      ...(b.expect ? { stage: b.expect } : {}),
      ...((b.tools?.length ?? 0) + (b.never?.length ?? 0) > 0
        ? {
            tools: [
              ...(b.tools ?? []).map((label) => ({ label, count: 1 })),
              ...(b.never ?? []).map((label) => ({ label, count: 0 })),
            ],
          }
        : {}),
    },
  }));
  const sc = scenario(ctx.seed, tag, defs, {
    stages: setup.stages,
    ...(setup.perts
      ? {
          perturbations: setup.perts.map((p) => ({
            id: p.id,
            class: 'D1_off_topic',
            inject_at: p.at,
            user: word(ctx.seed, `${tag}:pert:${p.id}`, 9),
            expect: { stage: p.expect, tools: p.tools.map((label) => ({ label, count: 1 })) },
          })),
        }
      : {}),
  });
  for (const p of setup.perts ?? []) sc.plans.set(word(ctx.seed, `${tag}:pert:${p.id}`, 9), { text: 'ok' });
  const { rec } = await play(ctx, sc, { mode: setup.mode ?? 'F' });
  return rec;
}

export const stageOf = (block: BlockRecord | undefined) =>
  (block as unknown as { stageObserved?: string })?.stageObserved;
type VerdictLike = { id: string; outcome: string; gating: boolean; evidence?: string };
export const flowOf = (block: BlockRecord | undefined) =>
  ((block?.verdicts ?? []) as VerdictLike[]).filter((verdict) => verdict.id.startsWith('flow.'));
export const driftOf = (block: BlockRecord | undefined) =>
  ((block as unknown as { drift?: string[] })?.drift ?? []) as string[];

/** The classifier as the documentation words it. */
export function oracle(setup: Setup): (string | undefined)[] {
  const sigs = new Map<string, Set<string>>(setup.stages.map((s) => [s, new Set<string>()]));
  for (const b of setup.blocks) if (b.expect) for (const t of b.tools ?? []) sigs.get(b.expect)?.add(t);
  for (const p of setup.perts ?? []) for (const t of p.tools) sigs.get(p.expect)?.add(t);
  const order = setup.stages;
  const out: (string | undefined)[] = [];
  let expectedBefore: string | undefined;
  setup.blocks.forEach((b, i) => {
    const before = setup.mode === 'T' ? expectedBefore : out[i - 1];
    const calls = new Set(b.calls ?? []);
    let reached: string | undefined;
    if (calls.size === 0) {
      reached = before ?? order.find((s) => (sigs.get(s) as Set<string>).size === 0);
    } else {
      let best = 0;
      let tied: string[] = [];
      for (const s of order) {
        const sig = sigs.get(s) as Set<string>;
        const inter = [...calls].filter((t) => sig.has(t)).length;
        if (inter === 0) continue;
        const j = inter / (calls.size + sig.size - inter);
        if (j > best + 1e-12) {
          best = j;
          tied = [s];
        } else if (Math.abs(j - best) < 1e-12) tied.push(s);
      }
      if (tied.length > 0) {
        const from = before === undefined ? -1 : order.indexOf(before);
        reached = tied.find((s) => order.indexOf(s) >= from && from >= 0) ?? tied[0];
      }
    }
    out.push(reached);
    if (b.expect) expectedBefore = b.expect;
  });
  return out;
}

export function compare(_tag: string, setup: Setup, rec: { blocks: BlockRecord[] }): ItemResult {
  const want = oracle(setup);
  const got = rec.blocks.map(stageOf);
  const at = want.findIndex(
    (w, i) => w !== got[i] && !(w === undefined && (got[i] === undefined || got[i] === null)),
  );
  if (at === -1 && got.length === want.length) return PASS;
  const b = setup.blocks[at] ?? {};
  return fail(
    say(
      D,
      `block ${at} (calls ${show(b.calls ?? [])}, stage before ${show(at > 0 ? want[at - 1] : null)}) reaches ${show(want[at])}`,
      `stageObserved ${show(got)} against ${show(want)}`,
    ),
  );
}

/** Stage and tool names for an item: seeded, so nothing says which stage a call belongs to. */
export function names(ctx: ItemContext, tag: string, stages: number, tools: number) {
  return {
    s: Array.from({ length: stages }, (_, i) => word(ctx.seed, `${tag}:stage${i}`, 6)),
    t: Array.from({ length: tools }, (_, i) => word(ctx.seed, `${tag}:tool${i}`, 6)),
  };
}

function jaccardItems(): BankItem[] {
  // Catalogue S0 = {t0}, S1 = {t0, t1}, S2 = {t1, t2, t3}; each case calls one set of tools.
  const cases: { id: string; calls: number[]; reached: number }[] = [
    { id: 'subset-signature-wins', calls: [0], reached: 0 },
    { id: 'exact-signature-wins', calls: [0, 1], reached: 1 },
    { id: 'partial-overlap-picks-the-smaller-union', calls: [1], reached: 1 },
    { id: 'three-tool-signature', calls: [2, 3], reached: 2 },
    { id: 'an-unexpected-tool-lowers-every-overlap', calls: [0, 4], reached: 0 },
    { id: 'larger-signature-with-two-shared-tools', calls: [1, 2], reached: 2 },
  ];
  return cases.map((each) =>
    gitem(
      FAMILY,
      `bg.stage.jaccard.${each.id}`,
      3,
      CORE,
      'ST1',
      `a block with tool calls takes the stage whose signature has the largest Jaccard overlap with them (${each.id})`,
      async (ctx) => {
        const tag = `bg.stage.jaccard.${each.id}`;
        const { s, t } = names(ctx, tag, 3, 5);
        const sig = [[0], [0, 1], [1, 2, 3]];
        const setup: Setup = {
          stages: s,
          blocks: [
            ...sig.map((tools, i) => ({
              expect: s[i] as string,
              tools: tools.map((k) => t[k] as string),
              calls: tools.map((k) => t[k] as string),
            })),
            { calls: each.calls.map((k) => t[k] as string) },
          ],
        };
        const rec = await runStage(ctx, tag, setup);
        const got = stageOf(rec.blocks[3]);
        return got === s[each.reached] && stageOf(rec.blocks[0]) === s[0] && stageOf(rec.blocks[2]) === s[2]
          ? PASS
          : fail(
              say(
                D,
                `calls ${show(each.calls)} reach stage ${each.reached}`,
                `${show(rec.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x))))}`,
              ),
            );
      },
    ),
  );
}

function randomItems(): BankItem[] {
  return Array.from({ length: 6 }, (_, k) =>
    gitem(
      FAMILY,
      `bg.stage.random.${k}`,
      4,
      CORE,
      'ST1',
      'over a seeded catalogue and seeded tool calls, every block reaches the stage the documented classifier gives',
      async (ctx) => {
        const tag = `bg.stage.random.${k}`;
        const rng = rngFor(ctx.seed, tag);
        const stageCount = 4 + (k % 2);
        const { s, t } = names(ctx, tag, stageCount, 7);
        const blocks: B[] = [];
        const length = 9;
        for (let i = 0; i < length; i += 1) {
          const calls = shuffled(rng, t.slice(0, 6)).slice(0, Math.floor(rng() * 4));
          // The last tool is never expected: a call to it alone is unclassified.
          if (rng() < 0.15) calls.push(t[6] as string);
          const expectAt = i < stageCount ? i : Math.floor(rng() * stageCount);
          const tools = shuffled(rng, t.slice(0, 6)).slice(0, 1 + Math.floor(rng() * 2));
          blocks.push({
            expect: s[expectAt] as string,
            tools: expectAt % 2 === 1 && rng() < 0.4 ? [] : tools,
            calls,
          });
        }
        const setup: Setup = { stages: s, blocks };
        // The page words no rule for the block after an unclassified one: only the last block may be left unclassified.
        const union = [...new Set(blocks.flatMap((block) => (block.expect ? (block.tools ?? []) : [])))];
        for (let round = 0; round < 6; round += 1) {
          const want = oracle(setup);
          const at = want.findIndex((w, i) => w === undefined && i < blocks.length - 1);
          if (at === -1) break;
          (blocks[at] as B).calls = [(union[0] ?? t[0]) as string];
        }
        return compare(tag, setup, await runStage(ctx, tag, setup));
      },
    ),
  );
}

/** Blocks that only define the catalogue: each expects a stage and its tools and calls nothing. They close the run. */
export const defining = (stages: string[], sigs: string[][]): B[] =>
  sigs.map((tools, i) => ({ expect: stages[i] as string, tools }));

function tieItems(): BankItem[] {
  // Five stages: S1 and S3 both expect only the shared tool u; S0, S2 and S4 each have a tool of their own.
  const cases: { id: string; chain: number[]; tied: number }[] = [
    { id: 'previous-stage-before-both', chain: [0], tied: 1 },
    { id: 'previous-stage-between-them', chain: [2], tied: 3 },
    { id: 'previous-stage-is-the-later-one', chain: [2, -1], tied: 3 },
    { id: 'previous-stage-is-the-earlier-one', chain: [0, -1], tied: 1 },
    { id: 'previous-stage-after-both', chain: [4], tied: 1 },
    { id: 'no-stage-before', chain: [], tied: 1 },
  ];
  return cases.map((each) =>
    gitem(
      FAMILY,
      `bg.stage.tie.${each.id}`,
      4,
      CORE,
      'ST2',
      `a tie between stages goes to the first tied stage at or after the stage before, else the first tied (${each.id})`,
      async (ctx) => {
        const tag = `bg.stage.tie.${each.id}`;
        const { s, t } = names(ctx, tag, 5, 4);
        const [u, own0, own2, own4] = t as [string, string, string, string];
        const ownOf = [own0, u, own2, u, own4];
        // chain entries: a stage number calls that stage's own tool; -1 calls the shared tool again (a tie too).
        const chain: B[] = each.chain.map((k) => ({ calls: [k === -1 ? u : (ownOf[k] as string)] }));
        const setup: Setup = {
          stages: s,
          blocks: [...chain, { calls: [u] }, ...defining(s, [[own0], [u], [own2], [u], [own4]])],
        };
        const rec = await runStage(ctx, tag, setup);
        const probe = stageOf(rec.blocks[each.chain.length]);
        const seq = rec.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x)));
        if (probe !== s[each.tied])
          return fail(
            say(
              D,
              `the shared tool reaches stage ${each.tied} after ${show(each.chain)}`,
              `stages reached ${show(seq)}`,
            ),
          );
        return compare(tag, setup, rec);
      },
    ),
  );
}

function modeTItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (id: string, title: string, check: (ctx: ItemContext, tag: string) => Promise<ItemResult>) =>
    out.push(
      gitem(FAMILY, `bg.stage.mode-t.${id}`, 5, CORE, 'ST10', title, (ctx) =>
        check(ctx, `bg.stage.mode-t.${id}`),
      ),
    );
  // b0 expects S2 and calls the tool of S0; b1 calls the shared tool of S1 and S3.
  const base = (ctx: ItemContext, tag: string) => {
    const { s, t } = names(ctx, tag, 5, 4);
    const [u, own0, own2, own4] = t as [string, string, string, string];
    return { s, u, own0, own2, own4 };
  };
  add(
    'tie-reads-the-stage-the-spec-expects',
    'in mode T the stage before a block is the last stage an earlier block expects: a tie resolves from there, in F from the stage the agent reached',
    async (ctx, tag) => {
      const { s, u, own0, own2, own4 } = base(ctx, tag);
      const blocks: B[] = [
        { expect: s[2] as string, tools: [own2], calls: [own0] },
        { expect: s[0] as string, tools: [own0], calls: [u] },
        ...defining(s, [[own0], [u], [own2], [u], [own4]]).slice(1),
      ];
      const T = await runStage(ctx, tag, { stages: s, blocks, mode: 'T' });
      const F = await runStage(ctx, tag, { stages: s, blocks, mode: 'F' });
      return compare(`${tag}:T`, { stages: s, blocks, mode: 'T' }, T).pass &&
        compare(`${tag}:F`, { stages: s, blocks, mode: 'F' }, F).pass &&
        stageOf(T.blocks[1]) === s[3] &&
        stageOf(F.blocks[1]) === s[1]
        ? PASS
        : fail(
            say(
              D,
              'the tie goes to stage 3 in T (stage before: the expected stage 2) and to stage 1 in F (stage before: stage 0 reached)',
              `T ${show(T.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x))))}, F ${show(F.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x))))}`,
            ),
          );
    },
  );
  add(
    'no-call-block-keeps-the-expected-stage',
    'in mode T a block with no tool call keeps the stage an earlier block expects, in F the stage the run reached',
    async (ctx, tag) => {
      const { s, u, own0, own2, own4 } = base(ctx, tag);
      const blocks: B[] = [
        { expect: s[2] as string, tools: [own2], calls: [own0] },
        { expect: s[1] as string, tools: [u] },
        ...defining(s, [[own0], [u], [own2], [u], [own4]]).slice(3),
      ];
      const T = await runStage(ctx, tag, { stages: s, blocks, mode: 'T' });
      const F = await runStage(ctx, tag, { stages: s, blocks, mode: 'F' });
      return stageOf(T.blocks[1]) === s[2] && stageOf(F.blocks[1]) === s[0]
        ? PASS
        : fail(
            say(
              D,
              'a block with no call keeps stage 2 in T and stage 0 in F',
              `T ${show(T.blocks.map(stageOf))}, F ${show(F.blocks.map(stageOf))}`,
            ),
          );
    },
  );
  add(
    'first-block-has-no-stage-before',
    'in mode T the first block has no stage before it, so a tie goes to the first tied stage',
    async (ctx, tag) => {
      const { s, u, own0, own2, own4 } = base(ctx, tag);
      const blocks: B[] = [
        { expect: s[3] as string, tools: [u], calls: [u] },
        ...defining(s, [[own0], [u], [own2], [], [own4]]).slice(0, 3),
      ];
      const T = await runStage(ctx, tag, { stages: s, blocks, mode: 'T' });
      return stageOf(T.blocks[0]) === s[1]
        ? PASS
        : fail(say(D, 'the first block reaches the first tied stage (1)', show(T.blocks.map(stageOf))));
    },
  );
  add(
    'reported-stage-does-not-carry',
    'a stage the runtime reported in an earlier block carries in F and P, not in T, where the classifier reads the calls',
    async (ctx, tag) => {
      const { s, own0, own2 } = base(ctx, tag);
      const blocks: B[] = [
        { expect: s[1] as string, tools: [own2], calls: [own2], report: [s[1] as string] },
        { expect: s[0] as string, tools: [own0], calls: [own0] },
      ];
      const T = await runStage(ctx, tag, { stages: s, blocks, mode: 'T' });
      const F = await runStage(ctx, tag, { stages: s, blocks, mode: 'F' });
      return stageOf(T.blocks[1]) === s[0] && stageOf(F.blocks[1]) === s[1]
        ? PASS
        : fail(
            say(
              D,
              'T classifies block 1 from its calls (stage 0); F keeps the stage block 0 reported (stage 1)',
              `T ${show(T.blocks.map(stageOf))}, F ${show(F.blocks.map(stageOf))}`,
            ),
          );
    },
  );
  return out;
}

function carryItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'ST3' | 'ST4' | 'ST5' | 'ST6',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.stage.${id}`, tier, CORE, cause, title, (ctx) => check(ctx, `bg.stage.${id}`)),
    );
  // No call: keep the stage before.
  for (const length of [1, 2, 3]) {
    add(
      `no-call.keeps-the-stage-${length}`,
      3,
      'ST4',
      `a block with no tool call keeps the stage before it (${length} in a row)`,
      async (ctx, tag) => {
        const { s, t } = names(ctx, tag, 3, 3);
        const setup: Setup = {
          stages: s,
          blocks: [
            { calls: [t[1] as string] },
            ...Array.from({ length }, () => ({ calls: [] as string[] })),
            ...defining(s, [[t[0] as string], [t[1] as string], [t[2] as string]]),
          ],
        };
        const rec = await runStage(ctx, tag, setup);
        const stages = rec.blocks.slice(0, 1 + length).map(stageOf);
        return stages.every((x) => x === s[1])
          ? compare(tag, setup, rec)
          : fail(
              say(
                D,
                `${1 + length} blocks in stage 1`,
                show(stages.map((x) => (x === undefined ? null : s.indexOf(x)))),
              ),
            );
      },
    );
  }
  // First block: the first stage that expects no tool.
  const firsts: { id: string; sigs: (string | null)[]; want: number }[] = [
    { id: 'second-stage-is-tool-free', sigs: ['a', null, 'b'], want: 1 },
    { id: 'third-stage-is-the-first-tool-free', sigs: ['a', 'b', null, null], want: 2 },
    { id: 'first-stage-is-tool-free', sigs: [null, 'a', 'b'], want: 0 },
  ];
  for (const each of firsts)
    add(
      `first-block.${each.id}`,
      4,
      'ST4',
      `the first block, with no stage before and no tool call, takes the first stage of the catalogue that expects no tool (${each.id})`,
      async (ctx, tag) => {
        const { s, t } = names(ctx, tag, each.sigs.length, 3);
        const tool = (k: string | null) => (k === null ? [] : [t[k === 'a' ? 0 : 1] as string]);
        const setup: Setup = { stages: s, blocks: [{ calls: [] }, ...defining(s, each.sigs.map(tool))] };
        const rec = await runStage(ctx, tag, setup);
        return stageOf(rec.blocks[0]) === s[each.want]
          ? PASS
          : fail(
              say(
                D,
                `stage ${each.want}`,
                show(rec.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x)))),
              ),
            );
      },
    );
  // Calls no stage expects: unclassified.
  const unknown: { id: string; calls: (t: string[]) => string[] }[] = [
    { id: 'only-an-unexpected-tool', calls: (t) => [t[3] as string] },
    { id: 'two-unexpected-tools', calls: (t) => [t[3] as string, t[4] as string] },
  ];
  for (const each of unknown)
    add(
      `unclassified.${each.id}`,
      3,
      'ST3',
      `tool calls that no stage expects leave the block without a stage (${each.id})`,
      async (ctx, tag) => {
        const { s, t } = names(ctx, tag, 3, 5);
        const setup: Setup = {
          stages: s,
          blocks: [
            { calls: [t[0] as string] },
            { calls: each.calls(t) },
            ...defining(s, [[t[0] as string], [t[1] as string], [t[2] as string]]),
          ],
        };
        const rec = await runStage(ctx, tag, setup);
        const got = stageOf(rec.blocks[1]);
        return stageOf(rec.blocks[0]) === s[0] && (got === undefined || got === null)
          ? PASS
          : fail(
              say(
                D,
                'block 0 in stage 0 and block 1 without a stage',
                `stageObserved ${show(rec.blocks.map(stageOf))}`,
              ),
            );
      },
    );
  add(
    'unclassified.a-known-tool-beside-an-unexpected-one',
    3,
    'ST3',
    'an unexpected tool beside an expected one lowers the overlap but the block still takes the stage that overlaps most',
    async (ctx, tag) => {
      const { s, t } = names(ctx, tag, 3, 5);
      const setup: Setup = {
        stages: s,
        blocks: [
          { calls: [t[1] as string, t[3] as string] },
          ...defining(s, [[t[0] as string], [t[1] as string], [t[2] as string]]),
        ],
      };
      const rec = await runStage(ctx, tag, setup);
      return stageOf(rec.blocks[0]) === s[1] ? PASS : fail(say(D, 'stage 1', show(rec.blocks.map(stageOf))));
    },
  );
  // Signature counts above 0 only.
  add(
    'signature.count-zero-is-not-in-the-signature',
    4,
    'ST5',
    'a tool a block expects with count 0 is not in the stage signature',
    async (ctx, tag) => {
      const { s, t } = names(ctx, tag, 2, 3);
      const [a, c, z] = t as [string, string, string];
      // S0 = {a, c}; S1 = {a} and z with count 0. Calling a alone: S1 overlaps fully, S0 by half.
      const setup: Setup = {
        stages: s,
        blocks: [
          { calls: [a] },
          { expect: s[0] as string, tools: [a, c] },
          { expect: s[1] as string, tools: [a], never: [z] },
        ],
      };
      const rec = await runStage(ctx, tag, setup);
      return stageOf(rec.blocks[0]) === s[1]
        ? PASS
        : fail(
            say(
              D,
              'calling a alone reaches stage 1: z with count 0 is no part of its signature',
              show(rec.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x)))),
            ),
          );
    },
  );
  add(
    'signature.count-zero-tool-alone-is-unclassified',
    4,
    'ST5',
    'a call to a tool that only blocks expect with count 0 leaves the block without a stage',
    async (ctx, tag) => {
      const { s, t } = names(ctx, tag, 2, 3);
      const [a, c, z] = t as [string, string, string];
      const setup: Setup = {
        stages: s,
        blocks: [
          { calls: [z] },
          { expect: s[0] as string, tools: [a, c] },
          { expect: s[1] as string, tools: [a], never: [z] },
        ],
      };
      const rec = await runStage(ctx, tag, setup);
      const got = stageOf(rec.blocks[0]);
      return got === undefined || got === null ? PASS : fail(say(D, 'no stage', show(got)));
    },
  );
  add(
    'signature.blocks-of-one-stage-add-up',
    4,
    'ST5',
    'the signature of a stage is the tools of all the blocks that expect it',
    async (ctx, tag) => {
      const { s, t } = names(ctx, tag, 2, 4);
      const [a, b, c] = t as [string, string, string];
      // S0 = {a, b, c} over two blocks; S1 = {a, b}. Calling a, b, c: S0 is exact.
      const setup: Setup = {
        stages: s,
        blocks: [
          { calls: [a, b, c] },
          { expect: s[0] as string, tools: [a, b] },
          { expect: s[0] as string, tools: [c] },
          { expect: s[1] as string, tools: [a, b] },
        ],
      };
      const rec = await runStage(ctx, tag, setup);
      return stageOf(rec.blocks[0]) === s[0]
        ? PASS
        : fail(
            say(
              D,
              'stage 0',
              show(rec.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x)))),
            ),
          );
    },
  );
  // Perturbations count.
  add(
    'signature.perturbation-expectations-count',
    4,
    'ST6',
    'the tools a perturbation expects at a stage belong to that stage signature',
    async (ctx, tag) => {
      const { s, t } = names(ctx, tag, 2, 3);
      const [a, b] = t as [string, string];
      const withIt: Setup = {
        stages: s,
        blocks: [
          { calls: [a, b] },
          { expect: s[0] as string, tools: [a, b, t[2] as string] },
          { expect: s[1] as string, tools: [a] },
        ],
        perts: [{ id: word(ctx.seed, `${tag}:p`, 5), at: 1, expect: s[1] as string, tools: [b] }],
      };
      const without: Setup = { ...withIt, perts: undefined };
      const rec = await runStage(ctx, `${tag}:with`, withIt);
      const control = await runStage(ctx, `${tag}:without`, without);
      return stageOf(rec.blocks[0]) === s[1] && stageOf(control.blocks[0]) === s[0]
        ? PASS
        : fail(
            say(
              D,
              'with the perturbation S1 = {a, b} and the call reaches stage 1; without it S1 = {a} and stage 0 overlaps more',
              `with ${show(rec.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x))))}, without ${show(control.blocks.map(stageOf).map((x) => (x === undefined ? null : s.indexOf(x))))}`,
            ),
          );
    },
  );
  add(
    'signature.a-stage-only-a-perturbation-expects',
    4,
    'ST6',
    'a stage only a perturbation expects tools for still has a signature',
    async (ctx, tag) => {
      const { s, t } = names(ctx, tag, 2, 3);
      const [a, b] = t as [string, string];
      const withIt: Setup = {
        stages: s,
        blocks: [{ calls: [b] }, { expect: s[0] as string, tools: [a] }],
        perts: [{ id: word(ctx.seed, `${tag}:p`, 5), at: 0, expect: s[1] as string, tools: [b] }],
      };
      const rec = await runStage(ctx, `${tag}:with`, withIt);
      const control = await runStage(ctx, `${tag}:without`, { ...withIt, perts: undefined });
      const none = stageOf(control.blocks[0]);
      return stageOf(rec.blocks[0]) === s[1] && (none === undefined || none === null)
        ? PASS
        : fail(
            say(
              D,
              'with the perturbation the call reaches stage 1; without it nothing expects the tool',
              `with ${show(rec.blocks.map(stageOf))}, without ${show(control.blocks.map(stageOf))}`,
            ),
          );
    },
  );
  return out;
}

function flowItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'ST7' | 'ST8' | 'ST9' | 'ST11',
    title: string,
    check: (ctx: ItemContext, tag: string) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.stage.flow.${id}`, tier, CORE, cause, title, (ctx) =>
        check(ctx, `bg.stage.flow.${id}`),
      ),
    );
  const three = (ctx: ItemContext, tag: string) => {
    const { s, t } = names(ctx, tag, 3, 4);
    return { s, a: t[0] as string, b: t[1] as string, c: t[2] as string };
  };
  const stageVerdict = (block: BlockRecord | undefined) => flowOf(block).find((v) => v.id === 'flow.stage');
  const orderVerdict = (block: BlockRecord | undefined) => flowOf(block).find((v) => v.id === 'flow.order');
  add(
    'stage-pass-is-gating',
    3,
    'ST7',
    'a block that expects the stage its calls decided gets a gating flow.stage pass',
    async (ctx, tag) => {
      const { s, a, b } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [
          { expect: s[0] as string, tools: [a], calls: [a] },
          { expect: s[1] as string, tools: [b], calls: [b] },
        ],
      });
      const v = rec.blocks.map(stageVerdict);
      return v.every((x) => x?.outcome === 'pass' && x.gating) &&
        rec.blocks.every((x) => x.pass && !driftOf(x).includes(X3))
        ? PASS
        : fail(
            say(
              D,
              'a gating flow.stage pass on each block',
              show(v.map((x) => (x ? `${x.outcome}:${x.gating}` : 'none'))),
            ),
          );
    },
  );
  const wrongs: { id: string; expectIndex: number; callIndex: number }[] = [
    { id: 'expects-a-later-stage', expectIndex: 2, callIndex: 0 },
    { id: 'expects-an-earlier-stage', expectIndex: 0, callIndex: 2 },
    { id: 'expects-the-next-stage', expectIndex: 1, callIndex: 0 },
  ];
  for (const each of wrongs)
    add(
      `stage-fail.${each.id}`,
      4,
      'ST7',
      `a block that expects a stage other than the one its calls decided gets a gating flow.stage fail with X3 (${each.id})`,
      async (ctx, tag) => {
        const { s, a, b, c } = three(ctx, tag);
        const tools = [a, b, c];
        const rec = await runStage(ctx, tag, {
          stages: s,
          blocks: [
            {
              expect: s[each.callIndex] as string,
              tools: [tools[each.callIndex] as string],
              calls: [tools[each.callIndex] as string],
            },
            {
              expect: s[each.expectIndex] as string,
              tools: [tools[each.expectIndex] as string],
              calls: [tools[each.callIndex] as string],
            },
            ...(each.expectIndex === 1 || each.callIndex === 1
              ? []
              : [{ expect: s[1] as string, tools: [b] }]),
          ],
        });
        const block = rec.blocks[1];
        const v = stageVerdict(block);
        return v?.outcome === 'fail' &&
          v.gating &&
          driftOf(block).includes(X3) &&
          block?.pass === false &&
          JSON.stringify(v).includes(s[each.callIndex] as string)
          ? PASS
          : fail(
              say(
                D,
                `a gating flow.stage fail whose evidence names the stage reached (${s[each.callIndex]}), X3 and a failed block`,
                `${show(v)}; drift ${show(driftOf(block))}; pass ${block?.pass}`,
              ),
            );
      },
    );
  add(
    'stage-carried-is-inconclusive-and-non-gating',
    4,
    'ST7',
    'a block that expects a stage and only carries the stage before gets a non-gating inconclusive flow.stage',
    async (ctx, tag) => {
      const { s, a, b } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [
          { expect: s[0] as string, tools: [a], calls: [a] },
          { expect: s[1] as string },
          { expect: s[1] as string, tools: [b] },
        ],
      });
      const v = stageVerdict(rec.blocks[1]);
      return v?.outcome === 'inconclusive' &&
        !v.gating &&
        rec.blocks[1]?.pass === true &&
        !driftOf(rec.blocks[1]).includes(X3)
        ? PASS
        : fail(
            say(
              D,
              'a non-gating inconclusive flow.stage; the block passes and carries no X3',
              `${show(v)}; pass ${rec.blocks[1]?.pass}; drift ${show(driftOf(rec.blocks[1]))}`,
            ),
          );
    },
  );
  add(
    'stage-assumed-first-block-is-inconclusive',
    4,
    'ST7',
    'a first block that expects a stage and calls no tool gets a non-gating inconclusive flow.stage',
    async (ctx, tag) => {
      const { s, a, b } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [
          { expect: s[1] as string },
          { expect: s[0] as string, tools: [a], calls: [a] },
          { expect: s[2] as string, tools: [b] },
        ],
      });
      const v = stageVerdict(rec.blocks[0]);
      return v?.outcome === 'inconclusive' && !v.gating
        ? PASS
        : fail(say(D, 'a non-gating inconclusive flow.stage', show(v)));
    },
  );
  // flow.order
  add(
    'order-fails-when-the-flow-goes-back',
    4,
    'ST8',
    'a block that expects no stage and reaches an earlier stage than the stage before fails flow.order with X3',
    async (ctx, tag) => {
      const { s, a, b, c } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [
          { expect: s[2] as string, tools: [c], calls: [c] },
          { calls: [a] },
          { expect: s[0] as string, tools: [a] },
          { expect: s[1] as string, tools: [b] },
        ],
      });
      const v = orderVerdict(rec.blocks[1]);
      return v?.outcome === 'fail' &&
        v.gating &&
        driftOf(rec.blocks[1]).includes(X3) &&
        rec.blocks[1]?.pass === false
        ? PASS
        : fail(
            say(
              D,
              'a gating flow.order fail, X3, a failed block',
              `${show(v)}; drift ${show(driftOf(rec.blocks[1]))}`,
            ),
          );
    },
  );
  for (const [id, nextIndex] of [
    ['order-holds-on-the-same-stage', 2],
    ['order-holds-when-the-flow-moves-on', 1],
  ] as [string, number][])
    add(
      id,
      4,
      'ST8',
      `a block that expects no stage and reaches ${nextIndex === 2 ? 'the same' : 'a later'} stage does not fail flow.order`,
      async (ctx, tag) => {
        const { s, a, b, c } = three(ctx, tag);
        const tools = [a, b, c];
        const first = nextIndex === 2 ? 1 : 0;
        const rec = await runStage(ctx, tag, {
          stages: s,
          blocks: [
            { expect: s[first] as string, tools: [tools[first] as string], calls: [tools[first] as string] },
            { calls: [tools[nextIndex === 2 ? first : 1] as string] },
            ...defining(s, [[a], [b], [c]]).filter((x) => x.expect !== s[first]),
          ],
        });
        const v = orderVerdict(rec.blocks[1]);
        return v?.outcome !== 'fail' && !driftOf(rec.blocks[1]).includes(X3) && rec.blocks[1]?.pass === true
          ? PASS
          : fail(say(D, 'no flow.order failure', `${show(v)}; drift ${show(driftOf(rec.blocks[1]))}`));
      },
    );
  add(
    'order-is-not-asked-of-a-block-that-expects-a-stage',
    4,
    'ST8',
    'a block that expects a stage gets flow.stage and never flow.order',
    async (ctx, tag) => {
      const { s, a, c } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [
          { expect: s[2] as string, tools: [c], calls: [c] },
          { expect: s[0] as string, tools: [a], calls: [a] },
        ],
      });
      const ids = flowOf(rec.blocks[1]).map((v) => v.id);
      return ids.join() === 'flow.stage'
        ? PASS
        : fail(say(D, 'one flow.stage verdict and no flow.order', show(ids)));
    },
  );
  add(
    'order-needs-a-block-before',
    3,
    'ST8',
    'a first block that expects no stage cannot go back and passes flow.order',
    async (ctx, tag) => {
      const { s, a } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [{ calls: [a] }, ...defining(s, [[a], [], []]).slice(0, 1)],
      });
      return orderVerdict(rec.blocks[0])?.outcome !== 'fail' && rec.blocks[0]?.pass === true
        ? PASS
        : fail(say(D, 'no failure', show(orderVerdict(rec.blocks[0]))));
    },
  );
  // A runtime-reported stage.
  add(
    'reported-stage-is-the-last-of-the-block',
    3,
    'ST9',
    'the stage observed is the last stage the runtime reports in the block',
    async (ctx, tag) => {
      const { s, a } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [{ calls: [a], report: [s[0] as string, s[2] as string, s[1] as string] }],
      });
      return stageOf(rec.blocks[0]) === s[1]
        ? PASS
        : fail(say(D, 'the last reported stage (1)', show(stageOf(rec.blocks[0]))));
    },
  );
  add(
    'reported-stage-beats-the-classifier-in-later-blocks',
    4,
    'ST9',
    'in F a stage an earlier block reported still holds over the classifier in the blocks after it',
    async (ctx, tag) => {
      const { s, a, b } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [
          { calls: [a], report: [s[2] as string] },
          { calls: [b] },
          { calls: [] },
          ...defining(s, [[a], [b], []]),
        ],
      });
      const got = rec.blocks.slice(0, 3).map(stageOf);
      return got.every((x) => x === s[2])
        ? PASS
        : fail(
            say(
              D,
              'stage 2 in all three blocks',
              show(got.map((x) => (x === undefined ? null : s.indexOf(x)))),
            ),
          );
    },
  );
  add(
    'reported-stage-is-replaced-by-a-later-report',
    4,
    'ST9',
    'a later block that reports another stage replaces the stage an earlier block reported',
    async (ctx, tag) => {
      const { s, a, b } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [
          { calls: [a], report: [s[2] as string] },
          { calls: [b], report: [s[0] as string] },
          { calls: [b] },
          ...defining(s, [[a], [b], []]),
        ],
      });
      const got = rec.blocks.slice(0, 3).map(stageOf);
      return got.join() === [s[2], s[0], s[0]].join()
        ? PASS
        : fail(say(D, 'stages 2, 0, 0', show(got.map((x) => (x === undefined ? null : s.indexOf(x))))));
    },
  );
  const noFlow: {
    id: string;
    title: string;
    blocks: (s: string[], a: string, b: string) => B[];
    at: number;
  }[] = [
    {
      id: 'reported-in-a-block-that-expects-a-stage',
      title: 'a block that expects a stage and reports its own gets no flow verdict',
      blocks: (s, a) => [{ expect: s[0] as string, tools: [a], calls: [a], report: [s[0] as string] }],
      at: 0,
    },
    {
      id: 'reported-in-a-block-that-expects-none',
      title: 'a block that expects no stage and reports its own gets no flow verdict',
      blocks: (s, a, b) => [
        { expect: s[0] as string, tools: [a], calls: [a], report: [s[0] as string] },
        { calls: [b], report: [s[2] as string] },
      ],
      at: 1,
    },
    {
      id: 'carried-in-a-block-that-expects-a-stage',
      title:
        'a block that expects a stage and keeps the stage an earlier block reported gets no flow verdict',
      blocks: (s, a, b) => [
        { calls: [a], report: [s[0] as string] },
        { expect: s[1] as string, tools: [b], calls: [b] },
      ],
      at: 1,
    },
  ];
  for (const each of noFlow)
    add(`no-flow-verdict.${each.id}`, 4, 'ST11', each.title, async (ctx, tag) => {
      const { s, a, b } = three(ctx, tag);
      const rec = await runStage(ctx, tag, { stages: s, blocks: each.blocks(s, a, b) });
      const flows = flowOf(rec.blocks[each.at]);
      return flows.length === 0
        ? PASS
        : fail(
            say(
              D,
              'no flow verdict: the stage did not come from the classifier',
              show(flows.map((v) => `${v.id}:${v.outcome}:${v.evidence}`)),
            ),
          );
    });
  add(
    'no-flow-verdict.the-stage-check-judges-a-reported-stage',
    4,
    'ST11',
    'the stage check judges a reported stage: a block that expects another stage fails stage.reached with X3',
    async (ctx, tag) => {
      const { s, a, b } = three(ctx, tag);
      const rec = await runStage(ctx, tag, {
        stages: s,
        blocks: [{ expect: s[1] as string, tools: [b], calls: [a], report: [s[0] as string] }],
      });
      const v = rec.blocks[0]?.verdicts.find((x) => x.id.startsWith('stage.'));
      return v?.outcome === 'fail' &&
        driftOf(rec.blocks[0]).includes(X3) &&
        flowOf(rec.blocks[0]).length === 0
        ? PASS
        : fail(
            say(
              D,
              'a failing stage verdict, X3 and no flow verdict',
              `${show(v)}; flow ${show(flowOf(rec.blocks[0]))}`,
            ),
          );
    },
  );
  return out;
}

export function stageItems(): BankItem[] {
  return [
    ...jaccardItems(),
    ...randomItems(),
    ...tieItems(),
    ...carryItems(),
    ...flowItems(),
    ...modeTItems(),
  ];
}
