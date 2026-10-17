# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 14 |
| 2 | 14 |
| 3 | 14 |
| hidden | 8 |
<!-- level-table:end -->

## Current climb: iteration 22

D6 product change committed (`90832b3d5`), per the D6 maintainer ruling: an approved instruction of a class the users package carries in the world is the content of a supplied workspace file (`NOTES.txt`, first unused name), the injected turn says nothing, held files are kept, and a probe block's file lasts for its own turn. Measured with `validate generator --seeds 1..3 --hidden --json` at that commit (`.exec/d6-after.json`): seeds 1, 2, 3 at 14 (from 11, 12, 11); the hidden seed of that commit (425515389) at 8. A first version kept the file for later turns: seed 2 then failed `fault.D6.says-skipped` (r2 and r3 instances fired on later turns with no must_not), so the file now lasts one turn.

* Level 15 on seeds 1, 2, 3 fails only `sequence.stages.D8_tool_failure`. It asks for D8 probes at stages the rendered map forbids: `render.ts:542` adds `possible.ts` impossible pairs, which forbid `{deviation: D8_tool_failure, stage: <stage>}` exactly at the stages the item lists, while the item reads `hidden.constraints` only (`bank2.ts:288-294`). Sent to the lead for a ruling (item 14 below); no product change.
* Hidden 425515389 fails `phrases.behaviours` (3 of 6 behaviour phrases unsaid). PRs 475 and 507 say all 6 on that seed; not caused by the D6 change.
* All levels on seed 2 at `90832b3d5` (`--all-levels`, `.exec/all-s2.json`): levels 1 to 14, 17, 20, 21 and 22 pass. The other failures are all on the rulings list below: 15 `sequence.stages.D8_tool_failure` (item 14); 16 `allocation.stage.present`, `ratio`, `evenness`, `hill1`, with opening at 0 placements (item 7); 18 `minimal.*`, 54 of 55 (item 4); 19 `contrast.read`/`list.integer.at-minimum-above-minimum` (item 2) and `contrast.write.integer.*` (item 1). No product-only change is left for seed 2 without a ruling.
* The Acme reference agent passes the regenerated Acme suite only with PR 514 (file and tool-result guard); without it the 26 D6 blocks of `acme-generated.test.ts` fail. This branch depends on PR 514.

## Earlier: iteration 21

Follow-up coverage: branch rebased onto maintainer D8 contract `30e038ed5` (PR 511). No D8 production edit is needed: generation already preserves the rendered exact count. Independent Zed Bank tests now cover exact retry count, pending stage and failure text on ordinary and self-loop paths; the same non-bank map verifies perturbation placement after a restatement. Restoring the old restatement exclusion makes both placement tests fail. Focused tests pass 64/64, including real mode-P reference/fault runs on seeds 1 through 8. Evidence: `.exec/d8-modep-tests.log`, `.exec/nonbank-restated-red.log`.

General product contract: an approved read-input correction must still use the latest value after a deviation; inserted turns must not shift a perturbation to the wrong stage (`docs/generating.md:287,289`, `docs/reference/spec.md:666`). Product code contains no validator seed, item id, fixture name or bank value. Before a level-lifting PR, add four-seed CI evidence, seeds 4-8 and a fresh hidden seed, plus these generality checks to its body. The owner routes the new minimum to the floors maintainer; never edit the protected floor on this branch.

D6 attempt is parked, uncommitted, in `.exec/parked-d6/{assemble.ts,instruction-carrier.ts,instruction-carrier.test.ts}`. It passes real reference/fault checks but exposes conflicting validator contracts: `diff.phrases.filled` rejects the empty user text required by `perturbation.carrier.D6_instruction_in_data`; `bank3.ts` also counts only user-carried phrases. Seed 2 falls to level 1 with 24 rejected empty turns (`.exec/carrier-after.json`). Await the maintainer ruling before restoring or committing the carrier change. Generated Acme fixtures and categorical hashes would then need regeneration; the phrase provenance product test must check the actual carrier.

Inherited work: the stopped author handed over PRs 475, 507, 508 and 510. Read `scratchpad/codex/HANDOVER-claude-generator-exec.md` in the owner's session directory. PR 508's before/after sweep jobs 38784363114 and 38784365861 are queued as last checked. Complete its table when they finish. Then investigate true invariance pairs on seeds 3/5/18, seed 18 behaviour coverage and the handed-over slot-phrase ruling. Do not modify protected validator code on this branch.

This section supersedes the historical measurements and diagnoses below. Starting commit `14034c6ca`, measured with `validate generator --seeds 1..3 --hidden --json`: seed 1 = 11, seed 2 = 12, seed 3 = 11, hidden (336760492) = 9. Evidence: `.exec/baseline.json`. The prior handover's level 8 was stale.

Iteration 21 measures seed 2 only: level 12 remains, but `mode.P.X2.slot-first` now passes. The sole level-13 failure is `perturbation.carrier.D6_instruction_in_data`. Evidence: `.exec/restated-after.json`. No levels above 13 are measured yet. Restated-slot scenarios now declare approved perturbations, indexed after the inserted earlier-value turn; their tool-failure stage comes from the actual block. The regression was red with zero restated perturbations and passes on seeds 1, 2 and 3.

