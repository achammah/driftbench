---
title: Checking specs
summary: '`spec validate` parses and validates spec files and fails on any invalid one; `spec lint` does the same and also prints advice warnings; every problem it reports is listed here with its level.'
commands:
  - spec validate
  - spec lint
see_also:
  - authoring-spec-format
  - authoring-prompt-sections
  - authoring-blocks
  - authoring-prefixes
  - authoring-perturbations
  - authoring-inventory
  - authoring-given-checks
next:
  - authoring-inventory
---

## What it is

Two commands check spec files without running any agent:

- `spec validate` parses each file, rewrites the shorthands, checks the schema, then checks the rules a schema cannot express (regexes compile, criterion references resolve, stages exist, counts are sane, perturbation positions exist). It prints one line per spec and a summary.
- `spec lint` does exactly the same, then also prints the warnings of the valid specs: advice on specs that are valid but weak.

Each spec also gets its content hash: the first 12 hex characters of the SHA-256 of the spec's canonical JSON (keys sorted at every depth), without `metadata.links` and `metadata.provenance`. Equal content gives an equal hash. Links say what a block tests, not what it runs, so adding, promoting or refuting a link never changes the hash, a run id, a carry or a rejudge (authoring-prompt-sections). The hash, not `version`, enters the cache key and every run id, so any edit to a spec makes its runs new.

Checks run in three layers, and a later layer runs only when the earlier ones pass:

1. Parse, the format version and shorthand rewrite (`SPEC_PARSE`, `SPEC_SCHEMA_VERSION`, `SPEC_NOT_OBJECT`, `SPEC_ALIAS_CONFLICT`, `BLOCK_STIMULUS_*`).
2. The schema (`SCHEMA_*`).
3. The semantic rules (every other error code).

Warnings are computed only on valid specs.

## When to use it

- After writing or editing a spec, before running it.
- In CI or a pre-commit hook: `spec lint --strict` fails on warnings too.
- To get a spec's hash, or its block count, without running it.

## Commands and every option

### driftbench spec validate

