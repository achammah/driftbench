---
title: Extracting and approving the map
summary: '`extract` proposes the map of situations from an agent''s prompt or policy, its behaviour inventory and its tool schemas. Every entry quotes the text that justifies it. `extract approve` records a person''s approval. `extract map` writes the space map of the approved axes.'
commands:
  - extract
  - extract approve
  - extract map
see_also:
  - authoring-map
  - authoring-generate
  - authoring-inventory
  - authoring-space-coverage
  - authoring-deviation-classes
  - authoring-task-families
next:
  - authoring-generate
---

## What it is

The map is the list of situations an agent can face. `extract` writes a first version of it, called the proposal, for a person to approve. Nothing in a proposal counts until it is approved.

How `extract` builds the proposal:

1. A code pre-pass, with no model, reads the inventory and the tool schemas. It proposes the behaviour, flow, deviation and channel dimensions, and the channel constraints. It proposes one data dimension per tool argument or result field with its boundary values, and the recoveries the inventory fixes.
2. Unless `--no-model`, a model (or a recording, `--replay`) answers six sections on the prompt files: `stages`, `rules`, `personas`, `data`, `phrases`, `relations`. Each answer goes through the same parser and checks.
3. Every value, constraint and relation must quote its source word for word. Code checks each quote in its source; an entry whose quote is not found is refused.

Each dimension has a `role`. An `axis` enters the space map and is crossed with the other axes. A `detail` stays in the proposal, and `generate` varies it inside a cell as boundary values. Code proposes the roles: every tool-schema dimension is a detail, and the first dimension of each kind is an axis.

The approved proposal is what `generate`, `intake` and `pilot` read as "the approved map". The `space` commands do not read a proposal; `extract map` writes the space map they read (see authoring-map).

## When to use it

- You have an agent's prompt or policy, its inventory and its tool schemas, and want the full map of situations without writing it by hand.
- Before `generate`: it needs an approved proposal.
- After the prompt changes: extract again, then approve the new entries.

## Commands and every option

### driftbench extract

```
driftbench extract --prompt <file> [--prompt <file>]... --inventory <file> [--tools <file>] --out <file> [--no-model | --replay <file>] [--provider anthropic|openai] [--agent <name>] [--force]
```

| Option | Meaning | Default |
|---|---|---|
| `--prompt <file>` (required, repeatable) | The agent prompt or policy. Any text file. Repeat for several. | none |
| `--inventory <file>` (required) | The behaviour inventory (authoring-inventory). | none |
| `--tools <file>` | Tool schemas: a file of JSON Schemas by tool, or a spec whose `metadata.tool_schemas` lists them. Gives the data dimensions. | none |
| `--out <file>` (required) | Where to write the proposal, YAML. Missing folders are created. | none |
| `--no-model` | Run the code pre-pass only. No model call. Cannot be used with `--replay`. | off (the model sections run) |
| `--replay <file>` | Replay recorded answers instead of calling a model. Free. | none |
| `--provider <name>` | `anthropic` or `openai`. | the first whose key is set: `ANTHROPIC_API_KEY`, else `OPENAI_API_KEY` (which needs `OPENAI_MODEL`) |
| `--agent <name>` | The agent name, written as `agent`. | the name of the inventory's folder |
| `--force` | Replace an existing proposal; the approvals in it are lost. | off |

Without `--no-model` and without `--replay`, `extract` calls a model: a paid call per section.

| Exit code | When |
|---|---|
| 0 | the proposal is written and every section answered |
| 1 | the proposal is written, but a section failed or an entry was refused (both listed) |
| 2 | usage or input error, nothing written. Causes: a missing option, `--no-model` with `--replay`, an unreadable file, a bad recording, no model key, an existing output without `--force`, invalid inputs |

### driftbench extract approve

```
driftbench extract approve <proposal> [--dimension <id>]... [--all] [--to <file>]
```

