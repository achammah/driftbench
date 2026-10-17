# Block contracts

This page defines the interfaces of the block redesign that the blocks validator tests and that no other reference defines yet.
Each section names the pull request that builds it, or says it is not built yet.
A section is removed once the owning reference defines its contract.
Names in code font are exact. Refs are git refs of the driftbench repository.

## Objects

Built by: PR 443 (`origin/feat/block-f1-objects`) for the loader, the hash, the layers and the item moves.
PR 449 (`origin/feat/block-f2-stamps`) builds `Verdict.by`. Neither is on `origin/main`.

### Content hash

* The hash is the first 12 hex characters of the SHA-256 of the canonical JSON of the resolved object.
* The hashed content is the kind, the object `params`, the kind fields and the items in their resolved order.
* An object is named `kind:id@hash8`, where `hash8` is the first 8 hex characters of the hash.
* The id, the `version` label, the `description`, the `extends` link, the layer and the file place do not enter the hash.
* Two objects of one kind with the same items and values have the same hash, whatever their ids.
* A change to any item field, to an object `params` value or to the item order moves the hash.

### Layer precedence

* Layers run from weakest to strongest: `shipped`, `project`, `suite`, `spec`, `block`, `cli`.
* A `uses` reference at a stronger layer replaces the reference at a weaker layer. A block that says `blame: acme` uses `acme`, not `default`.
* A `uses` key is read from these sources, strongest first: `--use <kind>/<id>`, the block, the spec, the suite `uses.yaml`, the project `uses.yaml`.
* A suite folder nearer to the spec file wins over a farther one.
* A key that no layer sets resolves to the shipped object `default` of its kind, when the kind has one.

| Layer | Where it is written |
|---|---|
| `shipped` | inside the packages, immutable |
| `project` | `driftbench/<kind>/<id>.yaml` and `driftbench/uses.yaml` |
| `suite` | `_driftbench/` inside a spec folder |
| `spec` | `uses:` at the top of the spec |
| `block` | `uses:` on the block |
| `cli` | `--use <kind>/<id>` and `--set` |

### Unknown parent

* An object that `extends` an id no layer defines is refused at load with the code `OBJECT_UNKNOWN`.
* A `uses` key that names an id no layer defines is refused with the same code.
* The message names the place of the reference, the kind, the id, the layers searched and the known ids of the kind.
* The place is a spec path such as `blocks.1.uses.blame`.

### Items

* An enabled item names an implementation, `builtin:<name>` or `plugin:<name>`, that driftbench or a plugin provides. An enabled item with no such implementation is refused with the code `OBJECT_IMPL_UNKNOWN`.
* A disabled item needs no implementation. The resolver does not look it up, so a disabled item may name an implementation that does not exist.
* A stronger layer may enable a disabled item again. The item is checked then.
* An item whose params do not fit its implementation is refused with the code `OBJECT_PARAMS_INVALID`. The message names the path.

* The checks of a block run in the order of its check set, and the block's verdicts keep that order. An `order` or a move changes it.
* A disabled item gives no verdict on the blocks its object reaches.

### Item moves

* A patch moves one item with `before: <id>` or `after: <id>`. The rest of the order stays as the parent had it.
* An item that sets both `before` and `after` is refused with the code `OBJECT_ORDER_INVALID`.
* A file that sets `order` and also moves an item is refused with the code `OBJECT_ORDER_INVALID`.
* A move to an anchor the parent does not hold is refused with the code `OBJECT_ITEM_UNKNOWN`.
* An `order` lists every enabled item once, or it is refused with the code `OBJECT_ORDER_INVALID`.

### Command line layer

* `--use <kind>/<id>` picks the object of one kind. A kind named twice is refused with the code `OBJECT_INVALID`.
* `--set <kind>[/<id>]#<item>.<param>=<value>` sets one param of one item. The value is read as YAML.
* A flag with no known kind, or with no `#<item>.<param>=<value>`, is refused with the code `OBJECT_INVALID`.
* The `--set` preflight resolves the object before any run. A `--set` that names an object no layer defines is refused with the code `OBJECT_UNKNOWN`.
* A `--set` whose path starts with no item of the object is refused with the code `OBJECT_ITEM_UNKNOWN`. The message lists the items of the object.
* The `driftbench object` commands exit 2 on bad input, such as an unknown kind or object.

