import { readFile } from 'node:fs/promises';
import type {
  BlockResult,
  DriverContext,
  DriverStep,
  Stimulus,
  UserDriver,
} from '@agent-nexus/driftbench-core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * The simulated user: a person with a persona and a goal, played by a model through the model port. It
 * answers the agent block by block, reveals a fact only once the agent has asked for it, says the stop
 * token when the goal is met or abandoned, and never sees the agent's tool calls: it reads the agent's
 * visible text only.
 *
 * Reveal-when-asked is enforced in code, not left to the model: a fact reaches the model's request only
 * after an agent reply matches one of the fact's ask patterns; the spec's own words for the block, given as
 * the user's intent, have every fact not yet asked replaced; and an answer that holds a fact not yet asked
 * fails the run.
 *
 * The model must belong to another family than the agent's and every judge's: a model playing the user
 * of its own family, or grading a conversation it took part in, is the bias the design forbids. The check
 * runs when the user is created, so a run with a wrong port never starts.
 */

/** The model port, as @agent-nexus/driftbench-generate defines it: one system prompt and one user message in, text out. */
export type UserModelPort = {
  readonly family: string;
  readonly model?: string;
  complete(request: { system: string; user: string; maxTokens?: number }): Promise<string>;
};

export const Persona = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .describe('An id: lower case letters, digits and hyphens.'),
    name: z.string().min(1).describe('The name the person goes by. Fictional.'),
    persona: z.string().min(1).describe('Who the person is and how they write.'),
    goal: z.string().min(1).describe('What the person wants from the conversation.'),
    facts: z
      .record(z.string(), z.string().min(1))
      .describe('What the person knows and gives only when asked, by name.'),
    reveal_when_asked: z
      .record(z.string(), z.array(z.string().min(1)).min(1))
      .describe('For each fact, the patterns of an agent reply that asks for it.'),
    stop_token: z.string().min(1).describe('What the person says, alone, when the goal is met or abandoned.'),
    spec: z.string().min(1).optional().describe('The spec this persona plays, relative to the persona file.'),
  })
  .describe('A persona for the simulated user. Fictional.');
export type Persona = z.infer<typeof Persona>;

export class SimulatedUserError extends Error {
  override name = 'SimulatedUserError';
}

export type SimulatedUserOptions = {
  /** Who the person is and how they write: a persona file's text, or the whole persona. */
  readonly persona: string | Persona;
  readonly goal: string;
  /** What the person knows, by name. Given only when asked for. */
  readonly facts: Readonly<Record<string, string>>;
  /** For each fact, the patterns (case-insensitive) of an agent reply that asks for it. Every fact needs one. */
  readonly revealWhenAsked: Readonly<Record<string, readonly string[]>>;
  readonly stopToken: string;
  readonly port: UserModelPort;
  /** The model family of the agent under test; `none` for an agent that is not a model. */
  readonly agentFamily: string;
  /** The model families of the judges that will grade the run. Empty when no judge grades it. */
  readonly judgeFamilies: readonly string[];
  /**
   * `hint` (default): the spec's words for the block are given to the model as what the person means to
   * say, so the run stays on the spec's blocks and their expectations apply. `none`: the model writes from
   * the persona, the goal and the conversation alone.
   */
  readonly script?: 'hint' | 'none';
  readonly maxTokens?: number;
};

export type SimulatedUser = UserDriver & {
  /** The facts given to the model so far in the current run: the ones the agent has asked for. */
  revealed(): string[];
};

