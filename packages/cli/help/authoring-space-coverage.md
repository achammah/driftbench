---
title: Space coverage and completeness
summary: '`space coverage` counts which cells of a space map your specs cover. It counts per dimension, over every subset of t dimensions, weighted by the user mix, and for each required cell. `space complete` estimates how much of the map a sample of conversations has shown.'
commands:
  - space coverage
  - space complete
see_also:
  - authoring-map
  - authoring-covering-arrays
  - authoring-generate
  - authoring-inventory
  - authoring-extract
next:
  - authoring-extract
---

## What it is

Both commands read a space map (see authoring-map) and a set of specs, place each spec on the map's grid, and count.

- `space coverage` answers: which situations do my specs test? It prints, per dimension, which values some spec reaches. On every subset of `t` dimensions, it prints how many allowed cells are covered. It prints the same share weighted by the prior (the user mix). It also prints each required cell with the specs that cover it. It exits 1 while a required cell is empty.
- `space complete` treats the specs as a random sample of conversations. It answers: how much of the map has the sample shown, and how likely is the next conversation to show a new cell? It prints the sample coverage and the discovery probability with bootstrap intervals, and the Hill numbers of the cells seen. It prints that line only when there are at least as many conversations as allowed cells.

A t-wise count looks at cells on t dimensions at a time. At t = 2 a cell is a pair of values on two dimensions; a suite covers it when one spec places on both values. Without `--t`, the cells are the full grid: one value on every dimension.

## When to use it

- After writing or generating a suite, to see which stages, deviations, personas or data values no spec reaches.
- To compare two suites on the same map (`generate --baseline` does it for generated suites).
- To decide whether a sample of real or simulated conversations is large enough to say what share of the space it shows (`space complete`).

## Commands and every option

### driftbench space coverage

