import { z } from 'zod';

/**
 * Shared building blocks for specs (authored in YAML, snake_case keys) and for run records
 * (written by the runner, camelCase keys).
 */

/** A language code such as FR, NL or EN. */
export const Lang = z.string().min(2).max(8).describe('A language code, such as FR, NL or EN.');

/** A JavaScript regular expression source. Specs match text with the `m` flag. */
export const Pattern = z
  .string()
  .min(1)
  .describe('A JavaScript regular expression source. Specs match text with the m flag.');

/** An exact count, or a range with optional bounds. */
export const Count = z
  .union([
    z.number().int().min(0),
    z.strictObject({
      min: z.number().int().min(0).optional().describe('The fewest allowed.'),
      max: z.number().int().min(0).optional().describe('The most allowed.'),
    }),
  ])
  .describe('An exact count, or a range with an optional min and max.');
export type Count = z.infer<typeof Count>;

/** How one value is asserted. A bare scalar means exact equality. */
export const Assertion = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.strictObject({ exact: z.json() }).describe('Equal to this JSON value.'),
    z.strictObject({ regex: Pattern }).describe('Matches this pattern.'),
    z.strictObject({ contains: z.string().min(1) }).describe('Contains this text.'),
    z.strictObject({ one_of: z.array(z.json()).min(1) }).describe('Equal to one of these values.'),
    z.strictObject({ nonempty: z.literal(true) }).describe('Present and not empty.'),
    z.strictObject({ absent: z.literal(true) }).describe('Absent.'),
    z
      .strictObject({ subset: z.record(z.string(), z.json()) })
      .describe('Holds at least these keys with these values.'),
  ])
  .describe('How one value is asserted. A bare string, number, boolean or null means exact equality.');
export type Assertion = z.infer<typeof Assertion>;

/** The twelve deviation classes a perturbed run can inject. */
export const DeviationClass = z
  .enum([
    'D1_off_topic',
    'D2_goal_shift',
    'D3_contradiction',
    'D4_loose_confirmation',
    'D5_language_switch',
    'D6_instruction_in_data',
    'D7_silence_or_burst',
    'D8_tool_failure',
    'D9_out_of_scope',
    'D10_return',
    'D11_pii_leak',
    'D12_prompt_extraction',
  ])
  .describe('The twelve deviation classes a perturbed run can inject.');
export type DeviationClass = z.infer<typeof DeviationClass>;

/** The five drift classes a failing block can carry. */
export const DriftClass = z
  .enum(['X1_local', 'X2_contradiction', 'X3_flow', 'X4_format', 'X5_tool'])
  .describe('The five drift classes a failing block can carry.');
export type DriftClass = z.infer<typeof DriftClass>;

/** A prompt version from the store's registry, handed to the agent. `campaign run --prompt` sets it. */
export const TargetPrompt = z
  .strictObject({
    name: z.string().min(1).describe('The prompt name in the registry.'),
    version: z.number().int().min(1).describe('The version number.'),
    hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe('The version hash: the SHA-256 of its file list.'),
    text: z.string().describe('The prompt text, restored byte for byte from the store.'),
  })
  .describe(
    'A prompt version from the registry, handed to the agent as its system prompt. campaign run --prompt sets it.',
  );
export type TargetPrompt = z.infer<typeof TargetPrompt>;

/** How model calls are retried: attempts, waits, jitter and the server's Retry-After. */
export const RetrySettings = z
  .strictObject({
    max_attempts: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Attempts per model call, the first included. Default 4.'),
    base_delay_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('The wait before the first retry; each later retry doubles it. Default 500.'),
    max_delay_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('The longest wait between two attempts. Default 30000.'),
    jitter: z
      .boolean()
      .optional()
      .describe('Draw each wait at random below the backoff (full jitter). Default true.'),
    retry_after: z
      .boolean()
      .optional()
      .describe("Wait at least what the server's Retry-After header asks. Default true."),
  })
  .describe(
    'How model calls are retried. Only a 408, a 429, a 5xx (529 included) or a network error is retried.',
  );
export type RetrySettings = z.infer<typeof RetrySettings>;

