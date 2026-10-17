# Adapters

An adapter connects driftbench to the agent under test. The runner, the checks and the judges never call an agent directly; they go through an adapter. The core package imports no vendor SDK, and Nexus is one adapter among others.

The contract lives in `packages/core/src/contracts/adapter.ts`. Every adapter ships in `@agent-nexus/driftbench-adapters`. The function, http, nexus and process adapters (phase 1) and the openai-agents, anthropic, google and langgraph adapters (release phase) each pass the contract suite. The Claude Code adapter replays a recorded session, with no model call.

`@agent-nexus/driftbench-adapters` imports no vendor SDK either. The four SDK adapters take the vendor's client, runner or graph from you, and `@agent-nexus/driftbench-adapters` declares `@openai/agents`, `@anthropic-ai/sdk`, `@google/genai` and `@langchain/langgraph` as optional peer dependencies, with the versions the shapes were proven against.

## The contract

```ts
interface AgentAdapter {
  readonly id: string;
  readonly version: string;
  capabilities(): AdapterCapabilities;
  open(given: ResolvedGiven): Promise<Session>;
  send(session: Session, turn: Turn): Promise<Observed>;
  trace?(session: Session, turn: Turn): Promise<Observed>;
  endState?(session: Session, source: string): Promise<unknown>;
  readArtifact?(session: Session, path: string): Promise<Uint8Array>;
  close(session: Session): Promise<void>;
}

type Session = {
  readonly id: string;
  readonly adapter: string;
  readonly target: TargetRef;
  readonly given: ResolvedGiven;
  history: Message[];
  state?: unknown;
};

type Turn = {
  readonly index: number;
  readonly stimulus: Stimulus;
  readonly given: ResolvedGiven;
  readonly budget?: { steps?: number; costUsd?: number; latencyMs?: number };
};
```

* `id` is the name `target.adapter` uses. `version` is part of the runner's cache key.
* `open` creates a conversation or a task session from the resolved Given of a block: prefix, ledger, world, vars and target.
* `send` runs one block and returns everything observed: every segment and every tool call, in order.
* `trace` is an optional richer read of the last block that replaces what `send` returned, for platforms whose traces hold more than their reply.
* `endState` reads an end-state source after the run, for the `end_state` check.
* `readArtifact` reads a file the agent left in its workspace, for the artifact checks. Only an adapter that owns a workspace has it.
* `close` ends the session and releases what it holds. The runner always calls it, also after a failure.

`ResolvedGiven`, `Stimulus`, `Message`, `TargetRef` and `Observed` are zod schemas in `packages/core/src/schema`.

## The history belongs to the runner

`session.history` holds the messages so far. The runner appends the block's user message, or every message of a burst, before `send`, and the agent's reply after it: the text, and each tool call with its output or error. At send time the history ends with the current user turn. An adapter reads the history and never appends to it or changes a message.

A session's history starts as a fresh array of the prefix's shared, deeply frozen messages, whatever the adapter can do with it. The runner freezes each message once when it enters history, including nested content, tool calls and metadata. Adapters must copy a message before changing it; a write to a received message throws in strict mode. Adapters also freeze messages from direct callers at `open` and `send`. A caller editing the same object afterwards gets a strict-mode error; copy before handing it over to retain an editable original. The `seedPrefix` capability says whether the agent itself sees the prefix.

History must be an ordinary dense array of non-null plain message objects. Array subclasses, accessor entries, extra own properties, holes and `undefined` entries are rejected. Entries are captured once from data descriptors; validation and delivery use those same values. Messages and nested values must be plain JSON data: objects with `Object.prototype` or null prototype, ordinary dense arrays, strings, finite numbers, booleans and `null`. Properties must be enumerable string-keyed data properties; arrays have indexed entries only. Boundaries reject accessor properties, class instances, `Date`, `Map`, `Set`, typed arrays, functions, `undefined`, non-finite numbers, symbols, bigints and cycles with a path-specific `TypeError`. Convert special values explicitly and omit absent optional properties; the adapter never invokes getters or `toJSON` to convert them. Validation shares the once-per-message freeze cache. Adapters validate and freeze prefixes before invoking user-supplied setup factories, including tool, agent and context factories.

### Tool history on the wire

