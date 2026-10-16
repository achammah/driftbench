# H12 results: parent links recover the root count, and clustered intervals cover

Pre-registration: `PREREG.md` (commits c6f7610 and 83d7ec6, both before any simulation ran). Offline, 0 USD. Raw data: `results_a.json`, `results_b.json`, `results_hier.json`, `results_example.json`; verdicts and tables: `results.json` (made by `analyse.py`). Code: `sim.py`, `../forest.cjs`.

## Verdict

| Part | Claim | Verdict |
|---|---|---|
| H12a | Grouping by earliest failing ancestor gets the root count closer to the planted count than flat counting | SUPPORTED, under the stated fault model |
| H12b | Clustered intervals cover better than naive intervals | SUPPORTED, but no clustered interval reaches 95% at the suite sizes of Acme |

Both verdicts follow the rules written in PREREG. The fault model is a simulation on the real parent forest, not a live agent. Part A shows what the mechanism does if faults behave as modelled. It does not show that live faults behave that way.

## The forest

At the pinned commit `a7c3280c2`, `examples/acme/generated/specs` holds 335 spec files and 1,397 blocks. The trie collapse leaves 923 blocks in 143 trees (474 blocks repeated). Tree sizes run from 1 block (51 trees) to 47 blocks. The depth is at most 7. Earlier notes counted 332 specs and 1,390 blocks at an older commit.

## Part A: root recovery

Setup: plant N faults on random blocks, 5,000 repeats per cell. A planted block is detected with probability 0.9. A child of a red block turns red with probability h. Every other block is falsely red with probability eps.

Primary cell (N = 3, h = 1, eps = 0.01, uniform frame): mean absolute error of the root count.

| Counter | Error | Exact |
|---|---|---|
| flat_old (today's suite, every copy of a stem block) | 50.8 | 0% |
| flat_linked (collapsed, no grouping) | 38.2 | 0% |
| grouped (earliest failing ancestor) | 8.4 | 0.04% |
| grouped with rescue | 8.8 | 0.02% |

- Grouped is closer to N than flat in all 20 cells with h = 1 (both frames, N from 1 to 8, eps 0 and 0.01). The paired difference at the primary cell is -29.8 (95% interval -30.2 to -29.3) against flat_linked and -42.4 (-43.1 to -41.6) against flat_old.
- The gain comes from inherited duplicates. With eps = 0 and N = 3, grouped gets the exact count in 72% of repeats. Flat_linked gets it in 6%. Mean error is 0.31 against 6.9 and 9.8.
- A false-red rate of 1% per block swamps this. About 9 of the 923 blocks are falsely red in every repeat, and grouping cannot remove independent flakes. The residual error of 8.4 is that flake floor, not a failure to group. The report's own advice (run a parent several times, mark it flaky) is the lever for this, and this simulation does not test it.
- Rescue does little here. At eps = 0 it moves the exact share from 55% to 58% (N = 5) and from 37% to 43% (N = 8). At eps = 0.01 it adds 0.3 false roots. It is worth keeping only for the hidden-fault case.
- Hidden fault (a second fault under the first): the walk reports 1 root in 100% of 5,000 repeats, and rescue reports 2 roots in 100% (rescue detection 1.0) or 90.4% (rescue detection 0.9). This is true by construction and only confirms the code.
- With partial inheritance (h = 0.5) the gap narrows: at N = 3, eps = 0 the error is 0.31 (grouped) against 1.83 (flat_linked) and 3.72 (flat_old).
- Stem-only faults (frame S) widen the gap: at N = 3, eps = 0 the error is 0.33 against 20.5 (flat_linked) and 35.7 (flat_old).

## Part B: interval coverage

Setup: Bowyer's clustered model, 160 cells, 5,000 repeats, 95% nominal. The clustering cells (tree sizes 3, 8 or the real sizes, and d of 8 or less) are 90 of them.

| Method | Mean coverage, clustering cells | Share of cells below 93% | Mean coverage, control cells |
|---|---|---|---|
| naive Wald | 69.7% | 100% | 88.7% |
| naive Wilson | 73.5% | 96% | 95.4% |
| clustered Wald (CR1) | 86.4% | 68% | 87.8% |
| Wilson on n_eff | 91.0% | 47% | 95.7% |
| cluster bootstrap | 87.9% | 64% | 88.4% |

- Naive intervals fail where trees are correlated. Their mean gap from 95% is 21.5 points. The best clustered method, Wilson on n_eff, has a gap of 4.1 points.
- Coverage depends on the number of trees G. Wilson on n_eff covers 88.1% at G = 6, 91.6% at G = 25, 93.1% at G = 50 and 94.0% at G = 143. Acme has 143 trees today, but a single suite run on one flow has far fewer.
- At the headline cell (G = 25, real sizes, theta = 0.9, d = 2) the coverage is 60.4% (naive Wilson), 80.1% (CR1 Wald), 84.7% (bootstrap) and 85.6% (Wilson on n_eff). No tested clustered CLT or bootstrap interval reaches 93%.
- The hierarchical model (Bowyer et al.) was run on 24 cells with 1,000 repeats. Mean coverage 95.7%, mean gap 1.4 points, widths 0.12 to 0.43, coverage 91.0% to 98.9% by cell. On the same cells Wilson on n_eff has a gap of 5.3 points, the bootstrap 6.9 and naive Wilson 21.5. It is conservative in several cells, and falls to 91.0% in its worst.
- Control cells (no clustering): Wilson on n_eff costs nothing (95.7% against 95.4%). The CR1 Wald and the bootstrap lose 7 points there because of small G and values near 0 or 1; this is a known weakness of percentile and Wald intervals, flagged as a cost.
- Monte Carlo error is at most 0.7 points per cell at 5,000 repeats, and 3 points at 1,000 repeats.

## Sanity check of the report's worked example

Exhaustive search: exactly one arrangement of six trees of six blocks with 26 passes gives SE_cl 0.1504: pass counts (0, 3, 5, 6, 6, 6). It gives SE_naive 0.0747, deff 4.06 and n_eff 8.86. The report's numbers (4.06 and 8.9) reproduce.

## Limits

- The fault model, the detection rates (0.9) and the flake rate (1%) are my choices. The sensitivity cells show the gain is robust in sign but not in size.
- Part A uses the structure of the real forest only. It uses no live agent, and the paid rescue runs of the section 5 row are not run.
- Verdict rules were fixed in PREREG. No cell was added, dropped or re-run after seeing results. The 160-cell grid ran once.
