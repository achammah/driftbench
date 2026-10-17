---
title: "Gate a change in CI"
summary: "Run the specs on a candidate, compare with a baseline campaign by the rule of compare, and exit 0 only on parity; the GitHub Action and workflow."
commands:
  - ci
see_also:
  - results-compare
  - results-radius
  - results-exports
  - results-statistics
  - running-not-run
next:
  - results-statistics
---

## What it is

`driftbench ci` is the pull request gate. In one command it:

1. reads the baseline campaign (before anything runs);
2. runs the specs on the candidate target and stores the candidate campaign in `--store`;
3. compares the two golden by golden with `compareCampaigns`, the rule `driftbench compare` applies;
4. scores any campaign-level criteria (`--aggregate`, or `aggregates:` in the config);
5. writes a JSON summary (`--out`, default `driftbench-ci.json`), prints a verdict table and exits.

| Verdict | Exit | When |
|---|---|---|
| `PARITY` (`parity`) | 0 | `compare` says non-inferior: the all-pass flag and every gating criterion that is not underpowered have a 95% upper bound below the margin, and no flag family is new on the candidate |
| `REGRESSION` (`regression`) | 1 | `compare` says regressed: a new gating flag, a criterion the false discovery rate control keeps, or the all-pass McNemar test below 0.05 with more goldens regressed than improved. It outranks every verdict but radius-miss, so blocks not run, an incomplete cell or a failing aggregate never hide it; the first reason names the regressed goldens |
| `NOT SHOWN NON-INFERIOR` (`not-shown-non-inferior`) | 1 | `compare` says unproven: an interval is wider than the margin. Too few goldens, never a regression |
| `INCOMPLETE` (`incomplete`) | 1 | a candidate cell did not run: stopped by `--budget-usd`, or pending, and nothing regressed |
| `AGGREGATE FAILED` (`aggregate-failed`) | 1 | a campaign-level criterion fails, unless the verdict is already regression, not-run or incomplete |
| `RADIUS MISS` (`radius-miss`) | 1 | with `--change --audit`: an audited carried cell differs from its stored run. It outranks every other verdict |
| `NOT RUN` (`not-run`) | 3 | a spec of the candidate has more of its blocks not run than `--max-not-run` allows (default 0: any block not run). A block not run is a Given the target cannot apply, never a pass. It outranks every verdict but radius-miss and regression. The verdict never depends on an unrelated spec not run: a regression gives `REGRESSION`, exit 1, with or without it. A golden that flipped while compare calls the change noise is no regression. Topic running-not-run has a worked example |
| none | 2 | bad input; nothing is run and nothing is written |

On the same pair of campaigns `ci` and `compare` give the same verdict and the same exit code.

## When to use it

On every pull request that changes an agent: a baseline campaign of the base branch, then `ci` on the head.
Locally, to check a change before pushing. With `--change`, to rerun only the blast radius of a declared
change and carry the rest (see `results-radius`).

## Commands and every option

```
driftbench ci --specs <path> --target <adapter[:agent]> --baseline <campaign|store> --store <file> [options]
```

