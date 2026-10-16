---
title: Generating estate tests
summary: Turn an approved estate plan into task specs with no model. Read the report and its gaps. Run the static tests on an estate root.
commands:
  - estate generate
  - estate static
see_also:
  - validate-estate-plan
  - validate-estate-unit
  - validate-estate-replay
  - validate-estate-live
  - validate-estate-stats
next:
  - validate-estate-unit
---

## What it is

`estate generate` turns each approved plan row into one or more task specs, by code only, with no model call.
Proposed rows wait; struck rows are skipped. Each spec has a Given (the estate runtime and map hash, the
session state and hazard of the cell, the workspace seed of its situation inlined as files), a When (an ask)
and a Then derived from the evidence predicates of the row's atoms: skills loaded, guard verdicts, tools
called or never called, ordered pairs (read before edit), stages, workspace changes, words in the reply,
language, and named custom checks.

The ask comes from, in order: an approved phrase of the phrase bank; for a `replay` row, the recorded
session's own ask; otherwise an ask code writes from the atoms (tag `ask:code`), unless `--no-fallback`.
A rule no code can check becomes a gating judged criterion quoting the atom's own words, unless
`--no-judge`. What no existing check can say is a named gap, and the spec goes to `incomplete/`: it is valid,
and `spec lint --strict` fails it by name.

The output folder:

| Path | Holds | Run with |
|---|---|---|
| `specs/live/<test type>/` | complete specs that run the agent live | `estate run` (topic `validate-estate-live`) |
| `specs/replay/<test type>/` | complete specs aligned to recorded sessions | `driftbench replay` (topic `validate-estate-replay`) |
| `specs/unit/<test type>/` | the specs of unit rows | |
| `unit/` | unit tests: guards on event payloads, scripts on fixtures | `estate unit` (topic `validate-estate-unit`) |
| `static/invariant/`, `static/setting/` | static tests of the files, as JSON | `estate static` (this topic) |
| `incomplete/<mode>/<test type>/` | specs with a gap | nothing until the gap closes |
| `run-order.txt` | the complete specs, focus atoms first, then guards, gates, invariants | `estate run --order` |
| `estate-generate-report.json` | the report below, as JSON | |

`estate static <tests...> --estate <root>` reads the estate files again, with no run of the agent: an
invariant must still hold (the standing file under its ceiling, no orphan file, anchored guard paths, a
complete check registry), and a setting must still be declared with its value.

## When to use it

* After `estate plan approve`.
* Again after any change to the map, the plan, the phrase bank or the session index: the same inputs and
  seed give the same files, on any machine.
* `estate static` on the original estate, then on a mutant copy (topic `validate-estate-live`).

## Commands and every option

```
driftbench estate generate --map <file> --plan <file> --out <dir> [--seed <n>] [--phrases <file>] [--sessions <file>] [--focus <file>] [--no-fallback] [--no-judge] [--force] [--json]
driftbench estate static <tests...> --estate <root> [--runtime claude-code] [--ceiling <characters>] [--json]
```

`estate generate`:

| Option | Default | Meaning |
|---|---|---|
| `--map <file>` | required | the approved estate map |
| `--plan <file>` | required | the plan made from that map |
| `--out <dir>` | required | the folder for the specs and `estate-generate-report.json` |
| `--seed <n>` | `1` | the integer seed of every phrase choice |
| `--phrases <file>` | `phrases.yaml` beside the map | the approved phrase bank; with none, every ask is written by code |
| `--sessions <file>` | `sessions/index.yaml` beside the map, when present | the index of recorded sessions for replay rows |
| `--focus <file>` | none | atom ids, one per line, whose complete specs come first in `run-order.txt` |
| `--no-fallback` | off | write no ask by code and read no outcome from the atoms: a row the bank does not cover stays incomplete |
| `--no-judge` | off | judge no domain predicate: a rule no code checks stays `needs-registered-check` |
| `--force` | off | replace the output of an earlier run in the folder |
| `--json` | off | print the report as JSON |

`estate static`:

| Option | Default | Meaning |
|---|---|---|
| `<tests...>` | required | static test files, or folders holding them, such as `<suite>/static` |
| `--estate <root>` | required | the estate root to read: the original or a mutant copy |
| `--runtime <name>` | `claude-code` | the runtime that reads the estate |
| `--ceiling <characters>` | `40000` | the size ceiling of the standing instructions |
| `--json` | off | print `{ estate, passed, failed, results: [{ id, atom, pass, detail }] }` |

## Inputs

* The approved map and the approved plan.
* The phrase bank (`phrases.yaml`): `situations`, each with the atoms it sets off, what it is for (trigger,
  outside, near miss, misroute, pressure, resume), its workspace seed, the paths its ask may touch, and its
  phrases, each approved or not; and `workspaces`, each a map of file path to text.
* The session index (`sessions/index.yaml`): recorded sessions, their situation and ask, and the atoms each
  breaks.

Every field is in `docs/reference/estate-files.md`. Inputs that do not fit together (a plan of another map,
an unknown or unapproved atom, a bank naming an unknown atom) exit 2 and write nothing.

## Outputs and how to read them

The report prints the map, plan, bank and index read, the custom checks the runner registers, then one row
per test type with its rows, specs, complete and incomplete specs, then: where the asks of the complete specs
came from, how many complete specs carry a judged criterion, where their outcomes came from, the static and
unit test counts, the replay plan (how many replay specs are planned to pass and to fail), the rows waiting
for approval, and the gaps. Exit 0 when every approved row gave complete specs, 1 when the suite is written
with incomplete specs or rows waiting, 2 on a usage or input error.

The gap markers:

| Gap | What is missing |
|---|---|
| `needs-approved-phrase` | no approved phrase for the situation (with `--no-fallback`) |
| `needs-second-phrase` | a twin needs a second approved phrase (with `--no-fallback`) |
| `needs-deviation-phrase` | no approved phrase for the cell's deviation class (with `--no-fallback`) |
| `needs-workspace-outcome` | the situation declares no paths its ask may touch (with `--no-fallback`) |
| `needs-askable-act` | no approved phrase, and the atoms' words give no task an ask can name |
| `needs-some-call-check` | a tool call with input assertions |
| `needs-registered-check` | a custom predicate no registered check runs (or `--no-judge`) |
| `needs-ordered-anchor` | an ordered pair whose ends are not a tool, a skill or a stage |
| `needs-stage-reach-check` | a stage reachable at any time, or no single closing stage |
| `needs-static-runner` | a static property no static check knows |
| `needs-negation` | a negative control whose predicate has no inverse |
| `needs-recorded-session` | a replay row whose situation no recorded session holds |
| `needs-guard-trace` | a check that runs inside another guard's script |
| `needs-guard-timing`, `needs-guard-message-check` | the speed or the message of a guard |
| `needs-derivable-then` | a row with no Then code can derive |
| `needs-existing-file` | a Read of a file the estate copy does not hold |

Close a gap by adding what it names (an approved phrase in the bank, a recorded session, a declared outcome),
then generate again with `--force`.

`estate static` prints one line per test, `✓` or `✗`, with what held or did not, then
`<n> of <m> static tests pass.` Exit 0 all pass, 1 one fails, 2 a usage or input error.

## Worked example

On the Northwind estate. The first generate runs before the plan is approved, so every row waits:

```sh
driftbench estate plan examples/estates/fixture/approved.yaml --out plan.yaml
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan plan.yaml --out waiting # exit 1
driftbench estate plan approve plan.yaml --all
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan plan.yaml --out suite # exit 1
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan plan.yaml --out suite # exit 2
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan plan.yaml --out strict --no-fallback # exit 1
driftbench estate static suite/static --estate examples/estates/fixture # exit 1
driftbench spec lint suite/specs --strict
```

The waiting run, the end of the `suite` run, the refusal, the gaps of the `--no-fallback` run, the static
tests and the last line of the lint:

```text
Plan ../plan.yaml: 1568 rows, 0 approved, 1568 waiting, 0 struck.
Waiting for approval: 1568 rows.
Wrote 2 files to waiting.
register_sample      200    200       187          13
hazard_recovery        2      2         2           0
invariant              4      4         4           0
setting                4      4         4           0
journey               10     10         9           1
total                      1568      1360         208

Asks of the complete specs: 433 approved phrases, 919 written by code, 0 recorded sessions, 8 with no ask.
Judged by a criterion from the rule's own words (no code checks it): 201 complete specs.
Outcomes of the complete specs: 981 bank, 2 no-change:denied, 27 no-change:guard, 58 no-change:negative, 17 no-change:read-only, 267 no-delete, 8 static.
Run order: run-order.txt lists the complete specs, focus atoms first, then guards, gates and invariants.
Static tests: 8 in static/ (invariants and settings), run by driftbench estate static on an estate root.
Unit tests: 26 in unit/ (6 guards, 2 scripts, 54 payloads), run by driftbench estate unit: --record on the original first, then on any copy.
Catalogue checks: 0 tested through their host hook, 0 need a trigger, 0 need a host hook.
Gaps (what keeps a spec incomplete):
  needs-askable-act          185 specs
  needs-existing-file        2 specs
  needs-ordered-anchor       15 specs
  needs-recorded-session     6 specs
  needs-registered-check     1 spec
Wrote 1596 files to suite.
suite/estate-generate-report.json already exists: an earlier run wrote this folder. Pass --force to replace its output.
Gaps (what keeps a spec incomplete):
  needs-approved-phrase      562 specs
  needs-deviation-phrase     829 specs
  needs-existing-file        2 specs
  needs-ordered-anchor       15 specs
  needs-recorded-session     6 specs
  needs-registered-check     1 spec
  needs-second-phrase        3 specs
  needs-workspace-outcome    560 specs
Wrote 1596 files to strict.
✗ estate.invariant.invariant.registry.the-check-registry-lists-every-guard  registry_complete does not hold: {"guardsWithoutRow":["reply-length.py"],"rowsWithoutGuard":["G6"]}
✗ estate.invariant.invariant.settings.every-guard-finds-its-script-from  guard_paths_anchored does not hold: {"unanchored":["python3 .claude/guards/ledger-guard.py"]}
✗ estate.invariant.invariant.standing.no-file-of-the-estate-is  no_orphans does not hold: {"orphans":[".claude/skills/invoice-reconcile/references/old-tolerances.md"]}
✓ estate.invariant.invariant.standing.the-standing-instructions-stay-under-40000  standing_size holds: {"ceiling":40000,"characters":3292}
✓ estate.setting.setting.settings.setting-env-northwind-ledger-dir  env.NORTHWIND_LEDGER_DIR is declared
✓ estate.setting.setting.settings.setting-env-northwind-region  env.NORTHWIND_REGION is declared
✓ estate.setting.setting.settings.setting-model-is-opus  model is opus
✓ estate.setting.setting.settings.setting-permissions-defaultmode-is-default  permissions.defaultMode is default
5 of 8 static tests pass.
Checked 1352 specs: 1352 valid, 0 invalid, 0 warnings.
```

Three static tests fail by design: the Northwind estate carries the planted defects that `estate lint` also
reports. The complete specs pass strict lint.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `Waiting for approval: <n> rows.` (exit 1) | the plan rows are still proposed | `estate plan approve <plan> --all` |
| `<dir>/estate-generate-report.json already exists: an earlier run wrote this folder. Pass --force to replace its output.` (exit 2) | the output folder holds an earlier run | another folder, or `--force` |
| `error: required option '--map <file>' not specified` (exit 2), and the same for `--plan` and `--out` | a required option missing | give all three |
| many `needs-approved-phrase` gaps | `--no-fallback` with a bank that does not cover the rows | approve more phrases, or drop `--no-fallback` |
| `error: required option '--estate <root>' not specified` (exit 2) | `estate static` without `--estate` | name the estate root |
