---
title: bench record
summary: Record the shipped default judge on the benchmark slices with a live model, under a required USD spend cap. Write the cassettes and evidence that bench replay checks. This is a maintainer action that costs money.
commands: []
see_also:
  - judging-bench-replay
  - judging-bench-floors
  - judging-cassettes
  - judging-default-judge
next:
  - judging-bench-floors
---

## What it is

`pnpm bench record` is a repository script, not part of the published `driftbench` command. For one model, it sends every case of the selected benchmark slices to the shipped default judge on that live model. It keeps the raw answers as a cassette. It writes evidence: the score report, the cassette's SHA-256, the resolved model names, and the measured and charged spend of every call. Before it accepts a recording, it replays the new cassette and checks that the replay gives exactly the recorded results.

Every call is billed by the provider. The spend cap is required and covers this invocation only, calls in flight included.

## When to use it

* After a change that makes `pnpm bench replay` say `re-record needed` (a new prompt fingerprint, new client settings, or a new dataset version). Do it only with an approved budget.
* To add a model to the benchmark, after a maintainer adds it to `benchmarks/manifest.json` as `active`.
* To finish an interrupted recording, with `--resume`.
* To check a score without spending, use `pnpm bench replay`: it reads the committed recordings.

## Commands and every option

Run from a checkout of the driftbench repository.

```
pnpm bench record --model <id> --spend-cap-usd <usd> [--slice <name|all>] [--resume] [--concurrency <n>] [--spend-ledger <path>] [--root <path>] [--store <file>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `--spend-cap-usd <usd>` | Required. The most this invocation may charge, in US dollars, counting reservations for calls in flight. Must be a finite positive number. | none |
| `--model <id>` | Required in practice: record takes exactly one model. Without it, every active model is selected and the command refuses. | none |
| `--slice <name>` | One slice of the manifest, or `all`. | `all` |
| `--resume` | Reuse a completed recording after checking it by replay, and continue a partial recording: matching successful answers are replayed, only missing ones are requested. Refuses stale partial data. | off |
| `--concurrency <n>` | Parallel calls, a whole number from 1 to 16. The first live request completes before concurrent recording starts. | `4` |
| `--spend-ledger <path>` | Append one JSON line per metered call to this file. | `benchmarks/evidence/spend.jsonl` |
| `--root <path>` | The repository folder that holds `benchmarks/`. | found from the current folder |
| `--store <file>` | Also register the exact dataset version of each slice in this dataset store, and refuse a conflicting version. | none |
| `--json` | Print `{ records, chargedUsd }`: every record evidence and the invocation's charge. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | Every selected slice was recorded, or reused with `--resume`, and no recording regresses against its floor. |
| 2 | Bad input, a failed or capped recording, a recording whose replay differs from its results, or a regression against the floor. The new cassette and evidence are still written on a regression, so it can be diagnosed; replay stays red. |

## Inputs

* The same manifest, slices and floors as `pnpm bench replay` (see `judging-bench-replay`).
* Credentials, from the environment only: `haiku` runs the local `claude` command, which must be installed and signed in; `gpt-6-luna` needs `OPENAI_API_KEY`; `gemini-3.5-flash-lite` needs `GEMINI_API_KEY`.
* The environment must not set `OPENAI_BASE_URL`, `OPENAI_JUDGE_MODEL`, `CLAUDE_JUDGE_MODEL`, `GOOGLE_BASE_URL` or `GOOGLE_JUDGE_MODEL`: a default bench recording refuses any override.
* With `--resume`: the partial files `<cassette>.partial.json` and `<evidence>.partial.json` from an earlier run.

## Outputs and how to read them

Files written, per slice and model:

| File | Content |
|---|---|
| `benchmarks/cassettes/<slice>@<version>/<model>.json` | The raw answers and the client identity. |
| `benchmarks/evidence/<slice>@<version>/<model>.json` | Format `driftbench-bench-record-v1`: `report`, `cassetteSha256`, `resolvedModels`, `costUsd`, `chargedUsd`, `calls`, `spend`. |
| `benchmarks/evidence/spend.jsonl`, or `--spend-ledger` | One JSON line per call: `lane` (`bench-frame`), `slice`, `datasetVersion`, `fingerprint`, `at`, `model`, `resolvedModel`. Also `costUsd`, `chargedUsd`, `accounting` (`provider`, `tokens` or `reserved-on-error`), `status` (`ok` or `error`), and token counts when known. |
| `benchmarks/cassettes/history/<sha256>.json` | Without `--resume`, the previous completed cassette, kept by content hash before it is replaced. |

Partial files are written after each completed call and removed when the slice completes.

Text output per slice: the replay score line (see `judging-bench-replay`), then `  Recorded $<cost>; invocation charged $<charge>`. A reused slice prints `Reused <slice>/<model>`. Errors print as `bench record: <message>`.

## Worked example

The help test runs only `driftbench` commands. The bench is a repository script. The tested line here therefore validates the criteria folder the judge prompt is built from. The bench run itself follows.

```sh
driftbench judge check examples/acme/criteria
```

```text
$ driftbench judge check examples/acme/criteria
ok  care_redirect [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)
ok  checks_before_promising [system1, gating]: pass fixture 4 line(s), fail fixture 2 line(s)
ok  coverage_before_offer [system1, gating]: pass fixture 6 line(s), fail fixture 4 line(s)
ok  explicit_confirmation [system1, gating]: pass fixture 7 line(s), fail fixture 5 line(s)
ok  holds_instructions [system1, gating]: pass fixture 3 line(s), fail fixture 3 line(s)
ok  honest_failure [system2, gating]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  ledger_intact [system2]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  no_invented_data [system2, gating]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  one_question_per_turn [system1]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  plain_language [system1]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  resumes_pending_step [system1, gating]: pass fixture 3 line(s), fail fixture 3 line(s)
ok  sheet_matches_catalog [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)

