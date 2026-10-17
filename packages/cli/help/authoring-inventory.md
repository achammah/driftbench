---
title: Behaviour inventory and spec coverage
summary: 'The behaviour inventory lists what the agent must do, grouped into flows with the deviations each flow must survive. `spec coverage` shows which behaviours and deviations your specs cover, per channel.'
commands:
  - spec coverage
see_also:
  - authoring-spec-format
  - authoring-deviation-classes
  - authoring-perturbations
  - authoring-map
  - authoring-space-coverage
  - authoring-extract
next:
  - authoring-import
---

## What it is

The behaviour inventory is one YAML or JSON file. It lists:

- `behaviours`: every behaviour the agent must show, each with an id such as `B-001`, and optionally the channels where it applies.
- `flows`: groups of behaviours that run together, each with the deviation classes the flow must be perturbed with.
- `channels`: optionally, the channel universe.

Specs point at the inventory in two ways. `covers: [B-001, ...]` names the behaviours a spec covers. The tag `flow:<id>` ties a spec to a flow.

`driftbench spec coverage` reads the inventory and the specs and prints two matrices:

- Behaviours by channel: one row per behaviour, one column per channel. A cell is `covered` when a valid spec on that channel, or on no channel, lists the behaviour in `covers`. It is `missing` when none does. It is `n/a` when the behaviour does not apply on that channel.
- Flows by required deviation: one row per flow. A spec belongs to a flow when it carries the tag `flow:<id>`, or covers one of the flow's behaviours. A required deviation class is covered when a member spec has a perturbation of that class. It is also covered when a block has a stimulus that is an injection of that class.

Task behaviours (`kind: task`) and task specs are rows of the same matrices as conversations. Invalid specs are listed and never count.

The inventory is also an input of `extract`, `space declare` and the `inventory` key of a space map.

## When to use it

- Before writing specs: list what the agent must do, so gaps are visible.
- After writing or generating specs: find behaviours and required deviations no spec covers yet.
- In CI: `spec coverage` exits 1 while a required cell is missing.

## Commands and every option

### driftbench spec coverage

```
driftbench spec coverage <paths...> --inventory <file> [--channel <name>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | Spec files or folders. Folders are searched recursively for `*.yaml`, `*.yml`, `*.spec.json`. | none |
| `--inventory <file>` (required) | The behaviour inventory, YAML or JSON (`.json` is read as JSON). | none |
| `--channel <name>` | Only this channel. Only specs on that channel, or on no channel, count. It must be one of the channels (see below). | every channel |
| `--json` | Print one JSON document. | off |

The channels are the inventory's `channels`. Without them: every channel named by a behaviour or a valid spec, sorted. Without any: the one channel `default`.

| Exit code | When |
|---|---|
| 0 | every applicable behaviour and every required deviation is covered |
| 1 | a behaviour is missing on a channel where it applies, or a required deviation is missing |
| 2 | an invalid inventory, a path that does not exist, no spec file found, an unknown channel, an option error |

Warnings never change the exit code.

## Inputs

### The inventory file

Top level (one mapping; unknown keys are errors):

| Key | Type | Required | Meaning |
|---|---|---|---|
| `behaviours` | list | yes | Every behaviour the agent must show. May be empty. |
| `flows` | list | yes | The flows. May be empty. |
| `channels` | list of strings, at least 1 | no | The channel universe. Leave the key out rather than writing `[]`. |

A behaviour:

| Key | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `id` | string matching `^[A-Z]+-\d+$`, such as `B-001` or `T-012` | yes | none | The id specs name in `covers`. |
| `title` | string | yes | none | What the agent does. |
| `kind` | `conversation` or `task` | no | `conversation` | `task` marks a code-agent behaviour. |
| `channels` | list of strings, at least 1 | no | every channel | The channels where it applies. When the inventory lists `channels`, each must be one of them. |

A flow:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | string matching `^[a-z0-9][a-z0-9_-]*$`, such as `plan-upgrade` | yes | Specs join it with the tag `flow:<id>`. |
| `title` | string | yes | What the flow does. |
| `behaviours` | list of behaviour ids | yes | Each must be a behaviour of the inventory. |
| `deviations` | list of deviation classes | no | The classes the flow must be perturbed with, from `D1_off_topic` to `D12_prompt_extraction` (see authoring-deviation-classes). Absent: none required. |

No id, channel, flow behaviour or flow deviation may be listed twice.

A minimal inventory:

```yaml
channels: [chat]
behaviours:
  - id: B-001
    title: Greets the customer once and names the assistant
flows:
  - id: greeting
    title: The opening of every conversation
    behaviours: [B-001]
    deviations: [D1_off_topic]
