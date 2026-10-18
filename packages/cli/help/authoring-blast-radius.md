---
title: Blast radius
summary: 'Compute which blocks of a suite a change to the agent can affect. The input is a change manifest you write or one `radius auto` derives from a prompt diff. Then you rerun only those blocks.'
commands:
  - radius
  - radius auto
see_also:
  - results-radius
  - authoring-prompt-sections
  - authoring-spec-format
  - authoring-blocks
  - authoring-map
  - authoring-generate
  - authoring-deviation-classes
  - authoring-perturbations
  - authoring-task-families
  - authoring-gate
next:
  - results-radius
---

## What it is

A change to one part of an agent has a blast radius: the blocks that part can affect. driftbench computes the radius from what each block already says it reads. That is its Then, its Given, the map cell the generator recorded, its estate atoms, or what its author declared. Nothing runs.

You describe the change in a change manifest: the agent version before (`from`), the version after (`to`), and a list of changes. Each change has a `kind` and, for most kinds, an `id`.

`driftbench radius` reads the specs and the manifest. It prints, per run mode, which blocks are in the radius and how much a rerun saves against the whole suite. It is read only: it writes nothing.

`driftbench radius auto` writes a change manifest for you from two versions of a prompt file and an approved map whose entries carry evidence quotes. A change inside exactly one approved quote becomes a narrow change. Any doubt becomes a whole-suite change.

A prompt can also carry a section registry, which names its sections by stable ids. Blocks can link to the sections they test in `metadata.links`. The registry, re-anchoring and links are in authoring-prompt-sections. Links stay out of the spec hash, so adding them never invalidates a carry. A `prompt_section` change is always the whole suite. Selection by section links is advisory until links are verified by mutation. `radius --sections` only prints what it would skip.

Each block of each spec gets one state per mode:

| State | Meaning |
|---|---|
| `direct` | a dependency of the block names a change of the manifest (or the block has unknown dependencies, or the radius is the whole suite) |
| `forward` | the block comes after a direct block of the same run, and the mode carries history forward |
| `out` | the change cannot reach the block |

The forward closure depends on the mode:

| Mode | Forward rule |
|---|---|
| `F` free-running | every block after the first direct block of the spec is `forward` |
| `P` perturbed | every block from the earliest point where the change enters is `forward`. That point is the block after the first direct block, or the `inject_at` of a perturbation the change reaches |
| `T` teacher-forced | nothing follows: a block starts from its canonical Given. One exception: in a task spec (a sandbox), the blocks after a direct block are `forward` until a block that sets its own `given.world.workspace` |

The unit that reruns is the cell (one spec, one target, one mode, one repeat). In modes F and P a cell in the radius reruns whole, from its first block. In mode T a block can run alone.

Unknown means in. The radius is conservative:

* A block with unknown dependencies is in every radius (reason `unknown-deps`). A block is unknown when its spec has no `metadata.generated`, no `metadata.estate.atoms` and no `metadata.depends`.
* A change the radius cannot map makes the radius the whole suite. These changes cannot be mapped: an unknown kind, `model`, `agent`, `global: true`, the rule `reply_language`, a change with no `id`, a `map` id without `=`.
* A change no block declares makes the radius the whole suite (`no block declares a dependency on it`), for example a new tool. A `criterion` change is the exception: a criterion no block names selects nothing.
* A manifest with no change between two different versions is the whole suite. With `from` equal to `to` and no change, the radius is empty.

When the radius is the whole suite, nothing can be carried, and `radius` exits 1.

Other commands consume the same manifest (documented elsewhere):

* `driftbench campaign run --change <manifest> --from <campaign>` runs the cells in the radius and carries the stored runs of the other cells.
* `driftbench ci --change <manifest>` gates a candidate on the radius and carries the rest from the baseline.
* `driftbench campaign rejudge --change <manifest>` re-judges `criterion` changes on stored observations.

## When to use it

* Before a rerun after a fix: see how many cells and blocks a change reaches, and what a rerun of only those saves.
* To check a manifest before you hand it to `campaign run --change` or `ci --change`: if `radius` exits 1, those commands run everything.
* After a prompt edit: run `radius auto` to turn the diff into a manifest, then `radius --explain` to see which anchor matched and which blocks it selects.
* To see why a block is in: `--explain` or `--json` give the reason for each block.

Do not use it as proof that the new agent equals the old one outside the radius. The radius is sound only when the manifest lists every change and a block's outcome depends only on its declared dependencies and its run history. A full run on a schedule checks the rest.

## Commands and every option

### driftbench radius

