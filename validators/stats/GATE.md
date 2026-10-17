# Stats validator: where the gate stands

Status, 2026-10-12: the owner closed the validator design ("we've done enough work on validator honestly, let's just start building and iterating"). The stats validator merges with the lowered bar below, set to what its honest bank meets. It does not meet the section 12 contract (forecast 100, score after the pilot 0.4, 100 distinct causes), and no item was added to reach it. Every item names its need in [NEEDS.md](NEEDS.md).

## The recorded bar

Max score after the pilot: 0.7
Min forecast: 70
Min distinct failing causes: 60

The owner's fallback, verbatim: "If you cannot do it, lower the bar per validator". The stats bar is what this honest bank meets: a forecast of at least 70 iterations (measured 73.21), a score after the pilot of at most 0.7 (measured 0.6851) and at least 60 distinct failing causes (measured 62). `driftbench validate stats --hardness` reads the three lines above (`parseGate` in `packages/validators/src/hardness.ts`, which takes a value only when it lowers the section 12.4 term). The audit (12.7) still applies: the stats-v2 audit judged the old bank, and this bank has no `audit.md` yet.

## The numbers

From `driftbench validate stats --hardness`, after the stats-v2 audit findings (batch 6, see [NEEDS.md](NEEDS.md)):

| Measure | Value | Gate (docs/validators.md section 12) |
|---|---|---|
| Bank | 651 items, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.6421 (418 of 651) | |
| Score after the pilot | 0.6851 (446 of 651) | at most 0.4: not met |
| Items fixed per iteration | 2.8 | |
| Forecast | 73.21 iterations (205 failing / 2.8) | at least 100: not met |
| Distinct failing causes | 62 | at least 100: not met |
| Audit | `audit.md` absent on this branch (the stats-v2 audit judged the old bank: all four checks fail) | required |

Batch 6 moved the numbers: a degenerate item now asks the RangeError to name the argument, so a function whose message does not name it is one more cause. Every pilot row was remeasured against the statistics package of its own commit.

Later batches (7 and 8 in [NEEDS.md](NEEDS.md)) added 178 exact-value, accuracy and branch items. Every one passes on the product, so none enters the pilot rows that `--hardness` reads: the table above stays the measurement of the bank the pilot ran on (651 items), and the recorded bar above is met on it. The bank now has 834 items.

What the audit findings now measure:

* Cheater attempt 1, the blanket non-finite guard: a net loss of 6 items (1 gained, 7 broken), where it gained 45.
* Planted bugs: the five the audit missed each turn their own item red.
* Causes: each names the failure a reader sees.

## The 62 failing causes, by family

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

## Real product defects: the executor picks these first

The validator found these defects. They are not test artifacts: each one changes a number a user reads.

1. **The report's run pass interval is too narrow.** The scorecard prints a 95 percent interval on each mode's run pass rate, a cluster bootstrap over specs. With 6 specs of 5 repeats (the Acme example's size, rho 0.3) it holds the true rate in about 82 percent of draws. With 20 specs of 3 repeats it holds it in about 92 percent. Items: `simulation.report-run-pass.s6x5` and `.s20x3`. File: `packages/report/src/estimate.ts`.
2. **`campaign plan` uses its own MDE formula.** For the 6 Acme specs with 5 repeats at a 90 percent baseline it prints 21.7 points, where `stats.mde` gives 30.9. With one spec it gives 198.1 points, where `stats.mde` finds no detectable drop. It also has no input for a measured rho. Items: `planned.plan-mde.*`, `planned.plan-rho.*`, `planned.plan-cli.*`. Files: `packages/core/src/runner/campaign.ts`, `packages/cli/src/commands/campaign.ts`.
3. **`mde` throws at a baseline pass rate of 0 or 1.** A pilot where every run passes has a baseline of 1. The documented equation then gives an effect of 0.142 for 50 specs, and no effect (null) at a baseline of 0. Items: `edge.mde.baseline-all-pass` and `edge.mde.baseline-all-fail`. File: `packages/stats/src/power.ts`.
4. **`designEffect` accepts rho below -1 / (m - 1).** `designEffect(10, -0.5)` returns -3.5 and `effectiveSampleSize(100, 10, -0.2)` returns -125. `mde` then returns an effect near 0 from a negative effective sample. Items: `edge.rho-bound.*`. File: `packages/stats/src/intervals.ts`.
5. **`zeroFailureBound` loses precision for a tiny p.** At p 1e-9 it returns 2995732357 runs, where 2995732273 is exact: `log(1 - p)` loses digits that `log1p(-p)` keeps. Item: `edge.zeroFailureBound.p1e-09`. File: `packages/stats/src/intervals.ts`.

Then the planned capabilities that docs pages name: the estate session as the unit (`sessionRate`, docs/estate.md section 7) and the early stop (docs/concepts/run-modes.md).
