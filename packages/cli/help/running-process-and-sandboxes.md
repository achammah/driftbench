---
title: Code agents, process targets and sandboxes
summary: Run a code-interpreter agent (any program that writes files and runs code) as a process target in a sandbox with --process-command. It covers what the sandbox seeds, records and limits. It also covers how the agent reports its commands, skills, guards and stages, and how workspace artifacts are checked.
commands:
  - campaign run
  - campaign resume
see_also:
  - running-targets
  - running-cleanup
  - running-sdk-adapters
  - running-cache
  - running-campaign-run
next:
  - running-sdk-adapters
---

## What it is

A process target runs your agent as a command, one process per block, inside a sandbox. The sandbox is a fresh temporary folder (the workspace) seeded with the files the spec gives. It is how driftbench tests a code-interpreter agent, one that writes and runs code, reads and writes files and loads skills. Before each block the sandbox snapshots the workspace. After the agent exits it snapshots again. The run then records which files were created, changed and deleted, and every file produced (the artifacts). It also records the agent's exit code and output, and the commands, skills, guards and stages the agent reports. Task specs (`kind: task`) check these with the `execution`, `workspace`, `artifacts`, `skills`, `guards` and `stage` checks. On the command line, `process:acme-ops` is the Acme ops agent; any other `process:<name>` runs the command you give with `--process-command`.

## When to use it

* Your agent is a program (a script, a binary, a code-agent harness) that you can start from a shell, and it works on files.
* You want to check produced files: workbooks, documents, slides, PDFs, CSV, JSON, text.
* For an agent behind a URL use an `http` target; for an SDK agent object use a plugin (topics running-targets-from-settings, running-sdk-adapters).

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--process-command <command>` | `campaign run`, `campaign resume` | none | the command behind every `process:<name>` target other than `process:acme-ops`. A JSON list of strings, such as `["python3","/abs/path/agent.py"]`, or words split on spaces with no quoting. It runs inside each sandbox's workspace, so give absolute paths. A relative path that names a file of the working folder prints a note on stderr and the run goes on. A binary with no slash is looked up on the `PATH`. Any agent name works: `process:<name>` names the agent, the command runs it. |
| `--target process:<name>` | `campaign plan`, `campaign run`, and the commands that take `--target` | the spec's own target | the process target to run. |
| `process_command:` | the `campaign:` key of the config | none | the same as `--process-command`. |

`smoke`, `simulate` and the other single-spec commands reach `process:acme-ops` but take no `--process-command`. A campaign stores its targets, not the commands behind them: resume it with the same `--process-command`.

The command line sets these for its process targets. It sets a local sandbox (a temporary folder; the agent runs as you, through `/bin/sh`, with weak isolation). For `process:acme-ops` it sets the CLI's own Node.js running `examples/acme/ops/agent.mjs`, declared deterministic. Every sandbox of a campaign sits in one folder per campaign, `driftbench-sandboxes-<random>` under the system temporary folder, removed when the command ends (topic running-cleanup). From code, `processAdapter` of `@agent-nexus/driftbench-adapters` also takes `dockerProvider({ image })`. It gives one container per sandbox, with no network by default, 1 GiB memory, 1 CPU, 256 processes and all capabilities dropped. `processAdapter` also takes `keep` (leave the sandbox on disk), `stimulus: 'file'`, `env` and `timeoutMs`.

## Inputs

* The spec's workspace seed (`workspace_seed:` or a block's `given.world.workspace`): files copied into the workspace before the first block. Later blocks add or change only what their Given adds; files the agent changed stay.
* The instruction of each block, on the agent's standard input.
* The environment of the agent process: only `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TERM` and `TZ` pass from yours, plus:

| Variable | Holds |
|---|---|
| `DRIFTBENCH_WORKSPACE` | the workspace path |
| `DRIFTBENCH_BLOCK` | the block's position in the run |
| `DRIFTBENCH_HISTORY_FILE` | `driftbench-history.json`: the session history as a JSON array of chat messages, ending with the current user turn |
| `DRIFTBENCH_COMMANDS_FILE` | `driftbench-commands.jsonl`, where the agent may append one `{"command": "...", "exitCode": 0}` per command it ran (optional `startedAt`, `latencyMs`) |
| `DRIFTBENCH_RUNTIME_FILE` | `driftbench-runtime.jsonl`, where the agent may append runtime events: `{"type": "skill", "name": "xlsx"}`, `{"type": "guard", "name": "...", "verdict": "pass"}`, `{"type": "stage", "name": "..."}` |
| `DRIFTBENCH_PROMPT_FILE` | `driftbench-prompt.txt`, the prompt text, only when `campaign run --prompt` is given |

Without the runtime file, the skill and guard checks are inconclusive on that block. The protocol files never count as artifacts.

## Outputs and how to read them

Each block of a process run records these items. The agent's standard output is its reply text. There is one execution record per reported command and a last one for the agent process (command line, exit code, standard error, latency). The block also records the workspace diff (created, changed, deleted), and each created or changed file as an artifact with its hash and size. It also records the runtime events, and the sandbox kind and isolation. The artifact checks open artifacts with the readers of `@agent-nexus/driftbench-artifacts`: `xlsx`/`xlsm`, `docx`, `pptx`, `pdf`, `csv`/`tsv`, `json`, and text files (`txt`, `md`, `yaml`, `xml` and similar).

Bounds: standard output and error are cut at 10 MiB each. A command is killed after 10 minutes (exit 124) with everything it started, or sooner when a block's `budget.latency_ms` says so. A file read returns at most 100 MiB. A snapshot stops past 20,000 files, 32 folder levels or 1 GiB, and never enters `node_modules` or `.git`. A non-zero exit of the agent is a recorded fact, read by the `execution` check, not a run failure. A command that cannot be found or started fails the run (`failed`) after the retries.

Process runs are never cached nor replayed (topic running-cache).

## Worked example

Three runs. First, the Acme price-sheet task on its own target, the ops agent. Second, the same agent through `--process-command` with a relative path, which the sandbox cannot see. Third, a command that does not exist. No model is called.

```sh
driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml
driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --target process:my-agent --process-command "node examples/acme/ops/agent.mjs"  # exit 1
driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --target process:my-agent --process-command no-such-binary-xyz --retry-attempts 1  # exit 1
```

```text
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

