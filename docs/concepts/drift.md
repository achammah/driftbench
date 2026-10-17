# Drift

Drift is a block that goes wrong. driftbench looks for it on single blocks and across the succession of blocks, and names its class. The class names are fixed in the schema (`DriftClass`). The runner assigns all five, in every mode, from the gating verdicts a block fails, the runner's own ledger and flow verdicts included. The same rules apply to a conversation and to a task.

## Five drift classes

A failing block carries one class or more.

| Class | What went wrong | Conversation example | Task example |
|---|---|---|---|
| `X1_local` | a wrong answer or action in this block, while every earlier fact still holds | the reply quotes the wrong price | the total row of the workbook is wrong |
| `X2_contradiction` | the block contradicts a fact established earlier | the agent uses the address the user corrected two blocks before | the user asked for amounts in euros, and the new sheet shows dollars |
| `X3_flow` | the wrong stage: one skipped, one repeated, or the flow going back | the agent submits the order before the recap | the agent writes the summary before it loads the data |
| `X4_format` | a format or persona rule breaks | a double send, card misuse, a reply in the wrong language | the final reply narrates internal steps |
| `X5_tool` | a tool call, a skill or a guard is missing, extra or repeated, or a call has wrong parameters | `submit_order` runs twice | the `xlsx` skill never loads, or a guard denies a command the task needed |

## How a class is assigned

`driftOf(verdicts)` of `@agent-nexus/driftbench-core` reads the family of each failing gating verdict: the text of its id before the first dot. Each family maps to one class (`DRIFT_BY_FAMILY`):

| Family | Class |
|---|---|
| `must`, `must_not`, `regex`, `length`, `starts_with`, `finish_reason`, `json`, `refusal`, `similarity`, `relevancy`, `execution`, `workspace`, `artifacts`, `schema_strict`, `budget`, `end_state`, `judge` | `X1_local` |
| `ledger`, the [ledger check](#the-ledger-check) | `X2_contradiction` |
| `stage`, the stage the runtime reports; `flow`, the [stage classifier](#the-stage-classifier); `knowledge_retention`, a known fact asked again | `X3_flow` |
| `lang`, `cards`, `pii`, `markup` | `X4_format` |
| `tools`, `forbidden`, `skills`, `guards`, `references`, `subagents`, `safety`, `tool_f1` | `X5_tool` |

* A block carries one class per family among its failing gating verdicts, in the order X1 to X5. It can carry several.
* A passing block carries none, and so does a block that fails only on non-gating or inconclusive verdicts.
* A custom check's ids start with `custom`, so a custom check never takes a family's class by its name. An unknown family gives no class.

The checks are listed in [checks](../reference/checks.md), and the judges in [judges](judges.md).

## The ledger check

The ledger is the set of facts from `given.ledger`, plus each block's `ledger_add`. See [Given, When, Then](given-when-then.md). After each block, the runner compares what the block stated with the ledger, in code, with no model. The ledger it compares with holds this block's `ledger_add` too.

* Tool inputs. Every scalar in a tool call's input, nested objects and lists included, whose key names a ledger fact holding a scalar, is compared with that fact. Keys match without case, `_` or `-`: `customer_id` matches `customerId`. Values match as text without case or surrounding space. Two values that both read as phone numbers (9 digits or more) match on their digits.
* Reply facts. This arm reads facts that hold an email address or a phone number. When the user messages of the conversation name other values of the same kind, a reply that states one of those other values, and not the ledger's, contradicts the fact: the agent took a value the ledger replaced or never held. A question that names both values is no contradiction. Other facts are read from tool inputs alone.

The check gives one gating verdict per fact the block's tool inputs or reply stated, `ledger.<fact>`: pass when the block states the ledger's value, fail with both values in the evidence when it does not. A failing ledger verdict gives `X2_contradiction`. The Acme plan upgrade, free-running, gets `ledger.customer_id` and `ledger.plan_id` on the block that places the order, both passing.

The block record's `ledgerCheck` lists the contradictions the check found, and also the facts a block's `ledger_add` gives a value other than the one the ledger already holds. That second kind is a fault of the spec, not of the agent, and fails nothing.

## The stage classifier

The stage a block reached is read in this order, and recorded as the block's `stageObserved`:

1. the last stage the runtime reports in this block;
2. in F and P, the last stage an earlier block of the run reported, which still holds;
3. else the classifier of stages, from the block's tool calls alone.

The classifier is code, with no model. Each stage of the spec's catalogue has a signature: the tools that the blocks and perturbations expecting that stage name with a count above 0.

* A block with tool calls takes the stage whose signature overlaps its called tools most, by Jaccard similarity. A tie goes to the first tied stage at or after the stage before the block in the catalogue, else to the first tied stage. Tool calls that no stage expects leave the block unclassified.
* A block with no tool call keeps the stage before it. The first block, with no stage before, takes the first stage of the catalogue that expects no tool.

The stage before a block is the stage the run's previous block reached, in F and P; in T it is the last stage an earlier spec block expects.

When the stage came from the classifier, the runner adds flow verdicts:

| Verdict | When | Outcome |
|---|---|---|
| `flow.stage` | the block expects a stage | gating, pass or fail, when the tools decided the stage; non-gating and inconclusive when the stage is only carried or assumed |
| `flow.order` | the block expects no stage | fails when the stage reached is earlier in the catalogue than the stage before: the flow went back with nothing in the spec asking for it |

The evidence names the stage reached, how it was read, and whether the agent skipped ahead, went back, or reached a stage off the catalogue. A stage the runtime reports gets no flow verdict: the `stage` check judges it. The Acme agent reports its stages, so its runs carry `stage.reached` verdicts and no flow verdict.

## Across the succession

Each run gets these metrics.

| Metric | Meaning |
|---|---|
| `firstDriftBlock` | the index of the first failing block |
| `driftCount` | the number of failing blocks |
| `driftRate` | `driftCount` divided by the number of blocks in the run |
| `longestClean` | the longest stretch of passing blocks |
| `minOverBlocks` | true when every block passes; the run passes only then |

The runner computes them on every run, from whether each block passed, injected blocks included. A failing block counts as drift whatever its class. See [running](../running.md#the-run-record).

One conversation, or one task, with a single wrong block fails `minOverBlocks`. The other metrics say where and how often it went wrong. `campaign status --detail` prints them for every run, with the number of blocks carrying each class. An Acme agent that loses the thread once it has written three replies of its own gives, on `acme-plan-upgrade`:

```
Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.
  spec               mode  repeat  perturbation   blocks  first drift  drifts  rate   longest clean  all pass  classes
  acme-plan-upgrade  T     0                      5       none         0       0.0%   5              yes       none
  acme-plan-upgrade  F     0                      5       3            2       40.0%  3              no        X1_local 2
  acme-plan-upgrade  P     0       billing-aside  6       3            3       50.0%  3              no        X1_local 3
  acme-plan-upgrade  P     0       loose-ok       6       3            3       50.0%  3              no        X1_local 3
```

Its blocks fail `must` checks only, so every drift block is `X1_local`. See [run modes](run-modes.md#the-compounding-index) for the same campaign's compounding index.

## Drift between versions and over time

Comparing two versions of an agent on the same specs, and watching a live agent over time, are statistics. See [statistics](statistics.md).
