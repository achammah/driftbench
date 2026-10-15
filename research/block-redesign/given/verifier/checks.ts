import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addFacts,
  canonicalJson,
  type Message,
  type Spec,
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { isToolOfTarget, type TargetProfile } from './targets';

/**
 * M4.1, research prototype: the Given verifier. A Given is a recipe; these checks are its predicate. Each
 * check runs only when its layer is present (`requires: auto`). A failed check is a `not_run` finding with
 * the layer, the check, what was expected and what was found; it never becomes a fail of the agent.
 */

export type NotRunKind = 'given_unmet' | 'unsupported' | 'setup_failed';
export type Finding = {
  kind: NotRunKind | 'warning';
  layer: string;
  check: string;
  block: number | null;
  expected: string;
  got: string;
};

/** The research Given: today's keys plus the new optional ones the verifier reads. */
export type ResearchGiven = {
  prefix?: Message[];
  origin?: 'authored' | 'recorded' | 'canonical';
  ledger?: Record<string, unknown>;
  shared?: { fact: string; by: 'user' | 'record' | 'agent'; in?: number }[];
  world?: WorldState;
  vars?: Record<string, unknown>;
  summary?: string;
};

/** Lowercase, letters and digits only: the pre-registered match rule of `value_in_message`. */
export function norm(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

type Call = NonNullable<Message['tool_calls']>[number];

function callsOf(prefix: readonly Message[] | undefined): { call: Call; message: number }[] {
  const out: { call: Call; message: number }[] = [];
  (prefix ?? []).forEach((message, index) => {
    for (const call of message.tool_calls ?? []) out.push({ call, message: index });
  });
  return out;
}

/** Layer 2: every recorded call has a result or an error, and ids are unique. */
export function toolHistoryPaired(given: ResearchGiven, block: number | null): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const { call, message } of callsOf(given.prefix)) {
    const where = `prefix[${message}] ${call.label}${call.id ? ` (${call.id})` : ''}`;
    if (call.output === undefined && call.error === undefined) {
      findings.push({
        kind: given.origin === 'canonical' ? 'warning' : 'given_unmet',
        layer: '2 tool history',
        check: 'tool_history_paired',
        block,
        expected: `${where} carries an output or an error`,
        got: 'a call with no result',
      });
    }
    if (call.id !== undefined) {
      if (seen.has(call.id)) {
        findings.push({
          kind: 'given_unmet',
          layer: '2 tool history',
          check: 'tool_history_paired',
          block,
          expected: 'unique tool call ids',
          got: `id ${call.id} repeats at ${where}`,
        });
      }
      seen.add(call.id);
    }
  }
  return findings;
}

/** Layer 2 and 5: every tool the Given or the block names is a tool of the run target. */
export function toolKnown(
  profile: TargetProfile,
  labels: { label: string; where: string }[],
  block: number | null,
): Finding[] {
  const findings: Finding[] = [];
  for (const { label, where } of labels) {
    const known = isToolOfTarget(profile, label);
    if (known === false) {
      findings.push({
        kind: 'given_unmet',
        layer: where.startsWith('world') ? '5 world' : '2 tool history',
        check: 'tool_known',
        block,
        expected: `${label} (${where}) is a tool of ${profile.id}`,
        got: `${profile.id} has no tool ${label}`,
      });
    }
  }
  return findings;
}

/** Layer 2 against 5: each recorded outcome is what the block's world gives for that call. */
export function historyMatchesWorld(
  profile: TargetProfile,
  given: ResearchGiven,
  block: number | null,
): Finding[] {
  if (!profile.runTool) return [];
  const world = given.world ?? {};
  const findings: Finding[] = [];
  for (const { call, message } of callsOf(given.prefix)) {
    if (call.output === undefined && call.error === undefined) continue; // tool_history_paired owns it
    if (isToolOfTarget(profile, call.label) === false) continue; // tool_known owns it
    const replay = profile.runTool(call.label, call.input, world);
    const recorded = call.error !== undefined ? { ok: false, error: call.error } : { ok: true, output: call.output };
    if (canonicalJson(replay) !== canonicalJson(recorded)) {
      findings.push({
        kind: 'given_unmet',
        layer: '2 tool history / 5 world',
        check: 'history_matches_world',
        block,
        expected: `prefix[${message}] ${call.label} gives ${short(recorded)} under the block's world`,
        got: `the world gives ${short(replay)}`,
      });
    }
  }
  return findings;
}

