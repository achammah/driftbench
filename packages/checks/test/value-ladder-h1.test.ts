import { beforeAll, describe, expect, it } from 'vitest';
import { createToolsCheck } from '../src/checks/tools';
import type { SameReferentJudge } from '../src/value-check/judge';
import {
  BUILTIN_RUNGS,
  DEFAULT_VALUE_POLICY,
  type LadderResult,
  type Rung,
  runLadder,
} from '../src/value-check/ladder';
import { valueAt } from '../src/value-check/outcome';
import { acmeReplayer, type ReplayedCall } from './support/acme-replayer';
import {
  ACME_LIVE_TOOLS,
  BLOCKS,
  CLASS_RUNS,
  type ClassRun,
  exactExpect,
  failing,
  goldCall,
  HARNESS_RUNS,
  type Label,
  loadBlocks,
  readJsonl,
  recordedJudge,
  SLOTS,
  withField,
  worldOf,
} from './support/h1';

/**
 * The value-check ladder on the stored H1 runs of the phrasing experiment, with no model call: rung 1 replays
 * the real Acme tools, rung 3 replays the recorded read-first judge calls. These are the experiments of the
 * ladder kept as regression tests (build plan section 3): HF6 (rung 1 settles the format flips), HF5 (no false
 * pass and no false fail against the two labellers), and the H3 harness of PR 434 as the kind validator.
 */

beforeAll(loadBlocks);

/** The user turns the agent saw before and in the block: the spec's earlier turns, then the realisation. */
function userTexts(run: ClassRun): string[] {
  return [run.text];
}

/** The ladder on the slot field of every call of the slot tool, with the given rungs. */
async function slotResults(
  run: ClassRun,
  rungs: Readonly<Record<string, Rung>> = BUILTIN_RUNGS,
  judge?: SameReferentJudge,
) {
  const slot = SLOTS[run.block];
  if (!slot) throw new Error(`no slot for ${run.block}`);
  const results: LadderResult[] = [];
  for (const call of run.calls.filter((entry) => entry.label === slot.tool)) {
    const input = (call.input ?? {}) as Record<string, unknown>;
    results.push(
      await runLadder(
        {
          tool: slot.tool,
          field: slot.field,
          gold: slot.gold,
          value: valueAt(input, slot.field),
          input,
          definition: ACME_LIVE_TOOLS[slot.tool],
          sources: { user: userTexts(run) },
          ...(worldOf(run.block) === undefined ? {} : { world: worldOf(run.block) }),
        },
        DEFAULT_VALUE_POLICY,
        { replayer: acmeReplayer(), ...(judge === undefined ? {} : { judge }) },
        rungs,
      ),
    );
  }
  return results;
}

/** HF6: the flips (exact fail, normaliser pass) that rung 1 settles, by outcome and block. */
async function hf6(rungs: Readonly<Record<string, Rung>> = BUILTIN_RUNGS) {
  const flips = CLASS_RUNS.filter((run) => !run.exact && run.norm);
  const settled = { pass: [] as string[], fail: [] as string[] };
  for (const run of flips) {
    const results = await slotResults(run, rungs);
    if (results.length === 0) continue;
    if (!results.every((result) => result.rung === 'identity' || result.rung === 'rung1_outcome')) continue;
    if (!results.some((result) => result.rung === 'rung1_outcome')) continue;
    (results.some((result) => result.outcome === 'fail') ? settled.fail : settled.pass).push(run.id);
  }
  return { flips: flips.length, settled };
}

function byBlock(ids: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of ids) {
    const block = id.split('#')[0] as string;
    counts[block] = (counts[block] ?? 0) + 1;
  }
  return counts;
}

/** The reference set R: the runs both labellers give the same verdict, with that verdict. */
function reference(): Map<string, 'pass' | 'fail'> {
  const sol = new Map(readJsonl<Label>('labels-gpt-6.1-sol.jsonl').map((label) => [label.id, label.verdict]));
  const gemini = new Map(
    readJsonl<Label>('labels-gemini-3.6-flash.jsonl').map((label) => [label.id, label.verdict]),
  );
  const agreed = new Map<string, 'pass' | 'fail'>();
  for (const [id, verdict] of sol) if (gemini.get(id) === verdict) agreed.set(id, verdict);
  return agreed;
}

