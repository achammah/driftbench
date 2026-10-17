---
title: The system validator
summary: What `driftbench validate system` measures across the whole evaluation chain, its 11 levels and 2388 items, and how to read a failing item.
commands:
  - validate
see_also:
  - validate-overview
  - validate-reading-items
  - validate-floors
  - validate-generator
  - validate-stats
  - validate-mutants-and-rulings
next:
  - validate-estate
---

## What it is

The system validator checks the whole evaluation system end to end: does a campaign on an agent with
planted defects report exactly the truth? Code picks, per seed, faults from the fault family and the
blocks where each fires, composes one agent from them, and runs the real runner, checks, store, report and
command line on it. The scorecard and the run records must match the plant: every planted defect fails at
its block with the right check and drift class, no clean block fails, recoveries and variance equal the
planted values, two versions drift at the right cell, replay equals live, and every command exits and
prints what its documentation says.

Beside the planted-fault families, the bank holds items generated from the documentation (`claim-*`: each
asks one documented claim of a command, a concept, the spec format, the checks, the adapters or the
report), items written by breaker lanes that had not read the code (`breaker-*`, `breaker2-*`), the exit
codes of every command group (`exits-*`), robustness (`robust-*`: concurrency, resume, transfer, version),
the store under stress and its round trip, and scale.

The ladder (version 5), from `driftbench validate system`:

| Level | Id | Name | Items | Families |
|---|---|---|---|---|
| 1 | `records` | records stored, resumed and budgeted | 502 | store-roundtrip, resume-budget, combo-store-file, combo-store-memory, claim-spec, store-stress, breaker-datasets, breaker-cli, breaker-tools, breaker2-viewer, robust-concurrency, robust-resume, robust-transfer, robust-version |
| 2 | `fault-reach` | a planted fault reaches the right block and check | 154 | fault-position-mode, fault-adapter, fault-multi, fault-perturbed, claim-adapters |
| 3 | `precision` | clean, hostile and failing agents read right | 347 | clean-shapes, hostile-inputs, failure-handling, claim-checks, claim-adapters, breaker-checks |
| 4 | `drift-class` | drift class of every failing block | 74 | drift-class, claim-concepts |
| 5 | `run-fields` | every field of the run record | 84 | run-fields, claim-spec, claim-concepts |
| 6 | `recovery` | recovery record of every perturbed run | 74 | recovery, claim-concepts |
| 7 | `variance` | variance and the parity verdict against their truth | 66 | variance, claim-concepts |
| 8 | `version-drift` | drift between two versions at the right cell | 114 | version-drift, claim-report, report-brute-force |
| 9 | `replay` | replay equals live | 30 | claim-concepts, replay |
| 10 | `command-line` | command-line exit codes and output fields | 867 | claim-cli, claim-cli-flags, the breaker families, the exits families, cli-documented |
| 11 | `scale` | scale: the same answers at ten and a hundred times the size | 76 | scale |

2388 items in all. The floor is 9 for ladder version 5: CI fails when a seed stops below level 9.

## When to use it

* After a change anywhere on the path from an agent to a scorecard: the runner, the checks, the adapters
  and sandbox, the store, the report, the CLI commands and their exit codes.
* After a change to a documented claim: the `claim-*` items read what the documentation promises.
* Before a release.

## Commands and every option

```
driftbench validate system [--seed <n>] [--seeds <a..b>] [--hidden] [--json] [--items] [--all-levels] [--blind] [--check-floor]
driftbench validate system --brief [--fresh] | --journal <row.json> | --check-handover | --hardness [--json]
```

Every option is the general one (`validate-overview`, `validate-reading-items`, `validate-floors`,
`validate-executor-loop`). One environment variable concerns the system run:

| Variable | Default | Effect |
|---|---|---|
| `DRIFTBENCH_STATS_SWEEP_LOG` | unset | a JSONL file path; each statistics sub-run of the system command logs its cache key and the SHA-256 of its report there |

Some system items run the statistics validator. Inside one system command, identical statistics sub-runs
(same commit of `packages/stats` and of the statistics validator, same seed, root and mode) reuse a
measured result; the cache ends with the command, and uncommitted changes to those folders turn it off.
The log proves which results were reused; it does not change the output.

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

* The seed. It draws the planted faults, their blocks, the perturbations and the planted effects.
* The Acme example and its fault family under `examples/acme/faults/` (protected), and the fixtures under
  `packages/validators/fixtures/system` (the bank manifest, the design file and the growth timings).
* The real runner, store, report and CLI: many items start `driftbench` commands in child processes and
  temporary folders, which is why the system ladder is the slowest.
* Time: the `scale` items run each subject at one, ten and a hundred times a base size; the answer must be
  the planted one at every size, the processor time from ten to a hundred times may grow at most 25 times,
  and the largest size must finish within its budget.

## Outputs and how to read them

The general table (`validate-overview`). A system item names the product file it points at and, for a
claim item, the documented sentence it asks (`asks: <file> and <page> "<section>": <claim>`) followed by
what it found (`found: ...`). Typical readings:

| Level | Detail says | Look at |
|---|---|---|
| `fault-reach` | a planted fault did not fail its block, or failed another | the check or adapter named |
| `precision` | a clean or hostile agent produced a failing block | the check that fired, or the adapter that misread |
| `drift-class` | the wrong drift class | the mapping that chose the class |
| `variance`, `version-drift` | an interval missed, or drift at the wrong cell | the report or statistics code named |
| `command-line` | an exit code or output field differs from the documentation | the command file named, or the documentation if the claim is wrong (a ruling) |
| `scale` | the answer changed or the time grew too fast | the subject named |

