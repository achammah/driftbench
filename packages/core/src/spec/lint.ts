import type { Assertion, Message, NormaliseMap, NormaliseRule } from '../schema/common';
import type { EndStateSpec, Expect, Spec } from '../schema/spec';
import { type Issue, warning } from './issues';
import { isPlainObject } from './normalize';
import { parseCriterionRef } from './semantics';

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

  const slotFields = (expect: Expect | undefined, base: string) => {
    expect?.tools?.forEach((tool, index) => {
      lintSlots(tool.input, tool.normalise, `${base}.tools.${index}`, issues);
    });
  };
  spec.blocks.forEach((block, index) => {
    slotFields(block.expect, `blocks.${index}.expect`);
  });
  spec.perturbations?.forEach((perturbation, index) => {
    slotFields(perturbation.expect, `perturbations.${index}.expect`);
  });
  const endStates: EndStateSpec[] =
    spec.end_state === undefined || spec.end_state === 'none' ? [] : [spec.end_state].flat();
  endStates.forEach((endState, index) => {
    const base = Array.isArray(spec.end_state) ? `end_state.${index}` : 'end_state';
    lintSlots(endState.expect, endState.normalise, base, issues);
  });

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

type SlotKind = 'phone' | 'email' | 'address';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STREET =
  /^\d+[a-z]?\s+(?:[\p{L}'-]+\s+){0,4}(?:road|rd|lane|ln|avenue|ave|street|st|way|court|ct|drive|dr|boulevard|blvd|place|pl|square|sq|terrace|parkway|highway)\b/iu;

/**
 * The kind of slot an expected text holds, read from its shape: an email address, a phone number
 * (7 to 15 digits, written with + or under a key that names a phone), or a street address.
 */
function slotKind(key: string, text: string): SlotKind | undefined {
  const trimmed = text.trim();
  if (EMAIL.test(trimmed)) return 'email';
  const digits = trimmed.replace(/\D/g, '').length;
  const phoneShaped = /^\+?[\d\s().-]+$/.test(trimmed) && digits >= 7 && digits <= 15;
  if (phoneShaped && (trimmed.startsWith('+') || /phone|mobile|msisdn|tel|number/i.test(key))) {
    return 'phone';
  }
  if (STREET.test(trimmed)) return 'address';
  return undefined;
}

/**
 * The rule a slot text calls for: `email_lower`, `address_canon`, or `phone_e164`, with country code 1
 * when the text is a North American number (+1 and 10 digits), the one calling code whose national
 * numbers have a fixed length.
 */
function ruleOf(kind: SlotKind, text: string): NormaliseRule {
  if (kind === 'email') return 'email_lower';
  if (kind === 'address') return 'address_canon';
  return /^\+1\d{10}$/.test(text.replace(/[\s().-]/g, ''))
    ? { rule: 'phone_e164', country_code: '1' }
    : 'phone_e164';
}

/**
 * The normalise rules the phones, emails and addresses of some assertions call for, by dotted path:
 * each text an assertion compares by value (a bare value, `exact`, `subset`, `one_of`) whose shape is a
 * slot. The generator writes them; `spec validate` warns where a spec lacks one.
 */
export function slotRules(assertions: Record<string, Assertion> | undefined): NormaliseMap {
  const rules: NormaliseMap = {};
  for (const [field, assertion] of Object.entries(assertions ?? {})) {
    const texts = comparedTexts(assertion);
    for (const { path, text } of texts) {
      const key = [field, ...path].join('.');
      const kind = slotKind(key, text);
      // A path that holds several values (a one_of of two phones) gets its rule once, from the first.
      if (kind !== undefined && rules[key] === undefined) rules[key] = ruleOf(kind, text);
    }
  }
  return rules;
}

/**
 * A compared phone, email or address with no rule fails on how the agent writes it, not on what it
 * writes; an unapproved surface form is listed and never matches until someone signs it off.
 */
function lintSlots(
  assertions: Record<string, Assertion> | undefined,
  rules: NormaliseMap | undefined,
  base: string,
  issues: Issue[],
): void {
  for (const [key, rule] of Object.entries(slotRules(assertions))) {
    if (rules?.[key] !== undefined) continue;
    const written =
      typeof rule === 'string' ? rule : `{ rule: ${rule.rule}, country_code: '${rule.country_code}' }`;
    issues.push(
      warning(
        'SLOT_FIELD_NO_RULE',
        `${base}.normalise.${key}`,
        `${key} is a phone, an email or an address compared exactly; add normalise: { ${key}: ${written} } so a writing of the same value passes`,
      ),
    );
  }
  for (const [key, rule] of Object.entries(rules ?? {})) {
    if (typeof rule === 'string') continue;
    for (const form of rule.surface_forms ?? []) {
      if (form.approved) continue;
      issues.push(
        warning(
          'SURFACE_FORM_UNAPPROVED',
          `${base}.normalise.${key}`,
          `surface form "${form.form}" is not approved and never matches; sign it off with approved: true`,
        ),
      );
    }
  }
}

/** The expected texts an assertion compares by value, each with its path inside the field. */
function comparedTexts(assertion: Assertion): { path: string[]; text: string }[] {
  const out: { path: string[]; text: string }[] = [];
  const walk = (value: unknown, path: string[]) => {
    if (typeof value === 'string') out.push({ path, text: value });
    else if (isPlainObject(value))
      for (const [key, item] of Object.entries(value)) walk(item, [...path, key]);
  };
  if (assertion === null || typeof assertion !== 'object') walk(assertion, []);
  else if ('exact' in assertion) walk(assertion.exact, []);
  else if ('subset' in assertion) walk(assertion.subset, []);
  else if ('one_of' in assertion) for (const option of assertion.one_of) walk(option, []);
  return out;
}
