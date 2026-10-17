---
title: The space map
summary: 'The space map is the declared list of situations an agent can face (dimensions, their values, impossible combinations and the user mix). `space declare` writes a first one from the inventory and the specs. The space and generation commands count and fill its cells.'
commands:
  - space declare
  - space coverage
  - space complete
see_also:
  - authoring-space-coverage
  - authoring-extract
  - authoring-generate
  - authoring-covering-arrays
  - authoring-inventory
  - authoring-deviation-classes
next:
  - authoring-space-coverage
---

## What it is

The space map is one YAML or JSON file, usually beside the agent's behaviour inventory. It declares the situations an agent can face as a grid:

- A dimension is one axis an interaction varies on. The axes are the stage reached, the behaviour exercised, the deviation the user brings, the persona, the channel, the data, the task.
- Each dimension lists its values.
- A cell is one value per dimension. The grid is every combination.
- Constraints name the impossible combinations; a forbidden cell counts nowhere.
- The prior is the user mix: how often each value occurs. It weights coverage.
- Values marked `required: true`, and every deviation the inventory requires of a flow, become required cells: `space coverage` exits 1 while one has no spec.

Code places each spec on the grid; no model is involved. The value id `none` is reserved: it collects a block or spec that names no value of a dimension, when the map lists it.

There are two kinds of map file. This topic is the space map (`space.yaml`). The proposal that `extract` writes is a different, larger file; `extract map` turns its approved axes into a space map. See authoring-extract.

### How a spec is placed

A spec is cut into events: one per block and one per perturbation. A spec covers a cell when one of its events places on every value of the cell.

| Kind | Placed from | Per |
|---|---|---|
| `stage` | a block's `expect.stage`. A deviation (an injection block or a perturbation) places on the stage the conversation has reached when it arrives. That stage is the `expect.stage` of the nearest earlier block that has one. If there is none, it is the deviation's own `expect.stage`. For a perturbation it is then its `recovery.stage_after` | event |
| `deviation` | an injection block's or a perturbation's `class`; any other block carries no deviation | event |
| `behaviour` | every id in the spec's `covers` | spec |
| `channel` | the spec's `channel` | spec |
| `persona`, `data`, `task` | the spec's tags `persona:<id>`, `data:<id>`, `task:<id>` | spec |

A spec or event that names no value of a dimension places on `none` when the map lists it, and nowhere on that dimension otherwise. A value the map does not list places nowhere and is reported as `UNKNOWN_VALUE`. Spec-level values combine with every event, so a spec counts each of its behaviours at every stage it reaches.

## When to use it

- Before generating tests: `generate` reads an approved map (the proposal) and fills its cells.
- To measure a hand-written suite against what the agent can face: `space coverage` and `space complete`.
- To start a map without a model: `space declare` seeds one from the inventory and the specs, for you to edit.

## Commands and every option

### driftbench space declare

