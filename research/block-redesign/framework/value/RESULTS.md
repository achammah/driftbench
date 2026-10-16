# HF5 to HF9 results: value check, blame and diagnosis (lane fw-value)

Pre-registration: `PREREG.md`, commit `ef9d9302d`, pushed before any paid call. Spend: 3.80 USD of 12 (`LEDGER.md`). Raw per-item data: `results.json`, `data/`.

| # | Verdict | Headline |
|---|---|---|
| HF5 | **FALSIFIED** (by the registered rule) | Ladder 0 false passes and 0 false fails. Normaliser also 0 false passes on the reference set, so "below the normaliser" fails. The 10 runs that separate them (B8 `Ln`) are exactly the 10 runs where the labellers disagree. |
| HF6 | **SUPPORTED** | Rung 1 settles 59 of 116 flips (50.9%): 49 pass, 10 fail, 0 disagreements. The 10 fails are the same 10 split runs, so they have no reference. |
| HF7 | **SUPPORTED** | Read-first false acceptance: 1 of 432 (0.23%) on gpt-6-luna, 0 of 432 on gemini-3.6-flash. Side by side: 7 of 432 and 0 of 432. True positives accepted: 99.4% and 100%. |
| HF8 | **SUPPORTED** | Hand evidence: agent 45, tool definition 28, prompt 3, pass 106, exactly. Automatic evidence: 182 of 182 runs agree. |
| HF9 | **SUPPORTED** on the registered measures, with a caveat on (b) | (a) R3 failures 86 of 249 to 0 of 249. (b) R6 failures 20 to 0, but the agent still makes no call in 17 of the 20 cases; it just stops saying "town". Controls: no change beyond rerun noise. |

## HF5: the ladder against exact match and the normaliser

The reference labels:
- Two labellers labelled all 259 runs: `gpt-6.1-sol` and `gemini-3.6-flash`.
- They agree on 249 (96.1%). Scott's pi is 0.903 on pass or fail and 0.709 on the four labels.
- The reference set R has 249 runs: 183 pass, 66 fail.
- All 10 disagreements are B8 runs where the agent sent `7 Quarry Ln, Acmeville` and `coverage_check` returned `found: false`.
  - Sol labels all 10 `real_error`.
  - Gemini labels 8 `undeclared_requirement` and 2 `format_only`. Both labels contradict its instructions, which call a value the tool does not find a real error.

False passes (FP) and false fails (FF) on R:

| Oracle | Passes (of 259) | FP | FF |
|---|---|---|---|
| E, exact | 77 | 0 | 106 |
| N, normaliser (H3 = PR 434) | 193 | 0 | 0 |
| N, town-less forms unapproved | 182 | 0 | 11 |
| L, ladder | 183 | 0 | 0 |

The 182 exact failures give the same counts, since every false fail and every disputed run is among them.

The ladder's steps over the 255 slot values:
- 57 identical to the gold;
- rung 1 113 pass and 28 fail;
- rung 3 57 pass: the B2 and B7 phones, all 6 judge votes unanimous, 0 inconclusive.

Verdict by the registered rule:
- FP(L) = 0 is at most 2, and FF(L) = 0 is below FF(E) = 106.
- But FP(L) = 0 is not below FP(N) = 0, so the claim fails.
- The prediction FP(N) >= 10 did not hold on R.

