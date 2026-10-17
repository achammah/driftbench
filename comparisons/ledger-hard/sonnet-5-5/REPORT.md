# Additional model: claude-sonnet-5-5

Generated 2026-10-14T03:20:29.086117+00:00. Sources: `sonnet-5-5/seal.json`, `requests.json`, `attempts.jsonl`, both `calls.jsonl` files and `scores.json`.

6560/6560 unique requests recorded; 384 sealed cases per row in each experiment. Both contestants use medium reasoning. Each experiment remains separate.

Measured USD 33.72676500; unknown-attempt reserve USD 1.00000000; model-cell cap USD 45. First five sealed requests form the cost pilot and are retained once. `pilot.json` and `cost-forecast.json` record cost-only projections.

The total generated-token limit is 4096, including hidden reasoning. No answer is retried, including malformed or token-limited output. Token-limit and other lost items are listed in `lost-items.json`; they remain in the denominator and earn no credit.

Sonnet uses the Claude print-mode route, alias `sonnet`, an empty folder, explicit grading system text, disabled settings/tools/MCP/session persistence, and safe mode. `CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096` bounds adaptive thinking plus visible output; a fixed thinking budget is not supported by Sonnet 5.5. CLI-reported `total_cost_usd` is authoritative. [Claude environment documentation](https://code.claude.com/docs/en/env-vars).

## primary

| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| rubric/peer | 384/384 | 337 | 371 | 3 | 37 | 10701/549755813888 = 1.9465006e-08 | 1.92050800 / 1.43627600 | 47/0 | LOSS |
| factuality/peer | 384/384 | 375 | 364 | 15 | 4 | 1259/65536 = 0.019210815 | 2.10311590 / 1.70480400 | 9/0 | nominal lead |
| pii/peer | 384/384 | 384 | 374 | 10 | 0 | 1/512 = 0.001953125 | 1.70792000 / 1.46071800 | 0/0 | nominal lead |
| goal/peer | 384/384 | 381 | 192 | 192 | 3 | 154497/3138550867693340381917894711603833208051177722232017256448 = 4.9225584e-53 | 2.14697200 / 1.25651400 | 3/0 | nominal lead |
| goal/peer-full-state | 384/384 | 381 | 356 | 25 | 0 | 1/16777216 = 5.9604645e-08 | 2.14697200 / 1.93785000 | 3/0 | nominal lead |
| pooled-default/mixed | 1536/1536 | 1477 | 1301 | 220 | 44 | 11668324187155147651728699777845132422026206013307/463168356949264781694283940034751631413079938662562256157830336031652518559744 = 2.5192404e-29 | 7.87851590 / 5.85831200 | 59/0 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1477 | 1465 | 53 | 41 | 1269841006050060543474866827/4951760157141521099596496896 = 0.25644235 | 7.87851590 / 6.53964800 | 59/0 | TIE (not equivalence) |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |
|---|---|---|---|
| rubric/peer | [84.103%, 90.670%] | [94.295%, 98.011%] | [-18.750%, 0.000%] |
| factuality/peer | [95.606%, 98.762%] | [92.093%, 96.603%] | [-1.302%, 9.635%] |
| pii/peer | [99.010%, 100.000%] | [95.273%, 98.579%] | [0.000%, 7.812%] |
| goal/peer | [97.729%, 99.734%] | [45.024%, 54.976%] | [47.917%, 50.000%] |
| goal/peer-full-state | [97.729%, 99.734%] | [89.663%, 94.907%] | [0.000%, 15.104%] |
| pooled-default/mixed | [95.077%, 97.011%] | [82.814%, 86.414%] | [8.398%, 14.453%] |
| pooled-equal-evidence/mixed | [95.077%, 97.011%] | [94.210%, 96.319%] | [-2.734%, 4.427%] |

## dialect

| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| rubric/peer | 384/384 | 384 | 373 | 11 | 0 | 1/1024 = 0.0009765625 | 2.55895000 / 1.41448910 | 0/0 | nominal lead |
| factuality/peer | 384/384 | 383 | 362 | 22 | 1 | 3/524288 = 5.7220459e-06 | 2.67037600 / 1.71114600 | 1/0 | nominal lead |
| pii/peer | 384/384 | 384 | 372 | 12 | 0 | 1/2048 = 0.00048828125 | 2.32225800 / 1.44836800 | 0/0 | nominal lead |
| goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 2.74010000 / 1.25075600 | 0/0 | nominal lead |
| goal/peer-full-state | 384/384 | 384 | 357 | 27 | 0 | 1/67108864 = 1.4901161e-08 | 2.74010000 / 1.93564400 | 0/0 | nominal lead |
| pooled-default/mixed | 1536/1536 | 1535 | 1299 | 237 | 1 | 239/220855883097298041197912187592864814478435487109452369765200775161577472 = 1.0821536e-69 | 10.29168400 / 5.82475910 | 1/0 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1535 | 1464 | 72 | 1 | 37/2361183241434822606848 = 1.567011e-20 | 10.29168400 / 6.50964710 | 1/0 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |
|---|---|---|---|
| rubric/peer | [99.010%, 100.000%] | [94.944%, 98.393%] | [0.000%, 8.594%] |
| factuality/peer | [98.540%, 99.954%] | [91.478%, 96.186%] | [0.000%, 14.583%] |
| pii/peer | [99.010%, 100.000%] | [94.618%, 98.203%] | [0.000%, 9.375%] |
| goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] |
| goal/peer-full-state | [99.010%, 100.000%] | [89.963%, 95.123%] | [0.000%, 16.406%] |
| pooled-default/mixed | [99.632%, 99.989%] | [82.678%, 86.290%] | [12.891%, 18.490%] |
| pooled-equal-evidence/mixed | [99.632%, 99.989%] | [94.138%, 96.261%] | [1.497%, 8.398%] |

## Losses and interpretation

60 case-side entries have no usable verdict, covering 60 unique requests. 0 entries reach the output/thinking cap. Full keys and causes remain in `lost-items.json`. No 65536-token request is configured.

Nominal tests use the unchanged exact two-sided McNemar calculation and 20000 family-bootstrap draws. Global multiplicity correction belongs to the collator. The same synthetic cohort is not independent replication. Default goal is information-asymmetric; pooled equal-evidence replaces it with final state supplied to both. Costs shown for overlapping rows and pools must not be summed as additional spend.

Seal SHA-256: `ba83523dd663834077afdeae20cae22d361e53d8c6025cda75fb9379ac7d5e18`. Original case seal: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. Per-file hashes remain in the seal. Gemini 3.8 was dropped by the owner and its journals remain unchanged.
