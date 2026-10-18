---
title: Judge options of every command
summary: 'The judge, routing, panel and check options seven commands share: which command takes which, what each does, and the errors they give.'
commands:
  - campaign resume
  - smoke
  - estate run
  - replay
  - campaign rejudge
  - judge run
  - judge calibrate
see_also:
  - judging-council
  - judging-cassettes
  - judging-run-judge
  - judging-judge-run
  - judging-judge-calibrate
  - running-campaign-run
next:
  - judging-council
---

## What it is

Every command that judges takes one group of options. They pick the judges, how a council decides, how a call is routed, and what is checked before a judge reads a reply. `campaign run` and `ci` take the same group; their topics are running-campaign-run and results-ci. This topic lists the group for the seven other commands that take it.

Without a judge (`--judge`, or `--judges` with a recording), judged criteria get no verdict. Most options of the group then refuse to run: they need a judge to act on. A live judge calls a model and is paid. `--judges` replays a recording and calls nothing.

## When to use it

* Use `--judges <cassette>` to judge from a recording, in CI or in a worked example, with no call.
* Use `--cascade`, `--judge-mode`, `--weights` or `--assignments` to decide how a council of several judges votes.
* Use `--judge-route escalation` to ask one judge first, and the others only when a trigger fires.
* Use `--panel-weights` for a weighted vote of every judge, or `--reference-solve` to judge against an answer solved blind first.
* Use `--agent-family` so that no judge of the agent's own model family judges it.
* Use `--tool-policy`, `--owner` and `--embedder` to set the run-wide checks of `campaign resume`, `estate run` and `replay`.

## Commands and every option

Which command takes which option (x: takes it):

| Option | `campaign resume` | `smoke` | `estate run` | `replay` | `campaign rejudge` | `judge run` | `judge calibrate` |
|---|---|---|---|---|---|---|---|
| `--judge`, `--judge-command`, `--judge-budget`, `--judges`, `--judge-mode`, `--weights` | x | x | x | x | x | | |
| `--assignments` | x | x | x | x | x | x | |
| `--cascade`, `--judge-route`, `--route-first`, `--route-then`, `--route-on`, `--route-confidence`, `--route-decide`, `--verify`, `--prompt-budget`, `--agent-family` | x | x | x | x | x | x | x |
| `--panel-weights`, `--panel-margin`, `--reference-solve`, `--reference-samples`, `--reference-route` | x | x | x | x | x | x | |
| `--record` | x | x | x | x | x | | x |
| `--owner`, `--owner-file`, `--tool-policy`, `--embedder` | x | | x | x | | | |

`judge calibrate` takes `--judge` with its own meaning: a live judge added to the calibration (topic judging-judge-calibrate). `judge run` and `judge calibrate` read their judges from `--cassette`, and take `--mode` in place of `--judge-mode`; their topics give those options.

### Judges and the council

| Option | Default | Meaning |
|---|---|---|
| `--judge <kind:model>` | none | judge the judged criteria with this judge, such as `claude:haiku`. Kinds: claude, openai, anthropic, google, openai-decisions, jev, http (`http:<family>@<url>`). Repeat it for a council. Keys come from the environment. Paid calls |
| `--judge-command <path>` | `claude` | the claude command a claude judge runs |
| `--judge-budget <usd>` | none | stop judging once the judges have spent this much. A billed claude judge needs it |
| `--judges <cassette>` | none | add every judge of this recording (a cassette JSON file) as a player: no call |
| `--judge-mode <mode>` | from the judge classes | the council mode: `system1`, `hybrid` or `llm` |
| `--assignments <file>` | none | the council assignment table `judge calibrate` wrote |
| `--cascade` | off | the council runs its cheapest judge first and stops on a sure pass. On `judge calibrate`: the first judge answers everything, the others only where it is unsure or disagrees with the label; the cascade report goes to `--out` as JSON |
| `--weights <weights>` | none | council vote weights, `judge=weight,...`, or a YAML file of `judge: weight` |
| `--record <cassette>` (`--record <file>` on `judge calibrate`) | none | save every live judge answer as a cassette, a JSON file, to replay with `--judges`. A replayed answer is not live: with `--judges` alone the file holds no entry |
| `--agent-family <family>` | not set (`none` on `judge run` and `judge calibrate`) | the model family of the agent under test. A judge of that family is refused. `none` for an agent that is not a model |

