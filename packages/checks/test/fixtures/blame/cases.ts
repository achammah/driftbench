import type { evidence, Observed, Verdict } from '@agent-nexus/driftbench-core';

/**
 * The worked cases F1 to F9 of codeagent_equivalence_blame.md Part F, as constructed runs with their expected
 * fault, disposition, fix location and placement. Facts are cited there; the runs are constructed (no agent ran),
 * as the note marks them. Atoms are copied from the Northwind map, examples/estates/fixture/approved.yaml.
 */

export function verdict(id: string, over: Partial<Verdict> = {}): Verdict {
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

export function observed(over: Partial<Observed> = {}): Observed {
  return { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0, ...over };
}

export const SKILL = (name: string) => `/work/northwind/.claude/skills/${name}/SKILL.md`;
const readSkill = (name: string) => ({
  label: 'Read',
  input: { file_path: SKILL(name) },
  output: `# ${name}`,
});

export const ATOMS = {
  currencyPointer: {
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
  },
  currencyRule: {
    id: 'instruction.invoice-reconcile.convert-at-the-table-rate',
    kind: 'instruction',
    provenance: { file: '.claude/skills/invoice-reconcile/references/currency-table.md', startLine: 3 },
    evidence: [{ type: 'custom', name: 'currency_rate' }],
  },
  languagesPointer: {
    id: 'reference.supplier-email.read-claude-memory-supplier-languages-md',
    kind: 'reference',
    provenance: { file: '.claude/skills/supplier-email/SKILL.md', startLine: 8 },
    situation: "Write in the supplier's language, as listed in `.claude/memory/supplier-languages.md`.",
    evidence: [
      {
        type: 'tool_called',
        label: 'Read',
        input: { file_path: { contains: '.claude/memory/supplier-languages.md' } },
      },
    ],
    fields: {
      path: '.claude/memory/supplier-languages.md',
      exists: true,
      from: '.claude/skills/supplier-email/SKILL.md',
    },
  },
  matchingGate: {
    id: 'gate.invoice-reconcile.read-references-matching-rules-md-before',
    kind: 'gate',
    provenance: { file: '.claude/skills/invoice-reconcile/SKILL.md', startLine: 9 },
    situation: 'matching any line',
    evidence: [
      {
        type: 'tool_called',
        label: 'Read',
        input: { file_path: { contains: '.claude/skills/invoice-reconcile/references/matching-rules.md' } },
      },
    ],
    fields: { path: '.claude/skills/invoice-reconcile/references/matching-rules.md' },
  },
  rounding: {
    id: 'instruction.invoice-reconcile.under-0-05-eur-per-unit',
    kind: 'instruction',
    provenance: { file: '.claude/skills/invoice-reconcile/references/matching-rules.md', startLine: 4 },
    evidence: [{ type: 'custom', name: 'rounding_rule' }],
  },
  r17: {
    id: 'instruction.standing.report-only-numbers-read-during-the',
    kind: 'instruction',
    provenance: { file: 'CLAUDE.md', startLine: 25 },
    evidence: [{ type: 'custom', name: 'grounded_values' }],
  },
  verifyGate: {
    id: 'gate.standing.never-report-done-before-verify-passed',
    kind: 'gate',
    provenance: { file: 'CLAUDE.md', startLine: 41 },
    evidence: [{ type: 'ordered', before: 'verify', after: 'report' }],
    enforcement: [],
  },
  late: {
    id: 'instruction.shipment-tracker.late-means-past-the-promised-date',
    kind: 'instruction',
    provenance: { file: '.claude/skills/shipment-tracker/SKILL.md', startLine: 17 },
    evidence: [{ type: 'custom', name: 'grounded_values' }],
  },
  r7Late: {
    id: 'instruction.standing.r7-uses-late',
    kind: 'instruction',
    provenance: { file: 'CLAUDE.md', startLine: 15 },
    evidence: [{ type: 'custom', name: 'late_rule' }],
  },
  readBeforeEdit: {
    id: 'gate.standing.read-a-file-before-editing-it',
    kind: 'gate',
    provenance: { file: 'CLAUDE.md', startLine: 11 },
    evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }],
    enforcement: ['guard.settings.pretooluse-edit-write-guard-read-before'],
  },
  readBeforeEditGuard: {
    id: 'guard.settings.pretooluse-edit-write-guard-read-before',
    kind: 'guard',
    provenance: { file: '.claude/settings.json', startLine: 26 },
    evidence: [{ type: 'guard', name: 'read-before-edit.py', verdict: 'deny' }],
    fields: { name: 'read-before-edit.py' },
  },
} satisfies Record<string, evidence.RuleAtom>;

