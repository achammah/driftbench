# Independent audits: judges v3

The following verdicts and findings are authored by the independent helpers and
collated without changing their verdicts. Source checkpoint and measurement
hashes remain attached to each report. All runtime tests are deterministic.

The requested Sonnet/medium runtime is unavailable here; helpers use the
inherited Codex runtime. The blind pilot runs against an immutable shared
checkpoint without component edits, rather than claiming an independent fix
branch. These limitations and the original hardness failure remain explicit.
The owner-authorized provisional delivery bar is in [GATE.md](GATE.md).

# Blind pilot: judges labeller validator v3

| Check | Verdict | Note |
|---|---|---|
| blind pilot | fail | Baseline already passes every item. Ten repeatability probes produce zero fixes; original hardness requirements are not met. |

- Measured checkpoint: `b5c6f7aaabc5b1fd1322ba03b474184973818e22`. Every measurement reports this HEAD.
- Each measurement covers visible seeds 1 through 20 and hidden seed 50715626, derived by the CLI from HEAD.
- Auditor: inherited Codex runtime. The prescribed Sonnet at medium effort is unavailable; model compliance is not claimed.
- Read scope: validator contract, generated fresh brief, CLI results, and journal schema. No implementation, bank source, or builder handoff was read.
- No source edits, bank edits, commits, invented defects, research fixes, or repository journal changes were made.

## Measurements

The fresh brief reports seed 1 at level 5/5, floor 0, and an empty journal.

| Measurement | Kind | Passing / bank | Score | Level | Failing causes | Items fixed |
|---|---|---:|---:|---:|---:|---:|
| 0 | baseline | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 1 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 2 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 3 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 4 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 5 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 6 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 7 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 8 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 9 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |
| 10 | repeatability-probe | 300 / 300 | 1 | 5 / 5 | 0 | 0 |

- Every level has observed value 1 against threshold 1 on every seed in every measurement.
- Every family has 30 items: six items in each of five tiers. Every level contains 60 bank items.
- Every CLI measurement exits 5, matching its level reached. The outer measurement script exits 0.
- Canonical parsed measurement payloads match across all eleven runs: true.

## Original contract result

- Section 12.4 requires post-pilot score at most 0.4. Measured score: 1.
- Section 12.4 requires at least 100 distinct failing causes. Measured count: 0.
- Items fixed per probe: 0. Forecast: undefined, because remaining failures and improvement rate are both zero.
- These are ten repeatability probes, not ten successful executor-loop fixes. No failure supports a repair.
- The original hardness gate fails. Do not label this blind pilot an audit pass.
- A provisional version-specific delivery exception does not change the original contract verdict.
- Builder-versus-blind fix-speed comparison is undefined: this auditor performed no fixes and did not consume builder evidence.
- This report gives no delivery verdict and no verdict for the other three audit checks.

## Evidence and limits

- All heavy commands ran through the required slot wrapper. Independent CLI processes ran sequentially within one acquired slot.
- No live model calls, private data, or external word lists were used.
- Journal tokenEstimate 0 records the model-free CLI measurement tokens. Auditor reasoning usage is unavailable and excluded.
- Journal rows preserve actual timestamps and measured command durations, with empty change files, null commit, and unchanged results.
- Journal schema validation passes through the repository validateRow function: eleven blind rows, iterations 0 through 10, in sequence.
- Full parsed final and historical evidence: `local audit artifact (summarized in pilot.json and journal.jsonl)`.
- Final appendable rows: `local audit artifact (summarized in pilot.json and journal.jsonl)`.
- Historical report: `local audit artifact (summarized in pilot.json and journal.jsonl)`; historical measurements remain under `historicalPreFix` in the JSON.
- Historical checkpoint 6221d75d76a30b8d750fe27bf24997570ad00e8a also produced eleven full passes, using hidden seed 647384989.
- The parent reports a test-only timeout edit during this final run. The auditor verifies stable HEAD and measurements, not unchanged test-file bytes.

```sh
pnpm driftbench validate judges --ladder-version 3 --brief --fresh
pnpm driftbench validate judges --ladder-version 3 --seeds 1..20 --hidden --items --json
```


