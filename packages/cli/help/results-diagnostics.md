---
title: "Diagnostics: who failed, and where the fix goes"
summary: "Five shipped diagnostics read a failed block and write who made the mistake, how it counts for the agent, and where one change stops it recurring."
commands: []
see_also:
  - results-report
  - results-scorecard
  - recipes-find-why-a-test-failed
---

## What it is

A diagnostic is a rule file of the object kind `diagnostic` that runs after the checks and writes diagnoses. A
diagnosis never changes a verdict or the block's machine pass. Five ship as TypeScript data in
`packages/checks/src/blame/diagnostics.ts`; the YAML under `packages/checks/objects/diagnostic/` is a reviewed test fixture:

| Diagnostic | Scope | What it writes |
|---|---|---|
| `code-agent-liability` | block | for each failing gating verdict: `fault` (agent, skill, tool, test, env, setup), `disposition` (agent, shared, setup, excluded, credited, unassigned), `fix_location`, `fix_target`, `fix_action`, `fix_forms`, the blame item and the placement item that decided it |
| `fix-plan` | campaign | one fix per target and action, ranked by the failing blocks it explains (the agent's first), then cost; a core fix that replaces local fixes lists them as copies to remove |
| `liability-confirm` | campaign | the cheapest run that could change each static diagnosis (the skill forced into context, the rule as a hint, a reference agent), made only within its budget, then `code-agent-liability` again |
| `value-mismatch` | block | for a failing tools value: `unknown` with `lint:value_ladder_unavailable` until the value ladder integration is available |
| `flaky-block` | campaign | blocks whose repeats both pass and fail, with their pass share |

`code-agent-liability` runs four steps: `chain` (only the earliest failing verdict of a chain is attributed;
later verdicts on the same tool, a tool expected after it, the tool order or the same file inherit it),
`evidence` (the evidence names, from the stored run and the estate map), `attribute` (`policy/blame`, first
match in order) and `place` (`policy/placement`). Both policies are rule files too; their items are listed in
`docs/reference/blame.md`.

## When to use it

When a block fails and the question is what to change: the test, the environment, a tool, a skill's
description, body or layout, the agent's core prompt, or the model. The placement law decides where: a mistake
in one skill is fixed in that skill; the same mistake in two or more skills is fixed in the core prompt, or in
a guard when code can check it.

## Commands and every option

The checks initializer registers the shipped objects and executable steps through `registerDiagnosticStep`.
The core runner runs block diagnostics selected by `uses.diagnostics`, and exposes `runCampaignDiagnostics`
for campaign diagnostics. Campaign steps consume core `CampaignDiagnosis` records with `runId`, `blockIndex`,
`verdictRef` and the nested diagnosis. Run-level records and records without a verdict do not enter block
recurrence counts. Stored block diagnoses retain the deciding rule in `by` and the executing step in `via`.

Direct library calls remain available: `blame.diagnoseBlock`, `blame.fixPlan`, `blame.planConfirm`,
`blame.runConfirm` and `blame.flakyBlocks`. The F5 context supplies no confirm runner; confirmation stays
static unless a direct library caller supplies one. A positive budget alone does not configure that service.

The params a user sets in a file that extends a shipped one:

| Diagnostic and step | Param | Shipped value | Meaning |
|---|---|---|---|
| `code-agent-liability` each step | `emit` | `false`, `true` on `place` | the step that writes the diagnoses; the others add to the block's working state |
| `fix-plan#rank` | `n` | `10` | how many fixes the list keeps, beside the copies to remove |
| `liability-confirm#run` | `budget_usd` | `0` | the most a billed confirm run may spend; 0 makes no billed run and the diagnoses stay `static` |
| `liability-confirm#plan`, `#run` | `runs` | `3` | runs per confirm question; 2 of 3 counts as passing |
| `flaky-block#disagreement` | `min_repeats` | `2` | the fewest repeats of a block before it can be flagged |

## Inputs

* The stored run of the block: its verdicts and what was observed (tool calls with their full input, file
  reads, commands with exit codes, the guard decisions, the workspace diff).
* For an estate spec, the atoms it enforces (`metadata.estate.atoms`) and the estate map
  (`metadata.estate.map`): each rule's file and line, its kind, its situation, and the guards that enforce it.
* Value evidence remains unknown with a lint until the separate value-ladder integration is available.
* For `liability-confirm`, a confirm runner: a stand-in command runs free; a reference target is billed.

## Outputs and how to read them

One diagnosis per failing gating verdict, on the block. A chained verdict carries `inherits` and the
diagnosis of its root. Read `disposition` first: `agent` and `shared` count against the agent; `setup`
(a rule nobody wrote), `excluded` (the test or the environment was invalid) and `credited` (the result works,
the check demanded a form nobody states) do not; `unassigned` (no item matched) is reported apart, never
folded into a score. `confidence` is `static` until a confirm run decides. `flags` carry
`run_liability_confirm`, `provisional` (placed with no history), `class_rule:<wording>` for a core fix, and
`escape:<kind>:<text>` when a proposed fix text names a skill, a file or a value.

The scorecard (`buildScorecard(data, { attribution })` of the report package) then opens a zone named "Two
scores": the machine pass rate, unchanged and final; the agent-attributed pass rate, over the runs a rule
decided; the unassigned runs, excluded only from the agent-attributed rate; the failing blocks by disposition;
and the ranked fix list. A run page lists each block's diagnoses under its verdicts. A page scored with a rule file
that is not a shipped default carries a `non-default` badge naming it.

The agent-attributed score always names its denominator: for example, `20 of 20 assigned runs; 26
unassigned`. When unassigned runs outnumber assigned failed runs, HTML and text show counts without any
percentage or interval. JSON keeps the assigned counts (`agent.k`, `agent.n`) and `unassigned`, and omits
the agent estimate and interval fields. With no assigned runs the counts are 0 of 0. The machine rate still
includes every run that passed or failed, unassigned runs among them. A run with a block not run or
blocked and no failure is in neither rate: JSON keeps it in `unmeasuredRuns` (`notRun`, `blocked`) and the
text and HTML reports name it.

## Worked example

The Northwind estate's three recorded sessions, replayed offline over specs generated from the estate tests'
hand plan: two replay specs fail as planned.

```sh
driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out out
driftbench replay examples/estates/fixture/sessions/weekly-skill-skipped.jsonl examples/estates/fixture/sessions/weekly-gate-violated.jsonl --decisions examples/estates/fixture/sessions/weekly-skill-skipped.decisions.jsonl examples/estates/fixture/sessions/weekly-gate-violated.decisions.jsonl --steps examples/estates/fixture/sessions/weekly-skill-skipped.steps.jsonl examples/estates/fixture/sessions/weekly-gate-violated.steps.jsonl --suite out/specs/replay # exit 1
```

`code-agent-liability` on the two failing blocks writes these diagnoses (not a command's output: the
package test `packages/checks/test/blame/northwind.test.ts` asserts them):

```text
estate.p02.weekly-gate-violated  custom.ordered.Read.Edit
  rule: policy/blame:default@<hash8>#core_rule_caught   disposition: agent   fault: [agent]
  fix_location: none   fix_action: none_enforced   (read-before-edit.py denied the edit, then allowed it)

estate.p01.weekly-skill-skipped  skills.weekly-report
  static:    rule: ...#skill_not_loaded_undecided   disposition: shared   confidence: undecided   flags: [run_liability_confirm]
  confirmed: rule: ...#skill_not_loaded_uncovered   disposition: setup    fix_location: skill.trigger
             fix_target: skill:weekly-report#description   fix_action: rewrite_description
```

The confirmed reading needs a confirm run (the reference agent loads the skill 0 of 3 times on this ask);
with the shipped budget of 0, `liability-confirm` makes no run and the diagnosis stays undecided.

## Common errors

* A diagnosis says `unassigned`: no blame item matched. Add an item to a project `policy/blame` that extends
  `default`, or link the failing expectation to the line it enforces so `rule_home` is known.
* Every diagnosis is `provisional`: no history was given, so placement counts one home. `fix-plan` over a
  campaign counts the homes and moves a recurring fix to the core prompt.
* `liability-confirm` changed nothing: no confirm runner is configured, or its budget prevents billed runs.
  A direct library caller must supply a runner and a cost quote for billed calls; a free stand-in needs no budget.
* A project object that extends `policy/blame:default` names an item the default does not hold: the load is
  refused and the message lists the items it holds.
