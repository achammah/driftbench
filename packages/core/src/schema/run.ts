import { z } from 'zod';
import { DriftClass, GivenOrigin, Message, TargetRef, WorldState } from './common';
import { Layer } from './object';
import { BlockProvenance, CampaignProvenance, RejudgedFrom, RunProvenance } from './provenance';

/**
 * Run records written by the runner. Keys are camelCase. A run is one spec, on one target, in one
 * mode, for one repeat.
 */

export const RunMode = z.enum(['T', 'F', 'P']);
export type RunMode = z.infer<typeof RunMode>;

/** `not_applicable`: a check whose subject the run never produced (a stage check with no stage record). */
export const Outcome = z.enum(['pass', 'fail', 'inconclusive', 'not_applicable']);
export type Outcome = z.infer<typeof Outcome>;

/** The fully resolved initial conditions of a block. */
export const ResolvedGiven = z.strictObject({
  prefix: z.array(Message),
  /** The origin of the latest prefix, when the spec states one; it is hashed only when present. */
  origin: GivenOrigin.optional(),
  /**
   * With `origin`: how many of the first prefix messages the origin covers, the ones the spec wrote. Messages
   * after them (a run's own turns, a teacher-forced replay's canonical turns) are not covered. Outside the
   * Given hash; inside the block cache key, which reads the whole resolved Given.
   */
  originLength: z.number().int().nonnegative().optional(),
  ledger: z.record(z.string(), z.unknown()),
  world: WorldState,
  vars: z.record(z.string(), z.unknown()),
  target: TargetRef,
  hash: z.string().min(1),
});
export type ResolvedGiven = z.infer<typeof ResolvedGiven>;

export const ToolCall = z.strictObject({
  id: z.string().optional(),
  /** The trace span the call ran in, when the adapter has one (an OpenTelemetry span id). */
  spanId: z.string().optional(),
  label: z.string().min(1),
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const Cost = z.strictObject({
  /** Exact pricing key; otherwise the runner uses target.options.model. */
  model: z.string().min(1).optional(),
  /** Cache reads, included in inputTokens (not additional input tokens). */
  cachedInputTokens: z.number().int().nonnegative().optional(),
  usd: z.number().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});
export type Cost = z.infer<typeof Cost>;

/** Cost and latency an adapter can attach to one segment when its runtime reports them. */
const segmentMeasure = {
  cost: Cost.optional(),
  latencyMs: z.number().nonnegative().optional(),
};

/** One piece of what the agent produced in a block, in order. */
export const Segment = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string(), ...segmentMeasure }),
  z.strictObject({
    type: z.literal('tool_call'),
    id: z.string().optional(),
    label: z.string().min(1),
    input: z.unknown(),
    ...segmentMeasure,
  }),
  z.strictObject({
    type: z.literal('tool_result'),
    id: z.string().optional(),
    label: z.string().min(1),
    output: z.unknown(),
    error: z.string().optional(),
    ...segmentMeasure,
  }),
  z.strictObject({
    type: z.literal('card'),
    name: z.string().min(1),
    data: z.unknown().optional(),
    ...segmentMeasure,
  }),
]);
export type Segment = z.infer<typeof Segment>;

