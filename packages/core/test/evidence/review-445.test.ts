import { describe, expect, it } from 'vitest';
import { evidence } from '../../src';
import type { Observed, Verdict } from '../../src/schema/run';

/**
 * The six findings of the PR 445 review, one red-first case each: a failed read reads nothing; a named tool's
 * nonzero exit is a failure; the plan row decides skill coverage before a confirm count; a pointer forces only in
 * its situation; first_violation exists; every provider runs once per chain root.
 */

const TABLE = '.claude/skills/invoice-reconcile/references/currency-table.md';

function verdict(id: string): Verdict {
  return { id, kind: 'machine', name: id.split('.')[0] ?? id, gating: true, outcome: 'fail', evidence: id };
}

function input(
  over: Partial<evidence.EvidenceInput> & { observed?: Partial<Observed>; verdicts?: Verdict[] },
): evidence.EvidenceInput {
  const { observed, verdicts, ...rest } = over;
  const v = rest.verdict ?? verdict('custom.currency_rate');
  return {
    block: {
      observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0, ...observed },
      verdicts: verdicts ?? [v],
    },
    verdict: v,
    ...rest,
  };
}

const pointer = (situation?: string): evidence.RuleAtom => ({
  id: 'reference.invoice-reconcile.read-references-currency-table-md',
  kind: 'reference',
  provenance: { file: '.claude/skills/invoice-reconcile/SKILL.md', startLine: 10 },
  ...(situation === undefined ? {} : { situation }),
  fields: { path: TABLE, exists: true, from: '.claude/skills/invoice-reconcile/SKILL.md' },
});

const rule: evidence.RuleAtom = {
  id: 'instruction.invoice-reconcile.convert-at-the-table-rate',
  kind: 'instruction',
  provenance: { file: TABLE, startLine: 3 },
};

const one = (name: string, given: evidence.EvidenceInput) => evidence.computeEvidence(given, [name])[name];

describe('finding 1: a failed read reads nothing', () => {
  it('a cat that exited 1 is no read', () => {
    const command = `cat ${TABLE}`;
    const given = input({
      ruleAtoms: [rule.id],
      atoms: [rule, pointer()],
      observed: {
        toolCalls: [{ label: 'Bash', input: { command }, output: 'cat: No such file or directory' }],
        executions: [{ command, exitCode: 1, stderr: 'cat: No such file or directory' }],
      },
    });
    expect(one('ref_read', given)).toBe('none');
  });

  it('a Read that returned an error is no read; a cat that exited 0 is a full read', () => {
    const failed = input({
      ruleAtoms: [rule.id],
      atoms: [rule],
      observed: { toolCalls: [{ label: 'Read', input: { file_path: `/work/${TABLE}` }, error: 'EACCES' }] },
    });
    expect(one('ref_read', failed)).toBe('none');
    const command = `cat ${TABLE}`;
    const ok = input({
      ruleAtoms: [rule.id],
      atoms: [rule],
      observed: {
        toolCalls: [{ label: 'Bash', input: { command } }],
        executions: [{ command, exitCode: 0 }],
      },
    });
    expect(one('ref_read', ok)).toBe('full');
  });
});

describe('finding 2: a named tool that exits nonzero failed', () => {
  it('a Bash call whose output reports exit 1', () => {
    const given = input({
      verdict: verdict('tools.Bash.count'),
      observed: {
        toolCalls: [
          { label: 'Bash', input: { command: 'python3 build.py' }, output: { exitCode: 1, stdout: '' } },
        ],
      },
    });
    expect(one('tool_failed', given)).toBe(true);
  });

  it('a Bash call whose recorded execution exited 1', () => {
    const given = input({
      verdict: verdict('tools.Bash.count'),
      observed: {
        toolCalls: [{ label: 'Bash', input: { command: 'python3 build.py' }, output: 'Traceback' }],
        executions: [{ command: 'python3 build.py', exitCode: 1 }],
      },
    });
    expect(one('tool_failed', given)).toBe(true);
  });
});

