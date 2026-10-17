---
title: Compare two versions of an agent
summary: Run the same suite on two agent versions. Decide with compare whether the new one is no worse. Read the diff in a scorecard, and watch the versions over time with monitor.
commands:
  - campaign run
  - compare
  - ci
  - report
  - monitor
see_also:
  - recipes-gate-in-ci
  - recipes-test-a-chat-agent
  - core-exit-codes
next:
  - recipes-red-team-an-agent
---

## Goal

You changed your agent: a new prompt, a new model, a new tool. You want to know whether the new version is
no worse than the old one, by a margin you name, with the uncertainty stated, and to see a slow slide across
many versions.

The chain is: run the same suite on each version into one store, one campaign per version; `compare` pairs
the goldens both campaigns ran and gives a non-inferiority verdict; `report --baseline` puts the diff in a
scorecard; `monitor` reads every campaign of the store as a time series and alarms on a shift.

A golden is one spec in one mode (and one perturbation in mode P), with every repeat of it. A golden passes
when every repeat passes. Repeats are never counted as independent pairs.

## Before you start

* A checkout of driftbench, built: `pnpm install`, then `pnpm build`. Run every command from the repository
  root as `pnpm -s driftbench <command>`. See `driftbench help core-getting-started`.
* A suite: here the six Acme conversation specs, `examples/acme/specs/conversations`, on the sales assistant
  `function:acme-sales`. It is deterministic code: no model, no key, no network.
* Two versions. The Acme agent has one version, so steps 1 and 2 run the same code under two labels; with
  your agent, version 2 is the changed build. Step 5 needs a version that is worse: the planted fault
  `fault:x3-skips-recap` of `examples/acme/faults` stands in for it. A fault target runs through `ci`, which
  takes `--faults`; `campaign run` does not.
* Every command below runs with no model and no key, and writes only new files in the folder you run it in.

## Steps

### 1. Run version 1

Each version is one campaign in the same store, so `compare` and `report` can read both.

```sh
driftbench campaign run examples/acme/specs/conversations --target function:acme-sales \
  --agent-version v1 --repeats 3 --store versions.db --campaign v1
```

```text
Campaign v1: 18 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, ...
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
...
✓ acme-tool-failure · function:acme-sales · F · repeat 2  pass  3 blocks
18 cells: 18 pass, 0 fail, 0 failed. Spent $0.00.
```

`--agent-version <label>` names the version under test. It goes into every block cache key and becomes the
target's variant, so `compare` prints `function:acme-sales (variant v1)`. Without it, the cache of the store
cannot see an agent change behind the same target: a second campaign would replay the first one's runs. Bump
the label on every change, or pass `--no-cache`. `--campaign` names the campaign so later commands can refer
to it; `--repeats 3` runs each spec three times.

### 2. Run version 2

The same suite, the same target, a new label.

```sh
driftbench campaign run examples/acme/specs/conversations --target function:acme-sales \
  --agent-version v2 --repeats 3 --store versions.db --campaign v2
```

```text
18 cells: 18 pass, 0 fail, 0 failed. Spent $0.00.
```

When the two versions are two deployments rather than two builds behind one target, give each campaign its
own `--target`. `compare` pairs goldens by spec and mode, not by target: step 5 pairs a fault target with
`function:acme-sales`.

### 3. Compare them

`compare` pairs the goldens both campaigns ran and asks whether the candidate's drop in pass rate stays
under the margin.

```sh
driftbench compare --baseline v1 --candidate v2 --store versions.db
```

```text
Margin auto: 39.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 39.0 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 39.0 points); about 22 goldens would.
Baseline v1 (function:acme-sales (variant v1)) against candidate v2 (function:acme-sales (variant v2)).
Paired: 6 goldens (one golden in one mode, one perturbation in P), modes F; 0 goldens not paired. Margin 39.5 points.

All repeats pass, per golden:
  side       passing  rate    95% interval
  baseline   6 of 6   100.0%  [61.0%, 100.0%]
  candidate  6 of 6   100.0%  [61.0%, 100.0%]
  Both pass 6, regressed 0, improved 0, both fail 0. McNemar exact p = 1.0000.
  Effect, baseline minus candidate: 0.0 points, interval [-39.0, +39.0] (Newcombe, paired).
  Planning: 6 goldens can show a margin of 39.0 points at best; they detect a drop of 72.7 points at 80% power; a 10 point margin needs 35 goldens.
Drift count per golden (mean over repeats): baseline 0.00, candidate 0.00; Wilcoxon signed-rank p = 1.0000 (exact, 0 goldens differ).

Criteria: McNemar exact per criterion, Benjamini-Hochberg across 12 criteria at q 0.05. ...
  criterion  gating  goldens  regressed  improved  p       q       effect  interval        margin        floor  drop seen    for 10  verdict
  budget     yes     2        0          0         1.0000  1.0000  0.0     [-65.8, +65.8]  underpowered  65.8   none         35
  cards      yes     6        0          0         1.0000  1.0000  0.0     [-39.0, +39.0]  within        39.0   72.7 points  35
  ...
Verdict: NON-INFERIOR.
```

