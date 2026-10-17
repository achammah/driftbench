---
title: Judged criteria
summary: How to define a criterion a model judges (name, rubric, FAIL and PASS pictures, gating, scope, judge class, inputs, repeat reducer). It shows how to reference it from a block. It names the fixture pair and hand labels it needs before a judge is trusted on it.
commands:
  - spec validate
  - judge check
  - judge run
  - judge calibrate
see_also:
  - judging-judge-check
  - judging-calibration
  - judging-default-judge
  - judging-machine-checks
next:
  - judging-judge-check
---

## What it is

A judged criterion is a question about a block that code cannot answer. Examples: "does the reply ask at most one question" or "does every price come from a tool result". A model judge reads the block and answers pass, fail or inconclusive. A criterion lives in two places:

* In a spec, under `criteria`, where blocks reference it by name in `expect.criteria`.
* In a criteria folder, one YAML file per criterion with a fixture pair (a slice it must pass and a slice it must fail). In a labels folder, hand-labelled blocks. These are what calibration tests a judge on.

## When to use it

* When the expectation is about meaning, not words: tone, honesty, staying on task, a paraphrased refusal. Prefer a machine check whenever code can decide (see `judging-machine-checks`).
* Write the rubric as one binary question with an observable answer. `lintCriterion` lists common defects (see `judging-opt-in-settings`).
* Give the criterion a fixture pair and labels before it gates anything. An uncalibrated criterion is judged by default seating, and calibration may leave it unassigned (never gating).

## Commands and every option

| Command | What it does with criteria |
|---|---|
| `driftbench spec validate <spec>` | Checks references and definitions: `CRITERION_UNDEFINED`, `CRITERION_DUPLICATE`, `CRITERION_REF_INVALID`. |
| `driftbench judge check <criteria>` | Validates a criteria folder (see `judging-judge-check`). |
| `driftbench judge run --criteria <dir> --cassette <file>` | Replays a council over every fixture pair (see `judging-judge-run`). |
| `driftbench judge calibrate --criteria <dir> --labels <dir> ...` | Tests each judge and assigns owners (see `judging-judge-calibrate`). |
| `driftbench replay --judge`, `driftbench estate run --judge` | Judge the criteria blocks name in a run (see `judging-run-judge`). |
| `driftbench campaign run` | Loads no judge: prints `Not judged:` with the criteria the specs name; they get no verdict. |

## Inputs

A criterion definition (the same shape in a spec's `criteria` list and in a criteria file's `criterion` key):

| Key | Type | Required | Meaning |
|---|---|---|---|
| `name` | a letter or digit, then letters, digits, `_`, `.`, `-` | yes | The name blocks reference. |
| `rubric` | text | yes | The question, written to have a binary answer. |
| `fail` | text | no in a spec, yes in a criteria folder | The FAIL picture: what a failing block looks like. The judge reads it first. |
| `pass` | text | no in a spec, yes in a criteria folder | The PASS picture. |
| `gating` | boolean | no | `true` gates every reference: a fail fails the block. |
| `scope` | `block` or `conversation` | no, default `block` | `block`: the judge reads the last 2 messages of the prefix as context, then the block. `conversation`: the whole prefix, then the block. |
| `judge_class` | `system1`, `system2` or `auto` | no, default `auto` | System 1 for evidence inside the block (a tool used, a fact present, one question per turn). System 2 for reading across blocks (a contradiction with the ledger, drift, recovery). `auto` goes to system 1 until calibration assigns a class. A calibrated assignment overrides it. |
| `inputs` | list of workspace paths | no | Files the judge reads beside the transcript, such as the source a produced file must match. In a run they are read from the Given workspace seed first (as the agent received them), then the workspace. A missing one is named as not available. They are part of the request key. |
| `repeat_reducer` | `mode`, `median` or `at_least:<k>` | no | How the verdicts across repeats of one spec become one verdict. `mode` is the most common, when more than half are scored. `median` is pass above one half of the repeats, fail below. `at_least:<k>` is pass when at least k repeats pass, and fail only when k can no longer be reached. Inconclusive repeats are left out. Without it, no reduced verdict. |

Referencing from a block: `expect.criteria: [one_question_per_turn, no_invented_data@gating]`. `name@gating` gates that one reference. A reference to a name the spec does not define is an error. A spec with no `criteria` list may name criteria from a shared catalogue. In that case `spec lint` warns that they must come from there.

The shared catalogue `examples/criteria` holds five criteria with fixture pairs: `conversation_completeness`, `knowledge_retention`, `relevancy`, `role`, `task_completion`. On a block that also sets the machine fields `relevancy` or `knowledge_retention`, the judged criterion of the same name makes the machine verdict advisory.

A criteria folder file: `criterion` (the definition) and `fixtures` with `pass` and `fail`. Each of `pass` and `fail` has `transcript` (entries with `role`, `text`, `tool`). The optional keys are `note`, `artifact`, `inputs` (path to text, required for every input the criterion names) and `given` (`stage`, `ledger`). See `judging-judge-check` for every key and issue.

A labels file: `criterion`, optional `labelled_by`, `blocks` (each `id`, `label` pass or fail, the fixture keys, optional `anchor`). See `judging-calibration`.

## Outputs and how to read them

In a run with a judge, each criterion a block names gives one verdict `judge.<name>`, kind `judge`. It gates when the definition or the reference says so, unless calibration left the criterion unassigned. A criterion the spec does not define gives an inconclusive verdict that says so. A failing gating judge verdict carries drift class X1. Without a judge, `replay` and `estate run` give an inconclusive verdict that gates as the criterion does; `campaign run` gives none.

## Worked example

The shared catalogue validates; then a copy of the plan upgrade spec whose first block references a criterion the spec does not define is refused:

```sh setup
mkdir -p criteria
sed 's/criteria: \[one_question_per_turn\]$/criteria: [one_question]/' examples/acme/specs/conversations/plan-upgrade.yaml > criteria/plan-upgrade.yaml
```

```sh
driftbench judge check examples/criteria
driftbench spec validate criteria/plan-upgrade.yaml  # exit 1
```

```text
$ driftbench judge check examples/criteria
ok  conversation_completeness [system1]: pass fixture 2 line(s), fail fixture 2 line(s)
ok  knowledge_retention [system1]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  relevancy [system1]: pass fixture 2 line(s), fail fixture 2 line(s)
ok  role [system1]: pass fixture 2 line(s), fail fixture 2 line(s)
ok  task_completion [system1]: pass fixture 4 line(s), fail fixture 2 line(s)

5 valid criteria, 0 issue(s).
(exit 0)
$ driftbench spec validate criteria/plan-upgrade.yaml
✗ criteria/plan-upgrade.yaml
    blocks.0.expect.criteria.0  CRITERION_UNDEFINED  criterion "one_question" is not defined in this spec's criteria
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
```

## Common errors

* `CRITERION_UNDEFINED  criterion "<name>" is not defined in this spec's criteria`. Define it under `criteria`, or fix the name.
* `CRITERION_DUPLICATE`. Two definitions share a name.
* `CRITERION_REF_INVALID`. A reference is not `name` or `name@gating`.
* A criterion that is always inconclusive: the rubric needs data the request lacks (a catalog, a source file). Add it to `inputs`, and to each fixture's `inputs`.
* A gating criterion that never gates: calibration left it unassigned. Read the `reason` in the assignment table and improve the rubric.
