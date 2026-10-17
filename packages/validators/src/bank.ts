import { type LadderReport, seedLabel, type Tier } from './ladder';

/** The family key of an item that names none, and the tier key of an item that names none. */
export const NO_FAMILY = 'none';
export const NO_TIER = 'none';
/** The family of a level that returns no bank: the level counts as one item. */
export const LEVEL_FAMILY = 'levels';

export type BankVerdict = 'pass' | 'fail' | 'not run';

/** One item of the bank across the seeds of a run. */
export type BankRow = {
  level: number;
  levelId: string;
  id: string;
  component: string;
  family: string;
  tier: Tier | undefined;
  /** The item's cause, the first one a seed reported; undefined when it names none. */
  cause: string | undefined;
  /** One verdict per seed, in the order of the report's seeds. */
  perSeed: BankVerdict[];
  /** True when the item passed on every seed of the run. */
  passEverySeed: boolean;
  /** `catch`: the item counts for no hardness (docs/validators.md section 12.4); absent for a hardness item. */
  role?: 'catch';
};

/** The catch items of a run, counted apart: they guard a capability and count for no hardness. */
export type CatchSummary = {
  size: number;
  passing: number;
  /** Catch items not passing on every seed, per family. */
  failingByFamily: Record<string, number>;
};

/**
 * The bank of a run: every item of every level, its verdict per seed, the bank score (items passing on every
 * seed over the bank) and the counts the journal row records. A level that returns no bank counts as one item
 * of the family "levels", named by the level id.
 */
export type BankSummary = {
  seeds: string[];
  /** The hardness items: every item but the catch items. The score, the counts and the causes read them alone. */
  size: number;
  passing: number;
  score: number;
  /** Items per family and tier: `{ family: { "1".."5" | "none": count } }`. */
  byFamilyTier: Record<string, Record<string, number>>;
  /** Items not passing on every seed, per family; every family of the bank is listed, 0 included. */
  failingByFamily: Record<string, number>;
  /**
   * Distinct causes among the items not passing on every seed (section 12.4). An item without a cause counts as
   * its own cause; `failingWithoutCause` says how many such items there are.
   */
  failingCauses: number;
  failingWithoutCause: number;
  /** Distinct failing causes per family; every family of the bank is listed, 0 included. */
  failingCausesByFamily: Record<string, number>;
  /** The catch items, apart from the counts above. */
  catch: CatchSummary;
  /** Every item, catch items included. */
  rows: BankRow[];
};

/** The key a failing item's cause counts under: its cause, or the item itself when it names none. */
export function causeKey(row: Pick<BankRow, 'cause' | 'level' | 'id'>): string {
  return row.cause !== undefined && row.cause.trim() !== ''
    ? `cause:${row.cause.trim()}`
    : `item:${row.level}/${row.id}`;
}

/**
 * The catch ids a validator pins, each with the planted bug, cheat, shortcut or budget it guards
 * (`validators/<component>/catch.json`, section 12.4). An item counts as a catch item only when it says
 * `role: catch` and its id is pinned here.
 */
export type CatchList = ReadonlyMap<string, string>;

/**
 * The bank summary of a report. Run the report with `full` so the levels above a failure are known. Without a
 * pinned catch list every item is a hardness item.
 */
export function bankSummary(report: LadderReport, pinned?: CatchList): BankSummary {
  const seeds = report.seeds.map(seedLabel);
  const rows = new Map<string, BankRow>();
  const levelCount = report.seeds[0]?.rows.length ?? 0;
  for (let index = 0; index < levelCount; index += 1) {
    report.seeds.forEach((run, seedIndex) => {
      const row = run.rows[index];
      if (!row) return;
      if (!row.bank && row.pass === null) {
        // Not run on this seed and no bank seen: the level stands as one item until a seed runs it.
        const key = `${row.level}/${row.id}`;
        if (!rows.has(key)) {
          rows.set(key, blank(row.level, row.id, row.id, report.component, LEVEL_FAMILY, seeds));
        }
        return;
      }
      const entries: {
        id: string;
        component: string;
        family?: string;
        tier?: Tier;
        cause?: string;
        role?: 'catch';
        pass: boolean;
      }[] = row.bank ?? [
        { id: row.id, component: report.component, family: LEVEL_FAMILY, pass: row.pass === true },
      ];
      for (const entry of entries) {
        const key = `${row.level}/${entry.id}`;
        let target = rows.get(key);
        if (!target) {
          target = blank(row.level, row.id, entry.id, entry.component, entry.family ?? NO_FAMILY, seeds);
          target.tier = entry.tier;
          rows.set(key, target);
        }
        if (target.cause === undefined && entry.cause !== undefined) target.cause = entry.cause;
        if (entry.role === 'catch' && pinned?.has(entry.id)) target.role = 'catch';
        target.perSeed[seedIndex] = entry.pass ? 'pass' : 'fail';
      }
    });
  }
  const banked = new Set(
    report.seeds.flatMap((run) => run.rows.filter((row) => row.bank).map((row) => row.level)),
  );
  const list = [...rows.values()].filter(
    (row) => !(banked.has(row.level) && row.family === LEVEL_FAMILY && row.id === row.levelId),
  );
  for (const row of list) row.passEverySeed = row.perSeed.every((verdict) => verdict === 'pass');
  const caught = list.filter((row) => row.role === 'catch');
  const hard = list.filter((row) => row.role !== 'catch');
  const catchFailing: Record<string, number> = {};
  for (const row of caught)
    if (!row.passEverySeed) catchFailing[row.family] = (catchFailing[row.family] ?? 0) + 1;
  const byFamilyTier: Record<string, Record<string, number>> = {};
  const failingByFamily: Record<string, number> = {};
  for (const row of hard) {
    const tiers = byFamilyTier[row.family] ?? {};
    byFamilyTier[row.family] = tiers;
    const tier = row.tier === undefined ? NO_TIER : String(row.tier);
    tiers[tier] = (tiers[tier] ?? 0) + 1;
    failingByFamily[row.family] = (failingByFamily[row.family] ?? 0) + (row.passEverySeed ? 0 : 1);
  }
  const passing = hard.filter((row) => row.passEverySeed).length;
  const failingRows = hard.filter((row) => !row.passEverySeed);
  const causesByFamily: Record<string, number> = {};
  for (const family of Object.keys(byFamilyTier)) {
    causesByFamily[family] = new Set(failingRows.filter((row) => row.family === family).map(causeKey)).size;
  }
  return {
    seeds,
    size: hard.length,
    passing,
    score: hard.length === 0 ? 0 : passing / hard.length,
    byFamilyTier: sortKeys(byFamilyTier),
    failingByFamily: sortKeys(failingByFamily),
    failingCauses: new Set(failingRows.map(causeKey)).size,
    failingWithoutCause: failingRows.filter((row) => causeKey(row).startsWith('item:')).length,
    failingCausesByFamily: sortKeys(causesByFamily),
    catch: {
      size: caught.length,
      passing: caught.filter((row) => row.passEverySeed).length,
      failingByFamily: sortKeys(catchFailing),
    },
    rows: list,
  };
}

