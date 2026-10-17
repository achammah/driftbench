---
title: Reading validator items
summary: List a validator's whole bank, every failing item, or the auditor's blind view, and act on one failing item.
commands:
  - validate
see_also:
  - validate-overview
  - validate-mutants-and-rulings
  - validate-executor-loop
next:
  - validate-floors
---

## What it is

Every validator level is a bank of items, and a failing level prints its failing items. Three options of
`driftbench validate` widen what a run shows, from the same run:

* `--items` runs every level, also above the first failing one, and lists the whole bank: each item with
  its family, tier, level, component and pass or FAIL per seed, then the bank score and the distinct
  failing causes.
* `--all-levels` runs every level and lists every failing item of every level, once each, with the seeds
  it failed on and its cause.
* `--blind` is the auditor's view: it removes every `cause` and cuts every item detail before its
  trailing `Fix:` hint, in the table, the listings and the JSON.

None of the three changes the level of the run or the exit code. A level computed above the first failing
one is marked `beyond` in the table and never counts.

An item, as a run prints it:

```text
      scale/prompt-100000-entries  [tier 3]  [packages/judges/src/prompt.ts]  the fastest of three runs took 9485 ms, budget 6000 ms. Fix: Keep the operation linear in its input.
```

| Part | Meaning |
|---|---|
| `scale/prompt-100000-entries` | the item id, stable across runs and seeds |
| family (the group heading above the item, such as `family scale (4):`) | the group of items built by one generator, such as one fault class, one transform or one prompt style |
| `[tier 3]` | difficulty from 1 (easiest) to 5 |
| `[packages/judges/src/prompt.ts]` | the one component the item points at: the file (sometimes `file#function`) to change |
| detail | what the oracle expected and what came back |
| `Fix: ...` | the bank author's hint, when there is one |
| cause (in `--all-levels` and the JSON) | the one change that would make the item pass. Items sharing a cause are one problem |

## When to use it

* `--items`: when you drive a validator as an executor (every iteration records the bank), and when you
  want to know how far a component is from 100 percent, not only where the ladder stops.
* `--all-levels`: when you want every failing item at once, for triage, for an audit sample, or to see
  whether one cause spans levels.
* `--blind`: when you audit a validator and must judge the items without the builder's causes and hints
  (`docs/validators.md` section 12.7). The executor's view, without `--blind`, keeps them.

## Commands and every option

```
driftbench validate <component|all> [--items] [--all-levels] [--blind] [--json] [--seed <n>] [--seeds <a..b>] [--hidden]
```

| Option | Default | Meaning |
|---|---|---|
| `--items` | off | compute every level and list the whole bank per family, with pass or FAIL per seed, the bank score and the distinct failing causes |
| `--all-levels` | off | compute every level and list every failing item of every level, grouped by level, with its family, tier, component, seeds, detail and cause |
| `--blind` | off | strip every `cause` and every trailing `Fix:` hint (any case), and leave out the cause counts |
| `--json` | off | print the report as JSON; `--items` adds `bank`, `--all-levels` adds `failingItems` |
| `--seed`, `--seeds`, `--hidden` | seed 1 | the seeds, as in `validate-overview` |

`--items`, `--all-levels` and `--blind` combine with each other and with a plain run or `--check-floor`.
They do not go with `--brief`, `--journal`, `--check-handover` or `--hardness` (exit 64). With
`--check-floor`, a ladder with a positive floor computes only through its floor, so levels above it stay
unmeasured even with these options.

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

The same as a plain run (`validate-overview`): the repository root, its fixtures and the seeds. A full
run does not stop at the first failing level, so it takes as long as the whole bank on every seed.

## Outputs and how to read them

### The table and the first failing level

As in a plain run. With `--items` or `--all-levels`, cells above the first failure read like
`0.96 FAIL (1) beyond`, and the line
`A level marked beyond was computed above the first failing level to list the bank; it never counts.`
follows the floor line.

### `--items`

After the table:

```text
Bank of stats: 834 items in 22 families, 834 pass on every seed (score 1).
Failing: 0 items, 0 distinct causes (0 items name no cause and count as their own).

Family agreement-analytic: 20 items, 0 failing, 0 distinct failing causes; per tier 2: 13, 3: 7
Item                                   Tier  Level       Component                        seed 1
analytic.agreement.kappa-linear.5      2     4 analytic  packages/stats/src/agreement.ts  pass
```

* The bank score is the items passing on every seed over the bank size. 100 percent is a score of 1 on
  seeds 1 to 20 and the hidden seed.
* `distinct causes`: failing items sharing a cause count once; an item with no cause counts as its own.
  This is how many separate fixes remain, a better measure of the work left than the failing count.
