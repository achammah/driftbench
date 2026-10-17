---
title: Plan a campaign
summary: Count the cells and blocks a campaign would run, project its cost and print the smallest pass-rate drop it can detect, without running anything.
commands:
  - campaign plan
see_also:
  - running-campaign-run
  - running-cells-and-repeats
  - running-modes
  - running-targets
  - running-budget-and-prices
  - running-campaign-config
next:
  - running-smoke
---

## What it is

`driftbench campaign plan` shows what `driftbench campaign run` would do with the same arguments, and calls no agent. It loads and validates the specs. It resolves the target of every spec (a target with no adapter is refused, exactly as `run` refuses it). It expands the specs into cells: one cell per spec, target, mode, repeat and, in mode P, perturbation. It prints one row per cell, the projected cost, and one minimum detectable effect line per mode. That line gives the smallest drop in pass rate that a comparison of two campaigns of this size could detect.

## When to use it

* Before a campaign that costs money: count the cells and blocks, and compare the projection with a budget (`--budget-usd`).
* To size the repeats: raise `--repeats` (or add specs) until the minimum detectable effect is small enough for the change you want to see.
* To learn the cell ids a run will use. A cell id is also the run id of its run, and it does not depend on the campaign.
* To check that every target resolves before you spend anything: a plan that prints is a plan that can run.
* Not to run anything: use `driftbench campaign run` (topic running-campaign-run).
* Not to price from a token price table: the plan prices only from cost units measured in a store (topic running-budget-and-prices).

## Commands and every option

```text
driftbench campaign plan <paths...> [--target <adapter[:agent]>]... [--route <tag=target>]... [--mode <modes>] [--repeats <n>] [--budget-usd <usd>] [--baseline-rate <rate>] [--rho <rho>] [--store <file>] [--json] [--config <file>]
```

| Option | Default | Effect |
|---|---|---|
| `<paths...>` | required | spec files or folders. A folder is searched recursively for `*.yaml`, `*.yml` and `*.spec.json` files. The `campaign:` key of the config never supplies the paths of `plan`. |
| `--target <adapter[:agent]>` | none: each spec on its own target | plan every spec on this target. Repeat it for several targets; each one multiplies the cells. A spec whose own target names another adapter gets a `Note:` line. |
| `--route <tag=target>` | none | only with `--target`: a spec carrying the tag is planned on this target instead of the `--target` list. Repeat it. The first route whose tag the spec carries wins. |
| `--mode <modes>` | `F` | `T` (teacher-forced), `F` (free-running), `P` (perturbed), or several separated by commas, such as `T,F,P`. A mode named twice counts once. Cells always come in the order T, F, P. |
| `--repeats <n>` | `1` | runs per spec, target and mode; a whole number of at least 1. |
| `--budget-usd <usd>` | none | a number of at least 0. The cost line then ends with `Within the budget of $<usd>.` or `Over the budget of $<usd>.` |
| `--baseline-rate <rate>` | `0.5` | the pass rate the minimum detectable effect assumes; strictly between 0 and 1. |
| `--rho <rho>` | `0` | the correlation of the repeats of one spec (the intraclass correlation), from 0 to 1. 0 counts repeats as independent, which is optimistic. |
| `--store <file>` | none | read the measured cost units from this SQLite store. A path with no file creates an empty store there. |
| `--json` | off | print one JSON document instead of the text. |
| `--config <file>` | `driftbench.yaml` in the working folder, when it exists | the project config. Its `campaign:` key fills `targets`, `routes`, `modes`, `repeats`, `budget_usd` and `store` where no flag is given (topic running-campaign-config). |
| `--plugin <module>` | none | global option: load a plugin first, for example one that adds an adapter (topic running-plugins). |

The plan refuses more than 1,000,000 cells.

## Inputs

* Spec files, YAML or `.spec.json`. Every spec must be valid: one invalid spec stops the command and nothing is planned.
* Without `--target`, the `target:` each spec names. A spec that names none is refused.
* Optionally a store file, for its cost units. A cost unit is a measured price per block for one adapter; the latest unit of each adapter is used. No command records cost units during a run today: a store holds them only when code put them there with the store's `putUnit`. Without units the projection is $0.00 and names the adapter as unmeasured.
* Optionally the project config (`driftbench.yaml` or `--config`).

