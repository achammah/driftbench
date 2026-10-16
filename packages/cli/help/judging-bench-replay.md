---
title: bench replay
summary: Replay the committed judge benchmark recordings with no network and no key. Score the shipped default judge on each slice. With --check-floor, fail when a score drops below its floor. Use it to prove a judge change did not lose accuracy.
commands: []
see_also:
  - judging-bench-record
  - judging-bench-floors
  - judging-default-judge
  - judging-cassettes
  - judging-self-tests
next:
  - judging-bench-record
---

## What it is

`pnpm bench replay` is a repository script, not part of the published `driftbench` command. It reads `benchmarks/manifest.json`. It loads each benchmark slice (a fixed set of fictional cases whose right answer, pass or fail, is known by construction). It feeds the raw model answers recorded in `benchmarks/cassettes/<slice>@<version>/<model>.json` through the current public judge parser. It prints how many cases the judge got right, with a Wilson interval and a bootstrap interval over construction families. It makes no model call and needs no credential.

A recording is refused as stale, with `re-record needed`. This happens when the dataset hash, the prompt fingerprint, the client settings or the cassette hash no longer match what was recorded. A stale recording can never pass on its old score.

## When to use it

* After any change to the judges package (prompt, parser, client settings), run `pnpm bench replay --slice all --check-floor`. CI runs exactly this on every pull request and push to main.
* To read the score of one model on one slice, with `--slice` and `--model`.
* To produce the evidence for raising a floor, with `--json` (see `judging-bench-floors`).
* To record new answers from a live model, use `pnpm bench record` instead (paid; see `judging-bench-record`).
* To measure judges on your own criteria and labels, use `driftbench judge calibrate`: the bench measures the shipped default judge on its own slices only.

## Commands and every option

Run from a checkout of the driftbench repository.

```
pnpm bench replay [--slice <name|all>] [--model <id>] [--check-floor] [--root <path>] [--store <file>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `--slice <name>` | One slice named in the manifest, or `all`. | `all` |
| `--model <id>` | One model id from the manifest. Without it, every model whose status is `active`. A model with status `skipped` is refused. | every active model |
| `--check-floor` | Also check each result against its floor in `benchmarks/floors.json`. The correct count must reach the floor. A paired comparison with the floor's results must show no regression (exact two-sided McNemar at 0.05, and an automatic non-inferiority margin). | off |
| `--root <path>` | The repository folder that holds `benchmarks/`. | found from the current folder |
| `--store <file>` | Also register the exact dataset version of each slice in this dataset store, and refuse a version that conflicts with the manifest. | none |
| `--json` | Print one JSON document instead of text. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | Every selected recording replayed and, with `--check-floor`, every floor holds. |
| 1 | A recording is missing or stale (`re-record needed`), fails its integrity check, or, with `--check-floor`, a floor fails or is missing. |
| 2 | Bad input: an unknown slice or model, a skipped model, an invalid manifest, or a slice whose dataset hash or case count changed. |

## Inputs

* `benchmarks/manifest.json` holds `version: 1`, `models` and `slices`. Each model has `id`, `model`, `status` `active` or `skipped`, and `reason` when skipped. Each slice has `name`, `version`, `hash`, `path` = `benchmarks/slices/<name>/<version>`, `n` cases and `sourceCommit`. On main the active models are `haiku` (`claude-haiku-5-5`), `gpt-6-luna` and `gemini-3.5-flash-lite`; `gemini-3.8-flash` is skipped. There are 14 slices in all. The first four are `fresh-rubric` 192, `fresh-reference` 192, `map-rubric` 156 and `map-reference` 180. The slices `hard-rubric`, `hard-factuality`, `hard-pii` and `hard-goal` have 120 each. The slices `heldout-rubric`, `heldout-factuality`, `heldout-pii` and `heldout-goal` have 72 each. The slice `planted-verify` has 190. The slice `planted-rubric` has 120.
* `benchmarks/slices/<name>/<version>/`: `cases.spec.json` (a valid conversation spec whose `metadata.bench` holds the cases: id, construction family, expected pass or fail, and the judge request), `source.json` and `provenance.json`. The folder's content hash must equal the manifest `hash`.
* `benchmarks/cassettes/<slice>@<version>/<model>.json`: the raw recorded answers.
* `benchmarks/evidence/<slice>@<version>/<model>.json`: the record evidence, with the cassette's SHA-256; replay checks it.
* `benchmarks/floors.json`, read with `--check-floor`.

Only the judge request of a case reaches the judge: `criterion`, `transcript`, `inputs`, `reference`, `artifact` and `given`. The expected answer and the family stay outside it.

## Outputs and how to read them

Text output, per slice and model:

```
<slice>@<version> / <model>: <correct>/<n>; Wilson [<low>, <high>]%; family bootstrap [<low>, <high>]%; floor HOLDS
  Paired: McNemar p=<p>, auto margin <m>%; difference bootstrap [<low>, <high>]%
