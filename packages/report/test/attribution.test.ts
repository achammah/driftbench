import { blame } from '@agent-nexus/driftbench-checks';
import type { RunResult } from '@agent-nexus/driftbench-core';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AttributionOptions,
  attributionOf,
  blockOutcome,
  type ReportDiagnosis,
  type ReportFix,
} from '../src/attribution';
import { type CampaignData, loadCampaign, runPassed, specOfRun } from '../src/data';
import { renderHtml, renderRun } from '../src/html';
import { attributionZone } from '../src/html-attribution';
import { buildScorecard } from '../src/scorecard';
import { attributionText } from '../src/text';
import { storeAcmeCampaign } from './support';

/**
 * The second score on the scorecard and the run page (codeagent_equivalence_blame.md E5), on the stored Acme
 * campaign with the x3 fault: the diagnoses come from the shipped blame and placement files, the fix list from
 * the fix plan. The machine pass rate never changes; the machine rate counts the runs that passed or failed, while the agent-attributed rate excludes unassigned runs.
 */

let fault: CampaignData;

beforeAll(async () => {
  const store = openMemoryStore();
  await storeAcmeCampaign(store, {
    campaignId: 'c-acme-x3',
    modes: ['T', 'F', 'P'],
    repeats: 2,
    fault: 'x3-skips-recap',
  });
  fault = await loadCampaign(store, 'c-acme-x3');
  await store.close();
}, 120_000);

/**
 * The lines of the Acme sales prompt two of its checks verify (examples/acme prompt, "Explicit confirmation" and
 * "The recap"): the links a block carries with relation verifies. Every other failing check has no link, so its
 * failure stays unassigned.
 */
const LINKS = [
  { verdict: 'forbidden.order.create', home: 'core', act: 'gate', file: 'prompts/acme-sales.md', line: 71 },
  { verdict: 'stage.reached', home: 'core', act: 'stage', file: 'prompts/acme-sales.md', line: 68 },
];

/** Diagnoses of every failing block, by run and block, and the campaign's fix plan, from the shipped files. */
function attribution(data: CampaignData): AttributionOptions {
  const diagnoses: Record<string, Record<number, ReportDiagnosis[]>> = {};
  const campaign: blame.CampaignDiagnosis[] = [];
  for (const run of data.runs) {
    const spec = specOfRun(data, run);
    for (const block of run.blocks) {
      if (block.pass) continue;
      const specBlock = spec?.blocks[block.index];
      const result = blame.diagnoseBlock({
        verdicts: block.verdicts,
        evidenceFor: blame.blockEvidenceInputs({
          observed: block.observed,
          verdicts: block.verdicts,
          ...(specBlock?.expect === undefined ? {} : { expect: specBlock.expect }),
          ...(spec === undefined ? {} : { spec }),
          extra: { links: LINKS },
        }),
        ...(specBlock?.expect?.tools === undefined
          ? {}
          : { tools: specBlock.expect.tools.filter((tool) => tool.count !== 0).map((tool) => tool.label) }),
        blame: blame.shippedPolicy('policy/blame'),
        placement: blame.shippedPolicy('policy/placement'),
      });
      diagnoses[run.runId] = {
        ...(diagnoses[run.runId] ?? {}),
        [block.index]: result.diagnoses.map(blame.toStepOutput),
      };
      campaign.push(...result.diagnoses.map((one) => ({ ...one, block: `${run.runId}#${block.index}` })));
    }
  }
  const plan = blame.fixPlan(campaign, blame.shippedPolicy('policy/placement'));
  const fixes: ReportFix[] = plan.fixes.map((fix) => ({
    fixLocation: fix.fix_location,
    ...(fix.fix_target === undefined ? {} : { fixTarget: fix.fix_target }),
    fixAction: fix.fix_action,
    blocks: fix.blocks,
    agentBlocks: fix.agent_blocks,
    removeCopies: fix.remove_copies,
    ...(fix.superseded_by === undefined ? {} : { supersededBy: fix.superseded_by }),
    confidence: fix.confidence,
  }));
  return { diagnoses, fixes };
}

