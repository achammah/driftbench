---
title: Blocks not run and blocked
summary: 'A block whose Given the target cannot apply is `not_run`, never a pass or a fail: how the capability check decides it, how every command counts it, and how `ci --max-not-run` turns it into exit 3.'
commands: []
see_also:
  - running-campaign-run
  - running-outcomes
  - results-ci
  - authoring-prefixes
  - running-targets
  - core-exit-codes
next:
  - running-outcomes
---

## What it is

A block has one of four statuses:

| Status | A measurement? | Means |
|---|---|---|
| `pass` | yes | the agent got the block, and every gating verdict passed |
| `fail` | yes | the agent got the block, and a gating verdict did not pass |
| `not_run` | no | the block was never sent to the agent: its Given could not be applied |
| `blocked` | no | the block was not run because an earlier block it depends on failed |

`not_run` and `blocked` are not results about the agent. A block with either status has no verdicts. Its `pass` field is false, so an older reader never counts it as a pass. Every pass rate leaves it out and prints its count beside the rate.

Before it sends a block, the runner checks that the target can apply every layer of the block's Given. This is the `capability` check. It is always on, and it has no option.

| Layer of the Given | The target needs | Adapters that lack it |
|---|---|---|
| a `prefix` the spec writes, at this block or an earlier one | the `seedPrefix` capability | `nexus`, live Claude Code |
| in mode T, the canonical history the runner builds from the blocks before | the `seedPrefix` capability | `nexus`, live Claude Code |
| a forced result or error in `world.tools` | the `toolStubs` capability | `process`, `nexus`, live Claude Code, Claude Code replay, `openai-agents`, `langgraph`, `crewai`, `pydantic-ai`, and `http` by default |

A layer the target cannot apply makes the block `not_run` with kind `unsupported`. Before this check existed, the layer was dropped without a word, and the block measured something other than the spec.

How the run goes on after a block that was not run depends on the mode:

* Free-running (F) and perturbed (P): the conversation cannot go past a block it did not run. Every later block of the spec is `not_run` too, and the agent is not asked again.
* Teacher-forced (T): each block starts from its own Given, so each block is checked alone. A block after the first also starts from the canonical history of the blocks before. On `nexus` and live Claude Code, every block after the first is therefore `not_run`.

A run that holds a block not run never compares its end state, so a setup gap never reads as a failure of the agent.

`blocked` is part of the record format. No command of this release writes it; `report`, `compare`, `ci` and the store already read it.

## When to use it

* Read this topic when a cell line starts with `-`, a summary line says `not run`, or `ci` exits 3.
* Run a spec on a target that cannot apply its Given only to learn which blocks that target can measure. The not-run blocks name the layer that is missing.
* Keep `--max-not-run` at its default 0 for a gate. A gate that ignores blocks not run would call a smaller suite a pass.
* Raise `--max-not-run` for an exploratory suite on a new target, where you expect part of the suite to be out of reach. The specs below the threshold are still listed.

Do not read a `not_run` block as a pass, and do not fix it by deleting the layer from the spec without thinking: the layer is part of what the block tests. Change the target, or write the earlier turns as blocks.

## Commands and every option

No command has an option that turns the capability check off.

### driftbench campaign run

The cell states and the exit code change; the options do not. A cell is `not_run` when its run completed, no block failed, and a block was not run. A cell with both a failing block and a block not run is `fail`: a measured failure stands.

| Exit | When |
|---|---|
| 0 | every cell passes |
| 1 | a cell fails, failed or was stopped |
| 2 | bad input; nothing ran |
| 3 | no cell failed, but a cell is not run or blocked |

`campaign resume`, `campaign rejudge` and `family verify` follow the same rule: when nothing failed but something was not run, they exit 3. `campaign resume` reuses a stored run whose block was not run: the cell line reads `not_run (reused)`, and its blocks are never sent again. To measure the spec, run it in a new campaign on a target that applies the layer.

### driftbench ci

```
driftbench ci --specs <path> --target <adapter[:agent]> --baseline <campaign|store> --store <file> [--max-not-run <share>] [options]
```

| Option | Default | Meaning |
|---|---|---|
| `--max-not-run <share>` | `0` | the largest share of a spec's fresh blocks that may be not run, from 0 to 1. A spec above it makes the verdict `not-run`, exit 3. The default 0 means any block not run fails the gate. A carried run is not counted |

