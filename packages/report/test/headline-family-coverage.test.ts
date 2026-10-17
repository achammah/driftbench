import { mulberry32, simulateFamilyCoverage } from '@agent-nexus/driftbench-stats';
import { describe, expect, it, vi } from 'vitest';
import * as hierarchical from '../../stats/src/hierarchical';
import { suiteHeadline } from '../src/headline';
import { run } from './support';

/** E[phi^members] for phi ~ Beta(d theta, d (1 - theta)): a whole family passes. */
function allPassMean(theta: number, d: number, members: number): number {
  let mean = 1;
  for (let j = 0; j < members; j += 1) mean *= (d * theta + j) / (d + j);
  return mean;
}

/** Conditional on a binomial count, all placements of its successes are equally likely. */
function repeats(n: number, k: number, rng: () => number): boolean[] {
  const values = Array.from({ length: n }, (_, i) => i < k);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j] as boolean, values[i] as boolean];
  }
  return values;
}

describe('the actual headline on simulated root families', () => {
  it('covers its documented all-pass mean, while treating children as independent undercovers', () => {
    const original = hierarchical.hierarchicalBetaBinomial;
    const spy = vi.spyOn(hierarchical, 'hierarchicalBetaBinomial');
    const coverage = { headline: 0, children: 0, pooledFamilies: 0 };
    let cells = 0;
    let observed = 0;
    let readingHeadline = false;
    let rootCountsMatch = true;
    try {
      for (const families of [12, 40]) {
        for (const children of [3, 8]) {
          for (const theta of [0.6, 0.9]) {
            for (const dFamily of [0.5, 2, 8]) {
              cells += 1;
              const truth = allPassMean(theta, dFamily, children);
              const rng = mulberry32(5000 + cells);
              let held = 0;
              // Observe the simulator's child counts without duplicating its beta sampler or changing
              // its random stream. Randomly place each child's successes among its repeats, then feed
              // the recorded parent forest through the production headline, not an interval surrogate.
              spy.mockImplementation((counts, options) => {
                if (!readingHeadline && counts.length === families * children) {
                  const outcomes = counts.map(({ n, k }) => repeats(n, k, rng));
                  const runs = Array.from({ length: 3 }, (_, repeat) => {
                    const base = run({
                      specId: 'simulated-forest',
                      repeat,
                      blocks: outcomes.map((passes) => ({ pass: passes[repeat] as boolean })),
                    });
                    return {
                      ...base,
                      blocks: base.blocks.map((block, index) => {
                        const root = index - (index % children);
                        const blocked = outcomes.slice(root, index).some((passes) => !passes[repeat]);
                        return {
                          ...block,
                          specIndex: index,
                          blockId: `member-${index}`,
                          // Chains exercise transitive ancestry; the first member is the sampled root.
                          ...(index === root ? {} : { parent: `member-${index - 1}` }),
                          // The runner stops a chain at its first failure. This leaves its all-pass
                          // outcome unchanged while recording only outcomes it could have measured.
                          ...(blocked
                            ? {
                                pass: false,
                                status: 'blocked' as const,
                                verdicts: [],
                                drift: [],
                                blocked: { by: `member-${index - 1}`, root: `member-${root}` },
                              }
                            : {}),
                        };
                      }),
                    };
                  });
                  readingHeadline = true;
                  const headline = suiteHeadline(runs, (run) => run.specId);
                  readingHeadline = false;
                  rootCountsMatch &&= headline?.trees === families && headline?.n === families * 3;
                  if (headline && headline.lower <= truth && truth <= headline.upper) held += 1;
                  observed += 1;
                }
                return original(counts, options);
              });
              const result = simulateFamilyCoverage(
                { families, children, runs: 3, theta, dFamily, dChild: 2 },
                { reps: 400, seed: 100 + cells },
              );
              coverage.headline += held / 400 / 24;
              // These controls estimate the block mean theta, not the all-pass mean above.
              coverage.children += result.coverage['children as trees'] / 24;
              coverage.pooledFamilies += result.coverage['families as trees'] / 24;
            }
          }
        }
      }
    } finally {
      spy.mockRestore();
    }
    expect(cells).toBe(24);
    expect(observed).toBe(9600);
    expect(coverage.children).toBeLessThan(0.92);
    expect(coverage.pooledFamilies).toBeGreaterThanOrEqual(0.92);
    expect(coverage.headline).toBeGreaterThanOrEqual(0.92);
    expect(coverage.headline).toBeLessThan(0.99);
    expect(rootCountsMatch).toBe(true);
    expect(
      Object.fromEntries(Object.entries(coverage).map(([key, value]) => [key, Number(value.toFixed(6))])),
    ).toMatchInlineSnapshot(`
      {
        "children": 0.747708,
        "headline": 0.950208,
        "pooledFamilies": 0.956458,
      }
    `);
  }, 120_000);
});
