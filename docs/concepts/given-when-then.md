# Given, When, Then

Every block is written in three parts.

* Given: the initial conditions. The conversation so far, the facts established, the state of the world, the runtime variables.
* When: the stimulus. A user message, an instruction, several messages at once, or an injected deviation.
* Then: the expected output and state delta, under `expect`.

The same three parts hold for a conversational exchange and for a task step. See [block](block.md).

## Given

A spec sets Given in two places.

* `given` at the top of the spec: the default for every block. It holds `ledger`, `world` and `vars`.
* `given` on a block: the same three parts, plus `prefix`, the messages that come before the block, and `origin`, where that prefix comes from.

A block's `prefix` starts the block in the middle of a conversation, without replaying the blocks before it. In a free-running run, the block opens a new session from that prefix, and the blocks after it continue from there. The agent sees the prefix only on an adapter with the `seedPrefix` capability; on another, the block is `not_run` (the `capability` check), never run without it. See [adapters](../adapters/index.md#capabilities). The block's `ledger`, `world` and `vars` merge into the running state from that block onwards, in free-running and perturbed modes. In teacher-forced mode, every block starts from its own resolved Given. See [run modes](run-modes.md).

| Part | What it holds | Example |
|---|---|---|
| `prefix` | the messages before this block, with their tool calls | the greeting and the questions already answered |
| `ledger` | the facts the agent must hold | `customer_type: existing` |
| `world.tools` | a forced result, error or latency per tool, from this block on | `lookup_plans: { error: timeout }` |
| `world.store` | a seeded store | an account record |
| `world.workspace` | the files the agent starts from: a folder (`from`) or inline `files` | two CSV files |
| `world.fixtures` | free fixtures | a price table |
| `vars` | runtime variables | the clock, the channel, the sender |

