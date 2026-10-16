---
title: Run modes T, F and P
summary: 'The three run modes (teacher-forced T, free-running F, perturbed P): what each block starts from and measures, what a model reads for a past call with no recorded result, --mode, and the compounding index.'
commands: []
see_also:
  - running-campaign-run
  - running-campaign-plan
  - running-campaign-status
  - running-cells-and-repeats
  - running-simulate
  - running-smoke
  - running-change-carry
  - authoring-prefixes
next:
  - running-cells-and-repeats
---

## What it is

Every spec, conversation or task, can run in three modes. Each answers a different question about the same blocks.

| Mode | What block k starts from | What it measures |
|---|---|---|
| `T`, teacher-forced | its canonical Given: the spec's own earlier blocks as written, never the agent's own replies. Each block opens its own session. The agent must be able to receive that history (`seedPrefix`): on `nexus` and the live Claude Code adapter every block after the first is `not_run`. | local competence: each block alone, with no earlier mistake carried in. |
| `F`, free-running (the default) | the agent's own earlier replies, in one session; the user turns come from the spec (or a simulated user) | compounding: one wrong block can poison the blocks after it. |
| `P`, perturbed | a free-running run with one deviation injected at a chosen block | recovery: whether the agent comes back, how fast, and at what cost. |

Details that change results:

* In T, the canonical history of block k is the latest `given.prefix` up to k, then for each earlier block its user messages and a canonical assistant message: empty text, carrying the tool calls the block expects with the inputs the spec pins and the results the spec's world forces. An agent that reads its own earlier replies sees blank assistant turns. An adapter that sends the history to a model sends a past call with no result the world forces with the text "Not recorded: this earlier call comes from a replayed conversation that states the call, with only the arguments it fixes, and not what it returned." as its result, never `null`; force the tool's result in `world.tools` to give the agent a real one. The checks of a T block see no earlier block. The end state is read after every block and composed. A driver that injects a block in T fails the run.
* On a sandboxed agent (a `process` target), a T step keeps the workspace the step before left, and only its history is reset; a step that writes its own `given.world.workspace` starts from exactly that.
* In P, each perturbation the spec declares makes its own cells. A perturbation with a `user` or `burst` message is sent as an extra block before block `inject_at`. One that writes only a `world`, such as a tool forced to fail, runs in place of block `inject_at`. The run then has as many blocks as the spec. The spec's end state is neither read nor compared in P. Each P run takes the F run of the same spec, target and repeat in the campaign as the reference for its recovery metrics.
* A spec that declares no perturbation makes no P cell.

The compounding index is the T pass rate minus the F pass rate, over the spec blocks both modes ran (injected blocks left out). High T with low F means the agent is right block by block and fragile across the conversation. `campaign status --detail` prints it per spec with a clustered bootstrap interval (topic running-campaign-status).

### A past call with no recorded result

In mode T, the canonical history holds every tool call an earlier block expects. Such a call has a result only when the spec's world forces one for its tool. In the Acme examples most canonical calls have no forced result.

What the agent reads of such a call depends on the adapter:

| Adapter | What the agent reads for a call with no recorded result |
|---|---|
| `function` | the call as it is, with no output. The Acme agent then reads that tool again from its own store. |
| `anthropic`, `google`, `http`, `litellm`, `langgraph`, `openai-agents`, `pydantic-ai`, `vercel-ai` | a text result that says the result was not recorded, quoted below. It is never `null`. |
| `process`, `nexus`, live Claude Code | nothing: these adapters do not hand a prefix to the agent (no `seedPrefix` capability). |

The text the model reads as the call's result:

> Not recorded: this earlier call comes from a replayed conversation that states the call, with only the arguments it fixes, and not what it returned.

Why a note and not `null`: `null` tells the model that the tool returned nothing. No one recorded that, so it would be a false history.

Three more rules:

* A recorded output is sent as it is, `null` included. Only a call with neither an output nor an error gets the note.
* The call's arguments are only the input fields the spec pins to an exact value. A field pinned with a pattern (`regex`, `contains`) or with `absent` is left out. Such a call goes out with fewer arguments, or none.
* The same rule applies outside mode T to any history call with neither an output nor an error. An SDK adapter's own loop always records one of the two. So in modes F and P it happens only when an http endpoint returns a `tool_call` segment with no matching `tool_result`. The next request of that run then carries the note.

The canonical history itself does not change. The Given hash, the cache keys and the spec hash stay as they were. Only what a model adapter sends for such a call changed.

## When to use it

