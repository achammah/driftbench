---
title: Adapters for every agent framework
summary: Every adapter driftbench ships (function, http, litellm, nexus, process, OpenAI Agents, Anthropic, Google, LangGraph, CrewAI, Vercel AI, Pydantic AI, Claude Code). Which ones the command line reaches by itself. How to bring any of them into the command line with a plugin.
commands:
  - campaign run
see_also:
  - running-plugins
  - running-targets
  - running-targets-from-settings
  - running-process-and-sandboxes
  - running-recordings
next:
  - running-plugins
---

## What it is

An adapter connects the runner to one kind of agent. It opens a session and sends one block. It returns what the agent did (text, tool calls, stages, skills, guards, commands, files, cost) in driftbench's Observed record. All adapters live in the package `@agent-nexus/driftbench-adapters` and pass the same contract suite, so every spec, check, judge and statistic works on any of them. The command line reaches some adapters by itself. You build the others in code with your own client or SDK object, and they reach the command line through a plugin.

## When to use it

* Pick the adapter that matches how your agent is built. If the command line reaches it from settings, you need no code (topic running-targets-from-settings).
* If your agent is an SDK object, write a ten-line plugin that builds the adapter and registers it under a target name (topic running-plugins). An SDK object is an OpenAI Agents agent, a LangGraph graph, a CrewAI crew or a Vercel AI call. It can also be an Anthropic or Gemini client with tools, or a Pydantic AI agent.
* If your agent is a Python function, the Python package runs it: `run_specs(..., agent=...)` in `python/driftbench` passes it to the CLI through a process target.
* If you have a hand-made transport, write your own adapter and run the contract suite on it (`examples/adapter-contract`).

## Commands and every option

| Adapter | Factory (from code) | Reaches | From the command line |
|---|---|---|---|
| function | `functionAdapter({ create, respond, payloads, deterministic })` | an async function in the same process | `function:acme-sales`, `function:acme` (the Acme example); any other through a plugin |
| http | `httpAdapter({ url, headers, endStateUrl, closeUrl, timeoutMs, maxToolRounds })` | an endpoint that speaks JSON, answering with an Observed or an OpenAI-compatible chat completion | `http:<agent>` from `target.options` or `DRIFTBENCH_HTTP_URL` |
| litellm | `litellmAdapter({ client, model, system, maxTokens, maxSteps })` | a model behind a LiteLLM proxy or any OpenAI-compatible endpoint; the adapter closes the tool loop | `litellm:<model>` from `target.options` or `LITELLM_BASE_URL` |
| nexus | `nexusAdapter({ env, timeoutMs, generateTimeoutMs, keepConversations })` | an agent on the Nexus platform, through a deployment | `nexus:<agent id>` with `target.deployment` and `NEXUS_API_KEY` |
| process | `processAdapter({ command, args, provider, keep, stimulus, env, timeoutMs, deterministic })` | a code-interpreter agent run as a command in a local or docker sandbox | `process:acme-ops`; any `process:<name>` with `--process-command` |
| openai-agents | `openaiAgentsAdapter(...)` | an agent built with the OpenAI Agents SDK, run by your runner; guardrails map to guards, handoffs to stages | plugin |
| anthropic | `anthropicAdapter(...)` | an agent on the Anthropic Messages API through your client; the adapter closes the tool loop | plugin |
| google | `googleAdapter(...)` | an agent on the Gemini API through your client; the adapter closes the tool loop | plugin |
| langgraph | `langgraphAdapter(...)` | a compiled LangGraph graph whose state holds `messages`, with or without a checkpointer; interrupts map to cards | plugin |
| crewai | `crewaiAdapter(...)` | a CrewAI crew in a Python process through a bridge, or deployed on CrewAI AMP over HTTP | plugin |
| vercel-ai | `vercelAiAdapter(...)` | an agent run by the Vercel AI SDK's `generateText` | plugin |
| pydantic-ai | `pydanticAiAdapter(...)` | a Pydantic AI agent in a Python process through a bridge | plugin |
| claude-code (replay) | `replayAdapter({ session, fromBlock, files })` | a recorded Claude Code session (transcript, guard decision log, step feed), replayed with no model call | the `replay` command (validate area) |
| claude-code (live) | `claudeCodeLiveAdapter(...)` | the runtime's headless command, in a sandbox holding a copy of the estate | `estate run` (validate area) |

The options of each factory, and the status of each adapter, are in `docs/adapters/<adapter>.md` of the repository. Each adapter reports its capabilities (`deterministic`, `sandbox`, `readArtifact`, `variants`, `toolStubs`, `trace`, `endState`). A check that needs a capability the adapter lacks gives `inconclusive`, not a pass.

## Inputs

* For a plugin adapter: the SDK object or client you build in the plugin, with your own keys read from the environment. A key never goes in a spec.
* The spec's `target:`: `adapter` is the name you register (such as `echo`). `agent` is passed to your factory. The factory may serve several agents or return nothing for a name it does not know.

## Outputs and how to read them

Every adapter feeds the same run record, so the output is the same as for any target (topic running-outcomes). What differs is what the agent reports. A chat SDK gives text and tool calls. A code agent also gives commands, a workspace diff and artifacts. A runtime with hooks gives guards. Checks that read something the adapter does not report are inconclusive.

## Worked example

The committed plugin `examples/plugins/plugin.mjs` registers a function adapter under the name `echo` (an agent that repeats the user) and a custom check `polite`. The spec `examples/plugins/specs/hello.yaml` names the target `echo:demo`. Any SDK adapter is wired the same way: replace `functionAdapter(...)` with, for example, `openaiAgentsAdapter(...)` built on your agent. No model is called.

```sh
driftbench campaign run examples/plugins/specs/hello.yaml --plugin examples/plugins/plugin.mjs
driftbench smoke examples/plugins/specs/hello.yaml --plugin examples/plugins/plugin.mjs
```

```text
✓ plugins-hello · echo:demo · F · repeat 0  pass  1 block
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

```text
Smoke: plugins-hello on echo:demo, 3 runs, cache off.
  run 1  completed  1 block  transcript c94edecabdbb
  run 2  completed  1 block  transcript c94edecabdbb
  run 3  completed  1 block  transcript c94edecabdbb
✓ The transcripts are identical.
```

The adapter part of the plugin file is two lines. The first is an `echoAgent(messages)` function that returns an Observed record (`segments`, `text`, `toolCalls`, `cost`, `latencyMs`). The second is `api.adapter('echo', () => functionAdapter({ respond: echoAgent, deterministic: true }))` inside the default export `plugin(api)`. Read the whole file at `examples/plugins/plugin.mjs`.

## Common errors

* `No adapter is set up for echo:demo, the target of plugins-hello. ...` (exit 2) The spec names a plugin adapter and no plugin is loaded. Add `--plugin <module>` or `plugins:` in `driftbench.yaml`.
* `driftbench: Cannot load the plugin <module>: Cannot find module ...` (exit 2) The plugin path is wrong. Or its SDK is not installed where the plugin file can import it.
* A check reads `inconclusive` on every block with an SDK adapter: the SDK does not report what the check needs (stages, skills, end state). Add it in your adapter, or make the expectation non-gating.
* `smoke` reports differing transcripts on a model behind an adapter that claims `deterministic: true`: the claim is false for that model. Declare it only for a seeded or replayed agent.
