---
title: The review queue
summary: "The review queue of blocks waiting for a hand label. queue create fills it from a stored campaign. queue assign gives an item to one reviewer. queue vote records a second reviewer's label. queue agreement measures how often two reviewers agree. queue list shows every item. The labels then feed judge calibrate."
commands:
  - queue create
  - queue list
  - queue assign
  - queue vote
  - queue agreement
see_also:
  - judging-calibration
  - judging-judge-calibrate
  - judging-criteria
next:
  - judging-cassettes
---

## What it is

Calibration needs hand labels: a person's pass or fail on real blocks, per criterion. The review queue organises that work. It is a file, `queue.json`, inside a labels folder (the same folder `judge calibrate --labels` reads). Each queue item is one block of one run and one criterion, with a state:

* `open`: nobody holds it.
* `assigned`: one reviewer holds it; nobody else can take it.
* `done`: its label is saved. An item becomes done when its reviewer saves the label in the local viewer (`driftbench view`, page Queue). That save writes the label into the labels file of the criterion.

A second reviewer can give an independent label on the same item with `queue vote`. Votes are stored in the queue only, never in the labels file. `queue agreement` reports how often the first two reviewers agree, with Cohen's kappa. Labels from two reviewers who rarely agree make a weak bar for judges.

## When to use it

* After a campaign stored in a store, to collect hand labels on its blocks for the criteria its specs name.
* To share the labelling between several people without two of them labelling the same item.
* To check that the criterion is clear enough for people to agree, before asking a judge to agree with them.
* To label an item, open it in `driftbench view` (results area); this group only manages the queue.

## Commands and every option

```
driftbench queue create --store <file> --campaign <id> [--labels <dir>]
driftbench queue list [--labels <dir>]
driftbench queue assign <block> --criterion <name> --reviewer <name> [--labels <dir>]
driftbench queue vote <block> --criterion <name> --reviewer <name> --label <pass|fail> [--labels <dir>]
driftbench queue agreement [--labels <dir>]
```

`queue create`: queue every block of a campaign, once per criterion, that has no label yet.

| Option | Meaning | Default |
|---|---|---|
| `--store <file>` | Required. The store that holds the campaign. | none |
| `--campaign <id>` | Required. The campaign whose blocks are queued. | none |
| `--labels <dir>` | The labels folder the queue sits in; made when missing. | `labels` |

`queue list`: list every item with its state and holder.

| Option | Meaning | Default |
|---|---|---|
| `--labels <dir>` | The labels folder. | `labels` |

`queue assign`: take an item for a reviewer. Refused when another reviewer holds it, or when it is done. Assigning an item again to its own holder is allowed.

| Option | Meaning | Default |
|---|---|---|
| `<block>` | Required argument. The block id, `<runId>.b<index>`, as `queue list` prints it. | none |
| `--criterion <name>` | Required. The criterion of the item. | none |
| `--reviewer <name>` | Required. Who takes the item. | none |
| `--labels <dir>` | The labels folder. | `labels` |

`queue vote`: record a reviewer's label on an item, as a second view of the same block. It does not change the item's state and does not write the labels file. One vote per reviewer per item.

| Option | Meaning | Default |
|---|---|---|
| `<block>` | Required argument. The block id. | none |
| `--criterion <name>` | Required. The criterion of the item. | none |
| `--reviewer <name>` | Required. Who votes. | none |
| `--label <pass\|fail>` | Required. The label: `pass` or `fail`. | none |
| `--labels <dir>` | The labels folder. | `labels` |

`queue agreement`: the agreement between the first two reviewers of each item that has two votes.

| Option | Meaning | Default |
|---|---|---|
| `--labels <dir>` | The labels folder. | `labels` |

Exit codes, all five commands:

| Code | When |
|---|---|
| 0 | Done. |
| 2 | Bad input. There is no store, or a store cannot be opened. Or the campaign is unknown, or the item is unknown. Or an item is held by another reviewer or already done. Or a vote is repeated. Or a label is other than pass or fail. Or a queue file is not a review queue. |

## Inputs

* For `create`: a store with the campaign (written by `campaign run --store`), its specs, and its runs. The criteria of a block are the criteria its spec defines, plus the name of any judge verdict the block carries, sorted. A block that already has a label for that criterion in the labels folder (same block id) is not queued. Items already in the queue are not queued twice.
* The labels folder: `queue.json`, and one YAML labels file per criterion (see `judging-calibration`).

`queue.json` holds `version: 1` and `entries`. Each entry has `id` (`<runId>.b<index>`), `criterion`, `campaign`, `runId`, `index` and `state` (`open`, `assigned` or `done`). When set, it also has `assignee` and `votes` (each `reviewer`, `label`, and an optional `score`). The file is written through a temporary file, so a reader never sees half a file.

## Outputs and how to read them

* `create`: `Queued <n> items in <labels>.`
* `list`: one tab-separated line per item, `<state> <criterion> <block id> <assignee or ->`, then `<n> items: <a> open, <b> assigned, <c> done.`
* `assign`: `<block> (<criterion>) is assigned to <reviewer>.`
* `vote`: `<reviewer> voted <label> on <block> (<criterion>).`
* `agreement`: Kappa is Cohen's kappa between the first two reviewers, and `n/a` when chance agreement is certain. It prints `Agreement over <n> items with two votes: <k> agree (<p>%), kappa <x>.`, or `No item has two votes yet: no agreement to report.`
* Errors print the reason on stderr.

## Worked example

