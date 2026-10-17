---
title: Prefixes and given
summary: 'The starting state of a block: `given.prefix` starts it mid-conversation, `given.origin` says where the prefix comes from, and ledger, world and vars set its facts.'
commands:
  - spec validate
  - spec lint
  - import traces
see_also:
  - running-campaign-run
  - running-modes
  - authoring-blocks
  - authoring-spec-format
  - authoring-perturbations
  - running-tool-history
  - authoring-given-checks
next:
  - authoring-script-api
---

## What it is

Given is the starting state of a block. A spec sets it in two places:

- `given` at the top of the spec: the default for every block. Keys: `ledger`, `world`, `vars`.
- `given` on a block: the same three keys, plus `prefix` and `origin`.

`prefix` is a list of messages that come before the block: user turns, assistant turns with their tool calls, system or tool messages. With a prefix, a block starts as if that conversation had already happened. You can test the tenth turn of a conversation without writing nine blocks.

`origin` says where the prefix comes from. It is optional, and enters the Given hash only when present. It takes one of three values:

- `authored`: a person wrote the prefix.
- `recorded`: the prefix was copied from a real run, with the results its tools really returned.
- `canonical`: the prefix is the replay of a spec as written.

A fact the agent got from a tool belongs in the prefix as a tool call with its `output`, never only in the assistant's text. A history in prose is a different test. In an experiment on a sales agent, the agent read an earlier result only in its own prose. It called the tool again in 332 of 450 runs, against 0 of 450 with the recorded call. In the lead blocks, it filed the same callback request a second time in all 90 prose runs.

`spec lint` warns with `PREFIX_PROSE_HISTORY` when two conditions hold:

1. The spec names a tool somewhere. That is an expected tool (`expect.tools`), a forced tool (`world.tools`, in `given` or a perturbation), or a tool call in a prefix.
2. An assistant message of a prefix states the value of a ledger fact, as a whole word with case ignored.

The ledger facts come from four places:

- the spec's `given.ledger`, and `ledger_seed`, its shorthand;
- the `given.ledger` of this block;
- the `given.ledger` of every earlier block;
- the `expect.ledger_add` of every earlier block.

Only some values are looked for. A string counts when it holds two characters or more, spaces at either end trimmed. A number counts as it is written. Lists and maps are read inside, value by value. A boolean, `null` and a single-character string never trigger the warning.

The check reads the prefix in order. A value is not prose history when a user message said it earlier. Nor is it when a tool call up to that message holds it in its input, output or error. A spec that names no tool gets no such warning.

`ledger`, `world` and `vars` on a block merge into the running state from that block onwards:

- `ledger`: facts the agent must hold. Keys merge. Later checks (`knowledge_retention`, the ledger check) read them.
- `world.tools`: a forced `result`, `error` or `latency_ms` per tool, from this block on. Tools merge by name.
- `world.store`: a seeded store. Keys merge.
- `world.workspace`: the files a code agent starts from: a folder `from` or inline `files`. A later workspace replaces the earlier one whole.
- `world.fixtures`: free fixtures. Keys merge.
- `vars`: runtime variables such as the clock, the channel or the sender.

How a run uses a prefix depends on the run mode:

- Free-running (mode F) and perturbed (mode P): a block with a prefix closes the open session and opens a new one from the prefix. The blocks after it continue from there, with the agent's real replies.
- Teacher-forced (mode T): every block starts from its own canonical Given. Its history starts with the latest prefix a block up to it wrote. Each later block adds the spec's user message and a canonical assistant message. That message has empty text and the tool calls the block expects. Each call carries the inputs the spec asserts as exact values, and the result or error `world.tools` forces. A block that writes its own prefix starts from that prefix alone.

What the agent receives of the prefix depends on the adapter, as its source code does it:

