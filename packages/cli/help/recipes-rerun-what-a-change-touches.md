---
title: Rerun only what a change touches
summary: Name a change in a manifest and print its blast radius. Run only those cells and carry the rest from a baseline. Audit the carry, and rerun single blocks in mode T, on Acme.
commands:
  - radius
  - radius auto
  - radius sections reanchor
  - campaign run
  - campaign status
  - ci
see_also:
  - core-exit-codes
  - recipes-test-a-chat-agent
  - recipes-gate-in-ci
  - recipes-find-why-a-test-failed
next:
  - recipes-benchmark-a-judge
---

## Goal

You changed one part of an agent: a stage, a tool, a rule, the handling of one deviation, a prompt line. You
want to run only the tests that change can affect, keep the stored results of every other test from the last
full run, and still trust the whole result.

The chain is: write a change manifest that names what changed, print the blast radius of the change on your
suite, run a baseline campaign once under the old agent version, run the radius under the new version with
`campaign run --change --from`, where every cell outside the radius is carried from the baseline, and check
the carry with an audit sample. In mode T, `--block-reruns` sends only the blocks in the radius. The radius
is computed from what each block already declares it reads; nothing new is written in a spec.

## Before you start

* A checkout of driftbench, built: `pnpm install`, then `pnpm build`. Run every command from the repository
  root as `pnpm -s driftbench <command>`. See `driftbench help core-getting-started`.
* A suite whose blocks declare what they read. Generated specs do (their cell, phrase, path and deviation
  class); a hand-written spec does through `metadata.depends` (`tools`, `stages`, `rules`, `atoms`,
  `fixtures`). The Acme gated suite, `examples/acme/gated/specs`, has 195 specs: 171 conversations in the
  folders `boundary`, `cover`, `deviation`, `graph`, `metamorphic`, `twise`, and 24 tasks in `task`.
* Change manifests: `examples/acme/radius` holds one per kind of change. Every field is in
  `docs/reference/change.md`, every rule in `docs/concepts/blast-radius.md`.
* Every command in a `sh` block below runs with no model and no key, and writes only to new paths in the
  folder you run it in: `acme.db`, `modes.db`, `auto.yaml`.

## Steps

### 1. Name the change in a manifest

The manifest says which agent version the change goes from and to, and every change made between the two.
`examples/acme/radius/deviation-goal-shift.yaml`, a change to how the agent handles a change of goal:

```text
from: acme-v1
to: acme-v2
changes:
  - kind: deviation
    id: D2
```

A change has a `kind` and an `id`. The kinds: `stage` (a stage of the catalogue), `tool` (a tool label,
with `part: input`, `result`, `description` or `presence`; no part counts every block that lists the tool),
`rule` (`states@<stage>`, `recovery:<class>`, `uses_tool:<tool>`, `path:<id>`, `reply_language`, or a spec
rule such as `max_calls`), `deviation` (`D2` or `D2_goal_shift`), `prompt` (an estate atom id), `map`
(`dimension=value`), `fixture`, `criterion`, and `model` or `agent` (the whole suite). `global: true` makes
any change the whole suite. The versions must be the ones your campaigns record with `--agent-version`.

### 2. Print the blast radius

`radius` runs nothing and writes nothing: it prints the blocks of the suite the change can affect.

```sh
driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml --mode F,T
```

```text
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 22 of 861 blocks in the radius (9 direct, 13 forward), 839 out. 9 of 195 cells.
  A cell reruns whole: 55 of 861 blocks sent, 93.6% saved; 186 of 195 cells left to carry.
Mode T, teacher-forced: 9 of 861 blocks in the radius (9 direct, 0 forward), 852 out. 9 of 195 cells.
  A block runs alone in this mode: a rerun of the radius sends 9 of 861 blocks, 99.0% saved.
In the radius, mode F:
  spec           blocks in  from              why
  gen-twise-003  3 of 6     b4-D2_goal_shift  deviation:D2
...
```

A block is direct when its dependencies name a change, and forward when it follows a direct block in the
same run: in modes F and P a block inherits the agent's earlier replies, so everything after a direct block
is in; in mode T a block starts from the Given the spec writes, so nothing follows. The unit that reruns is
the cell (one spec, target, mode and repeat), from its first block. `--mode` defaults to `F`. Exit 0 means
the radius is smaller than the suite.

### 3. See why each block is in or out

`--explain` prints, after the table, every block with its state and its reasons. `--json` prints one
document with `manifest`, `modes`, `whole`, `specs` and `totals`; each block of each spec has `state` per
mode (`direct`, `forward` or `out`) and `why`.