| Option | Default | Meaning |
|---|---|---|
| `--specs <path>` | required | the spec file or folder the candidate runs |
| `--target <adapter[:agent]>` | required | the candidate target, such as `function:acme-sales`, or `fault:<id>` with `--faults` |
| `--baseline <campaign\|store>` | required | a store file (its latest campaign is the baseline), or a campaign id held in `--store`. Read before the candidate runs |
| `--store <file>` | required | the store the candidate campaign is written to |
| `--route <tag=target>` | none | run the specs a tag marks on another target, such as `flow:price-sheet=process:acme-ops`; repeatable. A route target can be a `fault:<id>` |
| `--process-command <command>` | none | the agent command for a `process:<name>` target other than `process:acme-ops`: a JSON list such as `["node","/abs/agent.mjs"]`, or words split on spaces. It runs in the sandbox workspace, so give absolute paths |
| `--margin <points\|auto>` | `auto` | the largest drop in pass rate tolerated, in points. `auto`: the smallest half point at which the baseline compared with itself is non-inferior |
| `--min-goldens <n>` | `30` | a gating criterion decided on fewer goldens is underpowered and left out of the parity test |
| `--strict` | off | underpowered criteria gate too |
| `--mode <modes>` | `F` | the run mode: `T`, `F` or `P`, or several separated by commas |
| `--repeats <n>` | `1` | runs per spec and mode |
| `--budget-usd <usd>` | none | a hard stop on the candidate campaign; a stopped cell makes the verdict incomplete |
| `--faults <path>` | none | a fault set (a module, or a folder whose index exports faults) whose faults a target can name as `fault:<id>`; required for a fault target |
| `--flag <family>` | `safety`, `forbidden`, `pii` | a verdict family whose failure is a gating flag; repeatable; replaces the default list |
| `--out <file>` | `driftbench-ci.json` | the JSON summary; a folder is refused |
| `--cache` | off | replay runs from the cache; off by default, so every cell runs the agent |
| `--concurrency <n>` | `4` | cells run at the same time |
| `--change <manifest>` | none | run only the blast radius of this change manifest and carry the other cells from the baseline, which must then be a campaign of `--store` |
| `--agent-version <label>` | none | the version of the candidate agent, as `campaign run` takes it; with `--change` it must be the manifest's `to` |
| `--audit <n>` | none | with `--change`: run n of the cells about to be carried and compare each with its stored run; one miss is `radius-miss` |
| `--audit-seed <n>` | `1` | with `--audit`: the seed of the draw |
| `--max-carry <n>` | `5` | with `--change`: the most campaigns in a row a result is carried |
| `--max-age <days>` | `7` | with `--change`: the most days since a carried result was measured |
| `--json` | off | print the JSON summary instead of the table |
| `--config <file>` | `driftbench.yaml` in the working folder | the project config: its `aggregates:` are scored, and its `campaign:` key gives `routes`, `modes`, `repeats`, `concurrency`, `budget_usd`, `process_command` and `agent_version` where no flag is given |
| `--max-not-run <share>` | `0` | the largest share of a spec's fresh blocks that may be not run before the verdict is `not-run`, exit 3, from 0 to 1. Raise it for an exploratory suite; the specs below it are still listed |
| `--aggregate <spec>` | none | a campaign-level criterion `name:op threshold`, such as `pass-rate:>=0.8`; repeatable; a failing one fails the gate |

Global: `--plugin <module>` loads a plugin, which can register an adapter for your own agent.

Judging and the checks take the same options as `campaign run`, with the same defaults (topics judging-council and judging-machine-checks):

| Option | Default | Effect |
|---|---|---|
| `--judge <kind:model>` | none | judge the judged criteria with this judge, such as `claude:haiku`. Kinds: claude, openai, anthropic, google, openai-decisions, jev, http. Repeat it for a council. Paid calls |
| `--judge-command <path>` | `claude` | the claude command a claude judge runs |
| `--judge-budget <usd>` | none | stop judging once the judges have spent this much |
| `--judges <cassette>` | none | add every judge of this recording as a player: no call |
| `--judge-mode <mode>` | from the judge classes | the council mode: `system1`, `hybrid` or `llm` |
| `--assignments <file>` | none | the council assignment table `judge calibrate` wrote |
| `--cascade` | off | run the cheapest judge first and stop on a sure pass |
| `--weights <weights>` | none | council vote weights, `judge=weight,...` or a YAML file |
| `--judge-route <route>` | none | `escalation`: route each call through a label-blind router |
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
| `--agent-family <family>` | not set | the model family of the agent under test: a judge of that family is refused. `none` for no model |
| `--owner <values...>` | none | the owner's own email, phone, IBAN or national number, left out by the `pii` check |
| `--owner-file <file>` | none | owner values for the `pii` check, one per line; `#` starts a comment |
| `--tool-policy <rules>` | none | a YAML list of `{ pattern, action: allow \| deny \| ask }`; a denied call fails its block's `tool_policy` check |
| `--embedder <name>` | none | the embedder the `similarity` check scores with, as a plugin registered it |

