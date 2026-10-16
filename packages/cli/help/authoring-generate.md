---
title: Generating specs from the map
summary: '`generate` writes a suite of specs from an approved map, by the generator alone with no model call. The suite holds stage-graph paths, a t-wise covering array, boundary values, one probe per deviation class, metamorphic families, task-family instances, and a cover pass. `--model` adds model proposals that count only once the gate accepts them.'
commands:
  - generate
see_also:
  - results-select
  - authoring-extract
  - authoring-covering-arrays
  - authoring-gate
  - authoring-task-families
  - authoring-map
  - authoring-space-coverage
next:
  - authoring-covering-arrays
---

## What it is

`generate` reads an approved map (an `extract` proposal whose every entry is approved) and writes specs. Code enumerates everything; no model is called unless `--model` is given. Each generated block carries a machine Then (stage reached, tool calls and inputs, end state, recovery). The Then comes from the map's approved relations, never from an agent's reply.

Seven seeders each write specs:

| Seeder | What it writes |
|---|---|
| `graph` | one spec per approved path: the stage graph walked along the paths |
| `twise` | a covering array at strength `--t` over the axes; each row walks an approved path of its flow. With `--budget`, budget rows replace it (see authoring-covering-arrays) |
| `boundary` | one spec per value of every detail data dimension (tool argument and result partitions), on a path that needs it |
| `deviation` | one probe per deviation class, injected at a stage of a path whose flow has a recovery for the class. After `cover`, a class probed far less than the most probed one gets more probes (`gen-deviation-balance-NNN`) |
| `metamorphic` | families of specs that differ only in the phrasing of one value, with the same Then |
| `task` | the instances of every task family a `task_family` relation names, with their corner and planted variants (see authoring-task-families) |
| `cover` | runs last: one scenario for each allowed pair no complete spec of the other seeders covers |

A spec is complete when every block has an approved phrase for its user turn and a machine Then. Others are incomplete: a value with no approved phrase leaves a placeholder; a cell the map supports no Then for is listed with the reason. Complete specs go to `specs/<seeder>/`, incomplete ones to `incomplete/<seeder>/`.

Every seeded choice comes from `--seed`: the same map and seed give the same suite, byte for byte.

## When to use it

- After approving a map, to get a suite that covers it systematically.
- After the map changes, to regenerate (`--force` replaces the earlier output).
- Before the gate: `gate` then rejects the blocks that cannot discriminate a good agent from a faulty one.

## Commands and every option

### driftbench generate

```
driftbench generate --map <file> --out <dir> [--t <n>] [--seed <n>] [--max <n>] [--budget <n>] [--spec-cap <n>] [--spec-cap-mode tuples|pairs] [--tasks <n>] [--baseline <path>]... [--force] [--json]
                    [--model --reference <adapter:agent>... --faults <set> [--proposals <n>] [--k <n>]]
```