* Per family: its items, failing items, distinct failing causes and the items per tier; then one row per
  item with `pass`, `FAIL` or `not run` per seed.
* A level that returns no bank counts as one item of the family `levels`.

With `--json` the report gains `bank`:
`{ seeds, size, passing, score, byFamilyTier, failingByFamily, failingCauses, failingWithoutCause,
failingCausesByFamily, rows }`, where each row is
`{ level, levelId, id, component, family, tier, cause, perSeed: ["pass" | "fail" | "not run", ...],
passEverySeed }`. These are the numbers an executor's journal row copies (`validate-executor-loop`).

### `--all-levels`

After the table and the first failing level:

```text
All failing items of judges, every level: 3 items.
Level 20 scale: 3 items
  scale/escape-10000000-characters-of-tags  [family scale, tier 4]  [packages/judges/src/prompt.ts]  seeds 1  the fastest of three runs took 25208 ms, budget 12000 ms.
```

Each line: id, family and tier, component, the seeds it failed on, the detail of the first seed it failed
on, and `(cause: ...)` unless `--blind`. With `--json` the report gains `failingItems`:
`[{ level, levelId, id, component, family, tier, cause, detail, seeds }]`, ordered by level then id.

### How to act on one failing item

1. Read the id and the family. The family says which generator built the input. Item ids are built in
   the ladder's source, so searching for the fixed part of the id, such as
   `grep -rn 'prompt-' packages/validators/src/ladders/judges`, finds the code that builds it and its
   oracle.
2. Read the component. That is the file to change. The validator's own files are not: they are protected
   (`validate-protect`), and an item that looks wrong is reported, not edited
   (`validate-mutants-and-rulings`).
3. Read the detail. It names what the oracle expected and what came back, often with the input.
4. Read the cause (`--all-levels` without `--blind`, or the JSON). Group the failing items by cause: one
   fix per cause.
5. Write a test in the component's package that reproduces the item, see it fail, fix the component, see
   it pass.
6. Re-run the same validator on the same seed, then on `--seeds 1..20`, then with `--hidden`.

A scale item (family `scale`) times its operation. When it fails by a small margin, re-run it on a quiet
machine before treating it as a regression: the judges scale items keep the fastest of three runs and the
statistics and system scale items use processor time, but a heavily loaded machine still moves them.

## Worked example

Each ladder command below runs a whole ladder, which takes minutes, so it is shown here and not run by the
help test. They were run at the repository root on seed 1. Fast checks of the option rules run in the last
block.

```bash
pnpm -s driftbench validate judges --all-levels --blind
```

```text
Validator judges (ladder version 2)
Level  Name                                                          Metric                                   Threshold  seed 1
1      the seven levels of version 1                                 items of v1 passing / 37 items           >= 1       1 pass
2      the answer contract under hostile output                      items of contract passing / 48 items     >= 1       1 pass
3      the same request, the same prompt, key and verdict            items of consistency passing / 21 items  >= 1       1 pass
4      cassettes replay what they recorded                           items of cassette passing / 21 items     >= 1       1 pass
5      judge clients read what providers send back                   items of clients passing / 29 items      >= 1       1 pass
6      criteria files and their fixture pairs                        items of criteria passing / 20 items     >= 1       1 pass
7      the judge check beside machine verdicts                       items of check passing / 24 items        >= 1       1 pass
8      rubrics a judge can answer                                    items of rubric passing / 20 items       >= 1       1 pass
9      rule judges read the rendered prompt under transforms         items of render passing / 62 items       >= 1       1 pass
10     a request fitted to a prompt budget                           items of budget passing / 20 items       >= 1       1 pass
11     evidence quotes the data                                      items of evidence passing / 21 items     >= 1       1 pass
12     the screen flags instructions to the judge, not their twins   items of injection passing / 102 items   >= 1       1 pass
13     the judge's words in customer talk are not instructions       items of precision passing / 20 items    >= 1       1 pass
14     documented attacks on the judge                               items of attacks passing / 22 items      >= 1       1 pass
15     council majority: sizes, weights, correlated errors           items of council passing / 37 items      >= 1       1 pass
16     cascade cost and agreement                                    items of cascade passing / 24 items      >= 1       1 pass
17     turn by turn judging: the lowest turn, drift onset, recovery  items of turns passing / 20 items        >= 1       1 pass
18     pairwise judging and rankings                                 items of pairwise passing / 22 items     >= 1       1 pass
19     calibration coverage and skewed prevalence                    items of calibration passing / 42 items  >= 1       1 pass
20     the same operations at 10 and 100 times the input             items of scale passing / 26 items        >= 1       0.884615 FAIL (3)
Level per seed: 1 = 19
Level of the run: 19 of 20, the minimum over 1 seed.
Floor: 20. BELOW THE FLOOR.
Items of the first failing level:
  Seed 1, level 20 scale (the same operations at 10 and 100 times the input), 3 items:
    family scale (3):
      scale/prompt-100000-entries  [tier 3]  [packages/judges/src/prompt.ts]  the fastest of three runs took 9065 ms, budget 6000 ms.
      scale/parse-after-10000000-characters  [tier 4]  [packages/judges/src/contract.ts]  the fastest of three runs took 16871 ms, budget 12000 ms.
      scale/escape-10000000-characters-of-tags  [tier 4]  [packages/judges/src/prompt.ts]  the fastest of three runs took 25208 ms, budget 12000 ms.

All failing items of judges, every level: 3 items.
Level 20 scale: 3 items
  scale/escape-10000000-characters-of-tags  [family scale, tier 4]  [packages/judges/src/prompt.ts]  seeds 1  the fastest of three runs took 25208 ms, budget 12000 ms.
  scale/parse-after-10000000-characters  [family scale, tier 4]  [packages/judges/src/contract.ts]  seeds 1  the fastest of three runs took 16871 ms, budget 12000 ms.
  scale/prompt-100000-entries  [family scale, tier 3]  [packages/judges/src/prompt.ts]  seeds 1  the fastest of three runs took 9065 ms, budget 6000 ms.
```

