---
title: Checks on tool calls
summary: "The machine checks on tool calls: tools with the value-check ladder and compare, input_closed and argument accuracy. Also tool_order, forbidden tools, call caps, tools_offered, tool_f1, schema_strict, sql, the value assertion forms and the tool policy."
commands: []
see_also:
  - running-campaign-run
  - validate-estate-replay
  - judging-machine-checks
  - judging-check-text
  - judging-check-runtime
next:
  - judging-check-runtime
---

## What it is

These checks compare the tool calls the adapter recorded in a block with what the block expects. A tool is named by its `label`, the name the adapter reports. Each check is turned on by a field of `expect`, of the spec's `rules`, or `metadata.tool_schemas`. No check makes a model call of its own. The only model the `tools` check can use is a same-referent judge you configure. None is configured by default.

An input value the block names is decided by the value-check ladder, not by string equality. A value that differs from the expected one is right when it has the same effect where it is used. The ladder asks, in order: the tool, the tool's stated contract, the source the agent copied the value from, and a calibrated judge. It never uses a rule per value type, such as phone, email or address.

## When to use it

* The agent must call a tool, a number of times, with given arguments: `expect.tools`.
* The calls must come in an order: `expect.tool_order`.
* A tool must never run, or run at most N times in the whole run: `rules.forbidden_tools`, `rules.max_calls`, or `count: 0`.
* A setting must hide or offer a tool: `expect.tools_offered`.
* A score over all calls rather than one verdict per tool: `expect.tool_f1`.
* Calls must respect the tool's declared schema (no invented parameter): `metadata.tool_schemas`.
* The exact writing of a value is itself the requirement (a downstream reader needs that form): `compare: { exact: <reason> }` on the expected tool.
* SQL the agent ran must return the right rows: `expect.sql`.

## Commands and every option

Every run command applies these checks; no command option changes them (see `judging-machine-checks`). The spec fields:

| Field | Check | What passes | Verdict ids |
|---|---|---|---|
| `tools: [{ label, count, input, input_closed, compare }]` | `tools` | Each tool runs `count` times (a number, or `{ min, max }`; no `count` means at least once). Every call holds each `input` assertion. A value the assertion names goes through the value-check ladder (below). A tool not called fails each of its input assertions. `input_closed: true`: each call's input is an object with only the keys listed in `input`. `compare`: how differing values are decided, one mode for every argument or a mode by argument name; absent means `auto`. | `tools.<label>.count`, `tools.<label>.input.<field>`, `tools.<label>.input.<field>.unstated_format` and `.no_decider` (not gating: lints on the test), `tools.<label>.input_closed`, `tools.argument_accuracy` (not gating: the share of expected arguments that matched) |
| `tool_order: exact`, `in_order` or `any_order` | `tools` | `exact`: the calls split into consecutive runs, one per expected tool, with nothing left over (a fail names the first diverging call). `in_order`: the expected calls appear in order, others may sit between. `any_order`: they all appear. | `tools.order` |
| `tools: [{ label, count: 0 }]` | `forbidden` | The tool is not called in the block. Reported by `forbidden`, not `tools`. | `forbidden.<label>` |
| `rules.forbidden_tools: [label...]` | `forbidden` | The tool is never called. A block that expects a forbidden tool is a spec error (`TOOL_FORBIDDEN_EXPECTED`). | `forbidden.<label>` |
| `rules.max_calls: { <label>: n }` | `forbidden` | The calls of the run so far stay at or under `n`; a block fails only when its own calls go past it. `0` forbids the tool. | `forbidden.max_calls.<label>` |
| `tools_offered: { include, exclude }` | `tools_offered` | The tools the runtime offered the agent include or exclude these. No offered list: gating inconclusive. | `tools_offered.include.<tool>`, `tools_offered.exclude.<tool>` |
| `tool_f1: { min }` | `tool_f1` | Precision, recall and F1 of the calls against the expected ones reach `min`. Each expected tool counts `count` times. A call matches at most one expectation. | `tool_f1.f1` |
| `metadata.tool_schemas: { <label>: schema }` | `schema_strict` | Every call of a tool with a schema matches it strictly: a key the schema does not declare is an invented parameter. The schema is a JSON Schema, an OpenAI-style function with `parameters`, or an Anthropic-style tool with `input_schema`. A tool with no schema: inconclusive, not gating. | `schema_strict.<label>.<n>` (`n` counts the tool's calls from 1) |
| `sql: { tool, golden, database }` | `sql` | The query in the named tool's `query` input returns the same rows as the golden query on the SQLite file, read-only (a write is refused). Rows compare as a multiset, in order when the golden query has `ORDER BY`. | `sql.0` |

Value assertions, for `tools[].input` and `end_state.expect`:

| Form | Passes when the value |
|---|---|
| a bare string, number, boolean or `null` | equals it |
| `{ exact: <value> }` | is exactly this JSON value |
| `{ regex: <pattern> }` | is a string matching the pattern |
| `{ contains: <text> }` | is a string containing the text, or a list holding it |
| `{ one_of: [...] }` | is one of the values |
| `{ nonempty: true }` | is present and not empty |
| `{ absent: true }` | is absent |
| `{ subset: { ... } }` | holds at least these keys with these values |

### The value-check ladder

In `tools[].input`, a bare value, `{ exact: <value> }` and each leaf of `{ subset: { ... } }` name a value. A call's value equal to it passes. Otherwise the ladder decides, with the items of the shipped object `policy/value-check:default` (file `policy/value-check/default.yaml`), the first that settles the value deciding it:

| Order | Item | When it applies | What it decides |
|---|---|---|---|
| 0 | (before the items) | always | A value equal to the expected one passes. A number, a boolean, a list, `null` or an absent value that differs fails: it has one writing. |
| 1 | `rung4_exact` | `compare: { exact: <reason> }` | Pass only on the exact value; the reason is printed. Nothing else runs. |
| 2 | `rung1_outcome` | a tool replayer is configured, declares the tool, and the tool resolves this input | The real tool runs twice on the block's seeded store, with the agent's value and with the expected one. Same resolved result (the output fields the tool declares, such as an id or found): pass. Different: fail. |
| 3 | `rung1_recompute` | a computed value (a formula or a script) | Recomputed on the given inputs and on 3 changed input sets: a hard-coded number fails. |
| 4 | `rung1_state_diff` | the value is a workspace diff | Every expected change present, nothing else changed outside the allowed paths. |
| 5 | `rung2_contract` | the field's schema in `metadata.tool_schemas` has a `pattern`, `enum` or `const` | A value that breaks it fails; two different members of an enum fail. It settles no pass. |
| 6 | `rung2b_as_given` | the agent's value, or the expected one, appears as a whole token in what the user wrote (this block and the ones before) | The user gave the expected writing and the agent wrote something else: fail. The user corrected a value in a later message and the agent kept the earlier one: fail. It passes nothing: a copy proves where the value came from, not that it is right, so a copied value goes on to the judge. |
| 7 | `rung3_same_referent` | a same-referent judge is configured, its calibration meets the policy (false acceptance at most 0.02), and the field states no contract | The judge reads each value alone, then compares the readings, 3 repeats in both orders: all say the same thing, pass; none, fail; split, inconclusive. |
| 8 | `exact_fallback` (after the items) | no item settled the value | The exact compare of today: the differing value fails, and the `no_decider` lint names what would settle it. |

A value no item settles falls back to the exact compare, the verdict of today. It fails. The evidence says `exact_fallback: no decider configured for <tool>.<arg>; compared exactly` with every item's reason. The non-gating lint `tools.<label>.input.<field>.no_decider` names the deciders that would settle it. The ladder turns a fail into a pass only when an item decides the value. Only a configured judge that cannot decide (its votes split, or its call fails) leaves a value inconclusive.

A spec or a block runs another policy with `uses.value_check`. It names an object id (shipped, or a project or suite object visible from the spec file). Or it is an inline object that extends the shipped one, such as `uses: { value_check: { extends: default, items: [{ id: rung1_outcome, enabled: false }] } }`. A block's choice replaces the spec's. A suite or project `uses.yaml` applies to the specs below it. An object the check cannot resolve adds a failing `tools.value_check` with the reason. The block's values are then compared exactly. Its count, input and order verdicts stay.

`compare` is scoring-only, like `uses`. It stays out of the block cache key and the re-judge compatibility hash. After you write or change it, a cached run replays the stored observations and scores them again. It never calls the agent.

`compare` modes: `auto` (the default) walks the ladder. `outcome`, `contract`, `as_given` or `same_referent` runs that item alone (the exact fallback when it cannot apply). `{ exact: <reason> }` declares the writing itself is the requirement. Give one mode for every argument (`compare: auto`) or a mode by argument name (`compare: { customer: same_referent }`). The other assertion forms (`regex`, `contains`, `one_of`, `nonempty`, `absent`) list their own accepted writings and compare as written.

Sometimes the judge passes a value that differs from the expected one only in its writing, and no contract states that writing. Then the check adds `tools.<label>.input.<field>.unstated_format`, not gating, which flags the test. Declare the format in the tool (a `pattern` or an `enum`) or drop it from the block.

The CLI runs the ladder with no replayer and no judge. From code, `defaultChecks({ valueCheck: { services: { replayer, judge } } })` or `createToolsCheck({ policy, services })` of `@agent-nexus/driftbench-checks` adds them:

- A replayer declares, per tool, the output fields that are its resolved result. For a tool that also keeps values as given, it declares the inputs the tool resolves. The Acme example exports one, `acmeReplayer`: its order tool resolves the plan, not the customer's email.
- A judge is a model function plus its measured calibration. `recordedJudgeModel` replays recorded calls.

The research behind the ladder used the 259 stored H1 runs of the Acme sales agent. The tool settled 59 of the 116 format-only failures: 49 pass, and 10 fail where `Ln` does not resolve. Against two labellers, it gave 0 false passes and 0 false fails.

The supported schema keywords are `type`, `enum`, `const`, `required`, `properties`, `additionalProperties`, string, number and list bounds, `pattern`, `items`, `nullable`, `anyOf`, `oneOf` and `allOf`. The annotations `title`, `description`, `default`, `examples`, `$schema`, `$id` and `$comment` are accepted too. Others (`$ref`, `not`, `format`, `if`, `patternProperties`, `uniqueItems`, `multipleOf`, tuple `items`) are refused when the spec loads.

Run-wide tool policy (off by default). Its rules are `{ pattern, action }`: a glob over the tool name with `allow`, `deny` or `ask` (an `ask` is a denial). The first match decides, and no match allows. Given to `defaultChecks({ toolPolicy })`, it adds `tool_policy.<label>` verdicts. Given to `runSpec({ toolPolicy })`, it marks denied calls before the checks read them. Given to the vercel-ai, function or process adapter, it refuses the call before it runs. There is no CLI option for it.

## Inputs

The calls the adapter recorded in the block, with their labels and inputs. The runtime's offered tools. The spec's `rules` and `metadata.tool_schemas`. The SQLite file for `sql`.

## Outputs and how to read them

The evidence names the call and the value: `catalog.search input.category is one of ["mobile","home"] on 1 call: "mobile"`. When the ladder decided a value, the evidence adds the item that settled it and why, in brackets: `(call 1 (call-2): address_id rung1_outcome: catalog.search resolves "addr-101" to ...)`. `exact_fallback` names a value no item settled, compared exactly, with every reason. The same decisions are data on the argument verdict, `valueCheck`. It holds one entry per value a rung decided, `{ call, path, rung, outcome }`. It is absent when every value equalled the expected one. A failing count lists the calls the block did make. A failing order names what was expected and what was seen. `tool_f1` names the unexpected and the missed calls. `schema_strict` names each invented parameter.

## Worked example

A scratch spec on the deterministic Acme sales agent (no model call). Block 1 expects a `coverage.check` call the agent never makes. The schema of `catalog.search` declares only `category`. The run prints the failing ids; a small script prints the tool verdicts with their evidence from `--json`:

```yaml file=tools-demo.yaml
# A scratch copy of the first two blocks of acme-plan-upgrade, with tool expectations. Fictional data.
id: tools-demo
title: Tool checks on the first two blocks of the plan upgrade
target: { adapter: function, agent: acme-sales }
ledger_seed: { customer: existing, lang: EN }
stages: [identify, offer, recap, order_placed, callback, handover, closing]
rules:
  max_calls: { catalog.search: 1 }
metadata:
  tool_schemas:
    catalog.search:
      type: object
      properties:
        category: { type: string, enum: [mobile, home] }
      required: [category]
blocks:
  - user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
    expect:
      tools:
        - { label: catalog.search, count: 0 }
  - user: It's sam.rivera@example.com
    expect:
      tools:
        - { label: coverage.check, count: { min: 1 } }
        - label: catalog.search
          input:
            category: { one_of: [mobile, home] }
            address_id: { absent: true }
      tool_order: in_order
      tool_f1: { min: 0.9 }
```

```js file=show.mjs
// Prints every verdict of a `campaign run --json` document read on stdin: block, id, outcome, evidence.
// An optional argument lists id prefixes to leave out, comma-separated.
let text = '';
process.stdin.on('data', (chunk) => { text += chunk; });
process.stdin.on('end', () => {
  const skip = (process.argv[2] ?? '').split(',').filter(Boolean);
  for (const cell of JSON.parse(text).cells)
    cell.blocks.forEach((block, i) => {
      for (const v of block.verdicts)
        if (!skip.some((p) => v.id.startsWith(p)))
          console.log(`block ${i} ${v.id} ${v.outcome}${v.gating ? '' : ' (not gating)'}: ${v.evidence}`);
    });
});
```

The scripts below run the package from its source with `tsx`; this file tells `tsx` where the packages are:

```json file=tsconfig.json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "paths": {
      "@agent-nexus/driftbench-example-acme": ["./examples/acme/src/package.ts"],
      "@agent-nexus/driftbench-adapters/contract": ["./packages/adapters/src/contract.ts"],
      "@agent-nexus/driftbench-*": ["./packages/*/src/index.ts"]
    }
  }
}
```

```sh
driftbench campaign run tools-demo.yaml --no-cache  # exit 1
```

```sh setup
tsx packages/cli/src/bin.ts campaign run tools-demo.yaml --no-cache --json | node show.mjs pii.,lang.,stage.
```

```text
$ driftbench campaign run tools-demo.yaml --no-cache
Campaign c-473e75c6f1d1: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ tools-demo · function:acme-sales · F · repeat 0  fail  block 1 tools.coverage.check.count, block 1 tools.order, block 1 tool_f1.f1, block 1 schema_strict.catalog.search.1
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 1)
$ tsx packages/cli/src/bin.ts campaign run tools-demo.yaml --no-cache --json | node show.mjs pii.,lang.,stage.
block 0 forbidden.catalog.search pass: catalog.search not called (the block expects it 0 times)
block 0 forbidden.max_calls.catalog.search pass: catalog.search ran 0 times in the run so far (0 in this block, 0 before), at most 1 by rules.max_calls
block 1 tools.coverage.check.count fail: coverage.check called 0 times, expected at least 1; calls in this block: catalog.search
block 1 tools.catalog.search.count pass: catalog.search called 1 time, expected at least 1
block 1 tools.catalog.search.input.category pass: catalog.search input.category is one of ["mobile","home"] on 1 call: "mobile"
block 1 tools.catalog.search.input.address_id pass: catalog.search input.address_id is absent on 1 call: absent
block 1 tools.order fail: in_order: expected these calls in this order, other calls allowed between them: coverage.check (at least 1), catalog.search (at least 1); saw catalog.search
block 1 tools.argument_accuracy pass (not gating): 2 of 2 expected arguments matched
block 1 forbidden.max_calls.catalog.search pass: catalog.search ran 1 time in the run so far (1 in this block, 0 before), at most 1 by rules.max_calls
block 1 tool_f1.f1 fail: precision 1.00 (1 of 1 calls), recall 0.50 (1 of 2 expected), F1 0.67, minimum 0.90, missed: coverage.check
block 1 schema_strict.catalog.search.1 fail: catalog.search call 1 (call-1): 1 invented parameter; input.customer_email is not in the schema: an invented parameter
block 1 flow.order pass: identify then offer, in catalogue order
(exit 0)
```

The run fails on `tools.coverage.check.count`, `tools.order`, `tool_f1.f1` and `schema_strict.catalog.search.1`. The spec sets no `stage`, so the runner's stage classifier adds `flow.order`. `tsx packages/cli/src/bin.ts` is the CLI run from source, the same program as `driftbench`, so its `--json` can be piped.

### Values the agent wrote

A second scratch spec. The customer gives a phone number in block 3, and the Acme agent stores it on the lead as `+12025550131`. The block expects the writing `(202) 555-0131`, once with the default `compare` and once declared exact. `notify_sales` only stores the value, the CLI configures no judge, and nobody wrote `(202) 555-0131`. So the default comparison falls back to the exact compare and lints the test. The declared exact one fails, with its reason:

```yaml file=values-demo.yaml
# Fictional data. The second expectation of block 3 repeats the first with an exact compare.
id: values-demo
title: Values the agent writes, decided by the value-check ladder
target: { adapter: function, agent: acme-sales }
ledger_seed: { customer: new, lang: EN }
stages: [address, offer, details, recap, order_placed, callback, handover, closing]
blocks:
  - user: Hello, I'm new here and looking for home internet.
  - user: 88 Summit Avenue, Acmeville
    expect:
      tools:
        - label: coverage.check
          input: { address: '88 Summit Avenue, Acmeville' }
  - user: I really want fiber. Can someone call me when it arrives?
  - user: 'My number is 202 555 0131'
    expect:
      tools:
        - label: notify_sales
          input:
            customer: { subset: { phone: '(202) 555-0131' } }
        - label: notify_sales
          compare: { exact: the sales dialer reads this exact form }
          input:
            customer: { subset: { phone: '(202) 555-0131' } }
```

```sh
driftbench campaign run values-demo.yaml --no-cache  # exit 1
```

```sh setup
tsx packages/cli/src/bin.ts campaign run values-demo.yaml --no-cache --json | node show.mjs pii.,lang.,stage.,flow.,forbidden.
```

```text
$ driftbench campaign run values-demo.yaml --no-cache
✗ values-demo · function:acme-sales · F · repeat 0  fail  block 3 tools.notify_sales.input.customer, block 3 tools.notify_sales#2.input.customer
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
(exit 1)
$ tsx packages/cli/src/bin.ts campaign run values-demo.yaml --no-cache --json | node show.mjs pii.,lang.,stage.,flow.,forbidden.
block 1 tools.coverage.check.count pass: coverage.check called 1 time, expected at least 1
block 1 tools.coverage.check.input.address pass: coverage.check input.address is equal to "88 Summit Avenue, Acmeville" on 1 call: "88 Summit Avenue, Acmeville"
block 1 tools.argument_accuracy pass (not gating): 1 of 1 expected argument matched
block 3 tools.notify_sales.count pass: notify_sales called 1 time, expected at least 1
block 3 tools.notify_sales.input.customer fail: notify_sales call 1 (call-1): input.customer is {"phone":"+12025550131"}; expected holding at least {"phone":"(202) 555-0131"} (call 1 (call-1): customer.phone exact_fallback: no decider configured for notify_sales.customer.phone; compared exactly: "+12025550131" is not "(202) 555-0131" (rung3_same_referent: no same-referent judge is configured))
block 3 tools.notify_sales.input.customer.no_decider fail (not gating): test lint: nothing could decide whether "+12025550131" names the same thing as "(202) 555-0131" for notify_sales.customer.phone, so it was compared exactly; it would be settled by a replayer that declares notify_sales and resolves customer.phone (rung1_outcome), or a pattern or an enum for customer.phone in metadata.tool_schemas (rung2_contract), or a calibrated same-referent judge (rung3_same_referent)
block 3 tools.notify_sales#2.count pass: notify_sales called 1 time, expected at least 1
block 3 tools.notify_sales#2.input.customer fail: notify_sales call 1 (call-1): input.customer is {"phone":"+12025550131"}; expected holding at least {"phone":"(202) 555-0131"} (call 1 (call-1): customer.phone rung4_exact: "+12025550131" is not exactly "(202) 555-0131" (the sales dialer reads this exact form))
block 3 tools.argument_accuracy fail (not gating): 0 of 2 expected arguments matched; missed: notify_sales input.customer, notify_sales input.customer
(exit 0)
```

The first expectation fails on the exact fallback and names the deciders that would settle it. A judge configured from code would pass it. It would then add the `unstated_format` lint, since no contract asks for `(202) 555-0131`. The second fails on the declared writing.

### A value the user gave, and a policy for one spec

Here the block expects the phone exactly as the customer typed it, `202 555 0131`. The agent wrote `+12025550131`. Under the shipped policy, `rung2b_as_given` fails the value: the agent changed what the user gave. The second spec turns that item off with an inline object, so the value falls back to the exact compare. The third writes a `compare` mode that does not exist:

```yaml file=values/as-given.yaml
# Fictional data. The block expects the phone as the customer typed it.
id: as-given
target: { adapter: function, agent: acme-sales }
ledger_seed: { customer: new, lang: EN }
stages: [address, offer, details, recap, order_placed, callback, handover, closing]
blocks:
  - user: Hello, I'm new here and looking for home internet.
  - user: 88 Summit Avenue, Acmeville
  - user: I really want fiber. Can someone call me when it arrives?
  - user: 'My number is 202 555 0131'
    expect:
      tools:
        - label: notify_sales
          input:
            customer: { subset: { phone: '202 555 0131' } }
```

```yaml file=values/no-as-given.yaml
# Fictional data. The block expects the phone as the customer typed it.
id: no-as-given
target: { adapter: function, agent: acme-sales }
ledger_seed: { customer: new, lang: EN }
stages: [address, offer, details, recap, order_placed, callback, handover, closing]
uses: { value_check: { extends: default, items: [{ id: rung2b_as_given, enabled: false }] } }
blocks:
  - user: Hello, I'm new here and looking for home internet.
  - user: 88 Summit Avenue, Acmeville
  - user: I really want fiber. Can someone call me when it arrives?
  - user: 'My number is 202 555 0131'
    expect:
      tools:
        - label: notify_sales
          input:
            customer: { subset: { phone: '202 555 0131' } }
```

```yaml file=values/bad-mode.yaml
# Fictional data. The block expects the phone as the customer typed it.
id: bad-mode
target: { adapter: function, agent: acme-sales }
ledger_seed: { customer: new, lang: EN }
stages: [address, offer, details, recap, order_placed, callback, handover, closing]
blocks:
  - user: Hello, I'm new here and looking for home internet.
  - user: 88 Summit Avenue, Acmeville
  - user: I really want fiber. Can someone call me when it arrives?
  - user: 'My number is 202 555 0131'
    expect:
      tools:
        - label: notify_sales
          compare: fuzzy
          input:
            customer: { subset: { phone: '202 555 0131' } }
```

```sh
driftbench campaign run values/as-given.yaml --no-cache # exit 1
driftbench campaign run values/no-as-given.yaml --no-cache # exit 1
driftbench spec validate values/bad-mode.yaml # exit 1
```

```text
$ driftbench campaign run values/as-given.yaml --no-cache
Campaign c-6b2ccbdff576: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ as-given · function:acme-sales · F · repeat 0  fail  block 3 tools.notify_sales.input.customer
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 1)
$ driftbench campaign run values/no-as-given.yaml --no-cache
Campaign c-02314f7eaa68: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ no-as-given · function:acme-sales · F · repeat 0  fail  block 3 tools.notify_sales.input.customer
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 1)
$ driftbench spec validate values/bad-mode.yaml
✗ values/bad-mode.yaml
    blocks.3.expect.tools.0.compare  SCHEMA_INVALID_UNION  Invalid input
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
```

```sh setup
tsx packages/cli/src/bin.ts campaign run values/as-given.yaml --no-cache --json | node show.mjs pii.,lang.,stage.,flow.,forbidden.,tools.coverage
tsx packages/cli/src/bin.ts campaign run values/no-as-given.yaml --no-cache --json | node show.mjs pii.,lang.,stage.,flow.,forbidden.,tools.coverage
```

```text
$ tsx packages/cli/src/bin.ts campaign run values/as-given.yaml --no-cache --json | node show.mjs pii.,lang.,stage.,flow.,forbidden.,tools.coverage
block 3 tools.notify_sales.count pass: notify_sales called 1 time, expected at least 1
block 3 tools.notify_sales.input.customer fail: notify_sales call 1 (call-1): input.customer is {"phone":"+12025550131"}; expected holding at least {"phone":"202 555 0131"} (call 1 (call-1): customer.phone rung2b_as_given: the agent was given "202 555 0131" and wrote "+12025550131": it changed the value)
block 3 tools.argument_accuracy fail (not gating): 0 of 1 expected argument matched; missed: notify_sales input.customer
(exit 0)
$ tsx packages/cli/src/bin.ts campaign run values/no-as-given.yaml --no-cache --json | node show.mjs pii.,lang.,stage.,flow.,forbidden.,tools.coverage
block 3 tools.notify_sales.count pass: notify_sales called 1 time, expected at least 1
block 3 tools.notify_sales.input.customer fail: notify_sales call 1 (call-1): input.customer is {"phone":"+12025550131"}; expected holding at least {"phone":"202 555 0131"} (call 1 (call-1): customer.phone exact_fallback: no decider configured for notify_sales.customer.phone; compared exactly: "+12025550131" is not "202 555 0131" (rung3_same_referent: no same-referent judge is configured))
block 3 tools.notify_sales.input.customer.no_decider fail (not gating): test lint: nothing could decide whether "+12025550131" names the same thing as "202 555 0131" for notify_sales.customer.phone, so it was compared exactly; it would be settled by a replayer that declares notify_sales and resolves customer.phone (rung1_outcome), or a pattern or an enum for customer.phone in metadata.tool_schemas (rung2_contract), or a calibrated same-referent judge (rung3_same_referent)
block 3 tools.argument_accuracy fail (not gating): 0 of 1 expected argument matched; missed: notify_sales input.customer
(exit 0)
```

Both runs fail block 3, for two reasons. Under the shipped policy, `rung2b_as_given` names the change: the agent was given one writing and wrote another. With that item off, nothing settles the value, so it fails on the exact fallback with the `no_decider` lint. `compare: fuzzy` is refused when the spec loads.

## Common errors

* `TOOL_FORBIDDEN_EXPECTED` when the spec loads: a block expects a tool that `rules.forbidden_tools` forbids, or that `max_calls` caps at 0.
* `tools.<label>.count` fails with `calls in this block: ...`: the adapter reports the tool under another label. Copy the label from that list.
* `schema_strict.<label>.<n>` fails on a key the provider adds: declare it in the schema, or allow extra keys with `additionalProperties`.
* A spec error naming `$ref`, `format` or another keyword: that schema keyword is not supported; inline the schema or drop the keyword.
* `tools_offered...` gating inconclusive: the adapter reports no offered list.
* `sql.0` inconclusive: the golden query itself failed; check it on the database.
* `tools.<label>.input.<field>` fails with `exact_fallback: no decider configured`, beside the `no_decider` lint: the value differs from the expected one and no replayer, contract, source or judge decides it. Configure a judge or a replayer from code, declare the format in `metadata.tool_schemas`, or write `compare: { exact: <reason> }` when the writing is the requirement.
* `tools.<label>.input.<field>` inconclusive: a configured judge could not decide (its votes split, or its call failed).
* `tools.<label>.input.<field>` fails with `the agent was given ... and wrote ...`: the user wrote the expected value and the agent changed it, a reformatting included (`rung2b_as_given`).
* `tools.<label>.input.<field>.unstated_format`: the block demands a writing nobody stated to the agent; the agent passed. Declare the format in the tool or relax the block.
* `the value-check policy <id> cannot run: <problems>` (thrown when `createToolsCheck` is built from code), or the verdict `tools.value_check` fail with `the value-check object <ref> cannot run: <problems>`. A problem reads `<item>: no rung implements <impl>`, or `order must name every item once: <order>`, or names a `when` that reads an unknown evidence name. Fix the object: one known implementation per item, every item once in `order`.
* The verdict `tools.value_check` fail with `the value-check object this block uses cannot resolve: <reason>`: the object `uses.value_check` names does not resolve.
* `blocks.<n>.expect.tools.<m>.compare  SCHEMA_INVALID_UNION  Invalid input` from `spec validate`: a `compare` mode that does not exist. Use `auto`, `outcome`, `contract`, `as_given`, `same_referent` or `{ exact: <reason> }`, alone or by argument name.
