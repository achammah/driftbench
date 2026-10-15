# Links lane: H5 and H7 research prototypes

Research code only, not product code. See H7/PREREG.md and H5/PREREG.md.

- `prompt/`: the live Acme sales prompt (30 sections) and its M3.1 registry. `registry.py build` renders both; `registry.py battery` runs the M3.1 re-anchoring battery.
- `acme_live/`: the Acme tools ported to Python and the live runner on claude-haiku-5-5.
- `suite/suite.yaml`: 19 conversations, 37 blocks, deterministic checks, declared links to sections.
- `mutants/`: M3.4 section mutants and controls. `ochiai.py`: M3.2. `select.py`: M3.5.
