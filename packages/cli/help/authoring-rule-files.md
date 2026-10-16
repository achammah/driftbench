---
title: Rule files
summary: 'Write a rule file: an object that extends another and changes one rule at a time. Where driftbench finds it, and how `uses` picks it.'
commands:
  - spec validate
see_also:
  - authoring-spec-format
  - authoring-blocks
  - authoring-spec-check
  - core-configuration
next:
  - authoring-spec-check
---

## What it is

Every set of rules driftbench applies can be written as data, in a rule file. A rule file holds one object:

- `kind`: what the rules decide, such as `policy/value-check` or `check-set`.
- `id`: its name within the kind, such as `default` or `strict`.
- `items`: the rules, one item each, each with its own `id`.

An object can `extends` another object of the same kind. It then lists only what changes, item by item. The object it extends is its parent. A chain of parents ends at a root object, which lists every item in full.

A spec or a block names the objects it uses under `uses`. An object can be found in several places, called layers. A stronger layer wins.

Every refusal is a load error, never a silent skip. That holds for an unknown item or object, a loop of parents, a wrong order, a missing implementation and a parameter of the wrong type.

In this release, objects are read and checked when a spec loads, and `uses` enters the spec hash. No run reads them yet: a `check_set` named under `uses` does not change which checks run. No object and no implementation is shipped yet, so a rule file can only enable an item whose implementation a plugin provides (see running-plugins).

### The kinds

| Kind | What it decides | `uses` key |
|---|---|---|
| `policy/value-check` | when a value the agent wrote is the right value | `value_check` |
| `policy/blame` | who a failure is attributed to, and where its fix goes | `blame` |
| `policy/placement` | where a fix goes, by how often a mistake recurs | `placement` |
| `policy/links` | how blocks link to prompt units, and when a link is stale | `links` |
| `policy/selection` | which blocks a change selects | `selection` |
| `policy/gating` | what not_run, blocked and inconclusive do to ci | `gating` |
| `policy/stats` | which interval is the headline | `stats` |
| `check-set` | the machine checks and their order | `check_set` |
| `judge-council` | the judges, their mode, assignment and escalation | `judges` |
| `diagnostic` | a procedure that runs after the checks and writes a diagnosis; its items are named `steps` | `diagnostics` (a list) |
| `prompt-template` | a text a model reads, with named parts | none |
| `deviation-class`, `persona`, `scenario`, `persona-defaults`, `run-profile` | what the agent receives | none |

The last row changes what the agent receives, so `uses` never names it: a change there must rerun the agent. Every kind `uses` names only changes how stored results are scored.

### The layers

From weakest to strongest:

| Layer | Where |
|---|---|
| shipped | inside driftbench. Never edited: extend it instead. |
| project | `driftbench/<kind>/<id>.yaml` beside `driftbench.yaml`, and the `objects:` list of `driftbench.yaml` |
| suite | `_driftbench/<kind>/<id>.yaml` in a spec folder or a folder above it, up to the project. A nearer folder is stronger. |
| spec | `uses:` at the top of a spec |
| block | `uses:` on a block |
| command line | flags of the object commands, where they exist |

The project is the nearest folder above the spec that holds `driftbench.yaml`. Without one, the search stops at the folder that holds `.git`, and only suite folders count.

A `uses.yaml` file in a project `driftbench/` folder or in a suite `_driftbench/` folder sets `uses` for every spec below it. For each `uses` key, the strongest layer that sets it wins: the block, then the spec, then the nearest suite `uses.yaml`, then the project `uses.yaml`. A key no layer sets uses the shipped object `default` of its kind, when one exists.

## When to use it

- One rule of a policy must behave differently for your project: write an object that extends the policy and changes that one item.
- One suite needs a stricter rule than the rest: put the object in that suite's `_driftbench/` folder, or name it in its `uses.yaml`.
- One block needs one parameter changed: write an inline object under that block's `uses`.

Do not use it to change what the agent receives. A persona or a run profile is never named under `uses`.

Do not copy a parent and edit the copy. Extend it, so a later change to the parent still reaches you, and every refusal names the parent's items.

