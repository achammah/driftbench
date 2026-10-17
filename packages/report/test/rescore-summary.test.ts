import type { RunResult } from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { resolveMargin } from '../../cli/src/commands/compare';
import { compareCampaigns } from '../src/compare';
import { carriedSummary } from '../src/data';
import { carriedLines } from '../src/format';
import { renderHtml, renderRun } from '../src/html';
import { buildScorecard, runDetailOf } from '../src/scorecard';
import { compareText } from '../src/text';
import { dataOf, run } from './support';

const stamp = {
  fromCampaign: 'immediate-source',
  fromRun: 'source-run',
  oldSpecHash: 'h1',
  newSpecHash: 'h1',
  compatibilityHash: 'compatible',
  judgedAt: '2026-10-15T00:00:00.000Z',
};
function reused(criteria?: string[], repeat = 0): RunResult {
  const one = run({ repeat, blocks: [{}, {}] });
  return {
    ...one,
    carried: {
      fromCampaign: 'original-agent-run',
      fromRun: 'original',
      agentVersion: 'v1',
      age: { campaigns: 2, days: 1 },
    },
    ...(criteria === undefined ? {} : { rejudged: { ...stamp, criteria } }),
    blocks: one.blocks.map((block) => ({
      ...block,
      ...(criteria === undefined ? {} : { rejudged: { ...stamp, criteria, judgeCostUsd: 0 } }),
    })),
  };
}

it('names the immediate re-score source and keeps the original observation origin', () => {
  const lines = carriedLines(carriedSummary([reused([])])).join('\n');
  expect(lines).toContain('Re-scored; observations from immediate-source. 2 blocks re-scored.');
  expect(lines).toContain('observations measured in original-agent-run');
  expect(lines).not.toContain('1 run carried');
  expect(lines).not.toContain('Re-scored; observations from original-agent-run');
  expect(lines).toContain('0 runs fresh, 1 run re-scored, 0 runs carried');
  expect(carriedSummary([reused([])])).toMatchObject({ carried: 1, fresh: 0, rescoredRuns: 1 });
});

it.each([undefined, ['price']])(
  'keeps ordinary carry wording without a false re-score for %j',
  (criteria) => {
    const summary = carriedSummary([reused(criteria)]);
    expect(summary).not.toHaveProperty('rescored');
    expect(summary).not.toHaveProperty('rescoredRuns');
    const lines = carriedLines(summary).join('\n');
    expect(lines).toContain('Fresh and carried results are merged:');
    expect(lines).toContain('1 run carried from original-agent-run');
    expect(lines).not.toContain('Re-scored;');
  },
);

it('counts only re-scored blocks in a mixed campaign and groups separate immediate sources', () => {
  const partial = reused([], 3);
  const [first, second] = partial.blocks;
  if (!first || !second) throw new Error('fixture needs two blocks');
  partial.blocks[0] = { ...first, rejudged: { ...stamp, criteria: ['price'] } };
  partial.blocks[1] = {
    ...second,
    rejudged: { ...stamp, fromCampaign: 'second-source', criteria: [] },
  };
  const summary = carriedSummary([reused([]), reused(['price'], 1), reused(undefined, 2), partial]);
  expect(summary).toMatchObject({
    fresh: 0,
    carried: 4,
    rescoredRuns: 2,
    rescored: [
      { campaign: 'immediate-source', blocks: 2 },
      { campaign: 'second-source', blocks: 1 },
    ],
  });
  const lines = carriedLines(summary).join('\n');
  expect(lines).toContain('Re-scored; observations from second-source. 1 block re-scored.');
  expect(lines).toContain('2 runs re-scored, 2 runs carried');
  expect(lines).toContain('2 runs carried from original-agent-run');
  expect(lines).not.toContain('4 runs carried');
});

