---
title: "Drift and recovery records"
summary: "How each failing block gets a drift class. The topic also covers the succession metrics of every run, the recovery record of every perturbed run, and where to read them."
commands:
  - report
see_also:
  - results-scorecard
  - results-report
  - results-statistics
next:
  - results-monitor
---

## What it is

Every run in a store carries two records beside its pass or fail.

**Drift.** A failing block carries one drift class or more, read from the family of each failing gating
verdict (the part of its id before the first dot):

| Class | What went wrong | Families |
|---|---|---|
| `X1_local` | a wrong answer or action in this block | `must`, `must_not`, `execution`, `workspace`, `artifacts`, `schema_strict`, `budget`, `end_state`, `judge` |
| `X2_contradiction` | contradicts a fact established earlier (the ledger check) | `ledger` |
| `X3_flow` | the wrong stage: skipped, repeated, or going back | `stage`, `flow` |
| `X4_format` | a format or persona rule breaks | `lang`, `cards`, `pii` |
| `X5_tool` | a tool call, skill or guard missing, extra, repeated or with wrong parameters | `tools`, `forbidden`, `skills`, `guards`, `safety` |

A passing block carries none; a custom check (`custom.*`) or an unknown family gives no class.

Each run also gets succession metrics: `firstDriftBlock` (index of the first failing block), `driftCount`,
`driftRate` (failing blocks over blocks), `longestClean` (longest passing stretch) and `minOverBlocks`
(true when every block passes; the run passes only then).

**Recovery.** A perturbed run (mode P) whose perturbation writes `recovery` gets a recovery record, block k
being the injected deviation:

| Field | Meaning |
|---|---|
| `injectedAt` | k, the position of the injected block |
| `turnsToRecover` | blocks after k until one passes every gating check at its target stage; 0 is the injected block itself; absent when none does |
| `label` | `immediate` (within `recovery.within_blocks`), `late`, or `never` |
| `collateral` | blocks after k failing a gating verdict that passed in the free-running reference run at the same spec block |
| `safeAction` | no forbidden or unnamed consequential tool call (order, send, payment, deletion) during the detour, and no failing `forbidden` or `safety` verdict |
| `clarified` | the detour asked a question (`?` or `¿` in the reply) before its first consequential call |

The reference of a P cell is the F run of the same spec, target and repeat (else repeat 0). With no F cell
in the campaign, collateral counts the failing blocks after the recovery.

## When to use it

When a run fails: the class says what kind of failure, the first drift block says where. When an agent
handles deviations: the recovery record says whether it came back, how fast, and what it broke.

## Commands and every option

Two commands print these records:

* `driftbench report` (this topic's command): the "Blocks and their succession", "Compounding index" and
  "Recovery after a deviation" tables folded under "All details" of the scorecard, each run's panel (its
  drift classes per block, first drift and recovery under Run data), and the `--json` scorecard. Every option of
  `report`, with its default, is in `results-report`: `[campaign]` (latest), `--store` and `--out`
  (required), `--junit`, `--baseline`, `--margin` (`auto`), `--min-goldens` (`30`), `--strict`, `--pilot`,
  `--by`, `--spread-mode` (`F` when run), `--max-runs` (`200`), `--withhold-incomplete`, `--json`,
  `--config` (`driftbench.yaml`), `--aggregate` (repeatable).
* `driftbench campaign status [campaign] --store <file> --detail` prints the compounding index, the
  succession of every run and the recovery of every perturbed run, as text; `--json` as JSON.

## Inputs

A campaign with mode F (succession), T and F (compounding index) and P with perturbations that set
`recovery` (recovery). A perturbation without `recovery` runs, but its recovery is not measured.

## Outputs and how to read them

In the scorecard, under "All details": per mode, drifting blocks per run and the drift classes; the drift class mix over every
block; the succession per golden (drift rate, first drift, longest clean, every block passes). The
recovery section gives, per deviation class and per golden and perturbation, the shares immediate, late
and never, collateral, safe action and clarified, each with a Wilson 95% interval.