### Uses and the hashes

* `uses` on the spec and on a block is part of the spec hash. A change to `uses` gives another spec hash, another cell id and another run id.
* The block cache key leaves `uses` out, on the spec and on every block. The objects `uses` names only score the run.
* A change to `uses` re-scores the stored observations. It never reruns the agent of a block the cache holds.
* A code block run in a sandbox is not replayed from the cache, so a change to its `uses` runs it again. This holds on B4 merged with PR 446.
* A spec with no `uses` key hashes as it did before.

### Verdict.by

* Every verdict carries `by: { object, item, impl, layer }`.
* `object` is `kind:id@hash8`. `item` is the rule inside it. `impl` is the implementation that ran. `layer` is the layer that last set the item.
* An inline object written in `uses` at the spec layer is named `kind:(spec)@hash8`. At the block layer it is named `kind:(block)@hash8`.
* A verdict of an item that a spec `uses` object changes names `layer: spec` and the tailored object. The same holds for `layer: block`.
* The rule holds for the checks of a code block, such as `artifacts`, as it does for a normal block.
* An item that the tailored object disables gives no verdict.
* A block the tailoring does not reach keeps the shipped stamp: the object `check-set:default@hash8` and `layer: shipped`.
* A tool input decided by the value policy names the policy object, the deciding rung as `item`, and the layer that defines the policy object.

Source: `config_framework.md`.
Source for the command line layer and for the cache key: `docs/reference/cli.md` ("`driftbench object`") and `packages/core/src/runner/cache.ts` (`cacheSpecHash`) on `origin/feat/block-f3-object-commands`.
Headings: "2.1 Objects: the one model", "2.2 Items: every rule is addressable", "2.3 Layers and precedence".
Headings: "2.5 The reference graph, checked at load", "2.11 Traceability: every verdict names what produced it".
Names from code, on `origin/feat/block-f1-objects`: `packages/core/src/objects/resolve.ts` (`hash`, `ref`, `(spec)`, `(block)`), `rules.ts` (`OBJECT_ORDER_INVALID`, `OBJECT_ITEM_UNKNOWN`) and `layers.ts` (the read order).
Names from code, on other refs: `packages/core/src/objects/scoring.ts` of `origin/feat/block-f2-stamps`, and `packages/checks/src/checks/tools.ts` of `origin/feat/block-b4-report` (the value stamp).

## Value ladder

Built by: PR 459 (`origin/feat/block-v1-value-ladder`). Not on `origin/main`.
The command line runs the ladder with no tool replayer and no judge. Code that builds the tools check passes them.

### Steps

| Step | Id | Applies when | Decides |
|---|---|---|---|
| 0 | `identity` | always, before any item | equal passes; a non string difference fails |
| 1 | `rung4_exact` | `compare: { exact: <reason> }` | passes only the exact value; nothing else runs |
| 2 | `rung1_outcome` | a replayer declares the tool and resolves the field | pass or fail by the tool result |
| 3 | `rung1_recompute` | the value is a computed value | see Value checks for code |
| 4 | `rung1_state_diff` | the value is a workspace diff | see Value checks for code |
| 5 | `rung2_contract` | the tool is not replayable and the field states a format | fails only |
| 6 | `rung2b_as_given` | the tool is not replayable and a source holds the value | fails only |
| 7 | `rung3_same_referent` | the tool is not replayable, no format is stated, a calibrated judge exists | pass, fail or inconclusive |
| 8 | `exact_fallback` | no item settled the value | the differing value fails |

* The items run in the order of the `policy/value-check` object. The first item that settles the value decides it.
* The ladder turns a fail into a pass only when an item decides that the two values are the same.
* `compare` takes `auto` (the default), `outcome`, `contract`, `as_given`, `same_referent` or `{ exact: <reason> }`.
* A named `compare` mode runs only the item that implements it, whatever its `when`.

### Exact by declaration