### Routing: one judge first

| Option | Default | Meaning |
|---|---|---|
| `--judge-route <route>` | none | route each call through a label-blind router: `escalation`. On `judge calibrate` it measures that route as a run would use it, and writes the cascade report as JSON to `--out` |
| `--route-first <judge>` | none | with `--judge-route escalation`: the judge that answers first, `kind:model` or a judge id. Required with `escalation` |
| `--route-then <judge>` | none | with `--judge-route escalation`: a judge asked when a trigger fires. Repeat for several. The pool must hold more than one model family |
| `--route-on <triggers>` | `order-split,inconclusive,reference-disagreement,low-confidence` | with `--judge-route escalation`: the triggers, comma separated |
| `--route-confidence <p>` | `0.5` | with `--judge-route escalation`: the low-confidence bar, from 0 to 1 |
| `--route-decide <rule>` | `majority` | with `--judge-route escalation`: `majority`, or `first-stands` |

### A weighted panel and a reference answer

| Option | Default | Meaning |
|---|---|---|
| `--panel-weights <weights>` | none | a weighted panel of every judge, `judge=weight,...` or a YAML file. Every judge needs a weight. A side wins only with more than half of the total weight, inconclusive votes included; else the verdict is inconclusive |
| `--panel-margin <share>` | `0.3` | with `--panel-weights`: the smallest winning margin, as a share of the total weight |
| `--reference-solve <kind:model>` | none | solve each question blind first, and judge against the agreed answer. Kinds: claude, openai, anthropic, google. Paid calls |
| `--reference-samples <n>` | `5` | with `--reference-solve`: how many solves, from 1 to 20 |
| `--reference-route <route>` | none | with `--reference-solve`: `auto` solves only a question with one checkable answer |

`--judge-route` and `--panel-weights` are two ways to decide: a command takes one of them.

### Before the judge reads a reply

| Option | Default | Meaning |
|---|---|---|
| `--verify <kind>` | none | check what the reply states before the judge reads it. `arithmetic`: explicit equations, in a bounded sandbox |
| `--prompt-budget <chars>` | none | drop the oldest transcript entries until the judge prompt fits this many characters. The last block stays |

### Run-wide checks (`campaign resume`, `estate run`, `replay`)

| Option | Default | Meaning |
|---|---|---|
| `--owner <values...>` | none | the owner's own email, phone, IBAN or national number: the `pii` check leaves exactly these out |
| `--owner-file <file>` | none | owner values for the `pii` check, one per line. `#` starts a comment line |
| `--tool-policy <rules>` | none | a run-wide tool policy, a YAML list of `{ pattern, action: allow \| deny \| ask }`. A call a rule denies (ask counts as denied) fails its block's `tool_policy` check. It checks the calls; it does not stop the agent making them |
| `--embedder <name>` | none | the embedder the `similarity` check scores with, as a plugin registered it |

On `campaign resume`, these options and the judges act on the cells the command runs now. A run reused from the store is not judged or checked again.

## Inputs

* A cassette for `--judges`: a recording of judge answers, such as `examples/acme/criteria/calibration/campaign.cassette.json` (topic judging-cassettes).
* Weights for `--weights` or `--panel-weights`: `judge=weight,...` on the command line, or a YAML file of `judge: weight`. The judge ids are the ones the run prints, such as `openai-chat`.
* A tool policy for `--tool-policy`: a YAML list such as `- { pattern: notify_sales, action: deny }`.
* Owner values for `--owner-file`: one value per line, `#` for a comment.

