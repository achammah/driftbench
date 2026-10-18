import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendJournal,
  bankMeasure,
  bankSummary,
  defineLadder,
  formatHardness,
  formatItems,
  type JournalRow,
  JournalRowSchema,
  readJournal,
  runSeeds,
  seedSpecs,
} from '../src/index';
import { hard, journalOf, journalRow } from './support';

function ladderOf(entries: Parameters<typeof bankMeasure>[0]) {
  return defineLadder({
    component: 'caused',
    levels: [
      {
        id: 'bank',
        name: 'bank',
        metric: 'items passing / items',
        threshold: 1,
        compute: () => bankMeasure(entries),
      },
    ],
  });
}

describe('distinct failing causes in the bank summary', () => {
  it('counts items sharing a cause once and an item without a cause as its own cause', async () => {
    const ladder = ladderOf([
      { id: 'x1', component: 'c', family: 'f', pass: false, cause: 'round half up' },
      { id: 'x2', component: 'c', family: 'f', pass: false, cause: 'round half up' },
      { id: 'x3', component: 'c', family: 'g', pass: false, cause: ' round half up ' },
      { id: 'x4', component: 'c', family: 'g', pass: false },
      { id: 'x5', component: 'c', family: 'g', pass: false, cause: '' },
      { id: 'x6', component: 'c', family: 'g', pass: true, cause: 'never counted' },
    ]);
    const summary = bankSummary(await runSeeds(ladder, seedSpecs([1, 2])));
    expect(summary.failingCauses).toBe(3);
    expect(summary.failingWithoutCause).toBe(2);
    expect(summary.failingCausesByFamily).toEqual({ f: 1, g: 3 });
    const text = formatItems(summary, 'caused');
    expect(text).toContain(
      'Failing: 5 items, 3 distinct causes (2 items name no cause and count as their own).',
    );
    expect(text).toContain('Family f: 2 items, 2 failing, 1 distinct failing causes;');
    expect(text).toContain('Family g: 4 items, 3 failing, 3 distinct failing causes;');
  });

  it('carries the cause from bankMeasure into the failing items', () => {
    expect(
      bankMeasure([{ id: 'x', component: 'c', pass: false, cause: 'trim input' }]).items[0],
    ).toMatchObject({
      cause: 'trim input',
    });
  });
});

describe('the cause counts of the journal row', () => {
  const issues = (value: unknown) => {
    const parsed = JournalRowSchema.safeParse(value);
    return parsed.success ? '' : parsed.error.issues.map((issue) => issue.message).join(' | ');
  };
  it('accepts a row without them and checks them when present', () => {
    expect(issues(journalRow(1))).toBe('');
    expect(issues(journalRow(1, { failingCauses: 3, failingWithoutCause: 1 }))).toBe('');
    expect(issues(journalRow(1, { failingCauses: 4 }))).toMatch(
      /failingCauses 4 exceeds the 3 failing items/,
    );
    expect(issues(journalRow(1, { failingCauses: 0, failingWithoutCause: 0 }))).toBe('');
    expect(issues(journalRow(1, { failingWithoutCause: 1 }))).toMatch(/goes with failingCauses/);
    expect(issues(journalRow(1, { failingCauses: 1, failingWithoutCause: 2 }))).toMatch(/cannot exceed them/);
  });

  it('journals an all-composite failing bank without inventing a cause', async () => {
    const ladder = ladderOf([
      {
        id: 'bundle-a',
        component: 'c',
        family: 'f',
        tier: 1,
        pass: false,
        cause: 'c:bundle-a',
        causeKind: 'composite',
      },
      {
        id: 'bundle-b',
        component: 'c',
        family: 'f',
        tier: 2,
        pass: false,
        cause: 'c:bundle-b',
        causeKind: 'composite',
      },
    ]);
    const report = await runSeeds(ladder, seedSpecs([1]));
    const summary = bankSummary(report);
    expect(summary).toMatchObject({
      size: 2,
      passing: 0,
      score: 0,
      failingCauses: 0,
      failingWithoutCause: 0,
    });
    const value = journalRow(0, {
      seeds: ['1'],
      level: { before: 0, after: 0 },
      perSeed: [{ seed: '1', before: 0, after: 0 }],
      metrics: [{ level: 1, id: 'bank', metric: 'items passing / items', threshold: 1, before: 0, after: 0 }],
      bankSize: summary.size,
      passing: summary.passing,
      failingByFamily: summary.failingByFamily,
      bankByFamilyTier: summary.byFamilyTier,
      failingCauses: summary.failingCauses,
      failingWithoutCause: summary.failingWithoutCause,
    });
    const root = mkdtempSync(join(tmpdir(), 'astra-banks-journal-test-'));
    try {
      const appended = appendJournal(root, 'caused', value);
      expect(appended).not.toHaveProperty('refused');
      const loaded = readJournal(root, 'caused');
      expect(loaded.problems).toEqual([]);
      expect(loaded.rows).toHaveLength(1);
      expect(loaded.rows[0]).toMatchObject({ bankSize: 2, passing: 0, failingCauses: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the distinct-cause gate of --hardness', () => {
  const TIERS = { '1': 100, '2': 80, '3': 60, '4': 40, '5': 20 };
  const PILOT = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
  const rows = (causes: (failing: number) => number | undefined): JournalRow[] =>
    journalOf(PILOT, 300, TIERS, causes).map((row) => JournalRowSchema.parse(row));

  it('holds at 100 distinct failing causes and fails at 99', () => {
    expect(hard(rows(() => 100)).gate).toEqual({ holds: true, reasons: [] });
    expect(hard(rows(() => 100)).causes).toEqual({ distinct: 100, withoutCause: 0 });
    expect(hard(rows(() => 99)).gate).toEqual({
      holds: false,
      reasons: ['99 distinct failing causes after the pilot, under 100: extend the bank (12.2)'],
    });
  });

  it('fails when the last pilot row records no cause count', () => {
    const h = hard(rows(() => undefined));
    expect(h.causes).toBeNull();
    expect(h.gate.reasons).toEqual(['the last row of the pilot records no failingCauses']);
    expect(formatHardness('caused', h)).toContain('Distinct failing causes after the pilot: not recorded.');
  });

  it('still fails the distinct-cause gate when valid journal rows declare zero causes', () => {
    const measured = hard(rows(() => 0));
    expect(measured.causes).toEqual({ distinct: 0, withoutCause: 0 });
    expect(measured.gate.holds).toBe(false);
    expect(measured.gate.reasons).toContain(
      '0 distinct failing causes after the pilot, under 100: extend the bank (12.2)',
    );
  });

  it('prints the distinct causes and how many failing items name no cause', () => {
    const parsed = journalOf(PILOT, 300, TIERS, () => 150).map((row, index) =>
      JournalRowSchema.parse(
        index === PILOT.length - 1 ? { ...(row as object), failingWithoutCause: 12 } : row,
      ),
    );
    const text = formatHardness('caused', hard(parsed));
    expect(text).toContain(
      'Distinct failing causes after the pilot: 150 (12 failing items name no cause and count as their own).',
    );
    expect(text).toContain('at least 100 distinct failing causes');
  });
});
