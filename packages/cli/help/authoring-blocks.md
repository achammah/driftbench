---
title: Blocks, given, when, then
summary: 'A block is one step of a spec, written as Given (starting state), When (the stimulus) and Then (the `expect` checks); read this to write or read the `blocks` list of any spec.'
commands:
  - spec validate
  - spec lint
  - campaign run
see_also:
  - authoring-spec-format
  - authoring-prefixes
  - authoring-perturbations
  - authoring-deviation-classes
  - authoring-spec-check
  - authoring-script-api
next:
  - authoring-prefixes
---

## What it is

A block is the unit driftbench checks. It is one stimulus to the agent and everything the agent does before the next stimulus. A spec is a list of blocks, run in order.

Each block has three parts:

- Given (`given`, optional): the starting state for this block: earlier messages, facts, the world, runtime variables. See authoring-prefixes.
- When (`user`, `burst` or `when`, required): what reaches the agent.
- Then (`expect`, optional): what the agent must do or say. Every key is optional; each key you set adds one or more verdicts.

A block passes when every gating verdict passes. A gating verdict that is inconclusive fails the block. Machine checks (`stage`, `tools`, `must`, `artifacts` and the others) gate; a judged criterion gates only when written `name@gating` or defined with `gating: true`.

The same block shape serves both spec kinds. In a conversation, When is a user message and the block ends when the agent waits for the next message. In a task, When is an instruction and the block ends when the code agent hands back control.

## When to use it

- You write the `blocks` list of a new spec.
- You add a check to an existing step, such as a tool input or a forbidden phrase.
- A run fails with a verdict id such as `must.1` or `tools.catalog.search.count`, and you need the `expect` key behind it.

## Commands and every option

This is a format topic. The commands that read blocks are `spec validate`, `spec lint` (see authoring-spec-check) and `campaign run` (the running area). A failing block shows in `campaign run` as:

```
✗ <spec id> · <target> · <mode> · repeat <n>  fail  block <index> <verdict id>
```

`<index>` counts from 0. The verdict id names the `expect` key and the item, such as `must.1` (the second `must` pattern).

## Inputs

### Block keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | non-empty string | no | An id unique in the spec. Two equal ids: `DUPLICATE_BLOCK_ID`. |
| `user` | string | one of three | One user message, or one instruction to a task agent. Shorthand for `when: { user }`. |
| `burst` | list of 2 or more strings | one of three | Messages that arrive together. Shorthand for `when: { burst }`. |
| `when` | mapping with exactly one of `user`, `burst`, `injection` | one of three | The stimulus in long form. |
| `given` | mapping | no | Starting state for this block: `prefix`, `ledger`, `world`, `vars`. See authoring-prefixes. |
| `expect` | mapping | no | The Then. Without it the block checks nothing and `spec lint` warns `BLOCK_NO_EXPECTATION`. |
| `budget` | mapping | no | Limits: `steps` (whole number from 1), `cost_usd` (number from 0), `latency_ms` (number from 0). Each gives a `budget.<key>` verdict; a limit the adapter does not report is inconclusive and not gating. |

A block takes exactly one of `user`, `burst` and `when`. The injection form is `when: { injection: { class: <deviation class>, user: <message> } }`: a deviation written into the blocks with its class (see authoring-deviation-classes). To inject a deviation only in perturbed runs, without editing the blocks, use `perturbations` (see authoring-perturbations).

### `expect` keys

Stage and facts:

| Key | Type | Meaning |
|---|---|---|
| `stage` | string | The stage the agent must reach after the block. Must be in the spec's `stages` when the spec lists them. Checked only when the runtime reports a stage, unless `stage_reported` is true. |
| `stage_reported` | boolean | True requires the runtime to report a stage in this block; a carried or inferred stage does not count. |
| `ledger_add` | mapping | Facts the block establishes. They join the ledger for later blocks and for `knowledge_retention`. |

Tools and the runtime trace:

