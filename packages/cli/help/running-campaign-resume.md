---
title: Stop and resume a campaign
summary: Interrupt a campaign at any time and finish it later with campaign resume. It runs only the cells with no completed run and reuses the others.
commands:
  - campaign resume
see_also:
  - running-campaign-run
  - running-campaign-status
  - running-store
  - running-cache
  - running-cleanup
  - running-budget-and-prices
  - running-outcomes
next:
  - running-store
---

## What it is

A stored campaign can stop before every cell has run. You pressed Ctrl-C, the machine went down, the budget stopped the remaining cells, or some runs failed with an error. `driftbench campaign resume` finishes it. It reads the campaign from the store. It uses the specs at the content hashes the campaign pinned and the target the campaign pinned for each cell. It runs every cell that has no completed run. A cell whose completed run is already in the store (pass or fail) is reused and not run again. A cell whose run failed with an error or stopped runs again, and its new run replaces the old one under the same run id. `resume` never creates a new campaign.

## When to use it

* After an interrupted `campaign run --store <file>`: the runs already finished are kept, and `resume` runs the rest.
* After cells were stopped by `--budget-usd`: resume with a higher budget, or with none.
* After runs failed with an error (a network failure past its retries, an agent crash): fix the cause and resume; only those cells run again.
* Not to rerun cells that completed: a completed run, even a failing one, is reused. To measure again, start a new campaign with `campaign run`.
* Not without a store: a campaign run without `--store` lives in memory and is gone when the command ends.

## Commands and every option

```text
driftbench campaign resume [campaignId] --store <file> [--no-cache] [--concurrency <n>] [--budget-usd <usd>] [--prices <file>] [--process-command <command>] [--retry-attempts <n>] [--retry-base-ms <ms>] [--retry-max-ms <ms>] [--json]
```

| Option | Default | Effect |
|---|---|---|
| `[campaignId]` | the latest campaign of the store | the campaign to finish. |
| `--store <file>` | required | the store that holds the campaign. It must exist: `resume` never creates a store. |
| `--no-cache` | cache on | neither replay blocks from the cache nor write to it. |
| `--concurrency <n>` | `4` | cells that run at the same time; at least 1. |
| `--budget-usd <usd>` | the budget the campaign was run with | a hard stop on the campaign's whole spend, the runs already stored included. A campaign run without a budget is stored with budget 0, which `resume` reads as no budget. |
| `--prices <file>` | the `prices:` key of `driftbench.yaml` in the working folder | a dated USD token price table. Keep it available when the campaign used one: stored token-only runs are priced again before the budget check. |
| `--process-command <command>` | none | the command behind a `process:<name>` target. A campaign stores its targets, not the commands behind them: resume a campaign run with `--process-command` with the same `--process-command`. |
| `--retry-attempts <n>` | `4` | attempts per model call, the first included. |
| `--retry-base-ms <ms>` | `500` | the wait before the first retry, doubled for each later one. |
| `--retry-max-ms <ms>` | `30000` | the longest wait between two attempts. |
| `--json` | off | print one JSON document (topic running-outcomes). |

`resume` takes no `--target`, `--mode`, `--repeats`, `--cache-suite` or `--config`. The cells are those the campaign was created with. The project config is not read for them.

## Inputs

* The store file, with the campaign record, the pinned specs and the runs filed so far.
* The same adapters the campaign needs: each pinned target must still resolve (topic running-targets).
* The cache in the same store: blocks observed before an interruption are read back from it (see below).

### What survives an interruption

* Every run is filed in the store as it finishes, so a crash or Ctrl-C loses no finished run.
* A cell that was in flight has no stored run: `status` shows it `pending`, and `resume` runs it.
* Each block an adapter answered is written to the cache as soon as it is observed (for adapters without a sandbox). When `resume` runs that cell again, the blocks the cache holds are read back. The first block it does not hold goes to the adapter, which opens a session from the history so far. For an agent that keeps no state between blocks, the resumed run gives the same verdicts as an uninterrupted one. For an agent with state (a record it wrote), the state of the finished blocks is not recreated. The resumed run sees the agent as it is at the resume.
* A run in a sandbox (a `process` target) is never cached: an interrupted sandboxed cell runs again from its first block.
* On Ctrl-C (SIGINT) or SIGTERM, the CLI kills the process groups of the commands it started. It also removes its open sandbox folders, then exits (topic running-cleanup). A SIGKILL skips that sweep.
* Each stored run keeps its events (block start, model call, tool call, retry, block end, run end) on its record. The viewer reads them as a timeline. From code, `eventLogSink(path)` of `@agent-nexus/driftbench-core` appends each event to a JSON-lines file as it happens. `readEventLog(path)` reads it back and skips a line cut short by a kill.