### The GitHub Action

`action/action.yml` at the repository root is a composite action around this command. Inputs (default):
`specs`, `target`, `baseline` (required), `store` (`.driftbench/ci.db`), `margin` (`auto`), `min-goldens`
(`30`), `strict` (`false`), `repeats` (`1`), `mode` (`F`), `budget-usd`, `faults`, `route` (one
`tag=target` per line), `process-command`, `change`, `agent-version`, `audit`, `aggregate` (one per
line), `max-not-run`, `report-path` (`driftbench-ci.json`), `working-directory` (`.`), `driftbench` (`pnpm -s
driftbench`, the command that runs the CLI). Outputs: `verdict` (the summary's verdict, or `input-error`
on exit 2) and `report-path`. The step exits with the CLI's exit code, so any verdict but parity fails the
job, and it writes the margin, the underpowered criteria, the radius and the aggregates to the job summary.

`examples/acme/ci/driftbench-ci.yml` is a complete workflow: copy it to `.github/workflows/`. It checks
out the pull request's base and head, runs `campaign run` on the base into `$RUNNER_TEMP/baseline.db`
(exit 1 is kept, exit 2 stops the job), runs the action on the head with that store as `baseline`, and
uploads `driftbench-ci.json`.

## Inputs

* A baseline: a store file, or a campaign id in `--store`. It must have runs.
* The same specs the baseline ran. Goldens the baseline did not run are not paired.
* A candidate target the CLI can reach: `function:acme-sales`, `process:acme-ops`, `fault:<id>` with
  `--faults`, an `http`, `litellm` or `nexus` target from a spec's `target.options`, `process:<name>` with
  `--process-command`, or an adapter a plugin registers.

## Outputs and how to read them

The printed table, in order: the header naming candidate and baseline campaigns, `Margin auto: ...`
with any warning, the underpowered criteria, then the measures:

| Measure | Means |
|---|---|
| goldens paired | goldens both campaigns ran fresh |
| both pass, regressed, improved, both fail | the paired all-pass table |
| new gating flags | flag families firing on the candidate only |
| all-pass regression effect, 95% interval | baseline rate minus candidate rate, in points; positive is a drop |
| margin | the margin and whether it was `auto` |
| smallest margin these pairs can show | the all-pass upper bound when every pair passes on both sides; a margin below it can never show parity |
| gating criteria not shown within the margin | count of criteria whose upper bound is above the margin |
| underpowered | count left out of the parity test |
| verdict | the verdict |

