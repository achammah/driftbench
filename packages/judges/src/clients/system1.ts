import type { ClientOptions, JudgeClient } from '../client';
import { inconclusive, type JudgeRequest, type JudgeResult, outcomeFromProbability } from '../contract';
import { isRecord, JudgeError, postJson, requireEnv } from '../http';
import { buildPrompt, DATA_RULE, renderRubric, SYSTEM1_QUESTION } from '../prompt';
import { JUDGE_DIALECTS } from './dialects';

/**
 * The system 1 judges: a fixed binary question per criterion, answered with a probability. Both shapes
 * below come from the providers' public descriptions and are UNVERIFIED until a live call confirms them.
 * The raw JSON answer is kept as the vote's reasoning, so a report can show what the judge returned.
 */

const SYSTEM1_COST = 1;

/** The focus line Jev is asked to read the FAIL picture first. */
const JEV_FOCUS = 'Read the FAIL picture first. When the data matches it, the answer is no.';

/** Where a probability turns into pass or fail. Between the two the answer is inconclusive. */
export type ProbabilityBounds = { passAt?: number; failAt?: number };

const JEV_GATEWAY_URL = 'https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone';
const JEV_TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';

export type System1Options = ClientOptions & ProbabilityBounds;

/** The question a system 1 judge answers yes or no. Yes means the criterion passes. */
export function binaryQuestion(request: JudgeRequest): string {
  return `${renderRubric(request.criterion)}\n\n${SYSTEM1_QUESTION}\n${DATA_RULE}`;
}

function fromProbability(
  probability: unknown,
  raw: string,
  judge: string,
  bounds: ProbabilityBounds,
): JudgeResult {
  if (typeof probability !== 'number' || Number.isNaN(probability) || probability < 0 || probability > 1) {
    return {
      answer: inconclusive(`${judge} answered without a probability from 0 to 1`),
      raw,
      unparsed: true,
    };
  }
  const outcome = outcomeFromProbability(probability, bounds);
  return {
    answer: { outcome, score: probability, reasoning: `${judge} probability of yes ${probability}: ${raw}` },
    raw,
  };
}

/**
 * Jev, a system 1 judge: POST {JEV_URL} with `{ model, state, questions }`, one question `verdict` of type
 * `noul` (a yes or no question), and the answer `{ model, answers: { verdict: { noul: <probability of yes> } } }`.
 * Reads JEV_URL, JEV_API_KEY and JEV_MODEL (default jev-latest). JEV_ROUTE picks the route: `gateway` sends the key in the
 * api-key header (the Nexus gateway URL is used only when JEV_ROUTE=gateway is set and JEV_URL is not), `typesafe` sends a
 * bearer token (URL default the direct API); without
 * it JEV_URL is required and the key is a bearer token. UNVERIFIED in
 * this repository until a live call: the shape follows the provider's published request format.
 */
export function createJevJudge(options: System1Options = {}): JudgeClient {
  if (options.reasoning !== undefined)
    throw new JudgeError('config', 'reasoning is not supported by the Jev client');
  const env = options.env ?? process.env;
  const route = env.JEV_ROUTE?.trim();
  if (route !== undefined && route !== '' && route !== 'gateway' && route !== 'typesafe')
    throw new JudgeError('config', 'JEV_ROUTE is gateway or typesafe');
  const url =
    env.JEV_URL?.trim() ||
    (route === 'gateway'
      ? JEV_GATEWAY_URL
      : route === 'typesafe'
        ? JEV_TYPESAFE_URL
        : requireEnv(env, 'JEV_URL'));
  const key = requireEnv(env, 'JEV_API_KEY');
  // The Nexus gateway takes the key in the api-key header; the direct TypeSafe route takes a bearer token.
  const keyHeader: Record<string, string> =
    route === 'gateway' ? { 'api-key': key } : { authorization: `Bearer ${key}` };
  const model = env.JEV_MODEL?.trim() || options.model || 'jev-latest';
  const id = options.id ?? 'jev';
  return {
    id,
    family: 'jev',
    dialect: JUDGE_DIALECTS.jev.id,
    cls: 'system1',
    model,
    cost: options.cost ?? SYSTEM1_COST,
    settings: JSON.stringify({
      client: 'jev',
      questionType: 'noul',
      answerContract: 'legacy',
      focus: JEV_FOCUS,
      passAt: options.passAt ?? null,
      failAt: options.failAt ?? null,
    }),
    async judge(request) {
      const prompt = buildPrompt({ ...request, answerContract: 'legacy' });
      const payload = await postJson(
        url,
        keyHeader,
        {
          model,
          state: { criterion: request.criterion.name, data: prompt.user },
          questions: {
            verdict: {
              type: 'noul',
              instructions: {
                question: binaryQuestion(request),
                focus: JEV_FOCUS,
              },
            },
          },
        },
        options,
      );
      const raw = JSON.stringify(payload);
      const answers = isRecord(payload) ? payload.answers : undefined;
      const verdict = isRecord(answers) ? answers.verdict : undefined;
      return fromProbability(isRecord(verdict) ? verdict.noul : undefined, raw, id, options);
    },
  };
}

/**
 * The OpenAI Decisions API, a system 1 judge: POST {OPENAI_BASE_URL}/v1/decisions with
 * `{ model, input, questions: [{ type: 'predicate', name: 'verdict', instructions }] }`; the answer is
 * `{ answers: [{ name: 'verdict', probability }] }`, or `{ name, type: 'refusal' }` when it declines.
 * Reads OPENAI_API_KEY, OPENAI_DECISIONS_MODEL and OPENAI_BASE_URL (default https://api.openai.com).
 * Its family is openai. UNVERIFIED in this repository until a live call.
 */
export function createOpenAiDecisionsJudge(options: System1Options = {}): JudgeClient {
  if (options.reasoning !== undefined)
    throw new JudgeError('config', 'reasoning is not supported by the OpenAI Decisions client');
  const env = options.env ?? process.env;
  const key = requireEnv(env, 'OPENAI_API_KEY');
  const model = env.OPENAI_DECISIONS_MODEL?.trim() || options.model;
  if (!model) throw new JudgeError('config', 'OPENAI_DECISIONS_MODEL is not set and no model was given');
  const base = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com').replace(/\/+$/, '');
  const id = options.id ?? 'openai-decisions';
  return {
    id,
    family: 'openai',
    dialect: JUDGE_DIALECTS['openai-decisions'].id,
    cls: 'system1',
    model,
    cost: options.cost ?? SYSTEM1_COST,
    async judge(request) {
      const prompt = buildPrompt({ ...request, answerContract: 'legacy' });
      const payload = await postJson(
        `${base}/v1/decisions`,
        { authorization: `Bearer ${key}` },
        {
          model,
          input: prompt.user,
          questions: [{ type: 'predicate', name: 'verdict', instructions: binaryQuestion(request) }],
        },
        options,
      );
      const raw = JSON.stringify(payload);
      const answers = isRecord(payload) && Array.isArray(payload.answers) ? payload.answers : [];
      const verdict = answers.find((answer) => isRecord(answer) && answer.name === 'verdict');
      if (isRecord(verdict) && verdict.type === 'refusal') {
        return { answer: inconclusive(`${id} declined the question`), raw };
      }
      return fromProbability(isRecord(verdict) ? verdict.probability : undefined, raw, id, options);
    },
  };
}
