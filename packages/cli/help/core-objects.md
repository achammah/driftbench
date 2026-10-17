---
title: Objects, the rule sets you can tailor
summary: Every tailorable rule set is an object with a kind, an id and addressable items; extend a shipped one in your project, see which layer set each value, and migrate old persona files.
commands:
  - object list
  - object show
  - object explain
  - object diff
  - object init
  - object validate
  - object graph
  - object migrate persona
  - object push
see_also:
  - core-configuration
  - core-project-layout
  - authoring-personas
  - running-plugins
next:
  - core-exit-codes
---

## What it is

An object is one rule set driftbench applies, written as data: a policy (`policy/value-check`,
`policy/blame`, `policy/gating`, ...), a `check-set`, a `diagnostic`, a `judge-council`, a
`prompt-template`, a `persona`, a `scenario`, a `run-profile`. Each object has a `kind`, an `id`, and a
list of `items`, one per rule, each with its own `id`. A verdict names the object and the item that
produced it, so every rule is addressable.

You never edit a shipped object. You write an object that `extends` it and lists only what changes:

```text
kind: policy/value-check
id: acme
extends: default
items:
  - id: rung4_exact            # set: only the named fields change; params maps merge
    params: { strip_punctuation: true }
  - id: rung3_same_referent
    enabled: false             # disable; a stronger layer can enable it again
  - id: rung5_digits           # add: a new rule needs add, title, when, effect and impl
    add: true
    title: Phone numbers compare by their digits
    when: { field_type: phone }
    effect: { settles: [pass, fail] }
    impl: plugin:acme-digits
order: [rung1_outcome, rung5_digits, rung2_contract, rung3_same_referent, rung4_exact]
```

Rules checked at load, never ignored: an operation on an item id the parent does not hold is refused, with
the parent's items listed; `params` are checked against the item's implementation; `order` must list every
enabled item once (or one item moves with `before: <id>` or `after: <id>`, not both in one file); a list in
`params` replaces the parent's list, `+key: [values]` appends to it and `-key: [values]` removes from it.

Objects come from layers, weakest first; a stronger layer wins:

| Layer | Where | Example |
|---|---|---|
| shipped | inside driftbench, immutable | `policy/value-check:default` |
| project | `driftbench/<kind>/<id>.yaml` beside `driftbench.yaml`, and its `objects:` key | `driftbench/policy/value-check/acme.yaml` |
| suite | `_driftbench/<kind>/<id>.yaml` in a spec folder, and `_driftbench/uses.yaml` | `specs/_driftbench/uses.yaml` |
| spec | `uses:` at the top of a spec | `uses: { value_check: acme }` |
| block | `uses:` on a block, an id or an inline object that extends one | `uses: { value_check: { extends: acme, items: [...] } }` |
| command line | `--use <kind>/<id>`, `--set <kind>[/<id>]#<item>.<param>=<value>` | `--set policy/value-check#rung4_exact.case_insensitive=true` |

The project layer is the folder that holds `driftbench.yaml`, the nearest one above the spec (or the
working folder for `object list`, `show`, `diff`, `init` and `validate`). `uses` names objects by role:
`value_check`, `blame`, `placement`, `links`, `selection`, `gating`, `stats`, `check_set`, `judges` and
`diagnostics`. A role no layer names uses the shipped `default` of its kind. `uses` never enters a block's
cache key: changing it re-scores stored runs and never reruns the agent.

## When to use it

* You want one rule of a shipped policy to behave differently for your project: `object init` a file that
  extends it, then change that one item.
* A result surprises you and you want to know which rule produced it and where its value was set:
  `object explain --at <spec>#<block>`.
* Before committing an object, or in CI: `object validate`.
* You have persona files in the old one-file shape: `object migrate persona` splits them into a persona, a
  scenario and a situational block.
* You want an immutable, numbered version of an object in the store: `object push`.

## Commands and every option

