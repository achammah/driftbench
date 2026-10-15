# H10 results: an agenda engine beats prompting for simulator realism

**Verdict: SUPPORTED.** The agenda engine was closer to the real ABCD customers than the findings prompt on
5 of 6 pre-registered metrics. Three of the five gains have bootstrap intervals that exclude 0; two do not.

## What ran

- Real human reference: 100 ABCD test conversations (8 action flows, stratified by flow, seed 10); real
  crowd customers talking to trained human agents. ABCD is MIT licensed.
- Three simulator arms on the same 100 scenarios, all on `gpt-5.4-nano`: free (tau-bench user rules),
  findings (tau-bench rules plus six Sim2Real A.6 findings lines, reconstructed), engine (M2.1 agenda
  engine with the section 2.2 default parameters, none tuned on ABCD, plus an LLM realiser).
- Agent under test: `claude-haiku-5-5` (effort low) built from ABCD's guidelines and action buttons.
- 300 conversations, 0 errors. Cost 2.52 USD (LEDGER row 8).
- Pre-registration: `h10/PREREG.md`, commit bb8bb5281; amendments 1 (string-match act check) and 2 (an
  engine clean-up fix after the tiny sample), both before the full run.

## Six metrics: rates

| Metric | Human (ABCD) | free | findings | engine |
|---|---|---|---|---|
| Short% (turns of 3 words or fewer) | 38.2 | 1.8 | 2.0 | 38.0 |
| Polite% | 20.7 | 27.9 | 30.1 | 14.4 |
| FrntId% (share of words in the first two turns) | 49.6 | 43.9 | 28.0 | 34.4 |
| IDs per turn | 0.27 | 0.48 | 0.48 | 0.45 |
| Uncert% | 4.1 | 3.4 | 5.1 | 5.7 |
| Quest% | 8.9 | 21.2 | 50.0 | 10.7 |

## Six metrics: Dice against humans (100 = identical rate)

| Metric | free | findings | engine | engine minus findings, 95% bootstrap | Engine better? | Human split-half ceiling |
|---|---|---|---|---|---|---|
| Short% | 9.0 | 9.7 | 99.7 | +90.0 [+79.5, +93.1] | yes | 99.5 |
| Polite% | 85.2 | 81.5 | 82.2 | +0.7 [-15.4, +17.5] | yes (tie in noise) | 96.4 |
| FrntId% | 94.0 | 72.2 | 81.9 | +9.7 [+2.2, +17.9] | yes | 97.9 |
| IDs/turn | 72.6 | 72.5 | 75.0 | +2.5 [-5.0, +10.0] | yes (tie in noise) | 98.9 |
| Uncert% | 90.9 | 89.5 | 84.0 | -5.5 [-22.5, +15.4] | no | 54.4 |
| Quest% | 59.1 | 30.2 | 90.7 | +60.4 [+48.1, +68.2] | yes | 81.5 |

Falsifier (verbatim): "Engine not better than the findings prompt on at least 4 of 6 metrics." The engine
is better on 5 on the point estimate, so H10 is SUPPORTED. Counting only differences whose interval
excludes 0, the engine is better on 3 (Short%, FrntId%, Quest%) and worse on none.

## Secondary measures (not in the verdict)

| Measure | Human | free | findings | engine |
|---|---|---|---|---|
| User turns per dialogue | 7.3 | 6.1 | 7.7 | 8.1 |
| Words per turn | 7.9 | 17.9 | 25.9 | 7.6 |
| Cramer-von Mises, turns per dialogue vs human (0 = same) | | 0.32 | 0.06 | 0.14 |
| Agent pass rate on the gold-button contract | | 0.57 | 0.54 | 0.57 |
| Ended by | | STOP 100 | STOP 100 | STOP 94, ABANDON 6 |

## Reading

- The engine's big wins are the two behaviours an LLM will not produce from instructions alone: short
  turns (38% against 2% for both prompts; humans 38%) and few questions (11% against 50% for the
  findings prompt; humans 9%). Both are drawn by the engine, not asked of the model.
- The findings prompt made two metrics worse than the plain prompt: questions doubled (21% to 50%) and
  front-loading fell far below humans (28% against 50%). This repeats Sim2Real App. A.6, where the same
  kind of prompt fixed some rates and overshot others.
- The free prompt is the closest on FrntId% (94.0) and on Uncert% (90.9). The hypothesis compares the
  engine with the findings prompt only; against the free prompt the engine is better on 3 of 6 (Short%,
  IDs/turn, Quest%) and worse on 3 (Polite%, FrntId%, Uncert%). The engine's front-loading cap (an
  opening without details) pushed FrntId% below the human rate.
- Uncert% is too rare to rank arms: the human split-half ceiling is only 54.4, so no arm can be told
  apart from another on it with 100 dialogues.
- The engine's turn lengths match humans (7.6 against 7.9 words); both prompts write 2 to 3 times longer.
- Realism did not change the agent's pass rate (0.54 to 0.57 across arms).

## M2.1 and M2.3 checks

| Check | Result |
|---|---|
| M2.1 determinism: same seed, same agent acts, 10 runs | identical planned-act sequences (`checks_offline.py`) |
| M2.1 act recovery: realised text carries every planned fact value | 386 of 420 turns (92%) |
| M2.1 premature stop: goodbye planned before the agent's last tool call | 0 |
| M2.1 hallucination: a turn planned as "do not know" that carries an unmatched id | 0 |
| M2.2-style leak count, as pre-registered (any fact value present but not planned) | 122 |
| Same, excluding values contained in a planned value (zip inside an address, username inside an e-mail) | 23 in 23 of 810 turns, 19 of them order ids mostly re-mentioned after an earlier disclosure |
| M2.3 metric check: free transcripts with "please" on every turn | Polite% Dice drops from 85.2 to 34.3, so the metric reacts as it should |

The pre-registered leak count overcounts: it matched fact values anywhere, and ABCD addresses contain zip
codes and e-mails contain usernames. The second row is the corrected reading, added after the data and
labelled as such.

## Limits

- The human customers met human agents; the simulators met the Haiku agent. All three arms share this
  confound, so the arm ranking holds, but the absolute Dice values are not comparable with Sim2Real's.
- ECE and abandonment per outcome class were not computed (no human success rate on this agent; ABCD has
  no abandoned dialogues). Pushback and pivot rates need a labeller and were not in the pre-registration.
- One simulator model, one domain, 100 dialogues per arm. The findings prompt is a reconstruction.
- ABCD customers are crowd workers playing a scenario, not people with a real need.

Raw data: `h10/results.json`.
