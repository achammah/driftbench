import {
  errorText,
  type HttpOptions,
  isRecord,
  ModelError,
  postJson,
} from '@agent-nexus/driftbench-generate';
import type { Recorded, Wire } from './cassette';
import type { Label, Labelled, LabelSet, Window } from './labels';

/**
 * A labeler is a port: a window of numbered units and a label set in, a label name (or none) per unit out.
 * Nothing else leaves it, no text and no id outside the window. Every implementation renders the same
 * numbered units; one renders them as one dense request (a language model), another as one yes or no
 * question per unit and label, batched in one request per window (a probability model).
 */

export const PROMPT_VERSION = 'p1';
export const SCHEMA_VERSION = 's1';

export interface Labeler {
  /** Names the labeler in the cassette: `haiku`, `jev`, `jev-unit`. */
  readonly id: string;
  readonly family: string;
  readonly model: string;
  /** The most units one request for this set may hold. */
  maxUnits(set: LabelSet, wanted: number): number;
  /** The request as it goes on the wire. Pure: the same set and window give the same bytes. */
  render(set: LabelSet, window: Window): Wire;
  /** The labels a recorded answer gives. Pure: a threshold may change here without a new call. */
  interpret(answer: Recorded, set: LabelSet, window: Window): Labelled[];
  /** The network call. Absent on a labeler that can only replay. */
  call?(wire: Wire, set: LabelSet, window: Window): Promise<Recorded>;
}

/** An answer that cannot be read. The window is retried once, then listed as failed. */
export class LabelerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelerError';
  }
}

/** A set the labeler cannot serve. Nothing is sent. */
export class LabelerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelerConfigError';
  }
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

function labelLine(label: Label): string {
  const examples = label.examples?.length
    ? ` Examples: ${label.examples.map((example) => JSON.stringify(example)).join('; ')}`
    : '';
  const target = label.target ? ' (also give "target": the number of the unit that holds the other end)' : '';
  return `- ${label.name}: ${label.description}${examples}${target}`;
}

/** The fixed text of the dense request. Every word of a domain comes from the set, never from here. */
export const DENSE_SYSTEM =
  'You label numbered units of a document. For each unit give exactly one label from the list, or none. ' +
  'Answer with JSON only, no other text: {"labels": [{"units": "<n> or <a>-<b>", "label": "<name>"}]}. ' +
  'Every unit must appear once. A range joins neighbouring units that share a label. ' +
  'For a label that asks for a target, add "target": the number of the unit that holds the other end. ' +
  'Never copy text from the units.';

/** The numbered units of a window, one per line: `[n] text`. */
export function windowLines(window: Window): string[] {
  return window.units.map((unit) => `[${unit.n}] ${squash(unit.text)}`);
}

export function denseUser(set: LabelSet, window: Window): string {
  return [
    `SET ${set.set}: ${set.description}`,
    'LABELS:',
    ...set.labels.map(labelLine),
    '- none: no label of this set applies.',
    `WINDOW ${window.id}  path: ${window.headingPath.join(' > ') || '(top)'}`,
    ...windowLines(window),
  ].join('\n');
}

