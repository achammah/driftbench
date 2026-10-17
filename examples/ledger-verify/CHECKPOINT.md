# Verify execution checkpoint

- Pushed execution amendment: 34f76183. Branch research/ledger-verify.
- Active runtime: ee96e47757aa837860fe. Recording namespace stays 2869d4d1f750545a2c7d.
- Owner pacing: Luna eight plain HTTP calls, Gemini two, Haiku two; no global four-call limit.
- Actual provider timeout is 300 seconds; API reasoning medium; global money cap 40 USD includes unresolved holds.
- Gemini is STOPPED after 20 explicit HTTP 402 rejections. Owner says wait for top-up, then resume missing-only.
- evidence/billing-reconciliation.json releases only those 20 rejection holds, totaling 20 USD. Unknown network holds remain.
- Gemini noise-1 retains its stopped report and twenty no-answer records. Archive that partial before recovery; remove only proven no-answer records from the active cassette, preserving their archive. Never retry returned answers.
- Luna noise-1 briefly stopped because rejection holds consumed the conservative cap. Its partial is noise-1/gpt-6-luna.pre-billing-release.partial.json. Two returned answers remain cached.
- Luna missing-only continuation runs in exec session 1821, then starts supervise.py for noise-2 and TEST. Eight HTTP workers observed.
- Haiku supervisor remains alive from session 22934, PID 39438; its current phase is noise-0. Two native calls observed.
- Gemini supervisor has exited. Do not restart until owner signals prepaid credit replenishment.
- No TEST has started at 09:39 UTC. Both strict and product-final scoring were frozen before TEST.
- Official and audited tables remain pending. Strict output-limit errors are headline; product-final includes existing fallback.
- Three pilots and all mutation checks are finished. Every model/contestant has 12/12 preserve, 12/12 flip, zero injection changes.
- Free replay verifies eight finished phases with identical decisions and zero new calls.
- Four native output-limit envelopes observed so far; three await attribution until Haiku noise-0 finishes. Two historical native error causes remain unclassified.
- status.py is read-only. trace-requests.ts --all, output_limits.py, check-replays.py, summarize.py and render_report.py complete reporting without provider calls.
- Final target: <scratchpad>/codex/dossier-ledger-verify.md.
- Keep running both unblocked models through all 379 units unless the cap is reached. Do not report completion while their phases are pending.
- All writes stay in this worktree, the named report, and append-only spend-ledger rows. No other key files or worktrees may be written.

## 10:05 UTC checkpoint

- First TEST starts at 09:57:23.443 UTC for gpt-6-luna, 221 sealed items, runtime ee96e47757aa837860fe.
- Scoring implementation hashes match the pre-TEST freeze; evidence/test-entry-check.json proves chronology.
- Luna completes all three noise repeats. Noise changes: cascade 4/30, promptfoo 9/30; both have two items with a missing state.
- Haiku noise-0 finishes with all 30 final verdicts per contestant. Noise-1 starts at 10:00:56.558 UTC.
- Six confirmed native output-limit envelopes are all ours: one pilot, five noise-0. These affect one pilot item and three noise-0 items. Zero unmapped confirmed limits.
- Two historical native error bodies remain unclassified. No TEST output-limit error is observed at this checkpoint.
- Last pushed code commit acac98d2; live receipts and reports remain uncommitted until a stable checkpoint or final handoff.
- Gemini remains stopped, awaiting the owner top-up signal. No Gemini restart is authorized before that signal.

## 10:21 UTC Gemini top-up recovery

- Owner confirms prepaid credit replenishment. One missing request probe returns an answer for 0.00151125 USD.
- Probe receipt 4be8c338-3566-4b4f-8eb7-b860b6cc0050 is preserved for free same-phase recovery. It must not be called again.
- Recovery archives original noise-0 and noise-1 reports/cassettes before removing only 5 network no-answer entries and 20 proven billing rejections. All returned answers remain cached.
- Gemini driver exec session 64488 resumes those two phases, then supervises noise-2 and TEST at two concurrent requests.
- Gemini uses medium and 300-second provider attempts; quota waits remain 60/120/240 seconds; HTTP 402 still stops the model.
- No unknown-charge hold is released. Runtime and scoring hashes stay unchanged. See evidence/gemini-topup-resume.json.
- Luna remains in sealed TEST at eight requests. Haiku is in noise-1 at two native processes.

