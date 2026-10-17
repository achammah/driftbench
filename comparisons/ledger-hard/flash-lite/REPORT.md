# Separate Gemini 3.5 Flash-Lite cell

Generated 2026-10-13T12:52:46.172668+00:00. Sources: `flash-lite/seal.json`, `requests.json`, `attempts.jsonl`, both `calls.jsonl` journals and `scores.json`.

Model `gemini-3.5-flash-lite`, reasoning `medium` for both contestants and both experiments. This is the same sealed cohort, 384 cases per row. Results never mix with Gemini 3.8, which was dropped by the owner. Its recorded data remains archived, with no pending continuation.

6560/6560 unique requests recorded. Model-cell measured spend USD 8.18203290, cap USD 9. Combined measured spend plus the USD 0.40 lost-attempt reserve is USD 17.57967320, cap USD 21.

Standard paid pricing, verified 2026-10-13: USD 0.30 ordinary input, USD 0.03 cached input, USD 2.50 output including thinking per million tokens. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). Raw usage and applied reasoning remain recorded per call.

## primary

| Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---:|---:|---:|---:|---:|---|---|---|
| rubric/peer | 384/384 | 382 | 365 | 19 | 2 | 29/131072 = 0.00022125244 | 29/262144 = 0.00011062622 | nominal lead |
| factuality/peer | 384/384 | 378 | 374 | 10 | 6 | 14893/32768 = 0.45449829 | 14893/65536 = 0.22724915 | TIE (not equivalence) |
| pii/peer | 384/384 | 384 | 371 | 13 | 0 | 1/4096 = 0.00024414062 | 1/8192 = 0.00012207031 | nominal lead |
| goal/peer | 384/384 | 367 | 184 | 194 | 11 | 271404659661838721/12855504354071922204335696738729300820177623950262342682411008 = 2.1111942e-44 | 271404659661838721/25711008708143844408671393477458601640355247900524685364822016 = 1.0555971e-44 | nominal lead |
| goal/peer-full-state | 384/384 | 367 | 330 | 41 | 4 | 164221/17592186044416 = 9.3348831e-09 | 164221/35184372088832 = 4.6674415e-09 | nominal lead |
| pooled-default/mixed | 1536/1536 | 1511 | 1294 | 236 | 19 | 23250562328866278834216643/28269553036454149273332760011886696253239742350009903329945699220681916416 = 8.224595e-49 | 23250562328866278834216643/56539106072908298546665520023773392506479484700019806659891398441363832832 = 4.1122975e-49 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1511 | 1440 | 83 | 12 | 636082112379301/19807040628566084398385987584 = 3.211394e-14 | 636082112379301/39614081257132168796771975168 = 1.605697e-14 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|
| rubric/peer | [98.121%, 99.857%] | [92.402%, 96.810%] | [-1.042%, 13.281%] | 2/0 | 0.159166/0.104150 |
| factuality/peer | [96.634%, 99.282%] | [95.273%, 98.579%] | [-0.260%, 2.604%] | 1/3 | 0.118208/0.116997 |
| pii/peer | [99.010%, 100.000%] | [94.295%, 98.011%] | [0.000%, 10.156%] | 0/0 | 0.128492/0.095332 |
| goal/peer | [93.025%, 97.218%] | [42.965%, 52.909%] | [43.750%, 50.260%] | 4/0 | 0.181029/0.084282 |
| goal/peer-full-state | [93.025%, 97.218%] | [82.104%, 89.060%] | [1.562%, 18.490%] | 4/0 | 0.181029/0.116490 |
| pooled-default/mixed | [97.608%, 98.895%] | [82.338%, 85.981%] | [11.719%, 17.122%] | 7/3 | see rows |
| pooled-equal-evidence/mixed | [97.608%, 98.895%] | [92.427%, 94.855%] | [1.628%, 8.203%] | 7/3 | see rows |

## dialect

| Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---:|---:|---:|---:|---:|---|---|---|
| rubric/peer | 384/384 | 384 | 364 | 20 | 0 | 1/524288 = 1.9073486e-06 | 1/1048576 = 9.5367432e-07 | nominal lead |
| factuality/peer | 384/384 | 377 | 379 | 4 | 6 | 193/256 = 0.75390625 | 53/64 = 0.828125 | TIE (not equivalence) |
| pii/peer | 384/384 | 381 | 370 | 14 | 3 | 417/32768 = 0.01272583 | 417/65536 = 0.006362915 | nominal lead |
| goal/peer | 384/384 | 368 | 184 | 189 | 5 | 558115181/3138550867693340381917894711603833208051177722232017256448 = 1.7782576e-49 | 558115181/6277101735386680763835789423207666416102355444464034512896 = 8.8912878e-50 | nominal lead |
| goal/peer-full-state | 384/384 | 368 | 335 | 36 | 3 | 155/4294967296 = 3.608875e-08 | 155/8589934592 = 1.8044375e-08 | nominal lead |
| pooled-default/mixed | 1536/1536 | 1510 | 1297 | 227 | 14 | 9269263560109553790367/883423532389192164791648750371459257913741948437809479060803100646309888 = 1.0492435e-50 | 9269263560109553790367/1766847064778384329583297500742918515827483896875618958121606201292619776 = 5.2462173e-51 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1510 | 1448 | 74 | 12 | 90713160743749/19342813113834066795298816 = 4.6897605e-12 | 90713160743749/38685626227668133590597632 = 2.3448802e-12 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|
| rubric/peer | [99.010%, 100.000%] | [92.093%, 96.603%] | [0.000%, 13.021%] | 0/0 | 0.130227/0.101380 |
| factuality/peer | [96.286%, 99.114%] | [96.989%, 99.443%] | [-2.865%, 1.562%] | 0/1 | 0.102442/0.114548 |
| pii/peer | [97.729%, 99.734%] | [93.974%, 97.816%] | [-2.344%, 10.938%] | 0/0 | 0.113746/0.096298 |
| goal/peer | [93.339%, 97.419%] | [42.965%, 52.909%] | [44.531%, 50.521%] | 2/0 | 0.164331/0.085868 |
| goal/peer-full-state | [93.339%, 97.419%] | [83.530%, 90.212%] | [1.302%, 16.927%] | 2/0 | 0.164331/0.117751 |
| pooled-default/mixed | [97.531%, 98.842%] | [82.542%, 86.167%] | [11.458%, 16.862%] | 2/1 | see rows |
| pooled-equal-evidence/mixed | [97.531%, 98.842%] | [92.994%, 95.326%] | [1.042%, 7.552%] | 2/1 | see rows |

## Interpretation and freeze

The nominal win rule is unchanged: higher accuracy and exact two-sided McNemar p below 0.05. Multiplicity-adjusted matrix wins remain the collator's decision. This added model expands the original matrix and cannot silently inherit an 18-cell correction. Family bootstrap intervals retain synthetic-family uncertainty.

Default goal inputs remain information-asymmetric. The pooled equal-evidence comparison replaces that goal row with final state supplied to both. No pool counts goal twice. This is a new model measurement on the same cohort, not an independent replication. No content is retried. Transport failures and provider limits remain separate from judge outcomes.

Seal SHA-256: `52ff207f43756150597aa803a95ebcb67c85984f75117bb0ad82e6cf52862e44`. Original case seal: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. Reasoning application: `d37718bb39d54c5a81cd64e4b8b6cac9c47d812ab45adb43301dfa7613b9d881`. Statistics source: `4cb7aca0df33899a1479105efae3535a8d635f1eab9c3e1d3ee455ca6243fecd`. Per-file hashes are retained inside the committed seal.