it('comparison text describes re-scored observations rather than copied results', () => {
  const baseline = dataOf([run({ specId: 'fresh' }), run()], {}, 'baseline');
  const candidate = dataOf([run({ specId: 'fresh' }), reused([], 1)], {}, 'candidate');
  const compared = compareCampaigns(baseline, candidate, { margin: 0.1 });
  expect(compared.pairs).toHaveLength(1);
  expect(compared.carried?.carried).toBe(1);
  const text = compareText(compared);
  expect(text).toContain('Re-scored; observations from immediate-source');
  expect(text).toContain('Reused observations, not paired:');
  expect(text).toContain('no fresh agent pairs');
  expect(text).not.toContain('Carried, not paired:');
  expect(text).not.toContain('1 run carried');
  expect(text).not.toContain('results copied from an earlier campaign');
});

it.each([
  { criteria: [[]], expected: 'reused observations' },
  { criteria: [['price']], expected: 're-judged observations' },
  { criteria: [[], ['price']], expected: 'reused observations, including re-judged criteria,' },
])('auto-margin identifies $expected', ({ criteria, expected }) => {
  const data = dataOf(criteria.map((names, index) => reused(names, index)));
  data.campaign.rejudged = criteria.map((names) => ({ ...stamp, criteria: names }));
  let output = '';
  const margin = resolveMargin(
    { margin: 'auto', minGoldens: 5, strict: false },
    data,
    {},
    {
      cwd: '.',
      out: (line) => {
        output += line;
      },
      err: () => {},
    },
  );
  expect(margin).toBe(0.02);
  expect(output).toContain(`Margin auto: ${expected} supply no fresh agent pairs`);
  if (criteria.some((names) => names.length === 0))
    expect(output).toContain('Re-scored; observations from immediate-source');
  else expect(output).not.toContain('Re-scored;');
});

it.each([
  {
    name: 'run page',
    render: (one: RunResult) => renderRun(runDetailOf(dataOf([one]), one)),
    header: /<p class="run-facts">([\s\S]*?)<\/p>/,
  },
  {
    name: 'scorecard run data',
    render: (one: RunResult) => renderHtml(buildScorecard(dataOf([one]))),
    header: /Scoring<\/[^>]+>[\s\S]*?Re-scored; observations from immediate-source/,
  },
])('identifies the re-score in the $name header', ({ render, header }) => {
  const page = render(reused([]));
  const text = page.match(header)?.[0];
  expect(text).toBeDefined();
  expect(text).toContain('Re-scored; observations from immediate-source');
  expect(text).not.toContain('carried from original-agent-run');
});

it.each([
  { name: 'run page', render: (one: RunResult) => renderRun(runDetailOf(dataOf([one]), one)) },
  { name: 'scorecard', render: (one: RunResult) => renderHtml(buildScorecard(dataOf([one]))) },
])('keeps actual criterion rejudge and carry labels in $name', ({ render }) => {
  expect(render(reused(['price']))).toContain('Re-judged: price; observations from immediate-source');
  expect(render(reused(['price']))).not.toContain('Re-scored;');
  expect(render(reused())).toContain('carried from original-agent-run');
  expect(render(reused())).not.toContain('Re-scored;');
});

it('retains the run re-score label when a compact index omits its blocks', () => {
  const one = reused([]);
  const detail = runDetailOf(dataOf([one]), one);
  const page = renderRun({ ...detail, blocks: [] });
  expect(page).toContain('Re-scored; observations from immediate-source');
  expect(page).not.toContain('carried from original-agent-run');
});

it.each([true, false])('labels the unpaired re-score when its unit exists in baseline=%s', (inBaseline) => {
  const baseline = dataOf([run({ specId: 'fresh' }), ...(inBaseline ? [run()] : [])], {}, 'baseline');
  const candidate = dataOf([run({ specId: 'fresh' }), reused([])], {}, 'candidate');
  const compared = compareCampaigns(baseline, candidate, { margin: 0.1 });
  expect(compared.pairs.map((pair) => pair.specId)).toEqual(['fresh']);
  expect(compared.unpaired).toEqual([
    {
      unit: 'spec-a · F',
      reason: 'Re-scored; observations from immediate-source; not a new measurement',
    },
  ]);
  const carried = compareCampaigns(baseline, dataOf([run({ specId: 'fresh' }), reused()]), { margin: 0.1 });
  expect(carried.unpaired[0]?.reason).toContain('carried from original-agent-run');
});
