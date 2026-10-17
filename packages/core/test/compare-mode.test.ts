import { fileURLToPath } from 'node:url';
import {
  contentHash,
  type LoadedSpec,
  loadSpecs,
  type Spec,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

/**
 * `ToolExpect.compare` is additive: it has no default, so a spec that does not write it parses to the same
 * object, and so to the same spec hash and the same block cache keys (HF1: a default value on a new key changed
 * every hash). Fictional data only.
 */

const EXAMPLES = fileURLToPath(new URL('../../../examples', import.meta.url));

function spec(tool: Record<string, unknown>): Spec {
  const loaded = validateSpec({
    id: 'compare',
    target: { adapter: 'function', agent: 'acme-sales' },
    blocks: [{ user: '88 Summit Avenue, Acmeville', expect: { tools: [tool] } }],
  });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

describe('ToolExpect.compare', () => {
  it('is never added by the loader: no example spec gains the key, so no example hash moves', async () => {
    const loaded = (await loadSpecs([EXAMPLES])).filter((result): result is LoadedSpec => result.ok);
    expect(loaded.length).toBeGreaterThan(100);
    const written = loaded.filter((result) => JSON.stringify(result.spec).includes('"compare"'));
    expect(written.map((result) => result.path)).toEqual([]);
  }, 120_000);

  it('changes the spec hash only where a spec writes it', () => {
    const base = { label: 'coverage.check', input: { address: '88 Summit Avenue, Acmeville' } };
    const plain = spec(base);
    expect(plain.blocks[0]?.expect?.tools?.[0]).not.toHaveProperty('compare');
    expect(contentHash(spec({ ...base, compare: 'auto' }))).not.toBe(contentHash(plain));
  });

  it('takes one mode, a mode by argument name, or exact with a one-line reason, and refuses the rest', () => {
    const base = { label: 'notify_sales', input: { customer: { subset: { phone: '+12025550131' } } } };
    for (const compare of [
      'outcome',
      'same_referent',
      { exact: 'the dialer reads E.164' },
      { customer: 'as_given' },
    ]) {
      expect(
        validateSpec({ id: 'c', blocks: [{ user: 'x', expect: { tools: [{ ...base, compare }] } }] }).ok,
      ).toBe(true);
    }
    for (const compare of ['normalise', { exact: '' }, { customer: 'phone_e164' }]) {
      expect(
        validateSpec({ id: 'c', blocks: [{ user: 'x', expect: { tools: [{ ...base, compare }] } }] }).ok,
      ).toBe(false);
    }
  });
});