## Outputs and how to read them

The lines are the same as in `campaign run` (topic running-outcomes). They are the `Campaign <id>: <n> cells, <c> at a time.` header, one line per cell in cell order, and the summary. A cell whose completed run was already stored reads `pass (reused)` or `fail (reused)`, and the summary adds `<n> reused`. The spend counts only the runs this command made. The new runs are filed in the same store under the same campaign.

Exit codes: 0 when every cell passes; 1 when a cell fails, failed or was stopped; 3 when no cell failed but a cell was not run or blocked; 2 on bad input (no store file, an unknown campaign, a store with no campaign, a target with no adapter, a bad number).

## Worked example

A campaign has four cells that a budget of $0 stops. It is read back as pending, finished by `resume`, then resumed again (nothing left to run, every cell reused). No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml examples/acme/specs/conversations/tool-failure.yaml --target function:acme --repeats 2 --budget-usd 0 --store res.db --campaign acme-halted  # exit 1
driftbench campaign status --store res.db  # exit 1
driftbench campaign resume --store res.db
driftbench campaign resume acme-halted --store res.db --no-cache --concurrency 1
```

```text
! acme-plan-upgrade · function:acme · F · repeat 0  stopped  not started: the campaign spent $0.00 of its $0.00 budget
! acme-plan-upgrade · function:acme · F · repeat 1  stopped  not started: the campaign spent $0.00 of its $0.00 budget
! acme-tool-failure · function:acme · F · repeat 0  stopped  not started: the campaign spent $0.00 of its $0.00 budget
! acme-tool-failure · function:acme · F · repeat 1  stopped  not started: the campaign spent $0.00 of its $0.00 budget
4 cells: 0 pass, 0 fail, 0 failed, 4 stopped by the budget. Spent $0.00.
```

```text
· acme-plan-upgrade · function:acme · F · repeat 0  pending
· acme-plan-upgrade · function:acme · F · repeat 1  pending
· acme-tool-failure · function:acme · F · repeat 0  pending
· acme-tool-failure · function:acme · F · repeat 1  pending
4 cells: 0 pass, 0 fail, 0 failed, 4 pending. Spent $0.00.
```

```text
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.00.
```

```text
Campaign acme-halted: 4 cells, 1 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (reused)  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass (reused)  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass (reused)  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass (reused)  3 blocks
4 cells: 4 pass, 0 fail, 0 failed, 4 reused. Spent $0.00.
```

A budget-stopped cell is not stored, so `status` shows it pending. The campaign was run with `--budget-usd 0`, which is stored as 0 and read by `resume` as no budget. For that reason the first `resume` runs all four cells. The second finds a completed run for every cell and runs nothing. The same `resume` finishes a campaign you stopped with Ctrl-C.

## Common errors

Each exits 2 and prints on stderr.

* `No store at nope.db: this command reads a store and does not make one.` The `--store` path does not exist.
* `No campaign x in res.db.` Omit the id to take the latest campaign, or check it with `campaign status`.
* `The store at <path> holds no campaign. Run one with: driftbench campaign run <paths...>`
* `No adapter is set up for process:my-agent. The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. ...` A campaign run with `--target process:my-agent --process-command <command>` was resumed without its `--process-command`. Give the same command it was run with.
* `Error: required option '--store <file>' not specified`
* A token price error naming a model with no price: the campaign has a budget and token-only runs, and no price table is found. Pass `--prices <file>` or keep `prices:` in `driftbench.yaml` (topic running-budget-and-prices).
