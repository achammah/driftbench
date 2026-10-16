---
title: Estate unit tests
summary: Run an estate's guards on event payloads and its scripts on fixtures with no model. The run records the outcomes on the original and checks any copy or mutant.
commands:
  - estate unit
see_also:
  - validate-estate-generate
  - validate-estate-live
  - validate-estate-scan
next:
  - validate-estate-replay
---

## What it is

`estate unit` runs the unit tests that `estate generate` writes under `<suite>/unit/`, with no model and no
agent. A guard test feeds the guard's command synthetic event payloads in the runtime's input shape, on a
copy of the estate, as the runtime would run it (stdin the payload, `CLAUDE_PROJECT_DIR` the copy). The
outcome is what the runtime would read: `deny` (exit 2, or a JSON decision that blocks), `ask`, `allow`, or
`error`, with the message and what the guard printed. A script test runs the script on the fixtures the
estate declares for it and compares its exit code and output.

It works in two passes:

1. `--record` on the original estate: each case runs 3 times and its outcome is written into the test file,
   the oracle later runs compare with. A case whose outcome varies between runs is marked flaky and is not
   compared. A positive case that shows no effect is inert. A hostile case the guard allows is recorded as
   slipping past the guard: a weakness of the guard, not a failure of the test.
2. Without `--record`, on the original or on any copy (such as a mutant from `estate mutate`): every recorded
   case that is neither flaky nor inert must give its recorded outcome again, and a `guard_speed` test also
   holds each run under the guard's `timeout` (60 seconds when the guard sets none). A guard the estate no
   longer runs fails every case.

Runs are sandboxed where the platform has a sandbox (macOS `sandbox-exec`): no network, no read of the
home folder's credential folders, writes only into the copy and a temporary folder. The environment holds
`PATH`, a fresh `HOME` and `CLAUDE_PROJECT_DIR`, nothing else. On other platforms the run is unsandboxed and
the summary says `sandbox: none`.

## When to use it

* After `estate generate`, to test the guards and scripts without running the agent.
* To prove a guard test can fail: record on the original, then run on a mutant that deletes the guard
  (topic `validate-estate-live`).
* After editing a guard script: run without `--record`; a changed decision or message fails.

## Commands and every option

```
driftbench estate unit <tests...> --estate <root> [--runtime claude-code] [--record] [--no-sandbox] [--jobs <n>] [--json]
```

| Option | Default | Meaning |
|---|---|---|
| `<tests...>` | required | unit test files, or folders holding them, such as `<suite>/unit` |
| `--estate <root>` | required | the estate root: the original (with `--record`) or a copy |
| `--runtime <name>` | `claude-code` | the runtime that reads the estate |
| `--record` | off | run on the original estate and write each outcome into its test file |
| `--no-sandbox` | sandbox on where the platform has one | run without the sandbox |
| `--jobs <n>` | `1` | how many tests run at once; the results keep their order |
| `--json` | off | print `{ runs, guards, scripts }` as one JSON document |

## Inputs

* The unit tests from `estate generate`, under `<suite>/unit/<test type>/`: `guard_positive`,
  `guard_negative`, `guard_hostile`, `guard_speed` and `script_fixture`.
* The estate root. A script's fixtures come from `scripts:` in the estate's `driftbench.estate.yaml`
  (`args`, `stdin`, `files`, `expect` with `exitCode`, `stdout`, `stdoutIncludes`); a script with none is
  recorded on minimal fixtures, like a guard.
* `--record` writes into the test files: run it on a copy of the suite you own, never on committed files you
  do not mean to change.

## Outputs and how to read them

One line per test, then a count line:

| Mark | Meaning |
|---|---|
| `✓` | passes: with `--record`, recorded (with how many cases are active, inert or slipping past the guard); without, every recorded case as recorded |
| `✗` | fails, with the reason, such as `the estate no longer runs the PreToolUse guard block-force-push.sh on Bash` |
| `·` | inert: no recorded case shows the guard at work; an inert test passes |
| `?` | `no outcome recorded: run --record on the original first` |

`<p> of <n> unit tests pass, <f> fail, <i> inert, <u> unrecorded (sandbox: <sandbox-exec|none>).`, or
`Recorded <n> unit tests (sandbox: ...); <k> have no fixture.` With `--json`:
`{ "runs": [{ "spec", "pass", "failing": ["<case: why>"] }], "guards": [{ "guard", "event", "decision", "message", "ms" }], "scripts": [{ "script", "exit", "stdout" }] }`.

Exit 0 every test passes, 1 a test fails, 2 a usage or input error or a test with no recorded outcome when
`--record` was not given.

## Worked example

Generate a small suite, see the unrecorded tests refused, record on the original, check the original, then
check a mutant that deletes the force-push guard:

```sh
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out suite
driftbench estate unit suite/unit --estate examples/estates/fixture # exit 2
driftbench estate unit suite/unit --estate examples/estates/fixture --record
driftbench estate unit suite/unit --estate examples/estates/fixture
driftbench estate mutate examples/estates/fixture/approved.yaml --atom guard.settings.pretooluse-bash-guard-block-force-push --delete --to no-guard
driftbench estate unit suite/unit --estate no-guard # exit 1
```

Output after the generate report (macOS; on Linux each count line says `sandbox: none`):

```text
? unit.guard_hostile.guard.settings.pretooluse-edit-write-guard-read-before  no outcome recorded: run --record on the original first
? unit.guard_negative.guard.settings.pretooluse-bash-guard-block-force-push  no outcome recorded: run --record on the original first
? unit.guard_positive.guard.settings.pretooluse-bash-guard-block-force-push  no outcome recorded: run --record on the original first
? unit.guard_speed.guard.settings.pretooluse-edit-write-guard-read-before  no outcome recorded: run --record on the original first
? unit.script_fixture.script.invoice-reconcile.script-scripts-reconcile-py  no outcome recorded: run --record on the original first
0 of 5 unit tests pass, 0 fail, 0 inert, 5 unrecorded (sandbox: sandbox-exec).
✓ unit.guard_hostile.guard.settings.pretooluse-edit-write-guard-read-before  recorded 6 cases, 2 active, 4 slipping past the guard
✓ unit.guard_negative.guard.settings.pretooluse-bash-guard-block-force-push  recorded 1 cases, 1 active, 0 inert
✓ unit.guard_positive.guard.settings.pretooluse-bash-guard-block-force-push  recorded 1 cases, 1 active, 0 inert
✓ unit.guard_speed.guard.settings.pretooluse-edit-write-guard-read-before  recorded 2 cases, 2 active, 0 inert
✓ unit.script_fixture.script.invoice-reconcile.script-scripts-reconcile-py  recorded 2 minimal fixtures
Recorded 5 unit tests (sandbox: sandbox-exec); 0 have no fixture.
✓ unit.guard_hostile.guard.settings.pretooluse-edit-write-guard-read-before  2 of 2 cases as recorded
✓ unit.guard_negative.guard.settings.pretooluse-bash-guard-block-force-push  1 of 1 cases as recorded
✓ unit.guard_positive.guard.settings.pretooluse-bash-guard-block-force-push  1 of 1 cases as recorded
✓ unit.guard_speed.guard.settings.pretooluse-edit-write-guard-read-before  2 of 2 cases as recorded
✓ unit.script_fixture.script.invoice-reconcile.script-scripts-reconcile-py  2 of 2 fixtures as recorded
5 of 5 unit tests pass, 0 fail, 0 inert, 0 unrecorded (sandbox: sandbox-exec).
Mutant: delete guard.settings.pretooluse-bash-guard-block-force-push in .claude/settings.json.
  before:           { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/guards/block-force-push.sh" }
  after:  (the line is gone)
  map be2e7a0919cb -> b1636f156052
  collateral: invariant.settings.every-guard-finds-its-script-from
Wrote no-guard: the estate copy, map.yaml and mutant.json.
✓ unit.guard_hostile.guard.settings.pretooluse-edit-write-guard-read-before  2 of 2 cases as recorded
✗ unit.guard_negative.guard.settings.pretooluse-bash-guard-block-force-push  the estate no longer runs the PreToolUse guard block-force-push.sh on Bash
✗ unit.guard_positive.guard.settings.pretooluse-bash-guard-block-force-push  the estate no longer runs the PreToolUse guard block-force-push.sh on Bash
✓ unit.guard_speed.guard.settings.pretooluse-edit-write-guard-read-before  2 of 2 cases as recorded
✓ unit.script_fixture.script.invoice-reconcile.script-scripts-reconcile-py  2 of 2 fixtures as recorded
3 of 5 unit tests pass, 2 fail, 0 inert, 0 unrecorded (sandbox: sandbox-exec).
```

The two force-push tests turn red on the mutant and the others stay green: the tests catch exactly the
deleted guard. The hostile test records 4 payloads that slip past the read-before-edit guard: a finding about
the guard.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `error: required option '--estate <root>' not specified` (exit 2) | no estate root | `--estate <root>` |
| `no outcome recorded: run --record on the original first` (exit 2) | the tests were never recorded | run once with `--record` on the original estate |
| `the estate no longer runs the <event> guard <name> on <tool>` (exit 1) | the guard was removed from the settings | expected on a mutant; on the original, restore the guard or regenerate |
| `flaky on the original: not compared` | the guard's outcome varied across the record runs | make the guard deterministic, then record again |
| a `guard_speed` test fails | a run took longer than the guard's `timeout` | speed up the guard, or raise its `timeout` in the settings |
