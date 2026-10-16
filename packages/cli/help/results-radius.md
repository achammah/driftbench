---
title: "Blast radius of a change"
summary: "Print the blocks a declared change can affect, per run mode. Write a manifest from a prompt diff. Rerun only the radius and audit what is carried."
commands:
  - radius
  - radius auto
see_also:
  - results-ci
  - authoring-prompt-sections
  - results-compare
  - results-statistics
next:
  - results-select
---

## What it is

A change to one part of an agent has a blast radius: the blocks that part can affect. `driftbench radius`
computes it from a change manifest and from what each block already declares it reads. It is read only:
it runs nothing and writes nothing.

A change manifest names the agent version before (`from`) and after (`to`) and the list of `changes`,
each with a `kind`, an `id` and, for a tool, a `part`:

```yaml
from: acme-v1
to: acme-v2
changes:
  - kind: deviation
    id: D2
```

| Kind | Id | Blocks it selects |
|---|---|---|
| `stage` | a stage of the catalogue | blocks that expect the stage, or whose cell or transition names it |
| `tool` | a tool label; `part` `input`, `result`, `description`, `presence` or none | `input`: blocks expecting a call or asserting on its input. `result`: blocks expecting a call, forcing its result, or reading it in the end state. Otherwise every block that lists the tool |
| `rule` | `states@<stage>`, `recovery:<class>[@<flow>]`, `uses_tool:<tool>`, `path:<id>`, a spec rule (`lang_stable`, `max_calls`, `forbidden_tools`, `one_message_per_turn`, `match_case`, `custom.<name>`), `reply_language` | the blocks that rule governs; `reply_language` is the whole suite |
| `deviation` | `D2` or `D2_goal_shift` | blocks that carry the deviation class |
| `prompt` | an estate atom id | blocks whose spec names the atom, and every block that names no atoms |
| `map` | `dimension=value` | blocks whose cell holds the value or whose turn was phrased from it |
| `fixture` | a fixture name, a workspace file, `family:<id>`, or a literal value | blocks whose Given or expectations name it |
| `criterion` | a judged criterion | blocks whose criteria name it |
| `model`, `agent` | none | the whole suite |
| `prompt_section` | `<prompt-id>#<section-id>` | the whole suite: selection by section links is advisory until links are verified by mutation |

`global: true` on any change makes it the whole suite.

A `prompt_section` change names a section of a prompt's section registry (authoring-prompt-sections).
`radius --sections <registries>` then prints, after the radius, the advisory section selection: the
blocks linked to the changed sections or to sections that reference, override or duplicate them, every
block with no link or a stale link, and every later block of the same conversation. It is a report only:
the radius stays the whole suite and every block runs. On the H7 mutation suite, declared links alone
missed a block a mutant flipped in 3 of 90 single-section mutants and 9 of 110 with two-section ones;
with the forward closure, 2 of 90 and 4 of 110.

`radius localize` reads a stored campaign and ranks the local sections whose linked blocks failed, with
inherited failures dropped (authoring-prompt-sections).

The radius per run mode:

* **Direct**: blocks whose dependencies name a change.
* **Forward**: in modes F (free-running) and P (perturbed) a block inherits the agent's own earlier
  replies, so every block after a direct block of the same run is in. In mode T (teacher-forced) a block
  starts from its canonical Given, so nothing follows: a T rerun can send the direct blocks alone.
* **Unknown means in**: a block with no recorded dependencies (a hand-written spec with no
  `metadata.depends`, no generator record, no estate atoms) is in every radius. A change no block declares,
  or one the radius cannot map, makes the radius the whole suite.

The unit that reruns is the cell (one spec, one target, one mode, one repeat). In F and P a cell reruns
whole.

## When to use it

* Before rerunning a large suite after a small change: see how much a rerun of the radius saves.
* With `campaign run --change <manifest> --from <campaign>`: run the cells in the radius on the new agent
  and carry the stored runs of the others. `--audit <n>` checks the carry on a sample.
* With `ci --change`: gate on the radius only (see `results-ci`).
* With `radius auto`: turn an edit of a prompt file into a manifest from the approved map's evidence quotes.

## Commands and every option

```
driftbench radius <paths...> --change <manifest> [--mode <modes>] [--explain] [--json]
driftbench radius auto --prompt <old> <new> --map <file> [--source <path>] [--from-version <v>] [--to-version <v>] [--out <file>]
```

`radius`:

| Argument or option | Default | Meaning |
|---|---|---|
| `<paths...>` | required | spec files or folders |
| `--change <manifest>` | required | the change manifest, YAML or JSON |
| `--mode <modes>` | `F` | the run modes to plan for: `T` teacher-forced, `F` free-running, `P` perturbed, separated by commas |
| `--explain` | off | also print each change with its note, then every block with its state per mode and the reasons that put it in |
| `--json` | off | one JSON document: the manifest with its hash, the totals per mode, every block with its state (`direct`, `forward` or `out`) and its reasons |

Exit 0 when the radius is smaller than the suite, 1 when it is the whole suite, 2 on bad input.

`radius auto`:

| Option | Default | Meaning |
|---|---|---|
| `--prompt <files...>` | required | exactly two files: the old prompt, then the new one |
| `--map <file>` | required | the approved map with `evidence.quote` anchors |
| `--source <path>` | the old prompt's path relative to the map | which of the map's declared `sources` the prompt is; other sources are taken as unchanged |
| `--from-version <v>` | the content hash of the old text | the manifest's `from`; use the agent version your campaigns record |
| `--to-version <v>` | the content hash of the new text | the manifest's `to` |
| `--out <file>` | none: print the YAML | write the manifest to this file |

Each changed region must lie inside exactly one approved anchor in both texts, or the manifest selects
the whole suite (`kind: prompt`, `global: true`) with the reason in its `note`. An unchanged text with the
same version labels gives `changes: []`. Exit 0 when written, 2 when `--prompt` does not name two files
or the map has no such source.

The options of `campaign run` that run a radius: `--change <manifest>`, `--from <campaign>` (the stored
campaign carried from), `--agent-version <label>` (must be the manifest's `to`), `--audit <n>` (run n
cells about to be carried and compare each with its stored run; one miss carries nothing and exits 1),
`--audit-seed <n>` (default 1), `--max-carry <n>` (default 5 campaigns in a row), `--max-age <days>`
(default 7), `--block-reruns` (mode T: send only the blocks in the radius) and
`--record-end-state-snapshots`. They are documented with `campaign run`.

## Inputs

Spec files, and a manifest. Generated specs (`driftbench generate`) record their cell, path and
deviation, so their radius is narrow; hand-written specs need `metadata.depends` (`tools`, `stages`,
`rules`, `atoms`, `fixtures`) or they are in every radius. The example manifests are in
`examples/acme/radius/`, one per kind of change the Acme agents can suffer.

## Outputs and how to read them

```
Blast radius of <from> to <to> (manifest <hash>): <changes>.
<n> specs, <n> blocks scored.
Mode F, free-running: <in> of <total> blocks in the radius (<direct> direct, <forward> forward), <out> out. <cells in> of <cells> cells.
  A cell reruns whole: <sent> of <total> blocks sent, <x>% saved; <n> of <cells> cells left to carry.
Mode T, teacher-forced: ...
  A block runs alone in this mode: a rerun of the radius sends <in> of <total> blocks, <x>% saved.
```

Then, per mode, a table of the specs in the radius: `blocks in` (of the scored blocks), `from` (the first
direct block) and `why` (the changes that selected it). A whole-suite radius prints `The radius is the
whole suite: <change>: <reason>. Nothing can be carried.` and exits 1.

A radius campaign prints the radius, then the audit (`Audit: n cells drawn from the m outside the radius
(seed s) and run fresh: k misses. At 95% confidence, under x% of the carried cells would disagree.`), then
how many cells ran fresh and how many were carried, and the blocks saved. With no miss in n audits the
share of carried cells the new agent would not reproduce is under `1 - 0.05^(1/n)` at 95% confidence.
Carried results are never paired in `compare`; see `results-statistics`.

## Worked example

On the gated Acme suite (195 specs, generated, so every block records its dependencies). No model is
called.

```sh
driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml --mode F,T
driftbench radius examples/acme/gated/specs --change examples/acme/radius/model.yaml # exit 1
driftbench radius examples/acme/gated/specs/deviation --change examples/acme/radius/deviation-tool-failure.yaml --mode T --explain
driftbench radius auto --prompt examples/acme/src/policy.ts examples/acme/src/policy.ts --map examples/acme/map/approved.yaml --source ../src/policy.ts --from-version acme-v1 --to-version acme-v1
driftbench campaign run examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v1 --store radius.db --campaign c-v1
driftbench campaign run examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v2 --store radius.db --campaign c-v2 --change examples/acme/radius/deviation-goal-shift.yaml --from c-v1 --audit 10
```

The D2 handler change, in modes F and T:

```text
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml --mode F,T
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 22 of 861 blocks in the radius (9 direct, 13 forward), 839 out. 9 of 195 cells.
  A cell reruns whole: 55 of 861 blocks sent, 93.6% saved; 186 of 195 cells left to carry.
Mode T, teacher-forced: 9 of 861 blocks in the radius (9 direct, 0 forward), 852 out. 9 of 195 cells.
  A block runs alone in this mode: a rerun of the radius sends 9 of 861 blocks, 99.0% saved.
In the radius, mode F:
  spec           blocks in  from              why
  gen-twise-003  3 of 6     b4-D2_goal_shift  deviation:D2
  gen-twise-014  3 of 6     b4-D2_goal_shift  deviation:D2
  gen-twise-036  2 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-058  3 of 7     b5-D2_goal_shift  deviation:D2
  gen-twise-080  2 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-091  2 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-102  2 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-113  2 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-124  3 of 6     b4-D2_goal_shift  deviation:D2
In the radius, mode T:
  spec           blocks in  from              why
  gen-twise-003  1 of 6     b4-D2_goal_shift  deviation:D2
  gen-twise-014  1 of 6     b4-D2_goal_shift  deviation:D2
  gen-twise-036  1 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-058  1 of 7     b5-D2_goal_shift  deviation:D2
  gen-twise-080  1 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-091  1 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-102  1 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-113  1 of 6     b5-D2_goal_shift  deviation:D2
  gen-twise-124  1 of 6     b4-D2_goal_shift  deviation:D2
```