```
driftbench radius <paths...> --change <manifest> [--mode <modes>] [--explain] [--json] [--sections <registries...>]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (argument, required) | spec files or folders. Folders are searched for spec files. Every spec must be valid | none |
| `--change <manifest>` (required in practice) | the change manifest, YAML or JSON (`.json` extension reads JSON, any other extension reads YAML). Relative to the current folder. Commander does not mark it required; the command exits 2 without it | none |
| `--mode <modes>` | the run modes to plan for: `T` teacher-forced, `F` free-running, `P` perturbed. Several separated by commas, for example `T,F`. Spaces around each are trimmed, repeats are dropped, the output follows your order | `F` |
| `--explain` | after the normal output, print one line per manifest change (`<kind>:<id or global>: <note>`, or `declared in the manifest` when the change has no note). Then print one line per block of every spec: `<specId>/<blockId>: <state JSON>: <reasons>`. Ignored with `--json` | off |
| `--json` | print one JSON document instead of the text | off |
| `--sections <registries...>` | section registries (authoring-prompt-sections). When the manifest holds `prompt_section` changes, print the advisory section selection after the radius. It lists the blocks selection by section links would run and the ones it would skip. Nothing is skipped: the radius stays the whole suite. With `--explain`, one `<specId>/<blockId>: advisory <state>: <reasons>` line per block; with `--json`, the key `advisory` | off |

Exit codes:

| Code | When |
|---|---|
| 0 | the radius is smaller than the whole suite (an empty radius included) |
| 1 | the radius is the whole suite |
| 2 | bad input: no paths or no `--change`, a bad `--mode` value, an invalid or unreadable manifest, no spec files found, an invalid spec |

### driftbench radius auto

```
driftbench radius auto --prompt <old> <new> --map <file> [--source <path>] [--from-version <version>] [--to-version <version>] [--out <file>]
```

| Option | Meaning | Default |
|---|---|---|
| `--prompt <files...>` (required) | exactly two files: the old prompt, then the new prompt | none |
| `--map <file>` (required) | the approved map proposal with evidence quotes, or an estate map with atom provenance, in YAML or JSON | none |
| `--source <path>` | which source of the map the prompt pair is. It must equal one `sources[].path` of a proposal, or an atom's `provenance.file` in an estate map. Only this source becomes anchors; every other source is treated as unchanged | the old prompt path relative to the folder of the map, with `/` separators |
| `--from-version <version>` | the `from` of the manifest: the baseline agent version | the content hash of the old text (12 hex characters) |
| `--to-version <version>` | the `to` of the manifest: the candidate agent version | the content hash of the new text |
| `--out <file>` | write the manifest YAML to this file and print nothing | print the YAML on stdout |

Use the agent versions your campaigns record (`--agent-version` of `campaign run`). The default content hashes need not equal a prompt registry hash.

Which proposal entries become anchors (only approved entries whose `evidence.source` equals the source):

| Map entry | Change it maps to |
|---|---|
| a dimension value (approved itself, or through its dimension) | `map`, id `<dimension>=<value>` |
| a phrase | `map`, id `<dimension>=<value>` of the phrase |
| relation `states` | `rule`, id `states@<to>` |
| relation `path` | `rule`, id `path:<id>` |
| relation `recovery` | `deviation`, id `<class>` |
| relation `uses_tool` | `tool`, id `<tool>` (no part) |
| relation `reply_language` | `rule`, id `reply_language` (whole suite) |
| any other relation, a constraint, a numeric setting | an anchor with no change: an edit inside it is whole suite |

An estate map passes full schema, provenance-hash and map-hash validation first. Each selected
source atom must quote its recorded line span and have one exact occurrence in the old text.
Approved atoms map to `prompt`, id `<atom.id>`. Overlapping exact quote spans, including nested
and identical spans, become one union anchor carrying all their atom ids. This may select extra
tests; it does not extend the quote to the whole source line. If any atom in a changed group is
unapproved, the change is whole suite. Stale or ambiguous evidence also selects the whole suite.

How the diff maps to changes:

* Both texts are normalized first: CRLF and CR become LF, Unicode becomes NFC. Offsets count UTF-16 code units in the normalized text. Other whitespace is kept. A quote matches across any run of whitespace.
* The diff is a character edit distance alignment. It admits at most 64 single-character edits and 8,000,000 band cells; beyond that the result is the whole suite.
* Every changed region must lie strictly inside exactly one anchor in both the old and the new text. Each anchor quote must occur exactly once in the old text. It must be located in the new text through its unchanged first and last characters. It must occur exactly once there too. Anchors must not overlap.
* Otherwise the manifest holds one change `kind: prompt, global: true` (the whole suite). Its `note` names each region and the rule that failed: `stale quote in old text`, `ambiguous quote in old text`, `ambiguous quote in new text`, `anchor cannot be located unambiguously in new text`, `overlapping anchors`, `empty quote`, `ambiguous optimal diff alignment`, `diff exceeds the exact alignment bound`, `no quote matched on both sides`, `unmapped anchor`.
* Identical texts (after normalization) give `changes: []` when the versions are equal, and the whole suite when they differ (`region none: no normalized change explains the version transition`).

Exit codes:

| Code | When |
|---|---|
| 0 | a manifest was written or printed. A whole-suite manifest also exits 0: read its `changes` |
| 1 | the map does not parse as a map proposal: an uncaught validation error with a stack trace |
| 2 | `--prompt` without exactly two files, a missing required option, a source the map does not declare, a file that cannot be read |

## Inputs

### The change manifest

YAML or JSON. Strict: an unknown key is an error at every level.

`ChangeManifest`:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `from` | string, not empty | yes | the agent version before the change |
| `to` | string, not empty | yes | the agent version after the change |
| `changes` | list of Change | yes | every change made between the two versions. May be empty |

`Change`:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kind` | string, not empty | yes | what changed: `stage`, `tool`, `rule`, `deviation`, `prompt`, `map`, `fixture`, `criterion`, `model`, `agent`, `prompt_section`. Any other string is accepted and makes the radius the whole suite |
| `id` | string, not empty | no | which one (see the table below). Without it, every kind is the whole suite |
| `part` | `input`, `result`, `description` or `presence` | no | for a tool: which part changed. Absent: any part, the widest reading |
| `global` | boolean | no | `true` when the change applies to every block, such as a tone rule: the whole suite |
| `note` | string | no | a free note. `--explain` prints it; `radius auto` writes the anchor and region here |

