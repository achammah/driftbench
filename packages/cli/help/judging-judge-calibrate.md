---
title: judge calibrate
summary: Test every judge alone on the fixture pairs and the hand labels of each criterion. Write the assignment table that says which judges own which criterion. It replays a cassette for free, or calls the local claude command (billed) with --claude.
commands:
  - judge calibrate
see_also:
  - judging-calibration
  - judging-criteria
  - judging-judge-run
  - judging-cassettes
  - judging-council
  - judging-families
next:
  - judging-queue
---

## What it is

`driftbench judge calibrate` runs each judge on its own, never as a council, over two tests per criterion:

* The fixture pair: the judge answers the pass fixture and the fail fixture `--repeats` times. Its separation is the number of repeats in which the pass fixture passed and the fail fixture failed.
* The hand labels: the judge answers every labelled block once. Its agreement with the labels is Cohen's kappa, with a Wilson 95% interval on the share it agrees on.

A judge is at the bar for a criterion when it separates the pair in every repeat and its kappa is at least 0.8. The command then assigns each criterion to judges at the bar and writes the assignment table (YAML). A criterion no class can take stays unassigned: it is still judged, but its verdict never gates. With `--cascade`, it measures a cascade of judges instead and writes a JSON report.

The judges come from a cassette (recorded answers, free) and from `--claude <model>` (the local `claude` command, one billed call per answer).

## When to use it

* Before trusting a judge on a criterion: assignments are earned, never assumed.
* After a rubric, a fixture or the labels change, the request key changes. The old recordings no longer match. The criterion needs recording and calibrating again.
* To find the cheapest single judge that is good enough, with `--assign cheapest`.
* To measure whether costly judges fix a cheap judge's mistakes, with `--cascade`.
* To replay a council on a table it wrote, use `judge run --assignments`. To validate the criteria files first, use `judge check`.

## Commands and every option

```
driftbench judge calibrate --criteria <dir> --labels <dir> --out <file> (--cassette <file> | --claude <model> ...) [--claude-command <path>] [--record <file>] [--spend-cap-usd <usd>] [--cascade] [--assign <rule>] [--only <criterion> ...] [--repeats <n>] [--mode <mode>] [--agent-family <family>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `--criteria <dir>` | Required. The criteria folder, with a fixture pair per criterion. | none |
| `--labels <dir>` | Required. The labels folder: one YAML file of hand-labelled blocks per criterion. | none |
| `--out <file>` | Required. Where to write the assignment table (YAML), or the cascade report (JSON) with `--cascade`. | none |
| `--cassette <file>` | The recorded answers of every judge. Each judge in the cassette is calibrated. Needed unless `--claude` is given. | none |
| `--claude <model>` | Add a live judge on the local `claude` command with this model, such as `haiku`. Repeat for several. Every call is billed to the account the command is signed in to. | none |
| `--claude-command <path>` | The `claude` command to run for `--claude` judges. | `claude` |
| `--record <file>` | Save every live answer, with its cost, as a cassette to replay later. | none |
| `--spend-cap-usd <usd>` | Stop calling live judges once their calls have cost this much in all. Later calls give no answer. A positive number. | no cap |
| `--cascade` | The first judge answers everything. The others answer an item in two cases only. The first judge is unsure of it (inconclusive, or a score between 0.2 and 0.8). Or the first judge disagrees with the truth (the fixture's side or the label). Writes the cascade report as JSON to `--out`. Needs at least two judges. With `--cascade`, `--mode`, `--assign` and `--agent-family` are not used. | off |
| `--assign <rule>` | `council`: three judges at the bar in one class own the criterion, the cheapest first. `cheapest`: the one cheapest judge at the bar owns it alone. | `council` |
| `--only <criterion>` | Calibrate only this criterion. Repeat for several. | every criterion |
| `--repeats <n>` | How many times each judge answers each fixture. A whole number from 1. | `3` |
| `--mode <mode>` | The council mode the table is for: `system1`, `hybrid` or `llm`. | `hybrid` |
| `--agent-family <family>` | The model family of the agent under test. A judge of that family is left out of calibration, and the report names it. `none` for an agent that is not a model. | `none` |
| `--json` | Print the report as one JSON document. | off |

The judge order matters for `--cascade`: the cassette's judges come first, in cassette order, then the `--claude` judges in the order given. The first judge is the one that answers everything.

Exit codes:

| Code | When |
|---|---|
| 0 | The table is written and every gating criterion is assigned. With `--cascade`: the report is written and every call gave an answer. |
| 1 | The table is written, but a criterion declared gating stays unassigned, or a judge call gave no answer. With `--cascade`: a call gave no answer. |
| 2 | Bad input: a missing option, or a bad `--repeats`, `--mode`, `--assign` or `--spend-cap-usd`. It is also issues in the criteria or labels, or labels for an unknown criterion. It is also an `--only` that names no criterion, a cassette that cannot be read, or `--cascade` with fewer than two judges. |

## Inputs

* The criteria folder: see `judging-judge-check` for every key.
* The labels folder: one YAML file per criterion, named after it, with `criterion` (the name), optional `labelled_by`, and `blocks` (at least one). A block has `id`, `label` (`pass` or `fail`), a `transcript`, and optional `note`, `artifact`, `inputs`, `given` and `anchor`, the same as a fixture. A block without `inputs` reads those of the criterion's pass fixture. See `judging-calibration` for anchors and the label rules.
* The cassette, when given (see `judging-cassettes`).
* For `--claude`: the local `claude` command, signed in. It needs no API key.

## Outputs and how to read them

Text output, per criterion:

```
<criterion> [gating]: owned by <owner> (<class>: <j1>, <j2>, <j3>; re-judge <r1>, <r2>, <r3>) [single family: <family>]
    <judge>  <class>  separation <k>/<n>  kappa <kappa>  agreement <a>/<b> [<low>, <high>]  at the bar
    <judge>  <class>  separation <k>/<n>  kappa <kappa>  agreement <a>/<b> [<low>, <high>]  misses: <reason>
    alpha across judges <alpha>; bar: <n>/<n> separation and kappa 0.8
