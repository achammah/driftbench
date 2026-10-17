---
title: Mutants and item rulings
summary: Prove a validator catches a bug by planting a mutant, and dispute an item under the "valid as written" rule.
commands:
  - validate
see_also:
  - validate-overview
  - validate-reading-items
  - validate-protect
  - validate-executor-loop
  - validate-stats
next:
  - validate-map
---

## What it is

Two jobs keep a validator honest.

**Planting a mutant.** A mutant is a copy of the product with one known bug planted in it. A validator
that is worth anything loses at least one item on every such bug. Planting mutants tests the validator,
not the product: it shows the items can fail. The independent audit of a validator
(`docs/validators.md` section 12.7) plants 20 bugs, one at a time, and the `planted bugs` check passes only
when each loses at least one item; a bug no item catches becomes a new item.

**Ruling on an item.** An item can be wrong: its oracle can ask for something the documentation does not
promise, or for the opposite of what it promises. The default ruling is **valid as written**: an item
stays as it is, and the product changes to pass it, unless someone shows the item is wrong. The executor
who climbs a ladder never edits it: the validator files are protected from `exec/` branches
(`validate-protect`), and an item believed wrong is reported to the maintainer with the oracle's own answer
and a counter-example (`docs/validators.md` section 12.3).

A change to an item, by the maintainer, meets one bar: the changed item fails on a planted product mutant
(a copy of the product with the bug the item exists to catch) and passes on a correct reference. A change
that makes the item pass a broken product is a weakening and is refused. No item is weakened to make a
ladder easier.

An item can also be quarantined rather than changed: when no documentation page, design section or
command needs the capability it tests, it stays as code but counts toward no score, forecast or cause.
Each validator lists its quarantined items, with the reason, in `validators/<component>/NEEDS.md`.

## When to use it

* Planting a mutant: when you build or audit a validator; when you doubt that a level can fail at all;
  before you trust a green ladder on new code.
* Ruling: when a failing item seems to ask for the wrong behaviour after you have read its oracle, the
  documentation it cites, and the component it points at.

## Commands and every option

Mutants and rulings use the ordinary run of `driftbench validate` (`validate-overview`) on a changed
product, with `--items` or `--all-levels` (`validate-reading-items`) to see which items moved:

```
driftbench validate <component> [--seed <n>] [--items] [--all-levels] [--json]
```

One environment variable plants a mutant without touching the checkout:

| Variable | Ladder | Effect |
|---|---|---|
| `DRIFTBENCH_STATS_IMPL` | `stats` | an absolute path to a module that replaces `@agent-nexus/driftbench-stats` in the bank's child processes, such as a copy of `packages/stats/src` with one bug |

In code, tests plant faults through the ladder factories' options: `statsLadder({ impl })` replaces
statistics functions, `estateLadder({ families })` replaces a level's families, `systemLadder({ bank })`
replaces the system bank, and `mapLadder(deps)` takes the map bank's dependencies. `statsLadder` is
exported by `@agent-nexus/driftbench-validators`; the others are imported from
`packages/validators/src/ladders/<component>/index.ts` by the validators' own tests. None of them is a
command option.

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

* A product file to break, taken from an item's component (the path in brackets on an item line).
* For a ruling: the item id, the oracle's answer from its detail, the documentation sentence the item or
  you rely on, and a counter-example.

## Outputs and how to read them

### Planting a mutant, step by step

1. Work on a copy you own: a separate git worktree or a scratch copy of the package. Never plant in a
   checkout another person or lane is using, and never commit a mutant.
2. Run the ladder once on the clean product and keep the output (`--items --json > before.json`).
3. Change one thing in one product file: flip a comparison, change a default, drop a branch.
4. Run the same ladder on the same seed (`--items --json > after.json`).
5. Read the result. The mutant is killed when at least one item that passed before now fails. The run's
   level usually drops to the level below the first failing one. A mutant no item kills is a gap in the
   bank: report it as a new item.
6. Restore the file, or delete the copy.

For the statistics ladder, step 1 to 4 need no change to the checkout: copy `packages/stats/src`, plant
the bug in the copy, and point `DRIFTBENCH_STATS_IMPL` at the copy's `index.ts`.

### Disputing an item

