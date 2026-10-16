import type { Expect, GivenOverride, Spec } from '../schema/spec';
import { isPlainObject } from '../spec/normalize';
import { parseCriterionRef } from '../spec/semantics';

/**
 * What a block reads, so a change to the agent can be mapped to the blocks it can affect. Everything here
 * is read from what a spec already carries: its `expect`, its rules, its end state, its Given, the cells
 * the generator recorded (`metadata.generated`), the estate atoms (`metadata.estate.atoms`) and, for a
 * hand-written spec, what its author declared (`metadata.depends`). Nothing is run.
 */

/**
 * What a Then reads. The first group is observed state: what the agent called, the stage its runtime
 * reached, what it left in the world or the workspace. The second group reads the agent's own words.
 */
export const OBSERVED_FIELDS = [
  'tools',
  'stage',
  'end_state',
  'workspace',
  'artifacts',
  'skills',
  'guards',
  'execution',
  'safety',
  'cards',
  'custom',
] as const;
export const WORDING_FIELDS = ['text', 'lang', 'format'] as const;
export type ObservedField = (typeof OBSERVED_FIELDS)[number];
export type WordingField = (typeof WORDING_FIELDS)[number];
export type ThenField = ObservedField | WordingField;

/** The fields the Then of block `index` reads, in a fixed order. Judged criteria read none. */
export function thenFields(spec: Spec, index: number): ThenField[] {
  const expect: Expect = spec.blocks[index]?.expect ?? {};
  const fields = new Set<ThenField>();
  if ((expect.tools?.length ?? 0) > 0 || expect.tool_order !== undefined) fields.add('tools');
  if (expect.stage !== undefined || expect.stage_reported === true) fields.add('stage');
  if ((expect.must?.length ?? 0) > 0 || (expect.must_not?.length ?? 0) > 0) fields.add('text');
  if (expect.lang !== undefined) fields.add('lang');
  if ((expect.cards?.length ?? 0) > 0) fields.add('cards');
  if ((expect.skills?.length ?? 0) > 0) fields.add('skills');
  if ((expect.guards?.length ?? 0) > 0) fields.add('guards');
  if (expect.execution !== undefined) fields.add('execution');
  if ((expect.artifacts?.length ?? 0) > 0) fields.add('artifacts');
  if (expect.workspace !== undefined) fields.add('workspace');
  if (expect.safety !== undefined) fields.add('safety');
  const rules = spec.rules;
  if (rules) {
    if (Object.keys(rules.max_calls ?? {}).length > 0 || (rules.forbidden_tools?.length ?? 0) > 0) {
      fields.add('tools');
    }
    if (rules.lang_stable === true) fields.add('lang');
    if (rules.one_message_per_turn === true) fields.add('format');
    if (Object.keys(rules.custom ?? {}).length > 0) fields.add('custom');
  }
  if (spec.end_state !== undefined && index === spec.blocks.length - 1) fields.add('end_state');
  const order: readonly ThenField[] = [...OBSERVED_FIELDS, 'text', 'lang', 'format'];
  return order.filter((field) => fields.has(field));
}

/** The generator's record of a spec, when a generator wrote it. */
export function generatedMeta(spec: Spec): Record<string, unknown> | undefined {
  const generated = spec.metadata?.generated;
  return isPlainObject(generated) ? generated : undefined;
}

function stringRecord(value: unknown, skip?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPlainObject(value)) return out;
  for (const [key, each] of Object.entries(value)) {
    if (key !== skip && (typeof each === 'string' || typeof each === 'number')) out[key] = String(each);
  }
  return out;
}

function generatedBlock(spec: Spec, index: number): Record<string, unknown> | undefined {
  const blocks = generatedMeta(spec)?.blocks;
  if (!Array.isArray(blocks)) return undefined;
  const id = spec.blocks[index]?.id;
  const entry = blocks.find((each) => isPlainObject(each) && id !== undefined && each.block === id);
  return isPlainObject(entry) ? entry : undefined;
}

/**
 * The block's own cell: the slot its When was phrased from, as the generator recorded it (the
 * `metadata.generated.blocks[].cell` entry without its `spec` pointer). Empty for a hand-written block.
 */
export function blockCell(spec: Spec, index: number): Record<string, string> {
  return stringRecord(generatedBlock(spec, index)?.cell, 'spec');
}

/** The deviation class a block carries: its injection's class, else the one its cell names. */
export function deviationOf(spec: Spec, index: number): string | undefined {
  const when = spec.blocks[index]?.when;
  if (when && 'injection' in when) return when.injection.class;
  return blockCell(spec, index).deviation;
}

