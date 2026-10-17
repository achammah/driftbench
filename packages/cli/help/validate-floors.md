---
title: Validator floors
summary: Read the level each validator must hold in CI, check a run against it, and raise it with evidence.
commands:
  - validate
see_also:
  - validate-overview
  - validate-executor-loop
  - validate-protect
next:
  - validate-executor-loop
---

## What it is

A floor is the level a validator's ladder must reach on every seed in CI. The floors live in
`validators/floors.json`. A floor belongs to one ladder version: when a ladder's bank is rebuilt, the
ladder gets a new version and starts a new floor. Within a version a floor only rises. Raising it is a
command that checks the evidence run, and a commit of its own. The floor is how progress is locked in:
once a level is held on every seed, no later change may drop below it without CI failing.

Two commands use the floors:

* `driftbench validate floors` prints them, and with `--raise` rewrites the file, upward only.
* `driftbench validate <component|all> --check-floor` runs ladders and exits 1 when one is below its floor.

The floors at the time of writing, from `validate floors` at the repository root:

```text
Floors (validators/floors.json): judges = 20 (ladder version 2), map = 8 (ladder version 2), stats = 7 (ladder version 2), system = 9 (ladder version 5).
```

`estate` and `generator` have no floor. The `judges` floor of 20 belongs to ladder version 2, the
registered judges ladder, and is enforced. The earlier floor of 7 belonged to ladder version 1; the file
keeps it under `history.judges`, and it is not enforced. A run prints a line such as
`The floor 7 belongs to ladder version 1; version 2 has no floor yet.` only when the file holds a floor for an
older ladder version than the registered one; no component does so at present.

## When to use it

* `--check-floor`: in CI and before a pull request, to know whether a change dropped a validator below its
  floor. The CI job runs `driftbench validate all --seeds 1..3 --hidden --check-floor`.
* `floors`: to see what each validator must hold.
* `floors --raise`: when every visible seed you ran and the hidden seed reach a level above the floor, to
  lock it in. Only the maintainer raises floors: `validators/floors.json` is protected from executor
  branches (see `validate-protect`).

## Commands and every option

```
driftbench validate floors
driftbench validate floors --raise <component> <level> --ladder-version <n> --evidence <json>
driftbench validate <component|all> --check-floor [--seed <n>] [--seeds <a..b>] [--hidden] [--json]
```

| Option | Default | Meaning |
|---|---|---|
| `--raise <component>` | none | with `floors`: the component whose floor rises |
| `<level>` (positional, after `--raise <component>`) | none | the new floor, a whole number from 1 to the ladder's top |
| `--ladder-version <n>` | none, required with `--raise` | the ladder version the floor is for, a whole number of at least 1; it must be the registered ladder's version and the evidence's |
| `--evidence <json>` | none, required with `--raise` | the file holding a `driftbench validate --json` run of the component that reaches the level; a path relative to the working folder |
| `--check-floor` | off | run the ladders, then exit 1 when one is below its floor, else 0 |
| `--seed`, `--seeds`, `--hidden`, `--json` | seed 1, no hidden seed, table | the seeds and format of the `--check-floor` run, as in `validate-overview` |

`floors` with none of `--raise`, `<level>`, `--evidence` and `--ladder-version` prints the floors. Giving
some but not all four exits 64 with the usage line.

How `--check-floor` runs: a ladder whose registered version has a positive floor computes only through
that floor, so levels above it stay unmeasured, even with `--items` or `--all-levels`. A ladder with no
floor, or with a floor of an earlier version only, walks to its first failing level as usual.

Every option of `driftbench validate`, for reference (the topic named in the last column explains it):

