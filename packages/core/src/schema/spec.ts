import { z } from 'zod';
import { isPlainObject } from '../spec/normalize';
import {
  Assertion,
  Budget,
  Count,
  DeviationClass,
  GivenOrigin,
  Lang,
  Message,
  Pattern,
  TargetRef,
  WorldState,
} from './common';
import { parameterSchema, unsupportedSchemaKeywords } from './json-schema';
import { BlockLinks } from './links';

/**
 * The spec format. A spec is one golden conversation (or one task for a code agent) written as a
 * succession of blocks. Each block is a unit test: Given (initial conditions), When (the stimulus),
 * Then (the expected output and state delta, under `expect`).
 */

/** What reaches the agent in one block. */
export const Stimulus = z
  .union([
    z.strictObject({ user: z.string() }).describe('One user message, or one instruction to a task agent.'),
    z
      .strictObject({ burst: z.array(z.string()).min(2) })
      .describe('Two or more messages that arrive together.'),
    z
      .strictObject({
        injection: z.strictObject({
          class: DeviationClass.describe('The deviation class.'),
          user: z.string().describe('The message that carries the deviation.'),
        }),
      })
      .describe('A deviation written into the blocks, with its class.'),
  ])
  .describe('What reaches the agent in one block: exactly one of user, burst or injection.');
export type Stimulus = z.infer<typeof Stimulus>;

/** Where a ledger fact was stated before the block: by whom, and in which prefix message. */
export const SharedFact = z
  .strictObject({
    fact: z.string().min(1).describe('The ledger key of the fact.'),
    by: z
      .enum(['user', 'agent', 'record'])
      .describe(
        'Who stated it: user or agent in a prefix message, record when it comes from a system of record and was never said.',
      ),
    in: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('The index of the prefix message that states it, from 0. Needed for user and agent.'),
  })
  .describe(
    'Where a ledger fact was stated before the block, checked by spec lint and before the block runs.',
  );
export type SharedFact = z.infer<typeof SharedFact>;

/** Initial conditions set on the whole spec. */
export const GivenDefaults = z
  .strictObject({
    ledger: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Facts the agent must hold from the start.'),
    world: WorldState.optional().describe('The world at the start.'),
    vars: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Runtime variables, such as the clock, the channel or the sender.'),
    summary: z
      .string()
      .min(1)
      .optional()
      .describe(
        'What a named state (vars.session_state) holds, in words. spec lint --summaries warns when a named state has none.',
      ),
  })
  .describe('Initial conditions set on the whole spec.');
export type GivenDefaults = z.infer<typeof GivenDefaults>;

/**
 * Initial conditions set on one block. A prefix lets the block start without replaying the ones before;
 * ledger, world and vars merge into the running state from this block onwards. In teacher-forced mode
 * every block starts from its own resolved Given.
 */
export const GivenOverride = z
  .strictObject({
    prefix: z
      .array(Message)
      .optional()
      .describe('The messages before this block. Lets the block start without replaying the ones before.'),
    origin: GivenOrigin.optional().describe(
      'Where the prefix comes from: authored, recorded or canonical. Only with a prefix on the same block. It enters the Given hash.',
    ),
    ledger: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Facts the agent must hold at this block. They merge into the ledger from here on.'),
    world: WorldState.optional().describe('Changes to the world from this block onwards.'),
    vars: z.record(z.string(), z.unknown()).optional().describe('Runtime variables from this block onwards.'),
    shared: z
      .array(SharedFact)
      .optional()
      .describe(
        'Where each ledger fact was stated in the prefix: a fact said by the user or the agent must appear in the message it names.',
      ),
    summary: z
      .string()
      .min(1)
      .optional()
      .describe('What a named state (vars.session_state) holds from this block onwards, in words.'),
  })
  .describe(
    'Initial conditions set on one block. A prefix lets the block start without replaying the ones before.',
  );
export type GivenOverride = z.infer<typeof GivenOverride>;

export const ToolExpect = z
  .strictObject({
    label: z.string().min(1).describe('The tool name.'),
    count: Count.optional().describe('How many calls are expected. 0 means the tool must not be called.'),
    input: z
      .record(z.string(), Assertion)
      .optional()
      .describe('Assertions on the arguments, by argument name.'),
    input_closed: z
      .boolean()
      .optional()
      .describe(
        'True requires every call input to be an object with only the top-level keys named in input. An absent input allows no keys. False or absent leaves other keys allowed.',
      ),
  })
  .describe('One expected tool call.');