Then "Goldens that changed" (with the candidate's failing verdicts per block), "Why" (the reasons), the
line `Verdict: <VERDICT>. Exit <n>.` and `Summary: <file>`.

The JSON summary (`--out`, and standard output with `--json`) holds: `verdict`, `exitCode`, `reasons`,
`aggregates`, `marginPoints`, `marginAuto` (`neededPoints`, `limitedBy`, `warning`), `marginDefaulted` (why `--margin auto` kept the 2 point default when the baseline holds no run of its own that passed or failed; `null` otherwise), `minGoldens`,
`strict`, `underpowered`, `comparator`, `flags`, `baseline` (`campaignId`, `store`), `candidate`
(`campaignId`, `store`, `target`, `cells`, `incompleteCells`), `pairs`, `table`, `effectPoints`
(`estimate`, `lower`, `upper`), `smallestMarginPoints`, `criteriaNotShown`, `regressed`, `improved`,
`newFlags`, `unpaired`, `rows` (one per golden), `radius` with `--change`, and `notRun` when a candidate
block was not run: `threshold`, `specs` (`specId`, `notRun`, `blocks`, `share`, `first`, the first reason) and
`over` (the specs above the threshold). A spec whose every run of a golden was not run is not paired: its
`unpaired` reason starts `not measured in the candidate`.

## Worked example

A baseline of the six Acme conversations in T, F and P with two repeats, then three candidates: the
identity control (a fault that changes nothing), the planted fault that skips the recap, and the identity
control again with the config's aggregate. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations --mode T,F,P --repeats 2 --store ci.db --campaign baseline
driftbench ci --specs examples/acme/specs/conversations --target fault:control-sales-identity --faults examples/acme/faults --mode T,F,P --repeats 2 --baseline baseline --store ci.db
driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --mode T,F,P --repeats 2 --baseline baseline --store ci.db --out x3.json # exit 1
driftbench ci --specs examples/acme/specs/conversations --target fault:control-sales-identity --faults examples/acme/faults --baseline baseline --store ci.db --config examples/acme/ci/campaign.yaml --margin 25 --json
```

The identity control:

```text
$ driftbench ci --specs examples/acme/specs/conversations --target fault:control-sales-identity --faults examples/acme/faults --mode T,F,P --repeats 2 --baseline baseline --store ci.db
driftbench ci: candidate fault:control-sales-identity (campaign c-c02e4ef864ff) against baseline campaign baseline, compared as driftbench compare does (golden by golden, every repeat).
Margin auto: 14.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 14.31 points).
Underpowered, under 30 goldens, left out of the parity test: budget (7 goldens), cards (23 goldens), end_state (12 goldens), flow (1 golden), forbidden (23 goldens), guards (9 goldens), lang (23 goldens), ledger (19 goldens), must (23 goldens), must_not (23 goldens), pii (23 goldens), stage (23 goldens), tools (23 goldens).
  measure                                      value
  goldens paired                               23
  both pass                                    23
  regressed                                    0
  improved                                     0
  both fail                                    0
  new gating flags                             0
  all-pass regression effect                   0.00 points
  95% interval                                 [-14.31, +14.31] points
  margin                                       14.5 points (auto)
  smallest margin these pairs can show         14.31 points
  gating criteria not shown within the margin  0
  underpowered (under 30 goldens)              13, left out of the parity test
  verdict                                      PARITY

Why:
  - budget: underpowered, decided on 7 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - end_state: underpowered, decided on 12 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - flow: underpowered, decided on 1 golden (fewer than 30); left out of the parity test, --strict puts it back
  - guards: underpowered, decided on 9 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - ledger: underpowered, decided on 19 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - every gating criterion and the all-pass flag have an upper bound below the margin 14.5 points, and no new gating flag

Verdict: PARITY. Exit 0.
Summary: driftbench-ci.json
```

The fault that places the order without a recap:

```text
$ driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --mode T,F,P --repeats 2 --baseline baseline --store ci.db --out x3.json
driftbench ci: candidate fault:x3-skips-recap (campaign c-bc1a61da670a) against baseline campaign baseline, compared as driftbench compare does (golden by golden, every repeat).
Margin auto: 14.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 14.31 points).
Underpowered, under 30 goldens, left out of the parity test: forbidden (23 goldens), must (23 goldens), stage (23 goldens), tools (23 goldens), guards (9 goldens), must_not (23 goldens), budget (7 goldens), cards (23 goldens), end_state (12 goldens), flow (1 golden), lang (23 goldens), ledger (19 goldens), pii (23 goldens).
  measure                                      value
  goldens paired                               23
  both pass                                    10
  regressed                                    13
  improved                                     0
  both fail                                    0
  new gating flags                             13
  all-pass regression effect                   +56.52 points
  95% interval                                 [+32.16, +74.37] points
  margin                                       14.5 points (auto)
  smallest margin these pairs can show         14.31 points
  gating criteria not shown within the margin  0
  underpowered (under 30 goldens)              13, left out of the parity test
  verdict                                      REGRESSION

