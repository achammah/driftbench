# Handover: validator stats

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate stats --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 1 |
<!-- level-table:end -->
The stats validator is ladder version 2: 834 items in seven levels (651 when the pilot ran, which is what the counts below measure; later batches added items that pass on every seed tried: four clustered-interval items, `simulation.hierarchical.*` and `simulation.wilson-effective.*`, 60 exact-value items (batch 7) and 118 branch items (batch 8), 22 families in all), each with threshold 1. The bank score is the share of items passing on every seed (seeds 1 to 20 and the hidden seed).

## State (executor exec/stats-v3, PR 107): final report

* Final sweep (seeds 1 to 20 and the hidden seed) at commit 4867887a: 647 of 651 items pass on every seed (0.9939), level 3 on all 21 seeds. The row is in `bank-scores.jsonl` (iteration 41).
* The four failing items are all chaoCoverage richness: `analytic.unseen.chao1-near.s20-even.x1.5`, `s40-tail5.x1.5`, `s80-tail10.x1.5` on every seed, and `s20-even.x3` on the hidden seed only. A maintainer is fixing them in a separate PR into main.
* Iteration 41 (d0c14cbf) fixed `degenerate.bootstrapCI.equal`, which failed on seeds 11, 14, 17 and 19 in the earlier sweep.
* Seed 1 went from 592 of 651 (iteration 30) to 648 in iterations 31 to 41 (647 on every seed). Causes fixed, one per iteration: varianceComponents names `observations`; cusum and pageHinkley name the option they refuse; non-finite and out-of-range scalars are named; special functions return the scipy limit at the domain edge; agreement, paired, ksTest, bootstrapCI and quantileSorted refusals name their argument; mean is exact on equal values and overflow safe; varianceComponents centres values before the sums of squares; hillNumber is continuous at q = 1; betaQuantile stops on relative width; neymanAllocation uses a heap; bootstrapCI is exact on equal values.

## Validator item defects (for the maintainer)

* `analytic.unseen.chao1-near.s20-even.x1.5`, `.s40-tail5.x1.5`, `.s80-tail10.x1.5` (3 items): they read `chaoCoverage(counts).chao1` and want it within 10 percent of the true class count at 1.5 draws per class. Chao1 is a lower bound and at that sample size it is far below the truth by construction. `packages/stats/test/reference/fixtures.json` pins `chao1` to the classic estimator (for example 13.851851851851851 for the counts [5,3,1,1,2,1,2,4,1,7]), so the reference level and these items cannot both pass with one `chao1` field. Fixing it needs a new field (for example `iChao1`) that the items read, or a changed fixture. Executor branches may not change either. Not attempted.
* `neymanAllocation` reference fixture versus `analytic.allocation.neyman-optimal.*`: now resolved on this branch (integer optimum by greedy gain, all items pass on seed 1).

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. Ladder version 2 has no floor yet; the maintainer sets it.

## Open items

1. The seven missing methods are built. The remaining failing items are degenerate inputs, neymanAllocation (maintainer), numerical stability and chaoCoverage.
2. Degenerate inputs (about 130 items): per function, a RangeError that names the argument, the scipy limit at the edge of the special functions, exact answers on one or all-equal values. A shared finiteness helper fixes many at once (say so in the journal).
3. chaoCoverage richness (4 items, a maintainer fixes them in a separate PR). Everything else passes on every seed.
4. `simulation.newcombe.n30` fails on one seed of 21 (pairedRateDifference coverage); not touched yet.

## Hypotheses tried

* A scaled percentile bootstrap (interval widened by t / z): coverage 0.898 at 6 x 5, short of 0.95. Rejected.
* Student t interval on the spec rates: 0.889. Rejected.
* Wilson on the effective runs with the t quantile: 0.972 and 0.950. Kept.

## Next actions

1. Degenerate inputs, a few functions per iteration, test first in `packages/stats/test/`. Each item names the function and the argument its RangeError must name.
2. Run the sweep one at a time: `pnpm -s driftbench validate stats --seeds 1..20 --hidden --items --json > out.json` from a copy of the tree (a sweep takes 30 to 50 minutes at a load of 140).
3. Build the journal row from the json (`bank` block) and append it with `pnpm -s driftbench validate stats --journal row.json`.

## Pitfalls

* Never edit the bank: `packages/validators/src/ladders/stats/**` and `packages/validators/fixtures/stats/**`.
* Memory is tight: vitest with `--maxWorkers=2`, only on the packages you touch; one sweep at a time.
* The degenerate contract: Rule 1, a procedure throws a RangeError naming the argument for input it cannot answer; Rule 2, `special.ts` returns NaN or throws, and returns the scipy limit at the domain edge; Rule 3, one value or all-equal values return the defined answer, never NaN.
* The report snapshot `packages/report/test/__snapshots__/acme-x3-scorecard.html` moved with the new interval; update it with `vitest -u` only for an interval change.
* github.com may be unreachable; retry the push every 60 s.

## How to run

```
pnpm driftbench validate stats --seed 1
pnpm driftbench validate stats --seeds 1..20 --hidden
pnpm exec tsx packages/validators/src/ladders/stats/bank/score-cli.ts --seeds 1..20 --hidden
pnpm exec tsx packages/validators/src/ladders/stats/bank/score-cli.ts --seeds 1..20 --hidden --record <iteration> --note "<one line>"
```

The score command prints the bank size, the items passing on every seed, the score, the level per seed and the split by family and tier; with `--record` it appends the row to `validators/stats/bank-scores.jsonl` and prints the forecast of section 12.4.

## Fixtures

* `packages/stats/test/reference/fixtures.json`: the scipy and numpy reference values of level `reference` (version 1's level 1), written by `make_fixtures.py` next to it.
* `packages/validators/fixtures/stats/designs.json`: the planted designs of level `simulation` (version 1's levels 2 to 6): clustered designs, the pilot design, the populations, the planned campaigns.
* `packages/validators/fixtures/stats/roadmap.json`: the roadmap methods (signature, definition, source, cases with scipy values), written by `make_roadmap.py` next to it (`python3 packages/validators/fixtures/stats/make_roadmap.py` from the repository root, scipy 1.18 and numpy 2.5).
* The bank: `packages/validators/src/ladders/stats/bank/`: `reference.ts`, `degenerate.ts`, `reproducibility.ts`, `analytic.ts`, `simulation.ts`, `scale.ts`, `roadmap.ts`; `isolate.ts` and `child.ts` run it; `hardness.ts` and `score-cli.ts` score it.