* The item is `rung4_exact`. It runs only for `compare: { exact: <reason> }`.
* The value passes only when it equals the expected value as a JSON value. No other item runs.
* The reason is part of the evidence. It reads `exactly <expected> (<reason>)` on a pass.
* On a fail the evidence reads `<value> is not exactly <expected> (<reason>)`.
* An exact compare is a decision someone made. It is never the default.

### Identity

* A value equal to the expected value passes at `identity`, before any rung.
* A number, boolean, list, `null` or absent value that differs from the expected one fails at `identity`. It has one writing.
* The rule applies when the agent value or the expected value is not a string.
* A computed value and a workspace diff skip `identity`. Only their own rung decides them.

### Outcome rung

* The rung replays the agent call twice on the block world (`given.world.store`). One call holds the agent value. The other holds the expected value.
* It compares the output fields that the tool declares as its resolved result.
* The same result passes. A different result fails. A tool that refuses the agent value and accepts the expected value fails it.
* The rung decides nothing, and the value goes to the next item, in four cases.
* The tool is not declared to the replayer.
* The declaration lists the input fields the tool resolves, and this field is not one of them. The tool only stores the field.
* The tool refuses the call with the expected value.
* The policy sets `distractors_required`, both values resolve the same, and the declaration states no distractor.
* When the tool is declared and resolves the field, the contract, as given and judge items do not apply. A skipped outcome rung then reaches `exact_fallback`.
* When the tool is not declared or does not resolve the field, those items run next. A value they do not settle reaches `exact_fallback`.

### Contract rung

* The rung fails a value that breaks the `pattern`, the `enum` or the `const` that `metadata.tool_schemas` states for the field.
* Two different members of an enum fail.
* The evidence names the item `rung2_contract` and the keyword that the value breaks.
* The rung passes nothing. A value inside the stated format goes on to the next item, and then to `exact_fallback`.

### As given rung

* The expected writing appears as a whole token in a source, and the agent wrote something else: the rung fails the value.
* The sources are the user messages of the block and of earlier blocks, and the workspace files the agent read.
* A token is whole when the characters around it are not letters or digits. With `ignore: [surrounding_space]` the value is trimmed first.
* The evidence reads `the agent was given "<expected>" and wrote "<value>": it changed the value`.
* The agent value appears in a source and the expected writing does not: the agent copied what it was given. The rung decides nothing.
* The rung never passes a copy. A copy proves where the value came from, not that it is right. It goes to the next item, then to `exact_fallback`.
* The user gave the agent value first and the expected value in a later message. The agent kept the earlier one. The rung fails the value as `stale`.

### Exact fallback

* A value that no item settles is compared exactly. The differing value fails.
* The evidence reads `exact_fallback: no decider configured for <tool>.<field>; compared exactly: <value> is not <expected>`. It lists the reason of each item that ran.
* A lint verdict `tools.<label>.input.<field>.no_decider` accompanies it. It has outcome `fail` and it does not gate.
* The lint text names what would settle the value: a replayer (`rung1_outcome`), a pattern or enum in `metadata.tool_schemas` (`rung2_contract`), or a calibrated judge (`rung3_same_referent`).

### Other assertion forms

* A bare value, `{ exact: <value> }` and each leaf of `{ subset: {...} }` go through the ladder.
* The forms `regex`, `contains`, `one_of`, `nonempty` and `absent` compare as written. They have no ladder and no lint.

Source: `value_equivalence.md`, heading "3. Recommendation for driftbench: a ladder with no rule per value type"; `codeagent_equivalence_blame.md`, heading "G2. `policy/value-check:default`: items added for code".
Names from code, on `origin/feat/block-v1-value-ladder`: `packages/checks/src/value-check/ladder.ts` (`identity`, `rung4_exact`, `rung1_outcome`, `rung2_contract`, `rung2b_as_given`, `rung3_same_referent`, `exact_fallback`, `no_decider`), `outcome.ts`, `contract.ts` and `as-given.ts`.
Names from code, on `origin/feat/block-b4-report`: `packages/cli/help/judging-check-tools.md` (the assertion forms and the lint id).

## Value checks for code

Built by: PR 459 (`origin/feat/block-v1-value-ladder`) builds the two items as library code.
On `origin/feat/block-b4-report`, no check builds a recompute case or a state diff case from a spec field. Those spec fields are not built yet.