* `F` alone: the default, the closest to real use.
* `T,F`: to tell local mistakes from compounding ones. T is also what `--block-reruns` needs (topic running-change-carry).
* `F,P` or `T,F,P`: to measure recovery after the deviations the spec declares (topic running-campaign-status for the recovery table). Write perturbations in the spec's `perturbations:` (authoring area); to inject one deviation at a chosen block from the command line, use `driftbench perturb` (authoring area); for an adaptive attacker, `driftbench attack` (redteam area).

For a past call with no recorded result:

* Force the tool's `result` or `error` in `world.tools` when the agent must reason from a real earlier result in mode T. The model then reads that value, not the note.
* Leave it unforced when the block does not depend on what the earlier call returned. The model reads that the result is unknown, which is true.
* Do not read a mode T failure on a model adapter as an agent fault before you check the history. An agent that needs the earlier result may call the tool again, or say it does not know.

## Commands and every option

The mode is an option of the commands that run cells. Their other options are in running-campaign-run, running-campaign-plan and results-ci.

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--mode <modes>` | `campaign plan`, `campaign run`, `ci` | `F` | `T`, `F`, `P`, or several separated by commas such as `T,F,P`. Spaces around a mode are ignored; a mode named twice counts once; cells always come in the order T, F, P whatever order you write. |
| `modes:` | the `campaign:` key of the config | none | a list such as `[T, F]`. |
| `--repeats <n>` | `campaign plan`, `campaign run` | `1` | the repeats apply to every mode named. |

`smoke` and `simulate` always run in mode F. `campaign resume` runs the modes the campaign was created with.

The note for a call with no recorded result has no option. It is on for every adapter in the table above. To give the agent a real result, the spec forces one:

| Spec key | Where | Effect on the canonical history |
|---|---|---|
| `given.world.tools.<tool>.result` | the spec's `given` or a block's `given` | each canonical call of that tool from that block on carries this output |
| `given.world.tools.<tool>.error` | the same | each canonical call of that tool carries this error |

## Inputs

The specs. Mode P reads each spec's `perturbations:` list (each with an `id`, a deviation `class` such as `D8_tool_failure`, an `inject_at` block, and what it injects).

For mode T on a model adapter, the spec's `world.tools` decides which canonical calls carry a result. A minimal spec that forces one:

```text
given:
  world:
    tools:
      catalog.search:
        result: { plans: [mobile-m, mobile-l] }
```

## Outputs and how to read them

* Each cell line names its mode, and a P cell its perturbation: `✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks`.
* `campaign plan` prints one minimum detectable effect line per mode; in P the runs per arm count every perturbation.
* `campaign status --detail` prints the compounding index (T against F), the succession of every run, and the recovery of every P run.
* Run records carry `mode` as `T`, `F` or `P`.

What a model adapter sends for a past call shows in the request it makes, not in a driftbench output. The worked example prints the chat request of the http adapter for one mode T block. Read it this way:

* An `assistant` message with `tool_calls`: one past call, with the arguments the spec pinned exactly.
* The `tool` message right after it, with the same `tool_call_id`: what the model reads as that call's result.
* A `content` that holds the "Not recorded" text: no result was recorded or forced for that call.
* A `content` that holds JSON: the result the world forced, or the output a prefix recorded.

## Worked example

The Acme price-sheet task runs in all three modes on its own target. Then the plan-upgrade conversation runs in P and T: written in that order, run in the order T, P. No model is called.

```sh
driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --mode T,F,P --campaign modes-task
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode P,T --campaign modes-chat
```

```text
✓ acme-price-sheet · process:acme-ops · T · repeat 0  pass  2 blocks
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
✓ acme-price-sheet · process:acme-ops · P · repeat 0 · instruction-in-notes  pass  2 blocks
3 cells: 3 pass, 0 fail, 0 failed. Spent $0.00.
```

```text
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · order-service-down  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · loose-ok  pass  6 blocks
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.00.
```

The task's perturbation `instruction-in-notes` only changes the workspace, so its P cell has 2 blocks, like the spec. The conversation's `billing-aside` and `loose-ok` add a user block (6 blocks); `order-service-down` only forces a tool to fail (5 blocks). The second campaign has no F cells, so its P runs have no F reference run for their collateral; run `F,P` or `T,F,P` together for full recovery metrics.

### What a model reads for a past call

The script below builds the mode T history of block 2 of the plan-upgrade spec, as the runner does. It then prints the chat request the http adapter would send for it. No model is called.

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

```ts file=history.mts
import { readFileSync } from 'node:fs';
import { canonicalGiven, parseSpecText } from '@agent-nexus/driftbench-core';
import { toChatMessages } from './packages/adapters/src/http/chat.ts';

