import type { RunResult, Spec } from '@agent-nexus/driftbench-core';
import { betaQuantile, mulberry32 } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { clustered } from '../src/estimate';
import { headlineNote } from '../src/format';
import { renderHtml, renderSpread } from '../src/html';
import { buildScorecard } from '../src/scorecard';
import { spread } from '../src/spread';
import { headlineText } from '../src/text';
import { dataOf, run } from './support';

/** `passes` of `total` repeats of one golden pass; the others fail at their last block. */
function golden(specId: string, total: number, passes: number): RunResult[] {
  return Array.from({ length: total }, (_, repeat) =>
    run({ specId, repeat, blocks: repeat < passes ? [{}, {}] : [{}, { pass: false }] }),
  );
}

/** The scorecard JSON as `driftbench report --json` writes it, read back. */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('the suite headline where the scorecard meets the edges of a suite', () => {
  it('a suite where every run fails: no drop is detectable, each golden counts once, and the page and line say so', () => {
    const card = buildScorecard(dataOf([...golden('a', 3, 0), ...golden('b', 3, 0), ...golden('c', 2, 0)]));
    const h = card.modes[0]?.headline;
    expect(h?.method).toBe('hierarchical');
    expect(h?.estimate).toBe(0);
    expect(h?.lower).toBe(0);
    expect(h?.degenerate).toBe(true);
    expect(h?.effectiveRuns).toBe(3);
    expect(h?.detectableDrop).toBeNull();
    const line = headlineText('F', h as NonNullable<typeof h>);
    expect(line).toMatch(
      /^Suite pass rate, mode F: 0\.0% \[0\.0%, \d+\.\d%\] \(hierarchical 95% interval\); 3 goldens, /,
    );
    expect(line).toContain('every run agrees, so each golden counts once');
    expect(line).toMatch(/no drop detectable at 80% power\.$/);
    const html = renderHtml(card);
    expect(html).toContain('<p class="tile-label">Suite pass rate, F</p>');
    expect(html).toContain(
      '3 goldens, n_eff 3.0 runs (every run agrees, so each golden counts once), no drop detectable at 80% power',
    );
    // The JSON keeps every number: a null detectable drop, and finite n_eff and design effect.
    const json = roundTrip(card).modes[0]?.headline;
    expect(json?.detectableDrop).toBeNull();
    expect(json?.effectiveRuns).toBe(3);
    expect(json?.designEffect).toBeCloseTo(8 / 3, 12);
  });

  it('n_eff pressed to its floor of 1: two goldens that disagree completely give design effect = runs and no detectable drop', () => {
    const card = buildScorecard(dataOf([...golden('a', 1, 1), ...golden('b', 1, 0)]));
    const h = card.modes[0]?.headline;
    expect(h?.estimate).toBe(0.5);
    expect(h?.effectiveRuns).toBeCloseTo(1, 12);
    expect(h?.designEffect).toBeCloseTo(2, 12);
    expect(h?.detectableDrop).toBeNull();
    expect(h?.lower).toBeGreaterThanOrEqual(0);
    expect(h?.upper).toBeLessThanOrEqual(1);
    expect(headlineNote(h as NonNullable<typeof h>)).toBe(
      '2 goldens, n_eff 1.0 runs (design effect 2.00), no drop detectable at 80% power',
    );
  });

  it('a suite of one block: one golden, one run, one block, drawn without an interval on the line, the tile and the column', () => {
    const card = buildScorecard(dataOf([run({ specId: 'only', blocks: [{}] })]));
    const h = card.modes[0]?.headline;
    expect(h?.method).toBe('none');
    expect(h?.trees).toBe(1);
    expect(h?.runs).toBe(1);
    expect(h?.estimate).toBe(1);
    expect(headlineText('F', h as NonNullable<typeof h>)).toBe(
      'Suite pass rate, mode F: 100.0% no interval: one cluster (one golden); 1 golden.',
    );
    const html = renderHtml(card);
    expect(html).toContain('<p class="tile-label">Suite pass rate, F</p>');
    expect(html).toContain(
      '<span class="ci">no interval: one cluster</span> <span class="ci">1 golden</span>',
    );
    expect(html).toContain('<th scope="col">suite pass rate</th>');
  });

  it('a suite with no run has no mode, so no headline anywhere', () => {
    const card = buildScorecard(dataOf([]));
    expect(card.modes).toEqual([]);
    expect(renderHtml(card)).not.toContain('Suite pass rate');
  });

  it('every mode of a campaign gets its own headline over its own goldens', () => {
    const runs = [
      ...golden('a', 2, 2),
      ...golden('b', 2, 0),
      ...golden('a', 2, 1).map((r) => ({ ...r, mode: 'T' as const, runId: `${r.runId}-T` })),
      ...golden('b', 2, 1).map((r) => ({ ...r, mode: 'T' as const, runId: `${r.runId}-T` })),
      ...golden('c', 2, 1).map((r) => ({ ...r, mode: 'T' as const, runId: `${r.runId}-T` })),
    ];
    const card = buildScorecard(dataOf(runs));
    const byMode = new Map(card.modes.map((m) => [m.mode, m.headline]));
    expect(byMode.get('F')?.trees).toBe(2);
    expect(byMode.get('F')?.estimate).toBe(0.5);
    expect(byMode.get('T')?.trees).toBe(3);
    expect(byMode.get('T')?.estimate).toBe(0.5);
    expect(byMode.get('T')?.runs).toBe(6);
    const html = renderHtml(card);
    expect(html).toContain('<p class="tile-label">Suite pass rate, F</p>');
    expect(html).toContain('<p class="tile-label">Suite pass rate, T</p>');
  });
});