An adapter that sends the history to a model sends each recorded tool call as the wire's own tool records, never as text: Anthropic `tool_use` and `tool_result` blocks, Responses `function_call` and `function_call_result` items, Chat Completions `tool_calls` and `tool` messages, and the shapes of Gemini, LangGraph, Pydantic AI and the Vercel AI SDK. One compiler pairs every call of the history with its result before any adapter renders it (`anthropic`, `http`, `litellm`, `openai-agents`, `google`, `langgraph`, `pydantic-ai`, `vercel-ai`):

* Every call goes with a result: its recorded output, its recorded error, or, when the history recorded neither, the value the adapter sends for an unrecorded result. A result follows its own call, in order.
* The calls of one assistant turn have distinct ids, as every wire requires. A recorded id that repeats one of the same turn, after the wire's own character rules, gets a fresh id, so the result still answers its call; an id repeated in another turn is kept, which the wires accept. A call recorded with no id gets the adapter's fallback id, except on Gemini, whose ids are optional: there such a call goes without one, and Gemini pairs it by name and order.
* A `tool` message that answers no call (a free tool note) goes as user text, also on Chat Completions, which refuses a `tool` message without its call.

The crewai adapter takes the history as text inputs: the earlier turns as `role: text` lines, and the whole history, tool calls included, as one JSON string. With its default inputs, it refuses with an `AgentFailure` a Given whose prefix holds tool calls the spec states as a record (`given.origin: recorded` or `authored`): the crew's agents would read them as data in a text field, not as tool results, which is a different test (see [Given](../concepts/given-when-then.md#tool-history-records-not-prose)). The origin covers only the messages the spec wrote (`ResolvedGiven.originLength`): the canonical calls mode T adds after them, a canonical prefix and a prefix whose origin the spec does not state go to the crew as before. Pass `inputs` to hand the calls to the crew your own way.

The write-error guarantee applies to shared host `Message` objects. SDK adapters can build separate wire representations, and processes receive serialized copies; writes to those independent copies need not throw and cannot change host history.

Proxies are rejected. A Proxy history array, a Proxy message or a Proxy nested value fails with a path-specific `TypeError` before any setup factory runs; no `get` trap is called during the check.

## What `send` returns

The Observed of a block validates against the schema, and:

* every tool call is a `tool_call` segment followed by its `tool_result` segment;
* `toolCalls` lists the same calls in the same order, with the same input, output and error;
* `text` is the text segments joined by a newline;
* `cost` and `latencyMs` are present.

## Optional observation assertions

The shared checks apply `tools[].input_closed: true` and `expect.stage_reported: true` to every adapter. Adapters preserve all tool input keys in `toolCalls`; they never filter inputs to the keys a spec expects. Missing, null or malformed input is not evidence of an empty argument object.

`stage_reported` reads only `observed.runtime.stages` for this block and excludes entries marked `carried: true`. The optional `carried` flag preserves an earlier stage for `expect.stage` without claiming a current-block report. Function and HTTP Observed replies can supply stages directly. The process adapter reads current-block runtime events, including stages written by Python `Reply.stage`. OpenAI Agents handoffs, CrewAI task results and Claude Code step-feed events supply their runtime stages. An adapter or turn with no stage report fails this assertion; the runner never creates a report from tool calls or history. The Python `run_specs` wrapper uses this same CLI runner and checks.

