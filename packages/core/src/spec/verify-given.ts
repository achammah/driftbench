import { deepEqual } from '../runner/assertion';
import type { Message, WorldState } from '../schema/common';
import type { NotRun } from '../schema/run';
import type { Spec } from '../schema/spec';
import { isPlainObject } from './normalize';
import { parentOrder } from './parents';

/**
 * The static Given verifier. A Given is a recipe; these checks are its predicate. Each runs only on the
 * layers the spec writes. A finding with `level: 'not_run'` is a Given error: `spec lint` warns on it and the
 * runner does not send the block, which is then `not_run` with kind `given_unmet`. `level: 'warning'` is
 * advice only: `spec lint` warns, the block runs.
 *
 * - `tool_history_paired`: every tool call of a prefix carries an output or an error, and no id repeats in
 *   one message (the same id in two assistant turns is accepted: the wires accept it, as H9 measured). On a
 *   prefix whose `origin` is `canonical`, a call with no result is a warning only.
 * - `tool_known`: with a known tool set (`metadata.tool_schemas`, or the caller's), every tool a prefix calls
 *   or the world forces is one of them.
 * - `history_matches_world`: a recorded call of a tool the block's world forces records that forced result or
 *   error.
 * - `value_in_message`: a fact `shared` says the user or the agent stated is in the ledger, and its value is
 *   in the message named, of the history the block starts from (its own prefix, else the latest earlier
 *   one), sent by the speaker named (`user` a user message, `agent` an assistant one), matched on whole
 *   tokens (case, spacing and punctuation aside).
 * - `chain` (warning): a block's `ledger_add` agrees with the ledger it starts from.
 * - `summary_present` (warning): a workspace folder (`from`) and a named session state carry a summary.
 */
export type GivenFinding = NotRun & {
  level: 'not_run' | 'warning';
  /** The spec block the finding is on; undefined for the spec's own `given`. */
  block?: number;
  /** Where in the spec, as a dotted path. */
  path: string;
};

export type VerifyGivenOptions = {
  /** The tools the target has. Default: the keys of `metadata.tool_schemas`; without either, no `tool_known`. */
  tools?: ReadonlySet<string>;
};

