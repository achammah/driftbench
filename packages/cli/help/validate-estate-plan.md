---
title: The estate test plan
summary: Derive the test plan of an approved estate map (contract rows, journeys, a covering array) and approve or strike its rows.
commands:
  - estate plan
  - estate plan approve
see_also:
  - validate-estate-loop
  - validate-estate-scan
  - validate-estate-generate
next:
  - validate-estate-generate
---

## What it is

`estate plan <map> --out <plan.yaml>` derives, by code, what to test before any test text exists. A plan row
names the atoms it exercises (the atom under test first), its cell on the situation axes, its test type, its
run mode (`live`, `replay` or `unit`), a status (`proposed`, `approved`, `struck`) and a weight. Rows come
from three sources:

* The contract: every approved atom gets the mandatory test types of its kind.

| Atom kind | Mandatory test types |
|---|---|
| instruction | `obligation`, `outside_trigger` (over-firing), `twin` (another phrasing) |
| gate | `ordered_pair`, `skip_pressure` (cell `owner_signal: keep_going`) |
| route | k `route_positive` (`--k`, default 3), `route_near_miss`, `misroute` |
| skill | named by its route, instruction, reference and script rows; a skill no route names gets one `route_positive` |
| reference | `read_when` |
| script | `script_fixture` |
| subagent | `dispatch`, `contract_alone`, `stop_resume` |
| guard | `guard_positive`, `guard_negative`, `guard_hostile`, `guard_speed`, `guard_register` |
| tool | `tool_denied` for a deny rule, else `tool_boundary`; `tool_deferred` for a tool that loads late |
| stage | `stage_order` and `stage_skip`; a step allowed at any point gets `stage_anytime` |
| register | `register_sample`, one row per ask class |
| hazard | `hazard_recovery` |
| invariant | `invariant` |
| setting | `setting` (a static check that the setting is still declared) |

* Journeys: edge coverage over the route, reference, dispatch and next edges, from a start node that stands
  for the standing instructions. A route read only from a skill or helper description starts no journey and
  is reported as an edge with no journey.
* Pairwise: a covering array of strength t (`--t`, default 2) over the situation axes, under the constraint
  list, with the target atoms merged into one dimension. Each pairwise row is one atom in one situation.

The full grid of situations is never enumerated. The seed of the covering array is fixed at 1.

`estate plan approve <plan>` lists the rows by status, approves them all or by id, or strikes rows. Struck
rows are skipped by `estate generate`; proposed rows wait.

## When to use it

* After the map is approved (`estate approve`), before `estate generate`.
* To trade coverage against size: `--t 3` covers every triple of situation values and grows the plan
  several times; `--k 1` asks one positive phrasing per route instead of three.
* To drop rows you do not want generated: `--row <id> --strike`.

## Commands and every option

```
driftbench estate plan <map> --out <file> [--t <n>] [--space <file>] [--k <n>] [--force]
driftbench estate plan approve <plan> [--all] [--row <id>]... [--strike] [--out <file>]
```

`estate plan`:

| Option | Default | Meaning |
|---|---|---|
| `<map>` | required | the approved estate map |
| `--out <file>` | required | where to write the plan (YAML); the summary goes beside it as `<plan>.summary.json` |
| `--t <n>` | `2` | the strength of the covering array over the situation axes |
| `--space <file>` | the map's own approved atoms | a space map of the situation axes, such as one written by `estate map` and edited |
| `--k <n>` | `3` | positive asks per route |
| `--force` | off | replace an existing plan; the approvals in it are lost |

`estate plan approve`:

| Option | Default | Meaning |
|---|---|---|
| `<plan>` | required | the plan file |
| (no option) | | count the rows by status |
| `--all` | off | approve every row still proposed |
| `--row <id>` | none | approve this row; repeat it |
| `--strike` | off | with `--row`: strike the rows named instead of approving them |
| `--out <file>` | in place | write the result here and leave the plan read untouched |

`weight` has no flag: edit it by hand in the plan file (the loader validates it).

## Inputs

* The approved map from `estate scan` and `estate approve`. Only approved atoms get rows.
* Optionally a space map (`--space`); without it the plan derives the same six axes `estate map` writes.

## Outputs and how to read them

`estate plan` prints `Wrote <plan>: <n> rows (<c> from the contract, <j> journeys, <p> pairwise), all
proposed. Summary in <plan>.summary.json.`, then:

* `Cells`: distinct pairs of atoms and situation values over the rows.
* `Covering array`: its rows, t, and how many allowed t-tuples it covers (always all of them).
* `Mandatory rows per kind`: contract rows, a row counted once for each kind it names.
* `Rows per test type`: every row, journeys and pairwise included.
* `Unenforced`: approved rules no guard enforces.
* `Cells with no approved phrase`: the plan reads no phrase bank, so every cell counts.
* `Edges with no journey`, each with its reason. A list (these edges, the rows adjusted to the space map, the notes) prints its first 10 lines on the console, then one line that counts the rest and names the summary file, which holds every one under `uncoveredEdges`, `adjusted` and `notes`.
* A `Next:` line.

Exit 0 written, 1 an invalid map or space map or one that does not match the map, 2 a usage or input error
with nothing written. The plan's `spaceHash` is the content hash of the space map used.