export type ToolExpect = z.infer<typeof ToolExpect>;

export const CardExpect = z
  .strictObject({
    name: z.string().min(1).describe('The card name.'),
    count: Count.optional().describe('How many times the card is sent.'),
  })
  .describe('One expected card.');
export type CardExpect = z.infer<typeof CardExpect>;

export const SkillExpect = z
  .strictObject({
    name: z.string().min(1).describe('The skill name.'),
    count: Count.optional().describe('How many times the skill is loaded.'),
  })
  .describe('One expected skill.');
export type SkillExpect = z.infer<typeof SkillExpect>;

/** A runtime check that fired during the block: a hook, a guardrail, a policy. The adapter maps the runtime's own names. */
export const GuardExpect = z
  .strictObject({
    name: z.string().min(1).describe('The name of the check, as the adapter reports it.'),
    verdict: z
      .string()
      .min(1)
      .optional()
      .describe('The verdict the check must have given, such as pass or deny.'),
    count: Count.optional().describe('How many times the check fired.'),
  })
  .describe(
    'One runtime check that fired during the block, with its verdict. The adapter maps the runtime names.',
  );
export type GuardExpect = z.infer<typeof GuardExpect>;

/**
 * The verdicts by which a runtime check acts on a run: it stops the act (`deny`, `block`) or tells the agent
 * something and lets the act through (`warn`, `nudge`). Every other verdict (`allow`, a timeout, a verdict the
 * estate names itself) is no intervention, and a check that judges what a guard says reads these runs only.
 */
export const GUARD_INTERVENTIONS = ['deny', 'block', 'warn', 'nudge'] as const;

/** The reply is JSON: an optional JSON Schema (strict) and paths with an assertion each. */
export const JsonExpect = z
  .strictObject({
    embedded: z
      .boolean()
      .optional()
      .describe(
        'When true, the reply may hold JSON among its prose: the first JSON value found is read. Off by default.',
      ),
    schema: z
      .record(z.string(), z.json())
      .superRefine((schema, ctx) => {
        for (const issue of unsupportedSchemaKeywords(schema)) {
          ctx.addIssue({ code: 'custom', ...issue });
        }
      })
      .optional()
      .describe('A JSON Schema the reply must match; an undeclared key fails.'),
    paths: z
      .array(
        z.strictObject({
          path: z.string().min(1).describe('A dotted path; a number indexes an array.'),
          assert: Assertion.describe('What the value at the path must be, in the spec assertion vocabulary.'),
        }),
      )
      .optional()
      .describe('Paths of the reply, each with its assertion.'),
  })
  .describe('The reply is JSON, optionally with a schema and paths.');
export type JsonExpect = z.infer<typeof JsonExpect>;

/** A minimum and a maximum for a count of the reply: at least one of the two, and min not above max. */
export const LengthBound = z
  .strictObject({
    min: z.number().int().min(0).optional().describe('The least the count may be.'),
    max: z.number().int().min(0).optional().describe('The most the count may be.'),
  })
  .refine(
    (bound) => bound.min !== undefined || bound.max !== undefined,
    'a length bound needs a min or a max',
  )
  .refine(
    (bound) => bound.min === undefined || bound.max === undefined || bound.min <= bound.max,
    'min is above max',
  );
export type LengthBound = z.infer<typeof LengthBound>;

/** Which tools the runtime must offer the agent, and which it must not: a denied tool is not offered. */
export const ToolsOfferedExpect = z
  .strictObject({
    include: z.array(z.string().min(1)).optional().describe('Tools the runtime must offer.'),
    exclude: z
      .array(z.string().min(1))
      .optional()
      .describe('Tools the runtime must not offer, such as a tool a setting denies.'),
  })
  .describe('The tools the runtime offers the agent, read from the runtime trace; calls do not count.');
export type ToolsOfferedExpect = z.infer<typeof ToolsOfferedExpect>;

/** A file the agent must have read during the block: a skill file, a reference, a source. */
export const ReferenceExpect = z
  .strictObject({
    path: z
      .string()
      .min(1)
      .describe('The path read, or a glob: * matches within a folder, ** across folders, ? one character.'),
    count: Count.optional().describe('How many reads of a matching file. 0 means it must not be read.'),
  })
  .describe('A file the agent must read during the block, by path or glob.');
