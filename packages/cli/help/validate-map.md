---
title: The map validator
summary: What `driftbench validate map` measures, its eight levels and 578 items, and how to read a failing extraction item.
commands:
  - validate
see_also:
  - validate-overview
  - validate-reading-items
  - validate-generator
  - validate-mutants-and-rulings
next:
  - validate-generator
---

## What it is

The map validator checks extraction: does `driftbench extract` find what an agent's prompt, inventory and
tool files specify? Code holds a hidden agent specification (stages, behaviours, tools with argument
schemas, constraints, deviations, personas, languages and prose rules). A renderer writes it out as the
files a real agent has, in many styles. The extractor runs on those files, and the proposal it returns is
compared with the hidden specification by id.

No model is called. The extractor talks to a "perfect model": code that knows every planted entry and
answers each request with the entries a perfect reader would report, under three limits a real model has:

1. It sees only what the request sends. An entry is reported only when the text that states it is inside
   a source block of the request, so a chunker that cuts that text in two loses the entry.
2. It writes only what the answer contract asks for. A key the contract does not show is left out.
3. Its answer fits a budget: 16000 output tokens unless the request sets `maxTokens`, and a context of
   200000 tokens at four characters a token. A longer answer is cut; a longer request is refused.

So a map item fails when driftbench's own code (the pre-pass, the chunker, the prompts, the merge, the
quote check, the proposal format) loses or invents an entry, never because a model was unlucky.

The ladder (version 2), from `driftbench validate map`:

| Level | Id | Name | Items | What the items check |
|---|---|---|---|---|
| 1 | `structured` | structured files | 167 | the code pre-pass reads inventories and tool schemas |
| 2 | `containers` | prompt containers | 42 | prompts inside JSON, YAML, code and markup files |
| 3 | `prose` | prose across styles | 142 | rules, stages and personas in every prompt style and pair of styles |
| 4 | `relations` | relations and constraints | 65 | tool calls, paths, recoveries, impossible cells |
| 5 | `metamorphic` | metamorphic invariance | 21 | the map does not change when only wording does |
| 6 | `composition` | additivity and unit response | 21 | two halves add up to the whole; one more constraint gives exactly one more |
| 7 | `semantics` | semantics and roles | 84 | polarity, conditions, priors, roles the prompt states |
| 8 | `scale` | scale | 36 | prompts of 100k characters and more, inside a time budget |

578 items in all. The families, from the bank table of `driftbench validate map --hardness`:
`adversarial`, `composition`, `constraints`, `hostile-inputs`, `inventory-forms`, `prompt-containers`,
`relations`, `roles`, `scale`, `schema-keywords`, `semantics`, `style-pairs`, `styles`, `tool-formats`,
`transforms`. Every tier from 1 to 5 is present.

The floor is 8 for ladder version 2, the top of the ladder.

## When to use it

* After any change to `packages/generate` that touches extraction: the pre-pass, chunking, the extraction
  prompts, the merge of answers, the quote check or the proposal format.
* After a change to the inventory or tool schema readers.
* Before raising the map floor, or when CI reports the map below 8.

## Commands and every option

```
driftbench validate map [--seed <n>] [--seeds <a..b>] [--hidden] [--json] [--items] [--all-levels] [--blind] [--check-floor]
driftbench validate map --brief [--fresh] | --journal <row.json> | --check-handover | --hardness [--json]
```

Every option is the general one: seeds and output in `validate-overview`, listings in
`validate-reading-items`, `--check-floor` in `validate-floors`, the loop modes in
`validate-executor-loop`. The map ladder reads no environment variable of its own.

Every option of `driftbench validate`, for reference (the topic named in the last column explains it):