```

* With `--assign cheapest`, the head reads `owned by <owner> alone (<class>), <cost> USD per call` when the client reports a cost.
* An unassigned criterion reads `<criterion> [gating]: UNASSIGNED, judged but not gating: <reason>`.
* `[single family: <family>]` marks a row whose judges all share one model family: weaker evidence than judges across families.
* `alpha` is Krippendorff's alpha across the judges, over the fixtures and the labelled blocks.

Then the summary lines:

* `Kappa over every labelled block: <judge> <kappa> (<agree>/<n>), ...`
* `Left out, same family as the agent: <judges>.` when `--agent-family` excluded judges.
* `<a> of <m> criteria assigned in mode <mode> (<n> repeats, kappa at least 0.8).` is printed. Then `Unassigned, judged but never gating: <criteria>.`, `<k> judge call(s) gave no answer.` and `Spent <usd> USD.` appear when they apply. On a replay, the spend is the cost recorded in the cassette, not new spend.
* `Wrote <table>[ and <record>].`

The table written to `--out` has `version: 1`, `mode`, `repeats`, `kappa_min`, `rule: cheapest` when used, and `criteria`. An assigned entry has `criterion`, `status: assigned`, `owner`, `class`, `judges`, `rejudge`, optional `single_family`, optional `cost_per_call_usd`, `separation` (`k of n`) and `kappa`. An unassigned entry has `criterion`, `status: unassigned` and `reason`.

With `--json`, the calibration report has `mode`, `repeats`, `kappaMin`, `rule`, `criteria`, `pooled`, `excluded`, `errors`, `spentUsd`, and `table` (the path written). Per criterion, `criteria` holds `gating`. It holds `judges` with separation, label agreement, kappa, PABAK, AC1, confusion metrics, per block answers and anchors, calls, cost, `meetsBar` and `misses`. It holds `alpha`. It holds the label hygiene fields `labelConflicts`, `fixtureLeaks` and `warnings`. It holds `assignment`.

With `--cascade`, text output:

```
Cascade: <first> answers everything; <others> answer where it is unsure or disagrees with the label.
<criterion>: separation <k>/<n>, kappa <kappa> (<a>/<b>), <usd> USD; escalated: <item (why)> or none
    unsure only: separation <k>/<n>, kappa <kappa> (<a>/<b>), <usd> USD
```

`unsure only` is the same run scored as a deployed cascade could: escalating only unsure items, since a run has no label. The JSON report at `--out` has `first`, `escalateTo`, `repeats`, `criteria` and `spentUsd`.

## Worked example

Calibrate the 12 Acme criteria on the scripted calibration cassette (six judges, no model call). The first and last lines:

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --out assignments.yaml
```

