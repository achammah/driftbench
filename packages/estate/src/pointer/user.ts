import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type HttpOptions, isRecord, postJson } from '@agent-nexus/driftbench-generate';
import type { Recorded } from './cassette';
import { sha } from './cut';
import { DENSE_SYSTEM, denseLabels, denseOpinions, denseUser } from './dense';
import { type Labeler, type LabelerClass, LabelerConfigError, LabelerError, usageOf } from './labeler';
import type { LabelSet, Window } from './labels';
import {
  askedLabels,
  DEFAULT_MAX_QUESTIONS,
  DEFAULT_THRESHOLD,
  yesNoOpinions,
  yesNoQuestions,
  yesNoText,
} from './yesno';

/**
 * A user labeler goes through the same port as the built-in ones, by an HTTP endpoint or by a module. It is
 * sent one request per window, it answers in the shape of its class, and the answer is recorded in the
 * cassette and replayed from it like any other. Its id is part of every cassette key.
 *
 * The request holds the set (names, descriptions, examples and targets, not the estate mapping), the window,
 * and the question in the form of the class:
 *
 *   system 2: { set, window, prompt: { system, user } }   answer { labels: [{ units, label, target? }] }
 *   system 1: { set, window, state, questions }           answer { probabilities: { <key>: 0..1 } }
 *
 * The answer may also carry `model` (a string) and `usage` ({ input_tokens, output_tokens }).
 */

export type UserOptions = {
  /** A yes or no labeler: the probability of yes a unit needs to take a label. */
  threshold?: number;
  maxQuestions?: number;
  /** Inside a stack: leave the labels that ask for a target to the system 2 labeler. */
  skipTargetLabels?: boolean;
};

/** The body a user labeler is sent for a window. */
export function userRequest(
  cls: LabelerClass,
  set: LabelSet,
  window: Window,
  skipTargetLabels: boolean,
): Record<string, unknown> {
  const setBody = {
    name: set.set,
    description: set.description,
    labels: set.labels.map((label) => ({
      name: label.name,
      description: label.description,
      ...(label.examples ? { examples: label.examples } : {}),
      ...(label.target ? { target: label.target } : {}),
    })),
  };
  const windowBody = {
    id: window.id,
    path: window.path,
    headingPath: window.headingPath,
    units: window.units.map((unit) => ({ n: unit.n, text: unit.text })),
  };
  if (cls === 'system2') {
    return {
      set: setBody,
      window: windowBody,
      prompt: { system: DENSE_SYSTEM, user: denseUser(set, window) },
    };
  }
  return {
    set: setBody,
    window: windowBody,
    state: yesNoText(window),
    questions: Object.fromEntries(yesNoQuestions(askedLabels(set, skipTargetLabels), window)),
  };
}

/** Reads an answer in the shape of the class; anything else is an answer that cannot be read. */
export function userAnswer(cls: LabelerClass, payload: unknown, model: string): Recorded {
  if (!isRecord(payload)) throw new LabelerError('the answer is not a JSON object');
  const common = {
    returnedModel: typeof payload.model === 'string' ? payload.model : model,
    stopReason: 'answered',
    usage: usageOf(payload),
  };
  if (cls === 'system2') return { labels: denseLabels(payload), ...common };
  const probabilities = payload.probabilities;
  if (!isRecord(probabilities)) throw new LabelerError('the answer has no probabilities object');
  const checked: Record<string, number> = {};
  for (const [key, p] of Object.entries(probabilities)) {
    if (typeof p === 'number' && p >= 0 && p <= 1) checked[key] = p;
  }
  return { probabilities: checked, ...common };
}

type Core = {
  id: string;
  cls: LabelerClass;
  family: string;
  model: string;
  /** Undefined on a labeler that can only replay. */
  send?: (body: Record<string, unknown>) => Promise<unknown>;
};

