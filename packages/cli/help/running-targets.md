---
title: Targets and adapters
summary: How a target is written (adapter or adapter:agent), where it comes from (the spec, --target, --route), which targets the command line reaches and in what order it finds their adapter, and what to do when none is set up.
commands:
  - campaign plan
  - campaign run
  - campaign resume
  - smoke
  - simulate
see_also:
  - running-targets-from-settings
  - running-process-and-sandboxes
  - running-sdk-adapters
  - running-plugins
  - running-cells-and-repeats
  - running-campaign-run
next:
  - running-targets-from-settings
---

## What it is

A target names the agent under test. It is written `<adapter>` or `<adapter>:<agent>`, such as `function:acme-sales`, `process:my-agent`, `http:my-bot` or `litellm:my-model`. The adapter is the piece of driftbench that knows how to send a block to that kind of agent and read back what it did; the agent part is a name the adapter interprets. In a spec, a target is a mapping with more fields:

```text
target:
  adapter: http          the adapter (required)
  agent: my-bot          the agent, as the adapter names it
  variant: v2            a variant of the agent, such as a prompt version; --agent-version fills it
  deployment: dep-1      a deployment of the agent (the nexus adapter needs it)
  options: { ... }       adapter settings, snake case (topic running-targets-from-settings)
  retry: { ... }         how model calls are retried (topic running-retries)
```

`campaign run --prompt` also fills `target.prompt` with a stored prompt version. The whole target (adapter, agent, variant, options, prompt) is part of the cell id and the cache key.

## When to use it

* Every run needs a target. Leave it to the spec (each spec runs on its own `target:`), or force one with `--target`.
* Compare agents on one suite: give `--target` once per agent; each adds a full set of cells.
* Keep a mixed suite on the right agents: `--route <tag=target>` sends the specs carrying a tag to their own target.
* Reach your own agent: through a URL (`http`), an OpenAI-compatible endpoint (`litellm`), the Nexus platform (`nexus`), a command (`process` with `--process-command`), or any adapter a plugin registers.

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--target <adapter[:agent]>` | `campaign plan`, `campaign run` (repeatable); `smoke`, `simulate`, `perturb`, `attack` (once) | each spec on its own target | run on this target instead of the spec's. Only the adapter and agent are given this way: the spec's `options`, `deployment` and `variant` are not carried over, so a target that needs settings reads them from the environment. A spec whose own target names another adapter gets `Note: <spec> names the <adapter> adapter; --target runs it on <target>.` |
| `--route <tag=target>` | `campaign plan`, `campaign run` (repeatable) | none | needs `--target`: a spec whose `tags` hold the tag runs on this target alone. |
| `--process-command <command>` | `campaign run`, `campaign resume` | none | the command behind every `process:<name>` other than `process:acme-ops` (topic running-process-and-sandboxes). |
| `--agent-version <label>` | `campaign run` | none | written as the `variant` of every target that names none. |
| `--plugin <module>` | every command | none | load a plugin, which may register adapters (topic running-plugins). |

Where the adapter of a target comes from, in this order:

1. `function:acme-sales` and its short form `function:acme`: the Acme sales assistant, a deterministic chat agent in process. Pilots also reach `function:acme-random` and `function:acme-random-<seed>`, its seeded random control.
2. `process:acme-ops`: the Acme ops agent, a code agent run as a command in a local sandbox.
3. A plugin adapter: any `<name>:<agent>` whose name a loaded plugin registered. A plugin may register `http`, `litellm` or `nexus` and so replace the built-in target of that name.
4. The built-in targets read from settings: `http:<agent>`, `litellm:<model>`, `nexus:<agent id>` (topic running-targets-from-settings).
5. `process:<name>` for any other name, only when `--process-command` is given.

The Acme targets live in `examples/acme` of the repository: a checkout holds them. An install of the CLI from npm alone does not, and then refuses them with a message saying where they live.

One adapter is made per distinct target in a campaign: two specs naming `http:my-bot` share the options of the first.

## Inputs

* The `target:` of each spec, or `--target`, or a `--route`.
* The `targets:` and `routes:` keys of the config's `campaign:` (topic running-campaign-config).
* Environment variables for the built-in targets: `DRIFTBENCH_HTTP_URL`, `LITELLM_BASE_URL`, `OPENAI_BASE_URL`, `LITELLM_API_KEY`, `OPENAI_API_KEY`, `NEXUS_API_KEY`, `NEXUS_BASE_URL`.

## Outputs and how to read them

* The target shows in each plan row and cell line as `<adapter>:<agent>` (the variant is not shown).
* A refusal prints, on stderr, `No adapter is set up for <target>[, the target of <spec ids>].`, then the setting that is missing when the target is a built-in one, then the targets this install reaches, then `Plugins add the adapters <names>.` when plugins are loaded. The command exits 2 before anything runs: `campaign plan` refuses exactly what `campaign run` would.

## Worked example

One spec planned on three targets; then the price-sheet task on its own target and the conversation suite with a route; then a target with no settings. No model is called.

```sh
driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --target function:acme-sales --target process:acme-ops
driftbench campaign plan examples/acme/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops
driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target process:my-agent  # exit 2
```

```text
Note: acme-plan-upgrade names the function adapter; --target runs it on process:acme-ops.
Plan: 1 spec, 3 targets, mode F, 1 repeat: 3 cells, 15 blocks.
  cell              spec               target               mode  repeat  blocks
  a7013f45bfd4c07b  acme-plan-upgrade  function:acme        F     0       5
```

```text
No adapter is set up for process:my-agent. The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. It also reaches http, litellm and nexus targets from the target.options of a spec.
```

The first plan has one cell per target; the note warns that the chat spec was moved onto the ops agent. The second plan keeps the task on `process:acme-ops` through its tag, with no note. The third is refused: `process:my-agent` needs `--process-command` to say which command runs it.

## Common errors

Each exits 2 and runs nothing.

* `"" is not a target. Write <adapter> or <adapter>:<agent>, such as function:acme.`
* `<spec> names no target. Give the spec a target, or run with --target <adapter[:agent]>, such as --target function:acme-sales.`
* `No adapter is set up for http:my-bot. An http target needs its URL: set target.options.url in the spec, or DRIFTBENCH_HTTP_URL. ...` A `--target http:<agent>` carries no options: export `DRIFTBENCH_HTTP_URL`, or let the spec name its target.
* `No adapter is set up for litellm. A litellm target needs the endpoint: set target.options.base_url in the spec, or LITELLM_BASE_URL. ...`
* `No adapter is set up for nexus:agent-1. A nexus target needs the agent id and target.deployment, a deployment id of that agent, in the spec. ...` A nexus target cannot come from `--target` alone: write it in the spec.
* `No adapter is set up for echo:demo, the target of plugins-hello. ...` The spec names a plugin adapter and the plugin is not loaded: add `--plugin <module>` or list it under `plugins:` in `driftbench.yaml`.
* `The Acme example (function:acme-sales, function:acme, process:acme-ops and the pilot control function:acme-random) is not part of the installed CLI: ...` An npm install without the repository. Work from a checkout to run the Acme targets.
