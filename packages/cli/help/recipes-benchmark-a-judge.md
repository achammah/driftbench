---
title: Benchmark a judge
summary: Measure judges against fixture pairs and hand labels on the Acme criteria, from recorded answers with no model call, write which judge owns each criterion, and grow the labels with the review queue.
commands:
  - judge check
  - judge run
  - judge calibrate
  - campaign run
  - queue create
  - queue list
  - queue assign
  - queue vote
  - queue agreement
  - view
see_also:
  - core-configuration
  - core-exit-codes
  - recipes-test-a-chat-agent
  - recipes-find-why-a-test-failed
next:
  - core-reading-help
---

## Goal

Some of what an agent must do needs judgement: a criterion such as "the reply asks at most one question" is
scored by a model, a judge. Before a judge's verdict may fail a test, you want proof that it judges the
criterion the way a person does, and you want the cheapest judge that does.

The chain is: check the criteria and their fixture pairs, replay a council of judges over the pairs, then
calibrate every judge against the pairs and the hand labels, which writes the assignment table: who owns
each criterion. Every judge answer below comes from a cassette, a JSON file of recorded answers, so nothing
calls a model. The last steps grow the hand labels with the review queue.

## Before you start

* A checkout of driftbench, built: `pnpm install`, then `pnpm build`. Run every command from the repository
  root as `pnpm -s driftbench <command>`. See `driftbench help core-getting-started`.
* A criteria folder: one YAML file per criterion, named after it, holding the `criterion` (`name`, `rubric`,
  `pass` and `fail` pictures, `gating`, `judge_class`) and a fixture pair, a `pass` slice it must pass and a
  `fail` slice it must fail. The Acme folder, `examples/acme/criteria`, holds 12. Every field is in
  `docs/reference/criteria.md`.
* A labels folder: one YAML file per criterion with blocks a person labelled pass or fail, each with its
  transcript. `examples/acme/labels` holds 40 fictional blocks, 3 or 4 per criterion.
* Cassettes: `examples/acme/criteria/council.cassette.json` (scripted answers of six judges on the pairs),
  `examples/acme/criteria/calibration/cassette.json` (the same six judges on pairs and labels), and
  `examples/acme/criteria/calibration/claude-council.cassette.json` (real answers of three Claude models,
  recorded once). The six scripted judges tell the truth except 7 scripted misses.
* Every command in a `sh` block below runs with no model and no key, and writes only to new paths in the
  folder you run it in: `assignments.yaml`, `cheapest.yaml`, `acme.db`, `labels/`. A step that calls a model
  is shown as text and says so.

## Steps

### 1. Check the criteria and their fixture pairs

A judge is measured against the fixture pairs, so the pairs must be valid first.

```sh
driftbench judge check examples/acme/criteria
```

```text
ok  care_redirect [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)
ok  checks_before_promising [system1, gating]: pass fixture 4 line(s), fail fixture 2 line(s)
...
ok  ledger_intact [system2]: pass fixture 4 line(s), fail fixture 4 line(s)
...
12 valid criteria, 0 issue(s).
```

Each line: the criterion, its declared class (`system1`, a fixed binary question with one short answer;
`system2`, a chat model with reasoning that reads across blocks), `gating` when a fail fails the test, and
the size of each fixture. It reports a name that differs from its file, a name defined twice, a pair that is
the same slice twice, a missing PASS or FAIL picture, and schema errors, with exit 1. `--json` prints one
JSON document.

### 2. Replay a council over the fixture pairs

`judge run` seats a council of three judges per criterion and asks whether it separates each pair: the pass
fixture judged pass and the fail fixture judged fail.

```sh
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
```

```text
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
...
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
...
12 of 12 criteria separated in mode hybrid.
```

A verdict needs more than half of the three seated judges to agree. `(split, re-judged)`: the three did not
agree, and in mode `hybrid` (the default) three judges of the other class judged again. `--mode system1` or
`llm` keeps one class. `--agent-family <family>` (default `none`) names the model family of the agent under
test; a judge of that family is refused. Exit 1 when a criterion is not separated or a judge gave no answer.
A request with no recording fails with `cassette_miss`: a cassette never makes up an answer.