/** One tool a block's Then lists. `zero` is a tool the block says must not be called. */
export type ToolDependency = {
  label: string;
  count: 'zero' | 'some';
  /** True when the block asserts on the call's input. */
  input: boolean;
};

export type BlockDependencies = {
  /** The Then fields the block reads, as the gate names them. */
  fields: ThenField[];
  /** The tools the block's own `expect.tools` lists, count 0 included. */
  tools: ToolDependency[];
  /** Tools named by `expect.tools_offered`. */
  toolsOffered: string[];
  /** Tools the Given forces a result or an error for, at this block: the spec's and every block's up to it. */
  toolsForced: string[];
  /** Tools `rules.max_calls` caps, on every block of the spec. A cap of 0 forbids the tool. */
  toolsCapped: string[];
  /** Tools `rules.forbidden_tools` or a cap of 0 forbids, on every block of the spec. */
  toolsForbidden: string[];
  /** Tools whose recorded payload the end state reads (`tool:<name>`), on the last block only. */
  toolsEndState: string[];
  /** The stages the block reads: its expected stage, and the stages its cell and its transition name. */
  stages: string[];
  /** The spec rules that hold on the block: `lang_stable`, `max_calls`, `forbidden_tools`, `custom.<name>`. */
  rules: string[];
  /** The judged criteria the block names. */
  criteria: string[];
  /** The estate atoms the spec covers, and whether the spec says so at all. */
  atoms: string[];
  atomsKnown: boolean;
  /** The map cell: the spec's cell with the block's own on top. Empty when no generator recorded one. */
  cell: Record<string, string>;
  cellKnown: boolean;
  /** The phrase the When was taken from: a dimension and a value of the map. */
  phrase?: { dimension: string; value: string };
  /** The approved path the spec walks, and its flow. */
  path?: string;
  flow?: string;
  /** The deviation class the block carries. */
  deviation?: string;
  /** Named fixtures: world store keys, fixture names, workspace files, `family:<id>`, and declared ones. */
  fixtures: string[];
  /** Every literal the When, the expected inputs, the Given and the end state hold, as one text to search. */
  literals: string;
  /**
   * True when nothing says what the block depends on beyond its own Then: a hand-written spec with no
   * generator record, no estate atoms and no `metadata.depends`. An unknown block is in every radius.
   */
  unknown: boolean;
};

const DECLARED = ['tools', 'stages', 'rules', 'atoms', 'fixtures'] as const;

function declared(spec: Spec): Record<(typeof DECLARED)[number], string[]> | undefined {
  const depends = spec.metadata?.depends;
  if (!isPlainObject(depends)) return undefined;
  const out = { tools: [], stages: [], rules: [], atoms: [], fixtures: [] } as Record<
    (typeof DECLARED)[number],
    string[]
  >;
  for (const key of DECLARED) {
    const value = depends[key];
    if (Array.isArray(value)) out[key] = value.filter((each): each is string => typeof each === 'string');
  }
  return out;
}

function estateAtoms(spec: Spec): string[] | undefined {
  const estate = spec.metadata?.estate;
  const atoms = isPlainObject(estate) ? estate.atoms : undefined;
  return Array.isArray(atoms) ? atoms.filter((each): each is string => typeof each === 'string') : undefined;
}

function countOf(count: unknown): 'zero' | 'some' {
  if (count === undefined) return 'some';
  if (typeof count === 'number') return count === 0 ? 'zero' : 'some';
  return isPlainObject(count) && count.max === 0 ? 'zero' : 'some';
}

const unique = (values: Iterable<string>): string[] => [...new Set(values)];