```
driftbench spec validate <paths...> [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | Spec files or folders. A folder is searched recursively for `*.yaml`, `*.yml` and `*.spec.json`, sorted; names starting with a dot, `node_modules` and `dist` are skipped. A `.json` file is read as JSON, any other as YAML. | none |
| `--json` | Print one JSON array, one entry per spec. | off |

| Exit code | When |
|---|---|
| 0 | every spec is valid (warnings allowed) |
| 1 | a spec is invalid, a path does not exist, or no spec file was found |
| 2 | usage error: no path, an unknown option |

### driftbench spec lint

```
driftbench spec lint <paths...> [--json] [--strict] [--summaries] [--sections <registries...>]
```

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | As for `spec validate`. | none |
| `--json` | Print one JSON array. | off |
| `--strict` | Treat warnings as failures. | off |
| `--summaries` | Also warn (`GIVEN_SUMMARY_MISSING`) when a workspace folder or a named session state has no summary. Off by default: the shipped estate specs name states without one. | off |
| `--sections <registries...>` | Section registries (authoring-prompt-sections). Every `prompt_section` link of a spec is checked against the registry of its prompt: a section the registry does not hold is the error `LINK_TARGET_UNKNOWN`; a link to a prompt no registry describes, a link whose status is `stale` and a link to a stale section are warnings. | off: links are checked for shape and block only |

| Exit code | When |
|---|---|
| 0 | every spec is valid; warnings allowed without `--strict` |
| 1 | a spec is invalid, no spec file was found, or a warning was printed with `--strict` |
| 2 | usage error, or a `--sections` file that is not a valid registry, or two registries for one prompt |

## Inputs

Spec files, in the format of authoring-spec-format. Nothing else is read: the commands never load the inventory, the criteria catalogue or the agent.

## Outputs and how to read them

Text output, one entry per spec:

- Valid: `✓ <path>  <id> · <n> blocks · <m> perturbations · hash <12 hex>`. The perturbation part shows only when the spec has some. `spec lint` adds one `  ! <path in spec>  <CODE>  <message>` line per warning.
- Invalid: `✗ <path>`, then one `    <path in spec>  <CODE>  <message>` line per error. `(file)` stands for the whole file.
- Summary: `Checked <n> specs: <v> valid, <i> invalid, <w> warnings.` The warning count includes those of valid specs, even in `spec validate`, which does not print them. `No spec files found.` when the paths hold none.

The path in a spec is dotted, counting from 0: `blocks.2.expect.tools.0.label` is the label of the first tool of the third block.

`--json` prints an array. A valid entry: `{ path, ok: true, id, hash, blocks, warnings }`. An invalid entry: `{ path, ok: false, errors, warnings }`. Each issue is `{ level, code, path, message }`, with `level` `error` or `warning` and `path` empty for the whole file.

### Every issue code

| Code | Level | Meaning |
|---|---|---|
| `SPEC_PARSE` | error | the file cannot be read, does not exist, is not valid YAML or JSON, or repeats a key |
| `SPEC_SCHEMA_VERSION` | error | `schema_version` names a spec format newer than this driftbench reads: upgrade driftbench. Reported alone, before the keys of the newer format read as unknown |
| `SPEC_NOT_OBJECT` | error | the file does not hold one mapping at the top level |
| `SPEC_ALIAS_CONFLICT` | error | a shorthand and its long form are both set: `ledger_seed` with `given.ledger`, or `workspace_seed` with `given.world.workspace` |
| `BLOCK_STIMULUS_MISSING` | error | a block has none of `user`, `burst` and `when` |
| `BLOCK_STIMULUS_AMBIGUOUS` | error | a block has more than one of `user`, `burst` and `when` |
| `SCHEMA_*` | error | the schema refuses a value; the suffix is the zod issue code: such as `SCHEMA_UNRECOGNIZED_KEYS` (unknown key), `SCHEMA_INVALID_TYPE` (wrong type, or missing), `SCHEMA_INVALID_VALUE` (not an allowed option), `SCHEMA_INVALID_FORMAT` (pattern mismatch), `SCHEMA_TOO_SMALL` (a list or number under its minimum), `SCHEMA_INVALID_UNION` (a value that fits none of the allowed forms, with a hint), `SCHEMA_CUSTOM` (an unsupported JSON Schema keyword in `json.schema` or `metadata.tool_schemas`, or a length bound with no min and no max) |
| `REGEX_INVALID` | error | a pattern in `must`, `must_not`, a `regex` assertion or a `knowledge_retention` `ask` does not compile |
| `CRITERION_REF_INVALID` | error | a criterion reference is not a name, optionally followed by `@gating` |
| `CRITERION_UNDEFINED` | error | the spec defines `criteria`, and a block names one that is not there |
| `CRITERION_DUPLICATE` | error | two criteria share a name |
| `PERTURBATION_OUT_OF_RANGE` | error | `inject_at` is past the last position, or a world-only perturbation sits at the position after the last block |
| `PERTURBATION_EMPTY` | error | a perturbation has none of `user`, `burst` and `world` |
| `DUPLICATE_BLOCK_ID` | error | two blocks share an id |
| `DUPLICATE_PERTURBATION_ID` | error | two perturbations share an id |
| `TOOL_COUNT_CONTRADICTION` | error | a tool is expected 0 times but has `input` assertions |
| `COUNT_RANGE_INVALID` | error | a count has a `min` greater than its `max` |
| `MUST_CONFLICT` | error | the same pattern is in `must` and in `must_not` |
| `STAGE_UNKNOWN` | error | the spec lists `stages`, and `expect.stage` or `recovery.stage_after` names a stage not there |
| `RETENTION_FACT_UNKNOWN` | error | `knowledge_retention` names a fact no ledger holds before the block: not in `given.ledger`, nor in an earlier block's `ledger_add` |
| `TOOL_FORBIDDEN_EXPECTED` | error | a block expects a tool that `rules.forbidden_tools` or `rules.max_calls: 0` forbids |
| `GIVEN_ORIGIN_WITHOUT_PREFIX` | error | a block sets `given.origin` and writes no `given.prefix` |
| `LINK_BLOCK_UNKNOWN` | error | a link in `metadata.links` names a block id the spec does not have, or an index past its last block |
| `LINK_TARGET_UNKNOWN` | error or warning | `spec lint --sections` only: error when the registry of the prompt has no such section, warning when no registry was given for the prompt |
| `LINK_STALE` | warning | `spec lint --sections` only: the link's status is `stale`, or its section could not be found again in the registry's version |
| `CRITERION_UNRESOLVED` | warning | blocks name criteria and the spec defines none; they must come from a shared catalogue |
| `BLOCK_NO_EXPECTATION` | warning | a block checks nothing |
| `TASK_WITHOUT_OUTCOME` | warning | a task spec checks none of `artifacts`, `workspace`, `execution` and `end_state` |
| `PERTURBATION_NO_RECOVERY` | warning | a perturbation has no `recovery`, so its recovery is not measured |
| `PREFIX_PROSE_HISTORY` | warning | an assistant message of a prefix states a ledger fact that no recorded tool call of the prefix holds and the user never said, in a spec that names tools: the agent may call the tool again (see authoring-prefixes) |
| `GIVEN_UNMET` | warning | the Given verifier found a Given error on a block (`tool_history_paired`, `tool_known`, `history_matches_world` or `value_in_message`, named first in the message). The runner does not send that block: it is `not_run` with kind `given_unmet` |
| `GIVEN_CHAIN` | warning | a block's `ledger_add` contradicts the ledger it starts from (check `chain`) |
| `GIVEN_SUMMARY_MISSING` | warning | with `--summaries` only: a workspace folder (`world.workspace.from`) or a named session state (`vars.session_state`) has no summary (check `summary_present`) |
| `GIVEN_CANONICAL_UNPAIRED` | warning | a prefix whose `origin` is `canonical` holds a tool call with no output or error. Advice only: the block runs |

### The Given verifier

Topic authoring-given-checks explains each check with the keys it reads, a worked example and every message.

A Given is a recipe: these checks are its predicate. Each runs only on the layers the spec writes. A finding is a warning of `spec lint`; the four Given errors also stop the block at run time, so a block whose Given is wrong is `not_run` (kind `given_unmet`, with the layer, the check, what was expected and what was found) instead of a pass or a fail of the agent.

| Check | Layer | Holds when | At run time |
|---|---|---|---|
| `tool_history_paired` | 2 tool history | every tool call of a prefix carries an `output` or an `error`, and no call `id` repeats within one message. The same id in two assistant turns is accepted, as every wire accepts it | `not_run`; a warning only on a prefix whose `origin` is `canonical` |
| `tool_known` | 2 tool history, 5 world | every tool a prefix calls or `world.tools` forces is a key of `metadata.tool_schemas`. Off when the spec declares no tool schemas | `not_run` |
| `history_matches_world` | 2 tool history and 5 world | a recorded call of a tool the block's world forces records that forced result or error | `not_run` |
| `value_in_message` | 4 beliefs | each `given.shared` entry said by `user` or `agent` names a fact the ledger holds, and its value is in message `in` of the history the block starts from (its own prefix, else the latest earlier one), a user message for `user` and an assistant message for `agent`, as whole tokens: case, spacing and punctuation aside, so `+1 202 555 0131` holds `+12025550131` and `went` does not hold `EN` | `not_run` |
| `chain` | 4 beliefs | a block's `ledger_add` agrees with the ledger | warning only |
| `summary_present` | 5 world | a workspace folder and a named session state carry a summary | warning only, with `--summaries` |

A finding on a block's prefix or shared facts holds for the blocks that keep its history (in mode T, the later blocks with no prefix of their own; in modes F and P the conversation stops there). One on the world holds from its block on. After setup, the runner also reads back every file `world.workspace.files` writes, on an adapter with a sandbox: a file that does not read back as written makes the block `not_run` with kind `setup_failed`, check `world_digest`.

## Worked example

The seven Acme specs are valid. The coverage test fixtures hold one broken spec beside four valid ones, so `spec lint` exits 1. `--json` gives the same verdicts as data:

```sh
driftbench spec validate examples/acme/specs
driftbench spec lint packages/core/test/coverage/fixtures/specs # exit 1
driftbench spec validate examples/acme/specs/conversations/tool-failure.yaml --json
driftbench spec lint packages/core/test/coverage/fixtures/specs/broken.yaml --json # exit 1
```

```text
$ driftbench spec validate examples/acme/specs
✓ examples/acme/specs/conversations/new-customer-coverage.yaml  acme-new-customer-coverage · 4 blocks · 2 perturbations · hash be195c993d4f
✓ examples/acme/specs/conversations/number-porting.yaml  acme-number-porting · 5 blocks · 2 perturbations · hash 134c8e993f95
✓ examples/acme/specs/conversations/off-topic-return.yaml  acme-off-topic-return · 5 blocks · 1 perturbation · hash cca285407040
✓ examples/acme/specs/conversations/order-loose-confirmation.yaml  acme-order-loose-confirmation · 4 blocks · 2 perturbations · hash ae116e6312eb
✓ examples/acme/specs/conversations/plan-upgrade.yaml  acme-plan-upgrade · 5 blocks · 3 perturbations · hash 5ae085d0b267
✓ examples/acme/specs/conversations/tool-failure.yaml  acme-tool-failure · 3 blocks · 1 perturbation · hash e5bc5c9ba9d2
✓ examples/acme/specs/tasks/price-sheet.yaml  acme-price-sheet · 2 blocks · 1 perturbation · hash d96437659138
Checked 7 specs: 7 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench spec lint packages/core/test/coverage/fixtures/specs
✗ packages/core/test/coverage/fixtures/specs/broken.yaml
    blocks.0  BLOCK_STIMULUS_MISSING  a block needs `user`, `burst` or `when`
