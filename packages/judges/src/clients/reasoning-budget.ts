import { type HttpOptions, isRecord, JudgeError, postJson } from '../http';
import { type TokenUsage, usageFromResponse } from './usage';

/** Headroom, not a hard partition on providers that expose only a combined limit. */
export type TokenBudget = {
  readonly answerTokens: number;
  readonly reasoningTokens: number;
  /** Gemini budget-capable models only. Replaces thinkingLevel with thinkingBudget. */
  readonly googleThinkingBudget?: boolean;
};
/** Prices come from the caller, never an embedded tariff that can become stale. */
export type ReasoningMetering = {
  readonly costOfUsage: (usage: TokenUsage) => number;
  readonly maxCostUsd?: number;
  /** Conservative reservation for the entire second request, including its input. */
  readonly maxRetryCostUsd?: number;
};
export type ReasoningAccounting = {
  readonly usage: TokenUsage;
  readonly requestCount: number;
  readonly reaskReason?: 'reasoning-budget-exhausted';
  readonly costUsd?: number;
  readonly usageComplete: boolean;
  readonly costComplete: boolean;
};
export type ReasoningRecovery = ReasoningAccounting & {
  readonly kind: 'reasoning-budget-exhausted';
  readonly attempts: readonly {
    readonly raw: string;
    readonly usage: TokenUsage;
    readonly costUsd?: number;
  }[];
  readonly retrySkipped?: 'spend-cap';
};
export class ReasoningBudgetError extends JudgeError {
  readonly usage: TokenUsage;
  readonly costUsd?: number;
  readonly requestCount: number;
  readonly reaskReason = 'reasoning-budget-exhausted';
  readonly costComplete: boolean;
  readonly usageComplete: boolean;
  constructor(readonly recovery: ReasoningRecovery) {
    super('reasoning-budget-exhausted', 'reasoning-budget-exhausted: no answer within the recovery budget');
    this.usage = recovery.usage;
    this.costUsd = recovery.costUsd;
    this.requestCount = recovery.requestCount;
    this.costComplete = recovery.costComplete;
    this.usageComplete = recovery.usageComplete;
  }
}
export function validateTokenBudget(budget: TokenBudget | undefined, provider: string): void {
  if (!budget) return;
  if (provider !== 'openai' && provider !== 'google')
    throw new JudgeError('config', 'tokenBudget requires OpenAI or Google');
  if (
    !Number.isSafeInteger(budget.answerTokens) ||
    budget.answerTokens <= 0 ||
    !Number.isSafeInteger(budget.reasoningTokens) ||
    budget.reasoningTokens < 0 ||
    !Number.isSafeInteger(budget.answerTokens + budget.reasoningTokens)
  )
    throw new RangeError('tokenBudget requires positive answerTokens and nonnegative reasoningTokens');
  if (budget.googleThinkingBudget && provider !== 'google')
    throw new JudgeError('config', 'googleThinkingBudget requires Google');
}
export function budgetBody(
  provider: string,
  body: Record<string, unknown>,
  budget?: TokenBudget,
): Record<string, unknown> {
  if (!budget) return body;
  const tokens = budget.answerTokens + budget.reasoningTokens;
  if (provider === 'openai') return { ...body, max_completion_tokens: tokens };
  const config = isRecord(body.generationConfig) ? body.generationConfig : {};
  return {
    ...body,
    generationConfig: {
      ...config,
      maxOutputTokens: tokens,
      ...(budget.googleThinkingBudget ? { thinkingConfig: { thinkingBudget: budget.reasoningTokens } } : {}),
    },
  };
}
function emptyLength(provider: string, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const rows = provider === 'openai' ? payload.choices : payload.candidates;
  const row = Array.isArray(rows) && isRecord(rows[0]) ? rows[0] : {};
  const content = provider === 'openai' ? row.message : row.content;
  const value = isRecord(content) ? (provider === 'openai' ? content.content : content.parts) : undefined;
  const text =
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value
            .filter((p) => isRecord(p) && p.thought !== true && typeof p.text === 'string')
            .map((p) => p.text)
            .join('')
        : '';
  const usage = provider === 'openai' && isRecord(payload.usage) ? payload.usage : {};
  const details = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const thoughts =
    provider === 'google' && isRecord(payload.usageMetadata)
      ? payload.usageMetadata.thoughtsTokenCount
      : details.reasoning_tokens;
  return (
    (!text.trim() || (typeof thoughts === 'number' && thoughts > 0)) &&
    (provider === 'openai' ? row.finish_reason === 'length' : row.finishReason === 'MAX_TOKENS')
  );
}
export function recoveryBody(provider: string, body: Record<string, unknown>): Record<string, unknown> {
  if (provider === 'openai')
    return {
      ...body,
      max_completion_tokens: Number(body.max_completion_tokens) * 2,
      ...(body.reasoning_effort === undefined ? {} : { reasoning_effort: 'low' }),
    };
  const config = isRecord(body.generationConfig) ? body.generationConfig : {};
  const thinking = isRecord(config.thinkingConfig) ? config.thinkingConfig : {};
  return {
    ...body,
    generationConfig: {
      ...config,
      maxOutputTokens: Number(config.maxOutputTokens) * 2,
      ...(typeof thinking.thinkingBudget === 'number'
        ? {
            thinkingConfig: {
              ...thinking,
              thinkingBudget: Math.min(1024, Math.floor(thinking.thinkingBudget / 2)),
            },
          }
        : thinking.thinkingLevel === undefined
          ? {}
          : { thinkingConfig: { ...thinking, thinkingLevel: 'low' } }),
    },
  };
}
export async function postReasoningJson(
  provider: 'openai' | 'google',
  url: string,
  headers: Record<string, string>,
  original: Record<string, unknown>,
  options: HttpOptions & { tokenBudget?: TokenBudget; metering?: ReasoningMetering },
) {
  const meter = options.metering;
  for (const n of [meter?.maxCostUsd, meter?.maxRetryCostUsd])
    if (n !== undefined && (!Number.isFinite(n) || n < 0))
      throw new RangeError('metering spend limits must be finite and nonnegative');
  const body = budgetBody(provider, original, options.tokenBudget);
  const attempts: { raw: string; usage: TokenUsage; costUsd?: number }[] = [];
  let requestCount = 0;
  let reasked = false;
  const fetchFn = options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const countedOptions: HttpOptions = {
    ...options,
    fetch: (url, init) => {
      requestCount++;
      return fetchFn(url, init);
    },
  };
  const receipt = (payload: unknown) => {
    let usage = usageFromResponse(provider, payload);
    if (provider === 'google' && isRecord(payload) && isRecord(payload.usageMetadata)) {
      const thoughts = payload.usageMetadata.thoughtsTokenCount;
      if (typeof thoughts === 'number' && Number.isFinite(thoughts) && thoughts >= 0)
        usage = { ...usage, output: (usage.output ?? 0) + thoughts };
    }
    const costUsd =
      meter && usage.input !== undefined && usage.output !== undefined ? meter.costOfUsage(usage) : undefined;
    if (costUsd !== undefined && (!Number.isFinite(costUsd) || costUsd < 0))
      throw new RangeError('costOfUsage must return a finite nonnegative cost');
    attempts.push({ raw: JSON.stringify(payload), usage, ...(costUsd === undefined ? {} : { costUsd }) });
  };
  const accounting = (): ReasoningAccounting => ({
    usage: {
      input: attempts.reduce((n, a) => n + (a.usage.input ?? 0), 0),
      output: attempts.reduce((n, a) => n + (a.usage.output ?? 0), 0),
    },
    requestCount,
    ...(reasked ? { reaskReason: 'reasoning-budget-exhausted' as const } : {}),
    ...(meter ? { costUsd: attempts.reduce((n, a) => n + (a.costUsd ?? 0), 0) } : {}),
    usageComplete:
      attempts.length === requestCount &&
      attempts.every((a) => a.usage.input !== undefined && a.usage.output !== undefined),
    costComplete: attempts.length === requestCount && attempts.every((a) => a.costUsd !== undefined),
  });
  const recovery = (retrySkipped?: 'spend-cap'): ReasoningRecovery => ({
    ...accounting(),
    kind: 'reasoning-budget-exhausted',
    attempts,
    ...(retrySkipped ? { retrySkipped } : {}),
  });
  const first = await postJson(url, headers, body, countedOptions);
  receipt(first);
  if (!emptyLength(provider, first)) return { payload: first, accounting: meter ? accounting() : undefined };
  const spent = accounting();
  if (
    meter?.maxCostUsd !== undefined &&
    (!spent.costComplete ||
      meter.maxRetryCostUsd === undefined ||
      (spent.costUsd ?? 0) + meter.maxRetryCostUsd > meter.maxCostUsd)
  )
    throw new ReasoningBudgetError(recovery('spend-cap'));
  reasked = true;
  let second: unknown;
  try {
    // The reservation covers one submission, not another transport retry loop.
    second = await postJson(url, headers, recoveryBody(provider, body), {
      ...countedOptions,
      maxRetries: 0,
      retry: { ...options.retry, maxAttempts: 1 },
    });
  } catch (cause) {
    const error = new ReasoningBudgetError(recovery());
    error.cause = cause;
    throw error;
  }
  receipt(second);
  const recovered = recovery();
  if (emptyLength(provider, second)) throw new ReasoningBudgetError(recovered);
  return { payload: second, recovery: recovered, accounting: accounting() };
}
