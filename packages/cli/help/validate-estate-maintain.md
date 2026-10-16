---
title: Keeping estate tests true
summary: Compare two estate maps. See what the change does to the tests (regenerate, re-approve, retire, new). Track guard enforcement state. Replay the corpus for regressions.
commands:
  - estate diff
  - estate impact
see_also:
  - validate-estate-scan
  - validate-estate-generate
  - validate-estate-replay
  - validate-estate-loop
next:
  - validate-overview
---

## What it is

When the estate changes, two commands keep its tests true.

`estate diff <old map> <new map>` matches atoms by id and sorts each change:

* added and removed atoms;
* moved: the same quote at another span (a line was added above it); no test changes;
* white space: the quotes are equal once spaces are collapsed and the ends trimmed; no test changes;
* semantic: any other change of the quote (case and punctuation count); its tests are regenerated and its
  phrasings go back for approval;
* restated: the same quote, but its evidence, enforcement, situation, title, role or kind fields changed;
  its tests are regenerated.

It also compares the edges, and the enforcement state of every guard. A guard observes (logs what it would
decide), then warns (tells the agent), then enforces (blocks). The state lives in `guard-state.yaml` beside a
map: one entry per guard atom, with its `mode`, the date `since`, and `evidence` (the decision log, the
number of decisions, how many were wrong). A promotion needs evidence with at least one decision and none
wrong, or a person decides; every demotion needs a person.

`estate impact <diff> --tests <dir>` reads the diff and the estate's specs (indexed by
`metadata.estate.atoms`, as `estate generate` writes them) and lists:

* regenerate: every test with a semantic, restated or guard-state atom, or with a removed atom while other
  atoms remain;
* re-approve: every semantic change, with its tests;
* retire: every test whose atoms are all removed; `--write` writes `retired: <reason>` under its
  `metadata`, keeping comments and layout;
* new: added atoms no live test names;
* needs a person: what the tool cannot decide.

With `--replay <sessions>`, impact also replays the suite over a folder of recorded sessions and compares each
spec on each session with the previous replay kept in `--store`: pass to pass, fail to pass, pass to fail (a
person is needed), fail to fail, no previous.

## When to use it

* After any edit to the estate: scan the new version into a new map, then diff and impact against the
  approved old map.
* After promoting or demoting a guard: edit `guard-state.yaml`, then diff.
* In CI: `estate impact` exits 1 when something needs a person.

## Commands and every option

```
driftbench estate diff <old> <new> [--json] [--out <file>] [--old-guards <file>] [--new-guards <file>]
driftbench estate impact <diff> --tests <dir> [--write] [--json] [--out <file>] [--replay <sessions>] [--suite <dir>] [--store <db>]
```

`estate diff`:

| Option | Default | Meaning |
|---|---|---|
| `<old>` | required | the earlier estate map |
| `<new>` | required | the later estate map |
| `--json` | off | print the diff as one JSON document |
| `--out <file>` | none | also write the diff as JSON: the input of `estate impact` |
| `--old-guards <file>` | `guard-state.yaml` beside the old map | the guard state of the old map |
| `--new-guards <file>` | `guard-state.yaml` beside the new map | the guard state of the new map |

`estate impact`:

| Option | Default | Meaning |
|---|---|---|
| `<diff>` | required | the diff written by `estate diff --out` |
| `--tests <dir>` | required | the specs of the estate, indexed by `metadata.estate.atoms` |
| `--write` | off | write each retirement reason into its spec as `metadata.retired` |
| `--json` | off | print the impact as one JSON document |
| `--out <file>` | none | also write the impact as JSON |
| `--replay <sessions>` | none | replay the suite over this folder of recorded sessions (JSONL) |
| `--suite <dir>` | the `specs` folder inside the sessions folder | the replay suite |
| `--store <db>` | in memory | compare with the previous replay kept in this store, and keep this one |

## Inputs

* Two maps of the same estate, each from `estate scan`. The new one need not be approved.
* Optionally a `guard-state.yaml` per map. Every entry must name a guard atom of its map and every guard
  atom needs an entry, or the diff exits 2. With no state on either side, the diff compares no guards.
* For impact, the folder of specs. A spec without `metadata.estate` counts as other; a spec with
  `metadata.retired` is no longer live.
* For `--replay`, a folder where every `*.jsonl` is a session, and `*.decisions.jsonl` and `*.steps.jsonl`
  go with their session by name.

