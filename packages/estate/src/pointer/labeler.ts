import { ModelError } from '@agent-nexus/driftbench-generate';
import type { Recorded, Wire } from './cassette';
import type { LabelSet, Window } from './labels';

/**
 * A labeler is a port: a window of numbered units and a label set in, an opinion per unit out. Nothing else
 * leaves it, no text and no id outside the window. Two classes exist, the two the judges use. A system 1
 * labeler asks one yes or no question per unit and label and reads a probability of yes. A system 2 labeler
 * is a chat model that answers the whole window at once with one label per unit. A stack puts a system 1
 * labeler in front of a system 2 labeler (see `stack.ts`); a user labeler goes through the same port.
 */

export const PROMPT_VERSION = 'p1';
export const SCHEMA_VERSION = 's1';

/** The two classes of the judges: a fixed yes or no question with a probability, and a chat model. */
export type LabelerClass = 'system1' | 'system2';

/** What a labeler says about one unit. */
export type Opinion = {
  /** A label of the set, or `none`. */
  label: string;
  /** System 1: the probability of yes for every label that was asked. */
  probabilities?: Record<string, number>;
  /** The unit, as its index in the file, at the other end of a label that asks for one. */
  target?: number;
  /** The first 12 characters of the cassette key of the answer this opinion comes from. */
  source?: string;
};

/** The opinions of one answer, by unit index in the file, and the answers parts it refused, with the reason. */
export type Opinions = { byUnit: Map<number, Opinion>; refusals: string[] };

export interface Labeler {
  /** Names the labeler in the cassette key: `anthropic`, `jev`, `openai-decisions`, `http:<hash>`. */
  readonly id: string;
  readonly cls: LabelerClass;
  readonly family: string;
  readonly model: string;
  /** What decides a label besides the answer (a threshold, a state). Part of the identity of the labels. */
  readonly settings: Readonly<Record<string, unknown>>;
  /** The most units one request for this set may hold. */
  maxUnits(set: LabelSet, wanted: number): number;
  /** The request as it goes on the wire. Pure: the same set and window give the same bytes. */
  render(set: LabelSet, window: Window): Wire;
  /** The opinions a recorded answer gives. Pure: a threshold may change here without a new call. */
  opinions(answer: Recorded, set: LabelSet, window: Window): Opinions;
  /** The network call. Absent on a labeler that can only replay. */
  call?(wire: Wire, set: LabelSet, window: Window, attempt?: number): Promise<Recorded>;
}

/** An answer that cannot be read. The window is retried once, then listed as failed. */
export class LabelerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelerError';
  }
}

/** A set or a setting the labeler cannot serve. Nothing is sent. */
export class LabelerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelerConfigError';
  }
}

/** Whether a failure says the request was too large for the endpoint: the scan halves the window and asks again. */
export function isTooLarge(cause: unknown): boolean {
  return cause instanceof ModelError && cause.status === 400 && /max_tokens_exceeded/.test(cause.message);
}

/** The usage an endpoint reports, as numbers. A missing figure is 0, never a guess. */
export function usageOf(payload: unknown): { input: number; output: number } {
  if (payload === null || typeof payload !== 'object') return { input: 0, output: 0 };
  const usage = (payload as { usage?: unknown }).usage;
  if (usage === null || typeof usage !== 'object') return { input: 0, output: 0 };
  const { input_tokens: input, output_tokens: output } = usage as Record<string, unknown>;
  return {
    input: typeof input === 'number' && Number.isFinite(input) ? input : 0,
    output: typeof output === 'number' && Number.isFinite(output) ? output : 0,
  };
}
