import { copyHistory, freezeHistory, readOnlyHistory } from '../contracts/history';
import type { Assertion, Count, GivenOrigin, Message, TargetRef, WorldState } from '../schema/common';
import type { Observed, ResolvedGiven } from '../schema/run';
import type { Expect, GivenOverride, Spec, Stimulus } from '../schema/spec';
import { contentHashWithList } from '../spec/hash';
import { deepEqual } from './assertion';

/**
 * The Given of a free-running run, carried from block to block. The spec's `given` is the start. A block's
 * `given` merges into it from that block onwards, and so does the world of an injected perturbation. A
 * block's `ledger_add` joins the ledger after the block. For each tool, store key, fixture, variable and
 * fact the later value wins; a later workspace replaces the earlier one. `origin` is the one the latest
 * prefix states: a block that writes a prefix sets it, or clears it when it states none. `originLength` is
 * how many messages that prefix holds: the origin covers those first messages of the history, never the
 * messages a run or a teacher-forced replay adds after them.
 */
export type RunningGiven = {
  ledger: Record<string, unknown>;
  world: WorldState;
  vars: Record<string, unknown>;
  origin?: GivenOrigin;
  originLength?: number;
};

export function initialGiven(spec: Spec): RunningGiven {
  return {
    ledger: { ...spec.given?.ledger },
    world: mergeWorld({}, spec.given?.world),
    vars: { ...spec.given?.vars },
  };
}

/** The running Given once a block's own `given` (or an injected perturbation's world) is applied. */
export function enterBlock(
  state: RunningGiven,
  given: GivenOverride | undefined,
  world?: WorldState,
): RunningGiven {
  const written = given?.prefix !== undefined;
  const origin = written ? given.origin : state.origin;
  const originLength = written ? given.prefix?.length : state.originLength;
  return {
    ledger: { ...state.ledger, ...given?.ledger },
    world: mergeWorld(mergeWorld(state.world, given?.world), world),
    vars: { ...state.vars, ...given?.vars },
    ...(origin === undefined ? {} : { origin, originLength: originLength ?? 0 }),
  };
}

/**
 * The resolved Given of one block: what it starts from, and the content hash of all of it. The prefix is a
 * new list of the same message objects: the run owns them and never changes one after it joined the
 * history, so the cost of a block does not grow with the messages before it. The origin of the prefix joins
 * the hash only when the spec states one, so a Given without it hashes as it always did. `originLength`
 * follows from the spec the hash already covers, so it stays out of the Given hash. The block cache key reads
 * the whole resolved Given, so it does change that key: what an adapter receives decides a cache entry.
 */
export function resolveGiven(
  state: RunningGiven,
  prefix: readonly Message[],
  target: TargetRef,
): ResolvedGiven {
  const body = {
    // Read-only and shared with the run: an adapter copies it with copyHistory, which then reads no property.
    prefix: readOnlyHistory(prefix) as Message[],
    ...(state.origin === undefined ? {} : { origin: state.origin }),
    ledger: structuredClone(state.ledger),
    world: structuredClone(state.world),
    vars: structuredClone(state.vars),
    target: structuredClone(target),
  };
  return {
    ...body,
    ...(state.origin === undefined ? {} : { originLength: state.originLength ?? 0 }),
    hash: contentHashWithList(body, 'prefix'),
  };
}

/** Merges a later world into an earlier one: tools, store keys and fixtures by name, the workspace whole. */
export function mergeWorld(base: WorldState, next: WorldState | undefined): WorldState {
  if (!next) return base;
  const tools = { ...base.tools, ...next.tools };
  const store = { ...base.store, ...next.store };
  const fixtures = { ...base.fixtures, ...next.fixtures };
  const workspace = next.workspace ?? base.workspace;
  return {
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
    ...(Object.keys(store).length > 0 ? { store } : {}),
    ...(workspace ? { workspace } : {}),
    ...(Object.keys(fixtures).length > 0 ? { fixtures } : {}),
  };
}

/**
 * Adds a block's facts to the ledger. A contradiction is a fact the block adds with a value that differs
 * from the one the ledger already holds; the evidence names the fact and both values.
 */
export function addFacts(
  ledger: Record<string, unknown>,
  facts: Record<string, unknown> | undefined,
): { ledger: Record<string, unknown>; contradictions: string[] } {
  const contradictions: string[] = [];
  for (const [fact, value] of Object.entries(facts ?? {})) {
    if (Object.hasOwn(ledger, fact) && !deepEqual(ledger[fact], value)) {
      contradictions.push(
        `${fact}: the ledger holds ${JSON.stringify(ledger[fact])}, the block adds ${JSON.stringify(value)}`,
      );
    }
  }
  return { ledger: { ...ledger, ...facts }, contradictions };
}

/**
 * The canonical Given of spec block `blockIndex`, for teacher-forced mode: what the block starts from when
 * every earlier block went as the spec writes it, never from what an agent did.
 *
 * Ledger, world and vars: the spec's `given`, then each block's own `given` up to and including this one,
 * merged as in a free-running run; the ledger also holds the `ledger_add` of every earlier block.
 *
 * Prefix: the latest `given.prefix` a block up to this one writes (empty when none does), then, for each
 * block from there to the one before this, its user message(s) and a canonical assistant message. The spec
 * format holds no reply text, so that message has empty text; it carries the tool calls the block expects
 * (each expected tool as many times as its count asks, at least its `min`, once when no count is given),
 * with the input fields the spec asserts as exact values, and the result or error the spec's world forces
 * for that tool at that block. A tool the world does not force has no recorded result: an agent that
 * replays its past turns reads it again.
 */