Active branch: `feat/generator-climb`, one worktree in the owner's `scratchpad/astra-gen-climb`. Only generator tests and validator runs are authorized. No paid calls. Keep the worktree and dependencies until the last push.

Coordination: PR 475 and its author's follow-up own phrase handling in `scenario.ts` and `phrase-seeder.ts`. They cover hidden B-003 and seed 13 fact-flip. Do not change those sections. The owner permits tool-failure and world-carrier changes in `scenario.ts`. Persona/channel invariance on seeds 12/13/18 is a separate maintainer fix.

`adequacy.D8.advance` is with the maintainer on `fix/generator-d8-retry-contract`. Seed 1 `gen-cover-021`, block 2: reference and mutant have identical check stage, text and input; reference calls lookup twice, mutant once; both satisfy `{max:2}`. Recovery level 13 also requires that exact count object. Evidence: `.exec/d8-evidence.jsonl`; sent to the owner. Await the product contract; never edit the validator item.

World-carrier diagnosis: approved D6 text is emitted as user text. The canonical `world-instruction.test.ts` demonstrates file content plus an empty injected user turn; the follower reads that world. The earlier historical claim that D6 requires a fixture change is obsolete. The next product change will preserve the existing world and place approved D6 text in a collision-free workspace file for both explicit probes and mode P.

V4 gate measurement: seed 1 reaches level 8. Counts by level 1 through 9: 25/25, 25/25, 26/26, 25/25, 25/25, 22/22, 30/30, 30/30, 17/20. Levels 10 through 22 were not run. The scoped measured bank is 225/228, not a replacement for the historical all-seed total. Gate-only checks on seeds 2 and 3 each pass 22/22; their full ladders were not rerun. Evidence: `.exec/gate-ladder-s1.json`, `.exec/gate-structured-s2.json`, `.exec/gate-structured-s3.json`. No full sweep is authorized on the loaded host.

Gate tests were red first: equal reference outcomes expected pass but received reject (1 failed, 37 passed). The final focused file passes 40/40. The fix retains rejection for copied tool inputs, different observed tool behavior despite a passing coarse Then, and uncaptured final-store evidence.

Historical full-bank baseline measured on `6756a4cf` (branch `exec/generator-v3`, pull request 306), seeds 1 to 20 and the hidden seed, ladder version 2, 2033 items: 1756 of 2033 items pass on every seed (score 0.864). Every seed is at level 5. Level 6, the validity gate, fails on one item on every seed, `gate.contrast.then-ignores-edit`, which is the first item to rule on below. On seed 1 alone 1825 of 2033 pass (35 items newly pass, 12 newly fail: the eight mode.T items of item 5, the two contrast items of item 2 and two invariance items of item 8); before this branch, on main `a0a3e5d7`, seed 1 alone: 1802 of 2033, level 5. No sweep of all seeds exists for that base; the first sweep of this branch (eight causes in, before main was merged) gave 1733 on every seed.

Every failing item, the seeds it fails on and its first detail: [evidence/sweep-6756a4cf.json](evidence/sweep-6756a4cf.json).

Per level, items passing on every seed:

| Level | Items | Passing on every seed |
|---|---:|---:|
| 1 generate | 25 | 25 |
| 2 differential | 25 | 25 |
| 3 hostile | 26 | 26 |
| 4 reference | 25 | 25 |
| 5 cheaters | 25 | 25 |
| 6 gate | 22 | 20 |
| 7 boundary | 30 | 30 |
| 8 paths | 30 | 30 |
| 9 phrases | 20 | 15 |
| 10 behaviours | 20 | 18 |
| 11 faults | 72 | 44 |
| 12 adequacy | 50 | 37 |
| 13 modes | 141 | 103 |
| 14 coverage | 31 | 31 |
| 15 sequence | 27 | 26 |
| 16 allocation | 20 | 15 |
| 17 report | 40 | 40 |
| 18 minimality | 55 | 0 |
| 19 contrast | 24 | 14 |
| 20 interactions | 1255 | 1149 |
| 21 stability | 50 | 48 |
| 22 scale | 20 | 10 |

## Floor

`validators/floors.json` holds no floor for the generator. The measured level is 5 on every seed. A floor of 5 on ladder version 2 can be set once pull request 306 is on main: it goes through a maintainer branch (`fix/generator-floor`) and an independent review, with the sweep of that main commit as its evidence. The executor does not edit the file.

## What this executor changed

Product code only, in `packages/generate/src/seed`. One cause per commit, each with a test that was red first (`packages/generate/test/seed/*.test.ts`):

