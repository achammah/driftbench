---
title: Plugins for adapters, checks and judges
summary: Load your own code into any driftbench command with --plugin or the plugins key of driftbench.yaml, to register an adapter (so a target name reaches your agent), custom checks, pairwise judges, and the kinds, rules, steps, evidence, prompt templates and objects of the rules framework.
commands:
  - campaign run
  - smoke
see_also:
  - running-sdk-adapters
  - running-targets
  - running-campaign-config
  - running-targets-from-settings
next:
  - running-modes
---

## What it is

A plugin is a JavaScript module of your own that the command line loads before it runs a command. Its default export (or an export named `plugin`) is a function that receives an `api` and registers:

| Call | Registers | Then |
|---|---|---|
| `api.adapter(name, factory)` | an adapter | every target `<name>:<agent>` reaches the adapter `factory(target, scope)` returns. The factory may return `undefined` for an agent name it does not serve. In a campaign, `scope.tempDir()` is the campaign's temporary folder, for sandboxes. |
| `api.check(name, check)` | a custom check | a spec that lists `name` under `rules.custom` runs it on every block (authoring area). |
| `api.pairwiseJudge(name, factory)` | a pairwise judge | `compare --pairwise-judge <name>` uses it (results area). |
| `api.embedder(name, factory)` | an embedder | the similarity check scores with it when a run passes `--embedder <name>`. |
| `api.kind(name, { summary, agentFacing?, itemsKey?, fields? })` | an object kind of the rules framework, such as `policy/routing` | objects of that kind load and resolve like any other, and a spec names them under `uses`. `agentFacing: true` marks a kind whose change reruns the agent; `fields` is a map of zod schemas for its own top-level keys. |
| `api.rule(kind, name, { params?, run })` | the implementation of a rule of `kind` | an item names it as `impl: plugin:<name>`; its `params` are checked against `params` (a zod schema, or any object with zod's `safeParse`) when the object loads. |
| `api.evidence(kind, name, compute)` | an evidence name a rule of `kind` may read in its `when` | `compute` gives its value. |
| `api.diagnosticStep(name, run)` | a step of a diagnostic | a diagnostic object's `steps` name it as `impl: plugin:<name>`; `run` may also be `{ params, run }`. |
| `api.promptTemplate(id, parts, contract)` | a prompt template: named parts (a map of texts) and the parser of its answers | referenced by its id; its fingerprint is the hash of its parts. |
| `api.object(path)` | an object file of the plugin's own, the path relative to the plugin's folder | it joins the shipped layer: immutable, used by id, extended like a shipped object. It is resolved when the plugin loads, so an unknown item, kind or implementation stops the command there. |

`api.cwd` is the working folder. The function may be async. In TypeScript, `definePlugin` from `@agent-nexus/driftbench` gives it its types. A plugin is code and runs with your rights: list only modules you trust.

## When to use it

* Your agent is reached by an adapter the command line does not build by itself (an SDK object, a client of your own, a custom transport): register it under a target name.
* You need a check driftbench does not ship.
* You want an `http`, `litellm` or `nexus` target built differently: a plugin that registers one of those names replaces the built-in target of that name.

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--plugin <module>` | every command (a global option; it may stand anywhere on the line, also as `--plugin=<module>`) | none | load this module before the command runs. A path (starting with `.` or absolute, or an existing file) is read from the working folder; any other value is a package name, resolved from the working folder. Repeat it for several. |
| `plugins:` | the project config, `driftbench.yaml` in the working folder or the file `--config <file>` names | none | a list of modules. A path is relative to the config file; any other entry is a package name. |

Load order: plugins given in code to `main()`, then the config's `plugins:` list, then each `--plugin`, in order. A module named twice (in the config and by the flag) runs once. A plugin may never replace what another registered: two plugins registering the same adapter, check or judge name are refused, and so is a check name already registered elsewhere. The same holds for the rules framework: a kind, a `plugin:<name>` implementation (rules and diagnostic steps share these names), an evidence name of a kind, a prompt template id or an object `kind:id` that driftbench ships or another plugin registered is refused. To change a shipped object, a plugin ships an object with another id that `extends` it. Everything a plugin registers lasts for the command it was loaded for. The judge names `openai`, `anthropic` and `google` are built in and refused. An adapter name must be lower case letters, digits, `.`, `_` or `-`, starting with a letter or digit. With no plugin, no extra file is read.

The commands that use plugin adapters are those that run a target: `campaign plan`, `campaign run`, `campaign resume`, `smoke`, `simulate`, `perturb`, `attack`, `ci`, `gate`, `pilot`, `family` and `holdout`.

## Inputs

A module such as `examples/plugins/plugin.mjs` of the repository:

```text
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { machineVerdict } from '@agent-nexus/driftbench-core';

/** The agent under test. A real plugin calls the team's agent here. */
function echoAgent(messages) {
  const text = `You said: ${messages.at(-1)?.content ?? ''}`;
  return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: {}, latencyMs: 0 };
}

