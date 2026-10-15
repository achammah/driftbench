# H14 results: uncovered production clusters yield more failing blocks than random samples

**Verdict: FALSIFIED.** Blocks drafted from uncovered clusters failed less often (2 of 17) than blocks
drawn at random (6 of 17).

## What ran

- Stand-in production: 1,000 ABCD train conversations (8 action flows, seed 14). No consented logs exist;
  ABCD is real human role-play in the agent's domain, MIT licensed.
- Stand-in suite: 15 one-line scenarios written by `gpt-5.4-nano` from the agent's prompt alone, committed
  (`h14/suite.json`, commit fb23692c3) before clustering.
- Clio-style pipeline: a privacy-instructed one-sentence facet per conversation (`gpt-5.4-nano`),
  `text-embedding-3-small`, k-means k = 30, Antoniol-style coverage cut. 17 of 30 clusters came out
  uncovered (`h14/clusters.json`, cluster names, sizes and subflows). The privacy regex flagged 2 of 1,000
  summaries.
- M = 17 blocks per arm: the uncovered arm takes the conversation nearest each uncovered cluster's centroid;
  the random arm draws 17 others uniformly (seed 1414). Each block: the scenario, the human agent's gold
  buttons, the free simulator (`gpt-5.4-nano`), the Haiku agent (effort low); 3 runs each, 102
  conversations, 0 errors. Cost 0.79 USD for the runs, 0.12 USD for suite, facets, names and embeddings
  (LEDGER rows 4 to 6, 9).
- Pre-registration: `h14/PREREG.md`, commit bb8bb5281, no amendment.

## Numbers

| Measure | Uncovered | Random |
|---|---|---|
| Failing blocks (fail in at least 2 of 3 runs) | 2 of 17 (0.118) | 6 of 17 (0.353) |
| Run-level failure rate | 0.196 | 0.412 |
| Reproduce the production outcome (pass in 2 of 3) | 0.882 | 0.647 |
| All 3 runs agree | 0.647 | 0.588 |

- Difference in block failure rate, uncovered minus random: -0.235, Newcombe 95% [-0.484, +0.053].
- One-sided Fisher exact p (uncovered higher) = 0.98.
- Run-level difference, block bootstrap 95%: [-0.431, 0.000].

The falsifier is "uncovered rate not higher": it is lower, so H14 is FALSIFIED. The interval includes 0,
so the data do not show the reverse claim either.

## Reading

- The suite written from the prompt crowds into the refund, return and order flows that open the
  guidelines (12 of its 15 lines). The clusters it leaves uncovered are account access, troubleshooting,
  subscription and price questions: short procedures the agent handles well (for example reset_2fa,
  recover_password, credit_card, out_of_stock: 3 of 3 passes each).
- The flows the suite does cover are where the agent fails: 5 of the random arm's 6 failures are order,
  billing and shipping cases (mistimed_billing_never_bought, status_delivery_time, manage_cancel,
  manage_dispute_bill, status); the sixth is slow_speed.
- Exploratory, not pre-registered: across both arms, blocks whose conversation sits in a covered cluster
  failed 5 of 9; blocks in an uncovered cluster failed 3 of 25. A prompt-derived suite here tracked the
  agent's hard areas, so "uncovered" meant "easy". This would not hold for a suite written from past
  failures, and it says nothing about real production traffic.
- Uncovered clusters are a coverage signal, not a failure predictor, at least in this setup. Ranking
  uncovered clusters by a failure estimate (one cheap run per cluster) would test that directly.

## Limits

- Stand-in production (crowd role-play, every case resolved by a human agent) and a stand-in suite of 15
  generated lines; 17 blocks per arm gives wide intervals.
- k = 30 and the 0.9 coverage cut are choices (Clio publishes neither). The synthetic-reconstruction check
  of M3.6, ddmin and link verification were not run (PREREG deviations).
- The gold-button contract ignores order and values; gold buttons are what one human agent clicked.

Raw data: `h14/results.json` (per-block runs), `h14/clusters.json`, `h14/facets.jsonl`, `h14/suite.json`.
