# H11 pre-registration: simulated verdicts flip across simulator families

Written 2026-10-14 before any paid call for H11. The commit sha that first adds this file is the
pre-registration. Any later change is appended under "Amendments" with its reason, before the data it
affects.

## Hypothesis (section 5, verbatim)

| # | Claim | Experiment | Metric | Falsified if | Cost |
|---|---|---|---|---|---|
| H11 | Simulated verdicts flip across simulator families. | 20 simulated blocks, 2 simulator families, 4 trials each. | pass^4 per family; flip share. | Flip share at or below the within-family re-run flip share. | Paid, about 160 conversations. |

## Design

- **Blocks.** 20 simulated blocks built from ABCD dev-split scenarios. Population: the 8 action flows
  (account_access, manage_account, order_issue, product_defect, purchase_dispute, shipping_issue,
  subscription_inquiry, troubleshoot_site). The two FAQ flows (single_item_query, storewide_query) are
  excluded because ABCD does not release the FAQ answer texts, so no agent can answer them.
  Sampling: `random.Random(11)`, 20 conversations drawn stratified by flow (2 or 3 per flow, the 4 extra
  slots to the 4 largest flows in the dev split). Only the scenario and the human agent's action buttons
  are used; no human utterance enters H11.
- **Block contract.** The simulated user receives the scenario (customer facts and a one-line goal per
  subflow, written in `lib/abcd.py`). The block passes on a trial if the set of action buttons the human
  agent clicked in the real conversation (the gold set) is a subset of the tool names the agent under test
  called. Order and argument values are not checked (secondary report only: values of `pull-up-account`).
- **Agent under test.** `claude-haiku-5-5`, `output_config.effort = "low"`, default sampling (Haiku 5.5
  rejects non-default temperature), system prompt = ABCD guidelines for the 8 flows, tools = the ABCD
  action buttons, tool results simulated from the scenario (`lib/agent.py`). Up to 8 tool rounds per agent
  turn. Prompt caching on the system prompt and tools.
- **Simulator families.** Family O: `gpt-5.4-nano` (OpenAI, newest small model listed by the API on
  2026-10-14). Family G: `gemini-3.5-flash-lite` (Google, newest Flash-Lite on the pricing page read
  2026-10-14). Both differ from the agent's family. Both run the same simulator prompt: the tau-bench user
  rules (user.py lines 61 to 68, quoted in `lib/simulators.py`) plus the scenario. Sampling: OpenAI's
  `gpt-5.4-nano` accepts only its default temperature (1); Gemini is set to temperature 1.0 to match.
  Reasoning effort: the lowest each API accepts (recorded in results.json).
- **Conversation.** A fixed agent greeting "Hi! How can I help you today?", then user and agent alternate.
  Ends on `###STOP###`, `###TRANSFER###` or `###OUT-OF-SCOPE###` from the simulator, or after 20 user turns.
- **Trials.** 8 trials per block per family, run as two batches of 4 (batch A = trials 1 to 4, batch B =
  trials 5 to 8). Total 20 x 2 x 8 = 320 conversations. Section 5 says about 160; the second batch per
  family is what the falsifier needs (the within-family re-run flip share), so the count is doubled.

## Metrics

- Per (block, family, batch): c = passes out of n = 4. Verdict V = pass^4 = C(c,4)/C(4,4), which is 1 if
  c = 4 else 0.
- **Cross-family flip share** X = mean over the four batch pairings (OA,GA), (OA,GB), (OB,GA), (OB,GB) of
  the share of the 20 blocks whose V differs.
- **Within-family re-run flip share** W = mean over families of the share of blocks whose V differs between
  batch A and batch B.
- Reported beside them: pass^4 per family with the unbiased estimator C(c,4)/C(8,4) over all 8 trials,
  averaged over blocks; per-trial pass rate per family; the paired per-block difference in pass rate
  between families; a block-level bootstrap 95% interval (2,000 resamples, seed 1101) for X minus W.
- Secondary verdict (reported, not used in the falsifier): majority verdict (c >= 3 pass, c <= 1 fail,
  c = 2 tie counted as its own value).

## Falsifier (section 5, verbatim)

Falsified if flip share X is at or below the within-family re-run flip share W. Supported if X > W. If the
bootstrap interval of X minus W includes 0, the verdict is SUPPORTED on the point estimate and the result
says the interval includes 0 (it is not a significant difference).

## M2.5 sanity checks (offline, before the paid run)

1. The estimator C(c,k)/C(n,k) equals brute-force enumeration of all k-subsets for every (n <= 8, c, k).
2. A trivially passable stub agent (it calls every button on every turn) with a scripted stub simulator
   gives flip share 0.

## Sample size, seeds, stop rule, budget

- n = 20 blocks, 320 conversations. Seeds: sampling 11; bootstrap 1101. LLM sampling is not seeded by the
  providers; every transcript is stored.
- Tiny sample first: 2 blocks x 2 families x 1 trial end to end, measured USD per conversation written to
  LEDGER.md with the projection, before scaling.
- Lane cap 25 USD (protocol), stop at 22.5 USD cumulative. H11 sub-budget: 8 USD. If the projection
  exceeds 8 USD the trial count stays and the block count drops to the largest even number that fits; the
  change is written here first.
- A conversation that errors (API failure after 3 retries) is re-run once and both attempts are kept; it
  never counts as a fail.

## Amendments

1. 2026-10-14, after the tiny sample, before the full run: the `verify-identity` tool schema came from
   `ontology.json` (customer_name, account_id, order_id, zip_code) while the guidelines ask for three of
   full name, zip code, phone and e-mail. The agent refused a phone number it could not pass. Phone and
   e-mail fields were added to the tool. The 4 pilot conversations are not used as data.
