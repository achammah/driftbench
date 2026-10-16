---
title: Judging, the map
summary: "How driftbench decides whether a block passes: machine checks first, judged criteria beside them, judges that earn their place by calibration. This topic lists every judging command and topic and says which to read for each question."
commands:
  - judge check
  - judge run
  - judge calibrate
see_also:
  - judging-machine-checks
  - judging-criteria
  - judging-council
  - judging-calibration
  - judging-default-judge
  - judging-self-tests
  - judging-queue
next:
  - judging-machine-checks
---

## What it is

Every block of a spec gets verdicts of two kinds, reported side by side:

* Machine checks: deterministic code on what the agent said and did. A machine fail is final.
* Judged criteria: a model reads the block against a rubric and answers pass, fail or inconclusive. An inconclusive verdict is never counted as a pass.

A block passes only when every gating verdict passes, so a judge can never turn a machine fail into a pass. Judges themselves are tested: each criterion has a fixture pair to separate and hand labels to agree with. Calibration seats a class on a criterion only when three of its judges meet the bar, and leaves the criterion unassigned (judged, never gating) otherwise. In hybrid mode the re-judge row of the other class takes its judges at the bar first, then its cheapest others. As a result, a re-judge may be below the bar. Without an assignment table, the council seats the cheapest judges of the class, calibrated or not.

## When to use it

Pick the topic by question:

| Question | Topic |
|---|---|
| What checks run, what ids and gating rules apply | `judging-machine-checks` |
| Checks on the reply text (must, regex, length, lang, json, pii...) | `judging-check-text` |
| Checks on tool calls (tools, order, forbidden, schemas, sql) | `judging-check-tools` |
| Checks on stages, skills, guards, files, code, safety, budget, end state | `judging-check-runtime` |
| How to write a criterion, fixtures and labels | `judging-criteria` |
| Collect hand labels with several reviewers | `judging-queue` |
| Validate a criteria folder | `judging-judge-check` |
| Replay a council on fixture pairs | `judging-judge-run` |
| Choose which judges own which criterion | `judging-judge-calibrate`, `judging-calibration` |
| How several judges vote | `judging-council` |
| Route items to the right judge (Mixture of Judges) | `judging-mixture-of-judges` |
| Which model families may judge which agent | `judging-families` |
| What a judge call sends and how its answer is read | `judging-default-judge` |
| How evidence quotes are checked | `judging-evidence` |
| Settings that are off by default | `judging-opt-in-settings` |
| Comparing two replies | `judging-pairwise` |
| Recorded answers and replay | `judging-cassettes` |
| Judging the criteria of a real run (`replay`, `estate run`) | `judging-run-judge` |
| How the judges are tested | `judging-self-tests` |
| The judge benchmark and its floors | `judging-bench-replay`, `judging-bench-record`, `judging-bench-floors` |

## Commands and every option

| Command | Purpose | Model calls |
|---|---|---|
| `driftbench judge check <criteria> [--json]` | Validate a criteria folder. | none |
| `driftbench judge run --criteria <dir> --cassette <file> [--mode] [--agent-family] [--cascade] [--assignments] [--json]` | Replay a council over every fixture pair. | none |
| `driftbench judge calibrate --criteria <dir> --labels <dir> --out <file> (--cassette <file> \| --claude <model>) [...]` | Test each judge and write the assignment table. | only with `--claude` (billed) |
| `driftbench replay ... --judge claude:<model> [--judge-command] [--judge-budget]` | Judge criteria of recorded sessions. | yes, unless the command is a stand-in |
| `driftbench estate run ... --judge claude:<model> [--judge-command] [--judge-budget]` | Judge criteria of a live estate run. | yes, unless the command is a stand-in |
| `driftbench queue create\|list\|assign\|vote\|agreement` | Manage the review queue of blocks to label. | none |
| `driftbench compare --pairwise <criterion.yaml> [--pairwise-judge] [--pairwise-reference]` | Compare two campaigns reply by reply. | yes (billed) |
| `pnpm bench replay`, `pnpm bench floors` | Score the shipped judge on fixed slices from recordings; manage floors. Repository script, not in the published CLI. | none |
| `pnpm bench record --model <id> --spend-cap-usd <usd>` | Record the benchmark with a live model. Repository script. | yes (billed, capped) |

Every option of each command is in its topic.

## Inputs

* Specs whose blocks set `expect` fields and name `criteria`.
* Criteria folders (one file per criterion, with a fixture pair) and labels folders (hand-labelled blocks).
* Cassettes of recorded judge answers, and assignment tables written by calibration.

## Outputs and how to read them

* A verdict has an id that starts with its check (`must.0`, `tools.order`, `judge.no_invented_data`), an outcome, a gating flag and its evidence.
* `judge run` prints `separated` or `NOT separated` per criterion. `judge calibrate` prints `at the bar` or `misses: ...` per judge and writes who owns each criterion.
* Run commands list failing verdict ids per block; `--json` holds every verdict with its evidence.

## Worked example

The judge commands, as the CLI lists them:

```sh
driftbench judge --help
```

```text
$ driftbench judge --help
Usage: driftbench judge [options] [command]

Judge criteria with the council: replay recorded answers, or validate criteria
and fixtures

Options:
  -h, --help                  display help for command

Commands:
  run [options]               Replay a council on a cassette over every fixture
                              pair, and report the criteria it separates
  calibrate [options]         Run every judge on the fixture pairs and the
                              hand-labelled blocks, and write which judge owns
                              each criterion
  check [options] <criteria>  Validate a criteria folder: each criterion, its
                              FAIL and PASS pictures, its fixture pair
  help [command]              display help for command
(exit 0)
```

A first session, all offline, has three steps. First: `pnpm -s driftbench judge check examples/acme/criteria`. Then: `pnpm -s driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json`. Then: `pnpm -s driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --out out/assignments.yaml`. Their outputs are in `judging-judge-check`, `judging-judge-run` and `judging-judge-calibrate`.

## Common errors

* Expecting `campaign run` to judge criteria. It loads no judge and prints `Not judged:`; criteria count in no pass or fail. Use `replay --judge` or `estate run --judge`, or a council in code.
* Trusting a judge before calibration. Separate the fixture pairs and reach kappa 0.8 on labels first.
* A judge of the agent's own model family. The council refuses it (see `judging-families`).
* Reading scripted cassettes as accuracy. The Acme council cassettes are scripted by hand: they prove mechanics, not a real model's accuracy. The benchmark floors and real recordings measure that.