describe('finding 3: the plan row decides coverage before a confirm count', () => {
  const skills = input({ verdict: verdict('skills.weekly-report'), expect: { skills: ['weekly-report'] } });
  const row = (testType: string) => ({
    atomIds: ['route.weekly-report.an-ask-that-fits-weekly-report'],
    testType,
  });

  it('route_near_miss is not covered', () => {
    expect(one('skill_covers', { ...skills, planRows: [row('route_near_miss')] })).toBe('not_covered');
  });

  it('route_positive is covered, whatever a confirm count says', () => {
    expect(
      one('skill_covers', {
        ...skills,
        planRows: [row('route_positive')],
        confirm: { runs: 3, reference_loads: 0 },
      }),
    ).toBe('covered');
  });

  it('with no plan row, the confirm count decides', () => {
    expect(one('skill_covers', { ...skills, confirm: { runs: 3, reference_loads: 0 } })).toBe('not_covered');
    expect(one('skill_covers', skills)).toBe('unknown');
  });
});

describe('finding 4: a pointer forces only in its situation', () => {
  const situation =
    'When the invoice is not in EUR, read `references/currency-table.md` to convert every amount.';

  it('does not force outside its situation', () => {
    const given = input({
      ruleAtoms: [rule.id],
      atoms: [rule, pointer(situation)],
      expect: { situation: 'invoice-eur' },
    });
    expect(one('ref_forced', given)).toBe(false);
  });

  it('forces when the block is in its situation, or when it names none', () => {
    const inSituation = input({
      ruleAtoms: [rule.id],
      atoms: [rule, pointer(situation)],
      expect: { situation: 'invoice-usd', situationAtoms: [pointer().id] },
    });
    expect(one('ref_forced', inSituation)).toBe(true);
    expect(one('ref_forced', input({ ruleAtoms: [rule.id], atoms: [rule, pointer()] }))).toBe(true);
    expect(
      one('ref_forced', input({ ruleAtoms: [pointer(situation).id], atoms: [pointer(situation)] })),
    ).toBe(true);
  });
});

describe('finding 5: first_violation', () => {
  it('is the earliest failing gating verdict by the place of its act in the trace', () => {
    const later = verdict('tools.catalog.search.count');
    const earlier = verdict('tools.coverage.check.input.address');
    const passing = { ...verdict('tools.order'), outcome: 'pass' as const };
    const given = input({
      verdict: later,
      verdicts: [later, passing, earlier],
      observed: {
        toolCalls: [
          { label: 'coverage.check', input: { address: '88 Summit Ave' }, output: { found: false } },
        ],
      },
    });
    expect(one('first_violation', given)).toBe('tools.coverage.check.input.address');
    expect(evidence.evidenceRegistry.get('first_violation')?.cost).toBe('static');
  });
});

describe('finding 6: each provider runs once per chain root', () => {
  /**
   * Counts every call of every shipped provider by patching the shared provider objects themselves, so a
   * provider that calls another one directly is counted too. Restored after the call.
   */
  function counting<T>(run: () => T): { result: T; calls: Map<string, number> } {
    const calls = new Map<string, number>();
    const saved = evidence.EVIDENCE_PROVIDERS.map((provider) => ({
      provider,
      compute: provider.compute,
      derive: provider.derive,
    }));
    for (const { provider, compute, derive } of saved) {
      const bump = () => calls.set(provider.name, (calls.get(provider.name) ?? 0) + 1);
      const target = provider as evidence.EvidenceProvider;
      if (compute) {
        target.compute = (given) => {
          bump();
          return compute(given);
        };
      }
      if (derive) {
        target.derive = (known) => {
          bump();
          return derive(known);
        };
      }
    }
    try {
      return { result: run(), calls };
    } finally {
      for (const { provider, compute, derive } of saved) {
        const target = provider as evidence.EvidenceProvider;
        if (compute) target.compute = compute;
        if (derive) target.derive = derive;
      }
    }
  }

  const given = input({
    verdict: verdict('custom.read.currency'),
    expect: { skills: ['invoice-reconcile'] },
    ruleAtoms: [pointer().id],
    atoms: [pointer()],
    observed: {
      toolCalls: [{ label: 'Read', input: { file_path: '/work/.claude/skills/invoice-reconcile/SKILL.md' } }],
    },
  });

  it('computes every name once in one evidence step', () => {
    const { result: values, calls } = counting(() => evidence.computeEvidence(given));
    expect(values.rule_in_context).toBe(false);
    expect(values.rule_skill_routed).toBe(true);
    for (const provider of evidence.EVIDENCE_PROVIDERS)
      expect(calls.get(provider.name), provider.name).toBe(1);
  });

  it('computes a derived name from the names it reads, each once, and nothing else', () => {
    const { calls } = counting(() =>
      evidence.computeEvidence(given, ['rule_in_context', 'rule_skill_routed']),
    );
    expect(Object.fromEntries(calls)).toEqual({
      rule_in_context: 1,
      rule_home: 1,
      skill_loaded: 1,
      ref_read: 1,
      rule_skill_routed: 1,
      rule_skill: 1,
      routed_skills: 1,
    });
  });

  it('refuses a provider with neither compute nor derive', () => {
    expect(
      () => new evidence.EvidenceRegistry([{ name: 'x', cost: 'static', values: [], from: '' }]),
    ).toThrow(/either compute or derive/);
  });
});

