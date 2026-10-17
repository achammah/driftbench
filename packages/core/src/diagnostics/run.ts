import { z } from 'zod';
import type { CheckContext } from '../contracts/check';
import type { UsedObject } from '../objects/layers';
import { type ObjectRegistry, objectRegistry, type ResolvedObject } from '../objects/resolve';
import { describeError } from '../runner/retry';
import type { By, Diagnosis, RunResult, Verdict } from '../schema/run';
import { Diagnosis as DiagnosisSchema } from '../schema/run';

/**
 * Diagnostics: procedures that run after a block's checks, read its verdicts and what was observed, and write
 * diagnoses. A diagnosis explains, attributes or measures; it never changes a verdict or `pass`.
 */

/** What a step costs: `static` reads the record only; `run` runs the agent or a tool again; `model` calls a model. */
export const StepCost = z.enum(['static', 'run', 'model']);
export type StepCost = z.infer<typeof StepCost>;

/** Where a diagnostic runs: on one block after its checks, on a whole run, or on every run of a campaign. */
export type DiagnosticScope = 'block' | 'run' | 'campaign';

/** A diagnosis with its source identity; run-scope diagnoses have no block index. */
export type CampaignDiagnosis = {
  readonly runId: string;
  readonly blockIndex: number | undefined;
  readonly verdictRef: string | undefined;
  readonly diagnosis: Diagnosis;
};

/**
 * What one step reads: its scope; the block as its checks saw it (block scope only); the run (run scope) or the
 * runs (campaign scope); the verdicts in scope; the objects; its params; the earlier steps' output.
 */
export type DiagnosticStepContext = {
  readonly scope: DiagnosticScope;
  /** The block's check context; present at block scope only. */
  readonly check?: CheckContext;
  /** The run, at run scope. */
  readonly run?: RunResult;
  /** Every run of the campaign, at campaign scope. */
  readonly runs?: readonly RunResult[];
  /** Stored diagnoses in scope, with source identity. Run scope includes only this run. */
  readonly diagnoses?: readonly CampaignDiagnosis[];
  readonly verdicts: readonly Verdict[];
  readonly objects: readonly UsedObject[];
  readonly params: Readonly<Record<string, unknown>>;
  /** What the earlier steps of the same diagnostic wrote on this block. */
  readonly earlier: readonly Diagnosis[];
};

/** A step can name its deciding rule in `by`; the runner then records the executing step in `via`. */
export type StepOutput = Omit<Diagnosis, 'diagnostic' | 'step' | 'by' | 'via'> & { by?: By };

/** A step implementation a diagnostic item names by its impl. */
export type DiagnosticStep = {
  /** The schema the item's params must pass, checked when the diagnostic resolves. */
  params: z.ZodType;
  cost: StepCost;
  summary?: string;
  run(
    ctx: DiagnosticStepContext,
  ): StepOutput | StepOutput[] | undefined | Promise<StepOutput | StepOutput[] | undefined>;
};

const steps = new Map<string, DiagnosticStep>();

/**
 * Registers a diagnostic step under an implementation name: `builtin:<name>` for a driftbench package,
 * `plugin:<name>` for a plugin. A name registered twice is refused. A diagnostic item naming a step nobody
 * registered is refused when the diagnostic resolves: at load.
 */
export function registerDiagnosticStep(
  name: string,
  step: DiagnosticStep,
  registry: ObjectRegistry = objectRegistry,
): void {
  if (steps.has(name)) throw new Error(`the diagnostic step ${name} is already registered`);
  registry.registerImpl(name, {
    params: step.params,
    kinds: ['diagnostic'],
    ...(step.summary === undefined ? {} : { summary: step.summary }),
  });
  steps.set(name, step);
}

/** The step registered under an implementation name. */
export function diagnosticStep(name: string): DiagnosticStep | undefined {
  return steps.get(name);
}

