# H12 pre-registration: parent links recover the root count, and clustered intervals cover

Lane: parents. Branch `research/block-parents`, from origin/main `a7c3280c2`. Written before any result.
Source of the hypothesis: section 5 of `reports/Driftbench block redesign deep.md` (row H12), mechanisms M5.2 and 3.5.

## Claim, verbatim from section 5

- Claim: parent links recover the root count and clustered intervals cover.
- Experiment: planted faults in a parent-linked suite; simulated trees with known rates and correlation, 5,000 repeats.
- Metric: roots against planted N; interval coverage (naive, clustered, bootstrap, hierarchical).
- Falsified if: grouped roots no closer to N than flat, or naive intervals cover as well as clustered.
- Cost: offline (simulation and regrouping); small paid for rescue runs.

## What is and is not tested

- Offline only. No model call, no spend. Cost 0 USD.
- The paid "rescue runs" of the section 5 row are NOT run here. Rescue is simulated with a stated detection rate. H13 supplies the only live data of this lane (isolation runs, which are the nearest live analogue of rescue). A verdict here says what the mechanism does on the real parent forest of Acme, under the stated fault model. It does not say what the live agent does.
- The fault model is mine and is part of the pre-registration. The gain of grouping depends on it, and RESULTS reports the sensitivity grid, not only the headline cell.

## Part A: root recovery on the real parent forest

Forest: `h12/forest.json`, built by `forest.cjs` from `examples/acme/generated/specs` at the pinned commit. A trie over (spec Given, kind, target, then each block's When, Given and Then). A chain shared by two or more specs becomes one stem node. A node is one block of the collapsed suite; its parent is the previous block of the chain. Counts at the pinned commit are recorded in RESULTS (the DESIGN note counted 332 specs and 1,390 blocks at an earlier commit; the pinned commit has 335 files and 1,397 blocks).

Fault model, per repeat:
1. Plant N faults on N distinct nodes. N in {1, 2, 3, 5, 8}. Frame U (primary): uniform over all nodes. Frame S (secondary): uniform over stem nodes (shared by 2 or more specs).
2. A planted node is red with probability rho_det = 0.9 (the check can miss).
3. Cascade h in {1.0, 0.5}: a node whose parent is red becomes red by inheritance with probability h, independently. Inheritance moves one edge at a time, so it stops at a node that stays green.
4. Flake eps in {0, 0.01}: every node not otherwise red is red with probability eps, independently.
5. A node that is planted and also under a red parent is just red; the walk cannot tell the cases apart.

Counters (all computed from the same red set):
- flat_old: red blocks counted in today's uncollapsed suite. A red node counts once per spec that contains it, and every block of a spec after a red block follows rule 3.
  Implementation: the red set over the collapsed forest is projected on the 335 paths; each (spec, block) pair is red iff its node is red. This counter is the count of red (spec, block) pairs.
- flat_linked: number of red nodes in the collapsed forest (blocked children counted as fails, no grouping).
- grouped: number of red nodes whose parent is not red (earliest failing ancestor, the M5.2 walk).
- grouped_rescue: grouped, plus the red nodes with a red parent that fail again when run from the parent's canonical end state. A planted node fails under rescue with probability rho_resc = 0.9; an inherited-only node fails under rescue with probability eps (it does not see the parent's mistake).

Metric: mean absolute error |count - N| of each counter, over 5,000 repeats per cell, and the share of repeats with count == N. Paired comparison grouped vs flat_linked: mean difference of the absolute errors with a 95% percentile bootstrap interval over repeats.

Primary cell (fixed now): frame U, N = 3, h = 1.0, eps = 0.01, rho_det = 0.9, rho_resc = 0.9.

Hidden-fault cell (M5.2 sanity check ii): plant a pair (v, w) with w a strict descendant of v, both detectable (rho_det = 1, eps = 0, h = 1). Count how often the walk reports 1 root and how often the rescue reports 2. Success is 100% for both, by construction; any other value is a bug to report.

Verdict rule for Part A (H12a):
- FALSIFIED if, at the primary cell, grouped MAE >= flat_linked MAE (point estimate).
- SUPPORTED if grouped MAE < flat_linked MAE and < flat_old MAE in every cell with h = 1.0, and the paired bootstrap interval at the primary cell excludes 0.
- INCONCLUSIVE otherwise (for example, better at the primary cell but not in every h = 1.0 cell).
- Cells with h = 0.5 are reported, never used for the verdict. Cells with rho_det < 1 add noise to every counter alike.

