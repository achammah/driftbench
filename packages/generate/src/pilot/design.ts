import { cloneJson, type LoadedSpec, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import type { Slots, When } from '../extract/proposal';
import { TRANSITION_DIMENSION } from '../seed/map';
import { fillText, matches } from '../seed/relations';

const STAGE = 'stage';

/**
 * The pilot design: per cell of the approved map, up to C conversations of the generated suite, each run
 * through up to W approved wordings, each wording repeated R times. A conversation is one generated spec.
 * A wording is one choice of approved phrase for every block that carries a phrase; wording 0 is the spec
 * as generated. The factors (cell, conversation, wording) ride on every variant spec under
 * `metadata.pilot`, so every stored run names them through its spec id and hash.
 */

export type PilotOptions = {
  /** Conversations per cell, at most. Default 10. */
  conversations?: number;
  /** Runs per wording. Default 5. */
  repeats?: number;
  /** Wordings per conversation, at most. Default 3. */
  wordings?: number;
  /**
   * The dimensions whose values name a cell, in order. Default ['behaviour']: the first axis of the
   * approved map, the one the generated suite fills with about ten conversations per value.
   */
  by?: readonly string[];
};

/** The phrase bank and identity of an approved map, as the pilot reads them. */
export type PilotMap = {
  path: string;
  agent: string;
  hash: string;
  /** Approved phrases by `dimension=value`, in file order. */
  phrasesOf: ReadonlyMap<string, ReadonlyArray<PilotPhrase>>;
  /**
   * The slot values each cell value binds (`dimension=value` to slots), the map's approved `binds`
   * relations. A phrase's `{slot}` is filled from these, then from the binds of the phrases said before it.
   */
  binds?: ReadonlyMap<string, Slots>;
};

/** An approved phrase as the pilot reads it: its text with `{slot}`s, the cells it fits, the slots it states. */
export type PilotPhrase = { text: string; lang?: string; when?: When; binds?: Slots };

/** The factors a variant spec carries under `metadata.pilot`. */
export type PilotFactors = {
  cell: string;
  conversation: string;
  wording: number;
  map: string;
  /** Conversations of the suite in the cell: the stratum size the allocation weighs by. */
  suite: number;
};

/** A block whose text changes from one wording to the next. */
export type PhrasedBlock = {
  index: number;
  blockId: string;
  dimension: string;
  value: string;
  /** The texts this block takes: the generated one first, then every other approved phrase. */
  options: string[];
  /** The workspace file that carries the text, for a block whose turn says nothing (data carried in the world). */
  file?: string;
};

export type PilotVariant = {
  wording: number;
  /** The option chosen per phrased block, in block order. */
  choice: number[];
  loaded: LoadedSpec;
};

export type PilotConversation = {
  /** The id of the generated spec. */
  conversation: string;
  path: string;
  blocks: number;
  phrased: PhrasedBlock[];
  /** How many distinct wordings the approved phrase bank gives this conversation. */
  available: number;
  variants: PilotVariant[];
};

export type PilotCell = {
  cell: string;
  values: Record<string, string>;
  /** Conversations of the suite in this cell; the pilot takes the first `conversations` of them by id. */
  suite: number;
  conversations: PilotConversation[];
};

export type PilotDesign = {
  map: { path: string; agent: string; hash: string };
  options: Required<PilotOptions>;
  cells: PilotCell[];
  /** Specs of the suite the pilot leaves out, with the reason. */
  skipped: Array<{ spec: string; reason: string }>;
  warnings: string[];
};

export const PILOT_DEFAULTS: Required<PilotOptions> = {
  conversations: 10,
  repeats: 5,
  wordings: 3,
  by: ['behaviour'],
};

type GeneratedBlock = {
  block?: unknown;
  cell?: Record<string, unknown>;
  phrase?: { dimension?: unknown; value?: unknown };
};
type Generated = {
  cell?: Record<string, unknown>;
  blocks?: GeneratedBlock[];
  map?: { hash?: unknown };
};

/** The cell name of a set of values: `behaviour=B-001`, or `behaviour=B-001,channel=chat`. */
export function cellName(by: readonly string[], values: Record<string, string>): string {
  return by.map((dimension) => `${dimension}=${values[dimension] ?? '-'}`).join(',');
}

/**
 * Builds the pilot design from the approved map's phrase bank and the generated suite. Cells are named
 * by the `by` dimensions of each spec's generated cell (a spec without one of them gets `-`); cells and
 * conversations come in id order, so the same suite gives the same design.
 */
export function designPilot(
  map: PilotMap,
  suite: readonly LoadedSpec[],
  options: PilotOptions = {},
): PilotDesign {
  const resolved: Required<PilotOptions> = {
    conversations: options.conversations ?? PILOT_DEFAULTS.conversations,
    repeats: options.repeats ?? PILOT_DEFAULTS.repeats,
    wordings: options.wordings ?? PILOT_DEFAULTS.wordings,
    by: [...(options.by ?? PILOT_DEFAULTS.by)],
  };
  for (const [name, value] of [
    ['conversations', resolved.conversations],
    ['repeats', resolved.repeats],
    ['wordings', resolved.wordings],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`designPilot: ${name} must be a whole number of at least 1, got ${value}`);
    }
  }
  if (resolved.by.length === 0) throw new RangeError('designPilot: name at least one cell dimension');

  const skipped: PilotDesign['skipped'] = [];
  const warnings = new Set<string>();
  const byCell = new Map<string, { values: Record<string, string>; specs: LoadedSpec[] }>();
  const sorted = [...suite].sort((a, b) => compare(a.spec.id, b.spec.id));
  for (const entry of sorted) {
    const generated = generatedOf(entry.spec);
    if (entry.spec.kind === 'task') {
      // The pilot measures the spread of conversations over wordings; a task family has its own knobs.
      skipped.push({ spec: entry.spec.id, reason: 'a code-agent task: the pilot measures conversations' });
      continue;
    }
    if (!generated?.cell) {
      skipped.push({ spec: entry.spec.id, reason: 'not generated: it has no metadata.generated.cell' });
      continue;
    }
    const mapHash = generated.map?.hash;
    if (typeof mapHash === 'string' && mapHash !== map.hash) {
      warnings.add(
        `the suite was generated from map ${mapHash}, the pilot reads map ${map.hash}: phrases may not match`,
      );
    }
    const values: Record<string, string> = {};
    for (const dimension of resolved.by) {
      const value = generated.cell[dimension];
      values[dimension] = typeof value === 'string' ? value : '-';
    }
    const name = cellName(resolved.by, values);
    const held = byCell.get(name) ?? { values, specs: [] };
    held.specs.push(entry);
    byCell.set(name, held);
  }

  const cells: PilotCell[] = [...byCell.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([cell, { values, specs }]) => ({
      cell,
      values,
      suite: specs.length,
      conversations: specs
        .slice(0, resolved.conversations)
        .map((entry) => conversationOf(entry, cell, specs.length, map, resolved.wordings, warnings)),
    }));
  return {
    map: { path: map.path, agent: map.agent, hash: map.hash },
    options: resolved,
    cells,
    skipped,
    warnings: [...warnings].sort(),
  };
}

