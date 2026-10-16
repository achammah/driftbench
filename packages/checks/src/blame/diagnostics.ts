/** Shipped diagnostic data, validated against the reviewed YAML in tests. */
export const SHIPPED_DIAGNOSTICS = {
  'diagnostic:code-agent-liability': {
    kind: 'diagnostic',
    id: 'code-agent-liability',
    version: 1,
    extends: null,
    description: 'Who made the mistake behind each failing gating verdict, and where the fix goes.',
    scope: 'block',
    when: {
      any_verdict: {
        gating: true,
        outcome: 'fail',
      },
    },
    reads: ['policy/value-check', 'policy/blame', 'policy/placement'],
    steps: [
      {
        id: 'chain',
        title: 'Only the root of each chain of failing verdicts is attributed',
        impl: 'builtin:blame/chain',
        params: {
          emit: false,
        },
      },
      {
        id: 'evidence',
        title: 'The evidence names of each root, from the stored run and the estate map',
        impl: 'builtin:blame/evidence',
        params: {
          emit: false,
        },
      },
      {
        id: 'attribute',
        title: 'policy/blame, first match in order',
        impl: 'builtin:blame/attribute',
        params: {
          emit: false,
        },
      },
      {
        id: 'place',
        title: 'policy/placement, with the recurrence known so far',
        impl: 'builtin:placement/apply',
        params: {
          emit: true,
        },
      },
    ],
    output: {
      fields: [
        'verdict_ref',
        'inherits',
        'rule',
        'fault',
        'disposition',
        'fix_location',
        'fix_target',
        'fix_action',
        'fix_forms',
        'placement',
        'evidence',
        'confidence',
        'flags',
      ],
    },
    cost: {
      model_calls: 'none',
      agent_runs: 'none',
    },
  },
  'diagnostic:fix-plan': {
    kind: 'diagnostic',
    id: 'fix-plan',
    version: 1,
    extends: null,
    description: 'The ranked list of fixes for a campaign, moved not duplicated.',
    scope: 'campaign',
    reads: ['policy/placement'],
    steps: [
      {
        id: 'recurrence',
        title: 'Signatures and homes over every diagnosis of the campaign',
        impl: 'builtin:placement/recurrence',
      },
      {
        id: 'replace',
        title: 'Re-place each diagnosis whose signature crossed a threshold',
        impl: 'builtin:fix-plan/replace',
      },
      {
        id: 'merge',
        title: 'One fix per target and action; local copies listed for removal',
        impl: 'builtin:fix-plan/merge',
      },
      {
        id: 'rank',
        title: 'Rank by agent blocks, then blocks, then cost',
        impl: 'builtin:rank/top-n',
        params: {
          n: 10,
          by: ['agent_blocks', 'blocks', 'cost_class'],
        },
      },
    ],
    output: {
      fields: [
        'fix_location',
        'fix_target',
        'fix_action',
        'fix_forms',
        'blocks',
        'agent_blocks',
        'rules',
        'remove_copies',
        'confidence',
      ],
    },
    cost: {
      model_calls: 'none',
      agent_runs: 'none',
    },
  },
  'diagnostic:flaky-block': {
    kind: 'diagnostic',
    id: 'flaky-block',
    version: 1,
    extends: null,
    description: 'Blocks whose repeats disagree.',
    scope: 'campaign',
    reads: [],
    steps: [
      {
        id: 'disagreement',
        title: 'Blocks whose repeats both pass and fail',
        impl: 'builtin:flaky/repeat-disagreement',
        params: {
          min_repeats: 2,
        },
      },
    ],
    output: {
      fields: ['spec', 'block', 'target', 'mode', 'repeats', 'passes', 'pass_share'],
    },
    cost: {
      model_calls: 'none',
      agent_runs: 'none',
    },
  },
  'diagnostic:liability-confirm': {
    kind: 'diagnostic',
    id: 'liability-confirm',
    version: 1,
    extends: null,
    description: 'Runs the cheapest experiment that could change each static diagnosis, within a budget.',
    scope: 'campaign',
    when: { any_diagnosis: { confidence: ['static', 'undecided'] } },
    reads: ['policy/blame'],
    steps: [
      {
        id: 'plan',
        title: 'The cheapest run that could change each open diagnosis',
        impl: 'builtin:confirm/plan',
        params: {
          runs: 3,
        },
      },
      {
        id: 'run',
        title: 'The planned runs, within the budget',
        impl: 'builtin:confirm/run',
        params: {
          runs: 3,
          budget_usd: 0,
          reference_target: null,
        },
      },
      {
        id: 'store',
        title: 'reference_pass, reference_loads, forced_load_pass and hint_pass on each diagnosis',
        impl: 'builtin:confirm/store',
      },
      {
        id: 'rejudge',
        title: 'code-agent-liability again, with the stored evidence',
        impl: 'builtin:diagnostic/rerun',
        params: {
          diagnostic: 'code-agent-liability',
        },
      },
    ],
    output: {
      fields: ['runs_made', 'cost_usd', 'changed_diagnoses', 'skipped_for_budget'],
    },
    cost: {
      agent_runs: 'conditional',
    },
  },
  'diagnostic:value-mismatch': {
    kind: 'diagnostic',
    id: 'value-mismatch',
    version: 1,
    extends: null,
    description: 'Why a value the agent sent failed its check, and who owns the fix.',
    scope: 'block',
    when: {
      any_verdict: {
        name: 'tools',
        outcome: 'fail',
      },
    },
    reads: ['policy/value-check', 'policy/blame'],
    steps: [
      {
        id: 'chain',
        title: 'Only the root of each chain of failing verdicts is attributed',
        impl: 'builtin:blame/chain',
        params: {
          emit: false,
        },
      },
      {
        id: 'evidence',
        title: "The evidence names of each root, the value check's record included",
        impl: 'builtin:blame/value-evidence',
        params: {
          emit: false,
        },
      },
      {
        id: 'attribute',
        title: 'policy/blame, first match in order',
        impl: 'builtin:blame/attribute',
        params: {
          emit: true,
        },
      },
    ],
    output: {
      fields: ['verdict_ref', 'rule', 'fault', 'disposition', 'fix_location', 'evidence', 'flags'],
    },
    cost: {
      model_calls: 'none',
      agent_runs: 'none',
    },
  },
};
