import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { checkAssertion, message } from '../support/assert';
import { validateStrict } from '../support/schema';
import { visibleText } from '../support/text';
import { show } from '../support/values';

/**
 * `expect.json`: the customer-visible text of the block is JSON. One verdict for validity, then one for an
 * optional JSON Schema (strict: a key the schema does not declare is an issue), then one per path, each
 * with an assertion from the spec's own vocabulary: a bare value or `exact` for equality, `contains` for a
 * text, `regex`, `one_of`, `nonempty`, `absent`, `subset`. A reply that is one Markdown code fence of JSON
 * is read as that JSON. A path is dotted, and a number in it indexes an array. An unreadable reply fails
 * every verdict after validity, with the reason, so a path is never passed on nothing.
 */
type Paths = { path: string; assert: Parameters<typeof checkAssertion>[1] }[];

const FENCE = /^```(?:json)?[ \t]*\n([\s\S]*?)\n```$/i;

function parseReply(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim();
  const fenced = FENCE.exec(trimmed);
  try {
    return { ok: true, value: JSON.parse(fenced?.[1] ?? trimmed) };
  } catch (cause) {
    return { ok: false, reason: message(cause) };
  }
}

/**
 * Every JSON object or array that starts in the text and parses, in order, without overlap. A bracket
 * opens a candidate; the matching close is found by counting brackets outside strings; a candidate that
 * does not parse is skipped, and the scan goes on from the next bracket.
 */
export function embeddedValues(text: string): unknown[] {
  const found: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text[i];
    if (open !== '{' && open !== '[') {
      i += 1;
      continue;
    }
    const end = closeOf(text, i);
    if (end > i) {
      try {
        found.push(JSON.parse(text.slice(i, end + 1)));
        i = end + 1;
        continue;
      } catch {
        // not JSON: keep scanning from the next character
      }
    }
    i += 1;
  }
  return found;
}

/** The index of the bracket that closes the one at `start`, or -1. Brackets inside strings do not count. */
function closeOf(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i] as string;
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function readPath(value: unknown, path: string): { found: true; value: unknown } | { found: false } {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false };
      current = current[index];
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

function parseEmbedded(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  // The strict reading comes first, so embedded mode accepts every reply strict mode accepts.
  const whole = parseReply(text);
  if (whole.ok) return whole;
  const [first] = embeddedValues(text);
  return first === undefined ? { ok: false, reason: 'no JSON value' } : { ok: true, value: first };
}

export const replyJson: Check = {
  name: 'json',
  applies: (ctx) => ctx.expect.json !== undefined,
  evaluate(ctx) {
    const declared = ctx.expect.json;
    if (!declared) return [];
    const text = visibleText(ctx.observed);
    const parsed = declared.embedded ? parseEmbedded(text) : parseReply(text);
    const verdicts: Verdict[] = [];
    verdicts.push(
      parsed.ok
        ? machineVerdict(
            'json',
            'valid',
            'pass',
            declared.embedded ? 'a JSON value was found in the reply' : 'the reply is valid JSON',
          )
        : machineVerdict(
            'json',
            'valid',
            'fail',
            declared.embedded
              ? 'the reply has no JSON value'
              : `the reply is not valid JSON: ${parsed.reason}`,
          ),
    );
    if (declared.schema !== undefined) {
      if (!parsed.ok) {
        verdicts.push(machineVerdict('json', 'schema', 'fail', 'no JSON to validate'));
      } else {
        const issues = validateStrict(parsed.value, declared.schema);
        verdicts.push(
          issues.length === 0
            ? machineVerdict('json', 'schema', 'pass', 'the reply matches its JSON Schema')
            : machineVerdict(
                'json',
                'schema',
                issues.some((issue) => issue.schemaError) ? 'inconclusive' : 'fail',
                issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
              ),
        );
      }
    }
    ((declared.paths ?? []) as Paths).forEach((entry, index) => {
      const id = `path.${index}`;
      if (!parsed.ok) {
        verdicts.push(machineVerdict('json', id, 'fail', `${entry.path}: no JSON to read`));
        return;
      }
      const found = readPath(parsed.value, entry.path);
      if (!found.found) {
        // A path that reads nothing is absent: it fails every assertion but `absent`, whatever its form.
        const asserted = entry.assert as unknown;
        const pass =
          asserted !== null &&
          typeof asserted === 'object' &&
          'absent' in asserted &&
          checkAssertion(undefined, entry.assert).ok;
        verdicts.push(
          machineVerdict(
            'json',
            id,
            pass ? 'pass' : 'fail',
            `${entry.path} is absent; expected ${checkAssertion(undefined, entry.assert).expected}`,
          ),
        );
        return;
      }
      const result = checkAssertion(found.value, entry.assert);
      const detail = result.problem ?? `${entry.path} is ${show(found.value)}, expected ${result.expected}`;
      verdicts.push(
        machineVerdict(
          'json',
          id,
          result.ok ? 'pass' : 'fail',
          result.ok ? `${entry.path} is ${show(found.value)}` : detail,
        ),
      );
    });
    return verdicts;
  },
};
