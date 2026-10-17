---
title: campaign rejudge
summary: "Judge again, under changed criterion text, the stored observations of a campaign with no agent call: the blocks that name the changed criteria are re-judged and every other result is carried."
commands:
  - campaign rejudge
see_also:
  - judging-run-judge
  - judging-criteria
  - judging-default-judge
  - judging-machine-checks
next:
  - judging-self-tests
---

## What it is

`driftbench campaign rejudge` takes a stored baseline campaign and a new version of its specs in which only criterion text changed: `rubric`, `pass`, `fail`, `gating`, `scope`, `judge_class` or `repeat_reducer`. It calls the judge on the stored observations of the blocks that name the selected criteria, and calls the agent zero times. Every other result is carried from the baseline with its source and age. The result is a new campaign in the same store; its report labels re-judged and carried blocks.

With `--use <kind>/<id>` or `--set <kind>[/<id>]#<item>.<param>=<value>` instead of `--change`, it re-scores: every stored observation is checked again under the changed objects (a check set, a policy), with no agent call and no judge call. `uses` and every object it names are scoring-only, so the same compatibility proof holds. An agent-facing object on the command line (a persona, a run profile) is refused: it changes what the agent receives, so the agent must run again.

Before any judge call, it proves the stored observations still fit the new specs. An observation-compatibility hash covers everything that can change what the agent receives or does: givens, stimuli, tools, target, adapter, modes, perturbations, user driver, seeds, stages and block order. Only the seven criterion fields above are left out of it. A change to anything else, a machine check or an expected output included, needs a full agent run with `campaign run`.

## When to use it

* A rubric was sharpened, for example after calibration, and the old runs must be judged again under it without new agent calls.
* A criterion became gating, or changed scope or judge class.
* A project or suite object changed (a check disabled in a check set, a policy item set), or one is tried with `--use`, and the stored runs must be scored under it without new agent calls.
* Not for a new prompt, model, tool, check or spec structure: use `campaign run`, with `--change` for the blast radius.
* Legacy, partial, injected or adaptive runs, unknown seeds and task artifact reads are refused with a full-rerun instruction.

## Commands and every option

```
driftbench campaign rejudge <paths...> --from <campaign> --campaign <new-id> --store <file> --change <manifest> --judge claude:<model> [--judge-command <path>] [--judge-budget <usd>] [--max-carry <n>] [--max-age <days>] [--record-realized-text] [--json]
driftbench campaign rejudge <paths...> --from <campaign> --campaign <new-id> --store <file> (--use <kind/id> | --set <kind[/id]#item.param=value>)... [--max-carry <n>] [--max-age <days>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` | Required. The new spec files or folders: exactly the baseline's specs, by id, each once. | none |
| `--from <campaign>` | Required. The baseline campaign id, stored with complete execution provenance. | none |
| `--campaign <id>` | Required. The new campaign id; refused when it already exists in the store. | none |
| `--store <file>` | Required. The store that holds the baseline; the new campaign is written there. | none |
| `--change <manifest>` | Required to re-judge. A change manifest whose `changes` are all `kind: criterion` with an `id`, and whose `from` and `to` agent versions are equal. Not with `--use` or `--set`. | none |
| `--use <kind/id>` | Re-score under this object instead of the one the layers choose, such as `check-set/quiet`. Repeat it for several kinds. Scoring-only kinds only. | none |
| `--set <kind[/id]#item.param=value>` | Re-score with one item parameter set at the command-line layer, such as `policy/blame#R3.recovery_ok=[asked_user]`. Repeat it. | none |
| `--judge <judge>` | Required to re-judge: `claude:<model>`, the judge on the local claude command (see `judging-run-judge`). Paid calls unless the command is a stand-in. | none |
| `--judge-command <path>` | The command the judge runs. | `claude` |
| `--judge-budget <usd>` | Stop judging at this spend; required for a billed judge. | none |
| `--max-carry <n>` | The most campaigns in a row a result may be carried, a whole number from 0. | `5` |
| `--max-age <days>` | The most days since a carried observation was measured, at least 0. | `7` |
| `--record-realized-text` | Retain available `realized.text` in this new campaign. Without it, copies keep only the hash, even when the baseline recorded text. Missing text is never reconstructed. | off |
| `--json` | Print the summary as JSON. | off |

