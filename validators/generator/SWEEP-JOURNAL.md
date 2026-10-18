# Generator sweep journal

Full bank measurements are appended to `journal.jsonl`. This journal records partial measurements and their limits while a sweep runs.

## 2026-10-13T06:32:25+02:00: deadline checkpoint

- Options A and B and the separate compose repair are pushed to PR 113. Code source: `8359f453`; latest fixture alignment: `1b06db25`.
- The full sweep started at 06:13 local time with seeds 1 to 20 plus hidden and two seed workers. At this checkpoint, 0 seed result files are complete. Global Acme and scale results are still pending. Evidence: `.exec/after-ab.log` and `.exec/after-ab.json.seed-*.json`.
- A separate seed-1 ladder run stops at its first failing level. Its result is pending in `.exec/level-ab.json`.
- The latest completed bank measurement remains journal row 17 at 2026-10-13T01:29:28Z: seed 1, level 5, 1551 of 2033 items, source `4d94b132`. This is the pre-change baseline, not a measurement of options A and B.
- Final typecheck and lint pass. The full repository test run is still running. Acme extraction, generation and budget rechecks pass all 30 tests after fixture alignment. The run reports a system-floor assertion failure and a CLI action test failure; their final failure details are pending. These are not reported as passing.
- The six formerly unchecked fault classes are killed in the graph-suite integration test. The compose regression fails before the repair and passes after. The repair makes the bank stricter and changes no item's expected answer.

The next entry records completed seed results or the final bank result. No unmeasured item is counted as passing.

## 2026-10-13T06:34:53+02:00: fresh seed-1 level

- Source code: `8359f453`, unchanged by the later documentation and Acme fixture-alignment commits. Command: `pnpm driftbench validate generator --seed 1 --json`. Exit code 5 is the measured ladder level.
- Seed 1 reaches level 5 of 22. Levels 1 through 5 pass all their items. Level 6 passes 19 of 22 items.
- The stop-at-first-failure run measures 148 items, of which 145 pass. This is a partial measurement, not the score of the full 2033-item bank. Levels 7 through 22 remain unmeasured by this command.
- The first failures are `gate.shortcut.passed-by-first-tool` (8 boundary blocks), `gate.contrast.then-ignores-edit` (30 blocks), and `gate.accepted.boundary` (54 of 72 boundary blocks accepted). No bank expected answer or threshold is changed.
- Machine-readable evidence: [options-ab-seed-1-level.json](evidence/options-ab-seed-1-level.json). The full seeds 1 to 20 plus hidden sweep remains active.

## 2026-10-13T06:37:53+02:00: CLI rechecks

- The two CLI generation expectations are aligned with the regenerated Acme refusal reason and 252 complete specs. All 7 CLI generation tests pass.
- The isolated CI action test passes its parity and bad-input branches in 74.647 seconds, with no CI code changes. The earlier full-run failure took 139.742 seconds against an explicit 120-second test timeout; its final error detail is not yet available, so timeout is a hypothesis.
- The system committed-floor assertion remains unresolved. A read-only diagnosis is running; no system validator expected answer, source, or floor is changed.
- Full repository tests and the 21-seed sweep remain active. Fresh seed-1 level: 5, with the partial measurement limits recorded above.

## 2026-10-13T06:41:34+02:00: system-floor recheck

- The exact committed-floor run is repeated on source `cf271ae8`, seed 1, through floor 7. All 1297 items pass and the run reaches level 7. [Measured level counts](evidence/options-ab-system-floor.json) preserve the source and timestamps; full item details remain in `.exec/system-floor-ab.json`.
- No deterministic regression is reproduced. The original full-suite failure cause remains unconfirmed until its final error details are available. No system validator source or floor is changed.
- Every failure reported so far by the still-running full test suite has a passing focused recheck. The full suite and the 21-seed bank sweep are still running.

## 2026-10-13T06:44:24+02:00: completed seed workers and gate fixture recheck

- Seed 2: level 5, 1791 of 2009 seed-dependent items pass. The 24 global Acme and scale items are pending, so this is not a full-bank score. Source: `8359f453`; evidence: `.exec/after-ab.json.seed-2.json`.
- The regenerated D4 loose-confirmation probe is `gen-deviation-005`; the CLI gate test now references that probe. Its acceptance, fault-kill and control assertions remain unchanged. All 10 gate and pilot rechecks pass.

## 2026-10-13T06:48:13+02:00: seed 1 finishes and full test results

