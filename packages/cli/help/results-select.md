---
title: "Select the golden set"
summary: "Choose the fewest gated conversations that cover the cells of the map, then keep the k best, as the suite ci runs."
commands:
  - select
see_also:
  - results-holdout
  - results-ci
  - results-compare
next:
  - results-holdout
---

## What it is

`driftbench select` chooses a golden set: a small suite that still covers the map of situations. It reads
the gated specs (the output of `driftbench gate`, or any folder of specs) and the map, then:

1. counts the cells of the map on every subset of `--t` dimensions (default 2: every pair of values);
2. finds a cover: the fewest conversations that reach every cell the pool reaches;
3. with `--k`, keeps the k best of the cover, ranked by required cells added, then faults turned red (from
   the gate report beside the specs), then cells added;
4. copies the chosen spec files to `--out/specs/` and writes `--out/golden.json`.

Sealed specs (the gate's holdout, or `driftbench holdout seal`) never count.

## When to use it

After `driftbench gate`, to build the suite `driftbench ci` runs on every pull request: small enough to run
often, wide enough to cover the map. A golden set is what `compare` and `ci` pair on, so its size sets the
smallest margin a gate can show (see `results-statistics`).

## Commands and every option

```
driftbench select --cover <map> --specs <dir> --out <dir> [--k <n>] [--t <n>] [--force] [--json]
```

| Option | Default | Meaning |
|---|---|---|
| `--cover <map>` | required | the map of situations, YAML or JSON (`space.yaml`); an `inventory` it names is read too, for the required cells |
| `--specs <dir>` | required | the gated specs: a folder written by `driftbench gate`, or a folder of specs. Sealed specs never count |
| `--out <dir>` | required | the folder to write the golden set into; it must not overlap `--specs` |
| `--k <n>` | none: the whole cover | the size of the golden set, at least 1 |
| `--t <n>` | `2` | cells on every subset of t dimensions |
| `--force` | off | replace the golden set an earlier run wrote in the folder |
| `--json` | off | print the manifest as one JSON document instead of the table |

Global: `--plugin <module>`.

| Exit | When |
|---|---|
| 0 | the set is written and covers every required cell |
| 1 | the set is written and a required cell stays empty |
| 2 | a usage or input error: an invalid map or spec, no unsealed spec, or `--out` overlapping `--specs`. An existing `golden.json` without `--force`, a grid over the cell limit, or a sealed spec changed after sealing |

## Inputs

* The map: `examples/acme/map/space.yaml` for Acme.
* The gate's output folder (`examples/acme/gated`): `specs/`, `holdout/` (sealed, left out),
  `gate-report.json` (which planted faults each spec turns red), `review.yaml`, `label-audit.yaml`. Gate
  files that are not specs are skipped.

## Outputs and how to read them

* `Pool:` how many unsealed specs, how many sealed specs left out, how many gate files skipped.
* `Cover:` how many conversations cover every cell the pool covers.
* With `--k` smaller than the cover, the ranked table: `adds cells`, `cumulative`, `adds required`
  (required cells of the inventory, such as a flow by deviation pair), `adds faults red`.
* `Cells covered: <n> of <allowed> allowed pairs`, then the same at t + 1, the required cells covered, and
  the faults turned red against what the pool turns red.
* `Wrote <n> files to <dir>.`

`golden.json` records the map, the pool, each chosen spec with its path and what it adds, and the
coverage of the golden set measured again on its own. `--json` prints it.

## Worked example

```sh
driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --out golden --k 10
driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --out golden --k 10 # exit 2
driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --out golden --k 6 --t 3 --force # exit 1
driftbench campaign run golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --store golden.db --campaign c-golden
```

```text
$ driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --out golden --k 10
Golden set for map acme, version 1: cells on every subset of 2 dimensions (708 allowed pairs).
Pool: 200 unsealed specs; 58 sealed specs left out; 4 gate files that are not specs skipped.
Cover: 106 conversations cover every cell the pool covers (598 of 708).
k = 10 is smaller than the cover: the golden set is the 10 best, ranked by required cells, then faults turned red, then cells.

  #   spec                           adds cells  cumulative  adds required                                                                                      adds faults red
  1   acme-order-loose-confirmation  60          60 of 708   flow new-home · D8_tool_failure; flow order · D4_loose_confirmation; flow order · D8_tool_failure  d4-order-on-loose-yes, x1-invents-price, x3-skips-recap, x4-wrong-language, x5-drops-coverage-check
  2   acme-new-customer-coverage     53          113 of 708  flow new-home · D1_off_topic; flow new-home · D6_instruction_in_data                               -
  3   acme-price-sheet-i08-planted   29          142 of 708  flow price-sheet · D6_instruction_in_data                                                          ops-x1-wrong-price, ops-x4-narrates, ops-x5-skips-check
  4   gen-twise-091                  36          178 of 708  flow order · D2_goal_shift                                                                         d2-ignores-goal-shift
  5   gen-twise-023                  30          208 of 708  flow new-home · D5_language_switch                                                                 -
  6   gen-twise-108                  22          230 of 708  flow new-home · D10_return                                                                         -
  7   gen-twise-081                  11          241 of 708  flow order · D3_contradiction                                                                      -
  8   gen-twise-066                  28          269 of 708  -                                                                                                  d9-answers-out-of-scope
  9   gen-twise-018                  24          293 of 708  -                                                                                                  d6-obeys-instruction
  10  gen-twise-074                  13          306 of 708  -                                                                                                  d8-hides-tool-failure

Cells covered: 306 of 708 allowed pairs (43.2%); the pool covers 598.
  t = 3: 794 of 4064 allowed (19.5%).
Required cells: 10 of 10; the pool covers 10.
Faults turned red: 12 of the 13 the pool turns red (13 counted faults in the gate report).
Wrote 11 files to golden.
```

Run again into the same folder, it refuses to overwrite:

```text
$ driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --out golden --k 10
golden/golden.json already exists: an earlier run wrote this folder. Pass --force to replace it.
(exit 2)
```

With `--force`, six specs and cells counted on triples. Six are too few to keep every required cell, so the set is written and the command exits 1:

```text
$ driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --out golden --k 6 --t 3 --force
Golden set for map acme, version 1: cells on every subset of 3 dimensions (4064 allowed triples).
Pool: 200 unsealed specs; 58 sealed specs left out; 4 gate files that are not specs skipped.
Cover: 147 conversations cover every cell the pool covers (2365 of 4064).
k = 6 is smaller than the cover: the golden set is the 6 best, ranked by required cells, then faults turned red, then cells.

  #  spec                           adds cells  cumulative   adds required                                                                                      adds faults red
  1  acme-order-loose-confirmation  122         122 of 4064  flow new-home · D8_tool_failure; flow order · D4_loose_confirmation; flow order · D8_tool_failure  d4-order-on-loose-yes, x1-invents-price, x3-skips-recap, x4-wrong-language, x5-drops-coverage-check
  2  acme-new-customer-coverage     101         223 of 4064  flow new-home · D1_off_topic; flow new-home · D6_instruction_in_data                               -
  3  acme-price-sheet-i08-planted   68          291 of 4064  flow price-sheet · D6_instruction_in_data                                                          ops-x1-wrong-price, ops-x4-narrates, ops-x5-skips-check
  4  gen-twise-091                  99          390 of 4064  flow order · D2_goal_shift                                                                         d2-ignores-goal-shift
  5  gen-twise-116                  87          477 of 4064  flow new-home · D5_language_switch                                                                 -
  6  gen-twise-108                  56          533 of 4064  flow new-home · D10_return                                                                         -

Cells covered: 533 of 4064 allowed triples (13.1%); the pool covers 2365.
  t = 2: 222 of 708 allowed (31.4%).
Required cells: 9 of 10; the pool covers 10.
  ✗ flow order · D3_contradiction: k is too small to keep it
Faults turned red: 9 of the 13 the pool turns red (13 counted faults in the gate report).
Wrote 7 files to golden.
(exit 1)
```

The golden set is an ordinary spec folder; the last command runs it, routing the task specs to the ops
agent:

```text
$ driftbench campaign run golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --store golden.db --campaign c-golden
Campaign c-golden: 6 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 12 criteria in 11 blocks of 5 specs (one_question_per_turn, coverage_before_offer, explicit_confirmation, no_invented_data, behaviour.B-009, and 7 more), 3 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
```

## Common errors

| Message | Cause and fix |
|---|---|
| `<out>/golden.json already exists: an earlier run wrote this folder. Pass --force to replace it.` (exit 2) | add `--force`, or pick a new `--out` |
| `--out and --specs overlap: write the golden set to a folder of its own.` (exit 2) | write outside the specs folder |
| `No unsealed spec found under --specs: there is nothing to select from.` (exit 2) | the folder holds only sealed specs, or no spec |
| `The map is invalid, so nothing was selected.` (exit 2) | the lines above name each issue of the map |
| `A sealed spec changed after the gate sealed it: gate the candidates again.` (exit 2) | a sealed file was edited; rerun `driftbench gate` |
| `The full grid is over the limit of <n> cells.` (exit 2) | merge values or split the map |
| exit 1 | a required cell stays empty: raise `--k`, or generate specs for that cell |