Exit codes:

| Code | When |
|---|---|
| 0 | The new campaign passes: every block passes and every end state matches. |
| 1 | The new campaign is written, and a gating result fails or is inconclusive. |
| 3 | The new campaign is written, and no run fails, but a block was not run or blocked: no measurement, never a gating failure. The summary lists each with its reason and counts the runs as `notRun` or `blocked`. |
| 2 | The inputs or the reuse proof were refused; nothing is judged or written. |

## Inputs

* The baseline campaign in the store, run with an agent version (`campaign run --agent-version <v> --store <file>`) and complete: every planned cell has a run.
* The new specs, with the same ids as the baseline, each selected criterion defined in them.
* The change manifest (YAML):

```
from: acme-v1
to: acme-v1
changes:
  - { kind: criterion, id: no_invented_data }
```

`from` and `to` are the agent version, equal on both sides. Each change names one criterion by `id`.

## Outputs and how to read them

* Text: `Campaign <id>: <r> blocks re-judged, <c> carried; 0 agent calls. Judge cost <usd> USD.`, with `, <n> not run or blocked (left as they were)` before the semicolon when a block was not run, then `Runs: <p> pass, <f> fail.` (with the not run and blocked counts when there are any), then one line per block not run or blocked with its reason.
* Text, re-score: `Campaign <id>: <n> blocks re-scored under <flags>; 0 agent calls, 0 judge calls.` With `--json`: `campaign`, `from`, `agentCalls` (always 0), `rescored`, `use`, `set`. Each re-scored block keeps its observation, gets new verdicts stamped with the objects that scored them (`by`), records those objects in `resolved`, and carries a `rejudged` stamp with no criterion; judge verdicts and the runner's flow and ledger verdicts are kept.
* `--json`: `campaign`, `from`, `agentCalls` (always 0), `rejudged`, `carried` (scored blocks only), `unmeasured` (each block not run or blocked: spec, mode, repeat, block, status, reason; absent when none), `runs` (`pass`, `fail`, `notRun`, `blocked`), `judgeCostUsd`.
* The store gains the new specs, the new campaign (judge mode `llm`, the judge label, a `rejudged` stamp per run) and one run per baseline run. Judge calls count in the new runs' cost; the agent's historical cost is not charged again.
* Errors print the reason on stderr with exit 2.

## Worked example

A baseline stored offline; a re-judge refused because the manifest is a model change; then a real re-judge after one sentence is added to the rubric of `no_invented_data`. The stand-in judge fails any prompt that mentions a public holiday, so the re-judged gating criterion fails, and no model is called:

```sh setup
mkdir -p rejudge
sed 's/customer. Nothing is guessed./customer. Nothing is guessed. Never invent a public holiday./' examples/acme/specs/conversations/plan-upgrade.yaml > rejudge/plan-upgrade.yaml
```

