# Handover: validator estate

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate estate --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
<!-- level-table:end -->

### Current executor measurement, iteration 23

Seed 1 passes 946 of 1170 items, level 0, from row 22's 947. Three path items improve: scan.paths.single-quoted, scan.paths.double-quoted and scan.paths.html-link. Four timing losses remain: scan.hostile.wide-folder takes 5134 ms against 5000; scale.generate-1000 takes 9565 ms against 6000, and the larger two generation sizes are not run after that failure. No timing recovery or loss is credited as a component change. Capture: .cache/estate-executor/iteration-23.json, immutable base b32e618f plus packages/estate/src/scan/code.ts and packages/estate/test/scan/quoted-paths.test.ts.

Four canonical cases fail first and one decoy control passes. All five final cases and 306 estate tests pass. The parser claims complete inline-code and markdown-link spans before reading single and double quotes. Link titles, shell arguments, example sentences and URLs remain excluded. Typecheck and lint pass. Eleven owned causes are complete, iterations 13 through 23; own net new item gains total 67, plus one restored baseline portability item. Eighteen imported maintainer gains stay excluded.

The tenth-fix full sweep remains active on committed b32e618f. The current Node 22 and Node 24 CI logs confirm only the same two stale routing assertions, with 4607 Node 24 passes. PR 147 fixes those protected tests and is imported from main 5a90bfb6 after the measured component commit. The scope codemod changes zero files. Fresh typecheck and lint pass. The post-import run passes 334 assertions and hits two outer five-second guard-test timeouts. The unchanged unit file then passes all sixteen tests with its original timeout when run separately. Both repaired protected assertions pass. The new smol-toml dependency is installed only inside this worktree, with its pinned lockfile integrity verified. The scheduled fresh handover review is iteration 24.

### Previous executor measurement, iteration 22

Seed 1 passes 947 of 1170 items, level 0, from row 21's 944. Exactly three items improve: scan.decoys.negated-route, scan.decoys.negated-dispatch and scan.decoys.negated-reference. No item regresses. Capture: .cache/estate-executor/iteration-22.json, immutable base 877ca0ce plus packages/estate/src/scan/code.ts, packages/estate/src/graph/edges.ts and packages/estate/test/scan/negated-mentions.test.ts.

Five canonical cases fail first and one affirmative control passes. All six final cases and 301 estate tests pass. The shared clause check preserves affirmative but/until clauses, later dispatches, never-forget phrasing and curly apostrophes. Fresh typecheck and lint pass after the required import spacing. Ten owned causes are complete, iterations 13 through 22. Own net new seed 1 gains total 64, plus one restored baseline portability item. Eighteen maintainer gains stay excluded. This tenth fix starts an immutable full sweep immediately after commit; read full-22.state.json for its actual source and status before claiming a result.

The independent handover-21 review matches 944 of 1170, reader 0.886115 and the same 73 failed ids. The quiet brief agrees exactly with row 21. Its initially incomplete id extractor is corrected to include plus signs and validate the count against the displayed metric. The two requested text corrections are included here: the historical ratio is rounded to 0.807 and current archive references name handover-21. The lead requests no extra recheck. The next scheduled review is iteration 24.

CI on 877ca0ce fails two protected routing assertions, not a component regression. Node 24 job 115097292931 reports 4534 passes and two failures; both stale assertions require scan.standing.plain-name to remain broken. Local targeted tests reproduce both failures. The maintainer is informed through .cache/estate-executor/ci-routing-oracle-defects.md; protected tests remain unchanged. Continue component work and import the maintainer fix from main when the lead confirms it.

### Previous executor measurement, iteration 21

Seed 1 passes 944 of 1170 items (0.807, rounded), level 0, from row 20's 940. Exactly four registry items improve: scan.registry.json-guards-key, scan.catalogue.keyed-by-id, scan.catalogue.by-event and scan.catalogue.wrapped. No item regresses. Capture: .cache/estate-executor/iteration-21.json, immutable base 69177605 plus packages/estate/src/scan/claude-code.ts and packages/estate/test/scan/registry-shapes.test.ts.

Six canonical cases fail first, with two passing controls. The normalized entries retain source keys, inherited events and explicit event overrides. They ignore unrelated nested metadata. All eight final cases and 295 estate tests pass. Typecheck initially rejects flatMap's inferred union after the event refinement; a private RegistryEntry type makes the normalized shape explicit. Refined typecheck, lint and thirteen related assertions pass before measurement. Nine owned component causes are complete, iterations 13 through 21. Own net new seed 1 gains total 61, plus one restored baseline portability item. Eighteen maintainer corrections remain excluded.

The scheduled fresh handover review follows this commit. Save a quiet canonical brief and compare its reader failure ids against this capture before freezing source and evidence. The next pending negation test and candidate are local, not pushed; their full canonical paths appear in Next actions. Current CI is still running or queued at the last read, with Node 24 lint and typecheck passing on source 69177605. This is a step result, not a green-CI claim.