| Command | Does | Options |
|---|---|---|
| `object list [kind]` | every object the working folder sees: kind, id, layer, the first 8 hex of its hash, its file; `(over N weaker)` when a stronger layer shadows another definition | `--json` |
| `object show <kind>/<id>` | the resolved object: each item, enabled or disabled, its value, the layer and the file and line that set it, then its `extends` chain | `--json` |
| `object explain <kind> --at <spec>[#<block>]` | the object one block uses for a kind (without `#<block>`, the spec layer), each item with the layer, file and line that set it | `--at <spec>[#<block>]` (required): the block by its id, or `blocks.<n>` for the block at place n from 0; `--use <kind>/<id>` and `--set <kind>[/<id>]#<item>.<param>=<value>`, each repeatable, add the command-line layer; `--json` |
| `object diff <a> <b>` | the items two objects of one kind add, remove or change, field by field, and a changed order; each side is `<kind>/<id>` or an object file | `--json` |
| `object init <kind> <id> --from <parent>` | writes a project object that extends `<parent>` and changes nothing; every item of the parent is listed as a comment with its current value | `--from <parent>` (required); `--out <file>`, default `driftbench/<kind>/<id>.yaml` |
| `object validate [paths...]` | without paths: every object the working folder sees, and every file under `driftbench/` that does not load; with paths: each object file, or each `*.yaml` under a folder, against the objects its folder sees | `--json` |
| `object graph <spec>` | for each block: each object it uses, the layer and place that named it, and its `extends` chain | `--json` |
| `object migrate persona <files...>` | splits each old persona file into `driftbench/persona/<id>.yaml`, `driftbench/scenario/<id>.yaml` and `situational/<id>.yaml`; writes an empty `driftbench.yaml` when the folder has none | `--out <folder>`, default `.` |
| `object push <kind> <path> --name <name>` | stores an object file, or a folder of them, as the next version of `<name>` in the store's registry, under the registry kind `object.<kind>` (`/` written as `.`); the same content again changes nothing | `--name <name>` and `--store <file>` (both required); `--note <text>`; `--json` |

`object migrate persona` reads every file before it writes any: one file that does not load, or two files
with one persona id, and nothing is written. It also writes nothing when a target file already exists, and nothing when
`--out` lies inside another project (a folder below a `driftbench.yaml`): run it from the project root or pass the root as `--out`. `simulate --persona` and `campaign run --driver simulated --persona` take a
situational block where they take a persona file: its persona and scenario are found by id in the
project layer and composed back into the persona the old file gave, so it plays the same conversation.

## Inputs

* Object files: YAML, one object each, `kind` and `id` first. A file under `driftbench/` must sit at
  `driftbench/<kind>/<id>.yaml`. Every field is in `docs/reference/objects.md`.
* `driftbench.yaml`: the key `objects:`, a list of objects written inline at the project layer.
* Specs: `uses:` at the top or on a block, each value an object id or an inline object that extends one.
* Old persona files: the `id`, `name`, `persona`, `goal`, `facts`, `reveal_when_asked`, `stop_token` and
  `spec` shape of `examples/acme/personas`.

## Outputs and how to read them

`list`, `show`, `explain` and `graph` print one line per object or item. A hash is the first 8 hex of the
SHA-256 of the resolved content: two objects with the same items and values have the same hash whatever
their id, so an object `init` just wrote has its parent's hash. `explain` names, for every item, the layer
that last set it: `shipped`, or the layer with the file and line (`project driftbench/policy/value-check/acme.yaml:6`),
the spec place (`block blocks.0.uses.value_check.items.0`) or the flag (`cli command line --set ...`).

`validate` prints `✓ <kind>:<id>@<hash>  <file>` per valid object and `✗ <reason>` per refusal, then a
count. `diff` prints `M`, `A` and `D` per item and each changed field as `before -> after`.

Exit codes: `validate` and `list` exit 1 when an object is refused, `diff` exits 1 when the objects
differ, `push` exits 1 when a file is invalid and pushes nothing; every command exits 2 on an unknown kind or
object, a missing file or a bad option.

## Worked example

A project object written inline in `driftbench.yaml`, a second one that extends it, checked, compared and
explained at the Acme plan upgrade spec, then the Acme persona of that spec migrated and replayed from its
recording. No model is called. The two rules of `base` are disabled, so no implementation is needed to
load them: an enabled item needs one, from driftbench or from a plugin.

