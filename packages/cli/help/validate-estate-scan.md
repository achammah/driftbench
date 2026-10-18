---
title: Reading an estate into a map
summary: Scan an agent estate into atoms, lint it, approve the prose atoms and export its situation axes, with every option and every lint finding.
commands:
  - estate scan
  - estate lint
  - estate approve
  - estate map
see_also:
  - validate-estate-loop
  - validate-estate-plan
  - validate-estate-maintain
next:
  - validate-estate-plan
---

## What it is

Four commands turn an estate folder into an approved map of atoms, the input of every later estate step.

* `estate scan <root>` reads the estate. Code reads the structure (skills, helpers, guards, permissions,
  settings keys, the check registry, the step list, references and their "read when" line, scripts,
  routing tables, gates in four fixed forms, hazard passages and four invariants) and approves those atoms
  as read. A model splits the prose (the standing file, memory files, skill and helper bodies) into
  `instruction`, `gate` and `register` atoms, one call per chunk; each quote is located in its file and
  checked at its span, and an atom whose quote cannot be placed is refused. Model atoms wait for a person.
* `estate lint <map>` checks the estate against its map: orphan files, unreachable files, missing
  references and scripts, the size ceiling, unanchored guards, the check registry, drifted quotes.
* `estate approve <map>` lists the atoms that wait, or approves them by kind, by atom, or all.
* `estate map <map> --to <file>` writes a space map of the situation axes and the approved axis atoms, for
  `driftbench space` and for `estate plan --space`.

An atom id is `kind.scope.slug`, such as `gate.standing.read-a-file-before-editing-it`. Each atom carries its
file, line span, quote and a SHA-256 hash of them; the loader recomputes every hash, so a map whose quote or
span was edited by hand is refused. `approved` and `role` (`axis` or `detail`) may be edited by hand.

## When to use it

* First, on any estate you want to test: scan, then lint, then approve.
* After editing the estate: scan again into a new file and compare with `estate diff`
  (topic `validate-estate-maintain`); a rescan over the old file with `--force` loses its approvals.
* `estate map` only when you want the situation space as a file (to inspect it, edit it, or feed
  `driftbench space`); `estate plan` derives it from the map by itself.

## Commands and every option

```
driftbench estate scan <root> --out <file> [--runtime claude-code] [--replay <file>] [--no-model] [--provider anthropic|openai] [--ceiling <characters>] [--ignore <glob>]... [--force] [--pointer --cassette <file> [--record] [--labeler <class>:<client>[:<model>]]... [--labeler-threshold <p>] [--labeler-pass-at <p>] [--labeler-fail-at <p>] [--labeler-key <variable>] [--jobs <n>] [--labels <file>] [--ledger <file> [--ledger-check]]]
driftbench estate lint <map> [--ceiling <characters>] [--ignore <glob>]...
driftbench estate approve <map> [--kind <kind>]... [--atom <id>]... [--all] [--to <file>]
driftbench estate map <map> --to <file> [--all] [--agent <name>]
```

`estate scan`:

| Option | Default | Meaning |
|---|---|---|
| `<root>` | required | the estate folder; for `claude-code`, the project holding `CLAUDE.md` and `.claude/` |
| `--out <file>` | required | where to write the map (YAML) |
| `--runtime <name>` | `claude-code` | the runtime that reads the estate; `claude-code` is the one runtime |
| `--replay <file>` | none | replay recorded model answers (such as `examples/estates/fixture/answers.yaml`) instead of calling a model |
| `--no-model` | off | read the structured atoms only; no prose atom, no model call |
| `--provider <name>` | the first whose key is set: `ANTHROPIC_API_KEY`, then `OPENAI_API_KEY` (with `OPENAI_MODEL`) | `anthropic` or `openai`, for a live scan (a paid call) |
| `--ceiling <characters>` | `40000` | the size ceiling of the standing instructions |
| `--ignore <glob>` | none | skip the paths this glob matches, beside the defaults and the `ignore:` list of the configuration file; repeat it |
| `--force` | off | replace an existing map; the approvals in it are lost |
| `--pointer` | off | read the prose with the pointer reader (below) instead of the model that quotes it |
| `--cassette <file>` | required with `--pointer` | the recorded labeler answers, JSON lines. With `--record` each answer is appended as it arrives, and the file is rewritten sorted at the end |
| `--record` | off | on a cassette miss, call the labelers and write the answer to the cassette (a paid call; the keys come from the environment) |
| `--labeler <spec>` | the default stack, below | `<class>:<client>[:<model>]`, class `system1` or `system2`; repeat it for one labeler of each class. Clients below |
| `--labeler-threshold <p>` | `0.4` | a system 1 labeler takes the label with the highest probability of yes at or above this, else `none`; the cassette keeps every probability, so a new value needs no new call |
| `--labeler-pass-at <p>`, `--labeler-fail-at <p>` | `0.9`, `0.1` | in a stack, system 1 decides a unit alone from the first probability for a label, or under the second for every label; in between, system 2 decides |
| `--labeler-key <variable>` | none | the environment variable that holds the bearer token of an `http` labeler |
| `--jobs <n>` | `4` | requests in flight at once; the labels, the ledger and the cassette bytes do not depend on it |
| `--labels <file>` | the shipped `agent-rules` set | the label sets, a YAML file |
| `--ledger <file>` | none | the ledger of unit ids; read at the start, rewritten at the end |
| `--ledger-check` | off | with `--ledger`: write nothing, and exit 1 when the ledger is out of date |

`--replay` and `--no-model` do not go together. With neither, the scan calls a model and needs a key.
`--pointer` replaces the model call: it does not go with `--replay` or `--no-model`, and `--cassette`,
`--record`, `--labels`, `--labeler`, `--jobs` and `--ledger` need it.

### The pointer reader

With `--pointer`, code cuts every prose file into units by its structure (a sentence, a list item, a table
cell, a block quote paragraph, a heading, a front matter value; a fence or a comment stays opaque). A
labeler gets a window of numbered units and a label set, and answers a label name or `none` for each unit.
It writes no text. Code copies every quote from the file, so an atom's quote is always a slice of the file.
No word list and no grammar rule decides what is a rule.

* A label set is a YAML list the user writes: a set name, a description, and per label a name, a
  description, up to three examples, an optional `target: required` (the label links two units, such as a
  gate) and an optional `atom: { kind, polarity }` (a unit with this label becomes an atom of that kind).
  The shipped set `agent-rules` is data in this format. `none` is reserved.
* Each unit has a ledger id: ten characters, derived once from the file, the unit's fingerprint and its
  occurrence, then kept in the ledger file as the text changes. The ledger follows a unit through an edit
  (unchanged, moved, changed, split, merged, deleted). It writes no times, so equal ledgers are equal bytes.
  A label is kept with its unit only while the label set and the labelers that made it are unchanged.
* The cassette keeps every labeler answer, keyed by the hash of the whole request and the id of the labeler.
  A changed prompt, set, model, labeler or cut misses, and the error names the field that differs from the
  nearest entry. A scan without `--record` never calls a labeler, so a replay needs no key and no network.
* The answer is checked: a label not in the set, a unit not in the window, a unit named twice, or a target
  where none is allowed is refused and listed. A unit no accepted answer names is counted as unlabeled.
* An atom built from a label is unapproved, `producedBy: model`, with `fields.extraction: pointer`, the unit
  id, the set, the label and the cassette key, and one `prose_pointer` check that a person reviews.
* Before the first request of a `--record` run the scan prints a plan: per labeler, the requests it needs,
  how many the cassette already answers, and the characters left to send. The report ends with the tokens
  each service reported.

#### Two classes of labeler

The labelers are named by the class the judges use (topic `judging-default-judge`).

| Class | What it is | Clients |
|---|---|---|
| `system1` | a yes or no model: one question per unit and label, batched in one request per window, answered with a probability of yes | `openai-decisions[:model]`, the public example; the Nexus platform client, on the [Nexus adapter page](../adapters/nexus.md); `http:<url>`; `module:<path>` |
| `system2` | a chat model that reads the numbered window and answers one label per unit | `anthropic[:model]`, default model `claude-haiku-5-5`; `http:<url>`; `module:<path>` |

The default is a stack of both, a system 1 labeler and a system 2 labeler. System 1 decides a unit alone only
at an extreme: from `--labeler-pass-at` for a label, or under `--labeler-fail-at` for every label. System 2
decides every unit in between. Either class runs alone with one `--labeler`. The ledger records which class
decided each unit, and the report counts them.

