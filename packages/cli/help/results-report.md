---
title: "Report a campaign"
summary: "Write the scorecard of a stored campaign as one offline HTML file, with JUnit XML, aggregates and JSON."
commands:
  - report
see_also:
  - results-scorecard
  - results-compare
  - results-statistics
  - results-exports
next:
  - results-scorecard
---

## What it is

`driftbench report` reads one campaign from a store and writes its scorecard: one HTML file with no
script and no external asset (its fonts are embedded), so it opens offline in any browser and can be attached to a ticket or a
pull request as it is. It can also write JUnit XML of the same campaign, score campaign-level criteria
(aggregates), add the comparison with a baseline campaign, add a variance pilot, and print the whole
scorecard as JSON.

The command only reads the store. It runs no agent and calls no model.

## When to use it

* After `driftbench campaign run` (or `driftbench ci`), to see what the campaign did: every rate with its
  interval, every failing run in full.
* To publish a result: the HTML file is self-contained.
* To feed a CI system that reads JUnit XML (`--junit`).
* To score a rule over the whole campaign, such as "at least 80 percent of runs pass" (`--aggregate`).
* To see a candidate against a baseline on one page (`--baseline`). For the exit code of that
  comparison use `driftbench compare` or `driftbench ci`: `report` exits 0 whatever the verdict.

## Commands and every option

```
driftbench report [campaign] --store <file> --out <file.html> [options]
```

| Argument or option | Default | Meaning |
|---|---|---|
| `[campaign]` | the latest campaign of the store | the campaign id to report |
| `--store <file>` | required | the store that holds the campaign |
| `--out <file.html>` | required | where to write the scorecard; missing folders are created |
| `--junit <file.xml>` | none | also write JUnit XML: one test suite per golden (spec), one test case per run |
| `--baseline <campaign>` | none | a baseline campaign in the same store; adds the comparison section and prints the verdict line |
| `--margin <points\|auto>` | `auto` | the non-inferiority margin in percentage points, above 0 and below 100. `auto`: the smallest half point at which the baseline (without `--baseline`, the campaign itself) compared with itself is non-inferior |
| `--min-goldens <n>` | `30` | a gating criterion decided on fewer goldens is underpowered and left out of the parity test; a whole number of at least 1 |
| `--strict` | off | underpowered criteria gate too |
| `--pilot <path>` | none | a pilot report, `pilot-report.json` or the folder that holds it, rendered in the variance pilot section |
| `--by <dimensions>` | none | the generated-cell dimensions that name a cell of the spread view, separated by commas |
| `--spread-mode <mode>` | `F` when the campaign ran F | the one mode (T, F or P) the spread view reads |
| `--max-runs <n>` | `200` | how many runs the Runs zone shows, each with its panel, failing runs first; a whole number of 0 or more |
| `--withhold-incomplete` | off | for a line with incomplete runs, withhold the pass^k and pass@k value instead of reporting it with the range of its missing outcomes |
| `--json` | off | also print the whole scorecard as one JSON document on standard output, instead of the summary lines |
| `--config <file>` | `driftbench.yaml` in the working folder, when it exists | the project config whose `aggregates:` list is scored |
| `--aggregate <spec>` | none | a campaign-level criterion `name:op threshold`, such as `pass-rate:>=0.8`; repeatable. Names: `pass-rate`, `broken-share`. Operators: `>=` (at least), `<=` (at most). A flag with the same name as a config entry replaces it |

The global option `--plugin <module>` (load a plugin first) is accepted before or after the command, as
on every command.

Exit codes: 0 when the files are written, 2 on bad input (no store, unknown campaign, a bad number, an
unreadable pilot, a config that does not parse). A failing aggregate or a regressed baseline still exits 0.

## Inputs

* A store written by `driftbench campaign run` or `driftbench ci` (`--store`). Every spec the campaign
  pins must be in the store; the store keeps them.
* Optionally a baseline campaign in the same store, a pilot report written by `driftbench pilot run`,
  and a project config with an `aggregates:` list, for example `examples/acme/ci/campaign.yaml`:

```yaml
aggregates:
  - pass-rate:>=0.8
```

## Outputs and how to read them

Standard output, without `--json`:

* `Margin auto: ...` when the margin is `auto`: the margin used and what set it, with a warning when it
  is above 15 points.
* `Campaign <id>: <runs> runs, <n> pass, <n> fail, <n> did not complete.`
* Lines about carried results, when the campaign ran a blast radius (see `results-radius`).
* `Against baseline <id>: <verdict>, margin <m> points.` with `--baseline`. The verdict is
  `non-inferior`, `regressed` or `unproven`, as `driftbench compare` decides it.
* One `aggregate` line per criterion: `passes`, `fails` or `no runs`, the value against the threshold,
  the 95% interval of the rate, and `decided` or `undecided`. Over several goldens the interval is the Wilson
  interval on the effective runs, printed with the goldens, the design effect and the effective runs, and an
  undecided line says how many goldens like these (and how many runs) would decide it. With one golden it is
  the plain Wilson interval over the runs.
* `Wrote <files>.`

The HTML file is described in `results-scorecard`: an overview, three zones (pass rate charts, tests,
runs with a detail panel per run), and every detailed table folded under "All details". The JUnit file has one
`<testsuite>` per spec and one `<testcase>` per run, named `<target> · <mode> · repeat <n>` (with the
perturbation id in mode P); a failing run is a `<failure>`, a run that did not complete an `<error>`.

