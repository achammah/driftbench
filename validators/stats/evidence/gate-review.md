# Statistics gate review evidence

This report separates bank inventory and mutation checks from pilot measurements. The expanded bank has no fresh pilot. No journal rows are rewritten.

## Historical journal and the two numerical bars

`validators/stats/journal.jsonl` has SHA-256 `c1063300bb7742a933ec6d3c0d8ee4b34358c4b64a28fdc9942c6fcd497b4589`. Its 43 rows all describe a 651-item bank and contain no bank hash or blind executor rows. The builder baseline passes 418 items; iteration 10 passes 446. Mean improvement is 2.8 items per iteration; 205 remain. The later iteration 42 passes 651, but does not replace the pilot end.

| Measure | Historical measurement | Section 12.4 | Stats provisional bar |
|---|---|---|---|
| Forecast | 73.21428571428572 iterations | >=100: fail | >=70: pass |
| Pilot score | 446/651 = 0.6851 rounded | <=0.4: fail | <=0.7: pass |
| Distinct failing causes | 62 | >=100: fail | >=60: pass |

Both overall gates remain not met: the expanded bank has no fresh pilot and its four independent audit checks are pending. The current inventory is 910 items, no family below 20, with tiers 1 through 5. The six added capability cases share three causes; none is counted as a new failing pilot cause.

## Capability and integration checks

All heavy commands use the owner's `slots/run.sh` wrapper. Vitest uses `--maxWorkers=2`.

- `pnpm exec vitest run --maxWorkers=2 packages/validators/test/stats/exact-user-capabilities.test.ts`: red-first registration, 2 failed; after registration, 28 passed. Six items pass four seeds and reject changed numeric results and throws.
- Seven isolated source mutants are killed: ignore the bootstrap callback; ignore it only on resamples; flatten clusters; group children as families; group families as children; ignore the simulation seed; ignore the child-size pool. Additional assertions check every coverage/width method and fractional returned counts.
- `pnpm exec vitest run --maxWorkers=2 packages/validators/test/stats/exact.test.ts packages/validators/test/stats/exact-branches.test.ts packages/validators/test/stats/exact-capabilities.test.ts packages/validators/test/stats/exact-user-capabilities.test.ts packages/validators/test/stats/trap.test.ts`: first integration run 2 failed / 361 passed; final 363 passed. The two harness fixes nudge integer-valued custom statistics and plant the report grouping fault at main's current source anchor. No validator item changes for either fix.
- `pnpm exec tsc --noEmit`: pass.

## Every exported function rejects a literal nudge and a throw

`pnpm exec vitest run --maxWorkers=2 packages/validators/test/stats/export-sensitivity.test.ts`: 58 passed. The test enumerates runtime function exports, traces actual bank calls at seed 1, and retains only passing baseline items. For each function, one item must reject both a changed numeric output multiplied by 1.002 and a throw. Integer outputs are included; returned RNG functions have their draws nudged. Zero and Infinity are unchanged by multiplication and cannot alone satisfy the changed-output assertion. No alternate wrong-output mutant substitutes for the literal nudge in this check.

Functions without a witness: **none**. These are item-sensitivity results, not a new pilot or independent planted-bug audit.

| Export | Same baseline-passing item rejects nudge and throw |
|---|---|
| `abundances` | pass |
| `benjaminiHochberg` | pass |
| `betaQuantile` | pass |
| `binomialCdf` | pass |
| `bootstrapCI` | pass |
| `chaoCoverage` | pass |
| `chiSquareSf` | pass |
| `clopperPearson` | pass |
| `clusteredMeanInterval` | pass |
| `cohenKappa` | pass |
| `cusum` | pass |
| `designEffect` | pass |
| `designEffectFromData` | pass |
| `effectiveSampleSize` | pass |
| `erfc` | pass |
| `goodTuring` | pass |
| `hierarchicalBetaBinomial` | pass |
| `hillNumber` | pass |
| `hillNumbers` | pass |
| `icc` | pass |
| `iccOneWay` | pass |
| `incompleteBeta` | pass |
| `kishEffectiveSize` | pass |
| `kolmogorovSf` | pass |
| `krippendorffAlpha` | pass |
| `ksTest` | pass |
| `logGamma` | pass |
| `mcnemar` | pass |
| `mde` | pass |
| `mean` | pass |
| `mulberry32` | pass |
| `neymanAllocation` | pass |
| `nonInferiority` | pass |
| `normalCdf` | pass |
| `normalQuantile` | pass |
| `normalSf` | pass |
| `oneWayAnova` | pass |
| `pageHinkley` | pass |
| `pairedRateDifference` | pass |
| `parseRepeatReducer` | pass |
| `passAtK` | pass |
| `passK` | pass |
| `quantile` | pass |
| `quantileSorted` | pass |
| `reduceRepeats` | pass |
| `repeatsForFloor` | pass |
| `sampleVariance` | pass |
| `simulateCoverage` | pass |
| `simulateFamilyCoverage` | pass |
| `stratifiedMean` | pass |
| `unreliability` | pass |
| `varianceComponents` | pass |
| `weightedMean` | pass |
| `wilcoxonSignedRank` | pass |
| `wilson` | pass |
| `wilsonEffective` | pass |
| `zFor` | pass |
| `zeroFailureBound` | pass |