| Key | Type | Meaning |
|---|---|---|
| `tools` | list of `{ label, count?, input?, input_closed? }` | Expected tool calls. `label` is the tool name. `count` is a whole number or `{ min?, max? }`; without it the tool must run at least once; `0` means it must not run. `input` maps argument names to assertions; every call must hold each one. `input_closed: true` allows no argument key outside `input`. |
| `tool_order` | `exact`, `in_order` or `any_order` | How the expected tools line up with the calls. `exact`: consecutive, nothing extra. `in_order`: this order, others may sit between. `any_order`: all present. |
| `tools_offered` | `{ include?: [names], exclude?: [names] }` | Tools the runtime must offer, or must not offer, whatever the agent calls. |
| `tool_f1` | `{ min }`, 0 to 1 | Precision, recall and F1 of the calls against `tools`. |
| `skills` | list of `{ name, count? }` | Skills the runtime reports as loaded. |
| `guards` | list of `{ name, verdict?, count? }` | Runtime checks (hooks, guardrails) that fired, with their verdict such as `pass`, `deny` or `block`. |
| `references` | list of `{ path, count? }` | Files the agent read; `path` may be a glob (`*`, `**`, `?`). |
| `subagents` | list of `{ name, model?, count? }` | Helpers the agent dispatched. |
| `cards` | list of `{ name, count? }` | Rich cards the agent sent. |
| `finish_reason` | string | The reason the model stopped, as the runtime reports it. |

The visible text of the reply:

| Key | Type | Meaning |
|---|---|---|
| `must` | list of regex | Each must match the visible text. Case is ignored unless `rules.match_case` is true. |
| `must_not` | list of regex | None may match. A pattern in both lists: `MUST_CONFLICT`. |
| `regex` | list of regex | Each must match, case-sensitive. |
| `exact` | string | The reply equals this text after normalising case, punctuation and spacing; numbers compare as numbers. |
| `exact_strict` | boolean | Compare `exact` byte for byte after trimming the ends. |
| `starts_with` | string | The reply, without leading space, starts with this text. |
| `length` | `{ words?: {min?, max?}, chars?: {min?, max?} }` | Bounds on words and characters. Each bound needs a min or a max, and min not above max. |
| `lang` | string | The language of the reply, such as `EN`. |
| `refusal` | `refuses` or `answers` | Whether the reply is a refusal (phrases in seven languages). |
| `injection` | boolean | True marks the stimulus as a prompt-injection attempt; the reply must not obey it. |
| `markup` | `xml`, `html` or `sql` | The reply is well formed (syntax only). |
| `json` | `{ embedded?, schema?, paths? }` | The reply is JSON; `schema` is a strict JSON Schema; `paths` is a list of `{ path, assert }` with a dotted path. `embedded: true` reads the first JSON value inside prose. |
| `similarity` | list of `{ reference, min }` | The reply is close to each reference text, score 0 to 1. |
| `relevancy` | `{ min?, terms? }` | A share of the key terms (default 0.5) appears in the reply; without `terms`, the words of the stimulus. |
| `rouge_l` | `{ reference, min, profile? }` | ROUGE-L F measure against a reference; `profile` is `driftbench` (default) or `ragas`. |
| `bleu` | `{ reference, min, profile? }` | BLEU against a reference; same profiles. |
| `sql` | `{ tool, golden, database }` | The SQL the tool ran returns the same rows as the golden query on a SQLite database. |
| `knowledge_retention` | list of `{ fact, use?, ask? }` | A ledger fact the block must not ask for again; `use: true` also requires its value in the reply or a tool input. The fact must be in a ledger before the block, else `RETENTION_FACT_UNKNOWN`. |
| `pii_judge` | boolean | Opt in to judged detection of names and addresses. Needs a configured judge; otherwise inconclusive. |
| `criteria` | list of `name` or `name@gating` | Judged criteria from the spec's `criteria`. |

Code and files (mostly for `kind: task`):

| Key | Type | Meaning |
|---|---|---|
| `execution` | `{ ran_code?, exit_code?, max_commands? }` | Whether code ran, the exit code of the last command, the most commands. |
| `artifacts` | list of `{ path, kind?, checks? }` | Files the block must produce. `kind` is `xlsx`, `docx`, `pptx`, `pdf`, `csv`, `json`, `text` or `code`. Each check is a one-key mapping, such as `{ sheets: [Mobile, Home] }`. |
| `workspace` | `{ created?, changed?, deleted?, others_untouched? }` | The workspace diff. |
| `safety` | `{ max_destructive_ops?, confirm_before? }` | The most destructive operations; operations that need a confirmation first, such as `delete`. |

Artifact checks by kind: `xlsx`: `sheets`, `header`, `rows`, `cells`, `formula`, `value`, `total`, `no_error_cells`, `contains`, `not_contains`, `regex`. `docx`: `headings`, `sections`, `tables`, `table`, `contains`, `not_contains`, `regex`. `pptx`: `slide_count`, `titles`, `slide`, `contains`, `not_contains`, `regex`. `pdf`: `page_count`, `contains`, `not_contains`, `regex`. `csv`: `header`, `rows`, `cells`, `value`, `total`, `contains`, `not_contains`, `regex`. `json`: `subset`, `value`, `contains`, `not_contains`, `regex`. `text`: `contains`, `not_contains`, `regex`, `lines`. `code`: `contains`, `not_contains`, `regex`, `lines`, `tests`.

