---
title: Objects, the rule sets you can tailor
summary: Every tailorable rule set is an object with a kind, an id and addressable items; list them, see which layer set each value, start an override, check it, compare two, version one, and migrate old persona files.
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
  - authoring-rule-files
  - core-configuration
  - core-project-layout
  - authoring-personas
  - running-plugins
next:
  - authoring-rule-files
---

## What it is

An object is one rule set driftbench applies, written as data: a policy (`policy/value-check`,
`policy/blame`, `policy/gating`, ...), a `check-set`, a `diagnostic`, a `judge-council`, a
`prompt-template`, a `persona`, a `scenario`, a `run-profile`. Each object has a `kind`, an `id`, and a
list of `items`, one per rule, each with its own `id`. A verdict will name the object and the item that
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
Every key and every operation: see authoring-rule-files.

Objects come from layers, weakest first; a stronger layer wins:

| Layer | Where | Example |
|---|---|---|
| shipped | inside driftbench, or given by a plugin; immutable | `policy/value-check:default` |
| project | `driftbench/<kind>/<id>.yaml` beside `driftbench.yaml`, and its `objects:` key | `driftbench/policy/value-check/acme.yaml` |
| suite | `_driftbench/<kind>/<id>.yaml` in a spec folder, and `_driftbench/uses.yaml` | `specs/_driftbench/uses.yaml` |
| spec | `uses:` at the top of a spec | `uses: { value_check: acme }` |
| block | `uses:` on a block, an id or an inline object that extends one | `uses: { value_check: { extends: acme, items: [...] } }` |
| command line | `--use <kind>/<id>`, `--set <kind>[/<id>]#<item>.<param>=<value>`, on `object explain` | `--set policy/value-check#rung4_exact.case_insensitive=true` |

The project layer is the folder that holds `driftbench.yaml`, the nearest one above the spec (or the
working folder for `object list`, `show`, `diff`, `init` and `validate`). `uses` names objects by role:
`value_check`, `blame`, `placement`, `links`, `selection`, `gating`, `stats`, `check_set`, `judges` and
`diagnostics`. A role no layer names uses the shipped `default` of its kind, when one exists. `uses` never
enters a block's cache key: changing it re-scores stored runs and never reruns the agent.

In this release, no object and no implementation is shipped, and no run reads the objects yet. They are
read and checked when a spec loads, and these commands show them. An item needs an implementation only while
it is enabled, so an object of disabled items loads; a plugin gives implementations (see running-plugins).

## When to use it

* You want one rule of a policy to behave differently for your project: `object init` a file that
  extends it, then change that one item.
* A result surprises you and you want to know which rule produced it and where its value was set:
  `object explain --at <spec>#<block>`.
* You want to try a value before you write it in a file: `object explain` with `--set`.
* Before committing an object, or in CI: `object validate`.
* You changed an override and want to see what it changes against its parent: `object diff`.
* You have persona files in the old one-file shape: `object migrate persona` splits them into a persona, a
  scenario and a situational block.
* You want an immutable, numbered version of an object in the store: `object push`.

Do not copy a shipped object and edit the copy. The file `object init` writes extends the parent, so a later
change of the parent still reaches you. Do not use `object push` to make a run use an object:
no run command reads a pushed object version yet.

## Commands and every option

Every command reads the objects the working folder sees, read afresh on each command. Every command also
takes the global options (see core-global-options), and `--plugin` adds the kinds, implementations and
objects of a plugin. A missing required option or argument, or an unknown option, exits 2 with a usage line.

### driftbench object list

