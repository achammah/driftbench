import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evidence } from '../../src';
import type { Observed, Verdict } from '../../src/schema/run';

/**
 * One fixture run per evidence name, with its expected value (build plan, B1). Each input is constructed from
 * the worked cases of codeagent_equivalence_blame.md Part F, or read from the Northwind recorded sessions.
 */

const NORTHWIND = new URL('../../../../examples/estates/fixture/', import.meta.url);

function verdict(id: string, over: Partial<Verdict> = {}): Verdict {
  return {
    id,
    kind: 'machine',
    name: id.split('.')[0] ?? id,
    gating: true,
    outcome: 'fail',
    evidence: id,
    ...over,
  };
}

function observed(over: Partial<Observed> = {}): Observed {
  return { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0, ...over };
}

function input(
  over: Partial<evidence.EvidenceInput> & { observed?: Partial<Observed> },
): evidence.EvidenceInput {
  const { observed: obs, ...rest } = over;
  const v = rest.verdict ?? verdict('tools.coverage.check.input.address');
  return { block: { observed: observed(obs), verdicts: [v] }, verdict: v, ...rest };
}

const one = (name: string, given: evidence.EvidenceInput) => evidence.computeEvidence(given, [name])[name];

/** Atoms of the Northwind map, as `approved.yaml` holds them (copied, one per kind the tests need). */
const CURRENCY_POINTER: evidence.RuleAtom = {
  id: 'reference.invoice-reconcile.read-references-currency-table-md',
  kind: 'reference',
  provenance: { file: '.claude/skills/invoice-reconcile/SKILL.md', startLine: 10 },
  situation:
    '2. When the invoice is not in EUR, read `references/currency-table.md` to convert every amount.',
  evidence: [
    {
      type: 'tool_called',
      label: 'Read',
      input: { file_path: { contains: '.claude/skills/invoice-reconcile/references/currency-table.md' } },
    },
  ],
  fields: {
    path: '.claude/skills/invoice-reconcile/references/currency-table.md',
    exists: true,
    from: '.claude/skills/invoice-reconcile/SKILL.md',
  },
};
const KPI_POINTER: evidence.RuleAtom = {
  id: 'reference.weekly-report.read-references-kpi-definitions-md',
  kind: 'reference',
  provenance: { file: '.claude/skills/weekly-report/SKILL.md', startLine: 12 },
  fields: {
    path: '.claude/skills/weekly-report/references/kpi-definitions.md',
    exists: false,
    from: '.claude/skills/weekly-report/SKILL.md',
  },
};
const LATE_RULE: evidence.RuleAtom = {
  id: 'instruction.shipment-tracker.late-means-past-the-promised-date',
  kind: 'instruction',
  provenance: { file: '.claude/skills/shipment-tracker/SKILL.md', startLine: 17 },
  evidence: [{ type: 'custom', name: 'grounded_values' }],
};
const READ_BEFORE_EDIT: evidence.RuleAtom = {
  id: 'gate.standing.read-a-file-before-editing-it',
  kind: 'gate',
  provenance: { file: 'CLAUDE.md', startLine: 20 },
  evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }],
  enforcement: ['guard.settings.pretooluse-edit-write-guard-read-before'],
};
const READ_BEFORE_EDIT_GUARD: evidence.RuleAtom = {
  id: 'guard.settings.pretooluse-edit-write-guard-read-before',
  kind: 'guard',
  provenance: { file: '.claude/settings.json', startLine: 26 },
  evidence: [{ type: 'guard', name: 'read-before-edit.py', verdict: 'deny' }],
  fields: { name: 'read-before-edit.py', script: '.claude/guards/read-before-edit.py' },
};
const WEEKLY_SKILL: evidence.RuleAtom = {
  id: 'skill.weekly-report.skill-weekly-report',
  kind: 'skill',
  provenance: { file: '.claude/skills/weekly-report/SKILL.md', startLine: 2 },
  evidence: [{ type: 'skill_loaded', name: 'weekly-report' }],
  fields: { name: 'weekly-report' },
};

function decisions(session: string): evidence.GuardDecision[] {
  return readFileSync(new URL(`sessions/${session}.decisions.jsonl`, NORTHWIND), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as evidence.GuardDecision);
}