export function verifyGiven(spec: Spec, options: VerifyGivenOptions = {}): GivenFinding[] {
  const findings: GivenFinding[] = [];
  const tools = options.tools ?? declaredTools(spec);
  const unmet = (
    block: number | undefined,
    path: string,
    layer: string,
    check: string,
    expected: string,
    got: string,
  ) => {
    findings.push({
      level: 'not_run',
      kind: 'given_unmet',
      layer,
      check,
      expected,
      got,
      path,
      ...(block === undefined ? {} : { block }),
    });
  };
  const advise = (
    block: number | undefined,
    path: string,
    layer: string,
    check: string,
    expected: string,
    got: string,
  ) => {
    findings.push({
      level: 'warning',
      kind: 'given_unmet',
      layer,
      check,
      expected,
      got,
      path,
      ...(block === undefined ? {} : { block }),
    });
  };

  if (tools) toolsForced(spec.given?.world, 'given.world.tools', undefined, tools, unmet);
  summaries(spec.given?.world, spec.given?.vars, spec.given?.summary, 'given', undefined, advise);

  // The situation a block starts from: the ledger and the forced tools in effect, the summary and the history,
  // merged forward in place as the runner merges them (the later value wins), so a long spec is checked in time
  // linear in its blocks. In a flat spec one situation runs through the blocks in order. When blocks link by
  // `parent`, each root starts at the spec defaults and a child starts from its parent's. The ledger and the
  // forced tools are shared by every holder and copied only by one that writes while another still holds them
  // (`refs`), so a chain costs nothing and a fan of readers costs nothing.
  type Held = { ledger: Record<string, unknown>; forced: NonNullable<WorldState['tools']>; refs: number };
  type Situation = { held: Held; summary: string | undefined; history: readonly Message[] };
  const fresh = (): Situation => ({
    held: { ledger: { ...spec.given?.ledger }, forced: { ...spec.given?.world?.tools }, refs: 1 },
    summary: spec.given?.summary,
    history: [],
  });
  /** The ledger and the forced tools of a situation that is about to write: its own copy when others hold them. */
  const writable = (now: Situation): Held => {
    if (now.held.refs > 1) {
      now.held.refs -= 1;
      now.held = { ledger: { ...now.held.ledger }, forced: { ...now.held.forced }, refs: 1 };
    }
    return now.held;
  };
  const visit = (block: Spec['blocks'][number], index: number, now: Situation): void => {
    const at = `blocks.${index}.given`;
    if (block.given?.ledger !== undefined) Object.assign(writable(now).ledger, block.given.ledger);
    if (block.given?.world?.tools !== undefined) Object.assign(writable(now).forced, block.given.world.tools);
    now.summary = block.given?.summary ?? now.summary;
    const prefix = block.given?.prefix ?? [];
    // The history the block starts from: the latest prefix a block up to this one writes, as a run merges
    // them (a block with no prefix of its own keeps the one before; an empty prefix clears it).
    if (block.given?.prefix !== undefined) now.history = block.given.prefix;
    // A canonical prefix may leave a past call without a result: that is a warning, as H9 registered.
    pairing(prefix, `${at}.prefix`, index, unmet, block.given?.origin === 'canonical' ? advise : unmet);
    if (tools) {
      prefix.forEach((message, m) => {
        (message.tool_calls ?? []).forEach((call, c) => {
          if (!tools.has(call.label)) {
            unmet(
              index,
              `${at}.prefix.${m}.tool_calls.${c}.label`,
              '2 tool history',
              'tool_known',
              `${call.label} is a tool of the target`,
              `the target has no tool ${call.label}`,
            );
          }
        });
      });
      toolsForced(block.given?.world, `${at}.world.tools`, index, tools, unmet);
    }
    matchesWorld(prefix, { tools: now.held.forced }, `${at}.prefix`, index, unmet);
    (block.given?.shared ?? []).forEach((entry, s) => {
      if (entry.by === 'record') return;
      const where = `${at}.shared.${s}`;
      const value = now.held.ledger[entry.fact];
      const expected = `ledger.${entry.fact} appears in prefix message ${entry.in ?? '(none named)'}`;
      const message = entry.in === undefined ? undefined : now.history[entry.in];
      const role = entry.by === 'user' ? 'user' : 'assistant';
      if (!Object.hasOwn(now.held.ledger, entry.fact)) {
        unmet(index, where, '4 beliefs', 'value_in_message', expected, 'the ledger holds no such fact');
      } else if (message === undefined) {
        unmet(index, where, '4 beliefs', 'value_in_message', expected, 'the prefix has no such message');
      } else if (message.role !== role) {
        unmet(
          index,
          where,
          '4 beliefs',
          'value_in_message',
          `prefix message ${entry.in}, which states the fact, is from the ${entry.by === 'user' ? 'user' : 'agent'}`,
          `it is ${message.role === 'assistant' ? 'an assistant' : `a ${message.role}`} message`,
        );
      } else if (!valueInText(value, message.content)) {
        unmet(
          index,
          where,
          '4 beliefs',
          'value_in_message',
          `${JSON.stringify(value)} appears in prefix message ${entry.in}`,
          `the message says: ${short(message.content)}`,
        );
      }
    });
    if (block.given) summaries(block.given.world, block.given.vars, now.summary, at, index, advise);
    for (const [fact, value] of Object.entries(block.expect?.ledger_add ?? {})) {
      if (Object.hasOwn(now.held.ledger, fact) && !deepEqual(now.held.ledger[fact], value)) {
        advise(
          index,
          `blocks.${index}.expect.ledger_add`,
          '4 beliefs',
          'chain',
          'ledger_add agrees with the ledger',
          `${fact}: the ledger holds ${JSON.stringify(now.held.ledger[fact])}, the block adds ${JSON.stringify(value)}`,
        );
      }
      writable(now).ledger[fact] = value;
    }
  };

  if (!spec.blocks.some((block) => block.parent !== undefined)) {
    const now = fresh();
    spec.blocks.forEach((block, index) => {
      visit(block, index, now);
    });
  } else {
    const parentOf = parentIndices(spec);
    const children = new Map<number, number>();
    for (const parent of parentOf.values()) children.set(parent, (children.get(parent) ?? 0) + 1);
    const after = new Map<number, Situation>();
    for (const index of parentOrder(spec).order) {
      const parent = parentOf.get(index);
      const held = parent === undefined ? undefined : after.get(parent);
      let now: Situation;
      if (parent === undefined || held === undefined) {
        now = fresh();
      } else {
        const left = (children.get(parent) ?? 1) - 1;
        children.set(parent, left);
        if (left === 0) {
          after.delete(parent);
          now = held;
        } else {
          held.held.refs += 1;
          now = { ...held };
        }
      }
      visit(spec.blocks[index] as Spec['blocks'][number], index, now);
      if ((children.get(index) ?? 0) > 0) after.set(index, now);
      else now.held.refs -= 1;
    }
  }
  return findings;
}

/**
 * True when the value's letters and digits are a run of whole tokens of the text: `+1 202 555 0131` holds
 * `+12025550131`, but `went` does not hold `EN`. Case, spacing and punctuation are ignored.
 */