| Option | Meaning | Default |
|---|---|---|
| `<proposal>` (required) | The proposal file. | none |
| `--dimension <id>` | Approve this dimension and the values that inherit its flag. Repeat it. | none |
| `--all` | Approve every entry: dimensions, values, constraints, phrases, relations, numeric settings. Cannot be used with `--dimension`. | off |
| `--to <file>` | Write the result to this file instead of over the proposal. It must sit in the proposal's folder, where its source paths resolve. | over the proposal |

With neither `--dimension` nor `--all`, it lists the open decisions and changes nothing.

A person can also approve in the file: set `approved: true` on an entry. A dimension has one flag, which its values inherit; a value may set its own flag to override it. Each constraint, phrase, relation and numeric setting has its own flag. Flipping `role` between `axis` and `detail` decides what enters the space map.

| Exit code | When |
|---|---|
| 0 | listed, or approved |
| 1 | the proposal is invalid (an entry without evidence, a quote not found, a broken reference), or `--dimension` names an unknown dimension |
| 2 | the file is not found, `--all` with `--dimension`, `--to` outside the proposal's folder |

### driftbench extract map

```
driftbench extract map <proposal> --to <file> [--all]
```

| Option | Meaning | Default |
|---|---|---|
| `<proposal>` (required) | The proposal, usually the approved one. | none |
| `--to <file>` (required) | Where to write the space map, YAML. | none |
| `--all` | Take every axis value, approved or not. | approved axes only |

The space map holds the approved axis dimensions, with `none` added where a spec may name no value. It also holds the constraints among them, including the pairs the relations rule out. Edit the proposal and write the map again, rather than editing the written map.

| Exit code | When |
|---|---|
| 0 | the space map is written |
| 1 | the proposal is invalid, or the space map would be (no approved axis, every cell forbidden) |
| 2 | the file is not found, `--to` is missing |

## Inputs

### The proposal file

Top level:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `version` | the number `1` | yes | The proposal format version. |
| `agent` | string | yes | The agent described. |
| `produced_by` | `{ family, model, at }` | yes | Who proposed the entries: `family` is `code` for the pre-pass alone; `at` is a UTC time. |
| `sources` | list of `{ kind, path }`, at least 1 | yes | The quoted files. `kind`: `prompt`, `inventory` or `tools`. `path`: relative to the proposal's folder. |
| `dimensions` | list | yes | See below. |
| `constraints` | list | yes | Impossible combinations. |
| `phrases` | list | yes | User wordings for values, the phrase bank `generate` draws from. |
| `numeric_settings` | list | no | Approved numeric ranges that `generate --budget` samples into `given.vars`. |
| `relations` | list | no | Paths, tool calls, recoveries and the rest, see below. |

A dimension: `id` (lowercase, `^[a-z][a-z0-9_.-]*$`), `title` and `kind` (`stage`, `behaviour`, `deviation`, `persona`, `channel`, `data`, `task`). A dimension also has `role` (`axis` or `detail`), `produced_by` (`code` or `model`), `approved` (boolean) and `values` (at least 1).