```sh
driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml --explain
```

```text
...
deviation:D2: declared in the manifest
...
gen-twise-003/b3-offer-to-recap: {"F":"out"}: outside declared changes
gen-twise-003/b4-D2_goal_shift: {"F":"direct"}: deviation:D2
gen-twise-003/b5-recap-to-order_placed: {"F":"forward"}: outside declared changes
...
```

### 4. Know when the radius is everything

Unknown means in. A hand-written spec with no `metadata.depends` has unknown dependencies and is in every
radius; a change the radius cannot map, or that no block declares, is the whole suite.

```sh
driftbench radius examples/acme/specs --change examples/acme/radius/stage-recap.yaml
driftbench radius examples/acme/gated/specs --change examples/acme/radius/reply-language.yaml  # exit 1
```

```text
Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.
7 specs, 28 blocks.
Mode F, free-running: 28 of 28 blocks in the radius (28 direct, 0 forward), 0 out. 7 of 7 cells.
  ...
  28 blocks with unknown dependencies (a hand-written spec with no metadata.depends): in every radius.
...
Blast radius of acme-v1 to acme-v2 (manifest 0bf51ed76989): rule:reply_language.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
The radius is the whole suite: rule:reply_language: the reply language rule holds on every block. Nothing can be carried.
```

The first command exits 0 although every block is in: its blocks are in one by one, for unknown
dependencies. The second exits 1 because the change itself selects the whole suite: `model`, `agent`,
`reply_language`, `global: true`, a new tool no block names. Add `metadata.depends` to hand-written specs to
give them a real radius.

### 5. Run a baseline campaign under the old version

Carried results come from a stored campaign, so run the whole suite once, naming the version. The
conversations of the gated suite run on the sales assistant; `--agent-version` stamps every run.

```sh
driftbench campaign run examples/acme/gated/specs/boundary examples/acme/gated/specs/cover \
  examples/acme/gated/specs/deviation examples/acme/gated/specs/graph examples/acme/gated/specs/metamorphic \
  examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v1 --campaign c-base \
  --store acme.db
```

```text
...
171 cells: 171 pass, 0 fail, 0 failed. Spent $0.00.
```

To include the tasks, run `examples/acme/gated/specs` whole with `--route flow:price-sheet=process:acme-ops`.

### 6. Run only the radius under the new version, with an audit

`--change` runs the cells in the radius on the new version and copies the stored run of every other cell from
`--from`. `--audit <n>` first draws n of the cells about to be carried, runs them fresh and compares each
with its stored run; one difference is a radius miss, and then nothing is carried.

```sh
driftbench campaign run examples/acme/gated/specs/boundary examples/acme/gated/specs/cover \
  examples/acme/gated/specs/deviation examples/acme/gated/specs/graph examples/acme/gated/specs/metamorphic \
  examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v2 --campaign c-v2 \
  --store acme.db --change examples/acme/radius/deviation-goal-shift.yaml --from c-base --audit 20
```

```text
...
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
Audit: 20 cells drawn from the 162 outside the radius (seed 1) and run fresh: 0 misses. At 95% confidence, under 13.9% of the carried cells would disagree.
9 of 171 cells in the radius. 29 cells run fresh, 142 carried from c-base.
  20 cells outside the radius run fresh: drawn for the audit.
✓ gen-boundary-063 · function:acme-sales · F · repeat 0  pass (carried from c-base, age 1 campaign)  5 blocks
✓ gen-boundary-064 · function:acme-sales · F · repeat 0  pass (reused)  2 blocks
...
171 cells: 171 pass, 0 fail, 0 failed, 20 reused, 142 carried. Spent $0.00.
Fresh: 29 cells, 142 blocks sent to the agent. Carried from c-base: 142 cells, 690 blocks not sent (agent version acme-v1; this campaign runs acme-v2).
Saved: 690 of 832 blocks, 82.9%. The pass and fail counts above merge fresh and carried results.
```

The audited cells ran before the cell lines, so their lines say `reused`; they are fresh runs of this
campaign. No miss in n audits bounds the share of carried cells the new agent would not reproduce, at 95%
confidence, by `1 - 0.05^(1/n)`: under 13.9% for 20, under 5% for 59. `--audit-seed <n>` changes the draw
(default 1). `--max-carry <n>` (default 5) is the most campaigns in a row a result is carried, and
`--max-age <days>` (default 7) the most days since it was measured; past either, the cell runs fresh.
Nothing is carried when the campaign names no `--agent-version` or `--prompt`, when that version is not the
manifest's `to`, or when `--from` holds no run of the manifest's `from`; the first lines say why.