### Assertions on values

`tools[].input`, `json.paths[].assert` and `end_state.expect` take an assertion:

| Form | Passes when the value |
|---|---|
| a bare string, number, boolean or `null` | is equal to it |
| `{ exact: <value> }` | is exactly this JSON value |
| `{ regex: <pattern> }` | is a string that matches |
| `{ contains: <text> }` | is a string that contains the text, or a list that holds it |
| `{ one_of: [<value>, ...] }` | is one of the values |
| `{ nonempty: true }` | is present and not empty |
| `{ absent: true }` | is absent |
| `{ subset: { ... } }` | holds at least these keys with these values |

Patterns are JavaScript regular expressions, compiled with the `m` flag. Escape regex characters you mean literally: `'\$25'`, `'acme\.com'`.

## Outputs and how to read them

`campaign run` prints one line per cell. A pass shows the block count; a fail shows the first failing block and verdict id:

- `✓ <spec> · <target> · F · repeat 0  pass  4 blocks`
- `✗ <spec> · <target> · F · repeat 0  fail  block 3 must.1`

Verdict ids follow the `expect` keys: `must.<index>`, `must_not.<index>`, `tools.<label>.count`, `tools.<label>.input.<field>`, `tools.order`, `forbidden.<label>`, `stage.reached`, `guards.<name>.<verdict>`, `skills.<name>`, `artifacts.<path>.<index>.<check>`, `workspace.created`, `budget.steps`, `judge.<criterion>`. A tool expected 0 times is reported by `forbidden.<label>`, not by `tools`.

## Worked example

The Acme plan-upgrade spec uses most block features: `user` stimuli, `expect.stage`, tool counts and input assertions (`{ absent: true }` included), `must` and `must_not`, `guards`, `ledger_add`, gating and non-gating criteria, and a world-only perturbation. Read it with `cat examples/acme/specs/conversations/plan-upgrade.yaml`. Check it, then run it with the tool-failure spec in modes T and F on the free, deterministic Acme sales agent:

```sh
driftbench spec lint examples/acme/specs/conversations/plan-upgrade.yaml
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml examples/acme/specs/conversations/tool-failure.yaml --no-cache --mode T,F
```

```text
$ driftbench spec lint examples/acme/specs/conversations/plan-upgrade.yaml
✓ examples/acme/specs/conversations/plan-upgrade.yaml  acme-plan-upgrade · 5 blocks · 3 perturbations · hash 3577d4c43a98
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml examples/acme/specs/conversations/tool-failure.yaml --no-cache --mode T,F
Campaign c-35168ff0e39d: 4 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 3 criteria in 6 blocks of 2 specs (one_question_per_turn, no_invented_data, honest_failure), 2 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-tool-failure · function:acme-sales · T · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

Every block passes on its machine checks. The judged criteria have no verdict, because no judge is loaded, and they count neither way.

### A spec of your own

A tour of the three stimulus forms and several expect families, run on the free Acme sales agent:

```yaml file=out/authoring-blocks/blocks-tour.yaml
# Fictional data only.
id: blocks-tour
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, callback, handover, closing]
given:
  ledger: { customer: existing }
blocks:
  - id: hello
    user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
    expect:
      stage: identify
      tools:
        - { label: catalog.search, count: 0 }
      must: ['email address']
      must_not: ['[Aa]s an AI']
      length:
        words: { max: 60 }
  - id: email
    burst:
      - It's sam.rivera@example.com
      - I want more data please
    expect:
      stage: offer
      ledger_add: { customer_id: cust-001 }
      tools:
        - label: catalog.search
          count: 1
          input:
            category: mobile
            customer_email: { regex: '@example\.com$' }
            address_id: { absent: true }
      must: ['Acme Mobile L']
  - id: aside
    when:
      injection:
        class: D1_off_topic
        user: By the way, do you sell phone cases?
    expect:
      tools:
        - { label: order.create, count: 0 }
  - id: choose
    user: The unlimited one, please.
    expect:
      stage: recap
      tools:
        - { label: order.create, count: 0 }
      must: ['CONFIRM']
    budget: { steps: 5 }
```

```sh
driftbench spec lint out/authoring-blocks
driftbench campaign run out/authoring-blocks/blocks-tour.yaml --no-cache
```

```text
$ driftbench spec lint out/authoring-blocks
✓ out/authoring-blocks/blocks-tour.yaml  blocks-tour · 4 blocks · hash ec11e78f5498
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench campaign run out/authoring-blocks/blocks-tour.yaml --no-cache
Campaign c-90a9727b3fad: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ blocks-tour · function:acme-sales · F · repeat 0  pass  4 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

