# H10 pre-registration: an agenda engine beats prompting for simulator realism

Written 2026-10-14 before any paid call for H10. The commit sha that first adds this file is the
pre-registration. Later changes go under "Amendments" with their reason, before the data they affect.

## Hypothesis (section 5, verbatim)

| # | Claim | Experiment | Metric | Falsified if | Cost |
|---|---|---|---|---|---|
| H10 | Agenda and ledger outside the LLM bring the simulator closer to humans than prompting. | Same tasks, three arms: free prompt, findings prompt (Sim2Real A.6), agenda engine; compared on consented real logs. | Per-metric Dice, ECE, FrntId%, abandonment per outcome class. | Engine not better than the findings prompt on at least 4 of 6 metrics. | Paid, about 300 simulated conversations; needs real logs. |

## Real human data

ABCD (Chen et al., NAACL 2021), MIT licence: real human customers (crowd workers playing a scenario) talking
to trained human agents. Test split, the 8 action flows (the two FAQ flows are excluded: their answer texts
are not released, so the agent under test cannot serve them). 791 test conversations qualify.

- Evaluation set E: 100 conversations, `random.Random(10)`, stratified by flow in proportion to the split.
- Ceiling set: 200 further conversations from the same pool (same seed stream), split into two halves of
  100; the split-half human vs human Dice is the ceiling (M2.3).
- A customer turn = consecutive customer messages merged into one turn (ABCD customers often send several
  short messages in a row; Sim2Real counts turns, not chat bubbles).

## Arms (same 100 scenarios, same agent, same simulator model)

- **free**: the tau-bench user rules (user.py lines 61 to 68) plus the scenario.
- **findings**: free plus the findings lines of Sim2Real App. A.6 (reveal information gradually, vary tone
  and length, express uncertainty when unsure, ask clarifying questions, push back when the agent is wrong,
  show frustration when stuck). The paper's exact prompt text is not published in what was read
  (deep_2 note); the lines are a reconstruction from its list of findings and are quoted in
  `lib/simulators.py`.
- **engine** (M2.1): a deterministic agenda engine holds the goal, the disclosure ledger, the agenda stack,
  engagement and stop rules; an act classifier (an LLM call returning JSON) labels each agent turn; push
  rules fire; the engine pops n acts with a seeded draw from P(n) = {1: 0.7, 2: 0.25, 3: 0.05}; per-turn
  style draws decide short (p 0.29), polite (p 0.15), uncertain (p 0.07), question (p 0.10); the LLM
  realiser writes one message carrying exactly those acts. The engine, not the LLM, emits the stop token,
  and only after the agent signals closure or the turn budget (16) or engagement (below 0.3) runs out.
  All parameters are the schema defaults of section 2.2 (Sim2Real and Lost in Simulation human rates on
  tau-bench). None is tuned on ABCD.
- Simulator, realiser and act classifier model: `gpt-5.4-nano` (OpenAI, newest small model listed by the
  API on 2026-10-14), its default temperature (the only one it accepts), lowest reasoning effort.
- Agent under test: `claude-haiku-5-5` built from ABCD's guidelines, `effort = "low"` (see `lib/agent.py`).
- Conversation: fixed agent greeting, then alternation; cap 20 user turns. Engine seed per item = 10000 +
  item index.

## Metrics (computed on customer turns; the stop token is stripped; a turn that is only a stop token is dropped)

The six metrics in the falsifier (section 5 says "6 metrics" without listing them; these are the six
behaviour rates of the section 2.2 schema, all defined in Sim2Real App. A.4 or Lost in Simulation):

1. Short% : share of turns with at most 3 words (words = whitespace tokens).
2. Polite% : share of turns matching `\b(please|pls|thanks|thank|thx|sorry|appreciate)\b` (case-insensitive).
3. FrntId% : per dialogue, words in the first two customer turns / all customer words; mean over dialogues.
4. IDs/turn : identifier-like strings per turn, counted by regex: e-mail addresses; phone numbers
   (`\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}`); tokens of 5 or more characters that contain a digit (order ids,
   account ids, zip codes, amounts excluded below 5 characters). Each match counts once.
