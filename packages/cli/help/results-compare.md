---
title: "Compare two campaigns"
summary: "Pair a candidate campaign with a baseline golden by golden and get a non-inferiority verdict with an exit code."
commands:
  - compare
see_also:
  - results-ci
  - results-statistics
  - results-report
  - results-exports
next:
  - results-ci
---

## What it is

`driftbench compare` reads two campaigns of one store, a baseline and a candidate, pairs them on the
goldens both ran, and decides whether the candidate is non-inferior to the baseline within a margin.

* A golden is one spec in one mode (one perturbation in mode P), over every repeat. It passes when every
  repeat passes. Repeats are never counted as independent pairs.
* Pairs are clustered by golden. The repeats of one golden collapse into one pass or fail before the
  paired tests, so a golden with ten repeats counts once. The pass rate printed for each side is a rate
  over goldens, not over runs. Where `report` prints a rate over clustered runs, it reads the design effect
  from the same grouping (`results-statistics`).
* A criterion is a machine verdict family (`must`, `tools`, `stage`, `forbidden`, ...) or one judged
  criterion. It passes in a golden when every decided occurrence over every repeat passes.
* The verdict is one of three:

| Verdict | Exit | Means |
|---|---|---|
| `NON-INFERIOR` | 0 | the all-pass flag and every gating criterion that is not underpowered have a 95% upper bound on the drop below the margin, and no flag family (`safety`, `forbidden`, `pii`) fires on the candidate where it did not on the baseline |
| `REGRESSED` | 1 | evidence of a drop: a new gating flag, a criterion whose regression Benjamini-Hochberg keeps, or the all-pass McNemar test below 0.05 with more goldens regressed than improved |
| `NOT SHOWN NON-INFERIOR` (JSON: `unproven`) | 1 | no evidence of a drop, but an interval is wider than the margin: too few goldens, never a regression |

Exit 2 is bad input. `driftbench ci` applies the same rule and gives the same exit code on the same pair
of campaigns.

## When to use it

* Before shipping a new agent version: run the same specs on both versions into one store, then compare.
* To read a comparison again with another margin, mode set or minimum, with no run: `compare` only reads.
* To judge, reply by reply, which version better meets one criterion (`--pairwise`, calls a model).

To run the candidate and compare in one step, in CI, use `driftbench ci`.

Do not quote the per side rate of `compare` as the pass rate of a suite. It counts each golden once as
passing or failing, over the goldens both campaigns ran. The rate to quote for one campaign is the suite
headline of `driftbench report`: the mean of the golden pass rates, with its hierarchical interval and
`n_eff` (see `results-statistics`).

## Commands and every option

```
driftbench compare --baseline <campaign> --candidate <campaign> --store <file> [options]
```

| Option | Default | Meaning |
|---|---|---|
| `--baseline <campaign>` | required, unless `--rank` | the baseline campaign id |
| `--candidate <campaign>` | required, unless `--rank` | the candidate campaign id |
| `--store <file>` | required | the store that holds both campaigns |
| `--margin <points\|auto>` | `auto` | the largest drop in pass rate tolerated, in percentage points, above 0 and below 100, such as `2`. `auto`: the smallest half point at which the baseline compared with itself is non-inferior, printed with what sets it; above 15 points it warns |
| `--min-goldens <n>` | `30` | a gating criterion decided on fewer goldens is underpowered: reported, and left out of the parity test |
| `--strict` | off | underpowered criteria gate too |
| `--mode <modes>` | every mode both ran | compare only these modes, such as `F` or `T,F` |
| `--q <rate>` | `0.05` | the false discovery rate of Benjamini-Hochberg across criteria, between 0 and 1 |
| `--json` | off | print one JSON document instead of the text |
| `--pairwise <criterion.yaml>` | none | also judge, for every block both campaigns ran, which reply better meets this criterion, in both orders. The file holds `name` and `rubric`, optionally `pass` and `fail`. Calls a model |
| `--pairwise-judge <kind>` | `openai` | the judge of the pairwise calls: `openai`, `anthropic`, `google`, or a judge a plugin registered. Its key is read from the environment |
| `--pairwise-reference <file>` | none | judge which reply matches the reference answer in this file better, instead of which reply is better |
| `--pairwise-contract <contract>` | `winner` | `winner`: the judge names the better reply. `ledger`: the judge scores each requirement for both replies and code decides |
| `--pairwise-presentation <order>` | `both-orders` | `both-orders`: judge each pair in both orders. `canonical`: one order fixed by content; position bias is not measured |
| `--pairwise-items <file>` | none | a YAML list of rubric items (`{ name, rubric, weight, hard }`) the judge scores for both replies |
| `--no-pairwise-audit` | audit on | turn off the reference fact audit and its ledger recovery |
| `--pairwise-config <config>` | none | `reader-first`: prefer the longer complete reply unless the judge finds supported failures in it (topic judging-pairwise) |
| `--judge-margin <n>` | `4` | with `reader-first`: the score advantage the shorter reply needs, 0 to 20 |
| `--feature-margin <n>` | `5` | with `reader-first`: the machine risk-flag gap |
| `--min-failures <n>` | `1` | with `reader-first`: the supported failures the longer reply needs |
| `--pairwise-preference <preference>` | none | `long-structured`: a declared preference for the longer structured reply, applied after the ledger verdict. Needs `--pairwise-contract ledger` |
| `--rank <campaigns...>` | none | rank three or more campaigns instead: wins per shared run, the Bradley-Terry order and every three-campaign cycle. `--baseline` and `--candidate` are then not needed |