Every other option of `ci` is in the topic results-ci. In the GitHub Action, the input `max-not-run` passes this option; empty means 0.

The verdicts rank in this order: `radius-miss`, then `regression`, then `not-run`, then the rest. A regression is what compare's own test calls regressed, in the goldens that ran. So a regression gives exit 1 whether or not some other spec was not run, and the not-run specs stay listed in its reasons. With `--max-not-run 1`, no spec is over the threshold, so the comparison decides the verdict as usual.

| Exit | When |
|---|---|
| 0 | parity |
| 1 | a radius miss, a regression (even with blocks not run), not shown non-inferior, incomplete, a failing aggregate |
| 2 | bad input, a `--max-not-run` outside 0 to 1 included |
| 3 | a spec has more of its blocks not run than `--max-not-run` allows, and compare finds no regression |

## Inputs

Nothing new to write. A block becomes `not_run` from what the spec already holds and what the target declares:

```yaml
# Fictional data only. A forced tool result needs an adapter with toolStubs.
given:
  world:
    tools:
      notify_sales:
        result: { ticket_id: LEAD-TEST01, queued: true }
```

On `function:acme-sales` this block runs: the function adapter has `toolStubs`. On a `process:` target it is `not_run`, because a process agent cannot receive a forced result.

## Outputs and how to read them

### The cell line and the summary line of campaign run

```text
- <spec> · <target> · <mode> · repeat <n>  not_run  block <i> not_run capability, ...
<n> cells: <p> pass, <f> fail, <x> not run, <e> failed. Spent $<usd>.
```

The mark is `-`, for `not_run` and `blocked` alike. The list after the state has one entry per block: `block <i> not_run <check>`, or `block <i> blocked by <ancestor>`. The summary line shows `not run` and `blocked` only when a cell is in that state.

### The JSON of campaign run

With `--json`, a block not run carries three more keys:

| Key | Holds |
|---|---|
| `status` | `not_run` or `blocked`; absent on a block that passed or failed |
| `notRun.kind` | `unsupported` (the target cannot apply a layer), `given_unmet` (the Given itself is wrong) or `setup_failed` (the setup did not hold) |
| `notRun.layer` | the layer of the Given: `1 history` for a prefix, `5 world` for the world |
| `notRun.check` | the check that refused it: `capability` here |
| `notRun.expected` | what the check expected, such as `the adapter applies a prefix (seedPrefix)` |
| `notRun.got` | what it found, such as `nexus declares seedPrefix false: the agent would never see it` |
| `blocked.by`, `blocked.root`, `blocked.reason` | the block it depends on that failed, the earliest failing one, and why |

A later block that was not run because an earlier one was not run says so in `got`: `block <i> was not run, so the conversation cannot reach this block: <the first reason>`. The summary gains `notRun` and `blocked` counts only when they are above 0.

### report, compare, JUnit and the pass rates

* `report` prints `Campaign <id>: <n> runs, <p> pass, <f> fail, <x> not run, <b> did not complete.`, with `<y> blocked, ` after `not run` when a run is blocked. The suite headline of each mode leaves such runs out of its rate and prints their share after it, such as `1 golden, 50.0% not run.` The scorecard and the run page give such a run or block its own badge, `not run` or `blocked`, with the reason.
* `compare` pairs a golden on its scored runs only. A golden with no scored run is not paired, with the reason `not measured in the candidate: block <i> not run (<check>: <got>)`, or `in the baseline`. `compare` has no threshold for blocks not run: it decides on the paired goldens alone, so a golden not run never changes its verdict or its exit code. Only `ci` fails on blocks not run.
* The JUnit file marks such a run `<skipped>`, with the first reason as its message, such as `block 0 not run: capability: process declares toolStubs false: the agent would never see it`, and counts it in the `skipped` of its test suite.
* The `pass-rate` aggregate, reliability, spread, succession and the compounding index count scored blocks only.
* A run with a block not run is never carried by `--change`, and a re-judge leaves that block as it was.

### The ci summary

When a candidate block was not run, the table gains one line before `Why:`:

```text
Not run (--max-not-run <threshold>): <spec> <x> of <n> blocks, over the threshold (<mode> block <i>: <check>, <got>).
```

`, over the threshold` appears only on the specs above it. The JSON summary gains `notRun`:

| Key | Holds |
|---|---|
| `threshold` | the `--max-not-run` value |
| `specs` | one entry per candidate spec with a block not run: `specId`, `notRun` (blocks not run), `blocks` (fresh blocks), `share` (the two divided, rounded), `first` (the first reason) |
| `over` | the ids of the specs above the threshold |

