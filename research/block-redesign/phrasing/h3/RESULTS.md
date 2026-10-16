# H3 results: the exact-match oracle, not the agent, causes most class failures

**Verdict: SUPPORTED.** Of the 182 H1 class runs that fail the exact oracle, 116 pass the normalised-slot oracle: **63.7%**. The cluster bootstrap over blocks gives a 95% interval of 34.3% to 89.4%. The registered threshold was below 30% to falsify, at least 50% to support. The point estimate is inside IBM's prior (70 to 90%) only at the top of its interval. The interval is wide because 10 blocks are 10 clusters.

## Per block
| Block | Exact-oracle failures | Become passes | Share | What the agent wrote |
|---|---|---|---|---|
| B1 | 13 | 3 | 0.23 | `88 summit avenue` (3 flips); the other 10 failures are real: with `Ave` the coverage tool misses the address |
| B2 | 27 | 27 | 1.00 | the phone as typed: `(202) 555-0131`, `+1 202 555 0131`, `202.555.0131` |
| B3 | 24 | 5 | 0.21 | the number as typed (5); 19 runs never call `catalog.search` |
| B4 | 16 | 16 | 1.00 | `Sam.Rivera@example.com`, `SAM.RIVERA@EXAMPLE.COM` |
| B5 | 11 | 0 | 0.00 | real: `Rd` makes the coverage tool miss the address |
| B6 | 4 | 0 | 0.00 | real: wrong or missing calls |
| B7 | 30 | 30 | 1.00 | the phone as typed |
| B8 | 18 | 18 | 1.00 | `7 Quarry Ln, Acmeville` (10), `7 Quarry Lane` (5), `7 quarry lane` (3) |
| B9 | 22 | 0 | 0.00 | real: the agent never offers plans on a locked number |
| B10 | 17 | 17 | 1.00 | `Morgan.Diaz@example.com`, `MORGAN.DIAZ@EXAMPLE.COM` |

The split is clean: a block's failures are either almost all oracle (phones, emails, an exact address string) or almost all agent (an abbreviation the tool cannot resolve, a missing call).

## Oracle-error guard
I read every one of the 116 flips: the raw slot value against the gold. All 116 are a formatting of the gold value: spacing or brackets in a phone, case in an email, `Ln` for `Lane`, or the town left out. None is a different value. 11 flips (B1 3, B8 8) rest on an address without the town, the form the H4 second labeller called invalid. Counting those 11 as agent failures gives 105 of 182 = 57.7%, still at least 50%.

## Secondary (outside the verdict)
- H1 seed runs: 122 exact failures, 60 become passes (49.2%). All 60 are B2 and B7, the phone typed with spaces.
- 116 of the 182 class failures fail on slot fields only (`input.<field>` of a slot), and those are exactly the 116 that flip.
- The H2 runs are reported in `../h2/RESULTS.md`.

## Deviations
Amendment 2 (the shared agent; tool names mapped back to the Acme labels before scoring). None else.

Data: `results.json` (pooled share, interval, per block, every flip with its raw and gold values).