| Adapter | What the agent receives |
|---|---|
| `function`, `http`, `anthropic`, `openai-agents`, `vercel-ai`, `google`, `pydantic-ai`, `litellm` | the session history, the prefix included, passed with each turn |
| `langgraph`, a graph with no checkpointer | the same: the whole history with each turn |
| `langgraph`, a graph with a checkpointer | the prefix once, with the first turn. Each later turn sends only the new user messages: the graph keeps the rest on its thread |
| `crewai` | by default, each kickoff receives `message`, `history` and `messages`. `message` joins all trailing user messages with newlines, including adjacent prefix messages. `history` joins the remaining earlier messages as `role: text`, separated by newlines. `messages` holds the full history as JSON, including the prefix. A custom `inputs` function replaces these defaults. With the default inputs, a prefix whose tool calls the spec states as a record (`origin: recorded` or `authored`) is refused |
| `process` | the session history, the prefix included, as a JSON array in the file `DRIFTBENCH_HISTORY_FILE` names, written before each block. The agent must read that file |
| `nexus`, live Claude Code | nothing: these adapters send only the block's own user turn and have no `seedPrefix` capability, so a block with a prefix is `not_run` (below) |
| Claude Code replay | no agent runs: the adapter returns the recorded session, so a prefix changes nothing it returns |

A prefix needs the `seedPrefix` capability, which every adapter above has except `nexus` and live Claude Code. On those a block with a prefix (and, in modes F and P, every block after it) is `not_run`, and so is every mode T block after the first, whose canonical history (the blocks before, as the spec writes them) the agent would never see. Such a block is `not_run` with kind `unsupported` and check `capability`: it is not sent, and it is neither a pass nor a fail (see running-outcomes). `world.tools` applies only on adapters with the `toolStubs` capability: `function`, `anthropic`, `google`, `vercel-ai`, `litellm`, and `http` when its options turn it on; on the others a block with a forced tool result is `not_run` the same way.

An adapter that sends the history to a model sends each tool call of the prefix as that model's own tool call and tool result records, with ids that pair them, never as text. The crewai adapter takes history as text inputs, so with its default inputs it refuses a prefix whose tool calls the spec states as a record (`origin: recorded` or `authored`) rather than let the crew read them as prose. A canonical prefix (mode T) runs as before. Topic running-tool-history gives the records per adapter, the id rules and a worked example.

## When to use it

- Test a late turn of a long conversation in one block.
- Pin the exact history a block starts from, so the block does not depend on how the agent answered earlier.
- Give a code agent a workspace (`world.workspace`), or force a tool to fail from a given block (`world.tools`).
- Read a draft from `import traces`. Each observed user turn becomes a block. The state observed before it becomes that block's `given.prefix`, with `origin: recorded`.
- Mark where a prefix comes from with `origin`. Results of a recorded history and of a written one are then never read as one test.

When not to use it:

- Do not add or change `origin` on a spec whose stored results you still compare. It changes the spec hash, so the new runs no longer pool with the old ones.
- Do not put a tool result only in the assistant's prose when you test what the agent does after a real lookup. Record the call with its `output`.
- Do not use a prefix on `nexus` or live Claude Code: the agent never receives it. Write the earlier turns as blocks.
- On `process`, use a prefix only when the agent reads `DRIFTBENCH_HISTORY_FILE`. An agent that reads only the stimulus never sees it.

## Commands and every option

This is a format topic: no option of any command sets `given`. Three commands check or write it. `campaign run` runs it; its options are in running-campaign-run, and its run modes in running-modes.

### driftbench spec validate

```
driftbench spec validate [options] <paths...>
```

Parses and validates spec files or folders. It refuses a bad message shape, a top-level `prefix` and an `origin` without a `prefix`.

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | spec files or folders | none |
| `--json` | print one JSON document | off |

Exit 0 when every spec is valid, 1 when one is invalid.

### driftbench spec lint

```
driftbench spec lint [options] <paths...>
```

The same checks as `spec validate`, plus warnings such as `PREFIX_PROSE_HISTORY`.

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | spec files or folders | none |
| `--json` | print one JSON document | off |
| `--strict` | treat warnings as failures | off |

Exit 0 when every spec is valid and, with `--strict`, has no warning. Exit 1 otherwise.

