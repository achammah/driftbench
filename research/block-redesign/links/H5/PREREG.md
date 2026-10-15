# H5 pre-registration: per-root Ochiai ranks planted faults better than flat counting

Lane: links. Branch: research/block-links. The commit that adds this file is the pre-registration.
H5 has no paid calls of its own: its real-suite part reuses the H7 runs (see ../H7/PREREG.md).

## Hypothesis (verbatim, report section 5)

| # | Claim | Experiment | Metric | Falsified if | Cost | Validates |
|---|---|---|---|---|---|---|
| H5 | Per-root Ochiai ranks planted faults better than flat counting. | Planted single and double section faults on a parent-linked suite; rank flat and grouped from the same runs. | Top-1, top-3, EXAM, q_d. | Grouped is worse than flat on more than 10% of faults. | Offline on the toy and on simulated verdicts; paid for the real suite (reuses H7 runs). | 3.1, M5.2 |

## Scoring (M3.2), identical for both counts

- Spectrum: declared links (x_bs = 1 when block b declares a link to local section s). Global sections are excluded from ranking (report section 3.1 rule 4).
- Soft weights over k runs: n_cf(s) = sum over linked rows of w_b, n_cs(s) = sum of (1 - w_b), N_F = sum of w_b. Ochiai(s) = n_cf / sqrt(N_F (n_cf + n_cs)); 0 when n_cf = 0.
- Flat: every block is a row, w_b = failures / k.
- Grouped (per root): in each run, a block whose ancestor (any earlier block of its chain) failed in that run is blocked and is not a row for that run. w_b = failures in unblocked runs / unblocked runs; a block blocked in every run is not a row. Passing blocks count once each.
- Rank of a faulty section d: Abreu's tie-averaged tau = (|{j: s_j > s_d}| + |{j: s_j >= s_d}| - 1) / 2 over the N local sections. EXAM = (tau + 1) / N. q_d = (1 - tau / (N - 1)) × 100%. Top-1 and top-3 use the best-case tie rank (|{j: s_j > s_d}| + 1) and the worst-case rank (|{j: s_j >= s_d}|), both reported.
- Double faults: the first faulty section found, that is the faulty section with the lower tau.

## Falsifier and per-fault comparison

- Per fault: grouped is worse than flat when EXAM_grouped > EXAM_flat (strictly).
- Evaluable fault: the flat count has N_F > 0 (at least one failure).
- FALSIFIED if grouped is worse than flat on more than 10% of evaluable faults (threshold verbatim from section 5). SUPPORTED if at most 10% and grouped has a strictly lower mean EXAM. If grouped is worse on at most 10% but the means tie, the verdict is "not falsified, no gain" and reported as INCONCLUSIVE on "better".
- Also reported: top-1, top-3 (best and worst tie), mean EXAM, mean q_d, wins, ties and losses, for each count.

## Three data sets, in this order

1. Toy (offline, deterministic): the seven-block example of deep_5 section (c). Expected from the note: flat S3 0.750 first; grouped S4 and S5 0.707 tied first, S3 0.500. A mismatch is a code bug and stops the lane until fixed.
2. Simulated verdicts (offline, seed 20261014): 2,000 synthetic suites, 1,000 with one planted fault and 1,000 with two. Each suite: 20 local sections; 12 chains with lengths drawn uniformly from 1 to 5; each block linked to 1 to 3 sections drawn uniformly. k = 3 runs. Per run: a block linked to a faulty section fails with probability p_detect, drawn per fault from U(0.3, 1.0); a block whose parent failed in that run fails with probability 0.8 (inherited failure, whatever its links); any block fails by noise with probability 0.03. The parameters are fixed here and not tuned after seeing results.
3. Real suite (paid, the H7 runs): each H7 non-control mutant of a local section is one planted single fault (78 mutants in the full design). k = 3 runs per mutant, raw verdicts. Global-section mutants are SBFL-blind by design and are counted, not scored. Secondary analysis: the same with blocks whose baseline majority verdict is fail removed. If H7 is scaled down, this set shrinks with it. Two-section faults are not run in the real suite (no budget line for them); they are covered by the simulation only, and RESULTS.md says so.

## Verdict rule

The primary verdict is on data set 3 when it has at least 10 evaluable faults; otherwise on data set 2, labelled "simulation only". Data sets 1 and 2 are always reported. A conflict between 2 and 3 is reported as such, never averaged.

## Seeds and budget

Seeds: 20261014 for the simulation. No model calls in H5 itself; the lane budget is the H7 ledger.

## Amendment 1 (2026-10-14, before any mutant run)

The H7 amendment adds 20 two-section mutants (both sections negated). They become the real-suite double faults of data set 3: scored with the "first faulty section found" rule above, reported apart from single faults and pooled. The falsifier counts all evaluable real-suite faults (single and double).