```yaml file=driftbench.yaml
# The project config. Its objects key holds project objects written inline.
objects:
  - kind: policy/value-check
    id: base
    description: The rules this project compares a value the agent wrote with.
    items:
      - id: exact
        title: The value equals the expected one
        enabled: false
        impl: builtin:value-check/exact
      - id: digits
        title: Phone numbers compare by their digits
        enabled: false
        impl: builtin:value-check/digits
```

```sh
driftbench object list
driftbench object init policy/value-check acme --from base
driftbench object validate
driftbench object diff policy/value-check/base policy/value-check/acme
driftbench object explain policy/value-check --at examples/acme/specs/conversations/plan-upgrade.yaml
driftbench object explain policy/value-check --at examples/acme/specs/conversations/plan-upgrade.yaml \
  --use policy/value-check/acme
driftbench object graph examples/acme/specs/conversations/plan-upgrade.yaml
driftbench object show policy/value-check/nope  # exit 2
driftbench object migrate persona examples/acme/personas/sam-upgrader.yaml
driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona situational/sam-upgrader.yaml \
  --recording examples/acme/personas/recordings/sam-upgrader.yaml
driftbench object push policy/value-check driftbench/policy/value-check/acme.yaml --name acme --store acme.db
```

```text
policy/value-check  base  project  <hash>  driftbench.yaml#objects.0
Wrote driftbench/policy/value-check/acme.yaml: policy/value-check/acme extends base@<hash>, 2 items listed.
✓ policy/value-check:acme@<hash>  driftbench/policy/value-check/acme.yaml
✓ policy/value-check:base@<hash>  driftbench.yaml#objects.0
2 objects valid.
No difference between policy/value-check:base@<hash> and policy/value-check:acme@<hash>: the same items, values and order.
policy/value-check at examples/acme/specs/conversations/plan-upgrade.yaml: no layer names one and no shipped default exists.
policy/value-check at examples/acme/specs/conversations/plan-upgrade.yaml -> acme@<hash> (extends base@<hash>)
  exact   disabled    project driftbench.yaml#objects.0#items.0
  digits  disabled    project driftbench.yaml#objects.0#items.1
acme-plan-upgrade (examples/acme/specs/conversations/plan-upgrade.yaml)
  blocks.0
    no object
...
unknown object policy/value-check:nope; searched layers shipped, project, suite, spec, block, cli
Migrated sam-upgrader: driftbench/persona/sam-upgrader.yaml, driftbench/scenario/sam-upgrader.yaml, situational/sam-upgrader.yaml under ..
...
✓ 5 of 5 blocks pass.
Pushed policy/value-check acme@1 (hash <hash>): 1 file from driftbench/policy/value-check/acme.yaml.
```

`acme` has the hash of `base`: `init` writes an override that changes nothing until you uncomment an item.
The spec names no value-check object and none is shipped yet, so the first `explain` finds none; `--use`
adds the command-line layer, which picks `acme`. The migrated persona plays the recorded conversation and
passes the same 5 blocks as the old file.

## Common errors

* `unknown item <id> in <kind>:<id> (<file>:<line>); the parent <kind>:<parent> holds ...` (exit 1 from
  `validate`): a misspelled item id. To add a new item, write `add: true` with title, when, effect and impl.
* `unknown object <kind>:<id>; searched layers shipped, project, suite, spec, block, cli` (exit 2): no layer
  defines it. A project file is only read when `driftbench.yaml` is in that folder or above it.
* `<file>: holds <kind>:<id>, so it belongs at <kind>/<id>.yaml in <folder>`: a file under `driftbench/`
  whose place does not match its kind and id.
* `<kind>:<id> is shipped and immutable; write an object with another id that extends it`: a project file
  reuses a shipped id.
* `extends cycle: a -> b -> a`: two objects extend each other.
* `<kind>:<id>: item <item> names <impl>, which no builtin or plugin provides`: load the plugin that
  provides it (`--plugin`), or disable the item.
* `<kind>:<id>: item <item> params: ...`: a parameter of the wrong type for the item's implementation.
* `<kind>/<id> already exists (...): pick another id.` (exit 2 from `init`).
* `The spec <id> has no block <block>. Its blocks: ...` (exit 2 from `explain`).
* `<file>: holds an object of kind <kind>, not <kind>` then `Fix the invalid objects first: nothing was
  pushed.` (exit 1 from `push`).
