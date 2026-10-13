import { parseJudgeText, responseSchema } from '../assessment';
import type { ClientOptions, JudgeClient } from '../client';
import { inconclusive, type JudgeRequest, type JudgeResult, MAX_TOKENS } from '../contract';
import { isRecord, JudgeError, postJson, requireEnv } from '../http';
import { buildPrompt } from '../prompt';
import { googleResponseSchema, isPairLedgerRequest, JUDGE_DIALECTS, withJudgeDialect } from './dialects';
import { postReasoningJson, validateTokenBudget } from './reasoning-budget';
import { buildDialectRequest } from './transport';

/**
 * The system 2 judges: chat models that read the rubric and the data and answer the contract as JSON.
 * Each reads its key, model and base URL from the environment. The key lives in the client's closure: it
 * is not a field of the client, so printing or serialising a client never shows it.
 */

const CHAT_COST = 10;

/** The temperature every chat judge asks for. */
const TEMPERATURE = 0;

/**
 * A client's settings descriptor: everything beyond the model that shapes its answers, as one stable string.
 * It is part of every cassette key, so changing a default below changes the descriptor and no old recording replays.
 */
const settingsOf = (client: string, extra: Record<string, unknown>): string =>
  JSON.stringify({ client, temperature: TEMPERATURE, maxTokens: MAX_TOKENS, ...extra });

function modelOf(options: ClientOptions, env: Record<string, string | undefined>, variable: string): string {
  const model = env[variable]?.trim() || options.model;
  if (!model) throw new JudgeError('config', `${variable} is not set and no model was given`);
  return model;
}

function baseOf(env: Record<string, string | undefined>, variable: string, fallback: string): string {
  return (env[variable]?.trim() || fallback).replace(/\/+$/, '');
}

function budgetOf(request: JudgeRequest): number {
  return MAX_TOKENS[request.budget ?? 'normal'];
}

/** A truncated answer: unparsed, so the council re-judges it once with the large budget. */
function truncated(raw: string, model: string): JudgeResult {
  return {
    answer: inconclusive(`${model} stopped at its token limit: the answer is cut`),
    raw,
    unparsed: true,
  };
}

/**
 * OpenAI chat completions: POST {OPENAI_BASE_URL}/v1/chat/completions with a JSON object response format.
 * Reads OPENAI_API_KEY, OPENAI_JUDGE_MODEL and OPENAI_BASE_URL (default https://api.openai.com).
 */
export function createOpenAiJudge(options: ClientOptions = {}): JudgeClient {
  validateTokenBudget(options.tokenBudget, 'openai');
  const env = options.env ?? process.env;
  const key = requireEnv(env, 'OPENAI_API_KEY');
  const model = modelOf(options, env, 'OPENAI_JUDGE_MODEL');
  const reasoning = options.reasoning;
  const url = `${baseOf(env, 'OPENAI_BASE_URL', 'https://api.openai.com')}/v1/chat/completions`;
  let sendTemperature = true;
  return {
    id: options.id ?? 'openai',
    family: 'openai',
    cls: 'system2',
    model,
    dialect: JUDGE_DIALECTS.openai.id,
    ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
    cost: options.cost ?? CHAT_COST,
    settings: settingsOf('openai-chat', {
      temperatureRetry: 'drop on a 400 that names it',
      responseFormat: 'json_schema',
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
    }),
    async judge(original) {
      const request = withJudgeDialect(original, JUDGE_DIALECTS.openai.id, options.reasoning);
      const reasoning = request.reasoning ?? options.reasoning;
      const prompt = buildPrompt(request);
      const ledgerPayload = isPairLedgerRequest(request)
        ? buildDialectRequest('openai', { ...prompt, schema: responseSchema(request), reasoning }).payload
        : undefined;
      const body = (withTemperature: boolean) =>
        ledgerPayload
          ? {
              model,
              max_completion_tokens: budgetOf(request),
              ...(withTemperature ? { temperature: TEMPERATURE } : {}),
              ...ledgerPayload,
            }
          : {
              model,
              max_completion_tokens: budgetOf(request),
              ...(withTemperature ? { temperature: TEMPERATURE } : {}),
              ...(reasoning === undefined ? {} : { reasoning_effort: reasoning }),
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: 'judge_answer',
                  strict: isPairLedgerRequest(request),
                  schema: responseSchema(request),
                },
              },
              messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
              ],
            };
      const send = (withTemperature: boolean) =>
        postReasoningJson('openai', url, { authorization: `Bearer ${key}` }, body(withTemperature), options);
      let sent: Awaited<ReturnType<typeof postReasoningJson>>;
      const sentTemperature = sendTemperature;
      try {
        sent = await send(sentTemperature);
      } catch (cause) {
        // Retry a rejected temperature once, then omit it on subsequent calls from this client.
        const text = cause instanceof Error ? cause.message : '';
        if (!sentTemperature || !/answered 400/.test(text) || !/temperature/i.test(text)) throw cause;
        sendTemperature = false;
        sent = await send(false);
      }

      const { payload, recovery, accounting } = sent;
      const choice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
      const message = isRecord(choice) ? choice.message : undefined;
      const raw = JSON.stringify(payload);
      if (!isRecord(choice) || !isRecord(message)) {
        return {
          answer: inconclusive(`${model} answered without a choice`),
          raw,
          unparsed: true,
          ...accounting,
          ...(recovery ? { recovery } : {}),
        };
      }
      if (typeof message.refusal === 'string' && message.refusal !== '') {
        return {
          answer: inconclusive(`${model} declined: ${message.refusal}`),
          raw,
          ...accounting,
          ...(recovery ? { recovery } : {}),
        };
      }
      if (choice.finish_reason === 'content_filter') {
        return {
          answer: inconclusive(`${model} declined: its content filter stopped the answer`),
          raw,
          ...accounting,
          ...(recovery ? { recovery } : {}),
        };
      }
      const content = contentText(message.content);
      if (choice.finish_reason === 'length')
        return { ...truncated(content, model), ...(recovery ? { recovery } : {}), ...accounting };
      return { ...parseJudgeText(content, request), ...(recovery ? { recovery } : {}), ...accounting };
    },
  };
}

