# H1 results: the seed string overstates the block

**Verdict: FALSIFIED, by the registered count.** Under the exact oracle (today's Then) the seed beat its class in 6 of 10 blocks; the threshold was 7.

**The count hides a floor.** In the other 4 blocks the seed itself failed all 30 runs, so it could not beat anything. In all 6 blocks where the seed passed at least once, it beat the class, and the 95% interval of the gap excluded 0 in all 6.

Agent: the shared live Acme agent (`research/block-shared` at `be8bb2f8f`, `claude-haiku-5-5`, effort low). 300 seed runs and 259 class runs, 0 transport errors.

## Per block (exact oracle, primary)
| Block | Seed pass (30 runs) | Class pass (n) | Gap G | 95% interval | Seed beats class |
|---|---|---|---|---|---|
| B1 address | 1.000 | 0.552 (29) | +0.448 | 0.26 to 0.63 | yes |
| B2 callback phone | 0.000 | 0.000 (27) | 0.000 | | no (tie at 0) |
| B3 port number | 0.000 | 0.000 (24) | 0.000 | | no (tie at 0) |
| B4 email | 1.000 | 0.333 (24) | +0.667 | 0.47 to 0.86 | yes |
| B5 plan and address | 0.933 | 0.607 (28) | +0.326 | 0.12 to 0.53 | yes |
| B6 address in a question | 1.000 | 0.846 (26) | +0.154 | 0.01 to 0.30 | yes |
| B7 phone after a failure | 0.000 | 0.000 (30) | 0.000 | | no (tie at 0) |
| B8 address, exact string | 1.000 | 0.308 (26) | +0.692 | 0.51 to 0.87 | yes |
| B9 locked number | 0.000 | 0.000 (22) | 0.000 | | no (tie at 0) |
| B10 email | 1.000 | 0.261 (23) | +0.739 | 0.55 to 0.92 | yes |

Mean gap over the 10 blocks: +0.303, paired SE 0.099 (Miller Eq. 7, block as the unit).

Why the four seeds fail every run:
- B2 and B7: the seed is `+1 202 555 0131`; the agent passes it to `notify_sales` as typed, with spaces. The spec expects `+12025550131`. Every run fails on `customer.phone`, an oracle mismatch (see H3).
- B3: the agent checks the number but never calls `catalog.search` in the same turn, and passes the number as typed. B9: the agent never sends `port.check` the E.164 number and never calls `catalog.search`. These are agent behaviours that differ from the deterministic agent, whatever the phrasing.

## Normalised oracle (reported beside)
Seed beats class in 3 of 10 blocks (B1 +0.345, B5 +0.326, B6 +0.154); 6 ties; B3 goes the other way (seed 0.000, class 0.208): in 5 of 24 class runs the agent also called `catalog.search`, which it never did on the seed. Mean gap +0.062, paired SE 0.053.

## What it means
- Under today's exact oracle, a hand-written seed that passes reads far better than its class: in every non-floor block the class pass rate is 15 to 74 points lower.
- Most of that gap is the oracle, not the agent. With the normalised oracle, the gap stays only where the agent really behaves differently on reworded input: B1 and B5 (`Ave` and `Rd` make the coverage tool miss the address, and the agent then offers nothing) and B6.
- The registered falsifier counted ties at 0 as "seed does not beat class". It did not foresee seeds that always fail. A falsifier restricted to blocks where the seed passes at least once would read 6 of 6. That reading is post hoc and is not the verdict.

## Envelope (M1.4, exact oracle, cells = slot_surface value)
- Worst cell is `variant_a` (abbreviated address, mixed-case email, formatted phone) in B1, B4, B5 and B8, with P(worst) 0.79 to 1.00. B1's variant_a cell passes 0 of its runs: the coverage tool does not find `88 Summit Ave`.
- In the 6 non-floor blocks the canonical cell (the seed's own spelling of the value) passes 46 of 47 class runs (B6 8 of 9, the rest all); the two other cells carry almost every class failure.
- MinP is 0 in 9 of 10 blocks: one cell always fails. B6 is the exception (MinP 0.62).
- One-way cell rates for every axis, LB_min, P(worst) and the minimum detectable effect per block are in `results.json`. With K = 1 the phrasing share rho is not estimable here; H2 reports it.

## Deviations
- Amendment 2: the shared live Acme agent replaced my stand-in before any H1 run. The stand-in's tiny sample is excluded.
- The two arms ran as two concurrent processes, not one interleaved queue as registered. Same agent, same prefix, same time window.
- Rows the gate dropped: B9 kept 22 realisations, B10 23, B3 and B4 24.

Data: `results.json`; runs with tool calls and both verdicts in `../data/h1/runs-seed.jsonl` and `../data/h1/runs-class.jsonl`; raw agent output in `../data/h1/results-*.jsonl`.