## Part B: interval coverage on simulated trees

Generative model, Bowyer, Aitchison and Ivanova 2025 clustered setting. The target is the hyper-mean theta (the pass rate of a suite of trees, not of one realisation).
- For each tree g: theta_g ~ Beta(d*theta, d*(1 - theta)); each block of the tree passes with probability theta_g.
- d is the concentration. Small d means strong correlation inside a tree (intraclass correlation 1/(1 + d)).
- Grid (160 cells): G trees in {6, 12, 25, 50, 143}; tree size scheme in {m=1 (control, no clustering), m=3, m=8, real}; theta in {0.6, 0.9}; d in {0.5, 2, 8, 1000}.
- `real`: tree sizes are drawn with replacement from the 143 tree sizes of the real forest (sizes 1 to 47).
- 5,000 repeats per cell, seed 12, numpy `default_rng`, one stream per cell (seed derived from the cell index).

Estimator: pooled pass rate p = (sum of passes) / n over all blocks.

Intervals (95%, all two-sided):
1. naive_wald: p +/- 1.96 sqrt(p(1-p)/n), blocks treated as independent.
2. naive_wilson: Wilson score on (p, n).
3. cl_wald: p +/- 1.96 SE_cl, with SE_cl = sqrt((1/n^2) sum_g (sum_i (s_ig - p))^2) times sqrt(G/(G-1)) (Miller Appendix A with the CR1 factor).
4. cl_wilson_neff: Wilson score with n_eff = n / deff, deff = (SE_cl / SE_naive)^2 clipped to [1, n].
5. boot: cluster bootstrap, percentile, resampling trees with replacement, B = 400.
6. hier: Bowyer's hierarchical model, theta ~ Beta(1,1), d ~ Gamma(1,1) (shape 1, rate 1), theta_g marginalised (beta-binomial per tree), posterior on a grid (100 values of theta, 40 log-spaced values of d from 0.02 to 60), equal-tailed 95% credible interval. Evaluated only for G in {12, 50} and 1,000 repeats per cell, because of cost. Reported separately.

Metric: coverage = share of repeats whose interval contains theta; mean width; share of degenerate intervals (width 0). Monte Carlo error of a coverage is at most 0.7 points at 5,000 repeats.

Clustering cells (used for the verdict): cells where the tree size scheme is m=3, m=8 or real, and d <= 8. That is 5 G x 3 sizes x 2 theta x 3 d = 90 cells.

Verdict rule for Part B (H12b):
- Gap of a method = mean over clustering cells of |coverage - 0.95|.
- FALSIFIED if gap(naive_wilson) <= min(gap(cl_wald), gap(cl_wilson_neff), gap(boot)) (naive covers as well as the best clustered method).
- SUPPORTED if gap(naive_wilson) exceeds that minimum by more than 0.02 and naive_wilson has coverage below 0.93 in at least 75% of the clustering cells.
- INCONCLUSIVE otherwise.
- Control cells (m=1, or d=1000): reported. A clustered method that is worse than naive in the control cells by more than 0.02 is flagged as a cost, not a falsifier.
- hier is reported for the 12 G x size x theta x d cells it covers and never enters the verdict.

## Sanity check (reproduction of a number in the report)

The report's worked example: six trees of six blocks, 26 of 36 pass, SE_naive 0.0747, SE_cl 0.1504, deff 4.06, n_eff 8.9. RESULTS states whether a six-tree arrangement with these numbers exists (exhaustive search over pass counts per tree) and which one.

## Seeds, models, stop rule

- Seed 12. No model. No key. Stop rule: none (fixed grid, fixed repeats).
- Code: `h12/sim.py` (Part A and B) and `forest.cjs` output. Run once; a re-run needs a written reason (crash) and keeps both results.

## Deviations

Clarifications written before any simulation ran (no data seen):
1. Hidden-fault cell: it uses rho_resc = 1 as well as rho_det = 1, eps = 0, h = 1, so that "100% by construction" is true. The same cell is also reported with rho_resc = 0.9.
2. hier cells: G in {12, 50}, size scheme in {m=3, real}, theta in {0.6, 0.9}, d in {0.5, 2, 8}: 24 cells, 1,000 repeats each. The sentence above that says "12 G x size x theta x d cells" means this set.
3. The interval target for unequal tree sizes is still theta, because E[theta_g] = theta whatever the size.
4. Only the final fault count matters for flat_old; it is computed as the sum over nodes of (red) x (number of specs whose path contains the node).

Any later deviation is appended here with its reason before the data it touches is read.