The same ladder without `--blind`, earlier on the same machine, printed the hints the blind view cut:

```text
      scale/prompt-100000-entries  [tier 3]  [packages/judges/src/prompt.ts]  the fastest of three runs took 9485 ms, budget 6000 ms. Fix: Keep the operation linear in its input.
```

The two runs failed different scale items (4 items, then 3): both ran while the machine was heavily
loaded, which is the timing caveat above. The exit status was 19, the level reached.

The bank listing, `pnpm -s driftbench validate stats --items`, prints 916 lines; its first family:

```text
Bank of stats: 834 items in 22 families, 834 pass on every seed (score 1).
Failing: 0 items, 0 distinct causes (0 items name no cause and count as their own).

Family agreement-analytic: 20 items, 0 failing, 0 distinct failing causes; per tier 2: 13, 3: 7
Item                                   Tier  Level       Component                        seed 1
analytic.agreement.kappa-linear.5      2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-linear.6      2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-linear.7      2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-none.1        2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-none.2        2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-none.3        2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-none.4        2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-quadratic.8   2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-quadratic.9   2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-quadratic.10  2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-relabel.1     2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-relabel.2     2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.kappa-relabel.3     2     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.alpha-interval.1    3     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.alpha-interval.2    3     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.alpha-interval.3    3     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.alpha-nominal.1     3     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.alpha-nominal.2     3     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.alpha-nominal.3     3     4 analytic  packages/stats/src/agreement.ts  pass
analytic.agreement.alpha-nominal.4     3     4 analytic  packages/stats/src/agreement.ts  pass
```

One bank row of `pnpm -s driftbench validate stats --items --json`:

```text
{"level": 1, "levelId": "reference", "id": "reference.special.logGamma", "component": "packages/stats/src", "family": "reference", "tier": 1, "cause": "special.logGamma differs from the scipy and numpy reference values", "perSeed": ["pass"], "passEverySeed": true}
```

The option rules, which the help test runs:

```sh
driftbench validate stats --items --brief # exit 64
driftbench validate stats --blind --hardness # exit 64
```

```text
--items, --all-levels and --blind go with a run, not with --brief, --journal, --check-handover or --hardness.
--items, --all-levels and --blind go with a run, not with --brief, --journal, --check-handover or --hardness.
```

## Common errors

| Message or symptom | Cause | Fix |
|---|---|---|
| `--items, --all-levels and --blind go with a run, ...` (exit 64) | a listing option with a loop mode | run the listing and the loop mode separately |
| an item shows `not run` on some seeds | `--items` lists a level a seed never computed in that run | compare seeds on the same run; `not run` is no verdict |
| a level marked `beyond` fails but the run's level did not drop | levels above the first failure only list the bank | fix the first failing level first |
| the levels above the floor read `not run` | `--check-floor` stops a ladder at its floor | drop `--check-floor` to measure the whole bank |
| the `Fix:` hints and causes are missing | `--blind` was given | drop `--blind` for the executor's view |
| a scale item fails on one run and passes on the next | the item is timed and the machine is loaded | re-run on a quiet machine; a regression fails every time |