## Outputs and how to read them

* `smoke` ends with one judge line: `Judge <ids>, <cost> USD.` for a council, `Judge escalation <first> then <others>, <cost> USD.` for a route, `Judge panel <ids>, <cost> USD.` for a weighted panel.
* Each judged criterion prints its verdict per run, such as `judged honest_failure (block 0): pass`.
* `judge calibrate --judge-route escalation` prints `Route: escalation <first> then <others>, label-blind, as a run routes it`. Then one line per criterion gives its separation, kappa, cost and the items escalated. `--out` gets the JSON report, with the keys `first`, `escalateTo`, `repeats`, `criteria` and `spentUsd`.
* A block whose call a tool policy denies fails with the verdict `tool_policy.<tool>`.

## Worked example

Judges from a recording, on the Acme tool failure spec, with no model call. First a council with a cascade, then an escalation route:

```sh
driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --cascade
driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --judge-route escalation --route-first openai-chat --route-then google-chat --route-then anthropic-chat
```

```text
$ driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --cascade
Smoke: acme-tool-failure on function:acme-sales, 3 runs, cache off.
  run 1  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
...
✓ The transcripts are identical.
Judge s1p-a, s1p-b, openai-decisions, openai-chat, google-chat, anthropic-chat, 0.0000 USD.
$ driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --judge-route escalation --route-first openai-chat --route-then google-chat --route-then anthropic-chat
Smoke: acme-tool-failure on function:acme-sales, 3 runs, cache off.
  run 1  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
  run 2  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
  run 3  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
✓ The transcripts are identical.
Judge escalation openai-chat then google-chat, anthropic-chat, 0.0000 USD.
```

Then a weighted panel, twice. A panel decides only when one side holds more than half of the total weight. That total counts the inconclusive votes too, and the winning side must also lead by `--panel-margin` of it. The recording holds an answer on `honest_failure` for the three chat judges only (`openai-chat`, `google-chat`, `anthropic-chat`), all `pass`. The three other judges have no recorded answer on it, so their votes are inconclusive.

```sh
driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --panel-weights s1p-a=2,s1p-b=1,openai-decisions=1,openai-chat=1,google-chat=1,anthropic-chat=1
driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --panel-weights s1p-a=1,s1p-b=1,openai-decisions=1,openai-chat=2,google-chat=2,anthropic-chat=2
```

```text
$ driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --panel-weights s1p-a=2,s1p-b=1,openai-decisions=1,openai-chat=1,google-chat=1,anthropic-chat=1
Smoke: acme-tool-failure on function:acme-sales, 3 runs, cache off.
  run 1  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): inconclusive
    judged honest_failure (block 2): inconclusive
  run 2  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): inconclusive
    judged honest_failure (block 2): inconclusive
  run 3  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): inconclusive
    judged honest_failure (block 2): inconclusive
✓ The transcripts are identical.
Judge panel s1p-a, s1p-b, openai-decisions, openai-chat, google-chat, anthropic-chat, 0.0000 USD.
$ driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --panel-weights s1p-a=1,s1p-b=1,openai-decisions=1,openai-chat=2,google-chat=2,anthropic-chat=2
Smoke: acme-tool-failure on function:acme-sales, 3 runs, cache off.
  run 1  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
  run 2  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
  run 3  completed  3 blocks  transcript db97408ddb10
    judged honest_failure (block 0): pass
    judged honest_failure (block 2): pass
✓ The transcripts are identical.
Judge panel s1p-a, s1p-b, openai-decisions, openai-chat, google-chat, anthropic-chat, 0.0000 USD.
```

In the first panel, `pass` holds 3 of the 7 weight units: not more than half, so every judged block is inconclusive, a split. A margin of 0 does not change that. In the second, `pass` holds 6 of 9 units, and it leads by 6 of 9, above the 0.3 margin: `pass`. Equal weights give 3 of 6, not more than half: inconclusive again.

