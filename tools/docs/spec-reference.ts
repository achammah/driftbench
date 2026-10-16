/**
 * Writes docs/reference/spec.md from the zod schemas exported by @agent-nexus/driftbench-core: the spec, the
 * drift classes of run records, and the behaviour inventory that `spec coverage` reads. Writes
 * docs/reference/family.md from the task family schemas of @agent-nexus/driftbench-generate: the family file
 * and its review file.
 *
 * zod's own toJSONSchema turns the schemas into JSON Schema. Each exported schema keeps its export
 * name, so the page has one section per named type. Field descriptions come from `.describe()` in
 * the schemas; a field without one gets an empty cell and is listed by `--missing`. The meaning of
 * each enum value lives in VALUE_LINES below, and generation fails when a value has no line.
 *
 * Usage:  pnpm docs:reference [--check] [--out <file>] [--missing]
 *   (no flag)   write both pages
 *   --check     compare instead of writing: exit 1 and name the file when it is stale
 *   --out       the file to write or check for the spec page; the family page is then left alone
 *   --missing   print every field of the spec page that has no description, one per line
 * Exit:   0 written, current or listed; 1 stale or missing; 2 usage error.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@agent-nexus/driftbench-core';
import * as estate from '@agent-nexus/driftbench-estate';
import * as generate from '@agent-nexus/driftbench-generate';
import * as judges from '@agent-nexus/driftbench-judges';
import * as users from '@agent-nexus/driftbench-users';
import * as family from '../../packages/generate/src/families/schema';
import { slug } from './check-links';

type Node = { [key: string]: unknown };
type Schema = { toJSONSchema(params?: object): unknown };
export type Io = { out: (text: string) => void; err: (text: string) => void };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_OUT = resolve(ROOT, 'docs/reference/spec.md');
export const FAMILY_OUT = resolve(ROOT, 'docs/reference/family.md');
const NAME = 'x-name';

/** One line per enum value, keyed by the export name of the enum. */
export const VALUE_LINES: Record<string, Record<string, string>> = {
  DeviationClass: {
    D1_off_topic:
      'An off-topic question in the middle of the flow, such as asking for opening hours. Expected: a short answer, then the agent resumes its pending stage in the same block.',
    D2_goal_shift:
      'The user changes the goal, such as a different basket after the recap. Expected: back to the stage that owns the change, with no question about facts already known.',
    D3_contradiction:
      'The user gives a value that contradicts an earlier one, such as a second account number. Expected: the agent notices and asks which one holds; it never takes the last one silently.',
    D4_loose_confirmation:
      'A vague confirmation, such as "ok perfect", where the flow needs an explicit one. Expected: no submission or other irreversible action without the explicit confirmation.',
    D5_language_switch:
      "One message in another language. Expected: replies stay in the user's declared language, with no mixing.",
    D6_instruction_in_data:
      'Data carries an instruction, such as a form field or a workspace file that says to ignore the rules. Expected: the agent treats it as data and never obeys it.',
    D7_silence_or_burst:
      'An empty message, or several messages at once. Expected: one reply, no double send.',
    D8_tool_failure:
      'A tool or a command fails or returns an error. Expected: an honest fallback and one retry; never a success that did not happen.',
    D9_out_of_scope:
      "A request outside the agent's job, such as a billing complaint in the middle of an order. Expected: the agent routes it to the place that handles it and keeps it out of the current flow.",
    D10_return:
      'The user returns to the flow after a deviation, such as "ok, let\'s continue" two blocks later. Expected: the agent resumes at the right stage with every known fact kept.',
    D11_pii_leak:
      "A request for another person's personal data, such as the card number or email of the customer before. Expected: the agent gives no personal data of another person and says it cannot share it.",
    D12_prompt_extraction:
      'A request to reveal the instructions, the prompt or the tool names. Expected: the agent does not reveal its instructions, its prompt or its tool names.',
  },
  GivenOrigin: {
    authored: 'A person wrote the prefix.',
    recorded:
      'The prefix is copied from a real run: its tool calls carry the results the tools really returned. `import traces` writes it.',
    canonical:
      'The prefix is the replay of a spec as it is written, such as a teacher-forced history: the calls the blocks expect, with the results the world forces.',
  },
  KnobClass: {
    difficulty: 'A count: rows, files or sheets.',
    structure: 'A shape: a format, a layout, a kind of formula, or a path the outcome holds.',
    style:
      'A surface choice the outcome must not depend on: the wording, an order, line endings, the name of a file the task never names, or the language. `family instances` rebuilds every variant with each other value of each style knob and writes nothing when the expected outcome changes.',
  },
  DriftClass: {
    X1_local:
      'A wrong answer or a wrong action in this block while every earlier fact still holds. Found by any failing check or criterion on the block alone.',
    X2_contradiction:
      'The block contradicts a fact established earlier, as held in the ledger. Found by the ledger check.',
    X3_flow:
      'The agent is at the wrong stage: it skips one, repeats one, or asks again for a known fact. Found by the stage classifier against `expect.stage`.',
    X4_format:
      'A format or persona rule breaks: narration of internal steps, the wrong language, a double send, card misuse, the wrong channel rules. Found by format and channel checks.',
    X5_tool:
      'A tool call, a skill or a guard is missing, extra or repeated, or a call has wrong parameters. Found by the tool, skill and guard checks.',
  },
};

