# Simulated-human experiments: results

Three pre-registered hypotheses from section 5 of "Driftbench block redesign deep", run on ABCD (real human
customer service dialogues, MIT licence) against a Haiku 5.5 support agent built from ABCD's own
guidelines. Pre-registration commit: bb8bb5281. Spend: 5.78 USD of the 25 USD lane cap (`LEDGER.md`).

| # | Claim | Verdict | Key numbers |
|---|---|---|---|
| H11 | Simulated verdicts flip across simulator families. | **FALSIFIED** | Cross-family flip share 0.15 against a within-family re-run flip share 0.20; X minus W -0.05 [-0.125, 0.000]. 20 blocks, gpt-5.4-nano vs gemini-3.5-flash-lite, 8 trials each. |
| H10 | An agenda engine outside the LLM beats prompting for simulator realism. | **SUPPORTED** | Engine closer to humans than the findings prompt on 5 of 6 metrics (3 with intervals excluding 0: Short%, FrntId%, Quest%; worse on none with an interval excluding 0). Short turns 38.0% vs 2.0% (humans 38.2%). |
| H14 | Uncovered production clusters yield more failing blocks than random samples. | **FALSIFIED** | Failing blocks 2 of 17 (uncovered) vs 6 of 17 (random); difference -0.235 [-0.484, +0.053]. |

## What the results mean for the block redesign

- **M2.1 (agenda engine) earns its place.** The behaviours LLM users get most wrong (too long, too many
  questions, never terse) are fixed by drawing them outside the model, with untuned human defaults. A
  findings prompt made questions worse (21% to 50%), as Sim2Real A.6 found.
- **M2.5 (multi-simulator flag) needs a noise baseline.** With pass^4 on 4 trials, flaky blocks flip on a
  plain re-run as often as on a family swap. Report each block's within-family flip rate beside the
  cross-family one; flag only blocks that exceed it.
- **M3.6 (production to block): coverage gaps are not failure predictors here.** A suite written from the
  prompt covered the agent's hard flows; the uncovered clusters were easy ones. Uncovered clusters remain
  a coverage signal; a failure estimate per cluster is needed to prioritise them.

## Limits shared by all three

- ABCD customers are crowd workers playing scenarios and met human agents, not this agent. No consented
  production logs exist; ECE and abandonment per outcome class could not be computed (H10).
- One agent, one domain, small simulator models. The block contract checks gold buttons as a set, not
  order or values.

Per hypothesis: `h11/RESULTS.md`, `h10/RESULTS.md`, `h14/RESULTS.md`, each with `results.json` and the
gzipped transcripts. Code: `lib/`, runners `run_h1x.py`, `analyse.py`, offline checks `checks_offline.py`.
