# Product needs of the stats bank roadmap methods

Rule (the lead, 2026-10-12): a validator must not be made hard with work the product does not need. Every roadmap method of the stats bank, the 101 of the earlier batches and the 61 of batches 3 and 4, is listed with the product need that would use it: a docs page, a design section or a command. A method with no such need is quarantined. Its cases stay in `packages/validators/fixtures/stats/roadmap.json`, but `needs.json` keeps its items out of the bank (read by `bank/roadmap.ts`), so they count toward no score, forecast or cause. A method returns to the bank when a page names it: move its entry from `quarantine` to `keep` in `needs.json` with the citation.

Result: 7 of 162 methods kept, 155 quarantined.

## Kept: a product need names them

| Method | Batch | Need (where) | What it would serve |
|---|---|---|---|
| `clusteredMeanInterval` | 3 and 4 | docs/concepts/statistics.md, opening: "One conversation, or one task, is one cluster" and "reports every rate with an interval"; docs/generating.md: "Pass rate 15.9% (13.3% to 19.0%, Wilson on 638.6 effective runs)"; docs/validators.md section 7: clustered truth | an interval on a rate of clustered runs, without resampling |
| `designEffectFromData` | 3 and 4 | docs/generating.md, "What the analysis reports": "the design effect measured from the within-cell conversation correlation"; docs/estate.md, "Not built yet": "the design effect from the measured correlation of the variance pilot" | the pilot and the estate plan compute a design effect from data |
| `iccOneWay` | 3 and 4 | docs/generating.md, "What the analysis reports": "The intraclass correlation per level"; docs/concepts/statistics.md, "Before a campaign": "pass the rho that icc measures" to mde | the rho the pilot and mde read, for unbalanced conversations |
| `kishEffectiveSize` | 1 and 2 | docs/reference/cli.md, driftbench space coverage: "weighted 34.0% of the declared user mix, effective sample size 6.3 of 7 specs" | the effective sample size the weighted coverage line prints |
| `oneWayAnova` | 3 and 4 | docs/generating.md, "What the analysis reports": "the cell's wording F test holds at a false discovery rate of 0.05" | the wording F test of the pilot is a one-way ANOVA over wordings |
| `stratifiedMean` | 1 and 2 | docs/generating.md, "What the analysis reports": "The Neyman allocation of an estimation pool of --pool conversations across the cells"; docs/concepts/statistics.md, neymanAllocation | the estimate (and its variance) from the stratified estimation pool that Neyman allocation draws |
| `weightedMean` | 1 and 2 | docs/reference/cli.md, driftbench space coverage: "weighted 34.0% of the declared user mix"; docs/generating.md, space coverage "weighted by the declared prior" | the share of the user mix covered is a weighted mean of covered flags |

## Quarantined: no product need found