---

# Independent CHEATER audit: labeller judges v3

| Check | Verdict | Note |
|---|---|---|
| cheater | pass | 18 attacks; 300 items; seeds 1..20 plus hidden 50715626. |

Measured: 2026-10-17T23:29:10.332Z. Hidden seed source: head; commit: b5c6f7aaabc5b1fd1322ba03b474184973818e22.
The audit read docs/validators.md section 12, used the public labeller API, and used the seed helper to derive the hidden seed. No bank generator, gold, production scorer, or builder handoff was read.
Initial observation, 2026-10-17T23:14:53.970Z: position-cycle passed 4/300 items and 84/6300 item-seed runs: labeller/replay/interleaved/tier-1, tier-2, tier-3, tier-5. All other tested attacks passed zero. This finding was sent to the maintainer before the current rerun.

| Attack | Items passing every seed | Passing item-seed runs |
|---|---:|---:|
| empty-string | 0/300 | 0/6300 |
| constant-none | 0/300 | 0/6300 |
| always-null | 0/300 | 0/6300 |
| first-label | 0/300 | 0/6300 |
| last-label | 0/300 | 0/6300 |
| constant-route-1 | 0/300 | 0/6300 |
| constant-route-2 | 0/300 | 0/6300 |
| position-cycle | 0/300 | 0/6300 |
| position-reverse-cycle | 0/300 | 0/6300 |
| position-blocks | 0/300 | 0/6300 |
| text-length-modulo | 0/300 | 0/6300 |
| first-label-word-in-payload | 0/300 | 0/6300 |
| last-label-word-in-payload | 0/300 | 0/6300 |
| shortest-description | 0/300 | 0/6300 |
| longest-description | 0/300 | 0/6300 |
| numeric-token-as-seed | 0/300 | 0/6300 |
| metadata-oracle-probe | 0/300 | 0/6300 |
| request-mutation | 0/300 | 0/6300 |

Passing item IDs:

Inspected 724500 requests. Observed fields: label.description, label.name, labelSet.labels, labelSet.name, request.context, request.labelSet, request.text.
Observed object prototypes: Object. Unexpected fields/accessors/prototypes: none.
Mutation attempts: 3001320; accepted writes: 3001320.
Accepted writes alone do not fail this audit: readonly is a TypeScript boundary, and mutable request copies can remain isolated from the oracle. The mutation attack is judged by its score gain.

The factory receives requests only; this audit does not give a cheat the seed or item ID. The numeric-token attack treats visible digits as a seed hint.
Payload-name attacks select names appearing in text with fixed-position fallbacks. Position and length attacks ignore classification semantics.
Threat-model limit: arbitrary JavaScript can read repository files. This audit covers only the inspected request boundary, not oracle confidentiality against filesystem access, globals, monkey-patching, or arbitrary process instrumentation.
No live models, external word lists, private data, or paid calls were used.

Reproduce: shared slots/run.sh pnpm exec vitest run packages/validators/test/judges/v3/cheater-audit.test.ts --maxWorkers=2

## Final execution evidence

- Final full run: two tests passed; process exit code 0; Vitest duration 104.67 seconds.
- Current report commit: b5c6f7aaabc5b1fd1322ba03b474184973818e22; hidden seed: 50715626.
- Original failing run: commit 6221d75d76a30b8d750fe27bf24997570ad00e8a; hidden seed: 647384989.
- The targeted post-fix cycle regression also passed separately across all 21 seeds.
- Biome checked the test file successfully. The later source change only increases its explicit timeout from 180000 to 600000 milliseconds.
- A prior full run exceeded the old timeout and wrote a late old-commit report. That report is superseded by this successful current-commit run.


---

# Independent cause review: judges labeller validator v3

| Check | Verdict | Note |
|---|---|---|
| cause review | pending | No failing items exist in the final blind baseline; the required independent cause sample cannot be drawn. |

## Evidence and independence