| Change | File | Items it moved |
|---|---|---|
| A tool output boundary value walks a path whose approved `states` relation reads the value: the turn that calls the tool gets the value as its answer and its Then states it | `boundary-seeder.ts#statedScenario` | gate.shortcut.passed-by-first-tool, gate.accepted.boundary (on the seeds where every tool is on a flow) |
| A deviation probe records the stage it is said at, as a transition block does | `scenario.ts` (`saidAt` on the probe block) | 20 contrast rejections on seed 1 |
| Every tool value turn is said after a move of a walk and expects the stage it stays at | `boundary-seeder.ts` | fault.X3.no-report, adequacy.X2.fact-invent, X3.no-report, X3.wrong-name, X4.empty, X4.no-question, X4.narrate |
| A valid input of a read-only tool is asked right after the move that calls the tool: the call carries that move's arguments with the value in its field, closed, once | `scenario.ts` (`turn.call`), `boundary-seeder.ts` | adequacy.X1.enum-next, integer-up, integer-invalid, field-missing, case, X2.fact-flip, X5.duplicate (seeds with every tool on a flow) |
| A tool failure whose recovery stays is followed by the same turn with the tool answering, then the rest of the walk | `scenario.ts#toolFailure` | sequence.after.D8_tool_failure |
| A failing turn keeps `input_closed` | `scenario.ts#toolFailure` | adequacy.X1.field-extra |
| A clean walk declares a tool failure perturbation, with the turn itself restoring the tool | `scenario.ts#toolFailurePerturbation` | perturbation.declared.D8_tool_failure, mode.P.D8.hide, retry-many, advance |
| A walk that declares a nudge perturbation holds `rules.one_message_per_turn` | `scenario.ts` | mode.P.X4.double, mode.P.D7.double, mode.P.D7.silent |
| A stage graph walk declares a perturbation for every class it can take, not one drawn class | `graph-seeder.ts`, `scenario.ts` (`perturbEvery`) | perturbation.declared.* and the mode.P items that depended on a draw (six seeds of the first sweep) |
| One metamorphic family over the persona axis has each user say their persona phrase after the first move | `metamorphic-seeder.ts`, `scenario.ts` (`aside`) | phrases.personas |
| A free context axis goes to the allowed value placed on least so far | `seed-drafts.ts#contextAxes`, `SeedContext.usage` | allocation.channel.ratio, allocation.channel.evenness |
| A cell that holds the start stage is covered by a clean walk that declares the first-turn class as its perturbation | `seed-drafts.ts#coverDraft`, `scenario.ts` (`perturb`) | the ten cover items: 1224 of 1224 allowed triples on seed 1 |

`worldFor` moved to `seed/world.ts` so `scenario.ts` can build a tool's answer without an import cycle. The Acme fixtures, the budget pin (`packages/generate/test/enumerate/fixtures/budget-categorical.json`), the pinned counts and the two generate transcripts (`docs/generating.md`, `docs/reference/cli.md`) are regenerated: 504 files, 332 complete specs, 24 cover specs. README.md lines 154 and 437 still say 508 files; README is outside the executor's scope.

## Open items

Every open item is an item to rule on, a decision for the owner or one product item still open; the last two have their own sections below.

### Items to rule on

Each group below fails on every seed unless a seed list is given. For each, the cause is in the validator or in the map it renders, and no change of the generator makes the item pass without failing another item. The evidence is reproducible with the tools at the end of this file.