## Automatic offline completion

- finish.py --wait runs as exec session 40010, PID 48739. It waits for all three supervisors to finish every phase, then runs attribution, strict limits, exact replay, statistics and report generation without provider keys.
- It validates all 18 phases and 379 units per model before generating the full report. It does not commit or push; review and git remain the main worker's next action.
- The cheater margin is not established on the pilot. evidence/cheater-gate-audit.json records the exact comparison and bounds mutation validity. The final report includes that disclosure without changing TEST scoring.

## 10:47 UTC checkpoint

- Luna completes all 379 units, including 221 TEST items per contestant. Official strict/product-final: 165 versus 160 correct, p 0.4731296599. Audited: 188 versus 181, p 0.2810415151. Both TIE; no limits or missing TEST verdicts.
- Gemini has one HTTP 429 event, followed by its prescribed 60-second wait. No renewed HTTP 402.
- Offline finalizer session 40010 was retired to fix a status-file read race. Replacement session 57895 is active; its current PID is in evidence/finalizer-state.json. Paid runners were not interrupted.

## 11:09 UTC durable state

- Completed Luna TEST and completed validation artifacts are pushed at a77c6f33. Live provider receipts and current Gemini/Haiku phases remain uncommitted.
- Gemini supervisor is exec session 64488. Haiku supervisor is session 22934. Both are in noise-2 at two calls each. Luna session 1821 has exited successfully.
- Latest offline finalizer is exec session 76728, PID 3489. Session 57895 was replaced so machine-readable cells also disclose the cheater-gate limitation. The finalizer does not make provider calls.
- Ten confirmed output-limit envelopes are attributed to Haiku cascade across pilot/noise-0/noise-1, affecting six phase/item pairs. New noise-2 limits await that phase's completion and final attribution.
- The latest free replay covers twelve completed phases including Luna TEST, with zero divergent decisions and zero provider calls. Finalizer rechecks all eighteen when execution finishes.
- Do not end while Haiku/Gemini TEST is pending unless the conservative 40 USD cap truly prevents continuation. If a reservation-only budget stop occurs, let other in-flight calls settle before deciding whether remaining missing calls fit.
- Final steps: inspect finalizer evidence and report, verify no pending coverage or unmapped limits, append finish spend, commit all final receipts/artifacts, push and verify remote HEAD.

## 2026-10-13T11:39:24.388282+00:00 daily quota pause

- This section supersedes older Gemini continuation instructions. Gemini is not run: daily quota; TEST 0/221 per contestant. Noise 2 has 30 cascade and 20 promptfoo final verdicts, ten peer verdicts pending.
- No Gemini paid runner remains. Both known backoff holds settled at zero automatically; no manual budget rewrite occurs. The final rejected attempts were at 11:19 UTC before the resumed controller inspected their exit.
- Runtime-only evidence: evidence/gemini-daily-quota-amendment.json. All 163 returned noise-2 answers and the stopped report are archived unchanged.
- Named reset driver: resume_gemini.py --wait, exec session 71554, PID 77546. It makes no provider calls before 2026-10-14T00:00:00Z, resumes missing-only once, and stops its own process group at 2026-10-14T12:00:00Z or on the first stopped phase.
- Haiku continues under its existing supervisor PID 39438, exec session 22934. Do not interrupt it. Luna is complete.
- Offline reporter: finish.py --wait --allow-daily-quota, exec session 81156; PID is in evidence/finalizer-state.json. It waits for Haiku and Luna, excludes unfinished Gemini noise from measured flips, then writes the official/audited strict/product-final report.
- Four offline reset tests pass without provider calls. Frozen scoring and transport source are untouched.
- After Haiku finishes: inspect report, reconcile fees, append spend, commit and push the owned branch. Gemini reset driver later invokes the full offline finalizer after its remaining phases finish.