function labelerOf(core: Core, options: UserOptions): Labeler {
  const skip = options.skipTargetLabels === true;
  const cap = options.maxQuestions ?? DEFAULT_MAX_QUESTIONS;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD.window;
  const base: Labeler = {
    id: core.id,
    cls: core.cls,
    family: core.family,
    model: core.model,
    settings: core.cls === 'system1' ? { threshold } : {},
    maxUnits: (set, wanted) =>
      core.cls === 'system2'
        ? wanted
        : Math.max(1, Math.min(wanted, Math.floor(cap / askedLabels(set, skip).length))),
    render: (set, window) => ({ labeler: core.id, body: userRequest(core.cls, set, window, skip) }),
    opinions: (answer, set, window) =>
      core.cls === 'system2'
        ? denseOpinions(answer, set, window)
        : yesNoOpinions(answer, window, askedLabels(set, skip), threshold),
  };
  const send = core.send;
  if (!send) return base;
  return {
    ...base,
    async call(wire) {
      return userAnswer(core.cls, await send(wire.body), core.model);
    },
  };
}

export type HttpLabelerOptions = UserOptions &
  HttpOptions & {
    url: string;
    cls: LabelerClass;
    env?: Record<string, string | undefined>;
    /** The name of the variable that holds a bearer token. The token is never an option, so it is never printed. */
    keyVariable?: string;
    model?: string;
    /** Replay only: no key is read and no request is sent. */
    replayOnly?: boolean;
  };

/** The id of an HTTP labeler: the endpoint, hashed, so a secret in a URL never reaches a cassette. */
export const httpLabelerId = (url: string): string => `http:${sha(url).slice(0, 12)}`;

/** A user labeler behind an HTTP endpoint that takes the request as a JSON body and answers in the shape of its class. */
export function createHttpLabeler(options: HttpLabelerOptions): Labeler {
  const env = options.env ?? process.env;
  let target: URL;
  try {
    target = new URL(options.url);
  } catch {
    throw new LabelerConfigError(`"${options.url}" is no URL`);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new LabelerConfigError(`the labeler URL is http or https, not ${target.protocol}`);
  }
  let send: Core['send'];
  if (!options.replayOnly) {
    let headers: Record<string, string> = {};
    if (options.keyVariable) {
      const key = env[options.keyVariable]?.trim();
      if (!key) throw new LabelerConfigError(`${options.keyVariable} is not set`);
      headers = { authorization: `Bearer ${key}` };
    }
    send = (body) =>
      postJson(
        options.url,
        headers,
        body,
        (status) => `${status}: the labeler endpoint answered with an error`,
        options,
      );
  }
  return labelerOf(
    {
      id: httpLabelerId(options.url),
      cls: options.cls,
      family: 'http',
      model: options.model ?? `http@${target.host}`,
      ...(send ? { send } : {}),
    },
    options,
  );
}

/** What a labeler module exports: an object of this shape, or a function that returns one. */
export type LabelerModule = {
  id: string;
  cls: LabelerClass;
  model?: string;
  family?: string;
  label(request: Record<string, unknown>): Promise<unknown> | unknown;
};

const MODULE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** Loads a labeler module. The module is the user's own code and runs in this process. */
export async function loadModuleLabeler(
  path: string,
  options: UserOptions & { cwd: string; replayOnly?: boolean },
): Promise<Labeler> {
  const file = resolve(options.cwd, path);
  let loaded: unknown;
  try {
    loaded = await import(/* @vite-ignore */ pathToFileURL(file).href);
  } catch (cause) {
    const reason = cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
    throw new LabelerConfigError(`cannot load the labeler module ${path}: ${reason}`);
  }
  let exported: unknown = isRecord(loaded) ? loaded.default : undefined;
  if (typeof exported === 'function') exported = await (exported as (o: UserOptions) => unknown)(options);
  if (!isRecord(exported)) {
    throw new LabelerConfigError(`the labeler module ${path} has no default export: an object or a function`);
  }
  const { id, cls, label } = exported;
  if (typeof id !== 'string' || !MODULE_ID.test(id)) {
    throw new LabelerConfigError(
      `the labeler module ${path} must export an id of letters, digits and . _ : -`,
    );
  }
  if (cls !== 'system1' && cls !== 'system2') {
    throw new LabelerConfigError(`the labeler module ${path} must export cls: system1 or system2`);
  }
  if (typeof label !== 'function') {
    throw new LabelerConfigError(`the labeler module ${path} must export a label function`);
  }
  const call = label as LabelerModule['label'];
  return labelerOf(
    {
      id: `module:${id}`,
      cls,
      family: typeof exported.family === 'string' ? exported.family : 'module',
      model: typeof exported.model === 'string' ? exported.model : id,
      ...(options.replayOnly ? {} : { send: async (body) => call.call(exported, body) }),
    },
    options,
  );
}
