---
title: judge run
summary: Replay a judge council on recorded answers over every fixture pair of a criteria folder and report which criteria it separates. Use it to prove a council and its assignments work before a run relies on them.
commands:
  - judge run
see_also:
  - judging-council
  - judging-criteria
  - judging-cassettes
  - judging-judge-calibrate
  - judging-families
next:
  - judging-council
---

## What it is

`driftbench judge run` builds a judge council whose judges replay a cassette (a JSON file of recorded judge answers). It then asks that council to judge the pass fixture and the fail fixture of every criterion in a criteria folder. A criterion is separated when its pass fixture gets the verdict pass and its fail fixture gets the verdict fail. The command never calls a model: every answer comes from the cassette. A request the cassette does not hold gives no answer, which is counted as an error, never as a pass.

## When to use it

* Check that a council, as configured (mode, cascade, assignment table, agent family), separates every fixture pair of your criteria.
* Check that an assignment table written by `judge calibrate` loads and gives the expected classes, with `--assignments`.
* See how the cascade behaves on your recordings, with `--cascade`.
* To validate the criteria files themselves (names, pictures, fixture shape), use `judge check` first: `judge run` refuses a folder with issues.
* To measure each judge alone against hand labels and choose owners, use `judge calibrate`.
* To judge a real run of an agent, use the judge options of `replay` or `estate run` (see `judging-run-judge`).

## Commands and every option

```
driftbench judge run --criteria <dir> --cassette <file> [--mode <mode>] [--agent-family <family>] [--cascade] [--assignments <file>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `--criteria <dir>` | Required. The criteria folder: one YAML file per criterion, each with its fixture pair. | none |
| `--cassette <file>` | Required. The recorded answers, a cassette JSON file. Each judge in the cassette becomes one council member. | none |
| `--mode <mode>` | The council mode: `system1`, `hybrid` or `llm`. `system1` uses only system 1 judges, `llm` only system 2 judges, `hybrid` both, with re-judging by the other class on a split. | `hybrid` |
| `--agent-family <family>` | The model family of the agent under test. The council refuses any judge of that family, before any call. `none` means the agent is not a model. | `none` |
| `--cascade` | Run the cheapest judge first and stop there on a pass whose score is at least 0.9. A fail, an inconclusive, an unsure pass or an answer without a score brings in the other judges. A request whose data holds an instruction aimed at the judge never stops at the cheapest judge. | off |
| `--assignments <file>` | The assignment table (YAML) that `judge calibrate` wrote. Its rows replace the default seating. Its mode must equal `--mode`. | none |
| `--json` | Print one JSON document instead of text. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | Every criterion is separated and every judge call gave an answer. |
| 1 | At least one criterion is not separated, or at least one judge call gave no answer (a cassette miss or a recorded failure). |
| 2 | Bad input: a missing required option, an unknown mode, a criteria folder with issues or a cassette that cannot be read. Bad input is also an assignment table for another mode, or a refused council. Examples of a refused council: a judge of the agent's family, or fewer than three judges of a class the mode uses. |

## Inputs

* The criteria folder (`--criteria`). One YAML file per criterion, named after it. Each file has `criterion` (`name`, `rubric`, `pass`, `fail`, and optional `gating`, `scope`, `judge_class`, `inputs`). It also has `fixtures` with a `pass` and a `fail` slice (`transcript`, and optional `note`, `artifact`, `given`, `inputs`). Every field is described in `judging-criteria`.
* The cassette (`--cassette`). JSON with `version`, `judges` (each with `id`, `family`, `cls`, optional `model`, `cost`) and `entries` (one recorded answer or failure per judge and request key). See `judging-cassettes`.
* The assignment table (`--assignments`, optional). YAML with `version: 1`, `mode`, `repeats`, `kappa_min` and one entry per criterion. See `judging-calibration`.

Without an assignment table, each criterion is judged by the three cheapest judges of its class (by cost, then id). The class is the criterion's `judge_class`; `auto` or no class means system 1, except that `system1` and `llm` modes force their own class.

## Outputs and how to read them

Text output, one line per criterion:

```
separated  <criterion> [<class>, gating]: pass fixture <outcome>, fail fixture <outcome>
NOT separated  <criterion> [<class>]: pass fixture <outcome>, fail fixture <outcome>
```

* `<class>` is the class of the row that judged the criterion: `system1` or `system2`.
* `gating` appears when the criterion is declared gating and calibration did not leave it unassigned. `unassigned: not gating` appears when the assignment table leaves it unassigned: it is still judged but never gates.
* `(split, re-judged)` after a fixture means the first three judges gave no majority and another round decided. `(cascade)` means the cheapest judge decided alone.
* Under a `NOT separated` line, the round log of each fixture follows, one line per round. An example line: `pass: system1: s1p-a inconclusive, s1p-b inconclusive, openai-decisions inconclusive; split`. A judge id ending in `@large` is the retry with the large token budget.
* The last line counts criteria (`<n> of <m> criteria separated in mode <mode>.`). When calls failed, it adds `; <k> judge call(s) gave no answer (a cassette miss or a recorded failure).`

With `--json`, one object: `mode`, `separated` (count), `criteria` (count), `errors` (judge calls with no answer) and `rows`. Each row has `criterion`, `cls`, `gating`, optional `unassigned` (the reason), `separated`, and `fixtures`. Each fixture has `fixture` (`pass` or `fail`), `outcome`, `cls`, `split`, `cascaded`, `errors`, `votes` (each `judge`, `outcome`, optional `score` and `reasoning`) and `log` (the round lines).

The command writes no file.

## Worked example

Replay the scripted council cassette that ships with the Acme example over the 12 Acme criteria:

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

All 12 criteria are separated. The fail fixture of `holds_instructions` split among the system 1 judges, so the three system 2 judges judged it again and decided fail. The answers in this cassette are scripted by hand: they prove the council mechanics, not the accuracy of a real model.

## Common errors

* `error: required option '--cassette <file>' not specified` (exit 2). The cassette is required, since the command never calls a model. Pass `--cassette <file>`.
* `--mode takes system1, hybrid, llm, not "fast".` (exit 2). Use one of the three modes.
* `judge run: judge openai-decisions is from the openai family, the family of the agent under test: refused` (exit 2). A judge in the cassette shares the family given by `--agent-family`. Use a cassette whose judges are all of other families, or state the agent's real family (`none` for an agent that is not a model).
* `judge run: the assignment table is for mode hybrid, the run is in mode llm` (exit 2). Run in the mode the table was calibrated for, or calibrate again with `judge calibrate --mode <mode>`.
* `judge run: ENOENT: no such file or directory, open '<path>'` (exit 2). The cassette path does not exist. Check the path; it is resolved from the current folder.
* `judge run: the criteria folder has <n> issue(s); run judge check first.` (exit 2), after one line per issue. Fix the criteria files; `judge check` lists the same issues.
* `0 of 12 criteria separated in mode hybrid; 216 judge call(s) gave no answer (a cassette miss or a recorded failure).` (exit 1). The cassette holds no recording for these requests. Either it was recorded for other requests (here `examples/acme/criteria/calibration/campaign.cassette.json`, which holds campaign blocks, not fixtures). Or a rubric, fixture, prompt or client setting changed since recording, which changes the request key. Use the cassette recorded for these fixtures, or record again.
