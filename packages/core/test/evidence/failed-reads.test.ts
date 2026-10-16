import { describe, expect, it } from 'vitest';
import { evidence } from '../../src';
import type { Observed, Verdict } from '../../src/schema/run';

const verdict: Verdict = {
  id: 'tools.fetch.count',
  name: 'tools',
  kind: 'machine',
  gating: true,
  outcome: 'fail',
  evidence: '',
};
function input(observed: Partial<Observed> = {}): evidence.EvidenceInput {
  return {
    verdict,
    block: {
      verdicts: [verdict],
      observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0, ...observed },
    },
  };
}

const skill = '.claude/skills/billing/SKILL.md';
const reference = '.claude/skills/billing/references/rates.md';
function reading(path: string, observed: Partial<Observed>): evidence.EvidenceInput {
  return {
    ...input(observed),
    expect: { skills: ['billing'] },
    links: [
      {
        verdict: verdict.id,
        home: path === skill ? 'skill_body' : 'skill_reference',
        act: 'read_reference',
        file: path,
        skill: 'billing',
      },
    ],
  };
}
const failures = [{ error: 'EACCES' }, { output: { is_error: true } }, { output: { exitCode: 1 } }];
describe('failed reads contribute no loaded instructions or source values', () => {
  it.each(failures)('Read SKILL.md fails: %j', (failure) => {
    const given = reading(skill, { toolCalls: [{ label: 'Read', input: { file_path: skill }, ...failure }] });
    const got = evidence.computeEvidence(given);
    expect(got.skill_loaded).toBe(false);
    expect(got.rule_in_context).toBe(false);
  });
  it('a failed Skill call cannot be rescued by its runtime summary', () => {
    const given = reading(skill, {
      toolCalls: [{ label: 'Skill', input: { skill: 'billing' }, error: 'missing' }],
      runtime: { skills: [{ name: 'billing' }] },
    });
    expect(evidence.computeEvidence(given).skill_loaded).toBe(false);
  });
  it.each(['cat', 'less', 'more', 'bat', 'head', 'tail', "sed -n '1,5p'", 'awk NR<5', 'grep rate'])(
    '%s uses the execution result on both read consumers',
    (command) => {
      for (const path of [skill, reference]) {
        const cmd = `${command} ${path}`;
        for (const exitCode of [1, 0]) {
          const given = reading(path, {
            toolCalls: [{ label: 'Bash', input: { command: cmd }, output: 'rate-sentinel' }],
            executions: [{ command: cmd, exitCode, stdout: 'rate-sentinel' }],
          });
          given.values = [{ value: 'rate-sentinel' }];
          const got = evidence.computeEvidence(given);
          if (exitCode === 1) {
            expect(evidence.readAmount(given, path)).toBe('none');
            expect(got.skill_loaded).toBe(false);
            expect(got.rule_in_context).toBe(false);
            expect(got.source).toBeUndefined();
          } else {
            expect(evidence.readAmount(given, path)).not.toBe('none');
            expect(got.source).toBe('skill_file');
            if (path === skill && ['cat', 'less', 'more', 'bat'].includes(command))
              expect(got.skill_loaded).toBe(true);
          }
        }
      }
    },
  );
  it.each([skill, reference, 'data/rates.md'])('failed Read of %s contributes no provenance', (path) => {
    const given = reading(path, {
      toolCalls: [{ label: 'Read', input: { path }, output: 'rate-sentinel', error: 'denied' }],
    });
    given.values = [{ value: 'rate-sentinel', gold: 'different' }];
    const got = evidence.computeEvidence(given);
    expect(got.source).toBeUndefined();
    expect(got.change).toBeUndefined();
    expect(got.tool_output_wrong).toBe(false);
  });
  it('a failed Read cannot be upgraded by a reference summary; a later successful retry can', () => {
    const given = reading(reference, {
      toolCalls: [{ label: 'Read', input: { path: reference }, error: 'denied' }],
      runtime: { references: [{ path: reference }] },
    });
    expect(evidence.computeEvidence(given).ref_read).toBe('none');
    given.block.observed.toolCalls.push({
      label: 'Read',
      input: { path: reference },
      output: 'rate-sentinel',
    });
    expect(evidence.computeEvidence(given).ref_read).toBe('full');
  });
  it('a partial Read stays partial even when its runtime reference summary names it', () => {
    const given = reading(reference, {
      toolCalls: [{ label: 'Read', input: { path: reference, limit: 5 } }],
      runtime: { references: [{ path: reference }] },
    });
    expect(evidence.computeEvidence(given).ref_read).toBe('partial');
  });
  it('standalone execution reads and failed custom command tools obey the same rule', () => {
    for (const exitCode of [0, 1]) {
      const given = reading(skill, {
        executions: [{ command: `cat ${skill}`, exitCode, stdout: 'rate-sentinel' }],
      });
      given.values = [{ value: 'rate-sentinel' }];
      const got = evidence.computeEvidence(given);
      expect(got.skill_loaded).toBe(exitCode === 0);
      expect(got.rule_in_context).toBe(exitCode === 0);
      expect(got.source).toBe(exitCode === 0 ? 'skill_file' : undefined);
    }
    const given = reading(skill, {
      toolCalls: [
        {
          label: 'exec_command',
          input: { command: `cat ${skill}` },
          output: { exit_code: 1, stdout: 'rate-sentinel' },
        },
      ],
    });
    given.values = [{ value: 'rate-sentinel' }];
    expect(evidence.computeEvidence(given).skill_loaded).toBe(false);
    expect(evidence.computeEvidence(given).source).toBeUndefined();
  });
  it('runtime-only successful evidence remains supported', () => {
    expect(
      evidence.computeEvidence(reading(skill, { runtime: { skills: [{ name: 'billing' }] } })).skill_loaded,
    ).toBe(true);
    expect(
      evidence.computeEvidence(reading(reference, { runtime: { references: [{ path: reference }] } }))
        .ref_read,
    ).toBe('full');
  });
});
