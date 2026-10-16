import type { RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { attributionOf, nonDefaultOf, type ReportDiagnosis, type ReportObject } from '../src/attribution';
import type { CampaignData } from '../src/data';
import { attributionZone } from '../src/html-attribution';
import { attributionText } from '../src/text';

function block(ids: string[], diagnoses: ReportDiagnosis[] = [], objects: ReportObject[] = []) {
  return {
    index: 0,
    pass: ids.length === 0,
    verdicts: ids.map((id) => ({
      id,
      kind: 'machine',
      name: 'tools',
      gating: true,
      outcome: 'fail',
      evidence: id,
    })),
    diagnoses,
    resolved: { objects },
  } as unknown as RunResult['blocks'][number];
}
function run(blocks: RunResult['blocks'], extra: Partial<RunResult> = {}): RunResult {
  return { runId: 'r', status: 'completed', blocks, ...extra } as RunResult;
}
function summary(...runs: RunResult[]) {
  return attributionOf({ runs } as unknown as CampaignData, { fixes: [] });
}

describe('PR 454 review regressions', () => {
  it.each([
    { passed: 2, failed: 1, unassigned: 2, showRate: false },
    { passed: 2, failed: 1, unassigned: 1, showRate: true },
    { passed: 2, failed: 2, unassigned: 1, showRate: true },
    { passed: 2, failed: 0, unassigned: 0, showRate: true },
    { passed: 0, failed: 0, unassigned: 1, showRate: false },
    { passed: 0, failed: 0, unassigned: 0, showRate: false },
  ])(
    'uses assigned failed runs as the suppression threshold: $passed/$failed/$unassigned',
    ({ passed, failed, unassigned, showRate }) => {
      const result = summary(
        ...Array.from({ length: passed }, () => run([block([])])),
        // Multiple failing blocks still represent only one assigned failed run.
        ...Array.from({ length: failed }, () =>
          run([
            block(['a'], [{ verdictRef: 'a', disposition: 'agent' }]),
            block(['b'], [{ verdictRef: 'b', disposition: 'agent' }]),
            block(['c'], [{ verdictRef: 'c', disposition: 'shared' }]),
          ]),
        ),
        ...Array.from({ length: unassigned }, () => run([block(['unknown'])])),
      );
      const counts = `${passed} of ${passed + failed} assigned runs; ${unassigned} unassigned`;
      const json = JSON.parse(JSON.stringify(result));
      expect(json.agent).toMatchObject({ k: passed, n: passed + failed });
      const agentHtml = attributionZone(result)
        .split('<div class="stat">')
        .find((part) => part.includes('Agent-attributed pass rate'));
      const agentText = attributionText(result)[0]?.split('Agent-attributed pass rate: ')[1];
      for (const rendered of [agentHtml, agentText]) {
        expect(rendered).toContain(counts);
        expect(rendered?.includes('%')).toBe(showRate);
      }
      if (showRate) expect(json.agent.estimate).toBe(passed / (passed + failed));
      else expect(json.agent).toEqual({ k: passed, n: passed + failed });
    },
  );

  it.each(['setup', 'credited', 'excluded'])(
    'keeps independent end failures unassigned after %s credit',
    (disposition) => {
      const blocks = [block(['a'], [{ verdictRef: 'a', disposition }])];
      for (const extra of [{ endState: { match: false } }, { endVerdict: 'failure' }]) {
        const result = summary(run(blocks, extra as Partial<RunResult>));
        expect(result?.machine).toMatchObject({ k: 0, n: 1 });
        expect(result?.agent).toEqual({ k: 0, n: 0 });
        expect(result?.unassigned).toBe(1);
      }
      expect(summary(run(blocks))?.agent).toMatchObject({ k: 1, n: 1 });
    },
  );

  it('still counts a known agent failure when the end state also fails', () => {
    const result = summary(
      run([block(['a'], [{ verdictRef: 'a', disposition: 'agent' }])], {
        endVerdict: 'failure',
      }),
    );
    expect(result?.agent).toMatchObject({ k: 0, n: 1 });
    expect(result?.unassigned).toBe(0);
  });

  it('classifies a block with a missing failure diagnosis as unassigned', () => {
    const result = summary(run([block(['a', 'b'], [{ verdictRef: 'a', disposition: 'setup' }])]));
    expect(result?.blocks).toEqual({
      failing: 1,
      setup: 0,
      agent: 0,
      excluded: 0,
      credited: 0,
      unassigned: 1,
      notRun: 0,
      blocked: 0,
    });
    expect(result?.unassigned).toBe(1);
    expect(
      summary(
        run([
          block(
            ['a', 'b'],
            [
              { verdictRef: 'a', disposition: 'setup' },
              { verdictRef: 'b', disposition: 'agent' },
            ],
          ),
        ]),
      )?.blocks.agent,
    ).toBe(1);
  });

  it.each(['custom', '(block)'])(
    'preserves all versions of %s across blocks and runs, deduplicating identical versions',
    (id) => {
      // A shared short prefix must not make two distinct rule versions indistinguishable.
      const first = { kind: 'policy/blame', id, hash: '01234567aaaaaaaa' };
      const second = { kind: 'policy/blame', id, hash: '01234567bbbbbbbb' };
      const a = block([], [], [first]);
      const b = block([], [], [second]);
      const expected = [`policy/blame:${id}@${first.hash}`, `policy/blame:${id}@${second.hash}`];
      expect(nonDefaultOf(run([a, b, a]))).toEqual(expected);
      expect(summary(run([a]), run([b]), run([a]))?.nonDefault).toEqual(expected);
      expect(
        attributionOf({ runs: [run([b])] } as unknown as CampaignData, { fixes: [], objects: [first] })
          ?.nonDefault,
      ).toEqual(expected);
    },
  );

  it('states the two denominators: all completed machine runs; unassigned excluded only from agent rate', () => {
    const result = summary(
      run([block([])]),
      run([block(['a'], [{ verdictRef: 'a', disposition: 'credited' }])]),
      run([block(['a'])]),
      run([block([])], { status: 'stopped' }),
    );
    expect(result?.machine).toMatchObject({ k: 1, n: 3 });
    expect(result?.agent).toMatchObject({ k: 2, n: 2 });
    expect(result?.unassigned).toBe(1);
    for (const rendered of [attributionZone(result), attributionText(result).join('\n')]) {
      expect(rendered).toContain('runs that passed or failed');
      expect(rendered).toContain('excluded from the agent-attributed rate');
      expect(rendered).not.toContain('neither rate');
    }
  });
});
