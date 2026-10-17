---
title: Machine checks
summary: "The deterministic checks every run applies to every block with no model call: the 37 default checks in the order the runner applies them, the verdict shape and ids, gating and inconclusive rules, custom checks, the tool policy, and the ledger and flow verdicts the runner adds; a machine fail is final and no judge overturns it."
commands:
  - campaign run
  - campaign resume
  - replay
  - estate run
  - smoke
see_also:
  - judging-check-text
  - judging-check-tools
  - judging-check-runtime
  - judging-criteria
  - judging-council
next:
  - judging-check-text
---

## What it is

Every block of a spec gets two kinds of verdict, kept apart and both reported:

* Machine checks: deterministic code, no model. A check reads one part of what the agent did (its tool calls, its reply text, its runtime trace, its files) against the block's `expect` and the spec's `rules`, and returns verdicts with the evidence that decided them: the text that matched or is missing, the call, the diff.
* Judged criteria: a model reads the block against a rubric (see `judging-criteria`).

A machine verdict that fails is final: no judge verdict can turn it into a pass, because a block passes only when every gating verdict passes.

The default check set (`defaultChecks()` in `@agent-nexus/driftbench-checks`) holds 37 checks, applied in this order: `tools`, `tools_offered`, `forbidden`, `must`, `must_not`, `regex`, `exact`, `injection`, `length`, `markup`, `starts_with`, `finish_reason`, `json`, `tool_f1`, `refusal`, `rouge_l`, `bleu`, `sql`, `similarity`, `relevancy`, `knowledge_retention`, `lang`, `pii`, `cards`, `stage`, `skills`, `guards`, `references`, `subagents`, `execution`, `workspace`, `safety`, `artifacts`, `schema_strict`, `budget`, `end_state`, `custom`. A run-wide `tool_policy` check is inserted after `cards` when a tool policy is given. A judge check (`judge`) comes last when a judge is given (see `judging-council`, `judging-run-judge`).

A check applies to a block only when the block asks for it (for example `must` only when `expect.must` holds a pattern). `pii` and `lang.stable` (with `rules.lang_stable`) are the checks that read every block with text.

## When to use it

* Write `expect` fields in a block, and `rules` in a spec: each field turns on its check. The topics by family: `judging-check-text` (reply text), `judging-check-tools` (tool calls), `judging-check-runtime` (stages, skills, guards, files, code, safety, budget, end state).
* Read a failing run: every failing gating verdict is listed by id, and its evidence says why.
* Prefer a machine check over a judged criterion whenever code can decide: it is free, fast, and gives the same answer every time.

## Commands and every option

No option turns individual checks on or off: the spec decides. The commands that run the default checks:

| Command | Checks it applies |
|---|---|
| `driftbench campaign run`, `campaign resume`, `smoke`, `ci` and the other run commands | `defaultChecks()`. No judge: criteria get no verdict, and a `Not judged:` line says so. |
| `driftbench replay` | `defaultChecks()` with the replay registry (adds the custom check `ordered`), the judge check (`--judge`, see `judging-run-judge`), and `--owner` / `--owner-file` for the `pii` check. |
| `driftbench estate run` | The same family, with the estate's checks and `--judge`. |

## Inputs

* The block's `expect` (see `authoring-blocks` for the syntax of every field) and `budget`.
* The spec's `rules`: `forbidden_tools`, `max_calls`, `lang_stable`, `one_message_per_turn`, `custom`, `match_case`.
* The spec's `metadata.tool_schemas` (for `schema_strict`) and `end_state`.
* What the adapter observed: the visible text, tool calls, the runtime trace (stages, skills, guards, files read, helpers dispatched, offered tools), executions, the workspace diff, cost and latency.

