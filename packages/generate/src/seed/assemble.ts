import type {
  CriterionDef,
  EndStateSpec,
  Expect,
  GuardExpect,
  PerturbationSpec,
  Rules,
  ToolExpect,
  WorldState,
} from '@agent-nexus/driftbench-core';
import { isPlainObject } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { ProposalPhrase } from '../extract/proposal';
import { supplying, usedPaths, worldCarried } from './data-carrier';
import { DEVIATION_EXPECTED, isDeviationClass } from './deviation';
import { dimensionId, type PreparedMap, phraseKey, valueId } from './map';
import { pick, type Rng } from './random';
import { stringifyGeneratedYaml } from './yaml';

/**
 * Turns a seeder's draft into a driftbench spec. A draft names values by index; the spec names them the
 * way `@agent-nexus/driftbench-space` places a spec: behaviour values in `covers`, persona, data and task values as
 * `persona:<id>`, `data:<id>` and `task:<id>` tags, the channel in `channel`, the stage in `expect.stage`,
 * the deviation as an injection block or a perturbation. The user turns are approved phrases, picked by
 * the seeded stream; a block whose cell has none gets a placeholder that fails lint.
 */

/**
 * The seeders, in the order they run. `task` writes nothing itself: it places the specs the map's task
 * families built (`task_family`). `cover` runs last: it builds one scenario for each allowed cell of the
 * axis map that no complete spec of the others covers.
 */
export const SEEDERS = ['graph', 'twise', 'boundary', 'deviation', 'metamorphic', 'task', 'cover'] as const;
export type Seeder = (typeof SEEDERS)[number];

/** A dimension index and a value index. */
export type Pick = readonly [dimension: number, value: number];

/** The user turn of a block: an approved phrase, or a placeholder naming the value that has none. */
export type Stimulus =
  | { kind: 'phrase'; phrase: ProposalPhrase }
  | { kind: 'placeholder'; dimension: string; value: string };

export type BlockDraft = {
  /** Unique in the spec. */
  id: string;
  stimulus: Stimulus;
  /** The deviation class when the block is an injection. */
  injection?: string;
  /** The stage the block must reach. */
  stage?: string;
  /** The stage a deviation is said at; move cells record the stage they reach instead. */
  saidAt?: string;
  /** Values the block itself carries (the stimulus value, an injected class), as picks. */
  carries: Pick[];
  given?: { world?: WorldState };
  tools?: ToolExpect[];
  guards?: GuardExpect[];
  must?: string[];
  must_not?: string[];
  lang?: string;
  /** Names of draft criteria (defined on the spec) the block references. */
  criteria?: string[];
};

export type SpecDraft = {
  id: string;
  seeder: Seeder;
  title: string;
  /** The integer seed of the spec's own stream. */
  stream: number;
  /** Spec-level values: placed through covers, tags and channel. Stage and deviation picks are ignored. */
  cell: Pick[];
  blocks: BlockDraft[];
  world?: WorldState;
  /** Numeric budget settings the runner delivers to the adapter. */
  vars?: Record<string, number>;
  perturbations?: PerturbationSpec[];
  rules?: Rules;
  criteria: CriterionDef[];
  /** Concrete boundary values, by data value id. */
  concrete?: Record<string, unknown>;
  metamorphic?: { family: string; variant: number; of: number; relation: string };
  /** What the store holds after the last block, derived from the path's end state. */
  end_state?: EndStateSpec;
  /** The path relation the spec walks, when it walks one. */
  path?: string;
  /** Why the map supports no machine Then for the spec: it goes to incomplete/ with these reasons. */
  reasons?: string[];
};

/** The criterion a placeholder block references; it is never defined, so `lintSpec` flags the spec. */
export const PLACEHOLDER_CRITERION = 'needs-approved-phrase';

/**
 * The criterion a block references when the map supports no machine Then for it (no stage, no tool call,
 * no guard, no end state): judged criteria alone are not enough. Such a block is reported with the reason,
 * never shipped as complete.
 */
export const NO_THEN_CRITERION = 'needs-derivable-then';

const MARKERS: ReadonlySet<string> = new Set([PLACEHOLDER_CRITERION, NO_THEN_CRITERION]);

/** The user text of a placeholder. */
export function placeholderText(dimension: string, value: string): string {
  return `[no approved phrase for ${dimension}=${value}]`;
}