function blank(
  level: number,
  levelId: string,
  id: string,
  component: string,
  family: string,
  seeds: string[],
): BankRow {
  return {
    level,
    levelId,
    id,
    component,
    family,
    tier: undefined,
    cause: undefined,
    perSeed: seeds.map(() => 'not run'),
    passEverySeed: false,
  };
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The bank listing of `--items`: one block per family, items ordered by tier then level then id, each with its
 * verdict per seed; then the bank score and the counts per family and tier.
 */
export function formatItems(
  summary: BankSummary,
  component: string,
  options: { blind?: boolean } = {},
): string {
  const families = Object.keys(summary.byFamilyTier);
  let text = `Bank of ${component}: ${summary.size} items in ${families.length} famil${
    families.length === 1 ? 'y' : 'ies'
  }, ${summary.passing} pass on every seed (score ${round(summary.score)}).\n`;
  if (!options.blind)
    text += `Failing: ${summary.size - summary.passing} items, ${summary.failingCauses} distinct causes (${summary.failingWithoutCause} items name no cause and count as their own).\n`;
  if (summary.catch.size > 0)
    text += `Catch items, counted apart and for no hardness: ${summary.catch.size}, ${summary.catch.passing} pass on every seed.\n`;
  const header = ['Item', 'Tier', 'Level', 'Component', ...summary.seeds.map((seed) => `seed ${seed}`)];
  for (const family of families) {
    const members = summary.rows
      .filter((row) => row.family === family && row.role !== 'catch')
      .sort(
        (a, b) =>
          (a.tier ?? 6) - (b.tier ?? 6) ||
          a.level - b.level ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      );
    const failing = summary.failingByFamily[family] ?? 0;
    const causes = options.blind
      ? ''
      : `, ${summary.failingCausesByFamily[family] ?? 0} distinct failing causes`;
    text += `\nFamily ${family}: ${members.length} items, ${failing} failing${causes}; per tier ${tierCounts(
      summary.byFamilyTier[family] ?? {},
    )}\n`;
    text += table(
      header,
      members.map((row) => [
        row.id,
        row.tier === undefined ? '-' : String(row.tier),
        `${row.level} ${row.levelId}`,
        row.component,
        ...row.perSeed.map((verdict) => (verdict === 'fail' ? 'FAIL' : verdict)),
      ]),
    );
  }
  const catchFamilies = [
    ...new Set(summary.rows.filter((row) => row.role === 'catch').map((row) => row.family)),
  ].sort();
  for (const family of catchFamilies) {
    const members = summary.rows
      .filter((row) => row.family === family && row.role === 'catch')
      .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id, undefined, { numeric: true }));
    text += `\nCatch items of ${family}: ${members.length} items, ${summary.catch.failingByFamily[family] ?? 0} failing\n`;
    text += table(
      header,
      members.map((row) => [
        row.id,
        row.tier === undefined ? '-' : String(row.tier),
        `${row.level} ${row.levelId}`,
        row.component,
        ...row.perSeed.map((verdict) => (verdict === 'fail' ? 'FAIL' : verdict)),
      ]),
    );
  }
  return text;
}

function tierCounts(tiers: Record<string, number>): string {
  return Object.entries(tiers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tier, count]) => `${tier === NO_TIER ? 'none' : tier}: ${count}`)
    .join(', ');
}

function round(value: number): string {
  return String(Number(value.toPrecision(4)));
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (row: string[]) =>
    row
      .map((text, column) => text.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  return `${[line(header), ...rows.map(line)].join('\n')}\n`;
}