// Usage: tsx history.mts <spec file> <block index>
const [path, index] = process.argv.slice(2);
const loaded = parseSpecText(readFileSync(path as string, 'utf8'), 'yaml', path);
if (!loaded.ok) throw new Error(`${path} is not a valid spec`);
const { prefix } = canonicalGiven(loaded.spec, Number(index));
for (const message of toChatMessages(prefix)) console.log(JSON.stringify(message));
```

The same spec, with the catalog result forced for every block:

```yaml file=out/running-modes/forced.yaml
# Fictional data only. The plan-upgrade conversation with the catalog result forced.
id: forced-catalog
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, closing]
ledger_seed: { customer: existing }
given:
  world:
    tools:
      catalog.search:
        result: { plans: [mobile-m, mobile-l] }
blocks:
  - user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
    expect:
      stage: identify
  - user: It's sam.rivera@example.com
    expect:
      stage: offer
      tools:
        - label: catalog.search
          input:
            category: mobile
            customer_email: sam.rivera@example.com
            address_id: { absent: true }
  - user: The unlimited one, please.
    expect:
      stage: recap
```

```sh setup
tsx history.mts examples/acme/specs/conversations/plan-upgrade.yaml 2
tsx history.mts out/running-modes/forced.yaml 2
```

```text
$ tsx history.mts examples/acme/specs/conversations/plan-upgrade.yaml 2
{"role":"user","content":"Hi, I'm already an Acme customer and I keep running out of data on my phone."}
{"role":"assistant","content":""}
{"role":"user","content":"It's sam.rivera@example.com"}
{"role":"assistant","content":null,"tool_calls":[{"id":"call-h1","type":"function","function":{"name":"catalog.search","arguments":"{\"category\":\"mobile\",\"customer_email\":\"sam.rivera@example.com\"}"}}]}
{"role":"tool","tool_call_id":"call-h1","content":"\"Not recorded: this earlier call comes from a replayed conversation that states the call, with only the arguments it fixes, and not what it returned.\""}
(exit 0)
$ tsx history.mts out/running-modes/forced.yaml 2
{"role":"user","content":"Hi, I'm already an Acme customer and I keep running out of data on my phone."}
{"role":"assistant","content":""}
{"role":"user","content":"It's sam.rivera@example.com"}
{"role":"assistant","content":null,"tool_calls":[{"id":"call-h1","type":"function","function":{"name":"catalog.search","arguments":"{\"category\":\"mobile\",\"customer_email\":\"sam.rivera@example.com\"}"}}]}
{"role":"tool","tool_call_id":"call-h1","content":"{\"plans\":[\"mobile-m\",\"mobile-l\"]}"}
(exit 0)
```

In the first history, the `tool` message after the `catalog.search` call holds the "Not recorded" text: the plan-upgrade spec forces no catalog result. The call's arguments hold `category` and `customer_email` only: `address_id` is pinned with `absent`, not an exact value. In the second history, the same `tool` message holds the forced plans as JSON.

## Common errors

* `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` (exit 2)
* `--block-reruns reruns blocks of independent mode T cells: it goes with --mode T.` (exit 2)
* No P cell in the plan: the spec declares no `perturbations:`.
* A T block fails where F passes on an agent that relies on its own earlier replies: T gives it blank assistant turns. That is the design: T measures each block from the scripted history alone.
* A P run whose recovery reads `not measured`: the perturbation declares no `recovery` expectation (authoring area).

| Symptom | Cause | Fix |
|---|---|---|
| In mode T, a model agent calls a tool again that an earlier block already called | the earlier call has no forced result, so the model read the "Not recorded" note | force the tool's `result` in `world.tools`, or accept the second call in the block's `expect` |
| In mode T, a model agent says it does not know a fact an earlier tool call would give | the same: the history states the call but not its result | force the result in `world.tools` from the block that makes the call |
| A past call goes out with fewer arguments than the real agent sent | the spec pins those input fields with a pattern or `absent`, not an exact value | pin the field with an exact value when the arguments matter to the later block |
| An http run in F or P shows the "Not recorded" note in a later request | the endpoint answered with an Observed holding a `tool_call` segment and no matching `tool_result` | return the tool result in the Observed with the call |
| A store made before this change replays mode T cells of a model adapter | cache keys did not change, so old cells replay the old `null` result | run those cells again on a fresh store, or with `--no-cache` |