### 3. Calibrate every judge against the pairs and the hand labels

Calibration earns each judge its seat. Every judge answers every fixture `--repeats` times (default 3) and
every hand-labelled block once. The bar: the pair separated in every repeat, and Cohen's kappa against the
labels at least 0.8. A criterion goes to a class with three judges at the bar; its owner is the cheapest of
them.

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels \
  --cassette examples/acme/criteria/calibration/cassette.json --out assignments.yaml
```

```text
care_redirect [gating]: owned by s1p-a (system1: s1p-a, s1p-b, openai-decisions; re-judge google-chat, openai-chat, anthropic-chat)
    s1p-a              system1  separation 3/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  at the bar
    ...
    alpha across judges 1.00; bar: 3/3 separation and kappa 0.8
...
holds_instructions [gating]: owned by google-chat (system2: google-chat, openai-chat, anthropic-chat; re-judge s1p-a, s1p-b, openai-decisions)
    openai-decisions   system1  separation 2/3  kappa  1.00  agreement 4/4 [0.51, 1.00]  misses: separates the fixture pair 2 of 3 times
...
ledger_intact: UNASSIGNED, judged but not gating: no class has 3 judges at the bar (system1 has 2 of 3 judges at the bar, system2 has 2 of 3 judges at the bar): s1p-b kappa 0.40 is under 0.8; google-chat kappa 0.50 is under 0.8
...
Kappa over every labelled block: s1p-a 0.90 (38/40), s1p-b 0.90 (38/40), openai-decisions 1.00 (40/40), openai-chat 1.00 (40/40), google-chat 0.95 (39/40), anthropic-chat 1.00 (40/40).

11 of 12 criteria assigned in mode hybrid (3 repeats, kappa at least 0.8). Unassigned, judged but never gating: ledger_intact.
Wrote assignments.yaml.
```

How to read a judge line:

* `separation 3/3`: in how many repeats the pass fixture passed and the fail fixture failed.
* `kappa`: Cohen's kappa against the hand labels, over pass, fail and inconclusive. An inconclusive answer
  always disagrees with a label.
* `agreement 4/4 [0.51, 1.00]`: blocks agreeing with the label, with a Wilson 95% interval. With 3 or 4
  labels per criterion the lower bound stays near 0.5: more labels make the bar mean more.
* `alpha across judges`: Krippendorff's alpha over the fixtures and the labels, inconclusive as missing.
* `at the bar`, or `misses:` with the reason.

`holds_instructions` declares system 1, but one system 1 judge misses the bar, so the class has two judges
at the bar and system 2 takes it. `ledger_intact` has no class with three: it stays unassigned, judged but
never gating; the fix is a sharper rubric, not a lower bar. Exit 0 here because `ledger_intact` is not
declared gating; an unassigned gating criterion gives exit 1, and the table is still written. The table,
`assignments.yaml`, is byte for byte the committed `examples/acme/criteria/calibration/assignments.yaml`:
per criterion its `status`, `owner`, `class`, `judges`, `rejudge`, `separation` and `kappa`, or the `reason`
it is unassigned.

### 4. Read the agreement metrics in full

`--json` prints the whole report: per criterion and judge, the separation answers, and against the labels
the confusion counts, sensitivity, specificity, balanced accuracy, kappa, PABAK, Gwet's AC1 and every block
with its label and the judge's answer.

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels \
  --cassette examples/acme/criteria/calibration/cassette.json --out assignments-json.yaml --json
```

The document has `mode`, `repeats`, `kappaMin`, `criteria`, `pooled`, `excluded`, `errors`, `spentUsd` and
`table`. The judge `s1p-b` on `ledger_intact`, in part:

```text
"labels": { "n": 3, "agree": 2,
  "metrics": { "tp": 1, "fp": 0, "tn": 1, "fn": 1, "sensitivity": 0.5, "specificity": 1, "balancedAccuracy": 0.75, ... },
  "kappa": 0.4, "pabak": 0.333, "ac1": 0.333,
  "blocks": [ { "id": "ledger_intact.1", "label": "pass", "judged": "pass" },
              { "id": "ledger_intact.2", "label": "fail", "judged": "fail" },
              { "id": "ledger_intact.3", "label": "fail", "judged": "pass" } ] },
"misses": [ "kappa 0.40 is under 0.8" ]
```