### Recompute

* The item is `rung1_recompute`. It applies to a computed value, such as a spreadsheet formula or a script.
* The rung runs the produced computation and the expected computation on the given inputs.
* It then runs both on `trials` changed input sets. The default is 3.
* The changed inputs are drawn with a fixed `seed` (default 1). Each draw uses the declared range, or 0.5 to 1.5 times the seed value.
* An integer input stays an integer. A draw equal to the seed value is moved.
* The rung fails on the first input set where the two results differ.
* When the given inputs agree and a changed set differs, the rung emits `changed_inputs_fail: true`.
* A hard coded result equal to today's value passes the given inputs and fails the changed inputs.
* A reordered formula that computes the same value passes.
* Numbers compare at `numbers_significant_digits` of the object. The default is 12.

### State diff

* The item is `rung1_state_diff`. It applies when the value is a workspace diff.
* The diff has three sets: `created`, `changed` and `deleted`. It is the net diff: a file created then deleted is no change.
* The rung passes when every expected path is in the same set of the observed diff.
* It also needs that no observed path lies outside the expected paths and the allowed globs.
* A path expected as `changed` and observed as `created` is missing and extra, so the rung fails.
* An extra file fails the rung, even when every expected change is present.
* A missing file fails the rung.
* The allowed globs use `*` within one folder, `**` across folders and `?` for one character.
* Paths compare with forward slashes and no leading `./`.
* With no allowed glob, the diff must equal the expected changes.

Source: `codeagent_equivalence_blame.md`, heading "G2. `policy/value-check:default`: items added for code".
Names from code: `origin/feat/block-v1-value-ladder` in `packages/checks/src/value-check/recompute.ts` and `state-diff.ts`; `packages/core/src/spec/glob.ts` for the glob.

## Attribution

Built by: `attributionOf` in PR 454 (`origin/feat/block-b4-report`, `packages/report/src/attribution.ts`).
The blame reading of value facts is not built yet. The shipped `value-mismatch` diagnostic on that ref stops at the lint `value_ladder_unavailable`.

### attributionOf

* `attributionOf(data, options)` returns `undefined` when no block carries a diagnosis and no fix plan is given. The scorecard then shows the machine rate alone.
* The machine rate is the share of scored runs that pass their machine checks. Scored runs are the completed runs that passed or failed.
* The machine rate counts unassigned runs.
* The agent rate is the share of assigned runs that pass for the agent.
* A run passes for the agent when every failing gating verdict has a diagnosis with disposition `setup`, `excluded` or `credited`.
* A run fails for the agent when any failing gating verdict has disposition `agent` or `shared`.
* A run is unassigned when a failing gating verdict has no diagnosis or has disposition `unassigned`, and no failure of the run is the agent's.
* A run with no block failure is also unassigned when its end state does not match.
* It is also unassigned when its end verdict is not `success` or it has no blocks.
* An unassigned run is left out of the agent rate, numerator and denominator. It is counted in `unassigned`.
* The agent rate is written with its denominator: `<k> of <n> assigned runs; <u> unassigned`.
* The estimate and the interval are omitted when unassigned runs outnumber assigned failed runs.
* A completed run that has a block not run or blocked, and no failure, is in neither rate.
* Such runs are counted in `unmeasuredRuns` as `{ notRun, blocked }`. Blocks are counted apart in `blocks.notRun` and `blocks.blocked`.

### Fix plan and badge

* `fixes` holds the campaign fix plan in the order it was given. `attributionOf` does not reorder it.
* The fix plan is ranked by the `fix-plan` diagnostic: agent blocks first, then blocks, then cost class.
* `nonDefault` lists every object a block was scored with whose id is not `default`.
* An object appears once, even when many blocks resolved it. The list is sorted.
* Each entry is written `kind:id@hash8`: `hash8` is the first 8 hex characters of the hash recorded in `BlockResult.resolved`, as in `Verdict.by` (`config_framework.md` names an object `kind/id@<hash8>`). On `origin/feat/block-b4-report`, `attributionOf` prints the recorded hash whole, 12 hex characters.
* The objects are read from `BlockResult.resolved.objects` of every block of every run. The `objects` option adds the objects the campaign was scored with, for records that do not carry them.
* A fix keeps its own fields. Its `fixAction` is free text.
* The text scorecard prints `Non-default rules: <list>.` The HTML scorecard prints a `non-default` badge.

