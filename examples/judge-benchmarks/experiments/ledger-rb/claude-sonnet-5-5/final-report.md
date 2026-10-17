## claude-sonnet-5-5 final cell, 2026-10-15T10:19:16.485800+00:00

Both contestants use the same model, medium reasoning and the original sealed 790 pairs.
The lean native CLI uses alias sonnet, medium effort and an 8192-token output cap.

| Score | Pair ledger | promptfoo | Difference | Paired test |
|---|---|---|---|---|
| Headline, 1580 games | 1328/1580 (84.0506%) | 1310/1580 (82.9114%) | 1.1392 pp | McNemar W/L 99/81, p=0.2049917368 |
| Shared unblocked, 1580 games | 1328/1580 (84.0506%) | 1310/1580 (82.9114%) | 1.1392 pp | McNemar W/L 99/81, p=0.2049917368 |

Pair-bootstrap 95% difference: -0.8861 to 3.1013 percentage points.
Pair-sign sensitivity: W/L 83/55, p=0.02119954969.
The canonical ledger judgment supplies both games. The paired sensitivity retains that dependence.
Holm correction awaits the complete amended matrix. RubricBench remains preregistered TIE-only.
Observed cell verdict: TIE-only preregistered.

| Contestant | TEST known USD | TEST holds USD | Full-cell known USD | Full-cell holds USD | Provider-blocked TEST items/requests | Token-limit items lost |
|---|---|---|---|---|---|---|
| pair-ledger | 41.13406800 | 0.50000000 | 52.98688440 | 0.50000000 | 0/0 | 0 |
| promptfoo | 10.88294600 | 0.00000000 | 11.18512600 | 0.00000000 | 0/0 | 0 |

Total liability, including holds: USD 64.67201040; hard cap USD 67.
Costs use native CLI total_cost_usd from each receipt. Initial cache-on costs remain included once.
Both contestants use DISABLE_PROMPT_CACHING=1 after the original five cache-on measurement calls.
Unknown-cost holds are separate from proven spend; the cap includes both.
The shared-unblocked score excludes 0 pairs for both contestants.
Any provider block makes the whole item wrong for that contestant in the headline score.
Recorded 65,536-token defects: 0. Transport-missing requests: zero. Active requests: zero.

| Contestant | Input tokens | Cached input tokens | Cache-write tokens | Output tokens | Reasoning tokens |
|---|---|---|---|---|---|
| pair-ledger | 9297887 | 1824 | 14874 | 3429154 | 934283 |
| promptfoo | 4806954 | 0 | 11826 | 149530 | 132158 |

Token-limit lost items: none.

### Blocked request comparison, saved requests only

| Our blocked request | Reason | Our system/user characters | Unblocked promptfoo system/user characters | Schema |
|---|---|---|---|---|
| No provider-blocked request from our judge | none | not applicable | not applicable | not applicable |

Our system asks for per-requirement scores and evidence; candidates and rubrics appear in user data tags.
Promptfoo places criteria, question and quoted candidates in its system message and asks for one integer.
Its user message says "Output the index now.". Our schema specifies ledger rows; promptfoo has no schema.
Native Claude receives the schema as user-message text; Responses sends a strict output schema.
These saved request differences are product-fix leads, without causal attribution or extra model calls.

The five undersized domains remain ineligible for earning: 24/790 TEST pairs, or 3.0379747%.
Their counts are Math 3, gpqa 1, helpful 8, mbpp 8 and mmlu-pro 4. Categories stay separate.
Other failed fixture groups also use the base judge: total base pairs 618, earned-eligible pairs 172.
Both routes use the same frozen model and prompt; eligibility is not an alternate-model routing gain.

Pre-TEST fixture reads: 198. Noise flips: 6/60 comparisons across 30 pairs.
Validity preservation: relabel 20/20, markdown 20/20; final flip 20/20; injection invariant 20/20.
Above-chance cheaters: 0; allow TEST: True. Validity covers the fixed planted cases only.

| Evidence | SHA-256 |
|---|---|
| contestant-freeze.json | 8b71d19cab9e6ce3d1e5d45d8413a33ee14617d42ee9aac6b9a92a9fa9acc6c6 |
| network-cell-amendment.json | 33de387207b43803f10f79f02c58c9e22ed5f3460d435fdecce849d483ffbc50 |
| test-run-seal.json | 52b5d9c205e450c6ccbefa50e5fe5ecf35c8e2fb376c5cfd20113c992732f8e2 |
| pretest-summary.json | 30450f824032691eaf58c84ef995f387aa777f0f513dad896002680fd375005f |
| live-summary.json | 7a200c6dbdabc4c919bceea385c05f5764bb70caebfa5b61573292ff14e00cd6 |
| ordered-test.json | ad5dda8d0f13cb506a48536ec668d8ad702bb449838d061c45885878c05baf64 |
| final-integrity.json | ed9cc6f718335b52a00c30bda1073fa36203a856e510acf820f7ce3e87a1bd28 |
| provider-block-request-audit.json | 6c246c3ca80fe16c0c2ee2a624ebe1cde4b87a77b5c9d4b5dd80429ddddf3fc8 |
| claude-sonnet-5-5-token-loss-audit.json | 741d33888f49d0ac05cf35bca64afb59d1c4075117094965a0da53bac9772a58 |
| final-cost-and-token-audit.json | 12e1db99fd8a788a9a4cbd5bc4ee2bc2dcc46263c228e1c4c62864222949f0c6 |

Sources are the named artifacts in examples/judge-benchmarks/experiments/ledger-rb/claude-sonnet-5-5 and its append-only request journals.
Sol and Sonnet are complete. Gemini 3.8 is dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. Flash Lite remains the Gemini result.
