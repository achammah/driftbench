# LongJudge verify confirmation

Evidence timestamp: 2026-10-14T02:18:25.871990+00:00.

Gemini 3.8 Flash: dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. It is removed from pending work. Flash Lite remains the Gemini result.


- Branch: research/ledger-verify. Core contract: PR 168 at 35f07309a4d1d1c8a7c5b176ff19e537d0ef8fdd.
- All 221 TEST items are sealed. This is a previously evaluated split, not an unseen holdout.
- The 221 TEST items contain 219 distinct questions. Bootstrap intervals cluster by the exact question text.
- Official labels are primary. The unchanged 23-correction audit is a sensitivity analysis.
- Contestants: frozen uncertainty cascade 558d75de and promptfoo llm-rubric at 8014282.
- Every returned model answer stays cached. Transport failures and partial reports remain visible.

## Strict headline and product-final scores

Accuracy intervals are Wilson 95%. Paired intervals use the frozen request-cluster bootstrap.
Strict is the headline: any output-limit hit makes the affected contestant/item an error, even if a later fallback returns a verdict. For the additional Sonnet and Sol cells, any native refusal is also an error, at any token count.
Product-final uses the verdict the frozen product returns, including its own fallback. Both rules apply equally to both contestants.
Missing and unparsed final decisions count as wrong. An observed error is a measured outcome; a stopped run is provisional.
The output-limit column counts observed TEST completion envelopes, cascade / promptfoo. Cached reuse can affect more items than envelopes.

### Strict headline, official labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Native refusals: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|---|---|
| haiku | 164/221, 74.21% [68.06%, 79.53%] | 159/221, 71.95% [65.69%, 77.46%] | 7 / 0 | not audited | 2.26% [-2.73%, 7.62%] | 19 / 14 | 0.48685024 | pending | TIE |
| haiku (labelled audit correction) | 163/221, 73.76% [67.58%, 79.11%] | 159/221, 71.95% [65.69%, 77.46%] | 8 / 0 | not audited | 1.81% [-3.18%, 7.21%] | 19 / 15 | 0.60759136 | pending | TIE |
| gpt-6-luna | 165/221, 74.66% [68.54%, 79.94%] | 160/221, 72.40% [66.16%, 77.87%] | 0 / 0 | not audited | 2.26% [-2.73%, 7.21%] | 18 / 13 | 0.47312966 | pending | TIE |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | not reported | not reported | not reported | not reported | not reported | not reported | not reported | not reported |
| gemini-3.5-flash-lite | 138/221, 62.44% [55.90%, 68.56%] | 127/221, 57.47% [50.88%, 63.80%] | 5 / 0 | not audited | 4.98% [-2.24%, 11.87%] | 39 / 28 | 0.22154873 | pending | TIE |
| claude-sonnet-5-5 | 176/221, 79.64% [73.84%, 84.42%] | 152/221, 68.78% [62.39%, 74.52%] | 0 / 0 | 0 / 28 | 10.86% [5.80%, 16.22%] | 31 / 7 | 0.00011616701 | pending | PENDING_HOLM |
| gpt-6.1-sol | 173/221, 78.28% [72.39%, 83.21%] | 170/221, 76.92% [70.94%, 81.99%] | 0 / 0 | 0 / 0 | 1.36% [-2.26%, 5.00%] | 10 / 7 | 0.62905884 | pending | TIE |

### Strict headline, audited labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Native refusals: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|---|---|
| haiku | 185/221, 83.71% [78.27%, 88.00%] | 180/221, 81.45% [75.80%, 86.02%] | 7 / 0 | not audited | 2.26% [-2.74%, 7.27%] | 19 / 14 | 0.48685024 | pending | TIE |
| haiku (labelled audit correction) | 184/221, 83.26% [77.78%, 87.60%] | 180/221, 81.45% [75.80%, 86.02%] | 8 / 0 | not audited | 1.81% [-3.60%, 6.85%] | 19 / 15 | 0.60759136 | pending | TIE |
| gpt-6-luna | 188/221, 85.07% [79.77%, 89.17%] | 181/221, 81.90% [76.29%, 86.42%] | 0 / 0 | not audited | 3.17% [-1.80%, 8.11%] | 19 / 12 | 0.28104152 | pending | TIE |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | not reported | not reported | not reported | not reported | not reported | not reported | not reported | not reported |
| gemini-3.5-flash-lite | 158/221, 71.49% [65.21%, 77.04%] | 142/221, 64.25% [57.74%, 70.28%] | 5 / 0 | not audited | 7.24% [0.00%, 14.16%] | 42 / 26 | 0.068118674 | pending | TIE |
| claude-sonnet-5-5 | 199/221, 90.05% [85.39%, 93.33%] | 167/221, 75.57% [69.50%, 80.76%] | 0 / 0 | 0 / 28 | 14.48% [9.13%, 19.91%] | 37 / 5 | 4.4337048e-07 | pending | PENDING_HOLM |
| gpt-6.1-sol | 196/221, 88.69% [83.83%, 92.22%] | 193/221, 87.33% [82.30%, 91.09%] | 0 / 0 | 0 / 0 | 1.36% [-2.26%, 5.00%] | 10 / 7 | 0.62905884 | pending | TIE |