export type ReferenceExpect = z.infer<typeof ReferenceExpect>;

/** A helper the agent must dispatch during the block. The adapter maps the runtime's own names. */
export const SubagentExpect = z
  .strictObject({
    name: z.string().min(1).describe('The helper name, as the adapter reports it.'),
    model: z.string().min(1).optional().describe('The model the helper must run on.'),
    count: Count.optional().describe('How many dispatches. 0 means the helper must not be dispatched.'),
  })
  .describe('A helper the agent must dispatch during the block, with an optional model.');
export type SubagentExpect = z.infer<typeof SubagentExpect>;

/** A reference text the reply must be close to, scored by the similarity check's embedder. */
export const SimilarityExpect = z
  .strictObject({
    reference: z.string().min(1).describe('The text the reply is compared with.'),
    min: z
      .number()
      .min(0)
      .max(1)
      .describe('The lowest similarity that passes, from 0 to 1, as the embedder scores it.'),
  })
  .describe('A reference text the reply must be close to, with the lowest score that passes.');
export type SimilarityExpect = z.infer<typeof SimilarityExpect>;

/** The reply must address the ask of the block: its key terms appear in the reply. */
export const RelevancyExpect = z
  .strictObject({
    min: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('The share of the key terms that must appear in the reply, from 0 to 1. Default 0.5.'),
    terms: z
      .array(z.string().min(1))
      .optional()
      .describe('The key terms of the ask. Without them, the check takes the words of the stimulus.'),
  })
  .describe('The reply addresses the ask of the block: a share of its key terms appears in the reply.');
export type RelevancyExpect = z.infer<typeof RelevancyExpect>;

/** A fact the ledger holds that the reply must not ask for again, and may have to use. */
export const RetentionExpect = z
  .strictObject({
    fact: z.string().min(1).describe('The ledger key of the fact, given in an earlier block.'),
    use: z
      .boolean()
      .optional()
      .describe('True when the block must use the fact: its value appears in the reply or a tool input.'),
    ask: Pattern.optional().describe(
      'A pattern that marks a question asking for the fact again. Default: the words of the key.',
    ),
  })
  .describe('A fact the user gave earlier: the block must not ask for it again, and may have to use it.');
export type RetentionExpect = z.infer<typeof RetentionExpect>;

export const ExecutionExpect = z
  .strictObject({
    ran_code: z.boolean().optional().describe('True when the block must run code; false when it must not.'),
    exit_code: z.number().int().optional().describe('The exit code of the last command.'),
    max_commands: z.number().int().min(0).optional().describe('The most commands the block may run.'),
  })
  .describe('What the agent runs in the block.');
export type ExecutionExpect = z.infer<typeof ExecutionExpect>;

/** One check on a produced file. The key names the check, for example `{ sheets: [North, South] }`. */
export const ArtifactCheck = z
  .record(z.string(), z.unknown())
  .describe('One check on a produced file. The key names the check, for example { sheets: [North, South] }.');
export type ArtifactCheck = z.infer<typeof ArtifactCheck>;

export const ArtifactExpect = z
  .strictObject({
    path: z.string().min(1).describe('The path of the file in the workspace.'),
    kind: z
      .enum(['xlsx', 'docx', 'pptx', 'pdf', 'csv', 'json', 'text', 'code'])
      .optional()
      .describe('The file kind, which picks the reader.'),
    checks: z.array(ArtifactCheck).optional().describe('Checks on the content of the file.'),
  })
  .describe('A file the block must produce.');
export type ArtifactExpect = z.infer<typeof ArtifactExpect>;

export const WorkspaceExpect = z
  .strictObject({
    created: z.array(z.string()).optional().describe('Paths the block creates.'),
    changed: z.array(z.string()).optional().describe('Paths the block changes.'),
    deleted: z.array(z.string()).optional().describe('Paths the block deletes.'),
    others_untouched: z.boolean().optional().describe('True when no other path may change.'),
  })
  .describe('The workspace diff of the block.');
export type WorkspaceExpect = z.infer<typeof WorkspaceExpect>;