With `--json` the standard output is the scorecard object itself (the `compare` part with its maps
written as plain objects); see `results-exports`.

## Worked example

On the Acme example: six conversation specs run in modes T, F and P with two repeats, then a second
campaign where `driftbench ci` replaces the agent with the planted fault `x3-skips-recap`. No model is
called.

```sh
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --store acme.db --campaign c-base
driftbench report c-base --store acme.db --out acme.html --junit acme-junit.xml
driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --mode T,F,P --repeats 2 --baseline c-base --store acme.db --out x3-ci.json # exit 1
driftbench report --store acme.db --baseline c-base --config examples/acme/ci/campaign.yaml --max-runs 20 --out x3.html
driftbench report c-base --store acme.db --out c-base.html --withhold-incomplete --spread-mode F --min-goldens 10 --margin 20
```

The first report, on the clean campaign:

```text
$ driftbench report c-base --store acme.db --out acme.html --junit acme-junit.xml
Margin auto: 14.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 14.3 points).
Campaign c-base: 46 runs, 46 pass, 0 fail, 0 did not complete.
Suite pass rate, mode T: 100.0% [65.3%, 100.0%] (hierarchical 95% interval); 6 goldens, n_eff 6.0 runs (every run agrees, so each golden counts once), detectable drop 71.7 points at 80% power.
Suite pass rate, mode F: 100.0% [65.3%, 100.0%] (hierarchical 95% interval); 6 goldens, n_eff 6.0 runs (every run agrees, so each golden counts once), detectable drop 71.7 points at 80% power.
Suite pass rate, mode P: 100.0% [78.5%, 100.0%] (hierarchical 95% interval); 11 goldens, n_eff 11.0 runs (every run agrees, so each golden counts once), detectable drop 50.6 points at 80% power.
Wrote acme.html and acme-junit.xml.
```

The second report takes the latest campaign of the store (the fault campaign `ci` stored), reads it
against `c-base`, and scores the config's `pass-rate:>=0.8`:

```text
$ driftbench report --store acme.db --baseline c-base --config examples/acme/ci/campaign.yaml --max-runs 20 --out x3.html
Margin auto: 14.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 14.3 points).
Campaign c-8d7db66d5e8a: 46 runs, 20 pass, 26 fail, 0 did not complete.
Suite pass rate, mode T: 50.0% [18.7%, 81.3%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 2.40), no drop detectable at 80% power.
Suite pass rate, mode F: 50.0% [18.7%, 81.3%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 2.40), no drop detectable at 80% power.
Suite pass rate, mode P: 36.4% [14.7%, 64.0%] (hierarchical 95% interval); 11 goldens, n_eff 10.0 runs (design effect 2.20), no drop detectable at 80% power.
Against baseline c-base: regressed, margin 14.5 points.
aggregate pass-rate >= 0.8: fails (0.43478260869565216 >= 0.8, Wilson 95% interval on the effective runs 0.245 to 0.646 over 46 runs in 23 goldens (design effect 2.09, 22.0 effective runs), decided)
Wrote x3.html.
```

The fault fails 26 of 46 runs, so the pass rate is 0.43 and the aggregate fails, yet the command exits 0:
`report` writes; `compare` and `ci` gate. The last command sets the margin and the minimum by hand:

```text
$ driftbench report c-base --store acme.db --out c-base.html --withhold-incomplete --spread-mode F --min-goldens 10 --margin 20
Campaign c-base: 46 runs, 46 pass, 0 fail, 0 did not complete.
Suite pass rate, mode T: 100.0% [65.3%, 100.0%] (hierarchical 95% interval); 6 goldens, n_eff 6.0 runs (every run agrees, so each golden counts once), detectable drop 71.7 points at 80% power.
Suite pass rate, mode F: 100.0% [65.3%, 100.0%] (hierarchical 95% interval); 6 goldens, n_eff 6.0 runs (every run agrees, so each golden counts once), detectable drop 71.7 points at 80% power.
Suite pass rate, mode P: 100.0% [78.5%, 100.0%] (hierarchical 95% interval); 11 goldens, n_eff 11.0 runs (every run agrees, so each golden counts once), detectable drop 50.6 points at 80% power.
Wrote c-base.html.
```

## Common errors

| Message | Cause and fix |
|---|---|
| `No store at <path>: this command reads a store and does not make one.` (exit 2) | `--store` names no file. Run a campaign into it first, or fix the path |
| `No campaign <id> in the store.` (exit 2) | the campaign id is wrong; `driftbench campaign status --store <file>` shows the latest |
| `The store holds no campaign.` (exit 2) | the store is empty and no campaign id was given |
| `--max-runs takes a whole number of 0 or more` (exit 2) | give an integer such as `40` |
| `--margin takes a number of points above 0 and below 100, such as 2` (exit 2) | the margin is in points: `2` means 2 points, not `0.02` |
| `--spread-mode takes one mode` (exit 2) | give one of `T`, `F`, `P`, not a list |
| `Unknown mode "X"` (exit 2) | the modes are `T`, `F` and `P` |
| an aggregate line reads `fails` but the exit code is 0 | expected: `report` never gates. Use `driftbench ci --aggregate` for a failing exit code |
| the Runs zone lists fewer runs than the campaign has | `--max-runs` (default 200) caps it; the page says how many runs it left out |