```
driftbench space coverage <paths...> --map <file> [--t <n>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | Spec files or folders. Every path must exist. | none |
| `--map <file>` (required) | The space map, YAML or JSON. Not the extract proposal: run `extract map` first. | none |
| `--t <n>` | Count cells on every subset of n dimensions, n a whole number from 1 to the number of dimensions. | the full grid |
| `--json` | Print one JSON document. | off |

The t-wise lines are always printed for t = 2 and t = 3 when the map has that many dimensions, whatever `--t` is.

| Exit code | When |
|---|---|
| 0 | every required cell is covered (also when there is none) |
| 1 | a required cell has no spec |
| 2 | an invalid map or an invalid inventory the map names. `t` out of range or a full grid over 250000 cells. A path that does not exist, no spec file or an option error |

### driftbench space complete

```
driftbench space complete <paths...> --map <file> [--t <n>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | Spec files or folders, each spec one conversation. | none |
| `--map <file>` (required) | The space map. | none |
| `--t <n>` | The classes are the allowed cells on every subset of n dimensions. | the full grid |
| `--json` | Print one JSON document. | off |

The bootstrap draws 2000 resamples of the conversations with seed 1, at the 95% level, so the same input gives the same interval. These are fixed; no option changes them.

| Exit code | When |
|---|---|
| 0 | the completeness line is printed |
| 1 | too few conversations for the line (fewer than the allowed cells at strength t) |
| 2 | as for `space coverage` |

## Inputs

- A space map (authoring-map). When it names an `inventory`, the inventory is loaded and each deviation a flow requires becomes a required cell.
- Specs. Placement reads `expect.stage`, injection blocks, `perturbations`, `covers`, `channel` and the tags `persona:`, `data:`, `task:` (the table in authoring-map). Invalid specs are listed and never counted.

## Outputs and how to read them

### space coverage

- Header: `Map <agent>, version <v>: <d> dimensions, <cells> cells, <k> constraints, prior <kind> (<source>)`. `prior uniform (no weight declared)` when the map gives no weight.
- `Dimensions`: per dimension, the value count, how many some spec reaches, and the values none reaches. This is the first gap list to read.
- `Grid at t = <t>` (or `Full grid`): `cells` allowed of total, and the forbidden count. `covered` and its share. `weighted`: the covered share of the user mix, and the effective sample size (how many independent specs the weighted share rests on). `not computed` when the prior gives no weight to any allowed cell.
- `t-wise coverage`: covered of allowed pairs (t = 2) and triples (t = 3).
- `Required cells`: `✓` or `✗`, then the cell. The cell is `stage=recap · deviation=D4_loose_confirmation` from required values, or `flow <id> · <class>` from the inventory. Then the covering specs or `no spec`.
- `Warnings` (never change the exit code):

| Code | Meaning | What to do |
|---|---|---|
| `UNKNOWN_VALUE` | a spec names a value no dimension of that kind lists | add the value to the map, or fix the spec |
| `UNPLACED_SPEC` | a spec falls in no allowed cell; the message says why | add a `none` value, or the value it lacks |
| `FORBIDDEN_CELL` | a spec reaches a cell the constraints forbid; it is not counted | the constraint or the spec is wrong |
| `PRIOR_EMPTY` | the prior gives no weight to any allowed cell, so no weighted share | give weights |

- `Invalid specs, not counted`, then the summary line `Coverage: <a> of <b> required cells covered, <c> of <d> cells at t = <t> (<share>).`

`--json` keys: `map`, `inventory` (when named), `agent`, `version`, `prior` (`kind`, `source`, `uniform`) and `constraints` (count). `dimensions` has, for each: `id`, `title`, `kind`, `values` with per-value counts, `allowed`, `covered`. `grid` has `t`, `projections`, `total`, `allowed`, `covered`, `share`, `full`, `weighted`, `effectiveSampleSize`, and `cells`: every allowed cell with its `values`, `count` and `specs`. `tway` has one entry per strength 2 and 3. `required` has, for each: `source`, its values or flow and deviation, `covered`, `specs`. `specs` has, for each: `id`, `path`, `cells` covered, `weight`. The last keys are `warnings`, `invalidSpecs`, `ok`.

### space complete

- `Completeness at t = <t>: <cells> cells, <n> conversations` (or `over the full grid`).
- `seen`: cells shown by at least one conversation; `f1` and `f2`: cells shown by exactly one, and exactly two.
- `Hill numbers`: q0 is the number of cells seen. q1 (exponential of the Shannon entropy) and q2 (inverse Simpson) count the cells as if equally common. A q2 far under q0 means a few cells hold most conversations.
- `left out`: specs that fall in no allowed cell.
- When printable: `sample coverage` (Chao form) and `discovery` (Good-Turing f1 / n), each with its 95% interval. Then `bootstrap` (resamples and seed). Then a plain sentence and the assumption: the conversations are independent, from a generator that does not learn from results.
- When not printable: `No completeness line: <reason>.`

`--json` keys: `map`, `t`, `full`, `cells`, `conversations`, `unplaced`, `seen`, `f1`, `f2`, `hill`, `printable`, `reason` (when not printable). Also `coverage`, `discovery` (each `estimate`, `lower`, `upper`), `sentence`, `bootstrap`, `assumption`, `invalidSpecs`.

## Worked example

The seven hand-written Acme specs on the hand-written Acme map, over pairs:

```sh
driftbench space coverage examples/acme/specs --map packages/space/test/fixtures/acme-space.yaml --t 2 # exit 1
```

```text
$ driftbench space coverage examples/acme/specs --map packages/space/test/fixtures/acme-space.yaml --t 2
Map acme-sales, version 1: 6 dimensions, 54432 cells, 5 constraints, prior declared (Owner estimate for the fictional Acme example)

Dimensions
  id         kind       values  covered  not covered
  stage      stage      12      12
  behaviour  behaviour  14      13       B-007
  deviation  deviation  9       7        D2_goal_shift, D3_contradiction
  channel    channel    2       2
  persona    persona    3       0        cooperative, terse, sceptical
  data       data       6       1        fiber, no-fiber, check-fails, portable, locked

Grid at t = 2: 15 subsets of 2 dimensions
  cells     818 allowed of 823 (5 forbidden by the constraints)
  covered   199 (24.3%)
  weighted  34.0% of the declared user mix, effective sample size 6.3 of 7 specs

t-wise coverage
  t = 2  199 of 818 allowed pairs (24.3%)
  t = 3  399 of 7082 allowed triples (5.6%)

Required cells
  ✓  stage=recap · deviation=D4_loose_confirmation  acme-order-loose-confirmation, acme-plan-upgrade
  ✓  flow new-home · D1_off_topic                   acme-new-customer-coverage, acme-off-topic-return
  ✗  flow new-home · D5_language_switch             no spec
  ✓  flow new-home · D6_instruction_in_data         acme-new-customer-coverage
  ✓  flow new-home · D8_tool_failure                acme-order-loose-confirmation, acme-tool-failure
  ✓  flow new-home · D10_return                     acme-off-topic-return
  ✗  flow order · D2_goal_shift                     no spec
  ✗  flow order · D3_contradiction                  no spec
  ✓  flow order · D4_loose_confirmation             acme-order-loose-confirmation, acme-plan-upgrade
  ✓  flow order · D8_tool_failure                   acme-order-loose-confirmation, acme-plan-upgrade, acme-tool-failure
  ✓  flow price-sheet · D6_instruction_in_data      acme-price-sheet

Warnings
  ! D7_silence_or_burst  UNKNOWN_VALUE  deviation D7_silence_or_burst is named by acme-number-porting, but no deviation dimension of the map lists it
  ! D9_out_of_scope  UNKNOWN_VALUE  deviation D9_out_of_scope is named by acme-plan-upgrade, but no deviation dimension of the map lists it

Coverage: 8 of 11 required cells covered, 199 of 818 cells at t = 2 (24.3%).
(exit 1)
```

Read it: no spec carries a persona tag, and five data values are never reached. Three required flow deviations have no spec, so the command exits 1.

Completeness of the same seven specs is not estimable, while the 332 generated specs of the Acme example are enough at t = 1:

```sh
driftbench space complete examples/acme/specs --map packages/space/test/fixtures/acme-space.yaml --t 1 # exit 1
driftbench space complete examples/acme/generated/specs --map packages/space/test/fixtures/acme-space.yaml --t 1
```

```text
$ driftbench space complete examples/acme/specs --map packages/space/test/fixtures/acme-space.yaml --t 1
Completeness at t = 1: 46 cells, 7 conversations
  seen          35 cells; f1 15, f2 10
  Hill numbers  q0 35 · q1 28.2 · q2 22.9

No completeness line: the estimate needs at least as many conversations as cells, and there are 7 for 46.
(exit 1)
$ driftbench space complete examples/acme/generated/specs --map packages/space/test/fixtures/acme-space.yaml --t 1
Completeness at t = 1: 46 cells, 332 conversations
  seen             39 cells; f1 0, f2 0
  Hill numbers     q0 39 · q1 24.6 · q2 18.3
  sample coverage  100.0% (95% interval 100.0% to 100.0%), Chao form
  discovery        0.0% (95% interval 0.0% to 0.0%), Good-Turing f1 / n
  bootstrap        2000 resamples of the conversations, seed 1

About 100 percent of the interaction classes have appeared; the chance that the next conversation shows a new one is about 0 percent.
The figures assume independent conversations from a generator that does not learn from results; a generator that steers toward unseen cells makes them optimistic.
(exit 0)
```

A generated suite is steered toward unseen cells, so its estimate is optimistic, as the last line says. Here 39 of 46 values are seen, not all.

## Common errors

```
$ driftbench space coverage examples/acme/specs --map packages/space/test/fixtures/acme-space.yaml --t 9
Unknown t "9". The map has 6 dimensions, so t is a whole number from 1 to 6.
(exit 2)
$ driftbench space coverage nowhere --map packages/space/test/fixtures/acme-space.yaml
Cannot find nowhere.
(exit 2)
$ driftbench space coverage examples/acme/specs
error: required option '--map <file>' not specified
(exit 2)
```

Passing the extract proposal instead of a space map gives this output. It shows the first lines of a long list. The command ends with `The map is invalid, so coverage was not computed.` and exit 2:

```
$ driftbench space coverage examples/acme/specs --map examples/acme/map/approved.yaml
✗ examples/acme/map/approved.yaml
  version  SCHEMA_INVALID_TYPE  Invalid input: expected string, received number
  dimensions.0.values.0  SCHEMA_UNRECOGNIZED_KEYS  unknown keys: evidence, produced_by
  dimensions.0.values.1  SCHEMA_UNRECOGNIZED_KEYS  unknown keys: evidence, produced_by
```

Fix: `driftbench extract map examples/acme/map/approved.yaml --to <space.yaml>`, then pass that file (see authoring-extract).

| Symptom | Cause | Fix |
|---|---|---|
| `The full grid has <n> cells, over the limit of 250000.` | too many values or dimensions | merge values or split the map |
| `The map is invalid` with `SPACE_*` codes | the map breaks a rule | see the code table in authoring-map |
| `The inventory the map names is invalid` | the map's `inventory` path points at a bad file | fix the inventory, or the path (relative to the map) |
| many `UNKNOWN_VALUE` warnings | the specs use stages or classes the map does not list | add them to the map |
| `No completeness line` | fewer conversations than allowed cells | add specs, or lower `--t` |
