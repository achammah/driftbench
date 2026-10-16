---
title: Declare a campaign in driftbench.yaml
summary: Write the settings of campaign run once, under the campaign key of driftbench.yaml or a --config file, so a bare campaign run uses them. A flag on the command line still wins.
commands:
  - campaign run
  - campaign plan
see_also:
  - running-campaign-run
  - running-campaign-plan
  - running-budget-and-prices
  - running-retries
  - running-plugins
  - running-simulate
next:
  - running-campaign-plan
---

## What it is

The project config is a YAML file: `driftbench.yaml` in the folder you run the command from, or the file `--config <file>` names. Its `campaign:` key declares a campaign. Each setting under it is a plain mapping onto one flag of `campaign run`. The file and the flag therefore mean the same thing. With the file in place, `driftbench campaign run` alone runs the declared campaign. A flag given on the command line wins over the file, flag by flag. The same file holds other keys read by other commands. These are `prices:` (token prices, topic running-budget-and-prices) and `plugins:` (topic running-plugins). Also `aggregates:` and `scales:` (read by `report`, `ci` and `view`, results area).

## When to use it

* To keep the suite, targets, modes, repeats, store and budget of a project in one committed file instead of a long command line.
* To give CI and people the same campaign: `driftbench campaign run --config <file>`.
* To try a variation without editing the file: add the flag on the command line; it replaces the file's value for that run only.

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--config <file>` | `campaign run`, `campaign plan` | `driftbench.yaml` in the working folder, when it exists | the project config to read. Without the flag, a missing `driftbench.yaml`, one that is not YAML, or one with no `campaign:` key changes nothing. A `--config` file that cannot be read or parsed is an error. |

Every key of `campaign:` and the flag it stands for:

| Key | Flag | Value |
|---|---|---|
| `specs` | the `[paths...]` argument | a list of spec files or folders, at least one. Used only when the command line names neither paths nor `--dataset`. |
| `dataset` | `--dataset` | a dataset version of the store, `name` or `name@version`. |
| `prompts` | `--prompt`, once per item | a list of prompt versions of the store. `campaign run` accepts one prompt only. |
| `targets` | `--target`, once per item | a list of targets, each `adapter` or `adapter:agent`. |
| `routes` | `--route`, once per item | a list of `tag=target` strings. |
| `modes` | `--mode` | a list of `T`, `F` and `P`, at least one, such as `[T, F]`. |
| `repeats` | `--repeats` | a whole number of at least 1. |
| `agent_version` | `--agent-version` | a label. |
| `store` | `--store` | the store file, read from the working folder. |
| `cache` | `--no-cache` when `false` | a boolean; `campaign run` only. |
| `cache_suite` | `--cache-suite` | a name. |
| `concurrency` | `--concurrency` | a whole number of at least 1. |
| `budget_usd` | `--budget-usd` | a number of at least 0. |
| `process_command` | `--process-command` | a string: a JSON list or a command line. |
| `driver` | `--driver` | `scripted` or `simulated`. |
| `personas` | `--persona`, once per item | a list of persona files. |
| `recordings` | `--recording`, once per item | a list of recording files. |
| `model` | `--model` when `true` | a boolean; true is a paid call per simulated user turn. |
| `agent_family` | `--agent-family` | a model family. |
| `judge_families` | `--judge-family`, once per item | a list of model families. |
| `retry` | `--retry-attempts`, `--retry-base-ms`, `--retry-max-ms` | a mapping with `max_attempts` (at least 1), `base_delay_ms` (at least 0) and `max_delay_ms` (at least 0). |

The rules:

* A flag on the command line wins over the file, flag by flag. A list flag such as `--target` replaces the file's whole list.
* What to run comes from one place: the paths or `--dataset` of the command line when it gives any, else the file's `specs` and `dataset`.
* Paths in the file (`specs`, `store`, personas, recordings) are read from the working folder, as the same paths on the command line are. They are not read from the folder of the config file.
* `campaign plan` takes only the keys it has a flag for: `targets`, `routes`, `modes`, `repeats`, `budget_usd` and `store`. Its spec paths stay on the command line.
* The settings of a single run are never in the file: `--campaign`, `--change`, `--from`, `--audit`, `--audit-seed`, `--max-carry`, `--max-age`, `--block-reruns`, `--record-end-state-snapshots`, `--record-realized-text`, `--prices` and `--json`.
* `campaign resume` does not read `campaign:`: a stored campaign keeps its own cells. It reads `prices:` of `driftbench.yaml` in the working folder.
* An unknown key under `campaign:`, or a value that does not fit, exits 2 and names it, such as `campaign.repeats`.

## Inputs

A YAML file such as this one, `examples/acme/ci/campaign.yaml` of the repository:

```text
campaign:
  specs: [examples/acme/specs/conversations]
  targets: [function:acme-sales]
  modes: [T, F]
  repeats: 2
  concurrency: 2
aggregates:
  - pass-rate:>=0.8
```

## Outputs and how to read them

The config prints nothing of its own: the command prints what it would print with the same flags. You can tell the file's values applied from the header (`<n> cells, <c> at a time`) and the plan line (modes and repeats). Errors in the file exit 2 before anything runs.

## Worked example

The Acme config plans one spec with the file's target, modes and repeats. Then the declared campaign runs with mode and repeats overridden on the command line. The specs, the target and the concurrency still come from the file. No model is called.

```sh
driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --config examples/acme/ci/campaign.yaml
driftbench campaign run --config examples/acme/ci/campaign.yaml --mode F --repeats 1 --campaign acme-config
```

```text
Plan: 1 spec, 1 target, modes T, F, 2 repeats: 4 cells, 20 blocks.
  cell              spec               target               mode  repeat  blocks
  6a402b958212918e  acme-plan-upgrade  function:acme-sales  T     0       5
  9ed98207286a7c44  acme-plan-upgrade  function:acme-sales  T     1       5
  a66a7aba9986a136  acme-plan-upgrade  function:acme-sales  F     0       5
  e63e47b82042e9c8  acme-plan-upgrade  function:acme-sales  F     1       5
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode T: none detectable on a 50% pass rate, with 2 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
Minimum detectable effect, mode F: none detectable on a 50% pass rate, with 2 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

```text
Campaign acme-config: 6 cells, 2 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-number-porting · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

`2 at a time` comes from `concurrency: 2` in the file. The plan used the file's modes `[T, F]` and `repeats: 2`; the run replaced them with `--mode F --repeats 1`.

## Common errors

Each exits 2, prints on stderr and runs nothing. The path printed is the absolute path of the config.

* `<path>: campaign.repeats: Too small: expected number to be >=1` A value out of range.
* `<path>: campaign: Unrecognized key: "colour"` A key that is not in the table above. Check the spelling: keys are snake case (`budget_usd`, not `budgetUsd`).
* `Cannot read the config <path>: ENOENT: no such file or directory, ...` A `--config` file that does not exist.
* `<path>: not YAML: <parser message>` A `--config` file that does not parse. Without `--config`, an unparsable `driftbench.yaml` is ignored for `campaign:`.
* `No spec files found.` No paths, no `--dataset`, and no `specs:` in the file.