## Commands and every option

The rule files have no command of their own in this release. Every command that loads specs reads them: `spec validate`, `spec lint`, `campaign run` and the others. `spec validate` is the way to check them: a spec whose objects do not resolve is invalid.

```
driftbench spec validate [options] <paths...>
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | spec files or folders | none |
| `--json` | print one JSON document | off |

Exit 0 when every spec is valid, 1 when one is invalid. Its other codes are in authoring-spec-check.

`spec validate` and every folder search skip `_driftbench/` folders, and a `driftbench/` folder that sits beside a `driftbench.yaml`: rule files are never read as specs.

## Inputs

### A root object

A root object has no `extends`, or `extends: null`. Each item needs `id`, `title` and `impl`.

```text
kind: policy/value-check
id: base
description: The value rules of this project.
params: { locale: en }
items:
  - id: exact
    title: The value equals the expected one
    enabled: false
    params: { case_insensitive: false }
    impl: builtin:value-check/exact
```

### Object keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kind` | text | yes | one of the kinds above, or a kind a plugin added. Lower case, one optional `/` group. |
| `id` | text | yes | unique within the kind and the layer. Letters, digits, `.`, `_`, `-`, and `/` between groups, such as `judge/default`. |
| `version` | text or number | no | a free label. The content hash, not this label, is the identity. |
| `extends` | id | no | the parent, of the same kind. Absent or `null`: a root object. |
| `description` | text | no | what the object is for. |
| `params` | map | no | parameters shared by all items. In a child they merge into the parent's, as item params do. |
| `order` | list of item ids | no | the order of the items. See below. |
| `items` | list | no | full items in a root object; item operations in a child. A `diagnostic` names this list `steps`. |

Any other top-level key is refused, unless the kind declares it.

### Item keys

| Key | Type | Meaning |
|---|---|---|
| `id` | text | the item. Letters, digits, `.`, `_`, `-`. A verdict cites it. |
| `title` | text | what the rule does, in one line. Required in a root object and with `add: true`. |
| `enabled` | true or false | `false` keeps the item but leaves it out of every run. Absent means `true`. |
| `when` | map | the condition under which the rule fires, over named evidence. |
| `effect` | map | what the rule does when it fires. |
| `params` | map | typed parameters, checked against the implementation's schema. |
| `impl` | text | `builtin:<name>` or `plugin:<name>`. Required in a root object and with `add: true`. |
| `cites` | text | a source, for the reader. |
| `add` | `true` | in a child only: adds a new item. Needs `title`, `when`, `effect` and `impl`. |
| `before`, `after` | item id | in a child only: moves this item just before or just after another. |

### Operations in a child

A child lists one entry per item it changes. Each entry names an item of the parent by `id` and holds only the fields that change.

```text
kind: policy/value-check
id: strict
extends: base
items:
  - id: exact                     # set: only these fields change
    params: { case_insensitive: true }
  - id: digits                    # disable: a stronger layer can enable it again
    enabled: false
  - id: digits_only               # add: a new rule
    add: true
    title: Phone numbers compare by their digits only
    when: { field: phone }
    effect: { settles: [pass, fail] }
    impl: plugin:acme-digits
    after: exact                  # move it just after exact
```

| Operation | How you write it | What happens |
|---|---|---|
| set | the item `id` and the fields to change | each named field changes; every other field keeps the parent's value |
| disable | `enabled: false` | the item stays, out of every run. Its implementation is not checked. |
| enable | `enabled: true` | a disabled item comes back |
| replace the implementation | `impl: plugin:<name>` | the rule keeps its id, title and params, with other code |
| add | `add: true`, `title`, `when`, `effect`, `impl` | a new item, placed last unless it moves |
| move | `before: <id>` or `after: <id>` | the item moves; the rest keep the parent's order |
| reorder | `order: [ids]` at the top level | the new order. It must list every enabled item once. Disabled items may be left out: they keep their place after the listed ones. |

A file uses `order` or moves, never both.

### How `when`, `effect` and `params` merge

