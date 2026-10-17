---
title: bench floors
summary: Show the per slice and per model accuracy floors of the judge benchmark, or raise one floor from current replay evidence. The floors are what bench replay --check-floor enforces.
commands: []
see_also:
  - judging-bench-replay
  - judging-bench-record
  - judging-self-tests
---

## What it is

A floor is the lowest accepted result of the shipped default judge on one benchmark slice version and one model. `benchmarks/floors.json` holds one floor per key `<slice>@<version>/<model>`, plus a `history` of earlier floors. Each floor stores the correct count, the case count, the Wilson lower bound, the prompt fingerprint, the commit, every case result and an evidence hash.

`pnpm bench floors` prints that file. With `--raise`, it sets or raises one floor from evidence: the evidence must match a fresh replay of the committed cassette. Within one dataset version the correct count can never fall. `pnpm bench replay --check-floor` then enforces the floor. It is a repository script, not part of the published `driftbench` command.

## When to use it

* To read the current floors, with no option.
* To set the first floor of a new slice or model, or to raise a floor after a better recording, with `--raise`.
* To accept the same count after a prompt fingerprint change, with `--raise`: an equal count is accepted at a new fingerprint.
* To check results against the floors, use `pnpm bench replay --check-floor`.

## Commands and every option

```
pnpm bench floors [--root <path>] [--json]
pnpm bench floors --raise <slice> <model> --evidence <json> [--root <path>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `[model]` | Argument, needed with `--raise`: the model id whose floor rises. | none |
| `--raise <slice>` | The slice whose floor is set or raised. Needs the model argument and `--evidence`. | none |
| `--evidence <json>` | The evidence file: the output of `pnpm bench replay --json`, a record evidence file from `benchmarks/evidence/`, or one matching report. | none |
| `--root <path>` | The repository folder that holds `benchmarks/`. | found from the current folder |
| `--json` | With `--raise`, print the new floor as JSON instead of one line. Without `--raise` the file is always printed as JSON. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | The floors are printed, or the floor is raised. |
| 2 | Bad input, or the raise is refused. Causes: a missing argument, or evidence that names no matching slice and model. Other causes: evidence that differs from the current replay, or a count below the floor. Other causes: a paired regression, or an unchanged count at an unchanged fingerprint. |

## Inputs

* `benchmarks/floors.json`: `version: 1`, `floors` (a map from `<slice>@<version>/<model>` to a floor) and `history` (earlier floors). A missing file reads as empty.
* With `--raise`: the evidence file, the manifest, the slice, and the committed cassette and evidence of that slice and model. The cassette and evidence are replayed to check the evidence.

The rules of a raise, from source:

* The evidence report's results, dataset version and hash, model and client settings must equal the current replay. Its commit must equal the replay's commit or the recording's commit. A record evidence file must also carry the current cassette's SHA-256.
* A dataset version can only rise.
* Within one dataset version, the new result must pass the floor check (count at least the floor, no paired regression). An equal count is refused unless the fingerprint changed.
* The previous floor moves to `history`.

## Outputs and how to read them

* Without `--raise`: the whole `floors.json` as JSON on stdout.
* With `--raise`: `Floor <slice>@<version>/<model>: <correct>/<n>; evidence <sha256>`, or the floor as JSON with `--json`. The command rewrites `benchmarks/floors.json`.
* Errors print as `bench floors: <message>` on stderr.

## Worked example

The help test runs only `driftbench` commands. The bench is a repository script, so the tested line here validates the criteria folder the judge prompt is built from. The bench runs themselves follow.

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

On a copy of `benchmarks/` under `out/`, with the haiku floor of `fresh-reference` removed, so no tracked file changes. The check fails without a floor, the replay evidence raises it, a second raise with the same evidence is refused, and the check then holds:

Not run by the help test: the bench reads git (the commit each report records) and the repository's `benchmarks/` folder. The help test's scratch folder does not link that folder. From a repository checkout:

```text
$ mkdir -p out/judging/benchroot && cp -R benchmarks out/judging/benchroot/
$ python3 -c "import json; p='out/judging/benchroot/benchmarks/floors.json'; f=json.load(open(p)); del f['floors']['fresh-reference@1/haiku']; json.dump(f, open(p, 'w'), indent=2)"
$ pnpm -s bench replay --root out/judging/benchroot --slice fresh-reference --model haiku --check-floor
fresh-reference@1 / haiku: 189/192; Wilson [95.51, 99.47]%; family bootstrap [95.31, 100.00]%; floor FAILS
  No floor for fresh-reference/haiku
Skipped gemini-3.8-flash: dropped by the owner
(exit 1)
$ pnpm -s bench replay --root out/judging/benchroot --slice fresh-reference --model haiku --json > out/judging/replay.json
(exit 0)
$ pnpm -s bench floors --root out/judging/benchroot --raise fresh-reference haiku --evidence out/judging/replay.json
Floor fresh-reference@1/haiku: 189/192; evidence 8a7366817389094740db1e24656b7ac7d4e06eeab8684cc0cf8920386a8fc971
(exit 0)
$ pnpm -s bench floors --root out/judging/benchroot --raise fresh-reference haiku --evidence out/judging/replay.json
bench floors: The floor only rises within a dataset version
(exit 2)
$ pnpm -s bench replay --root out/judging/benchroot --slice fresh-reference --model haiku --check-floor
fresh-reference@1 / haiku: 189/192; Wilson [95.51, 99.47]%; family bootstrap [95.31, 100.00]%; floor HOLDS
  Paired: McNemar p=1.000000, auto margin 2.5%; difference bootstrap [0.00, 0.00]%
Skipped gemini-3.8-flash: dropped by the owner
(exit 0)
```

The evidence hash differs from run to run, because the replay report records its start and end times.

## Common errors

* `bench floors: --raise requires <slice> <model> --evidence <json>` (exit 2). Give the slice to `--raise`, the model as the argument, and the evidence file.
* `bench floors: Evidence names no matching slice/model` (exit 2). The evidence file holds no report for that slice and model. Replay that slice and model with `--json`.
* `bench floors: Evidence differs from the current cassette replay` (exit 2). The evidence is from another cassette, dataset or setting. Produce it again with `pnpm bench replay --json` on the current checkout.
* `bench floors: The floor only rises within a dataset version` (exit 2). The count and the fingerprint are both unchanged: there is nothing to raise.
* `bench floors: <c>/<n> is below the floor <f>/<n>` or `bench floors: Paired regression: <reason>` (exit 2). The evidence is worse than the floor; a floor never falls within a dataset version.
* `bench floors: Dataset versions only rise` (exit 2). The evidence is for an older dataset version than the floor.
