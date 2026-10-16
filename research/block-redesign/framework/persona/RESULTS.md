# Results: framework persona experiments HF10, HF11, HF12

Pre-registration `PREREG.md`, commit 6fa119a04 (before any paid call); amendment 1 (French polite words
in the realiser, after the tiny sample) in commit 2d61a15b9, before any HF10 or HF11 data. 915
conversations, 0 errors, 7.22 USD of the 10 USD cap (LEDGER.md). Raw data: `results.json`, each
folder's `results.json`, transcripts in `hf10/` and `hf11/`.

| Hypothesis | Verdict | Key numbers |
|---|---|---|
| HF10 persona grid flag | **FALSIFIED** | A/A control flags 1 block (7279); real grid flags 1 block (8196) |
| HF11 prompt-unit routing | **SUPPORTED** (at the edge) | selected cells flip 11 of 22 (0.50), unselected 1 of 22 (0.045, bar 0.05) |
| HF12 ownership refusals | **SUPPORTED** | 30 of 30 planted caught with the right reason, 0 of 30 clean refused |

## HF10: the persona grid finds real persona effects and no fake ones

**Verdict: FALSIFIED.** The falsifier fires on its first branch: the A/A control (terse-regular against a
byte copy under another id) flags 1 block. The real grid also flags 1 block, and that flag is no
stronger than chance.

What ran: the 20 H11 ABCD blocks, `claude-haiku-5-5` agent (effort low), the H10 agenda engine with
`gpt-5.4-nano` as realiser and act classifier, 4 persona ids x 8 trials = 640 conversations.

| Measure | Value |
|---|---|
| Real grid flagged blocks (3 personas) | 1: block 8196 (terse 8/8, chatty 5/8, skeptic 5/8; exact test p 0.18; flagged by x 0.67 > w 0.00) |
| A/A flagged blocks (2 copies of one persona) | 1: block 7279 (terse 8/8, copy 6/8, one failure in each half; exact test p 0.47; flagged by x 1.00 > w 0.00) |
| Flags from the exact test alone (p < 0.05) | real 0, A/A 0 |
| Flags from "spread beats re-run noise" alone | real 1, A/A 1 |
| Permutation test of the real flag count (labels shuffled within block, 2,000) | p 0.77 |
| Null simulation on this run's pooled block rates (10,000) | A/A: P(at least 1 flag) 0.51, 0.68 expected; real: P 0.78, 1.35 expected |
| Column mean pass rate, block bootstrap 95% | terse 0.569 [0.381, 0.738]; chatty 0.562 [0.388, 0.731]; skeptic 0.569 [0.394, 0.725]; copy 0.537 [0.356, 0.706] |
| Paired difference against terse, 95% | chatty -0.006 [-0.113, +0.094]; skeptic 0.000 [-0.069, +0.069]; copy -0.031 [-0.100, +0.031] |

Reading:
- No persona effect on this agent is visible. All three columns pass at the same rate, and the one real
  flag is what the null predicts (the null expects 1.35 false flags in 20 blocks; 1 was raised).
