---
title: Calibration
summary: "How a judge earns a criterion. It must separate the criterion's fixture pair in every repeat and agree with the hand labels at kappa 0.8 or more. The assignment table records who owns each criterion. An unassigned criterion is judged but never gates."
commands:
  - judge calibrate
  - judge run
see_also:
  - judging-judge-calibrate
  - judging-criteria
  - judging-council
  - judging-cassettes
  - judging-families
  - judging-self-tests
  - judging-queue
next:
  - judging-judge-calibrate
---

## What it is

No judge is trusted before it passes its own test. Calibration measures every judge alone, per criterion, on two tests, and assigns each criterion to judges that pass both:

* Separation on the fixture pair. The judge answers the pass fixture and the fail fixture once per repeat (3 by default). Its separation is the number of repeats in which the pass fixture passed and the fail fixture failed. An inconclusive answer never separates.
* Agreement with the hand labels. The judge answers every labelled block once. Agreement is Cohen's kappa between its answers and the labels, over pass, fail and inconclusive, so an inconclusive answer always disagrees with a label. The share of blocks it agrees on carries a Wilson 95% interval.

The bar: separation in every repeat, kappa at least 0.8 (`KAPPA_MIN`), and no call without an answer. A judge answers as it would vote in a council. An answer that does not parse is asked again with the large token budget. One that still fails, or no answer at all, is inconclusive.

## When to use it

* Before a criterion gates anything: a gating criterion that calibration leaves unassigned never gates.
* After a rubric, a fixture, an input or the labels change, the request key changes. The recordings no longer match. The criterion is recorded and calibrated again.
* To pick the cheapest judge that is good enough (`--assign cheapest`), or to measure a cascade (`--cascade`).
* A criterion with no judge at the bar gets a better rubric, not a lower bar: the bar is not a command option.

## Commands and every option

* `driftbench judge calibrate` runs calibration and writes the assignment table. Every option is in `judging-judge-calibrate`. The options that shape calibration: `--repeats <n>` (default 3), `--mode <mode>` (default `hybrid`), `--assign council|cheapest` (default `council`), `--agent-family <family>` (default `none`), `--only <criterion>`, `--cascade`.
* `driftbench judge run --assignments <file>` replays a council seated by the table. Its `--mode` must equal the table's mode.

The kappa bar (0.8) and the unsure band of the cascade (0.2 to 0.8) have no command option. They are library settings (`kappaMin` of `calibrate`, `unsure` of the label-aware `calibrateCascade`).

## Inputs

* The criteria folder, with a fixture pair per criterion (see `judging-judge-check`).
* The labels folder: one YAML file per criterion, named after it.

| Key | Required | Meaning |
|---|---|---|
| `criterion` | yes | The criterion name; must equal the file name without extension. |
| `labelled_by` | no | Who labelled, for a reader. |
| `blocks` | yes, at least 1 | The labelled blocks. |

Each block has the keys of a fixture (`transcript` required; `note`, `artifact`, `inputs`, `given` optional) plus:

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | The block id, unique across the whole labels folder. |
| `label` | yes | The human verdict: `pass` or `fail`. |
| `anchor` | no | The element the label is about. It is one of these. `{ kind: message, index: <n> }` means a transcript line, from 0. `{ kind: tool_call, tool: <name>, occurrence: <n> }` means the n-th call of that tool, default 1. `{ kind: field, path: <dot path> }` means a field of the ledger. `{ kind: span, span_id: <id> }` means a trace span, never checked. The judge still reads the whole block; the anchor records what the human looked at. |

A labels file is refused when its name differs from its criterion. It is also refused when every block carries the same label (kappa then has nothing to measure). It is also refused when a block id is used twice. It is also refused when a message, tool or field anchor names nothing in its block. Labels for a criterion the folder does not define are refused. A block without its own `inputs` reads those of the criterion's pass fixture.

## Outputs and how to read them

How a criterion is assigned:

* `council` (the default): a class takes a criterion only when three of its judges meet the bar. The owner is the cheapest judge at the bar in such a class (by cost, then id). It is seated with the next two cheapest at the bar of that class. In hybrid mode the re-judge row is three judges of the other class, those at the bar first.
* `cheapest`: the one cheapest judge at the bar owns the criterion alone. It acts as a council row of one judge, whose vote is the verdict, with no re-judge. The table records its measured `cost_per_call_usd` when the client reports a cost.
* No class (or no judge, under `cheapest`) at the bar: the criterion is unassigned. The reason reads, for example, `no class has 3 judges at the bar (system1 has 2 of 3 judges at the bar, system2 has 2 of 3 judges at the bar): s1p-b kappa 0.40 is under 0.8; google-chat kappa 0.50 is under 0.8`. It is still judged; its verdict never gates.
* A row whose judges all share one model family is marked `single_family: <family>` in the table and `[single family: <family>]` in the report. They share that family's blind spots.
* A judge of the agent's family (`--agent-family`) is left out entirely, and the report names it.

Why a judge misses the bar, as the report prints it:

* `separates the fixture pair <k> of <n> times`
* `kappa <x> is under 0.8`
* `has no kappa: the labels hold fewer than two classes`
* `<k> call(s) gave no answer`

Other measures in the report (`--json`):

