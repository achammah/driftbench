---
title: Plugins for adapters, checks and judges
summary: Load your own code with --plugin or the plugins key, to register adapters, checks, pairwise judges and the kinds, rules and objects of the rules framework.
commands: []
see_also:
  - running-campaign-run
  - running-smoke
  - authoring-spec-check
  - running-sdk-adapters
  - running-targets
  - running-campaign-config
  - running-targets-from-settings
  - authoring-spec-format
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
| `api.kind(name, { summary, agentFacing?, itemsKey?, fields? })` | an object kind of the rules framework, such as `policy/routing` | objects of that kind load and resolve like any other. `uses` has a fixed list of keys, so a spec cannot name an object of a new kind under `uses`; the plugin's own objects of that kind load with it. `agentFacing: true` marks a kind whose change reruns the agent (default false); `itemsKey` names the list of items in a file (default `items`); `fields` is a map of zod schemas for the kind's own top-level keys (default none). |
| `api.rule(kind, name, { params?, run, summary? })` | the implementation of a rule of `kind` | an item names it as `impl: plugin:<name>`; its `params` are checked against `params` (a zod schema, or any object with zod's `safeParse`) when the object loads. Without `params`, any params pass. |
| `api.evidence(kind, name, compute)` | an evidence name a rule of `kind` may read in its `when` | `compute` gives its value. |
| `api.diagnosticStep(name, run)` | a step of a diagnostic | a diagnostic object's `steps` name it as `impl: plugin:<name>`; `run` may also be `{ params, run }`. |
| `api.promptTemplate(id, parts, contract)` | a prompt template: named parts (a map of texts) and the parser of its answers | referenced by its id; its fingerprint is the hash of its parts. |
| `api.object(path)` | an object file of the plugin's own, the path relative to the plugin's folder | it joins the shipped layer: immutable, used by id, extended like a shipped object. It is resolved when the plugin loads, so an unknown item, kind or implementation stops the command there. |

Names of the rules framework (kinds, rules, steps, evidence, templates) are lower case letters, digits, `.`, `_` and `-`, with `/` between parts. Rules and diagnostic steps share the `plugin:<name>` space. A kind must also fit the kind format: lower case, one optional `/` group, such as `policy/routing`.

In this release the rules framework is checked when specs load, and no run reads it yet. A run never calls a rule's `run`, an evidence function, a diagnostic step or a template's parser. Today a plugin gives what makes objects load: kinds, implementations with their params schemas, and objects.

`api.cwd` is the working folder. The function may be async. In TypeScript, `definePlugin` from `@agent-nexus/driftbench` gives it its types. A plugin is code and runs with your rights: list only modules you trust.

## When to use it

* Your agent needs an adapter the command line does not build, such as an SDK object, your own client or a custom transport. Register it under a target name.
* You need a check driftbench does not ship.
* You want an `http`, `litellm` or `nexus` target built differently: a plugin that registers one of those names replaces the built-in target of that name.
* Your rule files name `impl: plugin:<name>`: a plugin gives that implementation, and the schema its params must pass.
* Your team shares rule sets: a plugin package ships them with `api.object`. Every project that loads the plugin uses them by id, or extends them.
* You need a kind of rule set driftbench does not have: `api.kind`.

Do not use a plugin to change a shipped object, kind or implementation: it is refused. Ship an object with another id that `extends` it.

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--plugin <module>` | every command (a global option; it may stand anywhere on the line, also as `--plugin=<module>`) | none | load this module before the command runs. A path (starting with `.` or absolute, or an existing file) is read from the working folder; any other value is a package name, resolved from the working folder. Repeat it for several. |
| `plugins:` | the project config, `driftbench.yaml` in the working folder or the file `--config <file>` names | none | a list of modules. A path is relative to the config file; any other entry is a package name. |

Load order: plugins given in code to `main()`, then the config's `plugins:` list, then each `--plugin`, in order. A module named twice (in the config and by the flag) runs once. A plugin may never replace what another registered: two plugins registering the same adapter, check or judge name are refused, and so is a check name already registered elsewhere. The same holds for the rules framework. A plugin cannot register what driftbench ships or another plugin registered: a kind, a `plugin:<name>` implementation, an evidence name of a kind, a prompt template id or an object `kind:id`. Rules and diagnostic steps share the implementation names. To change a shipped object, a plugin ships an object with another id that `extends` it. Everything a plugin registers lasts for the command it was loaded for. The judge names `openai`, `anthropic` and `google` are built in and refused. An adapter name must be lower case letters, digits, `.`, `_` or `-`, starting with a letter or digit. With no plugin, no extra file is read.

`--plugin` is a global option: it is the same on every command, and no command has a plugin option of its own. The commands that use plugin adapters are those that run a target: `campaign plan`, `campaign run`, `campaign resume`, `smoke`, `simulate`, `perturb`, `attack`, `ci`, `gate`, `pilot`, `family` and `holdout`.

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

A plugin for the rules framework, with one rule whose params are checked and one object of its own:

```text
export default function plugin(api) {
  api.rule('check-set', 'acme-tone', {
    params: { safeParse: (value) => ({ success: true, data: value }) },
    run: () => [],
  });
  api.object('objects/check-set-acme.yaml');
}
```

`objects/check-set-acme.yaml`, beside the plugin file:

```text
kind: check-set
id: acme
items:
  - { id: tone, title: Replies keep the Acme tone, params: { tone: warm }, impl: plugin:acme-tone }
```

A spec then writes `uses: { check_set: acme }`, or an inline object that extends `acme` (see authoring-rule-files).

## Outputs and how to read them

A plugin prints nothing. Its adapter names appear in refusals (`Plugins add the adapters echo.`), its targets in cell lines, and its checks among the verdicts of each block. Its objects join the shipped layer: a spec that names them loads, and `spec validate` prints it valid. Without the plugin, the same spec is invalid with `OBJECT_UNKNOWN`. A params schema refuses an item at load with `OBJECT_PARAMS_INVALID`. A plugin that fails to load stops the command before anything runs: the message is printed as `driftbench: <reason>` and the exit code is 2.

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

### A plugin for the rules framework

A plugin that adds a kind, two rules, an evidence name, a diagnostic step, a prompt template and three objects of its own. The `tone` rule accepts only `plain` or `warm`:

```js file=framework/plugin.mjs
// Fictional data only. One of each part of the rules framework.
const toneParams = {
  safeParse(value) {
    const tone = value?.tone;
    return tone === undefined || ['plain', 'warm'].includes(tone)
      ? { success: true, data: value }
      : { success: false, error: { issues: [{ code: 'custom', path: ['tone'], message: 'tone is plain or warm' }] } };
  },
};

export default function plugin(api) {
  api.kind('policy/routing', { summary: 'Which team a conversation goes to.' });
  api.rule('policy/routing', 'route-by-intent', { run: () => 'sales' });
  api.rule('check-set', 'acme-tone', { params: toneParams, run: () => [] });
  api.evidence('check-set', 'tone_score', () => 0.5);
  api.diagnosticStep('acme-dedup', () => ({ duplicates: 0 }));
  api.promptTemplate('linker/acme', { system: 'You link blocks to prompt units.' }, (answer) => answer.split('\n'));
  api.object('objects/policy-routing-intent.yaml');
  api.object('objects/check-set-acme.yaml');
  api.object('objects/diagnostic-acme-dedup.yaml');
}
```

```yaml file=framework/objects/policy-routing-intent.yaml
kind: policy/routing
id: intent
description: Routes a conversation by the intent of its first user turn.
items:
  - id: by_intent
    title: The intent of the first user turn picks the team
    impl: plugin:route-by-intent
```

```yaml file=framework/objects/check-set-acme.yaml
kind: check-set
id: acme
description: The Acme tone check.
items:
  - id: tone
    title: Replies keep the Acme tone
    when: { tone_score: { below: 0.4 } }
    effect: { gating: false }
    params: { tone: warm }
    impl: plugin:acme-tone
```

```yaml file=framework/objects/diagnostic-acme-dedup.yaml
kind: diagnostic
id: acme-dedup
description: Lists the duplicate tool calls of a failing block.
steps:
  - id: dedup
    title: Count the calls made twice with the same input
    params: { prompt_template: linker/acme }
    impl: plugin:acme-dedup
```

A spec that uses the plugin's check set and diagnostic, and one whose block sets a tone the rule refuses:

```yaml file=framework/specs/routed.yaml
id: routed
uses: { check_set: acme, diagnostics: [acme-dedup] }
blocks:
  - id: b1
    user: I would like to change my plan.
    expect: { must: ['plan'] }
```

```yaml file=framework/bad/loud.yaml
id: loud
blocks:
  - id: b1
    user: I would like to change my plan.
    uses:
      check_set: { extends: acme, items: [{ id: tone, params: { tone: loud } }] }
    expect: { must: ['plan'] }
```

A second plugin that registers the same rule name:

```js file=framework/twin.mjs
export default function plugin(api) {
  api.rule('check-set', 'acme-tone', { run: () => [] });
}
```

```sh
driftbench spec validate framework/specs/routed.yaml --plugin framework/plugin.mjs
driftbench spec validate framework/specs/routed.yaml # exit 1
driftbench spec validate framework/bad/loud.yaml --plugin framework/plugin.mjs # exit 1
driftbench spec validate framework/specs/routed.yaml --plugin framework/plugin.mjs --plugin framework/twin.mjs # exit 2
```

```text
$ driftbench spec validate framework/specs/routed.yaml --plugin framework/plugin.mjs
✓ framework/specs/routed.yaml  routed · 1 block · hash 075c8c1a3869
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench spec validate framework/specs/routed.yaml
✗ framework/specs/routed.yaml
    uses.check_set  OBJECT_UNKNOWN  spec routed: uses.check_set: unknown object check-set:acme; searched layers shipped, project, suite, spec, block, cli
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
$ driftbench spec validate framework/bad/loud.yaml --plugin framework/plugin.mjs
✗ framework/bad/loud.yaml
    blocks.0.uses.check_set  OBJECT_PARAMS_INVALID  spec loud block b1: blocks.0.uses.check_set: check-set:(block): item tone params: params.tone: tone is plain or warm (blocks.0.uses.check_set.items.0)
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
$ driftbench spec validate framework/specs/routed.yaml --plugin framework/plugin.mjs --plugin framework/twin.mjs
driftbench: The plugin framework/twin.mjs registers the implementation plugin:acme-tone, which the plugin framework/plugin.mjs already registered. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.
(exit 2)
```

With the plugin, the spec is valid: `check-set:acme` and `diagnostic:acme-dedup` come from the plugin. Without it, the same spec is invalid with `OBJECT_UNKNOWN`. The `loud` block is refused with `OBJECT_PARAMS_INVALID` and the path `params.tone`. The twin plugin stops the command before anything runs, because a plugin never replaces what another registered.

## Common errors

Each exits 2, except the two `OBJECT_*` lines at the end.

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
* `driftbench: The plugin <module> gives the object <path>, which does not load: ...`: the file is missing or is not YAML. The path is read from the plugin's folder.
* `driftbench: The plugin <module> registers the rule <name> for the kind <kind>, which no one registered.` (the same for a diagnostic step): register the kind first, or fix its name.
* `driftbench: The plugin <module> registers the evidence <name> for the kind <kind>, which no one registered.`
* `driftbench: The plugin <module> failed: the <what> name "<name>" is not a plain name: lower case letters, digits, ., _, - and / between parts`
* `driftbench: The plugin <module> failed: the kind <name> needs a summary: one line for listings`
* `driftbench: The plugin <module> failed: the rule <name> needs a run function` (the same for a diagnostic step).
* `driftbench: The plugin <module> failed: the evidence <name> needs a function that computes it`
* `driftbench: The plugin <module> failed: the prompt template <id> needs its parts as a map of named texts`, or `... needs the parser of its answers`.
* `driftbench: The plugin <module> failed: object takes the path of an object file`
* `OBJECT_UNKNOWN` from `spec validate` (exit 1) on a spec that names a plugin object: the plugin is not loaded. Pass `--plugin`, or list it under `plugins:`.
* `OBJECT_PARAMS_INVALID ... item <item> params: params.<path>: <message>` (exit 1): the item's params fail the schema the rule gave.