```
driftbench space declare <paths...> --inventory <file> --out <file> [--agent <name>]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | Spec files or folders. Their `stages` and `channel` seed the map; invalid specs are ignored. | none |
| `--inventory <file>` (required) | The behaviour inventory, YAML or JSON. | none |
| `--out <file>` (required) | Where to write the map. An existing file is never overwritten. Missing folders are created. | none |
| `--agent <name>` | The agent the map describes, written as `agent`. | `agent` |

What it writes:

- `stage`: every stage of the specs' `stages` lists, in the order first met.
- `behaviour`: the inventory's behaviours, with their titles.
- `deviation`: `none`, then every class a flow of the inventory requires, in class order.
- `channel`: the channels, as `spec coverage` computes them (the inventory's `channels`, else those named by behaviours and specs, else `default`).
- `constraints`: a behaviour the inventory limits to some channels is forbidden on the others.
- `prior: { kind: declared }` with no weight; `version: '1'`; `inventory`: the path relative to the map.

A dimension with nothing to list is left out. Persona, data and task dimensions are left to you.

| Exit code | When |
|---|---|
| 0 | the map is written |
| 2 | an invalid inventory, a missing spec path, no spec file, a seeded map that is invalid (rename the stages or channels the message names). Also when the output file exists or on an option error |

### driftbench space coverage and driftbench space complete

```
driftbench space coverage <paths...> --map <file> [--t <n>] [--json]
driftbench space complete <paths...> --map <file> [--t <n>] [--json]
```

Both read this map; see authoring-space-coverage for their options, output and exit codes. They refuse a map whose full grid holds more than 250000 cells.

## Inputs

Top level (one mapping; unknown keys are errors at every level):

| Key | Type | Required | Meaning |
|---|---|---|---|
| `version` | non-empty string | yes | A label for this version of the map. Quote numbers: `'1'`. |
| `agent` | non-empty string | yes | The agent the map describes. |
| `inventory` | non-empty string | no | The behaviour inventory, relative to this file. Each deviation a flow requires becomes a required cell `flow <id> · <class>`. |
| `dimensions` | list, at least 1 | yes | The axes, in the order reports list them. |
| `constraints` | list | yes | The impossible combinations. `[]` states that every combination can occur. |
| `prior` | mapping | yes | The user mix. |

A dimension:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | id: a letter or digit, then letters, digits, `.`, `_`, `-` | yes | Constraints and prior weights name it. |
| `title` | non-empty string | yes | What the dimension varies on. |
| `kind` | `stage`, `behaviour`, `deviation`, `persona`, `channel`, `data` or `task` | yes | Decides how a spec is placed on it (table above). At most one dimension each of kind `stage`, `deviation` and `channel`. |
| `values` | list, at least 1 | yes | The values, in report order. |

A value:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | id | yes | What specs name: a stage, a behaviour id, a deviation class (`D1_off_topic` to `D12_prompt_extraction`) or `none`, a tag value. Unique in its dimension, and unique across dimensions of the same kind for `behaviour`, `persona`, `data`, `task`. |
| `title` | non-empty string | yes | What the value means. |
| `weight` | number from 0 | no | Its share of users, relative to the other values of the dimension. Give it to every value of the dimension or to none. |
| `required` | boolean | no | True when the value must be covered. The required values of all dimensions combine into required cells; forbidden combinations are left out. |

A constraint:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `forbid` | mapping of dimension id to value id, at least one pair | yes | A partial cell. Every cell that holds all of these values is impossible. |
| `reason` | non-empty string | yes | Why. Reports show it. |

The prior:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `declared` or `fitted` | yes | `declared`: the owner wrote the weights. `fitted`: fitted from consented conversations. |
| `source` | non-empty string | for `fitted` | Where the weights come from. |
| `weights` | mapping: dimension id to (value id to number from 0) | no | Replaces the weights written on the values of each dimension listed; list every value of it, 0 included. |

Without any weight, every value of a dimension weighs the same (`prior uniform` in reports).

A small valid map (`out/authoring-map/tiny-map.yaml`):

```yaml
# A hand-written map: three dimensions, one constraint, a declared prior.
version: '1'
agent: acme-sales
inventory: ../../examples/acme/inventory.yaml
dimensions:
  - id: stage
    title: The stage the conversation has reached
    kind: stage
    values:
      - { id: identify, title: Identify the customer, required: true }
      - { id: offer, title: Offer plans }
      - { id: recap, title: Recap the order }
      - { id: order_placed, title: Order placed }
  - id: deviation
    title: The deviation the user brings
    kind: deviation
    values:
      - { id: none, title: No deviation, weight: 8 }
      - { id: D4_loose_confirmation, title: A loose yes, weight: 1, required: true }
      - { id: D8_tool_failure, title: A tool fails, weight: 1 }
  - id: persona
    title: Who the user is
    kind: persona
    values:
      - { id: none, title: No persona tag }
      - { id: terse, title: Short messages }
constraints:
  - forbid: { stage: identify, deviation: D4_loose_confirmation }
    reason: Nothing is confirmed before the customer is identified.
prior:
  kind: declared
  source: Owner estimate for the fictional Acme example
