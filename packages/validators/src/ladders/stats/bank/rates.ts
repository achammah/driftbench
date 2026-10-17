import { join } from 'node:path';
import { clusterOutcomes, normal } from '../draw';
import type { StatsImpl } from '../reference';
import { attempt, type BankItem, fail, ok, type Tier } from './item';

/**
 * Level `simulation`, the error rates the documentation promises, counted over seeded draws with a planted truth:
 * - family `coverage-simulation`: Newcombe's paired difference holds the truth at the documented 95 percent; a
 *   test rejects a true null at most at its level (McNemar, Wilcoxon, Kolmogorov-Smirnov); non-inferiority is
 *   declared at the margin at most at its one-sided level; Benjamini-Hochberg keeps the false discovery rate at q;
 * - the clustered intervals of the suite headline (`hierarchicalBetaBinomial`, `wilsonEffective`) hold the planted mean
 *   of a suite of trees whose blocks move together, at the tree counts a campaign has;
 * - family `product` (tier 5): the report's run pass interval holds 95 percent at the spec counts a campaign has.
 * Bars are the documented level with three Monte Carlo standard errors of slack, never a measured value
 * (validators/stats/NEEDS.md, "Depth").
 */

const PAIRED = 'packages/stats/src/paired.ts';
const DRIFT = 'packages/stats/src/drift.ts';
const MULTIPLE = 'packages/stats/src/multiple.ts';
const ESTIMATE = 'packages/report/src/estimate.ts';
const HIERARCHICAL = 'packages/stats/src/hierarchical.ts';
const EFFECTIVE = 'packages/stats/src/effective.ts';

/** The lowest coverage a 95 percent interval may show over `draws`: 0.95 less three standard errors. */
export function coverageBar(draws: number, level = 0.95): number {
  return level - 3 * Math.sqrt((level * (1 - level)) / draws);
}
/** The highest rejection rate a level-`alpha` test may show over `draws`: alpha plus three standard errors. */
export function sizeBar(draws: number, alpha: number): number {
  return alpha + 3 * Math.sqrt((alpha * (1 - alpha)) / draws);
}

function item(
  id: string,
  family: 'coverage-simulation' | 'product',
  tier: Tier,
  component: string,
  cause: string,
  check: BankItem['check'],
): BankItem {
  return { id, family, tier, level: 'simulation', component, cause, budgetMs: 300_000, check };
}

const fixed = (x: number) => x.toFixed(4);

/** A paired table of n specs: baseline pass rate pb, candidate pc, both-pass probability p11. */
function pairedTable(rng: () => number, n: number, pb: number, pc: number, p11: number) {
  const p10 = pb - p11;
  const p01 = pc - p11;
  const t = { bothPass: 0, regressed: 0, improved: 0, bothFail: 0 };
  for (let i = 0; i < n; i += 1) {
    const u = rng();
    if (u < p11) t.bothPass += 1;
    else if (u < p11 + p10) t.regressed += 1;
    else if (u < p11 + p10 + p01) t.improved += 1;
    else t.bothFail += 1;
  }
  return t;
}

/** A both-pass probability between independence-free bounds: from max(0, pb + pc - 1) to min(pb, pc). */
const jointOf = (rng: () => number, pb: number, pc: number) => {
  const lo = Math.max(0, pb + pc - 1);
  const hi = Math.min(pb, pc);
  return lo + (hi - lo) * (0.3 + 0.7 * rng());
};

function newcombe(n: number, draws: number): BankItem['check'] {
  return ({ s, rng }) => {
    let held = 0;
    let firstMiss = '';
    for (let d = 0; d < draws; d += 1) {
      const pb = 0.2 + 0.75 * rng();
      const pc = Math.min(0.99, Math.max(0.01, pb + 0.3 * (rng() - 0.5)));
      const table = pairedTable(rng, n, pb, pc, jointOf(rng, pb, pc));
      const got = attempt(() => s.pairedRateDifference(table));
      if (got.error) return fail(`pairedRateDifference(${JSON.stringify(table)}) threw ${got.error.message}`);
      const ci = got.value as { lower: number; upper: number };
      const truth = pb - pc;
      if (ci.lower <= truth && truth <= ci.upper) held += 1;
      else if (!firstMiss)
        firstMiss = `table ${JSON.stringify(table)}, truth ${fixed(truth)}, interval [${fixed(ci.lower)}, ${fixed(ci.upper)}]`;
    }
    const bar = coverageBar(draws);
    return held / draws >= bar
      ? ok()
      : fail(
          `pairedRateDifference on ${n} paired specs: ${held} of ${draws} intervals hold the true baseline minus candidate rate (coverage ${fixed(held / draws)}, bar ${fixed(bar)}: the documented 95 percent less three standard errors). First miss: ${firstMiss}. Need: driftbench ci and compare print this interval (docs/concepts/statistics.md, pairedRateDifference).`,
        );
  };
}