export default function plugin(api) {
  // Every target `echo:<agent>` reaches the agent above, in process.
  api.adapter('echo', () => functionAdapter({ respond: echoAgent, deterministic: true }));

  // A spec lists `polite` under rules.custom; this runs on each of its blocks.
  api.check('polite', (ctx, options) => {
    const banned = Array.isArray(options?.banned) ? options.banned : [];
    const text = ctx.observed.text.toLowerCase();
    const hit = banned.find((word) => text.includes(String(word).toLowerCase()));
    return machineVerdict(
      'polite',
      'banned',
      hit === undefined ? 'pass' : 'fail',
      hit === undefined ? 'no banned word' : `the reply holds the banned word ${hit}`,
    );
  });
}
```

and a spec whose target is `{ adapter: echo, agent: demo }` and whose `rules.custom` lists `polite: { banned: [stupid] }` (`examples/plugins/specs/hello.yaml`). The folder's `driftbench.yaml` holds `plugins: [./plugin.mjs]`.

## Outputs and how to read them

A plugin prints nothing. Its adapter names appear in refusals (`Plugins add the adapters echo.`), its targets in cell lines, and its checks among the verdicts of each block. A plugin that fails to load stops the command before anything runs: the message is printed as `driftbench: <reason>` and the exit code is 2.

## Worked example

The plugin loaded by the flag, then by the config file, then a target name it does not register. No model is called.

```sh
driftbench campaign run examples/plugins/specs/hello.yaml --plugin examples/plugins/plugin.mjs
driftbench campaign run examples/plugins/specs/hello.yaml --config examples/plugins/driftbench.yaml
driftbench campaign run examples/plugins/specs/hello.yaml --plugin examples/plugins/plugin.mjs --target echo2:x  # exit 2
```

```text
✓ plugins-hello · echo:demo · F · repeat 0  pass  1 block
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

```text
No adapter is set up for echo2:x. The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. It also reaches http, litellm and nexus targets from the target.options of a spec. Plugins add the adapters echo.
```

The first two runs pass the same way: the flag and the config's `plugins:` list are two ways to load the same module (the config path is relative to the config file). The third names an adapter no plugin registered, and the refusal lists the adapters the loaded plugins add.

## Common errors

Each exits 2.

* `No adapter is set up for echo:demo, the target of plugins-hello. ...` The plugin is not loaded: no `--plugin`, and no `plugins:` in the config the command read.
* `driftbench: Cannot load the plugin ./nope.mjs: Cannot find module '<absolute path>/nope.mjs' imported from ...` The path does not exist, or the module throws while it loads.
* `driftbench: --plugin takes a module path or a package name` The flag has no value.
* `driftbench: The plugin <module> exports no function: export it as default, (api) => { ... }`
* `driftbench: The plugin <b> registers the adapter echo, which the plugin <a> already registered. A plugin never replaces a adapter: give it another name.` (the same for a check or a judge).
* `driftbench: The plugin <module> failed: the judge name openai is built in (openai, anthropic, google): a plugin judge needs another name`
* `driftbench: <config>:<line>: plugins must be a list of module paths or package names`
* `driftbench: The plugin <b> registers the implementation plugin:<name>, which the plugin <a> already registered. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.` (the same for a kind, an evidence name, a prompt template or an object).
* `driftbench: The plugin <module> registers the object kind check-set, which driftbench already has. ...`: a kind name driftbench ships.
* `driftbench: The plugin <module> gives the object <kind>:<id>, which driftbench or another plugin already ships. ...`: give the object another id and `extends: <id>`.
* `driftbench: The plugin <module> gives the object <kind>:<id>, which does not resolve: ...`: the object names an unknown item, or an implementation no plugin registered.
