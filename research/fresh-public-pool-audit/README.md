# No fresh JudgeBench or RubricBench pool

2026-10-15. **Zero eligible items remain in either published dataset. No paid calls ran; spend is USD 0.** The owner stopped further public-benchmark work. There is no new default-judge result and no change to any earlier TIE verdict.

| Public source, pinned revision | Published items | Excluded by prior item ID | Fresh |
| --- | ---: | ---: | ---: |
| [JudgeBench](https://huggingface.co/datasets/ScalerLab/JudgeBench/tree/57dd5e0b9817d07f05ec8f45a91b2ce1e310e308), GPT + Claude splits | 620 | 620 | 0 |
| [RubricBench](https://huggingface.co/datasets/DonJoey/rubricbench/tree/430cfa40193d4f65998bfc63627f4b952c373e55), train split | 1,147 | 1,147 | 0 |

**Exclusion proof:** JudgeBench's earlier `prior-recorded-ids.json` covers 349 of 350 GPT items. The earlier ledger test pool covers all 270 Claude items. The remaining GPT ID, `b7bbea2c-8e83-50be-a385-70d16a0d507c`, occurs in `research/moj/data/judgebench.json` as `practice-ext` (blob `82c5880da913c351bc0f2ba60e0ae166a17a879f`). RubricBench's earlier `previous-recorded-ids.json` exactly matches all 1,147 public IDs; one retained Haiku recording independently contains them all.

Every item has an ID witness in [exclusions.json](exclusions.json). [evidence.json](evidence.json) records source hashes, historical blob IDs, the public-ID intersections and the zero-spend ledger. Prepared run manifests count as exposure under the requested rule; a raw public-data cache alone does not. Removing question overlaps cannot enlarge an empty ID-filtered pool. The populations have 528 and 1,140 distinct normalized questions, respectively.

This is a full-population exclusion certificate from decisive witnesses, not a claim that every historical file was exhaustively audited. The broader scan stopped when the owner narrowed the task. Missing historical exposure can only exclude more items; it cannot create a fresh item here.

## Planning power, not a new result

Exact paired-sign-test power integrates over the number of discordant pairs. Target: 80% probability of a positive-direction rejection. The two-sided test uses Holm's conservative first threshold, 0.05/5, for each benchmark's five peers: promptfoo, DeepEval, Inspect, Langfuse and LangWatch.

| Historical Haiku ledger proxy vs promptfoo | Prior N | W / L | Discordance / conditional win rate | Required independent pairs, alpha .01 | Joint ten-test sensitivity, alpha .005 |
| --- | ---: | ---: | --- | ---: | ---: |
| JudgeBench | 270 | 27 / 11 | 0.140741 / 0.710526 | 481 | 544 |
| RubricBench | 790 | 184 / 76 | 0.329114 / 0.707692 | 211 | 239 |

JudgeBench's observed accuracy difference is +5.93 percentage points. RubricBench uses the sign of each pair's two-order score difference; it does **not** treat 1,580 presentations as independent. Sources: the earlier ledger JudgeBench cell report and [RubricBench PR 386](https://github.com/achammah/driftbench/pull/386) at `62bccf262`.

These effects belong to the benchmark-only ledger, not default v7. Peer-specific fresh default effects are unknown. The numbers are planning proxies, not 80% joint power to beat all peers. Repeated questions also require question-level sampling or clustered inference.

`python3 verify.py` checks the exclusion certificate offline. `python3 power.py` reproduces the exact power calculation with NumPy and SciPy, including a check against SciPy's exact binomial test. [power.json](power.json) contains the calculation and limitations.

The ten-item-per-side pilot and full run cannot be formed. Unit-cost measurement and new p-values are N/A. No product pre-registration was committed. Section 4.5 receives no new evidence; its conditions are not reassessed from these empty pools.