### Product-final sensitivity, official labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Native refusals: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|---|---|
| haiku | 168/221, 76.02% [69.97%, 81.17%] | 159/221, 71.95% [65.69%, 77.46%] | 7 / 0 | not audited | 4.07% [-0.45%, 9.01%] | 19 / 10 | 0.13604595 | pending | TIE |
| gpt-6-luna | 165/221, 74.66% [68.54%, 79.94%] | 160/221, 72.40% [66.16%, 77.87%] | 0 / 0 | not audited | 2.26% [-2.73%, 7.21%] | 18 / 13 | 0.47312966 | pending | TIE |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | not reported | not reported | not reported | not reported | not reported | not reported | not reported | not reported |
| gemini-3.5-flash-lite | 138/221, 62.44% [55.90%, 68.56%] | 127/221, 57.47% [50.88%, 63.80%] | 5 / 0 | not audited | 4.98% [-2.24%, 11.87%] | 39 / 28 | 0.22154873 | pending | TIE |
| claude-sonnet-5-5 | 176/221, 79.64% [73.84%, 84.42%] | 152/221, 68.78% [62.39%, 74.52%] | 0 / 0 | 0 / 28 | 10.86% [5.80%, 16.22%] | 31 / 7 | 0.00011616701 | pending | PENDING_HOLM |
| gpt-6.1-sol | 173/221, 78.28% [72.39%, 83.21%] | 170/221, 76.92% [70.94%, 81.99%] | 0 / 0 | 0 / 0 | 1.36% [-2.26%, 5.00%] | 10 / 7 | 0.62905884 | pending | TIE |

### Product-final sensitivity, audited labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Native refusals: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|---|---|
| haiku | 189/221, 85.52% [80.27%, 89.55%] | 180/221, 81.45% [75.80%, 86.02%] | 7 / 0 | not audited | 4.07% [-0.46%, 8.68%] | 19 / 10 | 0.13604595 | pending | TIE |
| gpt-6-luna | 188/221, 85.07% [79.77%, 89.17%] | 181/221, 81.90% [76.29%, 86.42%] | 0 / 0 | not audited | 3.17% [-1.80%, 8.11%] | 19 / 12 | 0.28104152 | pending | TIE |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | not reported | not reported | not reported | not reported | not reported | not reported | not reported | not reported |
| gemini-3.5-flash-lite | 158/221, 71.49% [65.21%, 77.04%] | 142/221, 64.25% [57.74%, 70.28%] | 5 / 0 | not audited | 7.24% [0.00%, 14.16%] | 42 / 26 | 0.068118674 | pending | TIE |
| claude-sonnet-5-5 | 199/221, 90.05% [85.39%, 93.33%] | 167/221, 75.57% [69.50%, 80.76%] | 0 / 0 | 0 / 28 | 14.48% [9.13%, 19.91%] | 37 / 5 | 4.4337048e-07 | pending | PENDING_HOLM |
| gpt-6.1-sol | 196/221, 88.69% [83.83%, 92.22%] | 193/221, 87.33% [82.30%, 91.09%] | 0 / 0 | 0 / 0 | 1.36% [-2.26%, 5.00%] | 10 / 7 | 0.62905884 | pending | TIE |

The original three models belong to the prespecified 18-cell family. Flash Lite, Sonnet and Sol are additional cells. Multiplicity adjustment remains pending with the collator. No overall superiority claim is made.
Per-item strict decisions: results/<model>.strict.json. Original product-final decisions: results/<model>.json.
Exact intervals, balanced accuracy, valid-verdict coverage and paired differences: evidence/cells.json.

## Output-limit error attribution

| Model | Contestant | TEST limit answers | TEST affected items | All-phase limit answers | All-phase affected items |
|---|---|---|---|---|---|
| haiku | driftbench-verify-uncertainty-cascade | 7 | 4 | 21 | 12 |
| haiku | promptfoo | 0 | 0 | 0 | 0 |
| gpt-6-luna | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| gpt-6-luna | promptfoo | 0 | 0 | 0 | 0 |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | not reported | not reported | not reported | not reported |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | not reported | not reported | not reported | not reported |
| gemini-3.5-flash-lite | driftbench-verify-uncertainty-cascade | 5 | 5 | 5 | 5 |
| gemini-3.5-flash-lite | promptfoo | 0 | 0 | 2 | 2 |
| claude-sonnet-5-5 | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| claude-sonnet-5-5 | promptfoo | 0 | 0 | 0 | 0 |
| gpt-6.1-sol | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| gpt-6.1-sol | promptfoo | 0 | 0 | 0 | 0 |

Unclassified historical native errors: 2. Unmapped confirmed limits: 0.
Counts refer to observed completion envelopes. Native internal attempts are not inferred from aggregate turn counts.
Receipt ids, exact reasons and request-to-item attribution: evidence/output-limit-errors.json. The strict rule is frozen in evidence/scoring-freeze.json.

## Cost, cheaters and validation

| Model | TEST cost per 100: cascade / promptfoo | Mutation preserve, flip, injection changes: cascade / promptfoo | Noise items with any change: cascade / promptfoo |
|---|---|---|---|
| haiku | 1.139292 / 0.187925 | 12/12, 12/12, 0 / 12/12, 12/12, 0 | 2/30 / 10/30 |
| gpt-6-luna | 0.414580 / 0.067791 | 12/12, 12/12, 0 / 12/12, 12/12, 0 | 4/30 / 9/30 |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | not reported | not reported |
| gemini-3.5-flash-lite | 2.047560 / 0.349120 | 12/12, 12/12, 0 / 12/12, 12/12, 0 | 10/30 / 10/30 |
| claude-sonnet-5-5 | 7.104357 / 1.917252 | 12/12, 12/12, 0 / 12/12, 12/12, 0 | 1/30 / 5/30 |
| gpt-6.1-sol | 3.796091 / 1.030822 | 12/12, 12/12, 0 / 12/12, 12/12, 0 | 2/30 / 1/30 |

