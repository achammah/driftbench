# H13 pre-registration: isolation runs find undeclared parent dependencies

Lane: parents. Branch `research/block-parents`. Written before any paid call. The commit that holds this file is the pre-registration.
Source: section 5 of `reports/Driftbench block redesign deep.md` (row H13), mechanism M5.3. Parents design: section 2.5.

## Claim, verbatim from section 5

- Claim: isolation runs find undeclared parent dependencies.
- Experiment: replay every child from its bare Given once.
- Metric: share of edges with `manifest: true`; share of children whose verdict changes.
- Falsified if: exactly 0 on generated blocks while a planted undeclared read is caught (the check is blind), or no planted read caught.
- Cost: paid, one run per edge (about 900 on `generated/specs` after collapse).

## Changes from section 5, with reasons (all written before data)

1. The edge count. The trie collapse of `examples/acme/generated/specs` at commit `a7c3280c2` gives 254 edges, not about 900. An edge is a trie block whose set of specs differs from its parent's: the stem ends at the parent and a child segment starts. All 254 are conversation specs (the 67 task specs share no stem). The child segment of an edge is the suffix of its first spec, after the stem: 776 blocks in all. The stems add 585 blocks.
2. One run per edge is not enough to read a live agent. A verdict change between the isolated run and the full replay is also what a re-run alone produces when the agent is not deterministic. So each edge gets: FULL1 (stem replayed live, then the child), ISO (the child alone, bare Given), and for 36% of edges a FULL2 (a repeat of FULL1) that measures the noise.
3. Sample, to fit the lane cap of 15 USD. 94 of 254 edges, stratified by stem length (see below), plus 20 planted children. This lowers the power: the 95% Wilson half-width of a share near 50% is about 10 points at n = 94 (about 6 points at all 254). Strata with stem lengths 5 and 6 are fully observed (4 and 5 edges), so their shares are exact for those strata and tell little on their own. Cost is the reason; the loss is stated in RESULTS.
4. "Undeclared": generated specs declare no parent at all today, so a generated edge cannot be undeclared in a strict sense. The natural-edge share therefore measures dependencies the check finds. Selectivity, the ability to tell a real dependency from none, comes from the planted children.

## Agent under test

- A stand-in written for this lane: the Acme sales assistant on `claude-haiku-5-5`, temperature 0, `max_tokens` 700. Its system prompt is `agent-prompt.md` (the dialogue policy of `examples/acme/src/policy.ts` in prose). Its five tools are the real implementations of `examples/acme/src/tools.ts` over a fresh store for each conversation; tool names use `_` for `.` (`tools.json`).
- Key: `~/.nexus-secrets/anthropic-driftbench.key`, loaded in the command, never printed.
- No judge, no second model. Scoring is code (`live.ts`, `scoreBlock`): a block passes when (a) each expected tool has exactly `count` calls in the turn, and for `count > 0` with an `input`, at least one call has an input that contains the expected keys (a `customer.subset` matches as a subset; strings compare case-insensitively); (b) no tool of `rules.forbidden_tools` is called in the turn; (c) every `must` string matches the reply as a case-insensitive pattern after removing `*` `_`, folding curly quotes and collapsing spaces; (d) no `must_not` string occurs. Stage, `stage_reported`, language, guards, criteria and `one_message_per_turn` are not checked, because the live agent does not report them. This lowers the sensitivity of every verdict equally. It is a stated limit.
- A block's `given.world.tools` override (5 items of the plan; 19 blocks in the whole population) is honoured in its turn.

## Arms and definitions

