import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatHardness, type JournalRow, JournalRowSchema, measureHardness, parseGate } from '../src/index';
import { ROOT } from './map/support';
import { hard, journalOf, journalRow, PASSING_AUDIT } from './support';

function rows(passing: number[], bankSize: number, tiers?: Record<string, number>): JournalRow[] {
  return journalOf(passing, bankSize, tiers).map((row) => JournalRowSchema.parse(row));
}

const TIERS = { '1': 100, '2': 80, '3': 60, '4': 40, '5': 20 };

describe('the journal row of the hardness contract', () => {
  it('accepts a baseline at iteration 0 and refuses a row whose bank counts disagree', () => {
    const ok = (value: unknown) => JournalRowSchema.safeParse(value).success;
    const issues = (value: unknown) => {
      const parsed = JournalRowSchema.safeParse(value);
      return parsed.success ? '' : parsed.error.issues.map((issue) => issue.message).join(' | ');
    };
    expect(ok(journalRow(0))).toBe(true);
    expect(issues(journalRow(0, { result: 'unchanged' }))).toMatch(/iteration 0 is the baseline/);
    expect(issues(journalRow(1, { result: 'baseline' }))).toMatch(/iteration 0 is the baseline/);
    expect(issues(journalRow(1, { passing: 11 }))).toMatch(/passing cannot exceed bankSize/);
    expect(issues(journalRow(1, { failingByFamily: { alpha: 1 } }))).toMatch(
      /failingByFamily sums to 1, but bankSize minus passing is 3/,
    );
    expect(issues(journalRow(1, { bankByFamilyTier: { alpha: { '1': 4 } } }))).toMatch(
      /bankByFamilyTier sums to 4, but bankSize is 10/,
    );
    expect(issues(journalRow(1, { bankByFamilyTier: { alpha: { '6': 6 }, beta: { '3': 4 } } }))).toMatch(
      /Invalid|match/,
    );
    const { bankSize: _dropped, ...noBank } = journalRow(1);
    expect(ok(noBank)).toBe(false);
    const { bankByFamilyTier: _tiers, ...frozenNames } = journalRow(0);
    expect(ok(frozenNames)).toBe(true);
    expect(hard([JournalRowSchema.parse(frozenNames)]).bankMinimum.problems).toContain(
      'the row records no bankByFamilyTier, so family and tier sizes are unknown',
    );
  });
});