```text
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --out assignments.yaml
care_redirect [gating]: owned by s1p-a (system1: s1p-a, s1p-b, openai-decisions; re-judge google-chat, openai-chat, anthropic-chat)
    s1p-a              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    s1p-b              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    openai-decisions   system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    openai-chat        system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    google-chat        system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    anthropic-chat     system2  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    alpha across judges 1.00; bar: 3/3 separation and kappa 0.8
(88 more lines)
Kappa over every labelled block: s1p-a 0.90 (38/40), s1p-b 0.90 (38/40), openai-decisions 1.00 (40/40), openai-chat 1.00 (40/40), google-chat 0.95 (39/40), anthropic-chat 1.00 (40/40).

11 of 12 criteria assigned in mode hybrid (3 repeats, kappa at least 0.8). Unassigned, judged but never gating: ledger_intact.
Wrote assignments.yaml.
(exit 0)
```

The exit code is 0 because `ledger_intact`, the one unassigned criterion, is not declared gating. The table written is byte for byte `examples/acme/criteria/calibration/assignments.yaml`.

The cheapest rule on the recording of three real Claude judges, for one criterion (offline: the cassette replays the recorded answers and their recorded cost):

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-council.cassette.json --mode llm --assign cheapest --only plain_language --out cheapest.yaml
```

```text
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-council.cassette.json --mode llm --assign cheapest --only plain_language --out cheapest.yaml
plain_language: owned by claude-haiku alone (system2), 0.0002 USD per call
    claude-haiku       system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    claude-sonnet      system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    claude-opus        system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    alpha across judges 1.00; bar: 3/3 separation and kappa 0.8
Kappa over every labelled block: claude-haiku 1.00 (3/3), claude-sonnet 1.00 (3/3), claude-opus 1.00 (3/3).

1 of 1 criteria assigned in mode llm (3 repeats, kappa at least 0.8). Spent 0.1030 USD.
Wrote cheapest.yaml.
(exit 0)
```

A cascade on the same recording, haiku first:

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-council.cassette.json --cascade --only plain_language --only ledger_intact --out cascade.json
```

```text
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-council.cassette.json --cascade --only plain_language --only ledger_intact --out cascade.json
Cascade: claude-haiku answers everything; claude-sonnet and claude-opus answer where it is unsure or disagrees with the label.
ledger_intact: separation 3/3, kappa 1.00 (3/3), 0.0020 USD; escalated: none
    unsure only: separation 3/3, kappa 1.00 (3/3), 0.0020 USD
plain_language: separation 3/3, kappa 1.00 (3/3), 0.0016 USD; escalated: none
    unsure only: separation 3/3, kappa 1.00 (3/3), 0.0016 USD

Spent 0.0036 USD. Wrote cascade.json.
(exit 0)
```

## Common errors

* `judge calibrate needs --criteria <dir>, --labels <dir>, --out <file>, and --cassette <file> or --claude <model>.` (exit 2). Give the missing option. `--criteria` and `--labels` are also required by the parser, which then prints `error: required option ... not specified`.
* `--assign takes council or cheapest, not "best".` (exit 2).
* `--repeats takes a whole number from 1, not "0".` (exit 2).
* `--mode takes system1, hybrid, llm, not "<value>".` (exit 2).
* `--spend-cap-usd takes a positive number, not "0".` (exit 2).
* `judge calibrate: --only names no criterion nope.` (exit 2). The name is not in the criteria folder.
* `judge calibrate --cascade needs a first judge and at least one to escalate to.` (exit 2). The cassette holds one judge only; add another with a second judge in the cassette or with `--claude`.
* `judge calibrate: <n> issue(s) in the criteria or the labels.` (exit 2), after one line per issue. Labels issues include `the labels are for <criterion>, the file is <stem>` and `block id <id> is also used in <file>`. They also include `block <id>: anchor: ...` and `every block is labelled pass: a criterion needs a pass and a fail label`. They also include `labels for an unknown criterion <name>`. Here a criteria folder was passed as `--labels` by mistake.
* `0 of 1 criteria assigned in mode hybrid ... Unassigned, judged but never gating: plain_language.` (exit 0 when not gating). In hybrid mode a class needs three judges at the bar; a cassette of system 2 judges only cannot assign under `council` in hybrid. Use `--mode llm`, or add judges of the other class.
* `Left out, same family as the agent: claude-haiku, claude-sonnet, claude-opus.` Every judge shares the agent's family, so nothing is assigned. The exit code is still 0 when no criterion is gating. Use judges of other families.
