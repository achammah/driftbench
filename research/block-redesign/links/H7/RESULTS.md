# H7 results: section-level selection is safe and smaller than the whole suite

**Verdict: SUPPORTED by the registered rule, but fragile.** On the 90 registered single-section mutants, 3 (3.3%) had a safety violation and the mean selection ratio was 0.199. Both pass the section 5 thresholds (5%, 0.8). The 95% Wilson interval on the violation share is 1.1% to 9.3%, and it crosses 5%. Two pre-registered sensitivity readings exceed 5%. On all 110 mutants, the 20 two-section mutants included, the rule gives FALSIFIED (8.2%). The registered 90 decide, as amendment 1 says, but both readings are reported here.

Pre-registration: PREREG.md at commit a89c42f48. Amendment 1 (pair mutants, one check fix) is at e13d306b5. The frozen mutants are at 3db52eb52. All three were pushed before the first mutant run.

## What ran

- Agent: the live Acme stand-in (30-section prompt, sha256 cd17d54f...) on `claude-haiku-5-5`, effort low. The same agent is published for the other lanes on research/block-shared (be8bb2f8f).
- Suite: 19 conversations and 37 blocks, each conversation a parent chain. Checks are deterministic. Every block has declared links.
- Runs: 6 baseline runs and 170 variants × 3 full suite runs (9,690 conversation runs). There were also 399 confirmation runs, for 133 (mutant, conversation) pairs.
- Cost: 5.29 USD total in the lane (LEDGER.md), under the 40 USD cap.
- Outage: a 7-hour network outage stopped the first pass at 120 complete variants. Only the missing (variant, rep, conversation) jobs were run afterwards. No completed run was repeated. The ledger records this.

## Null model

- The baseline is very stable. Only `p1` fails in the baseline: in 6 of 6 runs, the agent confirms the port and asks for a plan without listing the plans.
- The null flip rate p0 is pooled over 186 runs per block (baseline plus 60 controls × 3). It is 0 for 30 of 37 blocks.
- Two blocks are flaky (p0 > 0.2): `af1` (0.247) and `d1` (0.21). As registered, they are excluded from E and T.
- Controls: none of the 60 control variants has a confirmed E. Seven have a stage-1 candidate, and none of these held in the confirmation runs. Of the seven, 5 are `p1` flipping to pass, 1 is `cb1` and 1 is `of2`.

## Registered metrics (90 single-section mutants)

| Metric | Value |
|---|---|
| Mutants with a non-empty E | 25 of 90 (drop 7/30, negate 17/30, rephrase 1/30) |
| Mutants with SV > 0 | 3 (3.3%); Wilson 95% 1.1% to 9.3%; section cluster bootstrap 0% to 7.8% |
| Mean selection ratio | 0.199 (cluster bootstrap 0.094 to 0.322); local sections only: 0.076 |
| Mean precision violation | 0.78 |
| Stage-1 E only (sensitivity) | SV > 0 on 6.7% |
| Flaky blocks kept (sensitivity) | SV > 0 on 13.3%, mean SR 0.198 |

- The 12 global-section mutants select the whole suite. They are the main reason the mean ratio is not near 0.08.
- The precision violation is high (0.78) because most linked blocks do not flip. A declared link says a block is related to a section. It does not say the block is sensitive to every edit of that section.

## The safety violations are missing links of two kinds

| Mutant | E outside T | What was missing |
|---|---|---|
| `explicit_confirm__negate` | h3, ly2, of1, p2, pl2, u3 | Recap blocks: without the CONFIRM rule, the agent orders at the recap. These blocks link `recap`, not `explicit_confirm`. |
| `home_plans_at_address__negate` | h3, h4 | Children of the failing `h1` in the same chain: inherited failures. |
| `mobile_new_line__negate` | p3, pl3 | Children in the porting chains: inherited failures. |
| 6 pair mutants (FALSIFIED reading) | h2, h3, h4, p3, pl3 | The same inherited-children pattern. |

- Exploratory, not registered: adding forward closure (every later block of a selected block's conversation) lowers the violation share to 2.2% on the 90 and 3.6% on the 110. Mean SR rises to 0.23. Driftbench's radius already closes F mode forward, so the deployed rule would include this.

## Mutation score and untested sections

- 25 of 90 single-section mutants were killed. Rephrase mutants almost never move behaviour (1 of 30).
- 12 of 26 local sections had no killing mutant. These sections are tested by no block in a way that a drop or a negation changes: scope, needs_question, upgrade_identify, upgrade_more_data, upgrade_order, home_address_first, home_address_unknown, home_access_wording, porting_check_first, porting_ineligible, new_customer_details, no_discounts.
- A survivor can be an equivalent mutant or a coverage gap. No person judged equivalence here.

## Limits

- One agent, one suite of 37 blocks, and only declared links written by one author.
- Global sections are 4 of 30. Their share drives the mean ratio.
- Kills come mostly from negation. Rephrasing rarely changes behaviour, so a selection rule is mostly tested against strong edits.
- The confirmation runs keep false E entries rare. They can also hide a real effect that shows in fewer than 2 of 3 runs.

Raw data: `../data/runs/*.jsonl` (every tool call and reply). `../results.json` holds per-block verdicts for every run. `results.json` holds the per-mutant E, T, SV, PV and SR. Analysis code: `../analysis_h7.py`, `../select_rts.py`, `../exploratory.py`.
