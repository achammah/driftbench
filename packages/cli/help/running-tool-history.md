---
title: Tool history on the wire
summary: 'How the tool calls of a history reach a model: as paired call and result records with ids the wire accepts, never as prose. When crewai refuses a prefix with tool calls.'
commands:
  - spec validate
see_also:
  - running-campaign-run
  - authoring-prefixes
  - running-modes
  - running-targets
  - running-sdk-adapters
next:
  - running-sdk-adapters
---

## What it is

A block can start from a history that holds tool calls. It is a `given.prefix` you write or import, the canonical history of mode T, or the agent's own earlier turns in modes F and P. Each recorded call has a `label`, an optional `id`, an `input`, and an `output` or an `error`.

An adapter that sends the history to a model turns each recorded call into that model's own tool records, never into text:

| Adapter | Call record | Result record |
|---|---|---|
| `anthropic` | a `tool_use` block | a `tool_result` block, `is_error` for an error |
| `openai-agents` | a `function_call` item | a `function_call_result` item |
| `http` and `litellm` (chat completions) | an entry of `tool_calls` | a `tool` message with its `tool_call_id` |
| `google` | a `functionCall` part | a `functionResponse` part with the same name, and the same id when the call has one |
| `langgraph`, `pydantic-ai`, `vercel-ai` | the framework's tool call shape | the framework's tool result shape |

One compiler pairs every call with its result before any of these adapters renders it. The rules are the ones the model wires enforce:

* **Every call has a result.** The result is the recorded output or the recorded error. When the history recorded neither, it is the value the adapter sends for an unrecorded result. A result follows its own call, in the same order.
* **The calls of one assistant turn have distinct ids.** A recorded id that repeats an id of the same turn gets a fresh id. Its result still answers it. The Acme agent numbers its calls from `call-1` in every turn, so this happens.
* **An id repeated in another turn is kept.** The wires accept it.
* **A call recorded with no id gets the adapter's fallback id.** `google` is the exception: such a call stays without an id. A wire's own character rules apply first: `anthropic` turns each character outside letters, digits, `_` and `-` into `_`.
* **A `tool` message that answers no call goes as user text.** This is a free tool note, such as `role: tool` with only `content`. Chat completions refuse a `tool` message without its call.

The fallback ids, numbered from 1 in the order of the history:

| Adapter | Fallback id | What advances the number |
|---|---|---|
| `anthropic` | `toolu_h<n>` | every call |
| `http`, `litellm` | `call-h<n>` | each call that needs a fresh id |
| `openai-agents`, `langgraph`, `pydantic-ai`, `vercel-ai` | `call_h<n>` | each call that needs a fresh id |
| `google` | `call_h<n>`, only for a call whose recorded id repeats one of the same turn. A call with no id stays without one | each call that needs a fresh id |

A fresh id never takes an id that a call of the same turn already holds.

Nothing else changed. Every history of the example specs renders byte for byte as before on all seven wires: 539 histories were compared when the compiler landed. Spec hashes, Given hashes, cassettes and recorded results are unchanged. A block cache key changes only for a block whose Given states an origin: the key now holds how many messages the origin covers. That block runs again once, and never replays a wrong result. A rendering changes only in two cases the wires refused before: a repeated id in one turn, and a free tool note on chat completions.

### crewai

The crewai adapter hands the history to the crew as text inputs. With its default inputs, a recorded call would reach the crew's agents as prose, which is a different test. So it refuses a Given prefix whose tool calls the spec states as a record, before the crew starts. That means `given.origin` is `recorded` or `authored`. It counts only the messages the spec wrote. A canonical prefix (mode T), a prefix with no origin, and the canonical calls mode T adds after a written prefix run as before. Pass the adapter's `inputs` option to hand the calls to the crew your own way: then nothing is refused.

### Adapters that send no history

None of these adapters uses the compiler:

* `process` writes the history as it is, prefix included, as a JSON array to the file `DRIFTBENCH_HISTORY_FILE` names. The agent reads it from there.
* `function` hands the history to your code as it is, with no wire rendering.
* `nexus` and the live Claude Code adapter cannot seed a history: they declare `seedPrefix` false. A block that starts from a written prefix, or from the history mode T builds, is not sent. The capability check marks it `not_run`, and the command exits 3 (topic running-outcomes).

## When to use it

Read this topic when:

* you write a `given.prefix` with tool calls, and want to know what the model reads;
* a recorded or imported history numbers its calls the same way in one turn;
* a prefix holds a `role: tool` message with no call;
* you run a crew through the crewai adapter with a `recorded` or `authored` prefix that holds tool calls.

You do not need to do anything for the pairing: it runs on every model adapter. Record each call with its `output` or `error`, so the model reads a real result. Do not write a past tool result into the assistant's text instead. That is a prose history, and the agent tends to call the tool again (topic authoring-prefixes, `PREFIX_PROSE_HISTORY`).

## Commands and every option

The pairing has no option and no setting. It runs inside every adapter in the table above, whatever command runs the agent.

What changes what the model reads:

| Where | Key | Effect |
|---|---|---|
| a block's `given.prefix` | `tool_calls[].output`, `tool_calls[].error` | the result the model reads for that call |
| a block's `given.prefix` | `tool_calls[].id` | the id the wire receives, unless it repeats one of the same turn |
| a block's `given.prefix` | a message with `role: tool` | user text on every model wire |
| the spec's or a block's `given.world.tools` | `result`, `error` | the result of each mode T canonical call of that tool |
| the crewai target | `inputs` | hands the history to the crew your own way; no refusal |

The commands that run an agent, such as `campaign run`, use the pairing with no option of their own; their options are in running-campaign-run.

`spec validate` checks the prefix's shape before any run:

```
driftbench spec validate [options] <paths...>
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | spec files or folders | none |
| `--json` | print one JSON document | off |

Exit 0 when every spec is valid, 1 when one is invalid. Its codes are in authoring-spec-check.

## Inputs

A history in a spec, as a block's `given.prefix`. A minimal prefix with one recorded call:

```text
given:
  prefix:
    - role: user
      content: Is fiber available at 3 Orchard Way, Acmeville?
    - role: assistant
      content: ''
      tool_calls:
        - id: call-1
          label: coverage.check
          input: { address: '3 Orchard Way, Acmeville' }
          output: { found: true }
```

## Outputs and how to read them

The pairing prints nothing. It shows in the request each model adapter sends. The worked example prints two of them. Read them this way:

* Each call is followed by exactly one result with the same id.
* Two calls of one turn never share an id. A call whose recorded id repeated one of its turn shows a fallback id, such as `call-h1` or `toolu_h2`.
* A free tool note shows as user text: `role: user` on chat completions, a `text` block in a user message on Anthropic.

A run whose prefix the crewai adapter refused is a failed run, with the refusal as its error.

## Worked example

A block starts from a prefix where the agent called two tools in one turn, both with the id `call-1`. A free tool note follows. The script prints the chat completions request and the Anthropic messages for that prefix. No model is called.

```yaml file=out/running-tool-history/paired.yaml
# Fictional data only. Two calls of one turn share the id call-1, as the Acme agent numbers them.
id: paired-history
target: { adapter: function, agent: acme-sales }
stages: [address, offer, callback, handover, closing]
ledger_seed: { customer: new }
blocks:
  - id: ask-price
    given:
      origin: authored
      prefix:
        - role: user
          content: Is fiber available at 3 Orchard Way, Acmeville?
        - role: assistant
          content: Yes, Acme Fiber 300 is available at 3 Orchard Way.
          tool_calls:
            - id: call-1
              label: coverage.check
              input: { address: '3 Orchard Way, Acmeville' }
              output: { found: true, address_id: addr-0042 }
            - id: call-1
              label: catalog.search
              input: { category: home, address_id: addr-0042 }
              output: { plans: [fiber-300] }
        - role: tool
          content: The coverage map was refreshed today.
    user: How much is it per month?
    expect:
      stage: offer