## Outputs and how to read them

`estate diff` prints `Estate diff: <old> (<hash>) to <new> (<hash>).`, a count line for atoms, edges and
guards, then one section per kind of change: `+` added, `-` removed, `~` changed (with `was:`, `now:` and
the other fields that changed), `>` moved, `*` restated. The JSON holds `version`, `old`, `new`, `atoms`,
`edges`, `guards` and `summary`. Exit 0 computed (with or without changes), 2 a map or a guard state that
cannot be read.

`estate impact` prints `Impact of the estate diff <old> to <new> on <n> live estate tests (<r> retired before,
<o> other specs).`, the counts, the sections Regenerate, Re-approve, Retire, New atoms with no test, Guards
whose enforcement state changed, the replay comparison with `--replay`, and `Needs a person: <n>.` with each
item. A retirement shows `[to write with --write]`, `[written]` or `[already written]`. Exit 0 nothing needs a
person; 1 an atom waits for re-approval, a new atom has no test, a replay that passed before fails now, or a
retirement could not be written; 2 a usage or input error.

The two limits of atom ids: two atoms with the same slug get a `-2` suffix in scan order, so a new atom with
the same slug inserted above swaps their ids; and a semantic change to the first six words of a quote changes
the id, so the diff shows a removal and an addition rather than a rename.

## Worked example

Version 1 of the Northwind estate against version 2 (`examples/estates/fixture-v2`: one rule rewrapped, two
changed in meaning, one removed, two added, one guard promoted), with the guard state of version 1 named,
then the regression replay twice over one store:

```sh
driftbench estate diff examples/estates/fixture/approved.yaml examples/estates/fixture-v2/map.yaml --old-guards examples/estates/fixture-v2/maintain/guard-state.v1.yaml --out diff.json
driftbench estate impact diff.json --tests examples/estates/fixture-v2/tests # exit 1
driftbench estate impact diff.json --tests examples/estates/fixture-v2/tests --replay examples/estates/sessions --store regress.db # exit 1
driftbench estate impact diff.json --tests examples/estates/fixture-v2/tests --replay examples/estates/sessions --store regress.db # exit 1
driftbench estate impact diff.json # exit 2
```

The diff (its 24 moved atoms cut to two):

```text
Estate diff: examples/estates/fixture/approved.yaml (be2e7a0919cb) to examples/estates/fixture-v2/map.yaml (a5c8cb21f4ae).
  Atoms: 2 added, 1 removed, 3 changed (1 white space only, 2 semantic), 24 moved with the same quote, 1 restated, 96 unchanged.
  Edges: 1 added, 1 removed.
  Guards: 1 of 6 changed enforcement state:
    promoted guard.settings.posttooluse-bash-guard-ledger-guard-py: warn to enforce (evidence: 47 decisions, 0 wrong, logs/ledger-guard.decisions.jsonl)
Added:
  + instruction.standing.name-the-finance-lead-on-a (instruction) CLAUDE.md:26
  + instruction.standing.keep-a-credit-note-as-a (instruction) CLAUDE.md:27
Removed:
  - instruction.standing.keep-an-unconfirmed-draft-unsent (instruction) CLAUDE.md:20
Changed, white space only:
  ~ instruction.standing.never-send-a-supplier-email-without (instruction) CLAUDE.md:10-11
Changed, semantic:
  ~ route.standing.an-ask-to-plan-the-delivery (route) CLAUDE.md:38
      was: | plan the delivery routes for tomorrow | the `route-planner` agent |
      now: | plan the delivery routes for the next two days | the `route-planner` agent |
      also: title, situation, fields
  ~ instruction.standing.tell-the-user-about-a-late (instruction) CLAUDE.md:16
      was: When a shipment is late by more than two days, tell the user and propose a supplier email.
      now: When a shipment is late by more than one day, tell the user and propose a supplier email.
      also: situation
Moved, same quote:
  > reference.standing.read-claude-skills-invoice-reconcile-references CLAUDE.md:13 to 14
  > reference.standing.read-claude-steps-json CLAUDE.md:40 to 42
Restated, same quote:
  * invariant.standing.the-standing-instructions-stay-under-40000: fields
Edges added:
  + instruction.standing.keep-a-credit-note-as-a cites instruction.standing.name-the-finance-lead-on-a
Edges removed:
  - instruction.standing.keep-an-unconfirmed-draft-unsent cites instruction.standing.never-send-a-supplier-email-without
Wrote diff.json.
```