Constant pass / fail: official 21.27% / 78.73%; audited 23.53% / 76.47%.
Mutation checks cover planted arithmetic truth only. Thresholds: preserve at least 95%, flip at least 90%, no injection changes or missing verdicts.
Noise uses 30 DEV items in three separate recording namespaces. A transition to or from a missing verdict counts as a change; missing counts are also reported in evidence/cells.json.
Cost per 100 uses unique prompt keys; actual provider fees include any duplicate paid calls. Replayed logical-call costs are separate.
Original three-model budget, settled fees: 12.691818 USD. Unresolved-charge maximum: 19.500000 USD. Total accounted maximum: 32.191818 USD, cap 40 USD.
Fee sources: receipts/budget.json and receipts/calls.jsonl. Historical replay cost is excluded from new spend.

## Phase coverage

| Model | Pilot | Mutation fixtures | Noise 0 | Noise 1 | Noise 2 | TEST |
|---|---|---|---|---|---|---|
| haiku | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 221 items; missing 0/0 |
| gpt-6-luna | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 2/2 | 30 items; missing 0/0 | 30 items; missing 0/0 | 221 items; missing 0/0 |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | not reported | not reported | not reported | not reported | not reported |
| gemini-3.5-flash-lite | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/1 | 30 items; missing 0/0 | 30 items; missing 0/1 | 221 items; missing 5/0 |
| claude-sonnet-5-5 | 20 items; missing 0/4 | 48 items; missing 0/0 | 30 items; missing 0/8 | 30 items; missing 0/8 | 30 items; missing 0/6 | 221 items; missing 0/28 |
| gpt-6.1-sol | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 221 items; missing 0/0 |

## Freeze and recovery

- Source and evidence hashes are in the immutable evidence/seal.json. The live upstream directory has no alternative verification item pool.
- All 316 upstream ids occur in prior recordings across 68 inspected files. The 221-item fallback has explicit owner approval.
- Original pilot runtime b4e4305a2426e0bb7589 is preserved. The plugin crash leaves five unknown-charge reservations totaling 3 USD.
- Subsequent 180-second API timeouts and a 240-second Haiku timeout are preserved in pilot partial reports and error receipts.
- The owner authorizes one resume of missing transport outputs for all models at 300 seconds. Returned answers are never retried.
- Current admission: two calls and one model cell at a time, after ten healthy provider probes spaced 30 seconds apart. Gemini 3.8 is dropped by the owner; no resumption is authorized.
- Both API models use medium. Haiku uses claude-haiku-5-5 through local Claude processes.
- The outer process envelope includes queueing and quota backoff. Execution-only changes are recorded in evidence/execution-amendment.json.
- HTTP 429 receives waits of 60, 120 and 240 seconds. Exhausted quota remains pending transport, never a judge failure.
- Historical Gemini billing rejections release only proven rejection holds; unknown network-error holds remain. The owner drop authorizes no further Gemini 3.8 calls.
- The owner raises the cap to 40 USD and requires all 379 evaluation units per model: 20 pilot, 48 mutation, 90 noise and 221 TEST.
- The previous operational cutoff is removed under that full-coverage instruction before TEST.
- Native error bodies and known fees are retained. Two exhausted Haiku pilot outputs are terminal and never retried.
- A mock PATH-resolution error incurs a conservative 0.50 USD unknown-charge hold; evidence/native-test-resolution.json records it.
- Cascade prompts, parsers, pool and audit labels remain unchanged. Keys load inside provider commands from the two authorized paths.
- Dependencies are linked. No node_modules tree is copied.

