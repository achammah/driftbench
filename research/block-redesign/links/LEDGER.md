# Links lane ledger (H5, H7)

Lane cap 40 USD; stop at 36 USD. Prices per million tokens: claude-haiku-5-5 input 0.10, output 0.50, cache write 0.125, cache read 0.01. USD is computed from each response's usage fields.

| Date | Batch | Model | Calls | Input / cache write / cache read / output tokens | USD | Cumulative USD | Note |
|---|---|---|---|---|---|---|---|
| 2026-10-14 | pilot-0 | claude-haiku-5-5 | 12 | 5379 / 6764 / 33820 / 1039 | 0.0022 | 0.0022 | pilot, 2 conversations, excluded from analysis |
| 2026-10-14 | sample-0 | claude-haiku-5-5 | 66 | 26332 / 0 / 223212 / 6834 | 0.0083 | 0.0105 | tiny sample: 1 full suite run (19 conversations) = 0.0083 USD per suite run; projection 456 runs + 10% confirmations = 4.2 USD, under 30 USD, no scaling |
| 2026-10-14 | mutants attempt 1 | gpt-6-luna | about 95 | not metered (usage was not logged) | 0.0500 (upper-bound estimate) | 0.0605 | generation stopped: the generator echoed its input labels, so the validity gate rejected controls and LLM bodies carried label lines; logic fixed, all mutants regenerated (attempt-1 log kept in mutants-attempt1/) |
| 2026-10-14 | baseline | claude-haiku-5-5 | 397 | 157699 / 0 / 1342654 / 40182 | 0.0493 | 0.1098 | 6 baseline suite runs (analysis data) |
| 2026-10-15 | citations unit check | claude-haiku-5-5 | 1 | 879 / 0 / 0 / 55 | 0.0001 | 0.1099 | M3.1 non-ASCII check (citations_unit.py) |
| 2026-10-15 | mutants attempt 2 | gpt-6-luna | 90 | 12465 / 0 / 0 / 17224 | 0.0099 | 0.1198 | 150 single-section variants + 20 pairs, all passed the gate (mutants/manifest.json) |
| 2026-10-15 | stage1 | claude-haiku-5-5 | 33534 | 13474330 / 5699400 / 107275429 / 3575041 | 4.9201 | 5.0399 | 170 variants x 3 full suite runs. A 7-hour network outage stopped the first pass at 120 complete variants (uncaught APIConnectionError); only the missing (variant, rep, conversation) jobs were re-run, nothing completed was re-run (9690 conversation runs) |
| 2026-10-15 | confirm | claude-haiku-5-5 | 1512 | 710855 / 177973 / 4918337 / 207701 | 0.2464 | 5.2863 | confirmation runs: 133 (mutant, conversation) pairs x 3 (399 conversation runs) |
| 2026-10-15 | price check | none | | | | 5.2863 | claude-haiku-5-5 price confirmed: https://platform.claude.com/docs/en/about-claude/pricing (up to 100K tokens 0.10 in, 0.50 out, 0.01 cache read per million). Total lane spend 5.29 USD of 40 |
