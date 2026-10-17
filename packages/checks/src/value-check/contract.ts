import { parameterSchema } from '@agent-nexus/driftbench-core';
import { isRecord, show } from '../support/values';
import type { Rung } from './ladder';

/**
 * Rung 2, the contract: the format the tool states to the agent. When the tool cannot be asked, the value is
 * held to what the tool's definition declares for its field: a JSON Schema `pattern`, `enum` or `const` (the
 * keywords `metadata.tool_schemas` accepts). A value outside the declared contract fails, because the agent was told. Two different
 * members of a declared enum name two different things, so they fail too. A value inside the contract is not
 * settled here (the shipped item settles only fails): a stated format tells what a writing must look like,
 * not which thing it names. value_equivalence.md section 3, rung 2, and 3c R1.
 *
 * A format stated only in prose (a description, the prompt) is not machine-readable; the agent's fault for
 * breaking one is decided by blame, not here.
 */

/** The JSON Schema keywords that state a format. */
const FORMAT_KEYWORDS = ['pattern', 'enum', 'const'] as const;

/** The schema of one field of a tool definition, by dotted path; undefined when the definition has none. */
export function fieldSchema(definition: unknown, field: string): Record<string, unknown> | undefined {
  let at: unknown = parameterSchema(definition);
  for (const key of field.split('.')) {
    if (!isRecord(at) || !isRecord(at.properties)) return undefined;
    at = at.properties[key];
  }
  return isRecord(at) ? at : undefined;
}

/** `tool` when the tool's definition states a format for the field, else `none`. */
export function contractOf(definition: unknown, field: string): 'tool' | 'none' {
  const schema = fieldSchema(definition, field);
  return schema !== undefined && FORMAT_KEYWORDS.some((keyword) => schema[keyword] !== undefined)
    ? 'tool'
    : 'none';
}

export const contract: Rung = (value) => {
  const schema = fieldSchema(value.definition, value.field);
  if (schema === undefined || contractOf(value.definition, value.field) === 'none') {
    return { skip: 'the tool states no format for this field' };
  }
  const broken = brokenBy(schema, value.value, value.gold);
  if (broken !== undefined) {
    return {
      settles: 'fail',
      evidence: `${show(value.value)} breaks the tool's stated contract: ${broken}`,
      emits: { contract: 'tool' },
    };
  }
  return {
    settles: 'pass',
    evidence: `${show(value.value)} holds the tool's stated contract`,
    emits: { contract: 'tool' },
  };
};

/** The first keyword the value breaks, in words; undefined when it holds them all. */
function brokenBy(schema: Record<string, unknown>, value: unknown, gold: unknown): string | undefined {
  if (schema.const !== undefined && value !== schema.const) return `const ${show(schema.const)}`;
  if (Array.isArray(schema.enum)) {
    const options = schema.enum;
    if (!options.includes(value)) return `enum ${show(options)}`;
    if (options.includes(gold) && value !== gold) {
      return `enum ${show(options)} lists both ${show(value)} and the gold ${show(gold)}, two different members`;
    }
  }
  if (typeof schema.pattern === 'string') {
    let pattern: RegExp;
    try {
      pattern = new RegExp(schema.pattern, 'u');
    } catch {
      return undefined;
    }
    if (typeof value !== 'string' || !pattern.test(value)) return `pattern /${schema.pattern}/`;
  }
  return undefined;
}