1. `gate.contrast.then-ignores-edit` (level 6, the item that holds the ladder at 5), with `contrast.write.integer.at-minimum-above-minimum` and `contrast.write.integer.below-maximum-at-maximum`. Ten boundary blocks on seed 1: `gen-boundary-004#b2-value` and `gen-boundary-009#b2-value` (lookup_record quantity below the minimum and above the maximum), 017 and 022 (list_options limit), 030 to 035 (the six values of submit_request units). The correct Then is the same for each pair: an invalid value forbids the call and the conversation stays; the rendered map fixes `units: 2` in the only `uses_tool` relation of submit_request and the follower never sends another value (`follower.ts#call` reads `memory[tool.slot]` for the first input only). `boundary.read.in.below-minimum`, `boundary.read.in.above-maximum` and the six `boundary.write.in.*` items each require a discriminating block per value, so the blocks cannot be merged or dropped. On seeds where a goal shift is possible at its own goal stage, the same gate reason also rejects `D2_goal_shift` said at intake against `D5_language_switch` said at intake (seed 3: gen-cover-026 and five more): going back to intake from intake and staying at intake are the same correct Then, and `cover.pair.deviation.stage` requires the cell.
2. `contrast.read.integer.at-minimum-above-minimum` and `contrast.list.integer.at-minimum-above-minimum` (failing since commit "a valid tool input is asked right after the move that calls the tool"). The item collects every asserted value of the argument in every block of the specs that hold the partition. The above-minimum spec now also holds the walk's own call, whose argument the map fixes at the minimum (`quantity: 2`), so its set contains the at-minimum value. The alternative placement (the value turn before the move) passes these two items and fails adequacy.X1.enum-next, field-missing and case, because the first argument is then bound by nothing the map states.
3. The `X2.slot-first` cluster: fault, adequacy, minimal, stable, mode.P, mode.T and every `pair.*+X2.slot-first` item (56 items). No approved path says a slot twice, and no rule of the rendered prompt says the latest value holds: the contradiction rule says "ask which one holds and stay on the step" (prompt.md, Rules).
4. `minimal.*` (the 54 other items of the level). `vectorOf` groups killing blocks by Then and outcome on every agent, without the When. Every walk of a map opens with the same opening move and the same Then, so two specs of one path share their first blocks. A block cannot drop its Then: `gate.observed.no-machine-then` rejects it.
5. `mode.T.*` (33 items beside the slot-first one; 25 of them on seed 1). `follower.ts` keeps its stage in the session and reads only the last user turn; a teacher-forced block runs in a session of its own (`packages/core/src/runner/run.ts`, mode T), so the follower restarts at the start stage and fails every block after the first. Eight of these items passed on seed 1 before this branch and fail now (`mode.T.X1.enum-next`, `enum-first`, `integer-up`, `integer-invalid`, `field-missing`, `case`, `mode.T.X5.drop`, `mode.T.X5.wrong-tool`): a boundary value turn used to be the first and only block of its spec, the one block the follower passes in mode T; it is now said after a move, which is what makes fault.X3.no-report and the adequacy items pass.
6. `fault.C.*` (20 items) and `behaviour.save.exercised` (seeds where a save behaviour exists). The rendered map holds no relation for the saved file: `exports/record.json` is in `hidden.ts#saveFile` only, and the proposal schema has no relation for a workspace or an artifact outside a task family.
7. `allocation.stage.present`, `ratio`, `evenness`, `hill1`. `counts` reads `block.expect.stage`. A block that expects the start stage is a first-turn class whose recovery stays: the trivial agents report the start stage, the echo agent repeats the recovery's words, and the opening question is in the prompt's prose only, so the constant, echo and copy cheaters pass it (the `cheaters.*` items). The cover items read placements, which count a declared perturbation; this allocation item does not.
8. `invariance.<path>.persona` and `.channel` (6 items). `slots` keeps the `.in.` values of the cell only; two specs with the same inputs and different tool answers (`.out.` values in the Given world) state different values, as the approved `states` relations require. Example on seed 1, path change-request-back: gen-boundary-012 against gen-cover-008, same kind and quantity, found false against true.
9. Masked pairs: `pair.X4.empty+D5.dutch`, `pair.X4.empty+D5.mixed`, `pair.X4.empty+D6.says-skipped`, `pair.X4.no-question+D7.double`, `pair.X4.narrate+D7.silent`, `pair.X5.drop+X5.duplicate`, `pair.X5.drop+X5.write-twice`, `triple.X4.dutch+D5.dutch+X4.empty`. One member removes what the other changes (an empty reply has no language to judge; a dropped call cannot be made twice).
10. `fault.D4.no-reask` (seeds 1, 3, 6, 15, 17, 19, 20) and `adequacy.D4.no-reask` (18 seeds). The map's recovery pattern is `CONFIRM`; the recap question ("Reply CONFIRM to submit the request, or tell me what to change.") holds the word, and the fault still asks the pending question, so the pattern matches.
11. `fault.X2.fact-invent` (the instance at done; seeds 1, 11, 14, 15). The invented fact is the write tool's own first output; on the turn that calls the tool the map's `must_not` names the other tools only, so a second statement of the same field passes.
12. `adequacy.X4.double` (every seed) and `fault.X4.double` at a stage only flows without a nudge recovery reach (seeds 3, 9, 10, 14, 15, 16, 17). The map states one reply per turn for a nudge only (the D7 recovery).
13. **Resolved by the D8 maintainer ruling below. Historical diagnosis:** `adequacy.D8.advance` (seeds 1, 3, 4, 7, 13, 17, hidden). On a move that stays on its stage (check to check) an agent that advances after the failure ends on the same stage, and the recovery's count is `max: 2`, so one call passes.
14. `sequence.stages.D8_tool_failure` (17 seeds). The item asks for a tool failure at every middle stage of the flows; the map recovers from a failure of one tool, and the validator's own `possible.ts#said` allows the class only on a turn that calls that tool.
15. `perturbation.carrier.D6_instruction_in_data`. The users package carries the class in the world; the follower reads a deviation in the user turn only, so a world carrier would leave every D6 fault unchanged.
16. `mode.P.D2.ignore`. A perturbed run goes on with the walk, so a perturbation's recovery must stay; a goal shift that stays is said at its goal stage, where ignoring it changes nothing.
17. `phrases.data-in` (the write tool's enum phrases), `phrases.data-out`, `phrases.behaviours`, `phrases.flows`. A data request of the write tool is deferred whatever its value (same Then, the contrast gate of item 1). A returned-value request has no approved relation for what the reply states outside a move. A behaviour phrase of a behaviour with a tool makes the follower call it (`follower.ts`, case behaviour) and the map has no relation for that call. A flow with one phrasing has no family; saying its phrase in place of the opening move was tried and reverted: on Acme the reference agent fails gen-graph-005 and gen-graph-006 (24 blocks), because an Acme flow phrase can carry an address or an email.
18. Seeds 3, 6, 13, 16, 17, 18 and 19: a tool no flow calls (list_options with no `uses_tool` relation). `fault.X1.field-extra`, `fault.X5.duplicate`, `fault.X2.fact-flip`, eight `adequacy.X1.*`, `X2.fact-flip` and `X5.duplicate` items, `gate.accepted.boundary`, `phrases.slot-values`, `behaviour.list.exercised`. The map states the arguments of no call of that tool, so its value turns assert one field.
19. Seed 8: `fault.D2.ignore`, `adequacy.D2.ignore`, `stable.D2.ignore`, `mode.F.D2_goal_shift` and the 48 `pair.*+D2.ignore` items. The only flow that recovers from a goal shift walks opening, intake, check; the recovery goes to intake; said at intake it moves nothing, and after the last stage the validator's `possible.ts` (and the generator's) allow only a class whose recovery stays.

