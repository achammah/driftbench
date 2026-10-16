# Ledger: lane fw-value (cap 12 USD, stop at 10.8 USD)

Computed by `src/ledger.py` from `data/usage.jsonl`: each paid call's provider usage fields times the prices in `src/common.py` (the prices are listed in PREREG.md). Calls that errored before returning usage cost nothing and are not listed.

<!-- table -->
| Batch | Model | Calls | Input tokens | Cached input | Output tokens | USD | Cumulative USD |
|---|---|---|---|---|---|---|---|
| tiny-labels | gpt-6.1-sol | 3 | 9715 | 0 | 197 | 0.0214 | 0.0214 |
| tiny-labels | gemini-3.6-flash | 3 | 10651 | 0 | 338 | 0.0093 | 0.0307 |
| hf7-gpt-6-luna | gpt-6-luna | 1598 | 269863 | 0 | 78260 | 0.0661 | 0.0968 |
| hf7-gemini-3.6-flash | gemini-3.6-flash | 1601 | 280601 | 0 | 81158 | 0.5148 | 0.6116 |
| hf8-classifier | gpt-6-luna | 182 | 75664 | 0 | 15954 | 0.0155 | 0.6271 |
| hf9-target_a-base1 | claude-haiku-5-5 | 598 | 2188687 | 2008908 | 61752 | 0.0693 | 0.6964 |
| hf5-labels | gemini-3.6-flash | 259 | 923716 | 41996 | 49401 | 0.8497 | 1.5461 |
| hf5-labels | gpt-6.1-sol | 256 | 833706 | 0 | 15314 | 1.8206 | 3.3666 |
| hf9-target_b-prompt | claude-haiku-5-5 | 266 | 982117 | 870492 | 30424 | 0.0358 | 3.4024 |
| hf9-controls-base1 | claude-haiku-5-5 | 303 | 1151071 | 1024746 | 33315 | 0.0395 | 3.4419 |
| hf9-target_a-desc | claude-haiku-5-5 | 664 | 2471103 | 2230400 | 80423 | 0.0873 | 3.5292 |
| hf9-controls-base2 | claude-haiku-5-5 | 302 | 1146861 | 1021364 | 32634 | 0.0391 | 3.5683 |
| hf5-rung3 | gpt-6-luna | 58 | 10946 | 0 | 2834 | 0.0025 | 3.5708 |
| hf9-controls-desc | claude-haiku-5-5 | 305 | 1164693 | 1037000 | 33546 | 0.0399 | 3.6107 |
| hf9-controls-resolve | claude-haiku-5-5 | 303 | 1151366 | 1024746 | 33594 | 0.0397 | 3.6504 |
| hf9-target_a-resolve | claude-haiku-5-5 | 663 | 2444471 | 2242266 | 71896 | 0.0786 | 3.7290 |
| hf9-controls-prompt | claude-haiku-5-5 | 304 | 1152911 | 1025696 | 33660 | 0.0398 | 3.7688 |
| hf9-target_b-base1 | claude-haiku-5-5 | 262 | 971662 | 886084 | 31329 | 0.0331 | 3.8019 |

Total: 3.8019 USD of 12 (stop line 10.8).
<!-- /table -->

## Tiny sample and projection (written before scaling)

Measured on the tiny samples (rows `tiny-labels`, the first 4 HF7 items per model, 4 HF8 classifications, 4 agent runs):

| Unit | Measured USD per unit | Units left | Projected USD |
|---|---|---|---|
| HF5 label, gpt-6.1-sol | 0.0071 | 256 | 1.82 |
| HF5 label, gemini-3.6-flash | 0.0031 | 256 | 0.79 |
| HF7 judgment, gpt-6-luna (both designs) | 0.00006 | 1488 | 0.09 |
| HF7 judgment, gemini-3.6-flash (both designs) | 0.00037 | 1488 | 0.56, x1.5 for the comparison calls negatives need: 0.85 |
| HF8 reply classification, gpt-6-luna | 0.00009 | 178 | 0.02 |
| HF5 rung 3, gpt-6-luna | about 0.00006 per call | about 100 calls | 0.01 |
| HF9 agent run, claude-haiku-5-5 | 0.00069 | 1697 | 1.17 |

Projected lane total: about 4.8 USD, under the 10.8 USD stop line. No fallback from PREREG is needed. No code or prompt changed after the tiny samples, so their answers stay in the data.
