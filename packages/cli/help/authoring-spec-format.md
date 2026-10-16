---
title: Spec file format
summary: 'A spec is one YAML or JSON file: one golden conversation or one code-agent task, as a list of blocks. Read this before you write or edit a spec.'
commands:
  - spec validate
  - spec lint
  - spec coverage
see_also:
  - running-campaign-run
  - authoring-blocks
  - authoring-prefixes
  - authoring-perturbations
  - authoring-spec-check
  - authoring-script-api
  - authoring-inventory
next:
  - authoring-blocks
---

## What it is

A spec is a test for an agent. One spec file holds one mapping. The mapping describes either:

- one golden conversation (`kind: conversation`, the default), or
- one task for a code agent that works in a workspace (`kind: task`).

The core of a spec is `blocks`: a list of steps in order. Each block sends one stimulus to the agent and checks what the agent did. Around the blocks, the spec declares:

- the agent to run (`target`) and the starting state (`given`);
- the stage names (`stages`) and the judged criteria (`criteria`);
- rules for the whole run (`rules`) and the expected final state (`end_state`);
- the deviations a perturbed run injects (`perturbations`).

Every command that reads specs parses, normalises and validates them the same way. Unknown keys are errors at every level.

## When to use it

- You write a new test by hand.
- You read a spec that `generate`, `gate`, `family instances` or `import` wrote, and want to know what each key means.
- `spec validate` reports a `SCHEMA_*` code and you need the allowed keys and types.

## Commands and every option

This is a format topic: no option of any command changes the format. The three `spec` commands read spec files and report on them. `campaign run` runs them; its options are in running-campaign-run.

### driftbench spec validate

```
driftbench spec validate [options] <paths...>
```

Parses and validates specs. Exit 0 when every spec is valid, 1 when one is invalid. Its codes are in authoring-spec-check.

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | spec files or folders | none |
| `--json` | print one JSON document | off |

### driftbench spec lint

```
driftbench spec lint [options] <paths...>
```

Validates specs and prints advice warnings. Exit 1 on an invalid spec, and on a warning with `--strict`.

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | spec files or folders | none |
| `--json` | print one JSON document | off |
| `--strict` | treat warnings as failures | off |

### driftbench spec coverage

```
driftbench spec coverage [options] <paths...>
```

Shows which behaviours and deviations the specs cover. Exit 1 when one is missing. The inventory format is in authoring-inventory.

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | spec files or folders | none |
| `--inventory <file>` | the behaviour inventory, YAML or JSON | none |
| `--channel <name>` | count only the specs of this channel | every channel |
| `--json` | print one JSON document | off |

How every command finds spec files in the paths you give:

| Rule | Effect |
|---|---|
| a file path | read as given; `.json` is read as JSON, any other extension as YAML |
| a folder path | searched recursively for `*.yaml`, `*.yml` and `*.spec.json`, in sorted order |
| skipped while searching | entries whose name starts with a dot, `node_modules`, `dist` |
| a path that does not exist | reported as an invalid spec with `SPEC_PARSE` |

YAML is parsed with unique keys: a key written twice in one mapping is a `SPEC_PARSE` error.

## Inputs

### Top-level keys