- Seed 1: level 5, 1788 of 2009 seed-dependent items pass. Seed 2: level 5, 1791 of 2009 pass. The same 24 global items remain pending. These counts do not claim full-bank scores.
- The full repository run finishes with 424 passing files and 6 failing files; 5018 tests pass, 7 fail and 43 skip. The CI suite cleanup hook also times out. Three failures are stale fixture expectations now fixed; three are explicit test timeouts; the system-floor assertion reports level 2 rather than floor 7.
- All seven failed tests have passing focused rechecks, including the exact system-floor run through level 7. The original system item failure is not captured by the test assertion, so its cause remains unconfirmed. All six affected suites are rerunning together with one worker, a 30-second default test timeout and a 60-second cleanup timeout. Explicit per-test timeouts and bank budgets remain unchanged.

## 2026-10-13T04:55:24+00:00: owner pause

- The owner says: "alright man, let's pause it all for now." The sweep parent and its two active children receive SIGTERM and are verified stopped. No other process is stopped, and no automatic finalizer is armed.
- Seeds 1, 2, 3 and 4 all reach level 5. Their passing seed-dependent item counts are 1788, 1791, 1773 and 1789 of 2009. Seeds 5 through 20 plus hidden and 24 global items remain pending. [Partial evidence](evidence/options-ab-partial-sweep.json) contains every measured level and failure.
- The six affected test suites finish before the pause: all 6 pass, with 105 tests passing and 4 skipped. This recheck uses one worker, a 30-second default test timeout and a 60-second cleanup timeout; explicit test timeouts and bank budgets are unchanged. The initial full-run failure record remains preserved above.
- A read-only adapter audit finds a remaining option-A edge case: Claude Code replay assigns step-feed rows before the first user turn to block 0, falsely satisfying `stage_reported: true`. The repair is not started. No further adapter or runner gap is found in the audited surfaces.
- On resume, fix that boundary with a regression while preserving old spec behavior, then finish the sweep and append native journal row 18. The stopped parent kept global scale results only in memory, so those must be recomputed.

## 2026-10-13T07:00:04+00:00: resume and replay boundary repair

- The owner resumes work from `a0fedc3b` and authorizes merging PR 155 (cap) and PR 158 (speed) into this branch after the replay repair. Their workers are paused.
- The replay regression first reproduces the false pass in all three modes, then passes after pre-turn stage reports gain carried provenance. Legacy omitted/false flags remain unchanged. The targeted run passes 130 tests in 12 files.
- The combined cap evidence and full 21-seed sweep require fresh measurements. Pre-pause seed files retain their old source stamp and are not reused as new evidence.

## 2026-10-13T07:20:27+00:00: integrated source checkpoint

- Cap PR 155 and speed PR 158 are merged at `6236f772` and `8d44e8f5`. The owner authorizes both merges; neither other branch nor worktree is edited.
- Replay stage provenance and its cache version are repaired in separate commits. The new cache regression fails before the version bump, then the 27-test recheck passes.
- All 104 focused integration tests pass. Lint passes; the rename-scope script changes no files. Typecheck, fresh cap evidence and paired speed measurements are running. Full repository tests and the new 21-seed sweep remain pending.
- Measurement source: `1084a1e5`. The cap evidence script now compares written YAML hashes and protected probes against the uncapped suite. Historical cap counts remain bounded to their earlier source.

## 2026-10-13T07:33:26+00:00: focused local verification only

- The owner directs local work to run only focused tests, with full suites delegated to CI because host load exceeds 200. The local full run exits 143 after SIGTERM; every recorded process from that run is verified stopped. Its log has no completed suite result, so it supplies no pass or fail count. No other job is stopped.
- The focused integration result remains 104 passing tests. Repository typecheck and lint pass. Both measurement scripts also pass a separate TypeScript check after a type-only cap-options correction.
- The selected 100x cap will be timed in five full-window runs. Report the median process user-plus-system CPU time as contended, with no causal speed-gain claim. Pre-change single runs remain diagnostic output-preservation evidence.

## 2026-10-13T07:57:17+00:00: recovery after plugin interruption

- The recorded benchmark parent and child are absent after the plugin crash. Only the 1x and 10x after measurements complete; the 100x comparison, cap-limit probe and cap assays produce no completed result. No sweep was started. No interrupted result counts as evidence.
- Replay recheck on `a7fb2452`: 22 tests pass across the current-block stage and replay cache regression files. The repair is already committed in `9abeb25c` and `42fb7c3b`; no duplicate fix is applied.
- The owner directs PR 174 to merge only after green CI, then requests the full 21-seed sweep with two workers and load logging. The owner assigns protected changes to an independent maintainer on `fix/generator-validator-contracts`; import from main only after that PR merges. No protection exception or branch rename is used.