Goldens that changed:
  golden                                                  baseline  candidate  change     new flags  candidate failing
  acme-number-porting · T                                 pass      fail       regressed  forbidden  block 3 forbidden.order.create, block 3 must.0, block 3 must.1
  acme-number-porting · F                                 pass      fail       regressed  forbidden  block 3 forbidden.order.create, block 3 must.0, block 3 must.1
  acme-number-porting · P · spanish-line                  pass      fail       regressed  forbidden  block 4 forbidden.order.create, block 4 must.0, block 4 must.1
  acme-number-porting · P · are-you-there                 pass      fail       regressed  forbidden  block 4 forbidden.order.create, block 4 must.0, block 4 must.1
  acme-order-loose-confirmation · T                       pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
  acme-order-loose-confirmation · F                       pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
  acme-order-loose-confirmation · P · second-loose-yes    pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
  acme-order-loose-confirmation · P · order-service-down  pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
  acme-plan-upgrade · T                                   pass      fail       regressed  forbidden  block 2 forbidden.order.create, block 2 must.0, block 2 must.1
  acme-plan-upgrade · F                                   pass      fail       regressed  forbidden  block 2 forbidden.order.create, block 2 must.0, block 2 must.1
  acme-plan-upgrade · P · billing-aside                   pass      fail       regressed  forbidden  block 3 forbidden.order.create, block 3 must.0, block 3 must.1
  acme-plan-upgrade · P · order-service-down              pass      fail       regressed  forbidden  block 2 forbidden.order.create, block 2 must.0, block 2 must.1
  acme-plan-upgrade · P · loose-ok                        pass      fail       regressed  forbidden  block 2 forbidden.order.create, block 2 must.0, block 2 must.1

Why:
  - all-pass dropped: McNemar exact p = 0.0002 below 0.05, 13 goldens regressed and 0 improved
  - forbidden regressed: 13 goldens regressed and 0 improved, adjusted p = 0.0011 under the false discovery rate 0.05
  - must regressed: 13 goldens regressed and 0 improved, adjusted p = 0.0011 under the false discovery rate 0.05
  - stage regressed: 13 goldens regressed and 0 improved, adjusted p = 0.0011 under the false discovery rate 0.05
  - tools regressed: 10 goldens regressed and 0 improved, adjusted p = 0.0063 under the false discovery rate 0.05
  - guards regressed: 7 goldens regressed and 0 improved, adjusted p = 0.0406 under the false discovery rate 0.05
  - new gating flag forbidden in acme-number-porting · T
  - new gating flag forbidden in acme-number-porting · F
  - new gating flag forbidden in acme-number-porting · P · spanish-line
  - new gating flag forbidden in acme-number-porting · P · are-you-there
  - new gating flag forbidden in acme-order-loose-confirmation · T
  - new gating flag forbidden in acme-order-loose-confirmation · F
  - new gating flag forbidden in acme-order-loose-confirmation · P · second-loose-yes
  - new gating flag forbidden in acme-order-loose-confirmation · P · order-service-down
  - new gating flag forbidden in acme-plan-upgrade · T
  - new gating flag forbidden in acme-plan-upgrade · F
  - new gating flag forbidden in acme-plan-upgrade · P · billing-aside
  - new gating flag forbidden in acme-plan-upgrade · P · order-service-down
  - new gating flag forbidden in acme-plan-upgrade · P · loose-ok
  - all-pass: the upper bound 74.4 points of the regression effect is not below the margin 14.5 points
  - forbidden: the upper bound 74.4 points is not below the margin, over 23 goldens (13 regressed, 0 improved)
  - must: the upper bound 74.4 points is not below the margin, over 23 goldens (13 regressed, 0 improved)
  - stage: the upper bound 74.4 points is not below the margin, over 23 goldens (13 regressed, 0 improved)
  - tools: the upper bound 63.2 points is not below the margin, over 23 goldens (10 regressed, 0 improved)
  - guards: the upper bound 93.7 points is not below the margin, over 9 goldens (7 regressed, 0 improved)
  - must_not: underpowered, decided on 23 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - budget: underpowered, decided on 7 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - end_state: underpowered, decided on 12 goldens (fewer than 30); left out of the parity test, --strict puts it back
  - flow: underpowered, decided on 1 golden (fewer than 30); left out of the parity test, --strict puts it back
  - ledger: underpowered, decided on 19 goldens (fewer than 30); left out of the parity test, --strict puts it back

