# Handover: judges v3 labellers

## Level per seed

Measured at `b5c6f7aaabc5b1fd1322ba03b474184973818e22` with hidden seed 50715626.

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 5 |
| 2 | 5 |
| 3 | 5 |
| 4 | 5 |
| 5 | 5 |
| 6 | 5 |
| 7 | 5 |
| 8 | 5 |
| 9 | 5 |
| 10 | 5 |
| 11 | 5 |
| 12 | 5 |
| 13 | 5 |
| 14 | 5 |
| 15 | 5 |
| 16 | 5 |
| 17 | 5 |
| 18 | 5 |
| 19 | 5 |
| 20 | 5 |
| hidden | 5 |
<!-- level-table:end -->

Both builder and blind baselines and ten unchanged repeatability probes reach
300/300 items, score 1 and level 5. No fixes are invented. Rate: 0 items per
iteration. Forecast: undefined. Failing causes: 0. See `pilot.json`,
`journal.jsonl` and `audit.md` for independent verdicts and timing evidence.

## Floor

Version 3 has no ratified global floor (effective floor 0); its measured level
is 5. Version 2 stays the default with its existing floor 20. Its global floor,
items and journal are unchanged. The provisional delivery bar is in `GATE.md`.

## Open items

No bank items fail at the measured checkpoint. The original hardness gate still
fails; independent cause review has no failing population to sample. This
scripted bank does not measure a real labeller model's semantic accuracy.
There are 10 shared cause groups, not 300 independent failures.

## Hypotheses tried

A predictable class schedule lets a call-index cycle pass four interleaved
replay items. Independent red evidence reproduces it. Seeded shuffling preserves
class counts and removes the shortcut. The final audit records the result.
An empty label set previously hashes successfully; the blind scorer test
requires rejection, and the implementation now rejects it.

## Next actions

1. Review the provisional bar and audit limitations before any merge decision.
2. Adapt a real recorded labeller through `JudgesV3Options.labellerFactory`;
   supply only request fields, never fixture gold or item identity.
3. Add genuinely missing capabilities as independent items, then repeat the
   blind pilot and cause review when actual failures exist.

## Pitfalls

Ordinary validator exit codes are reached levels, so level 5 exits 5.
`--hardness` is expected to exit 1 under the unchanged original contract.
Abstentions count against agreement even when evidence is withheld; they are
not gold labels. `none` is a real class. Invalid outputs count separately.
JavaScript candidates share a process: the request boundary hides the oracle,
but does not sandbox arbitrary filesystem access or monkey-patching.

## How to run

```sh
pnpm driftbench validate judges --ladder-version 3 --seeds 1..20 --hidden --items --json
pnpm driftbench validate judges --ladder-version 3 --hardness --json
pnpm driftbench validate judges --ladder-version 3 --check-handover
pnpm exec tsx packages/validators/test/judges/v3/pilot.ts <output-directory>
pnpm exec vitest run packages/judges/test/labeller.test.ts packages/validators/test/judges/v3 --maxWorkers=2
```

In the shared build environment, heavy commands use the owner's slot runner.
The hidden seed derives from HEAD; reproduce this measurement at the checkpoint
above. Later evidence-only commits have a different hidden seed.

## Fixtures

`packages/validators/src/ladders/judges/v3/fixtures.ts` generates fictional
integer-interval text, paired transformations and recordings. `bank.ts` defines
items, tier bars, independent metric probes and replay/key checks. `index.ts`
registers five levels. Every family has six structural variants per tier:
30 items per family, 60 per tier, 300 total. No live model or word list is used.