export function valueInText(value: unknown, text: string): boolean {
  const wanted = tokens(typeof value === 'string' ? value : JSON.stringify(value)).join('');
  if (wanted === '') return false;
  const words = tokens(text);
  for (let start = 0; start < words.length; start++) {
    let joined = '';
    for (let end = start; end < words.length; end++) {
      joined += words[end];
      if (joined === wanted) return true;
      if (!wanted.startsWith(joined)) break;
    }
  }
  return false;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '');
}

type Report = (
  block: number | undefined,
  path: string,
  layer: string,
  check: string,
  expected: string,
  got: string,
) => void;

function declaredTools(spec: Spec): ReadonlySet<string> | undefined {
  const schemas = spec.metadata?.tool_schemas;
  return isPlainObject(schemas) ? new Set(Object.keys(schemas)) : undefined;
}

function pairing(
  prefix: readonly Message[],
  at: string,
  block: number,
  unmet: Report,
  unpaired: Report,
): void {
  prefix.forEach((message, m) => {
    const ids = new Set<string>();
    (message.tool_calls ?? []).forEach((call, c) => {
      const where = `${at}.${m}.tool_calls.${c}`;
      if (call.output === undefined && call.error === undefined) {
        unpaired(
          block,
          where,
          '2 tool history',
          'tool_history_paired',
          `${call.label} carries an output or an error`,
          'a call with no result',
        );
      }
      if (call.id === undefined) return;
      if (ids.has(call.id)) {
        unmet(
          block,
          `${where}.id`,
          '2 tool history',
          'tool_history_paired',
          'tool call ids unique within one message',
          `id ${call.id} repeats in prefix message ${m}`,
        );
      }
      ids.add(call.id);
    });
  });
}

function toolsForced(
  world: WorldState | undefined,
  at: string,
  block: number | undefined,
  tools: ReadonlySet<string>,
  unmet: Report,
): void {
  for (const label of Object.keys(world?.tools ?? {})) {
    if (!tools.has(label)) {
      unmet(
        block,
        `${at}.${label}`,
        '5 world',
        'tool_known',
        `${label} is a tool of the target`,
        `the target has no tool ${label}`,
      );
    }
  }
}

function matchesWorld(
  prefix: readonly Message[],
  world: WorldState,
  at: string,
  block: number,
  unmet: Report,
): void {
  prefix.forEach((message, m) => {
    (message.tool_calls ?? []).forEach((call, c) => {
      const forced = world.tools?.[call.label];
      if (!forced || (forced.result === undefined && forced.error === undefined)) return;
      if (call.output === undefined && call.error === undefined) return; // tool_history_paired owns it
      const agrees =
        forced.error !== undefined
          ? call.error === forced.error
          : call.error === undefined && deepEqual(call.output, forced.result);
      if (!agrees) {
        const recorded = call.error !== undefined ? { error: call.error } : { output: call.output };
        const given = forced.error !== undefined ? { error: forced.error } : { output: forced.result };
        unmet(
          block,
          `${at}.${m}.tool_calls.${c}`,
          '2 tool history / 5 world',
          'history_matches_world',
          `${call.label} records ${short(JSON.stringify(given))}, what the block's world forces`,
          `it records ${short(JSON.stringify(recorded))}`,
        );
      }
    });
  });
}

function summaries(
  world: WorldState | undefined,
  vars: Record<string, unknown> | undefined,
  summary: string | undefined,
  at: string,
  block: number | undefined,
  advise: Report,
): void {
  const workspace = world?.workspace;
  if (workspace?.from !== undefined && workspace.summary === undefined) {
    advise(
      block,
      `${at}.world.workspace`,
      '5 world',
      'summary_present',
      `the folder ${workspace.from} has a summary`,
      'no summary: a reader of the spec cannot see what it holds',
    );
  }
  const state = vars?.session_state;
  if (typeof state === 'string' && state !== 'fresh' && summary === undefined) {
    advise(
      block,
      `${at}.vars.session_state`,
      '5 world',
      'summary_present',
      `the named state ${state} has a summary`,
      'no summary: a reader of the spec cannot see what it holds',
    );
  }
}

function short(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/** The index of each block's parent, for the blocks that name one the spec holds. */
export function parentIndices(spec: Spec): Map<number, number> {
  const ids = new Map(
    spec.blocks.flatMap((block, index) => (block.id === undefined ? [] : [[block.id, index] as const])),
  );
  const parents = new Map<number, number>();
  spec.blocks.forEach((block, index) => {
    const at = block.parent === undefined ? undefined : ids.get(block.parent);
    if (at !== undefined) parents.set(index, at);
  });
  return parents;
}