| You write | Effect |
|---|---|
| `key: value` | the value replaces the parent's value |
| `key: { a: 1 }` over a parent map | the maps merge, key by key, at every depth |
| `key: [x, y]` over a parent list | the list replaces the parent's list whole |
| `'+key': [x]` | appends `x` to the parent's list at `key` |
| `'-key': [x]` | removes every `x` from the parent's list at `key` |
| `'-key': null` | removes `key` |

Quote a key that starts with `+` or `-`.

### `uses` in a spec or a block

```text
uses:
  value_check: strict                 # an object id
  diagnostics: [value-mismatch]       # a list of diagnostic ids
blocks:
  - id: email
    user: It's sam.rivera@example.com
    uses:
      value_check:                    # an inline object, for this block only
        extends: strict
        items:
          - { id: exact, params: { case_insensitive: false } }
```

An inline object takes `extends` (required), `items`, `order` and `params`. A block's key replaces the spec's key of the same name, `diagnostics` included: the lists are not joined.

The spec hash records `uses`. The block cache key and the re-judge compatibility hash leave it out, so a change of `uses` never reruns the agent.

### `objects:` in `driftbench.yaml`

A list of whole objects, at the project layer, each as it would be written in its own file. In this release, `report` and `ci` refuse this key as unknown (exit 2). Use the folder form `driftbench/<kind>/<id>.yaml` in a project that runs `report` or `ci`.

## Outputs and how to read them

A rule file prints nothing by itself. `spec validate` shows its effect:

- A spec whose objects all resolve is valid, as usual: `✓ <path>  <id> · <n> blocks · hash <12 hex>`. A spec with `uses` has a new spec hash, and its block cache keys are unchanged.
- A spec whose objects do not resolve is invalid: `✗ <path>`, then one line per problem: `    <place>  <CODE>  spec <spec id>: <message>`. When a block names the object, `block <block id>` follows the spec id. A block with no id shows its place from 0. The place is `uses.<key>` or `blocks.<n>.uses.<key>` when a spec names the object, and `(file)` when a rule file itself is broken.
- A broken rule file in a project or a suite folder is reported on every spec below that folder. A spec without `uses` fails too.

The codes:

| Code | Meaning |
|---|---|
| `OBJECT_INVALID` | a rule file, an inline object or a `uses.yaml` does not fit the format. Or a file sits at a path that does not match its kind and id |
| `OBJECT_KIND_UNKNOWN` | an object names a kind no package or plugin registered |
| `OBJECT_UNKNOWN` | no layer defines the object a reference names |
| `OBJECT_CYCLE` | objects extend each other in a loop |
| `OBJECT_DUPLICATE` | one kind and id are defined twice at one layer |
| `OBJECT_SHIPPED_IMMUTABLE` | a project or suite file reuses the id of a shipped object |
| `OBJECT_ITEM_UNKNOWN` | an operation, an `order`, a `before` or an `after` names an item the parent does not hold |
| `OBJECT_ITEM_EXISTS` | `add: true` names an item the parent already holds |
| `OBJECT_ITEM_INCOMPLETE` | a new item lacks `title`, `when`, `effect` or `impl`, or a root object lists an item without `title` or `impl` |
| `OBJECT_ORDER_INVALID` | an `order` leaves out an enabled item or lists one twice. Or an item moves relative to itself, or sets both `before` and `after`. Or a file sets `order` and also moves an item |
| `OBJECT_IMPL_UNKNOWN` | an enabled item names an implementation no builtin or plugin provides |
| `OBJECT_PARAMS_INVALID` | an enabled item's params do not fit its implementation's schema |

An object's identity is the hash of its resolved content: its kind, its params and its items in order. The id, the labels and the file places stay out. Two objects with the same rules have the same hash.

## Worked example

A project holds a root object and a child that extends it. Some specs use them, by id and inline; others break one rule each. The rule files are written first, then checked. No model is called. Every item of `base` is disabled, because this release ships no implementation: an enabled item needs one.

```yaml file=driftbench.yaml
# The project config. The project rule files are read from driftbench/ beside it.
```