/** Layer 4: a fact said by the user sits in the message the Given names. */
export function valueInMessage(given: ResearchGiven, block: number | null): Finding[] {
  const findings: Finding[] = [];
  for (const entry of given.shared ?? []) {
    if (entry.by !== 'user' && entry.by !== 'agent') continue;
    const value = given.ledger?.[entry.fact];
    const message = entry.in === undefined ? undefined : given.prefix?.[entry.in];
    const expected = `ledger.${entry.fact} = ${JSON.stringify(value)} appears in prefix[${entry.in}]`;
    if (value === undefined) {
      findings.push({ kind: 'given_unmet', layer: '4 beliefs', check: 'value_in_message', block, expected, got: 'the ledger holds no such fact' });
    } else if (message === undefined) {
      findings.push({ kind: 'given_unmet', layer: '4 beliefs', check: 'value_in_message', block, expected, got: 'no such message' });
    } else if (!norm(message.content).includes(norm(value))) {
      findings.push({ kind: 'given_unmet', layer: '4 beliefs', check: 'value_in_message', block, expected, got: `prefix[${entry.in}] says: ${message.content.slice(0, 120)}` });
    }
  }
  return findings;
}

/** Layer 4: no block adds a ledger fact that contradicts one the ledger already holds. */
export function chain(spec: Spec): Finding[] {
  const findings: Finding[] = [];
  let ledger: Record<string, unknown> = { ...(spec as { ledger_seed?: Record<string, unknown> }).ledger_seed, ...spec.given?.ledger };
  spec.blocks.forEach((block, index) => {
    ledger = { ...ledger, ...block.given?.ledger };
    const { ledger: next, contradictions } = addFacts(ledger, block.expect?.ledger_add);
    for (const contradiction of contradictions) {
      findings.push({ kind: 'given_unmet', layer: '4 beliefs', check: 'chain', block: index, expected: 'ledger_add agrees with the ledger', got: contradiction });
    }
    ledger = next;
  });
  return findings;
}

/** All layers: the adapter can apply every layer present. */
export function capability(profile: TargetProfile, given: ResearchGiven, block: number | null): Finding[] {
  const findings: Finding[] = [];
  const need = (present: boolean, ok: boolean, layer: string, what: string) => {
    if (present && !ok) {
      findings.push({ kind: 'unsupported', layer, check: 'capability', block, expected: `${profile.id} applies ${what}`, got: `${profile.source}: it does not` });
    }
  };
  need((given.prefix?.length ?? 0) > 0, profile.caps.seedPrefix, '1 history', 'a prefix (seedPrefix)');
  need(given.world?.tools !== undefined, profile.caps.toolStubs, '5 world', 'forced tool results (toolStubs)');
  need(given.world?.workspace !== undefined, profile.caps.sandbox, '5 world', 'a workspace (sandbox)');
  need(given.world?.store !== undefined, profile.caps.storeReachesAgent, '5 world', 'world.store');
  const state = given.vars?.session_state;
  const event = given.vars?.event;
  const named = (typeof state === 'string' && state !== 'fresh') || (typeof event === 'string' && event !== '' && event !== 'no_hazard');
  need(named, profile.caps.states, '5 world', 'a named session state or event');
  return findings;
}

/** Layer 5: a named state or event exists in the state library. */
export function stateKnown(
  library: { states: Set<string>; events: Set<string> },
  given: ResearchGiven,
  block: number | null,
): Finding[] {
  const findings: Finding[] = [];
  const state = given.vars?.session_state;
  if (typeof state === 'string' && state !== 'fresh' && !library.states.has(state)) {
    findings.push({ kind: 'setup_failed', layer: '5 world', check: 'state_known', block, expected: `session_state ${state} is in the state library`, got: `library states: ${[...library.states].join(', ')}` });
  }
  const event = given.vars?.event;
  if (typeof event === 'string' && event !== '' && event !== 'no_hazard' && !library.events.has(event)) {
    findings.push({ kind: 'setup_failed', layer: '5 world', check: 'state_known', block, expected: `event ${event} is in the state library`, got: `library events: ${[...library.events].join(', ')}` });
  }
  return findings;
}

/** Layer 5, setup: `workspace.from` resolves to a folder (core anchors `./` paths at load; others from the run folder). */
export function workspaceResolves(given: ResearchGiven, block: number | null, runFolder: string): Finding[] {
  const from = given.world?.workspace?.from;
  if (from === undefined) return [];
  const path = resolve(runFolder, from);
  if (existsSync(path) && statSync(path).isDirectory()) return [];
  return [{ kind: 'setup_failed', layer: '5 world', check: 'workspace_resolves', block, expected: `${from} is a folder`, got: `${path} does not exist or is not a folder` }];
}

/** Layer 3 and 5: an outside reference or a named state carries a visible summary (a key that is new). */
export function summaryPresent(given: ResearchGiven, block: number | null): Finding[] {
  const findings: Finding[] = [];
  const workspace = given.world?.workspace as { from?: string; summary?: string } | undefined;
  if (workspace?.from !== undefined && !workspace.summary) {
    findings.push({ kind: 'given_unmet', layer: '5 world', check: 'summary_present', block, expected: `workspace.from ${workspace.from} has a summary`, got: 'no summary (a Mystery Guest)' });
  }
  const state = given.vars?.session_state;
  if (typeof state === 'string' && state !== 'fresh' && !given.summary) {
    findings.push({ kind: 'given_unmet', layer: '5 world', check: 'summary_present', block, expected: `named state ${state} has a summary`, got: 'no summary' });
  }
  return findings;
}

function short(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}
