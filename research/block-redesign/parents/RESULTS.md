# Lane parents: results of H12 and H13

Branch `research/block-parents`, from origin/main `a7c3280c2`. Pre-registrations: `h12/PREREG.md`, `h13/PREREG.md` (each pushed before its data). Cost: 6.29 USD at a pessimistic stand-in price, of the 15 USD cap (`LEDGER.md`).

| # | Hypothesis | Verdict | Key numbers |
|---|---|---|---|
| H12a | Parent links recover the root count | SUPPORTED (simulation on the real parent forest) | Error of the root count 8.4 grouped, 38.2 flat-linked, 50.8 flat-old at the primary cell. With no false-red flakes, grouped is exact in 72% of repeats against 6%. |
| H12b | Clustered intervals cover | SUPPORTED (simulation) | Naive Wilson covers 73.5% on clustered cells. Wilson on n_eff covers 91.0%. At the Acme-shaped cell (25 trees) the best clustered interval covers 85.6%. The hierarchical model covers 95.7% on its 24 cells. |
| H13 | Isolation runs find undeclared parent dependencies | SUPPORTED (live agent, with limits) | Planted positives caught 8 of 8 (10 of 10 with the ineligible two); negatives flagged 0 of 9; natural edges with a dependency 53 of 94 (56%). One of 54 repeat runs differed. |

## What each result means for the design

- Grouping by earliest failing ancestor removes the inherited duplicates and counts roots. It cannot remove independent flakes: a 1% false-red rate leaves about 9 spurious roots in the 923 blocks, with or without grouping. A flaky parent still needs repeated runs.
- A suite's pass rate over parent-linked trees is clustered by construction. Naive intervals are far too narrow (73.5% coverage), and even clustered intervals undercover at tens of trees. For the suite sizes of driftbench, the hierarchical Beta-Bernoulli model was the only interval near 95% in these simulations. This matches Bowyer et al.
- The isolation check separates a child that needs its stem from one that does not. On Acme the dependency is almost always the conversation (an order block with no history cannot order). Finer, component-level undeclared reads (ledger, world, vars) are not tested here.

## Limits

- H12 is a simulation. Its fault model (detection 0.9, inheritance 1.0 or 0.5, flake 0 or 1%) is mine. The sign of the gain holds across the grid; the size does not.
- H13's agent is a prompt stand-in written for this lane (the Acme policy as a prompt, the real tools). The scorer checks tools, forbidden tools, `must` and `must_not`, and not stage, language or guards.
- H13 sampled 94 of 254 edges to fit the cap. Three deviations from the pre-registration are recorded in `h13/PREREG.md` (temperature refused by the model; two pilot fixes; one scoring fix for planted negatives).
- No product code under `packages/*` was changed. The research code lives under `research/block-redesign/parents/`.

Details: `h12/RESULTS.md`, `h13/RESULTS.md`.