describe('second review at 3b063ab09', () => {
  it('(a) first_violation counts only a fail: a not_applicable verdict is no violation', () => {
    const skipped = { ...verdict('tools.coverage.check.input.address'), outcome: 'not_applicable' as const };
    const failing = verdict('tools.catalog.search.count');
    const given = input({
      verdict: failing,
      verdicts: [skipped, failing],
      observed: {
        toolCalls: [
          { label: 'coverage.check', input: { address: '88 Summit Ave' }, output: { found: true } },
        ],
      },
    });
    expect(one('first_violation', given)).toBe('tools.catalog.search.count');
  });

  it('(b) a failed Read of SKILL.md loads no skill and puts no skill rule in context', () => {
    const atom: evidence.RuleAtom = {
      id: 'instruction.weekly-report.save-the-report-by-week',
      kind: 'instruction',
      provenance: { file: '.claude/skills/weekly-report/SKILL.md', startLine: 14 },
    };
    const read = (over: { error?: string; output?: unknown }) =>
      input({
        verdict: verdict('custom.save_path'),
        expect: { skills: ['weekly-report'] },
        ruleAtoms: [atom.id],
        atoms: [atom],
        observed: {
          toolCalls: [
            { label: 'Read', input: { file_path: '/work/.claude/skills/weekly-report/SKILL.md' }, ...over },
          ],
        },
      });
    for (const failed of [read({ error: 'ENOENT: no such file' }), read({ output: { is_error: true } })]) {
      expect(one('skill_loaded', failed)).toBe(false);
      expect(one('rule_in_context', failed)).toBe(false);
    }
    expect(one('skill_loaded', read({ output: '# weekly-report' }))).toBe(true);
    expect(one('rule_in_context', read({ output: '# weekly-report' }))).toBe(true);
    const skill = input({
      verdict: verdict('skills.weekly-report'),
      observed: {
        toolCalls: [{ label: 'Skill', input: { skill: 'weekly-report' }, error: 'unknown skill' }],
      },
    });
    expect(one('skill_loaded', skill)).toBe(false);
  });

  it('(b) a failed Read of a workspace file is no source of a value', () => {
    const given = input({
      user: 'Reconcile INV-1004.',
      values: [{ value: 'FK-BOWL-16', tool: 'Write' }],
      observed: {
        toolCalls: [
          {
            label: 'Read',
            input: { file_path: 'invoices/INV-1004.json' },
            output: { is_error: true, content: 'permission denied reading FK-BOWL-16' },
          },
        ],
      },
    });
    expect(one('source', given)).not.toBe('workspace_file');
  });

  it('(c) an HTTP status is not an exit code: 200 succeeds, 500 fails, an exit code 2 fails, a bare code is neither', () => {
    const call = (output: unknown) =>
      input({
        verdict: verdict('tools.http.request.count'),
        observed: { toolCalls: [{ label: 'http.request', input: { url: 'https://example.com' }, output }] },
      });
    expect(one('tool_failed', call({ status: 200, body: 'ok', code: 200 }))).toBe(false);
    expect(one('tool_failed', call({ statusCode: 302 }))).toBe(false);
    expect(one('tool_failed', call({ status: 500 }))).toBe(true);
    expect(one('tool_failed', call({ status_code: 404 }))).toBe(true);
    expect(one('tool_failed', call({ exit_code: 2 }))).toBe(true);
    expect(one('tool_failed', call({ code: 1 }))).toBe(false);
  });
});