export function canonicalGiven(spec: Spec, blockIndex: number): { state: RunningGiven; prefix: Message[] } {
  const frozen = canonicalGivenFrozen(spec, blockIndex);
  return { state: frozen.state, prefix: copyHistory(frozen.prefix) };
}

/** `canonicalGiven` with the prefix as the run keeps it: a private read-only list, so the runner reads it without a copy. */
export function canonicalGivenFrozen(
  spec: Spec,
  blockIndex: number,
): { state: RunningGiven; prefix: readonly Message[] } {
  // A run asks for block 0, 1, 2 in turn. The situation before block k's own given, kept from the last ask,
  // lets the next ask build one block more, not the whole prefix again; its messages are the same objects,
  // which the prefix cache and the hashes read once.
  const kept = canonicalKept.get(spec);
  const resume = kept && kept.blocks === spec.blocks && kept.next <= blockIndex ? kept : undefined;
  let state = resume ? resume.state : initialGiven(spec);
  // Retain immutable private arrays; callers receive a separate mutable array below.
  let prefix: readonly Message[] = resume ? resume.prefix : [];
  for (let index = resume ? resume.next : 0; index <= blockIndex; index++) {
    const block = spec.blocks[index];
    if (!block) break;
    if (index === blockIndex) {
      canonicalKept.set(spec, { blocks: spec.blocks, next: index, state, prefix });
    }
    state = enterBlock(state, block.given);
    if (block.given?.prefix) prefix = freezeHistory(block.given.prefix);
    if (index === blockIndex) break;
    prefix = freezeHistory(prefix, [
      ...stimulusMessages(block.when),
      canonicalReply(block.expect, state.world),
    ]);
    state = { ...state, ledger: { ...state.ledger, ...block.expect?.ledger_add } };
  }
  return { state, prefix };
}

const canonicalKept = new WeakMap<
  Spec,
  { blocks: Spec['blocks']; next: number; state: RunningGiven; prefix: readonly Message[] }
>();

/** The assistant message a teacher-forced prefix keeps for one earlier block: no text, the expected calls. */
export function canonicalReply(expect: Expect | undefined, world: WorldState): Message {
  const calls: RecordedCall[] = [];
  for (const tool of expect?.tools ?? []) {
    const times = canonicalCount(tool.count);
    const input: { [field: string]: Json } = {};
    for (const [field, assertion] of Object.entries(tool.input ?? {})) {
      const exact = exactValue(assertion);
      if (exact.known) input[field] = exact.value;
    }
    const forced = world.tools?.[tool.label];
    for (let n = 0; n < times; n++) {
      const call: RecordedCall = { label: tool.label, input: structuredClone(input) as Json };
      if (forced?.error !== undefined) call.error = forced.error;
      else if (forced?.result !== undefined) call.output = structuredClone(forced.result);
      calls.push(call);
    }
  }
  return calls.length > 0
    ? { role: 'assistant', content: '', tool_calls: calls }
    : { role: 'assistant', content: '' };
}

/** How many calls a canonical reply records for an expected count: the count, its min, or 1 without one. */
function canonicalCount(count: Count | undefined): number {
  if (count === undefined) return 1;
  if (typeof count === 'number') return count;
  return count.min ?? 0;
}

/** The value an assertion pins exactly: a bare scalar, or `{ exact }`. Patterns and ranges pin none. */
function exactValue(assertion: Assertion): { known: true; value: Json } | { known: false } {
  if (assertion === null || typeof assertion !== 'object') return { known: true, value: assertion };
  if ('exact' in assertion) return { known: true, value: assertion.exact as Json };
  return { known: false };
}

/** The user messages a stimulus sends: one message, the messages of a burst, or the injected message. */
export function stimulusMessages(stimulus: Stimulus): Message[] {
  if ('user' in stimulus) return [{ role: 'user', content: stimulus.user }];
  if ('burst' in stimulus) return stimulus.burst.map((content): Message => ({ role: 'user', content }));
  return [{ role: 'user', content: stimulus.injection.user }];
}

type RecordedCall = NonNullable<Message['tool_calls']>[number];
type Json = RecordedCall['input'];

/** The assistant message the history keeps for a block: the reply, and each tool call with its result or error. */
export function assistantMessage(observed: Observed): Message {
  const calls = observed.toolCalls.map((call) => {
    const recorded: RecordedCall = { label: call.label };
    if (call.id !== undefined) recorded.id = call.id;
    if (call.input !== undefined) recorded.input = call.input as Json;
    if (call.error !== undefined) recorded.error = call.error;
    // An absent output stays absent: history holds plain JSON data, never an undefined value.
    else if (call.output !== undefined) recorded.output = call.output as Json;
    return recorded;
  });
  return calls.length > 0
    ? { role: 'assistant', content: observed.text, tool_calls: calls }
    : { role: 'assistant', content: observed.text };
}