/** How much a block's diagnostics may spend: the number of `run` and `model` steps they may take. Default 0. */
export type DiagnosticBudget = { runs?: number };

type MatchValue = string | readonly string[];
type DiagnosticWhen = {
  always?: true;
  any_verdict?: { name?: string; outcome?: string; id_contains?: string; gating?: boolean };
  any_diagnosis?: {
    diagnostic?: MatchValue;
    step?: MatchValue;
    disposition?: MatchValue;
    confidence?: MatchValue;
  };
};

function matches(wanted: MatchValue | undefined, value: string | undefined): boolean {
  return (
    wanted === undefined ||
    (typeof wanted === 'string' ? wanted === value : wanted.some((entry) => entry === value))
  );
}

function matchesDiagnostic(wanted: MatchValue | undefined, ref: string): boolean {
  if (wanted === undefined) return true;
  const id = /^diagnostic:([^@]+)@[^@]+$/.exec(ref)?.[1];
  return (
    matches(wanted, ref) || (id !== undefined && (matches(wanted, id) || matches(wanted, `diagnostic:${id}`)))
  );
}

/** Any declared trigger may fire. Filters within a trigger must all match the same record. */
export function triggers(
  object: ResolvedObject,
  verdicts: readonly Verdict[],
  diagnoses: readonly Diagnosis[] = [],
): boolean {
  const when = object.fields.when as DiagnosticWhen | undefined;
  if (when === undefined || when.always === true) return true;
  const verdictMatch = when.any_verdict;
  if (
    verdictMatch &&
    verdicts.some(
      (verdict) =>
        (verdictMatch.name === undefined || verdict.name === verdictMatch.name) &&
        (verdictMatch.outcome === undefined || verdict.outcome === verdictMatch.outcome) &&
        (verdictMatch.id_contains === undefined || verdict.id.includes(verdictMatch.id_contains)) &&
        (verdictMatch.gating === undefined || verdict.gating === verdictMatch.gating),
    )
  )
    return true;
  const diagnosisMatch = when.any_diagnosis;
  return (
    diagnosisMatch !== undefined &&
    diagnoses.some(
      (diagnosis) =>
        matchesDiagnostic(diagnosisMatch.diagnostic, diagnosis.diagnostic) &&
        matches(diagnosisMatch.step, diagnosis.step) &&
        matches(diagnosisMatch.disposition, diagnosis.disposition) &&
        matches(diagnosisMatch.confidence, diagnosis.confidence),
    )
  );
}

/** The scope a diagnostic runs at: its `scope` field, block when absent. */
export function scopeOf(diagnostic: ResolvedObject): DiagnosticScope {
  return (diagnostic.fields.scope as DiagnosticScope | undefined) ?? 'block';
}

type ScopeInput = {
  diagnoses?: readonly CampaignDiagnosis[];
  check?: CheckContext;
  run?: RunResult;
  runs?: readonly RunResult[];
  verdicts: readonly Verdict[];
  objects: readonly UsedObject[];
};

/**
 * Runs the diagnostics of one scope, in order, each step in its diagnostic's item order. A diagnostic of another
 * scope is left out; one fires on its `when` over the verdicts in scope; a disabled step is left out; a step of
 * cost class `run` or `model` runs only while the budget lasts, and is counted in `skippedForBudget` otherwise. A
 * step that throws writes a diagnosis that says so. The verdicts are read, never changed.
 */