### Blame and value facts

* Blame reads the facts of each failing tool input value from the run record. It replays no tool and calls no model.
* A value fact holds the tool, the field, the path and the call. It also holds the agent value, the expected value, the rung family and what the rung settled.
* The rung family is `rung1`, `rung2`, `rung2b`, `rung3` or `rung4`.
* Blame also reads the tool schemas of `metadata.tool_schemas` and the user text.
* From these it computes the names `source`, `change` and `contract`.
* The step that evaluates the value check writes the value facts, `source` and `change` included, into the verdict record of the tool input. Blame reads them there (default, owner may change). On `origin/feat/block-b4-report`, `valueFacts` sets no `source` and no `change` yet.
* `source` is `user`, `agent_derived`, `prompt`, `tool_output`, `skill_file` or `workspace_file`.
* `change` is `verbatim`, `case_only`, `unit_converted`, `reformatted` or `altered`.
* `contract` is `tool`, `prompt`, `instruction`, `skill`, `error_seen`, `downstream` or `none`.
* The blame items run in the order of the object, and the first match writes the diagnosis.

| Rule | Fires when | Fault |
|---|---|---|
| `R3` | the tool failed, `contract` is `none`, `source` is `user` or `workspace_file`, `change` is `verbatim` | the tool definition |
| `R2` | `source` is `user` or `workspace_file`, `change` is an altered kind, the outcome is `failed` or `resolved_differently` | the agent |
| `R1` | `contract` is stated and the value breaks it | the agent |
| `R2b` | `source` is `agent_derived` and the outcome is `failed` or `resolved_differently` | the agent |

* The order is `R3`, `R2`, `R1`, `R2b`. `R2` comes before `R1`, so an altered value stays the agent's whatever the contract says.
* An altered kind is `unit_converted`, `reformatted` or `altered`.
* `R3` sets the disposition by the next action. Asked the user, retried canonically or recovered: `setup`. Continued, wrong fact, gave up or looped: `shared`.

Source: `Driftbench block redesign build plan.md`, heading "4. Phase B: blame, placement, diagnostics (effort L, 4 PRs)", unit B4.
Source: `codeagent_equivalence_blame.md`, headings "E5. Two scores", "E2. On each campaign: `diagnostic/fix-plan`", "D1. The names", "G3. `policy/blame:default` in full".
Source: `value_equivalence.md`, heading "(4) The rewritten decision table".
Names from code, on `origin/feat/block-b4-report`: `packages/report/src/attribution.ts` (`attributionOf`, `unassigned`, `unmeasuredRuns`, `nonDefault`).
Names from code, on the same ref: `packages/checks/src/blame/values.ts` (`valueFacts`), `packages/core/src/evidence/types.ts` (`ValueFact`), `packages/checks/objects/diagnostic/fix-plan.yaml`.

## Section registry and localize

Built by: Phase 6a to 6c, already on `origin/main`.
The CLI reference ("Section registry commands") and the blast radius page ("Prompt sections and block links") state the same rules for the shipped commands.
The merge commit of `origin/feat/block-phase-6-links` names PRs 423, 429, 433 and 481.

### metadata.links

* `spec validate` checks `metadata.links`. A value outside the lists below is refused with a path under `metadata.links`.
* A link holds `to`, `status`, and optionally `block`, `relation`, `created_by`, `at_version` and `evidence`.
* `to.kind` is `prompt_section`, `spec_clause` or `source_turn`.
* `relation` is `verifies`, `exercises`, `derived_from` or `observed_in`. The default is `verifies`.
* `status` is `declared`, `attributed`, `verified`, `refuted` or `stale`. It is required.
* `created_by` is `generator`, `author`, `attribution`, `citation`, `ir` or `mutation`.
* These lists are the ones of the design note `deep_3_links_localisation.md`, and the ones `spec validate` enforces (default, owner may change). The note `Driftbench block redesign.md` lists fewer: the relations `verifies`, `derived_from` and `observed_in`, and the creators `generator`, `attribution` and `verified`.
* `block` is a block id or a block index. An absent `block` means every block.
* A `block` that names no block of the spec is an error with the code `LINK_BLOCK_UNKNOWN` at `metadata.links.<i>.block`.
* Links stay out of the spec hash.
* Only a `verified` link supports the claim that a target is tested.