| Option | Default | Meaning | Topic |
|---|---|---|---|
| `<component>` | required | a registered component, `all`, `floors` or `protect` | `validate-overview` |
| `[level]` | none | only with `floors --raise`: the new floor | `validate-floors` |
| `--seed <n>` | seed 1 when no seed option is given | one visible seed | `validate-overview` |
| `--seeds <a..b>` | none | a range of visible seeds, at most 1000 | `validate-overview` |
| `--hidden` | off | add the hidden seed of the current commit | `validate-overview` |
| `--json` | off | print the report, or the hardness, as JSON | `validate-overview` |
| `--items` | off | compute every level and list the whole bank | `validate-reading-items` |
| `--all-levels` | off | compute every level and list every failing item | `validate-reading-items` |
| `--blind` | off | strip causes and `Fix:` hints (the auditor's view) | `validate-reading-items` |
| `--check-floor` | off | exit 1 when a run is below its floor, else 0 | `validate-floors` |
| `--raise <component>` | none | with `floors`: the component whose floor rises | `validate-floors` |
| `--ladder-version <n>` | default version | select a registered version; with `floors --raise`: the floor version | `validate-floors` |
| `--evidence <json>` | none | with `floors --raise`: the `--json` run that reaches the level | `validate-floors` |
| `--brief` | off | print the executor brief with the live state | `validate-executor-loop` |
| `--fresh` | off | with `--brief`: leave out the hypotheses | `validate-executor-loop` |
| `--journal <row.json>` | none | append a validated journal row | `validate-executor-loop` |
| `--check-handover` | off | exit 1 when `HANDOVER.md` disagrees with the journal | `validate-executor-loop` |
| `--hardness` | off | print the hardness measurement from the journal | `validate-executor-loop` |
| `--branch <name>` | none | with `protect`: the pull request's branch | `validate-protect` |
| `--base <ref>` | none | with `protect`: the ref it merges into | `validate-protect` |
| `-h`, `--help` | off | print the command's usage | |

## Inputs

* `validators/floors.json` under the repository root (the nearest folder above the working folder with
  `pnpm-workspace.yaml`). Format version 2:

  ```json
  {
    "version": 2,
    "ladderVersion": { "judges": 2, "map": 2, "stats": 2, "system": 5 },
    "floors": { "judges": 20, "map": 8, "stats": 7, "system": 9 },
    "evidence": {
      "system": { "level": 9, "seeds": ["1", "2", "3", "20", "hidden"], "hiddenSeed": 88145333,
                  "head": "<the commit the hidden seed came from>", "ladderVersion": 5 }
    },
    "history": {
      "stats": [ { "ladderVersion": 1, "floor": 1, "evidence": { "level": 2, "ladderVersion": 1 } } ]
    }
  }
  ```

  (Shortened: the real `seeds` lists run 1 to 20 and every evidence entry carries `seeds`, `hiddenSeed`
  and `head`.) `history` keeps, per component, the floors of earlier ladder versions, oldest first. A
  format version 1 file (no `ladderVersion`) is read as ladder version 1 throughout.
* For `--raise`, the evidence file: the `--json` output of one run of the named component (or of an `all`
  run that includes it), of the same ladder version and ladder size, on at least one visible seed and the
  hidden seed of a real commit (not the 7777777 fallback), reaching the level on every seed. Make it with
  `pnpm -s driftbench validate <component> --seeds 1..20 --hidden --json > run.json`.

## Outputs and how to read them

`validate floors` prints one line, `Floors (validators/floors.json): <component> = <floor> (ladder version
<n>), ...` or `Floors (validators/floors.json): none.`, and exits 0.

`floors --raise` writes the file and prints
`The floor of <component> for ladder version <n> rises from <old> to <new> in validators/floors.json. Commit it on its own with the evidence run.`
It exits 0. The file now holds the new floor, its evidence summary (level, seeds, hidden seed, commit,
ladder version) and, when the version rose, the earlier floor moved to `history`. Commit the file alone,
with the evidence run in the commit message.

A refused raise prints `Refused: <reason>` and exits 1. The reasons:

| Refusal | Meaning |
|---|---|
| `The registered <c> ladder is version <r>; a floor for version <n> is refused.` | `--ladder-version` is not the registered ladder's |
| `validators/floors.json is at ladder version <v> for <c>; versions only rise.` | the file already holds a later version |
| `A floor is a whole level of at least 1, not <n>.` | level 0 |
| `<c> has <top> levels; <n> is above its top.` | the level is above the ladder's top |
| `The floor of <c> is <f>; it only rises, so <n> is refused.` | same version, level at or below the floor |
| `The evidence holds no run of <c>.` | the JSON is a run of another component, or an `all` run without it |
| `The evidence is not a driftbench validate --json run: ...` | the file is some other JSON |
| `The evidence ran ladder version <x>; the floor is for version <n>.` | the run is from another version |
| `The evidence ran a ladder of <t> levels; <c> now has <top>.` | the ladder changed size since the run |
| `The evidence must run at least one visible seed and the hidden seed (--hidden).` | `--hidden` or a visible seed missing |
| `The evidence ran the fallback hidden seed; run it inside the repository.` | the run had no git commit |
| `The evidence says level <x> but its seeds give <y>.` | an edited run |
| `The evidence does not reach <n> on seed <s>, ...` | the named seeds stopped below the level |

`--check-floor` prints the ladder tables as a plain run does, then, on standard error, one line per ladder
below its floor: `<component> is at level <l>, below its floor <f>.` With `all` it also fails, with one line
each, when the file holds a floor for a component with no registered ladder, a ladder version above the
registered one, or a floor above the top of its ladder. Exit 0 when every floor holds, 1 otherwise.

## Worked example

The worked example runs in a scratch folder with no `validators/floors.json`, so the first command prints
`none`. The errors show what each part of a raise needs. Then two evidence files, written by hand for this
example in the shape of a `driftbench validate estate --json` run, show a refusal and a raise. A real raise
uses the real `--json` output of the ladder, which reads git for its hidden seed.

```sh
driftbench validate floors
driftbench validate floors --raise stats 2 # exit 64
driftbench validate floors --raise nosuch 1 --ladder-version 1 --evidence run.json # exit 64
driftbench validate floors --raise stats two --ladder-version 2 --evidence run.json # exit 64
driftbench validate floors --raise stats 2 --ladder-version 2 --evidence run.json # exit 64
```

```text
Floors (validators/floors.json): none.
Raise a floor with: driftbench validate floors --raise <component> <level> --ladder-version <n> --evidence <json>.
No validator is registered for "nosuch".
The level is a whole number, not "two".
Cannot read the evidence run.json: ENOENT: no such file or directory, open '<scratch folder>/run.json'
```

Evidence with no hidden seed:

```json file=no-hidden.json
{ "component": "estate", "ladderVersion": 1, "level": 2, "top": 7,
  "seeds": [ { "seed": 1, "hidden": false, "level": 2 } ],
  "hiddenSeed": { "seed": 7777777, "source": "fallback" } }
```

Evidence with seed 1 and the hidden seed of a commit, both at level 2:

```json file=run.json
{ "component": "estate", "ladderVersion": 1, "level": 2, "top": 7,
  "seeds": [ { "seed": 1, "hidden": false, "level": 2 }, { "seed": 1123456789, "hidden": true, "level": 2 } ],
  "hiddenSeed": { "seed": 1123456789, "source": "head", "head": "0123456789abcdef0123456789abcdef01234567" } }
```

The raise writes `validators/floors.json`, so its folder must exist:

```sh setup
mkdir validators
```

```sh
driftbench validate floors --raise estate 2 --ladder-version 1 --evidence no-hidden.json # exit 1
driftbench validate floors --raise estate 2 --ladder-version 1 --evidence run.json
driftbench validate floors
driftbench validate floors --raise estate 1 --ladder-version 1 --evidence run.json # exit 1
driftbench validate floors --raise estate 3 --ladder-version 1 --evidence run.json # exit 1
driftbench validate floors --raise estate 2 --ladder-version 2 --evidence run.json # exit 1
```

```text
Refused: The evidence must run at least one visible seed and the hidden seed (--hidden).
The floor of estate for ladder version 1 rises from 0 to 2 in validators/floors.json. Commit it on its own with the evidence run.
Floors (validators/floors.json): estate = 2 (ladder version 1).
Refused: The floor of estate is 2; it only rises, so 1 is refused.
Refused: The evidence does not reach 3 on seed 1, hidden.
Refused: The registered estate ladder is version 1; a floor for version 2 is refused.
```

The file it wrote:

```text
{
  "version": 2,
  "ladderVersion": {
    "estate": 1
  },
  "floors": {
    "estate": 2
  },
  "evidence": {
    "estate": {
      "level": 2,
      "seeds": [
        "1",
        "hidden"
      ],
      "hiddenSeed": 1123456789,
      "head": "0123456789abcdef0123456789abcdef01234567",
      "ladderVersion": 1
    }
  }
}
```

In the repository, the whole raise and the CI check look like this. They are shown as text because both
read git (the hidden seed comes from `git rev-parse HEAD`), and the commit writes to git:

```bash
pnpm -s driftbench validate estate --seeds 1..20 --hidden --json > run.json
pnpm -s driftbench validate floors --raise estate 3 --ladder-version 1 --evidence run.json
git add validators/floors.json
git commit -m "chore(validators): raise the estate floor to 3 (ladder version 1)"
pnpm -s driftbench validate all --seeds 1..3 --hidden --check-floor
```

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `Raise a floor with: driftbench validate floors --raise <component> <level> --ladder-version <n> --evidence <json>.` (exit 64) | part of a raise is missing | give all four |
| `No validator is registered for "<x>".` (exit 64) | `--raise` names an unknown component | use a registered name |
| `The level is a whole number, not "<x>".` (exit 64) | the level is not digits | `--raise stats 3` |
| `--ladder-version is a whole number of at least 1, not "<x>".` (exit 64) | a bad version | read the version from the run's table header or its `ladderVersion` |
| `Cannot read the evidence <file>: ...` (exit 64) | missing file or bad JSON | write the run with `--json > run.json` first |
| `Refused: ...` (exit 1) | the evidence or the level breaks a rule above | read the reason; most often the run lacked `--hidden` or one seed stopped short |
| `<component> is at level <l>, below its floor <f>.` (exit 1) | a change made the ladder regress | run the ladder on that seed, read its first failing level, fix the component it names. Never lower a floor |
| `validators/floors.json holds a floor for <c>, which has no registered validator.` | a ladder was removed or renamed | the maintainer moves or removes the floor |
| `Unexpected argument "<n>": a level is only taken by floors --raise.` (exit 64) | a level given outside `floors --raise` | drop it |
| `driftbench: cannot use .../validators/floors.json: ENOENT: ...` (exit 2) | `floors --raise` in a folder with no `validators/` folder | run it at the repository root, or create the folder |