/** A file the agent left in its workspace. */
export const ArtifactRef = z.strictObject({
  path: z.string(),
  kind: z.string().optional(),
  sha256: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

/** What changed in the workspace during a block. */
export const WorkspaceDiff = z.strictObject({
  created: z.array(z.string()),
  changed: z.array(z.string()),
  deleted: z.array(z.string()),
});
export type WorkspaceDiff = z.infer<typeof WorkspaceDiff>;

/** One command the agent ran, with bounded output. `role` separates the agent's own process from the commands it ran. */
export const ExecutionRecord = z.strictObject({
  command: z.string(),
  role: z.enum(['agent', 'command']).optional(),
  exitCode: z.number().int(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  startedAt: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
  truncated: z.boolean().optional(),
  /** The approval policy's decision on this command and its cwd. Absent when no policy is set. */
  approval: z
    .strictObject({
      decision: z.enum(['allow', 'deny']),
      by: z.enum(['rule', 'default', 'approver', 'no-approver']),
      match: z.enum(['command', 'path']),
      subject: z.string(),
      pattern: z.string().optional(),
    })
    .optional(),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecord>;

/**
 * What the agent's runtime did around the model: capabilities loaded, checks that fired, stages reached.
 * Runtime-specific events (a harness hook, a process step, a board write) are mapped onto these by its adapter.
 */
export const RuntimeTrace = z.strictObject({
  skills: z.array(z.strictObject({ name: z.string(), at: z.string().optional() })).optional(),
  guards: z
    .array(
      z.strictObject({
        name: z.string(),
        verdict: z.string(),
        at: z.string().optional(),
        /** What the guard printed and how it ended, when the runtime reports its output. */
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        exitCode: z.number().int().optional(),
        /** The runtime's own word for how the run ended: success, blocking, cancelled, no_response. */
        outcome: z.string().optional(),
      }),
    )
    .optional(),
  stages: z
    .array(
      z.strictObject({
        name: z.string(),
        at: z.string().optional(),
        carried: z
          .boolean()
          .optional()
          .describe('True marks a stage carried into this block, not reported during it.'),
      }),
    )
    .optional(),
  /** Files the agent read during the block, by path. Absent when the runtime does not report them. */
  references: z.array(z.strictObject({ path: z.string(), at: z.string().optional() })).optional(),
  /** Why the model stopped, such as stop or length. Absent when the runtime does not report it. */
  finishReason: z.string().optional(),
  /** The tools the runtime offered the agent in the block, by name. Absent when the runtime does not report them. */
  offered: z.array(z.string()).optional(),
  /** Helpers the agent dispatched during the block. Absent when the runtime does not report them. */
  subagents: z
    .array(z.strictObject({ name: z.string(), model: z.string().optional(), at: z.string().optional() }))
    .optional(),
});
export type RuntimeTrace = z.infer<typeof RuntimeTrace>;

/** One retry of a model or adapter call: which call, which attempt failed, why, and how long it waited. */
export const RetryEvent = z.strictObject({
  call: z.string().min(1),
  /** The attempt that failed, counted from 1. */
  attempt: z.number().int().min(1),
  status: z.number().int().optional(),
  reason: z.string(),
  delayMs: z.number().nonnegative(),
  /** What the server's Retry-After asked, when it sent one. */
  retryAfterMs: z.number().nonnegative().optional(),
  at: z.string().optional(),
});
export type RetryEvent = z.infer<typeof RetryEvent>;

/** A history turn a wire serializer omits because its text is empty. */
export const HistoryNormalization = z.strictObject({
  wire: z
    .string()
    .min(1)
    .describe('The adapter wire that normalizes the history, such as anthropic or google.'),
  historyIndex: z
    .number()
    .int()
    .nonnegative()
    .describe('Zero-based index in the session history sent for this block, including system messages.'),
  role: z
    .enum(['system', 'user', 'assistant', 'tool'])
    .describe('The original role of the omitted text-only turn.'),
  kind: z
    .literal('omitted-empty-turn')
    .describe('An empty text-only turn is absent from the model input; no placeholder text replaces it.'),
});
export type HistoryNormalization = z.infer<typeof HistoryNormalization>;

/** Everything observed in one block. */
export const Observed = z.strictObject({
  segments: z.array(Segment),
  text: z.string(),
  toolCalls: z.array(ToolCall),
  runtime: RuntimeTrace.optional(),
  artifacts: z.array(ArtifactRef).optional(),
  workspaceDiff: WorkspaceDiff.optional(),
  executions: z.array(ExecutionRecord).optional(),
  /** The sandbox the block ran in, when the adapter owns one; reports say 'weak isolation' from this field. */
  sandbox: z
    .strictObject({ kind: z.string(), isolation: z.enum(['strong', 'weak']), root: z.string().optional() })
    .optional(),
  cost: Cost,
  latencyMs: z.number().nonnegative(),
  /** Every retry the block's calls took, the adapter's own and the runner's, in order. Absent when none. */
  retries: z.array(RetryEvent).optional(),
  /** Wire differences, absent when no empty text-only turn was omitted. */
  historyNormalizations: z.array(HistoryNormalization).optional(),
  raw: z.unknown().optional(),
});
export type Observed = z.infer<typeof Observed>;

export const Vote = z.strictObject({
  judge: z.string().min(1),
  outcome: Outcome,
  /** The explicitly named candidate on a pairwise request. A tie differs from missing evidence. */
  winner: z.enum(['A', 'B', 'tie', 'inconclusive']).optional(),
  score: z.number().optional(),
  reasoning: z.string().optional(),
  /** Every retry the judge's call took. Absent when none. */
  retries: z.array(RetryEvent).optional(),
});

/**
 * What produced a verdict or a diagnosis: `object` is `kind:id@hash8` of the resolved object (a check set,
 * a policy, a diagnostic), `item` the rule inside it, `impl` the implementation that ran, `layer` the layer
 * that last set the item. A published number therefore says which rules scored it.
 */
export const By = z.strictObject({
  object: z.string().min(1),
  item: z.string().min(1).optional(),
  impl: z.string().min(1),
  layer: Layer,
});
export type By = z.infer<typeof By>;

/** One check's result on one block. Machine verdicts are final; judge verdicts carry their votes. */
export const Verdict = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['machine', 'judge']),
  name: z.string().min(1),
  gating: z.boolean(),
  outcome: Outcome,
  score: z.number().optional(),
  evidence: z.string(),
  reasoning: z.string().optional(),
  judge: z.strictObject({ cls: z.enum(['system1', 'system2']), votes: z.array(Vote) }).optional(),
  /**
   * The value-check rungs that decided a tool argument, one entry per value a rung decided: the call (from 1),
   * the value's path, the rung (a policy item id, or `exact_fallback`) and its outcome. Absent when every value
   * equalled the gold or the assertion compares as written. No default, so records without it are unchanged.
   */
  valueCheck: z
    .array(
      z.strictObject({
        call: z.number().int().min(1),
        path: z.string().min(1),
        rung: z.string().min(1),
        outcome: Outcome,
      }),
    )
    .optional(),
  /** What produced the verdict: the object, its item, the implementation and the layer. Absent on older records. */
  by: By.optional(),
});
export type Verdict = z.infer<typeof Verdict>;

/** The objects a block resolved to, one per `uses` key that resolved, and one hash over them. */
export const ResolvedObjects = z.strictObject({
  objects: z.array(
    z.strictObject({
      /** The `uses` key: check_set, value_check, blame, diagnostics, ... */
      key: z.string().min(1),
      kind: z.string().min(1),
      id: z.string().min(1),
      /** The content hash of the resolved object. */
      hash: z.string().min(1),
      /** The layer whose reference chose it; `shipped` when no layer named one. */
      setAt: Layer,
    }),
  ),
  /** The content hash of `objects`: equal objects give equal hashes, run after run. */
  hash: z.string().min(1),
});
export type ResolvedObjects = z.infer<typeof ResolvedObjects>;

/**
 * What a diagnostic wrote about a block, after its checks. A diagnosis never changes `pass`: it explains a
 * verdict, attributes a fault, ranks causes or reports a measure computed from other verdicts.
 */
export const Diagnosis = z.strictObject({
  /** `diagnostic:<id>@hash8` of the diagnostic that wrote it. */
  diagnostic: z.string().min(1),
  /** The step of the diagnostic that wrote it. */
  step: z.string().min(1).optional(),
  /** The verdict it is about, when it is about one. */
  verdictRef: z.string().min(1).optional(),
  /** The rule that fired, as `kind:id@hash8#item`. */
  rule: z.string().min(1).optional(),
  fault: z.array(z.string().min(1)).optional(),
  fixLocation: z.string().min(1).optional(),
  flags: z.array(z.string().min(1)).optional(),
  /** A measure the diagnosis reports, such as the share of expected arguments that matched. */
  score: z.number().optional(),
  /** One line a reader can act on. */
  summary: z.string(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  rankedCauses: z
    .array(z.strictObject({ cause: z.string().min(1), score: z.number(), by: z.string().optional() }))
    .optional(),
  /** A chained verdict's root: the id of the verdict it inherits its fault from. */
  inherits: z.string().min(1).optional(),
  /** Who the fault is attributed to; the agent-attributed score reads it. */
  disposition: z.enum(['agent', 'shared', 'setup', 'excluded', 'credited', 'unassigned']).optional(),
  /** What the fix changes, such as a skill file or a tool contract. */
  fixTarget: z.string().min(1).optional(),
  /** What the fix does there. */
  fixAction: z.string().min(1).optional(),
  /** The forms the fix may take. */
  fixForms: z.array(z.string().min(1)).optional(),
  /** Where the fix goes, as `kind:id@hash8#item` of the placement rule that chose it. */
  placement: z.string().min(1).optional(),
  /** How sure the attribution is: read statically, undecided, or confirmed by a rerun. */
  confidence: z.enum(['static', 'undecided', 'confirmed']).optional(),
  /** The local copies a shared fix makes redundant, to remove. */
  removeCopies: z.array(z.string().min(1)).optional(),
  by: By,
  /** The executing diagnostic step, when `by` names a more specific deciding rule. */
  via: By.optional(),
});
export type Diagnosis = z.infer<typeof Diagnosis>;

/** Provenance of a copy whose realized text was removed by its destination's privacy policy. */
const RealizedTextStripped = z.strictObject({
  fromRun: z.string().min(1),
  fromCampaign: z.string().min(1).optional(),
});
/**
 * A block's verdict. `pass` and `fail` are measurements. `not_run`: the block was never sent, because its
 * Given could not be applied (a layer the adapter cannot apply, an unmet or failed setup). `blocked`: an
 * ancestor the block depends on failed, so the block was not run. Neither is a pass or a fail.
 */
export const BlockStatus = z.enum(['pass', 'fail', 'not_run', 'blocked']);
export type BlockStatus = z.infer<typeof BlockStatus>;

/** Why a block was not run: the check that refused its Given, on which layer, what it expected and what it got. */
export const NotRun = z.strictObject({
  /** given_unmet: the Given is wrong; unsupported: the adapter cannot apply a layer; setup_failed: setup broke. */
  kind: z.enum(['given_unmet', 'unsupported', 'setup_failed']),
  layer: z.string().min(1),
  check: z.string().min(1),
  expected: z.string(),
  got: z.string(),
});
export type NotRun = z.infer<typeof NotRun>;

/** Why a block was blocked: the ancestor that failed (`by`) and the earliest failing ancestor (`root`). */
export const Blocked = z.strictObject({
  by: z.string().min(1),
  root: z.string().min(1),
  reason: z.string().optional(),
});
export type Blocked = z.infer<typeof Blocked>;

export const BlockResult = z
  .strictObject({
    realizedTextStripped: RealizedTextStripped.optional(),
    provenance: BlockProvenance.optional(),
    carried: z.lazy(() => CarriedFrom.extend({ measuredAt: z.string().optional() })).optional(),
    rejudged: RejudgedFrom.optional(),
    index: z.number().int().min(0),
    blockId: z.string().optional(),
    parent: z.string().optional(),
    /** Authored index when parent scheduling changes execution order. */
    specIndex: z.number().int().min(0).optional(),
    injected: z.boolean().optional(),
    /**
     * Present when the text the driver sent differs from the text the spec block wrote (a simulated user, a
     * red-team attacker). The sent text is the user messages the agent received, joined by newlines; `hash`
     * is its SHA-256 (of its canonical JSON). `text` holds it only when the run asked for it
     * (`recordRealizedText`): what a driver writes may be private, so by default only the hash is kept. Only
     * the text is compared; a change of form alone (the same text as an injection) is in `injected`. Absent
     * means the authored text was sent. The provenance digest covers it.
     */
    realized: z
      .strictObject({ hash: z.string().regex(/^[0-9a-f]{64}$/), text: z.string().optional() })
      .optional(),
    givenHash: z.string().min(1),
    /** The key the block's observed record is cached under: what a replay looked up. */
    cacheKey: z.string().min(1).optional(),
    observed: Observed,
    verdicts: z.array(Verdict),
    /** What the diagnostics wrote after the checks. Absent when none ran; never changes `pass`. */
    diagnoses: z.array(Diagnosis).optional(),
    /** Diagnostic steps of cost class `run` left out because the diagnostic budget was spent. Absent when none. */
    skippedForBudget: z.number().int().min(1).optional(),
    /** The objects the block was scored with. Absent on older records. */
    resolved: ResolvedObjects.optional(),
    stageObserved: z.string().optional(),
    ledgerCheck: z.strictObject({ ok: z.boolean(), contradictions: z.array(z.string()) }),
    drift: z.array(DriftClass),
    /** False on a not_run or blocked block: an old reader never counts one as a pass. */
    pass: z.boolean(),
    /** Written only on a not_run or blocked block; absent, the status is pass or fail as `pass` says. */
    status: BlockStatus.optional(),
    notRun: NotRun.optional(),
    blocked: Blocked.optional(),
  })
  .superRefine((block, context) => {
    // A record that says two things is refused: `status` pass needs `pass` true; fail, not_run and blocked need
    // it false. A missing status is the runner's normal form for a pass or a fail.
    if (block.status !== undefined && block.pass !== (block.status === 'pass')) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: `status ${block.status} contradicts pass ${block.pass}: ${block.status === 'pass' ? 'a passing block has pass true' : 'a block that did not pass has pass false'}`,
      });
    }
  });
