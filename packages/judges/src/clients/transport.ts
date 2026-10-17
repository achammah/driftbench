import type { ClientOptions } from '../client';
import { isRecord, JudgeError, postJson, requireEnv } from '../http';
import { promptFingerprint } from '../prompt';
import type { ClaudeCliOptions, ClaudeThinkingRecovery } from './claude-cli';
import { CLAUDE_JUDGE_FLAGS, CLAUDE_SETTINGS, runClaudeJudgeCommand, withScratchFolder } from './claude-cli';
import { type ClaudeRetryReceipt, ClaudeTransportError } from './claude-errors';

export { ClaudeTransportError } from './claude-errors';

import { googleResponseSchema, JUDGE_DIALECTS, type JudgeDialect } from './dialects';
import { type ProviderDecline, providerBlock, quoteAssessmentMaterial } from './provider-block';
import { type TokenUsage, usageFromResponse } from './usage';

export type DialectProvider = 'openai' | 'google' | 'anthropic' | 'claude-cli';

/** A benchmark freeze chosen by the caller, never a general client default. Jev remains binary. */
export const FROZEN_BENCHMARK_REASONING = Object.freeze({
  'gpt-6-luna': 'medium',
  'gemini-3.8-flash': 'medium',
  'claude-haiku-5-5': undefined,
  'jev-latest': undefined,
} as const);

export type DialectCompletionRequest = {
  readonly quotedMaterial?: boolean;
  /** Per-call native CLI spend ceiling, including retries. Omitted uses the transport default. */
  readonly maxBudgetUsd?: number;
  /** Per-request HTTP output limit. Omitted uses the transport default; native CLI owns its token ceiling. */
  readonly maxTokens?: number;
  readonly system: string;
  readonly user: string;
  /** Absent: plain output, with no injected schema, JSON instructions or judge contract. */
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly reasoning?: ClientOptions['reasoning'];
};

export type DialectCompletion = {
  readonly thinkingRecovery?: ClaudeThinkingRecovery;
  readonly retryReceipts?: readonly ClaudeRetryReceipt[];
  /** Every Claude CLI process started for this completion, recovery and retries included. */
  readonly requestCount?: number;
  readonly text: string;
  readonly raw: string;
  readonly dialect: JudgeDialect;
  /** Includes the transport identity and this call's prompt, schema and reasoning override. */
  readonly fingerprint: string;
  /** Billed output includes Google thinking tokens; raw preserves the provider's separate counters. */
  readonly usage?: TokenUsage;
  readonly costUsd?: number;
  /** A process of the call reported no cost: costUsd is absent, never the cost of a part. */
  readonly costIncomplete?: true;
  readonly finishReason?: string;
  readonly truncated?: boolean;
  readonly refusal?: string;
  /** Set with `refusal`: the provider declined, and its short signal, for counting refusals. */
  readonly declineReason?: ProviderDecline['declineReason'];
  readonly providerBlock?: ProviderDecline['providerBlock'];
};

export type DialectTransportOptions = ClientOptions &
  Pick<ClaudeCliOptions, 'claudeEffort' | 'retryMaxCostUsd'> & {
    provider: DialectProvider;
    /** Output limit. Defaults to 4096; native Claude CLI owns its own token limit. */
    maxTokens?: number;
    command?: string;
    commandArgs?: readonly string[];
    maxBudgetUsd?: number;
  };

export type DialectTransport = {
  readonly dialect: JudgeDialect;
  readonly reasoning?: ClientOptions['reasoning'];
  /** Transport configuration only. Each completion also carries its complete request fingerprint. */
  readonly fingerprint: string;
  complete(request: DialectCompletionRequest): Promise<DialectCompletion>;
};

/** Provider payload only: it carries no model, credentials, token budget or assessment contract. */
export function buildDialectRequest(
  provider: DialectProvider,
  request: DialectCompletionRequest,
): {
  dialect: JudgeDialect;
  payload: Record<string, unknown>;
  fingerprint: string;
} {
  if (request.maxTokens !== undefined && (!Number.isSafeInteger(request.maxTokens) || request.maxTokens <= 0))
    throw new RangeError('maxTokens must be a positive safe integer');
  if (
    request.maxBudgetUsd !== undefined &&
    (!Number.isFinite(request.maxBudgetUsd) || request.maxBudgetUsd <= 0)
  )
    throw new RangeError('maxBudgetUsd must be positive and finite');
  request = quoteAssessmentMaterial(request, request.quotedMaterial);
  const dialect = JUDGE_DIALECTS[provider].id;
  if (request.reasoning !== undefined && provider !== 'openai' && provider !== 'google')
    throw new JudgeError('config', `${provider} does not expose a reasoning setting in this dialect`);
  let payload: Record<string, unknown>;
  if (provider === 'openai') {
    payload = {
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      ...(request.schema === undefined
        ? {}
        : {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'judge_answer', strict: true, schema: request.schema },
            },
          }),
      ...(request.reasoning === undefined ? {} : { reasoning_effort: request.reasoning }),
    };
  } else if (provider === 'google') {
    payload = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      ...(request.schema === undefined && request.reasoning === undefined
        ? {}
        : {
            generationConfig: {
              ...(request.schema === undefined
                ? {}
                : {
                    responseMimeType: 'application/json',
                    responseSchema: googleResponseSchema(request.schema),
                  }),
              ...(request.reasoning === undefined
                ? {}
                : { thinkingConfig: { thinkingLevel: request.reasoning } }),
            },
          }),
    };
  } else {
    const user =
      request.schema === undefined
        ? request.user
        : `${request.user}\n\nThink first in plain text. Then write the JSON object last, matching this schema:\n${JSON.stringify(request.schema)}`;
    payload =
      provider === 'claude-cli'
        ? { system: request.system, user }
        : { system: request.system, messages: [{ role: 'user', content: user }] };
  }
  return {
    dialect,
    payload,
    fingerprint: promptFingerprint({
      version: 1,
      provider,
      dialect,
      payload,
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      ...(request.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: request.maxBudgetUsd }),
    }),
  };
}