### Previous executor measurement, iteration 20

Seed 1 passes 940 of 1170 items (0.8034188034188035), level 0, from the matched post-import baseline of 937. Exactly three compaction items improve: scan.hazards.summarized, scan.hazards.window-full and blind.gates.skill-compactions-plural. No item regresses. Capture: .cache/estate-executor/iteration-20.json, immutable base 7b781747 plus packages/estate/src/scan/code.ts and packages/estate/test/scan/compaction-names.test.ts. Its before capture is iteration-19-main140.json on the same main instrument.

The scanner reads explicit context-compaction synonyms and still excludes customer-owned summaries. Five canonical positives fail first; two ordinary-summary controls already pass. All seven final cases, 144 scan/graph tests and 287 estate tests pass. The same-line control preserves a later assistant context event after a customer summary. Fresh typecheck and lint pass after formatting the long regular expression. Eight owned component causes are complete, iterations 13 through 20. Own net new seed 1 gains total 57, plus one restored baseline portability item. Eighteen maintainer gains from PRs 124 and 133 receive no executor credit.

The next largest confirmed reader group is registry entry containers. The isolated candidate .cache/s27registry-shapes makes four bank items pass: scan.registry.json-guards-key, scan.catalogue.keyed-by-id, scan.catalogue.by-event and scan.catalogue.wrapped, with no family regression. Four tests fail first and eleven related tests pass after the candidate fix. This remains local, not pushed or counted as progress. Apply it as iteration 21 before the smaller prepared negation cause. Its source and test are packages/estate/src/scan/claude-code.ts and packages/estate/test/scan/registry-shapes.test.ts.

### Previous executor measurement, iteration 19

Seed 1 passes 930 of 1170 items (0.7948717948717948), level 0, from row 18's 924. Exactly three routing items improve: scan.standing.plain-name, scan.standing.bold-name and scan.standing.helper-plain-name. Three generation-scale timing recoveries receive no executor credit. No measured item regresses. Capture: .cache/estate-executor/iteration-19-final.json, immutable base 1a420e01 plus the two routing files, before main 14225a2a is imported.

The route reader uses the existing declared-name sets for exact plain and bold names and explicit agent descriptors. A same-name skill/helper collision selects the explicitly named agent. Four initial cases fail before the fix; the companion collision case is also red first. All six final cases pass, and all 280 estate tests pass after the main import. Source: packages/estate/src/scan/code.ts. Regression test: packages/estate/test/scan/routing-names.test.ts, committed with this fix. Its candidate .cache/s19candidate stays local, not pushed.

Seven own component causes are complete, iterations 13 through 19. Own net new seed 1 gains total 54, plus one restored baseline portability item. The eleven PR 124 and seven PR 133 corrections receive no executor credit. Main 14225a2a is merged and pushed as ee223c73; its scope codemod changes zero files, fresh typecheck and lint pass, and protection passes. Current CI is queued or running at the last read. The separate .cache/estate-executor/iteration-19-main140.json measurement completes on immutable base ee223c73 plus the same routing files: 937 of 1170, level 0. Exactly seven maintenance items improve and nothing regresses relative to the pre-import capture. They all belong to PR 133. This is the post-import before capture for iteration 20. Do not combine its maintainer gains with this paired routing measurement.

### Previous executor measurement, iteration 18

Seed 1 passes 924 of 1170 items (0.7897435897435897), level 0, from row 17's 926. The exact SQLite warning filter makes estate.determinism.node22-lint pass; all five Node 22 determinism items now pass. Three generation-scale timing items fail in this run, and those losses remain in the score. Capture: .cache/estate-executor/iteration-18.json. No timing result is credited as a component fix or discarded.

The product CLI entry packages/cli/src/bin.ts filters only ExperimentalWarning with the exact SQLite message, before main loads. Every other warning is forwarded with its original arguments. Three canonical suppression cases are red first, while three preservation controls pass. All six final cases pass on Node 22 and Node 24, including code and detail preservation. The related CLI tests make 14 passing assertions. The complete build succeeds; the built CLI on Node 22 prints its unchanged 970-byte lint output and empty stderr. Early canonical tests exceed Vitest's default process-start timeout during the concurrent sweep and build. The assertions stay unchanged; process and test waits are bounded explicitly. Fresh typecheck and lint pass after that adjustment.

Six own component causes are complete, iterations 13 through 18. Since takeover, 51 new seed 1 bank items come from owned fixes; 11 new passes come from imported PR 124 and are excluded. Iteration 18 also restores a portability item that passes at the takeover baseline. There are 52 owned passing transitions across paired iterations, but only 51 net new bank passes relative to takeover. At the time of row 18, the fifth-fix sweep remains active on source c415e845, before this warning fix. The completed result is recorded in its own stamped section below.

