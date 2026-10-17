---
title: Protected validator files
summary: Check that an executor branch leaves the validators, their fixtures, the floors and the CI jobs alone.
commands:
  - validate
see_also:
  - validate-executor-loop
  - validate-floors
  - validate-mutants-and-rulings
  - validate-self-checks
next:
  - validate-mutants-and-rulings
---

## What it is

A validator is only worth something if the code it grades cannot change it. Executors push from branches
whose name starts with `exec/`, and those branches may not change the files that define the grade.
`driftbench validate protect --branch <name> --base <ref>` lists the files the checked-out commit changes
against a base (`git diff --name-only <base>...HEAD`) and fails when the branch is an executor branch and
any of them is protected. Any other branch, such as the maintainer's, may change them.

The protected paths, from `PROTECTED_PATHS` in `packages/validators/src/protect.ts` (a path ending in `/`
covers its folder, a trailing `*` covers a file name prefix):

| Path | What it holds |
|---|---|
| `packages/validators/src/` | the ladders and banks, thresholds, the hidden seed derivation, the bank, hardness and floor logic, the frame that scores them |
| `packages/validators/fixtures/` | the bank fixtures |
| `packages/validators/test/` | the validators' own tests |
| `validators/floors.json` | the floors |
| `validators/EXECUTOR.md` | the executor instruction |
| `examples/acme/faults/` | the fault family the generator and system validators plant |
| `packages/stats/test/reference/` | the statistics reference fixtures (scipy and numpy values) |
| `.github/workflows/validators.yml` | the validators CI job |
| `benchmarks/` | the benchmark frame |
| `tools/bench-lint*` | the benchmark lint |
| `packages/cli/src/commands/bench*` | the benchmark commands |
| `.github/workflows/ci.yml` | the main CI job |
| `.github/workflows/bench-record.yml` | the benchmark recording job |

An executor may change everything else: the product code the items point at, the product's own tests,
and its own loop files (`validators/<component>/journal.jsonl`, `HANDOVER.md`, `research.md`).

## When to use it

* CI runs it on every pull request, with the full history checked out:
  `pnpm driftbench validate protect --branch "$HEAD_REF" --base "origin/$BASE_REF"`.
* Before an executor pushes, to know whether the branch will pass that job.
* When you review an executor's pull request, to see which protected files it touched, if any.

## Commands and every option

```
driftbench validate protect --branch <name> --base <ref>
```

| Option | Default | Meaning |
|---|---|---|
| `--branch <name>` | none, required | the branch name of the pull request; only a name starting with `exec/` is checked |
| `--base <ref>` | none, required | the ref the pull request merges into, such as `origin/main`; the diff is `<ref>...HEAD` |

The command diffs the checked-out `HEAD`, not the branch named by `--branch`: check out the branch first.
The name only decides whether the rule applies.

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

A git repository at the root (the nearest folder above the working folder with `pnpm-workspace.yaml`),
with `HEAD` checked out and the base ref present locally. In CI the checkout needs the full history
(`fetch-depth: 0`) so the merge base exists.

## Outputs and how to read them

| Case | Output | Exit |
|---|---|---|
| not an executor branch | `<branch> is not an executor branch (exec/): nothing is protected from it.` | 0 |
| executor branch, no protected file | `<branch> changes <n> files, none of them protected.` | 0 |
| executor branch, protected files changed | on standard error: `<branch> is an executor branch and changes protected files:`, one indented path per file, then the whole protected list | 1 |
| missing option | `Check a pull request with: driftbench validate protect --branch <name> --base <ref>.` | 64 |
| git fails (no repository, unknown ref) | `git diff against <ref> failed: <git's message>` | 64 |

A failure is not something to work around. Take the protected change off the executor branch. If a
validator file is wrong, report it to the maintainer, who changes it from a branch that is not an
executor branch (see `validate-mutants-and-rulings`).

## Worked example

The help test runs in a scratch folder outside any git repository, so only the usage errors are
deterministic there:

```sh
driftbench validate protect # exit 64
driftbench validate protect --branch exec/stats-fix # exit 64
```

```text
Check a pull request with: driftbench validate protect --branch <name> --base <ref>.
Check a pull request with: driftbench validate protect --branch <name> --base <ref>.
```

Inside the clone, on the branch of this help topic, whose only change against `origin/main` was then the
help contract. Shown as text, not run by the help test: it reads git.

```bash
pnpm -s driftbench validate protect --branch feat/cli-help-validate --base origin/main
pnpm -s driftbench validate protect --branch exec/stats-fix --base origin/main
pnpm -s driftbench validate protect --branch exec/demo --base ebad76504~1
```

```text
feat/cli-help-validate is not an executor branch (exec/): nothing is protected from it.
exec/stats-fix changes 1 files, none of them protected.
exec/demo is an executor branch and changes protected files:
  packages/validators/fixtures/system/bank-manifest.json
  packages/validators/src/ladders/system/bank/claims/breaker2.ts
  packages/validators/test/system/viewer-maintenance.test.ts
Protected: packages/validators/src/, packages/validators/fixtures/, packages/validators/test/, validators/floors.json, validators/EXECUTOR.md, examples/acme/faults/, packages/stats/test/reference/, .github/workflows/validators.yml, benchmarks/, tools/bench-lint*, packages/cli/src/commands/bench*, .github/workflows/ci.yml, .github/workflows/bench-record.yml. These are the maintainer's (docs/validators.md section 8).
```

The first two exit 0. The third names the current commit an executor branch and takes as its base the
commit before a merge (`ebad76504`) that changed the system bank, so the diff holds protected files; it
exits 1.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `Check a pull request with: ...` (exit 64) | `--branch` or `--base` missing | give both |
| `git diff against <ref> failed: ...` (exit 64) | not inside a clone, or the base ref is not fetched | run in the clone; `git fetch origin` |
| `<branch> is an executor branch and changes protected files:` (exit 1) | an executor changed a validator, a fixture, the floors or a CI job | revert those files on the branch; report a wrong item instead of editing it |
| the check passes but the pull request changes protected files | `--branch` names a branch that does not start with `exec/` | executor work belongs on `exec/` branches |
| the listed files are not the pull request's files | `HEAD` is not the pull request's head | check out the branch before running it |
