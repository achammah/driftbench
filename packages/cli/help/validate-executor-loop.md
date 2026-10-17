---
title: The executor loop
summary: Drive a validator to 100 percent with the brief, the journal, the handover, the hardness measurement and the audit.
commands:
  - validate
see_also:
  - validate-overview
  - validate-reading-items
  - validate-floors
  - validate-protect
  - validate-mutants-and-rulings
next:
  - validate-protect
---

## What it is

An executor is a model session that drives one validator to 100 percent: every item of every level passing
on seeds 1 to 20 and on the hidden seed. It works in iterations. One iteration is one run, one diagnosis,
at most one research pass, one fix, one re-run, one commit, one journal row and one handover update. The
executor keeps its whole memory in files under `validators/<component>/`, so the next executor (or a fresh
session) can continue from the files alone.

Five modes of `driftbench validate` serve the loop:

| Mode | What it does |
|---|---|
| `--brief [--fresh]` | runs the ladder and prints the live state followed by the executor instruction, `validators/EXECUTOR.md`: the text a session starts from |
| `--journal <row.json>` | appends one validated row to `validators/<component>/journal.jsonl` and rewrites the level table of `HANDOVER.md` |
| `--check-handover` | checks that `HANDOVER.md` has every section and agrees with the journal |
| `--hardness [--json]` | prints the hardness measurement from the journal: is this validator hard enough to merge |
| `--items` (a run) | the bank numbers a journal row copies; see `validate-reading-items` |

The executor never edits the validator: its ladders, banks, thresholds, hidden seed, fixtures, floors and
`EXECUTOR.md` are protected from `exec/` branches (`validate-protect`).

## When to use it

* At the start of an executor session: `driftbench validate <component> --brief`.
* Every third iteration, for the handover test: a new session started from
  `driftbench validate <component> --brief --fresh` alone must reproduce the current level within one
  iteration. If it cannot, fixing the handover is the next item.
* At the end of every iteration: write the row JSON, then `--journal`.
* Before pushing: `--check-handover` (CI runs `driftbench validate all --check-handover`).
* When a validator's bank is built, to decide whether it may merge: `--hardness`.

## Commands and every option

```
driftbench validate <component> --brief [--fresh] [--seed <n>] [--seeds <a..b>] [--hidden]
driftbench validate <component> --journal <row.json>
driftbench validate <component|all> --check-handover
driftbench validate <component> --hardness [--json]
```

| Option | Default | Meaning |
|---|---|---|
| `--brief` | off | run the ladder on the given seeds and print the brief |
| `--fresh` | off | only with `--brief`: leave out the handover's hypotheses and the last row's hypothesis (the handover test) |
| `--journal <row.json>` | none | append the row in this file (a path relative to the working folder) |
| `--check-handover` | off | exit 1 when a `HANDOVER.md` is missing, lacks a section, or disagrees with the journal |
| `--hardness` | off | print the measurement of `docs/validators.md` section 12.4 |
| `--json` | off | with `--hardness`: print the measurement as one JSON object |
| `--seed`, `--seeds`, `--hidden` | seed 1 | with `--brief`: the seeds of the run the brief embeds |

Only one of `--brief`, `--journal`, `--check-handover`, `--check-floor` and `--hardness` per command.
`--brief`, `--journal` and `--hardness` take one component, not `all`. `--check-handover` takes one
component or `all`.

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
| `--ladder-version <n>` | default version | select a registered version; with `floors --raise`: the floor version | `validate-floors` |
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

The loop files, all under `validators/<component>/` at the repository root:

| File | Written | Holds |
|---|---|---|
| `journal.jsonl` | by `--journal`, append only | one row per iteration |
| `HANDOVER.md` | rewritten every iteration; its level table by `--journal` | the eight sections below |
| `research.md` | every research pass, append only | question, sources, what others do, what to try, why |
| `audit.md` | by the audit helpers, never by the builder | the four audit verdicts |
| `GATE.md` | only after the owner lowers the bar for this validator | the lowered hardness terms |
| `validators/EXECUTOR.md` | by the maintainer, protected | the static instruction the brief embeds |

