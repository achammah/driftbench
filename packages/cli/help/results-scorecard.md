---
title: "Read the scorecard"
summary: "The scorecard page: the overview, the three zones (charts, tests, runs with a panel per run), the folded details, and what each number means."
commands:
  - report
see_also:
  - results-report
  - results-drift-recovery
  - results-statistics
  - results-view
next:
  - results-compare
---

## What it is

The scorecard is the HTML page `driftbench report` writes for one stored campaign, and the page
`driftbench view` serves at `/campaign/<id>`. It is one file with no script and no request to any server:
the style is inline, and its fonts (Geist, Geist Mono, Libre Caslon Display and Libre Caslon Text, under the
SIL Open Font License) are embedded as base64. It renders the same offline, in a mail attachment or in a CI
artifact. It is dark by default; the Light button at the top switches the theme.

Every control on the page works without script: filters are radio buttons, the version switches are
checkboxes, and a run's panel opens on its own address (`#run-<runId>`), so a link to a run opens that run.

This topic says what each section holds. How to write the file is in `results-report`.

## When to use it

Read it after every campaign, before trusting a pass rate: the page puts an interval on every rate, says
which goldens failed and why, and shows every failing run block by block. Read the "Baseline and
candidate" section to see why a comparison was or was not non-inferior.

## Commands and every option

The page comes from `driftbench report`. The options that change what the page holds:

| Option | Default | What it changes on the page |
|---|---|---|
| `--baseline <campaign>` | none | adds the regressed count to the overview, the Versions zone, baseline bars in the charts, the Regressed filter and the vs-baseline column in Tests, and the "Baseline and candidate" table in All details |
| `--margin <points\|auto>` | `auto` | the margin of that comparison and of the Spread table's undecided cells |
| `--min-goldens <n>` | `30` | which gating criteria the comparison marks underpowered |
| `--strict` | off | underpowered criteria gate in the comparison |
| `--pilot <path>` | none | adds the "Variance pilot" table to All details, from a `pilot-report.json` |
| `--by <dimensions>` | none | the generated-cell dimensions that name a cell in the Spread table |
| `--spread-mode <mode>` | `F` when the campaign ran F | the mode the Spread table reads |
| `--max-runs <n>` | `200` | runs listed in the Runs zone (each with its panel), failing runs first |
| `--withhold-incomplete` | off | a reliability line with incomplete runs shows no pass^k and pass@k value |
| `--aggregate <spec>`, `--config <file>` | none, `driftbench.yaml` | campaign-level criteria, scored in the JSON and on standard output |

The other options of `report` (`[campaign]`, `--store`, `--out`, `--junit`, `--json`, `--plugin`) do not
change the page; every option with its default is listed in `results-report`.

## Inputs

One campaign of a store, and optionally a baseline campaign of the same store and a pilot report. A
campaign with modes T and F gets the compounding index; a campaign with mode P gets the recovery section.

## Outputs and how to read them

The words the page uses: a **test** is one spec on one target; a **case** is that test in one mode (one
perturbation in P), over its repeats, and it passes when every run passes; a **run** is one repeat of a
case; a **block** is one exchange of a run; a **check** is one verdict on a block.

From top to bottom:

1. **Overview.** The campaign id; facts (baseline, created, targets, modes, money spent); three numbers:
   cases passing, runs passing (with failed and did not complete), and, with `--baseline`, cases regressed
   against the baseline with the improved count and McNemar p, or else blocks passing and checks failed.
   A path line counts tests, cases, runs, blocks and checks. The Light or Dark button sits at the top.
2. **Versions** (with `--baseline` only). Baseline and candidate side by side: campaign, targets, cases
   passing and drifting blocks per case, with the change between them. Each row has a checkbox that draws
   or hides that version in the charts.
3. **Zone 1, Pass rates.** Three bar charts: cases passing by test (baseline and candidate bars with a
   baseline), runs passing by mode with the 95% interval band, and failed checks by check type. Hover a
   bar for its numbers.
4. **Zone 2, Tests.** One row per test, worst first: a pass or fail chip, the title, spec id and target,
   cases and runs passing, and up to six columns of failed checks per check family (the rest share an
   "other" column). With a baseline, how many cases regressed or improved. Filters: All, Failing, Passing,
   Regressed (with a baseline), and one per target when there are several. Open a test to see its cases:
   runs passing, the move against the baseline, the failed checks, and a link that filters the runs zone
   to that case (`#case-<n>`; the pill above the table clears it).
5. **Zone 3, Runs.** One row per run shown (failing runs first, up to `--max-runs`): status, test and case
   with the repeat, blocks, the first failed check, and latency when the adapter reports it. Filters: All,
   Failed, Passed. Click a row to open its **panel** with three tabs:
   * Conversation: every block in order, with what the user sent, the reply, each tool call with its input
     and output, the stage, the drift classes, every check that did not pass and every judged verdict with
     its evidence and the judge's reasoning; the checks that passed are folded.
   * Checks: the verdicts with evidence, and where a verdict stopped the run.
   * Run data: target, mode, perturbation and deviation, repeat, status, start time, cost, first drift,
     drifting blocks, end state (matches, differs or not compared, with the difference), recovery (label,
     turns, collateral), where a carried run came from, and any error.
   The page says how many runs the run limit left out.
