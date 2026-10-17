---
title: Validators and their ladders
summary: Run a validator ladder that proves one part of driftbench works, and read its table, its seeds and the level it reaches.
commands:
  - validate
see_also:
  - validate-reading-items
  - validate-floors
  - validate-executor-loop
  - validate-protect
  - validate-mutants-and-rulings
  - validate-map
  - validate-generator
  - validate-judges
  - validate-system
  - validate-estate
  - validate-stats
  - validate-self-checks
  - validate-research-replays
next:
  - validate-reading-items
---

## What it is

A validator is code that proves one part of driftbench works. It contains no model. It builds an input
from a hidden truth it holds in memory (a planted rule, a planted fault, a population with a known rate),
runs one part of driftbench on that input, and compares what came back with the truth. Because the
validator wrote the truth, it knows the right answer before the component runs.

Each validator is a ladder of levels. A level is a bank of items. An item is one capability the component
must have: an id, a family, a difficulty tier from 1 to 5, the one source file it points at, and a
`cause` (the one change that would make it pass). Every level has the metric "items passing / items" and
the threshold 1: every item of the level passes on the seed, or the level fails and prints its failing
items. Levels are ordered by the cost of diagnosis, cheapest first. The run stops at the first failing
level, so a builder never chases two causes at once.

`driftbench validate <component>` runs one ladder. Six ladders are registered, by component:

| Component | What it proves | Levels | Ladder version | Topic |
|---|---|---|---|---|
| `estate` | the estate loop (scan, lint, plan, generate, maintain) closes on generated estates | 7 | 1 | `validate-estate` |
| `generator` | generated tests catch the faults they claim to catch | 22 | 1 | `validate-generator` |
| `judges` | judges classify, resist injection and agree, with no model call | 20 (21 in billed mode) | 2 | `validate-judges` |
| `map` | extraction finds what an agent's prompt and files specify | 8 | 2 | `validate-map` |
| `stats` | the statistics functions match their references and their planted truths | 7 | 2 | `validate-stats` |
| `system` | the whole chain (runner, checks, store, report, CLI) reports the truth | 11 | 5 | `validate-system` |

`all` runs every registered ladder. The names `all`, `floors`, `protect` and `list` are reserved: `floors`
and `protect` are modes of the same command (topics `validate-floors` and `validate-protect`), and no
ladder can take any of the four names. There is no `list` mode: the error message of an unknown component
prints the registered names.

The ladders are registered in `packages/validators/src/ladders/index.ts` (`registeredLadders()`). The
design is `docs/validators.md`.

## When to use it

* After a change to a component, to see whether it still reaches its level: run that component's ladder on
  the seed you worked on, then on `--seeds 1..20`, then with `--hidden`.
* Before a pull request that touches validated code: CI runs
  `driftbench validate all --seeds 1..3 --hidden --check-floor` on every push and pull request.
* When you drive a validator to 100 percent as an executor: see `validate-executor-loop`.
* When you suspect a validator item is wrong: see `validate-mutants-and-rulings`.

## Commands and every option

```
driftbench validate <component|all> [--seed <n>] [--seeds <a..b>] [--hidden] [--json] [--items] [--all-levels] [--blind]
driftbench validate <component|all> --check-floor [seed options]
driftbench validate <component> --brief [--fresh] [seed options]
driftbench validate <component> --journal <row.json>
driftbench validate <component|all> --check-handover
driftbench validate <component> --hardness [--json]
driftbench validate floors [--raise <component> <level> --ladder-version <n> --evidence <json>]
driftbench validate protect --branch <name> --base <ref>
```

Arguments:

| Argument | Meaning |
|---|---|
| `<component>` | a registered component (`estate`, `generator`, `judges`, `map`, `stats`, `system`), `all`, `floors` or `protect` |
| `[level]` | only with `floors --raise`: the level to raise the floor to. Any other use exits 64 |

Options of a run (this topic):

