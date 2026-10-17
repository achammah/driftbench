import { registerValueCheck } from '@agent-nexus/driftbench-checks';
import { describe, expect, it } from 'vitest';
import { observationCompatibilityHash } from '../src/radius/rejudge';
import { cacheSpecHash } from '../src/runner/cache';
import type { Spec } from '../src/schema/spec';
import { validateSpec } from '../src/spec/load';

/**
 * Blast radius of `ToolExpect.compare` (PR 459) on the hashes that decide a rerun. `compare` only chooses how
 * the tools check reads a value the agent already sent: like `uses`, it is scoring-only. A spec without it keeps
 * its block cache key and its re-judge compatibility hash; writing it must re-score the stored observations, not
 * rerun the agent nor refuse a re-judge. Fictional data only.
 */

function spec(extra: { compare?: unknown; uses?: unknown } = {}): Spec {
  const loaded = validateSpec({
    id: 'blast-ladder-compare',
    target: { adapter: 'function', agent: 'acme-sales' },
    blocks: [
      {
        user: 'Do you cover 88 Summit Avenue, Acmeville?',
        expect: {
          tools: [
            {
              label: 'coverage.check',
              input: { address: '88 Summit Avenue, Acmeville' },
              ...(extra.compare === undefined ? {} : { compare: extra.compare }),
            },
          ],
        },
        ...(extra.uses === undefined ? {} : { uses: extra.uses }),
      },
    ],
  });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

const EXECUTION = { executionHash: 'execution-test' };

// The shipped policy/value-check:default is registered by the checks package (idempotent).
registerValueCheck();

describe('ToolExpect.compare and the rerun hashes (PR 459)', () => {
  it('control: uses, the scoring-only key of F1, moves neither the cache key nor the re-judge hash', () => {
    const plain = spec();
    const used = spec({ uses: { value_check: 'default' } });
    expect(cacheSpecHash(used)).toBe(cacheSpecHash(plain));
    expect(observationCompatibilityHash(used, EXECUTION)).toBe(
      observationCompatibilityHash(plain, EXECUTION),
    );
  });

  it('a spec that does not write compare parses without the key: the loader adds no default', () => {
    const plain = spec();
    expect(plain.blocks[0]?.expect?.tools?.[0]).not.toHaveProperty('compare');
    expect(JSON.stringify(plain)).not.toContain('"compare"');
  });

  it('writing compare moves neither the block cache key nor the re-judge compatibility hash', () => {
    const plain = spec();
    for (const compare of ['outcome', { exact: 'the label is shown as written' }, { address: 'as_given' }]) {
      const declared = spec({ compare });
      expect(cacheSpecHash(declared)).toBe(cacheSpecHash(plain));
      expect(observationCompatibilityHash(declared, EXECUTION)).toBe(
        observationCompatibilityHash(plain, EXECUTION),
      );
    }
  });
});