Verdict: REGRESSION. Exit 1.
Summary: x3.json
(exit 1)
```

With `--config examples/acme/ci/campaign.yaml`, `ci` takes modes T and F and two repeats from the
config's `campaign:` key (no `--mode` or `--repeats` flag is given) and scores its `pass-rate:>=0.8`. The
JSON summary, printed with `--json`, starts:

```text
$ driftbench ci --specs examples/acme/specs/conversations --target fault:control-sales-identity --faults examples/acme/faults --baseline baseline --store ci.db --config examples/acme/ci/campaign.yaml --margin 25 --json
{
  "verdict": "parity",
  "aggregates": [
    {
      "name": "pass-rate",
      "direction": "at-least",
      "threshold": 0.8,
      "value": 1,
      "passed": true,
      "reason": "1 >= 0.8",
      "interval": {
        "lower": 0.7575059933447592,
        "upper": 1,
        "n": 24,
        "method": "wilson, clusters",
        "clusters": 12
      },
      "decided": false,
      "runsNeeded": 48,
      "goldensNeeded": 24
    }
  ],
  "exitCode": 0,
  "reasons": [
    "budget: underpowered, decided on 4 goldens (fewer than 30); left out of the parity test, --strict puts it back",
    "guards: underpowered, decided on 4 goldens (fewer than 30); left out of the parity test, --strict puts it back",
    "ledger: underpowered, decided on 10 goldens (fewer than 30); left out of the parity test, --strict puts it back",
    "every gating criterion and the all-pass flag have an upper bound below the margin 25.0 points, and no new gating flag"
  ],
  "marginPoints": 25,
  "marginAuto": null,
  "marginDefaulted": null,
  "minGoldens": 30,
  "strict": false,
  "underpowered": [
    {
      "criterion": "budget",
      "goldens": 4
    },
    {
      "criterion": "cards",
      "goldens": 12
    },
    {
      "criterion": "end_state",
```

## Common errors

| Message | Cause and fix |
|---|---|
| `A fault:<id> target needs --faults <path>, the fault set that defines it.` (exit 2) | add `--faults examples/acme/faults` or your own fault set |
| `--baseline <value>: no such file, and no campaign <value> in <store>.` (exit 2) | the baseline is neither a store file nor a campaign of `--store` |
| `The baseline campaign <id> has no run.` (exit 2) | run the baseline campaign first |
| `--out <path> is a folder; the summary is a file.` (exit 2) | give a file path |
| `--change carries the cells outside the radius from the baseline: the baseline must be a campaign of the --store file.` (exit 2) | with `--change`, pass a campaign id held in `--store` as `--baseline` |
| `No adapter is set up for <target>.` (exit 2) | the CLI cannot reach the target: use `--process-command`, a spec's `target.options`, or a plugin |
| verdict `NOT SHOWN NON-INFERIOR` on an unchanged agent | the suite is too small for the margin. Read "smallest margin these pairs can show"; add goldens, or accept the auto margin |
| price-sheet task specs fail on `function:acme-sales` | the mixed Acme suites need `--route flow:price-sheet=process:acme-ops` |
| every cell reran though `--cache` was not given | expected: the cache is off by default in `ci` |
| `Verdict: NOT RUN. Exit 3.` | a candidate spec has blocks not run beyond `--max-not-run`: the target cannot apply a layer of their Given. The `Not run` line names the spec and the first reason. Fix the target or the spec; raise `--max-not-run` only for an exploratory suite (topic running-not-run) |
| `--max-not-run takes a share from 0 to 1, not "<value>".` (exit 2) | give a share such as `0.25`, not a percentage |
