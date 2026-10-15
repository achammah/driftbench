# Ledger: simulated lane (cap 25 USD, stop at 22.5 USD)

USD is computed from each response's usage fields and the published price read on 2026-10-14:
claude-haiku-5-5 0.10 in / 0.50 out per 1M up to 100K prompt tokens, cache read 0.01
(https://platform.claude.com/docs/en/about-claude/pricing, verified by the lead 2026-10-15; every prompt here
is under 100K); cache write priced at 0.125 (1.25x input, the standard 5-minute write multiplier, not
re-verified);
gpt-5.4-nano 0.20 in / 0.02 cached / 1.25 out; gemini-3.5-flash-lite 0.30 in / 2.50 out (thinking billed
as output); text-embedding-3-small 0.02 in.

| # | When | Batch | Model(s) | Calls | Tokens in / out | USD | Cumulative |
|---|---|---|---|---|---|---|---|
| 0 | 2026-10-14 | Key check before PREREG (one "Say hi") | claude-haiku-5-5 | 1 | 12 / 14 | 0.00001 | 0.00001 |
| 1 | 2026-10-14 | API probes after PREREG (one call each) | gpt-5.4-nano, gemini-3.5-flash-lite | 2 | 40 / 92 | 0.00019 | 0.00020 |
| 2 | 2026-10-14 | H11 tiny sample: 2 blocks x 2 families x 1 trial (4 conversations). Found and fixed a tool-spec gap (verify-identity lacked phone and email fields the guidelines name); pilot data not used | claude-haiku-5-5, gpt-5.4-nano, gemini-3.5-flash-lite | 33 + 11 + 14 | haiku 108 in, 816,215 cache read, 115,534 cache write / 4,279 out; nano 5,162 / 195; gemini 9,170 / 305 | 0.02954 | 0.02974 |

Projection after row 2: 0.0074 USD per conversation. H11 320 conversations about 2.4 USD; H10 300 about 2.5 USD (plus the engine's classifier and realiser calls, small); H14 up to 180 conversations about 1.4 USD plus facets and embeddings. Lane total about 7 USD, under the 22.5 USD stop.
| 3 | 2026-10-14 | H10 tiny sample: 2 scenarios x 3 arms (6 conversations); found and fixed a stale-act engine bug; not used as data | claude-haiku-5-5, gpt-5.4-nano | 53 + 49 | haiku 174 in, 1,334,237 cache read, 172,479 cache write / 5,098 out; nano 28,975 (+1,792 cached) / 1,546 | 0.04523 | 0.07497 |

Projection after row 3: H10 0.0075 USD per conversation, 300 conversations about 2.3 USD.
| 4 | 2026-10-14 | H14 suite generation (1 call) and 5-facet tiny sample | gpt-5.4-nano | 6 | 19,374 / 459 | 0.00445 | 0.07942 |

Projection after row 4: facets 0.0008 USD each, 1,000 about 0.8 USD.

| 5 | 2026-10-15 | H14 remaining 995 facets, 30 cluster names, embeddings of 1,000 summaries and 15 suite lines | gpt-5.4-nano, text-embedding-3-small | 1,030 + 4 | nano 340,635 / 26,262; embed 23,263 | 0.10142 | 0.18084 |
| 6 | 2026-10-15 | H14 blocks tiny sample: 2 blocks x 1 run; not used as data | claude-haiku-5-5, gpt-5.4-nano | 16 + 13 | haiku 54 in, 393,746 cache read, 57,614 cache write / 1,731 out; nano 7,150 / 377 | 0.01391 | 0.19475 |

Projection after row 6: U = 17 uncovered clusters, so M = 17 blocks per arm, 102 runs at about 0.007 USD, about 0.7 USD.
| 7 | 2026-10-15 | H11 full run: 20 blocks x 2 families x 8 trials (320 conversations) | claude-haiku-5-5, gpt-5.4-nano, gemini-3.5-flash-lite | 3,048 + 1,153 + 980 | haiku 9,722 in, 79,048,121 cache read, 7,434,991 cache write / 333,512 out; nano 747,844 (+12,544 cached) / 33,121; gemini 516,576 / 18,140 | 2.27913 | 2.47388 |
| 8 | 2026-10-15 | H10 full run: 100 scenarios x 3 arms (300 conversations) | claude-haiku-5-5, gpt-5.4-nano | 3,178 + 3,014 | haiku 10,364 in, 82,063,510 cache read, 8,438,269 cache write / 351,422 out; nano 1,706,540 (+18,944 cached) / 100,564 | 2.51956 | 4.99344 |
| 9 | 2026-10-15 | H14 blocks full run: 34 blocks x 3 runs (102 conversations) | claude-haiku-5-5, gpt-5.4-nano | 973 + 699 | haiku 3,140 in, 24,753,785 cache read, 2,941,416 cache write / 116,649 out; nano 447,427 (+1,792 cached) / 20,530 | 0.78904 | 5.78248 |

Lane total 5.78 USD of the 25 USD cap. A 7-hour network outage hit after rows 8 and 9 had finished; no run
was lost or repeated.