✓ packages/core/test/coverage/fixtures/specs/stray.yaml  stray · 1 block · hash f9c776c5185c
✓ packages/core/test/coverage/fixtures/specs/upgrade-chat.yaml  upgrade-chat · 3 blocks · 1 perturbation · hash 0933852b85b6
✓ packages/core/test/coverage/fixtures/specs/upgrade-whatsapp.yaml  upgrade-whatsapp · 1 block · 1 perturbation · hash b4d45ed07b43
✓ packages/core/test/coverage/fixtures/specs/usage-report.yaml  usage-report · 2 blocks · hash 87578d547b29
Checked 5 specs: 4 valid, 1 invalid, 0 warnings.
(exit 1)
$ driftbench spec validate examples/acme/specs/conversations/tool-failure.yaml --json
[
  {
    "path": "examples/acme/specs/conversations/tool-failure.yaml",
    "ok": true,
    "id": "acme-tool-failure",
    "hash": "e5bc5c9ba9d2",
    "blocks": 3,
    "warnings": []
  }
]
(exit 0)
$ driftbench spec lint packages/core/test/coverage/fixtures/specs/broken.yaml --json
[
  {
    "path": "packages/core/test/coverage/fixtures/specs/broken.yaml",
    "ok": false,
    "errors": [
      {
        "level": "error",
        "code": "BLOCK_STIMULUS_MISSING",
        "path": "blocks.0",
        "message": "a block needs `user`, `burst` or `when`"
      }
    ],
    "warnings": []
  }
]
(exit 1)
```

### Specs of your own: every semantic error and every warning

Two files in one folder: `errors.yaml` breaks eleven semantic rules, and `warnings.yaml` is valid but weak.

```yaml file=out/authoring-spec-check/errors.yaml
id: semantic-errors
stages: [identify, offer]
criteria:
  - { name: polite, rubric: Is the reply polite? }
  - { name: polite, rubric: Is the reply polite again? }