describe('the two scores on the Acme x3 campaign', () => {
  it.each(['HTML', 'text', 'JSON'])(
    'shows Acme 20 of 20 assigned runs and 26 unassigned without an agent percentage in %s',
    (format) => {
      // The audit reproduction has a fix list but no assigned failure diagnoses.
      const card = buildScorecard(fault, { attribution: { fixes: [] } });
      const summary = card.attribution;
      expect(summary?.agent).toMatchObject({ k: 20, n: 20 });
      expect(summary?.unassigned).toBe(26);
      expect(summary?.blocks.agent).toBe(0);
      expect(summary?.machine).toMatchObject({ k: 20, n: 46, estimate: 20 / 46 });
      const html = attributionZone(summary);
      const agentHtml = html
        .split('<div class="stat">')
        .find((part) => part.includes('Agent-attributed pass rate'));
      if (format === 'HTML') {
        expect(agentHtml).toContain('20 of 20 assigned runs; 26 unassigned');
        expect(agentHtml).not.toContain('%');
      }
      const agentText = attributionText(summary)[0]?.split('Agent-attributed pass rate: ')[1];
      if (format === 'text') {
        expect(agentText).toContain('20 of 20 assigned runs; 26 unassigned');
        expect(agentText).not.toContain('%');
      }
      const json = JSON.parse(JSON.stringify(card)).attribution;
      if (format === 'JSON') expect(json.agent).toEqual({ k: 20, n: 20 });
      expect(json.unassigned).toBe(26);
      expect(json.machine.estimate).toBe(summary?.machine?.estimate);
    },
  );

  it('keeps the machine pass rate of the scorecard, and adds the agent-attributed one', () => {
    const plain = buildScorecard(fault);
    const card = buildScorecard(fault, { attribution: attribution(fault) });
    expect(plain.attribution).toBeUndefined();
    const summary = card.attribution;
    expect(summary).toBeDefined();
    const completed = fault.runs.filter((run) => run.status === 'completed');
    expect(summary?.machine?.k).toBe(completed.filter(runPassed).length);
    expect(summary?.machine?.n).toBe(completed.length);
    expect(card.campaign.passing).toBe(plain.campaign.passing);
    const decided = (summary?.agent?.n ?? 0) + (summary?.unassigned ?? 0);
    expect(decided).toBe(completed.length);
  });

  it('renders the same scorecard as before when no block carries a diagnosis', () => {
    expect(renderHtml(buildScorecard(fault, { attribution: {} }))).toBe(renderHtml(buildScorecard(fault)));
  });

  it('matches the committed snapshots: the zone, its text, and one failing run page', async () => {
    const options = attribution(fault);
    const card = buildScorecard(fault, { attribution: options, maxRuns: 3 });
    await expect(attributionZone(card.attribution)).toMatchFileSnapshot(
      './__snapshots__/acme-x3-attribution.html',
    );
    await expect(`${attributionText(card.attribution).join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/acme-x3-attribution.txt',
    );
    const failing = card.drilldown.find(
      (run) => !run.pass && run.blocks.some((block) => block.diagnoses !== undefined),
    );
    expect(failing).toBeDefined();
    // The run's events carry wall-clock times; the page without them is the same bytes every time.
    const { events: _events, ...steady } = failing as NonNullable<typeof failing>;
    await expect(renderRun(steady)).toMatchFileSnapshot('./__snapshots__/acme-x3-attribution-run.html');
    expect(renderHtml(card)).toContain('id="attribution"');
  });

  it('shows a badge on a page scored with a non-default rule file, and none with the defaults', () => {
    const options = attribution(fault);
    const custom = buildScorecard(fault, {
      attribution: {
        ...options,
        objects: [{ kind: 'policy/blame', id: 'northwind', hash: '0123456789abcdef' }],
      },
      maxRuns: 1,
    });
    expect(custom.attribution?.nonDefault).toEqual(['policy/blame:northwind@0123456789abcdef']);
    expect(renderHtml(custom)).toContain(
      '<span class="badge">non-default</span> Scored with policy/blame:northwind@0123456789abcdef.',
    );
    const run = custom.drilldown[0];
    expect(run?.nonDefault).toEqual(['policy/blame:northwind@0123456789abcdef']);
    expect(renderRun(run as NonNullable<typeof run>)).toContain('non-default');
    const shipped = buildScorecard(fault, {
      attribution: { ...options, objects: [{ kind: 'policy/blame', id: 'default' }] },
    });
    expect(shipped.attribution?.nonDefault).toEqual([]);
    expect(renderHtml(shipped)).not.toContain('<span class="badge">non-default</span>');
  });
});

describe('unassigned stays in the machine denominator and outside the agent-attributed rate', () => {
  const block = (pass: boolean, ids: string[]): RunResult['blocks'][number] =>
    ({
      index: 0,
      pass,
      verdicts: ids.map((id) => ({
        id,
        kind: 'machine',
        name: 'tools',
        gating: true,
        outcome: 'fail',
        evidence: id,
      })),
    }) as unknown as RunResult['blocks'][number];

  it('a block passes for the agent only when every failure is setup, excluded or credited', () => {
    expect(
      blockOutcome(block(false, ['a', 'b']), [
        { verdictRef: 'a', disposition: 'setup' },
        { verdictRef: 'b', disposition: 'credited' },
      ]),
    ).toBe('pass');
    expect(
      blockOutcome(block(false, ['a', 'b']), [
        { verdictRef: 'a', disposition: 'setup' },
        { verdictRef: 'b', disposition: 'unassigned' },
      ]),
    ).toBe('unassigned');
    expect(
      blockOutcome(block(false, ['a', 'b']), [
        { verdictRef: 'a', disposition: 'unassigned' },
        { verdictRef: 'b', disposition: 'agent' },
      ]),
    ).toBe('fail');
    expect(blockOutcome(block(false, ['a']), [])).toBe('unassigned');
  });

  it('leaves an unassigned run out of the agent rate and keeps it out of the machine numerator', () => {
    const runs = [true, false, false].map(
      (pass, i) =>
        ({
          runId: `r${i}`,
          status: 'completed',
          blocks: [block(pass, pass ? [] : ['a'])],
        }) as unknown as RunResult,
    );
    const data = { runs } as unknown as CampaignData;
    const summary = attributionOf(data, {
      diagnoses: {
        r1: { 0: [{ verdictRef: 'a', disposition: 'credited' }] },
        r2: { 0: [{ verdictRef: 'a', disposition: 'unassigned' }] },
      },
    });
    expect(summary?.machine).toMatchObject({ k: 1, n: 3 });
    expect(summary?.agent).toMatchObject({ k: 2, n: 2 });
    expect(summary?.unassigned).toBe(1);
    expect(summary?.blocks).toMatchObject({ failing: 2, credited: 1, unassigned: 1, agent: 0 });
  });

  const unrun = (status: 'not_run' | 'blocked'): RunResult['blocks'][number] =>
    ({ index: 1, pass: false, status, verdicts: [] }) as unknown as RunResult['blocks'][number];

  it('a block not run or blocked is no failure of the agent, and is counted apart', () => {
    expect(blockOutcome(unrun('not_run'), [])).toBe('pass');
    expect(blockOutcome(unrun('blocked'), [])).toBe('pass');
    const runs = [
      [block(true, []), unrun('not_run')],
      [block(true, []), unrun('blocked')],
      [block(false, ['a']), unrun('blocked')],
    ].map((blocks, i) => ({ runId: `r${i}`, status: 'completed', blocks }) as unknown as RunResult);
    const data = { runs } as unknown as CampaignData;
    const summary = attributionOf(data, {
      diagnoses: { r2: { 0: [{ verdictRef: 'a', disposition: 'agent' }] } },
    });
    // Only the one failed block fails; the not run and the blocked blocks never enter the failing count.
    expect(summary?.blocks).toMatchObject({ failing: 1, agent: 1, notRun: 1, blocked: 2 });
    expect(attributionText(summary).join('\n')).toContain('blocks: 1 not run, 2 blocked');
    expect(attributionZone(summary)).toContain('blocks: 1 not run, 2 blocked');
  });

  it('leaves a run with a block not run or blocked and no failure out of both rates, and counts it apart', () => {
    // 2 clean runs, 4 runs whose only non-passing block was not run, 1 run blocked, 1 run that failed.
    const clean = (id: string) =>
      ({ runId: id, status: 'completed', blocks: [block(true, [])] }) as unknown as RunResult;
    const unmeasured = (id: string, status: 'not_run' | 'blocked') =>
      ({
        runId: id,
        status: 'completed',
        blocks: [block(true, []), unrun(status)],
      }) as unknown as RunResult;
    const failed = { runId: 'f', status: 'completed', blocks: [block(false, ['a'])] } as unknown as RunResult;
    const runs = [
      clean('c0'),
      clean('c1'),
      unmeasured('n0', 'not_run'),
      unmeasured('n1', 'not_run'),
      unmeasured('n2', 'not_run'),
      unmeasured('n3', 'not_run'),
      unmeasured('b0', 'blocked'),
      failed,
    ];
    const summary = attributionOf({ runs } as unknown as CampaignData, {
      diagnoses: { f: { 0: [{ verdictRef: 'a', disposition: 'agent' }] } },
    });
    // The scored runs are the 2 clean ones and the failed one: 2 of 3 on both rates.
    expect(summary?.machine).toMatchObject({ k: 2, n: 3 });
    expect(summary?.agent).toMatchObject({ k: 2, n: 3 });
    expect(summary?.unassigned).toBe(0);
    expect(summary?.unmeasuredRuns).toEqual({ notRun: 4, blocked: 1 });
    expect(attributionText(summary).join('\n')).toContain(
      'runs left out of both rates: 4 not run, 1 blocked',
    );
    expect(attributionZone(summary)).toContain('runs left out of both rates: 4 not run, 1 blocked');
  });

  it('with only unmeasured runs there is no rate, only the counts', () => {
    const runs = [0, 1].map(
      (i) =>
        ({
          runId: `n${i}`,
          status: 'completed',
          blocks: [unrun('not_run')],
        }) as unknown as RunResult,
    );
    const summary = attributionOf({ runs } as unknown as CampaignData, { fixes: [] });
    expect(summary?.machine).toBeUndefined();
    expect(summary?.agent).toMatchObject({ k: 0, n: 0 });
    expect(summary?.unmeasuredRuns).toEqual({ notRun: 2, blocked: 0 });
  });

  it('names no unmeasured blocks when every block was measured', () => {
    const runs = [
      { runId: 'r0', status: 'completed', blocks: [block(false, ['a'])] } as unknown as RunResult,
    ];
    const summary = attributionOf({ runs } as unknown as CampaignData, {
      diagnoses: { r0: { 0: [{ verdictRef: 'a', disposition: 'agent' }] } },
    });
    expect(summary?.blocks).toMatchObject({ notRun: 0, blocked: 0 });
    expect(summary?.unmeasuredRuns).toEqual({ notRun: 0, blocked: 0 });
    expect(attributionText(summary).join('\n')).not.toContain('Not measured');
    expect(attributionZone(summary)).not.toContain('Not measured');
  });
});