### Registry commands

* `radius sections init <prompt> --id <prompt-id> --prompt-version <version> [--level <n>] [--out <file>]` writes a first registry.
* The registry holds one section per heading of level 1 to `--level`. The default level is 2.
* `--level` is a whole number from 1 to 6. Any other value exits 2.
* A section runs from its heading to the next heading of that range.
* The text before the first heading is the section `preamble`, when it is not blank.
* A section id is the slugged title: lower case, accents removed, each run of other characters written as `_`.
* A repeated slug takes the suffix `_2`, `_3`, and so on.
* Every section starts with `scope: global`.
* `init` exits 2 when the prompt cannot be read or the prompt has no section.
* `init` also exits 2 when a section holds no quote that is unique in the prompt.
* `radius sections check <registry> --prompt <file>` exits 0 when the registry describes the prompt, and 1 when it does not.
* `check` exits 2 for an invalid registry: a schema violation, an id used twice, or a reference to an unknown section.
* `check` also exits 2 when the registry file or the prompt file cannot be read.
* The references are the `references`, `overrides` and `duplicates` lists of a section.

### Headings and ids

Not built on `origin/main` yet: the shipped `init` departs from these rules (the blocks validator, family `hostile`, measures each one).

* A heading is a CommonMark heading.
* An ATX heading is a line of 1 to 6 `#`, indented by at most three spaces. Four spaces make it code.
* The closing `#` sequence of an ATX heading is not part of its title.
* A setext heading is a line of text over a line of `=` (level 1) or `-` (level 2).
* A line inside a fenced code block is code. It never starts a section.
* Every section id is unique. A repeat suffix such as `_2` never takes the slug of another heading: the next free suffix is used.
* `init` finds a unique anchor quote in time linear in the section. A body that repeats one line costs no more than other text of its length.

Source: `docs/concepts/blast-radius.md`, "Prompt sections and block links" (one section per heading, slug ids with repeat suffixes); the CommonMark specification, sections 4.2 (ATX headings), 4.3 (setext headings) and 4.5 (fenced code blocks).

### Reanchor

* `radius sections reanchor <registry> --prompt <old> <new> --to-version <version>` finds every section again in the new prompt.
* `--prompt` takes exactly two files, old then new. Any other count exits 2.
* The command exits 2 when the `text_sha256` of the registry differs from the SHA-256 of the old prompt text.
* The message reads `the registry does not describe the old prompt text (text_sha256 differs)`.
* A section is found by `same_hash` first: its old text occurs once in the new text. Then by `quote`, then by `window`. Else it is `stale`.
* The spans are compared in the new text.
* A section is `kept` when found at the same start offset, and `moved` when found at another offset.
* A section is `stale` when it is not found again.
* An edit that keeps the prompt length and changes one section leaves that section `stale`. Every other section stays `kept` at its span.
* The command exits 1 when a section is stale, when text changed outside every section, or when sections changed order. Otherwise it exits 0.

### Localize

* `radius localize` ranks the local sections of a prompt by Ochiai suspiciousness over the block verdicts of a stored campaign.
* A block covers a section when it holds a link to that section whose status is `declared`, `attributed` or `verified` (`deep_3_links_localisation.md`, "C1").
* A `refuted` or `stale` link adds nothing to `n_cf`, `n_cs` or the linked count of its section. A `stale` link is reported as advisory (default, owner may change).
* On `origin/main`, the code leaves out only `refuted` links, so a `stale` link still counts there.
* The score is `n_cf / sqrt(N_F * (n_cf + n_cs))`. It is 0 when `n_cf` or `N_F` is 0.
* A block weighs `failed rows / rows`. `n_cf` sums the weights of the blocks linked to the section. `n_cs` sums one minus the weight. `N_F` sums every weight.
* Global sections and stale sections are not ranked.
* The command exits 0 with a ranking, 1 when nothing failed outside inherited failures, and 2 on bad input.