| Artifact | SHA-256 |
|---|---|
| evidence/seal.json | 54fc167420330d25eb2d8874a0784bd9aa4ec4ff06fbcae82ffaa26d5fc42155 |
| evidence/runtime-freeze.json | 311e929b3a62fb352d0f1c3bb11d82046dbb65fb71d73c0b6034633d5256df9b |
| evidence/pilot-runtime-freeze.json | b374d2982c6d3673c07c1f72dd4ebf96cf068981ee4e416d4a1a3311cfc3c6df |
| evidence/scoring-freeze.json | e1c0ce28e0dc259b6fe3e3bf98e16e7e0bc20c05e621d09522f43576752fe40b |
| evidence/pool.json | f569c72a5e701366d232b619a623c09abddcf69cfc4379e849dbdef76b9559c5 |
| evidence/audit-map.json | 3de476f85d4ce54ed88260f62d4ccab8c0fad36cddf50c1e74e2035055541eb6 |
| stats.py | 53aa9de5e9c869e3dce17e597ba8fa7efe0a022861b99f7fd60f48d6ad3ad3ac |
| validate.py | 2b9cf4a86344562f4f4b71363a695c14893b4550f1611682e11cdf5686ce4040 |
| run.ts | 4dba10340b086fa8ffdecf55dde7bae9a75d1d535cb4233dfb468040f0d24767 |
| transport.ts | 3413c705c04c290db8395d5943f2da8ba48f458e33be5d6bf15f5264151f8f11 |
| summarize.py | 1cd18ffa8da398404528c3ffd71c351c6f67248e67b2110cd612789168dcf840 |
| output_limits.py | e497c931f8a4f395cd5edb9d3bf7ec8250b334d358d758d605cb3a23dfa2d8c6 |
| trace-requests.ts | 72e5253798d6d3b23f7a866a51b450027b23ce71fe240d775b3709d5318dd33e |
| evidence/luna-cache-write-reconciliation.json | 291ea2f6a0126761eafe9aee792cbe48d407786b60320d150a2e90c88868dd54 |
| evidence/gemini-daily-quota-amendment.json | 1226a20b7e5bf5b75fadd1b6d860a25a9e812dee78538274715096895c9ab4b5 |
| evidence/haiku-outage-amendment.json | 20190c7cbf55d5113dd6b4f8e37b2bc3d6a764149d16fc9ce4e4b59efeb3fad3 |
| evidence/haiku-test-timeouts.json | da9f02b5562ad5aa09048562e5d920d62a3de85e4c5e3930838ffeec81efbbd5 |
| evidence/haiku-test-timeout-execution.json | a399e1aa675066a72e09b7a5fa2e51cb89b4ce0d8e5e326f8054fa02552e8af0 |
| evidence/haiku-test-timeout-recovery.json | 7f22056663799f1ce8b08b189755cda4cc27b9349ab4d64ba5e43c8609add39e |
| evidence/haiku-pacing-amendment.json | 46a8cc63637457087d462450eb58a546acc37f3d7869a8767bae1de3bc4bb021 |
| lite/evidence/model-amendment.json | 4bcef88bdae8f5360dbf32f280ab2e5efe71fe232dd83fcd7f7ca9d302d1aada |
| lite/evidence/cap12-amendment.json | 01926ea2d6a7f60a3b43eeeb9e0531c69c9da31d4e929efa35b20fc765087aba |
| lite/evidence/cap24-amendment.json | ce286b01a6764a62f673908f764129e734e0589db6991ac9f2e57c2346f06c1d |
| lite/evidence/runtime-freeze.json | 08906b013779654df1a2c4c91f5e130624f53af96a15244690ae04e891861d52 |
| lite/evidence/reporting-freeze.json | 96780529ca41e14920a300ab4ff0e25719d4632d1d5ce72054c535f33c00c3df |
| lite/evidence/reasoning-applied.json | b5a42a0768a6654c36fc5bda03a8693f35f04380a33e9a0ad1945aeb8da77e1b |
| lite/evidence/network-recovery-amendment.json | 95ae64c82cc70adcce1f1af4156a739fb59cb10a8495b4ffe156eea4892f8fc7 |
| lite/evidence/network-recovery-execution.json | 5010d23075bfc5d30a4ff26d7b4daf335660f042982b1e799c55dc99f61424d3 |
| lite/evidence/replay-reconstruction-amendment.json | 75e9f0c64d13cce8c98044918196dc98215e0b622f929ea846059aab095e5323 |
| lite/evidence/network-diagnostics-amendment.json | 325fdb30854366b2d5b1604ed33da119f3b9f89825489f7ac39fc6fb5b924f82 |
| lite/evidence/first-final-preservation.json | a5ea8cb42a2ffad7a23cb18c5d6deb69f0870b6f19c8cc5a085ff490e1beb8fb |
| lite/evidence/first-final-replay-amendment.json | 2f1bb9bb25210d96daf9e963dba935f31189d5ee588332ec2c2fb70963adfdfd |
| lite/evidence/test-recovery-amendment.json | 9e4d377f92d1161f66032c41eef1d5a4c14f579d74dd047b497c50fe4abe5fc9 |
| lite/evidence/test-network-hold-release.json | b74985e2eaf5c16f86127bf93aa2a7d10f0605cd9e10a3dd25969f46d7e05121 |
| luna-addendum/freeze-amendment.json | ba6326cda2477baeb91313e3fc9203c12229d098858ddf3f62cfddd052f9f4a7 |
| luna-addendum/execution-freeze.json | fbb26af0818a7eb7a04cb23b82d445bdfcb1524d0875017abe112a1feedcc731 |
| luna-addendum/state.json | 177b969dc60871940694aadb42f1398d6458ef92d3f67919c805f34a3bfd1674 |
| luna-addendum/metrics.json | 7004cb786c920dc5b97783d2032ad4732eab3168dbe009497c4c231df9f4757e |
| sonnet/evidence/model-amendment.json | e6c38c50745390765771743e68895e72939b34373b6e9f10c685f039cb4fa2a3 |
| sonnet/evidence/runtime-freeze.json | 5873372b33087d30d26912d469fe00754bcd6a24db147e810c27b5ddcfc5ae98 |
| sonnet/evidence/reporting-freeze.json | cfdfcfe6b7c8c5c34dcaa601353400bc7477fc49e893c98c971ba25e98fd99e0 |
| sonnet/evidence/cost-sample.json | 1c416e1bfd884e17f5f6d6ec024ed1ce6f44417d3b0798b33a8f63d72faba26d |
| sonnet/evidence/cache-off-amendment.json | d4f4d057bd41d197b8d69189358882b09d3594f81e6aae0ce8f74a7e4b49b01a |
| sonnet/evidence/cache-off-cost-selection.json | cb4dfb0b06dd180ffa0941973fb2e4ff8a9f017e1d6b82b160a2edda5cafe246 |
| sol61/evidence/model-amendment.json | 077afcd083fd61267bcc75bb602121139febdc63ac436acd686f899707cba014 |
| sol61/evidence/runtime-freeze.json | b7814a8d9c6b8d5bdc3b36ab2d392ef7a1bda3bed8e5e3968cab281b631f5b1d |
| sol61/evidence/reporting-freeze.json | 54bf9d3ace868ee8bf61e6ea537972a904d56358ee2222b43779ba29383a5fbc |
| sonnet/evidence/cache-off-cost-sample.json | b415b3b1cecef4c287a680d040d331065ad5900924c6f4e8cdb01a90852aaa6b |
| sonnet/evidence/cap45-activation.json | 43ae0799d38d9636df3f14e756c5c5bd101eef343a8cf1485241ce0bd7448972 |
| sonnet/evidence/pilot-projection.json | 48c93091a29e9792a6afc333ce873ba6c1706d5148d301bcafecb4e1d1084f97 |
| sonnet/evidence/refusal-amendment.json | 7432335a98f04f292669f839b1cde9aef8fd15089aad0c2abb6db258a1c801bd |
| sol61/evidence/refusal-amendment.json | 4323b755e03696576411ea302f32b1c9547c876f25811c5a5a77f730451f3d19 |
| sonnet/evidence/native-quota-amendment.json | 30cf6f4a7134a668173530a916d92394f5895309f8a56490afe80bd11a2c4760 |
| sonnet/evidence/native-quota-recovery.json | 597f79da24cf9c1109aecdd728e896ccdb282385a9db4b5ae1ef41bd52dbb1d1 |
| sol61/evidence/cost-sample.json | 4261ce779d264fa621267616cc8b02621fcf3deeaa0ff75650532b5eadb79d8e |
| sol61/evidence/native-quota-amendment.json | becfc7b55e75de155c3328cdfc2023babed4e5cd57219a052075beee43af2d41 |
| sonnet/evidence/native-quota-continuation.json | a0414832086482f1411f457a9721ec121555a43bf60d09a02015913013058260 |
| sol61/evidence/cap40-amendment.json | e2b20a24a09cefd97c940022546eba6e0878246dceb36c195fc87674a53f7484 |
| sonnet/evidence/native-quota-recovery-state.json | 0c857c53e3463c4687ff92a581f232ad3a0740299d58f56149d6859b30ca26fb |
| sonnet/evidence/native-quota-continuation-state.json | 128fa4600e9db10382ae312ce9e874e5467d6c4effa6c5eef3e7268c7f4d8321 |
| evidence/closed-output-limit-audit.json | 43af6ef30137e3deb770715e9c3789b40d443f281fc094f841463292c055d8ce |
| evidence/gemini-owner-drop.json | bb5ffda38ecfd49b1da0e59930e1ca67e84e19a38bb596a918067beb862e8959 |
| sol61/evidence/pilot-projection.json | 11e8e597a3ffb538fc39b8c24e6d42361e6c9ccfc32764fd7c0569b02985f146 |

