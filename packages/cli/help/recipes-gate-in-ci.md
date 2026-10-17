---
title: Gate a change in CI
summary: Run the suite on a candidate in CI, compare it golden by golden with a baseline campaign, and fail the job unless it shows parity.
commands:
  - campaign run
  - ci
  - report
see_also:
  - core-exit-codes
  - core-configuration
  - recipes-test-a-chat-agent
  - recipes-compare-two-versions
next:
  - recipes-compare-two-versions
---

## Goal

You have a spec suite and an agent under change. On every pull request you want one step that runs the suite
on the changed agent (the candidate), compares it with the agent before the change (the baseline), and fails
the job unless the candidate is no worse.

The chain is: run the baseline campaign once, then run `driftbench ci` on the candidate. `ci` runs the specs,
pairs every golden with the baseline, applies the rule of `driftbench compare`, writes a JSON summary and
exits 0 on parity, 1 otherwise, 2 on bad input. Campaign-level criteria (`--aggregate`) add a pass-rate floor,
`report --junit` gives your CI system JUnit XML, and `action/action.yml` wraps `ci` as a GitHub Action.

A golden is one spec in one mode (and one perturbation in mode P), with every repeat of it. A golden passes
when every repeat passes.

## Before you start

* A checkout of driftbench, built: `pnpm install`, then `pnpm build`. Run every command from the repository
  root as `pnpm -s driftbench <command>`. See `driftbench help core-getting-started`.
* A suite. This recipe uses the Acme golden suite, `examples/acme/golden/specs`: 10 specs, nine
  conversations for the sales assistant `function:acme-sales` and one price-sheet task for the ops agent
  `process:acme-ops`. Both agents are deterministic code: no model, no key, no network.
* Candidates that differ from the baseline. The Acme example ships planted faults in `examples/acme/faults`,
  each the real agent with one thing changed. A target `fault:<id>` runs one of them; `--faults
  examples/acme/faults` tells `ci` where they are. They stand in for a broken pull request. Your own
  candidate is your agent's target, with no `--faults`.
* Every command below runs with no model and no key, and writes only new files in the folder you run it in.

## Steps

### 1. Run the baseline campaign

The baseline is the campaign every candidate is compared with: the agent before the change, on the same
suite.

```sh
driftbench campaign run examples/acme/golden/specs --target function:acme-sales \
  --route flow:price-sheet=process:acme-ops --store base.db --campaign baseline
```

```text
Campaign baseline: 10 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, ...
Not judged: 21 criteria in 17 blocks of 9 specs (one_question_per_turn, ...), 3 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-price-sheet-i08-planted · process:acme-ops · F · repeat 0  pass  1 block
...
10 cells: 10 pass, 0 fail, 0 failed. Spent $0.00.
```

`--target` runs every spec on the sales assistant; `--route flow:price-sheet=process:acme-ops` sends the specs
tagged `flow:price-sheet` to the ops agent instead. Without the route the task spec runs on the chat agent and
fails. `--store` keeps the campaign in a SQLite file; `--campaign` names it, else the id is made from the
content and the clock. A failing baseline cell is part of the baseline: in CI keep exit 1 and stop only on
exit 2, as `examples/acme/ci/driftbench-ci.yml` does.

### 2. Gate a candidate that changed nothing

`ci` runs the candidate, pairs it with the baseline and gives the verdict. `--baseline` takes a store file
(its latest campaign is the baseline) or a campaign id held in `--store`.

```sh
driftbench ci --specs examples/acme/golden/specs --target function:acme-sales \
  --route flow:price-sheet=process:acme-ops --baseline base.db --store candidate.db --out ci-same.json
```

```text
driftbench ci: candidate function:acme-sales (campaign c-3a1fc7c8687f) against baseline campaign baseline, compared as driftbench compare does (golden by golden, every repeat).
Margin auto: 28 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 27.75 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 27.8 points); about 22 goldens would.
Underpowered, under 30 goldens, left out of the parity test: artifacts (1 golden), budget (2 goldens), ...
  measure                                      value
  goldens paired                               10
  both pass                                    10
  regressed                                    0
  ...
  all-pass regression effect                   0.00 points
  95% interval                                 [-27.75, +27.75] points
  margin                                       28 points (auto)
  verdict                                      PARITY
...
Verdict: PARITY. Exit 0.
Summary: ci-same.json
```

How to read it:

* The margin is the largest drop in pass rate tolerated, in points. `--margin auto` (the default) takes the
  smallest half point at which the baseline compared with itself is non-inferior. Ten goldens can show no
  margin under 27.75 points, so the gate is lenient, and the warning says about 22 goldens would allow 15.
  Add goldens, not repeats, to narrow it.
* A gating criterion decided on fewer than `--min-goldens` goldens (default 30) is underpowered: reported and
  left out of the parity test. `--strict` puts it back.
