/**
 * The ladder contract. A validator is a ladder of levels; each level measures one metric against one
 * threshold and names the items behind a failure. Levels run in order and the run stops at the first
 * failing level, so a builder never chases two causes at once. Design: docs/validators.md section 1.
 */

/** A difficulty tier of the hardness contract (docs/validators.md section 12.1), 1 the easiest. */
export type Tier = 1 | 2 | 3 | 4 | 5;

/** Author-declared repair scope; neither value constitutes an independent cause review. */
export type CauseKind = 'atomic' | 'composite';

/**
 * One named item behind a count: what failed, the one component it points at, and what to look at. Under the
 * hardness contract an item also names its family and its difficulty tier.
 */
export type Item = {
  id: string;
  component: string;
  detail: string;
  family?: string;
  tier?: Tier;
  /** The one change that would make the item pass (section 12.4). Items sharing a cause count once. */
  cause?: string;
  /** Composite checks retain their item verdict but add no distinct-cause credit. Omitted means atomic. */
  causeKind?: CauseKind;
};

/** One item of a level's bank and whether it passed on this seed. */
export type BankEntry = {
  id: string;
  component: string;
  family?: string;
  tier?: Tier;
  /** The one change that would make the item pass; items sharing a cause count once. */
  cause?: string;
  /** Composite checks retain their item verdict but add no distinct-cause credit. Omitted means atomic. */
  causeKind?: CauseKind;
  pass: boolean;
  detail?: string;
};

/**
 * What a level computes: the observed value of its metric and the items behind it. A level built on a bank
 * also returns the whole bank, passing items included, so `--items` can list it.
 */
export type Measure = {
  value: number;
  items: Item[];
  bank?: BankEntry[];
};

/**
 * The measure of a level whose metric is its bank: the value is the share of entries that pass, the items are
 * the failing entries. An empty bank measures 0 with one item saying so.
 */
export function bankMeasure(entries: readonly BankEntry[], component = 'bank'): Measure {
  if (entries.length === 0) {
    return {
      value: 0,
      items: [{ id: 'bank:empty', component, detail: 'the level holds no item' }],
      bank: [],
    };
  }
  const items: Item[] = entries
    .filter((entry) => !entry.pass)
    .map((entry) => ({
      id: entry.id,
      component: entry.component,
      detail: entry.detail ?? 'failed',
      ...(entry.family !== undefined ? { family: entry.family } : {}),
      ...(entry.tier !== undefined ? { tier: entry.tier } : {}),
      ...(entry.cause !== undefined ? { cause: entry.cause } : {}),
      ...(entry.causeKind !== undefined ? { causeKind: entry.causeKind } : {}),
    }));
  return { value: (entries.length - items.length) / entries.length, items, bank: [...entries] };
}

/** What a level computes from. `root` is the repository root, `hidden` marks the hidden seed. */
export type LadderContext = {
  seed: number;
  hidden: boolean;
  root: string;
};

/** `atLeast`: the level passes when the value is at least the threshold; `atMost`: at most. */
export type Direction = 'atLeast' | 'atMost';

export type LevelDef = {
  id: string;
  name: string;
  /** The metric in words, a ratio of two counts, such as "fixtures matched / fixtures compared". */
  metric: string;
  threshold: number;
  direction?: Direction;
  compute(ctx: LadderContext): Measure | Promise<Measure>;
};

export type Ladder = {
  component: string;
  /** The ladder version (docs/validators.md section 12.5); a floor holds per version. Default 1. */
  version?: number;
  levels: readonly LevelDef[];
};

/** The version of a ladder: its declared version, or 1. */
export function ladderVersion(ladder: Pick<Ladder, 'version'>): number {
  return ladder.version ?? 1;
}

/** Names the command keeps for itself: a ladder cannot take them. */
export const RESERVED_COMPONENTS = ['all', 'floors', 'protect', 'list'] as const;

