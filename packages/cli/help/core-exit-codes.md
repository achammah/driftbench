---
title: Exit codes
summary: What each driftbench exit code means, 0 pass, 1 check failed, 2 bad input, and the commands that use other codes.
commands: []
see_also:
  - core-global-options
  - core-getting-started
  - running-not-run
next:
  - recipes-test-a-chat-agent
---

## What it is

Every driftbench command ends with an exit code a script or a CI job can branch on. One rule covers almost
every command; a few commands give the codes a richer meaning and say so in their own help.

## When to use it

* In CI: fail the job on a nonzero code, or branch on 1 (the agent regressed) versus 2 (the job is broken).
* In a script: tell "the checks failed" apart from "the command could not run".

## Commands and every option

The general rule, for every command unless its help says otherwise:

| Code | Meaning |
|---|---|
| 0 | success: what the command checks holds, or what it writes was written |
| 1 | what the command checks fails: an invalid spec, a failing cell, a regression, a coverage gap |
| 2 | usage or input error: an unknown option or command, a missing argument, a bad number, a path that cannot be used, an unknown target, a store that cannot be opened, a config that cannot be read, a plugin that cannot be loaded |

An error the argument parser reports always exits 2. `--help` and `--version` exit 0. A path error (a file
where a folder must go, a missing file a command must read) exits 2 with the reason, never a stack trace.
One exception: a spec path that does not exist is reported as an invalid spec, `SPEC_PARSE`, and exits 1.

One rule for the commands that gate a pipeline (`ci`, `campaign run`, `campaign resume`, `campaign rejudge`,
`family verify`): when nothing failed but something was not run or blocked, they exit 3. Not run is no pass and
no failure of the agent. `ci` ranks its verdicts: a radius miss, then a regression (exit 1), then blocks not
run beyond `--max-not-run` (exit 3), then the rest. So a failing aggregate or an incomplete cell beside blocks
not run gives 3, and a regression gives 1 (topic running-not-run). `redteam` keeps 1 for a block not run: its result is an attack outcome. One
exception: `redteam run` exits 3 when its search is unscored (a turn has no score, breach detection is
off, or it has fewer turns than `--success-confirm-turns`) and no block failed. Nothing failed and nothing was measured, so it is never a pass.

Commands with their own codes:

| Command | 0 | 1 | 2 | Other |
|---|---|---|---|---|
| `spec validate`, `spec lint` | every spec valid (`lint --strict`: and no warning) | a spec invalid, none found, or a warning under `--strict` | usage | |
| `spec coverage` | every behaviour and flow deviation covered | a gap | usage | |
| `campaign plan` | the plan printed | | bad input | |
| `campaign run`, `campaign resume` | every cell passes | a cell fails, failed or was stopped, the budget included | bad input | 3: no cell failed but a cell was not run or blocked (a Given the target cannot apply) |
| `campaign status` | every cell passes | any other state | bad input, unknown campaign, empty store | |
| `smoke` | transcripts identical, every run completed | transcripts differ, or a run did not complete | bad input | |
| `report` | written | | bad input | |
| `compare` | non-inferior (parity) | regressed, or not shown non-inferior | bad input | |
| `ci` | non-inferior (parity) | regressed, not shown non-inferior, incomplete, a failing aggregate, a radius miss | bad input | 3: a gating spec had blocks not run (a Given the target cannot apply) beyond `--max-not-run`, and compare finds no regression: a regression exits 1 |
| `campaign rejudge` | every re-judged run passes | a run fails, or a gating result is inconclusive | bad input | 3: no run fails but a block was not run or blocked (the summary names each with its reason) |
| `family verify` | the reference passes every spec | the reference fails one, or one is invalid | bad input | 3: none fails but the reference could not run one (a block not run: unverified, counted apart, not shipped) |
| `monitor` | no shift | two of the three detectors alarm | bad input | |
| `redteam run` | the search completed with every turn scored, no breach, every block passed | a breach, a grading error, a failed block or a failed run | bad input | 3: the search is unscored and no block failed |
| `validate` | | | | the level reached, 0 to 63: the lowest over seeds of the highest level passed, 0 when level 1 fails; `all` exits with the lowest level of every validator; an input error exits 64. With `--check-floor`: 1 when below the floor, else 0 |
| `view` | | | bad input | runs until stopped |
| `help <topic>` | printed | | no such topic or command | |

## Inputs

None. Read the code from `$?` in a shell, or from the job status in CI.

## Outputs and how to read them

The message that goes with a nonzero code is on stderr; the results are on stdout. With `--json`, stdout
holds one JSON document whatever the code, so a script can parse it and still branch on the code.

In a shell:

```text
driftbench campaign run specs --store runs.db
case $? in
  0) echo pass ;;
  1) echo "the agent failed a check" ;;
  2) echo "the run could not start: read stderr" ;;
esac
```

## Worked example

```sh
driftbench spec validate examples/acme/specs
driftbench spec validate examples/acme/specs/no-such-folder # exit 1
driftbench spec coverage examples/acme/specs --inventory examples/acme/inventory.yaml # exit 1
driftbench campaign plan examples/acme/specs --repeats zero # exit 2
driftbench campaign plan examples/acme/specs --mode X # exit 2
driftbench campaign status --store no-such-store.db # exit 2
driftbench spec validate --no-such-option examples/acme/specs # exit 2
```

```text
--repeats takes a whole number of at least 1, not "zero".
Unknown mode "X". The modes are T, F and P, alone or separated by commas.
No store at no-such-store.db: this command reads a store and does not make one.
error: unknown option '--no-such-option'
```

## Common errors

* Treating every nonzero code as "the agent failed": 2 means the command never measured anything.
* `spec coverage` exiting 1 on the Acme example is expected: the inventory keeps known gaps.
* Piping output into `head` can end the command with `EPIPE` before it sets its code: redirect to a file
  instead when the code matters.
* `validate` returns a level, so `0` there means level 1 failed, not success: compare the code with the
  level you require.
