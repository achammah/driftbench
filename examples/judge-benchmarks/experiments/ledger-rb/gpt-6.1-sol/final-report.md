## gpt-6.1-sol final cell, 2026-10-14T14:33:19.864528+00:00

Both contestants use the same model, medium reasoning and the original sealed 790 pairs.
The Responses API omits temperature and caps total output, including reasoning, at 8192 tokens.

| Score | Pair ledger | promptfoo | Difference | Paired test |
|---|---|---|---|---|
| Headline, 1580 games | 1276/1580 (80.7595%) | 1335/1580 (84.4937%) | -3.7342 pp | McNemar W/L 55/114, p=6.636877591e-06 |
| Shared unblocked, 1580 games | 1276/1580 (80.7595%) | 1335/1580 (84.4937%) | -3.7342 pp | McNemar W/L 55/114, p=6.636877591e-06 |

Pair-bootstrap 95% difference: -5.8861 to -1.6456 percentage points.
Pair-sign sensitivity: W/L 38/69, p=0.003529272036.
The canonical ledger judgment supplies both games. The paired sensitivity retains that dependence.
Holm correction awaits the complete amended matrix. RubricBench remains preregistered TIE-only.
Observed cell verdict: LOSS.

| Contestant | TEST known USD | TEST holds USD | Full-cell known USD | Full-cell holds USD | Provider-blocked TEST items/requests | Token-limit items lost |
|---|---|---|---|---|---|---|
| pair-ledger | 21.82499420 | 0.25000000 | 26.50948560 | 2.00000000 | 0/0 | 0 |
| promptfoo | 5.55946700 | 0.00000000 | 5.70788950 | 0.00000000 | 0/0 | 0 |

Total liability, including holds: USD 34.21737510; hard cap USD 50.
Pricing per million tokens: input USD 2, cached input USD 0.10, cache writes USD 2.50, output USD 10.
Cache writes use usage.input_tokens_details.cache_write_tokens from each saved receipt.
Price source: https://developers.openai.com/api/docs/pricing. Holds are separate from known spend.
The shared-unblocked score excludes 0 pairs for both contestants.
Any provider block makes the whole item wrong for that contestant in the headline score.
Recorded 65,536-token defects: 0. Transport-missing requests: zero. Active requests: zero.

| Contestant | Input tokens | Cached input tokens | Cache-write tokens | Output tokens | Reasoning tokens |
|---|---|---|---|---|---|
| pair-ledger | 4488959 | 661946 | 3600010 | 1698926 | 394264 |
| promptfoo | 2193099 | 0 | 1685783 | 47880 | 38176 |

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
Other failed fixture groups also use the base judge: total base pairs 717, earned-eligible pairs 73.
Both routes use the same frozen model and prompt; eligibility is not an alternate-model routing gain.

Pre-TEST fixture reads: 198. Noise flips: 2/60 comparisons across 30 pairs.
Validity preservation: relabel 20/20, markdown 20/20; final flip 20/20; injection invariant 20/20.
Above-chance cheaters: 0; allow TEST: True. Validity covers the fixed planted cases only.

| Evidence | SHA-256 |
|---|---|
| contestant-freeze.json | dffe923eba5ab1f4d6e79e64c174a7b2e6b4a2cd59f5e29228ba331c8816c9c9 |
| network-cell-amendment.json | fcd6e74c6b3c27d8923dec5381805fb2836abbbc423fe1f701a9d370a107dfb3 |
| test-run-seal.json | 02694d9973ddeea6304ea6ddae2a97eea88875e9123ae4ecefd1288452ee25a2 |
| pretest-summary.json | 611d8855cc068733463fb16750f11e692cfc9f9358eebfab912b0183ad028cb2 |
| live-summary.json | 9d5ae5465087df108391b47f63959a44b2d460c3c70703bbb5a7181601f5b849 |
| ordered-test.json | 9ce50fa46ef2edd3e509ffea09a5ce1ba44e550bb8a5c55bf60f641112ae9bb1 |
| final-integrity.json | 39d919eda93d1a398f0d7c825094ef6490c1611c26ccd9435300408c88c88dbe |
| provider-block-request-audit.json | 6c246c3ca80fe16c0c2ee2a624ebe1cde4b87a77b5c9d4b5dd80429ddddf3fc8 |
| gpt-6.1-sol-token-loss-audit.json | 47935547f0f2028aa75a30ff29a93e6479561ffab2b69291964ba565961fd194 |
| final-cost-and-token-audit.json | ed50b5018ad993b2b1e7bf4b406c1fbf44e3f7d66b21f9f5a53ca688fcd4c4ea |

Sources are the named artifacts in examples/judge-benchmarks/experiments/ledger-rb/gpt-6.1-sol and its append-only request journals.
Sonnet is approved under USD 60 including holds and runs next, with caching off. Gemini 3.8 is dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. Flash Lite remains the Gemini result.