export type Expected = {
  item: string;
  fault: string[];
  disposition: string;
  fix_location: string;
  /** The placement item: `fixed`, `cross_cutting`, ... */
  placement: string;
  confidence?: string;
};

export type WorkedCase = {
  name: string;
  /** The failing verdicts of the block, in check order. */
  verdicts: Verdict[];
  /** The evidence input of one verdict. */
  input: (verdict: Verdict) => evidence.EvidenceInput;
  history?: Array<evidence.PastDiagnosis & { target?: string }>;
  /** The expected diagnosis of each root verdict, by verdict id. */
  expect: Record<string, Expected>;
};

function single(
  v: Verdict,
  build: Omit<evidence.EvidenceInput, 'verdict' | 'block'> & { observed?: Partial<Observed> },
) {
  const { observed: obs, ...rest } = build;
  const block = { observed: observed(obs), verdicts: [v] };
  return (one: Verdict): evidence.EvidenceInput => ({ ...rest, block, verdict: one });
}

/** F1. test: the price-sheet formula check accepts `=C2*12` and not `=12*C2`. */
const f1 = (() => {
  const v = verdict('artifacts.out/acme-price-sheet.xlsx.D2.formula', { name: 'artifacts' });
  return {
    name: 'F1 test: the formula check reads text, not behaviour',
    verdicts: [v],
    input: single(v, {
      user: 'Write the yearly price as a formula on the monthly price, times twelve.',
      values: [
        {
          value: '=12*C2',
          rung: 'rung1_recompute',
          settles: 'pass',
          outcome: 'accepted_as_gold',
          changedInputsFail: false,
          demanded: '^=C2\\s*\\*\\s*12$',
        },
      ],
    }),
    expect: {
      [v.id]: {
        item: 'R5',
        fault: ['test'],
        disposition: 'credited',
        fix_location: 'test',
        placement: 'fixed',
      },
    },
  } satisfies WorkedCase;
})();

/** F2. env: a sandbox with no network; the agent says it cannot build the workbook and stops. */
const f2 = (() => {
  const v = verdict('artifacts.out/acme-price-sheet.xlsx', { name: 'artifacts' });
  return {
    name: 'F2 env: no network for a package install',
    verdicts: [v],
    input: single(v, {
      observed: {
        text: 'I cannot build the workbook: the package index is unreachable from this sandbox.',
        executions: [
          {
            command: 'pip install openpyxl',
            exitCode: 1,
            stderr:
              'ERROR: Could not install: NewConnectionError: Failed to establish a new connection: [Errno -3] Temporary failure in name resolution',
          },
        ],
      },
    }),
    expect: {
      [v.id]: {
        item: 'env_failure',
        fault: ['env'],
        disposition: 'excluded',
        fix_location: 'env',
        placement: 'fixed',
      },
    },
  } satisfies WorkedCase;
})();

/** F2 contrast: the same environment failure hidden behind a false claim. */
const f2Claim = (() => {
  const v = verdict('artifacts.out/acme-price-sheet.xlsx', { name: 'artifacts' });
  return {
    name: 'F2 contrast: the environment failed, the agent claimed success',
    verdicts: [v],
    input: single(v, {
      observed: {
        text: 'Done: the price sheet is saved.',
        workspaceDiff: { created: ['out/acme-price-sheet.csv'], changed: [], deleted: [] },
        executions: [
          {
            command: 'pip install openpyxl',
            exitCode: 1,
            stderr: 'NewConnectionError: Temporary failure in name resolution',
          },
        ],
      },
    }),
    expect: {
      [v.id]: {
        item: 'I3_false_claim',
        fault: ['agent'],
        disposition: 'agent',
        fix_location: 'agent.cross_skill',
        placement: 'always_core',
      },
    },
  } satisfies WorkedCase;
})();

/** F3 defect 1: reconcile.py prints nothing and exits 0 on the JSON invoices; the agent says matched. */
const f3Silent = (() => {
  const v = verdict('must.reconcile-summary', { name: 'must' });
  return {
    name: 'F3 tool.impl: the invoice script succeeds on nothing',
    verdicts: [v],
    input: single(v, {
      expect: { skills: ['invoice-reconcile'] },
      promises: [
        { tool: 'reconcile.py', prints: true, from: 'reconcile.py docstring: Prints one line per article' },
      ],
      observed: {
        text: 'INV-1004: matched',
        toolCalls: [readSkill('invoice-reconcile')],
        executions: [
          { command: 'python3 scripts/reconcile.py INV-1004.json PO-2004.json', exitCode: 0, stdout: '' },
        ],
      },
    }),
    expect: {
      [v.id]: {
        item: 'tool_silent_success',
        fault: ['tool', 'agent'],
        disposition: 'shared',
        fix_location: 'tool.impl',
        placement: 'fixed',
      },
    },
  } satisfies WorkedCase;
})();

