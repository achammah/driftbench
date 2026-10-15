import { tools } from '@agent-nexus/driftbench-checks';
import {
  type BlockResult,
  type CheckContext,
  type Verdict,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blockFailure } from '../src/index';

/**
 * Blast radius of the value-check ladder (PR 459) on the vitest plugin. With `defaultChecks()`, the plugin's
 * default, a tool input value that differs falls back to the exact compare: the gating input verdict fails with
 * the `exact_fallback` evidence, and a non-gating `no_decider` lint sits beside it. A failing block's message
 * names the gating verdict with that evidence and never the lint, which flags the test. Fictional data only.
 */

const loaded = validateSpec({
  id: 'blast-ladder-vitest',
  target: { adapter: 'function', agent: 'acme-sales' },
  blocks: [
    {
      user: 'Do you cover my street?',
      expect: { tools: [{ label: 'coverage.check', input: { address: '88 Summit Avenue, Acmeville' } }] },
    },
  ],
});
if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
const spec = loaded.spec;

async function blockWith(address: string): Promise<BlockResult> {
  const block = spec.blocks[0];
  if (!block) throw new Error('no block');
  const ctx: CheckContext = {
    spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect: block.expect ?? {},
    given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'function' }, hash: 'g' },
    observed: {
      segments: [],
      text: 'Checking.',
      toolCalls: [{ id: 'c1', label: 'coverage.check', input: { address } }],
      cost: { usd: 0 },
      latencyMs: 0,
    },
    history: [],
    ledger: {},
  };
  const verdicts: Verdict[] = tools.applies(ctx) ? await tools.evaluate(ctx) : [];
  return {
    index: 0,
    givenHash: 'g',
    observed: ctx.observed,
    verdicts,
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: verdicts.every((entry) => !entry.gating || entry.outcome === 'pass'),
  };
}

describe('the vitest plugin and the value-check ladder (PR 459)', () => {
  it('a differing address fails the block on its gating input verdict, with the exact_fallback evidence', async () => {
    const block = await blockWith('88 Summit Av, Acmeville');
    expect(block.pass).toBe(false);
    expect(block.verdicts.map((entry) => entry.id)).toContain(
      'tools.coverage.check.input.address.no_decider',
    );
    const message = blockFailure(block);
    expect(message).toContain('block 0 failed');
    expect(message).toContain('tools.coverage.check.input.address fail');
    expect(message).toContain('exact_fallback: no decider configured for coverage.check.address');
  });

  it('names no lint: the non-gating no_decider and argument_accuracy verdicts stay out of the message', async () => {
    const message = blockFailure(await blockWith('88 Summit Av, Acmeville'));
    expect(message).not.toContain('.no_decider');
    expect(message).not.toContain('argument_accuracy');
    expect(message.split('\n')).toHaveLength(2);
  });

  it('an equal address passes the block with no lint at all', async () => {
    const block = await blockWith('88 Summit Avenue, Acmeville');
    expect(block.pass).toBe(true);
    expect(block.verdicts.some((entry) => entry.id.endsWith('.no_decider'))).toBe(false);
  });
});
