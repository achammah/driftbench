# Benchmark floors for the shipped judge

The repository-only `pnpm bench` script records the shipped default judge on fictional cases with labels fixed by construction. Committed recordings replay without credentials or model calls. CI refuses a missing recording, stale evidence, or a result below its floor.

This checks the behavior available through the public package. It does not establish that one model is best for every user's task. Calibrate on your own criteria and labels as described in [judges](concepts/judges.md).

## Replay the committed recordings

Run from a checkout of this repository:

```sh
pnpm bench replay --slice all --check-floor
pnpm bench replay --slice fresh-reference --model haiku --json
pnpm bench floors
```

`--slice` defaults to `all`. Without `--model`, replay selects every active model. `--root <path>` selects another repository checkout containing `benchmarks/`. The command reads raw recorded responses through the current public parser.

Each result prints the correct count, Wilson interval and bootstrap interval over construction families. `--check-floor` adds the absolute floor and paired comparison. JSON output includes individual case results, checks, problems and skipped models. No network request is made.

A changed dataset hash, prompt fingerprint, client setting, or cassette integrity check requires a new recording. A stale cassette fails with `re-record needed`; it cannot silently pass the previous score.

## Immutable slices

The [manifest](../benchmarks/manifest.json) lists 14 slices and 1,798 binary cases per active model. Every slice is version 1. The complete population is retained.

| Slice | Cases | Source file |
|---|---:|---|
| `fresh-rubric` | 192 | A: `promptfoo-rubric-cases.json` |
| `fresh-reference` | 192 | A: `langfuse-reference-cases.json` |
| `map-rubric` | 156 | A: `map/promptfoo-rubric-cases.json` |
| `map-reference` | 180 | A: `map/langfuse-reference-cases.json` |
| `hard-rubric` | 120 | B: `rubric.json` |
| `hard-factuality` | 120 | B: `factuality.json` |
| `hard-pii` | 120 | B: `pii.json` |
| `hard-goal` | 120 | B: `goal.json` |
| `heldout-rubric` | 72 | B: `heldout-rubric.json` |
| `heldout-factuality` | 72 | B: `heldout-factuality.json` |
| `heldout-pii` | 72 | B: `heldout-pii.json` |
| `heldout-goal` | 72 | B: `heldout-goal.json` |
| `planted-verify` | 190 | C: `bank-verify.json` |
| `planted-rubric` | 120 | C: `bank-rb.json` |

Source roots and frozen commits:

* A: [`comparisons/astra-hard/`](https://github.com/achammah/driftbench/tree/89425c88b12e5fd7516ed9cdbf6d37b9b0261595/comparisons/astra-hard), commit `89425c88b12e5fd7516ed9cdbf6d37b9b0261595`, from `research/astra-hard-fresh`.
* B: [`comparisons/promptfoo/hard/`](https://github.com/achammah/driftbench/tree/82cc403c01aa2992b109a24d739e2febe4bd33f5/comparisons/promptfoo/hard), commit `82cc403c01aa2992b109a24d739e2febe4bd33f5`, from `codex/hard-promptfoo`.
* C: [`research/planted/`](https://github.com/achammah/driftbench/tree/d88113cb33cef242b068e630b176651b97a7e743/research/planted), frozen commit `d88113cb33cef242b068e630b176651b97a7e743`, from `research/astra-planted-truth`. Its [audit and metrics](https://github.com/achammah/driftbench/tree/492fce432e1d34a62c5f5c5586d23026133b390b/research/planted) are at `492fce432e1d34a62c5f5c5586d23026133b390b`.

The planted verify bank retains all 95 pairs, including repeats; its source audit reports 91 distinct pairs. The planted rubric bank retains all 60 pairs. Each clean response becomes a pass case and each defective response becomes a fail case. These are fictional re-instantiations of executable templates, not complete public benchmark dev splits. The rubric bank tests an objective requirement, not full-rubric preference accuracy.

Each folder `benchmarks/slices/<name>/<version>/` holds:

* `cases.spec.json`: a valid conversation spec whose `metadata.bench` contains the cases.
* `source.json`: the source file copied byte for byte.
* `provenance.json`: the commit, source path, source hash, population and conversion method.

The folder hash is the [dataset registry](datasets.md#the-registry) content hash. Replay and record recompute it with the public store API. A changed folder requires a new dataset version. `--store <file>` also registers the exact version in a local store and rejects a version conflict.

```sh
pnpm driftbench dataset push fresh-rubric benchmarks/slices/fresh-rubric/1 --store bench.db
pnpm bench replay --slice fresh-rubric --store bench.db
```

## Labels and the public API boundary

A case carries its id, construction family, expected pass or fail, and a `JudgeRequest`. Only the request reaches the judge. Family names, labels, source proofs and mutation metadata remain outside it. A planted defective response is judged without its clean counterpart or construction oracle.

Reference slices supply their trusted reference as an input file. Factuality slices preserve the original contradiction criterion. Goal slices supply the persisted final order. These inputs express the task, while the binary truth remains separate.

The harness accepts only the default request fields: `criterion`, `transcript`, `inputs`, `reference`, `artifact` and `given`. Dataset cases cannot select another assessment or answer contract.

[The public API check](../tools/bench-lint.mjs) limits production benchmark imports to allowed judge exports, public statistics, Node builtins and local production benchmark modules. It rejects internal package imports, runtime module loaders, and imports from benchmark tests or preparation scripts. The scoring and recording code cannot substitute a benchmark-specific judge prompt.

The repository entry `benchmarks/cli.ts` also permits named public APIs for loading specs, opening the dataset store, finding the repository root and parsing arguments. Those command helpers are unavailable to the scoring and recording modules.

## Active models

| Model id | Recorded model | Status |
|---|---|---|
| `haiku` | `claude-haiku-5-5` | Active, through the public CLI judge |
| `gpt-6-luna` | `gpt-6-luna` | Active, public OpenAI judge, medium reasoning |
| `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` | Active, public Google judge, medium thinking, 300 second timeout |

All active models use the same shipped prompt fingerprint. Explicit reasoning settings participate in each client's cassette key.

## Record and resume

Recording is a maintainer action that makes live model calls. Select one model and supply an approved spending limit. Haiku needs an installed, authenticated `claude` executable. OpenAI needs `OPENAI_API_KEY`; Gemini needs `GEMINI_API_KEY` in the environment.

```sh
pnpm bench record --slice fresh-rubric --model haiku --spend-cap-usd <approved-cap>
pnpm bench record --slice all --model gpt-6-luna --spend-cap-usd <approved-cap> --resume
```

`--concurrency` defaults to 4 and accepts 1 through 16. The first live request completes before concurrent recording starts. The budget reserves spending before each live call, including concurrent calls. It refuses an unmetered answer. An error without measured usage charges the reservation conservatively. The cap applies to this invocation; a resumed invocation needs its own cap.

A judgment can contain several billed HTTP responses. The recorder sums their usage and cost, and reserves each new request's output allowance before sending it. A failed recovery retains both the earlier measured cost and the unmetered reservation.

Successful calls checkpoint partial cassettes and spending evidence. `--resume` reuses completed recordings only after validation. For partial recordings, it replays matching successful responses and requests only the missing responses. It rejects stale fingerprints, datasets or client settings. Omit `--resume` when intentionally re-recording changed code; the previous completed cassette is archived by content hash.

The command writes:

| File | Content |
|---|---|
| `benchmarks/cassettes/<slice>@<version>/<model>.json` | Raw responses and public client identity |
| `benchmarks/evidence/<slice>@<version>/<model>.json` | Score report, cassette hash, resolved models, measured and charged spending, and call records |
| `benchmarks/evidence/spend.jsonl` | Append-only spending rows; override with `--spend-ledger <path>` |

The report records the dataset identity, prompt fingerprint, client settings, commit and timestamps. The command checks that recording and replay produce identical case results before accepting the completed cassette. A transport-truncated response remains inconclusive during replay even if its raw JSON is parseable. A regression retains its evidence for diagnosis and returns a failure.

Gemini retries HTTP 429 responses after 60, 120 and 240 seconds, honoring a longer provider retry delay. Each retry gets a fresh 300 second timeout. The manual workflow uses eight concurrent Flash-Lite or Luna calls and four Haiku calls.

The manual [bench record workflow](../.github/workflows/bench-record.yml) accepts a slice, model and cap. Its cap must be positive and at most 5 USD. OpenAI and Gemini use their repository secrets on a hosted runner. Haiku uses a preconfigured self-hosted runner labelled `driftbench-bench` and `claude-cli`. The workflow uploads cassettes and evidence for review; it does not commit them or raise floors.

## Floors and uncertainty

[The floor file](../benchmarks/floors.json) holds a separate floor for each slice version and model. A floor stores the correct count, case count, Wilson lower bound, fingerprint, commit, individual results and evidence hash.

`--check-floor` requires both checks to hold:

1. The correct count is at least the recorded floor.
2. Paired results pass the automatic non-inferiority margin and do not show a significant drop under exact, two-sided McNemar at 0.05.

The automatic margin uses the baseline's self-comparison, rounded upward in half percentage point increments. Pairing requires identical case ids, labels and construction families. Wilson intervals and bootstraps over whole families accompany the result. Perfect accuracy still carries a zero-failure bound that assumes independent cases. Related constructions and repeated pairs can violate that assumption.

These intervals describe this finite, constructed population. They do not measure all-domain reliability or eliminate label-design errors. Retaining source data and family membership makes those limits inspectable.

To establish or raise a floor, first inspect a complete recording and its replay. Then provide current evidence:

```sh
pnpm --silent bench replay --slice fresh-rubric --model haiku --json > bench-replay.json
pnpm bench floors --raise fresh-rubric haiku --evidence bench-replay.json
pnpm bench replay --slice all --check-floor
```

`--evidence` also accepts the individual record evidence file. The command validates the evidence against the current cassette replay before writing. Within one dataset version, the correct count cannot fall. An equal count can update the evidence after a fingerprint change; an unchanged count at the same fingerprint is refused. Previous floor records remain in history.

## Optional empirical repeat check

Supply frozen repeat files when old and candidate judges have independently recorded repeats:

```sh
pnpm bench replay --slice fictional-noise --model gpt-6-luna --check-floor --repeat-evidence repeats.json --json
```

The manifest uses `format: driftbench-bench-repeat-files-v1` and `groups`. Each group names `slice`, `judge`,
`old` and `candidate`. Each side needs at least three complete runs. A run supplies `runId`, the original
`report`, `cassettePath`, `cassetteSha256`, `receiptsPath` and `receiptsSha256`. Paths resolve from the
manifest's folder. An explicit file must cover exactly the selected slice/model populations.
For `--check-floor`, replay automatically uses `benchmarks/repeats/manifest.json` when it exists, unless
`--repeat-evidence` overrides it. That default manifest must cover all active slice/model populations.
Replay validates the full manifest, including unselected groups, before filtering `--slice` or `--model`.
Missing, corrupt, duplicate or partial default evidence fails closed. When the default file is absent,
the historical check runs. Replay without `--check-floor` does not load the default repeat manifest.

A receipt mapping uses `format: driftbench-bench-repeat-receipts-v1`, `runId`, `head`, `fingerprint`,
`judge`, `model`, `settings`, `side` (`old` or `candidate`), `repeat` (starting at 1), and a `calls` array in dataset case order. Each call supplies a distinct physical
`id`, `caseId`, request `key`, `provider` (`openai`, `google` or `anthropic`), `status: ok`, and `raw` provider
response JSON. Optional `httpStatus` must be a successful HTTP status. OpenAI text parts, Google content
parts, and Anthropic non-thinking text parts are extracted and compared with the cassette's model text.
Failed, interrupted and recovery-accounting receipts cannot establish successful recording occurrences.

Export mappings from the original successful physical receipts. If a serialized recorder has no request
keys in its receipts, establish the occurrence mapping from its frozen request sequence, concurrency and
logical-call completion journal before exporting. An unprovable association is missing evidence. Retain
the original journals for independent review; do not replace them with invented identifiers or responses.
No headers, credentials or operator paths belong in a public proof. Provider response JSON may be reduced
to the original response text fields required for this verification, with the original full receipt retained locally.
Checksums detect changes relative to the supplied frozen hashes. They do not authenticate provider calls
or prove that a self-authored mapping is truthful; source receipt attribution remains an independent-review requirement.

The verifier checks hashes, unique run and physical call identities, complete case occurrences, raw replay,
labels and families, and stable source commit, fingerprint, model, settings and recorded decoder/frame versions within each side.
Absent decoder/frame markers mean the historical versions 1/1. Replay pins the recorded versions in
request keys and parsing, including when the current product uses newer defaults. It never rewrites cassette keys. Old and
candidate sides may name different source commits, fingerprints or settings. Candidate fingerprints must
match the shipped default. Identical outcomes or cassette bytes are valid when distinct physical receipts
prove separate recordings. Reusing one recording under several repeat names is invalid.

Old repeat 1 is the declared empirical anchor; it may differ from the historical floor recording. Its
population, judge and model must match the floor. Source and settings must agree within each side.
Receipt side and repeat ordinal must match the manifest's frozen recording plan; repeats cannot be
reordered after scoring to select a favorable old anchor. The current cassette must be
the best candidate run; the first candidate wins a correct-count tie. Replay verifies that retained cassette's
hash. Its absolute correct-count floor remains mandatory. The repeat check replaces only the historical
paired test for this invocation. Without an explicit or default repeat manifest, the historical checks remain unchanged.
Invalid supplied repeats fail instead of falling back to the historical test.

The empirical rule is fixed:

1. Count total correctness flips for every old-run pair, including losses and gains.
2. Use the maximum old-pair flip count as the empirical allowance.
3. Count each candidate's directional losses against old repeat 1; gains do not cancel losses.
4. Fail when the median candidate loss count exceeds that allowance. Equality passes.

JSON reports the old pairs, candidate losses, source identities, explicit old anchor, selected best run and cassette hash.
Both JSON and text report median correct count, observed minimum/maximum, and the empirical margin.
JSON also supplies that margin as a fraction of the case count, and exposes each side's recorded decoder/frame identity. The margin is
the old-flip allowance, separate from the observed candidate range. A selected best score is not a median.
The allowance is an empirical quantity, not a confidence interval or a claim about all future runs. The old
anchor order and number of repeats can affect the result. A noisy old judge can give a conservative allowance.

## CI and protected files

The [CI workflow](../.github/workflows/ci.yml) runs the public API check and `bench replay --slice all --check-floor` on pull requests and pushes to main. That unchanged command loads the frozen default repeat manifest when present. It makes no live model calls.

[`validate protect`](validators.md#82-the-command) rejects changes from `exec/` branches to the benchmark folders, harness entry, public API check and enforcing workflows. Maintainers change recordings and floors from a maintainer branch, with the evidence run in the commit message. Review the raw responses and measured results before committing a new floor.

The published `driftbench` CLI does not contain this repository harness. The flags and exit codes are listed below.

Gemini metering counts candidate and thinking tokens, and discounts cached input. Flash-Lite uses the standard rates of $0.30 input, $0.03 cached input and $2.50 output per million tokens. Reservations allow its [full 65,536-token output ceiling](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), so each in-flight call requires that budget headroom even though only measured usage is charged. Rates were verified on October 13, 2026 against [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Command reference

Record the shipped default judge against immutable fictional slices, replay raw responses without model calls, and enforce per-model floors. Run from the repository checkout, or supply `--root`. The slice set, source commits, recording workflow and statistical limits are described above.

```sh
pnpm bench replay [--slice <name|all>] [--model <id>] [--check-floor] [--repeat-evidence <json>] [--root <path>] [--store <file>] [--json]
pnpm bench record --model <id> --spend-cap-usd <usd> [--slice <name|all>] [--resume] [--concurrency <n>] [--spend-ledger <path>] [--root <path>] [--store <file>] [--json]
pnpm bench floors [--root <path>] [--json]
pnpm bench floors --raise <slice> <model> --evidence <json> [--root <path>] [--json]
```

| Option | Effect |
|---|---|
| `--slice <name>` | One manifest slice, or `all`, the default |
| `--model <id>` | One model. Replay defaults to all active models; record requires one |
| `--root <path>` | Repository containing `benchmarks/`; otherwise discovered from the working directory |
| `--store <file>` | Also register the exact dataset versions in the store; reject a conflicting version |
| `--check-floor` | Replay: require the absolute correct-count floor and paired regression checks |
| `--repeat-evidence <json>` | Replay: verify independent repeat files and use the empirical paired rule; requires `--check-floor` |
| `--spend-cap-usd <usd>` | Record: required positive spending cap for this invocation, including in-flight reservations |
| `--spend-ledger <path>` | Record: append call spending rows here; default `benchmarks/evidence/spend.jsonl` |
| `--concurrency <n>` | Record: parallel calls, from 1 through 16, default 4 |
| `--resume` | Record: validate and reuse completed cassettes; resume matching successful responses from partial recordings |
| `--raise <slice> <model>` | Floors: establish or raise the selected slice/model floor from current evidence |
| `--evidence <json>` | Floors: a `bench replay --json` result, an individual record evidence file, or a matching report |
| `--json` | Replay: reports, checks, problems and skips. Record: recording evidence and invocation charges. Floors: floor JSON |

Replay and floor checks make no model calls. Replay reports the correct count, Wilson interval and bootstrap over construction families. Floor checks also report exact McNemar and the automatic non-inferiority margin. A changed prompt fingerprint, dataset or client setting fails with `re-record needed`.

Recording uses the public client and retains raw responses. It checkpoints partial runs, checks recorded results against replay, and writes cassettes with measured spending evidence. `--resume` refuses stale data. Omit it for an intentional re-record; the previous completed cassette is archived by hash. A spend cap is per invocation, including after resume.

The active model ids are `haiku`, `gpt-6-luna` and `gemini-3.5-flash-lite`. Haiku is pinned to `claude-haiku-5-5` and needs an authenticated `claude` executable. OpenAI needs `OPENAI_API_KEY`; Gemini needs `GEMINI_API_KEY`. Luna and Flash-Lite use medium reasoning.

Floors validate evidence against the current cassette. The correct count cannot decrease within a dataset version. The same count can update evidence at a new fingerprint; unchanged count and fingerprint are refused. Earlier floor records remain in history.

| Exit code | When |
|---|---|
| 0 | Replay has no problems; record completes; or floors are shown or raised |
| 1 | Replay finds missing or stale recordings, integrity failures, or a failed floor |
| 2 | Bad input or dataset; record fails, reaches its cap or regresses; or a floor update is refused |