The environment holds the keys of a `--record` run: `ANTHROPIC_API_KEY` for `anthropic`, `OPENAI_API_KEY`,
`OPENAI_BASE_URL` and `OPENAI_DECISIONS_MODEL` for `openai-decisions`. A key is never printed or written to
the cassette. The request and answer shapes of `openai-decisions` follow the provider's public description
and no live call has confirmed them here.

#### A labeler of your own

A user labeler fills either class through the same port, by an HTTP endpoint (`--labeler system2:http:<url>`,
with the bearer token in the variable that `--labeler-key` names) or by a module
(`--labeler system1:module:<path>`). It is recorded in the cassette and replayed from it like the others, and
its id is part of every cassette key: for an endpoint, a hash of its address, so a secret in the address never
reaches a cassette; for a module, `module:` and the `id` it exports. The request is one JSON object per window:

```text
system 2:  { set, window, prompt: { system, user } }     answer  { labels: [{ units, label, target? }] }
system 1:  { set, window, state, questions }              answer  { probabilities: { <key>: 0 to 1 } }
```

`set` holds the names, descriptions, examples and targets of the label set, without the atom mapping. `window`
holds the id, the path, the heading path and the numbered units. `prompt` is the ready request of a chat model,
and `state` and `questions` (one question per unit and label, keyed `u<n>__<label>`) are the ready request of a
yes or no model. An answer may add `model` and `usage` (`input_tokens`, `output_tokens`). A module exports an
object, or a function that returns one, with `id`, `cls` (`system1` or `system2`), `label(request)` and
optionally `model` and `family`; it is your code and runs in this process.

`estate lint`:

| Option | Default | Meaning |
|---|---|---|
| `<map>` | required | the estate map |
| `--ceiling <characters>` | `40000` | the size ceiling of the standing instructions |
| `--ignore <glob>` | none | skip the paths this glob matches, as the scan did; repeat it |

`estate approve`:

| Option | Default | Meaning |
|---|---|---|
| `<map>` | required | the estate map |
| (no option) | | list the atoms that wait, per kind, with file, line and the start of the quote |
| `--kind <kind>` | none | approve every atom of this kind; repeat it |
| `--atom <id>` | none | approve this atom; repeat it |
| `--all` | off | approve every atom |
| `--to <file>` | in place | write the approved map to this file, in the same folder, and leave the map read untouched |

Approving in place keeps the file's comments and layout.

`estate map`:

| Option | Default | Meaning |
|---|---|---|
| `<map>` | required | the estate map |
| `--to <file>` | required | where to write the space map (YAML) |
| `--all` | off | take every axis atom, approved or not |
| `--agent <name>` | the estate folder name | the agent the space map describes |

## Inputs

The estate folder. For `claude-code` the reader takes `CLAUDE.md`, `.claude/memory/`, `.claude/skills/*/SKILL.md`
with their references and scripts, `.claude/agents/*.md`, `.claude/settings.json` (model, permissions, the
names of environment keys, never a value, and guards on events), guard scripts with a check registry, and
`.claude/steps.json`. MCP server files, deferred tools and plugin folders are not read yet.

The configuration file `driftbench.estate.yaml` at the estate root, optional, every key optional:

| Key | Read by | Holds |
|---|---|---|
| `ignore` | `scan`, `lint` | globs of paths no runtime loads, skipped beside the defaults (version control, dependency and cache folders, logs, test fixtures, operating system and editor files). Matched like a `.gitignore` line |
| `externals` | `scan` | folders outside the estate a path may name; they replace the defaults `docs/` and `_meta/` |
| `aliases` | `scan` | a map from an alias such as `REF` to the folder or folders it stands for: `REF/a/b.md` reads as `<folder>/a/b.md` |
| `scripts` | `estate unit` | per script path, its fixtures: `args`, `stdin`, `files`, `expect` (`exitCode`, `stdout`, `stdoutIncludes`) |

`examples/estates/reader-cases/driftbench.estate.yaml` is a complete example. A key with the wrong shape is a
note of the scan and is left out.

## Outputs and how to read them

