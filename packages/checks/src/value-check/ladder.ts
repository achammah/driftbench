import {
  deepEqual,
  type ObjectRegistry,
  objectRegistry,
  type ResolvedObject,
} from '@agent-nexus/driftbench-core';
import { z } from 'zod';
import { show } from '../support/values';
import { asGiven, sourceOf } from './as-given';
import { contract, contractOf } from './contract';
import { exact } from './exact';
import { type SameReferentJudge, sameReferent } from './judge';
import { outcome, resolvesField, type ToolReplayer } from './outcome';
import { type RecomputeCase, recompute } from './recompute';
import { type StateDiffCase, stateDiff } from './state-diff';

/**
 * The value-check ladder: when a value the agent wrote is the right value. A block compares the agent's value
 * with a gold value; the ladder decides whether the two are the same where it matters, without any rule per
 * value type. Its rungs are the items of a `policy/value-check` object (`policy/value-check/default.yaml`),
 * tried in the object's order: the first item whose `when` holds and that settles the value decides it. A
 * value no item settles falls back to the exact compare of today (`exact_fallback`): the ladder turns a fail
 * into a pass only when a decider proved the values the same. Only a configured judge that cannot decide (its
 * votes split, or its call failed) leaves a value inconclusive.
 *
 * Before the rungs, two facts settle a value alone: a value equal to the gold passes, and a value or a gold
 * that is not a string (a number, a boolean, a list, an absent value) has one writing, so a difference fails.
 * Neither applies to a computed value or a workspace, which only their own rung decides.
 */

/** What a rung, and the ladder, can decide. */
export type Settles = 'pass' | 'fail' | 'inconclusive';

/**
 * How a block says one value is compared (`ToolExpect.compare`). `auto` walks the policy's rungs; a rung name
 * runs that rung alone; `{ exact: reason }` declares that the writing itself is the requirement.
 */
export type CompareMode = 'auto' | 'outcome' | 'contract' | 'as_given' | 'same_referent' | { exact: string };

/** One value to decide, with everything a rung may read. */
export type ValueCase = {
  /** The tool the value was written into, by its label. */
  tool?: string;
  /** The value's dotted path inside the tool input: `address`, `customer.phone`. */
  field: string;
  /** The value the block expects. */
  gold: unknown;
  /** The value the agent wrote; undefined when absent. */
  value: unknown;
  /** The agent's whole call input, which the outcome rung replays with the gold in place of the value. */
  input?: Readonly<Record<string, unknown>>;
  /** The block's declaration. Absent means auto. */
  compare?: CompareMode;
  /** The tool's definition as the agent saw it: a JSON Schema, or a tool with `parameters` or `input_schema`. */
  definition?: unknown;
  /** Where a copied value can come from: the user's messages and the workspace files the agent read. */
  sources?: { user?: readonly string[]; files?: Readonly<Record<string, string>> };
  /** The block's seeded store (`given.world.store`), which a replay runs against. */
  world?: Readonly<Record<string, unknown>>;
  /** A formula or a script to recompute; set for a computed value. */
  recompute?: RecomputeCase;
  /** A workspace diff to compare; set when the value is the workspace itself. */
  stateDiff?: StateDiffCase;
};

/** What a rung returns: a settled outcome with its evidence, or the reason it could not decide. */
export type RungResult =
  | { settles: Settles; evidence: string; emits?: Readonly<Record<string, unknown>> }
  | { skip: string };

/** What every rung receives besides the value. */
export type RungContext = {
  readonly services: ValueServices;
  /** The item's parameters. */
  readonly params: Readonly<Record<string, unknown>>;
  /** The object's parameters, shared by the items. */
  readonly shared: Readonly<Record<string, unknown>>;
  /** The evidence names computed for this value. */
  readonly evidence: Readonly<Record<string, unknown>>;
};

export type Rung = (value: ValueCase, ctx: RungContext) => Promise<RungResult> | RungResult;

/** The services a rung may use. Without one, the rung that needs it does not apply. */
export type ValueServices = {
  /** Replays a tool in the sandbox (rung 1). */
  replayer?: ToolReplayer;
  /** The same-referent judge (rung 3). */
  judge?: SameReferentJudge;
};

/** One item of a `policy/value-check` object, as the object resolver returns it. */
export type ValuePolicyItem = {
  readonly id: string;
  readonly title?: string;
  readonly enabled?: boolean;
  readonly when?: Readonly<Record<string, unknown>>;
  readonly effect?: Readonly<Record<string, unknown>>;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly impl: string;
  readonly cites?: string;
};