Both assertions are optional. Omitted or false preserves the existing checks. See [the spec fields](../reference/spec.md#expect) and [check semantics](../reference/checks.md#stage-and-facts).

## End-state sources

`endState(session, source)` reads one source:

* `tool:<label>` is the last payload that tool received, such as `tool:order.create`. A tool that received nothing reads undefined.
* `*` is every payload the adapter recorded, in order, as a list of `{ tool, input }`. The runner reads it for `end_state: none`, and the check passes only when the list is empty.

Each adapter page says where the payloads come from.

## Errors

| Error | Means | The runner |
|---|---|---|
| `AdapterTransportError` | the transport failed: a 408, a 429, a 5xx, or a network error | retries the call under the [shared retry policy](../retries.md) (4 attempts, backoff from 500 ms with jitter, Retry-After honoured), records each retry in the block, then fails the run; one marked `exhausted` (the adapter already retried it) is not retried again |
| `AgentFailure` | the agent itself failed: an error it threw, an answer that is not an Observed, a failing status | fails the run at once, with no retry |

Any other error fails the run at once too. A failed run is recorded with status `failed` and the error; it is never skipped. See [running](../running.md).

## Capabilities

| Capability | The adapter can |
|---|---|
| `variants` | run a named variant of the agent, such as a prompt version |
| `seedPrefix` | let the agent see a session's prefix, which teacher-forced mode needs. A built-in adapter that sends the prefix to a model sends a past call with no recorded result with a note saying so, never `null`; see [run modes](../concepts/run-modes.md#teacher-forced) |
| `toolStubs` | force tool results and errors from `world.tools` |
| `trace` | offer `trace` |
| `sandbox` | run the agent in a sandboxed workspace, which task specs need; it then offers `readArtifact` |
| `endState` | read end-state sources through `endState` |
| `deterministic` | give the same output for the same input; the [smoke](../running.md#driftbench-smoke) command reports a difference as a broken claim |

| Capability | function | http | nexus | process |
|---|---|---|---|---|
| `variants` | no | as declared | yes | no |
| `seedPrefix` | yes | yes | no | yes: the history file |
| `toolStubs` | yes | as declared | no | no |
| `trace` | no | no | yes | no |
| `sandbox` | no | no | no | yes |
| `endState` | with a payload log | with an end-state URL | yes | no |
| `deterministic` | as declared | as declared | no | as declared |

| Capability | openai-agents | anthropic | google | langgraph | claude-code (replay) |
|---|---|---|---|---|---|
| `variants` | no | no | no | no | no |
| `seedPrefix` | yes | yes | yes | yes | yes |
| `toolStubs` | no: the SDK runs the tools | yes | yes | no: the graph runs the tools | no |
| `trace` | no | no | no | no | no |
| `sandbox` | no | no | no | no | no |
| `endState` | with `sideEffects` | with `sideEffects` | with `sideEffects` | with `sideEffects`, or a checkpointer | no |
| `deterministic` | as declared | as declared | as declared | as declared | yes |

| Capability | crewai | vercel-ai | pydantic-ai | litellm |
|---|---|---|---|---|
| `variants` | no | no | no | no |
| `seedPrefix` | yes | yes | yes | yes |
| `toolStubs` | no: the crew runs the tools | yes: the adapter wraps each `execute` | no: the agent runs the tools | yes |
| `trace` | no | no | no | no |
| `sandbox` | no | no | no | no |
| `endState` | with `sideEffects`, process interface only | with `sideEffects` | with `sideEffects` | with `sideEffects` |
| `deterministic` | as declared | as declared | as declared | as declared |

The four SDK adapters report tokens, never a cost in USD.

The runner uses `trace`, `endState`, `seedPrefix` and `toolStubs` today. A forced tool result in `world.tools` on an adapter without `toolStubs`, and a spec's `prefix` on an adapter without `seedPrefix`, give `not_run: unsupported`: the block is not sent, it is neither a pass nor a fail, and `ci` fails with exit 3 (see [running](../running.md)). The layer is never dropped silently.

## The contract suite

`@agent-nexus/driftbench-adapters/contract` exports `adapterContract(name, makeAdapter, options)`, the suite every adapter passes; its source is `packages/adapters/src/contract.ts`, and `packages/adapters/test/contract.ts` re-exports it for the adapters' own tests. `makeAdapter` builds a fresh adapter for each test. The suite plays the runner: it appends each user message before `send`, checks that the adapter freezes it, and appends a frozen reply afterwards.

It runs in one of two modes. A chat adapter holds the conversation of the Acme Telecom example agent ([`examples/acme`](../../examples/acme/README.md)), tool calls and end states included. An adapter that runs a code agent in a sandbox names a `task` instead: a workspace, two instructions or more, and the file the first one produces. The suite then runs its generic tests on the task's blocks and skips the Acme ones, saying why.

| Test | What it holds |
|---|---|
| names itself and declares every capability | `id` equals the name, `version` is set, the seven capabilities are booleans, and `trace`, `endState` and `readArtifact` exist when `trace`, `endState` and `sandbox` are declared |
| opens a session for the Given | the session carries the adapter, the target and the Given, and its history is a fresh array of the same frozen prefix messages |
| sends a block and returns the whole turn | chat: the Observed follows the rules above, and the Acme agent's two tool calls and its reply all arrive |
| sends a task block | task: the Observed follows the rules above, the workspace diff lists the produced file as created, the artifacts hold it, and `readArtifact` reads it back |
| never appends to the history | `send` leaves the history as it was, and a second send on the same session carries it forward |
| delivers a forced tool error | chat, with `toolStubs`: an error in `world.tools` reaches the tool's `tool_result` segment and `toolCalls` |
| reads the last payload through `endState` | chat, with `endState`: after four blocks that place an upgrade order, `tool:order.create` reads that order, a tool that received nothing reads undefined, and `*` lists the order alone |
| lists no payload for source `*` | chat, with `endState`: `*` is an empty list before the first block and after two blocks that place no order |
| traces the last block | with `trace`: the traced block follows the same rules, with the same tool calls and the sent text |
| releases the session on close | a later `send` rejects, and the adapter's own release probe agrees when one is given |
| throws `AdapterTransportError` when the transport fails | a broken transport fails `open` or `send` with that error |

The function, http and nexus adapters, the four SDK adapters and the four framework adapters run it in chat mode (crewai through its process interface); the langgraph adapter runs it twice, on a graph with a checkpointer and on one without. The SDK adapters run it on fakes that play the Acme agent and refuse what the real API refuses (roles out of order, a dotted Anthropic tool name, an unanswered `tool_use`, a Gemini 3 call sent back without its signature). Their requests are also checked against exchanges the real SDK packages recorded with fake transports (`packages/adapters/test/fixtures/sdk/recorded`). The process adapter runs it in task mode on the Acme price-sheet task, with the fixture code agent of the sandbox tests (`packages/adapters/test/process.contract.test.ts`). A test a capability or the mode rules out is skipped, never failed. Run it from the repository root:

```sh
pnpm vitest run packages/adapters
```


### Run it on your own adapter

The suite is a second entry of the adapters package, so a team proves its own adapter with the tests the built-in ones pass. It registers vitest tests: import it in a vitest test file. `vitest` (3 or later) and `@agent-nexus/driftbench-checks` are optional peers of the package, needed for this entry only.

```ts
// my-adapter.contract.test.ts
import { adapterContract, createAcmeAgent, createStore } from '@agent-nexus/driftbench-adapters/contract';
import { myAdapter } from './my-adapter';

adapterContract('my-adapter', () => myAdapter({ agent: createAcmeAgent(createStore()) }), {
  brokenTransport: () => myAdapter({ endpoint: 'http://127.0.0.1:1' }),
});
```

In chat mode the adapter must reach the reference agent, the Acme Telecom sales assistant: the entry exports it as `createAcmeAgent(store)` and `createStore()`, so you put it behind your transport (a function, a local endpoint, a bridge) the way your adapter reaches a real agent. In task mode (`options.task`) no reference agent is needed. The entry also exports the helpers the built-in tests use: `acmeGiven`, `userTurn`, `sendUser`, `converse`, `replyMessage`, `expectWholeObserved`, and the conversation constants.

[`examples/adapter-contract`](https://github.com/achammah/driftbench/tree/main/examples/adapter-contract) holds a hand-written adapter and the test that runs the suite on it: `pnpm vitest run examples/adapter-contract` reports 10 tests passed and 4 skipped (the capabilities it does not declare).

## The adapters

| Adapter | Reaches | Status |
|---|---|---|
| [function](function.md) | an async function in the same process | shipped, phase 1 |
| [http](http.md) | an endpoint that speaks JSON, answering with an Observed or an OpenAI-compatible chat completion | shipped, phase 1 |
| [nexus](nexus.md) | an agent on the Nexus platform | shipped, phase 1; tested against recorded answer shapes, not yet run against a live agent |
| [process](process.md) | a code-interpreter agent run as a command in a sandbox | shipped, phase 1 |
| [openai-agents](openai-agents.md) | an agent built with the OpenAI Agents SDK, run by your runner | shipped, release phase; contract proven on fakes and on the real SDK with fake transports, not yet run against a live model |
| [anthropic](anthropic.md) | an agent on the Anthropic Messages API, through your client; the adapter closes the tool loop | shipped, release phase; contract proven on fakes and on the real SDK with fake transports, not yet run against a live model |
| [google](google.md) | an agent on the Gemini API, through your client; the adapter closes the tool loop | shipped, release phase; contract proven on fakes and on the real SDK with fake transports, not yet run against a live model |
| [langgraph](langgraph.md) | a compiled LangGraph graph whose state holds `messages`, with or without a checkpointer | shipped, release phase; contract proven on fakes and on the real SDK with fake transports, not yet run against a live model |
| [crewai](crewai.md) | a CrewAI crew, in a Python process through a bridge that reports its tools, or deployed on CrewAI AMP over HTTP | shipped, release phase; contract proven on a fake bridge, the bridge run on the real `crewai` with a scripted model; not yet run against a live model or a deployed crew |
| [vercel-ai](vercel-ai.md) | an agent run by the Vercel AI SDK's `generateText` | shipped, release phase; contract proven on a fake and on the real `ai` package with its mock model; not yet run against a live model |
| [pydantic-ai](pydantic-ai.md) | a Pydantic AI agent, in a Python process through a bridge | shipped, release phase; contract proven on a fake bridge, the bridge run on the real `pydantic-ai` with a `FunctionModel`; not yet run against a live model |
| [litellm](litellm.md) | a model behind a LiteLLM proxy or any OpenAI-compatible chat completions endpoint, the agent loop closed in the adapter | shipped, release phase; contract proven on a fake proxy and on the real `openai` client; not yet run against a live proxy |
| [claude-code](claude-code.md) | a recorded Claude Code session (transcript, guard decision log, step feed), replayed with no model call; also the reader of a Claude Code estate | the session reader, the replay adapter, the estate reader and the live runner are shipped |

## Runtime vocabulary

Every adapter maps its runtime onto the four concepts that specs and checks know: tools, skills, guards and stages. See [block](../concepts/block.md#tools-skills-guards-and-stages). No spec and no check uses a runtime's own names; the mapping lives in the adapter.

* The first example is the Nexus runtime: its mapping is on the [nexus adapter](nexus.md#runtime-vocabulary) page.
* A Claude Code harness is the second:

| Claude Code harness | Maps to |
|---|---|
| a hook that ran, with its decision | a guard, with the decision as its verdict |
| a skill it loads | a skill |
| a shell command | a command it ran, with its exit code |
| any other tool call | a tool call |

Two adapters carry it today:

* The [claude-code adapter](claude-code.md) reads a recorded session: the transcript gives the tool calls, the Skill loads and the shell commands with their exit codes; the hook decision log gives the guards; the step feed gives the stages.
* The process adapter reads what a code agent reports: its skills, guards and stages, and the commands it ran, in two files the adapter reads after each block. See [the process adapter](process.md#what-the-agent-reports).

The SDK adapters map their runtimes the same way:

| SDK runtime | Maps to |
|---|---|
| an OpenAI Agents input or output guardrail result | a guard, `block` when its tripwire fired, `pass` otherwise |
| an OpenAI Agents handoff | a transfer tool call, and a stage named after the agent taking over |
| an OpenAI Agents call waiting for approval | a tool call closed with an error |
| a LangGraph interrupt | a card named `interrupt` |
| an Anthropic thinking block, a Gemini thought part | nothing |

## Choosing the agent in a spec

`target` sets the default agent of a spec: `adapter`, plus `agent`, `variant`, `deployment` and `options`. The adapter decides what the other fields mean, and each adapter page lists them. A run can override the target: the runner takes the target it is given, else the spec's, else `{ adapter: <the adapter's id> }`.

```yaml
target:
  adapter: http
  agent: support-bot
```

The command line reaches the Acme example agents: `function:acme-sales` (or `function:acme`), the sales assistant behind the function adapter, and `process:acme-ops`, the ops agent behind the process adapter. `driftbench pilot` adds its control agent, `function:acme-random`, and `driftbench replay` runs specs on the claude-code replay adapter. The other adapters are used from code. See [running](../running.md).

## Exporting parent end state

A parent-linked child is opened from the parent's recorded conversation, ledger, world and variables. If an adapter owns mutable world state, implement optional `snapshotGiven(session)` to return `{ world, vars }` after each block, and restore those values in `open(given)`. The function adapter exposes the same callback over its agent state; `create(given)` restores it. Snapshots must be JSON data. A sandbox must include its changed workspace. The process adapter implements the hook: its export carries the parent's files byte for byte, text in `world.workspace.files` and every other file (xlsx, docx, pdf, png) in `world.workspace.binary` as base64. A workspace past `exportMaxBytes` (default 50 MB in all) leaves the children `not_run: setup_failed` with the reason. `.git`, `node_modules`, empty folders and file modes do not carry, and a link inside the workspace arrives as a plain copy. See [parent blocks](../concepts/given-when-then.md#parent-blocks). An adapter with a sandbox and no hook leaves its children `not_run: unsupported`. Adapters without private mutable world state inherit the runner-managed Given and recorded history directly. See [parent blocks](../concepts/given-when-then.md#parent-blocks).