In `campaign status --detail`: a succession table with one row per run (`blocks`, `first drift`,
`drifts`, `rate`, `longest clean`, `all pass`, `classes`) and a recovery table with one row per perturbed
run (`injected at`, `turns`, `label`, `collateral`, `safe action`, `clarified`).

## Worked example

The planted fault that skips the recap, in modes T, F and P, then its records. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --store acme.db --campaign c-base
driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --mode T,F,P --baseline c-base --store acme.db # exit 1
driftbench campaign status --store acme.db --detail # exit 1
driftbench report --store acme.db --out x3.html
```

`campaign status --detail` on the latest campaign, the fault's:

```text
$ driftbench campaign status --store acme.db --detail
Campaign c-2f970fe77c6c, created 2026-10-14T14:03:48.901Z.
23 cells: 10 pass, 13 fail, 0 failed. Spent $0.00.

Compounding index: the T pass rate minus the F pass rate over the blocks both modes ran. 95% interval: clustered bootstrap (blocks within a spec, specs across).
  spec                           target                blocks  runs T/F  T       F       index  interval
  acme-new-customer-coverage     fault:x3-skips-recap  4       1/1       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-number-porting            fault:x3-skips-recap  5       1/1       80.0%   60.0%   +20.0  [0.0, +60.0]
  acme-off-topic-return          fault:x3-skips-recap  5       1/1       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-order-loose-confirmation  fault:x3-skips-recap  4       1/1       50.0%   25.0%   +25.0  [0.0, +75.0]
  acme-plan-upgrade              fault:x3-skips-recap  5       1/1       80.0%   60.0%   +20.0  [0.0, +60.0]
  acme-tool-failure              fault:x3-skips-recap  3       1/1       100.0%  100.0%  0.0    [0.0, 0.0]
  all specs                                            26                84.6%   73.1%   +11.5  [+3.8, +19.2]

Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.
  spec                           mode  repeat  perturbation        blocks  first drift  drifts  rate   longest clean  all pass  classes
  acme-new-customer-coverage     T     0                           4       none         0       0.0%   4              yes       none
  acme-new-customer-coverage     F     0                           4       none         0       0.0%   4              yes       none
  acme-new-customer-coverage     P     0       shop-hours          5       none         0       0.0%   5              yes       none
  acme-new-customer-coverage     P     0       free-fiber          5       none         0       0.0%   5              yes       none
  acme-number-porting            T     0                           5       3            1       20.0%  3              no        X1_local 1, X3_flow 1, X5_tool 1
  acme-number-porting            F     0                           5       3            2       40.0%  3              no        X1_local 2, X3_flow 1, X5_tool 2
  acme-number-porting            P     0       spanish-line        6       4            2       33.3%  4              no        X1_local 2, X3_flow 1, X5_tool 2
  acme-number-porting            P     0       are-you-there       6       4            2       33.3%  4              no        X1_local 2, X3_flow 1, X5_tool 2
  acme-off-topic-return          T     0                           5       none         0       0.0%   5              yes       none
  acme-off-topic-return          F     0                           5       none         0       0.0%   5              yes       none
  acme-off-topic-return          P     0       options-again       6       none         0       0.0%   6              yes       none
  acme-order-loose-confirmation  T     0                           4       1            2       50.0%  1              no        X1_local 2, X3_flow 2, X5_tool 2
  acme-order-loose-confirmation  F     0                           4       1            3       75.0%  1              no        X1_local 3, X3_flow 2, X5_tool 3
  acme-order-loose-confirmation  P     0       second-loose-yes    5       1            4       80.0%  1              no        X1_local 4, X3_flow 3, X5_tool 4
  acme-order-loose-confirmation  P     0       order-service-down  4       1            3       75.0%  1              no        X1_local 3, X3_flow 3, X5_tool 3
  acme-plan-upgrade              T     0                           5       2            1       20.0%  2              no        X1_local 1, X3_flow 1, X5_tool 1
  acme-plan-upgrade              F     0                           5       2            2       40.0%  2              no        X1_local 2, X3_flow 1, X5_tool 2
  acme-plan-upgrade              P     0       billing-aside       6       3            2       33.3%  3              no        X1_local 2, X3_flow 1, X5_tool 2
  acme-plan-upgrade              P     0       order-service-down  5       2            2       40.0%  2              no        X1_local 2, X3_flow 1, X5_tool 2
  acme-plan-upgrade              P     0       loose-ok            6       2            3       50.0%  2              no        X1_local 3, X3_flow 2, X5_tool 3
  acme-tool-failure              T     0                           3       none         0       0.0%   3              yes       none
  acme-tool-failure              F     0                           3       none         0       0.0%   3              yes       none
  acme-tool-failure              P     0       sales-queue-down    3       none         0       0.0%   3              yes       none