Active runtime id: d49a333a9d4e6dd0ffd6. Frozen core: 35f07309a4d1d1c8a7c5b176ff19e537d0ef8fdd.
Offline checks cover source/pool hashes, exact schemas, strict replay, fail-closed missing replay and restricted Python execution.
Unit checks cover statistics, strict output-limit scoring, missing outcomes, fee capture, budget reservations, concurrency and quota backoff. Historical replay reproduces 102 verdicts with zero new model calls.
Sources: evidence/offline-checks.json, evidence/frozen-replay.json, test_stats.py, test_budget.py.

## Execution recovery and validity disclosure

- The owner confirms the Gemini top-up. One missing request probe returns an answer for 0.00151125 USD, then missing-only recovery continues at two calls.
- The probe answer is reused without another paid call. Original reports and cassettes are archived; returned answers remain cached.
- Five network no-answer entries and twenty proven billing rejections are eligible for recovery. Unknown network-charge holds remain.
- Gemini recovery keeps medium reasoning, 300-second attempts, quota waits of 60/120/240 seconds and the HTTP 402 circuit break.
- Recovery evidence: evidence/gemini-topup-resume.json and evidence/gemini-topup-recovery-check.json.
- The predeclared ten-point cheater margin is not established. On the same twenty DEV pilot items, constant-fail scores 18/20.
- Product-final cascade scores are Haiku 18/20, Luna 17/20 and Gemini 18/20. These do not clear that pilot baseline by ten points.
- The full 95-item DEV cheater gate is not freshly measured. The validityPassed field in cells.json covers planted mutation checks only.
- This documentation audit occurs after TEST starts. TEST predictions, endpoints and statistical code remain unchanged; no blanket validity or confirmatory superiority claim follows.
- Cheater disclosure source: evidence/cheater-gate-audit.json.

## Luna cache-write fee reconciliation

- The native usage records 1752698 cache-write tokens. Published pricing adds 0.04381745 USD to the original recorded fee calculation.
- One fee-only ledger row accounts for the difference inside the original 40 USD cap. All original receipts and model answers remain unchanged; no provider call is made.
- Historical unique-key cost-per-100 metrics retain the frozen calculation. The reconciled settled fee total includes this separate premium.
- Sources: evidence/luna-cache-write-reconciliation.json and https://developers.openai.com/api/docs/pricing.

## Haiku host-outage runtime amendment