function conversationOf(
  entry: LoadedSpec,
  cell: string,
  suite: number,
  map: PilotMap,
  wordings: number,
  warnings: Set<string>,
): PilotConversation {
  const { spec } = entry;
  const generated = generatedOf(spec);
  const phrased: PhrasedBlock[] = [];
  const metas = (generated?.blocks ?? []).filter(
    (meta): meta is GeneratedBlock & { block: string } => typeof meta.block === 'string',
  );
  const base = stringsOf(generated?.cell);
  // The slots the cell's values bind, first value first, as the generator fills them.
  const slots: Record<string, string> = {};
  for (const [dimension, value] of Object.entries(base)) {
    for (const [slot, bound] of Object.entries(map.binds?.get(`${dimension}=${value}`) ?? {})) {
      if (slots[slot] === undefined) slots[slot] = bound;
    }
  }
  let reached: string | undefined;
  metas.forEach((meta, position) => {
    const transition = transitionOf(meta);
    // The stage a phrase is said at: a transition's own from-stage; any other block (a probe) is said at
    // the stage the previous transition reached, which is the next transition's from-stage.
    const stage =
      transition?.from ??
      reached ??
      metas
        .slice(position + 1)
        .map(transitionOf)
        .find((next) => next !== undefined)?.from;
    if (transition) reached = transition.to;
    const dimension = meta.phrase?.dimension;
    const value = meta.phrase?.value;
    if (typeof dimension !== 'string' || typeof value !== 'string') return;
    const index = spec.blocks.findIndex((block) => block.id === meta.block);
    const block = spec.blocks[index];
    if (!block) return;
    const said = stimulusText(block.when);
    if (said === undefined) return;
    const bank = map.phrasesOf.get(`${dimension}=${value}`) ?? [];
    if (bank.length === 0) {
      warnings.add(`${dimension}=${value} has no approved phrase in the map, so its block keeps one wording`);
    }
    const context: Record<string, string> = { ...base, ...stringsOf(meta.cell) };
    delete context.spec;
    if (stage !== undefined) context[STAGE] = stage;
    const filled = (phrase: PilotPhrase): string | undefined => {
      const result = fillText(phrase.text, { ...slots, ...(phrase.binds ?? {}) });
      return result.ok ? result.value : undefined;
    };
    // A turn that says nothing carries its phrase as the content of a file the block supplies.
    const supplied =
      said === ''
        ? Object.entries(block.given?.world?.workspace?.files ?? {}).find(([, content]) =>
            bank.some((phrase) => filled(phrase) === content),
          )
        : undefined;
    const text = supplied ? supplied[1] : said;
    // The phrase the generator chose: the one whose filled text is the block's text.
    const original = bank.find((phrase) => filled(phrase) === text);
    const options = [text];
    if (!original) {
      if (bank.length > 0) {
        warnings.add(
          `a ${dimension}=${value} block reads no approved phrase as filled, so it keeps its one wording`,
        );
      }
    } else {
      // Another wording must fit where the original fit (its `when` holds in this cell and stage, or reads
      // the same as the original's), fill every slot, and state the same slots: a phrase that binds another
      // plan would make the later turns expect another plan.
      const fitsHere = matches(original.when, context);
      const sameBinds = canonical(original.binds);
      for (const phrase of bank) {
        if (phrase === original) continue;
        const fits = fitsHere
          ? matches(phrase.when, context)
          : canonical(phrase.when) === canonical(original.when);
        if (!fits || canonical(phrase.binds) !== sameBinds) continue;
        const other = filled(phrase);
        if (other !== undefined) options.push(other);
      }
      for (const [slot, bound] of Object.entries(original.binds ?? {})) slots[slot] = bound;
    }
    phrased.push({
      index,
      blockId: meta.block,
      dimension,
      value,
      options: unique(options),
      ...(supplied ? { file: supplied[0] } : {}),
    });
  });
  const available = phrased.reduce((product, block) => product * block.options.length, 1);
  const count = Math.min(wordings, available);
  const variants: PilotVariant[] = [];
  for (let wording = 0; wording < count; wording += 1) {
    const choice = digits(
      wording,
      phrased.map((block) => block.options.length),
    );
    variants.push({
      wording,
      choice,
      loaded: variantOf(
        entry,
        { cell, conversation: spec.id, wording, map: map.hash, suite },
        phrased,
        choice,
      ),
    });
  }
  return {
    conversation: spec.id,
    path: entry.path,
    blocks: spec.blocks.length,
    phrased,
    available,
    variants,
  };
}