5. Uncert% : share of turns matching `\b(i think|not sure|maybe|i guess|probably|i don'?t know|i don'?t remember|i believe|perhaps|no idea|can'?t remember)\b`.
6. Quest% : share of turns containing `?`.

Per-metric alignment Dice_m = 2 min(M_m, H_m) / (M_m + H_m) x 100 between an arm (M) and the human set E (H).

## Falsifier (section 5, verbatim)

Engine not better than the findings prompt on at least 4 of 6 metrics. "Better" on metric m means
Dice_engine,m > Dice_findings,m on the point estimate. SUPPORTED if better on 4, 5 or 6 metrics; FALSIFIED
if on 3 or fewer. Each difference also gets a 95% bootstrap interval over dialogues (2,000 resamples, seed
1001, resampling simulated dialogues and human dialogues independently).

## Deviations from section 5, written before data

- **ECE is not computed.** ECE compares agent success with simulated users against success with humans
  on the same agent. ABCD's humans spoke with human agents, not with the agent under test, so no human
  success rate exists for this agent. No consented logs with this agent exist.
- **Abandonment per outcome class is not computed.** ABCD has no outcome classes and no abandoned
  dialogues (every collected chat was completed). The engine's abandon rate is reported, without a human
  comparison.
- **Agent confound.** Human customers met human agents; simulated customers meet the Haiku agent. The
  confound is shared by all three arms, so the arm comparison stays fair, but absolute Dice values are
  not comparable with Sim2Real's.

## Secondary measures (reported, not in the verdict)

Dice on user turns per dialogue and words per turn; Cramer-von Mises divergence between the turns-per-
dialogue distributions (Pietquin and Hastie); split-half ceiling per metric; agent pass rate per arm on
the gold-button contract of H11; engine leak count (a hidden fact disclosed before it was requested or
volunteered by its draw) and hallucination count (a value for an unknown slot); act-classifier agreement
between planned acts and acts detected on the realised text.

## M2.1 and M2.3 sanity checks

1. M2.1 determinism (offline): same seed and the same recorded agent acts give an identical planned-act
   sequence across 10 runs.
2. M2.1 act recovery: share of turns whose realised text carries every planned `answer` act (the slot's
   exact value appears in the text, case-insensitive) and no unplanned fact value. No threshold is set
   (no hand-labelled sample exists). See amendment 1.
3. M2.1 premature stop: count of engine stops issued before the agent's last tool call or before the
   agent signalled closure (should be 0 by construction; it is measured, not assumed).
4. M2.3 metric check (offline): the free arm's transcripts with "please" added to every turn must score a
   lower Polite% Dice than the untouched transcripts. If not, the metric is broken and H10 is
   INCONCLUSIVE.

## Sample size, seeds, stop rule, budget

- 100 scenarios x 3 arms = 300 conversations. Seeds above.
- Tiny sample first: 2 scenarios x 3 arms end to end; measured USD per conversation and the projection go
  into LEDGER.md before scaling.
- H10 sub-budget 9 USD within the 25 USD lane cap (stop at 22.5 USD cumulative). If the projection exceeds
  it, every arm drops to the same smaller n (at least 50), written here first.
- Errors: re-run once, both kept; never counted as data.

## Amendments

1. 2026-10-14, before any H10 data: the act-recovery check uses an exact string match of fact values in
   place of a second LLM classifier call. Reason: the planned acts that carry facts are checkable exactly,
   which is stricter and costs nothing; acts with no fact value (acknowledge, goodbye) are not scored.
2. 2026-10-14, after the H10 tiny sample (2 scenarios x 3 arms, not used as data), before the full run: the
   engine kept an unanswered alternative on its agenda ("full name or account ID" left an account ID act
   that surfaced at goodbye). A clean-up step now drops responses to an earlier agent turn when the agent
   takes a new turn (Schatzmann 2007 Sec. 2.5 clean-up). No parameter changed.