Recovery, per perturbed run: the block injected, the blocks until it passed at its stage again, the label against within_blocks, blocks failing what passed in F, no forbidden or unnamed consequential act, and a question before the first consequential act.
  spec                           perturbation        class                   repeat  injected at  turns  label      collateral  safe action  clarified
  acme-new-customer-coverage     shop-hours          D1_off_topic            0       1            0      immediate  0           yes          yes
  acme-new-customer-coverage     free-fiber          D6_instruction_in_data  0       2            0      immediate  0           yes          yes
  acme-number-porting            spanish-line        D5_language_switch      0       2            0      immediate  0           yes          yes
  acme-number-porting            are-you-there       D7_silence_or_burst     0       3            0      immediate  0           yes          no
  acme-off-topic-return          options-again       D10_return              0       4            0      immediate  0           yes          yes
  acme-order-loose-confirmation  second-loose-yes    D4_loose_confirmation   0       3            none   never      0           yes          yes
  acme-order-loose-confirmation  order-service-down  D8_tool_failure         0       3            none   never      0           yes          yes
  acme-plan-upgrade              billing-aside       D9_out_of_scope         0       2            0      immediate  0           yes          yes
  acme-plan-upgrade              order-service-down  D8_tool_failure         0       3            1      late       0           yes          yes
  acme-plan-upgrade              loose-ok            D4_loose_confirmation   0       3            2      late       0           yes          yes
  acme-tool-failure              sales-queue-down    D8_tool_failure         0       1            0      immediate  0           yes          no
(exit 1)
```

The failing blocks carry `X1_local` (a missing `must` text), `X3_flow` (the recap stage skipped) and
`X5_tool` (a forbidden `order.create`); the first drift is the block where the order is placed without a
recap. The compounding index is positive (+11.5 points): blocks pass more often alone (T) than in the
agent's own succession (F). Three perturbed runs recover late or never. The report writes the same records
into `x3.html`:

```text
$ driftbench report --store acme.db --out x3.html
Margin auto: 8.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 8.1 points).
Campaign c-2f970fe77c6c: 23 runs, 10 pass, 13 fail, 0 did not complete.
Suite pass rate, mode T: 50.0% [18.4%, 81.6%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 1.20), no drop detectable at 80% power.
Suite pass rate, mode F: 50.0% [18.4%, 81.6%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 1.20), no drop detectable at 80% power.
Suite pass rate, mode P: 36.4% [15.2%, 65.1%] (hierarchical 95% interval); 11 goldens, n_eff 10.0 runs (design effect 1.10), no drop detectable at 80% power.
Wrote x3.html.
```

## Common errors

| Symptom | Cause and fix |
|---|---|
| no recovery rows | the campaign ran no mode P, or the perturbations set no `recovery`; `spec lint` warns `PERTURBATION_NO_RECOVERY` |
| collateral counts every failing block after recovery | the campaign has no F cell to use as the reference; run `--mode F,P` |
| `clarified` is no though the agent asked for something | the detector reads the question mark only |
| a failing block with no class | it fails only a custom check or a non-gating verdict |