```yaml file=rejudge/criterion.yaml
from: acme-v1
to: acme-v1
changes:
  - { kind: criterion, id: no_invented_data }
```

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme-sales --agent-version acme-v1 --campaign acme-before --store rejudge/runs.db
driftbench campaign rejudge rejudge/plan-upgrade.yaml --from acme-before --campaign acme-refused --store rejudge/runs.db --change examples/acme/radius/model.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs  # exit 2
driftbench campaign rejudge rejudge/plan-upgrade.yaml --from acme-before --campaign acme-rejudged --store rejudge/runs.db --change rejudge/criterion.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs  # exit 1
driftbench campaign rejudge rejudge/plan-upgrade.yaml --from acme-before --campaign acme-r2 --store rejudge/runs.db --change rejudge/criterion.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs --json  # exit 1
```

```text
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme-sales --agent-version acme-v1 --campaign acme-before --store rejudge/runs.db
Campaign acme-before: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
$ driftbench campaign rejudge rejudge/plan-upgrade.yaml --from acme-before --campaign acme-refused --store rejudge/runs.db --change examples/acme/radius/model.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs
Re-judge needs a criterion-only manifest with identical from/to agent versions; otherwise rerun the agent.
(exit 2)
$ driftbench campaign rejudge rejudge/plan-upgrade.yaml --from acme-before --campaign acme-rejudged --store rejudge/runs.db --change rejudge/criterion.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs
Campaign acme-rejudged: 2 blocks re-judged, 3 carried; 0 agent calls. Judge cost 0.0030 USD.
Runs: 0 pass, 1 fail.
(exit 1)
$ driftbench campaign rejudge rejudge/plan-upgrade.yaml --from acme-before --campaign acme-r2 --store rejudge/runs.db --change rejudge/criterion.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs --json
{
  "campaign": "acme-r2",
  "from": "acme-before",
  "agentCalls": 0,
  "rejudged": 2,
  "carried": 3,
  "runs": {
    "pass": 0,
    "fail": 1,
    "notRun": 0,
    "blocked": 0
  },
  "judgeCostUsd": 0.003
}
(exit 1)
```

`no_invented_data` is named by 2 of the 5 blocks, so those 2 are re-judged and 3 carried. The stand-in reports 0.0015 USD per call.

A re-score: a project check set that leaves out `must`, a baseline stored under it, and the same campaign re-scored with `--use`, with no agent and no judge call:

```sh setup
mkdir -p rescore/specs rescore/driftbench/check-set
cp examples/acme/specs/conversations/plan-upgrade.yaml rescore/specs/plan-upgrade.yaml
```

```yaml file=rescore/driftbench.yaml
plugins: []
```

```yaml file=rescore/driftbench/check-set/quiet.yaml
kind: check-set
id: quiet
extends: default
items:
  - { id: must, enabled: false }
```

```sh
driftbench campaign run rescore/specs/plan-upgrade.yaml --target function:acme-sales --agent-version acme-v1 --campaign acme-full --store rescore/runs.db
driftbench campaign rejudge rescore/specs/plan-upgrade.yaml --from acme-full --campaign acme-quiet --store rescore/runs.db --use check-set/quiet
driftbench campaign rejudge rescore/specs/plan-upgrade.yaml --from acme-full --campaign acme-refused --store rescore/runs.db --use run-profile/fast  # exit 2
```

```text
$ driftbench campaign rejudge rescore/specs/plan-upgrade.yaml --from acme-full --campaign acme-quiet --store rescore/runs.db --use check-set/quiet
Campaign acme-quiet: 5 blocks re-scored under check-set/quiet; 0 agent calls, 0 judge calls.
(exit 0)
$ driftbench campaign rejudge rescore/specs/plan-upgrade.yaml --from acme-full --campaign acme-refused --store rescore/runs.db --use run-profile/fast
run-profile is agent-facing: a change to it changes what the agent receives; rerun the agent in a full campaign.
(exit 2)
```

## Common errors

* `Re-judge needs a criterion-only manifest with identical from/to agent versions; otherwise rerun the agent.` (exit 2). The manifest changes something other than a criterion, or `from` differs from `to`. Use `campaign run`.
* `Re-judge requires --judge claude:<model>.` (exit 2). Give a judge.
* `Campaign <id> already exists.` (exit 2). Choose a new `--campaign` id.
* `A selected criterion is not defined in the new specs.` (exit 2). The manifest names a criterion the new specs lack.
* `Re-judge requires exactly the baseline specs, with unique ids.` (exit 2). Pass every baseline spec, and no other.
* `Legacy campaign has missing, incomplete or inconsistent execution provenance; run a new full campaign before re-judging.` (exit 2). The baseline was stored by an older version, or without provenance.
* `Baseline campaign is incomplete; rerun the agent.` (exit 2). A planned cell has no run.
* `Carry limits must be nonnegative; --max-carry must be a whole number.` (exit 2).
* `<kind> is agent-facing: a change to it changes what the agent receives; rerun the agent in a full campaign.` (exit 2). `--use` or `--set` named a persona, a scenario, a run profile or a deviation class. Use `campaign run`.
* `Re-score with --use or --set, or re-judge criteria with --change: one at a time.` (exit 2). Run them as two re-judges.
* `Re-judge needs --change <manifest> (criteria), or --use / --set (a scoring-only object change).` (exit 2).
* `--use <flag>: expected <kind>/<id>, such as policy/blame/acme` (exit 2). Name a known kind and an id.
* `error: a judge on a command that is not a stand-in is billed: pass --judge-budget <usd>` (exit 2). Add a budget.