- The flag rule, as written in `simuser_model.md` 4.1, is not safe. Its noise half ("cross-persona flip
  rate above the within-cell flip rate", both from pass^4 verdicts on halves of 4 trials) fires whenever
  one persona fails once in each half and the other never fails. Both flags here came from that half;
  the exact test raised neither. The pre-registration predicted this (null P 0.48 for the A/A from H11
  rates); the run matched it.
- 9 of 20 blocks cannot flag at all: they pass (4 blocks) or fail (5 blocks) all 32 of their trials.
  Persona effects can only show on the other 11, most of them flaky under every persona.
- Consequence for the design: keep the exact test as the flag, or give the noise rule a margin and a
  minimum count, and print the null false-flag expectation beside the grid. With 8 trials per cell the
  exact test needs about 7/8 against 2/8 to fire (p 0.041).

Did the personas come through (user-turn rates, H10 definitions; target in brackets)?

| Persona | Short% | Words per turn | Quest% | Abandoned |
|---|---|---|---|---|
| terse-regular | 30.2 (57.0) | 6.1 (5.5) | 7.8 (5.0) | 28 of 160 |
| chatty-newcomer | 5.8 (10.0) | 14.7 (18) | 24.4 (20.0) | 2 of 160 |
| persistent-skeptic | 22.2 (35.0) | 7.9 (9) | 12.1 (12.0) | 25 of 160 |
| terse-regular-aa | 34.0 (57.0) | 6.0 (5.5) | 6.9 (5.0) | 26 of 160 |

The ordering is right on every rate (terse shortest, chatty longest and most questions) and the engine
config hash matched the persona file in 640 of 640 conversations. Short% lands below target for every
persona: the engine draws a short turn, but a turn that must carry a value (a name, an order id) comes
out longer than 3 words. The personas differ, the agent's pass rate does not.

Limits: one agent, one simulator model, 20 blocks, 8 trials per cell. The note's expertise concepts,
misconceptions, cooperativeness and stable knowledge were not used (ABCD blocks hold the facts).
chatty-newcomer and persistent-skeptic are declared stress personas; terse-regular's verbosity is
measured on ABCD train (cluster of 36.5% of dialogues).

## HF11: global units route a prompt change to the right persona cells

**Verdict: SUPPORTED, at the edge of the bar.** The language rule, linked as a global unit to the
persona field `language`, selected exactly the French persona's cells. Flips concentrated there: 11 of
22 selected cells flipped against 1 of 22 unselected cells (U = 0.045, bar 0.05; S > U).

What ran: 11 H11 blocks (those that passed at least 13 of 16 H11 trials), terse-regular (en) and
terse-regular-fr (fr), prompt arms base, negate, drop, 5 trials per cell. The en base cells are HF10's
terse-regular trials 1 to 5. Trial verdict: block contract AND an offline language check.

| Measure | Selected (fr) | Unselected (en) |
|---|---|---|
| Cell flips, both mutations (primary) | 11 of 22, 0.50 [Wilson 0.31, 0.69] | 1 of 22, 0.045 [0.008, 0.218] |
| negate | 10 of 11 | 0 of 11 |
| drop | 1 of 11 | 1 of 11 |
| Language-check flips only | 11 of 22 | 0 of 22 |
| Block-contract flips only | 2 of 22 | 1 of 22 |
| Trial-level paired flips (secondary) | 54 of 110, 0.49 | 26 of 110, 0.24 |

Pass rates (contract and language): fr base 0.82, fr negate 0.05, fr drop 0.78; en base 0.85, en negate
0.84, en drop 0.84. Language check alone: fr negate 0.05, every other arm at least 0.96.

Reading:
- Negating the rule broke the French cells (the language check failed in 52 of 55 trials: the agent wrote English to a French customer) and left
  every English cell's verdict unchanged. Routing worked for the mutation that changes behaviour.
- Dropping the rule changed nothing: without it the agent still answered the French customer in French
  (language check 0.96). The selector still selects the French cells for a drop, so half the selected
  cells are a change with no effect; the link says "may matter here", not "will flip here".
- The one unselected flip (block 2062, en, drop: base 1 of 5 passes, drop 3 of 5) is block-contract noise
  on a flaky block, with the language check passing in all 10 trials. One flip is exactly what the
  22-cell design allows; a second would have falsified HF11. At the trial level, unselected trials flip
  24% of the time (re-run noise on the contract), so the 5% bar holds only on majority cell verdicts.
- Detector check: on the French persona's own turns the detector labels 540 French, 0 English, 497 too
  short to tell; on 500 real ABCD agent turns it labels 446 English, 0 French.

Limits: one unit, one link, two languages, 11 blocks chosen to be mostly stable. The selector is the
simplest rule (persona field differs from the prompt default); a unit linked to several fields or to a
scenario field is untested.

## HF12: ownership refusal catches real conflicts

**Verdict: SUPPORTED.** The loader caught 30 of 30 planted conflicts with the right reason (6 of 6 in
each class: ownership violation, slot collision, contradictory belief, persona switch in a chain, unmet
`requires` as `not_run` with the requirement named) and refused 0 of 30 clean near-misses.

How it was kept honest: `hf12/SCHEMA.md` was written first from `simuser_model.md` 3.2, 3.3, 3.5, 7.4
and `config_framework.md` 2.5. A separate agent wrote the 60 fixtures from the schema alone, without the
loader; the loader was written from the schema alone before the fixtures were read; both were committed
in the pre-registration commit and scored once.

Reading and limits:
- What this shows: the refusal rules are precise enough that two independent readings of them agree on
  60 cases, including near-misses (a `ref` beside a colliding value, `override: false` still refused,
  fact text differing only in case and spaces, a grandparent-level persona switch, the first failing
  `requires` key in block order).
- What it does not show: the rules' coverage of conflicts nobody wrote down. Ambiguities the fixture
  author resolved (recorded in its report): a child that omits `personas` is checked against the
  inherited set; an absent `has_account` counts as false; `requires: {}` means no requirement. The loader
  read the schema the same way. These belong in the design note as explicit rules.

- Stored data note: four persona phone values in `hf12/fixtures/cases.json` were written in Belgian format. The leak guard reads such numbers as real, so they now read `+12025550142`, `+12025550177`, `+12025550118` and `+12025550199`, inside the fictional range. The loader never reads the format of a phone. `run.py` gives a byte-identical `hf12/results.json` before and after the change.