Custom checks: a function registered by name and named under `rules.custom: { <name>: <options> }`. From the command line, a plugin registers it: a module whose default export receives an `api` and calls `api.check(name, fn)`, loaded with the global option `--plugin <module>` (repeatable) or the `plugins` list of `driftbench.yaml`. In code, `registerCheck(name, fn)` does the same. Its verdicts are filed as `custom.<name>.<id>`. A name nobody registered, a check that throws, or a value that is not a verdict gives a failed verdict that says so. `replay` registers `ordered` (a "before X, do Y" pair rule: `rules.custom.ordered.pairs: [{ before, after, key, reset }]`). `stated_length` is an opt-in custom check for writing tasks (fails a reply far under a length the request states).

Tool policy: rules `{ pattern, action }` (`allow`, `deny` or `ask`, a glob over the tool name, first match wins, no match allows, `ask` counts as deny). Given to `defaultChecks({ toolPolicy })` it adds `tool_policy.<label>` verdicts; given to the runner or an adapter it refuses or marks calls (see `judging-check-tools`).

## Outputs and how to read them

A verdict has `id`, the check `name`, `gating`, `outcome` (`pass`, `fail` or `inconclusive`), `evidence`, and for some checks a `score`.

* The id starts with the check name and a dot: `tools.order.create.count`, `must.0`, `stage.reached`. Indexes count from 0.
* When a block names the same tool, card, skill, guard, path, helper or artifact twice, the second gets `#2` in its id: `tools.order.create#2.count`.
* Machine verdicts gate by default. A block passes when every gating verdict passes, so a gating verdict that is inconclusive fails the block. A non-gating verdict never fails it. A measure computed from other verdicts, such as the share of expected tool arguments that matched, is a diagnosis on the block (`diagnoses`), never a verdict, so it cannot fail it either.
* Two kinds of inconclusive: the detector or the spec could not decide (not gating: `lang` with too little text, `budget.cost_usd` with no cost reported, `schema_strict` for a tool with no schema); or the adapter observed nothing the check needs (gating: `skills` and `guards` with no runtime trace, `tools_offered` with no offered list, `execution` with no executions, `workspace` with no diff). The block cannot pass on what was not observed.
* A check that throws gives the gating inconclusive verdict `<check>.error` (`the check threw ...`); a verdict the schema refuses gives `<check>.invalid`. The run goes on.
* After the checks the runner adds, in code: `ledger.<fact>` (a fact the reply or a tool input states that contradicts the ledger) and, when the runtime reports no stage, `flow.stage` and `flow.order` from the stage classifier.

The run commands print the list of checks first, then one line per cell: `✓` or `✗`, the spec, the target, the mode, the repeat, and for a failing cell the failing verdict ids by block (`block 0 starts_with.0, block 1 relevancy.terms`). `--json` gives every verdict with its evidence under `cells[].blocks[].verdicts`.

## Worked example

The Acme plan upgrade spec on the deterministic Acme sales agent (no model call):

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --no-cache
```

```text
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --no-cache
Campaign c-a9dbaca8898b: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

The campaign id changes on every run. The ids of the verdicts that decided it, block by block, are in `--json`; for example block 1 of this spec gives `tools.catalog.search.count`, `tools.catalog.search.input.category`, `forbidden.coverage.check`, `must.0` to `must.3`, `must_not.0`, `must_not.1`, `lang.stable`, `pii.iban`, `pii.national_number`, `pii.phone`, `pii.email`, `cards.one_message_per_turn` and `stage.reached`. The family topics show the evidence of each.

## Common errors

* `<check>.error` inconclusive and gating: a check threw, often a custom check. Its evidence quotes the error.
* `custom.<name>` failed with an evidence that nobody registered the name. Load the plugin that registers it (`--plugin <module>`, or `plugins` in `driftbench.yaml`), or remove it from `rules.custom`. `replay` registers `ordered` on its own.
* A gating inconclusive `skills.<name>`, `guards.<name>...`, `execution...` or `workspace...`: the adapter reported no trace, no executions or no diff. Use an adapter that reports them, or remove the expectation.
* A criterion that never fails a campaign: `campaign run` loads no judge (see the `Not judged:` line). Use `replay --judge` or `estate run --judge`, or a council in code.
