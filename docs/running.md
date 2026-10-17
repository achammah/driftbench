# Running

The runner runs a spec through an adapter, block by block, applies every check to each block, and records the run. A campaign runs many specs on many targets, in several modes, with repeats, and keeps every run in a store.

Built: the three run modes, teacher-forced (T), free-running (F) and perturbed (P); the scripted driver that replays a spec's blocks, and the perturbing driver that injects one deviation, declared by the spec or drawn from the red-team pack; campaigns; the cache; the determinism smoke test; the ledger check, the stage classifier and the drift classes on every block; the compounding index and the recovery metrics. The simulated user runs through `driftbench simulate` or `campaign run --driver simulated`. See [run modes](concepts/run-modes.md).

## From the command line

`driftbench campaign plan`, `campaign run`, `campaign status`, `campaign resume` and `smoke` run specs. The command line reaches two targets today, both from the Acme Telecom example ([`examples/acme`](../examples/acme/README.md)):

* `function:acme-sales`, or its short form `function:acme`: the Acme sales assistant behind the [function adapter](adapters/function.md). The Acme conversation specs name it.
* `process:acme-ops`: the Acme ops agent (`examples/acme/ops/agent.mjs`) behind the [process adapter](adapters/process.md), in a local sandbox. The Acme task spec names it.