/** F3 defect 2: the script reports 0.03 per unit on 24 units as a difference; the agent copied it. */
const f3Contradicts = (() => {
  const v = verdict('must.rounding', { name: 'must' });
  return {
    name: 'F3 tool.impl: the script contradicts its skill rule',
    verdicts: [v],
    input: single(v, {
      expect: { skills: ['invoice-reconcile'] },
      ruleAtoms: [ATOMS.rounding.id],
      atoms: [ATOMS.rounding, ATOMS.matchingGate],
      values: [{ value: 'FK-BOWL-16: over 0.72 EUR', gold: 'FK-BOWL-16: rounding', outcome: 'failed' }],
      observed: {
        text: 'FK-BOWL-16: over 0.72 EUR',
        toolCalls: [
          readSkill('invoice-reconcile'),
          {
            label: 'Read',
            input: {
              file_path: '/work/northwind/.claude/skills/invoice-reconcile/references/matching-rules.md',
            },
            output: 'A price difference under 0.05 EUR per unit is rounding, not a difference.',
          },
        ],
        executions: [
          {
            command: 'python3 scripts/reconcile.py INV-1004.csv PO-2004.csv',
            exitCode: 1,
            stdout: 'FK-BOWL-16: over 0.72 EUR\n',
          },
        ],
      },
    }),
    expect: {
      [v.id]: {
        item: 'tool_output_contradicts_rule',
        fault: ['tool', 'agent'],
        disposition: 'shared',
        fix_location: 'tool.impl',
        placement: 'fixed',
      },
    },
  } satisfies WorkedCase;
})();

/** F4: no rule for goods received. The static reading charges the agent; confirm runs find the missing rule. */
function f4(confirm: evidence.ConfirmEvidence | undefined): WorkedCase {
  const v = verdict('must.short-delivery', { name: 'must' });
  return {
    name:
      confirm === undefined
        ? 'F4 static: a value the agent derived differs from gold'
        : 'F4 confirmed: the rule is missing',
    verdicts: [v],
    input: single(v, {
      expect: { skills: ['invoice-reconcile'], situation: 'invoice-short-delivery' },
      atoms: [ATOMS.matchingGate, ATOMS.rounding],
      values: [
        {
          value: 'matched',
          gold: 'short delivery: 24 invoiced, 20 received',
          source: 'agent_derived',
          outcome: 'failed',
        },
      ],
      ...(confirm === undefined ? {} : { confirm }),
      observed: {
        text: 'INV-1004: matched',
        toolCalls: [
          readSkill('invoice-reconcile'),
          {
            label: 'Read',
            input: {
              file_path: '/work/northwind/.claude/skills/invoice-reconcile/references/matching-rules.md',
            },
            output: 'A line matches on article code.',
          },
        ],
      },
    }),
    expect: {
      [v.id]:
        confirm === undefined
          ? {
              item: 'R2b',
              fault: ['agent'],
              disposition: 'agent',
              fix_location: 'skill.content',
              placement: 'situational',
              confidence: 'static',
            }
          : {
              item: 'confirm_missing_rule',
              fault: ['setup'],
              disposition: 'setup',
              fix_location: 'skill.content',
              placement: 'situational',
              confidence: 'confirmed',
            },
    },
  };
}

/** F5: "update" the weekly report; the description says "prepare". The reference loads it 0 of 3. */
export function f5(confirm: evidence.ConfirmEvidence | undefined): WorkedCase {
  const v = verdict('skills.weekly-report', { name: 'skills' });
  return {
    name: 'F5 skill.trigger: prepare against update',
    verdicts: [v],
    input: single(v, {
      user: "Add the late shipment count to this week's report, reports/2026-W41.md.",
      expect: { skills: ['weekly-report'] },
      ...(confirm === undefined ? {} : { confirm }),
      observed: {
        toolCalls: [
          { label: 'Read', input: { file_path: '/work/northwind/reports/2026-W41.md' }, output: '# Week 41' },
        ],
      },
    }),
    expect: {
      [v.id]: {
        item: 'skill_not_loaded_uncovered',
        fault: ['skill'],
        disposition: 'setup',
        fix_location: 'skill.trigger',
        placement: 'trigger_local',
      },
    },
  };
}

