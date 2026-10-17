// Blast radius of unit F6 on the report: a re-scored block carries a `rejudged` stamp with no criterion. The run
// page and the scorecard page label it without an empty criterion list.
import type { RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { renderHtml, renderRun } from '../src/html';
import { buildScorecard, runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

const stamp = {
  fromCampaign: 'acme-full',
  fromRun: 'r0',
  oldSpecHash: 'aaaaaaaaaaaa',
  newSpecHash: 'aaaaaaaaaaaa',
  compatibilityHash: 'c0ffee',
  judgedAt: '2026-10-15T00:00:00.000Z',
};

function rescored(): RunResult {
  const base = run({ specId: 'g01', blocks: [{}, {}] });
  return {
    ...base,
    rejudged: { ...stamp, criteria: [] },
    blocks: base.blocks.map((block) => ({ ...block, rejudged: { ...stamp, criteria: [], judgeCostUsd: 0 } })),
  };
}

const renderers = [
  { name: 'run page', render: (one: RunResult) => renderRun(runDetailOf(dataOf([one]), one)) },
  { name: 'scorecard', render: (one: RunResult) => renderHtml(buildScorecard(dataOf([one]))) },
];

describe('blast stamps: a re-scored block on the report pages', () => {
  it.each(renderers)('names the re-score without an empty criterion list on $name', ({ render }) => {
    const page = render(rescored());
    expect(page).toContain('Re-scored; observations from acme-full.');
    expect(page).not.toMatch(/Re-judged: ;/);
  });

  it.each(renderers)('still lists the criteria of a re-judged block on $name', ({ render }) => {
    const one = rescored();
    const judged: RunResult = {
      ...one,
      rejudged: { ...stamp, criteria: ['price'] },
      blocks: one.blocks.map((block) => ({
        ...block,
        rejudged: { ...stamp, criteria: ['price'], judgeCostUsd: 0 },
      })),
    };
    const page = render(judged);
    expect(page).toContain('Re-judged: price; observations from acme-full.');
    expect(page).not.toContain('Re-scored;');
  });
});