The earlier bfb8a652 merge-ref CI fails typecheck because new protected maintenance, map and stats tests use the old npm scope. Main 14225a2a, including PR 133 and PR 140, is now imported. The required rename-scope script changes zero files. Those protected corrections stay maintainer-owned; the seven maintenance corrections receive no executor progress credit. Row 18 and the running iteration 19 snapshot predate this import, so their scores remain stamped to their original instruments. Fresh checks and current CI determine the imported branch's state. This earlier CI failure is separate from the corrected local-name assertion.

### Previous executor measurement, iteration 17

The refined seed 1 run on main a624204b plus the spaced-path fix passes 926 of 1170 items (0.7914529914529914), level 0. The before capture is row 16 at 919. Exactly three component items improve: scan.paths.link-angle, scan.paths.spaced-name and lint.clean.reference-with-space. The primary pre-main capture passes 923; it is retained as a diagnostic. The final capture is iteration-17-main119-final.json. The wide-folder timing recovery and three generation-scale recoveries after the imported main performance change receive no executor credit.

The parser preserves whole spaced backtick file names and angle-delimited markdown link destinations, including anchors and titles. URLs, command operators, flags and explicit execution examples stay excluded. Four initial cases are red. A separate simple Run/Example control is red first, then green after the same parser is refined. The final estate and CLI tests pass 288 assertions. Typecheck, lint and protection pass. Main's package-scope rename is reconciled in the two branch-owned stats files as 60a59b3f. The requested rename-scope script then changes zero files.

Five own iterations are complete: 13 through 17. Own component gains total 51 items (4 hazards, 37 stats, 3 names, 4 comments, 3 spaced paths). Eleven imported PR 124 gains are excluded. No TypeScript launcher or imported performance gain is credited. This fifth fix starts an immutable full sweep immediately after commit. Its current measurement must be read from the sweep state, never inferred from seed 1.

PR 119 is merged into this branch through main a624204b. Both native TypeScript tests pass on Node 22, including its long temporary path test; all native estate tests pass in the complete run. Four of five Node 22 determinism items pass. estate.determinism.node22-lint fails because Node 22 writes a SQLite ExperimentalWarning to stderr, although its lint stdout equals Node 24. The exact captured warning is isolated in portability-lint-probe.json. The lead requests a product filter for its exact type and message. That is the next separate cause, in packages/cli/src/bin.ts and packages/cli/test/sqlite-warning.test.ts. Its isolated six tests pass on both Node versions after three red suppression cases; every other warning is forwarded. PR 133 remains open at the last read and will arrive through main when merged.

### Completed fifth-fix full sweep, source iteration 17

The immutable source is commit c415e84547598cf4830de3b945f138eb4f17d241 in .cache/full-17, local and not pushed. Its resolution stamp confirms estate and generate imports come from that snapshot. The sweep completes seeds 1 to 20 and hidden 290770053 at level 0 for every seed. 911 of 1170 items pass on every seed (0.7786324786324786); per-seed totals range from 920 to 928. This is source iteration 17, before the warning filter, plain routing fix and imported maintenance corrections. It is not a current-branch all-seed claim. Captures: .cache/estate-executor/full-17.json, full-17.state.json, full-17.source.json and full-17.stderr.

The pre-fix all-seed baseline is 845 of 1170 on c27c96dd with hidden 401483072. Its different source, instrument and hidden cohort remain explicit. Do not credit their entire numerical difference to executor fixes. The next full sweep follows the tenth owned cause, iteration 22.

### Previous executor measurement, iteration 16

The final refined seed 1 run passes 919 of 1170 items (0.7854700854700855), level 0. The immutable before run passes 916. Exactly four comment items improve: scan.decoys.reference-in-comment and the three blind.gates comment decoys. The final run also fails scan.hostile.wide-folder at 5574 ms against 5000 ms; that loss is retained. Node 22 lint differs from current Node in both before and after, so it remains open and receives no attribution. The primary run also passes 919 but loses scale.generate-250 at 4067 ms against 4000 ms instead; the final run is the journal's instrument.

Whole-file comment and fence masking is shared by references, gates, hazards, root discovery, inline aliases and helper dispatch edges. It preserves original source quotes, line positions and frontmatter data. The initial comment tests are red; two sibling tests for graph dispatch and inline aliases are red before their refinement. Final canonical scan and graph tests pass 125 assertions. Typecheck and lint pass. Captures: iteration-16-before.json, iteration-16.json and iteration-16-final.json. The final snapshot uses HEAD 33eeed9f with only this comment cause, and its package path stamp resolves inside .cache/s16measure.

Four own iterations are complete including this row. Own component gains total 48 items (4 hazards, 37 stats, 3 names, 4 comments). Eleven imported PR 124 gains receive no executor credit. Timing and Node differences remain measured failures. At row 16, the next fifth own iteration fixes spaced file names in packages/estate/src/scan/code.ts, with packages/estate/test/scan/spaced-paths.test.ts. The TypeScript portability change belongs to PR 119 and must arrive through main. It receives no executor credit. A current full sweep follows the spaced-path fix.