The key is absent when no block was not run.

## Worked example

The Acme tool-failure spec forces a result for `notify_sales` in `world.tools`. It passes on its own target, `function:acme-sales`. A `process:` target cannot receive a forced result, so every block of it is not run there. No block reaches the agent, and no model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --store nr.db --campaign baseline
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --mode T,F # exit 3
```

```text
$ driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --store nr.db --campaign baseline
Campaign baseline: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 1 criterion in 3 blocks of 1 spec (honest_failure), 1 of them gating. This campaign loads no judge, so it has no verdict and counts in no pass or fail. See docs/concepts/judges.md.
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
$ driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --mode T,F
Note: acme-tool-failure names the function adapter; --target runs it on process:my-agent.
Campaign c-4078475b2180: 2 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 1 criterion in 3 blocks of 1 spec (honest_failure), 1 of them gating. This campaign loads no judge, so it has no verdict and counts in no pass or fail. See docs/concepts/judges.md.
- acme-tool-failure · process:my-agent · T · repeat 0  not_run  block 0 not_run capability, block 1 not_run capability, block 2 not_run capability
- acme-tool-failure · process:my-agent · F · repeat 0  not_run  block 0 not_run capability, block 1 not_run capability, block 2 not_run capability
2 cells: 0 pass, 0 fail, 2 not run, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 3)
```

The first run passes. In the second, every block of both cells is `not_run` with check `capability`: in T each block is checked alone, in F the run stops at block 0.

The same run as JSON shows the reason of each block (the list of checks is cut short here):

```sh
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --json # exit 3
```

```text
$ driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --json
{
  "campaignId": "c-07e62fae7703",
  "stored": false,
  "checks": ["tools", "tools_offered", "...", "custom"],
  "cells": [
    {
      "cellId": "c33e3d92fa4b07da",
      "specId": "acme-tool-failure",
      "specHash": "e5bc5c9ba9d2",
      "target": {
        "adapter": "process",
        "agent": "my-agent"
      },
      "mode": "F",
      "repeat": 0,
      "state": "not_run",
      "reused": false,
      "failing": [
        "block 0 not_run capability",
        "block 1 not_run capability",
        "block 2 not_run capability"
      ],
      "runId": "c33e3d92fa4b07da",
      "cacheHit": false,
      "cost": 0,
      "blocks": [
        {
          "index": 0,
          "pass": false,
          "status": "not_run",
          "notRun": {
            "kind": "unsupported",
            "layer": "5 world",
            "check": "capability",
            "expected": "the adapter applies forced tool results (notify_sales, coverage.check) (toolStubs)",
            "got": "process declares toolStubs false: the agent would never see it"
          },
          "verdicts": []
        },
        {
          "index": 1,
          "pass": false,
          "status": "not_run",
          "notRun": {
            "kind": "unsupported",
            "layer": "5 world",
            "check": "capability",
            "expected": "the adapter applies forced tool results (notify_sales, coverage.check) (toolStubs)",
            "got": "block 0 was not run, so the conversation cannot reach this block: process declares toolStubs false: the agent would never see it"
          },
          "verdicts": []
        },
        {
          "index": 2,
          "pass": false,
          "status": "not_run",
          "notRun": {
            "kind": "unsupported",
            "layer": "5 world",
            "check": "capability",
            "expected": "the adapter applies forced tool results (notify_sales, coverage.check) (toolStubs)",
            "got": "block 0 was not run, so the conversation cannot reach this block: process declares toolStubs false: the agent would never see it"
          },
          "verdicts": []
        }
      ]
    }
  ],
  "summary": {
    "cells": 1,
    "pass": 0,
    "fail": 0,
    "notRun": 1,
    "failed": 0,
    "stoppedByBudget": 0,
    "pending": 0
  }
}
(exit 3)
```

`ci` with the default threshold fails with exit 3. With `--max-not-run 1`, no spec is over the threshold, and the comparison decides: no golden of the candidate was measured, so parity is not shown, exit 1. A share above 1 is bad input:

```sh
driftbench ci --specs examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --baseline baseline --store nr.db --out nr.json # exit 3
driftbench ci --specs examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --baseline baseline --store nr.db --out explore.json --max-not-run 1 # exit 1
driftbench ci --specs examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --baseline baseline --store nr.db --max-not-run 2 # exit 2
```

```text
$ driftbench ci --specs examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --baseline baseline --store nr.db --out nr.json
driftbench ci: candidate process:my-agent (campaign c-cddaad1476c1) against baseline campaign baseline, compared as driftbench compare does (golden by golden, every repeat).
Margin auto: 79.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 79.35 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 79.3 points); about 22 goldens would.
  measure                                      value
  goldens paired                               0
  both pass                                    0
  regressed                                    0
  improved                                     0
  both fail                                    0
  new gating flags                             0
  all-pass regression effect                   0.00 points
  95% interval                                 [0.00, 0.00] points
  margin                                       79.5 points (auto)
  smallest margin these pairs can show         100 points
  gating criteria not shown within the margin  0
  underpowered (under 30 goldens)              0, left out of the parity test
  verdict                                      NOT RUN