/** A resolved `policy/value-check` object: its items in their order, and its shared parameters. */
export type ValuePolicy = {
  readonly kind?: string;
  readonly id?: string;
  /** `kind:id@hash8` when the resolver produced it; cited by the evidence. */
  readonly ref?: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly items: readonly ValuePolicyItem[];
  /** The item order; absent means the order of `items`. */
  readonly order?: readonly string[];
};

/** The ladder's answer for one value. */
export type LadderResult = {
  outcome: Settles;
  /** The item that settled the value, `identity` for the two facts that settle alone, `exact_fallback` when none did. */
  rung: string;
  evidence: string;
  /** The evidence names computed for the value and the ones the settling rung emitted. */
  names: Record<string, unknown>;
  /** Only the names the settling rung emitted, such as `changed_inputs_fail` or `change`. */
  emits?: Record<string, unknown>;
  /**
   * A lint on the test, never a fail of the agent: `unstated_format` when the block demands a writing nobody
   * states, `no_decider` when nothing could decide the value and it was compared exactly.
   */
  lint?: { id: 'unstated_format' | 'no_decider'; text: string };
  /** The rungs that ran and could not decide, with their reasons, in order. */
  tried: { rung: string; reason: string }[];
};

/** The built-in rung implementations, by the name an item's `impl` gives. */
export const BUILTIN_RUNGS: Readonly<Record<string, Rung>> = {
  'builtin:value-check/exact': exact,
  'builtin:value-check/outcome': outcome,
  'builtin:value-check/recompute': recompute,
  'builtin:value-check/state-diff': stateDiff,
  'builtin:value-check/contract': contract,
  'builtin:value-check/as-given': asGiven,
  'builtin:value-check/judge': sameReferent,
};

/** The evidence names a `when` may read (config_framework.md 2.6), with the values each one takes. */
export const EVIDENCE_NAMES: Readonly<Record<string, readonly unknown[]>> = {
  compare: ['auto', 'exact', 'outcome', 'contract', 'as_given', 'same_referent'],
  tool_replayable: [true, false],
  recomputable: [true, false],
  compares: ['value', 'workspace'],
  contract: ['tool', 'prompt', 'instruction', 'skill', 'error_seen', 'downstream', 'none'],
  source: ['user', 'workspace_file', 'unknown'],
};

/** Which rung a named `compare` mode runs, by implementation. */
const MODE_IMPL: Readonly<Record<string, string>> = {
  outcome: 'builtin:value-check/outcome',
  contract: 'builtin:value-check/contract',
  as_given: 'builtin:value-check/as-given',
  same_referent: 'builtin:value-check/judge',
  exact: 'builtin:value-check/exact',
};

/**
 * The shipped `policy/value-check:default`, item for item as `policy/value-check/default.yaml` writes it
 * (a test holds the two equal). The tools check uses it until a block resolves another one.
 */
export const DEFAULT_VALUE_POLICY: ValuePolicy = {
  kind: 'policy/value-check',
  id: 'default',
  params: { numbers_significant_digits: 12 },
  items: [
    {
      id: 'rung4_exact',
      title: 'Exact match, only where the block declares the format is the requirement',
      when: { compare: 'exact' },
      effect: { settles: ['pass', 'fail'] },
      impl: 'builtin:value-check/exact',
    },
    {
      id: 'rung1_outcome',
      title: "Ask the tool, same result for the gold value and the agent's value",
      when: { tool_replayable: true },
      effect: { settles: ['pass', 'fail'] },
      params: { resolved_fields: 'from_tool_declaration', distractors_required: true },
      impl: 'builtin:value-check/outcome',
      cites: 'value_equivalence.md 3 rung 1; HF6',
    },
    {
      id: 'rung1_recompute',
      title: 'Recompute a formula or a script on the given inputs and on changed inputs',
      when: { recomputable: true },
      effect: { settles: ['pass', 'fail'], emits: ['changed_inputs_fail'] },
      params: { trials: 3, seed: 1, inputs: 'drawn_from_seed_ranges' },
      impl: 'builtin:value-check/recompute',
      cites: 'DS-1000 2.3 p.4; EvilGenie p.7',
    },
    {
      id: 'rung1_state_diff',
      title: 'Expected changes present, nothing outside expected plus allowed, on the net workspace diff',
      when: { compares: 'workspace' },
      effect: { settles: ['pass', 'fail'] },
      impl: 'builtin:value-check/state-diff',
      cites: 'AppWorld p.6',
    },
    {
      id: 'rung2_contract',
      title: 'The format the tool, the prompt, the instruction or a loaded skill states',
      when: { tool_replayable: false, contract: ['tool', 'prompt', 'instruction', 'skill', 'error_seen'] },
      effect: { settles: ['fail'], lint_when: 'test_demands_unstated_format' },
      impl: 'builtin:value-check/contract',
      cites: 'value_equivalence.md 3c R1',
    },
    {
      id: 'rung2b_as_given',
      title: 'A value the user or a workspace file gave is not changed (a copy alone passes nothing)',
      when: { tool_replayable: false, recomputable: false, source: ['user', 'workspace_file'] },
      effect: { settles: ['fail'], emits: ['change'] },
      params: { ignore: ['surrounding_space'] },
      impl: 'builtin:value-check/as-given',
      cites: 'value_equivalence.md 3c R2; tau-bench policy p.16',
    },
    {
      id: 'rung3_same_referent',
      title: 'A calibrated judge decides whether both values name the same thing',
      when: { tool_replayable: false, contract: 'none' },
      effect: { settles: ['pass', 'fail', 'inconclusive'] },
      params: {
        design: 'read_each_value_first',
        orders: 'both',
        repeats: 3,
        max_false_acceptance: 0.02,
        min_kappa_vs_labels: 'labellers_minus_0.05',
        prompt_template: 'prompt-template/same-referent:default',
      },
      impl: 'builtin:value-check/judge',
      cites: 'value_equivalence.md 3 rung 3; HF7',
    },
  ],
  order: [
    'rung4_exact',
    'rung1_outcome',
    'rung1_recompute',
    'rung1_state_diff',
    'rung2_contract',
    'rung2b_as_given',
    'rung3_same_referent',
  ],
};