### Fresh brief comparison after iteration 16

The quiet canonical tree is held unchanged while `pnpm -s driftbench validate estate --brief --fresh` runs. Its reader has 86 failures of 641, while row 16's final capture has 87. The exact set difference is scan.hostile.wide-folder: it passes in the quiet brief and fails in row 16 at 5574 ms against 5000 ms. Every other reader verdict matches. The live brief reruns the reader; it does not copy its metric from the journal. The saved brief and row 16 therefore record two measurements with different timing outcomes, not an arithmetic error. Keep row 16 and its measured failure unchanged.

Evidence: .cache/estate-executor/iteration-16-quiet-brief.md; failed ids in iteration-16-quiet-failed-ids.json and iteration-16-journal-failed-ids.json; exact diff in iteration-16-brief-diff.json. The earlier fresh review has no capture and ran while row 16 was appended, so its item set cannot be reconstructed. The quiet rerun identifies the actual difference without attributing it to a half-updated source tree.

### Previous executor measurement, iteration 15

The final refined seed 1 run passes 917 of 1170 items (0.7837606837606838), level 0. The merged pre-fix snapshot passes 902. Same-instrument before/after captures show three legitimate component gains: bench.defects.name-own-folder, name-below-folder and name-root-file. Node 22 lint also recovers without a diagnosed fix, and receives no credit. The final run includes PR 124's bank correction: eight registry items, one task item and two script mutant items improve. All eleven are maintainer work and receive no component credit.

The component implements exact local folder, local subtree, estate root, then global bare-name lookup. Local ambiguity stays within its first matching scope. The reader discovers only named bare root guides, with the same local/skipped choice as actual resolution, plus ignore and size limits. Runtime copies include the selected guides and exclude unrelated root documents. All 105 refined scan tests pass. The initial four name tests are red; the extra skipped-local discovery test is also red first. The synthetic reader-cases map and approvals are regenerated from recorded answers; no paid call occurs.

Captures: iteration-15-before.json and iteration-15.json use the pre-124 loaded bank; iteration-15-final-reader.json is the final whole-bank run, despite its name, because --items requests every level. This final run measures the refined source and the corrected 124 instrument. The only credited gains are the three bare-name items. A direct Node 22/current Node lint probe prints identical output; the earlier failure is retained in the before capture.

PR 131 is now merged into this branch, after 120 and 124. Fresh typecheck and lint precede the next push. The lead cancels the old queued CI; do not rerun it. PR 133 will correct the seven maintenance oracles when merged; those gains also belong to the maintainer.

### Previous executor measurement, iteration 14

Seed 1 passes 902 of 1170 items (0.770940170940171), level 0. The stats command changes all 37 estate.stats items from fail to pass. The timing-only scan.hostile.wide-folder item changes from pass to fail: its structure holds, but its scan takes 12377 ms against 5000 ms. A separate unchanged-reader probe then passes twice and fails once at 5110 ms; this is a variable timing result, not a claimed fix or a discarded failure. The measured score keeps that failure.

The initial command tests were red. The final stats and replay tests pass all 18 assertions; typecheck and lint pass. The final dedicated stats family passes 37 of 37 after the lead's reach clarification. Reach is reported only for skills, references, guards and subagents. Every other approved atom is counted in reachNotObservable as not observable; no exposure is inferred. Compliance and decay use the production offline replay checks, with no paid model call.

Captures: .cache/estate-executor/iteration-14.json, iteration-14-final-family.json and iteration-14-final-tests.log. The full seed 1 capture precedes only the final reach-population clarification; the complete stats family and command tests verify that final version. The frozen pre-fix all-seed sweep still runs into baseline-full.json (session 14550). No current all-seed result is claimed. The bank maintainer's stale-test commit was dropped locally at the lead's request; do not cherry-pick or push it. Wait for the lead's main-merge notice, then merge origin/main and check CI.

### Previous executor measurement, iteration 13

Seed 1 on c27c96dd plus the hazard-context fix: 866 of 1170 items pass (0.7401709401709402), level 0. The comparable pre-fix baseline is 862 of 1170 (0.7367521367521368). Exactly four hazard decoys change from fail to pass; no component regression is measured. This table is seed 1 only. Seeds 2 to 20 and the hidden seed are not claimed for the current code; the user requests a full sweep every five iterations.

The previous builder committed the BOM fix as c926508e but left no iteration 12 journal row. Row 12 recertifies the merged pre-fix seed 1 baseline; it claims no new fix and no BOM-only gain. The baseline snapshot originally lost its Git root, causing maintain.fixture.git-versions to fail on a pathspec error. That item was rerun on the unchanged snapshot with the original Git directory and the snapshot as GIT_WORK_TREE; the corrected result replaces only that invalid baseline item. Captures: .cache/estate-executor/baseline-original.json, baseline-maintenance.json, baseline.json and iteration-13.json.

