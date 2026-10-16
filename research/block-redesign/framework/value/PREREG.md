# HF5 to HF9 pre-registration: value check, blame and diagnosis (lane fw-value)

Written 2026-10-15, before any paid call of this lane. The commit that adds this file is the pre-registration.
Binding: `PROTOCOL.md` of the block experiments (pre-registration, tiny sample first, ledger, report as is, no re-run for a better number) and `framework/HYPOTHESES.md` Group B. Design under test: `config_framework.md` sections 2.6, 2.7 and 3, and `value_equivalence.md` sections 3 to 4 (the ladder, the rules R1 to R7, the 182-run classification).

## Hypotheses, verbatim from HYPOTHESES.md Group B

- **HF5 The ladder beats exact and the normaliser.** Against the two-labeller reference on all 259 H1 runs (and the 182 exact failures), the ladder's false passes are at most 2 and below the per-type normaliser's; its false fails are below exact match's. Prediction: the normaliser shows at least 10 false passes (B8 `Ln`). Falsifier: ladder false passes above 2, or not below the normaliser's.
- **HF6 Rung 1 settles most flips safely.** Tool replay (gold value against agent value on the same state) settles at least 50% of the 116 format flips, with 0 settled verdicts that disagree with the reference. Falsifier: below 50%, or 1 or more disagreements.
- **HF7 Read-first judge.** For stored values with no stated format, the read-each-value-first judge has a false-acceptance rate on near-miss negatives (one digit changed, two digits swapped, another customer's value, neighbouring street number, contentless values) no higher than a side-by-side judge, and at most 2% while accepting at least 90% of true positives. Both orders, 3 repeats, one small and one stronger model. Falsifier: read-first above side-by-side, or above 2% at 90% acceptance.
- **HF8 Blame rules as data reproduce the hand classification.** R1 to R7 written as data and applied to hand-coded evidence reproduce the counts agent 45, tool definition 28, prompt 3, pass with test flagged 106 exactly; with evidence computed automatically (source, change, contract, outcome, next_action), per-run agreement with the hand classification is at least 90%. Falsifier: any count differs on hand evidence, or automatic agreement below 90%.
- **HF9 The diagnosis is causal.** Applying the fix the diagnosis names removes the failures it blames: (a) a `coverage_check` description that states "street type in full" or a tool that resolves abbreviations removes at least 80% of the R3 failures on fresh runs of B1, B5, B8 class realisations; (b) a prompt line that no longer demands the town removes the R6 failures; controls (unchanged blocks) gain no new failures above rerun noise. Falsifier: below 80% on (a), or the controls get worse by more than their rerun flip rate.

## Data and fixed inputs

- H1 class runs: `inputs/runs-class.jsonl` (259 runs, 182 exact failures, 77 exact passes), with their jobs `inputs/jobs-class.jsonl` (history, customer text, forced tool results). Copied unchanged from `research/block-phrasing` at `58669be07`, `research/block-redesign/phrasing/data/h1/`; sha256 `a5e75262...c5e6d3` and `6b27cae7...7cd006`.
- Block expectations: the nine Acme spec files of the ten blocks, copied from the same commit into `inputs/specs/`.
- The Acme agent, tools and prompt: `acme/` is `research/block-redesign/shared/acme-live` copied unchanged (prompt sha256 `cd17d54f...c757c544`, the shared prompt). Fixes in HF9 are applied in code (`src/hf9.py`) to copies, never to the files.
- Hand classification: `inputs/hand_classification_h3_runs.md` (copy of `value_equivalence_h3_runs.md`, one row per exact failure).
- Exact oracle: `src/oracle.py`, a Python port of the phrasing lane's exact oracle (the repo's `tools` check plus "expected 0 times is not called"). Checked before this file: it reproduces the stored verdict and the list of failing verdict ids of all 259 class runs and all 300 seed runs (559 of 559).
- Per-type normaliser: the stored H3 `norm` verdict. PR 434 (`feat/block-phase-1-oracle`, the product normaliser) asserts in `packages/checks/test/normalised-oracle.test.ts` that its flips are exactly the same run ids, so N below is both. Secondary: N-townless, PR 434's variant with the town-less surface forms unapproved (105 flips).