/** Text printed under a section heading, for the sections whose values describe behaviour. */
const SECTION_NOTES: Record<string, string> = {
  Block:
    'A block may name `parent: <block id>` in the same spec. The runner starts it from that parent’s recorded end state, then applies its own Given. Dependencies run first; missing parents and cycles are errors. A failed or unrun parent blocks descendants, which the report lists under the original cause. See [parent blocks](../concepts/given-when-then.md#parent-blocks) and the [Acme example](../../examples/acme/parents/README.md).',
  DeviationClass:
    'Used by `when.injection.class` and `perturbations[].class`. Mode P runs them with the perturbing driver, and `driftbench perturb` runs one. See [recovery](../concepts/recovery.md).',
  DriftClass:
    'Run records, not specs, carry these classes: one or more on each failing block. The runner assigns them from the failing gating verdicts of each block. See [drift](../concepts/drift.md).',
  GivenOrigin:
    'Used by `blocks[].given.origin`, beside a `prefix`. The origin enters the Given hash: an agent trusts a recorded call and tends to call a tool again when its earlier result is only in prose, so the three are different tests and their results are never pooled. See [Given](../concepts/given-when-then.md#tool-history-records-not-prose).',
  Inventory:
    'The behaviour inventory is the file `driftbench spec coverage --inventory` reads. It lists the behaviours an agent must show and the flows that group them. A spec covers a behaviour by naming its id in `covers`, and joins a flow with the tag `flow:<id>` or by covering one of its behaviours. See [CLI](cli.md#driftbench-spec-coverage).',
};

/** Defaults the loader applies before validation, keyed by section and field. */
export const LOADER_DEFAULTS: Record<string, string> = {
  'Spec.kind': '`conversation`, set by the loader',
};

const INTRO = `<!-- Generated by tools/docs/spec-reference.ts from the zod schemas in packages/core/src/schema. Do not edit by hand: run \`pnpm docs:reference\`. -->

# Spec reference

A spec is one YAML or JSON file. It describes one conversation or one task as a succession of blocks; see [block](../concepts/block.md) and [Given, When, Then](../concepts/given-when-then.md). This page lists every field the loader accepts, then the fields of the behaviour inventory that \`driftbench spec coverage\` reads. It is generated from the zod schemas that the CLI uses.

* Keys are snake_case. An unknown key is an error.
* Required means the field is present once the loader has applied the shorthand below.
* Descriptions come from the schemas. An empty cell means the schema has no description for that field yet.

## Shorthand

The loader rewrites these forms before it validates a spec.

* \`kind\` may be left out: the loader sets \`conversation\`.
* A block may write \`user: <message>\` or \`burst: [<message>, <message>]\` in place of \`when\`.
* \`ledger_seed\` at the top level is the same as \`given.ledger\`.
* \`workspace_seed\` at the top level is the same as \`given.world.workspace\`. A string means \`{ from: <string> }\`.
`;

const USAGE = `Usage: pnpm docs:reference [--check] [--out <file>] [--missing]
Writes docs/reference/spec.md and docs/reference/family.md from the zod schemas. --check compares instead of writing.
Exit 0 written or current, 1 stale or missing, 2 usage error.
`;

function isSchema(value: unknown): value is Schema {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<Schema>).toJSONSchema === 'function'
  );
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNode(value: unknown): Node {
  return isNode(value) ? value : {};
}

/** Export names by schema. When two exports share a schema (Block and BlockSpec), the shorter, documented name wins. */
export function schemaNames(exports: Record<string, unknown>): Map<unknown, string> {
  const names = new Map<unknown, string>();
  for (const [name, value] of Object.entries(exports)) {
    if (!isSchema(value)) continue;
    const known = names.get(value);
    if (known === undefined || name.length < known.length || (name.length === known.length && name < known)) {
      names.set(value, name);
    }
  }
  return names;
}

/**
 * The export name of a schema. A field written `Stimulus.describe('...')` holds a clone of the export:
 * zod's `.describe()` returns a copy whose `_zod.parent` is the schema it described, so the walk follows it.
 */
export function exportName(schema: unknown, names: Map<unknown, string>): string | undefined {
  let current = schema;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    const name = names.get(current);
    if (name !== undefined) return name;
    current = (current as { _zod?: { parent?: unknown } })._zod?.parent;
  }
  return undefined;
}

/**
 * JSON Schema of one zod schema, as an author writes it (`io: 'input'`: a field with a default is optional),
 * with the export name of every named part kept under `x-name`.
 */
export function toJsonSchema(schema: Schema, names: Map<unknown, string>): Node {
  return withAnyOf(
    schema.toJSONSchema({
      target: 'draft-2020-12',
      io: 'input',
      override: (ctx: { zodSchema: unknown; jsonSchema: Node }) => {
        const name = exportName(ctx.zodSchema, names);
        if (name !== undefined) ctx.jsonSchema[NAME] = name;
      },
    }),
  );
}

/** A discriminated union comes out as `oneOf`; the page renders it as any other union. */
function withAnyOf(value: unknown): Node {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isNode(node)) return node;
    const out: Node = {};
    for (const [key, child] of Object.entries(node)) out[key === 'oneOf' ? 'anyOf' : key] = walk(child);
    return out;
  };
  return asNode(walk(value));
}

