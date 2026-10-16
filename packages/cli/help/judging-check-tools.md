---
title: Checks on tool calls
summary: "The machine checks that read the agent's tool calls: tools (count, input assertions, input_closed, normalise, argument accuracy), tool_order, forbidden tools and call caps, tools_offered, tool_f1, schema_strict, sql, the value assertion forms, and the run-wide tool policy."
commands:
  - campaign run
  - replay
see_also:
  - judging-machine-checks
  - judging-check-text
  - judging-check-runtime
next:
  - judging-check-runtime
---

## What it is

These checks compare the tool calls the adapter recorded in a block with what the block expects. A tool is named by its `label`, the name the adapter reports. Each check is turned on by a field of `expect`, of the spec's `rules`, or `metadata.tool_schemas`, and makes no model call.

## When to use it

* The agent must call a tool, a number of times, with given arguments: `expect.tools`.
* The calls must come in an order: `expect.tool_order`.
* A tool must never run, or run at most N times in the whole run: `rules.forbidden_tools`, `rules.max_calls`, or `count: 0`.
* A setting must hide or offer a tool: `expect.tools_offered`.
* A score over all calls rather than one verdict per tool: `expect.tool_f1`.
* Calls must respect the tool's declared schema (no invented parameter): `metadata.tool_schemas`.
* SQL the agent ran must return the right rows: `expect.sql`.

## Commands and every option

Every run command applies these checks; no command option changes them (see `judging-machine-checks`). The spec fields:

| Field | Check | What passes | Verdict ids |
|---|---|---|---|
| `tools: [{ label, count, input, input_closed, normalise }]` | `tools` | Each tool runs `count` times (a number, or `{ min, max }`; no `count` means at least once), and every call holds each `input` assertion. A tool not called fails each of its input assertions. `input_closed: true`: each call's input is an object with only the keys listed in `input`. `normalise`: the argument and its expected value are put in one form before they are compared (below). | `tools.<label>.count`, `tools.<label>.input.<field>`, `tools.<label>.input_closed`, `tools.argument_accuracy` (not gating: the share of expected arguments that matched) |
| `tool_order: exact`, `in_order` or `any_order` | `tools` | `exact`: the calls split into consecutive runs, one per expected tool, with nothing left over (a fail names the first diverging call). `in_order`: the expected calls appear in order, others may sit between. `any_order`: they all appear. | `tools.order` |
| `tools: [{ label, count: 0 }]` | `forbidden` | The tool is not called in the block. Reported by `forbidden`, not `tools`. | `forbidden.<label>` |
| `rules.forbidden_tools: [label...]` | `forbidden` | The tool is never called. A block that expects a forbidden tool is a spec error (`TOOL_FORBIDDEN_EXPECTED`). | `forbidden.<label>` |
| `rules.max_calls: { <label>: n }` | `forbidden` | The calls of the run so far stay at or under `n`; a block fails only when its own calls go past it. `0` forbids the tool. | `forbidden.max_calls.<label>` |
| `tools_offered: { include, exclude }` | `tools_offered` | The tools the runtime offered the agent include or exclude these. No offered list: gating inconclusive. | `tools_offered.include.<tool>`, `tools_offered.exclude.<tool>` |
| `tool_f1: { min }` | `tool_f1` | Precision, recall and F1 of the calls against the expected ones (each expected tool counted `count` times, a call matching at most one expectation) reach `min`. | `tool_f1.f1` |
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

Normalised values: `normalise` on a tool (and on `end_state`, and on a `json` path) maps an argument path, such as `phone` or `customer.phone`, to a rule. Both the observed value and the expected value at the path are rewritten by the rule, then the assertion compares them. It applies to a bare value, `exact`, `one_of`, `subset` and `contains`; a `regex`, `nonempty` or `absent` assertion takes no rule (`NORMALISE_INVALID` when the spec loads). Without a rule the comparison stays exact.

