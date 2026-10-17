# CLI

`driftbench` is the command line. It checks spec files (`spec validate`, `spec lint`, `spec coverage`), plans and runs campaigns (`campaign plan`, `campaign run`, `campaign status`, `campaign resume`), checks that an agent is deterministic (`smoke`), measures the specs against a map of situations (`space coverage`, `space complete`, `space declare`), proposes that map (`extract`, `extract approve`, `extract map`), generates specs from it by code (`generate`), passes candidate blocks through the validity gate (`gate`), builds the reference set of user turns (`intake`), measures where results vary (`pilot`), judges criteria with the council (`judge`), builds code-agent task families (`family`), reads an agent estate into a map and derives its tests (`estate`), runs specs over recorded sessions (`replay`), prints the blocks a change to the agent can affect (`radius`), imports specs from a CSV file or a spreadsheet (`import`), versions spec sets and prompts in the store (`dataset`, `prompt`), and runs the validators that prove driftbench works (`validate`). The campaign and smoke commands, their output and their exit codes are on the [running](../running.md) page. What generation, the gate, intake, the pilot and families do is on the [generating](../generating.md) page.

## Running it

Version 0.1.0 is on npm: `npm install @agent-nexus/driftbench`, then `npx driftbench <command>`. From a clone of the repository:

```sh
pnpm install
pnpm driftbench spec validate path/to/specs
```

Relative paths are read from the folder where you type the command. `pnpm -s driftbench` prints only what driftbench prints, without pnpm's own lines. Every example on this page runs from the repository root.

The Acme example runs `spec validate`, `spec lint` and `spec coverage` on seven specs and an inventory: [`examples/acme`](../../examples/acme/README.md) shows the commands and their output.

The commands that run an agent reach two targets: `function:acme-sales` (or its short form `function:acme`), the Acme sales assistant, and `process:acme-ops`, the Acme ops agent. Other adapters are used from code.

Unless a command says otherwise, its exit code is 0 on success, 1 when what it checks fails, and 2 on a usage or input error. An option or argument error that the argument parser reports (an unknown option, a missing argument) always exits 2.

## Paths

Every command that reads specs takes one or more files or folders.

* A folder is searched recursively for `*.yaml`, `*.yml` and `*.spec.json` files, in sorted order.
* Entries whose name starts with a dot, `node_modules` and `dist` are skipped.
* A file ending in `.json` is read as JSON. Every other file is read as YAML.
* A path that does not exist is reported as an invalid spec with the code `SPEC_PARSE`.

## `driftbench spec validate`

```
driftbench spec validate <paths...> [--json]
```

Parses, normalises and validates every spec, then prints one line per spec and a summary.

```
$ pnpm -s driftbench spec validate examples/acme/specs
✓ examples/acme/specs/conversations/new-customer-coverage.yaml  acme-new-customer-coverage · 4 blocks · 2 perturbations · hash be195c993d4f
✓ examples/acme/specs/conversations/number-porting.yaml  acme-number-porting · 5 blocks · 2 perturbations · hash 134c8e993f95
✓ examples/acme/specs/conversations/off-topic-return.yaml  acme-off-topic-return · 5 blocks · 1 perturbation · hash cca285407040
✓ examples/acme/specs/conversations/order-loose-confirmation.yaml  acme-order-loose-confirmation · 4 blocks · 2 perturbations · hash ae116e6312eb
✓ examples/acme/specs/conversations/plan-upgrade.yaml  acme-plan-upgrade · 5 blocks · 3 perturbations · hash 5ae085d0b267
✓ examples/acme/specs/conversations/tool-failure.yaml  acme-tool-failure · 3 blocks · 1 perturbation · hash e5bc5c9ba9d2
✓ examples/acme/specs/tasks/price-sheet.yaml  acme-price-sheet · 2 blocks · 1 perturbation · hash d96437659138
Checked 7 specs: 7 valid, 0 invalid, 0 warnings.
```

An invalid spec lists every error with its path in the spec and its code:

```
$ pnpm -s driftbench spec validate _captures/docs3/cli/broken/semantic.yaml
✗ _captures/docs3/cli/broken/semantic.yaml
    blocks.0.expect.must.0  REGEX_INVALID  Invalid regular expression: /(/m: Unterminated group
    blocks.0.expect.criteria.0  CRITERION_UNDEFINED  criterion "c2" is not defined in this spec's criteria
    blocks.0.expect.stage  STAGE_UNKNOWN  stage "b" is not in the spec's stages
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
```

The hash is the first 12 hex characters of the SHA-256 of the spec's canonical JSON, with keys sorted at every depth. Equal content gives an equal hash. The hash, not the spec's `version`, is part of the runner's cache key and of every run id; `version` is a free label. See [running](../running.md#the-cache-and-replay).

| Option | Effect |
|---|---|
| `--json` | print one JSON document: an array with one entry per spec |

| Exit code | When |
|---|---|
| 0 | every spec is valid |
| 1 | a spec is invalid, or no spec file was found |
| 2 | usage error, such as a missing path or an unknown option |

## `driftbench spec lint`

```
driftbench spec lint <paths...> [--json] [--strict] [--sections <registries...>]
```