export const SafetyExpect = z
  .strictObject({
    max_destructive_ops: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('The most destructive operations allowed.'),
    confirm_before: z
      .array(z.string().min(1))
      .optional()
      .describe('Operations that need a confirmation first, such as delete or send.'),
  })
  .describe('Limits on destructive or irreversible operations.');
export type SafetyExpect = z.infer<typeof SafetyExpect>;

/**
 * The expected output and state delta of a block. Every field is optional.
 * `stage` names the point of its own process the agent must reach; the spec declares the catalogue in `stages`.
 */
export const Expect = z
  .strictObject({
    stage: z
      .string()
      .min(1)
      .optional()
      .describe('The stage the agent must reach after the block, one of the spec stages.'),
    stage_reported: z
      .boolean()
      .optional()
      .describe(
        'True requires the runtime to report a non-empty stage in this block. A carried or inferred stage does not count. False or absent leaves reporting optional.',
      ),
    ledger_add: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Facts the block establishes. They join the ledger.'),
    tools: z.array(ToolExpect).optional().describe('The tool calls expected in the block.'),
    tools_offered: ToolsOfferedExpect.optional().describe(
      'The tools the runtime must offer and must not offer, whether or not the agent calls them.',
    ),
    tool_order: z
      .enum(['exact', 'in_order', 'any_order'])
      .optional()
      .describe('How the expected tools line up with the observed calls: exact, in_order or any_order.'),
    must: z.array(Pattern).optional().describe('Patterns the visible text must match.'),
    must_not: z.array(Pattern).optional().describe('Patterns the visible text must not match.'),
    rouge_l: z
      .strictObject({
        reference: z.string().min(1).describe('The reference text the reply is compared with.'),
        profile: z
          .enum(['driftbench', 'ragas'])
          .optional()
          .describe(
            'The overlap profile: driftbench (default) or ragas, the reference implementation of this score.',
          ),
        min: z.number().min(0).max(1).describe('The lowest ROUGE-L F measure that passes, from 0 to 1.'),
      })
      .optional()
      .describe('The reply must overlap a reference text: its word-level ROUGE-L F measure must reach min.'),
    bleu: z
      .strictObject({
        reference: z.string().min(1).describe('The reference text the reply is compared with.'),
        profile: z
          .enum(['driftbench', 'ragas'])
          .optional()
          .describe(
            'The overlap profile: driftbench (default) or ragas, the reference implementation of this score.',
          ),
        min: z.number().min(0).max(1).describe('The lowest BLEU score that passes, from 0 to 1.'),
      })
      .optional()
      .describe('The reply must overlap a reference text: its BLEU score over words must reach min.'),
    sql: z
      .strictObject({
        tool: z.string().min(1).describe('The tool whose call input holds the query, in its query field.'),
        golden: z.string().min(1).describe('The golden query: one read statement.'),
        database: z.string().min(1).describe('The SQLite database both queries run on, read-only.'),
      })
      .optional()
      .describe('The SQL the agent ran must return the same rows as the golden query on the database.'),
    regex: z
      .array(Pattern)
      .optional()
      .describe(
        'Regular expressions the visible text must match, case-sensitive; must ignores case instead.',
      ),
    injection: z
      .boolean()
      .optional()
      .describe(
        'True when the block is a prompt-injection or jailbreak attempt: the reply must not obey it.',
      ),
    exact: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The reply must equal this text after normalising: case, surrounding space and punctuation ignored; two numbers compare as numbers. A dot or comma between two digits counts, except a strictly grouped thousands comma.',
      ),
    exact_strict: z
      .boolean()
      .optional()
      .describe(
        'Compare exact byte for byte after trimming the ends, instead of ignoring case, punctuation and spacing.',
      ),
    json: JsonExpect.optional().describe('The reply is valid JSON, optionally with a schema and paths.'),
    tool_f1: z
      .strictObject({
        min: z.number().min(0).max(1).describe('The least F1 that passes, from 0 to 1.'),
      })
      .optional()
      .describe('Precision, recall and F1 of the tool calls against the expected ones.'),
    refusal: z
      .enum(['refuses', 'answers'])
      .optional()
      .describe('Whether the reply must be a refusal, read from refusal phrases in seven languages.'),
    markup: z
      .enum(['xml', 'html', 'sql'])
      .optional()
      .describe('The reply is well-formed XML, HTML or SQL (syntax only).'),
    starts_with: z
      .string()
      .min(1)
      .optional()
      .describe('The reply, without leading space, starts with this text.'),
    finish_reason: z
      .string()
      .min(1)
      .optional()
      .describe('The reason the model stopped, as the runtime reports it.'),
    length: z
      .strictObject({
        words: LengthBound.optional().describe('Bounds on the words of the visible text.'),
        chars: LengthBound.optional().describe('Bounds on the characters (code points) of the visible text.'),
      })
      .optional()
      .describe('Word and character bounds on the customer-visible text of the block.'),
    similarity: z
      .array(SimilarityExpect)
      .optional()
      .describe('Reference texts the reply must be close to, each with its lowest passing score.'),
    relevancy: RelevancyExpect.optional().describe('The reply addresses the ask of the block.'),
    knowledge_retention: z
      .array(RetentionExpect)
      .optional()
      .describe('Facts given earlier that the block must not ask for again, and may have to use.'),
    lang: Lang.optional().describe('The language of the reply.'),
    pii_judge: z
      .boolean()
      .optional()
      .describe(
        'Opt in to judged detection of personal names and addresses in the visible reply. Requires a configured personal-data judge; absent or false makes no model calls. Missing or failed judging is gating inconclusive.',
      ),
    cards: z.array(CardExpect).optional().describe('The cards expected in the block.'),
    criteria: z
      .array(z.string().min(1))
      .optional()
      .describe('Judged criteria by name. name@gating makes a fail fail the block.'),
    skills: z.array(SkillExpect).optional().describe('The skills expected in the block.'),
    guards: z
      .array(GuardExpect)
      .optional()
      .describe('The runtime checks expected in the block, with their verdict and count.'),
    references: z
      .array(ReferenceExpect)
      .optional()
      .describe('The files the agent must read in the block, by path or glob, with a count.'),
    subagents: z
      .array(SubagentExpect)
      .optional()
      .describe('The helpers the agent must dispatch in the block, by name and model, with a count.'),
    execution: ExecutionExpect.optional().describe('What the agent runs.'),
    artifacts: z.array(ArtifactExpect).optional().describe('The files the block must produce.'),
    workspace: WorkspaceExpect.optional().describe('The workspace diff expected.'),
    safety: SafetyExpect.optional().describe('Limits on destructive operations.'),
  })
  .describe('The expected output and state delta of a block. Every field is optional.');