/** What block `index` of a spec depends on. See the fields of `BlockDependencies`. */
export function blockDependencies(spec: Spec, index: number): BlockDependencies {
  const block = spec.blocks[index];
  const expect: Expect = block?.expect ?? {};
  const last = index === spec.blocks.length - 1;
  const generated = generatedMeta(spec);
  const own = declared(spec);
  const atoms = estateAtoms(spec);

  const tools: ToolDependency[] = (expect.tools ?? []).map((tool) => ({
    label: tool.label,
    count: countOf(tool.count),
    input: tool.input !== undefined || tool.input_closed === true,
  }));
  for (const label of own?.tools ?? []) {
    if (!tools.some((tool) => tool.label === label)) tools.push({ label, count: 'some', input: true });
  }

  // The Given at this block: the spec's own, then every block's up to this one, as a run merges them.
  const givens: (GivenOverride | undefined)[] = [
    spec.given,
    ...spec.blocks.slice(0, index + 1).map((each) => each.given),
  ];
  const worlds = givens.flatMap((given) => (given?.world ? [given.world] : []));
  const toolsForced = unique(worlds.flatMap((world) => Object.keys(world.tools ?? {})));

  const rules: string[] = [];
  const ruled = spec.rules;
  if (ruled) {
    if (Object.keys(ruled.max_calls ?? {}).length > 0) rules.push('max_calls');
    if ((ruled.forbidden_tools?.length ?? 0) > 0) rules.push('forbidden_tools');
    if (ruled.lang_stable === true) rules.push('lang_stable');
    if (ruled.one_message_per_turn === true) rules.push('one_message_per_turn');
    if (ruled.match_case === true) rules.push('match_case');
    for (const name of Object.keys(ruled.custom ?? {})) rules.push(`custom.${name}`);
  }

  const endStates =
    !last || spec.end_state === undefined || spec.end_state === 'none'
      ? []
      : Array.isArray(spec.end_state)
        ? spec.end_state
        : [spec.end_state];

  const ownCell = blockCell(spec, index);
  const specCell = stringRecord(generated?.cell);
  const cell = { ...specCell, ...ownCell };
  const stages = new Set<string>(own?.stages ?? []);
  if (expect.stage !== undefined) stages.add(expect.stage);
  if (ownCell.stage !== undefined) stages.add(ownCell.stage);
  for (const stage of (ownCell.stage_transition ?? '').split('-to-')) if (stage !== '') stages.add(stage);

  const phrase = generatedBlock(spec, index)?.phrase;
  const flowTag = (spec.tags ?? []).find((tag) => tag.startsWith('flow:'))?.slice('flow:'.length);
  const flow = cell.flow ?? flowTag;
  const path = typeof generated?.path === 'string' ? generated.path : undefined;
  const deviation = deviationOf(spec, index);

  const family = spec.metadata?.family;
  const fixtures = unique([
    ...worlds.flatMap((world) => [
      ...Object.keys(world.store ?? {}),
      ...Object.keys(world.fixtures ?? {}),
      ...Object.keys(world.workspace?.files ?? {}),
      ...Object.keys(world.workspace?.binary ?? {}),
      ...(world.workspace?.from === undefined ? [] : [world.workspace.from]),
    ]),
    ...(isPlainObject(family) && typeof family.id === 'string' ? [`family:${family.id}`] : []),
    ...(spec.tags ?? []).filter((tag) => tag.startsWith('family:')),
    ...(own?.fixtures ?? []),
  ]);

  const literals = JSON.stringify([
    block?.when,
    (expect.tools ?? []).map((tool) => tool.input),
    givens.map((given) => [given?.world, given?.ledger, given?.vars, given?.prefix]),
    endStates.map((state) => state.expect),
  ]);

  return {
    fields: thenFields(spec, index),
    tools,
    toolsOffered: unique([
      ...(expect.tools_offered?.include ?? []),
      ...(expect.tools_offered?.exclude ?? []),
    ]),
    toolsForced,
    toolsCapped: Object.entries(ruled?.max_calls ?? {}).flatMap(([label, max]) => (max > 0 ? [label] : [])),
    toolsForbidden: unique([
      ...(ruled?.forbidden_tools ?? []),
      ...Object.entries(ruled?.max_calls ?? {}).flatMap(([label, max]) => (max === 0 ? [label] : [])),
    ]),
    toolsEndState: unique(
      endStates.flatMap((state) =>
        state.source.startsWith('tool:') ? [state.source.slice('tool:'.length)] : [],
      ),
    ),
    stages: [...stages],
    rules: unique([...rules, ...(own?.rules ?? [])]),
    criteria: unique((expect.criteria ?? []).map((ref) => parseCriterionRef(ref)?.name ?? ref)),
    atoms: unique([...(atoms ?? []), ...(own?.atoms ?? [])]),
    atomsKnown: atoms !== undefined || (own?.atoms.length ?? 0) > 0,
    cell,
    cellKnown: Object.keys(cell).length > 0,
    ...(isPlainObject(phrase) && typeof phrase.dimension === 'string' && typeof phrase.value === 'string'
      ? { phrase: { dimension: phrase.dimension, value: phrase.value } }
      : {}),
    ...(path === undefined ? {} : { path }),
    ...(flow === undefined ? {} : { flow }),
    ...(deviation === undefined ? {} : { deviation }),
    fixtures,
    literals,
    unknown: generated === undefined && atoms === undefined && own === undefined,
  };
}