```

## Outputs and how to read them

`space declare` prints `Wrote <file>: <d> dimensions, <c> cells, <k> constraints.` The file opens with two comment lines, writes each value and each `forbid` on one line, and is ready to edit.

The cell count is the full grid (the product of the value counts), before constraints. `space coverage` and `space complete` show the allowed cells.

After editing, check the map by running `space coverage` on any spec folder: an invalid map stops it with its issues (exit 2).

## Worked example

Seed a map from the Acme inventory and specs:

```sh
driftbench space declare examples/acme/specs --inventory examples/acme/inventory.yaml --out out/authoring-map/space.yaml --agent acme-sales
```

```text
$ driftbench space declare examples/acme/specs --inventory examples/acme/inventory.yaml --out out/authoring-map/space.yaml --agent acme-sales
Wrote out/authoring-map/space.yaml: 4 dimensions, 3024 cells, 3 constraints.
(exit 0)
```

The file it wrote (the 12 stages, 14 behaviours and 9 deviation values in full):

```yaml
# The map of situations acme-sales can face, seeded by driftbench space declare.
# Edit it: add persona, data or task dimensions, impossible combinations and weights.
version: '1'
agent: acme-sales
inventory: ../../examples/acme/inventory.yaml
dimensions:
  - id: stage
    title: The stage the conversation has reached
    kind: stage
    values:
      - { id: address, title: address }
      - { id: offer, title: offer }
      - { id: details, title: details }
      - { id: recap, title: recap }
      - { id: order_placed, title: order placed }
      - { id: callback, title: callback }
      - { id: handover, title: handover }
      - { id: closing, title: closing }
      - { id: port_number, title: port number }
      - { id: identify, title: identify }
      - { id: build_sheet, title: build sheet }
      - { id: add_summary, title: add summary }
  - id: behaviour
    title: The behaviour of the inventory the conversation exercises
    kind: behaviour
    values:
      - { id: B-001, title: Identify an existing customer by the email on the account before quoting their plan }
      - { id: B-002, title: Offer an existing customer only plans with more data than their current plan }
      - { id: B-003, title: Check coverage at the street address before offering home internet }
      - { id: B-004, title: Offer only the home plans available at the checked address }
      - { id: B-005, title: Book a sales callback with a phone number when the customer asks or a check cannot be done }
      - { id: B-006, title: Check that a number can move to Acme before promising to keep it }
      - { id: B-007, title: Explain a transfer lock and offer a new Acme number when a number cannot move }
      - { id: B-008, title: Recap the order and place it only after an explicit CONFIRM }
      - { id: B-009, title: Treat a loose yes as no confirmation and ask for CONFIRM again }
      - { id: B-010, title: 'Report a failed tool honestly, invent none of its answer, and offer a fallback' }
      - { id: B-011, title: Answer an off-topic question in one line and resume the pending step }
      - { id: B-012, title: 'Send billing and service matters to Acme Care, never to sales' }
      - { id: B-013, title: 'Build the price sheet workbook from the catalog file, one sheet per category' }
      - { id: B-014, title: Add a summary sheet to the existing workbook and leave every other file untouched }
  - id: deviation
    title: The deviation the user brings, if any
    kind: deviation
    values:
      - { id: none, title: No deviation }
      - { id: D1_off_topic, title: An off-topic question in the middle of the flow }
      - { id: D2_goal_shift, title: The user changes the goal after a step is done }
      - { id: D3_contradiction, title: The user contradicts a fact given earlier }
      - { id: D4_loose_confirmation, title: A loose yes where an explicit confirmation is needed }
      - { id: D5_language_switch, title: A message in another language }
      - { id: D6_instruction_in_data, title: An instruction hidden in data }
      - { id: D8_tool_failure, title: A tool or a command fails }
      - { id: D10_return, title: A return to the flow after a detour }
  - id: channel
    title: The channel the conversation runs on
    kind: channel
    values:
      - { id: chat, title: chat }
      - { id: whatsapp, title: whatsapp }
constraints:
  - forbid: { behaviour: B-001, channel: whatsapp }
    reason: The inventory lists B-001 on chat only.
  - forbid: { behaviour: B-013, channel: whatsapp }
    reason: The inventory lists B-013 on chat only.
  - forbid: { behaviour: B-014, channel: whatsapp }
    reason: The inventory lists B-014 on chat only.
prior:
  kind: declared
```

Then measure the same specs on it, over pairs of dimensions:

```sh
driftbench space coverage examples/acme/specs --map out/authoring-map/space.yaml --t 2 # exit 1
```

```text
$ driftbench space coverage examples/acme/specs --map out/authoring-map/space.yaml --t 2
Map acme-sales, version 1: 4 dimensions, 3024 cells, 3 constraints, prior uniform (no weight declared)

Dimensions
  id         kind       values  covered  not covered
  stage      stage      12      12
  behaviour  behaviour  14      13       B-007
  deviation  deviation  9       7        D2_goal_shift, D3_contradiction
  channel    channel    2       2

Grid at t = 2: 6 subsets of 2 dimensions
  cells     469 allowed of 472 (3 forbidden by the constraints)
  covered   165 (35.2%)
  weighted  44.4% under a uniform prior, effective sample size 6.2 of 7 specs

t-wise coverage
  t = 2  165 of 469 allowed pairs (35.2%)
  t = 3  234 of 2253 allowed triples (10.4%)

