# Verification: judges v3

Runtime: Node 24.18.0, pnpm 10.30.2. All heavy commands use the owner's shared
slot runner; all Vitest invocations set `--maxWorkers=2`.

## Red-first evidence

- The scorer test suite first fails because `../src/labeller` does not exist.
  The implementation then passes its 24 cases.
- The CLI version-selection suite first reports eight failing tests and one
  passing test. Failures include ignoring `--ladder-version` and reading the
  legacy journal instead of `validators/judges/v3/journal.jsonl`.
- A subsequent fresh-brief test fails because its commands and evidence paths
  point at the default version. Version-specific command/path rewriting fixes it.
- The independent breaker first reports 36 passing tests and one failure:
  hashing accepts an empty label set. The implementation rejects it; all 37
  independent cases pass without relaxing the expectation.
- The position-cycle regression first passes four interleaved replay items on
  each tested seed. Seeded category shuffling removes that shortcut. The bank
  suite then passes all 14 tests; the independent audit expands seed coverage.

These failures are observed before the corresponding implementation changes.
The independent audit contains the mutation results and final shortcut matrix.

## Completed checks

- `pnpm typecheck`: passes after the final implementation correction.
- Focused scorer, independent adversarial scorer, bank, bank-summary, hardness
  and version-selection suites: 100 tests pass across six files.
- Legacy judges ladder/labels/cassettes: 20 tests pass across three files.
- Existing CLI validate regression tests: 21 pass, 10 heavy integration tests
  excluded by name (`through main`). The full workspace suite is not claimed.
- Scoring/cache/replay source mutations: 20 tests pass; every mutation loses at
  least one real bank item. Independent baseline is 300/300 at seed 71.

Version 2 source/items, its global floor and its journal remain unchanged.
Original hardness is expected to fail; [GATE.md](GATE.md) records the provisional
exception rather than changing the global scorer.

## Final evidence checks

The independent cheat suite passes both tests: all 18 attacks pass zero items
and zero item-seed runs across seeds 1..20 plus hidden 50715626. After final
formatting, the 37 independent scorer tests pass again.

Biome checks all 16 changed TypeScript files successfully. The leak guard scans
39 changed files with zero findings or errors; no private denylist is loaded.
`--check-handover` exits 0 and validates the recorded table against the journal.
`--hardness --json` reads the blind rows, reports score 1, zero causes and null
forecast, and exits 1 as expected. `git diff --check` passes.