Exit status: the level reached.

## Worked example

The ladder runs for many minutes per seed, so the help test runs only a fast check that the component
exists (the scratch folder has no journal, hence the exit 64):

```sh
driftbench validate system --hardness # exit 64
```

```text
validators/system/journal.jsonl: the journal holds no iteration 0 row: run and record iteration 0 first.
```

The ladder on seed 1, at the repository root on macOS (1029 seconds on a busy machine). Shown as text, not run by the help test: a whole ladder runs for minutes, and the level it reaches changes as the product is fixed.

```bash
pnpm -s driftbench validate system
```

```text
Validator system (ladder version 5)
Level  Name                                                         Metric                                                                                                                                                                                                                                                                                                                                                         Threshold  seed 1
1      records stored, resumed and budgeted                         items passing / items, 501 items (store-roundtrip, resume-budget, combo-store-file, combo-store-memory, claim-spec, store-stress, breaker-datasets, breaker-cli, breaker-tools, breaker2-viewer, robust-concurrency, robust-resume, robust-transfer, robust-version)                                                                                           >= 1       1 pass
2      a planted fault reaches the right block and check            items passing / items, 154 items (fault-position-mode, fault-adapter, fault-multi, fault-perturbed, claim-adapters)                                                                                                                                                                                                                                            >= 1       1 pass
3      clean, hostile and failing agents read right                 items passing / items, 345 items (clean-shapes, hostile-inputs, failure-handling, claim-checks, claim-adapters, breaker-checks)                                                                                                                                                                                                                                >= 1       0.997101 FAIL (1)
4      drift class of every failing block                           items passing / items, 74 items (drift-class, claim-concepts)                                                                                                                                                                                                                                                                                                  >= 1       not run
5      every field of the run record                                items passing / items, 84 items (run-fields, claim-spec, claim-concepts)                                                                                                                                                                                                                                                                                       >= 1       not run
6      recovery record of every perturbed run                       items passing / items, 74 items (recovery, claim-concepts)                                                                                                                                                                                                                                                                                                     >= 1       not run
7      variance and the parity verdict against their truth          items passing / items, 66 items (variance, claim-concepts)                                                                                                                                                                                                                                                                                                     >= 1       not run
8      drift between two versions at the right cell                 items passing / items, 114 items (version-drift, claim-report, report-brute-force)                                                                                                                                                                                                                                                                             >= 1       not run
9      replay equals live                                           items passing / items, 30 items (claim-concepts, replay)                                                                                                                                                                                                                                                                                                       >= 1       not run
10     command-line exit codes and output fields                    items passing / items, 867 items (claim-cli, claim-cli-flags, breaker-datasets, breaker-cli, breaker-spec, breaker-tools, breaker2-compare, breaker2-report, breaker2-viewer, breaker2-import, breaker2-ops, exits-spec, exits-campaign, exits-space, exits-generate, exits-registry, exits-verdict, exits-suite, exits-readers, exits-users, cli-documented)  >= 1       not run
11     scale: the same answers at ten and a hundred times the size  items passing / items, 76 items (scale)                                                                                                                                                                                                                                                                                                                        >= 1       not run
Level per seed: 1 = 2
Level of the run: 2 of 11, the minimum over 1 seed.
Floor: 9. BELOW THE FLOOR.
Items of the first failing level:
  Seed 1, level 3 precision (clean, hostile and failing agents read right), 1 item:
    family claim-adapters (1):
      claim/adapters/process/exit-kills-detached-child  [tier 4]  [packages/sandbox/src/run.ts]  asks: packages/sandbox/src/run.ts and process.md "Sandboxes": when the agent exits, a background child it left running is killed with it, also one it started in its own process group. found: expected the detached child killed when the agent exited, but it ran on and wrote late.txt in /private/var/folders/r2/k83h9fg92j7f6pfxshk0nn280000gn/T/driftbench-system-bank-NWL8zJ/claims-adapters/exit-detached-1/sandboxes/driftbench-zFwbMe
```

It exited 2, below the floor of 9. Read the one item: it asks the sandbox claim that a background child
the agent started in its own process group dies when the agent exits, and found the child still running
and writing a file afterwards. It points at `packages/sandbox/src/run.ts`. It is a product finding on the
machine that ran it. CI runs the validators on Linux runners (`ubuntu-latest`), so reproduce a
macOS-only finding there before you call it a regression.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `Floor: 9. BELOW THE FLOOR.` | a change broke a level at or below 9, or the machine differs from CI | read the first failing item; reproduce it on the same seed |
| the run takes more than ten minutes | the system bank starts many CLI child processes | iterate on one seed; use `--seeds 1..20` at the end |
| a `scale` item fails | the answer changed at a larger size, or the processor time grew more than 25 times from ten to a hundred | the subject named |
| a `claim-*` item disagrees with the documentation you just changed | the claim items read the documented behaviour | change the product or the documentation so they agree; a wrong item goes to `validate-mutants-and-rulings` |
| leftover `driftbench-system-bank-*` folders in the temporary folder | an interrupted run did not clean up | remove only folders your own interrupted run created |
