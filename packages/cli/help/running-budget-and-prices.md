---
title: Spend caps, token prices and cost
summary: Cap what a campaign may spend with --budget-usd. Price adapters that report tokens and no dollars with a dated price table (--prices or the prices key). Project the cost before running. Read what was spent.
commands:
  - campaign plan
  - campaign run
  - campaign resume
see_also:
  - running-campaign-plan
  - running-campaign-run
  - running-campaign-resume
  - running-outcomes
  - running-cache
  - running-store
next:
  - running-retries
---

## What it is

`--budget-usd <usd>` is a hard stop on what a campaign spends, in US dollars, over the whole campaign. The spend is the cost of the campaign's runs already in the store plus the runs this command finished. A worker checks the budget each time it takes a cell: once the spend has reached the budget, the cell is stopped and never starts. Cells already in flight finish, so the spend can pass the budget by the cost of those cells. What counts:

* The cost the target adapter reports for each block. This is dollars when it reports them. Otherwise it is its input, cached input and output tokens priced with a dated price table you supply.
* Not counted: runs replayed from the cache, carried runs (`--change`), reused runs of a resumed campaign, simulated-user calls and judge calls. The CLI prints `The budget counts what the target adapter reports; simulated-user and judge calls are not counted.` on stderr. It does so when a budget is set and a simulated user or a model judge is used.

There is no separate spend ledger file. The spend is the sum of the `cost` of the campaign's runs in the store (`campaign status` prints it as `Spent`). No vendor prices are bundled.

`campaign plan` projects the cost before anything runs, from cost units measured in a store (topic running-campaign-plan), and compares it with `--budget-usd`.

## When to use it

* Always on a campaign that calls a paid model: a budget stops a runaway campaign.
* With token-only adapters (most model adapters report tokens): supply prices, or the budget cannot see the spend. With a budget, driftbench refuses to start when a declared model has no price.
* To estimate cost without a budget: give prices alone; the run records priced costs.
* Judge spend has its own budget, `--judge-budget` on the commands that call model judges (judging area).

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--budget-usd <usd>` | `campaign plan` | none | compare the projected cost with this budget: `Within the budget of $<usd>.` or `Over the budget of $<usd>.` |
| `--budget-usd <usd>` | `campaign run` | none | a hard stop on the campaign's spend; a number of at least 0. The campaign stores it (0 when none is given). |
| `--budget-usd <usd>` | `campaign resume` | the budget the campaign was run with | the same stop for the rest of the campaign, the stored runs included. A stored 0 reads as no budget. |
| `--prices <file>` | `campaign run`, `campaign resume` | the `prices:` key of `driftbench.yaml` (or of the `--config` file for `run`) | a standalone price table, the same content without the outer `prices:` key. It wins over the project file. |
| `budget_usd:` | the `campaign:` config key | none | the same as `--budget-usd` for `run` and `plan`. |

A price table:

```text
prices:
  as_of: '2026-10-13'
  models:
    fictional-model:
      input: 2
      output: 4
      cached_input: 0.5
```

All rates are USD per million tokens, finite and at least 0 (0 is allowed); all three rates and the `as_of` date are required. The model a block's tokens are priced under is the adapter's `cost.model`. Otherwise it is a unique model named in its segment costs. Otherwise it is the spec's `target.options.model`. Set that option when the adapter does not report its model. Input tokens include cached input tokens; the estimate is `((inputTokens - cachedInputTokens) * input + cachedInputTokens * cached_input + outputTokens * output) / 1000000`. Dollars the adapter reports, zero included, always win over the table.

## Inputs

* The budget number.
* A price table, when an adapter reports tokens and no dollars.
* For `plan`, a store with cost units (`units` table), to project; without units the projection is $0.00 and names the adapter.

## Outputs and how to read them

* The campaign header shows ` Budget $<usd>.` when a budget is set.
* A cell the budget stopped: `! <cell>  stopped  not started: the campaign spent $<spent> of its $<budget> budget`. No run is stored for it, so `campaign status` shows it `pending`, and `campaign resume` with a higher budget (or none) runs it.
* The summary counts `<n> stopped by the budget` and ends with `Spent $<usd>.`, the spend of this command's fresh runs. Amounts under one cent print with four decimals.
* With a budget, every declared target model (`target.options.model` of each target) is checked for a price before anything is sent. A model that only becomes known at run time and has no price stops the run at its first priced block (one call is spent). The command exits 2. No further cell starts.
* In `--json`, each cell has `cost`, and a stopped one `budgetStop: { budgetUsd, spentUsd }`; the summary has `stoppedByBudget`.

Exit codes: a budget stop makes `campaign run` and `resume` exit 1; a missing or invalid price exits 2.

## Worked example

A projection against a budget. A campaign whose cells a budget of $0 stops before they start. The same campaign resumed with a budget of $5. The Acme agent reports no cost, so every amount is $0.00. No model is called.

```sh
driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --budget-usd 0.5
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --repeats 2 --budget-usd 0 --store b.db --campaign capped  # exit 1
driftbench campaign resume capped --store b.db --budget-usd 5
```

```text
Projected cost: $0.00 (function: no unit measured). Within the budget of $0.50.
```

```text
Campaign capped: 2 cells, 4 at a time. Budget $0.00. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
! acme-plan-upgrade · function:acme · F · repeat 0  stopped  not started: the campaign spent $0.00 of its $0.00 budget
! acme-plan-upgrade · function:acme · F · repeat 1  stopped  not started: the campaign spent $0.00 of its $0.00 budget
2 cells: 0 pass, 0 fail, 0 failed, 2 stopped by the budget. Spent $0.00.
```

```text
Campaign capped: 2 cells, 4 at a time. Budget $5.00. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
2 cells: 2 pass, 0 fail, 0 failed. Spent $0.00.
```

A budget of 0 is reached before any cell starts, so both are stopped and nothing is stored for them. `resume` with a budget runs them.

## Common errors

* `Budget cannot price declared models "fictional-model": supply dated prices in driftbench.yaml or --prices <file> before starting.` (exit 2, nothing sent). A target declares `options.model` and no price table names it.
* `Budget cannot price model "<model>": supply dated prices in driftbench.yaml or --prices <file>; identify the model with cost.model or target.options.model.` (exit 2, after one call). A model reported at run time has no price, or the model cannot be identified. Add it to the table, or set `target.options.model`.
* `<path>: prices.models.fictional-model.input: Too small: expected number to be >=0` (exit 2) An invalid rate; the same form names a missing rate or a bad `as_of`.
* `<path>: not YAML: ...` (exit 2) The price file does not parse.
* `--budget-usd takes a number of at least 0, not "-1".` (exit 2)
* A budget that never stops anything although the agent costs money. One cause: the adapter reports tokens with no model the table prices and no budget was set. The other cause: it reports nothing. Check a run's `cost` with `campaign status --json`.
* Resuming a priced campaign without the price file: stored token-only runs are priced again before the budget check; keep `--prices` or the `prices:` key available.
