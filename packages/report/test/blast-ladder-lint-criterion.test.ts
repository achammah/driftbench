import { createToolsCheck, type SameReferentJudge, tools } from '@agent-nexus/driftbench-checks';
import { type CheckContext, type RunResult, type Verdict, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { compareCampaigns } from '../src/compare';
import { dataOf, run } from './support';

/**
 * Blast radius of the value-check ladder (PR 459) on `compare` (and so `driftbench compare` and `ci`). The tools
 * check now adds non-gating lint verdicts, `tools.<label>.input.<field>.no_decider` and `.unstated_format`, that
 * flag the TEST, never the agent. A criterion is a machine verdict family, so a lint must not turn the `tools`
 * criterion of a unit to fail while every gating tools verdict of that unit passes. Fictional data only.
 */

const GOLD = '+12025550131';
const OTHER_WRITING = '+1 202 555 0131';

const loaded = validateSpec({
  id: 'blast-ladder-lint',
  target: { adapter: 'function', agent: 'acme-sales' },
  blocks: [
    {
      user: 'Please have sales call me back on the number you have.',
      expect: { tools: [{ label: 'notify_sales', input: { customer: { subset: { phone: GOLD } } } }] },
    },
  ],
});
if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
const spec = loaded.spec;

/** A calibrated stub judge that reads a phone as its digits: two writings of one number are the same. */
const digits: SameReferentJudge = {
  model: 'digits-reader',
  calibration: { falseAcceptance: 0, source: 'a test stub' },
  complete: async (request) =>
    request.kind === 'read'
      ? { has_content: true, reading: String(request.parts.v).replace(/\D/g, '').replace(/^1/, '') }
      : { same: request.parts.a === request.parts.b },
};

function contextOf(phone: string): CheckContext {
  const block = spec.blocks[0];
  if (!block) throw new Error('no block');
  return {
    spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect: block.expect ?? {},
    given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'function' }, hash: 'g' },
    observed: {
      segments: [],
      text: 'Done.',
      toolCalls: [{ id: 'c1', label: 'notify_sales', input: { customer: { phone } } }],
      cost: { usd: 0 },
      latencyMs: 0,
    },
    history: [],
    ledger: {},
  };
}

async function verdictsOf(check: typeof tools, phone: string): Promise<Verdict[]> {
  const ctx = contextOf(phone);
  return check.applies(ctx) ? await check.evaluate(ctx) : [];
}

/** n goldens with the given tools verdicts on their one block; the block passes when every gating verdict does. */
function campaign(id: string, n: number, verdicts: Verdict[]) {
  const pass = verdicts.every((entry) => !entry.gating || entry.outcome === 'pass');
  const runs: RunResult[] = [];
  for (let i = 0; i < n; i += 1) {
    runs.push(
      run({
        specId: `g${String(i).padStart(2, '0')}`,
        blocks: [{ pass, drift: pass ? [] : ['X5_tool'], verdicts: structuredClone(verdicts) }],
      }),
    );
  }
  return dataOf(runs, {}, id);
}

describe('compare and the tools lint verdicts (PR 459)', () => {
  it('control: the check output is what the test claims: a judged pass with a non-gating unstated_format lint', async () => {
    const judged = await verdictsOf(createToolsCheck({ services: { judge: digits } }), OTHER_WRITING);
    expect(judged.filter((entry) => entry.gating).every((entry) => entry.outcome === 'pass')).toBe(true);
    expect(judged.find((entry) => entry.id.endsWith('.unstated_format'))).toMatchObject({
      outcome: 'fail',
      gating: false,
    });
  });

  it('a value the CLI compares exactly fails the tools criterion once, with its no_decider lint beside it', async () => {
    const exact = await verdictsOf(tools, GOLD);
    const fallback = await verdictsOf(tools, OTHER_WRITING);
    expect(fallback.map((entry) => entry.id)).toContain('tools.notify_sales.input.customer.no_decider');
    const result = compareCampaigns(campaign('b', 60, exact), campaign('c', 60, fallback), { margin: 0.1 });
    const row = result.criteria.find((entry) => entry.criterion === 'tools');
    expect(row).toMatchObject({ regressed: 60, improved: 0 });
    expect(result.allPass.table.regressed).toBe(60);
    expect(result.verdict).toBe('regressed');
  });

  it('a judged pass with an unstated_format lint leaves the tools criterion and the verdict unchanged', async () => {
    const judge = createToolsCheck({ services: { judge: digits } });
    const baseline = await verdictsOf(judge, GOLD);
    const candidate = await verdictsOf(judge, OTHER_WRITING);
    const result = compareCampaigns(campaign('b', 60, baseline), campaign('c', 60, candidate), {
      margin: 0.1,
    });
    expect(result.allPass.table).toEqual({ bothPass: 60, regressed: 0, improved: 0, bothFail: 0 });
    const row = result.criteria.find((entry) => entry.criterion === 'tools');
    expect(row).toMatchObject({ regressed: 0, improved: 0, nonInferior: true });
    expect(result.verdict).toBe('non-inferior');
  });
});
