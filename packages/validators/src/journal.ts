import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { statsBankHash } from './bank-fingerprint';

/** The folder of a component's loop files, from the repository root. */
export function loopFolder(component: string): string {
  return `validators/${component}`;
}

export function journalFile(component: string): string {
  return `${loopFolder(component)}/journal.jsonl`;
}

const level = z.number().int().min(0);

const SeedLevels = z
  .object({
    seed: z.string().regex(/^(\d+|hidden)$/, 'a seed is a whole number or "hidden"'),
    before: level,
    after: level,
  })
  .strict();

const LevelMetric = z
  .object({
    level: z.number().int().min(1),
    id: z.string().min(1),
    metric: z.string().min(1),
    threshold: z.number(),
    before: z.number().nullable(),
    after: z.number().nullable(),
  })
  .strict();

/** The pilot of the hardness measurement is iterations 1 to PILOT_ITERATIONS (docs/validators.md 12.4). */
export const PILOT_ITERATIONS = 10;

const count = z.number().int().min(0);

/**
 * One iteration of the executor loop (docs/validators.md sections 10.2 and 12.4): iteration (0 is the
 * measurement before any fix, 1 to 10 the pilot, then onward), model, seeds, command, level before and after
 * (overall and per seed), every level's metric, the bank after the iteration (its size, the items passing on
 * every seed, the failing items per family, the items per family and tier), the failing items before, the
 * hypothesis, the research, the change, tests added, the result, duration and token estimate.
 */
export const JournalRowSchema = z
  .object({
    iteration: z.number().int().min(0),
    at: z.iso.datetime(),
    model: z.string().min(1),
    seeds: z.array(z.string().regex(/^(\d+|hidden)$/)).min(1),
    command: z.string().min(1),
    level: z.object({ before: level, after: level }).strict(),
    perSeed: z.array(SeedLevels).min(1),
    metrics: z.array(LevelMetric).min(1),
    bankSize: count,
    /** Captured by the full measurement; absent on historical rows, never backfilled. */
    bankHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    passing: count,
    failingByFamily: z.record(z.string().min(1), count),
    failingCauses: count.optional(),
    executor: z.enum(['builder', 'blind']).optional(),
    failingWithoutCause: count.optional(),
    bankByFamilyTier: z
      .record(z.string().min(1), z.record(z.string().regex(/^([1-5]|none)$/), count))
      .optional(),
    failingBefore: z.array(z.string().min(1)),
    hypothesis: z.string().min(1),
    research: z
      .object({ sources: z.array(z.string().min(1)).min(1), finding: z.string().min(1) })
      .strict()
      .nullable(),
    change: z
      .object({
        files: z.array(z.string().min(1)),
        commit: z
          .string()
          .regex(/^[0-9a-f]{7,40}$/)
          .nullable(),
      })
      .strict(),
    testsAdded: z.array(z.string().min(1)),
    result: z.enum(['baseline', 'raised', 'unchanged', 'lowered', 'stuck']),
    durationMinutes: z.number().min(0),
    tokenEstimate: z.number().int().min(0),
  })
  .strict()
  .superRefine((row, ctx) => {
    const listed = [...row.seeds].sort().join(',');
    const reported = row.perSeed
      .map((entry) => entry.seed)
      .sort()
      .join(',');
    if (listed !== reported) {
      ctx.addIssue({
        code: 'custom',
        path: ['perSeed'],
        message: 'perSeed must hold exactly the seeds listed',
      });
    }
    const before = Math.min(...row.perSeed.map((entry) => entry.before));
    const after = Math.min(...row.perSeed.map((entry) => entry.after));
    if (row.level.before !== before || row.level.after !== after) {
      ctx.addIssue({
        code: 'custom',
        path: ['level'],
        message: `level must be the minimum over perSeed: before ${before}, after ${after}`,
      });
    }
    const expected =
      row.level.after > row.level.before
        ? 'raised'
        : row.level.after < row.level.before
          ? 'lowered'
          : undefined;
    if ((row.iteration === 0) !== (row.result === 'baseline')) {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'iteration 0 is the baseline, and only iteration 0 is',
      });
    } else if (row.iteration === 0 && expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['level'],
        message: 'the baseline changes nothing: before equals after',
      });
    } else if (row.iteration > 0 && expected && row.result !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: `the level moved, so result is ${expected}`,
      });
    }
    if (row.iteration > 0 && !expected && (row.result === 'raised' || row.result === 'lowered')) {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'the level did not move: unchanged or stuck',
      });
    }
    if (row.passing > row.bankSize) {
      ctx.addIssue({ code: 'custom', path: ['passing'], message: 'passing cannot exceed bankSize' });
    }
    const failing = Object.values(row.failingByFamily).reduce((sum, value) => sum + value, 0);
    if (failing !== row.bankSize - row.passing) {
      ctx.addIssue({
        code: 'custom',
        path: ['failingByFamily'],
        message: `failingByFamily sums to ${failing}, but bankSize minus passing is ${row.bankSize - row.passing}`,
      });
    }
    const failingItems = row.bankSize - row.passing;
    if (row.failingCauses !== undefined) {
      if (row.failingCauses > failingItems) {
        ctx.addIssue({
          code: 'custom',
          path: ['failingCauses'],
          message: `failingCauses ${row.failingCauses} exceeds the ${failingItems} failing items`,
        });
      }
      if (failingItems > 0 && row.failingCauses === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['failingCauses'],
          message: `${failingItems} items fail, so at least one cause does`,
        });
      }
    }
    if (row.failingWithoutCause !== undefined) {
      if (row.failingCauses === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['failingWithoutCause'],
          message: 'failingWithoutCause goes with failingCauses',
        });
      } else if (row.failingWithoutCause > row.failingCauses) {
        ctx.addIssue({
          code: 'custom',
          path: ['failingWithoutCause'],
          message: 'each item without a cause is one of the failingCauses, so it cannot exceed them',
        });
      }
    }
    const perTier = row.bankByFamilyTier;
    const banked = Object.values(perTier ?? {})
      .flatMap((tiers) => Object.values(tiers))
      .reduce((sum, value) => sum + value, 0);
    if (perTier && banked !== row.bankSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['bankByFamilyTier'],
        message: `bankByFamilyTier sums to ${banked}, but bankSize is ${row.bankSize}`,
      });
    }
    for (const [family, failed] of Object.entries(perTier ? row.failingByFamily : {})) {
      const size = Object.values(perTier?.[family] ?? {}).reduce((sum, value) => sum + value, 0);
      if (failed > size) {
        ctx.addIssue({
          code: 'custom',
          path: ['failingByFamily', family],
          message: `${failed} failing in a family of ${size} items`,
        });
      }
    }
    const levels = row.metrics.map((metric) => metric.level);
    if (levels.some((value, index) => value !== index + 1)) {
      ctx.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'metrics list every level in order from 1',
      });
    }
  });