`compare` never judges the stored runs again. The judge options below choose and shape the judge of
`--pairwise` (topic judging-pairwise):

* Without `--pairwise`, `--judge`, `--judges` and `--judge-route` are refused with exit 2. The other options
  of this table are accepted and change nothing.
* With `--pairwise` and none of those three, the pairwise judge is the one `--pairwise-judge` names,
  `openai` by default.

| Option | Default | Meaning |
|---|---|---|
| `--judge <kind:model>` | none | with `--pairwise`: the pairwise judge, such as `claude:haiku`. Kinds: claude, openai, anthropic, google, openai-decisions, jev, http. Repeat it for a council. Paid calls |
| `--judge-command <path>` | `claude` | the claude command a claude judge runs |
| `--judge-budget <usd>` | none | stop judging once the judges have spent this much |
| `--judges <cassette>` | none | with `--pairwise`: add every judge of this recording as a player: no call |
| `--judge-route <route>` | none | with `--pairwise`: `escalation`, route each call through a label-blind router |
| `--route-first <judge>` | none | with `--judge-route escalation`: the judge that answers first |
| `--route-then <judge>` | none | with `--judge-route escalation`: a judge asked when a trigger fires; repeatable |
| `--route-on <triggers>` | `order-split,inconclusive,reference-disagreement,low-confidence` | the escalation triggers, comma separated |
| `--route-confidence <p>` | `0.5` | the low-confidence bar, from 0 to 1 |
| `--route-decide <rule>` | `majority` | `majority` or `first-stands` |
| `--panel-weights <weights>` | none | a weighted panel of every judge; a thin margin abstains |
| `--panel-margin <share>` | `0.3` | with `--panel-weights`: the smallest winning margin, a share of the total weight |
| `--reference-solve <kind:model>` | none | solve each question blind first, and judge against the agreed answer |
| `--reference-samples <n>` | `5` | with `--reference-solve`: how many solves, from 1 to 20 |
| `--reference-route <route>` | none | with `--reference-solve`: `auto` solves only a question with one checkable answer |
| `--verify <kind>` | none | `arithmetic`: check explicit equations in the reply, in a bounded sandbox, before the judge reads it |
| `--prompt-budget <chars>` | none | drop the oldest transcript entries until the judge prompt fits; the last block stays |
| `--record <cassette>` | none | save every live judge answer as a cassette, to replay with `--judges` |
| `--agent-family <family>` | none | the model family of the agent under test: a judge of that family is refused. `none` for no model |

Global: `--plugin <module>`. New flags always gate, and so does an underpowered criterion whose
regression Benjamini-Hochberg keeps. The pairwise line never changes the exit code; a pairwise judge
that gives no answer fails the command (exit 2) with its reason.

## Inputs

One store holding both campaigns. They should run the same specs (same spec hash) in the modes compared:
a golden only one side ran, or ran on another spec version, or that was carried from another campaign by a
blast radius run, is listed as not paired and never compared. So is a golden whose every run on one side
was not run (a Given the target cannot apply).

## Outputs and how to read them

The text output, top to bottom:

1. `Margin auto: ...`: the margin chosen and what set it (the all-pass flag or a criterion). A warning
   follows when it is above 15 points, naming the goldens a 15 point margin needs.
2. `Paired: <n> goldens ...; <n> goldens not paired. Margin <m> points.`
3. All-pass per golden: passing goldens and rate per side with a Wilson interval (each golden is one
   independent unit, so no design effect applies); the paired table
   (both pass, regressed, improved, both fail); `McNemar exact p`; the effect (baseline rate minus
   candidate rate, positive is a drop) with its Newcombe paired interval; a planning line: the smallest
   margin these goldens can show (the floor), the drop they detect at 80% power, and the goldens a 10
   point margin needs.
4. Drift count per golden, mean over repeats, with the Wilcoxon signed-rank p.
5. The criteria table. Columns: `gating`, `goldens` that decided it, `regressed`, `improved`, `p`
   (McNemar exact), `q` (Benjamini-Hochberg adjusted), `effect` and its `interval` in points, `margin`
   (`within` when the upper bound is below the margin, `underpowered` when it is not and the criterion
   has fewer than `--min-goldens` goldens, `not within` otherwise), `floor`, `drop seen`, `for 10`, and
   `verdict` (`regressed` when the false discovery rate control keeps the regression).
6. New gating flags, firing for the candidate only, when there are some.
7. `Not paired:`, one line per golden left out, with the reason. A golden not run on the candidate reads
   `not measured in the candidate: block <i> not run (<check>: <why>)`.
8. `Verdict: ...` and its reasons.

`compare` has no threshold for blocks not run. It decides on the paired goldens alone, so a golden not run
never changes its verdict. To fail on blocks not run, use `driftbench ci`, which exits 3
(`--max-not-run`) when nothing regressed.

`--json` prints the same as one object: `baseline`, `candidate`, `margin`, `alpha`, `q`, `minGoldens`,
`strict`, `flagFamilies`, `modes`, `pairs` (one per golden with each side's runs, all-pass, drift and
criteria), `unpaired`, `allPass`, `drift`, `criteria`, `newFlags`, `verdict` and `reasons`, plus
`pairwise` with `--pairwise`.

## Worked example

Two clean campaigns of the Acme sales assistant, the second under another agent version label. No model
is called.

```sh
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --store acme.db --campaign c-base
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --agent-version acme-v2 --store acme.db --campaign c-next
driftbench compare --baseline c-base --candidate c-next --store acme.db
driftbench compare --baseline c-base --candidate c-next --store acme.db --mode F --margin 10 # exit 1
driftbench compare --baseline c-base --candidate c-next --store acme.db --strict --q 0.1 --json
```

The first comparison, at the automatic margin:

```text
$ driftbench compare --baseline c-base --candidate c-next --store acme.db
Margin auto: 14.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 14.3 points).
Baseline c-base (function:acme-sales) against candidate c-next (function:acme-sales (variant acme-v2)).
Paired: 23 goldens (one golden in one mode, one perturbation in P), modes T, F, P; 0 goldens not paired. Margin 14.5 points.

All repeats pass, per golden:
  side       passing   rate    95% interval
  baseline   23 of 23  100.0%  [85.7%, 100.0%]
  candidate  23 of 23  100.0%  [85.7%, 100.0%]
  Both pass 23, regressed 0, improved 0, both fail 0. McNemar exact p = 1.0000.
  Effect, baseline minus candidate: 0.0 points, interval [-14.3, +14.3] (Newcombe, paired).
  Planning: 23 goldens can show a margin of 14.3 points at best; they detect a drop of 30.6 points at 80% power; a 10 point margin needs 35 goldens.
Drift count per golden (mean over repeats): baseline 0.00, candidate 0.00; Wilcoxon signed-rank p = 1.0000 (exact, 0 goldens differ).

Criteria: McNemar exact per criterion, Benjamini-Hochberg across 13 criteria at q 0.05. Effect in points, baseline minus candidate. A gating criterion on fewer than 30 goldens is underpowered and left out of the parity test. Floor: the smallest margin its goldens can show; drop seen: the smallest drop they detect at 80% power; for 10: the goldens a 10 point margin needs.
  criterion  gating  goldens  regressed  improved  p       q       effect  interval        margin        floor  drop seen    for 10  verdict
  budget     yes     7        0          0         1.0000  1.0000  0.0     [-35.4, +35.4]  underpowered  35.4   67.6 points  35
  cards      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  end_state  yes     12       0          0         1.0000  1.0000  0.0     [-24.2, +24.2]  underpowered  24.2   49.3 points  35
  flow       yes     1        0          0         1.0000  1.0000  0.0     [-79.3, +79.3]  underpowered  79.3   none         35
  forbidden  yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  guards     yes     9        0          0         1.0000  1.0000  0.0     [-29.9, +29.9]  underpowered  29.9   59.0 points  35
  lang       yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  ledger     yes     19       0          0         1.0000  1.0000  0.0     [-16.8, +16.8]  underpowered  16.8   35.5 points  35
  must       yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  must_not   yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  pii        yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  stage      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35
  tools      yes     23       0          0         1.0000  1.0000  0.0     [-14.3, +14.3]  within        14.3   30.6 points  35

Verdict: NON-INFERIOR.
  budget: underpowered, decided on 7 goldens (fewer than 30); left out of the parity test, --strict puts it back
  end_state: underpowered, decided on 12 goldens (fewer than 30); left out of the parity test, --strict puts it back
  flow: underpowered, decided on 1 golden (fewer than 30); left out of the parity test, --strict puts it back
  guards: underpowered, decided on 9 goldens (fewer than 30); left out of the parity test, --strict puts it back
  ledger: underpowered, decided on 19 goldens (fewer than 30); left out of the parity test, --strict puts it back
  every gating criterion and the all-pass flag have an upper bound below the margin 14.5 points, and no new gating flag
```