- Contract: `docs/validators.md`, section 12, read in full.
- Measurement input for this refreshed verdict: `local audit artifact (summarized in pilot.json and journal.jsonl)`.
- Input SHA-256: `3dacd982b6da1483eea9c3853f680bb36f9dfaf3c2e84797bef97497e3ae5893`.
- The report identifies component `judges`, ladder version 3, and level 5 of 5.
- Visible seeds are 1 through 20; hidden seed is 50715626.
- The report associates its hidden seed with HEAD `b5c6f7aaabc5b1fd1322ba03b474184973818e22`.
- No bank source, component implementation, cause tags, or builder handoff was read. No live models were called.

## Independent finding

The final report's complete JSON was parsed, including every seed, level row, bank entry, and failure collection.

- Each of 21 seed records contains 5 level rows and 300 bank entries.
- All 6,300 bank observations have `pass: true`; none lacks the `pass` field.
- All 105 level rows pass. Every row's `items` collection is empty.
- Every seed's `failing` field is null; the top-level `failingItems` collection is empty.
- There are 300 distinct bank item identifiers and zero failing item identifiers.

These observations verify the supplied report's empty failure population. They do not independently verify its runtime or oracle correctness.

## Cause sample and comparison

- Requested sample: up to 30 failing items.
- Available sample: 0 failing items.
- Independent fixes recorded: none, because there is no failing item to diagnose.
- Builder tags inspected: none.
- Tag agreement: undefined, with no comparisons; it is not 1.0.
- Reviewed distinct causes: unmeasured, with zero sampled items; no replacement cause count is certified.

Section 12.7 requires independent fixes before comparison with the builder's tags. An empty sample cannot establish the required agreement.

The cause review remains pending, so the unchanged section 12.7 audit gate is not satisfied. No failures or passing audit verdict are manufactured.

The authorized provisional PR may disclose this limitation. That authorization does not convert the audit result into a pass.

To resume this review, supply a blind all-level report containing actual failing items. Record independent fixes before exposing any cause tags.


---

# Independent planted-bug audit

| Check | Verdict | Note |
|---|---|---|
| planted bugs | pass | 20/20 bank kills; 300/300 baseline items pass at seed 71. |

Production source SHA-256: ea066b27138882d7ecc0457bdddff1808bd0b2faa734d95a5bf3a09be8386d78.
Bank source SHA-256: c7c5320be0208888e3ecb9744566316803014cf66efcf764bbdaf0bd5f48f482.
Measured: 2026-10-17T23:21:33.657Z.

Method: one exact source mutation per isolated in-memory implementation; no production writes. All four public exports are injected into the actual bank with spies. Each independent edge witness first passes on the unchanged compiled copy, then must fail on the mutant. Calls and bank-item losses are measured separately.

| Mutation | Edge witness killed | Calls through injected exports | Bank items lost | First lost item |
|---|---|---:|---:|---|
| Cohen kappa replaced by raw agreement | true | 990 | 55 | labeller/agreement/direct/tier-1 |
| chance denominator uses n instead of n squared | true | 990 | 300 | labeller/agreement/direct/tier-1 |
| chance uses gold marginal twice | true | 990 | 45 | labeller/agreement/boundary/tier-1 |
| chance denominator excludes abstentions | true | 990 | 35 | labeller/agreement/skew/tier-1 |
| raw agreement denominator excludes abstentions | true | 990 | 35 | labeller/agreement/skew/tier-1 |
| abstentions count as agreement | true | 990 | 35 | labeller/agreement/skew/tier-1 |
| none observations excluded | true | 990 | 75 | labeller/agreement/skew/tier-1 |
| invalid answer count omitted | true | 990 | 10 | labeller/agreement/conjunction/tier-1 |
| invalid answers counted as abstentions | true | 990 | 10 | labeller/agreement/conjunction/tier-1 |
| invalid answers count as covered | true | 990 | 10 | labeller/agreement/conjunction/tier-1 |
| negative kappa clamped to zero | true | 990 | 10 | labeller/agreement/negation/tier-1 |
| perfect single-class kappa becomes zero | true | 990 | 10 | labeller/agreement/correction/tier-1 |
| cache and replay key omit text | true | 990 | 35 | labeller/replay/same-object/tier-1 |
| cache and replay key omit context | true | 990 | 5 | labeller/cache-key/context/tier-1 |
| cache and replay key omit labeller identity | true | 990 | 5 | labeller/cache-key/labeller-id/tier-1 |
| label hash and replay omit label names | true | 990 | 20 | labeller/label-set-change/rename/tier-1 |
| label hash and replay omit definitions | true | 990 | 20 | labeller/label-set-change/definition/tier-1 |
| label hash and replay discard label order | true | 990 | 5 | labeller/cache-key/label-order/tier-1 |
| label hash and replay omit set name | true | 870 | 60 | labeller/label-set-change/rename/tier-1 |
| replay miss falls back to none | true | 990 | 60 | labeller/label-set-change/rename/tier-1 |