```

```sh
driftbench spec validate out/running-tool-history/paired.yaml
```

```text
$ driftbench spec validate out/running-tool-history/paired.yaml
✓ out/running-tool-history/paired.yaml  paired-history · 1 block · hash 8aabf76210ac
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
```

The script runs the packages from their source with `tsx`; this file tells `tsx` where the packages are:

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

```ts file=wire.mts
import { readFileSync } from 'node:fs';
import { canonicalGiven, parseSpecText } from '@agent-nexus/driftbench-core';
import { WireNames } from './packages/adapters/src/anthropic/common.ts';
import { ANTHROPIC_NAME, toAnthropicMessages } from './packages/adapters/src/anthropic/messages.ts';
import { toChatMessages } from './packages/adapters/src/http/chat.ts';

// Usage: tsx wire.mts <spec file> <block index>
const [path, index] = process.argv.slice(2);
const loaded = parseSpecText(readFileSync(path as string, 'utf8'), 'yaml', path);
if (!loaded.ok) throw new Error(`${path} is not a valid spec`);
const { prefix } = canonicalGiven(loaded.spec, Number(index));
console.log('chat completions:');
for (const message of toChatMessages(prefix)) console.log(`  ${JSON.stringify(message)}`);
console.log('anthropic:');
const { messages } = toAnthropicMessages(prefix, new WireNames([], ANTHROPIC_NAME));
for (const message of messages) console.log(`  ${JSON.stringify(message)}`);
```

```sh setup
tsx wire.mts out/running-tool-history/paired.yaml 0
```

```text
$ tsx wire.mts out/running-tool-history/paired.yaml 0
chat completions:
  {"role":"user","content":"Is fiber available at 3 Orchard Way, Acmeville?"}
  {"role":"assistant","content":null,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"coverage.check","arguments":"{\"address\":\"3 Orchard Way, Acmeville\"}"}},{"id":"call-h1","type":"function","function":{"name":"catalog.search","arguments":"{\"category\":\"home\",\"address_id\":\"addr-0042\"}"}}]}
  {"role":"tool","tool_call_id":"call-1","content":"{\"found\":true,\"address_id\":\"addr-0042\"}"}
  {"role":"tool","tool_call_id":"call-h1","content":"{\"plans\":[\"fiber-300\"]}"}
  {"role":"assistant","content":"Yes, Acme Fiber 300 is available at 3 Orchard Way."}
  {"role":"user","content":"The coverage map was refreshed today."}
anthropic:
  {"role":"user","content":[{"type":"text","text":"Is fiber available at 3 Orchard Way, Acmeville?"}]}
  {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"coverage_check","input":{"address":"3 Orchard Way, Acmeville"}},{"type":"tool_use","id":"toolu_h2","name":"catalog_search","input":{"category":"home","address_id":"addr-0042"}}]}
  {"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":"{\"found\":true,\"address_id\":\"addr-0042\"}"},{"type":"tool_result","tool_use_id":"toolu_h2","content":"{\"plans\":[\"fiber-300\"]}"}]}
  {"role":"assistant","content":[{"type":"text","text":"Yes, Acme Fiber 300 is available at 3 Orchard Way."}]}
  {"role":"user","content":[{"type":"text","text":"The coverage map was refreshed today."}]}