Nothing changed, and the verdict is non-inferior at 14.5 points: 23 goldens cannot show a tighter margin
(the floor is 14.3). The planning line says a 10 point margin needs 35 goldens. On mode F alone there are
6 goldens, and a 10 point margin cannot be shown:

```text
$ driftbench compare --baseline c-base --candidate c-next --store acme.db --mode F --margin 10
Baseline c-base (function:acme-sales) against candidate c-next (function:acme-sales (variant acme-v2)).
Paired: 6 goldens (one golden in one mode, one perturbation in P), modes F; 0 goldens not paired. Margin 10.0 points.

All repeats pass, per golden:
  side       passing  rate    95% interval
  baseline   6 of 6   100.0%  [61.0%, 100.0%]
  candidate  6 of 6   100.0%  [61.0%, 100.0%]
  Both pass 6, regressed 0, improved 0, both fail 0. McNemar exact p = 1.0000.
  Effect, baseline minus candidate: 0.0 points, interval [-39.0, +39.0] (Newcombe, paired).
  Planning: 6 goldens can show a margin of 39.0 points at best; they detect a drop of 72.7 points at 80% power; a 10 point margin needs 35 goldens.
Drift count per golden (mean over repeats): baseline 0.00, candidate 0.00; Wilcoxon signed-rank p = 1.0000 (exact, 0 goldens differ).

Criteria: McNemar exact per criterion, Benjamini-Hochberg across 12 criteria at q 0.05. Effect in points, baseline minus candidate. A gating criterion on fewer than 30 goldens is underpowered and left out of the parity test. Floor: the smallest margin its goldens can show; drop seen: the smallest drop they detect at 80% power; for 10: the goldens a 10 point margin needs.
  criterion  gating  goldens  regressed  improved  p       q       effect  interval        margin        floor  drop seen    for 10  verdict
  budget     yes     2        0          0         1.0000  1.0000  0.0     [-65.8, +65.8]  underpowered  65.8   none         35
  cards      yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35
  end_state  yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35
  forbidden  yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35
  guards     yes     2        0          0         1.0000  1.0000  0.0     [-65.8, +65.8]  underpowered  65.8   none         35
  lang       yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35
  ledger     yes     5        0          0         1.0000  1.0000  0.0     [-43.4, +43.4]  underpowered  43.4   78.5 points  35
  must       yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35
  must_not   yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35
  pii        yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35
  stage      yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35
  tools      yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  underpowered  39.0   72.7 points  35

Verdict: NOT SHOWN NON-INFERIOR.
  all-pass: the upper bound 39.0 points of the regression effect is not below the margin 10.0 points
  budget: underpowered, decided on 2 goldens (fewer than 30); left out of the parity test, --strict puts it back
  cards: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  end_state: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  forbidden: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  guards: underpowered, decided on 2 goldens (fewer than 30); left out of the parity test, --strict puts it back
  lang: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  ledger: underpowered, decided on 5 goldens (fewer than 30); left out of the parity test, --strict puts it back
  must: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  must_not: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  pii: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  stage: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
  tools: underpowered, decided on 6 goldens (fewer than 30); left out of the parity test, --strict puts it back
(exit 1)
```

