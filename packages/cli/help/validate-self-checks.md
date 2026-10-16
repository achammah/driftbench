---
title: Self-checks of the repository
summary: The checks CI runs on driftbench itself beside the validators. They include the leak guard, the public API surface, the docs checks and the package boundaries.
commands:
  - validate
see_also:
  - validate-overview
  - validate-protect
  - validate-research-replays
next:
  - validate-research-replays
---

## What it is

Beside the validator ladders, CI runs checks on the repository itself. They are scripts at the repository
root, not `driftbench` commands, and they need the source checkout (a git clone with `pnpm install` done).

| Check | Command | What it proves |
|---|---|---|
| leak guard | `node tools/guard/guard.mjs` (`pnpm guard`) | no personal data or client identifier is in the tree. The checks cover IBANs with a valid checksum, Belgian national register numbers, phone numbers, real email addresses, and any term on a private denylist |
| guard canary | `node tools/guard/guard.mjs --canary` (`pnpm guard:canary`) | every guard check still fires: it plants generated data in a temporary folder and expects each to be caught |
| public API surface | `node tools/structure/api-surface.mjs --build --check` | the names each package exports equal the frozen list `tools/structure/api-surface.json`. A name is added or removed only together with that file, so the change shows in review |
| spec reference | `pnpm docs:reference --check` | the generated reference pages under `docs/reference` (spec, family and the other file formats) match the schemas they are generated from |
| docs links | `pnpm docs:links` | every relative link in `docs/` points at a file and heading that exist, and every page is reachable from `docs/index.md` |
| docs tests | `pnpm vitest run tools/docs` | no em or en dash on any page. Runtime-specific names only under `docs/adapters`. Every YAML example loads and every whole spec lints clean. The CLI reference examples show the output of their commands. The README example is the committed spec word for word. Every page compiles as the docs site renders it |
| package boundaries | `pnpm vitest run tools/structure` | no package imports across a boundary in a new way, and no import cycle between packages |

The validators' own jobs (`validate all --check-floor`, `--check-handover`, `protect`) are in
`validate-floors`, `validate-executor-loop` and `validate-protect`. The research replays are in
`validate-research-replays`.

## When to use it

* Before every push: the guard on the files you changed, and the docs checks when you touched `docs/`.
* After changing what a package exports: the API surface check, then rewrite the frozen list on purpose.
* After changing a schema the reference pages are generated from: regenerate and check the pages.
* When CI's "leak guard" or build job fails.

## Commands and every option

### Leak guard

```
node tools/guard/guard.mjs [paths...] [--json] [--canary] [--require-denylist]
```

| Option | Default | Meaning |
|---|---|---|
| `paths...` | every file git tracks or would track (ignored files skipped) | files or folders to scan |
| `--json` | off | print one JSON document: `{ clean, scanned, skipped, allowed, excused, denylistTerms, findings, errors }` |
| `--canary` | off | plant generated data in a temporary folder and prove every check fires |
| `--require-denylist` | off | fail when no denylist term is loaded (CI on main uses it) |
| `--help`, `-h` | off | print the usage |

The denylist comes from the environment variable `GUARD_DENYLIST` (terms separated by newlines or
commas) and a local `.guard-denylist` file; its terms are never printed, not even in part. Fictional data
passes: email addresses at `example.com`, `.test`, `.invalid`, `.example` or `localhost`, and phone
numbers in the reserved range 555-0100 to 555-0199. A line containing `guard:allow` suppresses pattern
findings on that line, never a denylist finding. Each `tools/guard/fingerprints/*.json` lists exact values a
generator made up, as the kind plus the SHA-256 of the matched text. Files above 10 MiB fail with a named
error. Exit 0 clean, 1 findings, scan errors or a canary miss, 2 usage error.

### Public API surface

```
node tools/structure/api-surface.mjs [--json] [--check] [--write] [--build] [--snapshot <file>] [--root <dir>]
```