export type Expect = z.infer<typeof Expect>;

export const BlockSpec = z
  .strictObject({
    id: z.string().min(1).optional().describe('An id, unique in the spec.'),
    when: Stimulus.describe('The stimulus.'),
    given: GivenOverride.optional().describe('Initial conditions for this block.'),
    expect: Expect.optional().describe('The expected output and state delta.'),
    budget: Budget.optional().describe('Limits for this block.'),
  })
  .describe('One block: a stimulus, its initial conditions and its expectations.');
export type BlockSpec = z.infer<typeof BlockSpec>;

/** How the agent should come back after an injected deviation. */
export const RecoveryExpect = z
  .strictObject({
    within_blocks: z.number().int().min(0).describe('How many blocks the agent has to come back.'),
    stage_after: z.string().min(1).optional().describe('The stage the agent must be back at.'),
    return_message: z
      .string()
      .optional()
      .describe('A pattern the first in-flow reply after the deviation must match.'),
  })
  .describe('How the agent should come back after an injected deviation.');
export type RecoveryExpect = z.infer<typeof RecoveryExpect>;

/** A deviation inserted before block `inject_at` (0-based) when the spec runs in perturbed mode. */
export const PerturbationSpec = z
  .strictObject({
    id: z.string().min(1).describe('An id, unique in the spec.'),
    class: DeviationClass.describe('The deviation class.'),
    inject_at: z
      .number()
      .int()
      .min(0)
      .describe('The position: the deviation goes in before this block, counting from 0.'),
    user: z.string().optional().describe('The message the user sends.'),
    burst: z.array(z.string()).min(2).optional().describe('Messages the user sends together.'),
    world: WorldState.optional().describe(
      'A change to the world from this point, such as a tool forced to fail.',
    ),
    expect: Expect.optional().describe('Expectations for the injected block.'),
    recovery: RecoveryExpect.optional().describe(
      'How the agent should come back. Without it, recovery is not measured.',
    ),
  })
  .describe(
    'A deviation inserted before block inject_at, counting from 0, when the spec runs in perturbed mode.',
  );