| Method | Batch | Family it was in | Why |
|---|---|---|---|
| `aceEstimator` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `agrestiCaffoDifference` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `agrestiCoull` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `alphaSpending` | 1 and 2 | roadmap-sequential | no page plans interim looks at a campaign |
| `arcsineInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `aucRoc` | 1 and 2 | roadmap-calibration | judges return verdicts, not scores (docs/concepts/judges.md) |
| `autocorrelation` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `bartlettTest` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bayesFactorRate` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `benjaminiYekutieli` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `betaBinomialMoments` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `betaPosteriorBelow` | 1 and 2 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `betaPosteriorInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `binomialTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bonferroni` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bowkerSymmetry` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `bradleyTerry` | 1 and 2 | roadmap-ratings | no docs page, design section or command names it or would call it; quarantined until one does |
| `brennanPrediger` | 1 and 2 | roadmap-agreement | agreement is documented as Cohen kappa and Krippendorff alpha |
| `brierScore` | 1 and 2 | roadmap-calibration | judges return verdicts, not probabilities (docs/concepts/judges.md) |
| `brunnerMunzel` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `cauchyCombination` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `chao1Interval` | 1 and 2 | roadmap-diversity | chaoCoverage (documented) returns Chao1; no page prints an interval on it |
| `chao2` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `chaoShannon` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `chiSquareGoodnessOfFit` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `chiSquareIndependence` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `classificationReport` | 1 and 2 | roadmap-calibration | judge agreement is documented as Cohen kappa against labels (docs/concepts/judges.md) |
| `cliffsDelta` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `clusterMeansInterval` | 3 and 4 | roadmap-shrinkage-clustering | serves the same need as clusteredMeanInterval (an interval on clustered runs); one method is enough for that need |
| `clusterSampleSize` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `clusteredStandardError` | 1 and 2 | roadmap-weighting | its need (a rate of clustered runs) is served by clusteredMeanInterval, which computes it |
| `cochranMantelHaenszel` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `cochranQ` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `cohenH` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `cohensD` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `conditionalPower` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `confidenceSequence` | 1 and 2 | roadmap-sequential | docs/traces.md monitors drift with CUSUM, Page-Hinkley and KS; no page watches a rate continuously with an interval |
| `cramersV` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `effectiveSizeAutocorrelated` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `eloRatings` | 1 and 2 | roadmap-ratings | no docs page, design section or command names it or would call it; quarantined until one does |
| `eloUpdate` | 1 and 2 | roadmap-ratings | no docs page, design section or command names it or would call it; quarantined until one does |
| `ewma` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `excessKurtosis` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `exhaustiveBootstrapInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `expectedCalibrationError` | 1 and 2 | roadmap-calibration | judges return verdicts, not probabilities (docs/concepts/judges.md); calibration there is kappa and separation |
| `extrapolatedRichness` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `fisherCombination` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `fisherExact` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `fleissKappa` | 1 and 2 | roadmap-agreement | agreement across judges is documented as Krippendorff alpha (docs/concepts/judges.md) |
| `friedman` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `gTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `geometricMeanInterval` | 3 and 4 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `glassDelta` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `goelOkumoto` | 1 and 2 | roadmap-weighting | no docs page, design section or command names it or would call it; quarantined until one does |
| `goelOkumotoFit` | 1 and 2 | roadmap-weighting | no docs page, design section or command names it or would call it; quarantined until one does |
| `goodmanKruskalGamma` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `gwetAC1` | 1 and 2 | roadmap-agreement | agreement across judges is documented as Krippendorff alpha |
| `harmonicMeanP` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `hillQ2Estimator` | 1 and 2 | roadmap-diversity | hillNumbers (documented) reports the plug-in Hill numbers; no page asks for a bias-corrected estimator |
| `hochberg` | 3 and 4 | roadmap-multiplicity | docs/concepts/statistics.md names Benjamini-Hochberg across criteria, which exists; no page asks for family-wise control |
| `hodgesLehmann` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `hoeffdingConfidenceSequence` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `hoeffdingInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `hoeffdingSampleSize` | 1 and 2 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `holm` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `holmSidak` | 3 and 4 | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `hommel` | 3 and 4 | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `huberLocation` | 3 and 4 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `iChao1` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `icc21` | 1 and 2 | roadmap-agreement | agreement is documented as Cohen kappa and Krippendorff alpha |
| `iccInterval` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `importanceWeights` | 1 and 2 | roadmap-weighting | space coverage weights cells by the declared prior; no page reweights a generator to a user mix |
| `interquartileRange` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `jackknifeRichness` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `jackknifeVarianceOfVariance` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `jamesStein` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `jeffreys` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `kendallTau` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `kendallW` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `kishWeightDesignEffect` | 3 and 4 | roadmap-weighting | the need (the weighted effective sample size of space coverage) is served by kishEffectiveSize, which prints that figure; one method is enough |
| `kruskalWallis` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `leveneTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `likelihoodRatioInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `ljungBox` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `logLoss` | 1 and 2 | roadmap-calibration | judges return verdicts, not probabilities (docs/concepts/judges.md) |
| `logitInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `mannKendall` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `mannWhitneyU` | 1 and 2 | roadmap-tests | distribution shifts are documented with the KS test (docs/concepts/statistics.md, docs/generating.md) |
| `mantelHaenszelOddsRatio` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `matthewsCorrelation` | 3 and 4 | roadmap-association | judge agreement is documented as Cohen kappa and Krippendorff alpha (docs/concepts/judges.md) |
| `mcnemarMidP` | 1 and 2 | roadmap-tests | mcnemar (documented) gives the exact and the chi-square test |
| `mcnemarSampleSize` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `medianAbsoluteDeviation` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `medianInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `midPInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `moderatedVariance` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `moodMedianTest` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `msprtPValue` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `newcombeDifference` | 1 and 2 | roadmap-intervals | driftbench compare documents paired comparisons only; the paired Newcombe interval exists (pairedRateDifference) |
| `nonInferioritySampleSize` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `normalPosterior` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `normalSampleSize` | 1 and 2 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `oddsRatioInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `oneSampleT` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `pairedStandardError` | 1 and 2 | roadmap-weighting | no docs page, design section or command names it or would call it; quarantined until one does |
| `pairedT` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `pearson` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `percentAgreement` | 1 and 2 | roadmap-agreement | agreement is documented as Cohen kappa and Krippendorff alpha |
| `permutationTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `phiCoefficient` | 3 and 4 | roadmap-association | no docs page, design section or command names it or would call it; quarantined until one does |
| `pielouEvenness` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `poissonInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `poissonRateRatioInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `pooledDifferenceInterval` | 3 and 4 | roadmap-small-n | driftbench compare documents paired comparisons only |
| `pooledVariance` | 3 and 4 | roadmap-shrinkage-clustering | a sub-quantity of the wording F test (its mean square within); the need is met by oneWayAnova |
| `powerTwoProportions` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `probabilityBetter` | 3 and 4 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `quantileInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `rarefiedRichness` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `ratioEstimate` | 3 and 4 | roadmap-shrinkage-clustering | block pass rates over conversations of unequal length are not reported by any page today |
| `relativeRiskInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `remlOneWay` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `scottPi` | 1 and 2 | roadmap-agreement | agreement is documented as Cohen kappa and Krippendorff alpha |
| `senSlope` | 1 and 2 | roadmap-trend | no docs page, design section or command names it or would call it; quarantined until one does |
| `shannonEntropy` | 1 and 2 | roadmap-diversity | hillNumbers (documented) gives exp(Shannon) as q1 |
| `shrinkRates` | 3 and 4 | roadmap-shrinkage-clustering | no docs page, design section or command names it or would call it; quarantined until one does |
| `sidak` | 3 and 4 | roadmap-multiplicity | no page asks for family-wise control; Benjamini-Hochberg is the documented choice |
| `signTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `simesTest` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `simpsonIndex` | 1 and 2 | roadmap-diversity | hillNumbers (documented) gives the inverse Simpson as q2 |
| `skewness` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `spearman` | 1 and 2 | roadmap-correlation | no docs page, design section or command names it or would call it; quarantined until one does |
| `sprtBernoulli` | 1 and 2 | roadmap-sequential | docs/concepts/run-modes.md plans an early stop by a fixed rule, not an SPRT |
| `sprtExpectedSampleSize` | 3 and 4 | roadmap-sequential | docs/concepts/run-modes.md plans an early stop by a fixed rule (the first two repeats both fail), not an SPRT |
| `sprtOperatingCharacteristic` | 3 and 4 | roadmap-sequential | same as sprtExpectedSampleSize: the planned early stop is a fixed rule, not an SPRT |
| `storeyQValues` | 3 and 4 | roadmap-multiplicity | Benjamini-Hochberg is the documented false discovery rate procedure; no page needs pi0 |
| `stoufferCombination` | 3 and 4 | roadmap-multiplicity | no docs page, design section or command names it or would call it; quarantined until one does |
| `tInterval` | 1 and 2 | roadmap-intervals | docs/traces.md reports a window mean with its standard error, not an interval; no page asks for a t interval |
| `tostEquivalence` | 1 and 2 | roadmap-power | no docs page, design section or command names it or would call it; quarantined until one does |
| `trimmedMean` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `turingAdjustedCounts` | 1 and 2 | roadmap-diversity | goodTuring (documented) gives f1 / n; no page uses adjusted counts |
| `twoProportionSampleSize` | 1 and 2 | roadmap-sequential | no docs page, design section or command names it or would call it; quarantined until one does |
| `varianceInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `varianceRatioInterval` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `vendiScore` | 1 and 2 | roadmap-diversity | no docs page, design section or command names it or would call it; quarantined until one does |
| `waldDifference` | 3 and 4 | roadmap-small-n | no docs page, design section or command names it or would call it; quarantined until one does |
| `waldInterval` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `weightedVariance` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `welchAnova` | 3 and 4 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `welchDifferenceInterval` | 3 and 4 | roadmap-small-n | driftbench compare documents paired comparisons only |
| `welchTTest` | 1 and 2 | roadmap-tests | no docs page, design section or command names it or would call it; quarantined until one does |
| `wilsonContinuity` | 1 and 2 | roadmap-intervals | no docs page, design section or command names it or would call it; quarantined until one does |
| `winRate` | 1 and 2 | roadmap-ratings | no docs page, design section or command names it or would call it; quarantined until one does |
| `winsorizedMean` | 1 and 2 | roadmap-robust | no docs page, design section or command names it or would call it; quarantined until one does |
| `zeroFailureBayesN` | 3 and 4 | roadmap-sequential | zeroFailureBound (documented) answers the zero-failure question; no page asks for a Bayesian version |