/**
 * Anthropic Messages: POST {ANTHROPIC_BASE_URL}/v1/messages. Reads ANTHROPIC_API_KEY,
 * ANTHROPIC_JUDGE_MODEL and ANTHROPIC_BASE_URL (default https://api.anthropic.com).
 */
export function createAnthropicJudge(options: ClientOptions = {}): JudgeClient {
  validateTokenBudget(options.tokenBudget, 'anthropic');
  if (options.reasoning !== undefined)
    throw new JudgeError('config', 'reasoning is not supported by the Anthropic chat client');
  const env = options.env ?? process.env;
  const key = requireEnv(env, 'ANTHROPIC_API_KEY');
  const model = modelOf(options, env, 'ANTHROPIC_JUDGE_MODEL');
  const url = `${baseOf(env, 'ANTHROPIC_BASE_URL', 'https://api.anthropic.com')}/v1/messages`;
  return {
    id: options.id ?? 'anthropic',
    family: 'anthropic',
    cls: 'system2',
    model,
    dialect: JUDGE_DIALECTS.anthropic.id,
    cost: options.cost ?? CHAT_COST,
    settings: settingsOf('anthropic-messages', { anthropicVersion: '2023-06-01' }),
    async judge(original) {
      const request = withJudgeDialect(original, JUDGE_DIALECTS.anthropic.id);
      const prompt = buildPrompt(request);
      const ledgerPayload = isPairLedgerRequest(request)
        ? buildDialectRequest('anthropic', prompt).payload
        : undefined;
      const payload = await postJson(
        url,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        ledgerPayload
          ? { model, max_tokens: budgetOf(request), temperature: TEMPERATURE, ...ledgerPayload }
          : {
              model,
              max_tokens: budgetOf(request),
              temperature: TEMPERATURE,
              system: prompt.system,
              messages: [{ role: 'user', content: prompt.user }],
            },
        options,
      );
      const raw = JSON.stringify(payload);
      if (!isRecord(payload) || !Array.isArray(payload.content)) {
        return { answer: inconclusive(`${model} answered without a content list`), raw, unparsed: true };
      }
      if (payload.stop_reason === 'refusal') {
        return { answer: inconclusive(`${model} declined the request`), raw };
      }
      const text = payload.content
        .filter((block): block is { type: 'text'; text: string } => {
          return isRecord(block) && block.type === 'text' && typeof block.text === 'string';
        })
        .map((block) => block.text)
        .join('');
      if (payload.stop_reason === 'max_tokens') return truncated(text, model);
      return parseJudgeText(text, request);
    },
  };
}

