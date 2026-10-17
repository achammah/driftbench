---
title: Cells, repeats and concurrency
summary: How a campaign expands specs x targets x modes x perturbations x repeats into cells. How a cell id is made. How --repeats, --target, --route and --concurrency shape the work. In which order cells run and print.
commands:
  - campaign plan
  - campaign run
  - campaign resume
see_also:
  - running-campaign-plan
  - running-campaign-run
  - running-targets
  - running-modes
  - running-outcomes
  - running-budget-and-prices
next:
  - running-budget-and-prices
---

## What it is

A campaign is a grid. Each cell of the grid is one spec, on one target, in one mode, at one repeat number. In mode P, a cell also has one perturbation the spec declares. Each cell gives one run. `--repeats` runs the same spec, target and mode several times, to measure how often the agent passes rather than whether it passed once. `--concurrency` sets how many cells run at the same time. A cell has a stable id. The id is the first 16 hex characters of the SHA-256 of the canonical JSON. The JSON holds the spec's content hash, the target, the mode, the repeat and the perturbation. The campaign is not part of it. So the same cell has the same id in every campaign. The run id of a cell's run is its cell id.

## When to use it

* To decide how many repeats to run: more repeats tighten the pass rate of each spec. More specs shrink the minimum detectable effect more (topic running-campaign-plan).
* To run one suite on several agents at once: give `--target` several times.
* To keep part of a mixed suite on its own agent: `--route <tag=target>`.
* To go faster on an agent that accepts parallel sessions, or slower on one that rate-limits: `--concurrency`.
* To find a cell again in another campaign: its id does not change while the spec, target, mode, repeat and perturbation stay the same.

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--repeats <n>` | `campaign plan`, `campaign run` | `1` | runs per spec, target and mode (and perturbation in mode P); a whole number of at least 1. Repeats are numbered from 0. |
| `--target <adapter[:agent]>` | `campaign plan`, `campaign run` | none: each spec on its own target | every spec runs on each target given; repeat the flag for several. A target given twice counts once. |
| `--route <tag=target>` | `campaign plan`, `campaign run` | none | needs `--target`: a spec whose `tags` hold the tag runs on this target alone, instead of the `--target` list. The first route whose tag the spec carries wins. |
| `--mode <modes>` | `campaign plan`, `campaign run` | `F` | one or more of `T`, `F`, `P`, comma separated (topic running-modes). |
| `--concurrency <n>` | `campaign run`, `campaign resume` | `4` | cells that run at the same time; a whole number of at least 1. Never more workers than cells. |
| `--agent-version <label>` | `campaign run` | none | written as the `variant` of every target that names none. So it changes the target and therefore the cell id. Runs of `v2` never reuse runs of `v1`. |

A campaign holds at most 1,000,000 cells.

## Inputs

* The specs, with their `target:`, `tags:` and, for mode P, `perturbations:`.
* The flags above, or the same settings from the `campaign:` key of the config (`targets`, `routes`, `modes`, `repeats`, `concurrency`, `agent_version`; topic running-campaign-config).

## Outputs and how to read them

### How many cells

`cells = sum over specs of (targets of the spec) x (sum over modes of (the spec's perturbations in mode P, else 1)) x repeats`. A spec that declares no perturbation makes no P cell at all. A spec routed by `--route`, or run without `--target`, has exactly one target.

### Cell order

Cells are listed, run and printed in this order. First the spec (in the sorted order of the files), then target, then mode (T, F, P), then perturbation, then repeat. `campaign plan` prints this order.

### The worker pool

* The pool has `--concurrency` workers, never more than the cells. Each worker takes the next cell: first the T and F cells in cell order, then the P cells.
* A P cell takes the F run of the same spec, target and repeat in the campaign as the reference of its recovery. If no F run has the same repeat, it takes repeat 0. It waits for that run when the run is still in flight. A campaign without F cells gives P runs no reference.
* A cell whose completed run is already in the store is reused without running (that is how `resume` works).
* With a budget, a worker checks the spend when it takes a cell. Once the budget is reached, the cell is stopped and never starts (topic running-budget-and-prices).
* Each run is filed in the store as soon as it finishes.
* Lines print in cell order. A cell's line prints once it and every cell before it have an outcome. So a slow first cell holds back the lines after it, never the work.
* When running a cell throws an unexpected error, no new cell starts, and the error is raised once the cells in flight finish.

## Worked example

One spec on two targets with three repeats and two workers. Then the whole Acme suite on the sales agent, with the price-sheet task routed to the ops agent and an agent version. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --target function:acme-sales --repeats 3 --concurrency 2 --campaign acme-grid
driftbench campaign run examples/acme/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version v2 --campaign acme-routed
```

```text
Campaign acme-grid: 6 cells, 2 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 2  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 2  pass  5 blocks
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

```text
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-number-porting · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
7 cells: 7 pass, 0 fail, 0 failed. Spent $0.00.
```

`function:acme` and `function:acme-sales` reach the same agent but are two targets, so each gets its own cells. The price-sheet spec carries the tag `flow:price-sheet`, so the route runs it on `process:acme-ops` and prints no override note. The cell line shows the target without its variant. `--agent-version v2` is in the target the runs record. So these cells have other ids than unversioned ones.

## Common errors

Each exits 2.

* `--repeats takes a whole number of at least 1, not "0".`
* `--concurrency takes a whole number of at least 1, not "0".`
* `--route goes with --target: without it each spec already runs on its own target.`
* `--route takes tag=target, such as flow:price-sheet=process:acme-ops, not "bad".`
* `--repeats 1000000 makes 6000000 cells; a campaign holds at most 1000000.`
* `Note: <spec> names the <adapter> adapter; --target runs it on <target>.` is not an error. It warns that `--target` moved a spec off the adapter it was written for. Add a `--route` for it if that was not intended.
* Too much concurrency against a rate-limited agent shows as retries and `failed` cells with status 429: lower `--concurrency` (topic running-retries).
