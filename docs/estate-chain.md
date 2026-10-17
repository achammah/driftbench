# The estate chain, proved by one test

The question is how the whole estate flow fits together. This page answers it with a test, not with prose.

The test is [`packages/cli/test/estate-chain.test.ts`](../packages/cli/test/estate-chain.test.ts). It runs the chain on the fictional Northwind fixture. Ten steps run in order. Each step reads the file the step before wrote. No step calls a model.

Every hand-off is checked by an id or a hash that both steps must agree on. A hand-off that breaks fails the test and names the step.

When a step fails, read the table from the top. The first `NO` row is the broken step. Later `NO` rows can be fallout, because each step reads the files of the steps before it.

## Run it

```
pnpm exec vitest run packages/cli/test/estate-chain.test.ts --reporter=verbose
```

The run calls no model and needs no key. Step 6 is the longest step. It makes 150 runs of the stand-in command. The test works in a temporary folder and removes it at the end. Step 10 prints a table with one row per step. Each row gives the input file, the output file, the id or hash that ties them, and whether the step is verified. A step that fails shows `NO` in that table.

## The chain

The commands run from the repository root. They write into a scratch folder, which git ignores. The test runs the same commands through the CLI entry point, with absolute paths. For some of them it adds `--json`, to read the result as data. That changes only how the result is printed.

```
W=_captures/chain
F=examples/estates/fixture
V2=examples/estates/fixture-v2
FAKE=$F/live/fake
mkdir -p $W
```

In step 6, `$SPECS` stands for the 16 complete live specs that name the instruction. The test runs 59 more, described in the table.

```
SPECS=$(grep -rl -- "^      - instruction.standing.tell-the-user-about-a-late$" $W/generated/specs/live)
```

