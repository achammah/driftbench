# Statistics

One run proves nothing. driftbench repeats runs, reports every rate with an interval, and compares two versions of an agent with paired tests. The functions on this page ship in `@agent-nexus/driftbench-stats`. Each matches a reference value computed in Python with scipy and numpy and committed as a test fixture (`packages/stats/test/reference`).

What is built and what is not:

* Built, phase 1: repeats in a campaign, and the minimum detectable effect `campaign plan` prints. See [running](../running.md).
* Built: every function below, as a library.
* Built, used by other parts: `campaign status --detail` puts a `bootstrapCI` interval on the compounding index ([run modes](run-modes.md#the-compounding-index)); the gate uses `passK` and `wilson` ([generating tests](../generating.md)); judge calibration uses `cohenKappa`, `krippendorffAlpha` and `wilson` ([judges](judges.md)); the variance pilot uses the variance components ([generating tests](../generating.md)).
* Built, phase 4: the scorecard of a stored campaign with an interval on every rate (`driftbench report`, see [example scorecards](../scorecards.md)), the paired comparison and the parity verdict of a whole campaign (`driftbench compare`), and the CI gate (`driftbench ci`). See the [CLI reference](../reference/cli.md#driftbench-report-and-driftbench-compare). There is no `stats` command.

The same statistics serve conversations and tasks. One conversation, or one task, is one cluster. An artifact check is a pass or a fail per repeat, so pass^k reads the same way for a workbook as for a reply.

```ts
import { mde, nonInferiority, passK, repeatsForFloor, wilson, zeroFailureBound } from '@agent-nexus/driftbench-stats';

console.log(wilson(18, 20));
console.log(passK(4, 5, 2), zeroFailureBound(0.05));
console.log(mde({ n: 100, repeats: 5, baselineRate: 0.9, rho: 0.3 }));
console.log(repeatsForFloor({ flipRate: 0.1, floor: 0.05 }));

const verdict = nonInferiority({
  baseline: [true, true, true, true, false, true, true, true],
  candidate: [true, true, false, true, true, true, true, true],
  margin: 0.05,
});
console.log(verdict.nonInferior, verdict.reason);
```

It prints:

```
{ estimate: 0.9, lower: 0.6989663547715128, upper: 0.9721335187862319 }
0.6000000000000001 59
{
  effect: 0.09264469664389918,
  effectiveN: 227.27272727272725,
  designEffect: 2.2
}
{ repeats: 277, floor: 0.04996253425649987 }
false upper bound 0.3746 of the regression effect is not below the margin 0.05
```

One regressed pair and one improved pair out of eight leave the candidate unproven: the interval on the regression effect is far wider than a 5-point margin.

## Repeats

A campaign runs each spec several times in each mode (`--repeats`). With c passing runs out of n:

| Function | Computes |
|---|---|
| `passK(c, n, k)` | pass^k, the probability that k runs drawn from the n all pass: `C(c, k) / C(n, k)`, the estimator of [arXiv 2406.12045](https://arxiv.org/pdf/2406.12045) |
| `passAtK(c, n, k)` | pass@k, the probability that at least one of k runs passes: `1 - C(n - c, k) / C(n, k)`, the estimator of [arXiv 2107.03374](https://arxiv.org/pdf/2107.03374) |
| `unreliability(samples)` | the 90th percentile minus the 10th of the scores across repeats |

Both forms are computed as products, so they never overflow. pass^k falls as k grows when an agent is inconsistent, even if its average looks fine.

## Intervals on pass^k and pass@k

Runs that did not complete count as failing in the value. Their outcome is unknown, so the interval also covers both ends: all of them failing and all of them passing. A line with incomplete runs is flagged "incomplete" in the scorecard. `--withhold-incomplete` on `driftbench report` drops the value for such a line and keeps only its count, so the scorecard reports nothing it cannot support.

Each pass^k and pass@k value comes with an interval for every k. The interval is the Wilson bounds of the per-run rate, raised to k, widened where needed so that it contains the value. In a seeded simulation over 36 cells of run rate, run count and k, the interval covered the true value in at least 91% of draws, and the value always lay inside its interval.

## Repeat reducers per criterion

A criterion can name a repeat reducer (`mode`, `median` or `at_least:<k>`). It reduces the criterion's verdicts across the repeats of one spec to one verdict, shown in the scorecard's "Criteria across repeats" table and on the `driftbench report` command line. The rules are on the [judges](judges.md#repeat-reducers) page.

## Intervals

| Function | Computes |
|---|---|
| `wilson(k, n, z)` | the Wilson score interval for k successes in n; `z` defaults to the two-sided 95 percent value |
| `clopperPearson(k, n, alpha)` | the exact interval at level `1 - alpha`, from the beta quantile; `alpha` defaults to 0.05 |
| `zeroFailureBound(p, alpha)` | the number of independent failure-free runs needed to claim a failure rate below `p` at confidence `1 - alpha`: 59 for 5 percent at 95 percent |
| `bootstrapCI(values, { clusters, iterations, method, alpha, seed, statistic })` | a bootstrap interval that resamples whole clusters |
| `wilsonEffective(clusters, { alpha, quantile })` | the pooled pass rate over clusters of `{ n, k }`, with the design effect, the effective blocks `n_eff` and the Wilson interval on `n_eff` |
| `hierarchicalBetaBinomial(trees, { alpha })` | the hierarchical Beta-Bernoulli interval for the mean pass rate of a suite of trees of `{ n, k }` |
| `simulateCoverage(cell, { reps, seed })` | the coverage and width of four intervals on simulated suites of one setting: the check that an interval keeps its promise |
| `simulateFamilyCoverage(cell, { reps, seed })` | the coverage and width of three intervals on simulated suites with parents (families of children, each child run several times): Wilson on all runs, the hierarchical interval with every child as a tree, and with every family as a tree |

`bootstrapCI` takes one cluster key per value: every value of one conversation carries the conversation's key, so the blocks of a run are never treated as independent samples. Without keys every value is its own cluster. `iterations` defaults to 2000, `method` is `percentile` (the default) or `basic`, `alpha` defaults to 0.05, and `seed` defaults to 1: the same seed gives the same interval. `statistic` replaces the pooled mean with any function of the resampled values.

The scorecard's pass rate over specs, with several repeats of each, does not use the percentile bootstrap: with five or six specs it holds the true rate in about 82 percent of draws. It prints the Wilson interval on the effective runs instead: the runs divided by the design effect that the spread of the spec rates implies, with the Student t quantile on the specs less one in place of z. On 6 specs of 5 repeats at `rho` 0.3 it holds the true rate in about 97 percent of draws, on 20 specs of 3 repeats in about 95 percent (planted designs, 4000 draws). Its method name in the report is `wilson, design effect`. The campaign-level criteria (`--aggregate pass-rate:>=0.8`, see [aggregates](../aggregates.md)) print the same interval over the goldens of the campaign, because their runs are clustered the same way. The scorecard's end state match tile reads the same way. `wilsonEffective` is that interval as a function: it takes the blocks passed and tried per cluster, prints the design effect and `n_eff` next to it, and takes `quantile: 'z'` for the normal form. When every block passes or every block fails the spread of the cluster rates is zero and tells nothing, so each cluster counts once (`degenerate` is true).

### A rate over goldens

The end state match tile of the scorecard is a rate over runs grouped in goldens. A golden is one spec on one target in one mode, with one perturbation in mode P. The goldens, not the runs, are the independent units. With `c` goldens, golden `i` holding `n_i` runs of which `k_i` succeed, let `N` be the sum of the `n_i`, `K` the sum of the `k_i` and `p = K / N`:

* The counts are exact: `K` of `N`. The estimate is `p`, the share of all runs.
* The variance of `p` is the ratio estimator with the small-cluster factor: `V = c / (c - 1) * sum((k_i - p * n_i)^2) / N^2`.
* The effective runs are `n_eff = p * (1 - p) / V`, kept between 1 and `N`; `V = 0` gives `N`. The design effect is `N / n_eff`.
* The interval is the Wilson score interval on `n_eff` with the Student t quantile `q` on `c - 1` degrees of freedom (95 percent, two-sided): centre `(p + q^2 / (2 n_eff)) / (1 + q^2 / n_eff)`, half-width `q * sqrt(p (1 - p) / n_eff + q^2 / (4 n_eff^2)) / (1 + q^2 / n_eff)`, both bounds kept within 0 and 1.
* When every run agrees (`p` is 0 or 1) the spread between goldens is zero and tells nothing: each golden counts once, and the interval is the Wilson interval of `c` goldens, all succeeding or all failing, with the normal quantile.
* With one golden the spread between goldens cannot be measured: the interval is the plain Wilson interval of `K` of `N`.
* When every golden holds one run, the goldens are the runs: the interval is the plain Wilson interval of `K` of `N`, the same as for independent runs.

### The suite headline

A suite is clustered three ways: the repeats of one golden, the realisations of one class, and the children of one parent. For the headline of a whole suite the scorecard prints the **mean over trees** with the **hierarchical Beta-Bernoulli interval** (`hierarchicalBetaBinomial`). Each tree has its own pass rate, drawn from a Beta distribution around the suite's mean. The spread of those tree rates sets how far the blocks of one tree move together, so the interval widens when trees disagree and narrows when they agree. Every tree weighs the same, so a golden with ten repeats does not outvote one with two. The posterior is computed on a fixed grid: there is no sampling and no seed, and the same trees always give the same interval. The method name in the report is `hierarchical`.

Beside the headline the scorecard prints `n_eff` (the runs the clustering is worth), the design effect, the smallest drop two suites like it detect at 80 percent power, and the share of runs that gave no verdict (did not complete, and `blocked` or `not_run` when a run carries those states). One golden has no spread to measure, so it prints no interval. The command line prints the same line per mode. For six goldens where 5 of 5, 5 of 5, 4 of 5, 0 of 5, 2 of 5 and 2 of 2 runs pass:

```text
Suite pass rate, mode F: 70.0% [35.4%, 88.2%] (hierarchical 95% interval); 6 goldens, n_eff 7.3 runs (design effect 3.69), detectable drop 65.3 points at 80% power.
```

Which interval to use:

| Interval | For | Coverage on simulated suites |
|---|---|---|
| naive Wilson | independent units only; never a headline for clustered results | 73.9 percent |
| Wilson on `n_eff`, normal quantile | interactive output | 91.3 percent |
| Wilson on `n_eff`, Student t quantile | a rate of one block or one conversation in the report | 93.1 percent |
| hierarchical | the suite headline and any published result | 95.3 percent |

The coverage column is the share of simulated suites whose interval held the true mean (95 percent is the target), averaged over 24 cells of Bowyer, Aitchison and Ivanova's clustered model: 12 or 50 trees, tree sizes of 3 or the real sizes of the Acme parent forest, a true mean of 0.6 or 0.9, and a concentration of 0.5, 2 or 8 (strong to mild agreement inside a tree), with 400 simulated suites per cell. `simulateCoverage` runs one cell; the test `packages/stats/test/clustered.test.ts` runs the 24 in about three seconds and requires the naive interval under 80 percent, Wilson on `n_eff` at 90 percent or more and the hierarchical interval at 93 percent or more. On the research grid of 160 cells with 5,000 suites each, naive Wilson covered 73.5 percent and Wilson on `n_eff` (normal quantile) 91.0 percent; the hierarchical interval was run on 24 cells and covered 95.7 percent, 91.0 percent in its worst cell. A headline over few trees (under a dozen) is the least certain.

### Suites with parents

The children of one parent inherit its end state, so they move together. A tree for the headline is then the whole family (the root and all its descendants), not each child. `simulateFamilyCoverage` measures the difference. Each family has a pass rate around the suite's mean, each child a rate around its family's, and each child is run several times. The hierarchical interval is read with every child as a tree (the grouping of the headline today) and with every family as a tree.

Measured on 48 cells (12 or 40 families, 3 or 8 children each, 3 runs per child, a true mean of 0.6 or 0.9, a family concentration of 0.5, 2 or 8, a child concentration of 2 or 20, 400 simulated suites per cell, the cells numbered 1 to 48 in the order of that list with the first factor changing slowest, and cell `i` run with seed 100 + `i`). The means and worst cells below are from that seed; six base seeds (100, 200, 300, 400, 500, 600) gave the ranges in the last column:

| Reading | Mean coverage (seed 100) | Worst cell (seed 100) | Worst cell, six seeds |
|---|---|---|---|
| naive Wilson on all runs | 59.8 percent | 31.3 percent | 31.3 to 35.0 percent |
| hierarchical, every child a tree | 74.2 percent | 48.5 percent | 48.5 to 50.7 percent |
| hierarchical, every family a tree | 95.5 percent | 90.0 percent | 88.3 to 90.8 percent |

* With strong agreement inside a family, grouping by child leaves the interval too narrow: it holds the true mean in about three suites of four. Grouping by family restores it to the target.
* Without a family effect (the control in the test) both groupings cover, so grouping by family costs nothing there.
* The worst cell is seed-dependent, because each cell rests on 400 suites (a single cell near 90 percent moves by about 2 points between seeds). In all six seeds the weakest family-grouping cell had 8 children per family, a true mean of 0.9 and mild agreement between families (a family concentration of 8); the six seeds put it between 88.3 and 90.8 percent. The mean over the 48 cells moved between 95.4 and 95.6 percent.
* The suite headline groups a spec with parent links by family: one tree per root, never one per child (see [Parent-linked suites](#parent-linked-suites)). The test `packages/stats/test/family-coverage.test.ts` runs a 24-cell subset in about four seconds and requires naive Wilson under 70 percent, the child grouping under 85 percent, the family grouping at 93 percent or more, and the family grouping ahead in at least 20 of the 24 cells.

## Where results vary

Two runs of the same spec can differ, and two wordings of the same situation can differ too. Before a difference between two versions means anything, it is read against that spread: the noise floor.

| Function | Computes |
|---|---|
| `varianceComponents(observations, { levels, residual })` | how the variance of an outcome splits across nested levels |
| `icc(result)` | per level, the correlation of two observations that share that level |
| `designEffect(m, rho)`, `effectiveSampleSize(n, m, rho)` | the design effect `1 + (m - 1) rho` of clusters of size m, and n divided by it |
| `neymanAllocation({ sizes, sds, total })` | how to spread a fixed number of conversations across strata |
| `repeatsForFloor({ variance, flipRate, floor, z, blocks, difference })` | the repeats per block that keep run-to-run noise under a floor |

* `varianceComponents` reads observations, each a pass flag (true counts as 1) or a score, with its `path`: the group at each level, outermost first. The default levels are `cell`, `conversation` and `wording`, and each observation is one `repeat`, the residual. It uses the ANOVA estimator of a nested random-effects model: the classic nested ANOVA when the data is balanced, Henderson's method I otherwise. Each component reports its estimate, its variance truncated at 0, and its share of the total; a level with one child per parent is marked not estimable.
* `icc` turns those components into the correlation of two observations that share a level. That correlation is the `rho` of the design effect: repeats of one conversation that agree with each other add less information than independent runs.
* `neymanAllocation` gives each stratum a share proportional to its size times its spread (`exact`), so a stratum where results vary more gets more conversations. `allocated` is the set of whole numbers adding up to `total` with the lowest stratified variance; rounding `exact` can miss it by one conversation.
* `repeatsForFloor` solves the half-width `z sqrt(f variance / (r blocks))` for the repeats r, with `f` 2 for a difference between two versions (the default) and 1 otherwise. Give the run-to-run `variance`, or the `flipRate` of a pass flag, whose variance is `p (1 - p)`. `z` defaults to 1.96 and `blocks` to 1. It returns the repeats and the floor they reach.

## Comparing a baseline and a candidate

Both run on the same specs.

| Function | Computes |
|---|---|
| `mcnemar(b, c, { exact })` | McNemar's test on the discordant counts: exact below 25 discordant pairs by default, else the continuity-corrected chi-square. `compare` (and so `ci`) always passes `exact: true`, at any count, and prints "McNemar exact" |
| `wilcoxonSignedRank(x, y, { method })` | Wilcoxon's signed-rank test on paired values, such as the drift count per spec; `method` is `auto` (the default, which follows scipy's choice), `exact`, `permutation` or `asymptotic` |
| `pairedRateDifference(table, alpha)` | the baseline pass rate minus the candidate's, with Newcombe's method 10 interval for paired data: Wilson limits per arm and the corrected phi correlation; `table` counts `bothPass`, `regressed`, `improved` and `bothFail` |
| `benjaminiHochberg(pvalues, q)` | false discovery rate control at `q` (default 0.05): adjusted p-values, the rejected hypotheses and the threshold |

Many criteria are compared at once, so a report applies Benjamini-Hochberg across criteria before it says that a criterion regressed.

### Carried results are never paired

A campaign that runs the [blast radius](blast-radius.md) of a change carries the stored result of every cell outside it. A carried result is the baseline result copied: paired with the baseline it agrees by construction, in a conversation as in a task. `compare` therefore pairs a candidate unit only when it is fresh, and lists each carried unit under `unpaired` with the campaign and the agent version it comes from. The tests and the parity verdict read the fresh pairs. A rate over the campaign itself counts both and says so.

## The parity verdict

`nonInferiority({ baseline, candidate, margin, pairs, alpha, gatingFlags })` judges one gating criterion. `baseline` and `candidate` hold the all-pass flag of each spec, in the same order. The candidate is non-inferior when the upper bound of the interval on the regression effect, at level `1 - alpha` (default 0.05), is below the `margin` set before the campaign, and no gating flag fires for the candidate where the baseline had none (`gatingFlags`, one flag per spec for each version). `pairs` names the specs, so the result lists the regressed ones and the new flags, with the discordant counts and the reason. Zero regressed pairs in one run is not parity: it is one draw.

The function judges one criterion. `compareCampaigns` in `@agent-nexus/driftbench-report` combines the criteria of a campaign into one verdict, below.

## The campaign verdict

`driftbench compare` and `driftbench ci` apply one rule, `compareCampaigns(baseline, candidate, { margin, minGoldens, strict, flagFamilies })`. The unit is one golden in one mode (one perturbation in P), and a golden passes when every repeat passes.

- **Non-inferior** (`ci`: `parity`, exit 0): the all-pass flag has an upper bound below the margin, every gating criterion that is not underpowered does too, and no flag family (`safety`, `forbidden`, `pii` by default) fires for the candidate where it did not for the baseline.
- **Regressed** (`ci`: `regression`, exit 1): there is evidence of a drop. A new flag, a criterion whose regression Benjamini-Hochberg keeps, or the all-pass McNemar test below `alpha` with more goldens regressed than improved.
- **Unproven** (`ci`: `not-shown-non-inferior`, exit 1): no evidence of a drop, but an interval is wider than the margin. This means too few goldens. It is never a regression.

**Underpowered criteria.** A gating criterion decided on fewer than `minGoldens` goldens (default 30) is underpowered. It is reported, and left out of the non-inferiority conjunction, because its interval cannot be narrow: on 3 goldens the upper bound is 56.1 points even when nothing changed. `strict` puts it back. New flags always gate, and so does an underpowered criterion whose regression the false discovery rate control keeps. 30 is close to the goldens one criterion needs to show non-inferiority at a 10 point margin: `goldensNeeded(0.1, 0)` is 35.

**Planning numbers.** For each criterion and for the all-pass flag the comparison reports three numbers.

| Number | Function | Meaning |
|---|---|---|
| floor | `marginFloor(n)` | the smallest margin `n` goldens can show when nothing changed: the paired upper bound at zero discordance. 27.75 points for 10 goldens, 2.79 for 134 |
| drop seen | `mde({ n, baselineRate, power: 0.8 })` | the smallest true drop from the baseline rate the goldens detect at 80% power |
| for 10 | `goldensNeeded(0.1, discordance)` | the goldens a 10 point margin needs at 80% power: the larger of the first `n` whose floor is below 10 points and the paired sample size `(z(1 - alpha / 2) + z(0.8))^2 discordance / margin^2` (Nam 1997), with the discordance seen |

**The automatic margin.** `--margin auto`, the default of `compare` and `ci`, is the smallest half point at which the baseline compared with itself is non-inferior (`autoMargin(baseline)`): the largest upper bound of the all-pass flag and of the gating criteria that are not underpowered, rounded up. It prints what sets it. A campaign with no run that passed or failed (every run is not run or blocked) has nothing to compare with itself: `report` and `ci` keep the 2 point default and say so, and `compare` exits 2 saying the two campaigns share no golden. Above 15 points it warns that the suite is too small for a tight gate, with the goldens a 15 point margin needs.

Measured on the Acme example (2026-10-12):

| Suite | Auto margin | Set by | Identity control | The faults |
|---|---|---|---|---|
| `examples/acme/golden/specs`, 10 goldens | 28 points, with the warning | the all-pass flag (27.75) | parity | of the 13 sales and ops faults the gate scores: 5 regressed, 7 not shown non-inferior; `ops-d6-deletes-readme` reads parity |
| `examples/acme/gated/specs`, 193 goldens | 7.5 points | `guards` (7); `cards` (12) and the task-only criteria (24) underpowered | parity | all 13 red as regressions, the 4 ops faults included through `--route` |

With `--strict` at 30 points the identity control on the 10-golden suite is not shown non-inferior, as before the minimum existed.

## Before a campaign

`campaign plan` prints the number of runs, the projected cost and the minimum detectable effect for the chosen repeats. If the effect is too large to be useful, the repeats go up before any money is spent.

`mde({ n, repeats, baselineRate, power, alpha, rho })` solves the two-proportion power equation for the smallest drop from the baseline rate that the campaign detects, with `n` specs per version, `repeats` per spec (default 1), `power` 0.8 and `alpha` 0.05 by default. The repeats count through the design effect: `n repeats / (1 + (repeats - 1) rho)` effective units per version. `rho` defaults to 0, which treats repeats as independent and so is optimistic; pass the `rho` that `icc` measures. It treats the two versions as independent samples, which is conservative for a paired campaign. The effect is `null` when no drop below the baseline rate is detectable.

`campaign plan` prints the effect of `mde`, with the specs as `n` and the repeats of each spec as `repeats`. `--rho <rho>` passes the correlation that `icc` measures; the default 0 counts repeats as independent. See [running](../running.md#the-minimum-detectable-effect).

## Over time

To watch a live agent, on its pass rate, cost or latency:

| Function | Computes |
|---|---|
| `cusum(series, { target, sd, k, h, warmup, reset })` | the tabular CUSUM in standard deviations: `k` 0.5 and `h` 5 by default; `target` and `sd` default to the first `warmup` points (20 at most) |
| `pageHinkley(series, { delta, threshold, minInstances })` | the two-sided Page-Hinkley test: `delta` 0.005, `threshold` 50 and `minInstances` 30 by default; set the threshold to the scale of the series |
| `ksTest(a, b, { method })` | the two-sample Kolmogorov-Smirnov test of a shift between two distributions: exact up to 10000 values per sample, the Kolmogorov limit above |

Each detector returns its statistics after every point and the alarms, with their position and direction.

`driftbench monitor` runs the three over the campaigns of a store and exits 1 when two of the three alarm. See [CLI](../reference/cli.md#driftbench-monitor).

## Judges

Cohen's kappa and Krippendorff's alpha measure how far judges agree with hand labels and with each other. See [judges](judges.md).

| Function | Computes |
|---|---|
| `cohenKappa(a, b, { weights, categories })` | kappa between two raters over the same items; `weights` is `none` (the default), `linear` or `quadratic` for ordered labels, over the order `categories` gives |
| `krippendorffAlpha(matrix, { level })` | alpha over a raters by units matrix, where a missing value is `null`; `level` is `nominal` (the default), `ordinal`, `interval` or `ratio` |

## How complete a sample is

A set of specs, or of real conversations, is a sample of the situations an agent can face. These estimators say how much of that space the sample has reached, from the number of times each class (each cell of the map) was seen:

| Function | Computes |
|---|---|
| `goodTuring(counts)` | the discovery probability `f1 / n`, the chance that the next conversation shows a class not seen yet, and the coverage `1 - f1 / n` |
| `chaoCoverage(counts)` | the sample coverage of Chao and Jost, which also uses `f2`, and the Chao1 estimate of the total number of classes |
| `hillNumbers(counts)`, `hillNumber(counts, q)` | the effective number of classes at q 0 (classes seen), 1 (the exponential of the Shannon entropy) and 2 (inverse Simpson) |

`f1` and `f2` are the classes seen once and twice, and `n` the observations. `abundances(labels)` turns a list of class labels into the counts these functions take. `driftbench space complete` prints the same quantities for a map of situations; see [CLI](../reference/cli.md#driftbench-space-complete).

## Helpers

The package also exports the pieces the functions above are built on: `mean`, `quantile`, `quantileSorted` (type 7 quantiles), `sampleVariance`, `mulberry32` (the seeded generator), `zFor`, `Z95`, `normalCdf`, `normalSf`, `normalQuantile`, `chiSquareSf`, `binomialCdf`, `betaQuantile`, `incompleteBeta`, `logGamma`, `erfc` and `kolmogorovSf`.

### Parent-linked suites

For a spec with `parent` links, the headline reads the recorded forest: each root and its descendants contribute one outcome per repeat. A tree fails when one of its measured blocks fails; blocked descendants add no repeated failures. A tree containing an unrun block and no failure is left out. Repeats of a root are grouped together for the Phase 4 hierarchical Beta-Bernoulli interval, and every root tree weighs the same. The root is the topmost ancestor in the spec's parent links (`suiteHeadline` reads them through its `parentsOf` option), so a run that recorded only descendants joins its root's tree: a replayed ancestor adds no block, as in a child-only mode T selection. A run of such a spec that recorded only roots is read by root too, never as one outcome of the whole golden. A run that failed and measured no tree (it died before its first block, or every block was not run) fails each root family of its spec once, through the `rootsOf` option the scorecard fills from the pinned spec: 12 dead families weigh as 12 failures, as 12 failed families would. Without the links, a block's root is the highest ancestor the run names. `packages/report/test/headline-family-coverage.test.ts` measures the difference on simulated suites (12 or 40 families of three branches, a true mean of 0.6 or 0.9, a family concentration of 2 or 8, two full runs and two reruns that record only the leaves, 300 suites per cell): one tree per root holds the true mean in 95.6 percent of suites (worst cell 92.0 percent), one tree per branch in 33.0 percent. Independent roots in the same spec form separate trees. JSON marks this headline with `unit: tree-run`; its `n` counts those tree outcomes, and its `runs` the scored runs. A run not run or blocked (no failure) stays out of every count and rate, even when one of its trees was measured; its share is printed. A run that fails as a whole with no failing block (incomplete, a failed end verdict or end state) fails every tree it measured. Specs without parent links keep the existing golden-level grouping. Run-level pass rates and CI gates retain their existing unit.