## Models

- Agent (HF9 only): `claude-haiku-5-5` through the copied shared agent: effort `low`, `max_tokens` 2048, at most 6 model calls per turn, system prompt cached; key `~/.nexus-secrets/anthropic-driftbench.key`.
- Labellers (HF5 reference): `gpt-6.1-sol` (OpenAI, `reasoning_effort` low, seed 5101) and `gemini-3.6-flash` (Google, `thinkingLevel` low, seed 5101). Gemini 3.8 Flash is not used (dropped by the owner from benchmark reporting).
- Rung 3 judge of the ladder (HF5): `gpt-6-luna`, read-first design.
- HF7 judges: small `gpt-6-luna` (reasoning low), stronger `gemini-3.6-flash` (thinking low). Seeds 7100 + repeat (side by side), 7200 + repeat (reads), 7300 + repeat (comparisons).
- HF8 reply classifier: `gpt-6-luna`, reasoning low, seed 8008.
- No Anthropic model judges or labels. Keys `~/.nexus-secrets/openai.key` and `~/.nexus-secrets/gemini-driftbench.key`, read inside the process, never logged.
- Prices (USD per million tokens, read 2026-10-15): gpt-6-luna 0.10 / 0.01 cached / 0.50; gpt-6.1-sol 2.00 / 0.10 / 10.00 (developers.openai.com/api/docs/pricing); gemini-3.6-flash 0.75 / 0.075 / 3.75, output includes thinking (ai.google.dev/gemini-api/docs/pricing); claude-haiku-5-5 0.10 / 0.01 cache read / 0.125 cache write / 0.50.

## HF5 design

Reference labels:
- Each labeller labels every one of the 259 runs alone (`src/label.py`, prompt fixed in that file). It sees the tool definitions, the agent's system prompt, the conversation before the turn, the customer's message, the agent's tool calls with results (and which results the test forced), the reply, and the block's expectation with the gold values. It never sees an oracle verdict, the other labeller or any classification.
- Labels: `matches`, `format_only`, `undeclared_requirement` (verdict pass) or `real_error` (verdict fail). The label decides the verdict.
- Agreement: percent agreement and Scott's pi on pass/fail over the 259 runs, and on the four labels.
- Reference set R: runs where both labellers give the same verdict. Disagreements are listed and left out of the primary counts; a sensitivity analysis counts them all as pass, then all as fail.

The oracles, each scored on all 259 runs:
- E, exact: the port above.
- N, normaliser: stored `norm`. N-townless as secondary.
- L, ladder (`src/ladder.py`, the default of config_framework.md 3.1). Per slot field of the block, on every call of its tool:
  - a value identical to the gold string passes with no further step;
  - rung 1 if the tool is replayable (`coverage.check`: found, address_id; `port.check`: number, eligible; `catalog.search`: customer.id): replay the agent's call and the same call with the slot set to the gold, on the same store, never a forced result;
  - else rung 2 if the schema states `enum` or `pattern`, or a format is declared in a description or the prompt (none in Acme, read by hand);
  - else rung 3: read-first judge, `gpt-6-luna`, 3 repeats by 2 orders. All 6 say same: pass. All 6 say different: fail. Otherwise inconclusive, and the run fails (the exact verdict stands); inconclusive fields are counted apart.
  - A slot field whose tool was not called keeps its exact verdict. Every other verdict is today's.
  - The slot fields are those of `research/block-phrasing` `src/blocks.ts`. `notify_sales` only stores values, so B2 and B7 phones go to rung 3.
- Metrics, on R: false passes FP(o) are runs o passes and the reference fails; false fails FF(o) are runs o fails and the reference passes. Reported on all 259 runs and on the 182 exact failures.
- Verdict:
  - FALSIFIED if FP(L) > 2, or FP(L) >= FP(N).
  - Also FALSIFIED if FF(L) >= FF(E). The listed falsifier names only the first two conditions; I add this one because the claim states it.
  - SUPPORTED otherwise.
  - INCONCLUSIVE, numbers still reported, if Scott's pi between the labellers on pass/fail is below 0.60 (the reference is not reliable).