export type PerturbationSpec = z.infer<typeof PerturbationSpec>;

/** Rules that hold for the whole conversation. */
export const Rules = z
  .strictObject({
    max_calls: z
      .record(z.string(), z.number().int().min(0))
      .optional()
      .describe('The most calls per tool across the run. 0 forbids the tool.'),
    forbidden_tools: z.array(z.string().min(1)).optional().describe('Tools that must never be called.'),
    lang_stable: z
      .boolean()
      .optional()
      .describe('True when the reply language must stay the same across blocks.'),
    one_message_per_turn: z.boolean().optional().describe('True when each block may send one message only.'),
    match_case: z
      .boolean()
      .optional()
      .describe(
        'True makes must and must_not patterns case-sensitive and the trailing punctuation count. Default false: a pattern ignores the case of the reply and a trailing punctuation mark.',
      ),
    custom: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Maps a registered custom check name to its options; the checks package runs it.'),
  })
  .describe('Rules that hold for the whole conversation.');
export type Rules = z.infer<typeof Rules>;

/** The expected end state of the world, read from a source the adapter knows, such as a tool's recorded payload. */
export const EndStateSpec = z
  .strictObject({
    source: z.string().min(1).describe('Where the adapter reads the state, such as tool:submit_order.'),
    mode: z
      .enum(['subset', 'exact'])
      .optional()
      .describe('subset compares the listed fields; exact compares the whole state.'),
    expect: z.record(z.string(), Assertion).describe('Assertions on fields of the state.'),
  })
  .describe(
    'The expected end state of the world, read from a source the adapter knows, such as a tool payload.',
  );
export type EndStateSpec = z.infer<typeof EndStateSpec>;
export const EndState = z
  .union([z.literal('none'), EndStateSpec, z.array(EndStateSpec).min(1)])
  .describe(
    'none asserts that nothing was submitted; a mapping or a list of mappings names what to check; absent means no end-state check.',
  );
export type EndState = z.infer<typeof EndState>;