export type JournalRow = z.infer<typeof JournalRowSchema>;

/** Who ran an iteration: the builder lane (the default) or a blind executor of the audit (section 12.7). */
export type Executor = 'builder' | 'blind';

export function executorOf(row: Pick<JournalRow, 'executor'>): Executor {
  return row.executor ?? 'builder';
}

/**
 * The iterations the next row of an executor may carry. Each executor counts on its own: the builder from 0;
 * the blind executor from 0 (its own baseline) or from 1 (it starts from the builder's iteration 0).
 */
export function nextIterations(previous: readonly JournalRow[], executor: Executor): number[] {
  const own = previous.filter((row) => executorOf(row) === executor);
  const last = own.at(-1);
  if (last) return [last.iteration + 1];
  return executor === 'blind' ? [0, 1] : [0];
}

/** The rows of a journal, and the lines that are not valid rows. An absent journal has no row. */
export function readJournal(root: string, component: string): { rows: JournalRow[]; problems: string[] } {
  const path = join(root, journalFile(component));
  if (!existsSync(path)) return { rows: [], problems: [] };
  const rows: JournalRow[] = [];
  const problems: string[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        problems.push(`${journalFile(component)}:${index + 1} is not JSON.`);
        return;
      }
      const parsed = JournalRowSchema.safeParse(value);
      if (parsed.success) rows.push(parsed.data);
      else
        problems.push(`${journalFile(component)}:${index + 1} ${rowIssues(parsed.error.issues).join('; ')}`);
    });
  rows.forEach((row, index) => {
    const allowed = nextIterations(rows.slice(0, index), executorOf(row));
    if (!allowed.includes(row.iteration)) {
      problems.push(
        `${journalFile(component)}: row ${index + 1} (${executorOf(row)}) says iteration ${row.iteration}, not ${allowed.join(' or ')}.`,
      );
    }
  });
  return { rows, problems };
}

/** Checks a row against the schema and the journal: it must be the next iteration. */
export function validateRow(
  value: unknown,
  previous: readonly JournalRow[],
): { row: JournalRow } | { refused: string[] } {
  const parsed = JournalRowSchema.safeParse(value);
  if (!parsed.success) return { refused: rowIssues(parsed.error.issues) };
  const executor = executorOf(parsed.data);
  const allowed = nextIterations(previous, executor);
  if (!allowed.includes(parsed.data.iteration)) {
    return {
      refused: [
        `iteration must be ${allowed.join(' or ')}, the next ${executor} row of the journal, not ${parsed.data.iteration}`,
      ],
    };
  }
  return { row: parsed.data };
}

/** Appends a validated row as one line. Refuses a journal that already holds an invalid line. */
export function appendJournal(
  root: string,
  component: string,
  value: unknown,
): { row: JournalRow } | { refused: string[] } {
  const { rows, problems } = readJournal(root, component);
  if (problems.length > 0) return { refused: problems };
  const checked = validateRow(value, rows);
  if ('refused' in checked) return checked;
  if (component === 'stats') {
    if (!checked.row.bankHash) {
      return {
        refused: [
          'bankHash is required: copy it from the measured stats --items --json report; never backfill a historical row',
        ],
      };
    }
    try {
      if (checked.row.bankHash !== statsBankHash(root)) {
        return {
          refused: [
            'the journal bank hash differs from the live bank: rerun the measurement before appending',
          ],
        };
      }
    } catch (cause) {
      return {
        refused: [
          `cannot fingerprint the live bank: ${cause instanceof Error ? cause.message : String(cause)}`,
        ],
      };
    }
  }
  const path = join(root, journalFile(component));
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(checked.row)}\n`);
  return checked;
}

function rowIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((issue) => `${issue.path.map(String).join('.') || '(row)'}: ${issue.message}`);
}
