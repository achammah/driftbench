# H8 results: context size and fact position change the pass rate

**Verdict: FALSIFIED.** On `claude-haiku-5-5`, all fact cells sit at the ceiling from 2K to 64K at every depth: 2,995 of 3,000 fact runs pass, and none of the 95 pre-registered tests has a Holm-adjusted p below 0.05. "All cells within run noise" held. The instrument works: all 20 length-matched controls pass 0 of 30, so a pass means the agent used the planted fact.

Pre-registration: `PREREG.md` (d7865c48a), with one grid change written before data: 1K became 2K, because the Acme system prompt and tools alone are 1,172 tokens. Agent: this lane's live Acme agent (`agent/acme-live.ts`, five real Acme tools, repo `anthropicAdapter`), not the shared agent of `research/block-shared` (see Limits). Cost: 9.17 USD for H8 (pilot 0.04, first attempt 6.29, resume 2.84).

## Numbers

Pass rate pooled over the 5 blocks (mean of block rates, 30 runs per block per cell; block-cluster bootstrap 95% interval in brackets where not 1.0):

| Size | depth 0 | 0.25 | 0.5 | 0.75 | 1 | control (no fact) |
|---|---|---|---|---|---|---|
| 2K | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 |
| 4K | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 |
| 16K | 0.987 [0.96, 1] | 1.000 | 0.993 [0.98, 1] | 0.993 [0.98, 1] | 1.000 | 0.000 |
| 64K | 1.000 | 1.000 | 1.000 | 0.993 [0.98, 1] | 1.000 | 0.000 |

- Relative to 2K: every cell is 1.00 of the 2K rate except the four marked above (0.987 to 0.993).
- Smallest raw p of the 95 tests: 0.49 (address, 16K, depth 0, 28 of 30 against 30 of 30). Holm-adjusted: 1.0 for all 95.
- The 5 failures are all in the `address` block, at 16K and 64K. In 3 the agent recalls "46 Wren Gardens" but asks the customer to confirm before calling `coverage.check` (the pre-registered pass needs the call). In 2 it asks for the address again (16K depth 0.75, 64K depth 0.75): the only runs where the fact was lost. Each of the four recall blocks (account, phone, budget, carrier) passes 600 of 600 fact runs; address passes 595 of 600.

## Instrument checks (M4.3)
- `context_size`: the first model call's measured `input_tokens` has a per-cell median within -2.3% to +0.3% of the target; 0 of 120 cells outside 5%. Largest input 64,090 tokens, so every call stays under the 100K price threshold.
- `context_position`: per-cell median of the fact's actual depth within 0.0096 of the declared depth; 0 cells outside 0.02. Single runs at 2K and 4K miss by more (pairs are discrete), as the PREREG expected.
- `filler_clean`: 0 of 3,600 contexts unclean. The filler bank: 465 of 500 generated pairs kept after the filter.
- Control: 0 of 600 control runs pass; every control cell is at closed-book level (0 of 30). Typical control reply: "I can check that for you. What is your street address?"

## Protocol notes
- Network outage: the first attempt wrote all 3,600 rows, but 1,125 were transport errors (1,119 "failed after 4 attempts", 6 timeouts) during a 7-hour network outage. Those exact jobs were re-run once after the network came back (`run.ts resume`, `runs-resume.jsonl`, 0 errors). The error rows stay in `runs-full.jsonl`; each job counts once (its successful first-attempt row, else its resume row). No job with a successful row was re-run.
- Pilot runs (`runs-pilot.jsonl`, rep 99) are excluded from the analysis.
- Default sampling: the API rejects temperature 0 on this model (stated in PREREG). Runs vary by filler seed (0 to 29), paired across cells.

## Limits
- Ceiling: the task is a single verbatim fact in a conversation, retrieved by a direct question; Haiku 5.5 has a 1M-token context. The result says nothing about harder needles (NoLiMa-style latent links, multi-hop, several competing facts) or about sizes above 64K; there the published curves fall. A test that wants to see size or position effects on this model needs a harder fact task or larger sizes.
- One agent model and one prompt. This is the lane's own live Acme agent, built before the shared agent was announced; results do not transfer to the shared agent without a re-run.
- Filler is generated small talk repeated across the 64K contexts (the bank is about 20K tokens, so 64K contexts reuse pairs); RULER repeats noise the same way.

## Consequence for the design
- The `context` layer and its checks work as an instrument: size, depth and cleanliness are controllable to within 3% and 0.01, and the control proves fact use.
- On this model and task, size and depth do not change the pass rate up to 64K, so `context` should stay an optional layer. The report's rule "results with different sets of controlled layers are never pooled" is not supported by this data for simple recall, and stays a precaution for harder tasks.

Raw data: `results.json` (3,600 counted items, the 1,125 first-attempt errors, the analysis), `analysis.json`, `runs-full.jsonl`, `runs-resume.jsonl`, `calibration*.json`, `filler.json`, `filler-raw.json`.
