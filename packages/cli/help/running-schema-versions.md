---
title: Store and bundle versions
summary: 'A store and a campaign bundle each carry a schema version. driftbench reads 3 and older, upgrades an older store on open, and refuses a newer one with exit 2.'
commands: []
see_also:
  - running-store
  - running-campaign-export-import
  - authoring-spec-format
  - core-exit-codes
next:
  - running-store
---

## What it is

Three files say which version of their format they hold:

| File | Where the version is | This driftbench |
|---|---|---|
| a store, such as `runs.db` | the SQLite `user_version` of the database | reads 3 and older |
| a campaign bundle, the folder `campaign export` writes | `schemaVersion` in its `manifest.json` | writes 3, reads 3 and older |
| a spec | the top-level key `schema_version` | topic authoring-spec-format |

Version 3 adds no table. Its run records may hold the block fields `status`, `notRun` and `blocked` (topic running-outcomes), and `by`, `resolved` and `diagnoses`. A driftbench that reads only an older version would not know those fields. So this driftbench never opens a file newer than it reads: it could drop what it does not know.

* A newer store or bundle is refused. The command exits 2 and names the version it found.
* An older store is upgraded when a command opens it: its `user_version` becomes 3, and its runs read as before.
* An older bundle imports as it is.

## When to use it

* Read this topic when a command says a store or a bundle `has schema version <n>`.
* Before you share a store or a bundle with a team on another driftbench release. This release refuses a store or a bundle that a newer one wrote, so upgrade the readers first.
* Keep a copy of a store before an older one is first opened by this release: the upgrade happens in place.

## Commands and every option

No option changes the version check. It runs in every command that opens a store, such as `campaign run`, `campaign status`, `report`, `compare` and `ci`. It also runs in `campaign import`, which reads a bundle.

To move runs between releases, export them from the store with `campaign export` and import the bundle with `campaign import` (topic running-campaign-export-import).

## Inputs

* A store file. Its version is the SQLite `PRAGMA user_version`; nothing else in the file names it.
* A bundle folder, with its `manifest.json`:

```text
{
  "format": "driftbench-campaign",
  "schemaVersion": 3,
  "campaignId": "c-old",
  ...
}
```

## Outputs and how to read them

A newer store, from any command that opens it:

```text
Cannot open the store at <path>: store: the store at <path> has schema version <n>; this version of driftbench reads 3 and older
```

A newer bundle, from `campaign import`:

```text
store: the bundle at <path> has schema version <n>; this version of driftbench reads 3 and older
```

Both exit 2, and nothing is written: an import that is refused makes no store. An older store prints nothing about its upgrade: the command runs as usual, and the file's `user_version` reads 3 afterwards.

## Worked example

A store and a bundle of the Acme tool failure spec, each set to version 4 and to version 2 with `node`. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --store newer.db --campaign c-newer
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --store older.db --campaign c-old
driftbench campaign export c-old --store older.db --out bundles
```

```sh setup
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('newer.db'); db.exec('PRAGMA user_version = 4'); db.close()"
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('older.db'); db.exec('PRAGMA user_version = 2'); db.close()"
```

The newer store is refused. The older one opens, and is version 3 afterwards:

```sh
driftbench campaign status --store newer.db # exit 2
driftbench campaign status --store older.db
```

```sh setup
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('older.db'); const { user_version } = db.prepare('PRAGMA user_version').get(); db.close(); if (user_version !== 3) process.exit(1)"
```

```text
$ driftbench campaign status --store newer.db
Cannot open the store at .../newer.db: store: the store at .../newer.db has schema version 4; this version of driftbench reads 3 and older
(exit 2)
$ driftbench campaign status --store older.db
Campaign c-old, created ...
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
```

The same with the bundle: set to version 4 it is refused and no store is made. Set to version 2, it imports.

```sh setup
node -e "const fs = require('node:fs'); const path = 'bundles/c-old/manifest.json'; const manifest = JSON.parse(fs.readFileSync(path, 'utf8')); manifest.schemaVersion = 4; fs.writeFileSync(path, JSON.stringify(manifest, null, 2))"
```

```sh
driftbench campaign import bundles/c-old --store imported.db # exit 2
```

```sh setup
test ! -e imported.db
node -e "const fs = require('node:fs'); const path = 'bundles/c-old/manifest.json'; const manifest = JSON.parse(fs.readFileSync(path, 'utf8')); manifest.schemaVersion = 2; fs.writeFileSync(path, JSON.stringify(manifest, null, 2))"
```

```sh
driftbench campaign import bundles/c-old --store imported.db
driftbench campaign status c-old --store imported.db
```

```text
$ driftbench campaign import bundles/c-old --store imported.db
store: the bundle at .../bundles/c-old has schema version 4; this version of driftbench reads 3 and older
(exit 2)
$ driftbench campaign status c-old --store imported.db
Campaign c-old, created ...
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
```

## Common errors

| Message | Exit | Cause and fix |
|---|---|---|
| `Cannot open the store at <path>: store: the store at <path> has schema version <n>; this version of driftbench reads 3 and older` | 2 | a newer driftbench wrote the store. Upgrade driftbench, or export the runs with the newer release and import them here |
| `store: the bundle at <path> has schema version <n>; this version of driftbench reads 3 and older` | 2 | a newer driftbench exported the bundle. Upgrade driftbench to import it |
