# LongJudge verify confirmation

Historical dossier. Gemini 3.8 Flash was dropped by the owner; its recorded data stays archived. All Gemini resume permissions and process descriptions below are superseded; no pending or parked continuation remains.

Historical status: recovering interrupted DEV pilots. Core PR 168 at 35f07309 is imported; successful answers remain cached.

- Worktree: `<repo>/.worktrees/ledger-verify`.
- Branch: `research/ledger-verify`, created from `origin/main` at `9970c938de76bbb3030795d983fad08d8bb611b6`.
- Cascade: `driftbench-verify-uncertainty-cascade`, freeze `558d75de017ecbf243852f5669a1bffeb8d511b9`, source head `f13242f29ad0ced947907a84ffbb19abaa32f190`.
- The user confirms the core is resumed. Its latest dossier supersedes the earlier paused status.
- Historical authorization, superseded for Gemini 3.8 by the owner drop: Gemini used the newly billable key. All three models share the 25 USD cap. Current receipts are in examples/ledger-verify/receipts/budget.json.

## Pool and exposure

- The live `data_standardized` listing contains only `verify_bench_hard.jsonl` and its reference file for verification.
- The reference file is not an independent item pool.
- All 316 source ids occur in prior recordings. The scan covers 68 files and finds no malformed JSON rows.
- All 221 TEST items are sealed, with no outcome-based filtering. This is a **previously evaluated split**, not an unseen holdout.
- The 23 TEST audit corrections remain unchanged. Official labels are primary; audited labels are a separate sensitivity analysis.

Sources: `examples/ledger-verify/evidence/upstream-listing.json`, `recording-inventory.json`, `seal.json`, and `upstream-test-label-audit.json`.
Upstream directory: https://github.com/cjj826/LongJudgeBench/tree/main/data_standardized

## Cell table

| Model | Official cascade / promptfoo | Audited cascade / promptfoo | Exact p / Holm p | Cost per 100 | State |
|---|---|---|---|---|---|
| Haiku | pending / pending | pending / pending | pending / pending | pending | DEV pilot running |
| gpt-6-luna | pending / pending | pending / pending | pending / pending | pending | DEV pilot running |
| gemini-3.8-flash | Not reported | Not reported | Not reported | Not reported | dropped by the owner |

No new benchmark score or win is claimed. Machine-readable cells: `examples/ledger-verify/evidence/cells.json`.
Holm waits for the complete prespecified 18-cell family. Missing and unparsed verdicts count as wrong, with coverage reported separately.
Wilson intervals cover single rates; seeded request-cluster bootstrap covers the paired difference.
Constant-label baselines are in `cells.json`. Fresh noise-floor measurements are pending.

## Freeze hashes

| Artifact | SHA-256 |
|---|---|
| pool.json | f569c72a5e701366d232b619a623c09abddcf69cfc4379e849dbdef76b9559c5 |
| normalized original population | dd608c4e8c79051fae172fbd5a272889f927bec4b364a3d2d15c8e847906f2e3 |
| audit-map.json | 3de476f85d4ce54ed88260f62d4ccab8c0fad36cddf50c1e74e2035055541eb6 |
| unchanged full TEST audit | bb292c36cb01d843bb7af52c4654045dac9ae3eed2c8e64181f007d613d78efb |
| source manifest seal.json | 54fc167420330d25eb2d8874a0784bd9aa4ec4ff06fbcae82ffaa26d5fc42155 |
| statistics script | 5e706db53543f6ef6c5ea440d31dc438072167b27940dee0a0f707c1ba402d11 |

The seal contains every imported source hash. All match the original freeze.
A separate runtime freeze will bind core commit, transport, reasoning, prices, cutoff and runner before paid calls.

## Offline verification

- Frozen source and pool hashes match. The cascade route and extraction checks pass.
- Strict replay succeeds. An unrecorded input fails closed without a provider command.
- Restricted Python executes on this host and returns the expected fixture value.
- All 102 historical verdicts match on replay. Required replies: 471. New model calls: 0.
- Replayed original execution cost: 1.01574277 USD, not new spend. Four statistical unit tests pass.

Sources: `evidence/offline-checks.json`, `evidence/frozen-replay.json`, and `test_stats.py`.
Publication guard reports 34 scanned files, zero findings and zero scan errors; two ignored entries are skipped. No private denylist is configured.
Keys load only inside each provider command and are never printed. Dependencies are symlinked to existing installations; no node_modules copy occurs.

