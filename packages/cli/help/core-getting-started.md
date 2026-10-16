---
title: Getting started
summary: Install driftbench, then check and run the Acme example specs with no model call and no key.
commands:
  - spec validate
  - campaign run
  - campaign status
see_also:
  - core-project-layout
  - core-configuration
  - core-exit-codes
  - core-reading-help
next:
  - core-reading-help
  - recipes-test-a-chat-agent
---

## What it is

driftbench evaluates AI agents block by block. A spec is a YAML file: a target agent and a list of blocks,
each block one exchange with a Given (the state before), a When (the user turn) and a Then (what the reply
and the tool calls must satisfy). A campaign runs specs on targets, in run modes, with repeats, and keeps
every run in a store, a SQLite file.

The repository ships a worked example, Acme Telecom: a fictional sales assistant and a fictional ops agent,
both deterministic code with no model, no key and no network. Every topic's worked example runs on it.

## When to use it

* First contact with driftbench: install it and see it pass on known specs.
* Before writing your own specs: see what a valid spec and a passing campaign look like.
* After an upgrade: the Acme run must still print 7 valid specs and 7 passing cells.

## Commands and every option

Install, one of two ways. Both need Node.js 22.13 or newer: the store uses `node:sqlite`.

* From npm, in your project: `npm install --save-dev @agent-nexus/driftbench`, then `npx driftbench <command>`.
  The npm package does not hold the Acme example: the targets `function:acme-sales`, `function:acme`,
  `process:acme-ops` and `function:acme-random` have no adapter there.
* From a checkout, to run the Acme example:
  `git clone https://github.com/achammah/driftbench`, `cd driftbench`, `pnpm install`, `pnpm build`, then
  `pnpm driftbench <command>`. `pnpm -s driftbench` prints only what driftbench prints. Without
  `pnpm build`, every command that loads a package fails with `ERR_MODULE_NOT_FOUND` on a `dist/index.js`.

The three commands of a first run:

`driftbench spec validate <paths...> [--json]`

* `<paths...>`: spec files or folders. A folder is searched recursively for `*.yaml`, `*.yml` and
  `*.spec.json`, in sorted order; names starting with a dot, `node_modules` and `dist` are skipped.
* `--json`: print one JSON array, one entry per spec. Default: off, one line per spec.

`driftbench campaign run [paths...] [--store <file>] [--target <adapter[:agent]>]... [--mode <modes>] [--repeats <n>] [--json]`

* `[paths...]`: spec files or folders. Without them, the `campaign.specs` of the project config.
* `--store <file>`: the SQLite store that keeps the campaign, its runs and the cache; made when missing.
  Default: none, the runs are held in memory and lost when the command ends.
* `--target <adapter[:agent]>`: run every spec on this target; repeat for several. Default: each spec runs
  on its own `target`.
* `--mode <modes>`: `T` teacher-forced, `F` free-running, `P` perturbed, comma separated. Default `F`.
* `--repeats <n>`: runs per spec, target and mode. Default 1.
* `--json`: print one JSON document.
* Every other option of `campaign run` (budget, cache, concurrency, retries, change sets, the simulated
  driver) is in the running topics: `driftbench campaign run --help` names them.

`driftbench campaign status [campaignId] --store <file> [--detail] [--json]`

* `[campaignId]`: the campaign to show. Default: the latest campaign of the store.
* `--store <file>`: required. The store must exist: status never makes one.
* `--detail`: also print the compounding index, the succession of every run and the recovery tables.
* `--json`: print one JSON document.

## Inputs

* `examples/acme/specs`: seven specs, six conversations (`specs/conversations`) and one code-agent task
  (`specs/tasks/price-sheet.yaml`). Each names its own target: the conversations run on
  `function:acme-sales`, the task on `process:acme-ops`.
* No key and no environment variable: the Acme agents are in-process or local code.

## Outputs and how to read them

`spec validate` prints one line per spec: a check mark, the path, the spec id, the block count, the
perturbation count and the hash (the first 12 hex characters of the SHA-256 of the spec's canonical JSON).
The last line counts valid, invalid and warnings. An invalid spec is marked with a cross and lists each error
as `<path in the spec>  <CODE>  <message>`.

`campaign run` prints one line per cell, `<spec id> · <target> · <mode> · repeat <n>  pass|fail  <blocks>`,
then a summary: `7 cells: 7 pass, 0 fail, 0 failed. Spent $0.00.` A cell is one spec on one target in
one mode for one repeat. `fail` means a check did not hold; `failed` means the run itself broke (an adapter
error, a timeout). Without `--store` it ends with `The runs are not kept: pass --store <file> to keep them.`

`campaign status` prints the same cell lines for a stored campaign, read back from the store.

## Worked example

From a checkout, after `pnpm install` and `pnpm build`, in the repository root:

```sh
driftbench spec validate examples/acme/specs
driftbench campaign run examples/acme/specs --store acme.db
driftbench campaign status --store acme.db
```

```text
✓ examples/acme/specs/conversations/new-customer-coverage.yaml  acme-new-customer-coverage · 4 blocks · 2 perturbations · hash 698fc3743de6
...
✓ examples/acme/specs/tasks/price-sheet.yaml  acme-price-sheet · 2 blocks · 1 perturbation · hash d96437659138
Checked 7 specs: 7 valid, 0 invalid, 0 warnings.

✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
7 cells: 7 pass, 0 fail, 0 failed. Spent $0.00.
```

The hashes change when a spec changes. Each command exits 0.

## Common errors

* `Cannot find module .../dist/index.js` (`ERR_MODULE_NOT_FOUND`) from a checkout: run `pnpm build` first.
* `No adapter is set up for function:acme-sales` from an npm install: the Acme example lives only in the
  repository. Use a checkout, or point the specs at your own target (see `driftbench help core-configuration`).
* `No store at acme.db: this command reads a store and does not make one.` (exit 2): `campaign status` was
  given a path with no store. Run `campaign run --store acme.db` first, or fix the path.
* `Checked 1 spec: 0 valid, 1 invalid` with `SPEC_PARSE  cannot read the file: ENOENT`: the path does not
  exist. A missing path is an invalid spec, exit 1, not a usage error.
* `The runs are not kept`: you ran without `--store`. Nothing is wrong, but nothing was saved.