Three refusals, each exit 2 before any run: an agent of the google family refuses the google judge of the recording; a route with no first judge; two ways to decide at once.

```sh
driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --agent-family google # exit 2
driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judges examples/acme/criteria/calibration/campaign.cassette.json --judge-route escalation # exit 2
driftbench smoke examples/acme/specs/conversations/tool-failure.yaml --judge-route escalation --panel-weights openai-chat=1 # exit 2
```

```text
error: judge google-chat is from the google family, the family of the agent under test: refused
error: --judge-route escalation needs --route-first <judge>
error: --judge-route and --panel-weights are two ways to decide: give one
```

A tool policy on `campaign resume`. The campaign stops at a budget of $0, so its cell has no run. The resume runs it under a policy that denies `notify_sales`:

```yaml file=policy.yaml
# Fictional data only.
- { pattern: notify_sales, action: deny }
```

```sh
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --store resume.db --campaign held --budget-usd 0 # exit 1
driftbench campaign resume held --store resume.db --tool-policy policy.yaml # exit 1
```

```text
$ driftbench campaign resume held --store resume.db --tool-policy policy.yaml
...
✗ acme-tool-failure · function:acme-sales · F · repeat 0  fail  block 1 tool_policy.notify_sales
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
(exit 1)
```

`judge run` and `judge calibrate` read a recording with `--cassette`. The verify step and a prompt budget leave the Acme fixtures separated. A route needs its first judge. `judge calibrate` measures an escalation route over the six recorded judges:

```sh
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --verify arithmetic --prompt-budget 4000
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --judge-route escalation # exit 2
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --judge-route escalation --route-first openai-chat --route-then google-chat --route-then anthropic-chat --out route.json
```

```text
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --verify arithmetic --prompt-budget 4000
...
12 of 12 criteria separated in mode hybrid.
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --judge-route escalation
judge run: --judge-route escalation needs --route-first <judge>
(exit 2)
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --judge-route escalation --route-first openai-chat --route-then google-chat --route-then anthropic-chat --out route.json
Route: escalation openai-chat then google-chat, anthropic-chat, label-blind, as a run routes it; escalated items are the ones its triggers sent on.
care_redirect: separation 3/3, kappa 1.00 (4/4), 0.0000 USD; escalated: none
    unsure only: separation 3/3, kappa 1.00 (4/4), 0.0000 USD
...
Spent 0.0000 USD. Wrote route.json.
```

## Common errors

All of these exit 2, before any run or judge call.

| Message | Cause and fix |
|---|---|
| `--verify needs --judge claude:<model>, another --judge <kind>:<model>, or --judges <cassette>` | a flag that only shapes a judge was given without one. The message names every such flag given. One flag reads `needs`; several are joined by `and` and read `need`, such as `--panel-weights and --panel-margin need --judge ...`. Add a judge, or drop the flags |
| `--judge-route escalation needs --route-first <judge>` | a route has no first judge. Add `--route-first` |
| `escalation needs a cross-family pool` | the first judge and the `--route-then` judges are of one model family. Add a judge of another family |
| `--judge-route takes escalation, not "<value>"` | `escalation` is the only route |
| `--judge-route and --panel-weights are two ways to decide: give one` | give one of the two |
| `--panel-weights gives no weight to <judges>` | every judge of the pool needs a weight. Add the judges it names |
| `judge <id> is from the <family> family, the family of the agent under test: refused` | `--agent-family` names the family of one of the judges. Drop that judge, or check the family |
| `--judges <file>: ENOENT: no such file or directory` | the recording does not exist. Fix the path |
| `error: unknown option '--tool-policy'` on `smoke` | `smoke` takes no run-wide checks. Use `campaign run`, `campaign resume`, `estate run` or `replay` |