/**
 * Picks the user turn among the approved phrases of the candidate values, with the stream; a placeholder
 * for the first candidate when none of them has an approved phrase.
 */
export function choosePhrase(prepared: PreparedMap, rng: Rng, candidates: readonly Pick[]): Stimulus {
  const phrases = candidates.flatMap(
    ([dimension, value]) =>
      prepared.phrasesOf.get(
        phraseKey(dimensionId(prepared, dimension), valueId(prepared, dimension, value)),
      ) ?? [],
  );
  const phrase = pick(rng, phrases);
  if (phrase) return { kind: 'phrase', phrase };
  const [dimension, value] = candidates[0] ?? [-1, -1];
  return {
    kind: 'placeholder',
    dimension: dimensionId(prepared, dimension),
    value: valueId(prepared, dimension, value),
  };
}

/** The pick a phrase expresses. */
export function pickOf(prepared: PreparedMap, phrase: ProposalPhrase): Pick | undefined {
  const dimension = prepared.space.dimensions.findIndex((candidate) => candidate.id === phrase.dimension);
  const value = prepared.space.dimensions[dimension]?.index.get(phrase.value);
  return dimension < 0 || value === undefined ? undefined : [dimension, value];
}

/**
 * A judged criterion drafted from an approved value title: the rubric is the title a person approved,
 * word for word. Not gating: no judge owns it yet (a fixture pair and kappa 0.8 come first).
 */
export function draftCriterion(prepared: PreparedMap, [dimension, value]: Pick): CriterionDef {
  const dimensionKey = dimensionId(prepared, dimension);
  const id = valueId(prepared, dimension, value);
  const title = prepared.space.dimensions[dimension]?.values[value]?.title ?? id;
  return {
    name: `${dimensionKey}.${id}`,
    rubric: title,
    gating: false,
    scope: 'conversation',
  };
}

/** The judged criterion of a deviation class, from its definition in the spec reference. Not gating. */
export function deviationCriterion(deviation: string): CriterionDef {
  const expected = isDeviationClass(deviation) ? DEVIATION_EXPECTED[deviation] : deviation;
  return { name: `deviation.${deviation}`, rubric: expected, gating: false, scope: 'block' };
}

/** The language of the approved phrase bank: the most frequent `lang`, ties to the first met. */
export function bankLanguage(prepared: PreparedMap): string | undefined {
  const counts = new Map<string, number>();
  for (const phrase of prepared.phrases) counts.set(phrase.lang, (counts.get(phrase.lang) ?? 0) + 1);
  let best: string | undefined;
  for (const [lang, count] of counts) if (best === undefined || count > (counts.get(best) ?? 0)) best = lang;
  return best;
}

export type RunIdentity = { seed: number; mapPath: string };

export type Rendered = {
  id: string;
  seeder: Seeder;
  /** The spec as a plain object, before YAML. */
  spec: Record<string, unknown>;
  /** The values with no approved phrase that got a placeholder. */
  placeholders: Array<{ dimension: string; value: string }>;
  /** The blocks the map supports no machine Then for. */
  noThen: string[];
  /** Why, when the generator could not build the spec from a path. */
  reasons: string[];
  blocks: number;
};

// Only fresh objects allocated by this renderer are marked, never values supplied by the map or
// draft. The disk/eager generation paths serialize them before they can escape to a caller.
const plainNodes = new WeakMap<Rendered, ReadonlySet<object>>();