### 7. Read which cells were carried

`campaign status` marks each carried cell with the campaign it comes from and its age.

```sh
driftbench campaign status c-v2 --store acme.db
```

```text
Campaign c-v2, created 2026-10-14T14:31:08.850Z.
✓ gen-boundary-063 · function:acme-sales · F · repeat 0  pass (carried from c-base, age 1 campaign)  5 blocks
✓ gen-boundary-064 · function:acme-sales · F · repeat 0  pass  2 blocks
...
171 cells: 171 pass, 0 fail, 0 failed, 142 carried. Spent $0.00.
```

A carried result is the baseline copied. `compare` and `ci --change` pair only fresh cells with the
baseline, so carried cells never narrow an interval; the scorecard counts both and says so. Run the whole
suite with no `--change` on a schedule, nightly for instance, so every age starts from 0 again.

### 8. In mode T, rerun single blocks

In mode T each block starts from the Given the spec writes, so a change that reaches 1 block of a 6 block cell
needs only that block sent. `--block-reruns` sends the blocks in the radius and keeps the other stored blocks.
The baseline must record end-state snapshots, or every cell with an `end_state` reruns whole.

```sh
driftbench campaign run examples/acme/gated/specs/boundary examples/acme/gated/specs/cover \
  examples/acme/gated/specs/deviation examples/acme/gated/specs/graph examples/acme/gated/specs/metamorphic \
  examples/acme/gated/specs/twise --target function:acme-sales --mode T --agent-version acme-v1 \
  --campaign t-base --store modes.db --record-end-state-snapshots
driftbench campaign run examples/acme/gated/specs/boundary examples/acme/gated/specs/cover \
  examples/acme/gated/specs/deviation examples/acme/gated/specs/graph examples/acme/gated/specs/metamorphic \
  examples/acme/gated/specs/twise --target function:acme-sales --mode T --agent-version acme-v2 \
  --campaign t-next --store modes.db --change examples/acme/radius/tool-coverage-check-input.yaml \
  --from t-base --block-reruns
```

```text
171 cells: 171 pass, 0 fail, 0 failed. Spent $0.00.
...
Blast radius of acme-v1 to acme-v2 (manifest c09d178d893f): tool:coverage.check:input.
86 of 171 cells in the radius. 86 cells run fresh, 85 carried from t-base.
Mode T block reruns: 86 cells send 86 blocks and keep 330 stored blocks from t-base.
171 cells: 171 pass, 0 fail, 0 failed, 85 carried. Spent $0.00.
Fresh: 86 cells, 86 blocks sent to the agent. Carried from t-base: 85 cells, 746 blocks not sent (agent version acme-v1; this campaign runs acme-v2).
Saved: 746 of 832 blocks, 89.7%. ...
```

A cell runs in part only in mode T, with the scripted driver, on an adapter with no sandbox, from a baseline
run where every block passed; otherwise it runs whole and the campaign prints why. Snapshots hold raw values
read from the agent's systems, so treat them like the stored replies.

### 9. Derive the manifest from a prompt edit

`radius auto` compares the old and new prompt files against the approved map's evidence quotes, and writes a
manifest. An edit inside exactly one approved quote names that anchor; anything it cannot place selects the
whole suite. Here the two files are the same and the version labels differ, so nothing explains the version
change and the manifest is the whole suite:

```sh
driftbench radius auto --prompt examples/acme/src/policy.ts examples/acme/src/policy.ts \
  --map examples/acme/map/approved.yaml --source ../src/policy.ts --from-version acme-v1 --to-version acme-v2 \
  --out auto.yaml
driftbench radius examples/acme/gated/specs --change auto.yaml  # exit 1
```

```text
Blast radius of acme-v1 to acme-v2 (manifest b773fc888d9b): prompt:global.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
The radius is the whole suite: prompt:global: the change is declared global. Nothing can be carried.
```

Without `--out` the manifest is printed as YAML; here it holds one change, `kind: prompt`, `global: true`,
with a note: `region none: no normalized change explains the version transition; whole suite`. `--source`
picks the map's evidence source, by default the old prompt path relative to the map. Without
`--from-version` and `--to-version` the versions are the text content hashes; pass the versions your
campaigns record. On your own agent the old prompt usually comes from version control. This reads git, so it
is shown as text:

```text
git show HEAD~1:prompts/agent.md > old-prompt.md
driftbench radius auto --prompt old-prompt.md prompts/agent.md --map map/approved.yaml \
  --from-version v1 --to-version v2 --out change.yaml
driftbench radius specs --change change.yaml --explain
```

With the full Acme map, which holds repeated and overlapping quotes, an edit selects the whole suite;
`docs/concepts/blast-radius.md` shows a focused one-anchor map that narrows a price edit to its offer blocks.

### 10. See what selection by section links would skip

A prompt with a section registry gives a finer manifest: `radius sections reanchor --change-out` names each
edited section as a `prompt_section` change. Such a change is the whole suite, because declared links miss
behaviour that crosses sections; `--sections` prints what selection by links would run, as advice only.
Here the explicit confirmation rule of the Acme prompt is loosened, and three linked specs are read:

```sh setup
sed 's/A loose yes such as "sure", "ok" or "go ahead" is not enough/A loose yes such as "sure" or "ok" is enough/' examples/acme/prompts/acme-sales.md > acme-sales-v2.md
```

```sh
driftbench radius sections reanchor examples/acme/prompts/acme-sales.sections.yaml \
  --prompt examples/acme/prompts/acme-sales.md acme-sales-v2.md --to-version v2 --change-out sections.yaml  # exit 1
driftbench radius examples/acme/prompts/linked --change sections.yaml \
  --sections examples/acme/prompts/acme-sales.sections.yaml  # exit 1
```

```text
acme-sales v1 to v2: 23 kept, 6 moved, 1 stale.
  stale explicit_confirm: the anchor is found but the section text changed: edited inside
Every link to a stale section reads as stale until its span is declared again.
Blast radius of v1 to v2 (manifest c87414677dc4): prompt_section:acme-sales#explicit_confirm.
3 specs, 7 blocks.
The radius is the whole suite: prompt_section:acme-sales#explicit_confirm: section selection is advisory until links are verified by mutation: the whole suite runs. Nothing can be carried.
Advisory section selection (acme-sales#explicit_confirm): nothing is skipped, the whole suite runs until links are verified by mutation.
  With references, overrides and duplicates: acme-sales#upgrade_order, acme-sales#order_failure.
  Would run 3 of 7 blocks (2 by links, 1 forward) and would skip 4: 57.1% of the suite.
  spec                       blocks  from       links that drove it
  acme-linked-order-confirm  3 of 4  loose-yes  link:acme-sales#explicit_confirm (declared)
```

`campaign run --change sections.yaml` runs every cell: nothing is carried while selection is advisory.

## What you have at the end

* `acme.db`: the baseline `c-base` under `acme-v1`, and `c-v2` under `acme-v2`: 29 cells fresh, 142
  carried, the audit clean.
* `modes.db`: the mode T baseline with end-state snapshots, and `t-next`, which sent 86 blocks.
* `auto.yaml`: a manifest written from two prompt files.
* `sections.yaml`: a `prompt_section` manifest, and the advisory list of what links alone would rerun.
* A way to gate the same radius in CI: `driftbench ci --change <manifest> --agent-version <to>` runs the
  radius, carries the rest from the `--baseline` campaign of `--store`, and with `--audit <n>` gives the
  verdict `radius-miss` (exit 1) on a difference. See `driftbench help recipes-gate-in-ci`.

## When a step fails

* `radius` exits 1: the change selects the whole suite. The output names the change and why; nothing can be
  carried. Split a `global` change, or accept a full run.
* Every block of a hand-written spec is in: it has unknown dependencies. Add `metadata.depends` to the spec.
* `campaign run --change` runs every cell and says nothing is carried: the campaign names no agent version,
  its version is not the manifest's `to`, or `--from` holds no run of the manifest's `from`. Pass
  `--agent-version <to>` and a `--from` campaign run with `--agent-version <from>`.
* `RADIUS MISS: the change reaches cells the manifest left out of the radius` (exit 1): an audited cell
  differs from its stored run. Nothing is carried, every cell runs, and the output names the cell and what
  differed. Add the missing change to the manifest.
* A cell runs fresh although it is outside the radius: `--from` holds no completed run of it, or the run
  is older than `--max-carry` campaigns or `--max-age` days.
* `--block-reruns` sends whole cells: the mode is not T, the baseline has no end-state snapshots for a spec
  with `end_state`, a baseline block failed, or every block of the cell is in the radius. The campaign prints
  the reason per cell.
* A campaign id given with `--campaign` that already exists in the store is refused with exit 2; pick a new
  one.