describe('HF6: rung 1 settles the format flips of the stored H1 runs', { timeout: 60_000 }, () => {
  it('settles 59 of the 116 flips: 49 pass, and the 10 B8 runs that send Ln fail', async () => {
    const { flips, settled } = await hf6();
    expect(flips).toBe(116);
    expect(byBlock(settled.pass)).toEqual({ B1: 3, B3: 5, B4: 16, B8: 8, B10: 17 });
    expect(byBlock(settled.fail)).toEqual({ B8: 10 });
    for (const id of settled.fail) {
      const run = CLASS_RUNS.find((entry) => entry.id === id) as ClassRun;
      const sent = run.calls.find((call) => call.label === 'coverage.check')?.input as { address: string };
      expect(sent.address).toMatch(/\bLn\b/);
    }
  });

  it('agrees with the reference labels on every settled run that has one', async () => {
    const agreed = reference();
    const { settled } = await hf6();
    const disagreements = [
      ...settled.pass.filter((id) => agreed.get(id) === 'fail'),
      ...settled.fail.filter((id) => agreed.get(id) === 'pass'),
    ];
    expect(disagreements).toEqual([]);
    expect(settled.pass.filter((id) => agreed.has(id))).toHaveLength(49);
  });

  it('replays the tool twice per settled value, the agent call and the gold call, never a forced result', async () => {
    const run = CLASS_RUNS.find((entry) => entry.block === 'B8' && !entry.exact && entry.norm) as ClassRun;
    const log: ReplayedCall[] = [];
    const slot = SLOTS.B8 as (typeof SLOTS)[string];
    const input = run.calls[0]?.input as Record<string, unknown>;
    await runLadder(
      { tool: slot.tool, field: slot.field, gold: slot.gold, value: input.address, input },
      DEFAULT_VALUE_POLICY,
      { replayer: acmeReplayer(log) },
    );
    expect(log.map((call) => call.input.address)).toEqual([input.address, slot.gold]);
  });

  it('planted mutant: a rung 1 that passes without replaying turns the 10 Ln fails into passes, and HF6 sees it', async () => {
    const mutant: Rung = (value, ctx) =>
      ctx.services.replayer?.declaration(value.tool ?? '') === undefined
        ? { skip: 'mutant' }
        : { settles: 'pass', evidence: 'mutant: no replay' };
    const { settled } = await hf6({ ...BUILTIN_RUNGS, 'builtin:value-check/outcome': mutant });
    expect(byBlock(settled.fail)).toEqual({});
    expect(byBlock(settled.pass)).not.toEqual({ B1: 3, B3: 5, B4: 16, B8: 8, B10: 17 });
  });
});