```text
✗ acme-price-sheet · process:my-agent · F · repeat 0  fail  block 0 must.0, block 0 skills.xlsx, block 0 guards.no_destructive_ops.pass, block 0 execution.ran_code, block 0 execution.exit_code, block 0 workspace.created, block 0 artifacts.out/acme-price-sheet.xlsx, block 1 skills.xlsx, block 1 guards.no_destructive_ops.pass, block 1 execution.ran_code, block 1 execution.exit_code, block 1 workspace.changed, block 1 artifacts.out/acme-price-sheet.xlsx
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

```text
! acme-price-sheet · process:my-agent · F · repeat 0  failed  open on block 0 failed: AdapterTransportError: the agent command no-such-binary-xyz is not found in the local sandbox
1 cell: 0 pass, 0 fail, 1 failed. Spent $0.00.
```

The first run passes: the ops agent built `out/acme-price-sheet.xlsx` and reported its skills, guards and commands. The second also printed, on stderr, `Note: --process-command runs in the workspace of each sandbox, a temporary folder, not in the working folder. examples/acme/ops/agent.mjs is a file of the working folder, which the sandbox does not hold unless a spec seeds it: give the absolute path, "<absolute path>".`. Node could not find the script inside the sandbox, so the agent produced nothing and every execution, workspace and artifact verdict failed. With the absolute path (`"$PWD/examples/acme/ops/agent.mjs"` in a shell) it passes like the first.

## Common errors

* `--process-command takes a JSON list of strings or a command line, not "[]".` (exit 2) An empty or malformed JSON list.
* `No adapter is set up for process:my-agent. ...` (exit 2) A `process:<name>` target other than `process:acme-ops` with no `--process-command`, often a `resume` that forgot it.
* The `Note: --process-command runs in the workspace of each sandbox ...` line, then failing execution verdicts: a relative path. Give absolute paths.
* `open on block 0 failed: AdapterTransportError: the agent command <binary> is not found in the local sandbox` (cell `failed`, exit 1). The binary is not on the `PATH` the sandbox passes. Give its absolute path.
* Skill and guard verdicts `inconclusive` on every block: the agent writes no `driftbench-runtime.jsonl`. Report runtime events, or make those expectations non-gating.
* `execution.exit_code` fails: the agent process exited non-zero; its standard error is in the execution record (`campaign run --json`, or the viewer).
* A task spec run on a chat target fails every execution, workspace and artifact verdict: the chat agent writes no files. Run task specs on a process target (`--route`).