* The flag families `safety`, `forbidden` and `pii` gate always: a flag the candidate raises where the
  baseline did not is a regression. `--flag <family>` (repeatable) replaces the list.
* The cache is off, so every cell runs the agent; `--cache` replays cached runs. `--mode` (default `F`),
  `--repeats` (default 1), `--concurrency` (default 4) and `--budget-usd` set the candidate campaign as in
  `campaign run`.

### 3. Gate a candidate that breaks the flow

The fault `x3-skips-recap` never shows the recap: it confirms for the customer and places the order. This is
the job failing.

```sh
driftbench ci --specs examples/acme/golden/specs --target fault:x3-skips-recap --faults examples/acme/faults \
  --route flow:price-sheet=process:acme-ops --baseline base.db --store candidate.db --out ci-x3.json  # exit 1
```

```text
  goldens paired                               10
  both pass                                    5
  regressed                                    5
  new gating flags                             5
  all-pass regression effect                   +50.00 points
  95% interval                                 [+11.74, +76.34] points
  verdict                                      REGRESSION

Goldens that changed:
  golden                             baseline  candidate  change     new flags  candidate failing
  acme-order-loose-confirmation · F  pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
  gen-twise-066 · F                  pass      fail       regressed  forbidden  block 3 forbidden.order.create, block 3 stage.reached, block 4 tools.order.create.count
  ...
Why:
  - new gating flag forbidden in acme-order-loose-confirmation · F
  ...
Verdict: REGRESSION. Exit 1.
Summary: ci-x3.json
```

Each changed golden names the checks it failed, as `block <index> <verdict id>`. The verdicts and exit codes:

| Verdict | Exit | Means |
|---|---|---|
| `parity` | 0 | every gating criterion that is not underpowered and the all-pass flag have an upper bound below the margin, and no flag family is new |
| `regression` | 1 | evidence of a drop: a new flag, a criterion the false discovery rate control keeps, or the all-pass McNemar test below 0.05 with more goldens regressed than improved |
| `not-shown-non-inferior` | 1 | no evidence of a drop, but an interval is wider than the margin: too few goldens, never a regression |
| `incomplete` | 1 | a candidate cell did not run, such as one stopped by `--budget-usd` |
| `aggregate-failed` | 1 | a campaign-level criterion failed (step 4) |
| none | 2 | bad input; nothing ran and nothing was written |

The summary file (`--out`, default `driftbench-ci.json`) holds `verdict`, `exitCode`, `reasons`,
`marginPoints`, `underpowered`, `regressed`, `newFlags`, `aggregates` and the per-golden `rows`. `--json`
prints it instead of the table.

### 4. Add a pass-rate floor

A campaign-level criterion scores one number over every run of the candidate, such as the share of runs that
pass. `--aggregate <name>:<op><threshold>` is repeatable; the built-in names are `pass-rate` and
`broken-share`, `>=` means at least and `<=` at most. The fault `d8-hides-tool-failure` claims success when a
tool fails.

```sh
driftbench ci --specs examples/acme/golden/specs --target fault:d8-hides-tool-failure --faults examples/acme/faults \
  --route flow:price-sheet=process:acme-ops --baseline base.db --store candidate.db --out ci-agg.json \
  --aggregate 'pass-rate:>=0.95'  # exit 1
```

```text
  goldens paired                               10
  both pass                                    9
  regressed                                    1
  ...
  verdict                                      AGGREGATE FAILED

Goldens that changed:
  golden             baseline  candidate  change     new flags  candidate failing
  gen-twise-074 · F  pass      fail       regressed  none       block 4 stage.reached

Why:
  - all-pass: the upper bound 40.4 points of the regression effect is not below the margin 28.0 points
  - aggregate pass-rate fails: 0.9 >= 0.95

Verdict: AGGREGATE FAILED. Exit 1.
```

The summary's `aggregates` entry holds the value (0.9), its 95% interval (Wilson on the effective runs over the
10 goldens, here 0.523 to 0.987), whether the interval decides the threshold (`decided`), and what would
decide it: `goldensNeeded`, a whole number of copies of these goldens (80 here, 8 copies), and `runsNeeded`,
the runs of those goldens (80 here, one run each). An aggregate over no runs is inconclusive and does not fail the gate.

Criteria and run settings can live in a project config instead of flags: `driftbench.yaml` in the working
folder, or the file `--config` names. Its `aggregates:` list is read by `ci` and `report`; from its
`campaign:` key `ci` takes `routes`, `modes`, `repeats`, `concurrency`, `budget_usd`, `process_command` and
`agent_version`. A flag wins over the file. `examples/acme/ci/campaign.yaml` is one.

### 5. Write JUnit XML for the CI system

`report` writes the scorecard of a stored campaign as one HTML file and, with `--junit`, JUnit XML: one test
suite per golden, one test case per run. Without a campaign id it reads the latest campaign of the store,
here the candidate of step 4.