## Outputs and how to read them

Text output, on stdout, in this order:

1. `Note: <spec id> names the <adapter> adapter; --target runs it on <target>.` once for each spec a `--target` overrides. Routed specs get no note.
2. `Plan: <n> specs, <n> targets, mode(s) <list>, <n> repeats: <n> cells, <n> blocks.` Without `--target`, the targets part reads `each on its own target (<list>)`.
3. A table with one row per cell. Its columns are `cell` (the cell id, 16 hex characters), `spec`, `target`, `mode`, `repeat`, `perturbation` (only when some cell is in mode P), and `blocks`. `blocks` holds the blocks the cell sends. A P cell sends the spec's blocks plus the injected block, except for a perturbation that only changes the world: that one adds no block.
4. `Projected cost: $<usd> (<adapter>: <n> blocks at $<usd per block>; ...).` An adapter with no measured unit reads `<adapter>: no unit measured` and counts $0. With `--budget-usd`, the budget sentence follows. Judge calls are not priced.
5. One line per mode: `Minimum detectable effect, mode <M>: <effect> on a <rate>% pass rate, with <n> runs per arm over <n> specs (rho <rho>, design effect <d>; two-sided alpha 0.05, power 0.8).` The effect is in percentage points. It reads `none detectable` when the campaign is too small to detect any drop below the baseline. It reads `no runs` when the mode has no run. One arm is every spec on the first target. The specs are the independent units. The design effect is `1 + (repeats - 1) * rho`. The effective units per arm are `specs * repeats / design effect`.

`--json` prints `{ "cells": [...], "blocks": <n>, "cost": { "usd", "unmeasured", "byAdapter" }, "budgetUsd"?, "withinBudget"?, "mde": [...] }`. Each cell holds `cellId`, `specId`, `specHash`, `target`, `mode`, `repeat`, `perturbationId` (mode P only) and `blocks`. Each `mde` entry holds `mode`, `runsPerArm`, `specs`, `baselineRate`, `rho`, `alpha`, `power`, `designEffect`, and `effect` as a proportion (absent when nothing is detectable).

Exit codes: 0 when the plan printed; 2 on bad input. Bad input is an invalid spec or none found, an unknown mode, or a bad number. It is also a bad target or route, or a target with no adapter. It is also too many cells, a store that cannot be opened, or a bad config.

## Worked example

Six Acme conversation specs on the Acme sales agent, two repeats. Then one spec in all three modes with a budget. Then the same spec as JSON. The Acme agents run in process, so no model is called.

```sh
driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 2
driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F,P --budget-usd 1
driftbench campaign plan examples/acme/specs/conversations/tool-failure.yaml --target function:acme --json
```

```text
Plan: 6 specs, 1 target, mode F, 2 repeats: 12 cells, 52 blocks.
  cell              spec                           target         mode  repeat  blocks
  68a19d33ffb63206  acme-new-customer-coverage     function:acme  F     0       4
  31f113843f6e1e22  acme-new-customer-coverage     function:acme  F     1       4
  4033227538c49cf8  acme-number-porting            function:acme  F     0       5
  dd2305bd7041897b  acme-number-porting            function:acme  F     1       5
  8a546e9028cd7d10  acme-off-topic-return          function:acme  F     0       5
  3969e3c2e0988fb1  acme-off-topic-return          function:acme  F     1       5
  479eb10c52e2f431  acme-order-loose-confirmation  function:acme  F     0       4
  58bb8357be2ee702  acme-order-loose-confirmation  function:acme  F     1       4
  cc92cc9eb562f586  acme-plan-upgrade              function:acme  F     0       5
  2b7a03560cb7a80e  acme-plan-upgrade              function:acme  F     1       5
  d44b9dfe9d1cf87a  acme-tool-failure              function:acme  F     0       3
  0e486429b58c635e  acme-tool-failure              function:acme  F     1       3
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode F: 47.8 points on a 50% pass rate, with 12 runs per arm over 6 specs (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

Twelve cells would run. With six specs the design detects only a drop of about 48 points from a 50% pass rate. Add specs, the independent units, to shrink it.

```text
Plan: 1 spec, 1 target, modes T, F, P, 1 repeat: 5 cells, 27 blocks.
  cell              spec               target         mode  repeat  perturbation        blocks
  850ffcff3927f170  acme-plan-upgrade  function:acme  T     0                           5
  cc92cc9eb562f586  acme-plan-upgrade  function:acme  F     0                           5
  e5fd30b27f5451f2  acme-plan-upgrade  function:acme  P     0       billing-aside       6
  d331b9f8ffb1a5fb  acme-plan-upgrade  function:acme  P     0       order-service-down  5
  e5f5fa45081fd718  acme-plan-upgrade  function:acme  P     0       loose-ok            6