## 2026-10-15: maintainer D8 retry-contract ruling

- Base: `9f14f170b452dc8bd718749f833225ab977dcee3`, fetched from origin/main. The changes since the reported `14034c6ca` affect the system HTTP validator, not this generator contract.
- Ruling: render D8 read-tool recovery as `count: 2`, the initial failed call plus the one retry already required by the prompt. A maximum alone permits skipping the retry. Changing the advancing mutant to over-retry would replace the existing fault with one already covered by `D8.retry-many` and let a weak generated Then pass.
- Red first: the new regression on base records 23 failed, 2 passed. On seeds 1 and 3, a Then copied from the old rendered recovery passes recovery and fails adequacy; a Then requiring exactly two calls passes adequacy and fails recovery. The observed self-loop text, stage and call inputs match; call multiplicity differs.
- Green: 54 tests pass across the D8 regression, hidden-map pins, rendered contract, follower and fault-fidelity files. The regression spans visible seeds 1–20 and base-commit hidden seed 669949872. It also rejects weakening the Then back to `max: 2`, catches excess retries and exercises an ordinary transition.
- Actual generated-suite measurements: seed 1 adequacy changes from 8 missed first changes out of 23 to 0/23; seed 3 changes from 6/18 to 0/18. The recovery item passes before and after on both seeds. Both original items and their thresholds remain unchanged.
- Updated the canonical seed-1 approved YAML and hidden JSON; the byte-for-byte rendered-map test passes. Product source, follower, mutants, floors and hidden-seed derivation are untouched.
- Partial measurement only: no new ladder level or bank score is inferred. The executor journal and its level table retain their historical measurements. Evidence: [d8-retry-contract.json](evidence/d8-retry-contract.json).
- Product obligation: every generated D8 read-tool failure block must require exactly two calls, the pending stage and the failure report, including self-loop failures.

- Validation: focused Biome and diff whitespace checks pass. Typecheck passes with only the test importing sparse-excluded `comparisons/langfuse` omitted; the ordinary full typecheck reports that missing import and its two dependent implicit-any errors.

## 2026-10-15: maintainer semantic invariance pairing (PR 510)

- Base: `779d61573f6e92d995241be6aad515bdc28f3b9e`, the existing PR head. The auditor shows that renaming a block hides a wrong expectation while a separate clean pair still satisfies pair existence.
- Ruling: Given and ordered When define the comparison; Then is the value tested. Approved phrase intents, stage transitions and slot bindings supply meaning. Persona introductions normalize; unknown wording stays literal. Neither block ids nor expected stages can separate a pair. Actual initial/per-turn facts and language remain fixed.
- Red first: 39 cases fail on the base, including the auditor's same-turn/wrong-Then reproducer on all three paths and both axes. Green: 111 tests pass across five files. All 24 hand-built planted true pairs across fresh seeds 1009, 2027, 4093 and 8191 pass the real reference and reject the wrong Then despite opaque ids and a separate clean pair. Another 24 planted mutations of real generated walks on those seeds also fail, while the original walks pass the reference.
- Generation-only measurement: all six invariance items pass on visible seeds 1–20 and base-derived hidden seed 7802775. Arbitrarily renaming every block leaves every verdict unchanged. The six formerly failing items are three different-request pairs, each scored on both axes: seed 3 input-value vs behaviour; seeds 5/18 input-value vs returned-value. The actual requests and complete final-block Thens are in the evidence and PR body.
- The seed-18 gen-cover-096/gen-phrase-012 false pair remains excluded. Controls preserve transition order, bound values, burst boundaries, world/prefix facts and literal unknown requests; a changed expected stage never creates a new pair.
- Scope: no product changes, items removed, thresholds lowered, fault agents changed or fixture pins changed. No ladder level is inferred and the historical executor journal/level table stays unchanged. Evidence: [invariance-semantic-turns.json](evidence/invariance-semantic-turns.json).
- Product obligation: for the same facts and ordered requests, generate identical machine expectations across persona/channel variants, regardless of block labels.

## 2026-10-15: maintainer D6 world-carrier phrase contract