### driftbench import traces

```
driftbench import traces [options] <path>
```

Drafts one spec per traced conversation. Each observed user turn becomes a block. Every block after the first gets the conversation before it as `given.prefix`, with `origin: recorded`. It takes one path; two paths exit 2.

| Option | Meaning | Default |
|---|---|---|
| `<path>` (required) | a trace file, a folder of them, or `-` for standard input (otel and nexus only) | none |
| `--from <source>` (required) | where the traces come from: `otel`, `nexus` or `claude-code` | none |
| `--out <dir>` (required) | the folder to write the drafts to | none |
| `--prices <file>` | JSON prices per million tokens by model, such as `{"model": {"input": 2, "output": 8}}` | none |
| `--no-redact` | keep personal data. Without it, the intake privacy rules redact it | redaction on |
| `--force` | replace drafts that already exist | off |
| `--select <ids>` | draft only these traces: comma-separated trace ids | every trace |
| `--dataset <name>` | after drafting, push the drafts as the next version of this dataset | none |
| `--store <file>` | the store that keeps the dataset version, with `--dataset` | none |

The topic authoring-import tells the rest of the command.

## Inputs

### `given` keys

| Key | Where | Type | Meaning |
|---|---|---|---|
| `prefix` | block only | list of messages | The messages before this block. |
| `origin` | block only, with `prefix` | `authored`, `recorded` or `canonical` | Where the prefix comes from. It holds for later blocks until a block writes another prefix. |
| `ledger` | spec or block | mapping | Facts the agent must hold; on a block they merge from that block on. |
| `world` | spec or block | mapping | `tools`, `store`, `workspace`, `fixtures`, see below. |
| `vars` | spec or block | mapping | Runtime variables. |
| `shared` | block only | list of `{ fact, by, in? }` | Where each ledger fact was stated before the block: `by` is `user` or `agent` (said in prefix message `in`, counting from 0) or `record` (known from a system of record, never said). |
| `summary` | spec or block | string | What a named session state (`vars.session_state`) holds, in words. |

A `prefix` or an `origin` at the top-level `given` is a schema error: only a block takes them. An `origin` on a block that writes no `prefix` is `GIVEN_ORIGIN_WITHOUT_PREFIX`.

The Given verifier checks a prefix before the block runs (topic authoring-spec-check). Its rules:

- every tool call carries an `output` or an `error`;
- no call id repeats within one message;
- a call of a tool that `world.tools` forces records that forced result;
- each `shared` fact said by the user or the agent is in the message it names.

 A block that fails one is `not_run` (kind `given_unmet`), never sent, and `spec lint` warns `GIVEN_UNMET`. Topic authoring-given-checks has every check, the `shared` and `summary` keys and a worked example.

### A message of the prefix

| Key | Type | Required | Meaning |
|---|---|---|---|
| `role` | `user`, `assistant`, `system` or `tool` | yes | Who sent it. |
| `content` | string | yes | The text. Use `''` for an assistant turn that only called tools. |
| `name` | string | no | A sender name. |
| `tool_calls` | list | no | The tool calls the message made. |

### A tool call in a prefix

| Key | Type | Required | Meaning |
|---|---|---|---|
| `label` | non-empty string | yes | The tool name. |
| `id` | string | no | The call id. |
| `input` | any JSON | no | The arguments. |
| `output` | any JSON | no | What the tool returned. An agent that replays its history reads this as the real result. |
| `error` | string | no | The error the tool returned. |

### `world` keys

| Key | Type | Meaning |
|---|---|---|
| `tools` | mapping of tool name to `{ result?, error?, latency_ms? }` | Forced results and errors, from this block on. |
| `store` | mapping | A seeded store. |
| `workspace` | `{ from?, files?, summary? }` | `from`: a folder the workspace starts from; `./<path>` is read from the spec's folder, any other relative path from the folder the run starts in. `files`: path to content; on an adapter with a sandbox each one must read back as written after setup, else the block is `not_run` (kind `setup_failed`). `summary`: what the workspace holds, in words, so a reader of the spec sees what a folder holds. |
| `fixtures` | mapping | Free fixtures. |