/** Builds the spec object of a draft. Pure. */
export function renderDraft(prepared: PreparedMap, draft: SpecDraft, run: RunIdentity): Rendered {
  const covers: string[] = [];
  const tags: string[] = [];
  let channel: string | undefined;
  const specCell: Record<string, string> = {};
  for (const [dimension, value] of draft.cell) {
    const compiled = prepared.space.dimensions[dimension];
    const id = valueId(prepared, dimension, value);
    if (!compiled || id === '') continue;
    if (compiled.kind === 'stage' || compiled.kind === 'deviation') continue;
    const previous = specCell[compiled.id];
    if (previous === undefined) specCell[compiled.id] = id;
    else {
      const listed = previous.split(' + ');
      if (!listed.includes(id)) listed.push(id);
      specCell[compiled.id] = listed.join(' + ');
    }
    if (id === NONE) continue;
    // A value that is an inventory flow gets the core's flow tag, so `spec coverage` joins it.
    const flowTag = `flow:${id}`;
    if (compiled.kind === 'behaviour' && prepared.inventory?.flows.some((flow) => flow.id === id)) {
      if (!tags.includes(flowTag)) tags.push(flowTag);
    }
    // Only axis values are placed: a detail lives inside the cell, in the record and the Given. A task
    // setting is never placed on a conversation.
    if (!prepared.axes.has(dimension) || compiled.kind === 'task') continue;
    if (compiled.kind === 'behaviour') {
      if (!covers.includes(id)) covers.push(id);
    } else if (compiled.kind === 'channel') channel = id;
    else {
      const tag = `${compiled.kind}:${id}`;
      if (!tags.includes(tag)) tags.push(tag);
    }
  }

  const placeholders: Array<{ dimension: string; value: string }> = [];
  const noThen: string[] = [];
  const firstPhrase = draft.blocks.find((block) => block.stimulus.kind === 'phrase' && !block.injection);
  const declared =
    firstPhrase?.stimulus.kind === 'phrase' ? firstPhrase.stimulus.phrase.lang : bankLanguage(prepared);
  const lang = declared?.toUpperCase();

  const ruled =
    (draft.rules?.forbidden_tools?.length ?? 0) > 0 || Object.keys(draft.rules?.max_calls ?? {}).length > 0;
  // A class carried in the world arrives as supplied data: the approved instruction is a file's content and
  // the turn says nothing. A written workspace replaces the one before it, so the world each block starts
  // from is kept: `held[i]` is the workspace before block i. The file is part of the world for its own turn
  // only: the next block returns to the workspace before it, so each later turn is judged as it was planned.
  const used = usedPaths(draft.world, draft.blocks, draft.perturbations);
  const deviationId =
    prepared.deviation === undefined ? undefined : dimensionId(prepared, prepared.deviation);
  const held: Array<NonNullable<WorldState['workspace']> | undefined> = [draft.world?.workspace];
  let restore: NonNullable<WorldState['workspace']> | undefined;
  const blocks = draft.blocks.map((block, position) => {
    const text =
      block.stimulus.kind === 'phrase'
        ? block.stimulus.phrase.text
        : placeholderText(block.stimulus.dimension, block.stimulus.value);
    if (block.stimulus.kind === 'placeholder') {
      placeholders.push({ dimension: block.stimulus.dimension, value: block.stimulus.value });
    }
    const expect: Expect = {};
    if (block.stage !== undefined) {
      expect.stage = block.stage;
      expect.stage_reported = true;
    }
    if (block.tools && block.tools.length > 0) expect.tools = closeKnownInputs(prepared, block.tools);
    if (block.guards && block.guards.length > 0) expect.guards = block.guards;
    if (block.must && block.must.length > 0) expect.must = block.must;
    if (block.must_not && block.must_not.length > 0) expect.must_not = block.must_not;
    if (block.lang !== undefined) expect.lang = block.lang;
    const criteria = [...(block.criteria ?? [])];
    // A machine Then reads observed state: the stage, the calls, a guard, or the end state on the last block.
    const observed =
      expect.stage !== undefined ||
      (expect.tools?.length ?? 0) > 0 ||
      (expect.guards?.length ?? 0) > 0 ||
      ruled ||
      (draft.end_state !== undefined && position === draft.blocks.length - 1);
    if (!observed) {
      criteria.push(NO_THEN_CRITERION);
      noThen.push(block.id);
    }
    if (block.stimulus.kind === 'placeholder') criteria.push(PLACEHOLDER_CRITERION);
    if (criteria.length > 0) expect.criteria = criteria;
    const supplied =
      worldCarried(block.injection) &&
      block.stimulus.kind === 'phrase' &&
      block.stimulus.phrase.dimension === deviationId &&
      block.stimulus.phrase.value === block.injection;
    const written = block.given?.world?.workspace ?? restore;
    const workspace = supplied ? supplying(written ?? held[position], used, text) : written;
    restore = supplied ? (written ?? held[position] ?? { files: {} }) : undefined;
    const given =
      workspace === undefined ? block.given : { ...block.given, world: { ...block.given?.world, workspace } };
    held.push(workspace ?? held[position]);
    return {
      id: block.id,
      when: block.injection
        ? { injection: { class: block.injection, user: supplied ? '' : text } }
        : { user: text },
      ...(given ? { given } : {}),
      expect,
    };
  });

  const reasons = [...(draft.reasons ?? [])];
  const incomplete = placeholders.length > 0 || noThen.length > 0 || reasons.length > 0;
  // An incomplete spec defines no criterion, so the undefined marker reference is a lint warning and never
  // a semantic error; its draft criteria are dropped with it. A block left with nothing to check carries
  // the marker that keeps the spec incomplete.
  if (incomplete) {
    const marker = placeholders.length > 0 ? PLACEHOLDER_CRITERION : NO_THEN_CRITERION;
    if (reasons.length > 0 && noThen.length === 0 && placeholders.length === 0) {
      noThen.push(...blocks.map((block) => block.id));
      for (const block of blocks) block.expect.criteria = [NO_THEN_CRITERION];
    }
    for (const block of blocks) {
      const kept = (block.expect.criteria ?? []).filter((name) => MARKERS.has(name));
      if (kept.length > 0) block.expect.criteria = kept;
      else delete block.expect.criteria;
      if (Object.keys(block.expect).length === 0) block.expect.criteria = [marker];
    }
  }
  const perturbations = draft.perturbations?.map((perturbation) => {
    // A world-carried class written as a message only: the message is the supplied data, sent in a turn
    // that says nothing, with the world as it is at the injected block.
    if (
      worldCarried(perturbation.class) &&
      perturbation.user !== undefined &&
      perturbation.world === undefined
    ) {
      perturbation = {
        ...perturbation,
        user: '',
        world: { workspace: supplying(held[perturbation.inject_at], used, perturbation.user) },
      };
    }
    if (perturbation.expect?.tools) {
      perturbation = {
        ...perturbation,
        expect: { ...perturbation.expect, tools: closeKnownInputs(prepared, perturbation.expect.tools) },
      };
    }
    if (!incomplete || !perturbation.expect?.criteria) return perturbation;
    const { criteria: _dropped, ...expect } = perturbation.expect;
    return { ...perturbation, expect };
  });

  const usesStages =
    draft.blocks.some((block) => block.stage !== undefined) ||
    (draft.perturbations ?? []).some((p) => p.expect?.stage !== undefined || p.recovery?.stage_after);
  const stages =
    usesStages && prepared.stage !== undefined
      ? (prepared.space.dimensions[prepared.stage]?.values.map((value) => value.id) ?? [])
      : undefined;

  // A block's cell is the spec's cell plus the values the block adds: its stage, its deviation, the value
  // its phrase expresses. The spec's cell is written once; each block lists what it adds.
  const blockRecords = draft.blocks.map((block) => {
    const cell: Record<string, string> = {};
    for (const [dimension, value] of block.carries) {
      cell[dimensionId(prepared, dimension)] = valueId(prepared, dimension, value);
    }
    if (block.stage !== undefined && prepared.stage !== undefined) {
      // A move is an event at its destination. A deviation is an event where it is injected, even
      // when its recovery reaches another stage. Keep the same convention as reachability.
      cell[dimensionId(prepared, prepared.stage)] =
        (block.injection ? block.saidAt : undefined) ?? block.stage;
    }
    return {
      block: block.id,
      seeder: draft.seeder,
      cell: { spec: 'metadata.generated.cell', ...cell },
      phrase:
        block.stimulus.kind === 'phrase'
          ? { dimension: block.stimulus.phrase.dimension, value: block.stimulus.phrase.value }
          : null,
    };
  });

  const spec: Record<string, unknown> = {
    id: draft.id,
    version: prepared.hash,
    kind: 'conversation',
    title: draft.title,
  };
  if (channel !== undefined) spec.channel = channel;
  if (lang !== undefined) spec.lang = lang;
  spec.tier = 'generated';
  if (tags.length > 0) spec.tags = tags;
  if (covers.length > 0) spec.covers = covers;
  if (draft.world || draft.vars) {
    const given: Record<string, unknown> = {};
    if (draft.world) given.world = draft.world;
    if (draft.vars) given.vars = draft.vars;
    spec.given = given;
  }
  if (stages) spec.stages = stages;
  if (!incomplete && draft.criteria.length > 0) spec.criteria = draft.criteria;
  spec.blocks = blocks;
  // One reply per user turn unless the map says otherwise (`reply_count`), so a doubled reply fails.
  if (prepared.relations.repliesPerTurn === 'one')
    spec.rules = { ...(draft.rules ?? {}), one_message_per_turn: true };
  else if (draft.rules) spec.rules = draft.rules;
  if (draft.end_state) spec.end_state = draft.end_state;
  if (perturbations && perturbations.length > 0) spec.perturbations = perturbations;
  const generated: Record<string, unknown> = {
    by: 'driftbench generate',
    seeder: draft.seeder,
    seed: run.seed,
    stream: draft.stream,
    map: { path: run.mapPath, agent: prepared.agent, version: prepared.version, hash: prepared.hash },
  };
  if (draft.path) generated.path = draft.path;
  generated.cell = specCell;
  generated.blocks = blockRecords;
  if (draft.concrete) generated.concrete = draft.concrete;
  if (draft.metamorphic) generated.metamorphic = draft.metamorphic;
  if (placeholders.length > 0) generated.needs_phrase = placeholders;
  if (noThen.length > 0) generated.needs_then = noThen;
  if (reasons.length > 0) generated.needs_then_why = reasons;

  spec.metadata = { generated };
  const rendered = {
    id: draft.id,
    seeder: draft.seeder,
    spec,
    placeholders,
    noThen,
    reasons,
    blocks: blocks.length,
  };
  const plain = new Set<object>([
    spec,
    specCell,
    covers,
    tags,
    blocks,
    blockRecords,
    placeholders,
    noThen,
    reasons,
  ]);
  if (stages) plain.add(stages);
  if (perturbations) plain.add(perturbations);
  if (spec.given) plain.add(spec.given as object);
  const metadata = spec.metadata as { generated: { map: object } };
  plain.add(metadata);
  plain.add(metadata.generated);
  plain.add(metadata.generated.map);
  for (const block of blocks) {
    plain.add(block);
    plain.add(block.when);
    if (block.when.injection) plain.add(block.when.injection);
    plain.add(block.expect);
    if (block.expect.criteria) plain.add(block.expect.criteria);
    if (block.expect.tools) plain.add(block.expect.tools);
  }
  for (const record of blockRecords) {
    plain.add(record);
    plain.add(record.cell);
    if (record.phrase) plain.add(record.phrase);
  }
  for (const placeholder of placeholders) plain.add(placeholder);
  plainNodes.set(rendered, plain);
  return rendered;
}