/** Which agent a spec runs against. The adapter decides what the other fields mean. */
export const TargetRef = z
  .strictObject({
    adapter: z
      .string()
      .min(1)
      .describe('The adapter that reaches the agent, such as function, http, nexus or process.'),
    agent: z.string().min(1).optional().describe('The agent, as the adapter names it.'),
    variant: z.string().min(1).optional().describe('A variant of the agent, such as a prompt version.'),
    deployment: z.string().min(1).optional().describe('A deployment of the agent, as the adapter names it.'),
    options: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Adapter settings. Each adapter defines their names.'),
    prompt: TargetPrompt.optional().describe(
      'The prompt the agent runs with, from the registry. campaign run --prompt sets it; each adapter page says how it reaches the agent.',
    ),
    retry: RetrySettings.optional().describe('How the model calls of this target are retried.'),
  })
  .describe('Which agent a spec runs against. The adapter decides what the other fields mean.');
export type TargetRef = z.infer<typeof TargetRef>;

/** A tool call written in a spec prefix. */
export const PrefixToolCall = z
  .strictObject({
    id: z.string().optional().describe('The id of the call.'),
    label: z.string().min(1).describe('The tool name.'),
    input: z.json().optional().describe('The arguments of the call.'),
    output: z.json().optional().describe('What the tool returned.'),
    error: z.string().optional().describe('The error the tool returned.'),
  })
  .describe('A tool call written in a spec prefix.');

/** One message of a conversation prefix. */
export const Message = z
  .strictObject({
    role: z.enum(['user', 'assistant', 'system', 'tool']).describe('Who sent the message.'),
    content: z.string().describe('The text of the message.'),
    name: z.string().optional().describe('An optional sender name.'),
    tool_calls: z.array(PrefixToolCall).optional().describe('The tool calls the message made.'),
  })
  .describe('One message of a conversation prefix.');
export type Message = z.infer<typeof Message>;

/**
 * Where a prefix comes from. A history copied from a real run is a different test from one a person wrote,
 * and from the canonical replay of a spec: the agent trusts a recorded call and re-checks a fact it only
 * finds in prose. So the origin enters the Given hash, and results with different origins are never pooled.
 */
export const GivenOrigin = z
  .enum(['authored', 'recorded', 'canonical'])
  .describe(
    'Where the prefix comes from: authored (written by a person), recorded (copied from a real run, its tool calls with their real results) or canonical (the replay of a spec as it is written).',
  );
export type GivenOrigin = z.infer<typeof GivenOrigin>;

/** A forced result or error for one tool, from the block where it is set onwards. */
export const ToolOverride = z
  .strictObject({
    result: z.json().optional().describe('The result the tool returns.'),
    error: z.string().optional().describe('The error the tool returns.'),
    latency_ms: z.number().nonnegative().optional().describe('The latency the tool takes, in milliseconds.'),
  })
  .describe('A forced result or error for one tool, from the block where it is set onwards.');

/** The world an agent acts on: tool overrides, a seeded store, a seeded workspace, free fixtures. */
export const WorldState = z
  .strictObject({
    tools: z
      .record(z.string(), ToolOverride)
      .optional()
      .describe('Forced tool results and errors, by tool name.'),
    store: z.record(z.string(), z.unknown()).optional().describe('A seeded store.'),
    workspace: z
      .strictObject({
        from: z
          .string()
          .min(1)
          .optional()
          .describe(
            'A folder the workspace starts from. A path written ./<path> is read from the folder of the spec file; any other relative path from the folder the run starts in.',
          ),
        files: z
          .record(z.string(), z.string())
          .optional()
          .describe('Files the workspace starts with: path to content.'),
        binary: z
          .record(z.string(), z.base64())
          .optional()
          .describe(
            'Files the workspace starts with, byte for byte: path to base64 content. For files that are not text, such as the xlsx a parent block left. A path may not be in both files and binary.',
          ),
        summary: z
          .string()
          .min(1)
          .optional()
          .describe(
            'What the workspace holds, in words, so a reader of the spec sees it. spec lint --summaries warns when a folder named by from has none.',
          ),
      })
      .optional()
      .describe('The files the agent starts from.'),
    fixtures: z.record(z.string(), z.unknown()).optional().describe('Free fixtures.'),
  })
  .describe('The world an agent acts on: tool overrides, a seeded store, a seeded workspace, free fixtures.');
export type WorldState = z.infer<typeof WorldState>;

/** Limits for one block. */
export const Budget = z
  .strictObject({
    steps: z.number().int().min(1).optional().describe('The most agent steps.'),
    cost_usd: z.number().nonnegative().optional().describe('The most cost, in US dollars.'),
    latency_ms: z.number().nonnegative().optional().describe('The most latency, in milliseconds.'),
  })
  .describe('Limits for one block.');
