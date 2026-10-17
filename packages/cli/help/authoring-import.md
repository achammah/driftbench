---
title: Importing specs from tables and traces
summary: 'Get existing test cases and production conversations into driftbench. `import csv` and `import xlsx` turn table rows into specs through a mapping file. `import traces` drafts specs from OpenTelemetry, Nexus or Claude Code traces. `import approve` records a person''s review of the drafts.'
commands:
  - import csv
  - import xlsx
  - import traces
  - import approve
see_also:
  - authoring-spec-format
  - authoring-blocks
  - authoring-prefixes
  - authoring-spec-check
  - authoring-intake
next:
  - authoring-intake
---

## What it is

Two ways to get data in without writing YAML by hand:

- **Tables.** `import csv` reads a `.csv` or `.tsv` file; `import xlsx` reads one sheet of a `.xlsx` workbook. A mapping file says which columns fill which spec and block fields. Rows that share a `group_by` value become the blocks of one spec, in row order. Every spec is checked by the spec loader before anything is written: one invalid row and nothing is written.
- **Traces.** `import traces` reads recorded production conversations. It reads OpenTelemetry spans with the GenAI semantic conventions (`otel`), Nexus platform traces (`nexus`), or a recorded Claude Code session (`claude-code`). Each conversation becomes one draft spec. Each observed user turn is a block; what production observed before it (earlier messages, replies, tool calls and results) is the block's `given.prefix`. No block gets an `expect`: one copied from the observed reply would pass by construction. A person writes each `expect` from the agent's specification, then runs `import approve`.

Personal data in traces is redacted by default (emails, phones, IBANs, national ids, card numbers, addresses). Each value has one placeholder across a conversation, such as `[ADDRESS_1]`.

## When to use it

- Your test cases already live in a spreadsheet: map the columns once and import.
- You want tests from real conversations: import traces, write the expects, approve.
- You want each import kept as a version: `import traces --dataset <name> --store <file>` pushes the drafts as the next dataset version.

## Commands and every option

### driftbench import csv and driftbench import xlsx