| Step | Command | Tied to the other steps by | What the test asserts |
|---|---|---|---|
| 1. Scan | `pnpm -s driftbench estate scan $F --runtime claude-code --replay $F/answers.yaml --out $W/map.yaml` | The map hash. | The count line (atoms, read by code, split by the model, edges) matches the file. Every atom id starts with its kind and is used once. Every provenance hash recomputes from the file, the span and the quote. Every quote is in the estate file at its span. The map hash recomputes from the atom hashes and the edges. The map equals `$F/map.yaml` except for its root and its time. |
| 2. Approve | `pnpm -s driftbench estate approve $W/map.yaml --all --to $W/approved.yaml` | The map hash is the same before and after. | The two counts in the output (57 approved now, 68 already approved) equal the flags in `map.yaml`. The approved map differs from the scanned map in the `approved` flags only. The ids, quotes, edges and map hash are the same. A second `estate approve` on the new file says all 125 atoms are approved. The map equals `$F/approved.yaml` except for its root and its time. |
| 3. Space map | `pnpm -s driftbench estate map $W/approved.yaml --to $W/space.yaml --agent northwind` | `version` of the space map is the start of the map hash. | The version is the first 12 characters of the map hash. Every value of every `atoms.<kind>` dimension is an approved axis atom of the approved map, filed under its own kind. No approved axis atom is missing (92 today). The count line matches the file. The space map equals `$F/space.yaml`. |
| 4. Plan | `pnpm -s driftbench estate plan $W/approved.yaml --space $W/space.yaml --out $W/plan.yaml` | `mapHash` and `spaceHash` in the plan. | `mapHash` is the approved map hash. `spaceHash` is the content hash of `space.yaml`. `plan.summary.json` repeats both. Every row names approved atoms of the map. Every cell value exists in the space map, and an `atoms.<kind>` value is an atom of that kind. The rows and the summary equal those of `$F/plan.yaml`. |
| 5. Generate | Approve the rows: `pnpm -s driftbench estate plan approve $W/plan.yaml --all`. Generate: `pnpm -s driftbench estate generate --map $W/approved.yaml --plan $W/plan.yaml --out $W/generated --phrases $F/phrases.yaml --sessions $F/sessions/index.yaml` | `mapHash`, `atoms` and `planRow` in each test. | All rows are approved first. Every test, complete or not, names only atom ids of the approved map. It carries the full map hash. Its `planRow` is a row of the plan, and it holds the atoms, the test type, the mode and the cell of that row. The static and unit tests carry the same three fields. The rows that have a test are exactly the plan rows (1568 today). The report counts equal the files in the folders. The command exits 1 because some specs are incomplete. |
| 6. Mutate and run | Mutate: `pnpm -s driftbench estate mutate $W/approved.yaml --atom instruction.standing.tell-the-user-about-a-late --invert --to $W/mutant`. Run: `pnpm -s driftbench estate run $SPECS --estate $F --runtime claude-code --command $FAKE/claude.mjs --set-env "FAKE_MANIFEST=$PWD/$FAKE/manifest.json" --store $W/original.db --map $W/approved.yaml --states $F/live/states/library.json`. Run again with `--estate $W/mutant`, `--store $W/mutant.db` and no `--map`. | The map hash pins each run. The atom id picks the specs. | The mutant record names the atom. Its original map hash is the approved map hash. Its own map hash differs. Only `CLAUDE.md` differs from the estate, and only on that line. The plan and phrase bank of the original map are refused for the mutant map, with exit 2 and nothing written. The stand-in holds recorded alternatives for two asks, keyed on the quote of the atom. None plays on the original. Both play on the mutant. The test runs 75 specs on the original, pinned to the approved map hash, and on the mutant, pinned to both hashes. They are 16 specs that name the atom, 48 more that carry a changed ask, and 11 controls of other test types. On the original, the 16 pass. On the mutant, the 15 that carry a changed ask fail on the check that the reply says `late`. The outside-trigger control has a neutral ask and stays green. The other 59 specs give the same result on both estates, failing checks included. 17 of them fail on both estates. They are the 2 planted faults of the recorded streams and 15 specs of the carrier-code rule. The recorded stream of that rule runs no `track.sh`. |
| 7. Diff | `pnpm -s driftbench estate diff $W/approved.yaml $V2/map.yaml --old-guards $V2/maintain/guard-state.v1.yaml --out $W/diff.json` | `old.hash` in the diff is the approved map hash. | The new hash is the version 2 map hash. The semantic changes are the route `an-ask-to-plan-the-delivery` and the instruction `tell-the-user-about-a-late`. 24 atoms moved. The counts are 2 added, 1 removed, 1 white space, 2 semantic, 1 restated. The before and after provenance of the instruction equal the atoms of the two maps. The file equals `$V2/maintain/diff.json` except for the old path, the old read time and the new path. |
| 8. Impact | `pnpm -s driftbench estate impact $W/diff.json --tests $V2/tests --out $W/impact.json`. Then the same with `--tests $W/generated/specs --out $W/impact-generated.json`. | The atom ids in `metadata.estate.atoms`, and the two hashes of the diff. | On the version 1 tests: regenerate 4, re-approve 2, retire 1, new 2. The exit code is 1, since four items wait for a person. Each regenerated test names a changed atom in `metadata.estate.atoms`, for the reason given. On the generated specs, the regenerated and retired sets equal what a scan of `metadata.estate.atoms` predicts. The re-approval of the instruction lists the specs that name it (16 today). Specs that name only the respaced rule stay out. |
| 9. Radius | `pnpm -s driftbench radius $W/generated/specs --change $W/change.yaml` | The atom id in the manifest and `metadata.estate.atoms` in each spec. | The radius is not the whole suite. If it were, the test would fail and print the reason the command gives. Every block of a spec that names the instruction is direct, with the reason `prompt:instruction.standing.tell-the-user-about-a-late`. Every other block is out (16 of 1355 blocks are in today). The specs in the radius are the specs that impact names in step 8. |
| 10. Table | `pnpm exec vitest run packages/cli/test/estate-chain.test.ts --reporter=verbose` | The `yes` in each row. | The table has one row for each of steps 1 to 9. Every row says `yes`. One `NO` fails the test. |

The change manifest of step 9 is this file. It names the instruction as a prompt change.