- Base: `5354503afed4cccfafdc43bd3988316aaa555c3d`, origin/main; separate from the D8 branch. Contract sources are the D6 definition in `docs/reference/spec.md`, the users package carrier registry, the WorldState schema and the existing hidden prompt.
- Ruling: a world-carried phrase is proven by the injected workspace-file/tool-result content. Both `diff.phrases.filled` and `phrases.D6_instruction_in_data` use the same carrier-aware reader. Its class and wording come from the registry and map, never seed IDs or fixture filenames.
- Red first: 25 failed, 11 passed. The existing world-instruction regression now includes differential and phrase coverage; those reject the valid world-only instruction while both fault items and the carrier item pass.
- Green: 44 focused tests pass across four files, including visible seeds 1–20 and base-derived hidden seed 399034490. Negative controls reject missing/empty worlds, invented text, wrong-class phrases, filenames/JSON keys, metadata, background Given and store/fixture/error fields. Removing behavioural assertions still leaves both fault items failing.
- Supplied product report: seed 2 falls to level 1 because differential rejects 24 empty user fields. A local reproduction relocates the main-generated suite's D6 text into world content in memory: all five affected provenance/coverage/carrier/fault items pass, with no reference block failures. Product files are unchanged; the parked product implementation and its passing real-run log were read only.
- Focused lint, whitespace, handover and sparse typecheck pass; the sparse typecheck omits only the unrelated test importing excluded comparisons/langfuse. No full ladder or bank score is claimed; the historical executor journal and level table remain unchanged.
- Evidence: [d6-world-carrier-contract.json](evidence/d6-world-carrier-contract.json). No items, thresholds, fault agents, fixtures, floors or hidden-seed rules are removed or lowered.
- Product obligation: put every approved D6 instruction in the injected world file/tool-result content, leave injection.user empty, and retain checks that catch both obedience faults.


## 2026-10-16: required behaviour ownership and distinct phrase capacity

- Ruling: every inventory behaviour phrase stays mandatory. Repair fixture ownership and feasibility; reports cannot waive orphan or capacity failures.
- Preserve all drawn ownership; augment existing matchings into distinct post-read (flow, stage) slots before adding a needed owner. No RNG calls are added. Insufficient total path capacity throws.
- Red first: final tests against unchanged constructor fail 13 and pass 19. Green: 40 tests in two generator files pass.
- Fresh seeds 1009, 2027, 4093 and 8191 pass the unchanged behaviour coverage item. Removing an owned phrase fails; adding a forged capacity report still fails.
- A comparison with base 119802811739d45a85c3dda5d3402a5cd31bce2c confirms all original ownership edges and every other hidden field are preserved on 24 public maps and the commit-derived hidden map. The latter is tested in memory and never serialized.
- Review the seed-independent construction, hand-written parcel routes and public seed-1 fixture diff; rerun the test at the reviewed commit for its new hidden map. The seed formula, bank, faults, thresholds and floors remain unchanged.
- Evidence: [behaviour-ownership-capacity.json](evidence/behaviour-ownership-capacity.json) and [red output](evidence/behaviour-ownership-capacity-red.txt). No full-bank or ladder score is claimed; the executor journal and level table retain their historical measurements.


## 2026-10-16: ownership repair review correction

- The first repair is not globally minimal on the reviewer's hand-written orphan-first example. It consumes a narrow owned slot before reserving all drawn ownership.
- Compute the maximum matching across all original ownership first. Add one edge per unmatched behaviour to a free eligible slot. This achieves the lower bound of behaviour count minus maximum original matching cardinality.
- Red first against b1ffc7ca1611550ee32a33c87f117c20df4b1616: the reviewer case and exhaustive graph control both fail. Corrected: 42 tests pass in two files; the graph control covers all 512 three-by-three ownership graphs.
- The independent probe confirms minimum additions and preservation on visible 1–20, fresh 1009, 2027, 4093, 8191, 12289, 24593, 49157, 98317, and the hidden map in memory. No hidden map or hidden seed is serialized.
- Existing omission and forged-capacity-report controls remain strict. No source outside the generator validator, no thresholds, no waivers and no RNG changes.
- Evidence correction: [JSON](evidence/behaviour-ownership-capacity.json); [review red output](evidence/behaviour-ownership-capacity-review-red.txt). Prior measurements remain historical.

## 2026-10-16: maintainer integer-contrast request scope

