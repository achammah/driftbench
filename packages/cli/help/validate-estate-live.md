---
title: Live estate runs and estate mutants
summary: Run generated estate specs live through the runtime in a sandboxed copy of the estate, safely on a stand-in. Prove the tests can fail with estate mutants.
commands:
  - estate run
  - estate mutate
see_also:
  - validate-estate-generate
  - validate-estate-unit
  - validate-estate-replay
  - validate-mutants-and-rulings
next:
  - validate-estate-stats
---

## What it is

`estate run` runs live estate specs through the runtime's headless command (for `claude-code`, `claude -p`),
in a sandbox holding a copy of the estate, on the workspace seed each spec carries. The agent gets the ask
alone, never the test. Each block's trace (tool calls, skill loads, guard verdicts, stages, workspace
changes) is checked against the spec, and the run is stored. `--map` pins the copy to the map's hash and
refuses an estate that drifted from it. `--states` plants session states and hazards (a resumed session, a
compaction, a dead helper) from a state library.

A real runtime command is billed. A command is a stand-in when its first lines carry the marker
`@driftbench-stand-in`; only a stand-in runs without `--allow-billed`. The repository ships one:
`examples/estates/fixture/live/fake/claude.mjs`, a fake runtime that calls no model. By default it derives its
actions from the estate copy it runs in; with `FAKE_MANIFEST` set to an absolute path of
`examples/estates/fixture/live/fake/manifest.json` it plays the recorded streams of the Northwind proof.

`estate mutate <map> --atom <id>` copies the estate and either deletes one atom's quoted span (`--delete`) or
replaces it by its negation from a fixed table of forms (`--invert`), and writes the copy, its `map.yaml` and
`mutant.json`. The tests derived from that atom must then go red, live, in replay, unit or static runs, while
the others stay as they were. That is how you prove a test suite can fail.

## When to use it

* `estate run` with a stand-in: to check the runner, the specs and the checks with no cost.
* `estate run` with the real runtime and `--allow-billed`: to test the agent itself. Size the run first: specs
  times repeats times the cost of one block; cap it with `--max-budget-usd` and `--max-turns`.
* `estate mutate`: after generating a suite, to measure whether its tests catch the loss or the inversion of
  each atom.

## Commands and every option

```
driftbench estate run [specs...] --estate <root> --runtime claude-code --store <db> [--order <file>] [--command <bin>] [--map <file>] [--states <file>] [--set-env <NAME=VALUE>]... [--disallow <rules...>] [--lock-deny <paths...>] [--pass-env <names...>] [--timeout <ms>] [--model <name>] [--max-turns <n>] [--max-budget-usd <usd>] [--permission-mode <mode>] [--trust-estate] [--config host|isolated] [--allow-billed] [--progress <file>] [--judge claude:<model>] [--judge-command <path>] [--judge-budget <usd>] [--json]
driftbench estate mutate <map> --atom <id> (--delete | --invert) --to <dir> [--force] [--json]
```

`estate run`:

| Option | Default | Meaning |
|---|---|---|
| `[specs...]` | none | live spec files or folders, such as `<suite>/specs/live` |
| `--order <file>` | none | a run-order file (such as `run-order.txt`): one spec file or folder per line, relative to its own folder; `#` starts a comment. Its specs run after any `[specs...]` |
| `--estate <root>` | required | the estate root, or a mutant folder of `estate mutate` |
| `--runtime <name>` | required | the runtime adapter: `claude-code` |
| `--store <db>` | required | the store the runs are written to |
| `--command <bin>` | `claude` | the headless command |
| `--map <file>` | none | the approved map: pins the copy to its hash and checks its quotes |
| `--states <file>` | none | the state library: operations by session state and event |
| `--set-env <NAME=VALUE>` | none | a variable the runtime and its guards receive; repeat it |
| `--disallow <rules...>` | none | tools the runtime must refuse, passed as `--disallowed-tools` |
| `--lock-deny <paths...>` | none | paths the runtime and its children may neither read nor write (macOS lock); the owner config in `~/.claude` is always write-protected |
| `--pass-env <names...>` | none | names of your own environment variables the runtime receives, such as its credentials |
| `--timeout <ms>` | none | kill a turn after this long |
| `--model <name>` | the runtime's own | passed as `--model` |
| `--max-turns <n>` | none | the most agent turns per spec block, passed as `--max-turns` |
| `--max-budget-usd <usd>` | none | the most a spec block may spend, passed as `--max-budget-usd` |
| `--permission-mode <mode>` | the runtime's own | passed as `--permission-mode` |
| `--trust-estate` | off | allow the tools the estate's settings allow, and Skill, as a trusted folder would |
| `--config <where>` | `host`; `isolated` for a stand-in | the runtime's config folder: `host` (where the login lives) or `isolated` |
| `--allow-billed` | off | run a command that is not a stand-in: a billed live run |
| `--progress <file>` | none | append one JSON line per finished spec, so a stopped batch keeps its finished runs |
| `--judge <judge>` | none | judge the judged criteria with `claude:<model>`, such as `claude:haiku` (paid calls) |
| `--judge-command <path>` | `claude` | the command the judge runs |
| `--judge-budget <usd>` | none | stop judging once the judge spent this much; required for a billed judge |
| `--json` | off | print one JSON summary: `runs`, `passed`, `failed`, `undecided`, `notApplicable`, `costUsd` and the campaign |