## Journal freshness checks

`pnpm exec vitest run --maxWorkers=2 packages/cli/test/validate-bank-freshness.test.ts`: 9 passed after 2 red-first failures. Matching hashes preserve the normal gate; missing hashes are unverified; mismatched hashes are stale. A changed baseline, bank source, fixture, reference input or scoring frame invalidates the pilot. Product and audit edits leave the bank identity unchanged. New stats journal rows require a matching hash captured from the measured JSON report.

Three isolated mutants are killed: disconnect the CLI's fingerprint check (7 failing tests); omit fixture hashing (1 failing test); bypass the journal append hash requirement (1 failing test). Production files are not modified by those transform-based mutants.

The broader command adds `packages/cli/test/validate.test.ts`, `packages/validators/test/hardness.test.ts`, `packages/validators/test/audit.test.ts`, `packages/validators/test/causes.test.ts`, and `packages/validators/test/loop.test.ts`: 64 passed, 2 failed, 2 skipped. The failures are the real stats ladder's observed level 3 against recorded floor 7. The new command tests and the other five files pass. The floor and all validator items are preserved; this report does not claim the whole CLI suite is green.

## Compiled child follow-up on PR 744

PR 744 head `4e317a4d52a7dfff21ccdc9613ada6359de7bd2b` is included in this stack. Its separately bundled child installs the trap before dynamic target and bank imports. Caller capture uses wrapper function identity, so esbuild chunk filenames do not defeat it. The built launcher selects `dist/stats-bank/child.js`, never the public index.

The tsup-built CLI regression runs a clean target (exit 0), an oracle-reading target at module load (exit 1), and a process-spawning target at module load (exit 1). The dedicated child is also exercised directly. A disposable copy selects one existing bank item for this launch-path regression; the live bank and its floor are untouched. Arbitrary direct imports of the public validators index are outside this fix's scope.

On PR 744, `pnpm exec vitest run --maxWorkers=2 packages/validators/test/stats/built-child.test.ts packages/validators/test/stats/trap.test.ts packages/validators/test/stats/isolate-accounting.test.ts` passes 20 tests, following a red-first compiled-path failure. Type checking and Biome pass. Four compiled mutants expose the bypass: restore the public-index route, statically import the target, statically import the bank, or remove wrapper-based stack capture. Each attack then performs its planted operation and exits 0; the protected-path assertions reject that behavior.

## Final combined measurement

Measured source commit: `6e6b39a1ca969823241cfe9b04391e57ffc108cc`. The following documentation-only changes do not alter bank identity. The live bank fingerprint is `51f9969dc376c14def5a482b82d41f65e62e3a4e347fdb97b573d5b76006d2d0`.

`pnpm --silent driftbench validate stats --hardness --json` exits 1. It retains the historical forecast, score and cause count above, reports `freshness.status: unverified` with 43 hashless journal rows, and lists all four pending audits. The existing provisional numerical terms are 70 / 0.7 / 60; their historical numerical pass does not satisfy the overall gate.