The hazard-context test was red before the fix and green afterwards. Targeted scan and fixture tests: 16 pass. Typecheck and lint pass. The full estate test run under the worktree-only TMPDIR has one pre-existing TypeScript script failure; the test-environment section below records the same failure on the pre-fix snapshot.

### Historical pilot measurements


The ladder is a bank (docs/validators.md section 12): seven levels, each a sub-bank of items with threshold 1.0. Level 0 of 7 on seeds 1 to 20 and the hidden seed: the first level (reader and graph) has failing items on every seed. `pnpm driftbench validate estate --hardness` prints the bank score from the journal. Measured on origin/main 459beea merged into the lane (lane commit f1e6ec9).

| Row | Commit | Items passing on every seed | Score |
|---|---|---|---|
| iteration 0 | f1e6ec9 (lane/v-estate) | 737 of 1170 | 0.630 |
| iteration 11 | exec/estate-v2 25bb3096 | 840 of 1170 | 0.718 |
| pilot 1 to 10 | exec/v-estate-pilot2 | 756, 776, 785, 795, 803, 807, 811, 815, 818, 823 | 0.703 after pilot 10 |

Items fixed per pilot iteration: 19, 20, 9, 10, 8, 4, 4, 4, 3, 5; mean 8.6; none broken. Failing after the pilot: 347 items, 145 distinct causes. Forecast: 40.3 iterations. GATE.md holds the honest numbers for the owner. validators/estate/NEEDS.md cites the need of every family; none is quarantined. GATE.md records the accepted estate bar (forecast at least 30, score at most 0.75, causes at least 100), which holds. The section 12.4 gate does not hold on the forecast and the score. No audit: the owner ended validator work.

## The estate stats contract (in docs/estate.md section 7 and docs/reference/cli.md, frozen)

`driftbench estate stats --map <map> --plan <plan> --specs <dir> [--sessions <dir>] --json` prints `coverage.kinds: { <kind>: { atoms, tested, enforced } }`, `coverage.cells` and `coverage.edges` as `{ covered, total }`, `reach: [{ atom, reached, followed }]` and `decay: [{ block, runs, passRate }]`; exit 0, or 2 on bad input. The estate.stats items read `coverage.kinds`. The implemented reach covers skills, references, guards and subagents only; reachNotObservable counts every other approved atom with status not observable.

## The unit runner contract (in docs/estate.md section 6 and docs/reference/cli.md, frozen)

`driftbench estate unit <specs...> --estate <root> --json` runs the unit-mode specs. It prints `{ runs: [{ spec, pass, failing: string[] }], guards: [{ guard, event, decision: "allow"|"deny"|"ask", message?: string, ms: number }], scripts: [{ script, exit: number, stdout: string }] }`. It exits 0 when every spec passes, 1 when a spec fails, and 2 on bad input. The unit.runner items read `runs[].spec` and `runs[].pass`.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The estate has no floor. Its current bank contains 1170 items; a floor waits for the hardness gate and the audit.

## Local artifacts, not pushed

Canonical executor worktree: <repo>/.worktrees/exec-estate-v2. Files under .cache are local, not pushed. They exist only in the canonical executor worktree; they are absent from Git clones and frozen handover archives unless copied explicitly. The current frozen archive under .cache/handover-21 reaches the canonical root through ../.. Source and capture paths below are relative to that canonical root.

The routing and compaction tests are committed in iterations 19 and 20; packages/estate/test/scan/registry-shapes.test.ts joins iteration 21. They are absent only from older frozen archives. Their .cache candidates remain local, not pushed. The negation test is committed in iteration 22 and the quoted-path test in iteration 23. Their candidates remain local, not pushed. The next scalar test is local at <repo>/.worktrees/exec-estate-v2/.cache/s24rules/packages/estate/test/scan/scalar-rules.test.ts and is not pushed until its separate fix is measured and committed.

The sweep source .cache/full-17 is local, not pushed and is absent from the handover-21 source snapshot; its full-17 measurement and stamps are copied under that snapshot's .cache/estate-executor/. Read the canonical .cache/estate-executor/full-17.state.json, full-17.source.json, full-17.json and full-17.stderr for it. The directory is immutable source c415e845. A missing directory in a frozen archive is not proof that the named canonical sweep stopped.

## Open items

The published row 23 capture is iteration-23.json, immutable base b32e618f plus its quoted-path source and test. It passes 946 of 1170, with 224 failures; reader has 68 failures of 641. All values here use seed 1 unless an explicit sweep source is named.

