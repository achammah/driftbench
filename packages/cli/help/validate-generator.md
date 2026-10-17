---
title: The generator validator
summary: What `driftbench validate generator` measures, its 22 levels and 2033 items, and how to read a failing generation item.
commands:
  - validate
see_also:
  - validate-overview
  - validate-reading-items
  - validate-map
  - validate-system
  - validate-mutants-and-rulings
next:
  - validate-judges
---

## What it is

The generator validator checks test generation: do the specs `driftbench generate` writes catch the faults
they claim to catch? From a hidden specification drawn by the seed, code writes:

* the approved map the generator reads (prompt, inventory, tool schemas, the map itself);
* a rule follower: a reference agent that follows the specification exactly (it reaches the stages in
  order, calls the tools the behaviours need with the right inputs, answers in the rule's language,
  confirms before consequential actions);
* a fault family: the follower with one rule broken per fault class, parameterised by where and how often;
* five cheaters, code-only agents that try to pass without doing the work: `constant` (the same reply
  every turn), `echo` (repeats the user), `copy-given` (copies every value of the Given into its reply),
  `every-tool` (calls every tool once per turn with empty inputs) and `replay-suite` (replays the
  hand-written suite's expected tool calls whatever the turn asks);
* the hand-written suite, as the baseline for coverage.

The real generator runs on the map, and its complete specs run through the real runner and checks on all
of these agents. A block any cheater passes is not a test. Coverage is measured against the hidden
specification's cells, not the map, so a map that lost a dimension is caught here too.

The ladder (version 1), from `driftbench validate generator`:

| Level | Id | Name | Items |
|---|---|---|---|
| 1 | `generate` | generate and lint | 25 |
| 2 | `differential` | differential against brute force | 25 |
| 3 | `hostile` | hostile and degenerate maps | 26 |
| 4 | `reference` | green on the rule follower | 25 |
| 5 | `cheaters` | cheater resistance | 25 |
| 6 | `gate` | the validity gate | 22 |
| 7 | `boundary` | boundary values | 30 |
| 8 | `paths` | paths of every flow | 30 |
| 9 | `phrases` | phrase bank expansion | 20 |
| 10 | `behaviours` | behaviours exercised | 20 |
| 11 | `faults` | every fault class killed | 72 |
| 12 | `adequacy` | faults caught where they happen | 50 |
| 13 | `modes` | modes and perturbations | 141 |
| 14 | `coverage` | coverage of the hidden cells | 31 |
| 15 | `sequence` | sequence coverage | 27 |
| 16 | `allocation` | allocation over the strata | 20 |
| 17 | `report` | coverage and diversity measures in the report | 40 |
| 18 | `minimality` | minimality | 55 |
| 19 | `contrast` | contrast and invariance | 24 |
| 20 | `interactions` | fault interactions | 1255 |
| 21 | `stability` | stability across generator seeds | 50 |
| 22 | `scale` | scale | 20 |

2033 items in all. Level 2 compares the generator with a brute-force enumeration of the allowed cells.
Level 11 asks that every fault class is killed by at least one block; level 12 that it is killed at or
after the block where the fault first changed what the agent did (a failure before that is a flaky check,
not a kill). Level 20 holds the pairwise and three-way combinations of fault classes, drawn by code.
Level 22 runs the generator at 10 and 100 times its usual input under processor-time budgets of 60 and 120 seconds.

The generator has no floor yet.

## When to use it

* After a change to `packages/generate`: enumeration, the seeded scenario builder, phrases, the validity
  gate, minimality, allocation or the coverage report.
* After a change to the runner or checks that generated specs rely on.
* When a generated suite passes a fault you expected it to catch.

## Commands and every option

```
driftbench validate generator [--seed <n>] [--seeds <a..b>] [--hidden] [--json] [--items] [--all-levels] [--blind] [--check-floor]
driftbench validate generator --brief [--fresh] | --journal <row.json> | --check-handover | --hardness [--json]
```

Every option is the general one: seeds and output in `validate-overview`, listings in
`validate-reading-items`, `--check-floor` in `validate-floors`, the loop modes in
`validate-executor-loop`. The generator ladder reads no environment variable of its own.

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
| `--ladder-version <n>` | none | with `floors --raise`: the ladder version of the floor | `validate-floors` |
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

* The seed. It draws the hidden specification and everything derived from it. Seed 1 is also committed
  under `packages/validators/fixtures/generator/seed-1` (`approved.yaml`, `prompt.md`, `inventory.yaml`,
  `tools.yaml`, `family.yaml`, `oracle.mjs`, `hidden.json`); a test compares a fresh rendering of seed 1
  with those files byte for byte. Every other seed is rendered into a temporary folder and removed after
  the run.
* The Acme example and its fault family under `examples/acme/faults/` (protected, see `validate-protect`),
  which the Acme items of the bank run on.
* The generator, runner and checks, through the same entry points the CLI uses. No model is called.

## Outputs and how to read them

The general table (`validate-overview`). A failing generator item points at a file of
`packages/generate` (often `file#function`) and says what the oracle expected. Typical readings:

| Family or level | Detail says | Look at |
|---|---|---|
| `differential` | a turn matches no approved phrase, or a cell is missing against brute force | the scenario builder or the enumeration named in the component |
| `reference` | the rule follower fails a block | the block's expectation is wrong: read the follower's trace and the map entry it came from |
| `cheaters` | a cheater passes a block | the check the block lacks; the item names the cheater |
| `faults`, `adequacy` | a fault class is never killed, or killed too early | the nearest block that targets the broken rule, and the check it lacks |
| `minimality` | a test is redundant for its planted fault | the selection that kept it |
| `scale` | the generator used more than 60 or 120 seconds of processor time | the stage named in the component |

Exit status: the level reached.

## Worked example

The ladder takes a minute or more per seed, so the help test runs only a fast check that the component
exists (the scratch folder has no journal, hence the exit 64):

```sh
driftbench validate generator --hardness # exit 64
```

```text
validators/generator/journal.jsonl: the journal holds no iteration 0 row: run and record iteration 0 first.
```

The ladder on seed 1, at the repository root (63 seconds, stopped at level 2). Shown as text, not run by the help test. A whole ladder runs for minutes, and the level it reaches changes as the product is fixed.

```bash
pnpm -s driftbench validate generator
```

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

It exited 1. Read the one item: the differential level found one generated user turn
(`record-export-i01-base#save`) whose wording matches no phrase of the approved bank. It points at
`buildScenario` in `packages/generate/src/seed/scenario.ts`, the code that fills the phrase templates.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| the run stops at level 1 or 2 and every later level reads `not run` | the ladder stops at the first failing level | fix that level, or add `--items` to see the whole bank |
| `packages/validators/test/generator/hidden.test.ts` fails after a change to the hidden specification | the committed seed 1 fixtures no longer match | the maintainer refreshes them with `pnpm exec tsx --tsconfig tsconfig.json packages/validators/fixtures/generator/refresh.ts` and commits the diff with the reason |
| a `scale` item fails | the generator is slow at 10 or 100 times its input, or the machine is loaded | re-run on a quiet machine; then look at the stage named |
| an item you believe is wrong | the oracle disagrees with your reading | do not edit the bank; see `validate-mutants-and-rulings` |
