---
title: Estate coverage and drift
summary: Report how much of an estate its generated tests cover, which atoms recorded sessions reach, block pass rates and guard deny rates. No model is called.
commands:
  - estate stats
see_also:
  - validate-estate-generate
  - validate-estate-replay
  - validate-estate-maintain
next:
  - validate-estate-maintain
---

## What it is

`estate stats` measures an estate's test suite and its recorded sessions, offline:

* coverage: per atom kind, the approved atoms, those named by at least one complete spec or static test
  (`tested`), and those at least one guard enforces (`enforced`); the plan's cells and the graph's route,
  reference, dispatch and next edges a complete spec covers;
* reach, from recorded sessions: for skills, references, guards and subagents (the observable kinds), how
  many sessions reached the atom's moment (the skill loaded, the file read, the guard decided, the helper
  dispatched) and how many followed it (every aligned complete spec naming the atom passed). The other
  approved atoms are counted as not observable;
* decay: per block index, the sessions that hold the block and their pass rate;
* drift: per guard, from the decision logs, the decisions, the denies and the deny rate. A guard that starts
  denying more, or stops firing, is the first sign that the estate or the agent changed.

Compliance comes from offline replay checks, as in `driftbench replay`; judged criteria stay inconclusive,
since this command calls no judge.

## When to use it

* After `estate generate`, to see which kinds of atoms the suite leaves untested.
* With a folder of recorded sessions of the real agent, to watch reach, pass rate by block and guard deny
  rates over time.

## Commands and every option

```
driftbench estate stats --map <map> --plan <plan> --specs <dir> [--sessions <dir>] [--json]
```

| Option | Default | Meaning |
|---|---|---|
| `--map <map>` | required | the approved estate map |
| `--plan <plan>` | required | the plan made from that map |
| `--specs <dir>` | required | the folder `estate generate` wrote (its `specs/`, `static/` and `incomplete/`), or its complete specs folder |
| `--sessions <dir>` | none | recorded transcripts with their decision logs and step feeds; without it, reach, decay and drift are empty |
| `--json` | off | print the report as JSON |

## Inputs

The approved map, the plan made from it, the generated suite, and optionally a folder of sessions where each
`<name>.jsonl` is a transcript and `<name>.decisions.jsonl`, `<name>.steps.jsonl` go with it. Specs align
with sessions through `metadata.replay`, else by file order, as in `replay`. A session counts once per block
and atom, even when several specs name it.

## Outputs and how to read them

The text report: one row per kind (`atoms`, `tested`, `enforced`), then `Cells: <covered>/<total>; edges:
<covered>/<total>`, the number of atoms whose reach is not observable, and the number of reach rows, block
rows and guard rates. The JSON holds every value:

```text
{
  "coverage": {
    "kinds": { "<kind>": { "atoms": 0, "tested": 0, "enforced": 0 } },
    "cells": { "covered": 0, "total": 0 },
    "edges": { "covered": 0, "total": 0 }
  },
  "reach": [{ "atom": "<id>", "reached": 0, "followed": 0 }],
  "reachNotObservable": { "status": "not observable", "atoms": 0 },
  "decay": [{ "block": 0, "runs": 0, "passRate": 0 }],
  "drift": { "guards": [{ "guard": "<name>", "decisions": 0, "denies": 0, "denyRate": 0 }] }
}
```

Exit 0 printed; 2 a usage or input error (a map, plan or folder that does not load, or a plan made from
another map), and nothing is printed.

## Worked example

```sh
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out suite
driftbench estate stats --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --specs suite --sessions examples/estates/fixture/sessions
driftbench estate stats --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --specs suite --sessions examples/estates/fixture/sessions --json
driftbench estate stats --map examples/estates/fixture-v2/map.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --specs suite # exit 2
driftbench estate stats --map examples/estates/fixture/approved.yaml --specs suite # exit 2
```

The text report after the generate report:

```text
Kind  atoms  tested  enforced
instruction  43  5  4
gate  8  3  2
route  13  6  0
skill  4  2  0
reference  9  1  0
script  2  1  0
subagent  3  2  0
guard  6  3  0
tool  12  3  0
setting  4  0  0
stage  5  3  0
register  10  3  1
hazard  2  1  0
invariant  4  1  0
Cells: 34/35; edges: 3/23
103 atoms: reach is not observable.
22 atom reach rows; 1 block rows; 4 guard rates.
```

Summarised from the JSON: the reach rows with a session reaching the atom, the decay and the drift (the `kinds`
block equals the text table above):

```text
"reach": skill.weekly-report.skill-weekly-report reached 2 followed 0; guard.settings.pretooluse-bash-guard-block-force-push 3, 0; guard.settings.pretooluse-edit-write-guard-read-before 3, 0; guard.settings.userpromptsubmit-guard-stop-word-sh 3, 0; guard.settings.stop-guard-reply-length-py 3, 0; the other 17 rows 0, 0
"reachNotObservable": { "status": "not observable", "atoms": 103 }
"decay": [{ "block": 0, "runs": 3, "passRate": 0.3333333333333333 }]
"drift": { "guards": [
  { "guard": "block-force-push.sh", "decisions": 3, "denies": 0, "denyRate": 0 },
  { "guard": "read-before-edit.py", "decisions": 4, "denies": 1, "denyRate": 0.25 },
  { "guard": "reply-length.py", "decisions": 3, "denies": 0, "denyRate": 0 },
  { "guard": "stop-word.sh", "decisions": 3, "denies": 0, "denyRate": 0 } ] }
```

Then the two errors:

```text
Cannot compute estate stats: the plan is made from another map
error: required option '--plan <plan>' not specified
```

Read it this way: the 37-row hand plan tests only a few atoms of each kind; one of three sessions passes
block 0 (the two others skip a skill or edit before reading); the read-before-edit guard denied once in four
decisions, in the session that edits first.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `Cannot compute estate stats: the plan is made from another map` (exit 2) | `--plan` was derived from a different map | the plan made from that map |
| `error: required option '--plan <plan>' not specified` (exit 2), and the same for `--map` and `--specs` | a required option missing | give all three |
| reach, decay and drift are empty | no `--sessions` | pass a folder of recorded sessions |
| `followed` stays 0 | no complete spec naming the atom passes on the session, or judged criteria are inconclusive | replay the specs (topic `validate-estate-replay`) to see which check fails |
