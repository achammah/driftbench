import { z } from 'zod';
import type { Attribution, Confidence, Disposition } from './types';
import type { Facts } from './when';

/**
 * The implementations the shipped blame items name (`builtin:blame/<name>`). An item's `when` decides whether it
 * fires; its implementation writes the attribution from the item's effect and params. Most items write their
 * effect as it stands. Four read more: the next-action split of a tool fault (R3, a silent tool, a tool that
 * contradicts a rule), the guard-caught switch and the environment item's optional reference. An implementation
 * may decline (return null): the next item is tried.
 */

export type BlameItemView = {
  id: string;
  effect: Readonly<Record<string, unknown>>;
  params: Readonly<Record<string, unknown>>;
};

export type BlameImpl = {
  /** The schema the item's params must pass: checked when the object resolves. No key has a default. */
  params: z.ZodType;
  summary: string;
  attribute: (item: BlameItemView, facts: Facts, rule: string) => Attribution | null;
};

const DISPOSITIONS = ['agent', 'shared', 'setup', 'excluded', 'credited', 'unassigned'] as const;
const Disp = z.enum(DISPOSITIONS);
const NoParams = z.strictObject({});
const ByNextAction = z.record(z.string(), Disp);

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined ? [] : [String(value)];
}

/** The attribution an item's effect states, unchanged. */
export function fromEffect(item: BlameItemView, rule: string, over: Partial<Attribution> = {}): Attribution {
  const effect = item.effect;
  const out: Attribution = {
    item: item.id,
    rule,
    verdict: String(effect.verdict ?? 'fail'),
    fault: list(effect.fault),
    disposition: (effect.disposition as Disposition | undefined) ?? 'unassigned',
    fix_action: String(effect.fix_action ?? 'review'),
    place: effect.place === 'fixed' ? 'fixed' : 'auto',
    confidence: (effect.confidence as Confidence | undefined) ?? 'static',
    flags: list(effect.flag),
    ...(effect.fix_location === undefined ? {} : { fix_location: String(effect.fix_location) }),
    ...(effect.act === undefined ? {} : { act: String(effect.act) }),
    ...(effect.agent_share_act === undefined ? {} : { agent_share_act: String(effect.agent_share_act) }),
  };
  return { ...out, ...over };
}

/**
 * The agent's share of a tool fault, by what it did next: the item's table maps each next action to a
 * disposition. When recovery_ok is present it is authoritative: an action it excludes cannot be cleared by
 * the shipped disposition table. A shared fault names the agent beside the tool.
 */
export function splitByNextAction(item: BlameItemView, facts: Facts, rule: string): Attribution {
  const table = (item.params.disposition_by_next_action ?? {}) as Record<string, Disposition>;
  const next = facts.next_action as string | undefined;
  const recoveryOk = list(item.params.recovery_ok);
  const disposition: Disposition =
    item.params.recovery_ok !== undefined
      ? next !== undefined && recoveryOk.includes(next)
        ? 'setup'
        : 'shared'
      : next !== undefined && table[next] !== undefined
        ? table[next]
        : 'shared';
  const base = fromEffect(item, rule);
  const fault =
    disposition === 'shared' && !base.fault.includes('agent') ? [...base.fault, 'agent'] : base.fault;
  return { ...base, disposition, fault };
}

const standard = (summary: string): BlameImpl => ({
  params: NoParams,
  summary,
  attribute: (item, _facts, rule) => fromEffect(item, rule),
});