An adapter applies `world.tools` only when it has the `toolStubs` capability; on another, a block with a forced tool result is `not_run`. See [adapters](../adapters/index.md#capabilities).

### Tool history: records, not prose

A fact the agent learnt from a tool belongs in the prefix as a tool call with its `output`, never only in the assistant's text. The two are different tests. In an experiment on a sales agent (15 blocks, each run 30 times per arm), the agent that read an earlier result only in its own prose called the tool again in 332 of 450 runs, and the one that read the recorded call in 0 of 450; on the three lead blocks it filed the same callback request a second time in all 90 prose runs. `spec lint` warns with `PREFIX_PROSE_HISTORY` when an assistant message of a prefix states a ledger fact that no recorded call of the prefix holds and the user never said.

The lint reads the ledger values of the spec's `given` and of each block's `given` up to the block. It also reads the `ledger_add` of the blocks before it. It matches a value as a whole word, without case. The value must not touch a letter or a digit on either side: `EN` is not found in `OPEN`. The lint leaves out a fact when:

* an assistant message states the value only inside a longer word;
* a tool call in an earlier message of the prefix holds the value in its input, output or error;
* a tool call in the same message holds the value;
* a user message before the assistant message holds the value.

`origin` says where a prefix comes from:

| Value | Meaning |
|---|---|
| `authored` | a person wrote it |
| `recorded` | it is copied from a real run, its tool calls with the results the tools really returned; `import traces` writes it |
| `canonical` | it is the replay of a spec as written: the calls the blocks expect, with the results the world forces |

`origin` is optional and needs a `prefix` on the same block (`GIVEN_ORIGIN_WITHOUT_PREFIX` otherwise). It holds for the blocks after it until a block writes another prefix. It enters the Given hash and the spec hash only when present, so a spec without it keeps its hashes, and results with different origins are never pooled: a report and `compare` key results on the spec hash.

```yaml
- user: What is my callback reference?
  given:
    origin: recorded
    prefix:
      - role: user
        content: Can someone call me back about fiber?
      - role: assistant
        content: Done, an advisor will call you today.
        tool_calls:
          - id: call-1
            label: notify_sales
            input: { topic: fiber }
            output: { ref: LD-4471 }
  expect:
    must: [LD-4471]
    tools:
      - { label: notify_sales, count: 0 }
```

The facts grow block by block: `ledger_add` in a block's `expect` adds the facts that block establishes, and every later check sees them. The ledger check compares what each block states with them, in code; see [drift](drift.md#the-ledger-check).

For a task step, Given includes the workspace. The adapter that owns the workspace takes a snapshot of it before the step and a diff after; see the [process adapter](../adapters/process.md).

The runner resolves Given into one record per block (`ResolvedGiven`): the prefix, its origin when the spec states one, the ledger, the world, the vars, the target agent and a hash of all of them. The prefix is the run's history before the block. The block's record keeps the hash, and the cache key holds the whole resolved Given. See [running](../running.md#given-resolution-and-the-hash).

### Parent blocks

A block may set `parent: <block id>` to start from that block's **recorded end state** in the same spec. The runner orders dependencies before children, including forward references. `PARENT_MISSING` and `PARENT_CYCLE` are spec errors.

Once a spec declares a parent link, its blocks form a forest in every mode: each root starts at the spec defaults, and a child inherits only its ancestors. Specs without parent links retain their sequential F/P and canonical T behavior. A child's prefix includes the parent's actual reply and tool calls with recorded results/errors, using the same tool-history compiler as an authored prefix. Its ledger includes facts established by the parent. World and variables are copied, so siblings cannot change each other's start. The child's own Given then merges ledger, world and variables by key; `given.prefix` replaces the inherited conversation. A child's own `world.workspace` replaces the inherited workspace whole: none of the parent's files carry then, only the ones the child names.

A passed parent runs once per run, however many children share it. Child-only mode T selection automatically replays its ancestors when no in-run recording exists. A replayed ancestor gives its end state and its cost, but it is not a measurement of that run: it adds no block, verdict or count, and `blockRerun.reason` names it. Observed-cache replay reconstructs the same history from recorded observations. Partial carry reruns and re-judging conservatively request a full replay for a parent-linked spec, because their current input proof assumes independent T blocks.

If a parent fails, is `not_run`, or is already blocked, the child is `blocked`: it receives no agent call and adds no failure. `blocked.by` names its direct parent and `blocked.root` names the original failed or unrun cause. Independent roots continue. The report groups the blocked descendants under that root. A blast-radius change reaching a parent includes its descendants in every mode, even when they occur earlier in the YAML.

The runner records the world and variables it manages. An adapter with mutable private state can export its end state through `snapshotGiven(session)`, returning `{ world, vars }`; its `open(given)` must restore that exported state. The function adapter accepts a `snapshotGiven(state)` callback alongside `create(given)`. The runner takes a separate copy for each branch. Such runs bypass the observation cache, which cannot store private world snapshots. A sandbox must export its changed workspace too. The process adapter does: it reads every file the parent left (its protocol files aside), byte for byte. UTF-8 text goes into `world.workspace.files`; any other file, such as an xlsx, docx, pdf or png the agent produced, goes into `world.workspace.binary` as base64. The child's own sandbox is seeded from them, so siblings never share a folder. Without `snapshotGiven`, the children are `not_run: unsupported`, never silently seeded from the old files. When an export fails (more files than the adapter's `exportMaxBytes`, 50 MB in all by default), the children are `not_run: setup_failed` with the reason, and their descendants are blocked. What carries is the regular files, byte for byte, a UTF-8 byte-order mark included. Not carried: `.git` and `node_modules`, which the snapshot skips; empty folders; file modes. A link that points inside the workspace arrives as a plain copy of its target; a link that leaves the workspace fails the export. A seeded child also requires the adapter's `seedPrefix` capability.

See the [Acme worked example](../../examples/acme/parents/README.md), which runs both passing and blocked branches without a model call.

## When

| Form | Meaning |
|---|---|
| `user: <message>` | one user message, or one instruction to a task agent |
| `burst: [<message>, <message>]` | two or more messages that arrive together |
| `when: { injection: { class, user } }` | a deviation written into the blocks, with its class |

`user` and `burst` can sit on the block itself; the loader moves them under `when`. A block takes exactly one of `user`, `burst` and `when`.

A perturbation inserts a deviation before a chosen block at run time, in perturbed mode only, without editing the blocks. See [recovery](recovery.md).

## Then

`expect` holds the expected output and state delta. Every field is optional. A block with no `expect` checks nothing, and `spec lint` warns about it.

| Family | Fields |
|---|---|
| Stage and facts | `stage`, `ledger_add` |
| Text | `must`, `must_not`, `lang` |
| Tools, skills and guards | `tools`, `tool_order`, `skills`, `guards` |
| Files read and helpers | `references`, `subagents` |
| Channel | `cards` |
| Code and files | `execution`, `artifacts`, `workspace` |
| Safety | `safety` |
| Judged | `criteria` |

A block can also carry a `budget` for steps, cost and latency. Rules for the whole spec sit in `rules`, and the expected end state of the world in `end_state`. Each field, and the check that reads it, is in [checks](../reference/checks.md).

### Machine Then and judged Then

The fields that read observed state make the machine Then: `stage`, `tools` and `tool_order` (with `rules.max_calls` and `rules.forbidden_tools`), `cards`, `skills`, `guards`, `references`, `subagents`, `execution`, `artifacts`, `workspace`, `safety`, custom rules, and `end_state` on the last block. `must`, `must_not`, `lang`, `rules.lang_stable` and `rules.one_message_per_turn` read the agent's words. `criteria` are judged.

A block that `driftbench generate` writes carries a machine Then derived from the approved map of situations, never from an agent's reply: the stage the path reaches next, the tool calls and their inputs, the end state, and for a deviation the recovery the map gives. The gate rejects a block whose Then holds judged criteria only, and one whose Then reads only words when its cell is not about wording. The gate applies the same rule to a conversation block and to a task step. See [generating tests](../generating.md).

## One block of each kind

A conversational exchange. Given: the facts so far. When: the customer's choice. Then: the stage reached, a new fact and one tool call.

```yaml
- id: choose
  given:
    ledger: { customer_type: existing }
  user: The 500 one. Yes, go ahead.
  expect:
    stage: confirm
    ledger_add: { plan: fiber_500 }
    tools:
      - label: submit_order
        count: 1
        input: { plan: fiber_500 }
```

A task step. Given: a workspace that already holds the workbook. When: the instruction. Then: the workbook gains a sheet, and no other file changes.

```yaml
- id: summary
  given:
    world:
      workspace: { from: fixtures/after-build }
  user: Add a Summary sheet with the total of both regions.
  expect:
    artifacts:
      - path: sales.xlsx
        checks:
          - sheets: [North, South, Summary]
    workspace:
      changed: [sales.xlsx]
      others_untouched: true
```

Every field is listed with its type in the [spec reference](../reference/spec.md).
