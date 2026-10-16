import { blame } from '@agent-nexus/driftbench-checks';
import type { RunResult, Verdict } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { attributionOf, blockOutcome, type ReportDiagnosis } from '../src/attribution';
import type { CampaignData } from '../src/data';
import { attributionZone, diagnosesTable } from '../src/html-attribution';
import { attributionText } from '../src/text';

/**
 * Blast radius of PR 454 (two scores, the fix list, the badge). Both scores are rates over runs: a run that never
 * finished (status failed or stopped, the forms not_run and blocked take at this head) is in neither denominator,
 * an unassigned run is in the machine denominator only. The record path (a stored run that carries its diagnoses)
 * is tested in blast-blame-attribution.test.ts, which PR 454 itself holds.
 */

function verdict(id: string, outcome: Verdict['outcome'] = 'fail'): Verdict {
  return { id, kind: 'machine', name: 'tools', gating: true, outcome, evidence: id };
}

function block(pass: boolean, failing: string[] = []): RunResult['blocks'][number] {
  return {
    index: 0,
    givenHash: 'g',
    observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 },
    verdicts: pass ? [verdict('tools.order', 'pass')] : failing.map((id) => verdict(id)),
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass,
  };
}

function run(
  runId: string,
  status: RunResult['status'],
  blocks: RunResult['blocks'],
  extra: Partial<RunResult> = {},
) {
  return { runId, status, blocks, ...extra } as unknown as RunResult;
}

const data = (runs: RunResult[]) => ({ runs }) as unknown as CampaignData;

describe('the rate denominators of the two scores', () => {
  it('holds 1 pass, 1 run that failed to finish and 1 stopped run at 100% of the scored runs', () => {
    const summary = attributionOf(
      data([
        run('pass', 'completed', [block(true)]),
        run('broken', 'failed', [block(false, ['tools.coverage.check.count'])]),
        run('stopped', 'stopped', [block(false, ['tools.order'])]),
      ]),
      {
        diagnoses: {
          broken: { 0: [{ verdictRef: 'tools.coverage.check.count', disposition: 'agent' }] },
          stopped: { 0: [{ verdictRef: 'tools.order', disposition: 'agent' }] },
        },
        fixes: [],
      },
    );
    expect(summary?.machine).toMatchObject({ k: 1, n: 1 });
    expect(summary?.agent).toMatchObject({ k: 1, n: 1 });
    expect(summary?.unassigned).toBe(0);
    expect(summary?.blocks.failing).toBe(0);
    expect(attributionZone(summary)).toContain(
      '<p class="n">1<small>of 1</small></p><span class="l">Machine pass rate</span>',
    );
  });

  it('keeps an unassigned run in the machine denominator and out of the agent rate, and says 0 of 0 assigned runs when none is decided', () => {
    const summary = attributionOf(
      data([
        run('a', 'completed', [block(false, ['tools.order'])]),
        run('b', 'completed', [block(false, ['tools.order'])]),
      ]),
      { diagnoses: { a: { 0: [{ verdictRef: 'tools.order', disposition: 'unassigned' }] } } },
    );
    expect(summary?.machine).toMatchObject({ k: 0, n: 2 });
    expect(summary?.agent).toMatchObject({ k: 0, n: 0 });
    expect(summary?.unassigned).toBe(2);
    expect(attributionText(summary)[0]).toBe(
      'Machine pass rate: 0 of 2 (0.0%) (runs that passed or failed). Agent-attributed pass rate: 0 of 0 assigned runs; 2 unassigned. Unassigned runs are excluded from the agent-attributed rate.',
    );
    expect(attributionZone(summary)).toContain(
      '<p class="n">0<small>of 0</small></p><span class="l">Agent-attributed pass rate</span>',
    );
  });

  it('counts a run whose blocks pass but whose end state fails as unassigned, never as the agent passing', () => {
    const summary = attributionOf(
      data([
        run('end', 'completed', [block(true)], { endState: { match: false, diff: [] } }),
        run('ok', 'completed', [block(true)]),
      ]),
      { fixes: [] },
    );
    expect(summary?.machine).toMatchObject({ k: 1, n: 2 });
    expect(summary?.agent).toMatchObject({ k: 1, n: 1 });
    expect(summary?.unassigned).toBe(1);
  });
});

describe('diagnoses as the blame steps write them', () => {
  it('reads the step output of diagnoseBlock: a chained verdict carries its root disposition', () => {
    const failing = [verdict('tools.coverage.check.count'), verdict('tools.order')];
    const stored = block(false, ['tools.coverage.check.count', 'tools.order']);
    const result = blame.diagnoseBlock({
      verdicts: failing,
      evidenceFor: (v) => ({ block: { observed: stored.observed, verdicts: failing }, verdict: v }),
      tools: ['coverage.check', 'order.create'],
      blame: blame.shippedPolicy('policy/blame'),
      placement: blame.shippedPolicy('policy/placement'),
    });
    const diagnoses: ReportDiagnosis[] = result.diagnoses.map(blame.toStepOutput);
    expect(diagnoses.map((one) => one.verdictRef)).toEqual(['tools.coverage.check.count', 'tools.order']);
    expect(diagnoses[1]?.inherits).toBe('tools.coverage.check.count');
    const root = diagnoses[0]?.disposition;
    const want =
      root === 'agent' || root === 'shared' ? 'fail' : root === 'unassigned' ? 'unassigned' : 'pass';
    expect(blockOutcome(stored, diagnoses)).toBe(want);
  });

  it('counts a failing verdict a retry recovered, which blame never attributes, as unassigned', () => {
    const failing = [verdict('tools.coverage.check.count')];
    const stored = block(false, ['tools.coverage.check.count']);
    const result = blame.diagnoseBlock({
      verdicts: failing,
      evidenceFor: (v) => ({
        block: { observed: stored.observed, verdicts: failing },
        verdict: v,
        reply: { next_action: 'recovered' },
      }),
      blame: blame.shippedPolicy('policy/blame'),
      placement: blame.shippedPolicy('policy/placement'),
    });
    expect(result.recovered).toEqual(['tools.coverage.check.count']);
    expect(result.diagnoses).toEqual([]);
    expect(blockOutcome(stored, result.diagnoses.map(blame.toStepOutput))).toBe('unassigned');
  });

  it('escapes every diagnosis field it renders', () => {
    const html = diagnosesTable([
      {
        verdictRef: 'tools.<b>',
        disposition: 'agent',
        fault: ['<i>skill</i>'],
        fixLocation: 'core',
        fixTarget: '<script>alert(1)</script>',
        fixAction: 'add "x" & <y>',
        rule: 'policy/blame:default@0#R1',
        confidence: 'static',
      },
    ]);
    expect(html).not.toMatch(/<script>|<b>|<i>|<y>/);
    expect(html).toContain('&lt;script&gt;');
  });
});