`--journal` creates `HANDOVER.md` from its template and `research.md` when they are absent.

### A journal row

One JSON object per line. Every field is required unless marked optional below. The values here are
illustrative:

```json
{
  "iteration": 1,
  "at": "2026-10-14T09:00:00.000Z",
  "model": "sonnet",
  "seeds": ["1", "hidden"],
  "command": "pnpm -s driftbench validate stats --seed 1 --hidden --items --json",
  "level": { "before": 3, "after": 4 },
  "perSeed": [ { "seed": "1", "before": 3, "after": 4 }, { "seed": "hidden", "before": 3, "after": 4 } ],
  "metrics": [ { "level": 4, "id": "analytic", "metric": "estimators and tests matching a constructed truth, enumeration or textbook formula / items", "threshold": 1, "before": 0.98, "after": 1 } ],
  "bankSize": 651,
  "passing": 420,
  "failingByFamily": { "degenerate-domain": 200, "scale": 31 },
  "bankByFamilyTier": { "degenerate-domain": { "2": 400 }, "scale": { "4": 251 } },
  "failingCauses": 60,
  "failingWithoutCause": 0,
  "executor": "builder",
  "failingBefore": ["analytic.unseen.hill-q1.s20-even"],
  "hypothesis": "packages/stats/src/coverage.ts: hill at q=1 mishandles a zero count; analytic.unseen.hill-q1.s20-even proves it",
  "research": null,
  "change": { "files": ["packages/stats/src/coverage.ts"], "commit": "0123abc" },
  "testsAdded": ["packages/stats/test/coverage.test.ts"],
  "result": "raised",
  "durationMinutes": 25,
  "tokenEstimate": 120000
}
```

The rules the append enforces:

* `seeds` are whole numbers as strings or `"hidden"`; `perSeed` holds exactly the listed seeds.
* `level.before` and `level.after` are the minimum over `perSeed`.
* `iteration` is the next one, counting from 0. Iteration 0 is the measurement before any fix and is the
  only row with `result: "baseline"`; a baseline has `before` equal to `after`.
* From iteration 1, `result` is `raised` or `lowered` when the level moved that way, else `unchanged` or
  `stuck`.