## Decision for the owner: scale at a hundred times the behaviours

`scale.100x.*` (10 items) fail because the scale child dies of memory at its 2048 MB heap. One generation at 100 times writes 31940 specs and 165166 blocks in 36.6 s of CPU and holds 644 MB after collection; the child keeps two results, both file maps and the reloaded specs. Full triple coverage on an axis map with a stage needs about 50 specs per behaviour, so the count is inherent to the default target. The budget is 60 s of CPU for two generations, the writes, the reads and the reload. Meeting it needs a default that writes fewer specs on a large map (for example the pairs mode of `--spec-cap` as a default above a size), which trades triple coverage for size. That is a product decision, not an executor's.

## Open item the product can still fix

`allocation.deviation.ratio` on seeds 5, 8 and 20: the tool failure class has 9 probes against 35 for the most probed class on seed 5 (it has no phrase, so no metamorphic family, and one tool). A top-up of the least probed classes after the cover seeder would fix it; not done.

## Hypotheses tried

Tried and rejected:

- A flow phrase opens the stage graph walk of a flow with one phrasing: passes on the hidden maps, fails 24 blocks on the Acme reference agent. Reverted.
- A goal shift probed after the last stage of a walk (seed 8): the map's derived constraints forbid the class there. Reverted.
- Persona phrases in every persona family: the variants of two families became one-slot siblings that expect the same (9 contrast rejections). One family carries them.
- A perturbation per class drawn with the seeded generator: the extra draws changed the context of every graph walk. The extra classes are taken at their first stage with no draw.

## Next actions

Current actions (supersede the historical list below):

1. Finish and commit iteration 21, with generator regression checks and the journal.
2. Move D6 approved instruction text into the world, run seed 2, and push/open a draft PR at the first gained level.
3. Continue each newly reached level; incorporate the maintainer's D8 contract and the author's phrase fixes when available. Recheck seeds 1/2/3 and the commit-derived hidden seed, using CI for the latter.

Historical actions:

1. Take the rulings on items 1 to 19 to the maintainer. Item 1 alone holds every seed at level 5.
2. After pull request 306 merges, a maintainer sets the generator floor at 5 (`fix/generator-floor`).
3. Fix `allocation.deviation.ratio` (above), then re-run the sweep.

## Pitfalls

* Never edit `packages/validators` or `validators/` bank files from an executor branch: `pnpm -s driftbench validate protect --branch <name> --base origin/main` must report none protected.
* The Acme fixtures are byte pinned. After any generator change: `pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out examples/acme/generated --baseline examples/acme/specs --t 2 --force`, then `pnpm -s biome check --write examples`, then refresh `budget-categorical.json` (the hash of `result.files` per budget, as `budget.test.ts` computes it) and the counts in `packages/generate/test/enumerate/acme.test.ts`, `packages/generate/test/gate/acme-generated.test.ts` and `packages/cli/test/generate.test.ts`.
* A change that adds a seeded draw moves every later draw of the walk. Add choices without a draw where the old output should stand.
* An echo agent repeats every literal word of the spec's `must` patterns: words alone never fail it.
* One sweep takes 70 minutes to several hours on a loaded host. Measure one seed and a few families first (Tools).

## How to run

```
pnpm -s driftbench validate generator --seed 1
node --max-old-space-size=4096 --import tsx packages/validators/src/ladders/generator/bank-run.ts .exec/after.json --seeds 1..20 --hidden --jobs 3
node --import tsx packages/validators/src/ladders/generator/bank-row.ts .exec/after.json .exec/row.json --iteration <n> --before .exec/before.json --hypothesis "<text>" --files <a,b> --commit <sha> --tests "<names>" --minutes <n> --model opus
pnpm -s driftbench validate generator --journal .exec/row.json
```

Run the sweep in a second worktree at a fixed commit: each seed's child reads the source when it starts, so an edit during a sweep mixes two versions.

## Tools

Three scripts, each a few lines, placed in `packages/validators/` and never committed:

- Items by prefix on one seed: build `new SeedData(seed, {}, scale)` and call `evaluate(bankItems().filter(...), data)` as `bank-run.ts` does. Gate, phrases, cover and allocation items take about a minute; fault, adequacy and mode items a few minutes.
- The gate funnel: evaluate `gate.killers`, then read `data.memoized('gate', ...)` for the rejected blocks and their stage details.
- A seed's map on disk: `renderMap(hiddenSpec(seed))` written under the names of `MAP_FILES`, then `pnpm -s driftbench generate --map <dir>/approved.yaml --out <dir>/gen --seed <seed> --force` to read the specs.

## Fixtures

* Hidden specification per seed: `hiddenSpec(seed)` in `packages/validators/src/ladders/generator/hidden.ts`, rendered by `render.ts`; seed 1 is kept in `packages/validators/fixtures/generator/seed-1/`.
* Rule follower `follower.ts`, faults `faults.ts`, cheaters `cheaters.ts`, items `bank*.ts` and `acme.ts`.
* Earlier history of this lane (options A and B, the spec cap, the speed work, the maintainer patch of pull request 178) is in the journal rows 0 to 17 and in the git history of this file.

## V4 pre-edit classification (2026-10-14)

This supersedes the earlier claim that all 19 groups need rulings. Paths below are relative to `packages/`; protected fixture changes belong to the maintainer.

1. **product gap**: `generate/src/gate/gate.ts:359` rejects equal sibling Thens without comparing correct reference outputs. Accept equal-by-design outputs; continue rejecting copied expectations when the reference changes. The write-integer subitems also need the fixed write arguments in `validators/src/ladders/generator/render.ts` corrected.
2. **fixture gap: maintainer**: `validators/src/ladders/generator/render.ts` fixes the preparatory call at the minimum; `bank2.ts:519-540` collects all calls of that spec instead of the edited boundary block.
3. **fixture gap: maintainer**: `validators/src/ladders/generator/hidden.ts` and `render.ts` provide no path that restates a slot and no latest-value rule; contradiction recovery asks which value holds.
4. **fixture gap: maintainer**: `validators/src/ladders/generator/bank.ts:1919-1993` groups setup blocks by identical Then and outcomes without their necessary conversation prefixes.
5. **fixture gap: maintainer**: `validators/src/ladders/generator/follower.ts:184-202` starts at the initial stage and reads only the last user turn, ignoring teacher-forced history.
6. **fixture gap: maintainer**: `validators/src/ladders/generator/render.ts` omits save/artifact relations for the file held in `hidden.ts#saveFile`.
7. **fixture gap: maintainer**: `validators/src/ladders/generator/render.ts` gives the opening question only in prompt prose, with no machine relation for a discriminating start-stage Then.
8. **item defect**: `validators/src/ladders/generator/bank2.ts:559-569,616-626` groups with `slots(spec)` while that function retains only keys containing `.in.`; different `.out.` facts correctly change the Then.
9. **item defect / fixture gap: maintainer**: `validators/src/ladders/generator/faults.ts` drop then duplicate composes zero calls back to one; other masked pairs need fixture expectations that observe both changes independently.
10. **fixture gap: maintainer**: `validators/src/ladders/generator/hidden.ts:399` requires `CONFIRM`, already present in the pending recap question; `faults.ts:562` only changes the recovery's said text.
11. **fixture gap: maintainer**: `validators/src/ladders/generator/faults.ts:309` invents the actual write tool's default fact on a turn calling that tool; `render.ts:53` forbids only uncalled tools' facts.
12. **fixture gap: maintainer**: `validators/src/ladders/generator/render.ts` and `hidden.ts` lack a global one-reply contract; only nudge recovery specifies it.
13. **Resolved by the D8 maintainer ruling below. Historical fixture gap:** `validators/src/ladders/generator/faults.ts:652` advances on a self-loop to the same stage; `hidden.ts:411` permits one call with `max: 2`.
14. **item defect**: `validators/src/ladders/generator/bank2.ts:290-295` requires every middle stage using only hidden constraints; `possible.ts:36-45` permits tool failure only on a move calling the failing tool.
15. **fixture gap: maintainer**: `validators/src/ladders/generator/follower.ts:202,285` reads D6 from user text, not the world carrier required by `bank4.ts:159-163`.
16. **product gap**: `generate/src/seed/scenario.ts:503-535` restricts declared perturbations to recoveries that stay. A clean prefix can end at a non-goal stage and append a terminal goal-shift perturbation with its approved recovery.
17. **product gap / fixture gap: maintainer**: `generate/src/seed/metamorphic-seeder.ts` skips single-phrase flows; give each approved flow phrase a path without losing bound input values. Data and tool-backed behaviour phrases still require missing `validators/src/ladders/generator/render.ts` relations.
18. **fixture gap: maintainer**: `validators/src/ladders/generator/hidden.ts` and `render.ts` omit any flow call and full arguments for the unreferenced tool on the listed seeds.
19. **fixture gap: maintainer**: `validators/src/ladders/generator/hidden.ts` and `possible.ts:48-51` permit seed 8's goal shift only at its goal, and disallow a non-staying terminal recovery.

