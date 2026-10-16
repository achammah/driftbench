# H2 pre-registration: phrasing failures follow the 1 or 2 factor rule

Written 2026-10-15, before any paid call. The shared setup in `../README.md` binds this file.

## Hypothesis (section 5, verbatim)
| # | Claim | Experiment | Metric | Falsified if |
|---|---|---|---|---|
| H2 | Phrasing failures follow the 1 or 2 factor rule. | 6 axes of 3 values; strength-2 array (14 strings) against strength-3 (45) on 10 blocks, K = 2. | Share of failing cells explained by 1-way and 2-way tuples. | Strength 3 finds a failure class strength 2 misses in 3 or more blocks. |

## Design
- Axes and constraint as in the README. Array sizes: the planner gives 15 rows at strength 2 and 46 at strength 3 under the constraint `length == terse -> distractor == none` (section 5 quotes 14 and 45, computed without that constraint). Seeds per block b: strength 2 `2000 + 10 * b`, strength 3 `3000 + 10 * b`, best of 5 seeds each.
- Each design is realised and gated on its own (designs `h2s2`, `h2s3`), with the same gate as H4. Rows the gate drops are reported with the post-gate coverage.
- K = 2 runs per accepted realisation on the live stand-in.
- Oracle: the normalised oracle is primary. A phrasing failure must be the agent's, not a false failure of the exact oracle, which H3 tests. The exact oracle is reported beside it.
- Confirmation runs, added before data with this reason: with K = 2 a realisation that fails both runs by chance looks like a phrasing failure and inflates the 3-way count. Every realisation that fails both of its K = 2 runs is run 4 more times. It counts as consistently failing only when it fails at least 5 of its 6 runs.

## Definitions
- Consistently passing: passed both K = 2 runs. Consistently failing: as above. Every other realisation is flaky and joins neither set.
- P_b: the consistently passing realisations of block b, both designs pooled.
- A t-way tuple (axis=value pairs) is a candidate for block b when no realisation in P_b holds it (NIST SP 800-142 Ch. 10, F \ P, on rates).
- A consistently failing realisation is explained at level 1 when it holds a 1-way candidate; else at level 2 when it holds a 2-way candidate; else at level 3 when it holds a 3-way candidate; else it is unexplained at strength 3.
- A failure class at level 3 is a 3-way candidate T held by a consistently failing realisation explained at level 3.

## Metric and verdict
- Metric: share of consistently failing realisations, pooled over blocks and designs, explained at level 1 or 2. Also per block, and the level histogram.
- Block event: the strength-3 run of block b has a level-3 failure class T, and no consistently failing realisation of the strength-2 run of block b holds T.
- FALSIFIED if the event occurs in 3 or more blocks. SUPPORTED if it occurs in 2 or fewer blocks AND at least 3 blocks have one or more consistently failing realisations. INCONCLUSIVE if fewer than 3 blocks have any consistently failing realisation: the experiment then cannot show the event.
- Descriptive (M1.2, M1.4): post-gate t-way coverage of each design, the localiser ranking (candidates first, then failure rate, simpler tuples on ties) per block, and the envelope with the phrasing share rho (K = 2, confirmation runs excluded so K is equal).

## Models, sample, stop
- Agent and gate as README. About 10 x (15 + 46) x 2 = 1220 runs, plus 4 per consistently failing realisation.
- Tiny sample first: covered by the H1 tiny sample (same agent, same run shape); the H2 cost is projected from the H1 measured USD per run.
- Stop: the lane guard (36 USD).

## Amendment 2, 2026-10-15, before any agent run of this hypothesis
The agent under test is the shared live Acme agent (`research/block-shared` at `be8bb2f8f`, merged unchanged), not the stand-in of `src/agent.ts`. Details and the harness: README, Amendment 2. Everything else in this file is unchanged.