function nonInferiorSize(n: number, margin: number, draws: number): BankItem['check'] {
  return ({ s, rng }) => {
    let declared = 0;
    for (let d = 0; d < draws; d += 1) {
      const pb = 0.75 + 0.2 * rng();
      const pc = pb - margin;
      const t = pairedTable(rng, n, pb, pc, jointOf(rng, pb, pc));
      const baseline: boolean[] = [];
      const candidate: boolean[] = [];
      const push = (k: number, b: boolean, c: boolean) => {
        for (let i = 0; i < k; i += 1) {
          baseline.push(b);
          candidate.push(c);
        }
      };
      push(t.bothPass, true, true);
      push(t.regressed, true, false);
      push(t.improved, false, true);
      push(t.bothFail, false, false);
      const got = attempt(() => s.nonInferiority({ baseline, candidate, margin }));
      if (got.error) return fail(`nonInferiority threw ${got.error.message}`);
      if ((got.value as { nonInferior: boolean }).nonInferior) declared += 1;
    }
    const bar = sizeBar(draws, 0.025);
    return declared / draws <= bar
      ? ok()
      : fail(
          `nonInferiority on ${n} paired specs whose true regression equals the margin ${margin}: non-inferior declared in ${declared} of ${draws} draws (rate ${fixed(declared / draws)}, bar ${fixed(bar)}: the upper bound of a two-sided 95 percent interval errs below the truth at most 2.5 percent of the time, plus three standard errors). Need: the parity verdict of driftbench compare and ci (docs/concepts/statistics.md, "The parity verdict").`,
        );
  };
}

/** The rejection rate of a test under a true null, over draws. */
function size(
  label: string,
  draws: number,
  alpha: number,
  pValueOf: (s: StatsImpl, rng: () => number) => number,
  need: string,
): BankItem['check'] {
  return ({ s, rng }) => {
    let rejected = 0;
    for (let d = 0; d < draws; d += 1) {
      const got = attempt(() => pValueOf(s, rng));
      if (got.error) return fail(`${label} threw ${got.error.message}`);
      if ((got.value as number) < alpha) rejected += 1;
    }
    const bar = sizeBar(draws, alpha);
    return rejected / draws <= bar
      ? ok()
      : fail(
          `${label} under a true null rejected at p < ${alpha} in ${rejected} of ${draws} draws (rate ${fixed(rejected / draws)}, bar ${fixed(bar)}: the level plus three standard errors). Need: ${need}.`,
        );
  };
}

const binomial = (rng: () => number, n: number, p: number) => {
  let k = 0;
  for (let i = 0; i < n; i += 1) if (rng() < p) k += 1;
  return k;
};
const poisson = (rng: () => number, mean: number) => {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = rng();
  while (p > limit) {
    k += 1;
    p *= rng();
  }
  return k;
};

type Clustered = (
  values: readonly number[],
  clusters: readonly (string | number)[],
  options?: { rate?: boolean },
) => { lower: number; upper: number } | undefined;

async function reportClustered(root: string): Promise<Clustered> {
  const mod = (await import(join(root, ESTIMATE))) as { clustered?: Clustered };
  if (typeof mod.clustered !== 'function') throw new Error(`${ESTIMATE} exports no function clustered`);
  return mod.clustered;
}

/**
 * The run pass rate of a mode as the scorecard prints it (modeReliability: `clustered(flags, line, { rate: true })`),
 * over `specs` specs of `repeats` repeats whose outcomes correlate by rho within a spec. The truth is the
 * planted pass rate of the population the specs stand for.
 */
function reportRunPass(specs: number, repeats: number, rho: number, draws: number): BankItem['check'] {
  return async ({ root, rng }) => {
    const clustered = await reportClustered(root);
    let held = 0;
    let firstMiss = '';
    for (let d = 0; d < draws; d += 1) {
      const truth = 0.6 + 0.3 * rng();
      const values: number[] = [];
      const keys: number[] = [];
      for (let spec = 0; spec < specs; spec += 1) {
        for (const v of clusterOutcomes(rng, repeats, truth, rho)) {
          values.push(v);
          keys.push(spec);
        }
      }
      const ci = clustered(values, keys, { rate: true });
      if (!ci) return fail('clustered returned no estimate on a non-empty campaign');
      if (ci.lower <= truth && truth <= ci.upper) held += 1;
      else if (!firstMiss)
        firstMiss = `${values.filter((v) => v === 1).length} of ${values.length} runs passed, truth ${fixed(truth)}, interval [${fixed(ci.lower)}, ${fixed(ci.upper)}]`;
    }
    const bar = coverageBar(draws);
    return held / draws >= bar
      ? ok()
      : fail(
          `the scorecard's run pass interval (report clustered, rate) on ${specs} specs of ${repeats} repeats, rho ${rho}: ${held} of ${draws} intervals hold the planted pass rate (coverage ${fixed(held / draws)}, bar ${fixed(bar)}). First miss: ${firstMiss}. The percentile bootstrap over few clusters is too narrow; the scorecard prints it as a 95 percent interval. Need: docs/concepts/statistics.md "reports every rate with an interval", one conversation or task being one cluster; driftbench report.`,
        );
  };
}