Store a run of the plan upgrade spec and queue its blocks. Take one, record two reviewers' votes on two items, and read their agreement. There is no model call, and the run id is the same on every run:

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --store acme.db --campaign upgrade-demo
driftbench queue create --store acme.db --campaign upgrade-demo --labels labels
driftbench queue list --labels labels
driftbench queue assign a66a7aba9986a136.b0 --criterion one_question_per_turn --reviewer sam --labels labels
driftbench queue assign a66a7aba9986a136.b0 --criterion one_question_per_turn --reviewer jo --labels labels  # exit 2
driftbench queue vote a66a7aba9986a136.b0 --criterion one_question_per_turn --reviewer sam --label pass --labels labels
driftbench queue vote a66a7aba9986a136.b0 --criterion one_question_per_turn --reviewer jo --label pass --labels labels
driftbench queue vote a66a7aba9986a136.b1 --criterion one_question_per_turn --reviewer sam --label pass --labels labels
driftbench queue vote a66a7aba9986a136.b1 --criterion one_question_per_turn --reviewer jo --label fail --labels labels
driftbench queue agreement --labels labels
driftbench queue vote a66a7aba9986a136.b1 --criterion one_question_per_turn --reviewer jo --label maybe --labels labels  # exit 2
driftbench queue list --labels labels
```

```text
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --store acme.db --campaign upgrade-demo
Campaign upgrade-demo: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
$ driftbench queue create --store acme.db --campaign upgrade-demo --labels labels
Queued 10 items in labels.
(exit 0)
$ driftbench queue list --labels labels
open	no_invented_data	a66a7aba9986a136.b0	-
open	one_question_per_turn	a66a7aba9986a136.b0	-
open	no_invented_data	a66a7aba9986a136.b1	-
open	one_question_per_turn	a66a7aba9986a136.b1	-
open	no_invented_data	a66a7aba9986a136.b2	-
open	one_question_per_turn	a66a7aba9986a136.b2	-
open	no_invented_data	a66a7aba9986a136.b3	-
open	one_question_per_turn	a66a7aba9986a136.b3	-
open	no_invented_data	a66a7aba9986a136.b4	-
open	one_question_per_turn	a66a7aba9986a136.b4	-
10 items: 10 open, 0 assigned, 0 done.
(exit 0)
$ driftbench queue assign a66a7aba9986a136.b0 --criterion one_question_per_turn --reviewer sam --labels labels
a66a7aba9986a136.b0 (one_question_per_turn) is assigned to sam.
(exit 0)
$ driftbench queue assign a66a7aba9986a136.b0 --criterion one_question_per_turn --reviewer jo --labels labels  # exit 2
a66a7aba9986a136.b0 is assigned to sam
(exit 2)
$ driftbench queue vote a66a7aba9986a136.b0 --criterion one_question_per_turn --reviewer sam --label pass --labels labels
sam voted pass on a66a7aba9986a136.b0 (one_question_per_turn).
(exit 0)
$ driftbench queue vote a66a7aba9986a136.b0 --criterion one_question_per_turn --reviewer jo --label pass --labels labels
jo voted pass on a66a7aba9986a136.b0 (one_question_per_turn).
(exit 0)
$ driftbench queue vote a66a7aba9986a136.b1 --criterion one_question_per_turn --reviewer sam --label pass --labels labels
sam voted pass on a66a7aba9986a136.b1 (one_question_per_turn).
(exit 0)
$ driftbench queue vote a66a7aba9986a136.b1 --criterion one_question_per_turn --reviewer jo --label fail --labels labels
jo voted fail on a66a7aba9986a136.b1 (one_question_per_turn).
(exit 0)
$ driftbench queue agreement --labels labels
Agreement over 2 items with two votes: 1 agree (50%), kappa 0.00.
(exit 0)
$ driftbench queue vote a66a7aba9986a136.b1 --criterion one_question_per_turn --reviewer jo --label maybe --labels labels  # exit 2
--label takes pass or fail, not "maybe".
(exit 2)
$ driftbench queue list --labels labels
open	no_invented_data	a66a7aba9986a136.b0	-
assigned	one_question_per_turn	a66a7aba9986a136.b0	sam
open	no_invented_data	a66a7aba9986a136.b1	-
open	one_question_per_turn	a66a7aba9986a136.b1	-
open	no_invented_data	a66a7aba9986a136.b2	-
open	one_question_per_turn	a66a7aba9986a136.b2	-
open	no_invented_data	a66a7aba9986a136.b3	-
open	one_question_per_turn	a66a7aba9986a136.b3	-
open	no_invented_data	a66a7aba9986a136.b4	-
open	one_question_per_turn	a66a7aba9986a136.b4	-
10 items: 9 open, 1 assigned, 0 done.
(exit 0)
```

The spec names two criteria, so its 5 blocks give 10 items. The reviewers agree on block 0 and disagree on block 1. Here 1 of 2 items agree, and kappa is 0.00, no better than chance on this tiny sample. Votes leave the item's state as it was.

## Common errors

* `No store at <path>. Give one with --store <file>.` (exit 2). Store the campaign first with `campaign run --store <file>`.
* `Cannot queue <campaign>: <reason>` (exit 2). The campaign id is not in the store.
* `no queue item <criterion> for block <id>` (exit 2). The block id or the criterion is wrong; copy both from `queue list`.
* `<block> is assigned to <reviewer>` (exit 2). Another reviewer holds the item.
* `<block> is already done` (exit 2). The item's label is saved.
* `<reviewer> already voted on <block>` (exit 2). One vote per reviewer per item.
* `--label takes pass or fail, not "maybe".` (exit 2).
* `<labels>/queue.json is not a review queue` (exit 2). The file was edited by hand into another shape; restore it.
