import {
  parseRetryAfter,
  type RetryLayer,
  retryableStatus,
  retrying,
  retryPolicy,
} from '@agent-nexus/driftbench-core';

/** The fetch a client calls. Tests pass their own; the default is the global fetch. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpOptions = {
  fetch?: FetchLike;
  /** Abort one attempt after this long. Default 120 seconds. */
  timeoutMs?: number;
  /**
   * The retry settings over the shared policy's defaults: four attempts, a 500 ms base doubled up to 30 s,
   * full jitter, Retry-After honoured. Only a 408, a 429, a 5xx (529 included), a network failure or a timeout is
   * retried. Each retry goes to the current `collectRetries` scope: the council records it in the vote.
   */
  retry?: RetryLayer;
  /** Extra attempts after the first; same as `retry.maxAttempts` minus one. */
  maxRetries?: number;
  /** Waits between attempts. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
};

export type JudgeErrorCode =
  | 'config'
  | 'http'
  | 'network'
  | 'bad_response'
  | 'cassette_miss'
  | 'reasoning-budget-exhausted';

/** A judge call that gave no answer. The message never holds a key or a header. */
export class JudgeError extends Error {
  readonly code: JudgeErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  /** The wait the provider asked for in its Retry-After header. */
  readonly retryAfterMs?: number;

  constructor(
    code: JudgeErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'JudgeError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Posts one JSON body and returns the parsed JSON answer. Retries under the shared policy what may pass
 * later (a 429, a 5xx, a network failure), never another status. The headers, which carry the key, never reach an error message: errors name the URL
 * and the status, and quote at most 200 characters of the provider's error body.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: HttpOptions = {},
): Promise<unknown> {
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 120_000;
  const policy = retryPolicy(
    options.maxRetries === undefined ? undefined : { maxAttempts: options.maxRetries + 1 },
    options.retry,
  );
  const text = JSON.stringify(body);
  let last: JudgeError | undefined;

  const attempt = async (): Promise<unknown> => {
    let response: Response;
    let raw: string;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: text,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = await response.text();
    } catch (cause) {
      const why = cause instanceof Error ? cause.name : 'error';
      last = new JudgeError('network', `${url} could not be reached (${why})`, { retryable: true });
      throw last;
    }
    const payload = parseJson(raw);
    if (response.ok) {
      if (payload === undefined) {
        throw new JudgeError(
          'bad_response',
          `${url} answered ${response.status} with a body that is not JSON`,
        );
      }
      return payload;
    }
    const said = clip(scrub(errorText(payload, raw), headers));
    const retryAfterMs = retryAfterOf(response.headers);
    last = new JudgeError('http', `${url} answered ${response.status}: ${said}`, {
      status: response.status,
      retryable: retryableStatus(response.status),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
    throw last;
  };

  try {
    return await retrying(`judge ${url}`, attempt, {
      policy,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      decide: (error) => {
        const judged = error instanceof JudgeError ? error : undefined;
        return {
          retry: judged?.retryable === true,
          ...(judged?.status === undefined ? {} : { status: judged.status }),
          ...(judged?.retryAfterMs === undefined ? {} : { retryAfterMs: judged.retryAfterMs }),
          reason: error instanceof Error ? error.message : String(error),
        };
      },
    });
  } catch (error) {
    // The policy ends its retries with its own error around the last failure: the caller gets the failure.
    if (error instanceof JudgeError) throw error;
    if (last) throw last;
    throw error;
  }
}

function retryAfterOf(headers: Headers): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms && /^\d+(\.\d+)?$/.test(ms.trim())) return Math.round(Number(ms));
  return parseRetryAfter(headers.get('retry-after'));
}

function parseJson(raw: string): unknown {
  if (raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** A short sentence from a provider's error body. */
function errorText(payload: unknown, raw: string): string {
  if (isRecord(payload)) {
    const error = payload.error;
    if (isRecord(error) && typeof error.message === 'string') return error.message;
    if (typeof error === 'string') return error;
    if (typeof payload.message === 'string') return payload.message;
  }
  return raw.trim() === '' ? 'no body' : raw;
}

/** Removes every header value (a key, a bearer token) a provider may echo back in its error body. */
function scrub(text: string, headers: Record<string, string>): string {
  let out = text;
  for (const value of Object.values(headers)) {
    for (const secret of [value, value.replace(/^Bearer\s+/i, '')]) {
      if (secret.length >= 1) out = out.split(secret).join('[redacted]');
    }
  }
  return out;
}

function clip(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a required variable. The error names the variable, never a value. */
export function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new JudgeError('config', `${name} is not set`);
  return value;
}