A model change reaches every block:

```text
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/model.yaml
Blast radius of acme-v1 to acme-v2 (manifest 4cf2b47146d9): model.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
The radius is the whole suite: model: a model or setting change can affect every block. Nothing can be carried.
(exit 1)
```

`--explain` on the seven deviation specs with the D8 handler change, mode T:

```text
$ driftbench radius examples/acme/gated/specs/deviation --change examples/acme/radius/deviation-tool-failure.yaml --mode T --explain
Blast radius of acme-v1 to acme-v2 (manifest 2644cc4586c7): deviation:D8.
7 specs, 34 blocks scored (1 more run with their spec and are not scored: a gate rejected them).
Mode T, teacher-forced: 1 of 34 blocks in the radius (1 direct, 0 forward), 33 out. 1 of 7 cells.
  A block runs alone in this mode: a rerun of the radius sends 1 of 34 blocks, 97.1% saved.
In the radius, mode T:
  spec               blocks in  from                why
  gen-deviation-007  1 of 5     b5-D8_tool_failure  deviation:D8
deviation:D8: declared in the manifest
gen-deviation-001/b1-D1_off_topic: {"T":"out"}: outside declared changes
gen-deviation-001/b2-needs-to-address: {"T":"out"}: outside declared changes
gen-deviation-001/b3-address-to-offer: {"T":"out"}: outside declared changes
gen-deviation-001/b4-offer-to-callback: {"T":"out"}: outside declared changes
gen-deviation-001/b5-callback-to-handover: {"T":"out"}: outside declared changes
gen-deviation-004/b1-needs-to-address: {"T":"out"}: outside declared changes
gen-deviation-004/b2-address-to-offer: {"T":"out"}: outside declared changes
gen-deviation-004/b3-offer-to-details: {"T":"out"}: outside declared changes
gen-deviation-004/b4-details-to-recap: {"T":"out"}: outside declared changes
gen-deviation-004/b5-D4_loose_confirmation: {"T":"out"}: outside declared changes
gen-deviation-004/b6-recap-to-order_placed: {"T":"out"}: outside declared changes
gen-deviation-005/b1-needs-to-address: {"T":"out"}: outside declared changes
```

`radius auto` on an unchanged prompt with equal version labels writes a manifest with no change:

```text
$ driftbench radius auto --prompt examples/acme/src/policy.ts examples/acme/src/policy.ts --map examples/acme/map/approved.yaml --source ../src/policy.ts --from-version acme-v1 --to-version acme-v1
from: acme-v1
to: acme-v1
changes: []
```

The radius campaign on the 99 t-wise specs, with a 10-cell audit:

```text
$ driftbench campaign run examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v2 --store radius.db --campaign c-v2 --change examples/acme/radius/deviation-goal-shift.yaml --from c-v1 --audit 10
Campaign c-v2: 99 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 26 criteria in 180 blocks of 99 specs (behaviour.B-001, flow.upgrade, deviation.D1_off_topic, deviation.D2_goal_shift, deviation.D3_contradiction, and 21 more), none of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
Audit: 10 cells drawn from the 90 outside the radius (seed 1) and run fresh: 0 misses. At 95% confidence, under 25.9% of the carried cells would disagree.
9 of 99 cells in the radius. 19 cells run fresh, 80 carried from c-v1.
  10 cells outside the radius run fresh: drawn for the audit.
99 cells: 99 pass, 0 fail, 0 failed, 10 reused, 80 carried. Spent $0.00.
Fresh: 19 cells, 112 blocks sent to the agent. Carried from c-v1: 80 cells, 403 blocks not sent (agent version acme-v1; this campaign runs acme-v2).
Saved: 403 of 515 blocks, 78.3%. The pass and fail counts above merge fresh and carried results.
```

## Common errors

| Message | Cause and fix |
|---|---|
| `radius needs spec paths and --change <manifest>.` (exit 2) | give both |
| `The change manifest is invalid, so no radius was computed.` (exit 2) | the lines above it name each schema error of the manifest |
| `--mode takes T, F or P, separated by commas` (exit 2) | fix the mode list |
| `The radius is the whole suite: ... no block declares a dependency on it.` (exit 1) | the change names something no block reads, or the specs are hand-written with no `metadata.depends`. Declare the dependencies, or rerun the whole suite |
| `--prompt takes exactly two files: old then new.` (exit 2) | pass the old and the new prompt |
| `The map has no source <path>; pass --source with its declared path.` (exit 2) | `--source` must match a `sources[].path` of the map, relative to the map |
| a radius campaign carries nothing | the campaign names no agent version, the version is not the manifest's `to`, or the `--from` campaign holds no run of the manifest's `from`. Or the audit found a miss. The first lines say which |