/** A partial map assertion cannot establish that other schema-declared arguments are forbidden. */
function closeKnownInputs(prepared: PreparedMap, tools: ToolExpect[]): ToolExpect[] {
  return tools.map((tool) => {
    if (tool.input_closed !== true) return tool;
    const properties = prepared.tools.find((entry) => entry.name === tool.label)?.input?.properties;
    if (
      isPlainObject(properties) &&
      Object.keys(properties).every((key) => Object.hasOwn(tool.input ?? {}, key))
    )
      return tool;
    const { input_closed: _closed, ...partial } = tool;
    return partial;
  });
}

/** The YAML text of a rendered spec, with a header. Deterministic: no clock, no absolute path. */
export function specText(rendered: Rendered, run: RunIdentity, hash: string): string {
  plainNodes.delete(rendered);
  return renderedText(rendered, run, hash);
}

/** Internal generation path: called before any of the renderer's fresh objects escape. */
export function generatedSpecText(rendered: Rendered, run: RunIdentity, hash: string): string {
  const plain = plainNodes.get(rendered);
  plainNodes.delete(rendered);
  return renderedText(rendered, run, hash, plain);
}

function renderedText(
  rendered: Rendered,
  run: RunIdentity,
  hash: string,
  plain?: ReadonlySet<object>,
): string {
  const header = [
    `# Generated by driftbench generate (seeder ${rendered.seeder}, seed ${run.seed}) from ${run.mapPath}, map hash ${hash}.`,
    '# Code wrote it from the approved map: the user turns are approved phrases, the Then comes from the map.',
    '# Do not edit it by hand: change the map and generate again. Fictional data only.',
  ];
  if (rendered.placeholders.length > 0) {
    header.push(
      `# Not runnable yet: ${rendered.placeholders.length} block(s) wait for an approved phrase (see metadata.generated.needs_phrase).`,
    );
  }
  if (rendered.noThen.length > 0) {
    header.push(
      `# Not runnable yet: the map supports no machine Then for ${rendered.noThen.length} block(s) (see metadata.generated.needs_then).`,
    );
  }
  for (const reason of rendered.reasons) header.push(`# Why: ${reason}.`);
  const body = stringifyGeneratedYaml(rendered.spec, plain);
  return `${header.join('\n')}\n${body}`;
}
