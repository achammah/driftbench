---
title: Stop a run and clean up
summary: How to stop a running campaign safely. What driftbench removes by itself (sandboxes, temporary folders, agent processes). What an interrupt or a hard kill leaves behind. Which files you remove yourself.
commands:
  - campaign run
  - campaign resume
  - smoke
see_also:
  - running-campaign-resume
  - running-process-and-sandboxes
  - running-store
  - running-campaign-export-import
  - running-cache
next:
  - running-pilot
---

## What it is

A campaign can be stopped at any moment. Each run is written to the store as soon as it finishes. So stopping loses only the cells in flight, and `campaign resume` runs them later. driftbench cleans up after itself. Every sandbox folder goes when its run closes. The campaign's temporary folder goes when the command ends. Every command a sandboxed agent started runs in its own process group, killed when it exits or times out. On Ctrl-C (SIGINT) or SIGTERM the CLI kills the process groups still running, removes the sandbox folders still open, and then exits with that signal. What it cannot clean is what you asked it to keep (stores, bundles, reports) and what a SIGKILL interrupts.

## When to use it

* You need to stop a long or costly campaign now: press Ctrl-C, or send SIGTERM to its process id. Then `campaign resume --store <file>` when you want to finish it.
* A run hangs on an agent: lower the agent's timeout (`timeout_ms` of an http target, a block's `budget.latency_ms` for a process agent). Or stop and resume.
* You are freeing disk space or removing sensitive data: delete the store files, export bundles and report folders you made.
* You see stray `driftbench-sandboxes-*` folders in the temporary folder: a run was killed with SIGKILL, or interrupted while it held an empty campaign folder.

## Commands and every option

driftbench has no stop or clean command. Stopping is a signal to the running process; cleaning is automatic or a file deletion.

| Action | How | Effect |
|---|---|---|
| Stop a campaign | Ctrl-C in its terminal, or `kill -INT <pid>` / `kill -TERM <pid>` | finished runs stay in the store. The cells in flight are lost and show `pending`. The process exits with code 130 (SIGINT) or 143 (SIGTERM) as the shell reports it. |
| Finish it | `driftbench campaign resume [campaignId] --store <file>` | runs only the cells with no completed run (topic running-campaign-resume). |
| Hard kill | `kill -KILL <pid>` | no cleanup runs: sandbox folders and agent processes may remain. Avoid it. |
| Keep nothing | omit `--store` | `campaign run` uses an in-memory store; nothing is written to disk but temporary sandbox folders, which are removed. |
| Fresh agent answers | `--no-cache` | the cache is neither read nor written; nothing to clean later (topic running-cache). |

What driftbench removes by itself:

* Each sandbox (a temporary workspace folder) when its run closes. The command line has no flag to keep one; code can pass `keep: true` to `processAdapter`.
* The campaign's folder, `driftbench-sandboxes-<random>` under the system temporary folder (`$TMPDIR` on macOS, usually `/tmp` on Linux). It goes when `campaign run` or `campaign resume` ends normally or on an error.
* Every command a sandbox runs, with everything it started (its process group). It goes when it exits, when it passes its timeout (10 minutes by default, exit 124), and at process exit.
* On SIGINT or SIGTERM: the open sandbox folders and the running process groups. Also any process whose command line names one of those folders or whose working folder is inside one. So a daemon that left its process group is found too.

## Inputs

The process id of the running command (from `ps`, or `$!` when you started it in the background). Also the paths you gave: `--store`, `--out`, report folders.

## Outputs and how to read them

* After an interrupt, `campaign status --store <file>` shows the cells that finished and the rest as `pending`, and exits 1.
* What you may find left over, and whether it is safe to delete:

| Leftover | Made by | Remove when |
|---|---|---|
| the store file (`--store`) | you | you no longer need its campaigns, runs or cache. It holds every message and tool payload: delete it, or keep it private. |
| `<out>/<campaignId>/` bundles | `campaign export` | the bundle has been imported where it was needed. |
| `driftbench-sandboxes-*` under the temporary folder | a run killed with SIGKILL, or an interrupted command (it can leave its empty campaign folder) | no driftbench command is running. An empty one is safe to remove at any time. |
| agent processes | a sandboxed agent of a run killed with SIGKILL | find them by their working folder or command line, which name the sandbox, and stop them by process id. |

## Worked example

A sandboxed task run is kept in a store. Its sandbox and campaign folder are removed when the command ends, and the store keeps the run. No model is called.

```sh
driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --store kept.db --campaign kept
driftbench campaign status kept --store kept.db
```

```text
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

An interrupt, measured on the Acme gated suite (195 cells, kept in `kill.db`): Ctrl-C after a few seconds stopped the command with exit code 130. `campaign status --store kill.db` then read `195 cells: 73 pass, 0 fail, 0 failed, 122 pending. Spent $0.00.`, and `campaign resume --store kill.db` ended with `195 cells: 195 pass, 0 fail, 0 failed, 73 reused. Spent $0.00.` The interrupted command left one empty `driftbench-sandboxes-*` folder in the temporary folder, which is safe to remove.

## Common errors

* Stopping with SIGKILL (`kill -9`), then finding `driftbench-sandboxes-*` folders full of workspace files and agent processes still running: SIGKILL cannot be caught. Use Ctrl-C or SIGTERM.
* `Campaign <id> already exists. Resume it with: driftbench campaign resume <id>` after an interrupt: `run` never continues a campaign. Use the `resume` command it prints.
* `The campaign folder <path> could not be removed: <reason>` on stderr: the temporary folder could not be deleted (permissions, a file held open). Remove it by hand once nothing runs in it.
* Interrupting a campaign that had no `--store`: the runs lived in memory and are gone. Run it again with `--store`.
* Disk filling up over many campaigns: each store keeps every run and cache entry forever. Use separate store files per experiment and delete the ones you no longer need.
