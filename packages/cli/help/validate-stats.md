---
title: The statistics validator
summary: What `driftbench validate stats` measures, its 7 levels and 651 items, reference fixtures and budgets, and how to read a failing statistics item.
commands:
  - validate
see_also:
  - validate-overview
  - validate-reading-items
  - validate-system
  - validate-mutants-and-rulings
next:
  - validate-self-checks
---

## What it is

The statistics validator checks `@agent-nexus/driftbench-stats`, the package behind every interval, test,
power calculation and coverage estimate driftbench prints: do the numbers mean what they say? It has two
halves. Reference values from scipy and numpy for every function, matched to 1e-6. And simulation: for
each estimator, draws from a population whose truth is known, counting how often the interval holds the
truth, whether planted variance shares are recovered, whether unseen-mass estimates match the true
covered probability, and whether a predicted power matches the simulated one.

The ladder (version 2), from `driftbench validate stats`:

| Level | Id | Name | Items | Families |
|---|---|---|---|---|
| 1 | `reference` | reference values | 31 | reference |
| 2 | `degenerate` | degenerate inputs | 201 | degenerate-domain, degenerate-empty, degenerate-nonfinite, degenerate-single-equal |
| 3 | `reproducibility` | reproducibility | 22 | reproducibility |
| 4 | `analytic` | analytic truth | 246 | agreement-analytic, allocation-bruteforce, binomial-exact, drift-analytic, edge-accuracy, estimators-distributions, product, tests-calibration, unseen-known, variance-simulation |
| 5 | `simulation` | simulation coverage | 35 | coverage-simulation, product |
| 6 | `scale` | scale and stability | 46 | numerical-stability, scale |
| 7 | `roadmap` | roadmap methods | 70 | missing-method, product |

651 items in all (counted from `--items --json` on seed 1). What each level asks:

* `reference`: fixture groups match scipy and numpy.
* `degenerate`: empty, NaN, infinite, out-of-domain, single and all-equal inputs are handled; a bad input
  raises a `RangeError` whose message starts with the function and the argument to fix.
* `reproducibility`: the same seed gives the same bits, another seed another draw, and the result does
  not depend on input order.
* `analytic`: estimators and tests match a constructed truth, an exhaustive enumeration or a textbook
  formula. The `product` items here check numbers that driftbench commands print, such as the minimum
  detectable effect `campaign plan` shows.
* `simulation`: planted designs whose coverage, recovery, error or power holds.
* `scale`: one-million-row calls under a budget of 5000 ms of processor time, and results that a shift or
  a scale of the data leaves unchanged to 1e-6.
* `roadmap`: methods the research dossiers name that a product page needs, matching scipy, degenerate-safe
  and scaling.

The floor is 7 for ladder version 2, the top of the ladder.

## When to use it

* After any change to `packages/stats`.
* After a change to code that prints a statistic: the report, `compare`, `ci`, `campaign plan`, the pilot.
* When you add an estimator: a method a product page names becomes an item first.

## Commands and every option

```
driftbench validate stats [--seed <n>] [--seeds <a..b>] [--hidden] [--json] [--items] [--all-levels] [--blind] [--check-floor]
driftbench validate stats --brief [--fresh] | --journal <row.json> | --check-handover | --hardness [--json]
```

Every option is the general one (`validate-overview`, `validate-reading-items`, `validate-floors`,
`validate-executor-loop`). One environment variable is the statistics ladder's own:

| Variable | Default | Effect |
|---|---|---|
| `DRIFTBENCH_STATS_IMPL` | unset | an absolute module path (or `file://` URL) whose exports replace `@agent-nexus/driftbench-stats` in the bank's child processes. It exists to plant a mutant: point it at a copy of the package with one bug and the bank must lose at least one item (`validate-mutants-and-rulings`) |

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

* The seed. It draws every simulated population and every random input.
* The reference fixtures under `packages/stats/test/reference` (scipy and numpy values; protected), and
  the bank fixtures under `packages/validators/fixtures/stats`: `designs.json` (the planted designs),
  `edges.json` and `roadmap.json` (cases written by `make_edges.py` and `make_roadmap.py`), and
  `needs.json` (which roadmap methods count, see Quarantine).
* Isolation: the bank runs in child processes. An item past its wall-time limit (120 seconds unless the
  item sets its own) fails as timed out and a new child resumes at the next item. The limit stops an
  endless loop; speed is judged by the scale items, on processor time, so a loaded machine moves them
  less than wall time would.
* Quarantine: a roadmap method no docs page, design section or command needs stays in `roadmap.json`, but
  `needs.json` keeps its items out of the bank, so it counts toward no score or cause
  (`validators/stats/NEEDS.md`).

## Outputs and how to read them

The general table (`validate-overview`). A statistics item names the function or the file it points at;
its detail gives the seed, the truth, the estimate (and its interval where there is one), or the input
and the expected error. Typical readings:

| Level or family | Detail says | Look at |
|---|---|---|
| `reference` | a value differs from scipy or numpy | the function named |
| `degenerate-*` | no `RangeError`, or a message that does not name the argument | the input validation of the function named |
| `reproducibility` | two runs of one seed differ | a hidden source of randomness or an order dependence |
| `analytic`, `edge-accuracy` | an estimate differs from the constructed truth | the formula named, at the edge the id names |
| `simulation` | coverage below its bar over the draws | the interval or estimator named, at the design the id names |
| `scale` | over 5000 ms of processor time at one million rows, or a result that moved under a shift | the algorithm's complexity, or a numerically unstable sum |
| `missing-method` | `<name> is missing from @agent-nexus/driftbench-stats` | the method a page names but the package lacks |

Exit status: the level reached, 7 at the top.

## Worked example

The ladder takes minutes, so the help test runs only a fast check that the component exists (the scratch
folder has no journal, hence the exit 64):

```sh
driftbench validate stats --hardness # exit 64
```

```text
validators/stats/journal.jsonl: the journal holds no iteration 0 row: run and record iteration 0 first.
```

The ladder on seed 1, at the repository root (143 seconds on a busy machine). Shown as text, not run by the help test: a whole ladder runs for minutes, and the level it reaches changes as the product is fixed.

```bash
pnpm -s driftbench validate stats
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
```

It exited 7: every item passes on seed 1. The hardness measurement of this bank is in
`validate-executor-loop`.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| an item fails as timed out | an endless loop, or an item past 120 seconds of wall time on a loaded machine | look at the function named; re-run on a quiet machine |
| a `scale` item fails | the call took over 5000 ms of processor time at one million rows | an algorithm worse than n log n in the function named |
| every item fails with a module error | `DRIFTBENCH_STATS_IMPL` points at a file that does not exist or does not export the package's functions | unset it, or point it at a full copy of the package |
| `Floor: 7. BELOW THE FLOOR.` | a change broke a statistic | read the first failing level; never lower the floor |
| an item you believe is wrong | the oracle disagrees with your reading of the reference | do not edit the bank or the reference fixtures; see `validate-mutants-and-rulings` |
