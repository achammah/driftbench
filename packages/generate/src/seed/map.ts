import { contentHash, type Inventory, isPlainObject } from '@agent-nexus/driftbench-core';
import { type CompiledSpace, compileSpace, NONE, type SpaceMap } from '@agent-nexus/driftbench-space';
import { parse as parseYaml } from 'yaml';
import {
  FLOW_DIMENSION,
  type NumericSetting,
  type Proposal,
  type ProposalPhrase,
  valueApproved,
} from '../extract/proposal';
import { toSpaceMap } from '../extract/space';
import { toolSlug } from '../extract/tools';
import { Feasibility } from './feasible';
import { type Relations, readRelations } from './relations';

/**
 * The approved map, ready for the seeders: the space map of the approved entries only, the approved
 * phrase bank, the tool schemas the map's data dimensions were read from, the inventory, and the map's
 * identity (version and hash). Everything the seeders do is computed from this object; nothing else.
 */

/** A JSON Schema, as plain data. */
export type JsonSchema = Record<string, unknown>;

export type ToolSchema = { name: string; slug: string; input?: JsonSchema; output?: JsonSchema };

/** A data dimension read from a tool schema: `<tool>.in.<path>` or `<tool>.out.<path>`. */
export type ToolDimension = {
  tool: ToolSchema;
  direction: 'in' | 'out';
  /** Property names from the schema root, such as [customer, email]. */
  path: string[];
  /** The property's own schema. */
  schema: JsonSchema;
};

export type PreparedMap = {
  agent: string;
  /** The proposal format version, as text. */
  version: string;
  /** The content hash of what the seeders read: the approved dimensions, their roles, the phrases. */
  hash: string;
  /**
   * Every approved dimension, axes and details, with every approved constraint: the space a cell is
   * drawn in, so a detail chosen inside a cell honours the constraints too.
   */
  map: SpaceMap;
  space: CompiledSpace;
  /** The space map of the approved axes (`toSpaceMap`): the map coverage is counted on. */
  axisMap: SpaceMap;
  /** Inventory exclusions added to the relation-only target, retained for transparent reporting. */
  reachability?: { before: SpaceMap; excluded: SpaceMap['constraints'] };
  /** Indices, in `space`, of the axis dimensions. Every other dimension is a detail. */
  axes: ReadonlySet<number>;
  feasibility: Feasibility;
  /** Approved phrases, in file order. */
  phrases: ProposalPhrase[];
  /** Approved phrases by `dimension=value`. */
  phrasesOf: ReadonlyMap<string, ProposalPhrase[]>;
  tools: ToolSchema[];
  /** Data dimensions read from a tool schema, by dimension index. */
  toolDimensions: ReadonlyMap<number, ToolDimension>;
  inventory: Inventory | undefined;
  /** Indices of the single dimensions, when the map has them. */
  stage: number | undefined;
  deviation: number | undefined;
  channel: number | undefined;
  /** The behaviour dimension the extractor names `stage_transition`: the edges of the stage graph. */
  transition: number | undefined;
  /** The approved relations: paths, tool calls, slot values, recoveries, the reply language. */
  relations: Relations;
  /** Approved numeric ranges, sampled only by budget mode and delivered as runtime vars. */
  numericSettings?: readonly NumericSetting[];
};

/** The dimension id the extractor gives the stage graph's edges, `<from>-to-<to>` (extract handoff). */
export const TRANSITION_DIMENSION = 'stage_transition';

export function phraseKey(dimension: string, value: string): string {
  return `${dimension}=${value}`;
}

