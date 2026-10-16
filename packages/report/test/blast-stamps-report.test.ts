// Stamps and diagnoses preserve machine scores, JUnit and campaign comparisons. Stamps without diagnoses
// preserve page bytes; diagnosed records additionally render B4 attribution and block diagnosis details.
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
                disposition: 'setup' as const,
                fixLocation: 'tool.definition',
                fixAction: 'MARKER-DIAGNOSIS-FIX',
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

/** Machine scores and drilldown, excluding only stamps and the additional attribution display. */
function machineCard(card: ReturnType<typeof buildScorecard>): unknown {
  const { attribution: _attribution, ...machine } = card;
  return {
    ...machine,
    drilldown: card.drilldown.map((run) => ({
      ...run,
      blocks: run.blocks.map(({ diagnoses: _diagnoses, ...block }) => ({
        ...block,
        verdicts: block.verdicts.map(({ by: _by, ...verdict }: Verdict) => verdict),
      })),
    })),
  };
}

function withoutDiagnoses(run: RunResult): RunResult {
  return {
    ...run,
    blocks: run.blocks.map(({ diagnoses: _diagnoses, ...block }) => block),
  };
}

describe('blast stamps: machine scores stay stable and diagnoses add their own display', () => {
  it('preserves machine scores and JUnit for diagnosed records', async () => {
    const old = await data(oldRecords(), 'c-stamps');
    const fresh = await data(oldRecords().map(stamped), 'c-stamps');
    const before = buildScorecard(old);
    const after = buildScorecard(fresh);
    expect(machineCard(after)).toStrictEqual(machineCard(before));
    expect(
      after.drilldown.flatMap((run) => run.blocks.flatMap((block) => block.verdicts)).every((v) => v.by),
    ).toBe(true);
    const html = renderHtml(after);
    expect(html).toContain('id="attribution"');
    expect(html).toContain('Machine pass rate');
    expect(after.attribution?.machine).toMatchObject({
      k: before.campaign.passing,
      n: before.campaign.passing + before.campaign.failing,
    });
    expect(renderHtml(before)).not.toContain('id="attribution"');
    expect(html).not.toContain('[object Object]');
    expect(renderJunit(fresh)).toBe(renderJunit(old));
  });

  it('keeps campaign and run pages byte-identical when stamps carry no diagnoses', async () => {
    const old = await data(oldRecords(), 'c-stamps');
    const fresh = await data(oldRecords().map(stamped).map(withoutDiagnoses), 'c-stamps');
    expect(renderHtml(buildScorecard(fresh))).toBe(renderHtml(buildScorecard(old)));
    for (const [index, run] of fresh.runs.entries()) {
      const page = renderRun(runDetailOf(fresh, run));
      expect(page).toBe(renderRun(runDetailOf(old, old.runs[index] as RunResult)));
      expect(page).not.toContain('Diagnoses: who failed');
      expect(page).not.toContain('[object Object]');
    }
  });

  it('renders diagnosis details separately while preserving every run and block machine result', async () => {
    const old = await data(oldRecords(), 'c-stamps');
    const fresh = await data(oldRecords().map(stamped), 'c-stamps');
    for (const [index, run] of fresh.runs.entries()) {
      const before = runDetailOf(old, old.runs[index] as RunResult);
      const after = runDetailOf(fresh, run);
      expect(after.pass).toBe(before.pass);
      expect(after.blocks.map((block) => block.pass)).toEqual(before.blocks.map((block) => block.pass));
      expect(after.blocks[0]?.diagnoses).toMatchObject([
        { disposition: 'setup', fixLocation: 'tool.definition', fixAction: 'MARKER-DIAGNOSIS-FIX' },
      ]);
      const page = renderRun(after);
      expect(page).toContain('Diagnoses: who failed, and where the fix goes');
      expect(page).toContain('tool.definition');
      expect(page).toContain('MARKER-DIAGNOSIS-FIX');
      expect(renderRun(before)).not.toContain('MARKER-DIAGNOSIS-FIX');
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
