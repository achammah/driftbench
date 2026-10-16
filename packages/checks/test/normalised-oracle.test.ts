import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Expect, loadSpecFile, type Spec, type ToolExpect } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createStore } from '../../../examples/acme/src/index';
import { callTool } from '../../../examples/acme/src/tools';
import { forbidden } from '../src/checks/forbidden';
import { tools } from '../src/checks/tools';
import { type Call, context, observed, run } from './support/context';

/**
 * The H3 re-score of the phrasing experiment (research/block-phrasing, PR 415), reproduced on the
 * product checks from the stored tool calls of its H1 runs. The exact oracle is today's Then on tool
 * calls: the `tools` check and the `forbidden` check. The normalised oracle is the same Then with the
 * normalise rules of `fixtures/normalised-oracle/blocks.json`. H3 found 116 of 182 class failures and
 * 60 of 122 seed failures to be formatting, every one a writing of the gold value, and no real failure
 * turned into a pass.
 */

type Fixture = {
  blocks: {
    id: string;
    spec: string;
    index: number;
    tool: string;
    input?: Record<string, unknown>;
    normalise: NonNullable<ToolExpect['normalise']>;
    forms: { field: string; form: string }[];
    minimal: { field: string; value: string }[];
  }[];
};
type StoredRun = {
  id: string;
  set: 'seed' | 'class';
  block: string;
  calls: Call[];
  research: { exact: boolean; normalised: boolean };
};