/** Families compare without case and surrounding space, as the judges package compares them. */
function family(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Creates the simulated user. Throws a SimulatedUserError when the port's family is empty, `unknown`, the
 * agent's or a judge's; when a fact has no ask pattern or a pattern does not compile; when an ask pattern
 * names no fact; when the persona or the goal already holds a fact's value; or when the stop token is empty.
 */
export function createSimulatedUser(options: SimulatedUserOptions): SimulatedUser {
  const persona = typeof options.persona === 'string' ? options.persona : describePersona(options.persona);
  checkFamilies(options);
  const asks = compileAsks(options);
  for (const [fact, value] of Object.entries(options.facts)) {
    for (const [where, text] of [
      ['persona', persona],
      ['goal', options.goal],
    ] as const) {
      if (holds(text, value)) {
        throw new SimulatedUserError(
          `the ${where} holds the value of the fact ${fact}, so the user would know to give it unasked: keep it in facts alone`,
        );
      }
    }
  }
  if (!options.stopToken.trim()) throw new SimulatedUserError('the stop token is empty');

  const system = systemPrompt(persona, options.goal, options.stopToken);
  /**
   * What the person wrote, kept under two keys: the spec block's id and the position of the block in the whole
   * run (`BlockResult.index`), never its place in its branch, so a branch never reads another's message. A block
   * a perturbation injects carries the perturbation's id, so it is found by its position.
   */
  const said = new Map<string, string>();
  const keysOf = (id: string | undefined, position: number) => [
    ...(id === undefined ? [] : [`id:${id}`]),
    `#${position}`,
  ];
  const sayingOf = (result: BlockResult): string | undefined => {
    for (const key of keysOf(result.blockId, result.index)) {
      const text = said.get(key);
      if (text !== undefined) return text;
    }
    return undefined;
  };
  let revealed: string[] = [];

  return {
    id: `simulated:${options.port.family}`,
    revealed: () => [...revealed],
    async next(ctx: DriverContext): Promise<DriverStep> {
      // The run's first block: a new run forgets the last one. A second tree's root has an empty branch, not an empty history.
      if (ctx.history.length === 0) said.clear();
      if (ctx.blockIndex >= ctx.spec.blocks.length) {
        return { kind: 'stop', reason: `the spec has no block ${ctx.blockIndex}` };
      }
      // Only the blocks this one follows: in a spec with parents, its ancestors, never another tree or a sibling.
      const branch = ctx.branch ?? ctx.history;
      const agentTexts = branch.map((block) => block.observed.text);
      revealed = Object.keys(options.facts).filter((fact) =>
        agentTexts.some((text) => asks.get(fact)?.some((pattern) => pattern.test(text))),
      );
      const hidden = Object.entries(options.facts).filter(([fact]) => !revealed.includes(fact));
      const block = ctx.spec.blocks[ctx.blockIndex];
      const hint = options.script === 'none' || !block ? undefined : redact(wordsOf(block.when), hidden);
      const lines = branch.map((result) => [
        `Customer: ${sayingOf(result) ?? '[a message of yours that is not shown]'}`,
        `Assistant: ${result.observed.text}`,
      ]);
      const user = [
        `Turn ${branch.filter((result) => sayingOf(result) !== undefined).length + 1}.`,
        '',
        'The conversation so far:',
        ...(lines.length > 0 ? lines.flat() : ['(nothing yet: you write first)']),
        '',
        'Facts you may give now, because the assistant asked for them:',
        ...(revealed.length > 0 ? revealed.map((fact) => `- ${fact}: ${options.facts[fact]}`) : ['(none)']),
        ...(hint === undefined ? [] : ['', `What you mean to say now, in your own words: ${hint}`]),
        '',
        'Write your next message.',
      ].join('\n');

      const answer = (
        await options.port.complete({
          system,
          user,
          ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        })
      ).trim();
      if (answer.includes(options.stopToken)) {
        return { kind: 'stop', reason: `the simulated user said the stop token at block ${ctx.blockIndex}` };
      }
      if (answer === '')
        throw new SimulatedUserError(`the model gave an empty message at block ${ctx.blockIndex}`);
      const leaked = hidden.filter(([, value]) => holds(answer, value)).map(([fact]) => fact);
      if (leaked.length > 0) {
        throw new SimulatedUserError(
          `the simulated user gave ${leaked.join(', ')} at block ${ctx.blockIndex} before the agent asked for ${leaked.length === 1 ? 'it' : 'them'}`,
        );
      }
      for (const key of keysOf(block?.id, ctx.history.length)) said.set(key, answer);
      const stimulus: Stimulus = { user: answer };
      return { kind: 'block', blockIndex: ctx.blockIndex, stimulus };
    },
  };
}

/**
 * Refuses a model port of no known family, of the agent's family or of a judge's family: a model that plays
 * the user (or the attacker) must not share a family with the agent it talks to or the judges that grade it.
 */
export function checkUserFamilies(
  options: Pick<SimulatedUserOptions, 'port' | 'agentFamily' | 'judgeFamilies'>,
): void {
  checkFamilies(options);
}

function checkFamilies(options: Pick<SimulatedUserOptions, 'port' | 'agentFamily' | 'judgeFamilies'>): void {
  const own = family(options.port.family);
  if (own === '' || own === 'unknown') {
    throw new SimulatedUserError(
      `the model port names no family ("${options.port.family}"): the simulated user must run on a known family other than the agent's and the judges'`,
    );
  }
  if (!options.agentFamily.trim()) {
    throw new SimulatedUserError('the agent family is not set: use none for an agent that is not a model');
  }
  if (own === family(options.agentFamily)) {
    throw new SimulatedUserError(
      `the simulated user runs on the ${own} family, the family of the agent under test: refused`,
    );
  }
  const judge = options.judgeFamilies.find((each) => family(each) === own);
  if (judge !== undefined) {
    throw new SimulatedUserError(
      `the simulated user runs on the ${own} family, a family of the judges: refused`,
    );
  }
}

function compileAsks(options: SimulatedUserOptions): Map<string, RegExp[]> {
  const asks = new Map<string, RegExp[]>();
  for (const fact of Object.keys(options.facts)) {
    const patterns = options.revealWhenAsked[fact];
    if (!patterns || patterns.length === 0) {
      throw new SimulatedUserError(`the fact ${fact} has no ask pattern, so it could never be given`);
    }
    asks.set(
      fact,
      patterns.map((pattern) => {
        try {
          return new RegExp(pattern, 'i');
        } catch (cause) {
          throw new SimulatedUserError(
            `the ask pattern ${pattern} of ${fact} does not compile: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }),
    );
  }
  for (const fact of Object.keys(options.revealWhenAsked)) {
    if (!Object.hasOwn(options.facts, fact)) {
      throw new SimulatedUserError(`reveal_when_asked names ${fact}, which is not a fact`);
    }
  }
  return asks;
}

function systemPrompt(persona: string, goal: string, stopToken: string): string {
  return [
    'You play a customer in a chat with an assistant. Stay in character for the whole conversation.',
    '',
    `Who you are: ${persona}`,
    `Your goal: ${goal}`,
    '',
    'Rules:',
    '- Write only your next message, as this person would type it: no quotes, no labels, no narration.',
    '- Give a fact only when the assistant has asked for it, and only a fact listed as one you may give now. Never invent one.',
    '- Ask one thing at a time, as a real customer would.',
    `- When your goal is met, or you give up on it, reply with ${stopToken} and nothing else.`,
    '- You see only what the assistant writes to you.',
  ].join('\n');
}

/** A persona file's fields as the text the model reads. */
export function describePersona(persona: Persona): string {
  return `${persona.name}. ${persona.persona.trim()}`;
}

/** The words a stimulus sends, as one line: a message, a burst joined, or an injected message. */
function wordsOf(stimulus: Stimulus): string {
  if ('user' in stimulus) return stimulus.user;
  if ('burst' in stimulus) return stimulus.burst.join(' / ');
  return stimulus.injection.user;
}

/** The text with every hidden fact's value replaced, so a hint never carries a fact not yet asked. */
function redact(text: string, hidden: readonly (readonly [string, string])[]): string {
  let out = text;
  for (const [fact, value] of hidden) {
    out = out.replace(new RegExp(escapeRegExp(value), 'gi'), `[your ${fact}, once asked]`);
    const digits = digitsOf(value);
    if (digits.length >= 7) out = out.replace(digitPattern(digits), `[your ${fact}, once asked]`);
  }
  return out;
}

/** True when the text holds the value: as written, without case, or as the same digits in any spacing (a phone number). */
function holds(text: string, value: string): boolean {
  if (text.toLowerCase().includes(value.toLowerCase())) return true;
  const digits = digitsOf(value);
  return digits.length >= 7 && digitPattern(digits).test(text);
}

/** The digits of a value; for a phone number of ten digits or more, the last ten, so a country code is optional. */
function digitsOf(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** The digits in order, with any spaces, dots, dashes or brackets between them. */
function digitPattern(digits: string): RegExp {
  return new RegExp(digits.split('').join('[\\s().+-]*'), 'g');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Reads and validates a persona file (YAML). */
export async function loadPersona(path: string): Promise<Persona> {
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(path, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    throw new SimulatedUserError(
      `${path}: ${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)}`,
    );
  }
  const parsed = Persona.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SimulatedUserError(
      `${path}: ${issue?.path.map(String).join('.') || '(file)'} ${issue?.message}`,
    );
  }
  return parsed.data;
}

/** The options a persona file gives, ready for createSimulatedUser with a port and the families. */
export function personaOptions(
  persona: Persona,
): Pick<SimulatedUserOptions, 'persona' | 'goal' | 'facts' | 'revealWhenAsked' | 'stopToken'> {
  return {
    persona,
    goal: persona.goal,
    facts: persona.facts,
    revealWhenAsked: persona.reveal_when_asked,
    stopToken: persona.stop_token,
  };
}

export const UserRecording = z
  .strictObject({
    family: z.string().min(1).describe('The family recorded: who wrote the answers.'),
    model: z.string().min(1).describe('The model recorded, or how the answers were written.'),
    persona: z.string().min(1).describe('The persona id the answers belong to.'),
    answers: z.array(z.string().min(1)).min(1).describe('The answers, one per turn, in order.'),
  })
  .describe('Recorded answers of a simulated user, replayed instead of calling a model.');
export type UserRecording = z.infer<typeof UserRecording>;

/** Reads and validates a recording of a simulated user (YAML). */
export async function loadUserRecording(path: string): Promise<UserRecording> {
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(path, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    throw new SimulatedUserError(
      `${path}: ${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)}`,
    );
  }
  const parsed = UserRecording.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SimulatedUserError(
      `${path}: ${issue?.path.map(String).join('.') || '(file)'} ${issue?.message}`,
    );
  }
  return parsed.data;
}

/**
 * A port that replays a recording: turn n gets answer n. The request names its turn (`Turn n.` on its
 * first line: the simulated user's own count of the messages it wrote, so a block another driver injects
 * does not move it); a request for a turn the recording does not hold fails, so a run never answers out of
 * order. The port keeps every request, for tests and for the proof.
 */
export function userRecordingPort(recording: UserRecording): UserModelPort & {
  readonly requests: { system: string; user: string }[];
} {
  const requests: { system: string; user: string }[] = [];
  return {
    family: recording.family,
    model: recording.model,
    requests,
    async complete(request) {
      requests.push({ system: request.system, user: request.user });
      const turn = /^Turn (\d+)\./.exec(request.user)?.[1];
      if (turn === undefined) throw new SimulatedUserError('the request names no turn');
      const answer = recording.answers[Number(turn) - 1];
      if (answer === undefined) {
        throw new SimulatedUserError(
          `the recording of ${recording.persona} holds ${recording.answers.length} answers, none for turn ${turn}`,
        );
      }
      return answer;
    },
  };
}
