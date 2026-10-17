// Blast radius of unit F2 on the report: a campaign whose records carry `by`, `resolved`, `diagnoses` and
// `skippedForBudget` reports what the same campaign without them reports. The scorecard numbers, the HTML page,
// the JUnit file and a compare against a campaign of old records do not move; mixed campaigns compare equal.
import { readFileSync } from 'node:fs';
import type { RunResult, Verdict } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { compareCampaigns } from '../src/compare';
import type { CampaignData } from '../src/data';
import { renderHtml, renderRun } from '../src/html';
import { renderJunit } from '../src/junit';
import { buildScorecard, runDetailOf } from '../src/scorecard';
import { compareText } from '../src/text';
import { loadAcme } from './support';

const OLD = new URL('../../core/test/fixtures/framework/old-records.json', import.meta.url);

function oldRecords(): RunResult[] {
  return (JSON.parse(readFileSync(OLD, 'utf8')) as { records: RunResult[] }).records;
}

function stamped(run: RunResult): RunResult {
  return {
    ...run,
    blocks: run.blocks.map((block, index) => ({
      ...block,
      verdicts: block.verdicts.map((verdict) => ({
        ...verdict,
        by: {
          object: 'check-set:default@0123abcd',
          item: verdict.name,
          impl: `builtin:check/${verdict.name}`,
          layer: 'shipped' as const,
        },
      })),
      resolved: {
        objects: [
          { key: 'check_set', kind: 'check-set', id: 'default', hash: 'feedc0de', setAt: 'shipped' as const },
        ],
        hash: 'a1b2c3d4',
      },
      ...(index === 0
        ? {
            diagnoses: [
              {
                diagnostic: 'diagnostic:probe@89abcdef',
                summary: 'MARKER-DIAGNOSIS-SUMMARY',
                by: { object: 'diagnostic:probe@89abcdef', impl: 'builtin:probe', layer: 'shipped' as const },
              },
            ],
            skippedForBudget: 1,
          }
        : {}),
    })),
  };
}

async function data(runs: RunResult[], campaignId: string): Promise<CampaignData> {
  const specs = new Map((await loadAcme()).map((entry) => [`${entry.spec.id}@${entry.hash}`, entry]));
  const pinned = [
    ...new Map(runs.map((run) => [run.specId, { id: run.specId, hash: run.specHash }])).values(),
  ];
  for (const pin of pinned)
    if (!specs.has(`${pin.id}@${pin.hash}`)) throw new Error(`no spec ${pin.id}@${pin.hash}`);
  return {
    campaign: {
      campaignId,
      specs: pinned,
      targets: [{ adapter: 'function', agent: 'acme-sales' }],
      modes: ['T', 'F'],
      repeats: { T: 1, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-15T00:00:00.000Z',
    },
    specs,
    runs,
  };
}

/** The scorecard with every verdict's stamp taken out of its drilldown. */
function unstampedCard(card: ReturnType<typeof buildScorecard>): unknown {
  return {
    ...card,
    drilldown: card.drilldown.map((run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        verdicts: block.verdicts.map(({ by: _by, ...verdict }: Verdict) => verdict),
      })),
    })),
  };
}

describe('blast stamps: the report reads stamped records as it reads old ones', () => {
  it('builds the same scorecard, HTML page and JUnit file', async () => {
    const old = await data(oldRecords(), 'c-stamps');
    const fresh = await data(oldRecords().map(stamped), 'c-stamps');
    const before = buildScorecard(old);
    const after = buildScorecard(fresh);
    expect(unstampedCard(after)).toStrictEqual(unstampedCard(before));
    expect(
      after.drilldown.flatMap((run) => run.blocks.flatMap((block) => block.verdicts)).every((v) => v.by),
    ).toBe(true);
    const html = renderHtml(after);
    expect(html).toBe(renderHtml(before));
    expect(html).not.toContain('[object Object]');
    expect(renderJunit(fresh)).toBe(renderJunit(old));
  });

  it('draws each run of the viewer drilldown as it draws the old record', async () => {
    const old = await data(oldRecords(), 'c-stamps');
    const fresh = await data(oldRecords().map(stamped), 'c-stamps');
    for (const [index, run] of fresh.runs.entries()) {
      const page = renderRun(runDetailOf(fresh, run));
      expect(page).toBe(renderRun(runDetailOf(old, old.runs[index] as RunResult)));
      expect(page).not.toContain('MARKER-DIAGNOSIS-SUMMARY');
      expect(page).not.toContain('[object Object]');
    }
  });

  it('compares a campaign of stamped records to one of old records as equal, both ways', async () => {
    const old = await data(oldRecords(), 'c-old');
    const fresh = await data(oldRecords().map(stamped), 'c-new');
    const same = compareCampaigns(old, await data(oldRecords(), 'c-new'), { margin: 0.05 });
    const forward = compareCampaigns(old, fresh, { margin: 0.05 });
    const backward = compareCampaigns(
      await data(oldRecords().map(stamped), 'c-old'),
      await data(oldRecords(), 'c-new'),
      { margin: 0.05 },
    );
    expect(forward.verdict).toBe(same.verdict);
    expect(compareText(forward)).toBe(compareText(same));
    expect(compareText(backward)).toBe(compareText(same));
    expect(forward.criteria.map((c) => [c.criterion, c.nonInferior])).toEqual(
      same.criteria.map((c) => [c.criterion, c.nonInferior]),
    );
  });

  it('compares a mixed campaign, old and stamped runs of one cell set, as equal', async () => {
    const records = oldRecords();
    const mixed = records.map((run, index) => (index % 2 === 0 ? stamped(run) : run));
    const result = compareCampaigns(await data(records, 'c-old'), await data(mixed, 'c-mixed'), {
      margin: 0.05,
    });
    const same = compareCampaigns(await data(records, 'c-old'), await data(records, 'c-mixed'), {
      margin: 0.05,
    });
    expect(compareText(result)).toBe(compareText(same));
  });
});