- Prediction recorded: FP(N) >= 10.

## HF6 design

- Flips F: the 116 runs with E fail and N pass (stored ids).
- Rung 1 settles a run when every slot verdict of that run that fails under E sits on a replayable tool, and rung 1 (or identity) returns pass or fail for every call. The settled verdict is pass when all settle pass.
- Metrics:
  - share settled = settled / 116;
  - disagreements = settled runs in R whose settled verdict differs from the reference.
- Verdict:
  - SUPPORTED if the share is at least 0.50 and there are 0 disagreements.
  - FALSIFIED if the share is below 0.50, or there is 1 or more disagreement.
  - The same INCONCLUSIVE rule on labeller pi as HF5 applies.
  - Settled runs where the labellers disagree are listed and not counted as disagreements; a sensitivity count is reported.
- Prediction recorded: 59 settled (49 pass, 10 fail).

## HF7 design

Items:
- `data/hf7_items.json`, built by `src/hf7_items.py` (seed 7007) and committed with this file. 128 items over three stored fields with no stated format: a lead's phone, email and street address.
- 56 true positives: the same value written another way. Phones get 4 writings each of 8 numbers. Emails get title case and upper case of 6 addresses. Street addresses get an abbreviated street type, lower case without punctuation, and upper case, for 4 addresses.
- 72 near-miss negatives:
  - one digit changed (8), two digits swapped (8), another customer's phone (8);
  - one letter changed (6), two letters swapped (6), another customer's email (6);
  - neighbouring street number (4), digit changed or swapped (4), another address (4);
  - contentless (18): "", "N/A", the field's name, "unknown", ":", "Thought process:", once per field.
- Negatives are written in a random positive-style format, so string sameness is no shortcut.
- Truth is by construction. An email differing only in case is taken as the same address.

Judges (`src/judges.py`, prompts fixed in that file):
- Side by side (SBS): one call sees the field description, the reference value and the candidate value, and answers same or not. Order 1 shows the reference first, order 2 the candidate first.
- Read first (RF):
  - Each value is read alone, never seeing the other, into `{has_content, reading}`.
  - Code compares the readings: no content on either side means different; equal readings (case and spaces ignored) mean same.
  - Otherwise a second call compares the two readings in the given order.
  - Readings are cached per (model, field, value, repeat).
- Each model runs every item × 2 orders × 3 repeats × 2 designs. A judgment is one (item, order, repeat).

Metrics, per model and design:
- TPR: share of positive judgments accepted.
- FAR: share of negative judgments accepted.
- Intervals: 95% item-clustered bootstrap, 2000 resamples, seed 7007.
- Also reported: FAR per subtype, contentless FAR, order flip rate, repeat flip rate, and Scott's pi against the truth.

Verdict:
- For each model, the conditions are:
  - (i) FAR(RF) <= FAR(SBS);
  - (ii) FAR(RF) <= 0.02;
  - (iii) TPR(RF) >= 0.90.
- SUPPORTED if all three hold for both models.
- FALSIFIED if any fails for either model. A TPR below 0.90 falsifies too, because the claim is "at most 2% at 90% acceptance".
- A cell missing more than 5% of its judgments after retries makes that model's result INCONCLUSIVE.

## HF8 design

- Rules as data: `src/blame_rules.yaml`.
  - Items R1, R2, R2b, R4, R3, R3b, R6, R7, R5b (disabled: no declared downstream consumer) and R5, tried in that order; the first whose `when` holds wins.
  - Each `when` reads evidence names only.
  - Fault map: R3 is tool definition; R6 is prompt; R1, R2, R2b, R4, R3b and R7 are agent; R5 is pass with the test flagged.
- Part 1, hand evidence: each row of the hand table becomes evidence by a fixed mapping in `src/blame.py` `hand_evidence`:
  - provenance gives source and change;
  - tool result gives outcome;
  - agent next gives next_action, steps_skipped and asked_prompt_only_part;
  - contract is none for all, as the hand reading found.