const address = (value: string, over: Partial<evidence.ValueFact> = {}): evidence.ValueFact => ({
  tool: 'coverage.check',
  field: 'address',
  call: 0,
  value,
  gold: '88 Summit Avenue, Acmeville',
  ...over,
});

const cases: Array<{ name: string; given: evidence.EvidenceInput; want: unknown; why: string }> = [
  {
    name: 'source',
    why: 'the value is in the user turn',
    given: input({
      user: 'My street address is 88 Summit Ave, Acmeville',
      values: [address('88 Summit Ave, Acmeville')],
    }),
    want: 'user',
  },
  {
    name: 'source',
    why: 'the value is only in a workspace file the agent read',
    given: input({
      user: 'Reconcile INV-1004.',
      values: [{ value: 'FK-BOWL-16', tool: 'Write' }],
      observed: {
        toolCalls: [
          {
            label: 'Read',
            input: { file_path: 'invoices/INV-1004.json' },
            output: '{"article":"FK-BOWL-16"}',
          },
        ],
      },
    }),
    want: 'workspace_file',
  },
  {
    name: 'change',
    why: 'case differs from the user turn',
    given: input({ user: 'is home internet available at 3 orchard way', values: [address('3 Orchard Way')] }),
    want: 'case_only',
  },
  {
    name: 'change',
    why: 'the as-given rung read a unit conversion',
    given: input({ user: 'a 1024 MB allowance', values: [{ value: '1 GB', change: 'unit_converted' }] }),
    want: 'unit_converted',
  },
  {
    name: 'contract',
    why: 'nothing states a format for the address',
    given: input({ user: '88 Summit Ave', values: [address('88 Summit Ave')] }),
    want: 'none',
  },
  {
    name: 'contract',
    why: 'the tool schema states a pattern',
    given: input({
      values: [{ tool: 'port.check', field: 'number', value: '2025550150' }],
      toolSchemas: { 'port.check': { properties: { number: { type: 'string', pattern: '^\\+1\\d{10}$' } } } },
    }),
    want: 'tool',
  },
  {
    name: 'contract',
    why: 'the tool definition is a function-calling wrapper that states an enum',
    given: input({
      values: [{ tool: 'plan.switch', field: 'plan', value: 'premium' }],
      toolSchemas: { 'plan.switch': { parameters: { properties: { plan: { enum: ['basic', 'plus'] } } } } },
    }),
    want: 'tool',
  },
  {
    name: 'outcome',
    why: 'rung 1 found the address unknown',
    given: input({
      values: [address('88 Summit Ave, Acmeville', { rung: 'rung1', settles: 'fail', outcome: 'failed' })],
    }),
    want: 'failed',
  },
  {
    name: 'outcome',
    why: 'the judge rung settled the same referent',
    given: input({ values: [{ value: '202.555.0131', rung: 'rung3', settles: 'pass' }] }),
    want: 'accepted_as_gold',
  },
  {
    name: 'next_action',
    why: 'the reply asks the customer again',
    given: input({
      values: [address('88 Summit Ave, Acmeville', { outcome: 'failed' })],
      observed: {
        text: "I couldn't find that address. Could you give the street number, street name and town again?",
        toolCalls: [
          {
            label: 'coverage.check',
            input: { address: '88 Summit Ave, Acmeville' },
            output: { found: false },
          },
        ],
      },
    }),
    want: 'asked_user',
  },
  {
    name: 'next_action',
    why: 'the agent called the same tool again with a corrected value',
    given: input({
      values: [address('88 Summit Ave, Acmeville', { outcome: 'failed' })],
      observed: {
        toolCalls: [
          {
            label: 'coverage.check',
            input: { address: '88 Summit Ave, Acmeville' },
            output: { found: false },
          },
          {
            label: 'coverage.check',
            input: { address: '88 Summit Avenue, Acmeville' },
            output: { found: true },
          },
        ],
      },
    }),
    want: 'retried_canonical',
  },
  {
    name: 'declared_format',
    why: 'the formula check demands one string',
    given: input({
      verdict: verdict('artifacts.formula'),
      values: [{ value: '=12*C2', demanded: '^=C2\\s*\\*\\s*12$' }],
    }),
    want: '^=C2\\s*\\*\\s*12$',
  },
  {
    name: 'downstream_need',
    why: 'no consumer is declared',
    given: input({}),
    want: 'none',
  },
  {
    name: 'downstream_need',
    why: 'the block declares a consumer of this tool and argument',
    given: input({
      values: [address('88 Summit Ave')],
      expect: { downstream: [{ tool: 'coverage.check', field: 'address', needs: 'full street type' }] },
    }),
    want: 'declared',
  },
  {
    name: 'downstream_need',
    why: 'the declared consumer reads another argument',
    given: input({
      values: [address('88 Summit Ave')],
      expect: { downstream: [{ tool: 'coverage.check', field: 'phone', needs: 'e164' }] },
    }),
    want: 'none',
  },
  {
    name: 'downstream_need',
    why: 'a project declares a consumer of every argument of the tool',
    given: input({
      values: [address('88 Summit Ave')],
      downstreamConsumers: [{ tool: 'coverage.check', needs: 'full street type' }],
    }),
    want: 'declared',
  },
  {
    name: 'task_impossible',
    why: 'the block declares the task impossible',
    given: input({ expect: { taskImpossible: true } }),
    want: true,
  },
  {
    name: 'rule_home',
    why: 'the rule lives in a reference file',
    given: input({
      verdict: verdict('custom.read.currency'),
      ruleAtoms: [CURRENCY_POINTER.id],
      atoms: [CURRENCY_POINTER],
    }),
    want: 'skill_reference',
  },
  {
    name: 'rule_home',
    why: 'the gate lives in the core prompt',
    given: input({
      verdict: verdict('custom.ordered.Read.Edit'),
      ruleAtoms: [READ_BEFORE_EDIT.id],
      atoms: [READ_BEFORE_EDIT],
    }),
    want: 'core',
  },
  {
    name: 'rule_skill',
    why: 'the provenance path names the skill',
    given: input({
      verdict: verdict('custom.grounded_values'),
      ruleAtoms: [LATE_RULE.id],
      atoms: [LATE_RULE],
    }),
    want: 'shipment-tracker',
  },
  {
    name: 'rule_act',
    why: 'an ordered pair',
    given: input({
      verdict: verdict('custom.ordered.Read.Edit'),
      ruleAtoms: [READ_BEFORE_EDIT.id],
      atoms: [READ_BEFORE_EDIT],
    }),
    want: 'ordered',
  },
  {
    name: 'act_signature',
    why: 'the ordered pair with its acts, never a skill or a file',
    given: input({
      verdict: verdict('custom.ordered.Read.Edit'),
      ruleAtoms: [READ_BEFORE_EDIT.id],
      atoms: [READ_BEFORE_EDIT],
    }),
    want: 'ordered:Read>Edit',
  },
  {
    name: 'routed_skills',
    why: 'expect.skills',
    given: input({ verdict: verdict('skills.weekly-report'), expect: { skills: ['weekly-report'] } }),
    want: ['weekly-report'],
  },
  {
    name: 'skill_loaded',
    why: 'no load and no Read of the SKILL.md',
    given: input({
      verdict: verdict('skills.weekly-report'),
      expect: { skills: ['weekly-report'] },
      observed: {
        toolCalls: [{ label: 'Read', input: { file_path: '/work/northwind/reports/2026-W41.md' } }],
      },
    }),
    want: false,
  },
  {
    name: 'skill_loaded',
    why: 'a Read of the SKILL.md counts as a load',
    given: input({
      verdict: verdict('skills.weekly-report'),
      expect: { skills: ['weekly-report'] },
      observed: {
        toolCalls: [
          { label: 'Read', input: { file_path: '/work/northwind/.claude/skills/weekly-report/SKILL.md' } },
        ],
      },
    }),
    want: true,
  },
  {
    name: 'skill_covers',
    why: 'the stored reference agent loaded it in 0 of 3 runs (F5)',
    given: input({ verdict: verdict('skills.weekly-report'), confirm: { runs: 3, reference_loads: 0 } }),
    want: 'not_covered',
  },
  {
    name: 'ref_exists',
    why: 'the kpi definitions file does not exist',
    given: input({ verdict: verdict('custom.read.kpi'), ruleAtoms: [KPI_POINTER.id], atoms: [KPI_POINTER] }),
    want: false,
  },
  {
    name: 'ref_forced',
    why: 'SKILL.md line 10 points to the currency table (F7)',
    given: input({
      verdict: verdict('custom.read.currency'),
      ruleAtoms: [CURRENCY_POINTER.id],
      atoms: [CURRENCY_POINTER],
    }),
    want: true,
  },
  {
    name: 'ref_forced',
    why: 'the pointer was removed: nothing sends the agent to the table (F6)',
    given: input({
      verdict: verdict('custom.convert'),
      ruleAtoms: ['instruction.invoice-reconcile.convert-at-the-table-rate'],
      atoms: [
        {
          id: 'instruction.invoice-reconcile.convert-at-the-table-rate',
          kind: 'instruction',
          provenance: { file: '.claude/skills/invoice-reconcile/references/currency-table.md', startLine: 3 },
        },
      ],
    }),
    want: false,
  },
  {
    name: 'ref_depth',
    why: 'SKILL.md names the file',
    given: input({
      verdict: verdict('custom.read.currency'),
      ruleAtoms: [CURRENCY_POINTER.id],
      atoms: [CURRENCY_POINTER],
    }),
    want: 1,
  },
  {
    name: 'ref_read',
    why: 'a Read with offset and limit is a partial read',
    given: input({
      verdict: verdict('custom.read.currency'),
      ruleAtoms: [CURRENCY_POINTER.id],
      atoms: [CURRENCY_POINTER],
      observed: {
        toolCalls: [
          {
            label: 'Read',
            input: {
              file_path: '/work/northwind/.claude/skills/invoice-reconcile/references/currency-table.md',
              offset: 1,
              limit: 3,
            },
          },
        ],
      },
    }),
    want: 'partial',
  },
  {
    name: 'ref_read',
    why: 'no read of the file',
    given: input({
      verdict: verdict('custom.read.currency'),
      ruleAtoms: [CURRENCY_POINTER.id],
      atoms: [CURRENCY_POINTER],
    }),
    want: 'none',
  },
  {
    name: 'guard_caught',
    why: 'the recorded session weekly-gate-violated: read-before-edit.py denies, then allows',
    given: input({
      verdict: verdict('custom.ordered.Read.Edit'),
      ruleAtoms: [READ_BEFORE_EDIT.id],
      atoms: [READ_BEFORE_EDIT, READ_BEFORE_EDIT_GUARD],
      decisions: decisions('weekly-gate-violated'),
    }),
    want: true,
  },
  {
    name: 'guard_caught',
    why: 'the recorded clean session has no deny',
    given: input({
      verdict: verdict('custom.ordered.Read.Edit'),
      ruleAtoms: [READ_BEFORE_EDIT.id],
      atoms: [READ_BEFORE_EDIT, READ_BEFORE_EDIT_GUARD],
      decisions: decisions('weekly-clean'),
    }),
    want: false,
  },
  {
    name: 'tool_failed',
    why: 'the call returned an error',
    given: input({
      verdict: verdict('tools.port.check.input.number'),
      observed: {
        toolCalls: [{ label: 'port.check', input: { number: '2025550150' }, error: 'invalid number' }],
      },
    }),
    want: true,
  },
  {
    name: 'tool_silent',
    why: 'reconcile.py printed nothing and exited 0 (F3, defect 1)',
    given: input({
      verdict: verdict('text.summary'),
      promises: [
        { tool: 'reconcile.py', prints: true, from: 'reconcile.py docstring: Prints one line per article' },
      ],
      observed: {
        executions: [
          { command: 'python3 scripts/reconcile.py INV-1004.json PO-2004.json', exitCode: 0, stdout: '' },
        ],
      },
    }),
    want: true,
  },
  {
    name: 'tool_output_wrong',
    why: 'the agent copied the script line that contradicts the rounding rule (F3, defect 2)',
    given: input({
      verdict: verdict('text.reconcile'),
      values: [{ value: 'FK-BOWL-16: over 0.72 EUR', gold: 'FK-BOWL-16: rounding', outcome: 'failed' }],
      observed: {
        executions: [
          {
            command: 'python3 scripts/reconcile.py inv.csv po.csv',
            exitCode: 1,
            stdout: 'FK-BOWL-16: over 0.72 EUR\n',
          },
        ],
      },
    }),
    want: true,
  },
  {
    name: 'tool_output_wrong',
    why: "a user value the tool echoed back is the user's, not the tool's",
    given: input({
      user: 'My street address is 88 Summit Ave, Acmeville',
      values: [address('88 Summit Ave, Acmeville', { outcome: 'failed' })],
      observed: {
        toolCalls: [
          {
            label: 'coverage.check',
            input: { address: '88 Summit Ave, Acmeville' },
            output: { found: false, address: '88 Summit Ave, Acmeville' },
          },
        ],
      },
    }),
    want: false,
  },
  {
    name: 'env_error',
    why: 'pip cannot reach the index (F2)',
    given: input({
      verdict: verdict('artifacts.price-sheet'),
      observed: {
        executions: [
          {
            command: 'pip install openpyxl',
            exitCode: 1,
            stderr:
              "WARNING: Retrying (Retry(total=4)) after connection broken by 'NewConnectionError: Failed to establish a new connection: [Errno -3] Temporary failure in name resolution'\nERROR: Could not find a version that satisfies the requirement openpyxl",
          },
        ],
      },
    }),
    want: 'network',
  },
  {
    name: 'env_error',
    why: 'nothing in the errors names the environment',
    given: input({
      observed: {
        executions: [
          { command: 'python3 build.py', exitCode: 1, stderr: 'ZeroDivisionError: division by zero' },
        ],
      },
    }),
    want: 'none',
  },
  {
    name: 'protected_changed',
    why: 'a provided test was edited',
    given: input({
      expect: { protected: ['tests/**'] },
      observed: { workspaceDiff: { created: [], changed: ['tests/test_price.py'], deleted: [] } },
    }),
    want: true,
  },
  {
    name: 'tests_fail_reverted',
    why: 'the stored re-execution with the test edits reverted fails',
    given: input({ testsFailReverted: true }),
    want: true,
  },
  {
    name: 'changed_inputs_fail',
    why: 'a hard-coded number passes on the seed and fails on changed inputs',
    given: input({ values: [{ value: '=300', rung: 'rung1_recompute', changedInputsFail: true }] }),
    want: true,
  },
  {
    name: 'claim_contradicted',
    why: 'the reply says the sheet is saved; the xlsx check failed (F2 contrast)',
    given: {
      ...input({
        observed: {
          text: 'Done: the price sheet is saved.',
          workspaceDiff: { created: ['out/acme-price-sheet.csv'], changed: [], deleted: [] },
        },
      }),
      block: {
        observed: observed({
          text: 'Done: the price sheet is saved.',
          workspaceDiff: { created: ['out/acme-price-sheet.csv'], changed: [], deleted: [] },
        }),
        verdicts: [verdict('artifacts.out/acme-price-sheet.xlsx', { name: 'artifacts' })],
      },
      verdict: verdict('artifacts.out/acme-price-sheet.xlsx', { name: 'artifacts' }),
    },
    want: true,
  },
  {
    name: 'claim_contradicted',
    why: 'the reply says the tests pass; the last pytest run exited 1',
    given: input({
      observed: {
        text: 'All tests pass now.',
        executions: [{ command: 'pytest -q', exitCode: 1, stdout: '1 failed' }],
      },
    }),
    want: true,
  },
  {
    name: 'stricter_rule_obeyed',
    why: 'no coverage_check call; the reply asks for the town, which only the prompt demands (R6)',
    given: input({
      verdict: verdict('tools.coverage.check.count'),
      stated: [
        {
          tool: 'coverage.check',
          field: 'address',
          where: 'prompt',
          asks: ['street_number', 'street_name', 'town'],
          toolNeeds: ['street_number', 'street_name'],
        },
      ],
      reply: { next_action: 'asked_user', asked_for: ['town'] },
    }),
    want: true,
  },
  {
    name: 'recurrence_homes',
    why: 'the same item and act in two skills, two runs each (F7)',
    given: input({
      attributed: { item: 'skill_reference_forced_unread', act: 'read_reference', home: 'invoice-reconcile' },
      minRunsPerHome: 2,
      history: [
        { item: 'skill_reference_forced_unread', act: 'read_reference', home: 'invoice-reconcile' },
        { item: 'skill_reference_forced_unread', act: 'read_reference', home: 'supplier-email' },
        { item: 'skill_reference_forced_unread', act: 'read_reference', home: 'supplier-email' },
      ],
    }),
    want: 2,
  },
  {
    name: 'recurrence_homes',
    why: 'no history: the current home alone',
    given: input({ attributed: { item: 'R7', act: 'stage', home: 'weekly-report' } }),
    want: 1,
  },
  {
    name: 'rule_needed_by',
    why: 'late is needed by weekly-report, shipment-tracker and the core rule R7 (F8b)',
    given: input({
      verdict: verdict('custom.grounded_values'),
      expect: { skills: ['weekly-report'] },
      ruleAtoms: [LATE_RULE.id],
      atoms: [
        LATE_RULE,
        {
          id: 'instruction.standing.r7-late',
          kind: 'instruction',
          provenance: { file: 'CLAUDE.md', startLine: 15 },
        },
      ],
      edges: [{ from: 'instruction.standing.r7-late', to: LATE_RULE.id, kind: 'cites' }],
    }),
    want: 3,
  },
  {
    name: 'rule_skill_routed',
    why: 'the rule lives in shipment-tracker; the ask routes to weekly-report',
    given: input({
      verdict: verdict('custom.grounded_values'),
      expect: { skills: ['weekly-report'] },
      ruleAtoms: [LATE_RULE.id],
      atoms: [LATE_RULE],
    }),
    want: false,
  },
  {
    name: 'rule_situational',
    why: "a rule no file states, needed in the block's own situation (F4)",
    given: input({
      verdict: verdict('must.short-delivery'),
      expect: { skills: ['invoice-reconcile'], situation: 'invoice-short-delivery' },
    }),
    want: true,
  },
  {
    name: 'verdict_kind',
    why: 'a machine verdict',
    given: input({}),
    want: 'machine',
  },
  {
    name: 'reference_pass',
    why: 'read only from a stored confirm run',
    given: input({ confirm: { runs: 3, reference_pass: 3 } }),
    want: 3,
  },
  {
    name: 'skill_loaded',
    why: 'the weekly-report skill atom routes the block (F5 recorded session has no load)',
    given: input({
      verdict: verdict('skills.weekly-report'),
      ruleAtoms: [WEEKLY_SKILL.id],
      atoms: [WEEKLY_SKILL],
    }),
    want: false,
  },
];