/** Reads the labels of a dense answer: JSON, optionally in one code fence. The request and its answer are one pair, so no id is echoed. */
export function parseDenseAnswer(text: string): Labelled[] {
  const trimmed = text.trim();
  const body = /^```[A-Za-z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed)?.[1] ?? trimmed;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new LabelerError('the answer is not JSON');
  }
  if (!isRecord(value) || !Array.isArray(value.labels)) {
    throw new LabelerError('the answer has no labels list');
  }
  const out: Labelled[] = [];
  for (const entry of value.labels) {
    if (
      !isRecord(entry) ||
      (typeof entry.units !== 'string' && typeof entry.units !== 'number') ||
      typeof entry.label !== 'string'
    ) {
      throw new LabelerError('a label entry is not {units, label}');
    }
    const target = entry.target;
    out.push({
      units: String(entry.units),
      label: entry.label,
      ...(typeof target === 'number' ? { target } : {}),
    });
  }
  return out;
}

export type HaikuOptions = HttpOptions & {
  model?: string;
  /** The key. Without it the labeler replays only. It stays in this closure and is never printed. */
  key?: string;
  baseUrl?: string;
  maxTokens?: number;
  /** Hidden reasoning before the answer. Off by default: labelling a numbered window needs none, and it costs output tokens. */
  thinking?: 'off' | 'default';
};

export const DEFAULT_HAIKU_MODEL = 'claude-haiku-5-5';

/** One dense request per window and set on the Anthropic Messages API. */
export function createHaikuLabeler(options: HaikuOptions = {}): Labeler {
  const model = options.model ?? DEFAULT_HAIKU_MODEL;
  const maxTokens = options.maxTokens ?? 4096;
  const base = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const key = options.key;
  const labeler: Labeler = {
    id: 'haiku',
    family: 'anthropic',
    model,
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({
      labeler: 'haiku',
      body: {
        model,
        max_tokens: maxTokens,
        ...(options.thinking === 'default' ? {} : { thinking: { type: 'disabled' } }),
        system: DENSE_SYSTEM,
        messages: [{ role: 'user', content: denseUser(set, window) }],
      },
    }),
    interpret: (answer) => answer.labels ?? [],
  };
  if (!key) return labeler;
  return {
    ...labeler,
    async call(wire) {
      const payload = await postJson(
        `${base}/v1/messages`,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        wire.body,
        errorText,
        options,
      );
      if (!isRecord(payload) || !Array.isArray(payload.content)) {
        throw new ModelError('bad_response', `${model} answered without a content list`);
      }
      const stop = String(payload.stop_reason ?? '');
      if (stop === 'refusal') throw new ModelError('refusal', `${model} declined the request`);
      if (stop === 'max_tokens')
        throw new ModelError('truncated', `${model} stopped at max_tokens: the answer is cut`);
      // Thinking blocks may come before the text: read the blocks by type.
      const text = payload.content
        .filter(
          (block): block is { type: 'text'; text: string } =>
            isRecord(block) && block.type === 'text' && typeof block.text === 'string',
        )
        .map((block) => block.text)
        .join('');
      const usage = isRecord(payload.usage) ? payload.usage : {};
      return {
        labels: parseDenseAnswer(text),
        returnedModel: String(payload.model ?? model),
        stopReason: stop,
        usage: { input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0) },
      };
    },
  };
}

/** The endpoint's own error type (`detail.error_type`) when it gives one; the usual provider text otherwise. */
function jevErrorText(status: number, payload: unknown): string {
  const detail = isRecord(payload) && isRecord(payload.detail) ? payload.detail : undefined;
  const type = typeof detail?.error_type === 'string' ? detail.error_type : undefined;
  return type ? `${status} ${type}` : errorText(status, payload);
}

/** Whether a failure says the request was too large for the endpoint: the scan halves the window and asks again. */
export function isTooLarge(cause: unknown): boolean {
  return cause instanceof ModelError && cause.status === 400 && /max_tokens_exceeded/.test(cause.message);
}

export type JevOptions = HttpOptions & {
  env?: Record<string, string | undefined>;
  /** `window`: one request per window, the whole numbered window as state. `unit`: one request per unit. */
  state?: 'window' | 'unit';
  /** The most questions one request may hold. Confirm the real cap with a call before relying on it. */
  maxQuestions?: number;
  /** A unit takes the label with the highest probability of yes at or above this; below it, none. */
  threshold?: number;
  /** Replay only: no key is read. */
  replayOnly?: boolean;
};

/**
 * Questions per Jev request. Section 10a of the design measured the best accuracy at 150 to 250 questions in a
 * request and a hard cap near 1,300; on the fictional fixture 1,002 questions were answered and 1,500 refused
 * with `max_tokens_exceeded`. The cap is a token budget, not a count. A refused request is halved by the scan.
 */
export const DEFAULT_JEV_MAX_QUESTIONS = 250;

/** The probability of yes a unit needs to take a label: measured best at 0.4 for a window and 0.7 for a single unit. */
export const DEFAULT_JEV_THRESHOLD = { window: 0.4, unit: 0.7 } as const;

export const questionKey = (n: number, label: string): string => `u${n}__${label}`;

function jevQuestion(label: Label, n: number): string {
  const examples = label.examples?.length
    ? ` Examples: ${label.examples.map((example) => JSON.stringify(example)).join('; ')}`
    : '';
  return `Label ${label.name}: ${label.description}${examples} Does this label apply to unit [${n}] of the numbered text? Answer yes or no.`;
}

/**
 * Jev, a yes or no probability model: one request per window and set. The state is the numbered window with
 * its heading path; the questions are one `noul` question per unit and label, keyed `u<n>__<label>`. A window
 * is cut short only when its units times its labels pass the question cap. The probabilities are recorded.
 */
export function createJevLabeler(options: JevOptions = {}): Labeler {
  const env = options.env ?? process.env;
  const granularity = options.state ?? 'window';
  const id = granularity === 'unit' ? 'jev-unit' : 'jev';
  const cap = options.maxQuestions ?? DEFAULT_JEV_MAX_QUESTIONS;
  const threshold = options.threshold ?? DEFAULT_JEV_THRESHOLD[granularity];
  const model = env.JEV_MODEL?.trim() || 'jev-latest';
  const labeler: Labeler = {
    id,
    family: 'jev',
    model,
    maxUnits: (set, wanted) =>
      granularity === 'unit' ? 1 : Math.max(1, Math.min(wanted, Math.floor(cap / set.labels.length))),
    render(set, window) {
      if (set.labels.some((label) => label.target)) {
        throw new LabelerConfigError(
          `the set ${set.set} has a label with a target; a yes or no model cannot name a target unit: use the dense labeler`,
        );
      }
      const questions: Record<string, unknown> = {};
      for (const unit of window.units) {
        for (const label of set.labels) {
          questions[questionKey(unit.n, label.name)] = {
            type: 'noul',
            instructions: { question: jevQuestion(label, unit.n) },
          };
        }
      }
      return {
        labeler: id,
        body: {
          model,
          state: {
            set: set.set,
            window: window.id,
            text: [`path: ${window.headingPath.join(' > ') || '(top)'}`, ...windowLines(window)].join('\n'),
          },
          questions,
        },
      };
    },
    interpret(answer, set, window) {
      const out: Labelled[] = [];
      for (const unit of window.units) {
        let best: { label: string; p: number } | undefined;
        let answered = 0;
        for (const label of set.labels) {
          const p = answer.probabilities?.[questionKey(unit.n, label.name)];
          if (typeof p !== 'number') continue;
          answered++;
          if (p >= threshold && (!best || p > best.p)) best = { label: label.name, p };
        }
        // A unit with an unanswered question stays out of the answer: it is listed as unlabeled.
        if (answered < set.labels.length) continue;
        out.push({ units: String(unit.n), label: best?.label ?? 'none' });
      }
      return out;
    },
  };
  if (options.replayOnly) return labeler;
  const key = env.JEV_API_KEY?.trim();
  if (!key) return labeler;
  const route = env.JEV_ROUTE?.trim();
  const url =
    env.JEV_URL?.trim() ||
    (route === 'gateway'
      ? 'https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone'
      : route === 'typesafe'
        ? 'https://api.typesafe.ai/v1/systemone'
        : undefined);
  if (!url) return labeler;
  const headers: Record<string, string> =
    route === 'gateway' ? { 'api-key': key } : { authorization: `Bearer ${key}` };
  return {
    ...labeler,
    async call(wire) {
      const payload = await postJson(url, headers, wire.body, jevErrorText, options);
      const answers = isRecord(payload) && isRecord(payload.answers) ? payload.answers : undefined;
      if (!answers) throw new ModelError('bad_response', 'jev answered without an answers object');
      const probabilities: Record<string, number> = {};
      for (const [name, answer] of Object.entries(answers)) {
        const p = isRecord(answer) ? answer.noul : undefined;
        if (typeof p === 'number' && p >= 0 && p <= 1) probabilities[name] = p;
      }
      return {
        probabilities,
        returnedModel: String(isRecord(payload) && typeof payload.model === 'string' ? payload.model : model),
        stopReason: 'answered',
        usage: { input: 0, output: 0 },
      };
    },
  };
}

/** A labeler by name, for replay or record: `haiku`, `jev`, `jev-unit`. */
export function labelerByName(
  name: string,
  options: {
    model?: string;
    env?: Record<string, string | undefined>;
    record: boolean;
    /** A yes or no labeler: the probability of yes a unit needs to take a label. */
    threshold?: number;
    fetch?: HttpOptions['fetch'];
  },
): Labeler | undefined {
  const env = options.env ?? process.env;
  const http = options.fetch ? { fetch: options.fetch } : {};
  if (name === 'haiku') {
    const key = options.record ? env.ANTHROPIC_API_KEY?.trim() : undefined;
    return createHaikuLabeler({
      ...http,
      ...(options.model ? { model: options.model } : {}),
      ...(key ? { key } : {}),
      ...(env.ANTHROPIC_BASE_URL ? { baseUrl: env.ANTHROPIC_BASE_URL } : {}),
    });
  }
  if (name === 'jev' || name === 'jev-unit') {
    return createJevLabeler({
      ...http,
      env,
      state: name === 'jev-unit' ? 'unit' : 'window',
      ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
      replayOnly: !options.record,
    });
  }
  return undefined;
}