- Cohen kappa replaced by raw agreement: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic kappa: got 0.5, expected 0
- chance denominator uses n instead of n squared: raw=1; kappa=-1.0526315789473684; correct=40/40; abstentions=0; invalid=0; coverage=1; scoring kappa: got -1.0526315789473684, expected 1; below tier 1 bars: raw >= 0.9, kappa >= 0.8
- chance uses gold marginal twice: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic kappa: got -0.875, expected 0.11764705882352945
- chance denominator excludes abstentions: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic kappa: got 1.25, expected 0.25
- raw agreement denominator excludes abstentions: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic agreement: got 0.6666666666666666, expected 0.4
- abstentions count as agreement: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic correct: got 4, expected 2; diagnostic agreement: got 0.8, expected 0.4; diagnostic kappa: got 0.75, expected 0.25
- none observations excluded: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic total: got 3, expected 5; diagnostic correct: got 1, expected 2; diagnostic agreement: got 0.3333333333333333, expected 0.4; diagnostic coverage: got 0.3333333333333333, expected 0.6
- invalid answer count omitted: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic invalid: got 0, expected 2; diagnostic coverage: got 1, expected 0.5
- invalid answers counted as abstentions: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic abstentions: got 2, expected 0; diagnostic invalid: got 0, expected 2
- invalid answers count as covered: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic coverage: got 1, expected 0.5
- negative kappa clamped to zero: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic kappa: got 0, expected -1
- perfect single-class kappa becomes zero: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; diagnostic kappa: got 0, expected 1
- cache and replay key omit text: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; recording failed: conflicting labeller recordings for key 56bd3ca62deaf8183349f2866c32b03f3a249516b5c4d5c20b0061129ce6b166
- cache and replay key omit context: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; changed request reused its cache key; changed request replayed a stale recorded answer
- cache and replay key omit labeller identity: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; changed request reused its cache key; changed request replayed a stale recorded answer
- label hash and replay omit label names: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; changed request reused its cache key; changed label set reused its hash; changed request replayed a stale recorded answer
- label hash and replay omit definitions: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; changed request reused its cache key; changed label set reused its hash; changed request replayed a stale recorded answer
- label hash and replay discard label order: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; changed request reused its cache key; changed label set reused its hash; changed request replayed a stale recorded answer
- label hash and replay omit set name: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; changed label-set name reused its identity
- replay miss falls back to none: raw=1; kappa=1; correct=40/40; abstentions=0; invalid=0; coverage=1; changed request replayed a stale recorded answer

Command: `<shared-slot-runner> pnpm exec vitest run packages/validators/test/judges/v3/scoring-mutants.test.ts --maxWorkers=2 --reporter=verbose`.

Scope: deterministic labellerBank at the reported seed and the explicit edge witnesses; no live models, private data, word lists, or commits. This is not the full four-part hardness audit.

Category-shuffle rerun: unchanged mutation test; exit code 0; 1 test file passed; 20 tests passed; Vitest duration 18.62s. Production and bank untouched by this auditor.
Fixture source SHA-256: 4281d8da4718f059cd83cd785adf7be0ed24f2adfd61a59481d02ce4c1ca6e5e.
Historical measurement: the prior pre-shuffle run also killed all 20 mutants with 300/300 baseline items passing. The table and timestamps above describe this fresh rerun.
