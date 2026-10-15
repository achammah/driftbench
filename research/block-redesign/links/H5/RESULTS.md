# H5 results: per-root Ochiai against flat counting

**Verdict: FALSIFIED on the real suite, the registered primary data set.** Grouped counting ranked the planted fault worse than flat counting on 18 of 98 evaluable faults (18.4%). The section 5 limit is 10%. The simulation supports H5 (1.5% worse), and the toy reproduces the note exactly. Both results are reported, and they are not averaged.

Pre-registration: PREREG.md at a89c42f48, with amendment 1 (real-suite double faults) at e13d306b5.

## Results

| Data set | Faults | Grouped worse | Grouped better | Ties | Mean EXAM flat / grouped | Top-1 (worst tie) flat / grouped |
|---|---|---|---|---|---|---|
| 1. Toy (deep_5) | 1 | | | | | |
| 2. Simulation, single | 998 | 15 (1.5%) | 123 | 860 | 0.082 / 0.074 | 84.2% / 90.6% |
| 2. Simulation, double | 999 | 14 (1.4%) | 64 | 921 | 0.054 / 0.051 | 91.3% / 95.9% |
| 3. Real suite, all (primary) | 98 | **18 (18.4%)** | 7 | 73 | 0.308 / 0.310 | 31.6% / 22.4% |
| 3. Real, single | 78 | 13 (16.7%) | 3 | 62 | 0.369 / 0.372 | |
| 3. Real, double (pairs) | 20 | 5 (25%) | 4 | 11 | 0.069 / 0.070 | |
| 3. Secondary: baseline-failing block removed | 84 | 2 (2.4%) | 3 | 79 | 0.275 / 0.275 | |

- Toy: flat S3 0.750 first; grouped S4 and S5 0.707 tied first, S3 0.500. This matches deep_5.
- Real suite: 12 global-section mutants are SBFL-blind and are counted, not scored. All 98 scored faults are evaluable, because the baseline failure `p1` keeps N_F above 0.

## Why grouping lost on the real suite

- Most losses come from a failing parent, not from the planted fault. `p1`, the first block of the porting chain, fails in every run, before any mutation.
- Per-root counting removes its children `p2` and `p3` as rows, including when they pass. Those passing rows were the evidence that cleared the porting sections.
- Without that evidence, the porting sections rise and tie the planted section. 14 of the 18 losses are a half-rank tie of this kind (tie-averaged rank 1 to 1.5, or 2 to 2.5). The other 4 lose one or one and a half ranks.
- Removing the baseline-failing block (the registered secondary analysis) leaves 2 losses in 84 (2.4%).
- Exploratory, not registered: keep passing children of a failing parent as rows, and drop only inherited failures. Grouped is then worse on 3 of 98 (3.1%) and better on 5.
- Exploratory, not registered: restricted to the 35 faults that changed behaviour (non-empty E), the registered grouping is worse on 15 of 35. Its top-1 worst-tie rate falls from 83% to 57%.

## What this means for the design

- The report section 3.1 rule 1 ("children inherited from a failing parent are not rows") is too coarse when children run anyway. A child that passes under a failing parent is evidence and should stay a row.
- Only an inherited failure should be dropped.
- The simulation missed this case: its parents never failed before the fault, and no parent failed persistently.

## Limits

- The real suite is the H7 suite: 26 local sections, 37 blocks, 3 runs per fault.
- Most single local faults (59 of 78) did not change behaviour. Their ranking reflects only the baseline failure.
- Double faults: 20 pairs, both sections negated.
- Raw data: `results.json` (per-fault ranks for both counts and the secondary analysis) and `../results.json` (per-block verdicts). Code: `../ochiai.py`, `../h5_sim.py`, `../analysis_h7.py`, `../exploratory.py`.