describe('a design effect estimate carries n_eff to every reader', () => {
  it('the run pass rate of a mode carries designEffect and effectiveN into the JSON, consistent with n', () => {
    const card = buildScorecard(dataOf([...golden('a', 3, 3), ...golden('b', 3, 1), ...golden('c', 3, 2)]));
    const rp = roundTrip(card).modes[0]?.runPass;
    expect(rp?.method).toBe('wilson, design effect');
    expect(rp?.n).toBe(9);
    expect((rp?.designEffect ?? 0) * (rp?.effectiveN ?? 0)).toBeCloseTo(9, 9);
    // A bootstrap or a Wilson-over-clusters estimate stays without them.
    const all = buildScorecard(dataOf([...golden('a', 2, 2), ...golden('b', 2, 2)])).modes[0]?.runPass;
    expect(all?.method).toBe('wilson, clusters');
    expect(all).not.toHaveProperty('designEffect');
    expect(all).not.toHaveProperty('effectiveN');
  });

  it('a spread cell rated with the design effect prints its n_eff on the spread view', () => {
    const runs: RunResult[] = [];
    const specs: Record<string, Partial<Spec>> = {};
    const passes = [true, true, false, true, false, false];
    for (let c = 0; c < 3; c += 1) {
      const specId = `B-c${c}`;
      specs[specId] = {
        metadata: { pilot: { cell: 'B', conversation: `B-c${c}`, wording: 0 } },
      } as Partial<Spec>;
      for (let r = 0; r < 2; r += 1) {
        runs.push(run({ specId, repeat: r, blocks: [{ pass: passes[c * 2 + r] as boolean }, {}] }));
      }
    }
    const s = spread(dataOf(runs, specs), { margin: 0.05 });
    const cell = s.cells.find((entry) => entry.cell === 'B');
    expect(cell?.rate.method).toBe('wilson, design effect');
    const est = cell?.rate as { designEffect?: number; effectiveN?: number };
    expect(est.designEffect).toBeGreaterThan(0);
    expect(est.effectiveN).toBeGreaterThan(0);
    expect(renderSpread(s)).toMatch(/<span class="ci">n_eff \d+\.\d \(design effect \d+\.\d\d\)<\/span>/);
  });
});

/**
 * The design effect interval as packages/report/src/estimate.ts computed it before PR 426 moved it into
 * wilsonEffective (origin/main at c697c7cb1): the scorecard numbers must not move by a single bit.
 */
function previousDesignEffectWilson(values: readonly number[], clusters: readonly (string | number)[]) {
  const p = values.reduce((a, b) => a + b, 0) / values.length;
  const g = new Set(clusters).size;
  const passes = new Map<string | number, number>();
  const runs = new Map<string | number, number>();
  values.forEach((v, i) => {
    const key = clusters[i] as string | number;
    passes.set(key, (passes.get(key) ?? 0) + v);
    runs.set(key, (runs.get(key) ?? 0) + 1);
  });
  const total = values.length;
  let ss = 0;
  for (const [key, y] of passes) ss += (y - p * (runs.get(key) as number)) ** 2;
  const variance = (g / (g - 1)) * (ss / (total * total));
  const effective = variance > 0 ? Math.min(total, Math.max(1, (p * (1 - p)) / variance)) : total;
  const df = g - 1;
  const x = betaQuantile(0.05, df / 2, 0.5);
  const t = Math.sqrt((df * (1 - x)) / x);
  const denominator = 1 + (t * t) / effective;
  const centre = (p + (t * t) / (2 * effective)) / denominator;
  const half =
    (t * Math.sqrt((p * (1 - p)) / effective + (t * t) / (4 * effective * effective))) / denominator;
  return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

describe('the design effect interval moved into the stats package', () => {
  it('gives the same bits as before on 300 random clustered pass flags', () => {
    const rng = mulberry32(426);
    let checked = 0;
    for (let draw = 0; draw < 300; draw += 1) {
      const g = 2 + Math.floor(rng() * 12);
      const values: number[] = [];
      const keys: string[] = [];
      for (let c = 0; c < g; c += 1) {
        const size = 1 + Math.floor(rng() * 9);
        const rate = rng();
        for (let r = 0; r < size; r += 1) {
          values.push(rng() < rate ? 1 : 0);
          keys.push(`k${c}`);
        }
      }
      const got = clustered(values, keys, { rate: true });
      if (got?.method !== 'wilson, design effect') continue;
      const want = previousDesignEffectWilson(values, keys);
      expect(got.estimate).toBe(want.estimate);
      expect(got.lower).toBe(want.lower);
      expect(got.upper).toBe(want.upper);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });
});