```yaml file=driftbench/policy/value-check/base.yaml
kind: policy/value-check
id: base
description: The value rules of this project.
params: { locale: en }
items:
  - id: exact
    title: The value equals the expected one
    enabled: false
    params: { case_insensitive: false }
    impl: builtin:value-check/exact
  - id: digits
    title: Phone numbers compare by their digits
    enabled: false
    params: { strip: [' ', '-'] }
    impl: builtin:value-check/digits
```

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

A spec that uses `strict` for every block, and changes one parameter inline for its second block:

```yaml file=specs/ok/upgrade.yaml
# Fictional data only.
id: upgrade-with-rules
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
          - { id: digits, params: { '-strip': ['-'] } }
    expect:
      must: ['Acme Mobile L']
```

A suite folder whose `uses.yaml` picks `strict` for every spec below it, and a spec there that names nothing itself:

```yaml file=specs/suite/_driftbench/uses.yaml
value_check: strict
```

```yaml file=specs/suite/plain.yaml
id: suite-plain
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address']
```

Four specs that each break one rule:

```yaml file=specs/bad/unknown-item.yaml
id: bad-unknown-item
blocks:
  - user: Hi.
    uses:
      value_check: { extends: base, items: [{ id: exakt, enabled: true }] }
    expect: { must: ['Acme'] }
```

```yaml file=specs/bad/unknown-object.yaml
id: bad-unknown-object
uses: { blame: acme }
blocks:
  - user: Hi.
    expect: { must: ['Acme'] }
```

```yaml file=specs/bad/no-impl.yaml
id: bad-no-impl
uses:
  value_check: { extends: base, items: [{ id: exact, enabled: true }] }
blocks:
  - user: Hi.
    expect: { must: ['Acme'] }
```

```yaml file=specs/bad/order-and-move.yaml
id: bad-order-and-move
uses:
  value_check:
    extends: base
    order: [digits, exact]
    items: [{ id: exact, after: digits }]
blocks:
  - user: Hi.
    expect: { must: ['Acme'] }
```

A second project whose rule file sits at the wrong path. It breaks every spec below it, even one that names no object:

```yaml file=broken/driftbench.yaml
# A second project.
```

```yaml file=broken/driftbench/policy/blame/acme.yaml
kind: policy/blame
id: team
items: []
```

```yaml file=broken/specs/plain.yaml
id: broken-plain
blocks:
  - user: Hi.
    expect: { must: ['Acme'] }
```

```sh
driftbench spec validate specs/ok specs/suite
driftbench spec validate specs/bad # exit 1
driftbench spec validate broken/specs # exit 1
```

```text
$ driftbench spec validate specs/ok specs/suite
✓ specs/ok/upgrade.yaml  upgrade-with-rules · 2 blocks · hash b7655ee7eaef
✓ specs/suite/plain.yaml  suite-plain · 1 block · hash 1571b326e869
Checked 2 specs: 2 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench spec validate specs/bad
✗ specs/bad/no-impl.yaml
    uses.value_check  OBJECT_IMPL_UNKNOWN  spec bad-no-impl: uses.value_check: policy/value-check:(spec): item exact names builtin:value-check/exact, which no builtin or plugin provides (uses.value_check.items.0)
✗ specs/bad/order-and-move.yaml
    uses.value_check  OBJECT_ORDER_INVALID  spec bad-order-and-move: uses.value_check: policy/value-check:(spec): the file sets order and also moves exact with before or after; use one or the other
✗ specs/bad/unknown-item.yaml
    blocks.0.uses.value_check  OBJECT_ITEM_UNKNOWN  spec bad-unknown-item block 0: blocks.0.uses.value_check: unknown item exakt in policy/value-check:(block) (blocks.0.uses.value_check.items.0); the parent policy/value-check:base holds exact, digits. To add a new item write add: true with title, when, effect and impl
✗ specs/bad/unknown-object.yaml
    uses.blame  OBJECT_UNKNOWN  spec bad-unknown-object: uses.blame: unknown object policy/blame:acme; searched layers shipped, project, suite, spec, block, cli
Checked 4 specs: 0 valid, 4 invalid, 0 warnings.
(exit 1)
$ driftbench spec validate broken/specs
✗ broken/specs/plain.yaml
    (file)  OBJECT_INVALID  spec broken-plain: broken/driftbench/policy/blame/acme.yaml: holds policy/blame:team, so it belongs at policy/blame/team.yaml in broken/driftbench
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
```