/** The path the shipped object is known by: its file in the repository. */
export const DEFAULT_VALUE_POLICY_PATH = 'policy/value-check/default.yaml';

/** The parameters each built-in rung accepts: what the object resolver checks an item's `params` against. */
export const RUNG_PARAMS: Readonly<Record<string, z.ZodType>> = {
  'builtin:value-check/exact': z.strictObject({}),
  'builtin:value-check/outcome': z.strictObject({
    resolved_fields: z.literal('from_tool_declaration').optional(),
    distractors_required: z.boolean().optional(),
  }),
  'builtin:value-check/recompute': z.strictObject({
    trials: z.number().int().min(0).optional(),
    seed: z.number().int().optional(),
    inputs: z.literal('drawn_from_seed_ranges').optional(),
  }),
  'builtin:value-check/state-diff': z.strictObject({}),
  'builtin:value-check/contract': z.strictObject({}),
  'builtin:value-check/as-given': z.strictObject({
    ignore: z.array(z.literal('surrounding_space')).optional(),
  }),
  'builtin:value-check/judge': z.strictObject({
    design: z.enum(['read_each_value_first', 'side_by_side']).optional(),
    orders: z.enum(['both', 'one']).optional(),
    repeats: z.number().int().min(1).optional(),
    max_false_acceptance: z.number().min(0).max(1).optional(),
    min_kappa_vs_labels: z.union([z.number(), z.string().regex(/^labellers_minus_\d+(\.\d+)?$/)]).optional(),
    prompt_template: z.string().min(1).optional(),
  }),
};

/**
 * Registers the value-check rungs and the shipped `policy/value-check:default` with an object registry, the
 * core one by default, so a spec or a block that writes `uses.value_check` resolves against them. Each name is
 * registered once: a registry that already holds it is left as it is.
 */
export function registerValueCheck(registry: ObjectRegistry = objectRegistry): void {
  for (const [name, params] of Object.entries(RUNG_PARAMS)) {
    if (registry.impl(name) === undefined) registry.registerImpl(name, { params });
  }
  const shipped = registry
    .shipped()
    .some(({ raw }) => isPolicy(raw) && raw.kind === 'policy/value-check' && raw.id === 'default');
  if (!shipped) {
    const { kind, id, params, items, order } = DEFAULT_VALUE_POLICY;
    registry.registerShipped(
      {
        kind,
        id,
        extends: null,
        description: 'Decides when a value, a file or a state the agent produced is the right one.',
        params,
        items,
        order,
      },
      DEFAULT_VALUE_POLICY_PATH,
    );
  }
}

function isPolicy(raw: unknown): raw is { kind?: unknown; id?: unknown } {
  return raw !== null && typeof raw === 'object';
}