## 2026-10-13T11:49:56.001538+00:00 outage recovery and current controllers

- Owner authorizes one retry of exactly four ENOTFOUND calls and one 300-second timeout in Haiku noise-2. See evidence/haiku-outage-amendment.json. Returned answers and the three output-limit envelopes remain untouched.
- recover_outage.py runs as exec session 91919. It uses the exact frozen request fingerprints, a five-call allowlist and atomic once-only claims. The original cassette/report is archived before replacing only authorized no-answer slots. Global Haiku concurrency stays two. The unknown timeout hold remains.
- Haiku sealed TEST has started under the original supervisor. No prompt or statistical code changes. Outage recovery is an execution-only amendment after TEST starts.
- Latest reset driver: exec session 50009, PID 95097. Older session 71554 is retired. It remains gated until 14 October 00:00 UTC and stops by 12:00 UTC. After Gemini completes, it runs offline verification and publish_results.py to push this owned branch.
- Latest offline reporter: exec session 72035; PID in evidence/finalizer-state.json. Older session 81156 is retired. It waits for completed Haiku, Luna and the five-call outage recovery before reporting.
- Four reset preservation/timing tests pass again. Generated outage transport successfully executes its guarded claim path; the canonical transport and runtime hashes are unchanged.

## 2026-10-13T12:08:20.045906+00:00 owner-only Gemini hold and Flash Lite cell

- Reset driver PID 63336 is stopped; PID 77546 was already retired. Persistent owner-only guard prevents automatic Gemini 3.8 restart.
- Haiku TEST continues at four workers with the existing adaptive fallback.
- Flash Lite is a new, separately recorded cell under lite/, with its own 6 USD budget and no answers imported from Gemini 3.8.
- Published Standard price: 0.30 USD input and 2.50 USD output including thinking per million tokens. Medium is supported by official thinking documentation.
- Freeze: lite/evidence/model-amendment.json, prior to any Flash Lite call. Eight workers, 20/60/180 second quota waits, 300-second timeout, immediate HTTP 402 circuit.

## 2026-10-13T12:26:24.173817+00:00 Flash Lite network pause

- Flash Lite pilot and mutation fixtures finish. Both contestants pass 12/12 preserve and 12/12 flip, with zero injection changes.
- Medium succeeds. Pilot costs 0.5183653 USD; the owner raises this separate cell cap to 12 USD, recorded before noise completes.
- Noise 0 stops after 35 no-answer network errors. Actual fees total 0.8440801 USD; 10.50 USD unknown holds remain reserved. Original partial report and cassette are archived unchanged.
- Host DNS and public HTTP, including Node fetch, work at the later probe. The original transport omits the underlying cause of the earlier errors. No hold is released without proof.
- A request for missing-only recovery and host-outage confirmation is sent to the parent. No Flash Lite paid runner remains.
- Exact ordinary replay of mutation fixtures exposes concurrent duplicate-key answers. Offline item-aware replay is under verification, preserving every answer and the original verdicts.
- Haiku continues in TEST under automatic load fallback. Original offline reporter session 18577 remains active.
- Current branch checkpoint 19167375 is pushed. Gemini 3.8 was dropped by the owner; the persistent guard prevents restart.

## 2026-10-13T12:44:38.889306+00:00 Flash Lite recovery

- All 35 authorized no-answer requests return after one additional submission each. No returned answer is resent.
- Recovery costs 0.1725274 USD. All 35 original uncertain-charge holds, 10.50 USD total, remain reserved inside the 18 USD cap.
- DNS and unauthenticated HTTP probes pass before submission. Exact requests, receipts and attempt claims are retained.
- Noise resumes from preserved answers, followed by the remaining repeats and sealed TEST. Source: lite/evidence/network-recovery-result.json and network-recovery-execution.json.