Report it to the maintainer with: the item id; the seed; the oracle's expected value as the detail prints
it; the documentation sentence that says otherwise, with its file; and a counter-example (an input where
the oracle's answer contradicts the documentation). The maintainer then rules:

| Ruling | Meaning |
|---|---|
| valid as written (the default) | the item stands; the product must change |
| fix the item | the item is wrong; the maintainer changes it on a branch that is not an executor branch, the changed item kills a planted mutant and passes a correct reference, and a reviewer who did not write the change checks it |
| quarantine | no product need; the item moves to `NEEDS.md` and stops counting |

## Worked example

The help test runs this fast command, which prints the floors a mutant run is compared against (none in
the test's scratch folder):

```sh
driftbench validate floors
```

```text
Floors (validators/floors.json): none.
```

A real mutant of the statistics package, at the repository root (62 seconds). Shown as text, not run by the help test: a whole ladder runs for minutes, and the level it reaches changes as the product is fixed. The
mutant also sets an environment variable, which a worked example line cannot.
The planted bug changes the default power of `mde` from 0.8 to 0.9:

```bash
mkdir -p /tmp/mutant-stats && cp -R packages/stats/src /tmp/mutant-stats/src
sed -i '' 's/const power = input.power ?? 0.8;/const power = input.power ?? 0.9;/' /tmp/mutant-stats/src/power.ts
DRIFTBENCH_STATS_IMPL=/tmp/mutant-stats/src/index.ts pnpm -s driftbench validate stats
echo $?
rm -rf /tmp/mutant-stats
```

(`sed -i ''` is the macOS form; on Linux write `sed -i`.) Output:

```text
Validator stats (ladder version 2)
Level  Name                 Metric                                                                                      Threshold  seed 1
1      reference values     fixture groups matching scipy and numpy / groups                                            >= 1       1 pass
2      degenerate inputs    empty, NaN, infinite, out-of-domain, single and all-equal cases handled / cases             >= 1       1 pass
3      reproducibility      same seed same bits, other seed other draw, order invariance / items                        >= 1       1 pass
4      analytic truth       estimators and tests matching a constructed truth, enumeration or textbook formula / items  >= 1       0.979675 FAIL (5)
5      simulation coverage  planted designs whose coverage, recovery, error or power holds / designs                    >= 1       not run
6      scale and stability  one-million-row calls under budget and shift-stable results / items                         >= 1       not run
7      roadmap methods      methods the dossiers name, matching scipy, degenerate-safe, scaling / items                 >= 1       not run
Level per seed: 1 = 3
Level of the run: 3 of 7, the minimum over 1 seed.
Floor: 7. BELOW THE FLOOR.
Items of the first failing level:
  Seed 1, level 4 analytic (analytic truth), 5 items:
    family edge-accuracy (5):
      edge.mde.baseline-all-pass  [tier 4]  [packages/stats/src/power.ts]  [edge-accuracy, tier 4, cause: mde differs from scipy or exact arithmetic on an edge input] mde({"n":50,"baselineRate":1}) on the edge "a baseline where every run passes": effect 0.18317053796487537, want 0.14239668879962775 (tolerance 1.4239668879962776e-10). The expected value comes from make_edges.py (scipy, exact rationals or 60-digit decimals); the need: docs/concepts/statistics.md mde; campaign plan prints the minimum detectable effect.
      edge.mde.baseline-near-zero  [tier 4]  [packages/stats/src/power.ts]  [edge-accuracy, tier 4, cause: mde differs from scipy or exact arithmetic on an edge input] mde({"n":200000,"baselineRate":0.001}) on the edge "a baseline that almost never passes, huge n": effect 0.00029882730425788396, want 0.00026111628069419053 (tolerance 2.6111628069419054e-13). The expected value comes from make_edges.py (scipy, exact rationals or 60-digit decimals); the need: docs/concepts/statistics.md mde; campaign plan prints the minimum detectable effect.
      edge.mde.rho-1  [tier 4]  [packages/stats/src/power.ts]  [edge-accuracy, tier 4, cause: mde differs from scipy or exact arithmetic on an edge input] mde({"n":40,"repeats":6,"baselineRate":0.85,"rho":1}) on the edge "repeats that always agree": effect 0.3278044116277253, want 0.2801072883021328 (tolerance 2.801072883021328e-10). The expected value comes from make_edges.py (scipy, exact rationals or 60-digit decimals); the need: docs/concepts/statistics.md mde; campaign plan prints the minimum detectable effect.
      edge.mde.huge-n  [tier 4]  [packages/stats/src/power.ts]  [edge-accuracy, tier 4, cause: mde differs from scipy or exact arithmetic on an edge input] mde({"n":10000000,"repeats":3,"baselineRate":0.9,"rho":0.2}) on the edge "huge n": effect 0.0002972859599168932, want 0.0002569160501683552 (tolerance 2.569160501683552e-13). The expected value comes from make_edges.py (scipy, exact rationals or 60-digit decimals); the need: docs/concepts/statistics.md mde; campaign plan prints the minimum detectable effect.
      edge.rule.mde-defaults  [tier 3]  [packages/stats/src/power.ts]  [edge-accuracy, tier 3, cause: mde's default power or alpha differs from the documented 0.8 and 0.05] mde({"n":100,"repeats":2,"baselineRate":0.8,"rho":0.1}) gave 0.15102665101619592 and mde with power 0.8 and alpha 0.05 written out gave 0.1291953608935803; docs/concepts/statistics.md documents power 0.8 and alpha 0.05 as the defaults. Need: campaign plan prints this effect.
3
```

The clean product reaches 7 of 7 on seed 1 (`validate-stats`). With the mutant, level 4 fails with five
items, the run stops at level 3 and exits 3: the mutant is killed. `edge.rule.mde-defaults` names the
cause directly: the default differs from the documented 0.8. The four `edge.mde.*` items catch it through
their expected values, which come from `make_edges.py` (scipy and exact arithmetic).

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| the mutant run gives the same result as the clean run | no item covers the planted bug, or the bug is in code the ladder does not reach | check that the changed file is one the items point at; if it is, the gap is a new item for the maintainer |
| every statistics item fails with a module error | `DRIFTBENCH_STATS_IMPL` points at a missing file or a partial copy | copy the whole `packages/stats/src` and point at its `index.ts` |
| a mutant shows up in `git status` | it was planted in the shared checkout | restore the file now; plant in a copy |
| `validate protect` fails on your branch | an item was edited on an executor branch | revert it and report the item instead |
| a dispute is refused | the counter-example was missing, or the change would let a broken product pass | bring the oracle's answer, the documentation sentence and a counter-example |