Top-level shorthands: `ledger_seed` is `given.ledger`, and `workspace_seed` is `given.world.workspace` (a string becomes `{ from: <string> }`). Setting both forms is `SPEC_ALIAS_CONFLICT`.

## Outputs and how to read them

A prefix changes no output format. It changes what the block starts from:

- The resolved Given of each block is hashed: prefix, ledger, world, vars, target, and `origin` when the spec states one. The whole resolved Given also enters the block's cache key.
- The cache key holds more than the Given and the stimulus. It also holds the spec hash, the repeat, the block's position, the target, the adapter and its version. It holds the adapter's configuration, the cache suite and the agent version when they are set. So two repeats of one block never share an entry: each repeat is a new sample.
- `origin` also changes the spec hash, so results with different origins are never pooled. A spec without it keeps its hashes.
- In a run, the block reports as usual: `✓ <spec> · <target> · <mode> · repeat 0  pass  <n> blocks`, or the failing verdict.
- A ledger contradiction is a block that adds a fact with another value than the ledger holds. The ledger check reports it with both values.

## Worked example

`import traces` turns a recorded session into a draft spec. Each observed user turn becomes a block. Every block after the first gets the conversation before it as its `given.prefix`, with tool calls, their outputs and `origin: recorded`. On a recorded Claude Code session of the repository:

```sh
driftbench import traces examples/estates/sessions/clean-build.jsonl --from claude-code --out out/drafts
driftbench spec lint out/drafts
```

```text
$ driftbench import traces examples/estates/sessions/clean-build.jsonl --from claude-code --out out/drafts
Read 1 trace from 1 file (claude-code): 2 turns.
Wrote 1 draft spec to out/drafts, none approved: 2 blocks, no expect yet.
  Personal data redacted: 0 values.
Next: write each block's expect from the agent spec, then driftbench import approve out/drafts --all.
(exit 0)
$ driftbench spec lint out/drafts
✓ out/drafts/draft-claude-code-00000000-0000-4000-8000-000000000001.yaml  draft-claude-code-00000000-0000-4000-8000-000000000001 · 2 blocks · hash 0566601ed4c7
  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing
  ! blocks.1  BLOCK_NO_EXPECTATION  this block checks nothing
Checked 1 spec: 1 valid, 0 invalid, 2 warnings.
(exit 0)
```

The second block of the draft starts from a prefix of two messages (the start of the file, cut after the fifth tool call):

```text
blocks:
  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
  - user: Thanks. Now show me the diff summary only.
    given:
      prefix:
        - role: user
          content: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
        - role: assistant
          content: |-
            I will load the build skill for the shop first.

            Done. src/invoice.ts now applies the discount, test/invoice.test.ts covers it, and the 12 tests pass.
          tool_calls:
            - id: toolu_clean-build_01
              label: Skill
              input:
                skill: shop-build
              output: "Launching skill: shop-build"
            - id: toolu_clean-build_02
              label: Read
              input:
                file_path: /work/acme-shop/src/invoice.ts
```

The lint warnings are expected: a draft has no `expect` until a person writes it.

### A prefix you write

The plan-upgrade conversation of the Acme example, started at its third turn. The prefix holds the first two turns; the block only checks the choice. Written as `out/authoring-prefixes/resume-at-offer.yaml`:

```yaml file=out/authoring-prefixes/resume-at-offer.yaml
# Fictional data only. The block starts after the offer, without replaying the blocks before it.
id: resume-at-offer
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, closing]
ledger_seed: { customer: existing }
blocks:
  - id: choose
    given:
      prefix:
        - role: user
          content: Hi, I'm already an Acme customer and I keep running out of data on my phone.
        - role: assistant
          content: Hi, I'm the Acme Telecom sales assistant. What is the email address on your Acme account?
        - role: user
          content: It's sam.rivera@example.com
        - role: assistant
          content: 'Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like?'
          tool_calls:
            - label: catalog.search
              input: { category: mobile, customer_email: sam.rivera@example.com }
              output:
                plans:
                  - { id: mobile-m, name: Acme Mobile M, category: mobile, monthly_usd: 25, data_gb: 40 }
                  - { id: mobile-l, name: Acme Mobile L, category: mobile, monthly_usd: 35, data_gb: null }
                customer: { id: cust-001, name: Sam Rivera, current_plan_id: mobile-s }
      ledger: { customer_id: cust-001, current_plan: mobile-s }
    user: The unlimited one, please.
    expect:
      stage: recap
      tools:
        - { label: order.create, count: 0 }
      must: ['CONFIRM']
```

The recorded call carries its `output`, as the Given verifier requires: the agent replays that result as the real answer of the past turn. A call with no `output` and no `error` would make the block `not_run` (topic authoring-given-checks).

```sh
driftbench spec validate out/authoring-prefixes/resume-at-offer.yaml
driftbench campaign run out/authoring-prefixes/resume-at-offer.yaml --no-cache --mode T,F
```

```text
$ driftbench spec validate out/authoring-prefixes/resume-at-offer.yaml
✓ out/authoring-prefixes/resume-at-offer.yaml  resume-at-offer · 1 block · hash c26ca04c43e1
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench campaign run out/authoring-prefixes/resume-at-offer.yaml --no-cache --mode T,F
Campaign c-6448f17e9702: 2 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ resume-at-offer · function:acme-sales · T · repeat 0  pass  1 block
✓ resume-at-offer · function:acme-sales · F · repeat 0  pass  1 block
2 cells: 2 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

Both modes pass: the agent reached `recap` and asked for `CONFIRM` from the prefix alone.

### A history in prose

The same turn, written by a person, with the current plan stated in the assistant's text and no recorded call. Written as `out/authoring-prefixes/prose-history.yaml`:

```yaml file=out/authoring-prefixes/prose-history.yaml
# Fictional data only. The current plan is in the assistant's prose, not in a recorded call.
id: prose-history
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, closing]
ledger_seed: { customer: existing }
blocks:
  - id: choose
    given:
      origin: authored
      prefix:
        - role: user
          content: Hi, I'm already an Acme customer and I keep running out of data on my phone.
        - role: assistant
          content: Hi, I'm the Acme Telecom sales assistant. What is the email address on your Acme account?
        - role: user
          content: It's sam.rivera@example.com
        - role: assistant
          content: 'Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Your current plan is mobile-s. Which one would you like?'
      ledger: { customer_id: cust-001, current_plan: mobile-s }
    user: The unlimited one, please.
    expect:
      stage: recap
      tools:
        - { label: order.create, count: 0 }
      must: ['CONFIRM']
```

```sh
driftbench spec lint out/authoring-prefixes/prose-history.yaml
```

```text
$ driftbench spec lint out/authoring-prefixes/prose-history.yaml
✓ out/authoring-prefixes/prose-history.yaml  prose-history · 1 block · hash 5fa4e915ada7
  ! blocks.0.given.prefix.3  PREFIX_PROSE_HISTORY  the assistant states current_plan (mobile-s) in prose, which no recorded tool call of the prefix holds and the user never said: the agent may re-call the tool. Record the call with its output in tool_calls
Checked 1 spec: 1 valid, 0 invalid, 1 warning.
(exit 0)
```

The spec is valid; the warning says the history is a different test from a recorded call. Record the call that produced the plan in `tool_calls`, with its `output`, to test what the agent does after a real lookup.

### Four broken Givens

Each file breaks one rule. They are checked together:

```yaml file=out/authoring-prefixes/bad/shape.yaml
id: shape
blocks:
  - user: Hi.
    given:
      prefix:
        - { role: customer, content: Hi }
        - role: assistant
          tool_calls: [{ input: { q: 1 } }]
    expect: { must: ['Acme'] }
```

```yaml file=out/authoring-prefixes/bad/origin.yaml
id: origin-alone
blocks:
  - user: Hi.
    given: { origin: recorded }
    expect: { must: ['Acme'] }
