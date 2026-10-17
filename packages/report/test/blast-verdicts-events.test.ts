import type { BlockResult, RunEvent, RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { timelineSection } from '../src/html';
import { runDetailOf } from '../src/scorecard';
import { block, dataOf, run } from './support';

/**
 * Blast-radius audit (PR 428): the runner reports block_end with status not_run for a block it never sent.
 * The run log and the block timeline read the event: a block not run must never read as a block that fails.
 */
const AT = '2026-10-15T00:00:00.000Z';
const events: RunEvent[] = [
  { type: 'block_start', index: 0, at: AT },
  { type: 'block_end', index: 0, pass: true, at: AT },
  { type: 'block_start', index: 1, at: AT },
  { type: 'block_end', index: 1, pass: false, status: 'not_run', at: AT },
];

describe('blast radius: block_end events of a block not run', () => {
  it('the passing block reads as passing', () => {
    expect(timelineSection(events)).toContain('block 0 passes');
  });

  it('the run log and the block timeline never say a not_run block fails', () => {
    expect(timelineSection(events)).not.toContain('block 1 fails');
    const base = run({ specId: 'g', blocks: [{}, {}] });
    const notRun: BlockResult = {
      ...block(1),
      pass: false,
      status: 'not_run',
      notRun: { kind: 'unsupported', layer: '5 world', check: 'capability', expected: 'e', got: 'g' },
    };
    const withEvents: RunResult = { ...base, blocks: [base.blocks[0] as BlockResult, notRun], events };
    const detail = runDetailOf(dataOf([withEvents]), withEvents);
    expect(detail.blocks[1]?.timelineEvents?.map((event) => event.label)).not.toContain('block end fail');
  });
});
