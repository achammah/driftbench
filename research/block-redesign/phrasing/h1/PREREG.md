# H1 pre-registration: the seed string overstates the block

Written 2026-10-15, before any paid call. The shared setup in `../README.md` binds this file.

## Hypothesis (section 5, verbatim)
| # | Claim | Experiment | Metric | Falsified if |
|---|---|---|---|---|
| H1 | The seed string overstates the block. | 10 existing blocks; seed run 30 times; 30 gated realisations each run once. | Paired seed gap G with Miller paired SE. | Seed beats class in fewer than 7 of 10 blocks (Mizrahi's prior: 72.5%). |

## Design
- Blocks: B1 to B10 (`../README.md`).
- Seed arm: the block's authored user string, 30 runs per block on the live stand-in.
- Class arm: the accepted realisations of the H1 design (the same set H4 gates: 30 planned rows per block, see `../h4/PREREG.md`), each run once (K = 1). A block whose gate drops rows keeps fewer than 30; its n is reported.
- Same prefix, same tools, same agent configuration for both arms. Runs of both arms interleave in one job queue per block order; 8 concurrent workers.

## Metric
- Oracle: the exact oracle (today's Then) is primary, because the claim is about today's blocks. The normalised oracle is reported beside it.
- Per block b: y_seed,b = mean pass over the 30 seed runs; P_b = mean pass over the class realisations (uniform weights, the covering-array design rate). Seed gap G_b = y_seed,b minus P_b, with SE_b = sqrt(s2_seed / 30 + s2_class / n_b).
- Across blocks: mean G with the paired SE of Miller Eq. 7 taking the block as the unit, sd(G_b) / sqrt(10).
- Envelope per block (M1.4, descriptive): P_b with clustered SE and Wilson interval, cells = the values of each axis (one-way cells), MinP, the Bonferroni floor LB_min, P(cell is worst) from Beta(1 + passes, 1 + fails) draws (4000, seed 1001), and the minimum detectable effect. The phrasing share rho needs K at least 2 and comes from H2.

## Verdict
- Seed beats class in block b when G_b > 0 (a tie does not beat).
- FALSIFIED if the seed beats the class in fewer than 7 of the 10 blocks, under the exact oracle. SUPPORTED if in 7 or more.
- INCONCLUSIVE if fewer than 10 blocks can be scored (a block with fewer than 10 accepted realisations, or a run failure that cannot be repaired by the single allowed re-run).
- Also reported, outside the verdict: the count under the normalised oracle, and the count of blocks where the 95% interval of G_b excludes 0.

## Models, sample, stop
- Agent: `claude-haiku-5-5` (see README). Realisations: as H4.
- Sample: 300 seed runs plus at most 300 class runs.
- Tiny sample first: 2 seed runs and 3 class runs on 2 blocks, measured USD per run, total re-projected in `../LEDGER.md`.
- Stop: the lane guard (36 USD). Projected H1 agent cost: a few USD.

## Amendment 2, 2026-10-15, before any agent run of this hypothesis
The agent under test is the shared live Acme agent (`research/block-shared` at `be8bb2f8f`, merged unchanged), not the stand-in of `src/agent.ts`. Details and the harness: README, Amendment 2. Everything else in this file is unchanged.