Source: `deep_3_links_localisation.md`, headings "(b) Proposed link schema (YAML)" and "C1. The spectrum for prompts"; `links_real_scale.md`, heading "Recommended anchoring".
Names from code, on `origin/main`: `packages/core/src/schema/links.ts`, `packages/core/src/radius/sections.ts` (`sectionsFromHeadings`, `reanchorRegistry`), `packages/core/src/radius/localize.ts`.
Names from code, on `origin/main`: `packages/core/src/spec/semantics.ts` (`LINK_BLOCK_UNKNOWN`), `packages/cli/src/commands/radius-sections.ts` and `radius-localize.ts` (flags and exit codes).

## Personas

Built by: not built yet. The key `simulated_user` is absent from the spec schema on `origin/main` and on `origin/feat/block-b4-report`.
The research pull requests are 418 and 444. The object kinds `persona` and `scenario` exist on `origin/feat/block-b4-report`.

* A cell is one block played by one persona. A block that lists k personas gives k cells.
* Each cell runs apart. Its seed is derived from the run seed, the block id, the persona id and the trial.
* Each cell keeps its own result. The same test played by another persona can fail another block.
* The failing block of one persona run is not copied into the run of another persona.
* A parent chain run on k personas is k separate trees. A failure in one tree does not reach another tree.
* A persona that fails a `requires` key of the block gives the cell `not_run` with the kind `persona_incompatible`. The cell is in no rate.
* The result grid has blocks as rows and personas as columns.
* The persona of a run is the run record's user persona id, the field `user.persona_id` (default, owner may change). No run record field holds it on the refs read.

Source: `simuser_model.md`.
Headings: "3.1 How a block names its personas", "3.3 Refusals: when a cell does not run", "3.4 Running the grid".
Headings: "3.5 Parent chains", "4.1 The result grid".
Source: `config_framework.md`, heading "2.5 The reference graph, checked at load".

## Workspace seeds

Built by: PR 562 (`origin/feat/block-parents`). Not on `origin/main`.

### workspace.binary

* `workspace.binary` maps a path to base64 content. It holds the files the workspace starts with that are not text, such as an xlsx.
* An entry that is not base64 is refused at load.
* The bytes reach the agent unchanged. A UTF-8 byte-order mark stays in the file.
* A path in both `files` and `binary` is refused with the code `WORKSPACE_PATH_TWICE`.
* A path in `files` or in `binary` is a path of the workspace. The path rules of the sandbox apply to it.
* The text of `files` is written as given, and a byte-order mark inside it stays (implied by: "Files the workspace starts with, byte for byte").
* A parent export writes UTF-8 text into `files` and every other file into `binary`.

Source: `docs/reference/spec.md` (field `binary` of the workspace), `docs/reference/cli.md` (issue code `WORKSPACE_PATH_TWICE`) and `docs/concepts/given-when-then.md` ("Parent blocks"), on `origin/feat/block-parents`.
Names from code, on the same ref: `packages/core/src/schema/common.ts` (`binary`, `z.base64()`) and `packages/core/src/spec/semantics.ts` (`WORKSPACE_PATH_TWICE`).

## Parent blocks

Built by: PR 562 (`origin/feat/block-parents`). Not on `origin/main`.
A rule marked "implied by" follows from the quoted sentence of `docs/concepts/given-when-then.md` ("Parent blocks") on that ref. The page states it so the validator can cite it.

### The forest

* A block sets `parent: <block id>` to start from that block's recorded end state in the same spec.
* `PARENT_MISSING` and `PARENT_CYCLE` are spec errors.
* The runner orders dependencies before children, including forward references.
* Once a spec declares a parent link, its blocks form a forest in every mode.
* Each root starts at the spec defaults. A child inherits only its ancestors.
* A spec without a parent link keeps the sequential F and P behaviour and the canonical T behaviour.
* The order is the forest order, whatever the written order and whatever the mode (implied by: "The runner orders dependencies before children, including forward references." and "its blocks form a forest in every mode").
* The parent rules hold on any forest: many roots, several failures, blocks not run, any written order (implied by: "Once a spec declares a parent link, its blocks form a forest in every mode").
* A passed parent runs once per run, however many children share it.

