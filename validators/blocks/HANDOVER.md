# Handover: validator blocks

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate blocks --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| hidden | 0 |
<!-- level-table:end -->

## Floor

None for ladder version 2: a floor starts at level 1 or more (docs/validators.md section 8), and main reaches level 0. The floor of 2 in validators/floors.json belongs to ladder version 1 and is history once version 2 is registered.

## Open items

Ladder version 2 (docs/validators.md section 13): 2,206 items, 75 families, 522 causes (at most about 27 items each), both agent kinds (a normal agent behind the function adapter, a code-interpreter agent behind the process adapter in a local sandbox) on every level. On main every failing item is a capability of an open pull request, except one:

- Level 1 (verdicts): every pattern with a parent fails, because the loader refuses the `parent` key, and the binary and byte-order-mark seeds fail, because `workspace.binary` is not in the schema (both on PR 562, head 03a6cc0e8, where level 1 passes). Every other level 1 item passes, the code-interpreter checks and the pairwise fault combinations included.
- Level 2 (parents): PR 562 (03a6cc0e8): parents 110 of 110 and the byte-exact carry 20 of 20 pass there.
- Level 3 (rule objects): feat/block-b4-report merged with PR 446 (63eb904f5): 110 of 110.
- Level 4 (value checks): `runLadder` is not on main. On B4 the value facts and tool schemas never reach the run (`blockEvidenceInputs`), so R1, R2, R2b, R3, R5, R5b and I2 never fire.
- Level 5 (diagnostics): `attributionOf` and `uses` are not on main; the normal look-alike pairs need the value facts above.
- Level 6 (section links): `radius sections reanchor --change-out` and `radius localize --store` are not on main (PRs 429, 433).
- Level 7 (blast radius): the 10-deep parent chain needs feat/block-parents.
- Level 8 (personas): `simulated_user` is not in the spec schema (research PRs 418, 444).
- Level 9 (intervals): only `intervals/headline/documented-example` fails: docs/concepts/statistics.md prints n_eff 7.0 and design effect 3.87; `suiteHeadline` computes 7.33 and 3.68. The doc example is the side that is wrong (the formula is unchanged since PR 426); its interval is right.

## Hypotheses tried

None yet: iteration 0 is the baseline of ladder version 2. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Land the parent key and its verdict rules (feat/block-parents), then fix the binary parent snapshot, and run `pnpm driftbench validate blocks --seeds 1..20 --hidden`.
2. Land the object loader and commands (B4 + F3), then make `object explain` exit as documented.
3. Take the next failing level and write one sentence: the component, the cause, the item that proves it; fix one cause with a test that reproduces the item first.

## Pitfalls

- An item reaches the product only through `BlocksProduct` (`packages/validators/src/ladders/blocks/product.ts`); importing a package in a level file bypasses the cheater tests.
- The shipped objects join the registry only after `initializeShippedObjects()` of the checks package; the harness calls it before every load.
- Each check of a test gets its own scratch folder: a cheater run that finds the real run's files passes for the wrong reason.
- The code agent (`agents/code-agent.mjs`) is a real process: its plan and log sit outside the workspace, and an item that reads them back proves the product saw only the workspace. A code item takes a few seconds; the whole bank on four seeds takes about 45 minutes on an idle machine.
- Timing items (`links.ts` `SECTION_CPU_MS`, `blast.ts` `RADIUS_CPU_MS`) read CPU time, best of 3: a loaded machine slows the wall clock, not the verdict.
- No id, marker, file name or text the product reads may carry an item's truth: use `token(seed, ...)`. `packages/validators/test/blocks.test.ts` spies on every product call and the scratch files.

## How to run

```
pnpm driftbench validate blocks --seeds 1..20 --hidden
pnpm driftbench validate blocks --brief
pnpm driftbench validate blocks --seeds 1..3 --hidden --items --json
```

## Fixtures

No fixture files: every input is drawn from the seed by the level files under `packages/validators/src/ladders/blocks/levels/` (the fictional shop Larkspur Cycles is in `harness.ts`; the planted agent and its two kinds in `kinds.ts` and `recipe.ts`). The formula references are in `reference.ts`; the cheating products in `fakes.ts`.
