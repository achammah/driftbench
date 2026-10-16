# H4 results: the gate keeps invalid realisations at or below 2%

**Verdict: FALSIFIED, by the pre-registered union rule.** The gate caught 20 of 20 planted bad realisations. The audit found 9 invalid items in 50 (18%, Wilson 95% interval 9.8% to 30.8%) when an item counts as invalid if either labeller says so. The threshold was 1 of 50.

**This was not a human audit.** The two labels came from me (Claude Opus 5.5, the lane agent, labelling blind before the second labeller ran) and from `gpt-6.1-sol` at reasoning effort high.

## Planted items: 20 of 20 caught
| Type | Caught | Stages that rejected |
|---|---|---|
| Swapped digit (5) | 5 | slot_presence and slot_exclusivity on all 5; equivalence_judge on all 5 |
| Flipped negation (5) | 5 | negation_parity on all 5; equivalence_judge on all 5 |
| Second id (5) | 5 | slot_exclusivity on all 5; equivalence_judge on all 5 |
| Missing item (5) | 5 | slot_presence on all 5; equivalence_judge on all 5 |

Every planted item was rejected by at least one deterministic stage and, independently, by the equivalence judge. Data: `planted-results.json`.

## Audit: 50 accepted realisations
| Label source | Invalid |
|---|---|
| Me, blind | 0 of 50 |
| `gpt-6.1-sol` | 9 of 50 |
| Union (the registered rule) | 9 of 50 |

Agreement between the two: 41 of 50 (82%). What the 9 are:
- **8 items: the address without the town.** "3 orchard way", "88 summit avenue", "14 harbor road", "7 quarry lane". This is the class's own `variant_b` surface form (`src/blocks.ts`); the normalised oracle and the Acme coverage tool both treat it as the same address. The second labeller read "drops Acmeville" as dropping part of the slot. I read it as a formatting difference. The registered rubric lists case, spacing, punctuation, country code and abbreviation as formatting, and does not list the town. The disagreement is about the class definition, not about leakage through the gate.
- **1 item, number 33** (B5, the first message of the conversation): "Please arrange Fiber 1000 at 14 Harbor Rd, Acmeville for the order I mentioned". It refers to an order nobody mentioned. I marked it valid with a note ("slightly implausible as a first message"). The second labeller marked it invalid under rubric (c). I now agree it fails (c): this is a real false accept.

Reading of the result. The registered verdict stands: FALSIFIED. Two readings are reported beside it, outside the verdict:
- If the class definition allows the town to be omitted (as the oracle does), the audited false-accept count is 1 of 50 (2.0%), at the threshold.
- If it does not, `variant_b` for addresses is an invalid surface form by construction. Every address block then holds invalid realisations by design, about one third of its rows. That is a class-file defect, not a gate defect: the gate accepted exactly what the class told it to accept.

The finding for M1.1: an LLM equivalence judge, given the class's own surface forms, accepts what the class lists. So the class file's surface forms need the same audit as the realisations. A 50-item audit with a second labeller found the problem; my own reading did not.

## Gate behaviour (descriptive)
- 300 planned rows, 777 candidates, 259 accepted (86%). Rows dropped per block: 0 to 8 (B9 kept 22, B10 23).
- First rejecting stage over all 518 rejected candidates: axis_conformance 415, near_duplicate 76, equivalence_judge 25, slot_presence 2.
- Post-gate coverage of the accepted rows: 2-way 0.970 to 1.000, 3-way 0.688 to 0.884 per block. The planned arrays had 2-way 1.000.
- Surface diversity: Vendi score with a character 1- to 4-gram kernel, 2.9 to 5.8 per block, 0.10 to 0.24 of the set size. All blocks fall below the `min_vendi_ratio: 0.5` of the class schema. With a character kernel, strings that share the same slot values score as similar, so this threshold needs recalibration before it can gate anything.
- Generation and gate cost for these 300 rows: 0.252 USD (batch `gen-h1` in `../LEDGER.md`). The `usd` figure printed in `../data/h1/gen.log` (0.633) is wrong: it is the growth of the shared usage log while the H2 generations ran at the same time.

## Deviations
- Amendment 1 (before scaled data): the gate fixes after three tiny samples. See `PREREG.md`.
- The second labeller's first run died during a 7-hour network outage after 46 calls, before it wrote any label (labels were written at the end). It was made resumable and re-run once on all 50 items. The 46 lost calls are in the ledger. No label was seen twice.
- Strength-3 arrays (H2) came out at 43 to 47 rows per block, not 46; this does not affect H4.

Data: `results.json` (verdict, counts, the 9 items with both labels), `audit-items.json`, `audit-mine.json`, `audit-model.json`, `planted-results.json`, `../data/h1/candidates.jsonl` (every candidate with its stages), `../data/h1/realisations.json` (sha256 8feae26b...).