| Key | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `schema_version` | whole number, 1 | no | 1 | The spec format the spec is written for. A driftbench that reads a lower version refuses the spec with `SPEC_SCHEMA_VERSION` and says to upgrade, instead of reporting its newer keys as unknown. Written, it is part of the spec and its hash. It is not the free `version` label below. |
| `id` | string matching `^[A-Za-z0-9][A-Za-z0-9._-]*$` | yes | none | The spec id. Run ids and reports use it. |
| `version` | string | no | none | A free label. The content hash, not this label, is the cache key. Quote numbers: `version: '1'`. |
| `kind` | `conversation` or `task` | no | `conversation` | A conversation with a chat agent, or a task for a code agent in a workspace. |
| `title` | string | no | none | A short title. |
| `description` | string | no | none | A longer description. |
| `channel` | string | no | none | The channel, such as `chat` or `whatsapp`. Coverage and the space map read it. |
| `lang` | string, 2 to 8 characters | no | none | The declared language, such as `EN`, `FR`, `NL`. |
| `tier` | string | no | none | A free tier label, such as `core` or `edge`. |
| `tags` | list of strings | no | none | Free tags. Some prefixes have a meaning, see below. |
| `covers` | list of strings | no | none | Ids of the behaviours of the inventory this spec covers, such as `B-001`. |
| `target` | mapping (see below) | no | none | The default agent. `--target` on the command line overrides it. |
| `given` | mapping with `ledger`, `world`, `vars` | no | none | Initial conditions for every block. See authoring-prefixes. |
| `stages` | list of non-empty strings | no | none | The stage catalogue. When set, every `expect.stage` and `recovery.stage_after` must be one of these. |
| `criteria` | list of criterion mappings | no | none | The judged criteria the blocks may name. |
| `blocks` | list of block mappings, at least 1 | yes | none | The steps, in order. See authoring-blocks. |
| `end` | mapping | no | none | An end verdict that stops the run early. Usually written by the script API. |
| `rules` | mapping | no | none | Rules for the whole run. |
| `end_state` | `none`, a mapping, or a list of mappings | no | none | The expected state of the world after the run. |
| `perturbations` | list of mappings | no | none | Deviations a perturbed run (mode P) injects. See authoring-perturbations. |
| `uses` | mapping | no | none | The objects every block uses: policies, the check set, diagnostics, by id or inline. See `uses` below. |
| `metadata` | mapping | no | none | Free metadata. Some keys are read by tools, see below. |

Two shorthands are accepted at the top level and rewritten before validation:

| Shorthand | Becomes | Conflict |
|---|---|---|
| `ledger_seed: { ... }` | `given.ledger` | both set: `SPEC_ALIAS_CONFLICT` |
| `workspace_seed: <folder>` or `workspace_seed: { from, files }` | `given.world.workspace` (a string becomes `{ from: <string> }`) | both set: `SPEC_ALIAS_CONFLICT` |

### Tags with a meaning

| Tag | Read by | Meaning |
|---|---|---|
| `flow:<id>` | `spec coverage`, `space coverage`, `--route` of `campaign run`, `gate`, `ci` | ties the spec to a flow of the inventory; `--route flow:<id>=<target>` sends it to another agent |
| `persona:<id>` | `space coverage`, `space complete` | places the spec on a value of the persona dimension of the space map |
| `data:<id>` | `space coverage` | places the spec on a value of the data dimension |
| `task:<id>` | `space coverage` | places the spec on a value of the task dimension |

Any other tag is free text.

### `target`

| Key | Type | Required | Meaning |
|---|---|---|---|
| `adapter` | string | yes | The adapter that reaches the agent: `function`, `process`, `http`, `nexus`, or one a plugin adds. |
| `agent` | string | no | The agent, as the adapter names it, such as `acme-sales`. |
| `variant` | string | no | A variant of the agent, such as a prompt version. `--agent-version` writes it. |
| `deployment` | string | no | A deployment of the agent, as the adapter names it. |
| `options` | mapping | no | Adapter settings; each adapter defines their names. |
| `prompt` | mapping `{ name, version, hash, text }` | no | A prompt version from the store. `campaign run --prompt` sets it; do not write it by hand. |
| `retry` | mapping | no | How model calls are retried: `max_attempts` (1 to 20, default 4), `base_delay_ms` (default 500), `max_delay_ms` (default 30000), `jitter` (default true), `retry_after` (default true). |

On the command line the same target is written `<adapter>:<agent>`, such as `function:acme-sales` or `process:acme-ops`. `function:acme` is a short form of `function:acme-sales`.

### `criteria` (one entry)

| Key | Type | Required | Meaning |
|---|---|---|---|
| `name` | string matching `^[A-Za-z0-9][A-Za-z0-9_.-]*$` | yes | The name blocks use in `expect.criteria`. |
| `rubric` | string | yes | The question the judge answers with pass or fail. |
| `pass` | string | no | What a passing block looks like. |
| `fail` | string | no | What a failing block looks like. |
| `gating` | boolean | no | True gates every reference. A reference can also add `@gating`: `name@gating`. |
| `scope` | `block` or `conversation` | no | Judge one block, or the whole conversation. |
| `inputs` | list of strings | no | Workspace files the judge reads beside the transcript. |
| `judge_class` | `system1`, `system2` or `auto` | no | The judge class; `auto` lets calibration choose. |
| `repeat_reducer` | `mode`, `median` or `at_least:<k>` | no | How the verdicts of the repeats of one spec become one verdict. |