| Option | Meaning | Default |
|---|---|---|
| `--map <file>` (required) | The approved map: a proposal whose every entry is approved. Not a space map. | none |
| `--out <dir>` (required) | The folder for `specs/`, `incomplete/` and `generate-report.json`. Must be a folder, not a file. | none |
| `--t <n>` | Strength of the covering array, whole number from 1. | 3 |
| `--seed <n>` | Integer seed of every seeded choice, from 0. | 1 |
| `--max <n>` | The most specs per seeder, from 1. A seeder cut by it makes the exit 1. | no cap |
| `--budget <n>` | Budget mode: n conversations in place of the t-wise rows, placed by pair coverage, then value balance. Adds a `budget` block to the report. Required for approved `numeric_settings`. | off |
| `--spec-cap <n>` | Total written specs. Keeps every graph, boundary, deviation, metamorphic, task and incomplete spec; selects complete t-wise and cover specs by actual coverage. A cap below the protected count is refused. | no cap |
| `--spec-cap-mode <mode>` | `tuples`: preserve pairs and triples; `pairs`: preserve pairs, report triple losses. Needs `--spec-cap`. | `tuples` |
| `--tasks <n>` | Instances built per `task_family` relation, each with its variants. | 8 |
| `--baseline <path>` | Specs to measure on the same map, for comparison. Repeat it. Every baseline spec must be valid. | none |
| `--force` | Replace the output of an earlier run in the folder (`specs/`, `incomplete/`, `generate-report.json`). | off |
| `--json` | Print the report as JSON instead of the summary. | off |
| `--model` | Also ask the model port for specs; each counts only once the gate accepts it. Paid. Needs `--reference` and `--faults`. | off |
| `--proposals <n>` | With `--model`: how many specs to ask for. | 3 |
| `--reference <adapter:agent>` | With `--model`: a reference agent the gate runs on. Repeat it. | none |
| `--faults <path>` | With `--model`: the fault set the gate plants (see authoring-gate). | none |
| `--k <n>` | With `--model`: repeats on the reference for pass^k in the gate. | the gate's default, 5 |

`--proposals`, `--reference`, `--faults` and `--k` without `--model` are an error. `--model` reads `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`.

| Exit code | When |
|---|---|
| 0 | the suite is written, and every block has an approved phrase and a Then |
| 1 | the suite is written with incomplete specs, a seeder cut by `--max`, or a spec cap that could not preserve its target. Or the suite is written with a generator defect (an invalid spec, a lint finding, a refused task family). Each case is listed. Or the `--model` call failed |
| 2 | usage or input error, nothing written. Causes: an invalid or unapproved map, a bad number, an invalid baseline, an earlier output without `--force`, a spec cap below the protected count |

## Inputs

- The approved map (authoring-extract). Its relations decide the Thens: `path`, `uses_tool`, `states`, `binds`, `recovery`, `reply_language`, `task_family`. Its approved phrases become the user turns; `{slot}` in a phrase is filled from the cell's `binds`.
- Task families the map names, relative to the map (authoring-task-families).
- Optional baseline specs.

## Outputs and how to read them

Files under `--out`:

| Path | What it holds |
|---|---|
| `specs/<seeder>/gen-<seeder>-NNN.yaml` | complete specs, ready for `gate` or `campaign run` |
| `specs/task/.seed-<spec id>/` | a task workspace that holds a binary file, beside its spec |
| `incomplete/<seeder>/...` | specs with a placeholder or a block with no machine Then |
| `generate-report.json` | everything below, in full |

Each generated spec opens with comment lines naming the seeder, the seed and the map hash. It carries `version: <map hash>`, `tier: generated`, tags (`flow:`, `persona:` and the like), `covers`, the stage list, and two non-gating criteria (`behaviour.<id>`, `flow.<id>`). Do not edit generated specs; change the map and generate again.

The printed summary, line by line:

- `Actual axis-map coverage (written complete specs): pairs <a> of <b>; triples <c> of <d>.` What the written complete specs cover on the axes.
- `Candidate t-wise array (before the total cap): covering array of <rows> rows over <k> dimensions, <x> of <y> allowed t-tuples; <n> pairs no path reaches are left out.` In budget mode: `Candidate budget array ...` with pairs covered and the largest deviation from fair share.
- `Uncovered on the axis map: ...` with where to find the list in the report.
- `Map <agent> (<path>), hash <12 hex>: ...` and `Seed <s>, t = <t>.`
- The seeder table: specs, blocks, complete, incomplete per seeder.
- `Stage graph: <e> of <E> edges covered in <p> paths from <start>.`, `Constraints applied`, `Deviation probes: <n> of <N> classes. Metamorphic families: <m>.`
- `Coverage on the axis map at t = <t>: complete specs ..., all specs ...`, plus one entry per `--baseline`.
- With `--spec-cap`: `Spec cap <n>: <w> of <c> candidate specs written; <p> ... protected.`
- `Values with no approved phrase (<n>): ...`: approve a phrase for each to make its block complete.
- `Approved phrases no walk could say (<n>), listed under no_phrase:` each phrase with the first reason. The report's `no_phrase` entry holds it under `unsaid` with every reason.
- `Specs with a block the map supports no machine Then for (<n>), in incomplete/: ...` then `Most frequent reasons`. Each names the relation or value the map lacks.
- `Wrote <n> files to <dir>.`