- Recovery driver PID 16732, exec session 10043. Original finalizer PID 2795; Flash Lite finalizer exec session 52960. Haiku TEST continues. Gemini 3.8 was dropped by the owner; no continuation is scheduled.

## 2026-10-13T12:53:26.576077+00:00 first-final preservation

- The Flash Lite noise recovery returns new downstream keys for six items with an existing final verdict. Two continuation verdicts differ.
- All six first completed verdicts remain primary. Both generations and every actual fee remain in the evidence.
- Offline replay reproduces pilot, mutations and the first two noise repeats exactly, with zero provider calls.
- The original model partial-report audit finds no changed completed verdicts across nine archived reports. Source: evidence/first-final-audit.json.

## 2026-10-13T12:55:43.901640+00:00 Flash Lite cap24 amendment

- Owner raises the separate Flash Lite cap from 18 USD to 24 USD to finish all 221 sealed TEST items.
- Every existing uncertain-charge hold remains. Model, medium reasoning, 300-second timeout, eight workers, sealed order and scoring stay fixed.
- Source: lite/evidence/cap24-amendment.json.

## 2026-10-13T13:14:32.822525+00:00 TEST connection recovery

- Owner authorizes recovery of 25 no-answer TEST requests, up to three total submissions each, after a connectivity probe. Flash Lite now uses four workers.
- The 24 fetch-stage connect-timeout holds release 7.20 USD. The HTTP-200 response-body hold and 35 earlier holds remain: 10.80 USD total.
- The 117 completed item outcomes remain fixed, including five returned parse failures. Offline continuation checks all 117 with zero provider calls.
- Driver PID 48002, exec session 47258. Source: lite/evidence/test-recovery-amendment.json and test-network-hold-release.json.

- TEST recovery returns all 25 on one additional submission each. Source: lite/evidence/test-network-recovery-result.json. Four-worker TEST continues under PID48002; finalizer exec session11726 waits.

## 2026-10-13T13:46:18.687476+00:00 model additions and TEST recovery

- Flash Lite all 379 units complete; six exact offline replays pass. Fees 8.6226905 USD plus 10.80 USD retained holds.
- Haiku initial TEST continues. PID 65388 waits for initial TEST and offline report, then recovers only the three authorized timeouts once. Existing final verdicts stay unchanged.
- Sonnet and gpt-6.1-sol are frozen as separate 25 USD cells, with five DEV calls and a cost projection before the full run. They cannot call until existing cells and Haiku recovery finish.
- Gemini 3.8 was dropped by the owner; no continuation is scheduled.

## 2026-10-13T14:07:26.800356+00:00 Haiku TEST recovery extension

- The owner authorizes one missing-only recovery after initial TEST for up to eight empty native 300-second TEST timeouts. Four currently qualify; all original receipts and 2.00 USD holds remain.
- recover_haiku_test_timeouts.py collects the final eligible set, stops the owned initial runner above eight, reconstructs exact requests offline and guards every additional submission with an atomic claim.
- The first three-call authorization is retained in evidence/haiku-test-timeouts.initial-three.json. No returned answer is resubmitted.

## 2026-10-13T14:45:11.112631+00:00 owner network amendment

- All paid admissions pause until ten consecutive healthy provider probes spaced 30 seconds apart. Calls then run at concurrency two, one model cell at a time. Three consecutive connection failures trigger a ten-minute pause and a new gate.
- Zero-token, no-output transport failures retry missing-only without an attempt limit. This supersedes the Haiku eight-timeout ceiling. Returned answers, original receipts and uncertain-charge holds remain.
- Haiku initial TEST returns all 221 cascade verdicts; promptfoo has two transport-missing finals. Six empty native timeouts are eligible. Completed answers remain primary and only missing finals can change.
- Sequence: finish Haiku recovery, then Sonnet, then Sol. A new model cost projection above 25 USD stops that cell before its full run. Gemini 3.8 was dropped by the owner; no restart is authorized.
- Provider probes have no credentials and make no generation request. Evidence: evidence/network-pause-20261013.json, network-probes.jsonl and network-admission.json.