/** Prepares an approved proposal: approved entries only, whatever flags the file holds. */
export function prepareMap(
  proposal: Proposal,
  extras: { tools?: ToolSchema[]; inventory?: Inventory } = {},
): PreparedMap {
  // The cell space holds the details too: the same conversion with every dimension read as an axis. The
  // pairs the relations rule out, and the `none` of a data or task axis, come from the axis map: the
  // relations speak of the axes.
  const before = toSpaceMap(proposal, { approvedOnly: true });
  const axisMap = extras.inventory
    ? toSpaceMap(proposal, { approvedOnly: true, inventory: extras.inventory })
    : before;
  const previous = new Set(before.constraints.map((constraint) => JSON.stringify(constraint.forbid)));
  const excluded = axisMap.constraints.filter(
    (constraint) => !previous.has(JSON.stringify(constraint.forbid)),
  );
  const whole = toSpaceMap(
    {
      ...proposal,
      dimensions: proposal.dimensions.map((dimension) => ({ ...dimension, role: 'axis' as const })),
    },
    { approvedOnly: true, derive: false },
  );
  const axisValues = new Map(axisMap.dimensions.map((dimension) => [dimension.id, dimension.values]));
  const written = new Set(whole.constraints.map((constraint) => JSON.stringify(constraint.forbid)));
  const map = {
    ...whole,
    dimensions: whole.dimensions.map((dimension) => ({
      ...dimension,
      values: axisValues.get(dimension.id) ?? dimension.values,
    })),
    constraints: [
      ...whole.constraints,
      ...axisMap.constraints.filter((constraint) => !written.has(JSON.stringify(constraint.forbid))),
    ],
  };
  const space = compileSpace(map);
  const axisIds = new Set(axisMap.dimensions.map((dimension) => dimension.id));
  const axes = new Set(
    space.dimensions.flatMap((dimension, index) => (isAxis(axisIds, dimension.id) ? [index] : [])),
  );
  const phrases = proposal.phrases.filter((phrase) => {
    if (!phrase.approved) return false;
    const dimension = space.dimensions.find((candidate) => candidate.id === phrase.dimension);
    return dimension?.index.has(phrase.value) === true;
  });
  const phrasesOf = new Map<string, ProposalPhrase[]>();
  for (const phrase of phrases) {
    const key = phraseKey(phrase.dimension, phrase.value);
    phrasesOf.set(key, [...(phrasesOf.get(key) ?? []), phrase]);
  }
  const tools = extras.tools ?? [];
  const find = (kind: string, id?: string) => {
    const index = space.dimensions.findIndex(
      (dimension) => dimension.kind === kind && (id === undefined || dimension.id === id),
    );
    return index < 0 ? undefined : index;
  };
  const approvedValue = (dimension: string, value: string) => {
    const found = proposal.dimensions.find((candidate) => candidate.id === dimension);
    const entry = found?.values.find((candidate) => candidate.id === value);
    return found !== undefined && entry !== undefined && valueApproved(found, entry);
  };
  const relations = readRelations(proposal, approvedValue);
  const numericSettings = (proposal.numeric_settings ?? []).filter((setting) => setting.approved);
  const hash = contentHash({
    map,
    axes: [...axisIds],
    phrases: phrases.map(({ dimension, value, text, lang, when, binds }) => ({
      dimension,
      value,
      text,
      lang,
      ...(when ? { when } : {}),
      ...(binds ? { binds } : {}),
    })),
    ...(numericSettings.length === 0
      ? {}
      : {
          numeric_settings: numericSettings.map(
            ({ evidence: _evidence, produced_by: _by, approved: _approved, ...range }) => range,
          ),
        }),
    ...(relations.paths.length +
      relations.usesTools.length +
      relations.states.length +
      relations.taskFamilies.length +
      relations.binds.size +
      relations.recoveries.length >
      0 ||
    relations.replyLanguage !== undefined ||
    relations.repliesPerTurn !== 'one'
      ? {
          relations: (proposal.relations ?? [])
            .filter((relation) => relation.approved)
            .map(({ evidence: _evidence, produced_by: _by, approved: _approved, ...body }) => body),
        }
      : {}),
  });
  return {
    agent: proposal.agent,
    version: String(proposal.version),
    hash,
    map,
    space,
    axisMap,
    ...(excluded.length > 0 ? { reachability: { before, excluded } } : {}),
    axes,
    feasibility: new Feasibility(space),
    phrases,
    phrasesOf,
    tools,
    toolDimensions: toolDimensionsOf(space, tools),
    inventory: extras.inventory,
    stage: find('stage'),
    deviation: find('deviation'),
    channel: find('channel'),
    transition: find('behaviour', TRANSITION_DIMENSION),
    relations,
    ...(numericSettings.length === 0 ? {} : { numericSettings }),
  };
}

/**
 * Whether a dimension is an axis: its `role` in the proposal, read through the space map of the axes. The
 * one place the generator decides it.
 */
export function isAxis(axisIds: ReadonlySet<string>, dimension: string): boolean {
  return axisIds.has(dimension);
}

/** The value id of a dimension's value index. */
export function valueId(prepared: PreparedMap, dimension: number, value: number): string {
  return prepared.space.dimensions[dimension]?.values[value]?.id ?? '';
}

/** The dimension id of an index. */
export function dimensionId(prepared: PreparedMap, dimension: number): string {
  return prepared.space.dimensions[dimension]?.id ?? '';
}

/**
 * True when a relation's subject is a behaviour value: a `uses_tool` with such a subject is a call the
 * behaviour's own phrase turn makes, never a move of the walk.
 */
export function behaviourSubject(prepared: PreparedMap, subject: { dimension: string }): boolean {
  // The flow dimension is of the behaviour kind too: its calls are the walk's moves.
  if (subject.dimension === FLOW_DIMENSION) return false;
  return prepared.space.dimensions.find((entry) => entry.id === subject.dimension)?.kind === 'behaviour';
}

/** The index of a value id in a dimension, or undefined. */
export function valueIndex(prepared: PreparedMap, dimension: number, value: string): number | undefined {
  return prepared.space.dimensions[dimension]?.index.get(value);
}

