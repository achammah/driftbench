---
title: Check sets and verdict stamps
summary: 'Which checks score a block (check-set:default, or one that extends it), and the by and resolved stamps on every stored verdict and block.'
commands: []
see_also:
  - authoring-rule-files
  - running-store
  - running-campaign-run
  - running-campaign-export-import
  - judging-machine-checks
next:
  - running-store
---

## What it is

The machine checks that score a block are an object: `check-set:default`. It holds one item per shipped check, in the order the runner applies them, then two items for the runner's own verdicts, `flow` and `ledger`. Each item's id is the name its verdicts carry, such as `must` or `tools`.

A spec or a block can name another check set with `uses.check_set`. It is an inline object that extends the default, and it can disable an item, reorder items or replace an item's implementation (topic authoring-rule-files). A disabled item writes no verdict. A disabled `flow` or `ledger` drops the runner's own verdicts.

Every stored verdict now says what produced it, in a field `by`:

| Field | Holds |
|---|---|
| `object` | the check set that scored it, as `kind:id@hash8`, such as `check-set:default@1a2b3c4d`. An inline object has the id `(spec)` or `(block)` |
| `item` | the item that ran: the check name, or `flow` or `ledger` |
| `impl` | the implementation, such as `builtin:check/must` |
| `layer` | the layer that last set the item: `shipped`, `project`, `suite`, `spec`, `block` or `cli` |

Every stored block also carries `resolved`: the objects it was scored with, and one hash over them.

| Field | Holds |
|---|---|
| `objects[].key` | the `uses` key, such as `check_set` |
| `objects[].kind`, `objects[].id` | the object, such as `check-set` and `default` |
| `objects[].hash` | the object's content hash |
| `objects[].setAt` | the layer whose reference chose it; `shipped` when no layer named one |
| `hash` | one hash over `objects`: equal objects give equal hashes, run after run |

A check a program passes that no item names still runs, after the items. It is stamped from `check-set:(caller)@<hash8>` at layer `cli`.

Nothing else changes. Spec hashes, block cache keys and cassettes stay as they were. Under the default check set no verdict changes: re-scoring 259 stored runs changed 0 verdicts when this landed.

## When to use it

- Read `by` to know which rule scored a verdict, before you trust a published number.
- Compare `resolved.hash` across two runs: equal means they were scored by the same checks.
- Turn a check off for one spec or one block with an inline `uses.check_set`. For example, stop a `must` check from gating while you rewrite it.
- Share one check set between specs: write it as `driftbench/check-set/<id>.yaml` that extends `default`, and name its id under `uses.check_set`. `spec validate` and `campaign run` both read it.

When not to use it:

- Do not disable a check to make a failing block pass in a published campaign. The stamp records it, and a reader sees that the checks differ.

## Commands and every option

No command has an option for check sets. The spec key `uses.check_set` sets one:

| Key | Where | Default | Effect |
|---|---|---|---|
| `uses.check_set` | the spec, or a block | `check-set:default` | an inline object with `extends: default` and item operations; a block's object replaces the spec's |

`campaign run --json` prints the cells, not the stamps. The stamps are in the stored run record: keep the runs with `--store`, then write them out with `campaign export <campaign> --store <file> --out <dir>` (topic running-campaign-export-import).

## Inputs

An inline check set that turns off `must` for every block of the spec:

```text
uses:
  check_set:
    extends: default
    items:
      - { id: must, enabled: false }
```

The item ids are the check names of the default, plus `flow` and `ledger`.

## Outputs and how to read them

A verdict of a run record, scored by the inline object above:

```text
{ "id": "pii.email", "outcome": "pass",
  "by": { "object": "check-set:(spec)@a44a5554", "item": "pii", "impl": "builtin:check/pii", "layer": "shipped" } }
```

Read it this way: the inline object of the spec scored it; the `pii` item ran; nobody changed that item, so its layer is `shipped`. A verdict of an item the spec changed shows `layer: spec`.

## Worked example

The same one-block spec twice. The block asks for a word the Acme agent never says. The first spec uses the default check set; the second turns `must` off:

```yaml file=specs/plain.yaml
# Fictional data only.
id: plain
target: { adapter: function, agent: acme-sales }
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect: { must: ['NOT IN THE REPLY'] }
```

```yaml file=specs/quiet.yaml
# Fictional data only. The same block, scored without the must check.
id: quiet
target: { adapter: function, agent: acme-sales }
uses: { check_set: { extends: default, items: [{ id: must, enabled: false }] } }
blocks:
  - user: Hi, I'm already an Acme customer and I want more data.
    expect: { must: ['NOT IN THE REPLY'] }
```

```sh
driftbench campaign run specs/plain.yaml --no-cache # exit 1
driftbench campaign run specs/quiet.yaml --no-cache --store stamps.db --campaign quiet-run
driftbench campaign export quiet-run --store stamps.db --out out
```

```text
$ driftbench campaign run specs/plain.yaml --no-cache
Campaign c-75cec5a876ab: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ plain · function:acme-sales · F · repeat 0  fail  block 0 must.0
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 1)
$ driftbench campaign run specs/quiet.yaml --no-cache --store stamps.db --campaign quiet-run
Campaign quiet-run: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ quiet · function:acme-sales · F · repeat 0  pass  1 block
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
$ driftbench campaign export quiet-run --store stamps.db --out out
Exported campaign quiet-run to out/quiet-run: 1 runs, 1 specs, 0 sources.
(exit 0)
```

This script prints the block's `resolved` record and the stamps of its first verdicts:

```js file=show-stamps.mjs
import { readdirSync, readFileSync } from 'node:fs';

const folder = process.argv[2];
for (const file of readdirSync(`${folder}/runs`)) {
  const block = JSON.parse(readFileSync(`${folder}/runs/${file}`, 'utf8')).blocks[0];
  console.log(`resolved: ${JSON.stringify(block.resolved)}`);
  console.log(`must verdicts: ${block.verdicts.filter((v) => v.id.startsWith('must')).length}`);
  for (const verdict of block.verdicts.slice(0, 2)) console.log(`${verdict.id}: ${JSON.stringify(verdict.by)}`);
}
```

```sh setup
node show-stamps.mjs out/quiet-run
```

```text
$ node show-stamps.mjs out/quiet-run
resolved: {"objects":[{"key":"value_check","kind":"policy/value-check","id":"default","hash":"cf50456318b2","setAt":"shipped"},{"key":"check_set","kind":"check-set","id":"(spec)","hash":"a44a5554127e","setAt":"spec"}],"hash":"bc14245e424d"}
must verdicts: 0
pii.iban: {"object":"check-set:(spec)@a44a5554","item":"pii","impl":"builtin:check/pii","layer":"shipped"}
pii.national_number: {"object":"check-set:(spec)@a44a5554","item":"pii","impl":"builtin:check/pii","layer":"shipped"}
(exit 0)
```

The first spec fails on `must.0`. The second passes: its check set has no `must` item, so the block has no `must` verdict. Its `resolved` record names two objects: the shipped value-check policy, which this block records too, and the inline check set, set at the spec layer. Each verdict names the item that ran it.

## Common errors

* `uses.check_set  OBJECT_ITEM_UNKNOWN  spec <id>: uses.check_set: unknown item <item> in check-set:(spec) (uses.check_set.items.0); the parent check-set:default holds tools, tools_offered, ...`, then `Fix the invalid specs first: nothing ran.` from `campaign run` (exit 2): an item id that is not a check name. Use a name from the default, or `flow` or `ledger`.
* No `by` in a record: the record was written before this release. Old records still load; they have no stamps.