`generate-report.json` keys: `generator`, `map` (path, agent, version, hash, counts), `options`, `summary` (`specs`, `blocks`, `complete`, `incomplete`), `seeders` (per seeder, with `cut`), `graph`. More keys: `twise` (`t`, `dimensions`, `rows`, `allowed`, `covered`, `share`, `unreachable`), `boundary`, `deviation`, `metamorphic`, `cover` (with `unbuilt`), `constraints`. Also `no_phrase` (with `unsaid` for an approved phrase no walk could say) and `no_then`. Then `coverage` (`actual` with every uncovered tuple, `t`, `allowed`, `complete`, `all`, `measures`, and `baseline` when given), `invalid`, `lint`. The report also has `budget` and `spec_cap` when used.

With `--model`, `generate` also writes `<out>/proposed/`. It holds `candidates/` (the valid proposals), `gated/` (the gate's output on them) and `proposals.json`. It also prints these lines:

- `Model proposals: <n> written by <family> <model>, each through the gate.`
- One row per proposal (`counted` or `rejected`, blocks accepted, the gate stage that refused it).
- `Counted <c> of <n> proposals.`

A proposal's `target` is dropped, so the gate runs it on the first `--reference`.

## Worked example

The approved Acme map at strength 2 (no model call):

```sh
driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/t2 --t 2 # exit 1
```

```text
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/t2 --t 2
Actual axis-map coverage (written complete specs): pairs 708 of 708 (100.0%); triples 2928 of 4064 (72.0%).
Candidate t-wise array (before the total cap): covering array of 156 rows over 5 dimensions, 356 of 356 allowed 2-tuples (100.0%); 2 pairs no path reaches are left out.
Uncovered on the axis map: 0 pairs, 1136 triples (see coverage.actual[].uncovered).
Map acme (../../../examples/acme/map/approved.yaml), hash 7c05b9cee9cc: 51 dimensions, 187 values, 463 constraints, 55 approved phrases.
Seed 1, t = 2.

Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           156     793       153           3
boundary         85     183        13          72
deviation        21     111        21           0
metamorphic      42     192        42           0
task             67      71        67           0
cover            24     135        24           0

Stage graph: 18 of 23 edges covered in 12 paths from needs.
Constraints applied: 463.
Deviation probes: 12 of 12 classes. Metamorphic families: 21.
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%).

Values with no approved phrase (72): their blocks are placeholders in incomplete/.
  catalog.search.in.category=catalog.search.in.category.mobile  1 block(s)
  catalog.search.in.category=catalog.search.in.category.home  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.below-min-length  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.at-min-length  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.absent  1 block(s)
  catalog.search.in.address_id=catalog.search.in.address_id.present  1 block(s)
  catalog.search.in.address_id=catalog.search.in.address_id.absent  1 block(s)
  catalog.search.in.unknown-key=catalog.search.in.unknown-key.sent  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.empty  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.one-item  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.several-items  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.present  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.null  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.absent  1 block(s)
  coverage.check.in.address=coverage.check.in.address.below-min-length  1 block(s)
  ... 57 more in generate-report.json

Specs with a block the map supports no machine Then for (18), in incomplete/: gen-twise-108, gen-twise-109, gen-twise-114, gen-boundary-008, gen-boundary-017, gen-boundary-031, gen-boundary-046, gen-boundary-060, gen-boundary-067, gen-boundary-068, ....
  Most frequent reasons:
     3  it needs user_type in existing-customer; the cell holds new-customer
     3  the constraints allow no value of port_result it needs with this cell
     2  it needs coverage_result in fiber, 5g-only; the cell holds none
     2  it needs coverage_result in fiber; the cell holds none
     2  it needs coverage_result in no-service; the cell holds none
     1  no approved path needs callback_phone=not-given
     1  no approved path needs catalog.search.in.unknown-key=catalog.search.in.unknown-key.sent
     1  no approved path needs coverage.check.in.unknown-key=coverage.check.in.unknown-key.sent
Wrote 504 files to out/authoring-generate/t2.
(exit 1)
```

Exit 1: 75 specs are incomplete (72 values have no approved phrase; 18 specs need a relation the map lacks). The 332 complete specs cover all 708 allowed pairs.

With `--baseline`, the coverage line also measures other specs on the same map (`--force` replaces the earlier output):

```sh
driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/t2 --t 2 --baseline examples/acme/specs --force # exit 1
```

```text
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/t2 --t 2 --baseline examples/acme/specs --force
...
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%), examples/acme/specs 237 (33.5%).
...
Wrote 504 files to out/authoring-generate/t2.
(exit 1)
```

The seven hand-written specs cover 237 of the 708 pairs. `--model` is not run here: it makes paid calls.

## Common errors

```
$ driftbench generate --map examples/acme/map/proposal.yaml --out out/authoring-generate/x
✗ examples/acme/map/proposal.yaml  MAP_NOT_APPROVED
291 of 291 entries are not approved; approve them first (driftbench extract approve).
(exit 2)
$ driftbench generate --map examples/acme/map/space.yaml --out out/authoring-generate/x
✗ examples/acme/map/space.yaml  MAP_INVALID
  version  SCHEMA_INVALID_VALUE  this reader knows proposal version 1
  produced_by  SCHEMA_INVALID_TYPE  Invalid input: expected object, missing
  (1269 more lines)
  (file)  SCHEMA_UNRECOGNIZED_KEYS  unknown keys: inventory, prior
The map is invalid, so nothing was generated.
(exit 2)
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/x --t 0
--t must be a whole number of at least 1, got "0".
(exit 2)
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/x --spec-cap-mode pairs
--spec-cap-mode requires --spec-cap and must be tuples or pairs.
(exit 2)
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/x --model
--model gates every proposal: give --reference <adapter:agent> and --faults <set>.
(exit 2)
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/x --k 3
--proposals, --reference, --faults and --k go with --model.
(exit 2)
$ driftbench generate --map examples/acme/map/approved.yaml --out out/authoring-generate/x --baseline nowhere
1 baseline spec(s) are invalid; run driftbench spec validate on them.
(exit 2)
```

| Message | Cause | Fix |
|---|---|---|
| `MAP_NOT_APPROVED` | entries of the proposal are not approved | `driftbench extract approve <map> --all`, or approve entries one by one |
| `MAP_INVALID` with `this reader knows proposal version 1` | a space map was passed | pass the approved proposal; space maps are for `space` commands |
| `<report> already exists: an earlier run wrote this folder. Pass --force to replace its output.` | the folder holds an earlier run | `--force`, or another `--out` |
| `--out names <path>, which is a file: give a folder.` | `--out` is a file | give a folder |
| `Cannot generate: --spec-cap <n> is below the <p> protected structural, fault and incomplete specs; none can be trimmed` | the cap is under the protected count | raise the cap |
| `✗ the task family <path> builds no spec: <reason>` | a family the map names does not load, uses an unapproved phrase, or has a missing, invalid or stale review | fix the family (see authoring-task-families) |
| `The model proposals failed: <why>` | `--model` could not get an answer (no key, a network error) | set the key, or drop `--model` |
| many `Values with no approved phrase` | the map has values with no approved phrase | add and approve phrases in the map, then generate again |
