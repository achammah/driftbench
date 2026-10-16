---
title: judge check
summary: "Validate a criteria folder with no model call: each criterion file, its FAIL and PASS pictures and its fixture pair. Run it before judge run or judge calibrate, which refuse a folder with issues."
commands:
  - judge check
see_also:
  - judging-criteria
  - judging-judge-run
  - judging-judge-calibrate
  - judging-self-tests
next:
  - judging-judge-run
---

## What it is

`driftbench judge check <criteria>` reads every `.yaml` and `.yml` file of a criteria folder, in name order, and checks it. A criteria folder holds one file per judged criterion, named after it. Each file defines the criterion (its rubric, its FAIL and PASS pictures) and a fixture pair. The fixture pair is a transcript slice the criterion must pass and one it must fail. The command prints one `ok` line per valid criterion and one line per issue. It calls no model and writes nothing.

## When to use it

* After writing or editing a criterion file, before anything else reads it.
* Before `judge run` and `judge calibrate`: both refuse a criteria folder with any issue and print the same issues.
* In CI, as a cheap gate on a criteria folder.
* To check a spec's own `criteria` list instead, use `driftbench spec validate` (see `authoring-spec-check`).

## Commands and every option

```
driftbench judge check <criteria> [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<criteria>` | Required argument. The criteria folder, resolved from the current folder. | none |
| `--json` | Print one JSON document instead of text. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | Every file is valid. |
| 1 | At least one issue, including a folder with no criterion file. |
| 2 | The folder cannot be read (it does not exist, or is not a folder). |

## Inputs

One YAML file per criterion. The file name without its extension must equal the criterion `name`. Each file is a mapping with exactly two keys; any other key is an issue.

`criterion`:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `name` | string: a letter or digit, then letters, digits, `_`, `.` or `-` | yes | The name blocks use to reference the criterion. |
| `rubric` | non-empty string | yes | The question the judge answers with pass or fail. |
| `pass` | string | yes for this folder (optional in a spec) | What a passing block looks like: the PASS picture. |
| `fail` | string | yes for this folder (optional in a spec) | What a failing block looks like: the FAIL picture. |
| `gating` | boolean | no | True gates every reference to the criterion. |
| `scope` | `block` or `conversation` | no, default `block` | Judge one block, or the whole conversation. |
| `inputs` | list of non-empty strings | no | Workspace paths the judge reads beside the transcript, such as a source file to compare with. Each fixture must then carry each input. |
| `judge_class` | `system1`, `system2` or `auto` | no, default `auto` | The class of judge. `auto` goes to system 1 until calibration assigns a class. |
| `repeat_reducer` | `mode`, `median` or `at_least:<k>` | no | How verdicts across repeats of one spec become one verdict. |

`fixtures` holds exactly `pass` and `fail`. Each fixture:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `transcript` | list, at least 1 entry | yes | The slice the judge reads. Each entry has `role` (`user`, `agent`, `tool_call`, `tool_result`, `card` or `context`), `text`, and `tool` on tool lines. No other key. |
| `note` | string | no | What the slice shows, for a human reader. |
| `artifact` | string | no | The text of a produced file, for a task criterion. |
| `inputs` | map from path to text | no, but required for each path the criterion's `inputs` names | The file text the judge compares against. |
| `given` | mapping with optional `stage` (string) and `ledger` (mapping) | no | The block's Given, as the judge reads it. |

A minimal valid file, `short_reply.yaml`:

```
criterion:
  name: short_reply
  rubric: Is the reply at most two sentences?
  pass: The reply has one or two sentences.
  fail: The reply has three sentences or more.
fixtures:
  pass:
    transcript:
      - { role: user, text: "What plans do you have?" }
      - { role: agent, text: "We have Acme Fiber 300 and Acme Fiber 1000." }
  fail:
    transcript:
      - { role: user, text: "What plans do you have?" }
      - { role: agent, text: "We have two plans. One is Acme Fiber 300. The other is Acme Fiber 1000." }
```

## Outputs and how to read them

Text output:

* stdout, one line per valid criterion: `ok  <name> [<judge_class>, gating]: pass fixture <n> line(s), fail fixture <m> line(s)`. `gating` appears only when the criterion sets `gating: true`. `<judge_class>` is `auto` when the file sets none.
* stderr, one line per issue: `<file>: <message>`.
* stdout, last line: `<v> valid criteria, <i> issue(s).`

A file with any issue is not counted as valid, and its own `ok` line is not printed.

With `--json`, one object: `valid` (each `criterion`, `file`, `judge_class` (`auto` when absent), `gating`, `scope` (`block` when absent)) and `issues` (each `file`, `message`). Paths are relative to the current folder.

The issues the loader reports:

| Message | Cause |
|---|---|
| `cannot read the folder: <error>` | The folder does not exist or cannot be read. Exit 2. |
| `no criterion file (.yaml or .yml)` | The folder holds no YAML file. |
| `not YAML: <parser message>` | The file does not parse as YAML. |
| `<key path>: <schema message>` | The file breaks the schema, such as `criterion: Unrecognized key: "colour"` or `fixtures.fail.transcript: Too small: expected array to have >=1 items`. |
| `the criterion is named <name>, the file <stem>` | The file name does not match the criterion name. |
| `criterion <name> is also defined in <file>` | Two files define the same name. |
| `the pass and fail fixtures are the same slice: they cannot separate` | Both fixtures have the same transcript and artifact. |
| `fixture <pass or fail> lacks the input <path> the criterion names` | The criterion names an input that the fixture does not carry. |
| `the criterion needs both a FAIL and a PASS picture` | `pass` or `fail` is missing from `criterion`. |

## Worked example

Validate the 12 criteria of the Acme example. Then validate a folder with two broken files. One is a copy of `one_question_per_turn.yaml` saved as `one_question.yaml`. The other is a copy of `plain_language.yaml` with its `pass` picture removed:

```sh setup
mkdir -p check-bad
cp examples/acme/criteria/one_question_per_turn.yaml check-bad/one_question.yaml
grep -v '^  pass: ' examples/acme/criteria/plain_language.yaml > check-bad/plain_language.yaml
```

```sh
driftbench judge check examples/acme/criteria
driftbench judge check check-bad  # exit 1
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
$ driftbench judge check check-bad
check-bad/one_question.yaml: the criterion is named one_question_per_turn, the file one_question
check-bad/plain_language.yaml: the criterion needs both a FAIL and a PASS picture

0 valid criteria, 2 issue(s).
(exit 1)
```

Issues go to stderr and the counts to stdout; both are shown here in order.

## Common errors

* `<file>: the criterion is named one_question_per_turn, the file one_question` (exit 1). Rename the file to `<name>.yaml`, or change `name`.
* `<file>: the criterion needs both a FAIL and a PASS picture` (exit 1). Add both `pass` and `fail` to `criterion`. A spec may leave them out; a criteria folder may not, since calibration needs both pictures.
* `<file>: criterion: Unrecognized key: "colour"` (exit 1). Every mapping is strict: remove the unknown key.
* `<file>: fixtures.pass.transcript.1.role: Invalid option: expected one of "user"|"agent"|"tool_call"|"tool_result"|"card"|"context"` (exit 1). Use one of those roles.
* `<folder>: no criterion file (.yaml or .yml)` (exit 1). The folder is empty, or its files use another extension.
* `<folder>: cannot read the folder: ENOENT: no such file or directory, scandir '<path>'` (exit 2). The path is wrong; it is resolved from the current folder.
