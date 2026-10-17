# Additional model: gpt-6.1-sol

Generated 2026-10-13T22:02:13.883748+00:00. Sources: `gpt-6.1-sol/seal.json`, `requests.json`, `attempts.jsonl`, both `calls.jsonl` files and `scores.json`.

6560/6560 unique requests recorded; 384 sealed cases per row in each experiment. Both contestants use medium reasoning. Each experiment remains separate.

Measured USD 12.44696800; unknown-attempt reserve USD 3.50000000; model-cell cap USD 25. First five sealed requests form the cost pilot and are retained once. `pilot.json` and `cost-forecast.json` record cost-only projections.

The total generated-token limit is 4096, including hidden reasoning. No answer is retried, including malformed or token-limited output. Token-limit and other lost items are listed in `lost-items.json`; they remain in the denominator and earn no credit.

Standard short-context prices per million tokens, verified 2026-10-13: input USD 2, cached input USD 0.10, cache write USD 2.50, output including reasoning USD 10. [OpenAI pricing](https://developers.openai.com/api/docs/pricing). The route is the Responses API; temperature is omitted. Raw token counts and reported reasoning are retained per call.

## primary

| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| rubric/peer | 384/384 | 384 | 369 | 15 | 0 | 1/16384 = 6.1035156e-05 | 0.76909200 / 0.43080000 | 0/0 | nominal lead |
| factuality/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 0.86114800 / 0.63126600 | 0/0 | TIE (not equivalence) |
| pii/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 0.69587000 / 0.44034600 | 0/0 | TIE (not equivalence) |
| goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 1.00535000 / 0.48029200 | 0/0 | nominal lead |
| goal/peer-full-state | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1.00535000 / 0.66926200 | 0/0 | TIE (not equivalence) |
| pooled-default/mixed | 1536/1536 | 1536 | 1329 | 207 | 0 | 1/102844034832575377634685573909834406561420991602098741459288064 = 9.7234614e-63 | 3.33146000 / 1.98270400 | 0/0 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1536 | 1521 | 15 | 0 | 1/16384 = 6.1035156e-05 | 3.33146000 / 2.17167400 | 0/0 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |
|---|---|---|---|
| rubric/peer | [99.010%, 100.000%] | [93.656%, 97.619%] | [0.000%, 11.719%] |
| factuality/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| pii/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] |
| goal/peer-full-state | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| pooled-default/mixed | [99.751%, 100.000%] | [84.724%, 88.140%] | [12.500%, 15.430%] |
| pooled-equal-evidence/mixed | [99.751%, 100.000%] | [98.395%, 99.407%] | [0.000%, 2.930%] |

## dialect

| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| rubric/peer | 384/384 | 384 | 368 | 16 | 0 | 1/32768 = 3.0517578e-05 | 0.86657800 / 0.42835000 | 0/0 | nominal lead |
| factuality/peer | 384/384 | 381 | 384 | 0 | 3 | 1/4 = 0.25 | 1.05419600 / 0.63279600 | 3/0 | TIE (not equivalence) |
| pii/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 0.78589600 / 0.44119600 | 0/0 | TIE (not equivalence) |
| goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 1.10677600 / 0.47853200 | 0/0 | nominal lead |
| goal/peer-full-state | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1.10677600 / 0.66922200 | 0/0 | TIE (not equivalence) |
| pooled-default/mixed | 1536/1536 | 1533 | 1328 | 208 | 3 | 195729/205688069665150755269371147819668813122841983204197482918576128 = 9.5158169e-58 | 3.81344600 / 1.98087400 | 3/0 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1533 | 1520 | 16 | 3 | 145/32768 = 0.0044250488 | 3.81344600 / 2.17156400 | 3/0 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |
|---|---|---|---|
| rubric/peer | [99.010%, 100.000%] | [93.339%, 97.419%] | [0.000%, 12.500%] |
| factuality/peer | [97.729%, 99.734%] | [99.010%, 100.000%] | [-1.562%, 0.000%] |
| pii/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] |
| goal/peer-full-state | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| pooled-default/mixed | [99.427%, 99.934%] | [84.656%, 88.079%] | [12.174%, 15.495%] |
| pooled-equal-evidence/mixed | [99.427%, 99.934%] | [98.315%, 99.358%] | [-0.326%, 2.995%] |

## Losses and interpretation

3 case-side entries have no usable verdict, covering 3 unique requests. 3 entries reach the output/thinking cap. Full keys and causes remain in `lost-items.json`. No 65536-token request is configured.

Nominal tests use the unchanged exact two-sided McNemar calculation and 20000 family-bootstrap draws. Global multiplicity correction belongs to the collator. The same synthetic cohort is not independent replication. Default goal is information-asymmetric; pooled equal-evidence replaces it with final state supplied to both. Costs shown for overlapping rows and pools must not be summed as additional spend.

Seal SHA-256: `ffb0d67a7d4582f3b358e5b8cb28e462f86aebd73edb1463d9d7adbdaeb349f4`. Original case seal: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. Per-file hashes remain in the seal. Gemini 3.8 was dropped by the owner and its journals remain unchanged.
