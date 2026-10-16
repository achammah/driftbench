---
title: Script API
summary: 'The TypeScript `script` API of `@agent-nexus/driftbench-core` writes a conversation spec in code, one function call per step. It returns the same spec the command line reads from YAML, already validated.'
commands:
  - spec validate
  - spec lint
see_also:
  - authoring-spec-format
  - authoring-blocks
  - authoring-deviation-classes
  - authoring-users
  - authoring-spec-check
next:
  - authoring-spec-check
---

## What it is

`script` is a namespace exported by the package `@agent-nexus/driftbench-core`. Each step is a function call. `conversation(id, steps, options)` compiles the steps into a conversation spec object and validates it with the same loader `spec validate` uses. `toYaml(spec)` writes it as YAML that every command reads.

| Function | What it adds |
|---|---|
| `user(text, expect?)` | A block whose stimulus is the user's message, with its expectations. |
| `injection(class, text, expect?)` | A block whose stimulus is a deviation of that class: `when: { injection: { class, user: text } }`. |
| `agent(expect)` | Expectations on the reply to the last block. Needs a block before it. |
| `judge(criteria)` | Judged criteria, by name (`name` or `name@gating`), on the last block. Needs at least one name. |
| `proceed(n, { hint?, expect? })` | `n` blocks reserved for the simulated user. Each block's stimulus is the hint. Their positions go to `metadata.simulated_blocks`. |
| `succeed(reason?)` | Ends the script with a success verdict where it stands. |
| `fail(reason?)` | Ends the script with a failure verdict where it stands. |
| `conversation(id, steps, options?)` | Compiles the steps. Returns `{ spec, load }`. |
| `toYaml(spec)` | The spec as YAML text. |
| `ScriptError` | The error class thrown for a step the spec cannot hold or one out of order. |
| `DEFAULT_PROCEED_HINT` | `'Continue the conversation toward your goal.'`, the hint `proceed` uses without one. |

A script writes only conversation specs (`kind: conversation`). Write a task spec as YAML.

## When to use it

- You generate many similar specs from data in code, and want each one validated as you build it.
- You prefer typed code to YAML for hand-written conversations.
- You want blocks reserved for a simulated user (`proceed`) or an early end verdict (`succeed`, `fail`), which are tedious to write by hand.

## Commands and every option

The script API is a library, not a command. Run a script with any TypeScript runner; from a clone of the repository: `pnpm exec tsx <file.ts>`. In your own project, install `@agent-nexus/driftbench-core` and import `script` from it.

Then check the YAML it wrote with `driftbench spec validate <file>` or `driftbench spec lint <file>` (see authoring-spec-check), and run it with `driftbench campaign run`.

### Parameters and defaults

| Call | Parameter | Type | Default |
|---|---|---|---|
| `user` | `text` | string | required |
| `user` | `expect` | any `expect` keys of a block (see authoring-blocks) | `{}` |
| `injection` | `class` | a deviation class such as `D1_off_topic` | required |
| `injection` | `text`, `expect` | as for `user` | `expect`: `{}` |
| `agent` | `expect` | `expect` keys | required |
| `judge` | `criteria` | list of strings, at least 1 | required |
| `proceed` | `n` | whole number from 1 | required |
| `proceed` | `hint` | non-empty string | `DEFAULT_PROCEED_HINT` |
| `proceed` | `expect` | `expect` keys, applied to every reserved block | `{}` |
| `succeed`, `fail` | `reason` | string | none |
| `conversation` | `id` | spec id: letters, digits, `.`, `_`, `-` | required |
| `conversation` | `steps` | list of steps | required |
| `conversation` | `options` | `{ title?, description?, channel?, lang?, stages?, criteria? }`; `criteria` are criterion mappings (`name`, `rubric`, ...) | `{}` |

### Rules the compiler applies

