import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type Assertion,
  type Check,
  type Expect,
  enterBlock,
  initialGiven,
  loadSpecFile,
  resolveGiven,
  type Spec,
  type ToolExpect,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { forbidden } from '../../src/checks/forbidden';
import {
  type RecordedJudgeCall,
  recordedJudgeModel,
  type SameReferentJudge,
} from '../../src/value-check/judge';
import { type Call, context, observed, run } from './context';

/**
 * The stored H1 runs of the phrasing experiment and the ten blocks they ran on, as the value-ladder tests read
 * them. Every file under `fixtures/value-ladder/` is a byte copy of its source (SOURCES.md), except
 * `acme-live-tools.json`, the tool definitions the live Acme agent saw, read from the research port of the tools.
 */

const HERE = new URL('../fixtures/value-ladder/', import.meta.url);
const ROOT = new URL('../../../../', import.meta.url);

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(name, HERE));
}

export function readJsonl<T>(name: string): T[] {
  return readFileSync(new URL(name, HERE), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

export function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, HERE), 'utf8')) as T;
}

/** One block of the H3 fixture (PR 434): its spec, its tool, the gold it compares and its minimal pairs. */
export type BlockDef = {
  id: string;
  spec: string;
  index: number;
  tool: string;
  input?: Record<string, Assertion>;
  forms: { field: string; form: string }[];
  minimal: { field: string; value: string }[];
};

/** One stored class run (research/block-framework-value, inputs/runs-class.jsonl). */
export type ClassRun = {
  id: string;
  block: string;
  text: string;
  calls: Call[];
  exact: boolean;
  exactFailed: string[];
  norm: boolean;
};

/** One stored run of the H3 harness (PR 434), class or seed. */
export type HarnessRun = {
  id: string;
  set: 'seed' | 'class';
  block: string;
  calls: Call[];
  research: { exact: boolean; normalised: boolean };
};

/** One reference label (data/labels-*.jsonl). */
export type Label = { id: string; label: string; verdict: 'pass' | 'fail' };

export const BLOCKS: BlockDef[] = readJson<{ blocks: BlockDef[] }>('h3/blocks.json').blocks;
export const CLASS_RUNS: ClassRun[] = readJsonl<ClassRun>('runs-class.jsonl');
export const HARNESS_RUNS: HarnessRun[] = readJsonl<HarnessRun>('h3/h1-runs.jsonl');

/**
 * The slot field of each block: where the user's value lands in the tool input, and its gold value. The table
 * of the research oracle (`src/oracle.py` SLOTS), as a dotted path.
 */
export const SLOTS: Record<string, { tool: string; field: string; gold: string }> = {
  B1: { tool: 'coverage.check', field: 'address', gold: '88 Summit Avenue, Acmeville' },
  B2: { tool: 'notify_sales', field: 'customer.phone', gold: '+12025550131' },
  B3: { tool: 'port.check', field: 'number', gold: '+12025550150' },
  B4: { tool: 'catalog.search', field: 'customer_email', gold: 'sam.rivera@example.com' },
  B5: { tool: 'coverage.check', field: 'address', gold: '14 Harbor Road, Acmeville' },
  B6: { tool: 'coverage.check', field: 'address', gold: '3 Orchard Way, Acmeville' },
  B7: { tool: 'notify_sales', field: 'customer.phone', gold: '+12025550188' },
  B8: { tool: 'coverage.check', field: 'address', gold: '7 Quarry Lane, Acmeville' },
  B9: { tool: 'port.check', field: 'number', gold: '+12025550160' },
  B10: { tool: 'catalog.search', field: 'customer_email', gold: 'morgan.diaz@example.com' },
};

/** The tool definitions the live Acme agent saw: what the contract rung and the judge read. */
export const ACME_LIVE_TOOLS: Record<string, unknown> = readJson('acme-live-tools.json');

/** The recorded judge calls of HF5 and HF7, both models, every design. */
export const JUDGE_CALLS: RecordedJudgeCall[] = readJsonl<RecordedJudgeCall>('judge_cache.jsonl');

/**
 * The read-first judge on gpt-6-luna replaying its recorded calls, with its HF7 calibration: 1 false
 * acceptance in 432 near misses, Scott's pi 0.992 against the truth, the labellers' pi 0.903.
 */
export function recordedJudge(model = 'gpt-6-luna'): SameReferentJudge {
  return {
    model,
    complete: recordedJudgeModel(JUDGE_CALLS),
    calibration: {
      falseAcceptance: model === 'gpt-6-luna' ? 1 / 432 : 0,
      kappa: model === 'gpt-6-luna' ? 0.992 : 1,
      labellersKappa: 0.903,
      source: 'HF7, research/block-framework-value RESULTS.md',
    },
  };
}