describe('evidence providers, one fixture and expected value each', () => {
  for (const row of cases) {
    it(`${row.name}: ${row.why}`, () => {
      expect(one(row.name, row.given)).toEqual(row.want);
    });
  }

  it('covers every static name of the build plan', () => {
    const named = new Set(cases.map((row) => row.name));
    for (const name of [
      'source',
      'change',
      'contract',
      'outcome',
      'next_action',
      'declared_format',
      'downstream_need',
      'rule_home',
      'rule_skill',
      'rule_act',
      'routed_skills',
      'skill_loaded',
      'ref_exists',
      'ref_forced',
      'ref_depth',
      'ref_read',
      'guard_caught',
      'tool_failed',
      'tool_silent',
      'tool_output_wrong',
      'env_error',
      'protected_changed',
      'tests_fail_reverted',
      'changed_inputs_fail',
      'claim_contradicted',
      'stricter_rule_obeyed',
      'recurrence_homes',
    ]) {
      expect(named.has(name), name).toBe(true);
      expect(evidence.evidenceRegistry.get(name)?.cost, name).toBe('static');
    }
  });

  it('leaves out a name whose value is unknown, and refuses an unknown name', () => {
    const got = evidence.computeEvidence(input({}));
    expect('reference_pass' in got).toBe(false);
    expect('outcome' in got).toBe(false);
    expect(() => evidence.computeEvidence(input({}), ['no_such_name'])).toThrow(
      /unknown evidence name no_such_name/,
    );
  });

  it('refuses a name registered twice', () => {
    const registry = new evidence.EvidenceRegistry();
    expect(() =>
      registry.register({ name: 'source', cost: 'static', values: [], from: '', compute: () => undefined }),
    ).toThrow(/already registered/);
  });
});