`estate scan` prints `Wrote <file>: <n> atoms (<c> read by code and approved, <m> split from prose by the
model and waiting for approval), <e> edges.`, then the atoms per kind (with how many the model split), the
prose chunks, the model calls, the refused atoms with their reason, the atoms the model repeated that code
had already read, the ignored files, the orphans, the files unreachable from the standing instructions, the
rules no guard enforces, and a `Next:` line. Exit 0 written; 1 written, but a prose chunk failed or an atom
was refused; 2 nothing written.

`estate lint` prints one line per finding, then `<n> findings.` Exit 0 clean, 1 a finding or an invalid map,
2 the map or the estate cannot be read. The codes:

| Code | Meaning |
|---|---|
| `ORPHAN` | nothing in the estate names this file |
| `UNREACHABLE` | no route, reference or dispatch from the standing instructions leads to this file |
| `MISSING_REFERENCE` | a body names a file that does not exist |
| `MISSING_SCRIPT` | a guard runs a script that does not exist |
| `OVERSIZE` | the standing instructions are over the ceiling |
| `UNANCHORED_GUARD` | a guard command finds its script from the working folder, not the project folder |
| `REGISTRY_ROW` | a guard has no row in the check registry |
| `REGISTRY_GUARD` | a registry row names a guard the estate does not run |
| `QUOTE_DRIFT` | an atom's quote is no longer at its span: scan again |
| `AMBIGUOUS_REFERENCE` | a bare file name fits several files, none in the naming file's own folder |
| `UNENFORCED` | rules no guard enforces: reported as a count, never failing alone |
| `EXTERNAL` | paths named outside the estate: information only |

A map that does not load reports `MAP_PARSE`, `MAP_NOT_OBJECT`, `MAP_DUPLICATE_ATOM`, `MAP_UNKNOWN_ATOM`,
`MAP_HASH`, `MAP_QUOTE_DRIFT`, `MAP_UNKNOWN_KIND` or `SCHEMA_*`.

`estate approve` prints `<map>: <n> of <total> atoms wait for approval.` with the list, or
`Approved <n> atoms in <file>; <k> were already approved.`, or `<map>: all <n> atoms are approved.` Exit 0
listed or approved, 1 an invalid map or an unknown kind or atom, 2 options that do not fit.

`estate map` prints `Wrote <file>: 6 situation axes, <n> target dimensions (...), 3 constraints.` and the size
of the full grid. The six axes are the same for every estate: `ask_class`, `ask_shape`, `session_state`,
`owner_signal`, `deviation` (the twelve drift classes D1 to D12, and `none`) and `estate_hazard`; then one
target dimension `atoms.<kind>` per kind with approved axis atoms. Exit 0 written, 1 an invalid map, 2 a
missing file or `--to`.

## Worked example

```sh
driftbench estate scan examples/estates/fixture --no-model --out structure.yaml
driftbench estate scan examples/estates/fixture --replay examples/estates/fixture/answers.yaml --out map.yaml
driftbench estate scan examples/estates/fixture --replay examples/estates/fixture/answers.yaml --out map.yaml # exit 2
driftbench estate lint map.yaml # exit 1
driftbench estate approve map.yaml
driftbench estate approve map.yaml --kind register
driftbench estate approve map.yaml --all --to approved.yaml
driftbench estate approve approved.yaml
driftbench estate approve map.yaml --kind nosuch # exit 1
driftbench estate map approved.yaml --to space.yaml
driftbench estate scan examples/estates/fixture --no-model --out ignored.yaml --ignore '**/references/old-*'
```

What they print, in order (the scans and the approve listing are cut to their main lines; each command's
full output is longer):