- Blocks are numbered `b1`, `b2` and so on, in script order.
- `agent()` and `judge()` add to the last block. A list expectation given twice in one block concatenates (`must` in `user()` and in `agent()` both hold). A scalar given twice (such as `lang`, `stage`) throws.
- `succeed()` or `fail()` stops the run after the block before it. Steps after it still become blocks, skipped by the verdict. The spec gets `end: { verdict, reason?, atBlock? }`; `atBlock` is written only when blocks follow the verdict. One verdict per script.
- An `agent()` or `judge()` after the verdict throws: the block it checks never runs.
- A bad value never throws: the spec comes back with `load.ok: false` and the issues in `load.errors`.
- With the scripted driver, a `proceed` block sends its hint word for word. With the simulated driver, the hint tells the simulated user what the person means to say (see authoring-users).

## Inputs

The arguments above. `expect` objects take the keys of a block's `expect` in their YAML spelling (snake_case): `must`, `must_not`, `stage`, `tools`, `lang`, `criteria`, and the rest.

## Outputs and how to read them

`conversation()` returns:

| Field | Meaning |
|---|---|
| `spec` | The plain spec object: `id`, `kind: conversation`, the options given, `blocks`, and `end` and `metadata.simulated_blocks` when used. |
| `load` | The loader's result, as `spec validate` computes it: `{ ok: true, spec, hash, warnings, path: 'script:<id>' }` or `{ ok: false, errors, warnings, path }`. `hash` is the 12-hex content hash. |

`toYaml(spec)` returns YAML. Save it with a `.yaml` name so the commands find it in a folder.

## Worked example

A script needs a TypeScript runner and the package. In your own project, install `@agent-nexus/driftbench-core` and `tsx`. Or work in a scratch folder beside a clone of the repository. The folder holds `packages` as a link, and a `tsconfig.json` there maps the package name to its source:

```json file=tsconfig.json
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "paths": { "@agent-nexus/driftbench-*": ["./packages/*/src/index.ts"] }
  }
}
```

The script builds a fictional refund conversation with every step kind, prints the verdict and the YAML, and writes `refund-basic.yaml` beside itself:

```ts file=out/authoring-script-api/refund.ts
// Fictional data only. Builds one conversation spec in code and writes it as YAML.
import { writeFileSync } from 'node:fs';
import { script } from '@agent-nexus/driftbench-core';

const { agent, conversation, fail, injection, judge, proceed, toYaml, user } = script;

const result = conversation(
  'refund-basic',
  [
    user('I want a refund for order 1234.', { must: ['refund'] }),
    agent({ must_not: ['refunded already'], stage: 'verify' }),
    judge(['refund.issued@gating']),
    injection('D1_off_topic', 'is the shop open on Saturday?', { must_not: ['refund issued'] }),
    proceed(2, { hint: 'Give the order number again if asked.', expect: { lang: 'EN' } }),
    fail('the refund was never confirmed'),
    user('Thanks, bye.'),
  ],
  {
    title: 'Refund for one order',
    channel: 'chat',
    lang: 'EN',
    stages: ['verify', 'refund', 'closing'],
    criteria: [{ name: 'refund.issued', rubric: 'The agent issues the refund only after it confirms the order.' }],
  },
);

console.log(`load.ok: ${result.load.ok}`);
if (result.load.ok) console.log(`hash: ${result.load.hash}`);
const yaml = toYaml(result.spec);
writeFileSync(new URL('./refund-basic.yaml', import.meta.url), yaml);
process.stdout.write(yaml);
```

Run it:

```sh setup
tsx out/authoring-script-api/refund.ts
```