How to read it:

* The all-pass block is the main test: McNemar on goldens that flipped, and the paired effect with its 95%
  interval. Non-inferior means the upper end of that interval, and of every gating criterion that is not
  underpowered, lies below the margin, and no flag family (`safety`, `forbidden`, `pii`) is new.
* `--margin <points|auto>`: the largest drop tolerated, in percentage points. `auto` (the default) is the
  smallest half point at which the baseline compared with itself is non-inferior. Six goldens cannot show
  less than 39 points.
* The planning line: the floor (the smallest margin these goldens can show), the drop they detect at 80%
  power, and the goldens a 10 point margin needs. The `for 10` column gives the same per criterion.
* `--min-goldens <n>` (default 30) marks a criterion decided on fewer goldens as underpowered; `--strict`
  makes it gate. `--q <rate>` (default 0.05) is the false discovery rate across criteria. `--mode` compares
  only some modes. `--json` prints one JSON document.
* Exit 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input.

### 4. Ask for a tighter margin

A margin is a claim you can afford only with enough goldens. At 10 points the same two campaigns are not
shown non-inferior.

```sh
driftbench compare --baseline v1 --candidate v2 --store versions.db --margin 10  # exit 1
```

```text
Paired: 6 goldens (one golden in one mode, one perturbation in P), modes F; 0 goldens not paired. Margin 10.0 points.
...
  Planning: 6 goldens can show a margin of 39.0 points at best; they detect a drop of 72.7 points at 80% power; a 10 point margin needs 35 goldens.
...
Verdict: NOT SHOWN NON-INFERIOR.
  all-pass: the upper bound 39.0 points of the regression effect is not below the margin 10.0 points
  ...
```

Not shown non-inferior is not a regression: nothing flipped. It means the suite is too small for the claim.
Grow it to the goldens the planning line names, not the repeats.

### 5. Compare a version that is worse

`ci` runs a candidate campaign into the store and compares it with a stored baseline in one step, by the
same rule as `compare`. Here the candidate is the fault that skips the recap and places the order unasked.

```sh
driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap \
  --faults examples/acme/faults --agent-version v3 --repeats 3 --baseline v1 --store versions.db \
  --out v3-ci.json  # exit 1
```

```text
driftbench ci: candidate fault:x3-skips-recap (campaign c-c88f6734e8df) against baseline campaign v1, compared as driftbench compare does (golden by golden, every repeat).
...
  goldens paired                               6
  both pass                                    3
  regressed                                    3
  new gating flags                             3
  all-pass regression effect                   +50.00 points
  95% interval                                 [+0.01, +81.24] points
  verdict                                      REGRESSION

Goldens that changed:
  golden                             baseline  candidate  change     new flags  candidate failing
  acme-number-porting · F            pass      fail       regressed  forbidden  block 3 forbidden.order.create, block 3 must.0, block 3 must.1
  acme-order-loose-confirmation · F  pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
  acme-plan-upgrade · F              pass      fail       regressed  forbidden  block 2 forbidden.order.create, block 2 must.0, block 2 must.1
...
Verdict: REGRESSION. Exit 1.
Summary: v3-ci.json
```

With `--baseline` a campaign id, the baseline must be in `--store`. Its campaign id is made from the content
and the clock; read it on the first line, or take it from `v3-ci.json` (`candidate.campaignId`). Run
`driftbench compare --baseline v1 --candidate <that id> --store versions.db` to get the full compare table
for it. `driftbench help recipes-gate-in-ci` covers every option of `ci`.

### 6. Read the diff in a scorecard

`report --baseline` adds the compare diff to the scorecard of a campaign. Without a campaign id it reads the
latest campaign of the store: the candidate of step 5.

```sh
driftbench report --store versions.db --baseline v1 --out v3-vs-v1.html
```

```text
Margin auto: 39.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 39.0 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 39.0 points); about 22 goldens would.
Campaign c-c88f6734e8df: 18 runs, 9 pass, 9 fail, 0 did not complete.
Suite pass rate, mode F: 50.0% [18.6%, 81.4%] (hierarchical 95% interval); 6 goldens, n_eff 5.0 runs (design effect 3.60), no drop detectable at 80% power.
Against baseline v1: regressed, margin 39.5 points.
Wrote v3-vs-v1.html.
```