Additional product gaps: `allocation.deviation.ratio` needs balancing in `generate/src/seed/deviation-seeder.ts` after coverage; `scale.100x` needs a bounded-memory disk API in `generate/src/enumerate/`. Protected `measure.ts` retains both results, both file maps and reloaded specs; the maintainer will wire the new API into that harness.


## D8 maintainer ruling (2026-10-15)

The rendered D8 read-tool recovery now requires `count: 2`: the initial failed call and exactly one retry, matching the existing prompt. The recovery item already reads that same hidden relation, so neither bank item changes. The mutant remains unchanged. This resolves item 13 above without lowering a threshold or removing a fault.

The generator must carry that exact count into every D8 failure Then, keep the pending stage and report the failure, including self-loop failures. Actual generated suites pass both named items on seeds 1 and 3. The focused regression covers visible seeds 1–20 and the base-commit hidden seed. See [the partial-measurement journal](SWEEP-JOURNAL.md) and [evidence](evidence/d8-retry-contract.json). The historical level table is not a new measurement.

## Invariance maintainer ruling (2026-10-15, PR 510)

A pair holds Given facts and ordered semantic stimuli fixed, including transition order and slot bindings. Approved persona wording may vary; unknown text remains literal. Block ids are labels and expected stages are assertions, so neither belongs in the pairing key. Both persona and channel items share this comparison; no item or threshold changes.

The auditor's renamed same-turn wrong-Then case is a regression on all three paths and both axes. Fresh-map planted pairs also retain rejection, with clean reference runs and a separate clean pair present. The six failures previously described as product defects were reused-label pairs asking different questions (input vs behaviour or output); their side-by-side requests and Thens are in [the evidence](evidence/invariance-semantic-turns.json). Seed 18's gen-cover-096/gen-phrase-012 remains excluded. The [partial journal](SWEEP-JOURNAL.md) records focused results only.

Product obligation: for the same facts and ordered requests, generate identical machine expectations across persona/channel variants, regardless of block labels.

## D6 maintainer ruling (2026-10-15)

The users package declares D6 a world carrier; the spec reference and rendered prompt identify instructions inside supplied workspace files and tool results as data. Phrase provenance and phrase coverage now inspect that content when the injection carries no user text. The same shared reader serves both items. It requires an approved phrase of the injected class, never merely an empty user or a populated world.

The reader ignores filenames, object keys, metadata, background Given, store/fixtures and tool errors. Ordinary user/burst provenance remains exact; nonempty user text cannot borrow approval from the world. The carrier and behavioural fault items remain unchanged, so recording an approved phrase is not proof that the agent consumed it or that the suite caught obedience.

Product obligation: put every approved D6 instruction in the injected world file/tool-result content, leave injection.user empty, and retain checks that catch both obedience faults. See [the partial journal](SWEEP-JOURNAL.md) and [evidence](evidence/d6-world-carrier-contract.json). No historical ladder level is updated by this scoped ruling.


## Behaviour ownership and capacity ruling (2026-10-16)

Every listed behaviour phrase remains required. The rendered map must provide an owning flow and a distinct post-read (flow, stage) slot for each phrase. A reported orphan or capacity gap does not waive coverage.

The hidden constructor preserves every drawn ownership edge. An augmenting-path matching first uses the existing ownership. Only a behaviour that cannot be seated gains an edge to a flow with a free eligible slot. Slot eligibility follows the approved paths after every readonly tool used by that flow has run. Insufficient total path capacity rejects the fixture. The repair consumes no random draws.

The public seed-1 fixture is refreshed. Independent exhaustive matching checks visible seeds 1–20, fresh seeds 1009, 2027, 4093 and 8191, and the commit-derived hidden map. The hidden map stays in memory; review the general construction, hand-written parcel example and public fixture diff, then run the test at the reviewed commit. The hidden-seed formula and coverage items remain unchanged.

The final regression suite fails 13 cases on the unchanged constructor. The repaired constructor passes 40 tests across the new file and the existing hidden-map tests. Controls reject silently skipped owned phrases and forged capacity reports on all four fresh seeds. See [evidence](evidence/behaviour-ownership-capacity.json). This scoped measurement does not update historical ladder levels.


### Review correction: globally minimum ownership additions (2026-10-16)

The incremental seating sentence above is superseded. An early orphan can occupy a slot that a later, originally owned behaviour needs. The first repair adds two edges in the reviewer's two-behaviour example although one suffices.

The constructor now completes a maximum matching over all originally drawn ownership before adding any edge. If B behaviours have a maximum original matching of M, at least B minus M edges are required: one new ownership edge increases matching cardinality by at most one. Assigning each unmatched behaviour to a free slot adds exactly B minus M edges and meets that lower bound.

Both new review controls fail on the first repair. The corrected suite passes 42 tests, including the reviewer example and all 512 three-by-three ownership graphs against independent exhaustive matching. A separate comparison verifies minimal additions, full capacity, all drawn edges and every other field on 28 public maps plus the commit-derived hidden map in memory. The four fresh omission and forged-report controls still pass. See the appended correction in the existing evidence JSON and the review red output. No public seed-1 fixture change is needed.