```

```yaml file=out/authoring-prefixes/bad/top.yaml
id: top-prefix
given:
  prefix: [{ role: user, content: Hi }]
blocks:
  - user: Hi.
    expect: { must: ['Acme'] }
```

```yaml file=out/authoring-prefixes/bad/alias.yaml
id: alias
ledger_seed: { customer: existing }
given: { ledger: { customer: new } }
blocks:
  - user: Hi.
    expect: { must: ['Acme'] }
```

```sh
driftbench spec validate out/authoring-prefixes/bad # exit 1
```

```text
$ driftbench spec validate out/authoring-prefixes/bad
✗ out/authoring-prefixes/bad/alias.yaml
    ledger_seed  SPEC_ALIAS_CONFLICT  set `ledger_seed` or `given.ledger`, not both
✗ out/authoring-prefixes/bad/origin.yaml
    blocks.0.given.origin  GIVEN_ORIGIN_WITHOUT_PREFIX  origin says where a prefix comes from, and this block writes no prefix: add given.prefix or remove origin
✗ out/authoring-prefixes/bad/shape.yaml
    blocks.0.given.prefix.0.role  SCHEMA_INVALID_VALUE  Invalid option: expected one of "user"|"assistant"|"system"|"tool"
    blocks.0.given.prefix.1.content  SCHEMA_INVALID_TYPE  Invalid input: expected string, missing
    blocks.0.given.prefix.1.tool_calls.0.label  SCHEMA_INVALID_TYPE  Invalid input: expected string, missing
✗ out/authoring-prefixes/bad/top.yaml
    given  SCHEMA_UNRECOGNIZED_KEYS  unknown key: prefix
Checked 4 specs: 0 valid, 4 invalid, 0 warnings.
(exit 1)
```

### A prose history in a spec that names no tool

The prose-history spec again, with its tool expectation removed. Nothing else names a tool, so the same prose gets no warning:

```yaml file=out/authoring-prefixes/no-tools.yaml
# Fictional data only. The same prose as prose-history.yaml, and no tool named anywhere.
id: prose-no-tools
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, closing]
ledger_seed: { customer: existing }
blocks:
  - id: choose
    given:
      origin: authored
      prefix:
        - role: user
          content: Hi, I'm already an Acme customer and I keep running out of data on my phone.
        - role: assistant
          content: Hi, I'm the Acme Telecom sales assistant. What is the email address on your Acme account?
        - role: user
          content: It's sam.rivera@example.com
        - role: assistant
          content: 'Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Your current plan is mobile-s. Which one would you like?'
      ledger: { customer_id: cust-001, current_plan: mobile-s }
    user: The unlimited one, please.
    expect:
      stage: recap
      must: ['CONFIRM']
```

```sh
driftbench spec lint out/authoring-prefixes/no-tools.yaml --strict
driftbench spec lint out/authoring-prefixes/prose-history.yaml --strict # exit 1
```

```text
$ driftbench spec lint out/authoring-prefixes/no-tools.yaml --strict
✓ out/authoring-prefixes/no-tools.yaml  prose-no-tools · 1 block · hash 48dde9ab3ded
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench spec lint out/authoring-prefixes/prose-history.yaml --strict
✓ out/authoring-prefixes/prose-history.yaml  prose-history · 1 block · hash 5fa4e915ada7
  ! blocks.0.given.prefix.3  PREFIX_PROSE_HISTORY  the assistant states current_plan (mobile-s) in prose, which no recorded tool call of the prefix holds and the user never said: the agent may re-call the tool. Record the call with its output in tool_calls
