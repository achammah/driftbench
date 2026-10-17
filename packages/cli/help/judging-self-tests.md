---
title: Judge self-tests
summary: "The four layers that test the judges themselves before their verdicts count. The layers are: fixture pairs per criterion, calibration against hand labels, the benchmark floors of the shipped judge, and the judges validator ladder. All run offline."
commands:
  - judge check
  - judge run
  - judge calibrate
  - validate
see_also:
  - judging-judge-check
  - judging-judge-run
  - judging-calibration
  - judging-bench-replay
  - judging-bench-floors
  - judging-cassettes
next:
  - judging-bench-replay
---

## What it is

A judge is a model, and a model can be wrong. driftbench trusts no judge before it passes tests of its own, at four levels:

| Layer | What it tests | Command |
|---|---|---|
| Fixture pairs | Each criterion carries a pass fixture and a fail fixture. A criterion folder is valid only when both exist and differ. A judge or council that does not separate the pair cannot be trusted on that criterion. | `driftbench judge check`, `driftbench judge run` |
| Calibration | Each judge alone must separate the pair in every repeat and agree with hand labels at kappa 0.8 or more. Only then can it own a criterion; an unowned criterion never gates. | `driftbench judge calibrate` |
| Benchmark floors | The shipped default judge, on three models, is scored on 14 fixed slices of fictional cases whose answer is known by construction. A score may never fall below its floor. | `pnpm bench replay --check-floor` |
| The judges validator | A ladder of 20 levels of code tests on the judges package itself. They cover the answer contract under hostile output, cassette replay, the client parsers and evidence quoting. They also cover the instruction screen, council majority, cascade, pairwise, calibration and scale. | `driftbench validate judges` |

All four run with no model call: the first three on committed cassettes, the validator on its own fixtures. CI runs the bench replay with `--check-floor`.

## When to use it

* After editing a criterion: `judge check`, then `judge run` on its cassette, then `judge calibrate` if it must gate.
* After changing the judges package (prompt, parser, client, council): `driftbench validate judges` and `pnpm bench replay --slice all --check-floor`.
* To see why a judge is not trusted on a criterion: read its calibration line (`misses: ...`).

## Commands and every option

Each command has its own topic with every option: `judging-judge-check`, `judging-judge-run`, `judging-judge-calibrate`, `judging-bench-replay`, `judging-bench-floors`. `driftbench validate` belongs to the validators area; for judges it is run as:

```
driftbench validate judges [--seed <n> | --seeds <a..b>] [--hidden] [--json] [--check-floor] [--items] [--all-levels] [--blind]
```

| Option | Meaning | Default |
|---|---|---|
| `--seed <n>` | A visible seed. | `1` when no seed is given |
| `--seeds <a..b>` | A range of visible seeds, such as `1..20`. | none |
| `--hidden` | Add the hidden seed derived from `git rev-parse HEAD`. | off |
| `--json` | Print the report as JSON. | off |
| `--check-floor` | Exit 1 when the run is below its floor in `validators/floors.json`, else 0. | off |
| `--items` | Also list the whole bank per family and tier, pass or fail per seed. | off |
| `--all-levels` | Compute every level and list every failing item with its level, family, tier and cause. | off |
| `--blind` | Strip every cause and `Fix:` hint from items. | off |

Without `--check-floor`, the exit code is the level reached.

## Inputs

* Criteria folders with fixture pairs, labels folders, and cassettes (see `judging-criteria`, `judging-calibration`, `judging-cassettes`).
* `benchmarks/` for the bench (see `judging-bench-replay`).
* The validator reads its banks and fixtures under `packages/validators/` and `validators/judges/` (its needs are in `validators/judges/NEEDS.md`).

## Outputs and how to read them

* `judge run`: `separated` or `NOT separated` per criterion.
* `judge calibrate`: `at the bar` or `misses: <reason>` per judge and criterion, and the assignment table.
* `pnpm bench replay --check-floor`: `floor HOLDS` or `floor FAILS` per slice and model.
* `validate judges`: one row per level with its metric, threshold and result per seed. Then `Level of the run: <k> of 20`. Then the failing items of the first failing level, each with its family, tier, source file, cause and a `Fix:` hint. The ladder stops counting at the first failing level.

## Worked example

The fixture pair layer, tested: the Acme council separates every pair.

```sh
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
```

```text
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass, fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass, fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass, fail fixture fail
separated  ledger_intact [system2]: pass fixture pass, fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail
separated  one_question_per_turn [system1]: pass fixture pass, fail fixture fail
separated  plain_language [system1]: pass fixture pass, fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass, fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
(exit 0)
```

The validator ladder runs with `driftbench validate judges --seed 1`. It reads the repository's `validators/` folder and takes minutes. Its last level measures speed, so its exit code depends on the machine. Its output and options are in the validators area of this help.

Levels 1 to 19 pass. Level 20 measures speed on a 100000-entry prompt against a 6000 ms budget, so its result depends on the machine; here it took 6249 ms. The run took about five minutes.

The floor layer is shown in `judging-bench-replay`.

## Common errors

* `NOT separated` in `judge run`. The council cannot tell the pass fixture from the fail fixture. Read the round log under the line; sharpen the rubric or the pictures, or check that the cassette holds recordings for these requests.
* `misses: separates the fixture pair 2 of 3 times` in `judge calibrate`. The judge is unstable on that criterion; it cannot own it.
* `floor FAILS` in `pnpm bench replay --check-floor` (exit 1). A judges change lost accuracy, or the recordings are stale (`re-record needed`).
* A validator level that fails (exit code below 20). Read the listed items; each names the source file, the cause and a fix. A speed level can fail on a slow or busy machine: run it again before acting.