| Option | Default | Meaning | Topic |
|---|---|---|---|
| `<component>` | required | a registered component, `all`, `floors` or `protect` | `validate-overview` |
| `[level]` | none | only with `floors --raise`: the new floor | `validate-floors` |
| `--seed <n>` | seed 1 when no seed option is given | one visible seed | `validate-overview` |
| `--seeds <a..b>` | none | a range of visible seeds, at most 1000 | `validate-overview` |
| `--hidden` | off | add the hidden seed of the current commit | `validate-overview` |
| `--json` | off | print the report, or the hardness, as JSON | `validate-overview` |
| `--items` | off | compute every level and list the whole bank | `validate-reading-items` |
| `--all-levels` | off | compute every level and list every failing item | `validate-reading-items` |
| `--blind` | off | strip causes and `Fix:` hints (the auditor's view) | `validate-reading-items` |
| `--check-floor` | off | exit 1 when a run is below its floor, else 0 | `validate-floors` |
| `--raise <component>` | none | with `floors`: the component whose floor rises | `validate-floors` |
| `--ladder-version <n>` | none | with `floors --raise`: the ladder version of the floor | `validate-floors` |
| `--evidence <json>` | none | with `floors --raise`: the `--json` run that reaches the level | `validate-floors` |
| `--brief` | off | print the executor brief with the live state | `validate-executor-loop` |
| `--fresh` | off | with `--brief`: leave out the hypotheses | `validate-executor-loop` |
| `--journal <row.json>` | none | append a validated journal row | `validate-executor-loop` |
| `--check-handover` | off | exit 1 when `HANDOVER.md` disagrees with the journal | `validate-executor-loop` |
| `--hardness` | off | print the hardness measurement from the journal | `validate-executor-loop` |
| `--branch <name>` | none | with `protect`: the pull request's branch | `validate-protect` |
| `--base <ref>` | none | with `protect`: the ref it merges into | `validate-protect` |
| `-h`, `--help` | off | print the command's usage | |

## Inputs

* The seed. It draws the hidden specification, its rendering styles and its transforms. Seeds 1 and 2 are
  also committed as fixtures under `packages/validators/fixtures/map/seed-1` and `seed-2` (see that
  folder's README); every other seed is rendered into a temporary folder during the run.
* The extraction code under `packages/generate`, through the same entry points `driftbench extract` uses.
* Time: the `scale` items run extraction on prompts of 100k characters and more, each under its own
  budget in milliseconds; the item fails with `took <n> ms, over the budget of <m> ms` when it runs over.
* Quarantine: items whose only cause is one no product page needs stay as code but count toward no level,
  score or cause (`validators/map/NEEDS.md`, `QUARANTINED_CAUSES` in
  `packages/validators/src/ladders/map/bank/index.ts`).

## Outputs and how to read them

The general table (`validate-overview`). A failing map item names the planted entry, the file it points at
(the extraction stage that lost or invented it) and what the proposal held instead. Typical readings:

| Detail says | Look at |
|---|---|
| an entry is missing | the chunker or the pre-pass named in the component: did the request carry the text that states it? |
| an entry was invented | the quote check and the merge: an entry must quote text that exists in its source |
| the map changed under a transform | wording-sensitive code: section order, a synonym, a split sentence or a decoy changed the result |
| a half plus a half is not the whole | the merge of chunk answers, or a de-duplication that drops a real entry |
| took too long | the stage named in the component, at 100k characters and more |

Exit status: the level reached, 8 when every level passes.

## Worked example

The ladder takes minutes, so the help test runs only a fast check that the component exists (the scratch
folder of the test has no journal, hence the exit 64):

```sh
driftbench validate map --hardness # exit 64
```

```text
validators/map/journal.jsonl: the journal holds no iteration 0 row: run and record iteration 0 first.
```

The ladder on seed 1, at the repository root (409 seconds on a busy machine). Shown as text, not run by the help test. A whole ladder runs for minutes, and the level it reaches changes as the product is fixed.

```bash
pnpm -s driftbench validate map
```

```text
Validator map (ladder version 2)
Level  Name                          Metric                                                                                               Threshold  seed 1
1      structured files              items passing / items of the level (167): the code pre-pass reads inventories and tool schemas       >= 1       1 pass
2      prompt containers             items passing / items of the level (42): prompts inside JSON, YAML, code and markup files            >= 1       1 pass
3      prose across styles           items passing / items of the level (142): rules, stages and personas in every prompt style and pair  >= 1       1 pass
4      relations and constraints     items passing / items of the level (65): tool calls, paths, recoveries, impossible cells             >= 1       1 pass
5      metamorphic invariance        items passing / items of the level (21): the map does not change when only wording does              >= 1       1 pass
6      additivity and unit response  items passing / items of the level (21): halves add up, one more gives one more                      >= 1       1 pass
7      semantics and roles           items passing / items of the level (84): polarity, conditions, priors, roles the prompt states       >= 1       1 pass
8      scale                         items passing / items of the level (36): prompts of 100k characters and more, inside a time budget   >= 1       1 pass
Level per seed: 1 = 8
Level of the run: 8 of 8, the minimum over 1 seed.
Floor: 8. At or above the floor.
No level failed.
```

It exited 8. To see every one of the 578 items with its family and tier, add `--items`.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| a `scale` item fails with `took <n> ms, over the budget of <m> ms` | extraction is slow on long prompts, or the machine is loaded | re-run on a quiet machine; if it still fails, the named stage is not linear in its input |
| `Floor: 8. BELOW THE FLOOR.` | a change lost or invented an entry the ladder used to get right | read the first failing level's items; fix the extraction stage they name |
| an item you believe is wrong | the oracle disagrees with your reading of the docs | do not edit the bank; see `validate-mutants-and-rulings` |
| `validators/map/journal.jsonl: the journal holds no iteration 0 row ...` (exit 64) | `--hardness` outside the repository | run it at the repository root |
