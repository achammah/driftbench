import { describe, expect, it } from 'vitest';
import { evidence } from '../../src';
import type { ExecutionRecord, Verdict } from '../../src/schema/run';

const verdict: Verdict = {
  id: 'tools.Bash.count',
  name: 'tools',
  kind: 'machine',
  gating: true,
  outcome: 'fail',
  evidence: '',
};
const path = '.claude/skills/billing/SKILL.md';
function input(run: ExecutionRecord): evidence.EvidenceInput {
  return {
    verdict,
    expect: { skills: ['billing'] },
    links: [{ verdict: verdict.id, home: 'skill_body', act: 'read_reference', file: path, skill: 'billing' }],
    block: {
      verdicts: [verdict],
      observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0, executions: [run] },
    },
  };
}
describe('agent launch records are not tool executions', () => {
  it('does not read instructions or source values from the ask or agent stdout', () => {
    const given = input({
      role: 'agent',
      command: `-p say more about ${path}`,
      exitCode: 0,
      stdout: 'sentinel',
    });
    given.values = [{ value: 'sentinel' }];
    const facts = evidence.computeEvidence(given);
    expect(evidence.readAmount(given, path)).toBe('none');
    expect(facts.skill_loaded).toBe(false);
    expect(facts.rule_in_context).toBe(false);
    expect(facts.source).toBeUndefined();
    given.block.observed.executions = [
      { role: 'agent', command: '-p hello', exitCode: 0, stdout: 'sentinel' },
    ];
    expect(evidence.computeEvidence(given).source).toBeUndefined();
  });
  it('does not attach an agent launch failure to a same-command tool call or retry', () => {
    const given = input({ role: 'agent', command: `cat ${path}`, exitCode: 1 });
    const call = { label: 'Bash', input: { command: `cat ${path}` }, output: 'sentinel' };
    given.block.observed.toolCalls = [call, call];
    expect(evidence.callSucceeded(given, call)).toBe(true);
    const facts = evidence.computeEvidence(given);
    expect(facts.tool_failed).toBe(false);
    expect(facts.next_action).toBe('continued');
    given.block.observed.executions = [{ command: `cat ${path}`, exitCode: 1 }];
    expect(evidence.callSucceeded(given, call)).toBe(false);
    expect(evidence.computeEvidence(given).tool_failed).toBe(true);
  });
  it('does not infer silent tools or test results from command words in the ask', () => {
    const given = input({ role: 'agent', command: '-p run reconcile and pytest', exitCode: 0 });
    given.promises = [{ tool: 'reconcile', prints: true }];
    expect(evidence.computeEvidence(given).tool_silent).toBe(false);
    given.block.observed.executions = [{ command: 'reconcile', exitCode: 0 }];
    expect(evidence.computeEvidence(given).tool_silent).toBe(true);
    given.block.observed.text = 'All tests passed';
    given.block.observed.executions = [{ role: 'agent', command: '-p run pytest', exitCode: 1 }];
    expect(evidence.computeEvidence(given).claim_contradicted).toBe(false);
    given.block.observed.executions = [{ command: 'pytest', exitCode: 1 }];
    expect(evidence.computeEvidence(given).claim_contradicted).toBe(true);
  });
  it('keeps real agent-process environment errors, without interpreting the ask as stderr', () => {
    const given = input({ role: 'agent', command: '-p explain ENOTFOUND', exitCode: 0 });
    expect(evidence.computeEvidence(given).env_error).toBe('none');
    given.block.observed.executions = [
      { role: 'agent', command: '-p hello', exitCode: 1, stderr: 'ENOTFOUND api.example' },
    ];
    expect(evidence.computeEvidence(given).env_error).toBe('network');
  });
});
