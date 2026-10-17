---
title: Covering arrays, strength and seeds
summary: 'How `generate` chooses which combinations of the map to test: a t-wise covering array at strength `--t`, or `--budget` rows chosen for pair coverage and balance, trimmed by `--spec-cap`, with every choice fixed by `--seed` so a run is reproducible byte for byte.'
commands:
  - generate
  - space coverage
see_also:
  - results-select
  - authoring-generate
  - authoring-map
  - authoring-space-coverage
  - authoring-gate
next:
  - authoring-gate
---

## What it is

The axes of an approved map make a grid with far too many cells to test one by one (the Acme map has 113568 on the proposal). A covering array is a short list of rows that still holds every combination of `t` values that the constraints allow:

- At t = 2 (pairwise), every allowed pair of values on two axes appears in at least one row.
- At t = 3, every allowed triple.
- Faults that need two or three things to go together are caught with far fewer conversations than the full grid.

In `generate`, the `twise` seeder builds this array over the axes (the report names them in `twise.dimensions`) and turns each row into one conversation along an approved path of its flow. Combinations no approved path can reach are left out and reported (`twise.unreachable`). The `cover` seeder runs last and adds one scenario for each allowed pair the complete specs of the other seeders still miss.

Two options change how many rows there are:

- `--budget N` (budget mode) replaces the t-wise rows with N rows. Each pick takes the cell that adds the most uncovered allowed pairs; a tie goes to the cell that moves value counts toward their fair share (N divided by the allowed values of each dimension); a remaining tie goes to a seeded shuffle. Once every pair is covered, balance alone decides. The other seeders still run, so the suite can exceed N, and `cover` can add the pairs the budget rows miss. Approved `numeric_settings` of the map are sampled only in budget mode, into `given.vars`.
- `--spec-cap N` limits the total written specs. It keeps every graph, boundary, deviation, metamorphic, task and incomplete spec (the protected specs) and selects complete t-wise and cover specs by their actual coverage. `--spec-cap-mode tuples` (default) tries to keep every pair and triple; `pairs` keeps pairs and allows reported triple losses.

Seeds: every seeded choice (array construction, shuffles, phrase choice, task-family draws) comes from `--seed`, default 1. The same map and seed give the same files, byte for byte. Another seed gives another valid suite.

## When to use it

- Pick `--t 2` for a smaller suite that still catches every two-factor interaction; keep the default `--t 3` when the suite size allows it.
- Use `--budget` when you can afford a fixed number of conversations and want the best pair coverage and balance for it.
- Use `--spec-cap` to bound the total suite, then compare fault scores before and after with `gate`.
- Change `--seed` to get a different but equally covering suite; keep it fixed to reproduce a suite exactly.
- Check what any suite covers on the map with `space coverage --t 2` or `--t 3`.

## Commands and every option

### driftbench generate (the options that shape the array)

| Option | Meaning | Default |
|---|---|---|
| `--t <n>` | Strength of the covering array, whole number from 1. | 3 |
| `--seed <n>` | Seed of every seeded choice, whole number from 0. | 1 |
| `--budget <n>` | Budget mode: n rows in place of the t-wise rows. Covers pairs whatever `--t` is. | off |
| `--spec-cap <n>` | Total written specs. Refused below the protected count. | no cap |
| `--spec-cap-mode <mode>` | `tuples` or `pairs`. Needs `--spec-cap`. | `tuples` |
| `--max <n>` | The most specs per seeder. A seeder cut by it makes the exit 1. With `--budget`, it still applies to the other seeders. | no cap |

Every other option of `generate` is in authoring-generate. Exit codes: 0 when every block is complete; 1 when the suite is written with incomplete specs, a seeder cut by `--max`, or a spec cap that lost target tuples; 2 on bad input. Partial pair coverage in budget mode does not by itself change the exit code.

### driftbench space coverage (to measure)

`driftbench space coverage <paths...> --map <space map> --t <n>` counts covered cells on every subset of n dimensions and always prints the t = 2 and t = 3 lines (see authoring-space-coverage).

## Inputs

- An approved map with `role: axis` dimensions and their constraints. The more values on the axes, the more rows a covering array needs.
- Optional approved `numeric_settings` in the map (`id`, `min`, `max`, `integer`, `unit`): sampled with sliced Latin hypercube sampling in budget mode only; `generate` without `--budget` refuses a map that has them approved.