| Option | Default | Meaning |
|---|---|---|
| `--seed <n>` | seed 1 when neither seed option is given | one visible seed, a whole number |
| `--seeds <a..b>` | none | a range of visible seeds, such as `1..20`; whole numbers with a at most b; at most 1000 seeds. With `--seed`, both are used, in order, without repeats |
| `--hidden` | off | add the hidden seed of the current commit (see Inputs) |
| `--json` | off | print the report as JSON instead of the table |

Only one of `--brief`, `--journal`, `--check-handover`, `--check-floor` and `--hardness` may be given.
`--items`, `--all-levels` and `--blind` go with a run, not with `--brief`, `--journal`,
`--check-handover` or `--hardness`.

Environment variables a run reads:

| Variable | Effect |
|---|---|
| `DRIFTBENCH_BILLED_APPROVAL` | judges only: when set and not empty, adds the billed `live` level that calls real judge clients. Never set it unless the owner approved a sized card; leave it unset for every ordinary run |
| `DRIFTBENCH_JUDGES_SHARDS` | judges only: child processes side by side per seed, default 1, at most the cores less one. More shards run faster but slow the timed scale items |
| `DRIFTBENCH_STATS_IMPL` | stats only: a module path whose exports replace `@agent-nexus/driftbench-stats` in the bank's child processes. Used to plant a mutant (`validate-mutants-and-rulings`) |
| `DRIFTBENCH_STATS_SWEEP_LOG` | system only: a JSONL file where the statistics sub-runs of a system sweep log their cache key and report hash |
| `DRIFTBENCH_OTHER_NODE` | estate only: the second Node.js binary the determinism family compares against, default `/usr/local/bin/node` |

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

* The repository. The command looks for the nearest folder above the working folder that holds
  `pnpm-workspace.yaml` and uses it as the root; with none, the working folder itself is the root. Ladders
  read their fixtures from the root: `packages/validators/fixtures/**`, `examples/acme/**`,
  `examples/estates/**`, `packages/stats/test/reference/**` and the source packages they exercise. Run it
  from the repository root, with `pnpm -s driftbench validate ...` or the built `driftbench` binary.
* `validators/floors.json` under the root, when present. A missing file means no floors. A file that does
  not parse exits 64.
* Seeds. A seed drives every generator of a ladder, so the same seed gives the same inputs. The visible
  seeds are the ones you choose. The hidden seed is 1000000 plus the first 8 hex digits of
  `git rev-parse HEAD` read as a number, modulo 1000000000: every commit has its own, so a fix that only
  works on the seeds it was built against fails in CI. Outside a git repository, or when HEAD is not a
  commit id, the hidden seed is 7777777 and the run prints `Note: git rev-parse HEAD failed (...); the
  hidden seed falls back to 7777777.` Some families do not depend on the seed (a committed fixture) and are
  judged once per run.

## Outputs and how to read them

The table, one per ladder:

```
Validator <component> (ladder version <n>, hidden seed <s>)
Level  Name  Metric  Threshold  seed 1  ...    one column per seed
```

The header names the ladder version only when it is above 1, and the hidden seed only with `--hidden`;
with neither, it is `Validator <component>`. Each seed cell is the observed value, then `pass` or
`FAIL (<number of failing items>)`, or `not run` for a level above the first failure. With `--items` or
`--all-levels`, a level computed above the first failure ends in `beyond` and never counts. Then:

* `Level per seed: 1 = 7, hidden = 7`: the highest level passed on each seed, 0 when level 1 fails.
* `Level of the run: <level> of <top>, the minimum over <n> seeds.`
* `Floor: <n>. At or above the floor.` or `Floor: <n>. BELOW THE FLOOR.` A component with no floor shows
  `Floor: 0.` A line follows when the file holds a floor for an older ladder version than the registered one,
  such as `The floor 7 belongs to ladder version 1; version 2 has no floor yet.` No component prints it at present.