rules:
  forbidden_tools: [order.create]
blocks:
  - id: a
    user: hi
    expect:
      must: ['hello', 'hello']
      must_not: ['hello']
      criteria: ['rude', 'polite@always']
      tools:
        - { label: order.create, count: 1 }
      knowledge_retention:
        - { fact: email }
  - id: a
    user: again
perturbations:
  - { id: p1, class: D2_goal_shift, inject_at: 5, user: other plan }
  - { id: p1, class: D8_tool_failure, inject_at: 1 }
```

```yaml file=out/authoring-spec-check/warnings.yaml
id: lint-warnings
kind: task
blocks:
  - user: Build the report.
  - user: Add a summary.
    expect:
      criteria: [reports_what_it_did]
perturbations:
  - { id: aside, class: D1_off_topic, inject_at: 1, user: Is it raining? }
```

Validate the folder:

```sh
driftbench spec validate out/authoring-spec-check # exit 1
```

```text
$ driftbench spec validate out/authoring-spec-check
✗ out/authoring-spec-check/errors.yaml
    criteria.1.name  CRITERION_DUPLICATE  criterion "polite" is defined twice
    blocks.0.expect.must.0  MUST_CONFLICT  "hello" is in both must and must_not
    blocks.0.expect.must.1  MUST_CONFLICT  "hello" is in both must and must_not
    blocks.0.expect.tools.0  TOOL_FORBIDDEN_EXPECTED  "order.create" is forbidden by the spec's rules but expected here
    blocks.0.expect.criteria.0  CRITERION_UNDEFINED  criterion "rude" is not defined in this spec's criteria
    blocks.0.expect.criteria.1  CRITERION_REF_INVALID  "polite@always" is not a criterion name, optionally followed by @gating
    blocks.0.expect.knowledge_retention.0.fact  RETENTION_FACT_UNKNOWN  fact "email" is in no ledger before this block: not in given.ledger, nor in an earlier ledger_add
    blocks.1.id  DUPLICATE_BLOCK_ID  block id "a" is used twice
    perturbations.0.inject_at  PERTURBATION_OUT_OF_RANGE  inject_at 5 is past the last position (2); it inserts before block n, counting from 0
    perturbations.1.id  DUPLICATE_PERTURBATION_ID  perturbation id "p1" is used twice
    perturbations.1  PERTURBATION_EMPTY  a perturbation needs `user`, `burst` or `world`
