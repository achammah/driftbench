# H4 pre-registration: the gate keeps invalid realisations at or below 2%

Written 2026-10-15, before any paid call. The shared setup in `../README.md` binds this file.

## Hypothesis (section 5, verbatim)
| # | Claim | Experiment | Metric | Falsified if |
|---|---|---|---|---|
| H4 | The gate keeps invalid realisations at or below 2%. | 300 realisations through the gate; 20 planted bad ones; 50-item human audit. | Planted catch rate; audited false-accept rate. | Fewer than 19 of 20 caught, or false accepts above 2%. |

## Design
- The 300 realisations are the 300 planned rows of the H1 design: 10 blocks times 30 rows. Rows per block: a strength-2 covering array (planner seed `1000 + 10 * b`, best of 5 seeds) extended to 30 rows by greedy 3-way gain (seed `1005 + 10 * b`), where b is the block number 1 to 10. Each row is realised by `gpt-6-luna` and gated; up to 6 candidates per row. Call seeds: the first 8 hex digits of sha256(`h1|<block>|<row>|<attempt>`).
- The 20 planted bad realisations are in `planted.json`, committed with this file: 5 swapped digits, 5 flipped negations, 5 second ids, 5 missing items, spread over 8 blocks. They go through every stage of the gate except the two axis stages (they carry no planner row), with the block's seed plus its accepted H1 set as the near-duplicate reference, and are never added to any accepted set. A planted item is caught when at least one stage rejects it. All stages run on every planted item, so the report shows which stages catch it.
- The audit: 50 accepted generated realisations of the H1 design, drawn uniformly without replacement with a seeded generator (mulberry32, seed 4004) after generation ends.

## The audit is not a human audit
Section 5 asks for a 50-item human audit. No human labeller is available in this lane. Change, written before data: two non-human labels per item.
1. My own reading (the lane agent, Claude Opus 5.5) of every one of the 50 items, written to `audit-mine.json` BEFORE the second labeller runs.
2. `gpt-6.1-sol` at reasoning effort high, given the rubric below, the assistant's last reply, the seed and the candidate, blind to the gate's verdicts and to my labels.

An item is invalid when either label says invalid (the union, the stricter reading). Both label sets and their agreement are reported. RESULTS.md says plainly that this was not a human audit.

Validity rubric. A realisation is invalid when, read as the customer's next message after the assistant's last reply, it:
- (a) changes, drops or adds a slot value (a phone, email, street address or plan; formatting such as case, spacing or a standard abbreviation is not a change);
- (b) changes the request, or adds or removes a constraint;
- (c) is not a plausible reply in that place; or
- (d) is so garbled that a competent human assistant could not act on it exactly as on the seed.
Style that misses its planner row (a "formal" text that reads casual) is not invalidity; it is axis conformance, reported separately.

## Metrics and verdict
- Planted catch rate: caught / 20.
- Audited false-accept rate: invalid / 50, with a Wilson 95% interval.
- Falsified if fewer than 19 of 20 planted items are caught, or if the false-accept rate is above 2%, which at n = 50 means 2 or more invalid items. SUPPORTED otherwise.
- Descriptive, not part of the verdict: acceptance rate per stage and per block, candidates per accepted row, rows dropped, post-gate 2-way and 3-way coverage of the accepted rows, and the surface Vendi score (character 1- to 4-gram cosine kernel) of each block's accepted set as a share of its size.

## Models, sample, stop
- Generation and gate: `gpt-6-luna`, reasoning effort low, default temperature (0 is rejected), JSON output. Audit labeller: `gpt-6.1-sol`, effort high.
- Sample: 300 planned rows, 20 planted, 50 audited.
- Tiny sample first: rows 0 to 2 of 2 blocks end to end; USD per row measured and the total re-projected in `../LEDGER.md` before scaling.
- Stop: the lane guard (36 USD). Expected H4 cost well under 2 USD.

## Amendment 1, 2026-10-15, after the tiny generation sample and before any scaled data
The tiny sample (rows 0 to 2 of B2 and B5, kept in `../data/tiny-v1/`) accepted 1 of 6 rows after 33 candidates. Reading every candidate showed three defects of the gate as registered, none about validity:
1. The equivalence judge rejected the class's own surface forms ("omits the +1 country code", "omits Acme from the plan name"). Fix: the judge now receives the listed spellings of each value as the same value.
2. Axis conformance by blind labelling disagreed with the row on fuzzy axes far more often than the texts did (the lexical axis, register neutral against formal), and counted punctuation inside dictated values (an address with a comma) against `no_punctuation`. Fix: the model now verifies each axis against the required value (yes or no per axis), told that the punctuation, capitals and spelling of the fixed values never count.
3. Retries repeated the same rejected text. Fix: from the second candidate on, the realiser sees the previous rejected candidate and the stage that rejected it.

A second tiny sample (`../data/tiny-v2/`) accepted 4 of 6 and showed two axis definitions that cannot be met by slot-only seeds (`synonyms` when the seed has no other words; `terse` at 8 words when the values alone take 7). Fix: `terse` is at most 4 words besides the fixed values; `synonyms` is "the words other than the fixed values differ from the original (when the original has no such words, any added wording counts), with a similar structure"; `seed_words` and `restructured` reworded to match. A third tiny sample (`../data/tiny-v3/`, B2, B5, B7, B10, rows 0 to 2) accepted 11 of 12.

The planted items, the audit sample, the validity rubric, the thresholds and the verdict rule are unchanged. Retry feedback makes the realiser adapt to the gate, which can only make false accepts more likely; the audit measures exactly that.