| Rule | Reads |
|---|---|
| `digits_only` | the digits only: `order #4417` as `4417` |
| `phone_e164` | + and the digits: `+1 202 555 0131` as `+12025550131`; with `country_code: "1"`, `(202) 555-0131` too. A number without + or 00 and without `country_code` stays as its digits |
| `email_lower` | the address trimmed and lower-cased, without `mailto:`, angle brackets or a trailing dot |
| `whitespace` | the text trimmed, each run of spaces collapsed to one |
| `case_fold` | the text lower-cased |
| `address_canon` | the address lower-cased, punctuation as spaces, street abbreviations expanded (`Ave` as `avenue`, `Rd` as `road`, `Ln` as `lane`). The town stays. Inside `contains`, whole words only |

A rule may be a mapping: `{ rule: phone_e164, country_code: "1" }`, or `{ rule: address_canon, surface_forms: [{ form: "88 Summit Avenue", approved: true }] }`. A surface form is another writing of the expected value, such as an address without its town. It matches when it equals the observed text, ignoring case and spacing, and only once `approved: true`: a person signs it off, and an address without its town is approved only where the agent's own tool resolves it. `spec validate` warns `SLOT_FIELD_NO_RULE` on a phone, email or address compared with no rule, and `SURFACE_FORM_UNAPPROVED` on a form not approved.

The supported schema keywords are `type`, `enum`, `const`, `required`, `properties`, `additionalProperties`, string, number and list bounds, `pattern`, `items`, `nullable`, `anyOf`, `oneOf` and `allOf`, plus the annotations `title`, `description`, `default`, `examples`, `$schema`, `$id`, `$comment`. Others (`$ref`, `not`, `format`, `if`, `patternProperties`, `uniqueItems`, `multipleOf`, tuple `items`) are refused when the spec loads.

Run-wide tool policy (off by default): rules `{ pattern, action }`, a glob over the tool name with `allow`, `deny` or `ask` (an `ask` is a denial); the first match decides; no match allows. Given to `defaultChecks({ toolPolicy })` it adds `tool_policy.<label>` verdicts; to `runSpec({ toolPolicy })` it marks denied calls before the checks read them; to the vercel-ai, function or process adapter it refuses the call before it runs. There is no CLI option for it.

## Inputs

The calls the adapter recorded in the block, with their labels and inputs; the runtime's offered tools; the spec's `rules` and `metadata.tool_schemas`; the SQLite file for `sql`.

## Outputs and how to read them

The evidence names the call and the value: `catalog.search input.category is one of ["mobile","home"] on 1 call: "mobile"`. With a rule it also gives the raw and the normalised value: `notify_sales input.customer is holding at least {"phone":"+12025550131"} on 1 call: {"phone":"+1 202 555 0131"} (call 1; normalised by phone_e164: phone "+1 202 555 0131" read as "+12025550131")`. A failing count lists the calls the block did make. A failing order names what was expected and what was seen. `tool_f1` names the unexpected and the missed calls. `schema_strict` names each invented parameter.

## Worked example

A scratch spec on the deterministic Acme sales agent (no model call): block 1 expects a `coverage.check` call the agent never makes, and the schema of `catalog.search` declares only `category`. The run prints the failing ids; a small script prints the tool verdicts with their evidence from `--json`:

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

## Common errors

* `TOOL_FORBIDDEN_EXPECTED` when the spec loads: a block expects a tool that `rules.forbidden_tools` forbids, or that `max_calls` caps at 0.
* `tools.<label>.count` fails with `calls in this block: ...`: the adapter reports the tool under another label. Copy the label from that list.
* `schema_strict.<label>.<n>` fails on a key the provider adds: declare it in the schema, or allow extra keys with `additionalProperties`.
* A spec error naming `$ref`, `format` or another keyword: that schema keyword is not supported; inline the schema or drop the keyword.
* `tools.<label>.input.<field>` fails on a value that is the same one written differently, such as `+1 202 555 0131` against `+12025550131`: add a `normalise` rule for that field.
* `NORMALISE_INVALID` when the spec loads: the rule names a field with no assertion, a `regex`, `nonempty` or `absent` assertion, a path that holds no expected text, or surface forms beside an assertion that names more than one value.
* `tools_offered...` gating inconclusive: the adapter reports no offered list.
* `sql.0` inconclusive: the golden query itself failed; check it on the database.