### What a child starts from

* A child's prefix includes the parent's actual reply and the parent's tool calls, with their recorded results and errors.
* A child's history holds each ancestor's user turn once, oldest first (implied by: "A child's prefix includes the parent's actual reply and tool calls" and "start from that block's recorded end state").
* A child's history holds its ancestors' replies, oldest first (implied by the same two sentences).
* A child's ledger includes the facts its parent established.
* World and variables are copied, so siblings cannot change each other's start.
* A world layer set on a block reaches its descendants and never a sibling's tree or another root (implied by: "World and variables are copied, so siblings cannot change each other's start." and "a child inherits only its ancestors").
* The child's own Given merges ledger, world and variables by key.
* A `given.prefix` on the child replaces the inherited conversation.
* A `world.workspace` on the child replaces the inherited workspace whole. None of the parent's files carry then, only the files the child names.

### The workspace of a child

* The process adapter reads every file the parent left, its protocol files aside, byte for byte.
* UTF-8 text goes into `world.workspace.files`. Every other file goes into `world.workspace.binary` as base64.
* The child's own sandbox is seeded from them, so siblings never share a folder.
* A child's checks read the workspace it inherited: a file its parent wrote is there to judge (implied by: "The child's own sandbox is seeded from them").
* A child's workspace diff starts from the workspace it inherited. Its ancestors' files are neither created nor changed by it (implied by: "The adapter that owns the workspace takes a snapshot of it before the step and a diff after." and "The child's own sandbox is seeded from them").
* What carries is the regular files, byte for byte, a UTF-8 byte-order mark included.
* `.git` and `node_modules` do not carry, because the snapshot skips them. Empty folders and file modes do not carry.
* A link that points inside the workspace arrives as a plain copy of its target. A link that leaves the workspace fails the export.
* An adapter with no `snapshotGiven` gives the children `not_run` with the kind `unsupported`.
* An export can fail, for example when the files pass the adapter's `exportMaxBytes` (50 MB in all by default).
* A failed export gives the children `not_run` with the kind `setup_failed`. Their descendants are `blocked`.
* A seeded child also needs the adapter's `seedPrefix` capability.

### Failure and blocking

* A parent that fails, is `not_run` or is already `blocked` makes its child `blocked`.
* A blocked child gets no agent call and adds no failure.
* `blocked.by` names the direct parent. `blocked.root` names the original failed or unrun cause.
* Independent roots continue.
* A failing block with no children blocks nothing: every other block keeps its own verdict (implied by: "If a parent fails, is `not_run`, or is already blocked, the child is `blocked`" and "Independent roots continue.").
* A run continues after a failed block (implied by: "Independent roots continue.").
* The report groups the blocked descendants under their root.
* A blast radius change that reaches a parent includes its descendants in every mode, even when they come earlier in the YAML.

### Replay and carry

* Child-only mode T selection replays the ancestors of the child when no in-run recording exists.
* A replayed ancestor gives its end state and its cost. It adds no block, no verdict and no count. `blockRerun.reason` names it.
* Partial carry reruns and re-judging request a full replay for a spec that has parent links.
* A run on an adapter with `snapshotGiven` bypasses the observation cache.

Source: `docs/concepts/given-when-then.md`, section "Parent blocks", on `origin/feat/block-parents`.

## Defaults

The design and the code left five points open. Each is now answered on this page, from a design note where one states it, else by a default the owner may change.

1. The badge hash is 8 hex characters (`config_framework.md`, "Identity"). See "Fix plan and badge".
2. The step that evaluates a value check writes the value facts, and blame reads them there (default). See "Blame and value facts".
3. The link relations and creators are the lists of `deep_3_links_localisation.md` (default). See "metadata.links".
4. A `stale` link is out of the Ochiai counts and reported as advisory (`deep_3_links_localisation.md`, "C1"; the advisory report is a default). See "Localize".
5. The persona of a run is the run record's user persona id (default). See "Personas".
