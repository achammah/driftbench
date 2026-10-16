---
title: Move a campaign between stores
summary: Write a stored campaign as a folder of JSON files (its runs, the specs it ran and the dataset and prompt versions it records) with campaign export, and store that folder in another store, all or nothing, with campaign import.
commands:
  - campaign export
  - campaign import
see_also:
  - running-store
  - running-campaign-status
  - running-campaign-resume
  - running-campaign-run
next:
  - running-cleanup
---

## What it is

A store is one SQLite file that can hold many campaigns. `driftbench campaign export` writes one campaign as a bundle folder: the campaign record, one JSON file per run, the specs at the exact content the campaign pinned, and the files of every dataset and prompt version the campaign records. A `manifest.json` holds the SHA-256 of every file. `driftbench campaign import` reads such a folder, checks every hash, and stores the campaign, its specs, its versions and its runs in another store in one transaction: all of it or nothing. The imported campaign can then be read (`campaign status`), resumed, reported and compared there as if it had run there.

## When to use it

* To hand a campaign to another machine, another person, or CI, without copying a whole store.
* To archive a campaign as reviewable, diffable JSON files (records are pretty printed).
* To gather campaigns run in separate stores into one store, for example before `compare`.
* Not to rerun a campaign: import it, then `campaign resume` runs only its cells with no completed run. A new measurement is a new `campaign run`.

## Commands and every option

```text
driftbench campaign export <campaignId> --store <file> --out <dir>
driftbench campaign import <folder> --store <file>
```

| Option | Command | Default | Effect |
|---|---|---|---|
| `<campaignId>` | `export` | required | the campaign to write. |
| `--store <file>` | `export` | required | the store that holds the campaign. It must exist. |
| `--out <dir>` | `export` | required | the parent folder; the bundle goes in `<dir>/<campaignId>` (an id that is not a plain file name is percent-encoded). Exporting again into the same folder rewrites the bundle. |
| `<folder>` | `import` | required | the bundle folder `export` wrote, the one holding `manifest.json`. |
| `--store <file>` | `import` | required | the store to import into; made when missing. |

## Inputs

`export` reads the campaign record, its runs (with their blocks), the specs at the hashes the campaign pins, and every dataset or prompt version the campaign records (`--dataset`, `--prompt` of `campaign run`).

`import` reads a bundle folder:

```text
<dir>/<campaignId>/
  manifest.json                 format "driftbench-campaign", schemaVersion, campaignId, counts, and the SHA-256 of each file
  campaign.json                 the campaign record
  runs/<runId>.json             one run per cell that has a stored run
  specs/<specId>@<hash>.json    each spec the campaign pins
  sources/<kind>/<name>@<version>/version.json and files/...   each dataset or prompt version it records
```

## Outputs and how to read them

* `export`: `Exported campaign <id> to <folder>: <n> runs, <n> specs, <n> sources[ (<kind> <name>@<version>, ...)].` The folder is printed relative to the working folder when it is inside it.
* `import`: `Imported campaign <id> into <store>: <n> runs, <n> specs, <n> sources.`
* Importing the same bundle twice into the same store succeeds and changes nothing: a campaign equal to the one stored is accepted. A campaign with the same id and other content is refused, because a campaign never changes once written.

Exit codes for both: 0 when written or stored; 2 on an unknown campaign, a store that cannot be opened or does not exist (`export`), a bundle that does not read or fails its hashes, a version the source store lacks, or a conflict with the target store.

## Worked example

A two-cell campaign is run into one store, exported, imported into a second store, and read back there. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --repeats 2 --store ex.db --campaign acme-export
driftbench campaign export acme-export --store ex.db --out out
driftbench campaign import out/acme-export --store other.db
driftbench campaign import out/acme-export --store other.db
driftbench campaign status acme-export --store other.db
```

```text
Exported campaign acme-export to out/acme-export: 2 runs, 1 specs, 0 sources.
```

```text
Imported campaign acme-export into other.db: 2 runs, 1 specs, 0 sources.
```

```text
2 cells: 2 pass, 0 fail, 0 failed. Spent $0.00.
```

The bundle holds `campaign.json`, `manifest.json`, `runs/1c0b2d1ab8c8d2ee.json`, `runs/a7013f45bfd4c07b.json` and one spec file under `specs/`, named by the spec id `acme-plan-upgrade`, an at sign and its hash `3577d4c43a98`: the two run files are named by their cell ids. The second import prints the same line and changes nothing. `status` on the new store reads the imported runs.

## Common errors

Each exits 2.

* `exportCampaign: campaign nope is not in the store` The id is not in the `--store`. List what it holds with `campaign status --store <file>`, which prints the latest.
* `No store at missing.db: this command reads a store and does not make one.` `export` was given a store path that does not exist.
* `store: the bundle at <path> is invalid: cannot read manifest.json: ENOENT: ...` The folder given to `import` is not a bundle. Give `<out>/<campaignId>`, the folder holding `manifest.json`, not `<out>`.
* `campaign acme-export is already stored with other content; a campaign is immutable, so a re-run takes a new campaign id` The target store already holds a different campaign under this id. Import into another store, or keep the stored one.
* `campaign <id> records dataset <name>@<n>, which this store does not hold` The source store lost a version the campaign ran with; the bundle cannot be complete.
* `store: the bundle at <path> is invalid: runs/<runId>.json does not match the hash its manifest records: it changed after the export` A file of the bundle was edited. Nothing is imported, and no store file is created. Export the campaign again from its source store.
