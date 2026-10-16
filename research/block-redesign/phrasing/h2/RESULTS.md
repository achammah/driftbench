# H2 results: phrasing failures follow the 1 or 2 factor rule

**Verdict: SUPPORTED, on the primary (normalised) oracle, with a caveat on what the test can see.**
- The block event (strength 3 finds a failure class strength 2 misses) occurred in 2 blocks (B5, B6); the falsifier needed 3 or more.
- 5 blocks had consistently failing realisations, at least the 3 the rule required.
- Of the 124 consistently failing realisations, 122 (98.4%) hold a 1-way candidate tuple; none needed a 2-way tuple; 2 are level 3.

On the exact oracle (reported beside, not the verdict) the event occurs in 3 blocks (B1, B5, B6), which would falsify.

Agent: the shared live Acme agent (`be8bb2f8f`). Runs: 1,030 at K = 2 (248 strength-2, 782 strength-3) and 520 confirmation runs (130 realisations x 4). 0 transport errors.

## Designs after the gate
| | Planned rows per block | Accepted, all blocks | Post-gate coverage |
|---|---|---|---|
| Strength 2 | 14 | 124 of 140 | 2-way 0.86 to 1.00 |
| Strength 3 | 43 to 47 | 391 of 449 | 3-way 0.87 to 1.00 |

The planner gave 14 rows at strength 2 for every block, as section 5 says; the registered "15" came from a different seed set in the offline check. At strength 3 the best of 5 seeds gave 43 to 47 rows (section 5: 45).

## Per block, normalised oracle
| Block | Realisations | Pass / fail / flaky | Failing explained at level 1 / 2 / 3 | Event | rho |
|---|---|---|---|---|---|
| B1 | 55 | 36 / 18 / 1 | 18 / 0 / 0 (all `slot_surface=variant_a`) | no | 0.96 |
| B2 | 59 | 59 / 0 / 0 | | no | 0.00 |
| B3 | 48 | 4 / 36 / 8 | 36 / 0 / 0 (see caveat) | no | 0.51 |
| B4 | 45 | 45 / 0 / 0 | | no | 0.00 |
| B5 | 56 | 31 / 21 / 4 | 20 / 0 / 1 (20 are `slot_surface=variant_a`) | yes | 0.89 |
| B6 | 53 | 42 / 1 / 10 | 0 / 0 / 1 | yes | 0.35 |
| B7 | 54 | 54 / 0 / 0 | | no | 0.00 |
| B8 | 52 | 50 / 0 / 2 | | no | 0.66 |
| B9 | 48 | 0 / 48 / 0 | 48 / 0 / 0 (see caveat) | no | 0.00 |
| B10 | 45 | 45 / 0 / 0 | | no | 0.00 |

Mean phrasing share rho over blocks 0.34.
- rho is high where failures attach to wordings: B1 0.96, B5 0.89 (the abbreviated address).
- rho is 0 where nothing fails or everything fails.

## What the failures are
- **B1 and B5, one factor: `slot_surface=variant_a`.** `88 Summit Ave` and `14 Harbor Rd` make the Acme coverage tool return `found: false`. The agent then offers nothing. variant_a fails both runs in 18 of 18 B1 realisations and 20 of 21 B5 realisations (the other passes once). The other two cells pass both runs in 36 of 37 (B1) and 31 of 35 (B5) realisations. The localiser (candidates first, then failure rate) ranks `slot_surface=variant_a` first in B1. In B5 its top tuples are 2-way tuples that contain `slot_surface=variant_a`: the one variant_a realisation that passed once lowers the 1-way rate below 1.
- **The two level-3 events are single strings, not interactions.**
  - B5 row 16: "Hello, I would like to order the Fiber 1000 plan for 14 harbor road, which is the address I have provided, ...". Other variant_b realisations of B5 pass.
  - B6 row 37: "Hey can I get broadband service for 3 orchard way". "Broadband" in place of "home internet" is a lexical content change no axis names.
  - B5 row 16 failed 5 of 6 runs, B6 row 37 6 of 6. Each is the only failing realisation holding its 3-way tuples.
- **Caveat: B3 and B9 fail almost everywhere.** B9 passes 0 of 48; B3 passes 4. The agent never calls `catalog.search` after `port.check` (see H1), whatever the wording. With no or few passing realisations, every 1-way tuple is a candidate, so "explained at level 1" is vacuous there. Without B3 and B9, 38 of 40 consistently failing realisations are 1-way (B1, B5), 2 are level 3.

## What the test can and cannot show
- Under the registered definitions, any realisation that fails for a reason specific to its own words (not to an axis value) shows up as level 3 when the class around it passes. The 2 events are of that kind. A failure class at level 3 needs at least 2 failing realisations sharing the tuple before it reads as an interaction. That rule was not registered, so the verdict counts both events.
- The 1 or 2 factor rule holds here in a narrow form: every axis-attributable phrasing failure in this agent is one factor (`slot_surface`). No 2-way failure appeared, and no 3-way failure shared by two strings.
- On the exact oracle, B1 adds a third event. It comes from `88 summit avenue` (variant_b) strings that the exact regex `^88 Summit Avenue` rejects for case. That is an oracle effect (H3), which is why the normalised oracle is primary.

## Deviations
- Amendment 2: the shared agent; the strength-2 array size 14, not 15 (see above).
- Confirmation runs as registered: 130 realisations failed both K = 2 runs on the normalised oracle and were run 4 more times; a realisation counts as consistently failing only at 5 or more fails out of 6. The exact-oracle analysis uses the confirmation runs where they exist and the K = 2 rule elsewhere, because the confirmation list was drawn on the primary oracle.

Data: `results.json` (both oracles, per block: explained failures with their candidate tuples, missed classes, localiser top 5, coverage, rho); runs in `../data/h2s2/` and `../data/h2s3/` (`runs-class.jsonl`, `runs-class-confirm.jsonl`).