async function runScope(
  scope: DiagnosticScope,
  diagnostics: readonly ResolvedObject[],
  input: ScopeInput,
  budget: DiagnosticBudget,
): Promise<{ diagnoses: Diagnosis[]; skippedForBudget: number }> {
  const diagnoses: Diagnosis[] = [];
  let left = budget.runs ?? 0;
  let skippedForBudget = 0;
  for (const diagnostic of diagnostics) {
    if (
      scopeOf(diagnostic) !== scope ||
      !triggers(diagnostic, input.verdicts, [
        ...(input.diagnoses ?? []).map((entry) => entry.diagnosis),
        ...diagnoses,
      ])
    )
      continue;
    const own: Diagnosis[] = [];
    for (const item of diagnostic.items) {
      if (!item.enabled) continue;
      const step = steps.get(item.impl);
      const by: By = { object: diagnostic.ref, item: item.id, impl: item.impl, layer: item.layer };
      const stamp = (output: StepOutput): Diagnosis => ({
        ...output,
        diagnostic: diagnostic.ref,
        step: item.id,
        by: output.by ?? by,
        ...(output.by === undefined ? {} : { via: by }),
      });
      if (!step) {
        own.push(stamp({ summary: `no diagnostic step is registered as ${item.impl}` }));
        continue;
      }
      if (step.cost !== 'static') {
        if (left <= 0) {
          skippedForBudget += 1;
          continue;
        }
        left -= 1;
      }
      try {
        const out = await step.run({ ...input, scope, params: item.params, earlier: own });
        for (const output of out === undefined ? [] : Array.isArray(out) ? out : [out]) {
          const parsed = DiagnosisSchema.safeParse(stamp(output));
          own.push(
            parsed.success
              ? parsed.data
              : stamp({
                  summary:
                    `the step returned a diagnosis the schema refuses: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`.trim(),
                }),
          );
        }
      } catch (cause) {
        own.push(stamp({ summary: `the step threw ${describeError(cause)}` }));
      }
    }
    diagnoses.push(...own);
  }
  return { diagnoses, skippedForBudget };
}

/** Runs a block's block-scope diagnostics after its checks; they land on `BlockResult.diagnoses`. */
export function runDiagnostics(
  diagnostics: readonly ResolvedObject[],
  input: { check: CheckContext; verdicts: readonly Verdict[]; objects: readonly UsedObject[] },
  budget: DiagnosticBudget = {},
): Promise<{ diagnoses: Diagnosis[]; skippedForBudget: number }> {
  return runScope('block', diagnostics, input, budget);
}

function diagnosesOfRun(run: RunResult): CampaignDiagnosis[] {
  return [
    ...run.blocks.flatMap((block) =>
      (block.diagnoses ?? []).map((diagnosis) => ({
        runId: run.runId,
        blockIndex: block.index,
        verdictRef: diagnosis.verdictRef,
        diagnosis,
      })),
    ),
    ...(run.diagnoses ?? []).map((diagnosis) => ({
      runId: run.runId,
      blockIndex: undefined,
      verdictRef: diagnosis.verdictRef,
      diagnosis,
    })),
  ];
}

/** Runs the run-scope diagnostics over a whole run, every block's verdicts in scope; they land on `RunResult.diagnoses`. */
export function runRunDiagnostics(
  diagnostics: readonly ResolvedObject[],
  run: RunResult,
  objects: readonly UsedObject[] = [],
  budget: DiagnosticBudget = {},
): Promise<{ diagnoses: Diagnosis[]; skippedForBudget: number }> {
  return runScope(
    'run',
    diagnostics,
    {
      run,
      verdicts: run.blocks.flatMap((block) => block.verdicts),
      diagnoses: diagnosesOfRun(run),
      objects,
    },
    budget,
  );
}

/**
 * Runs the campaign-scope diagnostics over every run of a campaign, every verdict in scope; they land on
 * `Campaign.diagnoses`.
 */
export function runCampaignDiagnostics(
  diagnostics: readonly ResolvedObject[],
  runs: readonly RunResult[],
  budget: DiagnosticBudget = {},
): Promise<{ diagnoses: Diagnosis[]; skippedForBudget: number }> {
  const verdicts = runs.flatMap((run) => run.blocks.flatMap((block) => block.verdicts));
  const diagnoses = runs.flatMap(diagnosesOfRun);
  return runScope('campaign', diagnostics, { runs, verdicts, diagnoses, objects: [] }, budget);
}
