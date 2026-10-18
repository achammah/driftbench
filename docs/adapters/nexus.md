# nexus adapter

Status: shipped, phase 1. It passes the [contract suite](index.md#the-contract-suite) in chat mode, against a fake of the platform's public API that serves recorded answer shapes with fictional values. It has not run against a live agent yet; the points to confirm on the first live run are listed [below](#not-yet-observed-on-a-live-run).

The nexus adapter reaches an agent on the Nexus platform through its public API. It is one adapter among others; the core never imports it.

From the command line, a spec whose target is `nexus:<agent id>` with `target.deployment` reaches this adapter with no code, when `NEXUS_API_KEY` is set: see [targets from settings](../running.md#targets-from-settings).

## CLI target credential handling

::: warning Successful replies and sensitive stores
A successful reply is stored as the agent sent it, except for the redactions described here. The CLI scans for literal keys, percent, base64, base64url and hex encodings, and all 16 ordered two-level compositions of those encodings, including `base64(percent(key))`. It also scans the encoded `Bearer <key>` forms. A key echoed in another form can remain in results. Keys split across fields are not detected; deeper or unlisted encodings are outside this protection. Use a test-scoped key and treat the results store and cache as sensitive.
:::

**CLI error-path guarantee:** with `target.options.debug_error_body` absent or false, upstream error bodies, headers and thrown transport details never enter output or storage. Diagnostics contain only fixed messages, status, request host and body length when known. `debug_error_body: true` is an explicitly unsafe opt-in to error-body disclosure. This guarantee belongs to the CLI target wrapper; directly constructing the library adapter does not install that wrapper.

## Settings

| Setting | Meaning |
|---|---|
| `NEXUS_API_KEY` | the API key, read from the environment. Requests send it in the `api-key` header. An endpoint can echo it; the CLI protection and its limits are described above. Without it, `open` fails before any request. |
| `NEXUS_BASE_URL` | the server, read from the environment. Default `https://api.nexusgpt.io`. Every path sits under `/api/public/v1`. |
| `target.agent` | the agent id. Required. |
| `target.deployment` | a deployment id of that agent. Required. |
| `target.variant` | the prompt variant: a name, an id, or `main`. Without it, the agent's live prompt. |
| `target.options.stubs` | a mapping from tool label to the id of the workflow that records that tool's payloads |

```ts
import { nexusAdapter } from '@agent-nexus/driftbench-adapters';

const adapter = nexusAdapter({ keepConversations: false });
```

| Option | Meaning |
|---|---|
| `env` | where the two variables are read. Default `process.env`. |
| `fetch` | the fetch to use. Default the global fetch. |
| `timeoutMs` | the most milliseconds an ordinary request may take. Default 30000. |
| `generateTimeoutMs` | the most milliseconds a generate may take: it runs the whole agent turn, tools included. Default 600000. |
| `traceWaitMs` | how long `trace` waits for the platform to finish writing a turn's trace. Default 60000. |
| `pollIntervalMs` | the wait between two reads while `trace` waits. Default 2000. |
| `keepConversations` | keep the golden conversations the adapter creates, for inspection on the platform. Default false. |

The agent's tools run live when it generates. Point every tool with a side effect at a recording stub workflow before a run, and name the stub in `target.options.stubs`.

## How a session runs

* `open` creates a golden conversation for `target.agent` on `target.deployment`, under the variant: `POST /prompt-eval/golden-conversations`. The session id is the conversation id. The history starts as a fresh array of the shared frozen prefix messages, the runner's record; the platform conversation holds no turn of it.
* `send` posts each user message of the block (`POST .../turns/user`), generates the agent's turn (`POST .../generate`), and accepts it (`POST .../accept`) so the next block builds on it. It returns the generate view: the turn's tool calls with their outputs, then its final text. A send the runner retries for the same block resumes where it stopped: a user turn already posted is not posted again, and a generated turn is accepted without a second generate.
* `trace` reads the same turn whole from the platform's tracing, through the emulator session the generate opened. Each generation of the turn adds its reply text, then each tool call it asked for, followed by the call's result. The generation's cost, tokens and duration sit on its first segment. The block's cost is their sum, and its latency the span from the first start to the last end. The adapter waits while a trace is in progress or a generation is pending or running, polling every `pollIntervalMs`, and fails with `AdapterTransportError` after `traceWaitMs`.
* `close` deletes the golden conversation, unless `keepConversations` is set. A conversation already gone counts as deleted. The emulator sessions a generate opens are left to the platform.

The generate view holds only the final text of a turn. Text the agent sends before a tool call is in the trace only, so the runner calls `trace` after every `send` when the adapter offers it, and the trace replaces the view.

## Cards

A call of `send_message` or `display_html` adds a `card` segment of that name after the call's result. A call of `send_html_template_<name>` adds a card named `<name>`. The card's data is the call's input.

## End state

* `endState(session, 'tool:<label>')` reads the executions of the stub workflow named for that label, newest first, from ten minutes before the session opened, 20 per page and 3 pages at most. It returns the trigger data of the newest execution that carries a call this session made of that tool: every field the agent sent, with the same value. A tool this session never called reads undefined. A label with no stub is a configuration error.
* `endState(session, '*')` lists, for each call this session made of a stubbed tool, in the order of the calls, the oldest payload that call carries and no earlier call claimed, as `{ tool, input }`. A traced block's calls replace the generate view's calls for that block, so one call never counts twice. A tool with no stub is invisible to `*`, and so to `end_state: none`.

## Errors

| What happens | Error |
|---|---|
| no connection, a timeout, status 408, 429 or any 5xx, a trace still incomplete after `traceWaitMs` | `AdapterTransportError` with the status and the `Retry-After` wait: the runner retries under the [shared policy](../retries.md) |
| any other failing status | `AgentFailure`, with the platform's `error.code: error.message` |
| an answer that lacks a field the adapter reads | `AgentFailure` that names the field |

## Capabilities

`variants`, `trace` and `endState` are on. `seedPrefix` is off: the public API cannot store an agent turn without generating it, and generating runs the tools live, so the agent could never see a spec's prefix: a block with one is `not_run`. `toolStubs` is off: the platform cannot force a tool result, so a block with a forced result in `world.tools` is `not_run` too. `deterministic` and `sandbox` are off.

The version is `0.1.0+` and a hash of the base URL.

A variant resolves to its latest version when the conversation is created, while the runner's cache key holds the variant's name. After the prompt changes under the same name, run with the cache off.

## Runtime vocabulary

The adapter maps the Nexus runtime onto the four concepts of driftbench. See [adapters](index.md#runtime-vocabulary).

| Nexus | Maps to | Checked with | Mapped today |
|---|---|---|---|
| a tool call | a tool call | `expect.tools` | yes |
| a message card | a card | `expect.cards` | yes |
| a write to a board | a tool call labelled `board.<op>` | `expect.tools` | no |
| a process step | a stage; the process is the spec's `stages` catalogue | `expect.stage` | no |
| a hook that ran | a guard, with its verdict | `expect.guards` | no |
| a skill | a skill | `expect.skills` | no |

The platform's trace of an agent turn carries no board write, process step, hook or skill, so the adapter reports tool calls and cards only.

## Not yet observed on a live run

These readings follow the API's response contract and the recorded shapes; a live run confirms them.

* The token counts of a generate answer are read as `{ input, output }`.
* A failed tool inside a trace's tool result is read from `is_error`; without it, the text is the output.
* The traces of a generate session hold only the generated turn.
* Two user turns in a row are accepted: a `burst` posts one turn per message.
* The executions list accepts a full ISO time as its start date.
* A stub's trigger data carries the tool's input field for field.

Two sessions that send the identical payload to one stub at the same time cannot be told apart; the end state is the same payload either way.

## Judge

The Nexus platform also offers a system 1 judge, Jev. Its client is `createJevJudge` in `@agent-nexus/driftbench-judges`: id `jev`, class system 1. It asks one yes or no question per criterion and reads the probability of yes: 0.6 or more is a pass, 0.4 or less a fail, anything between inconclusive. It reads `JEV_URL`, `JEV_API_KEY` (sent as a bearer token) and `JEV_MODEL` (default `jev-latest`) from the environment. Its request and answer shapes follow the provider's published format and have not been confirmed by a live call. See [judges](../concepts/judges.md).

## Pointer reader labeler

The same Jev service fills the system 1 class of the estate pointer reader ([estate](../estate.md)), and it is the system 1 client of the default stack. Its ids are `jev` (the numbered window is the state of one request, up to 250 questions) and `jev-unit` (one request per unit). It asks one yes or no question per unit and label, keyed `u<n>__<label>`, and records the probability of yes of each question in the cassette, so a threshold is a setting of a replay and not of a new call. It reads `JEV_API_KEY`, `JEV_URL` (or `JEV_ROUTE`, `gateway` or `typesafe`) and `JEV_MODEL` (default `jev-latest`) from the environment, and records the `usage` the endpoint reports.

* A unit takes the label with the highest probability at or above `--labeler-threshold`. The default is 0.4 for `jev` and 0.7 for `jev-unit`.
* In a stack with a system 2 labeler, Jev decides a unit alone only from `--labeler-pass-at` (default 0.9) for a label, or under `--labeler-fail-at` (default 0.1) for every label.
* The size of a request is a budget of the endpoint, not a count: 1,002 questions in one request were answered on the fixture and 1,500 were refused with `max_tokens_exceeded`. A refused request is recorded as a refusal, the window is halved, and each half is asked again.
* A label that asks for a target (`target: required`) is never asked of Jev: a probability names no other unit. In a stack that label is left to the system 2 labeler.
* Its request and answer shapes follow the provider's published format.

## Target

```yaml
target:
  adapter: nexus
  agent: <agent id>
  deployment: <deployment id>
  variant: candidate
  options:
    stubs:
      order.create: <workflow id>
```

The adapter does not send prompt text: the platform runs its own prompt variants. A target with a prompt (`campaign run --prompt`) is refused at open, with the message to push that version to the agent as a variant and name it in `target.variant`. See [datasets](../datasets.md#the-prompt-reaches-the-agent).
