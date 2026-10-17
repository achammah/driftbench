---
title: "Export results"
summary: "Every machine-readable output of the results commands, JSON, JUnit XML and the campaign bundle, and the fact that no results command writes CSV."
commands:
  - campaign export
see_also:
  - results-report
  - results-compare
  - results-ci
  - results-monitor
---

## What it is

Results leave driftbench in three forms:

| Form | Command and option | Where |
|---|---|---|
| scorecard JSON | `report --json` | standard output, the whole scorecard object |
| JUnit XML | `report --junit <file.xml>` | a file: one test suite per spec, one test case per run |
| comparison JSON | `compare --json` | standard output |
| CI summary JSON | `ci --out <file>` (default `driftbench-ci.json`), and `ci --json` on standard output | a file, always written unless the input is refused |
| radius JSON | `radius --json` | standard output: manifest and hash, totals per mode, every block with its state and reasons |
| radius manifest YAML | `radius auto --out <file>` | a file, or standard output without `--out` |
| monitor JSON | `monitor --json` | standard output |
| golden set manifest | `select` writes `<out>/golden.json`; `select --json` prints it | a file |
| holdout score JSON | `holdout score --json` | standard output |
| campaign status JSON | `campaign status --json` | standard output |
| campaign bundle | `campaign export <campaignId> --store <file> --out <dir>` | a folder `<dir>/<campaignId>` |

No results command writes CSV. CSV and spreadsheets are an input only (`driftbench import csv`,
`driftbench import xlsx`). To get a table, read a JSON output: each document is plain JSON with lists and
objects, no maps or sets.

## When to use it

`--json` to feed another program or an agent; `--junit` for a CI system that reads JUnit; `ci --out` for
the pull request gate; `campaign export` to move one campaign, with its specs and versions, to another
machine or archive.

## Commands and every option

```
driftbench campaign export <campaignId> --store <file> --out <dir>
```

| Argument or option | Default | Meaning |
|---|---|---|
| `<campaignId>` | required | the campaign to write |
| `--store <file>` | required | the store that holds it |
| `--out <dir>` | required | the folder the bundle goes in, as `<dir>/<campaignId>` |

Global: `--plugin <module>`. The JSON options of the other commands are listed with them: `results-report`,
`results-compare`, `results-ci`, `results-radius`, `results-monitor`, `results-select`, `results-holdout`.

## Inputs

A store holding the campaign.

## Outputs and how to read them

* `campaign export` also writes the exact files of the dataset and prompt versions the campaign records.
* `campaign export` writes `<dir>/<campaignId>/` with `campaign.json`, `manifest.json` (format, schema
  version, counts, and a SHA-256 hash of every file), `runs/<runId>.json` and `specs/`.
* `report --json`: `campaign`, `modes`, `lines` (reliability per golden), `endState`, `tools`, `cost`,
  `compounding`, `recovery` and `recoveryByClass` (with mode P), `drift`, `criterionRepeats`, `spread`,
  `drilldown`, `omittedRuns` and, with options, `compare` (`--baseline`), `pilot` (`--pilot`) and
  `aggregates` (`--aggregate` or a config). Each entry of `modes` holds `headline`, the suite headline
  of that mode: `estimate`, `lower`, `upper`, `method` (`hierarchical`, or `none` with one golden),
  `trees`, `runs`, `pooledRate`, `effectiveRuns`, `designEffect`, `degenerate`, `detectableDrop` (a
  proportion, or `null`) and `shares` (`incomplete`, `blocked`, `notRun`). A rate with the method
  `wilson, design effect` carries `designEffect` and `effectiveN`. `results-statistics` reads each one.
* `compare --json`: `baseline`, `candidate`, `margin`, `alpha`, `q`, `minGoldens`, `strict`,
  `flagFamilies`, `modes`, `pairs`, `unpaired`, `allPass`, `drift`, `criteria`, `newFlags`, `verdict`,
  `reasons`.
* `ci` summary: `verdict`, `exitCode`, `reasons`, `aggregates`, `marginPoints`, `marginAuto`, `marginDefaulted`,
  `minGoldens`, `strict`, `underpowered`, `comparator`, `flags`, `baseline`, `candidate`, `pairs`, `table`,
  `effectPoints`, `smallestMarginPoints`, `criteriaNotShown`, `regressed`, `improved`, `newFlags`,
  `unpaired`, `rows`, and `radius` with `--change`.

Rates are proportions from 0 to 1 in JSON (`0.9` is 90%); the `ci` summary's `*Points` fields are in
percentage points.

## Worked example

```sh
driftbench campaign run examples/acme/specs/conversations --store out.db --campaign c-out
driftbench report c-out --store out.db --out card.html --junit card.xml --json
driftbench campaign export c-out --store out.db --out bundle
driftbench campaign status c-out --store out.db --json
```

The scorecard JSON begins:

```text
$ driftbench report c-out --store out.db --out card.html --junit card.xml --json
{
  "campaign": {
    "campaignId": "c-out",
    "createdAt": "2026-10-14T14:03:25.360Z",
    "targets": [
      "function:acme-sales"
    ],
    "modes": [
      "F"
    ],
    "repeats": {
      "T": 0,
      "F": 1,
      "P": 0
    },
    "budgetUsd": 0,
    "specs": 6,
    "runs": 6,
    "passing": 6,
    "failing": 0,
    "broken": 0
  },
  "modes": [
    {
      "mode": "F",
      "lines": 6,
      "runs": 6,
      "runPass": {
        "estimate": 1,
        "lower": 0.6096657120978346,
```

The export:

```text
$ driftbench campaign export c-out --store out.db --out bundle
Exported campaign c-out to bundle/c-out: 6 runs, 6 specs, 0 sources.
```

## Common errors

| Message | Cause and fix |
|---|---|
| `No campaign <id> in the store.` | wrong id |
| `No store at <path>: ...` (exit 2) | the store file does not exist |
| looking for a CSV option | none exists; convert the JSON |
| `report --json` printed no summary lines | expected: with `--json` the JSON replaces the summary lines |