export type BlockResult = z.infer<typeof BlockResult>;

export const Succession = z.strictObject({
  firstDriftBlock: z.number().int().min(0).optional(),
  driftCount: z.number().int().min(0),
  driftRate: z.number().min(0).max(1),
  longestClean: z.number().int().min(0),
  minOverBlocks: z.boolean(),
});

export const Recovery = z.strictObject({
  injectedAt: z.number().int().min(0),
  turnsToRecover: z.number().int().min(0).optional(),
  label: z.enum(['immediate', 'late', 'never']),
  collateral: z.number().int().min(0),
  safeAction: z.boolean().optional(),
  clarified: z.boolean().optional(),
});

/**
 * What the runner reports as a run goes, in order. A model call carries its tokens, cost and latency when the adapter
 * gives them; its start is the reply time less its latency.
 */
export const RunEvent = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('block_start'), index: z.number().int().min(0), at: z.string().min(1) }),
  z.strictObject({
    type: z.literal('model_call'),
    index: z.number().int().min(0),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    usd: z.number().nonnegative().optional(),
    latencyMs: z.number().nonnegative().optional(),
    startedAt: z.string().min(1),
    at: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal('tool_call'),
    index: z.number().int().min(0),
    label: z.string().min(1),
    spanId: z.string().optional(),
    error: z.string().optional(),
    at: z.string().min(1),
  }),
  z.strictObject({ type: z.literal('retry'), index: z.number().int().min(0), at: z.string().min(1) }),
  z.strictObject({
    type: z.literal('block_end'),
    index: z.number().int().min(0),
    pass: z.boolean(),
    /** Set on a not_run or blocked block. */
    status: BlockStatus.optional(),
    at: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal('run_end'),
    status: z.enum(['completed', 'failed', 'stopped']),
    at: z.string().min(1),
  }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

/**
 * Where a carried run comes from. A campaign that runs the blast radius of a change copies the stored run
 * of every cell outside the radius: the copy is the baseline result, not a new measurement.
 */
export const CarriedFrom = z.strictObject({
  /** The campaign that ran the cell fresh, however many campaigns carried it since. */
  fromCampaign: z.string().min(1),
  /** The run id of that fresh run. */
  fromRun: z.string().min(1),
  /** The agent version that produced the result, when the fresh run named one. */
  agentVersion: z.string().min(1).optional(),
  age: z.strictObject({
    /** Consecutive campaigns that carried the result: 1 on its first carry. */
    campaigns: z.number().int().min(1),
    /** Days between the end of the fresh run and the start of the campaign that carries it. */
    days: z.number().nonnegative(),
  }),
});
export type CarriedFrom = z.infer<typeof CarriedFrom>;

export const RunResult = z.strictObject({
  realizedTextStripped: RealizedTextStripped.optional(),
  provenance: RunProvenance.optional(),
  blockRerun: z
    .strictObject({
      selected: z.array(z.number().int().nonnegative()),
      downstreamNotRerun: z.array(z.number().int().nonnegative()),
      reason: z.string(),
    })
    .optional(),
  rejudged: RejudgedFrom.optional(),
  /** Integrity of the run stamp and every block stamp, including the resolved Given hash. */
  provenanceDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  runId: z.string().min(1),
  specId: z.string().min(1),
  specHash: z.string().min(1),
  target: TargetRef,
  mode: RunMode,
  repeat: z.number().int().min(0),
  perturbationId: z.string().optional(),
  status: z.enum(['completed', 'failed', 'stopped']),
  /** The driver or spec's end verdict. Inconclusive means the run could not be judged. */
  endVerdict: z.enum(['success', 'failure', 'inconclusive']).optional(),
  error: z.string().optional(),
  blocks: z.array(BlockResult),
  /** What the run-scope diagnostics wrote over the whole run. Absent when none ran; never changes a pass. */
  diagnoses: z.array(Diagnosis).optional(),
  /** Run-scope diagnostic steps skipped because their run/model budget was exhausted. Absent when none. */
  skippedForBudget: z.number().int().min(1).optional(),
  succession: Succession,
  recovery: Recovery.optional(),
  endState: z
    .strictObject({
      match: z.boolean(),
      diff: z.array(z.strictObject({ field: z.string(), expected: z.unknown(), observed: z.unknown() })),
    })
    .optional(),
  /**
   * The end state the adapter returned for `endState`, as the checks saw it (null when its source recorded
   * nothing). Absent when no end state was read, and in runs stored before this field existed.
   */
  endStateValue: z.unknown().optional(),
  cost: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  cacheHit: z.boolean(),
  /** The events the run reported, in order, when the run recorded them. Absent otherwise. */
  events: z.array(RunEvent).optional(),
  /** Set on a run carried from an earlier campaign: no agent ran for it in this campaign. Absent on a fresh run. */
  carried: CarriedFrom.optional(),
});
export type RunResult = z.infer<typeof RunResult>;

export const JudgeConfig = z.strictObject({
  mode: z.enum(['system1', 'hybrid', 'llm']),
  judges: z.array(z.string().min(1)),
  assignment: z.string().optional(),
});

/** One immutable registry version a campaign ran with: a dataset of specs or a prompt. */
export const RegistrySource = z.strictObject({
  kind: z.enum(['dataset', 'prompt']),
  name: z.string().min(1),
  version: z.number().int().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type RegistrySource = z.infer<typeof RegistrySource>;

/** What a radius campaign ran fresh and what it carried, and from where. */
export const CampaignRadius = z.strictObject({
  /** The content hash of the change manifest. */
  manifest: z.string().min(1),
  /** The agent versions the manifest goes from and to. */
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
  /** The changes of the manifest, as the radius prints them. */
  changes: z.array(z.string()),
  /** The campaign the carried runs were read from. */
  from: z.string().min(1),
  /** Set when the radius was the whole suite, with the reason. */
  whole: z.strictObject({ change: z.string(), reason: z.string() }).optional(),
  /** Cells run fresh, cells carried, and cells outside the radius (carried, or refused and run fresh). */
  fresh: z.number().int().min(0),
  carried: z.number().int().min(0),
  outside: z.number().int().min(0),
  /** Why cells outside the radius ran fresh all the same, with how many. */
  refused: z.array(z.strictObject({ reason: z.string().min(1), cells: z.number().int().min(1) })),
  /**
   * The audit sample, when one was asked for: cells about to be carried, run fresh and compared with the
   * stored run. One miss fails closed: the campaign then carried nothing.
   */
  audit: z
    .strictObject({
      sampled: z.number().int().min(0),
      misses: z.number().int().min(0),
      seed: z.number().int(),
      /** The cells whose fresh run disagreed with the stored one, with what differed. */
      missed: z.array(
        z.strictObject({
          specId: z.string().min(1),
          cellId: z.string().min(1),
          differing: z.array(z.string()),
        }),
      ),
    })
    .optional(),
});
export type CampaignRadius = z.infer<typeof CampaignRadius>;

/** A campaign pins spec versions, targets, modes and repeats. A re-run is a new campaign. */
export const Campaign = z.strictObject({
  provenance: CampaignProvenance.optional(),
  rejudged: z.array(RejudgedFrom).optional(),
  /** What the campaign-scope diagnostics wrote over the runs, when the command that wrote this record ran them. */
  diagnoses: z.array(Diagnosis).optional(),
  campaignId: z.string().min(1),
  specs: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        hash: z.string().min(1),
        /** The one target this spec runs on. Without it, the spec runs on every target of the campaign. */
        target: TargetRef.optional(),
      }),
    )
    .min(1),
  targets: z.array(TargetRef).min(1),
  modes: z.array(RunMode).min(1),
  repeats: z.strictObject({
    T: z.number().int().min(0),
    F: z.number().int().min(0),
    P: z.number().int().min(0),
  }),
  budgetUsd: z.number().nonnegative(),
  judge: JudgeConfig,
  createdAt: z.string().min(1),
  /** The explicit agent version used by the block cache, retained when the campaign resumes. */
  agentVersion: z.string().optional(),
  /** The registry versions the campaign ran: the dataset its specs came from, the prompts it pinned. */
  sources: z.array(RegistrySource).optional(),
  /** Set when the campaign ran the blast radius of a change and carried the rest. Absent on a full campaign. */
  radius: CampaignRadius.optional(),
});
export type Campaign = z.infer<typeof Campaign>;
