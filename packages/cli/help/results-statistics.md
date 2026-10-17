---
title: "The statistics behind results"
summary: "The intervals and tests driftbench prints: the suite headline (hierarchical interval, n_eff, design effect, detectable drop), paired tests, false discovery control, noise floor, power and variance components."
commands: []
see_also:
  - results-report
  - results-compare
  - results-ci
  - results-scorecard
  - results-monitor
next:
  - results-drift-recovery
---

## What it is

One run proves nothing. driftbench repeats runs, puts an interval on every rate, and compares two versions
with paired tests. Every function below ships in `@agent-nexus/driftbench-stats` and is checked against
reference values computed with scipy and numpy (`packages/stats/test/reference`). There is no `stats`
command: the statistics appear in `report`, `compare`, `ci`, `monitor`, `holdout score`, `campaign plan`
and `pilot`.

**Units.** A golden is one spec in one mode (one perturbation in P) over every repeat; it passes when every
repeat passes. One conversation, or one task, is one cluster: its blocks and its repeats are never counted
as independent samples.

**Intervals** (all two-sided at 95%):

| Method | Used for |
|---|---|
| Wilson score interval | a rate over independent units: goldens, holdout conversations, recovery shares, and an aggregate over one golden or with one run in every golden |
| Clopper-Pearson exact | library only (`clopperPearson`) |
| Wilson on n_eff | a rate over clusters: the scorecard's pass rate over specs with repeats, and block accuracy over conversations. Wilson on the effective units `n_eff` (units divided by the design effect from the spread of the cluster rates), with the Student t quantile on clusters minus one. The cell prints `n_eff` and the design effect. An aggregate over several goldens (`report`, `ci`) takes it too, clustered by golden. Method name `wilson, design effect`, or `wilson, clusters` when every run agrees |
| hierarchical Beta-Bernoulli | the suite headline, the pass rate of a whole suite: the mean over goldens (every golden weighs the same) with a model that learns from the spread between goldens how far the runs of one golden move together. No sampling, no seed. Method name `hierarchical` |
| cluster bootstrap | a mean or a ratio over clusters that is not a pass rate: the compounding index, the drift count per run, unreliability, and the precision, recall and F1 of tool calls. 2000 percentile resamples of whole clusters, seed 1 |
| Wilson raised to k | pass^k and pass@k: the Wilson bounds of the per-run rate raised to k, widened to contain the value; runs that did not complete count both ways |
| Newcombe method 10 | the paired difference of two rates (baseline minus candidate) |

### The suite headline

The suite headline is the one number to quote for a whole suite. `report` prints it once per run mode.
It has four parts.

1. **The mean over goldens.** Each golden gets its own pass rate: the share of its repeats that passed.
   The headline is the plain mean of those rates. Every golden weighs the same, so a golden with ten
   repeats does not outvote a golden with two. A run that did not complete counts as a failed run.
2. **The hierarchical interval.** The runs of one golden tend to pass or fail together. The model gives
   each golden its own rate, drawn around the suite's mean. It learns how strong that pull is from the
   spread of the golden rates. When goldens disagree the interval widens; when they agree it narrows. The
   answer is computed on a fixed grid: there is no sampling and no seed, so the same runs always give the
   same interval.
3. **n_eff and the design effect.** Clustered runs are worth fewer independent runs. `n_eff` is that
   number: how many independent runs would give the same certainty. The design effect is the runs
   divided by `n_eff`. A design effect of 1 means the repeats added full information; 2.4 means 12 runs are
   worth 5.
4. **The detectable drop.** The smallest drop in the pass rate that two suites like this one would detect
   at 80% power. It reads `n_eff` and the headline rate. `no drop detectable at 80% power` means that even
   a fall to 0% would be missed too often. The suite is then too small to gate on.

After those four parts the line names the share of runs that gave no verdict. These are runs that did not
complete, stopped by the budget or by an error. Runs blocked or not run count too, each with its own
share. The share is printed beside the rate, so dropping broken runs cannot raise the rate unseen.

A golden here is one spec, one target and one mode, with one perturbation in P. A spec whose text changed
between runs is a new golden. A headline needs at least two goldens: with one, there is no spread to
measure, and the line says `no interval: one cluster` and `(one golden)`.

### Wilson on n_eff