12 valid criteria, 0 issue(s).
(exit 0)
```

A spend-free run: with `--resume` on a slice whose recording is already complete, the command checks the recording by replay. The command reuses it without any model call. It runs here on a copy of `benchmarks/` under `out/`, so no tracked file changes (the command creates an empty spend ledger in the copy):

Not run by the help test. The bench reads git (the commit each report records) and the repository's `benchmarks/` folder. A real recording calls a paid model. From a repository checkout:

```text
$ mkdir -p out/judging/benchroot && cp -R benchmarks out/judging/benchroot/
$ pnpm -s bench record --root out/judging/benchroot --slice fresh-reference --model haiku --spend-cap-usd 0.01 --resume
Reused fresh-reference/haiku
(exit 0)
```

A real recording replaces `--resume` with a fresh run and an approved cap, for example `pnpm bench record --slice fresh-rubric --model haiku --spend-cap-usd <approved-cap>`. That makes billed calls, so it is not shown here.

## Common errors

* `error: required option '--spend-cap-usd <usd>' not specified` (exit 2). Every recording needs a cap.
* `bench record: record requires one --model` (exit 2). Name one model with `--model`.
* `bench record: --concurrency must be 1..16` (exit 2).
* `bench record: spend cap must be a finite positive USD amount` (exit 2). The cap was 0, negative or not a number.
* `bench record: <KEY> override is not allowed in a default bench recording` (exit 2). Unset that environment variable; the bench records the shipped default client only.
* `bench record: spend cap reached: $<spent> spent, $<held> in flight, $<needed> needed` (exit 2). The cap is reached. Raise the cap with approval, and continue with `--resume`; a resumed run needs its own cap.
* `bench record: re-record needed: partial recording is stale` (exit 2). The partial files were made with another prompt, dataset or model. Run again without `--resume`.
* `bench record: Recorded and replayed scores differ` (exit 2). The new cassette does not replay to the recorded results; nothing is accepted. Investigate the parser or the client before recording again.
* `bench record: <slice>/<model>: re-record regresses against the floor` (exit 2). The new score falls below the floor. The cassette and evidence are written for diagnosis; `pnpm bench replay --check-floor` stays red until the cause is fixed.