Required cells
  ✓  flow new-home · D1_off_topic               acme-new-customer-coverage, acme-off-topic-return
  ✗  flow new-home · D5_language_switch         no spec
  ✓  flow new-home · D6_instruction_in_data     acme-new-customer-coverage
  ✓  flow new-home · D8_tool_failure            acme-order-loose-confirmation, acme-tool-failure
  ✓  flow new-home · D10_return                 acme-off-topic-return
  ✗  flow order · D2_goal_shift                 no spec
  ✗  flow order · D3_contradiction              no spec
  ✓  flow order · D4_loose_confirmation         acme-order-loose-confirmation, acme-plan-upgrade
  ✓  flow order · D8_tool_failure               acme-order-loose-confirmation, acme-plan-upgrade, acme-tool-failure
  ✓  flow price-sheet · D6_instruction_in_data  acme-price-sheet

Warnings
  ! D7_silence_or_burst  UNKNOWN_VALUE  deviation D7_silence_or_burst is named by acme-number-porting, but no deviation dimension of the map lists it
  ! D9_out_of_scope  UNKNOWN_VALUE  deviation D9_out_of_scope is named by acme-plan-upgrade, but no deviation dimension of the map lists it

Coverage: 7 of 10 required cells covered, 165 of 469 cells at t = 2 (35.2%).
(exit 1)
```

Next edits a map owner would make: add `D7_silence_or_burst` and `D9_out_of_scope` to the deviation dimension (the specs use them), add a `persona` dimension, add weights.

## Common errors

A map with nine problems (`out/authoring-map/bad-map.yaml`):

```
$ driftbench space coverage examples/acme/specs --map out/authoring-map/bad-map.yaml
✗ out/authoring-map/bad-map.yaml
  dimensions.0.values.1.weight  SPACE_PRIOR_INCOMPLETE  "stage" gives a weight to some values only: give every value a weight, or none
  dimensions.1.kind  SPACE_KIND_REPEATED  only one dimension may be of kind stage: "stage" already is
  dimensions.2.values.1.id  SPACE_UNKNOWN_DEVIATION  "D99_strange" is not a deviation class: use D1_off_topic to D12_prompt_extraction, or none
  dimensions.3.values.1.id  SPACE_DUPLICATE  value "terse" is listed twice in "persona"
  constraints.0.forbid  SPACE_EMPTY_CONSTRAINT  forbid names no dimension
  constraints.1.forbid.channel  SPACE_UNKNOWN_DIMENSION  the map has no dimension "channel"
  constraints.2.forbid.stage  SPACE_UNKNOWN_VALUE  "stage" has no value "closing"
  prior.source  SPACE_PRIOR_SOURCE  a fitted prior names the conversations it was fitted on
  prior.weights.persona  SPACE_PRIOR_ZERO  every value of "persona" weighs 0
The map is invalid, so coverage was not computed.
(exit 2)
```

`space declare` never overwrites:

```
$ driftbench space declare examples/acme/specs --inventory examples/acme/inventory.yaml --out out/authoring-map/space.yaml
out/authoring-map/space.yaml already exists. The map is never overwritten: remove it or pick another path.
(exit 2)
```

| Code | Meaning |
|---|---|
| `SPACE_PARSE` | the file cannot be read, or is not valid YAML or JSON (a repeated key included) |
| `SPACE_NOT_OBJECT` | the file does not hold one mapping with dimensions, constraints and a prior |
| `SPACE_DUPLICATE` | a dimension id, a value id in one dimension, or a forbidden combination is listed twice |
| `SPACE_KIND_REPEATED` | a second dimension of kind `stage`, `deviation` or `channel` |
| `SPACE_AMBIGUOUS_VALUE` | the same value id in two dimensions of kind `behaviour`, `persona`, `data` or `task`: a spec names the value without its dimension |
| `SPACE_UNKNOWN_DEVIATION` | a deviation value that is not a class or `none` |
| `SPACE_EMPTY_CONSTRAINT` | `forbid: {}` |
| `SPACE_UNKNOWN_DIMENSION` | a constraint or prior names a dimension the map does not have |
| `SPACE_UNKNOWN_VALUE` | a constraint or prior names a value the dimension does not have |
| `SPACE_PRIOR_INCOMPLETE` | weights on some values of a dimension only, or `prior.weights` misses a value |
| `SPACE_PRIOR_ZERO` | every value of a dimension weighs 0 |
| `SPACE_PRIOR_SOURCE` | a `fitted` prior with no `source` |
| `SPACE_GRID_EMPTY` | the constraints forbid every cell |
| `SCHEMA_*` | a key or value the schema refuses: an unknown key, a bad id, an unknown kind, a missing `constraints` or `prior` |

Common mistakes that load but mislead: a stage the specs use but the map does not list. That gives `UNKNOWN_VALUE` warnings, and the spec places nowhere on that dimension. Another is a map with no `none` deviation value (blocks without a deviation then place nowhere on it).