- Base: `119802811739d45a85c3dda5d3402a5cd31bce2c`, origin/main. The reported counterexample is seed 1 at `3b12d6f13c15e0fe09f8dac1be72029768936e02`: preparatory minimum calls occur in both read/list partitions, while both write requests correctly defer.
- Ruling: measure every block whose approved data-value stimulus requests the partition. Require exactly one read-only call with that exact integer. Require explicit zero calls for a direct side-effect request, which supplies no CONFIRM. Shared setup and zero-call guards are not contrast values. Cell metadata and block ids never identify the measured request.
- Red first: 12 tests fail and 3 pass on the unchanged base. These include the false rejection of correct shared preparation and false acceptance of missing/wrong/permissive assertions when unrelated calls differ. A further red-first case proves exact JSON and singleton numeric assertions must retain their declared equality semantics.
- Green: 26 tests pass across integer contrast and the adjacent invariance-context file. All six integer items pass on fresh seeds 1009, 2027, 4093 and 8191. Every block of every generated scenario carrying those integer requests passes the real reference.
- The product mutation is injected at the generator seam, before files are loaded: it copies schema-minimum inputs instead of honoring explicit valid integer requests. All four read/list contrast items fail on each fresh seed. No product source file is modified. Negative controls also reject an unconfirmed write call, a missing prohibition and a clean duplicate hiding a wrong assertion.
- Focused typecheck passes. Evidence: [integer-contrast-contract.json](evidence/integer-contrast-contract.json), [red-first output](evidence/integer-contrast-red-first.txt). No item, threshold, floor, fault family, fixture pin or hidden-seed rule changes; no full ladder or bank score is claimed. Historical journal rows and the level table stay unchanged.
- Product obligation: preserve shared preparation, assert the exact requested valid read-only integer on its request, and forbid an unconfirmed side effect for both values.


## 2026-10-15: maintainer ruling on sequence stages and impossible pairs

- Base: `0137e2d25f4a98918d4498de555c729e41c2b1de`, origin/main. Contract sources: `possible.ts` (impossiblePairs), `render.ts` (hiddenSpaceMap carries written constraints and impossible pairs), the coverage items that read that map.
- Ruling: `sequence.stages.<class>` owes probes only at the middle stages the hidden space map allows for the class. A probe at a stage the map rules out fails the item. The same map serves the coverage items.
- Red first: 3 failed, 2 passed in `packages/validators/test/generator/sequence-stages.test.ts`. The base item fails a suite that probes every reachable stage (36 D8 cases over visible, hidden and fresh seeds) and passes a probe at a ruled-out stage.
- Green: 23 tests pass across four files. Covered seeds: visible 1 to 20, the base hidden seed 21439762 and fresh seeds 1001 to 1020. Planted guards: dropping one reachable stage fails and names it; a probe at a ruled-out stage, or only there, fails; a class with no reachable stage never passes.
- Product measurement, main's real generation: the old logic fails D8 on seeds 1 to 12, 14 to 16, 18, 20 and the hidden seed. The new item fails no `sequence.stages.*` item on these seeds or on 1001 and 1002. The product places no probe at a ruled-out stage.
- Sweep: `diff.feasible.<seeder>` also reads written constraints only, in the permissive direction. On seed 2, 39 blocks sit in an impossible-only cell, all from seeder `cover`, which no `diff.feasible` item reads. That item stays unchanged and needs its own ruling. The baseline suite's goal detour also reads written constraints only; it is not an item.
- Evidence: [sequence-impossible-pairs.json](evidence/sequence-impossible-pairs.json). No items, thresholds, fault agents, fixtures, floors or hidden-seed rules are removed or lowered.

## 2026-10-16: maintainer ruling on joint feasibility of a required cell

