import {
  type CampaignDiagnosis,
  type CheckContext,
  type StepOutput as DiagnosticStepOutput,
  evidence,
  type ResolvedObject,
  type RunResult,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { z } from 'zod';
import type { PlacedBefore, PolicyView } from '../placement/apply';
import { DEFAULT_VALUE_POLICY, policyOf as valuePolicyOf } from '../value-check/ladder';
import { diagnoseBlock } from './attribute';
import { campaignDiagnoses } from './campaign';
import {
  type ConfirmQuote,
  type ConfirmResult,
  type ConfirmRunner,
  planConfirm,
  runConfirm,
} from './confirm';
import { fixPlan } from './fixplan';
import { flakyBlocks } from './flaky';
import { checkEvidenceInputs, sentUser } from './inputs';
import { shippedPolicy } from './objects';
import { blameServices } from './services';
import type { BlameDiagnosis } from './types';
import { replayedValueFacts } from './values';

/**
 * The steps the shipped diagnostics name (`packages/checks/objects/diagnostic/*.yaml`), in the shape of the
 * diagnostics runner (block framework F5): each declares its params schema and its cost class, and returns
 * diagnoses. The steps of one diagnostic on one block (or one campaign) share a working state, keyed by the
 * runner's per-diagnostic `earlier` list: each step marks its stage, and the step whose `emit` param is true
 * writes. A stage whose step is disabled is skipped. No step changes a verdict or `pass`.
 */

/** What a block step reads: the context the checks ran with, the block's verdicts, its objects, its params. */
export type BlockStepContext = {
  readonly check: Pick<CheckContext, 'observed' | 'expect' | 'spec' | 'block' | 'stimulus'> &
    Partial<Pick<CheckContext, 'given' | 'blockIndex'>>;
  readonly verdicts: readonly Verdict[];
  readonly objects: ReadonlyArray<{ object: ResolvedObject }>;
  readonly params: Readonly<Record<string, unknown>>;
  readonly earlier: readonly StepOutput[];
  /** Earlier diagnoses of the estate version, for recurrence, when the runner reads the store. */
  readonly history?: readonly PlacedBefore[];
};

/** What a campaign step reads: every run of the campaign and the diagnoses its blocks hold. */
export type CampaignStepContext = {
  readonly runs: readonly RunResult[];
  /** Identified diagnoses supplied by the core runner; no local run-record traversal. */
  readonly diagnoses: readonly CampaignDiagnosis[];
  readonly objects: ReadonlyArray<{ object: ResolvedObject }>;
  readonly params: Readonly<Record<string, unknown>>;
  readonly earlier: readonly StepOutput[];
  /** A stand-in command or a reference target that makes a confirm run; absent means nothing can run. */
  readonly confirmRunner?: ConfirmRunner;
  /** Binding upper bound per billed runner call, including all requested repeats. */
  readonly confirmQuote?: ConfirmQuote;
  /** True when the runner is a stand-in command: its runs cost nothing, so a budget of 0 does not stop them. */
  readonly confirmFree?: boolean;
  /**
   * Re-diagnoses one block with stored confirm evidence (by verdict id), for the rerun step: the runner joins the
   * block's stored run, its spec and the map.
   */
  readonly rediagnose?: (
    block: string,
    confirm: Readonly<Record<string, evidence.ConfirmEvidence>>,
  ) => BlameDiagnosis[];
};

/** A diagnosis as a step writes it, before the runner stamps `diagnostic`, `step` and `by`. */
export type StepOutput = DiagnosticStepOutput;

export type StepCost = 'static' | 'run' | 'model';

export type BlameStep<Ctx> = {
  params: z.ZodType;
  cost: StepCost;
  summary: string;
  run: (ctx: Ctx) => StepOutput[] | undefined | Promise<StepOutput[] | undefined>;
};

/** A blame diagnosis as a step output. */
export function toStepOutput(one: BlameDiagnosis): StepOutput {
  const target = one.fix_target === undefined ? '' : ` (${one.fix_target})`;
  return {
    summary: `${one.verdict_ref}: ${one.disposition}, ${one.fault.join(' and ')}; fix ${one.fix_action} at ${one.fix_location}${target}`,
    verdictRef: one.verdict_ref,
    rule: one.rule,
    ...(one.by === undefined ? {} : { by: one.by }),
    fault: one.fault,
    fixLocation: one.fix_location,
    flags: one.flags,
    evidence: {
      ...one.evidence,
      item: one.item,
      home: one.home,
      ...(one.act === undefined ? {} : { act: one.act }),
    },
    disposition: one.disposition,
    ...(one.inherits === undefined ? {} : { inherits: one.inherits }),
    ...(one.fix_target === undefined ? {} : { fixTarget: one.fix_target }),
    fixAction: one.fix_action,
    fixForms: one.fix_forms,
    placement: one.placement,
    confidence: one.confidence,
    ...(one.remove_copies === undefined ? {} : { removeCopies: one.remove_copies }),
  };
}

/** The object of a kind the block resolved, else the shipped default. */
function policyOf(
  objects: ReadonlyArray<{ object: ResolvedObject }>,
  kind: 'policy/blame' | 'policy/placement',
): ResolvedObject {
  return objects.find((one) => one.object.kind === kind)?.object ?? shippedPolicy(kind);
}

type State = { stages: Set<string>; confirm?: ConfirmResult };
const states = new WeakMap<object, State>();

/** The working state of one diagnostic on one block or campaign: keyed by the runner's `earlier` list. */
function stateOf(key: object): State {
  const known = states.get(key);
  if (known) return known;
  const fresh: State = { stages: new Set() };
  states.set(key, fresh);
  return fresh;
}

const Emit = z.strictObject({ emit: z.boolean() });

/** Placement with every item but `fixed` left out: the blame item's own fix location stands. */
function fixedOnly(placement: PolicyView): PolicyView {
  return { ...placement, items: placement.items.filter((item) => item.id === 'fixed') };
}

function blockStep(
  stage: 'chain' | 'evidence' | 'value-evidence' | 'attribute' | 'place',
  summary: string,
): BlameStep<BlockStepContext> {
  return {
    params: Emit,
    cost: 'static',
    summary,
    run: async (ctx) => {
      const state = stateOf(ctx.earlier);
      state.stages.add(stage);
      if (ctx.params.emit !== true) return undefined;
      if (!state.stages.has('attribute')) return [];
      const valueMode = state.stages.has('value-evidence');
      const placement = policyOf(ctx.objects, 'policy/placement');
      const valueObject = ctx.objects.find((one) => one.object.kind === 'policy/value-check')?.object;
      const valuePolicy = valueObject === undefined ? undefined : valuePolicyOf(valueObject);
      const services = blameServices();
      // The services belong to the block, not to a diagnostic: every diagnostic that attributes a verdict
      // decides it the same way, so the result does not depend on which one runs first. A value the check
      // compared exactly (no decider was configured) is decided again with the value services; the other
      // values keep the decisions the check stored. A service that throws is reported and read as unknown.
      const errors: string[] = [];
      const values: Record<string, readonly evidence.ValueFact[]> = {};
      if (services.value !== undefined) {
        for (const verdict of ctx.verdicts) {
          if (!verdict.gating || verdict.outcome !== 'fail') continue;
          if (evidence.verdictSubject(verdict.id).part !== 'input') continue;
          try {
            const replayed = await replayedValueFacts(
              ctx.check,
              verdict,
              valuePolicy ?? DEFAULT_VALUE_POLICY,
              services.value,
            );
            values[verdict.id] = replayed.facts;
            // A judge that threw is swallowed by the ladder (the value stays inconclusive); report it.
            for (const failure of replayed.errors) errors.push(`error:value_service_failed:${failure}`);
          } catch (cause) {
            errors.push(`error:value_service_failed:${describe(cause)}`);
          }
        }
      }
      let reply: evidence.ReplyReading | undefined;
      if (services.reply !== undefined) {
        try {
          const user = sentUser(ctx.check);
          reply = await services.reply({
            ...(user === undefined ? {} : { user }),
            reply: ctx.check.observed.text,
          });
        } catch (cause) {
          errors.push(`error:reply_reader_failed:${describe(cause)}`);
        }
      }
      const tools = (ctx.check.expect?.tools ?? [])
        .filter((tool) => tool.count !== 0)
        .map((tool) => tool.label);
      const result = diagnoseBlock({
        verdicts: ctx.verdicts,
        evidenceFor: checkEvidenceInputs(ctx.check, ctx.verdicts, {
          ...(valuePolicy === undefined ? {} : { valuePolicy }),
          ...(Object.keys(values).length === 0 ? {} : { values }),
          ...(reply === undefined ? {} : { extra: { reply } }),
        }),
        tools,
        blame: policyOf(ctx.objects, 'policy/blame'),
        placement: state.stages.has('place') ? placement : fixedOnly(placement),
        chain: state.stages.has('chain'),
        ...(ctx.history === undefined ? {} : { history: ctx.history }),
      });
      // The value-mismatch diagnostic explains the values the agent sent: the other roots are not its subject.
      const diagnoses = valueMode
        ? result.diagnoses.filter((one) => evidence.verdictSubject(one.verdict_ref).part === 'input')
        : result.diagnoses;
      return [...diagnoses.map(toStepOutput), ...errors.map(errorOutput)];
    },
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

/** A failed service as a diagnosis without a verdict: the block keeps every other diagnosis. */
function errorOutput(flag: string): StepOutput {
  const [, kind = 'service_failed', ...rest] = flag.split(':');
  const what = kind === 'reply_reader_failed' ? 'the reply reader' : 'the value service';
  return {
    summary: `${what} threw ${rest.join(':')}; the reading is unknown and the rules that need it did not match`,
    flags: [`error:${kind}`],
    confidence: 'undecided',
  };
}

function marker(stage: string, summary: string): BlameStep<CampaignStepContext> {
  return {
    params: z.strictObject({}),
    cost: 'static',
    summary,
    run: (ctx) => {
      stateOf(ctx.earlier).stages.add(stage);
      return undefined;
    },
  };
}

export const BLOCK_STEPS: Readonly<Record<string, BlameStep<BlockStepContext>>> = {
  'builtin:blame/chain': blockStep('chain', 'Only the root of each chain of failing verdicts is attributed.'),
  'builtin:blame/evidence': blockStep(
    'evidence',
    'The evidence names of each root, from the stored run and the map.',
  ),
  'builtin:blame/value-evidence': blockStep(
    'value-evidence',
    "The value check's record of each failing value; a value the check compared exactly is decided again with the services given.",
  ),
  'builtin:blame/attribute': blockStep('attribute', 'policy/blame, first match in order.'),
  'builtin:placement/apply': blockStep('place', 'policy/placement, with recurrence from the history given.'),
};

export const CAMPAIGN_STEPS: Readonly<Record<string, BlameStep<CampaignStepContext>>> = {
  'builtin:placement/recurrence': marker(
    'recurrence',
    'Signatures and homes over every diagnosis of the campaign.',
  ),
  'builtin:fix-plan/replace': marker(
    'replace',
    'Re-place each diagnosis whose signature crossed a threshold.',
  ),
  'builtin:fix-plan/merge': marker(
    'merge',
    'One fix per target and action; local copies listed for removal.',
  ),
  'builtin:rank/top-n': {
    params: z.strictObject({ n: z.number().int().min(1), by: z.array(z.string()) }),
    cost: 'static',
    summary: 'Rank the fixes: agent blocks, then blocks, then cost.',
    run: (ctx) => {
      const stages = stateOf(ctx.earlier).stages;
      const placement = policyOf(ctx.objects, 'policy/placement');
      const plan = fixPlan(
        campaignDiagnoses(ctx.diagnoses),
        stages.has('recurrence') && stages.has('replace') ? placement : fixedOnly(placement),
        Number(ctx.params.n),
      );
      return plan.fixes.map((fix, index) => ({
        summary: `${index + 1}. ${fix.fix_action} at ${fix.fix_location}${fix.fix_target === undefined ? '' : ` (${fix.fix_target})`}: ${fix.blocks} block(s), ${fix.agent_blocks} the agent's${fix.superseded_by === undefined ? '' : `; a copy to remove, replaced by ${fix.superseded_by}`}`,
        fixLocation: fix.fix_location,
        ...(fix.fix_target === undefined ? {} : { fixTarget: fix.fix_target }),
        fixAction: fix.fix_action,
        fixForms: fix.fix_forms,
        score: fix.agent_blocks,
        confidence: fix.confidence,
        ...(fix.remove_copies.length === 0 ? {} : { removeCopies: fix.remove_copies }),
        evidence: {
          rank: index + 1,
          blocks: fix.blocks,
          agent_blocks: fix.agent_blocks,
          rules: fix.rules,
          cost_class: fix.cost_class,
          ...(fix.superseded_by === undefined ? {} : { superseded_by: fix.superseded_by }),
          ...(fix.rule_text === undefined ? {} : { rule_text: fix.rule_text }),
        },
      }));
    },
  },
  'builtin:confirm/plan': {
    params: z.strictObject({ runs: z.number().int().min(1) }),
    cost: 'static',
    summary: 'The cheapest run that could change each static or undecided diagnosis.',
    run: (ctx) => {
      const plan = planConfirm(campaignDiagnoses(ctx.diagnoses), Number(ctx.params.runs));
      const open = new Set(plan.map((one) => `${one.block} ${one.verdict_ref}`)).size;
      return [
        {
          summary: `planned ${plan.length} confirm run(s) for ${open} open diagnosis(es)`,
          evidence: { plan },
        },
      ];
    },
  },
  'builtin:confirm/run': {
    params: z.strictObject({
      runs: z.number().int().min(1),
      budget_usd: z.number().min(0),
      reference_target: z.string().nullable(),
    }),
    cost: 'run',
    summary: 'Runs the planned confirm runs within the budget; a stand-in command is free.',
    run: async (ctx) => {
      const plan = planConfirm(campaignDiagnoses(ctx.diagnoses), Number(ctx.params.runs));
      const result = await runConfirm(plan, {
        budgetUsd: Number(ctx.params.budget_usd),
        ...(ctx.confirmRunner === undefined ? {} : { runner: ctx.confirmRunner }),
        ...(ctx.confirmQuote === undefined ? {} : { quote: ctx.confirmQuote }),
        ...(ctx.confirmFree === true ? { free: true } : {}),
      });
      stateOf(ctx.earlier).confirm = result;
      return [
        {
          summary: result.reason ?? `made ${result.runs_made} confirm run(s) for ${result.cost_usd} USD`,
          evidence: {
            runs_made: result.runs_made,
            cost_usd: result.cost_usd,
            skipped_for_budget: result.skipped_for_budget,
          },
        },
      ];
    },
  },
  'builtin:confirm/store': marker(
    'store',
    'Stores reference_pass, reference_loads, forced_load_pass and hint_pass.',
  ),
  'builtin:diagnostic/rerun': {
    params: z.strictObject({ diagnostic: z.string() }),
    cost: 'static',
    summary:
      'Re-runs a block diagnostic with the stored confirm evidence; with none, the diagnoses stay static.',
    run: (ctx) => {
      const state = stateOf(ctx.earlier);
      const open = campaignDiagnoses(ctx.diagnoses).filter(
        (one) =>
          one.inherits === undefined && (one.confidence === 'static' || one.confidence === 'undecided'),
      );
      const stored = state.stages.has('store') ? (state.confirm?.stored ?? {}) : {};
      const byBlock = new Map<string, Record<string, evidence.ConfirmEvidence>>();
      for (const [key, value] of Object.entries(stored)) {
        const at = key.indexOf(' ');
        const block = key.slice(0, at);
        byBlock.set(block, { ...(byBlock.get(block) ?? {}), [key.slice(at + 1)]: value });
      }
      if (byBlock.size === 0 || ctx.rediagnose === undefined) {
        return open.map((one) => ({
          summary: `${one.block} ${one.verdict_ref}: static, no confirm run was made`,
          verdictRef: one.verdict_ref,
          confidence: 'static',
          flags: ['static'],
          evidence: { block: one.block, item: one.item },
        }));
      }
      const out: StepOutput[] = [];
      for (const [block, confirm] of byBlock) {
        for (const next of ctx.rediagnose(block, confirm)) {
          const before = campaignDiagnoses(ctx.diagnoses).find(
            (one) =>
              one.block === block && one.verdict_ref === next.verdict_ref && one.inherits === undefined,
          );
          const changed =
            before !== undefined && (before.item !== next.item || before.disposition !== next.disposition);
          out.push({
            ...toStepOutput(next),
            flags: [
              ...next.flags,
              ...(changed ? [`changed_from:${before?.item}:${before?.disposition}`] : []),
            ],
          });
        }
      }
      return out;
    },
  },
  'builtin:flaky/repeat-disagreement': {
    params: z.strictObject({ min_repeats: z.number().int().min(2) }),
    cost: 'static',
    summary: 'Blocks whose repeats both pass and fail.',
    run: (ctx) =>
      flakyBlocks(ctx.runs, Number(ctx.params.min_repeats))
        .filter((cell) => cell.flaky)
        .map((cell) => ({
          summary: `${cell.spec} block ${cell.block} on ${cell.target} (${cell.mode}): passed ${cell.passes} of ${cell.repeats} repeats`,
          score: cell.pass_share,
          flags: ['flaky'],
          evidence: { ...cell },
        })),
  },
};

/** Every step implementation this package ships, by name. */
export function blameStepNames(): string[] {
  return [...Object.keys(BLOCK_STEPS), ...Object.keys(CAMPAIGN_STEPS)].sort();
}