| Level | Passing | Failing |
|---|---|---|
| reader | 573/641 | 68 |
| lint | 45/46 | 1 |
| plan | 44/65 | 21 |
| generation | 196/270 | 74 |
| agent-mutants | 22/75 | 53 |
| maintenance | 49/53 | 4 |
| scale | 17/20 | 3 |

All 25 bench.defects, 25 determinism and 37 stats items pass. Unit-input and closed-list conflicts remain below. Seven PR 133 maintenance corrections pass and receive no executor credit.

### Historical pilot gap list


The pilot lists these gaps before the later executor fixes. This list is historical and superseded by the current capture above:

* Level 1, reader: routing cells without backticks, a slash command, a link to the skill file, a table whose first column names the skill, a table without outer pipes, routing as a list or a sentence or a heading (scan.standing, code.ts); standing files in subfolders and imported files (claude-code.ts); paths in quotes, bare, in bold, with backslashes, as @imports, as wiki links, with a line number, from the project folder variable, with a space (scan.paths); gate forms then, without, only after, a question, prior to, two on a line, act verbs updating and renaming (scan.gates); hazard synonyms and decoys with an outside owner (scan.hazards); negations, change notes, form numbers and quoted guard messages (scan.decoys). HTML comments and empty files are already handled; reader timing and the remaining hostile shapes stay open.
* Level 4, generation: a registered custom check (44 items), a "some call matches" check (30 items), distinct positive phrases per route (6), no outside trigger row for a rule that applies always (6), guard message and timing checks (4 each), a stage reach check (3).
* Level 3, plan: each situation crossed only with the atom kinds it acts on (plan.relevance, 20 items, one cause).
* Level 5 and 6: deleted registers and gates that no test notices; maintenance retires a test only when every named atom leaves (7 items).
* Level 7, scale: plan and generate over their time budget; at 5000 atoms lint reports 1132 findings on a clean estate, because a routing table longer than one prose chunk loses its rows past the chunk's end (bench.defects.long-routing-table holds the same cause at 400 rows).
* blind.*: "never read X before Y" is read as a gate; plural hazard words, characters counted in code units, list order as next edges and a helper named without backticks remain. HTML comments and tilde fences are masked as source examples; those comment items pass after iteration 16.

## Hypotheses tried

The ten pilot iterations are the journal rows 1 to 10 and the commits of `exec/v-estate-pilot2`: a catalogue of checks read as a registry; a path with an anchor, a query or a title; the adjective compact; gate markup; fenced examples skipped; more rule column names; a dispatcher's bare target name; YAML data files; command wrappers; a gate only before an act. A first pilot on the reader before the reader lane merged (`exec/v-estate-pilot`) is history, not measurement: the merged reader already held several of its fixes.

## Next actions

1. Iteration 24 accepts scalar JSON registry rules in packages/estate/src/scan/claude-code.ts. Copy packages/estate/test/scan/scalar-rules.test.ts from <repo>/.worktrees/exec-estate-v2/.cache/s24rules, local and not pushed. Run it red, then apply only the listed/enforces value block inside readJsonRegistry. Preserve registryEntries, keyed source provenance and event inheritance. Four prospective cases are red first, with two array controls passing; eleven related candidate assertions pass.
2. Measure against iteration-23.json, journal, commit and push after fresh typecheck and lint. Save a quiet fresh brief and failed ids, freeze an independent .cache/handover-24 and request the scheduled fresh review. Iteration 25 then accepts object-valued rules in packages/estate/src/scan/claude-code.ts, with packages/estate/test/scan/object-rules.test.ts from <repo>/.worktrees/exec-estate-v2/.cache/s25objects, local and not pushed. Apply only object-valued enforces normalization, preserving scalar support.
3. Read .cache/estate-executor/full-22.state.json, full-22.source.json, full-22.json and full-22.stderr for the tenth-fix sweep's actual source and result. They are local, not pushed. The completed older full-17 is 911 of 1170 on c415e845. Main 5a90bfb6 including PR 147 is imported and checked; push it with this iteration, then read the fresh PR CI status. Stop at 07:00 Europe/Brussels on 2026-10-13 if the bank has not reached 1.

### Historical next actions before takeover

Iteration 11 (exec/estate-v2): an empty file is noted and gives no atom (claude-code.ts read). Bank 840 of 1170, level 0 on every seed, 145 causes. Load on the dev machine made one sweep take over an hour; run sweeps one at a time.

1. scan.hostile settings-bom: settings starting with a byte order mark are not read (claude-code.ts readSettings).
2. scan.hostile hooks-wrong-shape and prompt-hook: hooks given as an object get a note; a prompt hook gives a guard atom.
3. scan.hostile duplicate-names and helper-subfolder, tabs-in-frontmatter.
Then the owner-flagged output items: lint codes, scan order, approve counts (122 vs 125 atoms), run and mutate not-built messages.

## Pitfalls