The impact:

```text
Impact of the estate diff be2e7a0919cb to a5c8cb21f4ae on 8 live estate tests (0 retired before, 0 other specs).
  Regenerate 4, re-approve 2, retire 1, new 2; 3 tests untouched, 24 atoms moved with the same quote.
Regenerate:
  northwind-draft-pair (draft-pair.yaml): instruction.standing.keep-an-unconfirmed-draft-unsent removed
  northwind-late-shipment (late-shipment.yaml): instruction.standing.tell-the-user-about-a-late semantic
  northwind-ledger-archive (ledger-archive.yaml): guard.settings.posttooluse-bash-guard-ledger-guard-py guard state
  northwind-route-planner (route-planner.yaml): route.standing.an-ask-to-plan-the-delivery semantic
Re-approve, the meaning changed:
  route.standing.an-ask-to-plan-the-delivery (route): | plan the delivery routes for the next two days | the `route-planner` agent |
      tests: northwind-route-planner
  instruction.standing.tell-the-user-about-a-late (instruction): When a shipment is late by more than one day, tell the user and propose a supplier email.
      tests: northwind-late-shipment
Retire:
  northwind-unsent-draft (unsent-draft.yaml): retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed [to write with --write]
New atoms with no test:
  instruction.standing.name-the-finance-lead-on-a (instruction) CLAUDE.md:26
  instruction.standing.keep-a-credit-note-as-a (instruction) CLAUDE.md:27
Guards whose enforcement state changed:
  promoted guard.settings.posttooluse-bash-guard-ledger-guard-py: warn to enforce; tests: northwind-ledger-archive
Needs a person: 4.
  - re-approve route.standing.an-ask-to-plan-the-delivery: its meaning changed; 1 test waits
  - re-approve instruction.standing.tell-the-user-about-a-late: its meaning changed; 1 test waits
  - approve the tests of the new atom instruction.standing.name-the-finance-lead-on-a: no test covers it yet
  - approve the tests of the new atom instruction.standing.keep-a-credit-note-as-a: no test covers it yet
```

The two `--replay` runs print the same, plus, before `Needs a person`, first:

```text
Replay of 8 runs, campaign replay-077293b62f68, no earlier replay in the store: nothing to compare.
  pass to pass 0, fail to pass 0, pass to fail 0, fail to fail 0, no previous 8.
```

then:

```text
Replay of 8 runs, campaign replay-baa56005c117, against replay-077293b62f68.
  pass to pass 4, fail to pass 0, pass to fail 0, fail to fail 4, no previous 0.
```

The last command prints `error: required option '--tests <dir>' not specified`.

`--write` changes the spec files, so run it on a copy of them:

```sh setup
cp -R examples/estates/fixture-v2/tests tests
```

```sh
driftbench estate impact diff.json --tests tests --write # exit 1
driftbench estate impact diff.json --tests tests --write # exit 1
```

```sh setup
grep retired tests/unsent-draft.yaml
```

The first and the retirement line of each impact, then the line written into the spec:

```text
Impact of the estate diff be2e7a0919cb to a5c8cb21f4ae on 8 live estate tests (0 retired before, 0 other specs).
  northwind-unsent-draft (unsent-draft.yaml): retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed [written]
Impact of the estate diff be2e7a0919cb to a5c8cb21f4ae on 7 live estate tests (1 retired before, 0 other specs).
  northwind-unsent-draft (unsent-draft.yaml): retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed [already written]
  retired: atom instruction.standing.keep-an-unconfirmed-draft-unsent removed
```

## Common errors

| Message or symptom | Cause | Fix |
|---|---|---|
| `error: required option '--tests <dir>' not specified` (exit 2) | impact without `--tests` | the folder of the estate's specs |
| every guard shows `added ... no state to <mode>` | the old map has no `guard-state.yaml` beside it | name it with `--old-guards` |
| the diff exits 2 on a guard state | an entry names no guard atom of its map, or a guard atom has no entry | one entry per guard atom |
| a rename shows as a removal and an addition | the first six words of the quote changed, so the id changed | re-approve the new atom; impact retires the old tests |
| `pass to fail` in the replay comparison | a spec that passed on a session now fails | a regression: look at that spec on that session with `driftbench replay` |