- The owner identifies a host DNS outage near 11:28 to 11:33 UTC and authorizes one retry of four ENOTFOUND calls and one 300-second timeout.
- Only those five fingerprints are eligible. Atomic claims prevent another paid retry; original errors and all returned answers remain archived.
- The unknown timeout hold remains reserved. These five retries use the then-current Haiku concurrency two, 300-second attempts and the 40 USD cap.
- Sources: evidence/haiku-outage-amendment.json, evidence/haiku-outage-recovery.json and noise-2/haiku.pre-outage-recovery.partial.json.

## Haiku adaptive pacing runtime amendment

- The owner raises Haiku to four workers. Admission falls to two only when one-minute host load exceeds 60 or two no-answer transport failures occur within 600 seconds.
- Parse errors and output-limit completions do not lower pacing. Already-started calls finish normally; admission checks refresh within five seconds.
- The transition archives the partial TEST report and preserves all 33 returned responses. Only missing requests resume.
- Eight offline pacing and budget checks pass. The sealed order, cap, model contract and statistical scoring stay unchanged.
- Sources: evidence/haiku-pacing-amendment.json, receipts/budget.json, test_pacing.py and test_budget.py.

## Haiku TEST timeout recovery

- The network amendment replaces the earlier retry ceiling. Zero-token, no-output transport requests recover missing-only without an attempt limit; answers are never resubmitted.
- Ten healthy provider probes spaced 30 seconds apart precede recovery of 6 missing requests, at two calls and one model cell at a time. Original holds total 3.0 USD and remain reserved.
- Recovery preserves 440 answered finals and replaces only 2 transport-missing finals. Initial reports and cassettes remain archived; intermediate recoveries remain supplemental.
- The recovery settles 0.09871296 USD. Returned answers, including output-limit errors, are never resubmitted.
- Sources: evidence/haiku-test-timeouts.json, evidence/haiku-test-timeout-execution.json and evidence/haiku-test-timeout-recovery.json.

## Historical daily quota amendment, superseded by owner drop

- The earlier daily-quota completion permission is superseded by the owner drop. Partial receipts, recordings and fees remain retained.
- Two proven quota holds settle at zero. Returned answers stay cached; unknown-charge holds remain.
- Source and runtime amendment hash: evidence/gemini-daily-quota-amendment.json. Medium, 300-second attempts, two Gemini calls and the 40 USD cap remain unchanged.

## Separate Flash Lite cell

- Owner adds gemini-3.5-flash-lite, then raises its separate cap from 6 USD to 12 USD, 18 USD, then 24 USD with unknown-charge holds retained. Original model budgets and answers remain separate.
- Medium reasoning is accepted and applied to both contestants. Provider attempts have a 300-second timeout, initially eight workers and four for the TEST continuation, 429 waits of 20/60/180 seconds and an immediate HTTP 402 admission stop.
- Published Standard price is 0.30 USD per million input tokens and 2.50 USD per million output tokens, including thinking. Source: https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite. Medium support: https://ai.google.dev/gemini-api/docs/thinking. Read 13 October 2026.
- The 20-item pilot costs 0.5183653 USD. Its linear projection is 9.823022435 USD across 379 units; actual fees below supersede that estimate.
- Flash Lite actual settled fees: 8.62269050 USD. Unknown-charge holds: 10.80000000 USD. Accounted maximum: 19.42269050 USD, cap 24 USD.
- Host overload recovery keeps all 35 original uncertain-charge holds (10.50 USD). All 35 missing requests return on one additional submission each, costing 0.1725274 USD. Connectivity probes pass first.
- Upstream recovery creates new downstream keys for six already completed noise items. Their first product-final verdicts stay primary; all continuation answers and charges remain archived. Two continuation verdicts differ and are excluded symmetrically by the first-answer rule. Offline replay reproduces the selected original chains.
- A second TEST network wave has 24 fetch-stage connect timeouts and one interrupted HTTP-200 response. The owner authorizes release of 7.20 USD in proven pre-connection holds and missing-only recovery of all 25. The HTTP-200 hold and earlier 35 holds stay reserved.
- TEST continuation preserves all 117 completed item outcomes, including five parse failures, before asking any remaining question. Original partial reports, exact answers, unused recovery answers and fees stay in the evidence.
- Flash Lite files live under lite/: receipts, recordings, per-item strict and product-final decisions, request attribution, validation and exact replay evidence. The shared pool and audit map are symbolic links to the identical sealed originals.
- Scoring algorithms match the original frozen functions exactly. lite/evidence/reporting-freeze.json records syntax hashes before TEST. The TEST contains 221 items per contestant; all six phases total 379 units.
- The additional cell does not establish the unmeasured full DEV cheater margin and does not alter the original multiplicity family silently.

## Luna noise addendum: official result preserved

- The closed Luna cell remains official. Its 221-item TEST reports and recordings match every pre-recovery hash. No TEST call is repeated.
- The owner authorizes recovery of six noise-0 no-answer requests after Haiku. All six return once, at medium, 300-second timeouts and concurrency two after the provider health gate.
- Four recovered final requests fill the separate addendum. Its 56 earlier answered finals stay unchanged. Two intermediate responses remain supplemental; downstream final requests keep their original frozen inputs.
- Official noise flips include missing values under the frozen calculation. Recovered-item rows apply that identical rule. Strict remains the headline.

