---
title: The validity gate
summary: '`gate` passes every candidate block through nine stages (observed state, leakage, shortcut, contrast, red first, stability, difficulty, label audit, freshness). The stages check blocks against reference agents and planted faults. `gate` writes the gated suite, a sealed holdout, the report, and the files a person reviews. No model is called.'
commands:
  - gate
see_also:
  - results-holdout
  - results-select
  - authoring-generate
  - authoring-covering-arrays
  - authoring-blocks
  - authoring-deviation-classes
  - authoring-task-families
next:
  - authoring-deviation-classes
  - results-select
---

## What it is

A test is only useful if it passes on a correct agent, fails on a broken one, and cannot be passed by a trivial agent. The gate checks exactly that, block by block, before a block may count.

It runs the candidate specs on the reference agents (`--reference`, the correct build). It runs them on trivial agents too. It runs them on a set of planted faults (`--faults`: wrappers around the reference that each break one thing). Nine stages run in order. Each stage rejects or marks a block with a named reason; the funnel counts each block once, at the first stage that rejects it.

| # | Stage | Rejects or marks |
|---|---|---|
| 1 | `observed` | rejects `no-machine-then` (the Then holds judged criteria only), `words-only` (the Then reads only words, on a cell that is not about wording) |
| 2 | `leakage` | rejects `expected-value-in-when`, `expected-value-in-given` (the expected value is already written where the agent reads it), `ngram-overlap` (13-grams shared with the `--origin` specs above `--overlap`), `same-family-as-judge` (`--judge-family`) |
| 3 | `shortcut` | rejects `passed-by-constant`, `passed-by-echo`, `passed-by-first-tool`: a trivial agent passes the block |
| 4 | `contrast` | rejects `then-ignores-edit` (a one-slot sibling expects the same Then though the reference output changes), `twins-disagree` (metamorphic twins expect or produce different things) |
| 5 | `red_first` | rejects `not-green-on-reference`, `red-on-control`, `targets-no-fault`, `kills-no-fault` |
| 6 | `stability` | rejects `flips`: the outcome changes across the `--k` repeats on the reference; the block goes to `review.yaml` |
| 7 | `difficulty` | marks `saturated`: every agent passes, or none |
| 8 | `label_audit` | marks `sampled`: a seeded sample of `--audit` blocks per family goes to `label-audit.yaml` for a person to read |
| 9 | `freshness` | records the creation date and map hash of each block; marks `sealed-holdout` |

Details that change how you read results:

- A block's outcome reads only the gating verdicts of its Then. A block no verdict decided is `unjudged`, never a pass.
- The trivial agents: `constant` sends the same reply to every message. `echo` sends the user's message back with every literal word of the spec's patterns. `first-tool` calls the first tool the spec names with no argument.
- Leakage: an expected tool input the user states in the When is allowed (passing it on is the test). An end-state value found in the When or Given is a leak. Enum words of 4 letters or fewer are ignored. Numbers always count.
- Stage 4 compares blocks through the cells `generate` records. A hand-written spec has none, so it passes stage 4.
- Stage 5: a block targets a fault when the fault changed an observed field of its spec. The block must also read a field the fault changes. A block targets a fault too when it carries the class the fault plants. A fault that changes no observed field is an equivalent mutant and leaves the score. The mutation score per class is the share of scored faults the gated suite kills, with a 95% Wilson interval.
- The holdout: whole specs, drawn with `--seed` at the share `--holdout`, go to `holdout/` with `seal.json`. They are gated like the rest, never run as an evaluation by the gate; `holdout score` (another area) scores them once.
- No model is called. The gate runs deterministic agents only.

Which agent runs a spec: its own `target` when that is a `--reference`; else the first `--route` whose tag it carries; else the first `--reference`.

## When to use it

- After `generate`, before the suite counts: the gate drops blocks that cannot tell a good agent from a broken one.
- On hand-written specs, to find leaks and blocks an echo agent passes.
- When `generate --model` proposes specs: it gates them for you.

## Commands and every option

### driftbench gate

