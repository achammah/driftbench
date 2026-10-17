---
title: The run store
summary: The SQLite file (--store) that keeps campaigns, the specs they pinned, every run with its blocks and verdicts, the block cache, cost units and versioned datasets and prompts; which commands create it and which only read it.
commands:
  - campaign run
  - campaign plan
  - campaign status
  - campaign resume
  - campaign export
  - campaign import
see_also:
  - running-campaign-run
  - running-campaign-status
  - running-campaign-resume
  - running-campaign-export-import
  - running-cache
  - running-outcomes
next:
  - running-cache
---

## What it is

The store is one SQLite database file that you name with `--store <file>`. It keeps everything a campaign produces: the campaign record, each spec at the exact content the campaign ran (by id and content hash), every run with its blocks, verdicts and events, the cache of observed blocks, measured cost units, and the versioned datasets and prompts of the registry. Without `--store`, `campaign run` uses a store held in memory, and the runs are gone when the command ends. The store uses `node:sqlite`, built into Node.js 22.13 and newer; nothing else needs installing.

## When to use it

* Always give `--store` to a campaign whose results you want to read again, resume, export, report or compare.
* Use one store per project, or one per agent under test: a store holds any number of campaigns, and `status` and `resume` take the latest when no id is given.
* Keep two experiments apart, or start from a clean cache, by giving each its own store file.
* Treat a store as sensitive: it keeps every message the agent sent and received, tool payloads included.

## Commands and every option

| Command | `--store` | When the file does not exist |
|---|---|---|
| `campaign run` | optional | created, with its missing parent folders. Without the flag, an in-memory store. |
| `campaign plan` | optional, read for cost units | created empty. |
| `campaign import` | required | created. |
| `campaign status` | required | refused: `No store at <path>: ...` |
| `campaign resume` | required | refused. |
| `campaign export` | required | refused. |

Other commands that read or write the same file (`report`, `compare`, `ci`, `monitor`, `view`, `dataset`, `prompt`, `pilot run`) are in their own topics.

The project config can name the store for `campaign run` and `campaign plan`: `store:` under `campaign:` (topic running-campaign-config).

## Inputs

A path. A relative path is read from the folder you run the command from. Any file name works; `.db` is a convention.

What the store holds, one table each:

| Table | Holds |
|---|---|
| `campaigns` | one record per campaign: id, the pinned specs (id, hash, own target), targets, modes, repeats per mode, budget (0 means none), agent version, the dataset and prompt versions it ran, provenance, and creation time. A campaign never changes once written. |
| `specs` | each spec a campaign pinned, by id and content hash, as canonical JSON. `status` and `resume` read specs from here, not from disk. |
| `spec_objects` | the identities and hashes of the objects resolved when a spec was stored. Reading a stored spec validates its structure without reopening project files. |
| `runs` | one row per campaign and run id (a run id is a cell id, so the same cell run in two campaigns gives two rows). A run put again under the same campaign and run id replaces the first. |
| `blocks` | one row per block of a run: its Given hash, what the agent did (observed), the verdicts, the drift classes and whether it passed. |
| `cache` | observed blocks and end-state reads by cache key (topic running-cache). |
| `units` | measured cost units per adapter, read by `campaign plan` for its projection. No command records units during a run; code puts them with the store's `putUnit`. |
| `blobs`, `versions` | the registry of datasets and prompts: each file once by its SHA-256, and one immutable row per version (`dataset` and `prompt` commands). |

A run record holds `runId`, `specId`, `specHash`, `target`, `mode`, `repeat`, `perturbationId`, `status` (`completed`, `failed` or `stopped`), `error`, `blocks`, `succession`, `recovery` (mode P), `endState`, `cost`, `latencyMs`, `startedAt`, `finishedAt`, `cacheHit`, `events`, `provenance`, and `carried` on a run copied by `--change`. Each block holds `index`, `blockId`, `injected`, `givenHash`, `cacheKey`, `observed`, `verdicts`, `stageObserved`, `ledgerCheck`, `drift` and `pass`, and on newer records `resolved` (the objects the block was scored with and one hash over them) and `diagnoses`. Each verdict of a newer record carries `by`: the object (`kind:id@hash8`), the item, the implementation and the layer that produced it. For a tool input decided by a value-check policy, `by.object` names that resolved policy, `by.layer` names the policy's origin, and `by.item` names the deciding rung. An aggregate failure names the first failing value's rung; an inconclusive aggregate names the first inconclusive value's rung. A passing aggregate names the latest (loosest) deciding rung in the policy's item order. `valueCheck[]` retains every value's decision in call and path order. If no rung decides a differing value, `by.item` is `exact_fallback` and `by.impl` is `builtin:value-check/exact`. A policy supplied directly by code carries its resolved reference, or a hash of its contents when no reference is supplied, at the `cli` layer. Verdict IDs and counts do not change. Artifact metadata does not contain file bytes. A partial rerun runs artifact-dependent blocks fresh; whole-cell re-scoring refuses an observation that needs unstored artifact bytes.

## Outputs and how to read them

The store prints nothing itself. Commands read it back as text or JSON (`campaign status`, `campaign status --json`, `report`, `view`). The tables are plain SQLite: any SQLite tool can read them, and each row keeps its full record as JSON in a `json` column beside the plain columns used for filters. The schema version is 3; an older store is upgraded when opened, and a store written by a newer driftbench is refused.

Writes are transactional: a run and its blocks land together, and an import lands whole or not at all. A second process waits up to 5 seconds for a write lock.

## Worked example

Two campaigns of the same spec go into one store in a new folder. The second replays its run from the cache the first wrote. `status` with no id reads the latest. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target function:acme --store stores/acme.db --campaign first
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target function:acme --store stores/acme.db --campaign second
driftbench campaign status --store stores/acme.db
driftbench campaign status first --store stores/acme.db
```

```text
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

```text
Campaign second, created 2026-10-14T13:54:31.870Z.
✓ acme-tool-failure · function:acme · F · repeat 0  pass (replayed from the cache)  3 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

The folder `stores` was created. The store now holds two campaigns, each with a run whose id is `d44b9dfe9d1cf87a` (the cell id), and the cache entries of the first campaign's blocks.

## Common errors

* `No store at missing.db: this command reads a store and does not make one.` (exit 2) `status`, `resume` or `export` was given a path with no file. Check the path; these commands never create a store, so a typo cannot leave an empty one behind.
* `Cannot open the store at <path>: store: cannot open the store at <path>: ...` (exit 2) The file is not a SQLite database, or the folder is not writable.
* `the store needs Node.js 22.13 or newer for node:sqlite; this is Node.js <version>` Upgrade Node.js.
* `the store at <path> has schema version <n>; this version of driftbench reads 3 and older` The store was written by a newer driftbench. Upgrade driftbench.
* `The store at <path> holds no campaign. Run one with: driftbench campaign run <paths...>` (exit 2) The file exists but holds no campaign; `campaign plan --store` creates such empty files.
* Results from an earlier agent version replayed into a new campaign: the cache lives in the store. Use `--agent-version`, `--cache-suite` or `--no-cache` (topic running-cache).