## Integer contrast maintainer ruling (2026-10-16)

Integer contrast measures the block whose approved stimulus requests the partition's concrete value. It does not aggregate earlier calls, zero-call guards or labels from the enclosing scenario. The hidden data values and phrase intents identify that request independently of generated cell metadata or block ids.

For a valid read-only input request, the assertion must require one call with exactly the requested integer. Bare numbers, exact JSON assertions and singleton numeric choices carry that same meaning. Every matching request block must satisfy the rule; a clean duplicate cannot hide an incorrect expectation. A missing request, missing assertion, optional call, copied default, wrong value or permissive choice fails.

A direct request for a side-effecting tool is not the confirmation the prompt requires. Both valid integer requests must explicitly forbid the call. Equal refusals are correct; allowing the call or omitting its prohibition fails. The contract comes from `render.ts#renderPrompt`, `render.ts#propertyLine`, `hidden.ts#dataValues` and the data-intent branch of `follower.ts`.

Product obligation: keep shared preparation intact; on the actual request assert the exact allowed integer for read-only tools, and forbid unconfirmed side effects. No item, threshold, floor, fault family or hidden-seed rule changes. Historical journal measurements stay unchanged. Focused evidence and the red-first regression are recorded in [the partial journal](SWEEP-JOURNAL.md) and [integer-contrast evidence](evidence/integer-contrast-contract.json).


## Sequence stages and impossible pairs: maintainer ruling (2026-10-15)

Ruling item 14 above. `sequence.stages.<class>` owed a probe at every middle stage of the flows listing the class, filtered only by written constraints. The hidden space map also forbids the pairs no path can reach (`possible.ts`), and the coverage items already read that map. For D8 the map allows a tool failure only on a move that calls a recovered tool, so the item demanded probes the map rules out (seed 2: check, choice, details, recap). No product could satisfy both.

The item now reads the same map as the coverage items: a stage the map rules out for the class is owed no probe, and a probe placed at such a stage fails the item. A reachable stage left unprobed still fails it, and a class with no reachable stage never passes. Measured on main's product: the old logic fails D8 on 18 of the 21 visible and hidden seeds; the new item fails none, and no probe sits at a ruled-out stage. See [the journal](SWEEP-JOURNAL.md) and [evidence](evidence/sequence-impossible-pairs.json). No historical ladder level is updated by this scoped ruling.


## Ownership fixture integration: explicit imbalance in disk parity test (2026-10-16)

The generator's disk parity test imports the validator's mutable seed-5 hidden constructor. Main d37cc4c76 passes its balance-file prerequisite; ownership head 4b411d426 fails it before comparing any disk output. The minimum ownership edge B-002 to new-request changes scenario contexts: main needs three balance top-ups to bring D8 to 12 against maximum 35; the repaired fixture already gives D8 13 against maximum 35 and correctly needs none. This is not a disk/eager mismatch.

The test now constructs its intended imbalance by adding approved off-topic phrases before generation, on public seeds 1 and 5 and fresh seed 1009. It keeps the assertion requiring balance files, summary/file-count equality and every non-report file's byte equality. No generator product source changes. The separate merge commit preserves both sides of the records. See [integration evidence](evidence/ownership-stream-fixture.json). Historical ladder measurements stay unchanged.

Focused results: four disk parity cases and 42 ownership/pin tests pass. Disabling the balancing iterator through a temporary test spy makes all three explicit-imbalance cases fail. The spy is removed; product source is unchanged.

## Feasibility and impossible pairs: maintainer ruling (2026-10-15)

`diff.feasible.<seeder>` read only the written constraints, and only five seeders. A block in a cell no path of the hidden map can reach (`possible.ts`) passed, and blocks from the `cover` and `task` seeders were read by no item. The item now reads the hidden space map, the same map the coverage items read. It checks every seeder: `cover` and `task` have their own items, and `diff.feasible.unlisted` reads any seeder no item names. The bank grows from 2033 to 2036 items.

Measured on main's product, `diff.feasible.cover` fails on every measured seed (1 to 20, the hidden seed and 1001 to 1010). `diff.feasible.twise` also fails on seeds 10 and 15. Two product causes, both against the generator's own model in `packages/generate/src/seed/possible.ts`:

1. A cover spec pairs a behaviour with a flow that does not list it (seed 2: `gen-cover-001`, flow change-request, behaviour B-001). Every block inherits the pair: 6787 blocks across 31 seeds.
2. The first move's block records the start stage it is said at (`assemble.ts`, `saidAt`), while both models place a move at the stage it reaches. It is flagged only where the behaviour's flows carry no first-turn class: 25 blocks on seeds 10 and 15.

The product lane fixes these in `packages/generate`. Per-seed counts: [evidence](evidence/feasible-impossible-pairs.json) and [the journal](SWEEP-JOURNAL.md). No historical ladder level is updated by this scoped ruling.