describe('HF5: the ladder against the two labellers on all 259 stored runs', { timeout: 60_000 }, () => {
  const ladder = () => createToolsCheck({ services: { replayer: acmeReplayer(), judge: recordedJudge() } });

  it('settles the 255 slot values as HF5 did: 57 identical, rung 1 113 pass and 28 fail, the 57 stored phones pass at rung 3', async () => {
    const counts: Record<string, number> = {};
    const phones: string[] = [];
    for (const run of CLASS_RUNS) {
      for (const result of await slotResults(run, BUILTIN_RUNGS, recordedJudge())) {
        const key = `${result.rung} ${result.outcome}${result.lint === undefined ? '' : ` ${result.lint.id}`}`;
        counts[key] = (counts[key] ?? 0) + 1;
        if (result.rung === 'rung3_same_referent' && result.outcome === 'pass') phones.push(run.id);
      }
    }
    // As in the research ladder: a copied phone proves nothing alone, so the recorded judge decides every one.
    expect(counts).toEqual({
      'identity pass': 57,
      'rung1_outcome pass': 113,
      'rung1_outcome fail': 28,
      'rung3_same_referent pass unstated_format': 57,
    });
    expect(phones.sort()).toEqual(PHONES_AT_RUNG_3);
  });

  it('passes 183 runs, with 0 false passes and 0 false fails on the 249 runs the labellers agree on', async () => {
    const agreed = reference();
    expect(agreed.size).toBe(249);
    const check = ladder();
    const passes: string[] = [];
    const falsePasses: string[] = [];
    const falseFails: string[] = [];
    for (const run of CLASS_RUNS) {
      const failed = await failing(check, run.block, run.calls, run.text);
      const pass = failed.length === 0;
      if (pass) passes.push(run.id);
      const truth = agreed.get(run.id);
      if (truth === 'fail' && pass) falsePasses.push(run.id);
      if (truth === 'pass' && !pass) falseFails.push(`${run.id}: ${failed.join(', ')}`);
    }
    expect({ passes: passes.length, falsePasses, falseFails }).toEqual({
      passes: 183,
      falsePasses: [],
      falseFails: [],
    });
  });

  it('with every value compared exactly, reproduces the stored exact oracle run by run', async () => {
    const check = ladder();
    const mismatches: string[] = [];
    for (const run of CLASS_RUNS) {
      const failed = await failing(check, run.block, run.calls, run.text, { expect: exactExpect(run.block) });
      const tools = failed.filter((id) => id.startsWith('tools.')).sort();
      const stored = run.exactFailed.filter((id) => id.startsWith('tools.')).sort();
      if ((failed.length === 0) !== run.exact || JSON.stringify(tools) !== JSON.stringify(stored)) {
        mismatches.push(`${run.id}: ${tools.join(', ')} against ${stored.join(', ')}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('the H3 harness of PR 434 as the kind validator', { timeout: 60_000 }, () => {
  const ladder = () => createToolsCheck({ services: { replayer: acmeReplayer(), judge: recordedJudge() } });

  it('turns no real H1 failure into a pass: every run H3 found failing still fails, seed and class', async () => {
    const check = ladder();
    const text = new Map(CLASS_RUNS.map((run) => [run.id, run.text]));
    const real = HARNESS_RUNS.filter((run) => !run.research.exact && !run.research.normalised);
    expect(real).toHaveLength(66 + 62);
    const turned: string[] = [];
    for (const run of real) {
      const failed = await failing(
        check,
        run.block,
        run.calls,
        run.set === 'class' ? text.get(run.id) : undefined,
      );
      if (failed.length === 0) turned.push(run.id);
    }
    expect(turned).toEqual([]);
  });

  it('never passes a minimal pair, and fails every one the tool can be asked about', async () => {
    const check = createToolsCheck({ services: { replayer: acmeReplayer() } });
    const outcomes: string[] = [];
    for (const def of BLOCKS) {
      const id = (field: string) => `tools.${def.tool}.input.${field.split('.')[0]}`;
      for (const { field, value } of def.minimal) {
        const seen = await failing(check, def.id, [withField(goldCall(def), field, value)]);
        expect({ block: def.id, value, failed: seen.includes(id(field)) }).toEqual({
          block: def.id,
          value,
          failed: true,
        });
        outcomes.push(def.id);
      }
    }
    expect(outcomes).toHaveLength(10);
  });
});

/** The B2 and B7 runs whose stored phone differs from the gold: the recorded judge passes each one at rung 3. */
const PHONES_AT_RUNG_3 = [
  'B2#0#0',
  'B2#1#0',
  'B2#10#0',
  'B2#12#0',
  'B2#14#0',
  'B2#15#0',
  'B2#16#0',
  'B2#17#0',
  'B2#18#0',
  'B2#19#0',
  'B2#20#0',
  'B2#21#0',
  'B2#22#0',
  'B2#23#0',
  'B2#24#0',
  'B2#25#0',
  'B2#26#0',
  'B2#27#0',
  'B2#28#0',
  'B2#29#0',
  'B2#3#0',
  'B2#4#0',
  'B2#5#0',
  'B2#6#0',
  'B2#7#0',
  'B2#8#0',
  'B2#9#0',
  'B7#0#0',
  'B7#1#0',
  'B7#10#0',
  'B7#11#0',
  'B7#12#0',
  'B7#13#0',
  'B7#14#0',
  'B7#15#0',
  'B7#16#0',
  'B7#17#0',
  'B7#18#0',
  'B7#19#0',
  'B7#2#0',
  'B7#20#0',
  'B7#21#0',
  'B7#22#0',
  'B7#23#0',
  'B7#24#0',
  'B7#25#0',
  'B7#26#0',
  'B7#27#0',
  'B7#28#0',
  'B7#29#0',
  'B7#3#0',
  'B7#4#0',
  'B7#5#0',
  'B7#6#0',
  'B7#7#0',
  'B7#8#0',
  'B7#9#0',
];