- Base: `14831cc80`, origin/main. Contract sources: `possible.ts` (the oracle), `render.ts` (the rendered path `when` and the behaviour read relations), `docs/reference/map.md` (path `when`, `uses_tool` subject, recovery `at`), the coverage items.
- Reported gap: about 20 triples of `cover.triple.behaviour.deviation.stage` (seeds 1, 2, 3, hidden, 37184422, 71271979) pass the pairwise `impossiblePairs` filter and have no event that carries all three values. Example: seed 2 B-004 belongs to the flow without a D9 recovery.
- Ruling: a required cell must be jointly feasible. One predicate (`jointWitness`/`jointlyPossible`, `possible.ts`) finds the one event of one path that holds the cell's stage and class, the path's flow, an owning behaviour (and the behaviour a tool-failure turn asks), the branch values the rendered path states (declared values and the valid output partitions) and every written constraint and inventory channel on a completion of the open axes. `impossiblePairs` reads it. The triple coverage items take their targets from it and fail a suite that places a cell no event carries. `diff.feasible.<seeder>` fails a block whose whole cell has no event, with its own reason beside the written-constraint one.
- Terminal behaviour D8 (rendered map): a staying turn that asks a behaviour whose own text names a read tool the flow recovers is a position at any stage after the start, the last included. A flow-move D8 needs the exact edge the tool is called on. A recovery with no `at` names the stages after the path start (map.md, `at`), so no D8 is said at the start; no drawn map has a tool call on its opening edge, so this changes no drawn cell.
- Red first: 29 of 44 tests fail on main (oracle absent, gap triple required and its emission passes). Green: 34 tests on three hand-written worlds (a parcel desk with the gap, a read desk with the terminal read, a fork desk with branches) and on drawn maps 1001 to 1003. 19 mutants, all killed.
- Measured on main's product, `diff` of required cells: the joint oracle removes the gap triples (seed 2: 3 of 184 allowed `behaviour x deviation x stage`) and adds the terminal D8 pairs the old oracle forbade (seed 1: 4). Emission: the cover seeder places cells no event carries (seed 2: 274 of 2007 positions, seed 1: 792 of 2420); every other seeder places none. The product obligation is to place only jointly feasible cells and to cover the terminal D8 cells.
- No item, threshold, floor, fault family, fixture or hidden-seed rule is removed or lowered; two new failure reasons are added to existing items. No full ladder or bank score is claimed.
- Consequence on the sequence family: `sequence.stages.D8_tool_failure` reads the same map, so it now owes a probe at each stage where a staying read can fail (seed 1: choice, details, recap; fresh 1001: check, choice, recap), where main's oracle ruled those stages out. Measured with the product of main: the item fails on seeds 1 and 1001 and passes on seed 2. The product obligation is a tool failure injected on a turn that asks a behaviour whose own text names the failing read tool.


## Ownership fixture integration: explicit imbalance in disk parity test (2026-10-16)

The generator's disk parity test imports the validator's mutable seed-5 hidden constructor. Main d37cc4c76 passes its balance-file prerequisite; ownership head 4b411d426 fails it before comparing any disk output. The minimum ownership edge B-002 to new-request changes scenario contexts: main needs three balance top-ups to bring D8 to 12 against maximum 35; the repaired fixture already gives D8 13 against maximum 35 and correctly needs none. This is not a disk/eager mismatch.

The test now constructs its intended imbalance by adding approved off-topic phrases before generation, on public seeds 1 and 5 and fresh seed 1009. It keeps the assertion requiring balance files, summary/file-count equality and every non-report file's byte equality. No generator product source changes. The separate merge commit preserves both sides of the records. See [integration evidence](evidence/ownership-stream-fixture.json). Historical ladder measurements stay unchanged.

Focused results: four disk parity cases and 42 ownership/pin tests pass. Disabling the balancing iterator through a temporary test spy makes all three explicit-imbalance cases fail. The spy is removed; product source is unchanged.

## 2026-10-15: maintainer ruling on feasibility and impossible pairs

- Base: `d1567480b`, origin/main. Contract sources: `possible.ts` and `render.ts#hiddenSpaceMap` in the validator, and the generator's own `packages/generate/src/seed/possible.ts`, which uses the same event rule.
- Ruling: `diff.feasible.<seeder>` reads the hidden space map (written constraints plus impossible pairs). Every seeder is checked: `cover`, `task`, and `unlisted` for any seeder no item names. Written-constraint reasons still win when both forbid a cell.
- Red first: 3 failed, 11 passed across the new and existing feasibility test files. On base, seed 2's cover block passes, and a graph block in an impossible-only cell passes.
- Green: 28 tests pass across four files. Covered seeds: visible 1 to 20, base hidden seed 513104064 and fresh 1001 to 1020. Every named seeder and an unknown one are planted per seed; allowed cells pass; each item reads only its own seeder.
- Product measurement, main's real generation: `diff.feasible.cover` fails on all 31 measured seeds, and `diff.feasible.twise` fails on seeds 10 and 15. Cause 1: a cover spec's behaviour is not in its flow, 6787 blocks in total. Cause 2: the first move is recorded at the start stage, 25 blocks. No block sits in a written-constraint cell. These items are level 2, so the product stops there until the generator is fixed.
- The baseline goal detour feeds only the replay cheater, which reads `expect.tools`. The detour lists no tool, so it feeds no verdict and stays unchanged.
- Evidence: [feasible-impossible-pairs.json](evidence/feasible-impossible-pairs.json). No items, thresholds, fault agents, fixtures, floors or hidden-seed rules are removed or lowered.
