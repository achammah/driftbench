# H11 results: simulated verdicts flip across simulator families

**Verdict: FALSIFIED.** Swapping the simulator family flipped fewer block verdicts (15%) than re-running
the same family (20%).

## What ran

- 20 simulated blocks from ABCD dev scenarios (8 action flows), agent `claude-haiku-5-5` (effort low)
  built from ABCD's guidelines, simulators `gpt-5.4-nano` (family O) and `gemini-3.5-flash-lite`
  (family G), same tau-bench user prompt, 8 trials per block per family as two batches of 4.
- 320 conversations, 0 errors, every one ended on `###STOP###`. Cost 2.28 USD (LEDGER row 7).
- Pre-registration: `h11/PREREG.md`, commit bb8bb5281; amendment 1 (a tool-schema fix after the tiny
  sample) before the full run.

## Numbers

| Measure | Value |
|---|---|
| Cross-family flip share X (pass^4 verdict, mean of 4 batch pairings) | 0.150 |
| Within-family re-run flip share W (mean of 2 families) | 0.200 |
| X minus W, block bootstrap 95% (2,000, seed 1101) | -0.050 [-0.125, 0.000] |
| pass^4 per family, C(c,4)/C(8,4), mean over blocks | O 0.489, G 0.432 |
| Per-trial pass rate | O 0.606, G 0.575 |
| Paired pass-rate difference O minus G, bootstrap 95% | +0.031 [-0.038, +0.113] |
| Secondary (not in the falsifier): majority-verdict flips, tie as its own value | X 0.150, W 0.100 |
| Mean user turns per conversation | O 7.2, G 6.1 |

Per block (1 = trial passed, trials 1 to 8):

| Block | Subflow | O | G |
|---|---|---|---|
| 1539 | search_results | 11101111 | 00100100 |
| 2062 | status | 11011111 | 11011111 |
| 2463 | credit_card | 10101101 | 11011110 |
| 2929 | manage_downgrade | 00000000 | 00000000 |
| 3079 | manage | 00010000 | 00000010 |
| 3630 | return_size | 00000000 | 00000000 |
| 5440 | manage_extension | 11111111 | 11111111 |
| 5795 | reset_2fa | 11111111 | 11111111 |
| 6275 | promo_code_invalid | 00000000 | 10000000 |
| 6771 | status_payment_method | 00000000 | 00000000 |
| 6798 | manage_pay_bill | 11111111 | 11111111 |
| 7077 | search_results | 11111101 | 01011111 |
| 7279 | refund_update | 11111111 | 11111111 |
| 7321 | recover_password | 11111111 | 11111111 |
| 7666 | status_shipping_question | 00000000 | 00000000 |
| 7860 | status_shipping_question | 11110110 | 11111111 |
| 8032 | bad_price_yesterday | 11111111 | 11110111 |
| 8115 | manage_cancel | 00000000 | 00000000 |
| 8196 | bad_price_competitor | 11111111 | 11001111 |
| 10341 | reset_2fa | 11111111 | 11111111 |

## Reading

- 13 of 20 blocks are stable: 6 pass all 16 trials, 7 fail at least 15 of 16, under both families.
  Their verdict does not depend on the simulator.
- All flips sit in the 7 flaky blocks (1539, 2062, 2463, 7077, 7860, 8032, 8196). There, one failed
  trial in 4 flips pass^4, so re-runs of the same family flip as often as a family swap. pass^4 on 4
  trials is a noisy verdict for a flaky block.
- One block is family-sensitive by eye: 1539 (search not working) passes 7 of 8 under O and 2 of 8 under
  G. Its flip counts in X, but one block does not move the share above W.
- The majority verdict ranks the other way (X 0.15 against W 0.10). It is secondary and pre-registered as
  such; it shows the result depends on the verdict rule when blocks are flaky.
- Within-family noise W includes the agent's own sampling (Haiku 5.5 rejects temperature 0) as well as
  the simulator's.

## Limits

- Two small simulator models from two families, one agent, one domain, 20 blocks. Lost in Simulation
  reports a 9-point spread across larger user models (Table 1); small models may be more alike.
- The block contract (gold buttons a subset of the agent's tool calls) ignores argument values and order.
- Gold sets come from what one human agent clicked; some gold buttons (FAQ searches in action flows) are
  ones the agent rarely needs, so some blocks fail for every simulator (2929, 3630, 6771, 7666, 8115).

## M2.5 checks (offline, `checks_offline.py`)

- The estimator C(c,k)/C(n,k) equals brute-force enumeration of k-subsets for every n up to 8: true.
- A trivially passable stub agent with a scripted stub simulator gives X = 0 and W = 0: true.

## Consequence for the design

A multi-simulator flip flag (M2.5) is only informative against the same block's re-run noise. A flag
raised by comparing one run per family would mostly report flakiness. The runner should report, per
block, the within-family flip rate beside the cross-family one, and flag a block only when the cross-family
difference exceeds it (block 1539 here).

Raw data: `h11/results.json` (per-block trial outcomes, verdicts, missing buttons by family).
