# Handover: validator system

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 11 |
<!-- level-table:end -->

Measured 2026-10-15: unchanged main `14034c6ca` and product `4170c016e` both reach 11 of 11 on local seed 1. The current bank is Bank version 5 (2385 items), all passing; level 10 has 867 items and level 11 has 76. This supersedes the historical local state in journal rows 0–2. Seeds 2, 3 and the hidden seed still require the current CI result.

## Floor

11, ladder version 5 (the top of the ladder), in `validators/floors.json`. Raised from 9 after `validate system --seeds 1..3 --hidden --all-levels --json` in CI (job "system all 11 levels", run 38933066101, commit `06648a842`, the tree of main `e2e4aef97` plus a workflow change that keeps the json) reached 11 of 11 on seeds 1, 2, 3 and the hidden seed 108252356 (evidence: `validators/system/floor-v5-evidence.json`).

## Open items

- Timing item at floor 11: on the same commit, run 38931293751 reached 10 on the hidden seed, because `scale/spread-runs/growth` measured 44.1 times against a limit of 25 (7 ms at 100, 300 ms at 1000); run 38933066101 reached 11 on all four seeds. A run on a loaded host fails the same way. No item or threshold was changed.
- CI before: run 38780677540 on `14034c6ca` reports 9 of 11 and no failure because `--check-floor` sets `maxLevel` to the floor. The log explicitly marks levels 10 and 11 not run for all four seeds. This is a configured cap, not a timeout.
- CI wiring: PR #504, `fix/system-validator-full-ci`, head `93da8da9c`, adds an independent full-system job. It runs seeds 1–3 and the commit-derived hidden seed with `--all-levels`, and requires exit 11. Existing floors and banks remain unchanged. Run 38785996109 is executing the full command.
- Product: PR #506, `feat/system-climb`, is stacked on #504 to receive that CI job. The full local seed-1 run passes after the store fix. Four-seed CI proof is pending; read the latest run, not the earlier queued head.
- PR #428: its actual `not_run`/`blocked` exit 3 rule does not conflict with the inspected budget-stop bank items (`stopped` still exits 1). Its head `654e676aa` has contradictory help tables: `core-exit-codes.md` says 3, `running-outcomes.md` still says 1. Reported to the owner; neither changed here.

## Hypotheses tried

Held: `putRunNow` reparses and validates the campaign, including all N spec references, for each of N stored runs. Detailed instrumentation of the unchanged campaign-growth item counted 8125020 spec entries, 755.807 ms CPU parsing campaign JSON, and 823.087 ms validating campaigns. With the fix these are 5240 entries, 0.680 ms and 5.383 ms. These totals include the validator's extra large-size retry before the fix, so they are diagnostic totals, not a fixed-work speedup ratio.

The fix retains only the last validated campaign's exact serialized row and its realized-text policy. Every write still queries current bytes. Changed rows are revalidated; corrupt/missing rows still fail; another connection's retention-policy change takes effect. Cache memory is bounded to one row and released on close.

The new regression fails before the fix (40 campaign validations for 40 writes) and passes after (one). The 65 selected store tests pass, covering file corruption, retention, bundles, races and ordinary writes. An independent read-only review found no defect in corruption handling, transaction rollback, policy changes or cache bounds.

Timing measurements, seed 1, fresh process per sample, unchanged item and threshold:

| Product | 200-cell best CPU ms | 2000-cell retained CPU ms | Growth | Verdict |
|---|---:|---:|---:|---|
| main 14034c6ca | 45.806 | 1273.469 | 27.8014 | fail |
| main 14034c6ca | 52.051 | 1320.010 | 25.3599 | fail |
| main 14034c6ca | 52.181 | 1291.403 | 24.7485 | pass |
| product fix | 41.406 | 916.735 | 22.1401 | pass |
| product fix | 44.343 | 938.694 | 21.1689 | pass |
| product fix | 43.259 | 895.543 | 20.7019 | pass |

The limit remains 25. The samples retain the bank's own rule: fastest of three medium samples, large-size retry only after exceeding the limit. The baseline varies across the limit on identical code. Report timing-sensitive failures with the samples; never loosen the item. Three additional uninstrumented post-fix runs pass.

## Next actions

1. Read the latest `system all 11 levels` CI job on #506. Require all four seed columns through level 11; if any item fails, reproduce its exact seed and fix the product.
2. Read #504's full-system result separately. Keep CI wiring and product changes in their separate PRs; retarget #506 to main when #504 merges.
3. After the final push, remove this job's node_modules and sole worktree. Do not remove another job's files or worktrees.

## Pitfalls

- A local seed-1 pass is not four-seed CI proof. The hidden seed changes with the checked-out commit, including GitHub's PR merge commit.
- `--check-floor` intentionally caps measurement at the floor, even with `--all-levels`. The full job uses a plain run and expects exit 11.
- Do not edit source during a system sweep: its CLI subprocesses read the worktree.
- Timing probes must run sequentially; instrumentation totals are not directly comparable when the item takes a different retry path. The table above uses the unchanged timing function, with a wrapper that records its returned CPU samples.
- Full local sweeps print MaxListeners warnings and a fixture's `fatal: not a git repository` diagnostic; inspect the report and exit code. Both measured seed-1 sweeps exit 11 with no failing item.
- Historical bank versions and earlier investigations remain in the append-only journals. They do not describe the current main or its current bank count.

## How to run

```sh
pnpm driftbench validate system --seeds 1..3 --hidden --all-levels --items --json > result.json
pnpm driftbench validate system --journal row.json
pnpm driftbench validate system --check-handover
```

A full pass exits 11, not 0. For one item, filter `systemBank()` by its exact id and call `runItem(item, seed, root, scratch)`. Do not edit the bank to select it.

## Fixtures

- `packages/validators/fixtures/system/bank-manifest.json`: item inventory.
- `packages/validators/fixtures/system/design.json`: Monte Carlo design.
- `packages/validators/src/ladders/system/bank/`: generated items; scale timing in `scale.ts`.
- `examples/acme/faults/`: fault family; unchanged.
- `packages/store/test/campaign-write-scaling.test.ts`: product regression and policy/corruption checks.
