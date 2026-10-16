import { deepEqual } from '@agent-nexus/driftbench-core';
import { isRecord, show } from '../support/values';
import type { Rung } from './ladder';

/**
 * Rung 1, the outcome: ask the tool. The tool that receives a value decides what the value means, so the rung
 * replays the agent's own call twice on the same world, once as the agent wrote it and once with the gold
 * value in its place, and compares what the tool resolves (the output fields its declaration names: an id,
 * found or not, the canonical form it echoes back). The same result passes, however different the strings
 * look; a different result fails, however close they look. value_equivalence.md section 3, rung 1; HF6.
 *
 * The replay always runs the real tool, never a forced result: a forced result answers the same for any value.
 */

/** What a replayable tool declares once: the output fields that are its resolved result. */
export type ToolDeclaration = {
  /** Dotted output paths: `address_id`, `customer.id`. */
  resolved: readonly string[];
  /**
   * True when the replay world holds neighbours of the gold referent (another address, another customer), so a
   * same result is not a coincidence. A policy with `distractors_required` passes nothing on a world without.
   */
  distractors?: boolean;
  /**
   * The input fields whose effect the resolved result shows, by dotted path; absent means every input (a read
   * tool). A tool that also keeps values as given (a name or an email on an order) lists only the fields it
   * resolves, such as `plan_id`: the outcome cannot decide the others, so the other rungs do.
   */
  inputs?: readonly string[];
};

/** True when the replayed result can decide the field: the tool is declared and the field is one it resolves. */
export function resolvesField(declaration: ToolDeclaration | undefined, field: string): boolean {
  if (declaration === undefined) return false;
  if (declaration.inputs === undefined) return true;
  return declaration.inputs.some((input) => field === input || field.startsWith(`${input}.`));
}

/** What one replayed call returned. */
export type ReplayOutcome = { ok: true; output: unknown } | { ok: false; error: string };

/** Runs a tool in the sandbox. A tool it has no declaration for is not replayable. */
export type ToolReplayer = {
  declaration(tool: string): ToolDeclaration | undefined;
  call(
    tool: string,
    input: Record<string, unknown>,
    world: Readonly<Record<string, unknown>> | undefined,
  ): Promise<ReplayOutcome> | ReplayOutcome;
};

export const outcome: Rung = async (value, ctx) => {
  const replayer = ctx.services.replayer;
  const declaration = value.tool === undefined ? undefined : replayer?.declaration(value.tool);
  if (replayer === undefined || value.tool === undefined || declaration === undefined) {
    return { skip: 'no replayer declares this tool' };
  }
  if (!resolvesField(declaration, value.field))
    return { skip: `${value.tool} does not resolve ${value.field}: its result does not show it` };
  if (value.input === undefined) return { skip: 'no call input to replay' };
  const tool = value.tool;
  const mine = await replayer.call(tool, structuredClone({ ...value.input }), value.world);
  const gold = await replayer.call(tool, withPath(value.input, value.field, value.gold), value.world);
  if (!gold.ok) return { skip: `${tool} refuses the gold call itself: ${gold.error}` };
  if (!mine.ok) {
    return {
      settles: 'fail',
      evidence: `${tool} refuses ${show(value.value)}: ${mine.error}; the gold ${show(value.gold)} is accepted`,
      emits: { outcome: 'failed' },
    };
  }
  const agent = resolvedOf(mine.output, declaration.resolved);
  const reference = resolvedOf(gold.output, declaration.resolved);
  // Only a field both replays returned can be compared: a missing field resolved nothing, so it proves nothing.
  const both = declaration.resolved.filter((path) => path in agent && path in reference);
  const differing = both.filter((path) => !deepEqual(agent[path], reference[path]));
  if (differing.length > 0) {
    const failed = Object.values(agent).every((entry) => entry === null || entry === false);
    return {
      settles: 'fail',
      evidence: `${tool} resolves ${show(value.value)} to ${show(agent)}, and the gold ${show(value.gold)} to ${show(reference)}`,
      emits: { outcome: failed ? 'failed' : 'resolved_differently' },
    };
  }
  const missing = declaration.resolved.filter((path) => !both.includes(path));
  if (missing.length > 0) {
    return {
      skip: `${tool} returned no ${missing.join(', ')} for ${sides(agent, reference, missing)}, so the replay proves nothing`,
    };
  }
  if (ctx.params.distractors_required === true && declaration.distractors !== true) {
    return {
      skip: `${tool} resolves both values the same, but its world declares no distractor to tell the gold referent apart`,
    };
  }
  return {
    settles: 'pass',
    evidence: `${tool} resolves ${show(value.value)} as it resolves the gold ${show(value.gold)}: ${show(agent)}`,
    emits: { outcome: 'accepted_as_gold' },
  };
};

/** Which replay lacks the missing fields: the agent value's, the gold value's, or both. */
function sides(
  agent: Record<string, unknown>,
  reference: Record<string, unknown>,
  missing: readonly string[],
) {
  const mine = missing.some((entry) => !(entry in agent));
  const gold = missing.some((entry) => !(entry in reference));
  return mine && gold ? 'either value' : mine ? 'the agent value' : 'the gold value';
}

/**
 * The declared output fields a result returned, by dotted path. A field the result does not hold is left out; a
 * field under a parent that resolved to null (no customer for that email) is a result, null.
 */
function resolvedOf(output: unknown, paths: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const dotted of paths) {
    let at: unknown = output;
    let present = true;
    for (const key of dotted.split('.')) {
      if (at === null) break;
      if (!isRecord(at) || !(key in at) || at[key] === undefined) {
        present = false;
        break;
      }
      at = at[key];
    }
    if (present) out[dotted] = at;
  }
  return out;
}

/** The value at a dotted path, or undefined. */
export function valueAt(root: unknown, path: string): unknown {
  let at = root;
  for (const key of path.split('.')) {
    if (!isRecord(at)) return undefined;
    at = at[key];
  }
  return at;
}

/** A copy of an input with the value at a dotted path replaced; missing objects on the way are created. */
export function withPath(input: Readonly<Record<string, unknown>>, path: string, replacement: unknown) {
  const copy = structuredClone({ ...input }) as Record<string, unknown>;
  const keys = path.split('.');
  let at = copy;
  for (const key of keys.slice(0, -1)) {
    const next = at[key];
    if (!isRecord(next)) at[key] = {};
    at = at[key] as Record<string, unknown>;
  }
  at[keys[keys.length - 1] as string] = replacement;
  return copy;
}