| Model and result | Score variant | Our items with noise flips / 30 | promptfoo items with noise flips / 30 | Items with any missing, ours / peer | New output-limit answers, ours / peer |
|---|---|---|---|---|---|
| gpt-6-luna official | strict and product-final | 4/30 | 9/30 | 2 / 2 | 0 / 0 |
| gpt-6-luna with recovered items | strict | 2/30 | 8/30 | 0 / 0 | 0 / 0 |
| gpt-6-luna with recovered items | product-final | 2/30 | 8/30 | 0 / 0 | 0 / 0 |

| Addendum contestant | Settled recovery cost USD | Requests |
|---|---|---|
| driftbench-verify-uncertainty-cascade | 0.00320077 | 4 |
| promptfoo | 0.00136698 | 2 |

- Addendum settled cost: 0.00456775 USD inside the original 40 USD cap. Existing unknown-charge holds remain. Cache-write fees use the published 0.125 USD per million tokens.
- Sources: luna-addendum/freeze-amendment.json, execution-freeze.json, state.json, metrics.json and noise-0.with-recovered-items.json. The addendum never replaces the official cell table.

## Labelled closed-cell output-limit audit correction

- The accepted audit correction changes Haiku strict accuracy to 163/221 versus 159/221 on official labels, and 184/221 versus 180/221 on audited labels.
- Exact paired p is 0.6075913612730801 for both label sets. The result remains TIE. Closed result files and their original rows remain unchanged.
- Native receipt 81cd575a-8bb0-46f7-abca-b399594ea621 reports stop_reason=max_tokens despite subtype=success and empty text: 16387 output tokens, including 16384 thinking tokens.
- That additional limit belongs to our cascade. Strict loses one correct item. Product-final remains 168/221 versus 159/221 officially, and 189/221 versus 180/221 under audited labels.
- The identical detector audits both contestants on all three closed cells. No further score changes occur. Luna recovery receipts are included; its closed TEST remains unchanged.
- The new detector is frozen at 17:42:49 UTC on 13 October, before Sonnet TEST starts at 17:47:11 UTC and before Sol TEST. No model request is made for this audit.
- Haiku native bodies and API finish metadata are inspected. Two historical Haiku error bodies remain unavailable; API raw bodies were not retained. No missing evidence is inferred as an output limit.

| Model | Contestant | TEST limit answers | TEST affected items | All-phase limit answers | All-phase affected items | New limit answers |
|---|---|---|---|---|---|---|
| haiku | driftbench-verify-uncertainty-cascade | 8 | 5 | 22 | 13 | 1 |
| haiku | promptfoo | 0 | 0 | 0 | 0 | 0 |
| gpt-6-luna | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 | 0 |
| gpt-6-luna | promptfoo | 0 | 0 | 0 | 0 | 0 |
| gemini-3.5-flash-lite | driftbench-verify-uncertainty-cascade | 5 | 5 | 5 | 5 | 0 |
| gemini-3.5-flash-lite | promptfoo | 0 | 0 | 2 | 2 | 0 |

Evidence and unchanged-file hashes: evidence/closed-output-limit-audit.json. The original scores remain in evidence/cells.json cells; the separate correction is linked by closedOutputLimitAudit.

## Additional Sonnet and Sol cells

- Separate model cells use the same sealed 221 items, unchanged audit map, frozen contestants, 20-item pilot, 48 mutations and 30-by-3 noise checks.
- Sol has an owner-authorized 40 USD cap including holds. Sonnet has an owner-authorized 45 USD cap only if its five cache-disabled DEV calls project at most 45 USD, including calibration fees and holds.
- Sonnet preserves its first five cached answers and their 57.413792 USD projection. Five next unanswered DEV requests remeasure cost with DISABLE_PROMPT_CACHING=1 for both contestants.
- Both contestants use medium reasoning. Sonnet uses alias sonnet in the lean empty-directory CLI route; Sol uses the Responses API without temperature.
- Sonnet caps total output including thinking at 16384 tokens. Sol caps total output including reasoning at 32768 tokens. Output-limit items remain errors under the strict headline.
- Sol Standard published prices per million tokens: input 2 USD, cached input 0.10 USD, cache write 2.50 USD, output 10 USD. Source: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), read 13 October 2026.
- Sonnet costs come from native total_cost_usd. Sol costs come from recorded usage and its published price. Raw usage envelopes are retained.
- Every returned answer remains cached. Transport failures keep uncertain-charge holds. No model or setting is tuned on sealed data.
- These additional cells remain outside the original 18-cell multiplicity family until the collator declares the combined adjustment.

| Model | Status | Five-call cost USD | Projected 379-unit cost USD | Settled USD | Reserved or unknown holds USD | Evidence folder |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | offline evidence ready for review | 0.06976800 | 29.08003000 | 34.11367200 | 0.50000000 | sonnet/ |
| gpt-6.1-sol | offline evidence ready for review | 0.06966100 | 36.19988950 | 16.55230050 | 1.37494750 | sol61/ |

claude-sonnet-5-5 cost projection breakdown:

| Contestant | Stage | Reference requests | Measured unit USD | Projected USD |
|---|---|---|---|---|
| driftbench-verify-uncertainty-cascade | blind-algebra | 340 | 0.01575000 | 5.35500000 |
| driftbench-verify-uncertainty-cascade | blind-direct-program | 340 | 0.01558400 | 5.29856000 |
| driftbench-verify-uncertainty-cascade | final-step | 102 | 0.01575000 | 1.60650000 |
| driftbench-verify-uncertainty-cascade | program | 352 | 0.01575000 | 5.54400000 |
| driftbench-verify-uncertainty-cascade | quoted-extract | 114 | 0.01575000 | 1.79550000 |
| driftbench-verify-uncertainty-cascade | single | 359 | 0.01215000 | 4.36185000 |
| driftbench-verify-uncertainty-cascade | single-review | 5 | 0.01575000 | 0.07875000 |
| promptfoo | single | 368 | 0.01314200 | 4.83625600 |