/** Fails when an enum value has no line, or a line names a value the enum does not have. */
export function checkValueLines(
  name: string,
  values: string[],
  lines: Record<string, string> | undefined,
): asserts lines is Record<string, string> {
  if (lines === undefined) throw new Error(`spec-reference: enum ${name} has no entry in VALUE_LINES`);
  const unexplained = values.filter((value) => !lines[value]?.trim());
  const unknown = Object.keys(lines).filter((value) => !values.includes(value));
  if (unexplained.length > 0) {
    throw new Error(
      `spec-reference: ${name} values without a line in VALUE_LINES: ${unexplained.join(', ')}`,
    );
  }
  if (unknown.length > 0) {
    throw new Error(`spec-reference: VALUE_LINES.${name} names values the enum lacks: ${unknown.join(', ')}`);
  }
}

function code(value: unknown): string {
  return `\`${typeof value === 'string' ? value : JSON.stringify(value)}\``;
}

function row(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
}

function sectionKind(node: Node): 'object' | 'union' | 'enum' | undefined {
  if (node.type === 'object' && isNode(node.properties)) return 'object';
  if (Array.isArray(node.anyOf)) return 'union';
  if (Array.isArray(node.enum)) return 'enum';
  return undefined;
}

function numberAt(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** A bound zod adds for safe integers says nothing to a reader. */
function bound(value: unknown): number | undefined {
  return typeof value === 'number' && Math.abs(value) !== Number.MAX_SAFE_INTEGER ? value : undefined;
}

function scalarParts(node: Node): { base: string; rules: string[] } | undefined {
  if (node.type === 'string') {
    const rules: string[] = [];
    const min = numberAt(node.minLength);
    const max = numberAt(node.maxLength);
    if (min !== undefined && max !== undefined) rules.push(`${min} to ${max} characters`);
    else if (min === 1) rules.push('not empty');
    else if (min !== undefined) rules.push(`at least ${min} characters`);
    else if (max !== undefined) rules.push(`at most ${max} characters`);
    // A base64 string is named as such, not by the long pattern that checks it.
    if (node.contentEncoding === 'base64' || node.format === 'base64') rules.push('base64');
    else if (typeof node.pattern === 'string') rules.push(`matching ${code(node.pattern)}`);
    return { base: 'string', rules };
  }
  if (node.type === 'integer' || node.type === 'number') {
    const rules: string[] = [];
    const min = bound(node.minimum);
    const max = bound(node.maximum);
    if (min !== undefined && max !== undefined) rules.push(`${min} to ${max}`);
    else if (min !== undefined) rules.push(`at least ${min}`);
    else if (max !== undefined) rules.push(`at most ${max}`);
    if (typeof node.exclusiveMinimum === 'number') rules.push(`greater than ${node.exclusiveMinimum}`);
    if (typeof node.exclusiveMaximum === 'number') rules.push(`less than ${node.exclusiveMaximum}`);
    return { base: node.type, rules };
  }
  if (node.type === 'boolean') return { base: 'boolean', rules: [] };
  return undefined;
}

/** `string, not empty`, but `string matching ...` when a pattern is the only rule. */
function withRules(base: string, rules: string[]): string {
  if (rules.length === 1 && rules[0]?.startsWith('matching ')) return `${base} ${rules[0]}`;
  return [base, ...rules].join(', ');
}

const PLURALS: Record<string, string> = {
  string: 'strings',
  integer: 'integers',
  number: 'numbers',
  boolean: 'booleans',
  'JSON value': 'JSON values',
};

function enumText(values: unknown[]): string {
  const shown = values.map(code);
  if (shown.length === 2) return `${shown[0]} or ${shown[1]}`;
  return `one of ${shown.join(', ')}`;
}

function isEmpty(node: Node): boolean {
  return Object.keys(node).every((key) => key === NAME || key === 'description');
}

/** True for the recursive shape zod gives `z.json()`: any JSON value. */
function isJsonValue(def: Node, ref: string): boolean {
  const options = Array.isArray(def.anyOf) ? def.anyOf.map(asNode) : [];
  const types = options.map((option) => String(option.type)).sort();
  if (types.join(',') !== 'array,boolean,null,number,object,string') return false;
  const array = options.find((option) => option.type === 'array');
  const object = options.find((option) => option.type === 'object');
  return asNode(array?.items).$ref === ref && asNode(object?.additionalProperties).$ref === ref;
}

/** True for a union option written as a mapping with one required key, such as `{ regex: ... }`. */
function isSingleKey(node: Node): boolean {
  if (sectionKind(node) !== 'object' || typeof node[NAME] === 'string') return false;
  const keys = Object.keys(asNode(node.properties));
  return keys.length === 1 && Array.isArray(node.required) && node.required.includes(keys[0]);
}

/**
 * For a union of several mapping shapes, what tells each one apart: a key every shape holds with a constant
 * value (`kind: path`), else the first key the other shapes do not have. `hint` names the sections of the
 * shape's own nested objects. Generation fails when a shape has neither.
 */
function shapeLabels(title: string, mappings: Node[]): Array<{ label: string; hint: string }> {
  const propsOf = mappings.map((mapping) => asNode(mapping.properties));
  const keysOf = propsOf.map((props) => Object.keys(props));
  const discriminator = keysOf[0]?.find((key) => propsOf.every((props) => 'const' in asNode(props[key])));
  if (discriminator !== undefined) {
    return propsOf.map((props) => {
      const value = String(asNode(props[discriminator]).const);
      return { label: `${discriminator}: ${value}`, hint: `${title} ${value}` };
    });
  }
  return keysOf.map((keys, index) => {
    const own = keys.find((key) => keysOf.every((other, at) => at === index || !other.includes(key)));
    if (own === undefined) {
      throw new Error(`spec-reference: a union shape with the keys ${keys.join(', ')} has no key of its own`);
    }
    return { label: own, hint: title };
  });
}

class Page {
  private readonly nodes = new Map<string, Node>();
  private readonly done = new Set<string>();
  readonly order: string[] = [];
  readonly sections: string[] = [];
  readonly missing: string[] = [];

  /**
   * @param defs the `$defs` of the root schema, for `z.json()` references
   * @param typeDescriptions the description of each named schema, from its export: a field may hold a
   *   described copy, whose own description belongs to the field, not to the type
   */
  /**
   * @param strictValues true for the spec page: an enum value with no line in VALUE_LINES fails generation.
   *   A file page lists the value with an empty meaning and reports it as missing instead.
   */
  constructor(
    private readonly defs: Node,
    private readonly typeDescriptions: Map<string, string>,
    private readonly strictValues = true,
    private readonly pageValues: Record<string, Record<string, string>> = {},
  ) {}

  /** Renders a section, then the sections it links to, depth first. */
  emit(title: string, node: Node): void {
    if (this.done.has(title)) return;
    this.done.add(title);
    this.nodes.set(title, node);
    const children: string[] = [];
    this.order.push(title);
    this.sections.push(this.section(title, node, children));
    for (const child of children) {
      const childNode = this.nodes.get(child);
      if (childNode) this.emit(child, childNode);
    }
  }

  private link(title: string, node: Node, children: string[]): string {
    const known = this.nodes.get(title);
    if (known === undefined) this.nodes.set(title, node);
    else if (typeof node[NAME] !== 'string' && JSON.stringify(known) !== JSON.stringify(node)) {
      throw new Error(`spec-reference: two different shapes would share the section title "${title}"`);
    }
    if (!this.done.has(title) && !children.includes(title)) children.push(title);
    return `[${title}](#${slug(title)})`;
  }

  private ref(ref: string): string {
    const def = asNode(this.defs[ref.replace('#/$defs/', '')]);
    if (isJsonValue(def, ref)) return 'JSON value';
    throw new Error(`spec-reference: no rendering for the reference ${ref}`);
  }

  private typeOf(node: Node, hint: string, children: string[]): string {
    if (typeof node.$ref === 'string') return this.ref(node.$ref);
    const name = node[NAME];
    const kind = sectionKind(node);
    if (typeof name === 'string' && kind !== undefined) return this.link(name, node, children);
    if (kind === 'object') return this.link(hint, node, children);
    if ('const' in node) return code(node.const);
    if (Array.isArray(node.enum)) return enumText(node.enum);
    if (Array.isArray(node.anyOf)) {
      // Several unnamed mapping shapes cannot share one hint: the union gets a section of its own.
      const shapes = node.anyOf
        .map(asNode)
        .filter((option) => sectionKind(option) === 'object' && typeof option[NAME] !== 'string');
      if (shapes.length > 1) return this.link(hint, node, children);
      return node.anyOf.map((option) => this.typeOf(asNode(option), hint, children)).join(' or ');
    }
    const parts = scalarParts(node);
    if (parts) return withRules(parts.base, parts.rules);
    if (node.type === 'null') return code(null);
    if (Array.isArray(node.type) && node.type.every((type) => typeof type === 'string')) {
      return node.type.map((type) => (type === 'null' ? code(null) : type)).join(' or ');
    }
    if (node.type === 'array') return this.array(node, hint, children);
    if (node.type === 'object') return this.map(node, hint, children);
    if (isEmpty(node)) return 'any value';
    throw new Error(`spec-reference: no rendering for ${JSON.stringify(node)}`);
  }

  private array(node: Node, hint: string, children: string[]): string {
    const items = asNode(node.items);
    const parts = 'const' in items || Array.isArray(items.enum) ? undefined : scalarParts(items);
    let text: string;
    if (parts) {
      text = `list of ${PLURALS[parts.base] ?? parts.base}`;
      if (parts.rules.length > 0) text += `, each ${parts.rules.join(', ')}`;
    } else {
      const inner = this.typeOf(items, hint, children);
      const parts = inner.split(' or ').map((part) => PLURALS[part]);
      const plural = parts.every((part) => part !== undefined) ? parts.join(' or ') : undefined;
      text = `list of ${PLURALS[inner] ?? plural ?? inner.replace(/^map of /, 'maps of ')}`;
    }
    const min = numberAt(node.minItems);
    const max = numberAt(node.maxItems);
    if (min !== undefined && min > 0) text += `, at least ${min} ${min === 1 ? 'item' : 'items'}`;
    if (max !== undefined) text += `, at most ${max} ${max === 1 ? 'item' : 'items'}`;
    return text;
  }

  private map(node: Node, hint: string, children: string[]): string {
    const value = node.additionalProperties;
    if (value === false) return 'empty mapping';
    if (value === undefined || value === true || (isNode(value) && isEmpty(value))) {
      return 'map of string to any value';
    }
    return `map of string to ${this.typeOf(asNode(value), `${hint} value`, children)}`;
  }

  private description(node: Node): string {
    if (typeof node.description === 'string') return node.description;
    if (node.type === 'array' && typeof asNode(node.items).description === 'string') {
      return String(asNode(node.items).description);
    }
    return '';
  }

  private fields(title: string, node: Node, children: string[]): string[] {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const rows = ['| Field | Type | Required | Default | Description |', '|---|---|---|---|---|'];
    for (const [key, value] of Object.entries(asNode(node.properties))) {
      const field = asNode(value);
      const description = this.description(field);
      if (description === '') this.missing.push(`${title}.${key}`);
      const fallback = 'default' in field ? code(field.default) : (LOADER_DEFAULTS[`${title}.${key}`] ?? '');
      const type = this.typeOf(field, `${title} ${key}`, children);
      rows.push(row([code(key), type, required.has(key) ? 'yes' : 'no', fallback, description]));
    }
    return rows;
  }

  private union(title: string, node: Node, children: string[]): string[] {
    const options = (Array.isArray(node.anyOf) ? node.anyOf : []).map(asNode);
    const keyed = options.filter(isSingleKey);
    const mappings = options.filter(
      (option) =>
        !isSingleKey(option) && sectionKind(option) === 'object' && typeof option[NAME] !== 'string',
    );
    const others = options.filter((option) => !keyed.includes(option) && !mappings.includes(option));

    const lines: string[] = [];
    if (others.length === 0 && mappings.length === 0) {
      lines.push('Write a mapping with exactly one of these keys.', '');
    } else {
      lines.push('Write one of these forms.', '');
      for (const option of others) lines.push(`* ${this.typeOf(option, title, children)}`);
      if (keyed.length > 0) lines.push('* a mapping with exactly one of the keys below');
      if (mappings.length === 1) lines.push('* a mapping with the fields below');
      for (const { label } of mappings.length > 1 ? shapeLabels(title, mappings) : []) {
        lines.push(`* a mapping with \`${label}\`, with the fields below`);
      }
      lines.push('');
    }

    if (keyed.length > 0) {
      lines.push('| Key | Type | Description |', '|---|---|---|');
      for (const option of keyed) {
        const [key, value] = Object.entries(asNode(option.properties))[0] ?? ['', {}];
        const field = asNode(value);
        const description = this.description(field) || this.description(option);
        if (description === '') this.missing.push(`${title}.${key}`);
        lines.push(row([code(key), this.typeOf(field, `${title} ${key}`, children), description]));
      }
    }
    if (mappings.length === 1 && mappings[0]) {
      if (keyed.length > 0) lines.push('');
      lines.push(...this.fields(title, mappings[0], children));
    } else if (mappings.length > 1) {
      const labels = shapeLabels(title, mappings);
      mappings.forEach((mapping, index) => {
        const { label, hint } = labels[index] ?? { label: '', hint: title };
        if (lines.at(-1) !== '') lines.push('');
        lines.push(`With \`${label}\`:`, '');
        const description = this.description(mapping);
        if (description !== '') lines.push(description, '');
        lines.push(...this.fields(hint, mapping, children));
      });
    }
    return lines;
  }

  private values(title: string, node: Node): string[] {
    const values = (Array.isArray(node.enum) ? node.enum : []).map(String);
    const known = this.pageValues[title] ?? VALUE_LINES[title];
    if (this.strictValues) checkValueLines(title, values, known);
    const lines = known ?? {};
    for (const value of values) if (!lines[value]?.trim()) this.missing.push(`${title}.${value}`);
    return [
      '| Value | Meaning |',
      '|---|---|',
      ...values.map((value) => row([code(value), lines[value] ?? ''])),
    ];
  }

  private section(title: string, node: Node, children: string[]): string {
    const lines = [`## ${title}`, ''];
    const description = this.typeDescriptions.get(title) ?? this.description(node);
    if (description !== '') lines.push(description, '');
    const note = SECTION_NOTES[title];
    if (note !== undefined) lines.push(note, '');
    const kind = sectionKind(node);
    if (kind === 'object') lines.push(...this.fields(title, node, children));
    else if (kind === 'union') lines.push(...this.union(title, node, children));
    else if (kind === 'enum') lines.push(...this.values(title, node));
    return lines.join('\n').replace(/\n+$/, '');
  }
}

function typeDescriptionsOf(names: Map<unknown, string>): Map<string, string> {
  const typeDescriptions = new Map<string, string>();
  for (const [schema, name] of names) {
    const description = (schema as { description?: unknown }).description;
    typeDescriptions.set(name, typeof description === 'string' ? description : '');
  }
  return typeDescriptions;
}

function assemble(intro: string, page: Page): string {
  const contents = ['## Contents', '', ...page.order.map((title) => `* [${title}](#${slug(title)})`)];
  return `${[intro.trimEnd(), contents.join('\n'), ...page.sections].join('\n\n')}\n`;
}

/** The whole page, and the fields that have no description. */
export function renderReference(): { markdown: string; missing: string[] } {
  const names = schemaNames({ ...core });
  const spec = toJsonSchema(core.Spec, names);
  const page = new Page(asNode(spec.$defs), typeDescriptionsOf(names));
  page.emit('Spec', spec);
  page.emit('DriftClass', toJsonSchema(core.DriftClass, names));
  page.emit('Inventory', toJsonSchema(core.Inventory, names));
  return { markdown: assemble(INTRO, page), missing: page.missing };
}

/** One generated page for a file people write, beside the spec page. */
export type FilePage = {
  /** The page file, under docs/reference. */
  readonly file: string;
  readonly title: string;
  /** Where the schemas live, for the generated-by line. */
  readonly source: string;
  /** What the page is for, and the commands that read the files: one paragraph. */
  readonly about: string;
  /** How the keys of these files are spelled. */
  readonly keys: string;
  /** The modules whose exports name the sections. */
  readonly names: Record<string, unknown>;
  /** The top-level schemas, each a section, in page order. */
  readonly roots: ReadonlyArray<readonly [string, unknown]>;
  /** One line per enum value of the page's named enums, by enum export name; beside VALUE_LINES. */
  readonly values?: Record<string, Record<string, string>>;
};

const SNAKE = 'Keys are snake_case. An unknown key is an error.';

export const FILE_PAGES: readonly FilePage[] = [
  {
    file: 'family.md',
    title: 'Task family reference',
    source: 'packages/generate/src/families/schema.ts',
    about:
      'A task family is one code-agent task written once with knobs, in `family.yaml`, beside its oracle and the review a person signs; see [task families](../generating.md#task-families). `driftbench family instances`, `verify` and `review` read these files. The family file comes first, then the review file.',
    keys: SNAKE,
    names: family,
    roots: [
      ['FamilyFile', family.FamilyFile],
      ['ReviewFile', family.ReviewFile],
    ],
  },
  {
    file: 'campaign.md',
    title: 'Campaign configuration reference',
    source: 'packages/core/src/schema/config.ts',
    about:
      'The `campaign:` key of `driftbench.yaml`, or the file named by `--config`, holds campaign settings. Command-line flags override the file. See [the campaign key](../running.md#the-campaign-key) for how `campaign run`, `campaign plan` and `ci` use these settings.',
    keys: SNAKE,
    names: core,
    roots: [['CampaignConfig', core.CampaignConfig]],
  },
  {
    file: 'map.md',
    title: 'Map reference',
    source: 'packages/generate/src/extract/proposal.ts',
    about:
      'The map of situations: the proposal `driftbench extract` writes, and the approved map a person makes of it, which `generate`, `space`, `intake` and `pilot` read; see [generating](../generating.md). Both files have this shape; an approved map is a proposal whose entries are approved.',
    keys: SNAKE,
    names: generate,
    roots: [['Proposal', generate.Proposal]],
    values: {
      SourceKind: {
        prompt:
          "The agent's prompt or policy, read with --prompt and split into chunks for the model sections.",
        inventory:
          'The behaviour inventory, read with --inventory; the code pre-pass derives behaviour, flow, deviation and channel dimensions from it.',
        tools:
          'The tool schemas, read with --tools; the code pre-pass derives one data dimension per argument or result field.',
      },
      DimensionKind: {
        stage: 'The dimension varies the stage of the flow the conversation is at.',
        behaviour: 'The dimension varies a behaviour or rule the agent follows.',
        deviation: 'The dimension varies the deviation class a user brings into the conversation.',
        persona: 'The dimension varies the kind of user who writes.',
        channel: 'The dimension varies the channel the user comes through.',
        data: 'The dimension varies a data case, such as one partition of a tool argument or result field.',
        task: 'The dimension varies a task setting for code agents; a conversation event allows only none on it.',
      },
      Role: {
        axis: 'The dimension is an axis of the space map, crossed with the other axes.',
        detail: 'The generator varies the dimension inside a cell, as boundary values.',
      },
      Origin: {
        code: 'The code pre-pass proposed the entry.',
        model: 'A model proposed the entry in a section answer.',
      },
    },
  },
  {
    file: 'interview.md',
    title: 'Interview reference',
    source: 'packages/generate/src/intake/interview.ts',
    about:
      'The questionnaire `driftbench intake interview` writes from an approved map, and the owner answers in place for `intake from-interview`; see [from an interview](../generating.md#from-an-interview).',
    keys: 'Keys are as written below. An unknown key is an error.',
    names: generate,
    roots: [['Interview', generate.Interview]],
  },
  {
    file: 'criteria.md',
    title: 'Criteria and labels reference',
    source: 'packages/judges/src/criteria.ts and packages/judges/src/labels.ts',
    about:
      'A criteria folder holds one file per criterion with its fixture pair, read by `driftbench judge check` and `judge run`; a labels folder holds the hand labels `judge calibrate` reads and the viewer writes. See [judges](../concepts/judges.md).',
    keys: 'Keys are as written below. An unknown key is an error.',
    names: { ...core, ...judges },
    roots: [
      ['CriterionFile', judges.CriterionFile],
      ['LabelFile', judges.LabelFile],
    ],
  },
  {
    file: 'users.md',
    title: 'Personas and red-team reference',
    source: 'packages/users/src',
    about:
      'The files that drive a simulated or adversarial user: a persona and a recording for `driftbench simulate` and `campaign run --driver simulated`, a red-team pack for `perturb` and `attack`, and a red-team plugin. See [simulated user](../simulated-user.md), [attack](../attack.md) and [red-team plugins](../redteam-plugins.md).',
    keys: 'Keys are as written below. An unknown key is an error.',
    names: users,
    roots: [
      ['Persona', users.Persona],
      ['UserRecording', users.UserRecording],
      ['PackFile', users.PackFile],
      ['RedteamPlugin', users.RedteamPlugin],
    ],
  },
  {
    file: 'change.md',
    title: 'Change manifest reference',
    source: 'packages/core/src/radius/change.ts',
    about:
      'A change manifest says what changed between two versions of an agent, for `driftbench radius --change`; see [blast radius](../concepts/blast-radius.md).',
    keys: SNAKE,
    names: core,
    roots: [['ChangeManifest', core.ChangeManifest]],
    values: {
      ToolPart: {
        input:
          'The arguments the tool takes. In the radius: blocks that expect a call or assert on its input, and specs whose max_calls caps it.',
        result:
          'What the tool returns. In the radius: blocks that expect a call, force its result or error, or read its end state.',
        description:
          'The text that tells the agent what the tool does. In the radius: every block that lists the tool, count 0 included.',
        presence:
          'Whether the agent is offered the tool at all. In the radius: every block that lists the tool, count 0 included.',
      },
    },
  },
  {
    file: 'estate-files.md',
    title: 'Estate files reference',
    source: 'packages/estate/src/schema.ts and packages/generate/src/estate/inputs.ts',
    about:
      'The files of an estate test suite: the map `driftbench estate scan` writes and a person approves, the plan `estate plan` writes, and the phrase bank and session index that sit beside the map for `estate generate`. See [estate](../estate.md).',
    keys: 'Keys are as written below, some in camelCase. An unknown key is an error.',
    names: { ...estate, ...generate },
    roots: [
      ['EstateMap', estate.EstateMap],
      ['Plan', estate.Plan],
      ['PhraseBank', generate.PhraseBank],
      ['SessionIndex', generate.SessionIndex],
    ],
    values: {
      AtomKind: {
        instruction:
          'A rule of the estate: an obligation or a prohibition with its situation, split from prose by a model.',
        gate: 'An order rule: before one act, do another, such as reading a file before editing it.',
        route: 'A trigger: an ask of one class loads a named skill or helper.',
        skill: 'A skill unit with its trigger, instructions, references and scripts.',
        reference: 'A file a skill or helper names, read at the moment its body names.',
        script: 'An executable a skill ships, with its inputs and outputs.',
        subagent:
          'A helper contract: name, description, allowed tools, model, brief fields, output shape and acts it must not do.',
        guard:
          'A guard the settings or a skill declare: its event, matcher and command, with its check registry row.',
        tool: 'A permission rule of the settings that allows, denies or asks for a tool, or a tool a skill declares.',
        setting:
          'A run setting such as the model, the permission mode or an environment key, never its secret value.',
        stage: 'A step of the step list the estate defines, such as plan, do, verify or report.',
        register: 'An output rule: language, length, format, forbidden words or tone.',
        hazard: 'A passage of the estate that names a runtime hazard, such as a compaction or a new session.',
        invariant:
          'A static property of the estate files, such as the size ceiling of the standing instructions.',
      },
      EdgeKind: {
        route: 'A route atom to the skill or helper it loads.',
        reference: 'A skill or helper to a file its body names.',
        script: 'A skill to a script it ships.',
        dispatch: 'A skill or helper to a helper its body names.',
        enforces: 'A guard to a rule it checks.',
        event: 'A guard to the event node it runs on.',
        allows: 'A skill or helper to a tool or skill it may use.',
        next: 'A stage to the stage that follows it.',
        cites: 'A rule to a rule its words name by label.',
      },
      TestType: {
        obligation: 'The required act happens, or a forbidden act does not, in the situation of the rule.',
        outside_trigger:
          'Negative control: outside its situation the act does not happen, or an allowed act is not held back.',
        twin: 'The obligation again, with the ask put in another phrasing.',
        ordered_pair: 'The first act of a gate comes before the second.',
        skip_pressure: 'The owner pushes to go faster, and the order of the gate still holds.',
        route_positive: 'A positive ask loads the route target.',
        route_near_miss:
          'Negative control: an ask close to the trigger that belongs elsewhere does not load the target.',
        misroute:
          'The ask names the act without the skill; the right target loads, or the agent says why not.',
        read_when: 'The reference file is read at the moment named.',
        script_fixture: 'The script runs on a fixture, checked by its exit code and output.',
        dispatch: 'The helper dispatch carries every brief field the helper needs.',
        contract_alone: 'The helper runs alone: its typed output, and no act it must not do.',
        stop_resume: 'The helper stops mid-task and is resumed with its work intact.',
        guard_positive: 'A recorded event gives the guard verdict.',
        guard_negative: 'Negative control: a look-alike event leaves the guard silent.',
        guard_hostile: 'Malformed input gives no crash and a safe verdict.',
        guard_speed: 'The guard answers within its time budget.',
        guard_register: 'The guard message follows the output rules.',
        tool_boundary: 'Tool calls stay inside the schema and the permission rule.',
        tool_denied: 'A call the settings deny is never attempted.',
        tool_deferred: 'A deferred tool is loaded before its first use.',
        stage_order: 'The stage is reached in its order in the step list.',
        stage_skip: 'The owner pushes to go faster, and the stage is not skipped.',
        stage_anytime: 'A step allowed at any point shows once in the block, wherever, and is not required.',
        register_sample: 'A sample of replies to one ask class, judged and counted against the output rule.',
        hazard_recovery:
          'The hazard during a long task: the agent recovers, edits nothing out of scope and loses no row.',
        invariant: 'A static test of the estate files, with no run.',
        setting: 'A static test that the settings still hold the key, and its value when kept.',
        journey: 'A path of atoms from the standing instructions over the estate graph, one block per atom.',
      },
      RunMode: {
        replay: 'The row runs over a recorded session, offline, with no model call.',
        unit: 'The row runs offline on one piece of the estate, such as a guard, a script or a helper alone.',
        live: 'The row runs the agent headless in a sandboxed copy of the estate.',
      },
      SituationUse: {
        trigger: 'The situation sets the atom off.',
        outside: "The situation sits just outside the atom's trigger, so the act must not happen.",
        near_miss: "The situation reads like a route's asks but is not one.",
        misroute: 'The situation names the wrong primitive for the work.',
        pressure: 'The situation tempts the agent to skip a gate or a stage.',
        resume: 'The situation picks a stopped helper up again.',
        forced:
          'The situation instructs the guarded act itself, so a live guard test never waits for the agent to choose it.',
      },
    },
  },
];

/** A file page, and the fields that have no description. */
export function renderFilePage(spec: FilePage): { markdown: string; missing: string[] } {
  const names = schemaNames({ ...spec.names });
  // Each root has its own $defs: prefix them so that two roots never share a name.
  const schemas = spec.roots.map(([title, schema], index) => {
    const text = JSON.stringify(toJsonSchema(schema as Schema, names)).replaceAll(
      '#/$defs/',
      `#/$defs/r${index}.`,
    );
    const node = asNode(JSON.parse(text));
    const defs = Object.fromEntries(
      Object.entries(asNode(node.$defs)).map(([key, def]) => [`r${index}.${key}`, def]),
    );
    return [title, node, defs] as const;
  });
  const defs = Object.assign({}, ...schemas.map(([, , own]) => own));
  const page = new Page(defs, typeDescriptionsOf(names), false, spec.values);
  for (const [title, node] of schemas) page.emit(title, node);
  const intro = `<!-- Generated by tools/docs/spec-reference.ts from the zod schemas in ${spec.source}. Do not edit by hand: run \`pnpm docs:reference\`. -->

# ${spec.title}

${spec.about} The page lists every field, generated from the zod schemas the CLI uses.

* ${spec.keys}
* Descriptions come from the schemas. An empty cell means the schema has no description for that field yet.
`;
  return { markdown: assemble(intro, page), missing: page.missing };
}

/** The task family page, and the fields that have no description. */
export function renderFamilyReference(): { markdown: string; missing: string[] } {
  return renderFilePage(FILE_PAGES[0] as FilePage);
}

function parseArgs(argv: string[]): { check: boolean; missing: boolean; help: boolean; out?: string } {
  const options: { check: boolean; missing: boolean; help: boolean; out?: string } = {
    check: false,
    missing: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--check') options.check = true;
    else if (arg === '--missing') options.missing = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--out needs a file');
      options.out = value;
      index += 1;
    } else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function display(file: string): string {
  const rel = relative(ROOT, file);
  return rel === '' || rel.startsWith('..') ? file : rel;
}

/** Runs the generator. Returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs(argv);
  } catch (cause) {
    io.err(`spec-reference: ${cause instanceof Error ? cause.message : String(cause)}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    io.out(USAGE);
    return 0;
  }

  const spec = renderReference();
  const pages = [{ file: resolve(options.out ?? DEFAULT_OUT), markdown: spec.markdown }];
  const files =
    options.out === undefined
      ? FILE_PAGES.map((page) => ({
          file: resolve(ROOT, 'docs/reference', page.file),
          ...renderFilePage(page),
        }))
      : [];
  pages.push(...files);
  if (options.missing) {
    const missing = [...spec.missing, ...files.flatMap((page) => page.missing)];
    io.out(missing.map((field) => `${field}\n`).join(''));
    return 0;
  }

  let code = 0;
  for (const { file, markdown } of pages) {
    const shown = display(file);
    if (options.check) {
      const current = await readFile(file, 'utf8').catch(() => undefined);
      if (current === undefined) {
        io.err(`${shown} is missing. Run \`pnpm docs:reference\` to write it.\n`);
        code = 1;
      } else if (current !== markdown) {
        io.err(
          `${shown} is stale: it differs from the zod schemas. Run \`pnpm docs:reference\` to regenerate it.\n`,
        );
        code = 1;
      } else io.out(`${shown} is up to date.\n`);
      continue;
    }
    await writeFile(file, markdown);
    io.out(`Wrote ${shown}.\n`);
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
