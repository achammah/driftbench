# H8 pre-registration: context size and fact position change the pass rate

Lane: given. Branch `research/block-given`. Written 2026-10-15, before any H8 paid call (filler generation included).
Protocol: `scratchpad/codex/block-experiments/PROTOCOL.md`. Source: section 5 of `reports/Driftbench block redesign deep.md` (row H8), mechanism M4.3 in section 2.4, `deep_4_initial_conditions.md` section (e) M3.

## Hypothesis (verbatim, section 5)
- Claim: "Context size and fact position change pass rate."
- Experiment: "Sizes 1K, 4K, 16K, 64K × depths 0, 0.25, 0.5, 0.75, 1, with a length-matched no-fact control; 30 runs per cell."
- Metric: "Pass rate relative to 1K; control at closed-book level."
- Falsified if: "All cells within run noise."
- Cost note: "Paid, about 600 runs per block; price the 64K cells first."

## Change to the grid, written before data
- The 1K size is replaced by 2K. Reason: the Acme agent's system prompt and five tool definitions alone measure 1,172 input tokens on `claude-haiku-5-5` (`messages.count_tokens`, 2026-10-15, `H8/count-base.ts`), so a 1K whole input cannot hold a conversation. Sizes are 2K, 4K, 16K, 64K of whole input (system, tools, history, final message). "Relative to 1K" becomes relative to 2K.
- No trim for cost: the full grid is priced below the cap (see Budget).

## Agent
- The Acme live agent of `agent/acme-live.ts` on `claude-haiku-5-5`, through the repo's `anthropicAdapter`, same settings as H6 (max_tokens 4096, model defaults; the API rejects non-default temperature on this model, so default sampling, no seed; request ids logged).

## Blocks (5, frozen in `H8/blocks.ts` at this commit)
Each block: one customer turn states a fact (with a one-line assistant acknowledgement); filler turns surround it; the final customer message needs the fact. All values are fictional.
1. `account`: "Before anything else, my account number is AC-58213." Final: "What account number did I give you earlier?" Pass: reply contains `AC-58213`.
2. `address`: "My address is 46 Wren Gardens, Acmeville." Final: "Can you check if fiber is available at my address?" Pass: a `coverage.check` call whose `address` input contains "46 Wren Gardens" (case-insensitive). `world.tools` forces a coverage result.
3. `phone`: "If you need to call me, use +1 202 555 0134." Final: "Which phone number did I say you should call me on?" Pass: reply matches `555.?0134`.
4. `budget`: "I don't want to pay more than 23 dollars a month." Final: "What monthly budget did I mention?" Pass: reply matches `\b23\b`.
5. `carrier`: "My current carrier is Bluefin Mobile." Final: "Which carrier did I say I'm with now?" Pass: reply contains `Bluefin`.

## Builder (M4.3, `H8/context.ts`)
- Filler: neutral customer and assistant turns from a bank generated once by OpenAI `gpt-6-luna` (a different family from the agent): general telecom small talk with no digits, no names, no addresses, no prices, no carriers, no dates. Filter before use (NoLiMa section 3.1): drop any pair with a digit, `@`, a street word (street, road, lane, avenue, way, court, drive, gardens), the words account, budget, address, phone number, carrier, or any of the 5 fact values. `filler_clean` check: every built context is scanned for the 5 fact values and the patterns `AC-\d`, `555`, `\$?\d+ ?(dollars|USD)`; a hit voids the context.
- Size: filler pairs are added until the estimated whole input reaches the target, by a characters-per-token ratio calibrated with `count_tokens` on the bank. Check `context_size`: the first model call's `usage.input_tokens` of every run is within 5% of the target. A cell whose median is outside 5% is reported as off-target and still analysed.
- Position: the fact pair is inserted after `round(d x N)` of the N filler pairs. Check `context_position`: the fact's character offset in the history before the final message, over that history's length, is within 0.02 of d (reported per cell; pairs are discrete, so the 2K cells may miss it and are reported as such).
- Control (`length_matched_without_fact`): the same filler at the same size, with the fact pair replaced by one more filler pair.
- Runs vary the filler order by seed = repetition index (0 to 29), the same seeds in every cell, so cells are paired by seed (the RULER and NoLiMa way: a new haystack per sample).

## Sample, order, statistics
- Per block: 4 sizes x (5 depths + 1 control) x 30 runs = 720; 5 blocks = 3,600 runs. Order: all runs shuffled by mulberry32 seed 8; 6 at a time.
- Tests per block (Holm across all 95 tests of the 5 blocks, alpha 0.05):
  - size, 15 per block: each of 4K, 16K, 64K against 2K at the same depth, Fisher exact two-sided;
  - position, 4 per block: within each size, the 5 depths compared by a permutation test of the chi-square statistic (10,000 shuffles, seed 8).
- Reported: every cell's pass rate with a Wilson 95% interval; every cell's rate relative to 2K at the same depth; pooled per cell over blocks with a block-cluster bootstrap interval (10,000, seed 8); measured size and depth per cell.
- Control check (M4.3 sanity): a control cell is "at closed-book level" when it passes 3 of 30 runs or fewer. Reported per cell.

## Tiny sample, budget, stop rule
- Price the 64K cells first: one run per block at 64K, depth 0.5 (5 runs), plus one 2K run per block (5 runs). Record USD per run by size in LEDGER.md and re-project the 3,600 before launch. Pilot runs are not analysed.
- Projection before the pilot: about 77 million input tokens at 0.10 USD per million (every whole input stays under the 100K price threshold), about 8 to 10 USD with output and tool follow-up calls. Lane stop line 27 USD cumulative (cap 30, shared with H6 and M4.2). If the pilot projects H8 above the room left under the stop line, the grid is trimmed before launch in this order and the trim is written here first: blocks 5 to 3, then depths 0.25 and 0.75.
- Stop rule: the run stops at 3,600 attempts or at the stop line, whichever comes first. No re-run for a better number.

## Verdict rule
- FALSIFIED if none of the 95 tests has a Holm-adjusted p below 0.05 (all cells within run noise).
- SUPPORTED if at least one does.
- INCONCLUSIVE if the stop line ends the run before the grid is complete, or more than 5% of runs are lost to errors, or more than 3 of the 20 control cells are above closed-book level (the instrument then does not show fact use).