```
driftbench import csv <file> --mapping <yaml> --out <dir> [--force] [--json]
driftbench import xlsx <file> --mapping <yaml> --out <dir> [--force] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `<file>` (required) | `csv`: a `.csv` or `.tsv` file, every field text. `xlsx`: a `.xlsx` workbook; numbers and booleans stay typed, a formula gives its cached result. | none |
| `--mapping <yaml>` (required) | The mapping file. | none |
| `--out <dir>` (required) | The folder for the spec files, one `<id>.yaml` per spec. | none |
| `--force` | Overwrite spec files that exist with other content. | off |
| `--json` | Print one JSON document: `source`, `out`, `rows`, and per spec `id`, `file`, `rows`, `blocks`, `hash`. | off |

| Exit code | When |
|---|---|
| 0 | every spec is written |
| 1 | a row makes an invalid spec; each is printed with its rows and the loader's error; nothing is written |
| 2 | bad input. The mapping or the file is bad. Or the format does not match the file. Or a column is missing from the table. Or a spec file exists with other content |

### driftbench import traces

```
driftbench import traces <path> --from otel|nexus|claude-code --out <dir> [--select <ids>] [--prices <file>] [--no-redact] [--force] [--dataset <name> --store <file>]
```

| Option | Meaning | Default |
|---|---|---|
| `<path>` (required) | A trace file, a folder or `-`. A folder means its `.json` and `.jsonl` files, in name order. OpenTelemetry spans from all files are read together. `-` means standard input (`otel` and `nexus` only). | none |
| `--from <source>` (required) | `otel`, `nexus` or `claude-code`. | none |
| `--out <dir>` (required) | The folder for the drafts, named `draft-<source>-<trace id>.yaml`. | none |
| `--select <ids>` | Draft only these traces: comma-separated trace ids. An unknown id exits 2 and writes nothing. | every trace |
| `--prices <file>` | JSON prices in USD per million tokens by model, such as `{"model": {"input": 2, "output": 8}}`, for spans that carry tokens and no cost. | none |
| `--no-redact` | Keep personal data. Never commit such drafts to a public repository. | redaction on |
| `--force` | Replace drafts that exist (their review is lost). | off |
| `--dataset <name>` | After drafting, push the drafts as the next version of this dataset, as `dataset push` does. Needs `--store`. Unchanged traces push no new version. | none |
| `--store <file>` | The store that keeps the dataset version. | none |

Exit 0 when the drafts are written; 2 on a usage or input error or an existing draft without `--force` (nothing written).

### driftbench import approve

```
driftbench import approve <path> [--all]
```

| Option | Meaning | Default |
|---|---|---|
| `<path>` (required) | A draft spec, or a folder of them. | none |
| `--all` | Approve every draft and print the count: sets `metadata.imported.approved: true`. | off: list the drafts not approved |

Exit 0 after listing or approving; 1 when a file is not an imported draft; 2 when the path is missing. You can also approve by hand: set `metadata.imported.approved: true` in the draft.

## Inputs

### The mapping file

| Key | Type | Required | Meaning |
|---|---|---|---|
| `sheet` | string | no | The sheet of a workbook; the first sheet without it. Ignored by `import csv`. |
| `header_row` | whole number from 1 | no | The row that names the columns; default 1. Rows above it are skipped. |
| `group_by` | column name | no | Rows sharing its value become the blocks of one spec, in row order; the `spec` template reads the first row. Without it, every row is a spec of one block. |
| `spec` | mapping | yes | The spec fields (authoring-spec-format). Must give `id`. |
| `block` | mapping | yes | The block fields (authoring-blocks). Must give `user`, `burst` or `when`. |

Unknown keys are errors. Inside `spec` and `block`:

- `"{column}"` in a text takes the cell of that column; `{row}` is the source row number; `{{` writes one `{`.
- A text that is exactly one placeholder, such as `"{question}"`, takes the cell as it is: a spreadsheet number stays a number. An empty cell leaves the field out, and an object left empty is left out too.
- A directive reads one column with options: `{ $column: <name>, $split: "|" }` makes a list, split and trimmed; `$list: true` makes a one-item list of the whole cell; `$as: text|number|boolean|json` converts.
- Anything else is copied as it is.

The Acme mapping, `examples/acme/import/mapping.yaml`:

```text
sheet: Cases
group_by: conversation
spec:
  id: "acme-imported-{conversation}"
  title: "{title}"
  channel: chat
  lang: EN
  target: { adapter: function, agent: acme-sales }
  stages: [address, offer, details, recap, order_placed, callback, handover, closing]
block:
  user: "{question}"
  expect:
    stage: "{stage}"
    must: { $column: must, $split: "|" }
    must_not: { $column: must_not, $list: true }
    tools:
      - label: coverage.check
        count: { max: { $column: max_calls, $as: number } }
```

and its table, `examples/acme/import/cases.csv` (the `Cases` sheet of `cases.xlsx` holds the same rows):

```text
conversation,title,question,stage,must,must_not,max_calls
upgrade,A customer upgrades home internet,"Hello, I'm looking for faster home internet.",address,Acme Telecom|street address,,0
upgrade,,"88 Summit Avenue, Acmeville",offer,Fiber is not available|Acme Air 5G,Fiber (300|1000),1
porting,A customer keeps their number,Can I keep my number if I switch to Acme?,details,keep your number,,0
```

### Trace files

The fixtures in `packages/adapters/test/traces/fixtures/` show each shape: `otel-semconv.json` and `otel-flat.jsonl` (OpenTelemetry spans), `nexus-traces.jsonl` (Nexus traces). A Claude Code session is its JSONL transcript, such as `examples/estates/sessions/clean-build.jsonl`.

## Outputs and how to read them

- `import csv|xlsx` prints:
  - one `✓ <file>  <id> · <n> blocks · rows <r>` line per spec, then `Imported <s> specs from <n> rows of <file> into <dir>.`
  - Each written spec starts with `# Imported from <file>, rows <r>.`
  - An invalid row prints `✗ row <n>: spec <id>: <path> <code> <message>`.
- `import traces` prints:
  - `Read <t> traces from <f> files (<source>): <n> turns.`
  - `Wrote <d> draft specs to <dir>, none approved: <b> blocks, no expect yet.`
  - `Personal data redacted: <n> values.`
  - the next step
  - with `--dataset`, `Pushed dataset <name>@<version> (hash <h>): ...`
  - A draft keeps what production did (reply, tool counts, tokens, cost, latency) in `metadata.imported.observed`, for the review only. Never copy it into an `expect`.
- `import approve`: the drafts not approved yet, or `Approved <n> drafts of <m>.`, or `all <n> drafts are approved.`

`spec lint` warns `BLOCK_NO_EXPECTATION` on every block of a fresh draft: that is the work left for a person.

## Worked example

Import the Acme table from CSV and from the workbook, and check the specs. Then draft specs from an OpenTelemetry and a Nexus fixture. List them, approve them, and push one import as a dataset version:

```sh
driftbench import csv examples/acme/import/cases.csv --mapping examples/acme/import/mapping.yaml --out out/imp/csv
driftbench import xlsx examples/acme/import/cases.xlsx --mapping examples/acme/import/mapping.yaml --out out/imp/xlsx --json
driftbench spec validate out/imp/csv
driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out out/imp/drafts
driftbench import traces packages/adapters/test/traces/fixtures/nexus-traces.jsonl --from nexus --out out/imp/drafts
driftbench import approve out/imp/drafts
driftbench import approve out/imp/drafts --all
driftbench import approve out/imp/drafts
driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out out/imp/d3 --dataset prod-traces --store out/imp/acme.db
```

```text
$ driftbench import csv examples/acme/import/cases.csv --mapping examples/acme/import/mapping.yaml --out out/imp/csv
✓ out/imp/csv/acme-imported-upgrade.yaml  acme-imported-upgrade · 2 blocks · rows 2, 3
✓ out/imp/csv/acme-imported-porting.yaml  acme-imported-porting · 1 block · row 4
Imported 2 specs from 3 rows of cases.csv into out/imp/csv.
(exit 0)
$ driftbench import xlsx examples/acme/import/cases.xlsx --mapping examples/acme/import/mapping.yaml --out out/imp/xlsx --json
{
  "source": "cases.xlsx",
  "out": "out/imp/xlsx",
  "rows": 3,
  "specs": [
    {
      "id": "acme-imported-upgrade",
      "file": "out/imp/xlsx/acme-imported-upgrade.yaml",
      "rows": [
        2,
        3
      ],
      "blocks": 2,
      "hash": "08b354ba9e06"
    },
    {
      "id": "acme-imported-porting",
      "file": "out/imp/xlsx/acme-imported-porting.yaml",
      "rows": [
        4
      ],
      "blocks": 1,
      "hash": "58b6b2c3beee"
    }
  ]
}
(exit 0)
$ driftbench spec validate out/imp/csv
✓ out/imp/csv/acme-imported-porting.yaml  acme-imported-porting · 1 block · hash 58b6b2c3beee
✓ out/imp/csv/acme-imported-upgrade.yaml  acme-imported-upgrade · 2 blocks · hash 08b354ba9e06
Checked 2 specs: 2 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out out/imp/drafts
Read 1 trace from 1 file (otel): 2 turns.
Wrote 1 draft spec to out/imp/drafts, none approved: 2 blocks, no expect yet.
  Personal data redacted: 3 values.
Next: write each block's expect from the agent spec, then driftbench import approve out/imp/drafts --all.
(exit 0)
$ driftbench import traces packages/adapters/test/traces/fixtures/nexus-traces.jsonl --from nexus --out out/imp/drafts
Read 2 traces from 1 file (nexus): 3 turns.
Wrote 2 draft specs to out/imp/drafts, none approved: 3 blocks, no expect yet.
  Personal data redacted: 5 values.
Next: write each block's expect from the agent spec, then driftbench import approve out/imp/drafts --all.
(exit 0)
$ driftbench import approve out/imp/drafts
3 of 3 drafts are not approved yet:
  out/imp/drafts/draft-nexus-cafecafe-0000-4000-8000-000000000001.yaml
  out/imp/drafts/draft-nexus-cafecafe-0000-4000-8000-000000000002.yaml
  out/imp/drafts/draft-otel-conv-acme-0001.yaml
(exit 0)
$ driftbench import approve out/imp/drafts --all
Approved 3 drafts of 3.
(exit 0)
$ driftbench import approve out/imp/drafts
out/imp/drafts: all 3 drafts are approved.
(exit 0)
$ driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out out/imp/d3 --dataset prod-traces --store out/imp/acme.db
Read 1 trace from 1 file (otel): 2 turns.
Wrote 1 draft spec to out/imp/d3, none approved: 2 blocks, no expect yet.
  Personal data redacted: 3 values.
Next: write each block's expect from the agent spec, then driftbench import approve out/imp/d3 --all.
Pushed dataset prod-traces@1 (hash 2d9e25161187): 1 file from out/imp/d3.
(exit 0)
```

The CSV and the workbook give the same specs (same hashes). The approval here is for the demo: on real drafts, write each block's `expect` first, then approve.

## Common errors

```text
$ driftbench import csv examples/acme/import/cases.csv --mapping out/imp/bad-map.yaml --out out/imp/x
The mapping out/imp/bad-map.yaml is invalid:
    unknown key: owner
    spec: needs an id, such as id: "my-spec-{row}"
    block: needs user, burst or when
(exit 2)
$ driftbench import csv examples/acme/import/cases.csv --mapping out/imp/missing-col.yaml --out out/imp/x
the mapping names column "nope", which cases.csv does not have; its columns are conversation, title, question, stage, must, must_not, max_calls
(exit 2)
$ driftbench import csv examples/acme/import/cases.csv --mapping out/imp/invalid.yaml --out out/imp/x
✗ row 2: spec c-upgrade: blocks.0.expect.stage SCHEMA_INVALID_TYPE Invalid input: expected string, received number
✗ row 3: spec c-upgrade: blocks.0.expect.stage SCHEMA_INVALID_TYPE Invalid input: expected string, received number
✗ row 4: spec c-porting: blocks.0.expect.stage SCHEMA_INVALID_TYPE Invalid input: expected string, received number
3 of 3 specs are invalid. Nothing was written.
(exit 1)
$ driftbench import csv examples/acme/import/cases.xlsx --mapping examples/acme/import/mapping.yaml --out out/imp/x
import csv reads a .csv or .tsv file; examples/acme/import/cases.xlsx is not one.
(exit 2)
$ driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out out/imp/drafts
out/imp/drafts/draft-otel-conv-acme-0001.yaml already exists: pass --force to replace it (its review is lost).
(exit 2)
$ driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out out/imp/d2 --select nope
error: no trace named nope in 1 file: nothing written
(exit 2)
$ driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out out/imp/d2 --dataset traces-ds
error: --dataset needs --store <file>
(exit 2)
$ driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --out out/imp/d2
error: --from takes otel, nexus, claude-code
(exit 2)
$ driftbench import approve examples/acme/specs/conversations/plan-upgrade.yaml
✗ examples/acme/specs/conversations/plan-upgrade.yaml: not an imported draft: no metadata.imported
(exit 1)
```

The three mappings used above: `bad-map.yaml` holds `spec: {title: x}`, `block: {expect: {}}` and `owner: me`. `missing-col.yaml` names a column `nope`. `invalid.yaml` maps the number column `max_calls` into `expect.stage`, which takes text.

| Symptom | Fix |
|---|---|
| `The mapping ... is invalid` | follow the mapping table above |
| `the mapping names column ...` | use a column name from the header row, or set `header_row` |
| `has no sheet "<name>"; its sheets are ...` | fix `sheet` |
| `✗ row <n>: ...` and nothing written | fix the mapping or the cell; see authoring-spec-check for the code |
| a spec file `exists with other content` | `--force`, or another `--out` |
| `already exists: pass --force` on traces | `--force` loses the review written in that draft |
| drafts with personal data | keep the default redaction; `--no-redact` only for private stores |