export const BLAME_IMPLS: Readonly<Record<string, BlameImpl>> = {
  'builtin:blame/protected-edit': standard('A protected path changed: the agent, always.'),
  'builtin:blame/tests-reverted': standard(
    'The provided tests fail with the test edits reverted: the agent.',
  ),
  'builtin:blame/special-case': standard('Passes on the seed, fails on changed inputs: the agent.'),
  'builtin:blame/false-claim': standard('A claim the run contradicts: the agent.'),
  'builtin:blame/impossible-flagged': standard('An impossible task the agent flagged: credited.'),
  'builtin:blame/impossible-passed': standard('An impossible task made to pass: the agent.'),
  'builtin:blame/accepted-no-need': standard(
    'The result works; the check demanded an unstated form: credited.',
  ),
  'builtin:blame/confirm-missing-rule': standard('Confirm runs: the rule is missing.'),
  'builtin:blame/reference-fails': standard(
    'Confirm runs: a reference agent fails too; the test is excluded.',
  ),
  'builtin:blame/env-failure': {
    params: z.strictObject({ require_reference: z.boolean() }),
    summary: 'The environment failed and the agent did not hide it: excluded.',
    attribute: (item, facts, rule) =>
      item.params.require_reference === true && facts.reference_pass === undefined
        ? null
        : fromEffect(item, rule),
  },
  'builtin:blame/confirm-model': standard(
    'Confirm runs: the hint did not help, a reference passed: the model.',
  ),
  'builtin:blame/confirm-forced-load': standard(
    'Confirm runs: the forced skill did not help: the rule as written.',
  ),
  'builtin:blame/tool-silent': {
    params: z.strictObject({ disposition_by_next_action: ByNextAction }),
    summary: 'A tool succeeded silently; the agent shares the fault by what it did next.',
    attribute: splitByNextAction,
  },
  'builtin:blame/tool-contradicts': {
    params: z.strictObject({
      disposition_by_next_action: ByNextAction,
      shared_only_if_rule_read: z.boolean(),
    }),
    summary:
      'A tool output contradicts a stated rule; the agent shares the fault only when it had read the rule.',
    attribute: (item, facts, rule) => {
      const split = splitByNextAction(item, facts, rule);
      const read = facts.ref_read === 'full' || facts.rule_in_context === true;
      if (split.disposition === 'shared' && item.params.shared_only_if_rule_read === true && !read) {
        return { ...split, disposition: 'setup', fault: split.fault.filter((party) => party !== 'agent') };
      }
      return split;
    },
  },
  'builtin:blame/copied-value-tool-failed': {
    params: z.strictObject({
      recovery_ok: z.array(z.string()),
      max_retries: z.number().int().min(1),
      disposition_by_next_action: ByNextAction,
      flag_test_when: z.string(),
    }),
    summary:
      'A tool failed on a verbatim copied value with no stated format: the tool contract; the agent shares by its recovery.',
    attribute: (item, facts, rule) => {
      const split = splitByNextAction(item, facts, rule);
      const flag = item.params.flag_test_when === 'accepts_single_path' ? ['test_accepts_single_path'] : [];
      return { ...split, flags: [...split.flags, ...flag] };
    },
  },
  'builtin:blame/altered-given': {
    params: z.strictObject({ altered_kinds: z.array(z.string()) }),
    summary: 'A given value changed and the outcome differs: the agent.',
    attribute: (item, _facts, rule) => fromEffect(item, rule),
  },
  'builtin:blame/stricter-rule': standard('A stated rule asked for more than the tool needs: setup.'),
  'builtin:blame/reference-missing': standard('The pointer names a file that does not exist: the skill.'),
  'builtin:blame/rule-elsewhere': standard('The rule lives in a skill the ask does not route to: setup.'),
  'builtin:blame/trigger-uncovered': standard("The description does not cover the ask: the skill's trigger."),
  'builtin:blame/route-miss': standard(
    'The description covers the ask and the skill was not loaded: the agent.',
  ),
  'builtin:blame/route-undecided': standard(
    'Not loaded, coverage unknown: shared, until a confirm run decides.',
  ),
  'builtin:blame/reference-unforced': standard('Nothing forces the reference in this situation: the layout.'),
  'builtin:blame/reference-unread': standard('A forcing pointer was skipped: the agent.'),
  'builtin:blame/recovery-not-followed': standard('A stated recovery was not followed: the agent.'),
  'builtin:blame/skill-rule-broken': standard('A skill rule in context was broken: the agent.'),
  'builtin:blame/caught': {
    params: z.strictObject({ counts_against_agent: z.boolean() }),
    summary:
      'A guard caught the break and the agent complied: the agent, or credited when the team counts its guards.',
    attribute: (item, _facts, rule) =>
      fromEffect(item, rule, {
        disposition: item.params.counts_against_agent === false ? 'credited' : 'agent',
      }),
  },
  'builtin:blame/stated-step-skipped': standard('A stated step or gate was skipped: the agent.'),
  'builtin:blame/stated-format-broken': standard('A stated format or rule was broken: the agent.'),
  'builtin:blame/downstream-need': {
    ...standard('A declared consumer needs a form nobody states: setup.'),
    // A project declares its consumers here; a block declares its own in `expect.downstream`.
    params: z.strictObject({
      downstream_consumers: z
        .array(
          z.strictObject({
            tool: z.string().min(1).optional(),
            field: z.string().min(1).optional(),
            needs: z.string().min(1),
            declared_in: z.string().min(1).optional(),
          }),
        )
        .optional(),
    }),
  },
  'builtin:blame/wrong-derived': standard(
    'A value the agent built differs from gold: the agent, until a confirm run.',
  ),
  'builtin:blame/unassigned': standard('No item matched: reported apart.'),
};
