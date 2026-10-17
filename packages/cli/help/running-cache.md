---
title: The block cache and replay
summary: How campaign run and resume replay a run from the cache in the store instead of calling the agent. The page also covers what the cache key holds and how --no-cache, --cache-suite and --agent-version control it.
commands:
  - campaign run
  - campaign resume
see_also:
  - running-store
  - running-campaign-run
  - running-campaign-resume
  - running-recordings
  - running-smoke
  - running-change-carry
next:
  - running-targets
---

## What it is

Every block the agent answers is written to a cache, keyed by everything that went into the call. On the command line the cache lives in the store (`--store <file>`): without a store, the in-memory cache is gone when the command ends. When a later run would send exactly the same blocks, the runner first tries to replay the whole run from the cache. If every block and every end-state read of the run is there, the run is rebuilt from the cache and costs nothing. Its line reads `replayed from the cache`. When some blocks are there and some are not, the cached blocks are read back up to the first missing one. The run continues live from there. That is how an interrupted cell picks up where it stopped. The checks always run again on the replayed answers, so a changed check or spec expectation applies to cached answers too.

## When to use it

* To rerun a suite after changing checks or expectations, without calling the agent again: the replay is free and deterministic.
* To make an interrupted campaign cheaper to finish: `resume` reads back the blocks already answered.
* Turn it off (`--no-cache`) when you want fresh samples from the same agent, for example to measure variance.
* Separate it (`--agent-version`, `--cache-suite`) whenever the agent behind a target name changes: the key cannot see a change inside the agent.
* Not for sandboxed agents. A run on an adapter with a sandbox (`process` targets, code-interpreter agents) is never cached nor replayed, because a replay has no workspace for the artifact checks to open.

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--store <file>` | `campaign run` (`resume` requires it) | in memory | the cache lives in this store, beside the runs. |
| `--no-cache` | `campaign run`, `campaign resume` | cache on | neither replay from the cache nor write to it, for this command. |
| `--cache-suite <name>` | `campaign run` | none | the name enters every block key. A new name starts from an empty cache, a known name replays its own entries, and other suites stay in the store. `resume` has no such flag. |
| `--agent-version <label>` | `campaign run` | none | the label enters every block key, and it becomes the `variant` of targets that name none. A run under `v2` never replays a block of `v1`. |
| `cache: false`, `cache_suite:` | the `campaign:` key of the config | none | the same as `--no-cache` and `--cache-suite` (topic running-campaign-config). |

`smoke` never uses the cache. CLI cache entries do not expire.

## Inputs

The cache key of a block is the SHA-256 of the canonical JSON of:

* the spec's content hash, without its `version` label (relabelling a spec keeps its cache);
* the repeat number (repeats are independent samples: repeat 2 never replays repeat 1);
* the block's position in the run;
* the whole resolved Given: the history so far, the ledger, the world, the vars and the target;
* the block's stimulus (what the user sends);
* the target, and the adapter's id and version, and its cache identity when it has one. For the process adapter, it is a digest of its command and arguments;
* the cache suite and the agent version, when given.

An end-state read is cached under the key of the block it follows and the source it reads. Anything the key does not hold is invisible to it. A new prompt or model behind the same target name and adapter would replay old answers. Bump `--agent-version`, use a new `--cache-suite`, or pass `--no-cache` when the agent changes. With `--prompt`, the prompt is part of the target, so a new prompt version changes the key.

## Outputs and how to read them

* A cell line `pass (replayed from the cache)` (or `fail (...)`): every block came from the cache. The run record has `cacheHit: true`, and its cost does not count in `Spent` nor against a budget.
* A partly cached run reads like a fresh run: its line has no note, and only the live blocks cost money.
* The cache adds rows to the `cache` table of the store; nothing is printed about it. When the store refuses a write, the run record gets a note.

## Worked example

The same spec, run six times into one store. The second campaign replays; `--no-cache` runs fresh; a new cache suite runs fresh, then replays its own entries; a new agent version runs fresh. Each command prints its header lines before the lines shown. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --store cache.db --campaign c1
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --store cache.db --campaign c2
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --store cache.db --campaign c3 --no-cache
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --store cache.db --campaign c4 --cache-suite nightly
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --store cache.db --campaign c5 --cache-suite nightly
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --store cache.db --campaign c6 --agent-version v2
```

```text
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
```

```text
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
```

```text
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
```

```text
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
```

```text
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
```

```text
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
```

c1 fills the cache. c2 replays it. c3 neither reads nor writes it. c4 starts the empty suite `nightly`. c5 replays `nightly`. c6 runs fresh because `v2` is in every key. Each summary line reads `1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.` A run of `examples/acme/specs/tasks/price-sheet.yaml` (a `process` target in a sandbox) never shows the replay note, however often it runs.

## Common errors

* Answers of an old agent come back after you changed its prompt or model. The target name and adapter did not change, so the key is the same. Add `--agent-version <new label>`, or `--no-cache`.
* Repeats that should vary all read `replayed from the cache`: the repeats replay the answers of an earlier campaign of the same repeats. Use `--no-cache` or a new `--cache-suite` to draw fresh samples.
* A process or code-interpreter campaign never replays: by design, sandboxed runs are not cached.
* A resumed campaign that used `--cache-suite` reads the default suite: `resume` takes no `--cache-suite`. Pass `--no-cache` to `resume` if the default suite may hold other answers.
* The cache keeps every message and tool payload: treat the store as sensitive, and keep test-scoped keys.