The first two specs are valid, and `spec validate` skips the `_driftbench` folder. The spec hash of `upgrade-with-rules` records its `uses`; its block cache keys are the ones it would have without `uses`. Each bad spec names its problem, with the parent's items where an item is unknown. The `broken` project fails its plain spec, because its only rule file belongs at `policy/blame/team.yaml`. The wrong-path message names the rule file by its absolute path; the output above shows it relative to the working folder.

## Common errors

| Message | Code | Fix |
|---|---|---|
| `unknown item <item> in <kind>:<id> (<place>); the parent <kind>:<parent> holds <items>. To add a new item write add: true with title, when, effect and impl` | `OBJECT_ITEM_UNKNOWN` | fix the item id, or add it with `add: true` and its four fields |
| `unknown object <kind>:<id>; searched layers shipped, project, suite, spec, block, cli` | `OBJECT_UNKNOWN` | write the rule file, or fix the id. A project folder is read only when `driftbench.yaml` sits beside it. |
| `<place>: the new item <item> needs <fields> (add: true needs title, when, effect and impl)` | `OBJECT_ITEM_INCOMPLETE` | write the missing fields |
| `<place>: add on item <item>, which <kind>:<parent> already holds; drop add: true to change it` | `OBJECT_ITEM_EXISTS` | remove `add: true` |
| `<kind>:<id>: item <item> names <impl>, which no builtin or plugin provides (<place>)` | `OBJECT_IMPL_UNKNOWN` | load the plugin that provides it, or keep the item disabled |
| `<kind>:<id>: item <item> params: params.<path>: <reason> (<place>)` | `OBJECT_PARAMS_INVALID` | fix the parameter at the path named |
| `<kind>:<id>: the file sets order and also moves <items> with before or after; use one or the other` | `OBJECT_ORDER_INVALID` | keep `order`, or keep the moves |
| `<kind>:<id>: order must list every enabled item once; it leaves out <items>` | `OBJECT_ORDER_INVALID` | list every enabled item |
| `<kind>:<id>: order lists <item> twice` | `OBJECT_ORDER_INVALID` | list it once |
| `extends cycle: <kind>:<a> -> <kind>:<b> -> <kind>:<a>` | `OBJECT_CYCLE` | break the loop: one object must extend another one, or be a root |
| `<file>: holds <kind>:<id>, so it belongs at <kind>/<id>.yaml in <folder>` | `OBJECT_INVALID` | move the file, or fix its `kind` or `id` |
| `<file>: unknown object kind <kind>; known kinds: <kinds>` | `OBJECT_KIND_UNKNOWN` | fix the kind, or load the plugin that adds it |
| `<file>: <kind>:<id> is shipped and immutable; write an object with another id that extends it` | `OBJECT_SHIPPED_IMMUTABLE` | give your object another id and `extends: <shipped id>` |
| `<file>: <kind>:<id> is defined twice (<other file>)` | `OBJECT_DUPLICATE` | keep one definition per layer |
| `<file>: items.<n>: unknown key <name> (a root object lists full items (id, title, impl): add, before and after belong to an object that extends another)` | `OBJECT_ITEM_INCOMPLETE` | write `extends: <parent>`, or remove `add`, `before` and `after` |
| `<place>: +<key> appends a list; write +<key>: [values]` | `OBJECT_INVALID` | give a list |
| `<place>: -<key> takes a list of values to remove, or null to remove the key` | `OBJECT_INVALID` | give a list, or `null` |
| `<file>: objects is a list of object definitions` | `OBJECT_INVALID` | write `objects:` in `driftbench.yaml` as a list |
| every spec of a folder fails, with a `(file)` line | any | a rule file of the project or a suite folder is broken: fix it, the message names it |