Not run (--max-not-run 0): acme-tool-failure 3 of 3 blocks, over the threshold (F block 0: capability, process declares toolStubs false: the agent would never see it).

Why:
  - 1 spec of the candidate had blocks not run beyond --max-not-run 0: acme-tool-failure. A block not run is a Given the target could not apply, never a pass: fix the spec or the target, or raise the threshold for an exploratory suite
  - no golden of the candidate ran, so none is compared

Verdict: NOT RUN. Exit 3.
Summary: nr.json
(exit 3)
$ driftbench ci --specs examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --baseline baseline --store nr.db --out explore.json --max-not-run 1
driftbench ci: candidate process:my-agent (campaign c-fc2ca6ebadac) against baseline campaign baseline, compared as driftbench compare does (golden by golden, every repeat).
Margin auto: 79.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 79.35 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 79.3 points); about 22 goldens would.
  measure                                      value
  goldens paired                               0
  both pass                                    0
  regressed                                    0
  improved                                     0
  both fail                                    0
  new gating flags                             0
  all-pass regression effect                   0.00 points
  95% interval                                 [0.00, 0.00] points
  margin                                       79.5 points (auto)
  smallest margin these pairs can show         100 points
  gating criteria not shown within the margin  0
  underpowered (under 30 goldens)              0, left out of the parity test
  verdict                                      NOT SHOWN NON-INFERIOR
Not run (--max-not-run 1): acme-tool-failure 3 of 3 blocks (F block 0: capability, process declares toolStubs false: the agent would never see it).

Why:
  - no golden of the candidate ran, so none is compared

Verdict: NOT SHOWN NON-INFERIOR. Exit 1.
Not shown non-inferior is not a regression: no evidence of a drop, but the intervals are wider than the margin. Add goldens, widen the margin, or let --margin auto choose it.
Summary: explore.json
(exit 1)
$ driftbench ci --specs examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --baseline baseline --store nr.db --max-not-run 2
--max-not-run takes a share from 0 to 1, not "2".
(exit 2)
```

Read the first `ci` output from the bottom: `Verdict: NOT RUN. Exit 3.`, then the `Not run` line names the spec and the first reason. The fix is a target that applies the layer, here the function target the baseline ran on.


### Resume, report, compare and a regression

A stored campaign of the same run, resumed. A process target needs its `--process-command` again on resume:

```sh
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target process:my-agent --process-command my-agent --store nr.db --campaign nr # exit 3
driftbench campaign resume nr --store nr.db --process-command my-agent # exit 3
```

```text
$ driftbench campaign resume nr --store nr.db --process-command my-agent
...
- acme-tool-failure · process:my-agent · F · repeat 0  not_run (reused)  block 0 not_run capability, block 1 not_run capability, block 2 not_run capability
1 cell: 0 pass, 0 fail, 1 not run, 0 failed, 1 reused. Spent $0.00.
(exit 3)
```

The stored run is reused, so its blocks are not sent again. Next, a suite of two specs: the tool failure conversation and the price sheet task. On the Acme ops agent (`process:acme-ops`), the price sheet passes and the conversation is not run:

```sh setup
mkdir mixed
cp examples/acme/specs/conversations/tool-failure.yaml examples/acme/specs/tasks/price-sheet.yaml mixed
```

```sh
driftbench campaign run mixed --store mixed.db --campaign mixed-base
driftbench campaign run mixed --target process:acme-ops --store mixed.db --campaign mixed-ops # exit 3
driftbench report mixed-ops --store mixed.db --out mixed.html --junit mixed.xml
driftbench compare --baseline mixed-base --candidate mixed-ops --store mixed.db --margin 80
```

```text
$ driftbench report mixed-ops --store mixed.db --out mixed.html --junit mixed.xml
...
Campaign mixed-ops: 2 runs, 1 pass, 0 fail, 1 not run, 0 did not complete.
Suite pass rate, mode F: 100.0% no interval: one cluster (one golden); 1 golden, 50.0% not run.
Wrote mixed.html and mixed.xml.
$ driftbench compare --baseline mixed-base --candidate mixed-ops --store mixed.db --margin 80
...
Not paired:
  acme-tool-failure · F  not measured in the candidate: block 0 not run (capability: process declares toolStubs false: the agent would never see it)