describe('measureHardness', () => {
  it('holds when the pilot forecasts at least 100 iterations and ends at a score of at most 0.4', () => {
    const h = hard(rows([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], 300, TIERS));
    expect(h.iteration0).toEqual({ bankSize: 300, passing: 30, score: 0.1 });
    expect(h.pilot).toMatchObject({ iterations: 10, complete: true, end: { passing: 40, score: 40 / 300 } });
    expect(h.fixedPerIteration).toBe(1);
    expect(h.remaining).toBe(260);
    expect(h.forecast).toBe(260);
    expect(h.gate).toEqual({ holds: true, reasons: [] });
    expect(h.bank.byFamilyTier).toEqual({ core: TIERS });
    expect(h.bankMinimum).toEqual({ holds: true, problems: [] });
  });

  it('fails a forecast under 100, a score above 0.4, an incomplete pilot and a pilot that fixed nothing', () => {
    expect(hard(rows([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 300)).gate.reasons).toEqual([
      'the forecast 20 is under 100: extend the bank (12.2)',
    ]);
    expect(hard(rows([150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160], 300)).gate.reasons).toEqual([
      'the score after the pilot 0.5333 is above 0.4',
    ]);
    expect(hard(rows([30, 31, 32], 300)).gate.reasons).toEqual(['the pilot holds 2 of 10 iterations']);
    const partial = hard(rows([30, 31, 32], 300));
    expect(partial.fixedPerIteration).toBe(1);
    expect(partial.forecast).toBe(268);
    const flat = hard(rows(Array(11).fill(30), 300));
    expect(flat.forecast).toBeNull();
    expect(flat.gate.reasons).toEqual([
      'the pilot fixed nothing: the items are miswritten or the component lacks a foundation',
    ]);
    expect(hard(rows([30], 300)).gate.reasons).toEqual([
      'the pilot holds 0 of 10 iterations',
      'no pilot row yet',
    ]);
    expect(() => hard([])).toThrow(/no iteration 0 row/);
  });

  it('names a bank under the 12.1 minimum: size, family size and missing tiers', () => {
    const h = hard(rows([1, 2], 12));
    expect(h.bankMinimum.problems).toEqual([
      'the bank holds 12 items, under 300',
      'the family core holds 12 items, under 20',
      'no item of tier 2, 3, 4, 5',
    ]);
  });

  it('prints the bank per family and tier, the two scores, the mean fixed, the forecast and the verdict', () => {
    const text = formatHardness(
      'banked',
      hard(rows([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], 300, TIERS)),
    );
    expect(text).toContain('Bank at iteration 10: 300 items, 40 pass on every seed.');
    expect(text).toMatch(/core\s+100\s+80\s+60\s+40\s+20\s+0\s+300\s+260/);
    expect(text).toContain('Score at iteration 0: 0.1 (30 of 300).');
    expect(text).toContain(
      'Score after the pilot: 0.1333 (40 of 300, iteration 10; 10 of 10 pilot iterations).',
    );
    expect(text).toContain('Items fixed per iteration: 1 (mean over the pilot).');
    expect(text).toContain('Forecast: 260 iterations to 100 percent (260 failing / 1).');
    expect(text).toContain('Gate: HOLDS');
  });
});

describe('the bar a validator records in GATE.md', () => {
  it('reads the score, forecast and causes lines, and only a bar lower than section 12.4', () => {
    expect(parseGate('Max score after the pilot: 0.42')).toEqual({
      maxScore: 0.42,
      minForecast: null,
      minCauses: null,
    });
    expect(
      parseGate('* Max score after the pilot: 0.75\n- Min forecast: 30\nMin distinct failing causes: 77\n'),
    ).toEqual({ maxScore: 0.75, minForecast: 30, minCauses: 77 });
    // A stricter or out-of-range value is no lowered bar.
    expect(
      parseGate('Max score after the pilot: 0.4\nMin forecast: 100\nMin distinct failing causes: 120'),
    ).toEqual({
      maxScore: null,
      minForecast: null,
      minCauses: null,
    });
    expect(
      parseGate('Max score after the pilot: 1.2\nMin forecast: 0\nMin distinct failing causes: -3'),
    ).toEqual({
      maxScore: null,
      minForecast: null,
      minCauses: null,
    });
    expect(parseGate('no bar here')).toEqual({ maxScore: null, minForecast: null, minCauses: null });
  });

  it('holds a lowered forecast and score that section 12.4 fails, and fails a forecast under the generator floor of 50', () => {
    // 300 items, 150 pass at iteration 0, 3 more per pilot fix: score 0.6, forecast 30 under 12.4.
    const journal = rows([150, 153, 156, 159, 162, 165, 168, 171, 174, 177, 180], 300, TIERS);
    expect(measureHardness(journal, { audit: PASSING_AUDIT }).gate.reasons).toEqual([
      'the forecast 40 is under 100: extend the bank (12.2)',
      'the score after the pilot 0.6 is above 0.4',
    ]);
    const gate = 'Max score after the pilot: 0.67\nMin forecast: 30\n';
    const held = measureHardness(journal, { audit: PASSING_AUDIT, gate });
    expect(held.gate).toEqual({ holds: true, reasons: [] });
    expect(held).toMatchObject({ maxScore: 0.67, minForecast: 30, minCauses: 100, lowered: true });
    const strict = measureHardness(journal, {
      audit: PASSING_AUDIT,
      gate: 'Min forecast: 50\nMax score after the pilot: 0.67',
    });
    expect(strict.gate.reasons).toEqual([
      'the forecast 40 is under 50 (the bar GATE.md lowers): extend the bank (12.2)',
    ]);
    expect(formatHardness('generator', held)).toContain(
      'forecast at least 30, score after the pilot at most 0.67',
    );
  });

  it('honours the bars the committed GATE.md files record', () => {
    const bar = (component: string) =>
      parseGate(readFileSync(join(ROOT, 'validators', component, 'GATE.md'), 'utf8'));
    expect(bar('estate')).toEqual({ maxScore: 0.75, minForecast: 30, minCauses: null });
    expect(bar('map')).toEqual({ maxScore: 0.42, minForecast: null, minCauses: null });
    expect(bar('stats')).toEqual({ maxScore: 0.7, minForecast: 70, minCauses: 60 });
  });
});

describe('catch items in the journal', () => {
  const withCatch = (size: number, passing: number) => (row: JournalRow) =>
    JournalRowSchema.parse({ ...row, catchItems: { size, passing } });

  it('reads the larger of the hardness score and the score over every item, so the check is never looser', () => {
    // Hardness items pass 40 of 300 at the end; catch items pass 50 of 50, so every item passes 90 of 350.
    const base = rows([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], 300, TIERS);
    const passingCatch = hard(base.map(withCatch(50, 50)));
    expect(passingCatch.pilot.end?.score).toBeCloseTo(90 / 350, 10);
    // Catch items that fail more often than the hardness items leave the hardness score in charge.
    const failingCatch = hard(base.map(withCatch(50, 0)));
    expect(failingCatch.pilot.end?.score).toBeCloseTo(40 / 300, 10);
    // A bank whose catch items pass far more often is held to its whole score: here 0.4 is crossed.
    const crossing = hard(
      rows([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110], 300, TIERS).map(withCatch(52, 52)),
    );
    expect(crossing.pilot.end?.score).toBeCloseTo(162 / 352, 10);
    expect(
      crossing.gate.reasons.some((reason) => /score after the pilot 0\.4602 is above 0\.4/.test(reason)),
    ).toBe(true);
    // The forecast and the causes read the hardness items alone.
    expect(passingCatch.forecast).toBe(260);
    expect(failingCatch.forecast).toBe(260);
  });

  it('caps catch items at 15 percent of the bank and refuses a row whose catch items pass more than they hold', () => {
    const base = rows([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], 300, TIERS);
    expect(hard(base.map(withCatch(52, 0))).gate.reasons).toEqual([]);
    expect(hard(base.map(withCatch(60, 0))).gate.reasons).toEqual([
      'catch items are 16.67 percent of the bank at iteration 10, over the 15 percent cap (12.4)',
    ]);
    const issues = JournalRowSchema.safeParse({ ...journalRow(1), catchItems: { size: 2, passing: 3 } });
    expect(issues.success).toBe(false);
  });

  it('prints the catch items of the latest row in the hardness report', () => {
    const h = hard(rows([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], 300, TIERS).map(withCatch(50, 48)));
    expect(h.bank.catchItems).toEqual({ size: 50, passing: 48 });
    expect(formatHardness('planted', h)).toContain(
      'Catch items, apart and counted for no hardness: 50, 48 pass on every seed.',
    );
  });
});
