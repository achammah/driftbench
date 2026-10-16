# H13 results: isolation runs find undeclared parent dependencies

Pre-registration: `PREREG.md` (commits d5d142b and 4725bae, with three deviations written before the main data were final, see below). Raw data: `results/arms.jsonl` (as run), `results/arms-scored.jsonl` (rescored), `results/pilot-arms.jsonl`, `plan.json`. Verdicts and tables: `results.json` (made by `analyse.py`). Cost: 6.29 USD at the stand-in price (`../LEDGER.md`).

## Verdict: SUPPORTED, by the rule written in PREREG

| Check | Result | Rule |
|---|---|---|
| Planted positives caught | 8 of 8 eligible (95% Wilson interval 68% to 100%) | at least 80% |
| Planted negatives flagged | 0 of 9 eligible (0% to 30%) | at most 20% |
| Natural edges with `manifest: true` | 53 of 94 | at least 1 |
| Repeat runs that differ (noise) | 1 of 54 | at most 25% |

The isolation run tells a child that reads its parent from a child that does not. It does so on a live agent, with little noise. The rule is met on a sample of 94 of 254 edges; see Limits for what this does not show.

## What an edge is and what was run

- 254 edges in `examples/acme/generated/specs` at `a7c3280c2`, all conversations. 94 were sampled by stem length (seed 13). Each edge ran as FULL1 (stem replayed live, then the child), ISO (the child alone, bare Given) and, for 34 of the 94, FULL2 (a repeat of FULL1).
- 20 planted children: 10 positives (the order block of a real spec, a bare CONFIRM, with its whole history as the stem) and 10 negatives (a real prefix, then a block that reads no state: store hours, a billing complaint, an instruction to change prices, a Dutch sentence).
- Agent: a stand-in written for this lane, `claude-haiku-5-5` with the Acme policy as a prompt and the real Acme tools. Scoring is code: expected tool calls and inputs, forbidden tools, `must`, `must_not`. Stage, language, guards and criteria are not checked.

## Planted children

- Positives: all 10 show `manifest: true`. Two of the 10 are not eligible because their stem failed in FULL1 for an agent reason (it did not ask "Which one" in one case, and did not use the "pick up where we left off" wording in the other). Counting them too, the result is 10 of 10.
- In every positive, ISO fails because the agent has no order to place: `order.create` is called 0 times against 1 expected.
- Negatives: none of the 10 shows `manifest: true` (0 of 9 eligible, 0 of 10 counting the one ineligible). In all ten, FULL1 and ISO pass.
- Reading: the check is not blind, and it does not fire on children that need nothing from the stem.

## Natural edges

| Measure | Value | 95% interval |
|---|---|---|
| Edges where the child pass vector changes (`manifest`) | 53 of 94 = 56.4% | Wilson 46.3% to 66.0%; cluster bootstrap by stem (73 stems) 44.9% to 68.5% |
| Edges where the child verdict flips (all blocks pass or not) | 45 of 94 = 47.9% | Wilson 38.1% to 57.9%; cluster bootstrap 37.8% to 58.9% |
| Same, over the 33 edges whose repeat run agreed with the first | 19 of 33 = 57.6% | Wilson 40.8% to 72.8% |

By stem length (edges in the sample, with `manifest`):

| Stem blocks | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Manifest | 5 of 30 | 16 of 20 | 19 of 20 | 13 of 15 | 0 of 4 | 0 of 5 |

- Where the dependencies are. The 45 edges that pass in FULL1 and fail in ISO, plus 8 edges that fail in both but differ block by block, make the 53. In 42 of the 53, ISO misses the `order.create` call, because the child is a CONFIRM with no history.
- Where they are not. Stem length 1 rarely shows one (5 of 30). Stem lengths 5 and 6 never show one (0 of 9): those children are state-free, such as a store-hours question after the order. A rate of exactly 0 would have been the warning sign in the design (Zhang's generated suites had 20%). The rate here is 56%, and the zeros are concentrated in the edges where the child reads nothing.
- Child blocks in FULL1: 251 of 267 pass (94%). Stem blocks of natural edges: 240 of 240 pass.
- Noise: FULL2 differed from FULL1 on 1 of 54 repeated edges (1 of 34 natural, 0 of 20 planted). The model runs at its default sampling, because the API refuses `temperature` for it. Run-to-run differences are rare (1 of 54), so the differences between ISO and FULL1 above are not explained by noise.
- Crude static cross-check (pre-registered, not part of the verdict): of 94 natural edges, 52 have an expected tool input with a value found in no child user turn and show `manifest`; 21 have such a value and no `manifest`; 1 has no such value and shows `manifest`; 20 have neither. The check flags constants and re-formatted values (phone numbers), so it over-reports reads. It is not a replacement for isolation.

## Limits

- Not an "undeclared" test in the strict sense. Generated specs declare no parent today, so every natural dependency is undeclared by default. The result says which edges depend on their stem. It does not say which part of the stem (messages, ledger, world, vars). That needs the end-state allow-list of the design, and a component-by-component ablation. This experiment ran none.
- The easiest dependency was planted. A bare CONFIRM with no history must fail. A subtler read, one variable that only the ledger carries, was not planted. The 8 of 8 shows the check works on a clear case.
- Agent: a prompt stand-in written for this lane, not the repo's deterministic Acme agent and not a production agent. Its state comes from the conversation text, which is why the edges with a stem of 2 to 4 blocks nearly always show a dependency.
- Scoring ignores stage, language, guards and criteria. Both arms are scored the same way, so the effect is a loss of sensitivity, not a bias between arms.
- Sample: 94 of 254 edges; the 9 edges with stems of 5 and 6 blocks are all included. The intervals above are the price of the 15 USD cap. All 254 edges would have made them about 40% narrower (the width scales with the square root of the sample).
- The pilot found two stand-in defects (scorer `absent` matcher, prompt wording of the current plan). A third defect, a planted-negative `forbidden` list applied to stem blocks, was found during the main run and fixed in scoring only, after an aggregate of caught and flagged counts had been printed once. It changed the eligible negatives from 3 to 9 of 10 and did not change a single model call. The raw run-time scores are kept.
- Counts were not re-run to improve them. The 114 items ran once.

## Deviations (all in PREREG)

1. `temperature` is refused by the model; default sampling is used.
2. Pilot fixes: `absent` matcher, current-plan wording. Pilot discarded from the sample, kept in the ledger.
3. Scoring fix for planted negatives (forbidden list), recomputed from stored turns.

## Stored data note

The stand-in agent wrote one example number, a placeholder phone in the style of a US number with the 555 exchange, in three places of two stored arms. The leak guard reads it as a real number outside the fictional range. The three occurrences in each of `results/arms.jsonl` and `results/arms-scored.jsonl` now read `+1 202 555 0123`. Nothing else changed: `rescore.ts` on the edited `arms.jsonl` gives a byte-identical `arms-scored.jsonl`, and `analyse.py` gives a byte-identical `results.json`.
