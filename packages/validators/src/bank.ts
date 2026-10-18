import { type CauseKind, type LadderReport, seedLabel, type Tier } from './ladder';

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
  /** Author-declared repair scope. Composite checks are excluded only from cause counts. */
  causeKind?: CauseKind;
  /** One verdict per seed, in the order of the report's seeds. */
  perSeed: BankVerdict[];
  /** True when the item passed on every seed of the run. */
  passEverySeed: boolean;
};

/**
 * The bank of a run: every item of every level, its verdict per seed, the bank score (items passing on every
 * seed over the bank) and the counts the journal row records. A level that returns no bank counts as one item
 * of the family "levels", named by the level id.
 */
export type BankSummary = {
  seeds: string[];
  size: number;
  passing: number;
  score: number;
  /** Items per family and tier: `{ family: { "1".."5" | "none": count } }`. */
  byFamilyTier: Record<string, Record<string, number>>;
  /** Items not passing on every seed, per family; every family of the bank is listed, 0 included. */
  failingByFamily: Record<string, number>;
  /**
   * Distinct declared atomic causes among items not passing on every seed (section 12.4), not independently
   * reviewed fixes. An atomic item without a cause counts as its own; composite checks add no cause credit.
   */
  failingCauses: number;
  failingWithoutCause: number;
  /** Distinct failing causes per family; every family of the bank is listed, 0 included. */
  failingCausesByFamily: Record<string, number>;
  rows: BankRow[];
};

/** The key a failing item's cause counts under: its cause, or the item itself when it names none. */
export function causeKey(row: Pick<BankRow, 'cause' | 'level' | 'id'>): string {
  return row.cause !== undefined && row.cause.trim() !== ''
    ? `cause:${row.cause.trim()}`
    : `item:${row.level}/${row.id}`;
}

/** The bank summary of a report. Run the report with `full` so the levels above a failure are known. */
export function bankSummary(report: LadderReport): BankSummary {
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
        causeKind?: CauseKind;
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
        if (entry.causeKind === 'composite' || target.causeKind === undefined)
          target.causeKind = entry.causeKind;
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
  const byFamilyTier: Record<string, Record<string, number>> = {};
  const failingByFamily: Record<string, number> = {};
  for (const row of list) {
    const tiers = byFamilyTier[row.family] ?? {};
    byFamilyTier[row.family] = tiers;
    const tier = row.tier === undefined ? NO_TIER : String(row.tier);
    tiers[tier] = (tiers[tier] ?? 0) + 1;
    failingByFamily[row.family] = (failingByFamily[row.family] ?? 0) + (row.passEverySeed ? 0 : 1);
  }
  const passing = list.filter((row) => row.passEverySeed).length;
  const failingRows = list.filter((row) => !row.passEverySeed);
  const atomicFailures = failingRows.filter((row) => row.causeKind !== 'composite');
  const causesByFamily: Record<string, number> = {};
  for (const family of Object.keys(byFamilyTier)) {
    causesByFamily[family] = new Set(
      atomicFailures.filter((row) => row.family === family).map(causeKey),
    ).size;
  }
  return {
    seeds,
    size: list.length,
    passing,
    score: list.length === 0 ? 0 : passing / list.length,
    byFamilyTier: sortKeys(byFamilyTier),
    failingByFamily: sortKeys(failingByFamily),
    failingCauses: new Set(atomicFailures.map(causeKey)).size,
    failingWithoutCause: atomicFailures.filter((row) => causeKey(row).startsWith('item:')).length,
    failingCausesByFamily: sortKeys(causesByFamily),
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
  if (!options.blind)
    text +=
      'Cause counts are author-declared, not independently reviewed. Composite checks retain their item verdicts but add no cause credit.\n';
  const header = ['Item', 'Tier', 'Level', 'Component', ...summary.seeds.map((seed) => `seed ${seed}`)];
  for (const family of families) {
    const members = summary.rows
      .filter((row) => row.family === family)
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