✓ out/authoring-spec-check/warnings.yaml  lint-warnings · 2 blocks · 1 perturbation · hash 2a1eceff25a2
Checked 2 specs: 1 valid, 1 invalid, 4 warnings.
(exit 1)
```

`spec lint` shows the four warnings of the valid one; `--strict` turns them into exit 1:

```sh
driftbench spec lint out/authoring-spec-check/warnings.yaml
driftbench spec lint out/authoring-spec-check/warnings.yaml --strict # exit 1
```

```text
$ driftbench spec lint out/authoring-spec-check/warnings.yaml
✓ out/authoring-spec-check/warnings.yaml  lint-warnings · 2 blocks · 1 perturbation · hash 2a1eceff25a2
  ! criteria  CRITERION_UNRESOLVED  criteria referenced without local definitions (reports_what_it_did); they must come from a shared catalogue
  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing
  ! blocks  TASK_WITHOUT_OUTCOME  a task spec should check what the agent produced: artifacts, workspace, execution or end_state
  ! perturbations.0  PERTURBATION_NO_RECOVERY  without a recovery expectation this deviation is run but its recovery is not measured
Checked 1 spec: 1 valid, 0 invalid, 4 warnings.
(exit 0)
$ driftbench spec lint out/authoring-spec-check/warnings.yaml --strict
✓ out/authoring-spec-check/warnings.yaml  lint-warnings · 2 blocks · 1 perturbation · hash 2a1eceff25a2
  ! criteria  CRITERION_UNRESOLVED  criteria referenced without local definitions (reports_what_it_did); they must come from a shared catalogue
  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing
  ! blocks  TASK_WITHOUT_OUTCOME  a task spec should check what the agent produced: artifacts, workspace, execution or end_state
  ! perturbations.0  PERTURBATION_NO_RECOVERY  without a recovery expectation this deviation is run but its recovery is not measured
Checked 1 spec: 1 valid, 0 invalid, 4 warnings.
(exit 1)
```

The same with `--json`:

```sh
driftbench spec lint out/authoring-spec-check/warnings.yaml --json
```

```text
$ driftbench spec lint out/authoring-spec-check/warnings.yaml --json
[
  {
    "path": "out/authoring-spec-check/warnings.yaml",
    "ok": true,
    "id": "lint-warnings",
    "hash": "2a1eceff25a2",
    "blocks": 2,
    "warnings": [
      {
        "level": "warning",
        "code": "CRITERION_UNRESOLVED",
        "path": "criteria",
        "message": "criteria referenced without local definitions (reports_what_it_did); they must come from a shared catalogue"
      },
      {
        "level": "warning",
        "code": "BLOCK_NO_EXPECTATION",
        "path": "blocks.0",
        "message": "this block checks nothing"
      },
      {
        "level": "warning",
        "code": "TASK_WITHOUT_OUTCOME",
        "path": "blocks",
        "message": "a task spec should check what the agent produced: artifacts, workspace, execution or end_state"
      },
      {
        "level": "warning",
        "code": "PERTURBATION_NO_RECOVERY",
        "path": "perturbations.0",
        "message": "without a recovery expectation this deviation is run but its recovery is not measured"
      }
    ]
  }
]
(exit 0)
```

## Common errors

```
$ driftbench spec validate nowhere
✗ nowhere
    (file)  SPEC_PARSE  cannot read the file: ENOENT: no such file or directory, open '<repo>/nowhere'
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
$ driftbench spec validate out/authoring-spec-check/empty
No spec files found.
(exit 1)
$ driftbench spec validate
error: missing required argument 'paths'
(exit 2)
```

| Symptom | Cause | Fix |
|---|---|---|
| `SPEC_PARSE ... ENOENT` | the path does not exist | fix the path; relative paths are read from the folder where you type the command |
| `No spec files found.` | the folder holds no `*.yaml`, `*.yml` or `*.spec.json` (a `.json` file must end in `.spec.json` to be found in a folder) | rename the files, or pass the file itself |
| `SPEC_PARSE` with a YAML message | bad indentation, an unquoted `:` or `{` in a value, a repeated key | quote the value, fix the indentation |
| a semantic error appears only after a schema fix | semantic rules run only once the schema passes | run `spec validate` again after each fix |
| exit 1 from `spec lint --strict` on a valid spec | a warning | fix it, or drop `--strict` |