/** F6: the currency pointer removed by a mutant; a USD invoice; the agent never reads the table. */
const f6 = (() => {
  const rate = verdict('custom.currency_rate', { name: 'custom' });
  const grounded = verdict('custom.grounded_values', { name: 'custom' });
  const obs = observed({
    text: 'Total: 920.00 EUR at 0.92.',
    toolCalls: [readSkill('invoice-reconcile')],
  });
  const base = { expect: { skills: ['invoice-reconcile'] } };
  return {
    name: 'F6 skill.layout: the pointer is gone',
    verdicts: [rate, grounded],
    input: (one: Verdict): evidence.EvidenceInput =>
      one.id === rate.id
        ? {
            ...base,
            block: { observed: obs, verdicts: [rate, grounded] },
            verdict: one,
            ruleAtoms: [ATOMS.currencyRule.id],
            atoms: [ATOMS.currencyRule],
          }
        : {
            ...base,
            block: { observed: obs, verdicts: [rate, grounded] },
            verdict: one,
            ruleAtoms: [ATOMS.r17.id],
            atoms: [ATOMS.r17],
          },
    expect: {
      [rate.id]: {
        item: 'skill_reference_unforced',
        fault: ['skill'],
        disposition: 'setup',
        fix_location: 'skill.layout',
        placement: 'layout_local',
      },
      [grounded.id]: {
        item: 'R1',
        fault: ['agent'],
        disposition: 'agent',
        fix_location: 'agent.cross_skill',
        placement: 'core_local',
      },
    },
  } satisfies WorkedCase;
})();

/** F7: the pointer present and skipped: one home is the skill's layout; two homes are the agent's skill reading. */
export function f7(homes: 1 | 2): WorkedCase {
  const v = verdict('tools.Read.input.file_path', { name: 'tools' });
  const history: Array<evidence.PastDiagnosis & { target?: string }> = [
    {
      item: 'skill_reference_forced_unread',
      act: 'read_reference',
      home: 'invoice-reconcile',
      target: 'skill:invoice-reconcile#.claude/skills/invoice-reconcile/SKILL.md:10',
    },
  ];
  if (homes === 2) {
    history.push(
      {
        item: 'skill_reference_forced_unread',
        act: 'read_reference',
        home: 'supplier-email',
        target: 'skill:supplier-email#.claude/skills/supplier-email/SKILL.md:8',
      },
      {
        item: 'skill_reference_forced_unread',
        act: 'read_reference',
        home: 'supplier-email',
        target: 'skill:supplier-email#.claude/skills/supplier-email/SKILL.md:8',
      },
    );
  }
  return {
    name: homes === 1 ? 'F7 one home: strengthen the pointer' : 'F7 two homes: the agent reads skills badly',
    verdicts: [v],
    input: single(v, {
      expect: { skills: ['invoice-reconcile'] },
      ruleAtoms: [ATOMS.currencyPointer.id],
      atoms: [ATOMS.currencyPointer],
      observed: { text: 'Total: 920.00 EUR.', toolCalls: [readSkill('invoice-reconcile')] },
    }),
    history,
    expect: {
      [v.id]:
        homes === 1
          ? {
              item: 'skill_reference_forced_unread',
              fault: ['agent'],
              disposition: 'agent',
              fix_location: 'skill.layout',
              placement: 'skill_local',
            }
          : {
              item: 'skill_reference_forced_unread',
              fault: ['agent'],
              disposition: 'agent',
              fix_location: 'agent.skill_reading',
              placement: 'cross_cutting',
            },
    },
  };
}

/** F8a: "verify before done" broken in two skills. */
const f8a = (() => {
  const v = verdict('custom.ordered.verify.report', { name: 'custom' });
  return {
    name: 'F8a agent.cross_skill: a core rule broken in two skills',
    verdicts: [v],
    input: single(v, {
      expect: { skills: ['weekly-report'] },
      ruleAtoms: [ATOMS.verifyGate.id],
      atoms: [ATOMS.verifyGate],
      observed: {
        toolCalls: [readSkill('weekly-report')],
        runtime: { stages: [{ name: 'plan' }, { name: 'do' }, { name: 'report' }] },
      },
    }),
    history: [
      { item: 'R7', act: 'ordered:verify>report', home: 'invoice-reconcile' },
      { item: 'R7', act: 'ordered:verify>report', home: 'invoice-reconcile' },
      { item: 'R7', act: 'ordered:verify>report', home: 'weekly-report' },
    ],
    expect: {
      [v.id]: {
        item: 'R7',
        fault: ['agent'],
        disposition: 'agent',
        fix_location: 'agent.cross_skill',
        placement: 'cross_cutting',
      },
    },
  } satisfies WorkedCase;
})();

