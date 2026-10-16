# Ledger: framework persona lane (cap 10 USD, stop at 9.0 USD)

USD is computed from each response's usage fields and the prices in the `research/block-sim` LEDGER header
(claude-haiku-5-5 0.10 in / 0.50 out per 1M, cache read 0.01, cache write 0.125; gpt-5.4-nano 0.20 in /
0.02 cached / 1.25 out). Per-call rows are in each run folder's `usage.jsonl` (kept outside the repository).

| # | When | Batch | Model(s) | Calls | Tokens in / out | USD | Cumulative |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-15 | Tiny sample: HF10 2 blocks x 4 persona ids x 1 trial (8 conversations), HF11 2 conversations (fr base, fr negate, block 5440); found the English polite-word line in the French persona's turns (amendment 1); not data | claude-haiku-5-5, gpt-5.4-nano | 88 + 112 | haiku 278 in, 2,199,690 cache read, 287,304 cache write / 9,341 out; nano 45,803 / 3,832 | 0.07656 | 0.07656 |

Projection after row 1: 0.0077 USD per conversation. HF10 640 conversations about 4.9 USD; HF11 275 about
2.1 USD; lane total about 7.1 USD, under the 9.0 USD stop. No size reduction needed.
| 2 | 2026-10-15 | HF10 full run: 20 blocks x 4 persona ids x 8 trials (640 conversations), 0 errors | claude-haiku-5-5, gpt-5.4-nano | 5,889 + 7,762 | haiku 18,900 in, 149,384,660 cache read, 17,653,337 cache write / 632,307 out; nano 3,257,652 / 270,625 | 5.00837 | 5.08493 |
| 3 | 2026-10-15 | HF11 full run: 11 blocks x 5 arms x 5 trials (275 conversations), 0 errors | claude-haiku-5-5, gpt-5.4-nano | 2,444 + 3,119 | haiku 7,732 in, 61,799,727 cache read, 7,707,535 cache write / 308,745 out; nano 1,329,540 / 103,782 | 2.13222 | 7.21715 |

Lane total 7.22 USD of the 10 USD cap (stop at 9.0). HF12 was offline (0 USD).