The manifest hash is the content hash of the parsed manifest, so comments and key order do not change it. The radius names each change by its label: `kind`, then `id`, `part` and `global` when present, joined by `:` (`tool:coverage.check:input`, `prompt:global`).

What each kind selects:

| Kind | Id | Blocks it selects |
|---|---|---|
| `stage` | a stage name | blocks whose expected stage, own cell stage, stage transition (`offer-to-recap` names both) or declared stages name it |
| `tool` | a tool label | depends on `part`, see below |
| `rule` | `states@<stage>` | blocks that assert on reply text (`must`, `must_not`) and name that stage |
| `rule` | `recovery:<class>` or `recovery:<class>@<flow>` | blocks that carry that deviation class, in that flow when named. `recovery:` with no class is the whole suite |
| `rule` | `uses_tool:<tool>` | the same as a `tool` change with no part. No tool: whole suite |
| `rule` | `path:<id>` | blocks of specs whose generator record names that path. No id: whole suite |
| `rule` | `reply_language` | the whole suite |
| `rule` | any other name | blocks of specs whose rules carry it: `max_calls`, `forbidden_tools`, `lang_stable`, `one_message_per_turn`, `match_case`, `custom.<name>`, or a name in `metadata.depends.rules` |
| `deviation` | a class, `D2` or `D2_goal_shift` | blocks that carry the class (an injection's class, or the `deviation` of the cell). `D2` also matches `D2_<anything>` |
| `prompt` | an estate atom id | blocks of specs whose `metadata.estate.atoms` or `metadata.depends.atoms` name it |
| `map` | `dimension=value` | blocks whose cell holds that value, or whose When was phrased from it |
| `fixture` | a name or a literal value | blocks whose Given (spec and blocks up to this one) names it as a world store key, a fixture name, a workspace file or `workspace.from`. It also selects specs of family `<id>` as `family:<id>` (from `metadata.family.id` or a `family:` tag). It also selects names in `metadata.depends.fixtures`. It also selects blocks whose When, expected tool inputs, Given or end state hold the literal text |
| `criterion` | a criterion name | blocks whose `expect.criteria` name it |
| `model`, `agent` | none | the whole suite |
| `prompt_section` | `<prompt-id>#<section-id>`, or a section id alone for any prompt | the whole suite, with the reason `section selection is advisory until links are verified by mutation`. `--sections` prints which blocks the section links would select (authoring-prompt-sections) |

What a tool change selects, by `part`:

| `part` | Blocks |
|---|---|
| `input` | blocks that expect the tool called (count not 0), or assert on its input; every block of a spec whose `rules.max_calls` caps it above 0 |
| `result` | blocks that expect the tool called (count not 0). Blocks whose Given forces its result or error (`given.world.tools`). The last block of a spec whose end state reads `tool:<label>` |
| `description`, `presence` or absent | every block that lists the tool, count 0 included. Specs that cap or forbid it. Blocks whose `expect.tools_offered` includes or excludes it. Blocks that force it. End states that read it |

Minimal valid manifest:

```yaml
from: acme-v1
to: acme-v2
changes:
  - kind: deviation
    id: D2
```

Several changes, with a part and a note (JSON works the same):

```yaml
from: acme-v1
to: acme-v2
changes:
  - kind: stage
    id: recap
  - kind: tool
    id: coverage.check
    part: input
    note: the address field became two fields
```

### What a block declares so a change can select it

A change selects a block only through what the block carries. You write nothing new in a generated spec:

* Its Then: `expect.tools` (label, count, `input`, `input_closed`), `expect.tool_order`, `expect.tools_offered`, `expect.stage`, `expect.stage_reported`, `must`, `must_not`, `lang`. Its Then also holds `cards`, `skills`, `guards`, `execution`, `artifacts`, `workspace`, `safety`, `expect.criteria`, and the spec `rules`. The spec `end_state` counts on the last block only.
* Its Given: the spec `given` and every block `given` up to this block. That holds `world.tools` (forced results), `world.store`, `world.fixtures`, `world.workspace.files`, `world.workspace.from`, and the literals in `world`, `ledger`, `vars` and `prefix`.
* The generator record `metadata.generated`: `cell` (spec level), `blocks[].block` with `blocks[].cell` and `blocks[].phrase` (`dimension`, `value`), and `path`. A `flow:<name>` tag gives the flow when the cell has none.
* The estate atoms: `metadata.estate.atoms`.
* The task family: `metadata.family.id` or a `family:<id>` tag.
* A rejected block (`metadata.gate.blocks[]` with `status: rejected`) runs with its spec but is not counted.

A hand-written spec has none of the generator keys, so every block of it is in every radius. Declare its dependencies to take it out:

```yaml
metadata:
  depends:
    tools: [order.create]
    stages: [recap]
    rules: [confirmation]
    atoms: [a-12]
    fixtures: [cust-001]
```

| `metadata.depends` key | Type | Effect |
|---|---|---|
| `tools` | list of strings | each tool counts as expected with its input asserted, on every block |
| `stages` | list of strings | `stage` changes and `states@<stage>` rules see these stages on every block |
| `rules` | list of strings | `rule` changes with these names select every block |
| `atoms` | list of strings | `prompt` changes with these ids select every block; also marks the atoms known |
| `fixtures` | list of strings | `fixture` changes with these names select every block |

Any `metadata.depends` mapping, even an empty one, makes the spec's dependencies known. A `map` or `path:` change still marks a block with no recorded cell (`:unknown-cell`). A `prompt` change still marks a block with no atoms (`:unknown-atoms`).

### The map for radius auto

A map proposal file (the format of `examples/acme/map/approved.yaml`; see authoring-map and authoring-extract). The keys `radius auto` reads: `sources[].path`, and on each dimension value, phrase, relation, constraint and numeric setting: `approved` and `evidence` (`source`, `quote`). The whole file must pass the proposal schema (`version: 1`, `agent`, `produced_by`, `sources`, `dimensions`, `constraints`, `phrases`, optional `relations` and `numeric_settings`).

A proposal with many repeated or overlapping quotes over one source makes most edits whole suite. A focused proposal that declares only the anchors you trust gives a narrow manifest.

An estate map is the complete file from `estate scan` and `estate approve`; do not trim its atoms
or edit its provenance. `radius auto --prompt old.md new.md --map approved-estate.yaml --source CLAUDE.md`
uses the atom provenance described above. Unquoted text, boundary edits and ambiguous diffs still
select everything. A CRLF-only edit with identical version labels identifies no changes; a
different version label still selects everything, even when the normalized text is identical.

## Outputs and how to read them

### Text output of radius

| Line | Meaning | What to do |
|---|---|---|
| `Blast radius of <from> to <to> (manifest <hash>): <labels>.` | the versions, the manifest hash, every change label. `no change` when the list is empty | check the labels are the changes you meant |
| `<n> specs, <m> blocks scored (<k> more run with their spec and are not scored: a gate rejected them).` | specs and scored blocks. The bracket appears only when a gate rejected blocks; otherwise the line reads `<n> specs, <m> blocks.` | none |
| `The radius is the whole suite: <label>: <reason>. Nothing can be carried.` | the first change that made the radius the whole suite, and why. No other summary follows; exit 1 | narrow the change: name the `id`, the tool `part`, or declare the dependency in the specs |
| `Mode <M>, <name>: <in> of <total> blocks in the radius (<direct> direct, <forward> forward), <out> out. <c> of <C> cells.` | counts of scored blocks per state, and of cells in the radius | none |
| `  A block runs alone in this mode: a rerun of the radius sends <in> of <total> blocks, <p>% saved.` | mode T only: what a block level rerun sends | none |
| `  A cell reruns whole: <sent> of <total> blocks sent, <p>% saved; <left> of <C> cells left to carry.` | modes F and P: blocks of the cells in the radius, the saving, and cells a radius campaign can carry | none |
| `  <n> blocks with unknown dependencies (a hand-written spec with no metadata.depends): in every radius.` | some blocks have no record of what they read | add `metadata.depends` to those specs |
| `In the radius, mode <M>:` then a table | one row per spec with a cell in the radius | none |
| `Mode <M>: no cell in the radius.` | the change reaches no cell in that mode | none |

Table columns are `spec`, `cells`, `blocks in`, `from` and `why`. `spec` is the spec id. `cells` (mode P only) holds the P cells of the spec in the radius, one per perturbation. `blocks in` is the scored blocks not `out`, of the scored blocks of the spec. `from` is the first direct block; in mode P with no direct block, it is the perturbation ids. `why` holds the reasons of the cells, deduplicated.

Reasons a block or cell carries:

| Reason | Meaning |
|---|---|
| `<label>` | the change selects the block |
| `<label>:unknown-cell` | a `map` or `path:` change, and the block records no cell: in by default |
| `<label>:unknown-atoms` | a `prompt` change, and the spec names no atoms: in by default |
| `unknown-deps` | the block has unknown dependencies and no change selected it: in by default |
| `whole:<label>` | the radius is the whole suite because of that change |
| `outside declared changes` | (`--explain` only) no reason: the block is not direct |

A block with no id is shown as `block <index>` (0 based).

### --explain lines

After the text output: one line per change, `<kind>:<id or global>: <note or "declared in the manifest">`. Then one line per block of every spec: `<specId>/<blockId>: {"<mode>":"<state>",...}: <reasons joined by ", ">`. The lines print even when the radius is the whole suite. For a manifest from `radius auto`, the note names the region (`region old:<a>-<b> new:<c>-<d>`), the anchor entry (`relations[0]`), the source, the quote offsets and the quote. It ends with `covered on both sides` or the rule that failed.

### JSON output of radius

| Key | Meaning |
|---|---|
| `manifest.hash`, `manifest.from`, `manifest.to` | the manifest hash and versions |
| `manifest.changes` | the change labels |
| `modes` | the modes planned, in your order |
| `whole` | `null`, or `{ change, reason }` when the radius is the whole suite |
| `specs[].specId`, `specs[].hash`, `specs[].path` | the spec, its hash, its path relative to the current folder |
| `specs[].blocks[]` | `id`, `index`, `scored` (false for a gate rejected block), `why` (reasons; empty when not direct), `state` (`{ "<mode>": "direct" | "forward" | "out" }`) |
| `specs[].cells[]` | `mode`, `perturbationId` (mode P), `in`, `why` (the reasons of the first direct block, or of the perturbation) |
| `totals.<mode>` | `in` (direct plus forward), `direct`, `forward`, `out`, `total` (scored blocks). `unknown` (scored blocks with unknown dependencies), `cells.in`, `cells.total`, `sent` (scored blocks of the cells in the radius) |
| `advisory` | with `--sections` and `prompt_section` changes only: `{ advisory: true, changed, closure, all, specs[].blocks[] (id, index, state, why), counts (selected, direct, forward, skipped, total) }`. See authoring-prompt-sections |

`radius` writes no file.

### Output of radius auto

A change manifest in YAML, on stdout or in the `--out` file. Read `changes`. A narrow change (such as `rule` `states@offer`) means the edit lay inside one approved anchor. `kind: prompt` with `global: true` means the whole suite, and the `note` says which region and which rule. Pass the file to `radius --change`, `campaign run --change` or `ci --change`.

## Worked example

All commands run from the worktree root, with no model call. Files go to `out/authoring-blast-radius/`.

### A deviation change, mode F

```sh
driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml
```

```text
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 22 of 861 blocks in the radius (9 direct, 13 forward), 839 out. 9 of 195 cells.
  A cell reruns whole: 55 of 861 blocks sent, 93.6% saved; 186 of 195 cells left to carry.
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
(exit 0)
```

Nine blocks carry D2. The 13 blocks after them in the same conversations are forward. A rerun of the 9 cells sends 55 blocks.

### The same with --explain

```sh
driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml --explain
```

```text
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml --explain
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 22 of 861 blocks in the radius (9 direct, 13 forward), 839 out. 9 of 195 cells.
  A cell reruns whole: 55 of 861 blocks sent, 93.6% saved; 186 of 195 cells left to carry.
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
deviation:D2: declared in the manifest
gen-boundary-063/b1-needs-to-identify: {"F":"out"}: outside declared changes
gen-boundary-063/b2-identify-to-offer: {"F":"out"}: outside declared changes
gen-boundary-063/b3-offer-to-recap: {"F":"out"}: outside declared changes
(358 more lines)
gen-twise-003/b2-identify-to-offer: {"F":"out"}: outside declared changes
gen-twise-003/b3-offer-to-recap: {"F":"out"}: outside declared changes
gen-twise-003/b4-D2_goal_shift: {"F":"direct"}: deviation:D2
gen-twise-003/b5-recap-to-order_placed: {"F":"forward"}: outside declared changes
gen-twise-003/b6-order_placed-to-closing: {"F":"forward"}: outside declared changes
(499 more lines)
gen-twise-131/b5-recap-to-order_placed: {"F":"out"}: outside declared changes
gen-twise-131/b6-order_placed-to-closing: {"F":"out"}: outside declared changes
(exit 0)
```

`b4-D2_goal_shift` is direct. `b5` and `b6` are forward: they follow a direct block in a free-running conversation, so they read the changed reply.

### Two modes

```sh
driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml --mode T,F
```

```text
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml --mode T,F
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode T, teacher-forced: 9 of 861 blocks in the radius (9 direct, 0 forward), 852 out. 9 of 195 cells.
  A block runs alone in this mode: a rerun of the radius sends 9 of 861 blocks, 99.0% saved.
Mode F, free-running: 22 of 861 blocks in the radius (9 direct, 13 forward), 839 out. 9 of 195 cells.
  A cell reruns whole: 55 of 861 blocks sent, 93.6% saved; 186 of 195 cells left to carry.
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
(exit 0)
```

In mode T nothing follows: only the 9 direct blocks are sent.

### The whole suite

A tool that no block names can reach any block:

```sh
driftbench radius examples/acme/gated/specs --change examples/acme/radius/new-tool.yaml # exit 1
```

```text
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/new-tool.yaml
Blast radius of acme-v1 to acme-v2 (manifest 049c26e53668): tool:loyalty.lookup.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
The radius is the whole suite: tool:loyalty.lookup: no block declares a dependency on it. Nothing can be carried.
(exit 1)
```

Hand-written specs with no `metadata.depends` are in every radius, even when the radius is not the whole suite:

```sh
driftbench radius examples/acme/specs --change examples/acme/radius/stage-recap.yaml
```

```text
$ driftbench radius examples/acme/specs --change examples/acme/radius/stage-recap.yaml
Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.
7 specs, 28 blocks.
Mode F, free-running: 28 of 28 blocks in the radius (28 direct, 0 forward), 0 out. 7 of 7 cells.
  A cell reruns whole: 28 of 28 blocks sent, 0.0% saved; 0 of 7 cells left to carry.
  28 blocks with unknown dependencies (a hand-written spec with no metadata.depends): in every radius.
In the radius, mode F:
  spec                           blocks in  from     why
  acme-new-customer-coverage     4 of 4     block 0  unknown-deps
  acme-number-porting            5 of 5     block 0  unknown-deps
  acme-off-topic-return          5 of 5     block 0  unknown-deps
  acme-order-loose-confirmation  4 of 4     block 0  unknown-deps
  acme-plan-upgrade              5 of 5     block 0  unknown-deps
  acme-tool-failure              3 of 3     block 0  unknown-deps
  acme-price-sheet               2 of 2     build    unknown-deps
(exit 0)
```

### radius auto on two prompt versions

The smallest run uses only repository files: the same policy file as both versions. No region changed, so nothing explains the new version and the manifest is the whole suite:

```sh
driftbench radius auto --prompt examples/acme/src/policy.ts examples/acme/src/policy.ts --map examples/acme/map/approved.yaml --from-version acme-v1 --to-version acme-v1b
```

```text
$ driftbench radius auto --prompt examples/acme/src/policy.ts examples/acme/src/policy.ts --map examples/acme/map/approved.yaml --from-version acme-v1 --to-version acme-v1b
from: acme-v1
to: acme-v1b
changes:
  - kind: prompt
    global: true
    note: "region none: no normalized change explains the version transition; whole
      suite"
(exit 0)
```

### radius auto from a real prompt edit

Make the new prompt: the offer price expression in the Acme policy changes.

```sh setup
mkdir -p out/authoring-blast-radius
node -e 'const fs=require("node:fs"); const t=fs.readFileSync("examples/acme/src/policy.ts","utf8"); fs.writeFileSync("out/authoring-blast-radius/policy-next.ts", t.replace("plan.monthly_usd}", "plan.monthly_usd + 1}"));'
diff examples/acme/src/policy.ts out/authoring-blast-radius/policy-next.ts # exit 1
```

```text
$ diff examples/acme/src/policy.ts out/authoring-blast-radius/policy-next.ts
635c635
<   const price = `for $${plan.monthly_usd} a month`;
---
>   const price = `for $${plan.monthly_usd + 1} a month`;
```

Write a focused map that declares only the approved offer anchor (copied from `examples/acme/map/approved.yaml`, with the source path made relative to the new map's folder):

```yaml file=out/authoring-blast-radius/price-quotes.yaml
version: 1
agent: acme
produced_by: { family: code, model: by hand, at: 2026-10-14T00:00:00.000Z }
sources:
  - { kind: prompt, path: ../../examples/acme/src/policy.ts }
dimensions: []
constraints: []
phrases: []
relations:
  - kind: states
    subject: { dimension: flow, value: new-home }
    stage: address
    to: offer
    when: { coverage_result: [ fiber ] }
    must: [ "Acme Fiber 300, 300 Mbps for \\$40 a month" ]
    evidence:
      source: ../../examples/acme/src/policy.ts
      quote: const price = `for $${plan.monthly_usd} a month`;
    produced_by: model
    approved: true
```

Derive the manifest. Without `--source`, the source is the old prompt path relative to the map, which here equals the declared path:

```sh
driftbench radius auto --prompt examples/acme/src/policy.ts out/authoring-blast-radius/policy-next.ts --map out/authoring-blast-radius/price-quotes.yaml --from-version acme-v1 --to-version acme-v2
```

```text
$ driftbench radius auto --prompt examples/acme/src/policy.ts out/authoring-blast-radius/policy-next.ts --map out/authoring-blast-radius/price-quotes.yaml --from-version acme-v1 --to-version acme-v2
from: acme-v1
to: acme-v2
changes:
  - kind: rule
    id: states@offer
    note: 'region old:23857-23857 new:23857-23861: anchor relations[0]
      (../../examples/acme/src/policy.ts; old:23819-23868, new:23819-23872):
      "const price = `for $${plan.monthly_usd} a month`;"; covered on both
      sides'
(exit 0)
```

Write it to a file and compute its radius in mode T with the anchor trace:

```sh
driftbench radius auto --prompt examples/acme/src/policy.ts out/authoring-blast-radius/policy-next.ts --map out/authoring-blast-radius/price-quotes.yaml --from-version acme-v1 --to-version acme-v2 --out out/authoring-blast-radius/price-change.yaml
driftbench radius examples/acme/gated/specs --change out/authoring-blast-radius/price-change.yaml --mode T --explain
```

```text
$ driftbench radius auto --prompt examples/acme/src/policy.ts out/authoring-blast-radius/policy-next.ts --map out/authoring-blast-radius/price-quotes.yaml --from-version acme-v1 --to-version acme-v2 --out out/authoring-blast-radius/price-change.yaml
(exit 0)
$ driftbench radius examples/acme/gated/specs --change out/authoring-blast-radius/price-change.yaml --mode T --explain
Blast radius of acme-v1 to acme-v2 (manifest 0275092a4236): rule:states@offer.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode T, teacher-forced: 141 of 861 blocks in the radius (141 direct, 0 forward), 720 out. 125 of 195 cells.
  A block runs alone in this mode: a rerun of the radius sends 141 of 861 blocks, 83.6% saved.
In the radius, mode T:
  spec                   blocks in  from                     why
  gen-boundary-063       1 of 5     b2-identify-to-offer     rule:states@offer
(122 more lines)
rule:states@offer: region old:23857-23857 new:23857-23861: anchor relations[0] (../../examples/acme/src/policy.ts; old:23819-23868, new:23819-23872): "const price = `for $${plan.monthly_usd} a month`;"; covered on both sides
gen-boundary-063/b1-needs-to-identify: {"T":"out"}: outside declared changes
gen-boundary-063/b2-identify-to-offer: {"T":"direct"}: rule:states@offer
gen-boundary-063/b3-offer-to-recap: {"T":"out"}: outside declared changes
gen-boundary-063/b4-recap-to-order_placed: {"T":"out"}: outside declared changes
(864 more lines)
gen-twise-131/b6-order_placed-to-closing: {"T":"out"}: outside declared changes
(exit 0)
```

With the full Acme map the same edit is the whole suite, because the full map quotes that line more than once:

```sh
driftbench radius auto --prompt examples/acme/src/policy.ts out/authoring-blast-radius/policy-next.ts --map examples/acme/map/approved.yaml --from-version acme-v1 --to-version acme-v2
```

```text
$ driftbench radius auto --prompt examples/acme/src/policy.ts out/authoring-blast-radius/policy-next.ts --map examples/acme/map/approved.yaml --from-version acme-v1 --to-version acme-v2
from: acme-v1
to: acme-v2
changes:
  - kind: prompt
    global: true
    note: "region old:23857-23857 new:23857-23861: ambiguous quote in old text:
      dimensions[34].values[4]; whole suite"
(exit 0)
```

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `radius needs spec paths and --change <manifest>.` (exit 2) | no `--change`, or no spec path | pass both |
| `--mode takes T, F or P, separated by commas, not "F,X".` (exit 2) | a mode other than T, F, P | use only `T`, `F`, `P` |
| `The change manifest is invalid, so no radius was computed.` after `✗ <file>` and one line per issue (exit 2) | the manifest breaks the schema | fix each listed key, see below |
| `driftbench: cannot use <path>: ENOENT: no such file or directory, open '<path>'` (exit 2) | the manifest or prompt file does not exist | fix the path; paths are relative to the current folder |
| `No spec files found.` (exit 2) | the paths hold no spec file | point at spec files or folders |
| `Fix the invalid specs first: nothing ran.` after `✗ <file>` lines (exit 2) | a path holds an invalid spec (for example you passed the manifest as a spec path) | pass the manifest with `--change`, fix or remove the invalid spec |
| `The radius is the whole suite: ...` (exit 1) | a change is unmappable or no block declares it | read the reason; name an `id`, a tool `part`, or add `metadata.depends` |
| `--prompt takes exactly two files: old then new.` (exit 2) | `radius auto` got one or three prompt files | pass old then new |
| `error: required option '--prompt <files...>' not specified` (exit 2) | `radius auto` without `--prompt` (same for `--map`) | add the option |
| `The map has no source src/policy.ts; pass --source with its declared path.` (exit 2) | the default or given source is not a `sources[].path` of the map | pass `--source` with the exact path the map lists |
| `ZodError: [ ... ]` with a stack trace (exit 1) | the `--map` file is not a valid map proposal | pass an approved map file; validate it with the extract tools |

Manifest schema errors, as `radius` prints them (`from` only, a bad `part`, an unknown key):

```
$ driftbench radius examples/acme/gated/specs --change out/authoring-blast-radius/bad-manifest.yaml
✗ out/authoring-blast-radius/bad-manifest.yaml
    to: Invalid input: expected string, received undefined
    changes.0.part: Invalid option: expected one of "input"|"result"|"description"|"presence"
    changes.0: Unrecognized key: "owner"
The change manifest is invalid, so no radius was computed.
(exit 2)
```

A YAML syntax error prints the parser message instead:

```
$ driftbench radius examples/acme/gated/specs --change out/authoring-blast-radius/broken.yaml
✗ out/authoring-blast-radius/broken.yaml
    Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 1:

to: [acme-v2

^

The change manifest is invalid, so no radius was computed.
(exit 2)
```

Whole-suite reasons you can meet, each with exit 1:

| Reason | Change that causes it |
|---|---|
| `the kind <kind> is not one the radius can map` | an unknown `kind` |
| `a model or setting change can affect every block` | `kind: model` |
| `the whole agent changed` | `kind: agent` |
| `the change is declared global` | `global: true`, including a whole-suite manifest from `radius auto` |
| `the reply language rule holds on every block` | `rule` `reply_language` |
| `a stage change names no stage`, `a tool change names no tool`, `a rule change names no rule`, `a deviation change names no class`, `a prompt change names no atom`, `a fixture change names no fixture`, `a criterion change names no criterion` | a change of that kind with no `id` |
| `a map change is written dimension=value` | a `map` change with no `id`, or an id without `=` (or starting with `=`) |
| `a recovery rule is written recovery:<class>`, `a uses_tool rule is written uses_tool:<tool>`, `a path rule is written path:<id>` | a rule id with nothing after the colon |
| `no block declares a dependency on it` | a change no block or perturbation names (not for `criterion`) |
| `the manifest lists no change between two different versions` | `changes: []` with `from` different from `to` |