## 2026-10-13T14:55:03.348307+00:00 network scheduling safeguards

- Five offline admission and retry checks pass: closed gate, other model, two-call ceiling, terminal answered error, and missing-only connection retry. No model calls occur in these checks.
- Haiku retry waves retain the original six target requests and visit every missing request before repeating failures. Previously answered recovery requests replay their cached answer.
- New-cell outer envelopes cover network waits; physical provider attempts stay at 300 seconds. runtime-freeze.json records the outer Node timer, reasoning and unchanged scorer hashes.

## 2026-10-13T15:29:58.697233+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T16:02:29.352113+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T16:08:29.772211+00:00 resumed open model cells

- Sonnet cache-off remeasure: five new DEV answers, 0.069768 USD, zero cache writes, projected total 29.080030 USD. Conditional 45 USD cap including holds is active.
- Sonnet supervisor PID 56977, health daemon PID 88056. Logs: sonnet/logs/full-supervisor.log and logs/network-gate-resume.log. All old model answers remain cached.
- Sol supervisor waits for its provider admission behind Sonnet. Network sequencer: logs/network-sequence-resume.log. Ten new OpenAI probes are required before Sol calls.
- New-cell fee reservations include holds. Source amendments and archive hashes are in each new model folder. Original cells, Luna official results and parked Gemini are unchanged.
- Before restart, inspect live processes and receipts. Never launch an extra supervisor for an active cell.

## 2026-10-13T16:15:41.917330+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T16:24:41.258658+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T16:43:57.790251+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T16:47:17.809785+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T16:51:55.230226+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T17:09:35.202197+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T17:31:45.578460+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T17:49:25.148640+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T17:54:22.075185+00:00 active model continuation

- Symmetric closed-cell output-limit correction is pushed at 56f47cd30897dd919a1b94393352b7e4c9d87823. Closed result files remain unchanged.
- Sonnet TEST starts once at 17:47:11 UTC, after the detector amendment at 17:42:49 UTC. Its noise and mutation phases finish first.
- Sol waits for Sonnet complete, then requires its fresh ten-probe gate under cap 40 USD. Sonnet cap is 45 USD.
- Named publication driver waits for both finalizers, then publishes the complete reports and stops the health gate. Live process identities and exit predicates: evidence/new-model-active-drivers.json.

## 2026-10-13T18:33:38.080487+00:00 owner drops Gemini 3.8

- The owner drops Gemini 3.8 on 13 Oct 2026. This supersedes every earlier instruction to resume it or treat it as pending.
- Partial reports, recordings, receipts, fees and unknown holds stay intact. No Gemini 3.8 score is reported and no further request is authorized.
- Flash Lite remains the Gemini result. Continue Sonnet, then Sol under cap 40 USD.
- Evidence: evidence/gemini-owner-drop.json, including retained-file hashes. The existing owner-only guard remains disarmed.

## 2026-10-13T18:33:39.599550+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini 3.8 is dropped by the owner on 13 Oct 2026. Partial data stays archived; no score or pending continuation is reported.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T19:35:18.781846+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini 3.8 is dropped by the owner on 13 Oct 2026. Partial data stays archived; no score or pending continuation is reported.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-13T22:48:52.645211+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini 3.8 is dropped by the owner on 13 Oct 2026. Partial data stays archived; no score or pending continuation is reported.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.

## 2026-10-14T02:18:34.664885+00:00 verified report publication

- Completed models: haiku, gpt-6-luna. Offline replay covers 16 finished phases, with zero new provider calls.
- Gemini 3.8 is dropped by the owner on 13 Oct 2026. Partial data stays archived; no score or pending continuation is reported.
- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.