```text
$ tsx out/authoring-script-api/refund.ts
load.ok: true
hash: c9dc31d6e6ab
id: refund-basic
kind: conversation
title: Refund for one order
channel: chat
lang: EN
stages:
  - verify
  - refund
  - closing
criteria:
  - name: refund.issued
    rubric: The agent issues the refund only after it confirms the order.
blocks:
  - id: b1
    when:
      user: I want a refund for order 1234.
    expect:
      must:
        - refund
      must_not:
        - refunded already
      stage: verify
      criteria:
        - refund.issued@gating
  - id: b2
    when:
      injection:
        class: D1_off_topic
        user: is the shop open on Saturday?
    expect:
      must_not:
        - refund issued
  - id: b3
    when:
      user: Give the order number again if asked.
    expect:
      lang: EN
  - id: b4
    when:
      user: Give the order number again if asked.
    expect:
      lang: EN
  - id: b5
    when:
      user: Thanks, bye.
end:
  verdict: failure
  reason: the refund was never confirmed
  atBlock: 3
metadata:
  simulated_blocks:
    - 2
    - 3
(exit 0)
```

`atBlock: 3`: the run stops after `b4`; `b5` is kept and skipped by the verdict. `simulated_blocks` counts from 0, so `b3` and `b4` are the simulated user's. The command line reads the file the script wrote with the same hash:

```sh
driftbench spec lint out/authoring-script-api/refund-basic.yaml
```

```text
$ driftbench spec lint out/authoring-script-api/refund-basic.yaml
✓ out/authoring-script-api/refund-basic.yaml  refund-basic · 5 blocks · hash c9dc31d6e6ab
  ! blocks.4  BLOCK_NO_EXPECTATION  this block checks nothing
Checked 1 spec: 1 valid, 0 invalid, 1 warning.
(exit 0)
```

An `injection()` step compiles to `when: { injection: { class, user } }`. That is the form the Acme off-topic spec writes by hand. The loader accepts both the same way:

```sh
driftbench spec validate examples/acme/specs/conversations/off-topic-return.yaml
```

```text
$ driftbench spec validate examples/acme/specs/conversations/off-topic-return.yaml
✓ examples/acme/specs/conversations/off-topic-return.yaml  acme-off-topic-return · 5 blocks · 1 perturbation · hash cca285407040
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
```

## Common errors

`out/authoring-script-api/errors.ts` runs each mistake and prints what it gives:

```
$ pnpm exec tsx out/authoring-script-api/errors.ts
agent() first: ScriptError: agent() comes after a user turn: none is before it
judge([]): ScriptError: judge() needs criteria: a final verdict with no criteria has no spec form
scalar twice: ScriptError: lang is set twice in block b1
two verdicts: ScriptError: the script has one succeed() or fail(), not two
agent() after the verdict: ScriptError: agent() comes after succeed() or fail(): the block it checks is skipped by the verdict
proceed(0): ScriptError: proceed() needs at least one turn
proceed(1.5): ScriptError: proceed() needs a whole number of turns
bad class: load.ok false, SCHEMA_INVALID_UNION at blocks.0.when: expected exactly one of: user, burst, injection
bad id: load.ok false, SCHEMA_INVALID_FORMAT at id: Invalid string: must match pattern /^[A-Za-z0-9][A-Za-z0-9._-]*$/
(exit 0)
```

| Message | Cause | Fix |
|---|---|---|
| `agent() comes after a user turn: none is before it` | `agent()` or `judge()` as the first step | start with `user()` or `injection()` |
| `judge() needs criteria` | `judge([])` | name at least one criterion |
| `<key> is set twice in block bN` | a scalar expectation set in both `user()` and `agent()` | set it once |
| `the script has one succeed() or fail(), not two` | two verdicts | keep one |
| `... comes after succeed() or fail()` | a check on a block the verdict skips | move the verdict after it |
| `proceed() needs ...` | `n` missing, below 1, not whole; or an empty hint | pass a whole number from 1 and a non-empty hint |
| `load.ok false` with a `SCHEMA_*` code | a bad value, such as an unknown deviation class or an id with a space | read `load.errors`; nothing is thrown for values |
| the import fails | `@agent-nexus/driftbench-core` is not installed where the script runs | install it in your project, or run the script from the repository with `pnpm exec tsx` |