| Option | Default | Meaning |
|---|---|---|
| (none) | | tab-separated rows, one per built export: `package, name, kind, declaredIn, doc, inDocs, srcImporters, testFiles, examples, tools, usedNowhere`, then a summary row per package |
| `--json` | off | the same data as one JSON document |
| `--check` | off | compare the exports with the frozen list; exit 1 and name every added and removed export when they differ |
| `--write` | off | rewrite the frozen list from the exports (with `--build`) |
| `--build` | off | build the packages first when the build stamp is missing or stale |
| `--snapshot <file>` | `tools/structure/api-surface.json` | the frozen list to check or write |
| `--root <dir>` | the repository | the repository to read (for the tool's own tests) |

Without `--build`, a missing or stale build stops it with
`The API build is missing or stale. Run node tools/structure/api-surface.mjs --build --check.` and exit 1.

### Docs checks

```
pnpm docs:reference [--check] [--out <file>] [--missing]
pnpm docs:links [folder]
pnpm vitest run tools/docs
pnpm vitest run tools/structure
```

| Option | Default | Meaning |
|---|---|---|
| `docs:reference` with no flag | | write the generated reference pages |
| `--check` | off | compare instead of writing; exit 1 and name the stale file |
| `--out <file>` | `docs/reference/spec.md` | the spec page to write or check; the other pages are then left alone |
| `--missing` | off | print every field of the spec page that has no description |
| `docs:links [folder]` | `docs` | the folder whose links to check |

`docs:reference` exits 0 written, current or listed, 1 stale or missing, 2 usage error. `docs:links` exits
0 clean, 1 broken links or unreachable pages.

Every option of `driftbench validate`, for reference (the topic named in the last column explains it):

| Option | Default | Meaning | Topic |
|---|---|---|---|
| `<component>` | required | a registered component, `all`, `floors` or `protect` | `validate-overview` |
| `[level]` | none | only with `floors --raise`: the new floor | `validate-floors` |
| `--seed <n>` | seed 1 when no seed option is given | one visible seed | `validate-overview` |
| `--seeds <a..b>` | none | a range of visible seeds, at most 1000 | `validate-overview` |
| `--hidden` | off | add the hidden seed of the current commit | `validate-overview` |
| `--json` | off | print the report, or the hardness, as JSON | `validate-overview` |
| `--items` | off | compute every level and list the whole bank | `validate-reading-items` |
| `--all-levels` | off | compute every level and list every failing item | `validate-reading-items` |
| `--blind` | off | strip causes and `Fix:` hints (the auditor's view) | `validate-reading-items` |
| `--check-floor` | off | exit 1 when a run is below its floor, else 0 | `validate-floors` |
| `--raise <component>` | none | with `floors`: the component whose floor rises | `validate-floors` |
| `--ladder-version <n>` | none | with `floors --raise`: the ladder version of the floor | `validate-floors` |
| `--evidence <json>` | none | with `floors --raise`: the `--json` run that reaches the level | `validate-floors` |
| `--brief` | off | print the executor brief with the live state | `validate-executor-loop` |
| `--fresh` | off | with `--brief`: leave out the hypotheses | `validate-executor-loop` |
| `--journal <row.json>` | none | append a validated journal row | `validate-executor-loop` |
| `--check-handover` | off | exit 1 when `HANDOVER.md` disagrees with the journal | `validate-executor-loop` |
| `--hardness` | off | print the hardness measurement from the journal | `validate-executor-loop` |
| `--branch <name>` | none | with `protect`: the pull request's branch | `validate-protect` |
| `--base <ref>` | none | with `protect`: the ref it merges into | `validate-protect` |
| `-h`, `--help` | off | print the command's usage | |

## Inputs

The repository checkout. The guard and the boundary test read every tracked file; the API check reads the
built packages (`dist`); the docs checks read `docs/`, `README.md` and the schemas in the packages. The
guard's denylist is private and lives only in CI's secret and local files.

## Outputs and how to read them

* Guard: `driftbench guard: clean (<n> files scanned, <s> skipped, <d> denylist terms).` or one finding
  per line with the file, the line and the kind of data; a denylist finding never shows the term.
* Canary: `driftbench guard canary: ok.` and each check with `caught`, or the check that missed.
* API surface: `The public API matches tools/structure/api-surface.json: <n> exports.`, or
  `The public API differs from tools/structure/api-surface.json.` followed by one `added` or `removed` line
  per name and the instruction: if the change is meant, run
  `node tools/structure/api-surface.mjs --build --write`, commit the file, and name the new or removed
  exports in `CHANGELOG.md`.
* Spec reference: `<page> is up to date.` per page; or `` <page> is stale: it differs from the zod schemas.
  Run `pnpm docs:reference` to regenerate it. ``; or `<page> is missing. ...`.
* Links: `docs: <n> relative links in <p> pages resolve; every page is reachable from index.md.`, or one
  line per broken link (`<file>:<line>  <target>  <reason>`), one per unreachable page, and a count.

## Worked example

The help test runs a validate command here to show the CI job that sits beside these checks (the scratch
folder of the test holds no repository, so the guard cannot run there):

```sh
driftbench validate protect # exit 64
```

```text
Check a pull request with: driftbench validate protect --branch <name> --base <ref>.
```

At the repository root. Shown as text, not run by the help test: the guard reads git (the files it tracks),
and the API and docs checks read `tools/` and `docs/`, which the test's scratch folder does not hold (the API
check also builds every package; it took 265 seconds).

```bash
node tools/guard/guard.mjs --canary
node tools/guard/guard.mjs packages/cli/help
node tools/guard/guard.mjs packages/cli/help --json
node tools/guard/guard.mjs --bogus
node tools/structure/api-surface.mjs --build --check
pnpm -s docs:reference --check
pnpm -s docs:links
```

```text
driftbench guard canary: ok. iban caught, national-number caught, phone caught, email caught, denylist skipped (no terms loaded).
driftbench guard: clean (12 files scanned, 0 skipped, 0 denylist terms).
{
  "clean": true,
  "scanned": 13,
  "skipped": 0,
  "allowed": 0,
  "excused": 0,
  "denylistTerms": 0,
  "findings": [],
  "errors": []
}
driftbench guard: unknown option: --bogus
Usage: node tools/guard/guard.mjs [paths...] [--json] [--canary] [--require-denylist]
Scans for IBANs, Belgian national register numbers, phone numbers, real email addresses
and denylisted terms. Files above 10 MiB fail with a named error.
Exit 0 clean, 1 findings or scan errors, 2 usage error.
The public API matches tools/structure/api-surface.json: 2366 exports.
docs/reference/spec.md is up to date.
docs/reference/family.md is up to date.
docs/reference/campaign.md is up to date.
docs/reference/map.md is up to date.
docs/reference/interview.md is up to date.
docs/reference/criteria.md is up to date.
docs/reference/users.md is up to date.
docs/reference/change.md is up to date.
docs/reference/estate-files.md is up to date.
docs: 1080 relative links in 75 pages resolve; every page is reachable from index.md.
```

The two guard scans of `packages/cli/help` were run at different moments of writing these topics, so they
count 12 and 13 files. The canary skips the denylist check locally because no denylist term is loaded; CI
on main loads them and runs with `--require-denylist`.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| a guard finding of kind email or phone on test data | the data is not in a reserved fictional form | use an address at `example.com` or a phone in 555-0100 to 555-0199; for a value a generator made up, add its fingerprint |
| a guard denylist finding | a client or private term is in the tree | remove it; `guard:allow` does not suppress denylist findings |
| `driftbench guard: unknown option: <x>` (exit 2) | an option the guard does not take | see the usage it prints |
| `The API build is missing or stale. ...` (exit 1) | `--check` without a fresh build | add `--build` |
| `The public API differs from tools/structure/api-surface.json.` (exit 1) | a package's public API changed | make the name private, or record it with `--build --write`, commit the file and name the change in `CHANGELOG.md` |
| `<page> is stale: it differs from the zod schemas. ...` (exit 1) | a schema changed without regenerating | run `pnpm docs:reference` and commit the pages |
| a broken link from `docs:links` (exit 1) | a page or heading was renamed | fix the link, or link the new page from `docs/index.md` |
| a docs test fails on a dash | an em or en dash in a page | write a colon, a comma or two sentences |
