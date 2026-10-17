# Block

A block is the unit driftbench evaluates. It is one stimulus to the agent and everything the agent does before the next stimulus.

A spec is a succession of blocks. Each block is a unit test in three parts: Given (the initial conditions), When (the stimulus) and Then (the expected output and state delta). See [Given, When, Then](given-when-then.md).

## Two kinds of block, one model

A spec sets `kind: conversation` or `kind: task`. Both kinds use the same block, the same runner, the same checks, the same judges and the same statistics.

| | Conversational exchange | Task step |
|---|---|---|
| Agent | a conversational agent | a code-interpreter agent: it writes and runs code, works in a workspace and loads skills |
| When | a user message | an instruction |
| What the agent does | text, cards, tool calls and their results | text, tool calls, skills loaded, commands run, files written in the workspace |
| Then reads | reply text, tool calls, cards, language, stage reached, facts held | skills loaded, guards that fired, code run and its exit code, files produced, workspace diff, destructive operations |
| The block ends | when the agent waits for the next user message | when the agent hands back control |

Every field of `expect` is open to both kinds. A conversation block can check a workspace, and a task step can check the reply text. The full list is in [checks](../reference/checks.md).

## Tools, skills, guards and stages

Whatever runtime the agent runs on, driftbench reads it through four concepts. The adapter maps the runtime's own names onto them; see [adapters](../adapters/index.md#runtime-vocabulary).

| Concept | What it is | Checked with |
|---|---|---|
| Tool | every external call the agent makes, whatever it reads or writes | `expect.tools` |
| Skill | a capability the agent loads | `expect.skills` |
| Guard | a runtime check that fired during the block, with its verdict | `expect.guards` |
| Stage | the named point of its own process the agent reaches; the spec declares the catalogue in `stages` | `expect.stage` |

A block's runtime trace holds skills, guards and stages. Tool calls sit beside it, in the observed segments.

## A conversation spec

```yaml
id: plan-upgrade
kind: conversation
title: An existing customer moves to a faster internet plan
channel: chat
lang: EN
stages: [discover, offer, confirm]
ledger_seed:
  customer_type: existing
criteria:
  - name: one_question
    rubric: Does the reply ask at most one question?
    fail: The reply asks two questions or more.
    pass: The reply asks one question, or none.
blocks:
  - id: ask
    user: Hi, my internet is too slow. What faster plans do you have?
    expect:
      stage: offer
      tools:
        - label: lookup_plans
          count: 1
          input:
            current_plan: { nonempty: true }
      must: ["Fiber 500"]
      must_not: ["[Aa]s an AI"]
      lang: EN
      criteria: [one_question@gating]
  - id: choose
    user: The 500 one. Yes, go ahead.
    expect:
      stage: confirm
      ledger_add: { plan: fiber_500 }
      tools:
        - label: submit_order
          count: 1
          input:
            plan: fiber_500
rules:
  max_calls: { submit_order: 1 }
  lang_stable: true
end_state:
  source: tool:submit_order
  mode: subset
  expect:
    plan: fiber_500
```

The first block expects one call to `lookup_plans` with a `current_plan`, a reply that names the plan and stays in English, and the agent at stage `offer`. A judged criterion gates the block. The second block expects the order: the facts gain `plan`, and `submit_order` runs once with `plan: fiber_500`. After the run, `end_state` compares what the `submit_order` tool recorded with the expected fields.

## A task spec

```yaml
id: sales-workbook
kind: task
title: Turn two CSV files into a quarterly sales workbook
workspace_seed:
  files:
    data/north.csv: "month,revenue\nJanuary,1200\nFebruary,1300\nMarch,1250\n"
    data/south.csv: "month,revenue\nJanuary,900\nFebruary,950\nMarch,1000\n"
criteria:
  - name: totals_match_file
    rubric: Does the reply state the same quarterly totals as the workbook?
    fail: A total in the reply differs from the total row of its sheet.
    pass: Every total in the reply equals the total row of its sheet.
blocks:
  - id: build
    user: Build sales.xlsx with one sheet per region and a total row on each sheet.
    expect:
      skills:
        - name: xlsx
          count: 1
      execution:
        ran_code: true
        exit_code: 0
        max_commands: 10
      guards:
        - name: workspace_boundary
          verdict: deny
          count: 0
      artifacts:
        - path: sales.xlsx
          kind: xlsx
          checks:
            - sheets: [North, South]
      workspace:
        created: [sales.xlsx]
        others_untouched: true
      safety:
        max_destructive_ops: 0
      criteria: [totals_match_file@gating]
    budget:
      steps: 20
      cost_usd: 0.5
  - id: summary
    user: Add a Summary sheet with the total of both regions.
    expect:
      artifacts:
        - path: sales.xlsx
          kind: xlsx
          checks:
            - sheets: [North, South, Summary]
      workspace:
        changed: [sales.xlsx]
        others_untouched: true
```

The task starts in a workspace that holds two CSV files. The first step expects the `xlsx` skill once, code that runs and exits with 0, no denial from the `workspace_boundary` guard, a workbook with one sheet per region, and no other file touched. A judged criterion checks that the reply states the totals the file holds. The second step changes the same workbook and touches nothing else.

Both examples pass `driftbench spec lint --strict`. A test in `tools/docs` runs them through the loader on every change. Seven complete specs, six conversations and one task, run against a deterministic example agent in [`examples/acme`](../../examples/acme/README.md).

Blocks can also be written by code. `driftbench generate` enumerates conversation blocks from an approved map of situations, and derives each block's Then from the map's relations: the stage reached, the tool calls and their inputs, the end state. A task family builds task instances whose expected outcome an oracle computes from the seed files. See [generating tests](../generating.md).

## What a block records

The runner records each block it runs, in the shapes of `packages/core/src/schema/run.ts`. See [running](../running.md#the-run-record).

* Observed: the segments in order (text, tool call, tool result, card), the customer-visible text, the tool calls with input, output and latency, the runtime trace (skills loaded, guards fired with their verdicts, stages reached), the artifacts, the workspace diff, the commands run with their exit codes, the sandbox, the cost and the latency.
* Verdicts: one or more per check, each with its evidence. Judged criteria add theirs, `judge.<name>`, when the run's checks include a judge council. See [checks](../reference/checks.md) and [judges](judges.md).
* Drift: the drift classes its failing verdicts give. See [drift](drift.md).
* Pass: a block passes when every gating verdict passes. A gating verdict that is inconclusive fails the block; a verdict that does not gate never does.

## A spec is checked before it runs

The loader rewrites the shorthand forms before it validates, so the resolved spec equals the long form. The forms are listed under [shorthand](../reference/spec.md#shorthand).

An unknown key is an error at any depth of the spec, in a block, a world, a perturbation or a criterion. The code is `SCHEMA_UNRECOGNIZED_KEYS` and the message reads `unknown key: <key>`. A spec with an error is not loaded: the loader returns the errors and no spec, so it never keeps an unknown key.

`driftbench spec validate` and `driftbench spec lint` check the schema, the regular expressions, the criterion references, the stage names against `stages`, the counts and the perturbation positions. See [CLI](../reference/cli.md).