Verdict: NON-INFERIOR.
  every gating criterion and the all-pass flag have an upper bound below the margin 80.0 points, and no new gating flag
```

The pass rate counts the one scored run, and `50.0% not run` gives the share left out. `compare` exits 0: the golden not run is listed, not counted. In `mixed.xml` the run not run is a skipped test case:

```text
  <testsuite name="acme-tool-failure" tests="1" failures="0" errors="0" skipped="1" time="0.000" timestamp="...">
    <testcase classname="acme-tool-failure" name="process:acme-ops · F · repeat 0" time="0.000">
      <skipped message="block 0 not run: capability: process declares toolStubs false: the agent would never see it"/>
```

Last, a regression and a spec not run in one `ci`. The fault `x3-skips-recap` breaks the order conversations. The route sends the `flow:new-home` conversations to the ops agent: there the tool failure spec is not run, and the two others fail. The regression wins: exit 1, not 3.

```sh
driftbench campaign run examples/acme/specs/conversations --store conv.db --campaign conv
driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --route flow:new-home=process:acme-ops --baseline conv --store conv.db --out regress.json # exit 1
```

```text
$ driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --route flow:new-home=process:acme-ops --baseline conv --store conv.db --out regress.json
...
  verdict                                      REGRESSION
...
Not run (--max-not-run 0): acme-tool-failure 3 of 3 blocks, over the threshold (F block 0: capability, process declares toolStubs false: the agent would never see it).

Why:
  - 5 goldens regressed: acme-new-customer-coverage · F, acme-number-porting · F, acme-off-topic-return · F, acme-order-loose-confirmation · F, acme-plan-upgrade · F
...
Verdict: REGRESSION. Exit 1.
(exit 1)
```
## Common errors

| Message or symptom | Cause | Fix |
|---|---|---|
| a cell line `- ... not_run  block 0 not_run capability`, and `got` says `<adapter> declares seedPrefix false: the agent would never see it` | the spec writes a `prefix` and the target cannot hand it to the agent | run on an adapter with `seedPrefix`, or write the earlier turns as blocks |
| the same, with `declares toolStubs false` and `expected` naming `forced tool results (<tools>)` | the Given forces a tool result and the target cannot apply it | run on an adapter with `toolStubs`, such as `function`, or move the forced result into the agent's own test double |
| every block after the first is `not_run`, `got` starting `block 0 was not run, so the conversation cannot reach this block` | modes F and P stop at the first block not run | fix the first block; the rest follow |
| `Verdict: NOT RUN. Exit 3.` from `ci` | a spec has blocks not run beyond `--max-not-run` | fix the spec or the target; for an exploratory suite, raise `--max-not-run` |
| `--max-not-run takes a share from 0 to 1, not "<value>".` (exit 2) | a value below 0, above 1, or not a number | give a share such as `0.25`; it is a share, not a percentage |
| `unpaired` reason `not measured in the candidate: ...` in `compare` or `ci` | every run of that golden had a block not run | the same fix as the block's own reason |
| a cell with a block not run runs again though `--change` was given | a run that holds a block not run is never carried | expected: it has no result to carry |
| `No adapter is set up for process:<name>.` from `campaign resume` (exit 2) | the campaign's target is a process agent, and resume was not given its command | pass the same `--process-command` as the run |
| `campaign resume` exits 3 again and the cell reads `not_run (reused)` | resume reuses the stored run; it never sends a block not run again | run the spec in a new campaign, on a target that applies the layer |
| `ci` exits 1, not 3, though a spec has blocks not run | a regression wins over blocks not run: the `Why` lines name the regressed goldens first | fix the regression; the not-run line still names the spec |