/** Raw text transport for any prompt or schema, including pointwise uncertainty cascades. No verdict parser runs. */
export function createDialectTransport(options: DialectTransportOptions): DialectTransport {
  const provider = options.provider;
  if (options.claudeEffort !== undefined && provider !== 'claude-cli')
    throw new JudgeError('config', 'claudeEffort requires claude-cli');
  const env = options.env ?? process.env;
  const variables = {
    openai: 'OPENAI_JUDGE_MODEL',
    google: 'GOOGLE_JUDGE_MODEL',
    anthropic: 'ANTHROPIC_JUDGE_MODEL',
    'claude-cli': 'CLAUDE_JUDGE_MODEL',
  };
  const model = env[variables[provider]]?.trim() || options.model;
  if (!model) throw new JudgeError('config', `${variables[provider]} is not set and no model was given`);
  if (options.reasoning !== undefined && provider !== 'openai' && provider !== 'google')
    throw new JudgeError('config', `${provider} does not expose a reasoning setting in this dialect`);
  const maxTokens = options.maxTokens ?? 4096;
  if (!Number.isInteger(maxTokens) || maxTokens <= 0)
    throw new RangeError('maxTokens must be a positive integer');
  const baseVariable = {
    openai: 'OPENAI_BASE_URL',
    google: 'GOOGLE_BASE_URL',
    anthropic: 'ANTHROPIC_BASE_URL',
    'claude-cli': '',
  }[provider];
  const fallback = {
    openai: 'https://api.openai.com',
    google: 'https://generativelanguage.googleapis.com',
    anthropic: 'https://api.anthropic.com',
    'claude-cli': '',
  }[provider];
  const base = (env[baseVariable]?.trim() || fallback).replace(/\/+$/, '');
  const url =
    provider === 'google'
      ? `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`
      : provider === 'openai'
        ? `${base}/v1/chat/completions`
        : `${base}/v1/messages`;
  const headers: Record<string, string> =
    provider === 'openai'
      ? { authorization: `Bearer ${requireEnv(env, 'OPENAI_API_KEY')}` }
      : provider === 'anthropic'
        ? { 'x-api-key': requireEnv(env, 'ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' }
        : provider === 'google'
          ? { 'x-goog-api-key': env.GEMINI_API_KEY?.trim() || requireEnv(env, 'GOOGLE_API_KEY') }
          : {};
  const dialect = JUDGE_DIALECTS[provider].id;
  const fingerprint = promptFingerprint({
    version: 1,
    provider,
    dialect,
    model,
    maxTokens,
    ...(options.claudeEffort === undefined ? {} : { claudeEffort: options.claudeEffort }),
    ...(options.quotedMaterial ? { quotedMaterial: true } : {}),
    base,
    ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
    ...(options.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: options.maxBudgetUsd }),
    ...(options.retryMaxCostUsd === undefined ? {} : { retryMaxCostUsd: options.retryMaxCostUsd }),
    ...(provider !== 'claude-cli'
      ? {}
      : { command: options.command ?? 'claude', args: options.commandArgs ?? [], settings: CLAUDE_SETTINGS }),
  });
  return {
    dialect,
    ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
    fingerprint,
    async complete(original) {
      const reasoning = original.reasoning ?? options.reasoning;
      const maxBudgetUsd = original.maxBudgetUsd ?? options.maxBudgetUsd;
      const request = {
        ...original,
        ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
        quotedMaterial: original.quotedMaterial ?? options.quotedMaterial,
        ...(reasoning === undefined ? {} : { reasoning }),
      };
      const built = buildDialectRequest(provider, request);
      const outputLimit = request.maxTokens ?? maxTokens;
      const identity = {
        dialect,
        fingerprint: promptFingerprint({ transport: fingerprint, request: built.fingerprint }),
      };
      if (provider === 'claude-cli') {
        // A folder per call, removed when the call ends, however it ends.
        const sent = await withScratchFolder('driftbench-claude-transport-', (folder) =>
          runClaudeJudgeCommand(
            options.command ?? 'claude',
            [
              ...(options.commandArgs ?? []),
              '-p',
              '--output-format',
              'json',
              '--model',
              model,
              '--system-prompt',
              built.payload.system as string,
              ...CLAUDE_JUDGE_FLAGS,
              ...(maxBudgetUsd === undefined ? [] : ['--max-budget-usd', String(maxBudgetUsd)]),
            ],
            built.payload.user as string,
            {
              ...options,
              ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
              cwd: folder,
              env,
              timeoutMs: options.timeoutMs ?? 120_000,
              system: built.payload.system as string,
            },
          ),
        );
        const ran = sent.ran;
        let value: unknown;
        try {
          value = JSON.parse(ran.stdout);
        } catch {
          throw new ClaudeTransportError(
            'bad_response',
            `claude exited ${ran.code} without a JSON result`,
            ran,
          );
        }
        if (!isRecord(value) || value.type !== 'result')
          throw new ClaudeTransportError('bad_response', 'claude returned no result', ran, value);
        if (value.is_error === true || ran.code !== 0)
          throw new ClaudeTransportError('http', 'claude returned an error result', ran, value);
        const cost =
          typeof value.total_cost_usd === 'number' &&
          Number.isFinite(value.total_cost_usd) &&
          value.total_cost_usd >= 0
            ? value.total_cost_usd
            : undefined;
        return {
          ...identity,
          raw: ran.stdout,
          text: typeof value.result === 'string' ? value.result : '',
          ...(cost === undefined ? {} : { costUsd: cost }),
          ...sent.accounting,
          ...(sent.accounting.thinkingRecovery
            ? { fingerprint: promptFingerprint({ initial: identity.fingerprint, recoveryEffort: 'low' }) }
            : {}),
          ...(typeof value.subtype === 'string' ? { finishReason: value.subtype } : {}),
          ...(value.subtype === 'success' ? {} : { truncated: true }),
        };
      }
      const body =
        provider === 'google'
          ? {
              ...built.payload,
              generationConfig: {
                ...((built.payload.generationConfig ?? {}) as Record<string, unknown>),
                maxOutputTokens: outputLimit,
              },
            }
          : {
              model,
              ...built.payload,
              ...(provider === 'openai'
                ? { max_completion_tokens: outputLimit }
                : { max_tokens: outputLimit }),
            };
      const value = await postJson(url, headers, body, options);
      return { ...identity, ...readCompletion(provider, value) };
    },
  };
}