```text
Wrote structure.yaml: 68 atoms (68 read by code and approved, 0 split from prose by the model and waiting for approval), 47 edges.
  Atoms per kind:
    gate         4
    route       13
    skill        4
    reference    9
    script       2
    subagent     3
    guard        6
    tool        12
    setting      4
    stage        5
    hazard       2
    invariant    4
  No model call: structured atoms only (--no-model).
Wrote map.yaml: 125 atoms (68 read by code and approved, 57 split from prose by the model and waiting for approval), 54 edges.
  Atoms per kind:
    instruction   43  (43 by the model)
    gate           8  (4 by the model)
    register      10  (10 by the model)
  Model lane claude-opus-5-5 as the estate lane, by hand: 14 prose chunks, 14 calls.
  Refused: none.
  Skipped 2 atoms code had already read:
    CLAUDE.md: atom #5 (gate: Read the matching rules before editing an invoice) repeats gate.standing.read-claude-skills-invoice-reconcile-references
    CLAUDE.md: atom #14 (gate: Read git status before committing) repeats gate.standing.read-git-status-before-commit-to
  Orphans: .claude/skills/invoice-reconcile/references/old-tolerances.md.
  Unreachable from the standing instructions: .claude/agents/inbox-triager.md.
  Unenforced: 54 of 61 rules have no guard.
Next: driftbench estate lint map.yaml; driftbench estate approve map.yaml --kind instruction
map.yaml already exists: pass --force to replace it (the approvals in it are lost).
map.yaml: estate at examples/estates/fixture, 125 atoms.
  ORPHAN             .claude/skills/invoice-reconcile/references/old-tolerances.md: nothing in the estate names this file
  UNREACHABLE        .claude/agents/inbox-triager.md: no route, reference or dispatch from the standing instructions leads here
  MISSING_REFERENCE  .claude/skills/weekly-report/SKILL.md:13 names .claude/skills/weekly-report/references/kpi-definitions.md, which does not exist
  UNANCHORED_GUARD   the guard command "python3 .claude/guards/ledger-guard.py" finds its script from the working folder; anchor it on the project folder
  REGISTRY_ROW       the guard reply-length.py has no row in the check registry
  REGISTRY_GUARD     registry row G6 names supplier-send-guard.py, which no guard of the estate runs
  UNENFORCED  54 rules no guard enforces (trusted; listed by estate scan).
  EXTERNAL    0 named paths outside the estate (information).
6 findings.
map.yaml: 57 of 125 atoms wait for approval.
  instruction: 43
    instruction.standing.never-send-a-supplier-email-without  CLAUDE.md:10  "Never send an email to a supplier without showing the ful..."
    instruction.standing.never-delete-a-ledger-file-archive  CLAUDE.md:12  "Never delete a file under `ledger/`; move it to `ledger/a..."
Approve a kind with --kind <kind>, an atom with --atom <id>, or every atom with --all.
Approved 10 atoms in map.yaml; 0 were already approved.
Approved 47 atoms in approved.yaml; 78 were already approved.
approved.yaml: all 125 atoms are approved.
✗ map.yaml
  (file)  MAP_UNKNOWN_KIND  "nosuch" is not an atom kind: instruction, gate, route, skill, reference, script, subagent, guard, tool, setting, stage, register, hazard, invariant
Wrote space.yaml: 6 situation axes, 8 target dimensions (instruction 43, gate 8, route 13, skill 4, subagent 3, guard 6, stage 5, register 10), 3 constraints.
  The full grid holds 2531567001600 cells: plan on t-wise coverage, not the full grid.
Wrote ignored.yaml: 68 atoms (68 read by code and approved, 0 split from prose by the model and waiting for approval), 47 edges.
  Ignored: 1 file no runtime loads.
    **/references/old-*  1
  Orphans: none.
```

The lint fails on purpose: the Northwind estate carries planted defects. The last scan ignores the orphan
file, so its map reports no orphan.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `error: required option '--out <file>' not specified` (exit 2) | `scan` without `--out` | name the map file |
| `<file> already exists: pass --force to replace it (the approvals in it are lost).` (exit 2) | the map exists | another name, or `--force` |
| `error: --no-model and --replay cannot be used together` (exit 2) | both given | one of them |
| `no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL. Pass --no-model to read the structured atoms only.` (exit 2) | a live scan with no key | `--no-model`, `--replay <answers>`, or a key (a paid call) |
| `MAP_UNKNOWN_KIND` (exit 1) | `approve --kind` with a kind that does not exist | one of the fourteen kinds |
| `MAP_HASH` or `MAP_QUOTE_DRIFT` | the map or the estate was edited after the scan | scan again into a new file |
| `error: required option '--to <file>' not specified` (exit 2) | `estate map` without `--to` | name the space map file |
| `UNREACHABLE` on a helper you use | the helper is reached only through its own description | name it from the standing instructions, a routing table or a skill body |
