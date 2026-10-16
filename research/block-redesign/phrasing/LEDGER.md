# Ledger: phrasing lane (cap 40 USD, stop at 36 USD)

Computed by `src/ledger.mts` from `data/usage.jsonl`: each paid call's provider usage fields times the prices in `README.md`. One row per batch and model, in the order the batches ran. Calls that errored before returning usage cost nothing and are not listed.

| Batch | Model | Calls | Input tokens | Output tokens | USD | Cumulative USD |
|---|---|---|---|---|---|---|
| tiny-gen | gpt-6-luna | 74 | 24633 | 14782 | 0.0099 | 0.0099 |
| tiny-gen-v2 | gpt-6-luna | 35 | 14418 | 7482 | 0.0052 | 0.0150 |
| tiny-gen-v3 | gpt-6-luna | 60 | 25306 | 10916 | 0.0080 | 0.0230 |
| agent-tiny-v3-seed | claude-haiku-5-5 | 4 | 23258 | 1225 | 0.0029 | 0.0260 |
| agent-tiny-v3-class | claude-haiku-5-5 | 6 | 33005 | 2213 | 0.0044 | 0.0304 |
| gen-h1 | gpt-6-luna | 1760 | 750063 | 353456 | 0.2517 | 0.2821 |
| gen-h2s2 | gpt-6-luna | 782 | 332460 | 159327 | 0.1129 | 0.3950 |
| gen-h2s3 | gpt-6-luna | 2401 | 1014202 | 483986 | 0.3434 | 0.7384 |
| h4-planted | gpt-6-luna | 20 | 5272 | 1298 | 0.0012 | 0.7396 |
| h4-audit | gpt-6.1-sol | 96 | 28089 | 6195 | 0.1181 | 0.8577 |
| tiny-shared-seed | claude-haiku-5-5 | 4 | 29829 | 715 | 0.0025 | 0.8602 |
| tiny-shared-class | claude-haiku-5-5 | 3 | 22772 | 579 | 0.0007 | 0.8609 |
| agent-h1-class | claude-haiku-5-5 | 259 | 2160751 | 63375 | 0.0718 | 0.9328 |
| agent-h1-seed | claude-haiku-5-5 | 300 | 2599227 | 67593 | 0.0810 | 1.0137 |
| agent-h2s3 | claude-haiku-5-5 | 782 | 6515463 | 190320 | 0.2162 | 1.2299 |
| agent-h2s2 | claude-haiku-5-5 | 248 | 2063661 | 60658 | 0.0687 | 1.2986 |
| agent-h2s2-confirm | claude-haiku-5-5 | 128 | 922638 | 20949 | 0.0248 | 1.3234 |
| agent-h2s3-confirm | claude-haiku-5-5 | 392 | 2834478 | 67644 | 0.0780 | 1.4014 |

Total: 1.4014 USD of 40.

## Notes
- Before the pre-registration, one capability probe of `gpt-6-luna` (13 tokens, under 0.0001 USD) checked which parameters it accepts. It produced no data and is not in the log.
- Tiny samples (protocol rule 3). Generation: `tiny-gen` (6 rows, 33 candidates, 0.0099 USD), `tiny-gen-v2` (6 rows, 0.0052 USD), `tiny-gen-v3` (12 rows, 26 candidates, 0.0080 USD, about 0.0007 USD per planned row). Agent: 4 seed runs and 6 class runs on B2 and B5, 0.0073 USD, about 0.0007 USD per run (5,000 to 6,700 input and 280 to 460 output tokens per run).
- Projection written before scaling: generation of 300 (H1) plus 610 (H2) planned rows at 0.0007 to 0.0015 USD per row, under 1.5 USD; H1 600 agent runs and H2 about 1,300 runs at about 0.0007 USD each, about 1.4 USD; the H4 audit labeller, 50 calls of `gpt-6.1-sol`, under 0.5 USD. Total projection about 3.5 USD, far under the 40 USD cap.
- Price sources. `claude-haiku-5-5`: https://platform.claude.com/docs/en/about-claude/pricing (verified by the lead): 0.10 USD input and 0.50 USD output per million up to 100K tokens; 0.50 and 2.50 over 100K; cache reads 0.01. No run here exceeds 100K input tokens. OpenAI: developers.openai.com/api/docs/pricing, read 2026-10-14.
- `h4-audit` holds 96 calls: a first run of 46 that died in a network outage before writing any label, then one full resumable run of 50.
- Tiny sample on the shared agent (Amendment 2): 4 seed runs and 3 class runs on B3 and B7, 0.0032 USD, 0.00017 to 0.00068 USD per run. Re-projection: H1 600 runs and H2 about 1,300 runs, under 1.5 USD together.
