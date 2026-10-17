# Value-ladder fixtures

Every file here is a byte copy of its source, except `acme-live-tools.json`. Do not reformat them: the test
`value-ladder.test.ts` hashes each one against the sha below. The folder is outside the formatter for that reason.

- R: `research/block-framework-value` (PR 441) at `6786a4f05e0f0382576d51ca073ccec3d640b278`, folder `research/block-redesign/framework/value/`.
- P: `feat/block-phase-1-oracle` (PR 434) at `038e33cb46e72fc068a74ce55c5381f679fd5af3`, folder `packages/checks/test/fixtures/normalised-oracle/`.

| File | Source | sha256 |
|---|---|---|
| `runs-class.jsonl` | R `inputs/runs-class.jsonl`: the 259 stored H1 class runs, every tool call with its output | `a5e752629b50c73cc0c6af000af1920ea24f7d1eac23851358c76d7477c5e6d3` |
| `judge_cache.jsonl` | R `data/judge_cache.jsonl`: every recorded judge call of HF5 and HF7, by its identity parts | `c151bfc16ad41c226a5f129415ef13f882cc2e8d00df6782ccde0a4a4d97a4ed` |
| `hf7_items.json` | R `data/hf7_items.json`: the 128 HF7 items, 56 positives and 72 near misses | `3ade8f63e6dc255cd5f11b35076282918dba0ae1fe45150022b20fa6b33e7636` |
| `hf7_judgments.jsonl` | R `data/hf7_judgments.jsonl`: the 3,072 HF7 judgments | `cd70f9e12ce8bb803e8d21c0f1507f7cf4eccd8c55741b73f8cb6f088129d9de` |
| `labels-gpt-6.1-sol.jsonl` | R `data/labels-gpt-6.1-sol.jsonl`: the first HF5 labeller | `c1302bdd0b76ce6f19f137c68ce6527379728df73358c78fc80dbf1145ecb74b` |
| `labels-gemini-3.6-flash.jsonl` | R `data/labels-gemini-3.6-flash.jsonl`: the second HF5 labeller | `e8d997a5c38f99d8576772bd5eb9dade71304782e84e2f0c098e6c85417228cc` |
| `h3/blocks.json` | P `blocks.json`: the ten blocks, their gold inputs, surface forms and minimal pairs (its normalise rules are not read) | `0a16af5be88aa374de0d34d9697afd5113069cb0914a9d526f8f886217d459d6` |
| `h3/h1-runs.jsonl` | P `h1-runs.jsonl`: the 559 stored H1 runs of the H3 harness, seed and class | `68549cc670d76d462108ac6ac0cd721b6c30760ccd842d58d8888340a7374888` |
| `acme-live-tools.json` | derived: `TOOL_DEFS` of R `acme/acme_live/tools.py` (sha256 `4c08bb709e2ab4f6dd6581dc628acd2fe84a715ed965eec1420d2ca8c81528ed`), keyed by the product tool labels, schemas unchanged, descriptions unchanged except the HF9 fix sentence in `coverage.check` ("Give the street type in full, for example Road, not Rd.") | `2f40f49a0c22eecad23ef21cc0c8727aa30d71d37969b2d653d692ca4fe92405` |