/** A judged criterion. Blocks reference it by name, with `@gating` when a fail fails the conversation. */
export const CriterionDef = z
  .strictObject({
    name: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
      .describe('The name blocks use to reference the criterion.'),
    rubric: z.string().min(1).describe('The question the judge answers with pass or fail.'),
    pass: z.string().optional().describe('What a passing block looks like.'),
    fail: z.string().optional().describe('What a failing block looks like.'),
    gating: z
      .boolean()
      .optional()
      .describe('True gates every reference to this criterion; a reference can also add @gating.'),
    scope: z
      .enum(['block', 'conversation'])
      .optional()
      .describe('block judges one block; conversation judges the whole conversation.'),
    inputs: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Workspace files the judge reads beside the transcript, such as the source a produced file is compared against. Read from the seed the agent was given, else from the workspace.',
      ),
    judge_class: z
      .enum(['system1', 'system2', 'auto'])
      .optional()
      .describe('system1, system2, or auto: calibration assigns the class, ties go to system1.'),
    repeat_reducer: z
      .string()
      .regex(/^(mode|median|at_least:[1-9][0-9]*)$/)
      .optional()
      .describe(
        'How the verdicts across the repeats of one spec become one verdict: mode, median, or at_least:<k>.',
      ),
    prompt_version: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe(
        'The criterion prompt rules the judge reads. 2, the default, adds the exact-identifier, stated-facts and stated-scope rules; 1 is the earlier rule set, to replay answers recorded with it.',
      ),
    decoder_version: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe(
        'How a criterion ledger answer is read. Unset, the default reader drops an ungrounded quote and keeps the verdict; 1 rejects an ungrounded quote; 2 drops the quote and keeps the verdict.',
      ),
    answer_contract: z
      .enum(['ledger', 'legacy'])
      .optional()
      .describe(
        'ledger, the default, or legacy: the earlier prompt and parser, to replay scores recorded with them.',
      ),
    assessment: z
      .enum(['response-relevance', 'conformance', 'answer-audit', 'fact-ledger'])
      .optional()
      .describe(
        'An assessment kind in place of the criterion ledger: response-relevance (the reply answers the latest ask), conformance (to reference), answer-audit (the submitted answer, optionally against reference), or fact-ledger (every fact of reference in the reply).',
      ),
    reference: z
      .string()
      .optional()
      .describe(
        'The reference answer an assessment reads: needed by conformance (may be empty) and fact-ledger, optional for answer-audit.',
      ),
    grounding: z
      .literal('strict')
      .optional()
      .describe('fact-ledger only: strict refuses reference or reply text that is not a source quote.'),
    requirements: z
      .array(
        z.strictObject({
          id: z.string().min(1).describe('The requirement id the judge answers under.'),
          requirement: z.string().min(1).describe('What the requirement asks.'),
        }),
      )
      .min(1)
      .optional()
      .describe(
        'The rubric split into requirements the judge checks one by one. Absent: one requirement, the whole rubric.',
      ),
    items: z
      .array(
        z.strictObject({
          name: z.string().min(1).describe('The item name, unique in the criterion.'),
          rubric: z.string().min(1).describe('What the item requires.'),
          weight: z.number().positive().optional().describe('The item weight. Default 1.'),
          hard: z.boolean().optional().describe('True: the criterion fails when this item is not met.'),
        }),
      )
      .min(1)
      .optional()
      .describe(
        'Rubric items, each scored 0 to 4 by the judge; the weighted score decides the verdict against threshold.',
      ),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('With items: the weighted fraction a pass needs, from 0 to 1. Default 1.'),
    repeat: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        'How many times the judge answers the same request; the verdict holds only when every answer agrees, else inconclusive. Not the spec repeats (see repeat_reducer).',
      ),
    per_turn: z
      .boolean()
      .optional()
      .describe(
        'True judges the transcript one customer turn at a time; any failing turn fails the criterion.',
      ),
  })
  .superRefine((criterion, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const kind = criterion.assessment;
    if (kind === 'conformance' && (criterion.pass !== undefined || criterion.fail !== undefined))
      issue(
        'assessment',
        'assessment conformance reads only the rubric: put the pass and fail conditions in it and drop pass and fail',
      );
    if (kind === 'conformance' && criterion.scope === 'block')
      issue(
        'scope',
        'assessment conformance judges the whole supplied transcript: drop scope block, or use scope conversation',
      );
    if (kind === 'conformance' && criterion.reference === undefined)
      issue('reference', 'assessment conformance needs reference (an empty string is allowed)');
    if (kind === 'fact-ledger' && !criterion.reference?.trim())
      issue('reference', 'assessment fact-ledger needs a nonempty reference');
    if (kind === 'answer-audit' && criterion.reference !== undefined && !criterion.reference.trim())
      issue('reference', 'assessment answer-audit needs a nonempty reference when one is given');
    if (criterion.reference !== undefined && (kind === undefined || kind === 'response-relevance'))
      issue('reference', 'reference is read only by assessment conformance, fact-ledger or answer-audit');
    if (criterion.grounding !== undefined && kind !== 'fact-ledger')
      issue('grounding', 'grounding is for assessment fact-ledger only');
    if (kind !== undefined && criterion.inputs !== undefined)
      issue('inputs', `assessment ${kind} reads the transcript only: remove inputs`);
    if ((kind !== undefined || criterion.items !== undefined) && criterion.answer_contract === 'legacy')
      issue('answer_contract', 'the legacy answer contract reads no assessment or items: drop one');
    if (criterion.items !== undefined && kind !== undefined)
      issue('items', `items score a rubric: they cannot be combined with assessment ${kind}`);
    if (criterion.requirements !== undefined && (kind !== undefined || criterion.items !== undefined))
      issue('requirements', 'requirements split the criterion ledger: drop assessment and items');
    if (criterion.threshold !== undefined && criterion.items === undefined)
      issue('threshold', 'threshold needs items');
    const names = new Set<string>();
    for (const item of criterion.items ?? []) {
      if (names.has(item.name)) issue('items', `item ${item.name} appears twice: names must be unique`);
      names.add(item.name);
    }
    const ids = new Set<string>();
    for (const requirement of criterion.requirements ?? []) {
      if (ids.has(requirement.id))
        issue('requirements', `requirement ${requirement.id} appears twice: ids must be unique`);
      ids.add(requirement.id);
    }
    if (criterion.repeat !== undefined && criterion.per_turn === true)
      issue('repeat', 'repeat and per_turn cannot be combined: choose one');
  })
  .describe(
    'A judged criterion. Blocks reference it by name, with @gating when a fail fails the conversation.',
  );