## Next work

- Read the pushed core PR and bind the schema-independent transport.
- Add and verify atomic in-flight cost reservations before enabling paid calls.
- Freeze settings and cutoff, then measure the DEV cost pilot without tuning.
- Run both authorized models, retain every receipt and publish official and audited tables.

## Runtime freeze and current processes

- Core PR: https://github.com/achammah/driftbench/pull/168, frozen contract 2bb0a7a787ca4466ff69d204f2380a7ad19cc056.
- Runtime freeze: examples/ledger-verify/evidence/runtime-freeze.json, id b4e4305a2426e0bb7589.
- Source, pool, statistics, schemas, transport, model settings and prices are committed before the first call.
- gpt-6-luna and gemini-3.8-flash use medium; Gemini timeout is 180 seconds. Haiku uses claude-haiku-5-5.
- Pilot sessions: Haiku 18000, Luna 82231, Gemini 34659. Each uses two concurrent calls; six total.
- Last-call cutoff: 2026-10-13T10:30:03.413000+00:00. No outcome-based sampling or tuning.
- The owner retains the DEV pilot, 30-by-3 noise repeats and mutation checks within the same cap.
- Pilot checkpoint and pool branch pushed earlier at 460acd34; latest runtime commit is 6f6ce73e and will be pushed with receipts.

## Authorized throughput change

- After pilots: Haiku concurrency 3, Luna 6, Gemini 6.
- The owner authorizes this execution-only change. Frozen prompts, settings, pool and cap stay fixed.
- Active pilot source and runtime hashes stay intact until all pilots finish.

## Crash recovery, 2026-10-13

- No verify process survives the plugin crash. Saved receipts contain 71 completed calls costing 0.31179126 USD.
- Five interrupted calls retain 3.00 USD of unknown-charge reservations against the same 25 USD cap.
- Runtime cd2c6735e0a3b2433c9c binds core 35f07309, medium and 180-second API timeouts. The original pilot freeze is preserved.
- This supersedes earlier throughput settings: after pilot, Haiku 2, Luna 4 and Gemini 4. Judge prompts and labels do not change.
- The runner resumes interrupted pilots from saved cassettes and recovers completed receipts before making a new call.
- Source: evidence/crash-recovery.json and receipts/budget.json.

## Pilot transport timeouts

- Luna stops on the 180-second OpenAI timeout after 8 cascade decisions; Gemini stops on its 180-second timeout after 11.
- Both partial reports preserve every sealed pilot item. Promptfoo is not reached, so neither partial pilot supports a comparison.
- Each unknown charge retains its reservation. No returned model answer is retried.
- Parent session receives a request to resume only missing transport outputs once. Haiku continues independently.
- Evidence: pilot/gpt-6-luna.json, pilot/gemini-3.8-flash.json and receipts/errors.jsonl.

## Authorized timeout recovery

- The owner approves one resume of missing API transport outputs, preserving every returned answer and partial report.
- Luna and Gemini now use 300-second timeouts at medium. The outer process timeout is 330 seconds to let the provider timeout return a receipt.
- This supersedes the 180-second API setting. Haiku remains at 240 seconds with two calls; its own timeout awaits a separate answer.
- Runtime ce4f5fcb245096b7f038 binds this change. The original source seal and both earlier runtime manifests remain intact.
- The only original harness-source edit reads the outer timeout from VERIFY_OUTER_TIMEOUT_MS. Cascade prompts, parsers, labels and decisions are unchanged.
- Evidence: evidence/execution-amendment.json, recovery-runtime-freeze.json and preserved pilot/*.partial-cd2c6735e0a3b2433c9c.json.

## Reconnection authorization, 2026-10-13

- All three models may resume missing transport outputs once at 300 seconds. Returned answers remain cached.
- The global limit is four provider calls, enforced atomically: Haiku two, Luna one, Gemini one. This supersedes all earlier concurrency settings.
- Runtime 3ac015c19e4fe43cf929 binds the authorization. The outer process envelope remains 330 seconds.
- Settled spend before this resume is 0.72006150 USD; unknown charges retain 5.00 USD. Source: receipts/budget.json.
- Noise and mutation checks remain scheduled before TEST. The 25 USD cap includes every phase and unknown-charge reservation.