Open `v3-vs-v1.html` in a browser: every metric with its interval, the diff against `v1`, and the per-block
drilldown, failing runs first (`--max-runs`, default 200). `--margin`, `--min-goldens` and `--strict` work as
in `compare`; `--junit <file.xml>` also writes JUnit XML. `report` exits 0 when written, whatever the verdict.

### 7. Watch the versions over time

`monitor` reads one value per campaign of the store, oldest first, and alarms when two of three drift
detectors (CUSUM, Page-Hinkley, a sliding KS test) agree. Add a fourth version first, the fix:

```sh
driftbench campaign run examples/acme/specs/conversations --target function:acme-sales \
  --agent-version v4 --repeats 3 --store versions.db --campaign v4
driftbench monitor --store versions.db --metric pass_rate  # exit 2
driftbench monitor --store versions.db --metric pass_rate --window 2  # exit 1
```

```text
The store holds 4 campaigns with runs; --window 20 needs at least 40. Nothing is wrong with the store: the monitor cannot decide on so few points. Run more campaigns into it, or pass a window that fits: --window 2 at most.

driftbench monitor: pass_rate over 4 campaigns of versions.db, oldest first. Window 2.
In control (the first 2): mean 100.0%, sd 1.0% (the floor of the metric). CUSUM k 0.5 sd, h 5 sd; Page-Hinkley delta 0.5 sd, lambda 5 sd; KS segments of 2, alpha 0.05 over the splits scanned.
  detector      first alarm  campaign        created                   direction  detail
  CUSUM         2            c-c88f6734e8df  2026-10-14T14:29:24.041Z  down       shift began at 2; 1 alarm in all
  Page-Hinkley  2            c-c88f6734e8df  2026-10-14T14:29:24.041Z  down       1 alarm in all
  KS            none                                                              largest D 0.50 at 2, p 1.0

Alert at 2 (2026-10-14T14:29:24.041Z), when CUSUM and Page-Hinkley had both alarmed.
Shift detected: 2 of 3 detectors alarmed. Exit 1.
```

`--metric` is `pass_rate`, `cost` or `latency` (the mean per run). The first `--window` campaigns (default 20)
set the in-control level, and the series needs twice as many, so a young store gets exit 2 with the largest
window it allows. Index 2 is the third campaign, the v3 candidate: both CUSUM and Page-Hinkley place the drop
there. `--series` prints every point with its statistics; `--json` prints one document with `alarm`, `votes`
and, on a shift, `alert`. Exit 0 no shift, 1 a shift, 2 bad input. `monitor --source traces <path>` reads
production traces instead of a store: see `driftbench monitor --help`.

### 8. Judge which reply is better, when you have a key

`compare --pairwise <criterion.yaml>` also asks a judge model, for every block both campaigns ran, which reply
better meets one criterion. It is a paid call, so it is shown and not run here. The criterion file holds a
`name` and a `rubric`. Load the key from a file you keep outside the repository:

```text
OPENAI_API_KEY="$(cat ~/.secrets/openai.key)" driftbench compare --baseline v1 --candidate v2 \
  --store versions.db --pairwise criterion.yaml --pairwise-judge openai
```

`--pairwise-judge` is `openai` (default), `anthropic` or `google`, each reading its key from the environment.
`--pairwise-reference <file>` asks which reply matches a reference answer instead. Each pair is judged in both
orders, so a judge that favours a position shows up. The pairwise line never changes the exit code.

## What you have at the end

* `versions.db`: one store with four campaigns, `v1`, `v2`, the v3 candidate, and `v4`.
* `v3-ci.json`: the summary of the v3 gate.
* `v3-vs-v1.html`: the scorecard of v3 with its diff against v1.
* A verdict for each pair you compared, and a monitor that placed the drop at v3.

To gate every change this way in CI, read `driftbench help recipes-gate-in-ci`.

## When a step fails

* `Campaign v1 already exists. Resume it with: driftbench campaign resume v1` (exit 2) from `campaign run`:
  the store holds that id. Pick a new name per version, or a new store.
* Version 2 shows exactly the runs of version 1 after a real change: the cache replayed them. Pass a new
  `--agent-version`, or `--no-cache`.
* `compare: the two campaigns share no golden in a shared mode` (exit 2): the two campaigns ran different
  specs or modes. Run both on the same suite and modes, or pass `--mode`.
* Verdict `NOT SHOWN NON-INFERIOR` with nothing regressed: the margin is below what the goldens can show.
  Read the planning line; add goldens or widen `--margin`.
* `monitor` exits 2 with `--window 20 needs at least 40`: the store has too few campaigns. Pass the window it
  names, or run more campaigns into it.
* `A fault:<id> target needs --faults <path>` (exit 2) from `ci`: pass `--faults examples/acme/faults`.