6. **All details.** Every table behind the numbers, each folded under its heading: Campaign facts,
   Summary (tiles with intervals: the suite pass rate per mode, the mean over goldens with its hierarchical
   interval, n_eff, the detectable drop and the share of runs without a verdict; runs passing and block
   accuracy per mode, end state match, tool F1,
   immediate recovery, compounding index, cost and latency per block), Baseline and candidate (the full
   comparison: paired table, McNemar, Newcombe effect, Wilcoxon on drift, the criteria with
   Benjamini-Hochberg q, new flags, goldens that changed, goldens not paired), Reliability per golden
   (pass^k and pass@k with intervals, unreliability), Criteria across repeats, Blocks and their succession
   (drift classes, first drift, longest clean, and per mode the suite pass rate column), Compounding index (T minus F, in points), Recovery after a
   deviation (immediate, late, never, collateral, safe action, clarified, with Wilson intervals), Spread
   (cell rates, worst and undecided cells, wording ranges, judge flip rate), Variance pilot (with
   `--pilot`), Drilldown (the index of every run shown), and How the numbers are made.

Every interval is two-sided at 95%. The statistics behind them are in `results-statistics`; the drift
and recovery records in `results-drift-recovery`.

### The suite pass rate and n_eff on the page

The "Suite pass rate, <mode>" tile is the suite headline of that mode: the mean over goldens, its
hierarchical interval, then a note such as `6 goldens, n_eff 5.0 runs (design effect 2.40), no drop
detectable at 80% power`. Every golden weighs the same in the mean, whatever its repeats. The same cell is
the "suite pass rate" column of the mode table in "Blocks and their succession". Quote this number for the
suite; the "Runs passing" tile pools every run.

A rate over clustered runs, such as "Runs passing" or "Block accuracy", prints `n_eff 5.0 (design effect
2.40)` beside its interval when its runs disagree. `n_eff` is the independent runs the clustered runs are
worth; the design effect is the runs divided by `n_eff`. "How the numbers are made" explains each method:
"Hierarchical" for the suite pass rate, "Wilson on n_eff" for a rate that prints `n_eff`.

## Worked example

```sh
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --store acme.db --campaign c-base
driftbench report c-base --store acme.db --pilot examples/acme/pilot/acme-random --by behaviour --out card.html
driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --mode T,F,P --repeats 2 --baseline c-base --store acme.db --out x3.json # exit 1
driftbench report --store acme.db --baseline c-base --out x3.html
```

```text
$ driftbench report c-base --store acme.db --pilot examples/acme/pilot/acme-random --by behaviour --out card.html
Margin auto: 14.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 14.3 points).
Campaign c-base: 46 runs, 46 pass, 0 fail, 0 did not complete.
Suite pass rate, mode T: 100.0% [65.3%, 100.0%] (hierarchical 95% interval); 6 goldens, n_eff 6.0 runs (every run agrees, so each golden counts once), detectable drop 71.7 points at 80% power.
Suite pass rate, mode F: 100.0% [65.3%, 100.0%] (hierarchical 95% interval); 6 goldens, n_eff 6.0 runs (every run agrees, so each golden counts once), detectable drop 71.7 points at 80% power.
Suite pass rate, mode P: 100.0% [78.5%, 100.0%] (hierarchical 95% interval); 11 goldens, n_eff 11.0 runs (every run agrees, so each golden counts once), detectable drop 50.6 points at 80% power.
Wrote card.html.
```

The fault campaign read against `c-base`:

```text
$ driftbench report --store acme.db --baseline c-base --out x3.html
Margin auto: 14.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 14.3 points).
Campaign c-fbe8e929332e: 46 runs, 20 pass, 26 fail, 0 did not complete.
Suite pass rate, mode T: 50.0% [18.7%, 81.3%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 2.40), no drop detectable at 80% power.
Suite pass rate, mode F: 50.0% [18.7%, 81.3%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 2.40), no drop detectable at 80% power.
Suite pass rate, mode P: 36.4% [14.7%, 64.0%] (hierarchical 95% interval); 11 goldens, n_eff 10.0 runs (design effect 2.20), no drop detectable at 80% power.
Against baseline c-base: regressed, margin 14.5 points.
Wrote x3.html.
```

`card.html` now holds the overview, the three zones and the folded details: the campaign ran T, F and P,
so the compounding index and the recovery tables are filled, and `--pilot` adds the variance pilot of the
seeded random control. The second report adds the Versions zone and the regressed counts against
`c-base`. Open either file in a browser; nothing loads from the network.

## Common errors

| Symptom | Cause and fix |
|---|---|
| no Versions zone, no "cases regressed" number | pass `--baseline <campaign>` |
| a run panel does not open from a link | the address must be `#run-<runId>` of a run the page shows; raise `--max-runs` |
| no "Compounding index" section | the campaign did not run both T and F. Run `--mode T,F` |
| no "Recovery after a deviation" section | no mode P, or no perturbation sets `recovery` |
| a pass^k cell shows a range instead of a value, line marked incomplete | some runs did not complete; their outcome is unknown, so the interval covers both ends. `--withhold-incomplete` drops the value |
| "No interval: one golden" in the compounding total | a bootstrap over one cluster has no width; run more goldens |
| the suite pass rate tile reads `no interval: one cluster` and `1 golden` | the mode ran one golden: there is no spread between goldens to measure. Run more specs |
| the suite pass rate is lower than "Runs passing" | the suite rate weighs every golden the same; "Runs passing" weighs every run. A golden with fewer repeats and a different outcome moves them apart |
| the Runs zone says runs were left out by the run limit | raise `--max-runs` |
| `--pilot` fails with a message about the pilot report (exit 2) | give the `pilot-report.json` file or the folder that holds it |