(exit 0)
```

How to read it:

* On chat completions, the first call keeps `call-1` and the second gets `call-h1`. Each `tool` message answers its own call.
* On Anthropic, the first `tool_use` keeps `call-1` and the second gets `toolu_h2`: Anthropic counts every call. Each `tool_result` names its own `tool_use_id`.
* The free tool note is user text on both wires, after the assistant's reply text.

The same prefix on the crewai adapter. A crew takes its history as text inputs, so with its default inputs the adapter refuses the two recorded calls before the crew starts. The script below runs the spec through the runner on a stand-in crew, with no Python and no model. It exits 1 when the run does not complete:

```ts file=crew.mts
import { readFileSync } from 'node:fs';
import { crewaiAdapter, crewaiInputs } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { parseSpecText, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';

// Usage: tsx crew.mts <spec file> [inputs]. A stand-in crew, no Python and no model: it answers every kickoff.
// It exits 1 when the run did not complete.
const [path, mode] = process.argv.slice(2);
const loaded = parseSpecText(readFileSync(path as string, 'utf8'), 'yaml', path);
if (!loaded.ok) throw new Error(`${path} is not a valid spec`);
const transport = {
  kind: 'http' as const,
  reportsTools: false,
  kickoff: async () => ({ raw: 'Acme Fiber 300 is 40 dollars a month.' }),
};
// Your own inputs: the default text inputs, plus the recorded calls as JSON in a field of their own.
const withCalls = (...args: Parameters<typeof crewaiInputs>) => ({
  ...crewaiInputs(...args),
  tool_calls: JSON.stringify(args[0].flatMap((message) => message.tool_calls ?? [])),
});
const adapter = crewaiAdapter(mode === 'inputs' ? { transport, inputs: withCalls } : { transport });
const run = await runSpec(loaded.spec, { adapter, driver: createScriptedDriver(), checks: defaultChecks(), mode: 'F', repeat: 0 });
console.log(`status ${run.status}, ${run.blocks.length} block(s) run${run.error ? `\n${run.error}` : ''}`);
process.exitCode = run.status === 'completed' ? 0 : 1;
```

```sh setup
tsx crew.mts out/running-tool-history/paired.yaml # exit 1
tsx crew.mts out/running-tool-history/paired.yaml inputs
```

```text
$ tsx crew.mts out/running-tool-history/paired.yaml
status failed, 0 block(s) run
open on block 0 failed: AgentFailure: crewai: the Given prefix (origin authored) holds 2 recorded tool call(s), and a crew takes its history as text inputs, so its agents would read them as prose, not as tool results. Write those turns as blocks the crew runs, or pass `inputs` that hand the calls to the crew in a form it reads as records.
(exit 1)
$ tsx crew.mts out/running-tool-history/paired.yaml inputs
status completed, 1 block(s) run
(exit 0)
```

The run fails before any block: no block is recorded, and the error is the run's. With the adapter's `inputs` option, nothing is refused and the block runs. Here `inputs` gives the default text inputs, plus the recorded calls as JSON in a field of their own.

## Common errors

A prefix with tool calls and `origin: recorded` or `origin: authored` on the crewai adapter, with its default inputs, fails the run with this error:

```text
crewai: the Given prefix (origin recorded) holds 2 recorded tool call(s), and a crew takes its history as text inputs, so its agents would read them as prose, not as tool results. Write those turns as blocks the crew runs, or pass `inputs` that hand the calls to the crew in a form it reads as records.
```

The origin in brackets is the prefix's own. The number is the count of recorded calls in the messages the spec wrote. Write those turns as blocks the crew runs, or set the adapter's `inputs` option.

| Message or symptom | Cause | Fix |
|---|---|---|
| The agent calls a tool again that the prefix already shows | the earlier result is only in the assistant's text, or the call has no `output` | record the call with its `output` in `tool_calls` |
| The request shows `call-h1` or `toolu_h2` where the prefix wrote `call-1` | the prefix repeats an id within one turn, so the compiler gave a fresh one | none needed; give each call of a turn its own id to keep yours |
| A `role: tool` line of the prefix reaches the model as a user message | the message answers no call, and a tool result needs its call | expected; to send a tool result, put it in the call's `output` |
| A cell reads `not_run` with `declares seedPrefix false`, exit 3 | the block starts from a prefix or from the mode T history, and the adapter cannot seed one (`nexus`, live Claude Code) | run the spec on an adapter that seeds a history, or write the earlier turns as blocks and run mode F |
| A cell reads `not_run` with `declares toolStubs false`, exit 3 | `world.tools` forces a tool result, and the adapter cannot apply it (`process`, `http` by default, `crewai`, `langgraph`, `openai-agents`, `pydantic-ai`, `nexus`, both Claude Code adapters) | run the spec on an adapter with `toolStubs`, or drop the forced result |