```

### In the specs

```yaml
channel: chat              # the spec counts on this channel only; absent: on every channel
covers: [B-001]            # behaviours this spec covers
tags: ['flow:greeting']    # makes the spec a member of the flow
perturbations:             # a perturbation of a required class covers it
  - { id: aside, class: D1_off_topic, inject_at: 1, user: Is the shop open on Sunday? }
```

## Outputs and how to read them

Text output, in this order:

- `Behaviours by channel`: per row a mark (`✓` every applicable cell covered, `✗` a cell missing), the id and the kind. Then come one cell per channel (`covered`, `missing`, `n/a`), and the title. The `total` row gives covered of applicable cells per channel.
- `Flows by required deviation`: per row a mark (`✓` all required deviations covered, `✗` one missing, `-` none required). Then come the flow id and the member spec count. Then come each required class with `covered` or `missing`, and the title.
- `Warnings` (only when there are some):

| Code | Meaning | What to do |
|---|---|---|
| `UNKNOWN_BEHAVIOUR` | a spec covers a behaviour id the inventory does not list | fix the id in `covers`, or add the behaviour |
| `UNKNOWN_FLOW` | a spec carries `flow:<id>` for a flow the inventory does not list | fix the tag, or add the flow |
| `UNLISTED_CHANNEL` | a spec runs on a channel the inventory's `channels` do not list, so it counts for no channel | add the channel, or fix the spec's `channel` |
| `KIND_MISMATCH` | a behaviour is covered only by specs of the other kind (a task behaviour by conversation specs, or the reverse) | write a spec of the right kind |

- `Invalid specs, not counted`: each invalid spec with its first error. Fix them with `spec validate`.
- Last line: `Coverage: <a> of <b> behaviours covered, <c> of <d> flow deviations covered.` A behaviour counts as covered when every applicable cell is.

`--json` prints one document with the keys `inventory`, `channels`, `behaviours`, `perChannel`, `flows`, `warnings`, `invalidSpecs`, `summary` and `ok`. `behaviours` has, for each: `id`, `title`, `kind`, `status` and its `cells`: channel, status and covering spec ids. `perChannel` has applicable, covered, missing per channel. `flows` has, for each, its member `specs` and, per required deviation, `status`, `specs` and `sources`. `sources` give the spec, `perturbation` or `injection`, and the path in the spec. `summary` has `behaviours` and `deviations`, each `{ covered, total }`.

## Worked example

The Acme inventory against the seven Acme specs:

```sh
driftbench spec coverage examples/acme/specs --inventory examples/acme/inventory.yaml # exit 1
```

```text
$ driftbench spec coverage examples/acme/specs --inventory examples/acme/inventory.yaml
Behaviours by channel
     id     kind          chat      whatsapp  title
  ✓  B-001  conversation  covered   n/a       Identify an existing customer by the email on the account before quoting their plan
  ✗  B-002  conversation  covered   missing   Offer an existing customer only plans with more data than their current plan
  ✗  B-003  conversation  covered   missing   Check coverage at the street address before offering home internet
  ✗  B-004  conversation  covered   missing   Offer only the home plans available at the checked address
  ✗  B-005  conversation  covered   missing   Book a sales callback with a phone number when the customer asks or a check cannot be done
  ✗  B-006  conversation  missing   covered   Check that a number can move to Acme before promising to keep it
  ✗  B-007  conversation  missing   missing   Explain a transfer lock and offer a new Acme number when a number cannot move
  ✓  B-008  conversation  covered   covered   Recap the order and place it only after an explicit CONFIRM
  ✗  B-009  conversation  covered   missing   Treat a loose yes as no confirmation and ask for CONFIRM again
  ✗  B-010  conversation  covered   missing   Report a failed tool honestly, invent none of its answer, and offer a fallback
  ✗  B-011  conversation  covered   missing   Answer an off-topic question in one line and resume the pending step
  ✗  B-012  conversation  covered   missing   Send billing and service matters to Acme Care, never to sales
  ✓  B-013  task          covered   n/a       Build the price sheet workbook from the catalog file, one sheet per category
  ✓  B-014  task          covered   n/a       Add a summary sheet to the existing workbook and leave every other file untouched
     total                12 of 14  2 of 11

Flows by required deviation
  -  upgrade      3 specs  no deviation required                                                                                                              An existing customer moves to a plan with more data
  ✗  new-home     4 specs  D1_off_topic covered · D5_language_switch missing · D6_instruction_in_data covered · D8_tool_failure covered · D10_return covered  A new customer asks for home internet at an address
  -  porting      3 specs  no deviation required                                                                                                              A new customer switches to Acme and keeps their number
  ✗  order        4 specs  D2_goal_shift missing · D3_contradiction missing · D4_loose_confirmation covered · D8_tool_failure covered                         Recap, explicit confirmation and order placement
  ✓  price-sheet  1 spec   D6_instruction_in_data covered                                                                                                     Sales operations builds the price sheet in a code agent's workspace