Validates every spec like `spec validate`, then prints the warnings of the valid ones. `--sections` also checks every `prompt_section` link against the section registry of its prompt (see [prompt sections and block links](../concepts/blast-radius.md#prompt-sections-and-block-links)).

```
$ pnpm -s driftbench spec lint _captures/docs3/cli/specs
✓ _captures/docs3/cli/specs/no-checks.yaml  no-checks · 1 block · hash dbe16886648e
  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing
Checked 1 spec: 1 valid, 0 invalid, 1 warning.
```

| Option | Effect |
|---|---|
| `--json` | print one JSON document |
| `--strict` | treat warnings as failures |

| Exit code | When |
|---|---|
| 0 | every spec is valid; warnings are allowed without `--strict` |
| 1 | a spec is invalid, no spec file was found, or a warning was printed with `--strict` |
| 2 | usage error |

## `driftbench spec coverage`

```
driftbench spec coverage <paths...> --inventory <file> [--channel <name>] [--json]
```

Reads a behaviour inventory and the specs, then prints two matrices. The inventory format is in the [spec reference](spec.md#inventory).

* Behaviours by channel: one row per behaviour, one column per channel. A cell is `covered` when a valid spec on that channel, or on no channel, lists the behaviour in `covers`. It is `missing` when no spec does, and `n/a` when the behaviour does not apply on that channel.
* Flows by required deviation: one row per flow. A spec belongs to a flow when it carries the tag `flow:<id>` or covers one of the flow's behaviours. A required deviation class is covered when a member spec has a perturbation of that class, or a block whose stimulus is an injection of that class.

Task behaviours and task specs are rows of the same matrices as conversations.

The channels are the inventory's `channels`. Without them, they are every channel named by a behaviour or a valid spec, sorted; without any, the one channel `default`. `--channel` narrows the matrix to one channel, and then only specs on that channel, or on no channel, count. Invalid specs are listed and never count as coverage. Warnings never change the verdict.

On the test fixtures in [`packages/core/test/coverage/fixtures`](../../packages/core/test/coverage/fixtures/inventory.yaml):

```
$ pnpm -s driftbench spec coverage packages/core/test/coverage/fixtures/specs --inventory packages/core/test/coverage/fixtures/inventory.yaml
Behaviours by channel
     id     kind          chat     whatsapp  title
  ✓  B-001  conversation  covered  covered   Greets the customer once and names the assistant
  ✓  B-002  conversation  covered  covered   Looks up the available plans before quoting a price
  ✓  B-003  conversation  covered  n/a       Sends the offer card once
  ✗  B-004  conversation  covered  missing   Asks for an explicit yes before submitting the order
  ✓  T-001  task          covered  covered   Builds the monthly usage sheet with one tab per line
     total                5 of 5   3 of 4

Flows by required deviation
  ✓  plan-upgrade  2 specs  D1_off_topic covered · D4_loose_confirmation covered  Plan upgrade from greeting to submission
  ✗  usage-report  1 spec   D2_goal_shift covered · D8_tool_failure missing       Monthly usage report built in the workspace
  -  offer-card    1 spec   no deviation required                                 Offer card on chat

Warnings
  ! B-099  UNKNOWN_BEHAVIOUR  covered by stray, but the inventory has no behaviour B-099

Invalid specs, not counted
  ✗ packages/core/test/coverage/fixtures/specs/broken.yaml  blocks.0  BLOCK_STIMULUS_MISSING  a block needs `user`, `burst` or `when`

Coverage: 4 of 5 behaviours covered, 3 of 4 flow deviations covered.
```

The command exits 1 here: B-004 is missing on whatsapp, and the usage-report flow misses D8_tool_failure.

| Option | Effect |
|---|---|
| `--inventory <file>` | the behaviour inventory, in YAML or JSON; required |
| `--channel <name>` | only this channel; an unknown channel is a usage error |
| `--json` | print one JSON document |

| Exit code | When |
|---|---|
| 0 | every applicable behaviour and every required deviation is covered |
| 1 | a behaviour is missing on a channel where it applies, or a required deviation is missing |
| 2 | usage or input error: an invalid inventory, a path that does not exist, no spec file found, or an unknown channel |

`--json` prints one document with the keys `inventory`, `channels`, `behaviours` (each with its cells and the ids of the covering specs), `perChannel`, `flows` (each with its member specs and, per required deviation, the perturbations and injection blocks that cover it), `warnings`, `invalidSpecs`, `summary` and `ok`.

Warnings:

| Code | Meaning |
|---|---|
| `UNKNOWN_BEHAVIOUR` | a spec covers a behaviour id the inventory does not list |
| `UNKNOWN_FLOW` | a spec carries the tag `flow:<id>` for a flow the inventory does not list |
| `UNLISTED_CHANNEL` | a spec runs on a channel the inventory's `channels` do not list, so it counts for no channel |
| `KIND_MISMATCH` | a behaviour is covered only by specs of the other kind: a task behaviour by conversation specs, or the reverse |

Inventory errors. Any of them stops the command before coverage is computed:

| Code | Meaning |
|---|---|
| `INVENTORY_PARSE` | the file cannot be read, or it is not valid YAML or JSON |
| `INVENTORY_NOT_OBJECT` | the file does not hold one mapping with behaviours and flows |
| `INVENTORY_DUPLICATE` | an id, a channel, a behaviour of a flow or a deviation class is listed twice |
| `INVENTORY_UNKNOWN_BEHAVIOUR` | a flow names a behaviour the inventory does not list |
| `INVENTORY_UNKNOWN_CHANNEL` | a behaviour names a channel that is not in the inventory's `channels` |
| `SCHEMA_*` | the schema refuses a value, as for specs |

## JSON output

`spec validate --json` and `spec lint --json` print one array. A valid spec:

```json
{
  "path": "_captures/docs3/cli/specs/no-checks.yaml",
  "ok": true,
  "id": "no-checks",
  "hash": "dbe16886648e",
  "blocks": 1,
  "warnings": [
    {
      "level": "warning",
      "code": "BLOCK_NO_EXPECTATION",
      "path": "blocks.0",
      "message": "this block checks nothing"
    }
  ]
}
```

An invalid spec:

```json
{
  "path": "_captures/docs3/cli/broken/bad.yaml",
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
```

`path` inside an issue is the dotted path in the spec, such as `blocks.2.expect.tools.0.label`. It is empty when the issue concerns the whole file.

## Issue codes

Every problem has a stable code, so tools and tests can branch on it. An error makes a spec invalid. A warning is advice on a valid spec; `spec lint` prints it.

| Code | Level | Meaning |
|---|---|---|
| `SPEC_PARSE` | error | the file cannot be read, or it is not valid YAML or JSON |
| `SPEC_SCHEMA_VERSION` | error | `schema_version` names a spec format newer than this driftbench reads: upgrade driftbench |
| `SPEC_NOT_OBJECT` | error | the file does not hold one mapping at the top level |
| `SPEC_ALIAS_CONFLICT` | error | a shorthand and its long form are both set: `ledger_seed` with `given.ledger`, or `workspace_seed` with `given.world.workspace` |
| `BLOCK_STIMULUS_MISSING` | error | a block has none of `user`, `burst` and `when` |
| `BLOCK_STIMULUS_AMBIGUOUS` | error | a block has more than one of `user`, `burst` and `when` |
| `REGEX_INVALID` | error | a pattern in `must`, `must_not` or a `regex` assertion does not compile |
| `CRITERION_REF_INVALID` | error | a criterion reference is not a name, optionally followed by `@gating` |
| `CRITERION_UNDEFINED` | error | the spec defines `criteria`, and a block names one that is not there |
| `CRITERION_DUPLICATE` | error | two criteria share a name |
| `PERTURBATION_OUT_OF_RANGE` | error | `inject_at` is past the last position |
| `PERTURBATION_EMPTY` | error | a perturbation has none of `user`, `burst` and `world` |
| `DUPLICATE_BLOCK_ID` | error | two blocks share an id |
| `DUPLICATE_PERTURBATION_ID` | error | two perturbations share an id |
| `TOOL_COUNT_CONTRADICTION` | error | a tool is expected 0 times but has input assertions |
| `COUNT_RANGE_INVALID` | error | a count has a `min` greater than its `max` |
| `MUST_CONFLICT` | error | the same pattern is in `must` and in `must_not` |
| `STAGE_UNKNOWN` | error | the spec lists `stages`, and `expect.stage` or `recovery.stage_after` names a stage that is not there |
| `RETENTION_FACT_UNKNOWN` | error | `expect.knowledge_retention` names a fact that no ledger holds before the block: not in `given.ledger`, nor in an earlier block's `ledger_add` |
| `TOOL_FORBIDDEN_EXPECTED` | error | a block expects a tool that the rules forbid, in `forbidden_tools` or with `max_calls` at 0 |
| `GIVEN_ORIGIN_WITHOUT_PREFIX` | error | a block's `given.origin` says where a prefix comes from, and the block writes no `given.prefix` |
| `OBJECT_INVALID` | error | an object file, an inline object in `uses` or a `uses.yaml` does not fit the object format, or a file sits at a path that does not match its kind and id |
| `OBJECT_KIND_UNKNOWN` | error | an object names a kind no package or plugin registered; the message lists the known kinds |
| `OBJECT_UNKNOWN` | error | `uses` names an object no layer defines; the message names the spec, the block, the kind, the id and the layers searched |
| `OBJECT_CYCLE` | error | objects extend each other in a loop; the message prints the loop |
| `OBJECT_DUPLICATE` | error | one kind and id are defined twice at the same layer |
| `OBJECT_SHIPPED_IMMUTABLE` | error | a project or suite file redefines a shipped object; write one with another id that extends it |
| `OBJECT_ITEM_UNKNOWN` | error | an operation, an `order` or a move names an item the parent does not hold; the message lists the parent's items |
| `OBJECT_ITEM_EXISTS` | error | `add: true` names an item the parent already holds |
| `OBJECT_ITEM_INCOMPLETE` | error | a new item lacks `title`, `when`, `effect` or `impl`, or a root object lists an item without its full definition |
| `OBJECT_ORDER_INVALID` | error | an `order` leaves out an enabled item or lists one twice, or a file sets `order` and moves an item |
| `OBJECT_IMPL_UNKNOWN` | error | an enabled item names an implementation no builtin or plugin provides |
| `OBJECT_PARAMS_INVALID` | error | an item's params do not fit its implementation's schema; the message names the path |
| `LINK_BLOCK_UNKNOWN` | error | a link in `metadata.links` names a block id the spec does not have, or an index past its last block |
| `LINK_TARGET_UNKNOWN` | error or warning | `spec lint --sections` only: error when the registry of the prompt has no such section, warning when no registry was given for the prompt |
| `LINK_STALE` | warning | `spec lint --sections` only: the link's status is `stale`, or its section was not found again in the registry's version |
| `SCHEMA_*` | error | the schema refuses a value; the suffix is the zod issue code, such as `SCHEMA_UNRECOGNIZED_KEYS`, `SCHEMA_INVALID_TYPE`, `SCHEMA_INVALID_VALUE` or `SCHEMA_TOO_SMALL` |
| `CRITERION_UNRESOLVED` | warning | blocks name criteria and the spec defines none; they must come from a shared catalogue |
| `BLOCK_NO_EXPECTATION` | warning | a block checks nothing |
| `TASK_WITHOUT_OUTCOME` | warning | a task spec checks none of `artifacts`, `workspace`, `execution` and `end_state` |
| `PERTURBATION_NO_RECOVERY` | warning | a perturbation has no `recovery`, so its recovery is not measured |
| `PREFIX_PROSE_HISTORY` | warning | an assistant message of a prefix states a ledger fact in its text that no recorded tool call of the prefix holds and the user never said, in a spec that names tools: the agent may call the tool again |

## Global options

| Option | Effect |
|---|---|
| `-V`, `--version` | print the version |
| `-h`, `--help` | print the usage of the program or of a command, ending with the help topics about it; `driftbench help <command>` does the same |
| `driftbench help [topic]` | without a topic, print the index of every help topic, grouped by area; with one, such as `core-exit-codes`, print that topic: what a capability is, when to use it, every option, inputs, outputs, a worked example and common errors |
| `--plugin <module>` | load a [plugin](../plugins.md) before the command runs: a module path, relative to the working folder, or a package name. Repeat it for several. It may stand anywhere on the command line. |

## Campaigns and smoke

These commands run specs on a target. Each has its options, its output and its exit codes on the [running](../running.md) page. `campaign run` and `campaign plan` also take their settings from the `campaign:` key of the project config, `driftbench.yaml` or `--config <file>`, where no flag is given: see [the campaign key](../running.md#the-campaign-key).

```
driftbench campaign plan <paths...> [--target <adapter[:agent]>]... [--route <tag=target>]... [--mode <modes>] [--repeats <n>] [--budget-usd <usd>] [--baseline-rate <rate>] [--rho <rho>] [--store <file>] [--config <file>] [--json]
driftbench campaign run [paths...] [--dataset <ref>] [--prompt <ref>] [--target <adapter[:agent]>]... [--route <tag=target>]... [--mode <modes>] [--repeats <n>] [--agent-version <label>] [--change <manifest> --from <campaign> [--audit <n>] [--audit-seed <n>] [--max-carry <n>] [--max-age <days>] [--block-reruns]] [--record-end-state-snapshots] [--record-realized-text] [--campaign <id>] [--store <file>] [--no-cache] [--concurrency <n>] [--budget-usd <usd>] [--process-command <command>] [--retry-attempts <n>] [--retry-base-ms <ms>] [--retry-max-ms <ms>] [--driver scripted|simulated] [--persona <file>]... [--recording <file>]... [--model] [--agent-family <family>] [--judge-family <family>]... [judge flags] [run check flags] [--config <file>] [--json]
driftbench campaign resume [campaignId] --store <file> [--no-cache] [--concurrency <n>] [--budget-usd <usd>] [--process-command <command>] [--retry-attempts <n>] [--retry-base-ms <ms>] [--retry-max-ms <ms>] [--json]
driftbench campaign status [campaignId] --store <file> [--detail] [--json]
driftbench campaign export <campaignId> --store <file> --out <dir>
driftbench campaign import <folder> --store <file>
driftbench smoke <spec> [--target <adapter[:agent]>] [--runs <n>] [--json]
```

| Command | Does |
|---|---|
| [`campaign plan`](../running.md#driftbench-campaign-plan) | expands specs, targets, modes and repeats into cells, projects their cost and prints the minimum detectable effect |
| [`campaign run`](../running.md#driftbench-campaign-run) | runs every cell and prints pass or fail per cell |
| [`campaign status`](../running.md#driftbench-campaign-status) | prints the state of every cell of a stored campaign; with `--detail`, also the compounding index (T minus F), the succession of every run and the recovery of every perturbed run |
| [`campaign resume`](../running.md#driftbench-campaign-resume) | runs the cells of a stored campaign that have no completed run, and reuses the others; each cell runs on the target the campaign pinned for it |
| [`campaign export`](../datasets.md#run-a-campaign-again-elsewhere) | writes a stored campaign as a folder: its runs, the specs it ran, and the exact files of the dataset and prompt versions it records |
| [`campaign import`](../datasets.md#run-a-campaign-again-elsewhere) | stores such a folder in another store, all or nothing, so the campaign can be read and run again there |
| [`smoke`](../running.md#driftbench-smoke) | runs one spec several times with the cache off and reports whether the transcripts differ |

| Option | Effect |
|---|---|
| `--target <adapter[:agent]>` | run every spec on this target; repeat it for several. Without it, each spec runs on its own target |
| `--route <tag=target>` | `plan` and `run`: a spec carrying the tag runs on this target instead of the `--target` list, such as `flow:price-sheet=process:acme-ops` for a suite that mixes conversations and code-agent tasks; repeat it; needs `--target` |
| `--mode <modes>` | the run mode: `T` teacher-forced, `F` free-running (the default), `P` perturbed; several separated by commas, such as `T,F`. See [run modes](../concepts/run-modes.md) |
| `--repeats <n>` | runs per spec, target and mode; default 1 |
| `--budget-usd <usd>` | `plan`: compare the projected cost with this budget. `run`: no cell starts once the campaign has spent this much. `resume`: the same stop, by default the budget the campaign was run with |
| `--baseline-rate <rate>` | the pass rate the minimum detectable effect assumes; default 0.5 |
| `--rho <rho>` | the correlation of repeats of one spec, from 0 to 1; default 0 |
| `--agent-version <label>` | the version of the agent under test. It is written as the `variant` of every target that names none, so the runs record which agent produced them. The target is part of the cell id and of the cache key: a run under `v2` never reuses a run or a cached block of `v1`. With `--prompt`, the prompt hash is the version and the label is recorded beside it. |
| `--change <manifest>` | run only the [blast radius](../concepts/blast-radius.md) of this change manifest, and carry the stored run of every other cell from the `--from` campaign. It needs `--from`, `--store` and an agent version. Without it, nothing changes: every cell runs |
| `--from <campaign>` | with `--change`: the stored campaign the carried runs are read from |
| `--audit <n>` | with `--change`: draw n of the cells about to be carried, run them fresh and compare each with its stored run on every gating verdict. One that differs is a radius miss: nothing is carried, every cell runs, and the command exits 1. `--audit-seed <n>` sets the draw (default 1) |
| `--max-carry <n>` | with `--change`: the most campaigns in a row a result is carried (default 5). A result past it runs fresh |
| `--max-age <days>` | with `--change`: the most days since a carried result was measured (default 7) |
| `--block-reruns` | with `--change` in mode T: send only the blocks a change can affect and keep the other stored blocks of a cell; see [mode T block reruns](../concepts/blast-radius.md#mode-t-block-reruns) |
| `--record-end-state-snapshots` | store the raw end-state values each mode T block reads, so a later `--block-reruns` can rerun cells with `end_state` in part; the values may be sensitive |
| `--record-realized-text` | store the text a driver sent where it differs from the spec (a simulated user, a red-team attacker) as `realized.text`; off, each such block keeps only its hash; the text may be private |
| `--campaign <id>` | the campaign id; without it, one is made from the content and the clock |
| `--dataset <ref>` | `run` only: run the specs of this dataset version of the store and record it in the campaign; needs `--store`. See [datasets](../datasets.md) |
| `--prompt <ref>` | `run` only: the agent runs with this prompt version of the store, a single text file: every target carries it in `target.prompt`, and the campaign records it; give it once; needs `--store`. Each adapter page says how the text reaches the agent |
| `--store <file>` | `plan`: read the measured unit costs from this store. The others: the store that keeps the campaign, its runs and the cache; required by `resume` and `status` |
| `--no-cache` | neither replay runs from the cache nor write to it |
| `--concurrency <n>` | cells run at the same time; default 4 |
| `--retry-attempts <n>` | `run` and `resume`: attempts per model call, the first included, over the spec target's `retry`; default 4. See [retries](../retries.md) |
| `--retry-base-ms <ms>` | `run` and `resume`: the wait before the first retry, doubled for each later one; default 500 |
| `--retry-max-ms <ms>` | `run` and `resume`: the longest wait between two attempts; default 30000 |
| `--detail` | `status` only: also print the compounding index, the succession and the recovery tables |
| `--runs <n>` | `smoke` only: how many runs to compare, at least 2; default 3 |
| `--driver <driver>` | `run` only: who writes the user turns, `scripted` (the spec's own, the default) or `simulated` (a persona, see [simulated user](../simulated-user.md)) |
| `--persona <file>` | `run --driver simulated`: a persona, which plays the spec its file names; one per spec, repeat it |
| `--recording <file>` | `run --driver simulated`: replay a recording of the user's answers; repeat it |
| `--model` | `run --driver simulated`: the user speaks through the model port (a paid call per turn) |
| `--agent-family <family>`, `--judge-family <family>` | `run --driver simulated`: the families the user's model must differ from; the Acme agents are `none`. `--agent-family` also refuses a judge of that family |
| judge flags, run check flags | `run`, `resume`, and the judge flags on `smoke`: see [judge flags](#judge-flags) |
| `--json` | print one JSON document |

| Exit code | When |
|---|---|
| 0 | `plan`: the plan printed. `run`, `resume`, `status`: every cell passes. `smoke`: the transcripts are identical |
| 1 | `run`, `resume`: a cell fails, failed, or was stopped. `status`: any cell that does not pass, not run and blocked included. `smoke`: the transcripts differ, or a run fails |
| 2 | bad input: an unknown target, an invalid spec or none found, a bad number, a store that cannot be opened |
| 3 | `run`, `resume`: no cell failed, but a cell was not run or blocked (a Given the target cannot apply), as `ci` does |

## Judge flags

`replay`, `estate run`, `campaign run`, `campaign resume`, `campaign rejudge`, `ci`, `smoke` and `compare --pairwise` take the same judge flags; `judge run` and `judge calibrate` take the route flags below. With none of them a command judges as before: `replay`, `estate run` and `rejudge` leave every judged criterion inconclusive, and `campaign run`, `resume`, `ci` and `smoke` load no judge check.

| Flag | Does |
|---|---|
| `--judge <kind>:<model>` | a judge; repeat it for a council. Kinds: `claude` (the local claude command), `openai`, `anthropic`, `google`, `openai-decisions`, the platform judge kind the [Nexus adapter](../adapters/nexus.md) page names, and `http:<family>@<url>`. A provider kind alone, such as `--judge openai`, reads its model from the environment. Keys always come from the environment, as each client reads them. Paid calls |
| `--judge-command <path>` | the claude command a `claude` judge runs; default `claude` |
| `--judge-budget <usd>` | stop judging once the judges have spent this much; needed by a `claude` judge on a command that is not a stand-in |
| `--judges <cassette>` | add every judge of a recorded cassette (JSON, as `--record` and `judge calibrate --record` write it) as a player: no call. A cassette only: there is no judges YAML file |
| `--judge-mode system1\|hybrid\|llm` | the council mode; default from the classes of the judges |
| `--assignments <file>` | the assignment table `judge calibrate` wrote |
| `--cascade` | the council asks its cheapest judge first and stops on a sure pass |
| `--weights <judge=weight,...>` | council vote weights, inline or a YAML file of `judge: weight` |
| `--record <cassette>` | save every live judge answer as a cassette, to replay with `--judges` |
| `--agent-family <family>` | the model family of the agent under test: a judge of that family is refused before any call, for a single judge, a panel, a route, a council, and every pairwise judge of `compare` (`--pairwise-judge` and its default included); `none` for no model |
| `--judge-route escalation` | a label-blind router: `--route-first <judge>` answers, the `--route-then <judge>` judges (repeat it) answer when a trigger fires. `--route-on` takes `order-split`, `inconclusive`, `reference-disagreement`, `low-confidence` (default all four), `--route-confidence` the low-confidence bar (default 0.5), `--route-decide` `majority` or `first-stands`. A judge is a `kind:model` or a judge id, such as one of a cassette |
| `--panel-weights <judge=weight,...>` | a weighted panel of every judge; `--panel-margin <share>` is the smallest winning margin (default 0.3), below it the panel abstains: inconclusive |
| `--reference-solve <kind:model>` | solve each question blind first (`claude`, `openai`, `anthropic`, `google`) and judge against the agreed answer; `--reference-samples <n>` from 1 to 20 (default 5), `--reference-route auto` solves only a question with one checkable answer. One judge, a route or a panel; refused on a council |

The run commands (`campaign run`, `resume`, `ci`, `replay`, `estate run`) also take:

| Flag | Does |
|---|---|
| `--owner <values...>`, `--owner-file <file>` | the owner's own values the pii check leaves out |
| `--tool-policy <rules.yaml>` | a run-wide tool policy, a YAML list of `{ pattern, action: allow \| deny \| ask }` or a map of `pattern: action`. Each run marks a call a rule denies (`ask` counts as denied) and the `tool_policy` check fails its block. It checks the calls the agent made: it does not stop the agent making them |
| `--embedder <name>` | the embedder the similarity check scores with, as a plugin registered it with `api.embedder(name, factory)` |

`judge calibrate` also takes `--judge <kind>:<model>` beside `--claude`, and `--judge-route escalation` with the route flags: it measures that route label-blind, as a run would route, and writes the cascade report to `--out`.

## `driftbench space`

The space commands read a map of the situations an agent can face, and count how much of it the specs cover. The map is a YAML or JSON file, usually beside the agent's inventory; [`packages/space/test/fixtures/acme-space.yaml`](../../packages/space/test/fixtures/acme-space.yaml) is a hand-written Acme map, and [`examples/acme/map`](../../examples/acme/map/README.md) holds the one `extract map` writes from the approved proposal. Every key is checked strictly.

| Key | Holds |
|---|---|
| `version`, `agent` | the map's version and the agent it describes |
| `inventory` | optional: the behaviour inventory, relative to the map; the flow deviations it requires become required cells |
| `dimensions` | each with an `id`, a `title`, a `kind` (`stage`, `behaviour`, `deviation`, `persona`, `channel`, `data` or `task`) and its `values`. A value has an `id`, a `title`, an optional relative `weight`, and `required: true` when it must be covered. |
| `constraints` | combinations that cannot happen: `forbid` names a value per dimension, with a `reason` |
| `prior` | `declared` or `fitted` (a fitted prior names its `source`), with optional `weights` per dimension |

A cell is one value per dimension. The value `none` is reserved: it collects a block or a spec that names no value of the dimension. A spec is placed by its blocks and perturbations: the stage from a block's `expect.stage` (a deviation sits on the stage the conversation has reached when it arrives), the deviation from an injection or a perturbation, the behaviours from `covers`, the channel from `channel`, and persona, data and task from the tags `persona:<id>`, `data:<id>` and `task:<id>`.

### `driftbench space coverage`

```
driftbench space coverage <paths...> --map <file> [--t <n>] [--json]
```

Counts the cells of the map the specs cover: per dimension, on every subset of `t` dimensions (the full grid without `--t`), weighted by the prior, and for each required cell. A cell the constraints forbid counts in neither the covered cells nor the allowed ones.

```
$ pnpm -s driftbench space coverage --map packages/space/test/fixtures/acme-space.yaml examples/acme/specs --t 2
Map acme-sales, version 1: 6 dimensions, 54432 cells, 5 constraints, prior declared (Owner estimate for the fictional Acme example)

Dimensions
  id         kind       values  covered  not covered
  stage      stage      12      12
  behaviour  behaviour  14      13       B-007
  deviation  deviation  9       7        D2_goal_shift, D3_contradiction
  channel    channel    2       2
  persona    persona    3       0        cooperative, terse, sceptical
  data       data       6       1        fiber, no-fiber, check-fails, portable, locked

Grid at t = 2: 15 subsets of 2 dimensions
  cells     818 allowed of 823 (5 forbidden by the constraints)
  covered   199 (24.3%)
  weighted  34.0% of the declared user mix, effective sample size 6.3 of 7 specs

t-wise coverage
  t = 2  199 of 818 allowed pairs (24.3%)
  t = 3  399 of 7082 allowed triples (5.6%)

Required cells
  ✓  stage=recap · deviation=D4_loose_confirmation  acme-order-loose-confirmation, acme-plan-upgrade
  ✓  flow new-home · D1_off_topic                   acme-new-customer-coverage, acme-off-topic-return
  ✗  flow new-home · D5_language_switch             no spec
  ✓  flow new-home · D6_instruction_in_data         acme-new-customer-coverage
  ✓  flow new-home · D8_tool_failure                acme-order-loose-confirmation, acme-tool-failure
  ✓  flow new-home · D10_return                     acme-off-topic-return
  ✗  flow order · D2_goal_shift                     no spec
  ✗  flow order · D3_contradiction                  no spec
  ✓  flow order · D4_loose_confirmation             acme-order-loose-confirmation, acme-plan-upgrade
  ✓  flow order · D8_tool_failure                   acme-order-loose-confirmation, acme-plan-upgrade, acme-tool-failure
  ✓  flow price-sheet · D6_instruction_in_data      acme-price-sheet

Warnings
  ! D7_silence_or_burst  UNKNOWN_VALUE  deviation D7_silence_or_burst is named by acme-number-porting, but no deviation dimension of the map lists it
  ! D9_out_of_scope  UNKNOWN_VALUE  deviation D9_out_of_scope is named by acme-plan-upgrade, but no deviation dimension of the map lists it

Coverage: 8 of 11 required cells covered, 199 of 818 cells at t = 2 (24.3%).
```

The command exits 1 here: three required flow deviations have no spec.

### `driftbench space complete`

```
driftbench space complete <paths...> --map <file> [--t <n>] [--json]
```

Treats the specs as a sample of conversations and prints how complete it is: the share of the cells that have appeared, and the chance that the next conversation shows a new one, with bootstrap intervals and the Hill numbers of the cells seen. The line prints only when there are at least as many conversations as allowed cells at strength `t`; otherwise the command says why.

```
$ pnpm -s driftbench space complete examples/acme/specs --map packages/space/test/fixtures/acme-space.yaml --t 1
Completeness at t = 1: 46 cells, 7 conversations
  seen          35 cells; f1 15, f2 11
  Hill numbers  q0 35 · q1 28.1 · q2 22.7

No completeness line: the estimate needs at least as many conversations as cells, and there are 7 for 46.
```

### `driftbench space declare`

```
driftbench space declare <paths...> --inventory <file> --out <file> [--agent <name>]
```

Writes a first map from the inventory and the specs, for the owner to edit: the stages of the specs, the behaviours, the deviations the flows require, and the channels. Persona, data and task dimensions are left to the owner. An existing file is never overwritten.

| Option | Effect |
|---|---|
| `--map <file>` | the map, in YAML or JSON; required by `coverage` and `complete` |
| `--t <n>` | cells on every subset of `n` dimensions, from 1 to the number of dimensions; default the full grid |
| `--json` | print one JSON document |
| `--inventory <file>` | the behaviour inventory; required by `declare` |
| `--out <file>` | where `declare` writes the map; required |
| `--agent <name>` | the agent the declared map describes |

| Exit code | When |
|---|---|
| 0 | `coverage`: every required cell is covered; `complete`: the line printed; `declare`: the map written |
| 1 | `coverage`: a required cell is empty; `complete`: too few conversations for the line |
| 2 | usage or input error: an invalid map, an unreadable inventory, `t` out of range, a missing path, no spec file, a full grid over 250000 cells, or a `declare` target that exists |

Warnings never change the exit code:

| Code | Meaning |
|---|---|
| `UNKNOWN_VALUE` | a spec names a value no dimension of that kind lists |
| `UNPLACED_SPEC` | a spec falls in no allowed cell, and the warning says why |
| `FORBIDDEN_CELL` | a spec reaches a cell the constraints forbid; it is not counted |
| `PRIOR_EMPTY` | the prior gives no weight to any allowed cell, so no weighted share is computed |

A map that does not load stops the command with its issues: `SPACE_PARSE`, `SPACE_NOT_OBJECT`, `SPACE_DUPLICATE`, `SPACE_KIND_REPEATED`, `SPACE_AMBIGUOUS_VALUE`, `SPACE_UNKNOWN_DEVIATION`, `SPACE_EMPTY_CONSTRAINT`, `SPACE_UNKNOWN_DIMENSION`, `SPACE_UNKNOWN_VALUE`, `SPACE_PRIOR_INCOMPLETE`, `SPACE_PRIOR_ZERO`, `SPACE_PRIOR_SOURCE`, `SPACE_GRID_EMPTY`, or `SCHEMA_*`, each with its path in the map.

## `driftbench extract`

```
driftbench extract --prompt <file> [--prompt <file>] --inventory <file> [--tools <file>] --out <file> [--no-model] [--provider anthropic|openai] [--replay <file>] [--agent <name>] [--force]
driftbench extract approve <proposal> [--dimension <id>]... [--all] [--to <file>]
driftbench extract map <proposal> --to <file> [--all]
```

Proposes the map of situations from an agent's prompt or policy, its inventory and its tool schemas, for a person to approve. Code reads the inventory and the tools first; a model then proposes stages, rules, personas, data and phrases, each value quoting the text that justifies it. Each dimension has a role: an `axis` enters the space map, a `detail` stays in the proposal for generation. The proposal is not a space map: the space commands read it only through `extract map`, which writes the map of the approved axes. Nothing counts until a person approves it.

| Option | Effect |
|---|---|
| `--prompt <file>` | the agent prompt or policy; repeat it for several files; required |
| `--inventory <file>` | the behaviour inventory; required |
| `--tools <file>` | tool schemas, or a spec whose `metadata.tool_schemas` lists them |
| `--out <file>` | where to write the proposal, in YAML; required |
| `--no-model` | run only the code pass on the inventory and the tools |
| `--provider <name>` | `anthropic` or `openai`; default the first whose key is set in the environment |
| `--replay <file>` | replay recorded answers instead of calling a model |
| `--agent <name>` | the agent name; default the folder of the inventory |
| `--force` | replace an existing proposal; the approvals in it are lost |

`extract approve <proposal>` lists the decisions still open and the size of the grid the axes make. `--dimension <id>` approves a dimension and the values that inherit its flag; repeat it. `--all` approves every entry. `--to <file>` writes the approved proposal to another file in the same folder, so its quotes still resolve, instead of over it. A person can also approve an entry by setting `approved: true` on it. On the Acme proposal:

```
$ pnpm -s driftbench extract approve examples/acme/map/proposal.yaml
examples/acme/map/proposal.yaml: 291 of 291 decisions are open (51 dimensions, 111 constraints, 55 phrases, 74 relations).
Axes: 7 of 51 dimensions, a full grid of 113568 cells (the space commands accept 250000).
  dimension   behaviour  behaviour axis, by code, 14 values: The behaviours the inventory lists
  dimension   flow  behaviour detail, by code, 5 values: The flows the inventory lists
  dimension   deviation  deviation axis, by code, 10 values: The deviation classes the flows must be perturbed with
  dimension   channel  channel axis, by code, 2 values: The channels the inventory names
```

The listing goes on with one line per open decision.

`extract map <proposal> --to <file>` writes the space map of the approved axis dimensions and their constraints, for the `space` commands; `--all` takes every axis value, approved or not.

```
$ pnpm -s driftbench extract map examples/acme/map/approved.yaml --to _captures/docs3/cli/space.yaml
Wrote _captures/docs3/cli/space.yaml: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 380 constraints, a full grid of 212940 cells.
```

[`examples/acme/map`](../../examples/acme/map/README.md) holds the Acme proposal, its approved copy, its space map and the commands that made them.

| Exit code | `extract` | `extract approve` | `extract map` |
|---|---|---|---|
| 0 | the proposal is written and complete | listed, or approved | the space map is written |
| 1 | written, with a section that failed or an entry refused | the proposal is invalid, or names an unknown dimension | the proposal is invalid, or the space map is (no approved axis, every cell forbidden) |
| 2 | usage or input error; nothing is written | the file is not found, `--all` with `--dimension`, or `--to` outside the proposal's folder | the file is not found, or `--to` is missing |

A proposal that does not load reports `PROPOSAL_PARSE`, `PROPOSAL_NOT_OBJECT`, `PROPOSAL_EVIDENCE_MISSING`, `PROPOSAL_DUPLICATE`, `PROPOSAL_UNKNOWN_SOURCE`, `PROPOSAL_UNKNOWN_DIMENSION`, `PROPOSAL_UNKNOWN_VALUE`, `PROPOSAL_SOURCE_UNREADABLE`, `PROPOSAL_QUOTE_NOT_FOUND`, a `SPACE_*` code or a `SCHEMA_*` code, each with its path in the proposal.

## `driftbench generate`

```
driftbench generate --map <file> --out <dir> [--t <n>] [--seed <n>] [--max <n>] [--budget <n>] [--spec-cap <n>] [--spec-cap-mode tuples|pairs] [--tasks <n>] [--baseline <path>]... [--force] [--json]
                    [--model --reference <adapter:agent>... --faults <set> [--proposals <n>] [--k <n>]]
```

Generates specs from an approved map, by code: paths through the stage graph, the rows of a t-wise covering array, boundary values, one probe per deviation class, metamorphic families, and the instances of every task family the map names in a `task_family` relation. No model is called unless `--model` is given: the model port then proposes more specs, and each counts only once the gate accepts it (see [model proposals](../generating.md#model-proposals-generate---model)). Complete specs go to `specs/`, specs with a placeholder or a block the map supports no machine Then for go to `incomplete/`, and `generate-report.json` holds the counts. See [generating](../generating.md).

| Option | Effect |
|---|---|
| `--map <file>` | the approved map: a proposal whose every entry is approved; required |
| `--out <dir>` | the folder to write the specs and `generate-report.json` into; required |
| `--t <n>` | the strength of the covering array; default 3 |
| `--seed <n>` | the integer seed of every seeded choice; default 1 |
| `--max <n>` | the most specs per seeder |
| `--budget <n>` | budget mode: N conversations in place of the t-wise rows, placed by pair coverage first and value balance second; the other seeders are unchanged. Adds a `budget` block to the report. See [budget mode](../generating.md#budget-mode) |
| `--spec-cap <n>` | total written specs; keeps structural, fault and incomplete specs, then selects actual tuple coverage. See [total spec cap](../generating.md#total-spec-cap) |
| `--spec-cap-mode <mode>` | `tuples` by default; `pairs` explicitly permits reported triple losses. Requires `--spec-cap` |
| `--tasks <n>` | instances built per `task_family` relation the map names, each with its corner and planted variants; default 8. A family that does not load, uses an unapproved phrase, or has a missing, invalid or stale review is refused with its reason and counts as a defect. See [task families in the map](../generating.md#task-families-in-the-map) |
| `--baseline <path>` | specs to measure on the same map, for comparison; repeat it |
| `--force` | replace the output of an earlier run in the folder |
| `--json` | print the report as JSON |
| `--model` | also ask the model port for specs, gated before they count; needs `--reference` and `--faults` |
| `--proposals <n>` | with `--model`: how many specs to ask for; default 3 |
| `--reference <adapter:agent>`, `--faults <set>`, `--k <n>` | with `--model`: the gate's reference agents, fault set and repeats |

On the approved Acme map:

```
$ pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out _captures/docs3/cli/generated --t 2
Actual axis-map coverage (written complete specs): pairs 708 of 708 (100.0%); triples 2928 of 4064 (72.0%).
Candidate t-wise array (before the total cap): covering array of 156 rows over 5 dimensions, 356 of 356 allowed 2-tuples (100.0%); 2 pairs no path reaches are left out.
Uncovered on the axis map: 0 pairs, 1136 triples (see coverage.actual[].uncovered).
Map acme (../../../../examples/acme/map/approved.yaml), hash 7c05b9cee9cc: 51 dimensions, 187 values, 463 constraints, 55 approved phrases.
Seed 1, t = 2.

Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           156     793       153           3
boundary         85     183        13          72
deviation        21     111        21           0
metamorphic      42     192        42           0
task             67      71        67           0
cover            24     135        24           0

Stage graph: 18 of 23 edges covered in 12 paths from needs.
Constraints applied: 463.
Deviation probes: 12 of 12 classes. Metamorphic families: 21.
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%).

Values with no approved phrase (72): their blocks are placeholders in incomplete/.
  catalog.search.in.category=catalog.search.in.category.mobile  1 block(s)
  catalog.search.in.category=catalog.search.in.category.home  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.below-min-length  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.at-min-length  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.absent  1 block(s)
  catalog.search.in.address_id=catalog.search.in.address_id.present  1 block(s)
  catalog.search.in.address_id=catalog.search.in.address_id.absent  1 block(s)
  catalog.search.in.unknown-key=catalog.search.in.unknown-key.sent  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.empty  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.one-item  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.several-items  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.present  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.null  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.absent  1 block(s)
  coverage.check.in.address=coverage.check.in.address.below-min-length  1 block(s)
  ... 57 more in generate-report.json

Specs with a block the map supports no machine Then for (18), in incomplete/: gen-twise-108, gen-twise-109, gen-twise-114, gen-boundary-008, gen-boundary-017, gen-boundary-031, gen-boundary-046, gen-boundary-060, gen-boundary-067, gen-boundary-068, ....
  Most frequent reasons:
     3  it needs user_type in existing-customer; the cell holds new-customer
     3  the constraints allow no value of port_result it needs with this cell
     2  it needs coverage_result in fiber, 5g-only; the cell holds none
     2  it needs coverage_result in fiber; the cell holds none
     2  it needs coverage_result in no-service; the cell holds none
     1  no approved path needs callback_phone=not-given
     1  no approved path needs catalog.search.in.unknown-key=catalog.search.in.unknown-key.sent
     1  no approved path needs coverage.check.in.unknown-key=coverage.check.in.unknown-key.sent
Wrote 504 files to _captures/docs3/cli/generated.
exit 1
```

| Exit code | When |
|---|---|
| 0 | the suite is written, and every block has an approved phrase and a Then |
| 1 | the suite is written with incomplete specs, a seeder cut by `--max`, or a generator defect, each listed |
| 2 | usage or input error, nothing written: an invalid or unapproved map, a bad number, an invalid baseline spec, an earlier output without `--force` |

## `driftbench simulate`

```
driftbench simulate <spec> --persona <file> (--model | --recording <file>) [--target <adapter[:agent]>] [--turns <n>] [--agent-family <family>] [--judge-family <family>]... [--json]
```

A simulated user plays the persona on the spec, through the model port or a recording. Options, output and exit codes on the [simulated user](../simulated-user.md) page.

## `driftbench attack`

```
driftbench attack <spec> [--target <adapter[:agent]>] [--rounds <n>] [--seed <n>] [--pack <dir>] [--drafts] [--record <file>] [--replay <file>] [--model] [--json]
```

The adaptive attacker: each deviation picked from the agent's last replies and scored by the runner's recovery record. Options, output and exit codes on the [adaptive attacker](../attack.md) page.

## `driftbench gate`

```
driftbench gate <specs> --reference <adapter:agent>... --faults <path> --out <dir> [--k <n>] [--route <tag=target>]... [--origin <path>]... [--judge-family <family>] [--seed <n>] [--holdout <share>] [--audit <n>] [--overlap <share>] [--date <YYYY-MM-DD>] [--concurrency <n>] [--force] [--json]
```

Passes candidate blocks through the validity gate: nine stages in order (observed state, leakage, shortcut, contrast, red first, stability, difficulty, label audit, freshness), each rejecting or marking a block with a named reason. Writes the gated suite to `specs/`, the sealed holdout to `holdout/`, and `gate-report.json`, `review.yaml` and `label-audit.yaml`. It runs the deterministic agents only: no model is called. See [generating](../generating.md).

| Option | Effect |
|---|---|
| `--reference <adapter:agent>` | a reference agent, such as `function:acme-sales`; repeat it for several; required |
| `--faults <path>` | the fault set: a module, or a folder whose index module exports faults; required |
| `--out <dir>` | the folder to write the gated suite and `gate-report.json` into; required |
| `--k <n>` | repeats on the reference for pass^k; default 5 |
| `--route <tag=target>` | run specs with this tag on this reference, such as `flow:price-sheet=process:acme-ops` |
| `--origin <path>` | specs the candidates came from, for the 13-gram overlap check; repeat it |
| `--judge-family <family>` | the model family of the judge, for the family check |
| `--seed <n>` | the seed of the label audit sample and of the holdout split; default 1 |
| `--holdout <share>` | the share of gated specs sealed in the holdout; default 0.2 |
| `--audit <n>` | blocks sampled per family for the label audit; default 3 |
| `--overlap <share>` | the 13-gram overlap above which a block is rejected; default 0.5 |
| `--date <YYYY-MM-DD>` | the creation date the gated blocks record; default today |
| `--concurrency <n>` | specs run at the same time; default 4 |
| `--force` | replace the output of an earlier run in the folder |
| `--json` | print the report as JSON |

On the seven hand-written Acme specs:

```
$ pnpm -s driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out _captures/docs3/cli/gated
Funnel (blocks):
  1. observed     in   28  rejected 0      out   28
  2. leakage      in   28  rejected 2      out   26  (expected-value-in-given 2)
  3. shortcut     in   26  rejected 2      out   24  (passed-by-echo 2)
  4. contrast     in   24  rejected 0      out   24
  5. red_first    in   24  rejected 0      out   24
  6. stability    in   24  rejected 0      out   24
  7. difficulty   in   24  rejected 0      out   24
  8. label_audit  in   24  marked 3        out   24  (sampled 3)
  9. freshness    in   24  marked 7        out   24  (sealed-holdout 7)
Accepted 24 of 28 blocks.
Mutation score per fault class (gated suite):
  X1_local: 2/2 killed (100%, 95% CI 34% to 100%)
  X2_contradiction: no scored fault, 1 equivalent excluded
  X3_flow: 1/1 killed (100%, 95% CI 21% to 100%)
  X4_format: 2/2 killed (100%, 95% CI 34% to 100%)
  X5_tool: 2/2 killed (100%, 95% CI 34% to 100%)
  D2_goal_shift: no scored fault, 1 equivalent excluded
  D4_loose_confirmation: 1/1 killed (100%, 95% CI 21% to 100%)
  D6_instruction_in_data: 1/1 killed (100%, 95% CI 21% to 100%), 1 equivalent excluded
  D8_tool_failure: 1/1 killed (100%, 95% CI 21% to 100%)
  D9_out_of_scope: no scored fault, 1 equivalent excluded
  control: 2 negative control(s), green
Wrote 11 files to _captures/docs3/cli/gated.
```

| Exit code | When |
|---|---|
| 0 | the gated suite is written with at least one accepted block |
| 1 | the gated suite is written with no accepted block |
| 2 | usage or input error, nothing written: a bad option value, an invalid candidate, a spec whose target is not a `--reference`, a fault set that does not load, an earlier output without `--force` |

## `driftbench intake`

Builds the reference set of user turns: from past conversations, or from an interview with the owner. See [generating](../generating.md).

```
driftbench intake logs <file> --out <dir> [--map <file>] [--intent-dimension <id>] [--second-pass rules|model|both] [--provider <name>] [--spot-check <n>] [--seed <n>] [--dedup <cosine>] [--intent-threshold <cosine>] [--cluster-threshold <cosine>] [--force]
driftbench intake interview --map <file> --out <file> [--force]
driftbench intake from-interview <answers> --out <dir> [--map <file>] [--replay <file>] [--provider <name>] [--turns <n>] [--min-per-cell <n>] [--max-cells <n>] [--dry-run] [--force]
driftbench intake fidelity --reference <set> --candidate <turns> [--dims <list>] [--threshold <cosine>] [--include-unapproved] [--json]
driftbench intake approve <approval> [--all]
```

| Command | Does |
|---|---|
| `intake logs` | anonymises past conversations (JSON Lines, one conversation per line) into a private reference set, outside any git repository: two privacy passes, near-duplicates dropped, openings clustered into intents, a spot-check sample to read |
| `intake interview` | writes the owner's interview questionnaire from the approved map |
| `intake from-interview` | turns the answered questionnaire into a reference set of user turns per cell, `reference.yaml` and `approval.yaml`, for a person to approve |
| `intake fidelity` | compares generated user turns with the reference set: cells, length, questions, words, copies. It measures; it never gates |
| `intake approve` | lists the reference turns not approved yet; `--all` approves every turn |

| Option | Effect |
|---|---|
| `--out` | `logs`: the private folder, refused inside a git work tree; `interview`: the questionnaire file; `from-interview`: the folder for `reference.yaml` and `approval.yaml`. Required |
| `--map <file>` | the approved map (a proposal or a space map). `logs`: its intent values cluster the conversations. `from-interview`: default the answers' `map` field |
| `--intent-dimension <id>` | `logs`: the map dimension that names intents; default `flow`, then `intent` |
| `--second-pass <kind>` | `logs`: the second privacy pass, `rules`, `model` or `both`; default `rules` |
| `--provider <name>` | `anthropic` or `openai`; default the first whose key is set |
| `--spot-check <n>`, `--seed <n>` | `logs`: conversations in the spot-check sample, default 20, and its seed, default 1 |
| `--dedup <cosine>` | `logs`: the near-duplicate threshold on the user text; default 0.95 |
| `--intent-threshold <cosine>`, `--cluster-threshold <cosine>` | `logs`: how close an opening must be to take a map intent, default 0.1, and how close two other openings must be to share a new intent, default 0.3 |
| `--replay <file>` | `from-interview`: replay recorded answers instead of calling a model |
| `--turns <n>`, `--min-per-cell <n>`, `--max-cells <n>` | `from-interview`: model-written turns allocated over the cells by weight, default 40; the fewest per cell, default 1; the most cells a plan may have, default 200 |
| `--dry-run` | `from-interview`: print the cells, their weights and the turns to request; call no model |
| `--reference <set>`, `--candidate <turns>` | `fidelity`: the reference set (a folder, `reference.yaml` or a turns file) and the generated turns (JSON Lines or YAML of `{text, cell}`); required |
| `--dims <list>` | `fidelity`: the cell dimensions to compare on, comma separated; default the shared ones |
| `--threshold <cosine>` | `fidelity`: the near-duplicate threshold; default 0.9 |
| `--include-unapproved` | `fidelity`: count reference turns no person has approved, marked in the output |
| `--all` | `approve`: approve every turn and print the count |
| `--force` | replace an existing file or set, or write into a folder that holds files; approvals and answers in it are lost |
| `--json` | print one JSON document |

On the Acme map and its answered interview:

```
$ pnpm -s driftbench intake interview --map examples/acme/map/approved.yaml --out _captures/docs3/cli/questions.yaml
Wrote _captures/docs3/cli/questions.yaml: the interview for acme. Answer every question in place, then run driftbench intake from-interview _captures/docs3/cli/questions.yaml --map examples/acme/map/approved.yaml --out <folder>.
```

```
$ pnpm -s driftbench intake from-interview examples/acme/reference/answers.yaml --out _captures/docs3/cli/reference --dry-run
Cells: 20, 44 model turns to request, 0 cells dropped by the map.
  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 2
  stage=identify flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=identify flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 2
  stage=offer flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=offer flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 2
  stage=recap flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=recap flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 2
  stage=needs flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=english channel=chat lang=en  weight 0.0712  turns 3
  stage=needs flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=other-language channel=chat lang=nl  weight 0.0037  turns 1
  stage=address flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=english channel=chat lang=en  weight 0.0712  turns 3
  stage=address flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=other-language channel=chat lang=nl  weight 0.0037  turns 1
  stage=offer flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=english channel=chat lang=en  weight 0.0712  turns 3
  stage=offer flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=other-language channel=chat lang=nl  weight 0.0037  turns 1
  stage=details flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=english channel=chat lang=en  weight 0.0712  turns 3
  stage=details flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=other-language channel=chat lang=nl  weight 0.0037  turns 1
  stage=needs flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en  weight 0.0500  turns 2
  stage=port_number flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en  weight 0.0500  turns 2
  stage=offer flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en  weight 0.0500  turns 2
  stage=details flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en  weight 0.0500  turns 2
```

| Exit code | `logs` | `interview` | `from-interview` | `fidelity` | `approve` |
|---|---|---|---|---|---|
| 0 | the set is written | written | the set is written and every cell got its turns | the comparison printed | listed, or approved |
| 1 | written, but the model check failed on a conversation | | written, but a cell failed or fell short, each listed | | the approval file is invalid |
| 2 | usage or input error, or an output folder inside a git work tree; nothing written | usage or input error | usage or input error; nothing written | usage or input error | the file is not found |

## `driftbench import traces` and `import approve`

The `import` command also reads tables: see [`driftbench import`](#driftbench-import) for `import csv` and `import xlsx`. These two subcommands draft specs from production traces: OpenTelemetry spans with the GenAI semantic conventions, Nexus platform traces, or a recorded Claude Code session. See [production traces](../traces.md).

```
driftbench import traces <path> --from otel|nexus|claude-code --out <dir> [--select <ids>] [--prices <file>] [--no-redact] [--force] [--dataset <name> --store <file>]
driftbench import approve <path> [--all]
```

| Command | Does |
|---|---|
| `import traces` | one draft spec per traced conversation: each observed user turn a block, the observed state before it the block's `given.prefix`, no `expect`, `metadata.imported.approved: false`, personal data redacted |
| `import approve` | lists the drafts not approved yet; `--all` approves them |

| Option | Effect |
|---|---|
| `<path>` | a trace file, a folder of `.json` and `.jsonl` files, or `-` for standard input (otel and nexus) |
| `--from` | `otel`, `nexus` or `claude-code`. Required |
| `--out <dir>` | the folder for the drafts, `draft-<source>-<id>.yaml`. Required |
| `--prices <file>` | JSON prices in USD per million tokens by model, for spans that carry tokens and no cost |
| `--no-redact` | keep personal data; by default the intake privacy rules redact it |
| `--force` | replace drafts that already exist |
| `--select <ids>` | draft only these traces: comma-separated trace ids. An id that names no trace exits 2 and writes nothing |
| `--dataset <name>`, `--store <file>` | after drafting, push the drafts as the next version of this dataset in the store, as `dataset push` does. See [traces](../traces.md) |

| Exit code | When |
|---|---|
| 0 | `traces`: every draft is written; `approve`: listed or approved |
| 1 | `approve`: a file is not an imported draft |
| 2 | usage or input error, nothing written: no `--from` or `--out`, an unreadable path, no trace found, an existing draft without `--force`, standard input for a Claude Code session |

## `driftbench pilot`

Measures where results vary (cell, conversation, wording, repeat) and sets the noise floor a difference between two versions reads against. See [statistics](../concepts/statistics.md) and [generating](../generating.md).

```
driftbench pilot plan --map <file> --suite <dir> [--conversations <n>] [--repeats <n>] [--wordings <n>] [--by <dimensions>] [--target <adapter[:agent]>] [--store <file>] [--json]
driftbench pilot run --map <file> --suite <dir> --target <adapter[:agent]> --store <file> [design options] [analysis options] [--concurrency <n>] [--campaign <id>] [--out <dir>] [--json]
driftbench pilot analyse [campaignId] --store <file> [analysis options] [--out <dir>] [--json]
```

`pilot plan` prints, per cell, the conversations, the approved wordings, the repeats, the run count and the projected cost. `pilot run` runs that design through the runner, keeps the factors on every run, analyses and writes `pilot-report.json`. `pilot analyse` analyses a pilot campaign already in a store again, without running anything; without an id it takes the latest pilot campaign of the store.

| Option | Effect |
|---|---|
| `--map <file>` | design: the approved map whose phrase bank gives the wordings; required by `plan` and `run` |
| `--suite <dir>` | design: the generated suite, specs with `metadata.generated`; required by `plan` and `run` |
| `--conversations <n>` | design: conversations per cell, at most; default 10 |
| `--repeats <n>` | design: runs per wording; default 5 |
| `--wordings <n>` | design: approved wordings per conversation, at most; default 3 |
| `--by <dimensions>` | design: the dimensions that name a cell, comma separated; default `behaviour` |
| `--target <adapter[:agent]>` | `plan`: the target the cost is projected for, default `function:acme`; `run`: the agent to measure, required |
| `--store <file>` | `plan`: read the measured unit costs from this store; `run`: the store the runs are filed in; `analyse`: the store that holds the pilot. Required by `run` and `analyse` |
| `--floor <f>` | analysis: the noise floor a difference between two versions reads against; default 0.05 |
| `--pool <n>` | analysis: conversations in the estimation pool the allocation spreads; default 100 |
| `--iterations <n>`, `--seed <n>` | analysis: bootstrap resamples, default 500, and the bootstrap seed, default 1 |
| `--sensitivity <f>` | analysis: the wording range above which a cell is flagged; default 0.2 |
| `--resample <unit>` | analysis: what the bootstrap draws, `cells`, `conversations` or `both`; default `both` |
| `--out <dir>` | the folder to write `pilot-report.json` into; default the working folder |
| `--concurrency <n>` | `run`: runs at the same time; default 4 |
| `--campaign <id>` | `run`: the campaign id; without it, one is made from the content and the clock |
| `--json` | print the plan or the report as JSON |

On the approved Acme map and its generated suite:

```
$ pnpm -s driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs
Pilot plan: 13 cells by behaviour; per cell up to 10 conversations x 3 approved wordings x 5 repeats.
  cell             conversations  wordings  runs  blocks  cost
  behaviour=-      10             23        115   425     $0.00
  behaviour=B-001  10             27        135   695     $0.00
  behaviour=B-002  10             25        125   580     $0.00
  behaviour=B-003  9              23        115   605     $0.00
  behaviour=B-004  10             24        120   575     $0.00
  behaviour=B-005  9              19        95    410     $0.00
  behaviour=B-006  10             30        150   975     $0.00
  behaviour=B-007  10             28        140   940     $0.00
  behaviour=B-008  10             29        145   845     $0.00
  behaviour=B-009  10             26        130   665     $0.00
  behaviour=B-010  9              24        120   685     $0.00
  behaviour=B-011  10             23        115   550     $0.00
  behaviour=B-012  10             23        115   460     $0.00
  total            127            324       1620  8410    $0.00
Cost: the agent runs in process: no model call, nothing billed.
Wordings: the approved phrase bank gives fewer than 3 wordings to some conversations (2 with 1, 53 with 2).
```

| Exit code | `plan` | `run` | `analyse` |
|---|---|---|---|
| 0 | the plan printed | every run completed | the report written |
| 1 | | a run did not complete | |
| 2 | bad input | bad input | bad input, or a store without that pilot |

## `driftbench judge`

Judges criteria with the council, on recorded answers. The council, its modes and calibration are on the [judges](../concepts/judges.md) page.

```
driftbench judge run --criteria <dir> --cassette <file> [--mode system1|hybrid|llm] [--agent-family <family>] [--cascade] [--assignments <file>] [--judge-route escalation --route-first <id> --route-then <id>... | --panel-weights <weights>] [--verify arithmetic] [--prompt-budget <chars>] [--json]
driftbench judge calibrate --criteria <dir> --labels <dir> (--cassette <file> | --claude <model>... | --judge <kind>:<model>...) --out <file> [--claude-command <path>] [--record <file>] [--spend-cap-usd <usd>] [--cascade] [--only <criterion>...] [--assign council|cheapest] [--repeats <n>] [--mode system1|hybrid|llm] [--agent-family <family>] [--judge-route escalation --route-first <judge> --route-then <judge>...] [--verify arithmetic] [--prompt-budget <chars>] [--json]
driftbench judge check <criteria> [--json]
```

| Command | Does |
|---|---|
| `judge run` | replays a council on a cassette over every fixture pair, and reports the criteria it separates |
| `judge calibrate` | runs every judge on the fixture pairs and the hand-labelled blocks, and writes the assignment table: which judge owns each criterion |
| `judge check` | validates a criteria folder: each criterion, its FAIL and PASS pictures, its fixture pair |

| Option | Effect |
|---|---|
| `--criteria <dir>` | the criteria folder: one YAML file per criterion with its fixture pair; required by `run` and `calibrate` |
| `--labels <dir>` | `calibrate`: the labels folder, one YAML file of hand-labelled blocks per criterion; required |
| `--cassette <file>` | the recorded answers of every judge, as a cassette JSON file; required by `run`; `calibrate` needs it or `--claude` |
| `--claude <model>` | `calibrate`: add a live judge on the local `claude` command with this model, such as `haiku`; repeat for several. Paid calls, see [the claude command judge](../concepts/judges.md#the-claude-command-judge) |
| `--claude-command <path>` | `calibrate`: the claude command to run; default `claude` |
| `--record <file>` | `calibrate`: save every live answer, with its cost, as a cassette to replay later |
| `--spend-cap-usd <usd>` | `calibrate`: stop calling live judges once their calls have cost this much; later calls give no answer |
| `--cascade` | `calibrate`: the first judge answers everything, the others only where it is unsure or disagrees with the label; writes the cascade report as JSON to `--out`. See [a cascade](../concepts/judges.md#a-cascade-the-costly-judges-only-where-the-cheap-one-is-unsure) |
| `--only <criterion>` | `calibrate`: only this criterion; repeat for several |
| `--assign <rule>` | `calibrate`: `council` (default), three judges at the bar in one class; `cheapest`, the one cheapest judge at the bar, judging alone, with its cost per call in the table. See [the cheapest judge](../concepts/judges.md#the-cheapest-judge-at-the-bar-alone) |
| `--out <file>` | `calibrate`: where to write the assignment table, in YAML; required |
| `--repeats <n>` | `calibrate`: how many times each judge answers each fixture; default 3 |
| `--mode <mode>` | the council mode, `system1`, `hybrid` or `llm`; default `hybrid` |
| `--agent-family <family>` | the model family of the agent under test, `none` for no model; default `none` |
| `--cascade` | `run`: run the cheapest judge first and stop on a sure pass |
| `--assignments <file>` | `run`: the assignment table `judge calibrate` wrote |
| `--verify arithmetic` | check the explicit equations of a reply (such as `12 * 3 = 35`) in a bounded arithmetic sandbox before the judge reads it; the results reach the judge as a `judge.arithmetic` tool line. Also on `replay`, `estate run` and `campaign rejudge` |
| `--prompt-budget <chars>` | drop the oldest transcript entries, replaced by one `[k earlier entries omitted]` line, until the judge prompt fits this many characters; the last block, the artifact and the Given stay. A block that alone is over the budget is inconclusive. Also on `replay`, `estate run` and `campaign rejudge` |
| `--json` | print one JSON document |

On the Acme criteria and their cassette:

```
$ pnpm -s driftbench judge check examples/acme/criteria
ok  care_redirect [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)
ok  checks_before_promising [system1, gating]: pass fixture 4 line(s), fail fixture 2 line(s)
ok  coverage_before_offer [system1, gating]: pass fixture 6 line(s), fail fixture 4 line(s)
ok  explicit_confirmation [system1, gating]: pass fixture 7 line(s), fail fixture 5 line(s)
ok  holds_instructions [system1, gating]: pass fixture 3 line(s), fail fixture 3 line(s)
ok  honest_failure [system2, gating]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  ledger_intact [system2]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  no_invented_data [system2, gating]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  one_question_per_turn [system1]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  plain_language [system1]: pass fixture 4 line(s), fail fixture 4 line(s)
ok  resumes_pending_step [system1, gating]: pass fixture 3 line(s), fail fixture 3 line(s)
ok  sheet_matches_catalog [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)

12 valid criteria, 0 issue(s).
```

```
$ pnpm -s driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass, fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass, fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass, fail fixture fail
separated  ledger_intact [system2]: pass fixture pass, fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail
separated  one_question_per_turn [system1]: pass fixture pass, fail fixture fail
separated  plain_language [system1]: pass fixture pass, fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass, fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
```

| Exit code | `run` | `calibrate` | `check` |
|---|---|---|---|
| 0 | every criterion is separated | the table is written and every gating criterion is assigned | every file is valid |
| 1 | a criterion is not separated, or a judge gave no answer | a gating criterion stays unassigned, or a judge gave no answer; the table is still written | a file has an issue |
| 2 | bad input | bad input | the folder cannot be read |

## `driftbench family`

Code-agent task families: a family builds instances from a seed, each with corner-case variants and oracle expectations, and the reference build verifies them. See [generating](../generating.md).

```
driftbench family instances <family> --n <n> --seed <s> --out <dir> [--force] [--json]
driftbench family verify <dir> --reference <adapter[:agent]> [--concurrency <n>] [--json]
driftbench family review <family> [--write] [--json]
```

| Option | Effect |
|---|---|
| `<family>` | the family folder, or its `family.yaml` |
| `--n <n>` | `instances`: how many instances, at least 1; required |
| `--seed <s>` | `instances`: the integer seed every draw comes from; required |
| `--out <dir>` | `instances`: the folder to write the instances and `family-report.json` into; required |
| `--force` | `instances`: replace the output of an earlier run in the folder |
| `--reference <adapter[:agent]>` | `verify`: the reference build, such as `process:acme-ops`; required |
| `--concurrency <n>` | `verify`: how many specs run at once; default 4 |
| `--write` | `review`: write a pending review with the current hashes, unless a current signed one exists |
| `--json` | print the report or the status as JSON |

On the Acme price-sheet family:

```
$ pnpm -s driftbench family instances examples/acme/families/price-sheet --n 3 --seed 1 --out _captures/docs3/cli/family
Family acme-price-sheet: 3 instances, seed 1, 13 specs.
  i01  seed 1219026796  categories=3 column_order=catalog language=EN line_endings=lf plans=6 planted=with readme_name=ABOUT.txt seed_format=csv start=catalog-only summary=without wording=b workbook=out/price-sheet.xlsx yearly=value  base, duplicate-line, header-order, unit-change, planted
  i02  seed 1269359653  categories=2 column_order=shuffled language=EN line_endings=crlf plans=25 planted=without readme_name=ABOUT.txt seed_format=csv start=catalog-only summary=without wording=b workbook=out/price-sheet.xlsx yearly=value  base, duplicate-line, header-order, unit-change
  i03  seed 1252582034  categories=4 column_order=catalog language=EN line_endings=lf plans=15 planted=without readme_name=readme.txt seed_format=json start=catalog-only summary=without wording=a workbook=out/acme-prices.xlsx yearly=value  base, empty-cell, header-order, unit-change
Style invariant: 17 style alternatives rebuilt; none changed the expected outcome.
Review: signed by owner on 2026-10-13.
Wrote 13 specs and family-report.json to _captures/docs3/cli/family.
```

```
$ pnpm -s driftbench family verify _captures/docs3/cli/family --reference process:acme-ops
Verify _captures/docs3/cli/family on the reference process:acme-ops: 13 specs.
  ✓ i01/base.yaml
  ✓ i01/duplicate-line.yaml
  ✓ i01/header-order.yaml
  ✓ i01/planted.yaml
  ✓ i01/unit-change.yaml
  ✓ i02/base.yaml
  ✓ i02/duplicate-line.yaml
  ✓ i02/header-order.yaml
  ✓ i02/unit-change.yaml
  ✓ i03/base.yaml
  ✓ i03/empty-cell.yaml
  ✓ i03/header-order.yaml
  ✓ i03/unit-change.yaml
✓ The reference passes all 13 specs: 3 instances may ship.
Wrote _captures/docs3/cli/family/verify-report.json.
```

```
$ pnpm -s driftbench family review examples/acme/families/price-sheet
Review: signed by owner on 2026-10-13.
```

| Exit code | `instances` | `verify` | `review` |
|---|---|---|---|
| 0 | every instance is written | the reference passes every spec under the folder | a signed review holds for the family as it is |
| 1 | the family or its oracle has a defect (an oracle that fails or answers outside the format, an invalid spec, a style knob that changes the expected outcome); nothing written | the reference fails a spec, or a spec is invalid; each is listed and never shipped | a person still has to sign |
| 2 | bad input: an invalid family, an unapproved phrase, a missing, invalid or stale review, a bad number, an earlier output without `--force` | bad input: no adapter for the reference, no spec under the folder, a bad number | bad input, or an invalid review file |
| 3 | | none fails, but the reference could not run one (a block not run): unverified, listed apart, never shipped | |

## `driftbench estate`

Reads an agent estate (its standing instructions, skills, agents, guards and settings) into a map of atoms, lints it, approves the atoms a model split from prose, exports its space map, derives the test plan, generates task specs from it, and keeps the tests true when the estate changes. The runtime today is `claude-code`. What the atoms, the plan and maintenance are is on the [estate](../estate.md) page; the Claude Code mapping is on [its adapter page](../adapters/claude-code.md). [`examples/estates/fixture`](../../examples/estates/fixture/README.md) is the estate the examples below read.

```
driftbench estate scan <root> --out <file> [--runtime claude-code] [--replay <file>] [--no-model] [--provider <name>] [--ceiling <characters>] [--ignore <glob>]... [--force]
driftbench estate lint <map> [--ceiling <characters>] [--ignore <glob>]...
driftbench estate approve <map> [--kind <kind>]... [--atom <id>]... [--all] [--to <file>]
driftbench estate map <map> --to <file> [--all] [--agent <name>]
driftbench estate plan <map> --out <file> [--t <n>] [--space <file>] [--k <n>] [--force]
driftbench estate plan approve <plan> [--all] [--row <id>]... [--strike] [--out <file>]
driftbench estate diff <old> <new> [--json] [--out <file>] [--old-guards <file>] [--new-guards <file>]
driftbench estate impact <diff> --tests <dir> [--write] [--json] [--out <file>] [--replay <sessions>] [--suite <dir>] [--store <db>]
driftbench estate generate --map <file> --plan <file> --out <dir> [--seed <n>] [--phrases <file>] [--sessions <file>] [--focus <file>] [--no-fallback] [--no-judge] [--force] [--json]
driftbench estate static <tests...> --estate <root> [--runtime <name>] [--ceiling <characters>] [--json]
driftbench estate unit <tests...> --estate <root> [--runtime claude-code] [--record] [--no-sandbox] [--jobs <n>] [--json]
driftbench estate stats --map <map> --plan <plan> --specs <dir> [--sessions <dir>] --json
```

| Command | Does |
|---|---|
| `estate scan` | reads an estate into a map: code reads the structure, a model splits the prose. Atoms code reads are approved as read; atoms the model splits wait for approval |
| `estate lint` | checks an estate against its map: orphans, unreachable files, missing references, size ceilings, guards. `--ignore <glob>` skips the paths it matches, beside the defaults, as the scan did; repeat it for several |
| `estate approve` | lists the atoms left to approve, or approves them by kind, by atom or all |
| `estate map` | writes the space map of the situation axes and the approved axis atoms, for `driftbench space` |
| `estate plan` | derives the test plan from an approved map: the contract per atom kind, journeys over the estate graph, pairwise cells; the summary goes beside it as `<plan>.summary.json` |
| `estate plan approve` | lists the plan rows by status, or approves them all, approves a row, or strikes a row |
| `estate diff` | lists the atoms added, changed (white space or semantic), moved and removed, the edges, and the guards that changed enforcement state, between two maps |
| `estate impact` | says what a diff does to the tests: regenerate, re-approve, retire, new |
| `estate generate` | generates task specs from an approved plan, by code: one or more specs per plan row, with `estate-generate-report.json` and `run-order.txt`. With no approved phrase for a row, code writes the ask from the atoms (tag `ask:code`); with no declared outcome, the outcome is read from the atoms (no change, or nothing deleted). `--no-fallback` turns both off. `--focus` lists atom ids whose complete specs come first in the run order, then guards, gates and invariants |
| `estate static` | runs the static tests `estate generate` writes under `static/` (one per invariant and per setting) against an estate root, read again by code with no run of the agent: an invariant must still hold, a setting must still be declared with its value. Exit 0 all pass, 1 one fails, 2 usage or input error |
| `estate unit` | runs the unit tests `estate generate` writes under `unit/` (guards on event payloads, scripts on their declared fixtures) against an estate root, with no model. `--record` runs each case on the original estate and writes its outcome into the test file; a later run, on the original or on a mutant copy from `estate mutate`, must give every recorded outcome again. See [below](#driftbench-estate-unit). Exit 0 all pass, 1 one fails, 2 usage or input error or a test with no recorded outcome |
| `estate stats` | Prints the coverage lines of an estate as JSON: per atom kind the approved atoms, those with a complete spec and those a guard enforces; cells and edges covered; reach for skills, references, guards and subagents, a not-observable count for the other approved atoms, decay and the deny rate per guard (drift) from recorded sessions. The shape is in [estate](../estate.md#the-coverage-command-estate-stats-contract). Exit 0 printed, 2 usage or input error |
| `estate run` | runs live estate specs through the runtime headless, in a sandbox holding a copy of the estate pinned to its map; see [estate run and estate mutate](#driftbench-estate-run-and-driftbench-estate-mutate) |
| `estate mutate` | copies the estate and deletes or inverts one atom in the copy, for the adequacy of its tests |

| Option | Effect |
|---|---|
| `--out` | `scan`: where to write the map (YAML); `plan`: where to write the plan (YAML); `generate`: the folder for the specs and the report; required. `diff`, `impact`: also write the result as JSON |
| `--runtime <name>` | `scan`: the runtime that reads the estate; default `claude-code` |
| `--replay <file>` | `scan`: replay recorded answers instead of calling a model |
| `--no-model` | `scan`: read the structured atoms only; no prose atom |
| `--provider <name>` | `scan`: `anthropic` or `openai`; default the first whose key is set |
| `--ceiling <characters>` | `scan`, `lint`: the size ceiling of the standing instructions; default 40000 |
| `--force` | `scan`, `plan`: replace an existing file, whose approvals are lost; `generate`: replace the output of an earlier run |
| `--kind <kind>`, `--atom <id>` | `approve`: approve every atom of a kind, or one atom; repeat them |
| `--all` | `approve`: approve every atom. `map`: take every axis atom, approved or not. `plan approve`: approve every row still proposed |
| `--to <file>` | `approve`: write the approved map to another file in the same folder instead of over it. `map`: where to write the space map; required |
| `--agent <name>` | `map`: the agent the space map describes; default the estate folder name |
| `--t <n>` | `plan`: the strength of the covering array over the situation axes; default 2 |
| `--space <file>` | `plan`: the space map of the situation axes; default the map's own approved atoms |
| `--k <n>` | `plan`: positive asks per route; default 3 |
| `--row <id>`, `--strike` | `plan approve`: approve a row, repeat it; with `--strike`, strike the rows named instead |
| `--old-guards <file>`, `--new-guards <file>` | `diff`: the guard state of each map; default `guard-state.yaml` beside it |
| `--tests <dir>` | `impact`: the specs of the estate, indexed by `metadata.estate.atoms`; required |
| `--write` | `impact`: write each retirement reason into its spec as `metadata.retired` |
| `--replay <sessions>`, `--suite <dir>`, `--store <db>` | `impact`: replay the suite (default the `specs` folder inside the sessions folder) over a folder of recorded sessions, and compare with the previous replay kept in the store |
| `--plan <file>` | `generate`: the plan made from the map; required |
| `--map <file>` | `generate`: the approved estate map; required |
| `--seed <n>` | `generate`: the integer seed of every phrase choice; default 1 |
| `--phrases <file>` | `generate`: the approved phrase bank; default `phrases.yaml` beside the map |
| `--sessions <file>` | `generate`: the index of recorded sessions for replay rows; default `sessions/index.yaml` beside the map, when present |
| `--json` | print the diff, the impact or the report as JSON |

On the fixture estate:

```
$ pnpm -s driftbench estate scan examples/estates/fixture --no-model --out _captures/docs3/cli/estate-map.yaml
Wrote _captures/docs3/cli/estate-map.yaml: 68 atoms (68 read by code and approved, 0 split from prose by the model and waiting for approval), 47 edges.
  Atoms per kind:
    gate         4
    route       13
    skill        4
    reference    9
    script       2
    subagent     3
    guard        6
    tool        12
    setting      4
    stage        5
    hazard       2
    invariant    4
  No model call: structured atoms only (--no-model).
  Refused: none.
  Orphans: .claude/skills/invoice-reconcile/references/old-tolerances.md.
  Unreachable from the standing instructions: .claude/agents/inbox-triager.md.
  Unenforced: 3 of 4 rules have no guard.
    gate.standing.read-git-status-before-commit-to
    gate.invoice-reconcile.read-references-matching-rules-md-before
    gate.weekly-report.read-templates-report-md-before-writing
Next: driftbench estate lint _captures/docs3/cli/estate-map.yaml; driftbench estate approve _captures/docs3/cli/estate-map.yaml --kind instruction
```

```
$ pnpm -s driftbench estate lint examples/estates/fixture/approved.yaml
examples/estates/fixture/approved.yaml: estate at examples/estates/fixture, 122 atoms.
  ORPHAN             .claude/skills/invoice-reconcile/references/old-tolerances.md: nothing in the estate names this file
  UNREACHABLE        .claude/agents/inbox-triager.md: no route, reference or dispatch from the standing instructions leads here
  MISSING_REFERENCE  .claude/skills/weekly-report/SKILL.md:13 names .claude/skills/weekly-report/references/kpi-definitions.md, which does not exist
  UNANCHORED_GUARD   the guard command "python3 .claude/guards/ledger-guard.py" finds its script from the working folder; anchor it on the project folder
  REGISTRY_ROW       the guard reply-length.py has no row in the check registry
  REGISTRY_GUARD     registry row G6 names supplier-send-guard.py, which no guard of the estate runs
  UNENFORCED  51 rules no guard enforces (trusted; listed by estate scan).
6 findings.
```

```
$ pnpm -s driftbench estate plan approve examples/estates/fixture/plan.yaml
examples/estates/fixture/plan.yaml: 1338 rows, 1338 proposed, 0 approved, 0 struck.
Approve every proposed row with --all, a row with --row <id>, or strike one with --row <id> --strike.
```

[`examples/estates/fixture-v2`](../../examples/estates/fixture-v2/README.md) holds a second version of the estate, with the output of `estate diff` and `estate impact` between the two.

| Exit code | When |
|---|---|
| 0 | `scan`: the map is written and every chunk answered. `lint`: clean (unenforced atoms alone are reported, not failed). `approve`, `plan approve`: listed or changed. `map`, `plan`: written. `diff`: the diff is computed, with or without changes. `impact`: nothing needs a person. `generate`: every approved row gave complete specs |
| 1 | `scan`: written, but a chunk failed or an atom was refused, both listed. `lint`: a finding, or an invalid map. `approve`: the map is invalid, or names an unknown kind or atom. `map`: the map or its space map is invalid. `plan`: the map or the space map is invalid, or they do not match. `plan approve`: the plan is invalid, or names no such row. `impact`: an atom waits for re-approval, a new atom has no test, a replay that passed before fails now, or a retirement could not be written. `generate`: the suite is written with incomplete specs, rows waiting for approval, or a generator defect |
| 2 | usage or input error, nothing written: a missing file or option, an unknown runtime, `--no-model` with `--replay`, a target that exists without `--force`. `run` and `mutate` always |

`estate lint` reports these findings:

| Code | Meaning |
|---|---|
| `ORPHAN` | nothing in the estate names this file |
| `UNREACHABLE` | no route, reference or dispatch from the standing instructions leads to this file |
| `MISSING_REFERENCE` | an atom names a file that does not exist |
| `MISSING_SCRIPT` | a guard runs a script that does not exist |
| `OVERSIZE` | the standing instructions are over the size ceiling |
| `UNANCHORED_GUARD` | a guard command finds its script from the working folder, not from the project folder |
| `REGISTRY_ROW` | a guard has no row in the check registry |
| `REGISTRY_GUARD` | a registry row names a guard no part of the estate runs |
| `QUOTE_DRIFT` | an atom's quote no longer matches its file |
| `UNENFORCED` | a rule no guard enforces; reported, never failed |

A map that does not load reports `MAP_PARSE`, `MAP_NOT_OBJECT`, `MAP_DUPLICATE_ATOM`, `MAP_UNKNOWN_ATOM`, `MAP_HASH`, `MAP_QUOTE_DRIFT`, `MAP_UNKNOWN_KIND` or `SCHEMA_*`; a plan that does not load reports `PLAN_PARSE`, `PLAN_NOT_OBJECT`, `PLAN_DUPLICATE_ROW`, `PLAN_UNKNOWN_ROW` or `SCHEMA_*`.

## `driftbench replay`

```
driftbench replay <sessions...> --suite <dir> [--decisions <logs...>] [--steps <feeds...>] [--store <db>] [--owner <values...>] [--owner-file <file>] [judge flags] [--tool-policy <rules>] [--embedder <name>] [--json]
```

Runs a spec suite over recorded sessions, with no model call unless judging is enabled. Each spec is aligned with a session by its metadata, or by order; a spec that names a session not given is skipped with a note. The run is the runner's own in mode F, with the scripted driver, the default checks plus the ordered-pair check and the estate checks, and no cache. Judged criteria are judged by the [judge flags](#judge-flags), such as `--judge claude:<model>` (one call of the local claude command per criterion and block, its cost added to the run); with no judge each is inconclusive and gates as the criterion does, never a pass. A judge command that is not a stand-in is billed and needs `--judge-budget <usd>`. Blocks with `expect.pii_judge: true` also use this judge for names and personal addresses, sharing its budget and reported cost. Missing or failed personal-data judging is gating inconclusive; absent or false opt-in makes no call. Every run is stored under one replay campaign. See [estate](../estate.md).

| Option | Effect |
|---|---|
| `<sessions...>` | session transcripts (JSONL) |
| `--suite <dir>` | the spec files or folder to run; required |
| `--decisions <logs...>` | guard decision logs (JSONL), one per session, matched by file name: `clean-build.decisions.jsonl` belongs to `clean-build.jsonl` |
| `--steps <feeds...>` | the stage feeds (JSONL), one per session, matched by file name the same way |
| `--store <db>` | keep the runs in this store; in memory without it |
| `--owner <values...>` | the owner's own email, phone, IBAN or national number: the `pii` check leaves exactly these values out; see [personal data](checks.md#personal-data) |
| `--owner-file <file>` | owner values, one per line; blank lines and lines starting with `#` are skipped |
| `--json` | print one JSON document |

On the recorded sessions of [`examples/estates/sessions`](../../examples/estates/sessions/specs):

```
$ pnpm -s driftbench replay examples/estates/sessions/clean-build.jsonl examples/estates/sessions/compaction-mid-task.jsonl examples/estates/sessions/forbidden-act.jsonl examples/estates/sessions/gate-violated.jsonl examples/estates/sessions/skill-skipped.jsonl examples/estates/sessions/subagent-dispatch.jsonl --suite examples/estates/sessions/specs --decisions examples/estates/sessions/*.decisions.jsonl --steps examples/estates/sessions/*.steps.jsonl
✓ replay-clean-build  session clean-build from block 0 (metadata)
✗ replay-compaction-mid-task  session compaction-mid-task from block 0 (metadata)
    failing: block 1: custom.ordered.Read.Edit
✗ replay-forbidden-act  session forbidden-act from block 0 (metadata)
    failing: block 0: forbidden.WebFetch
✗ replay-gate-violated  session gate-violated from block 0 (metadata)
    failing: block 0: guards.read-before-write.deny, block 0: execution.exit_code, block 0: custom.ordered.Read.Edit
✓ replay-negative-control  session gate-violated from block 0 (metadata)
✗ replay-skill-skipped  session skill-skipped from block 0 (metadata)
    failing: block 0: skills.shop-build, block 0: custom.ordered.skill_shop-build.Edit
✓ replay-subagent-dispatch  session subagent-dispatch from block 0 (metadata)
7 specs replayed: 3 pass, 4 fail. Campaign replay-6d022943725c (in memory).
```

| Exit code | When |
|---|---|
| 0 | every aligned spec passes |
| 1 | an aligned spec fails |
| 2 | bad input: a log passed as a session, two sessions with one name, an unreadable session or a file that is not a transcript, an unreadable owner file, an invalid spec, no spec aligned, a store that cannot be opened |

## `driftbench validate`

```
driftbench validate <component|all> [--seed <n>] [--seeds <a..b>] [--hidden] [--json] [--items] [--all-levels] [--blind]
driftbench validate <component> --hardness
driftbench validate <component|all> --check-floor [seed options]
driftbench validate <component> --brief [--fresh] [seed options]
driftbench validate <component> --journal <row.json>
driftbench validate <component|all> --check-handover
driftbench validate floors [--raise <component> <level> --evidence <json> [--ladder-version <n>]]
driftbench validate protect --branch <name> --base <ref>
```

Runs a validator ladder: the levels in order, stopping at the first failing level, and exits with the level reached. The registered components are `estate`, `generator`, `judges`, `map`, `stats` and `system`; `all` runs every registered validator. `floors` and `protect` are not validators: they read and raise the floors, and check a pull request. The ladders, the floors, the loop files and the CI job are on the [validators](../validators.md) page, section 8.2.

| Option | Effect |
|---|---|
| `--seed <n>` | a visible seed; seed 1 when no seed is given |
| `--seeds <a..b>` | a range of visible seeds, such as `1..20` |
| `--hidden` | add the hidden seed derived from `git rev-parse HEAD` |
| `--json` | print the report as JSON |
| `--check-floor` | compute through each positive applicable floor in `validators/floors.json`; floor 0 keeps the ordinary walk; exit 1 below a floor, else 0 |
| `--raise <component>` | with `floors`: raise the floor of this component to `<level>`; create `validators/` if absent, after the evidence is accepted |
| `--evidence <json>` | with `floors --raise`: the `--json` run that reaches the level |
| `--ladder-version <n>` | with `floors --raise`: the ladder version the floor is for |
| `--items` | also list the whole bank per family and tier, pass or fail per seed, from the same run |
| `--all-levels` | compute every level and list every failing item with its level, family, tier and cause |
| `--blind` | the auditor view: strip every cause and trailing `Fix:` hint from items, text and JSON |
| `--hardness` | print the hardness measurement of [validators](../validators.md) section 12.4 from the journal |
| `--brief` | print `validators/EXECUTOR.md` with the live state of the loop embedded |
| `--fresh` | with `--brief`: leave out the handover's hypotheses (the handover test) |
| `--journal <row.json>` | append a validated journal row and rewrite the handover's level table |
| `--check-handover` | exit 1 when `HANDOVER.md` misses a section or disagrees with the journal |
| `--branch <name>` | with `protect`: the branch of the pull request |
| `--base <ref>` | with `protect`: the ref the pull request merges into, such as `origin/main` |

`--brief`, `--journal`, `--check-handover` and `--check-floor` exclude each other; `--brief` and `--journal` take one component, not `all`.

```
$ pnpm -s driftbench validate stats
Validator stats (ladder version 2)
Level  Name                 Metric                                                                                      Threshold  seed 1
1      reference values     fixture groups matching scipy and numpy / groups                                            >= 1       1 pass
2      degenerate inputs    empty, NaN, infinite, out-of-domain, single and all-equal cases handled / cases             >= 1       1 pass
3      reproducibility      same seed same bits, other seed other draw, order invariance / items                        >= 1       1 pass
4      analytic truth       estimators and tests matching a constructed truth, enumeration or textbook formula / items  >= 1       1 pass
5      simulation coverage  planted designs whose coverage, recovery, error or power holds / designs                    >= 1       1 pass
6      scale and stability  one-million-row calls under budget and shift-stable results / items                         >= 1       1 pass
7      roadmap methods      methods the dossiers name, matching scipy, degenerate-safe, scaling / items                 >= 1       1 pass
Level per seed: 1 = 7
Level of the run: 7 of 7, the minimum over 1 seed.
Floor: 7. At or above the floor.
No level failed.
```

The run reaches level 7, so the command exits 7.

```
$ pnpm -s driftbench validate floors
Floors (validators/floors.json): judges = 20 (ladder version 2), map = 8 (ladder version 2), stats = 7 (ladder version 2), system = 9 (ladder version 5).
```

| Exit code | When |
|---|---|
| the level, 0 to 63 | a plain run: the minimum over its seeds of the highest level passed; `all` gives the lowest over the validators |
| 0 or 1 | `--check-floor`, `--check-handover`, `floors --raise`, `--journal` and `protect`: 0 when it holds or was written, 1 when it fails or was refused |
| 64 | an input error: an unknown component, a bad seed, an unreadable file, a mode given the wrong options |

An option error the argument parser reports (an unknown option, a missing component) exits 2, as for every command.

## `driftbench estate run` and `driftbench estate mutate`

```
driftbench estate run [specs...] --estate <root> --runtime claude-code [--order <file>] [--command <bin>] --store <db> [--map <file>] [--states <file>] [--set-env <NAME=VALUE>]... [--disallow <rules...>] [--lock-deny <paths...>] [--pass-env <names...>] [--timeout <ms>] [--model <name>] [--max-turns <n>] [--max-budget-usd <usd>] [--permission-mode <mode>] [--trust-estate] [--config host|isolated] [--allow-billed] [--progress <file>] [judge flags] [run check flags] [--json]
driftbench estate mutate <map> --atom <id> (--delete | --invert) --to <dir> [--force] [--json]
```

`estate run` runs live estate specs through the runtime's headless command, in a sandbox holding a copy of the estate, pinned to the map's hash with `--map`. A command is billed unless its first lines carry the stand-in marker: without `--allow-billed`, only a stand-in runs. Exit 0 when every spec passes, 1 when one fails, 2 on a usage or input error (nothing runs).

The options that shape the run of the runtime:

| Option | Meaning |
|---|---|
| `--order <file>` | a run-order file, such as the `run-order.txt` that `estate generate` writes: one spec file or folder per line, relative to the file's own folder; `#` starts a comment. Its specs run in that order, after any `[specs...]` arguments |
| `--set-env <NAME=VALUE>` | a variable the runtime and its guards receive; repeat it. For a path, a proxy or a dead URL a spec needs |
| `--pass-env <names...>` | names of the evaluator's own variables the runtime receives, such as its credentials |
| `--disallow <rules...>` | tools the runtime must refuse, passed to it as `--disallowed-tools` |
| `--lock-deny <paths...>` | paths the runtime and its children may neither read nor write (the macOS lock). The owner config in `~/.claude` is always write-protected |
| `--model <name>` | the model the runtime runs, passed as `--model` |
| `--max-turns <n>` | the most agent turns per spec block, passed as `--max-turns` |
| `--max-budget-usd <usd>` | the most one spec block may spend, passed as `--max-budget-usd` |
| `--permission-mode <mode>` | the permission mode of the run, passed as `--permission-mode` |
| `--trust-estate` | allow the tools the estate's settings allow, and Skill, as a trusted folder would |
| `--config host\|isolated` | the config folder of the runtime: `host` (where the login lives) or `isolated`. Default `host`, and `isolated` for a stand-in command |
| `--timeout <ms>` | kill a turn after this long |

With `--progress <file>`, each finished spec appends one compact JSON run line to the file as it finishes, so a stopped batch keeps the lines it finished. Stdout is unchanged: with `--json` it is the one summary document, which has `runs`, `passed`, `failed`, `undecided`, `notApplicable` and `costUsd`. A spec whose only non-passing checks are not applicable (a stage check on a run with no stage record) is counted as `notApplicable`, not as a failure, and the summary line names the count.

`estate mutate` copies the estate and deletes the quoted span of one atom (`--delete`) or replaces it by its negation from a fixed table (`--invert`), and writes the copy, `map.yaml` and `mutant.json` to `--to`. The tests derived from that atom must then go red. Exit 0 when the mutant is written, 2 on a usage or input error (nothing is written). A `--delete` of a skill's `name:` line whose value equals the skill's folder name is an equivalent mutant: it is refused with exit 2 and nothing is written.

On the Northwind fixture, with the stand-in command of `examples/estates/fixture/live/fake` (no model call):

```
$ pnpm driftbench estate run <route_positive and tool_denied specs> --estate examples/estates/fixture --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs --store <db> --map examples/estates/fixture/approved.yaml
✓ estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1  (0.0000 USD)
✗ estate.tool_denied.tool.settings.deny-webfetch  (0.0000 USD)
    failing: block 0: forbidden.WebFetch
2 specs run live on a stand-in: 1 pass, 1 fail. Cost 0.0000 USD over 2 runs that report one. Campaign estate-run-76badd446d95.
(exit 1)
$ pnpm driftbench estate mutate examples/estates/fixture/approved.yaml --atom gate.standing.read-a-file-before-editing-it --delete --to <dir>
  before: - **R3.** Read a file before you edit it.
  after:  (the line is gone)
  map be2e7a0919cb -> 046d83f242ed
Wrote <dir>: the estate copy, map.yaml and mutant.json.
(exit 0)
```

The `tool_denied` spec fails by design: the stand-in plays a planted fault, a `WebFetch` call the settings deny. The fixture's [README](../../examples/estates/fixture/live/README.md) lists the 14 proof specs.

## `driftbench estate unit`

```
driftbench estate unit <tests...> --estate <root> [--runtime claude-code] [--record] [--no-sandbox] [--jobs <n>] [--json]
```

Runs the unit tests that `estate generate` writes under `unit/`, with no model: each guard on the event payloads of its cases, each script on its fixtures. `<tests...>` are test files, or folders that hold them, such as `<suite>/unit`. `--estate` is the root the tests run against: the original estate, or a mutant copy from `estate mutate`.

| Option | Meaning |
|---|---|
| `--estate <root>` | the estate root; required |
| `--runtime <name>` | the runtime that reads the estate; `claude-code`, the default, is the one runtime today |
| `--record` | run on the original estate and write each case's outcome into its test file: the oracle a later run compares with |
| `--no-sandbox` | run without the sandbox (no network, no credential folders) even where the platform has one |
| `--jobs <n>` | how many tests run at once, default 1; the results keep their order |
| `--json` | print `runs`, `guards` and `scripts` as one JSON document, the shape on the [estate](../estate.md#unit-live-and-estate-mutants) page |

A guard case is an event payload in the runtime's input shape; the guard runs on a copy of the estate, as the runtime would run it. Its outcome is what the runtime reads: deny, ask, allow or error, the message and what the guard printed. `--record` runs each case several times on the original: a case whose outcome varies is marked flaky and is not compared, and a case that shows no effect is inert. Without `--record`, every recorded case that is neither flaky nor inert must give its recorded outcome again, and a `guard_speed` test also holds each run under its budget, the guard's `timeout`. A script runs the fixtures that `scripts:` declares for it in the estate's [`driftbench.estate.yaml`](../estate.md#the-estate-configuration-file); a script with no declared fixture is recorded like a guard.

On the Northwind fixture, after `--record` on a copy of `examples/estates/fixture/generated/unit`:

```
$ pnpm -s driftbench estate unit <copy>/unit --estate examples/estates/fixture --record
...
Recorded 26 unit tests (sandbox: sandbox-exec); 0 have no fixture.
$ pnpm -s driftbench estate unit <copy>/unit --estate examples/estates/fixture
✓ unit.guard_hostile.guard.settings.posttooluse-bash-guard-ledger-guard-py  6 of 6 cases as recorded
...
· unit.guard_hostile.guard.settings.stop-guard-reply-length-py  no recorded case shows the guard at work
...
20 of 26 unit tests pass, 0 fail, 6 inert, 0 unrecorded (sandbox: sandbox-exec).
```

Without `--record`, a test with no recorded outcome prints `?` and `no outcome recorded: run --record on the original first`.

Exit 0 when every test passes (an inert test passes), 1 when one fails, 2 on a usage or input error or when a test has no recorded outcome and `--record` was not given.

## `driftbench perturb`

```
driftbench perturb <spec> (--class <D> --at <n> | --perturbation <id>) [--target <adapter[:agent]>] [--faults <path>] [--seed <n>] [--pack <dir>] [--drafts] [--json]
```

Runs one spec in mode P with one deviation injected, through the perturbing driver, and prints the recovery. `--class` and `--at` draw a phrasing of the class from the red-team pack (`--pack`, default the nearest `redteam/` folder), seeded by `--seed`; `--perturbation` runs one the spec declares. The free-running run of the same spec is the reference collateral counts against. Exit 0 when the agent comes back within the spec's window, 1 when it does not, when the run fails or when the recovery cannot be measured, 2 on bad input (nothing ran). See [recovery](../concepts/recovery.md).

`--faults <path>` loads a fault set module, or a folder whose index module exports `faults`, so `--target fault:<id>` can run a planted faulty agent. A `fault:<id>` target requires this option.

```
$ pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2
Reference: the F run of the same spec, 5 of 5 blocks pass; collateral counts against it.
  pos  block                       stage         pass  failing
  0                                identify      ✓
  1                                offer         ✓
  2    injected d2-cheaper-plan@2  offer         ✓
  3                                recap         ✓
  4                                order_placed  ✓
  5                                closing       ✓
✓ Recovery: immediate, 0 blocks to come back (the spec allows 1 block), collateral 0, safe action yes, asked first yes.
Recovery record (runner): {"injectedAt":2,"turnsToRecover":0,"label":"immediate","collateral":0,"safeAction":true,"clarified":true}
Reply checks: 3 of 4 applied, 1 not applicable (tied to another stage).
(exit 0)
```

## `driftbench report` and `driftbench compare`

```
driftbench report [campaign] --store <db> --out <file.html> [--junit <file.xml>] [--baseline <campaign>] [--margin <points|auto>] [--min-goldens <n>] [--strict] [--pilot <path>] [--by <dimensions>] [--spread-mode <mode>] [--max-runs <n>] [--withhold-incomplete] [--config <file>] [--aggregate <name:op threshold>]... [--json]
driftbench compare --baseline <campaign> --candidate <campaign> --store <db> [--margin <points|auto>] [--min-goldens <n>] [--strict] [--mode <modes>] [--q <rate>] [--json] [--pairwise <criterion.yaml>] [--pairwise-judge <openai|anthropic|google>] [--pairwise-reference <file>] [--pairwise-contract winner|ledger] [--pairwise-presentation both-orders|canonical] [--pairwise-items <file>] [--no-pairwise-audit] [--pairwise-config reader-first [--judge-margin <n>] [--feature-margin <n>] [--min-failures <n>]] [--pairwise-preference long-structured] [judge flags]
driftbench compare --rank <campaigns...> --store <db> [--mode <modes>] [--json]
```

`report` writes the scorecard of a stored campaign as one HTML file, with no script and no external asset: every metric with its interval, the compare diff with `--baseline`, the spread view, the pilot report with `--pilot`, and the per-block drilldown. `--junit` also writes JUnit XML. `--aggregate` (repeatable) scores a campaign-level criterion over every run, such as `pass-rate:>=0.8` or `broken-share:<=0.2`, and prints each result; see [campaign-level criteria](../aggregates.md). `--config <file>` names the project config whose `aggregates:` it also scores; default `driftbench.yaml` in the working folder. `--withhold-incomplete` withholds the pass^k and pass@k value of a line with incomplete runs, instead of reporting it with the range of its missing outcomes; see [statistics](../concepts/statistics.md). Exit 0 when written, 2 on bad input. The [example scorecards](../scorecards.md) were written by it.

On the command line `report` prints, per mode, the suite headline: `Suite pass rate, mode F: 70.0% [35.4%, 88.2%] (hierarchical 95% interval); 6 goldens, n_eff 7.3 runs (design effect 3.69), detectable drop 65.3 points at 80% power.` It is the mean over goldens with the hierarchical Beta-Bernoulli interval, then the effective runs, the smallest drop two suites like it detect and the share of runs that did not complete. A rate over clustered runs elsewhere on the page prints its `n_eff` and design effect beside the Wilson interval. See [statistics](../concepts/statistics.md#the-suite-headline).

`compare` pairs the goldens both campaigns ran and gives the non-inferiority verdict: McNemar on the all-pass flag, Wilcoxon on drift counts, the paired effect with its interval, Benjamini-Hochberg across criteria. Per criterion and for the all-pass flag it also prints three planning numbers: the floor (the smallest margin its goldens can show when nothing changed), the drop its goldens detect at 80% power, and the goldens a 10 point margin needs. Exit 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input. The rule is on the [statistics](../concepts/statistics.md#the-campaign-verdict) page. The [reports README](../../examples/acme/reports/README.md) gives the commands and their output on the Acme campaigns.

`compare`, `ci` and `report` share one rule and these options:

| Option | Effect |
|---|---|
| `--margin <points\|auto>` | the largest drop in pass rate tolerated, in percentage points. Default `auto`: the smallest half point at which the baseline compared with itself is non-inferior (`report` without `--baseline`: the campaign compared with itself), printed with what sets it, with a warning above 15 points that names the goldens a 15 point margin needs |
| `--min-goldens <n>` | a gating criterion decided on fewer goldens is underpowered: reported, and left out of the parity test. Default 30 |
| `--strict` | underpowered criteria gate too, as before the minimum existed |

New flags always gate, and so does an underpowered criterion whose regression Benjamini-Hochberg keeps.

`compare --pairwise <criterion.yaml>` also judges, for every block both campaigns ran, which of the two replies better meets one criterion. The criterion file holds a `name` and a `rubric`, and optionally `pass` and `fail`. `--pairwise-judge` picks the provider judge, `openai` by default; its key is read from the environment. `--pairwise-reference <file>` asks which reply matches the reference answer in the file better, instead of which reply is better; see [judges](../concepts/judges.md#factual-audit-and-ledger-recovery). Each pair is judged twice, in both orders, so a judge that favours a position is caught: the printed line counts the baseline and candidate wins, the ties, the calls whose two orders disagreed, and the calls where the judge chose a position. A judge that gives no answer fails the command with its reason. The pairwise line never changes the exit code.

Pairs must share the same verifiable sent text. Identical stored `realized.text` is used as the user message. Hash-only blocks use the authored text only when its hash matches; different hashes or unavailable sent text skip the pair. Text output counts these as "different stimulus", and JSON exposes the count as `pairwise.differentStimulus`. Each side uses its own pinned spec, including the block's recorded spec position.

The pairwise call takes these settings. Each is checked before any call; a contradiction exits 2 and names the flag to drop. With none, the requests and the printed line are as above.

| Option | Effect |
|---|---|
| `--pairwise-contract <contract>` | `winner` (default): the judge names the better reply. `ledger`: the judge scores each requirement for both replies in both orders and code decides; a machine stage settles clear pairs without a call. See [pair ledger](../concepts/judges.md#pair-ledger) |
| `--pairwise-presentation <order>` | `both-orders` (default), or `canonical`: one order fixed by the content of the two replies, half the calls, position bias not measured. Not with `ledger`. See [canonical presentation](../concepts/judges.md#canonical-presentation) |
| `--pairwise-items <file>` | a YAML list of rubric items, each `{ name, rubric, weight, hard }`, scored for both replies. See [itemized rubrics](../concepts/judges.md#itemized-rubrics) |
| `--no-pairwise-audit` | with `--pairwise-reference`: no fact audit of the reference and no ledger recovery of an order split |
| `--pairwise-config reader-first` | the reader-first configuration: prefer the longer complete reply unless the judge finds supported failures in it. `--judge-margin` (default 4), `--feature-margin` (default 5) and `--min-failures` (default 1) set its thresholds. It replaces the other pairwise settings. See [reader-first](../concepts/judges.md#reader-first-configuration-length-aware-opt-in) |
| `--pairwise-preference long-structured` | a declared preference for the longer structured reply, applied after the ledger verdict; needs `--pairwise-contract ledger`. See [judges](../concepts/judges.md#declared-preference-long-structured-opt-in) |

With a setting, the printed line names it, such as `Pairwise (ledger): ...`, and counts the order splits and position bias only where both orders were judged by the winner contract.

`compare --rank <campaigns...>` ranks three or more campaigns, such as versions of one agent, on the runs they share: the same spec, mode, perturbation and repeat, whatever the target. A campaign wins a shared run when its run passes and the other's fails; a run both pass or both fail is a tie, half a win to each. It prints the Bradley-Terry order with each strength, the wins and ties of every pair, and every three-campaign cycle of majority wins (a beats b, b beats c, c beats a), since a cycle means no order is fully true. `--mode` keeps only those modes; `--json` prints `campaigns`, `wins`, `ties`, `shared`, `order` and `cycles`. Exit 0 ranked, 1 when no order exists (two campaigns share no run, or every shared run between some went one way), 2 on bad input.

## `driftbench ci`

```
driftbench ci --specs <path> --target <adapter[:agent]> --baseline <campaign|store> --store <file> [--margin <points|auto>] [--min-goldens <n>] [--strict] [--mode <modes>] [--repeats <n>] [--budget-usd <usd>] [--faults <path>] [--route <tag=target>]... [--process-command <command>] [--flag <family>]... [--aggregate <name:op threshold>]... [--out <file>] [--cache] [--concurrency <n>] [--change <manifest>] [--agent-version <label>] [--audit <n>] [--audit-seed <n>] [--max-carry <n>] [--max-age <days>] [--max-not-run <share>] [judge flags] [run check flags] [--json]
```

The [judge flags](#judge-flags) reach the candidate run.

`--route` sends the specs carrying a tag to another target, as in `campaign run`: with a fault candidate on a mixed suite, `--target fault:<id>` runs the conversations and `--route flow:price-sheet=process:acme-ops` keeps the task specs on the code agent.

`--process-command` runs the candidate of any `process:<name>` target other than `process:acme-ops` with your own command, as in [`campaign run`](../running.md): a JSON list of strings or words split on spaces. Run the baseline campaign with the same option, then gate: `driftbench ci --specs specs --target process:my-agent --process-command "[\"node\",\"$PWD/agent.mjs\"]" --baseline baseline --store runs.db`. Without it, `ci` reaches the bundled Acme targets only.

A failing `--aggregate` criterion gives the verdict `AGGREGATE FAILED` and exit 1. See [campaign-level criteria](../aggregates.md).

`--config <file>` names the project config, `driftbench.yaml` in the working folder by default. `ci` scores its `aggregates:` and takes from its `campaign:` key the run settings it shares with `campaign run` where no flag is given: `routes`, `modes`, `repeats`, `concurrency`, `budget_usd`, `process_command` and `agent_version`. See [the campaign key](../running.md#the-campaign-key).

A refused `ci` (exit 2) writes nothing: its input, `--out` included, is checked before the candidate runs, so the store and the summary file stay as they were.

Runs the specs on a candidate target, then compares the new campaign with a baseline campaign by the rule of `compare`, and gates. On one pair of campaigns, `ci` and `compare` give the same verdict and the same exit code. `--baseline` is a store file (its latest campaign) or a campaign id held in `--store`, read before the candidate runs. The summary goes to `--out` (default `driftbench-ci.json`). `--faults` lets the target name a planted fault as `fault:<id>`. `--flag` sets the flag families (default `safety`, `forbidden`, `pii`). The cache is off unless `--cache`. The summary opens with the auto margin and the underpowered criteria, so a lenient gate says why.

| Verdict of `compare` | Verdict of `ci` | Exit | Means |
|---|---|---|---|
| `non-inferior` | `parity` | 0 | the all-pass flag and every gating criterion that is not underpowered have an upper bound below the margin, and no flag family is new on the candidate |
| `regressed` | `regression` | 1 | evidence of a drop: a new flag, a criterion the false discovery rate control keeps, or the all-pass McNemar test below 0.05 with more goldens regressed than improved |
| `unproven` | `not-shown-non-inferior` | 1 | no evidence of a drop, but an interval is wider than the margin; this means too few goldens, never a regression |
| none | `incomplete` | 1 | a candidate cell did not run (stopped by the budget, or pending) |
| none | `not-run` | 3 | a spec of the candidate has more of its blocks not run (a Given the target cannot apply, see [running](../running.md#outcomes)) than `--max-not-run` allows, default 0, and compare finds no regression. Not-run units are left out of the comparison and listed. A regression wins over it, exit 1, so the verdict never depends on an unrelated spec not run; a golden that flipped while compare calls the change noise is no regression |

Measured 2026-10-12 on the Acme golden suite (10 goldens) with the defaults:

```
$ pnpm driftbench ci --specs examples/acme/golden/specs --target fault:control-sales-identity --faults examples/acme/faults --route flow:price-sheet=process:acme-ops --baseline baseline --store <db>
Margin auto: 28 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 27.75 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 27.8 points); about 22 goldens would.
Underpowered, under 30 goldens, left out of the parity test: artifacts (1 golden), budget (2 goldens), cards (1 golden), end_state (7 goldens), execution (1 golden), forbidden (9 goldens), guards (3 goldens), lang (8 goldens), ledger (2 goldens), must (8 goldens), must_not (3 goldens), pii (10 goldens), safety (1 golden), skills (1 golden), stage (10 goldens), tools (9 goldens), workspace (1 golden).
(the verdict table)
Verdict: PARITY. Exit 0.
$ pnpm driftbench ci --specs examples/acme/golden/specs --target fault:x3-skips-recap --faults examples/acme/faults --route flow:price-sheet=process:acme-ops --baseline baseline --store <db>
Verdict: REGRESSION. Exit 1.
```

With `--change <manifest>`, `ci` runs only the [blast radius](../concepts/blast-radius.md) of the change and carries the other cells from the baseline, which must then be a campaign of the `--store` file. `--agent-version` names the candidate's version, the manifest's `to`. Carried goldens are not paired: the parity test reads the fresh ones. `--audit <n>` runs n of the cells about to be carried and compares each with its stored run; one that differs gives the verdict `radius-miss`, exit 1, and the candidate then runs whole. The summary gains a `radius` block: the manifest, the cells fresh and carried, the blocks sent and carried, and the audit. `--max-carry` and `--max-age` are the staleness limits of `campaign run`. Without `--change`, the summary and the verdict are what they were.

## `driftbench monitor`

Watches one metric for a shift with CUSUM, Page-Hinkley and a sliding two-sample KS test, and alarms when two of the three agree. The series is the campaigns of a store, or time windows of production traces. See [production traces](../traces.md#monitoring-driftbench-monitor---source-traces).

```
driftbench monitor --store <file> --metric pass_rate|cost|latency [--window <n>] [--series] [--json]
driftbench monitor --source traces <path> --metric latency|cost|tokens|tool_calls|tool_errors|turns [--from otel|nexus|claude-code] [--every <duration>] [--window <n>] [--prices <file>] [--series] [--json]
```

| Option | Effect |
|---|---|
| `--source` | `store` (default): the campaigns of `--store`, oldest first; `traces`: the traces at `<path>` |
| `--metric` | the value of each point. Required |
| `--window <n>` | the points that set the in-control level, and the length of each KS segment. Default 20; the series needs at least twice as many |
| `--every <duration>` | traces: the time window of one point, a whole number and s, m, h or d. Default `1h` |
| `--from` | traces: `otel` (default), `nexus` or `claude-code` |
| `--prices <file>` | traces: JSON prices per million tokens by model, for cost |
| `--series` | print every point with its statistics |
| `--json` | one JSON document, with `alarm`, `votes`, each detector's alarms and, on a shift, `alert`: the point where the second detector first alarmed |

| Exit code | When |
|---|---|
| 0 | no shift: fewer than two detectors alarmed |
| 1 | a shift: two or three detectors alarmed |
| 2 | bad input: an unknown metric for the source, no store or no path, a bad `--every` or `--window`, too few points |

Too few points is what a young store answers, not a broken one: the series needs two windows, 40 campaigns at the default `--window 20`. The message names the largest window the store allows, and the smallest window, `--window 2`, needs 4 campaigns. The example below runs on a store of six campaigns with `--window 2`.

On a store:

```
$ pnpm driftbench monitor --store <db> --metric pass_rate --window 2
  detector      first alarm  campaign        created                   direction  detail
  CUSUM         2            c-7c842ff480ff  2026-10-12T00:12:17.232Z  down       shift began at 2; 1 alarm in all
  Page-Hinkley  2            c-7c842ff480ff  2026-10-12T00:12:17.232Z  down       1 alarm in all
  KS            none                                                              largest D 0.50 at 2, p 1.0

Shift detected: 2 of 3 detectors alarmed. Exit 1.
(exit 1)
```

The store held six Acme campaigns; the third was the candidate of the failing `ci` run above, a fault agent.

## `driftbench select` and `driftbench holdout`

```
driftbench select --cover <map> --specs <dir> --out <dir> [--k <n>] [--t <n>] [--force] [--json]
driftbench holdout seal --specs <dir> --out <dir> [--share <share>] [--seed <n>] [--force]
driftbench holdout score --sealed <dir> --target <adapter:agent> [--budget <queries>] [--json]
```

`select` chooses the golden set from the gated specs: the fewest conversations covering the cells of the map on every subset of `--t` dimensions, then the `--k` best. Sealed specs never count. Exit 0 when the set is written and covers every required cell, 1 when it is written and a required cell stays empty, 2 on a usage or input error.

`holdout seal` seals a share of the gated specs (the gate's own sealed split when it has one). Give `--specs` the gate's output folder, the one that holds `specs/` and `holdout/`, such as `examples/acme/gated`: its `specs/` subfolder alone does not hold the sealed files, and `holdout seal` refuses it and names the folder to pass. `holdout score` runs the sealed specs once through the runner and prints the pass rate with its Wilson interval, never which spec passed; each score spends one query of the budget. Seal: exit 0 when written, 2 on bad input. Score: exit 0 when scored, 1 when the budget is spent, 2 on bad input.

```
$ pnpm driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --out <dir> --k 10
Pool: 200 unsealed specs; 58 sealed specs left out; 4 gate files that are not specs skipped.
Cover: 106 conversations cover every cell the pool covers (598 of 708).
(the ranked table)
Cells covered: 306 of 708 allowed pairs (43.2%); the pool covers 598.
  t = 3: 794 of 4064 allowed (19.5%).
Required cells: 10 of 10; the pool covers 10.
Faults turned red: 12 of the 13 the pool turns red (13 counted faults in the gate report).
(exit 0)
$ pnpm driftbench holdout seal --specs examples/acme/gated --out <dir>
Wrote <dir>/sealed.json. The sealed specs run only through driftbench holdout score; select leaves them out.
(exit 0)
$ pnpm driftbench holdout score --sealed <dir> --target function:acme-sales --budget 3
  conversations  passed  pass rate  95% Wilson interval
  49             49      100.0%     92.7% to 100.0%
Not run, not counted: acme-price-sheet (names process:acme-ops), acme-price-sheet-i01-base (names process:acme-ops), (the other 9 price-sheet task specs).
Budget: 1 of 3 queries used, 2 left. Which conversation passed is not shown: the holdout stays sealed.
(exit 0)
```

## `driftbench radius`

```
driftbench radius <paths...> --change <manifest> [--mode <modes>] [--json]
```

Prints the [blast radius](../concepts/blast-radius.md) of a change: the blocks of the specs the change can affect, against the whole suite. It is read only: nothing runs and nothing is written.

| Option | Meaning |
|---|---|
| `--change <manifest>` | the change manifest, YAML or JSON: `from`, `to` and the list of `changes`, each with a `kind`, an `id` and, for a tool, a `part` |
| `--mode <modes>` | the run modes to plan for, separated by commas; default `F`. In `F` and `P` every block after a direct block of the same run is in; in `T` a block runs alone |
| `--json` | one JSON document: the manifest and its hash, the totals per mode, and every block with its state (`direct`, `forward` or `out`) and its reasons |

A block is in directly when its dependencies name a change, and forward when it follows such a block in the same run. A block with unknown dependencies is in every radius. A change that cannot be mapped, or that no block declares, makes the radius the whole suite, and the output says which change and why.

Exit 0 when the radius is smaller than the suite, 1 when it is the whole suite, 2 on a usage or input error.

```
$ pnpm -s driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml
Blast radius of acme-v1 to acme-v2 (manifest a393cc307eff): deviation:D2.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 22 of 861 blocks in the radius (9 direct, 13 forward), 839 out. 9 of 195 cells.
  A cell reruns whole: 55 of 861 blocks sent, 93.6% saved; 186 of 195 cells left to carry.
In the radius, mode F:
  spec           blocks in  from              why
  gen-twise-003  3 of 6     b4-D2_goal_shift  deviation:D2
  (8 more rows)
(exit 0)
```

## `driftbench queue`

```
driftbench queue create --store <db> --campaign <id> [--labels <dir>]
driftbench queue list [--labels <dir>]
driftbench queue assign <runId>.b<index> --criterion <name> --reviewer <name> [--labels <dir>]
driftbench queue vote <runId>.b<index> --criterion <name> --reviewer <name> --label <pass|fail> [--labels <dir>]
driftbench queue agreement [--labels <dir>]
```

The review queue of blocks to label, kept beside the labels as `queue.json`. `create` queues each block of a campaign once per criterion of its spec, skipping blocks already labelled. `list` prints each item with its state and holder. `assign` takes an item for a reviewer; a second reviewer is refused with exit 2. `vote` records a second reviewer's label without writing the labels file, and `agreement` prints the agreement between the first two reviewers of each item with two votes. Saving a label on the viewer's queue page marks its item done. See [viewer](../viewer.md#review-queue).

## `driftbench view`

```
driftbench view [--store <file>] [--port <n>] [--labels <dir>] [--labelled-by <name>] [--config <file>]
```

Serves a store on `127.0.0.1` as a local website: the campaigns, each campaign's scorecard with its spread view, one page per run with every block in full, and the comparison of two campaigns. Under every block a form saves a pass or fail label per criterion, with a note, to the labels folder `judge calibrate --labels` reads. `--store` defaults to `driftbench.db`, `--port` to `4317` (`0` picks a free one), `--labels` to `labels`. `--config` names the config whose `scales:` bound each criterion's queue score; it defaults to `driftbench.yaml` when that file exists, and a config that does not parse exits 2. It runs until Ctrl+C. Exit 0 after a stop; 2 when the store is missing, the port is not a number, or the port cannot be opened. See [viewer](../viewer.md).

## `driftbench import`

```
driftbench import csv <file> --mapping <yaml> --out <dir> [--force] [--json]
driftbench import xlsx <file> --mapping <yaml> --out <dir> [--force] [--json]
```

Turns the rows of a CSV file or of one sheet of a workbook into spec files, one `<id>.yaml` per spec, through a mapping file. The mapping, its templates and an example are on the [datasets](../datasets.md#import-specs-from-a-table) page.

| Option | Effect |
|---|---|
| `--mapping <yaml>` | the mapping file: which columns fill which spec and block fields |
| `--out <dir>` | the folder the spec files are written to |
| `--force` | overwrite spec files that exist with other content |
| `--json` | print one JSON document: the source, the folder, the row count and each spec with its file, rows, block count and hash |

| Exit code | When |
|---|---|
| 0 | every spec is written |
| 1 | a row makes an invalid spec; nothing is written |
| 2 | bad input: the mapping, the file, a column the table lacks, a spec file that exists with other content |

## `driftbench dataset` and `driftbench prompt`

```
driftbench dataset push <name> <path> --store <file> [--note <text>] [--json]
driftbench dataset list [name] --store <file> [--json]
driftbench dataset diff <ref> [other] --store <file> [--dir <path>] [--json]
driftbench dataset restore <ref> --store <file> [--out <path>] [--force] [--json]
```

`driftbench prompt push|list|diff|restore` take the same arguments. The registry keeps immutable, numbered, content-addressed versions of a folder of specs or of prompt files in the store. What each command does, with its output, is on the [datasets](../datasets.md#the-registry) page.

| Command | Does |
|---|---|
| `push` | stores the files as the next version of the name; the same content again gives back the version that holds it. `dataset push` refuses a folder with an invalid spec |
| `list` | prints every version: `name@version`, the hash, the file count, the time and the note |
| `diff` | prints the files added (`A`), removed (`D`) and changed (`M`) between two versions, or between a version and a folder with `--dir`; without `[other]`, the version before `<ref>` |
| `restore` | writes the exact bytes of every file to where they were pushed from, or to `--out`; a file with other bytes stops it unless `--force` is given |

| Exit code | When |
|---|---|
| 0 | `push`, `list`, `restore`: done. `diff`: no difference |
| 1 | `push`: an invalid spec. `diff`: they differ. `restore`: a file differs and `--force` was not given |
| 2 | bad input: an unknown name or version, a path that cannot be read, a store that cannot be opened |

## Not built yet

Every command `driftbench --help` lists is built. These do not exist as commands yet:

| Command | Does | Phase |
|---|---|---|
| `stats` | statistics on a stored campaign from the command line | 4 |
| `battery run` | the runtime battery on agent traces | 4 |
| a rerun of one stored cell | run one cell of a stored campaign again | no phase assigned |
| `init` | start a project | no phase assigned |
| `judge lint` | lint the rubric of every criterion in a folder (see [judges, Additional APIs](../concepts/judges.md#additional-judge-apis)) | no phase assigned |
| `judge compare` | judge two runs of the same specs side by side, in both orders, and report the winner per criterion and the position bias (see [judges, Additional APIs](../concepts/judges.md#additional-judge-apis)) | no phase assigned |
| `spec synth` | specs from traffic clusters | no phase assigned |

## `driftbench campaign run --cache-suite`

`--cache-suite <name>` names the cache suite of a campaign. Its block keys include the name, so a campaign under a new name starts from an empty cache, and the entries of the other suites stay in the store. A campaign under the same name replays from its own suite. Without the flag, the keys are the ones earlier caches used.

## Token prices for campaign budgets

`campaign run` and `campaign resume` accept `--prices <file>` for a standalone dated USD token price table. Without the flag, they read `prices:` from `driftbench.yaml`. See [the budget](../running.md#the-budget) for the format, model lookup, and preflight refusal listing every declared target model without a price. Models first reported at runtime can only be checked after that first call. A budget counts target-adapter reports only; simulated-user and judge calls are excluded. The CLI prints that scope on stderr when those roles are used with a budget.

### Prompt change manifests

`driftbench radius auto --prompt <old> <new> --map <approved.yaml> [--source <path>] [--from-version <version>] [--to-version <version>] [--out <manifest.yaml>]` writes a manifest from approved evidence quotes. It exits 0 when the manifest is written or printed, including a conservative whole-suite manifest, and 2 on invalid input. The separate `radius <specs> --change ...` command exits 1 when its computed radius is the whole suite. `driftbench radius <specs> --change <manifest.yaml> --explain` traces anchors to block reasons. See [prompt quotes](../concepts/blast-radius.md#prompt-quotes).

`driftbench radius sections init <prompt> --id <prompt-id> --prompt-version <version> [--level <n>] [--out <file>]` writes a first section registry from the markdown headings. `driftbench radius sections check <registry> --prompt <file> [--json]` exits 1 when the registry no longer describes the prompt. `driftbench radius sections reanchor <registry> --prompt <old> <new> --to-version <version> [--out <file>] [--change-out <manifest>] [--json]` finds every section again in the new prompt, writes the `prompt_section` manifest with `--change-out`, and exits 1 when a section is stale, a change lies outside every section or sections changed order. `driftbench radius <specs> --change <manifest> --sections <registries...>` prints, after the radius, which blocks selection by section links would run; a `prompt_section` change keeps the radius the whole suite. `driftbench radius localize <specs> --store <file> --campaign <id> --sections <registries...> [--prompt <id>] [--mode <mode>] [--counting grouped|flat] [--top <n>] [--json]` ranks the local sections of a prompt by Ochiai suspiciousness from the campaign's block verdicts; it exits 0 with a ranking, 1 when nothing failed outside inherited failures, 2 on bad input. Defaults and exits of the section registry commands:

* `radius sections init` makes one section for each heading of level 1 up to `--level` (a whole number from 1 to 6, default 2); a deeper heading belongs to the section above it. The text before the first heading is the section `preamble` when it is not empty. An id is the slugged title (lower case, letters and digits, other runs as `_`; a second section with the same slug gets `_2`). Every section is `global`. It prints the registry, or writes it with `--out`, and exits 0. It exits 2, writing nothing, for a `--level` outside 1 to 6, a prompt it cannot read, a prompt with no section, or a section in which no quote is unique in the prompt.
* `radius sections check` exits 0 when every live section matches the prompt (the whole-text hash, each section's hash, span and anchor, no overlap; stale sections are not checked and are listed), 1 when the registry no longer describes the prompt, and 2 when the registry or the prompt cannot be read or the registry is invalid: it is not YAML or JSON, a field is missing or unknown, an id is used twice, or `references`, `overrides` or `duplicates` names a section that does not exist.
* `radius sections reanchor` exits 0 when every section was found again in order and no text changed outside the sections, 1 otherwise (a stale section, text outside every section, or sections that changed order), and 2 when the registry is invalid, `--prompt` does not name exactly two files, or the registry does not describe the old prompt (its `text_sha256` differs from the old text). The statuses `kept`, `moved` and `stale` are in [re-anchoring a registry](../concepts/blast-radius.md#re-anchoring-a-registry).

Example of a registry written by `radius sections init`, for a prompt with a preamble and the sections Tone, Refunds and Escalation:

```text
prompt_id: support
version: v1
normalisation: NFC; CRLF/CR->LF; offsets in UTF-16 code units; end exclusive
text_sha256: 5a168ea21558287f0480ec217b789ad7925ff056bbf91a01bd3723d45ab8c344
sections:
  - id: preamble
    title: preamble
    scope: global
    span: { start: 0, end: 45 }
    sha256: db68cd6020275ff4d59ed333e3611bdcc32d044b8732e9f1f84badacd80d3675
    anchor: { quote: "You are the support agen", prefix: "", suffix: "t of Harbour Freight.\n\n## Tone\nA" }
  - id: tone
    title: Tone
    scope: global
    span: { start: 47, end: 97 }
    # sha256 and anchor as above
```

See [prompt sections and block links](../concepts/blast-radius.md#prompt-sections-and-block-links).

### `campaign rejudge`

```sh
driftbench campaign rejudge <paths...> --from <campaign> --campaign <new-id> --store <file> --change <criterion-manifest> (--judge <kind>:<model> | --judges <cassette>) [judge flags] [--max-carry <n>] [--max-age <days>] [--json]
```

Re-judge selected criteria using compatible stored observations, without calling an agent.
The manifest's agent versions must be identical. Full compatibility requirements, refusal
cases and an executed Acme example are in [blast radius](../concepts/blast-radius.md#re-judge-a-criterion).