type Loaded = { spec: Spec; expect: Expect; authored: Expect };
const loaded = new Map<string, Loaded>();

/** The block's spec with the live tool definitions, and its Then with the fixture's gold input. */
export async function loadBlocks(): Promise<void> {
  for (const def of BLOCKS) {
    const result = await loadSpecFile(fileURLToPath(new URL(def.spec, ROOT)));
    if (!result.ok) throw new Error(`${def.spec}: ${JSON.stringify(result.errors)}`);
    const authored = result.spec.blocks[def.index]?.expect;
    if (!authored) throw new Error(`${def.id}: no block ${def.index} in ${def.spec}`);
    const expect: Expect = {
      ...authored,
      tools: authored.tools?.map((tool): ToolExpect => {
        const { normalise: _rule, ...rest } = tool as ToolExpect & { normalise?: unknown };
        return tool.label === def.tool ? { ...rest, input: { ...rest.input, ...(def.input ?? {}) } } : rest;
      }),
    };
    // The experiment's exact oracle took the forbidden share as the tools expected 0 times in the block, not the
    // spec-wide rules, so the spec is read without its rules.
    const spec: Spec = {
      ...result.spec,
      rules: undefined,
      metadata: { ...result.spec.metadata, tool_schemas: ACME_LIVE_TOOLS },
    };
    loaded.set(def.id, { spec, expect, authored });
  }
}

export function blockDef(id: string): BlockDef {
  const def = BLOCKS.find((entry) => entry.id === id);
  if (!def) throw new Error(`no block ${id}`);
  return def;
}

function loadedBlock(id: string): Loaded {
  const block = loaded.get(id);
  if (!block) throw new Error(`block ${id} is not loaded: call loadBlocks first`);
  return block;
}

/** The block's seeded store, as the runner resolves it at that block. */
export function worldOf(id: string): Record<string, unknown> | undefined {
  const def = blockDef(id);
  const { spec } = loadedBlock(id);
  let state = initialGiven(spec);
  for (const block of spec.blocks.slice(0, def.index + 1)) state = enterBlock(state, block.given);
  return state.world.store;
}

/**
 * The gating verdicts that fail, from the tools check given and the forbidden check, on one stored run. `text`
 * is what the user wrote in the block (the realisation); absent means the spec's own turn.
 */
export async function failing(
  tools: Check,
  blockId: string,
  calls: Call[],
  text?: string,
  overrides: { expect?: Expect } = {},
): Promise<string[]> {
  return (await verdicts(tools, blockId, calls, text, overrides))
    .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
    .map((verdict) => verdict.id);
}

export async function verdicts(
  tools: Check,
  blockId: string,
  calls: Call[],
  text?: string,
  overrides: { expect?: Expect } = {},
): Promise<Verdict[]> {
  const def = blockDef(blockId);
  const { spec, expect } = loadedBlock(blockId);
  let state = initialGiven(spec);
  for (const block of spec.blocks.slice(0, def.index + 1)) state = enterBlock(state, block.given);
  const given = resolveGiven(state, [], spec.target ?? { adapter: 'function' });
  const ctx = context(spec, def.index, observed('', calls), {
    expect: overrides.expect ?? expect,
    given,
    ...(text === undefined ? {} : { stimulus: { user: text } }),
  });
  return [...(await run(tools, ctx)), ...(await run(forbidden, ctx))];
}

/**
 * The block's Then as the spec writes it (the exact oracle of the experiment: B1, B5 and B6 assert a pattern
 * there), with every expected tool's values compared exactly, for a reason.
 */
export function exactExpect(blockId: string): Expect {
  const { authored } = loadedBlock(blockId);
  return {
    ...authored,
    tools: authored.tools?.map((tool) => ({
      ...tool,
      compare: { exact: 'parity with the stored exact oracle' },
    })),
  };
}

/** A stored call of the block's tool with one field set; the minimal-pair and form tests start from it. */
export function goldCall(def: BlockDef): Call {
  for (const stored of HARNESS_RUNS) {
    if (stored.block !== def.id) continue;
    const call = stored.calls.find((entry) => entry.label === def.tool);
    if (call) return structuredClone(call);
  }
  throw new Error(`${def.id}: no stored call of ${def.tool}`);
}

export function withField(call: Call, field: string, value: string): Call {
  const copy = structuredClone(call) as Call & { input: Record<string, unknown> };
  const path = field.split('.');
  let at = copy.input;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[path.at(-1) as string] = value;
  return copy;
}