The miss is one block: the person labelled `ledger_intact.3` fail (the reply forgets one of two plans) and
the judge passed it. PABAK and AC1 stay meaningful when one label dominates, where kappa can mislead.
`pooled` gives each judge's kappa over every labelled block.

### 5. Run the council with the earned assignments

`judge run --assignments` seats the judges the table names, and marks an unassigned criterion as not gating.

```sh
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/calibration/cassette.json \
  --assignments assignments.yaml
```

```text
...
separated  holds_instructions [system2, gating]: pass fixture pass, fail fixture fail
...
separated  ledger_intact [system2, unassigned: not gating]: pass fixture pass, fail fixture fail
...
12 of 12 criteria separated in mode hybrid.
```

The table's mode must be the run's mode. `--cascade` runs the cheapest judge first and stops on a sure pass.

### 6. Benchmark real models from their recording

The Claude council cassette holds real answers of three Claude models on every pair and label. Replayed,
it benchmarks them with no call. `--assign cheapest` gives each criterion to the one cheapest judge at the
bar, judging alone, with its cost per call in the table; the default `--assign council` keeps three judges.

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels \
  --cassette examples/acme/criteria/calibration/claude-council.cassette.json --mode llm --assign cheapest \
  --out cheapest.yaml
```

```text
...
sheet_matches_catalog [gating]: owned by claude-haiku alone (system2), 0.0003 USD per call
    claude-haiku       system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    claude-sonnet      system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    claude-opus        system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    alpha across judges 1.00; bar: 3/3 separation and kappa 0.8
Kappa over every labelled block: claude-haiku 1.00 (40/40), claude-sonnet 1.00 (40/40), claude-opus 1.00 (40/40).

12 of 12 criteria assigned in mode llm (3 repeats, kappa at least 0.8). Spent 1.4399 USD.
Wrote cheapest.yaml.
```

`Spent` is the cost the cassette recorded for those answers when they were made; the replay itself calls
nothing and costs nothing. Judges of one family share its blind spots, so each row they own is marked
single family.

To benchmark a judge live, add it with `--claude <model>` (repeat for several). It runs the local `claude`
command on its signed-in account, one paid call per fixture and repeat, and one per labelled block; it reads no API key.
`--spend-cap-usd` stops the calls at a cost, and `--record` saves every answer with its cost as a cassette
you replay later. This is a paid call, shown as text:

```text
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --claude haiku \
  --mode llm --spend-cap-usd 0.1 --record haiku.cassette.json --out haiku.yaml