What decides it is the treatment of the 10 split runs. The registered sensitivity analysis:
- Split runs counted as fail (Sol's label, which is the owner's rule R3): FP(N) = 10 and FP(L) = 0. Every HF5 condition would hold.
- Split runs counted as pass (Gemini's label): FP(N) = 0 and FF(L) = 10. The ladder would be worse than the normaliser.

So the data do not separate the ladder from the normaliser. They separate the two labellers, on the one case class the ladder was built for. One labeller treats "the tool did not find the address" as a formatting difference. The ladder and the owner's rule do not.

## HF6: rung 1 settles the format flips

- Flips (exact fail, normaliser pass): 116. Rung 1 settles 59 of them (50.9%).
- Settled as pass (49): B1 3, B3 5, B4 16, B8 8, B10 17.
- Settled as fail (10): the B8 `Ln` runs.
- The 57 B2 and B7 phones are not settled: `notify_sales` only stores the value, so they go to rung 3.
- Disagreements with the reference: 0 among the 49 settled runs that have a reference. The 10 settled fails have no reference (the split runs).
- Sensitivity: if Gemini's pass label on those 10 were taken as the reference, they would be 10 disagreements. Taking Sol's label, there are 0.
- Prediction (59 settled, 49 pass, 10 fail): exact.

## HF7: read-first judge against side by side

The setup:
- 128 items: 56 positives and 72 near misses.
- Each item runs in 2 orders × 3 repeats, so each model and design gives 768 judgments. There are 0 missing.
- Intervals: item-clustered bootstrap, 95%.

| Model | Design | TPR | FAR | FAR 95% CI | Order flips | Repeat flips | Scott's pi vs truth |
|---|---|---|---|---|---|---|---|
| gpt-6-luna | side by side | 336/336 = 1.000 | 7/432 = 0.016 | 0.002 to 0.035 | 1.8% | 1.2% | 0.982 |
| gpt-6-luna | read first | 334/336 = 0.994 | 1/432 = 0.002 | 0.000 to 0.007 | 0.8% | 1.2% | 0.992 |
| gemini-3.6-flash | side by side | 1.000 | 0/432 | 0 to 0 | 0 | 0 | 1.000 |
| gemini-3.6-flash | read first | 1.000 | 0/432 | 0 to 0 | 0 | 0 | 1.000 |

- Luna side by side accepted:
  - two swapped digits 6 times (items I019, I026, I054), for example `202-555-1018` accepted as `+12025550118`;
  - one changed letter in an email once (I058, `SAM.RIVERS@EXAMPLE.COM`).
- Read first accepted one swapped-digit item once (I019). It rejected 2 positive judgments (I003, I017).
- Contentless values: 0 of 108 accepted in every cell.
- Read first needed its second, comparison call in 64% (luna) and 67% (gemini) of judgments. The readings rarely match string for string, so code alone settles a minority.
- All three conditions hold for both models.
- Caveat: Gemini 3.6 Flash is perfect in both designs, so on the stronger model the item set does not tell the designs apart. The difference shows only on the small model: 7 against 1 false acceptances.

## HF8: blame rules as data

- Part 1: the rules in `src/blame_rules.yaml`, applied to the hand table read through a fixed mapping, give agent 45, tool definition 28, prompt 3, pass with test flagged 106. That is exact. Rule ids equal the hand class on 182 of 182 rows.
- Part 2: the evidence is computed automatically.
  - Source and change come from the agent's value against the customer's text.
  - Contract comes from the schema plus declared formats: none in Acme.
  - Outcome comes from rung 1 replay, or `stored` for `notify_sales`.
  - steps_skipped comes from the exact verdicts off the slot fields.
  - next_action and asked_for come from a `gpt-6-luna` reply classifier.
- Result: agreement is 182 of 182 (R3 28, R5 106, R6 3, R7 45).
- Limits worth knowing:
  - The hand table was itself built with a script plus a hand check. The automatic path shares one declared input with it: the prompt asks for the town and the tool does not need it (prompt line 41).
  - The classifier called 27 replies `wrong_fact` (B10 16, B4 8, B3 3). None of them sits in a rule that reads next_action, since their outcome is accepted. The rules are therefore not tested on R3b (agent gives up or states a wrong fact after a miss): H3 has 0 such runs.

## HF9: the diagnosis is causal

Fresh runs of the live agent (`claude-haiku-5-5`): 1,701 runs, 0 transport errors.

(a) The R3 failures: a `coverage_check` miss on a run that fails. 3 runs per realisation.

| Arm | R3 failures | B1 | B5 | B8 | All exact failures |
|---|---|---|---|---|---|
| base1 | 86 / 249 | 30 | 26 | 30 | 128 |
| desc ("Give the street type in full, for example Road, not Rd.") | 0 / 249 | 0 | 0 | 0 | 29 |
| resolve (the tool expands Rd, Ln, Ave and others; secondary) | 0 / 249 | 0 | 0 | 0 | 125 |

- With the description fix, the agent expands every abbreviation it is given: no `Ave`, `Rd` or `Ln` reaches the tool.
- What remains under desc:
  - 24 B8 runs that send `7 Quarry Lane` without the town, against B8's whole-string assertion;
  - 5 B5 runs with no call.
- Under resolve, the tool finds the address, but the exact assertions still fail on the abbreviated string (125). Fixing the tool removes the R3 cause, not the exact-match failure. That is the HF5 point seen from the other side.
- Removal: 100% for both fixes.

(b) The R6 failures, on the town-less realisations of B5 and B6, 6 runs each:
- On the registered measure (a failing run with no `coverage_check` call whose reply contains "town"): base1 20 of 102, prompt fix 0 of 102. Removal 100%.
- But the run without a call does not go away: 20 runs make no call under base1, 17 under the prompt fix. Removal 15%.
  - Under the fix, the agent no longer says "town".
  - Instead it asks the customer to "confirm the full street address, including the street number and name", which the customer had already given, or for a "city or postcode".
- So removing the town demand removes the wording, not the behaviour. The registered measure tests the wording and passes. A measure of the behaviour would fail. The R6 diagnosis names the right line but not the whole cause.

Controls (B2, B3, B4, B7, B9 and B10; 150 runs per arm):
- Under the exact oracle, base1 and base2 differ on 1 of 150 runs (f = 0.67%).
- Fail rate is 90.7% in base1, desc, resolve and prompt (worsening 0 for each) and 90.0% in base2.
- The exact oracle is near its ceiling on these blocks (phone and email formats fail it), so a secondary scoring with the ladder (outside the verdict) is reported:
  - fail rate base1 28.7%, base2 29.3% (f = 2.0%), desc 27.3%, resolve 28.7%, prompt 28.0%;
  - every arm is at or below base1.

Verdict: (a) 100% is at least 80%. (b) 100% on the registered measure is at least 80%. The control worsening is 0 for both desc and prompt, within f. **SUPPORTED**, with the (b) caveat above.

## Deviations and notes

- No deviation from PREREG in design, models, seeds or thresholds.
- One Gemini label answered invalid JSON 3 times. It was logged in `data/labels-gemini-3.6-flash.errors.jsonl` and run again under the resumable rule. Its retry counts in the 259.
- A first launch of the HF9 runner failed on a shell quoting error before any call (0 runs, 0 USD).
- Two secondary analyses were added after the data, both outside every verdict: HF9 controls scored with the ladder, and the HF9 (b) "no call, any wording" count. Both are labelled as secondary in `results.json`. `src/hf9_secondary.py` computes both from the stored HF9 runs and the judge cache, and `python analyse.py all` writes them into `results.json`. Its output equals the committed `HF9/secondary_*` values and `data/hf9_controls_ladder.json`.
- The HF7 near-miss phones were moved into the fictional range after the data were taken. The bank had eight "two digits swapped" phone candidates whose line number (for example `0131` swapped to `1031`) fell outside 0100 to 0199, which the leak guard reads as real numbers. They now swap the last two digits of the line (`0131` to `0113`), or change both when those digits are equal (`0188` to `0112`). The change is a one-to-one renaming of eight numbers. `src/hf7_items.py` makes the new bank (only those eight candidates differ, with the same seed); the same renaming is applied to `data/hf7_judgments.jsonl` (96 places) and `data/judge_cache.jsonl` (297 places in 240 rows, with each cache key recomputed from its renamed inputs). The recorded model answers are the ones given to the original numbers; the models did not see the new ones. Every item keeps its truth label, subtype and item id, so `analyse.py` gives a `results.json` equal as data to the committed one, and every judge lookup of the new bank is a cache hit (768 per model, no model call).
- The three data files are plain text again.
- Tiny-sample answers stay in the data (no code or prompt changed after them), as PREREG states.

## Reproduce

```sh
cd research/block-redesign/framework/value/src
python oracle.py               # exact oracle port: 0 mismatches on 259 runs
python label.py gpt-6.1-sol ; python label.py gemini-3.6-flash
python blame.py classify ; python hf7.py run gpt-6-luna ; python hf7.py run gemini-3.6-flash
python hf9.py run <arm> <set>  # arms base1 base2 desc resolve prompt; sets target_a target_b controls
python analyse.py all ; python ledger.py    # all makes no model call: a judge cache miss stops it
python hf9_secondary.py        # the two secondary HF9 analyses alone
```
Python 3.12 with `anthropic` 1.14.0, `openai` 3.31.0 and `pyyaml`. Keys are read from `~/.nexus-secrets` inside the process.