`estate mutate`:

| Option | Default | Meaning |
|---|---|---|
| `<map>` | required | the approved estate map |
| `--atom <id>` | required | the atom to mutate |
| `--delete` | one of the two | remove the quoted span from its file |
| `--invert` | one of the two | replace the quote by its negation, by the fixed table of forms |
| `--to <dir>` | required | the folder of the mutant: it receives the copy, `map.yaml` and `mutant.json` |
| `--force` | off | replace an earlier mutant in the folder |
| `--json` | off | print the result as JSON |

## Inputs

* Live specs from `estate generate` (`<suite>/specs/live`), or hand-written specs with an estate target.
* The estate root, or a mutant folder.
* For `--states`, a library such as `examples/estates/fixture/live/states/library.json`, mapping each session
  state and hazard of the space map to runner operations (a recorded prefix, a compaction marker).

## Outputs and how to read them

`estate run` prints one line per spec: `✓`, `✗` with its failing checks (`block <n>: <check>`), or `!` with
a runtime error, each with its cost; then
`<n> specs run live on a stand-in: <p> pass, <f> fail. Cost ... Campaign <id>.` Notes come first: an estate
not pinned to a map, a spec whose judged criteria are inconclusive with no judge, a mutant being run. A spec
whose only non-passing checks are not applicable (a stage check with no stage record) counts as
`notApplicable`, not as a failure. Exit 0 every spec passes, 1 a spec fails, 2 a usage or input error
(nothing runs). The runs are in the store: read them with `driftbench report` (the results topics).

`estate mutate` prints the atom and its file, the line before and after, the map hash before and after,
any collateral atom the mutation also changes, and `Wrote <dir>: the estate copy, map.yaml and mutant.json.`
Exit 0 written, 2 a usage or input error with nothing written. Deleting a skill's `name:` line whose value
equals its folder name is refused as an equivalent mutant: the runtime names a skill by its folder.

## Worked example

On the stand-in, with no model call: generate a small suite, run two of its live folders, see a real runtime
refused, then write two mutants and see the refusals.

```sh
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out suite
driftbench estate run suite/specs/live/route_positive suite/specs/live/tool_denied --estate examples/estates/fixture --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs --store live.db --map examples/estates/fixture/approved.yaml
driftbench estate run suite/specs/live/route_positive --estate examples/estates/fixture --runtime claude-code --store live2.db # exit 2
driftbench estate mutate examples/estates/fixture/approved.yaml --atom gate.standing.read-a-file-before-editing-it --delete --to deleted
driftbench estate mutate examples/estates/fixture/approved.yaml --atom instruction.standing.never-force-push --invert --to inverted
driftbench estate mutate examples/estates/fixture/approved.yaml --atom gate.standing.read-a-file-before-editing-it --to x # exit 2
driftbench estate mutate examples/estates/fixture/approved.yaml --atom no.such --delete --to y # exit 2
driftbench estate mutate examples/estates/fixture/approved.yaml --atom gate.standing.read-a-file-before-editing-it --delete --to deleted # exit 2
```