```
driftbench object list [kind] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `[kind]` | only objects of this kind, such as `policy/blame` | every kind |
| `--json` | print one JSON document | off |

One line per kind and id, for the strongest definition only. It shows the kind, the id, the layer, the first 8
hex of the hash of the resolved object, and its file (empty for a shipped object). `(over N weaker)` follows when a stronger
layer shadows N other definitions of the same kind and id. A definition that does not resolve shows
`✗ <reason>` in place of the hash. A file that does not load at all is printed after the list, as
`✗ <reason>`. With no object: `No object is visible here.`, or `No object of kind <kind> is visible here.`

Exit 0; 1 when an object or a file is refused; 2 on an unknown kind.

### driftbench object show

```
driftbench object show <kind>/<id> [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<kind>/<id>` (required) | the object, such as `policy/value-check/acme`. The kind is the longest known kind the text starts with | none |
| `--json` | print one JSON document | off |

Prints the object as `object explain` does: a header and one row per item. A last line names the layer and
file that define it, then `extends` with its chain of parents, nearest first.

Exit 0; 2 when the object does not resolve, for any reason.

### driftbench object explain

```
driftbench object explain <kind> --at <spec>[#<block>] [--use <kind>/<id>]... [--set <kind>[/<id>]#<item>.<param>=<value>]... [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<kind>` (required) | the kind, such as `policy/value-check` | none |
| `--at <spec>[#<block>]` (required) | the spec file, and after `#` one block: its `id`, or `blocks.<n>` (or `<n>`) for the block at place n from 0. Without `#<block>`: the object the spec layer gives | none |
| `--use <kind>/<id>` | the command-line layer: use this object for its kind, whatever the spec and the folders say. Repeat it for several kinds; one kind twice is refused | none |
| `--set <kind>[/<id>]#<item>.<param>=<value>` | the command-line layer: set one parameter of one item, on top of the object the block uses. With `/<id>`, only when that object is the one used. The value is read as YAML: `0.3`, `true`, `[a, b]`. A dotted param sets a nested key. Repeatable | none |
| `--json` | print one JSON array, one entry per object of the kind | off |

The spec is loaded first, so a spec that does not load prints its errors.

Exit 0, also when no object of the kind applies. Exit 1 when an object, `--use` or `--set` does not
resolve. Exit 2 on an unknown kind, a spec that does not load, or an unknown block.

### driftbench object diff

```
driftbench object diff <a> <b> [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<a>`, `<b>` (required) | two objects of one kind, each `<kind>/<id>` or the path of an object file. A file is read at the project layer, against the objects its folder sees | none |
| `--json` | print one JSON document | off |

Compares the resolved objects item by item, the order of the items they share, and the object-level
`params`.

Exit 0 when they are the same; 1 when they differ; 2 when one does not resolve, or when they are of two kinds.

### driftbench object init

```
driftbench object init <kind> <id> --from <parent> [--out <file>]
```

| Option | Meaning | Default |
|---|---|---|
| `<kind>`, `<id>` (required) | the kind and the id of the new object | none |
| `--from <parent>` (required) | the id of the object it extends, of the same kind | none |
| `--out <file>` | where to write it. A file elsewhere than `driftbench/<kind>/<id>.yaml` is not read as a project object | `driftbench/<kind>/<id>.yaml` |

Writes an object that extends the parent and changes nothing: `items: []`. Every item of the parent follows as a
comment: its title, `enabled`, its `when`, `effect` and `params` when they hold anything, and its `impl`.
The parent's order closes the file, as a comment. Uncomment an item, and keep its `id` and the fields to change.

Exit 0. Exit 2 on an unknown kind, an id the kind holds at any layer, a parent that does not resolve, or a
file that already exists.

### driftbench object validate

```
driftbench object validate [paths...] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `[paths...]` | object files, or folders whose `*.yaml` and `*.yml` files are each an object. Each file is checked at the project layer, against the objects its folder sees | every object the working folder sees, and every file of `driftbench/` and the suite folders that does not load |
| `--json` | print one JSON document | off |

Checks the schema, the `extends` chain, the items, the order, the implementations of enabled items and their
params.

Exit 0 when every object is valid; 1 when one is refused; 2 when a path cannot be read.

### driftbench object graph

```
driftbench object graph <spec> [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<spec>` (required) | the spec file | none |
| `--json` | print one JSON document | off |

For each block: each object it uses, the layer and place that named it, and its parents. Roles no layer names
use the shipped `default` of their kind, when one exists; else the block shows `no object`.

Exit 0; 1 when an object does not resolve; 2 when the spec does not load.

### driftbench object migrate persona

```
driftbench object migrate persona <files...> [--out <folder>]
```

| Option | Meaning | Default |
|---|---|---|
| `<files...>` (required) | old persona files | none |
| `--out <folder>` | the project folder the new files go under | `.` |

Reads every file before it writes any. For each persona `<id>` it writes three files under the folder:

* `driftbench/persona/<id>.yaml`: a `persona` object, with `name`, `persona` and `stop_token` in its `params`.
* `driftbench/scenario/<id>.yaml`: a `scenario` object, with `goal` in its `params`.
* `situational/<id>.yaml`: the situational block. `spec` is the old file's spec, relative to this file.
  `simulated_user` holds `scenario`, `personas` (one id) and `situational.holds`. Each fact is one entry of
  `holds`: `slot`, `value`, `reveal: on_request`, and `asked_by` with the old ask patterns.

It writes a `driftbench.yaml` holding one comment when the folder has none, so the new objects are found.
Files that exist are replaced.

`simulate --persona` and `campaign run --driver simulated --persona` take a situational block in place of a
persona file. Its persona and scenario are found by id in the project layer of the block's folder. They are
composed back into the persona the old file gave, so it plays the same conversation.

Exit 0; 2 when a file does not load, two files hold one persona id, or a file cannot be written.

### driftbench object push

```
driftbench object push <kind> <path> --name <name> --store <file> [--note <text>] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<kind>` (required) | the kind of every object in `<path>` | none |
| `<path>` (required) | an object file, or a folder of them | none |
| `--name <name>` (required) | the registry name: letters, digits, `.`, `_` and `-` | none |
| `--store <file>` (required) | the store that keeps the versions; created when missing | none |
| `--note <text>` | a note kept with the version | none |
| `--json` | print the version record | off |

Checks every `*.yaml` and `*.yml` file first; one invalid file and nothing is pushed. Stores them as the next
version of `<name>`, under the registry kind `object.<kind>` with `/` written as `.`, such as
`object.policy.value-check`. The same content again makes no new version.

Exit 0, also when nothing changed. Exit 1 when an object is invalid. Exit 2 on an unknown kind, an unreadable
path, a path with no object file, a store that cannot be opened, or a bad name.

## Inputs

* Object files: YAML, one object each, `kind` and `id` first. A file under `driftbench/` must sit at
  `driftbench/<kind>/<id>.yaml`. The format: authoring-rule-files, and `docs/reference/objects.md`.
* `driftbench.yaml`: the key `objects:`, a list of objects written inline at the project layer.
* Specs: `uses:` at the top or on a block, each value an object id or an inline object that extends one.
* Old persona files: the `id`, `name`, `persona`, `goal`, `facts`, `reveal_when_asked`, `stop_token` and
  `spec` shape of `examples/acme/personas`.

A minimal project object, inline in `driftbench.yaml`:

```text
objects:
  - kind: check-set
    id: base
    items:
      - { id: tone, title: Replies keep the tone, enabled: false, impl: plugin:acme-tone }
```

## Outputs and how to read them

The hash of an object is computed from its resolved content: its kind, its params and its items in order.
Its id, its labels and the file places stay out. Two objects with the same items and values have the same
hash, so an object `init` just wrote has its parent's hash. Commands print its first 8 hex.

`show` and `explain` print a header, then one row per item:

```text
policy/value-check at specs/refund.yaml#b1 -> acme@3f1c9a2b (extends base@77b0e3f1)
  exact   enabled   case_insensitive true   project driftbench/policy/value-check/acme.yaml:6
  digits  disabled  strip [ , -]            shipped
```

| Part | Meaning |
|---|---|
| `<kind> at <spec>#<block>` | the kind, and the block `explain` was asked about (absent in `show`) |
| `-> <id>@<hash>` | the object used. `(block)`, `(spec)` or `(cli)` stands for an inline object written at that layer |
| `(extends <parent>@<hash>)` | its parent |
| item, `enabled` or `disabled` | each item in its resolved order |
| value | the item's params when it has any, else its effect, in short form |
| last column | the layer that last set the item: `shipped`, or the layer and its place: `file:line` for a file, `driftbench.yaml#objects.0#items.1` for an inline project object, `blocks.1.uses.value_check.items.0` for a spec or block, `command line --set <kind>#<item>` for a flag |

`validate` prints `✓ <kind>:<id>@<hash>  <file>` per valid object and `✗ <reason>` per refusal, then
`<n> objects valid.` or `<r> of <n> objects refused.`

`diff` prints one line per item that differs: `A` added, `D` removed, `M` changed. Under an `M`, one line per
field reads `<field>: <before> -> <after>`. `order: <before> -> <after>` follows when the shared items moved.
`object params or fields: ...` follows when those differ. The last line is `<n> items differ between <a> and
<b>.` When nothing differs: `No difference between <a> and <b>: the same items, values and order.`

`graph` prints the spec id and path, then each block, by id or `blocks.<n>`. Under a block, each object is one
line: `<role> -> <kind>:<id>@<hash>  (<layer> <place>, extends <parents>)`, or `(shipped default)`.

`push` prints `Pushed <kind> <name>@<version> (hash <12 hex>): <n> files from <path>.`, or
`Unchanged: <kind> <name>@<version> already holds these <n> files.`

With `--json`:

| Command | Shape |
|---|---|
| `list` | `{ objects: [{ kind, id, layer, path, shadows, hash }], problems: [] }`; a refused row has `problem` in place of `hash` |
| `show` | `{ kind, id, ref, hash, layer, path, agent_facing, chain, params, fields, items }`; each item has `id`, `title`, `enabled`, `when`, `effect`, `params`, `impl`, `layer` and `from` |
| `explain` | a list of `{ key, set_at, place, object }`, `object` as in `show` |
| `diff` | `{ from, to, items: [{ item, status, fields }], order, params }`; `status` is `added`, `removed` or `changed`; `order` and `params` are true when they differ |
| `validate` | `{ valid, objects: [{ path, ref }] }`; a refused object has `problem` in place of `ref` |
| `graph` | `{ spec, path, blocks: [{ block, uses: [{ key, set_at, place, object, chain }] }] }` |
| `push` | the version record, with `created` false when nothing changed |

`agent_facing` is true for a kind whose change reruns the agent: `persona`, `scenario`, `persona-defaults`,
`run-profile` and `deviation-class`.

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
$ driftbench object list
policy/value-check  base  project  2368b063  driftbench.yaml#objects.0
(exit 0)
$ driftbench object init policy/value-check acme --from base
Wrote driftbench/policy/value-check/acme.yaml: policy/value-check/acme extends base@2368b063, 2 items listed.
(exit 0)
$ driftbench object validate
✓ policy/value-check:acme@2368b063  driftbench/policy/value-check/acme.yaml
✓ policy/value-check:base@2368b063  driftbench.yaml#objects.0
2 objects valid.
(exit 0)
$ driftbench object diff policy/value-check/base policy/value-check/acme
No difference between policy/value-check:base@2368b063 and policy/value-check:acme@2368b063: the same items, values and order.
(exit 0)
$ driftbench object explain policy/value-check --at examples/acme/specs/conversations/plan-upgrade.yaml
policy/value-check at examples/acme/specs/conversations/plan-upgrade.yaml: no layer names one and no shipped default exists.
(exit 0)
$ driftbench object explain policy/value-check --at examples/acme/specs/conversations/plan-upgrade.yaml  --use policy/value-check/acme
policy/value-check at examples/acme/specs/conversations/plan-upgrade.yaml -> acme@2368b063 (extends base@2368b063)
  exact   disabled    project driftbench.yaml#objects.0#items.0
  digits  disabled    project driftbench.yaml#objects.0#items.1
(exit 0)
$ driftbench object graph examples/acme/specs/conversations/plan-upgrade.yaml
acme-plan-upgrade (examples/acme/specs/conversations/plan-upgrade.yaml)
  blocks.0
    no object
  blocks.1
    no object
  blocks.2
    no object
  blocks.3
    no object
  blocks.4
    no object
(exit 0)
$ driftbench object show policy/value-check/nope
unknown object policy/value-check:nope; searched layers shipped, project, suite, spec, block, cli
(exit 2)
$ driftbench object migrate persona examples/acme/personas/sam-upgrader.yaml
Migrated sam-upgrader: driftbench/persona/sam-upgrader.yaml, driftbench/scenario/sam-upgrader.yaml, situational/sam-upgrader.yaml under <the working folder>.
(exit 0)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona situational/sam-upgrader.yaml  --recording examples/acme/personas/recordings/sam-upgrader.yaml
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
  0  user   Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  0  agent  Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?
     identify  ✓
  1  user   Sure, it's sam.rivera@example.com
  1  agent  Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?
     offer  ✓
  2  user   I'll take the unlimited one, please.
  2  agent  Here is the change: Acme Mobile S to Acme Mobile L, unlimited data for $35 a month, from your next billing cycle. Reply CONFIRM to place the order.
     recap  ✓
  3  user   Confirm
  3  agent  Done. Your order ORD-7B883C is placed: Acme Mobile L starts on your next billing cycle. Is there anything else I can help with?
     order_placed  ✓
  4  user   No, that's all. Thanks a lot!
  4  agent  You're welcome, Sam. Have a good day.
     closing  ✓
Facts given, each once asked: email.
✓ 5 of 5 blocks pass. The run ended: the spec has no block 5.
(exit 0)
$ driftbench object push policy/value-check driftbench/policy/value-check/acme.yaml --name acme --store acme.db
Pushed policy/value-check acme@1 (hash 5a388e9887aa): 1 file from driftbench/policy/value-check/acme.yaml.
(exit 0)
```

`acme` has the hash of `base`: `init` writes an override that changes nothing until you uncomment an item.
The spec names no value-check object and none is shipped yet, so the first `explain` finds none; `--use`
adds the command-line layer, which picks `acme`. The migrated persona plays the recorded conversation and
passes the same 5 blocks as the old file.

### An override that changes something

A second project object, `strict`, sets a parameter, appends to a list and moves an item. A spec uses it for
every block, and changes one parameter inline for its second block:

```yaml file=driftbench/policy/value-check/strict.yaml
kind: policy/value-check
id: strict
extends: base
items:
  - id: exact
    params: { case_insensitive: true }
  - id: digits
    params: { '+strip': ['.'] }
    before: exact
```

```yaml file=specs/strict-upgrade.yaml
# Fictional data only.
id: strict-upgrade
target: { adapter: function, agent: acme-sales }
uses: { value_check: strict }
blocks:
  - id: hello
    user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address']
  - id: email
    user: It's sam.rivera@example.com
    uses:
      value_check:
        extends: strict
        items:
          - { id: exact, params: { case_insensitive: false } }
    expect:
      must: ['Acme Mobile L']
```

A wrong item id, to see a refusal:

```yaml file=bad/typo.yaml
kind: policy/value-check
id: typo
extends: base
items:
  - id: exakt
    enabled: true
```

```sh
driftbench object show policy/value-check/strict
driftbench object diff policy/value-check/base policy/value-check/strict # exit 1
driftbench object explain policy/value-check --at specs/strict-upgrade.yaml#email
driftbench object explain policy/value-check --at specs/strict-upgrade.yaml#hello --set 'policy/value-check#digits.strip=[]'
driftbench object graph specs/strict-upgrade.yaml
driftbench object validate bad # exit 1
driftbench object explain policy/value-check --at specs/strict-upgrade.yaml#goodbye # exit 2
driftbench object explain policy/value-check --at specs/strict-upgrade.yaml --use policy/value-check/nope # exit 1
driftbench object init policy/value-check strict --from base # exit 2
```

```text
$ driftbench object show policy/value-check/strict
policy/value-check -> strict@930433d0 (extends base@2368b063)
  digits  disabled  strip [.]              project driftbench/policy/value-check/strict.yaml:7
  exact   disabled  case_insensitive true  project driftbench/policy/value-check/strict.yaml:5
project driftbench/policy/value-check/strict.yaml; extends policy/value-check:base.
(exit 0)
$ driftbench object diff policy/value-check/base policy/value-check/strict
M exact
    params: {} -> {"case_insensitive":true}
M digits
    params: {} -> {"strip":["."]}
order: exact, digits -> digits, exact
2 items differ between policy/value-check:base@2368b063 and policy/value-check:strict@930433d0.
(exit 1)
$ driftbench object explain policy/value-check --at specs/strict-upgrade.yaml#email
policy/value-check at specs/strict-upgrade.yaml#email -> (block)@cc1ed7bb (extends strict@930433d0)
  digits  disabled  strip [.]               project driftbench/policy/value-check/strict.yaml:7
  exact   disabled  case_insensitive false  block blocks.1.uses.value_check.items.0
(exit 0)
$ driftbench object explain policy/value-check --at specs/strict-upgrade.yaml#hello --set 'policy/value-check#digits.strip=[]'
policy/value-check at specs/strict-upgrade.yaml#hello -> (cli)@f1428466 (extends strict@930433d0)
  digits  disabled  strip []               cli command line --set policy/value-check#digits
  exact   disabled  case_insensitive true  project driftbench/policy/value-check/strict.yaml:5
(exit 0)
$ driftbench object graph specs/strict-upgrade.yaml
strict-upgrade (specs/strict-upgrade.yaml)
  hello
    value_check -> policy/value-check:strict@930433d0  (spec uses.value_check, extends policy/value-check:base)
  email
    value_check -> policy/value-check:(block)@cc1ed7bb  (block blocks.1.uses.value_check, extends policy/value-check:strict -> policy/value-check:base)
(exit 0)
$ driftbench object validate bad
✗ unknown item exakt in policy/value-check:typo (bad/typo.yaml:5); the parent policy/value-check:base holds exact, digits. To add a new item write add: true with title, when, effect and impl
1 of 1 object refused.
(exit 1)
$ driftbench object explain policy/value-check --at specs/strict-upgrade.yaml#goodbye
The spec strict-upgrade has no block goodbye. Its blocks: hello, email.
(exit 2)
$ driftbench object explain policy/value-check --at specs/strict-upgrade.yaml --use policy/value-check/nope
--use policy/value-check/nope: unknown object policy/value-check:nope; searched layers shipped, project, suite, spec, block, cli
(exit 1)
$ driftbench object init policy/value-check strict --from base
policy/value-check/strict already exists (project driftbench/policy/value-check/strict.yaml): pick another id.
(exit 2)
```

`show` lists `digits` before `exact`, each set at the project layer with its file and line. `diff` names the
two changed items, their params before and after, and the new order. At block `email`, `explain` shows the
inline object `(block)`, which extends `strict` and sets `case_insensitive` back to false at the block layer.
With `--set`, the `digits` row shows the empty list and the `cli` layer; the file did not change. `graph`
shows both blocks: `hello` uses `strict` from the spec layer, `email` its inline object. The last four lines
are refusals. The first lists the parent's items, the second the spec's blocks, the third the layers
searched. The fourth names an id that already exists.

## Common errors

| Message | Exit | Fix |
|---|---|---|
| `unknown item <item> in <kind>:<id> (<file>:<line>); the parent <kind>:<parent> holds <items>. To add a new item write add: true with title, when, effect and impl` | 1 from `validate` and `list`, 2 from `show` | fix the item id, or add it with `add: true`, `title`, `when`, `effect` and `impl` |
| `unknown object <kind>:<id>; searched layers shipped, project, suite, spec, block, cli` | 2 from `show`, `diff`, and from `explain` and `graph` when the spec names it (the spec does not load); 1 from `explain` when `--use` names it | no layer defines it. A project file is only read when `driftbench.yaml` is in that folder or above it |
| `<text> names no object kind; the kinds are <kinds>` | 2 | `show` and `diff` take `<kind>/<id>`: start with a known kind |
| `<kind>: name the id too, as <kind>/<id>` | 2 | add the id |
| `unknown object kind <kind>; known kinds: <kinds>` | 2 | fix the kind, or load the plugin that adds it |
| `<file>: holds <kind>:<id>, so it belongs at <kind>/<id>.yaml in <folder>` | 1 | a file under `driftbench/` whose place does not match its kind and id: move it |
| `<file>: <kind>:<id> is shipped and immutable; write an object with another id that extends it` | 1 | a project file reuses a shipped id |
| `extends cycle: <kind>:<a> -> <kind>:<b> -> <kind>:<a>` | 1 | two objects extend each other |
| `<kind>:<id>: item <item> names <impl>, which no builtin or plugin provides (<place>)` | 1 | load the plugin that provides it (`--plugin`), or disable the item |
| `<kind>:<id>: item <item> params: params.<path>: <reason> (<place>)` | 1 | a parameter of the wrong type for the item's implementation |
| `--use <text>: expected <kind>/<id>, such as policy/blame/acme` | 1 | write the kind and the id |
| `--use names <kind> twice` | 1 | keep one `--use` per kind |
| `--set <text>: expected <kind>[/<id>]#<item>.<param>=<value>, such as policy/blame#R3.recovery_ok=[asked_user]` | 1 | write the item and the param; quote the flag so the shell keeps `#` and `[ ]` |
| `The spec <id> has no block <block>. Its blocks: <blocks>.` | 2 from `explain` | name a block by its id, or `blocks.<n>` |
| `<kind>/<id> already exists (<layer> <file>): pick another id.` | 2 from `init` | pick another id |
| `<file> already exists: nothing was written.` | 2 from `init` | remove the file, or give `--out` |
| `<a> and <b> are of two kinds: diff compares objects of one kind.` | 2 from `diff` | compare objects of one kind |
| `Cannot read <path>: <reason>` | 2 from `validate` and `push` | fix the path |
| `<path> holds no object file: push a *.yaml object file or a folder of them.` | 2 from `push` | push a `.yaml` file or a folder of them |
| `<file>: holds an object of kind <kind>, not <kind>` then `Fix the invalid objects first: nothing was pushed.` | 1 from `push` | push one kind at a time |
| `"<name>" is not a registry name: use letters, digits, dots, underscores and hyphens` | 2 from `push` | change `--name` |
| `<file>: the persona <id> is also in <file>` then `Nothing was written.` | 2 from `migrate persona` | migrate files with distinct persona ids |
| `<situational file>: unknown object persona:<id>; searched layers shipped, project, suite, spec, block, cli` | 2 from `simulate` | the situational block is read in a folder whose project does not hold its persona: keep it under the folder `migrate persona --out` wrote |
| `<situational file>: simulated_user.personas must name one persona: a migrated block plays the persona it came from` | 2 from `simulate` | name exactly one persona |