```sh
driftbench report --store candidate.db --out candidate.html --junit junit.xml
```

```text
Margin auto: 28.0 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 27.8 points).
Campaign c-71ad81ea18f6: 10 runs, 9 pass, 1 fail, 0 did not complete.
Suite pass rate, mode F: 90.0% [58.7%, 97.8%] (hierarchical 95% interval); 10 goldens, n_eff 9.0 runs (design effect 1.11), detectable drop 60.6 points at 80% power.
Wrote candidate.html and junit.xml.
```

`junit.xml` opens with `<testsuites name="c-71ad81ea18f6" tests="10" failures="1" ...>`. `report` exits 0
when written, 2 on bad input; it never gates. Point your CI system's test report at `junit.xml` and keep
`candidate.html` as a build artifact.

### 6. Know what a refused gate looks like

Bad input exits 2 before any cell runs, and writes neither the store nor the summary.

```sh
driftbench ci --specs examples/acme/golden/specs --target function:acme-sales \
  --baseline base.db --store candidate.db --margin 0 --out bad.json  # exit 2
```

```text
--margin takes a number of points above 0 and below 100, such as 2, not "0".
```

In a CI script, treat exit 2 as a broken job (a wrong path, an unknown baseline, a `fault:` target without
`--faults`) and exit 1 as a failed gate.

### 7. Run it as a GitHub Action

`action/action.yml` at the repository root is a composite action around `driftbench ci`. It runs no model by
itself; a paid call happens only when your target is a model. `examples/acme/ci/driftbench-ci.yml` is a
complete workflow: copy it to `.github/workflows/`. It checks out the pull request's base and head, runs the
baseline campaign on the base, runs the action on the head and uploads the summary. Its gate step:

```text
      - name: driftbench ci on the head
        id: gate
        uses: ./head/action
        with:
          working-directory: head
          specs: examples/acme/gated/specs
          target: function:acme-sales
          route: flow:price-sheet=process:acme-ops
          baseline: ${{ runner.temp }}/baseline.db
          store: ${{ runner.temp }}/candidate.db
          report-path: driftbench-ci.json
```

Inputs, each the `ci` flag of the same name: `specs`, `target` and `baseline` (required); `store` (default
`.driftbench/ci.db`), `margin` (default `auto`), `min-goldens` (default `30`), `strict` (default `false`),
`repeats` (default `1`), `mode` (default `F`), `budget-usd`, `faults`, `route` (one `tag=target` per line),
`process-command`, `change`, `agent-version`, `audit`, `aggregate` (one `name:op threshold` per line),
`report-path` (default `driftbench-ci.json`), `working-directory` (default `.`) and `driftbench`, the command
that runs the CLI (default `pnpm -s driftbench`). Outputs: `verdict` (`parity`, `regression`,
`not-shown-non-inferior`, `incomplete`, `aggregate-failed`, `radius-miss`, or `input-error`) and
`report-path`. The step exits with the CLI exit code, so any verdict but parity fails the job.

## What you have at the end

* `base.db`: the store with the baseline campaign `baseline`.
* `candidate.db`: the store with the three candidate campaigns of steps 2 to 4.
* `ci-same.json`, `ci-x3.json`, `ci-agg.json`: the JSON summaries of the three gates.
* `candidate.html` and `junit.xml`: the scorecard and the JUnit XML of the last candidate.
* A workflow to copy, `examples/acme/ci/driftbench-ci.yml`, and the action it calls, `action/action.yml`.

To read why one golden regressed, open the scorecard, or run `driftbench campaign status --store
candidate.db --json` for every verdict of every block with its evidence.

## When a step fails

* `campaign run` exits 1 in step 1: a baseline cell failed. It stays in the baseline; the gate compares
  pass against pass and fail against fail. Exit 2 is bad input: fix it before gating.
* `Warning: this suite cannot show parity under 15 points`: too few goldens for a tight gate. Grow the suite
  (`driftbench help recipes-tests-from-past-conversations`); more repeats do not help.
* Verdict `not-shown-non-inferior` with no regressed golden: the intervals are wider than the margin. Add
  goldens, or set a wider `--margin` on purpose.
* `A fault:<id> target needs --faults <path>, the fault set that defines it.` (exit 2): pass `--faults`.
* `--margin takes a number of points above 0 and below 100` (exit 2): pass a margin in (0, 100) or `auto`.
* Verdict `incomplete`: a candidate cell did not run, often stopped by `--budget-usd`. Raise the budget or
  shrink the suite.
* The task spec fails on the chat target: pass `--route flow:price-sheet=process:acme-ops` (the `route` input
  of the action) on the baseline and on the candidate.
* `error: required option '--out <file.html>' not specified` (exit 2) from `report`: pass `--out`.