/**
 * A suite of `trees` trees of `size` blocks, the blocks of one tree agreeing as `rho` says, the suite's pass rate
 * planted uniformly in 0.2 to 0.8. The interval under test gets each tree's passed and tried blocks; the planted
 * rate is the truth it must hold. A suite of correlated trees is where an interval that reads every block as
 * independent covers about 0.75, and a clustered one near 0.95.
 */
function treeCoverage(
  interval: (s: StatsImpl, trees: { n: number; k: number }[]) => { lower: number; upper: number },
  name: string,
  trees: number,
  size: number,
  rho: number,
  draws: number,
): BankItem['check'] {
  return ({ s, rng }) => {
    let held = 0;
    let firstMiss = '';
    for (let d = 0; d < draws; d += 1) {
      const truth = 0.2 + 0.6 * rng();
      const counts: { n: number; k: number }[] = [];
      for (let g = 0; g < trees; g += 1) {
        const k = clusterOutcomes(rng, size, truth, rho).reduce((a, b) => a + b, 0);
        counts.push({ n: size, k });
      }
      const got = attempt(() => interval(s, counts));
      if (got.error || !got.value) return fail(`${name} threw ${got.error?.message}`);
      if (got.value.lower <= truth && truth <= got.value.upper) held += 1;
      else if (!firstMiss)
        firstMiss = `${counts.reduce((a, c) => a + c.k, 0)} of ${trees * size} blocks passed, truth ${fixed(truth)}, interval [${fixed(got.value.lower)}, ${fixed(got.value.upper)}]`;
    }
    const bar = coverageBar(draws);
    return held / draws >= bar
      ? ok()
      : fail(
          `${name} on ${trees} trees of ${size} blocks, rho ${rho}: ${held} of ${draws} intervals hold the planted pass rate (coverage ${fixed(held / draws)}, bar ${fixed(bar)}). First miss: ${firstMiss}. An interval that reads every block as independent covers about 0.75 here. Need: docs/concepts/statistics.md "The suite headline": the interval widens when the blocks of a tree move together; driftbench report.`,
        );
  };
}