A rate pooled over clustered units takes the Wilson score interval on `n_eff` in place of the unit count.
"Runs passing" pools runs, with the repeats of one golden as a cluster. "Block accuracy" pools blocks, with
the blocks of one run as a cluster. The variance comes from how far each cluster's passes stray from the
pooled rate. The scorecard prints `n_eff 5.0 (design effect 2.40)` beside such a rate. When every unit
passed, or every unit failed, there is no spread to read. Each cluster then counts once, with the method
`wilson, clusters`, and no `n_eff` is printed.

### Which interval to quote

A naive Wilson interval reads every run as independent. On simulated suites of correlated goldens it held
the true rate 73.9% of the time, against the 95% it claims. Wilson on `n_eff` held it 91.3% (normal
quantile) to 93.1% (Student t quantile). The hierarchical interval held it 95.3%. These are 24 simulated
settings with 400 suites each, from the coverage test of the stats package.

| Interval | Quote it for | Do not use it for |
|---|---|---|
| hierarchical | the suite headline, and any result you publish | one golden alone: it has no spread to measure |
| Wilson on `n_eff`, Student t | a rate of one block or one conversation in the report | a suite of few goldens you publish: it covers less than 95% |
| Wilson on `n_eff`, normal | interactive output, where speed matters | a published number |
| naive Wilson | independent units only, such as goldens counted once | runs with repeats: it is too narrow |

A headline over fewer than a dozen goldens is the least certain. To narrow it, add goldens, not repeats.

**Design effect.** `1 + (m - 1) rho` for clusters of size m with intraclass correlation rho; the effective
sample size is n divided by it. Repeats of one conversation that agree add less information than
independent runs.

**Paired tests** (in `compare` and `ci`):

* McNemar on the discordant goldens, always exact in `compare` and `ci`, printed `McNemar exact`.
* Wilcoxon signed-rank on the drift count per golden.
* Benjamini-Hochberg false discovery rate control across criteria at `--q` (default 0.05), before any
  criterion is called regressed. driftbench uses Benjamini-Hochberg here, not Holm: no product command
  applies a Holm correction (Holm p values appear only in the benchmark comparison scripts under
  `comparisons/`).

**The parity rule.** Non-inferior when the upper bound of the regression effect is below the margin for
the all-pass flag and every gating criterion that is not underpowered, and no flag family is new. A
criterion on fewer than `--min-goldens` (30) goldens is underpowered and left out unless `--strict`. Zero
regressed goldens in one run is not parity: it is one draw.

**Power and sample size** (printed per criterion and for the all-pass flag by `compare`):

| Number | Meaning |
|---|---|
| floor | `marginFloor(n)`: the smallest margin n goldens can show when nothing changed; 27.75 points for 10 goldens, 14.3 for 23 |
| drop seen | `mde({ n, baselineRate, power: 0.8 })`: the smallest true drop the goldens detect at 80% power |
| for 10 | `goldensNeeded(0.1, discordance)`: the goldens a 10 point margin needs at 80% power (35 at zero discordance) |

`--margin auto` is the smallest half point at which the baseline compared with itself is non-inferior.
Before a campaign, `campaign plan` prints the minimum detectable effect for the chosen repeats
(`--rho` passes a measured intraclass correlation; 0 counts repeats as independent, which is optimistic).