`estate plan approve` prints `<plan>: <n> rows, <p> proposed, <a> approved, <s> struck.`, or
`Approved <n> rows in <file>; <k> were already approved.`, or `Struck <n> row in <file>; <k> were already
struck.` Exit 0 listed or changed, 1 an invalid plan or an unknown row (`PLAN_UNKNOWN_ROW`), 2 options that
do not fit. A plan that does not load reports `PLAN_PARSE`, `PLAN_NOT_OBJECT`, `PLAN_DUPLICATE_ROW`,
`PLAN_UNKNOWN_ROW` or `SCHEMA_*`.

## Worked example

```sh
driftbench estate plan examples/estates/fixture/approved.yaml --out plan.yaml
driftbench estate plan approve plan.yaml
driftbench estate plan approve plan.yaml --row twin.instruction.standing.never-force-push --strike
driftbench estate plan approve plan.yaml --all
driftbench estate plan approve plan.yaml --row nosuch # exit 1
driftbench estate plan examples/estates/fixture/approved.yaml --out plan.yaml # exit 2
driftbench estate plan examples/estates/fixture/approved.yaml --out plan-t3.yaml --t 3 --k 1
```

```text
Wrote plan.yaml: 1568 rows (361 from the contract, 10 journeys, 1197 pairwise), all proposed. Summary in plan.summary.json.
  Cells: 1429 (a cell is the atoms of a row crossed with its situation values).
  Covering array: 1197 rows, t = 2, 5092 of 5092 allowed 2-tuples covered; the full grid of 2531567001600 cells is never enumerated.
  Mandatory rows per kind (a row counts once for each kind it names):
    instruction   129
    gate           16
    route          65
    skill         111
    reference       9
    script          2
    subagent       69
    guard          30
    tool           12
    setting         4
    stage           9
    register       70
    hazard          2
    invariant       4
  Rows per test type (contract, journeys and pairwise together):
    obligation        603
    outside_trigger    43
    twin               43
    ordered_pair      112
    skip_pressure       8
    route_positive    260
    route_near_miss    13
    misroute           13
    read_when           9
    script_fixture      2
    dispatch           42
    contract_alone      3
    stop_resume         3
    guard_positive     84
    guard_negative      6
    guard_hostile       6
    guard_speed         6
    guard_register      6
    tool_boundary       9
    tool_denied         3
    stage_order        69
    stage_skip          4
    stage_anytime       1
    register_sample   200
    hazard_recovery     2
    invariant           4
    setting             4
    journey            10
  Unenforced: 54 approved rules no guard enforces.
  Cells with no approved phrase: 1429 of 1429.
  Edges with no journey: 7.
    route.inbox-triager.an-ask-that-fits-inbox-triager route subagent.inbox-triager.helper-inbox-triager: the route is read from a skill or helper description: the standing instructions do not state it
    route.invoice-reconcile.an-ask-that-fits-invoice-reconcile route skill.invoice-reconcile.skill-invoice-reconcile: the route is read from a skill or helper description: the standing instructions do not state it
    route.ledger-auditor.an-ask-that-fits-ledger-auditor route subagent.ledger-auditor.helper-ledger-auditor: the route is read from a skill or helper description: the standing instructions do not state it
    route.route-planner.an-ask-that-fits-route-planner route subagent.route-planner.helper-route-planner: the route is read from a skill or helper description: the standing instructions do not state it
    route.shipment-tracker.an-ask-that-fits-shipment-tracker route skill.shipment-tracker.skill-shipment-tracker: the route is read from a skill or helper description: the standing instructions do not state it
    route.supplier-email.an-ask-that-fits-supplier-email route skill.supplier-email.skill-supplier-email: the route is read from a skill or helper description: the standing instructions do not state it
    route.weekly-report.an-ask-that-fits-weekly-report route skill.weekly-report.skill-weekly-report: the route is read from a skill or helper description: the standing instructions do not state it
  The map has no phrase bank yet: every cell counts as a cell with no approved phrase.
Next: driftbench estate plan approve plan.yaml --all, or strike rows with --row <id> --strike
plan.yaml: 1568 rows, 1568 proposed, 0 approved, 0 struck.
Approve every proposed row with --all, a row with --row <id>, or strike one with --row <id> --strike.
Struck 1 row in plan.yaml; 0 were already struck.
Approved 1567 rows in plan.yaml; 0 were already approved.
✗ plan.yaml
  (file)  PLAN_UNKNOWN_ROW  row "nosuch" is not in the plan
plan.yaml already exists: pass --force to replace it (the approvals in it are lost).
```

The `--t 3 --k 1` plan prints the same blocks for 10173 rows (335 from the contract, 10 journeys, 9828
pairwise); its covering array covers 87504 of 87504 allowed 3-tuples.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `<plan> already exists: pass --force to replace it (the approvals in it are lost).` (exit 2) | the plan exists | another name, or `--force` |
| `PLAN_UNKNOWN_ROW  row "<id>" is not in the plan` (exit 1) | a misspelt row id | copy the id from the plan file |
| `error: required option '--out <file>' not specified` (exit 2) | `plan` without `--out` | name the plan file |
| every row stays `proposed` and `estate generate` exits 1 | the plan was never approved | `estate plan approve <plan> --all` |
| the plan is far larger than expected | `--t 3` or a map with many approved axis atoms | keep `--t 2`; strike rows you do not need |