* `executor` is optional: `builder` (the default) or `blind` (the audit's blind pilot). Each executor keeps
  its own iteration count: the builder from 0, the blind executor from 0, or from 1 when it starts from the
  builder's iteration 0.
* Bank fields: `passing` at most `bankSize`; `failingByFamily` sums to `bankSize` minus `passing`;
  `bankByFamilyTier` (optional, tiers `"1"` to `"5"` or `"none"`) sums to `bankSize`; `failingCauses`
  (optional) is at most the failing items and at least 1 when any item fails; `failingWithoutCause`
  (optional) goes with `failingCauses` and is at most it. Copy them from the `bank` of an
  `--items --json` run.
* `research` is null or `{ "sources": [...], "finding": "..." }`; `change.commit` is null or 7 to 40 hex
  characters.

A row with `executor: "blind"` is appended and nothing else: the blind executor must neither read nor
shape the builder's handover.

### `HANDOVER.md`

Eight `##` sections, spelled exactly: `Level per seed`, `Floor`, `Open items`, `Hypotheses tried`,
`Next actions`, `Pitfalls`, `How to run`, `Fixtures`. `Next actions` holds at least one numbered action.
`Level per seed` holds the level table between the markers `<!-- level-table:start -->` and
`<!-- level-table:end -->`, one row `| <seed> | <level> |` per seed of the last builder row. `--journal`
writes that table; do not edit it by hand.

## Outputs and how to read them

### `--brief`

Markdown, exit 0. From `pnpm -s driftbench validate stats --brief` at the repository root (the whole brief
runs to several hundred lines), the first heading is `# Brief: validator stats`, then the line
``Generated by `driftbench validate stats --brief` at commit 7193d6db065b. The live state comes first; the static instruction follows it.``
The level-2 headings follow in this order:

| Heading | Holds |
|---|---|
| `Live state: the ladder` | the ladder table, its failing items and the floor, in a fenced block |
| `Last journal row` | the last row of `journal.jsonl`, as JSON |
| `Next actions (from validators/stats/HANDOVER.md)` | the handover's numbered next actions |
| `Hypotheses tried (from validators/stats/HANDOVER.md)` | the handover's hypotheses, left out with `--fresh` |

Last comes the level-1 heading
``Executor instruction (the static part; `driftbench validate stats --brief` prepends the live state)``,
the text of `validators/EXECUTOR.md` with the component filled in.

`--fresh` adds ` (fresh)` to the title and leaves out the hypotheses, both the handover's and the last
row's. With no `HANDOVER.md` yet, the next actions section says the file does not exist yet. A journal
line that does not parse prints `Warning: ...` on standard error and the brief still prints.

### `--journal`

`Appended iteration <n> to validators/<c>/journal.jsonl and rewrote the level table of validators/<c>/HANDOVER.md.`
and exit 0; for a blind row,
`Appended blind iteration <n> to validators/<c>/journal.jsonl; blind row: HANDOVER.md was not touched.`
A refused row prints `Refused: the row was not appended to validators/<c>/journal.jsonl.` then one reason
per line, such as `perSeed: perSeed must hold exactly the seeds listed`, and exits 1. A journal that
already holds an invalid line refuses every append until that line is fixed.

### `--check-handover`

Per component, `validators/<c>/HANDOVER.md: every section present, the level table matches the journal.`,
or the file name and one problem per line: `validators/<c>/HANDOVER.md is missing`,
`the section "## <name>" is missing`, `"## Next actions" holds no numbered action`,
`the level table markers are missing from "## Level per seed"`, or a level table that differs from the
last builder row. Exit 0 when every component passes, else 1.

### `--hardness`

The measurement that decides whether a validator is hard enough to merge (`docs/validators.md` section
12). It reads the journal, not the code:

* `Bank at iteration <n>: <size> items, <k> pass on every seed.` and a table of items per family and tier
  with the failing count, from the latest row.
* `Score at iteration 0` and `Score after the pilot` (the last of iterations 1 to 10).
* `Items fixed per iteration`: the mean over the pilot.
* `Forecast`: the failing items at the end of the pilot over that mean, in iterations.
* `Distinct failing causes after the pilot`.
* `Gate: holds`, or `Gate: NOT MET:` and every reason. The gate holds when the pilot has its ten rows,
  fixed at least one item, forecasts at least 100 iterations, ends at a score of at most 0.4, its last row
  records at least 100 distinct failing causes, and `audit.md` exists with all four checks `pass`. A
  `GATE.md` written after an owner decision may lower three terms with the lines
  `Max score after the pilot: <n>` (above 0.4, under 1), `Min forecast: <n>` (above 0, under 100) and
  `Min distinct failing causes: <n>` (above 0, under 100).
* `Bank minimum at merge (12.1): holds`, or the reasons: at least 300 items, no family under 20, every
  tier 1 to 5 present.
* `Audit: ...`: the four verdicts of `audit.md` (`blind pilot`, `cheater`, `cause review`,
  `planted bugs`), each `pass`, `fail` or `pending`, read from a table row `| <check> | <verdict> | <note> |`
  or a line `<check>: <verdict> <note>`; a check the file does not name prints as missing.
* When the journal holds blind rows, the blind pilot gives the forecast, the score and the causes, both
  pilots print side by side, and a builder pilot more than 1.5 times slower is flagged.

Exit 0 when the gate holds, 1 when it does not, 64 when the journal has an invalid line or no iteration 0.
`--json` prints `{ component, ... }` with the same measurement.

### A real measurement

The repository's own statistics journal, read at its root with `pnpm -s driftbench validate all --check-handover`
and `pnpm -s driftbench validate stats --hardness`:

```text
validators/estate/HANDOVER.md: every section present, the level table matches the journal.
validators/generator/HANDOVER.md: every section present, the level table matches the journal.
validators/judges/HANDOVER.md: every section present, the level table matches the journal.
validators/map/HANDOVER.md: every section present, the level table matches the journal.
validators/stats/HANDOVER.md: every section present, the level table matches the journal.
validators/system/HANDOVER.md: every section present, the level table matches the journal.
Hardness of stats (docs/validators.md section 12.4), from validators/stats/journal.jsonl
Bank at iteration 42: 651 items, 651 pass on every seed.
Family                    tier 1  tier 2  tier 3  tier 4  tier 5  tier none  items  failing
agreement-analytic        0       13      7       0       0       0          20     0
allocation-bruteforce     0       8       0       12      0       0          20     0
binomial-exact            0       10      14      7       0       0          31     0
coverage-simulation       0       0       5       28      0       0          33     0
degenerate-domain         0       79      0       0       0       0          79     0
degenerate-empty          0       23      0       0       0       0          23     0
degenerate-nonfinite      0       72      0       0       0       0          72     0
degenerate-single-equal   0       27      0       0       0       0          27     0
drift-analytic            0       20      0       0       0       0          20     0
edge-accuracy             0       0       7       51      0       0          58     0
estimators-distributions  0       0       24      0       0       0          24     0
missing-method            0       31      15      9       0       0          55     0
numerical-stability       0       0       0       26      0       0          26     0
product                   0       0       0       3       17      0          20     0
reference                 31      0       0       0       0       0          31     0
reproducibility           22      0       0       0       0       0          22     0
scale                     0       0       0       20      0       0          20     0
tests-calibration         0       8       14      0       0       0          22     0
unseen-known              0       0       20      8       0       0          28     0
variance-simulation       0       0       0       20      0       0          20     0
Score at iteration 0: 0.6421 (418 of 651).
Score after the pilot: 0.6851 (446 of 651, iteration 10; 10 of 10 pilot iterations).
Items fixed per iteration: 2.8 (mean over the pilot).
Forecast: 73.21 iterations to 100 percent (205 failing / 2.8).
Distinct failing causes after the pilot: 62 (0 failing items name no cause and count as their own).
Gate: NOT MET: audit.md is absent: no validator merges without the audit (12.7).
Bank minimum at merge (12.1): holds.
Audit: validators/stats/audit.md is absent.
```

The first command exits 0 and the second exits 1. Read the hardness this way: the statistics bank is fully
green now (651 of 651 at iteration 42); its pilot forecast 73.21 iterations and 62 causes, which meets the
lowered bar of `validators/stats/GATE.md` (score 0.7, forecast 70, causes 60); and the gate still fails on
the one remaining term, the missing `audit.md`.

## Worked example

These run in a scratch folder that has no `validators/` loop files, so they show the empty state and the
mode rules:

```sh
driftbench validate stats --hardness # exit 64
driftbench validate all --check-handover # exit 1
driftbench validate stats --fresh # exit 64
driftbench validate all --brief # exit 64
driftbench validate stats --journal row.json # exit 64
```

```text
validators/stats/journal.jsonl: the journal holds no iteration 0 row: run and record iteration 0 first.
validators/estate/HANDOVER.md:
  validators/estate/HANDOVER.md is missing
validators/generator/HANDOVER.md:
  validators/generator/HANDOVER.md is missing
validators/judges/HANDOVER.md:
  validators/judges/HANDOVER.md is missing
validators/map/HANDOVER.md:
  validators/map/HANDOVER.md is missing
validators/stats/HANDOVER.md:
  validators/stats/HANDOVER.md is missing
validators/system/HANDOVER.md:
  validators/system/HANDOVER.md is missing
--fresh goes with --brief.
--brief, --journal and --hardness take one component, not all.
Cannot read the journal row row.json: ENOENT: no such file or directory, open '<scratch folder>/row.json'
```

The loop on a scratch folder. A baseline row (iteration 0) is appended, which creates `HANDOVER.md` and
`research.md` from their templates. A first row for iteration 1 is refused because its `result` does not
match the move of the level; the corrected row is appended. Then the handover check, an audit file, and the
hardness measurement. The rows are illustrative, written by hand in the shape an executor copies from an
`--items --json` run.

```json file=row0.json
{
  "iteration": 0, "at": "2026-10-14T09:00:00.000Z", "model": "sonnet", "seeds": ["1"],
  "command": "driftbench validate stats --seed 1 --items --json",
  "level": { "before": 3, "after": 3 },
  "perSeed": [{ "seed": "1", "before": 3, "after": 3 }],
  "metrics": [
    { "level": 1, "id": "reference", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 2, "id": "degenerate", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 3, "id": "reproducibility", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 4, "id": "analytic", "metric": "items passing / items", "threshold": 1, "before": 0.98, "after": 0.98 },
    { "level": 5, "id": "simulation", "metric": "items passing / items", "threshold": 1, "before": null, "after": null },
    { "level": 6, "id": "scale", "metric": "items passing / items", "threshold": 1, "before": null, "after": null },
    { "level": 7, "id": "roadmap", "metric": "items passing / items", "threshold": 1, "before": null, "after": null }
  ],
  "bankSize": 651, "passing": 646, "failingByFamily": { "edge-accuracy": 5 },
  "failingCauses": 2, "failingWithoutCause": 0,
  "failingBefore": ["edge.rule.mde-defaults"],
  "hypothesis": "the measurement before any fix", "research": null,
  "change": { "files": [], "commit": null }, "testsAdded": [],
  "result": "baseline", "durationMinutes": 3, "tokenEstimate": 0
}
```

```json file=row1-wrong.json
{
  "iteration": 1, "at": "2026-10-14T10:00:00.000Z", "model": "sonnet", "seeds": ["1"],
  "command": "driftbench validate stats --seed 1 --items --json",
  "level": { "before": 3, "after": 7 },
  "perSeed": [{ "seed": "1", "before": 3, "after": 7 }],
  "metrics": [
    { "level": 1, "id": "reference", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 2, "id": "degenerate", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 3, "id": "reproducibility", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 4, "id": "analytic", "metric": "items passing / items", "threshold": 1, "before": 0.98, "after": 1 },
    { "level": 5, "id": "simulation", "metric": "items passing / items", "threshold": 1, "before": null, "after": 1 },
    { "level": 6, "id": "scale", "metric": "items passing / items", "threshold": 1, "before": null, "after": 1 },
    { "level": 7, "id": "roadmap", "metric": "items passing / items", "threshold": 1, "before": null, "after": 1 }
  ],
  "bankSize": 651, "passing": 651, "failingByFamily": { "edge-accuracy": 0 },
  "failingCauses": 0, "failingWithoutCause": 0,
  "failingBefore": ["edge.rule.mde-defaults"],
  "hypothesis": "packages/stats/src/power.ts: the default power of mde is not 0.8; edge.rule.mde-defaults proves it",
  "research": null,
  "change": { "files": ["packages/stats/src/power.ts"], "commit": "0123abc" },
  "testsAdded": ["packages/stats/test/power.test.ts"],
  "result": "unchanged", "durationMinutes": 20, "tokenEstimate": 90000
}
```

The same row with `"result": "raised"`:

```json file=row1.json
{
  "iteration": 1, "at": "2026-10-14T10:00:00.000Z", "model": "sonnet", "seeds": ["1"],
  "command": "driftbench validate stats --seed 1 --items --json",
  "level": { "before": 3, "after": 7 },
  "perSeed": [{ "seed": "1", "before": 3, "after": 7 }],
  "metrics": [
    { "level": 1, "id": "reference", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 2, "id": "degenerate", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 3, "id": "reproducibility", "metric": "items passing / items", "threshold": 1, "before": 1, "after": 1 },
    { "level": 4, "id": "analytic", "metric": "items passing / items", "threshold": 1, "before": 0.98, "after": 1 },
    { "level": 5, "id": "simulation", "metric": "items passing / items", "threshold": 1, "before": null, "after": 1 },
    { "level": 6, "id": "scale", "metric": "items passing / items", "threshold": 1, "before": null, "after": 1 },
    { "level": 7, "id": "roadmap", "metric": "items passing / items", "threshold": 1, "before": null, "after": 1 }
  ],
  "bankSize": 651, "passing": 651, "failingByFamily": { "edge-accuracy": 0 },
  "failingCauses": 0, "failingWithoutCause": 0,
  "failingBefore": ["edge.rule.mde-defaults"],
  "hypothesis": "packages/stats/src/power.ts: the default power of mde is not 0.8; edge.rule.mde-defaults proves it",
  "research": null,
  "change": { "files": ["packages/stats/src/power.ts"], "commit": "0123abc" },
  "testsAdded": ["packages/stats/test/power.test.ts"],
  "result": "raised", "durationMinutes": 20, "tokenEstimate": 90000
}
```

```sh
driftbench validate stats --journal row0.json
driftbench validate stats --journal row1-wrong.json # exit 1
driftbench validate stats --journal row1.json
driftbench validate stats --check-handover
```

```text
Appended iteration 0 to validators/stats/journal.jsonl and rewrote the level table of validators/stats/HANDOVER.md.
Refused: the row was not appended to validators/stats/journal.jsonl.
  result: the level moved, so result is raised
Appended iteration 1 to validators/stats/journal.jsonl and rewrote the level table of validators/stats/HANDOVER.md.
validators/stats/HANDOVER.md: every section present, the level table matches the journal.
```

The audit file, written by the audit helpers (here three of the four checks):

```markdown file=validators/stats/audit.md
| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | 2.1 items fixed per iteration |
| cheater | pass | no score gain from a cheat |
| cause review | pending | 18 of 30 reviewed |
```

```sh
driftbench validate stats --hardness # exit 1
```

```text
Hardness of stats (docs/validators.md section 12.4), from validators/stats/journal.jsonl
Bank at iteration 1: 651 items, 651 pass on every seed.
Family  tier 1  tier 2  tier 3  tier 4  tier 5  tier none  items  failing
Score at iteration 0: 0.9923 (646 of 651).
Score after the pilot: 1 (651 of 651, iteration 1; 1 of 10 pilot iterations).
Items fixed per iteration: 5 (mean over the pilot).
Forecast: 0 iterations to 100 percent (0 failing / 5).
Distinct failing causes after the pilot: 0 (0 failing items name no cause and count as their own).
Gate: NOT MET: the pilot holds 1 of 10 iterations; the forecast 0 is under 100: extend the bank (12.2); the score after the pilot 1 is above 0.4; 0 distinct failing causes after the pilot, under 100: extend the bank (12.2); the audit check cause review is pending; the audit check planted bugs is missing.
Bank minimum at merge (12.1): not met: the row records no bankByFamilyTier, so family and tier sizes are unknown.
Audit (validators/stats/audit.md, section 12.7):
  blind pilot: PASS, 2.1 items fixed per iteration
  cheater: PASS, no score gain from a cheat
  cause review: PENDING, 18 of 30 reviewed
  planted bugs: MISSING
```

Every reason the gate fails is named: the pilot has one row of ten, the bank is already green so nothing is
left to forecast, and the audit is incomplete. `--brief` is not part of this example: it runs the whole
ladder first, which takes minutes.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `validators/<c>/journal.jsonl: the journal holds no iteration 0 row: run and record iteration 0 first.` (exit 64) | `--hardness` with no baseline | measure before any fix and append it as iteration 0 with `result: "baseline"` |
| `validators/<c>/journal.jsonl holds invalid rows:` then one line per bad row (exit 64) | a hand-edited journal line | restore the line from git; rows are only appended with `--journal` |
| `Refused: the row was not appended ...` (exit 1) | the row breaks a rule listed under Inputs | fix the named field; most often `level` is not the minimum over `perSeed`, or `result` disagrees with the move |
| `Cannot read the journal row <file>: ...` (exit 64) | missing file or bad JSON | write the row file first |
| `the section "## <name>" is missing` (exit 1) | `HANDOVER.md` lost a section | add it back with that exact heading |
| `"## Next actions" holds no numbered action` (exit 1) | no `1.` line under Next actions | add at least one numbered action |
| a level table that differs from the journal (exit 1) | the table was edited by hand, or the last row was not appended | append the row with `--journal`; it rewrites the table |
| `validators/EXECUTOR.md is missing: the brief has no instruction to embed the state in.` (exit 64) | `--brief` outside the repository | run it at the repository root |
| `--fresh goes with --brief.` (exit 64) | `--fresh` alone | `--brief --fresh` |
| `--brief, --journal and --hardness take one component, not all.` (exit 64) | `all` with one of them | name the component |