```
driftbench gate <specs> --reference <adapter:agent>... --faults <path> --out <dir> [--k <n>] [--route <tag=target>]... [--origin <path>]... [--judge-family <family>] [--seed <n>] [--holdout <share>] [--audit <n>] [--overlap <share>] [--date <YYYY-MM-DD>] [--concurrency <n>] [--force] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<specs>` (required) | The candidate specs: a folder or a file. Every spec must be valid, and spec ids unique. | none |
| `--reference <adapter:agent>` (required, repeatable) | A reference agent, such as `function:acme-sales`. Must be `adapter:agent`. Every spec's own `target` must be one of them. | none |
| `--faults <path>` (required) | The fault set: a module, or a folder holding `index.ts`, `index.mjs` or `index.js`. | none |
| `--out <dir>` (required) | The folder for the gated suite and the reports. | none |
| `--k <n>` | Repeats on the reference, for pass^k and the stability stage. Whole number from 1. | 5 |
| `--route <tag=target>` | Run specs with this tag on this reference, such as `flow:price-sheet=process:acme-ops`. The target must be a `--reference`. Repeatable. | none |
| `--origin <path>` | Specs the candidates came from, for the 13-gram overlap check. Repeatable. All must be valid. | none (check skipped) |
| `--judge-family <family>` | The model family of the judge, for the family check. | none (check skipped) |
| `--seed <n>` | Seed of the label audit sample and the holdout split. Whole number from 0. | 1 |
| `--holdout <share>` | Share of gated specs sealed in the holdout, from 0 to 1. | 0.2 |
| `--audit <n>` | Blocks sampled per family for the label audit. Whole number from 0. | 3 |
| `--overlap <share>` | The 13-gram overlap above which a block is rejected, from 0 to 1. | 0.5 |
| `--date <YYYY-MM-DD>` | The creation date the gated blocks record. | today |
| `--concurrency <n>` | Specs run at the same time. Whole number from 1. | 4 |
| `--force` | Replace the output of an earlier run in the folder. | off |
| `--json` | Print `gate-report.json` instead of the funnel. | off |

| Exit code | When |
|---|---|
| 0 | the gated suite is written with at least one accepted block |
| 1 | the gated suite is written with no accepted block |
| 2 | usage or input error, nothing written. Causes: a bad option value, an invalid candidate, or two candidates with one id. A spec has a target that is not a `--reference`, or a route goes to a target that is not a reference. A fault set does not load. A reference has no adapter. An earlier output exists and `--force` is absent. |

## Inputs

### The fault set

A module that exports `faults`, a list. Each fault:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique in the set. |
| `kind` | `drift`, `deviation` or `control` | A drift fault plants one of X1 to X5. A deviation fault mishandles one deviation class. A control changes nothing and must leave every block green. |
| `class` | `X1_local` to `X5_tool`, a deviation class `D1_off_topic` to `D12_prompt_extraction`, or `control` | The class it plants. |
| `target` | `adapter:agent` | The reference it wraps. A fault whose target is not a `--reference` does not run (the gate prints a note). |
| `affects` | list of Then fields, such as `text`, `tools`, `stage`, `guards`, `end_state`, `lang`, `artifacts`, `workspace`, `safety`, `execution` | The fields it is meant to change. |
| `description` | string | What it does wrong. |
| `agent` | `{ kind: 'function', create() }` or `{ kind: 'process', script }` | A function fault returns a session with `respond(messages, world)` and `payloads()`; a process fault is `node <script>` in a local sandbox. |

The drift classes follow. `X1_local` is a wrong answer or action in this block, while earlier facts hold. `X2_contradiction` is a block that contradicts a fact established earlier. `X3_flow` is a stage skipped, repeated, or the flow going back. `X4_format` is a format or persona rule that breaks, such as a reply in the wrong language. `X5_tool` is a tool call, skill or guard missing, extra, repeated, or with wrong parameters. The Acme set, `examples/acme/faults`, wraps both Acme agents and has one control each.

## Outputs and how to read them

Files under `--out`:

| Path | What it holds |
|---|---|
| `specs/...` | the gated suite: specs with at least one accepted block, at their original relative paths. Rejected blocks are dropped |
| `holdout/...` and `holdout/seal.json` | the sealed specs, and the seal: `sealed`, `note`, `seed`, `share`, and each spec's `id`, `path` and `hash` |
| `gate-report.json` | `gate`, `source`, `references`, `fault_set`, `options`, `stages`, `summary`, `funnel`, `mutation`, and `blocks`. Each block has its `key` (`<spec id>#<block id or index>`), `path`, `family`, `target`, the Then `fields` it reads, and `status`. It has the first `stage` and `reason` that refused it, and every stage's status and detail. It has the reference outcomes per repeat, and the trivial and fault outcomes. It has `pass_k`, `pass_probability` and `agents` |
| `review.yaml` | blocks that flipped across repeats, for a person to decide: fix the Then, fix the check, or drop the block |
| `label-audit.yaml` | the sampled blocks per family, each with its When and expected Then, and `label_correct: null` and `note: null` for a person to fill |

The printed funnel: one line per stage with `in`, `rejected` or `marked`, `out`, and the reasons with counts. Then `Accepted <a> of <n> blocks.` is printed. The mutation score per fault class follows (`<killed>/<scored> killed (<share>, 95% CI <lo> to <hi>)`, or `no scored fault, <n> equivalent excluded`). The controls follow (`<n> negative control(s), green`). Last comes `Wrote <n> files to <dir>.`

