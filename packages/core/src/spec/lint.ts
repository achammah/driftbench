import type { Message } from '../schema/common';
import type { Expect, Spec } from '../schema/spec';
import { type Issue, warning } from './issues';
import { parseCriterionRef } from './semantics';
import { verifyGiven } from './verify-given';

/**
 * The Given verifier's findings as lint warnings: `GIVEN_UNMET` for a Given error (the runner does not run
 * the block), `GIVEN_CHAIN` for a `ledger_add` that contradicts the ledger, and, with `summaries`,
 * `GIVEN_SUMMARY_MISSING` for a workspace folder or a named session state with no summary.
 */
export function givenIssues(spec: Spec, options: { summaries?: boolean } = {}): Issue[] {
  return verifyGiven(spec)
    .filter((finding) => finding.check !== 'summary_present' || options.summaries === true)
    .map((finding) =>
      warning(
        finding.check === 'chain'
          ? 'GIVEN_CHAIN'
          : finding.check === 'summary_present'
            ? 'GIVEN_SUMMARY_MISSING'
            : finding.level === 'warning'
              ? 'GIVEN_CANONICAL_UNPAIRED'
              : 'GIVEN_UNMET',
        finding.path,
        `${finding.check}: expected ${finding.expected}; got ${finding.got}`,
      ),
    );
}

/** Advice on a valid spec. Every issue returned is a warning. */
export function lintSpec(spec: Spec): Issue[] {
  const issues: Issue[] = [];

  if (!spec.criteria) {
    const names = new Set<string>();
    const collect = (expect: Expect | undefined) => {
      for (const ref of expect?.criteria ?? []) {
        const parsed = parseCriterionRef(ref);
        if (parsed) names.add(parsed.name);
      }
    };
    for (const block of spec.blocks) collect(block.expect);
    for (const perturbation of spec.perturbations ?? []) collect(perturbation.expect);
    if (names.size > 0) {
      issues.push(
        warning(
          'CRITERION_UNRESOLVED',
          'criteria',
          `criteria referenced without local definitions (${[...names].join(', ')}); they must come from a shared catalogue`,
        ),
      );
    }
  }

  spec.blocks.forEach((block, index) => {
    if (!hasExpectation(block.expect)) {
      issues.push(warning('BLOCK_NO_EXPECTATION', `blocks.${index}`, 'this block checks nothing'));
    }
  });

  if (usesTools(spec)) {
    spec.blocks.forEach((_block, index) => {
      for (const found of proseHistory(spec, index)) {
        issues.push(
          warning(
            'PREFIX_PROSE_HISTORY',
            `blocks.${index}.given.prefix.${found.message}`,
            `the assistant states ${found.facts.map(([fact, value]) => `${fact} (${value})`).join(', ')} in prose, which no recorded tool call of the prefix holds and the user never said: the agent may re-call the tool. Record the call with its output in tool_calls`,
          ),
        );
      }
    });
  }

  if (spec.kind === 'task') {
    const checksOutcome = spec.blocks.some(
      (block) => block.expect?.artifacts || block.expect?.workspace || block.expect?.execution,
    );
    if (!checksOutcome && spec.end_state === undefined) {
      issues.push(
        warning(
          'TASK_WITHOUT_OUTCOME',
          'blocks',
          'a task spec should check what the agent produced: artifacts, workspace, execution or end_state',
        ),
      );
    }
  }

  spec.perturbations?.forEach((perturbation, index) => {
    if (!perturbation.recovery) {
      issues.push(
        warning(
          'PERTURBATION_NO_RECOVERY',
          `perturbations.${index}`,
          'without a recovery expectation this deviation is run but its recovery is not measured',
        ),
      );
    }
  });

  issues.push(...givenIssues(spec));
  return issues;
}

function hasExpectation(expect: Expect | undefined): boolean {
  if (!expect) return false;
  return Object.values(expect).some(
    (value) => value !== undefined && !(Array.isArray(value) && value.length === 0),
  );
}

/** True when the spec names a tool anywhere: an expected tool, a forced tool or a call in a prefix. */
function usesTools(spec: Spec): boolean {
  const forced = (world: { tools?: Record<string, unknown> } | undefined) =>
    Object.keys(world?.tools ?? {}).length > 0;
  if (forced(spec.given?.world)) return true;
  if (spec.perturbations?.some((entry) => (entry.expect?.tools?.length ?? 0) > 0 || forced(entry.world)))
    return true;
  return spec.blocks.some(
    (block) =>
      (block.expect?.tools?.length ?? 0) > 0 ||
      forced(block.given?.world) ||
      (block.given?.prefix ?? []).some((message) => (message.tool_calls?.length ?? 0) > 0),
  );
}

/**
 * The assistant messages of block `index`'s prefix that state a ledger fact in prose only: the fact's value
 * is in the message text, in no user message before it and in no tool call of the prefix up to it. Such a
 * history is a different test from a recorded call: an agent told a fact by its own earlier prose, where a
 * tool would have produced it, tends to call the tool again.
 */
function proseHistory(spec: Spec, index: number): { message: number; facts: [string, string][] }[] {
  const prefix: readonly Message[] | undefined = spec.blocks[index]?.given?.prefix;
  if (!prefix) return [];
  const facts = new Map<string, string>();
  const note = (ledger: Record<string, unknown> | undefined) => {
    for (const [fact, value] of Object.entries(ledger ?? {})) {
      for (const text of scalarTexts(value)) facts.set(`${fact}\u0000${text}`, text);
    }
  };
  note(spec.given?.ledger);
  spec.blocks.slice(0, index + 1).forEach((block, at) => {
    note(block.given?.ledger);
    if (at < index) note(block.expect?.ledger_add);
  });
  if (facts.size === 0) return [];
  const found: { message: number; facts: [string, string][] }[] = [];
  let said = '';
  let recorded = '';
  prefix.forEach((message, at) => {
    for (const call of message.tool_calls ?? []) {
      recorded += `\n${JSON.stringify([call.input ?? null, call.output ?? null, call.error ?? null])}`;
    }
    if (message.role === 'user') said += `\n${message.content}`;
    if (message.role !== 'assistant' || message.content === '') return;
    const stated: [string, string][] = [];
    for (const [key, text] of facts) {
      if (holds(message.content, text) && !holds(said, text) && !holds(recorded, text)) {
        stated.push([key.slice(0, key.indexOf('\u0000')), text]);
      }
    }
    if (stated.length > 0) found.push({ message: at, facts: stated });
  });
  return found;
}

/** The texts of a ledger value worth looking for: its strings of two characters or more and its numbers. */
function scalarTexts(value: unknown): string[] {
  if (typeof value === 'string') return value.trim().length >= 2 ? [value.trim()] : [];
  if (typeof value === 'number') return Number.isFinite(value) ? [String(value)] : [];
  if (Array.isArray(value)) return value.flatMap(scalarTexts);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(scalarTexts);
  return [];
}

/** True when `text` holds `value` as whole words, case aside: `EN` is not found in `OPEN`. */
function holds(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}
