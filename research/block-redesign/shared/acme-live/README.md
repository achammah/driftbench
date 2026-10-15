# Live Acme agent (shared research stand-in)

The Acme sales assistant of `examples/acme`, rebuilt on a live model for the block-redesign experiments. Research code: no product package changes. One writer, the links lane; ask it for any change, and reuse these files unchanged so every lane tests the same agent.

## What it is

- Prompt: `prompt/acme-sales.md`, 30 sections, 7,260 characters, sha256 `cd17d54f499f5b03a829f71bd1f66639f3e602335140818a66322b442757c544`. Written from `examples/acme/src/policy.ts` and `store.ts`. Source of truth: `prompt/acme-sales.src.yaml`.
- Sections registry (M3.1): `prompt/acme-sales.sections.yaml`. Each section has a stable `id`, `kind`, `scope` (4 `global`: identity, language, style, facts_from_tools; 26 `local`), a span in UTF-16 code units (end exclusive, after NFC and LF), a sha256, an anchor quote with prefix and suffix, and `references` / `overrides` edges. `python registry.py build` re-renders both files from the source; the sha above must not change.
- Tools: `acme_live/tools.py`, a Python port of `examples/acme/src/tools.ts` and `store.ts` (same data, same input rules, unknown parameters refused). Names use underscores (`catalog_search`, `coverage_check`, `port_check`, `order_create`, `notify_sales`) because the API takes no dot. A tool can be forced to fail or answer with `overrides`.
- Agent: `acme_live/agent.py`, `claude-haiku-5-5`, `output_config.effort = "low"`, thinking at the model default, no temperature (Haiku 5.5 rejects non-default sampling, so runs are stochastic), max_tokens 2048, at most 6 model calls per turn, system prompt cached.
- Price (https://platform.claude.com/docs/en/about-claude/pricing), prompts up to 100K tokens: 0.10 USD input, 0.50 output, 0.01 cache read per million tokens. Measured: about 0.0004 USD per customer turn; a two-turn block about 0.001 USD.

## Run one block

Python 3.12 with `anthropic` (1.x) and `pyyaml`. The key is read from `~/.nexus-secrets/anthropic-driftbench.key` inside the process.

```sh
cd research/block-redesign/shared/acme-live
python -m acme_live.run_block --turns "I want home internet at 7 Quarry Lane, Acmeville" "+1 202 555 0177"
python -m acme_live.run_block --turns "Is internet available at 3 Orchard Way, Acmeville?" \
    --overrides '{"coverage_check": {"error": "coverage service unavailable"}}'
python -m acme_live.run_block --prompt my-variant.md --turns "Hi there"
```

It prints each turn's reply text, tool calls (name, input, output or error) and usage, plus the total USD. `examples/one-block.json` is a recorded output.

From code (free-running, history carried):

```python
from acme_live.agent import AcmeLive
agent = AcmeLive()                     # or AcmeLive(system_text=variant_text)
t1 = agent.respond([], "Hi, I'd like more data on my phone plan.")
t2 = agent.respond(t1["history"], "It's sam.rivera@example.com")
t2["calls"], t2["text"], t2["usd"]
```

## From the repo's adapters

`python -m acme_live.run_block --stdin` reads `{"messages": [...], "overrides": {...}, "prompt": "<path>"}` and prints `{"text", "calls", "usage", "usd", "model"}` for the last user message. Earlier turns are replayed as plain text (no tool replay), so a wrapper (for example the process adapter, or a `function:` target that spawns this command) can drive a spec block by block. For free-running chains with tool history, use `AcmeLive.respond` and pass `history` back.

## Fictional data

Acme Telecom, Acmeville, the people, the prices and the numbers are fictional (emails at example.com, phones in +1 202 555 0100 to 0199).