Five-call measured cost by contestant: cascade 0.04348400 USD; promptfoo 0.02628400 USD.
Additional conservative allowance: all calibration fees 0.20361400 USD plus holds 0.00000000 USD. Cache writes observed in the five new calls: 0 tokens.
Projection uses the original full Luna request counts, with the highest sampled cascade fee assigned to unsampled stages. It is an estimate, not a measured full-cell cost.

Completed 20-item pilot projection for claude-sonnet-5-5: 42.47418890 USD. Calibration fees and holds remain in the hard-cap ledger.

Native session quota initially left 159 exact requests unanswered at zero recorded fee. All 159 requests recover after the reset probe and provider health gate. No terminal answer is submitted again. Original final prompts retain their earlier inputs; supplemental intermediate answers remain archived.

gpt-6.1-sol cost projection breakdown:

| Contestant | Stage | Reference requests | Measured unit USD | Projected USD |
|---|---|---|---|---|
| driftbench-verify-uncertainty-cascade | blind-algebra | 340 | 0.02746600 | 9.33844000 |
| driftbench-verify-uncertainty-cascade | blind-direct-program | 340 | 0.02746600 | 9.33844000 |
| driftbench-verify-uncertainty-cascade | final-step | 102 | 0.02746600 | 2.80153200 |
| driftbench-verify-uncertainty-cascade | program | 352 | 0.01499200 | 5.27718400 |
| driftbench-verify-uncertainty-cascade | quoted-extract | 114 | 0.02746600 | 3.13112400 |
| driftbench-verify-uncertainty-cascade | single | 359 | 0.00668850 | 2.40117150 |
| driftbench-verify-uncertainty-cascade | single-review | 5 | 0.02746600 | 0.13733000 |
| promptfoo | single | 368 | 0.01025725 | 3.77466800 |

Five-call measured cost by contestant: cascade 0.04914650 USD; promptfoo 0.02051450 USD.
Projection uses the original full Luna request counts, with the highest sampled cascade fee assigned to unsampled stages. It is an estimate, not a measured full-cell cost.

Completed 20-item pilot projection for gpt-6.1-sol: 21.90878667 USD. Calibration fees and holds remain in the hard-cap ledger.

The 2026-10-14T00:23:33.599375+00:00 network-pause record contains 2 TEST transport timeouts without answers. Their 0.68775250 USD uncertain-charge holds remain. The standing rule requires the cooldown and ten healthy probes before missing-only recovery at two calls. No returned answer is eligible for resubmission. Source: sol61/evidence/overnight-network-pause.json.

Both overnight transport-missing requests recover after the health gate, for 0.01701200 USD. All 1481 earlier answered receipt records remain byte-for-byte unchanged. The original timeout holds remain reserved. Source: sol61/evidence/overnight-network-recovery.json.


| Model | Contestant | Constant-fail official / audited | TEST unique-key cost USD | All-phase attributed settled USD | TEST strict missing / product-final missing | TEST output-limit answers | TEST refusal responses | TEST refused items |
|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | driftbench-verify-uncertainty-cascade | 174/221 / 169/221 | 15.70062800 | 27.15393800 | 0 / 0 | 0 | 0 | 0 |
| claude-sonnet-5-5 | promptfoo | 174/221 / 169/221 | 4.23712800 | 6.95973400 | 28 / 28 | 0 | 28 | 28 |

claude-sonnet-5-5: unattributed settled cost 0.00000000 USD. Exact tokens and receipt attribution: evidence/cells.json newModelCostAttribution.

| gpt-6.1-sol | driftbench-verify-uncertainty-cascade | 174/221 / 169/221 | 8.38936050 | 13.55843590 | 0 / 0 | 0 | 0 | 0 |
| gpt-6.1-sol | promptfoo | 174/221 / 169/221 | 2.27811600 | 2.99386460 | 0 / 0 | 0 | 0 | 0 |

gpt-6.1-sol: unattributed settled cost 0.00000000 USD. Exact tokens and receipt attribution: evidence/cells.json newModelCostAttribution.


Native-refusal rule fixed after the Sonnet pilot and before TEST. No pilot verdict changed. Original product verdicts remain unchanged. A native refusal is terminal at any token count and is never recovered as a transport no-answer. Strict scoring counts every consuming contestant/item as an error; product-final retains the frozen product fallback. The rule applies identically to both contestants.

| Model | Contestant | TEST refusal responses | TEST refused items | All-phase refusal responses | All-phase refused items |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| claude-sonnet-5-5 | promptfoo | 28 | 28 | 54 | 54 |
| gpt-6.1-sol | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| gpt-6.1-sol | promptfoo | 0 | 0 | 0 | 0 |

Sources per model folder: evidence/model-amendment.json, evidence/cost-sample.json, evidence/cells.json, evidence/output-limit-errors.json and receipts/native/.
Scores, paired exact p values and strict/product-final endpoints appear in the tables above for every completed cell. Pending cells have no sealed TEST score.
