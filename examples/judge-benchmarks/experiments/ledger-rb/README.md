# RubricBench pair-ledger experiment

This directory contains the historical replay and the frozen pair-ledger experiment for the RubricBench row.
Live coverage and cost are read from `live-summary.json`; incomplete coverage is not a final cell result.

- `sample434-replay.json` reproduces the historical binary canonical executed judge against promptfoo.
- `sample434-decisions.json` retains both mapped games per pair and missing-answer counts.
- `pool-seal.json` records dataset, item-list, source and recording hashes.
- `test-ids.json` fixes all 790 TEST pairs. Haiku uses a previously evaluated split.
- `development-plan.json` fixes pilot and noise selections, cheaters and fixture eligibility.
- `requirements.json` preserves expert rubric text with caller-owned ids and canonical response hashes.

The historical sample has 105 discordant wins and 72 losses over 868 games.
The design's 80% power approximation requires 2,060 games at alpha=0.05/18.
The full pool supplies 1,580 games. This is a power projection, not a guaranteed outcome.
Canonical games share one judgment. Pair-cluster intervals and pair-sign sensitivity accompany the requested game statistics.
Actual Holm adjustment remains pending the full matrix.

The five small DEV domains use the base judge without an earned seat.
They contain 24 of 790 TEST pairs (3.0379747%): Math 3, gpqa 1, helpful 8, mbpp 8, mmlu-pro 4.
Other domains remain unearned until their fixtures pass. Categories are never merged.

## Reproduce without model calls

```sh
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-replay.ts
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-plan.ts
pnpm exec vitest run examples/judge-benchmarks --maxWorkers=2 --no-cache
pnpm exec tsc -p tsconfig.json --noEmit
```

The replay always passes `replayOnly: 'lenient'`; a missing recording counts as an error and cannot trigger a model call.
Downloads, if needed, go into this worktree's ignored `.cache/ledger-rb/data` directory.
Recordings and the executor journal originate from `8c1d1ca707d6505028a4e0db80c937dd6cfaef71` on `origin/codex/rb-judge`.
Package imports are updated for the current repository namespace; historical prompt templates remain unchanged.

## Historical frozen live experiment

The commands and initial model list below document the original registration, not current authorization.
Gemini 3.8 must not be restarted.


Core PR 168 is pinned at `35f07309a4d1d1c8a7c5b176ff19e537d0ef8fdd`.
`contestant-freeze.json` binds source, requirements, statistics, model settings and controlled validity fixtures.
The initial freeze commit precedes every new model call. The owner later raises the cap to USD 35, including uncertain-call reserves.
The amended freeze preserves the original as `contestant-freeze-v1.json`.
There are at most four simultaneous calls, 300-second timeouts and at most three transport attempts.
Returned answers are never retried. Core schema reasks are suppressed after the owner's reconnect amendment.
One prior Haiku pilot schema reask remains in its original recording and cost; no prior validity reask is present.

Models are `claude-haiku-5-5` through the native CLI account, `gpt-6-luna` and `gemini-3.8-flash`.
Luna and Gemini use medium reasoning for both contestants. Keys are read only within the executing process,
from the owner's two authorized files: `~/.nexus-secrets/openai.key` and `~/.nexus-secrets/gemini-driftbench.key`.
Gemini billing is authorized. No key value appears in a recording.

```sh
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-live.ts --phase pilot --execute
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-report.ts
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-live.ts --phase fixtures --execute
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-live.ts --phase noise --execute
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-live.ts --phase validity --execute
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-report.ts
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-live.ts --phase test --execute
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-report.ts
```

Run only one phase process at a time. A restart reuses completed decisions and call keys.
Unfinished reservations require inspection; they cannot trigger a silent repeat. After verifying the old runner
and its children are absent, `--recover-interrupted` records them as transport failures while retaining their reserves.
Only failed transport calls can use the remaining attempts; successful answers replay unchanged.
The TEST command rejects incomplete or failed gates. `--models` restricts execution to named frozen models.
TEST order is outcome-blind and interleaves models and contestants by pair. Budget exhaustion leaves explicit partial coverage.

`live/starts-*.jsonl` records reservations; `live/calls-*.jsonl` preserves provider output and usage.
`decisions-<phase>-*.jsonl` records mapped decisions, parser repairs, machine observations and call keys.
Sampling identity includes phase, repeat and read ordinal, so a canonical third read cannot reuse the first vote.
Code observations are shared between orders with FIRST/SECOND evidence mapped to actual candidate content.

Only the model under test is considered for its own seat. Earning changes eligibility, not its prompt or model.
Failed and undersized categories use that same base model. There is no cross-vendor routing claim.
Controlled validity uses 20 planted arithmetic or supplied-reference facts. It does not establish validity on arbitrary natural-language edits.
Noise uses 30 DEV pairs with three fresh full-procedure repeats. Seat earning uses six distinct DEV pairs with three independent readings each.

## Current owner disposition, 13 Oct 2026

Gemini 3.8 Flash is dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score.
Its partial recordings are retained; no Gemini 3.8 request remains pending or authorized.
Flash Lite remains the Gemini result. Sol continues, then Sonnet under USD 60 including holds.
See `gemini-3.8-owner-drop.json`. Frozen pre-TEST artifacts are historical and remain unchanged.