Current row 23 measures the full bank afresh on its explicitly stamped post-import snapshot. All 25 determinism items pass, including all five Node 22 comparisons. All 37 stats items and all 25 bench.defects items pass. The 41 unit.runner items still await the input-contract review. gen.task is reinstated, not quarantined. The bank has 1170 items. Rows 17 and 18 record fresh scale measurements and retain their different timing outcomes.

### Historical pilot notes

The former pilot bench gap list includes ignored reference folders, refused guard or setting mutants, the runtime pin, a phrase bank without a situation, short guard names and two ids in a registry cell. It is superseded: all 25 bench items pass at row 23.

The following notes preserve the pilot's inputs, timings and earlier family sizes. They are historical observations, not the current open-item count or a current passing claim. Use the latest journal row and the measurements above for current values.

* Measured once and carried to every row: the seed-free families on the committed fixture (unit.runner, estate.stats, kill.fake, gen.task, gen.reads, gen.coverage, estate.determinism, maintain.fixture), the scale run, and the five name items of bench.defects (rows 0 and 10 agree).
* estate.determinism (25, Node 22 included) runs scan, lint, plan, generate, diff, impact and mutate twice in separate processes on copies of the fixture, across folders, file orders, time zones and locales; all 20 pass. The map records when it was read and its root folder's name by design: the items leave those two out. estate.stats (28) fails until `estate stats` exists.
* Families on the Northwind fixture's generated suite (examples/estates/fixture, fictional), judged once per run (seed-free): unit.runner (26: every guard's unit specs pass, and turn red when the guard allows all, blocks all, changes its message or runs past its timeout; scripts on their fixtures), kill.fake (31: a generated live spec, green on the original, turns red on the delete or invert mutant of each atom kind, on the fake runtime), gen.task (23: every ask holds a task; quarantined, see NEEDS.md), gen.reads (23: no Read of a missing file), gen.coverage (25: one complete spec per atom of each kind, judged domain rules, the gap markers), maintain.fixture (20: impact on structural edits and on the two committed versions).
* kill.fake fails on all 31: the fake runtime knows only the Northwind proof asks, so most specs naming an atom fail on the original, and the specs that pass do not change on the mutant (D15 of the bench).
* The bank holds bench.defects (20 items from a model-free bench run: D2, D5, D6, D7, D9 and the long routing table) and five blind.* families (176 items) written by a breaker that never read packages/estate. The bench items D6 and D7 run the CLI as a child process, so a row takes several minutes on a loaded machine.
* The scale run of this measurement ran at a load average above 100: scale.scan-250 took 7 s against 4 s. A quieter run earlier passed the scan through 2500 atoms. Measure scale alone on a quiet machine.
* A measurement of every item except scale on seeds 1 to 20 and the hidden seed takes under a minute with six seed groups in parallel (`SKIP=scale` in `_captures/v-estate/measure-par.mts`). The scale family alone takes about 70 minutes and depends on machine load: measure it alone, on a quiet machine. This is a historical pilot note about reused initial scale results. It does not describe the current executor rows. Rows 17 and 18 contain separate fresh scale runs; their measured timing gains and losses stay in their respective captures and journal rows.
* The pilot fixed the hidden seed at 523931547 for every row, so rows compare item by item.
* An item that turned out wrong is fixed by the bank's author in a commit of its own (section 12.3): a step of a named process may be qualified `<process>/<id>`, and the oracle compared it with the bare id (commit c14526b).
* Several items can share one cause; the cause of each item is in bank/causes.ts. The largest causes (a registered custom check, a "some call matches" check, the plan's relevance table) hold 94 of the 237 failing items.
* A fix in the estate package must keep its committed fixture tests: the map of examples/estates/fixture is compared byte for byte, and its gates include "Read X before matching any line".

## How to run

```
pnpm driftbench validate estate --seeds 1..20 --hidden
pnpm driftbench validate estate --hardness
pnpm driftbench validate estate --items --seed 1
pnpm driftbench validate estate --brief
```

The ladder must be registered in packages/validators/src/ladders/index.ts (`estate: estateLadder()`), a maintainer change.

## Fixtures

* `packages/validators/fixtures/estate/seed-1.yaml` and `holdout-1.yaml`: the generated estates of seed 1 (files, truth, recorded answers, rule follower sessions).
* Every other input is built by the item's own seeded generator into a temporary folder: planted estates (bank/planted.ts) for the reader and lint families, the generated estates (pipeline.ts) for plan, generation, mutants and maintenance, scale estates (bank/scale-estate.ts).

## Validator item defects found during the Codex takeover

* `plan.relevance.helpers-running` conflicts with the documented covering-array contract. Section 4 of docs/estate.md requires every allowed target/situation tuple under the constraint list. The committed fixture's `pairwise.0003` targets `instruction.invoice-reconcile.dispatch-the-ledger-auditor-above-50` with `session_state: helpers_running`. None of the three constraints returned by `toEstateSpaceMap` forbids this cell. The item rejects it because its target kind is instruction, even though the instruction itself dispatches a helper. Proof: `.cache/estate-executor/relevance-defect.json`, observed on c27c96dd with the hazard fix only. Do not introduce an undocumented kind mask to make this item pass. The other policy items in the family require the same contract review; they are not all declared defective by this one example.
* The closed-list conflicts already recorded in NEEDS.md remain: code gates beyond the four documented forms, routing outside tables, and standing files beyond the documented sources. Keep these separate from component defects. No validator item or protected source is changed by this executor.

* Historical defect, corrected by PR 124: the earlier bank replay helper in packages/validators/src/ladders/estate/pipeline.ts registers only ordered and the empty default registry. The production replay command registers ESTATE_CHECKS. A fresh process that registers the existing production checks before genCompleteFamily.evaluate(1) makes eight previously failing gen.complete items pass: two guard_speed items, grounded-values obligation and twin, script obligation and twin, outside_trigger script and script_fixture script. This is a diagnostic probe only, not a bank measurement. Capture: .cache/estate-executor/replay-registry-defect.json. Do not populate the global default registry to hide the harness defect.
* Historical defect, corrected by PR 124: the earlier gen.task task-verb whitelist rejects approved fictional asks such as "Fill in the shipments late section of the week 41 report" and "Go through inbox/ and say which folder each message belongs in". The docs require a task verb and object; these asks meet it. Some other failures in that family are actual generic asks or missing complete specs and remain component work. Capture: .cache/estate-executor/task-cause.json. Do not rewrite approved user phrases to fit a private whitelist.

## Takeover test environment

Temporary estates and captures are kept inside the worktree's ignored `.cache` folder. With this long absolute TMPDIR, the existing TypeScript unit-script test fails on both the pre-fix c27c96dd snapshot and the hazard-fix code. The test passes in the takeover's original estate run with the default temporary directory. The cause is isolated: the tsx CLI Unix socket fails with listen EINVAL under the longer temporary path. The same script succeeds through Node with the local tsx loader; the probe is in typescript-loader-probe.json. This is a pre-existing environment-sensitive failure. PR 119 now supplies the imported fix through main a624204b. Its two native TypeScript tests pass on Node 22, including the long-path case. Preserve its regression test; do not create a duplicate launcher change.

## CI at the first executor push

PR 110 on 17dee300 fails the Node 22 and Node 24 build jobs only because packages/validators/test/estate/bank.test.ts:241 expects scan.dispatcher.dispatcher to fail and :257 expects scan.hostile.empty-definition to fail. Both component capabilities now pass. Node 22 reports 3886 passing tests and these two failures; the empty-file component fix predates this takeover. The protected validator tests are left untouched and the lead is informed for the bank maintainer. Capture: .cache/estate-executor/pr-ci-failures.log.

### Unit-family input mismatch

The current estate unit command accepts native JSON UnitTest records. The bank's fixtureSuite gathers YAML core specs under specs/ and incomplete/, plus static JSON, but omits the generated native unit/ JSON. unitFamily then passes the gathered YAML mode-unit specs to the JSON-only command, producing exit 2 before a guard or script runs. This is an instrument mismatch, not proof that the native unit runner is absent. The frozen CLI flags and output shape are already implemented in packages/cli/src/commands/estate-unit.ts. The native guard tests also require outcomes recorded on an original, which this bank path does not perform. Keep this distinct from missing headless helper support and from the pre-existing long-TMPDIR TypeScript failure. Sources: bank/fixture-suite.ts, bank/unit.ts, commands/estate-unit.ts and estate/src/unit/run.ts. No protected code or oracle is changed.

### Historical maintenance oracle conflict, corrected by PR 133

PR 133 corrects the earlier seven maintain.impact.<kind>-retires-its-tests oracles. All seven pass in the post-import measurements; these are maintainer gains. The original diagnostic captures show mixed-atom specs that the component correctly regenerates. Section 8 of docs/estate.md says to retire only when all metadata atoms are removed; a removed atom with other atoms remaining means regenerate. The pre-PR-133 retiresExactly oracle uses only metadata.atoms[0], excluding journey ids. A fresh seed 1 probe exhibits remaining atoms and correct regeneration for instruction, gate, reference, script, register, route and subagent. Capture: .cache/estate-executor/impact-defect.json; review file: .cache/estate-executor/maintenance-bank-defect.md. Keep the documented component rule. These are logged defects, not progress.

### Frozen pre-fix sweep

The pre-fix c27c96dd snapshot finishes seeds 1 to 20 and hidden 401483072: 845 of 1170 items pass on every seed (0.7222222222222222). Every seed stays at level 0. Per-seed passing counts range from 854 to 865. This is a baseline, not a current-code claim. The snapshot keeps the pre-124 instrument and the original Git context; capture: .cache/estate-executor/baseline-full.json. Timing items vary, so their changes are not credited as component fixes.