**The noise floor and variance components** (`driftbench pilot`, and the scorecard's "Variance pilot"):
`varianceComponents` splits the variance of the outcome across nested levels (cell, conversation,
wording, repeat) with the ANOVA estimator of a nested random-effects model; `icc` turns it into the rho of
each level; `repeatsForFloor` gives the repeats per block that keep run-to-run noise under a floor;
`neymanAllocation` spreads conversations across cells in proportion to size times spread. The spread view
flags a cell whose wording range is above 20 points and above its run-to-run noise floor.

**Over time** (`monitor`): CUSUM, Page-Hinkley and the two-sample Kolmogorov-Smirnov test.

**Judges**: Cohen's kappa and Krippendorff's alpha (`judge calibrate`, `queue agreement`).

**Coverage of a sample** (`space complete`): Good-Turing, Chao coverage and Chao1, Hill numbers.

## When to use it

Read this before trusting a pass rate, choosing a margin, or deciding how many goldens and repeats a suite
needs. The rule of thumb the numbers give: to tighten a gate, add goldens, not repeats.

* Quote the suite headline when you state how well an agent does on a suite, in a report, a ticket or a
  release note. Quote its interval and its `n_eff` with it.
* Read the detectable drop before you gate on a suite. If it says `no drop detectable`, or a drop larger
  than the regressions you care about, the suite cannot catch them: add goldens.
* Read the design effect to judge your repeats. Near 1, repeats add information. Well above 1, they mostly
  repeat the same outcome: spend the budget on new goldens.
* Read the share of runs that did not complete beside the rate. A high share means the rate is built on
  fewer real answers than the run count says.

When not to use the headline:

* To decide whether a candidate is worse than a baseline. The headline is one campaign's rate. A
  comparison of two versions uses the paired tests of `compare` and `ci`, which pair each golden with
  itself.
* As the threshold of `ci --aggregate pass-rate`. That aggregate is the pooled rate over the runs, with the
  Wilson interval on the effective runs clustered by golden, and is not changed by the headline.
* With one golden. It prints no interval.

## Commands and every option

`driftbench compare` prints most of these numbers; every option of it, with its default, is in
`results-compare`. The ones that change the statistics: `--margin <points|auto>` (`auto`),
`--min-goldens <n>` (`30`), `--strict` (off), `--mode <modes>` (every mode both ran) and `--q <rate>` (`0.05`).

### The suite headline in `report`

`driftbench report` prints the headline on its own; no option turns it on or off, and no option changes
how it is computed. Its options are in `results-report`. Two of them change where it shows:

| Option | Default | Effect on the headline |
|---|---|---|
| `[campaign]` | the latest campaign of the store | which campaign the headline is computed on |
| `--json` | off | the headline is printed inside the JSON as `modes[].headline` instead of as a line |

The headline reads every run of the campaign, carried runs included. The power is fixed at 80% and the
level at 95%.

### Library functions

The same numbers from code, in `@agent-nexus/driftbench-stats`:

| Function | Options and defaults | Returns |
|---|---|---|
| `hierarchicalBetaBinomial(trees, options)` | `alpha`, default `0.05` (a 95% interval), strictly between 0 and 1 | `estimate` and `treeMean` (the mean of the tree rates), `lower`, `upper`, `posteriorMean`, `trees`, `blocks` |
| `wilsonEffective(clusters, options)` | `alpha`, default `0.05`; `quantile`, `'t'` (default, Student t on clusters minus one) or `'z'` (the normal quantile) | `estimate` (the pooled rate), `lower`, `upper`, `n`, `clusters`, `designEffect`, `effectiveN`, `degenerate` |
| `simulateCoverage(cell, options)` | `reps`, required, at least 1; `seed`, default `1` | `cell`, `reps`, and `coverage` and `width` per method: `naive wilson`, `wilson effective z`, `wilson effective t`, `hierarchical` |
| `mde(input)` | `n` and `baselineRate` required; `power` default `0.8`; `alpha` default `0.05`; `repeats` default `1`; `rho` default `0` | `effect` (the detectable drop, or `null`), `effectiveN`, `designEffect` |

A coverage `cell` has four keys. `trees` is how many goldens. `sizes` is one size for every tree, or a list
the sizes are drawn from. `theta` is the true mean pass rate, strictly between 0 and 1. `d` is above 0; a
small `d` means the runs of a tree agree strongly. The same seed gives the same result.

## Inputs

Two campaigns of one store for the paired numbers; one campaign for the intervals and the headline of
`report`.

The library functions take counts per golden: `n` runs tried, `k` passed. Both are whole numbers, `k` at
most `n`, and `n` at least 1:

```text
[ { n: 5, k: 5 }, { n: 5, k: 5 }, { n: 5, k: 4 }, { n: 5, k: 0 }, { n: 5, k: 2 }, { n: 2, k: 2 } ]
```

## Outputs and how to read them

In `compare` text: `95% interval` columns are Wilson (per side) and Newcombe (effect); `p` is McNemar
exact; `q` is the Benjamini-Hochberg adjusted p; `floor`, `drop seen` and `for 10` are the planning
numbers. In the scorecard, "How the numbers are made" lists the method of each interval.

### The headline line

`report` prints one line per mode, such as this one for a planted fault over six goldens:

```text
Suite pass rate, mode F: 50.0% [18.7%, 81.3%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 2.40), no drop detectable at 80% power.
```

| Part | Read it as |
|---|---|
| `mode F` | the run mode the line covers; one line per mode the campaign ran |
| `50.0%` | the mean of the six golden pass rates |
| `[18.7%, 81.3%]` | the 95% hierarchical interval: the true suite rate lies in it, with 95% coverage |
| `(hierarchical 95% interval)` | the method; `(one golden)` when only one golden ran, with `no interval: one cluster` in place of the bounds |
| `6 goldens` | how many goldens the mean is over |
| `n_eff 5.0 runs` | the 12 runs of this mode are worth 5 independent runs |
| `(design effect 2.40)` | 12 divided by 5.0. Read `(every run agrees, so each golden counts once)` when all runs passed or all failed: `n_eff` is then the number of goldens |
| `no drop detectable at 80% power` | at 5 effective runs, a fall even to 0% is not detected reliably. Otherwise `detectable drop 65.3 points at 80% power` gives the smallest drop in points |
| `<share> did not complete`, `<share> blocked`, `<share> not run` | each appears only when above 0, as a percentage of the mode's runs |

A second reading, over six goldens. Their runs pass 5 of 5, 5 of 5, 4 of 5, 0 of 5, 2 of 5 and 2 of 2:

```text
Suite pass rate, mode F: 70.0% [35.4%, 88.2%] (hierarchical 95% interval); 6 goldens, n_eff 7.3 runs (design effect 3.69), detectable drop 65.3 points at 80% power.
```

The mean of the six rates is (1 + 1 + 0.8 + 0 + 0.4 + 1) / 6 = 70.0%. Pooled over the 27 runs it would be
18 of 27, 66.7%: the last golden's two runs would weigh less than the others' five. The 27 runs are worth
about 7, because one golden failed every run while others passed every run. With 7.3 effective runs, only a
drop of 65.3 points or more is detected at 80% power. The headline computes `n_eff` on the mean over
goldens, so it differs from `wilsonEffective`, which computes it on the pooled rate (7.0 in the script
below).

### The headline in the scorecard and in JSON

The scorecard shows the same numbers as a "Suite pass rate" tile per mode in the Summary, and as the
"suite pass rate" column of the mode table. A rate over clusters elsewhere on the page, such as "Runs
passing", prints `n_eff 5.0 (design effect 2.40)` beside its interval.

`report --json` holds the headline as `modes[].headline`:

| Field | Meaning |
|---|---|
| `estimate`, `lower`, `upper` | the mean over goldens and its interval, as proportions from 0 to 1 |
| `method` | `hierarchical`, or `none` with one golden |
| `trees`, `clusters` | the goldens |
| `runs`, `n` | the runs of the mode |
| `pooledRate` | the pass rate over all runs pooled, each run counting once |
| `effectiveRuns`, `designEffect` | `n_eff` and the design effect |
| `degenerate` | true when every run passed or every run failed |
| `detectableDrop` | the detectable drop as a proportion (0.653 is 65.3 points), or `null` when none is |
| `shares` | `incomplete`, `blocked` and `notRun`, each a proportion of the runs |

A rate over clusters with the method `wilson, design effect` carries `designEffect` and `effectiveN`.

### The library results

`hierarchicalBetaBinomial` returns `estimate` equal to `treeMean`. `posteriorMean` is the model's own mean,
pulled a little toward 50% when goldens are few or small; the headline does not print it. The interval is
widened to hold `estimate` when the posterior sits off it, as when every golden passes.

`wilsonEffective` returns the pooled rate, not the mean over goldens. `degenerate: true` means every run
agreed, so each cluster counted once.

`simulateCoverage` returns two maps per method. `coverage` is the share of simulated suites whose interval
held `theta`; near 0.95 is the promise. `width` is the mean interval width.

## Worked example

The same six conversations twice, then the comparison at a fixed margin with every criterion gating. No
model is called.

```sh
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --store stats.db --campaign c-a
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --agent-version v2 --store stats.db --campaign c-b
driftbench compare --baseline c-a --candidate c-b --store stats.db --margin 15 --strict # exit 1
```

```text
$ driftbench compare --baseline c-a --candidate c-b --store stats.db --margin 15 --strict
Baseline c-a (function:acme-sales) against candidate c-b (function:acme-sales (variant v2)).
Paired: 23 goldens (one golden in one mode, one perturbation in P), modes T, F, P; 0 goldens not paired. Margin 15.0 points.

All repeats pass, per golden:
  side       passing   rate    95% interval
  baseline   23 of 23  100.0%  [85.7%, 100.0%]
  candidate  23 of 23  100.0%  [85.7%, 100.0%]
  Both pass 23, regressed 0, improved 0, both fail 0. McNemar exact p = 1.0000.
  Effect, baseline minus candidate: 0.0 points, interval [-14.3, +14.3] (Newcombe, paired).
  Planning: 23 goldens can show a margin of 14.3 points at best; they detect a drop of 30.6 points at 80% power; a 10 point margin needs 35 goldens.
Drift count per golden (mean over repeats): baseline 0.00, candidate 0.00; Wilcoxon signed-rank p = 1.0000 (exact, 0 goldens differ).

Criteria: McNemar exact per criterion, Benjamini-Hochberg across 13 criteria at q 0.05. Effect in points, baseline minus candidate. A gating criterion on fewer than 30 goldens is underpowered, and gates anyway (--strict). Floor: the smallest margin its goldens can show; drop seen: the smallest drop they detect at 80% power; for 10: the goldens a 10 point margin needs.
  criterion  gating  goldens  regressed  improved  p       q       effect  interval        margin        floor  drop seen    for 10  verdict
  budget     yes     7        0          0         1.0000  1.0000  0.0     [-35.4, +35.4]  underpowered  35.4   67.6 points  35
  cards      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  end_state  yes     12       0          0         1.0000  1.0000  0.0     [-24.2, +24.2]  underpowered  24.2   49.3 points  35
  flow       yes     1        0          0         1.0000  1.0000  0.0     [-79.3, +79.3]  underpowered  79.3   none         35
  forbidden  yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  guards     yes     9        0          0         1.0000  1.0000  0.0     [-29.9, +29.9]  underpowered  29.9   59.0 points  35
  lang       yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  ledger     yes     19       0          0         1.0000  1.0000  0.0     [-16.8, +16.8]  underpowered  16.8   35.5 points  35
  must       yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  must_not   yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  pii        yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  stage      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  tools      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35

Verdict: NOT SHOWN NON-INFERIOR.
  budget: the upper bound 35.4 points is not below the margin, over 7 goldens (0 regressed, 0 improved)
  end_state: the upper bound 24.2 points is not below the margin, over 12 goldens (0 regressed, 0 improved)
  flow: the upper bound 79.3 points is not below the margin, over 1 golden (0 regressed, 0 improved)
  guards: the upper bound 29.9 points is not below the margin, over 9 goldens (0 regressed, 0 improved)
  ledger: the upper bound 16.8 points is not below the margin, over 19 goldens (0 regressed, 0 improved)
(exit 1)
```

Nothing changed between the two campaigns, yet with `--strict` the criteria decided on 1, 7, 9, 12 or 19
goldens gate, their floors are above 15 points, and the verdict is not shown non-inferior: the floor
column is the number to read before choosing a margin.

### The suite headline

A candidate with the planted fault `x3-skips-recap` runs in mode F against `c-a`. Then `report` reads the
latest campaign of the store, the candidate, and prints its headline. Last, one spec alone shows the
headline with one golden.

```sh
driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --mode F --repeats 2 --baseline c-a --store stats.db --out x3-ci.json # exit 1
driftbench report --store stats.db --out x3.html
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --repeats 3 --store one.db
driftbench report --store one.db --out one.html
```

```text
$ driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --mode F --repeats 2 --baseline c-a --store stats.db --out x3-ci.json
driftbench ci: candidate fault:x3-skips-recap (campaign c-4d1345c1778b) against baseline campaign c-a, compared as driftbench compare does (golden by golden, every repeat).
Margin auto: 14.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 14.31 points).
Underpowered, under 30 goldens, left out of the parity test: forbidden (6 goldens), must (6 goldens), stage (6 goldens), tools (6 goldens), guards (2 goldens), budget (2 goldens), cards (6 goldens), end_state (6 goldens), lang (6 goldens), ledger (5 goldens), must_not (6 goldens), pii (6 goldens).
  measure                                      value
  goldens paired                               6
  both pass                                    3
  regressed                                    3
  improved                                     0
  both fail                                    0
  new gating flags                             3
  all-pass regression effect                   +50.00 points
  95% interval                                 [+0.01, +81.24] points
  margin                                       14.5 points (auto)
  smallest margin these pairs can show         39.03 points
  gating criteria not shown within the margin  0
  underpowered (under 30 goldens)              12, left out of the parity test
  verdict                                      REGRESSION

Goldens that changed:
  golden                             baseline  candidate  change     new flags  candidate failing
  acme-number-porting · F            pass      fail       regressed  forbidden  block 3 forbidden.order.create, block 3 must.0, block 3 must.1
  acme-order-loose-confirmation · F  pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
  acme-plan-upgrade · F              pass      fail       regressed  forbidden  block 2 forbidden.order.create, block 2 must.0, block 2 must.1

Why:
  - 3 goldens regressed: acme-number-porting · F, acme-order-loose-confirmation · F, acme-plan-upgrade · F
  - new gating flag forbidden in acme-number-porting · F
  - new gating flag forbidden in acme-order-loose-confirmation · F
  - new gating flag forbidden in acme-plan-upgrade · F
  - all-pass: the upper bound 81.2 points of the regression effect is not below the margin 14.5 points
  - forbidden: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - must: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - stage: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - tools: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - guards: underpowered, decided on 2 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - budget: underpowered, decided on 2 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - cards: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - end_state: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - lang: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - ledger: underpowered, decided on 5 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - must_not: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - pii: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back

Verdict: REGRESSION. Exit 1.
Summary: x3-ci.json
(exit 1)
$ driftbench report --store stats.db --out x3.html
Margin auto: 26.0 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 25.5 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 25.5 points); about 22 goldens would.
Campaign c-4d1345c1778b: 12 runs, 6 pass, 6 fail, 0 did not complete.
Suite pass rate, mode F: 50.0% [18.7%, 81.3%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 2.40), no drop detectable at 80% power.
Wrote x3.html.
(exit 0)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --repeats 3 --store one.db
Campaign c-49196c4e04d0: 3 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 2  pass  5 blocks
3 cells: 3 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
$ driftbench report --store one.db --out one.html
Margin auto: 79.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 79.3 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 79.3 points); about 22 goldens would.
Campaign c-49196c4e04d0: 3 runs, 3 pass, 0 fail, 0 did not complete.
Suite pass rate, mode F: 100.0% no interval: one cluster (one golden); 1 golden.
Wrote one.html.
(exit 0)
```

The fault fails three of the six goldens on both repeats, so the mean is 50.0%. The repeats of each golden
agree, so the 12 runs are worth about 5. With one golden, there is no spread to measure and no interval.

### The same numbers from code

The script below reads the six goldens of the second reading above with the library functions. It runs the
package from its source with `tsx`; this file tells `tsx` where the packages are:

```json file=tsconfig.json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "paths": {
      "@agent-nexus/driftbench-*": ["./packages/*/src/index.ts"]
    }
  }
}
```

```ts file=intervals.mts
import {
  hierarchicalBetaBinomial,
  mde,
  simulateCoverage,
  wilson,
  wilsonEffective,
} from '@agent-nexus/driftbench-stats';

// Six goldens: n runs tried, k passed. Fictional counts.
const goldens = [
  { n: 5, k: 5 },
  { n: 5, k: 5 },
  { n: 5, k: 4 },
  { n: 5, k: 0 },
  { n: 5, k: 2 },
  { n: 2, k: 2 },
];
const show = (value: number) => `${(value * 100).toFixed(1)}%`;
const runs = goldens.reduce((sum, golden) => sum + golden.n, 0);
const passes = goldens.reduce((sum, golden) => sum + golden.k, 0);

const naive = wilson(passes, runs);
console.log(`naive Wilson, every run independent: ${show(passes / runs)} [${show(naive.lower)}, ${show(naive.upper)}]`);

const pooled = wilsonEffective(goldens);
console.log(
  `Wilson on n_eff: ${show(pooled.estimate)} [${show(pooled.lower)}, ${show(pooled.upper)}], n_eff ${pooled.effectiveN.toFixed(1)}, design effect ${pooled.designEffect.toFixed(2)}`,
);

const tree = hierarchicalBetaBinomial(goldens);
console.log(
  `hierarchical: ${show(tree.estimate)} [${show(tree.lower)}, ${show(tree.upper)}] over ${tree.trees} goldens and ${tree.blocks} runs`,
);

const drop = mde({ n: pooled.effectiveN, baselineRate: tree.estimate, power: 0.8 });
console.log(`detectable drop at n_eff: ${drop.effect === null ? 'none' : `${(drop.effect * 100).toFixed(1)} points`}`);

// Twelve goldens of three runs, a true rate of 90%, runs of one golden that agree strongly.
const cell = simulateCoverage({ trees: 12, sizes: 3, theta: 0.9, d: 2 }, { reps: 400, seed: 1 });
for (const [method, share] of Object.entries(cell.coverage)) console.log(`coverage ${method}: ${show(share)}`);

try {
  hierarchicalBetaBinomial([{ n: 3, k: 4 }]);
} catch (error) {
  console.log(`refused: ${(error as Error).message}`);
}
```

```sh setup
tsx intervals.mts
```

```text
$ tsx intervals.mts
naive Wilson, every run independent: 66.7% [47.8%, 81.4%]
Wilson on n_eff: 66.7% [24.7%, 92.4%], n_eff 7.0, design effect 3.87
hierarchical: 70.0% [35.4%, 88.2%] over 6 goldens and 27 runs
detectable drop at n_eff: 66.4 points
coverage naive wilson: 87.5%
coverage wilson effective z: 95.8%
coverage wilson effective t: 96.5%
coverage hierarchical: 95.0%
refused: hierarchicalBetaBinomial: trees[0].k (4) exceeds n (3)
(exit 0)
```

The naive interval is the narrowest, and it is the one that misses most often. The hierarchical interval
is centred on the mean over goldens, 70.0%, not on the pooled 66.7%. On the simulated setting, compare each
method's coverage with the 95% it promises.

## Common errors

| Symptom or message | Cause and fix |
|---|---|
| not shown non-inferior on an unchanged agent | the margin is below the floor of the goldens. Add goldens; more repeats do not move the floor |
| a criterion reads `underpowered` | it was decided on fewer than `--min-goldens` goldens; it is left out unless `--strict` |
| a p value below 0.05 but no `regressed` verdict on the criterion | the Benjamini-Hochberg adjusted q is above `--q` |
| a carried golden is missing from the pairs | carried results are never paired: they agree with the baseline by construction |
| the headline reads `no interval: one cluster` and `(one golden)` | the mode ran one golden. Add specs; repeats of one spec never give an interval |
| the headline reads `no drop detectable at 80% power` | the suite is too small to detect even a fall to 0%. Add goldens before you gate on it |
| the headline differs from `aggregate pass-rate` on the same campaign | expected: the aggregate is the pooled rate, each run counting once, with the Wilson interval on the effective runs clustered by golden; the headline is the mean over goldens. Quote the headline, gate with `compare` or `ci` |
| the headline is below the pass rate you expected | runs that did not complete count as failed. Read the `did not complete` share on the same line |
| more goldens than specs | a golden is one spec, one target and one mode (and one perturbation in P); a spec edited between runs is a new golden |
| `hierarchicalBetaBinomial: trees must not be empty` (RangeError) | pass at least one golden |
| `hierarchicalBetaBinomial: trees[0].k (4) exceeds n (3)` (RangeError) | a golden cannot pass more runs than it tried |
| `hierarchicalBetaBinomial: trees[0] has no block` (RangeError) | a golden with `n: 0`; leave it out |
| `hierarchicalBetaBinomial: trees[0].n must be a non-negative integer, got 2.5` (RangeError) | counts are whole numbers |
| `hierarchicalBetaBinomial: alpha must lie in (0, 1), got 1` (RangeError) | `alpha` is strictly between 0 and 1: `0.05` for 95% |
| `wilsonEffective: clusters must not be empty`, `wilsonEffective: clusters[0] has no block`, `wilsonEffective: clusters[0].k (4) exceeds n (3)` (RangeError) | the same checks as above, for `wilsonEffective` |
| `simulateCoverage: reps must be at least 1, got 0`, `simulateCoverage: d must be above 0, got 0`, `simulateCoverage: theta must lie in (0, 1), got 1`, `simulateCoverage: every size must be at least 1` (RangeError) | fix the setting: at least one suite, a concentration above 0, a true rate strictly between 0 and 1, and trees of at least one run |