/** A resolved `policy/value-check` object as the ladder runs it: its items in their resolved order. */
export function policyOf(object: ResolvedObject): ValuePolicy {
  return {
    kind: object.kind,
    id: object.id,
    ref: object.ref,
    params: object.params,
    items: object.items.map(({ id, title, enabled, when, effect, params, impl }) => ({
      id,
      title,
      enabled,
      when,
      effect,
      params,
      impl,
    })),
  };
}

/**
 * The problems of a policy, empty when it can run: an unknown implementation, an evidence name a `when`
 * cannot read, or an order that is not a permutation of the items.
 */
export function valuePolicyProblems(
  policy: ValuePolicy,
  rungs: Readonly<Record<string, Rung>> = BUILTIN_RUNGS,
): string[] {
  const problems: string[] = [];
  const ids = policy.items.map((item) => item.id);
  for (const item of policy.items) {
    if (rungs[item.impl] === undefined) problems.push(`${item.id}: no rung implements ${item.impl}`);
    for (const name of Object.keys(item.when ?? {})) {
      if (EVIDENCE_NAMES[name] === undefined) {
        problems.push(
          `${item.id}: when reads ${name}, which is not an evidence name (${Object.keys(EVIDENCE_NAMES).join(', ')})`,
        );
      }
    }
  }
  if (policy.order !== undefined) {
    const sorted = (list: readonly string[]) => [...list].sort().join('\n');
    if (sorted(policy.order) !== sorted(ids)) {
      problems.push(`order must name every item once: ${policy.order.join(', ')}`);
    }
  }
  return problems;
}

/** The items in the policy's order, enabled ones only. */
function orderedItems(policy: ValuePolicy): ValuePolicyItem[] {
  const byId = new Map(policy.items.map((item) => [item.id, item]));
  const ids = policy.order ?? policy.items.map((item) => item.id);
  return ids
    .map((id) => byId.get(id))
    .filter((item): item is ValuePolicyItem => item !== undefined && item.enabled !== false);
}

/** The `compare` mode as the evidence name reads it. */
export function compareName(mode: CompareMode | undefined): string {
  if (mode === undefined) return 'auto';
  return typeof mode === 'string' ? mode : 'exact';
}

/** The evidence names of one value, computed once and read by every `when`. */
export function evidenceOf(value: ValueCase, services: ValueServices): Record<string, unknown> {
  return {
    compare: compareName(value.compare),
    tool_replayable:
      value.tool !== undefined &&
      value.input !== undefined &&
      resolvesField(services.replayer?.declaration(value.tool), value.field),
    recomputable: value.recompute !== undefined,
    compares: value.stateDiff === undefined ? 'value' : 'workspace',
    contract: contractOf(value.definition, value.field),
    source: sourceOf(value),
  };
}

/** Whether an item's `when` holds: each named evidence equals the value, or is one of the listed values. */
export function whenHolds(
  when: Readonly<Record<string, unknown>> | undefined,
  evidence: Record<string, unknown>,
) {
  return Object.entries(when ?? {}).every(([name, wanted]) =>
    Array.isArray(wanted) ? wanted.includes(evidence[name]) : evidence[name] === wanted,
  );
}

/** What an item may settle: its `effect.settles`, or every outcome when it lists none. */
function settlesOf(item: ValuePolicyItem): readonly unknown[] {
  const listed = item.effect?.settles;
  return Array.isArray(listed) ? listed : ['pass', 'fail', 'inconclusive'];
}

/** The rung that passes a value whose writing differs from the gold's: the judge. */
const WRITING_RUNGS = new Set(['builtin:value-check/judge']);

/**
 * Decides one value. Two facts first (equal passes; a non-string difference fails), then the policy's items
 * in order. A named `compare` mode runs only the item that implements it, whatever its `when`.
 */