/** True for the reserved `none` value. */
export function isNone(prepared: PreparedMap, dimension: number, value: number): boolean {
  return valueId(prepared, dimension, value) === NONE;
}

/** The partition part of a data value id: `coverage.check.out.found.true` gives `true`. */
export function partitionOf(dimension: string, value: string): string {
  return value.startsWith(`${dimension}.`) ? value.slice(dimension.length + 1) : value;
}

// Tool schemas ---------------------------------------------------------------------------------------

export type ToolsRead = { ok: true; tools: ToolSchema[] } | { ok: false; message: string };

/**
 * Reads tool schemas in the forms `driftbench extract --tools` accepts: a list of tools, or a mapping with
 * `tools`, `tool_schemas` or `metadata.tool_schemas`, as a list or a name map; the input schema under
 * `input_schema`, `inputSchema` or `parameters`; the output schema under `output_schema`, `outputSchema`
 * or `returns`; the OpenAI `{ type: function, function }` wrapper.
 */
export function readToolSchemas(text: string): ToolsRead {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const listed = locate(raw);
  if (listed === undefined) {
    return { ok: false, message: 'no tools found: expected a list of tools, or tools, tool_schemas' };
  }
  const entries: Array<[unknown, Record<string, unknown> | undefined]> = Array.isArray(listed)
    ? listed.map((item) => [unwrap(item)?.name, unwrap(item)])
    : Object.entries(listed).map(([name, item]) => [name, unwrap(item)]);
  const tools: ToolSchema[] = [];
  for (const [name, item] of entries) {
    if (typeof name !== 'string' || !item) continue;
    tools.push({
      name,
      slug: toolSlug(name),
      ...optional('input', firstSchema(item, ['input_schema', 'inputSchema', 'parameters'])),
      ...optional('output', firstSchema(item, ['output_schema', 'outputSchema', 'returns'])),
    });
  }
  return { ok: true, tools };
}

function optional(key: 'input' | 'output', schema: JsonSchema | undefined): Partial<ToolSchema> {
  return schema === undefined ? {} : { [key]: schema };
}

function locate(raw: unknown): unknown[] | Record<string, unknown> | undefined {
  if (Array.isArray(raw)) return raw;
  if (!isPlainObject(raw)) return undefined;
  for (const key of ['tools', 'tool_schemas']) {
    const found = raw[key];
    if (Array.isArray(found) || isPlainObject(found)) return found;
  }
  const metadata = raw.metadata;
  if (isPlainObject(metadata)) {
    const nested = metadata.tool_schemas;
    if (Array.isArray(nested) || isPlainObject(nested)) return nested;
  }
  return undefined;
}

function unwrap(item: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(item)) return undefined;
  const inner = item.function;
  if (item.type === 'function' && isPlainObject(inner)) return inner as Record<string, unknown>;
  return item as Record<string, unknown>;
}

function firstSchema(item: Record<string, unknown>, keys: string[]): JsonSchema | undefined {
  for (const key of keys) {
    const found = item[key];
    if (isPlainObject(found)) return found as JsonSchema;
  }
  return undefined;
}

/**
 * Matches each data dimension to the tool property it was read from. The extractor names a dimension
 * `<toolSlug>.<in|out>.<property slugs joined by dots>`; the same slugs are recomputed here.
 */
function toolDimensionsOf(space: CompiledSpace, tools: ToolSchema[]): Map<number, ToolDimension> {
  const byId = new Map<string, ToolDimension>();
  for (const tool of tools) {
    for (const direction of ['in', 'out'] as const) {
      const schema = direction === 'in' ? tool.input : tool.output;
      if (schema) collect(tool, direction, schema, [], byId);
    }
  }
  const out = new Map<number, ToolDimension>();
  space.dimensions.forEach((dimension, index) => {
    if (dimension.kind !== 'data') return;
    const found = byId.get(dimension.id);
    if (found) out.set(index, found);
  });
  return out;
}

function collect(
  tool: ToolSchema,
  direction: 'in' | 'out',
  schema: JsonSchema,
  prefix: string[],
  byId: Map<string, ToolDimension>,
): void {
  const properties = schema.properties;
  if (!isPlainObject(properties) || prefix.length > 2) return;
  for (const [name, property] of Object.entries(properties)) {
    if (!isPlainObject(property)) continue;
    const path = [...prefix, name];
    const id = [tool.slug, direction, ...path.map(propertySlug)].join('.');
    if (!byId.has(id)) byId.set(id, { tool, direction, path, schema: property });
    collect(tool, direction, property, path, byId);
  }
}

/** The extractor's property slug (extract/tools.ts), recomputed: snake case, other characters to `_`. */
function propertySlug(name: string): string {
  const slug = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_');
  return slug === '' ? 'p' : slug;
}
