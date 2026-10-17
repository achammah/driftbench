---
title: Check that an agent is deterministic
summary: driftbench smoke runs one spec several times with the cache off and no checks. It reports whether the transcripts of what the agent did are identical, and where they first differ.
commands:
  - smoke
see_also:
  - running-campaign-run
  - running-cache
  - running-targets
  - running-modes
next:
  - running-simulate
---

## What it is

`driftbench smoke` is the determinism check. It runs one spec several times (3 by default) in mode F, with the cache off and no checks. It then compares the transcripts of the runs block by block against the first run. A transcript holds what the agent did in each block. It holds the text segments and the tool calls with their inputs and outputs. It holds the runtime report (skills, guard verdicts, stages, references, subagents) and the commands with their exit codes. It holds the artifacts and the workspace diff. It leaves out what may vary between two identical runs: cost, latency, timestamps and the raw trace. It also says whether the adapter claims to be deterministic, so a claim the runs contradict is visible.

## When to use it

* Before trusting replays and caches: a deterministic agent gives the same answers for the same inputs, so one run stands for many.
* Before choosing repeats: a non-deterministic agent needs repeats (`--repeats`) and statistics to say anything.
* After wiring a new target or plugin, as a quick end-to-end check that the agent answers every block.
* Not to check behaviour: smoke applies no check. Use `campaign run` for pass and fail.

## Commands and every option

```text
driftbench smoke <spec> [--target <adapter[:agent]>] [--runs <n>] [--json]
```

| Option | Default | Effect |
|---|---|---|
| `<spec>` | required | one spec file. A folder or a path holding several specs is refused. |
| `--target <adapter[:agent]>` | the spec's own target | the target to run on (topic running-targets). |
| `--runs <n>` | `3` | how many runs to compare; a whole number of at least 2. |
| `--json` | off | print one JSON document. |
| `--plugin <module>` | none | global option: load a plugin, for example one that registers the adapter. |

Every run is repeat 0 in mode F with the scripted driver. Nothing is stored and the cache is never used.

## Inputs

One spec file and a target the CLI reaches. A process target runs in a fresh sandbox each time.

## Outputs and how to read them

Text output:

```text
Smoke: <spec id> on <target>, <n> runs, cache off.
  run <i>  <status>  <n> blocks  transcript <hash>[  <error>]
✓ The transcripts are identical.
```

The transcript hash is the first 12 hex characters of the SHA-256 of the transcript's canonical JSON: equal hashes mean equal transcripts. `✗ The transcripts differ: run <i> first differs from run 1 at block <k>[ (<block id>)].` is the check line when they differ. Either `  The adapter claims to be deterministic, so the difference at block <k> fails that claim.` follows it as a second line. Or `  The adapter does not claim to be deterministic.` follows it. When a run did not complete: `✗ <n> of <runs> runs did not complete.`

`--json` prints `{ "specId", "target", "runs": [ { "status", "blocks", "error"? } ], "deterministicClaim", "identical", "hashes": [...], "firstDifference"?: { "run", "block", "blockId"? } }`. In `firstDifference`, `run` and `block` count from 0.

Exit codes: 0 when the transcripts are identical and every run completed. 1 when they differ or a run did not complete. 2 on bad input (nothing ran).

## Worked example

The Acme sales agent on the plan-upgrade conversation, then the Acme ops agent on the price-sheet task, twice, as JSON. No model is called.

```sh
driftbench smoke examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme
driftbench smoke examples/acme/specs/tasks/price-sheet.yaml --runs 2 --json
```

```text
Smoke: acme-plan-upgrade on function:acme, 3 runs, cache off.
  run 1  completed  5 blocks  transcript 9ec7c3e69cd4
  run 2  completed  5 blocks  transcript 9ec7c3e69cd4
  run 3  completed  5 blocks  transcript 9ec7c3e69cd4
✓ The transcripts are identical.
```

```text
{
  "specId": "acme-price-sheet",
  "target": {
    "adapter": "process",
    "agent": "acme-ops"
  },
  "runs": [
    {
      "status": "completed",
      "blocks": 2
    },
    {
      "status": "completed",
      "blocks": 2
    }
  ],
  "deterministicClaim": true,
  "identical": true,
  "hashes": [
    "e0561da3aa0d",
    "e0561da3aa0d"
  ]
}
```

Both Acme agents are deterministic and claim it. The task's transcript includes the workbook it wrote (hash and size) and the workspace diff. For that reason even the produced file is the same byte for byte across runs.

## Common errors

Each exits 2.

* `smoke takes one spec; examples/acme/specs/conversations holds 6.` Give one spec file.
* `--runs takes a whole number of at least 2, not "1".`
* `No adapter is set up for <target>. ...` (topic running-targets).
* `<spec> names no target. Give the spec a target, or run with --target <adapter[:agent]>, such as --target function:acme-sales.`

Results that look like errors:

* `✗ The transcripts differ ... The adapter claims to be deterministic, so the difference at block <k> fails that claim.` (exit 1). Fix the agent (fixed seeds, fixed clock in what it writes), or drop the `deterministic` claim of the target.
* A model target that differs at block 0: a model is not deterministic. Use repeats and statistics instead of a single run.
