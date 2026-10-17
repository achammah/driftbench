---
title: Given checks, shared facts and summaries
summary: 'The Given verifier checks a block''s starting state before the block runs: paired tool history, known tools, history that matches the world, and `given.shared` facts said in the message they name. `given.summary`, `world.workspace.summary` and `spec lint --summaries` describe a named state.'
commands:
  - spec lint
see_also:
  - running-campaign-run
  - authoring-prefixes
  - authoring-spec-check
  - running-outcomes
next:
  - authoring-spec-check
---

## What it is

A block's Given is a recipe for the state the block starts from: a prefix, a ledger, a world. A recipe can be wrong. A prefix can record a tool call with no result, or claim the user said a fact the prefix never shows. Then the block tests something the spec does not describe.

The Given verifier is a set of checks on that recipe. It reads only the spec, and only the layers the spec writes. It runs at two moments:

1. In `spec lint`, as warnings. `spec validate` counts them in its summary line.
2. In the runner, before each block is sent. A block that fails one of the four Given errors below is `not_run` with kind `given_unmet`. It is never sent, and it is neither a pass nor a fail.

| Check | Layer | Holds when | At run time |
|---|---|---|---|
| `tool_history_paired` | 2 tool history | every tool call of a prefix carries an `output` or an `error`, and no call `id` repeats within one message. The same id in two different assistant messages is accepted | `not_run`. A warning only (`GIVEN_CANONICAL_UNPAIRED`) on a prefix whose `origin` is `canonical` |
| `tool_known` | 2 tool history, 5 world | every tool a prefix calls, or `world.tools` forces, is a key of `metadata.tool_schemas`. Off when the spec declares no tool schemas | `not_run` |
| `history_matches_world` | 2 tool history and 5 world | a recorded call of a tool the block's world forces records that forced result or error | `not_run` |
| `value_in_message` | 4 beliefs | each `given.shared` fact said by `user` or `agent` is in the ledger. Its value is in the prefix message it names, sent by that speaker | `not_run` |
| `chain` | 4 beliefs | a block's `ledger_add` agrees with the ledger the block starts from | warning only (`GIVEN_CHAIN`) |
| `summary_present` | 5 world | a workspace folder (`world.workspace.from`) and a named session state (`vars.session_state`) carry a summary | warning only (`GIVEN_SUMMARY_MISSING`), and only with `spec lint --summaries` |

`value_in_message` compares whole words. Case, spaces and punctuation are ignored, so `+1 202 555 0131` holds `+12025550131`. Part of a word never counts: `went` does not hold `EN`.

A finding on a block's prefix or shared facts also holds for the later blocks that keep that history. In mode T, these are the later blocks with no prefix of their own. In modes F and P the conversation stops at the first block not run. A finding on the world holds from its block on, as the world merges forward. A finding on the spec's own `given` holds for every block.

One check runs only at run time, after the session opens. On an adapter with a sandbox, every file `world.workspace.files` writes must read back as written. A file that does not makes the block `not_run` with kind `setup_failed`, check `world_digest`.

Three keys give the checks what they need. All are optional. A spec that writes none keeps its spec hash and its cache keys.

* `given.shared` on a block: where each ledger fact was stated before the block.
* `given.summary` on the spec or a block: what a named session state holds, in words.
* `world.workspace.summary`: what a workspace holds, in words.

## When to use it

* Write `shared` when a block's test depends on the agent having heard a fact earlier, such as a customer's email. The check then proves the prefix really says it.
* Write `by: record` for a fact the agent knows from a system of record and never heard said. The check skips it, and a reader sees why the fact is in the ledger.
* Write a `summary` when a spec names a session state or seeds a workspace from a folder. A reader of the spec cannot see what a folder or a named state holds otherwise.
* Run `spec lint --summaries` when you review a suite for readers. It is off by default because many specs name a state without a summary.
* Read the verifier's warnings before a long campaign. Each `GIVEN_UNMET` is a block that will not run.

Do not silence `GIVEN_UNMET` by deleting the prefix. Record what the tool returned, or fix the message index. A block not run measures nothing.

## Commands and every option

### driftbench spec lint

```
driftbench spec lint <paths...> [--json] [--strict] [--summaries]
```