* Per criterion: Krippendorff's alpha across all judges, over the fixtures and the labelled blocks, with inconclusive as missing. Label hygiene uses these keys. `labelConflicts` holds labelled blocks with the same slice and opposite labels. `fixtureLeaks` holds labelled blocks equal to a fixture, which inflate agreement. `warnings: [few-labels]` appears when a label class has fewer than 5 blocks. These appear in JSON only.
* Per judge and criterion: PABAK and Gwet's AC1 beside kappa, for skewed labels. Also the confusion counts with fail as the positive class (inconclusive counts as wrong) and the rates drawn from them. Also each block's label, answer and anchor, and the calls and cost.
* Per judge, `pooled`: kappa over every labelled block of every criterion.

The assignment table (YAML): `version: 1`, `mode`, `repeats`, `kappa_min`, `rule: cheapest` when used, and `criteria`. An assigned entry: `criterion`, `status: assigned`, `owner`, `class`, `judges`, `rejudge`, optional `single_family`, optional `cost_per_call_usd`, `separation` (`k of n`), `kappa`. An unassigned entry: `criterion`, `status: unassigned`, `reason`. `judge run --assignments` turns it into council rows with source `calibration`, plus the unassigned criteria.

The cascade (`--cascade`): the first judge answers every item. The others answer an item in two cases only. The first judge is unsure of it (inconclusive, or a score between 0.2 and 0.8). Or the first judge disagrees with the truth (the fixture's side or the label). An escalated item takes the majority of every judge that answered it, two agreeing votes needed. Escalating on disagreement uses the label, which a real run does not have. The report therefore also gives `unsureOnly`: the same answers scored as a deployed cascade would, escalating only unsure items. In code, `calibrateCascade({ judge, criteria, labels, repeats })` measures a deployable procedure (such as an escalation client) whose routing never sees labels. Its full and unsure-only scores coincide.

Reading the numbers: per criterion, kappa often rests on 3 or 4 labelled blocks. With 3 blocks, 3 of 3 agreement has a Wilson lower bound of 0.44. More labels per criterion make the bar mean more.

## Worked example

One criterion that no class can take, on the scripted calibration cassette:

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --only ledger_intact --out ledger.yaml
```

```text
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --only ledger_intact --out ledger.yaml
ledger_intact: UNASSIGNED, judged but not gating: no class has 3 judges at the bar (system1 has 2 of 3 judges at the bar, system2 has 2 of 3 judges at the bar): s1p-b kappa 0.40 is under 0.8; google-chat kappa 0.50 is under 0.8
    s1p-a              system1  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    s1p-b              system1  separation 3/3  kappa  0.40  agreement 2/3 [0.21, 0.94]  misses: kappa 0.40 is under 0.8
    openai-decisions   system1  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    openai-chat        system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    google-chat        system2  separation 3/3  kappa  0.50  agreement 2/3 [0.21, 0.94]  misses: kappa 0.50 is under 0.8
    anthropic-chat     system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    alpha across judges 0.87; bar: 3/3 separation and kappa 0.8
Kappa over every labelled block: s1p-a 1.00 (3/3), s1p-b 0.40 (2/3), openai-decisions 1.00 (3/3), openai-chat 1.00 (3/3), google-chat 0.50 (2/3), anthropic-chat 1.00 (3/3).

0 of 1 criteria assigned in mode hybrid (3 repeats, kappa at least 0.8). Unassigned, judged but never gating: ledger_intact.
Wrote ledger.yaml.
(exit 0)
```

The table it writes, `ledger.yaml`:

```text
# Written by driftbench judge calibrate. A criterion is owned by the cheapest judge that separates its
# fixture pair in every repeat and reaches kappa 0.8 against the hand labels, in a class with three
# such judges. An unassigned criterion is judged but never gates.
version: 1
mode: hybrid
repeats: 3
kappa_min: 0.8
criteria:
  - criterion: ledger_intact
    status: unassigned
    reason: "no class has 3 judges at the bar (system1 has 2 of 3 judges at the bar, system2 has 2 of 3 judges at the bar): s1p-b kappa 0.40 is under 0.8; google-chat kappa 0.50 is under 0.8"
```

Every judge separates the pair. One judge of each class disagrees with one of the three labels. Therefore neither class seats three judges at the bar. The exit code is 0 because `ledger_intact` is not declared gating. With `--json`, this criterion also carries `warnings: [few-labels]`: each label class has fewer than 5 blocks.

## Common errors

* `judge calibrate: <n> issue(s) in the criteria or the labels.` (exit 2), after one line per issue. An issue line can read `the labels are for <criterion>, the file is <stem>` or `block id <id> is also used in <file>`. It can read `block <id>: anchor: no transcript line 7 (the block has 4)` or `block <id>: anchor: calls no coverage.lookup`. It can read `every block is labelled pass: a criterion needs a pass and a fail label` or `labels for an unknown criterion <name>`. Fix the labels folder.
* A gating criterion stays unassigned (exit 1, table still written). Improve the rubric or the pictures until three judges of one class reach the bar, or add better judges. Never lower the bar to make it pass.
* `Left out, same family as the agent: <judges>.` Those judges cannot calibrate for this agent. Use judges of other families.
* A table that `judge run --assignments` refuses with `the assignment table is for mode hybrid, the run is in mode llm`. Calibrate in the mode the run uses.
