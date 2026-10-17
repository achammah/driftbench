# Campaign-level criteria

A campaign-level criterion scores one number over every run of a campaign together, then compares it with a threshold. A block check or a per-run verdict cannot express a rule such as "at least 80 percent of runs pass" or "at most 20 percent of runs break". This page covers the library API and the `--aggregate` flag on `driftbench report` and `driftbench ci`.

## The shape

```ts
type AggregateCriterion = {
  name: string;
  direction: 'at-least' | 'at-most';
  threshold: number;
  measure: (data: CampaignData) => number | undefined;
};
```

`measure` reads the whole campaign, so any function of its runs fits. `evaluateAggregates(data, criteria)` returns one result per criterion, in order: `name`, `direction`, `threshold`, `value`, `passed` and `reason`.

## Built-in criteria

* `BUILT_IN_AGGREGATES.passRate(threshold = 0.5)`: the share of all runs that pass. A run passes when it completed, every block passed and its end state matched. Direction: at least.
* `BUILT_IN_AGGREGATES.brokenShare(threshold)`: the share of runs that did not complete, failed or stopped. Direction: at most.

## Interval and planning

A rate criterion (`pass-rate`, `broken-share`) also gives a 95% interval of its rate. The repeats of one golden resemble each other, so the runs are not independent evidence. The interval is the one the scorecard prints for a pass rate over goldens, the Wilson interval on the effective number of runs ([statistics](concepts/statistics.md#intervals)): the runs divided by the design effect that the spread between goldens implies, with the Student t quantile on the goldens less one. It is wider than a Wilson interval on the runs when goldens disagree, and it is the same width when they agree. A golden is one spec on one target in one mode, with one perturbation in mode P. When every run agrees (all pass or all fail) there is no spread to measure, so each golden counts once. With one golden, or one run in every golden, the interval is the plain Wilson interval on the runs: the spread between goldens cannot be measured, or the runs are the goldens. The method is written out in [statistics](concepts/statistics.md#a-rate-over-goldens).

The interval decides the threshold when it lies entirely on one side of it. When it does not, `runsNeeded` is the number of runs that would decide it. Over several goldens, more repeats of the same goldens do not help, so the number comes with `goldensNeeded`: the goldens, a whole number of copies of the present ones (same pass rate, same spread), whose interval would decide it, and `runsNeeded` is the runs of those goldens. With one golden, `runsNeeded` is the number of runs at the same rate. `report` prints both; the `ci` summary carries them in its `aggregates` field, and the GitHub Action writes them to the job summary.

The `interval` of a result holds `lower`, `upper`, `n` (the runs) and `method`: `wilson`, `wilson, design effect` or `wilson, clusters`. Over several goldens it also holds `clusters` (the goldens), and for `wilson, design effect` the `designEffect` and the `effectiveRuns` the goldens are worth. A custom criterion that gives `counts` without `clusters` keeps the plain Wilson interval; adding `clusters` (the successes and runs of each golden) gives it the interval above.

## Inconclusive, not failed

A campaign with no runs gives `value` and `passed` undefined, with the reason `no runs in the campaign: inconclusive`. Nothing is reported as a failure from an empty campaign.

## In the scorecard

`buildScorecard(data, { aggregates: [...] })` adds an `aggregates` array to the scorecard. Without the option the field is absent, so existing scorecards do not change.

```ts
const card = buildScorecard(data, { aggregates: [BUILT_IN_AGGREGATES.passRate(0.8)] });
card.aggregates?.[0]; // { name: 'pass-rate', value: 0.75, passed: false, ... }
```

The example value is illustrative: three passing runs and one failing run in a four-run campaign give 0.75, which is below 0.8. The behaviour is pinned by `packages/report/test/aggregate.test.ts`.

## On the command line

`--aggregate <name>:<op><threshold>` is repeatable on `driftbench report` and `driftbench ci`. The operator sets the direction: `>=` is at-least, `<=` is at-most. The built-in names are `pass-rate` and `broken-share`.

```text
driftbench report c-x3 --store store.db --out card.html --aggregate pass-rate:>=0.99
aggregate pass-rate >= 0.99: fails (0.75 >= 0.99)
```

`report` prints each result and still exits 0. `ci` exits 1 when any aggregate fails, and its verdict becomes `AGGREGATE FAILED`, unless the verdict was already incomplete. An aggregate with no runs is inconclusive and does not fail the gate. A flag it cannot read exits 2 before any campaign loads.

The `driftbench ci` GitHub Action takes the same criteria in its `aggregate` input, one `name:op threshold` per line. A failing one gives the job the verdict `aggregate-failed` and fails it.

Aggregates can also be declared in `driftbench.yaml`, under `aggregates:`, read by `report` and `ci`. A flag with the same name replaces the file's entry. See [running](running.md#project-config-and-the-pull-request-gate).