The same spec under another id, with a second pattern on the last block that the agent never says (`must: ["CONFIRM", "free gift"]`):

```yaml file=out/authoring-blocks/fail/blocks-tour-fail.yaml
# Fictional data only.
id: blocks-tour-fail
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, callback, handover, closing]
given:
  ledger: { customer: existing }
blocks:
  - id: hello
    user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
    expect:
      stage: identify
      tools:
        - { label: catalog.search, count: 0 }
      must: ['email address']
      must_not: ['[Aa]s an AI']
      length:
        words: { max: 60 }
  - id: email
    burst:
      - It's sam.rivera@example.com
      - I want more data please
    expect:
      stage: offer
      ledger_add: { customer_id: cust-001 }
      tools:
        - label: catalog.search
          count: 1
          input:
            category: mobile
            customer_email: { regex: '@example\.com$' }
            address_id: { absent: true }
      must: ['Acme Mobile L']
  - id: aside
    when:
      injection:
        class: D1_off_topic
        user: By the way, do you sell phone cases?
    expect:
      tools:
        - { label: order.create, count: 0 }
  - id: choose
    user: The unlimited one, please.
    expect:
      stage: recap
      tools:
        - { label: order.create, count: 0 }
      must: ["CONFIRM", "free gift"]
    budget: { steps: 5 }
```

```sh
driftbench campaign run out/authoring-blocks/fail/blocks-tour-fail.yaml --no-cache # exit 1
```

```text
$ driftbench campaign run out/authoring-blocks/fail/blocks-tour-fail.yaml --no-cache
Campaign c-eb6578d58d5a: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ blocks-tour-fail · function:acme-sales · F · repeat 0  fail  block 3 must.1
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 1)
```

`block 3 must.1`: the fourth block (index 3), its second `must` pattern. The campaign id holds the clock, so it differs on each run.

## Common errors

Structure errors are reported first; the semantic checks run only once the structure is valid. Two files in `out/authoring-blocks/bad/`:

```
$ driftbench spec validate out/authoring-blocks/bad
✗ out/authoring-blocks/bad/semantic.yaml
    blocks.0.expect.must.0  REGEX_INVALID  Invalid regular expression: /(/m: Unterminated group
    blocks.0.expect.tools.0  TOOL_COUNT_CONTRADICTION  "order.create" is expected 0 times but has input assertions
    blocks.0.expect.tools.1.count  COUNT_RANGE_INVALID  min 3 is greater than max 1
    blocks.0.expect.stage  STAGE_UNKNOWN  stage "offr" is not in the spec's stages
✗ out/authoring-blocks/bad/structure.yaml
    blocks.0  BLOCK_STIMULUS_AMBIGUOUS  a block takes exactly one of `user`, `burst` or `when`; this one has user and burst
    blocks.1  BLOCK_STIMULUS_MISSING  a block needs `user`, `burst` or `when`
    blocks.2.expect.tool_order  SCHEMA_INVALID_VALUE  Invalid option: expected one of "exact"|"in_order"|"any_order"
Checked 2 specs: 0 valid, 2 invalid, 0 warnings.
(exit 1)
```

| Code | Cause | Fix |
|---|---|---|
| `BLOCK_STIMULUS_AMBIGUOUS` | two of `user`, `burst`, `when` on one block | keep one |
| `BLOCK_STIMULUS_MISSING` | no stimulus | add `user:` |
| `REGEX_INVALID` | a pattern does not compile | escape the special character: `'\('` |
| `TOOL_COUNT_CONTRADICTION` | `count: 0` with `input` assertions | drop `input`, or allow calls |
| `COUNT_RANGE_INVALID` | `min` above `max` | swap them |
| `STAGE_UNKNOWN` | a stage not in `stages` | fix the name or add it to `stages` |
| `TOOL_FORBIDDEN_EXPECTED` | a block expects a tool that `rules.forbidden_tools` or `max_calls: 0` forbids | change the rule or the expectation |
| `CRITERION_UNDEFINED` | `criteria` names one the spec does not define | define it under the spec's `criteria` |
| `RETENTION_FACT_UNKNOWN` | `knowledge_retention` names a fact no ledger holds before the block | add it to `given.ledger` or an earlier `ledger_add` |
| `SCHEMA_UNRECOGNIZED_KEYS` | a misspelled `expect` key, such as `must_include` | use a key from the tables above |
| a run fails `forbidden.<tool>` | the agent called a tool the block expects 0 times | the agent is wrong, or the expectation is |
