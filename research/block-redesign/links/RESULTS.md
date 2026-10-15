# Links lane results (H5, H7)

| Hypothesis | Verdict | Key numbers |
|---|---|---|
| H7: section-level selection is safe and smaller | **SUPPORTED** (registered 90 mutants), fragile | Safety violations on 3 of 90 mutants (3.3%, Wilson 1.1% to 9.3%). Mean selection ratio 0.199. With the 20 two-section mutants (110): 8.2%, FALSIFIED. Sensitivities: 6.7% (stage 1 only), 13.3% (flaky blocks kept). |
| H5: per-root Ochiai beats flat | **FALSIFIED** (real suite, primary) | Grouped is worse on 18 of 98 faults (18.4%; the limit is 10%). Simulation: 1.5% worse, which supports H5. Without the baseline-failing block: 2.4% worse. |

## What the data says for the design

- **Declared links are mostly safe, but they miss two kinds of dependency.**
  - First kind: cross-section behaviour. Negating the CONFIRM rule breaks blocks linked only to the recap.
  - Second kind: inherited failures in later blocks of the same chain.
  - Adding forward closure in the chain (exploratory) brings violations to 2.2% (90 mutants) and 3.6% (110), at a mean selection ratio of 0.23.
- **Per-root counting must keep passing children.**
  - Dropping every child of a failing parent removes the passing rows that clear sections.
  - A persistent baseline failure then causes ties at the top.
  - Dropping only inherited failures (exploratory) gives 3.1% worse.
- **Mutation as ground truth works on a live agent, and it is cheap.**
  - 9,690 conversation runs cost 4.92 USD.
  - Controls stay null: 0 of 60 control variants has a confirmed effect.
  - Negation kills 17 of 30 mutants, drop kills 7 of 30, rephrase kills 1 of 30.
  - 12 of 26 local sections had no killing mutant. They are candidates for new blocks.
- **M3.1:**
  - The re-anchoring battery passed: 0 wrong anchors, and every edited section came out stale.
  - The Citations character unit differs from driftbench's. On a non-ASCII document, `start_char_index` counts code points, not UTF-16 units: it is 23 where UTF-16 gives 25 after two emoji. Offsets need a conversion.

## Shared asset

The live Acme agent is on research/block-shared (be8bb2f8f), path research/block-redesign/shared/acme-live/. It uses the same prompt and tools as this lane.

## Spend

5.29 USD of the 40 USD cap (LEDGER.md). A 7-hour network outage interrupted stage 1. Only the missing jobs were run afterwards, and both parts are logged.

Details: H7/RESULTS.md and H5/RESULTS.md. Raw data: data/runs/, results.json, H7/results.json, H5/results.json.
