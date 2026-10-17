---
title: The estate validator
summary: What `driftbench validate estate` measures on generated agent estates, its 7 levels and 1169 items, and how to read a failing estate item.
commands:
  - validate
see_also:
  - validate-overview
  - validate-reading-items
  - validate-generator
  - validate-mutants-and-rulings
next:
  - validate-stats
---

## What it is

The estate validator checks the estate loop: does `driftbench estate` (scan, lint, plan, generate,
maintain) close on an agent estate nobody wrote by hand? A seeded generator writes a fictional estate
(standing instructions, skills with references and scripts, helpers, guards, a step list, and planted
defects such as an orphan, a missing reference, an unanchored guard or a registry mismatch) from a hidden
specification. A rule follower generated from the same specification produces transcripts that obey every
atom. The scanner, lint, plan, generator and replay run on them, and every result is compared with the
hidden specification.

Two kinds of mutant close the loop with no human in it. Deleting an atom from the agent (not the estate)
must make that atom's generated tests fail. Deleting it from the estate (not the agent) must make
maintenance retire exactly those tests and nothing else.

The ladder (version 1), from `driftbench validate estate`:

| Level | Id | Name | Items | What the items check |
|---|---|---|---|---|
| 1 | `reader` | reader and graph | 641 | planted forms of every reader gap (symlinks, registry tables, process maps, catalogues, dispatcher commands, compact frontmatter, long references). Also gates, hazards and paths with decoys, pairs of forms, the generated estates |
| 2 | `lint` | lint | 46 | planted defects found exactly; clean estates give no finding |
| 3 | `plan` | plan | 65 | the plan contract, pairwise and three-way coverage against brute force, relevance |
| 4 | `generation` | generation | 270 | every class of test complete, valid, distinct and green on the rule follower |
| 5 | `agent-mutants` | agent mutants | 74 | every atom deleted from the rule follower fails one of its generated tests |
| 6 | `maintenance` | maintenance | 53 | every estate mutant gets the retirements, regenerations and re-approvals it should |
| 7 | `scale` | scale | 20 | every stage at 250 to 5000 atoms within its time budget, its result right |

1169 items in all. Family names start with what they test: `scan.*` (the reader), `blind.*` (items written
by a breaker who had not read the code), `bench.defects`, `lint.*`, `plan.*`, `gen.*`, `kill.fake`,
`mutant.agent`, `maintain.*`, `unit.runner`, `estate.determinism`, `estate.stats` and `scale`.

The estate has no floor yet.

## When to use it

* After a change to `packages/estate` (the Claude Code reader, lint, the plan, maintenance) or to
  `packages/generate/src/estate` (spec generation from a plan).
* After a change to `driftbench estate` commands or to replay.
* When an estate scan on a real estate misses a form of instruction: the reader families are where a new
  form becomes an item.

## Commands and every option

```
driftbench validate estate [--seed <n>] [--seeds <a..b>] [--hidden] [--json] [--items] [--all-levels] [--blind] [--check-floor]
driftbench validate estate --brief [--fresh] | --journal <row.json> | --check-handover | --hardness [--json]
```

Every option is the general one (`validate-overview`, `validate-reading-items`, `validate-floors`,
`validate-executor-loop`). One environment variable concerns the estate run:

| Variable | Default | Effect |
|---|---|---|
| `DRIFTBENCH_OTHER_NODE` | `/usr/local/bin/node` | the second Node.js binary the `estate.determinism` family runs the commands with, to prove the output is byte for byte the same across Node versions |

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

* The seed. It draws the hidden estate, its rendering and its defects. Committed specifications sit in
  `packages/validators/fixtures/estate` (`seed-1.yaml`, `holdout-1.yaml`).
* The Northwind fixture estate under `examples/estates/fixture` (fictional). Families built on it do not
  depend on the seed and are judged once per run, then reported on every seed.
* The estate and generate packages, through the CLI's own entry points. No model is called.
* Time: each `scale` item runs one stage (scan, lint, plan, generate, impact) on estates of 250, 1000, 2500
  and 5000 atoms in a child process killed at its budget. The budget is a few milliseconds per atom (scan
  3, lint 1, plan 6, generate 6, impact 1) with a floor of 4000 ms. These are wall-clock times: run the
  family on a quiet machine. Other items carry their own budgets, such as 5000 ms for the hostile reader
  inputs.

## Outputs and how to read them

The general table (`validate-overview`). Estate item details start with the family and tier in brackets,
then say what the code read and what it should have read. Typical readings:

| Family | Detail says | Look at |
|---|---|---|
| `scan.gates`, `scan.hazards`, `scan.paths`, `scan.steps`, `scan.standing` | `missed gate at <file>:<line>`, `found ... never planted` | the reader in `packages/estate/src/scan`: a phrasing it does not parse, or a decoy it took for real |
| `lint.*`, `bench.defects` | a planted defect not reported, or a finding on a clean estate | `packages/estate/src/lint` |
| `plan.*` | a pair or a kind with no row | `packages/estate/src/plan` |
| `gen.*` | a spec incomplete, invalid, duplicated or red on the follower | `packages/generate/src/estate` |
| `mutant.agent`, `kill.fake` | a deleted atom killed no test | the evidence predicate of that atom's tests |
| `maintain.*` | a wrong retirement or a missed one | `packages/estate/src/maintain/impact.ts` |
| `scale` | over budget, or a wrong result at size | the stage named |

Exit status: the level reached, 0 when level 1 fails.

## Worked example

The ladder runs for many minutes per seed, so the help test runs only a fast check that the component
exists (the scratch folder has no journal, hence the exit 64):

```sh
driftbench validate estate --hardness # exit 64
```

```text
validators/estate/journal.jsonl: the journal holds no iteration 0 row: run and record iteration 0 first.
```

The ladder on seed 1, at the repository root (1327 seconds on a busy machine). Shown as text, not run by the help test. A whole ladder runs for minutes, and the level it reaches changes as the product is fixed.
It failed level 1 with 72 items and exited 0. The table and one family of the failing items, cut from
107 lines:

```bash
pnpm -s driftbench validate estate
```

```text
Validator estate
Level  Name              Metric                       Threshold  seed 1
1      reader and graph  items passing / items (641)  >= 1       0.887676 FAIL (72)
2      lint              items passing / items (46)   >= 1       not run
3      plan              items passing / items (65)   >= 1       not run
4      generation        items passing / items (270)  >= 1       not run
5      agent mutants     items passing / items (74)   >= 1       not run
6      maintenance       items passing / items (53)   >= 1       not run
7      scale             items passing / items (20)   >= 1       not run
Level per seed: 1 = 0
Level of the run: 0 of 7, the minimum over 1 seed.
Floor: 0. At or above the floor.
Items of the first failing level:
  Seed 1, level 1 reader (reader and graph), 72 items:
...
    family scan.gates (10):
      scan.gates.act-update  [tier 3]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 3] code reads an act of updating, which is an edit: the pair is Read before updating a ticket, expected Read before Edit
      scan.gates.act-rename  [tier 3]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 3] code reads an act of renaming, which is a shell move: the pair is Read before renaming a ledger file, expected Read before Bash
      scan.gates.markdown-link  [tier 3]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 3] code reads a first file named by a markdown link: the path is undefined
      scan.gates.two-on-one-line  [tier 4]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 4] code reads two gates on one line: missed gate at .claude/skills/crate-audit-18ua4sm/SKILL.md:9
      scan.gates.decoy-example  [tier 4]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 4] code reads a decoy: the form quoted as an example: found gate gate.badge-plan-kfv8rz.read-the-before-editing at .claude/skills/badge-plan-kfv8rz/SKILL.md:9, never planted
      scan.gates.then-form  [tier 3]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 3] code reads read Y first, then X: missed gate at .claude/skills/label-price-13atzkc/SKILL.md:9
      scan.gates.without-form  [tier 3]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 3] code reads never X without reading Y: missed gate at .claude/skills/shelf-check-w8j8t1/SKILL.md:9
      scan.gates.only-after-form  [tier 3]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 3] code reads X only after reading Y: missed gate at .claude/skills/parcel-sort-1yxt01q/SKILL.md:9
      scan.gates.question-form  [tier 4]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 4] code reads the act as a question: X? read Y first: missed gate at .claude/skills/parcel-audit-1xamgvx/SKILL.md:9
      scan.gates.prior-to-form  [tier 3]  [packages/estate/src/scan/code.ts]  [scan.gates, tier 3] code reads prior to X, read Y: missed gate at .claude/skills/shelf-plan-tyeeiv/SKILL.md:9
```

Each of these items plants one phrasing of a "read Y before X" gate in a generated skill file and finds
that the reader missed it, or plants a decoy and finds that the reader took it for a gate. All point at
`packages/estate/src/scan/code.ts`. They are distinct causes: one phrasing fixed does not fix the next.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| the run exits 0 | level 1 failed: 0 is the level reached, not success | read the items of level 1 |
| `scale` or `bench.defects` items fail with `took <n> ms, over <m> ms` | wall-clock budgets on a loaded machine | re-run on a quiet machine |
| `estate.determinism` items about another Node version fail | `DRIFTBENCH_OTHER_NODE` points at a missing binary or the same Node | point it at a second installed Node.js of version 22 or later |
| leftover temporary folders after an interrupted run | the generated estates live in temporary folders | remove only folders your own interrupted run created |
| an item you believe is wrong | the oracle disagrees with your reading | do not edit the bank; see `validate-mutants-and-rulings` |