export async function runLadder(
  value: ValueCase,
  policy: ValuePolicy = DEFAULT_VALUE_POLICY,
  services: ValueServices = {},
  rungs: Readonly<Record<string, Rung>> = BUILTIN_RUNGS,
): Promise<LadderResult> {
  const names = evidenceOf(value, services);
  // A computed value or a workspace is decided by its rung alone: a hard-coded number equal to today's result
  // is exactly what the recomputation exists to catch.
  const plainValue = value.recompute === undefined && value.stateDiff === undefined;
  if (plainValue && deepEqual(value.value, value.gold)) {
    return { outcome: 'pass', rung: 'identity', evidence: `equal to ${show(value.gold)}`, names, tried: [] };
  }
  if (plainValue && (typeof value.value !== 'string' || typeof value.gold !== 'string')) {
    return {
      outcome: 'fail',
      rung: 'identity',
      evidence: `${show(value.value)} differs from ${show(value.gold)}, and a value that is not a string has one writing`,
      names,
      tried: [],
    };
  }

  const mode = compareName(value.compare);
  const forced = mode === 'auto' ? undefined : MODE_IMPL[mode];
  const items = orderedItems(policy).filter((item) => (forced === undefined ? true : item.impl === forced));
  const tried: LadderResult['tried'] = [];
  if (forced !== undefined && items.length === 0) {
    tried.push({ rung: mode, reason: `the policy has no enabled item that implements ${forced}` });
  }

  for (const item of items) {
    if (forced === undefined && !whenHolds(item.when, names)) continue;
    const rung = rungs[item.impl];
    if (rung === undefined) {
      tried.push({ rung: item.id, reason: `no rung implements ${item.impl}` });
      continue;
    }
    const result = await rung(value, {
      services,
      params: item.params ?? {},
      shared: policy.params ?? {},
      evidence: names,
    });
    if ('skip' in result) {
      tried.push({ rung: item.id, reason: result.skip });
      continue;
    }
    if (!settlesOf(item).includes(result.settles)) {
      tried.push({
        rung: item.id,
        reason: `${result.evidence}; this rung settles only ${settlesOf(item).join(', ')}`,
      });
      continue;
    }
    const settled: LadderResult = {
      outcome: result.settles,
      rung: item.id,
      evidence: result.evidence,
      names: { ...names, ...(result.emits ?? {}) },
      ...(result.emits === undefined ? {} : { emits: { ...result.emits } }),
      tried,
    };
    const lint = unstatedFormat(value, policy, settled, item);
    return lint === undefined ? settled : { ...settled, lint: { id: 'unstated_format', text: lint } };
  }

  return exactFallback(value, names, tried);
}

/**
 * The floor when no rung could settle a value: the exact compare of today, so the ladder turns a fail into a
 * pass only when a decider proved the two values the same. The value already differs from the gold, so the
 * fallback fails it, says so, and lints the test with the deciders that would settle it.
 */
function exactFallback(
  value: ValueCase,
  names: Record<string, unknown>,
  tried: LadderResult['tried'],
): LadderResult {
  const where = value.tool === undefined ? value.field : `${value.tool}.${value.field}`;
  const reasons = tried.map((entry) => `${entry.rung}: ${entry.reason}`);
  const deciders = [
    ...(names.tool_replayable === true
      ? []
      : [`a replayer that declares ${value.tool ?? 'the tool'} and resolves ${value.field} (rung1_outcome)`]),
    ...(names.contract === 'none'
      ? [`a pattern or an enum for ${value.field} in metadata.tool_schemas (rung2_contract)`]
      : []),
    'a calibrated same-referent judge (rung3_same_referent)',
  ];
  return {
    outcome: 'fail',
    rung: 'exact_fallback',
    evidence: `no decider configured for ${where}; compared exactly: ${show(value.value)} is not ${show(value.gold)}${reasons.length === 0 ? '' : ` (${reasons.join('; ')})`}`,
    names,
    tried,
    lint: {
      id: 'no_decider',
      text: `nothing could decide whether ${show(value.value)} names the same thing as ${show(value.gold)} for ${where}, so it was compared exactly; it would be settled by ${deciders.join(', or ')}`,
    },
  };
}

/**
 * The lint `test_demands_unstated_format` (value_equivalence.md 3, rung 2): the agent's value differs from the
 * gold only in its writing, and nothing outside the test asks for the gold's writing. The tool cannot be asked,
 * no contract states a format, and the judge passed the value (same referent).
 * The block demands a writing nobody told the agent; the fix is to declare the format in the tool or to drop it
 * from the block. A value nothing settled falls back to the exact compare and carries the `no_decider` lint instead.
 */
function unstatedFormat(
  value: ValueCase,
  policy: ValuePolicy,
  result: LadderResult,
  settledBy: ValuePolicyItem,
): string | undefined {
  const asks = policy.items.some(
    (item) => item.enabled !== false && item.effect?.lint_when === 'test_demands_unstated_format',
  );
  if (!asks) return undefined;
  if (result.names.compare === 'exact' || result.names.tool_replayable === true) return undefined;
  if (result.names.contract !== 'none') return undefined;
  if (settledBy === undefined || !WRITING_RUNGS.has(settledBy.impl) || result.outcome !== 'pass')
    return undefined;
  const where = value.tool === undefined ? value.field : `${value.tool} input.${value.field}`;
  return `the block demands the writing ${show(value.gold)} for ${where}, but neither the tool nor the prompt states a format; declare it in the tool (a pattern or an enum) or drop it from the block`;
}