| Option | Default | Meaning |
|---|---|---|
| `<paths...>` (required) | none | spec files or folders |
| `--json` | off | print one JSON array |
| `--strict` | off | treat warnings as failures: exit 1 on any warning, `GIVEN_UNMET` included |
| `--summaries` | off | also warn with `GIVEN_SUMMARY_MISSING` when a workspace folder or a named session state has no summary |

Exit codes: 0 when every spec is valid (warnings allowed). It is 1 when one spec is invalid, or has a warning with `--strict`. It is 2 when no path is given. The other options and codes are in the topic authoring-spec-check.

### In a run

The verifier has no option of `campaign run` or any other command. It runs before each block, on every target. A Given error makes the block `not_run` with kind `given_unmet`; the cell is `not_run`, and the command exits 3.

## Inputs

### `given.shared`

A list on a block's `given`. Each entry:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `fact` | non-empty string | yes | the ledger key of the fact |
| `by` | `user`, `agent` or `record` | yes | who stated it: the user or the agent in a prefix message, or `record` for a fact from a system of record that was never said |
| `in` | whole number, from 0 | for `user` and `agent` | the index of the prefix message that states it |

The history the check reads is the block's own prefix, or else the latest prefix an earlier block wrote. `user` needs a user message at index `in`; `agent` needs an assistant message.

```yaml
# Fictional data only.
given:
  prefix:
    - { role: user, content: Hi, I'm already an Acme customer. }
    - { role: assistant, content: What is the email address on your Acme account? }
    - { role: user, content: It's sam.rivera@example.com }
  ledger: { email: sam.rivera@example.com, customer_id: cust-001 }
  shared:
    - { fact: email, by: user, in: 2 }
    - { fact: customer_id, by: record }
```

### `given.summary` and `world.workspace.summary`

```yaml
# Fictional data only.
given:
  vars: { session_state: returning-customer }
  summary: The customer is signed in; the account holds one mobile plan, mobile-s.
  world:
    workspace:
      from: ./seed
      summary: The plan catalog as CSV and a README; nothing else.
```

`given.summary` is a non-empty string, on the spec's `given` or a block's `given`. A block's summary holds from that block on. `world.workspace.summary` is a non-empty string beside `from` and `files`. The check reads `vars.session_state` only when it is text other than `fresh`.

## Outputs and how to read them

### spec lint

Each finding is one warning line under its spec:

```text
  ! <path>  <CODE>  <check>: expected <what the check expected>; got <what it found>
```

| Part | Holds |
|---|---|
| `<path>` | where in the spec, dotted, counting from 0, such as `blocks.0.given.shared.0` |
| `<CODE>` | `GIVEN_UNMET` (a Given error: the block will not run), `GIVEN_CANONICAL_UNPAIRED`, `GIVEN_CHAIN` or `GIVEN_SUMMARY_MISSING` (advice only: the block runs) |
| `<check>` | the check of the table above |
| `expected`, `got` | the rule, and what the spec holds instead |

With `--json`, each finding is an entry of `warnings` with `level`, `code`, `path` and `message`.

### campaign run

A block refused by the verifier is reported as a block not run (topic running-outcomes):

```text
- <spec> · <target> · <mode> · repeat <n>  not_run  block <i> not_run <check>
```

With `--json`, its `notRun` holds `kind` (`given_unmet` or `setup_failed`), `layer`, `check`, `expected` and `got`, the same words `spec lint` prints.

## Worked example

The plan-upgrade conversation of the Acme example, started at its third turn, as in the topic authoring-prefixes. The block says where the email was said, and that the customer id comes from the account record:

```yaml file=out/authoring-given-checks/shared.yaml
# Fictional data only. The email is said by the user in prefix message 2.
id: shared-facts
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
      ledger: { customer_id: cust-001, current_plan: mobile-s, email: sam.rivera@example.com }
      shared:
        - { fact: email, by: user, in: 2 }
        - { fact: customer_id, by: record }
    user: The unlimited one, please.
    expect:
      stage: recap
      tools:
        - { label: order.create, count: 0 }
      must: ['CONFIRM']
```

The same block twice more, each with one Given error. In the first, `shared` points at message 0, which does not hold the email. In the second, the past `catalog.search` call has no `output`:

```yaml file=out/authoring-given-checks/broken/wrong-message.yaml
# Fictional data only. Message 0 does not hold the email.
id: shared-wrong-message
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
      ledger: { email: sam.rivera@example.com }
      shared:
        - { fact: email, by: user, in: 0 }
    user: The unlimited one, please.
    expect:
      tools:
        - { label: order.create, count: 0 }
```