```
from: northwind-v1
to: northwind-v2
changes:
  - kind: prompt
    id: instruction.standing.tell-the-user-about-a-late
    note: R7 tells the user after one late day instead of two
```

## One atom through the chain

The rule R7 is the instruction `instruction.standing.tell-the-user-about-a-late`. It says that a shipment late by more than two days must be reported to the user, with a supplier email proposed.

Step 6 inverts it in a copy of the estate. Version 2 of the estate changes it to one day, so step 7 finds it and step 8 regenerates its tests. Step 9 asks which blocks that change can reach. The same 16 specs answer in steps 5, 8 and 9, which shows that the steps agree.

Replay and the unit runner cannot run R7. A replay reads a recorded session, and a recorded session does not change when the estate does. The three Northwind sessions cover the weekly report only. The unit and static runners cover guards, scripts, invariants and settings. So step 6 uses the stand-in command of the fixture, as [the estate proof](estate.md#unit-live-and-estate-mutants) does.

The stand-in is a script. It calls no model and costs nothing. It plays a recorded stream for each known ask. For two asks, the manifest holds an alternative stream. It plays when the estate copy no longer holds the quote of R7.

In playback mode, the stand-in reads the changed line through those two alternatives only. So those two asks decide which specs can move. The test reads the rules from the manifest and finds their asks. It runs every spec that carries one of them, whether or not the spec names R7. A spec that shares a changed ask but does not name R7 must give the same result on both estates. A collateral change fails the test, and the message names the spec with its result before and after.

## Where the real output differs from estate.md

The test asserts the real output. The estate page shows older numbers for the same commands.

The numbers below were measured on 17 October 2026, with the product code of main at `eb47f5934`, the merge of pull request 680. They move when a later change to the fixture or to the generator lands. These commands of the page were run as the page writes them, from the repository root: `estate scan`, `approve`, `map`, `plan`, `plan approve`, `generate`, `diff` and `impact`. Each output was compared with the output block of the page. The `spec lint` command was run on the folder that `estate generate` wrote, because the folder the page names does not exist.

| Command | The estate page says | The real output on `eb47f5934` |
|---|---|---|
| `estate scan` | 122 atoms, 54 split by the model, 40 instruction atoms | 125 atoms, 57 split by the model, 43 instruction atoms |
| `estate scan` | 10 prose chunks and 10 calls, 51 of 58 rules without a guard | 14 prose chunks and 14 calls, 54 of 61 rules without a guard |
| `estate approve` | 54 of 122 atoms wait, 40 of them instructions | 57 of 125 atoms wait, 43 of them instructions |
| `estate approve --all --to`, after `--kind register` | Approved 44 atoms, 78 already approved | Approved 47 atoms, 78 already approved |
| `estate map` | 40 instruction targets, a grid of 1992646656000 cells | 43 instruction targets, a grid of 2531567001600 cells |
| `estate plan` | 1338 rows: 348 from the contract, 980 pairwise | 1568 rows: 361 from the contract, 1197 pairwise |
| `estate plan` | 1205 cells, 4710 of 4710 pairs covered, 51 unenforced rules, 1205 cells without a phrase | 1429 cells, 5092 of 5092 pairs covered, 54 unenforced rules, 1429 cells without a phrase |
| `estate plan`, rows per kind and per type | instruction 120, obligation 480, outside_trigger 40, twin 40, ordered_pair 96, route_positive 227, dispatch 36, guard_positive 72, stage_order 59, register_sample 180 | instruction 129, obligation 603, outside_trigger 43, twin 43, ordered_pair 112, route_positive 260, dispatch 42, guard_positive 84, stage_order 69, register_sample 200 |
| `estate plan`, settings | A line says the 4 settings have no mandatory test | `setting` has 4 rows in both lists, and the line is gone. The settings run as static tests. |
| `estate plan approve` | 1338 rows, all proposed. `--all` approves 1337. | 1568 rows, all proposed. `--all` approves 1567. |
| `estate generate` | 1379 rows, 813 complete, 566 incomplete | 1568 rows, 1360 complete, 208 incomplete |
| `estate generate`, rows per test type | A table of 27 test types, such as obligation 516 | 20 of the 27 types have other counts, such as obligation 603. The real table adds a `setting` line. |
| `estate generate`, asks | 298 approved phrases, 515 asks written by code, 0 with no ask | 433 approved phrases, 919 asks written by code, 8 with no ask |
| `estate generate`, outcomes | 575 bank, 23 no-change:guard, 22 no-change:negative, 27 no-change:read-only, 166 no-delete | 981 bank, 2 no-change:denied, 27 no-change:guard, 58 no-change:negative, 17 no-change:read-only, 267 no-delete, 8 static |
| `estate generate`, gaps | Nine gap lines, among them needs-registered-check 460, needs-some-call-check 56, needs-ordered-anchor 26 | Five gap lines: needs-askable-act 185, needs-existing-file 2, needs-ordered-anchor 15, needs-recorded-session 6, needs-registered-check 1 |
| `estate generate`, files | Wrote 1381 files | Wrote 1596 files |
| `estate generate`, exit text | It exits 1: 1103 specs are incomplete. The table above it says 566. | 208 specs are incomplete. |
| `estate generate`, the spec example | Map hash `ab256ba636f4`, in the header comment, in `map_hash` and in `mapHash` | Map hash `be2e7a0919cb` |
| `spec lint --strict`, on the specs folder that `estate generate` wrote | Checked 235 specs, all valid | Checked 1352 specs, all valid |
| `estate diff` | 93 atoms unchanged, map hashes `ab256ba636f4` and `48cac5d0c4c3` | 96 atoms unchanged, map hashes `be2e7a0919cb` and `a5c8cb21f4ae` |
| `estate impact` | Map hashes `ab256ba636f4` and `48cac5d0c4c3` | Map hashes `be2e7a0919cb` and `a5c8cb21f4ae` |

Some differences are not numbers.
* The real `estate scan` prints a `Prose:` line and an `Ignored:` line that the page lacks.
* The list of unenforced rules in the `estate scan` output has 3 more lines than the page. They are rules of the `invoice-reconcile` skill: `a-line-matches-on-article-code`, `under-0-05-eur-per-unit` and `an-invoice-line-with-no-order`.
* The real `estate generate` prints four more lines. They give the judged specs (201), the static tests (8), the unit tests (26) and the catalogue checks.
* The `Seed` line of `estate generate` names ten registered checks. The page names one.
* The page runs `estate generate` with `--out _captures/docs/estate/generated`. It then lints `_captures/docs3/estate/generated/specs`, a folder that does not exist after the first command.
* The paths on the first four lines of the `estate generate` output have one `../` less on the page than in the real output.

The page and the real output agree on the other lines of these blocks. The page also says that the written plan and summary are byte for byte the committed files. That holds for the command of the page, which has no `--space`. The chain passes `--space`, and then only the `spaceHash` line differs. The committed plan hashes the map's own space map, whose agent name is `estate`. The chain hashes the file of step 3, whose agent name is `northwind`.

Not run: `estate lint`, `estate scan --no-model`, `estate impact --write` and `estate impact --replay`. The hand plan proof was not run either: `estate generate` with the hand plan, then `driftbench replay`. The prose of the page holds more counts that follow the numbers above. The 235 complete specs and the 336 `needs-some-call-check` specs are two. They were not recounted.

## What the test does not prove

* It does not show that a model follows the estate. The red result of step 6 comes from a recorded alternative in the stand-in's manifest. It shows that the chain picks the right specs and that the run notices the change. It does not show that a model reads the rule.
* A person who played the model wrote the recorded scan answers.
* It does not run `estate unit` or `estate static`. They have their own tests.
* It stops at the radius. It does not rerun the cells in the radius after the change.

See also: [testing an estate](estate.md), [blast radius](concepts/blast-radius.md), [change manifest reference](reference/change.md), [estate files reference](reference/estate-files.md).