- FULL1: user turns of the stem, then of the child, in one conversation with the live agent. The agent's own replies are the history (live replay, mode F). Stem blocks are scored but unscored for the metric.
- ISO: the user turns of the child alone, in a fresh conversation (the child's bare Given: no stem messages, no stem tool results, a fresh store).
- FULL2: a second run of FULL1 (same input, same settings).
- Child pass vector: the pass/fail of each child block.
- An edge is eligible when every stem block passes in FULL1. Edges whose stem fails are counted and reported, and left out of the shares (the child then sees a history that diverged from the spec).
- manifest(edge) = the ISO child pass vector differs from the FULL1 child pass vector.
- verdict_change(edge) = (all child blocks pass in ISO) differs from (all child blocks pass in FULL1).
- flake(edge) = the FULL1 child pass vector differs from the FULL2 one (only edges that have a FULL2).

## Sample

- Seed 13; `plan.cjs` writes `plan.json` (committed with this file).
- Natural edges: 94, drawn without replacement per stem-length stratum: stem 1 (89 available): 30; stem 2 (59): 20; stem 3 (60): 20; stem 4 (37): 15; stem 5 (4): 4; stem 6 (5): 5. Executed in an order that interleaves strata proportionally, so a stop keeps the proportions.
- 34 of the natural edges have a FULL2 (each edge has a probability 0.4, drawn by the seed).
- Planted positives (10): the order block of ten real conversation specs from different flows, with all blocks before it as the stem. The order block is a bare "CONFIRM" or "Confirm", and its expected `order.create` input (customer, plan, address or number) is stated nowhere in the child. The child reads the parent. It must show `manifest: true` in ISO: with no history the agent has nothing to order.
- Planted negatives (10): a real prefix of 1 to 3 blocks of a real spec, then one block that reads no state: store hours (3), a billing problem (3), an instruction to change prices (2), a Dutch sentence (2). The expected output is the same text and no tool call, with or without the stem. It must show `manifest: false`, up to the noise.
- All planted items have a FULL2.
- Order: planted items first, then the natural edges.

## Pilot and cost

- The first run is a pilot of 5 items (the first 2 planted positives, the first planted negative, the first 2 natural edges of the order). It measures tokens per turn and USD per turn. The projection for the whole plan goes in `LEDGER.md` before the rest is run.
- Plan size: 1,140 conversation turns (954 natural, 186 planted) over FULL1, ISO and FULL2. Prior estimate, before the pilot: about 5 input and 0.3 output thousand tokens per turn, about 7 USD at 1.00 and 5.00 USD per million tokens.
- Price: the published price of `claude-haiku-5-5` is not known to me yet. Until the lead supplies it, the stop rule uses the stand-in of 1.00 USD per million input tokens and 5.00 per million output tokens, as a pessimistic bound. `LEDGER.md` records the token counts, so the USD can be recomputed at the published price.
- Stop rule: stop at 13.50 USD (90% of the lane cap) computed with the stand-in price, counting every call including retries. Whatever has run by then is the sample; the verdict rules below apply to it as it stands. The cap is never crossed.
- Pilot rule: if the pilot shows a defect of the stand-in itself (a prompt or scorer that fails blocks the real Acme agent would pass, for example a parsing bug), I fix it once, write the diff and the reason in the Deviations section below, and discard the pilot items from the sample (their raw data stays in the file). Disagreement between the live agent and a spec that is the agent's own judgment is not a defect and changes nothing.

## Metrics

1. Planted positives caught = eligible planted positives with manifest true, out of eligible planted positives.
2. Planted negatives flagged = eligible planted negatives with manifest true, out of eligible planted negatives.
3. Natural manifest share = eligible natural edges with manifest true, over eligible natural edges. 95% interval by cluster bootstrap over stem nodes (edges sharing a stem share a cluster; 2,000 resamples), and Wilson for comparison. By stem length.
4. Natural verdict-change share, same interval.
5. Noise: share of FULL2-having edges with flake true. The manifest share is also reported over the confirmed-stable subset (edges with no FULL2 excluded; edges with flake true excluded).
6. Static cross-check (reported, not a verdict): for each natural edge, whether the child's expected tool inputs contain a string value that appears in none of the child's user turns (a read of the parent by construction), against manifest.

## Verdict rule (H13)

- FALSIFIED if the planted positives caught is 0, or the natural manifest count is exactly 0 among eligible natural edges (the check reports nothing on generated blocks).
- INCONCLUSIVE if fewer than 6 planted positives or fewer than 6 planted negatives are eligible, or fewer than 30 natural edges are eligible, or the share of FULL2 edges with flake true is above 25% (the live verdicts are too noisy to read).
- SUPPORTED if planted positives caught is at least 80% of eligible positives, planted negatives flagged is at most 20% of eligible negatives, and the natural manifest count is at least 1.
- Otherwise INCONCLUSIVE.
- A natural manifest share near 100% would be correct for this agent: it rebuilds its state from the conversation, so every edge whose child needs the stem should show `manifest: true`. RESULTS must say this rather than call it a discovery of "undeclared" dependencies.

## Seeds and reruns

- Seed 13 for the plan. Temperature 0 for the agent. No other randomness.
- A run that crashes (network, API outage) is resumed; completed arms are never repeated (the results file is append-only and keyed by item and arm). A re-run for any other reason needs a written reason here and keeps both results.

## Deviations

1. The API refuses the `temperature` parameter for `claude-haiku-5-5` (`400: temperature is deprecated for this model`, seen on the first pilot call, no completion returned, no cost). The runs use the model's default sampling instead of temperature 0. The agent is therefore not deterministic, and the FULL2 repeat is what measures that. Every other part of the design is unchanged. The sentences above that say temperature 0 are superseded by this one.

2. Pilot (5 items: pp-gen-twise-029, pp-gen-metamorphic-018-2, pn-1-hours, n-630-631, n-397-398; 0.237 USD at the stand-in price, 46 turns, measured 4,481 input and 134 output tokens per turn, projecting about 5.9 USD for the 1,140 planned turns). Two defects of the stand-in, found by reading the failed pilot blocks, fixed once as the pilot rule allows:
   - Scorer: a spec input matcher `port_number: {absent: true}` (26 uses in the population) was compared as data. It now means the key is absent.
   - Prompt: the policy states the current plan with its full description ("You are on Acme Mobile S, 10 GB for $15 a month"), and the prompt said only "name the current plan". The prompt now says to describe it like any other plan.
   The pilot arms are kept in `results/pilot-arms.jsonl`, discarded from the sample, and still counted in the ledger. The two defects were the only changes; every pilot block that failed for another reason (none) would have stayed.

3. Plan defect found during the main run, after the 20 planted items had run and 17 natural edges had run (aggregate counts of caught and flagged had been printed once at that point): `plan.json` gives the planted negatives `forbidden` = all five tools, and the scorer applies `forbidden` to stem blocks too. Their stems legitimately call tools (for example `coverage.check`), so 7 of 19 stem blocks of negatives failed and 7 of 10 negatives looked ineligible. The child block of a negative already counts all five tools at 0. The fix is in scoring only: for planted negatives `forbidden` is empty. No model call is repeated or changed. Every score is recomputed from the stored turns by `rescore.ts` into `results/arms-scored.jsonl`, and `analyse.py` reads that file. The scores written during the run (`results/arms.jsonl`) are kept as recorded. The recomputation applies the same rule to all items; for natural and positive items it changes nothing (their `forbidden` comes from their spec).

None other yet. Any deviation is appended with its reason before the data it touches is read.