/** The from- and to-stage of a stage transition block, from its phrase value `<from>-to-<to>`. */
function transitionOf(meta: GeneratedBlock): { from: string; to: string } | undefined {
  if (meta.phrase?.dimension !== TRANSITION_DIMENSION || typeof meta.phrase.value !== 'string')
    return undefined;
  const match = /^(.+?)-to-(.+)$/.exec(meta.phrase.value);
  return match ? { from: match[1] as string, to: match[2] as string } : undefined;
}

function stringsOf(record: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record ?? {})) if (typeof value === 'string') out[key] = value;
  return out;
}

/** A stable text of a `when` or `binds` record, keys sorted, for comparing two of them. */
function canonical(record: Record<string, unknown> | undefined): string {
  if (!record) return '';
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

/** Mixed-radix digits of `n`, the first block varying fastest. */
function digits(n: number, radices: readonly number[]): number[] {
  let rest = n;
  return radices.map((radix) => {
    const digit = rest % radix;
    rest = Math.floor(rest / radix);
    return digit;
  });
}

function variantOf(
  entry: LoadedSpec,
  factors: PilotFactors,
  phrased: readonly PhrasedBlock[],
  choice: readonly number[],
): LoadedSpec {
  const raw = cloneJson(entry.spec) as Spec & { metadata?: Record<string, unknown> };
  phrased.forEach((block, i) => {
    const target = raw.blocks[block.index];
    const text = block.options[choice[i] as number];
    if (!target || text === undefined) return;
    const files = target.given?.world?.workspace?.files;
    if (block.file !== undefined && files) files[block.file] = text;
    else target.when = withText(target.when, text);
  });
  raw.id = `${entry.spec.id}.w${factors.wording}`;
  raw.metadata = { ...(raw.metadata ?? {}), pilot: factors };
  const result = validateSpec(raw, entry.path);
  if (!result.ok) {
    const issues = result.errors.map((issue) => `${issue.path} ${issue.message}`).join('; ');
    throw new Error(
      `designPilot: wording ${factors.wording} of ${entry.spec.id} is not a valid spec: ${issues}`,
    );
  }
  return result;
}

type Stimulus = Spec['blocks'][number]['when'];

/** The user text of a stimulus: its message, or the message its injection carries. */
export function stimulusText(when: Stimulus): string | undefined {
  const value = when as { user?: unknown; injection?: { user?: unknown } };
  if (typeof value.user === 'string') return value.user;
  if (typeof value.injection?.user === 'string') return value.injection.user;
  return undefined;
}

function withText(when: Stimulus, text: string): Stimulus {
  const value = when as { user?: unknown; injection?: Record<string, unknown> };
  if (typeof value.user === 'string') return { ...when, user: text } as Stimulus;
  if (value.injection && typeof value.injection.user === 'string') {
    return { ...when, injection: { ...value.injection, user: text } } as Stimulus;
  }
  return when;
}

function generatedOf(spec: Spec): Generated | undefined {
  const metadata = spec.metadata as { generated?: unknown } | undefined;
  const generated = metadata?.generated;
  return generated !== null && typeof generated === 'object' ? (generated as Generated) : undefined;
}

/** The factors of a variant spec, or undefined for a spec the pilot did not write. */
export function pilotFactors(spec: Spec): PilotFactors | undefined {
  const metadata = spec.metadata as { pilot?: unknown } | undefined;
  const pilot = metadata?.pilot as Partial<PilotFactors> | undefined;
  if (
    !pilot ||
    typeof pilot.cell !== 'string' ||
    typeof pilot.conversation !== 'string' ||
    typeof pilot.wording !== 'number'
  ) {
    return undefined;
  }
  return {
    cell: pilot.cell,
    conversation: pilot.conversation,
    wording: pilot.wording,
    map: typeof pilot.map === 'string' ? pilot.map : '',
    suite: typeof pilot.suite === 'number' ? pilot.suite : 0,
  };
}

/** Every variant of the design, in cell, conversation and wording order. */
export function designVariants(design: PilotDesign): LoadedSpec[] {
  return design.cells.flatMap((cell) =>
    cell.conversations.flatMap((conversation) => conversation.variants.map((variant) => variant.loaded)),
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
