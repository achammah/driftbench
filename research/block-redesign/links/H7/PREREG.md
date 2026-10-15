# H7 pre-registration: section-level selection is safe and smaller than the whole suite

Lane: links. Branch: research/block-links. Protocol: the shared block-experiments PROTOCOL.md (owner go 2026-10-14).
The commit that adds this file is the pre-registration. Nothing below was run before it, apart from the offline M3.1 battery (no model call).

## Hypothesis (verbatim, report section 5)

| # | Claim | Experiment | Metric | Falsified if | Cost | Validates |
|---|---|---|---|---|---|---|
| H7 | Section-level selection is safe and smaller than the whole suite. | 30 sections × 3 mutants plus 2 controls each; full suite 3 times per mutant. | STARTS safety and precision violation; selection ratio. | Safety violation above 0 on more than 5% of mutants, or selection ratio above 0.8. | Paid, about 150 full-suite runs. | 3.2, M3.5 |

Note on the run count: 30 sections × (3 + 2) variants × 3 runs is 450 suite runs, not 150. This design runs 450 (plus 6 baseline runs and confirmations); the "about 150" in the table matches 150 variants, not 150 runs. Budget below.

## What is under test

- Agent: a research stand-in of the Acme sales agent, live. origin/main has no LLM-backed Acme agent (examples/acme is deterministic TypeScript), so this folder holds one: a system prompt of 30 sections written from `examples/acme/src/policy.ts` (`prompt/acme-sales.src.yaml`, rendered to `prompt/acme-sales.md`, 7,260 characters), and the five Acme tools ported to Python with the same data and the same input rules (`acme_live/tools.py`).
- Model: `claude-haiku-5-5`, `output_config.effort = "low"`, thinking left at the model default (adaptive). Temperature is not set: Haiku 5.5 rejects non-default sampling values, so the agent is stochastic and has no seed. max_tokens 2048, at most 6 model calls per block.
- Section registry (M3.1): `prompt/acme-sales.sections.yaml`, 30 sections: 4 `global` (identity, language, style, facts_from_tools) and 26 `local`, each with span (UTF-16, end exclusive), sha256, anchor quote with prefix and suffix, `references` and `overrides` edges.
- Suite: `suite/suite.yaml`, 19 conversations, 37 blocks. Each conversation is a parent chain (block k's parent is block k-1, free-running). Checks are deterministic (tool calls, tool inputs, call order, reply regexes); no judge.
- Declared links (the selection input): each block's `links` list names the local sections it exercises, written by the author before any run (`status: declared`, `created_by: author`). Global sections link to every block implicitly. Every local section has at least one linked block. Block `l1` declares an empty list: it depends on global sections only.

## Mutants (M3.4), frozen before the first suite run

For each of the 30 sections, 5 variants of the whole prompt, each changing that one section only:
- `drop`: the section (heading and body) is removed. Deterministic.
- `negate`: the body is rewritten to instruct the opposite of its main rule, heading kept. Generator `gpt-6-luna` (OpenAI, newest small model listed by the API on 2026-10-14), seed 1234 (+1 per retry).
- `rephrase`: the body is rewritten in different words with the same meaning (PROMPTFUZZ rephrase). Same generator and seed rule.
- `ctl_punct` (control): delete the first comma of the body; if there is none, replace the last period of the body with a semicolon. Deterministic.
- `ctl_synonym` (control): replace exactly two ordinary words with synonyms; quoted strings, tool names, numbers, email and phone values untouched (MuCS-style). Same generator and seed rule.
- Validity gate, automatic: every variant differs from the original section; LLM variants keep the heading; controls and `rephrase` keep every quoted string, tool name and number of the original section. A variant failing the gate is regenerated with the next seed, at most 3 tries, and every try is logged. Mutants are committed (`mutants/`) before the first mutant suite run; that commit sha is recorded in RESULTS.md.

## Runs

- Baseline: the unmutated prompt, full suite 6 times.
- Each of the 150 variants: full suite 3 times (450 suite runs).
- Confirmation (pre-registered, not a re-run for a better number): for every (non-control mutant, block) pair that flips in at least 2 of its 3 runs, the block's conversation runs 3 more times under that mutant.

## Definitions

- v0(b): block b's majority verdict over the 6 baseline runs; a 3 to 3 split marks b `unstable`.
- Null flip rate p0(b): share of runs disagreeing with v0(b), pooled over the 6 baseline runs and all 180 control-variant runs (60 controls × 3).
- Flaky: p0(b) > 0.2, or b unstable. Flaky blocks cannot verify a link and are excluded from E and from T in the primary analysis; their count is reported, and a sensitivity analysis keeps them.
- E(m), the affected blocks of mutant m: b flips against v0(b) in at least 2 of the 3 runs, and again in at least 2 of the 3 confirmation runs.
- T(m), the selected blocks (rule D2 of deep_3, M3.5): if the mutated section is global, every block. Otherwise closure(s) = s plus every section that `references` or `overrides` a member of the closure, transitively; T = blocks with a declared link to any section in closure(s). A block with no link record is always selected (none in this suite; `l1`'s empty list is a record).
- Per mutant (STARTS, p. 7): safety violation SV = |E \ T| / |E ∪ T|; precision violation PV = |T \ E| / |E ∪ T|; both 0 when E ∪ T is empty. Selection ratio SR = |T| / (number of non-flaky blocks).

## Metric, falsifier, verdict

- Population: the 90 non-control mutants.
- Primary: share of mutants with SV > 0; mean SR over the 90.
- FALSIFIED if the share of mutants with SV > 0 is above 5%, or mean SR is above 0.8 (thresholds copied from section 5, unchanged).
- SUPPORTED if both hold and at least 10 non-control mutants have a non-empty E.
- INCONCLUSIVE if fewer than 10 non-control mutants have a non-empty E (safety would be vacuous), or if the budget stop rule ends the run before all 90 mutants are measured.
- Intervals: Wilson 95% on the share with SV > 0, and a cluster bootstrap over the 30 sections (10,000 resamples, seed 20261014) for both the share and mean SR, since mutants of one section are correlated. The verdict uses the point estimates; an interval that crosses a threshold is printed next to the verdict.
- Also reported: PV per mutant, SR excluding global sections, the controls' SV and E sizes (expected empty), E computed by stage 1 alone (sensitivity), every safety violation listed as the missing (block, section) link it reveals, per-section mutation score MS = killed / non-equivalent where a surviving mutant is "survived" (equivalence is not judged by a person in this lane; MS is reported over all mutants and labelled so).

## Budget, scaling rule and stop rule

- Lane cap 40 USD. Stop at 36 USD (90%). Prices: Haiku 5.5 input 0.10, output 0.50, cache write 0.125, cache read 0.01 USD per million tokens; gpt-6-luna at its published price, recorded in LEDGER.md with the usage fields.
- Tiny sample first: 1 suite run of the baseline (19 conversations); measured USD per suite run goes into LEDGER.md with the projection for 456 suite runs plus 10% for confirmations.
- Scaling rule, fixed now: if the projection is above 30 USD, keep the 4 global sections and draw local sections at random (seed 20261014, stratified by `kind`) down to the largest count k whose projection fits under 30 USD; the reduced design (4 + k sections, 3·(4 + k) non-control mutants) and its loss of power are written into this file in a dated amendment and pushed before the first mutant run. The falsifier thresholds do not change.
- Pilot runs used to debug the harness are logged in the ledger, tagged `pilot`, and never enter the analysis.
- A crash or provider outage that loses runs: the lost (variant, rep, conversation) jobs are re-run once, with the reason in the ledger; both attempts are kept in the raw data.

## Amendment 1 (2026-10-14, after the tiny sample, before any mutant exists or runs)

Reason: the tiny sample measured 0.0083 USD per suite run (LEDGER.md), so the full design projects to about 4 USD and no scaling is needed. The spare budget buys what the original design left out:
- 20 two-section mutants (`pair__<a>__<b>`): pairs of local sections drawn at random (seed 20261014), each section replaced by its own `negate` body. Full suite 3 times each, same confirmation rule. They join the H7 population as non-control mutants with T = union of the two closures, and they are reported both inside and apart from the 90 single-section mutants. The verdict rule is computed on the 90 single-section mutants (as registered) and, separately, on all 110; if the two disagree, both are reported and the registered 90 decide.
- Check fix, found in the sample: block `ly1` had `must_not: ["Mobile S,"]`, which fails when the agent correctly names the customer's current plan ("You're currently on Acme Mobile S, ..."). It is replaced by `must: ["Mobile M", "Mobile L"]`. No other check changed. All runs store tool calls and reply text, so every check can be re-scored offline from raw data.
