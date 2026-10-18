# Statistics product capability evidence

## Baseline

Product source: main `346a8249d460fb0a73c1deb6cdfdc6fd10e0e6ec`. Validator source: PR 771 `f5817536281581e462f00aac2c106686e853e739`. The baseline ran in a separate sparse worktree with all of `packages/stats/src` restored byte for byte from main. Product edits were isolated from that baseline run.

Command: `pnpm --silent driftbench validate stats --seed 1 --all-levels --json`, through the shared `slots/run.sh` wrapper. Result: exit 3, level **3 of 7**, with **46 failing items**, all in the analytic level. Reference, degenerate, reproducibility, simulation, scale and roadmap measurements pass. This is a product baseline on seed 1, not a hardness pilot.

The four missing exports account for 32 failures. Eleven of the 14 numerical defect items fail. `normalQuantile.subnormal-p` and both KS defect items already pass and remain regression checks. Three further failures share the extreme-tail `erfc` defect already identified by PR 744.

The six user-capability items added by PR 771 already pass unchanged main on seeds 1, 2, 3 and 856524023: **24/24 item checks**. `exact-user-capabilities.test.ts` passes **28 tests**. No implementation changes are needed for those six cases.

### Complete failing-item list

- `defect.betaQuantile.far-tail`
- `defect.binomialCdf.huge-n-time`
- `defect.binomialCdf.large-n`
- `defect.chiSquareSf.large-df`
- `defect.clopperPearson.tiny-alpha`
- `defect.hillNumber.large-q`
- `defect.incompleteBeta.large-shape`
- `defect.mde.tiny-alpha`
- `defect.pairedRateDifference.tiny-alpha`
- `defect.wilsonEffective.tiny-alpha`
- `defect.zFor.tiny-alpha`
- `exact.erfc.sibling-infinite`
- `exact.holm.alpha`
- `exact.holm.cap-at-one`
- `exact.holm.monotone`
- `exact.holm.order`
- `exact.holm.single-and-empty`
- `exact.holm.stricter-than-bh`
- `exact.holm.textbook`
- `exact.holm.ties`
- `exact.kappaInterval.alpha`
- `exact.kappaInterval.binary`
- `exact.kappaInterval.chance-level`
- `exact.kappaInterval.clipped`
- `exact.kappaInterval.constant-raters`
- `exact.kappaInterval.disagreement`
- `exact.kappaInterval.labels`
- `exact.kappaInterval.multi-class`
- `exact.kappaInterval.perfect`
- `exact.mcnemarMidP.large-count`
- `exact.mcnemarMidP.larger`
- `exact.mcnemarMidP.less-conservative`
- `exact.mcnemarMidP.no-discordant`
- `exact.mcnemarMidP.small`
- `exact.mcnemarMidP.symmetric`
- `exact.mcnemarMidP.tied-sides`
- `exact.normalCdf.sibling-far`
- `exact.normalSf.sibling-infinite`
- `exact.sampleSizeForEffect.alpha`
- `exact.sampleSizeForEffect.defaults`
- `exact.sampleSizeForEffect.inverse-of-mde`
- `exact.sampleSizeForEffect.power`
- `exact.sampleSizeForEffect.repeats`
- `exact.sampleSizeForEffect.rho`
- `exact.sampleSizeForEffect.small-effect`
- `exact.sampleSizeForEffect.whole-number`

## Product changes

The product adds `holm`, `sampleSizeForEffect`, `kappaInterval` and `mcnemarMidP`, with their public result/input types. The 32 planned-capability items supply the frozen independent reference values. Sample size returns the smallest positive safe integer consistent with `mde`, including exact integer-boundary cases. Kappa uses exact label agreement counts and keeps zero-variance intervals finite.

The numerical repairs preserve lower-tail probabilities for very small alpha, evaluate beta/gamma prefactors without subtracting large log-gamma values, extend beta inversion across the binary64 exponent range, evaluate binomial CDF through incomplete beta, and evaluate Hill diversity with scaled logarithms. An overflow guard restores the infinite/extreme `erfc` limits. `normalQuantile`, KS, and the six already-passing user capabilities receive no implementation changes.

Independent fixture copies retain the bank's provenance and tolerances. Additional bounded checks compare beta against closed forms, gamma against integer-shape survival sums, and binomial CDF against a finite recurrence. These checks do not constitute a hardness pilot.

## Red-first and mutation evidence

Every changed function is covered by the fresh whole-bank baseline above, before product edits. Focused tests then reproduce the defects against immutable main: agreement/planned exports **30 failed**; power/intervals **12 failed**; special functions **6 failed, 1 already passing**; Hill/KS **20 failed, 20 already passing**. Extra review regressions reproduce **2 kappa failures** and **3 sample-size boundary failures** before their fixes.

All commands below run through the shared `slots/run.sh` wrapper. Every Vitest run uses `--maxWorkers=2`.

The following **19 isolated mutants are caught**. No mutation run edits the shared product source:

- Holm running maximum; kappa chance-agreement denominator, exact match counting and zero-SE return; exact p-value substituted for mid-p; paired upper-tail subtraction: **6 mutants**.
- Sample-size strict boundary verification, integer output and correlation metadata; restored upper-tail subtraction in `zFor`, `wilsonEffective`, `mde` and Clopper-Pearson: **7 mutants**.
- Beta inverse iteration limit, beta prefactor cancellation, gamma prefactor cancellation, binomial PMF summation and erfc overflow guard: **5 mutants**.
- Restore the prior Hill-number power sum: **1 mutant**, rejected by 20 tests.

The focused repaired commands pass 66 agreement/comparison tests, 92 power/interval/clustered tests, 3 strict sample-size boundary tests, 28 special-function/normal-tail tests, and 40 diversity/KS tests. The complete product command `pnpm exec vitest run --maxWorkers=2 packages/stats/test` passes **382 tests in 17 files**. Biome checks the statistics source, all five new test files and both copied JSON fixtures without changes.


## Product result

`pnpm --silent driftbench validate stats --seed 1 --all-levels --json` on main plus this product change reaches **level 7 of 7**, with **zero failing items** (exit 7 is the ladder level). The same command against PR 771's expanded 910-item bank, selecting this exact product source through `DRIFTBENCH_STATS_IMPL`, also reaches **level 7**, with **zero failing items**. The complete before list therefore falls from 46 failures to zero without changing any validator item or floor.

`pnpm exec tsc --noEmit` passes. `node tools/structure/api-surface.mjs --build --write` builds the stable source tree and records **2515 exports across 17 packages**, adding the four functions and six supporting types. The initial API attempt detected an edit during its build and refused its stamp; this final run succeeds after all source edits finish.

PR 771 remains the validator review branch and must land after the product change. Additional integration evidence belongs on that branch. These correctness runs are not a fresh hardness pilot: the expanded bank still has no fresh pilot, and its four audit checks remain pending.

The documentation follow-up fixes the new evidence page's reachability and replaces a prohibited en dash. CI first reports both errors against this page; `pnpm exec vitest run --maxWorkers=2 tools/docs` then passes **50 tests across seven files**. The sparse checkout includes the exact tracked README and linked files required by those checks. No product implementation changes in this follow-up.