The final combined command is `pnpm exec vitest run --maxWorkers=2 packages/validators/test/stats/exact.test.ts packages/validators/test/stats/exact-branches.test.ts packages/validators/test/stats/exact-capabilities.test.ts packages/validators/test/stats/exact-user-capabilities.test.ts packages/validators/test/stats/trap.test.ts packages/validators/test/stats/built-child.test.ts packages/validators/test/stats/isolate-accounting.test.ts`: **375 passed across seven files**. `pnpm exec tsc --noEmit` passes. Biome checks all 16 changed TypeScript files without changes. No existing item ID, cause, tolerance or floor is weakened.

`node tools/structure/api-surface.mjs --build --check` passes: the built public API matches the committed snapshot, with 2507 exports.

The final floor-only confirmation, `pnpm exec vitest run --maxWorkers=2 packages/cli/test/validate.test.ts -t 'runs the registered stats ladder|holds the committed floor of the stats ladder'`, reproduces **2 failed / 29 skipped**. Both failures report level 3 against committed floor 7, at lines 358 and 376. They remain open product/floor discrepancies; neither the tests nor the floor are relaxed.

## Product dependency and integration follow-up

PR 777 (`feat/stats-capabilities`, `36b4abe6d83c15d7d30d91f7ddb9c8da50555ebe`) implements the four missing exports and the numerical repairs on main. Its independent-reference tests, complete 46-item before list, red-first evidence and 19 caught product mutants are in [the product evidence](../../../docs/stats-capabilities-evidence.md). The six capabilities added by this validator PR already pass main and require no product edits.

The fresh expanded-bank baseline on unchanged main is level 3 with 46 failing items. The repaired product reaches level 7 with zero failures against both main's bank and the expanded 910-item bank on seed 1. A further expanded-bank run, `pnpm --silent driftbench validate stats --seeds 1..3 --hidden --all-levels --json`, reaches level 7 on seeds **1, 2, 3 and 119902070**, with **zero failing items**. It uses validator `f5817536281581e462f00aac2c106686e853e739` with the exact product source from PR 777. The hidden seed derives from that validator head. The product source after merge `7bca7bcf177176e08d772e23481d85a55f1c0543` matches that measured source byte for byte; no bank item changes in this integration.

Integration exposes two old source-mutation targets: `zFor` still searches for the upper-tail expression, and the binomial CDF fault removes a PMF branch the new CDF no longer calls. Both fail red in `exact-branches.test.ts`. The tests now mutate the stable lower-tail expression into a one-sided quantile, and remove the CDF's own p=0 point-mass branch. Their required failing and passing items are unchanged. The broader CLI run is stopped because it also launches unrelated component ladders; the final CLI confirmation targets the two statistics floor checks explicitly.

The final relevant command, `pnpm exec vitest run --maxWorkers=2 packages/validators/test/stats/exact.test.ts packages/validators/test/stats/exact-branches.test.ts packages/validators/test/stats/exact-capabilities.test.ts packages/validators/test/stats/exact-user-capabilities.test.ts packages/validators/test/stats/export-sensitivity.test.ts packages/cli/test/validate-bank-freshness.test.ts`, passes **426 tests across six files**. This includes all 36 planted source faults in the branch suite, the two retargeted faults, and the stale-journal regression. Every one of the **62 exported statistics functions** now has a baseline-passing item that rejects both a literal 0.2% nudge and a throw. Functions without such an item: **none**. The four additional audited functions are `holm`, `sampleSizeForEffect`, `kappaInterval` and `mcnemarMidP`; the earlier 58-function table records the pre-product state.

The targeted floor command, `pnpm exec vitest run --maxWorkers=2 packages/cli/test/validate.test.ts -t 'runs the registered stats ladder|holds the committed floor of the stats ladder'`, passes **2 tests with 29 unrelated tests skipped**. It supersedes the earlier level-3 floor failures above. The floor remains 7. Full `pnpm exec tsc --noEmit` also passes on the merged branch.

`node tools/structure/api-surface.mjs --build --check` passes on the merged branch with **2517 exports**. The public API snapshot includes both the product additions and the validator exports. The final `pnpm --silent driftbench validate stats --hardness --json` still exits **1**: forecast **73.21428571428572**, pilot score **0.685099846390169**, and **62** causes remain historical 651-item measurements. The live hash remains `51f9969dc376c14def5a482b82d41f65e62e3a4e347fdb97b573d5b76006d2d0`; all **43** historical rows lack a hash and all **four** audit checks remain pending. The expanded bank has no fresh pilot, and neither numerical bar is an overall passing gate.