Coverage: 4 of 14 behaviours covered, 7 of 10 flow deviations covered.
(exit 1)
```

How to read it: B-007 has no spec on any channel. Most behaviours have no `whatsapp` spec. The `order` flow needs a `D2_goal_shift` and a `D3_contradiction` perturbation. The gaps are deliberate in this example.

The test fixtures show the warning and invalid-spec sections:

```sh
driftbench spec coverage packages/core/test/coverage/fixtures/specs --inventory packages/core/test/coverage/fixtures/inventory.yaml # exit 1
```

```text
$ driftbench spec coverage packages/core/test/coverage/fixtures/specs --inventory packages/core/test/coverage/fixtures/inventory.yaml
Behaviours by channel
     id     kind          chat     whatsapp  title
  ✓  B-001  conversation  covered  covered   Greets the customer once and names the assistant
  ✓  B-002  conversation  covered  covered   Looks up the available plans before quoting a price
  ✓  B-003  conversation  covered  n/a       Sends the offer card once
  ✗  B-004  conversation  covered  missing   Asks for an explicit yes before submitting the order
  ✓  T-001  task          covered  covered   Builds the monthly usage sheet with one tab per line
     total                5 of 5   3 of 4

Flows by required deviation
  ✓  plan-upgrade  2 specs  D1_off_topic covered · D4_loose_confirmation covered  Plan upgrade from greeting to submission
  ✗  usage-report  1 spec   D2_goal_shift covered · D8_tool_failure missing       Monthly usage report built in the workspace
  -  offer-card    1 spec   no deviation required                                 Offer card on chat

Warnings
  ! B-099  UNKNOWN_BEHAVIOUR  covered by stray, but the inventory has no behaviour B-099

Invalid specs, not counted
  ✗ packages/core/test/coverage/fixtures/specs/broken.yaml  blocks.0  BLOCK_STIMULUS_MISSING  a block needs `user`, `burst` or `when`

Coverage: 4 of 5 behaviours covered, 3 of 4 flow deviations covered.
(exit 1)
```

## Common errors

An inventory error stops the command before coverage is computed (exit 2). Schema errors come first; the cross-reference checks run once the schema passes.

```
$ driftbench spec coverage examples/acme/specs --inventory out/authoring-inventory/bad-inventory.yaml
✗ out/authoring-inventory/bad-inventory.yaml
  behaviours.2.id  SCHEMA_INVALID_FORMAT  expected an id such as B-001: capital letters, a hyphen, then digits
  flows.0.id  SCHEMA_INVALID_FORMAT  expected a slug such as plan-upgrade: lowercase letters, digits, hyphens and underscores
The inventory is invalid, so coverage was not computed.
(exit 2)
$ driftbench spec coverage examples/acme/specs --inventory out/authoring-inventory/bad-refs.yaml
✗ out/authoring-inventory/bad-refs.yaml
  behaviours.0.channels.0  INVENTORY_UNKNOWN_CHANNEL  channel "email" is not in the inventory's channels (chat)
  behaviours.1.id  INVENTORY_DUPLICATE  behaviour "B-001" is listed twice
  flows.0.behaviours.1  INVENTORY_UNKNOWN_BEHAVIOUR  behaviour "B-009" is not in the inventory's behaviours
  flows.0.deviations.1  INVENTORY_DUPLICATE  deviation class "D1_off_topic" is listed twice
The inventory is invalid, so coverage was not computed.
(exit 2)
$ driftbench spec coverage examples/acme/specs --inventory examples/acme/inventory.yaml --channel sms
Unknown channel "sms". The channels are: chat, whatsapp.
(exit 2)
```

| Code | Meaning | Fix |
|---|---|---|
| `INVENTORY_PARSE` | the file cannot be read, or is not valid YAML or JSON (a repeated key included) | fix the path or the syntax |
| `INVENTORY_NOT_OBJECT` | the file does not hold one mapping with behaviours and flows | write a mapping at the top level |
| `INVENTORY_DUPLICATE` | an id, a channel, a behaviour of a flow or a deviation class is listed twice | remove the repeat |
| `INVENTORY_UNKNOWN_BEHAVIOUR` | a flow names a behaviour the inventory does not list | add the behaviour or fix the id |
| `INVENTORY_UNKNOWN_CHANNEL` | a behaviour names a channel that is not in the inventory's `channels` | add it to `channels` |
| `SCHEMA_*` | a key or value the schema refuses: a bad id format, an unknown key, an unknown deviation class, an empty `channels` list | follow the tables above |
| `Cannot find <path>.` | a spec path does not exist | fix the path |
| `No spec files found.` | the folders hold no `*.yaml`, `*.yml` or `*.spec.json` | point at the spec folder |
