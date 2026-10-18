import type { BankEntry, Item, LadderReport, SeedRun, Tier } from './ladder';
import { seedLabel } from './ladder';

/** One failing item of any level, across the seeds of a run (`--all-levels`). */
export type FailingItem = {
  level: number;
  levelId: string;
  id: string;
  component: string;
  family: string | undefined;
  tier: Tier | undefined;
  cause: string | undefined;
  /** The detail of the first seed the item failed on. */
  detail: string;
  /** The seeds the item failed on, labelled as in the table. */
  seeds: string[];
};

/** The items a computed row named: its own on a full run, else the first failing level's. */
function rowItems(run: SeedRun, index: number): Item[] {
  const row = run.rows[index];
  if (!row) return [];
  if (row.items) return row.items;
  return run.failing?.level === row.level ? run.failing.items : [];
}

/**
 * Every failing item of every level, each once, ordered by level then id, with the seeds it failed on. Run the
 * report with `full` (`--all-levels`) so the levels above the first failure are known.
 */
export function allFailingItems(report: LadderReport): FailingItem[] {
  const found = new Map<string, FailingItem>();
  const levels = report.seeds[0]?.rows.length ?? 0;
  for (let index = 0; index < levels; index += 1) {
    for (const run of report.seeds) {
      const row = run.rows[index];
      if (!row) continue;
      for (const item of rowItems(run, index)) {
        const key = `${row.level}/${item.id}`;
        let entry = found.get(key);
        if (!entry) {
          entry = {
            level: row.level,
            levelId: row.id,
            id: item.id,
            component: item.component,
            family: item.family,
            tier: item.tier,
            cause: item.cause,
            detail: item.detail,
            seeds: [],
          };
          found.set(key, entry);
        }
        if (entry.cause === undefined && item.cause !== undefined) entry.cause = item.cause;
        const label = seedLabel(run);
        if (!entry.seeds.includes(label)) entry.seeds.push(label);
      }
    }
  }
  return [...found.values()].sort(
    (a, b) => a.level - b.level || a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

/** The failing items as text: one block per level, each item with family, tier, component, seeds and detail. */
export function formatAllFailing(items: readonly FailingItem[], component: string): string {
  let text = `All failing items of ${component}, every level: ${items.length} item${items.length === 1 ? '' : 's'}.\n`;
  const levels = [...new Set(items.map((item) => `${item.level} ${item.levelId}`))];
  for (const level of levels) {
    const members = items.filter((item) => `${item.level} ${item.levelId}` === level);
    text += `Level ${level}: ${members.length} item${members.length === 1 ? '' : 's'}\n`;
    for (const item of members) {
      const tags = [
        ...(item.family !== undefined ? [`family ${item.family}`] : []),
        ...(item.tier !== undefined ? [`tier ${item.tier}`] : []),
      ];
      text += `  ${item.id}  ${tags.length > 0 ? `[${tags.join(', ')}]  ` : ''}[${item.component}]  seeds ${item.seeds.join(', ')}  ${item.detail}${
        item.cause !== undefined ? `  (cause: ${item.cause})` : ''
      }\n`;
    }
  }
  return text;
}

/** A detail without its trailing fix hint: everything from the first `Fix:` (any case) on is dropped. */
export function stripHint(detail: string): string {
  return detail.replace(/\s*\bfix:[\s\S]*$/i, '').trimEnd();
}

/** A detail without its leading `[family, tier N, cause: ...]` tag, which spells the builder's cause out. */
export function stripCauseTag(detail: string): string {
  return detail.replace(/^\[[^\]]*\bcause:[^\]]*\]\s*/, '');
}

function blindItem<T extends Item | BankEntry>(item: T): T {
  const { cause: _cause, ...rest } = item;
  return (rest.detail === undefined ? rest : { ...rest, detail: stripHint(stripCauseTag(rest.detail)) }) as T;
}

/**
 * The report an auditor may see (section 12.7): every `cause` removed and every detail cut before its trailing
 * `Fix:` hint, in the failing items, the rows' items and the banks. The executor's view keeps them.
 */
export function blindReport(report: LadderReport): LadderReport {
  return {
    ...report,
    seeds: report.seeds.map((run) => ({
      ...run,
      rows: run.rows.map((row) => ({
        ...row,
        ...(row.items ? { items: row.items.map(blindItem) } : {}),
        ...(row.bank ? { bank: row.bank.map(blindItem) } : {}),
      })),
      failing: run.failing ? { ...run.failing, items: run.failing.items.map(blindItem) } : null,
    })),
  };
}