export type CriterionDef = z.infer<typeof CriterionDef>;

/**
 * The spec format version this driftbench reads, and the highest a spec may declare in `schema_version`. A
 * release that adds a key a reader must understand raises it, so an older driftbench refuses such a spec
 * with an "upgrade driftbench" message instead of an unknown-key error.
 */
export const SPEC_SCHEMA_VERSION = 1;

export const Spec = z
  .strictObject({
    schema_version: z
      .number()
      .int()
      .min(1)
      .max(SPEC_SCHEMA_VERSION)
      .optional()
      .describe(
        'The spec format version the spec is written for. A driftbench that reads a lower version refuses the spec and says to upgrade. Absent means version 1.',
      ),
    id: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .describe('The spec id: letters, digits, dots, underscores and hyphens.'),
    version: z
      .string()
      .optional()
      .describe('A free label. The content hash, not this label, is the cache key.'),
    kind: z
      .enum(['conversation', 'task'])
      .describe('conversation or task. The loader sets conversation when it is absent.'),
    title: z.string().optional().describe('A short title.'),
    description: z.string().optional().describe('A longer description.'),
    channel: z.string().optional().describe('The channel the conversation runs on, such as chat.'),
    lang: Lang.optional().describe('The declared language of the conversation.'),
    tier: z.string().optional().describe('A tier label, such as core or edge.'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Free tags. flow:<id> ties the spec to a flow of the behaviour inventory.'),
    covers: z
      .array(z.string())
      .optional()
      .describe('Ids of the behaviours this spec covers, from a behaviour inventory.'),
    target: TargetRef.optional().describe('The default agent. A run can override it.'),
    given: GivenDefaults.optional().describe('Initial conditions for every block.'),
    stages: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'The stage catalogue of the flow. expect.stage and recovery.stage_after must name one of these.',
      ),
    criteria: z.array(CriterionDef).optional().describe('The judged criteria the blocks may reference.'),
    blocks: z.array(BlockSpec).min(1).describe('The blocks, in order. At least one.'),
    end: z
      .strictObject({
        verdict: z
          .enum(['success', 'failure'])
          .describe('success when the script ends the conversation well, failure when it ends it badly.'),
        reason: z.string().min(1).optional().describe('Why the script ends here.'),
        atBlock: z
          .number()
          .int()
          .min(-1)
          .optional()
          .describe(
            'The index of the last block that runs, -1 for none. The blocks after it are skipped by the verdict. Absent means the last block.',
          ),
      })
      .optional()
      .describe(
        'An end verdict: the run stops after block atBlock (the last block when absent) with this verdict.',
      ),
    rules: Rules.optional().describe('Rules for the whole conversation.'),
    end_state: EndState.optional().describe('The expected end state of the world after the run.'),
    perturbations: z.array(PerturbationSpec).optional().describe('Deviations to inject in perturbed mode.'),
    metadata: z
      .record(z.string(), z.unknown())
      .superRefine((metadata, ctx) => {
        if (metadata.links !== undefined) {
          const links = BlockLinks.safeParse(metadata.links);
          if (!links.success)
            for (const issue of links.error.issues)
              ctx.addIssue({ code: 'custom', message: issue.message, path: ['links', ...issue.path] });
        }
        if (!isPlainObject(metadata.tool_schemas)) return;
        for (const [label, definition] of Object.entries(metadata.tool_schemas)) {
          for (const issue of unsupportedSchemaKeywords(parameterSchema(definition))) {
            ctx.addIssue({ code: 'custom', ...issue, path: ['tool_schemas', label, ...issue.path] });
          }
        }
      })
      .optional()
      .describe(
        'Free metadata. `links` holds the links of the blocks to prompt sections, spec clauses and past turns; it and `provenance` stay out of the spec hash.',
      ),
  })
  .describe('One golden conversation, or one task for a code agent, written as a succession of blocks.');
export type Spec = z.infer<typeof Spec>;

/** Short names used in the docs: a block, the conditions it starts from, and an injected deviation. */
export const Block = BlockSpec;
export type Block = BlockSpec;
export const Given = GivenOverride;
export type Given = z.infer<typeof GivenOverride>;
export const Perturbation = PerturbationSpec;
export type Perturbation = PerturbationSpec;
