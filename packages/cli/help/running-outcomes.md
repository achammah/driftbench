---
title: Read campaign results
summary: What each cell state means (pass, fail, not_run, blocked, failed, stopped, pending), how to read a cell line, the failing list and the summary, the --json document of campaign run, resume and status, and the exit codes.
commands:
  - campaign run
  - campaign resume
  - campaign status
see_also:
  - running-campaign-run
  - running-campaign-status
  - running-campaign-resume
  - running-cells-and-repeats
  - running-budget-and-prices
  - running-cache
  - running-change-carry
  - running-not-run
next:
  - running-campaign-status
---

## What it is

`campaign run`, `campaign resume` and `campaign status` all report a campaign the same way: one line per cell, in cell order, then a summary line; or, with `--json`, one JSON document. This topic explains every part of that output so you can decide what passed, what failed and why, and what to do next. A cell is one spec on one target in one mode at one repeat (and one perturbation in mode P); its run is the record of the agent's answers and of every check's verdict on every block.

## When to use it

* To read the result of a campaign line by line, or to parse it in a script with `--json`.
* To find out why a cell failed: the failing list names each gating verdict that did not pass.
* To tell an agent failure (`fail`) from an infrastructure failure (`failed`) or a budget stop (`stopped`).
* For a scorecard file, a comparison of two campaigns or a CI gate, use the results area commands (`report`, `compare`, `ci`).

## Commands and every option

The three commands share this output. Their own options are in their topics; the option that changes the output is:

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--json` | `campaign run`, `campaign resume`, `campaign status` | off | print one JSON document on stdout instead of the lines. Errors and notes still go to stderr. |
| `--detail` | `campaign status` | off | add the compounding, succession and recovery tables, and a `detail` key in JSON (topic running-campaign-status). |

## Inputs

The runs of the campaign: those this command made, and with `resume` and `status` those already in the store. When a cell has several stored runs, the one that stands for it is its latest completed run, else its latest run.

## Outputs and how to read them

### Cell states

| State | Mark | When |
|---|---|---|
| `pass` | `✓` | the run completed, it has at least one block, every block passed, and the end state matched (when the spec declares one) |
| `fail` | `✗` | the run completed, and a block failed or the end state differs: the agent did not do what the spec asks |
| `not_run` | `-` | the run completed with no failure, but a block was not run: its Given carries a layer the target cannot apply. Examples: a `prefix` on an adapter without `seedPrefix`, a forced tool result in `world.tools` on one without `toolStubs`. Neither a pass nor a fail. Run the spec on a target that applies the layer, or drop the layer. Topic running-not-run |
| `blocked` | `-` | the run completed with no failure, but a block was blocked: an ancestor it depends on failed, so it was not run (parent blocks give this status). Neither a pass nor a fail |
| `failed` | `!` | the run ended with an error: a transport failure past its retries, an agent exception, an answer that does not fit the schema. Fix the cause and resume |
| `stopped` | `!` | the run stopped: the driver did not stop within its step limit, or the budget stopped the cell before it started (no run is stored for a budget stop) |
| `pending` | `·` | `status` only: the cell has no stored run yet |

A block has one of four statuses. `pass` and `fail` are measurements: a block passes when every gating verdict on it passes, and fails otherwise. `not_run` and `blocked` are not: the block was never sent to the agent, it has no verdicts, and every pass rate leaves it out and prints its count beside the rate. The runner checks, before it sends a block, that the target can apply every layer of the block's Given (the `capability` check); a layer it cannot apply makes the block `not_run` with kind `unsupported`, never a silently dropped layer. Before that, the Given verifier (topic authoring-spec-check) makes a block whose Given is wrong `not_run` with kind `given_unmet`; after a session opens on an adapter with a sandbox, a seeded file that does not read back as written makes it `not_run` with kind `setup_failed`. In modes F and P the conversation cannot go past a block it did not run, so every later block is `not_run` too, and the end state is not compared. A verdict is `pass`, `fail`, `inconclusive` or `not_applicable`. A gating verdict counts only when its outcome is `pass`: a gating verdict that is `inconclusive` (the check could not show the behaviour) fails the block too. Non-gating verdicts are reported and never fail a block.

### A cell line

```text
<mark> <spec id> · <target> · <mode> · repeat <n>[ · <perturbation id>]  <state>[ (<notes>)]  <detail>
```

* Notes: `reused` (a completed run of the cell was already in the store), `replayed from the cache` (the run came from the cache and cost nothing), `carried from <campaign>, age <n> campaigns` (a `--change` run copied it, topic running-change-carry).
* Detail on `pass`: `<n> blocks`.
* Detail on `not_run` and `blocked`: the same list as on `fail`, with an entry per block not run, `block <index> not_run capability`, or blocked, `block <index> blocked by <ancestor>`.
* Detail on `fail`: the failing list, comma separated. Each entry is `block <index> <verdict id>` for a gating verdict that did not pass, or `end_state <field>` for an end-state field that does not hold. The part of a verdict id before the first dot names the check (`tools`, `must`, `stage`, `execution`, `workspace`, `artifacts`, `ledger`, `flow` and so on); Every check and its verdict ids are listed in `docs/reference/checks.md` of the repository. `no block ran` means the run completed with no block.
* Detail on a budget stop: `not started: the campaign spent $<spent> of its $<budget> budget`.
* Detail on `failed` or another stop: the run's error message.

### The summary line

```text
<n> cells: <p> pass, <f> fail[, <x> not run][, <y> blocked], <e> failed[, <b> stopped by the budget][, <q> pending][, <r> reused][, <c> carried]. Spent $<usd>.
```

`failed` counts failed runs and stops other than the budget. `Spent` sums the cost of the runs this command made, leaving out reused runs and runs replayed from the cache; it is $0.00 for an agent that reports no cost. Amounts under one cent print with four decimals.

### The JSON document

```text
{
  "campaignId": "<id>",
  "stored": true | false,          (false when campaign run had no --store)
  "checks": ["tools", ...],        (the machine checks loaded; empty for status)
  "cells": [ {
      "cellId", "specId", "specHash", "target": { "adapter", "agent"? }, "mode", "repeat",
      "perturbationId"?,            (mode P)
      "state", "reused", "failing": [ "block 0 must.0", ... ],
      "budgetStop"?: { "budgetUsd", "spentUsd" },
      "runId"?, "cacheHit"?, "cost"?, "error"?,
      "endState"?: { "match", "diff": [ { "field", "expected", "observed" } ] },
      "blocks"?: [ { "index", "blockId"?, "injected"?, "pass", "stage"?,
                     "status"?, "notRun"?, "blocked"?,
                     "verdicts": [ { "id", "outcome", "gating", "evidence" } ] } ]
  } ],
  "summary": { "cells", "pass", "fail", "notRun"?, "blocked"?, "failed", "stoppedByBudget", "pending" },
  "radius"?: { ... },               (campaign run --change)
  "detail"?: { ... }                (campaign status --detail)
}
```

The keys after `failing` appear only when the cell has a run. A block's `status` is written only on a block not run or blocked, with `notRun` (`kind`: `given_unmet`, `unsupported` or `setup_failed`; `layer`, `check`, `expected`, `got`) or `blocked` (`by`, `root`, `reason`?); its `pass` is then false, so a reader that knows only `pass` never counts it as a pass. The summary's `notRun` and `blocked` counts appear only when a cell is in that state. `evidence` is a sentence the check wrote, such as `coverage.check called 2 times, expected exactly 2`. `stage` is the stage the block reached.

### Exit codes

| Command | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `campaign run` | every cell passes | a cell fails, failed or was stopped (the budget included), or a `--change` audit found a miss | bad input; nothing ran | no cell failed, but a cell is not run or blocked |
| `campaign resume` | every cell passes | a cell fails, failed or was stopped | bad input | no cell failed, but a cell is not run or blocked |
| `campaign status` | every cell passes | any other state, pending, not run and blocked included: it only reports | bad input, an unknown campaign, or a store with no campaign | |

## Worked example

One cell stopped by a budget of $0, printed as JSON; then the same spec run to completion as JSON. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target function:acme --budget-usd 0 --json --campaign acme-json  # exit 1
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target function:acme --json --campaign acme-json2
```