```

`--cascade` lets the first judge answer everything and the others only where it is unsure or disagrees with
the label, and writes its report as JSON to `--out`; `--only <criterion>` limits the run.

### 7. Queue blocks for people to label

Four labels per criterion give a wide interval. The review queue lists the blocks of a real campaign that
still need a label, once per judged criterion of their spec. First run a campaign whose specs carry judged
criteria; the Acme conversations do.

```sh
driftbench campaign run examples/acme/specs/conversations --campaign c-review --store acme.db
driftbench queue create --store acme.db --campaign c-review --labels labels
driftbench queue list --labels labels
```

```text
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
Queued 49 items in labels.
open	coverage_before_offer	49156dd6361b05e4.b0	-
open	one_question_per_turn	49156dd6361b05e4.b0	-
...
open	checks_before_promising	59fdb2f229540c43.b1	-
open	one_question_per_turn	59fdb2f229540c43.b1	-
...
```

Each item is a state (`open`, `assigned`, `done`), a criterion, a block id `<runId>.b<index>`, and its
holder. The queue is `labels/queue.json`, beside the label files. A run id is a hash of the spec, target,
mode and repeat, so the same cell has the same id in every campaign: `59fdb2f229540c43` is
`acme-number-porting` on `function:acme-sales`, mode F, repeat 0.

### 8. Take items, vote, and measure reviewer agreement

A reviewer takes an item, so no one else labels it. A second reviewer records a vote on the same block; votes
measure how far people agree before their labels become the truth a judge is held to.

```sh
driftbench queue assign 59fdb2f229540c43.b1 --criterion one_question_per_turn --reviewer ana --labels labels
driftbench queue assign 59fdb2f229540c43.b1 --criterion one_question_per_turn --reviewer ben --labels labels  # exit 2
driftbench queue vote 59fdb2f229540c43.b1 --criterion one_question_per_turn --reviewer ana --label pass --labels labels
driftbench queue vote 59fdb2f229540c43.b1 --criterion one_question_per_turn --reviewer ben --label pass --labels labels
driftbench queue vote 59fdb2f229540c43.b2 --criterion one_question_per_turn --reviewer ana --label pass --labels labels
driftbench queue vote 59fdb2f229540c43.b2 --criterion one_question_per_turn --reviewer ben --label fail --labels labels
driftbench queue agreement --labels labels
```

```text
59fdb2f229540c43.b1 (one_question_per_turn) is assigned to ana.
59fdb2f229540c43.b1 is assigned to ana
ana voted pass on 59fdb2f229540c43.b1 (one_question_per_turn).
ben voted pass on 59fdb2f229540c43.b1 (one_question_per_turn).
ana voted pass on 59fdb2f229540c43.b2 (one_question_per_turn).
ben voted fail on 59fdb2f229540c43.b2 (one_question_per_turn).
Agreement over 2 items with two votes: 1 agree (50%), kappa 0.00.
```

A second `assign` of a held item is refused with exit 2. `vote` never writes a label file. `agreement`
compares the first two reviewers of each item with two votes, as a share and Cohen's kappa; low agreement
means the rubric is ambiguous to people too, and no judge can be held to it until it is sharpened.

The label itself is written in the viewer, which runs until you stop it, so start it in its own terminal:

```text
driftbench view --store acme.db --labels labels --labelled-by "a reviewer" --port 0
```

Its `/queue` page lists the items: "Take" assigns one, "Label it" opens its block, and saving a pass or fail
label with a note writes the block into `labels/<criterion>.yaml` and marks the item done. Those files are
what `judge calibrate --labels labels` reads. Calibrate needs at least one pass and one fail label per
criterion, or kappa has nothing to measure. Stop the viewer with Ctrl+C.

## What you have at the end

* `assignments.yaml`: who owns each Acme criterion, earned on the pairs and the labels; `ledger_intact`
  unassigned and never gating.
* `assignments-json.yaml` and the JSON report on screen: every agreement metric per judge and criterion.
* `cheapest.yaml`: the cheapest single Claude judge at the bar per criterion, from a recording.
* `acme.db` and `labels/queue.json`: a campaign and its review queue, with two reviewers' votes.

`campaign run` loads no judge: it lists judged criteria as not judged and counts them in no pass or fail.
`replay --judge claude:<model>` and `campaign rejudge --judge claude:<model>` judge them, as paid calls. See
`docs/concepts/judges.md`.

## When a step fails

* `judge check` exits 1: a criterion file has an issue; the line names it. Fix the file, a name must match
  its file name.
* `judge run` exits 1: a criterion is not separated, or a judge gave no answer. A `cassette_miss` means the
  rubric, a fixture, the prompt or the judge settings changed since the recording: record again.
* `judge calibrate` exits 1: a gating criterion stays unassigned, or a judge call gave no answer; the table is
  still written. Sharpen the rubric of the criterion the line names, or add labels.
* `judge calibrate` exits 2: a missing option (`--criteria`, `--labels`, `--out`, and `--cassette` or
  `--claude`), a labels file whose name differs from its criterion, a labels file where every block carries
  one label, labels for an unknown criterion, an anchor naming nothing in its block, or a cassette that
  cannot be read.
* `queue assign` exits 2: another reviewer holds the item, or it is done.
* `queue create` queues nothing new: every block of the campaign already has a label for its criteria.
* `view` exits 2: the store is missing, or the port cannot be opened. Pass `--port 0`.