const COMPONENT = /^[a-z][a-z0-9-]*$/;
const LEVEL_ID = /^[a-z][a-z0-9-]*$/;

/** Checks a ladder definition and returns it frozen. Throws a TypeError naming the first problem. */
export function defineLadder(def: Ladder): Ladder {
  if (!COMPONENT.test(def.component)) {
    throw new TypeError(
      `A ladder component is lower case letters, digits and hyphens, not "${def.component}".`,
    );
  }
  if ((RESERVED_COMPONENTS as readonly string[]).includes(def.component)) {
    throw new TypeError(`"${def.component}" is reserved by driftbench validate.`);
  }
  if (def.levels.length === 0) throw new TypeError(`The ladder ${def.component} has no level.`);
  if (def.version !== undefined && (!Number.isSafeInteger(def.version) || def.version < 1)) {
    throw new TypeError(`The version of the ladder ${def.component} is a whole number of at least 1.`);
  }
  const seen = new Set<string>();
  for (const level of def.levels) {
    if (!LEVEL_ID.test(level.id)) {
      throw new TypeError(`A level id is lower case letters, digits and hyphens, not "${level.id}".`);
    }
    if (seen.has(level.id))
      throw new TypeError(`The ladder ${def.component} repeats the level id ${level.id}.`);
    seen.add(level.id);
    if (!Number.isFinite(level.threshold)) {
      throw new TypeError(`The level ${level.id} of ${def.component} has no finite threshold.`);
    }
    if (level.name.trim() === '' || level.metric.trim() === '') {
      throw new TypeError(`The level ${level.id} of ${def.component} needs a name and a metric.`);
    }
  }
  return Object.freeze({
    component: def.component,
    version: def.version ?? 1,
    levels: Object.freeze(def.levels.map((level) => Object.freeze({ ...level }))),
  });
}

/**
 * One row of the ladder table. `observed`, `pass` and `itemCount` are null for a level not run. `bank` is the
 * level's bank when it returned one. `beyond` marks a level computed above the first failing level in a full
 * run: it lists the bank and never changes the level.
 */
export type LevelRow = {
  level: number;
  id: string;
  name: string;
  metric: string;
  threshold: number;
  direction: Direction;
  observed: number | null;
  pass: boolean | null;
  itemCount: number | null;
  bank?: BankEntry[];
  beyond?: boolean;
  /** The items the level named, kept on every computed row of a full run (`--all-levels`). */
  items?: Item[];
};

/** The run of one ladder on one seed. `level` is the highest level passed, 0 when level 1 fails. */
export type SeedRun = {
  seed: number;
  hidden: boolean;
  level: number;
  top: number;
  rows: LevelRow[];
  failing: { level: number; id: string; name: string; items: Item[] } | null;
};

export type RunOptions = {
  seed: number;
  /** True when this seed is the hidden seed; it changes only the label of the run. */
  hiddenSeed?: boolean;
  root?: string;
  /**
   * Compute every level through maxLevel, also above the first failing one (`--items`). The
   * level, the failing level and its items are the same as in a stopping run.
   */
  full?: boolean;
  /** Compute only through this level (1 to the ladder's top), including in a full run. */
  maxLevel?: number;
};

const TIERS = new Set([1, 2, 3, 4, 5]);

/** Throws when a measure carries an item or bank entry whose tier is not 1 to 5. */
function checkTiers(measure: Measure): void {
  for (const entry of [...measure.items, ...(measure.bank ?? [])]) {
    if (entry.tier !== undefined && !TIERS.has(entry.tier)) {
      throw new RangeError(`the item ${entry.id} has tier ${entry.tier}; a tier is 1 to 5`);
    }
  }
}

/** Whether an observed value passes a threshold. NaN never passes. */
export function passes(value: number, threshold: number, direction: Direction = 'atLeast'): boolean {
  if (Number.isNaN(value)) return false;
  return direction === 'atLeast' ? value >= threshold : value <= threshold;
}