## Built back on needs: batch 5

Rule (the lead, 2026-10-12): build the bank back on real needs only. Batch 5 adds 80 items, each naming the docs page or command it serves. No item tests a method no page needs, and no item tests a printout that only passes a library value through (the CI gate's `compareArms`, the McNemar and Benjamini-Hochberg columns of `driftbench compare`, the kappa of `driftbench judges calibrate`): the library items already cover those.

### Planned capabilities (family `product`, level `roadmap`, tier 5)

| Items | Need | Contract the items state | At iteration 0 |
|---|---|---|---|
| `planned.plan-mde.*` (4), `planned.plan-cli.mde` | docs/concepts/statistics.md, "Before a campaign": "`campaign plan` uses the runner's own formula today, with runs counted as independent; using `mde` with a measured `rho` there is planned, phase 4" | the plan's effect is `mde({ n: specs, repeats, baselineRate })` of @agent-nexus/driftbench-stats, null when no drop is detectable; the CLI prints it | fail: 21.7 points printed for the 6 Acme specs with 5 repeats, where `mde` gives 30.9; one spec prints 198.1 points, where `mde` gives null |
| `planned.plan-rho.*` (3), `planned.plan-cli.rho` | the same line | `PlanOptions.rho` and `campaign plan --rho`, passed to `mde`; each line carries rho and the design effect; a rho outside [0, 1] throws | fail: no such option |
| `planned.estate-session.*` (4) | docs/estate.md, section 7, "Not built yet": "The session as the unit (one cluster), with the design effect from the measured correlation of the variance pilot" | `sessionRate(runs, { rho })` of @agent-nexus/driftbench-estate: design effect `1 + (m - 1) rho` with m the mean runs per session, Wilson on the effective runs as the pilot prints its pass rate (docs/generating.md) | fail: not exported |
| `planned.early-stop.stops`, `planned.early-stop.keeps` | docs/concepts/run-modes.md, "Around the modes": "Stopping a spec early when its first two free-running repeats both fail a gating machine check is planned" | `CampaignRunOptions.earlyStop`: after F repeats 0 and 1 both fail a gating machine check, the later repeats are `stopped` with an `earlyStop` marker and never run; a spec passing either repeat runs them all | `stops` fails; `keeps` passes (it guards against stopping too much) |

### Depth on the documented methods

Family `edge-accuracy` (level `analytic`, tier 4): 48 cases of `packages/validators/fixtures/stats/edges.json`, written by `make_edges.py` from scipy, exact rationals or 60-digit decimals, never from the package. NaN and infinite inputs stay in the degenerate level (72 items).

| Function | Edge cases | Need | At iteration 0 |
|---|---|---|---|
| `wilson` | n 1 all fail, n 1 all pass, all fail at 1e6, all pass at 1e9, one pass in 1e9 | every rate of `driftbench report` carries a Wilson interval | pass |
| `clopperPearson` | n 1 both ways, one pass in 1e6, all pass at 1e5, alpha 0.001 | the exact interval of docs/concepts/statistics.md | pass |
| `zeroFailureBound` | p 1e-6 and 1e-9 | the runs needed to claim a failure rate below p | p 1e-9 fails: 2995732357 for 2995732273 (`log(1 - p)` loses digits; `log1p` keeps them) |
| `passK`, `passAtK` | n 1e5 with k 50 and 1000, all pass with k = n, fewer passes than k, all fail | pass^k and pass@k per spec line of the report | pass |
| `mcnemar` | no discordant pair, 2 million discordant pairs, all discordant one way | the p-values of `driftbench compare` | pass |
| `wilcoxonSignedRank` | ties with zero differences, n 1, every difference the same size, n 60 with ties | the drift-count test of `driftbench compare` | pass |
| `ksTest` | ties across samples, unequal sizes, one value each, one against eight | the KS detector of `driftbench monitor` (docs/traces.md) | pass |
| `benjaminiHochberg` | tied p-values, p 0 and 1, one hypothesis, none rejected | `driftbench compare` and the pilot's wording test | pass |
| `cohenKappa` | linear and quadratic weights with an unused ordered category, raters who never agree | `driftbench judges calibrate` (docs/concepts/judges.md) | pass |
| `krippendorffAlpha` | missing ratings at the four levels, ratio level with zeros | judge agreement (docs/concepts/judges.md) | pass |
| `mde` | n 1, a baseline of 1 and of 0, rho 1, n 1e7 | the minimum detectable effect `campaign plan` prints | the baselines of 0 and 1 fail: `mde` throws, where the documented equation gives an effect at 1 and null at 0; a pilot where every run passes has a baseline of 1 |

Items `edge.rho-bound.*` (3, the same family): `designEffect`, `effectiveSampleSize` and `mde` with rho below `-1 / (m - 1)` must throw a RangeError. Need: docs/concepts/statistics.md, the design effect `1 + (m - 1) rho`; docs/generating.md, the pilot's design effect. At iteration 0 all 3 fail: `designEffect(10, -0.5)` returns -3.5, `effectiveSampleSize(100, 10, -0.2)` returns -125, and `mde` returns an effect near 0 on a negative effective sample.

### Error rates at the documented level

Bars are the documented level with three Monte Carlo standard errors of slack, never a measured value.

| Items | Family, tier | Truth planted | Need | At iteration 0 |
|---|---|---|---|---|
| `simulation.newcombe.n30`, `.n100` | coverage-simulation, 4 | paired pass flags with a known baseline minus candidate rate, 2000 draws | `driftbench ci` and `compare` print Newcombe's interval | pass |
| `simulation.non-inferiority.size-n100` | coverage-simulation, 4 | a true regression equal to the margin; at most 2.5 percent declared non-inferior | the parity verdict (docs/concepts/statistics.md) | pass |
| `simulation.mcnemar.size-chi-square`, `simulation.wilcoxon.size-*` (2), `simulation.ks.size-*` (2) | coverage-simulation, 4 | true nulls, with ties where the product meets them (drift counts, rounded latencies) | `driftbench compare` and `driftbench monitor` | pass |
| `simulation.benjamini-hochberg.fdr` | coverage-simulation, 4 | 20 independent tests, 12 true nulls, q 0.1 | `driftbench compare`; the pilot's wording test at a false discovery rate | pass |
| `simulation.report-run-pass.s6x5`, `.s20x3` | product, 5 | 6 specs of 5 repeats and 20 of 3, rho 0.3 within a spec, the population pass rate known | docs/concepts/statistics.md, "reports every rate with an interval", one conversation or task being one cluster; the run pass rate of each mode in `driftbench report` | fail: about 0.82 and 0.92 of the 95 percent intervals hold the rate (bars 0.929 and 0.940); the percentile bootstrap over 6 or 20 specs is too narrow |
| `simulation.hierarchical.g12x6-rho0.3`, `.g20x5-rho0.5`, `simulation.wilson-effective.g12x6-rho0.3`, `.g20x5-rho0.5` | coverage-simulation, 4 | 12 trees of 6 blocks (rho 0.3) and 20 trees of 5 (rho 0.5), the suite pass rate uniform in 0.2 to 0.8 and known, 1000 draws; a naive Wilson interval over every block covers about 0.75 and 0.78 | docs/concepts/statistics.md, "The suite headline": the hierarchical interval of the suite headline and Wilson on `n_eff` widen when the blocks of a tree move together; `driftbench report` prints both | pass: 216 runs of the four items on seeds 1 to 52 and two hidden seeds, 0 failures; coverage 0.95 to 0.97 on the committed draws (bar 0.929) |

### Printouts the report computes beside the library (family `product`, level `analytic`, tier 4)

| Item | Need | At iteration 0 |
|---|---|---|
| `agree.report.pass-k-bounds` | pass^k and pass@k per line of `driftbench report`, the Wilson bounds raised the same way | pass |
| `agree.report.all-pass-clusters` | a mode whose runs all pass prints the Wilson interval over its specs, each counted once | pass |
| `agree.report.noise-floor` | the spread view's noise floor and repeats for 5 points (docs/generating.md) agree with `repeatsForFloor` | pass |

## What leaves the audited bank

The stats-v2 audit judges the bank of 1326 items (before batches 3 and 4). Of it, 793 items of 98 methods leave: every roadmap method of batches 1 and 2 except `kishEffectiveSize`, `weightedMean` and `stratifiedMean`. 533 items remain, and the four kept methods of batches 3 and 4 add 31: the bank is 564 items.

## Effect on the hardness measurement, after the quarantine

The rows of `bank-scores.jsonl` and the journal drop the quarantined items; every remaining item keeps its recorded verdict. `driftbench validate stats --hardness`:

```
Hardness of stats (docs/validators.md section 12.4), from validators/stats/journal.jsonl
Bank at iteration 10: 564 items, 471 pass on every seed.
Score at iteration 0: 0.7553 (426 of 564).
Score after the pilot: 0.8351 (471 of 564, iteration 10; 10 of 10 pilot iterations).
Items fixed per iteration: 4.5 (mean over the pilot).
Forecast: 20.67 iterations to 100 percent (93 failing / 4.5).
Distinct failing causes after the pilot: 28 (0 failing items name no cause and count as their own).
Gate: NOT MET: the forecast 20.67 is under 100: extend the bank (12.2); the score after the pilot 0.8351 is above 0.4; 28 distinct failing causes after the pilot, under 100: extend the bank (12.2); audit.md is absent: no validator merges without the audit (12.7).
Bank minimum at merge (12.1): not met: no item of tier 5.
Audit: validators/stats/audit.md is absent.
```

Without the unneeded roadmap, the stats bank does not meet the hardness contract. The gate fails on the forecast (20.67, under 100), the score after the pilot (0.8351, above 0.4), the distinct causes (28, under 100) and the bank minimum (no tier 5 item). Meeting it honestly needs items on capabilities the product documents, written as items before they are fixed: for example, the planned uses that `docs/concepts/statistics.md` and `docs/estate.md` list as not built (mde with a measured rho in `campaign plan`, the session as the unit in the estate plan), and the planned early stop of `docs/concepts/run-modes.md`.

## Effect of batch 5

The 80 items ran in isolated children on seeds 1 to 20 and the hidden seed: 22 fail on every seed and 58 pass on every seed. The verdicts are the same at every recorded row: the ten pilot commits change only the input validation of `packages/stats` (non-finite values, bad options), and no batch 5 item passes such an input. The rows of `bank-scores.jsonl` and the journal carry them. `driftbench validate stats --hardness`:

```
Score at iteration 0: 0.7516 (484 of 644).
Score after the pilot: 0.8214 (529 of 644, iteration 10; 10 of 10 pilot iterations).
Items fixed per iteration: 4.5 (mean over the pilot).
Forecast: 25.56 iterations to 100 percent (115 failing / 4.5).
Distinct failing causes after the pilot: 37 (0 failing items name no cause and count as their own).
Gate: NOT MET: the forecast 25.56 is under 100; the score after the pilot 0.8214 is above 0.4; 37 distinct failing causes after the pilot, under 100; audit.md is absent.
Bank minimum at merge (12.1): holds.
```

Batch 5 adds 9 distinct failing causes, each a real gap: the plan's own MDE formula, the missing measured rho in the plan and its CLI flag, the estate session as the unit, the early stop, the report's run pass interval at few specs, `designEffect` below its bound, `mde` at a baseline of 0 or 1, and `zeroFailureBound` at a tiny p. The bank minimum now holds: 644 items, no family under 20, tiers 1 to 5. The hardness gate does not: on needs alone the product has about 37 causes of failure, not 100.

## Batch 6: the stats-v2 audit findings

The audit of the old bank (validators/stats/audit.md on audit/stats-v2, 2faeb603) failed all four checks. Three findings still applied to this bank and are fixed here.

* Cheater, attempt 1: one wrapper that throws a RangeError on any non-finite argument passed 45 degenerate items. Rule 1 of the degenerate level now asks the RangeError to name the function and the argument to fix: the message begins `<function>: <argument>` or names the entry `<argument>[<index>]`. The argument is the parameter of the exported signature, or the option or field inside it. The need: a caller of `driftbench report`, `compare` or `ci` reads the library's error and must know which input to fix. Proof: the same wrapper, run on the levels reference to analytic on seed 1, gains 1 item and breaks 7 (a net loss of 6 items), where it gained 45 before.
* Planted bugs missed: each of the five now turns its own item red, measured by planting it in a copy of the package (`DRIFTBENCH_STATS_IMPL` points the bank's child process at the copy):

| Bug | Item that catches it | Need |
|---|---|---|
| `multiple.ts`: `p <= k q / m` made `<` | `edge.rule.benjamini-hochberg-equality` | `driftbench compare`; the pilot's wording test |
| `power.ts`: default power 0.8 made 0.9 | `edge.rule.mde-defaults`, and 3 `edge.mde.*` cases | `campaign plan` prints the effect |
| `repeat-reducers.ts`: `at_least:[1-9][0-9]*` made `[0-9]+` | `edge.rule.at-least-spelling` | docs/reference/spec.md, `repeat_reducer` |
| `repeat-reducers.ts`: mode tie `>` made `>=` | `edge.rule.mode-tie` | docs/concepts/judges.md, "Repeat reducers" |
| `repeat-reducers.ts`: median `> 0.5` made `>=` | `edge.rule.median-half` | docs/concepts/judges.md, "Repeat reducers" |

  Two more documented reducer rules got an item each: mode with half the repeats unscored, and an `at_least` that an inconclusive repeat could still reach.
* Cause review, 0.20: a cause now names the failure a reader sees, not the fix. "add weightedMean" becomes "weightedMean is missing from @agent-nexus/driftbench-stats", and those items carry the family `missing-method`. "mde: input validation" becomes "mde accepts a degenerate input without a RangeError naming the argument". Every batch 5 cause names its observable failure the same way.

One contradiction inside the bank is resolved: a degenerate item asked `mde` with a baseline of 1 to throw, where the edge item asks for the documented equation's answer. The degenerate item now uses a baseline of 1.2, which is out of range.

## Batch 7: exact values, accuracy over the domain, and the report's headline

The audit of the bank against docs/validators.md section 12 found 13 exports that no item caught when their numbers were 0.2 percent off (`abundances`, `effectiveSampleSize`, `erfc`, `hierarchicalBetaBinomial`, `icc`, `mulberry32`, `parseRepeatReducer`, `quantileSorted`, `reduceRepeats`, `sampleVariance`, `simulateCoverage`, `wilsonEffective`, `zFor`), 22 more that one or two items caught, and 5 that no item failed when they threw (`erfc`, `hierarchicalBetaBinomial`, `icc`, `simulateCoverage`, `wilsonEffective`). The report's suite headline and clustered rate had no item. This batch adds 60 items in two families, `exact-special` (25) and `exact-estimators` (35); every one has a cause of its own.

| Group | Items | What they read |
|---|---|---|
| special functions | 15 | `erfc`, `normalCdf`, `normalSf`, `normalQuantile`, `zFor`, `logGamma`, `betaQuantile`, `chiSquareSf`, `kolmogorovSf` against the standard library and scipy, split where a branch of the code is a different failure (the reflection of erfc, the tails, the two kolmogorovSf formulas) |
| accuracy over the domain | 10 | 60 points per special function across its domain at 1e-11 relative, and `normalQuantile` in three parts |
| basics | 9 | `mulberry32` (an integer port of the published algorithm), `quantile`, `quantileSorted`, `unreliability`, `weightedMean`, `sampleVariance` (exact rational arithmetic, including a large offset), `abundances`, `parseRepeatReducer`, `reduceRepeats` (60 cases of the three documented rules) |
| intervals, drift, coverage, variance, paired | 20 | `designEffect`, `effectiveSampleSize`, `kishEffectiveSize`, `wilsonEffective` (both quantiles), `hierarchicalBetaBinomial` (a 2000 by 600 integration written in Python), `cusum`, `pageHinkley`, `goodTuring`, `hillNumber(s)`, `varianceComponents` (balanced nested ANOVA), `icc`, `neymanAllocation`, `repeatsForFloor`, `pairedRateDifference`, `nonInferiority` |
| simulation | 1 | `simulateCoverage` replayed: the sampler is written again in Python on the mulberry32 port, and the naive and effective-Wilson counts match bit for bit |
| report | 5 | `suiteHeadline` (rate and interval, effective runs, detectable drop, and that the tree key it is given is the one it groups by) and `clusterRate` |

Provenance: every number is in `packages/validators/fixtures/stats/exact.json`, made by `make_exact.py` next to it, which records per group whether the numbers come from exact rational arithmetic, the Python standard library, scipy or numpy. The script reads no TypeScript. Tolerances come from the source of the number (1e-12 relative for closed forms, 1e-6 for library values as at level 1, 1e-11 for the accuracy items, half a grid cell for the hierarchical bounds), not from what the product achieves.

One real defect surfaced: `normalQuantile` lost digits for p above 0.99 (relative error up to 1.0e-9 at 1 - 1e-12). The item `exact.normalQuantile.double-precision-upper` caught it; the fix is a product change kept apart from this bank (docs/validators.md 12.3) and listed in the pull request.

Measured on seed 1 with a fault planted in one function at a time (the numbers 0.2 percent off, or a throw), over the 57 exported functions: before, 13 lost no item on the numeric fault and 5 lost none when they threw. After, 5 lose none on the numeric fault, which are the functions whose output has nothing a 0.2 percent change moves (`abundances`, `mulberry32`, `parseRepeatReducer`, `reduceRepeats`, `zeroFailureBound`: an integer, a list of integers or a function); `test/stats/exact.test.ts` plants a fault of the right kind in the four of them that have exact items and each loses an item. Every function loses at least one item when it throws.

Against five stand-ins for the whole package (every function returns 0, returns NaN, returns an interval from 0 to 1, throws a RangeError, returns undefined), the 606 items outside the simulation, scale and product families, and the six exact items that need the report or the simulator, pass 36, 25, 41, 18 and 11 respectively, and no exact item passes under any of them.

Effect on the hardness measurement: none yet. `driftbench validate stats --hardness` reads the pilot rows of `bank-scores.jsonl`, which are those of the earlier bank, and every new item passes on the product, so the forecast (73.2), the score after the pilot (0.685) and the distinct causes (62) are unchanged and the gate is still not met. An item the product passes cannot lower the score after a pilot; only items that name a capability or an accuracy the package lacks can. Exact values and accuracy over the domain found one such gap among the 60 new items. The remaining route to the gate is section 12.2 rule 1 and 2: capabilities the parity and research dossiers name that the package does not have, each as a failing item with its own cause, and a new pilot on the extended bank (a new ladder version, section 12.5). The independent audit (12.7: blind pilot, cheater, cause review, planted bugs) has not been run.
