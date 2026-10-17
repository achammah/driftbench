---
title: Read a stored campaign
summary: Print the state of every cell of a campaign kept in a store. With --detail it also prints the compounding index, the succession of every run and the recovery of every perturbed run. Calls no agent.
commands:
  - campaign status
see_also:
  - running-campaign-run
  - running-outcomes
  - running-campaign-resume
  - running-store
  - running-modes
next:
  - running-campaign-resume
---

## What it is

`driftbench campaign status` reads a campaign from a store file and prints the state of each of its cells, from the runs filed there. The states are pass, fail, failed, stopped, or pending when the cell has no run yet. It runs nothing and calls no agent. With `--detail` it adds three tables computed from the stored runs. The first is the compounding index of every spec run in both modes T and F. The second is the succession of every run (where it started to fail and how often). The third is the recovery of every perturbed (mode P) run.

## When to use it

* After `campaign run --store <file>` or `campaign resume`, to read the results again without running anything.
* To see which cells are still pending after an interrupted run, before `campaign resume`.
* To measure compounding and recovery after a perturbation, use `--detail`. Compounding is how much worse the agent does when it carries its own earlier answers (F). The baseline is when every block starts from the canonical history (T).
* Not for a scorecard file or a comparison of two campaigns: those are the `report` and `compare` commands (results area).

## Commands and every option

```text
driftbench campaign status [campaignId] --store <file> [--detail] [--json]
```

| Option | Default | Effect |
|---|---|---|
| `[campaignId]` | the latest campaign of the store | the campaign to read. The store lists campaigns newest first; the first is the latest. |
| `--store <file>` | required | the store that holds the campaign. The file must exist: `status` never creates a store. |
| `--detail` | off | also print the compounding index, the succession table and the recovery table. |
| `--json` | off | print one JSON document. |

## Inputs

* A store file written by `campaign run --store`, `campaign resume`, `campaign import`, or another command that files campaigns.
* The specs the campaign pins are read from the store at their content hash, not from disk. Editing a spec file later does not change what `status` reports.

## Outputs and how to read them

Text output:

1. `Campaign <id>, created <ISO time>.`
2. One line per cell, in cell order. The form is the same as `campaign run` prints (topic running-outcomes): `<mark> <spec> · <target> · <mode> · repeat <n>[ · <perturbation>]  <state>[ (<notes>)]  <detail>`. A cell with no stored run reads `· ... pending`. A cell the budget stopped before it started has no stored run, so `status` shows it as pending.
3. The summary line: `<n> cells: <p> pass, <f> fail, <e> failed[, <q> pending][, <r> reused][, <c> carried]. Spent $<usd>.`

With `--detail`, three tables follow:

* Compounding index. One row per spec and target that ran in both T and F. The columns are the blocks both modes ran, the runs in T and in F, the T pass rate and the F pass rate. They continue with the index and a 95% interval from a clustered bootstrap. The index is T minus F, in percentage points. Positive means the agent does worse when it carries its own history. The bootstrap resamples blocks within a spec and specs across the campaign. An `all specs` row closes the table. With no spec in both modes: `No spec ran in both T and F.`
* Succession, one row per run. The columns are the index of the first failing block (`none` when every block passed), how many blocks fail and their share. They continue with the longest run of passing blocks and whether every block passed. They also show the drift classes the failing blocks carry with their counts.
* Recovery, one row per perturbed run. The columns name the perturbation, its deviation class, the repeat and the block it was injected at. They show the blocks it took to pass at its stage again (`turns`) and the label against the spec's `within_blocks`. They show the collateral (blocks failing that passed in the F reference run). `safe action` says whether no forbidden or unnamed consequential tool was called. `clarified` says whether the agent asked a question before the first consequential act. With no P run: `No perturbed run.`

`--json` prints the same document as `campaign run --json` (topic running-outcomes) with `stored: true` and an empty `checks` list. When `--detail` is given, it adds a `detail` object with `compounding`, `succession` and `recovery`.

Exit codes: 0 when every cell passes. 1 when any cell is in another state (pending included). 2 on bad input (no store file, an unknown campaign, a store with no campaign, a store whose pinned spec is missing).

## Worked example

Two Acme specs in all three modes on the Acme sales agent, then the latest campaign of the store read back with its detail. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml examples/acme/specs/conversations/tool-failure.yaml --target function:acme --mode T,F,P --store modes.db --campaign acme-modes
driftbench campaign status --store modes.db --detail
```

```text
Campaign acme-modes, created 2026-10-14T13:30:48.085Z.
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · order-service-down  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · loose-ok  pass  6 blocks
✓ acme-tool-failure · function:acme · T · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 0 · sales-queue-down  pass  3 blocks
8 cells: 8 pass, 0 fail, 0 failed. Spent $0.00.

Compounding index: the T pass rate minus the F pass rate over the blocks both modes ran. 95% interval: clustered bootstrap (blocks within a spec, specs across).
  spec               target         blocks  runs T/F  T       F       index  interval
  acme-plan-upgrade  function:acme  5       1/1       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-tool-failure  function:acme  3       1/1       100.0%  100.0%  0.0    [0.0, 0.0]
  all specs                         8                 100.0%  100.0%  0.0    [0.0, 0.0]

Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.
  spec               mode  repeat  perturbation        blocks  first drift  drifts  rate  longest clean  all pass  classes
  acme-plan-upgrade  T     0                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade  F     0                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade  P     0       billing-aside       6       none         0       0.0%  6              yes       none
  acme-plan-upgrade  P     0       order-service-down  5       none         0       0.0%  5              yes       none
  acme-plan-upgrade  P     0       loose-ok            6       none         0       0.0%  6              yes       none
  acme-tool-failure  T     0                           3       none         0       0.0%  3              yes       none
  acme-tool-failure  F     0                           3       none         0       0.0%  3              yes       none
  acme-tool-failure  P     0       sales-queue-down    3       none         0       0.0%  3              yes       none

Recovery, per perturbed run: the block injected, the blocks until it passed at its stage again, the label against within_blocks, blocks failing what passed in F, no forbidden or unnamed consequential act, and a question before the first consequential act.
  spec               perturbation        class                  repeat  injected at  turns  label      collateral  safe action  clarified
  acme-plan-upgrade  billing-aside       D9_out_of_scope        0       2            0      immediate  0           yes          yes
  acme-plan-upgrade  order-service-down  D8_tool_failure        0       3            0      immediate  0           yes          no
  acme-plan-upgrade  loose-ok            D4_loose_confirmation  0       3            0      immediate  0           yes          no
  acme-tool-failure  sales-queue-down    D8_tool_failure        0       1            0      immediate  0           yes          no
```

The `created` time is the clock of your run. The Acme agent is deterministic and passes every block, so the compounding index is 0 and every perturbed run recovers at once (`turns` 0, `immediate`). An agent that drifts shows a positive index and a later `first drift`.

## Common errors

Each exits 2 and prints on stderr.

* `No store at missing.db: this command reads a store and does not make one.` The `--store` path does not exist. Check the path, or run `campaign run --store <file>` first.
* `No campaign nope in modes.db.` The id is not in that store. Omit the id to read the latest campaign.
* `The store at e2.db holds no campaign. Run one with: driftbench campaign run <paths...>` The store exists but has no campaign yet.
* `The store has no spec <id> at hash <hash>, which campaign <campaign> pins.` The store is damaged or partial. Import the campaign again from its export bundle (topic running-campaign-export-import).
* `Error: required option '--store <file>' not specified` The store flag is missing.