/**
 * Evaluates the levels in order and stops at the first failing level. A level that throws fails with one
 * item naming the error. Levels after the first failure or maxLevel are listed but not computed.
 */
export async function runLadder(ladder: Ladder, options: RunOptions): Promise<SeedRun> {
  const maxLevel = options.maxLevel ?? ladder.levels.length;
  if (!Number.isSafeInteger(maxLevel) || maxLevel < 1 || maxLevel > ladder.levels.length) {
    throw new RangeError(`maxLevel must be a whole number from 1 to ${ladder.levels.length}.`);
  }
  const ctx: LadderContext = {
    seed: options.seed,
    hidden: options.hiddenSeed ?? false,
    root: options.root ?? process.cwd(),
  };
  const rows: LevelRow[] = [];
  let failing: SeedRun['failing'] = null;
  let level = 0;
  for (const [index, def] of ladder.levels.entries()) {
    const direction = def.direction ?? 'atLeast';
    const base = {
      level: index + 1,
      id: def.id,
      name: def.name,
      metric: def.metric,
      threshold: def.threshold,
      direction,
    };
    if (index >= maxLevel || (failing && !options.full)) {
      rows.push({ ...base, observed: null, pass: null, itemCount: null });
      continue;
    }
    let measure: Measure;
    try {
      measure = await def.compute(ctx);
      checkTiers(measure);
    } catch (cause) {
      measure = {
        value: Number.NaN,
        items: [
          {
            id: `${def.id}:error`,
            component: ladder.component,
            detail: `the level threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          },
        ],
      };
    }
    const pass = passes(measure.value, def.threshold, direction);
    rows.push({
      ...base,
      observed: measure.value,
      pass,
      itemCount: measure.items.length,
      ...(measure.bank ? { bank: measure.bank } : {}),
      ...(failing ? { beyond: true } : {}),
      ...(options.full ? { items: measure.items } : {}),
    });
    if (failing) continue;
    if (pass) {
      level = index + 1;
    } else {
      failing = { level: index + 1, id: def.id, name: def.name, items: measure.items };
    }
  }
  return {
    seed: options.seed,
    hidden: options.hiddenSeed ?? false,
    level,
    top: ladder.levels.length,
    rows,
    failing,
  };
}

/** A seed to run: its value and whether it is the hidden seed. */
export type SeedSpec = { seed: number; hidden: boolean };

/** The run of one ladder over several seeds. `level` is the minimum over the seeds. */
export type LadderReport = {
  component: string;
  /** The version of the ladder that ran. */
  ladderVersion: number;
  level: number;
  top: number;
  seeds: SeedRun[];
};

/** Runs a ladder on every seed in order. The level of the report is the minimum level over its seeds. */
export async function runSeeds(
  ladder: Ladder,
  seeds: readonly SeedSpec[],
  root?: string,
  options: { full?: boolean; maxLevel?: number } = {},
): Promise<LadderReport> {
  if (seeds.length === 0) throw new RangeError('runSeeds needs at least one seed.');
  const runs: SeedRun[] = [];
  for (const spec of seeds) {
    runs.push(
      await runLadder(ladder, {
        seed: spec.seed,
        hiddenSeed: spec.hidden,
        ...(root ? { root } : {}),
        ...(options.full ? { full: true } : {}),
        ...(options.maxLevel === undefined ? {} : { maxLevel: options.maxLevel }),
      }),
    );
  }
  return {
    component: ladder.component,
    ladderVersion: ladderVersion(ladder),
    level: Math.min(...runs.map((run) => run.level)),
    top: ladder.levels.length,
    seeds: runs,
  };
}

/** The label of a seed in tables and files: its number, or "hidden". */
export function seedLabel(run: { seed: number; hidden: boolean }): string {
  return run.hidden ? 'hidden' : String(run.seed);
}
