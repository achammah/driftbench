# Framework persona experiments: HF10, HF11, HF12

Research code for Group C of the framework hypotheses (block redesign). Nothing here changes `packages/*`.

| Path | What |
|---|---|
| `PREREG.md` | Hypotheses, metrics, falsifiers, sample sizes, seeds, models, stop rule |
| `personas/` | The five persona files and the ABCD measurement behind terse-regular |
| `lib/` | Copied from `research/block-sim` (a460cdffa): ABCD loader, agent, engine, conversation driver; plus personas, routing, language check and grid statistics |
| `hf10/`, `hf11/` | Runners and analyses for the persona grid and the prompt-unit routing |
| `hf12/` | Schema, blind fixtures, loader and scorer for ownership refusals (offline) |
| `checks_offline.py` | Checks run before any paid call |
| `LEDGER.md` | Every paid batch |

Data: ABCD v1.1 (Chen et al. 2021), MIT licence (Copyright (c) 2021 ASAPP Research), raw file outside the
repository; set `ABCD_DIR` to a folder holding `abcd_v1.1.json.gz`, `guidelines.json`, `ontology.json`.