Projected cost: $0.00 (function: no unit measured). Within the budget of $1.00.
Minimum detectable effect, mode T: none detectable on a 50% pass rate, with 1 run per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
Minimum detectable effect, mode F: none detectable on a 50% pass rate, with 1 run per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
Minimum detectable effect, mode P: none detectable on a 50% pass rate, with 3 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

The spec declares three perturbations, so mode P makes three cells. `order-service-down` sends 5 blocks, not 6: it only changes the world, so it adds no block. The F cell `cc92cc9eb562f586` has the same id as in the first plan: a cell id does not depend on the campaign.

```text
{
  "cells": [
    {
      "cellId": "d44b9dfe9d1cf87a",
      "specId": "acme-tool-failure",
      "specHash": "e5bc5c9ba9d2",
      "target": {
        "adapter": "function",
        "agent": "acme"
      },
      "mode": "F",
      "repeat": 0,
      "blocks": 3
    }
  ],
  "blocks": 3,
  "cost": {
    "usd": 0,
    "unmeasured": [
      "function"
    ],
    "byAdapter": [
      {
        "adapter": "function",
        "blocks": 3,
        "usd": 0,
        "note": "no unit measured"
      }
    ]
  },
  "mde": [
    {
      "mode": "F",
      "runsPerArm": 1,
      "specs": 1,
      "baselineRate": 0.5,
      "rho": 0,
      "alpha": 0.05,
      "power": 0.8,
      "designEffect": 1
    }
  ]
}
```

`effect` is absent: nothing is detectable with one run.

## Common errors

Each exits 2 and prints on stderr.

* `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` Use `T`, `F`, `P`, or a comma list such as `T,F`.
* `--repeats takes a whole number of at least 1, not "0".` Give 1 or more.
* `--rho takes a number from 0 to 1, not "2".` Give a value from 0 to 1.
* `--baseline-rate takes a number between 0 and 1, not "1".` 0 and 1 themselves are refused: give a rate strictly between them.
* `--budget-usd takes a number of at least 0, not "-1".` Give 0 or more.
* `--route goes with --target: without it each spec already runs on its own target.` Add a `--target`, or drop the route.
* `--route takes tag=target, such as flow:price-sheet=process:acme-ops, not "bad".` Write `<tag>=<adapter>[:<agent>]`.
* `"" is not a target. Write <adapter> or <adapter>:<agent>, such as function:acme.` The `--target` value is empty or malformed.
* `No adapter is set up for function:nope. ...` The target names an agent this install does not reach. The rest of the message lists the targets it does reach (topic running-targets).
* `acme-x names no target. Give the spec a target, or run with --target <adapter[:agent]>, such as --target function:acme-sales.` A spec without `target:` and no `--target`.
* `No spec files found.` The paths hold no `*.yaml`, `*.yml` or `*.spec.json` file.
* A line `✗ <path>` is printed, then one line per issue such as `    (file)  SPEC_PARSE  cannot read the file: ...`. Then `Fix the invalid specs first: nothing ran.` is printed. A path that does not exist, or an invalid spec. Check it with `driftbench spec validate <path>`.
* `--repeats 1000000 makes 6000000 cells; a campaign holds at most 1000000.` Lower the repeats, the specs, the targets or the modes.