Checked 1 spec: 1 valid, 0 invalid, 1 warning.
(exit 1)
```

## Common errors

The messages below are printed by `spec validate` or `spec lint`, as the worked example shows.

The full text of the `PREFIX_PROSE_HISTORY` warning:

```text
PREFIX_PROSE_HISTORY  the assistant states <fact> (<value>) in prose, which no recorded tool call of the prefix holds and the user never said: the agent may re-call the tool. Record the call with its output in tool_calls
```

| Message | Cause | Fix |
|---|---|---|
| `blocks.0.given.prefix.0.role  SCHEMA_INVALID_VALUE  Invalid option: expected one of "user"\|"assistant"\|"system"\|"tool"` | a role outside the four | `user`, `assistant`, `system` or `tool` |
| `blocks.0.given.prefix.1.content  SCHEMA_INVALID_TYPE  Invalid input: expected string, missing` | an assistant turn with tool calls only and no `content` | write `content: ''` |
| `blocks.0.given.prefix.1.tool_calls.0.label  SCHEMA_INVALID_TYPE  Invalid input: expected string, missing` | a tool call with no name | add `label` |
| `given  SCHEMA_UNRECOGNIZED_KEYS  unknown key: prefix` (or `origin`) | `prefix` or `origin` at the top-level `given` | move it to a block's `given` |
| `blocks.0.given.origin  GIVEN_ORIGIN_WITHOUT_PREFIX  origin says where a prefix comes from, and this block writes no prefix: add given.prefix or remove origin` | `origin` on a block with no `prefix` | add the `prefix` it describes, or remove `origin` |
| `ledger_seed  SPEC_ALIAS_CONFLICT  set \`ledger_seed\` or \`given.ledger\`, not both` | `ledger_seed` and `given.ledger` both set | keep one |
| `PREFIX_PROSE_HISTORY`, a warning: its full text is above the table | a spec that names a tool, and an assistant message of a prefix that states a ledger value in prose | record the call with its `output` in `tool_calls`. Or keep the prose on purpose, and read the results as a different test |
| `error: too many arguments for 'traces'. Expected 1 argument but got 2: ...` (exit 2) | two paths given to `import traces` | give one file, or a folder that holds them |
| `crewai: the Given prefix (origin recorded) holds N recorded tool call(s), and a crew takes its history as text inputs, ...` | a prefix with tool calls and `origin: recorded` or `authored` on the crewai adapter, whose default inputs pass history as text | write those turns as blocks the crew runs, or pass `inputs` to the adapter; a canonical prefix (mode T) is not refused |

Problems with no message:

| Symptom | Cause | Fix |
|---|---|---|
| `SCHEMA_INVALID_VALUE` on `role` | a role outside the four | `user`, `assistant`, `system` or `tool` |
| `SCHEMA_INVALID_TYPE` on `content` | an assistant turn with tool calls only and no `content` | write `content: ''` |
| `SCHEMA_INVALID_TYPE` on `tool_calls.N.label` | a tool call with no name | add `label` |
| `SCHEMA_UNRECOGNIZED_KEYS` on `given` | `prefix` or `origin` at the top-level `given` | move it to a block's `given` |
| `GIVEN_ORIGIN_WITHOUT_PREFIX` | `origin` on a block with no `prefix` | add the `prefix` it describes, or remove `origin` |
| `PREFIX_PROSE_HISTORY` warning | an assistant message states a ledger fact no recorded call holds | record the call with its `output` in `tool_calls`, or keep the prose on purpose and read the results as a different test |
| a block fails right after a prefix | a recorded `output` with a shape the real tool never returns | copy the output from a real run. Leaving `output` out is no fix: the block is then `not_run` |
| `GIVEN_UNMET  tool_history_paired` from `spec lint`, and the block is `not_run` | a prefix tool call has no `output` and no `error`: an agent replaying its history would read an empty result the spec never wrote | record what the tool returned in `output` (or `error`) |
| the block is `not_run`, check `capability` | the adapter has no `seedPrefix` capability (`nexus`, live Claude Code), so the agent could not receive the prefix, or in mode T the canonical history of the blocks before | write the earlier turns as blocks instead, or run on an adapter with `seedPrefix` |
| the prefix seems ignored on `process` | the agent does not read `DRIFTBENCH_HISTORY_FILE` | read the history from that file in the agent |
| two repeats of one block both call the agent | each repeat has its own cache key | expected: repeats are independent samples |