When a spec has no `criteria` key, blocks may still name criteria; they must then come from a shared catalogue, and `spec lint` warns `CRITERION_UNRESOLVED`. A criterion is judged only when the run loads a judge council; otherwise it has no verdict and counts in no pass or fail.

### `rules`

| Key | Type | Meaning |
|---|---|---|
| `max_calls` | mapping of tool name to whole number from 0 | The most calls per tool across the run. 0 forbids the tool. |
| `forbidden_tools` | list of tool names | Tools that must never be called. A block that expects one of them is a `TOOL_FORBIDDEN_EXPECTED` error. |
| `lang_stable` | boolean | The reply language stays the same across blocks. |
| `one_message_per_turn` | boolean | Each block may send one message only. |
| `match_case` | boolean | True makes `must` and `must_not` case-sensitive and counts trailing punctuation. Default false. |
| `custom` | mapping of check name to options | Runs a registered custom check on every block. |

### `end_state`

`end_state: none` asserts that nothing was submitted. Otherwise one mapping, or a list of at least one:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `source` | string | yes | Where the adapter reads the state, such as `tool:order.create` (the payload the tool recorded). |
| `mode` | `subset` or `exact` | no | `subset` compares the listed fields; `exact` compares the whole state. |
| `expect` | mapping of field to assertion | yes | Assertions on fields of the state. An assertion is a bare value, compared for exact equality. Or it is one of seven forms. Four take a value: `{ exact }`, `{ regex }`, `{ contains }` and `{ one_of }`. The others are `{ nonempty: true }`, `{ absent: true }` and `{ subset }`. |

The end state is checked on the last block of a run in modes T and F.

### `end`

| Key | Type | Required | Meaning |
|---|---|---|---|
| `verdict` | `success` or `failure` | yes | How the script ends the conversation. |
| `reason` | string | no | Why. |
| `atBlock` | whole number from -1 | no | The last block that runs; -1 for none; default the last block. Later blocks are skipped. |

### `metadata`

Free, with these keys read by tools:

| Key | Written or read by |
|---|---|
| `tool_schemas` | read by the `schema_strict` check, by `extract --tools`, and by the value check of `tools` (a field's `pattern`, `enum` or `const` is its stated contract; the tool's and the field's `description` are what the same-referent judge reads): tool name to its JSON Schema. Unsupported schema keywords are errors. |
| `depends` | read by `radius`: what each block depends on. See authoring-blast-radius. |
| `generated`, `gate`, `family`, `imported`, `estate`, `retired`, `pilot` | written by `generate`, `gate`, `family instances`, `import`, `estate`; do not edit by hand. |

### `uses`

Every rule driftbench applies is an object: a kind (`policy/blame`, `policy/value-check`, `check-set`, `diagnostic`, ...), an id, an optional parent it `extends`, and items, each one rule. `uses` names the objects a spec or a block runs with. Each key is optional and has no default: a spec without `uses` loads, hashes and replays exactly as before.

| Key | Kind it names |
|---|---|
| `value_check` | `policy/value-check` |
| `blame` | `policy/blame` |
| `placement` | `policy/placement` |
| `links` | `policy/links` |
| `selection` | `policy/selection` |
| `gating` | `policy/gating` |
| `stats` | `policy/stats` |
| `check_set` | `check-set` |
| `judges` | `judge-council` |
| `diagnostics` | a list of `diagnostic` ids |

A value is an id, such as `blame: acme`, or an inline object that extends one: `value_check: { extends: default, items: [{ id: rung3_same_referent, params: { repeats: 5 } }] }`. An item operation names an item of the parent and sets fields (`params` maps merge, lists replace, `+key: [values]` appends, `-key: [values]` removes); `enabled: false` disables it; `add: true` with `title`, `when`, `effect` and `impl` adds one; `before` or `after` moves it, or `order` lists every enabled item once. An item may carry `applies_to: { skills, tools, units }`: it then fires only when the evidence names one of those skills or tools, or a unit matching one of the unit patterns (`R#41/*`); without it, everywhere.

Where an id is looked up, weakest first: the shipped objects; the project, files `driftbench/<kind>/<id>.yaml` beside `driftbench.yaml` and its `objects:` list; each `_driftbench/<kind>/<id>.yaml` suite folder from the project down to the spec, a nearer one stronger. A `uses.yaml` in a `driftbench/` or `_driftbench/` folder sets `uses` for the specs below it. A block's key replaces the spec's, which replaces the suite's and the project's.

Every kind `uses` names is scoring-only: `uses` stays out of the block cache key and the re-judge compatibility hash, so changing it never reruns the agent. The spec hash does record it.

The loader resolves every object a layer names. An unknown object, an unknown item, an `extends` cycle, an order that is not a permutation, a missing implementation or params of the wrong type is a load error naming the spec, the block, the kind and the id.

### A minimal valid spec

```yaml
id: minimal-greeting
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address']
```

## Outputs and how to read them

A spec file produces nothing by itself. Each command prints its own result:

- For a valid spec, `spec validate` prints `✓ <path>  <id> · <n> blocks · <m> perturbations · hash <12 hex>`. For an invalid one, it prints `✗ <path>` with one line per error. See authoring-spec-check.
- The hash is the first 12 hex characters of the SHA-256 of the spec's canonical JSON, keys sorted at every depth. Equal content gives an equal hash. The hash, not `version`, enters the cache key and every run id. A workspace folder written `./<path>` is resolved from the spec's folder before the hash is taken.
- `campaign run` prints one line per cell: spec id, target, mode, repeat, `pass` or `fail`, and the block count.

## Worked example

The Acme example holds one spec of each kind. `examples/acme/specs/conversations/plan-upgrade.yaml` is a conversation on `function:acme-sales`. `examples/acme/specs/tasks/price-sheet.yaml` is a task on `process:acme-ops`, with `workspace_seed`, artifacts and a workspace diff. Validate the seven Acme specs, then run one of each kind on the targets they name; both agents are deterministic and free:

```sh
driftbench spec validate examples/acme/specs
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml examples/acme/specs/tasks/price-sheet.yaml --no-cache
```

```text
$ driftbench spec validate examples/acme/specs
✓ examples/acme/specs/conversations/new-customer-coverage.yaml  acme-new-customer-coverage · 4 blocks · 2 perturbations · hash be195c993d4f
✓ examples/acme/specs/conversations/number-porting.yaml  acme-number-porting · 5 blocks · 2 perturbations · hash 134c8e993f95
✓ examples/acme/specs/conversations/off-topic-return.yaml  acme-off-topic-return · 5 blocks · 1 perturbation · hash cca285407040
✓ examples/acme/specs/conversations/order-loose-confirmation.yaml  acme-order-loose-confirmation · 4 blocks · 2 perturbations · hash ae116e6312eb
✓ examples/acme/specs/conversations/plan-upgrade.yaml  acme-plan-upgrade · 5 blocks · 3 perturbations · hash 5ae085d0b267
✓ examples/acme/specs/conversations/tool-failure.yaml  acme-tool-failure · 3 blocks · 1 perturbation · hash e5bc5c9ba9d2
✓ examples/acme/specs/tasks/price-sheet.yaml  acme-price-sheet · 2 blocks · 1 perturbation · hash d96437659138
Checked 7 specs: 7 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml examples/acme/specs/tasks/price-sheet.yaml --no-cache
Campaign c-e9442dcb01a2: 2 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 4 criteria in 6 blocks of 2 specs (one_question_per_turn, no_invented_data, sheet_matches_catalog, reports_what_it_did), 2 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
2 cells: 2 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

The campaign id holds the clock, so it differs on each run.

### A spec of your own

Write the minimal spec of the Inputs section and a short conversation spec for the free, deterministic Acme sales agent into one folder:

```yaml file=out/authoring-spec-format/minimal.yaml
id: minimal-greeting
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address']
```


```yaml file=out/authoring-spec-format/upgrade-short.yaml
# Fictional data only.
id: upgrade-short
version: '1'
kind: conversation
title: An existing customer starts a plan upgrade
channel: chat
lang: EN
tier: core
tags: ['flow:upgrade', 'persona:terse']
covers: [B-001, B-002]
target: { adapter: function, agent: acme-sales }
given:
  ledger: { customer: existing }
stages: [identify, offer, recap, order_placed, closing]
criteria:
  - name: one_question_per_turn
    rubric: The reply asks the customer at most one question.
    judge_class: system1
blocks:
  - id: hello
    user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
    expect:
      stage: identify
      must: ['email address']
      criteria: [one_question_per_turn]
  - id: email
    user: It's sam.rivera@example.com
    expect:
      stage: offer
      tools:
        - label: catalog.search
          count: 1
          input: { category: mobile }
      must: ['Acme Mobile L']
rules:
  max_calls: { catalog.search: 1 }
  forbidden_tools: [coverage.check]
  lang_stable: true
metadata:
  owner: sales-team
```

Validate both, then run the short one on the agent its `target` names:

```sh
driftbench spec validate out/authoring-spec-format
driftbench campaign run out/authoring-spec-format/upgrade-short.yaml --no-cache
```

```text
$ driftbench spec validate out/authoring-spec-format
✓ out/authoring-spec-format/minimal.yaml  minimal-greeting · 1 block · hash b70e47af2ac6
✓ out/authoring-spec-format/upgrade-short.yaml  upgrade-short · 2 blocks · hash 7956d69e3097
Checked 2 specs: 2 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench campaign run out/authoring-spec-format/upgrade-short.yaml --no-cache
Campaign c-02edbdef195f: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 1 criterion in 1 block of 1 spec (one_question_per_turn), none of them gating. This campaign loads no judge, so it has no verdict and counts in no pass or fail. See docs/concepts/judges.md.
✓ upgrade-short · function:acme-sales · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

The campaign id holds the clock, so it differs on each run. The criterion has no verdict because no judge is loaded; the block still passes on its machine checks.

### A spec written for a newer format

`schema_version` says which spec format a file is written for. This driftbench reads format 1. A spec that says 1 loads as before; its hash changes, because the key is now part of the spec. A spec that says 2 is refused with one error, before any of its keys is read:

```yaml file=out/authoring-spec-format/formats/current.yaml
schema_version: 1
id: format-current
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address']
```

```yaml file=out/authoring-spec-format/newer/next.yaml
schema_version: 2
id: format-next
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    persona: terse-regular
    expect:
      must: ['email address']
```

Three more specs write the version in a form the schema refuses: `0`, `1.5` and the text `'1'`:

```yaml file=out/authoring-spec-format/malformed/zero.yaml
schema_version: 0
id: format-zero
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address']
```

```yaml file=out/authoring-spec-format/malformed/half.yaml
schema_version: 1.5
id: format-half
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address']
```

```yaml file=out/authoring-spec-format/malformed/text.yaml
schema_version: '1'
id: format-text
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address']
```

```sh
driftbench spec validate out/authoring-spec-format/formats/current.yaml
driftbench spec validate out/authoring-spec-format/newer/next.yaml # exit 1
driftbench spec validate out/authoring-spec-format/malformed # exit 1
```

```text
$ driftbench spec validate out/authoring-spec-format/formats/current.yaml
✓ out/authoring-spec-format/formats/current.yaml  format-current · 1 block · hash 09681194e96f
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench spec validate out/authoring-spec-format/newer/next.yaml
✗ out/authoring-spec-format/newer/next.yaml
    schema_version  SPEC_SCHEMA_VERSION  the spec is written for spec format version 2; this driftbench reads version 1 and older: upgrade driftbench
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
$ driftbench spec validate out/authoring-spec-format/malformed
✗ out/authoring-spec-format/malformed/half.yaml
    schema_version  SCHEMA_INVALID_TYPE  Invalid input: expected int, received number
✗ out/authoring-spec-format/malformed/text.yaml
    schema_version  SCHEMA_INVALID_TYPE  Invalid input: expected number, received string
✗ out/authoring-spec-format/malformed/zero.yaml
    schema_version  SCHEMA_TOO_SMALL  Too small: expected number to be >=1
Checked 3 specs: 0 valid, 3 invalid, 0 warnings.
(exit 1)
```

The second spec carries a block key, `persona`, that format 1 does not know. driftbench names the format, not that key, so the fix is plain: upgrade driftbench, or remove `schema_version` and the newer keys.

## Common errors

Four broken files in `out/authoring-spec-format/bad/`:

```
$ driftbench spec validate out/authoring-spec-format/bad
✗ out/authoring-spec-format/bad/alias.yaml
    ledger_seed  SPEC_ALIAS_CONFLICT  set `ledger_seed` or `given.ledger`, not both
✗ out/authoring-spec-format/bad/empty.yaml
    blocks  SCHEMA_TOO_SMALL  Too small: expected array to have >=1 items
✗ out/authoring-spec-format/bad/keys.yaml
    id  SCHEMA_INVALID_FORMAT  Invalid string: must match pattern /^[A-Za-z0-9][A-Za-z0-9._-]*$/
    kind  SCHEMA_INVALID_VALUE  Invalid option: expected one of "conversation"|"task"
    blocks  SCHEMA_INVALID_TYPE  Invalid input: expected array, missing
    (file)  SCHEMA_UNRECOGNIZED_KEYS  unknown key: owner
✗ out/authoring-spec-format/bad/list.yaml
    (file)  SPEC_NOT_OBJECT  a spec file must hold one mapping (an object) at the top level
    (file)  SCHEMA_INVALID_TYPE  Invalid input: expected object, received array
Checked 4 specs: 0 valid, 4 invalid, 0 warnings.
(exit 1)
```

| Message | Cause | Fix |
|---|---|---|
| `SPEC_ALIAS_CONFLICT` | a shorthand and its long form are both set | keep one: `ledger_seed` or `given.ledger`; `workspace_seed` or `given.world.workspace` |
| `SCHEMA_TOO_SMALL` on `blocks` | an empty block list | add at least one block |
| `SCHEMA_INVALID_FORMAT` on `id` | spaces or other characters in the id | letters, digits, dots, underscores and hyphens, starting with a letter or digit |
| `SCHEMA_INVALID_VALUE` on `kind` | a kind other than the two | `conversation` or `task` |
| `SCHEMA_UNRECOGNIZED_KEYS` | a key the format does not know | move free data under `metadata` or `tags` |
| `SPEC_NOT_OBJECT` | the file holds a list or a scalar | one mapping per file |
| `schema_version  SPEC_SCHEMA_VERSION  the spec is written for spec format version 2; this driftbench reads version 1 and older: upgrade driftbench` | `schema_version` is a whole number above the format this driftbench reads | upgrade driftbench, or write the spec in format 1 |
| `schema_version  SCHEMA_TOO_SMALL  Too small: expected number to be >=1` | `schema_version: 0` | a whole number, 1 or more |
| `schema_version  SCHEMA_INVALID_TYPE  Invalid input: expected int, received number` | `schema_version: 1.5` | a whole number |
| `schema_version  SCHEMA_INVALID_TYPE  Invalid input: expected number, received string` | `schema_version: '1'`, a quoted number | write the number with no quotes |
| `SPEC_PARSE` | the YAML or JSON does not parse, a key is repeated, or the path does not exist | fix the syntax or the path |
| `OBJECT_UNKNOWN` | `uses` names an object no layer defines; the message lists the layers searched | write the object file, or fix the id |
| `OBJECT_ITEM_UNKNOWN` | an inline or file object operates on an item its parent does not hold; the message lists the parent's items | fix the item id, or add it with `add: true`, `title`, `when`, `effect` and `impl` |
| `OBJECT_CYCLE` | objects extend each other in a loop; the message prints the loop | break the chain |
| `OBJECT_PARAMS_INVALID`, `OBJECT_IMPL_UNKNOWN` | an item's params do not fit its implementation, or no builtin or plugin provides it | fix the params at the path named, or load the plugin |