export function rateItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const n of [30, 100]) {
    out.push(
      item(
        `simulation.newcombe.n${n}`,
        'coverage-simulation',
        4,
        PAIRED,
        "pairedRateDifference's interval covers less than 95 percent",
        newcombe(n, 2000),
      ),
    );
  }
  out.push(
    item(
      'simulation.non-inferiority.size-n100',
      'coverage-simulation',
      4,
      PAIRED,
      'nonInferiority declares non-inferiority too often at the margin',
      nonInferiorSize(100, 0.05, 2000),
    ),
  );
  out.push(
    item(
      'simulation.mcnemar.size-chi-square',
      'coverage-simulation',
      4,
      PAIRED,
      'mcnemar rejects a true null more often than its level',
      size(
        'mcnemar on 25 to 80 discordant pairs (chi-square)',
        4000,
        0.05,
        (s, rng) => {
          const discordant = 25 + Math.floor(56 * rng());
          const b = binomial(rng, discordant, 0.5);
          return s.mcnemar(b, discordant - b).pValue;
        },
        'driftbench compare prints the McNemar p-value of every criterion (docs/concepts/statistics.md)',
      ),
    ),
  );
  const wilcoxonNeed =
    'driftbench compare prints the Wilcoxon p-value of the drift counts (docs/concepts/statistics.md)';
  out.push(
    item(
      'simulation.wilcoxon.size-n15',
      'coverage-simulation',
      4,
      PAIRED,
      'wilcoxonSignedRank rejects a true null more often than its level',
      size(
        'wilcoxonSignedRank on 15 continuous pairs',
        3000,
        0.05,
        (s, rng) => {
          const x = Array.from({ length: 15 }, () => normal(rng));
          const y = Array.from({ length: 15 }, () => normal(rng));
          return s.wilcoxonSignedRank(x, y).pValue;
        },
        wilcoxonNeed,
      ),
    ),
    item(
      'simulation.wilcoxon.size-ties-n80',
      'coverage-simulation',
      4,
      PAIRED,
      'wilcoxonSignedRank rejects a true null more often than its level',
      size(
        'wilcoxonSignedRank on 80 pairs of drift counts (ties and zeros)',
        3000,
        0.05,
        (s, rng) => {
          const x = Array.from({ length: 80 }, () => poisson(rng, 1.5));
          const y = Array.from({ length: 80 }, () => poisson(rng, 1.5));
          return s.wilcoxonSignedRank(x, y).pValue;
        },
        wilcoxonNeed,
      ),
    ),
  );
  const ksNeed = 'driftbench monitor alarms on the KS test (docs/traces.md)';
  out.push(
    item(
      'simulation.ks.size-n30-40',
      'coverage-simulation',
      4,
      DRIFT,
      'ksTest rejects a true null more often than its level',
      size(
        'ksTest on 30 against 40 continuous values',
        3000,
        0.05,
        (s, rng) =>
          s.ksTest(
            Array.from({ length: 30 }, () => normal(rng)),
            Array.from({ length: 40 }, () => normal(rng)),
          ).pValue,
        ksNeed,
      ),
    ),
    item(
      'simulation.ks.size-ties',
      'coverage-simulation',
      4,
      DRIFT,
      'ksTest rejects a true null more often than its level',
      size(
        'ksTest on 40 against 40 latencies rounded to whole seconds (ties)',
        3000,
        0.05,
        (s, rng) =>
          s.ksTest(
            Array.from({ length: 40 }, () => Math.round(3 + normal(rng))),
            Array.from({ length: 40 }, () => Math.round(3 + normal(rng))),
          ).pValue,
        ksNeed,
      ),
    ),
  );
  out.push(
    item(
      'simulation.benjamini-hochberg.fdr',
      'coverage-simulation',
      4,
      MULTIPLE,
      'benjaminiHochberg lets the false discovery rate exceed q',
      ({ s, rng }) => {
        const draws = 3000;
        let fdr = 0;
        for (let d = 0; d < draws; d += 1) {
          const nulls = 12;
          const p: number[] = [];
          // A true null's p-value is uniform; a false null's is any smaller one (here u^8): BH controls the
          // rate whatever the false nulls look like, when the tests are independent.
          for (let i = 0; i < 20; i += 1) p.push(i < nulls ? rng() : rng() ** 8);
          const got = attempt(() => s.benjaminiHochberg(p, 0.1));
          if (got.error || !got.value) return fail(`benjaminiHochberg threw ${got.error?.message}`);
          const rejected = got.value.rejected;
          const r = rejected.filter(Boolean).length;
          const falseOnes = rejected.slice(0, nulls).filter(Boolean).length;
          if (r > 0) fdr += falseOnes / r;
        }
        const mean = fdr / draws;
        // FDR = q m0 / m under independence; the slack is three standard errors of a proportion at q.
        const bar = 0.1 * (12 / 20) + 3 * Math.sqrt((0.1 * 0.9) / draws);
        return mean <= bar
          ? ok()
          : fail(
              `benjaminiHochberg at q 0.1 over 20 independent tests, 12 true nulls: false discovery rate ${fixed(mean)} over ${draws} draws (bar ${fixed(bar)}: q m0 / m plus three standard errors). Need: driftbench compare adjusts the criteria with it; the pilot's wording test holds at a false discovery rate (docs/generating.md).`,
            );
      },
    ),
  );
  const runPassCause = "the report's run pass interval covers less than 95 percent with few specs";
  // Draws: enough that the bar sits several standard errors from where a correct 95 percent interval lands.
  for (const [specs, repeats, rho, draws] of [
    [6, 5, 0.3, 1000],
    [20, 3, 0.3, 4000],
  ] as const) {
    out.push(
      item(
        `simulation.report-run-pass.s${specs}x${repeats}`,
        'product',
        5,
        ESTIMATE,
        runPassCause,
        reportRunPass(specs, repeats, rho, draws),
      ),
    );
  }
  for (const [trees, size, rho] of [
    [12, 6, 0.3],
    [20, 5, 0.5],
  ] as const) {
    const id = `g${trees}x${size}-rho${rho}`;
    out.push(
      item(
        `simulation.hierarchical.${id}`,
        'coverage-simulation',
        4,
        HIERARCHICAL,
        'hierarchicalBetaBinomial covers less than 95 percent when the blocks of a tree move together',
        treeCoverage(
          (s, counts) => s.hierarchicalBetaBinomial(counts),
          'hierarchicalBetaBinomial',
          trees,
          size,
          rho,
          1000,
        ),
      ),
      item(
        `simulation.wilson-effective.${id}`,
        'coverage-simulation',
        4,
        EFFECTIVE,
        'wilsonEffective covers less than 95 percent when the blocks of a tree move together',
        treeCoverage((s, counts) => s.wilsonEffective(counts), 'wilsonEffective', trees, size, rho, 1000),
      ),
    );
  }
  return out;
}