/** F8b: "late" is defined in shipment-tracker only, and weekly-report and the core rule R7 need it. */
const f8b = (() => {
  const v = verdict('custom.grounded_values', { name: 'custom' });
  return {
    name: 'F8b agent.cross_skill: a definition three homes need',
    verdicts: [v],
    input: single(v, {
      expect: { skills: ['weekly-report'] },
      ruleAtoms: [ATOMS.late.id],
      atoms: [ATOMS.late, ATOMS.r7Late],
      edges: [{ from: ATOMS.r7Late.id, to: ATOMS.late.id, kind: 'cites' }],
      observed: { toolCalls: [readSkill('weekly-report')] },
    }),
    expect: {
      [v.id]: {
        item: 'rule_in_unrouted_skill',
        fault: ['setup'],
        disposition: 'setup',
        fix_location: 'agent.cross_skill',
        placement: 'shared_rule',
      },
    },
  } satisfies WorkedCase;
})();

/** F8c: the recorded weekly-gate-violated session: the guard denies the first edit, then the agent reads and edits. */
export function f8c(decisions: evidence.GuardDecision[]): WorkedCase {
  const v = verdict('custom.ordered.Read.Edit', { name: 'custom' });
  return {
    name: 'F8c core rule caught by its guard',
    verdicts: [v],
    input: single(v, {
      expect: { skills: ['weekly-report'] },
      ruleAtoms: [ATOMS.readBeforeEdit.id],
      atoms: [ATOMS.readBeforeEdit, ATOMS.readBeforeEditGuard],
      decisions,
      observed: { toolCalls: [readSkill('weekly-report')] },
    }),
    expect: {
      [v.id]: {
        item: 'core_rule_caught',
        fault: ['agent'],
        disposition: 'agent',
        fix_location: 'none',
        placement: 'fixed',
      },
    },
  };
}

/** F9: the tie rule given as a hint, missed 3 of 3; the reference passes 3 of 3. */
const f9 = (() => {
  const v = verdict('artifacts.out/acme-price-sheet.xlsx.summary', { name: 'artifacts' });
  return {
    name: 'F9 agent.model: the tie rule',
    verdicts: [v],
    input: single(v, {
      user: 'On a tie, take the plan listed first.',
      confirm: { runs: 3, hint_pass: 0, reference_pass: 3 },
    }),
    expect: {
      [v.id]: {
        item: 'confirm_model',
        fault: ['agent'],
        disposition: 'agent',
        fix_location: 'agent.model',
        placement: 'fixed',
      },
    },
  } satisfies WorkedCase;
})();

/** A planted R3b: the tool misses a verbatim copied address, and the agent gives up or states a wrong fact. */
export function r3b(next: 'gave_up' | 'wrong_fact' | 'asked_user'): WorkedCase {
  const v = verdict('tools.coverage.check.input.address', { name: 'tools' });
  return {
    name: `R3 with next action ${next}`,
    verdicts: [v],
    input: single(v, {
      user: 'Please check 88 Summit Ave, Acmeville',
      values: [
        {
          tool: 'coverage.check',
          field: 'address',
          call: 0,
          value: '88 Summit Ave, Acmeville',
          gold: '88 Summit Avenue, Acmeville',
          rung: 'rung1',
          settles: 'fail',
          outcome: 'failed',
        },
      ],
      reply: { next_action: next },
      observed: {
        text:
          next === 'wrong_fact'
            ? 'Home internet is not available at 88 Summit Ave.'
            : next === 'gave_up'
              ? 'I am sorry, I cannot help with that address.'
              : 'Could you give the street number, street name and town again?',
        toolCalls: [
          {
            label: 'coverage.check',
            input: { address: '88 Summit Ave, Acmeville' },
            output: { found: false },
          },
        ],
      },
    }),
    expect: {
      [v.id]: {
        item: 'R3',
        fault: next === 'asked_user' ? ['tool'] : ['tool', 'agent'],
        disposition: next === 'asked_user' ? 'setup' : 'shared',
        fix_location: 'tool.contract',
        placement: 'fixed',
      },
    },
  };
}

export const WORKED_CASES: WorkedCase[] = [
  f1,
  f2,
  f2Claim,
  f3Silent,
  f3Contradicts,
  f4(undefined),
  f4({ runs: 3, reference_pass: 0, hint_pass: 3 }),
  f5({ runs: 3, reference_loads: 0 }),
  f6,
  f7(1),
  f7(2),
  f8a,
  f8b,
  f9,
  r3b('gave_up'),
  r3b('wrong_fact'),
  r3b('asked_user'),
];
