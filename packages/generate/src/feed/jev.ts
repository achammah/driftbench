import { type FetchLike, type HttpOptions, isRecord, postJson } from '../model/http';
import { ModelError } from '../model/port';
import type { ConversationReader, ReaderAnswer, ReaderQuestion } from './reader';

/**
 * Jev as a conversation reader (system 1). One request per conversation: the conversation is the `state`, and
 * the questions of every variable ride in the same request, so the conversation is sent once. A yes or no
 * question is a `noul` question and comes back as `{ noul: <probability of yes> }`; a choice question lists its
 * options in `criteria` and comes back as `{ choice, probabilities }`. The shapes were recorded against the
 * live service (see research/pointer-reader/jev-experiments/RESULTS-4.md).
 *
 * Configuration, as for the system 1 judge: JEV_API_KEY, JEV_MODEL (default jev-latest) and JEV_ROUTE
 * (`gateway`: api-key header; `typesafe`: bearer token) or JEV_URL. The key goes in a header and nowhere else:
 * not in an error, not in a log.
 */

const GATEWAY_URL = 'https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone';
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';

/**
 * The service takes about 65,000 input tokens in one call. Redacted conversations tokenise worse than prose: on a
 * private set, 5 of 9 conversations between 104,000 and 172,000 characters were refused by the service, and all
 * below 104,000 were read. The cap leaves that margin.
 */
export const JEV_MAX_CONVERSATION_CHARS = 100_000;

export type JevReaderOptions = HttpOptions & {
  env?: Record<string, string | undefined>;
  id?: string;
  /** Longer conversations are refused before they are sent. Default JEV_MAX_CONVERSATION_CHARS. */
  maxChars?: number;
};

/** What the service reported using, summed over the calls of one reader. Jev's price is on input tokens. */
export type JevUsage = { calls: number; inputTokens: number; outputTokens: number };

export type JevReader = ConversationReader & { usage(): JevUsage };

export function createJevReader(options: JevReaderOptions = {}): JevReader {
  const env = options.env ?? process.env;
  const route = env.JEV_ROUTE?.trim();
  if (route !== undefined && route !== '' && route !== 'gateway' && route !== 'typesafe') {
    throw new ModelError('config', 'JEV_ROUTE is gateway or typesafe');
  }
  const key = env.JEV_API_KEY?.trim();
  if (!key) throw new ModelError('config', 'JEV_API_KEY is not set');
  const url =
    env.JEV_URL?.trim() ||
    (route === 'gateway' ? GATEWAY_URL : route === 'typesafe' ? TYPESAFE_URL : undefined);
  if (url === undefined) throw new ModelError('config', 'set JEV_ROUTE (gateway or typesafe) or JEV_URL');
  const headers: Record<string, string> =
    route === 'gateway' ? { 'api-key': key } : { authorization: `Bearer ${key}` };
  const model = env.JEV_MODEL?.trim() || 'jev-latest';
  const maxChars = options.maxChars ?? JEV_MAX_CONVERSATION_CHARS;
  const http: HttpOptions = {
    ...(options.fetch ? { fetch: options.fetch as FetchLike } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };
  const used: JevUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  return {
    usage: () => ({ ...used }),
    id: options.id ?? 'jev',
    family: 'jev',
    model,
    async read(conversation, questions) {
      if (conversation.length > maxChars) {
        throw new ModelError(
          'config',
          `a conversation of ${conversation.length} characters is longer than ${maxChars}`,
        );
      }
      const payload = await postJson(
        url,
        headers,
        {
          model,
          state: conversation,
          questions: Object.fromEntries(questions.map((q) => [q.name, body(q)])),
        },
        describeError,
        http,
      );
      const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {};
      used.calls++;
      if (typeof usage.input_tokens === 'number') used.inputTokens += usage.input_tokens;
      if (typeof usage.output_tokens === 'number') used.outputTokens += usage.output_tokens;
      const answers = isRecord(payload) && isRecord(payload.answers) ? payload.answers : {};
      const out: Record<string, ReaderAnswer | undefined> = {};
      for (const question of questions) out[question.name] = answerOf(question, answers[question.name]);
      return out;
    },
  };
}

function body(question: ReaderQuestion): Record<string, unknown> {
  if (question.kind === 'yesno') return { type: 'noul', instructions: { question: question.text } };
  return {
    type: 'choice',
    instructions: question.text,
    criteria: Object.fromEntries(question.options.map((option) => [option.id, option.description])),
  };
}

function answerOf(question: ReaderQuestion, raw: unknown): ReaderAnswer | undefined {
  if (!isRecord(raw)) return undefined;
  if (question.kind === 'yesno') return typeof raw.noul === 'number' ? { yes: raw.noul } : undefined;
  if (!isRecord(raw.probabilities)) return undefined;
  const probabilities: Record<string, number> = {};
  for (const [id, p] of Object.entries(raw.probabilities)) if (typeof p === 'number') probabilities[id] = p;
  return { probabilities };
}

/** Jev answers errors as `{ detail: { error_type, message } }`, or a list of validation errors that quote the request. Only the first kind is read. */
function describeError(status: number, payload: unknown): string {
  const detail = isRecord(payload) ? payload.detail : undefined;
  if (isRecord(detail)) {
    const type = typeof detail.error_type === 'string' ? detail.error_type : undefined;
    const message = typeof detail.message === 'string' ? detail.message : undefined;
    if (type && message) return `${status} ${type}: ${message}`;
    if (message) return `${status}: ${message}`;
  }
  if (typeof detail === 'string') return `${status}: ${detail.slice(0, 200)}`;
  return `${status}: the service refused the request`;
}