```yaml file=out/authoring-given-checks/broken/no-output.yaml
# Fictional data only. The past catalog.search call records no result.
id: prefix-no-output
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, closing]
ledger_seed: { customer: existing }
blocks:
  - id: choose
    given:
      prefix:
        - role: user
          content: It's sam.rivera@example.com
        - role: assistant
          content: 'Acme Mobile L is unlimited data for $35 a month. Would you like it?'
          tool_calls:
            - label: catalog.search
              input: { category: mobile, customer_email: sam.rivera@example.com }
    user: The unlimited one, please.
    expect:
      tools:
        - { label: order.create, count: 0 }
```

Lint all three, then run the good one and the first broken one:

```sh
driftbench spec lint out/authoring-given-checks
driftbench campaign run out/authoring-given-checks/shared.yaml --no-cache --mode T,F
driftbench campaign run out/authoring-given-checks/broken/wrong-message.yaml --no-cache # exit 3
```

```text
$ driftbench spec lint out/authoring-given-checks
✓ out/authoring-given-checks/broken/no-output.yaml  prefix-no-output · 1 block · hash cc00489fff0b
  ! blocks.0.given.prefix.1.tool_calls.0  GIVEN_UNMET  tool_history_paired: expected catalog.search carries an output or an error; got a call with no result
✓ out/authoring-given-checks/broken/wrong-message.yaml  shared-wrong-message · 1 block · hash 5945bb0298d8
  ! blocks.0.given.shared.0  GIVEN_UNMET  value_in_message: expected "sam.rivera@example.com" appears in prefix message 0; got the message says: Hi, I'm already an Acme customer and I keep running out of data on my phone.
✓ out/authoring-given-checks/shared.yaml  shared-facts · 1 block · hash 226371a8c6c4
Checked 3 specs: 3 valid, 0 invalid, 2 warnings.
(exit 0)
$ driftbench campaign run out/authoring-given-checks/shared.yaml --no-cache --mode T,F
Campaign c-80474e4b6f5a: 2 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ shared-facts · function:acme-sales · T · repeat 0  pass  1 block
✓ shared-facts · function:acme-sales · F · repeat 0  pass  1 block
2 cells: 2 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
$ driftbench campaign run out/authoring-given-checks/broken/wrong-message.yaml --no-cache
Campaign c-04f55c0f1e54: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
- shared-wrong-message · function:acme-sales · F · repeat 0  not_run  block 0 not_run value_in_message
1 cell: 0 pass, 0 fail, 1 not run, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 3)
```

`spec lint` exits 0: the findings are warnings. `shared.yaml` lints clean and passes in both modes. `wrong-message.yaml` gets `GIVEN_UNMET` with check `value_in_message`, and its cell is `not_run`: the agent was never asked. `no-output.yaml` gets `GIVEN_UNMET` with check `tool_history_paired`. Fix it by recording what the tool returned in `output`, as `shared.yaml` does.

### A named state with no summary

A spec that names a session state lints clean by default. With `--summaries` it gets a warning; a `summary` clears it:

```yaml file=out/authoring-given-checks/state/no-summary.yaml
# Fictional data only.
id: named-state
target: { adapter: function, agent: acme-sales }
stages: [identify, offer]
given:
  vars: { session_state: returning-customer }
blocks:
  - user: Hi, I'm back about my phone plan.
    expect: { stage: identify }
```

```yaml file=out/authoring-given-checks/state/with-summary.yaml
# Fictional data only.
id: named-state-described
target: { adapter: function, agent: acme-sales }
stages: [identify, offer]
given:
  vars: { session_state: returning-customer }
  summary: The customer is signed in; the account holds one mobile plan, mobile-s.
blocks:
  - user: Hi, I'm back about my phone plan.
    expect: { stage: identify }
```

```sh
driftbench spec lint out/authoring-given-checks/state
driftbench spec lint out/authoring-given-checks/state --summaries
driftbench spec lint out/authoring-given-checks/state --summaries --strict # exit 1
```

