# process adapter

Status: shipped, phase 1. It passes the [contract suite](index.md#the-contract-suite) in task mode (`packages/adapters/test/process.contract.test.ts`): the Acme price-sheet task in a local sandbox, with the fixture code agent of the sandbox tests.

The process adapter runs a code-interpreter agent as a command in a sandbox, one process per block. It is the adapter for task specs: the agent writes and runs code, reads and writes files in a workspace, and loads skills. Its blocks go through the same runner, checks, judges and statistics as a conversation.

## Options

```ts
import { processAdapter } from '@agent-nexus/driftbench-adapters';
import { localProvider } from '@agent-nexus/driftbench-sandbox';

const adapter = processAdapter({
  command: process.execPath,
  args: ['/srv/agents/office-agent.mjs'],
  provider: localProvider(),
});
```

| Option | Meaning |
|---|---|
| `command` | the agent command: a binary on the sandbox's `PATH`, or a path to one |
| `args` | its arguments |
| `provider` | where sandboxes come from: `localProvider()` or `dockerProvider({ image })` of `@agent-nexus/driftbench-sandbox` |
| `keep` | leave each sandbox on disk after `close`, for inspection |
| `image` | the docker image, when it differs from the provider's |
| `stimulus` | how the instruction reaches the agent: `stdin` (the default) or `file` |
| `env` | variables for the agent process, such as its API key |
| `timeoutMs` | kills the agent after this long. Default 10 minutes. A block's `budget.latency_ms` lowers it. |
| `deterministic` | true when the agent gives the same output for the same input. Default false. |

The evaluator's own environment does not pass to the agent. A local sandbox passes `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TERM` and `TZ`; a docker sandbox passes none. `env` adds the rest.

## How a block runs

1. `open` creates a sandbox from the provider, seeds it from the spec's workspace (`given.world.workspace`), and checks that the agent command is there. The workspace is the agent's working folder.
2. Before each block, the adapter writes into the workspace what the block's Given adds or changes against the files already seeded; files the agent changed since stay as they are. It writes the session history to `driftbench-history.json`, in file mode the instruction to `driftbench-stimulus.txt`, and, when the target has a prompt (`campaign run --prompt`), its text, byte for byte, to `driftbench-prompt.txt`, whose path the agent reads in `DRIFTBENCH_PROMPT_FILE`. Without a prompt neither the file nor the variable exists. Then it takes a snapshot: the file list and a hash per file.
3. It runs the agent command line through a POSIX shell, `/bin/sh`, in the workspace. In stdin mode the instruction arrives on standard input. In file mode the path of the stimulus file replaces `{stimulus_file}` in `args`, or is appended when no argument holds it. A burst arrives as its messages joined by a blank line.
4. After the agent exits, it takes a second snapshot and diffs the two: created, changed and deleted paths. Every created or changed file is an artifact of the block, with its hash and size.
5. It reads the two files the agent may write, and returns the Observed.

The Observed of a block:

* `text`: the agent's standard output, without its final line break, as one text segment. No output gives no segment.
* `toolCalls`: none. The commands the agent reports are execution records.
* `workspaceDiff` and `artifacts`: from the two snapshots. The protocol files never appear in either.
* `executions`: the commands the agent reports, each with role `command`, then one record for the agent process itself, with role `agent`, always last: its command line, exit code, standard error, start, latency, and `truncated` when its output was cut. A non-zero exit is a fact in that record, not an agent failure; the [execution check](../reference/checks.md#execution) reads it.
* `runtime`: the skills, guards and stages the agent reports.
* `sandbox`: the kind of sandbox (`local` or `docker`) and its isolation (`weak` or `strong`). A kept sandbox also names its folder on this machine.
* `cost`: empty. `latencyMs`: the agent process's run time.
* `raw.protocolErrors`: the lines of the protocol files that could not be read, at most 20.

## What the agent reports

The adapter tells the agent where its files are through environment variables:

| Variable | Holds |
|---|---|
| `DRIFTBENCH_WORKSPACE` | the workspace path, as the agent sees it |
| `DRIFTBENCH_BLOCK` | the block's position in the run |
| `DRIFTBENCH_HISTORY_FILE` | the path of `driftbench-history.json` |
| `DRIFTBENCH_COMMANDS_FILE` | the path of `driftbench-commands.jsonl` |
| `DRIFTBENCH_RUNTIME_FILE` | the path of `driftbench-runtime.jsonl` |
| `DRIFTBENCH_STIMULUS_FILE` | the path of `driftbench-stimulus.txt`, in file mode only |

`driftbench-history.json` holds the session history as a JSON array, ending with the current user turn; the prefix of the session is part of it. In the second block of the Acme price-sheet task, the fixture agent read:

```json
[
  {
    "role": "user",
    "content": "Build a price sheet from catalog.csv. Make one sheet per category, named Mobile and Home, with the columns Plan, Allowance, Monthly price (USD) and Yearly price (USD), and keep the rows in catalog order. The yearly price must be a formula. Save it as out/acme-price-sheet.xlsx.\n"
  },
  {
    "role": "assistant",
    "content": "Wrote out/acme-price-sheet.csv with 6 plans. History: 1 message."
  },
  {
    "role": "user",
    "content": "Add a sheet named Summary to the same workbook with the cheapest plan of each category: one row per category, Mobile first, with the category, the plan and its monthly price. Keep everything else as it is.\n"
  }
]
```

The agent may append one JSON object per line to two files. Both are optional. The adapter deletes them before each block, so what they hold belongs to that block.

* A block starts with no `driftbench-commands.jsonl` and no `driftbench-runtime.jsonl`.
* A runtime event of one block never appears in the `runtime` of the next block.
* A block whose agent writes no runtime file has no `runtime`, whatever an earlier block reported.

* `driftbench-commands.jsonl`: one command the agent ran per line, with `command` and an integer `exitCode`, and optionally `startedAt` and `latencyMs`. Each becomes an execution record with role `command`.
* `driftbench-runtime.jsonl`: one runtime event per line: `type` is `skill`, `guard` or `stage`, with a `name`; a guard also needs its `verdict`. Each may carry `at`, an ISO time.

The same block of the fixture agent wrote these lines:

```jsonl
{"command":"node --version","exitCode":0,"startedAt":"2026-10-11T17:34:00.538Z","latencyMs":17}
```

```jsonl
{"type":"skill","name":"csv"}
{"type":"guard","name":"no_destructive_ops","verdict":"pass"}
{"type":"stage","name":"add_summary"}
```

A blank line is skipped. A line that is not a JSON object, or misses a required field, is skipped and named in `raw.protocolErrors`, never guessed at. A protocol file over 10 MiB is skipped and named there too. A runtime file the agent did not write leaves `runtime` absent, so the skill and guard checks are inconclusive on that block.

This is how a code-agent harness reports its runtime: its hooks as guards, its skills as skills, its shell commands as commands. See [runtime vocabulary](index.md#runtime-vocabulary).

## Sandboxes

| Provider | Isolation | What it is |
|---|---|---|
| `localProvider()` | weak | a fresh temporary folder on this machine. Commands run there through `/bin/sh` as the current user: the folder bounds what the run records, not what the agent can reach. |
| `dockerProvider({ image })` | strong | one container per sandbox, from the image, with the workspace folder mounted at `/workspace`. The image needs a shell. The container runs as the current user, so every file the agent writes stays removable. The container has no network unless `network: 'bridge'` is given. |

Docker resource and privilege defaults are configured on `dockerProvider`:

| Option | Default | Docker flag | Override |
|---|---|---|---|
| `memory` | `'1g'` (1 GiB) | `--memory` | another Docker size string; `'0'` removes the limit |
| `cpus` | `1` core | `--cpus` | a fractional or whole core count; `0` removes the quota |
| `pidsLimit` | `256` processes | `--pids-limit` | another count; `-1` removes the limit |
| `capDrop` | `['ALL']` | one `--cap-drop` per entry | another capability list; `[]` keeps Docker's default capabilities |
| `noNewPrivileges` | `true` | `--security-opt no-new-privileges` | `false` omits this restriction |
| `network` | `'none'` | `--network none` | `'bridge'` allows network access |

For example, `dockerProvider({ image: 'node:22-alpine', memory: '2g', cpus: 2, pidsLimit: 512 })` raises the resource limits while keeping the default privilege restrictions and network denial. Workloads that exceed a resource limit can fail; raise only the limits they need.

Exec environment values travel through `--env-file`, stored outside the mounted workspace in a private temporary folder (mode `0700`). The file is created with mode `0600`; the file and folder are removed after success, failure or timeout. Values appear in neither argv nor the Docker client's environment. Container variables such as `PATH`, `DOCKER_HOST`, `DOCKER_CONFIG`, `DOCKER_CONTEXT` and `HTTP_PROXY` cannot steer the client.

Docker's [env-file parser](https://github.com/docker/cli/blob/master/pkg/kvfile/kvfile.go) reads literal `NAME=value` lines: spaces (including leading and trailing spaces), quotes, `=` and `#` inside values are preserved, with no quoting or escaping added. Empty values and stdin are preserved. Values containing LF or CR line breaks are rejected before Docker runs, with an error naming the variable; multiline values cannot be represented by this format. NUL values and names containing whitespace, `=` or NUL, or starting with `#`, are also rejected. Only explicitly named variables are forwarded to the container; the parent process environment is not changed.

A sandbox folder that a run leaves open is removed when the process exits, including on SIGINT and SIGTERM, so an interrupted run leaves no workspace behind. A kept sandbox is not removed. A command still running at that point is killed with its process group. Only SIGKILL, which no process can catch, leaves them behind.

Each provider reports whether it can run on this machine (`available()`); the adapter does not fall back from one to the other. The sandbox's isolation is on every Observed.

An approval policy is opt-in. Wrap a provider with `withApprovalPolicy(provider, policy)` and each sandbox it makes checks its commands and reads against the policy. Without it, the sandbox runs as before and its records carry no approval field.

* A rule matches a command (the whole command text) or a path. A path is a command's `cwd` or a file the harness reads through the sandbox. A `*` in a pattern matches any run of characters.
* The first matching rule decides. `allow` and `deny` decide alone. `ask` calls the approver. With no approver, or one that throws, the answer is a denial.
* No matching rule allows. A denied command does not run: its exit code is 126 and its record names the rule. A denied read throws `SandboxApprovalError`.
* Every decision rides on the command's record as `approval`, and reads are kept in the sandbox's `approvals()` log.
* Path rules do not read the paths a shell command names. A command that reaches a file by name is checked only by a command rule.

Bounds, so a runaway agent cannot exhaust the run:

* Standard output and standard error are each cut at 10 MiB, and the record says so.
* A command is killed after its timeout, 10 minutes by default, with everything it started. Its exit code is then 124. A command killed by a signal exits with 128 plus the signal number.
* A child that left the command's process group (it started its own session) is found by its working folder after the command ends. Linux reads this from `/proc` at once. macOS has no `/proc`: the sweep runs `ps` and `lsof` after the exit, so on a heavily loaded host a child that wakes within about half a second of the exit may run before it is ended.
* A file read returns at most 100 MiB.
* A snapshot stops past 20,000 files, 32 folder levels or 1 GiB hashed. It never enters `node_modules` or `.git`.

### Workspace paths

Every path given to a sandbox is relative to the workspace root. The sandbox normalises it before it checks it.

* A path that is empty or holds a NUL byte is refused.
* An absolute path is refused.
* A path that normalises to `..`, or to a path that starts with `../`, leaves the workspace and is refused. `a/../..` is such a path.
* A path that stays inside after it is normalised is accepted. `a/../b` is `b`.
* A path is inside the workspace only when it is the root or lies below the root folder. A sibling folder whose name starts with the workspace's name is outside it: `/tmp/ws-other` is not inside `/tmp/ws`.
* A path that resolves outside the workspace through a symbolic link is refused.
* A write never passes through a symbolic link.

## Errors

| What happens | Error |
|---|---|
| the sandbox cannot be created, the agent command is not found, the agent cannot be started, the workspace cannot be snapshotted after the block | `AdapterTransportError`: the runner retries |
| the agent left a workspace past the bounds, or in a state the next block's files cannot be written to, such as a planted link | `AgentFailure`: the run fails |
| anything else, such as a workspace `from` folder that cannot be read | the run fails at once |

## Reading files and closing

`readArtifact(session, path)` reads a file of the workspace through the sandbox's bounded read; a path outside the workspace is refused. The artifact checks open it with their readers. `close` removes the sandbox, unless the adapter keeps it; a second call does nothing.

## Capabilities

`sandbox` is on, and so is `readArtifact`. `seedPrefix` is on: the agent receives the session history, the prefix included (and in mode T the canonical history), in `driftbench-history.json`. `deterministic` is as declared. `variants`, `toolStubs`, `trace` and `endState` are off: the adapter reads no end state, so a task checks its outcome through `artifacts`, `workspace` and `execution`. The version is `0.1.0`.

## Target

```yaml
target:
  adapter: process
  agent: office-agent
```

The adapter takes its command and arguments from its configuration. The CLI includes `process:acme-ops`: the Acme ops agent (`examples/acme/ops/agent.mjs`), run by the CLI's own Node.js in a local sandbox, one temporary folder per run, declared deterministic. For another process agent, pass `--target process:my-agent --process-command '["python3","/absolute/path/to/agent.py"]'` to `campaign run`, or set that process target in the spec. `campaign resume` and `ci` also accept `--process-command`. The command runs in the sandbox workspace, so use absolute script paths. The command does not override the built-in `process:acme-ops` target. See [running](../running.md#runspec).