/**
 * Google Gemini: POST {GOOGLE_BASE_URL}/v1beta/models/{model}:generateContent with a JSON response type.
 * Reads GEMINI_API_KEY (or GOOGLE_API_KEY), GOOGLE_JUDGE_MODEL and GOOGLE_BASE_URL (default
 * https://generativelanguage.googleapis.com). The key goes in the x-goog-api-key header, never the URL.
 */
export function createGoogleJudge(options: ClientOptions = {}): JudgeClient {
  validateTokenBudget(options.tokenBudget, 'google');
  const env = options.env ?? process.env;
  const key = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!key) throw new JudgeError('config', 'GEMINI_API_KEY is not set (nor GOOGLE_API_KEY)');
  const model = modelOf(options, env, 'GOOGLE_JUDGE_MODEL');
  const reasoning = options.reasoning;
  const base = baseOf(env, 'GOOGLE_BASE_URL', 'https://generativelanguage.googleapis.com');
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    id: options.id ?? 'google',
    family: 'google',
    cls: 'system2',
    model,
    dialect: JUDGE_DIALECTS.google.id,
    ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
    cost: options.cost ?? CHAT_COST,
    settings: settingsOf('google-generate-content', {
      responseMimeType: 'application/json',
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
    }),
    async judge(original) {
      const request = withJudgeDialect(original, JUDGE_DIALECTS.google.id, options.reasoning);
      const reasoning = request.reasoning ?? options.reasoning;
      const prompt = buildPrompt(request);
      const ledgerPayload = isPairLedgerRequest(request)
        ? buildDialectRequest('google', { ...prompt, schema: responseSchema(request), reasoning }).payload
        : undefined;
      const { payload, recovery, accounting } = await postReasoningJson(
        'google',
        url,
        { 'x-goog-api-key': key },
        ledgerPayload
          ? {
              ...ledgerPayload,
              generationConfig: {
                ...(isRecord(ledgerPayload.generationConfig) ? ledgerPayload.generationConfig : {}),
                maxOutputTokens: budgetOf(request),
                temperature: TEMPERATURE,
              },
            }
          : {
              systemInstruction: { parts: [{ text: prompt.system }] },
              contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: isPairLedgerRequest(request)
                  ? googleResponseSchema(responseSchema(request))
                  : googleSchema(responseSchema(request)),
                maxOutputTokens: budgetOf(request),
                temperature: TEMPERATURE,
                ...(reasoning === undefined ? {} : { thinkingConfig: { thinkingLevel: reasoning } }),
              },
            },
        options,
      );
      const raw = JSON.stringify(payload);
      const candidate =
        isRecord(payload) && Array.isArray(payload.candidates) ? payload.candidates[0] : undefined;
      const feedback = isRecord(payload) ? payload.promptFeedback : undefined;
      if (!isRecord(candidate) && isRecord(feedback) && typeof feedback.blockReason === 'string') {
        return {
          answer: inconclusive(`${model} declined: the prompt was blocked (${feedback.blockReason})`),
          raw,
          ...accounting,
          ...(recovery ? { recovery } : {}),
        };
      }
      if (!isRecord(candidate)) {
        return {
          answer: inconclusive(`${model} answered without a candidate`),
          raw,
          unparsed: true,
          ...accounting,
          ...(recovery ? { recovery } : {}),
        };
      }
      const content = candidate.content;
      const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
      const text = parts
        .map((part) =>
          isRecord(part) && part.thought !== true && typeof part.text === 'string' ? part.text : '',
        )
        .join('');
      if (candidate.finishReason === 'MAX_TOKENS')
        return { ...truncated(text, model), ...(recovery ? { recovery } : {}), ...accounting };
      if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION')
        return {
          answer: inconclusive(`${model} declined the request`),
          raw,
          ...accounting,
          ...(recovery ? { recovery } : {}),
        };
      return { ...parseJudgeText(text, request), ...(recovery ? { recovery } : {}), ...accounting };
    },
  };
}

/** The text of an OpenAI message content: a string, or the text parts of a list joined in order. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

/** Gemini omits additionalProperties and JSON Schema dialect declarations at every level. */
function googleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(googleSchema);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'additionalProperties' && key !== '$schema')
        .map(([key, nested]) => [key, googleSchema(nested)]),
    );
  return value;
}