```text
$ driftbench spec lint out/authoring-given-checks/state
✓ out/authoring-given-checks/state/no-summary.yaml  named-state · 1 block · hash 6e112e6646dc
✓ out/authoring-given-checks/state/with-summary.yaml  named-state-described · 1 block · hash ca390db268a8
Checked 2 specs: 2 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench spec lint out/authoring-given-checks/state --summaries
✓ out/authoring-given-checks/state/no-summary.yaml  named-state · 1 block · hash 6e112e6646dc
  ! given.vars.session_state  GIVEN_SUMMARY_MISSING  summary_present: expected the named state returning-customer has a summary; got no summary: a reader of the spec cannot see what it holds
✓ out/authoring-given-checks/state/with-summary.yaml  named-state-described · 1 block · hash ca390db268a8
Checked 2 specs: 2 valid, 0 invalid, 1 warning.
(exit 0)
$ driftbench spec lint out/authoring-given-checks/state --summaries --strict
✓ out/authoring-given-checks/state/no-summary.yaml  named-state · 1 block · hash 6e112e6646dc
  ! given.vars.session_state  GIVEN_SUMMARY_MISSING  summary_present: expected the named state returning-customer has a summary; got no summary: a reader of the spec cannot see what it holds
✓ out/authoring-given-checks/state/with-summary.yaml  named-state-described · 1 block · hash ca390db268a8
Checked 2 specs: 2 valid, 0 invalid, 1 warning.
(exit 1)
```

Only `no-summary.yaml` gets `GIVEN_SUMMARY_MISSING`, at `given.vars.session_state`, and only with `--summaries`. With `--strict` that warning fails the command.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `GIVEN_UNMET  tool_history_paired: expected <tool> carries an output or an error; got a call with no result` | a prefix tool call records neither `output` nor `error` | record what the tool returned in `output`, or the error in `error` |
| `GIVEN_UNMET  tool_history_paired: expected tool call ids unique within one message; got id <id> repeats in prefix message <m>` | two calls of one message share an `id` | give each call of a message its own `id` |
| `GIVEN_CANONICAL_UNPAIRED  tool_history_paired: ...` | the same unpaired call, on a prefix with `origin: canonical` | advice only; the block runs. Record the result when you can |
| `GIVEN_UNMET  tool_known: expected <tool> is a tool of the target; got the target has no tool <tool>` | the prefix calls, or `world.tools` forces, a tool that `metadata.tool_schemas` does not declare | fix the tool name, or add its schema to `metadata.tool_schemas` |
| `GIVEN_UNMET  history_matches_world: expected <tool> records <forced>, what the block's world forces; got it records <recorded>` | a recorded past call disagrees with the result `world.tools` forces for that tool | make the recorded `output` or `error` equal the forced one |
| `GIVEN_UNMET  value_in_message: expected ledger.<fact> appears in prefix message <in>; got the ledger holds no such fact` | `shared` names a fact the ledger does not hold | add the fact to `given.ledger`, or fix the `fact` name |
| `GIVEN_UNMET  value_in_message: expected ledger.<fact> appears in prefix message <in>; got the prefix has no such message` | `in` is past the last message, or missing for `user` or `agent` | count messages from 0, and give `in` |
| `GIVEN_UNMET  value_in_message: expected prefix message <in>, which states the fact, is from the user; got it is an assistant message` | `by` names the wrong speaker for that message | fix `by` or `in` |
| `GIVEN_UNMET  value_in_message: expected "<value>" appears in prefix message <in>; got the message says: <text>` | the message does not hold the value as whole words | point `in` at the message that says it, or fix the value |
| `GIVEN_CHAIN  chain: expected ledger_add agrees with the ledger; got <fact>: the ledger holds <a>, the block adds <b>` | a block's `ledger_add` contradicts a fact the ledger already holds | fix one of the two values; the block still runs |
| `GIVEN_SUMMARY_MISSING  summary_present: expected the named state <state> has a summary; got no summary: a reader of the spec cannot see what it holds` | `--summaries` and a `vars.session_state` with no `summary` | add `given.summary` |
| `GIVEN_SUMMARY_MISSING  summary_present: expected the folder <from> has a summary; got ...` | `--summaries` and a `world.workspace.from` with no `summary` | add `world.workspace.summary` |
| a block `not_run` with kind `setup_failed`, check `world_digest`, `got` naming `<path> differs` or `<path> cannot be read` | on a sandbox adapter, a seeded file did not read back as written | check the path and the content of `world.workspace.files`, then run the cell again |
| `SCHEMA_INVALID_VALUE` on `shared.<n>.by` | a speaker other than `user`, `agent` or `record` | use one of the three |