What to do with a rejection: `expected-value-in-given` or `-in-when`: move the value out of where the agent reads it, or test something it must compute. `passed-by-echo`: the Then only checks words the user already said; add a machine check (tool, stage, end state). `targets-no-fault`: no planted fault touches what this block reads; add a fault or accept the gap. `flips`: read `review.yaml`.

## Worked example

The seven hand-written Acme specs, on both Acme agents, with the Acme fault set (no model call; about 20 seconds):

```sh
driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out out/authoring-gate/hand
```

```text
$ driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out out/authoring-gate/hand
Funnel (blocks):
  1. observed     in   28  rejected 0      out   28
  2. leakage      in   28  rejected 2      out   26  (expected-value-in-given 2)
  3. shortcut     in   26  rejected 2      out   24  (passed-by-echo 2)
  4. contrast     in   24  rejected 0      out   24
  5. red_first    in   24  rejected 0      out   24
  6. stability    in   24  rejected 0      out   24
  7. difficulty   in   24  rejected 0      out   24
  8. label_audit  in   24  marked 3        out   24  (sampled 3)
  9. freshness    in   24  marked 7        out   24  (sealed-holdout 7)
Accepted 24 of 28 blocks.
Mutation score per fault class (gated suite):
  X1_local: 2/2 killed (100%, 95% CI 34% to 100%)
  X2_contradiction: no scored fault, 1 equivalent excluded
  X3_flow: 1/1 killed (100%, 95% CI 21% to 100%)
  X4_format: 2/2 killed (100%, 95% CI 34% to 100%)
  X5_tool: 2/2 killed (100%, 95% CI 34% to 100%)
  D2_goal_shift: no scored fault, 1 equivalent excluded
  D4_loose_confirmation: 1/1 killed (100%, 95% CI 21% to 100%)
  D6_instruction_in_data: no scored fault, 2 equivalent excluded
  D8_tool_failure: 1/1 killed (100%, 95% CI 21% to 100%)
  D9_out_of_scope: no scored fault, 1 equivalent excluded
  control: 2 negative control(s), green
Wrote 11 files to out/authoring-gate/hand.
(exit 0)
```

Four blocks were rejected: two leak their expected value through the Given (one holds `+12025550150`, per `gate-report.json`), and two pass on the echo agent. The 11 files: 5 gated specs, 2 holdout specs, `seal.json`, `gate-report.json`, `review.yaml` (empty: no block flipped) and `label-audit.yaml` (3 blocks to read).

For a generated suite, add `--route flow:price-sheet=process:acme-ops` (so the task specs, which carry no target, run on the code agent) and `--origin examples/acme/specs`.

## Common errors

```
$ driftbench gate examples/acme/specs --reference function:acme-sales --faults examples/acme/faults --out out/authoring-gate/x
These specs name a target that is not a --reference: acme-price-sheet (process:acme-ops).
(exit 2)
$ driftbench gate examples/acme/specs --reference function --reference process:acme-ops --faults examples/acme/faults --out out/authoring-gate/x
--reference takes adapter:agent, such as function:acme-sales, not "function".
(exit 2)
$ driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/nofaults --out out/authoring-gate/x
Cannot load the fault set examples/acme/nofaults: Cannot find module '<repo>/examples/acme/nofaults' imported from <repo>/packages/generate/src/gate/agents.ts
(exit 2)
$ driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/faults --out out/authoring-gate/hand
out/authoring-gate/hand/gate-report.json already exists: an earlier run wrote this folder. Pass --force to replace its output.
(exit 2)
$ driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/faults --out out/authoring-gate/x --holdout 2
--holdout must be a number from 0 to 1, got "2".
(exit 2)
$ driftbench gate examples/acme/specs --faults examples/acme/faults --out out/authoring-gate/x
error: required option '--reference <adapter:agent>' not specified
(exit 2)
```

| Message | Fix |
|---|---|
| `These specs name a target that is not a --reference` | add that target as a `--reference`, or remove `target` from the spec |
| `--route <tag>=<target>: <target> is not a --reference.` | add the target as a `--reference` |
| `Fix the invalid specs first: nothing was gated.` | run `spec validate` on the candidates |
| `Two candidate specs share the id <id>` | rename one: the gate keys blocks by spec id |
| `Cannot load the fault set ...: the folder holds no index.ts, index.mjs or index.js` | point at the module, or add the index |
| `... exports no list named faults`, `fault <n> of <path>: <problem>` | export `faults`, and give each fault every field in the table above |
| `--date takes a date written YYYY-MM-DD` | use that form |
| `Accepted 0 of <n> blocks.`, exit 1 | every block was rejected; read the reasons in the funnel and `gate-report.json` |
