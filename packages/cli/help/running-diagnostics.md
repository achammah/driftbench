---
title: Diagnostics after the checks
summary: 'A diagnostic is a rule file that runs after a block''s checks and writes diagnoses on it. It never changes a verdict or pass. This topic gives its format, uses.diagnostics, the budget and every diagnosis field.'
commands: []
see_also:
  - running-check-sets
  - authoring-rule-files
  - authoring-spec-format
  - running-store
next:
  - running-check-sets
---

## What it is

A diagnostic is an object of kind `diagnostic`: a procedure that runs after a block's checks. It reads the block's verdicts, what was observed and the block's objects. It writes diagnoses on the block, in `diagnoses`. It never changes a verdict, `pass` or `drift`.

A diagnostic has a trigger and steps:

- `when` decides whether it runs on a block. `always: true` runs it on every block. `any_verdict: { name, outcome, id_contains }` runs it when one verdict matches every key given.
- `steps` are its items. Each step names an implementation, registered from code as a diagnostic step. A step may only name a diagnostic step, never a check implementation.

Each step has a cost class: `static` reads the record only, `run` runs the agent or a tool again, `model` calls a model. A `run` or `model` step runs only within the diagnostic budget, 0 by default. A step skipped for the budget is counted in the block's `skippedForBudget`.

A block runs the diagnostics `uses.diagnostics` names. Without that key, it runs every shipped diagnostic marked `default: true`. `uses.diagnostics: []` runs none.

In this release no command registers a diagnostic step. The CLI therefore refuses a diagnostic file whose steps no code registered. A program registers its steps with `registerDiagnosticStep`, then runs specs with `runSpec`.

## When to use it

- Explain a failure in the record, beside the verdict: who is at fault, where the fix goes, a score.
- Keep that explanation out of the pass rate: a diagnosis never changes `pass`.

When not to use it:

- To fail a block, write a check, not a diagnostic.
- A step that reruns the agent costs runs. Leave its budget at 0 unless you mean to pay for them.

## Commands and every option

No command has an option for diagnostics. The spec key and the library calls:

| Key or call | Where | Default | Effect |
|---|---|---|---|
| `uses.diagnostics` | a spec or a block | every shipped diagnostic marked `default: true` | a list of diagnostic ids or inline objects; `[]` runs none |
| `registerDiagnosticStep(name, { params, cost, run, summary? })` | `@agent-nexus/driftbench-core` | none | registers a step under `plugin:<name>` or `builtin:<name>`. A name registered twice is refused |
| `runSpec(spec, { ..., objects, diagnosticBudget })` | `@agent-nexus/driftbench-core` | `diagnosticBudget: { runs: 0 }` | runs the block diagnostics after each block's checks. `objects` is the object context, such as `objectContextFor(path)` |
| `runRunDiagnostics`, `runCampaignDiagnostics` | `@agent-nexus/driftbench-core` | budget 0 | run the diagnostics of scope `run` or `campaign` over finished runs |

A diagnostic file, under `driftbench/diagnostic/<id>.yaml` beside a `driftbench.yaml`:

| Key | Default | Meaning |
|---|---|---|
| `kind`, `id` | none, required | `diagnostic` and its id |
| `scope` | `block` | `block`: on each block after its checks. `run`: once over a run. `campaign`: once over every run |
| `when` | none | `always: true`, or `any_verdict: { name, outcome, id_contains }` |
| `reads` | none | the object kinds it reads; each must be a known kind |
| `output`, `cost` | none | descriptions for the reader |
| `default` | off | a shipped diagnostic that runs when `uses.diagnostics` is absent |
| `steps` | none | its items: `{ id, title, impl, params }` |

## Inputs

A diagnostic that names each failing gating verdict:

```text
kind: diagnostic
id: explain-fails
when: { any_verdict: { outcome: fail } }
steps:
  - { id: explain, title: Name each failing verdict, impl: "plugin:explain" }
```

A step registered from code, returning one diagnosis per failing gating verdict:

```text
registerDiagnosticStep('plugin:explain', {
  params: NoParams,
  cost: 'static',
  run: ({ verdicts }) => verdicts
    .filter((v) => v.gating && v.outcome !== 'pass')
    .map((v) => ({ verdictRef: v.id, summary: `explains ${v.id}` })),
});
```

## Outputs and how to read them

`BlockResult.diagnoses` lists what the diagnostics wrote, absent when none wrote anything:

| Field | Holds |
|---|---|
| `diagnostic` | the diagnostic that wrote it, as `diagnostic:<id>@<hash8>` |
| `step` | the step that wrote it |
| `by` | `{ object, item, impl, layer }`: the object, the step, its implementation and the layer that set it |
| `summary` | one line a reader can act on |
| `verdictRef` | the verdict it is about, when it is about one |
| `rule`, `fault`, `fixLocation`, `flags`, `score`, `evidence`, `rankedCauses` | what an attribution or a measure writes |
| `inherits`, `disposition`, `fixTarget`, `fixAction`, `fixForms`, `placement`, `confidence`, `removeCopies` | what blame and placement write (topic results-diagnostics, where it ships) |

`BlockResult.skippedForBudget` counts the `run` and `model` steps the budget skipped. `resolved` names the diagnostics the block used, under the key `diagnostics`.

A step that throws writes a diagnosis that says `the step threw <error>`. A step that returns a diagnosis the schema refuses writes one that says so.

## Worked example

A project with one diagnostic, and a spec of two blocks: the first passes, the second fails a `must`.

```yaml file=driftbench.yaml
# The project config. The project rule files are read from driftbench/ beside it.
```

```yaml file=driftbench/diagnostic/explain-fails.yaml
kind: diagnostic
id: explain-fails
when: { any_verdict: { outcome: fail } }
reads: [check-set]
steps:
  - { id: explain, title: Name each failing gating verdict, impl: "plugin:explain" }
```

```yaml file=specs/diagnosed.yaml
# Fictional data only.
id: diagnosed
uses: { diagnostics: [explain-fails] }
blocks:
  - user: Hello there.
    expect: { must: ['You said'] }
  - user: And what about roaming?
    expect: { must: ['a phrase the agent never says'] }
```

The CLI registers no diagnostic step, so it refuses the diagnostic:

```sh
driftbench spec validate specs/diagnosed.yaml # exit 1
```

```text
$ driftbench spec validate specs/diagnosed.yaml
✗ specs/diagnosed.yaml
    uses.diagnostics  OBJECT_IMPL_UNKNOWN  spec diagnosed: uses.diagnostics: diagnostic:explain-fails: item explain names plugin:explain, which no builtin or plugin provides (driftbench/diagnostic/explain-fails.yaml:6)
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
```

The message names the rule file by its absolute path; the output above shows it relative to the working folder.

A script registers the step, then runs the spec on a small echo agent, with no model call:

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

```ts file=diagnose.mts
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { loadSpecFile, NoParams, objectContextFor, registerDiagnosticStep, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';

registerDiagnosticStep('plugin:explain', {
  params: NoParams,
  cost: 'static',
  run: ({ verdicts }) =>
    verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map((verdict) => ({ verdictRef: verdict.id, summary: `explains ${verdict.id}` })),
});

function echo(messages: { content: string }[]) {
  const text = `You said: ${messages.at(-1)?.content ?? ''}`;
  return { segments: [{ type: 'text' as const, text }], text, toolCalls: [], cost: {}, latencyMs: 0 };
}

const path = 'specs/diagnosed.yaml';
const loaded = await loadSpecFile(path);
if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
const result = await runSpec(loaded.spec, {
  adapter: functionAdapter({ respond: echo, deterministic: true }),
  driver: createScriptedDriver(),
  checks: defaultChecks(),
  mode: 'F',
  repeat: 0,
  objects: objectContextFor(path),
});
for (const block of result.blocks) {
  console.log(`block ${block.index} pass ${block.pass}`);
  for (const diagnosis of block.diagnoses ?? []) {
    console.log(`  ${diagnosis.diagnostic.split('@')[0]} ${diagnosis.step}: ${diagnosis.summary} (layer ${diagnosis.by.layer})`);
  }
}
```

```sh setup
tsx diagnose.mts
```

```text
$ tsx diagnose.mts
block 0 pass true
block 1 pass false
  diagnostic:explain-fails explain: explains must.0 (layer project)
(exit 0)
```

Block 0 passes, so its trigger does not fire and it has no diagnosis. Block 1 fails `must.0`, and the diagnostic explains it. Its `pass` is still false: a diagnosis never changes it.

## Common errors

* `uses.diagnostics  OBJECT_IMPL_UNKNOWN  spec <id>: uses.diagnostics: diagnostic:<id>: item <step> names <impl>, which no builtin or plugin provides (<file>:<line>)`: no code registered the step. Register it with `registerDiagnosticStep` before the spec loads; the CLI registers none in this release.
* `the diagnostic step <name> is already registered` (thrown): two registrations of one name. Give the second step another name.
* `... reads names unknown kinds <kinds>` (`OBJECT_INVALID`): `reads` names a kind that does not exist. Use a known kind, such as `check-set`.
* A diagnosis `the step threw <error>`: the step's code threw. Fix the step; the block's verdicts are untouched.
* A `run` or `model` step never writes, and `skippedForBudget` is above 0: the budget is 0. Pass `diagnosticBudget: { runs: <n> }` to `runSpec` when you mean to pay for the runs.
