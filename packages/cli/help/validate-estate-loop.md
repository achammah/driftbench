---
title: Testing an agent estate
summary: The whole estate loop, from a project folder of standing instructions, skills and guards to a map, a plan, generated tests, runs and maintenance, with no model call.
commands:
  - estate scan
  - estate lint
  - estate approve
  - estate map
  - estate plan
  - estate plan approve
  - estate generate
  - estate static
  - estate unit
  - estate run
  - estate mutate
  - estate diff
  - estate impact
  - estate stats
  - replay
see_also:
  - validate-estate-scan
  - validate-estate-plan
  - validate-estate-generate
  - validate-estate-unit
  - validate-estate-live
  - validate-estate-maintain
  - validate-estate-replay
  - validate-estate-stats
  - validate-estate
next:
  - validate-estate-scan
---

## What it is

An estate is everything that specifies a code-interpreter agent: its standing instructions (for Claude Code,
`CLAUDE.md` and memory files), skills with references and scripts, helper agents, guards (hooks), tool
permissions, settings and a step list. `driftbench estate` reads an estate into a map of atoms, derives a
test plan from the approved atoms, generates task specs from the plan by code, runs those tests in four ways,
and keeps them true when the estate changes. The one runtime today is `claude-code`.

An atom is one place where the estate says what the agent must do, with a quote, its file and line span, and
a hash. There are fourteen kinds: `instruction`, `gate` (read Y before X), `route` (an ask of class X loads
skill Y), `skill`, `reference`, `script`, `subagent`, `guard`, `tool`, `setting`, `stage`, `register`
(output rules), `hazard` (compaction, a new session) and `invariant` (a property of the files). Code reads
the structured atoms and approves them as read; a model splits the prose into instruction, gate and
register atoms, which wait for a person's approval.

The loop, one command per step:

| Step | Command | Writes | Topic |
|---|---|---|---|
| 1. read the estate | `estate scan <root> --out map.yaml` | the map | `validate-estate-scan` |
| 2. check it | `estate lint map.yaml` | nothing | `validate-estate-scan` |
| 3. approve the prose atoms | `estate approve map.yaml --all` | the map, in place or `--to` | `validate-estate-scan` |
| 4. export the situation axes (optional) | `estate map map.yaml --to space.yaml` | a space map | `validate-estate-scan` |
| 5. derive the plan | `estate plan map.yaml --out plan.yaml` | the plan and `plan.summary.json` | `validate-estate-plan` |
| 6. approve the plan rows | `estate plan approve plan.yaml --all` | the plan | `validate-estate-plan` |
| 7. generate the tests | `estate generate --map map.yaml --plan plan.yaml --out suite` | `suite/specs`, `incomplete`, `static`, `unit`, the report, `run-order.txt` | `validate-estate-generate` |
| 8a. run static tests | `estate static suite/static --estate <root>` | nothing | `validate-estate-generate` |
| 8b. run unit tests (guards, scripts) | `estate unit suite/unit --estate <root> --record`, then without `--record` | the outcomes, into the test files | `validate-estate-unit` |
| 8c. replay recorded sessions | `replay <sessions> --suite suite/specs/replay` | runs, in a store or memory | `validate-estate-replay` |
| 8d. run live | `estate run suite/specs/live --estate <root> --runtime claude-code --store runs.db` | runs in the store | `validate-estate-live` |
| 9. prove the tests can fail | `estate mutate map.yaml --atom <id> --delete --to mutant`, then 8a to 8d on `mutant` | a mutant copy | `validate-estate-live` |
| 10. measure coverage | `estate stats --map map.yaml --plan plan.yaml --specs suite` | nothing | `validate-estate-stats` |
| 11. after the estate changes | `estate diff old.yaml new.yaml --out diff.json`, `estate impact diff.json --tests suite/specs` | the diff; retirements with `--write` | `validate-estate-maintain` |

Only three steps can call a paid model, and each refuses to unless asked: `estate scan` without `--no-model`
or `--replay`, `estate run` with a real runtime command (needs `--allow-billed`), and `--judge` on `run`
or `replay`. Every example in these topics uses the fictional Northwind estate in `examples/estates/fixture`
and calls no model.

The `driftbench validate estate` ladder (topic `validate-estate`) checks this whole loop on generated
estates.

## When to use it

* You maintain a Claude Code project (a `CLAUDE.md` and a `.claude/` folder) and want tests that prove the
  agent follows its rules, skills, guards and steps.
* You changed the estate and want to know which tests to regenerate, re-approve or retire.
* You have recorded sessions of the agent and want to check them against the rules, offline.

## Commands and every option

Each command has its own topic with every option and its default. The usage lines:

```
driftbench estate scan <root> --out <file> [--runtime claude-code] [--replay <file>] [--no-model] [--provider anthropic|openai] [--ceiling <characters>] [--ignore <glob>]... [--user-skills <folder>] [--force]
driftbench estate lint <map> [--ceiling <characters>] [--ignore <glob>]... [--user-skills <folder>]
driftbench estate approve <map> [--kind <kind>]... [--atom <id>]... [--all] [--to <file>]
driftbench estate map <map> --to <file> [--all] [--agent <name>]
driftbench estate plan <map> --out <file> [--t <n>] [--space <file>] [--k <n>] [--force]
driftbench estate plan approve <plan> [--all] [--row <id>]... [--strike] [--out <file>]
driftbench estate generate --map <file> --plan <file> --out <dir> [--seed <n>] [--phrases <file>] [--sessions <file>] [--focus <file>] [--no-fallback] [--no-judge] [--force] [--json]
driftbench estate static <tests...> --estate <root> [--runtime claude-code] [--ceiling <characters>] [--json]
driftbench estate unit <tests...> --estate <root> [--runtime claude-code] [--record] [--no-sandbox] [--jobs <n>] [--json]
driftbench estate run [specs...] --estate <root> --runtime claude-code --store <db> [run options]
driftbench estate mutate <map> --atom <id> (--delete | --invert) --to <dir> [--force] [--json]
driftbench estate diff <old> <new> [--json] [--out <file>] [--old-guards <file>] [--new-guards <file>]
driftbench estate impact <diff> --tests <dir> [--write] [--json] [--out <file>] [--replay <sessions>] [--suite <dir>] [--store <db>]
driftbench estate stats --map <map> --plan <plan> --specs <dir> [--sessions <dir>] [--json]
driftbench replay <sessions...> --suite <dir> [--decisions <logs...>] [--steps <feeds...>] [--store <db>] [--owner <values...>] [--owner-file <file>] [--judge claude:<model>] [--judge-command <path>] [--judge-budget <usd>] [--json]
```

`driftbench estate --help` and `driftbench estate <command> --help` print the usage of each.

## Inputs

* An estate root. For `claude-code`, the project folder holding `CLAUDE.md` and `.claude/` (skills,
  agents, memory, `settings.json`, guards, a check registry, `steps.json`).
* Optionally `driftbench.estate.yaml` at the root, with `ignore`, `externals`, `aliases` and `scripts` keys
  (topic `validate-estate-scan`).
* Beside the map, optionally a phrase bank `phrases.yaml` and a session index `sessions/index.yaml`
  (topic `validate-estate-generate`). Every field of the map, plan, bank and index is documented in
  `docs/reference/estate-files.md`.

## Outputs and how to read them

Every step prints what it wrote and ends with a `Next:` line or a count line. Exit codes are the same
across the estate commands: 0 done, 1 done but something needs a person (a lint finding, a wait for
approval, an incomplete spec, a failing test), 2 a usage or input error with nothing written.

The concepts behind the outputs are on `docs/estate.md`: atoms (section 1), the estate graph and the lint
(section 2), the situation axes (section 3), the plan (section 4), generation (section 5), replay, unit and
live runs (section 6), coverage (section 7) and maintenance (section 8).

## Worked example

The whole loop on the Northwind estate, in a scratch folder, with no model call. The scan reads the
recorded model answers in `answers.yaml`; the plan used for generation is a small hand plan of 37 rows.

```sh
driftbench estate scan examples/estates/fixture --replay examples/estates/fixture/answers.yaml --out map.yaml
driftbench estate lint map.yaml # exit 1
driftbench estate approve map.yaml --all
driftbench estate plan map.yaml --out plan.yaml
driftbench estate plan approve plan.yaml --all
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out suite
driftbench estate static suite/static --estate examples/estates/fixture # exit 1
driftbench estate unit suite/unit --estate examples/estates/fixture --record
driftbench estate unit suite/unit --estate examples/estates/fixture
driftbench estate stats --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --specs suite
```

The first lines of each output (each command has the whole of its output in its own topic):

```text
Wrote map.yaml: 125 atoms (68 read by code and approved, 57 split from prose by the model and waiting for approval), 54 edges.
map.yaml: estate at examples/estates/fixture, 125 atoms.
  ORPHAN             .claude/skills/invoice-reconcile/references/old-tolerances.md: nothing in the estate names this file
6 findings.
Approved 57 atoms in map.yaml; 68 were already approved.
Wrote plan.yaml: 1568 rows (361 from the contract, 10 journeys, 1197 pairwise), all proposed. Summary in plan.summary.json.
Approved 1568 rows in plan.yaml; 0 were already approved.
Map ../examples/estates/fixture/approved.yaml (claude-code), hash be2e7a0919cb: 125 atoms.
Wrote 51 files to suite.
✗ estate.p32  guard_paths_anchored does not hold: {"unanchored":["python3 .claude/guards/ledger-guard.py"]}
Recorded 5 unit tests (sandbox: sandbox-exec); 0 have no fixture.
5 of 5 unit tests pass, 0 fail, 0 inert, 0 unrecorded (sandbox: sandbox-exec).
Kind  atoms  tested  enforced
```

The lint and the static test fail on purpose: the Northwind estate carries planted defects (an orphan file,
an unanchored guard path). On Linux the unit runner prints `sandbox: none`.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `error: required option '--out <file>' not specified` (exit 2) | `estate scan` or `estate plan` without `--out` | name the file to write |
| `<file> already exists: pass --force to replace it (the approvals in it are lost).` (exit 2) | the target exists | another name, or `--force` |
| `no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL. Pass --no-model to read the structured atoms only.` (exit 2) | `estate scan` with neither `--no-model` nor `--replay`, and no key | add `--no-model` for the structured atoms only, `--replay <answers>`, or set a key (a paid call) |
| `claude is not a stand-in: a live run of the real runtime is billed. ...` (exit 2) | `estate run` with the real runtime and no `--allow-billed` | use a stand-in command, or size the run and pass `--allow-billed` |
| `estate generate` exits 1 | rows still proposed, or incomplete specs | approve the plan; read the gap list (topic `validate-estate-generate`) |
