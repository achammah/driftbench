---
title: The judges validator
summary: What `driftbench validate judges` measures, its 20 levels and 638 items, the billed live level, and how to read a failing judge item.
commands:
  - validate
see_also:
  - validate-overview
  - validate-reading-items
  - validate-system
  - validate-mutants-and-rulings
next:
  - validate-system
---

## What it is

The judges validator checks the judging machinery: do judges classify transcript slices right, keep their
verdict under edits that preserve the label, change it under edits that flip the label, resist
instructions planted in the data, agree with themselves, and combine into a council and a cascade
correctly? Labels come by construction: a transcript from the rule follower passes every criterion it
satisfies, and a transcript from a fault agent fails the criterion that fault breaks. No human labels
beyond the fixture pairs.

The deterministic bank runs with no model call: rule judges, scripted cassettes
(`packages/validators/fixtures/judges/*.cassette.json`), the answer contract, the council, the cascade,
calibration, and the transform and injection banks. The ladder (version 2), from
`driftbench validate judges`:

| Level | Id | Name | Items |
|---|---|---|---|
| 1 | `v1` | the seven levels of version 1 | 37 |
| 2 | `contract` | the answer contract under hostile output | 48 |
| 3 | `consistency` | the same request, the same prompt, key and verdict | 21 |
| 4 | `cassette` | cassettes replay what they recorded | 21 |
| 5 | `clients` | judge clients read what providers send back | 29 |
| 6 | `criteria` | criteria files and their fixture pairs | 20 |
| 7 | `check` | the judge check beside machine verdicts | 24 |
| 8 | `rubric` | rubrics a judge can answer | 20 |
| 9 | `render` | rule judges read the rendered prompt under transforms | 62 |
| 10 | `budget` | a request fitted to a prompt budget | 20 |
| 11 | `evidence` | evidence quotes the data | 21 |
| 12 | `injection` | the screen flags instructions to the judge, not their twins | 102 |
| 13 | `precision` | the judge's words in customer talk are not instructions | 20 |
| 14 | `attacks` | documented attacks on the judge | 22 |
| 15 | `council` | council majority: sizes, weights, correlated errors | 37 |
| 16 | `cascade` | cascade cost and agreement | 24 |
| 17 | `turns` | turn by turn judging: the lowest turn, drift onset, recovery | 20 |
| 18 | `pairwise` | pairwise judging and rankings | 22 |
| 19 | `calibration` | calibration coverage and skewed prevalence | 42 |
| 20 | `scale` | the same operations at 10 and 100 times the input | 26 |

638 items in all. Each family has the name of its level.

A 21st level, `live` (real judge clients, billed mode only), exists in code. It appears only when the
environment variable `DRIFTBENCH_BILLED_APPROVAL` is set to a non-empty value, the id of a sized card the
owner approved, together with the provider's key. Without it the ladder lists no live level and calls
nothing. Never set it for an ordinary run: it spends money.

Floors: the file holds a judges floor of 20 for ladder version 2, the registered ladder, so a run below
level 20 prints `BELOW THE FLOOR.` and `--check-floor` exits 1. The earlier floor of 7 belonged to ladder
version 1; it is history under `history.judges` and is not enforced.

## Labellers, opt-in version 3

`driftbench validate judges --ladder-version 3 --items` runs the deterministic
labeller bank. The default version 2 above remains registered and unchanged.
Version 3 checks fictional paired text against fixed gold labels, using Cohen's
kappa and raw agreement. It covers abstention, `none`, label changes, near-miss
names, order and position bias, length bias, adversarial label mentions, replay
and cache identity. Null abstentions are counted and never scored as agreement.

The label-set hash includes each label name and definition; editing either
invalidates a recorded answer. All-empty, constant, always-abstaining and
first-label cheats must pass zero items. No live calls run in this version.

The five tiers require raw agreement/kappa of 0.90/0.80, 0.92/0.85, 0.94/0.90,
0.95/0.92 and 0.96/0.94. Every item in a tier must pass. Version-specific pilot,
audit and provisional hardness terms are in `validators/judges/v3/`.
`--hardness`, `--brief`, `--journal` and `--check-handover` select those files
when combined with `--ladder-version 3`. `validate all` uses default versions.

## When to use it

* After a change to `packages/judges`: the prompt renderer, the answer contract and its parser, the
  cassettes, the clients, the council, the cascade, the injection screen, calibration or pairwise judging.
* After a change to criteria files or their fixture pairs.
* Before you trust a new judge or rubric shape.

## Commands and every option

```
driftbench validate judges [--seed <n>] [--seeds <a..b>] [--hidden] [--json] [--items] [--all-levels] [--blind] [--check-floor]
driftbench validate judges --brief [--fresh] | --journal <row.json> | --check-handover | --hardness [--json]
```

Every option is the general one (`validate-overview`, `validate-reading-items`, `validate-floors`,
`validate-executor-loop`). Two environment variables are the judges ladder's own:

| Variable | Default | Effect |
|---|---|---|
| `DRIFTBENCH_BILLED_APPROVAL` | unset | non-empty adds the billed `live` level; leave it unset |
| `DRIFTBENCH_JUDGES_SHARDS` | 1 | child processes side by side per seed, at most the cores less one. More is faster, but parallel children slow each other's clocks and can fail timed `scale` items |

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

* The seed. It draws the transcripts, transforms, injection patterns and council draws.
* The judge fixtures under `packages/validators/fixtures/judges` (cassettes and a phrase bank) and the
  criteria files the `criteria` level reads.
* Isolation: the items run in child processes. An item that runs past 120 seconds fails as timed out, and
  a new child resumes at the next item, so an endless loop costs one item, not the run. This limit stops a
  hang; it does not judge speed.
* Speed: the `scale` items time selected operations at 10 and 100 times their usual input, keep the
  fastest of three runs, and fail over the item's budget.
* Quarantine: items no product page needs stay as code but count for nothing
  (`validators/judges/NEEDS.md`).

## Outputs and how to read them

The general table (`validate-overview`). Judge items carry a `Fix:` hint in their detail when the bank
author wrote one (the blind view strips it). Typical readings:

| Level | Detail says | Look at |
|---|---|---|
| `render`, `injection`, `precision`, `attacks` | a verdict moved under a label-preserving edit, or a planted instruction was obeyed or missed | the prompt renderer and the data-tag guard in `packages/judges/src/prompt.ts`, the screen |
| `contract` | a hostile answer was misread | the answer parser in `packages/judges/src/contract.ts` |
| `council`, `cascade` | a majority or a cascade verdict is wrong for its weights or cost | the council code named in the component |
| `calibration` | an interval misses the true rate too often | the interval named |
| `scale` | `the fastest of three runs took <n> ms, budget <m> ms` | the operation named, or a loaded machine |

Exit status: the level reached, 20 at the top.

## Worked example

The ladder takes minutes, so the help test runs only a fast check that the component exists (the scratch
folder has no journal, hence the exit 64):

```sh
driftbench validate judges --hardness # exit 64
```

```text
validators/judges/journal.jsonl: the journal holds no iteration 0 row: run and record iteration 0 first.
```

The ladder on seed 1, at the repository root (288 seconds while the machine was heavily loaded). Shown as text, not run by the help test: a whole ladder runs for minutes, and the level it reaches changes as the product is fixed.

```bash
pnpm -s driftbench validate judges
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
20     the same operations at 10 and 100 times the input             items of scale passing / 26 items        >= 1       0.846154 FAIL (4)
Level per seed: 1 = 19
Level of the run: 19 of 20, the minimum over 1 seed.
Floor: 20. BELOW THE FLOOR.
Items of the first failing level:
  Seed 1, level 20 scale (the same operations at 10 and 100 times the input), 4 items:
    family scale (4):
      scale/prompt-100000-entries  [tier 3]  [packages/judges/src/prompt.ts]  the fastest of three runs took 9485 ms, budget 6000 ms. Fix: Keep the operation linear in its input.
      scale/parse-many-braces-10000000  [tier 5]  [packages/judges/src/contract.ts]  the fastest of three runs took 12079 ms, budget 12000 ms. Fix: In parseAnswerText: scan the objects once, skipping brace pairs with no key, so many brace pairs stay linear.
      scale/escape-10000000-characters-of-tags  [tier 4]  [packages/judges/src/prompt.ts]  the fastest of three runs took 22755 ms, budget 12000 ms. Fix: Keep the operation linear in its input.
      scale/render-one-megabyte-entry  [tier 2]  [packages/judges/src/prompt.ts]  the fastest of three runs took 1022 ms, budget 1000 ms. Fix: Keep the operation linear in its input.
```

It exited 19. All 19 deterministic levels pass; the four failing items are timed `scale` items, and a
second run on the same busy machine failed three, not all the same ones. That is the signature of load,
not of a regression: re-run the ladder on a quiet machine before acting on a `scale` item.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `scale` items fail on one run and pass on another | the items are timed; a loaded machine slows them | run on a quiet machine, with `DRIFTBENCH_JUDGES_SHARDS` unset |
| an item fails with a timed-out detail | the item ran past the 120 second child limit, often an endless loop | look at the component named; a new child resumed at the next item |
| a `live` level appears, or a run costs money | `DRIFTBENCH_BILLED_APPROVAL` is set in the environment | unset it; the live level needs an approved card |
| `Floor: 20. BELOW THE FLOOR.` on a run that reached 19 | a `scale` item timed out on a loaded machine, or a change broke a level | re-run on a quiet machine, then read the first failing item; never lower the floor |
| an item you believe is wrong | the oracle disagrees with your reading | do not edit the bank; see `validate-mutants-and-rulings` |
