# H3 pre-registration: the exact-match oracle causes most class failures

Written 2026-10-15, before any paid call, and before the H1 runs it re-scores exist. The shared setup in `../README.md` binds this file.

## Hypothesis (section 5, verbatim)
| # | Claim | Experiment | Metric | Falsified if |
|---|---|---|---|---|
| H3 | The exact-match oracle, not the agent, causes most class failures. | Re-score H1 runs with the normalised-slot oracle. | Share of class failures that become passes. | Below 30% (IBM's prior: 70 to 90%). |

## Design
- Offline. Input: the H1 class runs (`../data/h1/runs-class.jsonl`), 30 gated realisations per block, one run each, 10 blocks. Every run stores its tool calls, so both oracles score the same calls.
- A class failure is a class run that fails the exact oracle. It becomes a pass when the normalised oracle passes the same run.

## Metric and verdict
- Share S = (class runs failing the exact oracle and passing the normalised oracle) / (class runs failing the exact oracle), pooled over the 10 blocks. Per-block shares are reported too. 95% interval: cluster bootstrap over blocks, 2000 resamples, mulberry32 seed 3003.
- Oracle-error guard: I read every run that flips, the raw slot value against the gold. A flip whose raw value is not a legitimate surface form of the gold (the normaliser was too lenient) is counted as not flipped and listed.
- Verdict: FALSIFIED if S is below 0.30 (the section 5 threshold). SUPPORTED if S is at least 0.50, since the claim says "most". INCONCLUSIVE if S is between 0.30 and 0.50 (not falsified, but "most" is not shown), or if there are fewer than 10 exact-oracle class failures in all.
- Secondary, outside the verdict: the same share on the H1 seed runs and on the H2 runs; the share of exact failures whose failing verdict names a slot field (input.<field>) against those that fail on counts or order.

## Sample, stop
300 class runs from H1; no new paid calls.

## Amendment 2, 2026-10-15, before the H1 runs exist
The H1 runs come from the shared live Acme agent (README, Amendment 2). The tool names are mapped back to the Acme labels before both oracles score them. Nothing else changes.
