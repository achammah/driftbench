# Ledger: given lane (cap 30 USD, stop at 27 USD)

USD from each call's usage fields and the published price: claude-haiku-5-5 0.10 / 0.50 USD per million input / output tokens up to 100K input, 0.50 / 2.50 above (https://platform.claude.com/docs/en/about-claude/pricing, verified by the lead; cache reads 0.01, not used; every H8 input stays under 100K, measured); gpt-6-luna 0.10 / 0.50 (third-party trackers that cite OpenAI's pricing page; that page answered our fetch with 403). Rows come from `calls.jsonl` via `ledger.py`. A call that ended in an API error is not billed and is not logged.

| Batch | Model | Calls | Input tokens | Output tokens | USD | Cumulative USD |
|---|---|---|---|---|---|---|
| m42-wire | claude-haiku-5-5 | 17 | 12747 | 3659 | 0.0031 | 0.0031 |
| m42-wire | gpt-6-luna | 34 | 3503 | 109 | 0.0004 | 0.0035 |
| m42-wire2 | gpt-6-luna | 19 | 4875 | 68 | 0.0005 | 0.0040 |
| h6-pilot | claude-haiku-5-5 | 5 | 6833 | 1577 | 0.0015 | 0.0055 |
| h6-judge-pilot | gpt-6-luna | 4 | 835 | 20 | 0.0001 | 0.0056 |
| h6-full | claude-haiku-5-5 | 1239 | 1759225 | 296798 | 0.3243 | 0.3299 |
| h8-filler | gpt-6-luna | 20 | 2700 | 25924 | 0.0132 | 0.3431 |
| h8-pilot | claude-haiku-5-5 | 12 | 396249 | 716 | 0.0400 | 0.3831 |
| h8-full | claude-haiku-5-5 | 2888 | 62129845 | 154825 | 6.2904 | 6.6735 |
| h6-judge-full | gpt-6-luna | 900 | 180236 | 4500 | 0.0203 | 6.6938 |
| h8-resume | claude-haiku-5-5 | 1307 | 28042037 | 71191 | 2.8398 | 9.5336 |

Unlogged: 3 probe calls to gpt-6-luna chat completions (reasoning_effort none, minimal, low; about 120 input tokens each), under 0.0001 USD.

Projection after the H6 pilot (4 runs, 0.00037 USD per run): H6 900 runs about 0.33 USD; judge about 0.05 USD.

Projection after the H8 pilot (2026-10-15, before the full H8 run): a 64K run costs 0.0064 USD with one model call (0.0128 USD for the address block, which calls coverage.check, so two calls); a 2K run 0.0002 USD. Per size, 5 blocks x 6 cells x 30 runs, with address doubled: 64K about 6.9 USD, 16K about 1.7, 4K about 0.45, 2K about 0.25. H8 total about 9.3 USD. Cumulative projection with H6 and its judge: about 9.8 USD, under the 27 USD stop line. No trim.

H8 first attempt: 1,125 of 3,600 runs failed during a network outage (errors are not billed); the resume batch re-ran exactly those jobs.

Total spend: 9.53 USD of the 30 USD lane cap (H6 0.34, H8 9.17, M4.2 wire checks under 0.01, H8 filler 0.01).