function readCompletion(
  provider: Exclude<DialectProvider, 'claude-cli'>,
  value: unknown,
): Omit<DialectCompletion, 'dialect' | 'fingerprint'> {
  const block = providerBlock(provider, value);
  const raw = JSON.stringify(value);
  let usage = usageFromResponse(provider, value);
  const record = isRecord(value) ? value : {};
  if (provider === 'google' && isRecord(record.usageMetadata)) {
    const thinking = record.usageMetadata.thoughtsTokenCount;
    if (typeof thinking === 'number' && Number.isFinite(thinking) && thinking >= 0)
      usage = { ...usage, output: (usage.output ?? 0) + thinking };
  }
  let text = '';
  let finish: unknown;
  let refusal: unknown;
  if (provider === 'openai') {
    const choice = Array.isArray(record.choices) && isRecord(record.choices[0]) ? record.choices[0] : {};
    const message = isRecord(choice.message) ? choice.message : {};
    text = typeof message.content === 'string' ? message.content : textBlocks(message.content);
    finish = choice.finish_reason;
    refusal = message.refusal;
    if (finish === 'content_filter') refusal ??= 'content_filter';
  } else if (provider === 'google') {
    const candidate =
      Array.isArray(record.candidates) && isRecord(record.candidates[0]) ? record.candidates[0] : {};
    text = textBlocks(isRecord(candidate.content) ? candidate.content.parts : undefined);
    finish = candidate.finishReason;
    refusal = isRecord(record.promptFeedback) ? record.promptFeedback.blockReason : undefined;
    if (finish === 'SAFETY' || finish === 'RECITATION') refusal ??= finish;
  } else {
    text = textBlocks(record.content);
    finish = record.stop_reason;
    if (finish === 'refusal') refusal = finish;
  }
  // The shared classifier also recognizes blocked finish reasons without a separate refusal field.
  // Retain their text for audit, but never expose it as an ordinary successful completion.
  if (block && !(typeof refusal === 'string' && refusal)) refusal = block.reason;
  return {
    text,
    raw,
    ...(Object.keys(usage).length ? { usage } : {}),
    ...(typeof finish === 'string' ? { finishReason: finish } : {}),
    ...(['length', 'MAX_TOKENS', 'max_tokens'].includes(String(finish)) ? { truncated: true } : {}),
    ...(typeof refusal === 'string' && refusal
      ? {
          refusal,
          declineReason: 'provider-blocked' as const,
          providerBlock: block ?? { provider, reason: 'other' },
        }
      : {}),
  };
}

function textBlocks(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((part) => isRecord(part) && part.thought !== true && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
    : '';
}