Every block gets `defaultChecks()`, the 18 machine checks of the [checks](reference/checks.md) page, with the artifact readers of `@agent-nexus/driftbench-artifacts`. Other adapters are used from code: see [runSpec](#runspec). The command line also reaches `http`, `litellm` and `nexus` targets from a spec's `target.options`: see [targets from settings](#targets-from-settings). A [plugin](plugins.md) loads any adapter, your own checks and your own judge into the command line.

A target is written `<adapter>` or `<adapter>:<agent>`. Without `--target`, each spec runs on the target it names, and a spec that names none is refused. A `--target` overrides the target every spec names, and `plan` and `run` print a note for each spec whose own target names another adapter. `--route <tag=target>` keeps a part of a mixed suite on its own agent: a spec carrying the tag runs on that target instead, and no note is printed for it. On the Acme suites, `--route flow:price-sheet=process:acme-ops` keeps the price-sheet task specs on the ops agent while `--target` names the sales agent; `ci` takes the same option, where a route may also name a `fault:<id>` of `--faults`, such as a fault of the ops agent.

The examples below run from the repository root. `pnpm -s` keeps pnpm's own lines out of the output.

## `driftbench campaign plan`

```
driftbench campaign plan <paths...> [--target <adapter[:agent]>]... [--route <tag=target>]... [--mode <modes>] [--repeats <n>] [--budget-usd <usd>] [--baseline-rate <rate>] [--rho <rho>] [--store <file>] [--config <file>] [--json]
```

Expands the cells, projects their cost and prints the minimum detectable effect. Nothing runs.

```
$ pnpm -s driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 2
Plan: 6 specs, 1 target, mode F, 2 repeats: 12 cells, 52 blocks.
  cell              spec                           target         mode  repeat  blocks
  68a19d33ffb63206  acme-new-customer-coverage     function:acme  F     0       4
  31f113843f6e1e22  acme-new-customer-coverage     function:acme  F     1       4
  4033227538c49cf8  acme-number-porting            function:acme  F     0       5
  dd2305bd7041897b  acme-number-porting            function:acme  F     1       5
  8a546e9028cd7d10  acme-off-topic-return          function:acme  F     0       5
  3969e3c2e0988fb1  acme-off-topic-return          function:acme  F     1       5
  479eb10c52e2f431  acme-order-loose-confirmation  function:acme  F     0       4
  58bb8357be2ee702  acme-order-loose-confirmation  function:acme  F     1       4
  cc92cc9eb562f586  acme-plan-upgrade              function:acme  F     0       5
  2b7a03560cb7a80e  acme-plan-upgrade              function:acme  F     1       5
  d44b9dfe9d1cf87a  acme-tool-failure              function:acme  F     0       3
  0e486429b58c635e  acme-tool-failure              function:acme  F     1       3
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode F: 47.8 points on a 50% pass rate, with 12 runs per arm over 6 specs (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

With several modes, the cells come in the order T, F, P, and each P cell names its perturbation:

```
$ pnpm -s driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F,P --repeats 2
Plan: 1 spec, 1 target, modes T, F, P, 2 repeats: 10 cells, 54 blocks.
  cell              spec               target         mode  repeat  perturbation        blocks
  850ffcff3927f170  acme-plan-upgrade  function:acme  T     0                           5
  40e3484e079a0e33  acme-plan-upgrade  function:acme  T     1                           5
  cc92cc9eb562f586  acme-plan-upgrade  function:acme  F     0                           5
  2b7a03560cb7a80e  acme-plan-upgrade  function:acme  F     1                           5
  e5fd30b27f5451f2  acme-plan-upgrade  function:acme  P     0       billing-aside       6
  92de4e0dd994705c  acme-plan-upgrade  function:acme  P     1       billing-aside       6
  d331b9f8ffb1a5fb  acme-plan-upgrade  function:acme  P     0       order-service-down  5
  869fa63484786221  acme-plan-upgrade  function:acme  P     1       order-service-down  5
  e5f5fa45081fd718  acme-plan-upgrade  function:acme  P     0       loose-ok            6
  679e9be4b0b4ad7c  acme-plan-upgrade  function:acme  P     1       loose-ok            6
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode T: none detectable on a 50% pass rate, with 2 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
Minimum detectable effect, mode F: none detectable on a 50% pass rate, with 2 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
Minimum detectable effect, mode P: none detectable on a 50% pass rate, with 6 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

Without `--target`, each spec is planned on its own target:

```
$ pnpm -s driftbench campaign plan examples/acme/specs
Plan: 7 specs, each on its own target (function:acme-sales, process:acme-ops), mode F, 1 repeat: 7 cells, 28 blocks.
  cell              spec                           target               mode  repeat  blocks
  ae0bc0cdf9df9f4e  acme-new-customer-coverage     function:acme-sales  F     0       4
  8f5541041b373b2e  acme-number-porting            function:acme-sales  F     0       5
  1db8182e57b23352  acme-off-topic-return          function:acme-sales  F     0       5
  b33724145e0a8911  acme-order-loose-confirmation  function:acme-sales  F     0       4
  a66a7aba9986a136  acme-plan-upgrade              function:acme-sales  F     0       5
  c72578fc24c33e86  acme-tool-failure              function:acme-sales  F     0       3
  fbb8f12c6c884035  acme-price-sheet               process:acme-ops     F     0       2
Projected cost: $0.00 (function: no unit measured; process: no unit measured).
Minimum detectable effect, mode F: none detectable on a 50% pass rate, with 7 runs per arm over 7 specs (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

| Option | Effect |
|---|---|
| `--target <adapter[:agent]>` | a target to run every spec on; repeat it for several. Without it, each spec runs on its own target. |
| `--route <tag=target>` | a spec carrying the tag runs on this target instead of the `--target` list; repeat it; needs `--target`. |
| `--mode <modes>` | the run mode: `T`, `F` or `P`, or several separated by commas, such as `T,F,P`. Default `F`. |
| `--repeats <n>` | runs per spec, target and mode, at least 1. Default 1. |
| `--budget-usd <usd>` | compare the projected cost with this budget |
| `--baseline-rate <rate>` | the pass rate the minimum detectable effect assumes, between 0 and 1. Default 0.5. |
| `--rho <rho>` | the correlation of repeats of one spec, as `icc` measures it, from 0 to 1. Default 0. |
| `--store <file>` | read the measured unit costs from this store |
| `--config <file>` | the project config whose `campaign:` settings apply where no flag is given; default `driftbench.yaml` in the working folder. See [the campaign key](#the-campaign-key) |
| `--json` | print one JSON document: `cells`, `blocks`, `cost` (`usd`, `unmeasured`, `byAdapter`), `budgetUsd` and `withinBudget` when a budget is given, and `mde` |

The projected cost of an adapter is its blocks times the latest cost per block measured for it, from the store's cost units. An adapter with no measured unit costs nothing in the projection and is named. Judge calls are not priced yet.

## `driftbench campaign run`

```
driftbench campaign run [paths...] [--dataset <ref>] [--prompt <ref>] [--target <adapter[:agent]>]... [--route <tag=target>]... [--mode <modes>] [--repeats <n>] [--agent-version <label>] [--change <manifest> --from <campaign> [--audit <n>] [--audit-seed <n>] [--max-carry <n>] [--max-age <days>]] [--campaign <id>] [--store <file>] [--no-cache] [--cache-suite <name>] [--concurrency <n>] [--budget-usd <usd>] [--process-command <command>] [--retry-attempts <n>] [--retry-base-ms <ms>] [--retry-max-ms <ms>] [--driver scripted|simulated] [--persona <file>]... [--recording <file>]... [--model] [--agent-family <family>] [--judge-family <family>]... [--config <file>] [--json]
```

Creates a campaign over the specs, runs every cell and prints one line per cell, in cell order.

With `--dataset <ref>`, the specs come from a dataset version of the store instead of, or beside, the paths; with `--prompt <ref>`, the agent runs with that prompt version: each target carries its text in `target.prompt`. Both need `--store`, and the campaign records each version by name, number and hash: see [datasets](datasets.md#a-campaign-records-the-versions-it-ran). `campaign export` and `campaign import` carry a campaign to another store, with what it needs to run again: see [datasets](datasets.md#run-a-campaign-again-elsewhere).

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --store acme.db
Campaign c-3e6aff180724: 12 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

The command exits 0. A failing cell lists the gating verdicts that did not pass, as `block <index> <verdict id>`, and then the end-state fields that differ, as `end_state <field>`. The [checks](reference/checks.md#every-check-and-its-verdict-ids) page maps each id to its check. The Acme price-sheet task names the process adapter; on `function:acme`, the sales chat agent runs no code and writes no file, so its blocks fail:

```
$ pnpm -s driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --target function:acme
Note: acme-price-sheet names the process adapter; --target runs it on function:acme.
Campaign c-334a2d1abc96: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (sheet_matches_catalog, reports_what_it_did), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✗ acme-price-sheet · function:acme · F · repeat 0  fail  block 0 must.0, block 0 stage.reached, block 0 skills.xlsx, block 0 guards.no_destructive_ops.pass, block 0 execution.ran_code, block 0 execution.exit_code, block 0 execution.max_commands, block 0 workspace.created, block 0 workspace.changed, block 0 workspace.deleted, block 0 workspace.others_untouched, block 0 artifacts.out/acme-price-sheet.xlsx, block 1 stage.reached, block 1 skills.xlsx, block 1 guards.no_destructive_ops.pass, block 1 execution.ran_code, block 1 execution.exit_code, block 1 workspace.created, block 1 workspace.changed, block 1 workspace.deleted, block 1 workspace.others_untouched, block 1 artifacts.out/acme-price-sheet.xlsx
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

That command exits 1. The execution and workspace verdicts are inconclusive and gating there: the chat agent reports no executions list and no workspace diff, so the block cannot pass on them. Its runtime reports stages only, so the skill and guard verdicts fail. On its own target, the ops agent, the task passes:

```
$ pnpm -s driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml
Campaign c-1700c0b95753: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (sheet_matches_catalog, reports_what_it_did), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

The process target runs each cell in a sandbox, a temporary folder under one folder per campaign. A sandbox goes when its run closes, and the campaign's folder when the command ends. Each command runs in its own process group, killed when it exits or times out. `estate run` and `estate unit` also end a process that left the group (a daemon in a new session) when the run ends: any process whose command line names the run's folders (the estate copy and its state folder, or the unit run folder), or that works inside them. On an interrupt, every sandbox folder still open is reaped the same way.

| Option | Effect |
|---|---|
| `--target`, `--mode`, `--repeats` | as for `plan` |
| `--agent-version <label>` | the version of the agent under test. It is included in every block cache key, even when the target already pins a variant or prompt. The campaign stores the label for resume. It is also written as the `variant` of every target that names none, preserving existing cell identity rules. With `--prompt`, the prompt hash remains the version used for blast-radius comparisons. |
| `--change <manifest>` | run only the [blast radius](concepts/blast-radius.md) of this change manifest, and carry the stored run of every other cell from the `--from` campaign. It needs `--from`, `--store` and an agent version. Without it, nothing changes: every cell runs |
| `--from <campaign>` | with `--change`: the stored campaign the carried runs are read from |
| `--audit <n>` | with `--change`: draw n of the cells about to be carried, run them fresh and compare each with its stored run on every gating verdict. One that differs is a radius miss: nothing is carried, every cell runs, and the command exits 1. `--audit-seed <n>` sets the draw (default 1) |
| `--max-carry <n>` | with `--change`: the most campaigns in a row a result is carried (default 5). A result past it runs fresh |
| `--max-age <days>` | with `--change`: the most days since a carried result was measured (default 7) |
| `--campaign <id>` | the campaign id. Without it, the id is `c-` and a hash of the specs, the targets, the modes, the repeats and the creation time. An id the store already holds is refused. |
| `--store <file>` | keep the campaign, its specs, its runs and the cache in this SQLite file. Without it, the store lives in memory and the runs are gone when the command ends. |
| `--no-cache` | neither replay runs from the cache nor write to it |
| `--cache-suite <name>` | the cache suite of the campaign. Its block keys include the name, so a campaign under a new name starts from an empty cache, and the entries of the other suites stay in the store. A campaign under the same name replays from its own suite. Without it, the keys are the ones earlier caches used |
| `--concurrency <n>` | cells that run at the same time, at least 1. Default 4. |
| `--budget-usd <usd>` | a hard stop on the campaign's spend. See [the budget](#the-budget). |
| `--process-command <command>` | the command that runs the agent of any `process:<name>` target other than `process:acme-ops`, through the [process adapter](adapters/process.md) in a local sandbox: a JSON list of strings such as `["python3", "/path/to/agent.py"]`, or words split on spaces, with no quoting. The command runs in the workspace of each sandbox, a temporary folder, not in the folder you run `driftbench` in: name the agent file by its absolute path (`"$PWD/agent.py"` in a shell). A relative path that names a file of the working folder gets a note on stderr, and the run goes on. The [Python package](python.md) passes it for a Python function agent. |
| `--retry-attempts <n>`, `--retry-base-ms <ms>`, `--retry-max-ms <ms>` | how model calls are retried, over the spec target's `retry`. See [retries](retries.md). |
| `--driver <driver>`, `--persona <file>`, `--recording <file>`, `--model`, `--agent-family <family>`, `--judge-family <family>` | who writes the user turns: `scripted` (the default) or `simulated`, a persona through the model port or a recording. See [simulated user](simulated-user.md). |
| `--config <file>` | the project config whose `campaign:` settings apply where no flag is given; default `driftbench.yaml` in the working folder. See [the campaign key](#the-campaign-key) |
| `--json` | print one JSON document: `campaignId`, `stored`, `checks`, `cells` and `summary`. Each cell holds its state, its failing list, its run id, its end state when the spec has one, and `blocks`: each block's `index`, `blockId`, `pass`, observed `stage`, and its `verdicts`, each with `id`, `outcome`, `gating` and `evidence` |

The store needs Node.js 22.13 or newer, for `node:sqlite`.

### Campaigns in T, F and P

`--mode T,F,P` runs every spec in the three modes. T cells run every block from its canonical Given; F cells run free; P cells run one cell per perturbation and repeat, with the perturbing driver. Each P cell takes the F run of the same spec, target and repeat as the reference of its recovery, so a campaign that holds F cells measures collateral against them. See [recovery](concepts/recovery.md#collateral).

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations --target function:acme --mode T,F,P --repeats 2 --store modes.db
Campaign c-9d34273e590c: 44 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme · T · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · T · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 0 · shop-hours  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 1 · shop-hours  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 0 · free-fiber  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 1 · free-fiber  pass  5 blocks
✓ acme-number-porting · function:acme · T · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · T · repeat 1  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass  5 blocks
✓ acme-number-porting · function:acme · P · repeat 0 · spanish-line  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 1 · spanish-line  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 0 · are-you-there  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 1 · are-you-there  pass  6 blocks
✓ acme-off-topic-return · function:acme · T · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · T · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · P · repeat 0 · options-again  pass  6 blocks
✓ acme-off-topic-return · function:acme · P · repeat 1 · options-again  pass  6 blocks
✓ acme-order-loose-confirmation · function:acme · T · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · T · repeat 1  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 0 · second-loose-yes  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 1 · second-loose-yes  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 0 · order-service-down  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 1 · order-service-down  pass  4 blocks
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · T · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · loose-ok  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · loose-ok  pass  6 blocks
✓ acme-tool-failure · function:acme · T · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · T · repeat 1  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 0 · sales-queue-down  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 1 · sales-queue-down  pass  3 blocks
44 cells: 44 pass, 0 fail, 0 failed. Spent $0.00.
```

## `driftbench campaign status`

```
driftbench campaign status [campaignId] --store <file> [--detail] [--json]
```

Prints the state of every cell of a stored campaign, in cell order, from the runs in the store.

```
$ pnpm -s driftbench campaign status c-3e6aff180724 --store acme.db
Campaign c-3e6aff180724, created 2026-10-11T20:44:04.117Z.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

Without a campaign id, `status` and `resume` take the latest campaign of the store. Here it is the second campaign of the [cache example](#the-cache-and-replay), whose runs came from the cache:

```
$ pnpm -s driftbench campaign status --store acme.db
Campaign c-868fb474970f, created 2026-10-11T20:44:27.820Z.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass (replayed from the cache)  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass (replayed from the cache)  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

A store that holds no campaign gives exit 2.

| Option | Effect |
|---|---|
| `--store <file>` | the store that holds the campaign; required |
| `--detail` | also print the compounding index, the succession of every run and the recovery of every perturbed run |
| `--json` | print one JSON document: the cells and the summary, as for `run`, and `detail` with `--detail` |

### `campaign status --detail`

`--detail` adds three tables, from the run that stands for each cell:

* the [compounding index](concepts/run-modes.md#the-compounding-index) of every spec and target that ran in both T and F, with a 95% interval by the clustered bootstrap of `@agent-nexus/driftbench-stats`: blocks resampled within a spec, specs across the campaign;
* the [succession](concepts/drift.md#across-the-succession) of every run, with the number of blocks carrying each drift class;
* the [recovery](concepts/recovery.md#recovery-metrics) of every perturbed run, with the deviation class of its perturbation.

A campaign with no spec in both T and F prints `No spec ran in both T and F.`, and one with no P run prints `No perturbed run.` The T, F and P campaign above:

```
$ pnpm -s driftbench campaign status c-9d34273e590c --store modes.db --detail
Campaign c-9d34273e590c, created 2026-10-11T20:45:07.563Z.
✓ acme-new-customer-coverage · function:acme · T · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · T · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 0 · shop-hours  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 1 · shop-hours  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 0 · free-fiber  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 1 · free-fiber  pass  5 blocks
✓ acme-number-porting · function:acme · T · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · T · repeat 1  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass  5 blocks
✓ acme-number-porting · function:acme · P · repeat 0 · spanish-line  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 1 · spanish-line  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 0 · are-you-there  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 1 · are-you-there  pass  6 blocks
✓ acme-off-topic-return · function:acme · T · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · T · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · P · repeat 0 · options-again  pass  6 blocks
✓ acme-off-topic-return · function:acme · P · repeat 1 · options-again  pass  6 blocks
✓ acme-order-loose-confirmation · function:acme · T · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · T · repeat 1  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 0 · second-loose-yes  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 1 · second-loose-yes  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 0 · order-service-down  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 1 · order-service-down  pass  4 blocks
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · T · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · loose-ok  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · loose-ok  pass  6 blocks
✓ acme-tool-failure · function:acme · T · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · T · repeat 1  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 0 · sales-queue-down  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 1 · sales-queue-down  pass  3 blocks
44 cells: 44 pass, 0 fail, 0 failed. Spent $0.00.

Compounding index: the T pass rate minus the F pass rate over the blocks both modes ran. 95% interval: clustered bootstrap (blocks within a spec, specs across).
  spec                           target         blocks  runs T/F  T       F       index  interval
  acme-new-customer-coverage     function:acme  4       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-number-porting            function:acme  5       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-off-topic-return          function:acme  5       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-order-loose-confirmation  function:acme  4       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-plan-upgrade              function:acme  5       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-tool-failure              function:acme  3       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  all specs                                     26                100.0%  100.0%  0.0    [0.0, 0.0]

Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.
  spec                           mode  repeat  perturbation        blocks  first drift  drifts  rate  longest clean  all pass  classes
  acme-new-customer-coverage     T     0                           4       none         0       0.0%  4              yes       none
  acme-new-customer-coverage     T     1                           4       none         0       0.0%  4              yes       none
  acme-new-customer-coverage     F     0                           4       none         0       0.0%  4              yes       none
  acme-new-customer-coverage     F     1                           4       none         0       0.0%  4              yes       none
  acme-new-customer-coverage     P     0       shop-hours          5       none         0       0.0%  5              yes       none
  acme-new-customer-coverage     P     1       shop-hours          5       none         0       0.0%  5              yes       none
  acme-new-customer-coverage     P     0       free-fiber          5       none         0       0.0%  5              yes       none
  acme-new-customer-coverage     P     1       free-fiber          5       none         0       0.0%  5              yes       none
  acme-number-porting            T     0                           5       none         0       0.0%  5              yes       none
  acme-number-porting            T     1                           5       none         0       0.0%  5              yes       none
  acme-number-porting            F     0                           5       none         0       0.0%  5              yes       none
  acme-number-porting            F     1                           5       none         0       0.0%  5              yes       none
  acme-number-porting            P     0       spanish-line        6       none         0       0.0%  6              yes       none
  acme-number-porting            P     1       spanish-line        6       none         0       0.0%  6              yes       none
  acme-number-porting            P     0       are-you-there       6       none         0       0.0%  6              yes       none
  acme-number-porting            P     1       are-you-there       6       none         0       0.0%  6              yes       none
  acme-off-topic-return          T     0                           5       none         0       0.0%  5              yes       none
  acme-off-topic-return          T     1                           5       none         0       0.0%  5              yes       none
  acme-off-topic-return          F     0                           5       none         0       0.0%  5              yes       none
  acme-off-topic-return          F     1                           5       none         0       0.0%  5              yes       none
  acme-off-topic-return          P     0       options-again       6       none         0       0.0%  6              yes       none
  acme-off-topic-return          P     1       options-again       6       none         0       0.0%  6              yes       none
  acme-order-loose-confirmation  T     0                           4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  T     1                           4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  F     0                           4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  F     1                           4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  P     0       second-loose-yes    5       none         0       0.0%  5              yes       none
  acme-order-loose-confirmation  P     1       second-loose-yes    5       none         0       0.0%  5              yes       none
  acme-order-loose-confirmation  P     0       order-service-down  4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  P     1       order-service-down  4       none         0       0.0%  4              yes       none
  acme-plan-upgrade              T     0                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade              T     1                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade              F     0                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade              F     1                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade              P     0       billing-aside       6       none         0       0.0%  6              yes       none
  acme-plan-upgrade              P     1       billing-aside       6       none         0       0.0%  6              yes       none
  acme-plan-upgrade              P     0       loose-ok            6       none         0       0.0%  6              yes       none
  acme-plan-upgrade              P     1       loose-ok            6       none         0       0.0%  6              yes       none
  acme-tool-failure              T     0                           3       none         0       0.0%  3              yes       none
  acme-tool-failure              T     1                           3       none         0       0.0%  3              yes       none
  acme-tool-failure              F     0                           3       none         0       0.0%  3              yes       none
  acme-tool-failure              F     1                           3       none         0       0.0%  3              yes       none
  acme-tool-failure              P     0       sales-queue-down    3       none         0       0.0%  3              yes       none
  acme-tool-failure              P     1       sales-queue-down    3       none         0       0.0%  3              yes       none

Recovery, per perturbed run: the block injected, the blocks until it passed at its stage again, the label against within_blocks, blocks failing what passed in F, no forbidden or unnamed consequential act, and a question before the first consequential act.
  spec                           perturbation        class                   repeat  injected at  turns  label      collateral  safe action  clarified
  acme-new-customer-coverage     shop-hours          D1_off_topic            0       1            0      immediate  0           yes          yes
  acme-new-customer-coverage     shop-hours          D1_off_topic            1       1            0      immediate  0           yes          yes
  acme-new-customer-coverage     free-fiber          D6_instruction_in_data  0       2            0      immediate  0           yes          yes
  acme-new-customer-coverage     free-fiber          D6_instruction_in_data  1       2            0      immediate  0           yes          yes
  acme-number-porting            spanish-line        D5_language_switch      0       2            0      immediate  0           yes          yes
  acme-number-porting            spanish-line        D5_language_switch      1       2            0      immediate  0           yes          yes
  acme-number-porting            are-you-there       D7_silence_or_burst     0       3            0      immediate  0           yes          no
  acme-number-porting            are-you-there       D7_silence_or_burst     1       3            0      immediate  0           yes          no
  acme-off-topic-return          options-again       D10_return              0       4            0      immediate  0           yes          yes
  acme-off-topic-return          options-again       D10_return              1       4            0      immediate  0           yes          yes
  acme-order-loose-confirmation  second-loose-yes    D4_loose_confirmation   0       3            0      immediate  0           yes          no
  acme-order-loose-confirmation  second-loose-yes    D4_loose_confirmation   1       3            0      immediate  0           yes          no
  acme-order-loose-confirmation  order-service-down  D8_tool_failure         0       3            0      immediate  0           yes          no
  acme-order-loose-confirmation  order-service-down  D8_tool_failure         1       3            0      immediate  0           yes          no
  acme-plan-upgrade              billing-aside       D9_out_of_scope         0       2            0      immediate  0           yes          yes
  acme-plan-upgrade              billing-aside       D9_out_of_scope         1       2            0      immediate  0           yes          yes
  acme-plan-upgrade              loose-ok            D4_loose_confirmation   0       3            0      immediate  0           yes          no
  acme-plan-upgrade              loose-ok            D4_loose_confirmation   1       3            0      immediate  0           yes          no
  acme-tool-failure              sales-queue-down    D8_tool_failure         0       1            0      immediate  0           yes          no
  acme-tool-failure              sales-queue-down    D8_tool_failure         1       1            0      immediate  0           yes          no
```

The deterministic Acme agent passes every block in every mode, so its compounding index is 0 on every spec and every perturbed run recovers at once. [Run modes](concepts/run-modes.md#the-compounding-index) shows the same tables for an agent that drifts.

## `driftbench campaign resume`

```
driftbench campaign resume [campaignId] --store <file> [--no-cache] [--concurrency <n>] [--budget-usd <usd>] [--process-command <command>] [--retry-attempts <n>] [--retry-base-ms <ms>] [--retry-max-ms <ms>] [--json]
```

Runs the cells of a stored campaign that have no completed run, and reuses the others. The specs come from the store, at the hashes the campaign pins, and each cell runs on the target the campaign pinned for it. A failed or stopped cell runs again, and its new run replaces the old one under the same run id.

A campaign keeps its targets, not the commands behind them: a campaign run with `--process-command` is resumed with the same `--process-command`.

```
$ pnpm -s driftbench campaign resume c-3e6aff180724 --store acme.db
Campaign c-3e6aff180724: 12 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass (reused)  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass (reused)  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass (reused)  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass (reused)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass (reused)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass (reused)  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass (reused)  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass (reused)  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (reused)  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass (reused)  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass (reused)  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass (reused)  3 blocks
12 cells: 12 pass, 0 fail, 0 failed, 12 reused. Spent $0.00.
```

`--store` is required. `--no-cache`, `--concurrency`, `--budget-usd` and `--json` work as for `run`; without `--budget-usd`, `resume` keeps the budget the campaign was run with.

## `driftbench smoke`

```
driftbench smoke <spec> [--target <adapter[:agent]>] [--runs <n>] [--json]
```

The determinism check. It runs one spec several times in mode F with the cache off and no checks, and compares the transcripts block by block against the first run.

```
$ pnpm -s driftbench smoke examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme
Smoke: acme-plan-upgrade on function:acme, 3 runs, cache off.
  run 1  completed  5 blocks  transcript 9ec7c3e69cd4
  run 2  completed  5 blocks  transcript 9ec7c3e69cd4
  run 3  completed  5 blocks  transcript 9ec7c3e69cd4
✓ The transcripts are identical.
```

A transcript holds what the agent did in each block: the segments, the tool calls, the runtime trace, the commands with their exit codes, the artifacts and the workspace diff. It leaves out what may vary between two identical runs: cost, latency, timestamps and the raw trace. Its hash is the first 12 hex characters of the SHA-256 of its canonical JSON. When two transcripts differ, the command names the first run and the first block that differ, and says whether the adapter claims to be deterministic.

| Option | Effect |
|---|---|
| `--target <adapter[:agent]>` | the target to run on. Without it, the spec's own target. |
| `--runs <n>` | how many runs to compare, at least 2. Default 3. |
| `--json` | print one JSON document: `specId`, `target`, `runs`, `deterministicClaim`, `identical`, `hashes` and `firstDifference` when they differ |

## Targets from settings

Beside the two Acme example targets, the command line reaches three kinds of agent from settings alone, with no code and no plugin. The settings are the spec's `target.options`:

```yaml
target:
  adapter: http
  agent: my-bot
  options:
    url: https://bot.example.com/turn
    headers_env: { authorization: MY_BOT_TOKEN }
```

| Target | Reaches | `target.options` | Without options (as with `--target`) |
|---|---|---|---|
| `http:<agent>` | an endpoint that speaks the [http adapter](adapters/http.md)'s JSON | `url` (needed), `headers`, `headers_env` (header name to the environment variable that holds its value), `end_state_url`, `close_url`, `timeout_ms`, `max_tool_rounds`, `redirects`, `variants`, `tool_stubs`, `deterministic` | `DRIFTBENCH_HTTP_URL` gives the URL |
| `litellm:<model>` | a model behind a LiteLLM proxy or any OpenAI-compatible endpoint, through the [litellm adapter](adapters/litellm.md) | `base_url` (needed; the request goes to `<base_url>/chat/completions`), `model` (default: the agent name of the target), `api_key_env` (default `LITELLM_API_KEY`, then `OPENAI_API_KEY`), `system`, `max_tokens`, `max_steps`, `timeout_ms`, `deterministic` | `LITELLM_BASE_URL`, then `OPENAI_BASE_URL`, give the endpoint |
| `nexus:<agent id>` | an agent on the Nexus platform, through the [nexus adapter](adapters/nexus.md) | `timeout_ms`, `generate_timeout_ms`, `keep_conversations`; the spec's `target.deployment` is needed | the key is always read from `NEXUS_API_KEY` |

A key is never written in a spec: `headers_env` and `api_key_env` name the environment variable that holds it. Specs and target settings are stored as run inputs. Credential header names, URLs with userinfo or credential query fields, and settings containing a resolved key are refused before storage. Keep other secrets out of arbitrary spec content too. Use the URL environment variable when its query contains credentials.

**Error-path guarantee:** by default, every non-success response and transport failure suppresses upstream bodies, headers and thrown details. Diagnostics keep the status, a fixed adapter message, the request host (no userinfo, path, query or fragment), and the body length in bytes when available. The retry policy still receives numeric status and parsed retry delay. All three targets accept `debug_error_body: true`: this is **unsafe**, off by default, and permits the upstream error body to appear in output and storage. Use it only with non-sensitive test data; never enable it with real credentials. Transport exception details and headers remain suppressed even with this option.

Successful replies are content and are stored. Redaction is **best effort**, not a guarantee against arbitrary encodings: the adapter scans text, raw content, tool payloads and end states for its keys and `headers_env` values, in literal, percent-encoded, base64, base64url and hex forms, with or without padding, including encoded `Bearer <key>` forms and all 16 ordered two-level compositions of percent, base64, base64url and hex. Keys split across fields, deeper compositions and unlisted encodings can remain in results. Use a test-scoped key and treat the results store and cache as sensitive. Matches become `[redacted]` before checks, output, SQLite and cache writes. The block's `observed.raw.redactions` counts replacements across its returned fields, including repeated copies of text in segments and tool payloads. Echoed request headers are removed; echoed URL metadata loses userinfo, query and fragment. New cache keys prevent replaying entries made before this guard; existing stores are not rewritten.

These targets do not follow redirects, as the judge calls do not ([retries](retries.md)). A redirect to another origin is always refused: neither the request nor a key header goes to a host the spec did not name. A 307 or a 308 on the same origin is followed only when the `http` target says `redirects: same-origin`. A refused redirect fails the block with the reason. A `litellm` target takes its system prompt from `campaign run --prompt` when one is given, else from `system`. One adapter is made per target name in a campaign, so two specs that name `http:my-bot` share the options of the first.

A target with a missing setting is refused with exit 2 and the setting to give: `No adapter is set up for http:my-bot. An http target needs its URL: set target.options.url in the spec, or DRIFTBENCH_HTTP_URL.` A [plugin](plugins.md) that registers `http`, `litellm` or `nexus` replaces the built-in target of that name. [`examples/http-target`](https://github.com/achammah/driftbench/tree/main/examples/http-target) runs an `http` target against a stand-in server.

## Project config and the pull-request gate

`driftbench.yaml` in the working folder, or the file `--config <file>` names, is the project config. `campaign run`, `campaign plan`, `report`, `ci` and `view` read it. It has four keys, all optional:

| Key | Read by | Holds |
|---|---|---|
| `aggregates` | `report`, `ci` | the campaign-level criteria, one `name:op threshold` string each |
| `scales` | `view` | per criterion, the `min` and `max` of the score a reviewer may give its queue item, with `min` below `max`. A criterion without one keeps 0 to 1 |
| `campaign` | `campaign run`, `campaign plan`, `ci` | the settings of a campaign, each the flag of `campaign run` it names; see [the campaign key](#the-campaign-key) |
| `plugins` | every command | modules of your own code to load before the command runs: paths relative to the file, or package names; see [CLI plugins](plugins.md) |



```text
aggregates:
  - pass-rate:>=0.8
  - broken-share:<=0.2
scales:
  holds_instructions: { min: 1, max: 5 }
```

Each entry is one `name:op threshold` string, the same syntax as `--aggregate`. A flag with the same name replaces the file's entry, and a flag with a new name adds to it. Any other key, or a bad entry, exits 2 and names the line. The file is optional: without it, only the flags count. See [campaign-level criteria](aggregates.md).

To gate a pull request, `driftbench ci` runs as a GitHub Action: [action/action.yml](../action/action.yml) takes the specs, the target, the baseline and the `aggregate` input, and fails the job unless the verdict is parity. Its `process-command` input passes `--process-command`, so the action gates your own process agent. A workflow that uses it is in [examples/acme/ci/driftbench-ci.yml](../examples/acme/ci/driftbench-ci.yml).

### The campaign key

Every field and its accepted values are in the [campaign configuration reference](reference/campaign.md).

`campaign:` declares a campaign in the file instead of on the command line. Each setting is a plain mapping onto one flag of `campaign run`, so the file and the flags mean the same thing:

| Key | Flag | Holds |
|---|---|---|
| `specs` | the `[paths...]` argument | spec files or folders; used by `campaign run` when the command line names neither paths nor `--dataset` |
| `dataset` | `--dataset` | a dataset version of the store, `name` or `name@version` |
| `prompts` | `--prompt`, once per item | prompt versions of the store to record |
| `targets` | `--target`, once per item | the targets every spec runs on |
| `routes` | `--route`, once per item | targets by spec tag, each `tag=target` |
| `modes` | `--mode` | a list of `T`, `F` and `P` |
| `repeats` | `--repeats` | runs per spec, target and mode |
| `agent_version` | `--agent-version` | the version of the agent under test |
| `store` | `--store` | the store file |
| `cache` | `--no-cache` when `false` | `campaign run` only |
| `cache_suite` | `--cache-suite` | the cache suite of the campaign |
| `concurrency` | `--concurrency` | cells that run at the same time |
| `budget_usd` | `--budget-usd` | a hard stop on the spend |
| `process_command` | `--process-command` | the command of a process target |
| `driver`, `personas`, `recordings`, `model` | `--driver`, `--persona`, `--recording`, `--model` | the simulated user; `model: true` is a paid call |
| `agent_family`, `judge_families` | `--agent-family`, `--judge-family` | the model families of the agent and of the judges |
| `retry` | `--retry-attempts`, `--retry-base-ms`, `--retry-max-ms` | `max_attempts`, `base_delay_ms` and `max_delay_ms`, named as in a spec's `target.retry` |

The rules:

* A flag given on the command line wins over the file, flag by flag. A list flag such as `--target` replaces the file's whole list.
* What to run comes from one place: the paths or `--dataset` of the command line when it gives one, else the file's `specs` and `dataset`.
* Paths in the file are read from the working folder, as the same paths on the command line are.
* `campaign plan` takes the settings it has a flag for: `targets`, `routes`, `modes`, `repeats`, `budget_usd` and `store`. Its spec paths stay on the command line.
* `ci` takes the run settings it shares with `campaign run`: `routes`, `modes`, `repeats`, `concurrency`, `budget_usd`, `process_command` and `agent_version`. Its `--specs`, `--target`, `--baseline` and `--store` stay on the command line, and its cache stays off unless `--cache` is given.
* The settings of one run are not in the file: `--campaign`, `--change`, `--from`, `--audit`, `--audit-seed`, `--max-carry`, `--max-age` and `--json`.
* A file with no `campaign:` key changes nothing. A `campaign:` key with an unknown setting or a value that does not fit exits 2 and names the setting, such as `driftbench.yaml: campaign.repeats`.

[`examples/acme/ci/campaign.yaml`](../examples/acme/ci/campaign.yaml) declares the Acme campaign: the conversation specs on `function:acme-sales`, modes T and F, two repeats.

```
$ pnpm -s driftbench campaign run --config examples/acme/ci/campaign.yaml --store acme.db
...
24 cells: 24 pass, 0 fail, 0 failed. Spent $0.00.
$ pnpm -s driftbench campaign run --config examples/acme/ci/campaign.yaml --mode F --repeats 1
...
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

## Run events

The runner reports each run as it happens through the `onEvent` option: a block starting, each model call the adapter reported (its input and output tokens, its cost in USD when the adapter gives one, and its latency; the call began latencyMs before the event), each tool call the adapter recorded, each retry a block took, a block ending with its verdict, and the run ending. `eventLogSink(path)` appends each event to a JSON-lines file synchronously, so a run killed mid-way keeps every event written before the kill; `readEventLog(path)` reads them back and skips a line cut short by the kill.

A run resumes from its first unfinished block. Blocks the cache holds are read back, and the first block it does not hold goes to the adapter, which opens a session from the history so far; no later cached block is read back, because the live session carries the run from there. A run that was killed mid-way and resumed gives the same verdicts as an uninterrupted run when the adapter keeps no state between blocks. For an adapter with state (an agent that stores what it did, such as a record it wrote), the state of the finished blocks is not recreated: the resumed run then reflects the adapter as it is at the resume, not as it was at the kill.

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `campaign plan` | the plan printed | | bad input |
| `campaign run`, `campaign resume` | every cell passes | a cell fails, failed, or was stopped, the budget included | bad input |
| `campaign status` | every cell passes | any other state | bad input, an unknown campaign, or a store with no campaign |
| `smoke` | the transcripts are identical and every run completed | the transcripts differ, or a run did not complete | bad input |

Bad input is an unknown or malformed target, a target no adapter is set up for, a spec with no target when no `--target` is given, an invalid spec or none found, an unknown mode, a bad number for an option, an existing campaign id on `run`, or a store that cannot be opened. `smoke` takes exactly one spec.

```
$ pnpm -s driftbench campaign plan examples/acme/specs --mode X
Unknown mode "X". The modes are T, F and P, alone or separated by commas.
```

## Campaigns

A campaign pins the specs by id and content hash, the target of each spec run on its own target, the targets, the modes, the repeats and the budget. It is created once; a run again is a new campaign, and `resume` completes the same one.

### Cells

`planCampaign` expands specs, targets, modes and repeats into cells. In mode P a spec gives one cell per perturbation and repeat. A cell sends the spec's blocks, plus the injected block in mode P, except for a perturbation that writes only a world: it runs under its own block, so the cell sends the spec's blocks alone (`order-service-down` and `sales-queue-down` above).

A cell's id is also the run id of its run: the first 16 hex characters of the SHA-256 of the canonical JSON of the spec hash, the target, the mode, the repeat and the perturbation. The campaign plays no part, so the same cell in two campaigns has the same id: `acme-plan-upgrade` in mode F at repeat 0 on `function:acme` is `cc92cc9eb562f586` in every Acme campaign above.

### Outcomes

Each cell ends in one state:

| State | Mark | When |
|---|---|---|
| `pass` | `✓` | the run completed, it has blocks, every block passed, and the end state matched |
| `fail` | `✗` | the run completed, and a block failed or the end state differs |
| `not_run` | `-` | the run completed with no failure, but a block was not run: its Given carries a layer the target cannot apply |
| `blocked` | `-` | the run completed with no failure, but a block was blocked: an ancestor it depends on failed |
| `failed` | `!` | the run ended with an error |
| `stopped` | `!` | the run stopped: the driver did not stop in time, or the budget stopped the cell before it started |
| `pending` | `·` | the cell has no run yet, in `status` |

A block is `pass`, `fail`, `not_run` or `blocked`. The last two are not measurements: the block was not sent, it has no verdicts, its `pass` field is false, and every pass rate (the scorecard, `stats`, `compare`, `ci`, the JUnit file, where a run is `skipped`) leaves it out and prints its count beside the rate. Before it sends a block, the runner checks that the target can apply every layer of the block's Given: a `prefix` needs `seedPrefix`, a forced tool result in `world.tools` needs `toolStubs`. A Given error the verifier finds (`spec lint` warns `GIVEN_UNMET` on it) makes the block `not_run` with kind `given_unmet`, and a seeded workspace file that does not read back as written after setup makes it `not_run` with kind `setup_failed` (check `world_digest`). A layer the target cannot apply makes the block `not_run` with kind `unsupported` (the `capability` check) and its `notRun` record names the layer, the check, what was expected and what the target declares. In modes F and P every later block is then `not_run` too and the end state is not compared; in mode T each block is checked alone. In mode T a block after the first starts from the canonical history the runner builds from the blocks before, which also needs `seedPrefix`: on `nexus` and the live Claude Code adapter those blocks are `not_run`. A carried result or a re-judge never turns such a block into a pass: a run with one is not carried, and a re-judge leaves the block as it was. Every command that prints a pass or a fail per spec (`replay`, `estate live`, `simulate`, `perturb`, `family verify`, the vitest plugin) prints such a spec or block apart with its reason, and every rate says how many runs it left out. A block record whose `pass` and `status` disagree (a `status` of `pass` with `pass` false, or any other status with `pass` true) is refused when it is written and when it is read back; a block with no `status` is a pass or a fail as `pass` says.

A cell's line notes `reused` when a completed run of the cell was already in the store, and `replayed from the cache` when its run came from the cache. The summary line counts each state, the cells the budget stopped, the reused cells, and the money spent by the runs of this command.

### The worker pool

`runCampaign` runs the cells on a pool of workers, 4 by default and never more than the cells. Each worker takes the next cell: the T and F cells in cell order first, then the P cells. A P cell waits for the F run it takes as its reference when that run is still in flight. A cell whose completed run is already in the store is reused without running. Each run is filed in the store as it finishes, so a crash loses no finished run. The outcomes, and the lines the command prints, come in cell order: a cell is reported once it and every cell before it have an outcome. When running a cell throws, no new cell starts, and the error is raised once the cells in flight finish.

`runCampaign` passes the artifact readers it is given to every run; the command line gives it the readers of `@agent-nexus/driftbench-artifacts`.

### The budget

`--budget-usd` is a hard stop on spend, in US dollars, over the whole campaign. The spend is the cost of the campaign's runs already in the store, plus the runs finished in this command. A run replayed from the cache costs nothing. A worker checks the budget when it takes a cell: once the spend has reached the budget, the cell is stopped and never starts. Cells already in flight finish, so the spend can pass the budget by the cost of those cells.

The budget counts what the target adapter reports; simulated-user and judge calls are not counted.
The CLI prints this notice on stderr when a budget is set and a simulated user or a model judge is used, including with `--json`.

Token-only adapters need a user-supplied price to make this stop meaningful. Put `prices:` in
`driftbench.yaml`, or pass `--prices <file>` to `campaign run` or `campaign resume`.
The standalone file contains the table below without the outer `prices:` key; it takes precedence over the project file.
`ci` reads the same project `prices:` key, including its `--config` file.

This example is **fictional**, including its model and rates. No vendor prices are bundled.
Replace it with prices you verify for your model and the date you verified them:

```text
prices:
  as_of: '2026-10-13'
  models:
    fictional-model:
      input: 2
      output: 4
      cached_input: 0.5
```

All rates are finite, nonnegative USD per million tokens; an explicit zero rate is allowed.
All three rates and the valid `as_of` date are required. Negative, nonnumeric and missing rates are refused at load time.
The exact lookup key is the adapter's aggregate `cost.model`, then a unique model named in segment costs, then the spec's `target.options.model`.
Set that target option explicitly when the adapter does not report its model. Segment usage may name its own model; otherwise it inherits the block model, then the target model.
Model-only segment metadata identifies aggregate tokens without replacing their usage. Ambiguous aggregate models or incomplete segment accounting stop a budgeted run.
`inputTokens` includes `cachedInputTokens`; cached input is subtracted before applying the regular input rate.
Adapters that report cache reads separately must include those reads in their input total.
The estimate is `((inputTokens - cachedInputTokens) * input + cachedInputTokens * cached_input + outputTokens * output) / 1000000`.
Reported dollars, including zero, take precedence. Aggregate usage is priced once; segment-only usage is summed without counting it twice.

With a budget, every declared target model is checked before the campaign sends anything, including targets in later cells.
All missing model names appear in one error with instructions to supply prices. This preflight requires a price for each declared model even if the adapter normally reports dollars.

When a model only becomes known at runtime, the first block that reports tokens without a price stops the run and closes its session.
This case costs one call before the error is detected. Tokens with no resolvable model also stop the run; they never count as zero.
The CLI exits 2 and names the model (or the missing identity) and how to supply prices.
No further cell starts after the error is observed. Other cells already in flight can finish.
Without a budget or prices, token accounting behaves as before. A price table can also estimate costs without setting a budget.
On resume, old stored token-only observations are priced before the budget check; keep the price file available when resuming.
The prices do not estimate unreported usage, and they do not change the worker pool's existing cell-level stop or reserve in-flight spend.
`campaign plan` still projects from measured units in the store, not this table.

From code, pass `prices` to `runCampaign` or `runSpec`. `runCampaign` requires prices for token-only
observations whenever `budgetUsd` is set; a direct `runSpec` caller can request the same guard with `requireTokenPrices: true`.
An unknown price raises `TokenPriceError`.

The campaign record stores a budget of 0 when none was given. `resume` reads a stored 0 as no budget.

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --repeats 2 --budget-usd 0
Campaign c-7572a9cb7069: 2 cells, 4 at a time. Budget $0.00. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
! acme-plan-upgrade · function:acme · F · repeat 0  stopped  not started: the campaign spent $0.00 of its $0.00 budget
! acme-plan-upgrade · function:acme · F · repeat 1  stopped  not started: the campaign spent $0.00 of its $0.00 budget
2 cells: 0 pass, 0 fail, 0 failed, 2 stopped by the budget. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

That command exits 1.

### The minimum detectable effect

`campaign plan` prints the smallest drop in pass rate that a comparison of two arms can detect, as `mde` of the statistics library solves it: the two-proportion power equation at a two-sided alpha of 0.05 and a power of 0.8, with the specs as the independent units and the repeats of one spec counted through the design effect.

```
design effect = 1 + (repeats - 1) * rho
effective units per arm = specs * repeats / design effect
```

`--baseline-rate` is the baseline pass rate (default 0.5) and `--rho` the correlation of repeats of one spec, as `icc` measures it (default 0, which counts repeats as independent and so is optimistic). The line names the runs per arm, the specs, `rho` and the design effect. When each spec runs on its own target, one arm is every spec on its first target. At six specs of five repeats, a 90% baseline and `--rho 0.3`, the design effect is 2.2. When the campaign is too small to detect any drop below the baseline, the line reads `none detectable`. See [statistics](concepts/statistics.md).

### The store

`@agent-nexus/driftbench-store` keeps specs, campaigns, runs with their blocks, the cache and measured cost units in one SQLite file; `--store <file>` opens or creates it. It lists its campaigns newest first, which is how `status` and `resume` find the latest. `exportCampaign(campaignId, dir)` and `campaign export <campaignId> --store <file> --out <dir>` write a bundle with the campaign, its runs, specs and recorded dataset and prompt versions. `campaign import <folder> --store <file>` checks the hashes and imports the bundle all or nothing. Cost units are recorded through the store's `putUnit`; nothing records them during a run yet, so a projection prices only the units put there.

## `runSpec`

`runSpec(spec, options)` of `@agent-nexus/driftbench-core` runs one spec, once, and returns its run record. The command line calls it for every cell. From code it reaches any adapter:

```ts
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { blockStatus, loadSpecFile, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { createAcmeAgent, createStore } from './examples/acme/src/index';

const adapter = functionAdapter({
  create: () => {
    const store = createStore();
    return { store, agent: createAcmeAgent(store) };
  },
  respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
  payloads: (session) => session.store.payloads,
  deterministic: true,
});

const loaded = await loadSpecFile('examples/acme/specs/conversations/plan-upgrade.yaml');
if (!loaded.ok) throw new Error('the spec is invalid');

const run = await runSpec(loaded.spec, {
  adapter,
  driver: createScriptedDriver(),
  checks: defaultChecks(),
  mode: 'F',
  repeat: 0,
});
console.log(run.runId, run.status, run.blocks.map(blockStatus), run.endState?.match);
```

Run from the repository root, it prints:

```
a66a7aba9986a136 completed [ 'pass', 'pass', 'pass', 'pass', 'pass' ] true
```

With `mode: 'T'`, it prints:

```
6a402b958212918e completed [ 'pass', 'pass', 'pass', 'pass', 'pass' ] true
```

| Option | Meaning |
|---|---|
| `adapter` | the adapter that reaches the agent |
| `driver` | decides each block's stimulus. `createScriptedDriver()` of `@agent-nexus/driftbench-users` replays the spec's blocks in order and stops after the last. `createPerturbingDriver({ spec, perturbation })` of `@agent-nexus/driftbench-users` injects one deviation into the scripted steps (the CLI's P cells); `injectingDriver(base, perturbationId)` of `@agent-nexus/driftbench-core` adds one of the spec's perturbations to the steps of `base`. |
| `checks` | applied to every block, in order, such as `defaultChecks()` |
| `mode` | `T`, `F` or `P`. T runs every block from its canonical Given in a session of its own; F runs one session; P is F with the blocks a driver injects. See [run modes](concepts/run-modes.md). |
| `repeat` | the repeat number, part of the run id and of the cache key |
| `target` | overrides the spec's target. With neither, the target is `{ adapter: <the adapter's id> }`. |
| `perturbationId` | the perturbation the run injects, recorded on the run |
| `reference` | mode P: the free-running run of the same spec and target, for the collateral of the recovery |
| `consequential` | mode P: a test that names more tools whose call is a consequential act, for the safe action and the clarification |
| `store`, `campaignId` | where the finished run is filed. A store needs a campaign id, and the campaign must be in the store. |
| `cache`, `cacheTtlMs` | where observed blocks and end-state reads are kept, and for how long. Without a cache, every block reaches the adapter. |
| `artifacts` | the readers the artifact checks use, such as `defaultReaders()` of `@agent-nexus/driftbench-artifacts` |
| `retry` | the run's [retry settings](retries.md), over the spec target's `retry`: `maxAttempts` (or `retries`, attempts minus one), `baseDelayMs`, `maxDelayMs`, `jitter`, `retryAfter`, and `sleep` and `random` for tests. Defaults: 4 attempts, 500 ms, 30000 ms, jitter on, Retry-After honoured. |
| `now` | the clock |
| `runId` | default: the cell id |
| `maxSteps` | a guard against a driver that never stops. Default 4 steps per spec block, at least 16. |

### One block

For each step the driver gives, the runner:

1. resolves the block's Given. In mode T it closes the open session and starts from the block's canonical Given; on an adapter with a sandbox it keeps the session, so the block starts from the workspace the block before left, and replaces the history with the canonical prefix, unless the block writes its own `given.world.workspace`; a step the driver injects fails the run;
2. appends the block's user messages to the session history, and sends the block through the adapter, opening a session first when none is open;
3. reads the block again through `trace` when the adapter offers it, and keeps that read;
4. checks the Observed as JSON against the schema, the form the cache and the store keep, and appends the agent's reply to the history;
5. adds the block's `ledger_add` facts to the ledger;
6. after the last spec block, reads the end state; in mode T, after every block;
7. applies every check. In mode T the checks see no earlier block;
8. reads the stage the block reached and adds the flow verdicts of the [stage classifier](concepts/drift.md#the-stage-classifier), then the verdicts of the [ledger check](concepts/drift.md#the-ledger-check);
9. records the block, with its drift classes.

A block passes when every gating verdict passes, the flow and ledger verdicts included.

### Given resolution and the hash

The run starts from the spec's `given`: its ledger, world and vars. A block's own `given` merges into them from that block on: tools, store keys, fixtures, variables and facts by name, the later value winning, and a later workspace replacing the earlier one whole. The world of an injected perturbation merges the same way.

A block's `given.prefix` ends the open session: the next send opens a new one, whose history is that prefix. The block's `given.origin`, when it writes one, holds from that block until a block writes another prefix. It covers the messages that prefix holds, not the turns a run or a mode T replay adds after them: the resolved Given carries their count as `originLength`. It stays out of the Given hash, since the spec the hash covers already decides it, but the block cache key reads the whole resolved Given, so it is part of that key: an adapter can act on it (crewai does), and a cache entry stands for what the adapter received.

In mode T every block opens its own session from its canonical Given: the ledger, world and vars the spec writes up to that block, and a prefix of the earlier blocks as the spec writes them. On an adapter with a sandbox, a block that writes no `given.world.workspace` of its own keeps the session of the block before, with the canonical prefix as its history, so a task step finds the files the step before made. See [run modes](concepts/run-modes.md#teacher-forced).

The resolved Given of a block holds the prefix (the run's history before the block), the ledger, the world, the vars and the target, and `hash`: the first 12 hex characters of the SHA-256 of the canonical JSON of those five. When the spec states the prefix's `origin`, the resolved Given holds it too and it joins the hashed fields; without it, the hash is the one of the five. The block record keeps it as `givenHash`. See [Given, When, Then](concepts/given-when-then.md).

### The history

The runner owns the session history. Before a send it appends the stimulus's user messages: one for `user`, one per message of a `burst`, the injected message for an injection. After the send it appends the agent's reply: the text, and each tool call with its input and its output or error. The history before a block is the prefix of that block's Given, so in modes F and P the agent's own earlier replies carry into every later block. In mode T the history is the canonical prefix, never the agent's own replies.

### End state

The runner reads the sources the spec's `end_state` names, each once, through the adapter's `endState`: each mapping's `source`, or `*` for `end_state: none`. It reads them after the last spec block, and the checks of that block see the result: the value a mapping's source returned, a record keyed by source for a list, the list of every payload for `none`. In mode T it reads them after every block and composes them: a source keeps the last value a block's session recorded, and `*` joins the lists.

Every run of a spec that names an end state carries `endState` in its record, failed and stopped runs too: `match`, and a `diff` with one entry per field that does not hold. When the end state was read, the run also carries `endStateValue`, what the checks saw (`null` when the source recorded nothing); it is absent when no read happened and in runs stored before the field existed. The generator gate compares it between sibling specs (see [generating](generating.md)). The runner uses the read taken after the last spec block when no block ran after it, and reads again at the end of the run otherwise.

| Case | Diff entries |
|---|---|
| a field that does not hold | `{ field, expected: <assertion>, observed: <value> }`; in a list the field is named `<source>.<field>` |
| a source that recorded nothing, or a state that is not a mapping | one entry per expected field, observed `{ absent: true }`, absent assertions included |
| an empty `expect` and nothing recorded | `{ field: <source>, expected: { nonempty: true }, observed: { absent: true } }` |
| exact mode, a field the spec does not list | `{ field, expected: { absent: true }, observed: <value> }` |
| `none`, with payloads recorded | one entry per payload, field `*.<index>`, expected `{ absent: true }` |
| a read that cannot happen: no block ran, the adapter reads no end state, or the read failed | one entry per source, saying why; `match` is false |

An absent value is always written `{ absent: true }`: undefined does not survive JSON, and the stored run keeps the key. In mode P the spec's end state describes the unperturbed run, so it is neither read nor compared.

### Drift

The runner gives every block its drift classes from the gating verdicts it fails, by the family of each verdict id (the text before the first dot): `ledger` gives `X2_contradiction`, `stage` and `flow` give `X3_flow`, and so on for all five classes. The full map is on the [drift](concepts/drift.md#how-a-class-is-assigned) page. A custom check never takes a class by its name, and a block that fails only non-gating or inconclusive verdicts carries none.

### Status, errors and retries

A run ends `completed`, `failed` or `stopped`.

* An `AdapterTransportError` with a 408, a 429, a 5xx or no status (a network failure) is retried under the [shared retry policy](retries.md): 4 attempts by default, a backoff from 500 ms with full jitter, at least the server's Retry-After. Each retry is recorded in the block's Observed as `retries`. Past the attempts, or on one marked `exhausted` by the adapter, the run fails.
* An `AgentFailure`, an Observed that does not match the schema as JSON, or any other error fails the run at once.
* A driver that does not stop within `maxSteps` steps stops the run.

The record keeps the blocks that ran, the error, and a note when a session could not be closed or a block could not be cached. The session is always closed.

### The cache and replay

The cache key of a block is the SHA-256 of the canonical JSON of the spec hash, the repeat, the block's position in the run, its whole resolved Given (the history so far included, read as its own SHA-256 of the canonical JSON, kept from block to block, so a block hashes the messages it adds), its stimulus, the target, and the adapter's id and version. An end-state read is cached under the key of the block it follows and its source. The spec's `version` is a free label and plays no part. When supplied, the agent version (`--agent-version` on the command line, `agentVersion` in runner options) is included as well. Without an agent version, the cache cannot see an agent change behind the same target and adapter identity. Bump the label when the agent changes, or use `--no-cache`. An absent agent version preserves the earlier key format.

The process adapter reports version `0.1.0`. Its separate `cacheIdentity` holds a SHA-256 digest of its command and arguments; the block cache key and opt-in execution provenance read this field. Changing either changes the cache identity; changing the contents of the same binary or script does not. Adapters without this optional field keep their existing cache keys. Process runs use sandboxes and remain uncached.

With a cache, the runner first replays the run from it. Any block or end-state read the cache misses sends the whole run to the adapter instead, and every block it observes goes into the cache. A replayed run has `cacheHit: true` and costs nothing against a budget. A run on an adapter that makes sandboxes is neither replayed nor cached: a replay has no workspace to read files from, so its artifact checks could not open them.

On the command line the store is the cache. A second campaign over the same specs and store replays every run:

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --store acme.db
Campaign c-868fb474970f: 12 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass (replayed from the cache)  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass (replayed from the cache)  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

`--no-cache` turns the cache off for one command, and `smoke` never uses it.

### The run record

The runner returns the run as the store keeps it: written as JSON, read back and validated against the `RunResult` schema in `packages/core/src/schema/run.ts`.

* The run: `runId`, `specId`, `specHash`, `target`, `mode`, `repeat`, `perturbationId`, `status`, `error`, `blocks`, `succession`, `recovery`, `endState`, `endStateValue`, `cost`, `latencyMs`, `startedAt`, `finishedAt` and `cacheHit`, and `carried` on a run a radius campaign copied from an earlier campaign (see [blast radius](concepts/blast-radius.md#fresh-and-carried)). `cost` sums the blocks' costs: each block's total, or else the sum of its segments' costs.
* Each block: `index`, its position in the run, injected blocks included; `blockId`; `injected`; `realized`, present only when the driver sent other text than the spec block wrote (a simulated user, a red-team attacker): `hash`, the SHA-256 of the user messages the agent received joined by newlines, and `text`, those messages, only when the run asked for it (`campaign run --record-realized-text`, `recordRealizedText` in code), since what a driver writes may be private. Only the text is compared: the same text sent in another form, such as an injection, records no `realized` (`injected` says so). Copies into another campaign follow the destination’s opt-in: whole-run carries, block reruns and re-judging strip `realized.text` unless the new campaign requests it. Store writes and imports enforce the campaign’s setting too; exports strip legacy hash-only records. Stripping records `realizedTextStripped` (source `fromRun` and, when known, `fromCampaign`) on the copied run or block and recomputes its provenance digest. Missing text is never reconstructed. The provenance digest covers `realized` and stripping provenance; `givenHash`; `observed`; `verdicts`; `stageObserved`, the stage the block reached (the runtime's report in this block, else in F and P the last one an earlier block reported, else the stage classifier's); `ledgerCheck`; `drift`; `pass`.
* `succession`: `firstDriftBlock`, `driftCount`, `driftRate`, `longestClean` and `minOverBlocks`, over the blocks of the run. A failing block is a drift block. See [drift](concepts/drift.md).
* `recovery`, on a P run whose perturbation writes `recovery`: `injectedAt`, `turnsToRecover`, `label`, `collateral`, `safeAction` and `clarified`. See [recovery](concepts/recovery.md#recovery-metrics).

`ledgerCheck` lists the contradictions the ledger check found in the block, and the facts a block's `ledger_add` gives a value other than the one the ledger already holds. The ledger check's verdicts decide whether the block passes; a `ledger_add` that changes a fact does not.
