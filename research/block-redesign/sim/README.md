# Simulated-human experiments: H10, H11, H14

Research code for three hypotheses of section 5 of "Driftbench block redesign deep" (reports folder, not in
this repository). Shared protocol: owner go of 2026-10-14. Nothing here changes `packages/*`.

| Folder | Hypothesis | Mechanism prototyped |
|---|---|---|
| `h11/` | Simulated verdicts flip across simulator families. | M2.5 multi-simulator pass^k and a flip flag |
| `h10/` | An agenda engine outside the LLM brings the simulator closer to humans than prompting. | M2.1 agenda engine plus LLM realiser, M2.3 calibration report |
| `h14/` | Uncovered production clusters yield more failing blocks than random samples. | M3.6 production to block, a small Clio-style clustering |
| `lib/` | Shared code: the ABCD loader, the agent under test, the simulators, the metrics, the ledger. | |

Each hypothesis folder holds `PREREG.md` (committed and pushed before any paid call for it), then
`RESULTS.md` and `results.json`. `LEDGER.md` records every paid batch.

## Data

ABCD, the Action-Based Conversations Dataset (Chen, Chen, Yang, Lin, Yu, NAACL 2021,
https://github.com/asappresearch/abcd). Licence: MIT (Copyright (c) 2021 ASAPP Research), which allows
research use and redistribution of derived files with the notice. It holds 10,042 real human-to-human
customer service dialogues: crowd workers played the customer from a scenario, trained crowd agents
answered while following written guidelines and clicking action buttons ("Expert Live Chat"). The raw file
is downloaded to a scratch folder outside the repository (sha256 of `abcd_v1.1.json.gz`:
`2bdf53ac359543dcdc38d55bc6513e78df120363f8f44870716e909f4606de15`). Only small derived files (sampled
conversation ids, the guideline text rendered into the agent prompt) are committed.

## The agent under test

No live Acme agent exists (the Acme example agent is deterministic TypeScript with no model). To match the
real dialogues' domain, `lib/agent.py` builds a small support agent from ABCD's own guidelines
(`guidelines.json`, `kb.json`, `ontology.json`): Claude Haiku (`claude-haiku-5-5`) with the guidelines as
its system prompt and the ABCD action buttons as tools. It is a research prototype, not a product agent.