## Outputs and how to read them

In the printed summary:

- `Actual axis-map coverage (written complete specs): pairs <a> of <b>; triples <c> of <d>.` What the suite you got covers. This is the number to read first.
- `Candidate t-wise array (before the total cap): covering array of <rows> rows over <k> dimensions, <x> of <y> allowed t-tuples (<share>); <n> pairs no path reaches are left out.` The array itself, before any cap.
- `Candidate budget array (before the total cap), budget <n>: <n> cells of <pool> allowed, pairs covered <x> of <y> (<share>), max deviation from fair share <d>.` In budget mode instead.
- `Spec cap <n>: <w> of <c> candidate specs written; <p> structural, fault and incomplete specs protected.` and `Coverage lost: see spec_cap.coverage[].lost.` when the cap cost tuples.
- `Seed <s>, t = <t>.`

In `generate-report.json`:

| Key | Holds |
|---|---|
| `twise` | `t`, `dimensions`, `rows`, `allowed`, `covered`, `share`, `unreachable` |
| `coverage.actual` | per strength, every allowed tuple the written complete specs miss (`uncovered`) |
| `budget` | `budget`, `seed`, `dimensions`, `pool` (allowed cells), `picked`, `capped` (stopped at the pool size), `pairs` (`allowed`, `covered`, `share`), `values` (count, fair share and deviation per value), `maxDeviation`, and `numeric` with approved ranges |
| `spec_cap` | `mode`, `limit`, `candidates`, `written`, `protected`, `preserving` (the greedy selection size), `preserved`, `trimmed` per seeder, `coverage` per strength with `uncovered` and the tuples lost |

## Worked example

Strength 3 (the default) against strength 2 on the approved Acme map. The t = 3 array has 425 rows; the t = 2 array 156 (see authoring-generate for the t = 2 run):

```sh
driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/t3 # exit 1
```

```text
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/t3
Actual axis-map coverage (written complete specs): pairs 708 of 708 (100.0%); triples 4057 of 4064 (99.8%).
Candidate t-wise array (before the total cap): covering array of 425 rows over 5 dimensions, 1258 of 1258 allowed 3-tuples (100.0%); 2 pairs no path reaches are left out.
Uncovered on the axis map: 0 pairs, 7 triples (see coverage.actual[].uncovered).
Map acme (../../../examples/acme/map/approved.yaml), hash 7c05b9cee9cc: 51 dimensions, 187 values, 463 constraints, 55 approved phrases.
Seed 1, t = 3.

Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           425    2120       417           8
boundary         85     183        13          72
deviation        58     341        58           0
metamorphic      42     192        42           0
task             67      71        67           0
cover           444    2478       444           0
(34 more lines)
Wrote 1230 files to out/authoring-covering-arrays/t3.
(exit 1)
```

Budget mode with 20 rows. The rows cover 155 of 356 pairs on their own; `cover` adds 151 specs so the suite still covers all 708 pairs:

```sh
driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/budget-20 --t 2 --budget 20 # exit 1
```

```text
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/budget-20 --t 2 --budget 20
Actual axis-map coverage (written complete specs): pairs 708 of 708 (100.0%); triples 2855 of 4064 (70.3%).
Candidate budget array (before the total cap), budget 20: 20 cells of 901 allowed, pairs covered 155 of 356 (43.5%), max deviation from fair share 2.00.
Uncovered on the axis map: 0 pairs, 1209 triples (see coverage.actual[].uncovered).
Map acme (../../../examples/acme/map/approved.yaml), hash 7c05b9cee9cc: 51 dimensions, 187 values, 463 constraints, 55 approved phrases.
Seed 1, t = 2.

Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise            20     106        20           0
boundary         85     183        13          72
deviation        21     111        21           0
metamorphic      42     192        42           0
task             67      71        67           0
cover           151     773       151           0

Stage graph: 18 of 23 edges covered in 12 paths from needs.
Constraints applied: 463.
Deviation probes: 12 of 12 classes. Metamorphic families: 21.
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%).
(29 more lines)
Wrote 495 files to out/authoring-covering-arrays/budget-20.
(exit 1)
```

A total cap of 450 specs. 348 are protected, so only t-wise and cover specs are trimmed, and 10 pairs are lost:

```sh
driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/cap-450 --t 2 --spec-cap 450 # exit 1
```

```text
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/cap-450 --t 2 --spec-cap 450
Actual axis-map coverage (written complete specs): pairs 698 of 708 (98.6%); triples 2951 of 4064 (72.6%).
Candidate t-wise array (before the total cap): covering array of 156 rows over 5 dimensions, 356 of 356 allowed 2-tuples (100.0%); 2 pairs no path reaches are left out.
Uncovered on the axis map: 10 pairs, 1113 triples (see coverage.actual[].uncovered).
Map acme (../../../examples/acme/map/approved.yaml), hash 7a022d4e1380: 51 dimensions, 187 values, 463 constraints, 55 approved phrases.
Seed 1, t = 2.

Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           101     509        98           3
boundary         85     183        13          72
deviation       139     570       139           0
metamorphic      42     192        42           0
task             67      71        67           0
cover             4      23         4           0

Stage graph: 18 of 23 edges covered in 12 paths from needs.
Constraints applied: 463.
Deviation probes: 12 of 12 classes. Metamorphic families: 21.
Coverage on the axis map at t = 2: complete specs 698 of 708 (98.6%), all specs 698 (98.6%).
Spec cap 450: 450 of 512 candidate specs written; 348 structural, fault and incomplete specs protected. Coverage lost: see spec_cap.coverage[].lost.
Allowed tuples no spec could be built for: 10 (see cover.unbuilt).
(32 more lines)
Wrote 547 files to out/authoring-covering-arrays/cap-450.
(exit 1)
```

The seed makes a run reproducible. Two runs with seed 1 into two folders, then one with seed 2:

```sh
driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/seed1-a --t 2 # exit 1
driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/seed1-b --t 2 # exit 1
driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/seed2 --t 2 --seed 2 # exit 1
diff -r out/authoring-covering-arrays/seed1-a out/authoring-covering-arrays/seed1-b
diff -rq out/authoring-covering-arrays/seed1-a out/authoring-covering-arrays/seed2 | head -3
```

```text
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/seed1-a --t 2
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/seed1-b --t 2
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/seed2 --t 2 --seed 2
$ diff -r out/authoring-covering-arrays/seed1-a out/authoring-covering-arrays/seed1-b
(exit 0)
$ diff -rq out/authoring-covering-arrays/seed1-a out/authoring-covering-arrays/seed2 | head -3
Files out/authoring-covering-arrays/seed1-a/generate-report.json and out/authoring-covering-arrays/seed2/generate-report.json differ
Files out/authoring-covering-arrays/seed1-a/incomplete/boundary/gen-boundary-001.yaml and out/authoring-covering-arrays/seed2/incomplete/boundary/gen-boundary-001.yaml differ
Files out/authoring-covering-arrays/seed1-a/incomplete/boundary/gen-boundary-002.yaml and out/authoring-covering-arrays/seed2/incomplete/boundary/gen-boundary-002.yaml differ
```

Each `generate` run exits 1 as above (the same incomplete specs); their output is the one shown in authoring-generate. The two seed-1 folders are identical; the seed-2 folder differs.

## Common errors

```
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/cap-10 --t 2 --spec-cap 10
Cannot generate: --spec-cap 10 is below the 348 protected structural, fault and incomplete specs; none can be trimmed
(exit 2)
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-covering-arrays/seed2 --t 2 --seed 2
out/authoring-covering-arrays/seed2/generate-report.json already exists: an earlier run wrote this folder. Pass --force to replace its output.
(exit 2)
```

| Symptom | Cause | Fix |
|---|---|---|
| `--t must be a whole number of at least 1` | `--t 0` or a decimal | a whole number from 1 |
| `--spec-cap-mode requires --spec-cap and must be tuples or pairs.` | the mode without a cap, or another word | add `--spec-cap`, use `tuples` or `pairs` |
| the cap is refused | it is under the protected count printed | raise it, or use `--budget` to shrink the t-wise rows |
| `pairs <a> of <b>` below 100% after a cap | the cap trimmed specs that held pairs | raise the cap; the lost tuples are in `spec_cap.coverage` |
| a budget suite much larger than N | `cover` and the other seeders still run | expected; cap the total with `--spec-cap` |
| two runs differ | another `--seed`, or the map changed (its hash is printed) | keep the seed and the map fixed |
