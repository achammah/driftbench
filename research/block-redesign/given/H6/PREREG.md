# H6 pre-registration: a recorded tool call and the same fact in prose give different behaviour

Lane: given. Branch `research/block-given`. Written 2026-10-14, before any paid call of this lane.
Protocol: `scratchpad/codex/block-experiments/PROTOCOL.md`. Source: section 5 of `reports/Driftbench block redesign deep.md` (row H6), mechanism M4.2 in its section 2.4, `deep_4_initial_conditions.md` section (e) M2.

## Hypothesis (verbatim, section 5)
- Claim: "A recorded tool call and the same fact in prose give different behaviour."
- Experiment: "15 blocks, two Givens each (paired call and result, against prose)."
- Metric: "Correct use of the result, 30 runs per arm."
- Falsified if: "Arms agree within noise on all 15 blocks."

## Agent
- The Acme Telecom sales agent live on `claude-haiku-5-5`, through the repo's `anthropicAdapter` (`packages/adapters/src/anthropic`), system prompt and tools in `research/block-redesign/given/agent/acme-live.ts`. Five Acme tools over a fresh store per session; `world.tools` forced results are applied by the adapter.
- Request settings: `max_tokens` 4096, at most 6 model calls per block, model defaults otherwise (adaptive thinking, effort medium, default sampling).
- Deviation from the protocol, stated before data: the protocol asks temperature 0 where the hypothesis allows. The API rejects a non-default `temperature` on `claude-haiku-5-5` (400; claude-api skill model table, cached 2026-10-06), and the adapter sends none. Runs use the default sampling. No seed exists for this API; each call's request id is logged.

## Blocks and arms (`H6/blocks.ts`, frozen at the PREREG commit)
- 15 blocks, 3 per Acme tool (coverage.check, catalog.search, port.check, order.create, notify_sales). Each block: a customer message, one tool call with a fictional result absent from the Acme store, then a final customer question whose answer needs one value of that result.
- Arm `record`: the earlier assistant turn holds the call and its result as a recorded tool call (paired `tool_use` / `tool_result` on the wire), then the text "I have the result."
- Arm `prose`: the earlier assistant turn holds no tool call; its text is "I have the result." followed by the same result written by one fixed template (`prose()` in blocks.ts).
- Both arms: the same customer messages, the same tools offered, and `world.tools` forcing the tool to return the same result if the agent calls it again.

## Metric
- Primary, per run: pass when the final reply text matches every `required` pattern and no `forbidden` pattern (case-insensitive regex in blocks.ts). This is "correct use of the result". A run whose agent calls the tool again and then answers correctly passes.
- Secondary, per run (pre-registered, reported, not used for the verdict): `recall` = the agent called the same tool label again in the final block.
- A run that ends in an error after the adapter's retries is excluded and counted.

## Sample, order, statistics
- 15 blocks x 2 arms x 30 runs = 900 runs. Order: one list of the 900 (block, arm, repetition) tuples shuffled by mulberry32 seed 6, run 8 at a time.
- Per block: Fisher exact two-sided test on pass counts, record against prose; Holm correction across the 15 blocks; alpha 0.05. "Agree within noise" for a block means Holm-adjusted p of at least 0.05.
- Pooled effect (reported, not the verdict): mean over blocks of (pass rate record minus pass rate prose), with a block-cluster bootstrap 95% interval (10,000 resamples, seed 6). Same for the secondary metric.
- Minimum detectable effect, computed before data (scipy `fisher_exact`, 30 against 30 runs): unadjusted alpha 0.05 needs about 1.00 against 0.80 (p 0.024); a single block passing Holm at the strictest step (0.05/15 = 0.0033) needs about 1.00 against 0.70 (p 0.0019) or 0.97 against 0.63 (p 0.0025). A block with a smaller true gap reads as noise.

## Tiny sample, budget, stop rule
- Pilot first: blocks `cov-750` and `order-id`, both arms, 1 run each (4 runs). Record measured USD per run in LEDGER.md, project the 900, then launch. Pilot runs are not in the analysis.
- Lane cap 30 USD, shared with H8 and the M4.2 wire checks; stop at 27 USD cumulative. Projected cost of H6 before the pilot: under 1 USD (Haiku 5.5 at 0.10 / 0.50 USD per million tokens).
- Stop rule: the run stops at 900 attempts or at the lane stop line. No re-run for a better number; a re-run only after a crash or outage, with both results kept.

## Verdict rule
- FALSIFIED if no block has a Holm-adjusted p below 0.05.
- SUPPORTED if at least one block has a Holm-adjusted p below 0.05.
- INCONCLUSIVE if more than 3 runs of either arm of more than 2 blocks are lost to errors, or the run stops at the budget line before 900.

## M4.2 instrument checks (paid, before H6, a few cents)
Tool-history compiler `m42/compile.ts`: neutral form to Anthropic `tool_use`/`tool_result`, OpenAI Responses `function_call`/`function_call_output`, OpenAI Chat Completions `tool_calls`/`role: tool`, and back. Offline: round trip is the identity (93 of 93 histories x wires at the PREREG commit) and the Anthropic rendering equals the adapter's `toAnthropicMessages` on all 30 H6 histories.
Wire checks, one call each:
1. Anthropic (`claude-haiku-5-5`): the 15 record-arm histories plus a final user "Reply OK" get no 400.
2. Anthropic: one record history with its `tool_result` removed gets a 400 whose message contains "tool_use ids were found without tool_result blocks immediately after".
3. Anthropic: a two-turn history where both turns use tool id `call-1` (the ids the Acme agent records per turn). Observed outcome decides the H9 clean-flag reading: 400 means the duplicate id is a real hidden Given error for replay through the anthropic adapter; 200 means the uniqueness rule is over-strict for this wire.
4. OpenAI (`gpt-6-luna`, the newest small model the models endpoint lists on 2026-10-14), Responses and Chat Completions: the 15 record-arm histories get no 400; the unpaired one gets an error; the duplicate-id one is observed.

## Amendment 1 (2026-10-15, after the 4-run pilot, before any of the 900 analysed runs)
- Change: the primary metric becomes **judged correct use**: the regex pass of blocks.ts AND a judge verdict YES that the reply gives the customer the result value as a true, current fact. Judge: OpenAI `gpt-6-luna` (a different family from the agent), Responses API, reasoning effort none, `max_output_tokens` 16, prompt and expected values frozen in `H6/judge.ts` at this commit. A judge answer that is neither YES nor NO counts as missing and is reported.
- The original regex-only pass stays as a pre-registered secondary metric and is reported in full, with the same tests.
- Reason: the pilot run `order-id`, arm prose, matched the regex while it disowned the value: "I can't give you an order number. My earlier message was wrong. I don't have a tool result that shows an order was placed, so ORD-7Q4KX2 is not a confirmed order. Please disregard it." A regex cannot tell giving a value from disowning it, and that difference is the behaviour H6 is about. The judge gave YES, YES, YES, NO on the 4 pilot replies, matching a reading of each.
- Judge check: after the run, 40 replies drawn by mulberry32 seed 66 (20 per arm) are read by hand with the arm hidden; agreement with the judge is reported. If agreement is below 36 of 40, the verdict is reported on both metrics and marked INCONCLUSIVE on the primary.
- Pilot cost: 4 agent runs, 0.0015 USD, 0.00037 USD per run; projected 900 runs about 0.33 USD, judge about 0.05 USD.