That exit 1 is "not shown non-inferior", not a regression: add goldens, not repeats. The JSON form starts:

```text
$ driftbench compare --baseline c-base --candidate c-next --store acme.db --strict --q 0.1 --json
{
  "baseline": {
    "campaignId": "c-base",
    "targets": [
      "function:acme-sales"
    ]
  },
  "candidate": {
    "campaignId": "c-next",
    "targets": [
      "function:acme-sales (variant acme-v2)"
    ]
  },
  "margin": 0.795,
  "alpha": 0.05,
  "q": 0.1,
  "minGoldens": 30,
  "strict": true,
  "flagFamilies": [
    "safety",
    "forbidden",
    "pii"
  ],
  "modes": [
    "T",
    "F",
    "P"
  ],
  "pairs": [
    {
```

A comparison with a real regression is in `results-ci`, where `driftbench ci` runs a planted fault.


### A golden not run on the candidate

The baseline runs a tool failure conversation and a price sheet task on their own targets. The candidate runs
both on the `process` adapter, which cannot force a tool result, so the conversation is not run.

```sh setup
mkdir mixed
cp examples/acme/specs/conversations/tool-failure.yaml examples/acme/specs/tasks/price-sheet.yaml mixed
```

```sh
driftbench campaign run mixed --store mixed.db --campaign c-mixed-base
driftbench campaign run mixed --target process:acme-ops --store mixed.db --campaign c-mixed-ops # exit 3
driftbench compare --baseline c-mixed-base --candidate c-mixed-ops --store mixed.db --margin 80
```

```text
$ driftbench compare --baseline c-mixed-base --candidate c-mixed-ops --store mixed.db --margin 80
Baseline c-mixed-base (process:acme-ops, function:acme-sales) against candidate c-mixed-ops (process:acme-ops).
Paired: 1 golden (one golden in one mode, one perturbation in P), modes F; 1 golden not paired. Margin 80.0 points.
...
Not paired:
  acme-tool-failure · F  not measured in the candidate: block 0 not run (capability: process declares toolStubs false: the agent would never see it)

Verdict: NON-INFERIOR.
  every gating criterion and the all-pass flag have an upper bound below the margin 80.0 points, and no new gating flag
```

The one paired golden passes on both sides, so the verdict is non-inferior and `compare` exits 0. The golden
not run is listed, not counted.

## Common errors

| Message | Cause and fix |
|---|---|
| `No campaign <id> in the store.` (exit 2) | a wrong id; both campaigns must be in `--store` |
| `No store at <path>: ...` (exit 2) | the store file does not exist |
| `--margin takes a number of points above 0 and below 100, such as 2` (exit 2) | the margin is in points |
| `--q takes a number between 0 and 1` (exit 2) | the false discovery rate is a proportion, such as `0.05` |
| `--min-goldens takes a whole number of at least 1` (exit 2) | give an integer |
| `Unknown mode "X"` (exit 2) | modes are `T`, `F`, `P`, separated by commas |
| `ENOENT ... criterion.yaml` (exit 2) | the `--pairwise` criterion file does not exist |
| `pairwise judge gave no answer: ...` (exit 2) | the provider failed or its key is missing from the environment |
| `--judge, --judges and --judge-route choose the pairwise judge: they go with --pairwise <criterion.yaml>.` (exit 2) | a judge option was given without `--pairwise`. `compare` judges nothing else: add `--pairwise <criterion.yaml>`, or drop the option |
| exit 1 with every golden passing on both sides | the verdict is not shown non-inferior: the margin is below what these goldens can show. Read the floor in the planning line; raise the margin or add goldens |
| goldens listed as not paired | the two campaigns ran different spec versions or modes, or the candidate carried them from a baseline |
| a golden not paired with `not measured in the candidate: block <i> not run` | the candidate's target cannot apply a layer of that spec's Given. It never changes the verdict; run the spec on a target that applies the layer |
| the per side rate differs from the `Suite pass rate` of `report` | expected: `compare` counts a golden as passing only when every repeat passes; the headline is the mean of the golden pass rates |