```

* `<correct>/<n>` counts the cases where the judge's verdict equals the expected one. An inconclusive verdict is not correct.
* The Wilson interval is the 95% interval on the share correct. The family bootstrap resamples whole construction families, since cases of one family are related.
* `floor HOLDS` or `floor FAILS` and the `Paired:` line appear only with `--check-floor`. On a failure, each problem follows on stderr. Examples are `No floor for <slice>/<model>`, `<c>/<n> is below the floor <f>/<n>`, `Paired regression: <reason>` or `re-record needed: stale fingerprint`.
* `Zero failures: a <5% claim needs <k> independent clean cases; construction families can be dependent.` appears when every case is correct.
* `Skipped <model>: <reason>` lists every skipped model of the manifest, whatever `--model` says.

With `--json`, one object: `format` (`driftbench-bench-replay-v1`), `reports`, `checks`, `problems` and `skipped`. Each report has `format`, `slice`, `datasetVersion`, `datasetHash`, `judge`, `model`, `settings`, `fingerprint`, `head`, `startedAt`, `finishedAt`, `n` and `correct`. It also has `wilson` (`estimate`, `lower`, `upper`), `familyBootstrap`, `zeroFailure` and `results` (each `id`, `family`, `expected`, `outcome`, `correct`). Each check has `slice`, `model`, `holds`, `problems` and `paired`.

Replay writes nothing, except that `--store` adds dataset versions to the store.

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

Replay the committed haiku recording of one slice and check its floor:

Not run by the help test. The bench reads git (the commit each report records) and the repository's `benchmarks/` folder, which the help test's scratch folder does not link. From a repository checkout:

```text
$ pnpm -s bench replay --slice fresh-reference --model haiku --check-floor
fresh-reference@1 / haiku: 189/192; Wilson [95.51, 99.47]%; family bootstrap [95.31, 100.00]%; floor HOLDS
  Paired: McNemar p=1.000000, auto margin 2.5%; difference bootstrap [0.00, 0.00]%
Skipped gemini-3.8-flash: dropped by the owner
(exit 0)
```

The shipped judge on haiku gets 189 of 192 cases right. The floor holds: the count equals the floor, and the paired comparison shows no case changed.

## Common errors

* `bench: Unknown slice nope` (exit 2). The slice is not in the manifest. Use a name from `benchmarks/manifest.json`, or `all`.
* `bench: Unknown model nope` (exit 2). Use a model id from the manifest.
* `bench: gemini-3.8-flash skipped: dropped by the owner` (exit 2). The model is skipped in the manifest; it has no recordings to replay.
* `re-record needed: <slice>/<model>: cassette integrity mismatch`, `... client settings changed`, `... incomplete or non-raw default cassette` or `... evidence is stale` (exit 1). The prompt, the parser's inputs, the client settings or the dataset changed since the recording. A maintainer records again with `pnpm bench record` (paid).
* `No floor for <slice>/<model>` with `floor FAILS` (exit 1). `--check-floor` found no floor for that slice and model. Establish one with `pnpm bench floors --raise`.
* `bench: <slice>: dataset hash changed; create a new dataset version` (exit 2). A file under the slice folder changed. Slices are immutable: add a new version instead of editing one.
