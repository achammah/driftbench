// The H1 fixture of the framework tests: 259 stored runs of ten Acme blocks (research/block-phrasing at
// 58669be07, copied byte for byte; SHA256SUMS holds its sha), and the stored oracle's verdict shape.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CheckContext,
  isZero,
  type Observed,
  type Spec,
  type Verdict,
} from '@agent-nexus/driftbench-core';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The ten H1 blocks: spec and 0-based block index (research/block-phrasing src/blocks.ts at 58669be07). */
export const BLOCKS: Record<string, { spec: string; index: number }> = {
  B1: { spec: 'examples/acme/specs/conversations/new-customer-coverage.yaml', index: 1 },
  B2: { spec: 'examples/acme/specs/conversations/new-customer-coverage.yaml', index: 3 },
  B3: { spec: 'examples/acme/specs/conversations/number-porting.yaml', index: 1 },
  B4: { spec: 'examples/acme/specs/conversations/plan-upgrade.yaml', index: 1 },
  B5: { spec: 'examples/acme/specs/conversations/order-loose-confirmation.yaml', index: 0 },
  B6: { spec: 'examples/acme/specs/conversations/off-topic-return.yaml', index: 0 },
  B7: { spec: 'examples/acme/specs/conversations/tool-failure.yaml', index: 1 },
  B8: { spec: 'examples/acme/golden/specs/twise/gen-twise-023.yaml', index: 1 },
  B9: { spec: 'examples/acme/golden/specs/twise/gen-twise-066.yaml', index: 1 },
  B10: { spec: 'examples/acme/golden/specs/twise/gen-twise-018.yaml', index: 2 },
};

export type Call = { label: string; input: unknown; output?: unknown; error?: string; id?: string };
export type Run = {
  id: string;
  block: string;
  calls: Call[];
  reply: string;
  exact: boolean;
  exactFailed: string[];
};

export function h1Runs(): Run[] {
  return readFileSync(join(HERE, '..', 'fixtures', 'framework', 'data', 'h1-runs-class.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Run);
}

/** The context the runner gives a block's checks, holding what the stored oracle read: expect and the calls. */
export function h1Context(spec: Spec, index: number, run: Run): CheckContext {
  const block = spec.blocks[index];
  if (!block) throw new Error(`${spec.id} has no block ${index}`);
  const observed: Observed = {
    segments: [],
    text: run.reply,
    toolCalls: run.calls as Observed['toolCalls'],
    cost: {},
    latencyMs: 0,
  };
  return {
    spec,
    mode: 'T',
    blockIndex: index,
    block,
    expect: block.expect ?? {},
    given: {} as CheckContext['given'],
    observed,
    history: [],
    ledger: {},
  };
}

/**
 * The stored oracle's shape (exactOracle of research/block-phrasing src/oracle.ts): the ids of the failed gating
 * verdicts of the tools check, and `<label>.count0` for a tool the block expects 0 times that was called, the
 * forbidden check's share for a count of 0. The oracle held no other forbidden verdict (`rules.forbidden_tools`,
 * `rules.max_calls`), so those stay out of the comparison.
 */
export function failedLikeStored(ctx: CheckContext, verdicts: readonly Verdict[]): string[] {
  const zero = new Set(
    (ctx.expect.tools ?? []).filter((tool) => isZero(tool.count)).map((tool) => tool.label),
  );
  const out: string[] = [];
  for (const verdict of verdicts) {
    if (!verdict.gating || verdict.outcome === 'pass') continue;
    if (!verdict.id.startsWith('forbidden.')) out.push(verdict.id);
    else if (zero.has(verdict.id.slice('forbidden.'.length)))
      out.push(`${verdict.id.slice('forbidden.'.length)}.count0`);
  }
  return out;
}

export function multisetDiff(a: readonly string[], b: readonly string[]): number {
  const count = new Map<string, number>();
  for (const x of a) count.set(x, (count.get(x) ?? 0) + 1);
  for (const x of b) count.set(x, (count.get(x) ?? 0) - 1);
  return [...count.values()].reduce((sum, value) => sum + Math.abs(value), 0);
}