The first document, after its `checks` list:

```text
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
      "state": "stopped",
      "reused": false,
      "failing": [],
      "budgetStop": {
        "budgetUsd": 0,
        "spentUsd": 0
      }
    }
  ],
  "summary": {
    "cells": 1,
    "pass": 0,
    "fail": 0,
    "failed": 0,
    "stoppedByBudget": 1,
    "pending": 0
  }
}
```

In the second document the cell is `"state": "pass"` with `"runId": "d44b9dfe9d1cf87a"`, `"cacheHit": false`, `"cost": 0`, an `endState` of `{ "match": true, "diff": [] }`, and three blocks. The first block reached the stage `callback`; its first verdicts read:

```text
              "id": "tools.coverage.check.count",
              "outcome": "pass",
              "gating": true,
              "evidence": "coverage.check called 2 times, expected exactly 2"
```

The run id equals the cell id. `stored` is false in both documents because no `--store` was given.

## Common errors

* Every cell reads `fail` with execution, workspace and artifact verdicts: the spec is a task spec run on a chat agent. Run it on its own target (drop `--target`, or use `--route`).
* A gating verdict is `inconclusive` and fails the block: the agent did not report what the check reads (for example no tool calls, no workspace diff). Use an adapter that reports it, or make the expectation non-gating in the spec.
* `Not judged: ...` on the header: the specs name judged criteria and the campaign loads no judge. Those criteria have no verdict and count in no pass or fail; a judge is loaded through a plugin (judging area).
* `failed` cells with an HTTP status or a network error: the agent was unreachable after its retries (topic running-retries). Fix the cause and run `campaign resume`.
* Parsing `--json` output: with `--json`, stdout holds the JSON document alone, and errors and notices (such as the budget scope notice) go to stderr. Redirect stderr away from the parser.
