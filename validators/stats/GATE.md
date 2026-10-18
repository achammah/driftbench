# Stats validator: where the gate stands

## Current gate review, 2026-10-18

The gate is **not met**. The expanded bank has **no fresh pilot**. The journal still measures the historical 651-item bank, not the current bank. No historical row is relabelled or given a new fingerprint.

This review stacks PR 743 (`ff414718c`), PR 744 (`4e317a4d`, including the compiled-child follow-up to `68e1bc046`) and PR 749 (`25f32ea12`) on main. It adds real capabilities before considering a provisional bar: six items for family coverage simulation and custom-statistic cluster bootstraps. They extend `exact-estimators`, with three shared implementation causes, and preserve every existing item and cause. See [NEEDS.md](NEEDS.md#batch-12-documented-capabilities-before-the-gate-review).

PR 777 (`36b4abe6d`) supplies the product capabilities and numerical repairs before this validator branch lands. Correctness runs reach level 7 with zero failing items on visible seeds 1, 2 and 3 and hidden seed 119902070. These runs do not replace a fresh hardness pilot or any independent audit.

The live bank grows from 904 to 910 items. Every family has at least 20 items and tiers 1 through 5 are present. Those are bank inventory measurements, **not** a fresh pilot, a new forecast or a measured count of failing causes.

## Both bars against the same historical journal

`pnpm driftbench validate stats --hardness` reads `journal.jsonl`. Its builder pilot contains iterations 0 through 10, all on 651 items. The baseline is 418 passing; iteration 10 has 446 passing. The mean improvement is `(446 - 418) / 10 = 2.8` items per iteration. The forecast is `(651 - 446) / 2.8 = 73.2142857` iterations. There are no blind pilot rows. The latest row, iteration 42, records 651 passing; it does not replace the pilot-end measurement.

| Measure | Historical 651-item pilot | Section 12.4 contract | Existing stats provisional bar |
|---|---|---|---|
| Forecast | 73.21 iterations | At least 100: **fail** | At least 70: **pass** |
| Pilot score | 446 / 651 = 0.6851 | At most 0.4: **fail** | At most 0.7: **pass** |
| Distinct failing causes | 62 at iteration 10 | At least 100: **fail** | At least 60: **pass** |
| Current bank identity | Historical rows have no bank hash | **Unverified** | **Unverified** |
| Independent audit | All four current-bank checks pending | **Not met** | **Not met** |

The expanded 910-item bank has no measured pilot score, forecast or pilot failing-cause count. Passing capability tests do not supply those measurements. Neither column licenses merging this bank.

## The recorded provisional bar

Max score after the pilot: 0.7
Min forecast: 70
Min distinct failing causes: 60

These are the existing per-validator provisional terms, retained rather than lowered again. Their original reason is the historical forecast of 73.21, score of 0.6851 and 62 failing causes. They describe what the historical pilot meets, not what the expanded bank meets. The owner requires capability additions first; the six additions above satisfy that order without padding causes or changing the global contract. A fresh matching-bank pilot and independent audit remain necessary before any current-bank gate claim.

The hardness command compares the live bank fingerprint with the journal rows. A mismatched fingerprint is stale; a missing fingerprint is unverified. Both block the gate while preserving the historical figures for inspection. The journal remains unchanged. [audit.md](audit.md) records the four pending checks, and [the evidence report](evidence/gate-review.md) records tests and per-export mutation witnesses.

## Historical pilot: the 62 failing causes, by family

| Family | Causes | Failing items | What they are |
|---|---|---|---|
| degenerate (domain, empty, nonfinite, single-equal) | 40 | 109 | per function, a RangeError that does not name the argument; special functions without the scipy limit; four wrong answers on one or all-equal values |
| missing-method | 7 | 55 | clusteredMeanInterval, designEffectFromData, iccOneWay, kishEffectiveSize, oneWayAnova, stratifiedMean, weightedMean are missing |
| product | 6 | 16 | campaign plan MDE and rho (3 causes), estate sessionRate, early stop, report run pass interval coverage |
| numerical-stability | 4 | 5 | |
| edge-accuracy | 3 | 6 | designEffect below its bound, mde at a baseline of 0 or 1, zeroFailureBound at a tiny p |
| allocation-bruteforce | 1 | 11 | neymanAllocation rounding |
| unseen-known | 1 | 3 | chaoCoverage just above the class count |

A cause can appear in more than one degenerate family, so the degenerate row counts distinct causes over the four.

## Historical defect list from the earlier pilot

This earlier pilot recorded these defects; this list is historical, not a claim that they remain open in the current product. The validator found these defects. They are not test artifacts: each one changes a number a user reads.

1. **The report's run pass interval is too narrow.** The scorecard prints a 95 percent interval on each mode's run pass rate, a cluster bootstrap over specs. With 6 specs of 5 repeats (the Acme example's size, rho 0.3) it holds the true rate in about 82 percent of draws. With 20 specs of 3 repeats it holds it in about 92 percent. Items: `simulation.report-run-pass.s6x5` and `.s20x3`. File: `packages/report/src/estimate.ts`.
2. **`campaign plan` uses its own MDE formula.** For the 6 Acme specs with 5 repeats at a 90 percent baseline it prints 21.7 points, where `stats.mde` gives 30.9. With one spec it gives 198.1 points, where `stats.mde` finds no detectable drop. It also has no input for a measured rho. Items: `planned.plan-mde.*`, `planned.plan-rho.*`, `planned.plan-cli.*`. Files: `packages/core/src/runner/campaign.ts`, `packages/cli/src/commands/campaign.ts`.
3. **`mde` throws at a baseline pass rate of 0 or 1.** A pilot where every run passes has a baseline of 1. The documented equation then gives an effect of 0.142 for 50 specs, and no effect (null) at a baseline of 0. Items: `edge.mde.baseline-all-pass` and `edge.mde.baseline-all-fail`. File: `packages/stats/src/power.ts`.
4. **`designEffect` accepts rho below -1 / (m - 1).** `designEffect(10, -0.5)` returns -3.5 and `effectiveSampleSize(100, 10, -0.2)` returns -125. `mde` then returns an effect near 0 from a negative effective sample. Items: `edge.rho-bound.*`. File: `packages/stats/src/intervals.ts`.
5. **`zeroFailureBound` loses precision for a tiny p.** At p 1e-9 it returns 2995732357 runs, where 2995732273 is exact: `log(1 - p)` loses digits that `log1p(-p)` keeps. Item: `edge.zeroFailureBound.p1e-09`. File: `packages/stats/src/intervals.ts`.

Then the planned capabilities that docs pages name: the estate session as the unit (`sessionRate`, docs/estate.md section 7) and the early stop (docs/concepts/run-modes.md).