* `No level failed.`, or `Items of the first failing level:` then, per seed, the failing level and its
  items grouped by family. Each item line is
  `<id>  [tier <t>]  [<file it points at>]  <detail>`. How to act on one is in `validate-reading-items`.

With `all`, one table per ladder, in component order.

`--json` prints the report instead:
`{ component, ladderVersion, level, top, seeds: [{ seed, hidden, level, top, rows, failing }], hiddenSeed }`,
wrapped in `{ "reports": [...] }` for `all`. Each row holds `level, id, name, metric, threshold, direction,
observed, pass, itemCount`, null for a level not run. `failing` is null or
`{ level, id, name, items: [{ id, component, detail, family, tier, cause }] }`. `hiddenSeed` is present
with `--hidden`: `{ seed, source: "head" | "fallback", head, note }`.

Exit codes:

| Exit | Meaning |
|---|---|
| 0 to 63 | a plain run: the level of the run, the minimum over its seeds of the highest level passed. `all` exits with the lowest over the ladders |
| 0 or 1 | `--check-floor`, `--check-handover`, `--hardness`, `--journal`, `floors --raise` and `protect`: 0 holds or written, 1 fails or refused |
| 64 | an input error: an unknown component, a bad seed, an unreadable file, a mode with the wrong options |
| 2 | an option the argument parser rejects, such as an unknown flag |

A plain run that does not reach the top of its ladder exits with a non-zero level, or 0 when level 1
fails. That is not an error: read the level, not the shell status. Use `--check-floor` when a script
needs 0 or 1.

## Worked example

The commands below run in a few seconds with no model call. Running a whole ladder takes minutes (see the
timing note under Common errors), so the ladder runs are shown after them.

```sh
driftbench validate floors
driftbench validate nosuch # exit 64
driftbench validate stats --seeds 3..1 # exit 64
driftbench validate stats 2 # exit 64
```

From a folder with no `validators/floors.json` above it, and then the errors:

```text
Floors (validators/floors.json): none.
No validator is registered for "nosuch". Registered: estate, generator, judges, map, stats, system.
--seeds takes a..b with whole numbers a <= b, such as 1..20, not "3..1".
Unexpected argument "2": a level is only taken by floors --raise.
```

A whole ladder, run from the repository root; the statistics ladder took 143 seconds on seed 1 on a busy
machine. Shown as text, not run by the help test: a whole ladder runs for minutes, and the level it reaches changes as the product is fixed.

```bash
pnpm -s driftbench validate stats
echo $?
```

```text
Validator stats (ladder version 2)
Level  Name                 Metric                                                                                      Threshold  seed 1
1      reference values     fixture groups matching scipy and numpy / groups                                            >= 1       1 pass
2      degenerate inputs    empty, NaN, infinite, out-of-domain, single and all-equal cases handled / cases             >= 1       1 pass
3      reproducibility      same seed same bits, other seed other draw, order invariance / items                        >= 1       1 pass
4      analytic truth       estimators and tests matching a constructed truth, enumeration or textbook formula / items  >= 1       1 pass
5      simulation coverage  planted designs whose coverage, recovery, error or power holds / designs                    >= 1       1 pass
6      scale and stability  one-million-row calls under budget and shift-stable results / items                         >= 1       1 pass
7      roadmap methods      methods the dossiers name, matching scipy, degenerate-safe, scaling / items                 >= 1       1 pass
Level per seed: 1 = 7
Level of the run: 7 of 7, the minimum over 1 seed.
Floor: 7. At or above the floor.
No level failed.
7
```

A ladder that stops early. The generator ladder on seed 1 failed level 2 after 63 seconds and exited 1:

```text
Validator generator
Level  Name                                           Metric                                     Threshold  seed 1
1      generate and lint                              items passing / items of the level (25)    >= 1       1 pass
2      differential against brute force               items passing / items of the level (25)    >= 1       0.96 FAIL (1)
3      hostile and degenerate maps                    items passing / items of the level (26)    >= 1       not run
4      green on the rule follower                     items passing / items of the level (25)    >= 1       not run
5      cheater resistance                             items passing / items of the level (25)    >= 1       not run
6      the validity gate                              items passing / items of the level (22)    >= 1       not run
7      boundary values                                items passing / items of the level (30)    >= 1       not run
8      paths of every flow                            items passing / items of the level (30)    >= 1       not run
9      phrase bank expansion                          items passing / items of the level (20)    >= 1       not run
10     behaviours exercised                           items passing / items of the level (20)    >= 1       not run
11     every fault class killed                       items passing / items of the level (72)    >= 1       not run
12     faults caught where they happen                items passing / items of the level (50)    >= 1       not run
13     modes and perturbations                        items passing / items of the level (141)   >= 1       not run
14     coverage of the hidden cells                   items passing / items of the level (31)    >= 1       not run
15     sequence coverage                              items passing / items of the level (27)    >= 1       not run
16     allocation over the strata                     items passing / items of the level (20)    >= 1       not run
17     coverage and diversity measures in the report  items passing / items of the level (40)    >= 1       not run
18     minimality                                     items passing / items of the level (55)    >= 1       not run
19     contrast and invariance                        items passing / items of the level (24)    >= 1       not run
20     fault interactions                             items passing / items of the level (1255)  >= 1       not run
21     stability across generator seeds               items passing / items of the level (50)    >= 1       not run
22     scale                                          items passing / items of the level (20)    >= 1       not run
Level per seed: 1 = 1
Level of the run: 1 of 22, the minimum over 1 seed.
Floor: 0. At or above the floor.
Items of the first failing level:
  Seed 1, level 2 differential (differential against brute force), 1 item:
    family differential (1):
      diff.phrases.filled  [tier 2]  [packages/generate/src/seed/scenario.ts#buildScenario]  1 user turns match no approved phrase: record-export-i01-base#save: "Save the record as exports/record.json."
```

## Common errors

| Message or symptom | Cause | Fix |
|---|---|---|
| `No validator is registered for "<x>". Registered: ...` (exit 64) | a misspelt component, or `list` | use one of the printed names, or `all` |
| `--seed takes a whole number, not "<x>".` (exit 64) | a seed that is not a whole number | `--seed 3` |
| `--seeds takes a..b with whole numbers a <= b, such as 1..20, not "<x>".` (exit 64) | a reversed or malformed range | `--seeds 1..20` |
| `--seeds covers at most 1000 seeds.` (exit 64) | a range over 1000 seeds | split the range |
| `Unexpected argument "<x>": a level is only taken by floors --raise.` (exit 64) | a second positional argument | drop it, or see `validate-floors` |
| `Choose one of --brief, --journal, --check-handover, --check-floor and --hardness.` (exit 64) | two modes at once | one mode per command |
| `--items, --all-levels and --blind go with a run, ...` (exit 64) | a listing option with a loop mode | run them separately |
| `--brief, --journal and --hardness take one component, not all.` (exit 64) | `all` with a one-component mode | name the component |
| `validators/floors.json is not a floors file: ...` (exit 64) | a hand-edited floors file | restore it from git; floors change only through `validate floors --raise` |
| `Note: git rev-parse HEAD failed (...); the hidden seed falls back to 7777777.` | `--hidden` outside a git repository | run inside the clone; the fallback seed is the same for every commit |
| exit status 0 to 63 from a plain run | the level the run reached, not a crash | read `Level of the run`; use `--check-floor` for 0 or 1 |
| a scale item fails with `the fastest of three runs took <n> ms, budget <m> ms` | timed items measure wall or processor time; a loaded machine slows them | re-run that ladder on a quiet machine before you treat it as a regression |
| a run takes many minutes | each ladder runs hundreds to thousands of items per seed; `--seeds 1..20` multiplies that by 20 | iterate on one seed, widen at the end |