A value: `id`, `title`, `evidence: { source, quote }` (quote at most 1000 characters, copied word for word from the source) and `produced_by`. Optional: `approved` (overrides the dimension's flag), `weight` (0 to 1) and `required`. A rule also takes optional `polarity` (`must` or `must_not`), `when` and `unless` (the cell it applies in, as dimension to list of value ids). It also takes optional `limit` (most times per conversation), `within: { minutes }` and `priority: first`.

A constraint: `forbid` (dimension to value), `reason`, `evidence`, `produced_by`, `approved`.

A phrase: `dimension`, `value`, `text` and `lang` (such as `en` or `pt-BR`). The `text` is one user message, 1 to 500 characters; `{slot}` takes a value the cell binds. Optional: `when` (the cell values it fits), `binds` (slot values the phrase itself states) and `evidence`. A phrase also has `produced_by` and `approved`.

A numeric setting: `id` (the `given.vars` key), `min`, `max`, optional `integer`, optional `unit`, `evidence`, `produced_by`, `approved`.

Relations, each with `kind`, `evidence`, `produced_by` and `approved`:

| `kind` | What it says | Main fields |
|---|---|---|
| `path` | a flow's stage order on one branch | `id`, `flow`, `stages` (at least 2), optional `when`, `behaviours`, `end_state: { source: tool:<name>, mode, expect }` |
| `uses_tool` | a tool a flow or behaviour calls at a stage | `subject: { dimension, value }`, `tool`, `stage`, optional `to`, `when`, `count`, `input` (assertions; `{slot}` reads a bound value) |
| `states` | what the reply of one turn must or must not state | `subject`, `stage`, optional `to`, `when`, `must`, `must_not` |
| `binds` | the concrete values a data or persona value stands for | `subject`, `slots` (such as `{ email: jo.okafor@example.com }`) |
| `recovery` | how a flow recovers from a deviation class | `class`, `flows`, optional `at`, `tool` (for D8), `stage_after` (`pending` means the stage reached), `must`, `must_not`, `guards`, `tools` |
| `reply_language` | the language of every reply | `subject`, `lang` |
| `tool_order` | two tools called in a stated order | `before`, `after` |
| `route` | a rule that sends a topic to a team | `subject`, `to` |
| `reply_text` | a rule that fixes the exact words of a reply | `subject`, `text` |
| `task_family` | a flow a code agent does, built by a task family | `flow`, `family` (path relative to the proposal), `stages`, optional `holds`, `instances`, `deviations` (see authoring-task-families) |

`generate` derives every machine Then from the approved relations, never from an agent's reply.

### The recording file (`--replay`)

| Key | Type | Required | Meaning |
|---|---|---|---|
| `family` | string | yes | Recorded in `produced_by.family`. |
| `model` | string | yes | Recorded in `produced_by.model`. |
| `answers` | mapping of section to answer | yes | Sections: `stages`, `rules`, `personas`, `data`, `phrases`, `relations`. An answer is raw text, or a mapping written as YAML (sent as its JSON text), or a list of answers replayed one per call. |

Quotes in recorded answers name their source by its path relative to the proposal's folder. Replay into a folder at the same place relative to the sources, or every quote is refused.

## Outputs and how to read them

`extract` prints:

- `Wrote <file>: <d> dimensions, <v> values, <c> constraints, <p> phrases, <r> relations, none approved.`
- `Code pre-pass: ...`: what code alone proposed.
- `Roles: <n> axes (<ids>), <m> details; the axes make a full grid of <cells> cells.` The space commands accept up to 250000.
- `Model <family> <model>: <s> sections, <c> calls.` then one line per section: `added <n> entries` or `failed: <why>`. With `--no-model`: `No model call: the code pre-pass alone (--no-model).`
- `Refused, not in the proposal:` one line per refused entry with the reason (a quote not found, a source not listed).
- `Notes:` tool fields whose schema states no partition, so no boundary values were made for them.
- `Next:` the approve command to run.

`extract approve` with no option prints `<file>: <open> of <total> decisions are open (...)`, then the axes and grid line. Each open decision gets one line (`dimension`, `constraint`, `phrase`, `relation`, `numeric`) with its label, its role and origin, and the quote under it. After approving, it prints one of two lines (`Approved <n> flags in <file>; <k> were already set.` or `Approved <n> dimensions in <file>: <ids>.`). When nothing is open: `all <n> decisions are made.`

`extract map` prints `Wrote <file>: <n> axes (<ids>), <c> constraints, a full grid of <cells> cells.`

## Worked example

Code pre-pass only (no model call), on the Acme policy, inventory and tool schemas. Then list the open decisions, approve the three axis dimensions into a copy beside the proposal, and write the space map of what is approved. Last, the approved Acme proposal of the repository: every decision is made, and its space map is written:

```sh
driftbench extract --prompt examples/acme/src/policy.ts --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml --no-model --out out/extract/code-only.yaml
driftbench extract approve out/extract/code-only.yaml
driftbench extract approve out/extract/code-only.yaml --dimension behaviour --dimension deviation --dimension channel --to out/extract/approved.yaml
driftbench extract map out/extract/approved.yaml --to out/extract/space.yaml
driftbench extract approve examples/acme/map/approved.yaml
driftbench extract map examples/acme/map/approved.yaml --to out/extract/acme-space.yaml
```

```text
$ driftbench extract --prompt examples/acme/src/policy.ts --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml --no-model --out out/extract/code-only.yaml
Wrote out/extract/code-only.yaml: 34 dimensions, 91 values, 55 constraints, 0 phrases, 7 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 3 axes (behaviour, deviation, channel), 31 details; the axes make a full grid of 252 cells.
  No model call: the code pre-pass alone (--no-model).
Notes:
  catalog.search output: no partition stated for customer.id, customer.name, customer.current_plan_id
  coverage.check output: no partition stated for address
  port.check output: no partition stated for number
  order.create input: no partition stated for plan_id, customer.name, customer.email
  order.create output: no partition stated for order_id, plan_id, monthly_usd
  notify_sales output: no partition stated for ticket_id
Next: driftbench extract approve out/extract/code-only.yaml lists the decisions; approve by --dimension <id> or --all.
(exit 0)
$ driftbench extract approve out/extract/code-only.yaml
out/extract/code-only.yaml: 96 of 96 decisions are open (34 dimensions, 55 constraints, 0 phrases, 7 relations).
Axes: 3 of 34 dimensions, a full grid of 252 cells (the space commands accept 250000).
  dimension   behaviour  behaviour axis, by code, 14 values: The behaviours the inventory lists
  dimension   flow  behaviour detail, by code, 5 values: The flows the inventory lists
  dimension   deviation  deviation axis, by code, 8 values: The deviation classes the flows must be perturbed with
  dimension   channel  channel axis, by code, 2 values: The channels the inventory names
  (152 more lines)
  relation    recovery  recovery D6_instruction_in_data in price-sheet
              ../../examples/acme/inventory.yaml: "deviations: [D6_instruction_in_data]"
Approve a dimension and its values with --dimension <id>, or every entry with --all. In the file, set
approved: true; a value may set its own flag, and role: axis or detail decides what enters the space map.
(exit 0)
$ driftbench extract approve out/extract/code-only.yaml --dimension behaviour --dimension deviation --dimension channel --to out/extract/approved.yaml
Approved 3 dimensions in out/extract/approved.yaml: behaviour, deviation, channel.
(exit 0)
$ driftbench extract map out/extract/approved.yaml --to out/extract/space.yaml
Wrote out/extract/space.yaml: 3 axes (behaviour, deviation, channel), 0 constraints, a full grid of 252 cells.
(exit 0)
$ driftbench extract approve examples/acme/map/approved.yaml
examples/acme/map/approved.yaml: all 291 decisions are made.
Axes: 7 of 51 dimensions, a full grid of 113568 cells (the space commands accept 250000).
(exit 0)
$ driftbench extract map examples/acme/map/approved.yaml --to out/extract/acme-space.yaml
Wrote out/extract/acme-space.yaml: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 380 constraints, a full grid of 212940 cells.
(exit 0)
```

The approved copy has `0 constraints` in its space map: its 3 channel constraints exist but are not approved yet. Approve them in the file (`approved: true`) or with `--all`, and write the map again. `examples/acme/map/approved.yaml` is what `generate --map` takes; the written `acme-space.yaml` is what `space coverage --map` takes.

### The full Acme proposal from a recording

The sources quoted by the recorded Acme answers sit one folder above the proposal (`../src/policy.ts`). To replay into a folder of your own, copy that layout first:

```sh setup
mkdir -p out/authoring-extract/acme/src out/authoring-extract/acme/map
cp examples/acme/src/policy.ts examples/acme/src/store.ts out/authoring-extract/acme/src/
cp examples/acme/README.md examples/acme/inventory.yaml out/authoring-extract/acme/
cp examples/acme/map/tools.yaml examples/acme/map/answers.yaml out/authoring-extract/acme/map/
```

Code pre-pass only, then the full proposal from the recording (no model call in either):

```sh
driftbench extract --prompt examples/acme/src/policy.ts --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml --no-model --out out/authoring-extract/code-only.yaml
driftbench extract --prompt out/authoring-extract/acme/src/policy.ts --prompt out/authoring-extract/acme/README.md --prompt out/authoring-extract/acme/src/store.ts --inventory out/authoring-extract/acme/inventory.yaml --tools out/authoring-extract/acme/map/tools.yaml --replay out/authoring-extract/acme/map/answers.yaml --out out/authoring-extract/acme/map/proposal.yaml
```

```text
$ driftbench extract --prompt examples/acme/src/policy.ts --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml --no-model --out out/authoring-extract/code-only.yaml
Wrote out/authoring-extract/code-only.yaml: 34 dimensions, 91 values, 55 constraints, 0 phrases, 7 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 3 axes (behaviour, deviation, channel), 31 details; the axes make a full grid of 252 cells.
  No model call: the code pre-pass alone (--no-model).
Notes:
  catalog.search output: no partition stated for customer.id, customer.name, customer.current_plan_id
  coverage.check output: no partition stated for address
  port.check output: no partition stated for number
  order.create input: no partition stated for plan_id, customer.name, customer.email
  order.create output: no partition stated for order_id, plan_id, monthly_usd
  notify_sales output: no partition stated for ticket_id
Next: driftbench extract approve out/authoring-extract/code-only.yaml lists the decisions; approve by --dimension <id> or --all.
(exit 0)
$ driftbench extract --prompt out/authoring-extract/acme/src/policy.ts --prompt out/authoring-extract/acme/README.md --prompt out/authoring-extract/acme/src/store.ts --inventory out/authoring-extract/acme/inventory.yaml --tools out/authoring-extract/acme/map/tools.yaml --replay out/authoring-extract/acme/map/answers.yaml --out out/authoring-extract/acme/map/proposal.yaml
Wrote out/authoring-extract/acme/map/proposal.yaml: 51 dimensions, 184 values, 111 constraints, 55 phrases, 74 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 44 details; the axes make a full grid of 113568 cells.
  Model lane claude-opus-5-5 as the extract and generate2 lanes, by hand: 6 sections, 6 calls.
    stages     added 39 entries
    rules      added 16 entries
    personas   added 45 entries
    data       added 49 entries
    phrases    added 55 entries
    relations  added 67 entries
Notes:
  catalog.search output: no partition stated for customer.id, customer.name, customer.current_plan_id
  coverage.check output: no partition stated for address
  port.check output: no partition stated for number
  order.create input: no partition stated for plan_id, customer.name, customer.email
  order.create output: no partition stated for order_id, plan_id, monthly_usd
  notify_sales output: no partition stated for ticket_id
Next: driftbench extract approve out/authoring-extract/acme/map/proposal.yaml lists the decisions; approve by --dimension <id> or --all.
(exit 0)
```

List the open decisions (481 lines in all; the middle is cut):

```sh
driftbench extract approve out/authoring-extract/acme/map/proposal.yaml
```

```text
$ driftbench extract approve out/authoring-extract/acme/map/proposal.yaml
out/authoring-extract/acme/map/proposal.yaml: 291 of 291 decisions are open (51 dimensions, 111 constraints, 55 phrases, 74 relations).
Axes: 7 of 51 dimensions, a full grid of 113568 cells (the space commands accept 250000).
  dimension   behaviour  behaviour axis, by code, 14 values: The behaviours the inventory lists
  dimension   flow  behaviour detail, by code, 5 values: The flows the inventory lists
  dimension   deviation  deviation axis, by code, 12 values: The deviation classes the flows must be perturbed with
  dimension   channel  channel axis, by code, 2 values: The channels the inventory names
  (471 more lines)
  relation    recovery  recovery D8_tool_failure of notify_sales in new-home
              ../src/policy.ts: "our sales system is not responding"
Approve a dimension and its values with --dimension <id>, or every entry with --all. In the file, set
approved: true; a value may set its own flag, and role: axis or detail decides what enters the space map.
(exit 0)
```

Approve two dimensions into a copy, and write the space map of what is approved:

```sh
driftbench extract approve out/authoring-extract/acme/map/proposal.yaml --dimension stage --dimension deviation --to out/authoring-extract/acme/map/partly.yaml
driftbench extract map out/authoring-extract/acme/map/partly.yaml --to out/authoring-extract/acme/map/space-partly.yaml
```

```text
$ driftbench extract approve out/authoring-extract/acme/map/proposal.yaml --dimension stage --dimension deviation --to out/authoring-extract/acme/map/partly.yaml
Approved 2 dimensions in out/authoring-extract/acme/map/partly.yaml: deviation, stage.
(exit 0)
$ driftbench extract map out/authoring-extract/acme/map/partly.yaml --to out/authoring-extract/acme/map/space-partly.yaml
Wrote out/authoring-extract/acme/map/space-partly.yaml: 2 axes (deviation, stage), 0 constraints, a full grid of 169 cells.
(exit 0)
```

Approve everything (on a fictional example; on a real agent, read each entry first), check, and write the space map:

```sh
driftbench extract approve out/authoring-extract/acme/map/proposal.yaml --all --to out/authoring-extract/acme/map/approved.yaml
driftbench extract approve out/authoring-extract/acme/map/approved.yaml
driftbench extract map out/authoring-extract/acme/map/approved.yaml --to out/authoring-extract/acme/map/space.yaml
```

```text
$ driftbench extract approve out/authoring-extract/acme/map/proposal.yaml --all --to out/authoring-extract/acme/map/approved.yaml
Approved 291 flags in out/authoring-extract/acme/map/approved.yaml; 0 were already set.
(exit 0)
$ driftbench extract approve out/authoring-extract/acme/map/approved.yaml
out/authoring-extract/acme/map/approved.yaml: all 291 decisions are made.
Axes: 7 of 51 dimensions, a full grid of 113568 cells (the space commands accept 250000).
(exit 0)
$ driftbench extract map out/authoring-extract/acme/map/approved.yaml --to out/authoring-extract/acme/map/space.yaml
Wrote out/authoring-extract/acme/map/space.yaml: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 380 constraints, a full grid of 212940 cells.
(exit 0)
```

`approved.yaml` is what `generate --map` takes; `space.yaml` is what `space coverage --map` takes.

## Common errors

Replaying into a folder where the recorded source paths do not resolve: the proposal is written, every model entry is refused, exit 1. The first lines:

```
$ driftbench extract --prompt examples/acme/src/policy.ts --prompt examples/acme/README.md --prompt examples/acme/src/store.ts --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml --replay examples/acme/map/answers.yaml --out out/authoring-extract/proposal.yaml
Wrote out/authoring-extract/proposal.yaml: 34 dimensions, 91 values, 55 constraints, 8 phrases, 7 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 3 axes (behaviour, deviation, channel), 31 details; the axes make a full grid of 252 cells.
  Model lane claude-opus-5-5 as the extract and generate2 lanes, by hand: 6 sections, 6 calls.
    stages     added 0 entries
    rules      added 0 entries
    personas   added 0 entries
    data       added 0 entries
    phrases    added 8 entries
    relations  added 0 entries
Refused, not in the proposal:
  stages  stage/needs  "../src/policy.ts" is not one of the sources
```

Fix: write the proposal where the recorded paths resolve (the copy above), or pass `--force` once the folder is right.

A quote edited so it no longer matches its source (`broken.yaml` is `proposal.yaml` with one word of a behaviour title changed):

```
$ driftbench extract approve out/authoring-extract/acme/map/broken.yaml
✗ out/authoring-extract/acme/map/broken.yaml
  dimensions.0.values.7.evidence.quote  PROPOSAL_QUOTE_NOT_FOUND  the quote is not in ../inventory.yaml: an entry stands only on text its source holds
The proposal is invalid, so nothing was approved.
(exit 1)
```

Option and input errors:

```
$ driftbench extract --prompt out/authoring-extract/acme/src/policy.ts --out out/authoring-extract/acme/map/y.yaml
error: required option '--inventory <file>' not specified
(exit 2)
$ driftbench extract --prompt out/authoring-extract/acme/src/policy.ts --inventory out/authoring-extract/acme/inventory.yaml --no-model --replay out/authoring-extract/acme/map/answers.yaml --out out/authoring-extract/acme/map/y.yaml
error: --no-model and --replay cannot be used together
(exit 2)
$ driftbench extract --prompt out/authoring-extract/acme/src/policy.ts --inventory out/authoring-extract/acme/inventory.yaml --no-model --out out/authoring-extract/acme/map/proposal.yaml
out/authoring-extract/acme/map/proposal.yaml already exists: pass --force to replace it (the approvals in it are lost).
(exit 2)
$ driftbench extract --prompt out/authoring-extract/acme/src/policy.ts --inventory out/authoring-extract/acme/inventory.yaml --out out/authoring-extract/acme/map/y.yaml
no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL. Pass --no-model to run the code pre-pass only.
(exit 2)
$ driftbench extract approve out/authoring-extract/acme/map/proposal.yaml --all --dimension stage
error: --all and --dimension cannot be used together
(exit 2)
$ driftbench extract approve out/authoring-extract/acme/map/proposal.yaml --all --to out/approved.yaml
error: --to must stay in the folder of the proposal, where its source paths resolve
(exit 2)
$ driftbench extract approve out/authoring-extract/acme/map/proposal.yaml --dimension nosuch --to out/authoring-extract/acme/map/x.yaml
✗ out/authoring-extract/acme/map/proposal.yaml
  (file)  PROPOSAL_UNKNOWN_DIMENSION  dimension "nosuch" is not in the proposal
(exit 1)
$ driftbench extract map out/authoring-extract/acme/map/proposal.yaml --to out/authoring-extract/acme/map/none.yaml
✗ the space map of out/authoring-extract/acme/map/proposal.yaml is invalid
  (no approved axis dimension)
(exit 1)
```

The no-key error is what you get with neither key in the environment and no `--no-model` or `--replay`. Nothing is written in any exit 2 case.

| Code | Meaning |
|---|---|
| `PROPOSAL_PARSE` | the file cannot be read, or is not valid YAML |
| `PROPOSAL_NOT_OBJECT` | the file does not hold one mapping |
| `PROPOSAL_EVIDENCE_MISSING` | an entry has no evidence |
| `PROPOSAL_DUPLICATE` | an id or entry is listed twice |
| `PROPOSAL_UNKNOWN_SOURCE` | an evidence `source` is not in `sources` |
| `PROPOSAL_UNKNOWN_DIMENSION` | a reference, or `--dimension`, names a dimension the proposal does not have |
| `PROPOSAL_UNKNOWN_VALUE` | a reference names a value the dimension does not have |
| `PROPOSAL_SOURCE_UNREADABLE` | a listed source file cannot be read from the proposal's folder |
| `PROPOSAL_QUOTE_NOT_FOUND` | a quote is not in its source: the source changed, or the quote was edited |
| `SPACE_*`, `SCHEMA_*` | the proposal is not a valid map, or the schema refuses a key or value |