- Part 2, automatic evidence (`src/blame.py` `auto_evidence`), computed from each stored run:
  - source and change: the agent's value against the customer's text;
  - contract: rung 2's reader;
  - outcome: the rung 1 replay, or `stored` for a store-only tool;
  - steps_skipped: any failing verdict off the slot fields, or the slot tool not called;
  - next_action and asked_for: the `gpt-6-luna` reply classifier, one call per exact failure, prompt fixed in the file;
  - asked_prompt_only_part: asked_for meets the parts the prompt asks for that the tool does not need. These are declared once from prompt line 41 and `coverage_check`: the town.
- Metrics:
  - part 1: the four counts, compared exactly with 45, 28, 3 and 106;
  - part 2: per-run agreement of the automatic rule id with the hand class over the 182 runs. Hand R3 matches R3 only, not R3b.
- Verdict:
  - SUPPORTED if part 1 is exact and part 2 agreement is at least 0.90.
  - FALSIFIED otherwise.

## HF9 design

Arms, each a copy:
- `base1` and `base2`: unchanged.
- `desc`: the `coverage_check` description gains "Give the street type in full, for example Road, not Rd." This is the fix the R3 diagnosis names (`fix_location: tool.description`), and the primary fix for (a).
- `resolve`: `coverage_check` expands rd, ln, ave, av, st and wy before its unchanged match. It is secondary for (a), reported and not in the verdict.
- `prompt`: prompt line 41 becomes "...ask for the street number and street name, for example 14 Harbor Road." The town is no longer asked for. This is the fix the R6 diagnosis names.

Job sets, each an H1 class realisation with its H1 history, text and forced results:
- target_a: B1, B5 and B8, 83 realisations × 3 = 249 runs per arm. Arms base1, desc and resolve.
- target_b: the town-less realisations of B5 and B6 (17) × 6 = 102 runs per arm. Arms base1 and prompt.
- controls: B2, B3, B4, B7, B9 and B10 (150 realisations) × 1 per arm. Arms base1, base2, desc, resolve and prompt.

Operational definitions, fixed now:
- R3 failure: the run fails E, and one of its `coverage_check` calls returned `found: false`.
- R6 failure: the run fails E, makes no `coverage_check` call, and its reply contains "town".
- Removal = 1 - rate(fix) / rate(base1).

Metrics:
- (a) removal of R3 failures under desc, pooled over target_a (per block reported).
- (b) removal of R6 failures under prompt on target_b.
- Controls:
  - the rerun flip rate f is the share of control jobs whose E verdict differs between base1 and base2;
  - worsening(arm) = fail rate(arm) - fail rate(base1).

Verdict:
- SUPPORTED if (a) >= 0.80, (b) >= 0.80, and worsening <= f for both desc and prompt.
- FALSIFIED if (a) < 0.80, or worsening > f for desc or prompt, or (b) < 0.80.
- (b) is INCONCLUSIVE, and HF9 is then judged on (a) and the controls, if base1 shows fewer than 5 R6 failures on target_b.

## Order, tiny sample, budget, stop rule

- Lane cap 12 USD. Code refuses any paid call once `data/usage.jsonl` totals 10.8 USD (`src/common.py` `guard`). LEDGER.md is computed from that file.
- Tiny sample first: 3 runs per labeller, 4 HF7 items per model, 4 HF8 classifications, 4 agent runs. Then the measured USD per unit and the projection go into LEDGER.md before scaling.
- Tiny-sample answers stay in the data when no code or prompt changes between the tiny sample and the full run. If anything changes, the tiny-sample answers move to `data/tiny/` and are left out.
- If the projection exceeds 10.8 USD, in this order:
  1. HF7 on the stronger model runs 2 repeats instead of 3 (stated as a deviation);
  2. HF5 labels the 182 exact failures plus a random 40 of the 77 exact passes (seed 5105).
- Order of the full runs: HF5 labels, HF5 rung 3, HF8 classifier, HF7, HF9.
- A call that fails after retries is logged in an `.errors.jsonl` file and run again (the files are resumable). A re-run for any other reason needs a written reason, and both results are kept.
- Results: `RESULTS.md` (verdict per hypothesis, counts, intervals) and `results.json` (per-item data). Each experiment is pushed when it completes.