Output after the generate report:

```text
✓ estate.p05  (0.0000 USD)
✓ estate.p08  (0.0000 USD)
✓ estate.p24  (0.0000 USD)
3 specs run live on a stand-in: 3 pass, 0 fail. Cost 0.0000 USD over 3 runs that report one, judge none 0.0000 USD of it. Campaign estate-run-c8ae104f2e8d.
claude is not a stand-in: a live run of the real runtime is billed. Size it first, then pass --allow-billed.
Mutant: delete gate.standing.read-a-file-before-editing-it in CLAUDE.md.
  before: - **R3.** Read a file before you edit it.
  after:  (the line is gone)
  map be2e7a0919cb -> 046d83f242ed
Wrote deleted: the estate copy, map.yaml and mutant.json.
Mutant: invert instruction.standing.never-force-push in CLAUDE.md.
  before: - **R6.** Never run `git push --force` on any branch.
  after:  - **R6.** Always run `git push --force` on any branch.
  map be2e7a0919cb -> 7101f74ddcc6
Wrote inverted: the estate copy, map.yaml and mutant.json.
Name one mutation: --delete or --invert.
Atom no.such is not in the map.
deleted is not empty; pass --force to replace an earlier mutant.
```

A mutant turning a live spec red, on the same stand-in. The mutant deletes `WebFetch` from the deny list of
the settings; the `tool_denied` spec of the suite asks the agent for a carrier page and expects `WebFetch`
not even to be offered:

```sh
driftbench estate mutate examples/estates/fixture/approved.yaml --atom tool.settings.deny-webfetch --delete --to no-deny
driftbench estate run suite/specs/live/tool_denied --estate examples/estates/fixture --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs --store original.db --map examples/estates/fixture/approved.yaml
driftbench estate run suite/specs/live/tool_denied --estate no-deny --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs --store mutant.db # exit 1
```

```text
Mutant: delete tool.settings.deny-webfetch in .claude/settings.json.
  before:     "deny": ["Bash(git push --force:*)", "Bash(rm -rf:*)", "WebFetch"],
  after:      "deny": ["Bash(git push --force:*)", "Bash(rm -rf:*)" ],
  map be2e7a0919cb -> 796f9715bcff
Wrote no-deny: the estate copy, map.yaml and mutant.json.
✓ estate.p24  (0.0000 USD)
1 spec run live on a stand-in: 1 pass, 0 fail. Cost 0.0000 USD over 1 run that report one, judge none 0.0000 USD of it. Campaign estate-run-dcc972819245.
note: mutant of tool.settings.deny-webfetch (delete): specs of the map be2e7a0919cb run on it
✗ estate.p24  (0.0000 USD)
    failing: block 0: tools_offered.exclude.WebFetch
1 spec run live on a stand-in: 0 pass, 1 fail. Cost 0.0000 USD over 1 run that report one, judge none 0.0000 USD of it. Campaign estate-run-eec428949e4a.
```

The same spec passes on the original and fails on the mutant: the test catches the loss of the deny rule.
The stand-in can also play the recorded Northwind streams: set `--set-env FAKE_MANIFEST=<absolute path of
examples/estates/fixture/live/fake/manifest.json>`. The path must be absolute, since the runtime runs inside
the estate copy.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `claude is not a stand-in: a live run of the real runtime is billed. Size it first, then pass --allow-billed.` (exit 2) | the default command is the real runtime | a stand-in with `--command`, or size the run and pass `--allow-billed` |
| `does not match the map` (exit 2) | the estate changed since the map named with `--map` | scan again, or drop `--map` |
| `the session state <s> has no operation in the state library; add one, or run the spec without it` | a spec plants a state and no `--states` library covers it | pass `--states examples/estates/fixture/live/states/library.json` or your own |
| `Name one mutation: --delete or --invert.` (exit 2) | neither or both | exactly one |
| `Atom <id> is not in the map.` (exit 2) | a misspelt atom id | copy it from the map or from `estate approve` |
| `<dir> is not empty; pass --force to replace an earlier mutant.` (exit 2) | the folder holds a mutant | another folder, or `--force` |
| a mutant changes no test result | no test covers that atom, or the runner cannot see its effect | a gap in the suite: add a phrase or a check for the atom |