const ROOT = new URL('../../../', import.meta.url);
const HERE = new URL('./fixtures/normalised-oracle/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('blocks.json', HERE), 'utf8')) as Fixture;
const runs = readFileSync(new URL('h1-runs.jsonl', HERE), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as StoredRun);

type Loaded = { spec: Spec; exact: Expect; normalised: Expect; townless: Expect };
const blocks = new Map<string, Loaded>();

/** The block's Then with no rule, with the fixture's rules, and with the rules but every surface form unapproved. */
function variants(spec: Spec, def: Fixture['blocks'][number]): Loaded {
  const authored = spec.blocks[def.index]?.expect;
  if (!authored) throw new Error(`${def.id}: no block ${def.index} in ${def.spec}`);
  const stripped = (tool: ToolExpect): ToolExpect => {
    const { normalise: _rule, ...rest } = tool;
    return rest;
  };
  const exact: Expect = { ...authored, tools: authored.tools?.map(stripped) };
  const ruled = (approved: boolean): Expect => ({
    ...authored,
    tools: authored.tools?.map((tool) => {
      if (tool.label !== def.tool) return stripped(tool);
      const normalise = structuredClone(def.normalise);
      for (const rule of Object.values(normalise)) {
        if (typeof rule === 'object') for (const form of rule.surface_forms ?? []) form.approved = approved;
      }
      return { ...stripped(tool), input: { ...tool.input, ...(def.input ?? {}) }, normalise } as ToolExpect;
    }),
  });
  return { spec, exact, normalised: ruled(true), townless: ruled(false) };
}

beforeAll(async () => {
  for (const def of fixture.blocks) {
    const loaded = await loadSpecFile(fileURLToPath(new URL(def.spec, ROOT)));
    if (!loaded.ok) throw new Error(`${def.spec}: ${JSON.stringify(loaded.errors)}`);
    blocks.set(def.id, variants(loaded.spec, def));
  }
});

/** The gating verdicts of the Then on tool calls that fail. */
async function failed(def: Fixture['blocks'][number], expectation: Expect, calls: Call[]): Promise<string[]> {
  const block = blocks.get(def.id);
  if (!block) throw new Error(`no block ${def.id}`);
  // The experiment's exact oracle took the forbidden check's share as the tools expected 0 times in the
  // block, not the spec-wide rules, so the spec is read here without its rules.
  const spec = { ...block.spec, rules: undefined };
  const ctx = context(spec, def.index, observed('', calls), { expect: expectation });
  const verdicts = [...(await run(tools, ctx)), ...(await run(forbidden, ctx))];
  return verdicts.filter((v) => v.gating && v.outcome !== 'pass').map((v) => v.id);
}

function defOf(id: string): Fixture['blocks'][number] {
  const def = fixture.blocks.find((entry) => entry.id === id);
  if (!def) throw new Error(`no block ${id}`);
  return def;
}

type Scored = { run: StoredRun; exact: string[]; normalised: string[]; townless: string[] };
async function rescore(): Promise<Scored[]> {
  const out: Scored[] = [];
  for (const stored of runs) {
    const def = defOf(stored.block);
    const block = blocks.get(def.id) as Loaded;
    out.push({
      run: stored,
      exact: await failed(def, block.exact, stored.calls),
      normalised: await failed(def, block.normalised, stored.calls),
      townless: await failed(def, block.townless, stored.calls),
    });
  }
  return out;
}

describe('the normalised-slot oracle on the stored H1 runs', () => {
  it('reproduces the exact oracle of the experiment run by run', async () => {
    for (const scored of await rescore()) {
      expect({ id: scored.run.id, pass: scored.exact.length === 0 }).toEqual({
        id: scored.run.id,
        pass: scored.run.research.exact,
      });
    }
  });

  it('turns 116 of 182 class failures and 60 of 122 seed failures into passes, the runs H3 found', async () => {
    const scored = await rescore();
    for (const set of ['class', 'seed'] as const) {
      const mine = scored.filter((entry) => entry.run.set === set);
      const failures = mine.filter((entry) => entry.exact.length > 0);
      const flips = failures.filter((entry) => entry.normalised.length === 0);
      expect({ set, failures: failures.length, flips: flips.length }).toEqual(
        set === 'class' ? { set, failures: 182, flips: 116 } : { set, failures: 122, flips: 60 },
      );
      const research = mine.filter((entry) => !entry.run.research.exact && entry.run.research.normalised);
      expect(flips.map((entry) => entry.run.id).sort()).toEqual(research.map((entry) => entry.run.id).sort());
    }
  });

  it('keeps every real failure: a run that fails off the slot fields still fails, on the same verdicts', async () => {
    let kept = 0;
    for (const scored of await rescore()) {
      if (scored.exact.length === 0) {
        expect(scored.normalised).toEqual([]);
        continue;
      }
      if (scored.normalised.length === 0) continue;
      kept += 1;
      // A rule only ever removes a failing verdict; the ones left are failures off the slot fields.
      for (const id of scored.normalised) expect(scored.exact).toContain(id);
    }
    expect(kept).toBe(66 + 62);
  });

  it('flips 105 of 182 class failures when the town-less surface forms are not approved', async () => {
    const scored = (await rescore()).filter((entry) => entry.run.set === 'class' && entry.exact.length > 0);
    expect(scored.filter((entry) => entry.townless.length === 0)).toHaveLength(105);
  });

  it('approves a town-less address only where the Acme coverage tool resolves it to the gold address', () => {
    for (const def of fixture.blocks) {
      for (const rule of Object.values(def.normalise)) {
        if (typeof rule !== 'object') continue;
        for (const form of rule.surface_forms ?? []) {
          const gold = (def.input?.address ?? goldAddress(def)) as string;
          const resolved = coverage(form.form);
          expect({ block: def.id, form: form.form, address: resolved }).toEqual({
            block: def.id,
            form: form.form,
            address: gold,
          });
        }
      }
    }
    // The control: an abbreviated street the tool cannot resolve is not a candidate surface form.
    expect(coverage('88 Summit Ave')).toBeUndefined();
  });
});

describe('the surface forms and minimal pairs of the ten blocks', () => {
  it('passes every listed form of a gold value and fails every minimal-pair value, field by field', async () => {
    let forms = 0;
    let pairs = 0;
    for (const def of fixture.blocks) {
      const block = blocks.get(def.id) as Loaded;
      const base = goldCall(def);
      const id = (field: string) => `tools.${def.tool}.input.${field.split('.')[0]}`;
      for (const { field, form } of def.forms) {
        const seen = await failed(def, block.normalised, [withField(base, field, form)]);
        expect({ block: def.id, form, failed: seen.includes(id(field)) }).toEqual({
          block: def.id,
          form,
          failed: false,
        });
        forms += 1;
      }
      for (const { field, value } of def.minimal) {
        const seen = await failed(def, block.normalised, [withField(base, field, value)]);
        expect({ block: def.id, value, failed: seen.includes(id(field)) }).toEqual({
          block: def.id,
          value,
          failed: true,
        });
        pairs += 1;
      }
    }
    expect({ forms, pairs }).toEqual({ forms: 40, pairs: 10 });
  });
});

/** The address the Acme coverage tool resolves a text to, or undefined when it finds none. */
function coverage(address: string): string | undefined {
  const outcome = callTool('coverage.check', { address }, { store: createStore(), commit: false });
  if (!outcome.ok) return undefined;
  const output = outcome.output as { found?: boolean; address?: string };
  return output.found === false ? undefined : output.address;
}

function goldAddress(def: Fixture['blocks'][number]): unknown {
  const tool = blocks.get(def.id)?.exact.tools?.find((entry) => entry.label === def.tool);
  return tool?.input?.address;
}

/** A stored call of the block's tool; the test sets the one field it reads. */
function goldCall(def: Fixture['blocks'][number]): Call {
  for (const stored of runs) {
    if (stored.block !== def.id) continue;
    const call = stored.calls.find((entry) => entry.label === def.tool);
    if (call) return structuredClone(call);
  }
  throw new Error(`${def.id}: no stored call of ${def.tool}`);
}

function withField(call: Call, field: string, value: string): Call {
  const copy = structuredClone(call) as Call & { input: Record<string, unknown> };
  const path = field.split('.');
  let at = copy.input;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[path.at(-1) as string] = value;
  return copy;
}
